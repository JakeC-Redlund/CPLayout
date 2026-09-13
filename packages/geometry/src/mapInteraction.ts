import type { XY } from "@cplayout/core";

export const DRAWING_MODES = [
  "pan",
  "capture_point",
  "draw_boundary",
  "edit_vertices",
  "mark_obstacle",
  "measure",
  "place_pivot",
] as const;

export type DrawingMode = typeof DRAWING_MODES[number];

export const DRAWING_LAYER_TYPES = [
  "field_boundary",
  "obstacle",
  "road",
  "ditch",
  "fence",
  "tree",
  "canal",
  "building",
  "exclusion",
  "pivot_center",
  "water_source",
  "power_source",
  "control_point",
  "note_point",
] as const;

export type DrawingLayerType = typeof DRAWING_LAYER_TYPES[number];

export interface MapViewport {
  center: XY;
  baseWidthMeters: number;
  baseHeightMeters: number;
  zoomLevel: number;
}

export interface DrawingMapState {
  viewport: MapViewport;
  mode: DrawingMode;
  activeLayer: DrawingLayerType;
  draftVertices: XY[];
  selectedFeatureId: string | null;
  geometryRevision: number;
}

export interface SnapCandidate {
  point: XY;
  kind: "vertex" | "feature";
  distanceMeters: number;
}

export interface SnapGeometry {
  vertices?: XY[];
  rings?: XY[][];
  lines?: XY[][];
}

export type DraftCloseReason = "first_point_snap" | "double_click";

export type DraftVertexIntent =
  | { type: "append"; vertex: XY }
  | { type: "commit"; vertices: XY[]; reason: DraftCloseReason };

export interface DraftVertexIntentParams {
  closeRequested?: boolean;
  currentVertices: XY[];
  mode: DrawingMode;
  vertex: XY;
  vertexSnapToleranceMeters: number;
}

export type DrawingMapAction =
  | { type: "pan"; delta: XY }
  | { type: "pan_screen"; dxPixels: number; dyPixels: number; screenWidthPixels: number; screenHeightPixels: number }
  | { type: "zoom"; factor: number }
  | { type: "set_mode"; mode: DrawingMode }
  | { type: "set_active_layer"; activeLayer: DrawingLayerType }
  | { type: "add_draft_vertex"; vertex: XY }
  | { type: "clear_draft" }
  | { type: "select_feature"; featureId: string | null };

export function createInitialViewport(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  zoomLevel: number,
): MapViewport {
  const width = finitePositive(bounds.maxX - bounds.minX, 1000);
  const height = finitePositive(bounds.maxY - bounds.minY, 1000);
  return {
    center: {
      x: Number.isFinite(bounds.minX + width / 2) ? bounds.minX + width / 2 : 0,
      y: Number.isFinite(bounds.minY + height / 2) ? bounds.minY + height / 2 : 0,
    },
    baseWidthMeters: Math.max(width, 100),
    baseHeightMeters: Math.max(height, 100),
    zoomLevel: clampZoom(zoomLevel),
  };
}

export function reduceDrawingMapState(state: DrawingMapState, action: DrawingMapAction): DrawingMapState {
  switch (action.type) {
    case "pan":
      return { ...state, viewport: panViewport(state.viewport, action.delta) };
    case "pan_screen":
      return {
        ...state,
        viewport: panViewportByScreenDelta(
          state.viewport,
          action.dxPixels,
          action.dyPixels,
          action.screenWidthPixels,
          action.screenHeightPixels,
        ),
      };
    case "zoom":
      return { ...state, viewport: zoomViewport(state.viewport, action.factor) };
    case "set_mode":
      return { ...state, mode: action.mode, selectedFeatureId: action.mode === "pan" ? null : state.selectedFeatureId };
    case "set_active_layer":
      return { ...state, activeLayer: action.activeLayer };
    case "add_draft_vertex":
      return {
        ...state,
        draftVertices: [...state.draftVertices, action.vertex],
        geometryRevision: state.geometryRevision + 1,
      };
    case "clear_draft":
      return { ...state, draftVertices: [], geometryRevision: state.geometryRevision + 1 };
    case "select_feature":
      return { ...state, selectedFeatureId: action.featureId };
  }
}

export function panViewport(viewport: MapViewport, delta: XY): MapViewport {
  return {
    ...viewport,
    center: {
      x: viewport.center.x + delta.x,
      y: viewport.center.y + delta.y,
    },
  };
}

export function panViewportByScreenDelta(
  viewport: MapViewport,
  dxPixels: number,
  dyPixels: number,
  screenWidthPixels: number,
  screenHeightPixels: number,
): MapViewport {
  const xMetersPerPixel = visibleWidthMeters(viewport) / Math.max(1, screenWidthPixels);
  const yMetersPerPixel = visibleHeightMeters(viewport) / Math.max(1, screenHeightPixels);
  return panViewport(viewport, {
    x: -dxPixels * xMetersPerPixel,
    y: dyPixels * yMetersPerPixel,
  });
}

