import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import type { GnssSession } from "@cplayout/gnss";
import { ReceiverSessionOwner } from "../gnss/receiverSessionOwner";
import { proposeSurveyCaptureAppend, proposeSurveyClear, serializeSurveyCollectionDocument } from "@cplayout/core";
import { URL as NodeURL } from "node:url";
import { sampleProject, serializeProjectDocument, parseDesignDraftDocument, parseProjectDocument, defaultProjectSettings, createSurveyCollection, parseSurveyCollectionDocument, projectLonLatToXy, createFieldLayoutTarget, serializeFieldLayoutTarget, parseLayoutSessionDocument, type SurveyPoint, type OperationalFixedGgaEvidence } from "@cplayout/core";
import { applyWorkspaceCommand, emptyWorkspaceDocument, readWorkspaceDesign, type WorkspaceDocument } from "@cplayout/project-store";
import { editableFromSavedDesign, editableFromIndependentDocument, reduceWorkspaceEditable, restoreWorkspaceEditableDocument, serializeWorkspaceEditable, workspaceSaveTarget, workspaceSavePayload, acknowledgeWorkspaceSave } from "./workspaceDocumentAdapters";
import { createWorkspaceControllerState, openControllerDocument, reduceControllerDocument, retainControllerCollections, openControllerLayout, acceptControllerLayoutReceipt } from "./workspaceControllerState";
import { captureWorkspaceSiblingProof, reconcileWorkspaceSibling, calculateWorkspaceEditable, calculationIsCurrent,
  workspaceHistorySnapshot, recordWorkspaceHistory, historyMemberships, workspacePendingBlocksReplacement } from "./workspaceIntegration";
import { createVersionedProjectRepository } from "../../../../packages/project-store/src/versionedProjectRepository";
import { WEB_WORKSPACE_KEY, WEB_WORKSPACE_BACKUP_KEY } from "../../../../packages/project-store/src/webWorkspaceStore";
import { InputRetentionStore, createInputRetentionBaseline } from "../inputRetention";
import { createEditorSaveCoordinator } from "../editorSaveCoordinator";

const now = "2026-10-10T12:00:00.000Z";

