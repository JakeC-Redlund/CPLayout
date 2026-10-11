import type { XY } from "@cplayout/core";

export type CornerGuidanceRoot = -1 | 0 | 1;
export interface CornerGuidanceIntersection {
  point: XY; segmentIndex: number; distanceAlong: number; positionOnSegment: number;
  segmentLength: number; root: CornerGuidanceRoot;
}
export interface CornerGuidanceEvent {
  thetaDegrees: number; kind: "guidance_vertex" | "guidance_tangency"; segmentIndex: number;
}
export interface CornerMemberMargin {
  member: "main" | "corner"; constraint: "field" | "obstacle"; constraintId: string; marginMeters: number;
}
export interface CornerContinuousPose {
  thetaRadians: number; thetaDegrees: number; lrdu: XY; sdu: XY; overhangEndpoint: XY;
  guidanceSegmentIndex: number; guidanceRoot: CornerGuidanceRoot; clearanceMargins: CornerMemberMargin[];
}
export interface CornerIntervalAssessment {
  startStateIndex: number; endStateIndex: number;
  status: "conditionally_clear" | "sampled_conflict" | "unresolved";
  reason: string; numericalGuardMeters: number;
  minimumSampledMarginMeters: number; displacementBoundMeters: number | null;
  /** Bounds contain the entire centerline motion for the admitted continuous branch.
   * Add physical radius or pair gap separately. No polygonal sampled sweep is a bound. */
  centerlineEnclosure: { minX: number; minY: number; maxX: number; maxY: number } | null;
  governingConstraintId: string | null;
}

export function cornerNumericalGuard(points: XY[], radius: number, length: number): number {
  const scale = points.reduce((maximum, point) => Math.max(maximum, Math.abs(point.x), Math.abs(point.y)), Math.max(1, radius, length));
  // Explicit computational guard, not receiver accuracy or rigorous interval arithmetic.
  return Math.max(1e-9, 128 * Number.EPSILON * scale);
}

export function cornerGuidanceIntersections(center: XY, radius: number, vertices: XY[], includeNumericalGuard = true): CornerGuidanceIntersection[] {
  const intersections: CornerGuidanceIntersection[] = [];
  let distanceAlong = 0;
  for (let index = 1; index < vertices.length; index += 1) {
    const start = vertices[index - 1], end = vertices[index];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length === 0) continue;
    const ux = (end.x - start.x) / length, uy = (end.y - start.y) / length;
    const along = (center.x - start.x) * ux + (center.y - start.y) * uy;
    const perpendicular = (center.x - start.x) * uy - (center.y - start.y) * ux;
    const square = (radius - Math.abs(perpendicular)) * (radius + Math.abs(perpendicular));
    const guard = includeNumericalGuard ? cornerNumericalGuard([center, start, end], radius, length) : 0;
    if (square < -guard * Math.max(1, radius * 2)) { distanceAlong += length; continue; }
    const offset = Math.sqrt(Math.max(0, square));
    const roots: CornerGuidanceRoot[] = offset <= guard ? [0] : [-1, 1];
    for (const root of roots) {
      const position = along + root * offset;
      if (position < -guard || position > length + guard) continue;
      const clamped = Math.max(0, Math.min(length, position));
      const point = { x: start.x + clamped * ux, y: start.y + clamped * uy };
      if (!includeNumericalGuard && intersections.some(candidate => Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) < 1e-9)) continue;
      intersections.push({ point,
        segmentIndex: index - 1, distanceAlong: distanceAlong + clamped, positionOnSegment: clamped, segmentLength: length, root });
    }
    distanceAlong += length;
  }
  return intersections;
}

function equationAngles(a: number, b: number, c: number): number[] {
  const magnitude = Math.hypot(a, b);
  if (magnitude === 0 || Math.abs(c) > magnitude) return [];
  const phase = Math.atan2(b, a), offset = Math.acos(Math.max(-1, Math.min(1, c / magnitude)));
  return offset === 0 ? [phase] : [phase - offset, phase + offset];
}

