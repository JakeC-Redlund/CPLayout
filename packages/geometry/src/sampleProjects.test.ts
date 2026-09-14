import assert from "node:assert/strict";

import {
  advisoryCornerArmSampleProject,
  endGunShutoffArcSampleProject,
  fullScopeMultiPivotCostDemoProject,
  improvedFullCircleSampleProject,
  partialSweepNearRoadSampleProject,
  sampleDesignProjects,
  sampleProject,
  willRheaJasonHarmelinkExampleProject,
} from "@cplayout/core";

import {
  analyzeAdvisoryMultiMachineLayout,
  analyzeAdvisoryObstacleInteractions,
  buildAdvisoryRadiusSensitivityReview,
  compareAdvisoryMachineStrategies,
  planAdvisoryFieldPivots,
} from "./advisoryPivotPlacement";
import { buildAdvisoryDesignReport } from "./advisoryDesignReport";
import { buildAdvisoryMachineRenderModel } from "./advisoryMachineRenderModel";
import { buildDesignScenarioPreview } from "./designScenarios";
import { evaluateLayout } from "./geometry";
import { rankLayoutAlternatives } from "./layoutScoring";

const before = JSON.stringify(sampleDesignProjects.map((entry) => entry.project));

assert.equal(sampleDesignProjects.length, 7);
assert.equal(sampleDesignProjects[0].project, willRheaJasonHarmelinkExampleProject);
assert.equal(sampleDesignProjects[0].reviewStatus, "needs_review");
assert.equal(sampleDesignProjects[1].project, sampleProject);
assert.equal(sampleDesignProjects[1].reviewStatus, "needs_review");
assert.ok(sampleDesignProjects.slice(2).every((entry) => entry.reviewStatus === "curated"));
assert.ok(sampleDesignProjects.every((entry) => entry.project.projectCrs === "EPSG:32613" || entry.project.projectCrs === "EPSG:32614"));

const willRhea = evaluateLayout(willRheaJasonHarmelinkExampleProject);
assert.equal(willRheaJasonHarmelinkExampleProject.id, "will-rhea-jason-harmelink-example");
assert.equal(willRheaJasonHarmelinkExampleProject.projectCrs, "EPSG:32614");
assert.equal(willRheaJasonHarmelinkExampleProject.wgs84Companion, undefined);
assert.ok(willRheaJasonHarmelinkExampleProject.fieldBoundary.length > 50);
assert.ok(willRhea.metrics.fieldAcres > 100);
const willRheaFeatureCounts = (willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).reduce<Record<string, number>>((counts, feature) => {
  counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
  return counts;
}, {});
assert.equal(willRheaFeatureCounts.planning_boundary, 1);
assert.equal(willRheaFeatureCounts.measurement_line, 1);
assert.equal(willRheaFeatureCounts.machine_zone, 4);
assert.equal((willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).some((feature) => feature.id === "will-rhea-existing-machine-zone"), false);
const willRheaPreferredOutlines = (willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).filter((feature) => (
  feature.kind === "machine_zone"
  && feature.properties?.preferredMachineOutline === true
));
assert.equal(willRheaPreferredOutlines.length, 2);
assert.deepEqual(willRheaPreferredOutlines.map((feature) => feature.name).sort(), ["Middle Part Circle", "South East Circle"]);
const willRheaRenderModel = buildAdvisoryMachineRenderModel(willRheaJasonHarmelinkExampleProject);
assert.equal(willRheaRenderModel.instances.length, 2);
assert.equal(willRheaRenderModel.instances.some((instance) => instance.label === "South East Circle" && instance.sweep.mode === "full_circle"), true);
assert.equal(willRheaRenderModel.instances.some((instance) => instance.label === "Middle Part Circle" && instance.sweep.mode === "partial_circle"), true);
assert.ok((willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).every((feature) => feature.properties?.canonicalGeometryMutation === false));
assert.ok((willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).every((feature) => feature.properties?.evidenceOnly === true));
assert.ok((willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).every((feature) => feature.properties?.sourceKmzSha256 === "895e9367fd07c730572618d5ed01b96a66519de725faab082d6f1714ef827401"));
assert.ok((willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).every((feature) => feature.properties?.sourceDocKmlSha256 === "aa2b577569c7bdf52197761bdcfadcc2c8e87afe60294c0151409a785645d97e"));
assert.equal(
  (willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).find((feature) => feature.id === "will-rhea-middle-machine-field-boundary")?.kind,
  "machine_zone",
);
assert.equal(
  (willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).find((feature) => feature.id === "will-rhea-south-machine-field-boundary")?.kind,
  "machine_zone",
);
const willRheaLrduFeature = (willRheaJasonHarmelinkExampleProject.mapFeatures ?? []).find((feature) => feature.id === "will-rhea-lrdu-distance");
assert.equal(willRheaLrduFeature?.properties?.derivedLengthMeters, 462.9);
assert.ok(willRheaJasonHarmelinkExampleProject.surveyPoints.some((point) => point.role === "pivot_center" && point.label === "Pivot Point"));
const willRheaRadiusSensitivity = buildAdvisoryRadiusSensitivityReview(willRheaJasonHarmelinkExampleProject, {
  gridDivisions: 5,
  maxCandidates: 2,
  maxMachines: 3,
  radiiMeters: [185.168],
});
assert.equal(willRheaRadiusSensitivity.importedRadiusMeters, 462.9);
assert.equal(willRheaRadiusSensitivity.rows[0]?.requestedRadiusMeters, 185.168);
assert.equal(willRheaRadiusSensitivity.rows[0]?.canonicalGeometryMutation, false);
assert.equal(JSON.stringify(willRheaJasonHarmelinkExampleProject).includes("wgs84Companion"), false);

