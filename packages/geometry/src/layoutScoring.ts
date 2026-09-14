import { DEFAULT_BOUNDARY_EPSILON_SQUARE_METERS, evaluateLayout, validateWetCoverageWithinField } from "./geometry";
import type { LayoutMetrics, PivotProject } from "@cplayout/core";

export interface LayoutScoreWeights {
  coverage: number;
  outsideField: number;
  obstacleConflicts: number;
  machineConstraint: number;
  confidence: number;
}

export interface LayoutScoreConstraints {
  maxOutsideFieldAcres: number;
  maxObstacleConflicts: number;
  minCoveragePercent: number;
  maxMachineRadiusMeters?: number;
  hardBoundary?: boolean;
  boundaryEpsilonSquareMeters?: number;
}

export interface LayoutAlternative {
  id: string;
  project: PivotProject;
  confidence: number;
  source: "operator" | "deterministic" | "model";
}

export interface LayoutScoreBreakdown {
  coverage: number;
  outsideField: number;
  obstacleConflicts: number;
  machineConstraint: number;
  confidence: number;
}

export interface RankedLayoutAlternative {
  id: string;
  project: PivotProject;
  metrics: LayoutMetrics;
  score: number;
  breakdown: LayoutScoreBreakdown;
  feasible: boolean;
  disqualificationReasons: string[];
  warnings: string[];
  source: LayoutAlternative["source"];
}

const DEFAULT_WEIGHTS: LayoutScoreWeights = {
  coverage: 0.45,
  outsideField: 0.2,
  obstacleConflicts: 0.15,
  machineConstraint: 0.1,
  confidence: 0.1,
};

const DEFAULT_CONSTRAINTS: LayoutScoreConstraints = {
  maxOutsideFieldAcres: 2,
  maxObstacleConflicts: 0,
  minCoveragePercent: 70,
};

export function scoreLayoutAlternative(
  alternative: LayoutAlternative,
  constraints: Partial<LayoutScoreConstraints> = {},
  weights: Partial<LayoutScoreWeights> = {},
): RankedLayoutAlternative {
  const effectiveConstraints = { ...DEFAULT_CONSTRAINTS, ...constraints };
  for (const [name, value] of Object.entries(effectiveConstraints)) {
    if (name === "hardBoundary" || value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new RangeError(`${name} must be finite and nonnegative.`);
    }
  }
  if (effectiveConstraints.minCoveragePercent > 100 || !Number.isInteger(effectiveConstraints.maxObstacleConflicts)) {
    throw new RangeError("Coverage must not exceed 100 percent and obstacle limits must be integers.");
  }
  const effectiveWeights = normalizeWeights({ ...DEFAULT_WEIGHTS, ...weights });
  const result = evaluateLayout(alternative.project);
  const boundary = effectiveConstraints.hardBoundary
    ? validateWetCoverageWithinField(
      alternative.project,
      effectiveConstraints.boundaryEpsilonSquareMeters ?? DEFAULT_BOUNDARY_EPSILON_SQUARE_METERS,
    )
    : null;
  const machineRadius = alternative.project.machine.spanLengthsMeters.reduce((sum, span) => sum + span, 0)
    + alternative.project.machine.overhangMeters;
  const maxMachineRadius = effectiveConstraints.maxMachineRadiusMeters ?? machineRadius;
  const disqualificationReasons: string[] = [];

  if (machineRadius > maxMachineRadius) disqualificationReasons.push("Machine radius exceeds the permitted maximum.");
  if (result.metrics.outsideFieldAcres > effectiveConstraints.maxOutsideFieldAcres) disqualificationReasons.push("Outside-field acreage exceeds the permitted maximum.");
  if (result.metrics.obstacleConflictCount > effectiveConstraints.maxObstacleConflicts) disqualificationReasons.push("Obstacle count exceeds the permitted maximum.");
  if (result.metrics.hardMechanicalConflictCount > 0) disqualificationReasons.push("A hard obstacle intersects the mechanical sweep.");
  if (result.metrics.coveragePercent < effectiveConstraints.minCoveragePercent) disqualificationReasons.push("Coverage is below the required minimum.");
  if (!Number.isFinite(alternative.confidence) || alternative.confidence < 0 || alternative.confidence > 1) {
    disqualificationReasons.push("Alternative confidence must be finite and between zero and one.");
  }

  if (boundary && !boundary.feasible) {
    disqualificationReasons.push(`Wet coverage exceeds field boundary by ${boundary.outsideFieldAreaSquareMeters.toFixed(3)} square meters.`);
  }

  const breakdown: LayoutScoreBreakdown = {
    coverage: clamp01(result.metrics.coveragePercent / Math.max(effectiveConstraints.minCoveragePercent, 1)),
    outsideField: 1 - clamp01(result.metrics.outsideFieldAcres / Math.max(effectiveConstraints.maxOutsideFieldAcres, 0.0001)),
    obstacleConflicts: 1 - clamp01(result.metrics.obstacleConflictCount / Math.max(effectiveConstraints.maxObstacleConflicts || 1, 1)),
    machineConstraint: machineRadius <= maxMachineRadius ? 1 : clamp01(maxMachineRadius / machineRadius),
    confidence: clamp01(alternative.confidence),
  };

  const feasible = disqualificationReasons.length === 0;
  const weightedScore = (
    breakdown.coverage * effectiveWeights.coverage
    + breakdown.outsideField * effectiveWeights.outsideField
    + breakdown.obstacleConflicts * effectiveWeights.obstacleConflicts
    + breakdown.machineConstraint * effectiveWeights.machineConstraint
    + breakdown.confidence * effectiveWeights.confidence
  ) * 100;
  const score = feasible ? weightedScore : 0;

  return {
    id: alternative.id,
    project: alternative.project,
    metrics: result.metrics,
    score,
    breakdown,
    feasible,
    disqualificationReasons,
    warnings: result.warnings,
    source: alternative.source,
  };
}

export function rankLayoutAlternatives(
  alternatives: LayoutAlternative[],
  constraints: Partial<LayoutScoreConstraints> = {},
  weights: Partial<LayoutScoreWeights> = {},
): RankedLayoutAlternative[] {
  return alternatives
    .map((alternative) => scoreLayoutAlternative(alternative, constraints, weights))
    .sort((left, right) => {
      if (left.feasible !== right.feasible) return left.feasible ? -1 : 1;
      if (right.score !== left.score) return right.score - left.score;
      if (right.metrics.coveragePercent !== left.metrics.coveragePercent) {
        return right.metrics.coveragePercent - left.metrics.coveragePercent;
      }
      return left.metrics.outsideFieldAcres - right.metrics.outsideFieldAcres;
    });
}

function normalizeWeights(weights: LayoutScoreWeights): LayoutScoreWeights {
  if (Object.values(weights).some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Score weights must be finite and nonnegative.");
  }
  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return DEFAULT_WEIGHTS;
  return {
    coverage: Math.max(0, weights.coverage) / total,
    outsideField: Math.max(0, weights.outsideField) / total,
    obstacleConflicts: Math.max(0, weights.obstacleConflicts) / total,
    machineConstraint: Math.max(0, weights.machineConstraint) / total,
    confidence: Math.max(0, weights.confidence) / total,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
