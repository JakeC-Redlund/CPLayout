import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { formatDistance, squareMetersToAcres, type FieldDesign, type FieldPivotMachine } from "@cplayout/core";
import {
  LAYOUT_SEARCH_DEEP_BUDGET, LAYOUT_SEARCH_MODEL_VERSION_V2, LAYOUT_SEARCH_REQUEST_VERSION_V2,
  layoutSearchResultMatches, searchFieldLayoutV2Steps,
  type LayoutSearchProgressV2, type LayoutSearchResultV2, type LayoutSearchTemplate,
} from "@cplayout/geometry";

/** A scenario owns an explicit field revision. Calculation never saves or adopts it. */
export function FieldLayoutSearchPanel({ field, revision, blocked, onAdopt }: {
  field: FieldDesign; revision: number; blocked: boolean;
  onAdopt: (machines: FieldPivotMachine[], expectedRevision: number, unlocked: string[]) => boolean;
}): React.JSX.Element {
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState("8");
  const [result, setResult] = useState<{ value: LayoutSearchResultV2; unlocked: string[] } | null>(null);
  const [progress, setProgress] = useState<LayoutSearchProgressV2 | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => () => { if (run.current) run.current.cancelled = true; run.current = null; }, []);
  useEffect(() => {
    if (run.current) run.current.cancelled = true;
    run.current = null; setRunning(false); setProgress(null);
    setUnlocked(ids => ids.filter(id => field.machines.some(machine => machine.id === id)));
  }, [field, revision]);
  const change = (action: () => void) => {
    if (run.current) run.current.cancelled = true;
    run.current = null; setRunning(false); setProgress(null); setResult(null); setError(null); action();
  };
  async function search(): Promise<void> {
    if (blocked || running) return;
    const owner = { cancelled: false }; run.current = owner;
    setRunning(true); setError(null); setResult(null); setProgress(null);
    try {
      const maxMachines = whole(limit, "Maximum machines", 1, 8);
      const templates: LayoutSearchTemplate[] = [];
      for (const machine of field.machines) {
        const maximumCount = whole(counts[machine.id] ?? "0", "Additional machines", 0, 8);
        if (!maximumCount) continue;
        templates.push({ id: machine.id, machine: { id: machine.id, ...machine.configuration }, maximumCount,
          ...(machine.waterSourceId ? { waterSourceId: machine.waterSourceId } : {}),
          ...(machine.powerSourceId ? { powerSourceId: machine.powerSourceId } : {}),
          ...(machine.sourceFeatureIds ? { sourceFeatureIds: machine.sourceFeatureIds } : {}) });
      }
      if (templates.length > 4) throw new Error("Choose up to four saved machine sizes for additional machines.");
      const allowed = [...unlocked];
      let latest: LayoutSearchProgressV2 | null = null;
      const steps = searchFieldLayoutV2Steps({ schemaVersion: LAYOUT_SEARCH_REQUEST_VERSION_V2, modelVersion: LAYOUT_SEARCH_MODEL_VERSION_V2,
        field, fieldRevision: revision, expectedRevision: revision, templates, unlockedMachineIds: allowed, maxMachines,
        budget: { ...LAYOUT_SEARCH_DEEP_BUDGET } }, { isCancelled: () => owner.cancelled, onProgress: value => { latest = value; } });
      let step = steps.next();
      while (!step.done) {
        const deadline = Date.now() + 8;
        do { step = steps.next(); } while (!step.done && Date.now() < deadline && !owner.cancelled);
        if (run.current === owner) setProgress(latest);
        if (!step.done) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (run.current === owner) { setResult({ value: step.value, unlocked: allowed }); setProgress(null); }
    } catch (failure) { if (run.current === owner) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { if (run.current === owner) { run.current = null; setRunning(false); } }
  }
  const current = result && layoutSearchResultMatches(result.value, { fieldId: field.id, fieldRevision: revision, modelVersion: LAYOUT_SEARCH_MODEL_VERSION_V2 });
  const best = result?.value.best ?? progress?.best;
  const baseline = result?.value.greedyBaseline ?? progress?.greedyBaseline;
  const evaluation = result?.value.evaluations ?? progress?.evaluations;
  const diagnostics = result?.value.diagnostics ?? progress?.diagnostics;
  return <View style={styles.card} testID="field-search-panel">
    <Text style={styles.heading}>Find a better layout</Text>
    <Text style={styles.text}>Look for more watered acres using your saved machine sizes. Saved machines stay in place unless you allow a move. Additional machines use the exact saved equipment; no dimensions are resized. You review the result before changing the field.</Text>
    {field.machines.map(machine => <View key={machine.id} style={styles.row}>
      <View style={styles.grow}><Text style={styles.label}>{machine.configuration.name}</Text>
        <Text style={styles.text}>Keep this machine in place</Text></View>
      <Switch value={!unlocked.includes(machine.id)} disabled={running || blocked} accessibilityLabel={`Keep ${machine.configuration.name} in place`}
        testID={`field-search-unlock-${machine.id}`} onValueChange={value => change(() => setUnlocked(ids => value ? ids.filter(id => id !== machine.id) : [...ids, machine.id]))} />
      <View style={styles.count}><Text style={styles.text}>Add up to</Text><TextInput style={styles.input} value={counts[machine.id] ?? "0"}
        editable={!running && !blocked} accessibilityLabel={`Additional machines matching ${machine.configuration.name}`} testID={`field-search-count-${machine.id}`}
        onChangeText={value => change(() => setCounts(values => ({ ...values, [machine.id]: value })))} /></View>
    </View>)}
    <View style={styles.row}><Text style={styles.label}>Total machine limit (1–8)</Text><TextInput style={[styles.input, styles.count]} value={limit}
      editable={!running && !blocked} accessibilityLabel="Maximum total machines" testID="field-search-limit" onChangeText={value => change(() => setLimit(value))} /></View>
    <Text style={styles.text}>A deeper search can take longer. You can stop anytime and review the best layout found so far.</Text>
    <View style={styles.row}><Action label={running ? "Searching…" : "Find a better layout"} disabled={blocked || running} onPress={() => { void search(); }} id="field-search-run" />
      {running && <Action label="Stop search" onPress={() => { if (run.current) run.current.cancelled = true; }} id="field-search-cancel" />}</View>
    {running && <Text accessibilityLiveRegion="polite" style={styles.text} testID="field-search-progress">
      {evaluation ? `${evaluation.baseCenters} starting locations checked · ${evaluation.total.toLocaleString()} checks` : "Preparing the search…"}
    </Text>}
    {error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
    {(result || best) && <View style={styles.summary} testID="field-search-result">
      <Text style={styles.label}>{result ? terminationLabel(result.value.termination) : "Best found so far"}</Text>
      {result && !current && <Text style={styles.error}>The field changed. Search again before using this result.</Text>}
      {best ? <>
        <Text style={styles.acres} testID="field-search-best">Best found: {best.irrigatedUnionAcres.toFixed(2)} watered acres · {best.machineCount} machines</Text>
        {baseline && <Text style={styles.text}>Extra acres found by deeper search: {Math.max(0, best.irrigatedUnionAcres - baseline.irrigatedUnionAcres).toFixed(2)} acres</Text>}
        <Text style={styles.text}>Overlap: {squareMetersToAcres(best.overlapSquareMeters).toFixed(2)} acres | Extra room beyond required machine separation: {best.minimumPairClearanceMeters === null ? "One machine only" : formatDistance(best.minimumPairClearanceMeters, "us_survey_feet")}</Text>
        <Text style={styles.text}>Equipment cost: {best.cost.amount === null ? "Not available — enter equipment prices to compare costs" : `${best.cost.currencyCode} ${best.cost.amount.toFixed(2)}`}</Text>
        {best.machines.map(item => <Text style={styles.text} key={item.candidateId}>{item.machine.configuration.name} · {item.machine.id}: {item.pinned ? "Saved location kept" : "Proposed location"} · {formatDistance(item.machine.configuration.spanLengthsMeters.reduce((sum, span) => sum + span, 0), "us_survey_feet")} total span length</Text>)}
        <Text style={styles.text}>Watered acres are a layout estimate. Terrain, operating clearance and water delivery still need field checks.</Text>
        <Action label="Use this reviewed layout" disabled={!current || blocked || running} id="field-search-adopt" onPress={() => {
          if (current && result && onAdopt(best.machines.map(item => item.machine), result.value.requestKey.fieldRevision, result.unlocked)) setResult(null);
        }} />
      </> : <Text style={styles.text}>No complete layout meeting the requirements was found. Review the search details below.</Text>}
    </View>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(!detailsOpen)} testID="field-search-details-toggle" style={styles.detailsToggle}>
      <Text style={styles.label}>{detailsOpen ? "Hide search details ▴" : "Search details ▾"}</Text></Pressable>
    {detailsOpen && <View style={styles.summary} testID="field-search-details">
      <Text style={styles.text}>Limits: {LAYOUT_SEARCH_DEEP_BUDGET.maxCandidateCenters} starting locations, {LAYOUT_SEARCH_DEEP_BUDGET.maxEvaluations.toLocaleString()} evaluations, {LAYOUT_SEARCH_DEEP_BUDGET.refinementLevels} refinement levels.</Text>
      <Text style={styles.text}>The result is the best found within these limits; a better layout may still exist.</Text>
      {evaluation && <Text style={styles.text}>{evaluation.candidates} machine checks · {evaluation.combinations} layout checks · {evaluation.completedPrefixes} completed location groups</Text>}
      {diagnostics && <Text style={styles.text}>{diagnostics.combinationCacheHits} repeated layouts reused · {diagnostics.pairChecks} separation checks · {diagnostics.unionCalls} combined-area calculations</Text>}
      {baseline && <Text style={styles.text}>First search method: {baseline.irrigatedUnionAcres.toFixed(2)} acres.</Text>}
      {result && <Text style={styles.text}>Stopped because: {result.value.terminationReason.replaceAll("_", " ")}</Text>}
      {result?.value.rejected.slice(0, 8).map((row, index) => <Text key={index} style={styles.text}>{row.reason.replaceAll("_", " ")} ({row.occurrences})</Text>)}
    </View>}
  </View>;
}
function whole(value: string, label: string, min: number, max: number): number {
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return Number(value);
}
function terminationLabel(value: LayoutSearchResultV2["termination"]): string {
  return { completed: "Search completed", budget_exhausted: "Search limit reached", cancelled: "Search stopped", no_candidate_found: "No layout found", unsupported_inputs: "Inputs need attention", numerical_failure: "Calculation could not finish" }[value];
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
  summary: { gap: 8 }, acres: { color: "#173d2c", fontSize: 17, fontWeight: "700" }, detailsToggle: { paddingVertical: 8, alignSelf: "flex-start" },
});
