// Diagnostic payload decoder, not a PVT solution, epoch assembler, or quality gate.
// NavSpark AN0030 v1.4.35, PDF pp. 3-4 (encoding), 41 (DC), 42-44 (DD):
// https://navspark.mybigcommerce.com/content/AN0030_1.4.35.pdf
// SHA-256: 4e637808831c7014eb7c4fd154bee61b2d503148a487fab95999ed705bbb468e

export type NavsparkRawNumericValue = number | "NaN" | "+Infinity" | "-Infinity";

export interface NavsparkRawMeasurement {
  available: boolean;
  // Usable means only flag-present and finite; it is not solver or survey acceptance.
  usable: boolean;
  rawValue: NavsparkRawNumericValue;
  value: number | null;
}

interface NavsparkRawPayloadBase {
  rawPayload: number[];
}

export interface NavsparkRawTimePayload extends NavsparkRawPayloadBase {
  kind: "DC";
  messageId: 0xdc;
  iod: number;
  receiverWeek: number;
  receiverTowMs: number;
  measurementPeriodMs: number;
}

export interface NavsparkRawRecord {
  svid: number;
  cn0DbHz: number;
  measurementIndicator: number;
  unknownIndicatorBits: number;
  cycleSlipPossible: boolean;
  coherentIntegrationAtLeast10Ms: boolean;
  pseudorangeMeters: NavsparkRawMeasurement;
  carrierPhaseCycles: NavsparkRawMeasurement;
  dopplerHz: NavsparkRawMeasurement;
}

export interface NavsparkRawMeasurementsPayload extends NavsparkRawPayloadBase {
  kind: "DD";
  messageId: 0xdd;
  iod: number;
  measurementCount: number;
  records: NavsparkRawRecord[];
}

export interface NavsparkRawUnknownPayload extends NavsparkRawPayloadBase {
  kind: "unknown";
  messageId: number;
}

export interface NavsparkRawIssue {
  code: "empty_payload" | "invalid_message_id" | "payload_too_long" | "invalid_length"
    | "out_of_range" | "nonfinite_available_measurement";
  field?: "receiverTowMs" | "measurementPeriodMs" | "pseudorangeMeters"
    | "carrierPhaseCycles" | "dopplerHz";
  recordIndex?: number;
  expectedLength?: number;
  actualLength?: number;
}

export interface NavsparkRawInvalidPayload extends NavsparkRawPayloadBase {
  kind: "invalid";
  messageId: number | null;
  issues: NavsparkRawIssue[];
  // Present only when the known layout could be fully decoded without guessing.
  decoded?: NavsparkRawTimePayload | NavsparkRawMeasurementsPayload;
}

export type NavsparkRawPayload = NavsparkRawTimePayload | NavsparkRawMeasurementsPayload
  | NavsparkRawUnknownPayload | NavsparkRawInvalidPayload;

function measurement(raw: number, available: boolean): NavsparkRawMeasurement {
  const usable = available && Number.isFinite(raw);
  const rawValue: NavsparkRawNumericValue = Number.isNaN(raw) ? "NaN"
    : raw === Infinity ? "+Infinity" : raw === -Infinity ? "-Infinity" : raw;
  return { available, usable, rawValue, value: usable ? raw : null };
}

/** Decode only the payload (ID included); the caller must validate outer framing/XOR. */
export function decodeNavsparkRawPayload(payload: Uint8Array): NavsparkRawPayload {
  const rawPayload = Array.from(payload);
  const messageId = payload.length > 0 ? payload[0] : null;
  const invalid = (
    issues: NavsparkRawIssue[],
    decoded?: NavsparkRawTimePayload | NavsparkRawMeasurementsPayload,
  ): NavsparkRawInvalidPayload => ({
    kind: "invalid", messageId, rawPayload, issues, ...(decoded ? { decoded } : {}),
  });
  const invalidLength = (expectedLength: number) => invalid([{
    code: "invalid_length", expectedLength, actualLength: payload.length,
  }]);

  if (payload.length === 0) return invalid([{ code: "empty_payload" }]);
  if (payload.length > 65535) return invalid([{ code: "payload_too_long", actualLength: payload.length }]);
  if (messageId === 0) return invalid([{ code: "invalid_message_id" }]);

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (messageId === 0xdc) {
    if (payload.length !== 10) return invalidLength(10);
    // The printed TOW field label overlaps WN; widths and the example establish 4..7.
    const decoded: NavsparkRawTimePayload = {
      kind: "DC", messageId, rawPayload,
      iod: view.getUint8(1),
      receiverWeek: view.getUint16(2, false),
      receiverTowMs: view.getUint32(4, false),
      measurementPeriodMs: view.getUint16(8, false),
    };
    const issues: NavsparkRawIssue[] = [];
    if (decoded.receiverTowMs > 604799999) issues.push({ code: "out_of_range", field: "receiverTowMs" });
    if (decoded.measurementPeriodMs < 1 || decoded.measurementPeriodMs > 1000) {
      issues.push({ code: "out_of_range", field: "measurementPeriodMs" });
    }
    return issues.length > 0 ? invalid(issues, decoded) : decoded;
  }

  if (messageId === 0xdd) {
    if (payload.length < 3) return invalidLength(3);
    const measurementCount = view.getUint8(2);
    const expectedLength = 3 + 23 * measurementCount;
    if (payload.length !== expectedLength) return invalidLength(expectedLength);
    const records: NavsparkRawRecord[] = [];
    const issues: NavsparkRawIssue[] = [];
    for (let i = 0; i < measurementCount; i += 1) {
      const r = 3 + 23 * i;
      const indicator = view.getUint8(r + 22);
      const record: NavsparkRawRecord = {
        svid: view.getUint8(r),
        cn0DbHz: view.getUint8(r + 1),
        measurementIndicator: indicator,
        unknownIndicatorBits: indicator & 0xe0,
        cycleSlipPossible: (indicator & 0x08) !== 0,
        coherentIntegrationAtLeast10Ms: (indicator & 0x10) !== 0,
        pseudorangeMeters: measurement(view.getFloat64(r + 2, false), (indicator & 0x01) !== 0),
        carrierPhaseCycles: measurement(view.getFloat64(r + 10, false), (indicator & 0x04) !== 0),
        dopplerHz: measurement(view.getFloat32(r + 18, false), (indicator & 0x02) !== 0),
      };
      for (const field of ["pseudorangeMeters", "carrierPhaseCycles", "dopplerHz"] as const) {
        if (record[field].available && !record[field].usable) {
          issues.push({ code: "nonfinite_available_measurement", field, recordIndex: i });
        }
      }
      records.push(record);
    }
    const decoded: NavsparkRawMeasurementsPayload = {
      kind: "DD", messageId, rawPayload, iod: view.getUint8(1), measurementCount, records,
    };
    return issues.length > 0 ? invalid(issues, decoded) : decoded;
  }

  return { kind: "unknown", messageId: messageId!, rawPayload };
}
