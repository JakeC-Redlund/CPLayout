import { importProjectedGeoJsonToProject, importSurveyCsvToProject } from "./projectImports";
import { PivotProjectSchema, withWgs84Companion } from "./projectDocument";
import { projectDataKey } from "./projectDataComparison";
import { validateMapPackageManifest } from "./mapTilePackages";
import { applyManualDesignDraft, createManualDesignDraft, evaluateManualDesignReadiness, type ManualDesignDraft } from "./manualDesign";
import type { ProjectSettings } from "./settings";
import type { GnssCaptureEvidence, LonLat, MapPackageManifest, ObstacleZone, PivotMachine, PivotProject, ProjectMapFeature, ProjectMapFeatureGeometry, SourceConfidence, SurveyPoint, UnitSystem, XY } from "./types";

export interface ProjectEditorState {
  project: PivotProject;
  past: PivotProject[];
  future: PivotProject[];
  lastError: string | null;
  revision: number;
}

export type ProjectMutationResult =
  | { ok: true; revision: number }
  | { ok: false; error: string };

export type InfrastructurePoint = "pivot_center" | "water_source" | "power_source";

export type ProjectEditorAction =
  | { type: "load_project"; project: PivotProject }
  | { type: "commit_boundary_draft"; vertices: XY[]; captureEvidence?: Array<GnssCaptureEvidence | null> }
  | { type: "commit_obstacle_draft"; vertices: XY[]; kind?: ObstacleZone["kind"]; name?: string; id?: string; confidence?: SourceConfidence; captureEvidence?: Array<GnssCaptureEvidence | null> }
  | { type: "move_boundary_vertex"; vertexIndex: number; point: XY }
  | { type: "insert_boundary_vertex"; afterVertexIndex: number; point: XY }
  | { type: "delete_boundary_vertex"; vertexIndex: number }
  | { type: "move_obstacle_vertex"; obstacleId: string; vertexIndex: number; point: XY }
  | { type: "insert_obstacle_vertex"; obstacleId: string; afterVertexIndex: number; point: XY }
  | { type: "delete_obstacle_vertex"; obstacleId: string; vertexIndex: number }
  | { type: "replace_obstacle_polygon"; obstacleId: string; vertices: XY[] }
  | { type: "place_pivot"; point: XY; wgs84?: LonLat }
  | { type: "move_infrastructure"; pointType: InfrastructurePoint; point: XY; wgs84?: LonLat }
  | { type: "add_survey_point"; point: Omit<SurveyPoint, "id" | "observedAt"> & { id?: string; observedAt?: string } }
  | { type: "update_survey_point"; point: SurveyPoint }
  | { type: "delete_survey_point"; id: string }
  | { type: "add_map_feature"; feature: ProjectMapFeature }
  | { type: "upsert_map_features"; features: ProjectMapFeature[] }
  | { type: "update_map_feature"; feature: ProjectMapFeature }
  | { type: "delete_map_feature"; id: string }
  | { type: "move_map_feature_vertex"; featureId: string; vertexIndex: number; point: XY }
  | { type: "insert_map_feature_vertex"; featureId: string; afterVertexIndex: number; point: XY }
  | { type: "delete_map_feature_vertex"; featureId: string; vertexIndex: number }
  | { type: "move_map_feature_circle_radius_handle"; featureId: string; point: XY }
  | { type: "promote_survey_point"; id: string; target: InfrastructurePoint }
  | { type: "update_machine"; machine: PivotMachine }
  | { type: "upsert_map_package"; mapPackage: MapPackageManifest }
  | { type: "update_project_settings"; unitSystem: UnitSystem; settings: ProjectSettings }
  | { type: "import_projected_geojson"; geoJson: string | unknown }
  | { type: "import_survey_csv"; csv: string }
  | { type: "apply_project_import"; project: PivotProject }
  | { type: "apply_manual_design"; draft: ManualDesignDraft }
  | { type: "cancel_draft" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear_error" };

export function createProjectEditorState(project: PivotProject): ProjectEditorState {
  const parsedProject = withWgs84Companion(PivotProjectSchema.parse(project));
  const topologyIssue = evaluateManualDesignReadiness(createManualDesignDraft(parsedProject, 0)).topologyIssues[0];
  return {
    project: parsedProject,
    past: [],
    future: [],
    lastError: topologyIssue ? `Repair required: ${topologyIssue.message}` : null,
    revision: 0,
  };
}

export function reduceProjectEditorState(state: ProjectEditorState, action: ProjectEditorAction): ProjectEditorState {
  try {
    switch (action.type) {
      case "load_project":
        return createProjectEditorState(action.project);
      case "commit_boundary_draft": {
        const boundary = validatedCapturedRing(action.vertices, action.captureEvidence, "Boundary draft");
        return applyProjectChange(state, {
          ...state.project,
          fieldBoundary: boundary.vertices,
          fieldBoundaryCaptureEvidence: boundary.captureEvidence,
        });
      }
      case "commit_obstacle_draft":
        return applyProjectChange(state, {
          ...state.project,
          obstacles: [
            ...state.project.obstacles,
            obstacleFromDraft(state.project, action.vertices, action.kind ?? "exclusion", action.name, action.id, action.confidence, action.captureEvidence),
          ],
        });
      case "move_boundary_vertex":
        return moveBoundaryVertex(state, action.vertexIndex, action.point);
      case "insert_boundary_vertex":
        return insertBoundaryVertex(state, action.afterVertexIndex, action.point);
      case "delete_boundary_vertex":
        return deleteBoundaryVertex(state, action.vertexIndex);
      case "move_obstacle_vertex":
        return moveObstacleVertex(state, action.obstacleId, action.vertexIndex, action.point);
      case "insert_obstacle_vertex":
        return insertObstacleVertex(state, action.obstacleId, action.afterVertexIndex, action.point);
      case "delete_obstacle_vertex":
        return deleteObstacleVertex(state, action.obstacleId, action.vertexIndex);
      case "replace_obstacle_polygon":
        return replaceObstaclePolygon(state, action.obstacleId, action.vertices);
      case "place_pivot":
        return moveInfrastructurePoint(state, "pivot_center", action.point, action.wgs84);
      case "move_infrastructure":
        return moveInfrastructurePoint(state, action.pointType, action.point, action.wgs84);
      case "add_survey_point":
        return addSurveyPoint(state, action.point);
      case "update_survey_point":
        return updateSurveyPoint(state, action.point);
      case "delete_survey_point":
        return deleteSurveyPoint(state, action.id);
      case "add_map_feature":
        return addMapFeature(state, action.feature);
      case "upsert_map_features":
        return upsertMapFeatures(state, action.features);
      case "update_map_feature":
        return updateMapFeature(state, action.feature);
      case "delete_map_feature":
        return deleteMapFeature(state, action.id);
      case "move_map_feature_vertex":
        return moveMapFeatureVertex(state, action.featureId, action.vertexIndex, action.point);
      case "insert_map_feature_vertex":
        return insertMapFeatureVertex(state, action.featureId, action.afterVertexIndex, action.point);
      case "delete_map_feature_vertex":
        return deleteMapFeatureVertex(state, action.featureId, action.vertexIndex);
      case "move_map_feature_circle_radius_handle":
        return moveMapFeatureCircleRadiusHandle(state, action.featureId, action.point);
      case "promote_survey_point":
        return promoteSurveyPoint(state, action.id, action.target);
      case "update_machine":
        return applyProjectChange(state, { ...state.project, machine: action.machine });
      case "upsert_map_package":
        return upsertMapPackage(state, action.mapPackage);
      case "update_project_settings":
        if (state.project.unitSystem === action.unitSystem && projectSettingsEqual(state.project.settings, action.settings)) return state;
        return applyProjectChange(state, {
          ...state.project,
          unitSystem: action.unitSystem,
          settings: action.settings,
        });
      case "import_projected_geojson":
        return applyValidatedProjectImport(state, importProjectedGeoJsonToProject(state.project, action.geoJson).project);
      case "import_survey_csv":
        return applyProjectChange(state, importSurveyCsvToProject(state.project, action.csv).project);
      case "apply_project_import":
        return applyValidatedProjectImport(state, action.project);
      case "apply_manual_design":
        return applyProjectChange(state, applyManualDesignDraft(state.project, action.draft, state.revision));
      case "cancel_draft":
        return { ...state, lastError: null };
      case "undo":
        return undo(state);
      case "redo":
        return redo(state);
      case "clear_error":
        return { ...state, lastError: null };
    }
  } catch (error) {
    return { ...state, lastError: error instanceof Error ? error.message : String(error) };
  }
}

function applyValidatedProjectImport(state: ProjectEditorState, project: PivotProject): ProjectEditorState {
  const topologyIssue = evaluateManualDesignReadiness(createManualDesignDraft(project, state.revision)).topologyIssues[0];
  if (topologyIssue) throw new Error(`Imported boundary is invalid: ${topologyIssue.message}`);
  return applyProjectChange(state, project);
}

export function evaluateProjectEditorAction(state: ProjectEditorState, action: ProjectEditorAction): ProjectMutationResult {
  const nextState = reduceProjectEditorState(state, action);
  if (nextState.lastError) return { ok: false, error: nextState.lastError };
  return { ok: true, revision: nextState.revision };
}

function applyProjectChange(state: ProjectEditorState, nextProject: PivotProject): ProjectEditorState {
  const parsedProject = withWgs84Companion(PivotProjectSchema.parse(nextProject));
  return {
    project: parsedProject,
    past: [...state.past, state.project],
    future: [],
    lastError: null,
    revision: state.revision + 1,
  };
}

function projectSettingsEqual(current: ProjectSettings | undefined, next: ProjectSettings): boolean {
  return JSON.stringify(current ?? null) === JSON.stringify(next);
}

function undo(state: ProjectEditorState): ProjectEditorState {
  const previous = state.past[state.past.length - 1];
  if (!previous) return state;
  return {
    project: previous,
    past: state.past.slice(0, -1),
    future: [state.project, ...state.future],
    lastError: null,
    revision: state.revision + 1,
  };
}

function redo(state: ProjectEditorState): ProjectEditorState {
  const next = state.future[0];
  if (!next) return state;
  return {
    project: next,
    past: [...state.past, state.project],
    future: state.future.slice(1),
    lastError: null,
    revision: state.revision + 1,
  };
}

function moveInfrastructurePoint(
  state: ProjectEditorState,
  pointType: InfrastructurePoint,
  point: XY,
  _wgs84?: LonLat,
  sourceObservationId?: string,
): ProjectEditorState {
  const project = state.project;
  const currentPoint = pointType === "pivot_center" ? project.pivotCenter : pointType === "water_source" ? project.waterSource : project.powerSource;
  if (!sourceObservationId && samePoint(currentPoint, point)) return state;
  const infrastructureObservationRefs = { ...(project.infrastructureObservationRefs ?? {}) };
  if (sourceObservationId) infrastructureObservationRefs[pointType] = sourceObservationId;
  else delete infrastructureObservationRefs[pointType];
  if (pointType === "pivot_center") {
    return applyProjectChange(state, {
      ...project,
      pivotCenter: point,
      infrastructureObservationRefs,
    });
  }
  if (pointType === "water_source") return applyProjectChange(state, { ...project, waterSource: point, infrastructureObservationRefs });
  return applyProjectChange(state, { ...project, powerSource: point, infrastructureObservationRefs });
}

function addSurveyPoint(
  state: ProjectEditorState,
  point: Omit<SurveyPoint, "id" | "observedAt"> & { id?: string; observedAt?: string },
): ProjectEditorState {
  const nextPoint: SurveyPoint = {
    ...point,
    id: point.id ?? `survey-${state.project.surveyPoints.length + 1}-${Date.now()}`,
    observedAt: point.observedAt ?? new Date().toISOString(),
  };
  if (state.project.surveyPoints.some((candidate) => candidate.id === nextPoint.id)) throw new Error(`Survey point ${nextPoint.id} already exists.`);
  return applyProjectChange(state, {
    ...state.project,
    surveyPoints: [...state.project.surveyPoints, nextPoint],
  });
}

function updateSurveyPoint(state: ProjectEditorState, point: SurveyPoint): ProjectEditorState {
  const currentPoint = state.project.surveyPoints.find((surveyPoint) => surveyPoint.id === point.id);
  if (!currentPoint) {
    throw new Error(`Survey point ${point.id} was not found.`);
  }
  if (!surveyObservationDataEqual(currentPoint, point)) {
    throw new Error("Survey observation coordinates, timing, source, quality, and capture evidence are immutable.");
  }
  return applyProjectChange(state, {
    ...state.project,
    surveyPoints: state.project.surveyPoints.map((surveyPoint) => surveyPoint.id === point.id ? point : surveyPoint),
  });
}

function deleteSurveyPoint(state: ProjectEditorState, id: string): ProjectEditorState {
  if (!state.project.surveyPoints.some((surveyPoint) => surveyPoint.id === id)) {
    throw new Error(`Survey point ${id} was not found.`);
  }
  if (Object.values(state.project.infrastructureObservationRefs ?? {}).includes(id)) {
    throw new Error(`Survey point ${id} is referenced by project infrastructure and cannot be deleted.`);
  }
  return applyProjectChange(state, {
    ...state.project,
    surveyPoints: state.project.surveyPoints.filter((surveyPoint) => surveyPoint.id !== id),
  });
}

function addMapFeature(state: ProjectEditorState, feature: ProjectMapFeature): ProjectEditorState {
  if ((state.project.mapFeatures ?? []).some((mapFeature) => mapFeature.id === feature.id)) {
    throw new Error(`Map feature ${feature.id} already exists.`);
  }
  assertMapFeatureBoundaryPolicy(state.project, feature);
  return applyProjectChange(state, {
    ...state.project,
    mapFeatures: [...(state.project.mapFeatures ?? []), feature],
  });
}

function upsertMapFeatures(state: ProjectEditorState, features: ProjectMapFeature[]): ProjectEditorState {
  if (features.length === 0) return state;
  const seenIds = new Set<string>();
  for (const feature of features) {
    if (seenIds.has(feature.id)) throw new Error(`Map feature ${feature.id} appears more than once.`);
    seenIds.add(feature.id);
  }
  const currentFeatures = state.project.mapFeatures ?? [];
  const nextById = new Map(currentFeatures.map((feature) => [feature.id, feature]));
  for (const feature of features) {
    assertMapFeatureBoundaryPolicy(state.project, feature);
    const current = nextById.get(feature.id);
    nextById.set(feature.id, current ? reconcileFeatureReplacement(current, feature) : feature);
  }
  const currentIds = new Set(currentFeatures.map((feature) => feature.id));
  return applyProjectChange(state, {
    ...state.project,
    mapFeatures: [
      ...currentFeatures.map((feature) => nextById.get(feature.id) ?? feature),
      ...features.filter((feature) => !currentIds.has(feature.id)),
    ],
  });
}

function updateMapFeature(state: ProjectEditorState, feature: ProjectMapFeature): ProjectEditorState {
  const currentFeature = (state.project.mapFeatures ?? []).find((mapFeature) => mapFeature.id === feature.id);
  if (!currentFeature) {
    throw new Error(`Map feature ${feature.id} was not found.`);
  }
  const nextFeature = reconcileFeatureReplacement(currentFeature, feature);
  assertMapFeatureBoundaryPolicy(state.project, nextFeature);
  return applyProjectChange(state, {
    ...state.project,
    mapFeatures: (state.project.mapFeatures ?? []).map((mapFeature) => mapFeature.id === feature.id ? nextFeature : mapFeature),
  });
}

function deleteMapFeature(state: ProjectEditorState, id: string): ProjectEditorState {
  if (!(state.project.mapFeatures ?? []).some((mapFeature) => mapFeature.id === id)) {
    throw new Error(`Map feature ${id} was not found.`);
  }
  return applyProjectChange(state, {
    ...state.project,
    mapFeatures: (state.project.mapFeatures ?? []).filter((mapFeature) => mapFeature.id !== id),
  });
}

function moveMapFeatureVertex(state: ProjectEditorState, featureId: string, vertexIndex: number, point: XY): ProjectEditorState {
  const features = state.project.mapFeatures ?? [];
  const feature = editableMapFeature(features, featureId);
  if (featureClosingVertex(features, featureId, vertexIndex)) vertexIndex = 0;
  const currentPoint = mapFeatureControlPoints(feature.geometry)[vertexIndex];
  if (currentPoint && samePoint(currentPoint, point)) return state;
  const geometry = moveMapFeatureGeometryVertex(feature.geometry, vertexIndex, point);
  const nextFeature = {
    ...feature,
    geometry,
    vertexCaptureEvidence: replaceEvidence(feature.vertexCaptureEvidence, vertexIndex, null),
  };
  assertMapFeatureBoundaryPolicy(state.project, nextFeature);
  return applyProjectChange(state, {
    ...state.project,
    mapFeatures: features.map((candidate) => candidate.id === featureId ? nextFeature : candidate),
  });
}

function insertMapFeatureVertex(state: ProjectEditorState, featureId: string, afterVertexIndex: number, point: XY): ProjectEditorState {
  const features = state.project.mapFeatures ?? [];
  const feature = editableMapFeature(features, featureId);
  if (featureClosingVertex(features, featureId, afterVertexIndex)) afterVertexIndex = 0;
  const geometry = insertMapFeatureGeometryVertex(feature.geometry, afterVertexIndex, point);
  const nextFeature = {
    ...feature,
    geometry,
    vertexCaptureEvidence: insertEvidence(feature.vertexCaptureEvidence, afterVertexIndex + 1, null),
  };
  assertMapFeatureBoundaryPolicy(state.project, nextFeature);
  return applyProjectChange(state, {
    ...state.project,
    mapFeatures: features.map((candidate) => candidate.id === featureId ? nextFeature : candidate),
  });
}

function deleteMapFeatureVertex(state: ProjectEditorState, featureId: string, vertexIndex: number): ProjectEditorState {
  const features = state.project.mapFeatures ?? [];
  const feature = editableMapFeature(features, featureId);
  const closing = featureClosingVertex(features, featureId, vertexIndex);
  const geometry = closing && feature.geometry.type === "Polygon"
    ? { ...feature.geometry, vertices: validatedRing(feature.geometry.vertices, "Map feature polygon", false) }
    : deleteMapFeatureGeometryVertex(feature.geometry, vertexIndex);
  const nextFeature = {
    ...feature,
    geometry,
    vertexCaptureEvidence: closing ? feature.vertexCaptureEvidence : removeEvidence(feature.vertexCaptureEvidence, vertexIndex),
  };
  assertMapFeatureBoundaryPolicy(state.project, nextFeature);
  return applyProjectChange(state, {
    ...state.project,
    mapFeatures: features.map((candidate) => candidate.id === featureId ? nextFeature : candidate),
  });
}

function moveMapFeatureCircleRadiusHandle(state: ProjectEditorState, featureId: string, point: XY): ProjectEditorState {
  const features = state.project.mapFeatures ?? [];
  const feature = features.find((candidate) => candidate.id === featureId);
  if (!feature) throw new Error(`Map feature ${featureId} was not found.`);
  if (feature.geometry.type !== "Circle") throw new Error(`Map feature ${featureId} is not a circle.`);
  const handle = assertFinitePoint(point, "Map feature radius handle");
  const radiusMeters = Math.hypot(handle.x - feature.geometry.center.x, handle.y - feature.geometry.center.y);
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new Error("Map feature circle radius must be positive.");
  }
  return applyProjectChange(state, {
    ...state.project,
    mapFeatures: features.map((candidate) => candidate.id === featureId
      ? { ...candidate, geometry: { ...feature.geometry, radiusMeters } }
      : candidate),
  });
}

