import { buildMachinePathSummary } from "./manualDesign";
import type { AdvisoryCornerArmConfig, LayoutResult, PivotProject, XY } from "./types";

const toleranceMeters = 0.001;
const clippingEventBudget = 1_000_000;

/**
 * Consumer budgets, NOT physical equipment maxima or a precision qualification.
 * geometry.ts uses 1 mm conservative sectors, at most 65536 segments, and
 * polygon-clipping's default 1e6 queue/segment limits. For coordinate extent E,
 * differences/products are bounded by 2E / 8E^2; reserve 256 * eventBudget * E^2
 * for accumulated/compensated areas and predicates. A separate 256-ulp allowance
 * covers the two 128-ulp clearance error bounds.
 *
 * These are conservative input bounds, not a topology/conditioning proof or a
 * bound on intersection-generated events. Clipping may still exhaust its own
 * budget; callers must handle calculation failure and check results. Changing
 * consumer tolerances, segment limits or clipping limits requires joint review.
 * Core deliberately has no geometry dependency and does not read process.env.
 */
export const PROJECT_CALCULATION_NUMERIC_BUDGET = Object.freeze({
  toleranceMeters,
  defaultSegments: 288,
  maxConservativeSegments: 65536,
  clippingEventBudget,
  maxProductExtentMeters: Math.sqrt(Number.MAX_VALUE / (256 * clippingEventBudget)),
  maxResolvedExtentMeters: toleranceMeters / (256 * Number.EPSILON),
});

export interface ProjectCalculationBlocker {
  path: string;
  code: string;
  message: string;
}

export interface ProjectCalculationSafety {
  /** Numerical admission only; schema admission and metric CRS qualification are separate. */
  allowed: boolean;
  blockers: ProjectCalculationBlocker[];
}

/** Additional arguments actually consumed by geometry.ts; nothing is written to the project. */
export interface ProjectCalculationInputs {
  /** Used only when the saved machine has no corner arm, matching the geometry consumer. */
  cornerArmPreview?: AdvisoryCornerArmConfig;
  requiredBoundaryClearanceMeters?: number;
}

/** Safe to run the existing draft topology predicates, including on an incomplete boundary. */
export function isBoundaryWithinCalculationBudget(boundary: readonly XY[]): boolean {
  return boundary.length * 2 <= clippingEventBudget && boundary.every((point) => (
    Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.max(Math.abs(point.x), Math.abs(point.y)) <= PROJECT_CALCULATION_NUMERIC_BUDGET.maxResolvedExtentMeters
  ));
}

/**
 * Read-only magnitude/budget checks on a structurally valid project, not a schema
 * parser, transform, geometry engine, height/grid check or field qualification.
 * Explicit finite checks also protect typed callers that bypass JSON admission.
 * Missing optional values contribute no supplied reach; no defaults are persisted.
 */
