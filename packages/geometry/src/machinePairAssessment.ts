import { createFieldCalculationInput, qualifyProjectCrs, snapshotJsonValue, validateFieldDesign,
  type CrsQualificationOptions, type FieldDesign, type XY } from "@cplayout/core";
import { createStraightLateralCalculationInput } from "../../core/src/straightLateralCalculationInput";

export const MACHINE_PAIR_MODEL_VERSION = "complete-motion-machine-pairs-v1";
export interface MachinePairAssessmentRequest {
  inputRevision: number;
  expectedRevision?: number;
  crsOptions?: CrsQualificationOptions;
  /** A required gap applied once, using the largest explicitly supplied machine or pair gap. */
  minimumGapMeters?: number;
}
export interface MachinePairAssessment {
  leftMachineId: string;
  rightMachineId: string;
  status: "separated" | "possible_sweep_overlap" | "unresolved";
  leftModel: "full_reach_circle" | "straight_translation_rectangle" | "unresolved";
  rightModel: "full_reach_circle" | "straight_translation_rectangle" | "unresolved";
  minimumEnvelopeDistanceMeters: number | null;
  requiredGapMeters: number;
  clearanceBeyondRequiredMeters: number | null;
  numericalGuardMeters: number | null;
  reasons: string[];
}
export interface FieldMachinePairAssessment {
  modelVersion: typeof MACHINE_PAIR_MODEL_VERSION;
  key: { fieldId: string; inputRevision: number };
  status: "evaluated" | "unsupported";
  pairs: MachinePairAssessment[];
  blockers: string[];
  advisoryOnly: true;
  fieldQualified: false;
  operatingSchedule: "not_assessed";
  qualification: string;
}
type Circle = { kind: "full_reach_circle"; center: XY; radius: number };
type Rectangle = { kind: "straight_translation_rectangle"; start: XY; along: XY; left: XY;
  length: number; leftExtent: number; rightExtent: number };
type Shape = Circle | Rectangle;
type Envelope = { id: string; buffer: number; shape: Shape | null; reasons: string[] };
const MAX_MACHINES = 64;

/** Complete unrounded, unclipped mechanical envelopes; no water footprint or timing inference. */
export function evaluateFieldMachinePairs(inputField: FieldDesign,
  inputRequest: MachinePairAssessmentRequest): FieldMachinePairAssessment {
  const field = validateFieldDesign(inputField);
  const request = snapshotJsonValue(inputRequest, "machine pair assessment") as MachinePairAssessmentRequest;
  if (!Number.isSafeInteger(request.inputRevision) || request.inputRevision < 0
    || request.expectedRevision !== undefined && (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0)) {
    throw new RangeError("Machine pair assessment needs a valid field revision.");
  }
  const gap = request.minimumGapMeters ?? 0;
  if (!Number.isFinite(gap) || gap < 0) throw new RangeError("Machine pair gap must be finite and nonnegative.");
  const result: FieldMachinePairAssessment = {
    modelVersion: MACHINE_PAIR_MODEL_VERSION, key: { fieldId: field.id, inputRevision: request.inputRevision },
    status: "evaluated", pairs: [], blockers: [], advisoryOnly: true, fieldQualified: false,
    operatingSchedule: "not_assessed",
    qualification: "Separation concerns complete modeled mechanical sweeps and the required gap. Possible overlap does not establish simultaneous collision. Terrain, flexibility, controls and operating schedules are unverified.",
  };
  if (request.expectedRevision !== undefined && request.expectedRevision !== request.inputRevision) result.blockers.push("stale_field_revision");
  result.blockers.push(...qualifyProjectCrs(field.projectCrs, request.crsOptions).calculation.blockers);
  if (field.machines.length + (field.lateralMachines?.length ?? 0) > MAX_MACHINES) result.blockers.push("machine_pair_budget_exceeded");
  if (result.blockers.length > 0) { result.status = "unsupported"; return result; }
  const envelopes: Envelope[] = [];
  for (const machine of field.machines) {
    const row: Envelope = { id: machine.id, buffer: machine.configuration.machineClearanceBufferMeters, shape: null, reasons: [] };
    const input = createFieldCalculationInput(field, { machineId: machine.id, inputRevision: request.inputRevision, crsOptions: request.crsOptions });
    if (input.status !== "ready") row.reasons.push(...input.blockers.map(value => value.code));
    if (machine.configuration.cornerArm) row.reasons.push("corner_complete_motion_unresolved");
    if (row.reasons.length === 0) {
      const radius = machine.configuration.spanLengthsMeters.reduce((sum, value) => sum + value, 0) + machine.configuration.overhangMeters;
      if (!(radius > 0) || !Number.isFinite(radius)) row.reasons.push("physical_reach_invalid");
      else row.shape = { kind: "full_reach_circle", center: machine.pivotCenter, radius };
    }
    envelopes.push(row);
  }
  for (const machine of field.lateralMachines ?? []) {
    const row: Envelope = { id: machine.id, buffer: machine.machineClearanceBufferMeters, shape: null, reasons: [] };
    const input = createStraightLateralCalculationInput(field, { machineId: machine.id, inputRevision: request.inputRevision, crsOptions: request.crsOptions });
    if (input.status !== "ready") row.reasons.push(...input.blockers.map(value => value.code));
    else row.shape = { kind: "straight_translation_rectangle", start: machine.travel.start, along: input.travelUnit, left: input.leftUnit,
      length: input.travelLengthMeters, leftExtent: machine.leftExtentMeters, rightExtent: machine.rightExtentMeters };
    envelopes.push(row);
  }
  envelopes.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (let i = 0; i < envelopes.length; i += 1) for (let j = i + 1; j < envelopes.length; j += 1) {
    const left = envelopes[i], right = envelopes[j];
    // Validate before Math.max, so invalid negative values cannot be masked by the explicit gap.
    if (![left.buffer, right.buffer].every(value => Number.isFinite(value) && value >= 0)) throw new RangeError("Invalid machine clearance buffer.");
    const pair: MachinePairAssessment = {
      leftMachineId: left.id, rightMachineId: right.id, status: "unresolved",
      leftModel: left.shape?.kind ?? "unresolved", rightModel: right.shape?.kind ?? "unresolved",
      minimumEnvelopeDistanceMeters: null, requiredGapMeters: Math.max(gap, left.buffer, right.buffer),
      clearanceBeyondRequiredMeters: null, numericalGuardMeters: null,
      reasons: [...new Set([...left.reasons, ...right.reasons])].sort(),
    };
    if (left.shape && right.shape) {
      const guard = Math.max(1e-9, 64 * Number.EPSILON * Math.max(shapeMagnitude(left.shape), shapeMagnitude(right.shape), gap));
      const distance = shapeDistance(left.shape, right.shape);
      if (!Number.isFinite(distance) || !Number.isFinite(guard)) pair.reasons.push("non_finite_pair_distance");
      else {
        pair.minimumEnvelopeDistanceMeters = distance;
        pair.clearanceBeyondRequiredMeters = distance - pair.requiredGapMeters;
        pair.numericalGuardMeters = guard;
        pair.status = pair.clearanceBeyondRequiredMeters > guard ? "separated" : "possible_sweep_overlap";
        if (pair.status !== "separated") pair.reasons.push("sweep_or_required_gap_overlap_or_contact");
      }
    }
    result.pairs.push(pair);
  }
  return result;
}

