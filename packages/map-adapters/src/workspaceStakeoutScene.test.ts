import assert from "node:assert/strict";
import test from "node:test";
import { workflowTestField, workflowTestPoint, workflowTestTime as now } from "../../core/src/productionWorkflowTestFixtures";
import { createSurveyCollection, proposeSurveyCaptureAppend, serializeSurveyCollectionDocument } from "../../core/src/surveyCollection";
import { createSurveyReview } from "../../core/src/surveyReview";
import { serializeFieldDesignDocument } from "../../core/src/fieldDesignDocument";
import { createReviewedFieldLayoutTarget, serializeFieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { annotateLayoutObservation, createLayoutSessionDocument, createRtkLayoutSessionDocument, finalizeRtkLayoutSession, parseLayoutSessionDocument, serializeLayoutSessionDocument } from "../../core/src/layoutSession";
import { layoutLockFromReceiverCapture } from "../../core/src/officialLayout";
import { workspaceSceneGeoJson } from "./workspaceSceneRendering";
import { workspaceMapSceneFromSession, workspaceMapSceneFromTarget, validateWorkspaceMapScene } from "./workspaceMapScene";

function targetFixture(lateral = false) {
  const field = workflowTestField(), point = workflowTestPoint(); field.surveyPoints.push(point);
  if (lateral) field.lateralMachines = [{ id: "linear", kind: "straight_lateral", name: "Measured linear", leftExtentMeters: 30,
    rightExtentMeters: 40, travelHeadingDegrees: 0, travel: { start: { ...point.projected }, end: { x: point.projected.x + 100, y: point.projected.y } }, machineClearanceBufferMeters: 2 }];
  const document = serializeFieldDesignDocument(field);
  const owner = { designId: "design", documentKind: "field" as const, payloadId: field.id, fieldMapId: "map", projectCrs: field.projectCrs };
  const collection = proposeSurveyCaptureAppend(createSurveyCollection({ id: "collection", owner, purpose: { kind: "point", role: "control" }, now }),
    { expectedRevision: 0, point, now }).collection;
  const review = createSurveyReview({ id: "review", owner, completedBy: "synthetic-operator", completedAt: now, sourceRevision: 1, sourceDocument: document,
    collections: [{ id: collection.id, document: serializeSurveyCollectionDocument(collection) }], includedCollectionIds: [collection.id], excludedCollectionIds: [] });
  return createReviewedFieldLayoutTarget(field, { inputRevision: 1, expectedRevision: 1, designId: "design", fieldMapId: "map", review,
    selectedMachineIds: [lateral ? "linear" : field.machines[0].id] });
}
test("reviewed pivot target and session render their exact selectable station without changing frozen bytes", () => {
  const target = targetFixture(), original = serializeFieldLayoutTarget(target);
  const scene = workspaceMapSceneFromTarget(target, { id: "target-frame", generation: 1 });
  const stations = scene.entities.filter(entity => entity.sourcePath.startsWith("targetPoints["));
  assert.equal(stations.length, 1); assert.equal(stations[0].sourceId, target.targetPoints![0].id);
  assert.deepEqual(stations[0].geometry, { type: "Point", point: target.targetPoints![0].projected });
  const session = createLayoutSessionDocument({ id: "session", name: "Stakeout", fieldMapId: "map", targetDocument: original, now });
  assert.equal(workspaceMapSceneFromSession(session, { id: "session-frame", generation: 1 }).entities.filter(entity => entity.sourcePath.startsWith("targetPoints[")).length, 1);
  assert.equal(serializeFieldLayoutTarget(target), original);
  const corrupt = { ...scene, entities: scene.entities.map(entity => entity.sourcePath.startsWith("targetPoints[")
    ? { ...entity, geometry: { type: "Point" as const, point: { x: 0, y: 0 } } } : entity) };
  assert.throws(() => validateWorkspaceMapScene(corrupt), /Frozen render geometry/);
});
test("a selected lateral retains its real travel line and two distinct frozen endpoints", () => {
  const target = targetFixture(true), scene = workspaceMapSceneFromTarget(target, { id: "linear-frame", generation: 1 });
  assert.deepEqual(scene.machines.map(machine => machine.id), ["linear"]);
  assert.equal(scene.entities.filter(entity => entity.sourcePath.startsWith("targetPoints[")).length, 2);
  assert(scene.entities.some(entity => entity.sourcePath === "lateralMachines[0]" && entity.layer === "frozen_target"));
  assert(!scene.entities.some(entity => entity.sourcePath === "machines[0]"));
});

test("only finalized measured stations receive the official layer while planned geometry retains its exact coordinates", () => {
  const target = targetFixture(), document = serializeFieldLayoutTarget(target), actor = "synthetic-operator";
  const pending = createRtkLayoutSessionDocument({ id: "rtk-session", name: "Recorded map", fieldMapId: "map", targetDocument: document, now,
    creationLock: layoutLockFromReceiverCapture(workflowTestPoint(2), actor) });
  const measured = workflowTestPoint(3, "control", 40.000001, -105);
  const observation = annotateLayoutObservation(target, { id: measured.id, sessionId: pending.id, capturedAt: now,
    projected: measured.projected, evidence: measured.captureEvidence, label: "Measured pivot", targetPointId: target.targetPoints![0].id },
    { recordedBy: actor, targetPointId: target.targetPoints![0].id, toleranceMeters: 0.5 });
  const collected = parseLayoutSessionDocument({ ...pending, observations: [observation] });
  const pendingScene = workspaceMapSceneFromSession(collected, { id: "pending-frame", generation: 1 });
  assert.equal(pendingScene.entities.filter(item => item.layer === "official_layout_station").length, 0);
  assert.equal(pendingScene.entities.filter(item => item.layer === "layout_observation").length, 1);
  const finalized = finalizeRtkLayoutSession(collected, layoutLockFromReceiverCapture(workflowTestPoint(4), actor), now);
  const scene = workspaceMapSceneFromSession(finalized, { id: "official-frame", generation: 1 });
  const station = scene.entities.find(item => item.layer === "official_layout_station")!;
  assert.equal(station.sourceId, observation.id);
  assert.deepEqual(station.geometry, { type: "Point", point: measured.projected });
  assert.notDeepEqual(measured.projected, target.targetPoints![0].projected);
  assert.deepEqual(scene.entities.find(item => item.sourcePath === "targetPoints[0]")!.geometry,
    { type: "Point", point: target.targetPoints![0].projected });
  assert.equal(scene.entities.find(item => item.sourcePath === "fieldBoundary")!.layer, "frozen_target");
  const geojson = workspaceSceneGeoJson(scene);
  assert.equal(geojson.features.filter(item => item.properties?.layer === "official_layout_station").length, 1);
  assert.equal(workspaceSceneGeoJson(scene, { official_layout_station: false }).features.filter(item => item.properties?.layer === "official_layout_station").length, 0);
  assert.equal(finalized.targetDocument, document);
  const reference = parseLayoutSessionDocument({ ...finalized, finalization: null, referenceSourceDocument: serializeLayoutSessionDocument(finalized) });
  assert.equal(workspaceMapSceneFromSession(reference, { id: "reference-frame", generation: 1 }).entities.some(item => item.layer === "official_layout_station"), false);
  const forged = { ...pendingScene, entities: pendingScene.entities.map(item => item.kind === "observation" ? { ...item, layer: "official_layout_station" as const } : item) };
  assert.throws(() => validateWorkspaceMapScene(forged), /Rendered Layout observations differ/);
});
