import assert from "node:assert/strict";
import test from "node:test";

import { parseDesignDraftDocument, serializeDesignDraftDocument, tryBuildPivotProject, type DesignDraft } from "./designDraft";
import { createDesignDraftEditorState, reduceDesignDraftEditorState, type DesignDraftEditorAction, type DesignDraftEditorState } from "./designDraftEditor";
import { defaultProjectSettings } from "./settings";
import type { GnssCaptureEvidence } from "./types";

function blank(): DesignDraft {
  const settings = defaultProjectSettings();
  return { id: "draft", name: "Draft", projectCrs: null, unitSystem: settings.unitSystem, settings,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null,
    machine: {}, obstacles: [], surveyPoints: [] };
}

function local(): DesignDraftEditorState {
  return createDesignDraftEditorState({ ...blank(), projectCrs: "LOCAL:field" });
}

function edit(state: DesignDraftEditorState, action: DesignDraftEditorAction): DesignDraftEditorState {
  const before = JSON.stringify(state);
  const result = reduceDesignDraftEditorState(state, action);
  assert.equal(JSON.stringify(state), before, "an edit must not mutate the prior state");
  assert.equal(result.lastError, null);
  return result;
}

function reject(state: DesignDraftEditorState, action: DesignDraftEditorAction): void {
  const before = JSON.stringify(state);
  const result = reduceDesignDraftEditorState(state, action);
  assert.ok(result.lastError);
  assert.strictEqual(result.draft, state.draft);
  assert.strictEqual(result.past, state.past);
  assert.strictEqual(result.future, state.future);
  assert.equal(result.revision, state.revision);
  assert.equal(JSON.stringify(state), before);
}

function capture(): GnssCaptureEvidence {
  return { schemaVersion: "gnss-capture-v1", observationId: "observation", sessionId: "session", transport: "replay",
    receivedAt: "2026-09-26T00:00:00Z", receivedMonotonicMs: 1, sourceCoordinateFrame: "EPSG:4326",
    antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true, rawRecordHashes: ["synthetic"] };
}

test("blank editor supplies no geometry, CRS, machine or optional arrays", () => {
  const source = blank();
  const state = createDesignDraftEditorState(source);
  assert.deepEqual(state.draft, parseDesignDraftDocument(serializeDesignDraftDocument(source)));
  assert.equal(state.draft.projectCrs, null);
  assert.deepEqual(state.draft.machine, {});
  assert.equal(Object.hasOwn(state.draft, "mapFeatures"), false);
  source.name = "Caller changed";
  assert.equal(state.draft.name, "Draft");
  reject(state, { type: "insert_boundary_vertex", index: 0, point: { x: 1, y: 2 } });
});

test("zero, one and two boundary vertices roundtrip and remain calculation-ineligible", () => {
  let state = local();
  for (let count = 0; count <= 2; count += 1) {
    if (count) state = edit(state, { type: "insert_boundary_vertex", index: count - 1, point: { x: count, y: count } });
    const reopened = createDesignDraftEditorState(parseDesignDraftDocument(serializeDesignDraftDocument(state.draft)));
    assert.equal(reopened.draft.fieldBoundary.length, count);
    assert.equal(tryBuildPivotProject(reopened.draft).ok, false);
    assert.equal(reopened.draft.pivotCenter, null);
  }
  state = edit(state, { type: "delete_boundary_vertex", index: 1 });
  state = edit(state, { type: "delete_boundary_vertex", index: 0 });
  assert.deepEqual(state.draft.fieldBoundary, []);
});

test("manual boundary changes retain aligned untouched evidence and undo restores original bytes", () => {
  const draft = { ...blank(), projectCrs: "LOCAL:field", fieldBoundary: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    fieldBoundaryCaptureEvidence: [capture(), null] };
  let state = createDesignDraftEditorState(draft);
  const original = serializeDesignDraftDocument(state.draft);
  state = edit(state, { type: "insert_boundary_vertex", index: 0, point: { x: 0, y: 0 } });
  assert.deepEqual(state.draft.fieldBoundaryCaptureEvidence, [null, capture(), null]);
  state = edit(state, { type: "move_boundary_vertex", index: 1, point: { x: 1, y: 3 } });
  assert.deepEqual(state.draft.fieldBoundaryCaptureEvidence, [null, null, null]);
  state = edit(state, { type: "undo" });
  state = edit(state, { type: "undo" });
  assert.equal(serializeDesignDraftDocument(state.draft), original);
  assert.equal(state.revision, 4);
  state = edit(state, { type: "redo" });
  assert.equal(state.draft.fieldBoundary.length, 3);
  state = edit(state, { type: "replace_boundary", vertices: [{ x: 5, y: 6 }] });
  assert.equal(state.future.length, 0);
  assert.equal(Object.hasOwn(state.draft, "fieldBoundaryCaptureEvidence"), false);
});

