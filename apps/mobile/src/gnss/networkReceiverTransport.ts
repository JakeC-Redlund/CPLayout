import type { GnssSession, GnssTransport, GnssTransportEvent, ReceiverConnectionConfig } from "@cplayout/gnss";
const PROTOCOL = "cplayout-receiver-v1";
const PREFIX = "/__cplayout_receiver/v1/";
type NetworkConfig = Extract<ReceiverConnectionConfig, { method: "network" }>;
interface Reply { protocol: string; token?: string; sessionId?: string; error?: string; code?: string; ended?: boolean; closed?: boolean; lines?: Array<{ sequence: number; sentence: string | null; ingressAgeMs: number }> }
class CompanionRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}
export class NetworkReceiverOpenCleanupError extends Error {
  constructor(message: string, readonly cleanupSession: GnssSession) { super(message); }
}
export class NetworkReceiverTransport implements GnssTransport {
  constructor(private readonly config: NetworkConfig, private readonly origin: string,
    // Native browser fetch must receive Window/globalThis, never the transport instance.
    private readonly fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
    const url = new URL(origin);
    if (url.origin !== origin || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.protocol !== "http:") throw new Error("Use the local desktop launcher for Wi-Fi/network receivers.");
  }
  async open(): Promise<GnssSession> {
    const call = async (action: string, token?: string, body: object = {}): Promise<Reply> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), action === "connect" ? 6500 : 3000);
      try {
        const response = await this.fetcher(`${this.origin}${PREFIX}${action}`, {
          method: "POST", mode: "same-origin", cache: "no-store", signal: controller.signal,
          headers: { "content-type": "application/json", "x-cplayout-receiver": PROTOCOL, ...(token ? { "x-cplayout-receiver-token": token } : {}) }, body: JSON.stringify(body),
        });
        const value = await response.json() as Reply;
        if (value.protocol !== PROTOCOL) throw new Error("The desktop receiver companion is unavailable. Restart with the desktop launcher.");
        if (!response.ok) throw new CompanionRequestError(value.error ?? "Receiver companion request failed.", value.code);
        return value;
      } finally { clearTimeout(timeout); }
    };
    const hello = await call("hello");
    if (!hello.token) throw new Error("Receiver companion did not create a control session.");
    // A valid control-expired reply proves the token owns no active/pending socket:
    // the companion retains all tokens while their connection/open request exists.
    const cleanup = async (action: "cancel" | "disconnect", sessionId?: string): Promise<void> => {
      try { await call(action, hello.token, sessionId ? { sessionId } : {}); }
      catch (error) { if (!(error instanceof CompanionRequestError) || error.code !== "control_expired") throw error; }
    };
    let id: string;
    try {
      const opened = await call("connect", hello.token, { config: this.config });
      if (!opened.sessionId) throw new Error("Receiver companion did not create a connection.");
      id = opened.sessionId;
    } catch (error) {
      try { await cleanup("cancel"); }
      catch {
        throw new NetworkReceiverOpenCleanupError("Connection outcome is unknown. Retry Disconnect before connecting again.", {
          id: `pending-${hello.token}`, async *events() { yield { type: "ended", reason: "closed" }; }, close: () => cleanup("cancel"),
        });
      }
      throw error;
    }
    let closed = false;
    let consumed = false;
    let closeAttempt: Promise<void> | null = null;
    return {
      id,
      async *events(): AsyncIterable<GnssTransportEvent> {
        if (consumed) throw new Error("Receiver events may only be consumed once.");
        consumed = true;
        while (!closed) {
          try {
            const started = performance.now();
            const result = await call("poll", hello.token, { sessionId: id });
            const received = performance.now();
            if (closed) break;
            if (result.sessionId !== id || !Array.isArray(result.lines) || result.lines.length > 128) throw new Error("Receiver companion sent invalid session data.");
            if (result.ended || result.error) {
              if (result.error) yield { type: "error", error: new Error(result.error) };
              yield { type: "ended", reason: "disconnect" }; return;
            }
            for (const line of result.lines) {
              if (!Number.isSafeInteger(line.sequence) || !Number.isFinite(line.ingressAgeMs) || line.ingressAgeMs < 0
                || (line.sentence !== null && (typeof line.sentence !== "string" || line.sentence.length > 1024))) throw new Error("Receiver companion sent invalid receipt data.");
              yield { type: "bytes", bytes: new TextEncoder().encode(line.sentence === null ? "" : `${line.sentence}\r\n`),
                receivedAt: new Date().toISOString(), receivedMonotonicMs: received,
                ingressAgeAtReceiptMs: line.ingressAgeMs + received - started,
                ingressSequence: line.sequence, invalidated: line.sentence === null };
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 150));
          } catch (error) {
            if (!closed) yield { type: "error", error: error instanceof Error ? error : new Error("Network receiver disconnected.") };
            return;
          }
        }
        yield { type: "ended", reason: "closed" };
      },
      close() {
        closed = true;
        if (!closeAttempt) closeAttempt = cleanup("disconnect", id).catch((error) => { closeAttempt = null; throw error; });
        return closeAttempt;
      },
    };
  }
}
