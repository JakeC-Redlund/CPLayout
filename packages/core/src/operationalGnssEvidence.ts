import { z } from "zod";
import { qualifyProjectCrs } from "./crsQualification";
import { projectLonLatToXy } from "./coordinates";
import type { XY } from "./types";

const finiteTime = z.number().finite().nonnegative();
/** Operational receiver evidence is distinct from the historical GST/reference-qualified policy. */
export const OperationalFixedGgaEvidenceSchema = z.object({
  schemaVersion: z.literal("gnss-operational-fixed-v1"),
  observationId: z.string().min(1), sessionId: z.string().min(1),
  transport: z.enum(["web_serial", "bluetooth_spp", "local_tcp", "local_udp"]),
  receivedAt: z.string().datetime(), receivedMonotonicMs: finiteTime,
  receiverObservedAt: z.string().datetime().optional(), sourceCoordinateFrame: z.literal("EPSG:4326"),
  height: z.object({ meters: z.number().finite(), type: z.enum(["ellipsoidal", "orthometric", "unknown"]), geoidSeparationMeters: z.number().finite().optional() }).strict().optional(),
  antennaReference: z.literal("unknown"), sentenceTypes: z.array(z.string().min(1)), coherent: z.literal(true),
  rawRecordHashes: z.array(z.string().min(1)).optional(),
  gga: z.object({ sentence: z.string().min(1).max(1024), sentenceIdentifier: z.enum(["GPGGA", "GNGGA"]),
    utcTime: z.string().regex(/^\d{6}(?:\.\d+)?$/), qualityCode: z.literal(4),
    latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  }).strict(),
  receipt: z.object({ sequence: z.number().int().nonnegative().safe(), browserReceivedMonotonicMs: finiteTime,
    ingressAgeAtReceiptMs: finiteTime, provenance: z.enum(["browser_serial", "loopback_companion"]),
  }).strict(),
  capture: z.object({ evaluatedMonotonicMs: finiteTime, ageMs: finiteTime.max(2000), maxAgeMs: z.literal(2000) }).strict(),
  projection: z.object({ id: z.string().min(1), projectCrs: z.string().min(1) }).strict(),
  physicalQualification: z.literal("unverified"),
}).strict().superRefine((evidence, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  const sentence = evidence.gga.sentence;
  const match = /^\$(G[PN]GGA,[^*\r\n]*)\*([0-9A-Fa-f]{2})$/.exec(sentence);
  if (!match) { fail("Capture requires a complete checksummed GPGGA or GNGGA sentence."); return; }
  let checksum = 0;
  for (const character of match[1]) checksum ^= character.charCodeAt(0);
  if (checksum !== parseInt(match[2], 16)) fail("GGA checksum does not match.");
  const fields = match[1].split(",");
  if (fields.length < 10 || fields[0] !== evidence.gga.sentenceIdentifier || fields[1] !== evidence.gga.utcTime || fields[6] !== "4") fail("Retained GGA identity, time or fixed quality does not match the sentence.");
  const time = /^(\d{2})(\d{2})(\d{2})(?:\.\d+)?$/.exec(fields[1] ?? "");
  if (!time || +time[1] > 23 || +time[2] > 59 || +time[3] > 59) fail("GGA UTC time is invalid.");
  const coordinate = (raw: string, hemisphere: string, degrees: number, max: number) => {
    if (!new RegExp(`^\\d{${degrees + 2}}(?:\\.\\d+)?$`).test(raw)) return NaN;
    const d = Number(raw.slice(0, degrees)), m = Number(raw.slice(degrees));
    if (m >= 60 || d > max || (d === max && m !== 0) || !(degrees === 2 ? /^[NS]$/ : /^[EW]$/).test(hemisphere)) return NaN;
    return (d + m / 60) * (hemisphere === "S" || hemisphere === "W" ? -1 : 1);
  };
  const lat = coordinate(fields[2] ?? "", fields[3] ?? "", 2, 90);
  const lon = coordinate(fields[4] ?? "", fields[5] ?? "", 3, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat - evidence.gga.latitude) > 1e-10 || Math.abs(lon - evidence.gga.longitude) > 1e-10) fail("Retained GGA position does not match the sentence.");
  const age = evidence.receipt.ingressAgeAtReceiptMs + evidence.capture.evaluatedMonotonicMs - evidence.receipt.browserReceivedMonotonicMs;
  if (evidence.capture.evaluatedMonotonicMs < evidence.receipt.browserReceivedMonotonicMs || Math.abs(age - evidence.capture.ageMs) > 1e-6 || age > 2000) fail("Capture freshness must include ingress and browser delay and must not exceed two seconds.");
  if (evidence.receivedMonotonicMs !== evidence.receipt.browserReceivedMonotonicMs) fail("Receipt times must use the same browser monotonic clock.");
  if (!evidence.sentenceTypes.includes("GGA") && !evidence.sentenceTypes.includes(evidence.gga.sentenceIdentifier)) fail("Capture sentence types must retain GGA.");
  if ((evidence.transport === "local_tcp" || evidence.transport === "local_udp") !== (evidence.receipt.provenance === "loopback_companion")) fail("Transport must match receipt provenance.");
});
export type OperationalFixedGgaEvidence = z.infer<typeof OperationalFixedGgaEvidenceSchema>;

/** Called only on already detached JSON data. */
export function hasOperationalGnssEvidence(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("schemaVersion" in value && value.schemaVersion === "gnss-operational-fixed-v1") return true;
  return Object.values(value).some(hasOperationalGnssEvidence);
}
export function refuseOperationalGnssEvidence(value: unknown): void {
  if (hasOperationalGnssEvidence(value)) throw new Error("Operational fixed-GGA evidence requires the current document version; preserve the original document.");
}

/** The stored projected XY must represent the retained GGA through the declared resolved transform. */
export function assertOperationalProjection(evidence: OperationalFixedGgaEvidence, point: XY, projectCrs: string | null): void {
  if (projectCrs !== evidence.projection.projectCrs || evidence.projection.id !== `wgs84-projection-v1:${projectCrs}`) throw new Error("Operational capture projection does not match its canonical coordinate frame.");
  const qualification = qualifyProjectCrs(projectCrs);
  if (!qualification.calculation.allowed || qualification.wgs84Transform !== "projection_only") throw new Error("Operational capture requires a resolved horizontal projection qualified for collection.");
  const expected = projectLonLatToXy({ latitude: evidence.gga.latitude, longitude: evidence.gga.longitude }, projectCrs);
  if (Math.abs(expected.x - point.x) > 1e-6 || Math.abs(expected.y - point.y) > 1e-6) throw new Error("Operational capture XY does not match its immutable GGA and projection.");
}

/** Same observation identity may be recaptured later, but its receiver payload cannot be rewritten. */
export function operationalObservationPayloads(value: unknown, result = new Map<string, string>()): Map<string, string> {
  if (!value || typeof value !== "object") return result;
  if ("schemaVersion" in value && value.schemaVersion === "gnss-operational-fixed-v1") {
    const { capture: _capture, ...observation } = OperationalFixedGgaEvidenceSchema.parse(value);
    const payload = JSON.stringify(observation);
    const previous = result.get(observation.observationId);
    if (previous !== undefined && previous !== payload) throw new Error("An operational observation identity cannot carry conflicting receiver payloads.");
    result.set(observation.observationId, payload);
  } else Object.values(value).forEach(item => operationalObservationPayloads(item, result));
  return result;
}
