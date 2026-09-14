import { assertMetricCalculationCrs } from "@cplayout/core";
import type { AdvisorySourceReference, LayoutResult, PivotProject, ProjectMapFeature, XY } from "@cplayout/core";

import { buildAdvisoryGeneratedMultiPivotScenarioReview } from "./advisoryPivotPlacement";
import type { AdvisoryMachineRenderAcreLedger } from "./advisoryMachineRenderModel";
import type {
  AdvisoryEndGunSensitivityReview,
  AdvisoryFieldPivotPlan,
  AdvisoryGeneratedMultiPivotScenarioReview,
  AdvisoryMachineStrategyComparison,
  AdvisoryMultiMachineReview,
  AdvisoryObstacleInteractionReview,
  AdvisoryRadiusSensitivityReview,
  AdvisorySweepEfficiencyReview,
} from "./advisoryPivotPlacement";

export type AdvisoryDesignReportReadiness = "blocked" | "ready_for_review";
export type AdvisoryGeneratedReviewZoneAuditStatus = "current" | "missing" | "stale";

export interface AdvisoryGeneratedReviewZoneAuditItem {
  sequence: number;
  candidateId: string | null;
  featureId: string | null;
  status: AdvisoryGeneratedReviewZoneAuditStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  expectedCenter: XY | null;
  savedCenter: XY | null;
  expectedRadiusMeters: number | null;
  savedRadiusMeters: number | null;
  centerDeltaMeters: number | null;
  radiusDeltaMeters: number | null;
  reasons: string[];
}

export interface AdvisoryGeneratedReviewZoneAudit {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  itemCount: number;
  currentCount: number;
  missingCount: number;
  staleCount: number;
  items: AdvisoryGeneratedReviewZoneAuditItem[];
  warnings: string[];
}

export interface AdvisoryDesignReportSection {
  id: string;
  title: string;
  lines: string[];
}

export interface AdvisoryDesignReportInput {
  project: PivotProject;
  result: LayoutResult;
  fieldPivotPlan: AdvisoryFieldPivotPlan;
  multiMachineReview: AdvisoryMultiMachineReview;
  strategyComparison: AdvisoryMachineStrategyComparison;
  obstacleInteractionReview: AdvisoryObstacleInteractionReview;
  radiusSensitivityReview?: AdvisoryRadiusSensitivityReview | null;
  endGunSensitivityReview?: AdvisoryEndGunSensitivityReview;
  sweepEfficiencyReview?: AdvisorySweepEfficiencyReview;
  generatedMultiPivotScenarioReview?: AdvisoryGeneratedMultiPivotScenarioReview;
  reviewZoneAudit?: AdvisoryGeneratedReviewZoneAudit;
  advisoryMachineRenderAcreLedger?: AdvisoryMachineRenderAcreLedger | null;
  generatedAt?: string;
}

export interface AdvisoryDesignReport {
  title: string;
  generatedAt: string;
  projectId: string;
  projectName: string;
  projectCrs: string;
  readiness: AdvisoryDesignReportReadiness;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  headline: string;
  sections: AdvisoryDesignReportSection[];
  sourceRefs: AdvisorySourceReference[];
  warnings: string[];
  reviewZoneAudit: AdvisoryGeneratedReviewZoneAudit;
  text: string;
}