test("CRS cannot change after clearing or undoing all captured coordinates", () => {
  let state = createDesignDraftEditorState(blank());
  state = edit(state, { type: "set_crs", projectCrs: "LOCAL:field" });
  state = edit(state, { type: "insert_boundary_vertex", index: 0, point: { x: 1, y: 2 } });
  reject(state, { type: "set_crs", projectCrs: "LOCAL:other" });
  state = edit(state, { type: "undo" });
  state = edit(state, { type: "undo" });
  assert.equal(state.draft.projectCrs, null);
  assert.equal(state.lockedCrs, "LOCAL:field");
  reject(state, { type: "set_crs", projectCrs: "LOCAL:other" });
  state = edit(state, { type: "set_crs", projectCrs: "LOCAL:field" });
  state = edit(state, { type: "insert_boundary_vertex", index: 0, point: { x: 1, y: 2 } });
  state = edit(state, { type: "replace_boundary", vertices: [] });
  reject(state, { type: "set_crs", projectCrs: null });
  reject(state, { type: "set_crs", projectCrs: "EPSG:4326" });
});

test("infrastructure edits unlink observations without altering measured coordinates", () => {
  const draft = { ...blank(), projectCrs: "LOCAL:field", pivotCenter: { x: 1, y: 2 } };
  draft.surveyPoints.push({ id: "survey", label: "Survey", role: "pivot_center", projected: { x: 1, y: 2 },
    observedAt: "synthetic", source: "external_gnss", confidence: "rtk_fixed", captureEvidence: capture() });
  const state = createDesignDraftEditorState({ ...draft, infrastructureObservationRefs: { pivot_center: "survey" },
    wgs84Companion: { status: "unavailable", source: "derived_from_project_xy", coordinateSystem: "decimal_degrees", projectCrs: "LOCAL:field" } });
  const next = edit(state, { type: "set_infrastructure", role: "pivot_center", point: { x: 3, y: 4 } });
  assert.equal(next.draft.infrastructureObservationRefs?.pivot_center, undefined);
  assert.equal(next.draft.wgs84Companion, undefined);
  assert.deepEqual(next.draft.surveyPoints, state.draft.surveyPoints);
  assert.deepEqual(edit(next, { type: "undo" }).draft, state.draft);
  for (const role of ["pivot_center", "water_source", "power_source"] as const) {
    const set = edit(next, { type: "set_infrastructure", role, point: { x: 5, y: 6 } });
    const cleared = edit(set, { type: "set_infrastructure", role, point: null });
    assert.equal(tryBuildPivotProject(cleared.draft).ok, false);
  }
});

test("undo into an earlier empty CRS cannot start a second coordinate frame in one session", () => {
  let state = createDesignDraftEditorState(blank());
  state = edit(state, { type: "set_crs", projectCrs: "LOCAL:earlier" });
  state = edit(state, { type: "set_crs", projectCrs: "LOCAL:captured" });
  state = edit(state, { type: "insert_boundary_vertex", index: 0, point: { x: 1, y: 2 } });
  state = edit(state, { type: "undo" });
  state = edit(state, { type: "undo" });
  assert.equal(state.draft.projectCrs, "LOCAL:earlier");
  assert.equal(state.lockedCrs, "LOCAL:captured");
  reject(state, { type: "insert_boundary_vertex", index: 0, point: { x: 3, y: 4 } });
  reject(state, { type: "set_infrastructure", role: "pivot_center", point: { x: 3, y: 4 } });
  state = edit(state, { type: "set_crs", projectCrs: "LOCAL:captured" });
  state = edit(state, { type: "insert_boundary_vertex", index: 0, point: { x: 3, y: 4 } });
  assert.deepEqual(state.draft.fieldBoundary, [{ x: 3, y: 4 }]);
});

