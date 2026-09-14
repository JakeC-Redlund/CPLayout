import type { LayoutResult, PivotProject, XY } from "@cplayout/core";
import { qualifyProjectCrs } from "@cplayout/core";

import { endGunRadiusMeters } from "./geometry";

export interface CenterPivotProofValidationOptions {
  minBoundaryVertices?: number;
  maxBoundaryCircularity?: number;
  radiusToleranceMeters?: number;
  radialToleranceDegrees?: number;
}

const DEFAULT_OPTIONS: Required<CenterPivotProofValidationOptions> = {
  minBoundaryVertices: 4,
  maxBoundaryCircularity: 0.9,
  radiusToleranceMeters: 0.75,
  radialToleranceDegrees: 0.1,
};

export function validateCenterPivotProofGeometry(
  project: PivotProject,
  result: LayoutResult,
  options: CenterPivotProofValidationOptions = {},
): string[] {
  const qualification = qualifyProjectCrs(project.projectCrs);
  if (!qualification.calculation.allowed) {
    return [`Metric planar calculations unavailable: ${qualification.calculation.blockers.join(", ")}.`];
  }
  const effectiveOptions = { ...DEFAULT_OPTIONS, ...options };
  const errors: string[] = [];
  const endGunRadius = endGunRadiusMeters(project.machine);

  if (project.fieldBoundary.length < effectiveOptions.minBoundaryVertices) {
    errors.push(`Field boundary needs at least ${effectiveOptions.minBoundaryVertices} vertices for visual center-pivot proof.`);
  }
  if (!pointInPolygon(project.pivotCenter, project.fieldBoundary)) {
    errors.push("Pivot center must be inside the field boundary.");
  }

  const minimumBoundaryDistance = minimumDistanceToPolygonEdge(project.pivotCenter, project.fieldBoundary);
  if (minimumBoundaryDistance + effectiveOptions.radiusToleranceMeters < endGunRadius) {
    errors.push("Field boundary must contain the modeled wet radius including end gun throw.");
  }
  const boundaryCircularity = polygonCircularity(project.fieldBoundary);
  if (boundaryCircularity > effectiveOptions.maxBoundaryCircularity) {
    errors.push("Field boundary must be an imagery-inferred field outline polygon, not a circular pivot coverage ring.");
  }

  if (result.baseCoverage.length === 0) errors.push("Layout result must include base pivot coverage.");
  if (result.allowedCoverage.length === 0) errors.push("Layout result must include allowed irrigated coverage.");
  if (project.machine.endGunThrowMeters > 0 && result.endGunCoverage.length === 0) {
    errors.push("Layout result must include end-gun coverage when end gun throw is configured.");
  }

  if (result.towers.length !== project.machine.spanLengthsMeters.length) {
    errors.push("Tower count must match the machine span count.");
  }
  const towerErrors = towerRadialErrors(project, result, effectiveOptions);
  errors.push(...towerErrors);

  if (project.obstacles.length === 0) {
    errors.push("Proof project needs at least one named obstacle or setback.");
  }
  for (const obstacle of project.obstacles) {
    if (!obstacle.name.trim()) errors.push(`Obstacle ${obstacle.id} must have a visible name.`);
    if (obstacle.polygon.length < 4) errors.push(`Obstacle ${obstacle.name} must be a polygonal area, not a triangle proof marker.`);
  }

  return errors;
}

export function assertCenterPivotProofGeometry(
  project: PivotProject,
  result: LayoutResult,
  options: CenterPivotProofValidationOptions = {},
): void {
  const errors = validateCenterPivotProofGeometry(project, result, options);
  if (errors.length > 0) {
    throw new Error(`Center-pivot proof geometry failed validation: ${errors.join(" ")}`);
  }
}

function towerRadialErrors(
  project: PivotProject,
  result: LayoutResult,
  options: Required<CenterPivotProofValidationOptions>,
): string[] {
  const errors: string[] = [];
  let expectedRadius = 0;
  const angles: number[] = [];
  for (const [index, tower] of result.towers.entries()) {
    expectedRadius += project.machine.spanLengthsMeters[index] ?? 0;
    const actualRadius = distance(project.pivotCenter, tower.point);
    if (Math.abs(actualRadius - expectedRadius) > options.radiusToleranceMeters) {
      errors.push(`Tower ${tower.towerIndex} radius does not match cumulative span length.`);
    }
    angles.push(angleDegrees(project.pivotCenter, tower.point));
  }
  if (angles.length > 1) {
    const first = angles[0];
    const maxDelta = Math.max(...angles.slice(1).map((angle) => Math.abs(shortestAngleDelta(first, angle))));
    if (maxDelta > options.radialToleranceDegrees) {
      errors.push("Tower points must sit on one radial from the pivot center.");
    }
  }
  return errors;
}

function distance(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function angleDegrees(origin: XY, point: XY): number {
  return normalizeDegrees((Math.atan2(point.y - origin.y, point.x - origin.x) * 180) / Math.PI);
}

function shortestAngleDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function pointInPolygon(point: XY, polygon: XY[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects = ((current.y > point.y) !== (previous.y > point.y))
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function minimumDistanceToPolygonEdge(point: XY, polygon: XY[]): number {
  if (polygon.length < 2) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    minimum = Math.min(minimum, distanceToSegment(point, start, end));
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function distanceToSegment(point: XY, start: XY, end: XY): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function polygonCircularity(polygon: XY[]): number {
  const area = Math.abs(signedArea(polygon));
  const perimeter = polygonPerimeter(polygon);
  if (area === 0 || perimeter === 0) return 1;
  return (4 * Math.PI * area) / (perimeter * perimeter);
}

function signedArea(polygon: XY[]): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function polygonPerimeter(polygon: XY[]): number {
  let perimeter = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    perimeter += distance(polygon[index], polygon[(index + 1) % polygon.length]);
  }
  return perimeter;
}
