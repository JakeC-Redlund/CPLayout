import { z } from "zod";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { projectDataKey } from "./projectDataComparison";
import { sha256Text } from "./sha256";
import { parseStrictJson } from "./strictJson";
import { parseSurveyCollectionDocument, type SurveyCollection } from "./surveyCollection";
import { SurveyCollectionOwnerSchema, type SurveyCollectionOwner } from "./surveyCollectionSchemas";
import { readSurveyDesignDocument } from "./surveyCollectionApplication";
import { qualifyProjectCrs } from "./crsQualification";

export const SURVEY_REVIEW_VERSION = "survey-review-v1";
const id = z.string().min(1).max(500).refine(value => value.trim().length > 0, "A nonblank identity is required."), hash = z.string().regex(/^[a-f0-9]{64}$/);
const ReviewSchema = z.object({
  documentVersion: z.literal(SURVEY_REVIEW_VERSION), id, owner: SurveyCollectionOwnerSchema,
  completedBy: id, completedAt: z.iso.datetime({ offset: true }), sourceRevision: z.number().int().nonnegative().safe(),
  sourceDocument: z.string().min(1), sourceHash: hash, geometrySignature: hash,
  includedCollectionIds: z.array(id).min(1), excludedCollectionIds: z.array(id),
  collections: z.array(z.object({ id, document: z.string().min(1), signature: hash }).strict()).min(1),
  qualification: z.literal("operator_reviewed_receiver_evidence"),
}).strict();
export type SurveyReview = z.infer<typeof ReviewSchema>;