for (const kind of ["project", "draft", "field"] as const) test(`shared ${kind} adapter preserves detached reference authority through Delete, Save, Undo and Save`, async () => {
  let { workspace } = managed();
  const execute = (command: Parameters<typeof applyWorkspaceCommand>[1]) => { workspace = applyWorkspaceCommand(workspace, command).workspace; };
  execute({ type: "upgrade_workspace_to_v3", now });
  let designId = "design";
  if (kind === "draft") {
    designId = "adapter-draft";
    execute({ type: "create_design_draft", now, designId, fieldMapId: "map", name: "Adapter Draft",
      draft: { ...structuredClone(sampleProject), id: "adapter-draft-payload", settings: defaultProjectSettings() } });
  } else if (kind === "field") {
    designId = "adapter-field";
    execute({ type: "convert_project_to_field_design", now, sourceDesignId: "design", expectedDesignRevision: 0,
      designId, fieldMapId: "map", name: "Adapter Field", fieldId: "adapter-field-payload", waterSourceId: "adapter-water", powerSourceId: "adapter-power" });
  }
  execute({ type: "upgrade_workspace_to_v4", now });
  const owner = readWorkspaceDesign(workspace, designId);
  if (owner.kind === "not_found") throw new Error("Missing fixture owner");
  const data = owner.kind === "draft" ? owner.draft : owner.kind === "field" ? owner.field : owner.project;
  const collection = createSurveyCollection({ id: "adapter-reference", now,
    owner: { designId, documentKind: kind, payloadId: data.id, fieldMapId: "map", projectCrs: data.projectCrs! },
    purpose: { kind: "map_feature", featureKind: "reference_line", geometryType: "LineString" } });
  execute({ type: "create_survey_collection", now, expectedDesignRevision: owner.design.revision, collection });
  execute({ type: "append_survey_capture", now, collectionId: collection.id, expectedCollectionRevision: 0, expectedDesignRevision: owner.design.revision, point: capturedPoint(1) });
  execute({ type: "append_survey_capture", now, collectionId: collection.id, expectedCollectionRevision: 1, expectedDesignRevision: owner.design.revision, point: capturedPoint(2, 40.001) });
  execute({ type: "apply_survey_collection", now, collectionId: collection.id, expectedCollectionRevision: 2,
    expectedDesignRevision: owner.design.revision, applicationId: "adapter-application", targetId: "adapter-feature", reference: { name: "Exact detached reference  " } });
  const applied = readWorkspaceDesign(workspace, designId);
  if (applied.kind === "not_found") throw new Error("Missing applied source");
  execute({ type: "import_design_document", now, document: applied.document, designId: "adapter-detached", payloadId: "adapter-detached-payload", fieldMapId: "map" });
  const detached = readWorkspaceDesign(workspace, "adapter-detached");
  if (detached.kind === "not_found") throw new Error("Missing imported reference");
  const current = editableFromSavedDesign(detached), original = serializeWorkspaceEditable(current);
  const envelope = JSON.parse(original), payload = envelope.project ?? envelope.draft ?? envelope.field;
  const origins = structuredClone(payload.drawingMetadata.retainedReferenceOrigins);
  assert.equal(origins.length, 1);
  assert.equal(payload.drawingMetadata.records.find((record: { target: { id?: string } }) => record.target.id === "adapter-feature").attachment, undefined);
  payload.mapFeatures = payload.mapFeatures.filter((feature: { id: string }) => feature.id !== "adapter-feature");
  payload.drawingMetadata.records = payload.drawingMetadata.records.filter((record: { target: { id?: string } }) => record.target.id !== "adapter-feature");
  const deleted = restoreWorkspaceEditableDocument(current, JSON.stringify(envelope));
  const store = stored(workspace);
  const persist = async (editable: typeof current) => {
    const source = await store.api.readAsync(), request = workspaceSavePayload(editable), document = serializeWorkspaceEditable(editable);
    const command = request.kind === "project" ? { type: "save_design_project" as const, now, designId: "adapter-detached", project: request.project }
      : request.kind === "draft" ? { type: "save_design_draft" as const, now, designId: "adapter-detached", expectedDesignRevision: editable.designRevision!, draft: request.draft }
        : { type: "save_field_design" as const, now, designId: "adapter-detached", expectedDesignRevision: editable.designRevision!, field: request.field };
    const result = await store.api.executeAsync(source.revision, command);
    const read = readWorkspaceDesign(result.workspace, "adapter-detached");
    if (read.kind === "not_found") throw new Error("Missing saved reference");
    return acknowledgeWorkspaceSave(editable, read, { document, editorRevision: editable.editor.revision });
  };
  const savedDeletion = await persist(deleted);
  const restored = restoreWorkspaceEditableDocument(savedDeletion, original);
  assert.equal(restored.sourceDocument, savedDeletion.sourceDocument);
  assert.deepEqual(restored.identity, current.identity);
  const savedRestoration = await persist(restored);
  assert.equal(serializeWorkspaceEditable(savedRestoration), original);
  const final = await store.api.readAsync();
  assert.equal(final.surveyCollections!.some(entry => parseSurveyCollectionDocument(entry.document).owner.designId === "adapter-detached"), false);
  const sourceAfter = readWorkspaceDesign(final, designId);
  assert.notEqual(sourceAfter.kind, "not_found");
  if (sourceAfter.kind !== "not_found") assert.equal(sourceAfter.document, applied.document);
});
function managed() {
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "client", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_design", now, input: { clientId: "client", project: structuredClone(sampleProject), fieldMapId: "map", designId: "design" } }).workspace;
  const read = readWorkspaceDesign(workspace, "design");
  if (read.kind === "not_found") throw new Error("Fixture design was not created.");
  return { workspace, editable: editableFromSavedDesign(read) };
}

test("sibling proof advances only receipt while retaining dirty values, selection and exact undo objects", () => {
  const f = managed();
  const dirty = reduceWorkspaceEditable(f.editable, { kind: "project", action: { type: "update_machine", machine: { ...sampleProject.machine, name: "Unsaved operator machine" } } });
  const proof = captureWorkspaceSiblingProof(dirty, f.workspace);
  const next = applyWorkspaceCommand(f.workspace, { type: "create_client", now, id: "sibling", input: { primaryContactFirstName: "Other", primaryContactLastName: "Synthetic" } }).workspace;
  const advanced = reconcileWorkspaceSibling(dirty, proof, next);
  assert.equal(advanced.editor, dirty.editor); assert.equal(advanced.identity, dirty.identity);
  assert.equal(advanced.sourceDocument, dirty.sourceDocument);
  assert.equal(advanced.workspaceRevision, next.revision); assert.equal(advanced.savedEditorRevision, dirty.savedEditorRevision);
  assert.equal(serializeWorkspaceEditable(advanced), serializeWorkspaceEditable(dirty));
});

test("proof rejects changed bytes, owning association, source revision and missing designs", () => {
  const f = managed(), proof = captureWorkspaceSiblingProof(f.editable, f.workspace);
  const changed = applyWorkspaceCommand(f.workspace, { type: "save_design_project", now, designId: "design", project: { ...sampleProject, name: "Other writer" } }).workspace;
  assert.throws(() => reconcileWorkspaceSibling(f.editable, proof, changed), /changed.*design/i);
  const other = applyWorkspaceCommand(f.workspace, { type: "create_client", now, id: "other", input: { primaryContactFirstName: "Other", primaryContactLastName: "Owner" } }).workspace;
  const moved = applyWorkspaceCommand(other, { type: "move_project_to_client", now, projectId: sampleProject.id, clientId: "other" }).workspace;
  assert.throws(() => reconcileWorkspaceSibling(f.editable, proof, moved), /ownership/i);
  const deleted = applyWorkspaceCommand(f.workspace, { type: "delete_design", now, designId: "design", expectedDesignRevision: 0 }).workspace;
  assert.throws(() => reconcileWorkspaceSibling(f.editable, proof, deleted), /changed.*design/i);
});

