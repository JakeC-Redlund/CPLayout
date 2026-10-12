import assert from "node:assert/strict";
import test from "node:test";
import { workflowTestField, workflowTestPoint, workflowTestTime as now } from "../../core/src/productionWorkflowTestFixtures";
import { createSurveyCollection, parseSurveyCollectionDocument } from "../../core/src/surveyCollection";
import { serializeFieldDesignDocument, parseFieldDesignDocument } from "../../core/src/fieldDesignDocument";
import { parseDesignDraftDocument } from "../../core/src/designDraft";
import { convertSurveyDraftToField } from "../../core/src/surveyDraftField";
import { defaultProjectSettings } from "../../core/src/settings";
import { parseFieldLayoutTarget, createFieldLayoutTarget, serializeFieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { createLayoutSessionDocument, parseLayoutSessionDocument, serializeLayoutSessionDocument } from "../../core/src/layoutSession";
import { createVersionedProjectRepository } from "./versionedProjectRepository";
import { WEB_WORKSPACE_KEY, type WorkspaceLocks } from "./webWorkspaceStore";
import { emptyWorkspaceDocument, parseWorkspaceDocument, parseV1WorkspaceDocument, parseV2WorkspaceDocument, parseV3WorkspaceDocument, parseV4WorkspaceDocument, workspaceDesignSource, serializeWorkspaceDocument } from "./workspaceDocument";
import { applyWorkspaceCommand, applyWorkspaceDocumentCommand, type WorkspaceCommand } from "./workspaceCommands";
import { getSurveyReadiness, assertLayoutSurveyAdmission } from "./productionWorkflow";
import { buildDesignWorkspaceBundle, parseV1DesignWorkspaceBundle, exportDesignWorkspaceBundleZip, importDesignWorkspaceBundleZip, parseDesignWorkspaceBundle } from "./designWorkspaceBundle";
import { createSqliteWorkspaceStore } from "./sqliteWorkspaceStore";
import { layoutLockFromReceiverCapture, isOfficialLayoutSession } from "../../core/src/officialLayout";
import { createWebWorkspaceStore, WEB_WORKSPACE_BACKUP_KEY } from "./webWorkspaceStore";

class Storage { values = new Map<string, string>(); fail = false; getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { if (this.fail && key === WEB_WORKSPACE_KEY) throw new Error("Synthetic quota"); this.values.set(key, value); } }
class Locks implements WorkspaceLocks { tail: Promise<unknown> = Promise.resolve(); request<T>(_name: string, _options: { mode: "exclusive" }, run: () => T | PromiseLike<T>): Promise<T> { const next = this.tail.then(run); this.tail = next.catch(() => undefined); return next; }
  hold() { let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); this.tail = this.tail.then(() => waiting); return release; } }
