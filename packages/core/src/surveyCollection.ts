import { z } from "zod";
import { SurveyPointSchema } from "./surveyPointSchema";
import { MAX_SURVEY_ACTIVE_POINTS, MAX_SURVEY_RETAINED_POINTS, SurveyCollectionIdSchema, SurveyCollectionRevisionSchema,
  SurveyCollectionOwnerSchema, SurveyApplicationReceiptSchema, type SurveyCollectionOwner, type SurveyApplicationReceipt } from "./surveyCollectionSchemas";
import { gnssV2CaptureConflicts } from "./gnssEvidence";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { validateDraftBoundary } from "./manualDesign";
import { assertOperationalProjection } from "./operationalGnssEvidence";
import { projectDataKey } from "./projectDataComparison";
import { PivotProjectSchema } from "./projectDocument";
import { parseStrictJson } from "./strictJson";
import { assertProjectedCrs } from "./units";
import type { SurveyPoint } from "./types";

export const SURVEY_COLLECTION_DOCUMENT_VERSION = "survey-collection-v1";
export { MAX_SURVEY_ACTIVE_POINTS, MAX_SURVEY_RETAINED_POINTS, SurveyCollectionOwnerSchema, SurveyApplicationReceiptSchema } from "./surveyCollectionSchemas";
export type { SurveyCollectionOwner, SurveyApplicationReceipt } from "./surveyCollectionSchemas";
const id = SurveyCollectionIdSchema, revision = SurveyCollectionRevisionSchema;
const timestamp = z.iso.datetime({ offset: true });
const geometryType = z.enum(["Point", "LineString", "Polygon"]);
const pointSchema = SurveyPointSchema;
const featureKind = PivotProjectSchema.shape.mapFeatures.unwrap().unwrap().element.shape.kind;

export const SurveyCollectionPurposeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("point"), role: pointSchema.shape.role }).strict(),
  z.object({ kind: z.literal("field_boundary") }).strict(),
  z.object({ kind: z.literal("obstacle"), obstacleKind: PivotProjectSchema.shape.obstacles.element.shape.kind }).strict(),
  z.object({ kind: z.literal("map_feature"), featureKind, geometryType }).strict(),
]);
export type SurveyCollectionPurpose = z.infer<typeof SurveyCollectionPurposeSchema>;
const CollectionSchema = z.object({
  documentVersion: z.literal(SURVEY_COLLECTION_DOCUMENT_VERSION), id, revision,
  owner: SurveyCollectionOwnerSchema, purpose: SurveyCollectionPurposeSchema,
  createdAt: timestamp, updatedAt: timestamp,
  state: z.enum(["pending", "applied", "cleared", "archived"]),
  observations: z.array(pointSchema).max(MAX_SURVEY_RETAINED_POINTS),
  activePointIds: z.array(id).max(MAX_SURVEY_ACTIVE_POINTS),
  applications: z.array(SurveyApplicationReceiptSchema).max(MAX_SURVEY_RETAINED_POINTS),
}).strict();
export type SurveyCollection = z.infer<typeof CollectionSchema>;

/** Pure data validation cannot prove live transport, current mode, ownership or commit freshness. */
export interface SurveyCaptureCommitRequirement {
  collectionId: string;
  expectedCollectionRevision: number;
  owner: SurveyCollectionOwner;
  receiverSessionId: string;
  receiverObservationId: string;
  projectionId: string;
  maximumObservationAgeMs: 2000;
}
export interface SurveyCaptureProposal {
  collection: SurveyCollection;
  /** The store/controller MUST recheck this under its write lock AND before atomic persistence.
   * It must additionally check document/editor and mode generations, expected document/workspace
   * revisions, connected session, unchanged live observation, resolved projection and monotonic age.
   * This descriptor is a required condition, never evidence that those live checks passed. */
  commitRequirement: SurveyCaptureCommitRequirement;
}

export function parseSurveyCollectionDocument(input: string | unknown): SurveyCollection {
  return validateSurveyCollection(typeof input === "string" ? parseStrictJson(input) : input);
}
export function serializeSurveyCollectionDocument(collection: SurveyCollection): string {
  return JSON.stringify(validateSurveyCollection(collection));
}

