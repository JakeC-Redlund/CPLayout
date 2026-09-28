import assert from "node:assert/strict";
import test from "node:test";
import { convertPivotProjectToFieldDesign, sampleProject, serializeProjectDocument } from "@cplayout/core";
import { applyWorkspaceCommand, parseWorkspaceCommand, type WorkspaceCommand } from "./workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument, parseWorkspaceDocument, parseV1WorkspaceDocument,
  validateWorkspaceDocument, WorkspaceDocumentError, type WorkspaceDocument } from "./workspaceDocument";
import { createVersionedProjectRepository, readWorkspaceDesign, workspaceProjectCatalog } from "./versionedProjectRepository";
import { createWebWorkspaceStore, WEB_WORKSPACE_KEY, WEB_WORKSPACE_LOCK, type WorkspaceLocks } from "./webWorkspaceStore";
import { assertNativeWorkspaceVersion, createSqliteWorkspaceStore, NativeWorkspaceCommandRefusal } from "./sqliteWorkspaceStore";

const now = "2026-09-27T12:00:00.000Z";
const original = `\n ${serializeProjectDocument(sampleProject)} \n`;
function field() {
  const field = convertPivotProjectToFieldDesign(original, { fieldId: "field-payload", waterSourceId: "water", powerSourceId: "power" }).field;
  field.machines.push({ ...structuredClone(field.machines[0]), id: "second", pivotCenter: { x: 501300, y: 4506400 },
    configuration: { ...structuredClone(field.machines[0].configuration), name: "Small pivot", spanLengthsMeters: [30, 35, 40] } });
  return field;
}
function apply(workspace: WorkspaceDocument, command: WorkspaceCommand) { return applyWorkspaceCommand(workspace, command).workspace; }
function fixture() {
  let workspace = apply(emptyWorkspaceDocument(), { type: "create_client", now, id: "client", input: { primaryContactFirstName: "Test", primaryContactLastName: "Client" } });
  workspace = apply(workspace, { type: "create_project_with_initial_design", now,
    input: { clientId: "client", project: sampleProject, designId: "legacy", fieldMapId: "map" } });
  workspace.projectDocuments[0].document = original;
  return workspace;
}
function upgraded() { return apply(fixture(), { type: "upgrade_workspace_to_v2", now }); }
function created() { return apply(upgraded(), { type: "create_field_design", now, designId: "field", fieldMapId: "map", name: "Two pivots", field: field() }); }
function rejects(workspace: WorkspaceDocument, command: WorkspaceCommand) {
  const before = serializeWorkspaceDocument(workspace);
  assert.throws(() => apply(workspace, command), WorkspaceDocumentError);
  assert.equal(serializeWorkspaceDocument(workspace), before);
}
class MemoryStorage {
  values = new Map<string, string>(); failWrite = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.failWrite && key === WEB_WORKSPACE_KEY) throw new Error("interrupted write"); this.values.set(key, value); }
}
class SerialLocks implements WorkspaceLocks {
  tail: Promise<unknown> = Promise.resolve(); failAck = false;
  request<T>(name: string, _options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>): Promise<T> {
    assert.equal(name, WEB_WORKSPACE_LOCK);
    const next = this.tail.then(callback); this.tail = next.catch(() => undefined);
    return next.then(value => { if (this.failAck) { this.failAck = false; throw new Error("lost acknowledgement"); } return value; });
  }
}

