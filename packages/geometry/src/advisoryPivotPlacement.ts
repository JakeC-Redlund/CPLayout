import { assertMetricCalculationCrs } from "@cplayout/core";
import * as polygonClipping from "polygon-clipping";

import type {
  AdvisoryCornerArmConfig,
  AdvisorySourceReference,
  LayoutMetrics,
  LayoutResult,
  MultiPolygonXY,
  ObstacleZone,
  PivotMachine,
  PivotProject,
  ProjectMapFeature,
  SurveyPoint,
  XY,
} from "@cplayout/core";
import { squareMetersToAcres } from "@cplayout/core";

import {
  DEFAULT_BOUNDARY_EPSILON_SQUARE_METERS,
  boundsForGeometry,
  createAnnularSector,
  createCirclePolygon,
  createSectorPolygon,
  evaluateCornerArmPath,
  evaluateLayout,
  machineRadiusMeters,
  multiPolygonAreaSquareMeters,
  polygonAreaSquareMeters,
} from "./geometry";
import { optimizePivotCenterSteps, type PivotCenterAlternative, type PivotCenterSeedKind } from "./pivotCenterOptimizer";
import { completeCalculation, type Calculation } from "./calculation";

type ClipPosition = [number, number];
type ClipPolygon = ClipPosition[][];
type ClipMultiPolygon = ClipPolygon[];
type LayoutAtCenter = (pivotCenter: XY) => LayoutResult;
type LayoutCoordinateKey = number | "-0";
type TowerReview = {
  nearestTowerIndex: number | null;
  nearestTowerTrackDistanceMeters: number | null;
  spanIndex: number | null;
  towerClearanceBufferMeters: number;
};

export interface PivotPlacementCandidateOptions {
  gridDivisions?: number;
  maxCandidates?: number;
  boundaryEpsilonSquareMeters?: number;
  obstacleBufferMeters?: number;
  waterSourceWeight?: number;
  powerSourceWeight?: number;
  accessWeight?: number;
  includeMaximumInscribedCircleSeed?: boolean;
  maximumInteriorSeedRefinement?: "grid" | "local";
  includeMachineZoneReviews?: boolean;
  minimumBoundaryClearanceMeters?: number;
  minimumObstacleClearanceMeters?: number;
  obstacleCrossingProfiles?: AdvisoryObstacleCrossingProfile[];
  costInput?: AdvisoryCostInput;
  sourceRefs?: AdvisorySourceReference[];
}

export interface PivotPlacementScoreBreakdown {
  coverage: number;
  boundaryFit: number;
  obstacleClearance: number;
  waterSourceProximity: number;
  powerSourceProximity: number;
  accessProximity: number;
  dryCornerPenalty: number;
  costEfficiency: number;
  feasibility: number;
}

export interface AdvisoryCostInput {
  fixedMachineCost?: number;
  costPerMeter?: number;
  costPerTower?: number;
  currencyCode?: string;
  notes?: string;
  sourceRefs?: AdvisorySourceReference[];
}

export interface AdvisoryCostAssessment {
  status: "complete" | "missing_cost_input" | "invalid_cost_input" | "no_irrigated_acres";
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  estimatedCost: number | null;
  costPerIrrigatedAcre: number | null;
  currencyCode: string;
  sourceRefs: AdvisorySourceReference[];
  warnings: string[];
}

export interface AdvisoryObstacleCrossingProfile {
  obstacleId: string;
  evidenceId?: string;
  crossingAllowed: boolean;
  minimumClearanceMeters?: number;
  reason: string;
  sourceRefs?: AdvisorySourceReference[];
  advisoryOnly: true;
}

export type AdvisoryObstacleCrossingProfileStatus =
  | "allowed_profile"
  | "allowed_profile_clearance_met"
  | "allowed_profile_clearance_shortfall"
  | "allowed_profile_clearance_unverified"
  | "blocked_profile"
  | "hard_blocking_profile_not_applied";