/** Analytic event locations; reporting an event does not choose a branch through it. */
export function cornerGuidanceEvents(pivot: XY, radius: number, length: number, path: XY[], angles: number[]): CornerGuidanceEvent[] {
  const start = angles[0], end = angles.at(-1)!;
  const direction = end >= start ? 1 : -1;
  const events: CornerGuidanceEvent[] = [];
  const add = (radians: number, kind: CornerGuidanceEvent["kind"], segmentIndex: number) => {
    const degrees = radians * 180 / Math.PI;
    const progress = ((direction * (degrees - start) % 360) + 360) % 360;
    const thetaDegrees = start + direction * progress;
    if (progress > Math.abs(end - start) + 1e-9) return;
    if (!events.some(event => event.kind === kind && event.segmentIndex === segmentIndex && Math.abs(event.thetaDegrees - thetaDegrees) < 1e-9)) {
      events.push({ thetaDegrees, kind, segmentIndex });
    }
  };
  path.forEach((vertex, index) => {
    const x = vertex.x - pivot.x, y = vertex.y - pivot.y;
    for (const angle of equationAngles(x, y, (x * x + y * y + radius * radius - length * length) / (2 * radius))) {
      add(angle, "guidance_vertex", Math.min(index, path.length - 2));
    }
  });
  for (let index = 0; index + 1 < path.length; index += 1) {
    const a = path[index], b = path[index + 1], size = Math.hypot(b.x - a.x, b.y - a.y);
    if (size === 0) continue;
    const ux = (b.x - a.x) / size, uy = (b.y - a.y) / size;
    const nx = -uy, ny = ux, initial = (pivot.x - a.x) * nx + (pivot.y - a.y) * ny;
    for (const sign of [-1, 1]) for (const theta of equationAngles(nx, ny, (sign * length - initial) / radius)) {
      const center = { x: pivot.x + radius * Math.cos(theta), y: pivot.y + radius * Math.sin(theta) };
      const along = (center.x - a.x) * ux + (center.y - a.y) * uy;
      if (along >= 0 && along <= size) add(theta, "guidance_tangency", index);
    }
  }
  return events.sort((a, b) => direction * (a.thetaDegrees - b.thetaDegrees) || a.segmentIndex - b.segmentIndex || a.kind.localeCompare(b.kind));
}

/** |d SDU/d theta| <= L R / eta when |q dot u| >= eta > 0 on one segment.
 * |d perpendicular/d theta| <= R supplies a conservative eta without samples.
 * Segment endpoint containment proves the selected root cannot leave that segment.
 * Clearance is conditional on this planar rigid-member model and stated numerical guard. */
export function assessCornerInterval(start: CornerContinuousPose, end: CornerContinuousPose, index: number,
  pivot: XY, radius: number, length: number, overhang: number, path: XY[]): CornerIntervalAssessment {
  const guard = cornerNumericalGuard([pivot, start.lrdu, start.sdu, end.lrdu, end.sdu, ...path], radius, length);
  const margins = [...start.clearanceMargins, ...end.clearanceMargins].sort((a, b) => a.marginMeters - b.marginMeters);
  const margin = margins[0]?.marginMeters ?? -Infinity;
  const output: CornerIntervalAssessment = { startStateIndex: index, endStateIndex: index + 1, status: "unresolved",
    reason: "A continuous straight-segment branch has not been bounded.", numericalGuardMeters: guard,
    minimumSampledMarginMeters: margin, displacementBoundMeters: null, centerlineEnclosure: null,
    governingConstraintId: margins[0]?.constraintId ?? null };
  if (margin <= guard) return { ...output, status: margin < 0 ? "sampled_conflict" : "unresolved", reason: "A sampled member conflicts or lies within numerical clearance uncertainty." };
  if (start.guidanceSegmentIndex !== end.guidanceSegmentIndex || start.guidanceRoot === 0 || start.guidanceRoot !== end.guidanceRoot) return output;
  const a = path[start.guidanceSegmentIndex], b = path[start.guidanceSegmentIndex + 1];
  if (!a || !b) return output;
  const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
  if (segmentLength <= guard) return output;
  const ux = (b.x - a.x) / segmentLength, uy = (b.y - a.y) / segmentLength;
  const delta = Math.abs(end.thetaRadians - start.thetaRadians);
  const perpendicular = (point: XY) => Math.abs((point.x - a.x) * uy - (point.y - a.y) * ux);
  const dMaximum = Math.min(perpendicular(start.lrdu), perpendicular(end.lrdu)) + radius * delta + guard;
  if (dMaximum >= length - guard) return { ...output, reason: "Tangency or loss of reach cannot be excluded between poses." };
  const eta = Math.sqrt((length - dMaximum) * (length + dMaximum)) - guard;
  if (eta <= guard) return output;
  const sduDisplacement = length * radius / eta * delta + guard;
  const startAlong = (start.sdu.x - a.x) * ux + (start.sdu.y - a.y) * uy;
  if (Math.min(startAlong, segmentLength - startAlong) <= sduDisplacement + guard) {
    return { ...output, reason: "Guidance vertex traversal cannot be excluded between poses." };
  }
  const mainDisplacement = radius * delta + guard;
  const endpointDisplacement = (1 + overhang / length) * sduDisplacement + overhang / length * mainDisplacement;
  const displacement = Math.max(mainDisplacement, endpointDisplacement) + guard;
  const points = [pivot, start.lrdu, start.overhangEndpoint];
  const enclosure = { minX: Math.min(...points.map(point => point.x)) - displacement,
    minY: Math.min(...points.map(point => point.y)) - displacement,
    maxX: Math.max(...points.map(point => point.x)) + displacement,
    maxY: Math.max(...points.map(point => point.y)) + displacement };
  return { ...output, displacementBoundMeters: displacement, centerlineEnclosure: enclosure,
    status: margin > displacement + guard ? "conditionally_clear" : "unresolved",
    reason: margin > displacement + guard ? "Complete rigid members remain clear under the continuous straight-branch displacement bound and stated numerical guard."
      : "The conservative displacement bound exceeds available clearance; refine this interval." };
}
