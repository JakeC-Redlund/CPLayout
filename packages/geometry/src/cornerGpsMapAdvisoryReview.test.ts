import assert from "node:assert/strict";

import type { PivotMachine, PivotProject } from "@cplayout/core";
import { feetToMeters, parseCornerGpsMapLegacyEvidence } from "@cplayout/core";

import { evaluateCornerGpsMapAdvisoryReview } from "./cornerGpsMapAdvisoryReview";

const readyProject = makeProject();
const beforeReadyReview = structuredClone(readyProject);
const readyReview = evaluateCornerGpsMapAdvisoryReview(readyProject);
assert.equal(readyReview.status, "ready");
assert.equal(readyReview.advisoryOnly, true);
assert.equal(readyReview.canonicalGeometryMutation, false);
assert.equal(readyReview.unverifiedManufacturerKinematics, true);
assert.equal(readyReview.qualifiedReviewRequired, true);
assert.equal(readyReview.compatibility.sduLrduSteering, "unverified");
assert.equal(readyReview.compatibility.ggsControllerExport, "unverified");
assert.equal(readyReview.compatibility.vriControllerExport, "unverified");
assert.equal(readyReview.compatibility.sprinklerSequencing, "unverified");
assert.ok((readyReview.metrics.lrduBoundaryClearanceMeters ?? 0) > feetToMeters(35));
assert.equal(readyReview.advisoryPathFeatureIds.length, 0);
assert.equal(readyReview.metrics.legacyEvidenceCount, 0);
assert.ok(readyReview.violations.some((violation) => violation.code === "unverified_sdu_lrdu_steering"));
assert.ok(readyReview.issues.some((issue) => issue.code === "missing_guidance_path_evidence"));
assert.ok(readyReview.issues.some((issue) => issue.code === "no_obstacle_evidence"));
assert.deepEqual(readyProject, beforeReadyReview);

const pathFeatureReview = evaluateCornerGpsMapAdvisoryReview(makeProject({
  mapFeatures: [{
    id: "corner-review-zone",
    name: "Corner review zone",
    kind: "corner_swing_limit",
    geometry: {
      type: "Polygon",
      vertices: [
        { x: 780, y: 780 },
        { x: 960, y: 780 },
        { x: 960, y: 960 },
      ],
    },
    confidence: "user_estimated",
    properties: {
      evidenceOnly: true,
      canonicalGeometryMutation: false,
    },
  }],
}));
assert.deepEqual(pathFeatureReview.advisoryPathFeatureIds, ["corner-review-zone"]);

const blockedReview = evaluateCornerGpsMapAdvisoryReview(makeProject({
  machine: machine({ spanLengthsMeters: [495] }),
}));
assert.equal(blockedReview.status, "blocked");
assert.ok(blockedReview.issues.some((issue) => issue.code === "lrdu_boundary_clearance_shortfall" && (issue.shortfallMeters ?? 0) > 0));
const lrduViolation = blockedReview.violations.find((violation) => violation.code === "lrdu_boundary_clearance_shortfall");
assert.equal(lrduViolation?.severity, "blocker");
assert.ok((lrduViolation?.measuredMeters ?? 0) < (lrduViolation?.thresholdMeters ?? 0));
assert.ok((lrduViolation?.shortfallMeters ?? 0) > 0);

const endGunReview = evaluateCornerGpsMapAdvisoryReview(makeProject({
  machine: machine({ spanLengthsMeters: [300], endGunThrowMeters: 220 }),
}));
assert.equal(endGunReview.status, "ready");
assert.ok(endGunReview.issues.some((issue) => issue.code === "end_gun_boundary_review"));

const obstacleReview = evaluateCornerGpsMapAdvisoryReview(makeProject({
  obstacles: [{
    id: "service-road",
    name: "Service road",
    kind: "road",
    polygon: [
      { x: 798, y: 470 },
      { x: 820, y: 470 },
      { x: 820, y: 530 },
      { x: 798, y: 530 },
    ],
    bufferMeters: 5,
    hardConflict: true,
    noSpray: true,
    confidence: "user_estimated",
  }],
}));
assert.equal(obstacleReview.status, "ready");
assert.ok(obstacleReview.issues.some((issue) => issue.code === "obstacle_clearance_review"));

const missingBoundaryReview = evaluateCornerGpsMapAdvisoryReview(makeProject({
  fieldBoundary: [],
}));
assert.equal(missingBoundaryReview.status, "blocked");
assert.ok(missingBoundaryReview.issues.some((issue) => issue.code === "missing_projected_boundary"));