test("machine partial fields and null span slots remain detached and ordered", () => {
  const machine = { spanLengthsMeters: [null, 30, null], sweep: { mode: "partial_circle" as const, startAngleDegrees: 20 } };
  const state = edit(local(), { type: "set_machine", machine });
  machine.spanLengthsMeters[1] = 999;
  assert.deepEqual(state.draft.machine.spanLengthsMeters, [null, 30, null]);
  assert.equal(Object.hasOwn(state.draft.machine, "id"), false);
  assert.equal(Object.hasOwn(state.draft.machine, "overhangMeters"), false);
  assert.deepEqual(edit(state, { type: "set_machine", machine: {} }).draft.machine, {});
  reject(state, { type: "set_machine", machine: { spanLengthsMeters: [-1] } });
});

test("display units change together without rescaling XY", () => {
  const state = edit(local(), { type: "insert_boundary_vertex", index: 0, point: { x: 100, y: 200 } });
  const next = edit(state, { type: "set_settings", settings: { ...state.draft.settings, unitSystem: "metric" } });
  assert.equal(next.draft.unitSystem, "metric");
  assert.equal(next.draft.settings.unitSystem, "metric");
  assert.deepEqual(next.draft.fieldBoundary, state.draft.fieldBoundary);
});

test("manual point, line and polygon features retain identities and never claim RTK confidence", () => {
  let state = local();
  const features = [
    { id: "point", name: "Well", kind: "well_location" as const, geometry: { type: "Point" as const, point: { x: 1, y: 2 } } },
    { id: "line", name: "Path", kind: "measurement_line" as const, geometry: { type: "LineString" as const, vertices: [{ x: 0, y: 0 }, { x: 2, y: 2 }] } },
    { id: "polygon", name: "Area", kind: "planning_boundary" as const, geometry: { type: "Polygon" as const, vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }] } },
  ];
  for (const feature of features) state = edit(state, { type: "add_manual_feature", feature });
  assert.deepEqual(state.draft.mapFeatures?.map((feature) => feature.confidence), Array(3).fill("user_estimated"));
  reject(state, { type: "add_manual_feature", feature: features[0] });
  reject(state, { type: "add_manual_feature", feature: { ...features[0], id: "injected", confidence: "rtk_fixed" } } as unknown as DesignDraftEditorAction);
  state = edit(state, { type: "delete_feature", id: "line" });
  assert.deepEqual(state.draft.mapFeatures?.map((feature) => feature.id), ["point", "polygon"]);
  reject(state, { type: "delete_feature", id: "missing" });
});

test("moving a surveyed feature removes its geometry evidence and restores it on undo", () => {
  const state = createDesignDraftEditorState({ ...blank(), projectCrs: "LOCAL:field", mapFeatures: [{
    id: "well", name: "Well", kind: "well_location", confidence: "rtk_fixed", vertexCaptureEvidence: [capture()],
    geometry: { type: "Point", point: { x: 1, y: 2 } },
  }] });
  const next = edit(state, { type: "set_feature_geometry", id: "well", geometry: { type: "Point", point: { x: 3, y: 4 } } });
  assert.equal(next.draft.mapFeatures?.[0].confidence, "user_estimated");
  assert.equal(next.draft.mapFeatures?.[0].vertexCaptureEvidence, undefined);
  assert.deepEqual(edit(next, { type: "undo" }).draft, state.draft);
  reject(state, { type: "set_feature_geometry", id: "missing", geometry: { type: "Point", point: { x: 3, y: 4 } } });
});

test("keep-out polygons can be added, edited and removed while preserving their original history", () => {
  const obstacle = { id: "keep-out", name: "Keep out", kind: "exclusion" as const, bufferMeters: 0, hardConflict: true, noSpray: true,
    polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }] };
  let state = edit(local(), { type: "add_manual_obstacle", obstacle });
  assert.equal(state.draft.obstacles[0].confidence, "user_estimated");
  reject(state, { type: "add_manual_obstacle", obstacle });
  reject(state, { type: "set_obstacle_polygon", id: obstacle.id, vertices: [] });
  const original = state;
  state = edit(state, { type: "set_obstacle_polygon", id: obstacle.id, vertices: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 1, y: 3 }] });
  assert.deepEqual(edit(state, { type: "undo" }).draft, original.draft);
  state = edit(state, { type: "delete_obstacle", id: obstacle.id });
  assert.deepEqual(state.draft.obstacles, []);
  reject(state, { type: "delete_obstacle", id: obstacle.id });
  reject(state, { type: "add_manual_obstacle", obstacle: { ...obstacle, vertexCaptureEvidence: [] } } as unknown as DesignDraftEditorAction);
});