test("v1 stays unchanged until explicit version upgrade and the v1 reader refuses v2", () => {
  const before = fixture();
  rejects(before, { type: "create_field_design", now, designId: "field", fieldMapId: "map", name: "Two", field: field() });
  const next = apply(before, { type: "upgrade_workspace_to_v2", now });
  assert.equal(next.workspaceVersion, "cplayout-workspace-v2");
  assert.equal(next.originalV1Document, serializeWorkspaceDocument(before));
  assert.deepEqual(next.projectDocuments, before.projectDocuments);
  assert.deepEqual(next.catalog, before.catalog);
  assert.equal(next.revision, before.revision + 1);
  assert.throws(() => parseV1WorkspaceDocument(serializeWorkspaceDocument(next)), /v2-aware/);
  assert.deepEqual(parseWorkspaceDocument(serializeWorkspaceDocument(next)), next);
  rejects(next, { type: "upgrade_workspace_to_v2", now });
  for (const invalid of [{ ...next, workspaceVersion: "cplayout-workspace-v1" }, { ...next, originalV1Document: "{}" },
    { ...next, originalV1Document: JSON.stringify(next) }, { ...next, fieldDocuments: undefined }, { ...before, unknown: true }]) {
    assert.throws(() => validateWorkspaceDocument(invalid));
  }
});

test("unequal pivots survive save reopen copy and delete without crossing payload kinds", () => {
  const before = created();
  const changed = field(); changed.machines[1].configuration.spanLengthsMeters[0] = 45;
  const saved = apply(before, { type: "save_field_design", now, designId: "field", expectedDesignRevision: 0, field: changed });
  const reopened = readWorkspaceDesign(parseWorkspaceDocument(serializeWorkspaceDocument(saved)), "field");
  assert.equal(reopened.kind, "field"); if (reopened.kind !== "field") return;
  assert.deepEqual(reopened.field, changed);
  assert.notDeepEqual(reopened.field.machines[0].configuration.spanLengthsMeters, reopened.field.machines[1].configuration.spanLengthsMeters);
  assert.deepEqual(saved.projectDocuments, before.projectDocuments);
  const copy = apply(saved, { type: "copy_field_design", now, sourceDesignId: "field", expectedDesignRevision: 1,
    designId: "copy-design", fieldMapId: "map", fieldId: "copy-payload", name: "Copy" });
  const copied = readWorkspaceDesign(copy, "copy-design");
  assert.equal(copied.kind, "field"); if (copied.kind !== "field") return;
  assert.deepEqual(copied.field.machines, changed.machines);
  assert.equal(copied.field.id, "copy-payload");
  const deleted = apply(copy, { type: "delete_design", now, designId: "field", expectedDesignRevision: 1 });
  assert.equal(readWorkspaceDesign(deleted, "field").kind, "not_found");
  assert.equal(readWorkspaceDesign(deleted, "copy-design").kind, "field");
  assert.ok(deleted.tombstones.some(item => item.entity === "field_document" && item.id === changed.id));
  rejects(deleted, { type: "save_field_design", now, designId: "field", expectedDesignRevision: 1, field: changed });
  rejects(deleted, { type: "create_field_design", now, designId: "other", fieldMapId: "map", name: "Reuse", field: changed });
  assert.throws(() => workspaceProjectCatalog(saved), /version-aware/);
});

test("field saves and complete plan adoption reject stale versions, duplicates, pinned movement and dangling references without partial commits", () => {
  const workspace = created(); const originalField = field();
  rejects(workspace, { type: "save_field_design", now, designId: "field", expectedDesignRevision: 5, field: originalField });
  const moved = structuredClone(originalField.machines); moved[0].pivotCenter.x += 1;
  for (const machines of [moved, [originalField.machines[0], originalField.machines[0]],
    [...originalField.machines, { ...structuredClone(originalField.machines[0]), id: "third", waterSourceId: "missing" }]]) {
    rejects(workspace, { type: "adopt_field_plan", now, designId: "field", expectedDesignRevision: 0, machines });
  }
  rejects(workspace, { type: "adopt_field_plan", now, designId: "field", expectedDesignRevision: 2, machines: originalField.machines });
  const adopted = apply(workspace, { type: "adopt_field_plan", now, designId: "field", expectedDesignRevision: 0,
    machines: moved, allowedReplacementMachineIds: [moved[0].id] });
  assert.equal(adopted.revision, workspace.revision + 1);
  assert.equal(adopted.catalog.designs.find(item => item.id === "field")!.revision, 1);
  const captured = parseWorkspaceCommand({ type: "adopt_field_plan", now, designId: "field", expectedDesignRevision: 0, machines: originalField.machines });
  originalField.machines[0].pivotCenter.x += 999;
  assert.deepEqual(apply(workspace, captured).fieldDocuments, workspace.fieldDocuments);
});

