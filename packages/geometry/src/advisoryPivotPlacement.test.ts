import assert from "node:assert/strict";

import type { ObstacleZone, PivotMachine, PivotProject, ProjectMapFeature, SurveyPoint, XY } from "@cplayout/core";

import {
  analyzeAdvisoryMultiMachineLayout,
  analyzeAdvisoryObstacleInteractions,
  analyzeIdealPivotCenter,
  buildAdvisoryEndGunSensitivityReview,
  buildAdvisoryGeneratedMultiPivotScenarioReview,
  buildAdvisoryRadiusSensitivityReview,
  buildAdvisorySweepEfficiencyReview,
  buildPivotPlacementCandidates,
  compareAdvisoryMachineStrategies,
  evaluateAdvisoryCornerArm,
  planAdvisoryFieldPivots,
} from "./advisoryPivotPlacement";
import { evaluateLayout } from "./geometry";

const field: XY[] = [
  { x: 0, y: 0 },
  { x: 220, y: 0 },
  { x: 220, y: 140 },
  { x: 150, y: 140 },
  { x: 150, y: 80 },
  { x: 0, y: 80 },
];

const accessLane: ProjectMapFeature = {
  id: "north-access",
  name: "North access lane",
  kind: "access_lane",
  geometry: { type: "LineString", vertices: [{ x: 0, y: 130 }, { x: 220, y: 130 }] },
  confidence: "user_estimated",
};

const bufferedObstacle: ObstacleZone = {
  id: "center-buffer",
  name: "Center buffer",
  kind: "building",
  polygon: [
    { x: 88, y: 38 },
    { x: 112, y: 38 },
    { x: 112, y: 62 },
    { x: 88, y: 62 },
  ],
  bufferMeters: 14,
  hardConflict: true,
  noSpray: true,
  confidence: "user_estimated",
};

const project = makeProject({
  obstacles: [bufferedObstacle],
  mapFeatures: [accessLane],
  waterSource: { x: 20, y: 20 },
  powerSource: { x: 20, y: 130 },
});

const firstRun = buildPivotPlacementCandidates(project, {
  gridDivisions: 8,
  maxCandidates: 5,
  waterSourceWeight: 10,
  powerSourceWeight: 8,
  accessWeight: 6,
});
const secondRun = buildPivotPlacementCandidates(project, {
  gridDivisions: 8,
  maxCandidates: 5,
  waterSourceWeight: 10,
  powerSourceWeight: 8,
  accessWeight: 6,
});
assert.ok(firstRun.length > 0);
assert.deepEqual(firstRun.map((candidate) => candidate.id), secondRun.map((candidate) => candidate.id));
assert.deepEqual(project.pivotCenter, { x: 30, y: 40 });
assert.ok(firstRun.some((candidate) => candidate.sourceSeed === "maximum_inscribed_circle"));
assert.ok(firstRun.every((candidate) => candidate.canonicalGeometryMutation === false));
assert.ok(firstRun.every((candidate) => candidate.insideFieldBoundary === true));
assert.ok(firstRun.every((candidate) => candidate.boundaryClearanceMeters >= 0));
assert.ok(firstRun.every((candidate) => Number.isFinite(candidate.distanceFromCurrentMeters)));
assert.ok(firstRun.every((candidate) => candidate.dryCornerPolygons.length > 0));
assert.ok(firstRun.every((candidate) => Number.isFinite(candidate.scoreBreakdown.waterSourceProximity)));
assert.ok(firstRun.some((candidate) => candidate.minimumObstacleClearanceMeters !== null));

const readyProject = makeProject({
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ],
  pivotCenter: { x: 25, y: 100 },
  waterSource: { x: 25, y: 100 },
  powerSource: { x: 30, y: 95 },
  obstacles: [],
  mapFeatures: [],
});
const idealAnalysis = analyzeIdealPivotCenter(readyProject, {
  gridDivisions: 8,
  maxCandidates: 5,
  waterSourceWeight: 10,
  powerSourceWeight: 8,
  accessWeight: 6,
});
assert.equal(idealAnalysis.status, "ready");
assert.equal(idealAnalysis.advisoryOnly, true);
assert.equal(idealAnalysis.canonicalGeometryMutation, false);
assert.equal(idealAnalysis.qualifiedReviewRequired, true);
assert.equal(idealAnalysis.bestCandidate?.id, idealAnalysis.candidates[0].id);
assert.equal(idealAnalysis.bestCandidate?.insideFieldBoundary, true);
assert.ok((idealAnalysis.bestCandidate?.boundaryClearanceMeters ?? -1) >= 0);
assert.ok(idealAnalysis.warnings.some((warning) => warning.includes("does not mutate canonical projected XY")));
assert.ok(idealAnalysis.sourceRefs.length > 0);
assert.equal(idealAnalysis.machineZoneReviews.length, 0);
assert.deepEqual(readyProject.pivotCenter, { x: 25, y: 100 });

const machineZone: ProjectMapFeature = {
  id: "zone-a",
  name: "Zone A",
  kind: "machine_zone",
  geometry: {
    type: "Polygon",
    vertices: [
      { x: 0, y: 0 },
      { x: 160, y: 0 },
      { x: 160, y: 160 },
      { x: 0, y: 160 },
    ],
  },
  confidence: "user_estimated",
  properties: { advisoryOnly: true, canonicalGeometryMutation: false },
};
const zoneAnalysis = analyzeIdealPivotCenter({ ...readyProject, mapFeatures: [machineZone] }, {
  gridDivisions: 6,
  maxCandidates: 3,
  costInput: {
    fixedMachineCost: 100000,
    costPerMeter: 500,
    costPerTower: 2500,
    currencyCode: "USD",
  },
});
assert.equal(zoneAnalysis.status, "ready");
assert.equal(zoneAnalysis.machineZoneReviews.length, 1);
assert.equal(zoneAnalysis.machineZoneReviews[0].status, "ready");
assert.equal(zoneAnalysis.machineZoneReviews[0].canonicalGeometryMutation, false);
assert.equal(zoneAnalysis.bestCandidate?.costAssessment.status, "complete");
assert.ok((zoneAnalysis.bestCandidate?.costAssessment.costPerIrrigatedAcre ?? 0) > 0);
assert.ok(Number.isFinite(zoneAnalysis.bestCandidate?.scoreBreakdown.costEfficiency));

