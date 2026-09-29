import assert from "node:assert/strict";
import test from "node:test";
import { convertPivotProjectToFieldDesign, createDesignDraftEditorState, defaultProjectSettings, reduceDesignDraftEditorState, sampleProject, serializeProjectDocument, type DesignDraft, type DraftDrawingCommand } from "@cplayout/core";
import { createVersionedProjectRepository } from "../../../packages/project-store/src/versionedProjectRepository";
import { WEB_WORKSPACE_KEY, type WorkspaceLocks } from "../../../packages/project-store/src/webWorkspaceStore";
import { createEditorSaveCoordinator, type EditorSavePayload, type EditorSaveTarget } from "./editorSaveCoordinator";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const project = () => structuredClone(sampleProject);
const projectTarget = (workspaceRevision: number | null | undefined = 5): Extract<EditorSaveTarget, { kind: "project" }> => ({
  kind: "project", payloadId: sampleProject.id, designId: null, workspaceRevision,
});
const blank = (): DesignDraft => {
  const settings = defaultProjectSettings();
  return { id: "draft", name: "Draft", settings, unitSystem: settings.unitSystem, projectCrs: null,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
};

test("queued saves snapshot immediately and use only their own preceding acknowledged revision", async () => {
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open(projectTarget());
  const gate = deferred();
  const source = project();
  const writes: Array<{ name: string; revision: number | null | undefined }> = [];
  const write = async (payload: EditorSavePayload, target: EditorSaveTarget) => {
    assert.equal(payload.kind, "project");
    if (payload.kind !== "project") throw new Error("Wrong fixture kind");
    writes.push({ name: payload.project.name, revision: target.workspaceRevision });
    if (writes.length === 1) await gate.promise;
    return { saved: true, persistenceRevision: (target.workspaceRevision ?? 0) + 1 };
  };
  source.name = "First requested edit";
  const first = coordinator.save({ session, payload: { kind: "project", project: source }, editorRevision: 1, write });
  source.name = "Second requested edit";
  const second = coordinator.save({ session, payload: { kind: "project", project: source }, editorRevision: 2, write });
  source.name = "Later unsaved edit";
  await Promise.resolve();
  assert.deepEqual(writes, [{ name: "First requested edit", revision: 5 }]);
  gate.resolve();
  assert.equal((await first).editorRevision, 1);
  assert.equal((await second).editorRevision, 2);
  assert.deepEqual(writes, [{ name: "First requested edit", revision: 5 }, { name: "Second requested edit", revision: 6 }]);
  assert.equal(source.name, "Later unsaved edit");
  assert.equal(coordinator.receipt(session).workspaceRevision, 7);
});

test("classified project saves retain the versioned metadata and detach the accepted snapshot", async () => {
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open(projectTarget());
  const source = project();
  source.drawingMetadata = { schemaVersion: "project-drawing-metadata-v1", autosaveEnabled: false, records: [] };
  const gate = deferred();
  const pending = coordinator.save({ session, payload: { kind: "project", project: source }, editorRevision: 1,
    write: async (payload) => {
      await gate.promise;
      assert.equal(payload.kind, "project");
      if (payload.kind !== "project") throw new Error("Expected project");
      assert.deepEqual(payload.project.drawingMetadata, { schemaVersion: "project-drawing-metadata-v1", autosaveEnabled: false, records: [] });
      assert.equal(JSON.parse(serializeProjectDocument(payload.project)).documentVersion, "pivot-project-v2");
      return { saved: true, persistenceRevision: 6 };
    } });
  source.drawingMetadata.autosaveEnabled = true;
  gate.resolve();
  assert.equal((await pending).saved, true);
});

test("field saves own exact unequal machine snapshots and reject incomplete or stale acknowledgments", async () => {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(project()), {
    fieldId: "field", waterSourceId: "water", powerSourceId: "power",
  }).field;
  field.machines.push({ ...structuredClone(field.machines[0]), id: "second",
    configuration: { ...structuredClone(field.machines[0].configuration), spanLengthsMeters: [31.125, 27.0625] } });
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open({ kind: "field", payloadId: field.id, designId: "design", workspaceRevision: 5, designRevision: 2 });
  const expected = structuredClone(field);
  const gate = deferred();
  const pending = coordinator.save({ session, payload: { kind: "field", field }, editorRevision: 8,
    write: async (payload, target) => {
      await gate.promise;
      assert.deepEqual(payload, { kind: "field", field: expected });
      assert.equal(target.kind, "field");
      return { saved: true, persistenceRevision: 6, designRevision: 3 };
    } });
  field.machines[1].configuration.spanLengthsMeters[0] = 99;
  gate.resolve();
  assert.equal((await pending).editorRevision, 8);
  const receipt = coordinator.receipt(session);
  assert.deepEqual(receipt, { kind: "field", payloadId: field.id, designId: "design", workspaceRevision: 6, designRevision: 3 });
  for (const designRevision of [undefined, 3, 5]) {
    await assert.rejects(coordinator.save({ session, payload: { kind: "field", field }, editorRevision: 9,
      write: async () => ({ saved: true, persistenceRevision: 7, designRevision }) }), /revision/i);
    assert.deepEqual(coordinator.receipt(session), receipt);
  }
});