test("explicit conversion and copies preserve original project bytes and never infer another machine", () => {
  const before = upgraded();
  const converted = apply(before, { type: "convert_project_to_field_design", now, sourceDesignId: "legacy", expectedDesignRevision: 0,
    designId: "converted", fieldMapId: "map", name: "Converted", fieldId: "new-field", waterSourceId: "water", powerSourceId: "power" });
  assert.deepEqual(converted.projectDocuments, before.projectDocuments);
  const read = readWorkspaceDesign(converted, "converted");
  assert.equal(read.kind, "field"); if (read.kind !== "field") return;
  assert.equal(read.originalProjectDocument, original);
  assert.equal(read.field.machines.length, 1);
  const copy = apply(converted, { type: "copy_field_design", now, sourceDesignId: "converted", expectedDesignRevision: 0,
    designId: "copy", fieldMapId: "map", fieldId: "copied", name: "Copy" });
  assert.equal(copy.fieldDocuments!.find(item => item.id === "copied")!.originalProjectDocument, original);
  const removed = apply(copy, { type: "delete_project", now, projectId: sampleProject.id });
  assert.deepEqual(removed.fieldDocuments, []);
  assert.equal(removed.tombstones.filter(item => item.entity === "field_document").length, 2);
});

test("web atomic upgrade retains exact original bytes and recovers both failed writes and lost acknowledgements", async () => {
  const storage = new MemoryStorage(); const locks = new SerialLocks(); const dependencies = { getStorage: () => storage, getLocks: () => locks };
  const repo = createVersionedProjectRepository(dependencies).versionedWorkspace!;
  await repo.readAsync();
  const originalV1 = ` \n${serializeWorkspaceDocument(fixture())}\n `;
  storage.values.set(WEB_WORKSPACE_KEY, originalV1);
  const revision = fixture().revision;
  storage.failWrite = true;
  await assert.rejects(repo.executeAsync(revision, { type: "upgrade_workspace_to_v2", now }), /interrupted/);
  assert.equal(storage.getItem(WEB_WORKSPACE_KEY), originalV1);
  storage.failWrite = false; locks.failAck = true;
  await assert.rejects(repo.executeAsync(revision, { type: "upgrade_workspace_to_v2", now }), /acknowledgement/);
  const restored = await createVersionedProjectRepository(dependencies).versionedWorkspace!.readAsync();
  assert.equal(restored.originalV1Document, originalV1);
  assert.equal(restored.workspaceVersion, "cplayout-workspace-v2");
  await assert.rejects(repo.executeAsync(revision, { type: "upgrade_workspace_to_v2", now }), /revision changed/);
  const created = await repo.executeAsync(restored.revision, { type: "create_field_design", now, designId: "field", fieldMapId: "map", name: "Two", field: field() });
  const opened = await repo.readDesignAsync("field"); assert.equal(opened.kind, "field");
  if (opened.kind === "field") assert.deepEqual(opened.field, field());
  const store = createWebWorkspaceStore(dependencies);
  await assert.rejects(store.transactAsync(created.workspace.revision, latest => ({ ...latest, revision: latest.revision + 1, originalV1Document: originalV1 + " " })), /cannot downgrade/);
  const recovery = JSON.parse(await repo.exportRecoveryAsync());
  assert.equal(JSON.parse(recovery.workspaceRaw).originalV1Document, originalV1);
});

test("native v1 adapter explicitly refuses field activation before any database access", async () => {
  assert.doesNotThrow(() => assertNativeWorkspaceVersion(fixture()));
  assert.throws(() => assertNativeWorkspaceVersion(upgraded()), /separately verified/);
  let touched = false;
  const store = createSqliteWorkspaceStore({ openAsync: async () => { touched = true; throw new Error("must not open"); } } as never);
  await assert.rejects(store.executeAsync(0, { type: "upgrade_workspace_to_v2", now }), NativeWorkspaceCommandRefusal);
  assert.equal(touched, false);
});

