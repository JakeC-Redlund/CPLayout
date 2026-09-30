import * as polygonClipping from "polygon-clipping";
import * as robustPolygonClipping from "polyclip-ts";

import type {
  CornerArmModelCatalogEntry,
  CrsQualificationOptions,
  MultiPolygonXY,
  ObstacleZone,
  PivotAngleRange,
  PivotSweep,
  XY,
} from "@cplayout/core";
import { assertMetricCalculationCrs, feetToMeters, squareMetersToAcres, FieldCalculationCrsOptionsSchema } from "@cplayout/core";

import {
  createCirclePolygon,
  multiPolygonAreaSquareMeters,
  polarOffset,
} from "./geometry";
import { memberConflictsWithRing, memberInsideRing, memberFieldClearanceMargin, memberObstacleClearanceMargin } from "./cornerMemberClearance";
import { assessCornerInterval, cornerGuidanceEvents, cornerGuidanceIntersections, cornerNumericalGuard,
  type CornerGuidanceRoot, type CornerGuidanceIntersection, type CornerGuidanceEvent,
  type CornerMemberMargin, type CornerIntervalAssessment } from "./cornerContinuousModel";
import { accountCornerFootprints, type CornerFootprintAccounting } from "./cornerPathAccounting";

type ClipPosition = [number, number];
type ClipPolygon = ClipPosition[][];
type ClipMultiPolygon = ClipPolygon[];

export type CornerArmKinematicRotationDirection = "clockwise" | "counterclockwise";
export type CornerArmKinematicOrientation = "leading" | "trailing";
export type CornerArmKinematicStatus = "ready" | "blocked" | "unresolved";
export type CornerArmKinematicDiagnosticCode =
  | "missing_projected_crs"
  | "missing_pivot_center"
  | "missing_lrdu_radius"
  | "missing_lrdu_speed"
  | "missing_model_spec"
  | "invalid_model_spec"
  | "missing_model_provenance"
  | "invalid_model_provenance"
  | "inconsistent_model_provenance"
  | "missing_field_boundary"
  | "missing_guidance_path"
  | "missing_rotation_direction"
  | "invalid_rotation_direction"
  | "missing_orientation"
  | "invalid_orientation"
  | "guidance_unreachable"
  | "guidance_branch_ambiguous"
  | "guidance_initial_position_mismatch"
  | "guidance_direction_reversal"
  | "corner_angle_below_min"
  | "corner_angle_above_max"
  | "steering_angle_exceeded"
  | "speed_ratio_above_max"
  | "outside_field_safety_zone"
  | "obstacle_clearance_failed"
  | "geometry_invalid";

export interface CornerArmKinematicInputs {
  projectCrs: string;
  /** Explicit opt-in for root tracking, guidance events and interval clearance bounds. */
  modelVersion?: "corner-kinematics-v1" | "corner-kinematics-v2";
  /** Arc distance from guidance vertex zero; direction is relative to the supplied vertex order. */
  initialGuidance?: { distanceMeters: number; direction: "forward" | "reverse" };
  crsOptions?: CrsQualificationOptions;
  pivotCenter?: XY;
  pivotCenterToLrduRadiusMeters?: number;
  lrduSpeedMetersPerMinuteAt100Percent?: number;
  modelSpec?: CornerArmModelCatalogEntry;
  rotationDirection?: CornerArmKinematicRotationDirection;
  orientation?: CornerArmKinematicOrientation;
  sweep?: PivotSweep;
  fieldBoundary?: XY[];
  obstacles?: ObstacleZone[];
  guidancePath?: XY[];
  endGunThrowMeters?: number;
  endGunAngleRanges?: PivotAngleRange[];
  sampleAngleStepDegrees?: number;
  physicalBufferMeters?: number;
  safetyZoneMeters?: number;
  /** Explicit opt-in budget; the default preserves the base sample schedule. */
  refinement?: { maxAdditionalSamples: number; minAngleStepDegrees?: number };
  /** Declared baseline geometric wet footprints, including other machines if applicable.
   * Omitted means unknown net additional footprint; [] explicitly declares no baseline. */
  baselineFootprints?: MultiPolygonXY[];
}

export interface CornerArmKinematicState {
  sequenceIndex: number;
  thetaDegrees: number;
  thetaRadians: number;
  elapsedMinutes: number;
  deltaMinutes: number;
  lrdu: XY;
  sdu: XY;
  overhangEndpoint: XY;
  cornerAngleDegrees: number;
  steeringAngleDegrees: number;
  sduToLrduSpeedRatio: number;
  feasible: boolean;
  infeasibleDiagnostics: CornerArmKinematicDiagnostic[];
  guidanceSegmentIndex: number;
  guidanceRoot: CornerGuidanceRoot;
  guidanceBranchId: string;
  /** Null at tangency or when no direction is declared. Existing speed ratio is interval average. */
  instantaneousSduToLrduSpeedRatio: number | null;
  clearanceMargins: CornerMemberMargin[];
  guidanceDistanceMeters: number;
  signedGuidanceTravelMeters: number;
  cornerAngularRateDegreesPerMinute: number;
}

export interface CornerArmKinematicDiagnostic {
  code: CornerArmKinematicDiagnosticCode;
  message: string;
  stateIndex?: number;
}

export interface CornerArmEndGunControlRow {
  rangeIndex: number;
  startAngleDegrees: number;
  stopAngleDegrees: number;
  direction: PivotAngleRange["direction"];
  startCoordinate: XY;
  stopCoordinate: XY;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
}

export interface CornerArmKinematicResult {
  status: CornerArmKinematicStatus;
  qualificationBlockers: string[];
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  scaffoldSourceStatus: CornerArmModelCatalogEntry["sourceStatus"] | "missing";
  safetyZoneMeters: number;
  lrduPath: XY[];
  sduPath: XY[];
  overhangEndpointPath: XY[];
  sweptPhysicalEnvelope: MultiPolygonXY;
  wettedEndGunEnvelope: MultiPolygonXY;
  sweptPhysicalEnvelopeAcres: number;
  wettedEndGunEnvelopeAcres: number;
  infeasibleDiagnostics: CornerArmKinematicDiagnostic[];
  endGunControlRows: CornerArmEndGunControlRow[];
  warnings: string[];
  /** Unrounded calculation states. Consumers must not feed display-rounded paths back into calculations. */
  sampledStates: ReadonlyArray<Readonly<CornerArmKinematicState>>;
  sampling: {
    baseSampleCount: number;
    addedSampleCount: number;
    maxAdditionalSamples: number;
    budgetExhausted: boolean;
    betweenPoseClearance: "unresolved" | "conditionally_clear";
  };
  continuousModel?: {
    version: "corner-kinematics-v2";
    events: Array<CornerGuidanceEvent & { sampled: boolean }>;
    intervals: CornerIntervalAssessment[];
    completeness: "bounded_centerline_intervals" | "unresolved";
    qualification: string;
  };
  pathChecks: { directionReversalStateIndices: number[]; branchDiscontinuityStateIndices: number[]; qualification: string };
  wheelTracks: { lrdu: XY[]; sdu: XY[]; qualification: string };
  /** Union of buffered main and corner members at the evaluated poses only. */
  sampledStructuralEnvelope: MultiPolygonXY;
  sampledStructuralEnvelopeAcres: number;
  /** Raw acreage and field-clipped potential end-gun footprint, with explicit baseline subtraction. */
  footprintAccounting: CornerFootprintAccounting;
}

