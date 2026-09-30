import { z } from "zod";
import { DraftDrawingWorkflowSchema, type DraftDrawingGeometryType, type DraftDrawingWorkflow } from "./draftDrawingWorkflow";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import type { ProjectMapFeatureGeometry, ProjectMapFeatureKind } from "./types";

export const DRAWING_CLASSIFICATION_VERSION = "agricultural-feature-classification-v1";
export type DrawingPlacement = "not_applicable" | "unknown" | "aboveground" | "underground" | "overhead";
export type DrawingDestination = "feature" | "field_boundary" | "pivot_center" | "water_source" | "power_source";
export type DrawingCategory = "boundary" | "water" | "drainage" | "electrical" | "vegetation"
  | "physical" | "access" | "management" | "machine" | "measurement" | "reference";

export interface DrawingPurpose {
  readonly id: string;
  readonly label: string;
  readonly geometry: DraftDrawingGeometryType;
  readonly category: DrawingCategory;
  readonly destination: DrawingDestination;
  readonly placements: readonly DrawingPlacement[];
  readonly custom: boolean;
  /** Compatibility meaning for downstream advisory consumers, never a capture-accuracy claim. */
  readonly legacyKind: ProjectMapFeatureKind | null;
}

type PurposeEntry = {
  id: string; label: string; destination?: DrawingDestination; placements?: DrawingPlacement[];
  custom?: boolean; legacyKind?: ProjectMapFeatureKind;
};
function group(geometry: DraftDrawingGeometryType, category: DrawingCategory, entries: PurposeEntry[]): DrawingPurpose[] {
  return entries.map(entry => Object.freeze({
    id: entry.id, label: entry.label, geometry, category, destination: entry.destination ?? "feature",
    placements: Object.freeze(entry.placements?.slice() ?? ["not_applicable" as const]),
    custom: entry.custom ?? false, legacyKind: entry.legacyKind ?? null,
  }));
}

/** CPLayout product vocabulary, not an official NRCS taxonomy or automatic safety assessment. */
export const DRAWING_PURPOSE_CATALOG: readonly DrawingPurpose[] = Object.freeze([
  ...group("Polygon", "boundary", [
    { id: "field_boundary", label: "Field boundary", destination: "field_boundary" },
    { id: "planning_area", label: "Planning area", legacyKind: "planning_boundary" },
    { id: "exclusion_area", label: "Exclusion area" },
  ]),
  ...group("Polygon", "management", [
    { id: "soil_zone", label: "Soil zone" }, { id: "crop_zone", label: "Crop zone" },
    { id: "irrigation_zone", label: "Irrigation management zone" },
    { id: "drainage_zone", label: "Drainage or wetness zone" }, { id: "salinity_zone", label: "Salinity zone" },
  ]),
  ...group("Polygon", "physical", [
    { id: "building_footprint", label: "Building footprint" }, { id: "pond_area", label: "Pond area" },
    { id: "yard_area", label: "Yard area" },
  ]),
  ...group("Polygon", "vegetation", [
    { id: "tree_canopy", label: "Mapped tree canopy" }, { id: "wooded_area", label: "Wooded area" },
    { id: "vegetated_border", label: "Vegetated field border" },
  ]),
  ...group("Polygon", "machine", [
    { id: "irrigated_area", label: "Planned irrigated area" },
    { id: "machine_envelope", label: "Machine envelope", legacyKind: "machine_zone" },
    { id: "corner_arm_envelope", label: "Corner-arm envelope", legacyKind: "corner_swing_limit" },
  ]),
  ...group("Polygon", "measurement", [{ id: "area_measurement", label: "Area measurement", legacyKind: "measurement_area" }]),
  ...group("Polygon", "reference", [
    { id: "polygon_unknown", label: "Unidentified area" }, { id: "polygon_custom", label: "Other area", custom: true },
  ]),
  ...group("LineString", "water", [
    { id: "pipeline", label: "Irrigation pipeline", placements: ["unknown", "aboveground", "underground"] },
    { id: "canal", label: "Canal or lateral", legacyKind: "canal" },
    { id: "irrigation_ditch", label: "Irrigation ditch", legacyKind: "ditch" },
  ]),
  ...group("LineString", "drainage", [
    { id: "subsurface_drain", label: "Subsurface drain", placements: ["underground"] },
    { id: "surface_field_drain", label: "Surface field ditch" },
    { id: "main_drain", label: "Main or lateral drain" }, { id: "drain_unknown", label: "Unidentified drain" },
  ]),
  ...group("LineString", "electrical", [
    { id: "electrical_route", label: "Electrical route", placements: ["unknown", "overhead", "underground"] },
  ]),
  ...group("LineString", "access", [
    { id: "road", label: "Road", legacyKind: "road" }, { id: "access_lane", label: "Access lane", legacyKind: "access_lane" },
    { id: "fence", label: "Fence", legacyKind: "fence" },
  ]),
  ...group("LineString", "vegetation", [{ id: "tree_row", label: "Tree row or hedgerow" }]),
  ...group("LineString", "machine", [
    { id: "linear_travel", label: "Linear or lateral travel path", legacyKind: "linear_move_path" },
    { id: "tower_track", label: "Tower track" },
  ]),
  ...group("LineString", "measurement", [{ id: "distance_measurement", label: "Distance measurement", legacyKind: "measurement_line" }]),
  ...group("LineString", "reference", [
    { id: "reference_line", label: "Reference line" }, { id: "line_unknown", label: "Unidentified line" },
    { id: "line_custom", label: "Other line", custom: true },
  ]),
  ...group("Point", "water", [
    { id: "well", label: "Well", legacyKind: "well_location" }, { id: "pump", label: "Pump", legacyKind: "pump_location" },
    { id: "riser", label: "Pipeline riser" }, { id: "valve", label: "Valve" }, { id: "intake", label: "Intake" },
    { id: "outlet", label: "Outlet" }, { id: "water_flow_meter", label: "Water-flow meter" },
    { id: "project_water_source", label: "Design water source", destination: "water_source" },
  ]),
  ...group("Point", "electrical", [
    { id: "power_pole", label: "Power pole", legacyKind: "power_pole" },
    { id: "power_disconnect", label: "Power disconnect" }, { id: "transformer", label: "Transformer" },
    { id: "control_panel", label: "Control panel" }, { id: "electrical_meter", label: "Electrical meter" },
    { id: "project_power_source", label: "Design power source", destination: "power_source" },
  ]),
  ...group("Point", "vegetation", [{ id: "tree", label: "Tree", legacyKind: "tree" }]),
  ...group("Point", "physical", [{ id: "post", label: "Post" }, { id: "structure_marker", label: "Structure marker" }]),
  ...group("Point", "machine", [
    { id: "pivot_center", label: "Design pivot center", destination: "pivot_center" },
    { id: "end_gun_mark", label: "End-gun mark", legacyKind: "end_gun_mark" },
  ]),
  ...group("Point", "reference", [
    { id: "benchmark_marker", label: "Benchmark marker" }, { id: "observation_marker", label: "Observation marker" },
    { id: "reference_point", label: "Reference point" }, { id: "point_unknown", label: "Unidentified point" },
    { id: "point_custom", label: "Other point", custom: true },
  ]),
]);
const purposes = new Map(DRAWING_PURPOSE_CATALOG.map(purpose => [purpose.id, purpose]));
if (purposes.size !== DRAWING_PURPOSE_CATALOG.length) throw new Error("Drawing purpose IDs must be unique.");

