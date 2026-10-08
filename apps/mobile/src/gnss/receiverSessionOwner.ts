import { OperationalFixedGgaEvidenceSchema, type OperationalFixedGgaEvidence, type SurveyPoint, type ObstacleZone, type ProjectMapFeatureKind } from "@cplayout/core";
import { OperationalGgaTracker, ReceiverStreamDecoder, evaluateOperationalCollectionGate, receiverTransportKind, validateReceiverConnectionConfig,
  type GnssSession, type GnssTransport, type ReceiverConnectionConfig, type ReceiverRuntimeState } from "@cplayout/gnss";
import { WebSerialGnssTransport, type WebSerialLike } from "./webSerialTransport";
import { NetworkReceiverTransport, NetworkReceiverOpenCleanupError } from "./networkReceiverTransport";
import type { CapturedDraftVertex } from "./captureDraft";
export interface ReceiverCollectionView { surveyRole: SurveyPoint["role"]; obstacleKind: ObstacleZone["kind"]; mapFeatureKind: ProjectMapFeatureKind; boundaryDraft: CapturedDraftVertex[]; obstacleDraft: CapturedDraftVertex[]; mapFeatureDraft: CapturedDraftVertex[] }
export interface ReceiverConnectionForm {
  method: "usb" | "bluetooth_spp" | "network";
  baudRate: string;
  protocol: "tcp" | "udp";
  address: string;
  port: string;
  sourceAddress: string;
}
export interface ReceiverSessionSnapshot extends ReceiverRuntimeState {
  connectionForm: Readonly<ReceiverConnectionForm>;
}