const obstacleInteractionProject = makeProject({
  ...readyProject,
  obstacles: [{
    id: "pump-house",
    name: "Pump house",
    kind: "building",
    polygon: [
      { x: 78, y: 96 },
      { x: 88, y: 96 },
      { x: 88, y: 106 },
      { x: 78, y: 106 },
    ],
    bufferMeters: 5,
    hardConflict: true,
    noSpray: true,
    confidence: "user_estimated",
  }, {
    id: "grassed-ditch",
    name: "Grassed ditch",
    kind: "ditch",
    polygon: [
      { x: 34, y: 126 },
      { x: 54, y: 126 },
      { x: 54, y: 136 },
      { x: 34, y: 136 },
    ],
    bufferMeters: 2,
    hardConflict: false,
    noSpray: true,
    confidence: "user_estimated",
  }],
  mapFeatures: [{
    id: "well-under-span",
    name: "Well under span",
    kind: "well_location",
    geometry: { type: "Point", point: { x: 70, y: 100 } },
    confidence: "user_estimated",
  }, {
    id: "pump-under-span",
    name: "Pump under span",
    kind: "pump_location",
    geometry: { type: "Point", point: { x: 75, y: 115 } },
    confidence: "user_estimated",
  }, {
    id: "tower-track-well",
    name: "Tower track well",
    kind: "well_location",
    geometry: { type: "Point", point: { x: 56, y: 100 } },
    confidence: "user_estimated",
  }, {
    id: "tower-power-pole",
    name: "Power pole on tower track",
    kind: "power_pole",
    geometry: { type: "Point", point: { x: 55, y: 100 } },
    confidence: "user_estimated",
  }, {
    id: "buried-main",
    name: "Buried main crossing",
    kind: "underground_pipeline",
    geometry: { type: "LineString", vertices: [{ x: 20, y: 90 }, { x: 90, y: 90 }] },
    confidence: "user_estimated",
  }, {
    id: "buried-wire",
    name: "Buried wire crossing",
    kind: "underground_wire",
    geometry: { type: "LineString", vertices: [{ x: 20, y: 110 }, { x: 90, y: 110 }] },
    confidence: "user_estimated",
  }, {
    id: "overhead-power",
    name: "Overhead power crossing",
    kind: "power_line",
    geometry: { type: "LineString", vertices: [{ x: 40, y: 70 }, { x: 90, y: 70 }] },
    confidence: "user_estimated",
  }, {
    id: "outside-well",
    name: "Outside well",
    kind: "well_location",
    geometry: { type: "Point", point: { x: 185, y: 185 } },
    confidence: "user_estimated",
  }],
});
const obstacleInteractionBefore = JSON.stringify(obstacleInteractionProject);
const obstacleInteractionReview = analyzeAdvisoryObstacleInteractions(obstacleInteractionProject);
assert.equal(obstacleInteractionReview.status, "ready");
assert.equal(obstacleInteractionReview.advisoryOnly, true);
assert.equal(obstacleInteractionReview.canonicalGeometryMutation, false);
assert.equal(obstacleInteractionReview.qualifiedReviewRequired, true);
assert.equal(obstacleInteractionReview.itemCount, 10);
assert.equal(obstacleInteractionReview.summary.hardBlockingCount, 2);
assert.equal(obstacleInteractionReview.summary.noSprayExclusionCount, 1);
assert.equal(obstacleInteractionReview.summary.spanClearanceReviewCount, 2);
assert.equal(obstacleInteractionReview.summary.towerTrackReviewCount, 1);
assert.equal(obstacleInteractionReview.summary.utilityPathReviewCount, 3);
assert.equal(obstacleInteractionReview.summary.outsideMachineReachCount, 1);
assert.equal(obstacleInteractionReview.items.find((item) => item.id === "well-under-span")?.category, "span_clearance_review");
assert.equal(obstacleInteractionReview.items.find((item) => item.id === "pump-under-span")?.category, "span_clearance_review");
assert.equal(obstacleInteractionReview.items.find((item) => item.id === "tower-track-well")?.category, "tower_track_review");
assert.equal(obstacleInteractionReview.items.find((item) => item.id === "tower-power-pole")?.category, "hard_blocking");
assert.equal(obstacleInteractionReview.items.find((item) => item.id === "buried-main")?.category, "utility_path_review");
assert.equal(obstacleInteractionReview.items.find((item) => item.id === "buried-wire")?.category, "utility_path_review");
assert.equal(obstacleInteractionReview.items.find((item) => item.id === "overhead-power")?.category, "utility_path_review");
assert.equal(obstacleInteractionReview.items.find((item) => item.id === "outside-well")?.category, "outside_machine_reach");
assert.ok(obstacleInteractionReview.items.find((item) => item.id === "well-under-span")?.warnings[0].includes("span-over clearance"));
assert.ok(obstacleInteractionReview.items.find((item) => item.id === "tower-track-well")?.warnings[0].includes("near a modeled tower track"));
assert.ok(obstacleInteractionReview.warnings.some((warning) => warning.includes("does not mutate canonical projected XY")));
assert.equal(JSON.stringify(obstacleInteractionProject), obstacleInteractionBefore);

const profiledObstacleInteractionReview = analyzeAdvisoryObstacleInteractions(obstacleInteractionProject, {
  obstacleCrossingProfiles: [{
    obstacleId: "well-under-span",
    crossingAllowed: true,
    minimumClearanceMeters: 5,
    reason: "Operator says the well is low enough for span-over review when tower-track clearance is adequate.",
    advisoryOnly: true,
  }, {
    obstacleId: "tower-track-well",
    crossingAllowed: true,
    minimumClearanceMeters: 5,
    reason: "Operator wants this well reviewed as potentially passable only with tower clearance.",
    advisoryOnly: true,
  }, {
    obstacleId: "overhead-power",
    crossingAllowed: false,
    reason: "Overhead power crossing is treated as blocking until utility review says otherwise.",
    advisoryOnly: true,
  }, {
    obstacleId: "tower-power-pole",
    crossingAllowed: true,
    minimumClearanceMeters: 5,
    reason: "Operator supplied a profile, but poles remain hard-blocking evidence.",
    advisoryOnly: true,
  }],
});
assert.equal(profiledObstacleInteractionReview.summary.profiledItemCount, 4);
assert.equal(profiledObstacleInteractionReview.summary.profileAllowedCount, 3);
assert.equal(profiledObstacleInteractionReview.summary.profileBlockedCount, 1);
assert.equal(profiledObstacleInteractionReview.summary.profileClearanceShortfallCount, 1);
assert.equal(profiledObstacleInteractionReview.summary.hardBlockingCount, 3);
assert.equal(profiledObstacleInteractionReview.items.find((item) => item.id === "well-under-span")?.crossingProfileReview?.status, "allowed_profile_clearance_met");
assert.equal(profiledObstacleInteractionReview.items.find((item) => item.id === "tower-track-well")?.crossingProfileReview?.status, "allowed_profile_clearance_shortfall");
assert.equal(profiledObstacleInteractionReview.items.find((item) => item.id === "overhead-power")?.category, "hard_blocking");
assert.equal(profiledObstacleInteractionReview.items.find((item) => item.id === "overhead-power")?.crossingProfileReview?.status, "blocked_profile");
assert.equal(profiledObstacleInteractionReview.items.find((item) => item.id === "tower-power-pole")?.crossingProfileReview?.status, "hard_blocking_profile_not_applied");
assert.ok(profiledObstacleInteractionReview.items.find((item) => item.id === "tower-track-well")?.warnings.some((warning) => warning.includes("not met by modeled horizontal clearance")));
assert.ok(profiledObstacleInteractionReview.warnings.some((warning) => warning.includes("do not change obstacle hardConflict/noSpray settings")));
assert.equal(JSON.stringify(obstacleInteractionProject), obstacleInteractionBefore);

const emptyObstacleInteractionReview = analyzeAdvisoryObstacleInteractions(readyProject);
assert.equal(emptyObstacleInteractionReview.status, "no_evidence");
assert.ok(emptyObstacleInteractionReview.blockers.some((blocker) => blocker.includes("obstacle polygons")));

