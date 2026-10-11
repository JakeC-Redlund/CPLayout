import { z } from "zod";
import { seedRecordedReferenceOrigins, PROJECT_DRAWING_METADATA_V2_VERSION, isRecordedReferenceMetadataRecord, validateRecordedReferenceMetadata,
  RecordedReferenceMetadataRecordSchema, weakestRecordedReferenceConfidence, type RecordedReferenceMetadataRecord } from "./drawingMetadata";
import { FIELD_DRAWING_METADATA_V2_VERSION } from "./fieldDesignDocument";
import { RecordedReferencePurposeSchema, SurveyCollectionOwnerSchema, SurveyCollectionIdSchema, SurveyCollectionRevisionSchema } from "./surveyCollectionSchemas";
import type { SurveyCollectionOwner, SurveyApplicationReceipt } from "./surveyCollectionSchemas";
import { parseDesignDraftDocument, serializeDesignDraftDocument, type DesignDraft } from "./designDraft";
import { parseFieldDesignDocument, serializeFieldDesignDocument, type FieldDesign } from "./fieldDesignDocument";
import { parseProjectDocument, serializeProjectDocument, PivotProjectSchema } from "./projectDocument";
import { assertNoStrippedFields } from "./jsonFieldRetention";
import { parseStrictJson } from "./strictJson";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { projectDataKey } from "./projectDataComparison";
import { sha256Text } from "./sha256";
import { proposeSurveyApplication, validateSurveyCollection, type SurveyCollection } from "./surveyCollection";
import type { PivotProject, ProjectMapFeature, ProjectMapFeatureGeometry, SurveyPoint, XY } from "./types";

export type SurveyDesignKind = "project" | "draft" | "field";
export function readSurveyDesignDocument(kind: "project", document: string): PivotProject;
export function readSurveyDesignDocument(kind: "draft", document: string): DesignDraft;
export function readSurveyDesignDocument(kind: "field", document: string): FieldDesign;
export function readSurveyDesignDocument(kind: SurveyDesignKind, document: string): PivotProject | DesignDraft | FieldDesign;
export function readSurveyDesignDocument(kind: SurveyDesignKind, document: string) {
  if (kind === "draft") return parseDesignDraftDocument(document);
  if (kind === "field") return parseFieldDesignDocument(document);
  const raw = parseStrictJson(document);
  parseProjectDocument(raw); // Current version/domain admission, including retained evidence.
  const wrapped = raw && typeof raw === "object" && "documentVersion" in raw;
  const source = wrapped ? (raw as unknown as { project: unknown }).project : raw;
  const checked = PivotProjectSchema.parse(source);
  assertNoStrippedFields(raw, wrapped ? { documentVersion: (raw as { documentVersion: string }).documentVersion, project: checked } : checked,
    "Survey mutation refuses unsupported source properties; retain the original document.");
  return snapshotJsonValue(source) as PivotProject;
}
function write(kind: SurveyDesignKind, data: ReturnType<typeof readSurveyDesignDocument>, geometryChanged = false): string {
  if (kind === "draft") {
    if (geometryChanged) delete (data as ReturnType<typeof parseDesignDraftDocument>).wgs84Companion;
    return serializeDesignDraftDocument(data as ReturnType<typeof parseDesignDraftDocument>);
  }
  if (kind === "field") return serializeFieldDesignDocument(data as ReturnType<typeof parseFieldDesignDocument>);
  const encoded = parseStrictJson(serializeProjectDocument(data as PivotProject)) as { documentVersion: string; project: PivotProject };
  const exact = snapshotJsonValue(data) as PivotProject;
  if (geometryChanged) exact.wgs84Companion = encoded.project.wgs84Companion;
  encoded.project = exact;
  const document = JSON.stringify(encoded);
  readSurveyDesignDocument(kind, document);
  return document;
}
/** Inserts the actual observed point only. Role labels never promote a pivot or infrastructure. */
export function appendSurveyPointToDesign(kind: SurveyDesignKind, document: string, point: SurveyPoint): string {
  const data = readSurveyDesignDocument(kind, document);
  const captured = snapshotJsonValue(point, "Survey point") as SurveyPoint;
  const existing = data.surveyPoints.find(item => item.id === captured.id);
  if (existing && projectDataKey(existing) !== projectDataKey(captured)) throw new Error("Survey point identity conflicts with the design record.");
  if (!existing) data.surveyPoints.push(captured);
  return write(kind, data);
}