export function evaluateProjectCalculationSafety(project: PivotProject, inputs: ProjectCalculationInputs = {}): ProjectCalculationSafety {
  const blockers: ProjectCalculationBlocker[] = [];
  const finish = (): ProjectCalculationSafety => ({ allowed: blockers.length === 0, blockers });
  const inspectNumber = (value: number, path: string, minimum?: number): void => {
    if (!Number.isFinite(value)) {
      blockers.push({ path, code: "non_finite_calculation_input", message: "Calculation inputs must be finite numbers." });
    } else if (minimum !== undefined && value < minimum) {
      blockers.push({ path, code: "invalid_calculation_distance", message: "Calculation distances must be nonnegative." });
    }
  };
  const machine = project.machine;
  machine.spanLengthsMeters.forEach((span, index) => inspectNumber(span, `machine.spanLengthsMeters.${index}`, 0));
  for (const key of ["overhangMeters", "endGunThrowMeters", "towerClearanceBufferMeters", "machineClearanceBufferMeters"] as const) {
    inspectNumber(machine[key], `machine.${key}`, 0);
  }
  const corner = machine.cornerArm ?? inputs.cornerArmPreview;
  const cornerPath = machine.cornerArm ? "machine.cornerArm" : "inputs.cornerArmPreview";
  if (corner) {
    inspectNumber(corner.lengthMeters, `${cornerPath}.lengthMeters`, 0);
    for (const key of ["wheelTrackLengthMeters", "overhangLengthMeters", "maxExtensionRateMetersPerMinute", "maxRetractionRateMetersPerMinute"] as const) {
      if (corner[key] !== undefined) inspectNumber(corner[key], `${cornerPath}.${key}`, 0);
    }
  }
  const angles: number[] = [];
  const inspectAngle = (angle: number, path: string): void => {
    inspectNumber(angle, path);
    angles.push(angle);
  };
  if (machine.sweep.mode === "partial_circle") {
    inspectAngle(machine.sweep.startAngleDegrees, "machine.sweep.startAngleDegrees");
    inspectAngle(machine.sweep.stopAngleDegrees, "machine.sweep.stopAngleDegrees");
  }
  machine.endGunAngleRanges?.forEach((range, index) => {
    inspectAngle(range.startAngleDegrees, `machine.endGunAngleRanges.${index}.startAngleDegrees`);
    inspectAngle(range.stopAngleDegrees, `machine.endGunAngleRanges.${index}.stopAngleDegrees`);
  });
  if (corner?.minSteerAngleDegrees !== undefined) inspectAngle(corner.minSteerAngleDegrees, `${cornerPath}.minSteerAngleDegrees`);
  if (corner?.maxSteerAngleDegrees !== undefined) inspectAngle(corner.maxSteerAngleDegrees, `${cornerPath}.maxSteerAngleDegrees`);
  for (const role of ["lrdu", "sdu"] as const) {
    const drive = machine.driveUnits?.[role];
    if (drive?.operatorMeasuredSpeedMetersPerMinute !== undefined) {
      inspectNumber(drive.operatorMeasuredSpeedMetersPerMinute, `machine.driveUnits.${role}.operatorMeasuredSpeedMetersPerMinute`, 0);
    }
  }
  const requiredClearance = project.settings?.layoutReview.requiredBoundaryClearanceMeters;
  if (requiredClearance !== undefined) inspectNumber(requiredClearance, "settings.layoutReview.requiredBoundaryClearanceMeters", 0);
  if (inputs.requiredBoundaryClearanceMeters !== undefined) inspectNumber(inputs.requiredBoundaryClearanceMeters, "inputs.requiredBoundaryClearanceMeters", 0);

  let coordinateMagnitude = 0;
  let coordinatePath = "fieldBoundary";
  let vertexCount = 0;
  const inspectPoint = (point: XY, path: string): void => {
    inspectNumber(point.x, `${path}.x`);
    inspectNumber(point.y, `${path}.y`);
    const magnitude = Math.max(Math.abs(point.x), Math.abs(point.y));
    if (magnitude > coordinateMagnitude) {
      coordinateMagnitude = magnitude;
      coordinatePath = path;
    }
    vertexCount += 1;
  };
  project.fieldBoundary.forEach((point, index) => inspectPoint(point, `fieldBoundary.${index}`));
  inspectPoint(project.pivotCenter, "pivotCenter");
  inspectPoint(project.waterSource, "waterSource");
  inspectPoint(project.powerSource, "powerSource");
  // A bender tail cannot exceed machine reach, but its center may be any survey observation.
  project.surveyPoints.forEach((point, index) => inspectPoint(point.projected, `surveyPoints.${index}.projected`));
  let obstacleBuffer = 0;
  project.obstacles.forEach((obstacle, index) => {
    obstacle.polygon.forEach((point, vertex) => inspectPoint(point, `obstacles.${index}.polygon.${vertex}`));
    inspectNumber(obstacle.bufferMeters, `obstacles.${index}.bufferMeters`, 0);
    obstacleBuffer = Math.max(obstacleBuffer, obstacle.bufferMeters);
  });
  let featureRadius = 0;
  project.mapFeatures?.forEach((feature, index) => {
    const geometry = feature.geometry;
    const path = `mapFeatures.${index}.geometry`;
    if (geometry.type === "Point") inspectPoint(geometry.point, path);
    else if (geometry.type === "Circle") {
      inspectPoint(geometry.center, path);
      inspectNumber(geometry.radiusMeters, `${path}.radiusMeters`, 0);
      featureRadius = Math.max(featureRadius, geometry.radiusMeters);
      vertexCount += PROJECT_CALCULATION_NUMERIC_BUDGET.defaultSegments;
    } else {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      geometry.vertices.forEach((point, vertex) => {
        inspectPoint(point, `${path}.vertices.${vertex}`);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      });
      // Render/advisory consumers can infer machine circles from these outlines.
      if (feature.kind === "machine_zone" || feature.kind === "planning_boundary") {
        featureRadius = Math.max(featureRadius, Math.hypot(maxX - minX, maxY - minY));
      }
    }
  });
  if (blockers.length > 0) return finish();

  const paths = buildMachinePathSummary(machine);
  for (const [value, path, label] of [
    [paths.lastWheelRadiusMeters, "machine.spanLengthsMeters", "Combined span length"],
    [paths.endMachineRadiusMeters, "machine.overhangMeters", "Combined spans and overhang"],
    [paths.endGunReachMeters, "machine.endGunThrowMeters", "Combined spans, overhang and end-gun throw"],
  ] as const) {
    if (!Number.isFinite(value)) {
      blockers.push({ path, code: "non_finite_machine_distance", message: `${label} exceeds finite numeric range; review the supplied distances before calculation.` });
      return finish();
    }
  }
  const cornerReach = corner ? Math.max(corner.lengthMeters, (corner.wheelTrackLengthMeters ?? 0) + (corner.overhangLengthMeters ?? 0)) : 0;
  // The 0.5 m floor is already used by geometry's path buffers, not a saved default.
  const buffer = Math.max(0.5, machine.towerClearanceBufferMeters, machine.machineClearanceBufferMeters)
    + obstacleBuffer + Math.max(requiredClearance ?? 0, inputs.requiredBoundaryClearanceMeters ?? 0);
  const reach = Math.max(paths.endGunReachMeters, paths.lastWheelRadiusMeters + cornerReach + machine.endGunThrowMeters,
    featureRadius + machine.endGunThrowMeters) + buffer;
  // Factor two bounds circumscription and partial-sweep endpoint caps, at every stored center.
  const extent = coordinateMagnitude + 2 * reach;
  if (!Number.isFinite(extent)) {
    blockers.push({ path: coordinatePath, code: "non_finite_geometry_extent", message: "Coordinates plus machine, corner, feature and clearance reach exceed finite range." });
  } else {
    if (extent > PROJECT_CALCULATION_NUMERIC_BUDGET.maxProductExtentMeters) blockers.push({ path: coordinatePath, code: "geometry_product_range", message: "Geometry exceeds the finite area/product accumulation budget." });
    if (extent > PROJECT_CALCULATION_NUMERIC_BUDGET.maxResolvedExtentMeters) blockers.push({ path: coordinatePath, code: "geometry_coordinate_resolution", message: "Geometry exceeds the coordinate resolution budget for the consumer's 1 mm numerical tolerance." });
  }
  const segments = Math.max(PROJECT_CALCULATION_NUMERIC_BUDGET.defaultSegments, Math.ceil(Math.PI / Math.acos(reach / (reach + toleranceMeters))));
  if (!Number.isSafeInteger(segments) || segments > PROJECT_CALCULATION_NUMERIC_BUDGET.maxConservativeSegments) {
    blockers.push({ path: "machine", code: "geometry_segment_budget", message: "Combined reach exceeds the 65536-segment budget for conservative 1 mm coverage." });
  }
  // Reserve the main ring plus three partial-sweep caps, or every end-gun range
  // submitted in one clipping operation, whichever requires more input events.
  const rangeCount = machine.endGunAngleRanges?.length ?? 0;
  const rangeVertices = rangeCount > 0 && Number.isSafeInteger(segments) ? (1 + rangeCount) * (segments + 2) : 0;
  const generatedVertices = Math.max(4 * PROJECT_CALCULATION_NUMERIC_BUDGET.maxConservativeSegments, rangeVertices);
  if (2 * (vertexCount + generatedVertices) > clippingEventBudget) {
    blockers.push({ path: "fieldBoundary", code: "geometry_vertex_budget", message: "Stored geometry and conservative coverage exceed the clipping event budget." });
  }
  if (angles.some((angle) => Math.abs(angle) > Number.MAX_VALUE / (4 * Math.PI))) {
    blockers.push({ path: "machine", code: "geometry_angle_range", message: "Angles exceed finite difference and radian-conversion range." });
  }
  const lrduSpeed = machine.driveUnits?.lrdu?.operatorMeasuredSpeedMetersPerMinute;
  const sduSpeed = machine.driveUnits?.sdu?.operatorMeasuredSpeedMetersPerMinute;
  if (lrduSpeed !== undefined && sduSpeed !== undefined && lrduSpeed > 0 && sduSpeed > 0 && !Number.isFinite(sduSpeed / lrduSpeed)) {
    blockers.push({ path: "machine.driveUnits", code: "non_finite_drive_speed_ratio", message: "Measured drive speeds exceed finite ratio range." });
  }
  return finish();
}

