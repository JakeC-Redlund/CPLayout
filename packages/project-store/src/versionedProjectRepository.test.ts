import assert from "node:assert/strict";
import test from "node:test";
import { defaultProjectSettings, sampleProject, serializeProjectDocument, type DesignDraft } from "@cplayout/core";
import { createVersionedProjectRepository, workspaceDesignCatalog } from "./versionedProjectRepository";
import { WEB_WORKSPACE_BACKUP_KEY, WEB_WORKSPACE_KEY, LEGACY_PROJECTS_KEY, LEGACY_CATALOG_KEY, type WorkspaceLocks } from "./webWorkspaceStore";
import { emptyProjectCatalog, ensureCatalogEntryForProject } from "./projectCatalog";
import type { WorkspaceCommand } from "./workspaceCommands";
import { WorkspaceDocumentError } from "./workspaceDocument";

const now = "2026-09-17T00:00:00.000Z";
class MemoryStorage {
  values = new Map<string, string>();
  writes: string[] = [];
  failKey?: string;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (key === this.failKey) throw new Error("Synthetic quota failure");
    this.values.set(key, value); this.writes.push(key);
  }
}
class Locks implements WorkspaceLocks {
  private tail: Promise<unknown> = Promise.resolve();
  failAcknowledgment = false;
  request<T>(_name: string, _options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>): Promise<T> {
    const next = this.tail.then(callback);
    this.tail = next.catch(() => undefined);
    return next.then(value => {
      if (this.failAcknowledgment) { this.failAcknowledgment = false; throw new Error("Lost acknowledgment"); }
      return value;
    });
  }
}
function fixture() {
  const storage = new MemoryStorage(), locks = new Locks();
  const dependencies = { getStorage: () => storage, getLocks: () => locks };
  const repository = createVersionedProjectRepository(dependencies);
  return { storage, locks, repository, api: repository.versionedWorkspace!, second: createVersionedProjectRepository(dependencies).versionedWorkspace! };
}
const save = (createOnly = true): WorkspaceCommand => ({ type: "save_project", project: structuredClone(sampleProject), createOnly, now });

test("copy commits exactly once with revision and quota guards, preserving every original byte", async () => {
  const { api, storage } = fixture();
  await api.readAsync();
  const source = (await api.executeAsync(0, save())).workspace;
  const command: WorkspaceCommand = { type: "copy_project", now, source: structuredClone(sampleProject), sourceStored: true,
    newProjectId: "synthetic-copy", name: "Copy" };
  const before = [...storage.values];
  await assert.rejects(api.executeAsync(0, command), /revision changed/);
  assert.deepEqual([...storage.values], before);
  storage.failKey = WEB_WORKSPACE_KEY;
  await assert.rejects(api.executeAsync(1, command), /quota/);
  assert.deepEqual([...storage.values], before);
  storage.failKey = undefined;
  const writes = storage.writes.length;
  const result = await api.executeAsync(1, command);
  assert.equal(storage.writes.length, writes + 1);
  assert.equal(result.workspace.revision, 2);
  assert.deepEqual(result.workspace.projectDocuments[0], source.projectDocuments[0]);
  assert.deepEqual(result.workspace.catalog, source.catalog);
  assert.equal(result.workspace.projectDocuments[1].summary.id, "synthetic-copy");
  const committed = [...storage.values];
  await assert.rejects(api.executeAsync(2, command), /used or deleted/);
  assert.deepEqual([...storage.values], committed);
});

test("the web adapter initializes once and commits independent saves without invented catalog ownership", async () => {
  const { api, repository, storage } = fixture();
  assert.equal((await api.readAsync()).revision, 0);
  const before = storage.writes.length;
  const saved = await api.executeAsync(0, save());
  assert.equal(saved.workspace.revision, 1);
  assert.equal(storage.writes.length, before + 1);
  assert.equal(storage.writes.at(-1), WEB_WORKSPACE_KEY);
  assert.deepEqual(saved.workspace.catalog, { clients: [], projects: [], fieldMaps: [], designs: [] });
  assert.equal(storage.getItem(LEGACY_PROJECTS_KEY), null);
  assert.equal((await repository.loadProjectAsync(sampleProject.id))?.id, sampleProject.id);
  assert.equal((await repository.listProjectsAsync()).length, 1);
  assert.equal((await repository.getBackendInfoAsync()).projectCount, 1);
});

