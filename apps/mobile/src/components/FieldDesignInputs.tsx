import React, { useEffect, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import type { FieldDesign, FieldPivotMachine } from "../../../../packages/core/src/fieldDesignDocument";
import type { FieldDesignEditorAction, FieldDesignEditorState } from "../../../../packages/core/src/fieldDesignEditor";
import type { LayoutResult } from "../../../../packages/core/src/types";
import { formatDistanceInputValue } from "@cplayout/core";
import { projectDataKey } from "../../../../packages/core/src/projectDataComparison";
import { useInputRetentionStore, useInputRetentionScopeGeneration, useRetainedInput } from "../inputRetention";
import { assertSameFieldPlanContext, fieldCoordinatesInFeet, fieldMachineInputs, parseFieldMachineInputs, type FieldMachineInputs } from "./fieldMachineInputs";
import { MachinePlanComparison } from "./MachinePlanComparison";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";

export type FieldDesignSurface = "machines" | "review";
export function fieldInfrastructureLabel(field: FieldDesign, item: FieldDesign["infrastructure"][number], ordinal: number): string {
  const kind = item.kind === "water_source" ? "Water source" : "Power source";
  return `${kind} ${ordinal}${fieldCoordinatesInFeet(field) ? ` (X ${formatDistanceInputValue(item.point.x, "us_survey_feet")}, Y ${formatDistanceInputValue(item.point.y, "us_survey_feet")} ft)` : ""}`;
}
export interface FieldDesignInputsPresentation {
  readonly sourceGeneration: number;
  readonly activeSurface: FieldDesignSurface;
  readonly renderSurface: (surface: FieldDesignSurface, content: ReactNode) => ReactNode;
}
export interface FieldDesignInputsProps {
  readonly editor: FieldDesignEditorState;
  /** True only after the coordinator admits the actual typed reducer action. */
  readonly onAction: (action: FieldDesignEditorAction) => boolean;
  readonly createMachineId: () => string;
  readonly retentionScope?: string;
  readonly disabled?: boolean;
  readonly recordedPivotOnly?: boolean;
  readonly presentation?: FieldDesignInputsPresentation;
  readonly onPendingChange?: (pending: boolean) => void;
  readonly onRawInputChange?: () => void;
  readonly onRenameField?: (name: string) => boolean;
  readonly onCalculate?: () => void;
  readonly calculationPreview?: { readonly revision: number; readonly machineId: string; readonly result: LayoutResult } | null;
  readonly comparison?: { readonly id: string; readonly field: FieldDesign; readonly revision: number; readonly sourceName: string } | null;
  readonly onDiscardComparison?: () => void;
  readonly onComparisonAccepted?: () => void;
  /** Root retains these real advisory tools and their input/result ownership outside the mode lifecycle. */
  readonly advisoryPanels: { readonly layoutSearch: ReactNode; readonly lateralReview: ReactNode; readonly machineClearance: ReactNode };
}
export interface FieldDesignInputsHandle { restoreRetainedFocus(): boolean; focusDesignName(): boolean }
export const fieldDesignInputScope = (fieldId: string): string => `field-inputs/${encodeURIComponent(fieldId)}`;
export const fieldMachineRetentionSource = (machine: FieldPivotMachine | undefined, field: FieldDesign) => ({ values: fieldMachineInputs(machine, field), error: null as string | null });

/** Parse the real existing form contract. The panel never creates an editor or rewrites undisplayed configuration. */
export function fieldMachineInputAction(editor: FieldDesignEditorState, values: FieldMachineInputs, newMachineId?: string): FieldDesignEditorAction {
  const selected = editor.field.machines.find(machine => machine.id === editor.selectedMachineId);
  if (newMachineId === undefined && !selected) throw new Error("Select a machine before applying its inputs.");
  const machine = parseFieldMachineInputs(values, newMachineId ?? selected!.id, newMachineId === undefined ? selected : undefined, editor.field);
  return { type: newMachineId === undefined ? "update_machine" : "add_machine", machine };
}

export const FieldDesignInputs = React.forwardRef<FieldDesignInputsHandle, FieldDesignInputsProps>(function FieldDesignInputs(props, ref) {
  const { editor, onAction, disabled = false } = props;
  const machineDisabled = disabled || props.presentation?.activeSurface === "review";
  const field = editor.field, store = useInputRetentionStore();
  const scope = props.retentionScope ?? fieldDesignInputScope(field.id);
  const generation = useSyncExternalStore(store.subscribeReset, store.getGeneration, store.getGeneration);
  const scopeGeneration = useInputRetentionScopeGeneration(scope);
  const paneKey = JSON.stringify([field.id, props.presentation?.sourceGeneration, props.presentation?.activeSurface, editor.selectedMachineId,
    props.comparison?.id, props.comparison?.revision, !!disabled, generation, scopeGeneration]);
  const paneOwner = useRef({ key: paneKey, epoch: 0 });
  if (paneOwner.current.key !== paneKey) paneOwner.current = { key: paneKey, epoch: paneOwner.current.epoch + 1 };
  const renderEpoch = paneOwner.current.epoch;
  const latestEditor = useRef(editor);
  useLayoutEffect(() => { latestEditor.current = editor; });
  const isCurrent = () => paneOwner.current.epoch === renderEpoch && generation === store.getGeneration() && scopeGeneration === store.getScopeGeneration(scope) && latestEditor.current === editor;
  const registered = useRef(new Map<string, { node: TextInput; unavailable: boolean }>());
  useImperativeHandle(ref, () => ({ focusDesignName() {
    if (!isCurrent() || machineDisabled || !props.onRenameField) return false;
    const address = `${scope}/name/focus/text`, input = registered.current.get(address);
    if (!input || input.unavailable) return false;
    input.node.focus(); return true;
  }, restoreRetainedFocus() {
    if (!isCurrent()) return false;
    const focus = store.retainedFocus();
    if (!focus?.key.startsWith(`${scope}/`)) return false;
    const input = registered.current.get(focus.key);
    if (!input || machineDisabled || input.unavailable) return false;
    input.node.focus(); if (focus.selection) input.node.setNativeProps({ selection: focus.selection }); return true;
  } }));
  const [ui, setUi] = useRetainedInput(`${scope}/ui`, { adding: false, removeId: null as string | null }, scope);
  const nameKey = `${scope}/name`, nameGeneration = useInputRetentionScopeGeneration(nameKey);
  const [name, setName] = useRetainedInput(nameKey, { text: field.name, error: null as string | null }, nameKey);
  const selected = field.machines.find(machine => machine.id === editor.selectedMachineId);
  const machine = ui.adding ? undefined : selected;
  const machineKey = `${scope}/machine/${ui.adding ? "new" : encodeURIComponent(machine?.id ?? "unselected")}`;
  const machineGeneration = useInputRetentionScopeGeneration(machineKey);
  const machineIsCurrent = () => isCurrent() && machineGeneration === store.getScopeGeneration(machineKey);
  const [form, setForm] = useRetainedInput(machineKey, fieldMachineRetentionSource(machine, field), machineKey);
  const comparisonKey = `${scope}/comparison/${encodeURIComponent(props.comparison?.id ?? "none")}`;
  const comparisonGeneration = useInputRetentionScopeGeneration(comparisonKey);
  const [review, setReview] = useRetainedInput(comparisonKey, { allowed: [] as string[], error: null as string | null }, comparisonKey);
  const pendingMachine = projectDataKey(form.values) !== projectDataKey(fieldMachineInputs(machine, field));
  const pendingName = name.text !== field.name;
  const pending = ui.adding || pendingMachine || pendingName || form.error !== null || name.error !== null;
  const pendingRef = useRef(pending);
  useLayoutEffect(() => { pendingRef.current = pending; });
  const machineBlocked = machineDisabled || pending;
  const reviewDisabled = disabled || props.presentation?.activeSurface === "machines";
  const blocked = reviewDisabled || pending;
  useEffect(() => { props.onPendingChange?.(pending); }, [props.onPendingChange, pending]);
  const rawChange = () => { pendingRef.current = true; props.onRawInputChange?.(); props.onPendingChange?.(true); };
  const change = <K extends keyof FieldMachineInputs>(key: K, value: FieldMachineInputs[K]) => {
    if (!machineIsCurrent() || machineDisabled) return;
    setForm(previous => ({ values: { ...previous.values, [key]: value }, error: previous.error })); rawChange();
  };
  const focusProps = (address: string, ownerScope: string, ownerGeneration: number, unavailable = machineDisabled) => ({
    ref: (node: TextInput | null) => { if (node) registered.current.set(address, { node, unavailable }); else registered.current.delete(address); },
    onFocus: () => { if (isCurrent() && !machineDisabled) store.recordFocus(address, generation, { scope: ownerScope, generation: ownerGeneration }); },
    onSelectionChange: (event: { nativeEvent: { selection: { start: number; end: number } } }) => { if (isCurrent() && !machineDisabled) store.recordSelection(address, event.nativeEvent.selection, generation, { scope: ownerScope, generation: ownerGeneration }); },
  });
  const input = (key: Exclude<keyof FieldMachineInputs, "spans">, label: string, editable = true) => {
    const address = `${machineKey}/focus/${key}`;
    return <View style={styles.group} key={key}><Text style={styles.label}>{label}</Text><TextInput
      {...focusProps(address, machineKey, machineGeneration, machineDisabled || !editable)}
      value={form.values[key]} editable={!machineDisabled && editable} accessibilityLabel={label} testID={`field-input-${key}`} style={styles.input}
      onChangeText={value => change(key, value as FieldMachineInputs[typeof key])} /></View>;
  };
  const action = (label: string, testID: string, run: () => void, unavailable = false, allowPending = false, selectedChoice?: boolean) => <Pressable accessibilityRole="button"
    accessibilityLabel={label} accessibilityState={{ disabled: unavailable, ...(selectedChoice === undefined ? {} : { selected: selectedChoice }) }} disabled={unavailable} onPress={() => { if (isCurrent() && !unavailable && (allowPending || !pendingRef.current)) run(); }}
    style={[styles.button, unavailable && styles.disabled, selectedChoice && styles.selected]} testID={testID}><Text style={styles.label}>{label}</Text></Pressable>;
  const discardMachine = () => { if (!machineIsCurrent()) return; store.resetScope(machineKey); setUi({ adding: false, removeId: null }); store.markClean(`${scope}/ui`); pendingRef.current = pendingName || name.error !== null; onAction({ type: "clear_error" }); };
  const apply = () => {
    if (!machineIsCurrent()) return;
    try {
      const next = fieldMachineInputAction(editor, form.values, ui.adding ? props.createMachineId() : undefined);
      if (!onAction(next)) { setForm(previous => ({ ...previous, error: "The machine change was not accepted. Your entries are still here." })); return; }
      if (next.type !== "add_machine" && next.type !== "update_machine") return;
      setForm({ values: fieldMachineInputs(next.machine, field), error: null }); store.markClean(machineKey);
      setUi({ adding: false, removeId: null }); store.markClean(`${scope}/ui`);
      pendingRef.current = pendingName || name.error !== null;
      if (next.type === "add_machine") onAction({ type: "select_machine", id: next.machine.id });
    } catch (failure) { setForm(previous => ({ ...previous, error: failure instanceof Error ? failure.message : String(failure) })); rawChange(); }
  };
  let comparisonError: string | null = null;
  if (props.comparison) { try { assertSameFieldPlanContext(field, props.comparison.field); } catch (failure) { comparisonError = failure instanceof Error ? failure.message : String(failure); } }
  const preview = props.calculationPreview?.revision === editor.revision && props.calculationPreview.machineId === selected?.id ? props.calculationPreview : null;
  const machines = <>
    <View style={styles.card}><Text style={styles.heading}>Design name</Text>
      <TextInput value={name.text} editable={!machineDisabled && !!props.onRenameField} accessibilityLabel="Design name" style={styles.input} testID="field-name-input"
        {...focusProps(`${nameKey}/focus/text`, nameKey, nameGeneration, machineDisabled || !props.onRenameField)}
        onChangeText={text => { if (isCurrent() && nameGeneration === store.getScopeGeneration(nameKey) && !machineDisabled) { setName(previous => ({ text, error: previous.error })); rawChange(); } }} />
      {name.error && <Text accessibilityRole="alert" style={styles.error} testID="field-name-error">{name.error}</Text>}
      {action("Apply design name", "field-rename", () => {
        if (nameGeneration !== store.getScopeGeneration(nameKey)) return;
        if (!name.text.trim()) { setName(previous => ({ ...previous, error: "Enter a design name." })); rawChange(); return; }
        if (props.onRenameField?.(name.text)) { setName({ text: name.text, error: null }); store.markClean(nameKey); pendingRef.current = ui.adding || pendingMachine || form.error !== null; }
        else setName(previous => ({ ...previous, error: "The design name was not accepted. Your entry is still here." }));
      }, machineDisabled || !props.onRenameField || (!pendingName && !name.error), true)}
      {action("Discard design name", "field-name-discard", () => { store.resetScope(nameKey); pendingRef.current = ui.adding || pendingMachine || form.error !== null; }, machineDisabled || (!pendingName && !name.error), true)}
    </View>
    {(editor.lastError || form.error) && <Text accessibilityRole="alert" style={styles.error} testID="field-input-error">{form.error ?? editor.lastError}</Text>}
    <Text style={styles.meta} testID="field-input-pending">{pending ? "Apply or discard pending entries before switching machines, saving or calculating." : "Showing applied field values."}</Text>
    <View style={styles.card}><Text style={styles.heading}>Machines in this field</Text>
      <Text style={styles.meta}>{field.machines.length} pivots · {field.lateralMachines?.length ?? 0} laterals</Text>
      <View style={styles.row}>
        {action("Add machine", "field-add-machine", () => { setUi({ adding: true, removeId: null }); rawChange(); }, machineBlocked)}
        {action("Copy selected exactly", "field-copy-machine", () => {
          if (!selected) return;
          const copied = { ...selected, id: props.createMachineId() };
          if (onAction({ type: "add_machine", machine: copied })) onAction({ type: "select_machine", id: copied.id });
        }, machineBlocked || !selected)}
      </View>
      {field.machines.map(item => <View style={styles.row} key={item.id}>
        {action(item.configuration.name, `field-machine-${item.id}`, () => { onAction({ type: "select_machine", id: item.id }); }, machineBlocked, false, item.id === selected?.id && !ui.adding)}
        {item.id === selected?.id && !ui.adding && <Text style={styles.meta}>Selected machine</Text>}
        {action(`Remove ${item.configuration.name}`, `field-remove-${item.id}`, () => setUi(previous => ({ ...previous, removeId: item.id })), machineBlocked)}
      </View>)}
      <ConfirmActionDialog visible={ui.removeId !== null} title="Remove machine?" message="Only this machine will be removed. Undo can restore it." confirmLabel="Remove machine" testID="field-remove-confirm"
        onConfirm={() => { if (!isCurrent() || machineDisabled || pendingRef.current || ui.removeId === null) return; if (onAction({ type: "remove_machine", id: ui.removeId })) { setUi(previous => ({ ...previous, removeId: null })); store.markClean(`${scope}/ui`); } }}
        onCancel={() => { if (isCurrent()) { setUi(previous => ({ ...previous, removeId: null })); store.markClean(`${scope}/ui`); } }} />
    </View>
    {(ui.adding || selected) && <View style={styles.card} testID="field-machine-form"><Text style={styles.heading}>{ui.adding ? "New machine" : `Edit ${selected!.configuration.name}`}</Text>
      {input("name", "Machine name")}
      <View style={styles.row}>{input("x", "Center X (ft)", fieldCoordinatesInFeet(field) && !props.recordedPivotOnly)}{input("y", "Center Y (ft)", fieldCoordinatesInFeet(field) && !props.recordedPivotOnly)}</View>
      {props.recordedPivotOnly && <><Text style={styles.meta}>Choose a saved Survey pivot position. Its exact measured coordinate is retained.</Text>
        {field.surveyPoints.filter(point => point.role === "pivot_center").map(point => action(`Use ${point.label || "recorded pivot position"}`, `field-use-recorded-pivot-${point.id}`, () => {
          setForm(previous => ({ ...previous, values: { ...previous.values, recordedPivotId: point.id,
            x: formatDistanceInputValue(point.projected.x, "us_survey_feet"), y: formatDistanceInputValue(point.projected.y, "us_survey_feet") } })); rawChange();
        }, machineDisabled, true))}</>}
      {!fieldCoordinatesInFeet(field) && <Text style={styles.meta}>Location units need confirmation. Saved locations are kept exactly; location editing is unavailable.</Text>}
      {machine?.pivotObservationId && <Text style={styles.meta}>Center is linked to a survey observation; its recorded coordinate must remain exact.</Text>}
      <Text style={styles.label}>Span lengths (ft)</Text>
      {form.values.spans.map((span, index) => <View style={styles.group} key={index}><Text style={styles.label}>Span {index + 1} (ft)</Text>
        <TextInput value={span} editable={!machineDisabled} accessibilityLabel={`Span ${index + 1} (ft)`} style={styles.input} testID={`field-input-span-${index}`}
          {...focusProps(`${machineKey}/focus/span/${index}`, machineKey, machineGeneration)}
          onChangeText={value => change("spans", form.values.spans.map((current, slot) => slot === index ? value : current))} /></View>)}
      <View style={styles.row}>{action("Add span", "field-add-span", () => change("spans", [...form.values.spans, ""]), machineDisabled, true)}
        {action("Remove last span", "field-remove-last-span", () => change("spans", form.values.spans.slice(0, -1)), machineDisabled || form.values.spans.length <= 1, true)}</View>
      <View style={styles.row}>{input("overhang", "Overhang (ft)")}{input("endGun", "End gun reach (ft)")}</View>
      <View style={styles.row}>{input("towerClearance", "Tower clearance (ft)")}{input("machineClearance", "Machine clearance (ft)")}</View>
      <Text style={styles.meta}>Enter decimal feet or feet and inches, such as 150 or 150' 6".</Text>
      <Choice label="Sweep" value={form.values.sweep} options={[{ value: "full_circle", label: "Full circle" }, { value: "partial_circle", label: "Partial circle" }]} disabled={machineDisabled} onChange={value => change("sweep", value as FieldMachineInputs["sweep"])} testID="field-sweep" />
      {form.values.sweep === "partial_circle" && <><View style={styles.row}>{input("start", "Start angle (degrees)")}{input("stop", "Stop angle (degrees)")}</View>
        <Choice label="Rotation" value={form.values.direction} options={[{ value: "clockwise", label: "Clockwise" }, { value: "counterclockwise", label: "Counterclockwise" }]} disabled={machineDisabled} onChange={value => change("direction", value as FieldMachineInputs["direction"])} testID="field-direction" /></>}
      <Choice label="Water source" value={form.values.water} options={[{ value: "", label: "Unassigned" }, ...field.infrastructure.filter(item => item.kind === "water_source").map((item, index) => ({ value: item.id, label: fieldInfrastructureLabel(field, item, index + 1) }))]} disabled={machineDisabled} onChange={value => change("water", value)} testID="field-water" />
      <Choice label="Power source" value={form.values.power} options={[{ value: "", label: "Unassigned" }, ...field.infrastructure.filter(item => item.kind === "power_source").map((item, index) => ({ value: item.id, label: fieldInfrastructureLabel(field, item, index + 1) }))]} disabled={machineDisabled} onChange={value => change("power", value)} testID="field-power" />
      <Choice label="Corner guidance path" value={form.values.guidance} options={[{ value: "", label: "Unassigned" }, ...(field.mapFeatures ?? []).filter(item => item.geometry.type === "LineString").map(item => ({ value: item.id, label: item.name }))]} disabled={machineDisabled} onChange={value => change("guidance", value)} testID="field-guidance" />
      <Text style={styles.meta}>Corner-arm settings, notes, drive units, catalog evidence and end-gun watering angles remain saved with this machine.</Text>
      <View style={styles.row}>{action(ui.adding ? "Add this machine" : "Apply machine inputs", "field-apply-machine", apply, machineDisabled || (!ui.adding && !pendingMachine && !form.error), true)}
        {action("Discard machine inputs", "field-discard-inputs", discardMachine, machineDisabled, true)}</View>
    </View>}
  </>;
  const reviewContent = <>
    <View style={styles.row}>{action("Calculate preview", "field-calculate", () => props.onCalculate?.(), blocked || !selected || !props.onCalculate)}</View>
    {preview && <View style={styles.card} testID="field-calculation-result"><Text style={styles.heading}>Selected machine calculation</Text><Text style={styles.meta}>{selected!.configuration.name} · Current planning calculation</Text>
      <Text style={styles.meta}>Coverage {preview.result.metrics.coveragePercent.toFixed(1)}% · Field {preview.result.metrics.fieldAcres.toFixed(2)} acres</Text>
      <Text style={styles.meta}>Single-machine preview. Combined coverage, machine conflicts, hydraulics and field qualification require separate checks.</Text></View>}
    {props.advisoryPanels.layoutSearch}{props.advisoryPanels.lateralReview}{props.advisoryPanels.machineClearance}
    {props.comparison && <View style={styles.card} testID="field-plan-review"><Text style={styles.heading}>Review machine plan</Text>
      <MachinePlanComparison field={field} proposed={props.comparison.field.machines} revision={props.comparison.revision} sourceName={props.comparison.sourceName} testID="field-plan-comparison" />
      {(comparisonError || review.error) && <Text accessibilityRole="alert" style={styles.error}>{comparisonError ?? review.error}</Text>}
      {field.machines.map(item => <View style={styles.row} key={item.id}><Text style={styles.label}>Allow replacement or removal: {item.configuration.name}</Text>
        <Switch accessibilityLabel={`Allow replacement of ${item.configuration.name}`} disabled={blocked} value={review.allowed.includes(item.id)} testID={`field-unlock-${item.id}`}
          onValueChange={value => { if (isCurrent() && comparisonGeneration === store.getScopeGeneration(comparisonKey) && !blocked) setReview(previous => ({ ...previous, allowed: value ? [...previous.allowed, item.id] : previous.allowed.filter(id => id !== item.id) })); }} /></View>)}
      {props.comparison.revision !== editor.revision && <Text style={styles.meta}>The field changed after this review began. Import and review the plan again.</Text>}
      <View style={styles.row}>{action("Use this machine plan", "field-adopt-plan", () => {
        if (comparisonGeneration !== store.getScopeGeneration(comparisonKey)) return;
        if (onAction({ type: "adopt_plan", expectedRevision: props.comparison!.revision, machines: props.comparison!.field.machines, allowedReplacementMachineIds: review.allowed })) {
          store.resetScope(comparisonKey); props.onComparisonAccepted?.();
        } else setReview(previous => ({ ...previous, error: "The plan was not accepted. Review the current field and replacement choices." }));
      }, blocked || !!comparisonError || props.comparison.revision !== editor.revision)}
        {action("Discard plan review", "field-discard-plan", () => { store.resetScope(comparisonKey); props.onDiscardComparison?.(); }, reviewDisabled || !props.onDiscardComparison)}</View>
    </View>}
  </>;
  return <View style={props.presentation ? styles.surfaces : styles.root} testID="field-design-inputs">
    {props.presentation ? props.presentation.renderSurface("machines", machines) : machines}
    {props.presentation ? props.presentation.renderSurface("review", reviewContent) : reviewContent}
  </View>;
});

function Choice({ label, value, options, disabled, onChange, testID }: { label: string; value: string; options: { value: string; label: string }[]; disabled: boolean; onChange: (value: string) => void; testID: string }) {
  return <View style={styles.group}><Text style={styles.label}>{label}</Text><View style={styles.row} testID={testID}>{options.map((option, index) => <Pressable key={option.value}
    accessibilityRole="radio" accessibilityLabel={`${label}: ${option.label}`} accessibilityState={{ checked: option.value === value, disabled }} aria-checked={option.value === value} aria-disabled={disabled} disabled={disabled}
    onPress={() => { if (!disabled) onChange(option.value); }} style={[styles.button, option.value === value && styles.selected]} testID={`${testID}-${index}`}><Text style={styles.label}>{option.label}</Text></Pressable>)}</View></View>;
}
const styles = StyleSheet.create({ surfaces: { flex: 1, minHeight: 0 }, root: { gap: 12 }, card: { backgroundColor: "#fff", borderColor: "#cdd8d1", borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  heading: { fontSize: 17, fontWeight: "700", color: "#244b35" }, label: { fontSize: 13, fontWeight: "600", color: "#244b35" }, meta: { fontSize: 12, lineHeight: 18, color: "#55685b" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }, group: { gap: 4, minWidth: 145, flexGrow: 1 }, input: { borderWidth: 1, borderColor: "#aabdac", borderRadius: 5, padding: 9, color: "#233e2d", backgroundColor: "#fff" },
  button: { minHeight: 48, justifyContent: "center", padding: 9, borderWidth: 1, borderColor: "#b7c8b5", borderRadius: 5 }, selected: { backgroundColor: "#e5f0e0" }, disabled: { opacity: 0.45 }, error: { color: "#923b29", fontSize: 12 }, confirm: { backgroundColor: "#fff4e4", padding: 10, gap: 7 } });