const DEFAULT_SAMPLE_STEP_DEGREES = 10;
const DEFAULT_PHYSICAL_BUFFER_METERS = 0.75;
const SOURCE_VERIFICATION_WARNING = "Declared source status and artifact metadata are not independently verified by this calculation; matching declared statuses are not artifact proof.";
const MODEL_LIMITS = [
  ["minCornerAngleDegrees", "Minimum corner angle"],
  ["maxCornerAngleDegrees", "Maximum corner angle"],
  ["maxOutwardSteeringAngleDegrees", "Maximum outward steering angle"],
  ["maxInwardSteeringAngleDegrees", "Maximum inward steering angle"],
  ["cornerSpeedRatio", "Maximum SDU/LRDU speed ratio"],
] as const;
export const CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS = feetToMeters(1);

export function evaluateCornerArmKinematics(inputs: CornerArmKinematicInputs): CornerArmKinematicResult {
  const safetyZoneMeters = Math.max(CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS,
    Number.isFinite(inputs.safetyZoneMeters) ? inputs.safetyZoneMeters! : CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS);
  const requiredDiagnostics = requiredInputDiagnostics(inputs);

  if (requiredDiagnostics.length > 0) {
    const provenanceInvalid = requiredDiagnostics.some((diagnostic) => diagnostic.code === "missing_model_provenance"
      || diagnostic.code === "invalid_model_provenance" || diagnostic.code === "inconsistent_model_provenance");
    return emptyResult(provenanceInvalid ? "missing" : inputs.modelSpec?.sourceStatus ?? "missing", safetyZoneMeters, requiredDiagnostics, [
      "Corner-arm kinematic calculation is blocked until valid projected-XY machine, source metadata, speed, boundary, guidance, rotation, and orientation inputs are supplied.",
      "Existing advisory corner-arm envelopes may still be displayed as fallback evidence, but they are not extension/retraction-aware kinematic proof.",
    ]);
  }

  assertMetricCalculationCrs(inputs.projectCrs, inputs.crsOptions);
  const pivotCenter = inputs.pivotCenter;
  const fieldBoundary = inputs.fieldBoundary;
  const guidancePath = inputs.guidancePath;
  const modelSpec = inputs.modelSpec;
  if (!pivotCenter || !fieldBoundary || !guidancePath || !modelSpec || !inputs.rotationDirection || !inputs.orientation) {
    return emptyResult(inputs.modelSpec?.sourceStatus ?? "missing", safetyZoneMeters, requiredDiagnostics, []);
  }

  const sweep = inputs.sweep ?? { mode: "full_circle" as const };
  let angles = sampleSweepAngles(sweep, inputs.sampleAngleStepDegrees ?? DEFAULT_SAMPLE_STEP_DEGREES, inputs.rotationDirection);
  // Evaluate supplied end-gun control boundaries on the same articulated timeline.
  angles = withControlAngles(angles, inputs.endGunAngleRanges ?? []);
  const baseSampleCount = angles.length;
  const advanced = inputs.modelVersion === "corner-kinematics-v2";
  const maxAdditionalSamples = inputs.refinement?.maxAdditionalSamples ?? 0;
  const minAngleStepDegrees = inputs.refinement?.minAngleStepDegrees ?? 0.1;
  const physicalBufferMeters = Math.max(0.1, inputs.physicalBufferMeters ?? DEFAULT_PHYSICAL_BUFFER_METERS);
  const spanLengthMeters = modelSpec.spanLengthMeters;
  const overhangLengthMeters = modelSpec.overhangLengthMeters;
  const orientationSign = (inputs.orientation === "leading" ? 1 : -1) * (inputs.rotationDirection === "counterclockwise" ? 1 : -1);
  const guidanceLength = guidancePath.slice(1).reduce((sum, point, index) => sum + distance(guidancePath[index], point), 0);
  const closedGuidance = distance(guidancePath[0], guidancePath[guidancePath.length - 1]) < 1e-9;
  const guidanceEvents = advanced ? cornerGuidanceEvents(pivotCenter, inputs.pivotCenterToLrduRadiusMeters!, spanLengthMeters, guidancePath, angles) : [];
  // Events count toward the same finite budget as adaptive midpoint samples.
  const sign = angles.at(-1)! >= angles[0] ? 1 : -1;
  for (const event of guidanceEvents) {
    if (angles.length - baseSampleCount >= maxAdditionalSamples) break;
    if (!angles.some(angle => Math.abs(angle - event.thetaDegrees) < 1e-9)) angles.push(event.thetaDegrees);
  }
  angles.sort((a, b) => sign * (a - b));
  const solve = (sampleAngles: number[]): { states: CornerArmKinematicState[]; diagnostic?: CornerArmKinematicDiagnostic } => {
    const states: CornerArmKinematicState[] = [];
    let elapsedMinutes = 0;
    for (let index = 0; index < sampleAngles.length; index += 1) {
      const thetaDegrees = sampleAngles[index];
      const thetaRadians = (thetaDegrees * Math.PI) / 180;
      const previous = states.at(-1);
      const deltaThetaRadians = previous === undefined ? 0 : Math.abs(thetaDegrees - previous.thetaDegrees) * Math.PI / 180;
      const deltaMinutes = (inputs.pivotCenterToLrduRadiusMeters! * deltaThetaRadians) / inputs.lrduSpeedMetersPerMinuteAt100Percent!;
      elapsedMinutes += deltaMinutes;
      const lrdu = polarOffset(pivotCenter, inputs.pivotCenterToLrduRadiusMeters!, normalizeDegrees(thetaDegrees));
      const candidates = cornerGuidanceIntersections(lrdu, spanLengthMeters, guidancePath, advanced);
      if (candidates.length === 0) return { states, diagnostic: { code: "guidance_unreachable", stateIndex: index,
        message: `No arm-length intersection with the guidance path at ${thetaDegrees.toFixed(3)} degrees.` } };
      const target = previous?.sdu ?? polarOffset(lrdu, spanLengthMeters, thetaDegrees + orientationSign * 90);
      const choice = advanced ? selectContinuousGuidance(candidates, previous, inputs.initialGuidance, guidancePath, closedGuidance)
        : { selected: candidates.reduce((best, candidate) => distance(candidate.point, target) < distance(best.point, target) ? candidate : best) };
      if (!choice.selected) return { states, diagnostic: { code: choice.reason ?? "guidance_branch_ambiguous", stateIndex: index,
        message: "An explicit initial guidance position and a unique continuous directed branch are required; no branch was inferred." } };
      const selected = choice.selected;
      const sdu = selected.point;
      const vectorAngle = angleDegrees(lrdu, sdu);
      const overhangEndpoint = polarOffset(sdu, overhangLengthMeters, vectorAngle);
      const signedCornerAngle = normalizeDegrees(orientationSign * (vectorAngle - thetaDegrees));
      let signedGuidanceTravelMeters = previous === undefined ? 0 : selected.distanceAlong - previous.guidanceDistanceMeters;
      if (closedGuidance && guidanceLength > 0 && Math.abs(signedGuidanceTravelMeters) > guidanceLength / 2) {
        signedGuidanceTravelMeters -= Math.sign(signedGuidanceTravelMeters) * guidanceLength;
      }
      const segmentStart = guidancePath[selected.segmentIndex], segmentEnd = guidancePath[selected.segmentIndex + 1];
      const ux = (segmentEnd.x - segmentStart.x) / selected.segmentLength, uy = (segmentEnd.y - segmentStart.y) / selected.segmentLength;
      const qx = sdu.x - lrdu.x, qy = sdu.y - lrdu.y, denominator = qx * ux + qy * uy;
      const numericalGuard = cornerNumericalGuard([lrdu, sdu, segmentStart, segmentEnd], inputs.pivotCenterToLrduRadiusMeters!, spanLengthMeters);
      const instantaneousRate = !advanced || !inputs.initialGuidance || Math.abs(denominator) <= numericalGuard ? null
        : ((qx * -Math.sin(thetaRadians) + qy * Math.cos(thetaRadians)) / denominator)
          * (inputs.rotationDirection === "counterclockwise" ? 1 : -1);
      const instantaneousSduToLrduSpeedRatio = instantaneousRate === null ? null : Math.abs(instantaneousRate);
      const steeringAngleDegrees = advanced && inputs.initialGuidance
        ? shortestSignedAngleDegrees(Math.atan2(uy, ux) * 180 / Math.PI + (inputs.initialGuidance.direction === "reverse" ? 180 : 0), vectorAngle)
        : steeringAngleForState(previous, sdu);
      // Guidance arc distance includes traversal around sampled line turns, rather than its chord.
      const sduToLrduSpeedRatio = previous === undefined || deltaMinutes <= 0 ? 1
        : Math.abs(signedGuidanceTravelMeters) / deltaMinutes / inputs.lrduSpeedMetersPerMinuteAt100Percent!;
      const cornerAngularRateDegreesPerMinute = previous === undefined || deltaMinutes <= 0 ? 0
        : shortestSignedAngleDegrees(previous.cornerAngleDegrees, signedCornerAngle) / deltaMinutes;
      if ((instantaneousSduToLrduSpeedRatio !== null && !Number.isFinite(instantaneousSduToLrduSpeedRatio))
        || ![lrdu, sdu, overhangEndpoint].every(finitePoint)
        || ![thetaDegrees, thetaRadians, elapsedMinutes, deltaMinutes, signedCornerAngle, steeringAngleDegrees,
          sduToLrduSpeedRatio, selected.distanceAlong, signedGuidanceTravelMeters, cornerAngularRateDegreesPerMinute].every(Number.isFinite)) {
        return { states, diagnostic: { code: "geometry_invalid", stateIndex: index, message: "Calculation overflowed finite metric coordinates, timing, or rates." } };
      }
      const stateDiagnostics = stateDiagnosticsFor({ stateIndex: index, modelSpec, fieldBoundary, safetyZoneMeters,
        physicalBufferMeters, obstacles: inputs.obstacles ?? [], pivotCenter, lrdu, sdu, overhangEndpoint,
        cornerAngleDegrees: signedCornerAngle, steeringAngleDegrees,
        sduToLrduSpeedRatio: advanced && instantaneousSduToLrduSpeedRatio !== null ? Math.max(sduToLrduSpeedRatio, instantaneousSduToLrduSpeedRatio) : sduToLrduSpeedRatio });
      if (advanced && inputs.initialGuidance && instantaneousRate !== null
        && instantaneousRate * (inputs.initialGuidance.direction === "forward" ? 1 : -1) < -1e-10) {
        stateDiagnostics.push({ code: "guidance_direction_reversal", stateIndex: index, message: "The instantaneous guidance motion opposes the declared travel direction." });
      }
      const clearanceMargins = memberMarginsFor(pivotCenter, lrdu, overhangEndpoint, fieldBoundary, inputs.obstacles ?? [], physicalBufferMeters, safetyZoneMeters);
      states.push({ sequenceIndex: index, thetaDegrees, thetaRadians, elapsedMinutes, deltaMinutes, lrdu, sdu, overhangEndpoint,
        cornerAngleDegrees: signedCornerAngle, steeringAngleDegrees, sduToLrduSpeedRatio,
        feasible: stateDiagnostics.length === 0, infeasibleDiagnostics: stateDiagnostics,
        guidanceSegmentIndex: selected.segmentIndex, guidanceRoot: selected.root,
        guidanceBranchId: `${selected.segmentIndex}:${selected.root}`, instantaneousSduToLrduSpeedRatio, clearanceMargins,
        guidanceDistanceMeters: selected.distanceAlong,
        signedGuidanceTravelMeters, cornerAngularRateDegreesPerMinute });
    }
    return { states };
  };
  const intervalsFor = (states: CornerArmKinematicState[]) => states.slice(0, -1).map((state, index) => assessCornerInterval(state, states[index + 1], index,
    pivotCenter, inputs.pivotCenterToLrduRadiusMeters!, spanLengthMeters, overhangLengthMeters, guidancePath));
  const refinementsFor = (states: CornerArmKinematicState[]) => advanced
    ? priorityRefinementIntervals(states, intervalsFor(states), minAngleStepDegrees) : refinementIntervals(states, minAngleStepDegrees);
  let solved = solve(angles);
  let refinementNeeded = refinementsFor(solved.states);
  while (!solved.diagnostic && refinementNeeded.length > 0 && angles.length - baseSampleCount < maxAdditionalSamples) {
    const remaining = maxAdditionalSamples - (angles.length - baseSampleCount);
    const selected = new Set(refinementNeeded.slice(0, remaining));
    angles = angles.flatMap((angle, index) => selected.has(index) ? [angle, (angle + angles[index + 1]) / 2] : [angle]);
    solved = solve(angles);
    refinementNeeded = refinementsFor(solved.states);
  }
  if (solved.diagnostic) {
    const empty = emptyResult(modelSpec.sourceStatus, safetyZoneMeters, [solved.diagnostic], []);
    if (solved.diagnostic.code === "guidance_branch_ambiguous") empty.status = "unresolved";
    if (advanced) empty.continuousModel = { version: "corner-kinematics-v2",
      events: guidanceEvents.map(event => ({ ...event, sampled: solved.states.some(state => Math.abs(state.thetaDegrees - event.thetaDegrees) < 1e-9) })),
      intervals: [], completeness: "unresolved", qualification: "Branch solving stopped; no continuous clearance or complete envelope was established." };
    return empty;
  }
  const states = solved.states;
  const intervals = advanced ? intervalsFor(states) : [];
  const sampling: CornerArmKinematicResult["sampling"] = { baseSampleCount, addedSampleCount: angles.length - baseSampleCount,
    maxAdditionalSamples, budgetExhausted: refinementNeeded.length > 0 && angles.length - baseSampleCount >= maxAdditionalSamples,
    betweenPoseClearance: advanced && intervals.length > 0 && intervals.every(interval => interval.status === "conditionally_clear") ? "conditionally_clear" : "unresolved" };
  const physicalClips = states.map(state => toClipMultiPolygon([[lineSegmentBufferPolygon(state.lrdu, state.overhangEndpoint, physicalBufferMeters)]]));
  const mainClips = states.map(state => toClipMultiPolygon([[lineSegmentBufferPolygon(pivotCenter, state.lrdu, physicalBufferMeters)]]));

  const lrduPath = states.map((state) => roundedPoint(state.lrdu));
  const sduPath = states.map((state) => roundedPoint(state.sdu));
  const overhangEndpointPath = states.map((state) => roundedPoint(state.overhangEndpoint));
  const sweptPhysicalEnvelope = fromClipMultiPolygon(unionClipMultiPolygons(physicalClips));
  const sampledStructuralEnvelope = fromClipMultiPolygon(unionClipMultiPolygons([...mainClips, ...physicalClips]));
  const wettedEndGunEnvelope = buildWettedEndGunEnvelope(inputs, states);
  const footprintAccounting = accountCornerFootprints([wettedEndGunEnvelope], fieldBoundary, inputs.baselineFootprints, {
    reachStatus: inputs.endGunThrowMeters === undefined ? "missing" : inputs.endGunThrowMeters === 0 ? "explicit_zero" : "declared",
    noSprayFootprints: (inputs.obstacles ?? []).filter(obstacle => obstacle.noSpray).map(obstacle => [[obstacle.polygon]]),
  });
  const pathChecks = pathChecksFor(states);
  const infeasibleDiagnostics = states.flatMap((state) => state.infeasibleDiagnostics);
  const endGunControlRows = buildEndGunControlRows(inputs, states);

  return {
    status: infeasibleDiagnostics.length === 0 ? "unresolved" : "blocked",
    qualificationBlockers: [
      sampling.betweenPoseClearance === "conditionally_clear"
        ? "Planar geometric member clearance is conditionally bounded; steering, drive limits between poses, terrain and physical safety remain unqualified."
        : "Sampled states do not establish continuous swept clearance, branch continuity, or full-cycle steering feasibility.",
      ...(modelSpec.sourceStatus === "scaffold_only" ? ["Equipment specifications require source confirmation."] : []),
      ...MODEL_LIMITS.filter(([key]) => modelSpec[key] === undefined)
        .map(([, label]) => `${label} is missing; this constraint was not evaluated.`),
    ],
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    scaffoldSourceStatus: modelSpec.sourceStatus,
    safetyZoneMeters: round(safetyZoneMeters),
    lrduPath,
    sduPath,
    overhangEndpointPath,
    sampledStates: Object.freeze(states.map(state => {
      Object.freeze(state.lrdu);
      Object.freeze(state.sdu);
      Object.freeze(state.overhangEndpoint);
      state.clearanceMargins.forEach(Object.freeze);
      Object.freeze(state.clearanceMargins);
      state.infeasibleDiagnostics.forEach(Object.freeze);
      Object.freeze(state.infeasibleDiagnostics);
      return Object.freeze(state);
    })),
    sampling,
    ...(advanced ? { continuousModel: { version: "corner-kinematics-v2" as const,
      events: guidanceEvents.map(event => ({ ...event, sampled: angles.some(angle => Math.abs(angle - event.thetaDegrees) < 1e-9) })),
      intervals, completeness: intervals.length > 0 && intervals.every(interval => interval.centerlineEnclosure !== null)
        ? "bounded_centerline_intervals" as const : "unresolved" as const,
      qualification: "Conditional planar rigid-member bounds with an explicit computational guard; no certified floating-point interval arithmetic, field accuracy, hydraulic, terrain, or continuous drive/steering proof.",
    } } : {}),
    pathChecks,
    wheelTracks: { lrdu: lrduPath, sdu: sduPath, qualification: "Sampled wheel-center polylines, not tire-width footprints or continuous motion proof." },
    sampledStructuralEnvelope,
    sampledStructuralEnvelopeAcres: squareMetersToAcres(multiPolygonAreaSquareMeters(sampledStructuralEnvelope)),
    footprintAccounting,
    sweptPhysicalEnvelope,
    wettedEndGunEnvelope,
    sweptPhysicalEnvelopeAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(sweptPhysicalEnvelope))),
    wettedEndGunEnvelopeAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(wettedEndGunEnvelope))),
    infeasibleDiagnostics,
    endGunControlRows,
    warnings: [
      SOURCE_VERIFICATION_WARNING,
      footprintAccounting.qualification,
      "Sampled footprint accounting includes blocked poses; reported geometric area does not override clearance or motion diagnostics.",
      "Potential end-gun footprint uses discs at actual sampled articulated endpoints; legacy max-reach annulus semantics are retired. No nozzle or irrigation performance is inferred.",
      ...(inputs.endGunThrowMeters === undefined ? ["Potential and net additional footprint areas are unknown because sprinkler reach is missing; legacy empty envelope fields do not assert zero area."] : []),
      ...(inputs.baselineFootprints === undefined ? ["Net additional footprint is unknown because baseline footprints were not explicitly supplied."] : []),
      ...(sampling.budgetExhausted ? ["Refinement budget exhausted or disabled while guidance, clearance, or articulation transitions remain."] : []),
      "Corner-arm kinematics are advisory projected/local XY calculations and do not mutate canonical project geometry, storage, archives, or KML/KMZ exports.",
      "Catalog rows imported from local artifacts remain scaffold-only until confirmed by manufacturer, dealer, or operator source evidence.",
      "Physical swept envelope is separate from wetted/end-gun envelope; water application requires nozzle, pressure, sequencing, and end-gun data before stronger claims.",
      ...(modelSpec.sourceStatus === "scaffold_only" ? ["Selected corner-arm model values are scaffold-only and not production authority."] : []),
    ],
  };
}

