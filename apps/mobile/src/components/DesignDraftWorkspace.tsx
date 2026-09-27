import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Calculator, Download, FolderOpen, LockKeyhole, Redo2, Save, SlidersHorizontal, Undo2 } from "lucide-react-native";
import {
  createDesignDraftEditorState, reduceDesignDraftEditorState, tryBuildPivotProject,
  type DesignDraftEditorAction, type LayoutResult,
} from "@cplayout/core";
import { evaluateLayout } from "@cplayout/geometry";
import { DesignDraftMapSurface } from "@cplayout/map-adapters";
import { buildDesignDraftArchiveBundle, exportDesignDraftArchiveZip, exportZipFileAsync } from "@cplayout/project-store";
import { useEditorSaveCoordinator } from "../hooks/useEditorSaveCoordinator";
import { useProjectRepository, type OpenedDraft } from "../hooks/useProjectRepository";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
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
  const savingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingInputs, setPendingInputs] = useState(false);
  const [pendingMap, setPendingMap] = useState(false);
  const { width } = useWindowDimensions();
  const compact = width < 800;
  const [inputsOpen, setInputsOpen] = useState(!compact);
  const [preview, setPreview] = useState<{ revision: number; result: LayoutResult } | null>(null);
  const admission = useMemo(() => tryBuildPivotProject(editor.draft), [editor.draft]);
  const pending = pendingInputs || pendingMap;
  const dirty = editor.revision !== savedRevision || pending;
  const dispatch = (action: DesignDraftEditorAction) => {
    const next = reduceDesignDraftEditorState(editorRef.current, action);
    editorRef.current = next;
    setEditor(next);
  };

  useEffect(() => {
    if (Platform.OS !== "web" || !dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save(): Promise<void> {
    if (savingRef.current || pending || !saveOwnerMountedRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    const captured = editorRef.current;
    const session = saveSessionRef.current;
    try {
      const outcome = await saveCoordinator.save({ session, payload: { kind: "draft", draft: captured.draft },
        editorRevision: captured.revision, feedbackIsCurrent: () => saveOwnerMountedRef.current,
        write: (payload, target, owner) => {
          if (payload.kind !== "draft" || target.kind !== "draft") throw new Error("A draft requires its own save target.");
          return repository.saveDesignDraft(target.designId, payload.draft, target.workspaceRevision, target.designRevision, owner);
        } });
      if (outcome.saved && saveOwnerMountedRef.current && saveCoordinator.isCurrent(session)) setSavedRevision(outcome.editorRevision);
    } catch (error) {
      if (saveOwnerMountedRef.current) setMessage(String(error));
    } finally {
      savingRef.current = false;
      if (saveOwnerMountedRef.current) setSaving(false);
    }
  }

  async function exportDraft(): Promise<void> {
    try {
      const bytes = exportDesignDraftArchiveZip(buildDesignDraftArchiveBundle(editorRef.current.draft));
      const outcome = await exportZipFileAsync("design-draft.cplayout.zip", bytes);
      if (saveOwnerMountedRef.current) setMessage(outcome.message);
    } catch (error) { if (saveOwnerMountedRef.current) setMessage(String(error)); }
  }

  function calculate(): void {
    const current = editorRef.current;
    const built = tryBuildPivotProject(current.draft);
    if (!built.ok) return;
    try { setPreview({ revision: current.revision, result: evaluateLayout(built.project) }); }
    catch (error) { setMessage(String(error)); }
  }

  const missing = admission.ok ? [] : admission.reason === "invalid_draft" ? admission.blockers
    : [...admission.completeness.blockers, ...admission.completeness.calculationBlockers];
  const missingFields = [...new Set(missing.map(item => item.path.split(".")[0]))];
  const fieldLabels: Record<string, string> = { projectCrs: "Coordinate system", fieldBoundary: "Field boundary",
    pivotCenter: "Pivot", waterSource: "Water", powerSource: "Power", machine: "Machine" };

  return <SafeAreaView style={styles.root} testID="design-draft-workspace">
    <View style={styles.header}>
      <Text style={styles.brand}>CPLayout</Text>
      <View style={styles.identity}>
        <Text numberOfLines={1} style={styles.title}>{editor.draft.name}</Text>
        <Text style={styles.meta} testID="draft-save-state">{saving ? "Saving" : dirty ? "Unsaved changes" : "Saved"} | Design draft</Text>
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
    {(editor.lastError || repository.storageError || message) && <Text accessibilityRole="alert" style={styles.error} testID="draft-error">
      {editor.lastError ?? repository.storageError ?? message}
    </Text>}
    {pendingInputs && <Text style={styles.notice}>Apply or discard pending inputs before saving.</Text>}
    {pendingMap && <Text style={styles.notice}>Finish or discard the drawing before saving.</Text>}
    <View style={[styles.body, compact && styles.compactBody]}>
      <View style={styles.map}><DesignDraftMapSurface draft={editor.draft} onAction={dispatch} disabled={pendingInputs} onPendingChange={setPendingMap} /></View>
      <View style={[styles.inputs, compact && styles.compactInputs, !inputsOpen && styles.hidden]}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.inputContent} testID="draft-inputs-scroll">
          <DesignDraftInputs editor={editor} onAction={dispatch} onPendingChange={setPendingInputs} disabled={pendingMap} />
        </ScrollView>
      </View>
    </View>
    <View style={styles.status}>
      <Text style={styles.meta} testID="draft-completeness">{admission.ok ? "Calculation inputs complete"
        : `Missing or invalid: ${missingFields.map(path => fieldLabels[path] ?? path).join(", ")}`}</Text>
      <Text style={styles.meta}>Field qualification: not verified</Text>
      {preview?.revision === editor.revision && <Text style={styles.meta} testID="draft-calculation-result">
        Coverage: {preview.result.metrics.coveragePercent.toFixed(1)}% | Field: {preview.result.metrics.fieldAcres.toFixed(2)} acres
      </Text>}
    </View>
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
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 6 },
  body: { flex: 1, minHeight: 0, flexDirection: "row" },
  compactBody: { flexDirection: "column" },
  map: { flex: 1, minHeight: 300, minWidth: 0 },
  inputs: { width: 330, maxWidth: "100%", borderLeftWidth: 1, borderColor: "#cdd8d1", backgroundColor: "#fff" },
  compactInputs: { width: "100%", maxHeight: "44%", borderTopWidth: 1, borderLeftWidth: 0 },
  hidden: { display: "none" },
  inputContent: { padding: 12, gap: 12 },
  status: { paddingVertical: 6, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: "#cdd8d1" },
  error: { color: "#922c24", backgroundColor: "#fff1ef", padding: 8, fontSize: 13 },
  notice: { color: "#563f18", backgroundColor: "#fff7df", padding: 6, fontSize: 12 },
});
