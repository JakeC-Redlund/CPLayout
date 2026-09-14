import { assertMetricCalculationCrs } from "@cplayout/core";
import type { LayoutMetrics, PivotAngleRange, PivotProject, PivotSweep, XY } from "@cplayout/core";

import { evaluateLayout } from "./geometry";
import { scoreLayoutAlternative } from "./layoutScoring";
import { optimizePivotCenter } from "./pivotCenterOptimizer";

export type DesignScenarioSource = "current" | "operator_variant" | "deterministic_optimizer" | "advisory_corner_arm";

export interface DesignScenarioPreview {
  id: string;
  label: string;
  source: DesignScenarioSource;
  project: PivotProject;
  metrics: LayoutMetrics;
  score: number;
  feasible: boolean;
  rejectionReasons: string[];
  warnings: string[];
  pivotCenter?: XY;
}

export interface BuildDesignScenarioPreviewOptions {
  includeOptimizedCandidates?: boolean;
  maxOptimizedCandidates?: number;
}

export function buildDesignScenarioPreview(
  project: PivotProject,
  options: BuildDesignScenarioPreviewOptions = {},
): DesignScenarioPreview[] {
  assertMetricCalculationCrs(project.projectCrs);
  const includeOptimizedCandidates = options.includeOptimizedCandidates ?? true;
  const maxOptimizedCandidates = Math.max(0, Math.floor(options.maxOptimizedCandidates ?? 3));
  const scenarios: DesignScenarioPreview[] = [
    scoreScenario("current-layout", "Current layout", "current", project),
    scoreScenario("no-end-gun", "No end gun", "operator_variant", withMachine(project, {
      ...project.machine,
      endGunThrowMeters: 0,
      endGunAngleRanges: [],
    })),
    scoreScenario("end-gun-arc", "End-gun arc", "operator_variant", withMachine(project, {
      ...project.machine,
      endGunAngleRanges: preferredEndGunRanges(project),
    })),
    scoreScenario("sweep-toggle", project.machine.sweep.mode === "full_circle" ? "Partial-circle sweep" : "Full-circle sweep", "operator_variant", withMachine(project, {
      ...project.machine,
      sweep: alternateSweep(project.machine.sweep),
    })),
  ];

  if (includeOptimizedCandidates && maxOptimizedCandidates > 0) {
    scenarios.push(...optimizePivotCenter(project, { maxAlternatives: maxOptimizedCandidates }).map((alternative, index) => ({
      ...scoreScenario(`optimized-pivot-${index + 1}`, `Optimized pivot ${index + 1}`, "deterministic_optimizer", alternative.project),
      pivotCenter: alternative.pivotCenter,
    })));
  }

  if ((project.mapFeatures ?? []).some((feature) => feature.kind === "corner_swing_limit")) {
    const current = evaluateLayout(project);
    scenarios.push({
      id: "corner-arm-advisory-footprint",
      label: "Corner-arm footprint",
      source: "advisory_corner_arm",
      project,
      metrics: current.metrics,
      score: 0,
      feasible: false,
      rejectionReasons: ["Corner-arm footprint is operator/vendor-supplied advisory metadata; manufacturer kinematics are not modeled."],
      warnings: ["Use this footprint for inspection only until vendor-supplied coverage and track geometry are verified."],
    });
  }

  return dedupeScenarios(scenarios).sort((left, right) => {
    if (left.feasible !== right.feasible) return left.feasible ? -1 : 1;
    if (right.score !== left.score) return right.score - left.score;
    return left.label.localeCompare(right.label);
  });
}

function scoreScenario(
  id: string,
  label: string,
  source: DesignScenarioSource,
  project: PivotProject,
): DesignScenarioPreview {
  const ranked = scoreLayoutAlternative({
    id,
    project,
    confidence: source === "current" ? 0.85 : 0.65,
    source: source === "deterministic_optimizer" ? "deterministic" : "operator",
  }, {
    hardBoundary: true,
    maxObstacleConflicts: 0,
    maxOutsideFieldAcres: 0.0001,
    minCoveragePercent: 1,
  });

  return {
    id,
    label,
    source,
    project,
    metrics: ranked.metrics,
    score: ranked.score,
    feasible: ranked.feasible,
    rejectionReasons: ranked.disqualificationReasons,
    warnings: ranked.warnings,
    pivotCenter: project.pivotCenter,
  };
}

function withMachine(project: PivotProject, machine: PivotProject["machine"]): PivotProject {
  return { ...project, machine };
}

function alternateSweep(sweep: PivotSweep): PivotSweep {
  if (sweep.mode === "partial_circle") return { mode: "full_circle" };
  return {
    mode: "partial_circle",
    startAngleDegrees: 210,
    stopAngleDegrees: 35,
    direction: "counterclockwise",
  };
}

function preferredEndGunRanges(project: PivotProject): PivotAngleRange[] {
  const ranges = project.machine.endGunAngleRanges ?? [];
  if (ranges.length > 0) return ranges;
  if (project.machine.sweep.mode === "partial_circle") {
    return [{
      startAngleDegrees: project.machine.sweep.startAngleDegrees,
      stopAngleDegrees: project.machine.sweep.stopAngleDegrees,
      direction: project.machine.sweep.direction,
    }];
  }
  return [{ startAngleDegrees: 0, stopAngleDegrees: 120, direction: "counterclockwise" }];
}

function dedupeScenarios(scenarios: DesignScenarioPreview[]): DesignScenarioPreview[] {
  const seen = new Set<string>();
  return scenarios.filter((scenario) => {
    const key = [
      scenario.project.pivotCenter.x.toFixed(3),
      scenario.project.pivotCenter.y.toFixed(3),
      scenario.project.machine.endGunThrowMeters.toFixed(3),
      JSON.stringify(scenario.project.machine.endGunAngleRanges ?? []),
      JSON.stringify(scenario.project.machine.sweep),
    ].join(":");
    if (seen.has(key) && scenario.source !== "current" && scenario.source !== "advisory_corner_arm") return false;
    seen.add(key);
    return true;
  });
}