const westMachineZone: ProjectMapFeature = {
  id: "zone-west",
  name: "West machine zone",
  kind: "machine_zone",
  geometry: {
    type: "Polygon",
    vertices: [
      { x: 0, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 150 },
      { x: 0, y: 150 },
    ],
  },
  confidence: "user_estimated",
  properties: { advisoryOnly: true, canonicalGeometryMutation: false },
};
const eastMachineZone: ProjectMapFeature = {
  id: "zone-east",
  name: "East machine zone",
  kind: "machine_zone",
  geometry: {
    type: "Polygon",
    vertices: [
      { x: 95, y: 0 },
      { x: 245, y: 0 },
      { x: 245, y: 150 },
      { x: 95, y: 150 },
    ],
  },
  confidence: "user_estimated",
  properties: { advisoryOnly: true, canonicalGeometryMutation: false },
};
const multiZoneProject = makeProject({
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 245, y: 0 },
    { x: 245, y: 150 },
    { x: 0, y: 150 },
  ],
  pivotCenter: { x: 25, y: 75 },
  waterSource: { x: 20, y: 75 },
  powerSource: { x: 225, y: 75 },
  obstacles: [],
  mapFeatures: [westMachineZone, eastMachineZone],
});
const multiZoneBefore = JSON.stringify(multiZoneProject);
const multiMachineReview = analyzeAdvisoryMultiMachineLayout(multiZoneProject, {
  gridDivisions: 6,
  maxCandidates: 3,
  collisionBufferMeters: 20,
});
assert.equal(multiMachineReview.status, "ready");
assert.equal(multiMachineReview.advisoryOnly, true);
assert.equal(multiMachineReview.canonicalGeometryMutation, false);
assert.equal(multiMachineReview.qualifiedReviewRequired, true);
assert.equal(multiMachineReview.compilation.machineZoneCount, 2);
assert.equal(multiMachineReview.compilation.scenarioCount, 2);
assert.equal(multiMachineReview.compilation.readyScenarioCount, 2);
assert.equal(multiMachineReview.compilation.fullScopeBoundarySource, "field_boundary");
assert.equal(multiMachineReview.compilation.scenarioBoundarySource, "machine_zone");
assert.equal(multiMachineReview.compilation.compiledBoundaryPolygonCount, multiMachineReview.compilation.compiledBoundary.length);
assert.equal(multiMachineReview.compilation.outsideFullScopeAcres, 0);
assert.ok(multiMachineReview.compilation.compiledBoundary.length > 0);
assert.ok(multiMachineReview.compilation.compiledBoundaryAcres > 0);
assert.ok(multiMachineReview.compilation.scenarioBoundaryUnionAcres > 0);
assert.ok(multiMachineReview.compilation.fullScopeCoveragePercent > 0);
assert.ok(multiMachineReview.compilation.fullScopeCoveragePercent <= 100);
assert.ok(multiMachineReview.compilation.fullScopeUnirrigatedAcres >= 0);
assert.ok(multiMachineReview.compilation.modeledIrrigatedUnionAcres <= multiMachineReview.compilation.modeledIrrigatedAcresSum);
assert.equal(multiMachineReview.scenarios.length, 2);
assert.ok(multiMachineReview.scenarios.every((scenario) => scenario.status === "ready"));
assert.ok(multiMachineReview.scenarios.every((scenario) => scenario.canonicalGeometryMutation === false));
assert.ok(multiMachineReview.warnings.some((warning) => warning.includes("internal machine-zone edges are not collision barriers")));
assert.ok(multiMachineReview.conflicts.some((conflict) => conflict.status === "machine_envelope_overlap"));
assert.ok(multiMachineReview.conflicts.every((conflict) => conflict.separationDeficitMeters > 0));
const overlapConflict = multiMachineReview.conflicts.find((conflict) => conflict.status === "machine_envelope_overlap");
assert.equal(overlapConflict?.severity, "critical_overlap");
assert.equal(overlapConflict?.operatorCollisionReviewRequired, true);
assert.ok((overlapConflict?.collisionZone.length ?? 0) > 0);
assert.ok((overlapConflict?.collisionZoneAcres ?? 0) > 0);
assert.ok((overlapConflict?.separationReviewZoneAcres ?? 0) >= (overlapConflict?.collisionZoneAcres ?? 0));
assert.ok(overlapConflict?.warnings.some((warning) => warning.includes("projected-XY collision/review zone evidence")));
assert.ok(multiMachineReview.warnings.some((warning) => warning.includes("does not create pivots")));
assert.equal(JSON.stringify(multiZoneProject), multiZoneBefore);

const internalEdgeContextProject = makeProject({
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 220, y: 0 },
    { x: 220, y: 220 },
    { x: 0, y: 220 },
  ],
  pivotCenter: { x: 110, y: 110 },
  waterSource: { x: 110, y: 110 },
  powerSource: { x: 110, y: 110 },
  obstacles: [],
  mapFeatures: [{
    id: "small-internal-zone",
    name: "Small internal machine-zone context",
    kind: "machine_zone",
    geometry: {
      type: "Polygon",
      vertices: [
        { x: 95, y: 95 },
        { x: 125, y: 95 },
        { x: 125, y: 125 },
        { x: 95, y: 125 },
      ],
    },
    confidence: "user_estimated",
    properties: { advisoryOnly: true, canonicalGeometryMutation: false },
  }],
});
const internalEdgeReview = analyzeAdvisoryMultiMachineLayout(internalEdgeContextProject, {
  gridDivisions: 5,
  maxCandidates: 2,
});
assert.equal(internalEdgeReview.status, "single_zone_review");
assert.ok((internalEdgeReview.scenarios[0]?.modeledIrrigatedAcres ?? 0) > (internalEdgeReview.scenarios[0]?.zoneAcres ?? Number.POSITIVE_INFINITY));
assert.equal(internalEdgeReview.compilation.outsideFullScopeAcres, 0);
assert.ok(internalEdgeReview.warnings.some((warning) => warning.includes("internal machine-zone edges are not collision barriers")));

const blockedPowerLineReview = analyzeAdvisoryMultiMachineLayout({
  ...multiZoneProject,
  mapFeatures: [...(multiZoneProject.mapFeatures ?? []), {
    id: "verified-overhead-power-exclusion",
    name: "Verified overhead power exclusion",
    kind: "power_line",
    geometry: { type: "LineString", vertices: [{ x: 15, y: 75 }, { x: 230, y: 75 }] },
    confidence: "imagery_digitized",
    properties: { powerLineEvidenceStatus: "verified_exclusion" },
  }],
}, {
  gridDivisions: 6,
  maxCandidates: 3,
  collisionBufferMeters: 20,
  obstacleCrossingProfiles: [{
    obstacleId: "verified-overhead-power-exclusion",
    crossingAllowed: false,
    reason: "Operator supplied a verified overhead power exclusion.",
    advisoryOnly: true,
  }],
});
assert.equal(blockedPowerLineReview.status, "no_feasible_scenarios");
assert.ok(blockedPowerLineReview.verifiedPowerExclusionConflictCount > 0);
assert.ok(blockedPowerLineReview.blockers.some((blocker) => blocker.includes("verified power-line")));

