import assert from "node:assert/strict";
import test from "node:test";
import {
  convertPivotProjectToFieldDesign, createFieldLayoutTarget, defaultProjectSettings, parseDesignDraftDocument,
  parseLayoutSessionDocument, parseProjectDocument, projectLonLatToXy, sampleProject,
  serializeDesignDraftDocument, serializeFieldDesignDocument, serializeFieldLayoutTarget, serializeLayoutSessionDocument, serializeProjectDocument,
  type DesignDraft, type LayoutObservation, type LayoutSession, type OperationalFixedGgaEvidence,
} from "@cplayout/core";
import { createSqliteWorkspaceStore, NativeWorkspaceCommandRefusal } from "./sqliteWorkspaceStore";
import { createVersionedProjectRepository } from "./versionedProjectRepository";
import { createWebWorkspaceStore, WEB_WORKSPACE_KEY, type WorkspaceLocks } from "./webWorkspaceStore";
import { parseV1WorkspaceDocument, parseV2WorkspaceDocument, parseWorkspaceDocument } from "./workspaceDocument";
import type { WorkspaceCommand } from "./workspaceCommands";
import { exportLayoutSessionArchiveZip, importLayoutSessionArchiveZip } from "./layoutSessionArchive";
import { buildProjectRecoveryArchiveBundle, exportProjectArchiveZip, importProjectArchiveZip } from "./projectArchive";
import { buildDesignDraftArchiveBundle, exportDesignDraftArchiveZip, importDesignDraftArchiveZip } from "./designDraftArchive";
import { buildFieldDesignArchiveBundle, exportFieldDesignArchiveZip, importFieldDesignArchiveZip } from "./fieldDesignArchive";

const now = "2026-09-28T12:00:00.000Z";
class MemoryStorage {
  values = new Map<string, string>(); writes = 0; fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail) throw new Error("Synthetic quota failure"); this.values.set(key, value); this.writes++; }
}
class Locks implements WorkspaceLocks {
  tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>): Promise<T> {
    const next = this.tail.then(callback); this.tail = next.catch(() => undefined); return next;
  }
}
function completeDraft(): DesignDraft {
  return parseDesignDraftDocument({ documentVersion: "design-draft-v3", draft: JSON.parse(JSON.stringify({ ...sampleProject, id: "draft", name: "Draft", settings: defaultProjectSettings() })) });
}
async function fixture() {
  const storage = new MemoryStorage(), locks = new Locks();
  const deps = { getStorage: () => storage, getLocks: () => locks };
  const api = createVersionedProjectRepository(deps).versionedWorkspace!;
  const store = createWebWorkspaceStore(deps);
  await api.readAsync(); let revision = 0;
  const execute = async (command: WorkspaceCommand) => { const receipt = await api.executeAsync(revision, command); revision = receipt.workspace.revision; return receipt; };
  await execute({ type: "create_client", id: "customer", now, input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Customer" } });
  await execute({ type: "create_project_with_initial_field_map", now, input: { clientId: "customer", projectId: "folder", projectName: "Project", projectCrs: sampleProject.projectCrs, unitSystem: "us_survey_feet", fieldMapId: "catalog-field", fieldMapName: "North field" } });
  await execute({ type: "create_design_draft", now, designId: "draft-design", fieldMapId: "catalog-field", name: "Draft", draft: completeDraft() });
  return { storage, locks, api, store, execute, revision: () => revision };
}
const completion = (draft = completeDraft()): WorkspaceCommand => ({ type: "create_complete_design_from_draft", now,
  sourceDesignId: "draft-design", expectedDesignRevision: 0, draft, designId: "complete-design", projectId: "complete", name: "Complete design" });
function targetDocument() {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "frozen-field", waterSourceId: "water", powerSourceId: "power" }).field;
  return `\n${serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 12, expectedRevision: 12, selectedMachineIds: [field.machines[0].id] }))}\n`;
}
function observation(id = "observation"): LayoutObservation {
  const payload = "GPGGA,120000.00,4000.0000,N,10500.0000,W,4,12,0.8,1600.0,M,-20.0,M,1.0,42";
  const checksum = [...payload].reduce((a,c) => a ^ c.charCodeAt(0), 0).toString(16).padStart(2,"0");
  const evidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: id, sessionId: "receiver", transport: "web_serial",
    receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", antennaReference: "unknown", coherent: true, sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GPGGA", utcTime: "120000.00", qualityCode: 4, latitude: 40, longitude: -105 },
    receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 0, provenance: "browser_serial" },
    capture: { evaluatedMonotonicMs: 1500, ageMs: 500, maxAgeMs: 2000 },
    projection: { id: `wgs84-projection-v1:${sampleProject.projectCrs}`, projectCrs: sampleProject.projectCrs }, physicalQualification: "unverified" };
  return { id, sessionId: "layout", capturedAt: now, projected: projectLonLatToXy({ latitude: 40, longitude: -105 }, sampleProject.projectCrs), evidence };
}

