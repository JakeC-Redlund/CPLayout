import {
  GpsQualityThresholdsSchema,
  gpsFixMeetsThreshold,
  projectLonLatToXy,
  type AppSettings,
  type GnssCaptureEvidence,
  type GnssTransportKind,
  type RtkQuality,
  type SourceConfidence,
  type SurveyPoint,
} from "@cplayout/core";

export interface ParsedNmeaSample {
  sentenceType: string;
  rawSentence: string;
  utcTime?: string;
  utcSecondsOfDay?: number;
  utcDate?: string;
  rmcStatus?: "active" | "void" | "unknown";
  rmcMode?: string;
  latitude?: number;
  longitude?: number;
  fixType?: RtkQuality["fixType"];
  satellites?: number;
  hdop?: number;
  vdop?: number;
  pdop?: number;
  altitudeMeters?: number;
  geoidSeparationMeters?: number;
  correctionAgeSeconds?: number | null;
  horizontalAccuracyMeters?: number;
  verticalAccuracyMeters?: number;
  nmeaQualityCode?: number;
  baseStationId?: string;
  receivedAt?: string;
  receivedMonotonicMs?: number;
}

export interface GnssObservationEpoch {
  id: string;
  sessionId: string;
  receiverObservedAt: string | null;
  receiverTimeSecondsOfDay?: number;
  receivedAt: string;
  receivedMonotonicMs: number;
  position: { latitude: number; longitude: number };
  altitudeMeters: number | null;
  geoidSeparationMeters: number | null;
  quality: RtkQuality;
  sentenceTypes: string[];
  coherent: boolean;
  invalidReason: string | null;
}

export type GnssGateReasonCode =
  | "not_connected"
  | "no_observation"
  | "incoherent_epoch"
  | "invalid_timing"
  | "stale_observation"
  | "unconfirmed_source_crs"
  | "quality_threshold";

export interface GnssGateContext {
  connected: boolean;
  nowMonotonicMs: number;
  sourceCoordinateFrame: string | "unknown";
}

export interface GnssObservationGateResult {
  accepted: boolean;
  reasonCodes: GnssGateReasonCode[];
  reasons: string[];
  quality: RtkQuality;
  observationId: string | null;
  observationAgeSeconds: number | null;
}

export interface RtkQualityGateResult {
  accepted: boolean;
  reasons: string[];
  quality: RtkQuality;
}

export interface NmeaStreamAccumulator {
  carry: string;
}

export interface NmeaChunkParseResult {
  accumulator: NmeaStreamAccumulator;
  lines: string[];
  samples: ParsedNmeaSample[];
}

export interface NmeaReceptionMetadata {
  receivedAt: string;
  receivedMonotonicMs: number;
}

// Policy bounds accommodate extended receiver sentences without retaining unbounded noise.
export const MAX_NMEA_SENTENCE_LENGTH = 1024;
export const MAX_NMEA_EPOCH_RECEPTION_SKEW_MS = 2000;

export const EMPTY_RTK_QUALITY: RtkQuality = {
  fixType: "unknown",
  satellites: null,
  hdop: null,
  vdop: null,
  pdop: null,
  correctionAgeSeconds: null,
  horizontalAccuracyMeters: null,
  verticalAccuracyMeters: null,
};

