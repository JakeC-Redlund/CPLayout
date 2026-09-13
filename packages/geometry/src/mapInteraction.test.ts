import assert from "node:assert/strict";

import {
  createDrawingMapState,
  createInitialViewport,
  reduceDrawingMapState,
  resolveDraftVertexIntent,
  screenPointToWorld,
  snapPointToGeometry,
  viewportToSvgViewBox,
  visibleWidthMeters,
} from "./mapInteraction";
import { planOnlineImageryTiles, supportsSvgOnlineImageryOverlay } from "./onlineImagery";

const viewport = createInitialViewport({ minX: 0, minY: 0, maxX: 1000, maxY: 800 }, 1);
const state = createDrawingMapState(viewport);

const withVertex = reduceDrawingMapState(state, { type: "add_draft_vertex", vertex: { x: 10, y: 20 } });
assert.equal(withVertex.draftVertices.length, 1);
assert.equal(withVertex.geometryRevision, 1);

const panned = reduceDrawingMapState(withVertex, { type: "pan", delta: { x: 100, y: -50 } });
assert.deepEqual(panned.draftVertices, withVertex.draftVertices);
assert.equal(panned.geometryRevision, withVertex.geometryRevision);
assert.equal(panned.viewport.center.x, withVertex.viewport.center.x + 100);

const clearedDraft = reduceDrawingMapState(panned, { type: "clear_draft" });
assert.equal(clearedDraft.draftVertices.length, 0);
assert.equal(clearedDraft.geometryRevision, panned.geometryRevision + 1);
assert.deepEqual(clearedDraft.viewport, panned.viewport);
assert.deepEqual(withVertex.draftVertices, [{ x: 10, y: 20 }]);

const zoomed = reduceDrawingMapState(panned, { type: "zoom", factor: 2 });
assert.deepEqual(zoomed.draftVertices, withVertex.draftVertices);
assert.equal(visibleWidthMeters(zoomed.viewport), 500);
assert.match(viewportToSvgViewBox(zoomed.viewport), /^350 -550 500 400$/);

const dragged = reduceDrawingMapState(zoomed, {
  type: "pan_screen",
  dxPixels: 100,
  dyPixels: -50,
  screenWidthPixels: 500,
  screenHeightPixels: 800,
});
assert.equal(dragged.viewport.center.x, zoomed.viewport.center.x - 100);
assert.equal(dragged.viewport.center.y, zoomed.viewport.center.y - 25);
assert.deepEqual(dragged.draftVertices, withVertex.draftVertices);

const centerWorld = screenPointToWorld(viewport, { xPixels: 500, yPixels: 400 }, { widthPixels: 1000, heightPixels: 800 });
assert.deepEqual(centerWorld, viewport.center);

const topLeftWorld = screenPointToWorld(viewport, { xPixels: 0, yPixels: 0 }, { widthPixels: 1000, heightPixels: 800 });
assert.deepEqual(topLeftWorld, { x: 0, y: 800 });

const editMode = reduceDrawingMapState(dragged, { type: "set_mode", mode: "edit_vertices" });
assert.equal(editMode.mode, "edit_vertices");
assert.equal(editMode.geometryRevision, dragged.geometryRevision);

const measureMode = reduceDrawingMapState(dragged, { type: "set_mode", mode: "measure" });
assert.equal(measureMode.mode, "measure");
assert.equal(measureMode.geometryRevision, dragged.geometryRevision);

const imageryPlan = planOnlineImageryTiles({
  viewport,
  projectCrs: "EPSG:32613",
  providerId: "usgs_imagery_only",
  maxTiles: 8,
});
assert.match(imageryPlan.error ?? "", /local reprojection adapter/);
assert.equal(imageryPlan.tiles.length, 0);

const webMercatorImageryPlan = planOnlineImageryTiles({
  viewport,
  projectCrs: "EPSG:3857",
  providerId: "usgs_imagery_only",
  maxTiles: 8,
});
assert.equal(webMercatorImageryPlan.error, null);
assert.ok(webMercatorImageryPlan.tiles.length > 0);
assert.ok(webMercatorImageryPlan.tiles.length <= 8);
assert.match(webMercatorImageryPlan.tiles[0].href, /USGSImageryOnly\/MapServer\/tile\/\d+\/\d+\/\d+/);
assert.ok(Number.isFinite(webMercatorImageryPlan.tiles[0].projectedBounds.minX));
assert.ok(webMercatorImageryPlan.tiles.every((tile) => tile.z <= webMercatorImageryPlan.provider.maxZoom));
assert.equal(supportsSvgOnlineImageryOverlay("EPSG:3857"), true);
assert.equal(supportsSvgOnlineImageryOverlay("EPSG:32613"), false);

const customImageryPlan = planOnlineImageryTiles({
  viewport,
  projectCrs: "EPSG:3857",
  providerId: "custom_open_xyz",
  customSource: {
    name: "Example open WMTS",
    tileUrlTemplate: "https://tiles.example.org/open/{TileMatrix}/{TileRow}/{TileCol}.png",
    minZoom: 0,
    maxZoom: 12,
    tileScheme: "xyz",
    tileSize: 256,
    projection: "EPSG:3857",
    coverageLabel: "Example open imagery coverage",
    termsUrl: "https://tiles.example.org/terms",
    sourceUrl: "https://tiles.example.org",
    cachePolicy: "interactive_only",
    attribution: "Example Open Imagery",
    licenseText: "CC-BY 4.0 compatible example imagery.",
  },
  maxTiles: 4,
});
assert.equal(customImageryPlan.error, null);
assert.equal(customImageryPlan.provider.name, "Example open WMTS");
assert.ok(customImageryPlan.tiles.length > 0);
assert.match(customImageryPlan.tiles[0].href, /tiles\.example\.org\/open\/\d+\/\d+\/\d+\.png/);
assert.deepEqual(withVertex.draftVertices, [{ x: 10, y: 20 }]);