export function auditGeneratedFieldPivotReviewZones(
  project: PivotProject,
  fieldPivotPlan: AdvisoryFieldPivotPlan,
): AdvisoryGeneratedReviewZoneAudit {
  assertMetricCalculationCrs(project.projectCrs);
  const savedFeatures = (project.mapFeatures ?? []).filter(isGeneratedFieldPivotZoneFeature);
  const usedFeatureIds = new Set<string>();
  const planItems = fieldPivotPlan.candidates.map((candidate): AdvisoryGeneratedReviewZoneAuditItem => {
    const feature = savedFeatures.find((candidateFeature) => featureSequence(candidateFeature) === candidate.sequence) ?? null;
    if (!feature) {
      return {
        sequence: candidate.sequence,
        candidateId: candidate.id,
        featureId: null,
        status: "missing",
        advisoryOnly: true,
        canonicalGeometryMutation: false,
        qualifiedReviewRequired: true,
        expectedCenter: candidate.pivotCenter,
        savedCenter: null,
        expectedRadiusMeters: candidate.machineRadiusMeters,
        savedRadiusMeters: null,
        centerDeltaMeters: null,
        radiusDeltaMeters: null,
        reasons: ["Generated advisory machine-zone review feature is missing for this candidate sequence."],
      };
    }
    usedFeatureIds.add(feature.id);
    const savedCircle = feature.geometry.type === "Circle" ? feature.geometry : null;
    const centerDeltaMeters = savedCircle ? distance(candidate.pivotCenter, savedCircle.center) : null;
    const radiusDeltaMeters = savedCircle ? Math.abs(candidate.machineRadiusMeters - savedCircle.radiusMeters) : null;
    const reasons = [
      ...(feature.kind !== "machine_zone" ? ["Saved feature is no longer a machine_zone."] : []),
      ...(savedCircle ? [] : ["Saved feature geometry is no longer a Circle."]),
      ...(savedCircle && centerDeltaMeters !== null && centerDeltaMeters > 0.25 ? [`Saved center differs by ${centerDeltaMeters.toFixed(2)} meters.`] : []),
      ...(savedCircle && radiusDeltaMeters !== null && radiusDeltaMeters > 0.1 ? [`Saved radius differs by ${radiusDeltaMeters.toFixed(2)} meters.`] : []),
      ...(feature.properties?.generatedFieldPivotCandidateId !== candidate.id ? ["Saved candidate id does not match the current generated plan."] : []),
      ...(feature.properties?.generatedFieldPivotSequence !== candidate.sequence ? ["Saved sequence metadata does not match the current generated plan."] : []),
      ...(feature.properties?.canonicalGeometryMutation !== false ? ["Saved feature metadata no longer states canonicalGeometryMutation false."] : []),
    ];
    return {
      sequence: candidate.sequence,
      candidateId: candidate.id,
      featureId: feature.id,
      status: reasons.length === 0 ? "current" : "stale",
      advisoryOnly: true,
      canonicalGeometryMutation: false,
      qualifiedReviewRequired: true,
      expectedCenter: candidate.pivotCenter,
      savedCenter: savedCircle?.center ?? null,
      expectedRadiusMeters: candidate.machineRadiusMeters,
      savedRadiusMeters: savedCircle?.radiusMeters ?? null,
      centerDeltaMeters,
      radiusDeltaMeters,
      reasons,
    };
  });
  const orphanItems = savedFeatures
    .filter((feature) => !usedFeatureIds.has(feature.id))
    .map((feature): AdvisoryGeneratedReviewZoneAuditItem => {
      const savedCircle = feature.geometry.type === "Circle" ? feature.geometry : null;
      return {
        sequence: featureSequence(feature) ?? -1,
        candidateId: typeof feature.properties?.generatedFieldPivotCandidateId === "string" ? feature.properties.generatedFieldPivotCandidateId : null,
        featureId: feature.id,
        status: "stale",
        advisoryOnly: true,
        canonicalGeometryMutation: false,
        qualifiedReviewRequired: true,
        expectedCenter: null,
        savedCenter: savedCircle?.center ?? null,
        expectedRadiusMeters: null,
        savedRadiusMeters: savedCircle?.radiusMeters ?? null,
        centerDeltaMeters: null,
        radiusDeltaMeters: null,
        reasons: ["Saved generated review-zone feature no longer matches any current generated candidate sequence."],
      };
    });
  const items = [...planItems, ...orphanItems];
  const currentCount = items.filter((item) => item.status === "current").length;
  const missingCount = items.filter((item) => item.status === "missing").length;
  const staleCount = items.filter((item) => item.status === "stale").length;
  const warnings = [
    "Generated review-zone audit is advisory and does not mutate project geometry or storage.",
    ...(staleCount > 0 ? ["At least one saved generated review zone is stale relative to the current plan; save review zones again before relying on it for review."] : []),
    ...(missingCount > 0 ? ["At least one current generated center has not been saved as a review zone."] : []),
  ];
  return {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    itemCount: items.length,
    currentCount,
    missingCount,
    staleCount,
    items,
    warnings,
  };
}

