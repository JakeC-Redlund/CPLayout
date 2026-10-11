import assert from "node:assert/strict";
import test from "node:test";
import { sampleProject, serializeProjectDocument } from "@cplayout/core";
import { emptyProjectCatalog, ensureCatalogEntryForProject } from "./projectCatalog";
import { createVersionedProjectRepository } from "./versionedProjectRepository";
import { saveWorkspaceDesign, serializeWorkspaceDocument, WorkspaceDocumentError, type WorkspaceDocument } from "./workspaceDocument";
import { createWebWorkspaceStore, LEGACY_CATALOG_KEY, LEGACY_PROJECTS_KEY, WEB_WORKSPACE_BACKUP_KEY, WEB_WORKSPACE_KEY,
  WEB_WORKSPACE_LOCK, WebWorkspaceStoreError, type WorkspaceLocks } from "./webWorkspaceStore";

// This suite runs the actual store/repository against shared cooperative lock and
// string-storage boundaries. It does not establish real browser/native lock proof
// or integrated controller/UI recovery publication.
const now = "2026-10-11T12:00:00.000Z";
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
class SerialLocks implements WorkspaceLocks {
  private tail: Promise<unknown> = Promise.resolve();
  private requested = 0;
  private observers: Array<{ count: number; done: () => void }> = [];
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>): Promise<T> {
    assert.equal(name, WEB_WORKSPACE_LOCK); assert.equal(options.mode, "exclusive");
    this.requested++;
    this.observers = this.observers.filter(observer => { if (observer.count <= this.requested) { observer.done(); return false; } return true; });
    const result = this.tail.then(callback); this.tail = result.catch(() => undefined); return result;
  }
  count() { return this.requested; }
  waitForRequests(count: number) {
    return this.requested >= count ? Promise.resolve() : new Promise<void>(done => { this.observers.push({ count, done }); });
  }
  async hold() {
    const entered = deferred(), release = deferred();
    const completed = this.request(WEB_WORKSPACE_LOCK, { mode: "exclusive" }, async () => { entered.resolve(); await release.promise; });
    await entered.promise; return async () => { release.resolve(); await completed; };
  }
}
class MemoryStorage {
  readonly values = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: Array<{ key: string; raw: string }> = [];
  getItem(key: string) { this.reads.push(key); return this.values.get(key) ?? null; }
  setItem(key: string, raw: string) { this.writes.push({ key, raw }); this.values.set(key, raw); }
  snapshot() { return [...this.values]; }
}
function fixture() {
  const storage = new MemoryStorage(), document = `\n ${serializeProjectDocument(sampleProject)}\n\t `;
  storage.values.set(LEGACY_PROJECTS_KEY, JSON.stringify({ [sampleProject.id]: { document,
    summary: { id: sampleProject.id, name: sampleProject.name, projectCrs: sampleProject.projectCrs, unitSystem: sampleProject.unitSystem, updatedAt: now } } }));
  storage.values.set(LEGACY_CATALOG_KEY, JSON.stringify(ensureCatalogEntryForProject(emptyProjectCatalog(), sampleProject)));
  storage.values.set("cplayout-unified-edit-recovery-v1", "independent exact recovery bytes");
  storage.values.set("cplayout-unified-context-v2", "independent exact context bytes");
  const locks = new SerialLocks(), dependencies = { getStorage: () => storage, getLocks: () => locks };
  return { storage, document, locks, dependencies, store: createWebWorkspaceStore(dependencies), second: createWebWorkspaceStore(dependencies) };
}
async function initialized() {
  const f = fixture(), workspace = await f.store.initializeAsync();
  f.storage.writes.length = 0; f.storage.reads.length = 0;
  return { ...f, workspace };
}
function nextSaved(workspace: WorkspaceDocument) {
  const design = workspace.catalog.designs[0];
  return saveWorkspaceDesign(workspace, { designId: design.id, expectedRevision: design.revision,
    document: workspace.projectDocuments[0].document + " ", updatedAt: now });
}
const current = () => true;
const conflict = (error: unknown) => error instanceof WorkspaceDocumentError && error.code === "conflict";

