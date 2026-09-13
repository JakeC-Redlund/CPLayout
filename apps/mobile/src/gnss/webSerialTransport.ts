import type {
  GnssSession,
  GnssTransport,
  GnssTransportEvent,
  GnssTransportOpenOptions,
} from "@cplayout/gnss";

export interface WebSerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable?: WritableStream<Uint8Array> | null;
}

export interface WebSerialLike {
  requestPort(): Promise<WebSerialPortLike>;
}

export interface WebSerialClock {
  nowIso(): string;
  monotonicMs(): number;
}

const defaultClock: WebSerialClock = {
  nowIso: () => new Date().toISOString(),
  monotonicMs: () => typeof performance === "undefined" ? Date.now() : performance.now(),
};

export class WebSerialGnssTransport implements GnssTransport {
  constructor(
    private readonly serial: WebSerialLike,
    private readonly clock: WebSerialClock = defaultClock,
  ) {}

  async open(options: GnssTransportOpenOptions): Promise<GnssSession> {
    const baudRate = options.baudRate;
    if (!Number.isInteger(baudRate) || (baudRate ?? 0) <= 0) {
      throw new Error("Web Serial GNSS requires a positive integer baud rate.");
    }
    const port = await this.serial.requestPort();
    await port.open({ baudRate: baudRate! });
    return new WebSerialGnssSession(port, `web-serial-${this.clock.monotonicMs().toFixed(3)}`, this.clock);
  }
}

class WebSerialGnssSession implements GnssSession {
  private closeRequested = false;
  private closePromise: Promise<void> | null = null;
  private writeTail: Promise<void> = Promise.resolve();
  private consumed = false;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(
    private readonly port: WebSerialPortLike,
    readonly id: string,
    private readonly clock: WebSerialClock,
  ) {}

  async *events(): AsyncIterable<GnssTransportEvent> {
    if (this.consumed) throw new Error("GNSS session events may only be consumed once.");
    this.consumed = true;
    if (this.closeRequested) {
      yield { type: "ended", reason: "closed" };
      return;
    }
    if (!this.port.readable) {
      yield { type: "error", error: new Error("Serial port opened without a readable stream.") };
      yield { type: "ended", reason: "eof" };
      return;
    }
    const reader = this.port.readable.getReader();
    this.reader = reader;
    try {
      while (!this.closeRequested) {
        const { value, done } = await reader.read();
        if (done || this.closeRequested) {
          yield { type: "ended", reason: this.closeRequested ? "closed" : "eof" };
          return;
        }
        if (!value || value.byteLength === 0) continue;
        yield {
          type: "bytes",
          bytes: value,
          receivedAt: this.clock.nowIso(),
          receivedMonotonicMs: this.clock.monotonicMs(),
        };
      }
      yield { type: "ended", reason: "closed" };
    } catch (error) {
      if (!this.closeRequested) yield { type: "error", error: asError(error, "Web Serial GNSS read failed.") };
      yield { type: "ended", reason: this.closeRequested ? "closed" : "disconnect" };
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // The browser may already have released a disconnected reader.
      }
      if (this.reader === reader) this.reader = null;
    }
  }

  async writeCorrections(bytes: Uint8Array): Promise<void> {
    if (this.closeRequested) throw new Error("GNSS session is closed.");
    const ownedBytes = bytes.slice();
    const write = this.writeTail.then(async () => {
      if (this.closeRequested) throw new Error("GNSS session is closed.");
      if (!this.port.writable) throw new Error("This Web Serial receiver does not expose a writable correction stream.");
      const writer = this.port.writable.getWriter();
      try {
        await writer.write(ownedBytes);
      } finally {
        writer.releaseLock();
      }
    });
    this.writeTail = write.then(() => undefined, () => undefined);
    return write;
  }

  close(): Promise<void> {
    this.closeRequested = true;
    if (this.closePromise) return this.closePromise;
    const attempt = this.closePort();
    this.closePromise = attempt;
    void attempt.catch(() => {
      if (this.closePromise === attempt) this.closePromise = null;
    });
    return attempt;
  }

  private async closePort(): Promise<void> {
    const reader = this.reader;
    try {
      await reader?.cancel();
    } catch {
      // Cancellation may race a physical disconnect.
    }
    // The async generator may be paused at yield, so its finally cannot own cleanup.
    reader?.releaseLock();
    if (this.reader === reader) this.reader = null;
    await this.writeTail;
    await this.port.close();
  }
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}
