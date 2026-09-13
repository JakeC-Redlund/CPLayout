import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultAppSettings, projectXyToLonLat, sampleProject, type ProjectMutationResult, type XY } from "@cplayout/core";
import { evaluateLayout } from "@cplayout/geometry";

import { createMapInteractionController, createMapInteractionState, reconcileMapInteractionState, type MapInteractionController } from "./mapInteractionController";
import type { MapSurfaceProps } from "./types";

const result = evaluateLayout(sampleProject);
const triangle = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 200, y: 300 }];
const square = [...triangle, { x: 50, y: 200 }];
const options = { imageryEnabled: false };

function makeProps(overrides: Partial<MapSurfaceProps> = {}): MapSurfaceProps {
  return {
    project: { ...sampleProject, fieldBoundary: square, obstacles: [], mapFeatures: [] },
    result,
    settings: { ...defaultAppSettings(), mappingWorkflowMode: "design" },
    ...overrides,
  };
}

function draw(controller: MapInteractionController, vertices = triangle): void {
  vertices.forEach((vertex) => controller.methods.handleProjectedPoint(vertex));
}

test("pure reconciliation and unchanged input/request updates preserve drafts", () => {
  const props = makeProps({ activeToolMode: "draw_boundary", activeToolRequestId: 1 });
  const initial = createMapInteractionState(props);
  const state = { ...initial, draftVertices: triangle };
  const before = structuredClone(state);
  const next = reconcileMapInteractionState(state, props, { ...props, activeToolRequestId: 2 });
  assert.deepEqual(state, before);
  assert.equal(next.draftVertices, triangle);

  const controller = createMapInteractionController(props, options);
  draw(controller);
  const snapshot = controller.getSnapshot();
  controller.updateInputs({ ...props }, options);
  assert.equal(controller.getSnapshot(), snapshot);
  controller.updateInputs({ ...props, activeToolRequestId: 2 }, options);
  assert.equal(controller.getSnapshot(), snapshot);
  controller.methods.setTool("draw_boundary");
  assert.equal(controller.getSnapshot(), snapshot);
  controller.methods.setStatus("Menu open");
  assert.deepEqual(controller.getSnapshot().draftVertices, triangle);
});

test("actual mode, layer, kind, geometry and typed/generic changes clear drafts", () => {
  let props = makeProps({ activeToolMode: "measure", activeDraftGeometry: "Polygon" });
  const controller = createMapInteractionController(props, options);
  draw(controller);
  controller.methods.setTool("pan");
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  controller.methods.setTool("measure");
  draw(controller);
  controller.methods.setActiveLayer("ditch");
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  draw(controller);
  controller.methods.setMapFeatureKind("road");
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  assert.equal(controller.getSnapshot().activeFeatureGeometry, "Polygon");
  draw(controller);
  props = { ...props, activeDraftGeometry: "Circle" };
  controller.updateInputs(props, options);
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  assert.equal(controller.getSnapshot().activeFeatureGeometry, "Circle");
  draw(controller);
  props = { ...props, activeMapFeatureKind: "road" };
  controller.updateInputs(props, options);
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  draw(controller);
  controller.updateInputs({ ...props, activeMapFeatureKind: undefined }, options);
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
});

test("project, CRS and manual request changes discard scoped state", () => {
  let props = makeProps({ activeToolMode: "draw_boundary", manualDesignCaptureRequest: { requestId: 1, role: "boundary" } });
  const controller = createMapInteractionController(props, options);
  draw(controller);
  controller.updateInputs({ ...props, manualDesignCaptureRequest: { requestId: 1, role: "boundary" } }, options);
  assert.equal(controller.getSnapshot().draftVertices.length, 3);
  props = { ...props, manualDesignCaptureRequest: { requestId: 2, role: "boundary" } };
  controller.updateInputs(props, options);
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  draw(controller);
  props = { ...props, project: { ...props.project, id: "another-project" } };
  controller.updateInputs(props, options);
  assert.equal(controller.getSnapshot().mode, "pan");
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  controller.methods.selectFirstBoundaryVertex();
  props = { ...props, project: { ...props.project, projectCrs: props.project.projectCrs === "EPSG:32613" ? "EPSG:32614" : "EPSG:32613" } };
  controller.updateInputs(props, options);
  assert.equal(controller.getSnapshot().mode, "pan");
  assert.equal(controller.getSnapshot().selectedVertex, null);
});