function moveMapFeatureGeometryVertex(geometry: ProjectMapFeatureGeometry, vertexIndex: number, point: XY): ProjectMapFeatureGeometry {
  if (geometry.type === "Point") {
    assertVertexIndex([geometry.point], vertexIndex, "Map feature point");
    return { ...geometry, point: assertFinitePoint(point, "Map feature point") };
  }
  if (geometry.type === "Circle") {
    assertVertexIndex([geometry.center], vertexIndex, "Map feature center");
    return { ...geometry, center: assertFinitePoint(point, "Map feature center") };
  }
  if (geometry.type === "LineString") {
    return {
      ...geometry,
      vertices: validatedLineString(replaceVertex(geometry.vertices, vertexIndex, point, "Map feature vertex"), "Map feature line"),
    };
  }
  return {
    ...geometry,
    vertices: validatedRing(replaceVertex(geometry.vertices, vertexIndex, point, "Map feature vertex"), "Map feature polygon", false),
  };
}

function insertMapFeatureGeometryVertex(geometry: ProjectMapFeatureGeometry, afterVertexIndex: number, point: XY): ProjectMapFeatureGeometry {
  if (geometry.type === "Point" || geometry.type === "Circle") {
    throw new Error(`Map feature ${geometry.type.toLowerCase()} does not support segment insertion.`);
  }
  if (geometry.type === "LineString") {
    if (afterVertexIndex >= geometry.vertices.length - 1) {
      throw new Error("Select a line segment before inserting a map feature vertex.");
    }
    return {
      ...geometry,
      vertices: validatedLineString(insertVertex(geometry.vertices, afterVertexIndex, point, "Map feature vertex"), "Map feature line"),
    };
  }
  return {
    ...geometry,
    vertices: validatedRing(insertVertex(geometry.vertices, afterVertexIndex, point, "Map feature vertex"), "Map feature polygon", false),
  };
}

