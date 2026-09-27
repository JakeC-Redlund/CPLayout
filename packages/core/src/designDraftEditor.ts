import { DESIGN_DRAFT_DOCUMENT_VERSION, parseDesignDraftDocument, type DesignDraft, type DesignDraftMachine } from "./designDraft";
import { projectDataKey } from "./projectDataComparison";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import type { ProjectSettings } from "./settings";
import type { ObstacleZone, ProjectMapFeature, ProjectMapFeatureGeometry, XY } from "./types";

export interface DesignDraftEditorState {
  draft: DesignDraft;
  past: DesignDraft[];
  future: DesignDraft[];
  revision: number;
  lastError: string | null;
  /** Session guard survives clearing coordinates and undo; this is not a persisted CRS migration. */
  lockedCrs: string | null;
}

type InfrastructureRole = "pivot_center" | "water_source" | "power_source";
type ManualFeature = Omit<ProjectMapFeature, "confidence" | "vertexCaptureEvidence">;
type ManualObstacle = Omit<ObstacleZone, "confidence" | "vertexCaptureEvidence">;

export type DesignDraftEditorAction =
  | { type: "rename"; name: string }
  | { type: "set_crs"; projectCrs: string | null }
  | { type: "replace_boundary"; vertices: XY[] }
  | { type: "insert_boundary_vertex"; index: number; point: XY }
  | { type: "move_boundary_vertex"; index: number; point: XY }
  | { type: "delete_boundary_vertex"; index: number }
  | { type: "set_infrastructure"; role: InfrastructureRole; point: XY | null }
  | { type: "set_machine"; machine: DesignDraftMachine }
  | { type: "set_settings"; settings: ProjectSettings }
  | { type: "add_manual_feature"; feature: ManualFeature }
  | { type: "set_feature_geometry"; id: string; geometry: ProjectMapFeatureGeometry }
  | { type: "delete_feature"; id: string }
  | { type: "add_manual_obstacle"; obstacle: ManualObstacle }
  | { type: "set_obstacle_polygon"; id: string; vertices: XY[] }
  | { type: "delete_obstacle"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear_error" };

export function createDesignDraftEditorState(draft: DesignDraft): DesignDraftEditorState {
  const detached = snapshot(draft);
  return { draft: detached, past: [], future: [], revision: 0, lastError: null,
    lockedCrs: hasCoordinates(detached) ? detached.projectCrs : null };
}

/** Manual editing only. Receiver admission, persistence receipts and editor generations are separate contracts. */
export function reduceDesignDraftEditorState(state: DesignDraftEditorState, inputAction: DesignDraftEditorAction): DesignDraftEditorState {
  try {
    const action = snapshotJsonValue(inputAction, "action") as DesignDraftEditorAction;
    if (action.type === "clear_error") return { ...state, lastError: null };
    if (action.type === "undo" || action.type === "redo") return travel(state, action.type);
    const next = snapshot(state.draft);
    let geometryChanged = false;
    switch (action.type) {
      case "rename": next.name = action.name; break;
      case "set_crs":
        if (action.projectCrs === next.projectCrs) break;
        if ((state.lockedCrs !== null && action.projectCrs !== state.lockedCrs) || hasCoordinates(next)) {
          throw new Error("Existing XY cannot be relabeled. Use an explicit coordinate migration instead.");
        }
        next.projectCrs = action.projectCrs;
        geometryChanged = true;
        break;
      case "replace_boundary":
        if (equal(next.fieldBoundary, action.vertices)) break;
        next.fieldBoundary = action.vertices;
        delete next.fieldBoundaryCaptureEvidence;
        geometryChanged = true;
        break;
      case "insert_boundary_vertex":
      case "move_boundary_vertex":
      case "delete_boundary_vertex": {
        const inserting = action.type === "insert_boundary_vertex";
        assertIndex(action.index, next.fieldBoundary.length, inserting);
        if (action.type === "move_boundary_vertex" && equal(next.fieldBoundary[action.index], action.point)) break;
        if (inserting) {
          next.fieldBoundary.splice(action.index, 0, action.point);
          next.fieldBoundaryCaptureEvidence?.splice(action.index, 0, null);
        } else if (action.type === "delete_boundary_vertex") {
          next.fieldBoundary.splice(action.index, 1);
          next.fieldBoundaryCaptureEvidence?.splice(action.index, 1);
        } else {
          next.fieldBoundary[action.index] = action.point;
          if (next.fieldBoundaryCaptureEvidence) next.fieldBoundaryCaptureEvidence[action.index] = null;
        }
        geometryChanged = true;
        break;
      }
      case "set_infrastructure": {
        const key = infrastructureKey(action.role);
        if (equal(next[key], action.point)) break;
        next[key] = action.point;
        if (next.infrastructureObservationRefs) delete next.infrastructureObservationRefs[action.role];
        geometryChanged = true;
        break;
      }
      case "set_machine": next.machine = action.machine; break;
      case "set_settings":
        next.settings = action.settings;
        next.unitSystem = action.settings.unitSystem;
        break;
      case "add_manual_feature": {
        if (next.mapFeatures?.some((item) => item.id === action.feature.id)) throw new Error("Map feature identity already exists.");
        // Refuse evidence injection, even from callers bypassing the static action type.
        if (Object.hasOwn(action.feature, "confidence") || Object.hasOwn(action.feature, "vertexCaptureEvidence")) {
          throw new Error("Manual feature actions cannot supply capture confidence or evidence.");
        }
        next.mapFeatures = [...(next.mapFeatures ?? []), { ...action.feature, confidence: "user_estimated" }];
        geometryChanged = true;
        break;
      }
      case "set_feature_geometry": {
        const feature = next.mapFeatures?.find((item) => item.id === action.id);
        if (!feature) throw new Error("Map feature was not found.");
        if (equal(feature.geometry, action.geometry)) break;
        feature.geometry = action.geometry;
        feature.confidence = "user_estimated";
        delete feature.vertexCaptureEvidence;
        geometryChanged = true;
        break;
      }
      case "delete_feature":
        if (!next.mapFeatures?.some((item) => item.id === action.id)) throw new Error("Map feature was not found.");
        next.mapFeatures = next.mapFeatures.filter((item) => item.id !== action.id);
        geometryChanged = true;
        break;
      case "add_manual_obstacle":
        if (next.obstacles.some((item) => item.id === action.obstacle.id)) throw new Error("Obstacle identity already exists.");
        if (Object.hasOwn(action.obstacle, "confidence") || Object.hasOwn(action.obstacle, "vertexCaptureEvidence")) {
          throw new Error("Manual obstacle actions cannot supply capture confidence or evidence.");
        }
        next.obstacles.push({ ...action.obstacle, confidence: "user_estimated" });
        geometryChanged = true;
        break;
      case "set_obstacle_polygon": {
        const obstacle = next.obstacles.find((item) => item.id === action.id);
        if (!obstacle) throw new Error("Obstacle was not found.");
        if (equal(obstacle.polygon, action.vertices)) break;
        obstacle.polygon = action.vertices;
        obstacle.confidence = "user_estimated";
        delete obstacle.vertexCaptureEvidence;
        geometryChanged = true;
        break;
      }
      case "delete_obstacle":
        if (!next.obstacles.some((item) => item.id === action.id)) throw new Error("Obstacle was not found.");
        next.obstacles = next.obstacles.filter((item) => item.id !== action.id);
        geometryChanged = true;
        break;
      default: {
        const unsupported: never = action;
        throw new Error(`Unsupported draft editor action: ${String(unsupported)}`);
      }
    }
    if (geometryChanged) delete next.wgs84Companion;
    const detached = snapshot(next);
    if (hasCoordinates(detached) && state.lockedCrs !== null && detached.projectCrs !== state.lockedCrs) {
      throw new Error("Restore the session's original CRS before adding coordinates to an earlier empty snapshot.");
    }
    if (equal(detached, state.draft)) return state.lastError ? { ...state, lastError: null } : state;
    return {
      draft: detached, past: [...state.past, state.draft], future: [],
      revision: nextRevision(state.revision), lastError: null,
      lockedCrs: state.lockedCrs ?? (hasCoordinates(detached) ? detached.projectCrs : null),
    };
  } catch (error) {
    return { ...state, lastError: error instanceof Error ? error.message : "Draft edit was rejected." };
  }
}

function travel(state: DesignDraftEditorState, direction: "undo" | "redo"): DesignDraftEditorState {
  const candidate = direction === "undo" ? state.past.at(-1) : state.future[0];
  if (!candidate) return state;
  const draft = snapshot(candidate);
  return {
    ...state, draft, lastError: null, revision: nextRevision(state.revision),
    past: direction === "undo" ? state.past.slice(0, -1) : [...state.past, state.draft],
    future: direction === "undo" ? [state.draft, ...state.future] : state.future.slice(1),
  };
}

function snapshot(draft: DesignDraft): DesignDraft {
  return parseDesignDraftDocument({ documentVersion: DESIGN_DRAFT_DOCUMENT_VERSION, draft });
}

function hasCoordinates(draft: DesignDraft): boolean {
  return draft.fieldBoundary.length > 0 || draft.pivotCenter !== null || draft.waterSource !== null
    || draft.powerSource !== null || draft.surveyPoints.length > 0 || draft.obstacles.length > 0
    || (draft.mapFeatures?.length ?? 0) > 0;
}

function equal(left: object | null, right: object | null): boolean {
  return left === null || right === null ? left === right : projectDataKey(left) === projectDataKey(right);
}

function nextRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) {
    throw new Error("Draft editor revision is exhausted or invalid; reopen explicitly before editing.");
  }
  return revision + 1;
}

function assertIndex(index: number, length: number, inserting: boolean): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= length + (inserting ? 1 : 0)) {
    throw new Error("Boundary vertex index is out of range.");
  }
}

function infrastructureKey(role: InfrastructureRole): "pivotCenter" | "waterSource" | "powerSource" {
  switch (role) {
    case "pivot_center": return "pivotCenter";
    case "water_source": return "waterSource";
    case "power_source": return "powerSource";
    default: throw new Error("Unknown infrastructure role.");
  }
}
