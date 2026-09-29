import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { formatDistance, type FieldDesign, type FieldPivotMachine } from "@cplayout/core";
import {
  LAYOUT_SEARCH_MODEL_VERSION, LAYOUT_SEARCH_REQUEST_VERSION, layoutSearchResultMatches, searchFieldLayoutSteps,
  type LayoutSearchResult, type LayoutSearchTemplate,
} from "@cplayout/geometry";

/** A scenario owns an explicit field revision. Calculation never saves or adopts it. */
export function FieldLayoutSearchPanel({ field, revision, blocked, onAdopt }: {
  field: FieldDesign; revision: number; blocked: boolean;
  onAdopt: (machines: FieldPivotMachine[], expectedRevision: number, unlocked: string[]) => boolean;
}): React.JSX.Element {
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState("8");
  const [result, setResult] = useState<{ value: LayoutSearchResult; unlocked: string[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => () => { if (run.current) run.current.cancelled = true; run.current = null; }, []);
  useEffect(() => {
    if (run.current) run.current.cancelled = true;
    run.current = null; setRunning(false);
    setUnlocked(ids => ids.filter(id => field.machines.some(machine => machine.id === id)));
  }, [field, revision]);
  const change = (action: () => void) => {
    if (run.current) run.current.cancelled = true;
    run.current = null; setRunning(false); setResult(null); setError(null); action();
  };
  async function search(): Promise<void> {
    if (blocked || running) return;
    const owner = { cancelled: false }; run.current = owner;
    setRunning(true); setError(null); setResult(null);
    try {
      const maxMachines = whole(limit, "Maximum machines", 1, 8);
      const templates: LayoutSearchTemplate[] = [];
      for (const machine of field.machines) {
        const maximumCount = whole(counts[machine.id] ?? "0", "Optional copies", 0, 8);
        if (!maximumCount) continue;
        templates.push({ id: machine.id, machine: { id: machine.id, ...machine.configuration }, maximumCount,
          ...(machine.waterSourceId ? { waterSourceId: machine.waterSourceId } : {}),
          ...(machine.powerSourceId ? { powerSourceId: machine.powerSourceId } : {}),
          ...(machine.sourceFeatureIds ? { sourceFeatureIds: machine.sourceFeatureIds } : {}) });
      }
      if (templates.length > 4) throw new Error("Choose at most four equipment configurations for optional copies.");
      const allowed = [...unlocked];
      const steps = searchFieldLayoutSteps({ schemaVersion: LAYOUT_SEARCH_REQUEST_VERSION, modelVersion: LAYOUT_SEARCH_MODEL_VERSION,
        field, fieldRevision: revision, expectedRevision: revision, templates, unlockedMachineIds: allowed, maxMachines,
        budget: { maxCandidateCenters: 24, maxEvaluations: 1500, refinementLevels: 3 } }, { isCancelled: () => owner.cancelled });
      let step = steps.next();
      while (!step.done) {
        const deadline = Date.now() + 8;
        do { step = steps.next(); } while (!step.done && Date.now() < deadline && !owner.cancelled);
        if (!step.done) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (run.current === owner) setResult({ value: step.value, unlocked: allowed });
    } catch (failure) { if (run.current === owner) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (run.current === owner) { run.current = null; setRunning(false); } }
  }
  const current = result && layoutSearchResultMatches(result.value, { fieldId: field.id, fieldRevision: revision, modelVersion: LAYOUT_SEARCH_MODEL_VERSION });
  const best = result?.value.best;
  return <View style={styles.card} testID="field-search-panel">
    <Text style={styles.heading}>Compare pivot locations</Text>
    <Text style={styles.text}>Saved machines stay at their current locations unless you allow a move. Optional copies use the exact saved equipment. No dimensions are resized. Comparing does not change the saved field; use the reviewed layout to apply a result.</Text>
    {field.machines.map(machine => <View key={machine.id} style={styles.row}>
      <View style={styles.grow}><Text style={styles.label}>{machine.configuration.name}</Text>
        <Text style={styles.text}>Allow center to move</Text></View>
      <Switch value={unlocked.includes(machine.id)} disabled={running || blocked} accessibilityLabel={`Allow search to move ${machine.configuration.name}`}
        testID={`field-search-unlock-${machine.id}`} onValueChange={value => change(() => setUnlocked(ids => value ? [...ids, machine.id] : ids.filter(id => id !== machine.id)))} />
      <View style={styles.count}><Text style={styles.text}>Optional copies</Text><TextInput style={styles.input} value={counts[machine.id] ?? "0"}
        editable={!running && !blocked} accessibilityLabel={`Maximum optional copies of ${machine.configuration.name}`} testID={`field-search-count-${machine.id}`}
        onChangeText={value => change(() => setCounts(values => ({ ...values, [machine.id]: value })))} /></View>
    </View>)}
    <View style={styles.row}><Text style={styles.label}>Maximum total machines (1–8)</Text><TextInput style={[styles.input, styles.count]} value={limit}
      editable={!running && !blocked} accessibilityLabel="Maximum total machines" testID="field-search-limit" onChangeText={value => change(() => setLimit(value))} /></View>
    <Text style={styles.text}>Search checks up to 24 starting centers and 1,500 evaluations. Results are the best found within this budget. Terrain, hydraulics and field accuracy require separate evidence.</Text>
    <View style={styles.row}><Action label={running ? "Searching…" : "Compare layouts"} disabled={blocked || running} onPress={() => { void search(); }} id="field-search-run" />
      {running && <Action label="Stop search" onPress={() => { if (run.current) run.current.cancelled = true; }} id="field-search-cancel" />}</View>
    {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    {result && <View testID="field-search-result">
      <Text style={styles.label}>{terminationLabel(result.value.termination)} | {result.value.evaluations.total} evaluations</Text>
      {!current && <Text style={styles.error}>The field changed. Compare layouts again before adopting a result.</Text>}
      {best ? <>
        <Text style={styles.text}>Best found: {best.irrigatedUnionAcres.toFixed(2)} net acres | {best.machineCount} machines</Text>
        <Text style={styles.text}>Overlap: {(best.overlapSquareMeters / 4046.8564224).toFixed(2)} acres | Clearance beyond required gap: {best.minimumPairClearanceMeters === null ? "No machine pair" : formatDistance(best.minimumPairClearanceMeters, "us_survey_feet")}</Text>
        <Text style={styles.text}>Equipment cost: {best.cost.amount === null ? "Unavailable — exact equipment prices have not been supplied" : `${best.cost.currencyCode} ${best.cost.amount.toFixed(2)}`}</Text>
        {result.value.greedyBaseline && <Text style={styles.text}>Starting comparison: {result.value.greedyBaseline.irrigatedUnionAcres.toFixed(2)} net acres on this search's candidate set.</Text>}
        {best.machines.map(item => <Text style={styles.text} key={item.candidateId}>{item.machine.configuration.name} · {item.machine.id}: {item.pinned ? "Saved location kept" : "Proposed location"} · {formatDistance(item.machine.configuration.spanLengthsMeters.reduce((sum, span) => sum + span, 0), "us_survey_feet")} total span length</Text>)}
        <Action label="Use this reviewed layout" disabled={!current || blocked || running} id="field-search-adopt" onPress={() => {
          if (current && onAdopt(best.machines.map(item => item.machine), result.value.requestKey.fieldRevision, result.unlocked)) setResult(null);
        }} />
      </> : <Text style={styles.text}>No eligible complete layout was found.</Text>}
      {result.value.rejected.slice(0, 8).map((row, index) => <Text key={index} style={styles.text}>{row.reason.replaceAll("_", " ")} ({row.occurrences})</Text>)}
    </View>}
  </View>;
}
function whole(value: string, label: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return Number(value);
}
function terminationLabel(value: LayoutSearchResult["termination"]): string {
  return { completed: "Search completed", budget_exhausted: "Search budget reached", cancelled: "Search stopped", no_candidate_found: "No candidate found", unsupported_inputs: "Inputs need attention", numerical_failure: "Calculation could not finish" }[value];
}
function Action({ label, onPress, disabled, id }: { label: string; onPress: () => void; disabled?: boolean; id: string }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={id} style={[styles.button, disabled && { opacity: 0.45 }]}><Text style={styles.label}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: "white", borderColor: "#cbd5e1", borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  heading: { color: "#173d2c", fontWeight: "700", fontSize: 18 }, text: { color: "#475569", fontSize: 13, flexShrink: 1 }, label: { color: "#1e293b", fontWeight: "600", flexShrink: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }, grow: { flexGrow: 1, flexBasis: 180 }, count: { width: 105 },
  input: { borderWidth: 1, borderColor: "#94a3b8", borderRadius: 4, padding: 8, color: "#0f172a", backgroundColor: "white" },
  button: { padding: 10, borderWidth: 1, borderColor: "#94a3b8", borderRadius: 5 }, error: { color: "#9f1239", fontSize: 13 },
});
