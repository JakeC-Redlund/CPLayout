export interface MapCameraView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface MapCameraFrameIdentity {
  projectId: string;
  projectCrs: string;
  projectGeneration: number;
  homeView: boolean;
  projectionAvailable: boolean;
}

declare const mapCameraFrameBrand: unique symbol;
export type MapCameraFrame = symbol & { readonly [mapCameraFrameBrand]: true };

function sameIdentity(a: MapCameraFrameIdentity, b: MapCameraFrameIdentity): boolean {
  return a.projectId === b.projectId
    && a.projectCrs === b.projectCrs
    && Object.is(a.projectGeneration, b.projectGeneration)
    && a.homeView === b.homeView
    && a.projectionAvailable === b.projectionAvailable;
}

function copyView(view: MapCameraView): MapCameraView {
  return {
    center: [view.center[0], view.center[1]],
    zoom: view.zoom,
    bearing: view.bearing,
    pitch: view.pitch,
  };
}

export function createMapCameraSession() {
  let identity: MapCameraFrameIdentity | null = null;
  let current: MapCameraFrame | null = null;
  let remembered: MapCameraView | null = null;

  return {
    useFrame(next: MapCameraFrameIdentity): MapCameraFrame {
      if (current === null || identity === null || !sameIdentity(identity, next)) {
        identity = { ...next };
        current = Symbol("MapCameraFrame") as MapCameraFrame;
        remembered = null;
      }
      return current;
    },
    isCurrent(frame: MapCameraFrame): boolean {
      return current !== null && frame === current;
    },
    remember(frame: MapCameraFrame, view: MapCameraView): boolean {
      if (current === null || frame !== current) return false;
      const snapshot = copyView(view);
      if (![...snapshot.center, snapshot.zoom, snapshot.bearing, snapshot.pitch].every(Number.isFinite)) {
        return false;
      }
      remembered = snapshot;
      return true;
    },
    restore(frame: MapCameraFrame): MapCameraView | null {
      return current !== null && frame === current && remembered !== null
        ? copyView(remembered)
        : null;
    },
  };
}
