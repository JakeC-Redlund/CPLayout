import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Polygon } from "react-native-svg";
import { Calculator, Check, Copy, Download, FolderOpen, LockKeyhole, Plus, Redo2, Save, Trash2, Undo2, Upload } from "lucide-react-native";
import {
  createFieldDesignEditorState, reduceFieldDesignEditorState, createFieldCalculationInput,
  createFieldLayoutTarget, parseFieldLayoutTarget, serializeFieldLayoutTarget, serializeFieldDesignDocument, formatDistance,
  type FieldDesign, type FieldDesignEditorState, type FieldDesignEditorAction, type FieldPivotMachine, type LayoutResult,
} from "@cplayout/core";
import { evaluateLayout } from "@cplayout/geometry";
import { buildFieldDesignArchiveBundle, createCatalogId, exportFieldDesignArchiveZip, exportFileAsync,
  exportZipFileAsync, importFieldDesignArchiveZip, importZipFileAsync, projectRepository } from "@cplayout/project-store";
import { useEditorSaveCoordinator } from "../hooks/useEditorSaveCoordinator";
import { useProjectRepository, type OpenedField } from "../hooks/useProjectRepository";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
import { assertSameFieldPlanContext, fieldCoordinatesInFeet, fieldMachineInputs, parseFieldMachineInputs, type FieldMachineInputs } from "./fieldMachineInputs";
import { FieldLayoutSearchPanel } from "./FieldLayoutSearchPanel";
import { MachinePlanComparison } from "./MachinePlanComparison";
import { FieldLateralReview } from "./FieldLateralReview";
import { FieldMachinePairReview } from "./FieldMachinePairReview";
import { captureFieldReceiptBaseline, reconcileFieldReceipt, layoutTargetSavedMatches, type FieldReceiptBaseline, type LayoutTargetSaved } from "./fieldReceiptReconciliation";
import { editorOutputIdentity } from "./editorOutputIdentity";