/** Return the supplied detached values, never schema-normalized observations or injected defaults. */
export function validateSurveyCollection(input: unknown): SurveyCollection {
  const snapshot = snapshotJsonValue(input, "Survey collection");
  assertDefinedJson(snapshot);
  const parsed = CollectionSchema.parse(snapshot);
  if (projectDataKey(snapshot as object) !== projectDataKey(parsed)) throw new Error("Survey collection contains unsupported or normalized data; preserve the original document.");
  const collection = snapshot as SurveyCollection;
  assertProjectedCrs(collection.owner.projectCrs);
  assertPurpose(collection.purpose);
  if (Date.parse(collection.updatedAt) < Date.parse(collection.createdAt)) throw new Error("Survey update predates creation.");
  const pointIds = new Set<string>();
  const receiverIds = new Set<string>();
  for (const point of collection.observations) {
    if (pointIds.has(point.id)) throw new Error("Duplicate Survey record identity.");
    pointIds.add(point.id);
    const evidence = point.captureEvidence;
    if (!evidence) throw new Error("A Survey collection record requires its actual retained capture evidence.");
    if (collection.purpose.kind === "point" && point.role !== collection.purpose.role) throw new Error("Survey observation role differs from the pinned point purpose.");
    if (receiverIds.has(evidence.observationId)) throw new Error("Duplicate receiver observation identity in Survey collection.");
    receiverIds.add(evidence.observationId);
    if (evidence.schemaVersion === "gnss-operational-fixed-v1") {
      assertOperationalProjection(evidence, point.projected, collection.owner.projectCrs);
      if (point.source !== "external_gnss" || point.confidence !== "rtk_fixed") throw new Error("Operational Survey source and confidence must retain external fixed-GGA provenance.");
      if (point.wgs84 && (Math.abs(point.wgs84.latitude - evidence.gga.latitude) > 1e-10 || Math.abs(point.wgs84.longitude - evidence.gga.longitude) > 1e-10)) throw new Error("Survey WGS84 differs from its retained GGA.");
      if (point.rtk && (point.rtk.fixType !== "rtk_fixed" || point.rtk.nmeaQualityCode !== 4)) throw new Error("Survey quality differs from its retained fixed GGA.");
    }
  }
  const conflicts = gnssV2CaptureConflicts({ projectCrs: collection.owner.projectCrs,
    fieldBoundary: [], obstacles: [], surveyPoints: collection.observations });
  if (conflicts.length) throw new Error(conflicts[0].message);
  assertReferences(collection.activePointIds, pointIds);
  if (surveyPurposeGeometryType(collection.purpose) === "Point" && collection.activePointIds.length > 1) throw new Error("Point collection permits one active point.");
  if ((collection.state === "applied" || collection.state === "cleared") && collection.activePointIds.length) throw new Error("Applied or cleared collection cannot retain active membership.");
  if (collection.state === "applied" && !collection.applications.length) throw new Error("Applied collection needs its historical application receipt.");
  const applicationIds = new Set<string>();
  for (const receipt of collection.applications) {
    if (applicationIds.has(receipt.id)) throw new Error("Duplicate Survey application identity.");
    applicationIds.add(receipt.id);
    if (Date.parse(receipt.appliedAt) < Date.parse(collection.createdAt) || Date.parse(receipt.appliedAt) > Date.parse(collection.updatedAt)) throw new Error("Survey application time lies outside collection history.");
    assertReferences(receipt.sourcePointIds, pointIds);
    assertTarget(collection.purpose, receipt.target, receipt.sourcePointIds);
    assertApplicationGeometry(collection, receipt.sourcePointIds);
  }
  return collection;
}

export function surveyPurposeGeometryType(purpose: SurveyCollectionPurpose): "Point" | "LineString" | "Polygon" {
  return purpose.kind === "point" ? "Point" : purpose.kind === "map_feature" ? purpose.geometryType : "Polygon";
}
export function createSurveyCollection(input: { id: string; owner: SurveyCollectionOwner; purpose: SurveyCollectionPurpose; now: string }): SurveyCollection {
  const args = z.object({ id, owner: SurveyCollectionOwnerSchema, purpose: SurveyCollectionPurposeSchema, now: timestamp }).strict().parse(detach(input));
  return validateSurveyCollection({ documentVersion: SURVEY_COLLECTION_DOCUMENT_VERSION, id: args.id,
    revision: 0, owner: args.owner, purpose: args.purpose, createdAt: args.now, updatedAt: args.now,
    state: "pending", observations: [], activePointIds: [], applications: [] });
}