export interface AdvisoryObstacleCrossingProfileReview {
  profileId: string;
  crossingAllowed: boolean;
  status: AdvisoryObstacleCrossingProfileStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  minimumClearanceMeters: number | null;
  observedTowerTrackClearanceMeters: number | null;
  clearanceSatisfied: boolean | null;
  reason: string;
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export interface PivotPlacementCandidate {
  id: string;
  pivotCenter: XY;
  metrics: LayoutMetrics;
  score: number;
  scoreBreakdown: PivotPlacementScoreBreakdown;
  feasible: boolean;
  insideFieldBoundary: boolean;
  boundaryClearanceMeters: number;
  sourceSeed: PivotCenterSeedKind | "maximum_inscribed_circle";
  dryCornerPolygons: MultiPolygonXY;
  dryCornerAcres: number;
  obstacleBufferMeters: number;
  minimumObstacleClearanceMeters: number | null;
  distanceFromCurrentMeters: number;
  distanceToWaterSourceMeters: number;
  distanceToPowerSourceMeters: number;
  distanceToAccessMeters: number | null;
  minimumRequiredBoundaryClearanceMeters: number;
  minimumRequiredObstacleClearanceMeters: number;
  obstacleCrossingProfileIds: string[];
  costAssessment: AdvisoryCostAssessment;
  warnings: string[];
  disqualificationReasons: string[];
  sourceRefs: AdvisorySourceReference[];
  canonicalGeometryMutation: false;
}

export type IdealCenterPointAnalysisStatus = "ready" | "no_boundary" | "no_candidates" | "no_feasible_candidate";

export interface IdealCenterPointAnalysis {
  status: IdealCenterPointAnalysisStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  projectCrs: string;
  fieldBoundaryVertexCount: number;
  bestCandidate: PivotPlacementCandidate | null;
  candidates: PivotPlacementCandidate[];
  machineZoneReviews: AdvisoryMachineZoneReview[];
  blockers: string[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export interface AdvisoryMachineZoneReview {
  featureId: string;
  featureName: string;
  featureKind: "planning_boundary" | "machine_zone";
  status: "ready" | "unsupported_geometry" | "no_feasible_candidate";
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  boundaryVertexCount: number;
  bestCandidate: PivotPlacementCandidate | null;
  candidateCount: number;
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export type AdvisoryMultiMachineReviewStatus =
  | "missing_zones"
  | "single_zone_review"
  | "ready"
  | "no_feasible_scenarios";

export interface AdvisoryMultiMachineReviewOptions extends PivotPlacementCandidateOptions {
  collisionBufferMeters?: number;
  minimumMachineSeparationMeters?: number;
}

export interface AdvisoryMachineScenario {
  id: string;
  zoneFeatureId: string;
  zoneName: string;
  zoneKind: "planning_boundary" | "machine_zone";
  status: "ready" | "unsupported_geometry" | "no_feasible_candidate";
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  boundaryVertexCount: number;
  zoneAcres: number;
  machineRadiusMeters: number;
  bestCandidate: PivotPlacementCandidate | null;
  candidateCount: number;
  modeledIrrigatedAcres: number;
  modeledCoverage: MultiPolygonXY;
  machineEnvelope: MultiPolygonXY;
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export interface AdvisoryMachineEnvelopeConflict {
  id: string;
  leftScenarioId: string;
  rightScenarioId: string;
  leftZoneName: string;
  rightZoneName: string;
  status: "machine_envelope_overlap" | "separation_buffer_warning";
  severity: "critical_overlap" | "buffer_intrusion";
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  operatorCollisionReviewRequired: true;
  centerDistanceMeters: number;
  leftMachineRadiusMeters: number;
  rightMachineRadiusMeters: number;
  collisionBufferMeters: number;
  minimumRequiredSeparationMeters: number;
  separationDeficitMeters: number;
  separationReviewBufferMeters: number;
  collisionZone: MultiPolygonXY;
  collisionZoneAcres: number;
  separationReviewZone: MultiPolygonXY;
  separationReviewZoneAcres: number;
  envelopeOverlapAcres: number;
  warnings: string[];
}

export interface AdvisoryBoundaryCompilation {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  fieldBoundaryAcres: number;
  fullScopeBoundarySource: "field_boundary" | "planning_boundary";
  scenarioBoundarySource: "none" | "planning_boundary" | "machine_zone";
  compiledBoundary: MultiPolygonXY;
  compiledBoundaryPolygonCount: number;
  planningBoundaryCount: number;
  machineZoneCount: number;
  scenarioCount: number;
  readyScenarioCount: number;
  unsupportedScenarioCount: number;
  compiledBoundaryAcres: number;
  fullScopeCoveragePercent: number;
  fullScopeUnirrigatedAcres: number;
  outsideFullScopeAcres: number;
  scenarioBoundaryUnionAcres: number;
  scenarioZoneAcres: number;
  modeledIrrigatedAcresSum: number;
  modeledIrrigatedUnionAcres: number;
  duplicateModeledCoverageAcres: number;
}

export interface AdvisoryMultiMachineReview {
  status: AdvisoryMultiMachineReviewStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  projectCrs: string;
  scenarios: AdvisoryMachineScenario[];
  conflicts: AdvisoryMachineEnvelopeConflict[];
  compilation: AdvisoryBoundaryCompilation;
  verifiedPowerExclusionConflictCount: number;
  blockers: string[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export type AdvisoryFieldPivotPlanStatus =
  | "no_boundary"
  | "no_feasible_candidates"
  | "single_candidate"
  | "ready";

export interface AdvisoryFieldPivotPlanOptions extends PivotPlacementCandidateOptions {
  maxMachines?: number;
  candidatePoolSize?: number;
  collisionBufferMeters?: number;
  minimumMachineSeparationMeters?: number;
}

export interface AdvisoryFieldPivotPlanCandidate {
  id: string;
  sequence: number;
  placementCandidate: PivotPlacementCandidate;
  pivotCenter: XY;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  machineRadiusMeters: number;
  minimumRequiredSeparationMeters: number;
  nearestSelectedDistanceMeters: number | null;
  modeledIrrigatedAcres: number;
  incrementalIrrigatedAcres: number;
  cumulativeFieldCoveragePercent: number;
  modeledCoverage: MultiPolygonXY;
  machineEnvelope: MultiPolygonXY;
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export interface AdvisoryFieldPivotSeparationRejection {
  candidateId: string;
  pivotCenter: XY;
  nearestSelectedCandidateId: string;
  centerDistanceMeters: number;
  minimumRequiredSeparationMeters: number;
  separationDeficitMeters: number;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  warnings: string[];
}

export interface AdvisoryFieldPivotPlan {
  status: AdvisoryFieldPivotPlanStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  projectCrs: string;
  requestedMachineCount: number;
  selectedMachineCount: number;
  candidatePoolCount: number;
  feasibleCandidateCount: number;
  rejectedForSeparationCount: number;
  machineRadiusMeters: number;
  collisionBufferMeters: number;
  minimumRequiredSeparationMeters: number;
  fieldBoundaryAcres: number;
  fieldCoveragePercent: number;
  fieldUnirrigatedAcres: number;
  modeledIrrigatedAcresSum: number;
  modeledIrrigatedUnionAcres: number;
  duplicateModeledCoverageAcres: number;
  modeledCoverageUnion: MultiPolygonXY;
  candidates: AdvisoryFieldPivotPlanCandidate[];
  separationRejections: AdvisoryFieldPivotSeparationRejection[];
  blockers: string[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export type AdvisoryGeneratedMultiPivotScenarioReviewStatus =
  | "no_boundary"
  | "no_selected_centers"
  | "single_center_review"
  | "ready";

export interface AdvisoryGeneratedMultiPivotScenarioRow {
  sequence: number;
  candidateId: string;
  pivotCenter: XY;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  machineRadiusMeters: number;
  modeledIrrigatedAcres: number;
  incrementalIrrigatedAcres: number;
  cumulativeFieldCoveragePercent: number;
  boundaryClearanceMeters: number;
  nearestSelectedDistanceMeters: number | null;
  minimumRequiredSeparationMeters: number;
  separationMarginMeters: number | null;
  placementScore: number;
  costStatus: AdvisoryCostAssessment["status"];
  costPerIrrigatedAcre: number | null;
  warnings: string[];
}

export interface AdvisoryGeneratedMultiPivotRejectedRow {
  candidateId: string;
  pivotCenter: XY;
  nearestSelectedCandidateId: string;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  centerDistanceMeters: number;
  minimumRequiredSeparationMeters: number;
  separationDeficitMeters: number;
  warnings: string[];
}

export interface AdvisoryGeneratedMultiPivotScenarioReview {
  status: AdvisoryGeneratedMultiPivotScenarioReviewStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  projectCrs: string;
  requestedMachineCount: number;
  selectedCenterCount: number;
  candidatePoolCount: number;
  feasibleCandidateCount: number;
  rejectedForSeparationCount: number;
  fieldCoveragePercent: number;
  fieldUnirrigatedAcres: number;
  modeledIrrigatedUnionAcres: number;
  duplicateModeledCoverageAcres: number;
  minimumRequiredSeparationMeters: number;
  tightestSelectedSeparationMarginMeters: number | null;
  largestSeparationDeficitMeters: number | null;
  costInputStatus: AdvisoryCostAssessment["status"];
  rows: AdvisoryGeneratedMultiPivotScenarioRow[];
  rejectedRows: AdvisoryGeneratedMultiPivotRejectedRow[];
  blockers: string[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export type AdvisoryMachineStrategyKind =
  | "current_machine"
  | "full_circle_same_radius"
  | "full_circle_radius"
  | "linear_lateral_move"
  | "bender_second_pivot"
  | "unsupported_linear_lateral"
  | "unsupported_bender_second_pivot";

export type AdvisoryMachineStrategyStatus =
  | "ready"
  | "no_feasible_candidate"
  | "unsupported_model";

export type AdvisoryMachineStrategyComparisonStatus =
  | "ready"
  | "no_boundary"
  | "no_feasible_strategy";

export interface AdvisoryMachineStrategyInput {
  id: string;
  label: string;
  strategyKind: AdvisoryMachineStrategyKind;
  machine?: PivotMachine;
  pathFeatureId?: string;
  secondPivotPointId?: string;
  notes?: string;
  sourceRefs?: AdvisorySourceReference[];
}

export interface AdvisoryMachineStrategyComparisonOptions extends PivotPlacementCandidateOptions {
  strategies?: AdvisoryMachineStrategyInput[];
  generatedFullCircleRadiiMeters?: number[];
  includeGeneratedRadiusStrategies?: boolean;
  includeUnsupportedConceptPlaceholders?: boolean;
}

export interface AdvisoryMachineStrategyResult {
  id: string;
  label: string;
  strategyKind: AdvisoryMachineStrategyKind;
  status: AdvisoryMachineStrategyStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  machineRadiusMeters: number;
  spanCount: number;
  sweepMode: PivotMachine["sweep"]["mode"] | "unsupported";
  bestCandidate: PivotPlacementCandidate | null;
  pathFeatureId?: string;
  secondPivotPointId?: string;
  secondPivotPoint?: XY;
  benderPrimaryDistanceMeters?: number;
  benderTailRadiusMeters?: number;
  candidateCount: number;
  irrigatedAcres: number;
  outsideFieldAcres: number;
  coveragePercent: number;
  costAssessment: AdvisoryCostAssessment | null;
  costEfficiencyAcresPerHundredThousand: number | null;
  advisoryScore: number;
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export interface AdvisoryMachineStrategyComparison {
  status: AdvisoryMachineStrategyComparisonStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  projectCrs: string;
  strategies: AdvisoryMachineStrategyResult[];
  bestStrategy: AdvisoryMachineStrategyResult | null;
  costInputStatus: AdvisoryCostAssessment["status"];
  blockers: string[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export type AdvisoryRadiusSensitivityReviewSource =
  | "generated_radius_sensitivity"
  | "imported_radius_sensitivity";

export interface AdvisoryRadiusSensitivityReviewOptions extends PivotPlacementCandidateOptions {
  radiiMeters?: number[];
  maxMachines?: number;
  source?: AdvisoryRadiusSensitivityReviewSource;
  buildMachineForRadius?: (project: PivotProject, radiusMeters: number) => PivotMachine;
}

export interface AdvisoryRadiusSensitivityRow {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  requestedRadiusMeters: number;
  radiusMeters: number;
  spanCount: number;
  label: string;
  irrigatedAcres: number;
  coveragePercent: number;
  outsideFieldAcres: number;
  fieldPivotStatus: AdvisoryFieldPivotPlanStatus;
  selectedMachineCount: number;
  readyScenarioCount: number;
  scenarioCount: number;
  fullScopeCoveragePercent: number;
  fullScopeUnirrigatedAcres: number;
  strategyStatus: AdvisoryMachineStrategyComparisonStatus;
  readyStrategyCount: number;
  cost: AdvisoryCostAssessment;
  warnings: string[];
}

export interface AdvisoryRadiusSensitivityReview {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  source: AdvisoryRadiusSensitivityReviewSource;
  importedRadiusMeters: number;
  rowCount: number;
  readyRowCount: number;
  bestByCostPerAcre: AdvisoryRadiusSensitivityRow | null;
  bestByFullScopeCoverage: AdvisoryRadiusSensitivityRow | null;
  rows: AdvisoryRadiusSensitivityRow[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export type AdvisoryEndGunSensitivityReviewSource =
  | "generated_end_gun_sensitivity"
  | "imported_end_gun_sensitivity";

export interface AdvisoryEndGunSensitivityReviewOptions {
  throwDistancesMeters?: number[];
  source?: AdvisoryEndGunSensitivityReviewSource;
  sourceRefs?: AdvisorySourceReference[];
}

export interface AdvisoryEndGunSensitivityRow {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  requestedThrowMeters: number;
  throwMeters: number;
  baseMachineRadiusMeters: number;
  wetRadiusMeters: number;
  label: string;
  endGunAngleRangeCount: number;
  irrigatedAcres: number;
  baselineIrrigatedAcres: number;
  incrementalIrrigatedAcres: number;
  coveragePercent: number;
  incrementalCoveragePercent: number;
  endGunAcres: number;
  outsideFieldAcres: number;
  obstacleConflictCount: number;
  noSprayConflictCount: number;
  hardMechanicalConflictCount: number;
  warnings: string[];
}

export interface AdvisoryEndGunSensitivityReview {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  source: AdvisoryEndGunSensitivityReviewSource;
  importedThrowMeters: number;
  rowCount: number;
  readyRowCount: number;
  bestByIncrementalAcres: AdvisoryEndGunSensitivityRow | null;
  bestByLowOutsideFieldAcres: AdvisoryEndGunSensitivityRow | null;
  rows: AdvisoryEndGunSensitivityRow[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export type AdvisorySweepEfficiencyReviewStatus =
  | "ready"
  | "current_full_circle"
  | "no_machine_radius"
  | "no_boundary";

export type AdvisorySweepEfficiencyRowKind =
  | "current_sweep"
  | "full_circle_same_radius"
  | "generated_shorter_full_circle";

export interface AdvisorySweepEfficiencyReviewOptions {
  comparisonRadiiMeters?: number[];
  costInput?: AdvisoryCostInput;
  source?: "generated_sweep_efficiency" | "imported_sweep_efficiency";
  sourceRefs?: AdvisorySourceReference[];
}

export interface AdvisorySweepEfficiencyRow {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  kind: AdvisorySweepEfficiencyRowKind;
  label: string;
  sweepMode: PivotMachine["sweep"]["mode"];
  radiusMeters: number;
  spanCount: number;
  irrigatedAcres: number;
  irrigatedAcresDeltaFromCurrent: number;
  coveragePercent: number;
  outsideFieldAcres: number;
  obstacleConflictCount: number;
  hardMechanicalConflictCount: number;
  estimatedCostDeltaFromCurrent: number | null;
  costPerAcreDeltaFromCurrent: number | null;
  comparableToCurrentAcres: boolean;
  cost: AdvisoryCostAssessment;
  warnings: string[];
}

export interface AdvisorySweepEfficiencyReview {
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  source: "generated_sweep_efficiency" | "imported_sweep_efficiency";
  status: AdvisorySweepEfficiencyReviewStatus;
  importedSweepMode: PivotMachine["sweep"]["mode"];
  currentMachineRadiusMeters: number;
  rowCount: number;
  readyRowCount: number;
  sameRadiusFullCircleRow: AdvisorySweepEfficiencyRow | null;
  bestShorterComparableFullCircleRow: AdvisorySweepEfficiencyRow | null;
  bestCostPerAcreRow: AdvisorySweepEfficiencyRow | null;
  rows: AdvisorySweepEfficiencyRow[];
  blockers: string[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export interface AdvisoryCornerArmEvaluationOptions {
  sourceRefs?: AdvisorySourceReference[];
}

export interface AdvisoryCornerArmEvaluation {
  status: "ready" | "missing_config" | "invalid_config";
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  unverifiedKinematics: true;
  qualifiedReviewRequired: true;
  sourceRefs: AdvisorySourceReference[];
  warnings: string[];
  config?: AdvisoryCornerArmConfig;
  pathEnvelope: MultiPolygonXY;
  coverageCandidate: MultiPolygonXY;
  dryCornerPolygons: MultiPolygonXY;
  evidenceFeatureIds: string[];
  estimatedAddedCoverageAcres: number;
  baseAllowedCoverageAcres: number;
}

export type AdvisoryObstacleInteractionStatus = "ready" | "no_evidence";

export type AdvisoryObstacleInteractionCategory =
  | "hard_blocking"
  | "no_spray_exclusion"
  | "span_clearance_review"
  | "tower_track_review"
  | "utility_path_review"
  | "outside_machine_reach";

export interface AdvisoryObstacleInteractionOptions {
  sourceRefs?: AdvisorySourceReference[];
  obstacleCrossingProfiles?: AdvisoryObstacleCrossingProfile[];
}

export interface AdvisoryObstacleInteractionItem {
  id: string;
  name: string;
  evidenceType: "obstacle_polygon" | "utility_point" | "utility_path";
  obstacleKind?: ObstacleZone["kind"];
  featureKind?: ProjectMapFeature["kind"];
  category: AdvisoryObstacleInteractionCategory;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  inMachineReach: boolean;
  crossingReviewRequired: boolean;
  distanceToPivotMeters: number | null;
  nearestTowerIndex: number | null;
  nearestTowerTrackDistanceMeters: number | null;
  spanIndex: number | null;
  crossingProfileReview: AdvisoryObstacleCrossingProfileReview | null;
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export interface AdvisoryObstacleInteractionSummary {
  hardBlockingCount: number;
  noSprayExclusionCount: number;
  spanClearanceReviewCount: number;
  towerTrackReviewCount: number;
  utilityPathReviewCount: number;
  outsideMachineReachCount: number;
  profiledItemCount: number;
  profileAllowedCount: number;
  profileBlockedCount: number;
  profileClearanceShortfallCount: number;
}

export interface AdvisoryObstacleInteractionReview {
  status: AdvisoryObstacleInteractionStatus;
  advisoryOnly: true;
  canonicalGeometryMutation: false;
  qualifiedReviewRequired: true;
  projectCrs: string;
  machineRadiusMeters: number;
  itemCount: number;
  items: AdvisoryObstacleInteractionItem[];
  summary: AdvisoryObstacleInteractionSummary;
  blockers: string[];
  warnings: string[];
  sourceRefs: AdvisorySourceReference[];
}

export const DEFAULT_ADVISORY_PLACEMENT_SOURCE_REFS: AdvisorySourceReference[] = [
  {
    sourceId: "SRC-NRCS-NEH-623-CH11",
    title: "USDA NRCS NEH Part 623 Chapter 11 Sprinkler Irrigation",
    url: "https://www.wcc.nrcs.usda.gov/ftpref/wntsc/waterMgt/irrigation/NEH15/ch11.pdf",
    checkedAt: "2026-06-05",
    limit: "Sprinkler irrigation terminology and review criteria only; not CPLayout design certification.",
  },
  {
    sourceId: "SRC-POSTGIS-MAXIMUM-INSCRIBED-CIRCLE",
    title: "PostGIS ST_MaximumInscribedCircle",
    url: "https://postgis.net/docs/ST_MaximumInscribedCircle.html",
    checkedAt: "2026-06-05",
    limit: "Algorithm inspiration for seed placement only; does not prove field accuracy.",
  },
];

export const DEFAULT_CORNER_ARM_SOURCE_REFS: AdvisorySourceReference[] = [
  {
    sourceId: "SRC-VALLEY-VFLEX-CORNER",
    title: "Valley VFlex Corner",
    url: "https://www.valleyirrigation.com/vflex-corner",
    checkedAt: "2026-06-05",
    limit: "Manufacturer public feature/specification reference only; CPLayout does not certify compatibility or kinematics.",
  },
  {
    sourceId: "SRC-VALLEY-PRECISION-CORNER",
    title: "Valley Precision Corner",
    url: "https://valleyirrigation.com/precision-corner",
    checkedAt: "2026-06-05",
    limit: "Manufacturer public feature/specification reference only; CPLayout does not certify compatibility or kinematics.",
  },
  {
    sourceId: "SRC-NDSU-AE91",
    title: "NDSU Selecting a Sprinkler Irrigation System",
    url: "https://www.ndsu.edu/agriculture/extension/publications/selecting-sprinkler-irrigation-system",
    checkedAt: "2026-06-05",
    limit: "Extension guidance for planning context only; qualified review remains required.",
  },
];

export const DEFAULT_BENDER_SECOND_PIVOT_SOURCE_REFS: AdvisorySourceReference[] = [
  {
    sourceId: "SRC-LOCAL-VFLEX-CORNER-GUIDANCE-SEQUENCING",
    guideId: "local-vflex-corner-0998325",
    page: 8,
    lineRange: "131-190",
    checkedAt: "2026-06-05",
    limit: "Local design-guide summary identifies swing tower, sequencing, GPS guidance, and terrain-compensation context; CPLayout uses it only for advisory second-pivot review notes.",
  },
  {
    sourceId: "SRC-LOCAL-PIVOT-DESIGN-PRESSURE-LOSS",
    guideId: "local-pivot-design-0998236",
    page: 74,
    lineRange: "4118-4170",
    checkedAt: "2026-06-05",
    limit: "Local design-guide summary supports pressure and length review warnings only; it is not hydraulic or mechanical certification.",
  },
];

export const DEFAULT_END_GUN_SENSITIVITY_SOURCE_REFS: AdvisorySourceReference[] = [
  {
    sourceId: "SRC-NRCS-NEH-623-CH11",
    title: "USDA NRCS NEH Part 623 Chapter 11 Sprinkler Irrigation",
    url: "https://www.wcc.nrcs.usda.gov/ftpref/wntsc/waterMgt/irrigation/NEH15/ch11.pdf",
    checkedAt: "2026-06-05",
    limit: "Sprinkler irrigation terminology and review criteria only; not CPLayout design certification.",
  },
  {
    sourceId: "SRC-LOCAL-PIVOT-DESIGN-PRESSURE-LOSS",
    guideId: "local-pivot-design-0998236",
    page: 74,
    lineRange: "4118-4170",
    checkedAt: "2026-06-05",
    limit: "Local design-guide summary supports pressure and length review warnings only; it is not hydraulic or mechanical certification.",
  },
];

export const DEFAULT_SWEEP_EFFICIENCY_SOURCE_REFS: AdvisorySourceReference[] = [
  {
    sourceId: "SRC-NRCS-NEH-623-CH11",
    title: "USDA NRCS NEH Part 623 Chapter 11 Sprinkler Irrigation",
    url: "https://www.wcc.nrcs.usda.gov/ftpref/wntsc/waterMgt/irrigation/NEH15/ch11.pdf",
    checkedAt: "2026-06-05",
    limit: "Sprinkler irrigation planning terminology and review criteria only; not CPLayout design certification.",
  },
  {
    sourceId: "SRC-WSU-CENTER-PIVOT-AREA-CALCULATOR",
    title: "WSU Center Pivot Area Calculator",
    url: "https://irrigation.wsu.edu/Secondary_Pages/Irr_Calculators/CenterPivot/CP_PivotAcreage.php",
    checkedAt: "2026-06-05",
    limit: "Simple center-pivot acreage context only; CPLayout still clips to supplied projected-XY field and obstacle evidence.",
  },
];

export const DEFAULT_OBSTACLE_INTERACTION_SOURCE_REFS: AdvisorySourceReference[] = [
  {
    sourceId: "SRC-NRCS-NEH-623-CH11",
    title: "USDA NRCS NEH Part 623 Chapter 11 Sprinkler Irrigation",
    url: "https://www.wcc.nrcs.usda.gov/ftpref/wntsc/waterMgt/irrigation/NEH15/ch11.pdf",
    checkedAt: "2026-06-05",
    limit: "Sprinkler irrigation terminology and obstacle review context only; not CPLayout design certification.",
  },
  {
    sourceId: "SRC-LOCAL-PIVOT-DESIGN-SLOPE-LIMIT-REVIEW",
    guideId: "local-pivot-design-0998236",
    page: 60,
    lineRange: "3003-3031",
    checkedAt: "2026-06-05",
    limit: "Local design-guide summary supports slope, ridge, profile, pipe, tire, and clearance review warnings only.",
  },
];

export function buildPivotPlacementCandidates(
  project: PivotProject,
  options: PivotPlacementCandidateOptions = {},
): PivotPlacementCandidate[] {
  return completeCalculation(buildPivotPlacementCandidatesSteps(project, options));
}

export function* buildPivotPlacementCandidatesSteps(
  project: PivotProject,
  options: PivotPlacementCandidateOptions = {},
): Calculation<PivotPlacementCandidate[]> {
  return yield* buildPivotPlacementCandidatesWithLayoutSteps(project, options);
}

function* buildPivotPlacementCandidatesWithLayoutSteps(
  project: PivotProject,
  options: PivotPlacementCandidateOptions,
  evaluateAtCenter?: LayoutAtCenter,
): Calculation<PivotPlacementCandidate[]> {
  assertMetricCalculationCrs(project.projectCrs);
  const gridDivisions = Math.max(3, Math.floor(options.gridDivisions ?? 9));
  const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? 5));
  const sourceRefs = options.sourceRefs ?? DEFAULT_ADVISORY_PLACEMENT_SOURCE_REFS;
  const optimizerAlternatives = yield* optimizePivotCenterSteps(project, {
    gridDivisions,
    maxAlternatives: Math.max(maxCandidates + 2, 6),
    boundaryEpsilonSquareMeters: options.boundaryEpsilonSquareMeters ?? DEFAULT_BOUNDARY_EPSILON_SQUARE_METERS,
    includeVisualCenterSeed: true,
  });

  const candidates: PivotPlacementCandidate[] = [];
  for (const alternative of optimizerAlternatives) {
    candidates.push(candidateFromAlternative(project, alternative, options, sourceRefs, evaluateAtCenter));
    yield;
  }
  if (options.includeMaximumInscribedCircleSeed !== false) {
    const micSeed = maximumInscribedCircleSeed(project.fieldBoundary, gridDivisions, options.maximumInteriorSeedRefinement ?? "local");
    candidates.push(candidateFromProject(project, micSeed.center, "maximum_inscribed_circle", options, sourceRefs, undefined, evaluateAtCenter));
  }

  return dedupePlacementCandidates(candidates)
    .sort(comparePlacementCandidates)
    .slice(0, maxCandidates);
}

export function analyzeIdealPivotCenter(
  project: PivotProject,
  options: PivotPlacementCandidateOptions = {},
): IdealCenterPointAnalysis {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = options.sourceRefs ?? DEFAULT_ADVISORY_PLACEMENT_SOURCE_REFS;
  const base = {
    advisoryOnly: true as const,
    canonicalGeometryMutation: false as const,
    qualifiedReviewRequired: true as const,
    projectCrs: project.projectCrs,
    fieldBoundaryVertexCount: project.fieldBoundary.length,
    sourceRefs,
  };

  if (project.fieldBoundary.length < 3) {
    return {
      ...base,
      status: "no_boundary",
      bestCandidate: null,
      candidates: [],
      machineZoneReviews: [],
      blockers: ["At least three projected-XY field boundary vertices are required before ideal center-point analysis."],
      warnings: ["Automatic center-point analysis did not run because the field boundary is incomplete."],
    };
  }

  const candidates = buildPivotPlacementCandidates(project, options);
  const machineZoneReviews = options.includeMachineZoneReviews === false
    ? []
    : buildMachineZoneReviews(project, options, sourceRefs);
  const bestCandidate = candidates.find((candidate) => candidate.feasible && candidate.insideFieldBoundary) ?? null;
  const status: IdealCenterPointAnalysisStatus = bestCandidate
    ? "ready"
    : candidates.length === 0
      ? "no_candidates"
      : "no_feasible_candidate";
  const blockers = status === "ready"
    ? []
    : status === "no_candidates"
      ? ["No projected-XY center candidates were generated inside the field boundary."]
      : ["No generated center candidate satisfied field-boundary, wet-coverage, and obstacle constraints."];
  const warnings = [
    "Ideal center-point analysis is advisory and does not mutate canonical projected XY until the operator applies a candidate.",
    "Qualified review is required before treating the selected pivot center as an engineering design.",
    ...blockers,
  ];

  return {
    ...base,
    status,
    bestCandidate,
    candidates,
    machineZoneReviews,
    blockers,
    warnings,
  };
}

export function analyzeAdvisoryMultiMachineLayout(
  project: PivotProject,
  options: AdvisoryMultiMachineReviewOptions = {},
): AdvisoryMultiMachineReview {
  return completeCalculation(analyzeAdvisoryMultiMachineLayoutSteps(project, options));
}

export function* analyzeAdvisoryMultiMachineLayoutSteps(
  project: PivotProject,
  options: AdvisoryMultiMachineReviewOptions = {},
): Calculation<AdvisoryMultiMachineReview> {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = options.sourceRefs ?? DEFAULT_ADVISORY_PLACEMENT_SOURCE_REFS;
  const planningBoundaries = planningBoundaryFeatures(project);
  const machineZones = machineZoneFeatures(project);
  const scenarioFeatures = machineZones.length > 0 ? machineZones : planningBoundaries;
  const scenarios: AdvisoryMachineScenario[] = [];
  for (const feature of scenarioFeatures) {
    scenarios.push(buildAdvisoryMachineScenario(project, feature, options, sourceRefs));
    yield;
  }
  const readyScenarios = scenarios.filter((scenario) => scenario.status === "ready" && scenario.bestCandidate);
  const conflicts = buildMachineEnvelopeConflicts(project, readyScenarios, options);
  const compilation = buildBoundaryCompilation(project, planningBoundaries, machineZones, scenarios);
  const verifiedPowerExclusionConflictCount = countVerifiedPowerExclusionConflicts(project, readyScenarios, options);
  const fullScopeBlockers = [
    ...(compilation.outsideFullScopeAcres > 0.001
      ? [`Modeled machine coverage extends ${compilation.outsideFullScopeAcres.toFixed(2)} acres outside the full-scope field boundary.`]
      : []),
    ...(verifiedPowerExclusionConflictCount > 0
      ? [`${verifiedPowerExclusionConflictCount} ready machine scenario${verifiedPowerExclusionConflictCount === 1 ? "" : "s"} intersect verified power-line or power-pole exclusion evidence.`]
      : []),
  ];
  const blockers = scenarioFeatures.length === 0
    ? ["Add at least one advisory machine zone or planning boundary before multi-machine layout review."]
    : readyScenarios.length === 0
      ? ["No advisory machine scenario has a feasible center candidate."]
      : fullScopeBlockers;
  const status: AdvisoryMultiMachineReviewStatus = scenarioFeatures.length === 0
    ? "missing_zones"
    : readyScenarios.length === 0
      ? "no_feasible_scenarios"
      : fullScopeBlockers.length > 0
        ? "no_feasible_scenarios"
      : readyScenarios.length === 1
        ? "single_zone_review"
        : "ready";

  return {
    status,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    projectCrs: project.projectCrs,
    scenarios,
    conflicts,
    compilation,
    verifiedPowerExclusionConflictCount,
    blockers,
    warnings: [
      "Multi-machine layout review is advisory and does not create pivots, zones, or canonical projected-XY geometry.",
      "Machine-zone and planning-boundary features are positive planning context; internal machine-zone edges are not collision barriers or containment limits.",
      "Each scenario reuses the current machine template; span package, corner-arm, flow, pressure, and vendor constraints require qualified review.",
      "Envelope conflicts are conservative geometry warnings and do not model timing, tower phasing, alignment controls, or bender-machine kinematics.",
      ...(compilation.duplicateModeledCoverageAcres > 0.001 ? ["Modeled irrigated acreage overlaps between scenarios; summed acres are not de-duplicated."] : []),
      ...blockers,
    ],
    sourceRefs,
  };
}

function layoutCoordinateKey(coordinate: number): LayoutCoordinateKey {
  // Numeric Map keys merge signed zeros, which clipping can retain in its output.
  return Object.is(coordinate, -0) ? "-0" : coordinate;
}

export function planAdvisoryFieldPivots(
  project: PivotProject,
  options: AdvisoryFieldPivotPlanOptions = {},
): AdvisoryFieldPivotPlan {
  return completeCalculation(planAdvisoryFieldPivotsSteps(project, options));
}

export function* planAdvisoryFieldPivotsSteps(
  project: PivotProject,
  options: AdvisoryFieldPivotPlanOptions = {},
): Calculation<AdvisoryFieldPivotPlan> {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = options.sourceRefs ?? DEFAULT_ADVISORY_PLACEMENT_SOURCE_REFS;
  const requestedMachineCount = Math.max(1, Math.floor(options.maxMachines ?? 3));
  const machineRadius = machineRadiusMeters(project.machine);
  const collisionBufferMeters = Math.max(0, options.collisionBufferMeters ?? project.machine.machineClearanceBufferMeters ?? 0);
  const minimumRequiredSeparationMeters = Math.max(
    Math.max(0, options.minimumMachineSeparationMeters ?? 0),
    machineRadius * 2 + collisionBufferMeters,
  );
  const base = {
    advisoryOnly: true as const,
    canonicalGeometryMutation: false as const,
    qualifiedReviewRequired: true as const,
    projectCrs: project.projectCrs,
    requestedMachineCount,
    machineRadiusMeters: round(machineRadius),
    collisionBufferMeters: round(collisionBufferMeters),
    minimumRequiredSeparationMeters: round(minimumRequiredSeparationMeters),
    sourceRefs,
  };

  if (project.fieldBoundary.length < 3) {
    return {
      ...base,
      status: "no_boundary",
      selectedMachineCount: 0,
      candidatePoolCount: 0,
      feasibleCandidateCount: 0,
      rejectedForSeparationCount: 0,
      fieldBoundaryAcres: 0,
      fieldCoveragePercent: 0,
      fieldUnirrigatedAcres: 0,
      modeledIrrigatedAcresSum: 0,
      modeledIrrigatedUnionAcres: 0,
      duplicateModeledCoverageAcres: 0,
      modeledCoverageUnion: [],
      candidates: [],
      separationRejections: [],
      blockers: ["At least three projected-XY field boundary vertices are required before advisory field-pivot planning."],
      warnings: ["Advisory field-pivot planning did not run because the field boundary is incomplete."],
    };
  }

  // This request fixes the project; rounded candidate IDs cannot identify exact XY.
  const layoutsByCenter = new Map<LayoutCoordinateKey, Map<LayoutCoordinateKey, LayoutResult>>();
  const evaluateAtCenter: LayoutAtCenter = (pivotCenter) => {
    const xKey = layoutCoordinateKey(pivotCenter.x);
    const yKey = layoutCoordinateKey(pivotCenter.y);
    let layoutsByY = layoutsByCenter.get(xKey);
    const cached = layoutsByY?.get(yKey);
    if (cached) return cached;
    const result = evaluateLayout({ ...project, pivotCenter });
    if (!layoutsByY) {
      layoutsByY = new Map<LayoutCoordinateKey, LayoutResult>();
      layoutsByCenter.set(xKey, layoutsByY);
    }
    layoutsByY.set(yKey, result);
    return result;
  };
  const candidatePool = yield* buildFieldPivotPlanCandidatePool(project, options, sourceRefs, requestedMachineCount, evaluateAtCenter);
  const feasibleCandidates = candidatePool.filter((candidate) => candidate.feasible && candidate.insideFieldBoundary);
  const { selected, separationRejections } = yield* selectAdvisoryFieldPivotCandidates(
    project,
    feasibleCandidates,
    requestedMachineCount,
    minimumRequiredSeparationMeters,
    evaluateAtCenter,
  );

  const fieldBoundaryAcres = squareMetersToAcres(polygonAreaSquareMeters(project.fieldBoundary));
  let runningCoverage: MultiPolygonXY = [];
  let modeledIrrigatedAcresSum = 0;
  const planCandidates: AdvisoryFieldPivotPlanCandidate[] = [];
  for (const [index, candidate] of selected.entries()) {
    const result = evaluateAtCenter(candidate.pivotCenter);
    const priorCoverageAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(
      intersectMultiPolygons(runningCoverage, [[project.fieldBoundary]]),
    ));
    runningCoverage = unionMultiPolygons([...runningCoverage, ...result.allowedCoverage]);
    const cumulativeCoverageAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(
      intersectMultiPolygons(runningCoverage, [[project.fieldBoundary]]),
    ));
    modeledIrrigatedAcresSum += result.metrics.irrigatedAcres;
    const nearest = nearestSelectedPlacementCandidate(candidate, selected.slice(0, index));
    planCandidates.push({
      id: `field-pivot-${index + 1}-${candidate.id}`,
      sequence: index + 1,
      placementCandidate: candidate,
      pivotCenter: candidate.pivotCenter,
      advisoryOnly: true,
      canonicalGeometryMutation: false,
      qualifiedReviewRequired: true,
      machineRadiusMeters: round(machineRadius),
      minimumRequiredSeparationMeters: round(minimumRequiredSeparationMeters),
      nearestSelectedDistanceMeters: nearest ? round(nearest.centerDistanceMeters) : null,
      modeledIrrigatedAcres: round(result.metrics.irrigatedAcres),
      incrementalIrrigatedAcres: round(Math.max(0, cumulativeCoverageAcres - priorCoverageAcres)),
      cumulativeFieldCoveragePercent: round(fieldBoundaryAcres > 0 ? (cumulativeCoverageAcres / fieldBoundaryAcres) * 100 : 0),
      modeledCoverage: result.allowedCoverage,
      machineEnvelope: machineEnvelopeFor(project, candidate.pivotCenter),
      warnings: [
        "Advisory field-pivot candidate does not create a saved pivot or machine zone.",
        "Separation screening uses projected-XY envelope distance only and does not model timing, tower phasing, controls, or field operations.",
        ...candidate.warnings,
      ],
      sourceRefs,
    });
    yield;
  }

  const modeledCoverageUnion = intersectMultiPolygons(runningCoverage, [[project.fieldBoundary]]);
  const modeledIrrigatedUnionAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(modeledCoverageUnion));
  const fieldCoveragePercent = fieldBoundaryAcres > 0 ? (modeledIrrigatedUnionAcres / fieldBoundaryAcres) * 100 : 0;
  const selectedMachineCount = planCandidates.length;
  const blockers = selectedMachineCount === 0
    ? ["No feasible projected-XY center candidate satisfied boundary, obstacle, and separation constraints."]
    : selectedMachineCount < requestedMachineCount
      ? [`Only ${selectedMachineCount} separated feasible center${selectedMachineCount === 1 ? "" : "s"} were found for ${requestedMachineCount} requested machines.`]
      : [];
  const status: AdvisoryFieldPivotPlanStatus = selectedMachineCount === 0
    ? "no_feasible_candidates"
    : selectedMachineCount === 1
      ? "single_candidate"
      : "ready";

  return {
    ...base,
    status,
    selectedMachineCount,
    candidatePoolCount: candidatePool.length,
    feasibleCandidateCount: feasibleCandidates.length,
    rejectedForSeparationCount: separationRejections.length,
    fieldBoundaryAcres: round(fieldBoundaryAcres),
    fieldCoveragePercent: round(fieldCoveragePercent),
    fieldUnirrigatedAcres: round(Math.max(0, fieldBoundaryAcres - modeledIrrigatedUnionAcres)),
    modeledIrrigatedAcresSum: round(modeledIrrigatedAcresSum),
    modeledIrrigatedUnionAcres: round(modeledIrrigatedUnionAcres),
    duplicateModeledCoverageAcres: round(Math.max(0, modeledIrrigatedAcresSum - modeledIrrigatedUnionAcres)),
    modeledCoverageUnion,
    candidates: planCandidates,
    separationRejections,
    blockers,
    warnings: [
      "Advisory field-pivot planning is a deterministic projected-XY screening aid and does not create pivots, zones, machine settings, or project storage records.",
      "Candidate separation is conservative envelope spacing only; it is not runtime or certified multi-pivot collision prevention.",
      "Span package, corner-arm behavior, bender mechanics, flow, pressure, terrain, controls, and vendor constraints require qualified review.",
      ...blockers,
    ],
    sourceRefs,
  };
}

export function buildAdvisoryGeneratedMultiPivotScenarioReview(
  fieldPivotPlan: AdvisoryFieldPivotPlan,
): AdvisoryGeneratedMultiPivotScenarioReview {
  const rows = fieldPivotPlan.candidates.map((candidate): AdvisoryGeneratedMultiPivotScenarioRow => {
    const separationMarginMeters = candidate.nearestSelectedDistanceMeters === null
      ? null
      : round(candidate.nearestSelectedDistanceMeters - candidate.minimumRequiredSeparationMeters);
    return {
      sequence: candidate.sequence,
      candidateId: candidate.id,
      pivotCenter: candidate.pivotCenter,
      advisoryOnly: true,
      canonicalGeometryMutation: false,
      qualifiedReviewRequired: true,
      machineRadiusMeters: candidate.machineRadiusMeters,
      modeledIrrigatedAcres: candidate.modeledIrrigatedAcres,
      incrementalIrrigatedAcres: candidate.incrementalIrrigatedAcres,
      cumulativeFieldCoveragePercent: candidate.cumulativeFieldCoveragePercent,
      boundaryClearanceMeters: round(candidate.placementCandidate.boundaryClearanceMeters),
      nearestSelectedDistanceMeters: candidate.nearestSelectedDistanceMeters,
      minimumRequiredSeparationMeters: candidate.minimumRequiredSeparationMeters,
      separationMarginMeters,
      placementScore: candidate.placementCandidate.score,
      costStatus: candidate.placementCandidate.costAssessment.status,
      costPerIrrigatedAcre: candidate.placementCandidate.costAssessment.costPerIrrigatedAcre,
      warnings: [
        "Generated multi-pivot scenario row is advisory and does not create saved pivots or runtime collision controls.",
        ...(separationMarginMeters !== null && separationMarginMeters < 0
          ? ["Selected center is inside the conservative separation margin and requires operator review."]
          : []),
        ...candidate.warnings,
      ],
    };
  });
  const rejectedRows = fieldPivotPlan.separationRejections.map((rejection): AdvisoryGeneratedMultiPivotRejectedRow => ({
    candidateId: rejection.candidateId,
    pivotCenter: rejection.pivotCenter,
    nearestSelectedCandidateId: rejection.nearestSelectedCandidateId,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    centerDistanceMeters: rejection.centerDistanceMeters,
    minimumRequiredSeparationMeters: rejection.minimumRequiredSeparationMeters,
    separationDeficitMeters: rejection.separationDeficitMeters,
    warnings: [
      "Rejected row records advisory separation screening only; it is not certified collision prevention.",
      ...rejection.warnings,
    ],
  }));
  const selectedMargins = rows
    .map((row) => row.separationMarginMeters)
    .filter((value): value is number => value !== null);
  const tightestSelectedSeparationMarginMeters = selectedMargins.length > 0 ? round(Math.min(...selectedMargins)) : null;
  const largestSeparationDeficitMeters = rejectedRows.length > 0
    ? round(Math.max(...rejectedRows.map((row) => row.separationDeficitMeters)))
    : null;
  const completeRows = rows.filter((row) => row.costStatus === "complete");
  const invalidRows = rows.filter((row) => row.costStatus === "invalid_cost_input");
  const noAcreRows = rows.filter((row) => row.costStatus === "no_irrigated_acres");
  const costInputStatus: AdvisoryCostAssessment["status"] = rows.length === 0
    ? "missing_cost_input"
    : invalidRows.length > 0
      ? "invalid_cost_input"
      : noAcreRows.length === rows.length
        ? "no_irrigated_acres"
        : completeRows.length === rows.length
          ? "complete"
          : "missing_cost_input";
  const status: AdvisoryGeneratedMultiPivotScenarioReviewStatus = fieldPivotPlan.status === "no_boundary"
    ? "no_boundary"
    : rows.length === 0
      ? "no_selected_centers"
      : rows.length === 1
        ? "single_center_review"
        : "ready";
  const blockers = [
    ...fieldPivotPlan.blockers,
    ...(rows.length === 0 && fieldPivotPlan.status !== "no_boundary" ? ["No generated separated center rows are available for multi-pivot scenario review."] : []),
  ];

  return {
    status,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    projectCrs: fieldPivotPlan.projectCrs,
    requestedMachineCount: fieldPivotPlan.requestedMachineCount,
    selectedCenterCount: fieldPivotPlan.selectedMachineCount,
    candidatePoolCount: fieldPivotPlan.candidatePoolCount,
    feasibleCandidateCount: fieldPivotPlan.feasibleCandidateCount,
    rejectedForSeparationCount: fieldPivotPlan.rejectedForSeparationCount,
    fieldCoveragePercent: fieldPivotPlan.fieldCoveragePercent,
    fieldUnirrigatedAcres: fieldPivotPlan.fieldUnirrigatedAcres,
    modeledIrrigatedUnionAcres: fieldPivotPlan.modeledIrrigatedUnionAcres,
    duplicateModeledCoverageAcres: fieldPivotPlan.duplicateModeledCoverageAcres,
    minimumRequiredSeparationMeters: fieldPivotPlan.minimumRequiredSeparationMeters,
    tightestSelectedSeparationMarginMeters,
    largestSeparationDeficitMeters,
    costInputStatus,
    rows,
    rejectedRows,
    blockers,
    warnings: [
      "Generated multi-pivot scenario review is advisory and does not create saved pivots, machine zones, runtime collision controls, or project storage records.",
      "Separation margins are projected-XY screening evidence only; timing, tower phasing, controls, terrain, span package, hydraulics, and vendor constraints require qualified review.",
      "Cost status comes from explicit local assumptions on placement candidates only and is not a quote or purchase recommendation.",
      ...(fieldPivotPlan.duplicateModeledCoverageAcres > 0.001 ? ["Modeled selected-center coverage overlaps; union acres are the de-duplicated review value."] : []),
      ...(rejectedRows.length > 0 ? ["Some feasible candidates were rejected by conservative separation screening and should be reviewed before changing machine count or radius assumptions."] : []),
      ...blockers,
    ],
    sourceRefs: fieldPivotPlan.sourceRefs,
  };
}

export function compareAdvisoryMachineStrategies(
  project: PivotProject,
  options: AdvisoryMachineStrategyComparisonOptions = {},
): AdvisoryMachineStrategyComparison {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = options.sourceRefs ?? DEFAULT_ADVISORY_PLACEMENT_SOURCE_REFS;
  const base = {
    advisoryOnly: true as const,
    canonicalGeometryMutation: false as const,
    qualifiedReviewRequired: true as const,
    projectCrs: project.projectCrs,
    sourceRefs,
  };

  if (project.fieldBoundary.length < 3) {
    return {
      ...base,
      status: "no_boundary",
      strategies: [],
      bestStrategy: null,
      costInputStatus: costInputStatusForInput(options.costInput),
      blockers: ["At least three projected-XY field boundary vertices are required before advisory machine strategy comparison."],
      warnings: ["Machine strategy comparison did not run because the field boundary is incomplete."],
    };
  }

  const strategyInputs = buildMachineStrategyInputs(project, options, sourceRefs);
  const strategies = strategyInputs
    .map((strategy) => evaluateMachineStrategy(project, strategy, options, sourceRefs))
    .sort(compareMachineStrategyResults);
  const bestStrategy = strategies.find((strategy) => strategy.status === "ready") ?? null;
  const costInputStatus = firstCostStatus(strategies, options.costInput);
  const blockers = bestStrategy
    ? []
    : ["No advisory machine strategy produced a feasible center candidate."];

  return {
    ...base,
    status: bestStrategy ? "ready" : "no_feasible_strategy",
    strategies,
    bestStrategy,
    costInputStatus,
    blockers,
    warnings: [
      "Machine strategy comparison is advisory and does not mutate canonical projected XY, machine settings, zones, or project storage.",
      "Generated full-circle strategies are approximate planning templates derived from the current span package; operator/vendor confirmation is required.",
      ...(costInputStatus === "missing_cost_input" ? ["Cost ranking is incomplete because no explicit local cost input was supplied."] : []),
      ...(costInputStatus === "invalid_cost_input" ? ["Cost ranking is blocked because the supplied local cost input is invalid."] : []),
      ...blockers,
    ],
    sourceRefs,
  };
}

export function buildAdvisoryRadiusSensitivityReview(
  project: PivotProject,
  options: AdvisoryRadiusSensitivityReviewOptions = {},
): AdvisoryRadiusSensitivityReview {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = options.sourceRefs ?? DEFAULT_ADVISORY_PLACEMENT_SOURCE_REFS;
  const importedRadiusMeters = Math.max(0, machineRadiusMeters(project.machine));
  const radii = normalizeRadiusSensitivityRadii(options.radiiMeters ?? defaultRadiusSensitivityRadii(importedRadiusMeters));
  const buildMachineForRadius = options.buildMachineForRadius
    ?? ((sourceProject: PivotProject, radiusMeters: number) => approximateFullCircleMachine(sourceProject.machine, radiusMeters));
  const maxMachines = Math.max(1, Math.floor(options.maxMachines ?? 3));
  const rows = radii.map((radiusMeters): AdvisoryRadiusSensitivityRow => {
    const variantMachine = buildMachineForRadius(project, radiusMeters);
    const variantProject: PivotProject = {
      ...project,
      machine: variantMachine,
    };
    const reviewOptions = {
      ...options,
      maxMachines,
      sourceRefs,
      includeMachineZoneReviews: true,
    };
    const layout = evaluateLayout(variantProject);
    const fieldPlan = planAdvisoryFieldPivots(variantProject, reviewOptions);
    const multiMachine = analyzeAdvisoryMultiMachineLayout(variantProject, reviewOptions);
    const strategies = compareAdvisoryMachineStrategies(variantProject, {
      ...reviewOptions,
      includeGeneratedRadiusStrategies: false,
      includeUnsupportedConceptPlaceholders: false,
    });
    const readyStrategyCount = strategies.strategies.filter((strategy) => strategy.status === "ready").length;
    const cost = assessAdvisoryCost(variantProject, layout.metrics.irrigatedAcres, options.costInput, sourceRefs);
    const resolvedRadiusMeters = machineRadiusMeters(variantMachine);
    const currentRadius = Math.abs(resolvedRadiusMeters - importedRadiusMeters) < 0.001;
    return {
      advisoryOnly: true,
      canonicalGeometryMutation: false,
      qualifiedReviewRequired: true,
      requestedRadiusMeters: round(radiusMeters),
      radiusMeters: round(resolvedRadiusMeters),
      spanCount: variantMachine.spanLengthsMeters.length,
      label: currentRadius ? "Imported/current radius" : `Full circle ${resolvedRadiusMeters.toFixed(0)} m radius`,
      irrigatedAcres: round(layout.metrics.irrigatedAcres),
      coveragePercent: round(layout.metrics.coveragePercent),
      outsideFieldAcres: round(layout.metrics.outsideFieldAcres),
      fieldPivotStatus: fieldPlan.status,
      selectedMachineCount: fieldPlan.selectedMachineCount,
      readyScenarioCount: multiMachine.compilation.readyScenarioCount,
      scenarioCount: multiMachine.compilation.scenarioCount,
      fullScopeCoveragePercent: round(multiMachine.compilation.fullScopeCoveragePercent),
      fullScopeUnirrigatedAcres: round(multiMachine.compilation.fullScopeUnirrigatedAcres),
      strategyStatus: strategies.status,
      readyStrategyCount,
      cost,
      warnings: [
        ...(multiMachine.compilation.readyScenarioCount === 0 ? ["No machine-zone scenario was ready for this radius under the current conservative screening."] : []),
        ...(fieldPlan.selectedMachineCount === 0 ? ["Generated field-pivot screening selected no separated advisory centers for this radius."] : []),
        ...(cost.status !== "complete" ? [`Cost-per-acre status is ${cost.status}.`] : []),
      ],
    };
  });
  const completeCostRows = rows.filter((row) => row.cost.status === "complete" && row.cost.costPerIrrigatedAcre !== null);
  const coverageRows = rows.filter((row) => row.coveragePercent > 0 || row.fullScopeCoveragePercent > 0);
  const bestByCostPerAcre = completeCostRows.length > 0
    ? [...completeCostRows].sort((left, right) => (left.cost.costPerIrrigatedAcre ?? Infinity) - (right.cost.costPerIrrigatedAcre ?? Infinity))[0]
    : null;
  const bestByFullScopeCoverage = coverageRows.length > 0
    ? [...coverageRows].sort((left, right) => (
      right.fullScopeCoveragePercent - left.fullScopeCoveragePercent
      || right.coveragePercent - left.coveragePercent
      || left.radiusMeters - right.radiusMeters
    ))[0]
    : null;

  return {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    source: options.source ?? "generated_radius_sensitivity",
    importedRadiusMeters: round(importedRadiusMeters),
    rowCount: rows.length,
    readyRowCount: rows.filter((row) => row.readyScenarioCount > 0 || row.readyStrategyCount > 0 || row.irrigatedAcres > 0).length,
    bestByCostPerAcre,
    bestByFullScopeCoverage,
    rows,
    warnings: [
      "Radius sensitivity is a local advisory comparison over machine-length assumptions only; it does not change project geometry, machine settings, storage, archives, or KML/KMZ.",
      "Rows use projected-XY field, pivot, machine-zone, and cost evidence as ephemeral analysis inputs; qualified design review is required before relying on any radius.",
      ...(bestByCostPerAcre ? [] : ["No radius row had complete cost-per-acre evidence."]),
      ...(rows.length === 0 ? ["No positive radius rows were available for sensitivity review."] : []),
    ],
    sourceRefs,
  };
}

export function buildAdvisoryEndGunSensitivityReview(
  project: PivotProject,
  options: AdvisoryEndGunSensitivityReviewOptions = {},
): AdvisoryEndGunSensitivityReview {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = options.sourceRefs ?? DEFAULT_END_GUN_SENSITIVITY_SOURCE_REFS;
  const importedThrowMeters = Math.max(0, project.machine.endGunThrowMeters);
  const baseMachineRadiusMeters = machineRadiusMeters(project.machine);
  const throwDistances = normalizeEndGunThrowSensitivityDistances(
    options.throwDistancesMeters ?? defaultEndGunThrowSensitivityDistances(importedThrowMeters),
  );
  const baselineProject: PivotProject = {
    ...project,
    machine: {
      ...project.machine,
      endGunThrowMeters: 0,
    },
  };
  const baselineLayout = evaluateLayout(baselineProject);
  const baselineIrrigatedAcres = baselineLayout.metrics.irrigatedAcres;
  const baselineCoveragePercent = baselineLayout.metrics.coveragePercent;
  const baselineOutsideFieldAcres = baselineLayout.metrics.outsideFieldAcres;
  const baselineObstacleConflictCount = baselineLayout.metrics.obstacleConflictCount;
  const baselineNoSprayConflictCount = baselineLayout.metrics.noSprayConflictCount;
  const baselineHardMechanicalConflictCount = baselineLayout.metrics.hardMechanicalConflictCount;
  const endGunAngleRangeCount = project.machine.endGunAngleRanges?.length ?? 0;
  const rows = throwDistances.map((throwMeters): AdvisoryEndGunSensitivityRow => {
    const variantProject: PivotProject = {
      ...project,
      machine: {
        ...project.machine,
        endGunThrowMeters: throwMeters,
      },
    };
    const layout = evaluateLayout(variantProject);
    const currentThrow = Math.abs(throwMeters - importedThrowMeters) < 0.001;
    const wetRadiusMeters = baseMachineRadiusMeters + throwMeters;
    const incrementalIrrigatedAcres = layout.metrics.irrigatedAcres - baselineIrrigatedAcres;
    const incrementalCoveragePercent = layout.metrics.coveragePercent - baselineCoveragePercent;
    return {
      advisoryOnly: true,
      canonicalGeometryMutation: false,
      qualifiedReviewRequired: true,
      requestedThrowMeters: round(throwMeters),
      throwMeters: round(throwMeters),
      baseMachineRadiusMeters: round(baseMachineRadiusMeters),
      wetRadiusMeters: round(wetRadiusMeters),
      label: throwMeters <= 0 ? "No end gun baseline" : currentThrow ? "Imported/current throw" : `${throwMeters.toFixed(0)} m end-gun throw`,
      endGunAngleRangeCount,
      irrigatedAcres: round(layout.metrics.irrigatedAcres),
      baselineIrrigatedAcres: round(baselineIrrigatedAcres),
      incrementalIrrigatedAcres: round(incrementalIrrigatedAcres),
      coveragePercent: round(layout.metrics.coveragePercent),
      incrementalCoveragePercent: round(incrementalCoveragePercent),
      endGunAcres: round(layout.metrics.endGunAcres),
      outsideFieldAcres: round(layout.metrics.outsideFieldAcres),
      obstacleConflictCount: layout.metrics.obstacleConflictCount,
      noSprayConflictCount: layout.metrics.noSprayConflictCount,
      hardMechanicalConflictCount: layout.metrics.hardMechanicalConflictCount,
      warnings: [
        ...(throwMeters <= 0 ? ["Zero-throw row is a modeled baseline with end-gun throw disabled."] : []),
        ...(endGunAngleRangeCount > 0 ? [`Current end-gun shutoff angle ranges are reused for this row (${endGunAngleRangeCount}).`] : ["No end-gun shutoff angle ranges are modeled for this row."]),
        ...(layout.metrics.outsideFieldAcres > baselineOutsideFieldAcres + 0.000001 ? ["This throw increases modeled outside-field wet acres relative to the zero-throw baseline."] : []),
        ...(layout.metrics.obstacleConflictCount > baselineObstacleConflictCount ? ["This throw increases modeled obstacle intersections relative to the zero-throw baseline."] : []),
        ...(layout.metrics.noSprayConflictCount > baselineNoSprayConflictCount ? ["This throw reaches at least one additional no-spray obstacle relative to the zero-throw baseline."] : []),
        ...(layout.metrics.hardMechanicalConflictCount > baselineHardMechanicalConflictCount ? ["This throw increases modeled hard mechanical conflicts relative to the zero-throw baseline."] : []),
      ],
    };
  });
  const addedAcreRows = rows.filter((row) => row.incrementalIrrigatedAcres > 0);
  const bestByIncrementalAcres = addedAcreRows.length > 0
    ? [...addedAcreRows].sort((left, right) => (
      right.incrementalIrrigatedAcres - left.incrementalIrrigatedAcres
      || left.outsideFieldAcres - right.outsideFieldAcres
      || left.hardMechanicalConflictCount - right.hardMechanicalConflictCount
      || left.throwMeters - right.throwMeters
    ))[0]
    : null;
  const bestByLowOutsideFieldAcres = rows.length > 0
    ? [...rows].sort((left, right) => (
      left.outsideFieldAcres - right.outsideFieldAcres
      || left.hardMechanicalConflictCount - right.hardMechanicalConflictCount
      || right.incrementalIrrigatedAcres - left.incrementalIrrigatedAcres
      || left.throwMeters - right.throwMeters
    ))[0]
    : null;

  return {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    source: options.source ?? "generated_end_gun_sensitivity",
    importedThrowMeters: round(importedThrowMeters),
    rowCount: rows.length,
    readyRowCount: rows.filter((row) => row.irrigatedAcres > 0).length,
    bestByIncrementalAcres,
    bestByLowOutsideFieldAcres,
    rows,
    warnings: [
      "End-gun sensitivity is a local advisory comparison over throw-distance assumptions only; it does not change project geometry, machine settings, storage, archives, or KML/KMZ.",
      "Rows reuse the current projected-XY field, pivot, obstacle, sweep, and shutoff-range evidence as ephemeral analysis inputs; qualified design review is required before relying on any throw distance.",
      "Pressure, wind, nozzle package, hydraulic limits, trajectory, application uniformity, controls, and vendor shutoff constraints are not modeled or certified by this review.",
      ...(bestByIncrementalAcres ? [] : ["No end-gun row added modeled irrigated acres relative to the zero-throw baseline."]),
      ...(rows.length === 0 ? ["No nonnegative end-gun throw rows were available for sensitivity review."] : []),
    ],
    sourceRefs,
  };
}

export function buildAdvisorySweepEfficiencyReview(
  project: PivotProject,
  options: AdvisorySweepEfficiencyReviewOptions = {},
): AdvisorySweepEfficiencyReview {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = options.sourceRefs ?? DEFAULT_SWEEP_EFFICIENCY_SOURCE_REFS;
  const currentMachineRadiusMeters = machineRadiusMeters(project.machine);
  const blockers = [
    ...(project.fieldBoundary.length < 3 ? ["Add a field boundary before sweep-efficiency review."] : []),
    ...(currentMachineRadiusMeters <= 0 ? ["Add positive span or overhang length before sweep-efficiency review."] : []),
  ];
  const source = options.source ?? "generated_sweep_efficiency";
  if (blockers.length > 0) {
    return {
      advisoryOnly: true,
      canonicalGeometryMutation: false,
      qualifiedReviewRequired: true,
      source,
      status: project.fieldBoundary.length < 3 ? "no_boundary" : "no_machine_radius",
      importedSweepMode: project.machine.sweep.mode,
      currentMachineRadiusMeters: round(Math.max(0, currentMachineRadiusMeters)),
      rowCount: 0,
      readyRowCount: 0,
      sameRadiusFullCircleRow: null,
      bestShorterComparableFullCircleRow: null,
      bestCostPerAcreRow: null,
      rows: [],
      blockers,
      warnings: [
        "Sweep-efficiency review is advisory and does not mutate canonical projected XY, machine settings, storage, archives, or exports.",
        ...blockers,
      ],
      sourceRefs,
    };
  }

  const currentLayout = evaluateLayout(project);
  const currentCost = assessAdvisoryCost(project, currentLayout.metrics.irrigatedAcres, options.costInput, sourceRefs);
  const currentRow = sweepEfficiencyRowFromProject({
    kind: "current_sweep",
    label: project.machine.sweep.mode === "partial_circle" ? "Current part-circle sweep" : "Current full-circle sweep",
    project,
    layout: currentLayout,
    currentLayout,
    currentCost,
    costInput: options.costInput,
    sourceRefs,
    warnings: [
      "Current sweep row models the active projected-XY pivot, field, obstacles, machine radius, and sweep settings without saving changes.",
    ],
  });
  const rows: AdvisorySweepEfficiencyRow[] = [currentRow];

  if (project.machine.sweep.mode === "partial_circle") {
    const sameRadiusFullCircleProject: PivotProject = {
      ...project,
      machine: {
        ...project.machine,
        id: `${project.machine.id}-sweep-efficiency-full-circle`,
        name: `${project.machine.name} full-circle sweep-efficiency template`,
        sweep: { mode: "full_circle" },
        endGunAngleRanges: undefined,
      },
    };
    rows.push(sweepEfficiencyRowFromProject({
      kind: "full_circle_same_radius",
      label: "Same radius full circle",
      project: sameRadiusFullCircleProject,
      layout: evaluateLayout(sameRadiusFullCircleProject),
      currentLayout,
      currentCost,
      costInput: options.costInput,
      sourceRefs,
      warnings: [
        "Same-radius full-circle row compares sweep coverage at the current machine length only; it is not a vendor conversion recommendation.",
      ],
    }));

    const comparisonRadii = normalizeRadiusSensitivityRadii(
      options.comparisonRadiiMeters ?? defaultSweepEfficiencyComparisonRadii(currentMachineRadiusMeters),
    ).filter((radiusMeters) => radiusMeters < currentMachineRadiusMeters - 0.001);
    for (const radiusMeters of comparisonRadii) {
      const machine = approximateFullCircleMachine(project.machine, radiusMeters);
      const comparisonProject: PivotProject = {
        ...project,
        machine: {
          ...machine,
          id: `${project.machine.id}-sweep-efficiency-${radiusMeters.toFixed(2)}`,
          name: `${project.machine.name} ${radiusMeters.toFixed(0)} m full-circle sweep-efficiency template`,
          sweep: { mode: "full_circle" },
          endGunAngleRanges: undefined,
        },
      };
      rows.push(sweepEfficiencyRowFromProject({
        kind: "generated_shorter_full_circle",
        label: `Shorter full circle ${radiusMeters.toFixed(0)} m`,
        project: comparisonProject,
        layout: evaluateLayout(comparisonProject),
        currentLayout,
        currentCost,
        costInput: options.costInput,
        sourceRefs,
        warnings: [
          "Shorter full-circle row is a generated planning template from the current span package; applying it requires explicit operator edits and qualified review.",
        ],
      }));
    }
  }

  const sameRadiusFullCircleRow = rows.find((row) => row.kind === "full_circle_same_radius") ?? null;
  const shorterComparableRows = rows.filter((row) => row.kind === "generated_shorter_full_circle" && row.comparableToCurrentAcres);
  const completeCostRows = rows.filter((row) => row.cost.status === "complete" && row.cost.costPerIrrigatedAcre !== null);
  const bestShorterComparableFullCircleRow = shorterComparableRows.length > 0
    ? [...shorterComparableRows].sort((left, right) => (
      (left.cost.costPerIrrigatedAcre ?? Infinity) - (right.cost.costPerIrrigatedAcre ?? Infinity)
      || Math.abs(left.irrigatedAcresDeltaFromCurrent) - Math.abs(right.irrigatedAcresDeltaFromCurrent)
      || left.radiusMeters - right.radiusMeters
    ))[0]
    : null;
  const bestCostPerAcreRow = completeCostRows.length > 0
    ? [...completeCostRows].sort((left, right) => (
      (left.cost.costPerIrrigatedAcre ?? Infinity) - (right.cost.costPerIrrigatedAcre ?? Infinity)
      || right.irrigatedAcres - left.irrigatedAcres
      || left.radiusMeters - right.radiusMeters
    ))[0]
    : null;
  const status: AdvisorySweepEfficiencyReviewStatus = project.machine.sweep.mode === "partial_circle"
    ? "ready"
    : "current_full_circle";

  return {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    source,
    status,
    importedSweepMode: project.machine.sweep.mode,
    currentMachineRadiusMeters: round(currentMachineRadiusMeters),
    rowCount: rows.length,
    readyRowCount: rows.filter((row) => row.irrigatedAcres > 0).length,
    sameRadiusFullCircleRow,
    bestShorterComparableFullCircleRow,
    bestCostPerAcreRow,
    rows,
    blockers: [],
    warnings: [
      "Sweep-efficiency review is a local advisory comparison over sweep and generated full-circle radius assumptions only; it does not change project geometry, machine settings, storage, archives, or KML/KMZ.",
      "Rows use the current projected-XY pivot, field, obstacle, and local cost evidence as ephemeral analysis inputs; qualified design and vendor review is required before relying on any machine choice.",
      "Cost rows use operator-supplied assumptions only and are not vendor quotes, financing guidance, purchase recommendations, hydraulic design, or construction estimates.",
      ...(project.machine.sweep.mode === "partial_circle" ? [
        "Part-circle rows can show same-machine cost spread across fewer modeled acres; shorter full-circle rows are planning prompts only.",
      ] : [
        "Current machine is already full circle, so part-circle sweep-efficiency comparison is informational only.",
      ]),
      ...(bestShorterComparableFullCircleRow ? [] : ["No shorter generated full-circle row reached at least 95% of current modeled irrigated acres."]),
      ...(bestCostPerAcreRow ? [] : ["No sweep-efficiency row had complete cost-per-acre evidence."]),
    ],
    sourceRefs,
  };
}

export function analyzeAdvisoryObstacleInteractions(
  project: PivotProject,
  options: AdvisoryObstacleInteractionOptions = {},
): AdvisoryObstacleInteractionReview {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = options.sourceRefs ?? DEFAULT_OBSTACLE_INTERACTION_SOURCE_REFS;
  const profiles = options.obstacleCrossingProfiles ?? [];
  const obstacleItems = project.obstacles.map((obstacle) => obstacleInteractionFromObstacle(project, obstacle, sourceRefs, profiles));
  const utilityItems = (project.mapFeatures ?? [])
    .filter(isObstacleInteractionMapFeature)
    .map((feature) => obstacleInteractionFromMapFeature(project, feature, sourceRefs, profiles));
  const items = [...obstacleItems, ...utilityItems].sort(compareObstacleInteractionItems);
  const summary = summarizeObstacleInteractions(items);
  const blockers = items.length === 0
    ? ["Add obstacle polygons, wells, utility points, or utility paths before obstacle interaction review."]
    : [];

  return {
    status: items.length > 0 ? "ready" : "no_evidence",
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    projectCrs: project.projectCrs,
    machineRadiusMeters: round(machineRadiusMeters(project.machine)),
    itemCount: items.length,
    items,
    summary,
    blockers,
    warnings: [
      "Obstacle interaction review is advisory and does not mutate canonical projected XY, obstacle settings, utility features, machine settings, or project storage.",
      "Span-clearance and utility-path categories are planning prompts only; qualified field and vendor review is required before treating any object as crossable.",
      "Crossing profiles are operator/source-backed review labels only; they do not change obstacle hardConflict/noSpray settings, layout metrics, or project geometry.",
      "Hard-blocking and no-spray categories still rely on the project obstacle hardConflict/noSpray settings for modeled layout metrics.",
      ...blockers,
    ],
    sourceRefs,
  };
}

export function evaluateAdvisoryCornerArm(
  project: PivotProject,
  config: AdvisoryCornerArmConfig | undefined = project.machine.cornerArm,
  options: AdvisoryCornerArmEvaluationOptions = {},
): AdvisoryCornerArmEvaluation {
  assertMetricCalculationCrs(project.projectCrs);
  const sourceRefs = config?.sourceRefs ?? options.sourceRefs ?? DEFAULT_CORNER_ARM_SOURCE_REFS;
  const baseResult = evaluateLayout(project);
  const dryCornerPolygons = dryCornerPolygonsFor(project, baseResult.allowedCoverage);
  const baseAllowedCoverageAcres = baseResult.metrics.irrigatedAcres;
  const base: Omit<AdvisoryCornerArmEvaluation, "status"> = {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    unverifiedKinematics: true,
    qualifiedReviewRequired: true,
    sourceRefs,
    warnings: [
      "Corner-arm output is advisory and separate from base/end-gun layout metrics.",
      "Manufacturer-specific corner-arm kinematics remain unverified; qualified review is required.",
    ],
    config,
    pathEnvelope: [],
    coverageCandidate: [],
    dryCornerPolygons,
    evidenceFeatureIds: [],
    estimatedAddedCoverageAcres: 0,
    baseAllowedCoverageAcres,
  };

  if (!config) {
    return {
      ...base,
      status: "missing_config",
      warnings: [...base.warnings, "No operator-confirmed corner-arm advisory config is saved on this machine."],
    };
  }

  if (config.advisoryOnly !== true || config.lengthMeters <= 0 || config.sourceRefs.length === 0) {
    return {
      ...base,
      status: "invalid_config",
      warnings: [...base.warnings, "Corner-arm config must be advisory-only, positive length, and source-backed."],
    };
  }

  const cornerArmPath = evaluateCornerArmPath({ ...project, machine: { ...project.machine, cornerArm: config } });
  const pathEnvelope = cornerArmPath
    ? intersectMultiPolygons(cornerArmPath.extensionEnvelope, [[project.fieldBoundary]])
    : [];
  const evidence = cornerSwingEvidence(project);
  const reviewEnvelope = pathEnvelope;
  const coverageCandidate = project.obstacles.filter((obstacle) => obstacle.noSpray).reduce(
    (allowed, obstacle) => differenceMultiPolygons(allowed, [[obstacle.polygon]]),
    intersectMultiPolygons(reviewEnvelope, dryCornerPolygons),
  );
  const estimatedAddedCoverageAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(coverageCandidate));

  return {
    ...base,
    status: "ready",
    sourceRefs: config.sourceRefs,
    pathEnvelope: reviewEnvelope,
    coverageCandidate,
    evidenceFeatureIds: evidence.ids,
    estimatedAddedCoverageAcres,
    warnings: [
      ...base.warnings,
      ...(evidence.ids.length === 0 ? ["No corner_swing_limit map feature is present; envelope is unconstrained by operator footprint evidence."] : []),
      ...(cornerArmPath?.warnings ?? []),
      "Coverage candidate is not merged into allowedCoverage, endGunCoverage, or feasibility.",
    ],
  };
}

function candidateFromAlternative(
  originalProject: PivotProject,
  alternative: PivotCenterAlternative,
  options: PivotPlacementCandidateOptions,
  sourceRefs: AdvisorySourceReference[],
  evaluateAtCenter?: LayoutAtCenter,
): PivotPlacementCandidate {
  return candidateFromProject(
    originalProject,
    alternative.pivotCenter,
    alternative.sourceSeed,
    options,
    sourceRefs,
    alternative,
    evaluateAtCenter,
  );
}

function candidateFromProject(
  originalProject: PivotProject,
  pivotCenter: XY,
  sourceSeed: PivotPlacementCandidate["sourceSeed"],
  options: PivotPlacementCandidateOptions,
  sourceRefs: AdvisorySourceReference[],
  alternative?: PivotCenterAlternative,
  evaluateAtCenter?: LayoutAtCenter,
): PivotPlacementCandidate {
  const project = { ...originalProject, pivotCenter };
  const result = evaluateAtCenter ? evaluateAtCenter(pivotCenter) : evaluateLayout(project);
  const dryCornerPolygons = dryCornerPolygonsFor(project, result.allowedCoverage);
  const dryCornerAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(dryCornerPolygons));
  const bounds = boundsForGeometry([originalProject.fieldBoundary]);
  const diagonal = Math.max(1, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY));
  const obstacleBufferMeters = Math.max(0, options.obstacleBufferMeters ?? maxObstacleBuffer(originalProject));
  const insideFieldBoundary = pointInPolygon(pivotCenter, originalProject.fieldBoundary);
  const boundaryClearanceMeters = (insideFieldBoundary ? 1 : -1) * distanceToRing(pivotCenter, originalProject.fieldBoundary);
  const minimumObstacleClearanceMeters = minimumObstacleClearance(pivotCenter, originalProject, obstacleBufferMeters);
  const minimumRequiredBoundaryClearanceMeters = Math.max(0, options.minimumBoundaryClearanceMeters ?? 0);
  const minimumRequiredObstacleClearanceMeters = Math.max(0, options.minimumObstacleClearanceMeters ?? 0);
  const obstacleCrossingProfileIds = matchingCrossingProfileIds(originalProject, options.obstacleCrossingProfiles ?? []);
  const distanceFromCurrentMeters = distance(pivotCenter, originalProject.pivotCenter);
  const distanceToWaterSourceMeters = distance(pivotCenter, originalProject.waterSource);
  const distanceToPowerSourceMeters = distance(pivotCenter, originalProject.powerSource);
  const distanceToAccessMeters = distanceToAccess(pivotCenter, originalProject);
  const feasible = alternative?.feasible ?? (result.metrics.outsideFieldAcres <= 0.0001 && result.metrics.obstacleConflictCount === 0);
  const costAssessment = assessAdvisoryCost(originalProject, result.metrics.irrigatedAcres, options.costInput, sourceRefs);
  const scoreBreakdown = placementScoreBreakdown({
    metrics: result.metrics,
    dryCornerAcres,
    feasible,
    minimumObstacleClearanceMeters,
    distanceToWaterSourceMeters,
    distanceToPowerSourceMeters,
    distanceToAccessMeters,
    diagonal,
    waterSourceWeight: options.waterSourceWeight ?? 8,
    powerSourceWeight: options.powerSourceWeight ?? 6,
    accessWeight: options.accessWeight ?? 4,
    costPerIrrigatedAcre: costAssessment.costPerIrrigatedAcre,
  });
  const score = totalPlacementScore(scoreBreakdown);
  const disqualificationReasons = [
    ...(alternative?.disqualificationReasons ?? []),
    ...(!insideFieldBoundary ? ["Candidate pivot center is outside the field boundary."] : []),
    ...(boundaryClearanceMeters < minimumRequiredBoundaryClearanceMeters ? [`Candidate boundary clearance ${boundaryClearanceMeters.toFixed(2)} meters is below required ${minimumRequiredBoundaryClearanceMeters.toFixed(2)} meters.`] : []),
    ...(minimumObstacleClearanceMeters !== null && minimumObstacleClearanceMeters < 0 ? [`Candidate is inside obstacle buffer by ${Math.abs(minimumObstacleClearanceMeters).toFixed(2)} meters.`] : []),
    ...(minimumObstacleClearanceMeters !== null && minimumObstacleClearanceMeters < minimumRequiredObstacleClearanceMeters ? [`Candidate obstacle clearance ${minimumObstacleClearanceMeters.toFixed(2)} meters is below required ${minimumRequiredObstacleClearanceMeters.toFixed(2)} meters.`] : []),
  ];

  return {
    id: `placement-${sourceSeed}-${pivotCenter.x.toFixed(2)}-${pivotCenter.y.toFixed(2)}`,
    pivotCenter,
    metrics: result.metrics,
    score,
    scoreBreakdown,
    feasible: feasible && insideFieldBoundary && disqualificationReasons.length === 0,
    insideFieldBoundary,
    boundaryClearanceMeters,
    sourceSeed,
    dryCornerPolygons,
    dryCornerAcres,
    obstacleBufferMeters,
    minimumObstacleClearanceMeters,
    distanceFromCurrentMeters,
    distanceToWaterSourceMeters,
    distanceToPowerSourceMeters,
    distanceToAccessMeters,
    minimumRequiredBoundaryClearanceMeters,
    minimumRequiredObstacleClearanceMeters,
    obstacleCrossingProfileIds,
    costAssessment,
    warnings: [
      ...result.warnings,
      ...(costAssessment.status === "missing_cost_input" ? ["Cost efficiency is incomplete because no explicit local cost input was supplied."] : []),
      ...(obstacleCrossingProfileIds.length > 0 ? [`${obstacleCrossingProfileIds.length} obstacle crossing profile${obstacleCrossingProfileIds.length === 1 ? "" : "s"} are advisory only; layout metrics still use project hard/no-spray obstacle settings.`] : []),
      "Placement candidate is advisory; apply requires explicit operator confirmation.",
    ],
    disqualificationReasons,
    sourceRefs,
    canonicalGeometryMutation: false,
  };
}

function placementScoreBreakdown(input: {
  metrics: LayoutMetrics;
  dryCornerAcres: number;
  feasible: boolean;
  minimumObstacleClearanceMeters: number | null;
  distanceToWaterSourceMeters: number;
  distanceToPowerSourceMeters: number;
  distanceToAccessMeters: number | null;
  diagonal: number;
  waterSourceWeight: number;
  powerSourceWeight: number;
  accessWeight: number;
  costPerIrrigatedAcre: number | null;
}): PivotPlacementScoreBreakdown {
  const obstacleClearance = input.minimumObstacleClearanceMeters === null
    ? 0
    : Math.max(-35, Math.min(18, input.minimumObstacleClearanceMeters / 2));
  const costEfficiency = input.costPerIrrigatedAcre === null
    ? 0
    : -Math.max(0, Math.min(35, input.costPerIrrigatedAcre / 1000));
  return {
    coverage: round(input.metrics.irrigatedAcres),
    boundaryFit: round(-Math.min(40, input.metrics.outsideFieldAcres * 10)),
    obstacleClearance: round(obstacleClearance),
    waterSourceProximity: round(proximityScore(input.distanceToWaterSourceMeters, input.diagonal, input.waterSourceWeight)),
    powerSourceProximity: round(proximityScore(input.distanceToPowerSourceMeters, input.diagonal, input.powerSourceWeight)),
    accessProximity: round(input.distanceToAccessMeters === null ? 0 : proximityScore(input.distanceToAccessMeters, input.diagonal, input.accessWeight)),
    dryCornerPenalty: round(-Math.min(35, input.dryCornerAcres * 0.18)),
    costEfficiency: round(costEfficiency),
    feasibility: input.feasible ? 35 : -75,
  };
}

function totalPlacementScore(breakdown: PivotPlacementScoreBreakdown): number {
  return round(Object.values(breakdown).reduce((sum, value) => sum + value, 0));
}

function assessAdvisoryCost(
  project: PivotProject,
  irrigatedAcres: number,
  input: AdvisoryCostInput | undefined,
  defaultSourceRefs: AdvisorySourceReference[],
): AdvisoryCostAssessment {
  const sourceRefs = input?.sourceRefs ?? defaultSourceRefs;
  const base = {
    advisoryOnly: true as const,
    canonicalGeometryMutation: false as const,
    estimatedCost: null,
    costPerIrrigatedAcre: null,
    currencyCode: input?.currencyCode?.trim() || "USD",
    sourceRefs,
  };
  if (!input) {
    return {
      ...base,
      status: "missing_cost_input",
      warnings: ["No explicit local cost input was supplied; CPLayout did not infer machine price."],
    };
  }
  const fixedMachineCost = input.fixedMachineCost ?? 0;
  const costPerMeter = input.costPerMeter ?? 0;
  const costPerTower = input.costPerTower ?? 0;
  if (
    !Number.isFinite(fixedMachineCost)
    || !Number.isFinite(costPerMeter)
    || !Number.isFinite(costPerTower)
    || fixedMachineCost < 0
    || costPerMeter < 0
    || costPerTower < 0
    || fixedMachineCost + costPerMeter + costPerTower <= 0
  ) {
    return {
      ...base,
      status: "invalid_cost_input",
      warnings: ["Cost input must include at least one nonnegative fixed, per-meter, or per-tower value."],
    };
  }
  const estimatedCost = fixedMachineCost
    + machineRadiusMeters(project.machine) * costPerMeter
    + project.machine.spanLengthsMeters.length * costPerTower;
  if (irrigatedAcres <= 0) {
    return {
      ...base,
      status: "no_irrigated_acres",
      estimatedCost: round(estimatedCost),
      warnings: ["Cost per irrigated acre was not computed because modeled irrigated acres are zero."],
    };
  }
  return {
    ...base,
    status: "complete",
    estimatedCost: round(estimatedCost),
    costPerIrrigatedAcre: round(estimatedCost / irrigatedAcres),
    warnings: [
      "Cost efficiency uses operator-supplied local cost inputs only and is not a price quote.",
      ...(input.notes ? [input.notes] : []),
    ],
  };
}

function sweepEfficiencyRowFromProject(input: {
  kind: AdvisorySweepEfficiencyRowKind;
  label: string;
  project: PivotProject;
  layout: LayoutResult;
  currentLayout: LayoutResult;
  currentCost: AdvisoryCostAssessment;
  costInput: AdvisoryCostInput | undefined;
  sourceRefs: AdvisorySourceReference[];
  warnings: string[];
}): AdvisorySweepEfficiencyRow {
  const cost = input.kind === "current_sweep"
    ? input.currentCost
    : assessAdvisoryCost(input.project, input.layout.metrics.irrigatedAcres, input.costInput, input.sourceRefs);
  const currentIrrigatedAcres = input.currentLayout.metrics.irrigatedAcres;
  const irrigatedAcresDeltaFromCurrent = input.layout.metrics.irrigatedAcres - currentIrrigatedAcres;
  const estimatedCostDeltaFromCurrent = cost.estimatedCost !== null && input.currentCost.estimatedCost !== null
    ? round(cost.estimatedCost - input.currentCost.estimatedCost)
    : null;
  const costPerAcreDeltaFromCurrent = cost.costPerIrrigatedAcre !== null && input.currentCost.costPerIrrigatedAcre !== null
    ? round(cost.costPerIrrigatedAcre - input.currentCost.costPerIrrigatedAcre)
    : null;
  const comparableToCurrentAcres = input.kind === "current_sweep"
    ? true
    : currentIrrigatedAcres > 0 && input.layout.metrics.irrigatedAcres >= currentIrrigatedAcres * 0.95;
  const radiusMeters = machineRadiusMeters(input.project.machine);

  return {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    kind: input.kind,
    label: input.label,
    sweepMode: input.project.machine.sweep.mode,
    radiusMeters: round(radiusMeters),
    spanCount: input.project.machine.spanLengthsMeters.length,
    irrigatedAcres: round(input.layout.metrics.irrigatedAcres),
    irrigatedAcresDeltaFromCurrent: round(irrigatedAcresDeltaFromCurrent),
    coveragePercent: round(input.layout.metrics.coveragePercent),
    outsideFieldAcres: round(input.layout.metrics.outsideFieldAcres),
    obstacleConflictCount: input.layout.metrics.obstacleConflictCount,
    hardMechanicalConflictCount: input.layout.metrics.hardMechanicalConflictCount,
    estimatedCostDeltaFromCurrent,
    costPerAcreDeltaFromCurrent,
    comparableToCurrentAcres,
    cost,
    warnings: [
      ...input.warnings,
      ...(comparableToCurrentAcres ? [] : ["This row does not reach 95% of current modeled irrigated acres."]),
      ...(cost.status !== "complete" ? [`Cost-per-acre status is ${cost.status}.`] : []),
    ],
  };
}

function buildMachineZoneReviews(
  project: PivotProject,
  options: PivotPlacementCandidateOptions,
  sourceRefs: AdvisorySourceReference[],
): AdvisoryMachineZoneReview[] {
  const zoneFeatures = (project.mapFeatures ?? []).filter((feature) => (
    feature.kind === "planning_boundary" || feature.kind === "machine_zone"
  ));
  return zoneFeatures.map((feature): AdvisoryMachineZoneReview => {
    const zoneBoundary = mapFeatureBoundary(feature);
    const base = {
      featureId: feature.id,
      featureName: feature.name,
      featureKind: feature.kind as "planning_boundary" | "machine_zone",
      advisoryOnly: true as const,
      canonicalGeometryMutation: false as const,
      qualifiedReviewRequired: true as const,
      boundaryVertexCount: zoneBoundary?.length ?? 0,
      sourceRefs,
    };
    if (!zoneBoundary || zoneBoundary.length < 3) {
      return {
        ...base,
        status: "unsupported_geometry",
        bestCandidate: null,
        candidateCount: 0,
        warnings: ["Machine-zone review requires a polygon or circle map feature with at least three projected-XY vertices."],
      };
    }
    const zoneProject: PivotProject = {
      ...project,
      fieldBoundary: zoneBoundary,
    };
    const candidates = buildPivotPlacementCandidates(zoneProject, {
      ...options,
      includeMachineZoneReviews: false,
      sourceRefs,
    });
    const bestCandidate = candidates.find((candidate) => candidate.feasible && candidate.insideFieldBoundary) ?? null;
    return {
      ...base,
      status: bestCandidate ? "ready" : "no_feasible_candidate",
      bestCandidate,
      candidateCount: candidates.length,
      warnings: [
        `${feature.kind.replaceAll("_", " ")} review is transient and does not create another pivot, zone, or canonical field boundary.`,
        ...(bestCandidate ? [] : ["No feasible center candidate was found inside this advisory zone."]),
      ],
    };
  });
}

function* buildFieldPivotPlanCandidatePool(
  project: PivotProject,
  options: AdvisoryFieldPivotPlanOptions,
  sourceRefs: AdvisorySourceReference[],
  requestedMachineCount: number,
  evaluateAtCenter: LayoutAtCenter,
): Calculation<PivotPlacementCandidate[]> {
  const candidatePoolSize = Math.max(
    requestedMachineCount,
    Math.floor(options.candidatePoolSize ?? Math.max(requestedMachineCount * 10, 18)),
  );
  const gridDivisions = Math.max(3, Math.floor(options.gridDivisions ?? 9));
  const optimizedCandidates = yield* buildPivotPlacementCandidatesWithLayoutSteps(project, {
    ...options,
    maxCandidates: Math.max(candidatePoolSize, requestedMachineCount * 4),
    includeMachineZoneReviews: false,
    sourceRefs,
  }, evaluateAtCenter);
  const gridCandidates = yield* fieldPivotGridCandidates(project, options, sourceRefs, gridDivisions, evaluateAtCenter);
  return dedupePlacementCandidates([...optimizedCandidates, ...gridCandidates])
    .sort(comparePlacementCandidates);
}

function* fieldPivotGridCandidates(
  project: PivotProject,
  options: PivotPlacementCandidateOptions,
  sourceRefs: AdvisorySourceReference[],
  gridDivisions: number,
  evaluateAtCenter: LayoutAtCenter,
): Calculation<PivotPlacementCandidate[]> {
  const bounds = boundsForGeometry([project.fieldBoundary]);
  const xStep = (bounds.maxX - bounds.minX) / gridDivisions;
  const yStep = (bounds.maxY - bounds.minY) / gridDivisions;
  const candidates: PivotPlacementCandidate[] = [];
  for (let yIndex = 0; yIndex <= gridDivisions; yIndex += 1) {
    for (let xIndex = 0; xIndex <= gridDivisions; xIndex += 1) {
      const pivotCenter = {
        x: bounds.minX + xStep * xIndex,
        y: bounds.minY + yStep * yIndex,
      };
      if (!pointInPolygon(pivotCenter, project.fieldBoundary)) continue;
      if (distanceToRing(pivotCenter, project.fieldBoundary) <= 0.001) continue;
      candidates.push(candidateFromProject(project, pivotCenter, "bbox_grid", options, sourceRefs, undefined, evaluateAtCenter));
      yield;
    }
  }
  return candidates;
}

function* selectAdvisoryFieldPivotCandidates(
  project: PivotProject,
  candidates: PivotPlacementCandidate[],
  requestedMachineCount: number,
  minimumRequiredSeparationMeters: number,
  evaluateAtCenter: LayoutAtCenter,
): Calculation<{ selected: PivotPlacementCandidate[]; separationRejections: AdvisoryFieldPivotSeparationRejection[] }> {
  const selected: PivotPlacementCandidate[] = [];
  const separationRejections: AdvisoryFieldPivotSeparationRejection[] = [];
  const rejectedIds = new Set<string>();
  const remaining = [...candidates];
  let runningCoverage: MultiPolygonXY = [];

  while (selected.length < requestedMachineCount && remaining.length > 0) {
    const separatedCandidates: PivotPlacementCandidate[] = [];
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index];
      const nearest = nearestSelectedPlacementCandidate(candidate, selected);
      if (nearest && nearest.centerDistanceMeters < minimumRequiredSeparationMeters) {
        if (!rejectedIds.has(candidate.id)) {
          rejectedIds.add(candidate.id);
          separationRejections.push(fieldPivotSeparationRejection(candidate, nearest, minimumRequiredSeparationMeters));
        }
        remaining.splice(index, 1);
      } else {
        separatedCandidates.push(candidate);
      }
    }

    if (separatedCandidates.length === 0) break;
    const priorCoverage = intersectMultiPolygons(runningCoverage, [[project.fieldBoundary]]);
    const priorCoverageAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(priorCoverage));
    const scored: { candidate: PivotPlacementCandidate; incrementalCoverageAcres: number }[] = [];
    for (const candidate of separatedCandidates) {
      scored.push({
        candidate,
        incrementalCoverageAcres: fieldPivotIncrementalCoverageAcres(project, runningCoverage, priorCoverageAcres, candidate, evaluateAtCenter),
      });
      yield;
    }
    const chosen = scored
      .sort((left, right) => {
        if (right.incrementalCoverageAcres !== left.incrementalCoverageAcres) return right.incrementalCoverageAcres - left.incrementalCoverageAcres;
        return comparePlacementCandidates(left.candidate, right.candidate);
      })[0]?.candidate;
    if (!chosen) break;
    selected.push(chosen);
    const result = evaluateAtCenter(chosen.pivotCenter);
    runningCoverage = unionMultiPolygons([...runningCoverage, ...result.allowedCoverage]);
    const chosenIndex = remaining.findIndex((candidate) => candidate.id === chosen.id);
    if (chosenIndex >= 0) remaining.splice(chosenIndex, 1);
  }

  return { selected, separationRejections };
}

function fieldPivotIncrementalCoverageAcres(
  project: PivotProject,
  runningCoverage: MultiPolygonXY,
  priorCoverageAcres: number,
  candidate: PivotPlacementCandidate,
  evaluateAtCenter: LayoutAtCenter,
): number {
  const result = evaluateAtCenter(candidate.pivotCenter);
  const nextCoverage = intersectMultiPolygons(
    unionMultiPolygons([...runningCoverage, ...result.allowedCoverage]),
    [[project.fieldBoundary]],
  );
  return squareMetersToAcres(multiPolygonAreaSquareMeters(nextCoverage)) - priorCoverageAcres;
}

function nearestSelectedPlacementCandidate(
  candidate: PivotPlacementCandidate,
  selected: PivotPlacementCandidate[],
): { candidate: PivotPlacementCandidate; centerDistanceMeters: number } | null {
  return selected.reduce<{ candidate: PivotPlacementCandidate; centerDistanceMeters: number } | null>((nearest, selectedCandidate) => {
    const centerDistanceMeters = distance(candidate.pivotCenter, selectedCandidate.pivotCenter);
    if (!nearest || centerDistanceMeters < nearest.centerDistanceMeters) {
      return { candidate: selectedCandidate, centerDistanceMeters };
    }
    return nearest;
  }, null);
}

function fieldPivotSeparationRejection(
  candidate: PivotPlacementCandidate,
  nearest: { candidate: PivotPlacementCandidate; centerDistanceMeters: number },
  minimumRequiredSeparationMeters: number,
): AdvisoryFieldPivotSeparationRejection {
  return {
    candidateId: candidate.id,
    pivotCenter: candidate.pivotCenter,
    nearestSelectedCandidateId: nearest.candidate.id,
    centerDistanceMeters: round(nearest.centerDistanceMeters),
    minimumRequiredSeparationMeters: round(minimumRequiredSeparationMeters),
    separationDeficitMeters: round(minimumRequiredSeparationMeters - nearest.centerDistanceMeters),
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    warnings: [
      "Candidate was skipped by advisory separation screening only; this is not certified collision prevention.",
      "Qualified review is required before using separated candidates for field placement decisions.",
    ],
  };
}

function planningBoundaryFeatures(project: PivotProject): ProjectMapFeature[] {
  return (project.mapFeatures ?? []).filter((feature) => feature.kind === "planning_boundary");
}

function machineZoneFeatures(project: PivotProject): ProjectMapFeature[] {
  return (project.mapFeatures ?? []).filter((feature) => feature.kind === "machine_zone");
}

function buildAdvisoryMachineScenario(
  project: PivotProject,
  feature: ProjectMapFeature,
  options: AdvisoryMultiMachineReviewOptions,
  sourceRefs: AdvisorySourceReference[],
): AdvisoryMachineScenario {
  const zoneBoundary = mapFeatureBoundary(feature);
  const base = {
    id: `scenario-${feature.id}`,
    zoneFeatureId: feature.id,
    zoneName: feature.name,
    zoneKind: feature.kind as "planning_boundary" | "machine_zone",
    advisoryOnly: true as const,
    canonicalGeometryMutation: false as const,
    qualifiedReviewRequired: true as const,
    boundaryVertexCount: zoneBoundary?.length ?? 0,
    zoneAcres: zoneBoundary ? squareMetersToAcres(polygonAreaSquareMeters(zoneBoundary)) : 0,
    machineRadiusMeters: machineRadiusMeters(project.machine),
    sourceRefs,
  };

  if (!zoneBoundary || zoneBoundary.length < 3) {
    return {
      ...base,
      status: "unsupported_geometry",
      bestCandidate: null,
      candidateCount: 0,
      modeledIrrigatedAcres: 0,
      modeledCoverage: [],
      machineEnvelope: [],
      warnings: ["Advisory machine scenario requires a polygon or circle boundary with at least three projected-XY vertices."],
    };
  }

  const candidates = buildAdvisoryZonePlacementCandidates(project, zoneBoundary, {
    ...options,
    includeMachineZoneReviews: false,
    sourceRefs,
  }, sourceRefs);
  const bestCandidate = candidates.find((candidate) => candidate.feasible && candidate.insideFieldBoundary) ?? null;

  if (!bestCandidate) {
    return {
      ...base,
      status: "no_feasible_candidate",
      bestCandidate: null,
      candidateCount: candidates.length,
      modeledIrrigatedAcres: 0,
      modeledCoverage: [],
      machineEnvelope: [],
      warnings: [
        `${feature.kind.replaceAll("_", " ")} scenario is transient and does not create a saved pivot or field boundary.`,
        "No feasible center candidate was found inside this advisory zone.",
      ],
    };
  }

  const scenarioProject: PivotProject = {
    ...project,
    pivotCenter: bestCandidate.pivotCenter,
  };
  const result = evaluateLayout(scenarioProject);
  const machineEnvelope = machineEnvelopeFor(project, bestCandidate.pivotCenter);

  return {
    ...base,
    status: "ready",
    bestCandidate,
    candidateCount: candidates.length,
    modeledIrrigatedAcres: result.metrics.irrigatedAcres,
    modeledCoverage: result.allowedCoverage,
    machineEnvelope,
    warnings: [
      `${feature.kind.replaceAll("_", " ")} scenario is transient and does not create a saved pivot or field boundary.`,
      "Scenario uses the current machine as a planning template and uses this zone for seeding/scoring context only.",
      "Machine physical and wet envelopes are evaluated against the full project field boundary; internal zone edges are not containment constraints.",
      ...bestCandidate.warnings,
    ],
  };
}

function buildAdvisoryZonePlacementCandidates(
  project: PivotProject,
  zoneBoundary: XY[],
  options: PivotPlacementCandidateOptions,
  sourceRefs: AdvisorySourceReference[],
): PivotPlacementCandidate[] {
  const gridDivisions = Math.max(3, Math.floor(options.gridDivisions ?? 9));
  const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? 5));
  const seeds: Array<{ point: XY; sourceSeed: PivotPlacementCandidate["sourceSeed"] }> = [
    { point: centroid(zoneBoundary), sourceSeed: "centroid" },
    {
      point: maximumInscribedCircleSeed(
        zoneBoundary,
        gridDivisions,
        options.maximumInteriorSeedRefinement ?? "local",
      ).center,
      sourceSeed: "maximum_inscribed_circle",
    },
    ...zoneGridSeedPoints(zoneBoundary, gridDivisions).map((point) => ({
      point,
      sourceSeed: "bbox_grid" as const,
    })),
  ];

  return dedupePlacementCandidates(seeds
    .filter((seed) => pointInPolygon(seed.point, zoneBoundary))
    .map((seed) => candidateFromProject(project, seed.point, seed.sourceSeed, options, sourceRefs)))
    .sort(comparePlacementCandidates)
    .slice(0, maxCandidates);
}

function zoneGridSeedPoints(zoneBoundary: XY[], gridDivisions: number): XY[] {
  const bounds = boundsForGeometry([zoneBoundary]);
  const xStep = (bounds.maxX - bounds.minX) / gridDivisions;
  const yStep = (bounds.maxY - bounds.minY) / gridDivisions;
  const points: XY[] = [];
  for (let yIndex = 0; yIndex <= gridDivisions; yIndex += 1) {
    for (let xIndex = 0; xIndex <= gridDivisions; xIndex += 1) {
      const point = {
        x: bounds.minX + xStep * xIndex,
        y: bounds.minY + yStep * yIndex,
      };
      if (pointInPolygon(point, zoneBoundary) && distanceToRing(point, zoneBoundary) > 0.001) {
        points.push(point);
      }
    }
  }
  return points;
}

function machineEnvelopeFor(project: PivotProject, pivotCenter: XY, radiusMeters = machineRadiusMeters(project.machine)): MultiPolygonXY {
  const radius = radiusMeters;
  if (radius <= 0) return [];
  return [[createSectorPolygon(pivotCenter, radius, project.machine.sweep)]];
}

function buildMachineEnvelopeConflicts(
  project: PivotProject,
  scenarios: AdvisoryMachineScenario[],
  options: AdvisoryMultiMachineReviewOptions,
): AdvisoryMachineEnvelopeConflict[] {
  const collisionBufferMeters = Math.max(0, options.collisionBufferMeters ?? 0);
  const explicitMinimumSeparationMeters = Math.max(0, options.minimumMachineSeparationMeters ?? 0);
  const conflicts: AdvisoryMachineEnvelopeConflict[] = [];

  for (let leftIndex = 0; leftIndex < scenarios.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < scenarios.length; rightIndex += 1) {
      const left = scenarios[leftIndex];
      const right = scenarios[rightIndex];
      const leftCenter = left.bestCandidate?.pivotCenter;
      const rightCenter = right.bestCandidate?.pivotCenter;
      if (!leftCenter || !rightCenter) continue;

      const envelopeSeparation = left.machineRadiusMeters + right.machineRadiusMeters;
      const minimumRequiredSeparationMeters = Math.max(
        explicitMinimumSeparationMeters,
        envelopeSeparation + collisionBufferMeters,
      );
      const centerDistanceMeters = distance(leftCenter, rightCenter);
      const separationDeficitMeters = minimumRequiredSeparationMeters - centerDistanceMeters;
      if (separationDeficitMeters <= 0) continue;

      const collisionZone = intersectMultiPolygons(
        left.machineEnvelope,
        right.machineEnvelope,
      );
      const envelopeOverlapAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(collisionZone));
      const separationReviewBufferMeters = Math.max(0, (minimumRequiredSeparationMeters - envelopeSeparation) / 2);
      const separationReviewZone = separationReviewBufferMeters > 0
        ? intersectMultiPolygons(
          machineEnvelopeFor(project, leftCenter, left.machineRadiusMeters + separationReviewBufferMeters),
          machineEnvelopeFor(project, rightCenter, right.machineRadiusMeters + separationReviewBufferMeters),
        )
        : collisionZone;
      const separationReviewZoneAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(separationReviewZone));
      const status = envelopeOverlapAcres > 0.001
        ? "machine_envelope_overlap"
        : "separation_buffer_warning";
      const severity = status === "machine_envelope_overlap" ? "critical_overlap" : "buffer_intrusion";

      conflicts.push({
        id: `conflict-${left.id}-${right.id}`,
        leftScenarioId: left.id,
        rightScenarioId: right.id,
        leftZoneName: left.zoneName,
        rightZoneName: right.zoneName,
        status,
        severity,
        advisoryOnly: true,
        canonicalGeometryMutation: false,
        qualifiedReviewRequired: true,
        operatorCollisionReviewRequired: true,
        centerDistanceMeters: round(centerDistanceMeters),
        leftMachineRadiusMeters: round(left.machineRadiusMeters),
        rightMachineRadiusMeters: round(right.machineRadiusMeters),
        collisionBufferMeters: round(collisionBufferMeters),
        minimumRequiredSeparationMeters: round(minimumRequiredSeparationMeters),
        separationDeficitMeters: round(Math.max(0, separationDeficitMeters)),
        separationReviewBufferMeters: round(separationReviewBufferMeters),
        collisionZone,
        collisionZoneAcres: round(envelopeOverlapAcres),
        separationReviewZone,
        separationReviewZoneAcres: round(separationReviewZoneAcres),
        envelopeOverlapAcres: round(envelopeOverlapAcres),
        warnings: [
          "Conflict includes projected-XY collision/review zone evidence only; it does not mutate saved project geometry.",
          "Conflict does not model real tower timing, controls, interlocks, or field operations.",
          "Qualified review is required before using this warning for machine placement decisions.",
        ],
      });
    }
  }

  return conflicts;
}

function countVerifiedPowerExclusionConflicts(
  project: PivotProject,
  scenarios: AdvisoryMachineScenario[],
  options: AdvisoryMultiMachineReviewOptions,
): number {
  const exclusionFeatures = verifiedPowerExclusionFeatures(project, options);
  if (exclusionFeatures.length === 0 || scenarios.length === 0) return 0;
  let conflictCount = 0;
  for (const scenario of scenarios) {
    const pivotCenter = scenario.bestCandidate?.pivotCenter;
    if (!pivotCenter) continue;
    const scenarioProject = { ...project, pivotCenter };
    const conflicts = exclusionFeatures.some((feature) => (
      mapFeatureTouchesMachineEnvelope(scenarioProject, feature, scenario.machineRadiusMeters, scenario.machineEnvelope)
    ));
    if (conflicts) conflictCount += 1;
  }
  return conflictCount;
}

function verifiedPowerExclusionFeatures(
  project: PivotProject,
  options: AdvisoryMultiMachineReviewOptions,
): ProjectMapFeature[] {
  const blockedProfileIds = new Set((options.obstacleCrossingProfiles ?? [])
    .filter((profile) => profile.advisoryOnly === true && profile.crossingAllowed === false)
    .flatMap((profile) => [profile.obstacleId, profile.evidenceId].filter((id): id is string => Boolean(id))));
  return (project.mapFeatures ?? []).filter((feature) => {
    if (feature.kind === "power_pole") return true;
    if (feature.kind !== "power_line") return false;
    if (blockedProfileIds.has(feature.id)) return true;
    return feature.properties?.powerLineExclusion === true
      || feature.properties?.power_line_exclusion === true
      || feature.properties?.powerLineEvidenceStatus === "verified_exclusion"
      || feature.properties?.power_line_evidence_status === "verified_exclusion";
  });
}

function mapFeatureTouchesMachineEnvelope(
  project: PivotProject,
  feature: ProjectMapFeature,
  radiusMeters: number,
  envelope: MultiPolygonXY,
): boolean {
  if (feature.geometry.type === "Point") return pointInMultiPolygon(feature.geometry.point, envelope);
  if (feature.geometry.type === "Circle") {
    return distance(project.pivotCenter, feature.geometry.center) - feature.geometry.radiusMeters <= radiusMeters
      && sweepContainsPoint(project, feature.geometry.center);
  }
  if (feature.geometry.type === "Polygon") {
    return multiPolygonAreaSquareMeters(intersectMultiPolygons(envelope, [[feature.geometry.vertices]])) > 0.000001;
  }
  return feature.geometry.vertices.some((point) => pointInMultiPolygon(point, envelope))
    || (project.machine.sweep.mode === "full_circle" && distanceToLineString(project.pivotCenter, feature.geometry.vertices) <= radiusMeters);
}

function buildBoundaryCompilation(
  project: PivotProject,
  planningBoundaries: ProjectMapFeature[],
  machineZones: ProjectMapFeature[],
  scenarios: AdvisoryMachineScenario[],
): AdvisoryBoundaryCompilation {
  const planningBoundaryRings = planningBoundaries
    .map((feature) => mapFeatureBoundary(feature))
    .filter((boundary): boundary is XY[] => Boolean(boundary && boundary.length >= 3));
  const compiledBoundary = planningBoundaryRings.length > 0
    ? unionMultiPolygons(planningBoundaryRings.map((boundary) => [boundary]))
    : [[project.fieldBoundary]];
  const scenarioBoundaryRings = (machineZones.length > 0 ? machineZones : planningBoundaries)
    .map((feature) => mapFeatureBoundary(feature))
    .filter((boundary): boundary is XY[] => Boolean(boundary && boundary.length >= 3));
  const scenarioBoundaryUnion = scenarioBoundaryRings.length > 0
    ? unionMultiPolygons(scenarioBoundaryRings.map((boundary) => [boundary]))
    : [];
  const modeledCoverages = scenarios
    .filter((scenario) => scenario.status === "ready")
    .flatMap((scenario) => scenario.modeledCoverage);
  const modeledCoverageUnion = unionMultiPolygons(modeledCoverages);
  const modeledIrrigatedAcresSum = scenarios.reduce((sum, scenario) => sum + scenario.modeledIrrigatedAcres, 0);
  const modeledIrrigatedUnionAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(modeledCoverageUnion));
  const compiledBoundaryAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(compiledBoundary));
  const modeledCoverageInFullScope = intersectMultiPolygons(modeledCoverageUnion, compiledBoundary);
  const modeledCoverageOutsideFullScope = differenceMultiPolygons(modeledCoverageUnion, compiledBoundary);
  const fullScopeCoveredAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(modeledCoverageInFullScope));
  const outsideFullScopeAcres = squareMetersToAcres(multiPolygonAreaSquareMeters(modeledCoverageOutsideFullScope));
  const fullScopeBoundarySource: AdvisoryBoundaryCompilation["fullScopeBoundarySource"] = planningBoundaryRings.length > 0
    ? "planning_boundary"
    : "field_boundary";
  const scenarioBoundarySource: AdvisoryBoundaryCompilation["scenarioBoundarySource"] = scenarioBoundaryRings.length === 0
    ? "none"
    : machineZones.length > 0
      ? "machine_zone"
      : "planning_boundary";

  return {
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    fieldBoundaryAcres: round(squareMetersToAcres(polygonAreaSquareMeters(project.fieldBoundary))),
    fullScopeBoundarySource,
    scenarioBoundarySource,
    compiledBoundary,
    compiledBoundaryPolygonCount: compiledBoundary.length,
    planningBoundaryCount: planningBoundaries.length,
    machineZoneCount: machineZones.length,
    scenarioCount: scenarios.length,
    readyScenarioCount: scenarios.filter((scenario) => scenario.status === "ready").length,
    unsupportedScenarioCount: scenarios.filter((scenario) => scenario.status === "unsupported_geometry").length,
    compiledBoundaryAcres: round(compiledBoundaryAcres),
    fullScopeCoveragePercent: round(compiledBoundaryAcres > 0 ? (fullScopeCoveredAcres / compiledBoundaryAcres) * 100 : 0),
    fullScopeUnirrigatedAcres: round(Math.max(0, compiledBoundaryAcres - fullScopeCoveredAcres)),
    outsideFullScopeAcres: round(outsideFullScopeAcres),
    scenarioBoundaryUnionAcres: round(squareMetersToAcres(multiPolygonAreaSquareMeters(scenarioBoundaryUnion))),
    scenarioZoneAcres: round(scenarios.reduce((sum, scenario) => sum + scenario.zoneAcres, 0)),
    modeledIrrigatedAcresSum: round(modeledIrrigatedAcresSum),
    modeledIrrigatedUnionAcres: round(modeledIrrigatedUnionAcres),
    duplicateModeledCoverageAcres: round(Math.max(0, modeledIrrigatedAcresSum - modeledIrrigatedUnionAcres)),
  };
}

function buildMachineStrategyInputs(
  project: PivotProject,
  options: AdvisoryMachineStrategyComparisonOptions,
  sourceRefs: AdvisorySourceReference[],
): AdvisoryMachineStrategyInput[] {
  const inputs: AdvisoryMachineStrategyInput[] = options.strategies
    ? [...options.strategies]
    : [{
      id: "current-machine",
      label: "Current machine",
      strategyKind: "current_machine",
      machine: project.machine,
      sourceRefs,
    }];
  const currentRadius = machineRadiusMeters(project.machine);
  const linearPathFeatures = linearMovePathFeatures(project);
  const benderSecondPivotPoints = benderSecondPivotEvidencePoints(project);

  if (project.machine.sweep.mode === "partial_circle" && currentRadius > 0) {
    inputs.push({
      id: "full-circle-same-radius",
      label: "Full circle at current radius",
      strategyKind: "full_circle_same_radius",
      machine: {
        ...project.machine,
        id: `${project.machine.id}-full-circle`,
        name: `${project.machine.name} full circle`,
        sweep: { mode: "full_circle" },
        endGunAngleRanges: undefined,
      },
      sourceRefs,
      notes: "Compares the current radius against a full-circle sweep; it is not a machine quote or vendor recommendation.",
    });
  }

  if (options.includeGeneratedRadiusStrategies !== false && currentRadius > 0) {
    const radii = options.generatedFullCircleRadiiMeters ?? generatedFullCircleRadii(currentRadius);
    for (const radius of radii) {
      if (!Number.isFinite(radius) || radius <= 0) continue;
      inputs.push({
        id: `full-circle-radius-${radius.toFixed(2)}`,
        label: `Full circle ${radius.toFixed(0)} m radius`,
        strategyKind: "full_circle_radius",
        machine: approximateFullCircleMachine(project.machine, radius),
        sourceRefs,
        notes: "Generated radius strategy is a local planning approximation from the current span package.",
      });
    }
  }

  for (const feature of linearPathFeatures) {
    inputs.push({
      id: `linear-lateral-${feature.id}`,
      label: feature.name || "Linear/lateral move path",
      strategyKind: "linear_lateral_move",
      machine: {
        ...project.machine,
        id: `${project.machine.id}-linear-lateral-${feature.id}`,
        name: `${project.machine.name} linear/lateral template`,
        sweep: { mode: "full_circle" },
        endGunAngleRanges: undefined,
      },
      pathFeatureId: feature.id,
      sourceRefs,
      notes: "Linear/lateral strategy uses an operator-supplied projected-XY travel path and an approximate swept strip.",
    });
  }

  for (const point of benderSecondPivotPoints) {
    inputs.push({
      id: `bender-second-pivot-${point.id}`,
      label: point.label || "Bender / second pivot point",
      strategyKind: "bender_second_pivot",
      machine: project.machine,
      secondPivotPointId: point.id,
      sourceRefs: mergeSourceRefs(sourceRefs, DEFAULT_BENDER_SECOND_PIVOT_SOURCE_REFS),
      notes: "Bender strategy uses an operator-labeled projected-XY second-pivot evidence point and a conservative tail-sweep opportunity envelope.",
    });
  }

  if (options.includeUnsupportedConceptPlaceholders !== false) {
    inputs.push(
      ...(linearPathFeatures.length === 0 ? [{
        id: "linear-lateral-placeholder",
        label: "Linear/lateral move",
        strategyKind: "unsupported_linear_lateral",
        sourceRefs,
        notes: "Linear/lateral move design requires a separate path, guidance, water-supply, and travel-stop model.",
      } as AdvisoryMachineStrategyInput] : []),
      ...(benderSecondPivotPoints.length === 0 ? [{
        id: "bender-second-pivot-placeholder",
        label: "Bender / second pivot point",
        strategyKind: "unsupported_bender_second_pivot",
        sourceRefs,
        notes: "Bender or second-pivot review requires operator-labeled projected-XY second-pivot evidence before CPLayout can build an advisory opportunity envelope.",
      } as AdvisoryMachineStrategyInput] : []),
    );
  }

  return dedupeMachineStrategyInputs(inputs);
}

function evaluateMachineStrategy(
  project: PivotProject,
  strategy: AdvisoryMachineStrategyInput,
  options: AdvisoryMachineStrategyComparisonOptions,
  defaultSourceRefs: AdvisorySourceReference[],
): AdvisoryMachineStrategyResult {
  const sourceRefs = strategy.sourceRefs ?? defaultSourceRefs;
  const unsupportedWarning = unsupportedStrategyWarning(strategy);
  if (unsupportedWarning || !strategy.machine) {
    return {
      id: strategy.id,
      label: strategy.label,
      strategyKind: strategy.strategyKind,
      status: "unsupported_model",
      advisoryOnly: true,
      canonicalGeometryMutation: false,
      qualifiedReviewRequired: true,
      machineRadiusMeters: 0,
      spanCount: 0,
      sweepMode: "unsupported",
      bestCandidate: null,
      pathFeatureId: strategy.pathFeatureId,
      secondPivotPointId: strategy.secondPivotPointId,
      candidateCount: 0,
      irrigatedAcres: 0,
      outsideFieldAcres: 0,
      coveragePercent: 0,
      costAssessment: null,
      costEfficiencyAcresPerHundredThousand: null,
      advisoryScore: Number.NEGATIVE_INFINITY,
      warnings: [
        unsupportedWarning ?? "Machine strategy is missing a machine template and was not scored.",
        ...(strategy.notes ? [strategy.notes] : []),
      ],
      sourceRefs,
    };
  }

  if (strategy.strategyKind === "linear_lateral_move") {
    return evaluateLinearLateralStrategy(project, strategy, options, sourceRefs);
  }

  if (strategy.strategyKind === "bender_second_pivot") {
    return evaluateBenderSecondPivotStrategy(project, strategy, options, sourceRefs);
  }

  const strategyProject: PivotProject = {
    ...project,
    machine: strategy.machine,
  };
  const candidates = buildPivotPlacementCandidates(strategyProject, {
    ...options,
    includeMachineZoneReviews: false,
    sourceRefs,
  });
  const bestCandidate = candidates.find((candidate) => candidate.feasible && candidate.insideFieldBoundary) ?? null;
  const costAssessment = bestCandidate?.costAssessment
    ?? assessAdvisoryCost(strategyProject, 0, options.costInput, sourceRefs);
  const costEfficiencyAcresPerHundredThousand = costAssessment.estimatedCost && bestCandidate
    ? round(bestCandidate.metrics.irrigatedAcres / (costAssessment.estimatedCost / 100000))
    : null;
  const advisoryScore = bestCandidate
    ? round(bestCandidate.score + (costEfficiencyAcresPerHundredThousand ?? 0))
    : Number.NEGATIVE_INFINITY;

  return {
    id: strategy.id,
    label: strategy.label,
    strategyKind: strategy.strategyKind,
    status: bestCandidate ? "ready" : "no_feasible_candidate",
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    machineRadiusMeters: round(machineRadiusMeters(strategy.machine)),
    spanCount: strategy.machine.spanLengthsMeters.length,
    sweepMode: strategy.machine.sweep.mode,
    bestCandidate,
    pathFeatureId: strategy.pathFeatureId,
    candidateCount: candidates.length,
    irrigatedAcres: bestCandidate?.metrics.irrigatedAcres ?? 0,
    outsideFieldAcres: bestCandidate?.metrics.outsideFieldAcres ?? 0,
    coveragePercent: bestCandidate?.metrics.coveragePercent ?? 0,
    costAssessment,
    costEfficiencyAcresPerHundredThousand,
    advisoryScore,
    warnings: [
      `${strategy.label} is an advisory machine strategy only; applying it requires explicit operator edits and validation.`,
      ...(strategy.notes ? [strategy.notes] : []),
      ...(bestCandidate ? bestCandidate.warnings : ["No feasible pivot-center candidate was found for this machine strategy."]),
    ],
    sourceRefs,
  };
}

function unsupportedStrategyWarning(strategy: AdvisoryMachineStrategyInput): string | null {
  if (strategy.strategyKind === "unsupported_linear_lateral") {
    return "Linear/lateral move scoring is not implemented; CPLayout needs a source-backed travel-path and water-supply model before ranking it.";
  }
  if (strategy.strategyKind === "unsupported_bender_second_pivot") {
    return "Bender/second-pivot opportunity review needs operator-labeled projected-XY second-pivot evidence; proprietary tower-pivot kinematics remain unmodeled.";
  }
  return null;
}

function evaluateBenderSecondPivotStrategy(
  project: PivotProject,
  strategy: AdvisoryMachineStrategyInput,
  options: AdvisoryMachineStrategyComparisonOptions,
  sourceRefs: AdvisorySourceReference[],
): AdvisoryMachineStrategyResult {
  const point = benderSecondPivotEvidencePoints(project).find((candidate) => candidate.id === strategy.secondPivotPointId);
  const machine = strategy.machine;
  const unsupportedBase = {
    id: strategy.id,
    label: strategy.label,
    strategyKind: strategy.strategyKind,
    advisoryOnly: true as const,
    canonicalGeometryMutation: false as const,
    qualifiedReviewRequired: true as const,
    machineRadiusMeters: machine ? round(machineRadiusMeters(machine)) : 0,
    spanCount: machine?.spanLengthsMeters.length ?? 0,
    sweepMode: machine?.sweep.mode ?? "unsupported" as const,
    bestCandidate: null,
    secondPivotPointId: strategy.secondPivotPointId,
    secondPivotPoint: point?.projected,
    candidateCount: 0,
    irrigatedAcres: 0,
    outsideFieldAcres: 0,
    coveragePercent: 0,
    costAssessment: null,
    costEfficiencyAcresPerHundredThousand: null,
    advisoryScore: Number.NEGATIVE_INFINITY,
    sourceRefs,
  };

  if (!machine || !point) {
    return {
      ...unsupportedBase,
      status: "unsupported_model",
      warnings: [
        "Bender/second-pivot scoring requires an operator-labeled pivot_center survey point whose label or notes identify it as bender, second pivot, tower pivot, hinge, or drive tower evidence.",
        ...(strategy.notes ? [strategy.notes] : []),
      ],
    };
  }

  const bender = evaluateBenderSecondPivotEnvelope(project, machine, point);
  const costAssessment = assessAdvisoryCost({ ...project, machine }, bender.metrics.irrigatedAcres, options.costInput, sourceRefs);
  const costEfficiencyAcresPerHundredThousand = costAssessment.estimatedCost
    ? round(bender.metrics.irrigatedAcres / (costAssessment.estimatedCost / 100000))
    : null;
  const advisoryScore = round(
    bender.metrics.irrigatedAcres
    - Math.min(40, bender.metrics.outsideFieldAcres * 10)
    - bender.metrics.hardMechanicalConflictCount * 35
    - bender.metrics.obstacleConflictCount * 15
    + (costEfficiencyAcresPerHundredThousand ?? 0),
  );

  return {
    ...unsupportedBase,
    status: bender.metrics.irrigatedAcres > 0 && bender.tailRadiusMeters > 0 ? "ready" : "no_feasible_candidate",
    candidateCount: 1,
    irrigatedAcres: bender.metrics.irrigatedAcres,
    outsideFieldAcres: bender.metrics.outsideFieldAcres,
    coveragePercent: bender.metrics.coveragePercent,
    costAssessment,
    costEfficiencyAcresPerHundredThousand,
    advisoryScore,
    benderPrimaryDistanceMeters: bender.primaryDistanceMeters,
    benderTailRadiusMeters: bender.tailRadiusMeters,
    warnings: [
      `${strategy.label} is an advisory bender/second-pivot opportunity envelope only; applying it requires explicit operator edits and validation.`,
      "Tail coverage is approximated as a full-circle sweep around the labeled projected-XY second pivot point using the remaining machine length beyond that point.",
      "The model does not verify drive-tower hinge hardware, steering sequence, sprinkler timing, water supply, slope, interlocks, or manufacturer-specific controls.",
      ...(strategy.notes ? [strategy.notes] : []),
      ...bender.warnings,
    ],
  };
}

function evaluateBenderSecondPivotEnvelope(
  project: PivotProject,
  machine: PivotMachine,
  point: SurveyPoint,
): { metrics: LayoutMetrics; primaryDistanceMeters: number; tailRadiusMeters: number; warnings: string[] } {
  const machineRadius = machineRadiusMeters(machine);
  const primaryDistanceMeters = distance(project.pivotCenter, point.projected);
  const tailRadiusMeters = Math.max(0, machineRadius - primaryDistanceMeters);
  const fieldArea = polygonAreaSquareMeters(project.fieldBoundary);
  const baseProject: PivotProject = { ...project, machine };
  const baseResult = evaluateLayout(baseProject);
  const noSprayObstacles = project.obstacles.filter((obstacle) => obstacle.noSpray);

  if (machineRadius <= 0 || tailRadiusMeters <= 0) {
    return {
      metrics: {
        ...baseResult.metrics,
        irrigatedAcres: 0,
        nonIrrigatedAcres: squareMetersToAcres(fieldArea),
        coveragePercent: 0,
      },
      primaryDistanceMeters: round(primaryDistanceMeters),
      tailRadiusMeters: round(tailRadiusMeters),
      warnings: [
        `Second pivot evidence is ${primaryDistanceMeters.toFixed(2)} meters from the primary pivot, which leaves no positive tail length from the current ${machineRadius.toFixed(2)} meter machine radius.`,
      ],
    };
  }

  const tailEnvelope: MultiPolygonXY = [[createCirclePolygon(point.projected, tailRadiusMeters, 96)]];
  const tailInsideField = intersectMultiPolygons(tailEnvelope, [[project.fieldBoundary]]);
  const tailAllowed = noSprayObstacles.reduce(
    (current, obstacle) => differenceMultiPolygons(current, [[obstacle.polygon]]),
    tailInsideField,
  );
  const combinedAllowed = unionMultiPolygons([...baseResult.allowedCoverage, ...tailAllowed]);
  const combinedOutside = unionMultiPolygons([
    ...baseResult.outsideFieldCoverage,
    ...differenceMultiPolygons(tailEnvelope, [[project.fieldBoundary]]),
  ]);
  const benderEnvelope = unionMultiPolygons([
    ...machineEnvelopeFor(baseProject, project.pivotCenter),
    ...tailEnvelope,
  ]);
  const allowedArea = multiPolygonAreaSquareMeters(combinedAllowed);
  const outsideArea = multiPolygonAreaSquareMeters(combinedOutside);
  const obstacleConflictCount = project.obstacles.filter((obstacle) => (
    multiPolygonAreaSquareMeters(intersectMultiPolygons(benderEnvelope, [[obstacle.polygon]])) > 0.000001
  )).length;
  const noSprayConflictCount = noSprayObstacles.filter((obstacle) => (
    multiPolygonAreaSquareMeters(intersectMultiPolygons(benderEnvelope, [[obstacle.polygon]])) > 0.000001
  )).length;
  const hardMechanicalConflictCount = project.obstacles.filter((obstacle) => (
    obstacle.hardConflict
    && multiPolygonAreaSquareMeters(intersectMultiPolygons(benderEnvelope, [[obstacle.polygon]])) > 0.000001
  )).length;

  return {
    metrics: {
      fieldAcres: squareMetersToAcres(fieldArea),
      irrigatedAcres: squareMetersToAcres(allowedArea),
      nonIrrigatedAcres: squareMetersToAcres(Math.max(0, fieldArea - allowedArea)),
      coveragePercent: fieldArea > 0 ? (allowedArea / fieldArea) * 100 : 0,
      endGunAcres: baseResult.metrics.endGunAcres,
      outsideFieldAcres: squareMetersToAcres(outsideArea),
      obstacleConflictCount,
      noSprayConflictCount,
      hardMechanicalConflictCount,
      towerTrackConflictCount: baseResult.metrics.towerTrackConflictCount,
    },
    primaryDistanceMeters: round(primaryDistanceMeters),
    tailRadiusMeters: round(tailRadiusMeters),
    warnings: [
      `Second pivot evidence ${point.label} leaves an approximate ${tailRadiusMeters.toFixed(2)} meter tail-sweep radius.`,
      ...(outsideArea > 0 ? [`Bender tail-sweep envelope extends outside the field by ${squareMetersToAcres(outsideArea).toFixed(2)} acres.`] : []),
      ...(obstacleConflictCount > 0 ? [`Bender opportunity envelope intersects ${obstacleConflictCount} obstacle feature${obstacleConflictCount === 1 ? "" : "s"}.`] : []),
    ],
  };
}

function evaluateLinearLateralStrategy(
  project: PivotProject,
  strategy: AdvisoryMachineStrategyInput,
  options: AdvisoryMachineStrategyComparisonOptions,
  sourceRefs: AdvisorySourceReference[],
): AdvisoryMachineStrategyResult {
  const pathFeature = linearMovePathFeatures(project).find((feature) => feature.id === strategy.pathFeatureId);
  const machine = strategy.machine;
  const unsupportedBase = {
    id: strategy.id,
    label: strategy.label,
    strategyKind: strategy.strategyKind,
    advisoryOnly: true as const,
    canonicalGeometryMutation: false as const,
    qualifiedReviewRequired: true as const,
    machineRadiusMeters: machine ? round(machineRadiusMeters(machine)) : 0,
    spanCount: machine?.spanLengthsMeters.length ?? 0,
    sweepMode: machine?.sweep.mode ?? "unsupported" as const,
    bestCandidate: null,
    pathFeatureId: strategy.pathFeatureId,
    secondPivotPointId: strategy.secondPivotPointId,
    candidateCount: 0,
    irrigatedAcres: 0,
    outsideFieldAcres: 0,
    coveragePercent: 0,
    costAssessment: null,
    costEfficiencyAcresPerHundredThousand: null,
    advisoryScore: Number.NEGATIVE_INFINITY,
    sourceRefs,
  };

  if (!machine || !pathFeature || pathFeature.geometry.type !== "LineString" || pathFeature.geometry.vertices.length < 2) {
    return {
      ...unsupportedBase,
      status: "unsupported_model",
      warnings: [
        "Linear/lateral move scoring requires a projected-XY line path feature with at least two vertices.",
        ...(strategy.notes ? [strategy.notes] : []),
      ],
    };
  }

  const linear = evaluateLinearLateralCoverage(project, machine, pathFeature.geometry.vertices);
  const costAssessment = assessAdvisoryCost({ ...project, machine }, linear.metrics.irrigatedAcres, options.costInput, sourceRefs);
  const costEfficiencyAcresPerHundredThousand = costAssessment.estimatedCost
    ? round(linear.metrics.irrigatedAcres / (costAssessment.estimatedCost / 100000))
    : null;
  const advisoryScore = round(
    linear.metrics.irrigatedAcres
    - Math.min(40, linear.metrics.outsideFieldAcres * 10)
    - linear.metrics.obstacleConflictCount * 25
    + (costEfficiencyAcresPerHundredThousand ?? 0),
  );

  return {
    ...unsupportedBase,
    status: linear.metrics.irrigatedAcres > 0 ? "ready" : "no_feasible_candidate",
    candidateCount: 1,
    irrigatedAcres: linear.metrics.irrigatedAcres,
    outsideFieldAcres: linear.metrics.outsideFieldAcres,
    coveragePercent: linear.metrics.coveragePercent,
    costAssessment,
    costEfficiencyAcresPerHundredThousand,
    advisoryScore,
    warnings: [
      `${strategy.label} is an advisory linear/lateral move approximation only; applying it requires explicit operator edits and validation.`,
      "Swept-strip coverage assumes the supplied path is the machine centerline and uses the current machine radius as half-width.",
      "The model does not verify hose/ditch water supply, cable guidance, slope, reversal timing, tower alignment, or manufacturer constraints.",
      ...(strategy.notes ? [strategy.notes] : []),
      ...linear.warnings,
    ],
  };
}

function evaluateLinearLateralCoverage(
  project: PivotProject,
  machine: PivotMachine,
  pathVertices: XY[],
): { metrics: LayoutMetrics; warnings: string[] } {
  const fieldArea = polygonAreaSquareMeters(project.fieldBoundary);
  const halfWidth = machineRadiusMeters(machine);
  const swept = sweptStripForLineString(pathVertices, halfWidth);
  const noSprayObstacles = project.obstacles.filter((obstacle) => obstacle.noSpray);
  const insideField = intersectMultiPolygons(swept, [[project.fieldBoundary]]);
  const allowed = noSprayObstacles.reduce(
    (current, obstacle) => differenceMultiPolygons(current, [[obstacle.polygon]]),
    insideField,
  );
  const outsideField = differenceMultiPolygons(swept, [[project.fieldBoundary]]);
  const allowedArea = multiPolygonAreaSquareMeters(allowed);
  const outsideArea = multiPolygonAreaSquareMeters(outsideField);
  const obstacleConflictCount = project.obstacles.filter((obstacle) => (
    multiPolygonAreaSquareMeters(intersectMultiPolygons(swept, [[obstacle.polygon]])) > 0.000001
  )).length;
  const noSprayConflictCount = noSprayObstacles.filter((obstacle) => (
    multiPolygonAreaSquareMeters(intersectMultiPolygons(swept, [[obstacle.polygon]])) > 0.000001
  )).length;
  const hardMechanicalConflictCount = project.obstacles.filter((obstacle) => (
    obstacle.hardConflict
    && multiPolygonAreaSquareMeters(intersectMultiPolygons(swept, [[obstacle.polygon]])) > 0.000001
  )).length;

  return {
    metrics: {
      fieldAcres: squareMetersToAcres(fieldArea),
      irrigatedAcres: squareMetersToAcres(allowedArea),
      nonIrrigatedAcres: squareMetersToAcres(Math.max(0, fieldArea - allowedArea)),
      coveragePercent: fieldArea > 0 ? (allowedArea / fieldArea) * 100 : 0,
      endGunAcres: 0,
      outsideFieldAcres: squareMetersToAcres(outsideArea),
      obstacleConflictCount,
      noSprayConflictCount,
      hardMechanicalConflictCount,
      towerTrackConflictCount: 0,
    },
    warnings: [
      ...(outsideArea > 0 ? [`Linear/lateral swept strip extends outside the field by ${squareMetersToAcres(outsideArea).toFixed(2)} acres.`] : []),
      ...(obstacleConflictCount > 0 ? [`Linear/lateral swept strip intersects ${obstacleConflictCount} obstacle feature${obstacleConflictCount === 1 ? "" : "s"}.`] : []),
    ],
  };
}

function linearMovePathFeatures(project: PivotProject): ProjectMapFeature[] {
  return (project.mapFeatures ?? []).filter((feature) => feature.kind === "linear_move_path");
}

function benderSecondPivotEvidencePoints(project: PivotProject): SurveyPoint[] {
  return project.surveyPoints.filter((point) => (
    point.role === "pivot_center"
    && point.projected
    && Number.isFinite(point.projected.x)
    && Number.isFinite(point.projected.y)
    && benderSecondPivotEvidenceText(`${point.label} ${point.notes ?? ""}`)
  ));
}

function benderSecondPivotEvidenceText(text: string): boolean {
  if (/\b(no|not|without)\s+(?:a\s+)?(?:bender|second[-_\s]*pivot|tower[-_\s]*pivot|hinge|drive[-_\s]*tower|bend[-_\s]*point)\b/i.test(text)) {
    return false;
  }
  return /\b(bender|second[-_\s]*pivot|tower[-_\s]*pivot|hinge|drive[-_\s]*tower|bend[-_\s]*point)\b/i.test(text);
}

function sweptStripForLineString(vertices: XY[], halfWidthMeters: number): MultiPolygonXY {
  if (vertices.length < 2 || halfWidthMeters <= 0) return [];
  const polygons: MultiPolygonXY = [];
  for (let index = 0; index < vertices.length - 1; index += 1) {
    const rectangle = segmentStripPolygon(vertices[index], vertices[index + 1], halfWidthMeters);
    if (rectangle.length > 0) polygons.push([rectangle]);
  }
  for (const vertex of vertices) {
    polygons.push([createCirclePolygon(vertex, halfWidthMeters, 48)]);
  }
  return unionMultiPolygons(polygons);
}

function segmentStripPolygon(start: XY, end: XY, halfWidthMeters: number): XY[] {
  const length = distance(start, end);
  if (length <= 0) return [];
  const normal = {
    x: -(end.y - start.y) / length,
    y: (end.x - start.x) / length,
  };
  const offset = { x: normal.x * halfWidthMeters, y: normal.y * halfWidthMeters };
  return [
    { x: start.x + offset.x, y: start.y + offset.y },
    { x: end.x + offset.x, y: end.y + offset.y },
    { x: end.x - offset.x, y: end.y - offset.y },
    { x: start.x - offset.x, y: start.y - offset.y },
  ];
}

function generatedFullCircleRadii(currentRadius: number): number[] {
  return [0.6, 0.8, 1, 1.2]
    .map((ratio) => round(currentRadius * ratio))
    .filter((radius, index, radii) => radius > 0 && radii.indexOf(radius) === index);
}

function defaultRadiusSensitivityRadii(importedRadiusMeters: number): number[] {
  return [0.25, 0.4, 0.55, 0.7, 0.85, 1]
    .map((ratio) => round(importedRadiusMeters * ratio));
}

function defaultEndGunThrowSensitivityDistances(importedThrowMeters: number): number[] {
  if (importedThrowMeters > 0) {
    return [0, 0.5, 1, 1.5]
      .map((ratio) => round(importedThrowMeters * ratio));
  }
  return [0, 15, 30, 45];
}

function defaultSweepEfficiencyComparisonRadii(currentRadiusMeters: number): number[] {
  return [0.5, 0.6, 0.7, 0.8, 0.9]
    .map((ratio) => round(currentRadiusMeters * ratio));
}

function normalizeRadiusSensitivityRadii(radiiMeters: number[]): number[] {
  return radiiMeters
    .map((radius) => round(radius))
    .filter((radius) => Number.isFinite(radius) && radius > 0)
    .filter((radius, index, radii) => radii.indexOf(radius) === index);
}

function normalizeEndGunThrowSensitivityDistances(throwDistancesMeters: number[]): number[] {
  return throwDistancesMeters
    .map((throwMeters) => round(throwMeters))
    .filter((throwMeters) => Number.isFinite(throwMeters) && throwMeters >= 0)
    .filter((throwMeters, index, throwDistances) => throwDistances.indexOf(throwMeters) === index);
}

function approximateFullCircleMachine(machine: PivotMachine, radiusMeters: number): PivotMachine {
  const positiveSpans = machine.spanLengthsMeters.filter((span) => Number.isFinite(span) && span > 0);
  const averageSpan = positiveSpans.length > 0
    ? positiveSpans.reduce((sum, span) => sum + span, 0) / positiveSpans.length
    : Math.max(1, radiusMeters);
  const spanCount = Math.max(1, Math.ceil(radiusMeters / Math.max(1, averageSpan)));
  const spanLength = radiusMeters / spanCount;
  return {
    ...machine,
    id: `${machine.id}-full-circle-${radiusMeters.toFixed(2)}`,
    name: `${machine.name} ${radiusMeters.toFixed(0)} m full circle`,
    spanLengthsMeters: Array.from({ length: spanCount }, () => spanLength),
    overhangMeters: 0,
    sweep: { mode: "full_circle" },
    endGunAngleRanges: undefined,
  };
}

function dedupeMachineStrategyInputs(inputs: AdvisoryMachineStrategyInput[]): AdvisoryMachineStrategyInput[] {
  const byKey = new Map<string, AdvisoryMachineStrategyInput>();
  for (const input of inputs) {
    const radius = input.machine ? machineRadiusMeters(input.machine).toFixed(3) : "unsupported";
    const sweep = input.machine ? JSON.stringify(input.machine.sweep) : input.strategyKind;
    const key = `${input.strategyKind}:${input.pathFeatureId ?? "no-path"}:${input.secondPivotPointId ?? "no-second-pivot"}:${radius}:${sweep}`;
    if (!byKey.has(key)) byKey.set(key, input);
  }
  return [...byKey.values()];
}

function mergeSourceRefs(
  primary: AdvisorySourceReference[],
  secondary: AdvisorySourceReference[],
): AdvisorySourceReference[] {
  const byKey = new Map<string, AdvisorySourceReference>();
  for (const sourceRef of [...primary, ...secondary]) {
    const key = `${sourceRef.sourceId}:${sourceRef.guideId ?? ""}:${sourceRef.page ?? ""}:${sourceRef.lineRange ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, sourceRef);
  }
  return [...byKey.values()];
}

function compareMachineStrategyResults(left: AdvisoryMachineStrategyResult, right: AdvisoryMachineStrategyResult): number {
  if (left.status !== right.status) return strategyStatusRank(left.status) - strategyStatusRank(right.status);
  if (right.advisoryScore !== left.advisoryScore) return right.advisoryScore - left.advisoryScore;
  if (right.irrigatedAcres !== left.irrigatedAcres) return right.irrigatedAcres - left.irrigatedAcres;
  return left.label.localeCompare(right.label);
}

function strategyStatusRank(status: AdvisoryMachineStrategyStatus): number {
  if (status === "ready") return 0;
  if (status === "no_feasible_candidate") return 1;
  return 2;
}

function firstCostStatus(
  strategies: AdvisoryMachineStrategyResult[],
  input: AdvisoryCostInput | undefined,
): AdvisoryCostAssessment["status"] {
  const status = strategies.find((strategy) => strategy.costAssessment)?.costAssessment?.status;
  if (status) return status;
  return costInputStatusForInput(input);
}

function costInputStatusForInput(input: AdvisoryCostInput | undefined): AdvisoryCostAssessment["status"] {
  if (!input) return "missing_cost_input";
  const fixedMachineCost = input.fixedMachineCost ?? 0;
  const costPerMeter = input.costPerMeter ?? 0;
  const costPerTower = input.costPerTower ?? 0;
  if (
    !Number.isFinite(fixedMachineCost)
    || !Number.isFinite(costPerMeter)
    || !Number.isFinite(costPerTower)
    || fixedMachineCost < 0
    || costPerMeter < 0
    || costPerTower < 0
    || fixedMachineCost + costPerMeter + costPerTower <= 0
  ) {
    return "invalid_cost_input";
  }
  return "complete";
}

function dryCornerPolygonsFor(project: PivotProject, allowedCoverage: MultiPolygonXY): MultiPolygonXY {
  return differenceMultiPolygons([[project.fieldBoundary]], allowedCoverage);
}

function maximumInscribedCircleSeed(
  fieldBoundary: XY[],
  gridDivisions: number,
  refinement: PivotPlacementCandidateOptions["maximumInteriorSeedRefinement"],
): { center: XY; radiusMeters: number } {
  const bounds = boundsForGeometry([fieldBoundary]);
  let best = centroid(fieldBoundary);
  let bestDistance = pointInPolygon(best, fieldBoundary) ? distanceToRing(best, fieldBoundary) : -1;
  const passes = [
    { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY, divisions: Math.max(6, gridDivisions) },
    { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY, divisions: Math.max(12, gridDivisions * 2) },
  ];

  for (const pass of passes) {
    const xStep = (pass.maxX - pass.minX) / pass.divisions;
    const yStep = (pass.maxY - pass.minY) / pass.divisions;
    for (let yIndex = 0; yIndex <= pass.divisions; yIndex += 1) {
      for (let xIndex = 0; xIndex <= pass.divisions; xIndex += 1) {
        const point = { x: pass.minX + xStep * xIndex, y: pass.minY + yStep * yIndex };
        if (!pointInPolygon(point, fieldBoundary)) continue;
        const candidateDistance = distanceToRing(point, fieldBoundary);
        if (candidateDistance > bestDistance) {
          best = point;
          bestDistance = candidateDistance;
        }
      }
    }
  }

  if (refinement === "local") {
    const refined = refineMaximumInteriorSeed(fieldBoundary, best, Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / Math.max(8, gridDivisions * 2));
    best = refined.center;
    bestDistance = refined.radiusMeters;
  }

  return { center: best, radiusMeters: Math.max(0, bestDistance) };
}

function refineMaximumInteriorSeed(fieldBoundary: XY[], seed: XY, initialStepMeters: number): { center: XY; radiusMeters: number } {
  let best = seed;
  let bestDistance = pointInPolygon(best, fieldBoundary) ? distanceToRing(best, fieldBoundary) : -1;
  let step = Math.max(0.25, initialStepMeters);
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ];

  for (let iteration = 0; iteration < 18 && step >= 0.05; iteration += 1) {
    let improved = false;
    for (const direction of directions) {
      const length = Math.hypot(direction.x, direction.y);
      const candidate = {
        x: best.x + (direction.x / length) * step,
        y: best.y + (direction.y / length) * step,
      };
      if (!pointInPolygon(candidate, fieldBoundary)) continue;
      const candidateDistance = distanceToRing(candidate, fieldBoundary);
      if (candidateDistance > bestDistance) {
        best = candidate;
        bestDistance = candidateDistance;
        improved = true;
      }
    }
    if (!improved) step /= 2;
  }

  return { center: best, radiusMeters: Math.max(0, bestDistance) };
}

function maxObstacleBuffer(project: PivotProject): number {
  return project.obstacles.reduce((max, obstacle) => Math.max(max, obstacle.bufferMeters), 0);
}

function minimumObstacleClearance(point: XY, project: PivotProject, additionalBufferMeters: number): number | null {
  if (project.obstacles.length === 0) return null;
  return project.obstacles.reduce((minimum, obstacle) => {
    const clearance = distanceToRing(point, obstacle.polygon) - obstacle.bufferMeters - additionalBufferMeters;
    return Math.min(minimum, clearance);
  }, Number.POSITIVE_INFINITY);
}

function matchingCrossingProfileIds(
  project: PivotProject,
  profiles: AdvisoryObstacleCrossingProfile[],
): string[] {
  const obstacleIds = new Set(project.obstacles.map((obstacle) => obstacle.id));
  return profiles
    .filter((profile) => profile.advisoryOnly === true && obstacleIds.has(profile.obstacleId))
    .map((profile) => profile.obstacleId);
}

function obstacleInteractionFromObstacle(
  project: PivotProject,
  obstacle: ObstacleZone,
  sourceRefs: AdvisorySourceReference[],
  profiles: AdvisoryObstacleCrossingProfile[],
): AdvisoryObstacleInteractionItem {
  const representativePoint = centroid(obstacle.polygon);
  const towerReview = towerReviewForPoint(project, representativePoint);
  const envelope = machineEnvelopeFor(project, project.pivotCenter);
  const inMachineReach = multiPolygonAreaSquareMeters(intersectMultiPolygons(envelope, [[obstacle.polygon]])) > 0.000001;
  const baseCategory = obstacleInteractionCategoryForObstacle(obstacle, inMachineReach);
  const crossingProfileReview = crossingProfileReviewForItem(
    obstacle.id,
    profiles,
    baseCategory,
    inMachineReach,
    towerReview,
    sourceRefs,
  );
  const category = obstacleInteractionCategoryWithProfile(baseCategory, crossingProfileReview, inMachineReach);
  const crossingReviewRequired = category !== "outside_machine_reach" && (
    category === "span_clearance_review"
    || category === "tower_track_review"
    || category === "utility_path_review"
  );
  const itemSourceRefs = crossingProfileReview
    ? mergeSourceRefs(sourceRefs, crossingProfileReview.sourceRefs)
    : sourceRefs;

  return {
    id: obstacle.id,
    name: obstacle.name,
    evidenceType: "obstacle_polygon",
    obstacleKind: obstacle.kind,
    category,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    inMachineReach,
    crossingReviewRequired,
    distanceToPivotMeters: round(distance(project.pivotCenter, representativePoint)),
    nearestTowerIndex: towerReview.nearestTowerIndex,
    nearestTowerTrackDistanceMeters: towerReview.nearestTowerTrackDistanceMeters,
    spanIndex: towerReview.spanIndex,
    crossingProfileReview,
    warnings: [
      ...obstacleInteractionWarnings(category, obstacle.name, obstacle.kind),
      ...(crossingProfileReview?.warnings ?? []),
    ],
    sourceRefs: itemSourceRefs,
  };
}

function obstacleInteractionFromMapFeature(
  project: PivotProject,
  feature: ProjectMapFeature,
  sourceRefs: AdvisorySourceReference[],
  profiles: AdvisoryObstacleCrossingProfile[],
): AdvisoryObstacleInteractionItem {
  const representativePoint = representativePointForMapFeature(feature);
  const towerReview = representativePoint ? towerReviewForPoint(project, representativePoint) : null;
  const inMachineReach = mapFeatureTouchesMachineReach(project, feature);
  const baseCategory = obstacleInteractionCategoryForMapFeature(feature, inMachineReach, towerReview);
  const crossingProfileReview = crossingProfileReviewForItem(
    feature.id,
    profiles,
    baseCategory,
    inMachineReach,
    towerReview,
    sourceRefs,
  );
  const category = obstacleInteractionCategoryWithProfile(baseCategory, crossingProfileReview, inMachineReach);
  const crossingReviewRequired = category !== "outside_machine_reach" && category !== "hard_blocking";
  const itemSourceRefs = crossingProfileReview
    ? mergeSourceRefs(sourceRefs, crossingProfileReview.sourceRefs)
    : sourceRefs;

  return {
    id: feature.id,
    name: feature.name,
    evidenceType: feature.geometry.type === "Point" || feature.geometry.type === "Circle" ? "utility_point" : "utility_path",
    featureKind: feature.kind,
    category,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    inMachineReach,
    crossingReviewRequired,
    distanceToPivotMeters: representativePoint ? round(distance(project.pivotCenter, representativePoint)) : null,
    nearestTowerIndex: towerReview?.nearestTowerIndex ?? null,
    nearestTowerTrackDistanceMeters: towerReview?.nearestTowerTrackDistanceMeters ?? null,
    spanIndex: towerReview?.spanIndex ?? null,
    crossingProfileReview,
    warnings: [
      ...obstacleInteractionWarnings(category, feature.name, feature.kind),
      ...(crossingProfileReview?.warnings ?? []),
    ],
    sourceRefs: itemSourceRefs,
  };
}

function crossingProfileReviewForItem(
  itemId: string,
  profiles: AdvisoryObstacleCrossingProfile[],
  baseCategory: AdvisoryObstacleInteractionCategory,
  inMachineReach: boolean,
  towerReview: TowerReview | null,
  defaultSourceRefs: AdvisorySourceReference[],
): AdvisoryObstacleCrossingProfileReview | null {
  const profile = profiles.find((candidate) => (
    candidate.advisoryOnly === true
    && (candidate.obstacleId === itemId || candidate.evidenceId === itemId)
  ));
  if (!profile) return null;

  const profileId = profile.evidenceId ?? profile.obstacleId;
  const sourceRefs = profile.sourceRefs ?? defaultSourceRefs;
  const minimumClearanceMeters = profile.minimumClearanceMeters === undefined
    ? null
    : Number.isFinite(profile.minimumClearanceMeters)
      ? Math.max(0, profile.minimumClearanceMeters)
      : null;
  const observedTowerTrackClearanceMeters = towerReview?.nearestTowerTrackDistanceMeters ?? null;
  const isHardBlocking = baseCategory === "hard_blocking";
  const clearanceSatisfied = profile.crossingAllowed && minimumClearanceMeters !== null && observedTowerTrackClearanceMeters !== null
    ? observedTowerTrackClearanceMeters >= minimumClearanceMeters
    : null;
  const status = crossingProfileStatus({
    crossingAllowed: profile.crossingAllowed,
    inMachineReach,
    isHardBlocking,
    minimumClearanceMeters,
    observedTowerTrackClearanceMeters,
    clearanceSatisfied,
  });
  const warnings = crossingProfileWarnings({
    profileId,
    status,
    crossingAllowed: profile.crossingAllowed,
    minimumClearanceMeters,
    observedTowerTrackClearanceMeters,
    clearanceSatisfied,
    reason: profile.reason,
  });

  return {
    profileId,
    crossingAllowed: profile.crossingAllowed,
    status,
    advisoryOnly: true,
    canonicalGeometryMutation: false,
    qualifiedReviewRequired: true,
    minimumClearanceMeters: minimumClearanceMeters === null ? null : round(minimumClearanceMeters),
    observedTowerTrackClearanceMeters: observedTowerTrackClearanceMeters === null ? null : round(observedTowerTrackClearanceMeters),
    clearanceSatisfied,
    reason: profile.reason,
    warnings,
    sourceRefs,
  };
}

function crossingProfileStatus(input: {
  crossingAllowed: boolean;
  inMachineReach: boolean;
  isHardBlocking: boolean;
  minimumClearanceMeters: number | null;
  observedTowerTrackClearanceMeters: number | null;
  clearanceSatisfied: boolean | null;
}): AdvisoryObstacleCrossingProfileStatus {
  if (!input.crossingAllowed) return "blocked_profile";
  if (input.isHardBlocking) return "hard_blocking_profile_not_applied";
  if (!input.inMachineReach || input.minimumClearanceMeters === null) return "allowed_profile";
  if (input.observedTowerTrackClearanceMeters === null) return "allowed_profile_clearance_unverified";
  return input.clearanceSatisfied ? "allowed_profile_clearance_met" : "allowed_profile_clearance_shortfall";
}

function crossingProfileWarnings(input: {
  profileId: string;
  status: AdvisoryObstacleCrossingProfileStatus;
  crossingAllowed: boolean;
  minimumClearanceMeters: number | null;
  observedTowerTrackClearanceMeters: number | null;
  clearanceSatisfied: boolean | null;
  reason: string;
}): string[] {
  const base = [
    `Crossing profile ${input.profileId}: ${input.reason}`,
    "Crossing profile is advisory only; it does not change obstacle settings, machine settings, layout metrics, storage, or canonical projected XY.",
  ];
  if (input.status === "blocked_profile") {
    return [...base, "Operator/source profile marks this item as not crossable for advisory review."];
  }
  if (input.status === "hard_blocking_profile_not_applied") {
    return [...base, "Allowed crossing profile was not applied because the item is still categorized as hard-blocking."];
  }
  if (input.status === "allowed_profile_clearance_met") {
    return [...base, `Profile minimum tower-track clearance ${input.minimumClearanceMeters?.toFixed(2)} m is met by modeled horizontal clearance ${input.observedTowerTrackClearanceMeters?.toFixed(2)} m.`];
  }
  if (input.status === "allowed_profile_clearance_shortfall") {
    return [...base, `Profile minimum tower-track clearance ${input.minimumClearanceMeters?.toFixed(2)} m is not met by modeled horizontal clearance ${input.observedTowerTrackClearanceMeters?.toFixed(2)} m.`];
  }
  if (input.status === "allowed_profile_clearance_unverified") {
    return [...base, "Profile includes a minimum clearance, but modeled tower-track clearance could not be computed."];
  }
  return [...base, "Profile permits crossing review, but qualified field/vendor review remains required."];
}

function obstacleInteractionCategoryWithProfile(
  baseCategory: AdvisoryObstacleInteractionCategory,
  crossingProfileReview: AdvisoryObstacleCrossingProfileReview | null,
  inMachineReach: boolean,
): AdvisoryObstacleInteractionCategory {
  if (!inMachineReach || !crossingProfileReview) return baseCategory;
  if (crossingProfileReview.status === "blocked_profile") return "hard_blocking";
  return baseCategory;
}

function obstacleInteractionCategoryForObstacle(
  obstacle: ObstacleZone,
  inMachineReach: boolean,
): AdvisoryObstacleInteractionCategory {
  if (!inMachineReach) return "outside_machine_reach";
  if (obstacle.hardConflict || obstacle.kind === "building" || obstacle.kind === "tree" || obstacle.kind === "exclusion") {
    return "hard_blocking";
  }
  if (obstacle.noSpray) return "no_spray_exclusion";
  return "span_clearance_review";
}

function obstacleInteractionCategoryForMapFeature(
  feature: ProjectMapFeature,
  inMachineReach: boolean,
  towerReview: TowerReview | null,
): AdvisoryObstacleInteractionCategory {
  if (!inMachineReach) return "outside_machine_reach";
  if (feature.kind === "power_pole" || feature.kind === "tree") return "hard_blocking";
  if (
    feature.kind === "underground_pipeline"
    || feature.kind === "underground_wire"
    || feature.kind === "power_line"
    || feature.kind === "access_lane"
    || feature.kind === "ditch"
    || feature.kind === "canal"
    || feature.kind === "fence"
    || feature.kind === "road"
  ) {
    return "utility_path_review";
  }
  if (
    towerReview
    && towerReview.nearestTowerTrackDistanceMeters !== null
    && towerReview.nearestTowerTrackDistanceMeters <= towerReview.towerClearanceBufferMeters
  ) {
    return "tower_track_review";
  }
  return "span_clearance_review";
}

function obstacleInteractionWarnings(
  category: AdvisoryObstacleInteractionCategory,
  name: string,
  kind: string,
): string[] {
  if (category === "outside_machine_reach") {
    return [`${name} is outside the current machine reach; keep it as site evidence for future machine or zone changes.`];
  }
  if (category === "hard_blocking") {
    return [`${name} (${kind}) is treated as a hard blocking review item and should not be assumed crossable by span clearance.`];
  }
  if (category === "no_spray_exclusion") {
    return [`${name} remains a no-spray exclusion in modeled wet coverage; crossing feasibility needs separate review.`];
  }
  if (category === "tower_track_review") {
    return [`${name} is near a modeled tower track; span-over clearance cannot be assumed.`];
  }
  if (category === "utility_path_review") {
    return [`${name} (${kind}) is utility/path evidence inside machine reach; verify burial, height, crossing, and access constraints before treating it as passable.`];
  }
  return [`${name} is inside machine reach but away from modeled tower tracks; span-over clearance remains advisory and requires qualified review.`];
}

function summarizeObstacleInteractions(items: AdvisoryObstacleInteractionItem[]): AdvisoryObstacleInteractionSummary {
  const profileReviews = items
    .map((item) => item.crossingProfileReview)
    .filter((review): review is AdvisoryObstacleCrossingProfileReview => Boolean(review));
  return {
    hardBlockingCount: items.filter((item) => item.category === "hard_blocking").length,
    noSprayExclusionCount: items.filter((item) => item.category === "no_spray_exclusion").length,
    spanClearanceReviewCount: items.filter((item) => item.category === "span_clearance_review").length,
    towerTrackReviewCount: items.filter((item) => item.category === "tower_track_review").length,
    utilityPathReviewCount: items.filter((item) => item.category === "utility_path_review").length,
    outsideMachineReachCount: items.filter((item) => item.category === "outside_machine_reach").length,
    profiledItemCount: profileReviews.length,
    profileAllowedCount: profileReviews.filter((review) => review.crossingAllowed).length,
    profileBlockedCount: profileReviews.filter((review) => !review.crossingAllowed).length,
    profileClearanceShortfallCount: profileReviews.filter((review) => review.status === "allowed_profile_clearance_shortfall").length,
  };
}

function compareObstacleInteractionItems(left: AdvisoryObstacleInteractionItem, right: AdvisoryObstacleInteractionItem): number {
  const rankDelta = obstacleInteractionRank(left.category) - obstacleInteractionRank(right.category);
  if (rankDelta !== 0) return rankDelta;
  return left.name.localeCompare(right.name);
}

function obstacleInteractionRank(category: AdvisoryObstacleInteractionCategory): number {
  if (category === "hard_blocking") return 0;
  if (category === "tower_track_review") return 1;
  if (category === "no_spray_exclusion") return 2;
  if (category === "utility_path_review") return 3;
  if (category === "span_clearance_review") return 4;
  return 5;
}

function distanceToAccess(point: XY, project: PivotProject): number | null {
  const candidates: number[] = [];
  for (const obstacle of project.obstacles) {
    if (obstacle.kind === "road") candidates.push(distanceToRing(point, obstacle.polygon));
  }
  for (const feature of project.mapFeatures ?? []) {
    if (feature.kind !== "access_lane" && feature.kind !== "road") continue;
    candidates.push(distanceToMapFeature(point, feature));
  }
  const finite = candidates.filter(Number.isFinite);
  return finite.length > 0 ? Math.min(...finite) : null;
}

function distanceToMapFeature(point: XY, feature: ProjectMapFeature): number {
  if (feature.geometry.type === "Point") return distance(point, feature.geometry.point);
  if (feature.geometry.type === "Circle") return Math.abs(distance(point, feature.geometry.center) - feature.geometry.radiusMeters);
  const vertices = feature.geometry.vertices;
  if (feature.geometry.type === "Polygon") return distanceToRing(point, vertices);
  return distanceToLineString(point, vertices);
}

function isObstacleInteractionMapFeature(feature: ProjectMapFeature): boolean {
  return feature.kind === "well_location"
    || feature.kind === "pump_location"
    || feature.kind === "underground_pipeline"
    || feature.kind === "underground_wire"
    || feature.kind === "power_pole"
    || feature.kind === "power_line"
    || feature.kind === "tree"
    || feature.kind === "road"
    || feature.kind === "access_lane"
    || feature.kind === "ditch"
    || feature.kind === "canal"
    || feature.kind === "fence";
}

function representativePointForMapFeature(feature: ProjectMapFeature): XY | null {
  if (feature.geometry.type === "Point") return feature.geometry.point;
  if (feature.geometry.type === "Circle") return feature.geometry.center;
  if (feature.geometry.vertices.length === 0) return null;
  return centroid(feature.geometry.vertices);
}

function mapFeatureTouchesMachineReach(project: PivotProject, feature: ProjectMapFeature): boolean {
  const radiusMeters = machineRadiusMeters(project.machine);
  if (radiusMeters <= 0) return false;
  if (feature.geometry.type === "Point") return pointInMachineReach(project, feature.geometry.point, radiusMeters);
  if (feature.geometry.type === "Circle") {
    return distance(project.pivotCenter, feature.geometry.center) - feature.geometry.radiusMeters <= radiusMeters
      && sweepContainsPoint(project, feature.geometry.center);
  }
  if (feature.geometry.type === "Polygon") {
    return multiPolygonAreaSquareMeters(intersectMultiPolygons(machineEnvelopeFor(project, project.pivotCenter), [[feature.geometry.vertices]])) > 0.000001;
  }
  return feature.geometry.vertices.some((point) => pointInMachineReach(project, point, radiusMeters))
    || distanceToLineString(project.pivotCenter, feature.geometry.vertices) <= radiusMeters;
}

function pointInMachineReach(project: PivotProject, point: XY, radiusMeters = machineRadiusMeters(project.machine)): boolean {
  return distance(project.pivotCenter, point) <= radiusMeters && sweepContainsPoint(project, point);
}

function sweepContainsPoint(project: PivotProject, point: XY): boolean {
  if (project.machine.sweep.mode === "full_circle") return true;
  const angle = angleDegrees(project.pivotCenter, point);
  const start = normalizeDegrees(project.machine.sweep.startAngleDegrees);
  const stop = normalizeDegrees(project.machine.sweep.stopAngleDegrees);
  if (project.machine.sweep.direction === "counterclockwise") {
    return normalizeDegrees(angle - start) <= normalizeDegrees(stop - start);
  }
  return normalizeDegrees(start - angle) <= normalizeDegrees(start - stop);
}

function towerReviewForPoint(project: PivotProject, point: XY): TowerReview {
  const radialDistance = distance(project.pivotCenter, point);
  let towerRadius = 0;
  let nearestTowerIndex: number | null = null;
  let nearestTowerTrackDistanceMeters: number | null = null;
  let spanIndex: number | null = null;

  project.machine.spanLengthsMeters.forEach((spanLength, index) => {
    towerRadius += spanLength;
    const trackDistance = Math.abs(radialDistance - towerRadius);
    if (nearestTowerTrackDistanceMeters === null || trackDistance < nearestTowerTrackDistanceMeters) {
      nearestTowerIndex = index + 1;
      nearestTowerTrackDistanceMeters = round(trackDistance);
    }
    if (spanIndex === null && radialDistance <= towerRadius) {
      spanIndex = index + 1;
    }
  });

  return {
    nearestTowerIndex,
    nearestTowerTrackDistanceMeters,
    spanIndex,
    towerClearanceBufferMeters: Math.max(0, project.machine.towerClearanceBufferMeters),
  };
}

function mapFeatureBoundary(feature: ProjectMapFeature): XY[] | null {
  if (feature.geometry.type === "Polygon") return feature.geometry.vertices;
  if (feature.geometry.type === "Circle") return createCirclePolygon(feature.geometry.center, feature.geometry.radiusMeters, 96);
  if (feature.geometry.type === "LineString" && feature.geometry.vertices.length >= 3) return feature.geometry.vertices;
  return null;
}

function distanceToLineString(point: XY, vertices: XY[]): number {
  if (vertices.length === 0) return Number.POSITIVE_INFINITY;
  if (vertices.length === 1) return distance(point, vertices[0]);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length - 1; index += 1) {
    minimum = Math.min(minimum, distanceToSegment(point, vertices[index], vertices[index + 1]));
  }
  return minimum;
}

function cornerSwingEvidence(project: PivotProject): { ids: string[]; multiPolygon: MultiPolygonXY } {
  const features = (project.mapFeatures ?? []).filter((feature) => feature.kind === "corner_swing_limit");
  return {
    ids: features.map((feature) => feature.id),
    multiPolygon: features.flatMap((feature): MultiPolygonXY => {
      if (feature.geometry.type === "Polygon") return [[feature.geometry.vertices]];
      if (feature.geometry.type === "Circle") return [[createCirclePolygon(feature.geometry.center, feature.geometry.radiusMeters, 96)]];
      if (feature.geometry.type === "LineString" && feature.geometry.vertices.length >= 3) return [[feature.geometry.vertices]];
      return [];
    }),
  };
}

function proximityScore(distanceMeters: number, diagonalMeters: number, weight: number): number {
  return Math.max(0, 1 - distanceMeters / Math.max(1, diagonalMeters)) * Math.max(0, weight);
}

function dedupePlacementCandidates(candidates: PivotPlacementCandidate[]): PivotPlacementCandidate[] {
  const byPoint = new Map<string, PivotPlacementCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.pivotCenter.x.toFixed(3)},${candidate.pivotCenter.y.toFixed(3)}`;
    const current = byPoint.get(key);
    if (!current || comparePlacementCandidates(candidate, current) < 0) byPoint.set(key, candidate);
  }
  return [...byPoint.values()];
}

function comparePlacementCandidates(left: PivotPlacementCandidate, right: PivotPlacementCandidate): number {
  if (left.feasible !== right.feasible) return left.feasible ? -1 : 1;
  if (right.score !== left.score) return right.score - left.score;
  if (right.metrics.irrigatedAcres !== left.metrics.irrigatedAcres) return right.metrics.irrigatedAcres - left.metrics.irrigatedAcres;
  return left.id.localeCompare(right.id);
}

function intersectMultiPolygons(left: MultiPolygonXY, right: MultiPolygonXY): MultiPolygonXY {
  if (left.length === 0 || right.length === 0) return [];
  return fromClipMultiPolygon(polygonClipping.intersection(toClipMultiPolygon(left), toClipMultiPolygon(right)) as ClipMultiPolygon | null);
}

function differenceMultiPolygons(left: MultiPolygonXY, right: MultiPolygonXY): MultiPolygonXY {
  if (left.length === 0) return [];
  if (right.length === 0) return left;
  try {
    return fromClipMultiPolygon(polygonClipping.difference(toClipMultiPolygon(left), toClipMultiPolygon(right)) as ClipMultiPolygon | null);
  } catch (error) {
    const snappedLeft = toClipMultiPolygon(left, true);
    const snappedRight = toClipMultiPolygon(right, true);
    try {
      return fromClipMultiPolygon(polygonClipping.difference(snappedLeft, snappedRight) as ClipMultiPolygon | null);
    } catch {
      throw error;
    }
  }
}

function unionMultiPolygons(multiPolygon: MultiPolygonXY): MultiPolygonXY {
  if (multiPolygon.length === 0) return [];
  return fromClipMultiPolygon(polygonClipping.union(toClipMultiPolygon(multiPolygon)) as ClipMultiPolygon | null);
}

function toClipMultiPolygon(multiPolygon: MultiPolygonXY, snap = false): ClipMultiPolygon {
  return multiPolygon.map((polygon) => polygon.map((ring) => closeRing(ring).map((point) => [
    snap ? snapClipCoordinate(point.x) : point.x,
    snap ? snapClipCoordinate(point.y) : point.y,
  ] as ClipPosition)));
}

function fromClipMultiPolygon(multiPolygon: ClipMultiPolygon | null): MultiPolygonXY {
  if (!multiPolygon) return [];
  return multiPolygon.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => ({ x, y }))));
}

