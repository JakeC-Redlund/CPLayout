import React from "react";
import { WorkspaceMapFrame } from "./WorkspaceMapFrame";
import { WorkspaceSvgCanvas } from "./WorkspaceSvgCanvas";
import type { WorkspaceMapSurfaceProps } from "./workspaceMapSurfaceTypes";

/** Native projected SVG lane. MapLibre/device behavior requires separate runtime proof. */
export function WorkspaceMapSurface(props: WorkspaceMapSurfaceProps): React.JSX.Element {
  return <WorkspaceMapFrame {...props} renderCanvas={canvas => <WorkspaceSvgCanvas {...canvas} reason="Projected field map. Background imagery is unavailable in this view." />} />;
}
