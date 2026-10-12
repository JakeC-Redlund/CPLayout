import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createSyntheticRtkField } from "./rtkTestFixtures";
import { sha256 } from "./database";
import { workflowTestPoint, workflowTestTime as now } from "../../../packages/core/src/productionWorkflowTestFixtures";
import { layoutLockFromReceiverCapture, isOfficialLayoutSession } from "../../../packages/core/src/officialLayout";
import { parseLayoutSessionDocument } from "../../../packages/core/src/layoutSession";
import { parseFieldLayoutTarget } from "../../../packages/core/src/fieldLayoutTarget";
import { parseWorkspaceDocument, serializeWorkspaceDocument } from "../../../packages/project-store/src/workspaceDocument";


test("real RTK command receipts bind nested creation/finalization and station actors to the signed-in principal", async () => {
  const f = await createSyntheticRtkField();
  try {
    const sessionId = "actual-rtk-session", creationLock = layoutLockFromReceiverCapture(workflowTestPoint(2), "forged-creator");
    const created = await f.command({ type: "create_rtk_layout_session", sessionId, name: "Supplied RTK Layout", designId: f.designId, expectedDesignRevision: 1,
      reviewId: f.reviewId, selectedMachineIds: [f.field.machines[0].id], creationLock });
    const session = parseLayoutSessionDocument(created.value), target = parseFieldLayoutTarget(session.targetDocument);
    assert.equal(session.documentVersion, "layout-session-v3"); assert.equal(session.creationLock!.recordedBy, f.administratorId);
    assert.equal(session.creationLock!.evidence.physicalQualification, "unverified"); assert.equal(session.finalization, null);
    const point = workflowTestPoint(3);
    await f.command({ type: "append_layout_mark", sessionId, expectedSessionRevision: 0, observation: { id: "actual-mark", sessionId, capturedAt: now, projected: point.projected, evidence: point.captureEvidence },
      targetPointId: target.targetPoints![0].id, toleranceMeters: .1, recordedBy: "forged-station-operator" });
    const finalized = await f.command({ type: "finalize_rtk_layout_session", sessionId, expectedSessionRevision: 1, finalizationLock: layoutLockFromReceiverCapture(workflowTestPoint(4), "forged-finalizer") });
    const official = parseLayoutSessionDocument(finalized.value);
    assert(official.documentVersion === "layout-session-v3");
    assert.equal(official.finalization!.lock.recordedBy, f.administratorId); assert.equal(official.observations[0].marking!.recordedBy, f.administratorId); assert.equal(isOfficialLayoutSession(official), true);
    const before = f.database.state.workspaces[0].document, receiptCount = f.database.state.receipts.length;
    const refused = await f.api.inject({ method: "POST", url: `/api/v1/workspaces/${f.workspaceId}/commands`, headers: f.headers,
      payload: { commandId: randomUUID(), expectedRevision: finalized.revision, expectedPrincipalId: "retired-principal", command: { type: "finalize_rtk_layout_session", now, sessionId,
        expectedSessionRevision: official.revision, finalizationLock: layoutLockFromReceiverCapture(workflowTestPoint(5), "other-person") } } });
    assert.equal(refused.statusCode, 409); assert.equal(refused.json().code, "account_changed"); assert.equal(f.database.state.workspaces[0].document, before); assert.equal(f.database.state.receipts.length, receiptCount);
  } finally { await f.api.close(); }
});
test("pending and finalized RTK whole-workspace imports refuse new association without changing the source or empty destination", async () => {
  const f = await createSyntheticRtkField();
  try {
    const sessionId = "retained-rtk-session", created = await f.command({ type: "create_rtk_layout_session", sessionId, name: "Retained RTK Layout", designId: f.designId,
      expectedDesignRevision: 1, reviewId: f.reviewId, selectedMachineIds: [f.field.machines[0].id], creationLock: layoutLockFromReceiverCapture(workflowTestPoint(6), "creator") });
    const pending = f.database.state.workspaces[0].document, session = parseLayoutSessionDocument(created.value), target = parseFieldLayoutTarget(session.targetDocument), point = workflowTestPoint(7);
    await f.command({ type: "append_layout_mark", sessionId, expectedSessionRevision: 0, observation: { id: "retained-mark", sessionId, capturedAt: now, projected: point.projected, evidence: point.captureEvidence }, targetPointId: target.targetPoints![0].id, toleranceMeters: .1, recordedBy: "marker" });
    await f.command({ type: "finalize_rtk_layout_session", sessionId, expectedSessionRevision: 1, finalizationLock: layoutLockFromReceiverCapture(workflowTestPoint(8), "finalizer") });
    const finalized = f.database.state.workspaces[0].document, destinationId = randomUUID();
    await f.database.transaction(async transaction => { await transaction.insertWorkspace({ ...f.empty, id: destinationId, name: "Actual empty destination" }); await transaction.setMembership(f.administratorId, destinationId, ["field:read", "field:write", "catalog:write"]); });
    for (const source of [pending, finalized]) {
      const original = JSON.stringify(JSON.parse(source), null, 2).replaceAll("\n", "\r\n") + " \r\n", expectedSourceHash = sha256(original);
      const response = await f.api.inject({ method: "POST", url: `/api/v1/workspaces/${destinationId}/import`, headers: f.headers,
        payload: { document: original, sha256: expectedSourceHash, expectedRevision: f.empty.revision } });
      assert.equal(response.statusCode, 422); assert.equal(response.json().code, "layout_reference_import_required"); assert.equal(sha256(original), expectedSourceHash);
      assert.equal(f.database.state.workspaces.find(item => item.id === destinationId)!.document, f.empty.document); assert.equal(f.database.state.workspaces.find(item => item.id === f.workspaceId)!.document, finalized);
    }
    const baseline = parseWorkspaceDocument(finalized), originalSessionDocument = baseline.layoutSessions![0].document; baseline.layoutSessions = [];
    const baselineDocument = serializeWorkspaceDocument(baseline);
    const baseImport = await f.api.inject({ method: "POST", url: `/api/v1/workspaces/${destinationId}/import`, headers: f.headers,
      payload: { document: baselineDocument, sha256: sha256(baselineDocument), expectedRevision: f.empty.revision } });
    assert.equal(baseImport.statusCode, 200);
    const reference = await f.api.inject({ method: "POST", url: `/api/v1/workspaces/${destinationId}/commands`, headers: f.headers,
      payload: { commandId: randomUUID(), expectedRevision: baseline.revision, command: { type: "import_layout_session", now, fieldMapId: f.tree.fieldMapId, document: originalSessionDocument } } });
    assert.equal(reference.statusCode, 200, reference.body);
    const copy = parseLayoutSessionDocument(reference.json().value); assert(copy.documentVersion === "layout-session-v3"); assert.equal(copy.finalization, null); assert.equal(isOfficialLayoutSession(copy), false);
    assert.equal(copy.referenceSourceDocument, originalSessionDocument);
    const beforeReferenceMark = f.database.state.workspaces.find(item => item.id === destinationId)!.document;
    const refusedMark = await f.api.inject({ method: "POST", url: `/api/v1/workspaces/${destinationId}/commands`, headers: f.headers,
      payload: { commandId: randomUUID(), expectedRevision: reference.json().revision, command: { type: "append_layout_mark", now, sessionId: copy.id, expectedSessionRevision: copy.revision,
        observation: { id: "refused-mark", sessionId: copy.id, capturedAt: now, projected: point.projected, evidence: point.captureEvidence }, targetPointId: target.targetPoints![0].id, toleranceMeters: .1, recordedBy: "marker" } } });
    assert.equal(refusedMark.statusCode, 409); assert.equal(f.database.state.workspaces.find(item => item.id === destinationId)!.document, beforeReferenceMark);
  } finally { await f.api.close(); }
});
