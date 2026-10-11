import type { ReactNode } from "react";
import type { AppSettings } from "../../core/src/settings";
import type { LonLat, XY } from "../../core/src/types";
import type { MapViewport } from "../../geometry/src/mapInteraction";
import type { MapScreenSize } from "./mapFit";
import type { WorkspaceMapScene, WorkspaceSceneLayer } from "./workspaceMapScene";
import type { WorkspaceCameraRecoveryHandle } from "./useWorkspaceMapCamera";
export type { WorkspaceCameraRecoveryEntry, WorkspaceCameraRecoveryPlan, WorkspaceCameraRecoveryHandle } from "./useWorkspaceMapCamera";

export interface WorkspaceMapInteractionOwner { readonly cameraContextKey: string; readonly interactionKey: string }
export interface WorkspaceMapPointEvent extends WorkspaceMapInteractionOwner { readonly point: Readonly<XY>; readonly wgs84?: Readonly<LonLat> }
export interface WorkspaceMapSelectionEvent extends WorkspaceMapInteractionOwner { readonly address: string | null }
export interface WorkspaceMapSurfaceProps extends WorkspaceMapInteractionOwner {
  readonly scene: WorkspaceMapScene;
  readonly selectedAddress?: string | null;
  readonly layerVisibility?: Readonly<Partial<Record<WorkspaceSceneLayer, boolean>>>;
  readonly settings: AppSettings;
  readonly pointInputEnabled?: boolean;
  readonly selectionEnabled?: boolean;
  readonly onPoint?: (event: WorkspaceMapPointEvent) => void;
  readonly onSelect?: (event: WorkspaceMapSelectionEvent) => void;
  readonly onCameraChange?: (viewport: MapViewport) => void;
  readonly onRecoveryCameraHandle?: (handle: WorkspaceCameraRecoveryHandle | null) => void;
}
export interface WorkspaceCanvasProps extends WorkspaceMapSurfaceProps {
  readonly viewport: MapViewport;
  readonly screen: MapScreenSize;
  readonly setViewport: (viewport: MapViewport) => void;
  readonly onReadout: (point: XY | null) => void;
  readonly cameraCommandGeneration: number;
}
export interface WorkspaceMapFrameProps extends WorkspaceMapSurfaceProps {
  readonly renderCanvas: (props: WorkspaceCanvasProps) => ReactNode;
}
