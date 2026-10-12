import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  convertPivotProjectToFieldDesign, sampleProject, serializeFieldDesignDocument, serializeProjectDocument,
} from "@cplayout/core";
import { editableFromIndependentDocument } from "./workspaceDocumentAdapters";
import { editableFromSavedDesign } from "./workspaceDocumentAdapters";
import { createVersionedProjectRepository, readWorkspaceDesign } from "../../../../packages/project-store/src/versionedProjectRepository";
import type { WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import {
  WORKSPACE_EDIT_RECOVERY_VERSION, WORKSPACE_EDIT_RECOVERY_V1_VERSION, WORKSPACE_EDIT_RECOVERY_V2_VERSION,
  captureWorkspaceRecoveryEditable, emptyWorkspaceEditRecoveryUi, parseWorkspaceEditRecovery,
  serializeWorkspaceEditRecovery, resolveWorkspaceEditRecovery, workspaceRecoveryUiForV3, type WorkspaceEditRecoveryCandidateV3,
} from "./workspaceEditRecovery";
import * as oldV2 from "./workspaceEditRecoveryV2Reader";
import { createWorkspaceEditRecoveryStore, WORKSPACE_EDIT_RECOVERY_KEY, WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION } from "./workspaceEditRecoveryStore";

const now = "2026-10-11T12:00:00.125Z";
function empty(writerId = "v3-writer"): WorkspaceEditRecoveryCandidateV3 {
  return { recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION, writerId, sequence: 1, capturedAt: now,
    context: { version: 2, catalogVisible: true, catalogSelection: { clientId: null, projectId: null, fieldMapId: null, designId: null },
      workspace: { mode: "design", design: null, layout: null, collectionId: null } }, workspaceRevision: null,
    editable: null, collections: [], layout: null, controller: { historyPast: [], historyFuture: [], selectedAddress: null },
    inputs: { entries: [], focus: null }, ui: emptyWorkspaceEditRecoveryUi(), cameras: [] };
}
function fieldPending() {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "field-source", waterSourceId: "water", powerSourceId: "power" }).field;
  const editable = editableFromIndependentDocument("field", serializeFieldDesignDocument(field));
  const candidate = empty();
  return { ...candidate, editable: captureWorkspaceRecoveryEditable(editable), ui: { ...candidate.ui, entry: { ...candidate.ui.entry,
    designTask: "drawing" as const, drawing: { geometryType: "LineString" as const,
      vertices: [{ x: 501001.123456789, y: 4506201.987654321 }, { x: 501025.25, y: 4506250.875 }],
      vertexRecordedAt: [now, "2026-10-11T12:00:01.750Z"], stage: "drawing" as const,
      selectionId: "pipeline:underground", name: "Exact unfinished name  ", notes: "Exact unfinished notes\nretain",
      detailsOpen: true, choicesOpen: false, error: null, replacing: false, captureId: "actual-map-capture", paused: false } } } };
}

test("original v2 source reader is exact and refuses v3 before consumer mutation", () => {
  const manifest = JSON.parse(readFileSync(new URL("./workspaceEditRecoveryV2Reader.json", import.meta.url), "utf8"));
  const actual = createHash("sha256").update(readFileSync(new URL("./workspaceEditRecoveryV2Reader.ts", import.meta.url))).digest("hex");
  assert.equal(actual, manifest.sourceSha256); assert.equal(actual, "70c8de4183f3a4fe0575b3b9b2d3e062212642f2388da45febc8b7c5ef19ed86");
  assert.equal(oldV2.WORKSPACE_EDIT_RECOVERY_VERSION, WORKSPACE_EDIT_RECOVERY_V2_VERSION);
  let mutations = 0;
  assert.throws(() => { oldV2.parseWorkspaceEditRecovery(serializeWorkspaceEditRecovery(fieldPending())); mutations++; }, /Unsupported edit recovery version/);
  assert.equal(mutations, 0);
});

test("legacy v1 and v2 reading/serialization retain their exact version and original UI omission", () => {
  for (const recoveryVersion of [WORKSPACE_EDIT_RECOVERY_V1_VERSION, WORKSPACE_EDIT_RECOVERY_V2_VERSION]) {
    const input = { ...empty(), recoveryVersion }, oldParsed = oldV2.parseWorkspaceEditRecovery(input);
    const original = oldV2.serializeWorkspaceEditRecovery(oldParsed), raw = JSON.stringify(JSON.parse(original), null, 2).replace(/\n/g, "\r\n");
    const current = parseWorkspaceEditRecovery(raw);
    assert.deepEqual(current, oldV2.parseWorkspaceEditRecovery(raw));
    assert.equal(current.recoveryVersion, recoveryVersion); assert.equal(serializeWorkspaceEditRecovery(current), original);
    assert.equal(Object.hasOwn(current.ui.catalog, "startMode"), false);
    assert.equal(Object.hasOwn(current.ui.layout, "targetPointId"), false);
  }
});