export function buildAdvisoryDesignReport(input: AdvisoryDesignReportInput): AdvisoryDesignReport {
  assertMetricCalculationCrs(input.project.projectCrs);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const readiness: AdvisoryDesignReportReadiness = input.project.fieldBoundary.length >= 3
    ? "ready_for_review"
    : "blocked";
  const reviewZoneAudit = input.reviewZoneAudit ?? auditGeneratedFieldPivotReviewZones(input.project, input.fieldPivotPlan);
  const bestStrategy = input.strategyComparison.bestStrategy;
  const generatedRadiusStrategies = input.strategyComparison.strategies
    .filter((strategy) => strategy.strategyKind === "full_circle_radius")
    .sort((left, right) => left.machineRadiusMeters - right.machineRadiusMeters || left.label.localeCompare(right.label));
  const radiusSensitivityReview = input.radiusSensitivityReview ?? null;
  const endGunSensitivityReview = input.endGunSensitivityReview;
  const sweepEfficiencyReview = input.sweepEfficiencyReview;
  const generatedMultiPivotScenarioReview = input.generatedMultiPivotScenarioReview
    ?? buildAdvisoryGeneratedMultiPivotScenarioReview(input.fieldPivotPlan);
  const firstConflict = input.multiMachineReview.conflicts[0] ?? null;
  const firstObstacle = input.obstacleInteractionReview.items[0] ?? null;
  const acreLedger = buildAcreLedger(input);
  const powerLineEvidence = powerLineEvidenceStatus(input.project);
  const sourceRefs = dedupeSourceRefs([
    ...input.fieldPivotPlan.sourceRefs,
    ...generatedMultiPivotScenarioReview.sourceRefs,
    ...input.multiMachineReview.sourceRefs,
    ...input.strategyComparison.sourceRefs,
    ...input.obstacleInteractionReview.sourceRefs,
    ...(radiusSensitivityReview?.sourceRefs ?? []),
    ...(endGunSensitivityReview?.sourceRefs ?? []),
    ...(sweepEfficiencyReview?.sourceRefs ?? []),
    ...input.strategyComparison.strategies.flatMap((strategy) => strategy.sourceRefs),
    ...input.obstacleInteractionReview.items.flatMap((item) => item.sourceRefs),
  ]);
  const warnings = dedupeStrings([
    "Advisory report only; qualified field, hydraulic, electrical, and vendor review is required before construction or operation.",
    "Report generation does not change project geometry, machine settings, storage, archives, or KML/KMZ; canonical projected XY, active pivot, field boundary, and project schemas remain unchanged.",
    "Cost values use explicit operator-supplied local assumptions only and are not vendor quotes or purchase recommendations.",
    "Collision, bender, corner-arm, linear/lateral, and obstacle-crossing results are planning prompts only, not certified runtime behavior.",
    ...reviewZoneAudit.warnings,
    ...input.fieldPivotPlan.warnings,
    ...input.multiMachineReview.warnings,
    ...input.strategyComparison.warnings,
    ...input.obstacleInteractionReview.warnings,
    ...(radiusSensitivityReview?.warnings ?? []),
    ...generatedMultiPivotScenarioReview.warnings,
    ...(endGunSensitivityReview?.warnings ?? []),
    ...(sweepEfficiencyReview?.warnings ?? []),
  ]);
  const sections: AdvisoryDesignReportSection[] = [
    {
      id: "project",
      title: "Project Scope",
      lines: [
        `Project: ${input.project.name}`,
        `Project id: ${input.project.id}`,
        `Project CRS: ${input.project.projectCrs}`,
        `Generated at: ${generatedAt}`,
        "Canonical geometry: projected/local XY unchanged by this report.",
      ],
    },
    {
      id: "current-layout",
      title: "Current Layout Metrics",
      lines: [
        `Field acres: ${formatAcres(input.result.metrics.fieldAcres)}`,
        `Current modeled irrigated acres: ${formatAcres(input.result.metrics.irrigatedAcres)}`,
        `Current modeled coverage: ${formatPercent(input.result.metrics.coveragePercent)}`,
        `Outside-field wet acres: ${formatAcres(input.result.metrics.outsideFieldAcres)}`,
        `Hard mechanical conflicts: ${input.result.metrics.hardMechanicalConflictCount}`,
      ],
    },
    {
      id: "acre-ledger",
      title: "Acre Ledger",
      lines: [
        `Standard pivot acres: ${formatAcres(acreLedger.standardPivotAcres)}`,
        `End-gun acres: ${formatAcres(acreLedger.endGunAcres)}`,
        `Corner-arm acres: ${formatAcres(acreLedger.cornerArmAcres)} (advisory path evidence is not merged into layout coverage)`,
        `Total de-duplicated irrigated acres: ${formatAcres(acreLedger.totalDeduplicatedIrrigatedAcres)}`,
        `Modeled overlap acres: ${formatAcres(acreLedger.overlapAcres)}`,
        `Outside-field acres: ${formatAcres(acreLedger.outsideFieldAcres)}`,
        `Verified obstacle/no-spray blocked acres: ${formatAcres(acreLedger.verifiedBlockedAcres)}`,
        ...(input.advisoryMachineRenderAcreLedger ? [
          `Advisory render standard pivot acres: ${formatAcres(input.advisoryMachineRenderAcreLedger.standardPivotAcres)}`,
          `Advisory render end-gun acres: ${formatAcres(input.advisoryMachineRenderAcreLedger.endGunAcres)}`,
          `Advisory render corner-arm acres: ${formatAcres(input.advisoryMachineRenderAcreLedger.cornerArmAcres)} (render/display ledger only)`,
          `Advisory render de-duplicated total acres: ${formatAcres(input.advisoryMachineRenderAcreLedger.deduplicatedTotalAcres)}`,
          `Advisory render overlap acres: ${formatAcres(input.advisoryMachineRenderAcreLedger.overlapAcres)}`,
          `Advisory render outside-field acres: ${formatAcres(input.advisoryMachineRenderAcreLedger.outsideFieldAcres)}`,
          `Advisory render no-spray blocked acres: ${formatAcres(input.advisoryMachineRenderAcreLedger.verifiedBlockedAcres)}`,
        ] : []),
        `Full-scope outside acres: ${formatAcres(input.multiMachineReview.compilation.outsideFullScopeAcres)}`,
        `Power-line evidence status: ${readable(powerLineEvidence.status)}`,
        `Power-line exclusion conflicts: ${input.multiMachineReview.verifiedPowerExclusionConflictCount}`,
        powerLineEvidence.message,
      ],
    },
    {
      id: "generated-pivots",
      title: "Generated Field-Pivot Review",
      lines: [
        `Status: ${readable(input.fieldPivotPlan.status)}`,
        `Separated advisory centers: ${input.fieldPivotPlan.selectedMachineCount}/${input.fieldPivotPlan.requestedMachineCount}`,
        `Review-zone audit: ${reviewZoneAudit.currentCount} current, ${reviewZoneAudit.missingCount} missing, ${reviewZoneAudit.staleCount} stale`,
        `Modeled union acres: ${formatAcres(input.fieldPivotPlan.modeledIrrigatedUnionAcres)}`,
        `Field coverage: ${formatPercent(input.fieldPivotPlan.fieldCoveragePercent)}`,
        `Remaining dry acres: ${formatAcres(input.fieldPivotPlan.fieldUnirrigatedAcres)}`,
        `Rejected for separation: ${input.fieldPivotPlan.rejectedForSeparationCount}`,
        ...input.fieldPivotPlan.candidates.slice(0, 4).map((candidate) => (
          `Candidate ${candidate.sequence}: center ${formatPoint(candidate.pivotCenter)}, incremental ${formatAcres(candidate.incrementalIrrigatedAcres)}, cumulative ${formatPercent(candidate.cumulativeFieldCoveragePercent)}`
        )),
        ...reviewZoneAudit.items.filter((item) => item.status !== "current").slice(0, 4).map((item) => (
          `Review zone ${item.sequence}: ${item.status}, ${item.reasons[0] ?? "qualified review required"}`
        )),
        "Generated centers are review candidates only; they do not create saved pivots unless the operator uses an explicit reducer-backed action.",
      ],
    },
    {
      id: "generated-multi-pivot-scenario",
      title: "Generated Multi-Pivot Scenario Review",
      lines: [
        `Review status: ${readable(generatedMultiPivotScenarioReview.status)}`,
        `Selected centers: ${generatedMultiPivotScenarioReview.selectedCenterCount}/${generatedMultiPivotScenarioReview.requestedMachineCount}`,
        `Candidate pool: ${generatedMultiPivotScenarioReview.feasibleCandidateCount}/${generatedMultiPivotScenarioReview.candidatePoolCount} feasible`,
        `Modeled union acres: ${formatAcres(generatedMultiPivotScenarioReview.modeledIrrigatedUnionAcres)}`,
        `Duplicate modeled acres: ${formatAcres(generatedMultiPivotScenarioReview.duplicateModeledCoverageAcres)}`,
        `Field coverage: ${formatPercent(generatedMultiPivotScenarioReview.fieldCoveragePercent)}`,
        `Remaining dry acres: ${formatAcres(generatedMultiPivotScenarioReview.fieldUnirrigatedAcres)}`,
        `Cost evidence: ${readable(generatedMultiPivotScenarioReview.costInputStatus)}`,
        generatedMultiPivotScenarioReview.tightestSelectedSeparationMarginMeters !== null
          ? `Tightest selected separation margin: ${formatMeters(generatedMultiPivotScenarioReview.tightestSelectedSeparationMarginMeters)}`
          : "Tightest selected separation margin: first or only generated center.",
        generatedMultiPivotScenarioReview.largestSeparationDeficitMeters !== null
          ? `Largest rejected separation deficit: ${formatMeters(generatedMultiPivotScenarioReview.largestSeparationDeficitMeters)}`
          : "Largest rejected separation deficit: none reported.",
        ...generatedMultiPivotScenarioReview.rows.slice(0, 4).map((row) => (
          `Generated center ${row.sequence}: incremental ${formatAcres(row.incrementalIrrigatedAcres)}, cumulative ${formatPercent(row.cumulativeFieldCoveragePercent)}, separation margin ${row.separationMarginMeters === null ? "first center" : formatMeters(row.separationMarginMeters)}, cost ${readable(row.costStatus)}`
        )),
        ...generatedMultiPivotScenarioReview.rejectedRows.slice(0, 3).map((row) => (
          `Rejected candidate: deficit ${formatMeters(row.separationDeficitMeters)} to ${row.nearestSelectedCandidateId}`
        )),
        "Generated multi-pivot scenario review is advisory only; it does not create saved pivots, runtime collision prevention, or storage records.",
      ],
    },
    {
      id: "full-scope",
      title: "Full-Scope And Multi-Machine Review",
      lines: [
        `Review status: ${readable(input.multiMachineReview.status)}`,
        `Compiled boundary acres: ${formatAcres(input.multiMachineReview.compilation.compiledBoundaryAcres)}`,
        `Full-scope modeled coverage: ${formatPercent(input.multiMachineReview.compilation.fullScopeCoveragePercent)}`,
        `Full-scope remaining dry acres: ${formatAcres(input.multiMachineReview.compilation.fullScopeUnirrigatedAcres)}`,
        `Outside full-scope acres: ${formatAcres(input.multiMachineReview.compilation.outsideFullScopeAcres)}`,
        `Ready scenarios: ${input.multiMachineReview.compilation.readyScenarioCount}/${input.multiMachineReview.compilation.scenarioCount}`,
        `Machine zones: ${input.multiMachineReview.compilation.machineZoneCount}`,
        `Planning boundaries: ${input.multiMachineReview.compilation.planningBoundaryCount}`,
        `Envelope conflicts: ${input.multiMachineReview.conflicts.length}`,
        firstConflict
          ? `First conflict: ${firstConflict.leftZoneName} / ${firstConflict.rightZoneName}, ${readable(firstConflict.severity)}, deficit ${formatMeters(firstConflict.separationDeficitMeters)}`
          : "First conflict: none reported by advisory envelope screening.",
      ],
    },
    {
      id: "strategy-cost",
      title: "Machine Strategy And Cost Review",
      lines: [
        `Comparison status: ${readable(input.strategyComparison.status)}`,
        `Cost input status: ${readable(input.strategyComparison.costInputStatus)}`,
        bestStrategy
          ? `Best advisory strategy: ${bestStrategy.label}, ${formatAcres(bestStrategy.irrigatedAcres)}, score ${formatNumber(bestStrategy.advisoryScore)}`
          : "Best advisory strategy: none ready.",
        ...input.strategyComparison.strategies.slice(0, 5).map((strategy) => (
          `${strategy.label}: ${readable(strategy.status)}, ${formatAcres(strategy.irrigatedAcres)}, ${formatPercent(strategy.coveragePercent)} coverage, ${strategy.costAssessment ? readable(strategy.costAssessment.status) : "cost pending"}`
        )),
        `Generated radius alternatives: ${generatedRadiusStrategies.length}`,
        ...generatedRadiusStrategies.map((strategy) => (
          `${strategy.label}: radius ${formatMeters(strategy.machineRadiusMeters)}, ${readable(strategy.status)}, ${formatAcres(strategy.irrigatedAcres)}, ${formatStrategyCostLabel(strategy)}`
        )),
        "Cost review is local and advisory; CPLayout does not infer prices, quote equipment, or recommend purchases automatically.",
      ],
    },
    ...(radiusSensitivityReview ? [{
      id: "radius-sensitivity",
      title: "Radius Sensitivity Review",
      lines: [
        `Review source: ${readable(radiusSensitivityReview.source)}`,
        `Imported/current radius: ${formatMeters(radiusSensitivityReview.importedRadiusMeters)}`,
        `Rows reviewed: ${radiusSensitivityReview.readyRowCount}/${radiusSensitivityReview.rowCount}`,
        radiusSensitivityReview.bestByCostPerAcre
          ? `Best cost-per-acre radius: ${formatMeters(radiusSensitivityReview.bestByCostPerAcre.radiusMeters)}, ${formatStrategyCostLabel({ costAssessment: radiusSensitivityReview.bestByCostPerAcre.cost })}`
          : "Best cost-per-acre radius: none with complete local cost evidence.",
        radiusSensitivityReview.bestByFullScopeCoverage
          ? `Best full-scope coverage radius: ${formatMeters(radiusSensitivityReview.bestByFullScopeCoverage.radiusMeters)}, ${formatPercent(radiusSensitivityReview.bestByFullScopeCoverage.fullScopeCoveragePercent)} full-scope coverage`
          : "Best full-scope coverage radius: none with positive coverage evidence.",
        ...radiusSensitivityReview.rows.slice(0, 6).map((row) => (
          `${row.label}: radius ${formatMeters(row.radiusMeters)}, ${formatAcres(row.irrigatedAcres)} current, ${formatPercent(row.fullScopeCoveragePercent)} full-scope, ${row.selectedMachineCount} generated centers, ${row.readyScenarioCount}/${row.scenarioCount} ready zones, ${formatStrategyCostLabel({ costAssessment: row.cost })}`
        )),
        "Radius sensitivity is advisory only; rows do not change machine settings, create quotes, write storage, export KML/KMZ, or mutate canonical projected XY.",
      ],
    }] : []),
    ...(sweepEfficiencyReview ? [{
      id: "sweep-efficiency",
      title: "Sweep Efficiency Review",
      lines: [
        `Review status: ${readable(sweepEfficiencyReview.status)}`,
        `Imported/current sweep: ${readable(sweepEfficiencyReview.importedSweepMode)}`,
        `Current machine radius: ${formatMeters(sweepEfficiencyReview.currentMachineRadiusMeters)}`,
        `Rows reviewed: ${sweepEfficiencyReview.readyRowCount}/${sweepEfficiencyReview.rowCount}`,
        sweepEfficiencyReview.sameRadiusFullCircleRow
          ? `Same-radius full circle: ${formatAcres(sweepEfficiencyReview.sameRadiusFullCircleRow.irrigatedAcres)}, delta ${formatAcres(sweepEfficiencyReview.sameRadiusFullCircleRow.irrigatedAcresDeltaFromCurrent)}, ${formatSweepEfficiencyCostDelta(sweepEfficiencyReview.sameRadiusFullCircleRow)}`
          : "Same-radius full circle: not applicable for the current sweep.",
        sweepEfficiencyReview.bestShorterComparableFullCircleRow
          ? `Shorter comparable full circle: ${sweepEfficiencyReview.bestShorterComparableFullCircleRow.label}, ${formatAcres(sweepEfficiencyReview.bestShorterComparableFullCircleRow.irrigatedAcres)}, ${formatSweepEfficiencyCostDelta(sweepEfficiencyReview.bestShorterComparableFullCircleRow)}`
          : "Shorter comparable full circle: no generated row reached 95% of current modeled irrigated acres.",
        ...sweepEfficiencyReview.rows.slice(0, 5).map((row) => (
          `${row.label}: ${readable(row.sweepMode)}, radius ${formatMeters(row.radiusMeters)}, ${formatAcres(row.irrigatedAcres)}, ${formatStrategyCostLabel({ costAssessment: row.cost })}`
        )),
        "Sweep-efficiency review is advisory only; cost rows are operator assumptions, not vendor quotes or purchase recommendations.",
      ],
    }] : []),
    ...(endGunSensitivityReview ? [{
      id: "end-gun-sensitivity",
      title: "End-Gun Throw Sensitivity",
      lines: [
        `Imported/current throw: ${formatMeters(endGunSensitivityReview.importedThrowMeters)}`,
        `Rows reviewed: ${endGunSensitivityReview.readyRowCount}/${endGunSensitivityReview.rowCount}`,
        endGunSensitivityReview.bestByIncrementalAcres
          ? `Best modeled added acres: ${endGunSensitivityReview.bestByIncrementalAcres.label}, +${formatAcres(endGunSensitivityReview.bestByIncrementalAcres.incrementalIrrigatedAcres)}, outside-field ${formatAcres(endGunSensitivityReview.bestByIncrementalAcres.outsideFieldAcres)}`
          : "Best modeled added acres: none above the zero-throw baseline.",
        endGunSensitivityReview.bestByLowOutsideFieldAcres
          ? `Lowest outside-field row: ${endGunSensitivityReview.bestByLowOutsideFieldAcres.label}, outside-field ${formatAcres(endGunSensitivityReview.bestByLowOutsideFieldAcres.outsideFieldAcres)}`
          : "Lowest outside-field row: no throw rows available.",
        ...endGunSensitivityReview.rows.slice(0, 5).map((row) => (
          `${row.label}: throw ${formatMeters(row.throwMeters)}, wet radius ${formatMeters(row.wetRadiusMeters)}, end-gun ${formatAcres(row.endGunAcres)}, added ${formatAcres(row.incrementalIrrigatedAcres)}, conflicts ${row.obstacleConflictCount}/${row.hardMechanicalConflictCount}`
        )),
        "End-gun review is advisory only; pressure, wind, nozzle package, hydraulic limits, application uniformity, controls, and vendor shutoff constraints remain unmodeled.",
      ],
    }] : []),
    {
      id: "obstacles-utilities",
      title: "Obstacle And Utility Review",
      lines: [
        `Review status: ${readable(input.obstacleInteractionReview.status)}`,
        `Items reviewed: ${input.obstacleInteractionReview.itemCount}`,
        `Hard/blocking items: ${input.obstacleInteractionReview.summary.hardBlockingCount}`,
        `No-spray exclusions: ${input.obstacleInteractionReview.summary.noSprayExclusionCount}`,
        `Span/tower/utility crossing reviews: ${input.obstacleInteractionReview.summary.spanClearanceReviewCount + input.obstacleInteractionReview.summary.towerTrackReviewCount + input.obstacleInteractionReview.summary.utilityPathReviewCount}`,
        `Profiled crossing items: ${input.obstacleInteractionReview.summary.profiledItemCount}`,
        `Profile-blocked items: ${input.obstacleInteractionReview.summary.profileBlockedCount}`,
        `Profile clearance shortfalls: ${input.obstacleInteractionReview.summary.profileClearanceShortfallCount}`,
        firstObstacle
          ? `First item: ${firstObstacle.name}, ${readable(firstObstacle.category)}, ${firstObstacle.warnings[0] ?? "qualified review required"}`
          : "First item: no obstacle or utility evidence supplied.",
        "Crossing/passability labels are planning prompts only; they do not certify any machine can cross an object.",
      ],
    },
    {
      id: "limits",
      title: "Advisory Limits",
      lines: warnings.slice(0, 8),
    },
    {
      id: "sources",
      title: "Source References",
      lines: sourceRefs.length > 0
        ? sourceRefs.map(formatSourceRef)
        : ["No source references were attached to the advisory report inputs."],
    },
  ];
  const headline = [
    `${input.project.name} advisory design report`,
    `${input.fieldPivotPlan.selectedMachineCount}/${input.fieldPivotPlan.requestedMachineCount} generated centers`,
    `${formatPercent(input.multiMachineReview.compilation.fullScopeCoveragePercent)} full-scope modeled coverage`,
    `${readable(input.strategyComparison.costInputStatus)} cost input`,
    `${input.obstacleInteractionReview.summary.hardBlockingCount} hard/blocking items`,
  ].join(" | ");
  const report: Omit<AdvisoryDesignReport, "text"> = {
    title: "Advisory Design Report",
    generatedAt,
    projectId: input.project.id,
    projectName: input.project.name,
    projectCrs: input.project.projectCrs,
    readiness,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    headline,
    sections,
    sourceRefs,
    warnings,
    reviewZoneAudit,
  };
  return {
    ...report,
    text: formatAdvisoryDesignReportText(report),
  };
}

