import { projectLonLatToXy, qualifyProjectCrs, type RtkQuality } from "@cplayout/core";
import { EMPTY_RTK_QUALITY, parseNmeaSentence, type ParsedNmeaSample } from "./nmea";

export type ReceiverConnectionConfig =
  | { method: "usb" | "bluetooth_spp"; baudRate: number }
  | { method: "network"; protocol: "tcp" | "udp"; address: string; port: number; sourceAddress?: string };
export type ReceiverTransportKind = "web_serial" | "bluetooth_spp" | "local_tcp" | "local_udp";
export interface OperationalReceiverObservation {
  id: string;
  sessionId: string;
  transport: ReceiverTransportKind;
  sentence: string;
  sentenceIdentifier: "GPGGA" | "GNGGA";
  sample: ParsedNmeaSample;
  receivedAt: string;
  browserReceivedMonotonicMs: number;
  ingressAgeAtReceiptMs: number;
  sequence: number;
  quality: RtkQuality;
}
export interface ReceiverRuntimeState {
  phase: "idle" | "opening" | "connected" | "closing" | "cleanup_failed";
  config: ReceiverConnectionConfig | null;
  sessionId: string | null;
  observation: OperationalReceiverObservation | null;
  sentenceCount: number;
  incomingData: "waiting" | "receiving" | "invalid" | "stale";
  status: string;
  error: string | null;
  receiverQuality?: RtkQuality;
  sentenceIdentifier?: string;
}
export interface OperationalCollectionGate {
  accepted: boolean;
  reason: string;
  ageMs: number | null;
  projected: { x: number; y: number } | null;
  projectionId: string | null;
}
export interface ReceiverLineReceipt {
  sessionId: string;
  transport: ReceiverTransportKind;
  receivedAt: string;
  browserReceivedMonotonicMs: number;
  ingressAgeAtReceiptMs: number;
  sequence: number;
}

export const MAX_OPERATIONAL_OBSERVATION_AGE_MS = 2000;
export function receiverTransportKind(config: ReceiverConnectionConfig): ReceiverTransportKind {
  return config.method === "network" ? config.protocol === "tcp" ? "local_tcp" : "local_udp"
    : config.method === "bluetooth_spp" ? "bluetooth_spp" : "web_serial";
}
export function validateReceiverConnectionConfig(value: ReceiverConnectionConfig): void {
  if (value.method === "usb" || value.method === "bluetooth_spp") {
    if (!Number.isSafeInteger(value.baudRate) || value.baudRate <= 0 || value.baudRate > 4000000) throw new Error("Enter a baud rate from 1 to 4000000.");
    return;
  }
  if (value.method !== "network" || !["tcp", "udp"].includes(value.protocol)
    || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
    || !value.address?.trim() || value.address.length > 255
    || (value.sourceAddress !== undefined && (value.sourceAddress.length > 255 || !value.sourceAddress.trim()))) {
    throw new Error("Choose TCP or UDP and enter an address and port from 1 to 65535.");
  }
}