test("layout and catalog gate every mutation path, clear drafts and selection", () => {
  for (const scope of ["layout", "catalog"] as const) {
    let calls = 0;
    const callback = () => { calls += 1; };
    const props = makeProps({
      onCommitBoundaryDraft: callback, onCommitObstacleDraft: callback, onCreateMapFeatureDraft: callback,
      onAddMapFeature: callback, onAddSurveyPoint: callback, onPlacePivot: callback, onMoveInfrastructurePoint: callback,
      onMoveBoundaryVertex: callback, onInsertBoundaryVertex: callback, onDeleteBoundaryVertex: callback,
      onManualDesignCapture: callback,
    });
    const controller = createMapInteractionController(props, options);
    controller.methods.setTool("draw_boundary");
    draw(controller);
    const blocked = scope === "layout"
      ? { ...props, settings: { ...props.settings, mappingWorkflowMode: "layout" as const } }
      : { ...props, homeView: true };
    controller.updateInputs(blocked, options);
    assert.equal(controller.getSnapshot().mode, "pan");
    assert.equal(controller.getSnapshot().draftVertices.length, 0);
    for (const mode of ["draw_boundary", "mark_obstacle", "measure", "place_pivot", "capture_point", "edit_vertices"] as const) {
      controller.methods.setTool(mode);
      controller.methods.handleProjectedPoint(triangle[0]);
      controller.methods.handleLonLat({ longitude: -101, latitude: 40 });
      controller.methods.handleDraftVertexIntent(triangle[0], true);
      controller.methods.commitDraft();
      controller.methods.saveMapFeatureFromDraft();
      controller.methods.selectFirstBoundaryVertex();
      controller.methods.nudgeSelectedVertex({ x: 1, y: 0 });
      controller.methods.moveSelectedVertexToPoint(triangle[0]);
      controller.methods.insertAfterSelectedVertex();
      controller.methods.deleteSelectedVertex();
    }
    assert.equal(calls, 0);
    assert.equal(controller.getSnapshot().selectedVertex, null);
    assert.equal(controller.getSnapshot().canCommitDraft, false);
    assert.equal(controller.getSnapshot().canSaveFeature, false);
    controller.updateInputs(props, options);
    assert.equal(controller.getSnapshot().draftVertices.length, 0);
  }
});

test("stable callbacks use latest props and draft state exactly once", () => {
  let oldCalls = 0;
  const received: XY[][] = [];
  const props = makeProps({ activeToolMode: "draw_boundary", onCommitBoundaryDraft: () => { oldCalls += 1; } });
  const controller = createMapInteractionController(props, options);
  const { handleProjectedPoint, commitDraft } = controller.methods;
  draw(controller);
  controller.updateInputs({ ...props, onCommitBoundaryDraft: (vertices) => { received.push(vertices); } }, options);
  handleProjectedPoint(triangle[0]);
  assert.equal(oldCalls, 0);
  assert.deepEqual(received, [triangle]);
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  commitDraft();
  assert.equal(received.length, 1);
  draw(controller);
  commitDraft();
  assert.deepEqual(received, [triangle, triangle]);
});

test("rejected or absent commits retain draft; existing void callbacks succeed", () => {
  let props = makeProps({ activeToolMode: "draw_boundary" });
  const controller = createMapInteractionController(props, options);
  draw(controller);
  assert.equal(controller.getSnapshot().canCommitDraft, false);
  controller.methods.commitDraft();
  assert.deepEqual(controller.getSnapshot().draftVertices, triangle);
  assert.match(controller.getSnapshot().status, /unavailable/);
  props = { ...props, onCommitBoundaryDraft: (vertices) => { vertices[0].x = -999; return false; } };
  controller.updateInputs(props, options);
  assert.equal(controller.getSnapshot().canCommitDraft, true);
  controller.methods.commitDraft();
  assert.deepEqual(controller.getSnapshot().draftVertices, triangle);
  assert.match(controller.getSnapshot().status, /validation failed/);
  controller.updateInputs({ ...props, onCommitBoundaryDraft: () => undefined }, options);
  controller.methods.commitDraft();
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  assert.match(controller.getSnapshot().status, /Committed field boundary with 3/);
});