const openMultiPivotProject = makeProject({
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 520, y: 0 },
    { x: 520, y: 220 },
    { x: 0, y: 220 },
  ],
  pivotCenter: { x: 80, y: 110 },
  waterSource: { x: 0, y: 110 },
  powerSource: { x: 520, y: 110 },
  obstacles: [],
  mapFeatures: [],
});
const openMultiPivotBefore = JSON.stringify(openMultiPivotProject);
const generatedFieldPlan = planAdvisoryFieldPivots(openMultiPivotProject, {
  gridDivisions: 9,
  maxMachines: 3,
  candidatePoolSize: 36,
  collisionBufferMeters: 0,
});
assert.equal(generatedFieldPlan.status, "ready");
assert.equal(generatedFieldPlan.advisoryOnly, true);
assert.equal(generatedFieldPlan.canonicalGeometryMutation, false);
assert.equal(generatedFieldPlan.qualifiedReviewRequired, true);
assert.equal(generatedFieldPlan.requestedMachineCount, 3);
assert.equal(generatedFieldPlan.selectedMachineCount, 3);
assert.ok(generatedFieldPlan.candidatePoolCount >= generatedFieldPlan.selectedMachineCount);
assert.ok(generatedFieldPlan.feasibleCandidateCount >= generatedFieldPlan.selectedMachineCount);
assert.ok(generatedFieldPlan.fieldCoveragePercent > 0);
assert.ok(generatedFieldPlan.fieldCoveragePercent <= 100);
assert.ok(generatedFieldPlan.fieldUnirrigatedAcres >= 0);
assert.ok(generatedFieldPlan.modeledIrrigatedUnionAcres <= generatedFieldPlan.modeledIrrigatedAcresSum);
assert.ok(generatedFieldPlan.candidates.every((candidate) => candidate.canonicalGeometryMutation === false));
assert.ok(generatedFieldPlan.candidates.every((candidate) => candidate.incrementalIrrigatedAcres > 0));
assert.ok(generatedFieldPlan.candidates.slice(1).every((candidate) => (
  candidate.nearestSelectedDistanceMeters !== null
  && candidate.nearestSelectedDistanceMeters >= generatedFieldPlan.minimumRequiredSeparationMeters
)));
assert.ok(generatedFieldPlan.warnings.some((warning) => warning.includes("does not create pivots")));
const generatedScenarioReview = buildAdvisoryGeneratedMultiPivotScenarioReview(generatedFieldPlan);
assert.equal(generatedScenarioReview.status, "ready");
assert.equal(generatedScenarioReview.advisoryOnly, true);
assert.equal(generatedScenarioReview.canonicalGeometryMutation, false);
assert.equal(generatedScenarioReview.qualifiedReviewRequired, true);
assert.equal(generatedScenarioReview.projectCrs, openMultiPivotProject.projectCrs);
assert.equal(generatedScenarioReview.selectedCenterCount, generatedFieldPlan.selectedMachineCount);
assert.equal(generatedScenarioReview.requestedMachineCount, generatedFieldPlan.requestedMachineCount);
assert.equal(generatedScenarioReview.rows.length, generatedFieldPlan.selectedMachineCount);
assert.equal(generatedScenarioReview.rows.every((row) => row.advisoryOnly === true), true);
assert.equal(generatedScenarioReview.rows.every((row) => row.canonicalGeometryMutation === false), true);
assert.ok(generatedScenarioReview.rows.slice(1).every((row) => (
  row.separationMarginMeters !== null
  && row.separationMarginMeters >= 0
)));
assert.equal(generatedScenarioReview.costInputStatus, "missing_cost_input");
assert.ok(generatedScenarioReview.modeledIrrigatedUnionAcres > 0);
assert.ok(generatedScenarioReview.duplicateModeledCoverageAcres >= 0);
assert.ok(generatedScenarioReview.warnings.some((warning) => warning.includes("does not create saved pivots")));
assert.equal(JSON.stringify(openMultiPivotProject), openMultiPivotBefore);

const constrainedFieldPlan = planAdvisoryFieldPivots(openMultiPivotProject, {
  gridDivisions: 7,
  maxMachines: 3,
  candidatePoolSize: 24,
  minimumMachineSeparationMeters: 1000,
});
assert.equal(constrainedFieldPlan.status, "single_candidate");
assert.equal(constrainedFieldPlan.selectedMachineCount, 1);
assert.ok(constrainedFieldPlan.rejectedForSeparationCount > 0);
assert.ok(constrainedFieldPlan.separationRejections.every((rejection) => rejection.canonicalGeometryMutation === false));
assert.ok(constrainedFieldPlan.blockers.some((blocker) => blocker.includes("Only 1 separated feasible center")));
const constrainedGeneratedScenarioReview = buildAdvisoryGeneratedMultiPivotScenarioReview(constrainedFieldPlan);
assert.equal(constrainedGeneratedScenarioReview.status, "single_center_review");
assert.equal(constrainedGeneratedScenarioReview.selectedCenterCount, 1);
assert.ok(constrainedGeneratedScenarioReview.rejectedRows.length > 0);
assert.ok((constrainedGeneratedScenarioReview.largestSeparationDeficitMeters ?? 0) > 0);
assert.ok(constrainedGeneratedScenarioReview.rejectedRows.every((row) => row.canonicalGeometryMutation === false));
assert.ok(constrainedGeneratedScenarioReview.rejectedRows.some((row) => row.warnings.some((warning) => warning.includes("not certified collision prevention"))));

const bufferWestMachineZone: ProjectMapFeature = {
  id: "zone-buffer-west",
  name: "Buffer west machine zone",
  kind: "machine_zone",
  geometry: {
    type: "Polygon",
    vertices: [
      { x: 0, y: 0 },
      { x: 140, y: 0 },
      { x: 140, y: 140 },
      { x: 0, y: 140 },
    ],
  },
  confidence: "user_estimated",
  properties: { advisoryOnly: true, canonicalGeometryMutation: false },
};
const bufferEastMachineZone: ProjectMapFeature = {
  id: "zone-buffer-east",
  name: "Buffer east machine zone",
  kind: "machine_zone",
  geometry: {
    type: "Polygon",
    vertices: [
      { x: 210, y: 0 },
      { x: 350, y: 0 },
      { x: 350, y: 140 },
      { x: 210, y: 140 },
    ],
  },
  confidence: "user_estimated",
  properties: { advisoryOnly: true, canonicalGeometryMutation: false },
};
const bufferOnlyProject = makeProject({
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 350, y: 0 },
    { x: 350, y: 140 },
    { x: 0, y: 140 },
  ],
  pivotCenter: { x: 70, y: 70 },
  waterSource: { x: 20, y: 70 },
  powerSource: { x: 330, y: 70 },
  obstacles: [],
  mapFeatures: [bufferWestMachineZone, bufferEastMachineZone],
});
const bufferOnlyBefore = JSON.stringify(bufferOnlyProject);
const bufferOnlyReview = analyzeAdvisoryMultiMachineLayout(bufferOnlyProject, {
  gridDivisions: 6,
  maxCandidates: 3,
  collisionBufferMeters: 0,
  minimumMachineSeparationMeters: 280,
});
const bufferConflict = bufferOnlyReview.conflicts.find((conflict) => conflict.status === "separation_buffer_warning");
assert.equal(bufferOnlyReview.status, "ready");
assert.equal(bufferOnlyReview.compilation.fullScopeBoundarySource, "field_boundary");
assert.equal(bufferOnlyReview.compilation.scenarioBoundarySource, "machine_zone");
assert.ok(bufferOnlyReview.compilation.scenarioBoundaryUnionAcres < bufferOnlyReview.compilation.compiledBoundaryAcres);
assert.ok(bufferConflict);
assert.equal(bufferConflict?.severity, "buffer_intrusion");
assert.equal(bufferConflict?.collisionZoneAcres, 0);
assert.equal(bufferConflict?.collisionZone.length, 0);
assert.ok((bufferConflict?.separationReviewBufferMeters ?? 0) > 0);
assert.ok((bufferConflict?.separationReviewZone.length ?? 0) > 0);
assert.ok((bufferConflict?.separationReviewZoneAcres ?? 0) > 0);
assert.equal(JSON.stringify(bufferOnlyProject), bufferOnlyBefore);

const explicitFullScopeBoundary: ProjectMapFeature = {
  id: "full-scope-planning-boundary",
  name: "Full Scope Field Boundary",
  kind: "planning_boundary",
  geometry: {
    type: "Polygon",
    vertices: [
      { x: 0, y: 0 },
      { x: 350, y: 0 },
      { x: 350, y: 140 },
      { x: 0, y: 140 },
    ],
  },
  confidence: "user_estimated",
  properties: { advisoryOnly: true, canonicalGeometryMutation: false },
};
const explicitFullScopeReview = analyzeAdvisoryMultiMachineLayout({
  ...bufferOnlyProject,
  mapFeatures: [explicitFullScopeBoundary, bufferWestMachineZone, bufferEastMachineZone],
}, {
  gridDivisions: 5,
  maxCandidates: 2,
  collisionBufferMeters: 0,
});
assert.equal(explicitFullScopeReview.compilation.fullScopeBoundarySource, "planning_boundary");
assert.equal(explicitFullScopeReview.compilation.scenarioBoundarySource, "machine_zone");
assert.ok(explicitFullScopeReview.compilation.compiledBoundaryAcres > explicitFullScopeReview.compilation.scenarioBoundaryUnionAcres);