interface AdvisoryAcreLedger {
  standardPivotAcres: number;
  endGunAcres: number;
  cornerArmAcres: number;
  totalDeduplicatedIrrigatedAcres: number;
  overlapAcres: number;
  outsideFieldAcres: number;
  verifiedBlockedAcres: number;
}

function buildAcreLedger(input: AdvisoryDesignReportInput): AdvisoryAcreLedger {
  const totalDeduplicatedIrrigatedAcres = input.multiMachineReview.compilation.modeledIrrigatedUnionAcres > 0
    ? input.multiMachineReview.compilation.modeledIrrigatedUnionAcres
    : input.result.metrics.irrigatedAcres;
  return {
    standardPivotAcres: input.result.metrics.standardPivotAcres
      ?? Math.max(0, input.result.metrics.irrigatedAcres - input.result.metrics.endGunAcres),
    endGunAcres: input.result.metrics.endGunAcres,
    cornerArmAcres: input.result.metrics.cornerArmAcres ?? 0,
    totalDeduplicatedIrrigatedAcres,
    overlapAcres: input.multiMachineReview.compilation.duplicateModeledCoverageAcres,
    outsideFieldAcres: input.result.metrics.outsideFieldAcres,
    verifiedBlockedAcres: input.result.metrics.blockedByNoSprayAcres ?? 0,
  };
}