function deleteMapFeatureGeometryVertex(geometry: ProjectMapFeatureGeometry, vertexIndex: number): ProjectMapFeatureGeometry {
  if (geometry.type === "Point") {
    assertVertexIndex([geometry.point], vertexIndex, "Map feature point");
    throw new Error("Map feature point cannot be deleted; delete the feature instead.");
  }
  if (geometry.type === "Circle") {
    assertVertexIndex([geometry.center], vertexIndex, "Map feature center");
    throw new Error("Map feature center cannot be deleted; delete the feature instead.");
  }
  if (geometry.type === "LineString") {
    return {
      ...geometry,
      vertices: validatedLineString(removeVertex(geometry.vertices, vertexIndex, "Map feature vertex"), "Map feature line"),
    };
  }
  return {
    ...geometry,
    vertices: validatedRing(removeVertex(geometry.vertices, vertexIndex, "Map feature vertex"), "Map feature polygon", false),
  };
}

function assertMapFeatureBoundaryPolicy(project: PivotProject, feature: ProjectMapFeature): void {
  if (!isLayoutControlFeature(feature.kind)) return;
  for (const point of mapFeatureControlPoints(feature.geometry)) {
    assertPointInsideRing(point, project.fieldBoundary, `${titleCase(feature.kind)} map feature`);
  }
}