function requiredInputDiagnostics(inputs: CornerArmKinematicInputs): CornerArmKinematicDiagnostic[] {
  const diagnostics: CornerArmKinematicDiagnostic[] = [];
  try {
    assertMetricCalculationCrs(inputs.projectCrs, inputs.crsOptions);
  } catch (error) {
    diagnostics.push({ code: "missing_projected_crs", message: error instanceof Error ? error.message : "Projected CRS is required." });
  }
  if (!inputs.pivotCenter) diagnostics.push({ code: "missing_pivot_center", message: "Pivot center projected XY is required." });
  if (!positiveFinite(inputs.pivotCenterToLrduRadiusMeters)) diagnostics.push({ code: "missing_lrdu_radius", message: "Length to LRDU must be a positive pivot-center-to-LRDU radius in project meters." });
  if (!positiveFinite(inputs.lrduSpeedMetersPerMinuteAt100Percent)) diagnostics.push({ code: "missing_lrdu_speed", message: "LRDU speed must be a positive linear ground speed at 100% timer in meters per minute." });
  if (!inputs.modelSpec) diagnostics.push({ code: "missing_model_spec", message: "A selected corner-arm model spec is required." });
  if (inputs.rotationDirection == null) {
    diagnostics.push({ code: "missing_rotation_direction", message: "Select clockwise or counterclockwise rotation explicitly." });
  } else if (inputs.rotationDirection !== "clockwise" && inputs.rotationDirection !== "counterclockwise") {
    diagnostics.push({ code: "invalid_rotation_direction", message: "Rotation direction must be clockwise or counterclockwise." });
  }
  if (inputs.orientation == null) {
    diagnostics.push({ code: "missing_orientation", message: "Select leading or trailing corner-arm orientation explicitly." });
  } else if (inputs.orientation !== "leading" && inputs.orientation !== "trailing") {
    diagnostics.push({ code: "invalid_orientation", message: "Corner-arm orientation must be leading or trailing." });
  }
  if (inputs.modelSpec) {
    diagnostics.push(...modelProvenanceDiagnostics(inputs.modelSpec));
    const model = inputs.modelSpec;
    if (MODEL_LIMITS.some(([key]) => model[key] !== undefined && !Number.isFinite(model[key]))
      || (model.minCornerAngleDegrees !== undefined && model.maxCornerAngleDegrees !== undefined
        && model.minCornerAngleDegrees > model.maxCornerAngleDegrees)
      || (model.maxOutwardSteeringAngleDegrees !== undefined && model.maxOutwardSteeringAngleDegrees < 0)
      || (model.maxInwardSteeringAngleDegrees !== undefined && model.maxInwardSteeringAngleDegrees < 0)
      || (model.cornerSpeedRatio !== undefined && !positiveFinite(model.cornerSpeedRatio))) {
      diagnostics.push({ code: "invalid_model_spec", message: "Supplied model limits must be finite, corner-angle bounds ordered, steering limits nonnegative, and the speed ratio positive." });
    }
  }
  if (!inputs.fieldBoundary || (Array.isArray(inputs.fieldBoundary) && inputs.fieldBoundary.length < 3)) diagnostics.push({ code: "missing_field_boundary", message: "A projected-XY field boundary polygon is required." });
  if (!inputs.guidancePath || (Array.isArray(inputs.guidancePath) && inputs.guidancePath.length < 2)) diagnostics.push({ code: "missing_guidance_path", message: "A projected-XY SDU guidance path is required for extension/retraction-aware kinematics." });
  if ((inputs.modelVersion !== undefined && inputs.modelVersion !== "corner-kinematics-v1" && inputs.modelVersion !== "corner-kinematics-v2")
    || (inputs.initialGuidance !== undefined && (!inputs.initialGuidance || !Number.isFinite(inputs.initialGuidance.distanceMeters)
      || inputs.initialGuidance.distanceMeters < 0 || !["forward", "reverse"].includes(inputs.initialGuidance.direction)))
    || (inputs.pivotCenter != null && !finitePoint(inputs.pivotCenter))
    || (inputs.crsOptions !== undefined && !FieldCalculationCrsOptionsSchema.safeParse(inputs.crsOptions).success)
    || (inputs.fieldBoundary != null && !finitePoints(inputs.fieldBoundary))
    || (inputs.guidancePath != null && !finitePoints(inputs.guidancePath))
    || (inputs.modelSpec && (!positiveFinite(inputs.modelSpec.spanLengthMeters) || !Number.isFinite(inputs.modelSpec.overhangLengthMeters) || inputs.modelSpec.overhangLengthMeters < 0))
    || (inputs.sampleAngleStepDegrees !== undefined && !positiveFinite(inputs.sampleAngleStepDegrees))
    || [inputs.physicalBufferMeters, inputs.safetyZoneMeters].some((value) => value !== undefined && (!Number.isFinite(value) || value < 0))
    || (inputs.endGunThrowMeters !== undefined && (!Number.isFinite(inputs.endGunThrowMeters) || inputs.endGunThrowMeters < 0))
    || (inputs.endGunAngleRanges !== undefined && (!Array.isArray(inputs.endGunAngleRanges)
      || !Array.from(inputs.endGunAngleRanges).every(validAngleRange)))
    || (inputs.refinement !== undefined && !validRefinement(inputs.refinement))
    || (inputs.baselineFootprints !== undefined && (!Array.isArray(inputs.baselineFootprints)
      || !Array.from(inputs.baselineFootprints).every(validMultiPolygon)))
    || (inputs.sweep !== undefined && (inputs.sweep === null || typeof inputs.sweep !== "object"
      || (inputs.sweep.mode !== "full_circle" && inputs.sweep.mode !== "partial_circle")))
    || (inputs.obstacles !== undefined && (!Array.isArray(inputs.obstacles)
      || Array.from(inputs.obstacles).some((obstacle: unknown) => !validClearanceObstacle(obstacle))))
    || (inputs.sweep?.mode === "partial_circle" && (
      (inputs.sweep.direction !== "clockwise" && inputs.sweep.direction !== "counterclockwise")
      || ((inputs.rotationDirection === "clockwise" || inputs.rotationDirection === "counterclockwise") && inputs.sweep.direction !== inputs.rotationDirection)
      || !Number.isFinite(inputs.sweep.startAngleDegrees) || !Number.isFinite(inputs.sweep.stopAngleDegrees)))) {
    diagnostics.push({ code: "geometry_invalid", message: "Finite coordinates, valid dimensions and clearance buffers, hard-obstacle polygons, and consistent sweep/rotation direction are required." });
  }
  return diagnostics;
}

