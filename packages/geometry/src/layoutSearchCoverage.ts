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