const narrowFullScopeBoundary: ProjectMapFeature = {
  ...explicitFullScopeBoundary,
  id: "narrow-full-scope-planning-boundary",
  geometry: {
    type: "Polygon",
    vertices: [
      { x: 50, y: 40 },
      { x: 300, y: 40 },
      { x: 300, y: 100 },
      { x: 50, y: 100 },
    ],
  },
};
const clippedFullScopeReview = analyzeAdvisoryMultiMachineLayout({
  ...bufferOnlyProject,
  mapFeatures: [narrowFullScopeBoundary, bufferWestMachineZone, bufferEastMachineZone],
}, {
  gridDivisions: 5,
  maxCandidates: 2,
  collisionBufferMeters: 0,
});
assert.equal(clippedFullScopeReview.compilation.fullScopeBoundarySource, "planning_boundary");
assert.equal(clippedFullScopeReview.compilation.scenarioBoundarySource, "machine_zone");
assert.equal(clippedFullScopeReview.status, "no_feasible_scenarios");
assert.ok(clippedFullScopeReview.compilation.modeledIrrigatedUnionAcres > clippedFullScopeReview.compilation.compiledBoundaryAcres);
assert.ok(clippedFullScopeReview.compilation.outsideFullScopeAcres > 0);
assert.ok(clippedFullScopeReview.compilation.fullScopeCoveragePercent <= 100);
assert.ok(clippedFullScopeReview.compilation.fullScopeUnirrigatedAcres > 0);
assert.ok(clippedFullScopeReview.blockers.some((blocker) => blocker.includes("outside the full-scope field boundary")));

const partialSweepNoOverlapReview = analyzeAdvisoryMultiMachineLayout({
  ...bufferOnlyProject,
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    { x: 260, y: 140 },
    { x: 0, y: 140 },
  ],
  mapFeatures: [bufferWestMachineZone, {
    ...bufferEastMachineZone,
    geometry: {
      type: "Polygon",
      vertices: [
        { x: 100, y: 0 },
        { x: 180, y: 0 },
        { x: 180, y: 140 },
        { x: 100, y: 140 },
      ],
    },
  }],
  machine: {
    ...bufferOnlyProject.machine,
    spanLengthsMeters: [60],
    sweep: {
      mode: "partial_circle",
      startAngleDegrees: 80,
      stopAngleDegrees: 100,
      direction: "counterclockwise",
    },
  },
}, {
  gridDivisions: 6,
  maxCandidates: 3,
  collisionBufferMeters: 0,
});
const partialSweepConflict = partialSweepNoOverlapReview.conflicts[0];
assert.equal(partialSweepNoOverlapReview.status, "ready");
assert.ok(partialSweepConflict);
assert.equal(partialSweepConflict.status, "separation_buffer_warning");
assert.equal(partialSweepConflict.severity, "buffer_intrusion");
assert.equal(partialSweepConflict.collisionZoneAcres, 0);
assert.equal(partialSweepConflict.collisionZone.length, 0);

const separatedReview = analyzeAdvisoryMultiMachineLayout({
  ...bufferOnlyProject,
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 430, y: 0 },
    { x: 430, y: 140 },
    { x: 0, y: 140 },
  ],
  mapFeatures: [bufferWestMachineZone, {
    ...bufferEastMachineZone,
    geometry: {
      type: "Polygon",
      vertices: [
        { x: 290, y: 0 },
        { x: 430, y: 0 },
        { x: 430, y: 140 },
        { x: 290, y: 140 },
      ],
    },
  }],
}, {
  gridDivisions: 6,
  maxCandidates: 3,
  collisionBufferMeters: 0,
});
assert.equal(separatedReview.status, "ready");
assert.equal(separatedReview.conflicts.length, 0);

const missingZoneReview = analyzeAdvisoryMultiMachineLayout(readyProject, { gridDivisions: 5, maxCandidates: 2 });
assert.equal(missingZoneReview.status, "missing_zones");
assert.equal(missingZoneReview.scenarios.length, 0);
assert.equal(missingZoneReview.compilation.fullScopeBoundarySource, "field_boundary");
assert.equal(missingZoneReview.compilation.scenarioBoundarySource, "none");
assert.equal(missingZoneReview.compilation.compiledBoundaryPolygonCount, 1);
assert.equal(missingZoneReview.compilation.scenarioBoundaryUnionAcres, 0);
assert.equal(missingZoneReview.compilation.fullScopeCoveragePercent, 0);
assert.equal(missingZoneReview.compilation.fullScopeUnirrigatedAcres, missingZoneReview.compilation.compiledBoundaryAcres);
assert.equal(missingZoneReview.compilation.outsideFullScopeAcres, 0);
assert.ok(missingZoneReview.blockers.some((blocker) => blocker.includes("machine zone or planning boundary")));

const planningBoundaryReview = analyzeAdvisoryMultiMachineLayout({
  ...readyProject,
  mapFeatures: [{
    id: "full-scope",
    name: "Full scope boundary",
    kind: "planning_boundary",
    geometry: {
      type: "Polygon",
      vertices: readyProject.fieldBoundary,
    },
    confidence: "user_estimated",
  }],
}, { gridDivisions: 5, maxCandidates: 2 });
assert.equal(planningBoundaryReview.status, "single_zone_review");
assert.equal(planningBoundaryReview.compilation.planningBoundaryCount, 1);
assert.equal(planningBoundaryReview.compilation.readyScenarioCount, 1);

const strategyProject = makeProject({
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 260, y: 0 },
    { x: 260, y: 220 },
    { x: 0, y: 220 },
  ],
  pivotCenter: { x: 40, y: 110 },
  waterSource: { x: 30, y: 110 },
  powerSource: { x: 230, y: 110 },
  obstacles: [],
  mapFeatures: [],
  machine: {
    ...defaultMachine(),
    spanLengthsMeters: [45, 45],
  },
});
const strategyProjectBefore = JSON.stringify(strategyProject);
const strategyComparison = compareAdvisoryMachineStrategies(strategyProject, {
  gridDivisions: 6,
  maxCandidates: 3,
  generatedFullCircleRadiiMeters: [55, 75, 95],
  costInput: {
    fixedMachineCost: 80000,
    costPerMeter: 700,
    costPerTower: 3000,
    currencyCode: "USD",
  },
});
assert.equal(strategyComparison.status, "ready");
assert.equal(strategyComparison.advisoryOnly, true);
assert.equal(strategyComparison.canonicalGeometryMutation, false);
assert.equal(strategyComparison.qualifiedReviewRequired, true);
assert.equal(strategyComparison.costInputStatus, "complete");
assert.ok(strategyComparison.bestStrategy);
assert.ok(strategyComparison.strategies.some((strategy) => strategy.strategyKind === "current_machine"));
assert.ok(strategyComparison.strategies.some((strategy) => strategy.strategyKind === "full_circle_radius"));
assert.ok(strategyComparison.strategies.some((strategy) => strategy.strategyKind === "unsupported_linear_lateral" && strategy.status === "unsupported_model"));
assert.ok(strategyComparison.strategies.some((strategy) => strategy.strategyKind === "unsupported_bender_second_pivot" && strategy.status === "unsupported_model"));
assert.ok(strategyComparison.strategies.filter((strategy) => strategy.status === "ready").every((strategy) => strategy.costAssessment?.status === "complete"));
assert.ok(strategyComparison.strategies.filter((strategy) => strategy.status === "ready").every((strategy) => Number.isFinite(strategy.advisoryScore)));
assert.ok(strategyComparison.warnings.some((warning) => warning.includes("does not mutate canonical projected XY")));
assert.equal(JSON.stringify(strategyProject), strategyProjectBefore);

