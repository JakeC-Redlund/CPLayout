import { MAX_NMEA_SENTENCE_LENGTH, nmeaChecksumValid, type NmeaReceptionMetadata } from "./nmea";

export interface ReceiverStreamResult {
  mode: "nmea" | "binary" | "fault";
  issue: string | null;
  invalidated: boolean;
  rejectedTextLines: number;
  nmea: Array<NmeaReceptionMetadata & { sentence: string }>;
  diagnosticTextFrames: Array<NmeaReceptionMetadata & { sentence: string }>;
  binaryPayloads: Uint8Array[];
}

// Collection policy, not a receiver specification. Retain first-byte age across chunks.
export const MAX_RECEIVER_FRAME_AGE_MS = 2000;
const MAX_BINARY_FRAME_BYTES = 0xffff + 7;

/** One instance per transport session. Binary detection disables collection until reconnect. */
export class ReceiverStreamDecoder {
  private mode: ReceiverStreamResult["mode"] = "nmea";
  private issue: string | null = null;
  private sentence = "";
  private binary: number[] = [];
  private started: NmeaReceptionMetadata | null = null;
  private droppingLine = false;
  private lastMonotonicMs = -Infinity;

  push(bytes: Uint8Array, reception: NmeaReceptionMetadata): ReceiverStreamResult {
    const timestamp = { receivedAt: reception.receivedAt, receivedMonotonicMs: reception.receivedMonotonicMs };
    const result: ReceiverStreamResult = { mode: this.mode, issue: this.issue, invalidated: false, rejectedTextLines: 0, nmea: [], diagnosticTextFrames: [], binaryPayloads: [] };
    const invalidate = () => { result.invalidated = true; result.nmea = []; };
    const fault = (reason: string) => {
      this.mode = "fault";
      this.issue = reason;
      this.sentence = "";
      this.binary = [];
      this.started = null;
      invalidate();
    };
    if (result.mode === "fault") return result;
    if (!Number.isFinite(reception.receivedMonotonicMs) || reception.receivedMonotonicMs < 0
      || reception.receivedMonotonicMs < this.lastMonotonicMs || !Number.isFinite(Date.parse(reception.receivedAt))) {
      fault("Invalid receiver reception clock. Reconnect before collection.");
    } else {
      this.lastMonotonicMs = reception.receivedMonotonicMs;
    }
    if (this.started && reception.receivedMonotonicMs - this.started.receivedMonotonicMs > MAX_RECEIVER_FRAME_AGE_MS) {
      if (this.binary.length) fault("Incomplete binary frame expired. Reconnect before collection.");
      else {
        this.sentence = "";
        this.started = null;
        this.droppingLine = true;
        result.rejectedTextLines += 1;
        invalidate();
      }
    }
    for (const byte of bytes) {
      if (this.mode === "fault") break;
      if (this.binary.length > 0) {
        this.binary.push(byte);
        if (this.binary.length === 2 && byte !== 0xa1) {
          fault("Unsupported binary stream. Reconnect in NMEA mode before collection.");
          break;
        }
        if (this.binary.length < 4) continue;
        const payloadLength = this.binary[2] * 256 + this.binary[3];
        const frameLength = payloadLength + 7;
        if (payloadLength === 0 || frameLength > MAX_BINARY_FRAME_BYTES) {
          fault("Invalid binary frame length. Reconnect before collection.");
          break;
        }
        if (this.binary.length < frameLength) continue;
        let checksum = 0;
        for (let index = 4; index < 4 + payloadLength; index += 1) checksum ^= this.binary[index];
        if (checksum !== this.binary[4 + payloadLength]
          || this.binary[5 + payloadLength] !== 0x0d || this.binary[6 + payloadLength] !== 0x0a) {
          fault("Corrupt binary frame. Reconnect before collection.");
          break;
        }
        result.binaryPayloads.push(Uint8Array.from(this.binary.slice(4, 4 + payloadLength)));
        this.binary = [];
        this.started = null;
        continue;
      }
      if (byte === 0xa0) {
        this.mode = "binary";
        this.issue = "Binary receiver stream detected. Reconnect in NMEA mode before collection.";
        this.binary = [byte];
        this.started = timestamp;
        if (this.sentence) result.rejectedTextLines += 1;
        this.sentence = "";
        invalidate();
        continue;
      }
      if (byte !== 0x0d && byte !== 0x0a && (byte < 0x20 || byte > 0x7e)) {
        fault("Unsupported binary stream. Reconnect in NMEA mode before collection.");
        break;
      }
      if (byte === 0x0d || byte === 0x0a) {
        if (this.sentence && this.started) {
          if (nmeaChecksumValid(this.sentence)) {
            const frame = { sentence: this.sentence, ...this.started };
            // Keep post-binary text inspectable without reopening collection.
            if (this.mode === "nmea") result.nmea.push(frame);
            result.diagnosticTextFrames.push(frame);
          }
          else { result.rejectedTextLines += 1; invalidate(); }
        }
        this.sentence = "";
        this.started = null;
        this.droppingLine = false;
        continue;
      }
      if (this.droppingLine) continue;
      if (this.sentence === "") {
        if (byte !== 0x24) { this.droppingLine = true; result.rejectedTextLines += 1; invalidate(); continue; }
        this.started = timestamp;
      }
      if (this.sentence.length >= MAX_NMEA_SENTENCE_LENGTH || (byte === 0x24 && this.sentence.length > 0)) {
        this.sentence = "";
        this.started = null;
        this.droppingLine = true;
        result.rejectedTextLines += 1;
        invalidate();
        continue;
      }
      this.sentence += String.fromCharCode(byte);
    }
    return { ...result, mode: this.mode, issue: this.issue };
  }

  finish(): { complete: boolean; mode: ReceiverStreamResult["mode"]; issue: string | null } {
    const complete = this.mode !== "fault" && this.binary.length === 0 && this.sentence === "" && !this.droppingLine;
    return { complete, mode: this.mode, issue: this.issue ?? (complete ? null : "Incomplete receiver frame at end of stream.") };
  }
}
