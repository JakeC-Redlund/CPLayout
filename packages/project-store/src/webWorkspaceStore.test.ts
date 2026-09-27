import assert from "node:assert/strict";
import test from "node:test";
import { sampleProject, serializeProjectDocument } from "@cplayout/core";
import { ensureCatalogEntryForProject, emptyProjectCatalog } from "./projectCatalog";
import { migrateLegacyWorkspace } from "./legacyWorkspaceMigration";
import { deleteWorkspaceDesign, saveWorkspaceDesign, WorkspaceDocumentError, type WorkspaceDocument } from "./workspaceDocument";
import {
  createWebWorkspaceStore, LEGACY_CATALOG_KEY, LEGACY_PROJECTS_KEY, WEB_WORKSPACE_BACKUP_KEY,
  WEB_WORKSPACE_KEY, WEB_WORKSPACE_LOCK, WebWorkspaceStoreError, type WorkspaceLocks,
} from "./webWorkspaceStore";

const now = "2026-09-17T00:00:00.000Z";
function legacy() {
  const document = `\n ${serializeProjectDocument(sampleProject)}\n`;
  const summary = { id: sampleProject.id, name: sampleProject.name, projectCrs: sampleProject.projectCrs, unitSystem: sampleProject.unitSystem, updatedAt: now };
  return { projectsRaw: JSON.stringify({ [sampleProject.id]: { summary, document } }),
    catalogRaw: JSON.stringify(ensureCatalogEntryForProject(emptyProjectCatalog(), sampleProject)) };
}

class MemoryStorage {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  failKey?: string;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failKey === key) throw new Error("Synthetic quota failure");
    this.values.set(key, value);
    this.writes.push(key);
  }
}

// Models cooperative serialization for unit tests, not browser Web Locks proof.
class SerialLocks implements WorkspaceLocks {
  private tail: Promise<unknown> = Promise.resolve();
  failAck = false;
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>): Promise<T> {
    assert.equal(name, WEB_WORKSPACE_LOCK);
    assert.equal(options.mode, "exclusive");
    const result = this.tail.then(callback);
    this.tail = result.catch(() => undefined);
    return result.then(value => {
      if (this.failAck) { this.failAck = false; throw new Error("Synthetic lost acknowledgment"); }
      return value;
    });
  }
}

function fixture(sources = legacy()) {
  const storage = new MemoryStorage();
  storage.values.set(LEGACY_PROJECTS_KEY, sources.projectsRaw);
  storage.values.set(LEGACY_CATALOG_KEY, sources.catalogRaw);
  const locks = new SerialLocks();
  const dependencies = { getStorage: () => storage, getLocks: () => locks };
  return { storage, locks, store: createWebWorkspaceStore(dependencies), second: createWebWorkspaceStore(dependencies) };
}

function save(workspace: WorkspaceDocument): WorkspaceDocument {
  const design = workspace.catalog.designs[0];
  return saveWorkspaceDesign(workspace, { designId: design.id, expectedRevision: design.revision,
    document: workspace.projectDocuments[0].document + " ", updatedAt: now });
}

test("legacy migration preserves exact documents, labels and contacts without inventing catalog entries", () => {
  const sources = legacy();
  const next = migrateLegacyWorkspace(sources);
  const old = JSON.parse(sources.catalogRaw);
  assert.equal(next.projectDocuments[0].document, JSON.parse(sources.projectsRaw)[sampleProject.id].document);
  assert.deepEqual(next.catalog.clients, old.clients);
  assert.deepEqual(next.catalog.projects, old.projects);
  assert.deepEqual(next.catalog.fieldMaps, old.fieldMaps);
  assert.deepEqual(next.catalog.designs, old.designs.map((entry: object) => ({ ...entry, kind: "project", revision: 0 })));
  const uncataloged = migrateLegacyWorkspace({ ...sources, catalogRaw: null });
  assert.equal(uncataloged.projectDocuments.length, 1);
  assert.deepEqual(uncataloged.catalog, emptyProjectCatalog());
  assert.deepEqual(migrateLegacyWorkspace({ projectsRaw: null, catalogRaw: null }).catalog, emptyProjectCatalog());
});