const radiusSensitivityProjectBefore = JSON.stringify(strategyProject);
const radiusSensitivityReview = buildAdvisoryRadiusSensitivityReview(strategyProject, {
  gridDivisions: 6,
  maxCandidates: 3,
  maxMachines: 2,
  radiiMeters: [55, 55, 75, 95, -1, 0, Number.NaN],
  costInput: {
    fixedMachineCost: 80000,
    costPerMeter: 700,
    costPerTower: 3000,
    currencyCode: "USD",
  },
});
assert.equal(radiusSensitivityReview.advisoryOnly, true);
assert.equal(radiusSensitivityReview.canonicalGeometryMutation, false);
assert.equal(radiusSensitivityReview.qualifiedReviewRequired, true);
assert.equal(radiusSensitivityReview.source, "generated_radius_sensitivity");
assert.equal(radiusSensitivityReview.rowCount, 3);
assert.ok(radiusSensitivityReview.readyRowCount > 0);
assert.ok(radiusSensitivityReview.importedRadiusMeters > 0);
assert.ok(radiusSensitivityReview.bestByCostPerAcre);
assert.equal(radiusSensitivityReview.bestByCostPerAcre?.cost.status, "complete");
assert.ok(radiusSensitivityReview.bestByFullScopeCoverage);
assert.deepEqual(radiusSensitivityReview.rows.map((row) => row.requestedRadiusMeters), [55, 75, 95]);
assert.ok(radiusSensitivityReview.rows.every((row) => row.advisoryOnly === true));
assert.ok(radiusSensitivityReview.rows.every((row) => row.canonicalGeometryMutation === false));
assert.ok(radiusSensitivityReview.rows.every((row) => row.cost.status === "complete"));
assert.ok(radiusSensitivityReview.rows.every((row) => Number.isFinite(row.fullScopeCoveragePercent)));
assert.ok(radiusSensitivityReview.warnings.some((warning) => warning.includes("does not change project geometry")));
assert.equal(JSON.stringify(strategyProject), radiusSensitivityProjectBefore);

const missingCostRadiusReview = buildAdvisoryRadiusSensitivityReview(strategyProject, {
  gridDivisions: 5,
  maxCandidates: 2,
  radiiMeters: [75],
});
assert.equal(missingCostRadiusReview.bestByCostPerAcre, null);
assert.equal(missingCostRadiusReview.rows[0].cost.status, "missing_cost_input");
assert.ok(missingCostRadiusReview.warnings.some((warning) => warning.includes("No radius row had complete cost-per-acre evidence")));

const customRadiusReview = buildAdvisoryRadiusSensitivityReview(strategyProject, {
  gridDivisions: 5,
  maxCandidates: 2,
  radiiMeters: [60],
  buildMachineForRadius: (_project, radiusMeters) => ({
    ...defaultMachine(),
    spanLengthsMeters: [radiusMeters],
    overhangMeters: 10,
  }),
});
assert.equal(customRadiusReview.rowCount, 1);
assert.equal(customRadiusReview.rows[0].requestedRadiusMeters, 60);
assert.equal(customRadiusReview.rows[0].radiusMeters, 70);
assert.equal(customRadiusReview.rows[0].spanCount, 1);

const endGunSensitivityProject = makeProject({
  ...strategyProject,
  machine: {
    ...strategyProject.machine,
    endGunThrowMeters: 20,
    endGunAngleRanges: [{
      startAngleDegrees: 0,
      stopAngleDegrees: 180,
      direction: "clockwise",
    }],
  },
});
const endGunSensitivityProjectBefore = JSON.stringify(endGunSensitivityProject);
const endGunSensitivityReview = buildAdvisoryEndGunSensitivityReview(endGunSensitivityProject, {
  throwDistancesMeters: [0, 20, 20, 30, -5, Number.NaN],
});
assert.equal(endGunSensitivityReview.advisoryOnly, true);
assert.equal(endGunSensitivityReview.canonicalGeometryMutation, false);
assert.equal(endGunSensitivityReview.qualifiedReviewRequired, true);
assert.equal(endGunSensitivityReview.source, "generated_end_gun_sensitivity");
assert.equal(endGunSensitivityReview.importedThrowMeters, 20);
assert.equal(endGunSensitivityReview.rowCount, 3);
assert.ok(endGunSensitivityReview.readyRowCount > 0);
assert.ok(endGunSensitivityReview.bestByIncrementalAcres);
assert.ok(endGunSensitivityReview.bestByLowOutsideFieldAcres);
assert.deepEqual(endGunSensitivityReview.rows.map((row) => row.requestedThrowMeters), [0, 20, 30]);
assert.ok(endGunSensitivityReview.rows.every((row) => row.advisoryOnly === true));
assert.ok(endGunSensitivityReview.rows.every((row) => row.canonicalGeometryMutation === false));
assert.ok(endGunSensitivityReview.rows.every((row) => row.qualifiedReviewRequired === true));
assert.ok(endGunSensitivityReview.rows.every((row) => row.endGunAngleRangeCount === 1));
assert.ok(endGunSensitivityReview.rows.every((row) => Number.isFinite(row.wetRadiusMeters)));
assert.ok(endGunSensitivityReview.rows.every((row) => Number.isFinite(row.incrementalIrrigatedAcres)));
assert.equal(endGunSensitivityReview.rows[0].throwMeters, 0);
assert.equal(endGunSensitivityReview.rows[0].endGunAcres, 0);
assert.ok((endGunSensitivityReview.rows.find((row) => row.throwMeters === 30)?.endGunAcres ?? 0) >= (endGunSensitivityReview.rows.find((row) => row.throwMeters === 20)?.endGunAcres ?? 0));
assert.ok(endGunSensitivityReview.warnings.some((warning) => warning.includes("does not change project geometry")));
assert.ok(endGunSensitivityReview.warnings.some((warning) => warning.includes("Pressure, wind, nozzle package")));
assert.equal(JSON.stringify(endGunSensitivityProject), endGunSensitivityProjectBefore);

const defaultEndGunSensitivityReview = buildAdvisoryEndGunSensitivityReview(strategyProject);
assert.deepEqual(defaultEndGunSensitivityReview.rows.map((row) => row.requestedThrowMeters), [0, 15, 30, 45]);

const ordinaryPivotEvidence: SurveyPoint = {
  id: "existing-pivot-evidence",
  label: "Existing pivot point",
  role: "pivot_center",
  projected: { x: 125, y: 110 },
  observedAt: "2026-06-06T00:00:00.000Z",
  source: "imported",
  confidence: "user_estimated",
  notes: "Imported pivot evidence without bender intent.",
};
const ordinaryPivotComparison = compareAdvisoryMachineStrategies({
  ...strategyProject,
  surveyPoints: [ordinaryPivotEvidence],
}, {
  gridDivisions: 5,
  maxCandidates: 2,
  includeGeneratedRadiusStrategies: false,
});
assert.equal(ordinaryPivotComparison.strategies.some((strategy) => strategy.strategyKind === "bender_second_pivot"), false);
assert.ok(ordinaryPivotComparison.strategies.some((strategy) => strategy.strategyKind === "unsupported_bender_second_pivot" && strategy.status === "unsupported_model"));