async function fixture() {
  const storage = new Storage(), locks = new Locks(), api = createVersionedProjectRepository({ getStorage: () => storage, getLocks: () => locks }).versionedWorkspace!;
  let current = await api.readAsync();
  async function execute(command: unknown, guard?: () => boolean) { const result = await api.executeAsync(current.revision, { now, ...command as object } as WorkspaceCommand, guard); current = result.workspace; return result; }
  await execute({ type: "create_client", id: "client", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  await execute({ type: "upgrade_workspace_to_v5" });
  await execute({ type: "start_project_work", clientId: "client", projectId: "project", fieldMapId: "map", designId: "draft-design", draftId: "draft", projectName: "Synthetic project", fieldName: "Synthetic field", workName: "Synthetic work", unitSystem: "metric", initialMode: "survey", projectCrs: "EPSG:32613" });
  return { api, storage, locks, execute, current: () => current };
}
async function reviewedField() {
  const f = await fixture(), field = workflowTestField();
  await f.execute({ type: "create_field_design", designId: "field-design", fieldMapId: "map", name: field.name, field });
  const collection = createSurveyCollection({ id: "control", owner: { designId: "field-design", documentKind: "field", payloadId: field.id, fieldMapId: "map", projectCrs: field.projectCrs }, purpose: { kind: "point", role: "control" }, now });
  await f.execute({ type: "create_survey_collection", collection, expectedDesignRevision: 0 });
  await f.execute({ type: "append_survey_capture", collectionId: "control", expectedCollectionRevision: 0, expectedDesignRevision: 0, point: workflowTestPoint() }, () => true);
  await f.execute({ type: "review_survey", reviewId: "review", designId: "field-design", expectedDesignRevision: 1, includedCollectionIds: ["control"], excludedCollectionIds: [], completedBy: "operator" });
  return f;
}
function mark(sequence: number, sessionId = "layout") { const point = workflowTestPoint(sequence); return { id: `mark-${sequence}`, sessionId, capturedAt: now, projected: point.projected, evidence: point.captureEvidence }; }
async function freeze(f: Awaited<ReturnType<typeof fixture>>) {
  const field = parseFieldDesignDocument(workspaceDesignSource(f.current(), "field-design").document);
  await f.execute({ type: "create_rtk_layout_session", sessionId: "layout", name: "Synthetic Layout", designId: "field-design", expectedDesignRevision: f.current().catalog.designs.find(item => item.id === "field-design")!.revision,
    reviewId: "review", selectedMachineIds: [field.machines[0].id], creationLock: layoutLockFromReceiverCapture(workflowTestPoint(10), "operator") }, () => true);
  return parseLayoutSessionDocument(f.current().layoutSessions![0].document);
}
test("atomic upgrade preserves exact earliest source, accepts every prior version and refuses old readers", async () => {
  for (const version of [1, 2, 3, 4]) {
    let workspace = emptyWorkspaceDocument();
    if (version === 2) workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v2", now }).workspace;
    if (version >= 3) workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v3", now }).workspace;
    if (version === 4) workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v4", now }).workspace;
    const upgraded = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v5", now }).workspace;
    assert.equal(upgraded.workspaceVersion, "cplayout-workspace-v5");
    assert.equal(upgraded.revision, workspace.revision + (version <= 2 ? 3 : version === 3 ? 2 : 1));
    for (const reader of [parseV1WorkspaceDocument, parseV2WorkspaceDocument, parseV3WorkspaceDocument, parseV4WorkspaceDocument]) assert.throws(() => reader(serializeWorkspaceDocument(upgraded)), /reader|require|preserve|workspace/i);
  }
  const storage = new Storage(), locks = new Locks(), api = createVersionedProjectRepository({ getStorage: () => storage, getLocks: () => locks }).versionedWorkspace!;
  const old = await api.readAsync(), exact = `\n ${storage.getItem(WEB_WORKSPACE_KEY)} \n`;
  storage.values.set(WEB_WORKSPACE_KEY, exact);
  const result = await api.executeAsync(old.revision, { type: "upgrade_workspace_to_v5", now });
  const v4 = JSON.parse(result.workspace.originalWorkflowUpgradeDocument!), v3 = JSON.parse(v4.originalSurveyUpgradeDocument);
  assert.equal(v3.originalPreviousWorkspaceDocument, exact);
});
test("stored-text command boundary retains noncanonical pretty CRLF source through every prior upgrade chain", () => {
  for (const version of [1, 2, 3, 4]) {
    let workspace = emptyWorkspaceDocument();
    workspace = applyWorkspaceCommand(workspace, { type: "create_client", id: "retained-customer", input: { primaryContactFirstName: "Actual", primaryContactLastName: "UTF8 Å owner" }, now }).workspace;
    if (version === 2) workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v2", now }).workspace;
    if (version >= 3) workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v3", now }).workspace;
    if (version === 4) workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v4", now }).workspace;
    const source = ` \r\n${JSON.stringify(workspace, null, 2).replaceAll("\n", "\r\n")}\r\n\t `;
    const result = applyWorkspaceDocumentCommand(source, { type: "upgrade_workspace_to_v5", now }).workspace;
    const v4 = JSON.parse(result.originalWorkflowUpgradeDocument!), v3 = JSON.parse(v4.originalSurveyUpgradeDocument);
    assert.equal(version <= 2 ? v3.originalPreviousWorkspaceDocument : version === 3 ? v4.originalSurveyUpgradeDocument : result.originalWorkflowUpgradeDocument, source);
    assert.deepEqual(result.catalog, workspace.catalog); assert.equal(result.revision, workspace.revision + (version <= 2 ? 3 : version === 3 ? 2 : 1));
    const firstStep = version === 1 ? "upgrade_workspace_to_v2" : version === 2 ? "upgrade_workspace_to_v3" : version === 3 ? "upgrade_workspace_to_v4" : "upgrade_workspace_to_v5";
    const first = applyWorkspaceDocumentCommand(source, { type: firstStep, now }).workspace;
    assert.equal(version === 1 ? first.originalV1Document : version === 2 ? first.originalPreviousWorkspaceDocument : version === 3 ? first.originalSurveyUpgradeDocument : first.originalWorkflowUpgradeDocument, source);
    const ordinary = applyWorkspaceDocumentCommand(source, { type: "update_client", input: { id: "retained-customer", primaryContactFirstName: "Supplied", primaryContactLastName: "Name" }, now });
    assert.deepEqual(ordinary, applyWorkspaceCommand(workspace, { type: "update_client", input: { id: "retained-customer", primaryContactFirstName: "Supplied", primaryContactLastName: "Name" }, now }));
  }
  assert.throws(() => applyWorkspaceDocumentCommand({} as string, { type: "upgrade_workspace_to_v5", now }), /actual JSON text/);
});
test("new work can start Survey with genuinely unknown CRS and no fabricated drawing or machine; failure is atomic", async () => {
  const f = await fixture();
  await f.execute({ type: "start_project_work", clientId: "client", projectId: "unknown-project", fieldMapId: "unknown-map", designId: "unknown-design", draftId: "unknown-draft", projectName: "Known project name", fieldName: "Known field name", workName: "Field work", unitSystem: "us_survey_feet", initialMode: "survey", siteDescription: "Actual entered location description", locator: { latitude: 40, longitude: -105 } });
  const source = workspaceDesignSource(f.current(), "unknown-design"), draft = parseDesignDraftDocument(source.document);
  assert.equal(f.current().catalog.projects.find(item => item.id === "unknown-project")!.projectCrs, null); assert.equal(draft.projectCrs, null);
  assert.deepEqual(draft.fieldBoundary, []); assert.deepEqual(draft.machine, {}); assert.equal(draft.pivotCenter, null);
  assert.equal(f.current().workItems!.find(item => item.designId === "unknown-design")!.initialMode, "survey");
  await f.execute({ type: "declare_work_crs", designId: "unknown-design", expectedDesignRevision: 0, projectCrs: "EPSG:32613" });
  assert.equal(f.current().catalog.projects.find(item => item.id === "unknown-project")!.projectCrs, "EPSG:32613");
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "start_project_work", clientId: "missing", projectId: "bad", fieldMapId: "bad-map", designId: "bad-design", draftId: "bad-draft", projectName: "Bad", fieldName: "Bad", workName: "Bad", unitSystem: "metric", initialMode: "design" }));
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
});

