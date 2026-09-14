import * as polygonClipping from "polygon-clipping";

import type {
  CornerArmModelCatalogEntry,
  MultiPolygonXY,
  ObstacleZone,
  PivotAngleRange,
  PivotSweep,
  XY,
} from "@cplayout/core";
import { assertMetricCalculationCrs, feetToMeters, squareMetersToAcres } from "@cplayout/core";

import {
  createAnnularSector,
  createCirclePolygon,
  multiPolygonAreaSquareMeters,
  polarOffset,
} from "./geometry";

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
  | "missing_field_boundary"
  | "missing_guidance_path"
  | "guidance_unreachable"
  | "corner_angle_below_min"
  | "corner_angle_above_max"
  | "steering_angle_exceeded"
  | "speed_ratio_above_max"
  | "outside_field_safety_zone"
  | "obstacle_clearance_failed"
  | "geometry_invalid";

export interface CornerArmKinematicInputs {
  projectCrs: string;
  pivotCenter?: XY;
  pivotCenterToLrduRadiusMeters?: number;
  lrduSpeedMetersPerMinuteAt100Percent?: number;
  modelSpec?: CornerArmModelCatalogEntry;
  rotationDirection: CornerArmKinematicRotationDirection;
  orientation: CornerArmKinematicOrientation;
  sweep?: PivotSweep;
  fieldBoundary?: XY[];
  obstacles?: ObstacleZone[];
  guidancePath?: XY[];
  endGunThrowMeters?: number;
  endGunAngleRanges?: PivotAngleRange[];
  sampleAngleStepDegrees?: number;
  physicalBufferMeters?: number;
  safetyZoneMeters?: number;
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
}

const DEFAULT_SAMPLE_STEP_DEGREES = 10;
const DEFAULT_PHYSICAL_BUFFER_METERS = 0.75;
export const CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS = feetToMeters(1);

