import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calculator, CheckCircle2, Download, FolderOpen, Info, LockKeyhole, Redo2, Save, SlidersHorizontal, TriangleAlert, Undo2 } from "lucide-react-native";
import {
  createDesignDraftEditorState, drawingPurpose, reduceDesignDraftEditorState, tryBuildPivotProject,
  type DesignDraftEditorAction, type DraftDrawingCommand, type LayoutResult,
} from "@cplayout/core";
import { evaluateLayout } from "@cplayout/geometry";
import { DesignDraftMapSurface } from "@cplayout/map-adapters";
import { buildDesignDraftArchiveBundle, exportDesignDraftArchiveZip, exportZipFileAsync } from "@cplayout/project-store";
import { useEditorSaveCoordinator } from "../hooks/useEditorSaveCoordinator";
import { useProjectRepository, type OpenedDraft } from "../hooks/useProjectRepository";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
import { DrawingClassificationDialog } from "./DrawingClassificationDialog";
import { DesignDraftInputs } from "./DesignDraftInputs";

export function DesignDraftWorkspace({ initial, onClose }: { initial: OpenedDraft; onClose: () => void }): React.JSX.Element {
  const [editor, setEditor] = useState(() => createDesignDraftEditorState(initial.draft));
  const editorRef = useRef(editor);
  const repository = useProjectRepository();
  const { saveCoordinator, saveSessionRef, saveOwnerMountedRef } = useEditorSaveCoordinator({
    kind: "draft", payloadId: initial.draft.id, designId: initial.context.designId!,
    workspaceRevision: initial.persistenceRevision, designRevision: initial.designRevision,
  });
  const [savedRevision, setSavedRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingCount = useRef(0);
  const queuedRevisions = useRef(new Set<number>());
  const [saveFailed, setSaveFailed] = useState(false);
  const [pausedRevision, setPausedRevision] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingInputs, setPendingInputs] = useState(false);
  const { width } = useWindowDimensions();
  const compact = width < 800;
  const [inputsOpen, setInputsOpen] = useState(!compact);
  const [preview, setPreview] = useState<{ revision: number; result: LayoutResult } | null>(null);
  const admission = useMemo(() => tryBuildPivotProject(editor.draft), [editor.draft]);
  const pending = pendingInputs;
  const autosave = editor.draft.drawingWorkflow?.autosaveEnabled ?? true;
  const activeCapture = editor.draft.drawingWorkflow?.captures.find(item => item.id === editor.draft.drawingWorkflow?.activeCaptureId);
  const dirty = editor.revision !== savedRevision || pending;
  const dispatch = (action: DesignDraftEditorAction) => {
    const next = reduceDesignDraftEditorState(editorRef.current, action);
    editorRef.current = next;
    setEditor(next);
    return next;
  };

  function drawing(command: DraftDrawingCommand): void {
    const before = editorRef.current;
    const next = dispatch({ type: "drawing", expectedRevision: before.revision, command });
    if (command.type === "pause" && next.revision !== before.revision && !next.lastError) {
      setPausedRevision(next.revision);
      void save();
    }
  }

  useEffect(() => {
    if (Platform.OS !== "web" || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(): Promise<void> {
    if (pending || !saveOwnerMountedRef.current) return;
    const captured = editorRef.current;
    if (queuedRevisions.current.has(captured.revision)) return;
    queuedRevisions.current.add(captured.revision);
    savingCount.current += 1;
    setSaving(true);
    setSaveFailed(false);
    setMessage(null);
    const session = saveSessionRef.current;
    try {
      const outcome = await saveCoordinator.save({ session, payload: { kind: "draft", draft: captured.draft },
        editorRevision: captured.revision, feedbackIsCurrent: () => saveOwnerMountedRef.current,
        write: (payload, target, owner) => {
          if (payload.kind !== "draft" || target.kind !== "draft") throw new Error("A draft requires its own save target.");
          return repository.saveDesignDraft(target.designId, payload.draft, target.workspaceRevision, target.designRevision, owner);
        } });
      if (saveOwnerMountedRef.current && saveCoordinator.isCurrent(session)) {
        if (outcome.saved) setSavedRevision(value => Math.max(value, outcome.editorRevision));
        else { setSaveFailed(true); setMessage({ text: "The draft was not saved. Your drawing is still open; use Save draft to retry.", error: true }); }
      }
    } catch (error) {
      if (saveOwnerMountedRef.current) { setSaveFailed(true); setMessage({ text: String(error), error: true }); }
    } finally {
      queuedRevisions.current.delete(captured.revision);
      savingCount.current -= 1;
      if (saveOwnerMountedRef.current) setSaving(savingCount.current > 0);
    }
  }

  useEffect(() => {
    if (!autosave || saveFailed || saving || pending || editor.revision === savedRevision || !repository.canSaveDraft) return;
    const timeout = setTimeout(() => { void save(); }, 600);
    return () => clearTimeout(timeout);
  }, [autosave, saveFailed, saving, pending, editor.revision, savedRevision, repository.canSaveDraft]);

  async function exportDraft(): Promise<void> {
    try {
      const bytes = exportDesignDraftArchiveZip(buildDesignDraftArchiveBundle(editorRef.current.draft));
      const outcome = await exportZipFileAsync("design-draft.cplayout.zip", bytes);
      if (saveOwnerMountedRef.current) setMessage({ text: outcome.message, error: !outcome.ok });
    } catch (error) { if (saveOwnerMountedRef.current) setMessage({ text: String(error), error: true }); }
  }

  function calculate(): void {
    const current = editorRef.current;
    const built = tryBuildPivotProject(current.draft);
    if (!built.ok) return;
    try { setPreview({ revision: current.revision, result: evaluateLayout(built.project) }); }
    catch (error) { setMessage({ text: String(error), error: true }); }
  }

  const missing = admission.ok ? [] : admission.reason === "invalid_draft" ? admission.blockers
    : [...admission.completeness.blockers, ...admission.completeness.calculationBlockers];
  const missingFields = [...new Set(missing.map(item => item.path.split(".")[0]))];
  const fieldLabels: Record<string, string> = { projectCrs: "Coordinate system", fieldBoundary: "Field boundary",
    pivotCenter: "Pivot", waterSource: "Water", powerSource: "Power", machine: "Machine" };
  const error = editor.lastError ?? repository.storageError ?? (message?.error ? message.text : null);

  return <SafeAreaView style={styles.root} testID="design-draft-workspace">
    <View style={styles.header}>
      <Text style={styles.brand}>CPLayout</Text>
      <View style={styles.identity}>
        <Text numberOfLines={1} style={styles.title}>{editor.draft.name}</Text>
        <View style={styles.statusLine} accessibilityLiveRegion="polite">
          {saveFailed ? <TriangleAlert size={20} color="#922c24" /> : dirty || saving ? <Save size={20} color="#85520d" /> : <CheckCircle2 size={20} color="#14734b" />}
          <Text style={[styles.stateText, { color: saveFailed ? "#922c24" : dirty || saving ? "#85520d" : "#14734b" }]} testID="draft-save-state">
            {saving ? "Saving" : saveFailed ? "Unsaved changes — save failed" : dirty ? "Unsaved changes" : "Saved"} | Design draft
          </Text>
        </View>
      </View>
    </View>
    <View style={styles.toolbar} testID="draft-command-bar">{[
      { id: "catalog", label: "Catalog", icon: <FolderOpen />, showLabel: true, disabled: saving,
        onPress: () => dirty ? setConfirmClose(true) : onClose(), testID: "draft-catalog" },
      { id: "save", label: "Save draft", icon: <Save />, showLabel: true, disabled: saving || pending || !repository.canSaveDraft,
        onPress: save, testID: "draft-save" },
      { id: "undo", label: "Undo", icon: <Undo2 />, disabled: pending || editor.past.length === 0,
        onPress: () => dispatch({ type: "undo" }), testID: "draft-undo" },
      { id: "redo", label: "Redo", icon: <Redo2 />, disabled: pending || editor.future.length === 0,
        onPress: () => dispatch({ type: "redo" }), testID: "draft-redo" },
      { id: "inputs", label: "Inputs", icon: <SlidersHorizontal />, showLabel: true, selected: inputsOpen,
        onPress: () => setInputsOpen(value => !value), testID: "draft-inputs-toggle" },
      { id: "calculate", label: "Calculate", icon: <Calculator />, disabled: !admission.ok || pending,
        onPress: calculate, testID: "draft-calculate" },
      { id: "layout", label: "Layout unavailable for drafts", icon: <LockKeyhole />, disabled: true,
        onPress: () => undefined, testID: "draft-layout" },
      { id: "export", label: "Export draft ZIP", icon: <Download />, disabled: pending,
        onPress: exportDraft, testID: "draft-export" },
    ].map(button => <IconCommandButton key={button.id} {...button} />)}</View>
    {error && <View accessibilityRole="alert" style={[styles.feedback, styles.error]} testID="draft-error">
      <TriangleAlert size={22} color="#922c24" /><Text style={[styles.stateText, styles.errorText]}>{error}</Text>
    </View>}
    {!error && message && <View accessibilityLiveRegion="polite" style={[styles.feedback, styles.success]} testID="draft-success">
      <CheckCircle2 size={22} color="#14734b" /><Text style={[styles.stateText, styles.successText]}>{message.text}</Text>
    </View>}
    {pendingInputs && <View style={[styles.feedback, styles.notice]}><Info size={22} color="#85520d" />
      <Text style={[styles.stateText, styles.warningText]}>Apply or discard pending inputs before saving.</Text></View>}
    <View style={styles.autosave}>
      <Switch accessibilityLabel="Autosave draft" testID="draft-autosave" value={autosave} disabled={pendingInputs}
        onValueChange={enabled => drawing({ type: "set_autosave", enabled })} />
      <Text style={styles.stateText}>Autosave {autosave ? "on" : "off"}</Text>
      {pausedRevision !== null && !activeCapture && <Text accessibilityLiveRegion="polite" testID="draft-pause-state" style={styles.meta}>
        {savedRevision >= pausedRevision ? "Paused drawing saved — resume anytime" : "Drawing paused — save pending"}
      </Text>}
    </View>
    <View style={[styles.body, compact && styles.compactBody]}>
      <View style={styles.map}><DesignDraftMapSurface draft={editor.draft} onDrawing={drawing} disabled={pendingInputs} /></View>
      <View style={[styles.inputs, compact && styles.compactInputs, !inputsOpen && styles.hidden]}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.inputContent} testID="draft-inputs-scroll">
          <DesignDraftInputs editor={editor} onAction={dispatch} onPendingChange={setPendingInputs} disabled={!!activeCapture} />
        </ScrollView>
      </View>
    </View>
    <View style={styles.status}>
      <View style={styles.statusLine}>
        {admission.ok ? <CheckCircle2 size={20} color="#14734b" /> : <TriangleAlert size={20} color="#85520d" />}
        <Text style={[styles.stateText, admission.ok ? styles.successText : styles.warningText]} testID="draft-completeness">{admission.ok ? "Calculation inputs complete"
          : `Missing or invalid: ${missingFields.map(path => fieldLabels[path] ?? path).join(", ")}`}</Text>
      </View>
      <View style={styles.statusLine}><Info size={22} color="#85520d" />
        <Text style={[styles.stateText, styles.warningText]}>Field qualification: not verified</Text></View>
      {preview?.revision === editor.revision && <Text style={styles.meta} testID="draft-calculation-result">
        Coverage: {preview.result.metrics.coveragePercent.toFixed(1)}% | Field: {preview.result.metrics.fieldAcres.toFixed(2)} acres
      </Text>}
    </View>
    {activeCapture?.stage === "classification" && <DrawingClassificationDialog key={activeCapture.id}
      capture={activeCapture} draft={editor.draft} error={editor.lastError}
      onCancel={classification => {
        drawing({ type: "set_classification", id: activeCapture.id, classification });
        drawing({ type: "return_to_drawing", id: activeCapture.id });
      }}
      onConfirm={(classification, replaceExisting) => dispatch({ type: "commit_classified_drawing",
        expectedRevision: editorRef.current.revision, captureId: activeCapture.id, classification,
        ...(drawingPurpose(classification.purposeId)?.destination === "feature"
          ? { entityId: `feature-${Date.now()}-${activeCapture.id}` } : {}), replaceExisting })} />}
    <ConfirmActionDialog visible={confirmClose} title="Leave unsaved design?" message="Changes since the last save will be discarded."
      confirmLabel="Discard changes" onCancel={() => setConfirmClose(false)} onConfirm={onClose} testID="draft-discard" />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f5f7f6" },
  header: { flexDirection: "row", alignItems: "center", gap: 16, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#cdd8d1" },
  brand: { fontSize: 20, fontWeight: "800", color: "#254234" },
  identity: { flex: 1, minWidth: 0 },
  title: { color: "#14221b", fontSize: 16, fontWeight: "700" },
  meta: { color: "#4b5c53", fontSize: 12, lineHeight: 18 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  stateText: { color: "#293b40", fontSize: 14, lineHeight: 20, fontWeight: "600", flexShrink: 1 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 6 },
  autosave: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 4, flexWrap: "wrap" },
  body: { flex: 1, minHeight: 0, flexDirection: "row" },
  compactBody: { flexDirection: "column" },
  map: { flex: 1, minHeight: 300, minWidth: 0 },
  inputs: { width: 330, maxWidth: "100%", borderLeftWidth: 1, borderColor: "#cdd8d1", backgroundColor: "#fff" },
  compactInputs: { width: "100%", maxHeight: "44%", minHeight: 0, flexShrink: 1, borderTopWidth: 1, borderLeftWidth: 0 },
  hidden: { display: "none" },
  inputContent: { padding: 12, gap: 12 },
  status: { paddingVertical: 6, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: "#cdd8d1", backgroundColor: "#f2f8fa" },
  feedback: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 },
  error: { backgroundColor: "#fff1ef" },
  errorText: { color: "#922c24" },
  success: { backgroundColor: "#e8f5ed" },
  successText: { color: "#14734b" },
  notice: { backgroundColor: "#fff7df" },
  warningText: { color: "#85520d" },
});
