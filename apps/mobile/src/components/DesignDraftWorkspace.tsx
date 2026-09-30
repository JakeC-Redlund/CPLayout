import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calculator, CheckCircle2, Download, FolderOpen, Info, LockKeyhole, Redo2, Save, SlidersHorizontal, TriangleAlert, Undo2 } from "lucide-react-native";
import {
  createDesignDraftEditorState, drawingPurpose, reduceDesignDraftEditorState, serializeDesignDraftDocument, serializeProjectDocument, tryBuildPivotProject,
  type DesignDraftEditorAction, type DraftDrawingCommand, type LayoutResult,
} from "@cplayout/core";
import { evaluateLayout } from "@cplayout/geometry";
import { DesignDraftMapSurface } from "@cplayout/map-adapters";
import { buildDesignDraftArchiveBundle, exportDesignDraftArchiveZip, exportZipFileAsync, projectRepository } from "@cplayout/project-store";
import { useEditorSaveCoordinator } from "../hooks/useEditorSaveCoordinator";
import { useProjectRepository, type OpenedDraft, type OpenedDesign } from "../hooks/useProjectRepository";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
import { DrawingClassificationDialog } from "./DrawingClassificationDialog";
import { DesignDraftInputs, type DesignDraftInputsHandle } from "./DesignDraftInputs";
import { captureDraftReceiptBaseline, reconcileDraftReceipt, type DraftReceiptBaseline } from "./draftReceiptReconciliation";
import { editorOutputIdentity } from "./editorOutputIdentity";