export function parseNmeaSentence(sentence: string): ParsedNmeaSample | null {
  const trimmed = sentence.trim();
  if (!trimmed.startsWith("$") || !nmeaChecksumValid(trimmed)) return null;

  const withoutChecksum = trimmed.slice(1, trimmed.lastIndexOf("*"));
  const fields = withoutChecksum.split(",");
  if (!/^[A-Z]{5}$/.test(fields[0])) return null;
  const sentenceType = fields[0].slice(-3);
  const base = { sentenceType, rawSentence: trimmed };

  if (sentenceType === "GGA") {
    const qualityCode = parseNonnegativeInteger(fields[6]);
    const time = parseUtcTime(fields[1]);
    return {
      ...base,
      utcTime: time?.normalized,
      utcSecondsOfDay: time?.secondsOfDay,
      latitude: parseNmeaCoordinate(fields[2], fields[3], "latitude"),
      longitude: parseNmeaCoordinate(fields[4], fields[5], "longitude"),
      fixType: mapGgaQuality(qualityCode),
      satellites: parseNonnegativeInteger(fields[7]) ?? undefined,
      hdop: parseNonnegativeNumber(fields[8]) ?? undefined,
      altitudeMeters: fields[10] === "M" ? parseOptionalNumber(fields[9]) ?? undefined : undefined,
      geoidSeparationMeters: fields[12] === "M" ? parseOptionalNumber(fields[11]) ?? undefined : undefined,
      correctionAgeSeconds: parseNonnegativeNumber(fields[13]),
      nmeaQualityCode: qualityCode ?? undefined,
      baseStationId: fields[14]?.trim() || undefined,
    };
  }

  if (sentenceType === "GSA") {
    return {
      ...base,
      pdop: parseNonnegativeNumber(fields[15]) ?? undefined,
      hdop: parseNonnegativeNumber(fields[16]) ?? undefined,
      vdop: parseNonnegativeNumber(fields[17]) ?? undefined,
    };
  }

  if (sentenceType === "GST") {
    const time = parseUtcTime(fields[1]);
    const latitudeStdDev = parseNonnegativeNumber(fields[6]);
    const longitudeStdDev = parseNonnegativeNumber(fields[7]);
    return {
      ...base,
      utcTime: time?.normalized,
      utcSecondsOfDay: time?.secondsOfDay,
      // Two-axis RMS is not a 95% confidence radius or measured field accuracy.
      horizontalAccuracyMeters: latitudeStdDev === null || longitudeStdDev === null
        ? undefined
        : Math.hypot(latitudeStdDev, longitudeStdDev),
      verticalAccuracyMeters: parseNonnegativeNumber(fields[8]) ?? undefined,
    };
  }

  if (sentenceType === "RMC") {
    const time = parseUtcTime(fields[1]);
    return {
      ...base,
      utcTime: time?.normalized,
      utcSecondsOfDay: time?.secondsOfDay,
      utcDate: parseRmcDate(fields[9]),
      rmcStatus: fields[2] === "A" ? "active" : fields[2] === "V" ? "void" : "unknown",
      rmcMode: fields[12] || undefined,
      latitude: parseNmeaCoordinate(fields[3], fields[4], "latitude"),
      longitude: parseNmeaCoordinate(fields[5], fields[6], "longitude"),
    };
  }

  return base;
}

export function mapGgaQuality(code: number | null | undefined): RtkQuality["fixType"] {
  switch (code) {
    case 0:
      return "invalid";
    case 1:
      return "autonomous";
    case 2:
      return "dgps";
    case 4:
      return "rtk_fixed";
    case 5:
      return "rtk_float";
    case 6:
      return "unknown";
    default:
      return "unknown";
  }
}

export function parseNmeaLog(input: string | Iterable<string>): ParsedNmeaSample[] {
  const lines = typeof input === "string" ? input.split(/\r?\n/) : Array.from(input);
  return lines
    .map((line) => parseNmeaSentence(line))
    .filter((sample): sample is ParsedNmeaSample => Boolean(sample));
}

export function createNmeaStreamAccumulator(carry = ""): NmeaStreamAccumulator {
  return { carry: boundedSentenceTail(carry) };
}

export function parseNmeaStreamChunk(accumulator: NmeaStreamAccumulator, chunk: string): NmeaChunkParseResult {
  const combined = `${accumulator.carry}${chunk}`.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = combined.split("\n");
  const carry = boundedSentenceTail(parts.pop() ?? "");
  const lines = parts.map((line) => boundedSentenceTail(line.trim())).filter((line) => line.length > 0);
  return {
    accumulator: { carry },
    lines,
    samples: parseNmeaLog(lines),
  };
}

export function withNmeaReceptionMetadata(
  samples: ParsedNmeaSample[],
  metadata: NmeaReceptionMetadata,
): ParsedNmeaSample[] {
  return samples.map((sample) => ({ ...sample, ...metadata }));
}