test("all legacy-shaped web writes fail closed without a revision or storage mutation", async () => {
  const { repository, storage } = fixture();
  for (const method of ["saveProjectAsync", "saveDesignProjectAsync", "deleteProjectAsync", "createClientAsync", "updateClientAsync", "deleteClientAsync",
    "createProjectWithInitialDesignAsync", "createProjectWithInitialFieldMapAsync", "createProjectRecordAsync", "renameProjectAsync",
    "moveProjectToClientAsync", "createFieldMapRecordAsync", "createDesignRecordAsync"] as const) {
    await assert.rejects(() => (repository[method] as () => Promise<unknown>)(), /original workspace revision/);
  }
  assert.equal(storage.values.size, 0);
});

test("two adapter instances cannot overwrite the same loaded revision", async () => {
  const { api, second } = fixture();
  await api.readAsync();
  const results = await Promise.allSettled([api.executeAsync(0, save()), second.executeAsync(0, save())]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failed = results.find(result => result.status === "rejected");
  assert.ok(failed?.status === "rejected" && /revision changed/.test(String(failed.reason)));
  const current = await second.readAsync();
  assert.equal(current.revision, 1);
  assert.equal(current.projectDocuments.length, 1);
  await second.executeAsync(current.revision, { type: "save_project", project: { ...sampleProject, name: "Explicit reopened edit" }, createOnly: false, now });
  assert.equal((await api.readAsync()).revision, 2);
});

test("command payload is captured before awaiting a lock and receipts are detached", async () => {
  const { api } = fixture();
  await api.readAsync();
  const project = structuredClone(sampleProject);
  const command: WorkspaceCommand = { type: "save_project", project, createOnly: true, now };
  const pending = api.executeAsync(0, command);
  project.name = "Mutated while pending";
  const receipt = await pending;
  assert.equal(receipt.workspace.projectDocuments[0].summary.name, sampleProject.name);
  receipt.workspace.projectDocuments[0].summary.name = "Mutated receipt";
  assert.equal((await api.readAsync()).projectDocuments[0].summary.name, sampleProject.name);
});

test("invalid command and quota failure preserve exact payload, catalog and backup", async () => {
  const { api, storage } = fixture();
  await api.readAsync();
  const before = [...storage.values];
  await assert.rejects(api.executeAsync(0, { ...save(), extraField: true } as unknown as WorkspaceCommand));
  storage.failKey = WEB_WORKSPACE_KEY;
  await assert.rejects(api.executeAsync(0, save()), /quota/);
  assert.deepEqual([...storage.values], before);
  storage.failKey = undefined;
  assert.equal((await api.executeAsync(0, save())).workspace.revision, 1);
});

test("successful creates are create-only and deletion cannot be undone by stale save or recreate", async () => {
  const { api } = fixture();
  await api.readAsync();
  await api.executeAsync(0, save());
  await assert.rejects(api.executeAsync(1, save()));
  await api.executeAsync(1, { type: "delete_project", projectId: sampleProject.id, now });
  await assert.rejects(api.executeAsync(1, save(false)), /revision changed/);
  await assert.rejects(api.executeAsync(2, save(false)), /no longer exists/);
  await assert.rejects(api.executeAsync(2, save()));
  const deleted = await api.readAsync();
  assert.equal(deleted.revision, 2);
  assert.equal(deleted.projectDocuments.length, 0);
  assert.equal(deleted.tombstones.length, 1);
});

test("lost acknowledgments require an explicit read and cannot cause a blind save retry", async () => {
  const { api, locks } = fixture();
  await api.readAsync();
  locks.failAcknowledgment = true;
  await assert.rejects(api.executeAsync(0, save()), /acknowledgment/);
  await assert.rejects(api.executeAsync(0, save()), /revision changed/);
  assert.equal((await api.readAsync()).revision, 1);
});

test("legacy payload bytes migrate unchanged and remain exportable after later corruption", async () => {
  const { api, storage } = fixture();
  const document = `\n ${serializeProjectDocument(sampleProject)}\n`;
  const source = JSON.stringify({ [sampleProject.id]: { document, summary: {
    id: sampleProject.id, name: sampleProject.name, projectCrs: sampleProject.projectCrs, unitSystem: sampleProject.unitSystem, updatedAt: now,
  } } });
  storage.values.set(LEGACY_PROJECTS_KEY, source);
  const migrated = await api.readAsync();
  assert.equal(migrated.projectDocuments[0].document, document);
  assert.equal(storage.getItem(LEGACY_PROJECTS_KEY), source);
  const backup = storage.getItem(WEB_WORKSPACE_BACKUP_KEY);
  storage.values.set(WEB_WORKSPACE_KEY, "{damaged workspace");
  await assert.rejects(api.readAsync());
  const evidence = JSON.parse(await api.exportRecoveryAsync());
  assert.equal(evidence.workspaceRaw, "{damaged workspace");
  assert.equal(evidence.backupRaw, backup);
  assert.equal(evidence.projectsRaw, source);
});

for (const owned of [false, true]) {
  for (const location of ["wrapper", "machine", "vertex"] as const) {
    test(`loaded ${owned ? "owned" : "standalone"} project cannot discard stored ${location} extensions`, async () => {
      const { api, repository, storage } = fixture();
      const source = JSON.parse(serializeProjectDocument(sampleProject));
      const target = location === "wrapper" ? source : location === "machine" ? source.project.machine : source.project.fieldBoundary[0];
      target.extension = { retained: "synthetic unknown data" };
      const document = JSON.stringify(source);
      storage.values.set(LEGACY_PROJECTS_KEY, JSON.stringify({ [sampleProject.id]: { document, summary: {
        id: sampleProject.id, name: sampleProject.name, projectCrs: sampleProject.projectCrs, unitSystem: sampleProject.unitSystem, updatedAt: now,
      } } }));
      if (owned) storage.values.set(LEGACY_CATALOG_KEY, JSON.stringify(ensureCatalogEntryForProject(emptyProjectCatalog(), sampleProject)));
      const workspace = await api.readAsync();
      const loaded = (await repository.loadProjectAsync(sampleProject.id))!;
      const before = [...storage.values];
      const command: WorkspaceCommand = owned
        ? { type: "save_design_project", designId: workspace.catalog.designs[0].id, project: { ...loaded, name: "Edited" }, now }
        : { type: "save_project", project: { ...loaded, name: "Edited" }, createOnly: false, now };
      await assert.rejects(api.executeAsync(workspace.revision, command), /Stored project contains unsupported fields/);
      assert.deepEqual([...storage.values], before);
      assert.equal((await api.readAsync()).projectDocuments[0].document, document);
      assert.equal(JSON.parse(await api.exportRecoveryAsync()).workspaceRaw, storage.getItem(WEB_WORKSPACE_KEY));
    });
  }
}

test("legacy bare projects with omitted defaulted fields remain editable", async () => {
  const { api, repository, storage } = fixture();
  const bare = JSON.parse(serializeProjectDocument(sampleProject)).project;
  delete bare.wgs84Companion;
  delete bare.settings;
  storage.values.set(LEGACY_PROJECTS_KEY, JSON.stringify({ [sampleProject.id]: { document: JSON.stringify(bare), summary: {
    id: sampleProject.id, name: sampleProject.name, projectCrs: sampleProject.projectCrs, unitSystem: sampleProject.unitSystem, updatedAt: now,
  } } }));
  const workspace = await api.readAsync();
  const project = (await repository.loadProjectAsync(sampleProject.id))!;
  const receipt = await api.executeAsync(workspace.revision, { type: "save_project", project: { ...project, name: "Edited" }, createOnly: false, now });
  assert.equal(receipt.workspace.projectDocuments[0].summary.name, "Edited");
});

function blankDraft(): DesignDraft {
  const settings = defaultProjectSettings();
  delete settings.aerialImagery.sourcePackageId;
  return { id: "draft-payload", name: "Incomplete field", projectCrs: null, unitSystem: settings.unitSystem, settings,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}

async function draftFixture() {
  const state = fixture();
  await state.api.readAsync();
  await state.api.executeAsync(0, { type: "create_client", now, id: "client", input: {
    primaryContactFirstName: "Synthetic", primaryContactLastName: "Client",
  } });
  await state.api.executeAsync(1, { type: "create_project_with_initial_design", now, input: {
    clientId: "client", project: structuredClone(sampleProject), fieldMapId: "field", designId: "legacy-design",
  } });
  return state;
}

const createDraft = (draft = blankDraft()): WorkspaceCommand => ({
  type: "create_design_draft", now, designId: "draft-design", fieldMapId: "field", name: "Unfinished Design", draft,
});

test("draft-aware reads retain mixed catalog kinds and open zero, one and two vertices without invented inputs", async () => {
  const { api, repository } = await draftFixture();
  const before = await api.readAsync();
  const created = await api.executeAsync(before.revision, createDraft());
  assert.equal(created.workspace.revision, before.revision + 1);
  const mixed = workspaceDesignCatalog(created.workspace);
  assert.equal(mixed.designs.length, 2);
  assert.deepEqual(new Set(mixed.designs.map(item => item.kind)), new Set(["project", "draft"]));
  mixed.designs[0].name = "Caller mutation";
  assert.notEqual(workspaceDesignCatalog(created.workspace).designs[0].name, "Caller mutation");
  // A legacy consumer must not mistake an incomplete document for a runnable project.
  await assert.rejects(repository.listProjectCatalogAsync(), /draft-aware catalog/);
  assert.equal((await repository.loadProjectAsync(sampleProject.id))?.id, sampleProject.id);
  const legacy = await api.readDesignAsync("legacy-design");
  assert.equal(legacy.kind, "project");
  assert.equal(legacy.document, before.projectDocuments[0].document);
  for (const count of [0, 1, 2]) {
    const loaded = await api.readDesignAsync("draft-design");
    assert.equal(loaded.kind, "draft");
    if (loaded.kind !== "draft") throw new Error("Expected draft read");
    assert.equal(loaded.draft.fieldBoundary.length, count);
    assert.equal(loaded.draft.pivotCenter, null);
    assert.equal(loaded.draft.waterSource, null);
    assert.equal(loaded.draft.powerSource, null);
    assert.deepEqual(loaded.draft.machine, {});
    assert.equal(loaded.design.revision, count);
    assert.equal(loaded.workspaceRevision, 3 + count);
    assert.deepEqual(loaded.context, { clientId: "client", projectId: sampleProject.id, fieldMapId: "field", designId: "draft-design" });
    if (count < 2) {
      loaded.draft.projectCrs = "EPSG:32613";
      loaded.draft.fieldBoundary.push({ x: 500000 + count, y: 4500000 + count });
      const saved = await api.executeAsync(loaded.workspaceRevision, { type: "save_design_draft", now,
        designId: loaded.design.id, expectedDesignRevision: loaded.design.revision, draft: loaded.draft });
      assert.equal(saved.workspace.projectDocuments[0].document, before.projectDocuments[0].document);
    }
  }
  assert.deepEqual(await api.readDesignAsync("missing"), { kind: "not_found", workspaceRevision: 5 });
});

test("draft saves reject stale workspace and design receipts and require explicit reload", async () => {
  const { api, second, storage } = await draftFixture();
  await api.executeAsync(2, createDraft());
  const loaded = await api.readDesignAsync("draft-design");
  assert.equal(loaded.kind, "draft");
  if (loaded.kind !== "draft") throw new Error("Expected draft");
  const saveDraft: WorkspaceCommand = { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0,
    draft: { ...loaded.draft, name: "Accepted change" } };
  const results = await Promise.allSettled([api.executeAsync(3, saveDraft), second.executeAsync(3, saveDraft)]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  const before = [...storage.values];
  await assert.rejects(api.executeAsync(4, saveDraft), /revision changed/);
  assert.deepEqual([...storage.values], before);
  const reopened = await second.readDesignAsync("draft-design");
  assert.equal(reopened.kind, "draft");
  if (reopened.kind !== "draft") throw new Error("Expected draft");
  assert.equal(reopened.design.revision, 1);
  const receipt = await second.executeAsync(reopened.workspaceRevision, { ...saveDraft, expectedDesignRevision: reopened.design.revision });
  assert.equal(receipt.workspace.revision, 5);
});

test("draft create, save and delete quota failures are atomic and retryable without recreating deleted identities", async () => {
  const { api, storage } = await draftFixture();
  const commands: WorkspaceCommand[] = [createDraft(),
    { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0,
      draft: { ...blankDraft(), machine: { spanLengthsMeters: [null, 45, null] } } },
    { type: "delete_design", now, designId: "draft-design", expectedDesignRevision: 1 }];
  for (const [index, command] of commands.entries()) {
    const before = [...storage.values];
    storage.failKey = WEB_WORKSPACE_KEY;
    await assert.rejects(api.executeAsync(2 + index, command), /quota/);
    assert.deepEqual([...storage.values], before);
    storage.failKey = undefined;
    const writes = storage.writes.length;
    const receipt = await api.executeAsync(2 + index, command);
    assert.equal(storage.writes.length, writes + 1);
    assert.equal(receipt.workspace.revision, 3 + index);
  }
  assert.deepEqual(await api.readDesignAsync("draft-design"), { kind: "not_found", workspaceRevision: 5 });
  const deleted = [...storage.values];
  await assert.rejects(api.executeAsync(5, commands[1]), (error: unknown) => error instanceof WorkspaceDocumentError && error.code === "not_found");
  await assert.rejects(api.executeAsync(5, createDraft()), /used or deleted/);
  assert.deepEqual([...storage.values], deleted);
  const workspace = await api.readAsync();
  assert.equal(workspace.catalog.designs.length, 1);
  assert.equal(workspace.catalog.designs[0].id, "legacy-design");
  assert.equal(workspace.tombstones.length, 2);
});

test("draft commands capture input before locks and lost acknowledgments cannot trigger blind retries", async () => {
  const { api, locks, storage } = await draftFixture();
  const draft = blankDraft();
  draft.projectCrs = "EPSG:32613";
  draft.fieldBoundary = [{ x: 12, y: 34 }];
  const pending = api.executeAsync(2, createDraft(draft));
  draft.fieldBoundary[0].x = 99;
  draft.machine.spanLengthsMeters = [100];
  const receipt = await pending;
  receipt.workspace.draftDocuments[0].document = "invalid caller mutation";
  const read = await api.readDesignAsync("draft-design");
  if (read.kind !== "draft") throw new Error("Expected draft");
  assert.deepEqual(read.draft.fieldBoundary, [{ x: 12, y: 34 }]);
  assert.deepEqual(read.draft.machine, {});
  read.draft.name = "Save with lost acknowledgment";
  const command: WorkspaceCommand = { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0, draft: read.draft };
  locks.failAcknowledgment = true;
  await assert.rejects(api.executeAsync(3, command), /acknowledgment/);
  const committed = [...storage.values];
  await assert.rejects(api.executeAsync(3, command), /revision changed/);
  await assert.rejects(api.executeAsync(4, command), /revision changed/);
  assert.deepEqual([...storage.values], committed);
  const recovered = await api.readDesignAsync("draft-design");
  if (recovered.kind !== "draft") throw new Error("Expected draft");
  assert.equal(recovered.design.revision, 1);
  assert.equal(recovered.draft.name, "Save with lost acknowledgment");
});

test("draft-aware project opens refuse unknown fields while exact recovery bytes remain available", async () => {
  const { api, storage } = fixture();
  const raw = JSON.parse(serializeProjectDocument(sampleProject));
  raw.project.machine.extension = { retain: true };
  const document = JSON.stringify(raw);
  storage.values.set(LEGACY_PROJECTS_KEY, JSON.stringify({ [sampleProject.id]: { document, summary: {
    id: sampleProject.id, name: sampleProject.name, projectCrs: sampleProject.projectCrs, unitSystem: sampleProject.unitSystem, updatedAt: now,
  } } }));
  storage.values.set(LEGACY_CATALOG_KEY, JSON.stringify(ensureCatalogEntryForProject(emptyProjectCatalog(), sampleProject)));
  const workspace = await api.readAsync();
  const before = [...storage.values];
  await assert.rejects(api.readDesignAsync(workspace.catalog.designs[0].id), /unsupported fields/);
  assert.deepEqual([...storage.values], before);
  assert.equal((await api.readAsync()).projectDocuments[0].document, document);
  assert.equal(JSON.parse(await api.exportRecoveryAsync()).workspaceRaw, storage.getItem(WEB_WORKSPACE_KEY));
});
