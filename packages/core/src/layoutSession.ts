import { z } from "zod";
import { parseFieldLayoutTarget, layoutPointResidual, REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION, type FieldLayoutTarget } from "./fieldLayoutTarget";
import { assertOperationalProjection, OperationalFixedGgaEvidenceSchema } from "./operationalGnssEvidence";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { parseStrictJson } from "./strictJson";
import { sha256Text } from "./sha256";
import { projectDataKey } from "./projectDataComparison";
import { RTK_LAYOUT_SESSION_DOCUMENT_VERSION, LayoutLockReceiptSchema, LayoutFinalizationSchema, assertLayoutLockReceipt,
  assertLayoutFinalization, assertRtkLayoutChronology, layoutFinalizationRecords, layoutObservationSignature, type LayoutLockReceipt } from "./officialLayout";

export const LAYOUT_SESSION_DOCUMENT_VERSION = "layout-session-v1";
export const REVIEWED_LAYOUT_SESSION_DOCUMENT_VERSION = "layout-session-v2";
const id = z.string().min(1).max(200);
const revision = z.number().int().nonnegative().safe();
const timestamp = z.string().datetime();
export const LayoutObservationSchema = z.object({
  id, sessionId: id, capturedAt: timestamp,
  projected: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  evidence: OperationalFixedGgaEvidenceSchema, label: z.string().max(500).optional(), targetPointId: id.optional(),
}).strict();
export const LayoutMarkingSchema = z.object({ recordedBy: id.refine(value => value.trim().length > 0, "A recorded operator is required."), assessment: z.enum(["record_only", "not_evaluated", "within_tolerance", "outside_tolerance"]),
  residual: z.object({ eastMeters: z.number().finite(), northMeters: z.number().finite(), distanceMeters: z.number().finite().nonnegative(), gridBearingDegrees: z.number().finite().min(0).lt(360) }).strict().optional(),
  toleranceMeters: z.number().finite().positive().optional(),
}).strict();
export const ReviewedLayoutObservationSchema = LayoutObservationSchema.extend({ marking: LayoutMarkingSchema.optional() }).strict();
export type LayoutObservation = z.infer<typeof ReviewedLayoutObservationSchema>;
const SessionSchema = z.object({
  documentVersion: z.literal(LAYOUT_SESSION_DOCUMENT_VERSION), id, name: z.string().trim().min(1).max(200),
  fieldMapId: id, revision, createdAt: timestamp, updatedAt: timestamp, archived: z.boolean(),
  targetDocument: z.string().min(1).max(8 * 1024 * 1024), targetHash: z.string().regex(/^[a-f0-9]{64}$/),
  observations: z.array(LayoutObservationSchema).max(100000),
}).strict();
const ReviewedSessionSchema = SessionSchema.extend({ documentVersion: z.literal(REVIEWED_LAYOUT_SESSION_DOCUMENT_VERSION), observations: z.array(ReviewedLayoutObservationSchema).max(100000) }).strict();
const RtkSessionSchema = ReviewedSessionSchema.extend({ documentVersion: z.literal(RTK_LAYOUT_SESSION_DOCUMENT_VERSION), creationLock: LayoutLockReceiptSchema,
  finalization: LayoutFinalizationSchema.nullable(), referenceSourceDocument: z.string().min(1).max(32 * 1024 * 1024).optional() }).strict();
export type LayoutSession = z.infer<typeof SessionSchema> | z.infer<typeof ReviewedSessionSchema> | z.infer<typeof RtkSessionSchema>;
export type RtkLayoutSession = z.infer<typeof RtkSessionSchema>;