test("known legacy client aliases and absent optional contact fields migrate without normalization", () => {
  const sources = legacy();
  const old = JSON.parse(sources.catalogRaw);
  const client = old.clients[0];
  const minimal = { id: client.id, displayName: "  Exact label  ", sortName: "  Exact sort  ", createdAt: client.createdAt, updatedAt: client.updatedAt };
  const catalogRaw = JSON.stringify({ customers: [minimal], projects: old.projects.map(({ clientId, ...entry }: { clientId: string }) => ({ ...entry, customerId: clientId })), fieldMaps: old.fieldMaps, designs: old.designs });
  const next = migrateLegacyWorkspace({ ...sources, catalogRaw });
  assert.equal(next.catalog.clients[0].displayName, minimal.displayName);
  assert.equal(next.catalog.clients[0].companyName, "");
  assert.equal(next.catalog.clients[0].primaryContactFirstName, "");
  assert.equal(next.catalog.projects[0].clientId, client.id);
});

test("reserved object-key spellings cannot disappear during legacy migration", () => {
  for (const id of ["__proto__", "constructor", "prototype"]) {
    const project = { ...sampleProject, id };
    const document = serializeProjectDocument(project);
    const summary = { id, name: project.name, projectCrs: project.projectCrs, unitSystem: project.unitSystem, updatedAt: now };
    const projectsRaw = JSON.stringify(Object.fromEntries([[id, { summary, document }]]));
    const migrated = migrateLegacyWorkspace({ projectsRaw, catalogRaw: null });
    assert.equal(migrated.projectDocuments.length, 1);
    assert.equal(migrated.projectDocuments[0].summary.id, id);
    assert.equal(migrated.projectDocuments[0].document, document);
  }
  const sources = legacy();
  const catalog = JSON.parse(sources.catalogRaw);
  catalog.clients[0] = JSON.parse(JSON.stringify(catalog.clients[0]).replace(/^\{/, '{"__proto__":"must not disappear",'));
  assert.throws(() => migrateLegacyWorkspace({ ...sources, catalogRaw: JSON.stringify(catalog) }));
});

test("invalid, ambiguous, orphaned and future legacy records cannot be normalized away", () => {
  const sources = legacy();
  for (const raw of ["", "{", "null", "[]", "42"]) assert.throws(() => migrateLegacyWorkspace({ ...sources, projectsRaw: raw }));
  for (const change of [
    (catalog: any) => { catalog.futureVersion = 2; },
    (catalog: any) => { catalog.customers = catalog.clients; },
    (catalog: any) => { catalog.projects[0].customerId = catalog.projects[0].clientId; },
    (catalog: any) => { catalog.clients.push(catalog.clients[0]); },
    (catalog: any) => { catalog.designs[0].pivotProjectId = "missing"; },
    (catalog: any) => { catalog.designs[0].revision = 12; },
    (catalog: any) => { catalog.designs.push({ ...catalog.designs[0], id: "second-owner" }); },
    (catalog: any) => { catalog.clients[0].unknownPrivateField = "do not discard"; },
  ]) {
    const catalog = JSON.parse(sources.catalogRaw);
    change(catalog);
    assert.throws(() => migrateLegacyWorkspace({ ...sources, catalogRaw: JSON.stringify(catalog) }), WorkspaceDocumentError);
  }
  const projects = JSON.parse(sources.projectsRaw);
  projects[sampleProject.id].summary.name = "wrong";
  assert.throws(() => migrateLegacyWorkspace({ ...sources, projectsRaw: JSON.stringify(projects) }), WorkspaceDocumentError);
});

test("duplicate JSON members including escaped keys cannot discard migration records", () => {
  const sources = legacy();
  for (const duplicate of ['"clients"', '"clien\\u0074s"']) {
    const catalogRaw = sources.catalogRaw.replace(/^\{/, `{${duplicate}:[],`);
    assert.throws(() => migrateLegacyWorkspace({ ...sources, catalogRaw }), WorkspaceDocumentError);
  }
  const entry = JSON.parse(sources.projectsRaw)[sampleProject.id];
  const key = JSON.stringify(sampleProject.id);
  const projectsRaw = `{${key}:${JSON.stringify(entry)},${key}:${JSON.stringify(entry)}}`;
  assert.throws(() => migrateLegacyWorkspace({ ...sources, projectsRaw }), WorkspaceDocumentError);
  entry.document = entry.document.replace(/\{/, '{"project":null,');
  assert.throws(() => migrateLegacyWorkspace({ ...sources, projectsRaw: JSON.stringify({ [sampleProject.id]: entry }) }), WorkspaceDocumentError);
});

test("initialization preserves both legacy strings, writes backup first and is retry-idempotent", async () => {
  const { storage, store } = fixture();
  const originals = [...storage.values];
  const first = await store.initializeAsync();
  assert.deepEqual(storage.writes, [WEB_WORKSPACE_BACKUP_KEY, WEB_WORKSPACE_KEY, WEB_WORKSPACE_BACKUP_KEY]);
  const backup = JSON.parse(storage.getItem(WEB_WORKSPACE_BACKUP_KEY)!);
  assert.equal(backup.projectsRaw, originals[0][1]);
  assert.equal(backup.catalogRaw, originals[1][1]);
  assert.deepEqual(await store.initializeAsync(), first);
  assert.deepEqual(await store.readAsync(), first);
  assert.equal(backup.state, "committed");
  assert.equal(storage.writes.length, 3);
  for (const [key, value] of originals) assert.equal(storage.getItem(key), value);
  first.catalog.clients[0].displayName = "detached";
  assert.notEqual((await store.readAsync()).catalog.clients[0].displayName, "detached");
});

test("failed backup or workspace commit never alters originals or claims initialization", async () => {
  for (const failed of [WEB_WORKSPACE_BACKUP_KEY, WEB_WORKSPACE_KEY]) {
    const { storage, store } = fixture();
    const originals = [...storage.values];
    storage.failKey = failed;
    await assert.rejects(store.initializeAsync(), /quota/);
    assert.equal(storage.getItem(WEB_WORKSPACE_KEY), null);
    for (const [key, value] of originals) assert.equal(storage.getItem(key), value);
    if (failed === WEB_WORKSPACE_BACKUP_KEY) assert.deepEqual(storage.writes, []);
    else assert.deepEqual(storage.writes, [WEB_WORKSPACE_BACKUP_KEY]);
    storage.failKey = undefined;
    await store.initializeAsync();
    assert.equal(storage.writes.filter(key => key === WEB_WORKSPACE_BACKUP_KEY).length, 2);
  }
});

test("corrupt source and conflicting recovery backup refuse without any write", async () => {
  for (const kind of ["corrupt", "backup"]) {
    const { storage, store } = fixture();
    if (kind === "corrupt") storage.values.set(LEGACY_PROJECTS_KEY, "{broken");
    else storage.values.set(WEB_WORKSPACE_BACKUP_KEY, "original recovery evidence");
    const before = [...storage.values];
    await assert.rejects(store.initializeAsync());
    assert.deepEqual([...storage.values], before);
    assert.deepEqual(storage.writes, []);
  }
});

test("two participating instances serialize latest reads and reject a stale expected revision", async () => {
  const { storage, store, second } = fixture();
  await store.initializeAsync();
  const results = await Promise.allSettled([store.transactAsync(0, save), second.transactAsync(0, save)]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  const current = await second.readAsync();
  assert.equal(current.revision, 1);
  assert.equal(current.catalog.designs[0].revision, 1);
  assert.equal(storage.writes.filter(key => key === WEB_WORKSPACE_KEY).length, 2);
  await second.transactAsync(current.revision, save);
  assert.equal((await store.readAsync()).revision, 2);
});

test("quota, bad transition, invalid revision and newer schemas leave the exact envelope unchanged", async () => {
  const { storage, store } = fixture();
  await store.initializeAsync();
  const original = storage.getItem(WEB_WORKSPACE_KEY);
  storage.failKey = WEB_WORKSPACE_KEY;
  await assert.rejects(store.transactAsync(0, save), /quota/);
  storage.failKey = undefined;
  for (const revision of [NaN, Infinity, -1, 0.5, 1]) await assert.rejects(store.transactAsync(revision, save));
  await assert.rejects(store.transactAsync(0, value => value), /advance exactly/);
  await assert.rejects(store.transactAsync(0, value => { value.catalog.clients = []; return { ...value, revision: 1 }; }));
  assert.equal(storage.getItem(WEB_WORKSPACE_KEY), original);
  const future = original!.replace("cplayout-workspace-v1", "cplayout-workspace-v99");
  storage.values.set(WEB_WORKSPACE_KEY, future);
  await assert.rejects(store.initializeAsync(), /unsupported/);
  await assert.rejects(store.readAsync(), /unsupported/);
  await assert.rejects(store.transactAsync(0, save), /unsupported/);
  assert.equal(storage.getItem(WEB_WORKSPACE_KEY), future);
});

test("deletion commits document and design tombstones together and rejects stale resurrection", async () => {
  const { store } = fixture();
  await store.initializeAsync();
  const deleted = await store.transactAsync(0, value => deleteWorkspaceDesign(value, { designId: value.catalog.designs[0].id, expectedRevision: 0, deletedAt: now }));
  assert.equal(deleted.tombstones.length, 2);
  assert.equal(deleted.projectDocuments.length, 0);
  assert.equal(deleted.catalog.designs.length, 0);
  await assert.rejects(store.transactAsync(0, save), /revision changed/);
  assert.deepEqual(await store.readAsync(), deleted);
});

test("unavailable locking or storage and throwing storage access do not report empty success", async () => {
  for (const dependencies of [
    { getStorage: () => new MemoryStorage(), getLocks: () => undefined },
    { getStorage: () => undefined, getLocks: () => new SerialLocks() },
    { getStorage: (): MemoryStorage => { throw new Error("SecurityError"); }, getLocks: () => new SerialLocks() },
  ]) {
    const store = createWebWorkspaceStore(dependencies);
    await assert.rejects(store.initializeAsync());
    await assert.rejects(store.readAsync());
    await assert.rejects(store.transactAsync(0, save));
  }
  await assert.rejects(fixture().store.readAsync(), error => error instanceof WebWorkspaceStoreError && error.code === "not_initialized");
});

test("an observed old-writer change or missing backup blocks saves and preserves both stores", async () => {
  for (const key of [LEGACY_PROJECTS_KEY, LEGACY_CATALOG_KEY, WEB_WORKSPACE_BACKUP_KEY]) {
    const { storage, store } = fixture();
    await store.initializeAsync();
    storage.values.set(key, "changed independently");
    const before = [...storage.values];
    await assert.rejects(store.readAsync(), /Reconcile/);
    await assert.rejects(store.transactAsync(0, save), /Reconcile/);
    assert.deepEqual([...storage.values], before);
  }
});

test("lost acknowledgment cannot cause blind retry to overwrite the committed revision", async () => {
  const { locks, store } = fixture();
  await store.initializeAsync();
  locks.failAck = true;
  await assert.rejects(store.transactAsync(0, save), /acknowledgment/);
  assert.equal((await store.readAsync()).revision, 1);
  await assert.rejects(store.transactAsync(0, save), /revision changed/);
});

test("a missing committed workspace cannot remigrate and resurrect deleted data", async () => {
  const { store, storage } = fixture();
  await store.initializeAsync();
  await store.transactAsync(0, value => deleteWorkspaceDesign(value, { designId: value.catalog.designs[0].id, expectedRevision: 0, deletedAt: now }));
  storage.values.delete(WEB_WORKSPACE_KEY);
  const before = [...storage.values];
  await assert.rejects(store.initializeAsync(), /recover the missing workspace/);
  assert.deepEqual([...storage.values], before);
});

test("a failed final migration receipt blocks editing until initialization finishes", async () => {
  const { store, storage } = fixture();
  const write = storage.setItem.bind(storage);
  storage.setItem = (key, value) => {
    if (key === WEB_WORKSPACE_BACKUP_KEY && JSON.parse(value).state === "committed") throw new Error("receipt quota");
    write(key, value);
  };
  await assert.rejects(store.initializeAsync(), /receipt quota/);
  const original = storage.getItem(WEB_WORKSPACE_KEY);
  assert.notEqual(original, null);
  await assert.rejects(store.readAsync(), /Reconcile/);
  await assert.rejects(store.transactAsync(0, save), /Reconcile/);
  storage.setItem = write;
  assert.equal((await store.initializeAsync()).revision, 0);
  assert.equal(storage.getItem(WEB_WORKSPACE_KEY), original);
  await store.transactAsync(0, save);
});

test("an unfinished receipt cannot certify a workspace different from its migration", async () => {
  const { store, storage } = fixture();
  await store.initializeAsync();
  const receipt = JSON.parse(storage.getItem(WEB_WORKSPACE_BACKUP_KEY)!);
  receipt.state = "prepared";
  storage.values.set(WEB_WORKSPACE_BACKUP_KEY, JSON.stringify(receipt));
  const current = JSON.parse(storage.getItem(WEB_WORKSPACE_KEY)!);
  current.revision = 1;
  storage.values.set(WEB_WORKSPACE_KEY, JSON.stringify(current));
  const before = [...storage.values];
  await assert.rejects(store.initializeAsync(), /differs from its source/);
  assert.deepEqual([...storage.values], before);
});

test("transactions cannot erase or rewrite history or drop documents without tombstones", async () => {
  const { store, storage } = fixture();
  const original = await store.initializeAsync();
  await assert.rejects(store.transactAsync(0, value => {
    value.revision++;
    value.catalog.designs = [];
    value.projectDocuments = [];
    return value;
  }), /requires? its deletion tombstone/);
  const deleted = await store.transactAsync(0, value => deleteWorkspaceDesign(value, { designId: value.catalog.designs[0].id, expectedRevision: 0, deletedAt: now }));
  const before = storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(store.transactAsync(1, () => ({ ...original, revision: 2 })), /deletion history/);
  await assert.rejects(store.transactAsync(1, value => {
    value.revision++;
    value.tombstones[0].deletedAt = "2026-09-18T00:00:00.000Z";
    return value;
  }), /deletion history/);
  assert.equal(storage.getItem(WEB_WORKSPACE_KEY), before);
  assert.deepEqual(await store.readAsync(), deleted);
});

test("recovery exports opaque original bytes even when migration cannot parse them", async () => {
  const { store, storage } = fixture();
  storage.values.set(LEGACY_PROJECTS_KEY, "\n{incomplete private source");
  const before = [...storage.values];
  await assert.rejects(store.initializeAsync());
  const recovery = JSON.parse(await store.exportRecoveryAsync());
  assert.equal(recovery.recoveryVersion, "cplayout-workspace-recovery-v1");
  assert.equal(recovery.consistency, "cooperative_lock");
  assert.equal(recovery.projectsRaw, storage.getItem(LEGACY_PROJECTS_KEY));
  assert.equal(recovery.catalogRaw, storage.getItem(LEGACY_CATALOG_KEY));
  assert.equal(recovery.workspaceRaw, null);
  assert.deepEqual([...storage.values], before);
});

test("recovery without Web Locks is explicitly best-effort and cannot enable writes", async () => {
  const storage = new MemoryStorage();
  storage.values.set(WEB_WORKSPACE_KEY, "malformed envelope preserved");
  storage.values.set(WEB_WORKSPACE_BACKUP_KEY, "original backup preserved");
  const store = createWebWorkspaceStore({ getStorage: () => storage, getLocks: () => undefined });
  const recovery = JSON.parse(await store.exportRecoveryAsync());
  assert.equal(recovery.consistency, "unlocked_best_effort");
  assert.equal(recovery.workspaceRaw, storage.getItem(WEB_WORKSPACE_KEY));
  assert.equal(recovery.backupRaw, storage.getItem(WEB_WORKSPACE_BACKUP_KEY));
  await assert.rejects(store.initializeAsync(), /locking is unavailable/);
  assert.deepEqual(storage.writes, []);
});
