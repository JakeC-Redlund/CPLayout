import { z } from "zod";
import { GpsQualityThresholdsSchema, gpsFixMeetsThreshold } from "./settings";
import { projectDataKey } from "./projectDataComparison";
import type { GnssCaptureEvidence, PivotProject, SourceConfidence, XY } from "./types";

const namedReference = z.string().min(1).max(200).refine(value => value === value.trim()
  && !/[\x00-\x1f\x7f]/.test(value)
  && !/^(unknown|unspecified|tbd|n\/a|none|not known)$/i.test(value), "Identify the reference; placeholders are not declarations.");
const utcTimestamp = z.string().datetime({ offset: false, precision: 3 }).refine(value => {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}, "Use a real UTC timestamp with millisecond precision.");

export const GnssReferenceDeclarationSchema = z.object({
  schemaVersion: z.literal("gnss-reference-declaration-v1"),
  provenance: z.literal("operator_declared"),
  receiverModel: namedReference,
  receiverFirmware: namedReference,
  referenceFrame: z.literal("WGS84"),
  realization: namedReference,
  coordinateEpochUtc: utcTimestamp,
  verticalDatum: namedReference,
  geoidModel: namedReference,
  antennaModel: namedReference,
  antennaReference: z.enum(["arp", "phase_center", "pole_tip", "tilt_compensated"]),
  reportedPoint: namedReference,
  targetPoint: namedReference,
  antennaHeightMeters: z.number().finite().min(0),
  offsetTreatment: z.enum(["none_reported_point", "receiver_applied"]),
}).strict().superRefine((value, context) => {
  if (value.offsetTreatment === "none_reported_point" && value.reportedPoint !== value.targetPoint) {
    context.addIssue({ code: "custom", path: ["targetPoint"], message: "Without receiver-applied offsets, capture targets the reported point only." });
  }
});
export type GnssReferenceDeclaration = z.infer<typeof GnssReferenceDeclarationSchema>;

export const RtkQualitySchema = z.object({
  fixType: z.enum(["invalid", "autonomous", "dgps", "rtk_float", "rtk_fixed", "ppp", "unknown"]),
  satellites: z.number().int().nullable(),
  hdop: z.number().nullable(), vdop: z.number().nullable(), pdop: z.number().nullable(),
  correctionAgeSeconds: z.number().nullable(), horizontalAccuracyMeters: z.number().nullable(), verticalAccuracyMeters: z.number().nullable(),
  baseStationId: z.string().optional(), roverId: z.string().optional(), nmeaQualityCode: z.number().optional(),
});

const legacyEvidence = z.object({
  schemaVersion: z.literal("gnss-capture-v1"),
  observationId: z.string().min(1), sessionId: z.string().min(1),
  transport: z.enum(["web_serial", "android_ble", "android_spp", "android_usb", "ios_ble", "ios_mfi", "local_tcp", "replay"]),
  receivedAt: z.string().min(1), receivedMonotonicMs: z.number().finite().min(0),
  receiverObservedAt: z.string().min(1).optional(), sourceCoordinateFrame: z.string().min(1),
  coordinateEpoch: z.number().finite().optional(),
  height: z.object({ meters: z.number().finite(), type: z.enum(["ellipsoidal", "orthometric", "unknown"]), geoidSeparationMeters: z.number().finite().optional() }).optional(),
  antennaReference: z.enum(["arp", "phase_center", "pole_tip", "tilt_compensated", "unknown"]),
  sentenceTypes: z.array(z.string().min(1)), coherent: z.boolean(), rawRecordHashes: z.array(z.string().min(1)).optional(),
});

// Only these GGA codes produce usable measured fixes in the current NMEA parser.
const ggaCaptureFixTypes = { 1: "autonomous", 2: "dgps", 4: "rtk_fixed", 5: "rtk_float" } as const;
const captureReceiverQuality = RtkQualitySchema.extend({
  nmeaQualityCode: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(5)]),
}).strict();
const captureThresholds = GpsQualityThresholdsSchema.extend({
  maxObservationAgeSeconds: GpsQualityThresholdsSchema.shape.maxObservationAgeSeconds.removeDefault(),
}).strict();

