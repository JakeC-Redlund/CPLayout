import assert from "node:assert/strict";
import test from "node:test";
import { workflowTestField, workflowTestPoint, workflowTestTime as now } from "../../core/src/productionWorkflowTestFixtures";
import { createSurveyCollection } from "../../core/src/surveyCollection";
import { parseLayoutSessionDocument } from "../../core/src/layoutSession";
import { parseFieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { layoutLockFromReceiverCapture } from "../../core/src/officialLayout";
import { applyWorkspaceCommand, type WorkspaceCommand } from "./workspaceCommands";
import { createWorkspaceDesign, emptyWorkspaceDocument, serializeWorkspaceDocument, workspaceDesignSource, type WorkspaceDocument } from "./workspaceDocument";
import { sampleProject } from "../../core/src/sampleProject";
import { retainedSurveyHistory, workspaceFieldContents } from "./workspaceFieldContents";

function fixture(includeEmptyDesign = true) {
  let workspace = emptyWorkspaceDocument();
  const command = (input: Omit<WorkspaceCommand, "now"> | object) => { workspace = applyWorkspaceCommand(workspace, { ...input, now } as WorkspaceCommand).workspace; };
  command({ type: "create_client", id: "customer", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  command({ type: "upgrade_workspace_to_v5" });
  if (includeEmptyDesign) command({ type: "start_project_work", clientId: "customer", projectId: "project", fieldMapId: "field-folder", designId: "empty-design", draftId: "empty-draft",
    projectName: "Actual project", fieldName: "Actual field", workName: "Empty saved design", unitSystem: "metric", initialMode: "design", projectCrs: "EPSG:32613" });
  else {
    command({ type: "create_project_record", input: { id: "project", clientId: "customer", name: "Actual project", projectCrs: "EPSG:32613", unitSystem: "metric" } });
    command({ type: "create_field_map_record", input: { id: "field-folder", projectId: "project", name: "Actual field" } });
  }
  const field = { ...workflowTestField(), id: "field-a" };
  command({ type: "create_field_design", designId: "design-a", fieldMapId: "field-folder", name: "Shared name", field });
  return { command, workspace: () => workspace, set: (value: WorkspaceDocument) => { workspace = value; }, field };
}
function reviewed(includeEmptyDesign = true) {
  const f = fixture(includeEmptyDesign);
  const collection = createSurveyCollection({ id: "control", owner: { designId: "design-a", documentKind: "field", payloadId: "field-a", fieldMapId: "field-folder", projectCrs: f.field.projectCrs },
    purpose: { kind: "point", role: "control" }, now });
  f.command({ type: "create_survey_collection", collection, expectedDesignRevision: 0 });
  f.command({ type: "append_survey_capture", collectionId: "control", expectedCollectionRevision: 0, expectedDesignRevision: 0, point: workflowTestPoint() });
  f.command({ type: "review_survey", designId: "design-a", expectedDesignRevision: 1, reviewId: "review-a", includedCollectionIds: ["control"], excludedCollectionIds: [], completedBy: "synthetic-operator" });
  return f;
}
function official() {
  const f = reviewed();
  f.command({ type: "create_rtk_layout_session", sessionId: "official", name: "Measured stations", designId: "design-a", expectedDesignRevision: 1, reviewId: "review-a",
    selectedMachineIds: [f.field.machines[0].id], creationLock: layoutLockFromReceiverCapture(workflowTestPoint(2), "synthetic-operator") });
  const session = parseLayoutSessionDocument(f.workspace().layoutSessions![0].document), target = parseFieldLayoutTarget(session.targetDocument), point = workflowTestPoint(3);
  f.command({ type: "append_layout_mark", sessionId: session.id, expectedSessionRevision: 0, targetPointId: target.targetPoints![0].id, toleranceMeters: 0.1, recordedBy: "synthetic-operator",
    observation: { id: point.id, sessionId: session.id, capturedAt: now, projected: point.projected, evidence: point.captureEvidence } });
  f.command({ type: "finalize_rtk_layout_session", sessionId: session.id, expectedSessionRevision: 1, finalizationLock: layoutLockFromReceiverCapture(workflowTestPoint(4), "synthetic-operator") });
  return f;
}

test("field content uses actual document and machine addresses across same-named variants and retains an empty saved design", () => {
  const f = fixture(), before = serializeWorkspaceDocument(f.workspace());
  const empty = workspaceFieldContents(f.workspace(), "field-folder").designs.find(item => item.designId === "empty-design")!;
  assert.equal(empty.payloadId, "empty-draft"); assert.equal(empty.hasMapContent, false); assert.deepEqual(empty.machineAddresses, []);
  assert.equal(serializeWorkspaceDocument(f.workspace()), before);
  f.command({ type: "create_field_design", designId: "design-b", fieldMapId: "field-folder", name: "Shared name", field: { ...f.field, id: "field-b" } });
  const contents = workspaceFieldContents(f.workspace(), "field-folder"), addresses = contents.designs.flatMap(item => item.machineAddresses);
  assert.deepEqual(addresses.map(item => [item.designId, item.payloadId, item.machineId]), [["design-a", "field-a", f.field.machines[0].id], ["design-b", "field-b", f.field.machines[0].id]]);
  assert(contents.designs.filter(item => item.designId !== "empty-design").every(item => item.hasMapContent));
  assert.throws(() => workspaceFieldContents(f.workspace(), "guessed-folder"), /unavailable/);
});

test("a partial draft machine retains an absent machine ID without creating an identity", () => {
  const f = fixture(), source = workspaceDesignSource(f.workspace(), "empty-design");
  const envelope = JSON.parse(source.document); envelope.draft.machine = { name: "Actual entered machine name" };
  f.set({ ...f.workspace(), draftDocuments: f.workspace().draftDocuments.map(entry => entry.id === "empty-draft" ? { ...entry, document: JSON.stringify(envelope) } : entry) });
  const content = workspaceFieldContents(f.workspace(), "field-folder").designs.find(item => item.designId === "empty-design")!;
  assert.deepEqual(content.machineAddresses, [{ designId: "empty-design", payloadId: "empty-draft", machineId: null, kind: "draft_machine" }]);
  assert.equal(content.hasMapContent, false);
});

test("a supported legacy design with retained extension data remains browsable without using the mutation reader", () => {
  const f = fixture(), project = { ...structuredClone(sampleProject), id: "legacy-project", machine: { ...sampleProject.machine, extension: { retained: "synthetic vendor details" } } };
  const workspace = createWorkspaceDesign(f.workspace(), { design: { id: "legacy-design", kind: "project", fieldMapId: "field-folder", pivotProjectId: project.id,
    name: "Retained legacy design", revision: 0, isActive: true, createdAt: now, updatedAt: now }, document: JSON.stringify(project) });
  const before = serializeWorkspaceDocument(workspace), row = workspaceFieldContents(workspace, "field-folder").designs.find(item => item.designId === "legacy-design")!;
  assert.equal(row.machineAddresses[0].machineId, project.machine.id); assert.equal(row.hasMapContent, true);
  assert.equal(serializeWorkspaceDocument(workspace), before);
  assert.deepEqual(JSON.parse(workspaceDesignSource(workspace, "legacy-design").document).machine.extension, project.machine.extension);
});

test("actual review anchors its matching RTK Layout while legacy targets and reference imports remain separate", () => {
  const f = official();
  f.command({ type: "create_reviewed_layout_session", sessionId: "legacy-v2", name: "Historical target", designId: "design-a", expectedDesignRevision: 1, reviewId: "review-a", selectedMachineIds: [f.field.machines[0].id] });
  const before = serializeWorkspaceDocument(f.workspace()), content = workspaceFieldContents(f.workspace(), "field-folder");
  assert.equal(serializeWorkspaceDocument(f.workspace()), before);
  assert.equal(content.surveys.length, 1); assert.deepEqual(content.surveys[0].layoutSessionIds, ["official"]);
  assert.deepEqual(content.surveys[0].includedCollectionIds, ["control"]); assert.equal(content.surveys[0].current, true);
  assert.deepEqual(content.unreviewedCollections, []); assert.deepEqual(content.referenceLayoutSessionIds, ["legacy-v2"]);
  const reference = reviewed(), exact = f.workspace().layoutSessions!.find(entry => entry.id === "official")!.document;
  reference.command({ type: "import_layout_session", document: exact, fieldMapId: "field-folder" });
  const imported = workspaceFieldContents(reference.workspace(), "field-folder");
  assert.deepEqual(imported.surveys[0].layoutSessionIds, []); assert.deepEqual(imported.referenceLayoutSessionIds, ["official"]);
  assert.equal(parseLayoutSessionDocument(reference.workspace().layoutSessions![0].document).documentVersion, "layout-session-v3");
});

test("unreviewed collections retain their actual IDs and counts without becoming saved Surveys", () => {
  const f = fixture(), collection = createSurveyCollection({ id: "unreviewed", owner: { designId: "design-a", documentKind: "field", payloadId: "field-a", fieldMapId: "field-folder", projectCrs: f.field.projectCrs }, purpose: { kind: "point", role: "control" }, now });
  f.command({ type: "create_survey_collection", collection, expectedDesignRevision: 0 });
  f.command({ type: "append_survey_capture", collectionId: collection.id, expectedCollectionRevision: 0, expectedDesignRevision: 0, point: workflowTestPoint() });
  const contents = workspaceFieldContents(f.workspace(), "field-folder");
  assert.deepEqual(contents.surveys, []); assert.deepEqual(contents.unreviewedCollections, [{ designId: "design-a", collectionId: collection.id, purposeLabel: "Point · control", observationCount: 1 }]);
});

test("archived sources preserve exact raw text and classify a previously valid missing parent without guessed folders", () => {
  const f = reviewed(false), stored = f.workspace().fieldDocuments!.find(entry => entry.id === "field-a")!, exact = `\r\n${stored.document.replaceAll("\n", "\r\n")}\r\n `;
  f.set({ ...f.workspace(), fieldDocuments: f.workspace().fieldDocuments!.map(entry => entry.id === stored.id ? { ...entry, document: exact } : entry) });
  f.command({ type: "archive_and_delete_design", designId: "design-a", expectedDesignRevision: 1, collectionIds: [{ id: "control", expectedRevision: 1 }] });
  assert.equal(retainedSurveyHistory(f.workspace())[0].missingParent, false);
  // Explicit historical fixture: future deletion is refused by the new writer guards.
  const history = { ...f.workspace(), catalog: { clients: [], projects: [], fieldMaps: [], designs: [] }, draftDocuments: [] };
  const rows = retainedSurveyHistory(history);
  assert.equal(rows.length, 1); assert.equal(rows[0].missingParent, true); assert.equal(rows[0].document, exact);
  assert.deepEqual(rows[0].collectionIds, ["control"]); assert.equal(rows[0].fieldMapId, "field-folder");
  assert.deepEqual(history.catalog.clients, []);
});
