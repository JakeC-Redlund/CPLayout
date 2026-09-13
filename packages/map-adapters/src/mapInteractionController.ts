import type { InfrastructurePoint, LonLat, ObstacleZone, ProjectMapFeatureKind, SurveyPoint, XY } from "@cplayout/core";
import { resolveDraftVertexIntent, type DrawingLayerType, type DrawingMode } from "@cplayout/geometry";

import { confidenceForImagery, mapClickToProjectedIntent, type MapClickIntent } from "./mapClickIntent";
import { defaultMapFeatureName, draftVerticesToFeatureGeometry, featureDraftMinimumVertices, featureOptionForKind, type UtilityFeatureGeometry } from "./mapTools";
import {
  adjacentProjectVertexSelection,
  firstBoundaryVertexSelection,
  firstMapFeatureVertexSelection,
  firstObstacleVertexSelection,
  selectedProjectVertexCanDelete,
  selectedProjectVertexCanInsert,
  selectedProjectVertexInsertionPoint,
  selectedProjectVertexIsMapFeatureCircleRadius,
  selectedProjectVertexPoint,
  selectedProjectVertexText,
  type SelectedProjectVertex,
} from "./projectVertexEditing";
import type { MapSurfaceProps } from "./types";

export interface MapInteractionOptions {
  imageryEnabled: boolean;
}

export interface MapInteractionState {
  mode: DrawingMode;
  activeLayer: DrawingLayerType;
  draftVertices: XY[];
  mapFeatureKind: ProjectMapFeatureKind;
  selectedVertex: SelectedProjectVertex | null;
  status: string;
  activeFeatureGeometry: UtilityFeatureGeometry;
}

export interface MapInteractionSnapshot extends MapInteractionState {
  canCommitDraft: boolean;
  canSaveFeature: boolean;
  canEditSelectedVertex: boolean;
  canDeleteSelectedVertex: boolean;
  canInsertSelectedVertex: boolean;
  statusMetaText: string;
}

export interface MapInteractionMethods {
  setTool(mode: DrawingMode, layer?: DrawingLayerType): void;
  setActiveLayer(layer: DrawingLayerType): void;
  setMapFeatureKind(kind: ProjectMapFeatureKind): void;
  clearDraft(status?: string): void;
  setStatus(text: string): void;
  handleLonLat(lonLat: LonLat, closeRequested?: boolean): void;
  handleProjectedPoint(point: XY, closeRequested?: boolean, wgs84?: LonLat): void;
  handleDraftVertexIntent(vertex: XY, closeRequested: boolean): void;
  commitDraft(): void;
  saveMapFeatureFromDraft(): void;
  selectVertex(vertex: SelectedProjectVertex | null, fallbackStatus?: string): void;
  selectFirstBoundaryVertex(): void;
  selectFirstObstacleVertex(): void;
  selectFirstMapFeatureVertex(): void;
  selectAdjacentVertex(direction: -1 | 1): void;
  nudgeSelectedVertex(delta: XY): void;
  moveSelectedVertexToPoint(point: XY): void;
  insertAfterSelectedVertex(): void;
  deleteSelectedVertex(): void;
}

export interface MapInteractionController {
  methods: MapInteractionMethods;
  getSnapshot(): MapInteractionSnapshot;
  subscribe(listener: () => void): () => void;
  updateInputs(props: MapSurfaceProps, options: MapInteractionOptions, notify?: boolean): void;
}

const EMPTY_DRAFT: XY[] = [];
const CLEARED_STATUS = "Draft cleared. Committed projected XY geometry is unchanged.";
const CONSECUTIVE_VERTEX_EPSILON = 1e-7;

function canEdit(props: MapSurfaceProps): boolean {
  return props.settings.mappingWorkflowMode === "design" && !props.homeView;
}

function workflowStatus(props: MapSurfaceProps): string {
  if (props.homeView) return "Catalog map: open a field map or design before editing projected XY geometry.";
  return canEdit(props)
    ? "Design mode: projected XY edits require Commit before they change the project."
    : "Layout mode is RTK-only; switch to Design for pointer-based geometry edits.";
}