test("explicit read reconciliation requires exact unchanged source even when another unrelated tab advanced workspace", () => {
  const f = managed();
  const next = applyWorkspaceCommand(f.workspace, { type: "create_client", now, id: "tab", input: { primaryContactFirstName: "Other", primaryContactLastName: "Tab" } }).workspace;
  assert.throws(() => captureWorkspaceSiblingProof(f.editable, next), /receipt changed/i);
  const proof = captureWorkspaceSiblingProof(f.editable, next, true);
  assert.equal(reconcileWorkspaceSibling(f.editable, proof, next).workspaceRevision, next.revision);
});

test("compound history restores membership without discarding a newly created immutable collection ledger", () => {
  const f = managed();
  const before = openControllerDocument(createWorkspaceControllerState(), f.editable, { dirty: false, busy: false });
  const collection = createSurveyCollection({ id: "collection", now, purpose: { kind: "field_boundary" }, owner: { designId: "design", documentKind: "project", payloadId: sampleProject.id, fieldMapId: "map", projectCrs: sampleProject.projectCrs } });
  const after = recordWorkspaceHistory(before, retainControllerCollections(before, [collection]));
  assert.equal(after.historyPast.length, 1);
  assert.deepEqual(historyMemberships(after.historyPast[0], after.collections), [{ collectionId: "collection", expectedCollectionRevision: 0, activePointIds: [], state: "cleared" }]);
  assert.deepEqual(after.collections[0], collection);
  assert.deepEqual(after.collections[0].observations, []);
  assert.deepEqual(after.collections[0].applications, []);
  const changed = reduceControllerDocument(after, { kind: "project", action: { type: "update_machine", machine: { ...sampleProject.machine, name: "Operator machine change" } } });
  assert.equal(changed.historyPast.length, 2);
  const restored = restoreWorkspaceEditableDocument(changed.editable!, changed.historyPast.at(-1)!.document);
  assert.equal(restored.workspaceRevision, changed.editable!.workspaceRevision);
  assert.equal(restored.sourceDocument, changed.editable!.sourceDocument);
  assert.equal(serializeWorkspaceEditable(restored), workspaceHistorySnapshot(after).document);
});

test("actual calculation uses real supplied Project and refuses incomplete Draft without manufactured fields", () => {
  const f = managed(); const preview = calculateWorkspaceEditable(f.editable);
  assert.deepEqual(preview.machineIds, [sampleProject.machine.id]); assert.equal(calculationIsCurrent(preview, f.editable), true);
  const changed = reduceWorkspaceEditable(f.editable, { kind: "project", action: { type: "update_machine", machine: { ...sampleProject.machine, name: "New machine input" } } });
  assert.equal(calculationIsCurrent(preview, changed), false);
  const settings = defaultProjectSettings();
  const draft = editableFromIndependentDocument("draft", JSON.stringify({ documentVersion: "design-draft-v1", draft: { id: "partial", name: "Incomplete", projectCrs: null,
    unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] } }));
  const before = serializeWorkspaceEditable(draft);
  assert.throws(() => calculateWorkspaceEditable(draft));
  assert.equal(serializeWorkspaceEditable(draft), before);
});

test("one queue serializes a target-only sibling before a managed receipt refresh, preserving session identity", async () => {
  const coordinator = createEditorSaveCoordinator(), order: string[] = [];
  await coordinator.exclusive({ isCurrent: () => true,
    async write(target) { assert.equal(target, null); order.push("catalog"); return { value: "actual result", previousRevision: 0, persistenceRevision: 1 }; } });
  const session = coordinator.open({ kind: "draft", payloadId: "draft", designId: "design", workspaceRevision: 1, designRevision: 0 });
  await coordinator.reconcileRead({ session, isCurrent: () => true,
    async read(target) { assert.equal(target.workspaceRevision, 1); return { value: "proof", workspaceRevision: 2, designRevision: 0 }; },
    onCommitted(value) { assert.equal(value, "proof"); order.push("receipt"); } });
  assert.equal(coordinator.isCurrent(session), true); assert.equal(coordinator.receipt(session).workspaceRevision, 2);
  assert.deepEqual(order, ["catalog", "receipt"]);
  await assert.rejects(coordinator.reconcileRead({ session, isCurrent: () => true, async read() { return { value: null, workspaceRevision: 3, designRevision: 1 }; }, onCommitted() {} }), /changed design/i);
});

test("catalog close allowance preserves its own pending flag and cannot bypass another input owner", () => {
  const pending = new Set(["catalog"]);
  assert.equal(workspacePendingBlocksReplacement(pending), true);
  assert.equal(workspacePendingBlocksReplacement(pending, ["catalog"]), false);
  assert.deepEqual([...pending], ["catalog"]);
  pending.add("layout-label");
  assert.equal(workspacePendingBlocksReplacement(pending, ["catalog"]), true);
  assert.throws(() => workspacePendingBlocksReplacement(pending, ["catalog", "layout-label"]), /only.*catalog/i);
});