export function latestGnssObservationEpoch(
  samples: ParsedNmeaSample[],
  sessionId: string,
  previousObservation?: GnssObservationEpoch | null,
): GnssObservationEpoch | null {
  // A newer invalid fix must close capture, never select an older valid GGA.
  const gga = [...samples].reverse().find((sample) => sample.sentenceType === "GGA");
  if (!gga || gga.utcSecondsOfDay === undefined || gga.latitude === undefined || gga.longitude === undefined || !gga.receivedAt || gga.receivedMonotonicMs === undefined) {
    return null;
  }

  const matchesEpoch = (sample: ParsedNmeaSample): boolean => (
    sample.utcSecondsOfDay !== undefined
    && Math.abs(sample.utcSecondsOfDay - gga.utcSecondsOfDay!) < 0.001
    && isNonnegativeFinite(sample.receivedMonotonicMs)
    && isNonnegativeFinite(gga.receivedMonotonicMs)
    && Math.abs(sample.receivedMonotonicMs - gga.receivedMonotonicMs) <= MAX_NMEA_EPOCH_RECEPTION_SKEW_MS
  );
  const matchingRmc = [...samples].reverse().find((sample) => sample.sentenceType === "RMC" && matchesEpoch(sample));
  const matchingGst = [...samples].reverse().find((sample) => sample.sentenceType === "GST" && matchesEpoch(sample));
  const quality = qualityFromEpoch(gga, matchingGst);
  const rmcPositionMatches = !matchingRmc
    || (matchingRmc.latitude !== undefined && matchingRmc.longitude !== undefined
      && Math.abs(matchingRmc.latitude - gga.latitude) < 0.0000001
      && Math.abs(matchingRmc.longitude - gga.longitude) < 0.0000001);
  const invalidReason = !gpsFixMeetsThreshold(quality.fixType, "autonomous")
    ? "GGA does not contain a usable measured fix."
    : matchingRmc && matchingRmc.rmcStatus !== "active"
      ? "Matching RMC marks the receiver solution void or invalid."
      : matchingRmc && (!matchingRmc.utcDate || (matchingRmc.rmcMode && !["A", "D", "F", "R", "P"].includes(matchingRmc.rmcMode)))
        ? "Matching RMC has an invalid date or non-measured solution mode."
        : !rmcPositionMatches
          ? "Matching RMC and GGA positions disagree or are incomplete."
          : null;
  const coherent = invalidReason === null;
  const receiverObservedAt = matchingRmc?.rmcStatus === "active" && matchingRmc.utcDate && gga.utcTime
    ? `${matchingRmc.utcDate}T${formatIsoTime(gga.utcTime)}Z`
    : null;
  const sameReceiverEpoch = previousObservation?.sessionId === sessionId
    && previousObservation.receiverTimeSecondsOfDay === gga.utcSecondsOfDay
    && (!previousObservation.receiverObservedAt || !receiverObservedAt
      || previousObservation.receiverObservedAt.slice(0, 10) === receiverObservedAt.slice(0, 10));
  const receivedAt = sameReceiverEpoch ? previousObservation.receivedAt : gga.receivedAt;
  const receivedMonotonicMs = sameReceiverEpoch ? previousObservation.receivedMonotonicMs : gga.receivedMonotonicMs;
  const sentenceTypes = [gga, matchingRmc, matchingGst]
    .filter((sample): sample is ParsedNmeaSample => Boolean(sample))
    .map((sample) => sample.sentenceType);

  return {
    id: sameReceiverEpoch ? previousObservation.id : `${sessionId}:${gga.utcTime ?? "untimed"}:${receivedMonotonicMs}`,
    sessionId,
    receiverObservedAt,
    receiverTimeSecondsOfDay: gga.utcSecondsOfDay,
    receivedAt,
    receivedMonotonicMs,
    position: { latitude: gga.latitude, longitude: gga.longitude },
    altitudeMeters: gga.altitudeMeters ?? null,
    geoidSeparationMeters: gga.geoidSeparationMeters ?? null,
    quality,
    sentenceTypes: Array.from(new Set(sentenceTypes)),
    coherent,
    invalidReason,
  };
}