export function drawingPurpose(id: string): DrawingPurpose | null { return purposes.get(id) ?? null; }
export function drawingPurposesForGeometry(geometry: DraftDrawingGeometryType, category?: DrawingCategory): readonly DrawingPurpose[] {
  return Object.freeze(DRAWING_PURPOSE_CATALOG.filter(item => item.geometry === geometry && (category === undefined || item.category === category)));
}

const geometrySchema = z.enum(["Point", "LineString", "Polygon"]);
const nonblank = z.string().min(1).max(1024).refine(value => value.trim().length > 0, "A nonblank value is required.");
const SelectionSchema = z.object({
  schemaVersion: z.literal(DRAWING_CLASSIFICATION_VERSION),
  geometryType: geometrySchema,
  purposeId: nonblank,
  name: nonblank,
  notes: z.string().max(16384),
  assetStatus: z.enum(["existing", "proposed", "unknown"]),
  placement: z.enum(["not_applicable", "unknown", "aboveground", "underground", "overhead"]),
  customLabel: nonblank.nullable(),
  effect: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("informational") }).strict(),
    z.object({ mode: z.literal("exclusion"), noSpray: z.boolean(), hardConflict: z.boolean(), bufferMeters: z.number().finite().nonnegative() }).strict(),
  ]),
}).strict();
export type DrawingClassification = z.output<typeof SelectionSchema>;

function assertRetainableJson(value: unknown, rejectPrototypeKey = false): void {
  if (value === undefined) throw new Error("Undefined classification values cannot survive JSON serialization.");
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (rejectPrototypeKey && key === "__proto__") throw new Error("Unsupported classification property: __proto__.");
      assertRetainableJson(child, rejectPrototypeKey);
    }
  }
}

