import assert from "node:assert/strict";

import {
  calculateTowerPoints,
  buildLayoutPathOverlays,
  createSectorPolygon,
  endGunRadiusMeters,
  evaluateCornerArmPath,
  evaluateMechanicalConflicts,
  evaluateLayout,
  evaluateMachineBoundaryClearance,
  lrduAnchorRadiusMeters,
  machineRadiusMeters,
  multiPolygonAreaSquareMeters,
  polygonAreaSquareMeters,
  validateWetCoverageWithinField,
} from "./geometry";
import { sampleProject, willRheaJasonHarmelinkExampleProject } from "@cplayout/core";

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function testPointInPolygon(point: { x: number; y: number }, ring: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    const cross = (point.y - previous.y) * (current.x - previous.x) - (point.x - previous.x) * (current.y - previous.y);
    const dot = (point.x - previous.x) * (current.x - previous.x) + (point.y - previous.y) * (current.y - previous.y);
    const lengthSquared = (current.x - previous.x) ** 2 + (current.y - previous.y) ** 2;
    if (Math.abs(cross) <= 0.000001 && dot >= 0 && dot <= lengthSquared) return true;
    const intersects = ((current.y > point.y) !== (previous.y > point.y))
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function assertCenterlinesStayInsideField(overlays: ReturnType<typeof buildLayoutPathOverlays>, fieldBoundary: typeof square): void {
  for (const overlay of overlays) {
    for (const segment of overlay.centerlineSegments) {
      for (const point of segment) {
        assert.equal(testPointInPolygon(point, fieldBoundary), true, `${overlay.kind} centerline point must stay inside field boundary`);
      }
    }
  }
}

assert.equal(polygonAreaSquareMeters(square), 10000);

const machineRadius = machineRadiusMeters(sampleProject.machine);
assert.equal(machineRadius, 207.3);
assert.equal(lrduAnchorRadiusMeters(sampleProject.machine), 188.8);

const towers = calculateTowerPoints({ x: 0, y: 0 }, sampleProject.machine, 0);
assert.deepEqual(towers.map((tower) => Number(tower.radiusMeters.toFixed(1))), [47.2, 94.4, 141.6, 188.8]);

const willRheaPathOverlays = buildLayoutPathOverlays(willRheaJasonHarmelinkExampleProject);
const willRheaCombinedPath = willRheaPathOverlays.find((overlay) => overlay.machinePathRoles.includes("last_wheel"));
assert.equal(willRheaJasonHarmelinkExampleProject.fieldBoundary.length, 61);
assert.equal(Number(willRheaCombinedPath?.radiusMeters.toFixed(1)), 462.9);
assert.deepEqual(willRheaCombinedPath?.machinePathRoles, ["last_wheel", "machine_end"]);
assert.equal(willRheaCombinedPath?.coincidentPath, true);
assert.equal(willRheaPathOverlays.some((overlay) => overlay.kind.startsWith("corner_arm")), false);
assert.equal(Number(evaluateLayout(willRheaJasonHarmelinkExampleProject).metrics.outsideFieldAcres.toFixed(3)), 74.691);

const sector = createSectorPolygon(
  { x: 0, y: 0 },
  10,
  { mode: "partial_circle", startAngleDegrees: 350, stopAngleDegrees: 20, direction: "counterclockwise" },
  36,
);
assert.ok(sector.length > 4);

const result = evaluateLayout(sampleProject);
assert.ok(result.metrics.fieldAcres > 120);
assert.ok(result.metrics.irrigatedAcres > 25);
assert.ok(result.metrics.coveragePercent > 15);
assert.ok(result.metrics.noSprayConflictCount >= 0);
assert.ok(result.metrics.hardMechanicalConflictCount >= 0);
assert.ok(result.warnings.length >= 1);

const fieldBoundedProject = {
  ...sampleProject,
  // Synthetic metre-grid arithmetic, not georeferenced field evidence.
  projectCrs: "EPSG:32613",
  fieldBoundary: square,
  pivotCenter: { x: 50, y: 50 },
  machine: {
    ...sampleProject.machine,
    spanLengthsMeters: [20],
    overhangMeters: 0,
    endGunThrowMeters: 0,
    sweep: { mode: "full_circle" as const },
  },
  obstacles: [],
  surveyPoints: [],
};

assert.equal(validateWetCoverageWithinField(fieldBoundedProject).feasible, true);

const boundaryCrossing = validateWetCoverageWithinField({
  ...fieldBoundedProject,
  pivotCenter: { x: 90, y: 50 },
});
assert.equal(boundaryCrossing.feasible, false);
assert.ok(boundaryCrossing.outsideFieldAreaSquareMeters > 0);

const endGunFullSweep = evaluateLayout(fieldBoundedProject);
const endGunArcProject = {
  ...fieldBoundedProject,
  machine: {
    ...fieldBoundedProject.machine,
    endGunThrowMeters: 20,
    endGunAngleRanges: [
      { startAngleDegrees: 0, stopAngleDegrees: 90, direction: "counterclockwise" as const },
    ],
  },
};
const endGunArcResult = evaluateLayout(endGunArcProject);
const fullEndGunProject = {
  ...fieldBoundedProject,
  machine: {
    ...fieldBoundedProject.machine,
    endGunThrowMeters: 20,
    endGunAngleRanges: [],
  },
};
const fullEndGunResult = evaluateLayout(fullEndGunProject);
assert.equal(endGunRadiusMeters(endGunArcProject.machine), 40);
assert.ok(endGunArcResult.metrics.endGunAcres > endGunFullSweep.metrics.endGunAcres);
assert.ok(endGunArcResult.metrics.endGunAcres < fullEndGunResult.metrics.endGunAcres);

const hardConflictProject = {
  ...fieldBoundedProject,
  machine: {
    ...fieldBoundedProject.machine,
    spanLengthsMeters: [35],
    towerClearanceBufferMeters: 4,
    machineClearanceBufferMeters: 4,
  },
  obstacles: [
    {
      id: "tower-road",
      name: "Tower road crossing",
      kind: "road" as const,
      polygon: [
        { x: 82, y: 46 },
        { x: 90, y: 46 },
        { x: 90, y: 54 },
        { x: 82, y: 54 },
      ],
      bufferMeters: 0,
      hardConflict: true,
      noSpray: false,
      confidence: "user_estimated" as const,
    },
  ],
};
const hardConflictResult = evaluateLayout(hardConflictProject);
assert.equal(hardConflictResult.metrics.noSprayConflictCount, 0);
assert.equal(hardConflictResult.metrics.hardMechanicalConflictCount, 1);
assert.equal(hardConflictResult.metrics.towerTrackConflictCount, 1);
assert.ok(evaluateMechanicalConflicts(hardConflictProject).some((conflict) => conflict.conflictType === "tower_track"));

const beforePathOverlayProjectGeometry = JSON.stringify({
  fieldBoundary: fieldBoundedProject.fieldBoundary,
  machine: fieldBoundedProject.machine,
  pivotCenter: fieldBoundedProject.pivotCenter,
});
const fullCirclePathOverlays = buildLayoutPathOverlays({
  ...fieldBoundedProject,
  machine: {
    ...fieldBoundedProject.machine,
    spanLengthsMeters: [15, 20],
    overhangMeters: 5,
    towerClearanceBufferMeters: 2,
    machineClearanceBufferMeters: 3,
  },
});
const fullCircleStandardOverlays = fullCirclePathOverlays.filter((overlay) => overlay.kind === "wheel_track" || overlay.kind === "end_of_machine");
const fullCircleDefaultCornerArmOverlays = fullCirclePathOverlays.filter((overlay) => overlay.kind === "corner_arm_wheel_track" || overlay.kind === "corner_arm_overhang_end");
assert.deepEqual(fullCirclePathOverlays.map((overlay) => overlay.kind), ["wheel_track", "wheel_track", "end_of_machine"]);
assert.deepEqual(fullCirclePathOverlays.filter((overlay) => overlay.kind === "wheel_track").map((overlay) => overlay.radiusMeters), [15, 35]);
assert.equal(fullCirclePathOverlays[0]?.towerIndex, 1);
assert.equal(fullCircleStandardOverlays.find((overlay) => overlay.kind === "end_of_machine")?.radiusMeters, 40);
assert.equal(fullCircleStandardOverlays.find((overlay) => overlay.kind === "end_of_machine")?.bufferMeters, 3);
assert.ok(fullCircleStandardOverlays.every((overlay) => overlay.centerlineSegments.length === 1));
assert.ok(fullCircleStandardOverlays.every((overlay) => overlay.centerlineSegments[0].length > 100));
assert.ok(fullCirclePathOverlays.every((overlay) => overlay.advisoryOnly === true));
assert.ok(fullCirclePathOverlays.every((overlay) => overlay.canonicalGeometryMutation === false));
assert.ok(fullCirclePathOverlays.every((overlay) => multiPolygonAreaSquareMeters(overlay.insideFieldEnvelope) > 0));
assert.ok(fullCircleStandardOverlays.every((overlay) => multiPolygonAreaSquareMeters(overlay.outsideFieldEnvelope) === 0));
assert.equal(fullCircleDefaultCornerArmOverlays.length, 0);
assert.equal(evaluateCornerArmPath(fieldBoundedProject), null);
assertCenterlinesStayInsideField(fullCirclePathOverlays, fieldBoundedProject.fieldBoundary);
assert.equal(JSON.stringify({
  fieldBoundary: fieldBoundedProject.fieldBoundary,
  machine: fieldBoundedProject.machine,
  pivotCenter: fieldBoundedProject.pivotCenter,
}), beforePathOverlayProjectGeometry);

const partialOutsidePathOverlays = buildLayoutPathOverlays({
  ...fieldBoundedProject,
  pivotCenter: { x: 90, y: 50 },
  machine: {
    ...fieldBoundedProject.machine,
    spanLengthsMeters: [35],
    overhangMeters: 10,
    towerClearanceBufferMeters: 4,
    machineClearanceBufferMeters: 5,
    sweep: { mode: "partial_circle", startAngleDegrees: 260, stopAngleDegrees: 40, direction: "counterclockwise" as const },
  },
});
const partialTowerOverlay = partialOutsidePathOverlays.find((overlay) => overlay.kind === "wheel_track");
const partialMachineOverlay = partialOutsidePathOverlays.find((overlay) => overlay.kind === "end_of_machine");
assert.ok(partialTowerOverlay);
assert.ok(partialMachineOverlay);
assert.ok(multiPolygonAreaSquareMeters(partialTowerOverlay.insideFieldEnvelope) > 0);
assert.ok(multiPolygonAreaSquareMeters(partialTowerOverlay.outsideFieldEnvelope) > 0);
assert.equal(partialMachineOverlay.radiusMeters, 45);
assert.ok(multiPolygonAreaSquareMeters(partialMachineOverlay.outsideFieldEnvelope) > 0);
assertCenterlinesStayInsideField(partialOutsidePathOverlays, fieldBoundedProject.fieldBoundary);

const clearanceRows = evaluateMachineBoundaryClearance(fieldBoundedProject, {
  layoutReview: {
    requiredBoundaryClearanceMeters: 25,
    showMachineBoundaryDistances: true,
  },
});
assert.deepEqual(clearanceRows.map((row) => row.kind), ["pivot_center", "wheel_track"]);
assert.equal(clearanceRows.every((row) => row.advisoryOnly === true && row.canonicalGeometryMutation === false), true);
assert.equal(clearanceRows.find((row) => row.kind === "pivot_center")?.minimumBoundaryDistanceMeters, 50);
assert.equal(clearanceRows.find((row) => row.kind === "wheel_track")?.minimumBoundaryDistanceMeters, 30);
assert.deepEqual(buildLayoutPathOverlays(fieldBoundedProject)[0]?.machinePathRoles, ["last_wheel", "machine_end"]);
assert.equal(buildLayoutPathOverlays(fieldBoundedProject)[0]?.coincidentPath, true);
assert.equal(clearanceRows.find((row) => row.kind === "wheel_track")?.sampledPointCount, 0);

const strictClearanceRows = evaluateMachineBoundaryClearance(fieldBoundedProject, {
  layoutReview: {
    requiredBoundaryClearanceMeters: 35,
    showMachineBoundaryDistances: true,
  },
});
const strictMachineRow = strictClearanceRows.find((row) => row.kind === "wheel_track");
assert.equal(strictMachineRow?.meetsRequiredBoundaryClearance, false);
assert.equal(strictMachineRow?.clearanceShortfallMeters, 5);

const partialOutsideClearanceRows = evaluateMachineBoundaryClearance({
  ...fieldBoundedProject,
  pivotCenter: { x: 90, y: 50 },
  machine: {
    ...fieldBoundedProject.machine,
    spanLengthsMeters: [35],
    overhangMeters: 10,
    endGunThrowMeters: 5,
    sweep: { mode: "partial_circle", startAngleDegrees: 260, stopAngleDegrees: 40, direction: "counterclockwise" as const },
  },
});
assert.ok((partialOutsideClearanceRows.find((row) => row.kind === "end_of_machine")?.minimumBoundaryDistanceMeters ?? 0) < 0);
assert.ok(partialOutsideClearanceRows.some((row) => row.kind === "end_gun_reach"));

const explicitCornerPreview = buildLayoutPathOverlays(fieldBoundedProject, {
  cornerArmPreview: {
    id: "explicit-corner-preview",
    name: "Explicit corner preview",
    advisoryOnly: true,
    lengthMeters: 15,
    guidanceType: "operator_supplied",
    sequencingType: "operator_supplied",
    orientation: "unknown",
    confidence: "user_estimated",
    sourceRefs: [{ sourceId: "SRC-EXPLICIT-PREVIEW", limit: "Synthetic explicit preview test." }],
  },
});
assert.equal(explicitCornerPreview.filter((overlay) => overlay.kind.startsWith("corner_arm")).length, 2);
assert.match(evaluateCornerArmPath(fieldBoundedProject, { cornerArmPreview: {
  id: "explicit-corner-preview",
  name: "Explicit corner preview",
  advisoryOnly: true,
  lengthMeters: 15,
  guidanceType: "operator_supplied",
  sequencingType: "operator_supplied",
  orientation: "unknown",
  confidence: "user_estimated",
  sourceRefs: [{ sourceId: "SRC-EXPLICIT-PREVIEW", limit: "Synthetic explicit preview test." }],
} })?.warnings.join("\n") ?? "", /explicitly enabled/);

const cornerArmFallbackProject = {
  ...fieldBoundedProject,
  machine: {
    ...fieldBoundedProject.machine,
    spanLengthsMeters: [20],
    overhangMeters: 10,
    endGunThrowMeters: 0,
    cornerArm: {
      id: "corner-arm-fallback",
      name: "Corner arm fallback",
      advisoryOnly: true as const,
      lengthMeters: 15,
      guidanceType: "operator_supplied" as const,
      sequencingType: "operator_supplied" as const,
      orientation: "operator_supplied" as const,
      confidence: "user_estimated" as const,
      sourceRefs: [{
        sourceId: "SRC-TEST-CORNER",
        limit: "Synthetic advisory test source only.",
      }],
    },
  },
};
const cornerArmFallbackOverlays = buildLayoutPathOverlays(cornerArmFallbackProject);
assert.deepEqual(cornerArmFallbackOverlays.map((overlay) => overlay.kind), ["wheel_track", "end_of_machine", "corner_arm_wheel_track", "corner_arm_overhang_end"]);
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "end_of_machine")?.radiusMeters, 30);
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.radiusMeters, 35);
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.radiusMeters, 35);
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.wheelOverhangSeparationVerified, false);
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.anchorRadiusMeters, 20);
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.pathModel, "max_extension_envelope");
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.modelFamily, "single_span_lrdu_sdu");
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.extensionEvidenceSource, "none");
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.extensionSlopeDomain, "angle_degrees");
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.maxExtensionMeters, 15);
assert.ok((cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.sampledPathPointCount ?? 0) > 0);
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.centerlineSegments.length, 1);
assert.equal(cornerArmFallbackOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.centerlineSegments.length, 1);

