import assert from "node:assert/strict";
import test from "node:test";
import { workflowTestField, workflowTestPoint, workflowTestTime as now } from "./productionWorkflowTestFixtures";
import { createSurveyCollection, proposeSurveyCaptureAppend, serializeSurveyCollectionDocument } from "./surveyCollection";
import { createSurveyReview } from "./surveyReview";
import { serializeFieldDesignDocument } from "./fieldDesignDocument";
import { createReviewedFieldLayoutTarget, serializeFieldLayoutTarget } from "./fieldLayoutTarget";
import { createLayoutSessionDocument, createRtkLayoutSessionDocument, finalizeRtkLayoutSession, annotateLayoutObservation, parseLayoutSessionDocument,
  parseV1LayoutSessionDocument, parseV2LayoutSessionDocument, serializeLayoutSessionDocument, type RtkLayoutSession } from "./layoutSession";
import { layoutLockFromReceiverCapture, isOfficialLayoutSession, officialMeasuredStations } from "./officialLayout";
const later = (seconds: number) => new Date(Date.parse(now) + seconds * 1000).toISOString();
function fixture() {
  const field = workflowTestField(), point = workflowTestPoint(); field.surveyPoints.push(point);
  const owner = { designId: "actual-field-design", documentKind: "field" as const, payloadId: field.id, fieldMapId: "actual-field", projectCrs: field.projectCrs };
  const collection = proposeSurveyCaptureAppend(createSurveyCollection({ id: "actual-control", owner, purpose: { kind: "point", role: "control" }, now }), { expectedRevision: 0, point, now }).collection;
  const review = createSurveyReview({ id: "actual-review", owner, completedBy: "operator", completedAt: now, sourceRevision: 1, sourceDocument: serializeFieldDesignDocument(field),
    collections: [{ id: collection.id, document: serializeSurveyCollectionDocument(collection) }], includedCollectionIds: [collection.id], excludedCollectionIds: [] });
  const target = createReviewedFieldLayoutTarget(field, { designId: owner.designId, fieldMapId: owner.fieldMapId, review, inputRevision: 1, expectedRevision: 1, selectedMachineIds: [field.machines[0].id] });
  const targetDocument = serializeFieldLayoutTarget(target), lock = layoutLockFromReceiverCapture(point, "operator");
  const session = createRtkLayoutSessionDocument({ id: "actual-rtk", name: "Recorded stations", fieldMapId: owner.fieldMapId, targetDocument, now, creationLock: lock });
  return { target, targetDocument, lock, session };
}
function marked(): ReturnType<typeof fixture> {
  const f = fixture(), point = workflowTestPoint(2);
  const observation = annotateLayoutObservation(f.target, { id: point.id, sessionId: f.session.id, capturedAt: later(1), projected: point.projected, evidence: point.captureEvidence! },
    { recordedBy: "operator", targetPointId: f.target.targetPoints![0].id, toleranceMeters: .02 });
  f.session.observations.push(observation); f.session.updatedAt = later(1); return f;
}
function finalized(): RtkLayoutSession {
  const f = marked(), lock = layoutLockFromReceiverCapture({ ...workflowTestPoint(3), observedAt: later(2) }, "operator");
  return finalizeRtkLayoutSession(f.session, lock, later(2));
}
test("pending v3 contains its actual creation lock; official finalization covers recorded stations and preserves planned target bytes", () => {
  const f = marked(); assert.equal(isOfficialLayoutSession(f.session), false); assert.deepEqual(officialMeasuredStations(f.session), []);
  const completed = finalized(); assert.equal(isOfficialLayoutSession(completed), true); assert.equal(completed.targetDocument, f.targetDocument);
  const stations = officialMeasuredStations(completed); assert.equal(stations.length, 1); assert.deepEqual(stations[0].projected, completed.observations[0].projected);
  assert.equal(stations[0].evidence.physicalQualification, "unverified"); assert.equal(stations[0].toleranceMeters, .02);
});
test("finalization refuses missing points, absent operator tolerance and a newer outside-tolerance mark", () => {
  const f = fixture(); assert.throws(() => finalizeRtkLayoutSession(f.session, f.lock, now), /every frozen/);
  const m = marked(), point = workflowTestPoint(3), targetId = m.target.targetPoints![0].id;
  m.session.observations.push(annotateLayoutObservation(m.target, { id: point.id, sessionId: m.session.id, capturedAt: later(2), projected: point.projected, evidence: point.captureEvidence! }, { recordedBy: "operator", targetPointId: targetId }));
  m.session.updatedAt = later(2); assert.throws(() => finalizeRtkLayoutSession(m.session, m.lock, later(2)), /every frozen/);
  const outside = marked(), shifted = workflowTestPoint(4, "control", 40.00001, -105);
  outside.session.observations.push(annotateLayoutObservation(outside.target, { id: shifted.id, sessionId: outside.session.id, capturedAt: later(2), projected: shifted.projected, evidence: shifted.captureEvidence },
    { recordedBy: "operator", targetPointId: outside.target.targetPoints![0].id, toleranceMeters: .02 }));
  outside.session.updatedAt = later(2); assert.equal(outside.session.observations.at(-1)!.marking!.assessment, "outside_tolerance");
  assert.throws(() => finalizeRtkLayoutSession(outside.session, outside.lock, later(2)), /every frozen/);
});
test("v3 lifecycle chronology refuses forged creation/finalization/lock/station dates and standalone wrong-quality creation", () => {
  const original = finalized();
  const changes = [
    (s: RtkLayoutSession) => { s.creationLock.capturedAt = "2000-01-01T00:00:00.000Z"; },
    (s: RtkLayoutSession) => { s.finalization!.finalizedAt = "2000-01-01T00:00:00.000Z"; },
    (s: RtkLayoutSession) => { s.finalization!.lock.capturedAt = "2099-01-01T00:00:00.000Z"; },
    (s: RtkLayoutSession) => { s.observations[0].capturedAt = later(-1); },
    (s: RtkLayoutSession) => { s.updatedAt = later(1); },
  ];
  for (const change of changes) { const copy = structuredClone(original); change(copy); assert.throws(() => parseLayoutSessionDocument(copy), /chronology|current capture|current-lock/); assert.equal(isOfficialLayoutSession(copy), false); }
  const wrong = structuredClone(original); (wrong.creationLock.evidence.gga as { qualityCode: number }).qualityCode = 5; assert.equal(isOfficialLayoutSession(wrong), false);
});
test("strict v1/v2 readers reject v3; old v2 stays readable and unqualified, imported original text stays exact reference history", () => {
  const f = fixture(), old = createLayoutSessionDocument({ id: "historical", name: "Saved plan", fieldMapId: f.session.fieldMapId, targetDocument: f.targetDocument, now });
  const bytes = serializeLayoutSessionDocument(old); assert.deepEqual(parseV2LayoutSessionDocument(bytes), old); assert.equal(isOfficialLayoutSession(old), false);
  assert.throws(() => parseV1LayoutSessionDocument(f.session), /v1 reader/); assert.throws(() => parseV2LayoutSessionDocument(f.session), /v2 reader/);
  const original = finalized(), exact = ` \r\n${JSON.stringify(original, null, 2).replaceAll("\n", "\r\n")}\r\n`;
  const reference = parseLayoutSessionDocument({ ...original, finalization: null, referenceSourceDocument: exact });
  assert.equal(reference.documentVersion, "layout-session-v3"); if (reference.documentVersion !== "layout-session-v3") throw new Error("Expected reference edition");
  assert.equal(reference.referenceSourceDocument, exact); assert.equal(isOfficialLayoutSession(reference), false); assert.deepEqual(officialMeasuredStations(reference), []);
  assert.throws(() => finalizeRtkLayoutSession(reference, f.lock, now), /current RTK/); assert.equal(serializeLayoutSessionDocument(old), bytes);
});