function finitePoint(value: unknown): value is XY {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && "x" in value && "y" in value && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function validAngleRange(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  return "direction" in value && (value.direction === "clockwise" || value.direction === "counterclockwise")
    && "startAngleDegrees" in value && "stopAngleDegrees" in value
    && [value.startAngleDegrees, value.stopAngleDegrees].every(angle => typeof angle === "number" && Number.isFinite(angle) && angle >= 0 && angle <= 360);
}

function validRefinement(value: unknown): boolean {
  if (value === null || typeof value !== "object" || !("maxAdditionalSamples" in value)) return false;
  const maximum = value.maxAdditionalSamples;
  return typeof maximum === "number" && Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= 512
    && (!("minAngleStepDegrees" in value) || value.minAngleStepDegrees === undefined
      || (typeof value.minAngleStepDegrees === "number" && Number.isFinite(value.minAngleStepDegrees)
        && value.minAngleStepDegrees >= 0.000001 && value.minAngleStepDegrees <= 45));
}

function validMultiPolygon(value: unknown): boolean {
  return Array.isArray(value) && Array.from(value).every(polygon => Array.isArray(polygon) && polygon.length > 0
    && Array.from(polygon).every(ring => finitePoints(ring) && ring.length >= 3));
}

function finitePoints(value: unknown): value is XY[] {
  // Array.from visits sparse entries too, so holes cannot evade admission.
  return Array.isArray(value) && Array.from(value).every(finitePoint);
}

function validClearanceObstacle(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || !("hardConflict" in value) || typeof value.hardConflict !== "boolean") return false;
  if (!value.hardConflict && !("noSpray" in value && value.noSpray)) return true;
  return "bufferMeters" in value && typeof value.bufferMeters === "number"
    && Number.isFinite(value.bufferMeters) && value.bufferMeters >= 0
    && "polygon" in value && finitePoints(value.polygon) && value.polygon.length >= 3;
}