export const GnssCaptureEvidenceV2Schema = legacyEvidence.omit({ coordinateEpoch: true }).extend({
  schemaVersion: z.literal("gnss-capture-v2"),
  receivedAt: utcTimestamp,
  receiverObservedAt: utcTimestamp,
  sourceCoordinateFrame: z.literal("EPSG:4326"),
  coherent: z.literal(true),
  height: z.object({ meters: z.number().finite(), type: z.literal("orthometric"), geoidSeparationMeters: z.number().finite() }).strict(),
  referenceDeclaration: GnssReferenceDeclarationSchema,
  antennaReference: z.enum(["arp", "phase_center", "pole_tip", "tilt_compensated"]),
  qualityScreen: z.object({
    policy: z.literal("cplayout-nmea-collection-v2"),
    uncertaintySource: z.literal("nmea_gst_component_standard_deviations"),
    receiverQuality: captureReceiverQuality,
    thresholds: captureThresholds,
    evaluatedMonotonicMs: z.number().finite().min(0),
    physicalQualification: z.literal("unverified"),
  }).strict(),
}).strict().superRefine((evidence, context) => {
  const screen = evidence.qualityScreen, quality = screen.receiverQuality, thresholds = screen.thresholds;
  const fail = (message: string) => context.addIssue({ code: "custom", path: ["qualityScreen"], message });
  const nonnegative = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
  const age = (screen.evaluatedMonotonicMs - evidence.receivedMonotonicMs) / 1000;
  if (!Number.isFinite(age) || age < 0 || age > thresholds.maxObservationAgeSeconds) fail("Capture-time observation age is invalid or stale.");
  if (!gpsFixMeetsThreshold(quality.fixType, "autonomous") || !gpsFixMeetsThreshold(quality.fixType, thresholds.minimumFixType)) fail("Capture fix does not meet the recorded quality policy.");
  if (ggaCaptureFixTypes[quality.nmeaQualityCode] !== quality.fixType) fail("Capture GGA quality code must match its reported fix type.");
  if (!nonnegative(quality.satellites) || !Number.isInteger(quality.satellites) || quality.satellites === 0 || quality.satellites < thresholds.minSatellites) fail("Capture satellite count does not meet the recorded quality policy.");
  if (!nonnegative(quality.hdop) || quality.hdop === 0 || quality.hdop > thresholds.maxHdop) fail("Capture HDOP does not meet the recorded quality policy.");
  if (!nonnegative(quality.horizontalAccuracyMeters) || quality.horizontalAccuracyMeters > thresholds.maxHorizontalAccuracyMeters) fail("Capture horizontal uncertainty does not meet the recorded quality policy.");
  if (!nonnegative(quality.verticalAccuracyMeters)) fail("Capture requires a reported vertical standard uncertainty.");
  if (!nonnegative(quality.correctionAgeSeconds) || !Number.isFinite(quality.correctionAgeSeconds + age) || quality.correctionAgeSeconds + age > thresholds.maxCorrectionAgeSeconds) fail("Capture correction age does not meet the recorded quality policy.");
  for (const field of ["vdop", "pdop"] as const) if (quality[field] !== null && !nonnegative(quality[field])) fail(`Capture ${field} is invalid.`);
  if (evidence.antennaReference !== evidence.referenceDeclaration.antennaReference) fail("Capture antenna reference must match the session declaration.");
  if (!["GGA", "GST", "RMC"].every(type => evidence.sentenceTypes.includes(type))) fail("This collection policy requires coherent GGA, GST and RMC evidence.");
});

export const GnssCaptureEvidenceSchema = z.union([legacyEvidence, GnssCaptureEvidenceV2Schema]);
export type GnssCaptureEvidenceV2 = z.infer<typeof GnssCaptureEvidenceV2Schema>;

