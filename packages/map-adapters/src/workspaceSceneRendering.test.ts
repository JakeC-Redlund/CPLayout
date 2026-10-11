import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defaultAppSettings, defaultProjectSettings } from "../../core/src/settings";
import { sampleProject } from "../../core/src/sampleProject";
import { convertPivotProjectToFieldDesign } from "../../core/src/fieldDesignDocument";
import { createFieldLayoutTarget, serializeFieldLayoutTarget } from "../../core/src/fieldLayoutTarget";
import { createLayoutSessionDocument } from "../../core/src/layoutSession";
import { projectLonLatToXy } from "../../core/src/coordinates";
import type { OperationalFixedGgaEvidence } from "../../core/src/operationalGnssEvidence";
import { createSurveyCollection, validateSurveyCollection } from "../../core/src/surveyCollection";
import type { DesignDraft } from "../../core/src/designDraft";
import { workspaceMapSceneFromDraft, workspaceMapSceneFromField, workspaceMapSceneFromTarget, workspaceMapSceneFromSession } from "./workspaceMapScene";
import { createWorkspaceGestureSession, workspaceRenderPrimitives, workspaceSceneBounds, workspaceSceneGeoJson, workspaceProjectionSupported,
  workspacePointToScreen, workspaceHitTest, workspaceWebStyle } from "./workspaceSceneRendering";

