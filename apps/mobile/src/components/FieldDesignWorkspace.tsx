import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Polygon } from "react-native-svg";
import { Calculator, Check, Copy, Download, FolderOpen, LockKeyhole, Plus, Redo2, Save, Trash2, Undo2, Upload } from "lucide-react-native";
import {
  createFieldDesignEditorState, reduceFieldDesignEditorState, createFieldCalculationInput,
  createFieldLayoutTarget, serializeFieldLayoutTarget,
  type FieldDesign, type FieldDesignEditorState, type FieldDesignEditorAction, type FieldPivotMachine, type LayoutResult,
} from "@cplayout/core";
import { evaluateLayout } from "@cplayout/geometry";
import { buildFieldDesignArchiveBundle, createCatalogId, exportFieldDesignArchiveZip, exportFileAsync,
  exportZipFileAsync, importFieldDesignArchiveZip, importZipFileAsync } from "@cplayout/project-store";
import { useEditorSaveCoordinator } from "../hooks/useEditorSaveCoordinator";
import { useProjectRepository, type OpenedField } from "../hooks/useProjectRepository";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
import { assertSameFieldPlanContext, fieldMachineInputs, parseFieldMachineInputs, type FieldMachineInputs } from "./fieldMachineInputs";
import { FieldLayoutSearchPanel } from "./FieldLayoutSearchPanel";
import { FieldLateralReview } from "./FieldLateralReview";

