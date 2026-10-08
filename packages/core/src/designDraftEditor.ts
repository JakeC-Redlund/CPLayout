import { z } from "zod";
import { OPERATIONAL_DESIGN_DRAFT_DOCUMENT_VERSION, parseDesignDraftDocument, type DesignDraft, type DesignDraftMachine } from "./designDraft";
import { projectDataKey } from "./projectDataComparison";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { DRAFT_DRAWING_WORKFLOW_VERSION, createDraftDrawingWorkflow, reduceDraftDrawingWorkflow, type DraftDrawingCommand } from "./draftDrawingWorkflow";
import { prepareClassifiedDrawing, type DrawingClassification } from "./drawingClassification";
import { PROJECT_DRAWING_METADATA_VERSION, classifiedDrawingFeatureKind, drawingMetadataTargetKey, type DrawingMetadataTarget } from "./drawingMetadata";
import type { ProjectSettings } from "./settings";
import type { ObstacleZone, ProjectMapFeature, ProjectMapFeatureGeometry, XY } from "./types";

export interface DesignDraftEditorState {
  draft: DesignDraft;
  past: DesignDraft[];
  future: DesignDraft[];
  revision: number;
  lastError: string | null;
  /** Session guard; drawingWorkflow also retains its lock across save/reopen. */
  lockedCrs: string | null;
}

type InfrastructureRole = "pivot_center" | "water_source" | "power_source";
type ManualFeature = Omit<ProjectMapFeature, "confidence" | "vertexCaptureEvidence">;
type ManualObstacle = Omit<ObstacleZone, "confidence" | "vertexCaptureEvidence">;

export type DesignDraftEditorAction =
  | { type: "commit_classified_drawing"; expectedRevision: number; captureId: string; classification: DrawingClassification; entityId?: string; replaceExisting?: boolean }
  | { type: "drawing"; expectedRevision: number; command: DraftDrawingCommand }
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
    lockedCrs: detached.drawingWorkflow?.lockedCrs ?? (hasCoordinates(detached) ? detached.projectCrs : null) };
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
      case "commit_classified_drawing":
        commitClassifiedDrawing(next, action, state.revision);
        geometryChanged = true;
        break;
      case "drawing":
        if (action.expectedRevision !== state.revision) throw new Error("Drawing command is stale; use the current draft revision.");
        next.drawingWorkflow = reduceDraftDrawingWorkflow(next.drawingWorkflow ?? (next.drawingMetadata
          ? { ...createDraftDrawingWorkflow(), autosaveEnabled: next.drawingMetadata.autosaveEnabled } : undefined), next.projectCrs, action.command);
        if (next.drawingMetadata) next.drawingMetadata.autosaveEnabled = next.drawingWorkflow.autosaveEnabled;
        break;
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
        invalidateDrawingTimes(next, { kind: "field_boundary" }, action.vertices.length);
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
        const record = drawingRecord(next, { kind: "field_boundary" });
        if (record) {
          if (inserting) record.capture.vertexRecordedAt.splice(action.index, 0, null);
          else if (action.type === "delete_boundary_vertex") record.capture.vertexRecordedAt.splice(action.index, 1);
          else record.capture.vertexRecordedAt[action.index] = null;
        }
        geometryChanged = true;
        break;
      }
      case "set_infrastructure": {
        const key = infrastructureKey(action.role);
        if (equal(next[key], action.point)) break;
        next[key] = action.point;
        if (action.point === null) removeDrawingRecord(next, { kind: action.role });
        else invalidateDrawingTimes(next, { kind: action.role }, 1);
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
        invalidateDrawingTimes(next, { kind: "map_feature", id: action.id }, action.geometry.type === "Point" || action.geometry.type === "Circle" ? 1 : action.geometry.vertices.length);
        geometryChanged = true;
        break;
      }
      case "delete_feature":
        if (!next.mapFeatures?.some((item) => item.id === action.id)) throw new Error("Map feature was not found.");
        next.mapFeatures = next.mapFeatures.filter((item) => item.id !== action.id);
        removeDrawingRecord(next, { kind: "map_feature", id: action.id });
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
        invalidateDrawingTimes(next, { kind: "obstacle", id: action.id }, action.vertices.length);
        geometryChanged = true;
        break;
      }
      case "delete_obstacle":
        if (!next.obstacles.some((item) => item.id === action.id)) throw new Error("Obstacle was not found.");
        next.obstacles = next.obstacles.filter((item) => item.id !== action.id);
        removeDrawingRecord(next, { kind: "obstacle", id: action.id });
        geometryChanged = true;
        break;
      default: {
        const unsupported: never = action;
        throw new Error(`Unsupported draft editor action: ${String(unsupported)}`);
      }
    }
    if (geometryChanged) delete next.wgs84Companion;
    if (next.drawingWorkflow) {
      const lock = state.lockedCrs ?? next.drawingWorkflow.lockedCrs ?? (hasCoordinates(next) ? next.projectCrs : null);
      retainDrawingLock(next, lock);
    }
    const detached = snapshot(next);
    if (hasCoordinates(detached) && state.lockedCrs !== null && detached.projectCrs !== state.lockedCrs) {
      throw new Error("Restore the session's original CRS before adding coordinates to an earlier empty snapshot.");
    }
    if (equal(detached, state.draft)) return state.lastError ? { ...state, lastError: null } : state;
    return {
      draft: detached, past: [...state.past, state.draft], future: [],
      revision: nextRevision(state.revision), lastError: null,
      lockedCrs: state.lockedCrs ?? detached.drawingWorkflow?.lockedCrs ?? (hasCoordinates(detached) ? detached.projectCrs : null),
    };
  } catch (error) {
    return { ...state, lastError: error instanceof Error ? error.message : "Draft edit was rejected." };
  }
}