const frame = { id: "field", generation: 1 }, now = "2026-10-10T12:00:00.000Z";
// Validate with the exact style-spec installed under this MapLibre runtime, not another hoisted version.
const workspaceRequire = createRequire(resolve(process.cwd(), "package.json"));
const validateStyleMin = createRequire(workspaceRequire.resolve("maplibre-gl/package.json"))("@maplibre/maplibre-gl-style-spec").validateStyleMin as (style: unknown) => unknown[];
function draft(crs: string | null = "LOCAL:field"): DesignDraft {
  const settings = defaultProjectSettings();
  return { id: "draft", name: "Draft", projectCrs: crs, unitSystem: settings.unitSystem, settings,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}
function field() {
  const result = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  result.machines.push({ ...structuredClone(result.machines[0]), id: "unequal", pivotCenter: { x: 501800.123456789, y: 4506500.987654321 },
    configuration: { ...result.machines[0].configuration, spanLengthsMeters: [23.123456789, 41.987654321], overhangMeters: 7.5 } });
  return result;
}

test("render primitives retain actual incomplete XY, empty scenes and independent supplied nominal dimensions", () => {
  const empty = workspaceMapSceneFromDraft(draft(), frame);
  assert.equal(workspaceSceneBounds(empty), null); assert.deepEqual(workspaceRenderPrimitives(empty), []);
  const partial = draft(); partial.fieldBoundary = [{ x: 123.123456789, y: -45.987654321 }]; partial.machine = { spanLengthsMeters: [null, 5], overhangMeters: 2 };
  const scene = workspaceMapSceneFromDraft(partial, frame), before = structuredClone(scene);
  assert.deepEqual(workspaceRenderPrimitives(scene)[0].geometry, { type: "Polygon", vertices: partial.fieldBoundary });
  assert.equal(workspaceRenderPrimitives(scene).some(primitive => primitive.nominal), false);
  const actual = field(), fieldScene = workspaceMapSceneFromField(actual, frame), nominal = workspaceRenderPrimitives(fieldScene).filter(primitive => primitive.nominal);
  assert.equal(nominal.length, 2);
  assert.deepEqual(nominal.map(primitive => primitive.geometry.type === "Circle" ? primitive.geometry.radiusMeters : null), [
    actual.machines[1].configuration.spanLengthsMeters.reduce((sum, span) => sum + span, 0) + actual.machines[1].configuration.overhangMeters,
    actual.machines[0].configuration.spanLengthsMeters.reduce((sum, span) => sum + span, 0) + actual.machines[0].configuration.overhangMeters,
  ]);
  assert.deepEqual(scene, before); assert.deepEqual(workspaceRenderPrimitives(fieldScene, { machine: false }).filter(primitive => primitive.nominal), []);
});

test("durable Survey, manual drawing, frozen targets and receiver graphics stay on real separate layers with no source mutation", () => {
  const source = draft("EPSG:32613");
  source.drawingWorkflow = { schemaVersion: "draft-drawing-workflow-v1", autosaveEnabled: true, lockedCrs: source.projectCrs, activeCaptureId: "manual",
    captures: [{ id: "manual", name: "Manual line", projectCrs: source.projectCrs!, geometryType: "LineString", stage: "drawing", source: "map_digitized",
      vertices: [{ point: { x: 501000.12, y: 4506200.34 }, recordedAt: now, wgs84: null, elevation: null }], classification: { purposeId: null, name: "Manual", notes: "" } }] };
  const created = createSurveyCollection({ id: "survey", now, purpose: { kind: "field_boundary" },
    owner: { designId: "design", fieldMapId: "field", documentKind: "draft", payloadId: source.id, projectCrs: source.projectCrs! } });
  const collection = validateSurveyCollection({ ...created, observations: [{ id: "survey-point", label: "Historic", role: "control", projected: { x: 501000.98, y: 4506200.76 }, observedAt: now,
    source: "external_gnss", confidence: "rtk_float", captureEvidence: { schemaVersion: "gnss-capture-v1", observationId: "historic", sessionId: "recorded", transport: "replay", receivedAt: now,
      receivedMonotonicMs: 10, sourceCoordinateFrame: "EPSG:4326", antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: false } }], activePointIds: ["survey-point"] });
  const scene = workspaceMapSceneFromDraft(source, { ...frame, catalogOwner: { designId: "design", fieldMapId: "field", projectCrs: source.projectCrs } },
    { surveyCollections: [collection], receiver: { observationId: "live-display", projectCrs: source.projectCrs!, point: { x: 501002, y: 4506202 } } });
  const before = structuredClone(scene), projected = workspaceSceneGeoJson(scene);
  assert.deepEqual(projected.features.map(feature => feature.properties?.layer), ["manual_capture", "survey_capture", "receiver"]);
  assert.equal(workspaceSceneGeoJson(scene, { survey_capture: false }).features.some(feature => feature.properties?.layer === "survey_capture"), false);
  assert.deepEqual(scene, before);
  const actual = field(), target = createFieldLayoutTarget(actual, { inputRevision: 2, expectedRevision: 2, selectedMachineIds: ["unequal"] });
  const frozen = workspaceSceneGeoJson(workspaceMapSceneFromTarget(target, frame));
  assert(frozen.features.some(feature => feature.properties?.layer === "frozen_target"));
  assert.equal(frozen.features.some(feature => feature.properties?.layer === "manual_capture" || feature.properties?.layer === "survey_capture"), false);
});

test("projection admission uses real CRS capability and web style preserves free imagery/reference attribution", () => {
  for (const crs of [null, "LOCAL:field", "EPSG:26913", "EPSG:26713"]) assert.equal(workspaceProjectionSupported(crs), false, String(crs));
  for (const crs of ["EPSG:32613", "EPSG:32713", "EPSG:3857"]) assert.equal(workspaceProjectionSupported(crs), true, crs);
  assert.throws(() => workspaceSceneGeoJson(workspaceMapSceneFromDraft(draft(), frame)), /projected XY/);
  const scene = workspaceMapSceneFromField(field(), frame), settings = defaultAppSettings(), before = structuredClone(settings);
  const style = workspaceWebStyle(scene, settings);
  assert.deepEqual(validateStyleMin(style.style), []);
  assert.equal(style.style.sources.workspace.type, "geojson");
  assert(style.style.layers.some(layer => layer.id === "workspace-point"));
  assert(style.style.sources.imagery); assert(style.attribution.some(value => /USGS/i.test(value)));
  assert.deepEqual(settings, before);
  const offline = workspaceWebStyle(scene, { ...settings, aerialImagery: { mode: "off" }, referenceOverlay: { ...settings.referenceOverlay, mode: "off" }, onlineImagery: { ...settings.onlineImagery, enabled: false } });
  assert.equal(offline.style.sources.imagery, undefined); assert(offline.style.sources.workspace);
});

test("Layout renderer projects separately saved observations and receiver without moving the exact frozen target", () => {
  const actual = field(), target = createFieldLayoutTarget(actual, { inputRevision: 2, expectedRevision: 2, selectedMachineIds: ["unequal"] });
  const session = createLayoutSessionDocument({ id: "session", name: "Session", fieldMapId: "field", now, targetDocument: serializeFieldLayoutTarget(target) });
  const payload = "GNGGA,120000.00,4000.0000,N,10500.0000,W,4,12,0.8,1600.0,M,-20.0,M,1.0,42";
  const checksum = [...payload].reduce((sum, character) => sum ^ character.charCodeAt(0), 0).toString(16).padStart(2, "0").toUpperCase();
  const evidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: "observed", sessionId: "receiver", transport: "local_udp",
    receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime: "120000.00", qualityCode: 4, latitude: 40, longitude: -105 },
    receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
    capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 }, projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
  const observed = projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:32613");
  session.observations.push({ id: "saved-observation", sessionId: session.id, capturedAt: now, projected: observed, evidence });
  const scene = workspaceMapSceneFromSession(session, frame, { receiver: { observationId: "next", projectCrs: "EPSG:32613", point: { x: observed.x + 1, y: observed.y + 1 } } });
  const before = structuredClone(scene), rendered = workspaceSceneGeoJson(scene);
  const point = rendered.features.find(feature => feature.properties?.layer === "layout_observation")!;
  assert.equal(point.geometry.type, "Point");
  if (point.geometry.type === "Point") { assert(Math.abs(point.geometry.coordinates[0] + 105) < 1e-8); assert(Math.abs(point.geometry.coordinates[1] - 40) < 1e-8); }
  assert(rendered.features.some(feature => feature.properties?.layer === "frozen_target"));
  assert(rendered.features.some(feature => feature.properties?.layer === "receiver"));
  assert.equal(workspaceSceneGeoJson(scene, { layout_observation: false }).features.some(feature => feature.properties?.layer === "layout_observation"), false);
  assert.deepEqual(scene, before); assert.equal(scene.targetAuthority?.document, session.targetDocument);
});