test("two vertices plus explicit close retain the third vertex on rejection", () => {
  const received: XY[][] = [];
  const controller = createMapInteractionController(makeProps({ activeToolMode: "draw_boundary", onCommitBoundaryDraft: (vertices) => { received.push(vertices); return false; } }), options);
  draw(controller, triangle.slice(0, 2));
  controller.methods.handleProjectedPoint(triangle[2], true);
  assert.deepEqual(received, [triangle]);
  assert.deepEqual(controller.getSnapshot().draftVertices, triangle);
});

test("browser click/click/dblclick sequence retains three distinct vertices", () => {
  for (const mode of ["draw_boundary", "mark_obstacle", "measure"] as const) {
    const received: XY[][] = [];
    const controller = createMapInteractionController(makeProps({
      activeToolMode: mode, activeDraftGeometry: "Polygon",
      onCommitBoundaryDraft: (vertices) => { received.push(vertices); },
      onCommitObstacleDraft: (vertices) => { received.push(vertices); },
      onCreateMapFeatureDraft: (draft) => { received.push(draft.vertices); },
    }), options);
    draw(controller, triangle.slice(0, 2));
    controller.methods.handleProjectedPoint(triangle[2], false);
    controller.methods.handleProjectedPoint(triangle[2], false);
    assert.deepEqual(controller.getSnapshot().draftVertices, triangle);
    controller.methods.handleProjectedPoint(triangle[2], true);
    if (mode === "measure") {
      assert.equal(received.length, 0);
      assert.deepEqual(controller.getSnapshot().draftVertices, triangle);
      controller.methods.saveMapFeatureFromDraft();
    }
    assert.deepEqual(received, [triangle]);
    assert.equal(controller.getSnapshot().draftVertices.length, 0);
  }
});

test("duplicate filtering uses tiny XY epsilon and preserves nearby distinct vertices", () => {
  const captures: XY[][] = [];
  const props = makeProps({
    activeToolMode: "draw_boundary", manualDesignCaptureRequest: { requestId: 1, role: "boundary" },
    onManualDesignCapture: (capture) => { captures.push(capture.vertices ?? []); },
  });
  const controller = createMapInteractionController(props, options);
  draw(controller, triangle.slice(0, 2));
  controller.methods.handleProjectedPoint({ x: triangle[1].x + 5e-8, y: triangle[1].y });
  assert.equal(captures.length, 2);
  const nearby = { x: triangle[1].x + 0.001, y: triangle[1].y };
  assert.ok(0.001 < props.settings.drawing.vertexSnapToleranceMeters);
  controller.methods.handleProjectedPoint(nearby);
  assert.deepEqual(controller.getSnapshot().draftVertices, [...triangle.slice(0, 2), nearby]);
  assert.equal(captures.length, 3);
});

test("trailing explicit close after first-point closure cannot start a phantom draft", () => {
  const received: XY[][] = [];
  const controller = createMapInteractionController(makeProps({
    activeToolMode: "draw_boundary", onCommitBoundaryDraft: (vertices) => { received.push(vertices); },
  }), options);
  draw(controller);
  controller.methods.handleProjectedPoint(triangle[0], false);
  assert.deepEqual(received, [triangle]);
  const committedSnapshot = controller.getSnapshot();
  controller.methods.handleProjectedPoint(triangle[0], true);
  assert.equal(controller.getSnapshot(), committedSnapshot);
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  assert.equal(received.length, 1);
  controller.methods.handleProjectedPoint(triangle[1], false);
  assert.deepEqual(controller.getSnapshot().draftVertices, [triangle[1]]);
});

test("double-clicking the second vertex cannot commit a degenerate triangle", () => {
  let commits = 0;
  const controller = createMapInteractionController(makeProps({
    activeToolMode: "draw_boundary", onCommitBoundaryDraft: () => { commits += 1; },
  }), options);
  draw(controller, triangle.slice(0, 2));
  controller.methods.handleProjectedPoint(triangle[1], false);
  controller.methods.handleProjectedPoint(triangle[1], true);
  assert.equal(commits, 0);
  assert.deepEqual(controller.getSnapshot().draftVertices, triangle.slice(0, 2));
});