/** Synthetic checksummed receiver fields test structural/transaction behavior;
 * they make no live transport or physical accuracy claim. */
function capturedPoint(sequence: number, latitude = 40, longitude = -105): SurveyPoint {
  const coord = (value: number, width: number) => `${String(Math.floor(Math.abs(value))).padStart(width, "0")}${((Math.abs(value) % 1) * 60).toFixed(4).padStart(7, "0")}`;
  const utcTime = `1200${String(sequence).padStart(2, "0")}.00`;
  const payload = `GNGGA,${utcTime},${coord(latitude, 2)},N,${coord(longitude, 3)},W,4,12,0.8,1600.0,M,-20.0,M,1.0,42`;
  const checksum = [...payload].reduce((value, char) => value ^ char.charCodeAt(0), 0).toString(16).padStart(2, "0");
  const captureEvidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: `receiver:${sequence}`, sessionId: "receiver", transport: "local_udp",
    receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime, qualityCode: 4, latitude, longitude },
    receipt: { sequence, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
    capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 }, projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
  return { id: `point:${sequence}`, label: "Synthetic point", role: "control", projected: projectLonLatToXy({ latitude, longitude }, "EPSG:32613"),
    wgs84: { latitude, longitude }, observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence };
}
function stored(workspace: WorkspaceDocument) {
  const values = new Map([[WEB_WORKSPACE_KEY, JSON.stringify(workspace)], [WEB_WORKSPACE_BACKUP_KEY, JSON.stringify({ backupVersion: "cplayout-workspace-legacy-backup-v1", state: "committed", projectsRaw: null, catalogRaw: null })]]);
  let fail = false, writes = 0;
  const api = createVersionedProjectRepository({ getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => {
    if (fail && key === WEB_WORKSPACE_KEY) throw new Error("Synthetic quota failure");
    values.set(key, value); if (key === WEB_WORKSPACE_KEY) writes++;
  } }), getLocks: () => ({ request: async (_name, _options, run) => run() }) }).versionedWorkspace!;
  return { api, values, fail(value: boolean) { fail = value; }, writes: () => writes };
}

test("same-field Layout sibling uses real saved Field target and advances dirty Design's next Save without resetting raw input", async () => {
  let { workspace, editable } = managed();
  workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v3", now }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "convert_project_to_field_design", now, sourceDesignId: "design", expectedDesignRevision: 0,
    designId: "field-design", fieldMapId: "map", fieldId: "field", waterSourceId: "water", powerSourceId: "power", name: "Explicit Field" }).workspace;
  const field = readWorkspaceDesign(workspace, "field-design"); if (field.kind !== "field") throw new Error("Actual Field missing");
  const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(field.field, { inputRevision: field.design.revision, expectedRevision: field.design.revision, selectedMachineIds: [field.field.machines[0].id] }));
  workspace = applyWorkspaceCommand(workspace, { type: "create_layout_session", now, sessionId: "layout", fieldMapId: "map", name: "Saved target", targetDocument }).workspace;
  editable = editableFromSavedDesign(readWorkspaceDesign(workspace, "design") as Exclude<ReturnType<typeof readWorkspaceDesign>, { kind: "not_found" }>);
  let controller = openControllerDocument(createWorkspaceControllerState(), editable, { dirty: false, busy: false });
  controller = openControllerLayout(controller, { session: parseLayoutSessionDocument(workspace.layoutSessions![0].document), persistenceRevision: workspace.revision }, { dirty: false, busy: false });
  const dirty = reduceWorkspaceEditable(editable, { kind: "project", action: { type: "update_machine", machine: { ...sampleProject.machine, name: "Unsaved later machine" } } });
  controller = { ...controller, editable: dirty };
  const inputs = new InputRetentionStore(), baseline = createInputRetentionBaseline("initial"); inputs.set("project/raw", baseline, "unfinished input");
  const beforeEditor = dirty.editor, coordinator = createEditorSaveCoordinator(), session = coordinator.open(workspaceSaveTarget(dirty)), store = stored(workspace);
  await coordinator.exclusive({ session, isCurrent: () => true,
    async write(target, owner) {
      const before = await store.api.readAsync(), proof = captureWorkspaceSiblingProof(controller.editable!, before);
      assert.equal(target!.workspaceRevision, before.revision);
      const receipt = await store.api.executeAsync(before.revision, { type: "rename_layout_session", now, sessionId: "layout", expectedSessionRevision: 0, name: "Recorded name" }, owner.isCurrent);
      return { previousRevision: before.revision, persistenceRevision: receipt.workspace.revision, value: { workspace: receipt.workspace, editable: reconcileWorkspaceSibling(controller.editable!, proof, receipt.workspace) } };
    }, onCommitted(receipt) { controller = acceptControllerLayoutReceipt({ ...controller, editable: receipt.editable }, { session: parseLayoutSessionDocument(receipt.workspace.layoutSessions![0].document), persistenceRevision: receipt.workspace.revision }); } });
  assert.equal(controller.editable!.editor, beforeEditor); assert.equal(inputs.hasDirty(), true); assert.equal(inputs.read("project/raw", baseline), "unfinished input");
  assert.equal(controller.layout!.session.targetDocument, targetDocument); assert.equal(controller.layout!.session.name, "Recorded name");
  const savedSnapshot = serializeWorkspaceEditable(controller.editable!);
  await coordinator.save({ session, payload: workspaceSavePayload(controller.editable!), editorRevision: controller.editable!.editor.revision,
    async write(payload, target) {
      if (payload.kind !== "project") throw new Error("Wrong fixture kind");
      const receipt = await store.api.executeAsync(target.workspaceRevision!, { type: "save_design_project", now, designId: "design", project: payload.project });
      const read = readWorkspaceDesign(receipt.workspace, "design"); if (read.kind === "not_found") throw new Error("Lost design");
      controller = { ...controller, editable: acknowledgeWorkspaceSave(controller.editable!, read, { document: savedSnapshot, editorRevision: controller.editable!.editor.revision }) };
      return { saved: true, persistenceRevision: receipt.workspace.revision, designRevision: read.design.revision };
    } });
  assert.equal(serializeWorkspaceEditable(controller.editable!), savedSnapshot);
  const reopened = await store.api.readAsync(); assert.equal(parseLayoutSessionDocument(reopened.layoutSessions![0].document).targetDocument, targetDocument);
  assert.equal(readWorkspaceDesign(reopened, "field-design").kind, "field");
});

