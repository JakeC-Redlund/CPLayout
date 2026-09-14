import { CheckCircle2, CircleAlert, PlugZap, Satellite } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  type AppSettings,
  type GnssCaptureEvidence,
  type ObstacleZone,
  type PivotProject,
  type ProjectMutationResult,
  type ProjectMapFeature,
  type ProjectMapFeatureKind,
  type RtkQuality,
  type SurveyPoint,
  type XY,
} from "@cplayout/core";
import {
  EMPTY_RTK_QUALITY,
  captureEvidenceFromObservation,
  createNmeaStreamAccumulator,
  evaluateGnssObservationGate,
  latestGnssObservationEpoch,
  parseNmeaStreamChunk,
  surveyPointFromGnssObservation,
  withNmeaReceptionMetadata,
  type GnssObservationEpoch,
  type GnssSession,
  type ParsedNmeaSample,
} from "@cplayout/gnss";

import { WebSerialGnssTransport, type WebSerialLike } from "../gnss/webSerialTransport";
import { browserSerialSessionOwner } from "../gnss/webSerialSessionOwner";
import { captureDraftMatchesProject, capturedDraftConfidence, type CapturedDraftVertex } from "../gnss/captureDraft";

export interface BrowserRtkReceiverStatus {
  connected: boolean;
  gateAccepted: boolean;
  quality: RtkQuality;
  sentenceCount: number;
  status: string;
}

interface BrowserRtkReceiverPanelProps {
  project: PivotProject;
  settings: AppSettings;
  onAddSurveyPoint: (point: Omit<SurveyPoint, "id" | "observedAt"> & { id?: string; observedAt?: string }) => ProjectMutationResult;
  onCommitBoundaryDraft: (vertices: XY[], captureEvidence: Array<GnssCaptureEvidence | null>) => ProjectMutationResult;
  onCommitObstacleDraft: (vertices: XY[], kind: ObstacleZone["kind"], confidence: SurveyPoint["confidence"], captureEvidence: Array<GnssCaptureEvidence | null>) => ProjectMutationResult;
  onAddMapFeature: (feature: Omit<ProjectMapFeature, "id"> & { id?: string }) => ProjectMutationResult;
  onStatusChange?: (status: BrowserRtkReceiverStatus | null) => void;
}

type NavigatorWithSerial = Navigator & {
  serial?: WebSerialLike;
};

type PreparedCapturedVertex = CapturedDraftVertex;

const SURVEY_ROLE_OPTIONS: { role: SurveyPoint["role"]; label: string }[] = [
  { role: "control", label: "Control" },
  { role: "boundary", label: "Boundary" },
  { role: "pivot_center", label: "Pivot" },
  { role: "water_source", label: "Water" },
  { role: "power_source", label: "Power" },
  { role: "obstacle", label: "Obstacle" },
  { role: "note", label: "Note" },
];

const OBSTACLE_KIND_OPTIONS: { kind: ObstacleZone["kind"]; label: string }[] = [
  { kind: "exclusion", label: "Exclusion" },
  { kind: "road", label: "Road" },
  { kind: "ditch", label: "Ditch" },
  { kind: "fence", label: "Fence" },
  { kind: "building", label: "Building" },
  { kind: "canal", label: "Canal" },
  { kind: "tree", label: "Tree" },
];

const MAP_FEATURE_OPTIONS: { kind: ProjectMapFeatureKind; label: string; geometry: ProjectMapFeature["geometry"]["type"] }[] = [
  { kind: "underground_pipeline", label: "Pipe line", geometry: "LineString" },
  { kind: "underground_wire", label: "Wire line", geometry: "LineString" },
  { kind: "linear_move_path", label: "Linear move path", geometry: "LineString" },
  { kind: "measurement_line", label: "Measure line", geometry: "LineString" },
  { kind: "power_line", label: "Power line", geometry: "LineString" },
  { kind: "fence", label: "Fence line", geometry: "LineString" },
  { kind: "access_lane", label: "Access lane", geometry: "LineString" },
  { kind: "ditch", label: "Ditch line", geometry: "LineString" },
  { kind: "planning_boundary", label: "Planning boundary", geometry: "Polygon" },
  { kind: "machine_zone", label: "Machine zone", geometry: "Polygon" },
  { kind: "pump_location", label: "Pump point", geometry: "Point" },
  { kind: "well_location", label: "Well point", geometry: "Point" },
  { kind: "power_pole", label: "Pole point", geometry: "Point" },
  { kind: "tree", label: "Tree point", geometry: "Point" },
  { kind: "end_gun_mark", label: "End gun point", geometry: "Point" },
];