test("finite projected XY and optional WGS84 guard all click/edit paths", () => {
  let calls = 0;
  const props = makeProps({ activeToolMode: "draw_boundary", onPlacePivot: () => { calls += 1; }, onMoveBoundaryVertex: () => { calls += 1; } });
  const controller = createMapInteractionController(props, options);
  for (const point of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: -Infinity, y: 1 }]) {
    controller.methods.handleProjectedPoint(point);
    controller.methods.handleDraftVertexIntent(point, false);
  }
  controller.methods.handleLonLat({ longitude: NaN, latitude: 40 });
  controller.methods.handleProjectedPoint(triangle[0], false, { longitude: 1, latitude: Infinity });
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  controller.methods.setTool("place_pivot");
  controller.methods.handleProjectedPoint({ x: Infinity, y: 1 });
  controller.methods.selectFirstBoundaryVertex();
  controller.methods.moveSelectedVertexToPoint({ x: NaN, y: 0 });
  controller.methods.nudgeSelectedVertex({ x: Infinity, y: 0 });
  assert.equal(calls, 0);
});

test("longitude click intents use current state and ignore edit-mode background clicks", () => {
  let calls = 0;
  const props = makeProps({ activeToolMode: "draw_boundary", project: sampleProject, onMoveBoundaryVertex: () => { calls += 1; } });
  const controller = createMapInteractionController(props, options);
  const click = controller.methods.handleLonLat;
  const lonLat = projectXyToLonLat(sampleProject.pivotCenter, sampleProject.projectCrs);
  click(lonLat);
  assert.equal(controller.getSnapshot().draftVertices.length, 1);
  assert.ok(Math.abs(controller.getSnapshot().draftVertices[0].x - sampleProject.pivotCenter.x) < 0.01);
  controller.methods.selectFirstBoundaryVertex();
  click(lonLat);
  controller.methods.handleProjectedPoint(sampleProject.pivotCenter);
  assert.equal(calls, 0);
  controller.methods.moveSelectedVertexToPoint(sampleProject.pivotCenter);
  assert.equal(calls, 1);
});

test("manual boundary and all point roles stage without canonical callbacks", () => {
  const captures: Array<Parameters<NonNullable<MapSurfaceProps["onManualDesignCapture"]>>[0]> = [];
  let mutations = 0;
  let props = makeProps({
    activeToolMode: "draw_boundary", manualDesignCaptureRequest: { requestId: 1, role: "boundary" },
    onManualDesignCapture: (capture) => { captures.push(capture); },
    onCommitBoundaryDraft: () => { mutations += 1; }, onPlacePivot: () => { mutations += 1; },
  });
  const controller = createMapInteractionController(props, options);
  draw(controller);
  assert.deepEqual(captures.map((capture) => capture.vertices?.length), [1, 2, 3]);
  controller.methods.commitDraft();
  assert.deepEqual(captures[3], { requestId: 1, role: "boundary", vertices: triangle });
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  for (const [index, role] of (["pivot", "last_wheel", "machine_end"] as const).entries()) {
    props = { ...props, activeToolMode: "place_pivot", manualDesignCaptureRequest: { requestId: index + 2, role } };
    controller.updateInputs(props, options);
    assert.equal(controller.getSnapshot().draftVertices.length, 0);
    controller.methods.handleProjectedPoint(triangle[index]);
    assert.deepEqual(captures.at(-1), { requestId: index + 2, role, point: triangle[index], wgs84: undefined });
    assert.deepEqual(controller.getSnapshot().draftVertices, [triangle[index]]);
  }
  assert.equal(mutations, 0);
  const captureCount = captures.length;
  controller.updateInputs({ ...props, onManualDesignCapture: undefined }, options);
  controller.methods.handleProjectedPoint(triangle[0]);
  assert.equal(captures.length, captureCount);
  assert.equal(mutations, 0);
});

test("generic primitives honor geometry override and stage only with a callback", () => {
  for (const geometry of ["Point", "LineString", "Polygon", "Circle"] as const) {
    const drafts: Array<Parameters<NonNullable<MapSurfaceProps["onCreateMapFeatureDraft"]>>[0]> = [];
    let directSaves = 0;
    let props = makeProps({ activeToolMode: "measure", activeDraftGeometry: geometry, onAddMapFeature: () => { directSaves += 1; } });
    const controller = createMapInteractionController(props, options);
    const vertices = geometry === "Point" ? triangle.slice(0, 1) : geometry === "Polygon" ? triangle : triangle.slice(0, 2);
    draw(controller, vertices);
    controller.methods.saveMapFeatureFromDraft();
    assert.equal(directSaves, 0);
    assert.equal(controller.getSnapshot().canSaveFeature, false);
    if (geometry !== "Point") assert.deepEqual(controller.getSnapshot().draftVertices, vertices);
    props = { ...props, onCreateMapFeatureDraft: (draft) => { drafts.push(draft); } };
    controller.updateInputs(props, { imageryEnabled: true });
    if (geometry === "Point") controller.methods.handleProjectedPoint(vertices[0]);
    else {
      assert.equal(controller.getSnapshot().canSaveFeature, true);
      controller.methods.saveMapFeatureFromDraft();
    }
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].geometryType, geometry);
    assert.equal(drafts[0].sourceConfidence, "imagery_digitized");
    assert.deepEqual(drafts[0].vertices, vertices);
    assert.equal(controller.getSnapshot().draftVertices.length, 0);
    assert.equal(directSaves, 0);
  }
});