function isLayoutControlFeature(kind: ProjectMapFeature["kind"]): boolean {
  return kind === "planning_boundary"
    || kind === "machine_zone"
    || kind === "end_gun_arc"
    || kind === "corner_swing_limit";
}

function mapFeatureControlPoints(geometry: ProjectMapFeatureGeometry): XY[] {
  if (geometry.type === "Point") return [geometry.point];
  if (geometry.type === "Circle") return [geometry.center];
  return geometry.vertices;
}

function upsertMapPackage(state: ProjectEditorState, mapPackage: MapPackageManifest): ProjectEditorState {
  const parsed = validateMapPackageManifest(mapPackage);
  const current = state.project.mapPackages ?? [];
  const nextPackages = current.some((candidate) => candidate.id === parsed.id)
    ? current.map((candidate) => candidate.id === parsed.id ? parsed : candidate)
    : [...current, parsed];
  return applyProjectChange(state, {
    ...state.project,
    mapPackages: nextPackages,
  });
}

function promoteSurveyPoint(state: ProjectEditorState, id: string, target: InfrastructurePoint): ProjectEditorState {
  const surveyPoint = state.project.surveyPoints.find((candidate) => candidate.id === id);
  if (!surveyPoint) throw new Error(`Survey point ${id} was not found.`);
  return moveInfrastructurePoint(state, target, surveyPoint.projected, surveyPoint.wgs84, surveyPoint.id);
}

