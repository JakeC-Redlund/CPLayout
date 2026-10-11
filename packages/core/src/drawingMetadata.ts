import { z } from "zod";
import { SurveyPointSchema } from "./surveyPointSchema";
import { MAX_SURVEY_ACTIVE_POINTS, MAX_SURVEY_RETAINED_POINTS, RecordedReferencePurposeSchema, SurveyCollectionIdSchema, SurveyCollectionRevisionSchema, SurveyCollectionOwnerSchema, SurveyApplicationReceiptSchema } from "./surveyCollectionSchemas";
import { gnssV2CaptureConflicts } from "./gnssEvidence";
import { assertOperationalProjection } from "./operationalGnssEvidence";
import { validateDraftBoundary } from "./manualDesign";
import { projectDataKey } from "./projectDataComparison";
import { sha256Text } from "./sha256";
import { assertProjectedCrs } from "./units";
import { drawingClassificationDestination, drawingClassificationLegacyKind, parseDrawingClassification, type DrawingClassification } from "./drawingClassification";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import type { ObstacleZone, ProjectMapFeature, ProjectMapFeatureKind, GnssCaptureEvidence, SurveyPoint, XY } from "./types";

export const PROJECT_DRAWING_METADATA_VERSION = "project-drawing-metadata-v1";
export const PROJECT_DRAWING_METADATA_V2_VERSION = "project-drawing-metadata-v2";
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
export const DigitizedDrawingMetadataRecordSchema = z.object({
  target: DrawingMetadataTargetSchema,
  classification: classificationSchema,
  capture: z.object({
    captureId: id, source: z.literal("map_digitized"),
    /** Null marks a later manual edit without a retained digitization time. Never receiver evidence. */
    vertexRecordedAt: z.array(z.iso.datetime({ offset: true }).nullable()),
    wgs84: z.null(), elevation: z.null(),
  }).strict(),
}).strict();
export type DigitizedDrawingMetadataRecord = z.output<typeof DigitizedDrawingMetadataRecordSchema>;
const ReferenceMeaningSchema = z.object({
  featureKind: z.enum(["reference_point", "reference_line", "reference_area"]),
  geometryType: z.enum(["Point", "LineString", "Polygon"]), name: z.string().min(1), notes: z.string().optional(),
}).strict().superRefine((meaning, context) => {
  if (!RecordedReferencePurposeSchema.safeParse({ kind: "map_feature", featureKind: meaning.featureKind, geometryType: meaning.geometryType }).success) {
    context.addIssue({ code: "custom", message: "Reference meaning kind must match its geometry type." });
  }
});
const RecordedReferenceObservationSchema = z.unknown().transform((value, context): z.output<typeof SurveyPointSchema> => {
  try {
    const snapshot = snapshotJsonValue(value), parsed = SurveyPointSchema.parse(snapshot);
    if (projectDataKey(snapshot as object) !== projectDataKey(parsed)) throw new Error("Recorded reference observations cannot strip or normalize immutable source fields.");
    return snapshot as z.output<typeof SurveyPointSchema>;
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid recorded reference observation." });
    return z.NEVER;
  }
});
export const RecordedReferenceOriginSchema = z.object({
  collectionId: SurveyCollectionIdSchema, owner: SurveyCollectionOwnerSchema,
  sourceCollectionRevision: SurveyCollectionRevisionSchema,
  purpose: RecordedReferencePurposeSchema, receipt: SurveyApplicationReceiptSchema,
  observations: z.array(RecordedReferenceObservationSchema).min(1).max(MAX_SURVEY_ACTIVE_POINTS),
}).strict().superRefine((origin, context) => {
  try { validateRecordedReferenceOrigin(origin); }
  catch (error) { context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid recorded reference origin." }); }
});
export type RecordedReferenceOrigin = z.output<typeof RecordedReferenceOriginSchema>;
export const RecordedReferenceMetadataRecordSchema = z.object({
  target: z.object({ kind: z.literal("map_feature"), id }).strict(),
  meaning: ReferenceMeaningSchema, binding: z.enum(["recorded", "edited"]),
  attachment: z.object({ collectionId: SurveyCollectionIdSchema, applicationId: SurveyCollectionIdSchema }).strict().optional(),
  capture: z.object({ source: z.literal("recorded_survey"), origin: RecordedReferenceOriginSchema }).strict(),
}).strict().superRefine((record, context) => {
  const receipt = record.capture.origin.receipt;
  if (receipt.target.kind !== "map_feature" || receipt.target.id !== record.target.id) context.addIssue({ code: "custom", message: "Recorded reference receipt must target its exact canonical map feature identity." });
  if (record.attachment && record.attachment.applicationId !== receipt.id) context.addIssue({ code: "custom", message: "Recorded reference attachment application differs from origin receipt." });
});
export type RecordedReferenceMetadataRecord = z.output<typeof RecordedReferenceMetadataRecordSchema>;
export const DrawingMetadataRecordSchema = z.union([DigitizedDrawingMetadataRecordSchema, RecordedReferenceMetadataRecordSchema]);
export type DrawingMetadataRecord = z.output<typeof DrawingMetadataRecordSchema>;
export function isRecordedReferenceMetadataRecord(record: { capture: { source: string } }): record is RecordedReferenceMetadataRecord {
  return record.capture.source === "recorded_survey";
}
export const ProjectDrawingMetadataSchema = z.union([
  z.object({ schemaVersion: z.literal(PROJECT_DRAWING_METADATA_VERSION), autosaveEnabled: z.boolean(), records: z.array(DigitizedDrawingMetadataRecordSchema) }).strict(),
  z.object({ schemaVersion: z.literal(PROJECT_DRAWING_METADATA_V2_VERSION), autosaveEnabled: z.boolean(), records: z.array(DrawingMetadataRecordSchema), retainedReferenceOrigins: z.array(RecordedReferenceOriginSchema).max(MAX_SURVEY_RETAINED_POINTS).optional() }).strict(),
]).transform((metadata): { schemaVersion: typeof PROJECT_DRAWING_METADATA_VERSION | typeof PROJECT_DRAWING_METADATA_V2_VERSION;
  autosaveEnabled: boolean; records: DrawingMetadataRecord[]; retainedReferenceOrigins?: RecordedReferenceOrigin[] } => metadata);
export type ProjectDrawingMetadata = z.output<typeof ProjectDrawingMetadataSchema>;

/** Geometry derives only from the pinned ordered snapshots, never editable current meaning. */
export function recordedReferenceOriginGeometry(record: RecordedReferenceMetadataRecord): ProjectMapFeature["geometry"] {
  return recordedReferenceGeometry(record.capture.origin);
}
function recordedReferenceGeometry(origin: RecordedReferenceOrigin): ProjectMapFeature["geometry"] {
  const vertices = origin.observations.map(point => ({ x: point.projected.x, y: point.projected.y }));
  return origin.purpose.geometryType === "Point" ? { type: "Point", point: vertices[0] }
    : { type: origin.purpose.geometryType, vertices };
}
function validateRecordedReferenceOrigin(origin: RecordedReferenceOrigin): void {
  const receipt = origin.receipt;
  assertProjectedCrs(origin.owner.projectCrs);
  if (origin.sourceCollectionRevision === Number.MAX_SAFE_INTEGER) throw new Error("Recorded reference source revision cannot be applied.");
  if (receipt.designRevision < 1) throw new Error("Recorded reference receipt requires an accepted design revision.");
  if (receipt.target.kind !== "map_feature") throw new Error("Recorded reference origin receipt must target a map feature.");
  if (projectDataKey(receipt.sourcePointIds) !== projectDataKey(origin.observations.map(point => point.id))) throw new Error("Recorded reference snapshots must match exact ordered receipt membership.");
  if (new Set(receipt.sourcePointIds).size !== receipt.sourcePointIds.length) throw new Error("Recorded reference receipt has duplicate point identities.");
  const receiverIds = new Set<string>();
  for (const point of origin.observations) {
    const evidence = point.captureEvidence;
    if (!evidence || receiverIds.has(evidence.observationId)) throw new Error("Recorded reference snapshots require distinct retained receiver identities.");
    receiverIds.add(evidence.observationId);
    if (evidence.schemaVersion === "gnss-operational-fixed-v1") {
      assertOperationalProjection(evidence, point.projected, origin.owner.projectCrs);
      if (point.source !== "external_gnss" || point.confidence !== "rtk_fixed") throw new Error("Recorded reference must retain its external fixed-GGA provenance.");
      if (point.wgs84 && (Math.abs(point.wgs84.latitude - evidence.gga.latitude) > 1e-10 || Math.abs(point.wgs84.longitude - evidence.gga.longitude) > 1e-10)) throw new Error("Recorded reference WGS84 differs from retained GGA.");
      if (point.rtk && (point.rtk.fixType !== "rtk_fixed" || point.rtk.nmeaQualityCode !== 4)) throw new Error("Recorded reference quality differs from fixed GGA.");
    }
  }
  const conflicts = gnssV2CaptureConflicts({ projectCrs: origin.owner.projectCrs, fieldBoundary: [], obstacles: [], surveyPoints: origin.observations });
  if (conflicts.length) throw new Error(conflicts[0].message);
  const geometry = recordedReferenceGeometry(origin);
  if (geometry.type === "Point" && origin.observations.length !== 1) throw new Error("Recorded point needs exactly one observation.");
  if (geometry.type === "LineString" && (geometry.vertices.length < 2 || !geometry.vertices.some(point => projectDataKey(point) !== projectDataKey(geometry.vertices[0])))) throw new Error("Recorded line needs two distinct positions.");
  if (geometry.type === "Polygon") { const issue = validateDraftBoundary(geometry.vertices)[0]; if (issue) throw new Error(issue.message); }
  if (receipt.geometryHash !== sha256Text(JSON.stringify(geometry))) throw new Error("Recorded reference geometry hash differs from exact snapshots.");
}

export function validateRecordedReferenceMetadata(input: RecordedReferenceMetadataRecord, context: { feature: ProjectMapFeature; projectCrs: string }): void {
  const snapshot = snapshotJsonValue(input), record = RecordedReferenceMetadataRecordSchema.parse(snapshot);
  if (projectDataKey(snapshot as object) !== projectDataKey(record)) throw new Error("Recorded reference cannot strip or normalize its immutable snapshots.");
  const feature = context.feature, meaning = record.meaning;
  if (record.target.id !== feature.id || context.projectCrs !== record.capture.origin.owner.projectCrs) throw new Error("Recorded reference must match its canonical target and declared CRS.");
  if (feature.kind !== meaning.featureKind || feature.geometry.type !== meaning.geometryType || feature.name !== meaning.name || feature.notes !== meaning.notes) throw new Error("Recorded reference current meaning must match its canonical feature.");
  const originGeometry = recordedReferenceOriginGeometry(record), observations = record.capture.origin.observations;
  if (record.binding === "recorded") {
    if (projectDataKey(feature.geometry) !== projectDataKey(originGeometry) || projectDataKey(feature.vertexCaptureEvidence ?? []) !== projectDataKey(observations.map(point => point.captureEvidence))) throw new Error("Recorded reference canonical XY and evidence must match exact snapshots.");
    if (feature.confidence !== weakestRecordedReferenceConfidence(observations)) throw new Error("Recorded reference confidence must match its weakest observation.");
  } else {
    const vertices = feature.geometry.type === "Point" ? [feature.geometry.point] : feature.geometry.vertices;
    for (const [index, evidence] of (feature.vertexCaptureEvidence ?? []).entries()) {
      if (evidence && !observations.some(point => projectDataKey(point.projected) === projectDataKey(vertices[index]) && projectDataKey(point.captureEvidence!) === projectDataKey(evidence))) throw new Error("Edited reference cannot retain changed or invented vertex evidence.");
    }
    if (feature.confidence !== "user_estimated") throw new Error("Edited reference geometry requires honest user-estimated current confidence.");
  }
}
export function weakestRecordedReferenceConfidence(points: SurveyPoint[]): SurveyPoint["confidence"] {
  const levels: SurveyPoint["confidence"][] = ["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"];
  return levels[Math.max(...points.map(point => levels.indexOf(point.confidence)))];
}
/** Compare survivors by canonical target. Removed targets may represent geometry deletion. */
export function assertRecordedReferenceHistory(beforeRecords: readonly { target: DrawingMetadataTarget; capture: { source: string } }[], afterRecords: readonly { target: DrawingMetadataTarget; capture: { source: string } }[]): void {
  for (const previous of beforeRecords) {
    if (!isRecordedReferenceMetadataRecord(previous)) continue;
    const matches = afterRecords.filter(record => drawingMetadataTargetKey(record.target) === drawingMetadataTargetKey(previous.target));
    if (!matches.length) continue;
    if (matches.length !== 1 || !isRecordedReferenceMetadataRecord(matches[0]) || projectDataKey(matches[0].capture.origin) !== projectDataKey(previous.capture.origin)) throw new Error("Recorded reference immutable origin cannot be removed, retyped or rewritten for a surviving target.");
  }
}
export function remapRecordedReferenceAttachment(record: RecordedReferenceMetadataRecord, mappings: readonly { sourceCollectionId: string; collectionId: string }[]): RecordedReferenceMetadataRecord {
  const next = snapshotJsonValue(record) as RecordedReferenceMetadataRecord;
  if (!next.attachment) return next;
  const matches = mappings.filter(mapping => mapping.sourceCollectionId === next.attachment!.collectionId);
  if (matches.length !== 1) throw new Error("Recorded reference attachment requires one unique exhaustive collection mapping.");
  next.attachment.collectionId = SurveyCollectionIdSchema.parse(matches[0].collectionId);
  return next;
}
export function retireRecordedReferenceAttachment(record: RecordedReferenceMetadataRecord): RecordedReferenceMetadataRecord {
  const next = snapshotJsonValue(record) as RecordedReferenceMetadataRecord;
  delete next.attachment; return next;
}

/** Historical ownership and canonical target define one immutable origin; current clones keep these identities. */
export function recordedReferenceOriginKey(origin: RecordedReferenceOrigin): string {
  if (origin.receipt.target.kind !== "map_feature") throw new Error("Recorded reference origin receipt requires a map feature target.");
  return projectDataKey({ owner: origin.owner, target: origin.receipt.target });
}
export interface RecordedReferenceHistoryPayload {
  id: string; projectCrs: string | null;
  drawingMetadata?: { schemaVersion: string; autosaveEnabled: boolean;
    records: Array<{ capture: { source: string } }>; retainedReferenceOrigins?: RecordedReferenceOrigin[] };
}
function checkedRetainedReferenceOrigins(payload: RecordedReferenceHistoryPayload): RecordedReferenceOrigin[] {
  const retained = payload.drawingMetadata?.retainedReferenceOrigins ?? [], keys = new Set<string>();
  for (const origin of retained) {
    const parsed = RecordedReferenceOriginSchema.parse(origin);
    if (projectDataKey(origin) !== projectDataKey(parsed)) throw new Error("Retained reference origins cannot strip or normalize immutable source data.");
    if (origin.owner.projectCrs !== payload.projectCrs) throw new Error("Retained reference origin must preserve the owning payload's declared CRS.");
    const key = recordedReferenceOriginKey(origin);
    if (keys.has(key)) throw new Error("Duplicate retained reference origin for historical owner and target.");
    keys.add(key);
  }
  return retained;
}
/** Explicit owner/editor admission. Parsing does not create retained authority. */
export function seedRecordedReferenceOrigins<T extends RecordedReferenceHistoryPayload>(payload: T): T {
  const next = snapshotJsonValue(payload) as T, retained = [...checkedRetainedReferenceOrigins(next)];
  const origins = new Map(retained.map(origin => [recordedReferenceOriginKey(origin), origin]));
  for (const record of next.drawingMetadata?.records ?? []) {
    if (!isRecordedReferenceMetadataRecord(record)) continue;
    const parsed = RecordedReferenceMetadataRecordSchema.parse(record);
    if (projectDataKey(record) !== projectDataKey(parsed)) throw new Error("Reference origin seeding cannot strip or normalize source data.");
    const origin = record.capture.origin, key = recordedReferenceOriginKey(origin), previous = origins.get(key);
    if (origin.owner.projectCrs !== next.projectCrs) throw new Error("Recorded reference admission must preserve the declared CRS.");
    if (previous && projectDataKey(previous) !== projectDataKey(origin)) throw new Error("Conflicting immutable reference origin for historical owner and target.");
    if (!previous) { retained.push(origin); origins.set(key, origin); }
  }
  if (retained.length) {
    if (!next.drawingMetadata || ![PROJECT_DRAWING_METADATA_V2_VERSION, "field-drawing-metadata-v2"].includes(next.drawingMetadata.schemaVersion)) throw new Error("Retained reference authority requires metadata-v2.");
    next.drawingMetadata.retainedReferenceOrigins = retained;
  }
  return next;
}
/** Restore geometry against previously admitted authority; validated origin-free snapshots keep their exact legacy identity. */
export function mergeRetainedReferenceOrigins<T extends RecordedReferenceHistoryPayload>(previousPayload: RecordedReferenceHistoryPayload, restoredPayload: T): T {
  const previous = seedRecordedReferenceOrigins(previousPayload), restored = snapshotJsonValue(restoredPayload) as T;
  const retained = checkedRetainedReferenceOrigins(previous), permitted = new Map(retained.map(origin => [recordedReferenceOriginKey(origin), origin]));
  const restoredOrigins = [...checkedRetainedReferenceOrigins(restored), ...(restored.drawingMetadata?.records ?? []).filter(isRecordedReferenceMetadataRecord).map(record => record.capture.origin)];
  if (!retained.length && !restoredOrigins.length) return restoredPayload;
  if (previousPayload.id !== restoredPayload.id || previousPayload.projectCrs !== restoredPayload.projectCrs) throw new Error("Reference history restore requires the same payload identity and declared CRS.");
  for (const origin of restoredOrigins) {
    const expected = permitted.get(recordedReferenceOriginKey(origin));
    if (!expected || projectDataKey(expected) !== projectDataKey(origin)) throw new Error("Reference restore requires exact previously retained immutable authority.");
  }
  if (retained.length) {
    const schemaVersion = previous.drawingMetadata!.schemaVersion === "field-drawing-metadata-v2" ? "field-drawing-metadata-v2" : PROJECT_DRAWING_METADATA_V2_VERSION;
    restored.drawingMetadata = { ...(restored.drawingMetadata ?? { autosaveEnabled: previous.drawingMetadata!.autosaveEnabled, records: [] }),
      schemaVersion, retainedReferenceOrigins: snapshotJsonValue(retained) as RecordedReferenceOrigin[] };
  }
  return restored;
}

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
  drawingMetadata?: ProjectDrawingMetadata; projectCrs?: string | null;
  fieldBoundary: XY[]; pivotCenter: XY | null; waterSource: XY | null; powerSource: XY | null;
  mapFeatures?: ProjectMapFeature[]; obstacles: ObstacleZone[];
  surveyPoints?: SurveyPoint[]; fieldBoundaryCaptureEvidence?: Array<GnssCaptureEvidence | null>;
};