test("typed features save directly, with point close events suppressed", () => {
  const features: Array<Parameters<NonNullable<MapSurfaceProps["onAddMapFeature"]>>[0]> = [];
  let staged = 0;
  let props = makeProps({
    activeToolMode: "measure", activeMapFeatureKind: "pump_location",
    onAddMapFeature: (feature) => { features.push(feature); }, onCreateMapFeatureDraft: () => { staged += 1; },
  });
  const controller = createMapInteractionController(props, options);
  controller.methods.handleProjectedPoint(triangle[0]);
  controller.methods.handleProjectedPoint(triangle[0], true);
  assert.equal(features.length, 1);
  assert.equal(features[0].geometry.type, "Point");
  props = { ...props, activeMapFeatureKind: "end_gun_arc" };
  controller.updateInputs(props, options);
  draw(controller, triangle.slice(0, 2));
  controller.methods.saveMapFeatureFromDraft();
  assert.deepEqual(features[1].geometry, { type: "Circle", center: triangle[0], radiusMeters: 200 });
  assert.equal(staged, 0);
});

test("runtime false from typed feature save retains draft and status until successful retry", () => {
  let calls = 0;
  let props = makeProps({
    activeToolMode: "measure", activeMapFeatureKind: "underground_pipeline",
    onAddMapFeature: () => { calls += 1; return false; },
  });
  const controller = createMapInteractionController(props, options);
  draw(controller, triangle.slice(0, 2));
  const before = controller.getSnapshot();
  controller.methods.saveMapFeatureFromDraft();
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot(), before);
  props = { ...props, onAddMapFeature: () => { calls += 1; } };
  controller.updateInputs(props, options);
  controller.methods.saveMapFeatureFromDraft();
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  assert.match(controller.getSnapshot().status, /^Saved underground pipeline/);
});

test("runtime false from generic staging retains draft and status until successful retry", () => {
  let calls = 0;
  let props = makeProps({
    activeToolMode: "measure", activeDraftGeometry: "Polygon",
    onCreateMapFeatureDraft: () => { calls += 1; return false; },
  });
  const controller = createMapInteractionController(props, options);
  draw(controller);
  const before = controller.getSnapshot();
  controller.methods.saveMapFeatureFromDraft();
  assert.equal(calls, 1);
  assert.equal(controller.getSnapshot(), before);
  props = { ...props, onCreateMapFeatureDraft: () => { calls += 1; } };
  controller.updateInputs(props, options);
  controller.methods.saveMapFeatureFromDraft();
  assert.equal(calls, 2);
  assert.equal(controller.getSnapshot().draftVertices.length, 0);
  assert.match(controller.getSnapshot().status, /^Captured Polygon draft/);
});

test("structured mutation rejection retains typed and generic drafts until ok true", () => {
  for (const typed of [true, false]) {
    let calls = 0;
    let mutation: ProjectMutationResult = { ok: false, error: "Rejected geometry" };
    const callback = (): ProjectMutationResult => { calls += 1; return mutation; };
    const controller = createMapInteractionController(makeProps({
      activeToolMode: "measure", activeDraftGeometry: "Polygon",
      activeMapFeatureKind: typed ? "planning_boundary" : undefined,
      onAddMapFeature: callback, onCreateMapFeatureDraft: callback,
    }), options);
    draw(controller);
    const before = controller.getSnapshot();
    controller.methods.saveMapFeatureFromDraft();
    assert.equal(calls, 1);
    assert.equal(controller.getSnapshot(), before);
    mutation = { ok: true, revision: 1 };
    controller.methods.saveMapFeatureFromDraft();
    assert.equal(calls, 2);
    assert.equal(controller.getSnapshot().draftVertices.length, 0);
    assert.match(controller.getSnapshot().status, typed ? /^Saved planning boundary/ : /^Captured Polygon draft/);
  }
});

