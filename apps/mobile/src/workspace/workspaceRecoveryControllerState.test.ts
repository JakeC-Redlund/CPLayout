import assert from "node:assert/strict";
import test from "node:test";
import { defaultAppSettings, parseLayoutSessionDocument, parseSurveyCollectionDocument } from "@cplayout/core";
import { readWorkspaceDesign } from "@cplayout/project-store";
import { packageFixture, packageIds } from "../../../../tests/web/workspace-package-fixtures";
import { createWorkspaceControllerState, openControllerDocument, openControllerLayout, retainControllerCollections, selectControllerMode } from "./workspaceControllerState";
import { editableFromSavedDesign, serializeWorkspaceEditable } from "./workspaceDocumentAdapters";
import { emptyWorkspaceEditRecoveryUi, resolveWorkspaceEditRecovery } from "./workspaceEditRecovery";
import { captureWorkspaceControllerRecovery, workspaceControllerStateForRecovery } from "./workspaceRecoveryControllerState";
import { captureWorkspaceOperationOwner, isWorkspaceOperationCurrent } from "./workspacePresentation";
import { workspaceHistorySnapshot } from "./workspaceIntegration";

for (const kind of ["draft", "project", "field"] as const) test(`${kind} capture/publication retains the real design, histories, Survey and immutable Layout while retiring held owners`, async () => {
  const fixture = await packageFixture(kind), workspace = structuredClone(fixture.workspace);
  // Valid noncanonical formatting is part of the acknowledged source receipt.
  for (const entry of [...workspace.surveyCollections!, ...workspace.layoutSessions!]) entry.document = "\r\n" + JSON.stringify(JSON.parse(entry.document), null, 3) + "\r\n";
  const read = readWorkspaceDesign(workspace, fixture.designId); assert.notEqual(read.kind, "not_found");
  if (read.kind === "not_found") throw new Error("Missing fixture design");
  let state = openControllerDocument(createWorkspaceControllerState(), editableFromSavedDesign(read), { dirty: false, busy: false });
  const collections = workspace.surveyCollections!.map(item => parseSurveyCollectionDocument(item.document)).filter(item => item.owner.designId === fixture.designId);
  state = retainControllerCollections(state, collections);
  const layout = parseLayoutSessionDocument(workspace.layoutSessions!.find(item => item.id === packageIds.layout)!.document);
  state = openControllerLayout(state, { session: layout, persistenceRevision: workspace.revision }, { dirty: false, busy: false });
  state = selectControllerMode(state, "survey");
  const document = serializeWorkspaceEditable(state.editable!);
  state = { ...state, selectedAddress: "retained-selection", historyPast: [workspaceHistorySnapshot(state)], historyFuture: [{ document, memberships: [] }] };
  const settings = { ...defaultAppSettings(), mapStyle: "high_contrast" as const };
  const ui = { ...emptyWorkspaceEditRecoveryUi(), settings, entry: { ...emptyWorkspaceEditRecoveryUi().entry, designTask: kind === "field" ? "machines" as const : "inputs" as const } };
  const candidate = captureWorkspaceControllerRecovery(state, { writerId: "capture", sequence: 1, capturedAt: "2026-10-11T12:00:00.000Z",
    context: { version: 2, catalogVisible: false, catalogSelection: read.context, workspace: { mode: "survey",
      design: { designId: fixture.designId, documentKind: kind, payloadId: state.editable!.identity.payloadId, fieldMapId: packageIds.field, projectCrs: state.editable!.identity.projectCrs },
      layout: { sessionId: layout.id, fieldMapId: layout.fieldMapId, projectCrs: state.mapContext!.projectCrs!, targetHash: layout.targetHash },
      collectionId: collections[0]?.id ?? null } }, workspaceRevision: workspace.revision,
    inputs: { entries: [{ key: "parked/raw", value: "  invalid input\n\t", baselineFingerprint: '""', cleanFingerprint: '""' }], focus: { key: "parked/focus/field", selection: { start: 3, end: 7 } } }, ui,
    cameras: [{ context: state.mapContext!, viewport: { center: { x: 500123, y: 4400321 }, baseWidthMeters: 800, baseHeightMeters: 500, zoomLevel: 2 }, initialized: true }] }, workspace);
  assert.equal(candidate.layout!.document, workspace.layoutSessions!.find(item => item.id === layout.id)!.document);
  candidate.collections.forEach(item => assert.equal(item.document, workspace.surveyCollections!.find(entry => entry.id === item.id)!.document));
  const result = resolveWorkspaceEditRecovery(candidate, workspace); assert.equal(result.kind, "ready");
  if ("reason" in result) throw new Error(String(result.reason));
  const held = captureWorkspaceOperationOwner(state.presentation, "interaction"), sourceBytes = JSON.stringify(workspace), candidateBytes = JSON.stringify(candidate);
  const installed = workspaceControllerStateForRecovery(state, result.admission);
  assert.equal(isWorkspaceOperationCurrent(installed.presentation, held), false);
  assert.equal(installed.presentation.mode, "survey"); assert.equal(installed.presentation.documentGeneration, state.presentation.documentGeneration + 1);
  assert.equal(installed.editable!.sourceDocument, state.editable!.sourceDocument);
  assert.equal(installed.layout!.session.targetDocument, layout.targetDocument); assert.equal(installed.layout!.session.targetHash, layout.targetHash);
  assert.deepEqual(installed.collections, collections); assert.equal(installed.selectedAddress, "retained-selection");
  assert.equal(installed.historyPast.length, 1); assert.equal(installed.historyFuture.length, 1);
  assert.equal(candidate.inputs.entries[0].value, "  invalid input\n\t"); assert.deepEqual(candidate.ui.settings, settings);
  assert.equal(JSON.stringify(workspace), sourceBytes); assert.equal(JSON.stringify(candidate), candidateBytes);
});

test("catalog-only publication renews empty ownership without inventing an editor or receiver", async () => {
  const fixture = await packageFixture("draft"), state = createWorkspaceControllerState();
  const candidate = captureWorkspaceControllerRecovery(state, { writerId: "catalog", sequence: 1, capturedAt: "2026-10-11T12:00:00.000Z",
    context: { version: 2, catalogVisible: true, catalogSelection: { clientId: null, projectId: null, fieldMapId: null, designId: null }, workspace: {
      mode: "design", design: null, layout: null, collectionId: null } }, workspaceRevision: fixture.workspace.revision,
    inputs: { entries: [], focus: null }, ui: emptyWorkspaceEditRecoveryUi(), cameras: [] }, fixture.workspace);
  const result = resolveWorkspaceEditRecovery(candidate, fixture.workspace); if ("reason" in result) throw new Error(result.reason);
  const installed = workspaceControllerStateForRecovery(state, result.admission);
  assert.equal(installed.editable, null); assert.equal(installed.layout, null); assert.equal(installed.mapContext, null);
  assert.equal(installed.presentation.document, null); assert.equal(installed.presentation.documentGeneration, 1);
  assert.deepEqual(installed.collections, []); assert.equal(installed.savedState, "saved");
});
