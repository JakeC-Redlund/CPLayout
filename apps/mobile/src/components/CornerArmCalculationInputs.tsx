import React, { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Calculator, Check, ChevronDown, Info, TriangleAlert } from "lucide-react-native";
import { metersToFeet, VALLEY_CORNER_ARM_SCAFFOLD_CATALOG, type PivotProject } from "@cplayout/core";
import { cornerGuidanceCandidates, type CornerArmInputDraft } from "../advisory/cornerArmInputs";

export function CornerArmCalculationInputs({ project, value, onChange, onRun, missing }: {
  project: PivotProject;
  value: CornerArmInputDraft;
  onChange: (value: CornerArmInputDraft) => void;
  onRun: () => void;
  missing: string[];
}): React.JSX.Element {
  const candidates = cornerGuidanceCandidates(project);
  const model = VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.find(entry => entry.id === value.modelId);
  const feature = candidates.find(entry => entry.id === value.guidanceFeatureId);
  const change = (update: Partial<CornerArmInputDraft>) => onChange({ ...value, ...update });
  return <View style={styles.section} testID="corner-arm-input-form">
    <Text style={styles.heading}>Corner-system inputs</Text>
    <View style={styles.notice}><Info size={20} color="#155c75" style={styles.fixedIcon} /><Text style={styles.note}>Temporary calculation inputs | Project unchanged</Text></View>
    <View style={styles.grid}>
      <View style={styles.field}>
        <Text style={styles.label}>1. Last regular drive tower speed at 100% timer (ft/min)</Text>
        <TextInput accessibilityLabel="Last regular drive tower speed at 100 percent timer in feet per minute" inputMode="decimal"
          value={value.speedUnit === "ft/min" ? value.speed : ""} onChangeText={speed => change({ speed, speedUnit: "ft/min" })} style={styles.input}
          placeholder="Measured ground speed" testID="corner-input-speed" />
      </View>
      <ChoiceMenu label="2. Corner model" id="model" value={value.modelId} onChange={modelId => change({ modelId })}
        options={VALLEY_CORNER_ARM_SCAFFOLD_CATALOG.map(entry => ({ value: entry.id, label: `${entry.label} (unverified catalog)` }))} />
      <ChoiceMenu label="3. Rotation direction" id="rotation" value={value.rotation}
        onChange={rotation => change({ rotation: rotation as CornerArmInputDraft["rotation"] })}
        options={project.machine.sweep.mode === "partial_circle"
          ? [{ value: project.machine.sweep.direction, label: `${project.machine.sweep.direction === "clockwise" ? "Clockwise" : "Counterclockwise"} (saved sweep)` }]
          : [{ value: "clockwise", label: "Clockwise" }, { value: "counterclockwise", label: "Counterclockwise" }]} />
      <ChoiceMenu label="4. Corner orientation" id="orientation" value={value.orientation}
        onChange={orientation => change({ orientation: orientation as CornerArmInputDraft["orientation"] })}
        options={[{ value: "leading", label: "Leading" }, { value: "trailing", label: "Trailing" }]} />
      <ChoiceMenu label="5. Steerable corner tower guidance line" id="guidance" value={value.guidanceFeatureId}
        onChange={guidanceFeatureId => change({ guidanceFeatureId })}
        options={candidates.map(entry => ({ value: entry.id, label: `${entry.name} (${entry.kind.replaceAll("_", " ")})` }))} />
    </View>
    {model ? <View style={styles.notice} testID="corner-input-model-warning"><TriangleAlert size={20} color="#925600" style={styles.fixedIcon} />
      <Text style={styles.warning}>{model.label}: unverified catalog dimensions, {metersToFeet(model.spanLengthMeters).toFixed(2)} ft span + {metersToFeet(model.overhangLengthMeters).toFixed(2)} ft overhang. Not verified equipment specifications.</Text>
    </View> : null}
    {feature ? <Text style={styles.note} testID="corner-input-guidance-note">Selected line: {feature.name} | {feature.confidence.replaceAll("_", " ")} | Guidance suitability unverified</Text> : null}
    {!candidates.length ? <Text style={styles.warning}>No eligible saved lines. Steerable corner tower guidance remains missing.</Text> : null}
    {missing.length ? <View style={styles.notice} accessibilityLiveRegion="polite" testID="corner-input-missing">
      <TriangleAlert size={20} color="#925600" style={styles.fixedIcon} /><Text style={styles.warning}>Required: {missing.join("; ")}</Text>
    </View> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Calculate corner paths" accessibilityState={{ disabled: missing.length > 0 }}
      disabled={missing.length > 0} onPress={onRun} style={[styles.run, missing.length > 0 && styles.disabled]} testID="corner-input-run">
      <Calculator size={19} color="#ffffff" style={styles.fixedIcon} /><Text style={styles.runText}>Calculate corner paths</Text>
    </Pressable>
  </View>;
}

function ChoiceMenu({ id, label, options, value, onChange }: {
  id: string; label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<React.ElementRef<typeof View>>(null);
  const items = useRef<(React.ElementRef<typeof View> | null)[]>([]);
  const choices = [{ value: "", label: "Not selected" }, ...options];
  const selectedLabel = options.find(option => option.value === value)?.label ?? "Not selected";
  const close = () => { setOpen(false); if (Platform.OS === "web") trigger.current?.focus(); };
  const select = (next: string) => { onChange(next); close(); };
  useEffect(() => {
    if (open && Platform.OS === "web") items.current[Math.max(0, choices.findIndex(option => option.value === value))]?.focus();
  }, [open]);
  const keyboard = (index: number) => Platform.OS === "web" ? {
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (delta || event.key === "Home" || event.key === "End") {
        event.preventDefault(); event.stopPropagation();
        const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + delta + choices.length) % choices.length;
        items.current[next]?.focus();
      } else if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault(); event.stopPropagation();
        if (event.key !== "Escape") select(choices[index].value);
      }
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => {
      // React Native Web's modal closes on keyup; consume the submenu Escape first.
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    },
  } : {};
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={`${label}: ${selectedLabel}`} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(!open)} style={styles.choice} testID={`corner-input-${id}`}>
      <Text style={styles.choiceText}>{selectedLabel}</Text><ChevronDown size={18} color="#42525a" style={styles.fixedIcon} />
    </Pressable>
    {open ? <View style={styles.menu} accessibilityRole="menu" accessibilityLabel={label}>
      {choices.map((option, index) => <Pressable key={option.value} ref={node => { items.current[index] = node; }}
        accessibilityRole="menuitem" accessibilityLabel={`${option.label}${option.value === value ? ", selected" : ""}`}
        {...keyboard(index)} onPress={() => select(option.value)} style={styles.option} testID={`corner-option-${id}-${option.value || "none"}`}>
        <View style={styles.check}>{option.value === value ? <Check size={18} color="#155c75" /> : null}</View>
        <Text style={styles.choiceText}>{option.label}</Text>
      </Pressable>)}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderColor: "#ccd8db", minWidth: 0 },
  heading: { fontSize: 18, fontWeight: "700", color: "#193b46" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  field: { flexGrow: 1, flexBasis: 280, minWidth: 0, gap: 7 },
  label: { fontSize: 14, fontWeight: "600", color: "#293e45" },
  input: { minHeight: 46, borderWidth: 1, borderColor: "#83999f", borderRadius: 4, padding: 10, fontSize: 15, color: "#193b46", backgroundColor: "#fff" },
  choice: { minHeight: 46, borderWidth: 1, borderColor: "#83999f", borderRadius: 4, padding: 10, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff" },
  choiceText: { flex: 1, fontSize: 14, lineHeight: 20, color: "#193b46" },
  menu: { borderWidth: 1, borderColor: "#83999f", backgroundColor: "#fff", borderRadius: 4 },
  option: { minHeight: 46, flexDirection: "row", alignItems: "center", padding: 10, gap: 8 },
  check: { width: 18, height: 18 },
  fixedIcon: { flexShrink: 0 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  note: { fontSize: 14, lineHeight: 20, color: "#42525a", flexShrink: 1 },
  warning: { fontSize: 14, lineHeight: 20, color: "#925600", flexShrink: 1 },
  run: { minHeight: 46, alignSelf: "flex-start", maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#155c75", borderRadius: 4 },
  runText: { color: "#fff", fontSize: 14, fontWeight: "700", flexShrink: 1 },
  disabled: { opacity: 0.5 },
});