test("manual callbacks run once outside state updates and snapshots are stable", () => {
  let calls = 0;
  let notifications = 0;
  const props = makeProps({ activeToolMode: "draw_boundary", manualDesignCaptureRequest: { role: "boundary", requestId: 1 }, onManualDesignCapture: () => { calls += 1; } });
  const controller = createMapInteractionController(props, options);
  const unsubscribe = controller.subscribe(() => { notifications += 1; });
  controller.methods.handleProjectedPoint(triangle[0]);
  assert.equal(calls, 1);
  const snapshot = controller.getSnapshot();
  controller.getSnapshot();
  controller.getSnapshot();
  controller.updateInputs({ ...props }, options);
  assert.equal(controller.getSnapshot(), snapshot);
  assert.equal(calls, 1);
  assert.equal(notifications, 1);
  unsubscribe();
  controller.methods.clearDraft();
  assert.equal(notifications, 1);
});

test("selection validates indices and disappears when project entities disappear", () => {
  let moves = 0;
  const props = makeProps({ onMoveBoundaryVertex: () => { moves += 1; }, onInsertBoundaryVertex: () => undefined, onDeleteBoundaryVertex: () => undefined });
  const controller = createMapInteractionController(props, options);
  controller.methods.selectFirstBoundaryVertex();
  assert.equal(controller.getSnapshot().canEditSelectedVertex, true);
  assert.equal(controller.getSnapshot().canInsertSelectedVertex, true);
  assert.equal(controller.getSnapshot().canDeleteSelectedVertex, true);
  controller.methods.selectAdjacentVertex(-1);
  assert.equal(controller.getSnapshot().selectedVertex?.vertexIndex, 3);
  controller.methods.selectAdjacentVertex(1);
  assert.equal(controller.getSnapshot().selectedVertex?.vertexIndex, 0);
  controller.methods.selectVertex({ layer: "field_boundary", vertexIndex: 0.5 });
  assert.equal(controller.getSnapshot().selectedVertex, null);
  controller.methods.selectFirstBoundaryVertex();
  controller.updateInputs({ ...props, project: { ...props.project, fieldBoundary: [] } }, options);
  assert.equal(controller.getSnapshot().selectedVertex, null);
  assert.equal(controller.getSnapshot().canEditSelectedVertex, false);
  assert.equal(controller.getSnapshot().canInsertSelectedVertex, false);
  assert.equal(controller.getSnapshot().canDeleteSelectedVertex, false);
  controller.methods.nudgeSelectedVertex({ x: 10, y: 0 });
  assert.equal(moves, 0);
});