function isSourceStatus(value: unknown): value is CornerArmModelCatalogEntry["sourceStatus"] {
  return value === "scaffold_only" || value === "operator_confirmed" || value === "manufacturer_verified";
}

function nonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function modelProvenanceDiagnostics(model: CornerArmModelCatalogEntry): CornerArmKinematicDiagnostic[] {
  const diagnostics: CornerArmKinematicDiagnostic[] = [];
  const refs = model.sourceRefs;
  if (model.sourceStatus == null || refs == null || (Array.isArray(refs) && refs.length === 0)) {
    diagnostics.push({ code: "missing_model_provenance", message: "Model source status and at least one artifact reference are required." });
  }
  const validRefs = Array.isArray(refs) && refs.length > 0 && Array.from(refs).every((ref) => ref !== null && typeof ref === "object"
    && isSourceStatus(ref.sourceStatus) && nonemptyString(ref.sourceId) && nonemptyString(ref.limit)
    && nonemptyString(ref.localEvidencePath) && typeof ref.artifactSha256 === "string" && /^[a-fA-F0-9]{64}$/.test(ref.artifactSha256));
  if ((model.sourceStatus != null && !isSourceStatus(model.sourceStatus))
    || (refs != null && !(Array.isArray(refs) && refs.length === 0) && !validRefs)
    || model.productionReady !== false
    || !["EXTERNAL_OFFICIAL", "PROJECT_UNCONFIRMED", "UNCONFIRMED"].includes(model.normalizedRecordStatus)) {
    diagnostics.push({ code: "invalid_model_provenance", message: "Model provenance must use supported statuses, productionReady=false, and complete artifact reference metadata." });
  }
  // Matching declared metadata is a consistency check, not artifact or manufacturer verification.
  if (validRefs && isSourceStatus(model.sourceStatus) && model.sourceStatus !== "scaffold_only"
    && !refs.some((ref) => ref.sourceStatus === model.sourceStatus)) {
    diagnostics.push({ code: "inconsistent_model_provenance", message: "The claimed model confirmation has no artifact reference with the same declared source status." });
  }
  return diagnostics;
}