export function BrowserRtkReceiverPanel({
  project,
  settings,
  onAddSurveyPoint,
  onCommitBoundaryDraft,
  onCommitObstacleDraft,
  onAddMapFeature,
  onStatusChange,
}: BrowserRtkReceiverPanelProps): React.JSX.Element {
  const serial = getWebSerial();
  const serialSupported = Boolean(serial);
  const [baudRateText, setBaudRateText] = useState("115200");
  const [sourceCrsText, setSourceCrsText] = useState("unknown");
  const [connected, setConnected] = useState(false);
  const ownership = useSyncExternalStore(browserSerialSessionOwner.subscribe, browserSerialSessionOwner.getSnapshot, browserSerialSessionOwner.getSnapshot);
  const connectionPending = ownership.phase === "opening";
  const closePending = ownership.phase === "closing";
  const cleanupFailed = ownership.phase === "cleanup_failed";
  const [status, setStatus] = useState(serialSupported ? "No receiver connected." : "Web Serial is unavailable in this browser.");
  const [observation, setObservation] = useState<GnssObservationEpoch | null>(null);
  const [nowMonotonicMs, setNowMonotonicMs] = useState(monotonicNow());
  const [sentenceCount, setSentenceCount] = useState(0);
  const [surveyRole, setSurveyRole] = useState<SurveyPoint["role"]>("control");
  const [obstacleKind, setObstacleKind] = useState<ObstacleZone["kind"]>("exclusion");
  const [mapFeatureKind, setMapFeatureKind] = useState<ProjectMapFeatureKind>("underground_pipeline");
  const [boundaryDraft, setBoundaryDraft] = useState<PreparedCapturedVertex[]>([]);
  const [obstacleDraft, setObstacleDraft] = useState<PreparedCapturedVertex[]>([]);
  const [mapFeatureDraft, setMapFeatureDraft] = useState<PreparedCapturedVertex[]>([]);
  const samplesRef = useRef<ParsedNmeaSample[]>([]);
  const observationRef = useRef<GnssObservationEpoch | null>(null);
  const lastEpochRef = useRef<GnssObservationEpoch | null>(null);
  const sessionRef = useRef<GnssSession | null>(null);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  const gate = useMemo(() => evaluateGnssObservationGate(observation, {
    connected,
    projectCrs: project.projectCrs,
    nowMonotonicMs,
    sourceCoordinateFrame: sourceCrsText,
  }, settings.gpsQuality), [connected, nowMonotonicMs, observation, project.projectCrs, settings.gpsQuality, sourceCrsText]);
  const quality = gate.quality ?? EMPTY_RTK_QUALITY;
  const canCapture = gate.accepted && observation !== null;
  const mapFeatureOption = MAP_FEATURE_OPTIONS.find((option) => option.kind === mapFeatureKind) ?? MAP_FEATURE_OPTIONS[0];
  const canSaveMapFeature = mapFeatureOption.geometry === "Point"
    ? canCapture
    : mapFeatureDraft.length >= (mapFeatureOption.geometry === "Polygon" ? 3 : 2);
  const mapFeatureGeometryLabel = mapFeatureOption.geometry === "LineString" ? "Line" : mapFeatureOption.geometry;

  function updateObservation(next: GnssObservationEpoch | null): void {
    observationRef.current = next;
    if (next) lastEpochRef.current = next;
    setObservation(next);
  }

  function captureObservationNow(): GnssObservationEpoch | null {
    const latest = observationRef.current;
    const currentGate = evaluateGnssObservationGate(latest, {
      connected: browserSerialSessionOwner.getSnapshot().phase === "connected"
        && sessionRef.current !== null && sessionRef.current.id === latest?.sessionId,
      projectCrs: project.projectCrs,
      nowMonotonicMs: monotonicNow(),
      sourceCoordinateFrame: sourceCrsText,
    }, settings.gpsQuality);
    if (!latest || !currentGate.accepted) {
      setStatus("RTK gate is closed; capture was blocked.");
      return null;
    }
    return { ...latest, quality: currentGate.quality };
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      const owned = browserSerialSessionOwner.getSnapshot();
      if (owned.phase === "connected" && owned.session === sessionRef.current && owned.session) {
        void browserSerialSessionOwner.close(owned.session).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (ownership.error) setStatus(ownership.error);
  }, [ownership.error]);

  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => setNowMonotonicMs(monotonicNow()), 500);
    return () => clearInterval(timer);
  }, [connected]);

  useEffect(() => {
    setBoundaryDraft([]);
    setObstacleDraft([]);
    setMapFeatureDraft([]);
  }, [project.id, project.projectCrs]);

  useEffect(() => {
    return () => {
      onStatusChange?.(null);
    };
  }, [onStatusChange]);

  useEffect(() => {
    onStatusChange?.({
      connected,
      gateAccepted: gate.accepted,
      quality,
      sentenceCount,
      status,
    });
  }, [connected, gate.accepted, onStatusChange, quality, sentenceCount, status]);

  async function connect(): Promise<void> {
    if (browserSerialSessionOwner.getSnapshot().phase !== "idle") return;
    if (!serial) {
      setStatus("Web Serial is unavailable in this browser.");
      return;
    }
    const baudRate = Number(baudRateText);
    if (!Number.isInteger(baudRate) || baudRate <= 0) {
      setStatus("Baud rate must be a positive integer.");
      return;
    }
    const runId = ++runIdRef.current;
    try {
      const session = await browserSerialSessionOwner.open(new WebSerialGnssTransport(serial), { baudRate });
      if (!mountedRef.current || runIdRef.current !== runId) {
        await browserSerialSessionOwner.close(session);
        return;
      }
      sessionRef.current = session;
      samplesRef.current = [];
      lastEpochRef.current = null;
      updateObservation(null);
      setSentenceCount(0);
      setConnected(true);
      setNowMonotonicMs(monotonicNow());
      setStatus("Reading NMEA from browser serial port.");
      void readNmeaLoop(session, runId);
    } catch (error) {
      if (mountedRef.current && runIdRef.current === runId) setStatus(errorMessage(error, "Could not open browser serial receiver."));
    }
  }

  async function disconnect(): Promise<void> {
    runIdRef.current += 1;
    const session = browserSerialSessionOwner.getSnapshot().session;
    setConnected(false);
    samplesRef.current = [];
    lastEpochRef.current = null;
    updateObservation(null);
    if (!session || await closeSession(session)) {
      if (mountedRef.current) setStatus("Receiver disconnected.");
    }
  }

  async function closeSession(session: GnssSession): Promise<boolean> {
    try {
      await browserSerialSessionOwner.close(session);
      if (sessionRef.current === session) sessionRef.current = null;
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setStatus(errorMessage(error, "Receiver cleanup failed. Retry closing the port."));
      }
      return false;
    }
  }

  async function readNmeaLoop(session: GnssSession, runId: number): Promise<void> {
    const decoder = new TextDecoder();
    let accumulator = createNmeaStreamAccumulator();
    try {
      for await (const event of session.events()) {
        if (runIdRef.current !== runId) return;
        if (event.type === "error") {
          setConnected(false);
          samplesRef.current = [];
          updateObservation(null);
          setStatus(event.error.message);
          return;
        }
        if (event.type === "ended") {
          setConnected(false);
          samplesRef.current = [];
          updateObservation(null);
          setStatus(event.reason === "eof" ? "Receiver stream ended." : "Receiver disconnected.");
          return;
        }
        const parsed = parseNmeaStreamChunk(accumulator, decoder.decode(event.bytes, { stream: true }));
        accumulator = parsed.accumulator;
        if (parsed.lines.length > 0) setSentenceCount((current) => current + parsed.lines.length);
        if (parsed.samples.length > 0) {
          const stamped = withNmeaReceptionMetadata(parsed.samples, {
            receivedAt: event.receivedAt,
            receivedMonotonicMs: event.receivedMonotonicMs,
          });
          setNowMonotonicMs(event.receivedMonotonicMs);
          const next = [...samplesRef.current, ...stamped].slice(-120);
          samplesRef.current = next;
          updateObservation(latestGnssObservationEpoch(next, session.id, lastEpochRef.current));
        }
      }
    } catch (error) {
      if (runIdRef.current === runId) {
        setConnected(false);
        samplesRef.current = [];
        updateObservation(null);
        setStatus(errorMessage(error, "NMEA serial read failed."));
      }
    } finally {
      if (runIdRef.current === runId && sessionRef.current === session) {
        await closeSession(session);
      }
    }
  }

  function captureSurveyPoint(): void {
    const captureObservation = captureObservationNow();
    if (!captureObservation) return;
    try {
      const point = surveyPointFromGnssObservation({
        observation: captureObservation,
        projectCrs: project.projectCrs,
        sourceCoordinateFrame: sourceCrsText,
        transport: "web_serial",
        id: `rtk-${Date.now().toString(36)}-${project.surveyPoints.length + 1}`,
        label: `${surveyRole.replaceAll("_", " ")} RTK ${project.surveyPoints.length + 1}`,
        role: surveyRole,
      });
      const result = onAddSurveyPoint(point);
      setStatus(result.ok
        ? `Captured ${surveyRole.replaceAll("_", " ")} survey point with ${formatSourceConfidence(point.confidence)} confidence.`
        : result.error);
    } catch (error) {
      setStatus(errorMessage(error, "RTK survey capture failed."));
    }
  }

  function addBoundaryVertex(): void {
    addDraftVertex(setBoundaryDraft, "Boundary");
  }

  function addObstacleVertex(): void {
    addDraftVertex(setObstacleDraft, "Obstacle");
  }

  function addMapFeatureVertex(): void {
    addDraftVertex(setMapFeatureDraft, "Map feature");
  }

  function addDraftVertex(updateDraft: React.Dispatch<React.SetStateAction<PreparedCapturedVertex[]>>, label: string): void {
    const vertex = latestPreparedVertex();
    if (!vertex) return;
    updateDraft((current) => [...(captureDraftMatchesProject(current, project) ? current : []), vertex]);
    setStatus(`${label} RTK vertex added.`);
  }

  function commitBoundary(): void {
    if (boundaryDraft.length < 3 || !validateDraftScope(boundaryDraft)) return;
    const result = onCommitBoundaryDraft(
      boundaryDraft.map((vertex) => vertex.projected),
      boundaryDraft.map((vertex) => vertex.evidence),
    );
    if (result.ok) {
      setBoundaryDraft([]);
      setStatus("RTK boundary ring committed as projected XY.");
    } else {
      setStatus(result.error);
    }
  }

  function commitObstacle(): void {
    if (obstacleDraft.length < 3 || !validateDraftScope(obstacleDraft)) return;
    const result = onCommitObstacleDraft(
      obstacleDraft.map((vertex) => vertex.projected),
      obstacleKind,
      capturedDraftConfidence(obstacleDraft),
      obstacleDraft.map((vertex) => vertex.evidence),
    );
    if (result.ok) {
      setObstacleDraft([]);
      setStatus(`RTK ${obstacleKind} obstacle ring committed as projected XY.`);
    } else {
      setStatus(result.error);
    }
  }

  function saveMapFeature(): void {
    if (!mapFeatureOption) return;
    const notes = "Captured through browser Web Serial NMEA; hardware compatibility remains unverified until a receiver proof session is recorded.";
    if (mapFeatureOption.geometry === "Point") {
      const vertex = latestPreparedVertex();
      if (!vertex) return;
      const result = onAddMapFeature({
        name: `${mapFeatureOption.label} RTK`,
        kind: mapFeatureOption.kind,
        geometry: { type: "Point", point: vertex.projected },
        confidence: vertex.confidence,
        vertexCaptureEvidence: [vertex.evidence],
        notes,
      });
      setStatus(result.ok ? `RTK ${mapFeatureOption.label.toLowerCase()} saved as projected XY.` : result.error);
      return;
    }
    const minimumVertices = mapFeatureOption.geometry === "Polygon" ? 3 : 2;
    if (mapFeatureDraft.length < minimumVertices || !validateDraftScope(mapFeatureDraft)) return;
    const result = onAddMapFeature({
      name: `${mapFeatureOption.label} RTK`,
      kind: mapFeatureOption.kind,
      geometry: mapFeatureOption.geometry === "Polygon"
        ? { type: "Polygon", vertices: mapFeatureDraft.map((vertex) => vertex.projected) }
        : { type: "LineString", vertices: mapFeatureDraft.map((vertex) => vertex.projected) },
      confidence: capturedDraftConfidence(mapFeatureDraft),
      vertexCaptureEvidence: mapFeatureDraft.map((vertex) => vertex.evidence),
      notes,
    });
    if (result.ok) {
      setMapFeatureDraft([]);
      setStatus(`RTK ${mapFeatureOption.label.toLowerCase()} saved as projected XY.`);
    } else {
      setStatus(result.error);
    }
  }

  function latestPreparedVertex(): PreparedCapturedVertex | null {
    const captureObservation = captureObservationNow();
    if (!captureObservation) return null;
    try {
      const surveyPoint = surveyPointFromGnssObservation({
        observation: captureObservation,
        projectCrs: project.projectCrs,
        sourceCoordinateFrame: sourceCrsText,
        transport: "web_serial",
        id: `prepared-${captureObservation.id}`,
        label: "Prepared RTK vertex",
      });
      return {
        projectId: project.id,
        projectCrs: project.projectCrs,
        confidence: surveyPoint.confidence,
        projected: surveyPoint.projected,
        evidence: surveyPoint.captureEvidence ?? captureEvidenceFromObservation({
          observation: captureObservation,
          transport: "web_serial",
          sourceCoordinateFrame: sourceCrsText,
        }),
      };
    } catch (error) {
      setStatus(errorMessage(error, "Could not project the latest RTK fix."));
      return null;
    }
  }

  function validateDraftScope(vertices: PreparedCapturedVertex[]): boolean {
    if (captureDraftMatchesProject(vertices, project)) return true;
    setStatus("Capture draft belongs to a different project or CRS; commit was blocked.");
    return false;
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Satellite size={20} color="#254234" />
          <Text style={styles.title}>Browser RTK Receiver</Text>
        </View>
        <View style={[styles.gateBadge, gate.accepted ? styles.gateBadgeAccepted : styles.gateBadgeBlocked]} testID="rtk-gate-badge">
          {gate.accepted ? <CheckCircle2 size={16} color="#1f5f39" /> : <CircleAlert size={16} color="#8b1e18" />}
          <Text style={[styles.gateText, gate.accepted ? styles.gateTextAccepted : styles.gateTextBlocked]}>{gate.accepted ? "Gate accepted" : "Gate closed"}</Text>
        </View>
      </View>

      <View style={styles.connectionRow}>
        <TextInput
          accessibilityLabel="RTK serial baud rate"
          editable={!connected && !connectionPending && !closePending && !cleanupFailed}
          keyboardType="number-pad"
          onChangeText={setBaudRateText}
          style={styles.baudInput}
          value={baudRateText}
        />
        <TextInput
          accessibilityLabel="Receiver source CRS"
          autoCapitalize="characters"
          onChangeText={setSourceCrsText}
          placeholder="EPSG:4326"
          style={styles.crsInput}
          value={sourceCrsText}
        />
        <PanelButton
          disabled={!serialSupported || connectionPending || closePending}
          icon={<PlugZap size={16} color={serialSupported ? "#254234" : "#68766d"} />}
          label={connectionPending ? "Opening Serial" : closePending ? "Closing Serial" : cleanupFailed ? "Retry Close" : connected ? "Disconnect" : "Open Serial"}
          onPress={() => { void (connected || cleanupFailed ? disconnect() : connect()); }}
        />
      </View>

      <Text style={styles.statusText} testID="rtk-status">{status}</Text>
      <View style={styles.metricsGrid}>
        <RtkMetric label="Fix" value={quality.fixType} />
        <RtkMetric label="Satellites" value={formatNullable(quality.satellites)} />
        <RtkMetric label="HDOP" value={formatNullable(quality.hdop)} />
        <RtkMetric label="VDOP" value={formatNullable(quality.vdop)} />
        <RtkMetric label="PDOP" value={formatNullable(quality.pdop)} />
        <RtkMetric label="Correction age" value={quality.correctionAgeSeconds === null ? "unknown" : `${quality.correctionAgeSeconds}s`} />
        <RtkMetric label="Horizontal RMS" value={quality.horizontalAccuracyMeters === null ? "unknown" : `${quality.horizontalAccuracyMeters.toFixed(3)} m`} />
        <RtkMetric label="Observation age" value={gate.observationAgeSeconds === null ? "unknown" : `${gate.observationAgeSeconds.toFixed(1)}s`} />
        <RtkMetric label="Receiver time" value={observation?.receiverObservedAt ?? "unavailable"} />
        <RtkMetric label="NMEA lines" value={`${sentenceCount}`} />
      </View>
      {!gate.accepted ? <Text style={styles.gateReasons} testID="rtk-gate-reasons">{gate.reasons.slice(0, 4).join("; ") || "Waiting for accepted NMEA quality."}</Text> : null}

      <View style={styles.captureBlock}>
        <Text style={styles.groupTitle}>Survey Point</Text>
        <View style={styles.choiceRow}>
          {SURVEY_ROLE_OPTIONS.map((option) => (
            <ChoiceButton key={option.role} active={surveyRole === option.role} label={option.label} onPress={() => setSurveyRole(option.role)} />
          ))}
        </View>
        <PanelButton disabled={!canCapture} label="Capture Survey Point" primary onPress={captureSurveyPoint} />
      </View>

      <View style={styles.captureBlock}>
        <Text style={styles.groupTitle}>Ordered Rings</Text>
        <View style={styles.actionRow}>
          <PanelButton disabled={!canCapture} label={`Add Boundary (${boundaryDraft.length})`} onPress={addBoundaryVertex} />
          <PanelButton disabled={boundaryDraft.length < 3} label="Commit Boundary" primary onPress={commitBoundary} />
          <PanelButton disabled={boundaryDraft.length === 0} label="Clear Boundary" onPress={() => setBoundaryDraft([])} />
        </View>
        <View style={styles.choiceRow}>
          {OBSTACLE_KIND_OPTIONS.map((option) => (
            <ChoiceButton key={option.kind} active={obstacleKind === option.kind} label={option.label} onPress={() => setObstacleKind(option.kind)} />
          ))}
        </View>
        <View style={styles.actionRow}>
          <PanelButton disabled={!canCapture} label={`Add Obstacle (${obstacleDraft.length})`} onPress={addObstacleVertex} />
          <PanelButton disabled={obstacleDraft.length < 3} label="Commit Obstacle" primary onPress={commitObstacle} />
          <PanelButton disabled={obstacleDraft.length === 0} label="Clear Obstacle" onPress={() => setObstacleDraft([])} />
        </View>
      </View>

      <View style={styles.captureBlock}>
        <Text style={styles.groupTitle}>Map Feature</Text>
        <View style={styles.choiceRow}>
          {MAP_FEATURE_OPTIONS.map((option) => (
            <ChoiceButton key={option.kind} active={mapFeatureKind === option.kind} label={option.label} onPress={() => setMapFeatureKind(option.kind)} />
          ))}
        </View>
        <View style={styles.actionRow}>
          <PanelButton disabled={!canCapture || mapFeatureOption.geometry === "Point"} label={`Add Feature Vertex (${mapFeatureDraft.length})`} onPress={addMapFeatureVertex} />
          <PanelButton disabled={!canSaveMapFeature} label={`Save ${mapFeatureGeometryLabel} Feature`} primary onPress={saveMapFeature} />
          <PanelButton disabled={mapFeatureDraft.length === 0} label="Clear Feature" onPress={() => setMapFeatureDraft([])} />
        </View>
      </View>
    </View>
  );
}