/** Per-connection high-water marks: invalid, duplicate and late GGA close collection. */
export class OperationalGgaTracker {
  private sequence = 0;
  private seconds: number | null = null;
  private epochIngressMs: number | null = null;
  private lastReceiptMs = -Infinity;
  private current: OperationalReceiverObservation | null = null;
  receiverQuality: RtkQuality = { ...EMPTY_RTK_QUALITY };
  sentenceIdentifier: string | undefined;
  reason = "Waiting for a valid GPGGA or GNGGA sentence.";
  constructor(private readonly sessionId: string) {}
  invalidate(reason: string): null { this.current = null; this.reason = reason; return null; }
  get observation(): OperationalReceiverObservation | null { return this.current; }
  accept(sentence: string, receipt: ReceiverLineReceipt): OperationalReceiverObservation | null {
    if (receipt.sessionId !== this.sessionId || !Number.isSafeInteger(receipt.sequence) || receipt.sequence <= this.sequence
      || !Number.isFinite(receipt.browserReceivedMonotonicMs) || receipt.browserReceivedMonotonicMs < this.lastReceiptMs
      || !Number.isFinite(receipt.ingressAgeAtReceiptMs) || receipt.ingressAgeAtReceiptMs < 0
      || !Number.isFinite(Date.parse(receipt.receivedAt))) return this.invalidate("Invalid receiver session, order or receipt time. Waiting for fresh data.");
    this.sequence = receipt.sequence;
    this.lastReceiptMs = receipt.browserReceivedMonotonicMs;
    const sample = parseNmeaSentence(sentence);
    if (!sample) return this.invalidate("Invalid NMEA data. Waiting for a valid fixed GGA.");
    if (sample.sentenceType !== "GGA") return this.current; // Supplementary sentences never open or refresh the gate.
    const identifier = sentence.slice(1, 6);
    this.sentenceIdentifier = identifier;
    this.receiverQuality = { ...EMPTY_RTK_QUALITY, fixType: sample.fixType ?? "unknown", nmeaQualityCode: sample.nmeaQualityCode, satellites: sample.satellites ?? null, hdop: sample.hdop ?? null, correctionAgeSeconds: sample.correctionAgeSeconds ?? null };
    if ((identifier !== "GPGGA" && identifier !== "GNGGA") || sample.utcSecondsOfDay === undefined
      || sample.utcTime === undefined || sample.latitude === undefined || sample.longitude === undefined) {
      return this.invalidate("GGA needs valid time and position from GPGGA or GNGGA.");
    }
    const ingressMs = receipt.browserReceivedMonotonicMs - receipt.ingressAgeAtReceiptMs;
    if (this.seconds !== null) {
      const delta = (sample.utcSecondsOfDay - this.seconds + 86400) % 86400;
      const elapsed = this.epochIngressMs === null ? 0 : ingressMs - this.epochIngressMs;
      if (delta === 0) return this.invalidate("Duplicate GGA epoch. Waiting for a new receiver position.");
      if (delta > 43200) {
        return this.invalidate("Out-of-order GGA epoch. Waiting for newer receiver data.");
      }
      if (delta * 1000 > elapsed + 2000 || elapsed - delta * 1000 > 2000) return this.invalidate("Queued or discontinuous receiver epochs. Reconnect after checking the stream.");
    }
    this.seconds = sample.utcSecondsOfDay;
    this.epochIngressMs = ingressMs;
    if (sample.nmeaQualityCode !== 4 || sample.rawSentence.split(",")[6] !== "4") return this.invalidate("Receiver is not reporting RTK Fixed (GGA quality 4).");
    if (receipt.ingressAgeAtReceiptMs > MAX_OPERATIONAL_OBSERVATION_AGE_MS) return this.invalidate("Receiver data is more than 2 seconds old.");
    this.reason = "RTK Fixed — receiver reported";
    this.current = { id: `${this.sessionId}:${receipt.sequence}`, ...receipt, sentence: sample.rawSentence, sentenceIdentifier: identifier, sample,
      quality: { ...EMPTY_RTK_QUALITY, fixType: "rtk_fixed", satellites: sample.satellites ?? null, hdop: sample.hdop ?? null,
        correctionAgeSeconds: sample.correctionAgeSeconds ?? null, nmeaQualityCode: 4, baseStationId: sample.baseStationId } };
    return this.current;
  }
}

export function evaluateOperationalCollectionGate(state: ReceiverRuntimeState, projectCrs: string, nowMonotonicMs: number): OperationalCollectionGate {
  const blocked = (reason: string, ageMs: number | null = null): OperationalCollectionGate => ({ accepted: false, reason, ageMs, projected: null, projectionId: null });
  if (state.phase !== "connected" || !state.sessionId) return blocked("Connect a receiver to collect a position.");
  const observation = state.observation;
  if (!observation || observation.sessionId !== state.sessionId) return blocked(state.status);
  const ageMs = observation.ingressAgeAtReceiptMs + nowMonotonicMs - observation.browserReceivedMonotonicMs;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OPERATIONAL_OBSERVATION_AGE_MS) return blocked("Receiver position is stale. Waiting for data no more than 2 seconds old.", ageMs);
  const qualification = qualifyProjectCrs(projectCrs);
  if (!qualification.calculation.allowed || qualification.wgs84Transform !== "projection_only") return blocked("Set the field to a supported projected coordinate system before collecting.", ageMs);
  try {
    const projected = projectLonLatToXy({ longitude: observation.sample.longitude!, latitude: observation.sample.latitude! }, projectCrs);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return blocked("The field coordinate transformation could not be resolved.", ageMs);
    return { accepted: true, reason: "RTK Fixed — receiver reported", ageMs, projected, projectionId: `wgs84-projection-v1:${projectCrs}` };
  } catch { return blocked("The field coordinate transformation could not be resolved.", ageMs); }
}