function powerLineEvidenceStatus(project: PivotProject): { status: "missing" | "provisional" | "verified" | "verified_exclusion"; message: string } {
  const powerFeatures = (project.mapFeatures ?? []).filter((feature) => feature.kind === "power_line" || feature.kind === "power_pole");
  if (powerFeatures.length === 0) {
    return {
      status: "missing",
      message: "Power-line status: no separate power_line or power_pole evidence supplied; machine-zone boundaries are not power-line blockers.",
    };
  }
  if (powerFeatures.some((feature) => (
    feature.properties?.powerLineExclusion === true
    || feature.properties?.power_line_exclusion === true
    || feature.properties?.powerLineEvidenceStatus === "verified_exclusion"
    || feature.properties?.power_line_evidence_status === "verified_exclusion"
  ))) {
    return {
      status: "verified_exclusion",
      message: "Power-line status: at least one verified exclusion feature is present and must be reviewed before customer approval.",
    };
  }
  if (powerFeatures.some((feature) => (
    feature.properties?.powerLineEvidenceStatus === "provisional"
    || feature.properties?.power_line_evidence_status === "provisional"
    || feature.confidence === "user_estimated"
  ))) {
    return {
      status: "provisional",
      message: "Power-line status: provisional power evidence is present; verify overhead geometry or record an explicit exclusion before approval.",
    };
  }
  return {
    status: "verified",
    message: "Power-line status: separate power evidence is present; qualified utility and field review remain required.",
  };
}