function travel(state: DesignDraftEditorState, direction: "undo" | "redo"): DesignDraftEditorState {
  const candidate = direction === "undo" ? state.past.at(-1) : state.future[0];
  if (!candidate) return state;
  const retained = snapshotJsonValue(candidate) as DesignDraft;
  retainDrawingLock(retained, state.draft.drawingWorkflow?.lockedCrs ?? null);
  const draft = snapshot(retained);
  return {
    ...state, draft, lastError: null, revision: nextRevision(state.revision),
    past: direction === "undo" ? state.past.slice(0, -1) : [...state.past, state.draft],
    future: direction === "undo" ? [state.draft, ...state.future] : state.future.slice(1),
  };
}

function snapshot(draft: DesignDraft): DesignDraft {
  return parseDesignDraftDocument({ documentVersion: OPERATIONAL_DESIGN_DRAFT_DOCUMENT_VERSION, draft });
}

function hasCoordinates(draft: DesignDraft): boolean {
  return draft.fieldBoundary.length > 0 || draft.pivotCenter !== null || draft.waterSource !== null
    || draft.powerSource !== null || draft.surveyPoints.length > 0 || draft.obstacles.length > 0
    || (draft.mapFeatures?.length ?? 0) > 0
    || (draft.drawingWorkflow?.captures.some(capture => capture.vertices.length > 0) ?? false);
}