export function screenPointToWorld(
  viewport: MapViewport,
  point: { xPixels: number; yPixels: number },
  screen: { widthPixels: number; heightPixels: number },
): XY {
  const widthMeters = visibleWidthMeters(viewport);
  const heightMeters = visibleHeightMeters(viewport);
  const minX = viewport.center.x - widthMeters / 2;
  const minSvgY = -viewport.center.y - heightMeters / 2;
  const xRatio = point.xPixels / Math.max(1, screen.widthPixels);
  const yRatio = point.yPixels / Math.max(1, screen.heightPixels);
  return {
    x: minX + xRatio * widthMeters,
    y: -(minSvgY + yRatio * heightMeters),
  };
}

export function zoomViewport(viewport: MapViewport, factor: number): MapViewport {
  return {
    ...viewport,
    zoomLevel: clampZoom(viewport.zoomLevel * factor),
  };
}

export function visibleWidthMeters(viewport: MapViewport): number {
  return viewport.baseWidthMeters / viewport.zoomLevel;
}

export function visibleHeightMeters(viewport: MapViewport): number {
  return viewport.baseHeightMeters / viewport.zoomLevel;
}

export function viewportToSvgViewBox(viewport: MapViewport): string {
  const width = visibleWidthMeters(viewport);
  const height = visibleHeightMeters(viewport);
  const minX = viewport.center.x - width / 2;
  const minY = -viewport.center.y - height / 2;
  return `${minX} ${minY} ${width} ${height}`;
}

export function createDrawingMapState(viewport: MapViewport): DrawingMapState {
  return {
    viewport,
    mode: "pan",
    activeLayer: "field_boundary",
    draftVertices: [],
    selectedFeatureId: null,
    geometryRevision: 0,
  };
}

export function snapPointToGeometry(
  point: XY,
  geometry: SnapGeometry,
  tolerances: { vertexSnapToleranceMeters: number; featureSnapToleranceMeters: number },
): SnapCandidate | null {
  const vertices = geometry.vertices ?? [];
  const rings = geometry.rings ?? [];
  const lines = geometry.lines ?? [];
  const ringVertices = rings.flat();
  const vertexCandidate = nearestPoint(point, [...vertices, ...ringVertices, ...lines.flat()]);
  if (vertexCandidate && vertexCandidate.distanceMeters <= tolerances.vertexSnapToleranceMeters) {
    return { ...vertexCandidate, kind: "vertex" };
  }

  let nearestFeature: { point: XY; distanceMeters: number } | null = null;
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index];
      const end = ring[(index + 1) % ring.length];
      const candidate = nearestPointOnSegment(point, start, end);
      if (!nearestFeature || candidate.distanceMeters < nearestFeature.distanceMeters) nearestFeature = candidate;
    }
  }
  for (const line of lines) {
    for (let index = 1; index < line.length; index += 1) {
      const candidate = nearestPointOnSegment(point, line[index - 1], line[index]);
      if (!nearestFeature || candidate.distanceMeters < nearestFeature.distanceMeters) nearestFeature = candidate;
    }
  }
  if (nearestFeature && nearestFeature.distanceMeters <= tolerances.featureSnapToleranceMeters) {
    return { ...nearestFeature, kind: "feature" };
  }
  return null;
}

export function resolveDraftVertexIntent({
  closeRequested = false,
  currentVertices,
  mode,
  vertex,
  vertexSnapToleranceMeters,
}: DraftVertexIntentParams): DraftVertexIntent {
  if (!canDraftPolygonClose(mode)) return { type: "append", vertex };
  if (currentVertices.length < 2) return { type: "append", vertex };

  if (closeRequested) {
    const vertices = currentVertices.length >= 3 ? currentVertices : [...currentVertices, vertex];
    return vertices.length >= 3
      ? { type: "commit", vertices, reason: "double_click" }
      : { type: "append", vertex };
  }

  const first = currentVertices[0];
  const snapTolerance = Math.max(0, vertexSnapToleranceMeters);
  if (currentVertices.length >= 3 && distance(first, vertex) <= snapTolerance) {
    return { type: "commit", vertices: currentVertices, reason: "first_point_snap" };
  }

  return { type: "append", vertex };
}

function canDraftPolygonClose(mode: DrawingMode): boolean {
  return mode === "draw_boundary" || mode === "mark_obstacle";
}

function nearestPoint(point: XY, candidates: XY[]): { point: XY; distanceMeters: number } | null {
  let nearest: { point: XY; distanceMeters: number } | null = null;
  for (const candidate of candidates) {
    const distanceMeters = distance(point, candidate);
    if (!nearest || distanceMeters < nearest.distanceMeters) nearest = { point: candidate, distanceMeters };
  }
  return nearest;
}

function nearestPointOnSegment(point: XY, start: XY, end: XY): { point: XY; distanceMeters: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { point: start, distanceMeters: distance(point, start) };
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const snapped = { x: start.x + t * dx, y: start.y + t * dy };
  return { point: snapped, distanceMeters: distance(point, snapped) };
}

function distance(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampZoom(zoomLevel: number): number {
  if (!Number.isFinite(zoomLevel)) return 1;
  return Math.min(12, Math.max(0.25, zoomLevel));
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
