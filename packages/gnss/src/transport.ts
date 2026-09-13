export interface GnssTransportOpenOptions {
  baudRate?: number;
  receiverProfileId?: string;
}

export type GnssTransportEndReason = "closed" | "eof" | "disconnect";

export type GnssTransportEvent =
  | {
      type: "bytes";
      bytes: Uint8Array;
      receivedAt: string;
      receivedMonotonicMs: number;
    }
  | {
      type: "ended";
      reason: GnssTransportEndReason;
    }
  | {
      type: "error";
      error: Error;
    };

export interface GnssSession {
  readonly id: string;
  events(): AsyncIterable<GnssTransportEvent>;
  writeCorrections?(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface GnssTransport {
  open(options: GnssTransportOpenOptions): Promise<GnssSession>;
}
