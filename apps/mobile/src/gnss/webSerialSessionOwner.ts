import type { GnssSession, GnssTransport, GnssTransportOpenOptions } from "@cplayout/gnss";

interface SerialSessionState {
  phase: "idle" | "opening" | "connected" | "closing" | "cleanup_failed";
  session: GnssSession | null;
  error: string | null;
}

export class WebSerialSessionOwner {
  private state: SerialSessionState = { phase: "idle", session: null, error: null };
  private listeners = new Set<() => void>();
  private closeAttempt: Promise<void> | null = null;

  getSnapshot = (): SerialSessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  async open(transport: GnssTransport, options: GnssTransportOpenOptions): Promise<GnssSession> {
    if (this.state.phase !== "idle") throw new Error("Close the current receiver before opening another port.");
    this.publish({ phase: "opening", session: null, error: null });
    try {
      const session = await transport.open(options);
      this.publish({ phase: "connected", session, error: null });
      return session;
    } catch (error) {
      this.publish({ phase: "idle", session: null, error: error instanceof Error ? error.message : "Receiver opening failed." });
      throw error;
    }
  }

  close(session: GnssSession): Promise<void> {
    if (session !== this.state.session) return Promise.reject(new Error("This receiver session is not owned by the browser connection."));
    if (this.closeAttempt) return this.closeAttempt;
    const attempt = Promise.resolve().then(async () => {
      try {
        await session.close();
        this.closeAttempt = null;
        this.publish({ phase: "idle", session: null, error: null });
      } catch (error) {
        this.closeAttempt = null;
        this.publish({ phase: "cleanup_failed", session, error: error instanceof Error ? error.message : "Receiver cleanup failed. Retry closing the port." });
        throw error;
      }
    });
    this.closeAttempt = attempt;
    this.publish({ phase: "closing", session, error: null });
    return attempt;
  }

  private publish(state: SerialSessionState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
}

// Port cleanup ownership survives route changes and late permission resolution.
export const browserSerialSessionOwner = new WebSerialSessionOwner();
