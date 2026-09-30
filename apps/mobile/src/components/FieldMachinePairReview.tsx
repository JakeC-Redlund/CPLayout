import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatDistance, type FieldDesign } from "@cplayout/core";
import { evaluateFieldMachinePairs, machinePairAssessmentMatches, type FieldMachinePairAssessment } from "@cplayout/geometry";

export function FieldMachinePairReview({ field, revision, blocked }: { field: FieldDesign; revision: number; blocked: boolean }) {
  const [result, setResult] = useState<FieldMachinePairAssessment | null>(null);
  const [failed, setFailed] = useState(false);
  if (field.machines.length + (field.lateralMachines?.length ?? 0) < 2) return null;
  const current = result !== null && machinePairAssessmentMatches(result, { fieldId: field.id, inputRevision: revision });
  const names = new Map([...field.machines.map(machine => [machine.id, machine.configuration.name] as const),
    ...(field.lateralMachines ?? []).map(machine => [machine.id, machine.name] as const)]);
  return <View style={styles.card} testID="field-machine-clearance">
    <Text style={styles.heading}>Room between machines</Text>
    <Text style={styles.text}>Check the space needed as pivots turn and straight-travel laterals move.</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked }} disabled={blocked}
      testID="field-machine-clearance-check" style={styles.button} onPress={() => {
        try { setResult(evaluateFieldMachinePairs(field, { inputRevision: revision, expectedRevision: revision })); setFailed(false); }
        catch { setResult(null); setFailed(true); }
      }}><Text style={styles.label}>Check machine clearance</Text></Pressable>
    {failed && <Text accessibilityLiveRegion="polite" style={styles.text}>Check the saved machine details before trying again.</Text>}
    {result && !current && <Text style={styles.text}>The field changed. Check clearance again.</Text>}
    {current && result.status === "unsupported" && <Text style={styles.text}>Clearance could not be checked. Confirm the field coordinates and machine details.</Text>}
    {current && result.status === "evaluated" && <View testID="field-machine-clearance-result" style={styles.rows}>
      {result.pairs.map(pair => <View key={JSON.stringify([pair.leftMachineId, pair.rightMachineId])} style={styles.row}>
        <Text style={styles.label}>{names.get(pair.leftMachineId)} / {names.get(pair.rightMachineId)}</Text>
        <Text style={styles.text}>{pair.status === "separated"
          ? `The modeled paths stay apart, with ${formatDistance(pair.clearanceBeyondRequiredMeters!, "us_survey_feet")} beyond the required gap.`
          : pair.status === "possible_sweep_overlap"
            ? "The paths or required clearance may overlap. Review their movement before using this layout."
            : pair.reasons.includes("corner_complete_motion_unresolved")
              ? "Corner-arm movement needs a separate check; clearance is unknown."
              : "More machine or field information is needed; clearance is unknown."}</Text>
      </View>)}
      <Text style={styles.text}>This compares the space machines can move through. It does not check when they operate, ground conditions or actual machine movement.</Text>
    </View>}
  </View>;
}
const styles = StyleSheet.create({
  card: { backgroundColor: "white", borderColor: "#cbd5e1", borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  heading: { color: "#173d2c", fontWeight: "700", fontSize: 18 },
  text: { color: "#475569", fontSize: 13 }, label: { color: "#1e293b", fontWeight: "600" },
  rows: { gap: 12 }, row: { gap: 4 },
  button: { alignSelf: "flex-start", padding: 10, borderWidth: 1, borderColor: "#94a3b8", borderRadius: 5 },
});