export class ReceiverSessionOwner {
  private state: ReceiverSessionSnapshot = { phase: "idle", config: null, sessionId: null, observation: null, sentenceCount: 0, incomingData: "waiting", status: "No receiver connected.", error: null,
    connectionForm: Object.freeze({ method: "usb", baudRate: "115200", protocol: "tcp", address: "", port: "", sourceAddress: "" }) };
  private listeners = new Set<() => void>();
  private session: GnssSession | null = null;
  private generation = 0;
  private openingPending = false;
  private collectionViews = new Map<string, ReceiverCollectionView>();
  collectionView(projectId: string, projectCrs: string): ReceiverCollectionView {
    const key = JSON.stringify([projectId, projectCrs]);
    let view = this.collectionViews.get(key);
    if (!view) { view = { surveyRole: "control", obstacleKind: "exclusion", mapFeatureKind: "underground_pipeline", boundaryDraft: [], obstacleDraft: [], mapFeatureDraft: [] }; this.collectionViews.set(key, view); }
    return view;
  }
  updateCollectionView(projectId: string, projectCrs: string, update: (view: ReceiverCollectionView) => ReceiverCollectionView): void {
    this.collectionViews.set(JSON.stringify([projectId, projectCrs]), update(this.collectionView(projectId, projectCrs)));
  }
  private closeAttempt: Promise<void> | null = null;
  private freshnessTimer: ReturnType<typeof setInterval> | null = null;
  constructor(private readonly transportFactory: (config: ReceiverConnectionConfig) => GnssTransport = browserTransport,
    private readonly now: () => number = () => performance.now()) {}
  getSnapshot = (): ReceiverSessionSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get connectionForm(): Readonly<ReceiverConnectionForm> { return this.state.connectionForm; }
  updateConnectionForm(update: Partial<ReceiverConnectionForm>): boolean {
    if (this.state.phase !== "idle" || this.openingPending) return false;
    this.publish({ connectionForm: Object.freeze({ ...this.state.connectionForm, ...update }), error: null,
      status: this.state.error ? "Receiver settings updated. Connect when ready." : this.state.status });
    return true;
  }
  connectFromForm(): Promise<void> {
    const form = this.state.connectionForm;
    return this.connect(form.method === "network"
      ? { method: "network", protocol: form.protocol, address: form.address.trim(), port: Number(form.port),
        ...(form.protocol === "udp" && form.sourceAddress.trim() ? { sourceAddress: form.sourceAddress.trim() } : {}) }
      : { method: form.method, baudRate: Number(form.baudRate) });
  }
  collectionGate(projectCrs: string) { return evaluateOperationalCollectionGate(this.state, projectCrs, this.now()); }
  async connect(config: ReceiverConnectionConfig): Promise<void> {
    if (this.state.phase !== "idle" || this.openingPending) throw new Error("Disconnect the current receiver before changing connections.");
    try { validateReceiverConnectionConfig(config); }
    catch (error) { this.publish({ error: message(error), status: message(error) }); throw error; }
    const generation = ++this.generation;
    this.openingPending = true;
    this.publish({ phase: "opening", config: { ...config }, connectionForm: formForConfig(this.state.connectionForm, config), observation: null, sessionId: null, incomingData: "waiting", sentenceCount: 0, receiverQuality: undefined, sentenceIdentifier: undefined, error: null, status: "Opening receiver connection…" });
    try {
      const session = await this.transportFactory(config).open(config.method === "network" ? {} : { baudRate: config.baudRate });
      this.session = session;
      if (generation !== this.generation) { await this.disconnect(); return; }
      this.publish({ phase: "connected", sessionId: session.id, error: null, status: "Connected. Waiting for NMEA receiver data." });
      this.freshnessTimer = setInterval(() => {
        const observation = this.state.observation;
        if (observation && this.state.phase === "connected" && this.state.incomingData !== "stale"
          && observation.ingressAgeAtReceiptMs + this.now() - observation.browserReceivedMonotonicMs > 2000) {
          this.publish({ incomingData: "stale", status: "Receiver position is stale. Waiting for fresh fixed GGA." });
        }
      }, 200);
      this.freshnessTimer.unref?.();
      void this.read(session, generation, config);
    } catch (error) {
      if (error instanceof NetworkReceiverOpenCleanupError) { this.session = error.cleanupSession; this.publish({ phase: "cleanup_failed", observation: null, sessionId: null, error: error.message, status: error.message }); }
      if (this.getSnapshot().phase !== "cleanup_failed") this.publish({ phase: "idle", sessionId: null, observation: null, error: message(error), status: message(error) });
      throw error;
    } finally { this.openingPending = false; }
  }
  async disconnect(): Promise<void> {
    ++this.generation;
    if (this.freshnessTimer) clearInterval(this.freshnessTimer);
    this.freshnessTimer = null;
    this.publish({ observation: null, incomingData: "waiting", phase: this.session || this.openingPending ? "closing" : "idle", error: null, status: "Closing receiver connection…" });
    if (this.closeAttempt) return this.closeAttempt;
    const session = this.session;
    if (!session) { if (this.state.phase !== "closing") this.publish({ status: "No receiver connected." }); return; }
    const attempt = session.close().then(() => {
      if (this.session === session) this.session = null;
      this.publish({ phase: "idle", sessionId: null, observation: null, error: null, status: "Receiver disconnected." });
    }).catch((error) => {
      this.publish({ phase: "cleanup_failed", observation: null, error: message(error), status: "Receiver cleanup failed. Retry Disconnect." }); throw error;
    }).finally(() => { this.closeAttempt = null; });
    this.closeAttempt = attempt;
    return attempt;
  }
  capture(projectCrs: string, id: string, label: string, role: SurveyPoint["role"] = "control"): SurveyPoint & { captureEvidence: OperationalFixedGgaEvidence } {
    const now = this.now();
    const gate = evaluateOperationalCollectionGate(this.state, projectCrs, now);
    const observation = this.state.observation;
    if (!gate.accepted || !observation || !gate.projected || gate.ageMs === null || !gate.projectionId || this.session?.id !== observation.sessionId) throw new Error(`Collection blocked: ${gate.reason}`);
    const evidence = OperationalFixedGgaEvidenceSchema.parse({ schemaVersion: "gnss-operational-fixed-v1", observationId: observation.id, sessionId: observation.sessionId,
      transport: observation.transport, receivedAt: observation.receivedAt, receivedMonotonicMs: observation.browserReceivedMonotonicMs,
      sourceCoordinateFrame: "EPSG:4326", sentenceTypes: [observation.sentenceIdentifier], coherent: true, antennaReference: "unknown",
      gga: { sentence: observation.sentence, sentenceIdentifier: observation.sentenceIdentifier, utcTime: observation.sentence.split(",")[1], qualityCode: 4, latitude: observation.sample.latitude!, longitude: observation.sample.longitude! },
      receipt: { sequence: observation.sequence, browserReceivedMonotonicMs: observation.browserReceivedMonotonicMs, ingressAgeAtReceiptMs: observation.ingressAgeAtReceiptMs,
        provenance: observation.transport === "local_tcp" || observation.transport === "local_udp" ? "loopback_companion" : "browser_serial" },
      capture: { evaluatedMonotonicMs: now, ageMs: gate.ageMs, maxAgeMs: 2000 }, projection: { id: gate.projectionId, projectCrs }, physicalQualification: "unverified" });
    return { id, label, role, projected: gate.projected, wgs84: { longitude: observation.sample.longitude!, latitude: observation.sample.latitude! },
      observedAt: new Date().toISOString(), source: "external_gnss", confidence: "rtk_fixed", rtk: { ...observation.quality }, captureEvidence: evidence };
  }
  private async read(session: GnssSession, generation: number, config: ReceiverConnectionConfig): Promise<void> {
    const decoder = new ReceiverStreamDecoder();
    const tracker = new OperationalGgaTracker(session.id);
    let sequence = 0;
    try {
      for await (const event of session.events()) {
        if (this.generation !== generation || this.session !== session) return;
        if (event.type !== "bytes") { this.publish({ observation: null, incomingData: "invalid", status: event.type === "error" ? event.error.message : "Receiver disconnected." }); break; }
        if (event.invalidated) { tracker.accept("", { sessionId: session.id, transport: receiverTransportKind(config), receivedAt: event.receivedAt, browserReceivedMonotonicMs: event.receivedMonotonicMs, ingressAgeAtReceiptMs: event.ingressAgeAtReceiptMs ?? 0, sequence: event.ingressSequence ?? ++sequence }); this.publish({ observation: null, incomingData: "invalid", status: tracker.reason }); continue; }
        const parsed = decoder.push(event.bytes, event);
        if (parsed.invalidated || parsed.mode !== "nmea") tracker.invalidate(parsed.issue ?? "Invalid NMEA. Waiting for a fresh fixed GGA.");
        for (const item of parsed.nmea) {
          tracker.accept(item.sentence, { sessionId: session.id, transport: receiverTransportKind(config), receivedAt: item.receivedAt,
            browserReceivedMonotonicMs: item.receivedMonotonicMs, ingressAgeAtReceiptMs: event.ingressAgeAtReceiptMs ?? 0,
            sequence: event.ingressSequence ?? ++sequence });
        }
        this.publish({ observation: tracker.observation, sentenceCount: this.state.sentenceCount + parsed.nmea.length, receiverQuality: tracker.receiverQuality, sentenceIdentifier: tracker.sentenceIdentifier,
          incomingData: tracker.observation ? "receiving" : "invalid", status: tracker.reason });
      }
    } catch (error) { if (generation === this.generation) this.publish({ observation: null, status: message(error), error: message(error) }); }
    finally { if (generation === this.generation && this.session === session) await this.disconnect().catch(() => undefined); }
  }
  private publish(update: Partial<ReceiverSessionSnapshot>): void { this.state = { ...this.state, ...update }; this.listeners.forEach(listener => listener()); }
}
function formForConfig(form: Readonly<ReceiverConnectionForm>, config: ReceiverConnectionConfig): Readonly<ReceiverConnectionForm> {
  const numericText = (text: string, value: number) => Number(text) === value ? text : String(value);
  return Object.freeze(config.method === "network"
    ? { ...form, method: config.method, protocol: config.protocol,
      address: form.address.trim() === config.address ? form.address : config.address,
      port: numericText(form.port, config.port),
      sourceAddress: config.protocol !== "udp" || form.sourceAddress.trim() === (config.sourceAddress ?? "") ? form.sourceAddress : config.sourceAddress ?? "" }
    : { ...form, method: config.method, baudRate: numericText(form.baudRate, config.baudRate) });
}
function browserTransport(config: ReceiverConnectionConfig): GnssTransport {
  if (config.method === "network") {
    if (typeof location === "undefined") throw new Error("Network receiver is available in the desktop browser workspace.");
    return new NetworkReceiverTransport(config, location.origin);
  }
  const serial = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { serial?: WebSerialLike }).serial;
  if (!serial) throw new Error("Serial is unavailable. Open the desktop workspace in Windows Edge and select a USB or paired Bluetooth serial port.");
  return new WebSerialGnssTransport(serial);
}
function message(error: unknown): string { return error instanceof Error ? error.message : "Receiver operation failed."; }
export function createBrowserReceiverSessionOwner(): ReceiverSessionOwner { return new ReceiverSessionOwner(); }
export const browserReceiverSessionOwner = createBrowserReceiverSessionOwner();