/** Detached consistency proposal. The store must still check and commit both revisions atomically. */
export function proposeRecordedReferenceApplication(inputCollection: SurveyCollection, input: {
  expectedCollectionRevision: number; expectedOwner: SurveyCollectionOwner;
  acceptedDesignRevision: number; applicationId: string; targetId: string; name: string; notes?: string; now: string;
}): { feature: ProjectMapFeature; record: RecordedReferenceMetadataRecord; collection: SurveyCollection; receipt: SurveyApplicationReceipt } {
  const args = z.object({ expectedCollectionRevision: SurveyCollectionRevisionSchema, expectedOwner: SurveyCollectionOwnerSchema,
    acceptedDesignRevision: SurveyCollectionRevisionSchema.refine(value => value > 0, "Use the accepted design revision D+1."),
    applicationId: SurveyCollectionIdSchema, targetId: SurveyCollectionIdSchema, name: z.string().min(1), notes: z.string().optional(), now: z.iso.datetime({ offset: true }),
  }).strict().parse(snapshotJsonValue(input));
  const collection = validateSurveyCollection(inputCollection), purpose = RecordedReferencePurposeSchema.parse(collection.purpose);
  if (projectDataKey(collection.owner) !== projectDataKey(args.expectedOwner)) throw new Error("Recorded reference collection owner differs from the expected owner.");
  if (collection.revision !== args.expectedCollectionRevision) throw new Error("Survey revision changed; use the current collection.");
  const byId = new Map(collection.observations.map(point => [point.id, point]));
  const observations = collection.activePointIds.map(id => snapshotJsonValue(byId.get(id)!) as SurveyPoint);
  const vertices = observations.map(point => ({ x: point.projected.x, y: point.projected.y }));
  const geometry: ProjectMapFeatureGeometry = purpose.geometryType === "Point" ? { type: "Point", point: vertices[0] } : { type: purpose.geometryType, vertices };
  const receipt: SurveyApplicationReceipt = { id: args.applicationId, appliedAt: args.now, designRevision: args.acceptedDesignRevision,
    target: { kind: "map_feature", id: args.targetId }, sourcePointIds: [...collection.activePointIds], geometryHash: sha256Text(JSON.stringify(geometry)) };
  const accepted = proposeSurveyApplication(collection, { expectedRevision: args.expectedCollectionRevision, now: args.now, receipt });
  const meaning = { featureKind: purpose.featureKind, geometryType: purpose.geometryType, name: args.name, ...(args.notes === undefined ? {} : { notes: args.notes }) };
  const record: RecordedReferenceMetadataRecord = { target: { kind: "map_feature", id: args.targetId }, meaning, binding: "recorded",
    attachment: { collectionId: collection.id, applicationId: receipt.id }, capture: { source: "recorded_survey", origin: {
      collectionId: collection.id, owner: snapshotJsonValue(collection.owner) as SurveyCollectionOwner,
      sourceCollectionRevision: collection.revision, purpose, receipt: snapshotJsonValue(receipt) as SurveyApplicationReceipt, observations,
    } } };
  const feature: ProjectMapFeature = { id: args.targetId, name: args.name, ...(args.notes === undefined ? {} : { notes: args.notes }),
    kind: purpose.featureKind, geometry, confidence: weakestRecordedReferenceConfidence(observations), vertexCaptureEvidence: observations.map(point => point.captureEvidence!) };
  validateRecordedReferenceMetadata(record, { feature, projectCrs: collection.owner.projectCrs });
  assertRecordedReferenceAttachment(record, accepted, args.expectedOwner);
  return { feature, record, collection: accepted, receipt: snapshotJsonValue(receipt) as SurveyApplicationReceipt };
}