test("compound recorded shape history atomically restores unfinished membership and canonical geometry while retaining exact observations and receipts", async () => {
  let { workspace, editable } = managed();
  workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v3", now }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v4", now }).workspace;
  const collection = createSurveyCollection({ id: "shape", now, purpose: { kind: "field_boundary" }, owner: { designId: "design", documentKind: "project", payloadId: sampleProject.id, fieldMapId: "map", projectCrs: sampleProject.projectCrs } });
  workspace = applyWorkspaceCommand(workspace, { type: "create_survey_collection", now, collection, expectedDesignRevision: 0 }).workspace;
  const store = stored(workspace);
  for (const observed of [capturedPoint(1), capturedPoint(2, 40.01), capturedPoint(3, 40, -105.01)]) {
    const current = await store.api.readAsync(), shape = parseSurveyCollectionDocument(current.surveyCollections![0].document);
    await store.api.executeAsync(current.revision, { type: "append_survey_capture", now, collectionId: shape.id, expectedCollectionRevision: shape.revision, expectedDesignRevision: 0, point: observed }, () => true);
  }
  workspace = await store.api.readAsync();
  const read = readWorkspaceDesign(workspace, "design"); if (read.kind === "not_found") throw new Error("Lost source"); editable = editableFromSavedDesign(read);
  const pending = retainControllerCollections(openControllerDocument(createWorkspaceControllerState(), editable, { dirty: false, busy: false }), [parseSurveyCollectionDocument(workspace.surveyCollections![0].document)]);
  const previous = workspaceHistorySnapshot(pending);
  const apply = await store.api.executeAsync(workspace.revision, { type: "apply_survey_collection", now, collectionId: "shape", expectedCollectionRevision: 3, expectedDesignRevision: 0, applicationId: "recorded-application" });
  const ledger = parseSurveyCollectionDocument(apply.workspace.surveyCollections![0].document), appliedRead = readWorkspaceDesign(apply.workspace, "design"); if (appliedRead.kind === "not_found") throw new Error("Lost applied source");
  const applied = recordWorkspaceHistory(pending, retainControllerCollections({ ...pending, editable: editableFromSavedDesign(appliedRead) }, [ledger]));
  const coordinator = createEditorSaveCoordinator(), session = coordinator.open(workspaceSaveTarget(applied.editable!));
  let restored = applied;
  await coordinator.transact({ session, isCurrent: () => true, async write(target, owner) {
    const result = await store.api.executeAsync(target.workspaceRevision!, { type: "restore_design_survey_history", now, designId: "design", expectedDesignRevision: applied.editable!.designRevision!, document: previous.document, memberships: historyMemberships(previous, applied.collections) }, owner.isCurrent);
    return { value: result.workspace, persistenceRevision: result.workspace.revision, designRevision: 2 };
  } }).then(value => { const incoming = readWorkspaceDesign(value, "design"); if (incoming.kind === "not_found") throw new Error("Lost restored source"); restored = retainControllerCollections({ ...applied, editable: editableFromSavedDesign(incoming) }, [parseSurveyCollectionDocument(value.surveyCollections![0].document)]); });
  assert.equal(serializeWorkspaceEditable(restored.editable!), previous.document);
  assert.deepEqual(restored.collections[0].activePointIds, previous.memberships[0].activePointIds);
  assert.deepEqual(restored.collections[0].observations, ledger.observations); assert.deepEqual(restored.collections[0].applications, ledger.applications);
  const undone = await store.api.readAsync(), redoSnapshot = workspaceHistorySnapshot(applied);
  await store.api.executeAsync(undone.revision, { type: "restore_design_survey_history", now, designId: "design", expectedDesignRevision: 2, document: redoSnapshot.document, memberships: historyMemberships(redoSnapshot, restored.collections) });
  const reopened = await store.api.readAsync(), retained = parseSurveyCollectionDocument(reopened.surveyCollections![0].document);
  assert.equal(readWorkspaceDesign(reopened, "design").kind, "project"); assert.equal(retained.state, "applied");
  assert.deepEqual(retained.observations, ledger.observations); assert.deepEqual(retained.applications, ledger.applications);
});