test("same-ID reopen isolates old receipt and feedback while honoring an already accepted save", async () => {
  const coordinator = createEditorSaveCoordinator();
  const old = coordinator.open(projectTarget());
  const gate = deferred();
  let current!: () => boolean;
  const pending = coordinator.save({ session: old, payload: { kind: "project", project: project() }, editorRevision: 4,
    write: async (_payload, _target, owner) => { current = owner.isCurrent; await gate.promise; return { saved: true, persistenceRevision: 6 }; } });
  await Promise.resolve();
  assert.equal(current(), true);
  const reopened = coordinator.open(projectTarget());
  assert.equal(current(), false);
  gate.resolve();
  assert.equal((await pending).session, old);
  assert.equal(coordinator.receipt(old).workspaceRevision, 6);
  assert.equal(coordinator.receipt(reopened).workspaceRevision, 5);
  await assert.rejects(coordinator.save({ session: old, payload: { kind: "project", project: project() }, editorRevision: 5,
    write: async () => { throw new Error("must not run"); } }), /replaced/);
});

test("retirement and caller feedback ownership suppress stale UI without revoking an accepted write", async () => {
  for (const retire of [false, true]) {
    const coordinator = createEditorSaveCoordinator();
    const session = coordinator.open(projectTarget());
    const gate = deferred();
    let feedback = true;
    let owner!: { isCurrent(): boolean };
    const pending = coordinator.save({ session, payload: { kind: "project", project: project() }, editorRevision: 1,
      feedbackIsCurrent: () => feedback, write: async (_payload, _target, token) => { owner = token; await gate.promise; return { saved: true, persistenceRevision: 6 }; } });
    await Promise.resolve();
    if (retire) coordinator.retire(session); else feedback = false;
    assert.equal(owner.isCurrent(), false);
    gate.resolve();
    assert.equal((await pending).saved, true);
    assert.equal(coordinator.receipt(session).workspaceRevision, 6);
  }
});

test("foreign, retired, wrong-kind and wrong-identity requests cannot enqueue writes", async () => {
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open(projectTarget());
  let writes = 0;
  const request = { session, payload: { kind: "project" as const, project: project() }, editorRevision: 0,
    write: async () => { writes += 1; return { saved: true, persistenceRevision: 6 }; } };
  await assert.rejects(coordinator.save({ ...request, session: { ...session } }), /not owned/);
  await assert.rejects(coordinator.save({ ...request, payload: { kind: "project", project: { ...project(), id: "different" } } }), /does not belong/);
  await assert.rejects(coordinator.save({ ...request, payload: { kind: "draft", draft: blank() } }), /does not belong/);
  await assert.rejects(coordinator.save({ ...request, editorRevision: NaN }), /invalid/);
  coordinator.retire();
  await assert.rejects(coordinator.save(request), /replaced/);
  assert.equal(writes, 0);
});