/** Current locators resolve only inside a checked owning graph; origins remain historical. */
export function assertRecordedReferenceAttachment(input: RecordedReferenceMetadataRecord, inputCollection: SurveyCollection, expectedOwner: SurveyCollectionOwner): void {
  const snapshot = snapshotJsonValue(input), record = RecordedReferenceMetadataRecordSchema.parse(snapshot);
  if (projectDataKey(snapshot as object) !== projectDataKey(record)) throw new Error("Recorded reference attachment cannot strip or normalize immutable snapshots.");
  SurveyCollectionOwnerSchema.parse(snapshotJsonValue(expectedOwner));
  if (!record.attachment) return;
  const collection = validateSurveyCollection(inputCollection), origin = record.capture.origin;
  if (collection.id !== record.attachment.collectionId || projectDataKey(collection.owner) !== projectDataKey(expectedOwner)) throw new Error("Recorded reference attachment must resolve to its current collection and owner.");
  if (projectDataKey(collection.purpose) !== projectDataKey(origin.purpose)) throw new Error("Recorded reference attachment pinned purpose differs from origin.");
  const receipts = collection.applications.filter(receipt => receipt.id === record.attachment!.applicationId);
  if (receipts.length !== 1 || projectDataKey(receipts[0]) !== projectDataKey(origin.receipt)) throw new Error("Recorded reference attachment must resolve to its exact historical receipt.");
  const byId = new Map(collection.observations.map(point => [point.id, point]));
  const observations = origin.receipt.sourcePointIds.map(id => byId.get(id));
  if (observations.some(point => point === undefined) || projectDataKey(observations as object[]) !== projectDataKey(origin.observations)) throw new Error("Recorded reference attachment source snapshots differ from immutable origin.");
}
export function assertRecordedReferenceAttachments(records: readonly { capture: { source: string } }[], collections: readonly SurveyCollection[], expectedOwner: SurveyCollectionOwner): void {
  const locators = new Set<string>();
  for (const record of records) {
    if (!isRecordedReferenceMetadataRecord(record) || !record.attachment) continue;
    const locator = JSON.stringify([record.attachment.collectionId, record.attachment.applicationId]);
    if (locators.has(locator)) throw new Error("Duplicate recorded reference attachment locator.");
    locators.add(locator);
    const matches = collections.filter(collection => collection.id === record.attachment!.collectionId);
    if (matches.length !== 1) throw new Error("Recorded reference attachment requires exactly one current collection.");
    assertRecordedReferenceAttachment(record, matches[0], expectedOwner);
  }
}

/** Pure recorded application. Caller must atomically save the returned domain document and
 * collection with their expected revisions. No live connection or current freshness is needed. */