function moveBoundaryVertex(state: ProjectEditorState, vertexIndex: number, point: XY): ProjectEditorState {
  if (isClosingVertex(state.project.fieldBoundary, vertexIndex)) vertexIndex = 0;
  const currentPoint = state.project.fieldBoundary[vertexIndex];
  if (currentPoint && samePoint(currentPoint, point)) return state;
  const current = normalizeCapturedRing(state.project.fieldBoundary, state.project.fieldBoundaryCaptureEvidence, "Boundary");
  const fieldBoundary = replaceVertex(current.vertices, vertexIndex, point, "Boundary vertex");
  return applyProjectChange(state, {
    ...state.project,
    fieldBoundary: validatedRing(fieldBoundary, "Boundary", false),
    fieldBoundaryCaptureEvidence: replaceEvidence(current.captureEvidence, vertexIndex, null),
  });
}

function insertBoundaryVertex(state: ProjectEditorState, afterVertexIndex: number, point: XY): ProjectEditorState {
  if (isClosingVertex(state.project.fieldBoundary, afterVertexIndex)) afterVertexIndex = 0;
  const current = normalizeCapturedRing(state.project.fieldBoundary, state.project.fieldBoundaryCaptureEvidence, "Boundary");
  const fieldBoundary = insertVertex(current.vertices, afterVertexIndex, point, "Boundary vertex");
  return applyProjectChange(state, {
    ...state.project,
    fieldBoundary: validatedRing(fieldBoundary, "Boundary", false),
    fieldBoundaryCaptureEvidence: insertEvidence(current.captureEvidence, afterVertexIndex + 1, null),
  });
}