const beforeCornerArmPathEvaluation = JSON.stringify(evaluateLayout(cornerArmFallbackProject).metrics);
const cornerArmPath = evaluateCornerArmPath(cornerArmFallbackProject);
assert.ok(cornerArmPath);
assert.equal(cornerArmPath.anchorRadiusMeters, 20);
assert.equal(cornerArmPath.maxExtensionMeters, 15);
assert.equal(cornerArmPath.wheelTrackRadiusMeters, 35);
assert.equal(cornerArmPath.overhangEndRadiusMeters, 35);
assert.equal(cornerArmPath.advisoryOnly, true);
assert.equal(cornerArmPath.canonicalGeometryMutation, false);
assert.equal(cornerArmPath.wheelTrackCenterlineSegments.length, 1);
assert.equal(cornerArmPath.overhangEndCenterlineSegments.length, 1);
assert.equal(cornerArmPath.constraintSummary.safetyZoneMeters, 4.572);
assert.equal(cornerArmPath.constraintSummary.speedRatio.status, "not_available");
assert.match(cornerArmPath.warnings.join("\n"), /max-extension envelope/);
assert.equal(JSON.stringify(evaluateLayout(cornerArmFallbackProject).metrics), beforeCornerArmPathEvaluation);

const cornerArmSeparatedProject = {
  ...cornerArmFallbackProject,
  machine: {
    ...cornerArmFallbackProject.machine,
    cornerArm: {
      ...cornerArmFallbackProject.machine.cornerArm,
      wheelTrackLengthMeters: 10,
      overhangLengthMeters: 5,
    },
  },
  mapFeatures: [{
    id: "corner-limit",
    name: "Corner limit",
    kind: "corner_swing_limit" as const,
    geometry: {
      type: "Polygon" as const,
      vertices: [
        { x: 50, y: 50 },
        { x: 100, y: 50 },
        { x: 100, y: 100 },
        { x: 50, y: 100 },
      ],
    },
    confidence: "user_estimated" as const,
  }],
};
const beforeCornerArmSeparated = JSON.stringify(cornerArmSeparatedProject);
const cornerArmSeparatedOverlays = buildLayoutPathOverlays(cornerArmSeparatedProject);
assert.equal(cornerArmSeparatedOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.radiusMeters, 30);
assert.equal(cornerArmSeparatedOverlays.find((overlay) => overlay.kind === "corner_arm_overhang_end")?.radiusMeters, 35);
assert.equal(cornerArmSeparatedOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.wheelOverhangSeparationVerified, true);
assert.deepEqual(cornerArmSeparatedOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.evidenceFeatureIds, ["corner-limit"]);
assert.equal(cornerArmSeparatedOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.pathModel, "corner_swing_limit_variable_reach");
assert.equal(cornerArmSeparatedOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.extensionEvidenceSource, "corner_swing_limit");
assert.ok((cornerArmSeparatedOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.sampledPathPointCount ?? 0) > 0);
assert.ok((cornerArmSeparatedOverlays.find((overlay) => overlay.kind === "corner_arm_wheel_track")?.sampledPathPointCount ?? 999) < (cornerArmPath?.sampledPathPointCount ?? 0));
const cornerArmSeparatedPath = evaluateCornerArmPath(cornerArmSeparatedProject);
assert.ok(cornerArmSeparatedPath);
assert.deepEqual(cornerArmSeparatedPath.evidenceFeatureIds, ["corner-limit"]);
assert.equal(cornerArmSeparatedPath.pathModel, "corner_swing_limit_variable_reach");
assert.equal(cornerArmSeparatedPath.extensionSlopeSummary.domain, "angle_degrees");
assert.ok(cornerArmSeparatedPath.wheelTrackCenterlineSegments.length >= 1);
assert.ok(cornerArmSeparatedPath.overhangEndCenterlineSegments.length >= 1);
assert.notDeepEqual(cornerArmSeparatedPath.wheelTrackCenterlineSegments, cornerArmSeparatedPath.overhangEndCenterlineSegments);
assert.equal(JSON.stringify(cornerArmSeparatedProject), beforeCornerArmSeparated);