export function FieldDesignWorkspace({ initial, onClose }: { initial: OpenedField; onClose: () => void }): React.JSX.Element {
  const [editor, setEditor] = useState<FieldDesignEditorState>(() => ({ ...createFieldDesignEditorState(initial.field), selectedMachineId: initial.field.machines[0]?.id ?? null }));
  const editorRef = useRef(editor);
  const repository = useProjectRepository();
  const { saveCoordinator, saveSessionRef, saveOwnerMountedRef } = useEditorSaveCoordinator({ kind: "field", payloadId: initial.field.id,
    designId: initial.context.designId!, workspaceRevision: initial.persistenceRevision, designRevision: initial.designRevision });
  const [savedRevision, setSavedRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [autosave, setAutosave] = useState(true);
  const autoAttempt = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(false);
  const [formReset, setFormReset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ field: FieldDesign; revision: number } | null>(null);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ revision: number; machineId: string; result: LayoutResult } | null>(null);
  const [frozen, setFrozen] = useState<{ revision: number; document: string } | null>(null);
  const [frozenExported, setFrozenExported] = useState(true);
  const compact = useWindowDimensions().width < 850;
  const selected = editor.field.machines.find(machine => machine.id === editor.selectedMachineId);
  const dirty = editor.revision !== savedRevision || pending || adding;
  const leavingLosesWork = dirty || (frozen !== null && !frozenExported);
  const blocked = pending || adding;
  const dispatch = (action: FieldDesignEditorAction): boolean => {
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
  async function save(): Promise<void> {
    if (savingRef.current || blocked || !saveOwnerMountedRef.current || !repository.canSaveField) return;
    savingRef.current = true; setSaving(true); setMessage(null);
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
      if (outcome.saved && saveOwnerMountedRef.current && saveCoordinator.isCurrent(session)) setSavedRevision(outcome.editorRevision);
    } catch (error) { if (saveOwnerMountedRef.current) setMessage(String(error)); }
    finally { savingRef.current = false; if (saveOwnerMountedRef.current) setSaving(false); }
  }
  useEffect(() => {
    if (!autosave || saving || blocked || editor.revision === savedRevision || autoAttempt.current === editor.revision || !repository.canSaveField) return;
    const timer = setTimeout(() => { autoAttempt.current = editor.revision; void save(); }, 800);
    return () => clearTimeout(timer);
  }, [autosave, saving, blocked, editor.revision, savedRevision, repository.canSaveField]);
  async function exportField(): Promise<void> {
    try {
      const bytes = exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(editorRef.current.field, undefined, initial.originalProjectDocument));
      const result = await exportZipFileAsync("field-design.cplayout.zip", bytes);
      if (saveOwnerMountedRef.current) setMessage(result.message);
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
    try {
      const current = editorRef.current;
      if (!current.selectedMachineId) return;
      const admitted = createFieldCalculationInput(current.field, { machineId: current.selectedMachineId, inputRevision: current.revision, expectedRevision: current.revision });
      if (admitted.status !== "ready") { setMessage(admitted.blockers.map(blocker => blocker.message).join("\n")); return; }
      setPreview({ revision: current.revision, machineId: current.selectedMachineId, result: evaluateLayout(admitted.project, admitted.crsOptions) });
      setMessage(null);
    } catch (error) { setMessage(String(error)); }
  }
  function freezeTarget(): void {
    try {
      const current = editorRef.current;
      if (!current.selectedMachineId || preview?.revision !== current.revision || preview.machineId !== current.selectedMachineId) return;
      const target = createFieldLayoutTarget(current.field, { inputRevision: current.revision, expectedRevision: current.revision, selectedMachineIds: [current.selectedMachineId] });
      setFrozen({ revision: current.revision, document: serializeFieldLayoutTarget(target) }); setFrozenExported(false);
      setMessage("Layout target frozen for the selected machine. Later edits will not change this target.");
    } catch (error) { setMessage(String(error)); }
  }
  const currentPreview = preview?.revision === editor.revision && preview.machineId === selected?.id ? preview : null;
  return <SafeAreaView style={styles.root} testID="field-design-workspace">
    <View style={styles.header}><Text style={styles.brand}>CPLayout</Text><View style={styles.grow}>
      <Text style={styles.title}>{editor.field.name}</Text><Text style={styles.meta} testID="field-save-state">{saving ? "Saving" : dirty ? "Unsaved changes" : "Saved"} | Field design</Text>
    </View><Text style={styles.label}>Autosave</Text><Switch value={autosave} onValueChange={setAutosave} accessibilityLabel="Autosave field" testID="field-autosave" /></View>
    <View style={styles.toolbar}>
      <IconCommandButton id="catalog" label="Catalog" icon={<FolderOpen />} showLabel disabled={saving} onPress={() => leavingLosesWork ? setConfirmClose(true) : onClose()} testID="field-catalog" />
      <IconCommandButton id="save" label="Save field" icon={<Save />} showLabel disabled={saving || blocked || !repository.canSaveField} onPress={save} testID="field-save" />
      <IconCommandButton id="undo" label="Undo" icon={<Undo2 />} disabled={blocked || editor.past.length === 0} onPress={() => { dispatch({ type: "undo" }); }} testID="field-undo" />
      <IconCommandButton id="redo" label="Redo" icon={<Redo2 />} disabled={blocked || editor.future.length === 0} onPress={() => { dispatch({ type: "redo" }); }} testID="field-redo" />
      <IconCommandButton id="calculate" label="Calculate selected" icon={<Calculator />} showLabel disabled={blocked || !selected} onPress={calculate} testID="field-calculate" />
      <IconCommandButton id="freeze" label="Freeze layout target" icon={<LockKeyhole />} showLabel disabled={blocked || !currentPreview || (frozen !== null && !frozenExported)} onPress={freezeTarget} testID="field-freeze-target" />
      <IconCommandButton id="export" label="Export field ZIP" icon={<Download />} disabled={blocked} onPress={exportField} testID="field-export" />
      <IconCommandButton id="import" label="Review machine plan ZIP" icon={<Upload />} disabled={blocked} onPress={reviewImport} testID="field-import-plan" />
    </View>
    {(editor.lastError || repository.storageError || message) && <Text accessibilityLiveRegion="polite" style={styles.feedback} testID="field-feedback">{editor.lastError ?? repository.storageError ?? message}</Text>}
    {blocked && <Text style={styles.notice}>Apply or discard the machine inputs before switching machines, saving, or calculating.</Text>}
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={[styles.columns, compact && styles.stacked]}>
        <View style={[styles.summary, compact && styles.fullWidth]}>
          <Text style={styles.heading}>Independent machines</Text>
          <Text style={styles.meta}>{editor.field.machines.length} pivots{editor.field.lateralMachines?.length ? ` | ${editor.field.lateralMachines.length} laterals` : ""} | {editor.field.projectCrs}</Text>
          <FieldDiagram field={editor.field} selectedId={selected?.id} />
          <Text style={styles.meta}>Saved pivot locations and field outline. This view does not show operating clearance or water coverage.</Text>
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
              <Text style={styles.label}>{machine.configuration.name}</Text><Text style={styles.meta}>{machine.configuration.spanLengthsMeters.length} spans | {machine.configuration.spanLengthsMeters.reduce((sum, span) => sum + span, 0)} m total spans</Text>
              <Text style={styles.meta}>{machine.id}</Text>
            </Pressable>
            <IconCommandButton id={`remove-${machine.id}`} label={`Remove ${machine.configuration.name}`} icon={<Trash2 />} disabled={blocked} onPress={() => setRemoveId(machine.id)} testID={`field-remove-${machine.id}`} />
          </View>)}
        </View>
        <View style={styles.form}>
          {adding || selected ? <MachineForm key={`${adding ? "new" : selected?.id}:${editor.revision}:${formReset}`} machine={adding ? undefined : selected} field={editor.field}
            onPending={setPending} onDiscard={() => { setAdding(false); setPending(false); setFormReset(value => value + 1); dispatch({ type: "clear_error" }); }}
            onApply={values => {
              try {
                const id = adding ? createCatalogId("machine") : selected!.id;
                const machine = parseFieldMachineInputs(values, id, adding ? undefined : selected);
                if (dispatch({ type: adding ? "add_machine" : "update_machine", machine })) {
                  setAdding(false); setPending(false); setFormReset(value => value + 1); dispatch({ type: "select_machine", id }); setMessage(null);
                }
              } catch (error) { setMessage(String(error)); }
            }} /> : <Text style={styles.meta}>Select a machine or add one with its exact dimensions.</Text>}
          {currentPreview && <View style={styles.card} testID="field-calculation-result"><Text style={styles.heading}>Selected machine calculation</Text>
            <Text style={styles.label}>{selected?.configuration.name}</Text>
            <Text style={styles.meta}>Coverage: {currentPreview.result.metrics.coveragePercent.toFixed(1)}% | Field: {currentPreview.result.metrics.fieldAcres.toFixed(2)} acres</Text>
            <Text style={styles.meta}>Single-machine result. Combined coverage, machine conflicts, hydraulics, and field qualification require separate checks.</Text>
          </View>}
          {frozen && <View style={styles.card} testID="field-frozen-target"><Text style={styles.heading}>Frozen layout target</Text>
            <Text style={styles.meta}>Field revision {frozen.revision}{frozen.revision !== editor.revision ? " | Earlier design retained" : " | Current design"}. {frozenExported ? "Exported." : "Export this target before replacing it or leaving."}</Text>
            <IconCommandButton id="export-target" label="Export frozen target" icon={<Download />} showLabel onPress={async () => {
              try { const result = await exportFileAsync("field-layout-target.json", frozen.document, { mimeType: "application/json" }); if (saveOwnerMountedRef.current) { setMessage(result.message); if (result.ok) setFrozenExported(true); } }
              catch (error) { if (saveOwnerMountedRef.current) setMessage(String(error)); }
            }} testID="field-export-target" />
          </View>}
        </View>
      </View>
      <FieldLayoutSearchPanel field={editor.field} revision={editor.revision} blocked={blocked || saving} onAdopt={(machines, expectedRevision, allowedReplacementMachineIds) => dispatch({ type: "adopt_plan", machines, expectedRevision, allowedReplacementMachineIds })} />
      <FieldLateralReview field={editor.field} revision={editor.revision} blocked={blocked || saving} />
      {plan && <View style={styles.card} testID="field-plan-review"><Text style={styles.heading}>Review imported machine plan</Text>
        <Text style={styles.meta}>{plan.field.machines.length} proposed machines. Adoption replaces the complete machine list. Existing machines remain pinned unless you unlock them below.</Text>
        {plan.field.machines.map(machine => <Text key={machine.id} style={styles.label}>{machine.configuration.name} | {machine.id}</Text>)}
        {editor.field.machines.map(machine => <View key={machine.id} style={styles.switchRow}><Text style={[styles.label, styles.grow]}>Allow replacement or removal: {machine.configuration.name}</Text>
          <Switch value={unlocked.includes(machine.id)} onValueChange={value => setUnlocked(items => value ? [...items, machine.id] : items.filter(id => id !== machine.id))} accessibilityLabel={`Unlock ${machine.configuration.name}`} testID={`field-unlock-${machine.id}`} />
        </View>)}
        {plan.revision !== editor.revision && <Text style={styles.notice}>The field changed after this review began. Import and review the plan again.</Text>}
        <View style={styles.toolbar}><IconCommandButton id="adopt" label="Adopt complete machine plan" icon={<Check />} showLabel disabled={blocked || plan.revision !== editor.revision} onPress={() => {
          if (dispatch({ type: "adopt_plan", expectedRevision: plan.revision, machines: plan.field.machines, allowedReplacementMachineIds: unlocked })) { setPlan(null); setUnlocked([]); }
        }} testID="field-adopt-plan" /><IconCommandButton id="discard-plan" label="Discard plan review" icon={<Trash2 />} showLabel onPress={() => setPlan(null)} testID="field-discard-plan" /></View>
      </View>}
    </ScrollView>
    <ConfirmActionDialog visible={confirmClose} title="Leave unsaved field?" message="Changes since the last save and any unexported frozen target will be discarded." confirmLabel="Discard changes" onCancel={() => setConfirmClose(false)} onConfirm={onClose} testID="field-discard" />
    <ConfirmActionDialog visible={removeId !== null} title="Remove machine?" message="Only this machine will be removed. Undo can restore it." confirmLabel="Remove machine" onCancel={() => setRemoveId(null)} onConfirm={() => { if (removeId) dispatch({ type: "remove_machine", id: removeId }); setRemoveId(null); }} testID="field-remove-confirm" />
  </SafeAreaView>;
}