test("rejection and failed saves retain receipts and do not poison later explicit requests", async () => {
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open(projectTarget());
  const request = { session, payload: { kind: "project" as const, project: project() }, editorRevision: 1 };
  const failed = coordinator.save({ ...request, write: async () => ({ saved: false }) });
  const thrown = coordinator.save({ ...request, write: async () => { throw new Error("Synthetic write failure"); } });
  const caught = assert.rejects(thrown, /Synthetic write failure/);
  const next = coordinator.save({ ...request, write: async (_payload, target) => {
    assert.equal(target.workspaceRevision, 5);
    return { saved: true, persistenceRevision: 6 };
  } });
  assert.equal((await failed).saved, false);
  await caught;
  assert.equal((await next).saved, true);
  assert.equal(coordinator.receipt(session).workspaceRevision, 6);
});

test("bad acknowledgments never rebase a session", async () => {
  for (const persistenceRevision of [undefined, -1, 5, 7, Infinity]) {
    const coordinator = createEditorSaveCoordinator();
    const session = coordinator.open(projectTarget());
    await assert.rejects(coordinator.save({ session, payload: { kind: "project", project: project() }, editorRevision: 2,
      write: async () => ({ saved: true, persistenceRevision }) }), /revision/i);
    assert.equal(coordinator.receipt(session).workspaceRevision, 5);
  }
});

test("copy advances only a matching current saved-source receipt and shares save ordering", async () => {
  for (const item of [
    { revision: 5, stored: true, id: sampleProject.id, expected: 6 },
    { revision: 5, stored: false, id: sampleProject.id, expected: 5 },
    { revision: null, stored: true, id: sampleProject.id, expected: null },
    { revision: 4, stored: true, id: sampleProject.id, expected: 4 },
    { revision: 5, stored: true, id: "different", expected: 5 },
  ]) {
    const coordinator = createEditorSaveCoordinator();
    const session = coordinator.open(projectTarget(item.revision));
    const gate = deferred();
    const copy = coordinator.copyProject({ session, sourceStored: item.stored, sourceId: item.id, expectedRevision: 5,
      write: async () => { await gate.promise; return { persistenceRevision: 6, id: "copy" }; } });
    let started = false;
    const save = coordinator.save({ session, payload: { kind: "project", project: project() }, editorRevision: 1,
      write: async (_payload, target) => { started = true; assert.equal(target.workspaceRevision, item.expected); return { saved: false }; } });
    await Promise.resolve();
    assert.equal(started, false);
    gate.resolve();
    assert.equal((await copy).id, "copy");
    await save;
    assert.equal(coordinator.receipt(session).workspaceRevision, item.expected);
  }
});

test("late copies cannot advance a reopened same-ID editor", async () => {
  const coordinator = createEditorSaveCoordinator();
  const old = coordinator.open(projectTarget());
  const gate = deferred();
  const pending = coordinator.copyProject({ session: old, sourceStored: true, sourceId: sampleProject.id, expectedRevision: 5,
    write: async () => { await gate.promise; return { persistenceRevision: 6 }; } });
  const reopened = coordinator.open(projectTarget());
  gate.resolve();
  await pending;
  assert.equal(coordinator.receipt(reopened).workspaceRevision, 5);
});

test("native legacy receipts remain unversioned and web create-only receipts become versioned", async () => {
  for (const initial of [undefined, null]) {
    const coordinator = createEditorSaveCoordinator();
    const session = coordinator.open({ ...projectTarget(), workspaceRevision: initial });
    const persistenceRevision = initial === undefined ? undefined : 8;
    const result = await coordinator.save({ session, payload: { kind: "project", project: project() }, editorRevision: 0,
      write: async () => ({ saved: true, persistenceRevision }) });
    assert.equal(result.saved, true);
    assert.equal(coordinator.receipt(session).workspaceRevision, persistenceRevision);
  }
});

test("sibling draft creation advances only an unchanged stored project's receipt and preserves queued saves", async () => {
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open(projectTarget());
  const creation = coordinator.writeAlongsideProject({ session, sourceId: project().id, sourceStored: true,
    expectedRevision: 5, write: async () => ({ persistenceRevision: 6, draftId: "new-draft" }) });
  const save = coordinator.save({ session, payload: { kind: "project", project: project() }, editorRevision: 9,
    write: async (_payload, target) => {
      assert.equal(target.workspaceRevision, 6);
      return { saved: true, persistenceRevision: 7 };
    } });
  assert.equal((await creation).draftId, "new-draft");
  assert.equal((await save).editorRevision, 9);
  assert.equal(coordinator.receipt(session).workspaceRevision, 7);
});