test("Draft history removes first captured vertices without erasing its durable drawing CRS lock", () => {
  const settings = defaultProjectSettings();
  const empty = editableFromIndependentDocument("draft", JSON.stringify({ documentVersion: "design-draft-v1", draft: { id: "draft", name: "Real empty Draft", projectCrs: "EPSG:32613", unitSystem: settings.unitSystem, settings,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] } }));
  const original = serializeWorkspaceEditable(empty);
  let captured = reduceWorkspaceEditable(empty, { kind: "draft", action: { type: "drawing", expectedRevision: 0, command: { type: "begin", id: "capture", name: "Boundary drawing", geometryType: "Polygon" } } });
  captured = reduceWorkspaceEditable(captured, { kind: "draft", action: { type: "drawing", expectedRevision: 1, command: { type: "append_vertex", id: "capture", vertex: { point: { x: 500000, y: 4400000 }, recordedAt: now, wgs84: null, elevation: null } } } });
  assert.equal(captured.editor.lastError, null);
  const restored = restoreWorkspaceEditableDocument(captured, original); if (restored.kind !== "draft") throw new Error("Lost Draft kind");
  assert.deepEqual(restored.editor.draft.fieldBoundary, []); assert.equal(restored.editor.draft.drawingWorkflow!.lockedCrs, "EPSG:32613");
  const reopened = editableFromIndependentDocument("draft", serializeWorkspaceEditable(restored));
  assert.equal(reopened.kind === "draft" && reopened.editor.lockedCrs, "EPSG:32613");
  const refused = reduceWorkspaceEditable(reopened, { kind: "draft", action: { type: "set_crs", projectCrs: "EPSG:32614" } });
  assert.match(refused.editor.lastError!, /CRS|relabeled/);
});

test("empty-Draft CRS edits remain genuine local history before the drawing frame is locked", () => {
  const settings = defaultProjectSettings();
  const draft = editableFromIndependentDocument("draft", JSON.stringify({ documentVersion: "design-draft-v1", draft: { id: "draft", name: "Empty", projectCrs: null, unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] } }));
  const before = openControllerDocument(createWorkspaceControllerState(), draft, { dirty: false, busy: false });
  const after = reduceControllerDocument(before, { kind: "draft", action: { type: "set_crs", projectCrs: "EPSG:32613" } });
  assert.equal(after.historyPast.length, 1);
  assert.equal(restoreWorkspaceEditableDocument(after.editable!, after.historyPast[0].document).identity.projectCrs, null);
});


function completionFixture() {
  const { workspace: projectWorkspace } = managed();
  // Explicit current-source complete Draft fixture; every geometry/machine input
  // comes from the supported synthetic sample, never an incomplete sentinel.
  const draft = parseDesignDraftDocument({ documentVersion: "design-draft-v3", draft: structuredClone({ ...sampleProject, id: "source-draft", name: "Saved Draft", settings: defaultProjectSettings() }) });
  const workspace = applyWorkspaceCommand(projectWorkspace, { type: "create_design_draft", now, designId: "draft-design", fieldMapId: "map", name: draft.name, draft }).workspace;
  const read = readWorkspaceDesign(workspace, "draft-design"); if (read.kind !== "draft") throw new Error("Draft fixture missing");
  let editable = editableFromSavedDesign(read);
  editable = reduceWorkspaceEditable(editable, { kind: "draft", action: { type: "rename", name: "Unsaved completed Draft" } });
  editable = reduceWorkspaceEditable(editable, { kind: "draft", action: { type: "set_infrastructure", role: "pivot_center", point: { x: draft.pivotCenter!.x + 1.125, y: draft.pivotCenter!.y } } });
  return { workspace, editable, store: stored(workspace) };
}