export function evaluateCornerArmKinematics(inputs: CornerArmKinematicInputs): CornerArmKinematicResult {
  const safetyZoneMeters = Math.max(CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS, inputs.safetyZoneMeters ?? CORNER_ARM_MINIMUM_PHYSICAL_SAFETY_ZONE_METERS);
  const requiredDiagnostics = requiredInputDiagnostics(inputs);

  if (requiredDiagnostics.length > 0) {
    return emptyResult(inputs.modelSpec?.sourceStatus ?? "missing", safetyZoneMeters, requiredDiagnostics, [
      "Corner-arm kinematic calculation is blocked until required projected-XY machine, speed, boundary, and guidance inputs are supplied.",
      "Existing advisory corner-arm envelopes may still be displayed as fallback evidence, but they are not extension/retraction-aware kinematic proof.",
    ]);
  }

  assertMetricCalculationCrs(inputs.projectCrs);
  const pivotCenter = inputs.pivotCenter;
  const fieldBoundary = inputs.fieldBoundary;
  const guidancePath = inputs.guidancePath;
  const modelSpec = inputs.modelSpec;
  if (!pivotCenter || !fieldBoundary || !guidancePath || !modelSpec) {
    return emptyResult(inputs.modelSpec?.sourceStatus ?? "missing", safetyZoneMeters, requiredDiagnostics, []);
  }

  const sweep = inputs.sweep ?? { mode: "full_circle" as const };
  const angles = sampleSweepAngles(sweep, inputs.sampleAngleStepDegrees ?? DEFAULT_SAMPLE_STEP_DEGREES, inputs.rotationDirection);
  const physicalBufferMeters = Math.max(0.1, inputs.physicalBufferMeters ?? DEFAULT_PHYSICAL_BUFFER_METERS);
  const spanLengthMeters = modelSpec.spanLengthMeters;
  const overhangLengthMeters = modelSpec.overhangLengthMeters;
  const orientationSign = (inputs.orientation === "leading" ? 1 : -1) * (inputs.rotationDirection === "counterclockwise" ? 1 : -1);
  const states: CornerArmKinematicState[] = [];
  const physicalClips: ClipMultiPolygon[] = [];
  let elapsedMinutes = 0;

  for (let index = 0; index < angles.length; index += 1) {
    const thetaDegrees = angles[index];
    const thetaRadians = (thetaDegrees * Math.PI) / 180;
    const previousTheta = index === 0 ? thetaDegrees : angles[index - 1];
    const deltaThetaRadians = index === 0 ? 0 : Math.abs(shortestSignedAngleDegrees(previousTheta, thetaDegrees)) * Math.PI / 180;
    const deltaMinutes = (inputs.pivotCenterToLrduRadiusMeters! * deltaThetaRadians) / inputs.lrduSpeedMetersPerMinuteAt100Percent!;
    elapsedMinutes += deltaMinutes;

    // The closing pose must reuse the same trigonometric angle as the opening pose.
    const lrdu = polarOffset(pivotCenter, inputs.pivotCenterToLrduRadiusMeters!, normalizeDegrees(thetaDegrees));
    const guidanceCandidates = circlePolylineIntersections(lrdu, spanLengthMeters, guidancePath);
    if (guidanceCandidates.length === 0) {
      return emptyResult(modelSpec.sourceStatus, safetyZoneMeters, [{ code: "guidance_unreachable", stateIndex: index,
        message: `No arm-length intersection with the guidance path at ${thetaDegrees.toFixed(3)} degrees.` }], []);
    }
    const target = states.at(-1)?.sdu ?? polarOffset(lrdu, spanLengthMeters, thetaDegrees + orientationSign * 90);
    const sdu = guidanceCandidates.reduce((best, candidate) => distance(candidate, target) < distance(best, target) ? candidate : best);
    const vectorAngle = angleDegrees(lrdu, sdu);
    const overhangEndpoint = polarOffset(sdu, overhangLengthMeters, vectorAngle);
    const cornerAngleDegrees = normalizeDegrees(vectorAngle - thetaDegrees);
    const signedCornerAngle = orientationSign > 0 ? cornerAngleDegrees : normalizeDegrees(thetaDegrees - vectorAngle);
    const steeringAngleDegrees = steeringAngleForState(states[states.length - 1], sdu);
    const sduToLrduSpeedRatio = sduSpeedRatio(states[states.length - 1], sdu, deltaMinutes, inputs.lrduSpeedMetersPerMinuteAt100Percent!);
    const stateDiagnostics = stateDiagnosticsFor({
      stateIndex: index,
      modelSpec,
      fieldBoundary,
      safetyZoneMeters,
      obstacles: inputs.obstacles ?? [],
      lrdu,
      sdu,
      overhangEndpoint,
      cornerAngleDegrees: signedCornerAngle,
      steeringAngleDegrees,
      sduToLrduSpeedRatio,
    });

    states.push({
      sequenceIndex: index,
      thetaDegrees: round(thetaDegrees),
      thetaRadians: round(thetaRadians),
      elapsedMinutes: round(elapsedMinutes),
      deltaMinutes: round(deltaMinutes),
      lrdu: roundedPoint(lrdu),
      sdu: roundedPoint(sdu),
      overhangEndpoint: roundedPoint(overhangEndpoint),
      cornerAngleDegrees: round(signedCornerAngle),
      steeringAngleDegrees: round(steeringAngleDegrees),
      sduToLrduSpeedRatio: round(sduToLrduSpeedRatio),
      feasible: stateDiagnostics.length === 0,
      infeasibleDiagnostics: stateDiagnostics,
    });

    // The rigid span and collinear overhang form one member, without a numerical joint at the SDU.
    physicalClips.push(toClipMultiPolygon([[lineSegmentBufferPolygon(lrdu, overhangEndpoint, physicalBufferMeters)]]));
  }

  const lrduPath = states.map((state) => state.lrdu);
  const sduPath = states.map((state) => state.sdu);
  const overhangEndpointPath = states.map((state) => state.overhangEndpoint);
  const sweptPhysicalEnvelope = fromClipMultiPolygon(unionClipMultiPolygons(physicalClips));
  const wettedEndGunEnvelope = buildWettedEndGunEnvelope(inputs, modelSpec, pivotCenter, sweep);
  const infeasibleDiagnostics = states.flatMap((state) => state.infeasibleDiagnostics);
  const endGunControlRows = buildEndGunControlRows(inputs, modelSpec, pivotCenter);

  return {
    status: infeasibleDiagnostics.length === 0 ? "unresolved" : "blocked",
    qualificationBlockers: [
      "Sampled states do not establish continuous swept clearance, branch continuity, or full-cycle steering feasibility.",
      ...(modelSpec.sourceStatus === "scaffold_only" ? ["Equipment specifications require source confirmation."] : []),
    ],
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    scaffoldSourceStatus: modelSpec.sourceStatus,
    safetyZoneMeters: round(safetyZoneMeters),
    lrduPath,
    sduPath,
    overhangEndpointPath,
    sweptPhysicalEnvelope,
    wettedEndGunEnvelope,
    sweptPhysicalEnvelopeAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(sweptPhysicalEnvelope))),
    wettedEndGunEnvelopeAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(wettedEndGunEnvelope))),
    infeasibleDiagnostics,
    endGunControlRows,
    warnings: [
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
    assertMetricCalculationCrs(inputs.projectCrs);
  } catch (error) {
    diagnostics.push({ code: "missing_projected_crs", message: error instanceof Error ? error.message : "Projected CRS is required." });
  }
  if (!inputs.pivotCenter) diagnostics.push({ code: "missing_pivot_center", message: "Pivot center projected XY is required." });
  if (!positiveFinite(inputs.pivotCenterToLrduRadiusMeters)) diagnostics.push({ code: "missing_lrdu_radius", message: "Length to LRDU must be a positive pivot-center-to-LRDU radius in project meters." });
  if (!positiveFinite(inputs.lrduSpeedMetersPerMinuteAt100Percent)) diagnostics.push({ code: "missing_lrdu_speed", message: "LRDU speed must be a positive linear ground speed at 100% timer in meters per minute." });
  if (!inputs.modelSpec) diagnostics.push({ code: "missing_model_spec", message: "A selected corner-arm model spec is required." });
  if (!inputs.fieldBoundary || inputs.fieldBoundary.length < 3) diagnostics.push({ code: "missing_field_boundary", message: "A projected-XY field boundary polygon is required." });
  if (!inputs.guidancePath || inputs.guidancePath.length < 2) diagnostics.push({ code: "missing_guidance_path", message: "A projected-XY SDU guidance path is required for extension/retraction-aware kinematics." });
  if ([inputs.pivotCenter, ...(inputs.fieldBoundary ?? []), ...(inputs.guidancePath ?? [])].some((point) => point && (!Number.isFinite(point.x) || !Number.isFinite(point.y)))
    || (inputs.modelSpec && (!positiveFinite(inputs.modelSpec.spanLengthMeters) || !Number.isFinite(inputs.modelSpec.overhangLengthMeters) || inputs.modelSpec.overhangLengthMeters < 0))
    || (inputs.sampleAngleStepDegrees !== undefined && !positiveFinite(inputs.sampleAngleStepDegrees))
    || (inputs.sweep?.mode === "partial_circle" && (inputs.sweep.direction !== inputs.rotationDirection || !Number.isFinite(inputs.sweep.startAngleDegrees) || !Number.isFinite(inputs.sweep.stopAngleDegrees)))) {
    diagnostics.push({ code: "geometry_invalid", message: "Finite coordinates, valid dimensions and consistent sweep/rotation direction are required." });
  }
  return diagnostics;
}

