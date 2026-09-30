import { projectDataKey } from "./projectDataComparison";
import type { DrawingMetadataTarget } from "./drawingMetadata";
import type { PivotProject, XY } from "./types";

/** Refresh only metadata inherited by a local edit. Supplied import metadata is a separate contract. */
export function refreshInheritedDrawingMetadata(previous: PivotProject, next: PivotProject): PivotProject {
  if (!next.drawingMetadata || next.drawingMetadata !== previous.drawingMetadata) return next;
  const normalizedFeatureIds = new Set<string>();
  const records = next.drawingMetadata.records.flatMap(record => {
    const current = targetVertices(next, record.target);
    if (!current) return [];
    const target = record.target;
    const feature = target.kind === "map_feature" ? next.mapFeatures?.find(item => item.id === target.id) : undefined;
    const obstacle = target.kind === "obstacle" ? next.obstacles.find(item => item.id === target.id) : undefined;
    const classification = feature ? { ...record.classification, name: feature.name, notes: feature.notes ?? "" }
      : obstacle ? { ...record.classification, name: obstacle.name } : record.classification;
    if (feature && feature.notes === undefined) normalizedFeatureIds.add(feature.id);
    return [{ ...record, classification,
      capture: projectDataKey(targetVertices(previous, target) ?? []) === projectDataKey(current)
        ? record.capture : { ...record.capture, vertexRecordedAt: current.map(() => null) } }];
  });
  return { ...next,
    ...(normalizedFeatureIds.size ? { mapFeatures: next.mapFeatures!.map(feature => normalizedFeatureIds.has(feature.id)
      ? { ...feature, notes: "" } : feature) } : {}),
    drawingMetadata: { ...next.drawingMetadata, records },
  };
}

function targetVertices(project: PivotProject, target: DrawingMetadataTarget): XY[] | null {
  switch (target.kind) {
    case "field_boundary": return project.fieldBoundary;
    case "pivot_center": return [project.pivotCenter];
    case "water_source": return [project.waterSource];
    case "power_source": return [project.powerSource];
    case "obstacle": return project.obstacles.find(item => item.id === target.id)?.polygon ?? null;
    case "map_feature": {
      const shape = project.mapFeatures?.find(item => item.id === target.id)?.geometry;
      return !shape ? null : shape.type === "Point" ? [shape.point] : shape.type === "Circle" ? [shape.center] : shape.vertices;
    }
  }
}