test("dirty Draft completion refuses incomplete inputs and quota with zero separate source Save; success stores latest source plus exact child geometry once", async () => {
  const f = completionFixture(), coordinator = createEditorSaveCoordinator(), session = coordinator.open(workspaceSaveTarget(f.editable));
  const initialRaw = f.store.values.get(WEB_WORKSPACE_KEY), retainedHistory = f.editable.editor.past;
  const latestDocument = serializeWorkspaceEditable(f.editable);
  let local = f.editable;
  async function complete(incomplete = false) {
    return coordinator.transact({ session, isCurrent: () => true, async write(target, owner) {
      const before = await f.store.api.readAsync(); captureWorkspaceSiblingProof(local, before);
      if (target.kind !== "draft" || local.kind !== "draft") throw new Error("Wrong completion kind");
      const receipt = await f.store.api.executeAsync(target.workspaceRevision, { type: "create_complete_design_from_draft", now,
        sourceDesignId: "draft-design", expectedDesignRevision: target.designRevision, draft: incomplete ? { ...local.editor.draft, pivotCenter: null } : local.editor.draft,
        designId: "completed-design", projectId: "completed-payload", name: local.editor.draft.name }, owner.isCurrent);
      const source = readWorkspaceDesign(receipt.workspace, "draft-design"); if (source.kind !== "draft") throw new Error("Lost source");
      return { value: { workspace: receipt.workspace, source }, persistenceRevision: receipt.workspace.revision, designRevision: source.design.revision };
    } });
  }
  await assert.rejects(complete(true), /incomplete|cannot be calculated/);
  assert.equal(f.store.values.get(WEB_WORKSPACE_KEY), initialRaw); assert.equal(f.store.writes(), 0);
  f.store.fail(true); await assert.rejects(complete(), /quota/); f.store.fail(false);
  assert.equal(f.store.values.get(WEB_WORKSPACE_KEY), initialRaw); assert.equal(coordinator.receipt(session).workspaceRevision, f.workspace.revision);
  assert.equal(local.editor.past, retainedHistory); assert.equal(serializeWorkspaceEditable(local), latestDocument);
  const committed = await complete();
  assert.equal(f.store.writes(), 1); assert.equal(committed.workspace.revision, f.workspace.revision + 1); assert.equal(committed.source.design.revision, 1);
  assert.equal(committed.source.document, latestDocument);
  const child = readWorkspaceDesign(committed.workspace, "completed-design"); if (child.kind !== "project" || local.kind !== "draft") throw new Error("Actual child missing");
  assert.deepEqual(child.project.pivotCenter, local.editor.draft.pivotCenter); assert.deepEqual(child.project.fieldBoundary, local.editor.draft.fieldBoundary);
  assert.equal(child.context.fieldMapId, "map"); assert.equal(child.project.id, "completed-payload");
  local = acknowledgeWorkspaceSave(local, committed.source, { editorRevision: local.editor.revision, document: latestDocument });
  assert.equal(local.editor.past, retainedHistory); assert.equal(local.identity.designId, "draft-design"); assert.equal(local.savedEditorRevision, local.editor.revision);
});

test("atomic dirty completion drains an earlier admitted Save, then uses its acknowledged revisions without a second pre-save", async () => {
  const f = completionFixture(), coordinator = createEditorSaveCoordinator(), session = coordinator.open(workspaceSaveTarget(f.editable));
  let local = f.editable, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const earlier = serializeWorkspaceEditable(local), earlierRevision = local.editor.revision;
  const saving = coordinator.save({ session, payload: workspaceSavePayload(local), editorRevision: earlierRevision,
    async write(payload, target) {
      await gate; if (payload.kind !== "draft" || target.kind !== "draft") throw new Error("Wrong Save kind");
      const receipt = await f.store.api.executeAsync(target.workspaceRevision, { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: target.designRevision, draft: payload.draft });
      const source = readWorkspaceDesign(receipt.workspace, "draft-design"); if (source.kind !== "draft") throw new Error("Lost source");
      local = acknowledgeWorkspaceSave(local, source, { editorRevision: earlierRevision, document: earlier });
      return { saved: true, persistenceRevision: receipt.workspace.revision, designRevision: source.design.revision };
    } });
  local = reduceWorkspaceEditable(local, { kind: "draft", action: { type: "rename", name: "Latest applied after accepted Save" } });
  const latest = serializeWorkspaceEditable(local), latestRevision = local.editor.revision, history = local.editor.past;
  const completion = coordinator.transact({ session, isCurrent: () => true, async write(target, owner) {
    assert.equal(target.workspaceRevision, f.workspace.revision + 1); if (target.kind !== "draft" || local.kind !== "draft") throw new Error("Wrong Draft");
    assert.equal(target.designRevision, 1); const before = await f.store.api.readAsync(); captureWorkspaceSiblingProof(local, before);
    const receipt = await f.store.api.executeAsync(target.workspaceRevision, { type: "create_complete_design_from_draft", now,
      sourceDesignId: "draft-design", expectedDesignRevision: target.designRevision, draft: local.editor.draft, designId: "after-save-complete", projectId: "after-save-payload", name: local.editor.draft.name }, owner.isCurrent);
    const source = readWorkspaceDesign(receipt.workspace, "draft-design"); if (source.kind !== "draft") throw new Error("Lost source");
    return { value: source, persistenceRevision: receipt.workspace.revision, designRevision: source.design.revision };
  } });
  release(); await saving; const source = await completion;
  local = acknowledgeWorkspaceSave(local, source, { editorRevision: latestRevision, document: latest });
  assert.equal(f.store.writes(), 2); assert.equal(source.document, latest); assert.equal(local.editor.past, history);
  assert.equal(local.designRevision, 2); assert.equal(local.workspaceRevision, f.workspace.revision + 2); assert.equal(local.identity.designId, "draft-design");
});