const benderSecondPivotEvidence: SurveyPoint = {
  id: "bender-second-pivot-evidence",
  label: "Bender second pivot drive tower",
  role: "pivot_center",
  projected: { x: 115, y: 110 },
  observedAt: "2026-06-06T00:00:00.000Z",
  source: "imported",
  confidence: "user_estimated",
  notes: "Operator-labeled second pivot hinge evidence for advisory review.",
};
const benderStrategyProject = makeProject({
  ...strategyProject,
  machine: {
    ...strategyProject.machine,
    spanLengthsMeters: [60, 45, 30],
  },
  surveyPoints: [benderSecondPivotEvidence],
});
const benderStrategyBefore = JSON.stringify(benderStrategyProject);
const benderStrategyComparison = compareAdvisoryMachineStrategies(benderStrategyProject, {
  gridDivisions: 5,
  maxCandidates: 2,
  includeGeneratedRadiusStrategies: false,
  costInput: {
    fixedMachineCost: 90000,
    costPerMeter: 650,
    costPerTower: 2500,
    currencyCode: "USD",
  },
});
const benderStrategy = benderStrategyComparison.strategies.find((strategy) => strategy.strategyKind === "bender_second_pivot");
assert.ok(benderStrategy);
assert.equal(benderStrategy?.status, "ready");
assert.equal(benderStrategy?.secondPivotPointId, "bender-second-pivot-evidence");
assert.deepEqual(benderStrategy?.secondPivotPoint, benderSecondPivotEvidence.projected);
assert.ok((benderStrategy?.benderPrimaryDistanceMeters ?? 0) > 0);
assert.ok((benderStrategy?.benderTailRadiusMeters ?? 0) > 0);
assert.ok((benderStrategy?.irrigatedAcres ?? 0) > 0);
assert.equal(benderStrategy?.costAssessment?.status, "complete");
assert.equal(benderStrategyComparison.strategies.some((strategy) => strategy.strategyKind === "unsupported_bender_second_pivot"), false);
assert.ok(benderStrategy?.sourceRefs.some((sourceRef) => sourceRef.guideId === "local-vflex-corner-0998325"));
assert.ok(benderStrategy?.warnings.some((warning) => warning.includes("does not verify drive-tower hinge")));
assert.equal(JSON.stringify(benderStrategyProject), benderStrategyBefore);

const linearMovePath: ProjectMapFeature = {
  id: "linear-path-a",
  name: "Linear move path A",
  kind: "linear_move_path",
  geometry: {
    type: "LineString",
    vertices: [
      { x: 70, y: 110 },
      { x: 190, y: 110 },
    ],
  },
  confidence: "user_estimated",
  properties: { advisoryOnly: true, canonicalGeometryMutation: false },
};
const linearStrategyProject = makeProject({
  ...strategyProject,
  machine: {
    ...strategyProject.machine,
    spanLengthsMeters: [35],
  },
  mapFeatures: [linearMovePath],
});
const linearStrategyBefore = JSON.stringify(linearStrategyProject);
const linearStrategyComparison = compareAdvisoryMachineStrategies(linearStrategyProject, {
  gridDivisions: 5,
  maxCandidates: 2,
  includeGeneratedRadiusStrategies: false,
  costInput: {
    fixedMachineCost: 65000,
    costPerMeter: 400,
    costPerTower: 2000,
    currencyCode: "USD",
  },
});
const linearStrategy = linearStrategyComparison.strategies.find((strategy) => strategy.strategyKind === "linear_lateral_move");
assert.equal(linearStrategyComparison.status, "ready");
assert.ok(linearStrategy);
assert.equal(linearStrategy?.status, "ready");
assert.equal(linearStrategy?.pathFeatureId, "linear-path-a");
assert.equal(linearStrategy?.bestCandidate, null);
assert.ok((linearStrategy?.irrigatedAcres ?? 0) > 0);
assert.equal(linearStrategy?.costAssessment?.status, "complete");
assert.equal(linearStrategyComparison.strategies.some((strategy) => strategy.strategyKind === "unsupported_linear_lateral"), false);
assert.ok(linearStrategy?.warnings.some((warning) => warning.includes("Swept-strip coverage assumes")));
assert.equal(JSON.stringify(linearStrategyProject), linearStrategyBefore);

const missingCostStrategyComparison = compareAdvisoryMachineStrategies(strategyProject, {
  gridDivisions: 5,
  maxCandidates: 2,
  includeUnsupportedConceptPlaceholders: false,
});
assert.equal(missingCostStrategyComparison.status, "ready");
assert.equal(missingCostStrategyComparison.costInputStatus, "missing_cost_input");
assert.ok(missingCostStrategyComparison.warnings.some((warning) => warning.includes("Cost ranking is incomplete")));

const partialStrategyComparison = compareAdvisoryMachineStrategies({
  ...strategyProject,
  machine: {
    ...strategyProject.machine,
    sweep: {
      mode: "partial_circle",
      startAngleDegrees: 180,
      stopAngleDegrees: 20,
      direction: "counterclockwise",
    },
  },
}, {
  gridDivisions: 5,
  maxCandidates: 2,
  includeGeneratedRadiusStrategies: false,
  includeUnsupportedConceptPlaceholders: false,
});
assert.ok(partialStrategyComparison.strategies.some((strategy) => strategy.strategyKind === "full_circle_same_radius"));

const sweepEfficiencyProject = makeProject({
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 320, y: 0 },
    { x: 320, y: 320 },
    { x: 0, y: 320 },
  ],
  pivotCenter: { x: 160, y: 160 },
  waterSource: { x: 150, y: 160 },
  powerSource: { x: 170, y: 160 },
  machine: {
    ...defaultMachine(),
    spanLengthsMeters: [45, 45],
    sweep: {
      mode: "partial_circle",
      startAngleDegrees: 0,
      stopAngleDegrees: 180,
      direction: "clockwise",
    },
  },
});
const sweepEfficiencyProjectBefore = JSON.stringify(sweepEfficiencyProject);
const sweepEfficiencyReview = buildAdvisorySweepEfficiencyReview(sweepEfficiencyProject, {
  comparisonRadiiMeters: [45, 54, 63, 72, 81, 90, 90, Number.NaN, -1],
  costInput: {
    fixedMachineCost: 90000,
    costPerMeter: 650,
    costPerTower: 2500,
    currencyCode: "USD",
  },
});
assert.equal(sweepEfficiencyReview.advisoryOnly, true);
assert.equal(sweepEfficiencyReview.canonicalGeometryMutation, false);
assert.equal(sweepEfficiencyReview.qualifiedReviewRequired, true);
assert.equal(sweepEfficiencyReview.status, "ready");
assert.equal(sweepEfficiencyReview.importedSweepMode, "partial_circle");
assert.equal(sweepEfficiencyReview.rowCount, 7);
assert.ok(sweepEfficiencyReview.sameRadiusFullCircleRow);
assert.equal(sweepEfficiencyReview.sameRadiusFullCircleRow?.kind, "full_circle_same_radius");
assert.ok((sweepEfficiencyReview.sameRadiusFullCircleRow?.irrigatedAcres ?? 0) > sweepEfficiencyReview.rows[0].irrigatedAcres);
assert.ok(sweepEfficiencyReview.bestShorterComparableFullCircleRow);
assert.equal(sweepEfficiencyReview.bestShorterComparableFullCircleRow?.kind, "generated_shorter_full_circle");
assert.ok((sweepEfficiencyReview.bestShorterComparableFullCircleRow?.radiusMeters ?? 999) < sweepEfficiencyReview.currentMachineRadiusMeters);
assert.ok((sweepEfficiencyReview.bestShorterComparableFullCircleRow?.irrigatedAcres ?? 0) >= sweepEfficiencyReview.rows[0].irrigatedAcres * 0.95);
assert.ok((sweepEfficiencyReview.bestShorterComparableFullCircleRow?.estimatedCostDeltaFromCurrent ?? 1) < 0);
assert.ok(sweepEfficiencyReview.bestCostPerAcreRow);
assert.ok(sweepEfficiencyReview.rows.every((row) => row.advisoryOnly === true));
assert.ok(sweepEfficiencyReview.rows.every((row) => row.canonicalGeometryMutation === false));
assert.ok(sweepEfficiencyReview.rows.every((row) => row.cost.status === "complete"));
assert.ok(sweepEfficiencyReview.warnings.some((warning) => warning.includes("same-machine cost spread across fewer modeled acres")));
assert.equal(JSON.stringify(sweepEfficiencyProject), sweepEfficiencyProjectBefore);

const fullCircleSweepEfficiencyReview = buildAdvisorySweepEfficiencyReview(strategyProject);
assert.equal(fullCircleSweepEfficiencyReview.status, "current_full_circle");
assert.equal(fullCircleSweepEfficiencyReview.rowCount, 1);
assert.ok(fullCircleSweepEfficiencyReview.warnings.some((warning) => warning.includes("already full circle")));