test("surveyed obstacle edits invalidate evidence without rewriting any observation", () => {
  const state = createDesignDraftEditorState({ ...blank(), projectCrs: "LOCAL:field", obstacles: [{
    id: "surveyed", name: "Surveyed", kind: "exclusion", bufferMeters: 0, hardConflict: true, noSpray: true,
    polygon: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 2 }], confidence: "rtk_fixed", vertexCaptureEvidence: [capture(), null, null],
  }] });
  const next = edit(state, { type: "set_obstacle_polygon", id: "surveyed", vertices: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 1, y: 3 }] });
  assert.equal(next.draft.obstacles[0].confidence, "user_estimated");
  assert.equal(next.draft.obstacles[0].vertexCaptureEvidence, undefined);
  assert.deepEqual(edit(next, { type: "undo" }).draft, state.draft);
});

test("unsupported fields and invalid partial data cannot erase an existing draft", () => {
  const state = local();
  const machine = { overhangMeters: 2, unexpectedCalibration: true };
  reject(state, { type: "set_machine", machine });
  const incompleteSettings = { ...state.draft.settings };
  delete (incompleteSettings as Partial<typeof incompleteSettings>).mappingWorkflowMode;
  reject(state, { type: "set_settings", settings: incompleteSettings });
  let reads = 0;
  const accessor = Object.defineProperty({}, "overhangMeters", { enumerable: true, get() { reads += 1; return 2; } });
  reject(state, { type: "set_machine", machine: accessor });
  assert.equal(reads, 0);
});

test("action comparisons and feature creation do not execute caller accessors or JSON hooks", () => {
  const state = edit(local(), { type: "insert_boundary_vertex", index: 0, point: { x: 1, y: 2 } });
  let calls = 0;
  const point = Object.defineProperty({ y: 2 }, "x", { enumerable: true, get() { calls += 1; return 1; } });
  reject(state, { type: "move_boundary_vertex", index: 0, point } as DesignDraftEditorAction);
  reject(state, { type: "replace_boundary", vertices: Object.assign([{ x: 1, y: 2 }], { toJSON() { calls += 1; return []; } }) });
  const feature = Object.defineProperty({ id: "well", kind: "well_location", geometry: { type: "Point", point: { x: 1, y: 2 } } },
    "name", { enumerable: true, get() { calls += 1; return "Well"; } });
  reject(state, { type: "add_manual_feature", feature } as DesignDraftEditorAction);
  assert.equal(calls, 0);
});

test("invalid indices, coordinates and exhausted revisions fail without losing history", () => {
  const state = edit(local(), { type: "insert_boundary_vertex", index: 0, point: { x: 1, y: 2 } });
  for (const index of [-1, 0.5, 2, NaN, Infinity]) {
    reject(state, { type: "insert_boundary_vertex", index, point: { x: 0, y: 0 } });
    reject(state, { type: "delete_boundary_vertex", index });
  }
  reject(state, { type: "move_boundary_vertex", index: 1, point: { x: 0, y: 0 } });
  reject(state, { type: "move_boundary_vertex", index: 0, point: { x: NaN, y: 0 } });
  reject(state, { type: "set_crs", projectCrs: "EPSG:4326" });
  for (const revision of [Number.MAX_SAFE_INTEGER, -1, 0.5]) {
    reject({ ...state, revision }, { type: "rename", name: "New name" });
    reject({ ...state, revision }, { type: "undo" });
  }
});

test("no-op edits preserve revision, evidence and redo; errors clear without a geometry change", () => {
  let state = local();
  state = edit(state, { type: "rename", name: "Renamed" });
  state = edit(state, { type: "undo" });
  assert.strictEqual(edit(state, { type: "rename", name: state.draft.name }), state);
  assert.strictEqual(edit(state, { type: "replace_boundary", vertices: [] }), state);
  const errored = reduceDesignDraftEditorState(state, { type: "delete_boundary_vertex", index: 0 });
  const cleared = edit(errored, { type: "clear_error" });
  assert.equal(cleared.revision, state.revision);
  assert.strictEqual(cleared.future, state.future);
});