export function evaluateGnssObservationGate(
  observation: GnssObservationEpoch | null,
  context: GnssGateContext,
  thresholds: AppSettings["gpsQuality"],
): GnssObservationGateResult {
  const reasons: string[] = [];
  const reasonCodes: GnssGateReasonCode[] = [];
  const addReason = (code: GnssGateReasonCode, reason: string): void => {
    if (!reasonCodes.includes(code)) reasonCodes.push(code);
    reasons.push(reason);
  };

  if (context.connected !== true) addReason("not_connected", "receiver is not connected");
  if (!observation) {
    addReason("no_observation", "no coherent GGA observation is available");
    return {
      accepted: false,
      reasonCodes,
      reasons,
      quality: { ...EMPTY_RTK_QUALITY },
      observationId: null,
      observationAgeSeconds: null,
    };
  }
  const invalidObservation = observationInvalidReason(observation);
  if (invalidObservation) addReason("incoherent_epoch", invalidObservation);
  const validTiming = isNonnegativeFinite(context.nowMonotonicMs)
    && isNonnegativeFinite(observation.receivedMonotonicMs)
    && context.nowMonotonicMs >= observation.receivedMonotonicMs;
  const observationAgeSeconds = validTiming ? (context.nowMonotonicMs - observation.receivedMonotonicMs) / 1000 : null;
  if (observationAgeSeconds === null) {
    addReason("invalid_timing", "observation and current monotonic times must be finite, nonnegative, and ordered");
  } else if (observationAgeSeconds > thresholds.maxObservationAgeSeconds) {
    addReason("stale_observation", `observation age ${observationAgeSeconds.toFixed(1)} s exceeds ${thresholds.maxObservationAgeSeconds} s`);
  }
  if (typeof context.sourceCoordinateFrame !== "string" || context.sourceCoordinateFrame.trim().toUpperCase() !== "EPSG:4326") {
    addReason("unconfirmed_source_crs", "receiver source CRS must be explicitly confirmed as EPSG:4326 for on-device projection");
  }
  const effectiveQuality: RtkQuality = {
    ...observation.quality,
    correctionAgeSeconds: observationAgeSeconds === null || observation.quality.correctionAgeSeconds === null
      ? null
      : observation.quality.correctionAgeSeconds + observationAgeSeconds,
  };
  const qualityGate = evaluateRtkQualityGate(effectiveQuality, thresholds);
  for (const reason of qualityGate.reasons) addReason("quality_threshold", reason);
  return {
    accepted: reasons.length === 0,
    reasonCodes,
    reasons,
    quality: effectiveQuality,
    observationId: observation.id,
    observationAgeSeconds,
  };
}

export function rtkQualityFromNmeaSamples(samples: ParsedNmeaSample[]): RtkQuality {
  const stamped = samples.map((sample, index) => ({
    ...sample,
    receivedAt: sample.receivedAt ?? "1970-01-01T00:00:00.000Z",
    receivedMonotonicMs: sample.receivedMonotonicMs ?? index,
  }));
  return latestGnssObservationEpoch(stamped, "legacy")?.quality ?? { ...EMPTY_RTK_QUALITY };
}

export function latestPositionFromNmeaSamples(samples: ParsedNmeaSample[]): { latitude: number; longitude: number } | null {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (sample.sentenceType === "GGA" && sample.latitude !== undefined && sample.longitude !== undefined) {
      return { latitude: sample.latitude, longitude: sample.longitude };
    }
  }
  return null;
}

export function evaluateRtkQualityGate(quality: RtkQuality, thresholds: AppSettings["gpsQuality"]): RtkQualityGateResult {
  const reasons: string[] = [];
  if (!GpsQualityThresholdsSchema.safeParse(thresholds).success) {
    return { accepted: false, reasons: ["GNSS quality thresholds are invalid"], quality };
  }
  if (!gpsFixMeetsThreshold(quality.fixType, "autonomous") || !gpsFixMeetsThreshold(quality.fixType, thresholds.minimumFixType)) {
    reasons.push(`fix ${quality.fixType} is below required ${thresholds.minimumFixType}`);
  }
  if (!isNonnegativeFinite(quality.hdop) || quality.hdop === 0) {
    reasons.push("HDOP is unknown or invalid");
  } else if (quality.hdop > thresholds.maxHdop) {
    reasons.push(`HDOP ${quality.hdop ?? "unknown"} exceeds ${thresholds.maxHdop}`);
  }
  if (!isNonnegativeFinite(quality.satellites) || !Number.isInteger(quality.satellites) || quality.satellites === 0) {
    reasons.push("satellite count is unknown or invalid");
  } else if (quality.satellites < thresholds.minSatellites) {
    reasons.push(`satellites ${quality.satellites ?? "unknown"} below required ${thresholds.minSatellites}`);
  }
  if (!isNonnegativeFinite(quality.horizontalAccuracyMeters)) {
    reasons.push("horizontal accuracy is unknown or invalid");
  } else if (quality.horizontalAccuracyMeters > thresholds.maxHorizontalAccuracyMeters) {
    reasons.push(`horizontal accuracy ${quality.horizontalAccuracyMeters ?? "unknown"} m exceeds ${thresholds.maxHorizontalAccuracyMeters} m`);
  }
  if (!isNonnegativeFinite(quality.correctionAgeSeconds)) {
    reasons.push("correction age is unknown or invalid");
  } else if (quality.correctionAgeSeconds > thresholds.maxCorrectionAgeSeconds) {
    reasons.push(`correction age ${quality.correctionAgeSeconds ?? "unknown"} s exceeds ${thresholds.maxCorrectionAgeSeconds} s`);
  }
  for (const field of ["vdop", "pdop", "verticalAccuracyMeters"] as const) {
    if (quality[field] !== null && !isNonnegativeFinite(quality[field])) reasons.push(`${field} is invalid`);
  }
  return { accepted: reasons.length === 0, reasons, quality };
}

