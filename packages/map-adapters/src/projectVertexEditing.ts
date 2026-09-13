import type { PivotProject, XY } from "@cplayout/core";

export type SelectedProjectVertex =
  | { layer: "field_boundary"; vertexIndex: number }
  | { layer: "obstacle"; obstacleId: string; vertexIndex: number }
  | { layer: "map_feature"; featureId: string; vertexIndex: number };

export function firstBoundaryVertexSelection(project: PivotProject): SelectedProjectVertex | null {
  if (project.fieldBoundary.length === 0) return null;
  return { layer: "field_boundary", vertexIndex: 0 };
}

export function firstObstacleVertexSelection(project: PivotProject): SelectedProjectVertex | null {
  const obstacle = project.obstacles.find((candidate) => candidate.polygon.length > 0);
  if (!obstacle) return null;
  return { layer: "obstacle", obstacleId: obstacle.id, vertexIndex: 0 };
}

export function hasObstacleVertexSelection(project: PivotProject): boolean {
  return project.obstacles.some((obstacle) => obstacle.polygon.length > 0);
}

export function firstMapFeatureVertexSelection(project: PivotProject): SelectedProjectVertex | null {
  const feature = (project.mapFeatures ?? []).find((candidate) => mapFeatureVertexCount(candidate) > 0);
  if (!feature) return null;
  return { layer: "map_feature", featureId: feature.id, vertexIndex: 0 };
}

export function hasMapFeatureVertexSelection(project: PivotProject): boolean {
  return (project.mapFeatures ?? []).some((feature) => mapFeatureVertexCount(feature) > 0);
}

export function adjacentProjectVertexSelection(
  project: PivotProject,
  selected: SelectedProjectVertex | null,
  direction: -1 | 1,
): SelectedProjectVertex | null {
  if (!selected) return firstBoundaryVertexSelection(project) ?? firstObstacleVertexSelection(project) ?? firstMapFeatureVertexSelection(project);
  const count = selectedProjectVertexCount(project, selected);
  if (count <= 0) return firstBoundaryVertexSelection(project) ?? firstObstacleVertexSelection(project) ?? firstMapFeatureVertexSelection(project);
  const vertexIndex = (selected.vertexIndex + direction + count) % count;
  return { ...selected, vertexIndex };
}

export function selectedProjectVertexPoint(project: PivotProject, selected: SelectedProjectVertex): XY | null {
  if (selected.layer === "field_boundary") return project.fieldBoundary[selected.vertexIndex] ?? null;
  if (selected.layer === "obstacle") return project.obstacles.find((obstacle) => obstacle.id === selected.obstacleId)?.polygon[selected.vertexIndex] ?? null;
  const feature = (project.mapFeatures ?? []).find((candidate) => candidate.id === selected.featureId);
  return feature ? mapFeatureVertexPoint(feature, selected.vertexIndex) : null;
}

export function selectedProjectVertexCount(project: PivotProject, selected: SelectedProjectVertex): number {
  if (selected.layer === "field_boundary") return project.fieldBoundary.length;
  if (selected.layer === "obstacle") return project.obstacles.find((obstacle) => obstacle.id === selected.obstacleId)?.polygon.length ?? 0;
  const feature = (project.mapFeatures ?? []).find((candidate) => candidate.id === selected.featureId);
  return feature ? mapFeatureVertexCount(feature) : 0;
}

export function selectedProjectVertexCanDelete(project: PivotProject, selected: SelectedProjectVertex): boolean {
  if (selected.layer === "field_boundary") return selectedProjectVertexCount(project, selected) > 3;
  if (selected.layer === "obstacle") return selectedProjectVertexCount(project, selected) > 3;
  const feature = (project.mapFeatures ?? []).find((candidate) => candidate.id === selected.featureId);
  if (!feature) return false;
  if (feature.geometry.type === "LineString") return feature.geometry.vertices.length > 2;
  if (feature.geometry.type === "Polygon") return feature.geometry.vertices.length > 3;
  return false;
}

