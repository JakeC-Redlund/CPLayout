import assert from "node:assert/strict";
import { test } from "node:test";
import { qualifyProjectCrs, sampleProject, type PivotProject } from "@cplayout/core";
import * as geometry from "./geometry";
import * as placement from "./advisoryPivotPlacement";
import { optimizePivotCenter, optimizePivotCenterSteps } from "./pivotCenterOptimizer";
import { buildAdvisoryMachineRenderModel, buildAdvisoryMachineRenderModelSteps } from "./advisoryMachineRenderModel";
import { auditGeneratedFieldPivotReviewZones, buildAdvisoryDesignReport, type AdvisoryDesignReportInput } from "./advisoryDesignReport";
import { buildDesignScenarioPreview } from "./designScenarios";
import { evaluateCornerArmKinematics } from "./cornerArmKinematics";
import { evaluateCornerGpsMapAdvisoryReview } from "./cornerGpsMapAdvisoryReview";
import { validateCenterPivotProofGeometry } from "./layoutProof";

const metricResult = geometry.evaluateLayout(sampleProject);
const rejectBeforeInputs = <T>(project?: PivotProject): T => new Proxy({ project }, {
  get(target, key) {
    if (key === "project") return target.project;
    throw new Error(`Unexpected calculation input read: ${String(key)}`);
  },
}) as T;

const calculations: Record<string, (project: PivotProject) => unknown> = {
  layout: geometry.evaluateLayout,
  mechanical: geometry.evaluateMechanicalConflicts,
  paths: geometry.buildLayoutPathOverlays,
  pathSteps: (p) => geometry.buildLayoutPathOverlaysSteps(p).next(),
  corner: geometry.evaluateCornerArmPath,
  cornerSteps: (p) => geometry.evaluateCornerArmPathSteps(p).next(),
  clearance: geometry.evaluateMachineBoundaryClearance,
  pathDistance: (p) => geometry.evaluatePathBoundaryDistance(p, 20),
  wetCoverage: geometry.validateWetCoverageWithinField,
  export: (p) => geometry.exportScenarioGeoJson(p, metricResult),
  optimize: optimizePivotCenter,
  optimizeSteps: (p) => optimizePivotCenterSteps(p).next(),
  candidates: placement.buildPivotPlacementCandidates,
  candidateSteps: (p) => placement.buildPivotPlacementCandidatesSteps(p).next(),
  idealCenter: placement.analyzeIdealPivotCenter,
  multiMachine: placement.analyzeAdvisoryMultiMachineLayout,
  multiMachineSteps: (p) => placement.analyzeAdvisoryMultiMachineLayoutSteps(p).next(),
  fieldPlan: placement.planAdvisoryFieldPivots,
  fieldPlanSteps: (p) => placement.planAdvisoryFieldPivotsSteps(p).next(),
  strategy: placement.compareAdvisoryMachineStrategies,
  radiusSensitivity: placement.buildAdvisoryRadiusSensitivityReview,
  endGunSensitivity: placement.buildAdvisoryEndGunSensitivityReview,
  sweepSensitivity: placement.buildAdvisorySweepEfficiencyReview,
  obstacles: placement.analyzeAdvisoryObstacleInteractions,
  advisoryCorner: placement.evaluateAdvisoryCornerArm,
  render: buildAdvisoryMachineRenderModel,
  renderSteps: (p) => buildAdvisoryMachineRenderModelSteps(p).next(),
  reviewZones: (p) => auditGeneratedFieldPivotReviewZones(p, rejectBeforeInputs()),
  report: (p) => buildAdvisoryDesignReport(rejectBeforeInputs<AdvisoryDesignReportInput>(p)),
  scenarios: buildDesignScenarioPreview,
};

for (const projectCrs of ["EPSG:26741", "LOCAL:TEST", "EPSG:3857", "EPSG:26723"]) {
  test(`${projectCrs} cannot produce metric layouts or silently empty optimizer results`, () => {
    const project = { ...sampleProject, projectCrs };
    const before = JSON.stringify(project);
    for (const [name, calculate] of Object.entries(calculations)) {
      assert.throws(() => calculate(project), /Metric planar calculations unavailable/i, name);
    }
    assert.equal(JSON.stringify(project), before);
  });

  test(`${projectCrs} produces blocked review diagnostics without metre clearance`, () => {
    const project = { ...sampleProject, projectCrs };
    const review = evaluateCornerGpsMapAdvisoryReview(project);
    assert.equal(review.status, "blocked");
    assert.ok(review.issues.some((issue) => issue.code === "unqualified_metric_crs"));
    for (const key of ["minBoundaryDistanceFromPivotMeters", "lrduBoundaryClearanceMeters", "endGunBoundaryClearanceMeters", "minObstacleClearanceMeters"] as const) {
      assert.equal(review.metrics[key], null);
    }
    const corner = evaluateCornerArmKinematics({ projectCrs, orientation: "leading", rotationDirection: "clockwise" });
    assert.equal(corner.status, "blocked");
    assert.ok(corner.infeasibleDiagnostics.some((issue) => issue.code === "missing_projected_crs"));
    assert.match(validateCenterPivotProofGeometry(project, metricResult)[0], /Metric planar calculations unavailable/i);
  });
}

test("metric grid arithmetic does not confer field qualification", () => {
  assert.ok(metricResult.metrics.fieldAcres > 0);
  assert.equal(qualifyProjectCrs(sampleProject.projectCrs).calculation.allowed, true);
  assert.equal(qualifyProjectCrs(sampleProject.projectCrs).field.qualified, false);
});