function deleteBoundaryVertex(state: ProjectEditorState, vertexIndex: number): ProjectEditorState {
  const current = normalizeCapturedRing(state.project.fieldBoundary, state.project.fieldBoundaryCaptureEvidence, "Boundary");
  const closing = isClosingVertex(state.project.fieldBoundary, vertexIndex);
  const fieldBoundary = closing ? current.vertices : removeVertex(current.vertices, vertexIndex, "Boundary vertex");
  return applyProjectChange(state, {
    ...state.project,
    fieldBoundary: validatedRing(fieldBoundary, "Boundary", false),
    fieldBoundaryCaptureEvidence: closing ? current.captureEvidence : removeEvidence(current.captureEvidence, vertexIndex),
  });
}

function moveObstacleVertex(state: ProjectEditorState, obstacleId: string, vertexIndex: number, point: XY): ProjectEditorState {
  const target = state.project.obstacles.find((obstacle) => obstacle.id === obstacleId);
  if (target && isClosingVertex(target.polygon, vertexIndex)) vertexIndex = 0;
  if (target?.polygon[vertexIndex] && samePoint(target.polygon[vertexIndex], point)) return state;
  const obstacles = state.project.obstacles.map((obstacle) => {
    if (obstacle.id !== obstacleId) return obstacle;
    const current = normalizeCapturedRing(obstacle.polygon, obstacle.vertexCaptureEvidence, "Obstacle");
    const polygon = replaceVertex(current.vertices, vertexIndex, point, "Obstacle vertex");
    return {
      ...obstacle,
      polygon: validatedRing(polygon, "Obstacle", false),
      vertexCaptureEvidence: replaceEvidence(current.captureEvidence, vertexIndex, null),
    };
  });
  if (obstacles === state.project.obstacles || !state.project.obstacles.some((obstacle) => obstacle.id === obstacleId)) {
    throw new Error(`Obstacle ${obstacleId} was not found.`);
  }
  return applyProjectChange(state, { ...state.project, obstacles });
}

function insertObstacleVertex(state: ProjectEditorState, obstacleId: string, afterVertexIndex: number, point: XY): ProjectEditorState {
  if (!state.project.obstacles.some((obstacle) => obstacle.id === obstacleId)) {
    throw new Error(`Obstacle ${obstacleId} was not found.`);
  }
  return applyProjectChange(state, {
    ...state.project,
    obstacles: state.project.obstacles.map((obstacle) => {
      if (obstacle.id !== obstacleId) return obstacle;
      const current = normalizeCapturedRing(obstacle.polygon, obstacle.vertexCaptureEvidence, "Obstacle");
      const index = isClosingVertex(obstacle.polygon, afterVertexIndex) ? 0 : afterVertexIndex;
      return {
        ...obstacle,
        polygon: validatedRing(insertVertex(current.vertices, index, point, "Obstacle vertex"), "Obstacle", false),
        vertexCaptureEvidence: insertEvidence(current.captureEvidence, index + 1, null),
      };
    }),
  });
}

function deleteObstacleVertex(state: ProjectEditorState, obstacleId: string, vertexIndex: number): ProjectEditorState {
  const obstacles = state.project.obstacles.map((obstacle) => {
    if (obstacle.id !== obstacleId) return obstacle;
    const current = normalizeCapturedRing(obstacle.polygon, obstacle.vertexCaptureEvidence, "Obstacle");
    const closing = isClosingVertex(obstacle.polygon, vertexIndex);
    const polygon = closing ? current.vertices : removeVertex(current.vertices, vertexIndex, "Obstacle vertex");
    return {
      ...obstacle,
      polygon: validatedRing(polygon, "Obstacle", false),
      vertexCaptureEvidence: closing ? current.captureEvidence : removeEvidence(current.captureEvidence, vertexIndex),
    };
  });
  if (!state.project.obstacles.some((obstacle) => obstacle.id === obstacleId)) {
    throw new Error(`Obstacle ${obstacleId} was not found.`);
  }
  return applyProjectChange(state, { ...state.project, obstacles });
}

