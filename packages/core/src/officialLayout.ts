import { z } from "zod";
import { OperationalFixedGgaEvidenceSchema, assertOperationalProjection } from "./operationalGnssEvidence";
import { parseFieldLayoutTarget } from "./fieldLayoutTarget";
import { sha256Text } from "./sha256";
import { projectDataKey } from "./projectDataComparison";
import type { LayoutSession, LayoutObservation } from "./layoutSession";
import type { SurveyPoint } from "./types";

export const RTK_LAYOUT_SESSION_DOCUMENT_VERSION = "layout-session-v3";
const id = z.string().min(1).max(200).refine(value => value.trim().length > 0);
export const LayoutLockReceiptSchema = z.object({ schemaVersion: z.literal("layout-lock-v1"), id,
  capturedAt: z.string().datetime(), recordedBy: id,
  projected: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), evidence: OperationalFixedGgaEvidenceSchema }).strict();
export type LayoutLockReceipt = z.infer<typeof LayoutLockReceiptSchema>;
export const LayoutFinalizationSchema = z.object({ schemaVersion: z.literal("layout-finalization-v1"), finalizedAt: z.string().datetime(),
  lock: LayoutLockReceiptSchema, targetObservationIds: z.array(z.object({ targetPointId: id, observationId: id }).strict()).min(1),
  observationHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type LayoutFinalization = z.infer<typeof LayoutFinalizationSchema>;

/** This is an actual receiver capture adapter, never a saved-point fallback.
 * Runtime connection/epoch/freshness must also be checked under the writer lock. */
export function layoutLockFromReceiverCapture(point: SurveyPoint, recordedBy: string): LayoutLockReceipt {
  return LayoutLockReceiptSchema.parse({ schemaVersion: "layout-lock-v1", id: point.id, capturedAt: point.observedAt,
    recordedBy, projected: point.projected, evidence: point.captureEvidence });
}
export function assertLayoutLockReceipt(input: unknown, projectCrs: string): LayoutLockReceipt {
  const lock = LayoutLockReceiptSchema.parse(input);
  assertOperationalProjection(lock.evidence, lock.projected, projectCrs);
  return lock;
}
export function layoutObservationSignature(observations: readonly LayoutObservation[]): string {
  return sha256Text(projectDataKey(observations));
}
export function layoutFinalizationRecords(targetDocument: string, observations: readonly LayoutObservation[]): LayoutFinalization["targetObservationIds"] {
  const target = parseFieldLayoutTarget(targetDocument);
  if (!target.targetPoints?.length) throw new Error("Finalization requires actual frozen Layout points.");
  return target.targetPoints.map(point => {
    const observation = [...observations].reverse().find(item => item.targetPointId === point.id);
    if (!observation || observation.marking?.assessment !== "within_tolerance" || observation.marking.toleranceMeters === undefined)
      throw new Error("Mark every frozen Layout point within an entered distance tolerance before finalizing its recorded map.");
    return { targetPointId: point.id, observationId: observation.id };
  });
}
export function assertLayoutFinalization(targetDocument: string, observations: readonly LayoutObservation[], input: unknown): LayoutFinalization {
  const finalization = LayoutFinalizationSchema.parse(input), target = parseFieldLayoutTarget(targetDocument);
  assertLayoutLockReceipt(finalization.lock, target.field.projectCrs);
  const expected = layoutFinalizationRecords(targetDocument, observations);
  if (projectDataKey(expected) !== projectDataKey(finalization.targetObservationIds)
    || layoutObservationSignature(observations) !== finalization.observationHash)
    throw new Error("Finalized stations must retain their exact target membership and recorded observation evidence.");
  return finalization;
}
export function isOfficialLayoutSession(session: LayoutSession): boolean {
  if (session.documentVersion !== RTK_LAYOUT_SESSION_DOCUMENT_VERSION || session.referenceSourceDocument !== undefined || session.finalization === null) return false;
  try { assertLayoutLockReceipt(session.creationLock, parseFieldLayoutTarget(session.targetDocument).field.projectCrs);
    assertRtkLayoutChronology(session); assertLayoutFinalization(session.targetDocument, session.observations, session.finalization); return true; } catch { return false; }
}
/** Wall time is the producing app's capture/command clock, separate from the
 * decisive current monotonic receiver admission under the writer lock. */
export function assertRtkLayoutChronology(session: Extract<LayoutSession, { documentVersion: "layout-session-v3" }>): void {
  const created = Date.parse(session.createdAt), creationLock = Date.parse(session.creationLock.capturedAt), updated = Date.parse(session.updatedAt);
  if (creationLock > created || created - creationLock > 2000) throw new Error("RTK Layout creation must retain its current capture time within two seconds of creation.");
  for (const observation of session.observations) {
    const captured = Date.parse(observation.capturedAt);
    if (captured < created || captured > updated) throw new Error("Recorded Layout stations must remain within their actual session capture chronology.");
  }
  if (session.finalization) {
    const finalized = Date.parse(session.finalization.finalizedAt), lock = Date.parse(session.finalization.lock.capturedAt);
    if (finalized < created || finalized > updated || lock > finalized || finalized - lock > 2000
      || session.observations.some(observation => Date.parse(observation.capturedAt) > finalized))
      throw new Error("Official finalization must retain its actual creation, station and current-lock chronology.");
  }
}
export function officialMeasuredStations(session: LayoutSession) {
  if (session.documentVersion !== RTK_LAYOUT_SESSION_DOCUMENT_VERSION || !isOfficialLayoutSession(session) || !session.finalization) return [];
  const target = parseFieldLayoutTarget(session.targetDocument);
  assertLayoutFinalization(session.targetDocument, session.observations, session.finalization);
  return session.finalization.targetObservationIds.map(record => {
    const point = target.targetPoints!.find(item => item.id === record.targetPointId)!;
    const observation = session.observations.find(item => item.id === record.observationId)!;
    return { id: observation.id, targetPointId: point.id, machineId: point.machineId, role: point.role,
      projected: observation.projected, observedAt: observation.capturedAt, recordedBy: observation.marking!.recordedBy,
      toleranceMeters: observation.marking!.toleranceMeters!, evidence: observation.evidence };
  });
}
