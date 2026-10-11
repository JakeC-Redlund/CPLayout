function digitized<T extends { capture: { source: string } }>(record: T): Extract<T, { classification: unknown }> {
  assert.ok("classification" in record, "Expected the unchanged digitized fixture branch.");
  return record as Extract<T, { classification: unknown }>;
}
import assert from "node:assert/strict";
import test from "node:test";
import { applyClassifiedProjectDrawing, type ClassifiedProjectDrawingCommand } from "./classifiedProjectDrawing";
import { DRAWING_CLASSIFICATION_VERSION, type DrawingClassification } from "./drawingClassification";
import { createProjectEditorState, reduceProjectEditorState, type ProjectEditorState } from "./projectReducer";
import { parseProjectDocument, parseProjectDocumentV1, parseProjectDocumentV2, serializeProjectDocument } from "./projectDocument";
import { sampleProject } from "./sampleProject";
import { projectLonLatToXy } from "./coordinates";
import type { OperationalFixedGgaEvidence } from "./operationalGnssEvidence";
import type { XY } from "./types";

const firstTime = "2026-10-10T12:00:00.000Z", laterTime = "2026-10-10T12:00:01.125Z";
function command(state: ProjectEditorState, purposeId = "well", geometryType: DrawingClassification["geometryType"] = "Point", points: XY[] = [{ x: 501025.123456789, y: 4506235.987654321 }]): ClassifiedProjectDrawingCommand {
  return { type: "commit_classified_drawing", projectId: state.project.id, projectCrs: state.project.projectCrs, expectedRevision: state.revision,
    captureId: `${purposeId}-actual-clicks`, geometryType,
    vertices: points.map((point, index) => ({ point: { ...point }, recordedAt: index === 0 ? firstTime : laterTime, wgs84: null, elevation: null })),
    classification: { schemaVersion: DRAWING_CLASSIFICATION_VERSION, purposeId, geometryType, name: "Exact raw label  ", notes: "Exact raw notes\nsecond line", assetStatus: "unknown", placement: "not_applicable", customLabel: null, effect: { mode: "informational" } },
    entityId: `${purposeId}-actual-entity` };
}
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function commit(state: ProjectEditorState, action: ClassifiedProjectDrawingCommand) {
  const next = reduceProjectEditorState(state, action); assert.equal(next.lastError, null); assert.equal(next.revision, state.revision + 1); assert.equal(next.past.length, state.past.length + 1);
  assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, state.project);
  assert.deepEqual(reduceProjectEditorState(reduceProjectEditorState(next, { type: "undo" }), { type: "redo" }).project, next.project); return next;
}
test("actual Project click classification commits exact geometry/labels/times once and serializes v2 without mutating source", () => {
  const state = createProjectEditorState(sampleProject), action = command(state), source = JSON.stringify(state.project), input = JSON.stringify(action);
  freeze(state.project); freeze(action); const next = commit(state, action), feature = next.project.mapFeatures!.at(-1)!;
  assert.deepEqual(feature.geometry, { type: "Point", point: action.vertices[0].point }); assert.equal(feature.name, action.classification.name); assert.equal(feature.notes, action.classification.notes);
  assert.equal(feature.confidence, "user_estimated"); assert.equal(feature.vertexCaptureEvidence, undefined);
  const record = digitized(next.project.drawingMetadata!.records[0]); assert.deepEqual(record.classification, action.classification);
  assert.deepEqual(record.capture, { captureId: action.captureId, source: "map_digitized", vertexRecordedAt: [firstTime], wgs84: null, elevation: null });
  assert.equal(JSON.stringify(state.project), source); assert.equal(JSON.stringify(action), input);
  const serialized = serializeProjectDocument(next.project); assert.equal(JSON.parse(serialized).documentVersion, "pivot-project-v2"); assert.deepEqual(parseProjectDocument(serialized), JSON.parse(JSON.stringify(next.project)));
  assert.throws(() => parseProjectDocumentV1(serialized), /version/);
});
test("classified boundary replacement keeps optional details and drops superseded capture evidence in one history transaction", () => {
  let state = createProjectEditorState(sampleProject); state = commit(state, command(state));
  const previousRecord = state.project.drawingMetadata!.records[0]; state = { ...state, project: { ...state.project, fieldBoundaryCaptureEvidence: state.project.fieldBoundary.map(() => null) } };
  const action = command(state, "field_boundary", "Polygon", state.project.fieldBoundary.slice(0, 4)); delete action.entityId; action.replaceExisting = true;
  const next = commit(state, action); assert.deepEqual(next.project.fieldBoundary, action.vertices.map(item => item.point)); assert.equal(next.project.fieldBoundaryCaptureEvidence, undefined);
  assert.deepEqual(next.project.drawingMetadata!.records[0], previousRecord); assert.deepEqual(digitized(next.project.drawingMetadata!.records[1]).classification, action.classification);
  assert.deepEqual(digitized(next.project.drawingMetadata!.records[1]).capture.vertexRecordedAt, action.vertices.map(item => item.recordedAt));
});
test("digitized operational replacements clear only the actual role reference and retain all immutable observations", () => {
  const project = structuredClone(sampleProject), roles = ["pivot_center", "water_source", "power_source"] as const;
  project.surveyPoints = roles.map((role, index) => ({ id: `observation-${role}`, label: role, role, projected: { ...(index === 0 ? project.pivotCenter : index === 1 ? project.waterSource : project.powerSource) }, observedAt: firstTime, source: "manual", confidence: "user_estimated" }));
  project.infrastructureObservationRefs = Object.fromEntries(roles.map(role => [role, `observation-${role}`]));
  for (const role of roles) {
    const state = createProjectEditorState(project), action = command(state, role === "water_source" ? "project_water_source" : role === "power_source" ? "project_power_source" : role);
    delete action.entityId; action.replaceExisting = true;
    const next = commit(state, action); assert.equal(next.project.infrastructureObservationRefs![role], undefined); assert.deepEqual(next.project.surveyPoints, state.project.surveyPoints);
    for (const other of roles.filter(item => item !== role)) assert.equal(next.project.infrastructureObservationRefs![other], state.project.infrastructureObservationRefs![other]);
    assert.equal(next.project.drawingMetadata!.records[0].target.kind, role); assert.equal(digitized(next.project.drawingMetadata!.records[0]).classification.notes, action.classification.notes);
  }
});
test("explicit exclusion effects and rich reference purpose survive Project serialization without measured provenance", () => {
  const state = createProjectEditorState(sampleProject), action = command(state, "exclusion_area", "Polygon", state.project.fieldBoundary.slice(0, 4));
  action.classification.effect = { mode: "exclusion", noSpray: true, hardConflict: false, bufferMeters: 1.125 };
  const next = commit(state, action), obstacle = next.project.obstacles.at(-1)!;
  assert.equal(obstacle.noSpray, true); assert.equal(obstacle.hardConflict, false); assert.equal(obstacle.bufferMeters, 1.125); assert.equal(obstacle.vertexCaptureEvidence, undefined);
  assert.equal(digitized(next.project.drawingMetadata!.records[0]).classification.notes, action.classification.notes);
  const line = command(next, "subsurface_drain", "LineString", [{ x: 501010, y: 4506200 }, { x: 501015.123456789, y: 4506250 }]); line.classification.placement = "underground";
  const final = commit(next, line); assert.equal(final.project.mapFeatures!.at(-1)!.kind, "reference_line"); assert.deepEqual(parseProjectDocument(serializeProjectDocument(final.project)), JSON.parse(JSON.stringify(final.project)));
});
test("replacing a previously classified operational target removes only its old record and uses new exact click times", () => {
  const state = createProjectEditorState(sampleProject), first = command(state, "pivot_center"); delete first.entityId; first.replaceExisting = true;
  const initial = commit(state, first), second = command(initial, "pivot_center", "Point", [{ x: 501050.987654321, y: 4506250.123456789 }]); delete second.entityId; second.replaceExisting = true; second.captureId = "second-actual-click"; second.vertices[0].recordedAt = laterTime;
  const next = commit(initial, second); assert.equal(next.project.drawingMetadata!.records.length, 1); assert.equal(digitized(next.project.drawingMetadata!.records[0]).capture.captureId, second.captureId); assert.deepEqual(digitized(next.project.drawingMetadata!.records[0]).capture.vertexRecordedAt, [laterTime]);
});
test("stale/wrong owner, malformed clicks, aliasing IDs and missing replacement consent fail without partial geometry/history mutation", () => {
  const state = createProjectEditorState(sampleProject), base = command(state);
  const malformed = [
    { ...base, expectedRevision: 1 }, { ...base, projectId: "another-project" }, { ...base, projectCrs: "EPSG:32614" }, { ...base, expectedRevision: Number.MAX_SAFE_INTEGER },
    { ...base, entityId: state.project.obstacles[0].id }, { ...base, vertices: [] }, { ...base, vertices: [{ ...base.vertices[0], recordedAt: "not-a-time" }] },
    { ...base, vertices: [{ ...base.vertices[0], wgs84: { latitude: 40, longitude: -105 } }] }, { ...base, vertices: [{ ...base.vertices[0], point: { x: Infinity, y: 1 } }] },
    { ...base, source: "external_gnss" },
  ];
  const operational = command(state, "project_water_source"); delete operational.entityId; malformed.push(operational);
  const previous = JSON.stringify(state); freeze(state.project);
  for (const input of malformed) { const next = reduceProjectEditorState(state, input as ClassifiedProjectDrawingCommand); assert(next.lastError); assert.strictEqual(next.project, state.project); assert.strictEqual(next.past, state.past); assert.equal(next.revision, state.revision); assert.equal(JSON.stringify(state), previous); }
  const committed = commit(state, base); const duplicateCapture = { ...command(committed), entityId: "unused" }; assert.match(reduceProjectEditorState(committed, duplicateCapture).lastError ?? "", /capture identity/);
  const duplicateSurvey = { ...state.project, surveyPoints: [{ id: "survey-id", label: "Saved observation", role: "control" as const, projected: { x: 1, y: 2 }, observedAt: firstTime, source: "manual" as const, confidence: "user_estimated" as const }] };
  assert.throws(() => applyClassifiedProjectDrawing(duplicateSurvey, { ...base, entityId: "survey-id" }, 0), /identity already exists/);
});
test("genuine operational receiver evidence remains separate and selects v3 after digitized classification", () => {
  const payload = "GNGGA,120000.00,4000.0000,N,10500.0000,W,4,12,0.8,1600.0,M,-20.0,M,1.0,42", checksum = [...payload].reduce((sum, c) => sum ^ c.charCodeAt(0), 0).toString(16).padStart(2, "0").toUpperCase();
  const evidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: "receiver-observation", sessionId: "receiver-session", transport: "local_udp",
    receivedAt: firstTime, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime: "120000.00", qualityCode: 4, latitude: 40, longitude: -105 },
    receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" }, capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 },
    projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
  const project = { ...structuredClone(sampleProject), surveyPoints: [{ id: "survey-evidence", label: "Actual receiver fixture", role: "control" as const, projected: projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:32613"), observedAt: firstTime, source: "external_gnss" as const, confidence: "rtk_fixed" as const, captureEvidence: evidence }] };
  const state = createProjectEditorState(project), next = commit(state, command(state));
  assert.deepEqual(next.project.surveyPoints, state.project.surveyPoints); const serialized = serializeProjectDocument(next.project); assert.equal(JSON.parse(serialized).documentVersion, "pivot-project-v3");
  assert.deepEqual(parseProjectDocument(serialized).surveyPoints, state.project.surveyPoints); assert.throws(() => parseProjectDocumentV2(serialized), /version|evidence/); assert.equal(digitized(next.project.drawingMetadata!.records[0]).capture.source, "map_digitized");
});