function replaceObstaclePolygon(state: ProjectEditorState, obstacleId: string, vertices: XY[]): ProjectEditorState {
  if (!state.project.obstacles.some((obstacle) => obstacle.id === obstacleId)) {
    throw new Error(`Obstacle ${obstacleId} was not found.`);
  }
  return applyProjectChange(state, {
    ...state.project,
    obstacles: state.project.obstacles.map((obstacle) => obstacle.id === obstacleId
      ? { ...obstacle, polygon: validatedRing(vertices, "Obstacle"), vertexCaptureEvidence: undefined }
      : obstacle),
  });
}

function replaceVertex(vertices: XY[], vertexIndex: number, point: XY, label: string): XY[] {
  assertVertexIndex(vertices, vertexIndex, label);
  return vertices.map((vertex, index) => index === vertexIndex ? point : vertex);
}

function insertVertex(vertices: XY[], afterVertexIndex: number, point: XY, label: string): XY[] {
  assertVertexIndex(vertices, afterVertexIndex, label);
  const next = [...vertices];
  next.splice(afterVertexIndex + 1, 0, assertFinitePoint(point, label));
  return next;
}

function removeVertex(vertices: XY[], vertexIndex: number, label: string): XY[] {
  assertVertexIndex(vertices, vertexIndex, label);
  return vertices.filter((_vertex, index) => index !== vertexIndex);
}

function assertVertexIndex(vertices: XY[], vertexIndex: number, label: string): void {
  if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= vertices.length) {
    throw new Error(`${label} index ${vertexIndex} is outside the editable ring.`);
  }
}

function obstacleFromDraft(
  project: PivotProject,
  vertices: XY[],
  kind: ObstacleZone["kind"],
  name?: string,
  id?: string,
  confidence: SourceConfidence = "user_estimated",
  captureEvidence?: Array<GnssCaptureEvidence | null>,
): ObstacleZone {
  const ring = validatedCapturedRing(vertices, captureEvidence, "Obstacle draft");
  const obstacleNumber = project.obstacles.length + 1;
  return {
    id: id ?? `${kind}-${obstacleNumber}`,
    name: name ?? `${titleCase(kind)} ${obstacleNumber}`,
    kind,
    polygon: ring.vertices,
    bufferMeters: 0,
    hardConflict: true,
    noSpray: true,
    confidence,
    vertexCaptureEvidence: ring.captureEvidence,
  };
}

function surveyObservationDataEqual(current: SurveyPoint, next: SurveyPoint): boolean {
  return projectDataKey({
    projected: current.projected,
    wgs84: current.wgs84,
    observedAt: current.observedAt,
    source: current.source,
    confidence: current.confidence,
    rtk: current.rtk,
    captureEvidence: current.captureEvidence,
  }) === projectDataKey({
    projected: next.projected,
    wgs84: next.wgs84,
    observedAt: next.observedAt,
    source: next.source,
    confidence: next.confidence,
    rtk: next.rtk,
    captureEvidence: next.captureEvidence,
  });
}

function replaceEvidence(
  evidence: Array<GnssCaptureEvidence | null> | undefined,
  index: number,
  value: GnssCaptureEvidence | null,
): Array<GnssCaptureEvidence | null> | undefined {
  return evidence?.map((entry, entryIndex) => entryIndex === index ? value : entry);
}

function removeEvidence(
  evidence: Array<GnssCaptureEvidence | null> | undefined,
  index: number,
): Array<GnssCaptureEvidence | null> | undefined {
  return evidence?.filter((_entry, entryIndex) => entryIndex !== index);
}

function insertEvidence(
  evidence: Array<GnssCaptureEvidence | null> | undefined,
  index: number,
  value: GnssCaptureEvidence | null,
): Array<GnssCaptureEvidence | null> | undefined {
  if (!evidence) return undefined;
  const next = [...evidence];
  next.splice(index, 0, value);
  return next;
}

function reconcileFeatureReplacement(current: ProjectMapFeature, next: ProjectMapFeature): ProjectMapFeature {
  return projectDataKey(current.geometry) === projectDataKey(next.geometry) ? next : { ...next, vertexCaptureEvidence: undefined };
}

function editableMapFeature(features: ProjectMapFeature[], id: string): ProjectMapFeature {
  const feature = features.find((candidate) => candidate.id === id);
  if (!feature) throw new Error(`Map feature ${id} was not found.`);
  if (feature.geometry.type !== "Polygon") return feature;
  const ring = normalizeCapturedRing(feature.geometry.vertices, feature.vertexCaptureEvidence, "Map feature polygon");
  return { ...feature, geometry: { ...feature.geometry, vertices: ring.vertices }, vertexCaptureEvidence: ring.captureEvidence };
}

function featureClosingVertex(features: ProjectMapFeature[], id: string, index: number): boolean {
  const geometry = features.find((feature) => feature.id === id)?.geometry;
  return geometry?.type === "Polygon" && isClosingVertex(geometry.vertices, index);
}

function isClosingVertex(vertices: XY[], index: number): boolean {
  return vertices.length > 1 && index === vertices.length - 1 && samePoint(vertices[0], vertices[index]);
}

function samePoint(left: XY, right: XY): boolean {
  return left.x === right.x && left.y === right.y;
}