function MachineForm({ machine, field, onPending, onApply, onDiscard }: {
  machine?: FieldPivotMachine; field: FieldDesign; onPending: (pending: boolean) => void; onApply: (values: FieldMachineInputs) => void; onDiscard: () => void;
}): React.JSX.Element {
  const [values, setValues] = useState(() => fieldMachineInputs(machine));
  const pending = JSON.stringify(values) !== JSON.stringify(fieldMachineInputs(machine));
  useEffect(() => { onPending(pending); return () => onPending(false); }, [pending, onPending]);
  const set = <K extends keyof FieldMachineInputs>(key: K, value: FieldMachineInputs[K]) => setValues(current => ({ ...current, [key]: value }));
  const input = (key: keyof FieldMachineInputs, label: string) => <View style={styles.inputGroup} key={key}><Text style={styles.label}>{label}</Text>
    <TextInput value={values[key]} onChangeText={value => set(key, value)} accessibilityLabel={label} style={styles.input} testID={`field-input-${key}`} /></View>;
  return <View style={styles.card} testID="field-machine-form"><Text style={styles.heading}>{machine ? "Selected machine" : "New machine"}</Text>
    {input("name", "Machine name")}
    <View style={styles.columns}>{input("x", "Center X (project units)")}{input("y", "Center Y (project units)")}</View>
    {machine?.pivotObservationId && <Text style={styles.meta}>Center is linked to a survey observation; its recorded coordinate must remain exact.</Text>}
    {input("spans", "Exact span lengths in metres, separated by commas")}
    <View style={styles.columns}>{input("overhang", "Overhang (m)")}{input("endGun", "End gun throw (m)")}</View>
    <View style={styles.columns}>{input("towerClearance", "Tower clearance (m)")}{input("machineClearance", "Machine clearance (m)")}</View>
    <Choice label="Sweep" value={values.sweep} options={[{ value: "full_circle", label: "Full circle" }, { value: "partial_circle", label: "Partial circle" }]} onChange={value => set("sweep", value as FieldMachineInputs["sweep"])} testID="field-sweep" />
    {values.sweep === "partial_circle" && <><View style={styles.columns}>{input("start", "Start angle (degrees)")}{input("stop", "Stop angle (degrees)")}</View>
      <Choice label="Rotation" value={values.direction} options={[{ value: "clockwise", label: "Clockwise" }, { value: "counterclockwise", label: "Counterclockwise" }]} onChange={value => set("direction", value as FieldMachineInputs["direction"])} testID="field-direction" /></>}
    <Choice label="Water source" value={values.water} options={[{ value: "", label: "Unassigned" }, ...field.infrastructure.filter(item => item.kind === "water_source").map(item => ({ value: item.id, label: `${item.id} (${item.point.x}, ${item.point.y})` }))]} onChange={value => set("water", value)} testID="field-water" />
    <Choice label="Power source" value={values.power} options={[{ value: "", label: "Unassigned" }, ...field.infrastructure.filter(item => item.kind === "power_source").map(item => ({ value: item.id, label: `${item.id} (${item.point.x}, ${item.point.y})` }))]} onChange={value => set("power", value)} testID="field-power" />
    <Choice label="Corner guidance path" value={values.guidance} options={[{ value: "", label: "Unassigned" }, ...(field.mapFeatures ?? []).filter(item => item.geometry.type === "LineString").map(item => ({ value: item.id, label: item.name }))]} onChange={value => set("guidance", value)} testID="field-guidance" />
    <Text style={styles.meta}>Other saved configuration, including corner-arm settings and end-gun angle ranges, remains attached to this machine.</Text>
    <View style={styles.toolbar}><IconCommandButton id="apply" label={machine ? "Apply machine edits" : "Add this machine"} icon={<Check />} showLabel onPress={() => onApply(values)} testID="field-apply-machine" />
      <IconCommandButton id="discard" label="Discard inputs" icon={<Undo2 />} showLabel onPress={onDiscard} testID="field-discard-inputs" /></View>
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
  return <View style={styles.diagram} testID="field-location-diagram"><Svg viewBox="0 0 300 300" width="100%" height={260} accessibilityLabel="Field boundary and saved pivot locations">
    {field.fieldBoundary.length >= 3 && <Polygon points={field.fieldBoundary.map(point => { const p = xy(point); return `${p.x},${p.y}`; }).join(" ")} fill="#e5efe5" stroke="#62846b" strokeWidth={1.5} />}
    {field.machines.map(machine => { const center = xy(machine.pivotCenter); return <Circle key={machine.id} cx={center.x} cy={center.y} r={machine.id === selectedId ? 5 : 3} fill={machine.id === selectedId ? "#a35c14" : "#285945"} />; })}
  </Svg></View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f5f7f6" }, header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderBottomWidth: 1, borderColor: "#cdd8d1" },
  brand: { fontSize: 20, fontWeight: "800", color: "#254234" }, title: { fontSize: 17, fontWeight: "700", color: "#14221b" }, grow: { flex: 1, minWidth: 0 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 6 }, content: { padding: 12, gap: 12 }, columns: { flexDirection: "row", gap: 16, alignItems: "flex-start", flexWrap: "wrap" },
  stacked: { flexDirection: "column" }, summary: { width: 330, maxWidth: "100%", gap: 10 }, fullWidth: { width: "100%" }, form: { flex: 1, minWidth: 0, alignSelf: "stretch", gap: 12 },
  card: { padding: 16, gap: 12, backgroundColor: "#fff", borderWidth: 1, borderColor: "#cdd8d1", borderRadius: 8 }, heading: { fontSize: 18, fontWeight: "700", color: "#254234" },
  label: { fontSize: 14, fontWeight: "600", color: "#293b40", flexShrink: 1 }, meta: { fontSize: 13, lineHeight: 19, color: "#4b5c53", flexShrink: 1 },
  inputGroup: { minWidth: 0, width: "100%", gap: 6 }, input: { borderWidth: 1, borderColor: "#97aea1", borderRadius: 5, backgroundColor: "#fff", color: "#14221b", padding: 10, minHeight: 44, fontSize: 15, width: "100%" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 6 }, option: { padding: 10, borderWidth: 1, borderColor: "#bdccc3", borderRadius: 5, maxWidth: "100%" }, selected: { backgroundColor: "#e0f0e5", borderColor: "#347653" },
  machineRow: { flexDirection: "row", gap: 6, alignItems: "center" }, machineButton: { flex: 1, minWidth: 0, padding: 10, borderWidth: 1, borderColor: "#bdccc3", borderRadius: 5, gap: 4 },
  switchRow: { flexDirection: "row", gap: 12, alignItems: "center" }, feedback: { padding: 10, backgroundColor: "#fff7df", color: "#64430f", fontSize: 14 }, notice: { padding: 10, color: "#85520d", backgroundColor: "#fff7df", fontSize: 14 },
  diagram: { backgroundColor: "#edf2ee", borderWidth: 1, borderColor: "#cdd8d1", borderRadius: 5 },
});