const baseline = evaluateLayout(sampleProject);
assert.ok(baseline.metrics.obstacleConflictCount > 0);
assert.ok(baseline.metrics.hardMechanicalConflictCount > 0);

const improvedFullCircle = evaluateLayout(improvedFullCircleSampleProject);
assert.equal(improvedFullCircle.metrics.obstacleConflictCount, 0);
assert.equal(improvedFullCircle.metrics.hardMechanicalConflictCount, 0);
assert.equal(improvedFullCircle.metrics.outsideFieldAcres, 0);
assert.ok(improvedFullCircle.metrics.coveragePercent > 20);

const partialSweep = evaluateLayout(partialSweepNearRoadSampleProject);
assert.equal(partialSweepNearRoadSampleProject.machine.sweep.mode, "partial_circle");
assert.ok(partialSweep.metrics.obstacleConflictCount > 0);
assert.ok(partialSweep.metrics.hardMechanicalConflictCount > 0);
assert.equal(partialSweep.metrics.outsideFieldAcres, 0);

const endGunArc = evaluateLayout(endGunShutoffArcSampleProject);
assert.equal(endGunArc.metrics.obstacleConflictCount, 0);
// Shutting off spray does not remove the machine or the shed's physical clearance buffer.
assert.equal(endGunArc.metrics.hardMechanicalConflictCount, 1);
assert.equal(endGunArc.metrics.towerTrackConflictCount, 0);
assert.deepEqual(endGunArc.mechanicalConflicts.map(({ obstacleId, conflictType }) => ({ obstacleId, conflictType })), [
  { obstacleId: "building-pad", conflictType: "machine_path" },
]);
const shedCornerDistance = Math.hypot(501542 - endGunShutoffArcSampleProject.pivotCenter.x, 4506522 - endGunShutoffArcSampleProject.pivotCenter.y);
assert.ok(shedCornerDistance > 198.5, "the unbuffered physical radius remains clear");
assert.ok(shedCornerDistance < 198.5 + 8 + 12, "machine and shed clearance buffers overlap");
assert.ok(endGunArc.metrics.endGunAcres > 1);
assert.ok((endGunShutoffArcSampleProject.machine.endGunAngleRanges?.length ?? 0) > 0);