test("failed, stale and unsaved sibling draft creations cannot rebase a source receipt", async () => {
  for (const initial of [null, 4, 5]) {
    const coordinator = createEditorSaveCoordinator();
    const session = coordinator.open({ ...projectTarget(), workspaceRevision: initial });
    assert.equal(await coordinator.writeAlongsideProject({ session, sourceId: project().id, sourceStored: true,
      expectedRevision: 5, write: async () => null }), null);
    assert.equal(coordinator.receipt(session).workspaceRevision, initial);
    if (initial !== 5) {
      await coordinator.writeAlongsideProject({ session, sourceId: project().id, sourceStored: initial !== null,
        expectedRevision: 5, write: async () => ({ persistenceRevision: 6 }) });
      assert.equal(coordinator.receipt(session).workspaceRevision, initial);
    }
  }
});

test("draft acknowledgments require both revisions and cannot accept project-copy receipts", async () => {
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open({ kind: "draft", payloadId: "draft", designId: "design", workspaceRevision: 5, designRevision: 2 });
  for (const designRevision of [undefined, 2, 4]) {
    await assert.rejects(coordinator.save({ session, payload: { kind: "draft", draft: blank() }, editorRevision: 0,
      write: async () => ({ saved: true, persistenceRevision: 6, designRevision }) }), /revision/i);
    assert.deepEqual(coordinator.receipt(session), { kind: "draft", payloadId: "draft", designId: "design", workspaceRevision: 5, designRevision: 2 });
  }
  await assert.rejects(coordinator.copyProject({ session, sourceStored: true, sourceId: "draft", expectedRevision: 5,
    write: async () => ({ persistenceRevision: 6 }) }), /cannot advance a draft/);
});

test("invalid new targets do not retire the active editor and receipts cannot be mutated externally", () => {
  const coordinator = createEditorSaveCoordinator();
  const target = projectTarget();
  const session = coordinator.open(target);
  target.workspaceRevision = 99;
  coordinator.receipt(session).workspaceRevision = 88;
  assert.equal(coordinator.receipt(session).workspaceRevision, 5);
  assert.throws(() => coordinator.open({ ...target, workspaceRevision: -1 }), /invalid/);
  assert.equal(coordinator.isCurrent(session), true);
  const other = coordinator.open(projectTarget());
  coordinator.retire(session);
  assert.equal(coordinator.isCurrent(other), true);
});