test("screen transform and hit testing select actual point/line addresses and honor hidden layers", () => {
  const source = draft(); source.waterSource = { x: 50, y: 50 }; source.fieldBoundary = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const scene = workspaceMapSceneFromDraft(source, frame), viewport = { center: { x: 50, y: 50 }, baseWidthMeters: 100, baseHeightMeters: 100, zoomLevel: 1 }, screen = { width: 400, height: 400 };
  assert.deepEqual(workspacePointToScreen(source.waterSource, viewport, screen), { x: 200, y: 200 });
  assert.equal(workspaceHitTest(workspaceRenderPrimitives(scene), viewport, screen, { x: 200, y: 200 }), scene.entities.find(entity => entity.kind === "infrastructure")!.address);
  assert.equal(workspaceHitTest(workspaceRenderPrimitives(scene, { infrastructure: false }), viewport, screen, { x: 200, y: 200 }), null);
  assert.equal(workspaceHitTest(workspaceRenderPrimitives(scene), viewport, screen, { x: 200, y: 399 }), scene.entities.find(entity => entity.kind === "boundary")!.address);
});

test("held pointer rejects retired interaction/context, drag, cancellation, secondary contacts and away/back token reuse", () => {
  const owner = { cameraContextKey: "field", interactionKey: "design:1" }, session = createWorkspaceGestureSession();
  const pointer = { pointerId: 1, isPrimary: true, button: 0 };
  assert.equal(session.begin(pointer, owner, { x: 10, y: 10 }), true);
  assert.equal(session.end(1, { ...owner, interactionKey: "survey:2" }), false);
  session.begin(pointer, owner, { x: 10, y: 10 }); session.cancel();
  assert.equal(session.end(1, owner), false);
  session.begin(pointer, owner, { x: 10, y: 10 }); session.move(1, { x: 30, y: 10 }); assert.equal(session.end(1, owner), false);
  session.begin(pointer, owner, { x: 10, y: 10 }); assert.equal(session.end(1, { ...owner, cameraContextKey: "other" }), false);
  session.begin(pointer, owner, { x: 10, y: 10 }); session.begin({ pointerId: 2, isPrimary: false, button: 0 }, owner, { x: 10, y: 10 });
  assert.equal(session.end(2, owner), false); assert.equal(session.end(1, owner), false);
  session.begin(pointer, owner, { x: 10, y: 10 }); session.begin({ pointerId: 2, isPrimary: false, button: 0 }, owner, { x: 10, y: 10 }, false);
  assert.equal(session.end(2, owner), false); assert.equal(session.end(1, owner), false);
  session.begin(pointer, owner, { x: 10, y: 10 }); assert.equal(session.end(1, owner, true), false);
  session.begin(pointer, owner, { x: 10, y: 10 }); assert.equal(session.end(1, owner), true); assert.equal(session.end(1, owner), false);
});
