import { z } from "zod";
import { drawingClassificationDestination, drawingClassificationLegacyKind, parseDrawingClassification, type DrawingClassification } from "./drawingClassification";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import type { ObstacleZone, ProjectMapFeature, ProjectMapFeatureKind, XY } from "./types";

export const PROJECT_DRAWING_METADATA_VERSION = "project-drawing-metadata-v1";
const id = z.string().min(1);
export const DrawingMetadataTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field_boundary") }).strict(),
  z.object({ kind: z.literal("pivot_center") }).strict(),
  z.object({ kind: z.literal("water_source") }).strict(),
  z.object({ kind: z.literal("power_source") }).strict(),
  z.object({ kind: z.literal("map_feature"), id }).strict(),
  z.object({ kind: z.literal("obstacle"), id }).strict(),
]);
export type DrawingMetadataTarget = z.output<typeof DrawingMetadataTargetSchema>;
const classificationSchema = z.unknown().transform((value, context): DrawingClassification => {
  try { return parseDrawingClassification(value); }
  catch (error) { context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid classification." }); return z.NEVER; }
});
export const DrawingMetadataRecordSchema = z.object({
  target: DrawingMetadataTargetSchema,
  classification: classificationSchema,
  capture: z.object({
    captureId: id, source: z.literal("map_digitized"),
    /** Null marks a later manual edit without a retained digitization time. Never receiver evidence. */
    vertexRecordedAt: z.array(z.iso.datetime({ offset: true }).nullable()),
    wgs84: z.null(), elevation: z.null(),
  }).strict(),
}).strict();
export type DrawingMetadataRecord = z.output<typeof DrawingMetadataRecordSchema>;
export const ProjectDrawingMetadataSchema = z.object({
  schemaVersion: z.literal(PROJECT_DRAWING_METADATA_VERSION),
  autosaveEnabled: z.boolean(), records: z.array(DrawingMetadataRecordSchema),
}).strict();
export type ProjectDrawingMetadata = z.output<typeof ProjectDrawingMetadataSchema>;

/** Stable target identity; separate from the capture identity and canonical geometry. */
export function drawingMetadataTargetKey(target: DrawingMetadataTarget): string {
  return JSON.stringify(target.kind === "map_feature" || target.kind === "obstacle" ? [target.kind, target.id] : [target.kind]);
}

export function classifiedDrawingFeatureKind(classification: DrawingClassification): ProjectMapFeatureKind {
  const parsed = parseDrawingClassification(classification);
  if (drawingClassificationDestination(parsed) !== "feature") throw new Error("This classification is not a map feature.");
  return drawingClassificationLegacyKind(parsed) ?? (parsed.geometryType === "Point" ? "reference_point"
    : parsed.geometryType === "LineString" ? "reference_line" : "reference_area");
}

type DrawingMetadataOwner = {
  drawingMetadata?: ProjectDrawingMetadata;
  fieldBoundary: XY[]; pivotCenter: XY | null; waterSource: XY | null; powerSource: XY | null;
  mapFeatures?: ProjectMapFeature[]; obstacles: ObstacleZone[];
};

/** A classification is attached to exactly one existing geometry; no second editable XY copy is stored. */
export function validateProjectDrawingMetadata(owner: DrawingMetadataOwner): void {
  if (owner.drawingMetadata === undefined) {
    if (owner.mapFeatures?.some(feature => feature.kind.startsWith("reference_"))) {
      throw new Error("Reference feature kinds require typed drawing metadata and a current document version.");
    }
    return;
  }
  const metadata = ProjectDrawingMetadataSchema.parse(snapshotJsonValue(owner.drawingMetadata));
  const targets = new Set<string>();
  const captures = new Set<string>();
  for (const record of metadata.records) {
    const key = drawingMetadataTargetKey(record.target);
    if (targets.has(key)) throw new Error("Duplicate drawing metadata target.");
    targets.add(key);
    if (captures.has(record.capture.captureId)) throw new Error("Duplicate classified capture identity.");
    captures.add(record.capture.captureId);
    const classification = record.classification;
    const destination = drawingClassificationDestination(classification);
    let count: number;
    if (record.target.kind === "map_feature") {
      const matches = owner.mapFeatures?.filter(item => item.id === (record.target as { id: string }).id) ?? [];
      if (matches.length !== 1) throw new Error("Drawing metadata target must resolve to exactly one map feature.");
      const feature = matches[0];
      if (destination !== "feature" || feature.geometry.type !== classification.geometryType
        || feature.kind !== classifiedDrawingFeatureKind(classification)) throw new Error("Drawing classification must match its map feature kind and geometry.");
      if (feature.name !== classification.name || feature.notes !== classification.notes) throw new Error("Drawing classification name and notes must match the map feature.");
      count = feature.geometry.type === "Point" ? 1 : feature.geometry.vertices.length;
    } else if (record.target.kind === "obstacle") {
      const matches = owner.obstacles.filter(item => item.id === (record.target as { id: string }).id);
      if (matches.length !== 1) throw new Error("Drawing metadata target must resolve to exactly one obstacle.");
      const obstacle = matches[0];
      if (destination !== "obstacle" || classification.effect.mode !== "exclusion" || obstacle.kind !== "exclusion"
        || obstacle.name !== classification.name || obstacle.noSpray !== classification.effect.noSpray
        || obstacle.hardConflict !== classification.effect.hardConflict || obstacle.bufferMeters !== classification.effect.bufferMeters) {
        throw new Error("Drawing classification must match its explicit obstacle effects.");
      }
      count = obstacle.polygon.length;
    } else {
      if (destination !== record.target.kind) throw new Error("Drawing classification must match its operational target.");
      const geometry = record.target.kind === "field_boundary" ? owner.fieldBoundary
        : record.target.kind === "pivot_center" ? owner.pivotCenter
          : record.target.kind === "water_source" ? owner.waterSource : owner.powerSource;
      if (geometry === null || (Array.isArray(geometry) && geometry.length < 3)) throw new Error("Drawing metadata requires present operational geometry.");
      count = Array.isArray(geometry) ? geometry.length : 1;
    }
    if (count !== record.capture.vertexRecordedAt.length) throw new Error("Drawing capture times must align with canonical geometry vertices.");
  }
  for (const feature of owner.mapFeatures ?? []) {
    if (feature.kind.startsWith("reference_") && !targets.has(drawingMetadataTargetKey({ kind: "map_feature", id: feature.id }))) {
      throw new Error("Reference features require a matching typed classification record.");
    }
  }
}