export function DesignDraftWorkspace({ initial, onClose, onOpenComplete, getTaskGeneration, visible = true, onNavigationStateChange, navigationGuardRef }: {
  navigationGuardRef?: React.MutableRefObject<(() => { dirty: boolean; busy: boolean }) | null>;
  onNavigationStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  initial: OpenedDraft; visible?: boolean; onClose: () => void;
  getTaskGeneration: () => number;
  onOpenComplete?: (opened: Extract<OpenedDesign, { kind: "project" }>, requestedTaskGeneration: number) => boolean;
}): React.JSX.Element {
  const [editor, setEditor] = useState(() => createDesignDraftEditorState(initial.draft));
  const editorRef = useRef(editor);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const repository = useProjectRepository();
  const knownSavedDraft = useRef(initial.draft);
  const knownSavedEditorRevision = useRef(0);
  const receiptBaseline = useRef<DraftReceiptBaseline | null>(null);
  const reconcileSequence = useRef(0);
  const reconcilingRef = useRef(true);
  const [reconciling, setReconciling] = useState(true);
  const receiptConflictRef = useRef(false);
  const [receiptConflict, setReceiptConflict] = useState<string | null>(null);
  const { saveCoordinator, saveSessionRef, saveOwnerMountedRef } = useEditorSaveCoordinator({
    kind: "draft", payloadId: initial.draft.id, designId: initial.context.designId!,
    workspaceRevision: initial.persistenceRevision, designRevision: initial.designRevision,
  });
  const [savedRevision, setSavedRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const completingRef = useRef(false);
  const [savedComplete, setSavedComplete] = useState<Extract<OpenedDesign, { kind: "project" }> | null>(null);
  const [openingComplete, setOpeningComplete] = useState(false);
  const openingCompleteRef = useRef(false);
  const inputsRef = useRef<DesignDraftInputsHandle>(null);
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
  const pendingInputsRef = useRef(false);
  const { width, height } = useWindowDimensions();
  const compact = width < 800;
  const [inputsOpen, setInputsOpen] = useState(!compact);
  const inputsTakeBody = compact && inputsOpen;
  const [preview, setPreview] = useState<{ revision: number; result: LayoutResult } | null>(null);
  const admission = useMemo(() => tryBuildPivotProject(editor.draft), [editor.draft]);
  const pending = pendingInputs;
  const autosave = editor.draft.drawingWorkflow?.autosaveEnabled ?? true;
  const activeCapture = editor.draft.drawingWorkflow?.captures.find(item => item.id === editor.draft.drawingWorkflow?.activeCaptureId);
  const dirty = editor.revision !== savedRevision || pending || !!activeCapture;
  if (navigationGuardRef) navigationGuardRef.current = () => ({
    dirty: editorRef.current.revision !== savedRevision || pendingInputsRef.current || !!editorRef.current.draft.drawingWorkflow?.activeCaptureId,
    busy: savingCount.current > 0 || completingRef.current || openingCompleteRef.current || reconcilingRef.current,
  });
  useEffect(() => { onNavigationStateChange?.({ dirty, busy: saving || completing || openingComplete || reconciling }); }, [onNavigationStateChange, dirty, saving, completing, openingComplete, reconciling]);
  const draftSnapshotHash = useMemo(() => editorOutputIdentity({ designId: initial.context.designId!, documentId: editor.draft.id,
    document: serializeDesignDraftDocument(editor.draft), savedRevision: initial.designRevision, inputRevision: editor.revision,
    scope: "draft", machineIds: editor.draft.machine.id ? [editor.draft.machine.id] : [] }).hash, [editor.draft]);
  const draftReceipt = saveCoordinator.receipt(saveSessionRef.current);
  const receiptUnavailable = reconciling || receiptConflict !== null;
  const draftSavedRevision = !receiptUnavailable && draftReceipt.kind === "draft" ? draftReceipt.designRevision : null;
  const dispatch = (action: DesignDraftEditorAction) => {
    if (completingRef.current || openingCompleteRef.current) return editorRef.current;
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

  async function reconcileSavedReceipt(): Promise<void> {
    if (!visibleRef.current || savingCount.current > 0 || completingRef.current || openingCompleteRef.current || !saveOwnerMountedRef.current) return;
    const sequence = ++reconcileSequence.current;
    const session = saveSessionRef.current;
    const target = saveCoordinator.receipt(session);
    if (target.kind !== "draft") return;
    reconcilingRef.current = true; setReconciling(true);
    const isCurrent = () => sequence === reconcileSequence.current && visibleRef.current && savingCount.current === 0
      && !completingRef.current && !openingCompleteRef.current && saveOwnerMountedRef.current && saveCoordinator.isCurrent(session);
    try {
      const versioned = projectRepository.versionedWorkspace;
      if (!versioned) throw new Error("This runtime cannot verify the saved draft. Export this work before reopening it.");
      const read = await versioned.readDesignAsync(target.designId);
      if (!isCurrent()) return;
      const draftTarget = { ...target, kind: "draft" as const };
      const baseline = receiptBaseline.current ?? captureDraftReceiptBaseline(draftTarget, knownSavedDraft.current, initial.context, read);
      const reconciled = reconcileDraftReceipt(draftTarget, baseline, read);
      receiptBaseline.current = baseline;
      if (reconciled.siblingWriteAdvanced) {
        saveSessionRef.current = saveCoordinator.open(reconciled.target);
        setSaveFailed(false);
      }
      receiptConflictRef.current = false; setReceiptConflict(null);
    } catch (error) {
      if (isCurrent()) {
        receiptConflictRef.current = true;
        setReceiptConflict(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (sequence === reconcileSequence.current && visibleRef.current && saveOwnerMountedRef.current) {
        reconcilingRef.current = false; setReconciling(false);
      }
    }
  }
  useEffect(() => {
    if (!visible) {
      reconcileSequence.current++; reconcilingRef.current = false; setReconciling(false); return;
    }
    if (saving || completing || openingComplete) { reconcileSequence.current++; return; }
    void reconcileSavedReceipt();
    return () => { reconcileSequence.current++; };
  }, [visible, saving, completing, openingComplete]);

  async function save(): Promise<void> {
    if (!visibleRef.current || reconcilingRef.current || receiptConflictRef.current || !receiptBaseline.current || pending || completingRef.current || openingCompleteRef.current || !saveOwnerMountedRef.current) return;
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
        if (outcome.saved) {
          if (outcome.editorRevision >= knownSavedEditorRevision.current) {
            knownSavedDraft.current = captured.draft;
            knownSavedEditorRevision.current = outcome.editorRevision;
            receiptBaseline.current = null;
          }
          reconcilingRef.current = true; setReconciling(true);
          setSavedRevision(value => Math.max(value, outcome.editorRevision));
        }
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
    if (!visible || receiptUnavailable || !autosave || saveFailed || saving || completing || openingComplete || pending || editor.revision === savedRevision || !repository.canSaveDraft) return;
    const timeout = setTimeout(() => { void save(); }, 600);
    return () => clearTimeout(timeout);
  }, [visible, receiptUnavailable, autosave, saveFailed, saving, completing, openingComplete, pending, editor.revision, savedRevision, repository.canSaveDraft]);

  async function createCompleteDesign(): Promise<void> {
    if (!visibleRef.current || reconcilingRef.current || receiptConflictRef.current || !receiptBaseline.current || completingRef.current || openingCompleteRef.current || savedComplete || savingCount.current > 0 || pending || activeCapture || !onOpenComplete
      || !repository.canCreateCompleteDesign || !saveOwnerMountedRef.current) return;
    const current = editorRef.current;
    if (!tryBuildPivotProject(current.draft).ok) return;
    const session = saveSessionRef.current;
    const target = saveCoordinator.receipt(session);
    if (target.kind !== "draft") return;
    const requestedTaskGeneration = getTaskGeneration();
    completingRef.current = true;
    setCompleting(true);
    setMessage(null);
    try {
      const opened = await repository.createCompleteDesignFromDraft(target.designId, current.draft, target.workspaceRevision,
        target.designRevision, { isCurrent: () => saveOwnerMountedRef.current && saveCoordinator.isCurrent(session) });
      if (!saveOwnerMountedRef.current || !saveCoordinator.isCurrent(session)) return;
      if (typeof opened.persistenceRevision !== "number" || !Number.isSafeInteger(opened.persistenceRevision) || opened.persistenceRevision < 0) {
        throw new Error("The saved complete design did not return a valid workspace revision.");
      }
      setSavedRevision(current.revision);
      knownSavedDraft.current = current.draft;
      knownSavedEditorRevision.current = current.revision;
      receiptBaseline.current = null;
      saveSessionRef.current = saveCoordinator.open({ ...target, workspaceRevision: opened.persistenceRevision,
        designRevision: opened.sourceDraftRevision });
      setSaveFailed(false);
      if (!onOpenComplete(opened, requestedTaskGeneration)) {
        setSavedComplete(opened);
        setMessage({ text: "Complete design saved separately. Your source draft is still open.", error: false });
      }
    } catch (error) {
      if (saveOwnerMountedRef.current) setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      completingRef.current = false;
      if (saveOwnerMountedRef.current) setCompleting(false);
    }
  }

  async function openSavedCompleteDesign(): Promise<void> {
    const current = editorRef.current;
    if (!savedComplete || !onOpenComplete || !visibleRef.current || !saveOwnerMountedRef.current || reconcilingRef.current
      || receiptConflictRef.current || !receiptBaseline.current || savingCount.current > 0 || completingRef.current || openingCompleteRef.current
      || pendingInputsRef.current || current.revision !== savedRevision || current.draft.drawingWorkflow?.activeCaptureId) return;
    const retained = savedComplete, session = saveSessionRef.current, requestedTaskGeneration = getTaskGeneration();
    openingCompleteRef.current = true; setOpeningComplete(true); setMessage(null);
    try {
      const opened = await repository.openDesignProject(retained.context.designId!);
      if (!saveOwnerMountedRef.current || !visibleRef.current || getTaskGeneration() !== requestedTaskGeneration
        || !saveCoordinator.isCurrent(session) || editorRef.current.revision !== current.revision || pendingInputsRef.current
        || receiptConflictRef.current) return;
      if (opened.kind !== "project" || serializeProjectDocument(opened.project) !== serializeProjectDocument(retained.project)
        || opened.context.clientId !== retained.context.clientId || opened.context.projectId !== retained.context.projectId
        || opened.context.fieldMapId !== retained.context.fieldMapId || opened.context.designId !== retained.context.designId) {
        throw new Error("The saved complete design changed. Open it from Projects to review its latest version.");
      }
      if (onOpenComplete(opened, requestedTaskGeneration)) setSavedComplete(null);
    } catch (error) {
      if (saveOwnerMountedRef.current) setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      openingCompleteRef.current = false;
      if (saveOwnerMountedRef.current) setOpeningComplete(false);
    }
  }

  function openMissingInput(section: string): void {
    setInputsOpen(true);
    requestAnimationFrame(() => {
      inputsScrollRef.current?.scrollTo({ y: sectionPositions.current[section] ?? 0, animated: false });
      inputsRef.current?.focusSection(section);
    });
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
    if (!visibleRef.current) return;
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
  const error = receiptConflict ?? editor.lastError ?? repository.storageError ?? (message?.error ? message.text : null);

  return <SafeAreaView style={styles.root} testID="design-draft-workspace">
    <View style={styles.header}>
      <Text style={styles.brand}>CPLayout</Text>
      <View style={styles.identity}>
        <Text numberOfLines={1} style={styles.title}>{editor.draft.name}</Text>
        <View style={styles.statusLine} accessibilityLiveRegion="polite">
          {saveFailed ? <TriangleAlert size={20} color="#922c24" /> : dirty || saving ? <Save size={20} color="#85520d" /> : <CheckCircle2 size={20} color="#14734b" />}
          <Text style={[styles.stateText, { color: saveFailed ? "#922c24" : dirty || saving ? "#85520d" : "#14734b" }]} testID="draft-save-state">
            {openingComplete ? "Opening saved complete design" : completing ? "Creating complete design" : saving ? "Saving" : saveFailed ? "Unsaved changes — save failed" : dirty ? "Unsaved changes" : "Saved"} | Design draft
          </Text>
        </View>
      </View>
    </View>
    <ScrollView horizontal keyboardShouldPersistTaps="handled" style={styles.toolbarScroll} contentContainerStyle={styles.toolbar} testID="draft-command-bar">{[
      { id: "catalog", label: "Close design", icon: <FolderOpen />, showLabel: true, disabled: saving || completing || openingComplete,
        onPress: () => dirty ? setConfirmClose(true) : onClose(), testID: "draft-catalog" },
      { id: "save", label: "Save draft", icon: <Save />, showLabel: true, selected: true, disabled: receiptUnavailable || saving || completing || openingComplete || pending || !repository.canSaveDraft,
        onPress: save, testID: "draft-save" },
      { id: "undo", label: "Undo", icon: <Undo2 />, disabled: pending || completing || openingComplete || editor.past.length === 0,
        onPress: () => { dispatch({ type: "undo" }); }, testID: "draft-undo" },
      { id: "redo", label: "Redo", icon: <Redo2 />, disabled: pending || completing || openingComplete || editor.future.length === 0,
        onPress: () => { dispatch({ type: "redo" }); }, testID: "draft-redo" },
      { id: "inputs", label: "Inputs", icon: <SlidersHorizontal />, showLabel: true, selected: inputsOpen,
        onPress: () => setInputsOpen(value => !value), testID: "draft-inputs-toggle" },
      { id: "calculate", label: "Calculate preview", icon: <Calculator />, showLabel: true, disabled: !admission.ok || pending || completing || openingComplete,
        onPress: calculate, testID: "draft-calculate" },
      { id: "layout", label: "Layout unavailable for drafts", icon: <LockKeyhole />, disabled: true,
        onPress: () => undefined, testID: "draft-layout" },
      { id: "export", label: "Export draft ZIP", icon: <Download />, disabled: pending || completing || openingComplete,
        onPress: exportDraft, testID: "draft-export" },
    ].map(button => <IconCommandButton key={button.id} {...button} />)}</ScrollView>
    {(reconciling || receiptConflict || error || message || pendingInputs) && <ScrollView
      keyboardShouldPersistTaps="handled" style={[styles.feedbackScroll, height < 650 && styles.shortFeedback]}
      testID="draft-feedback-scroll">
    {reconciling && <Text accessibilityLiveRegion="polite" style={styles.meta} testID="draft-reconciling">Checking the saved draft…</Text>}
    {receiptConflict && <View style={styles.toolbar} testID="draft-receipt-conflict">
      <IconCommandButton id="draft-conflict-export" label="Export draft ZIP" icon={<Download />} showLabel onPress={exportDraft} testID="draft-conflict-export" />
      <IconCommandButton id="draft-conflict-recheck" label="Check saved draft again" icon={<FolderOpen />} showLabel disabled={reconciling || saving || completing || openingComplete}
        onPress={reconcileSavedReceipt} testID="draft-conflict-recheck" />
    </View>}
    {error && <View accessibilityRole="alert" style={[styles.feedback, styles.error]} testID="draft-error">
      <TriangleAlert size={22} color="#922c24" /><Text style={[styles.stateText, styles.errorText]}>{error}</Text>
    </View>}
    {!error && message && <View accessibilityLiveRegion="polite" style={[styles.feedback, styles.success]} testID="draft-success">
      <CheckCircle2 size={22} color="#14734b" /><Text style={[styles.stateText, styles.successText]}>{message.text}</Text>
    </View>}
    {pendingInputs && <View style={[styles.feedback, styles.notice]}><Info size={22} color="#85520d" />
      <Text style={[styles.stateText, styles.warningText]}>Apply or discard pending inputs before saving, calculating, or creating a complete design.</Text></View>}
    </ScrollView>}
    <View style={styles.autosave}>
      <Switch accessibilityLabel="Autosave draft" testID="draft-autosave" value={autosave} disabled={pendingInputs || completing || openingComplete}
        onValueChange={enabled => drawing({ type: "set_autosave", enabled })} />
      <Text style={styles.stateText}>Autosave {autosave ? "on" : "off"}</Text>
      {pausedRevision !== null && !activeCapture && <Text accessibilityLiveRegion="polite" testID="draft-pause-state" style={styles.meta}>
        {savedRevision >= pausedRevision ? "Paused drawing saved — resume anytime" : "Drawing paused — save pending"}
      </Text>}
    </View>
    {activeCapture?.stage === "classification" && <ScrollView keyboardShouldPersistTaps="handled" style={[styles.classificationScroll, !visible && styles.hidden]}><DrawingClassificationDialog key={activeCapture.id}
      capture={activeCapture} draft={editor.draft} error={editor.lastError}
      onCancel={classification => {
        drawing({ type: "set_classification", id: activeCapture.id, classification });
        drawing({ type: "return_to_drawing", id: activeCapture.id });
      }}
      onConfirm={(classification, replaceExisting) => dispatch({ type: "commit_classified_drawing",
        expectedRevision: editorRef.current.revision, captureId: activeCapture.id, classification,
        ...(drawingPurpose(classification.purposeId)?.destination === "feature"
          ? { entityId: `feature-${Date.now()}-${activeCapture.id}` } : {}), replaceExisting })} /></ScrollView>}
    <View style={[styles.body, compact && styles.compactBody, height < 650 && styles.shortBody]}>
      <View style={[styles.map, height < 650 && styles.shortMap, inputsTakeBody && styles.hidden]}><DesignDraftMapSurface draft={editor.draft} onDrawing={drawing} disabled={pendingInputs || completing || openingComplete} /></View>
      <View style={[styles.inputs, compact && styles.compactInputs, inputsTakeBody && styles.inputsTakeBody, !inputsOpen && styles.hidden]}>
        <ScrollView ref={inputsScrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.inputContent} testID="draft-inputs-scroll">
          <DesignDraftInputs ref={inputsRef} editor={editor} onAction={dispatch} onRawInputChange={() => { pendingInputsRef.current = true; }} onPendingChange={value => { pendingInputsRef.current = value; setPendingInputs(value); }} disabled={!!activeCapture || completing || openingComplete} onSectionLayout={(section, y) => { sectionPositions.current[section] = y; }} />
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
      <View style={styles.completionActions}>
        <IconCommandButton id="complete" label="Create complete design" icon={<CheckCircle2 />} showLabel
          disabled={receiptUnavailable || !admission.ok || pending || saving || completing || openingComplete || !!savedComplete || !!activeCapture || !repository.canCreateCompleteDesign || !onOpenComplete}
          onPress={createCompleteDesign} testID="draft-create-complete" />
        {savedComplete && <IconCommandButton id="open-saved-complete" label="Open saved complete design" icon={<FolderOpen />} showLabel
          disabled={!visible || dirty || receiptUnavailable || saving || completing || openingComplete || !onOpenComplete}
          onPress={() => { void openSavedCompleteDesign(); }} testID="draft-open-saved-complete" />}
      </View>
      <Text style={styles.meta}>Calculate previews the applied inputs. Create complete design saves a separate design and keeps this draft.</Text>
      <View style={styles.outputSummary}><Text style={[styles.meta, styles.outputSummaryText]} testID="draft-output-source">Export: draft · {editor.draft.machine.name ?? "Machine not named"} · Saved revision {draftSavedRevision ?? "not confirmed"}{editor.revision !== savedRevision ? " + current applied changes" : ""}{pendingInputs ? ". Pending entries excluded." : ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Draft export details" accessibilityState={{ expanded: exportDetailsOpen }} aria-expanded={exportDetailsOpen} onPress={() => setExportDetailsOpen(value => !value)} style={styles.outputDisclosure} testID="draft-export-details-toggle"><Text style={styles.linkText}>{exportDetailsOpen ? "▾" : "▸"} Export details</Text></Pressable></View>
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
    <ConfirmActionDialog visible={visible && confirmClose} title="Leave unsaved design?" message="Unsaved inputs and unfinished drawing details will be discarded. Saved drawing progress remains in the draft."
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
  shortBody: { minHeight: 120 },
  shortMap: { minHeight: 80 },
  completionActions: { alignSelf: "flex-start", paddingVertical: 4 },
  missingLinks: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  missingLink: { minHeight: 36, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderColor: "#c1d4c8", borderRadius: 4 },
  linkText: { color: "#185439", fontSize: 12, fontWeight: "600" },
  map: { flex: 1, minHeight: 220, minWidth: 0 },
  inputs: { width: 330, maxWidth: "100%", borderLeftWidth: 1, borderColor: "#cdd8d1", backgroundColor: "#fff" },
  compactInputs: { width: "100%", maxHeight: "44%", minHeight: 0, flexShrink: 1, borderTopWidth: 1, borderLeftWidth: 0 },
  inputsTakeBody: { flex: 1, maxHeight: "100%", minHeight: 0 },
  hidden: { display: "none" },
  inputContent: { padding: 12, gap: 12 },
  classificationScroll: { maxHeight: "32%", flexShrink: 1, flexGrow: 0 },
  feedbackScroll: { flexGrow: 0, flexShrink: 0 },
  shortFeedback: { maxHeight: 108, minHeight: 44, flexShrink: 1 },
  shortStatus: { maxHeight: 80, minHeight: 44, flexShrink: 1 },
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