test("draft completion saves latest geometry and creates distinct complete identities in exactly one commit", async () => {
  const f = await fixture(); const draft = completeDraft(); draft.pivotCenter!.x += 1.125;
  const before = await f.api.readAsync(), writes = f.storage.writes;
  const receipt = await f.execute(completion(draft));
  assert.equal(f.storage.writes, writes + 1); assert.equal(receipt.workspace.revision, before.revision + 1);
  const source = receipt.workspace.catalog.designs.find(item => item.id === "draft-design")!;
  assert.equal(source.kind, "draft"); assert.equal(source.revision, 1);
  assert.deepEqual(parseDesignDraftDocument(receipt.workspace.draftDocuments[0].document), draft);
  const complete = await f.api.readDesignAsync("complete-design"); assert.equal(complete.kind, "project");
  if (complete.kind === "project") { assert.equal(complete.project.id, "complete"); assert.equal(complete.context.fieldMapId, source.fieldMapId); assert.deepEqual(complete.project.pivotCenter, draft.pivotCenter); assert.deepEqual(complete.project.fieldBoundary, draft.fieldBoundary); assert.deepEqual(complete.project.machine, { ...draft.machine, endGunAngleRanges: draft.machine.endGunAngleRanges ?? [] }); }
  const committed = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute(completion(draft)), /revision|used/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), committed);
});

test("incomplete, wrong identity, stale revisions and quota failures leave both completion outputs unchanged", async () => {
  const f = await fixture(), before = [...f.storage.values], revision = f.revision();
  const incomplete = completeDraft(); incomplete.pivotCenter = null;
  await assert.rejects(f.api.executeAsync(revision, completion(incomplete)), /incomplete/i);
  await assert.rejects(f.api.executeAsync(revision, completion({ ...completeDraft(), id: "wrong" })), /identity/i);
  await assert.rejects(f.api.executeAsync(revision - 1, completion()), /revision/i);
  await assert.rejects(f.api.executeAsync(revision, { ...completion(), expectedDesignRevision: 99 } as WorkspaceCommand), /revision/i);
  await assert.rejects(f.api.executeAsync(revision, { ...completion(), projectId: "folder" } as WorkspaceCommand), /identity.*used/i);
  await assert.rejects(f.api.executeAsync(revision, { type: "import_design_document", now, fieldMapId: "catalog-field", designId: "collision", payloadId: "folder", document: serializeProjectDocument(sampleProject) }), /identity.*used/i);
  f.storage.fail = true; await assert.rejects(f.api.executeAsync(revision, completion()), /quota/i); f.storage.fail = false;
  assert.deepEqual([...f.storage.values], before);
  await f.api.executeAsync(revision, completion());
});

