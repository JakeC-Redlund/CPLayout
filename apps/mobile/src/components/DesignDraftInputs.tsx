import type { DesignDraftEditorAction, DesignDraftEditorState, DesignDraftMachine, XY } from "@cplayout/core";
import { Check, Circle, CircleDot, Plus, RotateCcw, Trash2 } from "lucide-react-native";
import React, { createContext, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { IconCommandButton } from "./CommandSurface";
import {
  MACHINE_LENGTH_FIELDS, machineInputValues, parseDraftBoundary, parseDraftMachine, parseDraftPoint,
  type MachineInputValues,
} from "./designDraftInputValues";

interface Props {
  editor: DesignDraftEditorState;
  onAction: (action: DesignDraftEditorAction) => void;
  onRawInputChange?: () => void;
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
  onSectionLayout?: (section: string, y: number) => void;
}

export interface DesignDraftInputsHandle { focusSection: (section: string) => void }
type RegisteredInput = { node: TextInput; value: string; disabled: boolean };
const InputRegistry = createContext<React.MutableRefObject<Map<string, Map<string, RegisteredInput>>> | null>(null);
const InputSection = createContext("");

type ReportPending = (section: string, pending: boolean) => void;
const RawInputChange = createContext<(() => void) | undefined>(undefined);
const InputsDisabled = createContext(false);
const SectionLayout = createContext<Props["onSectionLayout"]>(undefined);

export const DesignDraftInputs = React.forwardRef<DesignDraftInputsHandle, Props>(function DesignDraftInputs(
  { editor, onAction, onPendingChange, disabled = false, onSectionLayout, onRawInputChange }, ref,
): React.JSX.Element {
  const inputRegistry = useRef(new Map<string, Map<string, RegisteredInput>>());
  useImperativeHandle(ref, () => ({ focusSection(section) {
    const inputs = [...(inputRegistry.current.get(section)?.values() ?? [])].filter(input => !input.disabled);
    (inputs.find(input => !input.value.trim()) ?? inputs[0])?.node.focus();
  } }), []);
  const { draft, lockedCrs } = editor;
  const [reset, setReset] = useState(0);
  const [pendingSections, setPendingSections] = useState<Record<string, boolean>>({});
  const reportPending = useCallback<ReportPending>((section, pending) => {
    setPendingSections((previous) => previous[section] === pending ? previous : { ...previous, [section]: pending });
  }, []);
  const pending = Object.values(pendingSections).some(Boolean);
  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  // Section keys refresh external edits and undo without dropping text in unrelated sections.
  const keyFor = (value: unknown) => JSON.stringify([draft.id, reset, value]);
  return (
    <RawInputChange.Provider value={onRawInputChange}><InputRegistry.Provider value={inputRegistry}><InputsDisabled.Provider value={disabled}><SectionLayout.Provider value={onSectionLayout}>
      <View style={styles.panel} testID="design-draft-inputs">
        <View style={styles.commands}>
          <IconCommandButton id="discard-draft-inputs" label="Discard inputs" icon={<RotateCcw />} showLabel disabled={disabled || !pending}
            onPress={() => { setReset((value) => value + 1); onAction({ type: "clear_error" }); }} testID="draft-inputs-discard" />
        </View>
        {editor.lastError ? <FormError message={editor.lastError} /> : null}
        <NameSection key={keyFor(draft.name)} name={draft.name} onAction={onAction} reportPending={reportPending} />
        <CrsSection key={keyFor([draft.projectCrs, lockedCrs])} crs={draft.projectCrs} lockedCrs={lockedCrs} onAction={onAction} reportPending={reportPending} />
        <PointSection key={`pivot-${keyFor(draft.pivotCenter)}`} label="Pivot center" role="pivot_center" point={draft.pivotCenter} onAction={onAction} reportPending={reportPending} />
        <PointSection key={`water-${keyFor(draft.waterSource)}`} label="Water source" role="water_source" point={draft.waterSource} onAction={onAction} reportPending={reportPending} />
        <PointSection key={`power-${keyFor(draft.powerSource)}`} label="Power source" role="power_source" point={draft.powerSource} onAction={onAction} reportPending={reportPending} />
        <BoundarySection key={keyFor(draft.fieldBoundary)} vertices={draft.fieldBoundary} onAction={onAction} reportPending={reportPending} />
        <SavedMapItemsSection draft={draft} onAction={onAction} disabled={pending} />
        <MachineSection key={keyFor(draft.machine)} machine={draft.machine} onAction={onAction} reportPending={reportPending} />
      </View>
    </SectionLayout.Provider></InputsDisabled.Provider></InputRegistry.Provider></RawInputChange.Provider>
  );
});

function NameSection({ name, onAction, reportPending }: { name: string; onAction: Props["onAction"]; reportPending: ReportPending }): React.JSX.Element {
  const [text, setText] = useState(name);
  const [error, setError] = useState<string | null>(null);
  usePending("name", text !== name, reportPending);
  return (
    <Section title="Design name">
      <Input label="Design name" value={text} onChange={(value) => { setText(value); setError(null); }} testID="draft-name" />
      <FormError message={error} />
      <Apply label="Apply name" onPress={() => attempt(setError, () => {
        if (!text.trim()) throw new Error("Supply a draft document name before applying.");
        onAction({ type: "rename", name: text });
      })} />
    </Section>
  );
}

function SavedMapItemsSection({ draft, onAction, disabled: pending }: {
  draft: DesignDraftEditorState["draft"]; onAction: Props["onAction"]; disabled: boolean;
}): React.JSX.Element {
  const disabled = useContext(InputsDisabled) || pending;
  return (
    <Section title="Saved map items">
      <Text style={styles.label}>Features</Text>
      {(draft.mapFeatures ?? []).length === 0 ? <Text style={styles.status}>No saved features</Text> : null}
      {(draft.mapFeatures ?? []).map((feature) => (
        <View key={feature.id} style={styles.savedItemRow} testID={`draft-saved-feature-${feature.id}`}>
          <View style={styles.savedItemText}>
            <Text style={styles.savedItemName}>{feature.name}</Text>
            <Text style={styles.status}>{feature.kind.replace(/_/g, " ")} - {feature.geometry.type}</Text>
          </View>
          <IconCommandButton id={`delete-feature-${feature.id}`} label={`Delete feature ${feature.name}`} icon={<Trash2 />}
            disabled={disabled} onPress={() => onAction({ type: "delete_feature", id: feature.id })}
            testID={`draft-delete-feature-${feature.id}`} />
        </View>
      ))}
      <Text style={styles.label}>Obstacles</Text>
      {draft.obstacles.length === 0 ? <Text style={styles.status}>No saved obstacles</Text> : null}
      {draft.obstacles.map((obstacle) => (
        <View key={obstacle.id} style={styles.savedItemRow} testID={`draft-saved-obstacle-${obstacle.id}`}>
          <View style={styles.savedItemText}>
            <Text style={styles.savedItemName}>{obstacle.name}</Text>
            <Text style={styles.status}>{obstacle.kind.replace(/_/g, " ")}</Text>
          </View>
          <IconCommandButton id={`delete-obstacle-${obstacle.id}`} label={`Delete obstacle ${obstacle.name}`} icon={<Trash2 />}
            disabled={disabled} onPress={() => onAction({ type: "delete_obstacle", id: obstacle.id })}
            testID={`draft-delete-obstacle-${obstacle.id}`} />
        </View>
      ))}
    </Section>
  );
}

function CrsSection({ crs, lockedCrs, onAction, reportPending }: {
  crs: string | null; lockedCrs: string | null; onAction: Props["onAction"]; reportPending: ReportPending;
}): React.JSX.Element {
  const [text, setText] = useState(crs ?? "");
  const disabled = useContext(InputsDisabled);
  usePending("crs", text !== (crs ?? ""), reportPending);
  return (
    <Section title="Coordinate system">
      <Input label="Projected/local CRS" value={text} onChange={setText} disabled={lockedCrs !== null} testID="draft-crs" />
      {lockedCrs !== null ? <Text style={styles.status}>Locked CRS: {lockedCrs}</Text> : null}
      {lockedCrs !== null && lockedCrs !== crs ? (
        <IconCommandButton id="restore-draft-crs" label="Restore CRS" icon={<RotateCcw />} showLabel disabled={disabled}
          onPress={() => onAction({ type: "set_crs", projectCrs: lockedCrs })} testID="draft-crs-restore" />
      ) : <Apply label="Apply CRS" disabled={lockedCrs !== null} onPress={() => {
        const projectCrs = text.trim() || null;
        onAction({ type: "set_crs", projectCrs });
        if (projectCrs === crs) setText(crs ?? "");
      }} />}
    </Section>
  );
}

function PointSection({ label, role, point, onAction, reportPending }: {
  label: string; role: "pivot_center" | "water_source" | "power_source"; point: XY | null; onAction: Props["onAction"]; reportPending: ReportPending;
}): React.JSX.Element {
  const [x, setX] = useState(point?.x.toString() ?? "");
  const [y, setY] = useState(point?.y.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  usePending(role, x !== (point?.x.toString() ?? "") || y !== (point?.y.toString() ?? ""), reportPending);
  return (
    <Section title={label}>
      <View style={styles.fields}>
        <Input inline label={`${label} X (project CRS units)`} value={x} onChange={(value) => { setX(value); setError(null); }} testID={`draft-${role}-x`} />
        <Input inline label={`${label} Y (project CRS units)`} value={y} onChange={(value) => { setY(value); setError(null); }} testID={`draft-${role}-y`} />
      </View>
      <FormError message={error} />
      <Apply label={`Apply ${label.toLowerCase()}`} onPress={() => attempt(setError, () => {
        const next = parseDraftPoint(x, y);
        onAction({ type: "set_infrastructure", role, point: next });
        if (next?.x === point?.x && next?.y === point?.y) {
          setX(point?.x.toString() ?? ""); setY(point?.y.toString() ?? "");
        }
      })} />
    </Section>
  );
}

function BoundarySection({ vertices, onAction, reportPending }: { vertices: XY[]; onAction: Props["onAction"]; reportPending: ReportPending }): React.JSX.Element {
  const [text, setText] = useState(vertices.map(({ x, y }) => `${x},${y}`).join("\n"));
  const [error, setError] = useState<string | null>(null);
  usePending("boundary", text !== vertices.map(({ x, y }) => `${x},${y}`).join("\n"), reportPending);
  return (
    <Section title="Field boundary">
      <Input label="Boundary CSV: X,Y (project CRS units)" value={text} multiline testID="draft-boundary-csv"
        onChange={(value) => { setText(value); setError(null); }} />
      <Text style={styles.status}>{vertices.length} applied vertices</Text>
      <FormError message={error} />
      <Apply label="Apply boundary" onPress={() => attempt(setError, () => {
        const next = parseDraftBoundary(text);
        onAction({ type: "replace_boundary", vertices: next });
        if (next.length === vertices.length && next.every((point, index) => point.x === vertices[index].x && point.y === vertices[index].y)) {
          setText(vertices.map(({ x, y }) => `${x},${y}`).join("\n"));
        }
      })} />
    </Section>
  );
}

function MachineSection({ machine, onAction, reportPending }: { machine: DesignDraftMachine; onAction: Props["onAction"]; reportPending: ReportPending }): React.JSX.Element {
  const disabled = useContext(InputsDisabled);
  const [values, setValues] = useState(() => machineInputValues(machine));
  const [error, setError] = useState<string | null>(null);
  usePending("machine", JSON.stringify(values) !== JSON.stringify(machineInputValues(machine)), reportPending);
  function change<K extends keyof MachineInputValues>(field: K, value: MachineInputValues[K]): void {
    setValues((previous) => ({ ...previous, [field]: value }));
    setError(null);
  }
  return (
    <Section title="Machine">
      <View style={styles.fields}>
        <Input inline label="Machine ID" value={values.id} onChange={(value) => change("id", value)} testID="draft-machine-id" />
        <Input inline label="Machine name" value={values.name} onChange={(value) => change("name", value)} testID="draft-machine-name" />
        {MACHINE_LENGTH_FIELDS.map(([field, label]) => <Input inline key={field} label={label} value={values[field]} onChange={(value) => change(field, value)} testID={`draft-machine-${field}`} />)}
      </View>
      <Text style={styles.label}>Span lengths (ft)</Text>
      {(values.spans ?? []).map((span, index) => (
        <View key={index} style={styles.spanRow}>
          <Input label={`Span ${index + 1} (ft)`} value={span} testID={`draft-machine-span-${index}`}
            onChange={(value) => change("spans", values.spans?.map((item, slot) => slot === index ? value : item))} />
        </View>
      ))}
      <View style={styles.commands}>
        <IconCommandButton id="add-span" label="Add span" icon={<Plus />} showLabel disabled={disabled} onPress={() => change("spans", [...(values.spans ?? []), ""])} testID="draft-machine-add-span" />
        <IconCommandButton id="remove-last-span" label="Remove last span" icon={<Trash2 />} showLabel disabled={disabled || !values.spans?.length}
          onPress={() => change("spans", values.spans?.slice(0, -1))} testID="draft-machine-remove-last-span" />
      </View>
      <Options label="Sweep" value={values.mode} onChange={(value) => change("mode", value)} options={[
        { value: "", label: "Not supplied" }, { value: "full_circle", label: "Full circle" }, { value: "partial_circle", label: "Sector" },
      ]} />
      {values.mode === "partial_circle" ? (
        <>
          <View style={styles.fields}>
            <Input inline label="Start angle (degrees)" value={values.startAngleDegrees} onChange={(value) => change("startAngleDegrees", value)} testID="draft-machine-start-angle" />
            <Input inline label="Stop angle (degrees)" value={values.stopAngleDegrees} onChange={(value) => change("stopAngleDegrees", value)} testID="draft-machine-stop-angle" />
          </View>
          <Options label="Sweep direction" value={values.direction} onChange={(value) => change("direction", value)} options={[
            { value: "", label: "Not supplied" }, { value: "clockwise", label: "Clockwise" }, { value: "counterclockwise", label: "Counterclockwise" },
          ]} />
        </>
      ) : null}
      <FormError message={error} />
      <Apply label="Apply machine" onPress={() => attempt(setError, () => {
        const next = parseDraftMachine(values, machine);
        onAction({ type: "set_machine", machine: next });
        if (JSON.stringify(machineInputValues(next)) === JSON.stringify(machineInputValues(machine))) setValues(machineInputValues(machine));
      })} />
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const onLayout = useContext(SectionLayout);
  const section = ({ "Design name": "name", "Coordinate system": "projectCrs", "Pivot center": "pivotCenter", "Water source": "waterSource", "Power source": "powerSource", "Field boundary": "fieldBoundary", "Machine": "machine" } as Record<string, string>)[title];
  return <InputSection.Provider value={section}><View style={styles.section} onLayout={event => { if (section) onLayout?.(section, event.nativeEvent.layout.y); }}><Text accessibilityRole="header" style={styles.title}>{title}</Text>{children}</View></InputSection.Provider>;
}

function Input({ label, value, onChange, disabled = false, multiline = false, inline = false, testID }: {
  label: string; value: string; onChange: (value: string) => void; disabled?: boolean; multiline?: boolean; inline?: boolean; testID: string;
}): React.JSX.Element {
  const panelDisabled = useContext(InputsDisabled);
  const locked = disabled || panelDisabled;
  const rawInputChange = useContext(RawInputChange);
  const registry = useContext(InputRegistry);
  const section = useContext(InputSection);
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!registry || !section || !inputRef.current) return;
    let inputs = registry.current.get(section);
    if (!inputs) { inputs = new Map(); registry.current.set(section, inputs); }
    // Updating an existing Map entry preserves its mounted field order.
    inputs.set(testID, { node: inputRef.current, value, disabled: locked });
  }, [registry, section, testID, value, locked]);
  useEffect(() => () => {
    registry?.current.get(section)?.delete(testID);
  }, [registry, section, testID]);
  return (
    <View style={[styles.field, inline && styles.inlineField]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput ref={inputRef} accessibilityLabel={label} accessibilityState={{ disabled: locked }} editable={!locked} autoCapitalize="none" autoCorrect={false}
        multiline={multiline} textAlignVertical={multiline ? "top" : "center"} value={value} onChangeText={text => { rawInputChange?.(); onChange(text); }}
        style={[styles.input, multiline && styles.textarea, locked && styles.disabled]} testID={testID} />
    </View>
  );
}

function Options<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void;
}): React.JSX.Element {
  const disabled = useContext(InputsDisabled);
  return (
    <View style={styles.optionGroup}>
      <Text style={styles.label}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.options}>
        {options.map((option) => (
          <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={`${label}: ${option.label}`}
            accessibilityState={{ checked: value === option.value, disabled }} disabled={disabled}
            onPress={() => onChange(option.value)} style={[styles.option, disabled && styles.disabled]}>
            {value === option.value ? <CircleDot size={18} color="#254234" /> : <Circle size={18} color="#607067" />}
            <Text style={styles.optionLabel}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Apply({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }): React.JSX.Element {
  const panelDisabled = useContext(InputsDisabled);
  return <View style={styles.commands}><IconCommandButton id={label} label={label} icon={<Check />} showLabel disabled={disabled || panelDisabled} onPress={onPress} /></View>;
}

function FormError({ message }: { message: string | null }): React.JSX.Element | null {
  return message ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null;
}

function attempt(setError: (message: string | null) => void, action: () => void): void {
  try { setError(null); action(); }
  catch (error) { setError(error instanceof Error ? error.message : "The supplied values could not be applied."); }
}

function usePending(section: string, pending: boolean, report: ReportPending): void {
  useEffect(() => { report(section, pending); }, [section, pending, report]);
}

const styles = StyleSheet.create({
  panel: { minWidth: 0, width: "100%" },
  section: { borderTopColor: "#dce3da", borderTopWidth: 1, gap: 8, paddingVertical: 12, minWidth: 0 },
  title: { color: "#26392f", fontSize: 14, fontWeight: "800", letterSpacing: 0 },
  fields: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  field: { flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: "100%", gap: 4 },
  inlineField: { flexBasis: 160 },
  label: { color: "#405448", fontSize: 12, fontWeight: "700", letterSpacing: 0 },
  input: { backgroundColor: "#ffffff", borderColor: "#cdd8ca", borderRadius: 6, borderWidth: 1, color: "#1d2c22", fontSize: 14, letterSpacing: 0, minHeight: 44, minWidth: 0, width: "100%", paddingHorizontal: 10, paddingVertical: 8 },
  textarea: { height: 132 },
  commands: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  spanRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, minWidth: 0 },
  savedItemRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, minWidth: 0 },
  savedItemText: { flex: 1, gap: 2, minWidth: 0 },
  savedItemName: { color: "#26392f", fontSize: 13, fontWeight: "600", letterSpacing: 0 },
  optionGroup: { gap: 4 },
  options: { flexDirection: "row", flexWrap: "wrap", columnGap: 14 },
  option: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, maxWidth: "100%", minWidth: 0 },
  optionLabel: { color: "#314339", fontSize: 12, flexShrink: 1, letterSpacing: 0 },
  status: { color: "#526158", fontSize: 12, letterSpacing: 0 },
  disabled: { opacity: 0.6 },
  error: { color: "#8b1e18", fontSize: 12, lineHeight: 17, letterSpacing: 0 },
});