function selectContinuousGuidance(candidates: CornerGuidanceIntersection[], previous: CornerArmKinematicState | undefined,
  initial: CornerArmKinematicInputs["initialGuidance"], path: XY[], closed: boolean): {
    selected?: CornerGuidanceIntersection; reason?: "guidance_branch_ambiguous" | "guidance_initial_position_mismatch";
  } {
  const guard = cornerNumericalGuard(path, 1, 1);
  if (!previous) {
    const eligible = initial ? candidates.filter(candidate => Math.abs(candidate.distanceAlong - initial.distanceMeters) <= guard) : candidates;
    if (eligible.length === 1) return { selected: eligible[0] };
    // A vertex has two segment records; choose the outgoing side only when explicitly directed.
    if (initial && eligible.length > 1 && eligible.every(candidate => distance(candidate.point, eligible[0].point) <= guard)) {
      const directed = eligible.filter(candidate => initial.direction === "forward" ? candidate.positionOnSegment <= guard
        : candidate.segmentLength - candidate.positionOnSegment <= guard);
      if (directed.length === 1 && directed[0].root !== 0) return { selected: directed[0] };
    }
    return { reason: eligible.length === 0 ? "guidance_initial_position_mismatch" : "guidance_branch_ambiguous" };
  }
  const sameBranch = candidates.filter(candidate => candidate.segmentIndex === previous.guidanceSegmentIndex
    && (candidate.root === previous.guidanceRoot || candidate.root === 0));
  if (sameBranch.length === 1) return { selected: sameBranch[0] };
  // Tangency does not authorize an arbitrary choice of the two outgoing roots.
  if (previous.guidanceRoot === 0 || !initial) return { reason: "guidance_branch_ambiguous" };
  const step = initial.direction === "forward" ? 1 : -1;
  let nextSegment = previous.guidanceSegmentIndex + step;
  if (closed) nextSegment = (nextSegment + path.length - 1) % (path.length - 1);
  const joint = path[previous.guidanceSegmentIndex + (step > 0 ? 1 : 0)];
  if (!joint || distance(previous.sdu, joint) > guard || nextSegment < 0 || nextSegment >= path.length - 1) return { reason: "guidance_branch_ambiguous" };
  const a = path[nextSegment], b = path[nextSegment + 1];
  const denominator = (previous.sdu.x - previous.lrdu.x) * (b.x - a.x) + (previous.sdu.y - previous.lrdu.y) * (b.y - a.y);
  if (Math.abs(denominator) <= guard * Math.hypot(b.x - a.x, b.y - a.y)) return { reason: "guidance_branch_ambiguous" };
  const continuation = candidates.filter(candidate => candidate.segmentIndex === nextSegment && candidate.root === Math.sign(denominator));
  return continuation.length === 1 ? { selected: continuation[0] } : { reason: "guidance_branch_ambiguous" };
}

function memberMarginsFor(pivot: XY, lrdu: XY, endpoint: XY, field: XY[], obstacles: ObstacleZone[],
  physical: number, safety: number): CornerMemberMargin[] {
  const members = [{ member: "main" as const, start: pivot, end: lrdu }, { member: "corner" as const, start: lrdu, end: endpoint }];
  return members.flatMap(({ member, start, end }) => [
    { member, constraint: "field" as const, constraintId: "field_boundary", marginMeters: memberFieldClearanceMargin(start, end, field, physical + safety) },
    ...obstacles.filter(obstacle => obstacle.hardConflict).map(obstacle => ({ member, constraint: "obstacle" as const,
      constraintId: obstacle.id, marginMeters: memberObstacleClearanceMargin(start, end, obstacle.polygon, physical + obstacle.bufferMeters) })),
  ]);
}

function priorityRefinementIntervals(states: CornerArmKinematicState[], intervals: CornerIntervalAssessment[], minimumStep: number): number[] {
  const legacy = new Set(refinementIntervals(states, minimumStep));
  return intervals.filter(interval => Math.abs(states[interval.endStateIndex].thetaDegrees - states[interval.startStateIndex].thetaDegrees) / 2 >= minimumStep
    && (interval.status === "unresolved" || legacy.has(interval.startStateIndex)))
    .sort((a, b) => {
      const score = (interval: CornerIntervalAssessment) => interval.minimumSampledMarginMeters - (interval.displacementBoundMeters ?? Number.MAX_VALUE);
      return score(a) - score(b) || Math.abs(states[b.endStateIndex].thetaDegrees - states[b.startStateIndex].thetaDegrees)
        - Math.abs(states[a.endStateIndex].thetaDegrees - states[a.startStateIndex].thetaDegrees) || a.startStateIndex - b.startStateIndex;
    }).map(interval => interval.startStateIndex);
}