/** Names, display units and catalog metadata are not geometry or measurement evidence. */
export function surveyGeometrySignature(kind: SurveyCollectionOwner["documentKind"], document: string): string {
  const data = readSurveyDesignDocument(kind, document);
  const field = data as typeof data & { infrastructure?: unknown[]; machines?: Array<{ id: string; pivotCenter: unknown; pivotObservationId?: string }>;
    lateralMachines?: Array<{ id: string; travel: unknown }> };
  return sha256Text(projectDataKey({ projectCrs: data.projectCrs, fieldBoundary: data.fieldBoundary,
    fieldBoundaryCaptureEvidence: data.fieldBoundaryCaptureEvidence ?? null,
    surveyPoints: data.surveyPoints,
    obstacles: data.obstacles.map(item => ({ id: item.id, polygon: item.polygon, vertexCaptureEvidence: item.vertexCaptureEvidence ?? null })),
    mapFeatures: (data.mapFeatures ?? []).map(item => ({ id: item.id, kind: item.kind, geometry: item.geometry, vertexCaptureEvidence: item.vertexCaptureEvidence ?? null })),
    locations: { pivotCenter: "pivotCenter" in data ? data.pivotCenter : null,
      waterSource: "waterSource" in data ? data.waterSource : null, powerSource: "powerSource" in data ? data.powerSource : null },
    infrastructure: field.infrastructure ?? null,
    machines: field.machines?.map(item => ({ id: item.id, pivotCenter: item.pivotCenter, pivotObservationId: item.pivotObservationId ?? null })) ?? null,
    lateralMachines: field.lateralMachines?.map(item => ({ id: item.id, travel: item.travel })) ?? null,
  }));
}
export function surveyCollectionSignature(collection: SurveyCollection): string {
  const checked = parseSurveyCollectionDocument(collection);
  return sha256Text(projectDataKey({ owner: checked.owner, purpose: checked.purpose, state: checked.state,
    observations: checked.observations, activePointIds: checked.activePointIds, applications: checked.applications }));
}
export interface CreateSurveyReviewInput {
  id: string; owner: SurveyCollectionOwner; completedBy: string; completedAt: string; sourceRevision: number;
  sourceDocument: string; collections: readonly { id: string; document: string }[];
  includedCollectionIds: readonly string[]; excludedCollectionIds: readonly string[];
}
export function createSurveyReview(input: CreateSurveyReviewInput): SurveyReview {
  const owner = SurveyCollectionOwnerSchema.parse(snapshotJsonValue(input.owner));
  const data = readSurveyDesignDocument(owner.documentKind, input.sourceDocument);
  if (data.id !== owner.payloadId || data.projectCrs !== owner.projectCrs) throw new Error("Survey review belongs to another document or coordinate system.");
  const crs = qualifyProjectCrs(owner.projectCrs);
  if (!crs.calculation.allowed || crs.wgs84Transform !== "projection_only") throw new Error("Survey review requires a supported receiver coordinate transformation.");
  const collections = input.collections.map(entry => ({ ...entry, parsed: parseSurveyCollectionDocument(entry.document) }));
  const all = collections.map(entry => entry.id), scope = [...input.includedCollectionIds, ...input.excludedCollectionIds];
  if (new Set(all).size !== all.length || new Set(scope).size !== scope.length || scope.length !== all.length
    || scope.some(value => !all.includes(value)) || !input.includedCollectionIds.length) throw new Error("Review must explicitly include or exclude every owned Survey collection exactly once.");
  let meaningful = false;
  for (const entry of collections) {
    const collection = entry.parsed;
    if (entry.id !== collection.id || projectDataKey(collection.owner) !== projectDataKey(owner)) throw new Error("Survey review collection has foreign ownership.");
    if (!input.includedCollectionIds.includes(entry.id)) continue;
    if (collection.state === "archived" || collection.state === "cleared") throw new Error("Archived or cleared Survey cannot qualify a new review.");
    const receipt = collection.applications.at(-1);
    if (collection.purpose.kind !== "point" && (collection.state !== "applied" || !receipt)) throw new Error("Apply included recorded lines and areas before completing Survey.");
    const ids = collection.purpose.kind === "point" ? collection.activePointIds : receipt?.sourcePointIds ?? [];
    const points = ids.map(pointId => collection.observations.find(point => point.id === pointId));
    if (!points.length || points.some(point => !point)) throw new Error("Included Survey requires actual reviewed observations.");
    if (collection.purpose.kind === "point") {
      if (points.length !== 1 || !data.surveyPoints.some(point => projectDataKey(point) === projectDataKey(points[0]!))) throw new Error("Reviewed point must equal its actual saved document observation.");
    } else {
      if (collection.state !== "applied" || !receipt) throw new Error("Apply included recorded lines and areas before completing Survey.");
      const target = receipt.target;
      const geometry = target.kind === "field_boundary" ? { type: "Polygon", vertices: data.fieldBoundary }
        : target.kind === "obstacle" ? (() => { const obstacle = data.obstacles.find(item => item.id === target.id); return obstacle ? { type: "Polygon", vertices: obstacle.polygon } : null; })()
          : target.kind === "map_feature" ? data.mapFeatures?.find(item => item.id === target.id)?.geometry : null;
      if (!geometry || sha256Text(JSON.stringify(geometry)) !== receipt.geometryHash) throw new Error("Reviewed shape no longer matches its applied geometry.");
    }
    meaningful ||= points.some(point => point?.captureEvidence?.schemaVersion === "gnss-operational-fixed-v1"
      && ["control", "boundary", "pivot_center"].includes(point.role));
  }
  if (!meaningful) throw new Error("Complete Survey requires an actual fixed control, boundary or pivot observation; notes alone do not qualify.");
  return ReviewSchema.parse({ documentVersion: SURVEY_REVIEW_VERSION, id: input.id, owner,
    completedBy: input.completedBy, completedAt: input.completedAt, sourceRevision: input.sourceRevision,
    sourceDocument: input.sourceDocument, sourceHash: sha256Text(input.sourceDocument), geometrySignature: surveyGeometrySignature(owner.documentKind, input.sourceDocument),
    includedCollectionIds: [...input.includedCollectionIds], excludedCollectionIds: [...input.excludedCollectionIds],
    collections: collections.map(entry => ({ id: entry.id, document: entry.document, signature: surveyCollectionSignature(entry.parsed) })),
    qualification: "operator_reviewed_receiver_evidence" });
}
export function parseSurveyReview(input: string | unknown): SurveyReview {
  const raw = snapshotJsonValue(typeof input === "string" ? parseStrictJson(input) : input);
  const review = ReviewSchema.parse(raw);
  const rebuilt = createSurveyReview({ ...review, collections: review.collections });
  if (projectDataKey(raw as object) !== projectDataKey(rebuilt)) throw new Error("Survey review snapshots, signatures or unsupported fields differ from their exact evidence.");
  return rebuilt;
}
export function serializeSurveyReview(review: SurveyReview): string { return JSON.stringify(parseSurveyReview(review)); }
export function surveyReviewIsCurrent(review: SurveyReview, owner: SurveyCollectionOwner, document: string,
  collections: readonly { id: string; document: string }[]): boolean {
  const checked = parseSurveyReview(review);
  if (projectDataKey(checked.owner) !== projectDataKey(owner) || checked.geometrySignature !== surveyGeometrySignature(owner.documentKind, document)) return false;
  // Excluded new work stays retained; it is not a reason to silently broaden completion.
  return checked.includedCollectionIds.every(value => {
    const pinned = checked.collections.find(entry => entry.id === value), current = collections.find(entry => entry.id === value);
    return !!pinned && !!current && pinned.signature === surveyCollectionSignature(parseSurveyCollectionDocument(current.document));
  });
}