function getWebSerial(): WebSerialLike | undefined {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return undefined;
  return (navigator as NavigatorWithSerial).serial;
}

function monotonicNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function formatNullable(value: number | null): string {
  if (value === null) return "unknown";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatSourceConfidence(confidence: SurveyPoint["confidence"]): string {
  if (confidence === "rtk_fixed") return "RTK fixed";
  if (confidence === "rtk_float") return "RTK float";
  if (confidence === "dgps") return "DGPS";
  return confidence.replaceAll("_", " ");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function RtkMetric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function ChoiceButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.choiceButton, active && styles.choiceButtonActive]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PanelButton({ disabled = false, icon, label, onPress, primary = false }: { disabled?: boolean; icon?: React.ReactNode; label: string; onPress: () => void; primary?: boolean }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.panelButton, primary && styles.panelButtonPrimary, disabled && styles.panelButtonDisabled]}>
      {icon}
      <Text style={[styles.panelButtonText, primary && styles.panelButtonTextPrimary, disabled && styles.panelButtonTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderColor: "#dce3da",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 12,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  headerTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  title: {
    color: "#17241c",
    fontSize: 16,
    fontWeight: "900",
  },
  gateBadge: {
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  gateBadgeAccepted: {
    backgroundColor: "#eef8ee",
    borderColor: "#b8d9bc",
  },
  gateBadgeBlocked: {
    backgroundColor: "#fff1ee",
    borderColor: "#e7c1b9",
  },
  gateText: {
    fontSize: 12,
    fontWeight: "900",
  },
  gateTextAccepted: {
    color: "#1f5f39",
  },
  gateTextBlocked: {
    color: "#8b1e18",
  },
  connectionRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  baudInput: {
    backgroundColor: "#ffffff",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    color: "#1d2c22",
    fontSize: 14,
    fontWeight: "800",
    minHeight: 40,
    minWidth: 112,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  crsInput: {
    backgroundColor: "#ffffff",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    color: "#1d2c22",
    fontSize: 14,
    fontWeight: "800",
    minHeight: 40,
    minWidth: 150,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusText: {
    color: "#405448",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metric: {
    backgroundColor: "#f4f7f1",
    borderColor: "#dbe5d8",
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 126,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  metricLabel: {
    color: "#607067",
    fontSize: 11,
    fontWeight: "800",
  },
  metricValue: {
    color: "#1d2c22",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 2,
  },
  gateReasons: {
    color: "#8b1e18",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  captureBlock: {
    borderColor: "#e1e8df",
    borderRadius: 8,
    borderWidth: 1,
    gap: 9,
    padding: 10,
  },
  groupTitle: {
    color: "#26392f",
    fontSize: 13,
    fontWeight: "900",
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceButton: {
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  choiceButtonActive: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  choiceText: {
    color: "#314339",
    fontSize: 12,
    fontWeight: "900",
  },
  choiceTextActive: {
    color: "#ffffff",
  },
  panelButton: {
    alignItems: "center",
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  panelButtonPrimary: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  panelButtonDisabled: {
    opacity: 0.45,
  },
  panelButtonText: {
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
  },
  panelButtonTextPrimary: {
    color: "#ffffff",
  },
  panelButtonTextDisabled: {
    color: "#68766d",
  },
});
