import type { XY } from "@cplayout/core";
import { boundsForGeometry } from "./geometry";
import type { Calculation } from "./calculation";
import { layoutSearchPointKey } from "./layoutSearchCandidates";
import { LAYOUT_SEARCH_LIMITS, type LayoutSearchRequest } from "./layoutSearchTypes";

interface Cell { x: number; y: number; halfX: number; halfY: number; distance: number; bound: number; serial: number }
/** Interior quadtree centers alternate with spatial Halton probes. Both streams
 * are deterministic and independent of requested budgets. No equipment is resized. */
export function createLayoutSearchCenterSourceV2(request: LayoutSearchRequest) {
  const bounds = boundsForGeometry([request.field.fieldBoundary]);
  const ring = request.field.fieldBoundary;
  const seen = new Set<string>();
  const explicit = request.candidateCenters === undefined ? undefined : [...new Map([...request.candidateCenters]
    .sort((a, b) => a.x - b.x || a.y - b.y).map(point => [layoutSearchPointKey(point), point])).values()];
  const initial = explicit ?? [...request.field.machines.map(machine => machine.pivotCenter),
    { x: bounds.minX + (bounds.maxX - bounds.minX) / 2, y: bounds.minY + (bounds.maxY - bounds.minY) / 2 }];
  let initialIndex = 0, probes = 0, emitted = 0, halton = 0, serial = 0;
  const heap: Cell[] = [];
  const before = (a: Cell, b: Cell) => a.bound > b.bound || (a.bound === b.bound && a.serial < b.serial);
  function addCell(x: number, y: number, halfX: number, halfY: number) {
    const distance = signedDistance({ x, y }, ring);
    const cell = { x, y, halfX, halfY, distance, bound: distance + Math.hypot(halfX, halfY), serial: serial++ };
    heap.push(cell);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!before(cell, heap[parent])) break;
      heap[index] = heap[parent]; index = parent;
    }
    heap[index] = cell;
  }
  function popCell(): Cell | undefined {
    const root = heap[0], last = heap.pop();
    if (heap.length && last) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child += 1;
        if (before(last, heap[child])) break;
        heap[index] = heap[child]; index = child;
      }
      heap[index] = last;
    }
    return root;
  }
  if (!explicit) addCell(bounds.minX + (bounds.maxX - bounds.minX) / 2,
    bounds.minY + (bounds.maxY - bounds.minY) / 2, (bounds.maxX - bounds.minX) / 2, (bounds.maxY - bounds.minY) / 2);
  const source = {
    get probes() { return probes; },
    get complete() { return explicit ? initialIndex >= initial.length : emitted >= LAYOUT_SEARCH_LIMITS.candidateCenters || probes >= 8192; },
    get probeExhausted() { return !explicit && probes >= 8192 && emitted < LAYOUT_SEARCH_LIMITS.candidateCenters; },
    *next(checkStop: () => void): Calculation<XY | null> {
      while (!source.complete) {
        checkStop();
        let point: XY | undefined;
        if (initialIndex < initial.length) point = initial[initialIndex++];
        else {
          probes += 1;
          if (probes % 32 === 0) { yield; checkStop(); }
          if (probes % 2 === 1 && heap.length) {
            const cell = popCell()!;
            const halfX = cell.halfX / 2, halfY = cell.halfY / 2;
            // Require representable subdivision. This bounds one-ULP and collapsed grids.
            if (cell.x - halfX !== cell.x && cell.x + halfX !== cell.x
              && cell.y - halfY !== cell.y && cell.y + halfY !== cell.y) {
              for (const dx of [-1, 1]) for (const dy of [-1, 1]) addCell(cell.x + dx * halfX, cell.y + dy * halfY, halfX, halfY);
            }
            if (cell.distance > 0) point = { x: cell.x, y: cell.y };
          } else {
            halton += 1;
            const proposed = { x: bounds.minX + radicalInverse(halton, 2) * (bounds.maxX - bounds.minX),
              y: bounds.minY + radicalInverse(halton, 3) * (bounds.maxY - bounds.minY) };
            if (signedDistance(proposed, ring) > 0) point = proposed;
          }
        }
        if (point && !seen.has(layoutSearchPointKey(point))) {
          seen.add(layoutSearchPointKey(point)); emitted += 1; return point;
        }
      }
      return null;
    },
  };
  return source;
}
function radicalInverse(index: number, base: number): number {
  let fraction = 1 / base, value = 0;
  while (index > 0) { value += (index % base) * fraction; index = Math.floor(index / base); fraction /= base; }
  return value;
}
function signedDistance(point: XY, ring: XY[]): number {
  let inside = false, distance = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const ax = a.x - point.x, ay = a.y - point.y, bx = b.x - point.x, by = b.y - point.y;
    if ((ay > 0) !== (by > 0) && 0 < ax + (-ay / (by - ay)) * (bx - ax)) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return inside ? distance : -distance;
}