function stateDiagnosticsFor(input: {
  stateIndex: number;
  modelSpec: CornerArmModelCatalogEntry;
  fieldBoundary: XY[];
  safetyZoneMeters: number;
  physicalBufferMeters: number;
  obstacles: ObstacleZone[];
  pivotCenter: XY;
  lrdu: XY;
  sdu: XY;
  overhangEndpoint: XY;
  cornerAngleDegrees: number;
  steeringAngleDegrees: number;
  sduToLrduSpeedRatio: number;
}): CornerArmKinematicDiagnostic[] {
  const diagnostics: CornerArmKinematicDiagnostic[] = [];
  const minCorner = input.modelSpec.minCornerAngleDegrees;
  const maxCorner = input.modelSpec.maxCornerAngleDegrees;
  if (minCorner !== undefined && input.cornerAngleDegrees < minCorner) {
    diagnostics.push({ code: "corner_angle_below_min", stateIndex: input.stateIndex, message: `Corner angle ${input.cornerAngleDegrees.toFixed(2)} degrees is below scaffold minimum ${minCorner}.` });
  }
  if (maxCorner !== undefined && input.cornerAngleDegrees > maxCorner) {
    diagnostics.push({ code: "corner_angle_above_max", stateIndex: input.stateIndex, message: `Corner angle ${input.cornerAngleDegrees.toFixed(2)} degrees is above scaffold maximum ${maxCorner}.` });
  }
  const steeringLimit = input.steeringAngleDegrees >= 0
    ? input.modelSpec.maxOutwardSteeringAngleDegrees ?? Number.POSITIVE_INFINITY
    : input.modelSpec.maxInwardSteeringAngleDegrees ?? Number.POSITIVE_INFINITY;
  if (Number.isFinite(steeringLimit) && Math.abs(input.steeringAngleDegrees) > steeringLimit) {
    diagnostics.push({ code: "steering_angle_exceeded", stateIndex: input.stateIndex, message: `Steering angle ${input.steeringAngleDegrees.toFixed(2)} degrees exceeds scaffold limit ${steeringLimit}.` });
  }
  if (input.modelSpec.cornerSpeedRatio !== undefined && input.sduToLrduSpeedRatio > input.modelSpec.cornerSpeedRatio) {
    diagnostics.push({ code: "speed_ratio_above_max", stateIndex: input.stateIndex, message: `SDU/LRDU speed ratio ${input.sduToLrduSpeedRatio.toFixed(3)} exceeds scaffold ratio ${input.modelSpec.cornerSpeedRatio}.` });
  }
  // SDU lies on the rigid LRDU-to-overhang member. Check whole members, including
  // the main pivot span, before rounding coordinates for display. The buffer is
  // the member's physical radius; required clearance starts at its outer edge.
  const members: [XY, XY][] = [[input.pivotCenter, input.lrdu], [input.lrdu, input.overhangEndpoint]];
  if (members.some(([start, end]) => !memberInsideRing(start, end, input.fieldBoundary,
    input.physicalBufferMeters + input.safetyZoneMeters))) {
    diagnostics.push({ code: "outside_field_safety_zone", stateIndex: input.stateIndex, message: `Buffered physical machine member is within ${input.safetyZoneMeters.toFixed(3)} m safety zone or outside the field boundary at this sampled pose.` });
  }
  const blockedObstacle = input.obstacles.find((obstacle) => obstacle.hardConflict && members.some(([start, end]) =>
    memberConflictsWithRing(start, end, obstacle.polygon, input.physicalBufferMeters + obstacle.bufferMeters)));
  if (blockedObstacle) {
    diagnostics.push({ code: "obstacle_clearance_failed", stateIndex: input.stateIndex, message: `Buffered physical machine member conflicts with ${blockedObstacle.name} at this sampled pose.` });
  }
  return diagnostics;
}

function buildWettedEndGunEnvelope(inputs: CornerArmKinematicInputs, states: CornerArmKinematicState[]): MultiPolygonXY {
  const throwMeters = inputs.endGunThrowMeters ?? 0;
  if (throwMeters <= 0) return [];
  const ranges = inputs.endGunAngleRanges ?? [];
  return fromClipMultiPolygon(unionClipMultiPolygons(states
    .filter(state => ranges.length === 0 || ranges.some(range => angleInRange(state.thetaDegrees, range)))
    .map(state => toClipMultiPolygon([[createCirclePolygon(state.overhangEndpoint, throwMeters, 64)]]))));
}

function angleInRange(angle: number, range: PivotAngleRange): boolean {
  if (Math.abs(range.stopAngleDegrees - range.startAngleDegrees) === 360) return true;
  const sign = range.direction === "counterclockwise" ? 1 : -1;
  return normalizeDegrees(sign * (angle - range.startAngleDegrees))
    <= normalizeDegrees(sign * (range.stopAngleDegrees - range.startAngleDegrees)) + 1e-10;
}

function withControlAngles(angles: number[], ranges: PivotAngleRange[]): number[] {
  const start = angles[0];
  const end = angles[angles.length - 1];
  const sign = end >= start ? 1 : -1;
  const extra = ranges.flatMap(range => [range.startAngleDegrees, range.stopAngleDegrees])
    .map(angle => start + sign * normalizeDegrees(sign * (angle - start)))
    .filter(angle => sign * (angle - start) <= sign * (end - start));
  return [...new Set([...angles, ...extra])].sort((left, right) => sign * (left - right));
}

function buildEndGunControlRows(inputs: CornerArmKinematicInputs, states: CornerArmKinematicState[]): CornerArmEndGunControlRow[] {
  if ((inputs.endGunThrowMeters ?? 0) <= 0) return [];
  return (inputs.endGunAngleRanges ?? []).flatMap((range, index) => {
    const fullTurn = Math.abs(range.stopAngleDegrees - range.startAngleDegrees) === 360;
    if (fullTurn && Math.abs((states.at(-1)?.thetaDegrees ?? 0) - (states[0]?.thetaDegrees ?? 0)) < 360) return [];
    const start = states.find(state => Math.abs(shortestSignedAngleDegrees(state.thetaDegrees, range.startAngleDegrees)) < 1e-9);
    const stop = (fullTurn ? [...states].reverse() : states)
      .find(state => Math.abs(shortestSignedAngleDegrees(state.thetaDegrees, range.stopAngleDegrees)) < 1e-9);
    if (!start || !stop) return [];
    return [{ rangeIndex: index, startAngleDegrees: range.startAngleDegrees, stopAngleDegrees: range.stopAngleDegrees,
      direction: range.direction, startCoordinate: roundedPoint(start.overhangEndpoint), stopCoordinate: roundedPoint(stop.overhangEndpoint),
      advisoryOnly: true as const, canonicalGeometryMutation: false as const }];
  });
}