test("editor/live ownership is rechecked after queued storage lock acquisition", async () => {
  const f = await fixture(), before = [...f.storage.values]; let release!: () => void, current = true;
  const hold = f.locks.request("hold", { mode: "exclusive" }, () => new Promise<void>(resolve => { release = resolve; }));
  await Promise.resolve();
  const pending = f.api.executeAsync(f.revision(), completion(), () => current);
  current = false; release(); await hold;
  await assert.rejects(pending, /active editor|live observation/i);
  assert.deepEqual([...f.storage.values], before);
});

test("draft Apply name updates catalog and payload atomically while other saves retain a historical alias", async () => {
  const f = await fixture();
  const draft = { ...completeDraft(), id: "aliased-draft", name: "Document name" };
  await f.execute({ type: "create_design_draft", now, designId: "aliased-design", fieldMapId: "catalog-field", name: "Historical catalog alias", draft });
  draft.pivotCenter!.x += 1.25;
  const geometrySave = await f.execute({ type: "save_design_draft", now, designId: "aliased-design", expectedDesignRevision: 0, draft, syncCatalogName: true });
  const aliased = geometrySave.workspace.catalog.designs.find(item => item.id === "aliased-design")!;
  assert.equal(aliased.name, "Historical catalog alias");
  assert.equal(parseDesignDraftDocument(geometrySave.workspace.draftDocuments.find(item => item.id === draft.id)!.document).name, "Document name");
  const before = await f.api.readAsync(), writes = f.storage.writes;
  const renamed = { ...draft, name: "Applied draft name" };
  const receipt = await f.execute({ type: "save_design_draft", now, designId: "aliased-design", expectedDesignRevision: 1, draft: renamed, syncCatalogName: true });
  assert.equal(f.storage.writes, writes + 1);
  assert.equal(receipt.workspace.revision, before.revision + 1);
  const saved = receipt.workspace.catalog.designs.find(item => item.id === "aliased-design")!;
  assert.deepEqual(saved, { ...aliased, revision: 2, name: renamed.name });
  assert.deepEqual(receipt.value, saved);
  assert.equal(receipt.workspace.draftDocuments.find(item => item.id === draft.id)!.document, serializeDesignDraftDocument(renamed));
  const reopened = await f.api.readDesignAsync(saved.id);
  assert.equal(reopened.kind, "draft");
  if (reopened.kind === "draft") {
    assert.deepEqual(reopened.draft, renamed);
    assert.equal(reopened.context.fieldMapId, "catalog-field");
  }
  assert.deepEqual(receipt.workspace.catalog.designs.filter(item => item.id !== saved.id), before.catalog.designs.filter(item => item.id !== saved.id));
  assert.deepEqual(receipt.workspace.draftDocuments.filter(item => item.id !== draft.id), before.draftDocuments.filter(item => item.id !== draft.id));
});

test("stale or failed draft renames leave both catalog name and exact saved document unchanged", async () => {
  const f = await fixture();
  const command: WorkspaceCommand = { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0, syncCatalogName: true,
    draft: { ...completeDraft(), name: "Name must not commit" } };
  const before = [...f.storage.values], writes = f.storage.writes;
  await assert.rejects(f.api.executeAsync(f.revision() - 1, command), /revision/i);
  await assert.rejects(f.api.executeAsync(f.revision(), { ...command, expectedDesignRevision: 1 }), /revision/i);
  await assert.rejects(f.api.executeAsync(f.revision(), { ...command, draft: { ...command.draft, id: "wrong-draft" } }), /identity/i);
  assert.equal(f.storage.writes, writes);
  assert.deepEqual([...f.storage.values], before);
  f.storage.fail = true;
  await assert.rejects(f.api.executeAsync(f.revision(), command), /quota/i);
  f.storage.fail = false;
  assert.equal(f.storage.writes, writes);
  assert.deepEqual([...f.storage.values], before);
  const receipt = await f.execute(command);
  assert.equal(receipt.workspace.catalog.designs[0].name, command.draft.name);
  assert.equal(parseDesignDraftDocument(receipt.workspace.draftDocuments[0].document).name, command.draft.name);
});

