import assert from "node:assert/strict";
import test from "node:test";
import {
  createDesignDraftEditorState, defaultProjectSettings, reduceDesignDraftEditorState, sampleProject,
  type DesignDraft,
} from "@cplayout/core";
import { evaluateLayout, panViewportByScreenDelta, screenPointToWorld, zoomViewport } from "@cplayout/geometry";
import {
  DESIGN_DRAFT_PURPOSES, buildDraftCaptureAction, designDraftBounds, draftCaptureError,
  draftContainsCapture, draftDrawingAllowed, draftPointFromInverseCtm,
} from "./designDraftMap";
import { fitProjectedBounds, viewportForScreen } from "./mapFit";

function blank(projectCrs: string | null = "LOCAL:field"): DesignDraft {
  const settings = defaultProjectSettings();
  return { id: "draft", name: "Draft", projectCrs, unitSystem: settings.unitSystem, settings,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null,
    machine: {}, obstacles: [], surveyPoints: [] };
}
const ring = [{ x: 600000, y: 4400000 }, { x: 600100, y: 4400000 }, { x: 600100, y: 4400100 }, { x: 600000, y: 4400100 }];

test("drawing requires an explicit supported projected or local XY frame", () => {
  for (const crs of [null, "", " ", "EPSG:4326", "EPSG:3857", "EPSG:26741", "unknown", "EPSG:99999"]) {
    assert.equal(draftDrawingAllowed(crs), false, String(crs));
    assert.throws(() => buildDraftCaptureAction(crs, "pivot", [ring[0]], "point"), /coordinate system/);
  }
  for (const crs of ["LOCAL:field", "LOCAL", "EPSG:32613", "EPSG:26913"]) assert.equal(draftDrawingAllowed(crs), true, crs);
});

test("empty and one/two vertex bounds use only supplied geometry", () => {
  const draft = blank();
  assert.equal(designDraftBounds(draft), null);
  for (let length = 1; length <= 2; length += 1) {
    const vertices = ring.slice(0, length);
    const action = buildDraftCaptureAction(draft.projectCrs, "boundary", vertices, "boundary");
    const next = reduceDesignDraftEditorState(createDesignDraftEditorState(draft), action);
    assert.equal(next.lastError, null);
    assert.deepEqual(next.draft.fieldBoundary, vertices);
    assert.deepEqual(next.draft.machine, {});
    assert.equal(next.draft.pivotCenter, null);
    assert.equal(next.draft.waterSource, null);
    assert.equal(next.draft.powerSource, null);
    assert.deepEqual(designDraftBounds(next.draft), {
      minX: 600000, maxX: length === 1 ? 600000 : 600100, minY: 4400000, maxY: 4400000,
    });
  }
});

test("all purposes produce reducer-admitted manual actions without capture evidence", () => {
  for (const option of DESIGN_DRAFT_PURPOSES) {
    const draft = blank();
    const vertices = option.geometry === "Point" ? ring.slice(0, 1) : option.geometry === "LineString" ? ring.slice(0, 2) : ring;
    const original = JSON.stringify({ draft, vertices });
    const action = buildDraftCaptureAction(draft.projectCrs, option.id, vertices, option.id);
    assert.equal(draftContainsCapture(draft, action), false);
    const next = reduceDesignDraftEditorState(createDesignDraftEditorState(draft), action);
    assert.equal(next.lastError, null, option.id);
    assert.equal(draftContainsCapture(next.draft, action), true);
    assert.equal(JSON.stringify({ draft, vertices }), original);
    assert.deepEqual(next.draft.machine, {});
    assert.deepEqual(next.draft.surveyPoints, []);
    for (const entity of [...next.draft.obstacles, ...(next.draft.mapFeatures ?? [])]) {
      assert.equal(entity.confidence, "user_estimated");
      assert.equal(entity.vertexCaptureEvidence, undefined);
    }
    if (option.id === "area") assert.equal(next.draft.mapFeatures?.[0].kind, "measurement_area");
    if (option.id === "path") assert.equal(next.draft.mapFeatures?.[0].kind, "access_lane");
    if (option.id === "marker") {
      assert.equal(option.label, "End gun mark");
      assert.equal(next.draft.mapFeatures?.[0].name, "End gun mark");
      assert.equal(next.draft.mapFeatures?.[0].kind, "end_gun_mark");
    }
    if (option.id === "keep_out") assert.deepEqual(next.draft.obstacles.map(({ kind, hardConflict, noSpray }) => ({ kind, hardConflict, noSpray })),
      [{ kind: "exclusion", hardConflict: true, noSpray: true }]);
  }
});

test("a far outside measurement area leaves every sample layout metric unchanged", () => {
  const before = JSON.stringify(sampleProject);
  const farOutside = sampleProject.fieldBoundary.map(({ x, y }) => ({ x: x + 100000, y: y + 100000 }));
  const action = buildDraftCaptureAction(sampleProject.projectCrs, "area", farOutside, "outside-measurement");
  assert.equal(action.type, "add_manual_feature");
  if (action.type !== "add_manual_feature") throw new Error("Expected measurement-area feature action.");
  const feature = { ...action.feature, confidence: "user_estimated" as const };
  const baseline = evaluateLayout(sampleProject).metrics;
  const measured = evaluateLayout({ ...sampleProject, mapFeatures: [...(sampleProject.mapFeatures ?? []), feature] });
  assert.deepEqual(measured.metrics, baseline);
  assert.equal(JSON.stringify(sampleProject), before);
});