test("vertex commands route boundary, obstacle, feature and circle radius callbacks", () => {
  const events: Array<{ type: string; args: unknown[] }> = [];
  const record = (type: string) => (...args: unknown[]) => { events.push({ type, args }); };
  const props = makeProps({
    project: {
      ...sampleProject, fieldBoundary: square,
      obstacles: [{ id: "obstacle", name: "Road", kind: "road", polygon: square, bufferMeters: 0, hardConflict: true, noSpray: true, confidence: "user_estimated" }],
      mapFeatures: [
        { id: "line", name: "Line", kind: "measurement_line", confidence: "user_estimated", geometry: { type: "LineString", vertices: triangle } },
        { id: "circle", name: "Circle", kind: "end_gun_arc", confidence: "user_estimated", geometry: { type: "Circle", center: triangle[0], radiusMeters: 20 } },
      ],
    },
    selectedMapFeatureId: "circle",
    onMoveBoundaryVertex: record("boundary-move"), onInsertBoundaryVertex: record("boundary-insert"), onDeleteBoundaryVertex: record("boundary-delete"),
    onMoveObstacleVertex: record("obstacle-move"), onInsertObstacleVertex: record("obstacle-insert"), onDeleteObstacleVertex: record("obstacle-delete"),
    onMoveMapFeatureVertex: record("feature-move"), onInsertMapFeatureVertex: record("feature-insert"), onDeleteMapFeatureVertex: record("feature-delete"),
    onMoveMapFeatureCircleRadiusHandle: record("radius-move"),
  });
  const controller = createMapInteractionController(props, options);
  controller.methods.selectFirstBoundaryVertex();
  controller.methods.nudgeSelectedVertex({ x: 2, y: 3 });
  assert.deepEqual(events.at(-1), { type: "boundary-move", args: [0, { x: 102, y: 103 }] });
  assert.equal(controller.getSnapshot().status, "Moved boundary vertex 1 of 4 in projected XY. Save Local to persist.");
  controller.methods.insertAfterSelectedVertex();
  assert.deepEqual(events.at(-1), { type: "boundary-insert", args: [0, { x: 200, y: 100 }] });
  controller.methods.deleteSelectedVertex();
  assert.equal(events.at(-1)?.type, "boundary-delete");
  controller.methods.selectFirstObstacleVertex();
  controller.methods.moveSelectedVertexToPoint(triangle[1]);
  controller.methods.insertAfterSelectedVertex();
  controller.methods.deleteSelectedVertex();
  assert.deepEqual(events.slice(-3).map((event) => event.type), ["obstacle-move", "obstacle-insert", "obstacle-delete"]);
  controller.methods.selectVertex({ layer: "map_feature", featureId: "line", vertexIndex: 0 });
  controller.methods.moveSelectedVertexToPoint(triangle[1]);
  assert.equal(controller.getSnapshot().status, "Moved Line vertex 1 of 3 in projected XY. Save Local to persist.");
  controller.methods.insertAfterSelectedVertex();
  controller.methods.deleteSelectedVertex();
  assert.deepEqual(events.slice(-3).map((event) => event.type), ["feature-move", "feature-insert", "feature-delete"]);
  controller.methods.selectFirstMapFeatureVertex();
  assert.equal(controller.getSnapshot().selectedVertex?.layer, "map_feature");
  controller.methods.selectAdjacentVertex(1);
  assert.equal(controller.getSnapshot().canInsertSelectedVertex, false);
  assert.equal(controller.getSnapshot().canDeleteSelectedVertex, false);
  controller.methods.nudgeSelectedVertex({ x: 1, y: 0 });
  assert.deepEqual(events.at(-1), { type: "radius-move", args: ["circle", { x: 121, y: 100 }] });
  assert.equal(controller.getSnapshot().status, "Moved Circle radius handle 2 of 2 in projected XY. Save Local to persist.");
});

test("missing edit callbacks disable commands and preserve selection", () => {
  const controller = createMapInteractionController(makeProps(), options);
  controller.methods.selectFirstBoundaryVertex();
  const selected = controller.getSnapshot().selectedVertex;
  assert.equal(controller.getSnapshot().canEditSelectedVertex, false);
  assert.equal(controller.getSnapshot().canInsertSelectedVertex, false);
  assert.equal(controller.getSnapshot().canDeleteSelectedVertex, false);
  controller.methods.moveSelectedVertexToPoint(triangle[2]);
  controller.methods.insertAfterSelectedVertex();
  controller.methods.deleteSelectedVertex();
  assert.equal(controller.getSnapshot().selectedVertex, selected);
});

test("obstacle commits, infrastructure and survey preserve routing and provenance", () => {
  const events: unknown[][] = [];
  const props = makeProps({
    onCommitObstacleDraft: (...args) => { events.push(args); },
    onMoveInfrastructurePoint: (...args) => { events.push(args); },
    onAddSurveyPoint: (...args) => { events.push(args); },
  });
  const controller = createMapInteractionController(props, { imageryEnabled: true });
  controller.methods.setTool("mark_obstacle", "road");
  draw(controller);
  controller.methods.commitDraft();
  assert.deepEqual(events[0], [triangle, "road", "imagery_digitized"]);
  const wgs84 = { longitude: -101, latitude: 40 };
  controller.methods.setTool("place_pivot", "water_source");
  controller.methods.handleProjectedPoint(triangle[0], false, wgs84);
  assert.deepEqual(events[1], ["water_source", triangle[0], wgs84]);
  controller.methods.setTool("capture_point", "note_point");
  controller.methods.handleProjectedPoint(triangle[1], false, wgs84);
  assert.deepEqual(events[2], [{
    label: "note point", role: "note", projected: triangle[1], wgs84, source: "manual", confidence: "imagery_digitized", notes: "Captured from imagery; verify with field survey.",
  }]);
});
