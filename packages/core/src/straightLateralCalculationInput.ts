import { z } from "zod";
import { qualifyProjectCrs, type CrsQualification, type CrsQualificationOptions } from "./crsQualification";
import { FieldCalculationCrsOptionsSchema, type FieldCalculationKey, type FieldCalculationRequest } from "./fieldCalculationInput";
import { validateFieldDesign, type FieldDesign, type FieldInfrastructurePoint } from "./fieldDesignDocument";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { validateDraftBoundary } from "./manualDesign";
import { PROJECT_CALCULATION_NUMERIC_BUDGET, type ProjectCalculationBlocker } from "./projectCalculationSafety";
import type { StraightLateralMachine } from "./straightLateral";
import type { XY } from "./types";

/** Finite computational limits, not maximum real equipment sizes or accuracy qualification. */
export const STRAIGHT_LATERAL_CALCULATION_BUDGET = Object.freeze({
  maxRingVertices: 2048, maxTotalVertices: 8192,
  maxResolvedExtentMeters: PROJECT_CALCULATION_NUMERIC_BUDGET.maxResolvedExtentMeters,
  headingUnitVectorTolerance: 1e-10,
});

export interface StraightLateralCalculationContext {
  key: FieldCalculationKey;
  field: FieldDesign;
  machine: StraightLateralMachine;
  crsOptions: CrsQualificationOptions;
  crsQualification: CrsQualification;
  waterSource?: FieldInfrastructurePoint;
  powerSource?: FieldInfrastructurePoint;
  /** An electrical connection is optional in this model; no drive/power requirement is inferred. */
  unknowns: readonly ["hydraulic_capacity", "pressure", "application_uniformity", "nozzle_package", "terrain", "drive_power_requirement", "machine_pair_clearance"];
}
export type StraightLateralCalculationInput = StraightLateralCalculationContext & (
  | { status: "ready"; blockers: []; travelLengthMeters: number; travelUnit: XY; leftUnit: XY; numericalGuardMeters: number }
  | { status: "unsupported"; blockers: ProjectCalculationBlocker[] }
);

const requestSchema = z.object({
  machineId: z.string().min(1), inputRevision: z.number().int().nonnegative().safe(),
  expectedRevision: z.number().int().nonnegative().safe().optional(), crsOptions: FieldCalculationCrsOptionsSchema.optional(),
}).strict();

