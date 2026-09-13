import type { ReactNode } from "react";
import type { AppSettings, InfrastructurePoint, LayoutResult, LonLat, ManualDesignRadiusRole, MappingWorkflowMode, ObstacleZone, PivotProject, ProjectMapFeature, ProjectMapFeatureKind, SourceConfidence, SurveyPoint, XY } from "@cplayout/core";
import type { AdvisoryFieldPivotPlan, AdvisoryMachineRenderModel, DrawingLayerType, DrawingMode } from "@cplayout/geometry";
import type { PendingMapFeatureDraft, UtilityFeatureGeometry } from "./mapTools";

export interface MapSurfaceProps {
  project: PivotProject;
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
  onMoveBoundaryVertex?: (vertexIndex: number, point: XY) => void;
  onInsertBoundaryVertex?: (afterVertexIndex: number, point: XY) => void;
  onDeleteBoundaryVertex?: (vertexIndex: number) => void;
  onMoveObstacleVertex?: (obstacleId: string, vertexIndex: number, point: XY) => void;
  onInsertObstacleVertex?: (obstacleId: string, afterVertexIndex: number, point: XY) => void;
  onDeleteObstacleVertex?: (obstacleId: string, vertexIndex: number) => void;
  onMoveMapFeatureVertex?: (featureId: string, vertexIndex: number, point: XY) => void;
  onInsertMapFeatureVertex?: (featureId: string, afterVertexIndex: number, point: XY) => void;
  onDeleteMapFeatureVertex?: (featureId: string, vertexIndex: number) => void;
  onMoveMapFeatureCircleRadiusHandle?: (featureId: string, point: XY) => void;
  onPlacePivot?: (point: XY, wgs84?: LonLat) => void;
  onMoveInfrastructurePoint?: (pointType: InfrastructurePoint, point: XY, wgs84?: LonLat) => void;
  onAddSurveyPoint?: (point: Omit<SurveyPoint, "id" | "observedAt"> & { id?: string; observedAt?: string }) => void;
  onAddMapFeature?: (feature: Omit<ProjectMapFeature, "id"> & { id?: string }) => void;
  onCreateMapFeatureDraft?: (draft: PendingMapFeatureDraft) => void;
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
