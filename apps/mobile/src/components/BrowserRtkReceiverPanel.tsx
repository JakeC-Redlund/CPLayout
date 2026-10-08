import { CheckCircle2, CircleAlert, Satellite } from "lucide-react-native";
import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

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
import { EMPTY_RTK_QUALITY } from "@cplayout/gnss";
import { browserReceiverSessionOwner, type ReceiverSessionOwner, type ReceiverCollectionView } from "../gnss/receiverSessionOwner";
import { canCommitCapturedDraft, captureDraftMatchesProject, capturedDraftConfidence, type CapturedDraftVertex } from "../gnss/captureDraft";
import { ReceiverConnectionPanel } from "./ReceiverConnectionPanel";

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
  owner?: ReceiverSessionOwner;
  onAddSurveyPoint: (point: Omit<SurveyPoint, "id" | "observedAt"> & { id?: string; observedAt?: string }) => ProjectMutationResult;
  onCommitBoundaryDraft: (vertices: XY[], captureEvidence: Array<GnssCaptureEvidence | null>) => ProjectMutationResult;
  onCommitObstacleDraft: (vertices: XY[], kind: ObstacleZone["kind"], confidence: SurveyPoint["confidence"], captureEvidence: Array<GnssCaptureEvidence | null>) => ProjectMutationResult;
  onAddMapFeature: (feature: Omit<ProjectMapFeature, "id"> & { id?: string }) => ProjectMutationResult;
  onStatusChange?: (status: BrowserRtkReceiverStatus | null) => void;
}

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
  owner = browserReceiverSessionOwner,
}: BrowserRtkReceiverPanelProps): React.JSX.Element {
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [, setTick] = useState(0);
  const [status, setStatus] = useState("");
  const [purpose, setPurpose] = useState<"point" | "boundary" | "obstacle" | "feature">("point");
  const [, refreshDrafts] = useState(0);
  const view = owner.collectionView(project.id, project.projectCrs);
  const { surveyRole, obstacleKind, mapFeatureKind, boundaryDraft, obstacleDraft, mapFeatureDraft } = view;
  function setCollectionField<K extends keyof ReceiverCollectionView>(field: K, value: React.SetStateAction<ReceiverCollectionView[K]>): void {
    owner.updateCollectionView(project.id, project.projectCrs, current => ({ ...current, [field]: typeof value === "function" ? (value as (previous: ReceiverCollectionView[K]) => ReceiverCollectionView[K])(current[field]) : value }));
    refreshDrafts(version => version + 1);
  }
  const setSurveyRole = (value: SurveyPoint["role"]) => setCollectionField("surveyRole", value);
  const setObstacleKind = (value: ObstacleZone["kind"]) => setCollectionField("obstacleKind", value);
  const setMapFeatureKind = (value: ProjectMapFeatureKind) => setCollectionField("mapFeatureKind", value);
  const setBoundaryDraft = (value: React.SetStateAction<PreparedCapturedVertex[]>) => setCollectionField("boundaryDraft", value);
  const setObstacleDraft = (value: React.SetStateAction<PreparedCapturedVertex[]>) => setCollectionField("obstacleDraft", value);
  const setMapFeatureDraft = (value: React.SetStateAction<PreparedCapturedVertex[]>) => setCollectionField("mapFeatureDraft", value);
  const gate = owner.collectionGate(project.projectCrs);
  const canCapture = gate.accepted;
  const quality = state.observation?.quality ?? EMPTY_RTK_QUALITY;
  const connected = state.phase === "connected";
  const mapFeatureOption = MAP_FEATURE_OPTIONS.find(option => option.kind === mapFeatureKind) ?? MAP_FEATURE_OPTIONS[0];
  const canSaveMapFeature = mapFeatureOption.geometry === "Point" ? canCapture
    : mapFeatureDraft.length >= (mapFeatureOption.geometry === "Polygon" ? 3 : 2)
      && captureDraftMatchesProject(mapFeatureDraft, project) && canCommitCapturedDraft(settings.mappingWorkflowMode, true, mapFeatureDraft);
  const mapFeatureGeometryLabel = mapFeatureOption.geometry === "LineString" ? "Line" : mapFeatureOption.geometry;
  useEffect(() => { const timer = setInterval(() => setTick(value => value + 1), 200); return () => clearInterval(timer); }, []);
  useEffect(() => { onStatusChange?.({ connected, gateAccepted: gate.accepted, quality, sentenceCount: state.sentenceCount, status: status || state.status }); }, [connected, gate.accepted, onStatusChange, quality, state.sentenceCount, state.status, status]);

  function captureSurveyPoint(): void {
    try {
      const point = owner.capture(project.projectCrs, `rtk-${globalThis.crypto.randomUUID()}`, `${surveyRole.replaceAll("_", " ")} RTK ${project.surveyPoints.length + 1}`, surveyRole);
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
    if (boundaryDraft.length < 3 || !validateDraftScope(boundaryDraft) || !authorizeDraftCommit(boundaryDraft)) return;
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
    if (obstacleDraft.length < 3 || !validateDraftScope(obstacleDraft) || !authorizeDraftCommit(obstacleDraft)) return;
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
    const notes = "Captured from receiver-reported fixed GGA. Physical transport and field accuracy remain unverified.";
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
    if (mapFeatureDraft.length < minimumVertices || !validateDraftScope(mapFeatureDraft) || !authorizeDraftCommit(mapFeatureDraft)) return;
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
    try {
      const surveyPoint = owner.capture(project.projectCrs, `prepared-${globalThis.crypto.randomUUID()}`, "Prepared RTK vertex");
      return {
        projectId: project.id,
        projectCrs: project.projectCrs,
        confidence: surveyPoint.confidence,
        projected: surveyPoint.projected,
        evidence: surveyPoint.captureEvidence,
      };
    } catch (error) {
      setStatus(errorMessage(error, "Could not project the latest RTK fix."));
      return null;
    }
  }

  function authorizeDraftCommit(vertices: PreparedCapturedVertex[]): boolean {
    if (canCommitCapturedDraft(settings.mappingWorkflowMode, true, vertices)) return true;
    setStatus("Every layout vertex needs recorded fixed receiver evidence.");
    return false;
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
          <Text style={styles.title}>Survey collection</Text>
        </View>
        <View style={[styles.gateBadge, gate.accepted ? styles.gateBadgeAccepted : styles.gateBadgeBlocked]} testID="rtk-gate-badge">
          {gate.accepted ? <CheckCircle2 size={16} color="#1f5f39" /> : <CircleAlert size={16} color="#8b1e18" />}
          <Text style={[styles.gateText, gate.accepted ? styles.gateTextAccepted : styles.gateTextBlocked]}>{gate.accepted ? "Live capture available" : "Live capture unavailable"}</Text>
        </View>
      </View>

      <View style={styles.captureBlock} testID="survey-purpose">
        <Text style={styles.groupTitle}>What are you collecting?</Text>
        <View style={styles.choiceRow}>
          {([{ id: "point", label: "Point" }, { id: "boundary", label: "Boundary" }, { id: "obstacle", label: "Obstacle" }, { id: "feature", label: "Feature" }] as const).map(option =>
            <ChoiceButton key={option.id} active={purpose === option.id} label={option.label} testID={`survey-purpose-${option.id}`} onPress={() => setPurpose(option.id)} />)}
        </View>
        <Text style={styles.statusText}>Changing purpose keeps your captured points and unfinished shapes.</Text>
      </View>
      <ReceiverConnectionPanel owner={owner} projectCrs={project.projectCrs} />
      {purpose !== "point" && <Text style={styles.statusText} testID="survey-recorded-shape-help">Live capture is needed to add new vertices. A complete captured shape with valid recorded evidence can still be applied while the receiver is disconnected.</Text>}
      {status ? <Text style={styles.statusText} testID="rtk-status">{status}</Text> : null}

      {purpose === "point" && <View style={styles.captureBlock} testID="survey-point-controls">
        <Text style={styles.groupTitle}>Point purpose</Text>
        <View style={styles.choiceRow}>
          {SURVEY_ROLE_OPTIONS.map((option) => (
            <ChoiceButton key={option.role} active={surveyRole === option.role} label={option.label} onPress={() => setSurveyRole(option.role)} />
          ))}
        </View>
        <PanelButton disabled={!canCapture} label="Capture Survey Point" primary onPress={captureSurveyPoint} />
      </View>}

      {purpose === "boundary" && <View style={styles.captureBlock} testID="survey-boundary-controls">
        <Text style={styles.groupTitle}>Field boundary · {boundaryDraft.length} captured vertices</Text>
        <Text style={styles.statusText}>Capture the corners in order. Applying the captured boundary replaces the current design boundary; it does not capture a new receiver position.</Text>
        <View style={styles.actionRow}>
          <PanelButton disabled={!canCapture} label={`Add Boundary (${boundaryDraft.length})`} onPress={addBoundaryVertex} />
          <PanelButton disabled={boundaryDraft.length < 3 || !captureDraftMatchesProject(boundaryDraft, project) || !canCommitCapturedDraft(settings.mappingWorkflowMode, true, boundaryDraft)} label="Use captured boundary in this design" primary onPress={commitBoundary} />
          <PanelButton disabled={boundaryDraft.length === 0} label="Clear Boundary" onPress={() => setBoundaryDraft([])} />
        </View>
      </View>}
      {purpose === "obstacle" && <View style={styles.captureBlock} testID="survey-obstacle-controls">
        <Text style={styles.groupTitle}>Obstacle · {obstacleDraft.length} captured vertices</Text>
        <Text style={styles.statusText}>Capture the outline in order, then apply the recorded shape to this design.</Text>
        {obstacleDraft.length > 0 && <Text style={styles.statusText}>The captured outline keeps its obstacle type. Apply or explicitly clear it before choosing another type.</Text>}
        <View style={styles.choiceRow}>
          {OBSTACLE_KIND_OPTIONS.map((option) => (
            <ChoiceButton key={option.kind} disabled={obstacleDraft.length > 0 && obstacleKind !== option.kind} active={obstacleKind === option.kind} label={option.label} onPress={() => setObstacleKind(option.kind)} />
          ))}
        </View>
        <View style={styles.actionRow}>
          <PanelButton disabled={!canCapture} label={`Add Obstacle (${obstacleDraft.length})`} onPress={addObstacleVertex} />
          <PanelButton disabled={obstacleDraft.length < 3 || !captureDraftMatchesProject(obstacleDraft, project) || !canCommitCapturedDraft(settings.mappingWorkflowMode, true, obstacleDraft)} label="Use captured obstacle in this design" primary onPress={commitObstacle} />
          <PanelButton disabled={obstacleDraft.length === 0} label="Clear Obstacle" onPress={() => setObstacleDraft([])} />
        </View>
      </View>}

      {purpose === "feature" && <View style={styles.captureBlock} testID="survey-feature-controls">
        <Text style={styles.groupTitle}>Map feature · {mapFeatureDraft.length} captured vertices</Text>
        {mapFeatureDraft.length > 0 && <Text style={styles.statusText}>The captured shape keeps its feature type. Save or explicitly clear it before choosing another type.</Text>}
        <View style={styles.choiceRow}>
          {MAP_FEATURE_OPTIONS.map((option) => (
            <ChoiceButton key={option.kind} disabled={mapFeatureDraft.length > 0 && mapFeatureKind !== option.kind} active={mapFeatureKind === option.kind} label={option.label} onPress={() => setMapFeatureKind(option.kind)} />
          ))}
        </View>
        <View style={styles.actionRow}>
          {mapFeatureOption.geometry !== "Point" && <PanelButton disabled={!canCapture} label={`Add Feature Vertex (${mapFeatureDraft.length})`} onPress={addMapFeatureVertex} />}
          <PanelButton disabled={!canSaveMapFeature} label={`Save ${mapFeatureGeometryLabel} Feature`} primary onPress={saveMapFeature} />
          <PanelButton disabled={mapFeatureDraft.length === 0} label="Clear Feature" onPress={() => setMapFeatureDraft([])} />
        </View>
      </View>}
    </View>
  );
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

function ChoiceButton({ active, label, onPress, disabled = false, testID }: { active: boolean; label: string; onPress: () => void; disabled?: boolean; testID?: string }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active, disabled }} {...(Platform.OS === "web" ? { "aria-pressed": active } : {})} testID={testID} disabled={disabled} onPress={onPress} style={[styles.choiceButton, active && styles.choiceButtonActive, disabled && styles.panelButtonDisabled]}>
      <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{label}</Text>
    </Pressable>
  );
}

function PanelButton({ disabled = false, icon, label, onPress, primary = false }: { disabled?: boolean; icon?: React.ReactNode; label: string; onPress: () => void; primary?: boolean }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.panelButton, primary && styles.panelButtonPrimary, disabled && styles.panelButtonDisabled]}>
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
    maxWidth: "100%",
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
    flexShrink: 1,
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