/** Detached admission for the selected lateral only; neither map lines nor pivots become lateral equipment. */
export function createStraightLateralCalculationInput(inputField: FieldDesign, inputRequest: FieldCalculationRequest): StraightLateralCalculationInput {
  const field = validateFieldDesign(inputField);
  const request = requestSchema.parse(snapshotJsonValue(inputRequest, "straight lateral request"));
  if (request.expectedRevision !== undefined && request.expectedRevision !== request.inputRevision) {
    throw new Error("Field revision changed; rebuild the straight lateral calculation input.");
  }
  const machine = field.lateralMachines?.find(item => item.id === request.machineId);
  if (!machine) throw new Error("Straight lateral machine was not found in this field.");
  const crsOptions = request.crsOptions ?? {};
  const crsQualification = qualifyProjectCrs(field.projectCrs, crsOptions);
  const waterSource = field.infrastructure.find(item => item.id === machine.waterSourceId && item.kind === "water_source");
  const powerSource = field.infrastructure.find(item => item.id === machine.powerSourceId && item.kind === "power_source");
  const context: StraightLateralCalculationContext = {
    key: { fieldId: field.id, machineId: machine.id, inputRevision: request.inputRevision }, field, machine, crsOptions, crsQualification,
    ...(waterSource ? { waterSource } : {}), ...(powerSource ? { powerSource } : {}),
    unknowns: ["hydraulic_capacity", "pressure", "application_uniformity", "nozzle_package", "terrain", "drive_power_requirement", "machine_pair_clearance"],
  };
  const blockers: ProjectCalculationBlocker[] = crsQualification.calculation.blockers.map(code => ({
    path: "projectCrs", code, message: `Metric planar calculation is unavailable: ${code}. Stored XY remains unchanged.`,
  }));
  const block = (path: string, code: string, message: string) => blockers.push({ path, code, message });
  if (!waterSource) block("machine.waterSourceId", "water_source_missing", "Associate an actual field water source with this straight lateral before calculation.");

  const rings = [{ path: "fieldBoundary", vertices: field.fieldBoundary },
    ...field.obstacles.map((obstacle, index) => ({ path: `obstacles.${index}.polygon`, vertices: obstacle.polygon }))];
  const points = rings.flatMap(ring => ring.vertices).concat([machine.travel.start, machine.travel.end]);
  const totalVertices = points.length;
  if (totalVertices > STRAIGHT_LATERAL_CALCULATION_BUDGET.maxTotalVertices
    || rings.some(ring => ring.vertices.length > STRAIGHT_LATERAL_CALCULATION_BUDGET.maxRingVertices)) {
    block("fieldBoundary", "geometry_vertex_budget", "Straight lateral analysis exceeds its bounded ring/vertex budget.");
  }
  const coordinateMagnitude = points.reduce((maximum, point) => Math.max(maximum, Math.abs(point.x), Math.abs(point.y)), 0);
  const obstacleBuffer = field.obstacles.reduce((maximum, obstacle) => Math.max(maximum, obstacle.bufferMeters), 0);
  const boundaryClearance = field.settings?.layoutReview.requiredBoundaryClearanceMeters ?? 0;
  const reach = machine.leftExtentMeters + machine.rightExtentMeters + machine.machineClearanceBufferMeters
    + (machine.sprinklerReachMeters ?? 0) + obstacleBuffer + boundaryClearance;
  const extent = coordinateMagnitude + 2 * reach;
  if (!Number.isFinite(extent) || extent > STRAIGHT_LATERAL_CALCULATION_BUDGET.maxResolvedExtentMeters) {
    block("machine", "geometry_coordinate_resolution", "Straight lateral coordinates, dimensions and buffers exceed the finite calculation-resolution budget.");
  }
  // Budget and CRS gates precede coordinate differences, topology and trigonometry.
  if (blockers.length > 0) return { ...context, status: "unsupported", blockers };
  for (const ring of rings) {
    for (const issue of validateDraftBoundary(ring.vertices)) block(ring.path, issue.code, issue.message);
  }
  const dx = machine.travel.end.x - machine.travel.start.x;
  const dy = machine.travel.end.y - machine.travel.start.y;
  const travelLengthMeters = Math.hypot(dx, dy);
  const numericalGuardMeters = Math.max(1e-9, 64 * Number.EPSILON * (coordinateMagnitude + reach));
  if (!(travelLengthMeters > numericalGuardMeters)
    || machine.leftExtentMeters + machine.rightExtentMeters <= numericalGuardMeters
    || [machine.leftExtentMeters, machine.rightExtentMeters, machine.machineClearanceBufferMeters,
      machine.sprinklerReachMeters ?? 0, obstacleBuffer, boundaryClearance].some(value => value > 0 && value <= numericalGuardMeters)) {
    block("machine", "geometry_dimension_resolution", "A supplied travel distance, physical extent or clearance is below this coordinate frame's numerical resolution guard.");
    return { ...context, status: "unsupported", blockers };
  }
  const travelUnit = { x: dx / travelLengthMeters, y: dy / travelLengthMeters };
  const radians = machine.travelHeadingDegrees * Math.PI / 180;
  if (Math.hypot(travelUnit.x - Math.cos(radians), travelUnit.y - Math.sin(radians))
    > STRAIGHT_LATERAL_CALCULATION_BUDGET.headingUnitVectorTolerance + 2 * numericalGuardMeters / travelLengthMeters) {
    block("machine.travelHeadingDegrees", "travel_heading_mismatch", "Declared travel heading must agree with the directed start-to-end straight path; geometry is never rotated or relabeled to fit it.");
  }
  if (!(travelLengthMeters > 0) || !Number.isFinite(travelLengthMeters)) {
    block("machine.travel", "invalid_travel_length", "Straight travel must have a finite positive length.");
  }
  if (blockers.length > 0) return { ...context, status: "unsupported", blockers };
  return { ...context, status: "ready", blockers: [], travelLengthMeters, travelUnit, numericalGuardMeters,
    leftUnit: { x: -travelUnit.y, y: travelUnit.x } };
}