test("v3 Field pending drawing retains exact map points, raw details and original source without domain mutation", () => {
  const input = fieldPending(), original = structuredClone(input);
  const parsed = parseWorkspaceEditRecovery(serializeWorkspaceEditRecovery(input));
  assert.equal(parsed.recoveryVersion, WORKSPACE_EDIT_RECOVERY_VERSION);
  assert.deepEqual(parsed.ui.entry.drawing, input.ui.entry.drawing);
  assert.equal(parsed.editable!.sourceDocument, input.editable.sourceDocument);
  assert.equal(parsed.editable!.workingDocument, input.editable.workingDocument);
  assert.deepEqual(parsed.editable!.editor.past, []); assert.deepEqual(input, original);
  for (const recoveryVersion of [WORKSPACE_EDIT_RECOVERY_V1_VERSION, WORKSPACE_EDIT_RECOVERY_V2_VERSION]) {
    assert.throws(() => parseWorkspaceEditRecovery({ ...input, recoveryVersion }), /another editor owner/);
    assert.throws(() => oldV2.parseWorkspaceEditRecovery({ ...input, recoveryVersion }), /another editor owner/);
  }
});

test("v3 recovery rejects Field circles, timestamp drift and unknown future versions", () => {
  const input = fieldPending();
  assert.throws(() => parseWorkspaceEditRecovery({ ...input, ui: { ...input.ui, entry: { ...input.ui.entry,
    drawing: { ...input.ui.entry.drawing, geometryType: "Circle" } } } }), /Field recovery only supports/);
  assert.throws(() => parseWorkspaceEditRecovery({ ...input, ui: { ...input.ui, entry: { ...input.ui.entry,
    drawing: { ...input.ui.entry.drawing, vertexRecordedAt: [now] } } } }), /ordered timestamps/);
  assert.throws(() => parseWorkspaceEditRecovery({ ...input, recoveryVersion: "cplayout-unified-edit-recovery-v4" }), /Unsupported edit recovery version/);
});

test("saved Field recovery admits parked manual input against exact source and refuses later ownership/source drift", async () => {
  const values = new Map<string, string>();
  const api = createVersionedProjectRepository({ getStorage: () => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); } }), getLocks: () => ({ request: async (_name, _options, run) => run() }) }).versionedWorkspace!;
  let workspace = await api.readAsync();
  async function execute(input: object) {
    const receipt = await api.executeAsync(workspace.revision, { ...input, now } as WorkspaceCommand, () => true);
    workspace = receipt.workspace;
  }
  await execute({ type: "create_client", id: "client", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Field" } });
  await execute({ type: "create_project_with_initial_field_map", input: { clientId: "client", projectId: "project", fieldMapId: "map",
    projectName: "Actual folder", fieldMapName: "Actual field", projectCrs: "EPSG:32613", unitSystem: "metric" } });
  await execute({ type: "upgrade_workspace_to_v3" });
  const originalProjectDocument = serializeProjectDocument(sampleProject);
  const field = convertPivotProjectToFieldDesign(originalProjectDocument, { fieldId: "field-source", waterSourceId: "water", powerSourceId: "power" }).field;
  await execute({ type: "create_field_design", designId: "design", fieldMapId: "map", name: "Actual design", field, originalProjectDocument });
  await execute({ type: "upgrade_workspace_to_v4" });
  const read = readWorkspaceDesign(workspace, "design"); assert.notEqual(read.kind, "not_found");
  if (read.kind === "not_found") assert.fail("Missing saved Field fixture");
  const editable = editableFromSavedDesign(read), input = fieldPending();
  const candidate: WorkspaceEditRecoveryCandidateV3 = { ...input, workspaceRevision: workspace.revision,
    editable: captureWorkspaceRecoveryEditable(editable), context: { ...input.context, catalogVisible: false, catalogSelection: { ...read.context },
      workspace: { ...input.context.workspace, design: { designId: "design", documentKind: "field", payloadId: "field-source", fieldMapId: "map", projectCrs: "EPSG:32613" } } } };
  const before = JSON.stringify(workspace), resolved = resolveWorkspaceEditRecovery(candidate, workspace);
  assert.equal(resolved.kind, "ready"); if (!("admission" in resolved)) assert.fail("Field pending recovery was not admitted");
  assert.deepEqual(resolved.admission.ui.entry.drawing!.vertices, candidate.ui.entry.drawing!.vertices);
  assert.equal(resolved.admission.ui.entry.drawing!.paused, true); assert.equal(resolved.admission.ui.entry.drawing!.name, "Exact unfinished name  ");
  assert.equal(resolved.admission.editable!.sourceDocument, candidate.editable!.sourceDocument);
  assert.equal(JSON.stringify(workspace), before); assert.equal(resolved.admission.candidate.ui.entry.drawing!.paused, false);
  const changed = structuredClone(workspace); changed.catalog.designs.find(item => item.id === "design")!.revision++;
  assert.equal(resolveWorkspaceEditRecovery(candidate, changed).kind, "source_conflict");
});

