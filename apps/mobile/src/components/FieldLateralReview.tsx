import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FieldDesign } from "@cplayout/core";
import { evaluateStraightLateral, type StraightLateralEvaluation } from "@cplayout/geometry";

/** The new persisted kind is visible and calculable without pretending it is a pivot. */
export function FieldLateralReview({ field, revision, blocked }: { field: FieldDesign; revision: number; blocked: boolean }) {
  const [results, setResults] = useState<Record<string, StraightLateralEvaluation>>({});
  const [error, setError] = useState<string | null>(null);
  if (!field.lateralMachines?.length) return null;
  return <View style={styles.card} testID="field-laterals">
    <Text style={styles.heading}>Straight-travel lateral machines</Text>
    <Text style={styles.text}>These saved machines use left and right extents and two travel endpoints. Their exact configurations are retained in field saves and exports. Pivot editing and pivot search do not change them.</Text>
    {field.lateralMachines.map(machine => {
      const result = results[machine.id];
      const current = result?.key.inputRevision === revision && result.key.fieldId === field.id;
      return <View key={machine.id} style={styles.machine}>
        <Text style={styles.label}>{machine.name}</Text>
        <Text style={styles.text}>Left: {machine.leftExtentMeters} m | Right: {machine.rightExtentMeters} m | Travel heading: {machine.travelHeadingDegrees}°</Text>
        <Text style={styles.text}>From ({machine.travel.start.x}, {machine.travel.start.y}) to ({machine.travel.end.x}, {machine.travel.end.y})</Text>
        <Text style={styles.text}>Water source: {machine.waterSourceId ?? "Unassigned"} | Sprinkler reach: {machine.sprinklerReachMeters === undefined ? "Unknown" : `${machine.sprinklerReachMeters} m`}</Text>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: blocked }} disabled={blocked} style={styles.button} testID={`field-lateral-calculate-${machine.id}`} onPress={() => {
          try { const value = evaluateStraightLateral(field, { machineId: machine.id, inputRevision: revision, expectedRevision: revision }); setResults(values => ({ ...values, [machine.id]: value })); setError(null); }
          catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
        }}><Text style={styles.label}>Check straight travel</Text></Pressable>
        {current && result.status === "unsupported" && result.blockers.map((blocker, index) => <Text key={index} style={styles.text}>{blocker.message}</Text>)}
        {current && result.status === "evaluated" && <View testID={`field-lateral-result-${machine.id}`}>
          <Text style={styles.text}>Structural swept area: {result.rawSweptSquareMeters.toFixed(2)} m²</Text>
          <Text style={styles.text}>{result.boundaryConstraint.status === "within_boundary" ? "Buffered travel stays within the field in this model." : "Buffered travel extends outside the field."}</Text>
          <Text style={styles.text}>Hard-obstacle conflicts: {result.mechanicalConstraints.conflicts.length}</Text>
          <Text style={styles.text}>{result.wet.status === "unknown" ? "Potential wet area is unknown without sprinkler reach." : `Potential wet area inside the field after no-spray exclusions: ${(result.wet.clippedSquareMeters / 4046.8564224).toFixed(2)} acres.`}</Text>
          <Text style={styles.text}>Rigid straight travel only. Clearance from other machines, bends, terrain, pressure, flow, nozzles and application performance are unverified.</Text>
        </View>}
      </View>;
    })}
    {error && <Text accessibilityLiveRegion="polite" style={styles.text}>{error}</Text>}
  </View>;
}
const styles = StyleSheet.create({ card: { backgroundColor: "white", borderColor: "#cbd5e1", borderWidth: 1, borderRadius: 8, padding: 14, gap: 10 },
  heading: { color: "#173d2c", fontWeight: "700", fontSize: 18 }, text: { color: "#475569", fontSize: 13 },
  label: { color: "#1e293b", fontWeight: "600" }, machine: { gap: 7 }, button: { alignSelf: "flex-start", padding: 10, borderWidth: 1, borderColor: "#94a3b8", borderRadius: 5 } });
