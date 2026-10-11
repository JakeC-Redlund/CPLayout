import type { MapCameraView } from "./mapCameraSession";
import type { MapScreenSize } from "./mapFit";

export const INITIAL_MAP_CAMERA_PADDING = 48;

export function hasVisibleMapSize(size: MapScreenSize): boolean {
  return Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0;
}

/** One renderer instance admits its camera only after a successful visible fit or restoration. */
export function createInitialMapCameraAdmission(restoring: boolean, ownsCamera: () => boolean = () => true) {
  let phase: "waiting" | "fitting" | "ready" = "waiting";
  return {
    isReady: () => phase === "ready",
    canUseCamera: () => phase === "ready" && ownsCamera(),
    initialize(size: MapScreenSize, apply: (padding: number) => MapCameraView | null): MapCameraView | null {
      if (phase !== "waiting" || !ownsCamera() || !hasVisibleMapSize(size)) return null;
      // A fit needs positive space inside both padding edges. Do not accept the
      // constructor's fallback canvas dimensions when the actual container is hidden.
      if (!restoring && (size.width <= INITIAL_MAP_CAMERA_PADDING * 2 || size.height <= INITIAL_MAP_CAMERA_PADDING * 2)) return null;
      phase = "fitting";
      try {
        const view = apply(INITIAL_MAP_CAMERA_PADDING);
        if (!ownsCamera() || !view || ![...view.center, view.zoom, view.bearing, view.pitch].every(Number.isFinite)) return null;
        phase = "ready";
        return { ...view, center: [...view.center] };
      } finally {
        if (phase === "fitting") phase = "waiting";
      }
    },
  };
}