export function parseLayoutSessionDocument(input: string | unknown): LayoutSession {
  return parseSession(input, 0);
}
function parseSession(input: string | unknown, depth: number): LayoutSession {
  if (depth > 16) throw new Error("Layout reference nesting exceeds the supported archive limit.");
  const raw = snapshotJsonValue(typeof input === "string" ? parseStrictJson(input) : input, "Layout session");
  const version = raw && typeof raw === "object" && "documentVersion" in raw ? raw.documentVersion : null;
  const session = version === RTK_LAYOUT_SESSION_DOCUMENT_VERSION ? RtkSessionSchema.parse(raw)
    : version === REVIEWED_LAYOUT_SESSION_DOCUMENT_VERSION ? ReviewedSessionSchema.parse(raw) : SessionSchema.parse(raw);
  const target = parseFieldLayoutTarget(session.targetDocument);
  if ((session.documentVersion !== LAYOUT_SESSION_DOCUMENT_VERSION) !== (target.documentVersion === REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION)) throw new Error("Layout session and target workflow versions must agree.");
  if (target.workflow && target.workflow.fieldMapId !== session.fieldMapId) throw new Error("Reviewed Layout session must retain its exact target field ownership.");
  if (sha256Text(session.targetDocument) !== session.targetHash) throw new Error("Layout target hash differs from its exact retained document.");
  if (Date.parse(session.updatedAt) < Date.parse(session.createdAt)) throw new Error("Layout session update predates its creation.");
  const identities = new Set<string>();
  const receiverObservations = new Set<string>();
  for (const observation of session.observations) {
    assertOperationalProjection(observation.evidence, observation.projected, target.field.projectCrs);
    if (observation.sessionId !== session.id) throw new Error("Observation belongs to a different Layout session.");
    if (observation.evidence.projection.projectCrs !== target.field.projectCrs) throw new Error("Observation projection differs from the frozen target CRS.");
    if (identities.has(observation.id) || receiverObservations.has(observation.evidence.observationId)) throw new Error("Duplicate Layout observation or receiver observation identity.");
    if (session.documentVersion !== LAYOUT_SESSION_DOCUMENT_VERSION) {
      const reviewed = observation as LayoutObservation;
      if (!reviewed.marking) throw new Error("Reviewed Layout observation requires its actual operator record.");
      const expected = annotateLayoutObservation(target, { ...reviewed, marking: undefined } as LayoutObservation,
        { recordedBy: reviewed.marking.recordedBy, ...(reviewed.targetPointId === undefined ? {} : { targetPointId: reviewed.targetPointId }),
          ...(reviewed.marking.toleranceMeters === undefined ? {} : { toleranceMeters: reviewed.marking.toleranceMeters }) });
      if (projectDataKey(expected.marking!) !== projectDataKey(reviewed.marking)) throw new Error("Layout assessment or residual differs from the frozen target and actual observation.");
    }
    identities.add(observation.id); receiverObservations.add(observation.evidence.observationId);
  }
  if (session.documentVersion === RTK_LAYOUT_SESSION_DOCUMENT_VERSION) {
    assertRtkLayoutChronology(session);
    assertLayoutLockReceipt(session.creationLock, target.field.projectCrs);
    if (session.finalization) assertLayoutFinalization(session.targetDocument, session.observations, session.finalization);
    if (session.referenceSourceDocument !== undefined) {
      if (session.finalization !== null) throw new Error("Imported reference maps cannot inherit official finalization.");
      const original = parseSession(session.referenceSourceDocument, depth + 1);
      if (original.targetDocument !== session.targetDocument || original.targetHash !== session.targetHash
        || projectDataKey(original.observations) !== projectDataKey(session.observations)) throw new Error("A reference map must retain its exact original target and observations.");
    }
  }
  return session;
}
export function parseV1LayoutSessionDocument(input: string | unknown): Extract<LayoutSession, { documentVersion: "layout-session-v1" }> {
  const session = parseLayoutSessionDocument(input); if (session.documentVersion !== LAYOUT_SESSION_DOCUMENT_VERSION) throw new Error("Use the matching Layout reader; the v1 reader cannot interpret newer maps."); return session;
}
export function parseV2LayoutSessionDocument(input: string | unknown): Extract<LayoutSession, { documentVersion: "layout-session-v2" }> {
  const session = parseLayoutSessionDocument(input); if (session.documentVersion !== REVIEWED_LAYOUT_SESSION_DOCUMENT_VERSION) throw new Error("Use the matching Layout reader; the v2 reader cannot interpret newer maps."); return session;
}
export function serializeLayoutSessionDocument(session: LayoutSession): string {
  return JSON.stringify(parseLayoutSessionDocument(session), null, 2);
}
export function createLayoutSessionDocument(input: { id: string; name: string; fieldMapId: string; targetDocument: string; now: string }): LayoutSession {
  const target = parseFieldLayoutTarget(input.targetDocument);
  if (target.workflow && target.workflow.fieldMapId !== input.fieldMapId) throw new Error("Reviewed Layout target belongs to another field.");
  return parseLayoutSessionDocument({ documentVersion: target.documentVersion === REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION ? REVIEWED_LAYOUT_SESSION_DOCUMENT_VERSION : LAYOUT_SESSION_DOCUMENT_VERSION, id: input.id,
    name: input.name, fieldMapId: input.fieldMapId, revision: 0, createdAt: input.now, updatedAt: input.now,
    archived: false, targetDocument: input.targetDocument, targetHash: sha256Text(input.targetDocument), observations: [] });
}
export function createRtkLayoutSessionDocument(input: { id: string; name: string; fieldMapId: string; targetDocument: string; now: string; creationLock: LayoutLockReceipt }): RtkLayoutSession {
  const planned = createLayoutSessionDocument(input);
  return parseLayoutSessionDocument({ ...planned, documentVersion: RTK_LAYOUT_SESSION_DOCUMENT_VERSION, creationLock: input.creationLock, finalization: null }) as RtkLayoutSession;
}
export function finalizeRtkLayoutSession(input: LayoutSession, lock: LayoutLockReceipt, now: string): RtkLayoutSession {
  const session = parseLayoutSessionDocument(input);
  if (session.documentVersion !== RTK_LAYOUT_SESSION_DOCUMENT_VERSION || session.referenceSourceDocument !== undefined || session.finalization || session.archived)
    throw new Error("Create a current RTK Layout session before finalizing its recorded stations.");
  return parseLayoutSessionDocument({ ...session, updatedAt: now, finalization: { schemaVersion: "layout-finalization-v1", finalizedAt: now, lock,
    targetObservationIds: layoutFinalizationRecords(session.targetDocument, session.observations), observationHash: layoutObservationSignature(session.observations) } }) as RtkLayoutSession;
}

