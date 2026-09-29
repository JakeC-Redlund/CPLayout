import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calculator, CheckCircle2, Download, FolderOpen, Info, LockKeyhole, Redo2, Save, SlidersHorizontal, TriangleAlert, Undo2 } from "lucide-react-native";
import {
  createDesignDraftEditorState, drawingPurpose, reduceDesignDraftEditorState, serializeDesignDraftDocument, tryBuildPivotProject,
  type DesignDraftEditorAction, type DraftDrawingCommand, type LayoutResult,
} from "@cplayout/core";
import { evaluateLayout } from "@cplayout/geometry";
import { DesignDraftMapSurface } from "@cplayout/map-adapters";
import { buildDesignDraftArchiveBundle, exportDesignDraftArchiveZip, exportZipFileAsync } from "@cplayout/project-store";
import { useEditorSaveCoordinator } from "../hooks/useEditorSaveCoordinator";
import { useProjectRepository, type OpenedDraft, type OpenedDesign } from "../hooks/useProjectRepository";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
import { DrawingClassificationDialog } from "./DrawingClassificationDialog";
import { DesignDraftInputs } from "./DesignDraftInputs";
import { editorOutputIdentity } from "./editorOutputIdentity";

export function DesignDraftWorkspace({ initial, onClose, onOpenComplete }: {
  initial: OpenedDraft; onClose: () => void;
  onOpenComplete?: (opened: Extract<OpenedDesign, { kind: "project" }>) => void;
}): React.JSX.Element {
  const [editor, setEditor] = useState(() => createDesignDraftEditorState(initial.draft));
  const editorRef = useRef(editor);
  const repository = useProjectRepository();
  const { saveCoordinator, saveSessionRef, saveOwnerMountedRef } = useEditorSaveCoordinator({
    kind: "draft", payloadId: initial.draft.id, designId: initial.context.designId!,
    workspaceRevision: initial.persistenceRevision, designRevision: initial.designRevision,
  });
  const [savedRevision, setSavedRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);
  const inputsScrollRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const savingCount = useRef(0);
  const queuedRevisions = useRef(new Set<number>());
  const [saveFailed, setSaveFailed] = useState(false);
  const [pausedRevision, setPausedRevision] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [exportDetailsOpen, setExportDetailsOpen] = useState(false);
  const [pendingInputs, setPendingInputs] = useState(false);
  const { width, height } = useWindowDimensions();
  const compact = width < 800;
  const [inputsOpen, setInputsOpen] = useState(!compact);
  const [preview, setPreview] = useState<{ revision: number; result: LayoutResult } | null>(null);
  const admission = useMemo(() => tryBuildPivotProject(editor.draft), [editor.draft]);
  const pending = pendingInputs;
  const autosave = editor.draft.drawingWorkflow?.autosaveEnabled ?? true;
  const activeCapture = editor.draft.drawingWorkflow?.captures.find(item => item.id === editor.draft.drawingWorkflow?.activeCaptureId);
  const dirty = editor.revision !== savedRevision || pending;
  const draftSnapshotHash = useMemo(() => editorOutputIdentity({ designId: initial.context.designId!, documentId: editor.draft.id,
    document: serializeDesignDraftDocument(editor.draft), savedRevision: initial.designRevision, inputRevision: editor.revision,
    scope: "draft", machineIds: editor.draft.machine.id ? [editor.draft.machine.id] : [] }).hash, [editor.draft]);
  const draftReceipt = saveCoordinator.receipt(saveSessionRef.current);
  const draftSavedRevision = draftReceipt.kind === "draft" ? draftReceipt.designRevision : null;
  const dispatch = (action: DesignDraftEditorAction) => {
    if (completingRef.current) return editorRef.current;
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
    if (pending || completingRef.current || !saveOwnerMountedRef.current) return;
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
    if (!autosave || saveFailed || saving || completing || pending || editor.revision === savedRevision || !repository.canSaveDraft) return;
    const timeout = setTimeout(() => { void save(); }, 600);
    return () => clearTimeout(timeout);
  }, [autosave, saveFailed, saving, completing, pending, editor.revision, savedRevision, repository.canSaveDraft]);

  async function createCompleteDesign(): Promise<void> {
    if (completingRef.current || savingCount.current > 0 || pending || activeCapture || !onOpenComplete
      || !repository.canCreateCompleteDesign || !saveOwnerMountedRef.current) return;
    const current = editorRef.current;
    if (!tryBuildPivotProject(current.draft).ok) return;
    const session = saveSessionRef.current;
    const target = saveCoordinator.receipt(session);
    if (target.kind !== "draft") return;
    completingRef.current = true;
    setCompleting(true);
    setMessage(null);
    try {
      const opened = await repository.createCompleteDesignFromDraft(target.designId, current.draft, target.workspaceRevision,
        target.designRevision, { isCurrent: () => saveOwnerMountedRef.current && saveCoordinator.isCurrent(session) });
      if (!saveOwnerMountedRef.current || !saveCoordinator.isCurrent(session)) return;
      setSavedRevision(current.revision);
      saveCoordinator.retire(session);
      onOpenComplete(opened);
    } catch (error) {
      if (saveOwnerMountedRef.current) setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      completingRef.current = false;
      if (saveOwnerMountedRef.current) setCompleting(false);
    }
  }

  function openMissingInput(section: string): void {
    setInputsOpen(true);
    requestAnimationFrame(() => inputsScrollRef.current?.scrollTo({ y: sectionPositions.current[section] ?? 0, animated: true }));
  }

  async function exportDraft(): Promise<void> {
    try {
      const captured = editorRef.current;
      const receipt = saveCoordinator.receipt(saveSessionRef.current);
      const bundle = buildDesignDraftArchiveBundle(captured.draft);
      const output = editorOutputIdentity({ designId: initial.context.designId!, documentId: captured.draft.id,
        document: bundle.files["draft.json"], savedRevision: receipt.kind === "draft" ? receipt.designRevision : null,
        inputRevision: captured.revision, scope: "draft", machineIds: captured.draft.machine.id ? [captured.draft.machine.id] : [] });
      const bytes = exportDesignDraftArchiveZip(bundle);
      const outcome = await exportZipFileAsync(`${output.stem}.design-draft.cplayout.zip`, bytes);
      if (saveOwnerMountedRef.current) setMessage({ text: `${outcome.message}${outcome.ok ? ` Draft input revision ${captured.revision}; snapshot ${output.hash.slice(0, 12)}.` : ""}`, error: !outcome.ok });
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
            {completing ? "Creating complete design" : saving ? "Saving" : saveFailed ? "Unsaved changes — save failed" : dirty ? "Unsaved changes" : "Saved"} | Design draft
          </Text>
        </View>
      </View>
    </View>
    <ScrollView horizontal keyboardShouldPersistTaps="handled" style={styles.toolbarScroll} contentContainerStyle={styles.toolbar} testID="draft-command-bar">{[
      { id: "catalog", label: "Catalog", icon: <FolderOpen />, showLabel: true, disabled: saving || completing,
        onPress: () => dirty ? setConfirmClose(true) : onClose(), testID: "draft-catalog" },
      { id: "save", label: "Save draft", icon: <Save />, showLabel: true, disabled: saving || completing || pending || !repository.canSaveDraft,
        onPress: save, testID: "draft-save" },
      { id: "undo", label: "Undo", icon: <Undo2 />, disabled: pending || completing || editor.past.length === 0,
        onPress: () => dispatch({ type: "undo" }), testID: "draft-undo" },
      { id: "redo", label: "Redo", icon: <Redo2 />, disabled: pending || completing || editor.future.length === 0,
        onPress: () => dispatch({ type: "redo" }), testID: "draft-redo" },
      { id: "inputs", label: "Inputs", icon: <SlidersHorizontal />, showLabel: true, selected: inputsOpen,
        onPress: () => setInputsOpen(value => !value), testID: "draft-inputs-toggle" },
      { id: "calculate", label: "Calculate preview", icon: <Calculator />, disabled: !admission.ok || pending || completing,
        onPress: calculate, testID: "draft-calculate" },
      { id: "complete", label: "Create complete design", icon: <CheckCircle2 />, showLabel: true,
        disabled: !admission.ok || pending || saving || completing || !!activeCapture || !repository.canCreateCompleteDesign || !onOpenComplete,
        onPress: createCompleteDesign, testID: "draft-create-complete" },
      { id: "layout", label: "Layout unavailable for drafts", icon: <LockKeyhole />, disabled: true,
        onPress: () => undefined, testID: "draft-layout" },
      { id: "export", label: "Export draft ZIP", icon: <Download />, disabled: pending || completing,
        onPress: exportDraft, testID: "draft-export" },
    ].map(button => <IconCommandButton key={button.id} {...button} />)}</ScrollView>
    {error && <View accessibilityRole="alert" style={[styles.feedback, styles.error]} testID="draft-error">
      <TriangleAlert size={22} color="#922c24" /><Text style={[styles.stateText, styles.errorText]}>{error}</Text>
    </View>}
    {!error && message && <View accessibilityLiveRegion="polite" style={[styles.feedback, styles.success]} testID="draft-success">
      <CheckCircle2 size={22} color="#14734b" /><Text style={[styles.stateText, styles.successText]}>{message.text}</Text>
    </View>}
    {pendingInputs && <View style={[styles.feedback, styles.notice]}><Info size={22} color="#85520d" />
      <Text style={[styles.stateText, styles.warningText]}>Apply or discard pending inputs before saving, calculating, or creating a complete design.</Text></View>}
    <View style={styles.autosave}>
      <Switch accessibilityLabel="Autosave draft" testID="draft-autosave" value={autosave} disabled={pendingInputs || completing}
        onValueChange={enabled => drawing({ type: "set_autosave", enabled })} />
      <Text style={styles.stateText}>Autosave {autosave ? "on" : "off"}</Text>
      {pausedRevision !== null && !activeCapture && <Text accessibilityLiveRegion="polite" testID="draft-pause-state" style={styles.meta}>
        {savedRevision >= pausedRevision ? "Paused drawing saved — resume anytime" : "Drawing paused — save pending"}
      </Text>}
    </View>
    {activeCapture?.stage === "classification" && <ScrollView keyboardShouldPersistTaps="handled" style={styles.classificationScroll}><DrawingClassificationDialog key={activeCapture.id}
      capture={activeCapture} draft={editor.draft} error={editor.lastError}
      onCancel={classification => {
        drawing({ type: "set_classification", id: activeCapture.id, classification });
        drawing({ type: "return_to_drawing", id: activeCapture.id });
      }}
      onConfirm={(classification, replaceExisting) => dispatch({ type: "commit_classified_drawing",
        expectedRevision: editorRef.current.revision, captureId: activeCapture.id, classification,
        ...(drawingPurpose(classification.purposeId)?.destination === "feature"
          ? { entityId: `feature-${Date.now()}-${activeCapture.id}` } : {}), replaceExisting })} /></ScrollView>}
    <View style={[styles.body, compact && styles.compactBody]}>
      <View style={[styles.map, height < 650 && styles.shortMap]}><DesignDraftMapSurface draft={editor.draft} onDrawing={drawing} disabled={pendingInputs || completing} /></View>
      <View style={[styles.inputs, compact && styles.compactInputs, !inputsOpen && styles.hidden]}>
        <ScrollView ref={inputsScrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.inputContent} testID="draft-inputs-scroll">
          <DesignDraftInputs editor={editor} onAction={dispatch} onPendingChange={setPendingInputs} disabled={!!activeCapture || completing} onSectionLayout={(section, y) => { sectionPositions.current[section] = y; }} />
        </ScrollView>
      </View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" style={[styles.status, height < 650 && styles.shortStatus]} contentContainerStyle={styles.statusContent}>
      <View style={styles.statusLine}>
        {admission.ok ? <CheckCircle2 size={20} color="#14734b" /> : <TriangleAlert size={20} color="#85520d" />}
        <Text style={[styles.stateText, admission.ok ? styles.successText : styles.warningText]} testID="draft-completeness">{admission.ok ? "Calculation inputs complete"
          : `Missing or invalid: ${missingFields.map(path => fieldLabels[path] ?? path).join(", ")}`}</Text>
      </View>
      {missingFields.length > 0 && <View style={styles.missingLinks}>{missingFields.map(section => <Pressable key={section}
        accessibilityRole="button" accessibilityLabel={`Open ${fieldLabels[section] ?? section} inputs`} onPress={() => openMissingInput(section)}
        style={styles.missingLink} testID={`draft-missing-${section}`}><Text style={styles.linkText}>Open {fieldLabels[section] ?? section}</Text></Pressable>)}</View>}
      <Text style={styles.meta}>Calculate previews the applied inputs. Create complete design saves a separate design and keeps this draft.</Text>
      <View style={styles.outputSummary}><Text style={[styles.meta, styles.outputSummaryText]} testID="draft-output-source">Export: draft · {editor.draft.machine.name ?? "Machine not named"} · Saved revision {draftSavedRevision ?? "not confirmed"}{editor.revision !== savedRevision ? " + current applied changes" : ""}{pendingInputs ? ". Pending entries excluded." : ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Draft export details" accessibilityState={{ expanded: exportDetailsOpen }} onPress={() => setExportDetailsOpen(value => !value)} style={styles.outputDisclosure} testID="draft-export-details-toggle"><Text style={styles.linkText}>{exportDetailsOpen ? "▾" : "▸"} Export details</Text></Pressable></View>
      {exportDetailsOpen && <View style={styles.outputDetails} testID="draft-export-details">
        <Text selectable style={styles.meta}>Design ID: {initial.context.designId} · Draft ID: {editor.draft.id}</Text>
        <Text selectable style={styles.meta}>Machine: {editor.draft.machine.name ?? "Machine not named"} ({editor.draft.machine.id ?? "machine ID not assigned"}) · Input revision {editor.revision}</Text>
        <Text selectable style={styles.meta}>Snapshot SHA-256: {draftSnapshotHash}</Text>
        <Text style={styles.meta}>The archive includes applied draft inputs and retained drawing progress. Form entries waiting for Apply are excluded.</Text>
      </View>}
      <View style={styles.statusLine}><Info size={22} color="#85520d" />
        <Text style={[styles.stateText, styles.warningText]}>Field qualification: not verified</Text></View>
      {preview?.revision === editor.revision && <Text style={styles.meta} testID="draft-calculation-result">
        Coverage: {preview.result.metrics.coveragePercent.toFixed(1)}% | Field: {preview.result.metrics.fieldAcres.toFixed(2)} acres
      </Text>}
    </ScrollView>
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
  outputSummary: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  outputSummaryText: { flex: 1, minWidth: 180 },
  outputDisclosure: { minHeight: 36, justifyContent: "center", paddingHorizontal: 6 },
  outputDetails: { gap: 4, paddingVertical: 6 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  stateText: { color: "#293b40", fontSize: 14, lineHeight: 20, fontWeight: "600", flexShrink: 1 },
  toolbarScroll: { flexGrow: 0, flexShrink: 0 },
  toolbar: { flexDirection: "row", gap: 6, padding: 6 },
  autosave: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 4, flexWrap: "wrap" },
  body: { flex: 1, minHeight: 0, flexDirection: "row" },
  compactBody: { flexDirection: "column" },
  shortMap: { minHeight: 80 },
  missingLinks: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  missingLink: { minHeight: 36, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: "#c1d4c8", borderRadius: 4 },
  linkText: { color: "#185439", fontSize: 12, fontWeight: "600" },
  map: { flex: 1, minHeight: 220, minWidth: 0 },
  inputs: { width: 330, maxWidth: "100%", borderLeftWidth: 1, borderColor: "#cdd8d1", backgroundColor: "#fff" },
  compactInputs: { width: "100%", maxHeight: "44%", minHeight: 0, flexShrink: 1, borderTopWidth: 1, borderLeftWidth: 0 },
  hidden: { display: "none" },
  inputContent: { padding: 12, gap: 12 },
  classificationScroll: { maxHeight: "32%", flexShrink: 1, flexGrow: 0 },
  shortStatus: { maxHeight: 112 },
  statusContent: { paddingVertical: 6, paddingHorizontal: 12 },
  status: { flexGrow: 0, maxHeight: 175, borderTopWidth: 1, borderTopColor: "#cdd8d1", backgroundColor: "#f2f8fa" },
  feedback: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 },
  error: { backgroundColor: "#fff1ef" },
  errorText: { color: "#922c24" },
  success: { backgroundColor: "#e8f5ed" },
  successText: { color: "#14734b" },
  notice: { backgroundColor: "#fff7df" },
  warningText: { color: "#85520d" },
});