// Undo may remove geometry, but cannot erase a coordinate frame already used by this workflow.
function retainDrawingLock(draft: DesignDraft, lockedCrs: string | null): void {
  if (lockedCrs === null) return;
  if (draft.projectCrs !== lockedCrs) throw new Error("Undo cannot restore a different CRS after drawing coordinates were captured.");
  draft.drawingWorkflow ??= {
    schemaVersion: DRAFT_DRAWING_WORKFLOW_VERSION, autosaveEnabled: draft.drawingMetadata?.autosaveEnabled ?? true,
    activeCaptureId: null, captures: [], lockedCrs,
  };
  draft.drawingWorkflow.lockedCrs = lockedCrs;
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

const CommitClassifiedDrawingSchema = z.object({
  type: z.literal("commit_classified_drawing"), expectedRevision: z.number().int().nonnegative(),
  captureId: z.string().min(1), classification: z.unknown(), entityId: z.string().min(1).optional(),
  replaceExisting: z.boolean().optional(),
}).strict();

function commitClassifiedDrawing(draft: DesignDraft, input: Extract<DesignDraftEditorAction, { type: "commit_classified_drawing" }>, revision: number): void {
  const action = CommitClassifiedDrawingSchema.parse(input);
  if (!draft.drawingWorkflow || draft.projectCrs === null) throw new Error("No drawing workflow is available to commit.");
  const prepared = prepareClassifiedDrawing({ workflow: draft.drawingWorkflow, projectCrs: draft.projectCrs,
    captureId: action.captureId, editorRevision: revision, expectedEditorRevision: action.expectedRevision,
    classification: action.classification as DrawingClassification });
  if (draft.drawingMetadata?.records.some(record => record.capture.captureId === action.captureId)) {
    throw new Error("This capture identity already belongs to committed geometry.");
  }
  let target: DrawingMetadataTarget;
  const geometry = prepared.geometry;
  const classification = prepared.classification;
  if (prepared.destination === "feature" || prepared.destination === "obstacle") {
    if (action.entityId === undefined) throw new Error("Choose a new identity for the classified geometry.");
    if (action.replaceExisting) throw new Error("Classification cannot replace a separate feature or obstacle.");
    if ((draft.mapFeatures ?? []).some(item => item.id === action.entityId) || draft.obstacles.some(item => item.id === action.entityId)) {
      throw new Error("Classified geometry identity already exists.");
    }
    if (prepared.destination === "feature") {
      target = { kind: "map_feature", id: action.entityId };
      draft.mapFeatures = [...(draft.mapFeatures ?? []), {
        id: action.entityId, name: classification.name, notes: classification.notes,
        kind: classifiedDrawingFeatureKind(classification), geometry, confidence: "user_estimated",
      }];
    } else {
      if (geometry.type !== "Polygon" || classification.effect.mode !== "exclusion") throw new Error("Exclusions require a polygon and explicit effects.");
      target = { kind: "obstacle", id: action.entityId };
      draft.obstacles.push({ id: action.entityId, name: classification.name, kind: "exclusion", polygon: geometry.vertices,
        confidence: "user_estimated", noSpray: classification.effect.noSpray, hardConflict: classification.effect.hardConflict,
        bufferMeters: classification.effect.bufferMeters });
    }
  } else {
    if (action.entityId !== undefined) throw new Error("Operational geometry uses its canonical target, not a duplicate entity identity.");
    target = { kind: prepared.destination };
    if (prepared.destination === "field_boundary") {
      if (geometry.type !== "Polygon") throw new Error("Field boundary requires a polygon.");
      if (draft.fieldBoundary.length > 0 && action.replaceExisting !== true) throw new Error("Explicitly confirm replacing the existing field boundary.");
      draft.fieldBoundary = geometry.vertices;
      delete draft.fieldBoundaryCaptureEvidence;
    } else {
      if (geometry.type !== "Point") throw new Error("Infrastructure requires a point.");
      const key = infrastructureKey(prepared.destination);
      if (draft[key] !== null && action.replaceExisting !== true) throw new Error("Explicitly confirm replacing the existing design point.");
      draft[key] = geometry.point;
      if (draft.infrastructureObservationRefs) delete draft.infrastructureObservationRefs[prepared.destination];
    }
  }
  draft.drawingMetadata ??= { schemaVersion: PROJECT_DRAWING_METADATA_VERSION,
    autosaveEnabled: draft.drawingWorkflow.autosaveEnabled, records: [] };
  removeDrawingRecord(draft, target);
  draft.drawingMetadata.records.push({ target, classification, capture: {
    captureId: action.captureId, source: "map_digitized", vertexRecordedAt: prepared.vertices.map(vertex => vertex.recordedAt),
    wgs84: null, elevation: null,
  } });
  draft.drawingWorkflow = reduceDraftDrawingWorkflow(draft.drawingWorkflow, draft.projectCrs, { type: "discard", id: action.captureId });
}

function drawingRecord(draft: DesignDraft, target: DrawingMetadataTarget) {
  const key = drawingMetadataTargetKey(target);
  return draft.drawingMetadata?.records.find(record => drawingMetadataTargetKey(record.target) === key);
}
function removeDrawingRecord(draft: DesignDraft, target: DrawingMetadataTarget): void {
  const key = drawingMetadataTargetKey(target);
  if (draft.drawingMetadata) draft.drawingMetadata.records = draft.drawingMetadata.records.filter(record => drawingMetadataTargetKey(record.target) !== key);
}
function invalidateDrawingTimes(draft: DesignDraft, target: DrawingMetadataTarget, count: number): void {
  const record = drawingRecord(draft, target);
  if (record) record.capture.vertexRecordedAt = Array.from({ length: count }, () => null);
}