export function annotateLayoutObservation(target: FieldLayoutTarget, observation: LayoutObservation,
  input: { recordedBy: string; targetPointId?: string; toleranceMeters?: number }): LayoutObservation {
  if (target.documentVersion !== REVIEWED_FIELD_LAYOUT_TARGET_DOCUMENT_VERSION) throw new Error("Review Survey and create a new Layout target before recording positions.");
  const { marking: _marking, ...raw } = observation;
  const checked = LayoutObservationSchema.parse(snapshotJsonValue(raw));
  if (checked.targetPointId !== undefined && checked.targetPointId !== input.targetPointId) throw new Error("Observation target point differs from its admitted marking.");
  if (input.targetPointId === undefined && input.toleranceMeters !== undefined) throw new Error("Choose a target point before applying a tolerance.");
  const residual = input.targetPointId === undefined ? undefined : layoutPointResidual(target, input.targetPointId, checked.projected);
  const marking = LayoutMarkingSchema.parse({ recordedBy: input.recordedBy,
    assessment: residual === undefined ? "record_only" : input.toleranceMeters === undefined ? "not_evaluated"
      : residual.distanceMeters <= input.toleranceMeters ? "within_tolerance" : "outside_tolerance",
    ...(residual === undefined ? {} : { residual }), ...(input.toleranceMeters === undefined ? {} : { toleranceMeters: input.toleranceMeters }) });
  return { ...checked, ...(input.targetPointId === undefined ? {} : { targetPointId: input.targetPointId }), marking };
}