test("retained fixed Survey evidence blocks ancestor deletion after source archival; valid historical missing-parent records remain readable and exact", async () => {
  const f = await fixture();
  const collection = createSurveyCollection({ id: "retained-control", owner: { designId: "draft-design", documentKind: "draft", payloadId: "draft", fieldMapId: "map", projectCrs: "EPSG:32613" }, purpose: { kind: "point", role: "control" }, now });
  await f.execute({ type: "create_survey_collection", collection, expectedDesignRevision: 0 });
  const captured = workflowTestPoint();
  await f.execute({ type: "append_survey_capture", collectionId: collection.id, expectedCollectionRevision: 0, expectedDesignRevision: 0, point: captured }, () => true);
  const stored = JSON.parse(f.storage.getItem(WEB_WORKSPACE_KEY)!);
  const source = stored.draftDocuments.find((item: { id: string }) => item.id === "draft");
  const exactSource = ` \r\n${JSON.stringify(JSON.parse(source.document), null, 2).replaceAll("\n", "\r\n")}\r\n `;
  source.document = exactSource; f.storage.values.set(WEB_WORKSPACE_KEY, JSON.stringify(stored));
  await assert.rejects(f.execute({ type: "delete_project", projectId: "project" }), /retained field surveys/i);
  await f.execute({ type: "archive_and_delete_design", designId: "draft-design", expectedDesignRevision: 1, collectionIds: [{ id: collection.id, expectedRevision: 1 }] });
  const retained = f.storage.getItem(WEB_WORKSPACE_KEY), collectionSource = f.current().surveyCollections![0].document;
  assert.equal(f.current().surveyOwnerArchives![0].document, exactSource);
  for (const command of [{ type: "delete_project", projectId: "project" }, { type: "delete_client", clientId: "client" }]) {
    await assert.rejects(f.execute(command), /retained field surveys|contains projects/i);
    assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), retained);
  }
  assert.equal(f.current().catalog.fieldMaps[0].projectId, "project"); assert.equal(f.current().catalog.projects[0].clientId, "client");
  assert.deepEqual(parseSurveyCollectionDocument(collectionSource).observations, [captured]);
  // Older valid records may already lack this ancestry. Reader compatibility
  // and original coordinates survive; no replacement parents are invented.
  const orphan = structuredClone(f.current()); orphan.catalog.clients = []; orphan.catalog.projects = []; orphan.catalog.fieldMaps = [];
  const read = parseWorkspaceDocument(serializeWorkspaceDocument(orphan));
  assert.equal(read.surveyOwnerArchives![0].document, exactSource); assert.equal(read.surveyCollections![0].document, collectionSource);
  assert.equal(buildDesignWorkspaceBundle(read, "draft-design").designDocument, exactSource);
  assert.deepEqual(parseSurveyCollectionDocument(read.surveyCollections![0].document).observations, [captured]);
  const store = createWebWorkspaceStore({ getStorage: () => f.storage, getLocks: () => f.locks });
  orphan.revision++;
  await assert.rejects(store.transactAsync(f.current().revision, () => orphan), /original field and project context/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), retained);
  const withNewCustomer = applyWorkspaceCommand(read, { type: "create_client", now, id: "new-owner", input: { primaryContactFirstName: "Supplied", primaryContactLastName: "Customer" } }).workspace;
  assert.throws(() => applyWorkspaceCommand(withNewCustomer, { type: "create_project_with_initial_field_map", now,
    input: { clientId: "new-owner", projectId: "new-project", projectName: "Supplied project", projectCrs: "EPSG:32613", unitSystem: "metric", fieldMapId: "map" } }), /field identity belongs to retained survey history/);
  assert.equal(read.surveyOwnerArchives![0].document, exactSource); assert.equal(read.surveyCollections![0].document, collectionSource);
});
test("genuine Survey-only work binds recorded pivot, uses supplied configuration, prepares lossless Field with unknown infrastructure, re-reviews and creates a locked v3 Layout with reviewed v2 targets", async () => {
  const f = await fixture();
  const sourceRevision = () => workspaceDesignSource(f.current(), "draft-design").design.revision;
  const owner = { designId: "draft-design", documentKind: "draft" as const, payloadId: "draft", fieldMapId: "map", projectCrs: "EPSG:32613" };
  await f.execute({ type: "create_survey_collection", expectedDesignRevision: sourceRevision(), collection: createSurveyCollection({ id: "gps-boundary", owner, purpose: { kind: "field_boundary" }, now }) });
  for (const [index, coordinate] of [[40, -105], [40, -104.999], [40.001, -105]].entries()) await f.execute({ type: "append_survey_capture", collectionId: "gps-boundary", expectedCollectionRevision: index, expectedDesignRevision: sourceRevision(),
    point: workflowTestPoint(index + 1, "control", coordinate[0], coordinate[1]) }, () => true);
  await f.execute({ type: "apply_survey_collection", collectionId: "gps-boundary", expectedCollectionRevision: 3, expectedDesignRevision: sourceRevision(), applicationId: "actual-boundary" });
  await f.execute({ type: "create_survey_collection", expectedDesignRevision: sourceRevision(), collection: createSurveyCollection({ id: "gps-pivot", owner, purpose: { kind: "point", role: "pivot_center" }, now }) });
  const pivot = workflowTestPoint(4, "pivot_center", 40.0002, -104.9998);
  await f.execute({ type: "append_survey_capture", collectionId: "gps-pivot", expectedCollectionRevision: 0, expectedDesignRevision: sourceRevision(), point: pivot }, () => true);
  await f.execute({ type: "bind_recorded_pivot", designId: "draft-design", expectedDesignRevision: sourceRevision(), collectionId: "gps-pivot", expectedCollectionRevision: 1, pointId: pivot.id });
  const draft = parseDesignDraftDocument(workspaceDesignSource(f.current(), "draft-design").document);
  draft.machine = { id: "entered-machine", name: "Supplied machine", spanLengthsMeters: [61], overhangMeters: 0, endGunThrowMeters: 0, towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 0, sweep: { mode: "full_circle" } };
  await f.execute({ type: "save_design_draft", designId: "draft-design", expectedDesignRevision: sourceRevision(), draft });
  // Storage may contain valid external formatting; preparation must archive
  // these actual bytes rather than substitute a canonical reconstruction.
  const stored = JSON.parse(f.storage.getItem(WEB_WORKSPACE_KEY)!);
  const storedDraft = stored.draftDocuments.find((item: { id: string }) => item.id === "draft");
  const exactDraft = ` \r\n${JSON.stringify(JSON.parse(storedDraft.document), null, 2).replaceAll("\n", "\r\n")}\r\n\t`;
  storedDraft.document = exactDraft;
  f.storage.values.set(WEB_WORKSPACE_KEY, JSON.stringify(stored));
  await f.execute({ type: "review_survey", designId: "draft-design", expectedDesignRevision: sourceRevision(), reviewId: "actual-draft-review", includedCollectionIds: ["gps-boundary", "gps-pivot"], excludedCollectionIds: [], completedBy: "operator" });
  const command = { type: "prepare_surveyed_field", sourceDesignId: "draft-design", expectedDesignRevision: sourceRevision(), designId: "prepared-field-design", fieldMapId: "map", fieldId: "prepared-field", waterSourceId: "unused-water", powerSourceId: "unused-power", name: "Survey field" };
  const before = f.current(), sourceText = workspaceDesignSource(before, "draft-design").document;
  assert.equal(sourceText, exactDraft);
  f.storage.fail = true; await assert.rejects(f.execute(command), /quota/i); f.storage.fail = false; assert.equal(f.current(), before);
  const release = f.locks.hold(); let admitted = true; const retired = f.execute(command, () => admitted); admitted = false; release(); await assert.rejects(retired, /changed|active/i); assert.equal(f.current(), before);
  await f.execute(command, () => true); const prepared = workspaceDesignSource(f.current(), "prepared-field-design"), field = parseFieldDesignDocument(prepared.document);
  assert.deepEqual(field.infrastructure, []); assert.deepEqual(field.machines[0].pivotCenter, pivot.projected); assert.equal(field.machines[0].pivotObservationId, pivot.id); assert.equal(field.machines[0].configuration.endGunAngleRanges, undefined);
  assert.equal(workspaceDesignSource(f.current(), "draft-design").document, sourceText); assert.equal(f.current().projectDocuments.length, 0); assert.equal(parseDesignDraftDocument(sourceText).waterSource, null); assert.equal(parseDesignDraftDocument(sourceText).powerSource, null);
  const lineage = f.current().workflowConversions!.at(-1)!; assert.equal(lineage.source.kind, "draft"); assert.equal(lineage.destination.kind, "field"); assert.equal(lineage.source.document, sourceText); assert.equal(lineage.collectionMappings.length, 2);
  assert.equal(getSurveyReadiness(f.current(), "prepared-field-design").status, "needs_review");
  await assert.rejects(f.execute({ type: "create_reviewed_layout_session", designId: "prepared-field-design", expectedDesignRevision: 0, reviewId: "actual-draft-review", sessionId: "direct-layout", name: "Layout", selectedMachineIds: ["entered-machine"] }), /Review/);
  await f.execute({ type: "review_survey", designId: "prepared-field-design", expectedDesignRevision: 0, reviewId: "actual-field-review", includedCollectionIds: lineage.collectionMappings.map(item => item.destinationId), excludedCollectionIds: [], completedBy: "operator" });
  await f.execute({ type: "create_rtk_layout_session", designId: "prepared-field-design", expectedDesignRevision: 0, reviewId: "actual-field-review", sessionId: "direct-layout", name: "Layout", selectedMachineIds: ["entered-machine"], creationLock: layoutLockFromReceiverCapture(workflowTestPoint(10), "operator") }, () => true);
  const session = parseLayoutSessionDocument(f.current().layoutSessions!.find(item => item.id === "direct-layout")!.document); assert.equal(session.documentVersion, "layout-session-v3"); assert.equal(parseFieldLayoutTarget(session.targetDocument).targetPoints!.length, 1);
  const bundle = buildDesignWorkspaceBundle(f.current(), "prepared-field-design"); assert.equal(bundle.workflowSources!.conversions[0].source.document, sourceText);
  assert.equal(importDesignWorkspaceBundleZip(exportDesignWorkspaceBundleZip(bundle)).workflowSources!.conversions[0].source.document, exactDraft);
});
test("empty-machine preparation uses existing Field minimums and partial supplied configuration refuses without guessed data", async () => {
  const f = await fixture(), draft = parseDesignDraftDocument(workspaceDesignSource(f.current(), "draft-design").document), field = workflowTestField();
  draft.fieldBoundary = field.fieldBoundary;
  const identities = { fieldId: "empty-field", waterSourceId: "unused-water", powerSourceId: "unused-power" };
  const text = (value: typeof draft) => JSON.stringify({ documentVersion: "design-draft-v3", draft: value });
  assert.deepEqual(convertSurveyDraftToField(text(draft), identities).field.machines, []);
  assert.throws(() => convertSurveyDraftToField(text({ ...draft, machine: { id: "partial", name: "Actual partial" } }), identities), /Supply/);
  assert.throws(() => convertSurveyDraftToField(text({ ...draft, pivotCenter: field.machines[0].pivotCenter }), identities), /Supply/);
});
test("empty/unreviewed Survey cannot create Layout; point review qualifies without invented application", async () => {
  const f = await fixture(), field = workflowTestField();
  await f.execute({ type: "create_field_design", designId: "field-design", fieldMapId: "map", name: field.name, field });
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "create_reviewed_layout_session", sessionId: "layout", name: "Layout", designId: "field-design", expectedDesignRevision: 0, reviewId: "fake", selectedMachineIds: [field.machines[0].id] }), /review|Survey/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  const ready = await reviewedField();
  assert.equal(getSurveyReadiness(ready.current(), "field-design").status, "ready");
  assert.equal(parseSurveyCollectionDocument(ready.current().surveyCollections![0].document).state, "pending");
  const session = await freeze(ready); assert.equal(session.documentVersion, "layout-session-v3");
});
test("fresh-owned under-lock marking retains immutable target and derives optional tolerance evaluation", async () => {
  const f = await reviewedField(), session = await freeze(f), target = parseFieldLayoutTarget(session.targetDocument), targetId = target.targetPoints![0].id;
  await f.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 0, observation: mark(2), recordedBy: "operator" }, () => true);
  await f.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 1, observation: mark(3), targetPointId: targetId, recordedBy: "operator" }, () => true);
  await f.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 2, observation: mark(4), targetPointId: targetId, toleranceMeters: 0.02, recordedBy: "operator" }, () => true);
  const saved = parseLayoutSessionDocument(f.current().layoutSessions![0].document);
  assert.equal(saved.targetDocument, session.targetDocument); assert.equal(saved.targetHash, session.targetHash);
  assert.deepEqual(saved.observations.map(item => "marking" in item && item.marking?.assessment), ["record_only", "not_evaluated", "within_tolerance"]);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 3, observation: mark(5), recordedBy: "operator" }), /predicate/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  const release = f.locks.hold(); let current = true;
  const pending = f.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 3, observation: mark(5), recordedBy: "operator" }, () => current);
  current = false; release(); await assert.rejects(pending, /live observation|active editor/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
});

