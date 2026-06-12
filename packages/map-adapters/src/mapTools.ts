import type { ProjectMapFeature, ProjectMapFeatureKind, SourceConfidence, XY } from "@cplayout/core";
import type { DrawingLayerType, DrawingMode } from "@cplayout/geometry";

export type UtilityFeatureGeometry = ProjectMapFeature["geometry"]["type"];

export type MapToolPanelId = "point" | "line" | "polygon" | "circle";
export type MapToolId = "pan" | "edit" | MapToolPanelId;

export interface PendingMapFeatureDraft {
  geometryType: UtilityFeatureGeometry;
  vertices: XY[];
  sourceConfidence: SourceConfidence;
  notes?: string;
}

export type MapToolCatalogItem = {
  id: MapToolId;
  label: string;
  shortLabel: string;
  statusLabel: string;
  testID: string;
  action:
    | { type: "activate"; mode: DrawingMode; layer: DrawingLayerType; featureKind?: ProjectMapFeatureKind }
    | { type: "open_panel"; panel: MapToolPanelId };
};

export const MAP_TOOL_CATALOG: MapToolCatalogItem[] = [
  {
    id: "pan",
    label: "Pan",
    shortLabel: "Pan",
    statusLabel: "Pan",
    testID: "map-tool-pan",
    action: { type: "activate", mode: "pan", layer: "field_boundary" },
  },
  {
    id: "edit",
    label: "Edit",
    shortLabel: "Edit",
    statusLabel: "Edit vertices",
    testID: "map-tool-edit",
    action: { type: "activate", mode: "edit_vertices", layer: "field_boundary" },
  },
  {
    id: "point",
    label: "Point",
    shortLabel: "Point",
    statusLabel: "Point tools",
    testID: "map-tool-point",
    action: { type: "open_panel", panel: "point" },
  },
  {
    id: "line",
    label: "Line",
    shortLabel: "Line",
    statusLabel: "Line tools",
    testID: "map-tool-line",
    action: { type: "open_panel", panel: "line" },
  },
  {
    id: "polygon",
    label: "Area",
    shortLabel: "Area",
    statusLabel: "Area tools",
    testID: "map-tool-polygon",
    action: { type: "open_panel", panel: "polygon" },
  },
  {
    id: "circle",
    label: "Coverage",
    shortLabel: "Coverage",
    statusLabel: "Coverage tool",
    testID: "map-tool-circle",
    action: { type: "open_panel", panel: "circle" },
  },
];

export interface UtilityFeatureOption {
  kind: ProjectMapFeatureKind;
  label: string;
  geometry: UtilityFeatureGeometry;
}

export const UTILITY_FEATURE_OPTIONS: UtilityFeatureOption[] = [
  { kind: "underground_pipeline", label: "Pipeline", geometry: "LineString" },
  { kind: "underground_wire", label: "Underground Wire", geometry: "LineString" },
  { kind: "linear_move_path", label: "Linear Move Path", geometry: "LineString" },
  { kind: "measurement_line", label: "Measurement Line", geometry: "LineString" },
  { kind: "power_line", label: "Power Line", geometry: "LineString" },
  { kind: "fence", label: "Fence", geometry: "LineString" },
  { kind: "access_lane", label: "Access Lane", geometry: "LineString" },
  { kind: "road", label: "Road", geometry: "LineString" },
  { kind: "ditch", label: "Ditch", geometry: "LineString" },
  { kind: "canal", label: "Canal", geometry: "LineString" },
  { kind: "planning_boundary", label: "Planning Boundary", geometry: "Polygon" },
  { kind: "machine_zone", label: "Machine Zone", geometry: "Polygon" },
  { kind: "corner_swing_limit", label: "Corner-Arm Footprint", geometry: "Polygon" },
  { kind: "end_gun_arc", label: "End-Gun Circle", geometry: "Circle" },
  { kind: "pump_location", label: "Pump", geometry: "Point" },
  { kind: "well_location", label: "Well", geometry: "Point" },
  { kind: "power_pole", label: "Power Pole", geometry: "Point" },
  { kind: "tree", label: "Tree", geometry: "Point" },
  { kind: "end_gun_mark", label: "Evidence Mark", geometry: "Point" },
];

export function featureOptionForKind(kind: ProjectMapFeatureKind): UtilityFeatureOption {
  return UTILITY_FEATURE_OPTIONS.find((option) => option.kind === kind) ?? UTILITY_FEATURE_OPTIONS[0];
}

export function featureOptionsForGeometry(geometry: UtilityFeatureGeometry): UtilityFeatureOption[] {
  return UTILITY_FEATURE_OPTIONS.filter((option) => option.geometry === geometry);
}

export function featureDraftMinimumVertices(geometry: UtilityFeatureGeometry): number {
  if (geometry === "Point") return 0;
  if (geometry === "LineString" || geometry === "Circle") return 2;
  return 3;
}

export function defaultMapFeatureName(kind: ProjectMapFeatureKind, geometry: UtilityFeatureGeometry, vertexCount: number): string {
  if (geometry === "Circle") return `${kind.replaceAll("_", " ")} circle`;
  if (geometry === "Polygon") return `${kind.replaceAll("_", " ")} polygon`;
  return `${kind.replaceAll("_", " ")} ${vertexCount > 1 ? "line" : "point"}`;
}

export function draftVerticesToFeatureGeometry(
  geometry: UtilityFeatureGeometry,
  vertices: XY[],
): ProjectMapFeature["geometry"] {
  if (geometry === "LineString") return { type: "LineString", vertices };
  if (geometry === "Polygon") return { type: "Polygon", vertices };
  if (geometry === "Circle") {
    const center = vertices[0];
    const edge = vertices[1];
    if (!center || !edge) throw new Error("Circle map features need center and radius points.");
    return {
      type: "Circle",
      center,
      radiusMeters: Math.hypot(edge.x - center.x, edge.y - center.y),
    };
  }
  const point = vertices[0];
  if (!point) throw new Error("Point map features need one point.");
  return { type: "Point", point };
}