const cornerArm = evaluateLayout(advisoryCornerArmSampleProject);
assert.equal(cornerArm.metrics.obstacleConflictCount, 0);
assert.ok((advisoryCornerArmSampleProject.mapFeatures ?? []).some((feature) => feature.kind === "corner_swing_limit"));
assert.ok(buildDesignScenarioPreview(advisoryCornerArmSampleProject, { includeOptimizedCandidates: false })
  .some((scenario) => scenario.source === "advisory_corner_arm" && scenario.feasible === false));

const fullScopeDemo = evaluateLayout(fullScopeMultiPivotCostDemoProject);
const fullScopeDemoBefore = JSON.stringify(fullScopeMultiPivotCostDemoProject);
const fullScopeSerialized = JSON.stringify(fullScopeMultiPivotCostDemoProject);
assert.equal(fullScopeMultiPivotCostDemoProject.id, "sample-full-scope-multi-pivot-cost-demo");
assert.equal(fullScopeMultiPivotCostDemoProject.projectCrs, "EPSG:32613");
assert.equal(fullScopeMultiPivotCostDemoProject.wgs84Companion, undefined);
assert.equal(fullScopeSerialized.includes("Will Rhea"), false);
assert.equal(fullScopeSerialized.includes("Jason Harmelink"), false);
assert.equal(fullScopeSerialized.includes("Harmelink"), false);
assert.ok(fullScopeDemo.metrics.coveragePercent > 5);
const fullScopeFeatureCounts = (fullScopeMultiPivotCostDemoProject.mapFeatures ?? []).reduce<Record<string, number>>((counts, feature) => {
  counts[feature.kind] = (counts[feature.kind] ?? 0) + 1;
  return counts;
}, {});
assert.equal(fullScopeFeatureCounts.planning_boundary, 2);
assert.equal(fullScopeFeatureCounts.machine_zone, 3);
assert.equal(fullScopeFeatureCounts.linear_move_path, 1);
assert.equal(fullScopeFeatureCounts.measurement_line, 1);
assert.ok((fullScopeFeatureCounts.well_location ?? 0) >= 1);
assert.ok((fullScopeFeatureCounts.underground_pipeline ?? 0) >= 1);
assert.ok((fullScopeFeatureCounts.underground_wire ?? 0) >= 1);
assert.ok((fullScopeFeatureCounts.power_line ?? 0) >= 1);
assert.ok((fullScopeFeatureCounts.power_pole ?? 0) >= 1);
assert.ok(fullScopeMultiPivotCostDemoProject.surveyPoints.some((point) => /second pivot/i.test(`${point.label} ${point.notes ?? ""}`)));

const fullScopeMultiMachineReview = analyzeAdvisoryMultiMachineLayout(fullScopeMultiPivotCostDemoProject);
assert.equal(fullScopeMultiMachineReview.status, "no_feasible_scenarios");
assert.equal(fullScopeMultiMachineReview.compilation.fullScopeBoundarySource, "planning_boundary");
assert.equal(fullScopeMultiMachineReview.compilation.scenarioBoundarySource, "machine_zone");
assert.equal(fullScopeMultiMachineReview.compilation.planningBoundaryCount, 2);
assert.equal(fullScopeMultiMachineReview.compilation.machineZoneCount, 3);
assert.equal(fullScopeMultiMachineReview.scenarios.length, 3);
assert.ok(fullScopeMultiMachineReview.compilation.readyScenarioCount >= 2);
assert.ok(fullScopeMultiMachineReview.compilation.outsideFullScopeAcres > 0);
assert.ok(fullScopeMultiMachineReview.blockers.some((blocker) => blocker.includes("outside the full-scope field boundary")));
assert.ok(fullScopeMultiMachineReview.compilation.compiledBoundaryAcres > fullScopeMultiMachineReview.compilation.fieldBoundaryAcres * 0.5);

