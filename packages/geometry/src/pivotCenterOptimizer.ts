import { assertMetricCalculationCrs } from "@cplayout/core";
import type { PivotProject, XY } from "@cplayout/core";
import { completeCalculation, type Calculation } from "./calculation";

import { DEFAULT_BOUNDARY_EPSILON_SQUARE_METERS, boundsForGeometry } from "./geometry";
import { scoreLayoutAlternative, type RankedLayoutAlternative } from "./layoutScoring";

export interface PivotCenterOptimizerOptions {
  gridDivisions?: number;
  maxAlternatives?: number;
  boundaryEpsilonSquareMeters?: number;
  includeVisualCenterSeed?: boolean;
}

export interface PivotCenterAlternative {
  id: string;
  pivotCenter: XY;
  project: PivotProject;
  metrics: RankedLayoutAlternative["metrics"];
  score: number;
  scoreBreakdown: PivotCenterScoreBreakdown;
  feasible: boolean;
  disqualificationReasons: string[];
  warnings: string[];
  sourceSeed: PivotCenterSeedKind;
  distanceFromCurrentMeters: number;
}

export interface PivotCenterScoreBreakdown {
  [key: string]: number;
  coverage: number;
  outsideField: number;
  obstacle: number;
  distance: number;
  feasibility: number;
}

export type PivotCenterSeedKind = "current" | "centroid" | "visual_center" | "bbox_grid" | "local_refinement";

interface PivotCenterSeed {
  point: XY;
  kind: PivotCenterSeedKind;
}

const DEFAULT_GRID_DIVISIONS = 7;
const DEFAULT_MAX_ALTERNATIVES = 8;

export function optimizePivotCenter(
  project: PivotProject,
  options: PivotCenterOptimizerOptions = {},
): PivotCenterAlternative[] {
  return completeCalculation(optimizePivotCenterSteps(project, options));
}

export function* optimizePivotCenterSteps(
  project: PivotProject,
  options: PivotCenterOptimizerOptions = {},
): Calculation<PivotCenterAlternative[]> {
  assertMetricCalculationCrs(project.projectCrs);
  const gridDivisions = Math.max(2, Math.floor(options.gridDivisions ?? DEFAULT_GRID_DIVISIONS));
  const maxAlternatives = Math.max(1, Math.floor(options.maxAlternatives ?? DEFAULT_MAX_ALTERNATIVES));
  const boundaryEpsilonSquareMeters = options.boundaryEpsilonSquareMeters ?? DEFAULT_BOUNDARY_EPSILON_SQUARE_METERS;
  const seeds = dedupeSeeds([
    { point: project.pivotCenter, kind: "current" },
    { point: polygonCentroid(project.fieldBoundary), kind: "centroid" },
    ...(options.includeVisualCenterSeed === false ? [] : [{ point: approximateVisualCenter(project.fieldBoundary, gridDivisions), kind: "visual_center" as const }]),
    ...generateBoundingBoxGrid(project.fieldBoundary, gridDivisions),
  ]);

  const seedAlternatives: PivotCenterAlternative[] = [];
  for (const [index, seed] of seeds.entries()) {
    const alternative = tryBuildAlternative(project, seed, index, boundaryEpsilonSquareMeters);
    if (alternative) seedAlternatives.push(alternative);
    yield;
  }
  const refinementSeeds = seedAlternatives
    .sort(compareAlternatives)
    .slice(0, Math.max(maxAlternatives, 6));
  const refinedAlternatives: PivotCenterAlternative[] = [];
  for (const [index, alternative] of refinementSeeds.entries()) {
    refinedAlternatives.push(...yield* refineAlternative(project, alternative, index, gridDivisions, boundaryEpsilonSquareMeters));
  }

  return dedupeAlternatives([...seedAlternatives, ...refinedAlternatives])
    .sort(compareAlternatives)
    .slice(0, maxAlternatives);
}