export function selectedProjectVertexCanInsert(project: PivotProject, selected: SelectedProjectVertex): boolean {
  if (selected.layer === "field_boundary" || selected.layer === "obstacle") {
    return selectedProjectVertexCount(project, selected) >= 3;
  }
  const feature = (project.mapFeatures ?? []).find((candidate) => candidate.id === selected.featureId);
  if (!feature || feature.geometry.type === "Point" || feature.geometry.type === "Circle") return false;
  if (feature.geometry.type === "Polygon") return feature.geometry.vertices.length >= 3;
  return selected.vertexIndex >= 0 && selected.vertexIndex < feature.geometry.vertices.length - 1;
}

export function selectedProjectVertexInsertionPoint(project: PivotProject, selected: SelectedProjectVertex): XY | null {
  if (!selectedProjectVertexCanInsert(project, selected)) return null;
  const current = selectedProjectVertexPoint(project, selected);
  if (!current) return null;
  const count = selectedProjectVertexCount(project, selected);
  const nextIndex = selected.vertexIndex + 1 < count ? selected.vertexIndex + 1 : 0;
  const next = selectedProjectVertexPoint(project, { ...selected, vertexIndex: nextIndex });
  if (!next) return null;
  return { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
}

export function selectedProjectVertexIsMapFeatureCircleRadius(project: PivotProject, selected: SelectedProjectVertex): boolean {
  if (selected.layer !== "map_feature") return false;
  const feature = (project.mapFeatures ?? []).find((candidate) => candidate.id === selected.featureId);
  return feature?.geometry.type === "Circle" && selected.vertexIndex === 1;
}

export function selectedProjectVertexText(project: PivotProject, selected: SelectedProjectVertex): string {
  const count = selectedProjectVertexCount(project, selected);
  const ordinal = selected.vertexIndex + 1;
  if (selected.layer === "field_boundary") return `boundary vertex ${ordinal} of ${Math.max(count, ordinal)}`;
  if (selected.layer === "obstacle") {
    const obstacle = project.obstacles.find((candidate) => candidate.id === selected.obstacleId);
    const name = obstacle?.name?.trim() ? obstacle.name.trim() : "obstacle";
    return `${name} vertex ${ordinal} of ${Math.max(count, ordinal)}`;
  }
  const feature = (project.mapFeatures ?? []).find((candidate) => candidate.id === selected.featureId);
  const name = feature?.name?.trim() ? feature.name.trim() : "map feature";
  const label = feature ? mapFeatureVertexLabel(feature, selected.vertexIndex) : "vertex";
  return `${name} ${label} ${ordinal} of ${Math.max(count, ordinal)}`;
}

type EditableMapFeature = NonNullable<PivotProject["mapFeatures"]>[number];

function mapFeatureVertexCount(feature: EditableMapFeature): number {
  if (feature.geometry.type === "Point") return 1;
  if (feature.geometry.type === "Circle") return 2;
  return feature.geometry.vertices.length;
}

function mapFeatureVertexPoint(feature: EditableMapFeature, vertexIndex: number): XY | null {
  if (feature.geometry.type === "Point") return vertexIndex === 0 ? feature.geometry.point : null;
  if (feature.geometry.type === "Circle") {
    if (vertexIndex === 0) return feature.geometry.center;
    if (vertexIndex === 1) return { x: feature.geometry.center.x + feature.geometry.radiusMeters, y: feature.geometry.center.y };
    return null;
  }
  return feature.geometry.vertices[vertexIndex] ?? null;
}

function mapFeatureVertexLabel(feature: EditableMapFeature, vertexIndex: number): string {
  if (feature.geometry.type === "Point") return "point";
  if (feature.geometry.type === "Circle") return vertexIndex === 1 ? "radius handle" : "center";
  return "vertex";
}
