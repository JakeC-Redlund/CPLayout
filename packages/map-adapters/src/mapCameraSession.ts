import type { MapViewport } from "@cplayout/geometry";

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

function sameProjectIdentity(a: MapCameraFrameIdentity, b: MapCameraFrameIdentity): boolean {
  return a.projectId === b.projectId
    && a.projectCrs === b.projectCrs
    && Object.is(a.projectGeneration, b.projectGeneration)
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
  return createViewSession(copyView, view => [...view.center, view.zoom, view.bearing, view.pitch].every(Number.isFinite));
}

export interface SvgMapCameraView {
  viewport: MapViewport;
  selectedMapFeatureId: string | null;
}

export function createSvgMapCameraSession() {
  return createViewSession<SvgMapCameraView>(view => ({ viewport: { ...view.viewport, center: { ...view.viewport.center } }, selectedMapFeatureId: view.selectedMapFeatureId }),
    view => [view.viewport.center.x, view.viewport.center.y, view.viewport.baseWidthMeters, view.viewport.baseHeightMeters, view.viewport.zoomLevel].every(Number.isFinite)
      && view.viewport.baseWidthMeters > 0 && view.viewport.baseHeightMeters > 0 && view.viewport.zoomLevel > 0);
}

/** Catalog and design retain separate views; tokens still belong to one uninterrupted active view. */
function createViewSession<T>(copy: (view: T) => T, valid: (view: T) => boolean) {
  let identity: MapCameraFrameIdentity | null = null;
  let current: MapCameraFrame | null = null;
  let designView: T | null = null;
  let homeView: T | null = null;

  return {
    useFrame(next: MapCameraFrameIdentity): MapCameraFrame {
      const changedProject = identity === null || !sameProjectIdentity(identity, next);
      if (changedProject) { designView = null; homeView = null; }
      if (current === null || changedProject || identity?.homeView !== next.homeView) {
        identity = { ...next };
        current = Symbol("MapCameraFrame") as MapCameraFrame;
      }
      return current;
    },
    isCurrent(frame: MapCameraFrame): boolean {
      return current !== null && frame === current;
    },
    remember(frame: MapCameraFrame, view: T): boolean {
      if (current === null || frame !== current) return false;
      const snapshot = copy(view);
      if (!valid(snapshot)) {
        return false;
      }
      if (identity?.homeView) homeView = snapshot;
      else designView = snapshot;
      return true;
    },
    restore(frame: MapCameraFrame): T | null {
      const remembered = identity?.homeView ? homeView : designView;
      return current !== null && frame === current && remembered !== null
        ? copy(remembered)
        : null;
    },
  };
}