export function createMapInteractionState(props: MapSurfaceProps): MapInteractionState {
  const mapFeatureKind = props.activeMapFeatureKind ?? "underground_pipeline";
  return {
    mode: canEdit(props) ? props.activeToolMode ?? "pan" : "pan",
    activeLayer: props.activeLayer ?? "field_boundary",
    draftVertices: EMPTY_DRAFT,
    mapFeatureKind,
    selectedVertex: null,
    status: workflowStatus(props),
    activeFeatureGeometry: props.activeDraftGeometry ?? featureOptionForKind(mapFeatureKind).geometry,
  };
}

function finitePoint(point: XY | null | undefined): point is XY {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function finiteLonLat(point: LonLat): boolean {
  return Number.isFinite(point.longitude) && Number.isFinite(point.latitude);
}

function validSelection(props: MapSurfaceProps, vertex: SelectedProjectVertex | null): vertex is SelectedProjectVertex {
  return vertex !== null && Number.isInteger(vertex.vertexIndex) && vertex.vertexIndex >= 0
    && finitePoint(selectedProjectVertexPoint(props.project, vertex));
}

function resetDraft(state: MapInteractionState, status: string): MapInteractionState {
  return { ...state, draftVertices: EMPTY_DRAFT, selectedVertex: null, status };
}

export function reconcileMapInteractionState(
  state: MapInteractionState,
  previous: MapSurfaceProps,
  props: MapSurfaceProps,
): MapInteractionState {
  const projectChanged = previous.project.id !== props.project.id || previous.project.projectCrs !== props.project.projectCrs;
  const manualChanged = previous.manualDesignCaptureRequest?.requestId !== props.manualDesignCaptureRequest?.requestId
    || previous.manualDesignCaptureRequest?.role !== props.manualDesignCaptureRequest?.role;
  const workflowChanged = canEdit(previous) !== canEdit(props) || Boolean(previous.homeView) !== Boolean(props.homeView);
  const commandChanged = previous.activeToolRequestId !== props.activeToolRequestId
    || previous.activeToolMode !== props.activeToolMode
    || previous.activeLayer !== props.activeLayer
    || previous.activeMapFeatureKind !== props.activeMapFeatureKind;
  let next = projectChanged ? { ...createMapInteractionState(props), mode: "pan" as const } : state;
  if (manualChanged || workflowChanged) next = resetDraft(next, workflowStatus(props));
  if (!canEdit(props)) return resetDraft({ ...next, mode: "pan" }, workflowStatus(props));
  if (commandChanged || workflowChanged) {
    next = {
      ...next,
      mode: props.activeToolMode ?? next.mode,
      activeLayer: props.activeLayer ?? next.activeLayer,
      mapFeatureKind: props.activeMapFeatureKind ?? next.mapFeatureKind,
    };
  }
  next = { ...next, activeFeatureGeometry: props.activeDraftGeometry ?? featureOptionForKind(next.mapFeatureKind).geometry };
  if (next.mode !== state.mode || next.activeLayer !== state.activeLayer || next.mapFeatureKind !== state.mapFeatureKind
    || next.activeFeatureGeometry !== state.activeFeatureGeometry
    || Boolean(previous.activeMapFeatureKind) !== Boolean(props.activeMapFeatureKind)) {
    next = resetDraft(next, `${next.mode.replaceAll("_", " ")} mode selected. No draft vertices are pending.`);
  }
  if (next.selectedVertex && !validSelection(props, next.selectedVertex)) next = { ...next, selectedVertex: null };
  return next;
}

function editCallback(props: MapSurfaceProps, selected: SelectedProjectVertex): ((point: XY) => void) | undefined {
  if (selected.layer === "field_boundary") {
    const callback = props.onMoveBoundaryVertex;
    return callback ? (point) => callback(selected.vertexIndex, point) : undefined;
  }
  if (selected.layer === "obstacle") {
    const callback = props.onMoveObstacleVertex;
    return callback ? (point) => callback(selected.obstacleId, selected.vertexIndex, point) : undefined;
  }
  if (selectedProjectVertexIsMapFeatureCircleRadius(props.project, selected)) {
    const callback = props.onMoveMapFeatureCircleRadiusHandle;
    return callback ? (point) => callback(selected.featureId, point) : undefined;
  }
  const callback = props.onMoveMapFeatureVertex;
  return callback ? (point) => callback(selected.featureId, selected.vertexIndex, point) : undefined;
}

function insertCallback(props: MapSurfaceProps, selected: SelectedProjectVertex): ((point: XY) => void) | undefined {
  if (selected.layer === "field_boundary") {
    const callback = props.onInsertBoundaryVertex;
    return callback ? (point) => callback(selected.vertexIndex, point) : undefined;
  }
  if (selected.layer === "obstacle") {
    const callback = props.onInsertObstacleVertex;
    return callback ? (point) => callback(selected.obstacleId, selected.vertexIndex, point) : undefined;
  }
  const callback = props.onInsertMapFeatureVertex;
  return callback ? (point) => callback(selected.featureId, selected.vertexIndex, point) : undefined;
}

function deleteCallback(props: MapSurfaceProps, selected: SelectedProjectVertex): (() => void) | undefined {
  if (selected.layer === "field_boundary") {
    const callback = props.onDeleteBoundaryVertex;
    return callback ? () => callback(selected.vertexIndex) : undefined;
  }
  if (selected.layer === "obstacle") {
    const callback = props.onDeleteObstacleVertex;
    return callback ? () => callback(selected.obstacleId, selected.vertexIndex) : undefined;
  }
  const callback = props.onDeleteMapFeatureVertex;
  return callback ? () => callback(selected.featureId, selected.vertexIndex) : undefined;
}

function commitCallbackAvailable(state: MapInteractionState, props: MapSurfaceProps): boolean {
  if (state.mode === "draw_boundary") {
    return Boolean(props.manualDesignCaptureRequest?.role === "boundary" ? props.onManualDesignCapture : props.onCommitBoundaryDraft);
  }
  return state.mode === "mark_obstacle" && Boolean(props.onCommitObstacleDraft);
}

function featureCallbackAvailable(props: MapSurfaceProps): boolean {
  return Boolean(props.activeMapFeatureKind ? props.onAddMapFeature : props.onCreateMapFeatureDraft);
}

function utilitySaveHint(state: MapInteractionState): string {
  if (state.mode !== "measure") return "";
  if (state.activeFeatureGeometry === "Point") return " \u00b7 point saves on map click";
  if (state.activeFeatureGeometry === "Circle") return " \u00b7 circle needs center + radius";
  if (state.activeFeatureGeometry === "Polygon") return " \u00b7 polygon needs 3 pts";
  return " \u00b7 line needs 2 pts";
}

export function selectMapInteractionState(state: MapInteractionState, props: MapSurfaceProps): MapInteractionSnapshot {
  const editing = canEdit(props);
  const selected = validSelection(props, state.selectedVertex) ? state.selectedVertex : null;
  const editingVertex = editing && state.mode === "edit_vertices" && selected !== null;
  return {
    ...state,
    canCommitDraft: editing && state.draftVertices.length >= 3 && commitCallbackAvailable(state, props),
    canSaveFeature: editing && state.mode === "measure" && state.activeFeatureGeometry !== "Point"
      && state.draftVertices.length >= featureDraftMinimumVertices(state.activeFeatureGeometry) && featureCallbackAvailable(props),
    canEditSelectedVertex: editingVertex && Boolean(editCallback(props, selected)),
    canDeleteSelectedVertex: editingVertex && selectedProjectVertexCanDelete(props.project, selected) && Boolean(deleteCallback(props, selected)),
    canInsertSelectedVertex: editingVertex && selectedProjectVertexCanInsert(props.project, selected) && Boolean(insertCallback(props, selected)),
    statusMetaText: `${state.mode.replaceAll("_", " ")} \u00b7 ${state.draftVertices.length} draft pts${selected ? ` \u00b7 ${selectedProjectVertexText(props.project, selected)}` : ""}${utilitySaveHint(state)}`,
  };
}

type ProjectedClickIntent = Exclude<MapClickIntent, { type: "place_pivot" | "move_infrastructure" }>
  | { type: "place_pivot"; point: XY; wgs84?: LonLat }
  | { type: "move_infrastructure"; pointType: InfrastructurePoint; point: XY; wgs84?: LonLat };

function surveyRole(layer: DrawingLayerType): SurveyPoint["role"] {
  if (layer === "field_boundary") return "boundary";
  if (layer === "pivot_center" || layer === "water_source" || layer === "power_source") return layer;
  if (layer === "control_point") return "control";
  if (layer === "note_point") return "note";
  return "obstacle";
}

export function projectedPointIntent(state: MapInteractionState, point: XY, options: MapInteractionOptions, wgs84?: LonLat): ProjectedClickIntent {
  if (state.mode === "pan" || state.mode === "edit_vertices") return { type: "none", reason: state.mode };
  if (state.mode === "place_pivot") {
    return state.activeLayer === "water_source" || state.activeLayer === "power_source"
      ? { type: "move_infrastructure", pointType: state.activeLayer, point, wgs84 }
      : { type: "place_pivot", point, wgs84 };
  }
  const confidence = confidenceForImagery(options.imageryEnabled);
  const notes = options.imageryEnabled ? "Captured from imagery; verify with field survey." : undefined;
  if (state.mode === "capture_point") {
    const role = surveyRole(state.activeLayer);
    return { type: "add_survey_point", point: { label: `${role.replaceAll("_", " ")} point`, role, projected: point, wgs84, source: "manual", confidence, notes } };
  }
  if (state.mode === "measure" && state.activeFeatureGeometry === "Point") {
    return {
      type: "add_map_feature_point",
      feature: { name: defaultMapFeatureName(state.mapFeatureKind, "Point", 1), kind: state.mapFeatureKind, geometry: { type: "Point", point }, confidence, notes },
    };
  }
  return { type: "draft_vertex", vertex: point };
}

function obstacleKind(layer: DrawingLayerType): ObstacleZone["kind"] {
  if (layer === "road" || layer === "ditch" || layer === "fence" || layer === "building" || layer === "canal" || layer === "tree" || layer === "exclusion") return layer;
  return "exclusion";
}

function cloneVertices(vertices: XY[]): XY[] {
  return vertices.map((vertex) => ({ ...vertex }));
}

function callbackRejected(result: unknown): boolean {
  return result === false || (typeof result === "object" && result !== null && "ok" in result && result.ok === false);
}

export function createMapInteractionController(initialProps: MapSurfaceProps, initialOptions: MapInteractionOptions): MapInteractionController {
  let props = initialProps;
  let options = initialOptions;
  let state = createMapInteractionState(props);
  let snapshot = selectMapInteractionState(state, props);
  const listeners = new Set<() => void>();

  function publish(next: MapInteractionState, notify = true): void {
    state = next;
    const nextSnapshot = selectMapInteractionState(state, props);
    if ((Object.keys(nextSnapshot) as Array<keyof MapInteractionSnapshot>).every((key) => Object.is(nextSnapshot[key], snapshot[key]))) return;
    snapshot = nextSnapshot;
    if (notify) listeners.forEach((listener) => listener());
  }

  function setStatus(status: string): void {
    publish({ ...state, status });
  }

  function clearDraft(status = CLEARED_STATUS): void {
    publish({ ...state, draftVertices: EMPTY_DRAFT, status });
  }

  function requireEditing(): boolean {
    if (canEdit(props)) return true;
    setStatus(workflowStatus(props));
    return false;
  }

  function missingCallback(): void {
    setStatus("This map action is unavailable. Draft and project geometry are unchanged.");
  }

  function setTool(mode: DrawingMode, layer = state.activeLayer): void {
    if (!canEdit(props) && mode !== "pan") return;
    if (mode === state.mode && layer === state.activeLayer) return;
    publish(resetDraft({ ...state, mode, activeLayer: layer }, `${mode.replaceAll("_", " ")} mode selected. No draft vertices are pending.`));
  }

  function commitVertices(vertices: XY[]): void {
    if (!requireEditing() || vertices.length < 3 || !vertices.every(finitePoint)) return;
    const capture = props.manualDesignCaptureRequest;
    if (state.mode === "draw_boundary" && capture?.role === "boundary") {
      if (!props.onManualDesignCapture) return missingCallback();
      props.onManualDesignCapture({ ...capture, vertices: cloneVertices(vertices) });
      clearDraft(`Staged ${vertices.length} boundary vertices in the manual-design draft. Project geometry is unchanged.`);
      return;
    }
    const mode = state.mode;
    const kind = obstacleKind(state.activeLayer);
    if (mode !== "draw_boundary" && mode !== "mark_obstacle") return;
    if (!commitCallbackAvailable(state, props)) return missingCallback();
    const committed = mode === "draw_boundary"
      ? props.onCommitBoundaryDraft!(cloneVertices(vertices))
      : props.onCommitObstacleDraft!(cloneVertices(vertices), kind, confidenceForImagery(options.imageryEnabled));
    if (committed === false) {
      publish({ ...state, draftVertices: cloneVertices(vertices), status: "Draft validation failed. Fix the projected XY vertices before clearing or committing." });
    } else {
      clearDraft(`Committed ${mode === "draw_boundary" ? "field boundary" : `${kind} obstacle`} with ${vertices.length} projected XY vertices.`);
    }
  }

  function handleDraftVertexIntent(vertex: XY, closeRequested: boolean): void {
    if (!requireEditing() || !finitePoint(vertex)) return;
    if (state.mode !== "draw_boundary" && state.mode !== "mark_obstacle" && state.mode !== "measure") return;
    if (closeRequested && state.draftVertices.length === 0) return;
    const lastVertex = state.draftVertices.at(-1);
    const repeatsLastVertex = lastVertex
      && Math.hypot(vertex.x - lastVertex.x, vertex.y - lastVertex.y) <= CONSECUTIVE_VERTEX_EPSILON;
    // Browser double-clicks emit two clicks before close; retain the close command, not a duplicate vertex.
    if (repeatsLastVertex && (!closeRequested || state.mode === "measure" || state.draftVertices.length < 3)) return;
    const intent = resolveDraftVertexIntent({
      currentVertices: state.draftVertices, mode: state.mode, vertex: { ...vertex }, closeRequested,
      vertexSnapToleranceMeters: props.settings.drawing.vertexSnapToleranceMeters,
    });
    if (intent.type === "commit") {
      commitVertices(intent.vertices);
      return;
    }
    const vertices = [...state.draftVertices, intent.vertex];
    publish({ ...state, draftVertices: vertices, status: `Added projected XY draft vertex ${vertex.x.toFixed(2)}, ${vertex.y.toFixed(2)}.` });
    const capture = props.manualDesignCaptureRequest;
    if (state.mode === "draw_boundary" && capture?.role === "boundary") {
      props.onManualDesignCapture?.({ ...capture, vertices: cloneVertices(vertices) });
    }
  }

  function saveFeature(vertices: XY[], geometryType: UtilityFeatureGeometry): void {
    if (!requireEditing() || state.mode !== "measure" || !vertices.every(finitePoint)) return;
    if (vertices.length < (geometryType === "Point" ? 1 : featureDraftMinimumVertices(geometryType))) return;
    if (!featureCallbackAvailable(props)) return missingCallback();
    const confidence = confidenceForImagery(options.imageryEnabled);
    const notes = options.imageryEnabled ? "Traced from imagery; verify with field survey." : undefined;
    if (!props.activeMapFeatureKind) {
      const accepted: unknown = props.onCreateMapFeatureDraft!({ geometryType, vertices: cloneVertices(vertices), sourceConfidence: confidence, notes });
      if (callbackRejected(accepted)) return;
      clearDraft(geometryType === "Point"
        ? "Point captured in projected XY. Choose its purpose before saving project geometry."
        : `Captured ${geometryType.replace("String", "")} draft in projected XY. Choose its purpose before saving.`);
    } else {
      const accepted: unknown = props.onAddMapFeature!({
        name: defaultMapFeatureName(state.mapFeatureKind, geometryType, vertices.length), kind: state.mapFeatureKind,
        geometry: draftVerticesToFeatureGeometry(geometryType, cloneVertices(vertices)), confidence, notes,
      });
      if (callbackRejected(accepted)) return;
      clearDraft(`Saved ${state.mapFeatureKind.replaceAll("_", " ")} ${geometryType.toLowerCase()} in projected XY as a map feature.`);
    }
  }

  function applyClickIntent(intent: ProjectedClickIntent, closeRequested: boolean): void {
    if (intent.type === "none") return;
    if (intent.type === "draft_vertex") return handleDraftVertexIntent(intent.vertex, closeRequested);
    // A double-click's close event must not repeat point/placement callbacks.
    if (closeRequested) return;
    if (intent.type === "place_pivot" || intent.type === "move_infrastructure") {
      if (!finitePoint(intent.point)) return;
      const capture = props.manualDesignCaptureRequest;
      if (capture && capture.role !== "boundary") {
        if (!props.onManualDesignCapture) return missingCallback();
        publish({ ...state, draftVertices: [{ ...intent.point }], status: `Staged ${capture.role.replaceAll("_", " ")} map point in the manual-design draft. Project geometry is unchanged.` });
        props.onManualDesignCapture({ ...capture, point: { ...intent.point }, wgs84: intent.wgs84 });
      } else if (intent.type === "place_pivot") {
        if (!props.onPlacePivot) return missingCallback();
        props.onPlacePivot({ ...intent.point }, intent.wgs84);
        setStatus(`Placed pivot at projected XY ${intent.point.x.toFixed(2)}, ${intent.point.y.toFixed(2)}.`);
      } else {
        if (!props.onMoveInfrastructurePoint) return missingCallback();
        props.onMoveInfrastructurePoint(intent.pointType, { ...intent.point }, intent.wgs84);
        setStatus(`Moved ${intent.pointType.replaceAll("_", " ")} in projected XY.`);
      }
      return;
    }
    if (intent.type === "add_survey_point") {
      if (!finitePoint(intent.point.projected)) return;
      if (!props.onAddSurveyPoint) return missingCallback();
      props.onAddSurveyPoint(intent.point);
      setStatus(`Captured ${intent.point.role.replaceAll("_", " ")} survey point in projected XY.`);
      return;
    }
    if (intent.feature.geometry.type === "Point") saveFeature([intent.feature.geometry.point], "Point");
  }

  function selectVertex(vertex: SelectedProjectVertex | null, fallbackStatus = "No project vertices are available for editing."): void {
    if (!requireEditing()) return;
    if (!validSelection(props, vertex)) {
      publish({ ...state, selectedVertex: null, status: fallbackStatus });
      return;
    }
    publish({ ...state, mode: "edit_vertices", draftVertices: EMPTY_DRAFT, selectedVertex: { ...vertex }, status: `Selected ${selectedProjectVertexText(props.project, vertex)} for projected XY editing.` });
  }

  function moveSelectedVertexToPoint(point: XY): void {
    if (!requireEditing() || !finitePoint(point) || !snapshot.canEditSelectedVertex || !state.selectedVertex) return;
    const movedVertexText = selectedProjectVertexText(props.project, state.selectedVertex);
    editCallback(props, state.selectedVertex)?.({ ...point });
    setStatus(`Moved ${movedVertexText} in projected XY. Save Local to persist.`);
  }

  const methods: MapInteractionMethods = {
    setTool,
    setActiveLayer: (layer) => setTool(state.mode, layer),
    setMapFeatureKind(kind) {
      if (!canEdit(props) || kind === state.mapFeatureKind) return;
      publish(resetDraft({ ...state, mapFeatureKind: kind, activeFeatureGeometry: props.activeDraftGeometry ?? featureOptionForKind(kind).geometry }, "Map feature tool selected. No draft vertices are pending."));
    },
    clearDraft,
    setStatus,
    handleLonLat(lonLat, closeRequested = false) {
      if (!requireEditing() || !finiteLonLat(lonLat) || state.mode === "pan" || state.mode === "edit_vertices") return;
      let intent: MapClickIntent;
      try {
        intent = mapClickToProjectedIntent({
          activeLayer: state.activeLayer, featureGeometry: state.activeFeatureGeometry, featureKind: state.mapFeatureKind,
          imageryEnabled: options.imageryEnabled, mode: state.mode, workflowMode: props.settings.mappingWorkflowMode,
          projectCrs: props.project.projectCrs, lonLat,
        });
      } catch (error) {
        setStatus(`Map point could not be projected: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      applyClickIntent(intent, closeRequested);
    },
    handleProjectedPoint(point, closeRequested = false, wgs84) {
      if (!requireEditing() || !finitePoint(point) || (wgs84 && !finiteLonLat(wgs84))) return;
      applyClickIntent(projectedPointIntent(state, { ...point }, options, wgs84), closeRequested);
    },
    handleDraftVertexIntent,
    commitDraft: () => commitVertices(state.draftVertices),
    saveMapFeatureFromDraft() {
      if (state.activeFeatureGeometry === "Point") return;
      saveFeature(state.draftVertices, state.activeFeatureGeometry);
    },
    selectVertex,
    selectFirstBoundaryVertex: () => selectVertex(firstBoundaryVertexSelection(props.project), "No boundary vertices are available for editing."),
    selectFirstObstacleVertex: () => selectVertex(firstObstacleVertexSelection(props.project), "No obstacle vertices are available for editing."),
    selectFirstMapFeatureVertex() {
      const selected: SelectedProjectVertex | null = props.selectedMapFeatureId
        ? { layer: "map_feature", featureId: props.selectedMapFeatureId, vertexIndex: 0 } : null;
      selectVertex(validSelection(props, selected) ? selected : firstMapFeatureVertexSelection(props.project), "No map feature vertices are available for editing.");
    },
    selectAdjacentVertex: (direction) => selectVertex(adjacentProjectVertexSelection(props.project, state.selectedVertex, direction)),
    nudgeSelectedVertex(delta) {
      if (!finitePoint(delta) || !state.selectedVertex) return;
      const point = selectedProjectVertexPoint(props.project, state.selectedVertex);
      if (point) moveSelectedVertexToPoint({ x: point.x + delta.x, y: point.y + delta.y });
    },
    moveSelectedVertexToPoint,
    insertAfterSelectedVertex() {
      if (!requireEditing() || !snapshot.canInsertSelectedVertex || !state.selectedVertex) return;
      const selected = state.selectedVertex;
      const point = selectedProjectVertexInsertionPoint(props.project, selected);
      if (!finitePoint(point)) return;
      insertCallback(props, selected)?.(point);
      publish({ ...state, selectedVertex: { ...selected, vertexIndex: selected.vertexIndex + 1 }, status: "Inserted a projected XY vertex at the selected segment midpoint. Drag the handle or nudge it to refine the position." });
    },
    deleteSelectedVertex() {
      if (!requireEditing() || !snapshot.canDeleteSelectedVertex || !state.selectedVertex) return;
      deleteCallback(props, state.selectedVertex)?.();
      publish({ ...state, selectedVertex: null, status: "Deleted selected projected XY vertex." });
    },
  };

  return {
    methods,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    updateInputs(nextProps, nextOptions, notify = true) {
      const next = reconcileMapInteractionState(state, props, nextProps);
      props = nextProps;
      options = nextOptions;
      publish(next, notify);
    },
  };
}
