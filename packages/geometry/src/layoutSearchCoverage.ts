import type { MultiPolygonXY } from "@cplayout/core";
import * as polygonClipping from "polygon-clipping";
import { multiPolygonAreaSquareMeters } from "./geometry";

/** Eligible footprints already exclude no-spray areas. Union counts triple overlap once. */
export function layoutSearchCoverage(footprints: MultiPolygonXY[]): {
  coverage: MultiPolygonXY; areaSquareMeters: number; overlapSquareMeters: number;
} {
  const nonempty = footprints.filter(value => value.length > 0);
  if (nonempty.length === 0) return { coverage: [], areaSquareMeters: 0, overlapSquareMeters: 0 };
  const clips = nonempty.map(value => value.map(polygon => polygon.map(ring => ring.map(point => [point.x, point.y] as [number, number]))));
  const coverage = polygonClipping.union(clips[0], ...clips.slice(1)).map(polygon =>
    polygon.map(ring => ring.map(([x, y]) => ({ x, y }))));
  const areaSquareMeters = multiPolygonAreaSquareMeters(coverage);
  const gross = footprints.reduce((sum, value) => sum + multiPolygonAreaSquareMeters(value), 0);
  if (![gross, areaSquareMeters].every(Number.isFinite)) throw new Error("Non-finite coverage union.");
  return { coverage, areaSquareMeters, overlapSquareMeters: Math.max(0, gross - areaSquareMeters) };
}

/** V2 clips in a translated calculation frame, with deterministic footprint order.
 * The strict area checks reject materially inconsistent unions; tiny roundoff is
 * explicit in the comparison tolerance rather than creating new incumbents. */
export function layoutSearchCoverageV2(footprints: MultiPolygonXY[], toleranceSquareMeters: number): ReturnType<typeof layoutSearchCoverage> {
  const nonempty = footprints.filter(value => value.some(polygon => polygon.some(ring => ring.length > 0)));
  if (!nonempty.length) return { coverage: [], areaSquareMeters: 0, overlapSquareMeters: 0 };
  let originX = Infinity, originY = Infinity;
  for (const footprint of nonempty) for (const polygon of footprint) for (const ring of polygon) for (const point of ring) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error("Non-finite eligible footprint.");
    originX = Math.min(originX, point.x); originY = Math.min(originY, point.y);
  }
  const shifted = nonempty.map(footprint => footprint.map(polygon => polygon.map(ring => ring.map(point => ({ x: point.x - originX, y: point.y - originY })))));
  const measured = layoutSearchCoverage(shifted);
  const areas = shifted.map(multiPolygonAreaSquareMeters);
  const gross = areas.reduce((sum, area) => sum + area, 0);
  const largest = Math.max(...areas);
  if (measured.areaSquareMeters < -toleranceSquareMeters || measured.areaSquareMeters > gross + toleranceSquareMeters
    || measured.areaSquareMeters + toleranceSquareMeters < largest) throw new Error("Coverage union violates eligible-area conservation.");
  return { ...measured, coverage: measured.coverage.map(polygon => polygon.map(ring => ring.map(point => ({ x: point.x + originX, y: point.y + originY })))) };
}
