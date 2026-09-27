import type { XY } from "@cplayout/core";
import type { MapViewport } from "@cplayout/geometry";

export interface MapScreenSize {
  width: number;
  height: number;
}

export interface MapScreenInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapFitBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validScreen(screen: MapScreenSize): boolean {
  return positiveFinite(screen.width) && positiveFinite(screen.height);
}

function validViewport(viewport: MapViewport): boolean {
  const { center, baseWidthMeters, baseHeightMeters, zoomLevel } = viewport;
  if (![center.x, center.y].every(Number.isFinite)
    || ![baseWidthMeters, baseHeightMeters, zoomLevel].every(positiveFinite)) return false;
  const width = baseWidthMeters / zoomLevel;
  const height = baseHeightMeters / zoomLevel;
  return positiveFinite(width) && positiveFinite(height)
    && [center.x - width / 2, center.x + width / 2, center.y - height / 2, center.y + height / 2]
      .every(Number.isFinite);
}

export function finitePointBounds(points: readonly XY[]): MapFitBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function fitProjectedBounds(
  bounds: MapFitBounds,
  screen: MapScreenSize,
  insets: MapScreenInsets,
  margin = 24,
): MapViewport | null {
  const { minX, minY, maxX, maxY } = bounds;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)
    || minX > maxX || minY > maxY || !validScreen(screen)
    || ![insets.top, insets.right, insets.bottom, insets.left, margin]
      .every(value => Number.isFinite(value) && value >= 0)) return null;
  const availableWidth = screen.width - insets.left - insets.right - 2 * margin;
  const availableHeight = screen.height - insets.top - insets.bottom - 2 * margin;
  if (!positiveFinite(availableWidth) || !positiveFinite(availableHeight)) return null;

  // The one-metre floor is display framing only; supplied geometry is never changed.
  const metresPerPixel = Math.max(
    Math.max(maxX - minX, 1) / availableWidth,
    Math.max(maxY - minY, 1) / availableHeight,
  );
  if (!positiveFinite(metresPerPixel)) return null;
  const viewport: MapViewport = {
    center: {
      x: minX / 2 + maxX / 2 + (insets.right - insets.left) * metresPerPixel / 2,
      y: minY / 2 + maxY / 2 + (insets.top - insets.bottom) * metresPerPixel / 2,
    },
    baseWidthMeters: metresPerPixel * screen.width,
    baseHeightMeters: metresPerPixel * screen.height,
    zoomLevel: 1,
  };
  return validViewport(viewport) ? viewport : null;
}

export function viewportForScreen(viewport: MapViewport, screen: MapScreenSize): MapViewport | null {
  if (!validViewport(viewport) || !validScreen(screen)) return null;
  const screenRatio = screen.width / screen.height;
  const baseRatio = viewport.baseWidthMeters / viewport.baseHeightMeters;
  if (!positiveFinite(screenRatio) || !positiveFinite(baseRatio)) return null;
  const result: MapViewport = { ...viewport, center: { ...viewport.center } };
  // Division/multiplication roundoff must not expand the camera on every render.
  if (Math.abs(baseRatio - screenRatio) > Number.EPSILON * 4 * Math.max(baseRatio, screenRatio)) {
    if (baseRatio < screenRatio) {
      result.baseWidthMeters = Math.max(viewport.baseWidthMeters, viewport.baseHeightMeters * screenRatio);
    } else {
      result.baseHeightMeters = Math.max(viewport.baseHeightMeters, viewport.baseWidthMeters / screenRatio);
    }
  }
  return validViewport(result) ? result : null;
}