function stateDiagnosticsFor(input: {
  stateIndex: number;
  modelSpec: CornerArmModelCatalogEntry;
  fieldBoundary: XY[];
  safetyZoneMeters: number;
  obstacles: ObstacleZone[];
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
  const physicalPoints = [input.lrdu, input.sdu, input.overhangEndpoint];
  const minimumDistance = physicalPoints.reduce((minimum, point) => Math.min(minimum, signedBoundaryDistance(point, input.fieldBoundary)), Number.POSITIVE_INFINITY);
  if (minimumDistance < input.safetyZoneMeters) {
    diagnostics.push({ code: "outside_field_safety_zone", stateIndex: input.stateIndex, message: `Physical machine path is within ${input.safetyZoneMeters.toFixed(3)} m safety zone or outside the field boundary.` });
  }
  const blockedObstacle = input.obstacles.find((obstacle) => obstacle.hardConflict && physicalPoints.some((point) => (
    pointInPolygon(point, obstacle.polygon) || distanceToRing(point, obstacle.polygon) < obstacle.bufferMeters
  )));
  if (blockedObstacle) {
    diagnostics.push({ code: "obstacle_clearance_failed", stateIndex: input.stateIndex, message: `Physical machine path conflicts with ${blockedObstacle.name}.` });
  }
  return diagnostics;
}

function buildWettedEndGunEnvelope(
  inputs: CornerArmKinematicInputs,
  modelSpec: CornerArmModelCatalogEntry,
  pivotCenter: XY,
  sweep: PivotSweep,
): MultiPolygonXY {
  const endGunThrowMeters = Math.max(0, inputs.endGunThrowMeters ?? 0);
  if (endGunThrowMeters <= 0) return [];
  const endpointRadius = (inputs.pivotCenterToLrduRadiusMeters ?? 0) + modelSpec.spanLengthMeters + modelSpec.overhangLengthMeters;
  const outerRadius = endpointRadius + endGunThrowMeters;
  const ranges = inputs.endGunAngleRanges?.filter((range) => Number.isFinite(range.startAngleDegrees) && Number.isFinite(range.stopAngleDegrees)) ?? [];
  if (ranges.length === 0) return createAnnularSector(pivotCenter, endpointRadius, outerRadius, sweep);
  return fromClipMultiPolygon(unionClipMultiPolygons(ranges.map((range) => toClipMultiPolygon(createAnnularSector(
    pivotCenter,
    endpointRadius,
    outerRadius,
    { mode: "partial_circle", startAngleDegrees: range.startAngleDegrees, stopAngleDegrees: range.stopAngleDegrees, direction: range.direction },
  )))));
}

function buildEndGunControlRows(
  inputs: CornerArmKinematicInputs,
  modelSpec: CornerArmModelCatalogEntry,
  pivotCenter: XY,
): CornerArmEndGunControlRow[] {
  const endGunThrowMeters = Math.max(0, inputs.endGunThrowMeters ?? 0);
  if (endGunThrowMeters <= 0) return [];
  const radius = (inputs.pivotCenterToLrduRadiusMeters ?? 0) + modelSpec.spanLengthMeters + modelSpec.overhangLengthMeters + endGunThrowMeters;
  return (inputs.endGunAngleRanges ?? []).map((range, index) => ({
    rangeIndex: index,
    startAngleDegrees: round(range.startAngleDegrees),
    stopAngleDegrees: round(range.stopAngleDegrees),
    direction: range.direction,
    startCoordinate: roundedPoint(polarOffset(pivotCenter, radius, range.startAngleDegrees)),
    stopCoordinate: roundedPoint(polarOffset(pivotCenter, radius, range.stopAngleDegrees)),
    advisoryOnly: true,
    canonicalGeometryMutation: false,
  }));
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

function circlePolylineIntersections(center: XY, radius: number, vertices: XY[]): XY[] {
  const intersections: XY[] = [];
  for (let index = 1; index < vertices.length; index += 1) {
    const start = vertices[index - 1];
    const end = vertices[index];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const ux = dx / length;
    const uy = dy / length;
    const along = (center.x - start.x) * ux + (center.y - start.y) * uy;
    const perpendicular = (center.x - start.x) * uy - (center.y - start.y) * ux;
    const square = (radius - Math.abs(perpendicular)) * (radius + Math.abs(perpendicular));
    if (square < 0) continue;
    const offset = Math.sqrt(square);
    for (const position of [along - offset, along + offset]) {
      if (position < 0 || position > length) continue;
      const candidate = { x: start.x + position * ux, y: start.y + position * uy };
      if (!intersections.some((point) => distance(point, candidate) < 1e-9)) intersections.push(candidate);
    }
  }
  return intersections;
}

function nearestPointOnSegment(point: XY, start: XY, end: XY): XY {
  const segmentLengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (segmentLengthSquared === 0) return start;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / segmentLengthSquared));
  return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
}

