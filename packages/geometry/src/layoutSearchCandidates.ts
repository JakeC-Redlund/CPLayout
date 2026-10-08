import type { XY } from "@cplayout/core";
import { boundsForGeometry } from "./geometry";
import { completeCalculation, type Calculation } from "./calculation";
import { LAYOUT_SEARCH_LIMITS, type LayoutSearchRequest } from "./layoutSearchTypes";

export function layoutSearchPointKey(point: XY): string { return JSON.stringify([point.x, point.y]); }

/** Every larger prefix includes every earlier center, at the same index. */
export function layoutSearchCandidateCenters(request: LayoutSearchRequest): XY[] {
  return completeCalculation(layoutSearchCandidateCenterSteps(request)).centers;
}

/** A fixed probe ceiling also bounds grids with too few representable XY pairs. */
export function* layoutSearchCandidateCenterSteps(request: LayoutSearchRequest,
  checkStop: () => void = () => {},
): Calculation<{ centers: XY[]; exhausted: boolean }> {
  const unique = (values: XY[]) => [...new Map(values.map(point => [layoutSearchPointKey(point), point])).values()];
  if (request.candidateCenters) return { centers: unique([...request.candidateCenters].sort((a, b) => a.x - b.x || a.y - b.y)), exhausted: false };
  const bounds = boundsForGeometry([request.field.fieldBoundary]);
  const centers = unique([
    ...request.field.machines.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(machine => machine.pivotCenter),
    { x: bounds.minX + (bounds.maxX - bounds.minX) / 2, y: bounds.minY + (bounds.maxY - bounds.minY) / 2 },
  ]);
  const maxProbes = LAYOUT_SEARCH_LIMITS.candidateCenters * 64;
  for (let index = 1; centers.length < request.budget.maxCandidateCenters && index <= maxProbes; index += 1) {
    checkStop();
    if (index % 32 === 0) { yield; checkStop(); }
    const point = { x: bounds.minX + radicalInverse(index, 2) * (bounds.maxX - bounds.minX),
      y: bounds.minY + radicalInverse(index, 3) * (bounds.maxY - bounds.minY) };
    if (!centers.some(center => center.x === point.x && center.y === point.y)) centers.push(point);
    // A degenerate boundary has no useful additional centers.
    if (bounds.minX === bounds.maxX && bounds.minY === bounds.maxY) break;
  }
  return { centers, exhausted: centers.length < request.budget.maxCandidateCenters };
}
function radicalInverse(index: number, base: number): number {
  let fraction = 1 / base, result = 0;
  while (index > 0) { result += (index % base) * fraction; index = Math.floor(index / base); fraction /= base; }
  return result;
}
export const LAYOUT_SEARCH_DIRECTIONS: readonly XY[] = Object.freeze([
  { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 },
  { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
]);
export function layoutSearchRefinementStep(request: LayoutSearchRequest, level: number): number {
  const bounds = boundsForGeometry([request.field.fieldBoundary]);
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / (8 * 2 ** level);
}
