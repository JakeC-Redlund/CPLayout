import React, { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { exportFileAsync } from "@cplayout/project-store";
import { parseLayoutSessionDocument, readSurveyDesignDocument } from "@cplayout/core";
import type { useWorkspaceController } from "./useWorkspaceController";
import type { WorkspaceRecoveryReview } from "./workspaceEditRecoveryOwner";
import { WorkspaceButton } from "./WorkspaceModePanels";

/** One supporting File surface across all three modes. A checkpoint is
 * unfinished input, never a saved-design or receiver-connection receipt. */
export function WorkspaceRecoveryPanel({ controller, visible, onClose }: {
  controller: ReturnType<typeof useWorkspaceController>; visible: boolean; onClose(): void;
}) {
  const { owner, state, hydrating, available } = controller.recovery;
  const delivering = state.phase === "hydrating";
  const [review, setReview] = useState<WorkspaceRecoveryReview | null>(null);
  const [discard, setDiscard] = useState<{ writerId: string; sequence: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [storageDetails, setStorageDetails] = useState(false);
  async function exportText(filename: string, read: () => string | null | Promise<string | null>) {
    try {
      const raw = await read();
      if (raw === null) throw new Error("There are no stored recovery bytes to export.");
      const result = await exportFileAsync(filename, raw, { mimeType: "application/json" });
      if (!result.ok) throw new Error(result.message); setFileError(null);
    } catch (error) { setFileError(error instanceof Error ? error.message : "Recovery export failed. Your work is retained."); }
  }
  return <Modal visible={visible} transparent onRequestClose={() => { if (!hydrating) onClose(); }}>
    <View style={styles.backdrop}><View style={styles.dialog}><ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Unfinished work</Text>
      <Text style={styles.help}>Restore drawings, entered values and workspace choices from this browser. Saved designs and collected observations stay separate. Disconnect the receiver before restoring; reconnect explicitly when ready.</Text>
      {!available && <Text accessibilityRole="alert">Recovery requires the supported browser workspace.</Text>}
      <Text accessibilityRole={state.phase === "error" ? "alert" : undefined} accessibilityLiveRegion="polite" testID="workspace-recovery-status">{state.phase === "hydrating" ? "Restoring workspace controls…"
        : state.phase === "saving" ? "Checkpointing unfinished work…" : state.phase === "saved" ? "Unfinished-work checkpoint stored"
          : state.message ?? (state.phase === "error" ? "Recovery needs attention" : "Choose a checkpoint to review.")}</Text>
      {fileError && <Text accessibilityRole="alert">{fileError}</Text>}
      <View style={styles.row}>
        <WorkspaceButton label="Refresh checkpoints" disabled={!available || hydrating} onPress={() => { setReview(null); setDiscard(null); void owner.refresh(); }} />
        {state.phase === "error" && <WorkspaceButton label="Retry checkpoint" disabled={!available || hydrating} onPress={() => { void owner.checkpoint(); }} />}
        <WorkspaceButton label="Export current unfinished work" disabled={delivering} onPress={() => { void exportText("cplayout-unfinished-work.json", owner.exportCurrent); }} />
      </View>
      <WorkspaceButton label={storageDetails ? "Hide recovery storage details" : "Recovery storage details"} onPress={() => setStorageDetails(value => !value)} />
      {storageDetails && <View style={styles.review}><Text style={styles.help}>Keep an exact recovery backup if a checkpoint cannot be read. This includes every stored checkpoint.</Text>
        <WorkspaceButton label="Export stored recovery bytes" disabled={!available || delivering} onPress={() => { void exportText("cplayout-recovery-ledger.json", owner.exportRawLedger); }} />
      </View>}
      {state.candidates.length === 0 && <Text style={styles.help}>No readable checkpoints are listed. Export stored bytes if storage reported an error.</Text>}
      {state.candidates.map(item => {
        const candidate = item.candidate, layout = candidate.context.workspace.mode === "layout" && candidate.layout ? parseLayoutSessionDocument(candidate.layout.document) : null;
        const name = layout?.name ?? (candidate.editable ? readSurveyDesignDocument(candidate.editable.identity.kind, candidate.editable.workingDocument).name : "Customer and project entry");
        const fieldId = layout?.fieldMapId ?? candidate.editable?.identity.fieldMapId;
        const field = controller.repository.catalog.fieldMaps.find(value => value.id === fieldId), project = controller.repository.catalog.projects.find(value => value.id === field?.projectId);
        const customer = controller.repository.catalog.clients.find(value => value.id === project?.clientId);
        const context = [customer?.companyName || customer?.contactName, project?.name, field?.name].filter(Boolean).join(" › ");
        return <View style={styles.checkpoint} key={item.writerId} testID="workspace-recovery-candidate">
        <Text style={styles.label}>{name} · {candidate.context.workspace.mode === "layout" ? "RTK Layout" : candidate.context.workspace.mode === "survey" ? "Survey" : "Design"}</Text>
        {context && <Text style={styles.help}>{context}</Text>}
        <Text style={styles.help}>{candidate.capturedAt} · Checkpoint {item.sequence}{layout ? ` · Layout session revision ${layout.revision}` : candidate.editable?.designRevision !== null && candidate.editable ? ` · Saved design revision ${candidate.editable.designRevision}` : ""}</Text>
        <View style={styles.row}>
          <WorkspaceButton label="Review restore" disabled={!available || hydrating} onPress={() => {
            controller.noteUserIntent(); setDiscard(null); setReview(null); void owner.prepareRestore(item.writerId).then(setReview);
          }} />
          <WorkspaceButton label="Export checkpoint" disabled={delivering} onPress={() => { void exportText("cplayout-unfinished-work.json", () => owner.exportCandidate(item.writerId)); }} />
          <WorkspaceButton label="Discard checkpoint" disabled={hydrating} onPress={() => { setReview(null); setDiscard({ writerId: item.writerId, sequence: item.sequence }); }} />
        </View>
        {review?.writerId === item.writerId && <View style={styles.review}>
          <Text>{review.kind === "reconcile_required" ? "The saved workspace has advanced. Its exact design, Survey and Layout sources still match; restore with the reviewed current workspace receipt." : "The saved sources match this checkpoint."} Finish current entered values before restoring.</Text>
          <WorkspaceButton label="Restore unfinished work" disabled={hydrating} onPress={() => {
            const receipt = review; setReview(null); void owner.restore(receipt).then(ok => { if (ok) onClose(); });
          }} />
        </View>}
        {discard?.writerId === item.writerId && <View style={styles.review}><Text>Discard this unfinished-work checkpoint? Saved designs and observations remain available.</Text>
          <View style={styles.row}><WorkspaceButton label="Keep checkpoint" onPress={() => setDiscard(null)} />
            <WorkspaceButton label="Confirm discard" onPress={() => { const selected = discard; setDiscard(null); void owner.discard(selected.writerId, selected.sequence); }} /></View>
        </View>}
      </View>; })}
      <WorkspaceButton label="Close recovery" disabled={hydrating} onPress={onClose} />
    </ScrollView></View></View>
  </Modal>;
}
const styles = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: "rgba(20,40,25,0.35)", justifyContent: "center", alignItems: "center", padding: 12 },
  dialog: { width: "100%", maxWidth: 700, maxHeight: "88%", backgroundColor: "#fff", borderRadius: 9, padding: 18 },
  content: { gap: 12 }, title: { fontSize: 20, fontWeight: "700", color: "#254234" }, help: { fontSize: 13, lineHeight: 19, color: "#405344" },
  label: { fontSize: 14, fontWeight: "600", color: "#254234" }, row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  checkpoint: { borderWidth: 1, borderColor: "#d7dfd5", borderRadius: 7, padding: 12, gap: 9 }, review: { backgroundColor: "#edf3e9", padding: 10, gap: 10 } });