/** The name is a proposal: only the external guarded transaction can admit this as a new live capture. */
export function proposeSurveyCaptureAppend(inputCollection: SurveyCollection, input: { expectedRevision: number; point: SurveyPoint; now: string }): SurveyCaptureProposal {
  const args = z.object({ expectedRevision: revision, point: pointSchema, now: timestamp }).strict().parse(detach(input));
  // Refuse any nested stripped data before the schema result could hide it.
  if (projectDataKey(args) !== projectDataKey(detach(input) as object)) throw new Error("Survey append cannot strip or normalize observation data.");
  const collection = checked(inputCollection, args.expectedRevision, args.now);
  if (collection.state !== "pending") throw new Error("Resume a pending Survey collection before adding captures.");
  const evidence = args.point.captureEvidence;
  if (evidence?.schemaVersion !== "gnss-operational-fixed-v1") throw new Error("New-live Survey append requires supported operational fixed-GGA evidence; historical records are imported as historical data.");
  if (collection.purpose.kind === "point" && args.point.role !== collection.purpose.role) throw new Error("Survey point role differs from the pinned purpose.");
  const next = validateSurveyCollection({ ...collection, revision: nextRevision(collection.revision), updatedAt: args.now,
    observations: [...collection.observations, detach(input.point)], activePointIds: [...collection.activePointIds, args.point.id] });
  assertSurveyCollectionTransition(collection, next);
  return { collection: next, commitRequirement: { collectionId: collection.id, expectedCollectionRevision: collection.revision,
    owner: { ...collection.owner }, receiverSessionId: evidence.sessionId, receiverObservationId: evidence.observationId,
    projectionId: evidence.projection.id, maximumObservationAgeMs: 2000 } };
}

export function proposeSurveyRemoveLast(collection: SurveyCollection, input: { expectedRevision: number; now: string }): SurveyCollection {
  const args = mutationArgs(input);
  const current = checked(collection, args.expectedRevision, args.now);
  if (current.state !== "pending" || !current.activePointIds.length) throw new Error("Pending Survey collection has no active point to remove.");
  return membership(current, current.activePointIds.slice(0, -1), "pending", args.now);
}
export function proposeSurveyClear(collection: SurveyCollection, input: { expectedRevision: number; now: string }): SurveyCollection {
  const args = mutationArgs(input);
  const current = checked(collection, args.expectedRevision, args.now);
  if (current.state === "archived") throw new Error("Archived Survey collection cannot be cleared.");
  return membership(current, [], "cleared", args.now);
}
/** Undo/redo restores membership, not an old ledger snapshot; source evidence and receipts remain exact. */
export function proposeSurveyMembershipRestore(collection: SurveyCollection, input: { expectedRevision: number; now: string; activePointIds: string[]; state: "pending" | "applied" | "cleared" }): SurveyCollection {
  const args = z.object({ expectedRevision: revision, now: timestamp, activePointIds: z.array(id).max(MAX_SURVEY_ACTIVE_POINTS), state: z.enum(["pending", "applied", "cleared"]) }).strict().parse(detach(input));
  const current = checked(collection, args.expectedRevision, args.now);
  if (current.state === "archived") throw new Error("Restore the archived owner explicitly before editing Survey membership.");
  return membership(current, args.activePointIds, args.state, args.now);
}
/** Historical shape application is independent of a live receiver. Domain geometry and this receipt
 * MUST commit together after document/owner/revision validation; the hash here is not render proof. */
export function proposeSurveyApplication(collection: SurveyCollection, input: { expectedRevision: number; now: string; receipt: SurveyApplicationReceipt }): SurveyCollection {
  const args = z.object({ expectedRevision: revision, now: timestamp, receipt: SurveyApplicationReceiptSchema }).strict().parse(detach(input));
  const current = checked(collection, args.expectedRevision, args.now);
  if (current.state !== "pending" || projectDataKey(args.receipt.sourcePointIds) !== projectDataKey(current.activePointIds)) throw new Error("Survey application must use the exact current ordered pending membership.");
  if (args.receipt.appliedAt !== args.now) throw new Error("Application receipt must use this transaction's time.");
  const next = validateSurveyCollection({ ...current, revision: nextRevision(current.revision), updatedAt: args.now,
    state: "applied", activePointIds: [], applications: [...current.applications, args.receipt] });
  assertSurveyCollectionTransition(current, next);
  return next;
}