function validatedCapturedRing(vertices: XY[], captureEvidence: Array<GnssCaptureEvidence | null> | undefined, label: string): {
  vertices: XY[];
  captureEvidence: Array<GnssCaptureEvidence | null> | undefined;
} {
  const ring = normalizeCapturedRing(vertices, captureEvidence, label);
  return { ...ring, vertices: validatedRing(ring.vertices, label, false) };
}

function normalizeCapturedRing(vertices: XY[], captureEvidence: Array<GnssCaptureEvidence | null> | undefined, label: string): {
  vertices: XY[];
  captureEvidence: Array<GnssCaptureEvidence | null> | undefined;
} {
  if (captureEvidence && captureEvidence.length !== vertices.length) throw new Error(`${label} capture evidence must align with vertices.`);
  const ring = removeClosingDuplicate(vertices);
  if (captureEvidence && ring.length !== vertices.length) {
    const first = captureEvidence[0];
    const closing = captureEvidence[captureEvidence.length - 1];
    if (first && closing && projectDataKey(first) !== projectDataKey(closing)) {
      throw new Error(`${label} closing vertex has different GNSS evidence; choose one observation before committing.`);
    }
    captureEvidence = [first ?? closing, ...captureEvidence.slice(1, -1)];
  }
  return { vertices: ring, captureEvidence };
}

function validatedRing(vertices: XY[], label: string, allowClosingDuplicate = true): XY[] {
  const ring = allowClosingDuplicate ? removeClosingDuplicate(vertices) : vertices;
  if (ring.length < 3) throw new Error(`${label} needs at least three vertices before commit.`);
  if (ring.some((vertex) => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y))) {
    throw new Error(`${label} contains a non-finite coordinate.`);
  }
  assertNoDuplicateVertices(ring, label);
  if (Math.abs(signedArea(ring)) < 0.000001) {
    throw new Error(`${label} has degenerate area.`);
  }
  if (hasSelfIntersection(ring)) {
    throw new Error(`${label} must not self-intersect.`);
  }
  return ring;
}

function validatedLineString(vertices: XY[], label: string): XY[] {
  if (vertices.length < 2) throw new Error(`${label} needs at least two vertices before commit.`);
  vertices.forEach((vertex) => assertFinitePoint(vertex, label));
  return vertices;
}

function assertFinitePoint(point: XY, label: string): XY {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} contains a non-finite coordinate.`);
  }
  return point;
}

function removeClosingDuplicate(vertices: XY[]): XY[] {
  if (vertices.length < 2) return vertices;
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  return first.x === last.x && first.y === last.y ? vertices.slice(0, -1) : vertices;
}

function assertNoDuplicateVertices(ring: XY[], label: string): void {
  const seen = new Set<string>();
  for (const vertex of ring) {
    const key = `${vertex.x},${vertex.y}`;
    if (seen.has(key)) throw new Error(`${label} contains duplicate vertices.`);
    seen.add(key);
  }
}

function signedArea(ring: XY[]): number {
  return ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return area + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function hasSelfIntersection(ring: XY[]): boolean {
  for (let leftIndex = 0; leftIndex < ring.length; leftIndex += 1) {
    const leftStart = ring[leftIndex];
    const leftEnd = ring[(leftIndex + 1) % ring.length];
    for (let rightIndex = leftIndex + 1; rightIndex < ring.length; rightIndex += 1) {
      if (Math.abs(leftIndex - rightIndex) <= 1) continue;
      if (leftIndex === 0 && rightIndex === ring.length - 1) continue;
      const rightStart = ring[rightIndex];
      const rightEnd = ring[(rightIndex + 1) % ring.length];
      if (segmentsIntersect(leftStart, leftEnd, rightStart, rightEnd)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: XY, b: XY, c: XY, d: XY): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC === 0 && pointOnSegment(c, a, b)) return true;
  if (abD === 0 && pointOnSegment(d, a, b)) return true;
  if (cdA === 0 && pointOnSegment(a, c, d)) return true;
  if (cdB === 0 && pointOnSegment(b, c, d)) return true;
  return abC !== abD && cdA !== cdB;
}

function orientation(a: XY, b: XY, c: XY): -1 | 0 | 1 {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 0.000001) return 0;
  return value > 0 ? 1 : -1;
}

function assertPointInsideRing(point: XY, ring: XY[], label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`${label} contains a non-finite coordinate.`);
  }
  if (!pointInRing(point, ring)) {
    throw new Error(`${label} must be inside the field boundary.`);
  }
}

function pointInRing(point: XY, ring: XY[]): boolean {
  if (ring.some((vertex) => distance(vertex, point) < 0.000001)) return true;
  let inside = false;
  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    if (pointOnSegment(point, previous, current)) return true;
    const intersects = ((current.y > point.y) !== (previous.y > point.y))
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointOnSegment(point: XY, start: XY, end: XY): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 0.000001) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  if (dot < 0) return false;
  const segmentLengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= segmentLengthSquared;
}

function distance(left: XY, right: XY): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b[a-z]/g, (match) => match.toUpperCase());
}