/** Saved selection admission is strict; it supplies no status, placement, name or effect defaults. */
export function parseDrawingClassification(input: unknown): DrawingClassification {
  const snapshot = snapshotJsonValue(input, "drawing classification");
  assertRetainableJson(snapshot, true);
  const result = SelectionSchema.parse(snapshot);
  const purpose = drawingPurpose(result.purposeId);
  if (!purpose) throw new Error("Unknown drawing purpose; preserve imported data for explicit classification.");
  if (purpose.geometry !== result.geometryType) throw new Error("Purpose does not match the captured geometry type.");
  if (!purpose.placements.includes(result.placement)) throw new Error("Placement is not valid for this purpose.");
  if (purpose.custom !== (result.customLabel !== null)) throw new Error("Only Other purposes require a custom label.");
  if (result.effect.mode === "exclusion") {
    if (purpose.geometry !== "Polygon" || purpose.destination !== "feature") {
      throw new Error("An exclusion requires a separate polygon footprint, not a point, line, or operational boundary.");
    }
    if (!result.effect.noSpray && !result.effect.hardConflict) throw new Error("Choose at least one explicit exclusion effect.");
  } else if (purpose.id === "exclusion_area") throw new Error("An exclusion area requires explicit effects.");
  return result;
}

/** Preserve unsupported data without interpreting it as a known or approved purpose. */
export function inspectDrawingClassification(input: unknown):
  | { recognized: true; classification: DrawingClassification }
  | { recognized: false; original: unknown; reason: string } {
  const original = snapshotJsonValue(input, "imported classification");
  assertRetainableJson(original);
  try { return { recognized: true, classification: parseDrawingClassification(original) }; }
  catch (error) { return { recognized: false, original, reason: error instanceof Error ? error.message : "Unsupported classification." }; }
}

export function drawingClassificationDestination(input: unknown): DrawingDestination | "obstacle" {
  const classification = parseDrawingClassification(input);
  return classification.effect.mode === "exclusion" ? "obstacle" : drawingPurpose(classification.purposeId)!.destination;
}

/** Unknown routes never inherit the legacy buried-pipeline or power-line assumptions. */
export function drawingClassificationLegacyKind(input: unknown): ProjectMapFeatureKind | null {
  const classification = parseDrawingClassification(input);
  if (drawingClassificationDestination(classification) !== "feature") return null;
  if (classification.purposeId === "pipeline") return classification.placement === "underground" ? "underground_pipeline" : null;
  if (classification.purposeId === "electrical_route") return classification.placement === "underground" ? "underground_wire"
    : classification.placement === "overhead" ? "power_line" : null;
  return drawingPurpose(classification.purposeId)!.legacyKind;
}

export interface PreparedClassifiedDrawing {
  status: "prepared_not_committed";
  expectedEditorRevision: number;
  captureId: string;
  projectCrs: string;
  source: "map_digitized";
  confidence: "user_estimated";
  geometry: Exclude<ProjectMapFeatureGeometry, { type: "Circle" }>;
  vertices: DraftDrawingWorkflow["captures"][number]["vertices"];
  classification: DrawingClassification;
  destination: DrawingDestination | "obstacle";
  legacyKind: ProjectMapFeatureKind | null;
}

/** Detached input for the future atomic editor action; this neither removes a capture nor persists geometry. */
export function prepareClassifiedDrawing(input: {
  workflow: DraftDrawingWorkflow; projectCrs: string; captureId: string;
  editorRevision: number; expectedEditorRevision: number; classification: DrawingClassification;
}): PreparedClassifiedDrawing {
  const raw = z.object({ workflow: z.unknown(), projectCrs: z.string().min(1), captureId: z.string().min(1),
    editorRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
    expectedEditorRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
    classification: z.unknown() }).strict().parse(snapshotJsonValue(input, "classified capture"));
  if (raw.editorRevision !== raw.expectedEditorRevision) throw new Error("Classification is stale; use the current editor revision.");
  const workflow = DraftDrawingWorkflowSchema.parse(raw.workflow);
  const capture = workflow.captures.find(item => item.id === raw.captureId);
  if (!capture || workflow.activeCaptureId !== capture.id) throw new Error("Resume the selected capture before classifying it.");
  if (capture.stage !== "classification") throw new Error("Finish the drawing before classification.");
  if (workflow.lockedCrs !== raw.projectCrs || workflow.captures.some(item => item.projectCrs !== raw.projectCrs)) {
    throw new Error("Every capture and the retained coordinate frame must match the project CRS.");
  }
  const classification = parseDrawingClassification(raw.classification);
  if (classification.geometryType !== capture.geometryType) throw new Error("Classification cannot change captured geometry type.");
  const points = capture.vertices.map(vertex => ({ ...vertex.point }));
  const geometry = capture.geometryType === "Point" ? { type: "Point" as const, point: points[0] }
    : { type: capture.geometryType, vertices: points };
  return { status: "prepared_not_committed", expectedEditorRevision: raw.expectedEditorRevision,
    captureId: capture.id, projectCrs: capture.projectCrs, source: "map_digitized", confidence: "user_estimated",
    geometry, vertices: capture.vertices, classification,
    destination: drawingClassificationDestination(classification), legacyKind: drawingClassificationLegacyKind(classification) };
}