/** Defense for store/history callers: ledger and application history are append-only and exact. */
export function assertSurveyCollectionTransition(before: SurveyCollection, after: SurveyCollection): void {
  const previous = validateSurveyCollection(before), next = validateSurveyCollection(after);
  if (next.id !== previous.id || next.createdAt !== previous.createdAt || projectDataKey(next.owner) !== projectDataKey(previous.owner)
    || projectDataKey(next.purpose) !== projectDataKey(previous.purpose)) throw new Error("Survey owner, identity and pinned purpose cannot change in a transition.");
  if (next.revision !== nextRevision(previous.revision) || Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) throw new Error("Survey transition requires the next revision and nondecreasing time.");
  for (const key of ["observations", "applications"] as const) {
    if (next[key].length < previous[key].length || previous[key].some((value, index) => projectDataKey(value) !== projectDataKey(next[key][index]))) throw new Error("Survey immutable ledger or application history cannot be removed, reordered or rewritten.");
  }
}

function detach(input: unknown): unknown { const data = snapshotJsonValue(input, "Survey input"); assertDefinedJson(data); return data; }
function assertDefinedJson(value: unknown): void {
  if (value === undefined) throw new Error("Survey JSON cannot preserve undefined; omit absent optional fields.");
  if (value && typeof value === "object") Object.values(value).forEach(assertDefinedJson);
}
function nextRevision(value: number): number { if (value === Number.MAX_SAFE_INTEGER) throw new Error("Survey revision exhausted."); return value + 1; }
function mutationArgs(input: unknown) { return z.object({ expectedRevision: revision, now: timestamp }).strict().parse(detach(input)); }
function checked(input: SurveyCollection, expected: number, now: string): SurveyCollection {
  const current = validateSurveyCollection(input);
  if (current.revision !== expected) throw new Error("Survey revision changed; use the current collection.");
  if (Date.parse(now) < Date.parse(current.updatedAt)) throw new Error("Survey mutation predates the current collection.");
  return current;
}
function membership(current: SurveyCollection, activePointIds: string[], state: SurveyCollection["state"], now: string): SurveyCollection {
  const next = validateSurveyCollection({ ...current, revision: nextRevision(current.revision), updatedAt: now, activePointIds, state });
  assertSurveyCollectionTransition(current, next); return next;
}
function assertReferences(refs: string[], ids: Set<string>): void {
  if (new Set(refs).size !== refs.length) throw new Error("Duplicate ordered Survey reference.");
  if (refs.some(ref => !ids.has(ref))) throw new Error("Survey reference must resolve to a retained observation.");
}
function assertPurpose(purpose: SurveyCollectionPurpose): void {
  if (purpose.kind !== "map_feature") return;
  const allowed: Record<string, readonly string[]> = {
    reference_point: ["Point"], reference_line: ["LineString"], reference_area: ["Polygon"],
    pump_location: ["Point"], well_location: ["Point"], underground_pipeline: ["LineString"], underground_wire: ["LineString"],
    power_pole: ["Point"], power_line: ["LineString"], tree: ["Point"], road: ["LineString"], access_lane: ["LineString"],
    ditch: ["LineString"], canal: ["LineString"], fence: ["LineString"], planning_boundary: ["Polygon"],
    machine_zone: ["Polygon", "LineString"], linear_move_path: ["LineString"], measurement_line: ["LineString"],
    measurement_area: ["Polygon"], end_gun_mark: ["Point"], end_gun_arc: ["LineString"], corner_swing_limit: ["Polygon", "LineString"],
  };
  if (!allowed[purpose.featureKind]?.includes(purpose.geometryType)) throw new Error("Survey feature kind does not match its pinned capture geometry.");
}
function assertTarget(purpose: SurveyCollectionPurpose, target: SurveyApplicationReceipt["target"], ids: string[]): void {
  const expected = purpose.kind === "point" ? "survey_point" : purpose.kind;
  if (target.kind !== expected || (target.kind === "survey_point" && (ids.length !== 1 || target.pointId !== ids[0]))) throw new Error("Survey application target differs from its pinned purpose.");
}
function assertApplicationGeometry(collection: SurveyCollection, ids: string[]): void {
  const byId = new Map(collection.observations.map(point => [point.id, point]));
  const points = ids.map(id => byId.get(id)!.projected);
  const type = surveyPurposeGeometryType(collection.purpose);
  if (type === "Point" && points.length !== 1) throw new Error("Point application needs exactly one observation.");
  if (type === "LineString" && (points.length < 2 || !points.some(point => point.x !== points[0].x || point.y !== points[0].y))) throw new Error("Line application needs at least two distinct positions.");
  if (type === "Polygon") {
    const issue = validateDraftBoundary(points)[0];
    if (issue) throw new Error(issue.message);
  }
}