test("v3 creation/finalization require live commit owners; official receipts and ordered station history cannot be erased through the actual writer", async () => {
  const f = await reviewedField(), before = f.storage.getItem(WEB_WORKSPACE_KEY);
  const field = parseFieldDesignDocument(workspaceDesignSource(f.current(), "field-design").document);
  const command = { type: "create_rtk_layout_session" as const, sessionId: "layout", name: "RTK map", designId: "field-design", expectedDesignRevision: 1, reviewId: "review", selectedMachineIds: [field.machines[0].id], creationLock: layoutLockFromReceiverCapture(workflowTestPoint(10), "operator") };
  const store = createWebWorkspaceStore({ getStorage: () => f.storage, getLocks: () => f.locks });
  const created = applyWorkspaceCommand(f.current(), { now, ...command }).workspace;
  await assert.rejects(store.transactAsync(f.current().revision, () => created), /predicate/);
  const changedSource = structuredClone(created);
  const changedField = parseFieldDesignDocument(changedSource.fieldDocuments!.find(entry => entry.id === field.id)!.document);
  changedField.machines[0].configuration.spanLengthsMeters[0] += 1;
  changedSource.fieldDocuments!.find(entry => entry.id === field.id)!.document = serializeFieldDesignDocument(changedField);
  await assert.rejects(store.transactAsync(f.current().revision, () => changedSource, () => true), /configuration changed/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  await assert.rejects(f.execute(command), /predicate/); assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  await f.execute(command, () => true);
  const target = parseFieldLayoutTarget(parseLayoutSessionDocument(f.current().layoutSessions![0].document).targetDocument), targetPointId = target.targetPoints![0].id;
  const marked = applyWorkspaceCommand(f.current(), { type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 0, observation: mark(2), targetPointId, toleranceMeters: .02, recordedBy: "operator", now }).workspace;
  await assert.rejects(store.transactAsync(f.current().revision, () => marked), /predicate/);
  const prepopulated = structuredClone(marked); prepopulated.revision = created.revision;
  const originalStorage = new Storage(); originalStorage.values = new Map(f.storage.values); originalStorage.values.set(WEB_WORKSPACE_KEY, before!);
  const originalStore = createWebWorkspaceStore({ getStorage: () => originalStorage, getLocks: () => new Locks() });
  await assert.rejects(originalStore.transactAsync(created.revision - 1, () => prepopulated, () => true), /empty pending|reference history/);
  assert.equal(originalStorage.getItem(WEB_WORKSPACE_KEY), before);
  await f.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 0, observation: mark(2), targetPointId, toleranceMeters: .02, recordedBy: "operator" }, () => true);
  const rawPending = f.storage.getItem(WEB_WORKSPACE_KEY)!;
  for (const mutate of [
    (s: ReturnType<typeof parseLayoutSessionDocument>) => { s.observations[0].label = "rewritten"; },
    (s: ReturnType<typeof parseLayoutSessionDocument>) => { s.observations = []; },
  ]) {
    const next = structuredClone(f.current()), session = parseLayoutSessionDocument(next.layoutSessions![0].document); mutate(session); session.revision++;
    next.layoutSessions![0].document = serializeLayoutSessionDocument(session); next.revision++;
    await assert.rejects(store.transactAsync(f.current().revision, () => next, () => true), /append-only|retained|removed|operational/i);
    assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), rawPending);
  }
  const finalize = { type: "finalize_rtk_layout_session" as const, sessionId: "layout", expectedSessionRevision: 1, finalizationLock: layoutLockFromReceiverCapture(workflowTestPoint(11), "operator") };
  const finalized = applyWorkspaceCommand(f.current(), { now, ...finalize }).workspace;
  await assert.rejects(store.transactAsync(f.current().revision, () => finalized), /predicate/);
  const writerRelease = f.locks.hold(); let writerCurrent = true;
  const writerPending = store.transactAsync(f.current().revision, () => finalized, () => writerCurrent); writerCurrent = false; writerRelease();
  await assert.rejects(writerPending, /active editor|live observation/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), rawPending);
  await assert.rejects(f.execute(finalize), /predicate/);
  const release = f.locks.hold(); let current = true; const pending = f.execute(finalize, () => current); current = false; release(); await assert.rejects(pending, /changed|active/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), rawPending);
  await f.execute(finalize, () => true); const official = parseLayoutSessionDocument(f.current().layoutSessions![0].document); assert.equal(isOfficialLayoutSession(official), true);
  const original = f.storage.getItem(WEB_WORKSPACE_KEY)!;
  const imported = await reviewedField(), exact = ` \r\n${JSON.stringify(official, null, 2).replaceAll("\n", "\r\n")}\r\n`;
  await imported.execute({ type: "create_field_map_record", input: { id: "other-map", projectId: "project", name: "Other supplied field" } });
  const beforeImport = imported.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(imported.execute({ type: "import_layout_session", fieldMapId: "other-map", document: exact }), /belongs to its original field/);
  assert.equal(imported.storage.getItem(WEB_WORKSPACE_KEY), beforeImport);
  await imported.execute({ type: "import_layout_session", fieldMapId: "map", document: exact });
  const reference = parseLayoutSessionDocument(imported.current().layoutSessions![0].document);
  assert.equal(reference.documentVersion, "layout-session-v3"); if (reference.documentVersion !== "layout-session-v3") throw new Error("Expected v3 reference");
  assert.equal(reference.referenceSourceDocument, exact); assert.equal(reference.finalization, null); assert.equal(isOfficialLayoutSession(reference), false);
  assert.equal(reference.targetDocument, official.targetDocument); assert.deepEqual(reference.observations, official.observations);
  await imported.execute({ type: "rename_layout_session", sessionId: "layout", expectedSessionRevision: reference.revision, name: "Named reference history" });
  const renamedReference = parseLayoutSessionDocument(imported.current().layoutSessions![0].document);
  assert.equal(renamedReference.documentVersion, "layout-session-v3"); if (renamedReference.documentVersion !== "layout-session-v3") throw new Error("Expected v3 reference");
  assert.equal(renamedReference.referenceSourceDocument, exact); assert.equal(renamedReference.targetDocument, official.targetDocument);
  await assert.rejects(imported.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: renamedReference.revision, observation: mark(12), recordedBy: "operator" }, () => true), /reference history/);
  await assert.rejects(imported.execute({ type: "finalize_rtk_layout_session", sessionId: "layout", expectedSessionRevision: renamedReference.revision, finalizationLock: layoutLockFromReceiverCapture(workflowTestPoint(13), "operator") }, () => true), /current RTK Layout/);
  for (const mutate of [
    (s: Record<string, unknown>) => { s.documentVersion = "layout-session-v2"; delete s.creationLock; delete s.finalization; delete s.referenceSourceDocument; },
    (s: Record<string, unknown>) => { s.finalization = null; },
  ]) {
    const next = structuredClone(f.current()), session = JSON.parse(next.layoutSessions![0].document); mutate(session); session.revision++;
    next.layoutSessions![0].document = JSON.stringify(session); next.revision++;
    await assert.rejects(store.transactAsync(f.current().revision, () => next, () => true), /version|finalization|retain/i); assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), original);
  }
  await f.execute({ type: "copy_layout_session", sourceSessionId: "layout", expectedSessionRevision: 2, sessionId: "reference-copy", name: "Reference plan" });
  assert.equal(isOfficialLayoutSession(parseLayoutSessionDocument(f.current().layoutSessions!.find(item => item.id === "reference-copy")!.document)), false);
  await assert.rejects(f.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 2, observation: mark(3), targetPointId, toleranceMeters: .02, recordedBy: "operator" }, () => true), /finalized/i);
});
test("metadata retains admission; source geometry/configuration drift blocks new marking and preserves history", async () => {
  const f = await reviewedField(), session = await freeze(f), original = session.targetDocument;
  let field = parseFieldDesignDocument(workspaceDesignSource(f.current(), "field-design").document); field.name = "Renamed field design";
  await f.execute({ type: "save_field_design", designId: "field-design", expectedDesignRevision: 1, field });
  assert.equal(getSurveyReadiness(f.current(), "field-design").status, "ready"); assert.doesNotThrow(() => assertLayoutSurveyAdmission(f.current(), original));
  field = parseFieldDesignDocument(workspaceDesignSource(f.current(), "field-design").document); field.machines[0].configuration.spanLengthsMeters[0] += 1;
  await f.execute({ type: "save_field_design", designId: "field-design", expectedDesignRevision: 2, field });
  assert.equal(getSurveyReadiness(f.current(), "field-design").status, "ready");
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "append_layout_mark", sessionId: "layout", expectedSessionRevision: 0, observation: mark(2), recordedBy: "operator" }, () => true), /configuration changed/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before); assert.equal(parseLayoutSessionDocument(f.current().layoutSessions![0].document).targetDocument, original);
  field.fieldBoundary[0].x += 1;
  await f.execute({ type: "save_field_design", designId: "field-design", expectedDesignRevision: 3, field });
  assert.equal(getSurveyReadiness(f.current(), "field-design").status, "needs_review");
});
test("complete workflow bundles retain exact review sources, old readers refuse and imports never inherit completion", async () => {
  const f = await reviewedField(), bundle = buildDesignWorkspaceBundle(f.current(), "field-design"), zipped = exportDesignWorkspaceBundleZip(bundle);
  assert.equal(bundle.bundleVersion, "cplayout-design-workspace-bundle-v2"); assert.equal(bundle.workflowSources!.reviews[0], f.current().surveyReviews![0].document);
  assert.deepEqual(importDesignWorkspaceBundleZip(zipped), bundle); assert.throws(() => parseV1DesignWorkspaceBundle(bundle), /v2 bundle reader/);
  const damaged = structuredClone(bundle); damaged.workflowSources!.reviews = []; assert.throws(() => parseDesignWorkspaceBundle(damaged), /inventory/);
  await f.execute({ type: "import_design_workspace_bundle", bundle, designId: "imported-design", payloadId: "imported-field", fieldMapId: "map", collectionIds: [{ sourceId: "control", id: "imported-control", expectedRevision: 1 }] });
  assert.equal(getSurveyReadiness(f.current(), "imported-design").status, "needs_review");
  assert.equal(f.current().workflowBundleArchives![0].document, JSON.stringify(bundle));
  assert.deepEqual(f.current().workflowConversions![0].collectionMappings[0].sourceDocument, f.current().surveyCollections![0].document);
});
test("Draft to Project to Field retains complete immutable lineage and requires each destination review", async () => {
  const f = await fixture(), field = workflowTestField();
  const collection = createSurveyCollection({ id: "draft-control", owner: { designId: "draft-design", documentKind: "draft", payloadId: "draft", fieldMapId: "map", projectCrs: "EPSG:32613" }, purpose: { kind: "point", role: "control" }, now });
  await f.execute({ type: "create_survey_collection", collection, expectedDesignRevision: 0 });
  await f.execute({ type: "append_survey_capture", collectionId: "draft-control", expectedCollectionRevision: 0, expectedDesignRevision: 0, point: workflowTestPoint() }, () => true);
  const draft = parseDesignDraftDocument(workspaceDesignSource(f.current(), "draft-design").document);
  draft.fieldBoundary = structuredClone(field.fieldBoundary); draft.pivotCenter = structuredClone(field.machines[0].pivotCenter);
  draft.waterSource = structuredClone(field.infrastructure.find(item => item.kind === "water_source")!.point);
  draft.powerSource = structuredClone(field.infrastructure.find(item => item.kind === "power_source")!.point);
  draft.machine = { id: field.machines[0].id, ...structuredClone(field.machines[0].configuration) };
  await f.execute({ type: "save_design_draft", designId: "draft-design", expectedDesignRevision: 1, draft });
  await f.execute({ type: "review_survey", reviewId: "draft-review", designId: "draft-design", expectedDesignRevision: 2, includedCollectionIds: ["draft-control"], excludedCollectionIds: [], completedBy: "operator" });
  await f.execute({ type: "create_complete_design_from_draft", sourceDesignId: "draft-design", expectedDesignRevision: 2, draft, designId: "complete-design", projectId: "complete-payload", name: "Actual complete concept", surveyCollectionIds: [{ sourceId: "draft-control", id: "complete-control", expectedRevision: 1 }] });
  assert.equal(f.current().workflowConversions!.length, 1); assert.equal(getSurveyReadiness(f.current(), "complete-design").status, "needs_review");
  assert.deepEqual(parseSurveyCollectionDocument(f.current().surveyCollections!.find(item => item.id === "complete-control")!.document).observations, [workflowTestPoint()]);
  await f.execute({ type: "review_survey", reviewId: "project-review", designId: "complete-design", expectedDesignRevision: 0, includedCollectionIds: ["complete-control"], excludedCollectionIds: [], completedBy: "operator" });
  const originalProject = workspaceDesignSource(f.current(), "complete-design").document;
  await f.execute({ type: "convert_project_to_field_design", sourceDesignId: "complete-design", expectedDesignRevision: 0, designId: "converted-design", fieldMapId: "map", name: "Independent machines", fieldId: "converted-field", waterSourceId: "converted-water", powerSourceId: "converted-power" });
  assert.equal(f.current().workflowConversions!.length, 2); assert.equal(getSurveyReadiness(f.current(), "converted-design").status, "needs_review");
  assert.equal(f.current().fieldDocuments!.find(item => item.id === "converted-field")!.originalProjectDocument, originalProject);
  const cloned = f.current().surveyCollections!.map(entry => parseSurveyCollectionDocument(entry.document)).find(item => item.owner.designId === "converted-design")!;
  assert.deepEqual(cloned.observations, [workflowTestPoint()]); assert.equal(cloned.owner.payloadId, "converted-field");
  await f.execute({ type: "review_survey", reviewId: "field-review", designId: "converted-design", expectedDesignRevision: 0, includedCollectionIds: [cloned.id], excludedCollectionIds: [], completedBy: "operator" });
  assert.equal(getSurveyReadiness(f.current(), "converted-design").status, "ready");
  const bundle = buildDesignWorkspaceBundle(f.current(), "converted-design"); assert.equal(bundle.workflowSources!.conversions.length, 2);
  assert.deepEqual(importDesignWorkspaceBundleZip(exportDesignWorkspaceBundleZip(bundle)), bundle);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY), corrupted = structuredClone(bundle);
  corrupted.workflowSources!.conversions[0].collectionMappings[0].destinationDocument = corrupted.workflowSources!.conversions[0].collectionMappings[0].sourceDocument;
  await assert.rejects(f.execute({ type: "import_design_workspace_bundle", bundle: corrupted, designId: "broken", payloadId: "broken-field", fieldMapId: "map", collectionIds: [{ sourceId: cloned.id, id: "broken-control", expectedRevision: cloned.revision }] }));
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
});
test("legacy targets are retained for viewing/export and cannot produce operational markings", async () => {
  const f = await reviewedField(), field = parseFieldDesignDocument(workspaceDesignSource(f.current(), "field-design").document);
  const targetDocument = `\n${serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 1, expectedRevision: 1, selectedMachineIds: [field.machines[0].id] }))}\n`;
  const old = createLayoutSessionDocument({ id: "old-layout", fieldMapId: "map", name: "Historical target", targetDocument, now });
  await f.execute({ type: "import_layout_session", fieldMapId: "map", document: serializeLayoutSessionDocument(old) });
  assert.equal(parseLayoutSessionDocument(f.current().layoutSessions![0].document).targetDocument, targetDocument);
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "append_layout_mark", sessionId: "old-layout", expectedSessionRevision: 0, observation: mark(2, "old-layout"), recordedBy: "operator" }, () => true), /reference history/);
  await assert.rejects(f.execute({ type: "append_layout_observation", sessionId: "old-layout", expectedSessionRevision: 0, observation: mark(2, "old-layout") }, () => true), /Legacy Layout/);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
});
test("native workflow commands refuse before opening a database", async () => {
  let opened = false; const host = new Proxy({}, { get() { return () => { opened = true; throw new Error("must not open"); }; } }); const store = createSqliteWorkspaceStore(host as never);
  await assert.rejects(store.executeAsync(0, { type: "upgrade_workspace_to_v5", now }), /supported connection/); assert.equal(opened, false);
});