const noBoundaryStrategyComparison = compareAdvisoryMachineStrategies(makeProject({
  fieldBoundary: [],
  obstacles: [],
  mapFeatures: [],
}));
assert.equal(noBoundaryStrategyComparison.status, "no_boundary");
assert.equal(noBoundaryStrategyComparison.bestStrategy, null);
assert.ok(noBoundaryStrategyComparison.blockers.some((blocker) => blocker.includes("field boundary vertices")));

const missingCostCandidate = buildPivotPlacementCandidates(readyProject, { gridDivisions: 6, maxCandidates: 1 })[0];
assert.equal(missingCostCandidate.costAssessment.status, "missing_cost_input");
assert.equal(missingCostCandidate.scoreBreakdown.costEfficiency, 0);

const strictClearanceAnalysis = analyzeIdealPivotCenter(readyProject, {
  gridDivisions: 5,
  maxCandidates: 3,
  minimumBoundaryClearanceMeters: 120,
});
assert.ok(strictClearanceAnalysis.candidates.some((candidate) => candidate.disqualificationReasons.some((reason) => reason.includes("boundary clearance"))));

const infeasibleAnalysis = analyzeIdealPivotCenter(makeProject({
  fieldBoundary: [
    { x: 0, y: 0 },
    { x: 18, y: 0 },
    { x: 18, y: 18 },
    { x: 0, y: 18 },
  ],
  pivotCenter: { x: 9, y: 9 },
  waterSource: { x: 9, y: 9 },
  powerSource: { x: 9, y: 9 },
  machine: {
    ...defaultMachine(),
    spanLengthsMeters: [60],
  },
  obstacles: [],
  mapFeatures: [],
}), { gridDivisions: 5, maxCandidates: 3 });
assert.equal(infeasibleAnalysis.status, "no_feasible_candidate");
assert.equal(infeasibleAnalysis.bestCandidate, null);
assert.ok(infeasibleAnalysis.candidates.length > 0);
assert.ok(infeasibleAnalysis.blockers.some((blocker) => blocker.includes("No generated center candidate")));

const waterWeighted = buildPivotPlacementCandidates(project, {
  gridDivisions: 8,
  maxCandidates: 3,
  waterSourceWeight: 60,
  powerSourceWeight: 0,
  accessWeight: 0,
});
const powerWeighted = buildPivotPlacementCandidates(project, {
  gridDivisions: 8,
  maxCandidates: 3,
  waterSourceWeight: 0,
  powerSourceWeight: 60,
  accessWeight: 0,
});
assert.notEqual(waterWeighted[0].id, powerWeighted[0].id);

const crossingProfileCandidate = buildPivotPlacementCandidates(project, {
  gridDivisions: 8,
  maxCandidates: 1,
  obstacleCrossingProfiles: [{
    obstacleId: bufferedObstacle.id,
    crossingAllowed: true,
    minimumClearanceMeters: 4,
    reason: "Operator says this low object may be spanned; requires field/vendor review.",
    advisoryOnly: true,
  }],
})[0];
assert.deepEqual(crossingProfileCandidate.obstacleCrossingProfileIds, [bufferedObstacle.id]);
assert.ok(crossingProfileCandidate.warnings.some((warning) => warning.includes("obstacle crossing profile")));

const cornerSwingLimit: ProjectMapFeature = {
  id: "corner-evidence",
  name: "Corner evidence",
  kind: "corner_swing_limit",
  geometry: {
    type: "Polygon",
    vertices: [
      { x: 150, y: 82 },
      { x: 218, y: 82 },
      { x: 218, y: 138 },
      { x: 152, y: 138 },
    ],
  },
  confidence: "user_estimated",
};
const cornerProject = makeProject({
  mapFeatures: [accessLane, cornerSwingLimit],
  machine: {
    ...defaultMachine(),
    cornerArm: {
      id: "corner-arm-a",
      name: "Corner arm A",
      advisoryOnly: true,
      lengthMeters: 65,
      guidanceType: "gps_guidance",
      sequencingType: "electronic",
      orientation: "operator_supplied",
      confidence: "user_estimated",
      sourceRefs: [{
        sourceId: "SRC-VALLEY-VFLEX-CORNER",
        title: "Valley VFlex Corner",
        url: "https://www.valleyirrigation.com/vflex-corner",
        checkedAt: "2026-06-05",
        limit: "Manufacturer public feature/specification reference only; CPLayout does not certify compatibility or kinematics.",
      }],
    },
  },
});
const before = evaluateLayout(cornerProject);
const evaluation = evaluateAdvisoryCornerArm(cornerProject);
const after = evaluateLayout(cornerProject);
assert.equal(evaluation.status, "ready");
assert.equal(evaluation.canonicalGeometryMutation, false);
assert.equal(evaluation.unverifiedKinematics, true);
assert.deepEqual(evaluation.evidenceFeatureIds, ["corner-evidence"]);
assert.ok(evaluation.estimatedAddedCoverageAcres >= 0);
assert.deepEqual(after.allowedCoverage, before.allowedCoverage);
assert.equal(after.metrics.endGunAcres, before.metrics.endGunAcres);
assert.equal(after.metrics.irrigatedAcres, before.metrics.irrigatedAcres);

const missingEvaluation = evaluateAdvisoryCornerArm({ ...cornerProject, machine: { ...cornerProject.machine, cornerArm: undefined } });
assert.equal(missingEvaluation.status, "missing_config");
assert.equal(missingEvaluation.coverageCandidate.length, 0);

const previewConfig = { ...cornerProject.machine.cornerArm!, lengthMeters: 90 };
const previewWithoutSavedConfig = evaluateAdvisoryCornerArm({ ...cornerProject, machine: { ...cornerProject.machine, cornerArm: undefined } }, previewConfig);
const previewWithSavedConfig = evaluateAdvisoryCornerArm(cornerProject, previewConfig);
assert.ok(previewWithoutSavedConfig.pathEnvelope.length > 0);
assert.deepEqual(previewWithSavedConfig.pathEnvelope, previewWithoutSavedConfig.pathEnvelope);
assert.notDeepEqual(previewWithSavedConfig.pathEnvelope, evaluation.pathEnvelope);
const noSprayCorner = evaluateAdvisoryCornerArm({ ...cornerProject, obstacles: [{
  id: "no-spray-field", name: "No spray", kind: "exclusion", confidence: "user_estimated",
  polygon: cornerProject.fieldBoundary, bufferMeters: 0, hardConflict: false, noSpray: true,
}] });
assert.equal(noSprayCorner.estimatedAddedCoverageAcres, 0);
assert.deepEqual(noSprayCorner.coverageCandidate, []);

console.log("advisory pivot placement tests passed");

function makeProject(overrides: Partial<PivotProject> = {}): PivotProject {
  const pivotCenter = overrides.pivotCenter ?? { x: 30, y: 40 };
  return {
    id: "advisory-placement-test",
    name: "Advisory placement test",
    // Synthetic metre-grid arithmetic, not georeferenced field evidence.
    projectCrs: "EPSG:32613",
    unitSystem: "metric",
    fieldBoundary: overrides.fieldBoundary ?? field,
    pivotCenter,
    waterSource: overrides.waterSource ?? { x: 0, y: 0 },
    powerSource: overrides.powerSource ?? { x: 220, y: 140 },
    machine: overrides.machine ?? defaultMachine(),
    obstacles: overrides.obstacles ?? [],
    surveyPoints: overrides.surveyPoints ?? [],
    mapFeatures: overrides.mapFeatures ?? [],
  };
}

function defaultMachine(): PivotMachine {
  return {
    id: "machine-a",
    name: "Machine A",
    spanLengthsMeters: [30, 30],
    overhangMeters: 0,
    endGunThrowMeters: 0,
    towerClearanceBufferMeters: 4,
    machineClearanceBufferMeters: 6,
    sweep: { mode: "full_circle" },
  };
}