export function FieldDesignWorkspace({ initial, onClose, onOpenLayout, visible = true, layoutTargetSaved, onNavigationStateChange, navigationGuardRef }: {
  initial: OpenedField; onClose: () => void;
  visible?: boolean; layoutTargetSaved?: LayoutTargetSaved;
  navigationGuardRef?: React.MutableRefObject<(() => { dirty: boolean; busy: boolean }) | null>;
  onNavigationStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  onOpenLayout?: (targetDocument: string, fieldMapId: string, expectedWorkspaceRevision: number) => Promise<boolean>;
}): React.JSX.Element {
  const [editor, setEditor] = useState<FieldDesignEditorState>(() => ({ ...createFieldDesignEditorState(initial.field), selectedMachineId: initial.field.machines[0]?.id ?? null }));
  const editorRef = useRef(editor);
  const repository = useProjectRepository();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const knownSavedField = useRef(initial.field);
  const receiptBaseline = useRef<FieldReceiptBaseline | null>(null);
  const reconcileSequence = useRef(0);
  const reconcilingRef = useRef(true);
  const [reconciling, setReconciling] = useState(true);
  const receiptConflictRef = useRef(false);
  const [receiptConflict, setReceiptConflict] = useState<string | null>(null);
  const { saveCoordinator, saveSessionRef, saveOwnerMountedRef } = useEditorSaveCoordinator({ kind: "field", payloadId: initial.field.id,
    designId: initial.context.designId!, workspaceRevision: initial.persistenceRevision, designRevision: initial.designRevision });
  const [savedRevision, setSavedRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const savingRef = useRef(false);
  const [autosave, setAutosave] = useState(true);
  const autoAttempt = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const reportPending = useCallback((value: boolean) => { pendingRef.current = value; setPending(value); }, []);
  const [adding, setAdding] = useState(false);
  const [formReset, setFormReset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [exportDetailsOpen, setExportDetailsOpen] = useState(false);
  const contentScrollRef = useRef<ScrollView>(null);
  const revealedFeedbackRef = useRef<string | null>(null);
  const [targetExportDetailsOpen, setTargetExportDetailsOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ field: FieldDesign; revision: number } | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ revision: number; machineId: string; result: LayoutResult } | null>(null);
  const [frozen, setFrozen] = useState<{ revision: number; designRevision: number; document: string } | null>(null);
  const [frozenExported, setFrozenExported] = useState(true);
  const [openingLayout, setOpeningLayout] = useState(false);
  const openingLayoutRef = useRef(false);
  const compact = useWindowDimensions().width < 850;
  const selected = editor.field.machines.find(machine => machine.id === editor.selectedMachineId);
  const dirty = editor.revision !== savedRevision || pending || adding;
  const leavingLosesWork = dirty || (frozen !== null && !frozenExported);
  const blocked = pending || adding || openingLayout;
  const receiptUnavailable = reconciling || receiptConflict !== null;
  if (navigationGuardRef) navigationGuardRef.current = () => ({
    dirty: editorRef.current.revision !== savedRevision || pendingRef.current || adding || (frozen !== null && !frozenExported),
    busy: savingRef.current || openingLayoutRef.current || reconcilingRef.current,
  });
  useEffect(() => { onNavigationStateChange?.({ dirty: leavingLosesWork, busy: saving || openingLayout || reconciling }); },
    [onNavigationStateChange, leavingLosesWork, saving, openingLayout, reconciling]);
  const fieldSnapshotHash = useMemo(() => editorOutputIdentity({ designId: initial.context.designId!, documentId: editor.field.id,
    document: serializeFieldDesignDocument(editor.field), savedRevision: initial.designRevision, inputRevision: editor.revision,
    scope: "all-machines", machineIds: [...editor.field.machines, ...(editor.field.lateralMachines ?? [])].map(machine => machine.id) }).hash, [editor.field]);
  const fieldReceipt = saveCoordinator.receipt(saveSessionRef.current);
  const fieldSavedRevision = !receiptUnavailable && fieldReceipt.kind === "field" ? fieldReceipt.designRevision : null;
  const frozenSource = useMemo(() => frozen ? parseFieldLayoutTarget(frozen.document) : null, [frozen]);
  const frozenOutput = useMemo(() => frozen && frozenSource ? editorOutputIdentity({ designId: initial.context.designId!,
    documentId: frozenSource.source.fieldId, document: frozen.document, savedRevision: frozenSource.source.inputRevision,
    inputRevision: frozen.revision, scope: "frozen-target", machineIds: frozenSource.source.selectedMachineIds }) : null, [frozen, frozenSource]);
  const dispatch = (action: FieldDesignEditorAction): boolean => {
    if (openingLayoutRef.current) return false;
    const next = reduceFieldDesignEditorState(editorRef.current, action);
    editorRef.current = next;
    setEditor(next);
    return next.lastError === null;
  };
  useEffect(() => {
    if (Platform.OS !== "web" || !leavingLosesWork) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [leavingLosesWork]);
  async function reconcileSavedReceipt(): Promise<void> {
    if (!visibleRef.current || savingRef.current || !saveOwnerMountedRef.current) return;
    const sequence = ++reconcileSequence.current;
    const session = saveSessionRef.current;
    const target = saveCoordinator.receipt(session);
    if (target.kind !== "field") return;
    reconcilingRef.current = true; setReconciling(true);
    const isCurrent = () => sequence === reconcileSequence.current && visibleRef.current && !savingRef.current
      && saveOwnerMountedRef.current && saveCoordinator.isCurrent(session);
    try {
      const versioned = projectRepository.versionedWorkspace;
      if (!versioned) throw new Error("This runtime cannot verify the saved field. Export this work before reopening it.");
      const read = await versioned.readDesignAsync(target.designId);
      if (!isCurrent()) return;
      const fieldTarget = { ...target, kind: "field" as const };
      const baseline = receiptBaseline.current ?? captureFieldReceiptBaseline(fieldTarget, knownSavedField.current,
        initial.context, initial.originalProjectDocument, read);
      const reconciled = reconcileFieldReceipt(fieldTarget, baseline, read);
      receiptBaseline.current = baseline;
      if (reconciled.siblingWriteAdvanced) {
        saveSessionRef.current = saveCoordinator.open(reconciled.target);
        // Retry only after a proven sibling write; an unchanged receipt must not loop on quota failures.
        autoAttempt.current = null; setSaveFailed(false);
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
    if (saving) { reconcileSequence.current++; return; }
    void reconcileSavedReceipt();
    return () => { reconcileSequence.current++; };
  }, [visible, saving]);
  useEffect(() => {
    if (layoutTargetSavedMatches(frozen?.document, initial.context.fieldMapId, layoutTargetSaved)) setFrozenExported(true);
  }, [frozen?.document, initial.context.fieldMapId, layoutTargetSaved]);

  async function save(): Promise<void> {
    if (!visibleRef.current || reconcilingRef.current || receiptConflictRef.current || !receiptBaseline.current
      || savingRef.current || openingLayoutRef.current || blocked || !saveOwnerMountedRef.current || !repository.canSaveField) return;
    savingRef.current = true; setSaving(true); setSaveFailed(false); setMessage(null);
    const captured = editorRef.current;
    autoAttempt.current = captured.revision;
    const session = saveSessionRef.current;
    try {
      const outcome = await saveCoordinator.save({ session, payload: { kind: "field", field: captured.field }, editorRevision: captured.revision,
        feedbackIsCurrent: () => saveOwnerMountedRef.current,
        write: (payload, target, owner) => {
          if (payload.kind !== "field" || target.kind !== "field") throw new Error("This field requires its own save target.");
          return repository.saveFieldDesign(target.designId, payload.field, target.workspaceRevision, target.designRevision, owner);
        } });
      if (saveOwnerMountedRef.current && saveCoordinator.isCurrent(session)) {
        if (outcome.saved) {
          knownSavedField.current = captured.field;
          receiptBaseline.current = null;
          reconcilingRef.current = true; setReconciling(true);
          setSavedRevision(outcome.editorRevision);
        }
        else { setSaveFailed(true); setMessage("The field was not saved. Your changes remain open; use Save field to retry."); }
      }
    } catch (error) { if (saveOwnerMountedRef.current) { setSaveFailed(true); setMessage(String(error)); } }
    finally { savingRef.current = false; if (saveOwnerMountedRef.current) setSaving(false); }
  }
  useEffect(() => {
    if (!visible || receiptUnavailable || !autosave || saving || blocked || editor.revision === savedRevision || autoAttempt.current === editor.revision || !repository.canSaveField) return;
    const timer = setTimeout(() => { autoAttempt.current = editor.revision; void save(); }, 800);
    return () => clearTimeout(timer);
  }, [visible, receiptUnavailable, autosave, saving, blocked, editor.revision, savedRevision, repository.canSaveField]);
  async function exportField(): Promise<void> {
    try {
      const captured = editorRef.current;
      const receipt = saveCoordinator.receipt(saveSessionRef.current);
      const bundle = buildFieldDesignArchiveBundle(captured.field, undefined, initial.originalProjectDocument);
      const machineIds = [...captured.field.machines, ...(captured.field.lateralMachines ?? [])].map(machine => machine.id);
      const output = editorOutputIdentity({ designId: initial.context.designId!, documentId: captured.field.id, document: bundle.files["field.json"],
        savedRevision: !receiptUnavailable && receipt.kind === "field" ? receipt.designRevision : null,
        inputRevision: captured.revision, scope: "all-machines", machineIds });
      const bytes = exportFieldDesignArchiveZip(bundle);
      const result = await exportZipFileAsync(`${output.stem}.field-design.cplayout.zip`, bytes);
      if (saveOwnerMountedRef.current) setMessage(`${result.message}${result.ok ? ` Includes all ${machineIds.length} machines. Input revision ${captured.revision}; snapshot ${output.hash.slice(0, 12)}.` : ""}`);
    } catch (error) { if (saveOwnerMountedRef.current) setMessage(String(error)); }
  }
  async function reviewImport(): Promise<void> {
    const captured = editorRef.current;
    try {
      const bytes = await importZipFileAsync();
      if (!bytes || !saveOwnerMountedRef.current) return;
      const imported = importFieldDesignArchiveZip(bytes);
      assertSameFieldPlanContext(captured.field, imported.field);
      if (imported.originalProjectDocument !== initial.originalProjectDocument) throw new Error("The archive has different original-project evidence. Open it separately.");
      setPlan({ field: imported.field, revision: captured.revision }); setUnlocked([]); setMessage(null);
    } catch (error) { if (saveOwnerMountedRef.current) setMessage(String(error)); }
  }
  function calculate(): void {
    if (!visibleRef.current) return;
    try {
      const current = editorRef.current;
      if (!current.selectedMachineId) return;
      const admitted = createFieldCalculationInput(current.field, { machineId: current.selectedMachineId, inputRevision: current.revision, expectedRevision: current.revision });
      if (admitted.status !== "ready") { setMessage(admitted.blockers.map(blocker => blocker.path === "projectCrs" ? "Confirm the field coordinate system and its units before calculating." : blocker.message).join("\n")); return; }
      setPreview({ revision: current.revision, machineId: current.selectedMachineId, result: evaluateLayout(admitted.project, admitted.crsOptions) });
      setMessage(null);
    } catch (error) { setMessage(String(error)); }
  }
  function freezeTarget(): void {
    if (!visibleRef.current) return;
    try {
      const current = editorRef.current;
      if (reconcilingRef.current || receiptConflictRef.current || savingRef.current || pending || adding || current.revision !== savedRevision) {
        setMessage("Save field before freezing the layout target.");
        return;
      }
      if (!current.selectedMachineId || preview?.revision !== current.revision || preview.machineId !== current.selectedMachineId) return;
      const session = saveSessionRef.current;
      const receipt = saveCoordinator.receipt(session);
      if (receipt.kind !== "field" || !saveCoordinator.isCurrent(session)) throw new Error("Reopen the saved field before freezing a layout target.");
      const target = createFieldLayoutTarget(current.field, { inputRevision: receipt.designRevision, expectedRevision: receipt.designRevision, selectedMachineIds: [current.selectedMachineId] });
      setFrozen({ revision: current.revision, designRevision: receipt.designRevision, document: serializeFieldLayoutTarget(target) }); setFrozenExported(false);
      setMessage("Layout target frozen for the selected machine. Later edits will not change this target.");
    } catch (error) { setMessage(String(error)); }
  }
  async function openInLayout(): Promise<void> {
    if (!visibleRef.current || !frozen || !onOpenLayout || !initial.context.fieldMapId || reconcilingRef.current || receiptConflictRef.current || savingRef.current || blocked || openingLayoutRef.current) return;
    const session = saveSessionRef.current;
    const target = saveCoordinator.receipt(session);
    if (target.kind !== "field") return;
    openingLayoutRef.current = true;
    setOpeningLayout(true);
    try {
      await onOpenLayout(frozen.document, initial.context.fieldMapId, target.workspaceRevision);
    } catch (error) { if (saveOwnerMountedRef.current) setMessage(error instanceof Error ? error.message : String(error)); }
    finally { openingLayoutRef.current = false; if (saveOwnerMountedRef.current) setOpeningLayout(false); }
  }
  const feedback = editor.lastError?.includes("is pinned")
    ? "Existing machines stay unchanged. Allow replacement of the affected machine before using this plan."
    : editor.lastError ?? repository.storageError ?? message;
  const feedbackIdentity = JSON.stringify([feedback, receiptConflict]);
  useEffect(() => {
    if (!visible) return;
    // Reveal new feedback once; returning to an unchanged message preserves the editing position.
    // Hidden updates are not marked revealed until the field becomes visible again.
    if (feedbackIdentity !== revealedFeedbackRef.current && (feedback || receiptConflict)) {
      contentScrollRef.current?.scrollTo({ y: 0, animated: false });
    }
    revealedFeedbackRef.current = feedbackIdentity;
  }, [visible, feedbackIdentity, feedback, receiptConflict]);
  const currentPreview = preview?.revision === editor.revision && preview.machineId === selected?.id ? preview : null;
  const frozenMatchesSelection = frozen?.revision === editor.revision && frozenSource?.source.selectedMachineIds.length === 1
    && frozenSource.source.selectedMachineIds[0] === selected?.id;
  const handoffNext = pending || adding ? "Apply or discard machine inputs."
    : receiptConflict ? "Resolve the saved-field conflict before preparing a target."
    : reconciling ? "Wait for the saved field check."
    : saving ? "Wait for Save field to finish."
    : editor.revision !== savedRevision ? "Save field."
    : !selected ? "Select a machine."
    : !currentPreview ? "Calculate preview for the selected machine and current inputs."
    : frozen && !frozenExported && !frozenMatchesSelection ? "Open or export the retained frozen target before replacing it."
    : !frozenMatchesSelection ? "Freeze layout target."
    : !onOpenLayout || !initial.context.fieldMapId ? "Open this design from its saved field map to continue in Layout."
    : "Open in Layout.";
  return <SafeAreaView style={styles.root} testID="field-design-workspace">
    <View style={styles.header}><Text style={styles.brand}>CPLayout</Text><View style={styles.grow}>
      <Text style={styles.title} numberOfLines={1} accessibilityLabel={editor.field.name}>{editor.field.name}</Text><Text style={styles.meta} numberOfLines={1} testID="field-save-state">{saving ? "Saving" : saveFailed ? "Unsaved changes — save failed" : dirty ? "Unsaved changes" : "Saved"} | Field design</Text>
    </View><Text style={styles.label}>Autosave</Text><Switch value={autosave} onValueChange={setAutosave} accessibilityLabel="Autosave field" testID="field-autosave" /></View>
    <ScrollView horizontal style={styles.commandScroll} contentContainerStyle={styles.commandBar}
      keyboardShouldPersistTaps="handled" testID="field-command-bar">
      <IconCommandButton id="save" label="Save field" icon={<Save />} showLabel selected disabled={receiptUnavailable || saving || blocked || !repository.canSaveField} onPress={save} testID="field-save" />
      <IconCommandButton id="calculate" label="Calculate preview" icon={<Calculator />} showLabel disabled={blocked || !selected} onPress={calculate} testID="field-calculate" />
      <IconCommandButton id="undo" label="Undo" icon={<Undo2 />} disabled={blocked || editor.past.length === 0} onPress={() => { dispatch({ type: "undo" }); }} testID="field-undo" />
      <IconCommandButton id="redo" label="Redo" icon={<Redo2 />} disabled={blocked || editor.future.length === 0} onPress={() => { dispatch({ type: "redo" }); }} testID="field-redo" />
      <IconCommandButton id="catalog" label="Close design" icon={<FolderOpen />} showLabel disabled={saving || openingLayout} onPress={() => leavingLosesWork ? setConfirmClose(true) : onClose()} testID="field-catalog" />
    </ScrollView>
    <ScrollView ref={contentScrollRef} style={styles.body} contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" testID="field-content-scroll">
      {reconciling && <Text accessibilityLiveRegion="polite" style={styles.notice} testID="field-reconciling">Checking the saved field…</Text>}
      {receiptConflict && <View style={styles.card} testID="field-receipt-conflict"><Text accessibilityRole="alert" style={styles.notice}>{receiptConflict}</Text>
        <View style={styles.toolbar}><IconCommandButton id="field-conflict-export" label="Export field ZIP" icon={<Download />} showLabel disabled={blocked} onPress={exportField} testID="field-conflict-export" />
          <IconCommandButton id="field-conflict-recheck" label="Check saved field again" icon={<FolderOpen />} showLabel disabled={reconciling || saving} onPress={reconcileSavedReceipt} testID="field-conflict-recheck" /></View>
      </View>}
      {feedback && <Text accessibilityLiveRegion="polite" style={styles.feedback} testID="field-feedback">{feedback}</Text>}
      {(pending || adding) && <Text style={styles.notice}>Apply or discard the machine inputs before switching machines, saving, or calculating.</Text>}
      {currentPreview && (saving || editor.revision !== savedRevision) && <Text style={styles.notice} testID="field-freeze-save-required">Save field before freezing the layout target.</Text>}
      {frozen && !frozenExported && <Text accessibilityLiveRegion="polite" style={styles.notice} testID="field-retained-target-notice">A frozen target is waiting. Open it in Layout or export it before replacing it or leaving.</Text>}
      <Text style={styles.selectionState} testID="field-selected-machine">{adding ? "Adding a new machine" : selected ? `Selected: ${selected.configuration.name} · ${selected.id}` : "Select a machine to edit or calculate"}{pending ? " | Changes waiting for Apply" : ""}</Text>
      <View style={[styles.columns, compact && styles.stacked]}>
        <View style={[styles.summary, compact && styles.fullWidth]}>
          <Text style={styles.heading}>Machines in this field</Text>
          <Text style={styles.meta}>{editor.field.machines.length} pivots{editor.field.lateralMachines?.length ? ` | ${editor.field.lateralMachines.length} laterals` : ""} | Locations saved</Text>
          <View style={styles.toolbar}>
            <IconCommandButton id="new" label="Add machine" icon={<Plus />} showLabel disabled={blocked} onPress={() => { setAdding(true); setMessage(null); }} testID="field-add-machine" />
            <IconCommandButton id="copy" label="Copy selected exactly" icon={<Copy />} showLabel disabled={blocked || !selected} onPress={() => {
              if (!selected) return;
              const id = createCatalogId("machine");
              if (dispatch({ type: "add_machine", machine: { ...selected, id } })) dispatch({ type: "select_machine", id });
            }} testID="field-copy-machine" />
          </View>
          {editor.field.machines.map(machine => <View style={styles.machineRow} key={machine.id}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: machine.id === selected?.id, disabled: blocked }} disabled={blocked}
              onPress={() => { dispatch({ type: "select_machine", id: machine.id }); }} style={[styles.machineButton, machine.id === selected?.id && styles.selected]} testID={`field-machine-${machine.id}`}>
              <Text style={styles.label}>{machine.configuration.name}</Text><Text style={styles.meta}>{machine.configuration.spanLengthsMeters.length} spans | {formatDistance(machine.configuration.spanLengthsMeters.reduce((sum, span) => sum + span, 0), "us_survey_feet")} total span length</Text>
            </Pressable>
            <IconCommandButton id={`remove-${machine.id}`} label={`Remove ${machine.configuration.name}`} icon={<Trash2 />} disabled={blocked} onPress={() => setRemoveId(machine.id)} testID={`field-remove-${machine.id}`} />
          </View>)}
        </View>
        <View style={styles.form}>
          {adding || selected ? <MachineForm key={`${adding ? "new" : selected?.id}:${editor.revision}:${formReset}`} machine={adding ? undefined : selected} field={editor.field}
            onPending={reportPending} onDiscard={() => { setAdding(false); pendingRef.current = false; setPending(false); setFormReset(value => value + 1); dispatch({ type: "clear_error" }); }}
            onApply={values => {
              try {
                const id = adding ? createCatalogId("machine") : selected!.id;
                const machine = parseFieldMachineInputs(values, id, adding ? undefined : selected, editor.field);
                if (dispatch({ type: adding ? "add_machine" : "update_machine", machine })) {
                  setAdding(false); pendingRef.current = false; setPending(false); setFormReset(value => value + 1); dispatch({ type: "select_machine", id }); setMessage(null);
                }
              } catch (error) { setMessage(String(error)); }
            }} /> : <Text style={styles.meta}>Select a machine or add one with its exact dimensions.</Text>}
          {currentPreview && <View style={styles.card} testID="field-calculation-result"><Text style={styles.heading}>Selected machine calculation</Text>
            <Text style={styles.label}>{selected?.configuration.name} · {selected?.id}</Text>
            <Text style={styles.meta}>Edit revision {currentPreview.revision}. This is a preview of the applied machine inputs.</Text>
            <Text style={styles.meta}>Coverage: {currentPreview.result.metrics.coveragePercent.toFixed(1)}% | Field: {currentPreview.result.metrics.fieldAcres.toFixed(2)} acres</Text>
            <Text style={styles.meta}>Single-machine result. Combined coverage, machine conflicts, hydraulics, and field qualification require separate checks.</Text>
          </View>}
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Field locations</Text>
        <FieldDiagram field={editor.field} selectedId={selected?.id} />
        <Text style={styles.meta}>Pivot locations and field outline. This view does not show operating clearance or water coverage.</Text>
      </View>
      <View style={styles.card} testID="field-layout-handoff">
        <Text style={styles.heading}>Prepare for RTK Layout</Text>
        <Text style={styles.meta}>Apply inputs → Save field → Calculate preview → Freeze target → Open in Layout</Text>
        <Text style={styles.label} accessibilityLiveRegion="polite" testID="field-layout-next">Next: {handoffNext}</Text>
        <Text style={styles.meta}>{selected ? `${selected.configuration.name} · ${selected.id}` : "No machine selected"} · Input revision {editor.revision} · Saved design revision {fieldSavedRevision ?? "not confirmed"}</Text>
        <Text style={styles.meta}>Freeze keeps an exact target for the selected machine. RTK observations are collected separately in Layout.</Text>
      <IconCommandButton id="freeze" label="Freeze layout target" icon={<LockKeyhole />} showLabel disabled={receiptUnavailable || blocked || saving || editor.revision !== savedRevision || !currentPreview || (frozen !== null && !frozenExported)} onPress={freezeTarget} testID="field-freeze-target" />
      </View>
      {frozen && frozenSource && frozenOutput && <View style={styles.card} testID="field-frozen-target"><Text style={styles.heading}>Frozen layout target</Text>
        <Text style={styles.meta} testID="field-target-output-source">Saved design revision {frozenSource.source.inputRevision} · {frozenSource.source.selectedMachineIds.map(id => frozenSource.field.machines.find(machine => machine.id === id)?.configuration.name ?? "Machine").join("; ")}{frozen.revision !== editor.revision ? " · Earlier design retained; current edits are not in this target" : !frozenMatchesSelection ? " · Different selected machine retained" : " · Matches current applied inputs"}</Text>
        <Text style={styles.meta}>{frozenExported ? "Saved or exported." : "Open in Layout or export this target before replacing it or leaving."}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Frozen target export details" accessibilityState={{ expanded: targetExportDetailsOpen }} aria-expanded={targetExportDetailsOpen} onPress={() => setTargetExportDetailsOpen(value => !value)} style={styles.outputDisclosure} testID="field-target-export-details-toggle"><Text style={styles.outputDisclosureText}>{targetExportDetailsOpen ? "▾" : "▸"} Export details</Text></Pressable>
        {targetExportDetailsOpen && <View style={styles.outputDetails} testID="field-target-export-details">
          <Text selectable style={styles.meta}>Target: {frozenSource.field.name} ({frozenSource.source.fieldId}) · Input revision {frozen.revision}</Text>
          <Text selectable style={styles.meta}>Selected target machines: {frozenSource.source.selectedMachineIds.map(id => `${frozenSource.field.machines.find(machine => machine.id === id)?.configuration.name ?? "Machine"} (${id})`).join("; ")}</Text>
          <Text selectable style={styles.meta}>Snapshot SHA-256: {frozenOutput.hash}</Text>
        </View>}
        <Text style={styles.meta}>Observations collected in Layout are saved separately. They cannot move this target.</Text>
        <IconCommandButton id="open-layout" label={openingLayout ? "Opening Layout" : "Open in Layout"} icon={<FolderOpen />} showLabel
          disabled={receiptUnavailable || !onOpenLayout || blocked || saving || !initial.context.fieldMapId} onPress={openInLayout} testID="field-open-layout" />
        <IconCommandButton id="export-target" label="Export frozen target" icon={<Download />} showLabel onPress={async () => {
          try { const result = await exportFileAsync(`${frozenOutput.stem}.field-layout-target.json`, frozen.document, { mimeType: "application/json" }); if (saveOwnerMountedRef.current) { setMessage(`${result.message}${result.ok ? ` Frozen design revision ${frozenSource.source.inputRevision}; snapshot ${frozenOutput.hash.slice(0, 12)}.` : ""}`); if (result.ok) setFrozenExported(true); } }
          catch (error) { if (saveOwnerMountedRef.current) setMessage(String(error)); }
        }} testID="field-export-target" />
      </View>}
      <View style={styles.toolbar} testID="field-file-actions">
        <IconCommandButton id="export" label="Export field ZIP" icon={<Download />} showLabel disabled={blocked} onPress={exportField} testID="field-export" />
        <IconCommandButton id="import" label="Review machine plan ZIP" icon={<Upload />} showLabel disabled={blocked} onPress={reviewImport} testID="field-import-plan" />
      </View>
      <View style={styles.outputSummary}><Text style={[styles.meta, styles.outputSummaryText]} testID="field-output-source">Export: all {editor.field.machines.length + (editor.field.lateralMachines?.length ?? 0)} machines · Saved revision {fieldSavedRevision ?? "not confirmed"}{editor.revision !== savedRevision ? " + current applied changes" : ""}{pending || adding ? ". Pending entries excluded." : ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Field export details" accessibilityState={{ expanded: exportDetailsOpen }} aria-expanded={exportDetailsOpen} onPress={() => setExportDetailsOpen(value => !value)} style={styles.outputDisclosure} testID="field-export-details-toggle"><Text style={styles.outputDisclosureText}>{exportDetailsOpen ? "▾" : "▸"} Export details</Text></Pressable></View>
      {exportDetailsOpen && <View style={styles.card} testID="field-export-details"><Text selectable style={styles.meta}>Design ID: {initial.context.designId} · Field design ID: {editor.field.id} · Input revision {editor.revision}</Text>
        <Text selectable style={styles.meta}>Snapshot SHA-256: {fieldSnapshotHash}</Text>
        <Text style={styles.meta}>Includes every pivot and lateral in this field, regardless of the selected machine. Form entries waiting for Apply are excluded.</Text>
        <Text selectable style={styles.meta}>Machines: {[...editor.field.machines.map(machine => `${machine.configuration.name} (${machine.id})`), ...(editor.field.lateralMachines ?? []).map(machine => `${machine.name} (${machine.id})`)].join("; ") || "None"}</Text>
      </View>}
      <FieldLayoutSearchPanel field={editor.field} revision={editor.revision} blocked={blocked || saving} onAdopt={(machines, expectedRevision, allowedReplacementMachineIds) => dispatch({ type: "adopt_plan", machines, expectedRevision, allowedReplacementMachineIds })} />
      <FieldLateralReview field={editor.field} revision={editor.revision} blocked={blocked || saving} />
      <FieldMachinePairReview field={editor.field} revision={editor.revision} blocked={blocked || saving} />
      {plan && <View style={styles.card} testID="field-plan-review"><Text style={styles.heading}>Review imported machine plan</Text>
        <Text style={styles.meta}>{plan.field.machines.length} proposed machines. Adoption replaces the complete machine list. Existing machines stay unchanged unless you allow replacement below.</Text>
        <MachinePlanComparison field={editor.field} proposed={plan.field.machines} revision={plan.revision} sourceName="Imported machine plan" testID="field-plan-comparison" />
        {editor.field.machines.map(machine => <View key={machine.id} style={styles.switchRow}><Text style={[styles.label, styles.grow]}>Allow replacement or removal: {machine.configuration.name}</Text>
          <Switch value={unlocked.includes(machine.id)} onValueChange={value => setUnlocked(items => value ? [...items, machine.id] : items.filter(id => id !== machine.id))} accessibilityLabel={`Allow replacement of ${machine.configuration.name}`} testID={`field-unlock-${machine.id}`} />
        </View>)}
        {plan.revision !== editor.revision && <Text style={styles.notice}>The field changed after this review began. Import and review the plan again.</Text>}
        <View style={styles.toolbar}><IconCommandButton id="adopt" label="Use this machine plan" icon={<Check />} showLabel disabled={blocked || plan.revision !== editor.revision} onPress={() => {
          if (dispatch({ type: "adopt_plan", expectedRevision: plan.revision, machines: plan.field.machines, allowedReplacementMachineIds: unlocked })) { setPlan(null); setUnlocked([]); }
        }} testID="field-adopt-plan" /><IconCommandButton id="discard-plan" label="Discard plan review" icon={<Trash2 />} showLabel onPress={() => setPlan(null)} testID="field-discard-plan" /></View>
      </View>}
    </ScrollView>
    <ConfirmActionDialog visible={visible && confirmClose} title="Leave unsaved field?" message="Changes since the last save and any unexported frozen target will be discarded." confirmLabel="Discard changes" onCancel={() => setConfirmClose(false)} onConfirm={onClose} testID="field-discard" />
    <ConfirmActionDialog visible={visible && removeId !== null} title="Remove machine?" message="Only this machine will be removed. Undo can restore it." confirmLabel="Remove machine" onCancel={() => setRemoveId(null)} onConfirm={() => { if (removeId) dispatch({ type: "remove_machine", id: removeId }); setRemoveId(null); }} testID="field-remove-confirm" />
  </SafeAreaView>;
}

function MachineForm({ machine, field, onPending, onApply, onDiscard }: {
  machine?: FieldPivotMachine; field: FieldDesign; onPending: (pending: boolean) => void; onApply: (values: FieldMachineInputs) => void; onDiscard: () => void;
}): React.JSX.Element {
  const [values, setValues] = useState(() => fieldMachineInputs(machine, field));
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const pending = JSON.stringify(values) !== JSON.stringify(fieldMachineInputs(machine, field));
  useEffect(() => { onPending(pending); return () => onPending(false); }, [pending, onPending]);
  const set = <K extends keyof FieldMachineInputs>(key: K, value: FieldMachineInputs[K]) => {
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    onPending(JSON.stringify(next) !== JSON.stringify(fieldMachineInputs(machine, field)));
    setValues(next);
  };
  const input = (key: Exclude<keyof FieldMachineInputs, "spans">, label: string, editable = true) => <View style={styles.inputGroup} key={key}><Text style={styles.label}>{label}</Text>
    <TextInput editable={editable} value={values[key]} onChangeText={value => set(key, value)} accessibilityLabel={label} style={styles.input} testID={`field-input-${key}`} /></View>;
  return <View style={styles.card} testID="field-machine-form"><Text style={styles.heading}>{machine ? `Edit ${machine.configuration.name}` : "New machine"}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.meta}>{pending ? "Changes waiting for Apply. Saved machine values are still in use." : "Showing the applied machine values."}</Text>
    {input("name", "Machine name")}
    <View style={styles.columns}>{input("x", "Center X (ft)", fieldCoordinatesInFeet(field))}{input("y", "Center Y (ft)", fieldCoordinatesInFeet(field))}</View>
    {!fieldCoordinatesInFeet(field) && <Text style={styles.meta}>Location units need confirmation. Saved locations are kept exactly; location editing is unavailable.</Text>}
    {machine?.pivotObservationId && <Text style={styles.meta}>Center is linked to a survey observation; its recorded coordinate must remain exact.</Text>}
    <View style={styles.inputGroup} testID="field-input-spans">
      <Text style={styles.label}>Span lengths (ft)</Text>
      {values.spans.map((span, index) => <View style={styles.inputGroup} key={index}>
        <Text style={styles.label}>Span {index + 1} (ft)</Text>
        <TextInput value={span} onChangeText={value => set("spans", values.spans.map((current, slot) => slot === index ? value : current))}
          accessibilityLabel={`Span ${index + 1} (ft)`} style={styles.input} testID={`field-input-span-${index}`} />
      </View>)}
      <View style={styles.toolbar}>
        <IconCommandButton id="add-span" label="Add span" icon={<Plus />} showLabel onPress={() => set("spans", [...values.spans, ""])} testID="field-add-span" />
        <IconCommandButton id="remove-last-span" label="Remove last span" icon={<Trash2 />} showLabel disabled={values.spans.length <= 1}
          onPress={() => set("spans", values.spans.slice(0, -1))} testID="field-remove-last-span" />
      </View>
    </View>
    <View style={styles.columns}>{input("overhang", "Overhang (ft)")}{input("endGun", "End gun reach (ft)")}</View>
    <View style={styles.columns}>{input("towerClearance", "Tower clearance (ft)")}{input("machineClearance", "Machine clearance (ft)")}</View>
    <Text style={styles.meta}>Enter decimal feet or feet and inches, such as 150 or 150' 6".</Text>
    <Choice label="Sweep" value={values.sweep} options={[{ value: "full_circle", label: "Full circle" }, { value: "partial_circle", label: "Partial circle" }]} onChange={value => set("sweep", value as FieldMachineInputs["sweep"])} testID="field-sweep" />
    {values.sweep === "partial_circle" && <><View style={styles.columns}>{input("start", "Start angle (degrees)")}{input("stop", "Stop angle (degrees)")}</View>
      <Choice label="Rotation" value={values.direction} options={[{ value: "clockwise", label: "Clockwise" }, { value: "counterclockwise", label: "Counterclockwise" }]} onChange={value => set("direction", value as FieldMachineInputs["direction"])} testID="field-direction" /></>}
    <Choice label="Water source" value={values.water} options={[{ value: "", label: "Unassigned" }, ...field.infrastructure.filter(item => item.kind === "water_source").map(item => ({ value: item.id, label: item.id }))]} onChange={value => set("water", value)} testID="field-water" />
    <Choice label="Power source" value={values.power} options={[{ value: "", label: "Unassigned" }, ...field.infrastructure.filter(item => item.kind === "power_source").map(item => ({ value: item.id, label: item.id }))]} onChange={value => set("power", value)} testID="field-power" />
    <Choice label="Corner guidance path" value={values.guidance} options={[{ value: "", label: "Unassigned" }, ...(field.mapFeatures ?? []).filter(item => item.geometry.type === "LineString").map(item => ({ value: item.id, label: item.name }))]} onChange={value => set("guidance", value)} testID="field-guidance" />
    <Text style={styles.meta}>Corner-arm settings and end-gun watering angles remain saved with this machine.</Text>
    <View style={styles.toolbar}><IconCommandButton id="apply" label={machine ? "Apply machine inputs" : "Add this machine"} icon={<Check />} showLabel disabled={!!machine && !pending} onPress={() => onApply(values)} testID="field-apply-machine" />
      <IconCommandButton id="discard" label="Discard machine inputs" icon={<Undo2 />} showLabel onPress={onDiscard} testID="field-discard-inputs" /></View>
  </View>;
}

function Choice({ label, value, options, onChange, testID }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; testID: string }): React.JSX.Element {
  return <View style={styles.inputGroup}><Text style={styles.label}>{label}</Text><View style={styles.options} testID={testID}>{options.map((option, index) =>
    <Pressable key={option.value} accessibilityRole="radio" accessibilityState={{ checked: option.value === value }} accessibilityLabel={`${label}: ${option.label}`} onPress={() => onChange(option.value)} style={[styles.option, value === option.value && styles.selected]} testID={`${testID}-${index}`}>
      <Text style={styles.meta}>{option.label}</Text>
    </Pressable>)}</View></View>;
}
function FieldDiagram({ field, selectedId }: { field: FieldDesign; selectedId?: string }): React.JSX.Element {
  const points = [...field.fieldBoundary, ...field.machines.map(machine => machine.pivotCenter)];
  if (!points.length) return <Text style={styles.meta}>No saved field coordinates.</Text>;
  const minX = Math.min(...points.map(point => point.x)); const maxX = Math.max(...points.map(point => point.x));
  const minY = Math.min(...points.map(point => point.y)); const maxY = Math.max(...points.map(point => point.y));
  const scale = Math.max(maxX - minX, maxY - minY, 1);
  const xy = (point: { x: number; y: number }) => ({ x: 10 + (point.x - minX) / scale * 280, y: 290 - (point.y - minY) / scale * 280 });
  return <View style={styles.diagram} testID="field-location-diagram"><Svg viewBox="0 0 300 300" width="100%" height={260} accessibilityLabel="Field boundary and pivot locations">
    {field.fieldBoundary.length >= 3 && <Polygon points={field.fieldBoundary.map(point => { const p = xy(point); return `${p.x},${p.y}`; }).join(" ")} fill="#e5efe5" stroke="#62846b" strokeWidth={1.5} />}
    {field.machines.map(machine => { const center = xy(machine.pivotCenter); return <Circle key={machine.id} cx={center.x} cy={center.y} r={machine.id === selectedId ? 5 : 3} fill={machine.id === selectedId ? "#a35c14" : "#285945"} />; })}
  </Svg></View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "#f5f7f6" }, header: { flexDirection: "row", flexShrink: 0, alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: "#cdd8d1" },
  brand: { fontSize: 20, fontWeight: "800", color: "#254234" }, title: { fontSize: 17, fontWeight: "700", color: "#14221b" }, grow: { flex: 1, minWidth: 0 },
  commandScroll: { flexGrow: 0, flexShrink: 0 }, commandBar: { flexDirection: "row", gap: 6, padding: 6 },
  body: { flex: 1, minHeight: 96 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 6 }, content: { padding: 12, gap: 12 }, columns: { flexDirection: "row", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  stacked: { flexDirection: "column" }, summary: { width: 330, maxWidth: "100%", gap: 10 }, fullWidth: { width: "100%" }, form: { flex: 1, minWidth: 0, alignSelf: "stretch", gap: 12 },
  card: { padding: 16, gap: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#cdd8d1", borderRadius: 8 }, heading: { fontSize: 18, fontWeight: "700", color: "#254234" },
  label: { fontSize: 14, fontWeight: "600", color: "#293b40", flexShrink: 1 }, meta: { fontSize: 13, lineHeight: 19, color: "#4b5c53", flexShrink: 1 },
  outputSummary: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  outputSummaryText: { flex: 1, minWidth: 180 },
  outputDisclosure: { minHeight: 36, justifyContent: "center", paddingHorizontal: 6, alignSelf: "flex-start" },
  outputDisclosureText: { color: "#185439", fontSize: 12, fontWeight: "600" },
  outputDetails: { gap: 4 },
  selectionState: { paddingHorizontal: 12, paddingVertical: 6, color: "#254234", fontSize: 13, fontWeight: "600" },
  inputGroup: { minWidth: 0, width: "100%", gap: 6 }, input: { borderWidth: 1, borderColor: "#97aea1", borderRadius: 5, backgroundColor: "#fff", color: "#14221b", padding: 10, minHeight: 44, fontSize: 15, width: "100%" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, option: { padding: 10, borderWidth: 1, borderColor: "#bdccc3", borderRadius: 5, maxWidth: "100%" }, selected: { backgroundColor: "#e0f0e5", borderColor: "#347653" },
  machineRow: { flexDirection: "row", gap: 6, alignItems: "center" }, machineButton: { flex: 1, minWidth: 0, padding: 10, borderWidth: 1, borderColor: "#bdccc3", borderRadius: 5, gap: 4 },
  switchRow: { flexDirection: "row", gap: 12, alignItems: "center" }, feedback: { padding: 10, backgroundColor: "#fff7df", color: "#64430f", fontSize: 14 }, notice: { padding: 10, color: "#85520d", backgroundColor: "#fff7df", fontSize: 14 },
  diagram: { backgroundColor: "#edf2ee", borderWidth: 1, borderColor: "#cdd8d1", borderRadius: 5 },
});