export function applySurveyCollectionToDesign(kind: SurveyDesignKind, document: string, inputCollection: SurveyCollection,
  input: { applicationId: string; now: string; designRevision: number; targetId?: string; reference?: { name: string; notes?: string } }): { document: string; collection: SurveyCollection } {
  const collection = validateSurveyCollection(inputCollection), data = readSurveyDesignDocument(kind, document);
  if (collection.owner.documentKind !== kind || collection.owner.payloadId !== data.id || collection.owner.projectCrs !== data.projectCrs) throw new Error("Survey application owner differs from the actual design document.");
  const isReference = collection.purpose.kind === "map_feature" && collection.purpose.featureKind.startsWith("reference_");
  if (isReference) {
    if (!input.reference) throw new Error("Reference Survey capture remains recorded and pending: supply an actual reference name and optional notes; receiver evidence cannot be relabelled as digitized.");
    const reference = z.object({ name: z.string().min(1), notes: z.string().optional() }).strict().parse(snapshotJsonValue(input.reference));
    if (!input.targetId || data.mapFeatures?.some(feature => feature.id === input.targetId)) throw new Error("Recorded reference feature requires a new target identity.");
    const proposal = proposeRecordedReferenceApplication(collection, { expectedCollectionRevision: collection.revision, expectedOwner: collection.owner,
      acceptedDesignRevision: input.designRevision, applicationId: input.applicationId, targetId: input.targetId, ...reference, now: input.now });
    data.mapFeatures = [...(data.mapFeatures ?? []), proposal.feature];
    const schemaVersion = kind === "field" ? FIELD_DRAWING_METADATA_V2_VERSION : PROJECT_DRAWING_METADATA_V2_VERSION;
    data.drawingMetadata = { ...data.drawingMetadata, schemaVersion, autosaveEnabled: data.drawingMetadata?.autosaveEnabled ?? ("drawingWorkflow" in data ? data.drawingWorkflow?.autosaveEnabled : undefined) ?? true,
      records: [...(data.drawingMetadata?.records ?? []), proposal.record] } as typeof data.drawingMetadata;
    return { document: write(kind, seedRecordedReferenceOrigins(data), true), collection: proposal.collection };
  }
  if (input.reference !== undefined) throw new Error("Reference name and notes are only admitted for reference Survey purposes.");
  const byId = new Map(collection.observations.map(point => [point.id, point]));
  const points = collection.activePointIds.map(id => byId.get(id)!);
  if (!points.length) throw new Error("Survey collection has no recorded geometry to apply.");
  const vertices = points.map(point => ({ ...point.projected }));
  const evidence = points.map(point => point.captureEvidence!);
  const purpose = collection.purpose;
  const geometry: ProjectMapFeatureGeometry = purpose.kind === "point" || (purpose.kind === "map_feature" && purpose.geometryType === "Point")
    ? { type: "Point", point: vertices[0] }
    : { type: purpose.kind === "map_feature" ? purpose.geometryType as "LineString" | "Polygon" : "Polygon", vertices };
  const target = purpose.kind === "point" ? { kind: "survey_point" as const, pointId: points[0].id }
    : purpose.kind === "field_boundary" ? { kind: "field_boundary" as const }
      : { kind: purpose.kind, id: input.targetId ?? "" };
  const accepted = proposeSurveyApplication(collection, { expectedRevision: collection.revision, now: input.now,
    receipt: { id: input.applicationId, appliedAt: input.now, designRevision: input.designRevision,
      target, sourcePointIds: [...collection.activePointIds], geometryHash: sha256Text(JSON.stringify(geometry)) } });
  if (purpose.kind === "point") return { document: appendSurveyPointToDesign(kind, document, points[0]), collection: accepted };
  let geometryChanged = true;
  if (purpose.kind === "field_boundary") {
    geometryChanged = projectDataKey(data.fieldBoundary) !== projectDataKey(vertices);
    data.fieldBoundary = vertices; data.fieldBoundaryCaptureEvidence = evidence;
    if (data.drawingMetadata) data.drawingMetadata.records = data.drawingMetadata.records.filter(record => record.target.kind !== "field_boundary");
  } else if (purpose.kind === "obstacle") {
    if (data.obstacles.some(item => item.id === input.targetId)) throw new Error("Survey obstacle identity is already used.");
    data.obstacles.push({ id: input.targetId!, name: `Recorded ${purpose.obstacleKind}`, kind: purpose.obstacleKind, polygon: vertices,
      bufferMeters: 0, hardConflict: true, noSpray: true, confidence: weakest(points), vertexCaptureEvidence: evidence });
  } else {
    if (data.mapFeatures?.some(item => item.id === input.targetId)) throw new Error("Survey feature identity is already used.");
    if (["planning_boundary", "machine_zone", "end_gun_arc", "corner_swing_limit"].includes(purpose.featureKind)
      && (data.fieldBoundary.length < 3 || vertices.some(point => !inside(point, data.fieldBoundary)))) throw new Error("Recorded layout-control geometry must lie inside the actual design boundary.");
    data.mapFeatures = [...(data.mapFeatures ?? []), { id: input.targetId!, name: `Recorded ${purpose.featureKind.replaceAll("_", " ")}`,
      kind: purpose.featureKind, geometry, confidence: weakest(points), vertexCaptureEvidence: evidence }];
  }
  return { document: write(kind, data, geometryChanged), collection: accepted };
}
function inside(point: XY, ring: XY[]): boolean {
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i];
    const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
    const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
    const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (lengthSquared === 0 ? point.x === a.x && point.y === a.y : Math.abs(cross) < 0.000001 && dot >= 0 && dot <= lengthSquared) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) contained = !contained;
  }
  return contained;
}
function weakest(points: SurveyPoint[]): SurveyPoint["confidence"] {
  const levels: SurveyPoint["confidence"][] = ["rtk_fixed", "rtk_float", "dgps", "autonomous_gps", "imagery_digitized", "imported_cad", "user_estimated", "optimized"];
  return levels[Math.max(...points.map(point => levels.indexOf(point.confidence)))];
}