export function machinePairAssessmentMatches(result: FieldMachinePairAssessment,
  current: { fieldId: string; inputRevision: number }): boolean {
  return Number.isSafeInteger(current.inputRevision) && current.inputRevision >= 0
    && result.key.fieldId === current.fieldId && result.key.inputRevision === current.inputRevision;
}

function shapeMagnitude(shape: Shape): number {
  if (shape.kind === "full_reach_circle") return Math.max(Math.abs(shape.center.x), Math.abs(shape.center.y)) + shape.radius;
  return Math.max(Math.abs(shape.start.x), Math.abs(shape.start.y)) + shape.length + shape.leftExtent + shape.rightExtent;
}
function shapeDistance(a: Shape, b: Shape): number {
  if (a.kind === "full_reach_circle" && b.kind === "full_reach_circle") {
    return Math.max(0, Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) - a.radius - b.radius);
  }
  if (a.kind === "full_reach_circle" && b.kind === "straight_translation_rectangle") return circleRectangleDistance(a, b);
  if (a.kind === "straight_translation_rectangle" && b.kind === "full_reach_circle") return circleRectangleDistance(b, a);
  if (a.kind !== "straight_translation_rectangle" || b.kind !== "straight_translation_rectangle") throw new Error("Unsupported pair shape.");
  // Common translated frame avoids differences of large world-coordinate products.
  const first = corners(a, a.start), second = corners(b, a.start);
  const axes = [a.along, a.left, b.along, b.left];
  const disjoint = axes.some(axis => {
    const p = first.map(point => dot(point, axis)), q = second.map(point => dot(point, axis));
    return Math.max(...p) < Math.min(...q) || Math.max(...q) < Math.min(...p);
  });
  if (!disjoint) return 0;
  let minimum = Infinity;
  for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) {
    minimum = Math.min(minimum, pointSegmentDistance(first[i], second[j], second[(j + 1) % 4]),
      pointSegmentDistance(second[j], first[i], first[(i + 1) % 4]));
  }
  return minimum;
}
function circleRectangleDistance(circle: Circle, rectangle: Rectangle): number {
  const relative = { x: circle.center.x - rectangle.start.x, y: circle.center.y - rectangle.start.y };
  const along = dot(relative, rectangle.along), across = dot(relative, rectangle.left);
  const dx = along - Math.max(0, Math.min(rectangle.length, along));
  const dy = across - Math.max(-rectangle.rightExtent, Math.min(rectangle.leftExtent, across));
  return Math.max(0, Math.hypot(dx, dy) - circle.radius);
}
function corners(shape: Rectangle, origin: XY): XY[] {
  return [[0, -shape.rightExtent], [shape.length, -shape.rightExtent], [shape.length, shape.leftExtent], [0, shape.leftExtent]]
    .map(([along, across]) => ({ x: shape.start.x - origin.x + along * shape.along.x + across * shape.left.x,
      y: shape.start.y - origin.y + along * shape.along.y + across * shape.left.y }));
}
function dot(a: XY, b: XY): number { return a.x * b.x + a.y * b.y; }
function pointSegmentDistance(point: XY, start: XY, end: XY): number {
  const dx = end.x - start.x, dy = end.y - start.y, px = point.x - start.x, py = point.y - start.y;
  const squareLength = dx * dx + dy * dy;
  const ratio = squareLength === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / squareLength));
  return Math.hypot(px - ratio * dx, py - ratio * dy);
}