export function captureEvidenceFromObservation(input: {
  observation: GnssObservationEpoch;
  transport: GnssTransportKind;
  sourceCoordinateFrame: string;
}): GnssCaptureEvidence {
  return {
    schemaVersion: "gnss-capture-v1",
    observationId: input.observation.id,
    sessionId: input.observation.sessionId,
    transport: input.transport,
    receivedAt: input.observation.receivedAt,
    receivedMonotonicMs: input.observation.receivedMonotonicMs,
    receiverObservedAt: input.observation.receiverObservedAt ?? undefined,
    sourceCoordinateFrame: input.sourceCoordinateFrame,
    height: input.observation.altitudeMeters === null
      ? undefined
      : {
          meters: input.observation.altitudeMeters,
          type: "orthometric",
          geoidSeparationMeters: input.observation.geoidSeparationMeters ?? undefined,
        },
    antennaReference: "unknown",
    sentenceTypes: input.observation.sentenceTypes,
    coherent: input.observation.coherent,
  };
}

export function surveyPointFromGnssObservation(input: {
  observation: GnssObservationEpoch;
  projectCrs: string;
  sourceCoordinateFrame: string;
  transport: GnssTransportKind;
  id: string;
  label: string;
  role?: SurveyPoint["role"];
}): SurveyPoint {
  const invalidObservation = observationInvalidReason(input.observation);
  if (invalidObservation) throw new Error(invalidObservation);
  if (input.sourceCoordinateFrame.trim().toUpperCase() !== "EPSG:4326") {
    throw new Error("On-device GNSS projection currently requires an explicitly confirmed EPSG:4326 source frame.");
  }
  const { latitude, longitude } = input.observation.position;
  return {
    id: input.id,
    label: input.label,
    role: input.role ?? "control",
    projected: projectLonLatToXy({ longitude, latitude }, input.projectCrs),
    wgs84: { longitude, latitude },
    observedAt: input.observation.receiverObservedAt ?? input.observation.receivedAt,
    source: "external_gnss",
    confidence: confidenceForRtkQuality(input.observation.quality),
    rtk: input.observation.quality,
    captureEvidence: captureEvidenceFromObservation(input),
  };
}

export function surveyPointFromNmeaSamples(input: {
  samples: ParsedNmeaSample[];
  projectCrs: string;
  id: string;
  label: string;
  role?: SurveyPoint["role"];
  observedAt: string;
  sourceCoordinateFrame?: string;
}): SurveyPoint {
  const stamped = input.samples.map((sample, index) => ({
    ...sample,
    receivedAt: sample.receivedAt ?? input.observedAt,
    receivedMonotonicMs: sample.receivedMonotonicMs ?? index,
  }));
  const observation = latestGnssObservationEpoch(stamped, `replay-${input.id}`);
  if (!observation) throw new Error("NMEA replay did not contain a valid timestamped GGA fix.");
  return surveyPointFromGnssObservation({
    observation,
    projectCrs: input.projectCrs,
    sourceCoordinateFrame: input.sourceCoordinateFrame ?? "EPSG:4326",
    transport: "replay",
    id: input.id,
    label: input.label,
    role: input.role,
  });
}

export function confidenceForRtkQuality(quality: RtkQuality): SourceConfidence {
  if (quality.fixType === "rtk_fixed") return "rtk_fixed";
  if (quality.fixType === "rtk_float") return "rtk_float";
  if (quality.fixType === "dgps") return "dgps";
  if (quality.fixType === "autonomous" || quality.fixType === "ppp") return "autonomous_gps";
  return "user_estimated";
}

