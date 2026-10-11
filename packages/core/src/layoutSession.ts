import { z } from "zod";
import { parseFieldLayoutTarget } from "./fieldLayoutTarget";
import { assertOperationalProjection, OperationalFixedGgaEvidenceSchema } from "./operationalGnssEvidence";
import { snapshotJsonValue } from "./jsonDataSnapshot";
import { parseStrictJson } from "./strictJson";
import { sha256Text } from "./sha256";

export const LAYOUT_SESSION_DOCUMENT_VERSION = "layout-session-v1";
const id = z.string().min(1).max(200);
const revision = z.number().int().nonnegative().safe();
const timestamp = z.string().datetime();
export const LayoutObservationSchema = z.object({
  id, sessionId: id, capturedAt: timestamp,
  projected: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  evidence: OperationalFixedGgaEvidenceSchema, label: z.string().max(500).optional(), targetPointId: id.optional(),
}).strict();
export type LayoutObservation = z.infer<typeof LayoutObservationSchema>;
const SessionSchema = z.object({
  documentVersion: z.literal(LAYOUT_SESSION_DOCUMENT_VERSION), id, name: z.string().trim().min(1).max(200),
  fieldMapId: id, revision, createdAt: timestamp, updatedAt: timestamp, archived: z.boolean(),
  targetDocument: z.string().min(1).max(8 * 1024 * 1024), targetHash: z.string().regex(/^[a-f0-9]{64}$/),
  observations: z.array(LayoutObservationSchema).max(100000),
}).strict();
export type LayoutSession = z.infer<typeof SessionSchema>;

export function parseLayoutSessionDocument(input: string | unknown): LayoutSession {
  const session = SessionSchema.parse(snapshotJsonValue(typeof input === "string" ? parseStrictJson(input) : input, "Layout session"));
  const target = parseFieldLayoutTarget(session.targetDocument);
  if (sha256Text(session.targetDocument) !== session.targetHash) throw new Error("Layout target hash differs from its exact retained document.");
  if (Date.parse(session.updatedAt) < Date.parse(session.createdAt)) throw new Error("Layout session update predates its creation.");
  const identities = new Set<string>();
  const receiverObservations = new Set<string>();
  for (const observation of session.observations) {
    assertOperationalProjection(observation.evidence, observation.projected, target.field.projectCrs);
    if (observation.sessionId !== session.id) throw new Error("Observation belongs to a different Layout session.");
    if (observation.evidence.projection.projectCrs !== target.field.projectCrs) throw new Error("Observation projection differs from the frozen target CRS.");
    if (identities.has(observation.id) || receiverObservations.has(observation.evidence.observationId)) throw new Error("Duplicate Layout observation or receiver observation identity.");
    identities.add(observation.id); receiverObservations.add(observation.evidence.observationId);
  }
  return session;
}
export function serializeLayoutSessionDocument(session: LayoutSession): string {
  return JSON.stringify(parseLayoutSessionDocument(session), null, 2);
}
export function createLayoutSessionDocument(input: { id: string; name: string; fieldMapId: string; targetDocument: string; now: string }): LayoutSession {
  return parseLayoutSessionDocument({ documentVersion: LAYOUT_SESSION_DOCUMENT_VERSION, id: input.id,
    name: input.name, fieldMapId: input.fieldMapId, revision: 0, createdAt: input.now, updatedAt: input.now,
    archived: false, targetDocument: input.targetDocument, targetHash: sha256Text(input.targetDocument), observations: [] });
}
