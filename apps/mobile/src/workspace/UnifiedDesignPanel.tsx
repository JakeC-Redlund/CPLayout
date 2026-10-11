import React, { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { AppSettings } from "../../../../packages/core/src/settings";
import type { LayoutResult } from "../../../../packages/core/src/types";
import { tryBuildPivotProject, type DesignDraftBlocker } from "../../../../packages/core/src/designDraft";
import { DesignDraftInputs, type DesignDraftInputsHandle } from "../components/DesignDraftInputs";
import { FieldDesignInputs, type FieldDesignInputsProps, type FieldDesignInputsHandle } from "../components/FieldDesignInputs";
import { FieldLayoutSearchPanel } from "../components/FieldLayoutSearchPanel";
import { FieldLateralReview } from "../components/FieldLateralReview";
import { FieldMachinePairReview } from "../components/FieldMachinePairReview";
import { ProjectDesignPanel, type ProjectDesignPanelProps } from "./ProjectDesignPanel";
import { WorkspaceDrawingPanel, type WorkspaceDrawingInteraction } from "./WorkspaceDrawingPanel";
import { serializeWorkspaceEditable, type WorkspaceEditableAction, type WorkspaceEditableDocument } from "./workspaceDocumentAdapters";
import { workspaceDocumentIdentityKey } from "./workspacePresentation";
import { InputRetentionAdmissionProvider } from "../inputRetention";

export type UnifiedDesignTask = "drawing" | "inputs" | "machines" | "review";
export function visibleDesignRoot(root: { readonly isConnected: boolean; getClientRects(): { readonly length: number } } | null): boolean {
  return !!root?.isConnected && root.getClientRects().length > 0;
}
export function unifiedDesignTasks(kind: WorkspaceEditableDocument["kind"]): readonly UnifiedDesignTask[] {
  return kind === "field" ? ["machines", "review"] : ["drawing", "inputs", "review"];
}
export function draftReviewBlockerTarget(blocker: DesignDraftBlocker): { task: UnifiedDesignTask; section: string | null } {
  const section = blocker.path.split(".")[0];
  return section === "drawingWorkflow" ? { task: "drawing", section: null }
    : { task: "inputs", section: ["name", "projectCrs", "pivotCenter", "waterSource", "powerSource", "fieldBoundary", "machine"].includes(section) ? section : null };
}
export interface DraftReviewAction {
  readonly key: string;
  readonly label: string;
  readonly target: ReturnType<typeof draftReviewBlockerTarget>;
  readonly diagnostics: readonly DesignDraftBlocker[];
}
/** Group repeated diagnostics by the actual input task without changing admission. */
export function draftReviewActions(blockers: readonly DesignDraftBlocker[]): DraftReviewAction[] {
  const groups = new Map<string, DraftReviewAction>();
  for (const blocker of blockers) {
    const target = draftReviewBlockerTarget(blocker), [root, field] = blocker.path.split(".");
    let key = root, label = ({ name: "Set design name", projectCrs: "Review coordinate system", pivotCenter: "Set pivot center", waterSource: "Set water source",
      powerSource: "Set power source", fieldBoundary: "Review field boundary", drawingWorkflow: "Finish or discard pending drawing" } as Record<string, string>)[root] ?? "Review applied inputs";
    if (root === "machine") {
      key = `machine.${field ?? "configuration"}`;
      label = ({ id: "Set machine ID", name: "Set machine name", spanLengthsMeters: "Set span lengths", overhangMeters: "Set overhang length", endGunThrowMeters: "Set end-gun reach",
        towerClearanceBufferMeters: "Set tower clearance buffer", machineClearanceBufferMeters: "Set machine clearance buffer", sweep: "Choose full circle or sector" } as Record<string, string>)[field] ?? "Review machine configuration";
      if (field === "sweep") {
        const detail = blocker.path.split(".")[2];
        if (["startAngleDegrees", "stopAngleDegrees", "direction"].includes(detail)) {
          key += `.${detail}`; label = ({ startAngleDegrees: "Set sector start angle", stopAngleDegrees: "Set sector stop angle", direction: "Choose rotation direction" } as Record<string, string>)[detail];
        }
      }
    } else if (!target.section && target.task !== "drawing") key = "other-inputs";
    const previous = groups.get(key);
    groups.set(key, { key, label, target, diagnostics: [...(previous?.diagnostics ?? []), blocker] });
  }
  return [...groups.values()];
}
export function designTabFocusTarget(tasks: readonly UnifiedDesignTask[], task: UnifiedDesignTask, key: string): UnifiedDesignTask | null {
  const index = tasks.indexOf(task);
  if (index < 0) return null;
  return key === "Home" ? tasks[0] : key === "End" ? tasks[tasks.length - 1]
    : key === "ArrowRight" ? tasks[(index + 1) % tasks.length] : key === "ArrowLeft" ? tasks[(index + tasks.length - 1) % tasks.length] : null;
}

export interface UnifiedDesignCalculation {
  readonly kind: "draft" | "project" | "field"; readonly documentId: string; readonly inputRevision: number;
  readonly machineIds: readonly string[]; readonly results: readonly { readonly machineId: string; readonly result: LayoutResult }[];
  readonly sourceDocument: string;
}
export interface UnifiedDesignPanelProps {
  readonly editable: WorkspaceEditableDocument | null;
  readonly settings: AppSettings;
  readonly sourceGeneration: number;
  readonly activeTask: UnifiedDesignTask;
  /** Root suspends map input and retires held gestures; navigation does not mutate drawing history. */
  readonly onRequestTaskChange: (task: UnifiedDesignTask) => boolean;
  readonly dispatch: (action: WorkspaceEditableAction) => boolean;
  readonly dispatchBatch: (actions: readonly WorkspaceEditableAction[]) => boolean;
  readonly drawingInteraction: WorkspaceDrawingInteraction | null;
  readonly onDrawingInteractionChange: (interaction: WorkspaceDrawingInteraction) => void;
  readonly createEntityId: () => string;
  readonly onCalculate: () => void;
  readonly calculation?: UnifiedDesignCalculation | null;
  readonly onCompleteDesign: () => void;
  readonly savedCompleteDesignId?: string | null;
  readonly onOpenCompleteDesign?: (id: string) => void;
  readonly onCreateFieldFromProject: () => void;
  readonly project: Omit<ProjectDesignPanelProps, "editor" | "settings" | "onAction" | "onCalculate" | "result" | "disabled" | "presentation">;
  readonly fieldComparison?: FieldDesignInputsProps["comparison"];
  readonly onDiscardFieldComparison?: () => void;
  readonly onFieldComparisonAccepted?: () => void;
  readonly disabled?: boolean;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly onRawInputChange?: () => void;
}
/** Qualifies supplied preview metadata against the actual current input; it does not prove solver execution. */
export function currentUnifiedDesignCalculation(editable: WorkspaceEditableDocument, supplied: UnifiedDesignCalculation | null | undefined): UnifiedDesignCalculation | null {
  if (!supplied || supplied.kind !== editable.kind || supplied.documentId !== editable.identity.payloadId
    || supplied.inputRevision !== editable.editor.revision || !supplied.results.length) return null;
  try { return supplied.sourceDocument === serializeWorkspaceEditable(editable) ? supplied : null; }
  catch { return null; }
}
/** Controlled mode content. Its parent keeps it mounted when mode presentation changes. */
export interface UnifiedDesignPanelHandle { restoreRetainedFocus(): boolean; requestDesignNameFocus(isCurrent?: () => boolean): boolean }
export const UnifiedDesignPanel = React.forwardRef<UnifiedDesignPanelHandle, UnifiedDesignPanelProps>(function UnifiedDesignPanel(props, ref): React.JSX.Element {
  const editable = props.editable;
  const tabNamespace = useId();
  const tabNodes = useRef(new Map<UnifiedDesignTask, View>());
  const draftRef = useRef<DesignDraftInputsHandle>(null), fieldRef = useRef<FieldDesignInputsHandle>(null);
  const identity = JSON.stringify([workspaceDocumentIdentityKey(editable?.identity ?? null), props.sourceGeneration]);
  const [diagnosticState, setDiagnosticState] = useState({ identity, open: false });
  const diagnosticDetails = diagnosticState.identity === identity && diagnosticState.open;
  const ownerRef = useRef(identity); ownerRef.current = identity;
  const paneKey = JSON.stringify([identity, props.activeTask, !!props.disabled]);
  const paneOwner = useRef({ key: paneKey, epoch: 0 });
  if (paneOwner.current.key !== paneKey) paneOwner.current = { key: paneKey, epoch: paneOwner.current.epoch + 1 };
  const renderEpoch = paneOwner.current.epoch;
  const ownsPane = () => ownerRef.current === identity && paneOwner.current.epoch === renderEpoch && !props.disabled;
  const [fieldPendingState, setFieldPendingState] = useState({ identity, pending: false });
  const fieldPending = fieldPendingState.identity === identity && fieldPendingState.pending;
  const fieldPendingRef = useRef(false);
  const reportFieldPending = useCallback((pending: boolean) => {
    if (!ownsPane()) return;
    fieldPendingRef.current = pending;
    setFieldPendingState(previous => previous.identity === identity && previous.pending === pending ? previous : { identity, pending });
    props.onPendingChange?.(pending);
  }, [identity, renderEpoch, props.onPendingChange]);
  const latestTask = useRef(props.activeTask); latestTask.current = props.activeTask;
  const latestDisabled = useRef(props.disabled); latestDisabled.current = props.disabled;
  const restoringScroll = useRef(true);
  const restoredView = useRef({ identity, task: props.activeTask, disabled: props.disabled });
  if (restoredView.current.identity !== identity || restoredView.current.task !== props.activeTask || restoredView.current.disabled !== props.disabled) {
    restoringScroll.current = true; restoredView.current = { identity, task: props.activeTask, disabled: props.disabled };
  }
  const scrollers = useRef(new Map<UnifiedDesignTask, ScrollView>());
  const scrollPositions = useRef(new Map<UnifiedDesignTask, number>());
  const sectionPositions = useRef(new Map<string, number>());
  const focusRequest = useRef<{ identity: string; section: string } | null>(null);
  const designNameFocus = useRef<{ identity: string; task: UnifiedDesignTask; isCurrent: () => boolean } | null>(null);
  const [nameFocusSequence, setNameFocusSequence] = useState(0);
  const surfaceFocus = useRef(new Map<UnifiedDesignTask, { node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; selection: { start: number; end: number } | null }>());
  const rootRef = useRef<View>(null);
  const rootIsVisible = () => Platform.OS !== "web" || visibleDesignRoot(rootRef.current as unknown as HTMLElement | null);
  const retainedIdentity = useRef(identity);
  if (retainedIdentity.current !== identity) {
    scrollPositions.current.clear(); sectionPositions.current.clear(); surfaceFocus.current.clear(); focusRequest.current = null; designNameFocus.current = null;
    fieldPendingRef.current = false;
    retainedIdentity.current = identity;
  }
  const restore = () => {
    if (!ownsPane() || !rootIsVisible() || !editable || !unifiedDesignTasks(editable.kind).includes(props.activeTask)) return false;
    if (editable.kind === "draft" && props.activeTask === "inputs") return draftRef.current?.restoreRetainedFocus() ?? false;
    if (editable.kind === "field" && props.activeTask === "machines") return fieldRef.current?.restoreRetainedFocus() ?? false;
    if (Platform.OS !== "web") return false;
    const retained = surfaceFocus.current.get(props.activeTask);
    if (!retained?.node.isConnected || retained.node.disabled || retained.node.getClientRects().length === 0) return false;
    retained.node.focus();
    if (retained.selection && "setSelectionRange" in retained.node && retained.node.type !== "number") retained.node.setSelectionRange(retained.selection.start, retained.selection.end);
    return true;
  };
  function focusRequestedName(): boolean {
    const request = designNameFocus.current;
    if (!request) return false;
    if (request.identity !== identity || !request.isCurrent()) { designNameFocus.current = null; return false; }
    if (!ownsPane() || !rootIsVisible() || props.activeTask !== request.task || !editable) return false;
    scrollers.current.get(request.task)?.scrollTo({ y: editable.kind === "draft" ? sectionPositions.current.get("name") ?? 0 : 0, animated: false });
    const focused = editable.kind === "field" ? fieldRef.current?.focusDesignName() ?? false
      : editable.kind === "draft" ? (draftRef.current?.focusSection("name"), !!draftRef.current) : false;
    if (focused) designNameFocus.current = null;
    return focused;
  }
  useImperativeHandle(ref, () => ({ requestDesignNameFocus(isCurrent = () => true) {
    if (!ownsPane() || !editable || editable.kind === "project" || !isCurrent()) return false;
    const task = editable.kind === "field" ? "machines" : "inputs";
    designNameFocus.current = { identity, task, isCurrent };
    if (!props.onRequestTaskChange(task)) { designNameFocus.current = null; return false; }
    setNameFocusSequence(value => value + 1); return true;
  }, restoreRetainedFocus() {
    if (!ownsPane() || !rootIsVisible()) return false;
    if (focusRequestedName()) return true;
    // Tools can become visible without changing pane props. The frame calls this
    // after visibility commits; do not leave the hidden-mount scroll gate parked.
    if (restoringScroll.current) {
      scrollers.current.get(props.activeTask)?.scrollTo({ y: scrollPositions.current.get(props.activeTask) ?? 0, animated: false });
      restoringScroll.current = false;
    }
    return restore();
  } }));
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const root = rootRef.current as unknown as HTMLElement | null;
    if (!root) return;
    const remember = () => {
      if (!ownsPane() || !rootIsVisible()) return;
      const node = document.activeElement;
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) || !root.contains(node)
        || !node.closest(`[data-testid="design-task-scroll-${latestTask.current}"]`)) return;
      surfaceFocus.current.set(latestTask.current, { node, selection: "selectionStart" in node && node.selectionStart !== null && node.selectionEnd !== null
        ? { start: node.selectionStart, end: node.selectionEnd } : null });
    };
    root.addEventListener("focusin", remember); document.addEventListener("selectionchange", remember);
    return () => { root.removeEventListener("focusin", remember); document.removeEventListener("selectionchange", remember); };
  }, [identity, renderEpoch]);
  useEffect(() => {
    if (props.disabled || !editable) return;
    const committedIdentity = identity;
    let releaseFrame: number | null = null;
    const release = () => {
      if (!ownsPane() || !rootIsVisible() || ownerRef.current !== committedIdentity || latestTask.current !== props.activeTask || latestDisabled.current) return;
      if (Platform.OS === "web") {
        const node = scrollers.current.get(props.activeTask)?.getScrollableNode() as HTMLElement | undefined;
        if (node && Number.isFinite(node.scrollTop)) scrollPositions.current.set(props.activeTask, node.scrollTop);
      }
      restoringScroll.current = false;
    };
    const afterCommit = () => {
      if (!ownsPane() || !rootIsVisible() || ownerRef.current !== committedIdentity) return;
      const request = focusRequest.current;
      if (focusRequestedName()) { focusRequest.current = null; }
      else if (request?.identity === identity && props.activeTask === "inputs" && editable.kind === "draft") {
        const y = sectionPositions.current.get(request.section) ?? 0;
        scrollers.current.get("inputs")?.scrollTo({ y, animated: false }); draftRef.current?.focusSection(request.section); focusRequest.current = null;
      } else { scrollers.current.get(props.activeTask)?.scrollTo({ y: scrollPositions.current.get(props.activeTask) ?? 0, animated: false }); restore(); }
      if (Platform.OS === "web") releaseFrame = requestAnimationFrame(release); else release();
    };
    if (Platform.OS === "web") { const frame = requestAnimationFrame(afterCommit); return () => { cancelAnimationFrame(frame); if (releaseFrame !== null) cancelAnimationFrame(releaseFrame); }; }
    afterCommit();
  }, [identity, renderEpoch, props.activeTask, props.disabled, nameFocusSequence]);
  if (!editable) return <Text testID="design-no-document">Open or create an actual design to draw or configure machines.</Text>;
  const calculation = currentUnifiedDesignCalculation(editable, props.calculation);
  const tasks = unifiedDesignTasks(editable.kind);
  const tabId = (task: UnifiedDesignTask) => `design-task-tab-${tabNamespace}-${task}`;
  const panelId = (task: UnifiedDesignTask) => `design-task-panel-${tabNamespace}-${task}`;
  const surface = (task: UnifiedDesignTask, content: ReactNode) => <ScrollView key={task} ref={node => { if (node) scrollers.current.set(task, node); else scrollers.current.delete(task); }}
    nativeID={panelId(task)} {...(Platform.OS === "web" ? { role: "tabpanel" as const, "aria-labelledby": tabId(task) } : {})}
    style={[styles.scroller, { display: props.activeTask === task ? "flex" : "none" }]} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
    testID={`design-task-scroll-${task}`} scrollEventThrottle={32} onScroll={event => {
      if (ownsPane() && rootIsVisible() && ownerRef.current === identity && latestTask.current === task && !latestDisabled.current && !restoringScroll.current
        && Number.isFinite(event.nativeEvent.contentOffset.y)) scrollPositions.current.set(task, event.nativeEvent.contentOffset.y);
    }}><InputRetentionAdmissionProvider isCurrent={() => ownsPane() && props.activeTask === task}>{content}</InputRetentionAdmissionProvider></ScrollView>;
  const navigate = (task: UnifiedDesignTask) => ownsPane() && props.onRequestTaskChange(task);
  const tabKey = (task: UnifiedDesignTask, event: React.KeyboardEvent<HTMLElement>) => {
    if (!ownsPane() || !rootIsVisible()) return;
    const target = designTabFocusTarget(tasks, task, event.key);
    if (target) { event.preventDefault(); event.stopPropagation(); tabNodes.current.get(target)?.focus(); return; }
    if (event.key === " " || event.key === "Spacebar" || event.key === "Enter") {
      event.preventDefault(); event.stopPropagation(); if (!event.repeat) navigate(task);
    }
  };
  const drawing = props.drawingInteraction ? <WorkspaceDrawingPanel editable={editable} interaction={props.drawingInteraction} onInteractionChange={value => { if (ownsPane()) props.onDrawingInteractionChange(value); }}
    dispatch={action => ownsPane() && props.dispatch(action)} dispatchBatch={actions => ownsPane() && props.dispatchBatch(actions)} createEntityId={props.createEntityId} disabled={props.disabled || props.activeTask !== "drawing"} /> : null;
  const build = editable.kind === "draft" ? tryBuildPivotProject(editable.editor.draft) : null;
  const blockers = build && !build.ok ? "completeness" in build ? [...build.completeness.blockers, ...build.completeness.calculationBlockers] : build.blockers : [];
  const reviewActions = draftReviewActions(blockers);
  const button = (label: string, id: string, run: () => void, unavailable = false) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label}
    testID={id} disabled={props.disabled || unavailable} style={[styles.button, (props.disabled || unavailable) && styles.buttonDisabled]} onPress={() => { if (ownsPane() && !unavailable) run(); }}><Text style={styles.label}>{label}</Text></Pressable>;
  return <View ref={rootRef} style={styles.root} testID="unified-design-panel">
    <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel="Design tasks" testID="design-task-tabs">
      {tasks.map(task => <Pressable key={task} ref={node => { if (node) tabNodes.current.set(task, node); else tabNodes.current.delete(task); }}
        nativeID={tabId(task)} accessibilityRole="tab" accessibilityLabel={task === "drawing" ? "Drawing" : task === "inputs" ? "Inputs" : task === "machines" ? "Machines" : "Review"}
        aria-selected={props.activeTask === task} {...(Platform.OS === "web" ? { "aria-controls": panelId(task), tabIndex: !props.disabled && props.activeTask === task ? 0 : -1,
          onKeyDownCapture: (event: React.KeyboardEvent<HTMLElement>) => tabKey(task, event) } : {})}
        accessibilityState={{ selected: props.activeTask === task, disabled: props.disabled }} disabled={props.disabled} testID={`design-task-${task}`}
        style={[styles.tab, props.activeTask === task && styles.selected]} onPress={() => { navigate(task); }}><Text style={styles.label}>{task === "drawing" ? "Drawing" : task === "inputs" ? "Inputs" : task === "machines" ? "Machines" : "Review"}</Text></Pressable>)}
    </View>
    {editable.kind !== "field" && surface("drawing", drawing)}
    {editable.kind === "draft" ? <>
      {surface("inputs", <DesignDraftInputs ref={draftRef} editor={editable.editor} disabled={props.disabled || props.activeTask !== "inputs"} onAction={action => { if (ownsPane()) props.dispatch({ kind: "draft", action }); }}
        onSectionLayout={(section, y) => { if (ownsPane()) sectionPositions.current.set(section, y); }} onPendingChange={pending => { if (ownsPane()) props.onPendingChange?.(pending); }} onRawInputChange={() => { if (ownsPane()) props.onRawInputChange?.(); }} />)}
      {surface("review", <><Text style={styles.heading}>Design review</Text>
      {blockers.length > 0 ? <><Text style={styles.meta}>Supply or repair these inputs before creating a complete design.</Text>{reviewActions.map((action, index) => button(action.label, `draft-review-blocker-${index}`, () => {
        if (action.target.section) focusRequest.current = { identity, section: action.target.section };
        if (!navigate(action.target.task)) focusRequest.current = null;
      }))}
      {button(diagnosticDetails ? "Hide validation details" : "Show validation details", "draft-review-details-toggle", () => setDiagnosticState({ identity, open: !diagnosticDetails }))}
      {diagnosticDetails && <View testID="draft-review-validation-details">{blockers.map((blocker, index) => <View key={`${blocker.path}-${blocker.code}-${index}`}><Text selectable style={styles.meta}>{blocker.path} · {blocker.code}</Text><Text selectable style={styles.meta}>{blocker.message}</Text></View>)}</View>}
      </> : <Text style={styles.meta}>Applied inputs are eligible for the current planar preview. Field qualification remains separate.</Text>}
      {button("Calculate preview", "draft-calculate", props.onCalculate)}
      {button("Create complete design", "draft-create-complete", props.onCompleteDesign, !build?.ok)}
      {props.savedCompleteDesignId && button("Open saved complete design", "draft-open-saved-complete", () => props.onOpenCompleteDesign?.(props.savedCompleteDesignId!), !props.onOpenCompleteDesign)}
      {calculation && <Text testID="draft-calculation-result">Coverage {calculation.results[0]?.result.metrics.coveragePercent.toFixed(1)}% · Applied input revision {calculation.inputRevision}</Text>}
      </>)}
    </> : editable.kind === "field" ? <FieldDesignInputs ref={fieldRef} editor={editable.editor} createMachineId={props.createEntityId} disabled={props.disabled}
      presentation={{ sourceGeneration: props.sourceGeneration, activeSurface: props.activeTask === "review" ? "review" : "machines",
        renderSurface: (task, content) => surface(task, <>{task === "machines" && (drawing ?? <Text style={styles.meta}>Manual Field geometry editing is unavailable. Its saved geometry and recorded Survey remain separate from machine configuration.</Text>)}
          {task === "review" && fieldPending && <><Text style={styles.meta}>Apply or discard pending machine or field name entries before calculating or adopting a plan.</Text>{button("Back to Machines", "field-review-pending-inputs", () => { navigate("machines"); })}</>}{content}</>) }}
      onAction={action => ownsPane() && action.type !== "load_field" && props.dispatch({ kind: "field", action })} onRenameField={name => ownsPane() && props.dispatch({ kind: "field", action: { type: "rename", name } })}
      onCalculate={() => { if (ownsPane()) props.onCalculate(); }} onPendingChange={reportFieldPending} onRawInputChange={() => { if (ownsPane()) props.onRawInputChange?.(); }}
      comparison={props.fieldComparison} onDiscardComparison={props.onDiscardFieldComparison ? () => { if (ownsPane()) props.onDiscardFieldComparison?.(); } : undefined} onComparisonAccepted={props.onFieldComparisonAccepted ? () => { if (ownsPane()) props.onFieldComparisonAccepted?.(); } : undefined}
      calculationPreview={calculation?.results.find(row => row.machineId === editable.editor.selectedMachineId) ? { revision: calculation.inputRevision,
        machineId: editable.editor.selectedMachineId!, result: calculation.results.find(row => row.machineId === editable.editor.selectedMachineId)!.result } : null}
      advisoryPanels={{ layoutSearch: <FieldLayoutSearchPanel field={editable.editor.field} revision={editable.editor.revision} blocked={props.disabled === true || props.activeTask !== "review" || fieldPending}
        onAdopt={(machines, expectedRevision, allowedReplacementMachineIds) => ownsPane() && props.activeTask === "review" && !fieldPendingRef.current
          && props.dispatch({ kind: "field", action: { type: "adopt_plan", machines, expectedRevision, allowedReplacementMachineIds } })} />,
        lateralReview: <FieldLateralReview field={editable.editor.field} revision={editable.editor.revision} blocked={props.disabled === true || props.activeTask !== "review" || fieldPending} />,
        machineClearance: <FieldMachinePairReview field={editable.editor.field} revision={editable.editor.revision} blocked={props.disabled === true || props.activeTask !== "review" || fieldPending} /> }} />
      : <>
        <ProjectDesignPanel {...props.project} editor={editable.editor} settings={props.settings} disabled={props.disabled} onAction={action => ownsPane() && props.dispatch({ kind: "project", action })}
          presentation={{ sourceGeneration: props.sourceGeneration, activeSurface: props.activeTask === "inputs" || props.activeTask === "review" ? props.activeTask : null,
            renderSurface: (task, content) => surface(task, <>{content}{task === "review" && button("Save as independent-machine field", "create-independent-field", props.onCreateFieldFromProject)}</>) }}
          onCalculate={() => { if (ownsPane()) props.onCalculate(); }} result={calculation?.results.find(row => row.machineId === editable.editor.project.machine.id)?.result ?? null} />
      </>}
  </View>;
});
const styles = StyleSheet.create({ root: { flex: 1, minHeight: 0 }, tabs: { flexDirection: "row", flexShrink: 0, gap: 4, paddingBottom: 6 },
  tab: { flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: "#b7c8b5", borderRadius: 5 }, selected: { backgroundColor: "#e5f0e0" },
  scroller: { flex: 1, minHeight: 0 }, content: { gap: 10, paddingBottom: 28 }, button: { minHeight: 48, padding: 10, justifyContent: "center", borderWidth: 1, borderColor: "#b7c8b5", borderRadius: 5 }, buttonDisabled: { opacity: 0.45 },
  heading: { fontSize: 17, fontWeight: "700", color: "#244b35" }, label: { fontWeight: "600", color: "#244b35" }, meta: { color: "#536756", fontSize: 12 } });