const fullScopeStrategyComparison = compareAdvisoryMachineStrategies(fullScopeMultiPivotCostDemoProject, {
  costInput: {
    fixedMachineCost: 85000,
    costPerMeter: 650,
    costPerTower: 2800,
    currencyCode: "USD",
  },
});
assert.equal(fullScopeStrategyComparison.costInputStatus, "complete");
const readyStrategyKinds = new Set(fullScopeStrategyComparison.strategies.filter((strategy) => strategy.status === "ready").map((strategy) => strategy.strategyKind));
assert.ok(readyStrategyKinds.has("current_machine"));
assert.ok(readyStrategyKinds.has("full_circle_radius"));
assert.ok(readyStrategyKinds.has("linear_lateral_move"));
assert.ok(readyStrategyKinds.has("bender_second_pivot"));
assert.equal(fullScopeStrategyComparison.strategies.some((strategy) => strategy.strategyKind === "unsupported_linear_lateral"), false);
assert.equal(fullScopeStrategyComparison.strategies.some((strategy) => strategy.strategyKind === "unsupported_bender_second_pivot"), false);
assert.ok(fullScopeStrategyComparison.strategies.some((strategy) => strategy.strategyKind === "linear_lateral_move" && strategy.costAssessment?.status === "complete"));
assert.ok(fullScopeStrategyComparison.strategies.some((strategy) => strategy.strategyKind === "bender_second_pivot" && strategy.costAssessment?.status === "complete"));
assert.ok(fullScopeStrategyComparison.strategies.filter((strategy) => strategy.status === "ready").length >= 3);

const fullScopeGeneratedPlan = planAdvisoryFieldPivots(fullScopeMultiPivotCostDemoProject, { maxMachines: 3 });
assert.equal(fullScopeGeneratedPlan.canonicalGeometryMutation, false);
assert.ok(fullScopeGeneratedPlan.requestedMachineCount >= 3);
assert.ok(fullScopeGeneratedPlan.candidates.length > 0);
assert.ok((fullScopeGeneratedPlan.selectedMachineCount ?? 0) >= 2);
assert.ok(fullScopeGeneratedPlan.candidates.every((candidate) => candidate.canonicalGeometryMutation === false));

const fullScopeObstacleReview = analyzeAdvisoryObstacleInteractions(fullScopeMultiPivotCostDemoProject);
assert.equal(fullScopeObstacleReview.status, "ready");
assert.ok(fullScopeObstacleReview.summary.utilityPathReviewCount > 0);
assert.ok(fullScopeObstacleReview.summary.hardBlockingCount > 0);

const fullScopeReport = buildAdvisoryDesignReport({
  project: fullScopeMultiPivotCostDemoProject,
  result: fullScopeDemo,
  fieldPivotPlan: fullScopeGeneratedPlan,
  multiMachineReview: fullScopeMultiMachineReview,
  strategyComparison: fullScopeStrategyComparison,
  obstacleInteractionReview: fullScopeObstacleReview,
});
assert.ok(fullScopeReport.text.includes("Advisory only: true"));
assert.ok(fullScopeReport.text.includes("Canonical geometry mutation: false"));
assert.ok(fullScopeReport.text.includes("Full-Scope"));
assert.ok(fullScopeReport.text.includes("Machine Strategy And Cost Review"));
assert.ok(fullScopeReport.text.includes("Cost review is local and advisory"));
assert.equal(JSON.stringify(fullScopeMultiPivotCostDemoProject), fullScopeDemoBefore);

const ranked = rankLayoutAlternatives([
  { id: "baseline", project: sampleProject, confidence: 0.8, source: "operator" },
  { id: "improved-full-circle", project: improvedFullCircleSampleProject, confidence: 0.8, source: "operator" },
  { id: "partial-sweep-road", project: partialSweepNearRoadSampleProject, confidence: 0.8, source: "operator" },
], {
  hardBoundary: true,
  maxObstacleConflicts: 0,
  maxOutsideFieldAcres: 0.0001,
  minCoveragePercent: 1,
});

assert.equal(ranked[0].id, "improved-full-circle");
assert.equal(ranked[0].feasible, true);
assert.equal(ranked.at(-1)?.id, "partial-sweep-road");

buildDesignScenarioPreview(improvedFullCircleSampleProject, { maxOptimizedCandidates: 2 });
assert.equal(JSON.stringify(sampleDesignProjects.map((entry) => entry.project)), before);

console.log("sample project fixture tests passed");