test("capture validation rejects invalid complete polygons but permits incomplete boundaries", () => {
  for (const purpose of ["boundary", "keep_out", "area"] as const) {
    for (const vertices of [[], [ring[0], ring[2], ring[1], ring[3]], [ring[0], ring[1], ring[0]],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]]) {
      assert.ok(draftCaptureError(purpose, vertices));
      assert.throws(() => buildDraftCaptureAction("LOCAL:field", purpose, vertices, purpose));
    }
  }
  assert.equal(draftCaptureError("boundary", [ring[0]]), null);
  assert.equal(draftCaptureError("boundary", ring.slice(0, 2)), null);
  assert.ok(draftCaptureError("keep_out", ring.slice(0, 2)));
  assert.ok(draftCaptureError("measurement", [ring[0]]));
  assert.ok(draftCaptureError("path", [ring[0], ring[0]]));
  assert.ok(draftCaptureError("marker", ring.slice(0, 2)));
  for (const x of [NaN, Infinity, Number.MAX_VALUE]) assert.ok(draftCaptureError("pivot", [{ x, y: 0 }]));
});

test("capture action owns its coordinates and rejected edits do not count as acceptance", () => {
  const points = ring.map((point) => ({ ...point }));
  const action = buildDraftCaptureAction("LOCAL:field", "boundary", points, "boundary");
  points[0].x = -1;
  assert.equal(action.type === "replace_boundary" && action.vertices[0].x, ring[0].x);
  const state = createDesignDraftEditorState(blank(null));
  const rejected = reduceDesignDraftEditorState(state, action);
  assert.ok(rejected.lastError);
  assert.equal(draftContainsCapture(rejected.draft, action), false);
});

test("camera includes supplied infrastructure, obstacles and circle extents without touching a draft", () => {
  const draft: DesignDraft = { ...blank(), pivotCenter: { x: 20, y: 30 },
    mapFeatures: [{ id: "circle", name: "Supplied area", kind: "machine_zone", confidence: "imported_cad",
      geometry: { type: "Circle", center: { x: 50, y: 60 }, radiusMeters: 100 } }],
    obstacles: [{ id: "obstacle", name: "Supplied exclusion", kind: "exclusion", confidence: "user_estimated",
      polygon: [{ x: -200, y: 0 }, { x: -190, y: 0 }, { x: -200, y: 10 }], bufferMeters: 0, hardConflict: true, noSpray: true }] };
  const original = JSON.stringify(draft);
  const bounds = designDraftBounds(draft)!;
  assert.deepEqual(bounds, { minX: -200, maxX: 150, minY: -40, maxY: 160 });
  const screen = { width: 320, height: 600 };
  const viewport = fitProjectedBounds(bounds, screen, { top: 60, right: 50, bottom: 80, left: 10 })!;
  assert.ok(viewport);
  panViewportByScreenDelta(zoomViewport(viewport, 2), 20, -30, screen.width, screen.height);
  assert.equal(JSON.stringify(draft), original);
});

test("web CTM and native screen projection agree after non-square resize, zoom and pan", () => {
  for (const screen of [{ width: 320, height: 620 }, { width: 1400, height: 500 }]) {
    const initial = fitProjectedBounds({ minX: 600000, maxX: 601000, minY: 4400000, maxY: 4401000 },
      screen, { top: 0, right: 0, bottom: 0, left: 0 })!;
    const viewport = viewportForScreen(panViewportByScreenDelta(zoomViewport(initial, 3), 35, -70, screen.width, screen.height), screen)!;
    const units = viewport.baseWidthMeters / viewport.zoomLevel / screen.width;
    const left = viewport.center.x - viewport.baseWidthMeters / viewport.zoomLevel / 2;
    const top = -viewport.center.y - viewport.baseHeightMeters / viewport.zoomLevel / 2;
    const offset = { x: 127, y: 93 };
    const inverse = { a: units, b: 0, c: 0, d: units, e: left - offset.x * units, f: top - offset.y * units };
    for (const point of [{ xPixels: 0, yPixels: 0 }, { xPixels: 213, yPixels: 361 }]) {
      const native = screenPointToWorld(viewport, point, { widthPixels: screen.width, heightPixels: screen.height });
      const web = draftPointFromInverseCtm(point.xPixels + offset.x, point.yPixels + offset.y, inverse)!;
      assert.ok(Math.abs(web.x - native.x) < 1e-8);
      assert.ok(Math.abs(web.y - native.y) < 1e-8);
    }
  }
  assert.deepEqual(draftPointFromInverseCtm(10, 20, { a: 2, b: 3, c: 4, d: 5, e: 6, f: 7 }), { x: 106, y: -137 });
  assert.equal(draftPointFromInverseCtm(NaN, 20, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), null);
});