export function nmeaChecksumValid(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (trimmed.length > MAX_NMEA_SENTENCE_LENGTH || /[^\x20-\x7e]/.test(trimmed)) return false;
  const checksumMarker = trimmed.lastIndexOf("*");
  if (!trimmed.startsWith("$") || checksumMarker <= 1 || checksumMarker + 3 !== trimmed.length) return false;
  const expected = trimmed.slice(checksumMarker + 1).toUpperCase();
  if (!/^[0-9A-F]{2}$/.test(expected)) return false;
  let checksum = 0;
  for (const character of trimmed.slice(1, checksumMarker)) checksum ^= character.charCodeAt(0);
  return expected === checksum.toString(16).toUpperCase().padStart(2, "0");
}

function qualityFromEpoch(gga: ParsedNmeaSample, gst: ParsedNmeaSample | undefined): RtkQuality {
  return {
    fixType: gga.fixType ?? "unknown",
    satellites: gga.satellites ?? null,
    hdop: gga.hdop ?? null,
    vdop: null,
    pdop: null,
    correctionAgeSeconds: gga.correctionAgeSeconds ?? null,
    horizontalAccuracyMeters: gst?.horizontalAccuracyMeters ?? null,
    verticalAccuracyMeters: gst?.verticalAccuracyMeters ?? null,
    baseStationId: gga.baseStationId,
    nmeaQualityCode: gga.nmeaQualityCode,
  };
}

function parseNmeaCoordinate(
  value: string | undefined,
  hemisphere: string | undefined,
  axis: "latitude" | "longitude",
): number | undefined {
  if (!value || !hemisphere) return undefined;
  if (axis === "latitude" && hemisphere !== "N" && hemisphere !== "S") return undefined;
  if (axis === "longitude" && hemisphere !== "E" && hemisphere !== "W") return undefined;
  const coordinatePattern = axis === "latitude" ? /^\d{4}(?:\.\d+)?$/ : /^\d{5}(?:\.\d+)?$/;
  if (!coordinatePattern.test(value)) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  const degrees = Math.floor(numeric / 100);
  const minutes = numeric - degrees * 100;
  const maximumDegrees = axis === "latitude" ? 90 : 180;
  if (minutes < 0 || minutes >= 60 || degrees > maximumDegrees || (degrees === maximumDegrees && minutes !== 0)) return undefined;
  const signed = degrees + minutes / 60;
  return hemisphere === "S" || hemisphere === "W" ? -signed : signed;
}

function parseUtcTime(value: string | undefined): { normalized: string; secondsOfDay: number } | undefined {
  if (!value || !/^\d{6}(?:\.\d+)?$/.test(value)) return undefined;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(2, 4));
  const seconds = Number(value.slice(4));
  if (hours > 23 || minutes > 59 || seconds >= 60) return undefined;
  return {
    normalized: `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4)}`,
    secondsOfDay: hours * 3600 + minutes * 60 + seconds,
  };
}

function parseRmcDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{6}$/.test(value)) return undefined;
  const day = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const twoDigitYear = Number(value.slice(4, 6));
  const year = twoDigitYear >= 80 ? 1900 + twoDigitYear : 2000 + twoDigitYear;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return undefined;
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function formatIsoTime(time: string): string {
  const [hours, minutes, secondsValue] = time.split(":");
  const [seconds, fraction = ""] = secondsValue.split(".");
  const milliseconds = fraction.padEnd(3, "0").slice(0, 3);
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (!value || !/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNonnegativeNumber(value: string | undefined): number | null {
  const parsed = parseOptionalNumber(value);
  return isNonnegativeFinite(parsed) ? parsed : null;
}

function parseNonnegativeInteger(value: string | undefined): number | null {
  const parsed = parseNonnegativeNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function boundedSentenceTail(value: string): string {
  const start = value.lastIndexOf("$");
  return start < 0 || value.length - start > MAX_NMEA_SENTENCE_LENGTH ? "" : value.slice(start);
}

function observationInvalidReason(observation: GnssObservationEpoch): string | null {
  if (observation.coherent !== true) return observation.invalidReason ?? "GNSS observation is incoherent.";
  const { latitude, longitude } = observation.position;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    return "GNSS observation position is invalid.";
  }
  if (!gpsFixMeetsThreshold(observation.quality.fixType, "autonomous")) return "GNSS observation does not contain a usable measured fix.";
  if (!isNonnegativeFinite(observation.receivedMonotonicMs) || !Number.isFinite(Date.parse(observation.receivedAt))) {
    return "GNSS observation reception metadata is invalid.";
  }
  return null;
}
