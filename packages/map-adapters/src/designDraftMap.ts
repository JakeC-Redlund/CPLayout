import {
  isBoundaryWithinCalculationBudget, qualifyProjectCrs, validateDraftBoundary,
  type DesignDraft, type DesignDraftEditorAction, type ProjectMapFeatureGeometry, type XY,
} from "@cplayout/core";
import { draftVerticesToFeatureGeometry } from "./mapTools";
import { finitePointBounds } from "./mapFit";

export const DESIGN_DRAFT_PURPOSES = [
  { id: "boundary", label: "Boundary", group: "polygon", geometry: "Polygon" },
  { id: "keep_out", label: "Keep out", group: "polygon", geometry: "Polygon" },
  { id: "area", label: "Measurement area", group: "polygon", geometry: "Polygon" },
  { id: "path", label: "Path", group: "line", geometry: "LineString" },
  { id: "measurement", label: "Measurement", group: "line", geometry: "LineString" },
  { id: "pivot", label: "Pivot", group: "point", geometry: "Point" },
  { id: "water", label: "Water", group: "point", geometry: "Point" },
  { id: "power", label: "Power", group: "point", geometry: "Point" },
  { id: "marker", label: "End gun mark", group: "point", geometry: "Point" },
] as const;
export type DesignDraftPurpose = typeof DESIGN_DRAFT_PURPOSES[number]["id"];
export type DesignDraftToolGroup = typeof DESIGN_DRAFT_PURPOSES[number]["group"];

export function draftDrawingAllowed(projectCrs: string | null): boolean {
  if (!projectCrs?.trim()) return false;
  const qualification = qualifyProjectCrs(projectCrs);
  // Explicit local XY permits coordinate editing, but does not assert metric units.
  return qualification.legacyDocumentCrsReadable
    && (qualification.calculation.allowed || qualification.kind === "local");
}

export function draftCaptureError(purpose: DesignDraftPurpose, vertices: readonly XY[]): string | null {
  if (!vertices.length) return "No points captured.";
  if (!isBoundaryWithinCalculationBudget(vertices)) return "Coordinates exceed the drawing range.";
  const option = DESIGN_DRAFT_PURPOSES.find((item) => item.id === purpose)!;
  if (option.geometry === "Point") return vertices.length === 1 ? null : "Choose one point.";
  if (vertices.some((point, index) => index > 0 && point.x === vertices[index - 1].x && point.y === vertices[index - 1].y)) {
    return "Adjacent points must be different.";
  }
  if (option.geometry === "LineString") return vertices.length >= 2 ? null : "Capture at least two points.";
  // One- and two-point boundaries are actual saveable incomplete designs.
  if (purpose === "boundary" && vertices.length < 3) return null;
  return validateDraftBoundary([...vertices])[0]?.message ?? null;
}

export function buildDraftCaptureAction(
  projectCrs: string | null, purpose: DesignDraftPurpose, vertices: readonly XY[], id: string,
): DesignDraftEditorAction {
  if (!draftDrawingAllowed(projectCrs)) throw new Error("An eligible projected or local coordinate system is required.");
  const error = draftCaptureError(purpose, vertices);
  if (error) throw new Error(error);
  const points = vertices.map((point) => ({ ...point }));
  if (purpose === "boundary") return { type: "replace_boundary", vertices: points };
  if (purpose === "keep_out") return { type: "add_manual_obstacle", obstacle: {
    id, name: "Keep out", kind: "exclusion", polygon: points, bufferMeters: 0, hardConflict: true, noSpray: true,
  } };
  if (purpose === "pivot" || purpose === "water" || purpose === "power") return {
    type: "set_infrastructure", role: purpose === "pivot" ? "pivot_center" : purpose === "water" ? "water_source" : "power_source",
    point: points[0],
  };
  const option = DESIGN_DRAFT_PURPOSES.find((item) => item.id === purpose)!;
  return { type: "add_manual_feature", feature: {
    id, name: option.label,
    kind: purpose === "area" ? "measurement_area" : purpose === "path" ? "access_lane"
      : purpose === "measurement" ? "measurement_line" : "end_gun_mark",
    geometry: draftVerticesToFeatureGeometry(option.geometry, points),
    properties: { designPurpose: purpose },
  } };
}

export function draftGeometryPoints(geometry: ProjectMapFeatureGeometry): XY[] {
  if (geometry.type === "Point") return [geometry.point];
  if (geometry.type === "Circle") return [
    { x: geometry.center.x - geometry.radiusMeters, y: geometry.center.y - geometry.radiusMeters },
    { x: geometry.center.x + geometry.radiusMeters, y: geometry.center.y + geometry.radiusMeters },
  ];
  return geometry.vertices;
}

/** Camera bounds include supplied map objects only, never machine or calculated layout geometry. */
export function designDraftBounds(draft: DesignDraft) {
  return finitePointBounds([
    ...draft.fieldBoundary,
    ...[draft.pivotCenter, draft.waterSource, draft.powerSource].filter((point): point is XY => point !== null),
    ...draft.obstacles.flatMap((obstacle) => obstacle.polygon),
    ...(draft.mapFeatures ?? []).flatMap((feature) => draftGeometryPoints(feature.geometry)),
  ]);
}

/** A void callback is not an acceptance receipt. Clear capture only after matching props arrive. */
export function draftContainsCapture(draft: DesignDraft, action: DesignDraftEditorAction): boolean {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  switch (action.type) {
    case "replace_boundary": return same(draft.fieldBoundary, action.vertices);
    case "set_infrastructure": return same(draft[action.role === "pivot_center" ? "pivotCenter"
      : action.role === "water_source" ? "waterSource" : "powerSource"], action.point);
    case "add_manual_feature": return draft.mapFeatures?.some((item) => item.id === action.feature.id
      && same(item.geometry, action.feature.geometry)) ?? false;
    case "add_manual_obstacle": return draft.obstacles.some((item) => item.id === action.obstacle.id
      && same(item.polygon, action.obstacle.polygon));
    default: return false;
  }
}

/** Inverse web SVG CTM coordinates are SVG Y-down; canonical coordinates are Y-up. */
export function draftPointFromInverseCtm(clientX: number, clientY: number,
  inverse: { a: number; b: number; c: number; d: number; e: number; f: number }): XY | null {
  const x = inverse.a * clientX + inverse.c * clientY + inverse.e;
  const y = -(inverse.b * clientX + inverse.d * clientY + inverse.f);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}