export class ProjectCalculationSafetyError extends RangeError {
  constructor(readonly blockers: readonly ProjectCalculationBlocker[]) {
    super(`Project numerical calculations unavailable: ${blockers.map((issue) => `${issue.path}: ${issue.code}`).join("; ")}.`);
    this.name = "ProjectCalculationSafetyError";
  }
}

/** Call after the CRS guard and before any project-derived geometry arithmetic. */
export function assertProjectCalculationSafe(project: PivotProject, inputs?: ProjectCalculationInputs): void {
  const safety = evaluateProjectCalculationSafety(project, inputs);
  if (!safety.allowed) throw new ProjectCalculationSafetyError(safety.blockers);
}

/**
 * Secondary invariant for calculated results, never a substitute for input gates.
 * Checks all metric values, every polygon/hole vertex, towers and conflict areas.
 * Used by evaluateLayout before returning and by consumers of supplied results.
 */
export function assertLayoutResultFinite(result: LayoutResult): void {
  const inspect = (value: number, path: string): void => {
    if (!Number.isFinite(value)) throw new RangeError(`Layout result contains non-finite numeric data at ${path}.`);
  };
  for (const [key, value] of Object.entries(result.metrics)) {
    if (value !== undefined) inspect(value, `metrics.${key}`);
  }
  for (const key of ["baseCoverage", "endGunCoverage", "allowedCoverage", "outsideFieldCoverage", "obstacles"] as const) {
    result[key].forEach((polygon, polygonIndex) => polygon.forEach((ring, ringIndex) => ring.forEach((point, index) => {
      const path = `${key}.${polygonIndex}.${ringIndex}.${index}`;
      inspect(point.x, `${path}.x`);
      inspect(point.y, `${path}.y`);
    })));
  }
  result.towers.forEach((tower, index) => {
    inspect(tower.towerIndex, `towers.${index}.towerIndex`);
    inspect(tower.radiusMeters, `towers.${index}.radiusMeters`);
    inspect(tower.point.x, `towers.${index}.point.x`);
    inspect(tower.point.y, `towers.${index}.point.y`);
  });
  result.mechanicalConflicts.forEach((conflict, index) => inspect(conflict.areaSquareMeters, `mechanicalConflicts.${index}.areaSquareMeters`));
}
