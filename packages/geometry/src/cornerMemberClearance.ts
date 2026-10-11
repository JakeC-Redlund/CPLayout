import type { XY } from "@cplayout/core";

/** Analytic clearance of a complete rigid member at one pose, not between poses. */
export function memberInsideRing(start: XY, end: XY, ring: XY[], clearanceMeters: number): boolean {
  return pointInsideRing(start, ring) && pointInsideRing(end, ring)
    && memberRingDistance(start, end, ring) >= clearanceMeters;
}

export function memberConflictsWithRing(start: XY, end: XY, ring: XY[], clearanceMeters: number): boolean {
  return pointInsideRing(start, ring) || pointInsideRing(end, ring)
    || memberRingDistance(start, end, ring) <= clearanceMeters;
}

function memberRingDistance(start: XY, end: XY, ring: XY[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    minimum = Math.min(minimum, segmentDistance(start, end, ring[index], ring[(index + 1) % ring.length]));
  }
  return minimum;
}

/** Positive means the complete centerline has the requested clearance. Values are
 * signed geometric margins, not a maximum penetration-depth calculation. */
export function memberFieldClearanceMargin(start: XY, end: XY, ring: XY[], clearanceMeters: number): number {
  const separation = memberRingDistance(start, end, ring);
  return (pointInsideRing(start, ring) && pointInsideRing(end, ring) ? separation : -separation) - clearanceMeters;
}

export function memberObstacleClearanceMargin(start: XY, end: XY, ring: XY[], clearanceMeters: number): number {
  const separation = memberRingDistance(start, end, ring);
  return (pointInsideRing(start, ring) || pointInsideRing(end, ring) ? -separation : separation) - clearanceMeters;
}

function segmentDistance(a: XY, b: XY, c: XY, d: XY): number {
  // Differences keep the determinant local even for large projected coordinates.
  const cross = (start: XY, end: XY, point: XY) =>
    (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  const opposite = (left: number, right: number) => (left < 0 && right > 0) || (left > 0 && right < 0);
  if (opposite(cross(a, b, c), cross(a, b, d)) && opposite(cross(c, d, a), cross(c, d, b))) return 0;
  // Endpoint distances also handle touches, collinear overlap and zero-length edges.
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function pointSegmentDistance(point: XY, start: XY, end: XY): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const px = point.x - start.x;
  const py = point.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared));
  return Math.hypot(px - t * dx, py - t * dy);
}

function pointInsideRing(point: XY, ring: XY[]): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x - a.x < (b.x - a.x) * ((point.y - a.y) / (b.y - a.y))) inside = !inside;
  }
  return inside;
}
