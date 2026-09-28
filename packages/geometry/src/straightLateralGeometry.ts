import type { FieldCalculationKey, FieldCalculationRequest, FieldDesign, MultiPolygonXY, ProjectCalculationBlocker, XY } from "@cplayout/core";
import * as polygonClipping from "polygon-clipping";
import { createStraightLateralCalculationInput, type StraightLateralCalculationContext } from "../../core/src/straightLateralCalculationInput";

type Ring = polygonClipping.Ring;
type Clip = polygonClipping.MultiPolygon;
type ReadyInput = Extract<ReturnType<typeof createStraightLateralCalculationInput>, { status: "ready" }>;
type WetEnvelope = {
  status: "unknown"; reason: "sprinkler_reach_missing";
} | {
  status: "potential_rectangular_envelope";
  rawEnvelope: MultiPolygonXY; clippedCoverage: MultiPolygonXY;
  outsideFieldCoverage: MultiPolygonXY; blockedNoSprayCoverage: MultiPolygonXY;
  rawSquareMeters: number; clippedSquareMeters: number; outsideSquareMeters: number; blockedNoSpraySquareMeters: number;
};

export interface StraightLateralObstacleConflict {
  obstacleId: string;
  /** Applied once on top of the machine buffer; square corners conservatively enclose a radial buffer. */
  combinedBufferMeters: number;
  overlapSquareMeters: number;
  touches: boolean;
}

export type StraightLateralEvaluation = {
  status: "unsupported"; key: FieldCalculationKey; blockers: ProjectCalculationBlocker[];
} | {
  status: "evaluated"; key: FieldCalculationKey; advisoryOnly: true; fieldQualified: false;
  model: "rigid_cross_travel_member_straight_translation";
  bufferModel: "conservative_rectangular_clearance";
  rawSweptEnvelope: MultiPolygonXY; bufferedSweptEnvelope: MultiPolygonXY;
  startMember: [XY, XY]; endMember: [XY, XY];
  travelLengthMeters: number; physicalWidthMeters: number; rawSweptSquareMeters: number;
  bufferedSweptSquareMeters: number;
  /** Computational contact guard only, not physical/receiver accuracy. */
  numericalGuardMeters: number;
  boundaryConstraint: { status: "within_boundary" | "outside_boundary"; outsideSquareMeters: number; requiredClearanceMeters: number };
  mechanicalConstraints: { scope: "hard_obstacles_only"; status: "conflicts" | "no_conflicts_in_rectangular_model"; conflicts: StraightLateralObstacleConflict[] };
  wet: WetEnvelope;
  supply: { waterSourceId: string; powerSourceId?: string };
  unknowns: StraightLateralCalculationContext["unknowns"];
};

/**
 * Complete-motion analytic rectangle, not circles at path vertices or sampled poses.
 * The member stays perpendicular to its two-endpoint path; bends/articulation are unsupported.
 * Buffers extend all four rectangle sides, conservatively including square corners.
 * Wet reach is an explicit potential-envelope assumption, never delivered irrigated acreage.
 * Product model source context (checked 2026-09-27):
 * https://preec.unl.edu/news/center-pivots-innovation-grew-crops-and-acres-nebraska/
 */
export function evaluateStraightLateral(field: FieldDesign, request: FieldCalculationRequest): StraightLateralEvaluation {
  const input = createStraightLateralCalculationInput(field, request);
  if (input.status === "unsupported") return { status: "unsupported", key: input.key, blockers: input.blockers };
  try {
    const result = evaluateAdmitted(input);
    assertFiniteOutput(result);
    return result;
  } catch (error) {
    return { status: "unsupported", key: input.key, blockers: [{ path: "geometry", code: "straight_lateral_geometry_failed",
      message: error instanceof Error ? error.message : "Straight lateral geometry could not be assessed." }] };
  }
}

