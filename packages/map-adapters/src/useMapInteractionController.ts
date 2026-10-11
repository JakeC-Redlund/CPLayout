import { useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { createMapInteractionController, type MapInteractionController, type MapInteractionMethods, type MapInteractionOptions, type MapInteractionSnapshot } from "./mapInteractionController";
import type { MapSurfaceProps } from "./types";

export function useMapInteractionController(
  props: MapSurfaceProps,
  options: MapInteractionOptions,
): MapInteractionSnapshot & MapInteractionMethods {
  const controllerRef = useRef<MapInteractionController | null>(null);
  if (!controllerRef.current) controllerRef.current = createMapInteractionController(props, options);
  const controller = controllerRef.current;
  // Refresh inputs synchronously so installed map listeners always use this render's callbacks and scope.
  controller.updateInputs(props, options, false);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useLayoutEffect(() => {
    const scope = { projectId: props.project.id, projectCrs: props.project.projectCrs, projectGeneration: props.projectGeneration ?? 0 };
    props.onUnfinishedDrawingChange?.(scope, snapshot.draftVertices.length > 0);
    return () => { props.onUnfinishedDrawingChange?.(scope, false); };
  }, [props.project.id, props.project.projectCrs, props.projectGeneration, props.onUnfinishedDrawingChange, snapshot.draftVertices]);
  return { ...snapshot, ...controller.methods };
}