async function draftRepository() {
  const values = new Map<string, string>();
  let lostAcknowledgment = false;
  let tail: Promise<unknown> = Promise.resolve();
  const locks: WorkspaceLocks = { request<T>(_name: string, _options: { mode: "exclusive" }, write: () => T | PromiseLike<T>): Promise<T> {
    const result = tail.then(write);
    tail = result.catch(() => undefined);
    return result.then(value => { if (lostAcknowledgment) { lostAcknowledgment = false; throw new Error("Lost acknowledgment"); } return value; });
  } };
  const api = createVersionedProjectRepository({ getStorage: () => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); } }), getLocks: () => locks }).versionedWorkspace!;
  const now = "2026-09-26T00:00:00Z";
  await api.readAsync();
  await api.executeAsync(0, { type: "create_client", now, id: "client", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Client" } });
  await api.executeAsync(1, { type: "create_project_with_initial_field_map", now, input: {
    clientId: "client", projectId: "folder", projectName: "Field", projectCrs: "EPSG:32613", unitSystem: "metric", fieldMapId: "field",
  } });
  await api.executeAsync(2, { type: "create_design_draft", now, designId: "design", fieldMapId: "field", name: "Draft", draft: blank() });
  const loaded = await api.readDesignAsync("design");
  assert.equal(loaded.kind, "draft");
  if (loaded.kind !== "draft") throw new Error("Expected draft");
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open({ kind: "draft", payloadId: loaded.draft.id, designId: loaded.design.id,
    workspaceRevision: loaded.workspaceRevision, designRevision: loaded.design.revision });
  const write = async (payload: EditorSavePayload, target: EditorSaveTarget) => {
    if (payload.kind !== "draft" || target.kind !== "draft") throw new Error("Expected draft writer");
    const receipt = await api.executeAsync(target.workspaceRevision, { type: "save_design_draft", now,
      designId: target.designId, expectedDesignRevision: target.designRevision, draft: payload.draft });
    return { saved: true, persistenceRevision: receipt.workspace.revision,
      designRevision: receipt.workspace.catalog.designs.find(item => item.id === target.designId)!.revision };
  };
  return { api, values, coordinator, session, write, draft: loaded.draft, loseNextAcknowledgment: () => { lostAcknowledgment = true; } };
}

test("draft reducer saves use actual versioned repository receipts, not undo revisions", async () => {
  const { coordinator, session, write, draft, api } = await draftRepository();
  let editor = createDesignDraftEditorState(draft);
  editor = reduceDesignDraftEditorState(editor, { type: "set_crs", projectCrs: "EPSG:32613" });
  editor = reduceDesignDraftEditorState(editor, { type: "set_machine", machine: { spanLengthsMeters: [null, 25] } });
  const first = coordinator.save({ session, payload: { kind: "draft", draft: editor.draft }, editorRevision: editor.revision, write });
  editor = reduceDesignDraftEditorState(editor, { type: "insert_boundary_vertex", index: 0, point: { x: 500000, y: 4400000 } });
  const second = coordinator.save({ session, payload: { kind: "draft", draft: editor.draft }, editorRevision: editor.revision, write });
  editor = reduceDesignDraftEditorState(editor, { type: "undo" });
  const third = coordinator.save({ session, payload: { kind: "draft", draft: editor.draft }, editorRevision: editor.revision, write });
  assert.equal((await first).editorRevision, 2);
  assert.equal((await second).editorRevision, 3);
  assert.equal((await third).editorRevision, 4);
  const reopened = await api.readDesignAsync("design");
  assert.ok(reopened.kind === "draft");
  assert.deepEqual(reopened.draft, editor.draft);
  assert.equal(reopened.design.revision, 3);
  assert.equal(reopened.workspaceRevision, 6);
  assert.deepEqual(reopened.draft.machine.spanLengthsMeters, [null, 25]);
});

test("paused drawing saves snapshot vertices and preferences before later resumed edits", async () => {
  const { coordinator, session, write, draft, api } = await draftRepository();
  let editor = reduceDesignDraftEditorState(createDesignDraftEditorState(draft), { type: "set_crs", projectCrs: "EPSG:32613" });
  const drawing = (command: DraftDrawingCommand) => {
    editor = reduceDesignDraftEditorState(editor, { type: "drawing", expectedRevision: editor.revision, command });
    assert.equal(editor.lastError, null);
  };
  drawing({ type: "begin", id: "boundary", name: "Field boundary", geometryType: "Polygon" });
  drawing({ type: "append_vertex", id: "boundary", vertex: {
    point: { x: 500000, y: 4400000 }, recordedAt: "2026-09-27T00:00:00Z", wgs84: null, elevation: null,
  } });
  drawing({ type: "set_autosave", enabled: false });
  drawing({ type: "pause", id: "boundary" });
  const paused = structuredClone(editor.draft);
  const gate = deferred();
  const pending = coordinator.save({ session, payload: { kind: "draft", draft: editor.draft }, editorRevision: editor.revision,
    write: async (payload, target) => { await gate.promise; return write(payload, target); } });
  drawing({ type: "resume", id: "boundary" });
  drawing({ type: "append_vertex", id: "boundary", vertex: {
    point: { x: 500010, y: 4400000 }, recordedAt: "2026-09-27T00:00:01Z", wgs84: null, elevation: null,
  } });
  gate.resolve();
  const receipt = await pending;
  assert.notEqual(receipt.editorRevision, editor.revision);
  const reopened = await api.readDesignAsync("design");
  assert.ok(reopened.kind === "draft");
  assert.deepEqual(reopened.draft, paused);
  assert.equal(reopened.draft.drawingWorkflow!.activeCaptureId, null);
  assert.equal(reopened.draft.drawingWorkflow!.autosaveEnabled, false);
  assert.equal(reopened.draft.drawingWorkflow!.captures[0].vertices.length, 1);
  await coordinator.save({ session, payload: { kind: "draft", draft: editor.draft }, editorRevision: editor.revision, write });
  const latest = await api.readDesignAsync("design");
  assert.ok(latest.kind === "draft");
  assert.deepEqual(latest.draft, editor.draft);
});

test("lost acknowledgment cannot silently rebase or overwrite with the next queued draft save", async () => {
  const { coordinator, session, write, draft, api, values, loseNextAcknowledgment } = await draftRepository();
  loseNextAcknowledgment();
  const first = coordinator.save({ session, payload: { kind: "draft", draft: { ...draft, name: "Committed without acknowledgment" } }, editorRevision: 1, write });
  const failed = assert.rejects(first, /Lost acknowledgment/);
  const second = coordinator.save({ session, payload: { kind: "draft", draft: { ...draft, name: "Must not overwrite" } }, editorRevision: 2, write });
  const conflict = assert.rejects(second, /revision changed/);
  await failed;
  const committed = values.get(WEB_WORKSPACE_KEY);
  await conflict;
  assert.equal(values.get(WEB_WORKSPACE_KEY), committed);
  assert.equal(coordinator.receipt(session).workspaceRevision, 3);
  const reread = await api.readDesignAsync("design");
  assert.ok(reread.kind === "draft");
  assert.equal(reread.draft.name, "Committed without acknowledgment");
  assert.equal(reread.workspaceRevision, 4);
});

async function retainedProjectRepository(owned = true) {
  const { api, values } = await draftRepository();
  const now = "2026-09-28T12:00:00.000Z";
  if (owned) await api.executeAsync(3, { type: "create_project_with_initial_design", now,
    input: { clientId: "client", project: project(), fieldMapId: "source-field", designId: "source-design" } });
  else await api.executeAsync(3, { type: "save_project", now, project: project(), createOnly: true });
  const coordinator = createEditorSaveCoordinator();
  const session = coordinator.open({ ...projectTarget(4), designId: owned ? "source-design" : null });
  const read = () => api.readAsync();
  const write = async (payload: EditorSavePayload, target: EditorSaveTarget) => {
    assert.equal(payload.kind, "project"); assert.equal(target.kind, "project");
    if (payload.kind !== "project" || target.kind !== "project" || typeof target.workspaceRevision !== "number") throw new Error("Expected saved project fixture");
    const receipt = await api.executeAsync(target.workspaceRevision, target.designId
      ? { type: "save_design_project", now, designId: target.designId, project: payload.project }
      : { type: "save_project", now, project: payload.project, createOnly: false });
    return { saved: true, persistenceRevision: receipt.workspace.revision };
  };
  const sibling = async (id: string) => {
    const snapshot = await read();
    return api.executeAsync(snapshot.revision, { type: "create_client", now, id,
      input: { primaryContactFirstName: "Sibling", primaryContactLastName: id } });
  };
  return { api, values, now, coordinator, session, read, write, sibling };
}

test("retained project proof advances only workspace receipt after multiple sibling writes, preserving session and dirty snapshot", async () => {
  for (const owned of [false, true]) {
    const f = await retainedProjectRepository(owned);
    const baseline = await f.coordinator.captureRetainedProject({ session: f.session, read: f.read });
    assert.equal(baseline.sourceStored, true); assert.equal(baseline.workspaceRevision, 4);
    const dirty = project(); dirty.pivotCenter.x += 0.125; const beforeDirty = structuredClone(dirty);
    await f.sibling("first-sibling"); await f.sibling("second-sibling");
    const before = f.values.get(WEB_WORKSPACE_KEY);
    assert.equal(await f.coordinator.reconcileRetainedProject({ baseline, read: f.read }), true);
    assert.equal(f.coordinator.isCurrent(f.session), true); assert.equal(f.coordinator.receipt(f.session).workspaceRevision, 6);
    assert.deepEqual(dirty, beforeDirty); assert.equal(f.values.get(WEB_WORKSPACE_KEY), before);
    // A repeated visible-return check is harmless; it does not create another session or save.
    assert.equal(await f.coordinator.reconcileRetainedProject({ baseline, read: f.read }), true);
    await f.coordinator.save({ session: f.session, payload: { kind: "project", project: dirty }, editorRevision: 9, write: f.write });
    assert.equal(f.coordinator.receipt(f.session).workspaceRevision, 7);
    const stored = (await f.read()).projectDocuments.find(item => item.summary.id === dirty.id)!;
    assert.deepEqual(JSON.parse(stored.document).project.pivotCenter, dirty.pivotCenter);
  }
});

test("retained project capture drains accepted saves and reconciliation orders the next save after its read", async () => {
  const f = await retainedProjectRepository(); const saveGate = deferred(); let reads = 0;
  const latest = { ...project(), name: "Acknowledged before capture" };
  const save = f.coordinator.save({ session: f.session, payload: { kind: "project", project: latest }, editorRevision: 1,
    write: async (payload, target) => { await saveGate.promise; return f.write(payload, target); } });
  const capture = f.coordinator.captureRetainedProject({ session: f.session, read: async () => { reads++; return f.read(); } });
  await Promise.resolve(); assert.equal(reads, 0);
  saveGate.resolve(); await save;
  const baseline = await capture; assert.equal(reads, 1); assert.equal(baseline.workspaceRevision, 5);
  await f.sibling("new-customer"); const readGate = deferred();
  const reconcile = f.coordinator.reconcileRetainedProject({ baseline, read: async () => { await readGate.promise; return f.read(); } });
  let nextSaveStarted = false;
  const nextSave = f.coordinator.save({ session: f.session, payload: { kind: "project", project: { ...latest, name: "Later unsaved edit" } }, editorRevision: 2,
    write: async (payload, target) => { nextSaveStarted = true; assert.equal(target.workspaceRevision, 6); return f.write(payload, target); } });
  await Promise.resolve(); assert.equal(nextSaveStarted, false);
  readGate.resolve(); await reconcile; await nextSave;
  assert.equal(f.coordinator.receipt(f.session).workspaceRevision, 7);
});

test("source edit, deletion, equal-byte revision and field/customer ownership drift cannot rebase a retained project", async () => {
  const variants = ["edit", "delete", "same_bytes_revision", "field_move", "customer_move", "source_whitespace"] as const;
  for (const variant of variants) {
    const f = await retainedProjectRepository();
    const baseline = await f.coordinator.captureRetainedProject({ session: f.session, read: f.read });
    const originalReceipt = f.coordinator.receipt(f.session);
    if (variant === "edit" || variant === "same_bytes_revision") {
      await f.api.executeAsync(4, { type: "save_design_project", now: f.now, designId: "source-design", project: variant === "edit" ? { ...project(), name: "Other editor" } : project() });
    } else if (variant === "delete") {
      await f.api.executeAsync(4, { type: "delete_design", now: f.now, designId: "source-design", expectedDesignRevision: 0 });
    } else if (variant === "customer_move") {
      await f.sibling("destination");
      await f.api.executeAsync(5, { type: "move_project_to_client", now: f.now, projectId: project().id, clientId: "destination" });
    } else {
      const snapshot = await f.read();
      if (variant === "field_move") snapshot.catalog.designs.find(item => item.id === "source-design")!.fieldMapId = "field";
      else snapshot.projectDocuments.find(item => item.summary.id === project().id)!.document += "\n";
      snapshot.revision++;
      f.values.set(WEB_WORKSPACE_KEY, JSON.stringify(snapshot));
    }
    const before = f.values.get(WEB_WORKSPACE_KEY);
    await assert.rejects(f.coordinator.reconcileRetainedProject({ baseline, read: f.read }), /changed|removed|ownership/i, variant);
    assert.deepEqual(f.coordinator.receipt(f.session), originalReceipt);
    assert.equal(f.values.get(WEB_WORKSPACE_KEY), before);
  }
});

test("an absent unsaved sample stays create-only and refuses an identity saved or reserved elsewhere", async () => {
  for (const collision of [false, true, "folder", "tombstone"] as const) {
    const f = await retainedProjectRepository();
    const sampleId = "unsaved-sample";
    const session = f.coordinator.open({ kind: "project", payloadId: sampleId, designId: null, workspaceRevision: null });
    const baseline = await f.coordinator.captureRetainedProject({ session, read: f.read });
    assert.equal(baseline.sourceStored, false);
    if (collision === true || collision === "tombstone") {
      await f.api.executeAsync(4, { type: "save_project", now: f.now, createOnly: true, project: { ...project(), id: sampleId } });
      if (collision === "tombstone") await f.api.executeAsync(5, { type: "delete_project", now: f.now, projectId: sampleId });
    } else if (collision === "folder") {
      await f.api.executeAsync(4, { type: "create_project_record", now: f.now, input: { id: sampleId, clientId: "client", name: "Reserved", projectCrs: "EPSG:32613", unitSystem: "metric" } });
    } else await f.sibling("unrelated");
    if (collision) await assert.rejects(f.coordinator.reconcileRetainedProject({ baseline, read: f.read }), /saved or reserved/i);
    else assert.equal(await f.coordinator.reconcileRetainedProject({ baseline, read: f.read }), true);
    assert.equal(f.coordinator.receipt(session).workspaceRevision, null);
  }
});

test("retained proof rejects foreign tokens, stale capture, native sessions and invalid snapshots without touching receipts", async () => {
  const f = await retainedProjectRepository();
  const baseline = await f.coordinator.captureRetainedProject({ session: f.session, read: f.read });
  await assert.rejects(f.coordinator.reconcileRetainedProject({ baseline: { ...baseline }, read: f.read }), /not owned/i);
  await f.sibling("newer");
  await assert.rejects(f.coordinator.captureRetainedProject({ session: f.session, read: f.read }), /workspace changed/i);
  const invalid = await f.read(); invalid.catalog.designs.find(item => item.id === "source-design")!.fieldMapId = "missing";
  await assert.rejects(f.coordinator.reconcileRetainedProject({ baseline, read: async () => invalid }), /reference|invalid/i);
  assert.equal(f.coordinator.receipt(f.session).workspaceRevision, 4);
  const native = f.coordinator.open({ ...projectTarget(), workspaceRevision: undefined }); let read = false;
  await assert.rejects(f.coordinator.captureRetainedProject({ session: native, read: async () => { read = true; return f.read(); } }), /versioned/i);
  assert.equal(read, false);
});

test("receipt changes after capture and same-ID reopen during either read cannot bless obsolete state", async () => {
  const f = await retainedProjectRepository();
  const baseline = await f.coordinator.captureRetainedProject({ session: f.session, read: f.read });
  await f.coordinator.save({ session: f.session, payload: { kind: "project", project: project() }, editorRevision: 1, write: f.write });
  await assert.rejects(f.coordinator.reconcileRetainedProject({ baseline, read: f.read }), /receipt changed/i);
  for (const operation of ["capture", "reconcile"] as const) {
    const g = await retainedProjectRepository();
    const proof = await g.coordinator.captureRetainedProject({ session: g.session, read: g.read });
    const gate = deferred(); let started!: () => void; const didStart = new Promise<void>(resolve => { started = resolve; });
    const read = async () => { started(); await gate.promise; return g.read(); };
    const pending = operation === "capture" ? g.coordinator.captureRetainedProject({ session: g.session, read })
      : g.coordinator.reconcileRetainedProject({ baseline: proof, read });
    const rejected = assert.rejects(pending, /replaced/i);
    await didStart;
    const reopened = g.coordinator.open({ ...projectTarget(4), designId: "source-design" });
    gate.resolve(); await rejected;
    assert.equal(g.coordinator.receipt(reopened).workspaceRevision, 4); assert.equal(g.coordinator.isCurrent(reopened), true);
  }
});

test("a concurrent write after proof read still meets the normal save revision conflict gate", async () => {
  const f = await retainedProjectRepository();
  const baseline = await f.coordinator.captureRetainedProject({ session: f.session, read: f.read });
  await f.sibling("first");
  await f.coordinator.reconcileRetainedProject({ baseline, read: async () => { const snapshot = await f.read(); await f.sibling("after-read"); return snapshot; } });
  assert.equal(f.coordinator.receipt(f.session).workspaceRevision, 5);
  await assert.rejects(f.coordinator.save({ session: f.session, payload: { kind: "project", project: { ...project(), name: "Do not overwrite" } }, editorRevision: 1, write: f.write }), /revision changed/i);
  assert.equal(f.coordinator.receipt(f.session).workspaceRevision, 5);
});