function closeRing(ring: XY[]): XY[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first.x === last.x && first.y === last.y ? ring : [...ring, first];
}

function snapClipCoordinate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function centroid(ring: XY[]): XY {
  if (ring.length === 0) return { x: 0, y: 0 };
  const total = ring.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / ring.length, y: total.y / ring.length };
}

function pointInPolygon(point: XY, ring: XY[]): boolean {
  let inside = false;
  for (let currentIndex = 0, previousIndex = ring.length - 1; currentIndex < ring.length; previousIndex = currentIndex, currentIndex += 1) {
    const current = ring[currentIndex];
    const previous = ring[previousIndex];
    if (pointOnSegment(point, previous, current)) return true;
    const intersects = ((current.y > point.y) !== (previous.y > point.y))
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInMultiPolygon(point: XY, multiPolygon: MultiPolygonXY): boolean {
  return multiPolygon.some((polygon) => polygon.some((ring) => pointInPolygon(point, ring)));
}

function pointOnSegment(point: XY, start: XY, end: XY): boolean {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 0.000001) return false;
  const dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
  if (dot < 0) return false;
  const segmentLengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= segmentLengthSquared;
}

function distanceToRing(point: XY, ring: XY[]): number {
  return ring.reduce((minimum, start, index) => {
    const end = ring[(index + 1) % ring.length];
    return Math.min(minimum, distanceToSegment(point, start, end));
  }, Number.POSITIVE_INFINITY);
}

function distanceToSegment(point: XY, start: XY, end: XY): number {
  const segmentLengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (segmentLengthSquared === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / segmentLengthSquared));
  return distance(point, {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  });
}

function distance(left: XY, right: XY): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function angleDegrees(center: XY, point: XY): number {
  return normalizeDegrees((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI);
}

function normalizeDegrees(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