/** Historical origins join current evidence for identity consistency without promoting it into current geometry. */
function assertCombinedRecordedReferenceCaptures(owner: DrawingMetadataOwner, records: DrawingMetadataRecord[], retained: RecordedReferenceOrigin[]): void {
  const allOrigins = [...retained, ...records.filter(isRecordedReferenceMetadataRecord).map(record => record.capture.origin)];
  const originKeys = new Map<string, RecordedReferenceOrigin>();
  for (const origin of allOrigins) {
    if (origin.owner.projectCrs !== owner.projectCrs) throw new Error("Historical reference origin must match the payload's declared CRS.");
    const key = recordedReferenceOriginKey(origin), previous = originKeys.get(key);
    if (previous && projectDataKey(previous) !== projectDataKey(origin)) throw new Error("Conflicting immutable reference origin for historical owner and target.");
    originKeys.set(key, origin);
  }
  const origins = allOrigins.flatMap(origin => origin.observations);
  if (!origins.length) return; // Preserve the unchanged legacy/digitized admission contract.
  const surveyPoints = [...(owner.surveyPoints ?? []), ...origins];
  const carriers = { projectCrs: owner.projectCrs ?? null, fieldBoundary: owner.fieldBoundary,
    fieldBoundaryCaptureEvidence: owner.fieldBoundaryCaptureEvidence, surveyPoints,
    obstacles: owner.obstacles, mapFeatures: owner.mapFeatures };
  // Existing v2 and operational rules exclude capture evaluations/policy thresholds from receiver identity.
  const conflict = gnssV2CaptureConflicts(carriers)[0];
  if (conflict) throw new Error(conflict.message);
  const legacy = new Map<string, { point: XY; evidence: GnssCaptureEvidence }>();
  const checkLegacy = (point: XY, evidence: GnssCaptureEvidence | null | undefined) => {
    if (!evidence || evidence.schemaVersion !== "gnss-capture-v1") return;
    const previous = legacy.get(evidence.observationId);
    if (previous && (projectDataKey(previous.point) !== projectDataKey(point) || projectDataKey(previous.evidence) !== projectDataKey(evidence))) {
      throw new Error(`Conflicting observation ${evidence.observationId}; immutable legacy receiver payload and projected XY must match.`);
    }
    legacy.set(evidence.observationId, { point, evidence });
  };
  owner.fieldBoundary.forEach((point, index) => checkLegacy(point, owner.fieldBoundaryCaptureEvidence?.[index]));
  surveyPoints.forEach(point => checkLegacy(point.projected, point.captureEvidence));
  owner.obstacles.forEach(obstacle => obstacle.polygon.forEach((point, index) => checkLegacy(point, obstacle.vertexCaptureEvidence?.[index])));
  owner.mapFeatures?.forEach(feature => {
    const vertices = feature.geometry.type === "Point" ? [feature.geometry.point]
      : feature.geometry.type === "Circle" ? [feature.geometry.center] : feature.geometry.vertices;
    vertices.forEach((point, index) => checkLegacy(point, feature.vertexCaptureEvidence?.[index]));
  });
}