test("successful async read lease returns the fresh exact receipt and leaves every storage byte unchanged", async () => {
  const f = await initialized(), before = f.storage.snapshot(), started = deferred(), finish = deferred();
  const lease = f.store.readLeaseAsync(f.workspace.revision, async (workspace, assertCurrent) => {
    assert.deepEqual(workspace, f.workspace); assert.equal(workspace.projectDocuments[0].document, f.document);
    started.resolve(); await finish.promise; assertCurrent(); return workspace.projectDocuments[0].document;
  }, current);
  await started.promise; assert.deepEqual(f.storage.snapshot(), before); finish.resolve();
  assert.equal(await lease, f.document); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
test("the same workspace writer lock blocks a second writer until async lease publication finishes", async () => {
  const f = await initialized(), before = f.storage.snapshot(), entered = deferred(), finish = deferred(), events: string[] = [];
  const lease = f.store.readLeaseAsync(f.workspace.revision, async (_workspace, assertCurrent) => {
    events.push("lease entered"); entered.resolve(); await finish.promise; assertCurrent(); events.push("UI publication"); return "accepted";
  }, current);
  await entered.promise; const requests = f.locks.count();
  const writer = f.second.transactAsync(f.workspace.revision, workspace => { events.push("writer transition"); return nextSaved(workspace); });
  await f.locks.waitForRequests(requests + 1);
  assert.deepEqual(events, ["lease entered"]); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
  finish.resolve(); assert.equal(await lease, "accepted"); const written = await writer;
  assert.deepEqual(events, ["lease entered", "UI publication", "writer transition"]);
  assert.equal(written.revision, f.workspace.revision + 1); assert.equal(f.storage.writes.length, 1);
  assert.equal(written.projectDocuments[0].document, f.document + " ");
});
test("a queued lease refuses a revision changed by the writer ahead of it, without calling its actor", async () => {
  const f = await initialized(), release = await f.locks.hold(); let actions = 0;
  const writer = f.second.transactAsync(f.workspace.revision, nextSaved);
  const refusal = assert.rejects(f.store.readLeaseAsync(f.workspace.revision, () => { actions++; }, current), conflict);
  await release(); const written = await writer; await refusal;
  assert.equal(actions, 0); assert.equal(f.storage.writes.length, 1);
  assert.equal(f.storage.values.get(WEB_WORKSPACE_KEY), serializeWorkspaceDocument(written));
});
test("intent retirement and mode ABA while waiting refuse before callback and leave all bytes exact", async () => {
  const f = await initialized(), before = f.storage.snapshot(), release = await f.locks.hold(); let epoch = 1, mode = "design", actions = 0;
  const reviewed = epoch;
  const refusal = assert.rejects(f.store.readLeaseAsync(f.workspace.revision, () => { actions++; }, () => epoch === reviewed && mode === "design"), conflict);
  mode = "survey"; epoch++; mode = "design"; epoch++;
  await release(); await refusal; assert.equal(actions, 0); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
test("lease refuses invalid and stale reviewed revisions without an actor call or storage write", async () => {
  const f = await initialized(), before = f.storage.snapshot(); let actions = 0;
  for (const revision of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, f.workspace.revision + 1])
    await assert.rejects(f.store.readLeaseAsync(revision, () => { actions++; }, current), conflict);
  assert.equal(actions, 0); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
test("uninitialized lease never initializes, repairs a prepared backup, or upgrades storage", async () => {
  const f = fixture(), before = f.storage.snapshot(); let actions = 0;
  await assert.rejects(f.store.readLeaseAsync(0, () => { actions++; }, current), error => error instanceof WebWorkspaceStoreError && error.code === "not_initialized");
  assert.equal(actions, 0); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
  const ready = await initialized(), backup = JSON.parse(ready.storage.values.get(WEB_WORKSPACE_BACKUP_KEY)!); backup.state = "prepared";
  ready.storage.values.set(WEB_WORKSPACE_BACKUP_KEY, JSON.stringify(backup)); const prepared = ready.storage.snapshot();
  await assert.rejects(ready.store.readLeaseAsync(ready.workspace.revision, () => { actions++; }, current), error => error instanceof WebWorkspaceStoreError && error.code === "recovery_required");
  assert.equal(actions, 0); assert.deepEqual(ready.storage.snapshot(), prepared); assert.deepEqual(ready.storage.writes, []);
});
for (const invalid of ["malformed", "future version"] as const)
test(`${invalid} saved workspace refuses the lease without actions or normalization`, async () => {
  const f = await initialized(), raw = invalid === "malformed" ? " \n{ exact corrupt workspace" : f.storage.values.get(WEB_WORKSPACE_KEY)!.replace("cplayout-workspace-v1", "cplayout-workspace-v99");
  f.storage.values.set(WEB_WORKSPACE_KEY, raw); const before = f.storage.snapshot(); let actions = 0;
  await assert.rejects(f.store.readLeaseAsync(f.workspace.revision, () => { actions++; }, current), WorkspaceDocumentError);
  assert.equal(actions, 0); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
for (const key of [WEB_WORKSPACE_BACKUP_KEY, LEGACY_PROJECTS_KEY, LEGACY_CATALOG_KEY])
test(`preexisting ${key} drift refuses admission before any actor action`, async () => {
  const f = await initialized(); f.storage.values.set(key, "independently changed exact source"); const before = f.storage.snapshot(); let actions = 0;
  await assert.rejects(f.store.readLeaseAsync(f.workspace.revision, () => { actions++; }, current), error => error instanceof WebWorkspaceStoreError && error.code === "recovery_required");
  assert.equal(actions, 0); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
test("missing locking refuses before storage acquisition; missing storage cannot invoke the actor", async () => {
  let storageAcquisitions = 0, reads = 0, actions = 0;
  const unsupported = createWebWorkspaceStore({ getLocks: () => undefined, getStorage: () => {
    storageAcquisitions++; return { getItem() { reads++; return null; }, setItem() { assert.fail("no write allowed"); } };
  } });
  await assert.rejects(unsupported.readLeaseAsync(0, () => { actions++; }, current), error => error instanceof WebWorkspaceStoreError && error.code === "unavailable");
  assert.deepEqual({ storageAcquisitions, reads, actions }, { storageAcquisitions: 0, reads: 0, actions: 0 });
  const missing = createWebWorkspaceStore({ getLocks: () => new SerialLocks(), getStorage: () => undefined });
  await assert.rejects(missing.readLeaseAsync(0, () => { actions++; }, current), error => error instanceof WebWorkspaceStoreError && error.code === "unavailable");
  assert.equal(actions, 0);
});
test("rejecting async callback releases the lock, propagates its exact error, and expires its guard", async () => {
  const f = await initialized(), before = f.storage.snapshot(), entered = deferred(), finish = deferred(), failure = new Error("actor staging refused");
  let escaped!: () => void;
  const lease = f.store.readLeaseAsync(f.workspace.revision, async (_workspace, assertCurrent) => { escaped = assertCurrent; entered.resolve(); await finish.promise; throw failure; }, current);
  const refusal = assert.rejects(lease, error => error === failure); await entered.promise;
  const waitingRead = f.second.readAsync(); finish.resolve(); await refusal; assert.deepEqual(await waitingRead, f.workspace);
  const reads = f.storage.reads.length; assert.throws(escaped, conflict); assert.equal(f.storage.reads.length, reads);
  assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
test("successful callback's escaped guard cannot authorize an effect after the lock is released", async () => {
  const f = await initialized(); let escaped!: () => void, effects = 0;
  await f.store.readLeaseAsync(f.workspace.revision, (_workspace, assertCurrent) => { escaped = assertCurrent; assertCurrent(); return "finished"; }, current);
  const before = f.storage.snapshot(), reads = f.storage.reads.length;
  assert.throws(() => { escaped(); effects++; }, conflict); assert.equal(effects, 0);
  assert.equal(f.storage.reads.length, reads); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
test("the fresh receipt is detached and recursively frozen across arrays, records and geometry", async () => {
  const f = await initialized(), before = f.storage.snapshot(); let leased!: WorkspaceDocument;
  await f.store.readLeaseAsync(f.workspace.revision, (workspace, assertCurrent) => {
    leased = workspace; assert.notEqual(workspace, f.workspace);
    // Reflect exposes refusal regardless of the test runner's strict-mode wrapper.
    assert.equal(Reflect.set(workspace, "revision", workspace.revision + 1), false);
    assert.equal(Reflect.set(workspace.catalog.clients[0], "displayName", "mutation"), false);
    assert.throws(() => { workspace.catalog.projects.push(workspace.catalog.projects[0]); }, TypeError);
    assert.equal(Reflect.set(workspace.projectDocuments[0].summary, "name", "mutation"), false);
    assert.throws(() => { workspace.projectDocuments.splice(0, 1); }, TypeError);
    assert.deepEqual(workspace, f.workspace); assertCurrent();
  }, current);
  f.workspace.catalog.clients[0].displayName = "separate caller object";
  assert.notEqual(leased.catalog.clients[0].displayName, f.workspace.catalog.clients[0].displayName);
  assert.equal(leased.projectDocuments[0].document, f.document); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
for (const key of [WEB_WORKSPACE_KEY, WEB_WORKSPACE_BACKUP_KEY, LEGACY_PROJECTS_KEY, LEGACY_CATALOG_KEY])
test(`external exact ${key} drift during async staging refuses before UI publication`, async () => {
  const f = await initialized(), entered = deferred(), finish = deferred(); let effects = 0;
  const lease = f.store.readLeaseAsync(f.workspace.revision, async (_workspace, assertCurrent) => {
    entered.resolve(); await finish.promise; assertCurrent(); effects++;
  }, current);
  const refusal = assert.rejects(lease, conflict); await entered.promise;
  // Whitespace preserves JSON meaning, so this specifically tests exact source
  // strings rather than only revision, parsed equality or logical content.
  f.storage.values.set(key, ` \n${f.storage.values.get(key)!}\t `); const changed = f.storage.snapshot();
  finish.resolve(); await refusal; assert.equal(effects, 0); assert.deepEqual(f.storage.snapshot(), changed); assert.deepEqual(f.storage.writes, []);
});
test("coherent legacy-plus-backup replacement still differs from the pinned receipt and refuses publication", async () => {
  const f = await initialized(), entered = deferred(), finish = deferred(); let effects = 0;
  const lease = f.store.readLeaseAsync(f.workspace.revision, async (_workspace, assertCurrent) => { entered.resolve(); await finish.promise; assertCurrent(); effects++; }, current);
  const refusal = assert.rejects(lease, conflict); await entered.promise;
  const replacement = f.storage.values.get(LEGACY_PROJECTS_KEY)! + " "; f.storage.values.set(LEGACY_PROJECTS_KEY, replacement);
  const backup = JSON.parse(f.storage.values.get(WEB_WORKSPACE_BACKUP_KEY)!); backup.projectsRaw = replacement;
  f.storage.values.set(WEB_WORKSPACE_BACKUP_KEY, JSON.stringify(backup)); const changed = f.storage.snapshot();
  finish.resolve(); await refusal; assert.equal(effects, 0); assert.deepEqual(f.storage.snapshot(), changed); assert.deepEqual(f.storage.writes, []);
});
test("runtime owner retirement during async staging refuses the actor's final guarded publication", async () => {
  const f = await initialized(), before = f.storage.snapshot(), entered = deferred(), finish = deferred(); let owner = true, effects = 0;
  const lease = f.store.readLeaseAsync(f.workspace.revision, async (_workspace, assertCurrent) => { entered.resolve(); await finish.promise; assertCurrent(); effects++; }, () => owner);
  const refusal = assert.rejects(lease, conflict); await entered.promise; owner = false; finish.resolve(); await refusal;
  assert.equal(effects, 0); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
});
test("published versioned repository delegates the lease without implicit initialization", async () => {
  const f = fixture(), api = createVersionedProjectRepository(f.dependencies).versionedWorkspace!;
  assert(api.readLeaseAsync); const before = f.storage.snapshot(); let effects = 0;
  await assert.rejects(api.readLeaseAsync(0, () => { effects++; }, current), error => error instanceof WebWorkspaceStoreError && error.code === "not_initialized");
  assert.equal(effects, 0); assert.deepEqual(f.storage.snapshot(), before); assert.deepEqual(f.storage.writes, []);
  const initialized = await api.readAsync(); f.storage.writes.length = 0; const ready = f.storage.snapshot();
  const value = await api.readLeaseAsync(initialized.revision, async (workspace, assertCurrent) => { await Promise.resolve(); assertCurrent(); effects++; return workspace.projectDocuments[0].document; }, current);
  assert.equal(value, f.document); assert.equal(effects, 1); assert.deepEqual(f.storage.snapshot(), ready); assert.deepEqual(f.storage.writes, []);
});