function evaluateAdmitted(input: ReadyInput): Extract<StraightLateralEvaluation, { status: "evaluated" }> {
  const { machine, field, travelUnit: direction, leftUnit: left, travelLengthMeters: length } = input;
  const origin = machine.travel.start;
  // Arithmetic and clipping use a translated, rotated analysis frame. Stored XY is untouched.
  const local = (point: XY): [number, number] => {
    const x = point.x - origin.x;
    const y = point.y - origin.y;
    return [x * direction.x + y * direction.y, x * left.x + y * left.y];
  };
  const world = ([along, across]: readonly number[]): XY => ({
    x: origin.x + along * direction.x + across * left.x,
    y: origin.y + along * direction.y + across * left.y,
  });
  const toWorld = (clip: Clip): MultiPolygonXY => clip.map(polygon => polygon.map(ring => ring.map(world)));
  const rectangle = (buffer: number): Ring => [
    [-buffer, -machine.rightExtentMeters - buffer], [length + buffer, -machine.rightExtentMeters - buffer],
    [length + buffer, machine.leftExtentMeters + buffer], [-buffer, machine.leftExtentMeters + buffer],
    [-buffer, -machine.rightExtentMeters - buffer],
  ];
  const asClip = (ring: Ring): Clip => [[ring]];
  const fieldClip = asClip(close(field.fieldBoundary.map(local)));
  const raw = asClip(rectangle(0));
  const buffered = asClip(rectangle(machine.machineClearanceBufferMeters));
  const requiredClearanceMeters = field.settings?.layoutReview.requiredBoundaryClearanceMeters ?? 0;
  const boundaryEnvelope = asClip(rectangle(machine.machineClearanceBufferMeters + requiredClearanceMeters));
  const outside = polygonClipping.difference(boundaryEnvelope, fieldClip);
  const outsideSquareMeters = area(outside);
  const conflicts: StraightLateralObstacleConflict[] = [];
  for (const obstacle of field.obstacles.filter(item => item.hardConflict)) {
    const obstacleRing = close(obstacle.polygon.map(local));
    const combinedBufferMeters = machine.machineClearanceBufferMeters + obstacle.bufferMeters;
    const envelope = rectangle(combinedBufferMeters);
    const overlapSquareMeters = area(polygonClipping.intersection(asClip(envelope), asClip(obstacleRing)) ?? []);
    // Area clipping omits zero-area contact; a complete edge test keeps contact conservative.
    const touches = ringsTouch(envelope, obstacleRing, input.numericalGuardMeters);
    if (overlapSquareMeters > 0 || touches) conflicts.push({ obstacleId: obstacle.id, combinedBufferMeters, overlapSquareMeters, touches });
  }
  let wet: WetEnvelope = { status: "unknown", reason: "sprinkler_reach_missing" };
  if (machine.sprinklerReachMeters !== undefined) {
    const wetRaw = asClip(rectangle(machine.sprinklerReachMeters));
    const inside = polygonClipping.intersection(wetRaw, fieldClip) ?? [];
    // Match the shared field semantics: noSpray uses its explicit polygon;
    // obstacle.bufferMeters participates in mechanical clearance, not a fabricated spray rule.
    const noSpray: Clip = field.obstacles.filter(item => item.noSpray).map(item => [close(item.polygon.map(local))]);
    const allowed = noSpray.length > 0 ? polygonClipping.difference(inside, noSpray) : inside;
    const wetOutside = polygonClipping.difference(wetRaw, fieldClip);
    const blocked = noSpray.length > 0 ? polygonClipping.intersection(inside, noSpray) ?? [] : [];
    wet = { status: "potential_rectangular_envelope", rawEnvelope: toWorld(wetRaw), clippedCoverage: toWorld(allowed),
      outsideFieldCoverage: toWorld(wetOutside), blockedNoSprayCoverage: toWorld(blocked),
      rawSquareMeters: area(wetRaw), clippedSquareMeters: area(allowed), outsideSquareMeters: area(wetOutside),
      blockedNoSpraySquareMeters: area(blocked) };
  }
  return {
    status: "evaluated", key: input.key, advisoryOnly: true, fieldQualified: false,
    model: "rigid_cross_travel_member_straight_translation", bufferModel: "conservative_rectangular_clearance",
    rawSweptEnvelope: toWorld(raw), bufferedSweptEnvelope: toWorld(buffered),
    startMember: [world([0, machine.leftExtentMeters]), world([0, -machine.rightExtentMeters])],
    endMember: [world([length, machine.leftExtentMeters]), world([length, -machine.rightExtentMeters])],
    travelLengthMeters: length, physicalWidthMeters: machine.leftExtentMeters + machine.rightExtentMeters,
    rawSweptSquareMeters: area(raw), bufferedSweptSquareMeters: area(buffered),
    numericalGuardMeters: input.numericalGuardMeters,
    boundaryConstraint: { status: outsideSquareMeters > 0 ? "outside_boundary" : "within_boundary", outsideSquareMeters, requiredClearanceMeters },
    mechanicalConstraints: { scope: "hard_obstacles_only", status: conflicts.length > 0 ? "conflicts" : "no_conflicts_in_rectangular_model", conflicts },
    wet, supply: { waterSourceId: input.waterSource!.id, ...(input.powerSource ? { powerSourceId: input.powerSource.id } : {}) },
    unknowns: input.unknowns,
  };
}

function close(ring: Ring): Ring { return [...ring, [...ring[0]] as [number, number]]; }

function area(clip: Clip): number {
  const ringArea = (ring: Ring) => {
    const origin = ring[0];
    if (!origin) return 0;
    let sum = 0;
    for (let index = 1; index < ring.length; index += 1) {
      sum += (ring[index - 1][0] - origin[0]) * (ring[index][1] - origin[1])
        - (ring[index][0] - origin[0]) * (ring[index - 1][1] - origin[1]);
    }
    return Math.abs(sum) / 2;
  };
  return clip.reduce((total, polygon) => total + ringArea(polygon[0])
    - polygon.slice(1).reduce((holes, ring) => holes + ringArea(ring), 0), 0);
}

function ringsTouch(left: Ring, right: Ring, guard: number): boolean {
  for (let a = 1; a < left.length; a += 1) {
    for (let b = 1; b < right.length; b += 1) {
      if (segmentsTouch(left[a - 1], left[a], right[b - 1], right[b])
        || Math.min(pointSegmentDistance(left[a - 1], right[b - 1], right[b]), pointSegmentDistance(left[a], right[b - 1], right[b]),
          pointSegmentDistance(right[b - 1], left[a - 1], left[a]), pointSegmentDistance(right[b], left[a - 1], left[a])) <= guard) return true;
    }
  }
  return false;
}

function pointSegmentDistance(p: readonly number[], a: readonly number[], b: readonly number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const x = p[0] - a[0];
  const y = p[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared));
  return Math.hypot(x - t * dx, y - t * dy);
}

function segmentsTouch(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): boolean {
  const cross = (p: readonly number[], q: readonly number[], r: readonly number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const on = (p: readonly number[], q: readonly number[], r: readonly number[]) => cross(p, q, r) === 0
    && r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0]) && r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1]);
  const opposite = (p: number, q: number) => p < 0 && q > 0 || p > 0 && q < 0;
  return opposite(cross(a, b, c), cross(a, b, d)) && opposite(cross(c, d, a), cross(c, d, b))
    || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}

function assertFiniteOutput(value: unknown): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw new RangeError("Straight lateral result exceeded finite numeric range.");
  if (value && typeof value === "object") Object.values(value).forEach(assertFiniteOutput);
}