test("controller completion selects its atomic dirty-Draft policy rather than the ordinary recorded pre-save lane", async () => {
  const source = await readFile(new NodeURL("./useWorkspaceController.ts", import.meta.url), "utf8");
  const completion = source.slice(source.indexOf("async function completeDesign()"), source.indexOf("async function createFieldFromProject()"));
  assert.match(completion, /"atomic_draft_completion"/); assert.doesNotMatch(completion, /await save\(|persistAppliedDesign\(/);
  assert.match(source, /commitPolicy === "saved_source" && workspaceEditableIsDirty\(admitted\) && !await persistAppliedDesign\(\)/);
  assert.match(source, /commitPolicy === "atomic_draft_completion"\s*\? acknowledgeWorkspaceSave/);
});


test("controller saved-result links retire with document replacement and require the same source owner after commit", async () => {
  const source = await readFile(new NodeURL("./useWorkspaceController.ts", import.meta.url), "utf8");
  for (const [start, end] of [["async function openDesign(", "function openIndependent("], ["function openIndependent(", "function dispatch("], ["function closeDesign(", "/** A sibling write"]]) {
    const body = source.slice(source.indexOf(start), source.indexOf(end));
    assert.match(body, /setSavedCompleteDesignId\(null\)/); assert.match(body, /setSavedFieldDesignId\(null\)/);
  }
  assert.match(source, /if \(replacesEditable\) \{ inputs.reset\(\); setSavedCompleteDesignId\(null\); setSavedFieldDesignId\(null\)/);
  assert.match(source, /isWorkspaceOperationCurrent\(stateRef.current.presentation, renderedDocumentOwner\)\) setSavedCompleteDesignId\(id\)/);
  assert.match(source, /isWorkspaceOperationCurrent\(stateRef.current.presentation, renderedDocumentOwner\)\) setSavedFieldDesignId\(id\)/);
});


test("current controller NEW observation display name preserves explicit input and auto-names blanks; actual missing-station receiver point roundtrips strict Survey JSON", async () => {
  const source = await readFile(new NodeURL("./useWorkspaceController.ts", import.meta.url), "utf8");
  const labelStatement = source.match(/const displayLabel = [^;]+;/)?.[0]; assert.ok(labelStatement);
  const body = "GNGGA,120000,4000.0000,N,10500.0000,W,4,12,0.8,1600,M,-20,M,,";
  const checksum = [...body].reduce((value, character) => value ^ character.charCodeAt(0), 0).toString(16).padStart(2, "0");
  const sentence = `$${body}*${checksum}`;
  let finish!: () => void; const finished = new Promise<void>(resolve => { finish = resolve; });
  const session: GnssSession = { id: "actual-display-name-stream", async *events() {
    yield { type: "bytes", bytes: new TextEncoder().encode(`${sentence}\r\n`), receivedAt: now, receivedMonotonicMs: 1000 };
    await finished; yield { type: "ended", reason: "closed" };
  }, async close() { finish(); } };
  const receiver = new ReceiverSessionOwner(() => ({ open: async () => session }), () => 1000);
  try {
    await receiver.connect({ method: "usb", baudRate: 115200 }); await new Promise(resolve => setTimeout(resolve, 0));
    for (const raw of ["", "   ", " Operator supplied exact name  "]) {
      const collection = createSurveyCollection({ id: "collection", now, purpose: { kind: "field_boundary" }, owner: { designId: "design", documentKind: "draft", payloadId: "draft", fieldMapId: "map", projectCrs: "EPSG:32613" } });
      // Execute the current controller statement, not a duplicate expected map.
      const displayLabel = runInNewContext(`${labelStatement} displayLabel;`, { label: raw, collection }) as string;
      assert.equal(displayLabel, raw.trim().length ? raw : "Observation 1");
      const point = receiver.capture("EPSG:32613", "point", displayLabel);
      assert.equal(Object.hasOwn(point.rtk!, "baseStationId"), false); assert.equal(point.captureEvidence.gga.sentence, sentence);
      const accepted = proposeSurveyCaptureAppend(collection, { expectedRevision: 0, point, now }).collection;
      const reopened = parseSurveyCollectionDocument(serializeSurveyCollectionDocument(accepted));
      assert.deepEqual(reopened.observations[0], point); assert.equal(reopened.observations[0].label, displayLabel);
      const cleared = proposeSurveyClear(reopened, { expectedRevision: reopened.revision, now });
      assert.deepEqual(cleared.observations, reopened.observations);
      assert.equal(runInNewContext(`${labelStatement} displayLabel;`, { label: "", collection: cleared }), "Observation 2", "Clear must not reset the immutable ledger sequence");
      assert.deepEqual(reopened.observations[0].captureEvidence, point.captureEvidence);
    }
  } finally { await receiver.disconnect(); }
});