/** Retained-v2 ceiling, not complete-vertex qualification; missing/v1 evidence never upgrades labels. */
export function gnssConfidenceExceedsV2Evidence(confidence: SourceConfidence, evidence: Array<GnssCaptureEvidence | null> | undefined): boolean {
  const minimumFix = confidence === "rtk_fixed" ? "rtk_fixed" : confidence === "rtk_float" ? "rtk_float"
    : confidence === "dgps" ? "dgps" : confidence === "autonomous_gps" ? "autonomous" : null;
  return minimumFix !== null && (evidence?.some(capture => capture?.schemaVersion === "gnss-capture-v2"
    && !gpsFixMeetsThreshold(capture.qualityScreen.receiverQuality.fixType, minimumFix)) ?? false);
}

type CaptureCarriers = Pick<PivotProject, "fieldBoundary" | "fieldBoundaryCaptureEvidence" | "surveyPoints" | "obstacles" | "mapFeatures">;
interface CaptureConflict {
  path: Array<string | number>;
  message: string;
}

/** Cross-record consistency after individual schemas validate; all-v1 admission is unchanged. */
export function gnssV2CaptureConflicts(project: CaptureCarriers): CaptureConflict[] {
  const issues: CaptureConflict[] = [];
  const observations = new Map<string, string>();
  const sessions = new Map<string, string>();
  const versions = new Map<string, GnssCaptureEvidence["schemaVersion"]>();
  const check = (point: XY, evidence: GnssCaptureEvidence | null | undefined, path: CaptureConflict["path"]) => {
    if (!evidence) return;
    const previousVersion = versions.get(evidence.observationId);
    if (previousVersion !== undefined && previousVersion !== evidence.schemaVersion) {
      issues.push({ path, message: `Conflicting observation ${evidence.observationId}; mixed GNSS evidence versions cannot share an observation identity.` });
    }
    if (previousVersion === undefined) versions.set(evidence.observationId, evidence.schemaVersion);
    if (evidence.schemaVersion !== "gnss-capture-v2") return;
    const declaration = projectDataKey(evidence.referenceDeclaration);
    const previousDeclaration = sessions.get(evidence.sessionId);
    if (previousDeclaration !== undefined && previousDeclaration !== declaration) {
      issues.push({ path, message: `Conflicting reference declaration for GNSS session ${evidence.sessionId}.` });
    }
    sessions.set(evidence.sessionId, declaration);

    // Repeated captures may evaluate the same receiver observation under different policies/times.
    const { qualityScreen, ...observation } = evidence;
    const { evaluatedMonotonicMs, thresholds, ...immutableQuality } = qualityScreen;
    const payload = projectDataKey({ point, ...observation, qualityScreen: immutableQuality });
    const previous = observations.get(evidence.observationId);
    if (previous !== undefined && previous !== payload) {
      issues.push({ path, message: `Conflicting observation ${evidence.observationId}; immutable GNSS payload and projected XY must match.` });
    }
    observations.set(evidence.observationId, payload);
  };
  project.fieldBoundary.forEach((point, index) => check(point, project.fieldBoundaryCaptureEvidence?.[index], ["fieldBoundaryCaptureEvidence", index]));
  project.surveyPoints.forEach((point, index) => check(point.projected, point.captureEvidence, ["surveyPoints", index, "captureEvidence"]));
  project.obstacles.forEach((obstacle, index) => obstacle.polygon.forEach((point, vertex) =>
    check(point, obstacle.vertexCaptureEvidence?.[vertex], ["obstacles", index, "vertexCaptureEvidence", vertex])));
  project.mapFeatures?.forEach((feature, index) => {
    const vertices = feature.geometry.type === "Point" ? [feature.geometry.point]
      : feature.geometry.type === "Circle" ? [feature.geometry.center] : feature.geometry.vertices;
    vertices.forEach((point, vertex) => check(point, feature.vertexCaptureEvidence?.[vertex], ["mapFeatures", index, "vertexCaptureEvidence", vertex]));
  });
  return issues;
}
