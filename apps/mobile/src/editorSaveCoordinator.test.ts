import assert from "node:assert/strict";
import test from "node:test";
import { createDesignDraftEditorState, defaultProjectSettings, reduceDesignDraftEditorState, sampleProject, type DesignDraft } from "@cplayout/core";
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