function refinementIntervals(states: CornerArmKinematicState[], minimumStep: number): number[] {
  const intervals: number[] = [];
  const clearanceKey = (state: CornerArmKinematicState) => state.infeasibleDiagnostics
    .filter(item => item.code === "obstacle_clearance_failed" || item.code === "outside_field_safety_zone")
    .map(item => item.code).join(",");
  for (let index = 0; index + 1 < states.length; index += 1) {
    const start = states[index];
    const end = states[index + 1];
    if (Math.abs(end.thetaDegrees - start.thetaDegrees) / 2 < minimumStep) continue;
    if (start.guidanceSegmentIndex !== end.guidanceSegmentIndex || clearanceKey(start) !== clearanceKey(end)
      || Math.abs(shortestSignedAngleDegrees(start.cornerAngleDegrees, end.cornerAngleDegrees)) > 10
      || Math.abs(start.sduToLrduSpeedRatio - end.sduToLrduSpeedRatio) > Math.max(0.25, Math.abs(start.sduToLrduSpeedRatio) * 0.2)) intervals.push(index);
  }
  return intervals;
}

function pathChecksFor(states: CornerArmKinematicState[]): CornerArmKinematicResult["pathChecks"] {
  const directionReversalStateIndices: number[] = [];
  const branchDiscontinuityStateIndices: number[] = [];
  let previousDirection = 0;
  for (let index = 1; index < states.length; index += 1) {
    const state = states[index];
    const sign = Math.abs(state.signedGuidanceTravelMeters) < 1e-9 ? 0 : Math.sign(state.signedGuidanceTravelMeters);
    if (sign !== 0 && previousDirection !== 0 && sign !== previousDirection) directionReversalStateIndices.push(index);
    if (sign !== 0) previousDirection = sign;
    if (Math.abs(shortestSignedAngleDegrees(states[index - 1].cornerAngleDegrees, state.cornerAngleDegrees)) > 90) branchDiscontinuityStateIndices.push(index);
  }
  return { directionReversalStateIndices, branchDiscontinuityStateIndices,
    qualification: "Sampled guidance direction reversals and over-90-degree articulation changes are review flags; shortest closed-path traversal and nearest-branch selection do not prove continuity or manufacturer rate limits." };
}

function sampleSweepAngles(sweep: PivotSweep, sampleAngleStepDegrees: number, direction: CornerArmKinematicRotationDirection): number[] {
  const step = Math.max(1, Math.min(45, Math.abs(sampleAngleStepDegrees)));
  if (sweep.mode === "full_circle") {
    const count = Math.max(8, Math.ceil(360 / step));
    return Array.from({ length: count + 1 }, (_value, index) => (index / count) * 360 * (direction === "counterclockwise" ? 1 : -1));
  }
  const delta = sweep.direction === "counterclockwise"
    ? normalizeDegrees(sweep.stopAngleDegrees - sweep.startAngleDegrees)
    : -normalizeDegrees(sweep.startAngleDegrees - sweep.stopAngleDegrees);
  const count = Math.max(1, Math.ceil(Math.abs(delta) / step));
  return Array.from({ length: count + 1 }, (_value, index) => sweep.startAngleDegrees + (delta * index) / count);
}

function steeringAngleForState(previous: CornerArmKinematicState | undefined, sdu: XY): number {
  if (!previous) return 0;
  return shortestSignedAngleDegrees(angleDegrees(previous.sdu, sdu), angleDegrees(previous.lrdu, previous.sdu));
}


function emptyResult(
  scaffoldSourceStatus: CornerArmKinematicResult["scaffoldSourceStatus"],
  safetyZoneMeters: number,
  infeasibleDiagnostics: CornerArmKinematicDiagnostic[],
  warnings: string[],
): CornerArmKinematicResult {
  return {
    status: "blocked",
    qualificationBlockers: infeasibleDiagnostics.map((diagnostic) => diagnostic.message),
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    scaffoldSourceStatus,
    safetyZoneMeters: round(safetyZoneMeters),
    lrduPath: [],
    sduPath: [],
    overhangEndpointPath: [],
    sweptPhysicalEnvelope: [],
    wettedEndGunEnvelope: [],
    sweptPhysicalEnvelopeAcres: 0,
    wettedEndGunEnvelopeAcres: 0,
    infeasibleDiagnostics,
    endGunControlRows: [],
    sampledStates: [],
    sampling: { baseSampleCount: 0, addedSampleCount: 0, maxAdditionalSamples: 0, budgetExhausted: false, betweenPoseClearance: "unresolved" },
    pathChecks: pathChecksFor([]),
    wheelTracks: { lrdu: [], sdu: [], qualification: "No admitted sampled wheel-center tracks." },
    sampledStructuralEnvelope: [],
    sampledStructuralEnvelopeAcres: 0,
    footprintAccounting: accountCornerFootprints([], [], undefined, { reachStatus: "missing" }),
    warnings: [SOURCE_VERIFICATION_WARNING, ...warnings],
  };
}

function toClipMultiPolygon(multiPolygon: MultiPolygonXY): ClipMultiPolygon {
  return multiPolygon.map((polygon) => polygon.map((ring) => closeRing(ring).map((point) => [point.x, point.y] as ClipPosition)));
}

function fromClipMultiPolygon(multiPolygon: ClipMultiPolygon | null): MultiPolygonXY {
  if (!multiPolygon) return [];
  return multiPolygon.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))));
}

function unionClipMultiPolygons(clips: ClipMultiPolygon[]): ClipMultiPolygon {
  if (clips.length === 0) return [];
  if (clips.length === 1) return clips[0];
  return clips.slice(1).reduce((merged, clip) => {
    try {
      return polygonClipping.union(merged, clip) as ClipMultiPolygon;
    } catch {
      // Existing exact-decimal clipping dependency handles nearly coincident cap
      // edges without snapping the canonical/raw coordinates to a display grid.
      return robustPolygonClipping.union(merged, clip) as ClipMultiPolygon;
    }
  }, clips[0]);
}

function lineSegmentBufferPolygon(start: XY, end: XY, bufferMeters: number): XY[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return createCirclePolygon(start, bufferMeters, 32);
  const heading = Math.atan2(dy, dx);
  // Polygonal display envelope includes both end caps. Clearance diagnostics
  // use analytic distances instead of this inscribed arc approximation.
  const cap = (center: XY, startAngle: number): XY[] => Array.from({ length: 17 }, (_value, index) => {
    const angle = startAngle + index * Math.PI / 16;
    return { x: center.x + Math.cos(angle) * bufferMeters, y: center.y + Math.sin(angle) * bufferMeters };
  });
  return [...cap(end, heading - Math.PI / 2), ...cap(start, heading + Math.PI / 2)];
}

function closeRing(ring: XY[]): XY[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.x === last.x && first.y === last.y ? ring : [...ring, first];
}

function angleDegrees(start: XY, end: XY): number {
  return normalizeDegrees((Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI);
}

function shortestSignedAngleDegrees(fromDegrees: number, toDegrees: number): number {
  const delta = normalizeDegrees(toDegrees - fromDegrees);
  return delta > 180 ? delta - 360 : delta;
}

function normalizeDegrees(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function distance(left: XY, right: XY): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function roundedPoint(point: XY): XY {
  return { x: round(point.x), y: round(point.y) };
}

function positiveFinite(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