/** A classification is attached to exactly one existing geometry; no second editable XY copy is stored. */
export function validateProjectDrawingMetadata(owner: DrawingMetadataOwner): void {
  if (owner.drawingMetadata === undefined) {
    if (owner.mapFeatures?.some(feature => feature.kind.startsWith("reference_"))) {
      throw new Error("Reference feature kinds require typed drawing metadata and a current document version.");
    }
    return;
  }
  const metadata = ProjectDrawingMetadataSchema.parse(snapshotJsonValue(owner.drawingMetadata));
  const retained = metadata.retainedReferenceOrigins ?? [], retainedKeys = new Set<string>();
  for (const origin of retained) {
    const key = recordedReferenceOriginKey(origin);
    if (retainedKeys.has(key)) throw new Error("Duplicate retained reference origin for historical owner and target.");
    retainedKeys.add(key);
  }
  assertCombinedRecordedReferenceCaptures(owner, metadata.records, retained);
  const targets = new Set<string>();
  const captures = new Set<string>();
  for (const record of metadata.records) {
    const key = drawingMetadataTargetKey(record.target);
    if (targets.has(key)) throw new Error("Duplicate drawing metadata target.");
    targets.add(key);
    if (isRecordedReferenceMetadataRecord(record)) {
      const matches = owner.mapFeatures?.filter(feature => feature.id === record.target.id) ?? [];
      if (matches.length !== 1 || owner.projectCrs == null) throw new Error("Recorded reference requires one canonical feature and declared CRS.");
      validateRecordedReferenceMetadata(record, { feature: matches[0], projectCrs: owner.projectCrs });
      continue;
    }
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
