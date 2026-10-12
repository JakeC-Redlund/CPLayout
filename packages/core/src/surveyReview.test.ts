import assert from "node:assert/strict";
import test from "node:test";
import { workflowTestField, workflowTestPoint, workflowTestTime as now } from "./productionWorkflowTestFixtures";
import { createSurveyCollection, proposeSurveyCaptureAppend, serializeSurveyCollectionDocument } from "./surveyCollection";
import { createSurveyReview, parseSurveyReview, surveyReviewIsCurrent } from "./surveyReview";
import { serializeFieldDesignDocument } from "./fieldDesignDocument";
import { createReviewedFieldLayoutTarget, serializeFieldLayoutTarget, parseFieldLayoutTarget, layoutPointResidual } from "./fieldLayoutTarget";
import { annotateLayoutObservation, createLayoutSessionDocument, serializeLayoutSessionDocument, parseLayoutSessionDocument } from "./layoutSession";
import type { SurveyPoint } from "./types";
import { applySurveyCollectionToDesign } from "./surveyCollectionApplication";

function fixture(role: SurveyPoint["role"] = "control") {
  const field = workflowTestField(), point = workflowTestPoint(1, role); field.surveyPoints.push(point);
  const owner = { designId: "design", documentKind: "field" as const, payloadId: field.id, fieldMapId: "map", projectCrs: field.projectCrs };
  const collection = proposeSurveyCaptureAppend(createSurveyCollection({ id: "collection", owner, purpose: { kind: "point", role }, now }), { expectedRevision: 0, point, now }).collection;
  const entry = { id: collection.id, document: serializeSurveyCollectionDocument(collection) };
  const input = { id: "review", owner, completedBy: "synthetic-operator", completedAt: now, sourceRevision: 1, sourceDocument: serializeFieldDesignDocument(field), collections: [entry], includedCollectionIds: [entry.id], excludedCollectionIds: [] };
  return { field, point, collection, entry, input };
}
test("point review resolves actual document equality while retaining pending collection and exact evidence", () => {
  const f = fixture(), review = createSurveyReview(f.input);
  assert.equal(f.collection.state, "pending"); assert.equal(f.collection.applications.length, 0);
  assert.deepEqual(parseSurveyReview(JSON.stringify(review)), review);
  assert(surveyReviewIsCurrent(review, f.input.owner, f.input.sourceDocument, [f.entry]));
  assert.equal(review.qualification, "operator_reviewed_receiver_evidence");
  const moved = structuredClone(f.field); moved.surveyPoints = [];
  assert.throws(() => createSurveyReview({ ...f.input, sourceDocument: serializeFieldDesignDocument(moved) }), /actual saved document observation/);
});
test("empty, note-only, foreign, incomplete and fabricated Survey scope cannot complete", () => {
  assert.throws(() => createSurveyReview(fixture("note").input), /notes alone/);
  const f = fixture();
  for (const update of [
    { includedCollectionIds: [] }, { excludedCollectionIds: ["collection"] }, { includedCollectionIds: ["missing"] },
    { owner: { ...f.input.owner, designId: "other" } }, { collections: [{ ...f.entry, id: "other" }] },
  ]) assert.throws(() => createSurveyReview({ ...f.input, ...update }));
  assert.throws(() => parseSurveyReview({ ...createSurveyReview(f.input), geometrySignature: "0".repeat(64) }), /snapshots|signatures/);
});
test("metadata renames preserve readiness; exact referenced geometry and membership drift require review", () => {
  const f = fixture(), review = createSurveyReview(f.input), renamed = structuredClone(f.field); renamed.name = "New label";
  renamed.machines[0].configuration.name = "New machine label";
  assert(surveyReviewIsCurrent(review, f.input.owner, serializeFieldDesignDocument(renamed), [f.entry]));
  renamed.fieldBoundary[0].x += 1;
  assert(!surveyReviewIsCurrent(review, f.input.owner, serializeFieldDesignDocument(renamed), [f.entry]));
  const cleared = { ...f.collection, activePointIds: [], state: "cleared" as const, revision: 2 };
  assert(!surveyReviewIsCurrent(review, f.input.owner, f.input.sourceDocument, [{ id: f.entry.id, document: serializeSurveyCollectionDocument(cleared) }]));
});
test("included areas require actual applied geometry, while retained excluded unfinished work does not qualify or disappear", () => {
  const f = fixture();
  let boundary = createSurveyCollection({ id: "boundary", owner: f.input.owner, purpose: { kind: "field_boundary" }, now });
  for (const point of [workflowTestPoint(2), workflowTestPoint(3, "control", 40.0001), workflowTestPoint(4, "control", 40, -104.9999)]) boundary = proposeSurveyCaptureAppend(boundary, { point, expectedRevision: boundary.revision, now }).collection;
  const boundaryEntry = () => ({ id: boundary.id, document: serializeSurveyCollectionDocument(boundary) });
  assert.throws(() => createSurveyReview({ ...f.input, collections: [f.entry, boundaryEntry()], includedCollectionIds: ["collection", "boundary"] }), /Apply included/);
  const excluded = createSurveyReview({ ...f.input, collections: [f.entry, boundaryEntry()], excludedCollectionIds: ["boundary"] });
  assert.equal(excluded.collections.length, 2); assert.equal(excluded.excludedCollectionIds[0], "boundary");
  const applied = applySurveyCollectionToDesign("field", f.input.sourceDocument, boundary, { applicationId: "boundary-application", now, designRevision: 2 });
  boundary = applied.collection;
  const review = createSurveyReview({ ...f.input, sourceDocument: applied.document, collections: [f.entry, boundaryEntry()], includedCollectionIds: ["collection", "boundary"] });
  assert.equal(review.includedCollectionIds.length, 2);
  const changed = structuredClone(f.field); changed.fieldBoundary[0].x += 10;
  assert.throws(() => createSurveyReview({ ...f.input, sourceDocument: serializeFieldDesignDocument(changed), collections: [f.entry, boundaryEntry()], includedCollectionIds: ["collection", "boundary"] }), /applied geometry/);
});
test("immutable target inventories contain exact pivot, corner guidance vertices and lateral endpoints", () => {
  const f = fixture();
  f.field.mapFeatures = [{ id: "guidance", name: "Explicit synthetic guidance", kind: "linear_move_path", geometry: { type: "LineString", vertices: [{ x: 499900, y: 4427700 }, { x: 500100, y: 4427800 }] }, confidence: "user_estimated" }];
  f.field.machines[0].cornerGuidanceFeatureId = "guidance";
  f.field.lateralMachines = [{ id: "lateral", kind: "straight_lateral", name: "Synthetic lateral", leftExtentMeters: 100, rightExtentMeters: 100,
    travelHeadingDegrees: 0, travel: { start: { x: 499900, y: 4427500 }, end: { x: 500100, y: 4427500 } }, machineClearanceBufferMeters: 1 }];
  const review = createSurveyReview({ ...f.input, sourceDocument: serializeFieldDesignDocument(f.field) });
  const target = createReviewedFieldLayoutTarget(f.field, { designId: "design", fieldMapId: "map", inputRevision: 1, expectedRevision: 1, selectedMachineIds: [f.field.machines[0].id, "lateral"], review });
  assert.deepEqual(target.targetPoints!.map(point => point.role), ["pivot_center", "corner_guidance", "corner_guidance", "lateral_start", "lateral_end"]);
  assert.deepEqual(target.targetPoints![1].projected, f.field.mapFeatures[0].geometry.type === "LineString" && f.field.mapFeatures[0].geometry.vertices[0]);
  const document = serializeFieldLayoutTarget(target); assert.deepEqual(parseFieldLayoutTarget(document), target);
  assert(Object.isFrozen(target.targetPoints));
  f.field.machines[0].pivotCenter.x += 20; assert.equal(serializeFieldLayoutTarget(target), document);
  const damaged = JSON.parse(document); damaged.targetPoints[0].projected.x += 1; assert.throws(() => parseFieldLayoutTarget(damaged), /inventory/);
});
test("grid residuals require actual metre projection; marking defaults record-only or unevaluated without invented tolerance", () => {
  const f = fixture(), review = createSurveyReview(f.input);
  const target = createReviewedFieldLayoutTarget(f.field, { designId: "design", fieldMapId: "map", inputRevision: 1, expectedRevision: 1, selectedMachineIds: [f.field.machines[0].id], review });
  const targetId = target.targetPoints![0].id, position = { x: target.targetPoints![0].projected.x - 3, y: target.targetPoints![0].projected.y - 4 };
  const residual = layoutPointResidual(target, targetId, position); assert.equal(residual.distanceMeters, 5); assert.equal(residual.eastMeters, 3); assert.equal(residual.northMeters, 4);
  assert.throws(() => layoutPointResidual({ ...target, field: { ...target.field, projectCrs: "LOCAL:unknown" } }, targetId, position), /metre coordinate/);
  assert.throws(() => layoutPointResidual({ ...target, field: { ...target.field, projectCrs: "EPSG:3857" } }, targetId, position), /metre coordinate/);
  const capture = workflowTestPoint(2), observation = { id: "mark", sessionId: "session", capturedAt: now, projected: capture.projected, evidence: capture.captureEvidence };
  assert.equal(annotateLayoutObservation(target, observation, { recordedBy: "operator" }).marking!.assessment, "record_only");
  assert.equal(annotateLayoutObservation(target, observation, { recordedBy: "operator", targetPointId: targetId }).marking!.assessment, "not_evaluated");
  assert.equal(annotateLayoutObservation(target, observation, { recordedBy: "operator", targetPointId: targetId, toleranceMeters: 0.01 }).marking!.assessment, "within_tolerance");
  assert.throws(() => annotateLayoutObservation(target, observation, { recordedBy: "operator", targetPointId: "foreign" }), /actual point/);
  assert.throws(() => annotateLayoutObservation(target, observation, { recordedBy: "operator", toleranceMeters: 0.01 }), /Choose a target/);
  const session = createLayoutSessionDocument({ id: "session", fieldMapId: "map", name: "Synthetic layout", targetDocument: serializeFieldLayoutTarget(target), now });
  session.observations.push(annotateLayoutObservation(target, observation, { recordedBy: "operator", targetPointId: targetId }));
  assert.deepEqual(parseLayoutSessionDocument(serializeLayoutSessionDocument(session)), session);
  const forged = structuredClone(session); (forged.observations[0] as typeof observation & { marking: { assessment: string } }).marking.assessment = "within_tolerance";
  assert.throws(() => parseLayoutSessionDocument(forged), /assessment/);
});