function isGeneratedFieldPivotZoneFeature(feature: ProjectMapFeature): boolean {
  return feature.kind === "machine_zone"
    && feature.properties?.source === "generated_field_pivot_plan";
}

function featureSequence(feature: ProjectMapFeature): number | null {
  const sequence = feature.properties?.generatedFieldPivotSequence;
  return typeof sequence === "number" && Number.isFinite(sequence) ? sequence : null;
}

function formatAdvisoryDesignReportText(report: Omit<AdvisoryDesignReport, "text">): string {
  return [
    report.title,
    `Readiness: ${readable(report.readiness)}`,
    `Advisory only: ${report.advisoryOnly}`,
    `Canonical geometry mutation: ${report.canonicalGeometryMutation}`,
    `Qualified review required: ${report.qualifiedReviewRequired}`,
    `Headline: ${report.headline}`,
    "",
    ...report.sections.flatMap((section) => [
      section.title,
      ...section.lines.map((line) => `- ${line}`),
      "",
    ]),
  ].join("\n").trimEnd() + "\n";
}

function formatSourceRef(sourceRef: AdvisorySourceReference): string {
  const sourceId = sourceRef.sourceId || sourceRef.guideId || sourceRef.title || "source";
  const page = sourceRef.page === undefined ? "" : ` page ${sourceRef.page}`;
  const lines = sourceRef.lineRange ? ` lines ${sourceRef.lineRange}` : "";
  return `${sourceId}${page}${lines}: ${sourceRef.limit}`;
}