test("legacy draft save commands retain catalog aliases and completion synchronizes only a changed source name", async () => {
  for (const syncCatalogName of [undefined, false]) {
    const f = await fixture();
    const changed = { ...completeDraft(), name: "Changed document name" };
    const saved = await f.execute({ type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0,
      draft: changed, ...(syncCatalogName === undefined ? {} : { syncCatalogName }) });
    assert.equal(saved.workspace.catalog.designs[0].name, "Draft");
    assert.equal(parseDesignDraftDocument(saved.workspace.draftDocuments[0].document).name, changed.name);
    const completed = await f.execute({ ...completion(changed), expectedDesignRevision: 1 } as WorkspaceCommand);
    assert.equal(completed.workspace.catalog.designs.find(item => item.id === "draft-design")!.name, "Draft");
  }
  const f = await fixture(), writes = f.storage.writes;
  const changed = { ...completeDraft(), name: "Applied latest draft name" };
  const before = await f.api.readAsync();
  const completed = await f.execute(completion(changed));
  assert.equal(f.storage.writes, writes + 1);
  assert.equal(completed.workspace.revision, before.revision + 1);
  assert.equal(completed.workspace.catalog.designs.find(item => item.id === "draft-design")!.name, changed.name);
  assert.equal(parseDesignDraftDocument(completed.workspace.draftDocuments[0].document).name, changed.name);
});

test("explicit v3 upgrade atomically retains exact v1/v2 bytes, records, revisions and old-reader refusal", async () => {
  for (const throughV2 of [false, true]) {
    const f = await fixture();
    await f.execute({ type: "create_design_draft", now, designId: "deleted-design", fieldMapId: "catalog-field", name: "Deleted", draft: { ...completeDraft(), id: "deleted-draft" } });
    await f.execute({ type: "delete_design", now, designId: "deleted-design", expectedDesignRevision: 0 });
    if (throughV2) await f.execute({ type: "upgrade_workspace_to_v2", now });
    const previous = await f.api.readAsync(), original = `\n${JSON.stringify(previous, null, 3)}\n`;
    f.storage.values.set(WEB_WORKSPACE_KEY, original);
    f.storage.fail = true; await assert.rejects(f.execute({ type: "upgrade_workspace_to_v3", now }), /quota/); f.storage.fail = false;
    assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), original);
    const receipt = await f.execute({ type: "upgrade_workspace_to_v3", now });
    assert.equal(receipt.workspace.originalPreviousWorkspaceDocument, original);
    for (const key of ["catalog", "projectDocuments", "draftDocuments", "tombstones", "originalV1Document"] as const) assert.deepEqual(receipt.workspace[key], previous[key]);
    assert.equal(receipt.workspace.revision, previous.revision + 1);
    assert.throws(() => parseV1WorkspaceDocument(f.storage.getItem(WEB_WORKSPACE_KEY)!), /reader|version/i);
    assert.throws(() => parseV2WorkspaceDocument(f.storage.getItem(WEB_WORKSPACE_KEY)!), /reader|version/i);
    const before = f.storage.getItem(WEB_WORKSPACE_KEY);
    await assert.rejects(f.store.transactAsync(receipt.workspace.revision, value => ({ ...value, revision: value.revision + 1, originalPreviousWorkspaceDocument: JSON.stringify(previous) })), /retained/i);
    assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  }
});