function steeringAngleForState(previous: CornerArmKinematicState | undefined, sdu: XY): number {
  if (!previous) return 0;
  return shortestSignedAngleDegrees(angleDegrees(previous.sdu, sdu), angleDegrees(previous.lrdu, previous.sdu));
}

function sduSpeedRatio(
  previous: CornerArmKinematicState | undefined,
  sdu: XY,
  deltaMinutes: number,
  lrduSpeedMetersPerMinute: number,
): number {
  if (!previous || deltaMinutes <= 0 || lrduSpeedMetersPerMinute <= 0) return 1;
  return distance(previous.sdu, sdu) / deltaMinutes / lrduSpeedMetersPerMinute;
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
    warnings,
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
  return clips.slice(1).reduce((merged, clip) => polygonClipping.union(merged, clip) as ClipMultiPolygon, clips[0]);
}

function lineSegmentBufferPolygon(start: XY, end: XY, bufferMeters: number): XY[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return createCirclePolygon(start, bufferMeters, 16);
  const offsetX = (-dy / length) * bufferMeters;
  const offsetY = (dx / length) * bufferMeters;
  return [
    { x: start.x + offsetX, y: start.y + offsetY },
    { x: end.x + offsetX, y: end.y + offsetY },
    { x: end.x - offsetX, y: end.y - offsetY },
    { x: start.x - offsetX, y: start.y - offsetY },
  ];
}

function closeRing(ring: XY[]): XY[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.x === last.x && first.y === last.y ? ring : [...ring, first];
}

function signedBoundaryDistance(point: XY, fieldBoundary: XY[]): number {
  const boundaryDistance = distanceToRing(point, fieldBoundary);
  return (pointInPolygon(point, fieldBoundary) ? 1 : -1) * boundaryDistance;
}

function pointInPolygon(point: XY, ring: XY[]): boolean {
  let inside = false;
  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    const intersects = ((current.y > point.y) !== (previous.y > point.y))
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToRing(point: XY, ring: XY[]): number {
  return ring.reduce((minimum, start, index) => Math.min(minimum, distanceToSegment(point, start, ring[(index + 1) % ring.length])), Number.POSITIVE_INFINITY);
}

function distanceToSegment(point: XY, start: XY, end: XY): number {
  return distance(point, nearestPointOnSegment(point, start, end));
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
