import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, FolderOpen, Redo2, Save, Undo2, Upload } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { PivotProject } from "@cplayout/core";
import {
  buildProjectRecoveryArchiveBundle,
  exportProjectArchiveZip,
  exportZipFileAsync,
  importProjectArchiveZip,
  importZipFileAsync,
  type ProjectSummary,
} from "@cplayout/project-store";

interface Props {
  project: PivotProject;
  reasons: readonly string[];
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => Promise<void>;
  storageStatus: string;
  projects: ProjectSummary[];
  onOpenProject: (id: string) => Promise<void>;
  onProjectLoaded: (project: PivotProject) => void;
  onOpenSample: () => void;
}

const reasonLabels: Record<string, string> = {
  legacy_crs_unreadable: "This CRS is not supported for project editing.",
  unsupported_crs_definition: "The coordinate system has no qualified calculation definition.",
  non_metric_units: "Stored coordinate units are not metres.",
  geographic_input_only: "Geographic coordinates cannot be used for planar calculations.",
  web_mercator_display_only: "Web Mercator is limited to map display.",
  local_metric_declaration_missing: "Local coordinate units and axes have no verified declaration.",
  local_metric_declaration_invalid: "The local coordinate declaration is invalid.",
};

export function ProjectCrsRecoveryPanel(props: Props): React.JSX.Element {
  const { project } = props;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const active = useRef(true);
  const importRequest = useRef(0);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function perform(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    importRequest.current += 1;
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch (error) {
      if (active.current) setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (active.current) setBusy(false);
    }
  }

  async function importArchive(): Promise<void> {
    const request = ++importRequest.current;
    setStatus(null);
    // The shared picker can remain pending on cancel; do not lock navigation while it is open.
    try {
      const bytes = await importZipFileAsync();
      if (!active.current || request !== importRequest.current || !bytes) return;
      props.onProjectLoaded(importProjectArchiveZip(bytes));
    } catch (error) {
      if (active.current && request === importRequest.current) {
        setStatus(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function navigate(action: () => void): void {
    importRequest.current += 1;
    action();
  }

  async function exportRecovery(): Promise<void> {
    const bytes = exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(project));
    const outcome = await exportZipFileAsync(`${project.id}.recovery.zip`, bytes);
    if (active.current) setStatus(outcome.message);
  }

  const rawCoordinates = JSON.stringify({
    fieldBoundary: project.fieldBoundary,
    pivotCenter: project.pivotCenter,
    waterSource: project.waterSource,
    powerSource: project.powerSource,
    obstacles: project.obstacles.map(({ id, polygon }) => ({ id, polygon })),
    surveyPoints: project.surveyPoints.map(({ id, projected }) => ({ id, projected })),
    mapFeatures: (project.mapFeatures ?? []).map(({ id, geometry }) => ({ id, geometry })),
  }, null, 2);

  return (
    <ScrollView style={styles.surface} contentContainerStyle={styles.content} testID="crs-recovery-panel">
      <Text style={styles.brand}>CPLayout</Text>
      <Text style={styles.title} testID="crs-recovery-project-name">{project.name}</Text>
      <Text style={styles.crs} selectable testID="crs-recovery-crs">{project.projectCrs}</Text>
      <View style={styles.notice} accessibilityRole="alert">
        <AlertTriangle size={20} color="#9a4c1c" />
        <View style={styles.noticeBody}>
          <Text style={styles.noticeTitle}>Calculations unavailable</Text>
          {props.reasons.map((reason) => <Text key={reason} style={styles.text}>{reasonLabels[reason] ?? reason}</Text>)}
          <Text style={styles.text}>Stored coordinates are unchanged.</Text>
        </View>
      </View>
      <View style={styles.toolbar}>
        <RecoveryAction label="Save project" icon={<Save size={18} color="#254234" />} disabled={busy} onPress={() => void perform(props.onSave)} testID="crs-recovery-save" />
        <RecoveryAction label="Recovery ZIP" icon={<Download size={18} color="#254234" />} disabled={busy} onPress={() => void perform(exportRecovery)} testID="crs-recovery-export" />
        <RecoveryAction label="Import ZIP" icon={<Upload size={18} color="#254234" />} disabled={busy} onPress={() => void importArchive()} testID="crs-recovery-import" />
        <RecoveryAction label="Undo" icon={<Undo2 size={18} color="#254234" />} disabled={busy || !props.canUndo} onPress={() => navigate(props.onUndo)} testID="crs-recovery-undo" />
        <RecoveryAction label="Redo" icon={<Redo2 size={18} color="#254234" />} disabled={busy || !props.canRedo} onPress={() => navigate(props.onRedo)} testID="crs-recovery-redo" />
      </View>
      <Text style={styles.text} testID="project-save-state">{props.dirty ? "Unsaved edits" : "Saved"}</Text>
      <Text style={styles.meta}>{props.storageStatus}</Text>
      {status ? <Text accessibilityRole="alert" style={styles.text} testID="crs-recovery-status">{status}</Text> : null}
      <View style={styles.section}>
        <Text style={styles.heading}>Saved projects</Text>
        {props.projects.map((entry) => (
          <Pressable key={entry.id} accessibilityRole="button" accessibilityLabel={`Open ${entry.name}`} disabled={busy} onPress={() => void perform(() => props.onOpenProject(entry.id))} style={[styles.projectRow, busy && styles.disabled]} testID={`crs-recovery-open-${entry.id}`}>
            <FolderOpen size={18} color="#254234" />
            <View style={styles.noticeBody}>
              <Text style={styles.text}>{entry.name}</Text>
              <Text style={styles.meta}>{entry.projectCrs}</Text>
            </View>
          </Pressable>
        ))}
        {props.projects.length === 0 ? <Text style={styles.meta}>No saved projects</Text> : null}
        <RecoveryAction label="Open sample project" icon={<FolderOpen size={18} color="#254234" />} disabled={busy} onPress={() => navigate(props.onOpenSample)} testID="crs-recovery-open-sample" />
      </View>
      <View style={styles.section}>
        <Text style={styles.heading}>Stored XY</Text>
        <Text selectable style={styles.coordinates} testID="crs-recovery-xy">{rawCoordinates}</Text>
      </View>
    </ScrollView>
  );
}

function RecoveryAction({ label, icon, disabled, onPress, testID }: {
  label: string; icon: React.ReactNode; disabled: boolean; onPress: () => void; testID: string;
}): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]} testID={testID}>
      {icon}<Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, backgroundColor: "#f5f7f6" },
  content: { width: "100%", maxWidth: 1000, alignSelf: "center", padding: 20, gap: 10, paddingBottom: 40 },
  brand: { fontSize: 18, fontWeight: "800", color: "#254234" },
  title: { fontSize: 23, fontWeight: "700", color: "#172b22", flexShrink: 1 },
  crs: { fontSize: 15, color: "#40534a", flexShrink: 1 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#d4dcd7" },
  noticeBody: { flex: 1, minWidth: 0, gap: 4 },
  noticeTitle: { fontSize: 17, fontWeight: "700", color: "#734118" },
  text: { fontSize: 14, lineHeight: 21, color: "#243c30", flexShrink: 1 },
  meta: { fontSize: 12, lineHeight: 18, color: "#52655b", flexShrink: 1 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, borderWidth: 1, borderColor: "#bdcbc2", backgroundColor: "#ffffff", alignSelf: "flex-start" },
  actionText: { fontSize: 13, fontWeight: "600", color: "#254234", flexShrink: 1 },
  disabled: { opacity: 0.45 },
  section: { gap: 10, marginTop: 12, paddingTop: 16, borderTopWidth: 1, borderColor: "#d4dcd7" },
  heading: { fontSize: 16, fontWeight: "700", color: "#243c30" },
  projectRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: "#dce3de" },
  coordinates: { fontFamily: "monospace", fontSize: 12, lineHeight: 18, color: "#243c30", flexShrink: 1 },
});