const legacyEvidence = parseCornerGpsMapLegacyEvidence("vri", `zone,ratePercent,status
1,45,OK
2,80,Warning: operator review
3,90,Violation: rate exceeds synthetic limit
`, {
  sourceRef: {
    sourceId: "SRC-SYNTHETIC-VRI",
    title: "Synthetic VRI fixture",
    checkedAt: "2026-06-07",
    limit: "Synthetic parser fixture only.",
  },
});
const legacyReviewProject = makeProject({
  machine: machine({
    cornerArm: {
      id: "synthetic-corner-arm",
      name: "Synthetic advisory corner",
      advisoryOnly: true,
      lengthMeters: feetToMeters(181),
      guidanceType: "gps_guidance",
      sequencingType: "unknown",
      orientation: "operator_supplied",
      confidence: "imported_cad",
      sourceRefs: [{
        sourceId: "SRC-SYNTHETIC-CORNER-MODEL",
        title: "Synthetic CornerGPSMap model",
        checkedAt: "2026-06-07",
        limit: "Synthetic metadata only.",
      }],
    },
  }),
  mapFeatures: [{
    id: "operator-corner-swing",
    name: "Operator corner swing",
    kind: "corner_swing_limit",
    geometry: {
      type: "LineString",
      vertices: [
        { x: 500, y: 500 },
        { x: 820, y: 820 },
      ],
    },
    confidence: "imported_cad",
    properties: {
      evidenceOnly: true,
      canonicalGeometryMutation: false,
    },
  }],
});
const beforeLegacyReview = structuredClone(legacyReviewProject);
const legacyReview = evaluateCornerGpsMapAdvisoryReview(legacyReviewProject, {
  legacyEvidence: [legacyEvidence],
  modelPreset: {
    modelId: "17",
    name: "Synthetic VFlex",
    kind: "pivot",
    cornerType: "Single",
    cornerLengthMeters: feetToMeters(181),
    minLrduBoundaryDistanceMeters: feetToMeters(35),
    minCornerAngleDegrees: 75,
    maxCornerAngleDegrees: 162,
    rawAttributes: {},
    sourceRef: {
      sourceId: "SRC-SYNTHETIC-MODEL",
      title: "Synthetic model preset",
      checkedAt: "2026-06-07",
      limit: "Synthetic metadata only.",
    },
  },
});
assert.equal(legacyReview.metrics.legacyEvidenceCount, 1);
assert.deepEqual(legacyReview.legacyEvidenceKinds, ["vri"]);
assert.equal(legacyReview.metrics.modelMinCornerAngleDegrees, 75);
assert.equal(legacyReview.metrics.modelMaxCornerAngleDegrees, 162);
assert.ok(legacyReview.issues.some((issue) => issue.code === "legacy_vri_vri_zone_summary"));
assert.ok(legacyReview.issues.some((issue) => issue.code === "model_corner_angle_limits_advisory"));
assert.ok(legacyReview.violations.some((violation) => violation.code.includes("legacy_vri_violation")));
assert.ok(legacyReview.violations.some((violation) => violation.sourceRefIds.includes("SRC-SYNTHETIC-VRI")));
assert.deepEqual(legacyReviewProject, beforeLegacyReview);

assert.deepEqual(readyProject.fieldBoundary, makeProject().fieldBoundary);

console.log("CornerGPSMap advisory review tests passed");

function makeProject(overrides: Partial<PivotProject> = {}): PivotProject {
  return {
    id: "corner-gps-map-review-test",
    name: "CornerGPSMap review test",
    // Synthetic metre-grid arithmetic, not georeferenced field evidence.
    projectCrs: "EPSG:32613",
    unitSystem: "metric",
    fieldBoundary: overrides.fieldBoundary ?? [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ],
    pivotCenter: overrides.pivotCenter ?? { x: 500, y: 500 },
    waterSource: overrides.waterSource ?? { x: 20, y: 20 },
    powerSource: overrides.powerSource ?? { x: 980, y: 20 },
    machine: overrides.machine ?? machine(),
    obstacles: overrides.obstacles ?? [],
    surveyPoints: overrides.surveyPoints ?? [],
    mapFeatures: overrides.mapFeatures ?? [],
    settings: overrides.settings,
    mapPackages: overrides.mapPackages,
  };
}

function machine(overrides: Partial<PivotMachine> = {}): PivotMachine {
  return {
    id: "review-machine",
    name: "Review machine",
    spanLengthsMeters: overrides.spanLengthsMeters ?? [300],
    overhangMeters: overrides.overhangMeters ?? 0,
    endGunThrowMeters: overrides.endGunThrowMeters ?? 0,
    towerClearanceBufferMeters: overrides.towerClearanceBufferMeters ?? 3,
    machineClearanceBufferMeters: overrides.machineClearanceBufferMeters ?? 5,
    sweep: overrides.sweep ?? { mode: "full_circle" },
    endGunAngleRanges: overrides.endGunAngleRanges,
    catalogSelection: overrides.catalogSelection,
    cornerArm: overrides.cornerArm,
  };
}
