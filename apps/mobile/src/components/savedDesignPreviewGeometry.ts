import { parseDesignDraftDocument, parseFieldDesignDocument, parseProjectDocument, type XY } from "@cplayout/core";
import type { WorkspaceDesignRead } from "@cplayout/project-store";

export type PreviewShape =
  | { kind: "point"; point: XY; role: "boundary" | "feature" | "machine" }
  | { kind: "path"; points: XY[]; closed: boolean; role: "boundary" | "feature" | "machine" }
  | { kind: "circle"; center: XY; radius: number; role: "feature" };
export interface SavedPreviewGeometry {
  status: "ready" | "empty" | "unavailable";
  label: string;
  shapes: PreviewShape[];
  bounds?: { minX: number; minY: number; width: number; height: number };
}

export const unavailableSavedPreview = (): SavedPreviewGeometry => ({ status: "unavailable", label: "Preview unavailable", shapes: [] });

/** Read-only projection of the exact saved document. Never takes active editor geometry. */
export function savedDesignPreviewGeometry(read: WorkspaceDesignRead, designId: string, revision?: number): SavedPreviewGeometry {
  if (read.kind === "not_found") return unavailableSavedPreview();
  if (read.design.id !== designId || read.context.designId !== designId
    || read.design.kind !== read.kind || (revision !== undefined && read.design.revision !== revision)) return unavailableSavedPreview();
  try {
    const parsed = read.kind === "draft" ? { kind: "draft" as const, document: parseDesignDraftDocument(read.document) }
      : read.kind === "field" ? { kind: "field" as const, document: parseFieldDesignDocument(read.document) }
        : { kind: "project" as const, document: parseProjectDocument(read.document) };
    const document = parsed.document;
    const payloadId = read.kind === "draft" ? read.design.draftId
      : read.kind === "field" ? read.design.fieldDesignId : read.design.pivotProjectId;
    if (document.id !== payloadId) return unavailableSavedPreview();
    const shapes: PreviewShape[] = [];
    const point = (value: XY, role: "boundary" | "feature" | "machine") => shapes.push({ kind: "point", point: { ...value }, role });
    const path = (values: XY[], closed: boolean, role: "boundary" | "feature" | "machine") => {
      if (values.length === 1) point(values[0]!, role);
      if (values.length > 1) shapes.push({ kind: "path", points: values.map(value => ({ ...value })), closed: closed && values.length >= 3, role });
    };
    // Incomplete drafts remain open paths, even with three or more captured points.
    path(document.fieldBoundary, read.kind !== "draft", "boundary");
    document.obstacles.forEach(obstacle => path(obstacle.polygon, true, "feature"));
    document.mapFeatures?.forEach(feature => {
      const geometry = feature.geometry;
      if (geometry.type === "Point") point(geometry.point, "feature");
      else if (geometry.type === "Circle") shapes.push({ kind: "circle", center: { ...geometry.center }, radius: geometry.radiusMeters, role: "feature" });
      else path(geometry.vertices, geometry.type === "Polygon", "feature");
    });
    document.surveyPoints.forEach(survey => point(survey.projected, "feature"));
    if (parsed.kind === "draft") parsed.document.drawingWorkflow?.captures.forEach(capture => path(capture.vertices.map(vertex => vertex.point), false, "feature"));
    if (parsed.kind === "field") {
      parsed.document.machines.forEach(machine => point(machine.pivotCenter, "machine"));
      parsed.document.infrastructure.forEach(item => point(item.point, "feature"));
      parsed.document.lateralMachines?.forEach(machine => path([machine.travel.start, machine.travel.end], false, "machine"));
    } else {
      if (parsed.document.pivotCenter) point(parsed.document.pivotCenter, "machine");
      if (parsed.document.waterSource) point(parsed.document.waterSource, "feature");
      if (parsed.document.powerSource) point(parsed.document.powerSource, "feature");
    }
    const label = read.kind === "draft" ? "Draft" : read.kind === "field" ? "Field design" : "Pivot design";
    if (!shapes.length) return { status: "empty", label, shapes };
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    const include = (p: XY) => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); };
    shapes.forEach(shape => {
      if (shape.kind === "point") include(shape.point);
      else if (shape.kind === "path") shape.points.forEach(include);
      else {
        include({ x: shape.center.x - shape.radius, y: shape.center.y - shape.radius });
        include({ x: shape.center.x + shape.radius, y: shape.center.y + shape.radius });
      }
    });
    const width = maxX - minX; const height = maxY - minY;
    if (![minX, minY, width, height].every(Number.isFinite)) return unavailableSavedPreview();
    return { status: "ready", label, shapes, bounds: { minX, minY, width, height } };
  } catch {
    return unavailableSavedPreview();
  }
}