test("web competing field saves have one winner and source-retention history cannot be replaced", async () => {
  const storage = new MemoryStorage(); const locks = new SerialLocks(); const dependencies = { getStorage: () => storage, getLocks: () => locks };
  const repo = createVersionedProjectRepository(dependencies).versionedWorkspace!;
  await repo.readAsync();
  const initial = apply(upgraded(), { type: "create_field_design", now, designId: "field", fieldMapId: "map", name: "Two", field: field(), originalProjectDocument: original });
  storage.values.set(WEB_WORKSPACE_KEY, serializeWorkspaceDocument(initial));
  const left = field(); left.machines[0].configuration.name = "Left";
  const right = field(); right.machines[1].configuration.name = "Right";
  const second = createVersionedProjectRepository(dependencies).versionedWorkspace!;
  const outcomes = await Promise.allSettled([
    repo.executeAsync(initial.revision, { type: "save_field_design", now, designId: "field", expectedDesignRevision: 0, field: left }),
    second.executeAsync(initial.revision, { type: "save_field_design", now, designId: "field", expectedDesignRevision: 0, field: right }),
  ]);
  assert.deepEqual(outcomes.map(item => item.status), ["fulfilled", "rejected"]);
  const winner = await second.readDesignAsync("field");
  assert.equal(winner.kind, "field"); if (winner.kind !== "field") return;
  assert.deepEqual(winner.field, left);
  assert.equal(winner.originalProjectDocument, original);
  const store = createWebWorkspaceStore(dependencies);
  await assert.rejects(store.transactAsync(winner.workspaceRevision, latest => {
    latest.revision++; latest.fieldDocuments![0].originalProjectDocument = original + " "; return latest;
  }), /cannot remove or rewrite/);
  assert.equal((await second.readAsync()).fieldDocuments![0].originalProjectDocument, original);
});

test("workspace field save copy and pivot adoption preserve v3 lateral equipment exactly", () => {
  const value = field();
  value.lateralMachines = [{ id: "lateral", kind: "straight_lateral", name: "Exact lateral",
    leftExtentMeters: 31.125, rightExtentMeters: 57.375, travelHeadingDegrees: 0,
    travel: { start: { x: 501200, y: 4506400 }, end: { x: 501350, y: 4506400 } },
    machineClearanceBufferMeters: 2.25, waterSourceId: "water" }];
  const workspace = apply(upgraded(), { type: "create_field_design", now, designId: "lateral-field", fieldMapId: "map", name: "Mixed field", field: value });
  const loaded = readWorkspaceDesign(parseWorkspaceDocument(serializeWorkspaceDocument(workspace)), "lateral-field");
  assert.equal(loaded.kind, "field");
  if (loaded.kind !== "field") throw new Error("Missing field");
  assert.deepEqual(loaded.field, value);
  const copied = apply(workspace, { type: "copy_field_design", now, sourceDesignId: "lateral-field", expectedDesignRevision: 0,
    designId: "lateral-copy", fieldMapId: "map", fieldId: "copied-field", name: "Copied mixed field" });
  const copy = readWorkspaceDesign(copied, "lateral-copy");
  assert.equal(copy.kind, "field");
  if (copy.kind !== "field") throw new Error("Missing copy");
  assert.deepEqual(copy.field.lateralMachines, value.lateralMachines);
  const machines = structuredClone(value.machines); machines[1].configuration.name = "Changed pivot only";
  const adopted = apply(workspace, { type: "adopt_field_plan", now, designId: "lateral-field", expectedDesignRevision: 0,
    machines, allowedReplacementMachineIds: [machines[1].id] });
  const after = readWorkspaceDesign(adopted, "lateral-field");
  assert.equal(after.kind, "field");
  if (after.kind !== "field") throw new Error("Missing adopted field");
  assert.deepEqual(after.field.lateralMachines, value.lateralMachines);
});