const snappedVertex = snapPointToGeometry(
  { x: 10.5, y: 19.8 },
  { vertices: [{ x: 10, y: 20 }], rings: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]] },
  { vertexSnapToleranceMeters: 1, featureSnapToleranceMeters: 3 },
);
assert.equal(snappedVertex?.kind, "vertex");
assert.deepEqual(snappedVertex?.point, { x: 10, y: 20 });

const snappedFeature = snapPointToGeometry(
  { x: 50, y: 2 },
  { rings: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]] },
  { vertexSnapToleranceMeters: 1, featureSnapToleranceMeters: 3 },
);
assert.equal(snappedFeature?.kind, "feature");
assert.deepEqual(snappedFeature?.point, { x: 50, y: 0 });

const unsnapped = snapPointToGeometry(
  { x: 50, y: 10 },
  { rings: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]] },
  { vertexSnapToleranceMeters: 1, featureSnapToleranceMeters: 3 },
);
assert.equal(unsnapped, null);

const draftTriangle = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];
const snapTolerances = { vertexSnapToleranceMeters: 1, featureSnapToleranceMeters: 3 };
const phantomClosingEdgePoint = { x: 50, y: 50 };
assert.equal(
  snapPointToGeometry(phantomClosingEdgePoint, { lines: [draftTriangle] }, snapTolerances),
  null,
  "An open line must not snap to its last-to-first phantom segment.",
);
assert.deepEqual(
  snapPointToGeometry({ x: 50, y: 2 }, { lines: [draftTriangle] }, snapTolerances),
  { kind: "feature", point: { x: 50, y: 0 }, distanceMeters: 2 },
);
assert.deepEqual(
  snapPointToGeometry({ x: 98, y: 50 }, { lines: [draftTriangle] }, snapTolerances),
  { kind: "feature", point: { x: 100, y: 50 }, distanceMeters: 2 },
);
assert.deepEqual(
  snapPointToGeometry({ x: 100.5, y: 100 }, { lines: [draftTriangle] }, snapTolerances),
  { kind: "vertex", point: draftTriangle[2], distanceMeters: 0.5 },
);
assert.deepEqual(
  snapPointToGeometry(phantomClosingEdgePoint, { rings: [draftTriangle] }, snapTolerances),
  { kind: "feature", point: phantomClosingEdgePoint, distanceMeters: 0 },
  "A closed polygon must retain its last-to-first edge.",
);

let unfinishedDraft = reduceDrawingMapState(state, { type: "set_mode", mode: "draw_boundary" });
for (const vertex of draftTriangle) {
  unfinishedDraft = reduceDrawingMapState(unfinishedDraft, { type: "add_draft_vertex", vertex });
}
assert.equal(
  snapPointToGeometry(phantomClosingEdgePoint, { lines: [unfinishedDraft.draftVertices] }, snapTolerances),
  null,
  "Three draft vertices do not implicitly close a boundary under capture.",
);
assert.deepEqual(
  snapPointToGeometry(
    { x: 50, y: 2 },
    { rings: [[{ x: 0, y: 4 }, { x: 100, y: 4 }, { x: 100, y: 100 }]], lines: [[{ x: 0, y: 1 }, { x: 100, y: 1 }]] },
    snapTolerances,
  ),
  { kind: "feature", point: { x: 50, y: 1 }, distanceMeters: 1 },
  "Open segments compete with closed edges for the nearest feature snap.",
);
assert.equal(
  snapPointToGeometry({ x: 2, y: 0 }, { lines: [[], [{ x: 0, y: 0 }]] }, snapTolerances),
  null,
  "Empty and single-vertex drafts have no feature segments.",
);
assert.deepEqual(
  snapPointToGeometry({ x: 0.5, y: 0 }, { lines: [[{ x: 0, y: 0 }]] }, snapTolerances),
  { kind: "vertex", point: { x: 0, y: 0 }, distanceMeters: 0.5 },
);
const closeByFirstPointSnap = resolveDraftVertexIntent({
  currentVertices: draftTriangle,
  mode: "draw_boundary",
  vertex: { x: 0.25, y: -0.1 },
  vertexSnapToleranceMeters: 1,
});
assert.deepEqual(closeByFirstPointSnap, {
  type: "commit",
  vertices: draftTriangle,
  reason: "first_point_snap",
});

const closeByDoubleClick = resolveDraftVertexIntent({
  closeRequested: true,
  currentVertices: draftTriangle.slice(0, 2),
  mode: "mark_obstacle",
  vertex: draftTriangle[2],
  vertexSnapToleranceMeters: 1,
});
assert.deepEqual(closeByDoubleClick, {
  type: "commit",
  vertices: draftTriangle,
  reason: "double_click",
});

const measureAppend = resolveDraftVertexIntent({
  closeRequested: true,
  currentVertices: draftTriangle,
  mode: "measure",
  vertex: { x: 0, y: 0 },
  vertexSnapToleranceMeters: 1,
});
assert.deepEqual(measureAppend, {
  type: "append",
  vertex: { x: 0, y: 0 },
});

console.log("map interaction tests passed");
