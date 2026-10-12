import React, { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { formatDistanceInputValue, parseDistanceInput, qualifyProjectCrs, validateStraightLateralMachine,
  type FieldDesign, type FieldDesignEditorAction, type FieldDesignEditorState, type StraightLateralMachine } from "@cplayout/core";
import { useInputRetentionStore, useInputRetentionScopeGeneration, useRetainedInput } from "../inputRetention";
import { projectDataKey } from "../../../../packages/core/src/projectDataComparison";

export interface LateralRawInputs {
  name: string; startX: string; startY: string; endX: string; endY: string;
  left: string; right: string; heading: string; clearance: string; reach: string; water: string; power: string;
  pathId: string; pathFingerprint: string;
}
const distance = (value: number | undefined, units: FieldDesign["unitSystem"]) => value === undefined ? "" : formatDistanceInputValue(value, units);
/** Blank new input stays blank; no coordinates, member size or clearance are supplied. */
export function lateralRawInputs(machine: StraightLateralMachine | undefined, field: FieldDesign): LateralRawInputs {
  const knownUnits = qualifyProjectCrs(field.projectCrs).unit === "metre";
  return { name: machine?.name ?? "", startX: knownUnits ? distance(machine?.travel.start.x, field.unitSystem) : "", startY: knownUnits ? distance(machine?.travel.start.y, field.unitSystem) : "",
    endX: knownUnits ? distance(machine?.travel.end.x, field.unitSystem) : "", endY: knownUnits ? distance(machine?.travel.end.y, field.unitSystem) : "",
    left: distance(machine?.leftExtentMeters, field.unitSystem), right: distance(machine?.rightExtentMeters, field.unitSystem), heading: machine ? String(machine.travelHeadingDegrees) : "",
    clearance: distance(machine?.machineClearanceBufferMeters, field.unitSystem), reach: distance(machine?.sprinklerReachMeters, field.unitSystem), water: machine?.waterSourceId ?? "", power: machine?.powerSourceId ?? "", pathId: "", pathFingerprint: "" };
}
export function parseLateralRawInputs(values: LateralRawInputs, field: FieldDesign, id: string, existing?: StraightLateralMachine): StraightLateralMachine {
  const baseline = lateralRawInputs(existing, field);
  const path = values.pathId ? field.mapFeatures?.find(feature => feature.id === values.pathId) : undefined;
  const pathVertices = path?.geometry.type === "LineString" && path.geometry.vertices.length === 2 ? path.geometry.vertices : null;
  if (values.pathId && (!pathVertices || JSON.stringify(pathVertices) !== values.pathFingerprint)) throw new Error("The selected saved path changed. Select its current endpoints before applying the machine.");
  const length = (key: keyof LateralRawInputs, original: number | undefined, label: string) => original !== undefined && values[key] === baseline[key] ? original : parseDistanceInput(values[key], field.unitSystem, label);
  const coordinate = (key: "startX" | "startY" | "endX" | "endY", original: number | undefined) => {
    if (original !== undefined && values[key] === baseline[key]) return original;
    if (qualifyProjectCrs(field.projectCrs).unit !== "metre") throw new Error("Confirm the field's coordinate units before entering travel endpoints.");
    if (pathVertices) { const source = pathVertices[key.startsWith("start") ? 0 : 1][key.endsWith("X") ? "x" : "y"]; if (values[key] === distance(source, field.unitSystem)) return source; }
    return parseDistanceInput(values[key], field.unitSystem, "Travel endpoint");
  };
  if (!values.name.trim()) throw new Error("Enter a linear machine name.");
  if (!values.heading.trim() || !Number.isFinite(Number(values.heading))) throw new Error("Enter a travel direction between 0 and 360 degrees.");
  const machine: StraightLateralMachine = { ...existing, id, kind: "straight_lateral", name: values.name,
    travel: { start: { x: coordinate("startX", existing?.travel.start.x), y: coordinate("startY", existing?.travel.start.y) }, end: { x: coordinate("endX", existing?.travel.end.x), y: coordinate("endY", existing?.travel.end.y) } },
    leftExtentMeters: length("left", existing?.leftExtentMeters, "Left member length"), rightExtentMeters: length("right", existing?.rightExtentMeters, "Right member length"),
    travelHeadingDegrees: values.heading === baseline.heading && existing ? existing.travelHeadingDegrees : Number(values.heading),
    machineClearanceBufferMeters: length("clearance", existing?.machineClearanceBufferMeters, "Machine clearance") };
  if (values.reach.trim()) machine.sprinklerReachMeters = length("reach", existing?.sprinklerReachMeters, "Sprinkler reach"); else delete machine.sprinklerReachMeters;
  for (const [key, value, kind] of [["waterSourceId", values.water, "water_source"], ["powerSourceId", values.power, "power_source"]] as const) {
    if (value && !field.infrastructure.some(item => item.id === value && item.kind === kind)) throw new Error("Select an actual saved water or power source.");
    if (value) machine[key] = value; else delete machine[key];
  }
  try { return validateStraightLateralMachine(machine); } catch { throw new Error("Check the travel endpoints, direction, member lengths and clearance. Endpoints must differ and at least one member length must be positive."); }
}
export interface WorkspaceLateralInputsProps {
  editor: FieldDesignEditorState; disabled?: boolean; sourceGeneration?: number;
  savedPathOnly?: boolean;
  createMachineId(): string; onAction(action: FieldDesignEditorAction): boolean;
  onActionBatch?(actions: readonly FieldDesignEditorAction[]): boolean;
  onPendingChange?(pending: boolean): void; onRawInputChange?(): void;
}
export function WorkspaceLateralInputs(props: WorkspaceLateralInputsProps) {
  const { editor, disabled = false } = props, field = editor.field, store = useInputRetentionStore();
  const scope = `field/${encodeURIComponent(field.id)}/linear-machines`, scopeGeneration = useInputRetentionScopeGeneration(scope);
  const [ui, setUi] = useRetainedInput(`${scope}/ui`, { adding: false, removeId: null as string | null }, scope);
  const selected = field.lateralMachines?.find(item => item.id === editor.selectedMachineId), machine = ui.adding ? undefined : selected;
  const formKey = `${scope}/${ui.adding ? "new" : encodeURIComponent(machine?.id ?? "unselected")}`, formGeneration = useInputRetentionScopeGeneration(formKey);
  const [form, setForm] = useRetainedInput(formKey, { values: lateralRawInputs(machine, field), error: null as string | null }, formKey);
  const sourceKey = JSON.stringify([field.id, editor.revision, editor.selectedMachineId, props.sourceGeneration, disabled, ui.adding]);
  const owner = useRef(sourceKey); owner.current = sourceKey;
  const isCurrent = () => owner.current === sourceKey && scopeGeneration === store.getScopeGeneration(scope) && formGeneration === store.getScopeGeneration(formKey);
  const baseline = lateralRawInputs(machine, field), pending = ui.adding || projectDataKey(form.values) !== projectDataKey(baseline) || form.error !== null || ui.removeId !== null;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  useEffect(() => { props.onPendingChange?.(pending); }, [pending, props.onPendingChange]);
  function changed() { pendingRef.current = true; props.onPendingChange?.(true); props.onRawInputChange?.(); }
  function change(key: keyof LateralRawInputs, value: string) { if (!isCurrent() || disabled) return; setForm(previous => ({ ...previous, values: { ...previous.values, [key]: value } })); changed(); }
  const action = (label: string, id: string, run: () => void, blocked = false) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label} disabled={disabled || blocked}
    testID={id} onPress={() => { if (isCurrent() && !disabled && !blocked) run(); }} style={[styles.button, (disabled || blocked) && styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  const input = (key: keyof LateralRawInputs, label: string) => <View key={key} style={styles.inputGroup}><Text style={styles.label}>{label}</Text><TextInput value={form.values[key]}
    style={styles.input} editable={!disabled && !(props.savedPathOnly && ["startX", "startY", "endX", "endY"].includes(key))} accessibilityLabel={label} testID={`lateral-input-${key}`} onChangeText={value => { if (!(props.savedPathOnly && ["startX", "startY", "endX", "endY"].includes(key))) change(key, value); }}
    onFocus={() => { if (isCurrent() && !disabled) store.recordFocus(`${formKey}/focus/${key}`, store.getGeneration(), { scope: formKey, generation: formGeneration }); }}
    onSelectionChange={event => { if (isCurrent() && !disabled) store.recordSelection(`${formKey}/focus/${key}`, event.nativeEvent.selection, store.getGeneration(), { scope: formKey, generation: formGeneration }); }} /></View>;
  function discard() { store.resetScope(formKey); setUi({ adding: false, removeId: null }); store.markClean(`${scope}/ui`); pendingRef.current = false; props.onPendingChange?.(false); }
  function apply() {
    try {
      const candidate = parseLateralRawInputs(form.values, field, machine?.id ?? props.createMachineId(), machine);
      const command: FieldDesignEditorAction = { type: machine ? "update_lateral" : "add_lateral", machine: candidate };
      const accepted = !machine && props.onActionBatch ? props.onActionBatch([command, { type: "select_machine", id: candidate.id }]) : props.onAction(command);
      if (!accepted) return;
      store.resetScope(formKey); setUi({ adding: false, removeId: null }); store.markClean(`${scope}/ui`); pendingRef.current = false; props.onPendingChange?.(false);
    } catch (error) { setForm(previous => ({ ...previous, error: error instanceof Error ? error.message : "Check the linear machine entries." })); changed(); }
  }
  const units = field.unitSystem === "metric" ? "m" : "ft and in";
  const paths = field.mapFeatures?.filter(feature => feature.geometry.type === "LineString" && feature.geometry.vertices.length === 2) ?? [];
  return <View style={styles.panel} testID="workspace-lateral-inputs"><Text style={styles.heading}>Linear machines</Text><View style={styles.actions}>
    {(field.lateralMachines ?? []).map(item => action(item.name, `lateral-select-${item.id}`, () => { if (!pendingRef.current) props.onAction({ type: "select_machine", id: item.id }); }, pending))}
    {action("Add linear machine", "lateral-add", () => { if (!pendingRef.current) { setUi({ adding: true, removeId: null }); changed(); } }, pending)}
  </View>{(machine || ui.adding) && <>
    {input("name", "Linear machine name")}
    <Text style={styles.help}>{props.savedPathOnly ? "Choose a saved travel line and enter supplied member lengths and clearance. The machine uses the line's exact endpoints. Recorded observations remain with their saved source." : "Enter supplied travel endpoints, member lengths and clearance, or choose a saved travel line. Recorded observations remain with their saved source."}</Text>
    {paths.length > 0 && <View style={styles.actions}>{paths.map(path => action(`Use ${path.name}`, `lateral-path-${path.id}`, () => {
      if (path.geometry.type !== "LineString" || qualifyProjectCrs(field.projectCrs).unit !== "metre") return;
      const [start, end] = path.geometry.vertices, heading = (Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI + 360) % 360;
      setForm(previous => ({ ...previous, values: { ...previous.values, startX: distance(start.x, field.unitSystem), startY: distance(start.y, field.unitSystem), endX: distance(end.x, field.unitSystem), endY: distance(end.y, field.unitSystem), heading: String(heading), pathId: path.id, pathFingerprint: JSON.stringify(path.geometry.type === "LineString" ? path.geometry.vertices : []) } })); changed();
    }, qualifyProjectCrs(field.projectCrs).unit !== "metre"))}</View>}
    {input("startX", `Travel start east (${units})`)}{input("startY", `Travel start north (${units})`)}{input("endX", `Travel end east (${units})`)}{input("endY", `Travel end north (${units})`)}
    {input("heading", "Travel direction (degrees)")}<Text style={styles.help}>0° follows grid east; 90° follows grid north.</Text>{input("left", `Member length left of travel (${units})`)}{input("right", `Member length right of travel (${units})`)}
    {input("clearance", `Machine clearance (${units})`)}{input("reach", `Sprinkler reach (${units}, optional)`)}
    {field.infrastructure.length > 0 && <View style={styles.actions}>
      {field.infrastructure.map(item => action(`${item.kind === "water_source" ? "Water" : "Power"} source ${field.infrastructure.filter(candidate => candidate.kind === item.kind).findIndex(candidate => candidate.id === item.id) + 1}`, `lateral-source-${item.id}`, () => change(item.kind === "water_source" ? "water" : "power", item.id)))}
      {action("No water source", "lateral-no-water", () => change("water", ""))}{action("No power source", "lateral-no-power", () => change("power", ""))}
    </View>}
    {form.error && <Text style={styles.error} accessibilityRole="alert" testID="lateral-input-error">{form.error}</Text>}
    <View style={styles.actions}>{action("Apply linear machine", "lateral-apply", apply)}{action("Discard entries", "lateral-discard", discard)}
      {machine && action("Remove linear machine", "lateral-remove", () => { setUi(previous => ({ ...previous, removeId: machine.id })); changed(); }, pending)}</View>
  </>}
  {ui.removeId && <View><Text style={styles.help}>Remove this linear machine from the design? Saved Layout plans retain their original machine.</Text><View style={styles.actions}>
    {action("Keep machine", "lateral-remove-cancel", () => setUi(previous => ({ ...previous, removeId: null })))}
    {action("Confirm removal", "lateral-remove-confirm", () => { if (props.onAction({ type: "remove_lateral", id: ui.removeId! })) { store.resetScope(scope); pendingRef.current = false; props.onPendingChange?.(false); } })}
  </View></View>}</View>;
}
const styles = StyleSheet.create({ panel: { gap: 9, paddingVertical: 12 }, heading: { fontSize: 17, fontWeight: "700", color: "#284c35" }, label: { color: "#284c35", fontWeight: "600" },
  help: { fontSize: 13, lineHeight: 19, color: "#526557" }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, button: { padding: 10, borderWidth: 1, borderColor: "#b5c8b0", borderRadius: 6 },
  buttonText: { color: "#284c35", fontWeight: "600" }, disabled: { opacity: .45 }, inputGroup: { gap: 4 }, input: { borderWidth: 1, borderColor: "#aec2aa", backgroundColor: "#fff", padding: 9, borderRadius: 4 }, error: { color: "#903d2b", fontSize: 13 } });
