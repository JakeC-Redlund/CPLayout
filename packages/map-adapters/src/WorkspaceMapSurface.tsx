import React from "react";
import { WorkspaceMapFrame } from "./WorkspaceMapFrame";
import { WorkspaceSvgCanvas } from "./WorkspaceSvgCanvas";
import type { WorkspaceMapSurfaceProps } from "./workspaceMapSurfaceTypes";

/** Generic projected fallback. Platform modules choose a renderer, never an operator mode. */
export function WorkspaceMapSurface(props: WorkspaceMapSurfaceProps): React.JSX.Element {
  return <WorkspaceMapFrame {...props} renderCanvas={canvas => <WorkspaceSvgCanvas {...canvas} reason="Projected XY view. Imagery is unavailable on this renderer." />} />;
}