const cornerArmConstraintPath = evaluateCornerArmPath({
  ...cornerArmFallbackProject,
  machine: {
    ...cornerArmFallbackProject.machine,
    driveUnits: {
      lrdu: {
        role: "lrdu" as const,
        advisoryOnly: true as const,
        operatorMeasuredSpeedMetersPerMinute: 2,
        sourceRefs: [{ sourceId: "SRC-LRDU-MEASURED", limit: "Synthetic LRDU speed evidence." }],
        caveats: [],
      },
      sdu: {
        role: "sdu" as const,
        advisoryOnly: true as const,
        operatorMeasuredSpeedMetersPerMinute: 1,
        sourceRefs: [{ sourceId: "SRC-SDU-MEASURED", limit: "Synthetic SDU speed evidence." }],
        caveats: [],
      },
    },
    cornerArm: {
      ...cornerArmFallbackProject.machine.cornerArm,
      maxSteerAngleDegrees: 100,
      minSteerAngleDegrees: -10,
      maxExtensionRateMetersPerMinute: 0.5,
      maxRetractionRateMetersPerMinute: 0.4,
    },
  },
  mapFeatures: [{
    id: "planning-limit",
    name: "Planning limit",
    kind: "planning_boundary" as const,
    geometry: {
      type: "Polygon" as const,
      vertices: [
        { x: 10, y: 10 },
        { x: 80, y: 10 },
        { x: 80, y: 80 },
        { x: 10, y: 80 },
      ],
    },
    confidence: "user_estimated" as const,
  }],
}, {
  settings: {
    layoutReview: {
      requiredBoundaryClearanceMeters: 25,
      showMachineBoundaryDistances: true,
    },
  },
});
assert.ok(cornerArmConstraintPath);
assert.equal(cornerArmConstraintPath.constraintSummary.activeFieldBoundary.status, "shortfall");
assert.equal(cornerArmConstraintPath.constraintSummary.activeFieldBoundary.shortfallMeters, 10);
assert.equal(cornerArmConstraintPath.constraintSummary.planningBoundary.status, "shortfall");
assert.deepEqual(cornerArmConstraintPath.constraintSummary.planningBoundary.evidenceFeatureIds, ["planning-limit"]);
assert.equal(cornerArmConstraintPath.constraintSummary.speedRatio.status, "operator_measured");
assert.equal(cornerArmConstraintPath.constraintSummary.speedRatio.sduToLrduRatio, 0.5);
assert.equal(cornerArmConstraintPath.constraintSummary.steering.status, "source_backed");
assert.equal(cornerArmConstraintPath.constraintSummary.extensionRate.status, "source_backed");

const dualSpanCornerArmPath = evaluateCornerArmPath({
  ...cornerArmFallbackProject,
  machine: {
    ...cornerArmFallbackProject.machine,
    cornerArm: {
      ...cornerArmFallbackProject.machine.cornerArm,
      modelFamily: "dualspan" as const,
    },
  },
});
assert.ok(dualSpanCornerArmPath);
assert.equal(dualSpanCornerArmPath.modelFamily, "dualspan");
assert.match(dualSpanCornerArmPath.warnings.join("\n"), /DualSpan/);

assert.throws(
  () => evaluateLayout({ ...sampleProject, projectCrs: "EPSG:4326" }),
  /Metric planar calculations unavailable.*geographic_input_only/,
);

console.log("geometry tests passed");