test("v3 captures new workflow selection/target/tolerance raw state without accepting those keys under legacy versions", () => {
  const input = empty();
  const ui = { ...input.ui, catalog: { ...input.ui.catalog, startMode: "survey" as const },
    survey: { ...input.ui.survey, reviewIncludedIds: ["actual-collection-1", "actual-collection-2"] },
    layout: { ...input.ui.layout, targetPointId: "actual-target", toleranceText: " 0.invalid \n " } };
  const parsed = parseWorkspaceEditRecovery({ ...input, ui });
  assert.equal(parsed.ui.catalog.startMode, "survey"); assert.deepEqual(parsed.ui.survey.reviewIncludedIds, ui.survey.reviewIncludedIds);
  assert.equal(parsed.ui.layout.targetPointId, "actual-target"); assert.equal(parsed.ui.layout.toleranceText, " 0.invalid \n ");
  for (const recoveryVersion of [WORKSPACE_EDIT_RECOVERY_V1_VERSION, WORKSPACE_EDIT_RECOVERY_V2_VERSION])
    assert.throws(() => parseWorkspaceEditRecovery({ ...input, ui, recoveryVersion }), /Unknown or missing recovery fields/);
  assert.throws(() => parseWorkspaceEditRecovery({ ...input, ui: { ...ui, survey: { ...ui.survey, reviewIncludedIds: ["duplicate", "duplicate"] } } }), /Duplicate recovery identity/);
  const old = oldV2.parseWorkspaceEditRecovery({ ...input, recoveryVersion: WORKSPACE_EDIT_RECOVERY_V2_VERSION });
  const normalized = workspaceRecoveryUiForV3(old.ui);
  assert.equal(normalized.catalog.startMode, "design"); assert.equal(normalized.survey.reviewIncludedIds, null); assert.equal(normalized.layout.targetPointId, null);
  assert.equal(Object.hasOwn(old.ui.catalog, "startMode"), false); assert.equal(old.recoveryVersion, WORKSPACE_EDIT_RECOVERY_V2_VERSION);
});

test("mixed v1/v2/v3 ledger export retains literal raw slots and does not rewrite old recovery data", async () => {
  const candidates = [
    { ...empty("legacy-one"), recoveryVersion: WORKSPACE_EDIT_RECOVERY_V1_VERSION },
    { ...empty("legacy-two"), recoveryVersion: WORKSPACE_EDIT_RECOVERY_V2_VERSION },
    { ...fieldPending(), writerId: "current-three" },
  ];
  const raw = JSON.stringify({ ledgerVersion: WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, slots: candidates.map(candidate => ({
    writerId: candidate.writerId, sequence: 1, raw: JSON.stringify(candidate, null, 2).replace(/\n/g, "\r\n") })) }, null, 2);
  let writes = 0;
  const store = createWorkspaceEditRecoveryStore({ backend: "web", withExclusiveLock: async (_name, run) => run(),
    storage: { getItem(key) { assert.equal(key, WORKSPACE_EDIT_RECOVERY_KEY); return raw; }, setItem() { writes++; } } });
  const read = await store.readCandidates(); assert.deepEqual(read.map(item => item.candidate.recoveryVersion), [WORKSPACE_EDIT_RECOVERY_V1_VERSION, WORKSPACE_EDIT_RECOVERY_V2_VERSION, WORKSPACE_EDIT_RECOVERY_VERSION]);
  assert.equal(await store.exportRawLedger(), raw); assert.equal(writes, 0);
  for (const item of read) assert.equal(await store.exportCandidate(item.writerId), item.raw);
});