function buildAlternative(
  project: PivotProject,
  seed: PivotCenterSeed,
  index: number,
  boundaryEpsilonSquareMeters: number,
): PivotCenterAlternative {
  const candidateProject: PivotProject = {
    ...project,
    pivotCenter: seed.point,
  };
  const ranked = scoreLayoutAlternative({
    id: candidateId(seed, index),
    project: candidateProject,
    confidence: seed.kind === "current" ? 0.65 : 0.8,
    source: "deterministic",
  }, {
    hardBoundary: true,
    boundaryEpsilonSquareMeters,
    maxOutsideFieldAcres: 0.0001,
    maxObstacleConflicts: 0,
    minCoveragePercent: 1,
  }, {
    coverage: 0.5,
    outsideField: 0.25,
    obstacleConflicts: 0.15,
    machineConstraint: 0.05,
    confidence: 0.05,
  });
  const disqualificationReasons = [
    ...ranked.disqualificationReasons,
    ...(ranked.metrics.obstacleConflictCount > 0 ? ["Obstacle conflicts are hard infeasible for pivot-center alternatives."] : []),
  ];
  const feasible = ranked.feasible && disqualificationReasons.length === 0;
  const scoreBreakdown = scorePivotCenterCandidateBreakdown(
    ranked,
    project.pivotCenter,
    seed.point,
    ranked.metrics.irrigatedAcres,
    feasible,
  );

  return {
    id: ranked.id,
    pivotCenter: seed.point,
    project: candidateProject,
    metrics: ranked.metrics,
    score: totalScore(scoreBreakdown),
    scoreBreakdown,
    feasible,
    disqualificationReasons,
    warnings: ranked.warnings,
    sourceSeed: seed.kind,
    distanceFromCurrentMeters: distance(project.pivotCenter, seed.point),
  };
}

function tryBuildAlternative(
  project: PivotProject,
  seed: PivotCenterSeed,
  index: number,
  boundaryEpsilonSquareMeters: number,
): PivotCenterAlternative | null {
  try {
    return buildAlternative(project, seed, index, boundaryEpsilonSquareMeters);
  } catch {
    return null;
  }
}

function scorePivotCenterCandidateBreakdown(
  ranked: RankedLayoutAlternative,
  current: XY,
  candidate: XY,
  irrigatedAcres: number,
  feasible: boolean,
): PivotCenterScoreBreakdown {
  const coverage = irrigatedAcres;
  const outsideField = -Math.min(45, ranked.metrics.outsideFieldAcres * 12);
  const obstacle = -ranked.metrics.obstacleConflictCount * 18;
  const distancePenalty = -Math.min(25, distance(current, candidate) / 20);
  const feasibility = feasible ? 35 : -65;
  return {
    coverage: Number(coverage.toFixed(6)),
    outsideField: Number(outsideField.toFixed(6)),
    obstacle: Number(obstacle.toFixed(6)),
    distance: Number(distancePenalty.toFixed(6)),
    feasibility,
  };
}

function totalScore(breakdown: PivotCenterScoreBreakdown): number {
  return Number(Object.values(breakdown).reduce((sum, value) => sum + value, 0).toFixed(6));
}

function compareAlternatives(left: PivotCenterAlternative, right: PivotCenterAlternative): number {
  if (left.feasible !== right.feasible) return left.feasible ? -1 : 1;
  if (right.score !== left.score) return right.score - left.score;
  if (right.metrics.irrigatedAcres !== left.metrics.irrigatedAcres) {
    return right.metrics.irrigatedAcres - left.metrics.irrigatedAcres;
  }
  if (left.metrics.obstacleConflictCount !== right.metrics.obstacleConflictCount) {
    return left.metrics.obstacleConflictCount - right.metrics.obstacleConflictCount;
  }
  if (left.distanceFromCurrentMeters !== right.distanceFromCurrentMeters) {
    return left.distanceFromCurrentMeters - right.distanceFromCurrentMeters;
  }
  return left.id.localeCompare(right.id);
}

function generateBoundingBoxGrid(fieldBoundary: XY[], gridDivisions: number): PivotCenterSeed[] {
  const bounds = boundsForGeometry([fieldBoundary]);
  const xStep = (bounds.maxX - bounds.minX) / gridDivisions;
  const yStep = (bounds.maxY - bounds.minY) / gridDivisions;
  const seeds: PivotCenterSeed[] = [];

  for (let yIndex = 0; yIndex <= gridDivisions; yIndex += 1) {
    for (let xIndex = 0; xIndex <= gridDivisions; xIndex += 1) {
      const point = {
        x: bounds.minX + xStep * xIndex,
        y: bounds.minY + yStep * yIndex,
      };
      if (pointInPolygon(point, fieldBoundary) && distanceToRing(point, fieldBoundary) > 0.001) {
        seeds.push({ point, kind: "bbox_grid" });
      }
    }
  }

  return seeds;
}

