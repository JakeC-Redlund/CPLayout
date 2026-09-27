import type { ReactNode } from "react";
import type { AppSettings, InfrastructurePoint, LayoutResult, LonLat, ManualDesignRadiusRole, MappingWorkflowMode, ObstacleZone, PivotProject, ProjectMapFeature, ProjectMapFeatureKind, SourceConfidence, SurveyPoint, XY } from "@cplayout/core";
import type { AdvisoryFieldPivotPlan, AdvisoryMachineRenderModel, DrawingLayerType, DrawingMode } from "@cplayout/geometry";
import type { PendingMapFeatureDraft, UtilityFeatureGeometry } from "./mapTools";
import type { ProjectMutationResult } from "@cplayout/core";

export type MapMutationOutcome = ProjectMutationResult | boolean | void;

export interface MapDraftOwner {
  projectId: string;
  projectCrs: string;
  projectGeneration: number;
  draftId: number;
}

export type MapDraftHandoffResult = { ok: true; owner: MapDraftOwner } | { ok: false; error: string };

export interface MapDraftPurposeReceipt {
  owner: MapDraftOwner;
  sequence: number;
  outcome: "committed" | "rejected" | "cancelled";
  message: string;
}

export interface MapSurfaceProps {
  project: PivotProject;
  projectGeneration?: number;
  draftPurposeReceipt?: MapDraftPurposeReceipt | null;
  result: LayoutResult;
  settings: AppSettings;
  activeToolMode?: DrawingMode;
  activeLayer?: DrawingLayerType;
  activeMapFeatureKind?: ProjectMapFeatureKind;
  activeDraftGeometry?: UtilityFeatureGeometry;
  activeToolRequestId?: number;
  advisoryFieldPivotPlan?: AdvisoryFieldPivotPlan;
  advisoryMachineRenderModel?: AdvisoryMachineRenderModel;
  bottomOverlay?: ReactNode;
  controlLayout?: "internalRows" | "externalHud";
  draftVertices?: XY[];
  homeView?: boolean;
  selectedMapFeatureId?: string | null;
  manualDesignCaptureRequest?: ManualDesignMapCaptureRequest | null;
  onSettingsChange?: (settings: AppSettings) => void;
  onMappingWorkflowModeChange?: (mode: MappingWorkflowMode) => void;
  onCommitBoundaryDraft?: (vertices: XY[]) => boolean | void;
  onCommitObstacleDraft?: (vertices: XY[], kind: ObstacleZone["kind"], confidence?: SourceConfidence) => boolean | void;
  onMoveBoundaryVertex?: (vertexIndex: number, point: XY) => MapMutationOutcome;
  onInsertBoundaryVertex?: (afterVertexIndex: number, point: XY) => MapMutationOutcome;
  onDeleteBoundaryVertex?: (vertexIndex: number) => MapMutationOutcome;
  onMoveObstacleVertex?: (obstacleId: string, vertexIndex: number, point: XY) => MapMutationOutcome;
  onInsertObstacleVertex?: (obstacleId: string, afterVertexIndex: number, point: XY) => MapMutationOutcome;
  onDeleteObstacleVertex?: (obstacleId: string, vertexIndex: number) => MapMutationOutcome;
  onMoveMapFeatureVertex?: (featureId: string, vertexIndex: number, point: XY) => MapMutationOutcome;
  onInsertMapFeatureVertex?: (featureId: string, afterVertexIndex: number, point: XY) => MapMutationOutcome;
  onDeleteMapFeatureVertex?: (featureId: string, vertexIndex: number) => MapMutationOutcome;
  onMoveMapFeatureCircleRadiusHandle?: (featureId: string, point: XY) => MapMutationOutcome;
  onPlacePivot?: (point: XY, wgs84?: LonLat) => MapMutationOutcome;
  onMoveInfrastructurePoint?: (pointType: InfrastructurePoint, point: XY, wgs84?: LonLat) => MapMutationOutcome;
  onAddSurveyPoint?: (point: Omit<SurveyPoint, "id" | "observedAt"> & { id?: string; observedAt?: string }) => MapMutationOutcome;
  onAddMapFeature?: (feature: Omit<ProjectMapFeature, "id"> & { id?: string }) => void;
  onCreateMapFeatureDraft?: (draft: PendingMapFeatureDraft) => MapDraftHandoffResult | void;
  onSelectMapFeature?: (featureId: string | null) => void;
  onManualDesignCapture?: (capture: ManualDesignMapCapture) => void;
}

export type ManualDesignMapCaptureRole = "boundary" | "pivot" | ManualDesignRadiusRole;

export interface ManualDesignMapCaptureRequest {
  requestId: number;
  role: ManualDesignMapCaptureRole;
}

export interface ManualDesignMapCapture extends ManualDesignMapCaptureRequest {
  point?: XY;
  vertices?: XY[];
  wgs84?: LonLat;
}