test("Layout CRUD preserves target and evidence, copies empty, refuses duplicates and stale/wrong-session captures", async () => {
  const f = await fixture(), target = targetDocument();
  const create: WorkspaceCommand = { type: "create_layout_session", now, sessionId: "layout", fieldMapId: "catalog-field", name: "North Layout", targetDocument: target };
  await assert.rejects(f.execute(create), /upgrade/i);
  await f.execute({ type: "upgrade_workspace_to_v3", now });
  await f.execute(create);
  const append: WorkspaceCommand = { type: "append_layout_observation", now, sessionId: "layout", expectedSessionRevision: 0, observation: observation() };
  let receipt = await f.execute(append), session = receipt.value as LayoutSession;
  assert.equal(session.targetDocument, target); assert.equal(session.observations.length, 1);
  const good = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute(append), /changed/i);
  await assert.rejects(f.execute({ ...append, expectedSessionRevision: 1 }), /duplicate/i);
  await assert.rejects(f.execute({ ...append, expectedSessionRevision: 1, observation: { ...observation("wrong"), sessionId: "other" } }), /session/i);
  const stale = observation("stale"); stale.evidence.capture.ageMs = 2500; stale.evidence.capture.evaluatedMonotonicMs = 3500;
  await assert.rejects(f.execute({ ...append, expectedSessionRevision: 1, observation: stale }), /invalid/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), good);
  receipt = await f.execute({ type: "rename_layout_session", now, sessionId: "layout", expectedSessionRevision: 1, name: "Renamed" }); session = receipt.value as LayoutSession;
  await f.execute({ type: "archive_layout_session", now, sessionId: "layout", expectedSessionRevision: 2, archived: true });
  await assert.rejects(f.execute({ ...append, expectedSessionRevision: 3, observation: observation("next") }), /restore/i);
  await f.execute({ type: "archive_layout_session", now, sessionId: "layout", expectedSessionRevision: 3, archived: false });
  const copy = (await f.execute({ type: "copy_layout_session", now, sourceSessionId: "layout", expectedSessionRevision: 4, sessionId: "copy", name: "Copied" })).value as LayoutSession;
  assert.equal(copy.targetDocument, target); assert.deepEqual(copy.observations, []); assert.equal(copy.revision, 0);
  const roundTrip = importLayoutSessionArchiveZip(exportLayoutSessionArchiveZip(session));
  assert.deepEqual(roundTrip, session); assert.equal(roundTrip.targetDocument, target);
  const saved = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.store.transactAsync(f.revision(), current => { const value = parseLayoutSessionDocument(current.layoutSessions![0].document); value.observations = []; current.layoutSessions![0].document = serializeLayoutSessionDocument(value); current.revision++; return current; }), /observations/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), saved);
  await assert.rejects(f.execute({ type: "delete_project", now, projectId: "folder" }), /Layout sessions/i);
  const other = await fixture(); await other.execute({ type: "upgrade_workspace_to_v3", now });
  const imported = (await other.execute({ type: "import_layout_session", now, fieldMapId: "catalog-field", document: serializeLayoutSessionDocument(roundTrip) })).value as LayoutSession;
  assert.deepEqual(imported, roundTrip);
  await assert.rejects(other.execute({ type: "import_layout_session", now, fieldMapId: "catalog-field", document: serializeLayoutSessionDocument(roundTrip) }), /used/i);
});