function* refineAlternative(
  project: PivotProject,
  alternative: PivotCenterAlternative,
  index: number,
  gridDivisions: number,
  boundaryEpsilonSquareMeters: number,
): Calculation<PivotCenterAlternative[]> {
  const bounds = boundsForGeometry([project.fieldBoundary]);
  const step = Math.max(
    1,
    Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / Math.max(8, gridDivisions * 2),
  );
  const offsets = [
    { x: -step, y: 0 },
    { x: step, y: 0 },
    { x: 0, y: -step },
    { x: 0, y: step },
    { x: -step, y: -step },
    { x: step, y: step },
  ];
  const seeds = offsets
    .map((offset, offsetIndex) => ({
      point: {
        x: alternative.pivotCenter.x + offset.x,
        y: alternative.pivotCenter.y + offset.y,
      },
      kind: "local_refinement" as PivotCenterSeedKind,
      index: index * 10 + offsetIndex,
    }))
    .filter((seed) => pointInPolygon(seed.point, project.fieldBoundary) && distanceToRing(seed.point, project.fieldBoundary) > 0.001);
  const candidates: PivotCenterAlternative[] = [];
  for (const seed of seeds) {
    const candidate = tryBuildAlternative(project, seed, seed.index, boundaryEpsilonSquareMeters);
    if (candidate) candidates.push(candidate);
    yield;
  }
  return candidates;
}

function dedupeAlternatives(alternatives: PivotCenterAlternative[]): PivotCenterAlternative[] {
  const byPoint = new Map<string, PivotCenterAlternative>();
  for (const alternative of alternatives) {
    const key = `${alternative.pivotCenter.x.toFixed(4)},${alternative.pivotCenter.y.toFixed(4)}`;
    const current = byPoint.get(key);
    if (!current || compareAlternatives(alternative, current) < 0) byPoint.set(key, alternative);
  }
  return [...byPoint.values()];
}

function approximateVisualCenter(fieldBoundary: XY[], gridDivisions: number): XY {
  let best = polygonCentroid(fieldBoundary);
  let bestDistance = pointInPolygon(best, fieldBoundary) ? distanceToRing(best, fieldBoundary) : -1;
  const bounds = boundsForGeometry([fieldBoundary]);
  const passes = [
    { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY, divisions: Math.max(4, gridDivisions) },
    { minX: best.x - (bounds.maxX - bounds.minX) / gridDivisions, minY: best.y - (bounds.maxY - bounds.minY) / gridDivisions, maxX: best.x + (bounds.maxX - bounds.minX) / gridDivisions, maxY: best.y + (bounds.maxY - bounds.minY) / gridDivisions, divisions: 8 },
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

  return best;
}

function polygonCentroid(ring: XY[]): XY {
  const signedArea = signedPolygonArea(ring);
  if (Math.abs(signedArea) < 0.000001) {
    return averagePoint(ring);
  }

  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    const cross = current.x * next.y - next.x * current.y;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }

  const centroid = {
    x: x / (6 * signedArea),
    y: y / (6 * signedArea),
  };
  return pointInPolygon(centroid, ring) ? centroid : averagePoint(ring);
}

function signedPolygonArea(ring: XY[]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

function averagePoint(points: XY[]): XY {
  if (points.length === 0) return { x: 0, y: 0 };
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function dedupeSeeds(seeds: PivotCenterSeed[]): PivotCenterSeed[] {
  const seen = new Set<string>();
  const unique: PivotCenterSeed[] = [];

  for (const seed of seeds) {
    const key = `${seed.point.x.toFixed(6)},${seed.point.y.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(seed);
  }

  return unique;
}

function candidateId(seed: PivotCenterSeed, index: number): string {
  return `${seed.kind}-${index}-${seed.point.x.toFixed(2)}-${seed.point.y.toFixed(2)}`;
}

function pointInPolygon(point: XY, ring: XY[]): boolean {
  if (ring.some((vertex) => distance(vertex, point) < 0.000001)) return true;

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