function dedupeSourceRefs(sourceRefs: AdvisorySourceReference[]): AdvisorySourceReference[] {
  const seen = new Set<string>();
  const deduped: AdvisorySourceReference[] = [];
  for (const sourceRef of sourceRefs) {
    const key = [
      sourceRef.sourceId,
      sourceRef.guideId,
      sourceRef.title,
      sourceRef.page,
      sourceRef.lineRange,
      sourceRef.limit,
    ].filter((part) => part !== undefined && part !== null).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(sourceRef);
  }
  return deduped;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function formatPoint(point: { x: number; y: number }): string {
  return `(${formatNumber(point.x)}, ${formatNumber(point.y)})`;
}

function distance(left: XY, right: XY): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function formatMeters(value: number): string {
  return `${formatNumber(value)} m`;
}

function formatAcres(value: number): string {
  return `${formatNumber(value)} ac`;
}

function formatPercent(value: number): string {
  return `${formatNumber(value)}%`;
}

function formatStrategyCostLabel(strategy: { costAssessment: { status: string; currencyCode: string; costPerIrrigatedAcre: number | null } | null }): string {
  const assessment = strategy.costAssessment;
  if (!assessment) return "cost pending";
  if (assessment.status === "complete" && assessment.costPerIrrigatedAcre !== null) {
    return `${assessment.currencyCode} ${formatNumber(assessment.costPerIrrigatedAcre)}/ac`;
  }
  return readable(assessment.status);
}

function formatSweepEfficiencyCostDelta(row: { cost: { status: string; currencyCode: string }; estimatedCostDeltaFromCurrent: number | null; costPerAcreDeltaFromCurrent: number | null }): string {
  if (row.cost.status !== "complete" || row.estimatedCostDeltaFromCurrent === null || row.costPerAcreDeltaFromCurrent === null) {
    return readable(row.cost.status);
  }
  const totalDelta = row.estimatedCostDeltaFromCurrent >= 0
    ? `+${row.cost.currencyCode} ${formatNumber(row.estimatedCostDeltaFromCurrent)}`
    : `-${row.cost.currencyCode} ${formatNumber(Math.abs(row.estimatedCostDeltaFromCurrent))}`;
  const acreDelta = row.costPerAcreDeltaFromCurrent >= 0
    ? `+${row.cost.currencyCode} ${formatNumber(row.costPerAcreDeltaFromCurrent)}/ac`
    : `-${row.cost.currencyCode} ${formatNumber(Math.abs(row.costPerAcreDeltaFromCurrent))}/ac`;
  return `${totalDelta}, ${acreDelta}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(Math.abs(value) >= 100 ? 1 : 2);
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}