test("supported imports create fresh identities atomically and field provenance survives explicit upgrade", async () => {
  const f = await fixture(), project = serializeProjectDocument(sampleProject);
  const imported = await f.execute({ type: "import_design_document", now, fieldMapId: "catalog-field", designId: "import-project", payloadId: "new-project", document: project });
  assert.equal(imported.workspace.projectDocuments[0].summary.id, "new-project");
  assert.deepEqual(parseProjectDocument(imported.workspace.projectDocuments[0].document).fieldBoundary, sampleProject.fieldBoundary);
  await f.execute({ type: "import_design_document", now, fieldMapId: "catalog-field", designId: "import-draft", payloadId: "new-draft", document: serializeDesignDraftDocument(completeDraft()) });
  const original = `\n${project}\n`, field = convertPivotProjectToFieldDesign(original, { fieldId: "old-field", waterSourceId: "water", powerSourceId: "power" }).field;
  const command: WorkspaceCommand = { type: "import_design_document", now, fieldMapId: "catalog-field", designId: "import-field", payloadId: "new-field", document: serializeFieldDesignDocument(field), originalProjectDocument: original };
  const before = [...f.storage.values]; await assert.rejects(f.execute(command), /upgrade/i); assert.deepEqual([...f.storage.values], before);
  await assert.rejects(f.execute({ ...command, document: '{"documentVersion":"future-v1"}' }), /supported/i); assert.deepEqual([...f.storage.values], before);
  await f.execute({ type: "upgrade_workspace_to_v3", now });
  const result = await f.execute(command);
  assert.equal(result.workspace.fieldDocuments![0].originalProjectDocument, original);
  assert.equal(result.workspace.fieldDocuments![0].id, "new-field");
});

test("operational evidence round-trips all archives and cannot be rewritten via standalone save or stored copy", async () => {
  const capture = observation();
  const project = { ...structuredClone(sampleProject), id: "standalone", surveyPoints: [{ id: "point", label: "Observation", role: "control" as const,
    projected: capture.projected, observedAt: now, source: "external_gnss" as const, confidence: "rtk_fixed" as const, captureEvidence: capture.evidence }] };
  const projectDoc = serializeProjectDocument(project);
  assert.deepEqual(importProjectArchiveZip(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(project))).surveyPoints, project.surveyPoints);
  const draft = parseDesignDraftDocument({ documentVersion: "design-draft-v4", draft: JSON.parse(JSON.stringify({ ...project, settings: defaultProjectSettings() })) });
  assert.deepEqual(importDesignDraftArchiveZip(exportDesignDraftArchiveZip(buildDesignDraftArchiveBundle(draft))), draft);
  const field = convertPivotProjectToFieldDesign(projectDoc, { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  assert.deepEqual(importFieldDesignArchiveZip(exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(field))).field.surveyPoints, field.surveyPoints);
  const f = await fixture(); await f.execute({ type: "save_project", now, createOnly: true, project });
  const changed = structuredClone(project); changed.surveyPoints[0].captureEvidence.receipt.sequence++;
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "save_project", now, createOnly: false, project: changed }), /immutable/i);
  await assert.rejects(f.execute({ type: "copy_project", now, sourceStored: true, source: changed, newProjectId: "bad-copy", name: "Bad copy" }), /immutable|conflicting/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  assert.doesNotThrow(() => parseWorkspaceDocument(before!));
});

test("native adapters refuse all new workflow commands before opening a database", async () => {
  let opened = false;
  const store = createSqliteWorkspaceStore({ openAsync: async () => { opened = true; throw new Error("must not open"); } } as never);
  const commands: WorkspaceCommand[] = [completion(), { type: "upgrade_workspace_to_v3", now },
    { type: "create_layout_session", now, sessionId: "layout", fieldMapId: "catalog-field", name: "Layout", targetDocument: targetDocument() },
    { type: "append_layout_observation", now, sessionId: "layout", expectedSessionRevision: 0, observation: observation() },
    { type: "rename_layout_session", now, sessionId: "layout", expectedSessionRevision: 0, name: "Rename" },
    { type: "archive_layout_session", now, sessionId: "layout", expectedSessionRevision: 0, archived: true },
    { type: "copy_layout_session", now, sourceSessionId: "layout", expectedSessionRevision: 0, sessionId: "copy", name: "Copy" },
    { type: "import_layout_session", now, fieldMapId: "field", document: "{}" },
    { type: "import_design_document", now, fieldMapId: "field", designId: "design", payloadId: "project", document: serializeProjectDocument(sampleProject) },
  ];
  for (const command of commands) await assert.rejects(store.executeAsync(0, command), NativeWorkspaceCommandRefusal);
  assert.equal(opened, false);
});
