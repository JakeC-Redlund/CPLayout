import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Polygon, Text as SvgText } from "react-native-svg";
import { formatDistance, sha256Text, type FieldDesign, type FieldPivotMachine } from "@cplayout/core";
import { fieldCoordinatesInFeet } from "./fieldMachineInputs";
import { compareMachinePlan, machinePlanPreviewFrame, type MachineValueChange } from "./machinePlanComparison";

const labels: Record<string, string> = {
  configuration: "Equipment", name: "Machine name", spanLengthsMeters: "Span", overhangMeters: "Overhang",
  endGunThrowMeters: "End gun reach", endGunAngleRanges: "End gun watering range", towerClearanceBufferMeters: "Tower clearance",
  machineClearanceBufferMeters: "Machine clearance", sweep: "Sweep", mode: "Type", startAngleDegrees: "Start angle",
  stopAngleDegrees: "Stop angle", direction: "Rotation", catalogSelection: "Catalog equipment", catalogId: "Catalog reference",
  manufacturer: "Manufacturer", model: "Model", sourceUrl: "Source", sourceAccessedAt: "Source checked",
  cornerArm: "Corner arm", driveUnits: "Drive units", lrdu: "LRDU", sdu: "SDU", kind: "Machine type",
  pivotObservationId: "Survey location reference", waterSourceId: "Water source", powerSourceId: "Power source",
  cornerGuidanceFeatureId: "Corner guidance path", sourceFeatureIds: "Source map feature",
};
function label(path: string): string {
  const keys = path.split(".").filter(key => key !== "configuration");
  return keys.map(key => /^\d+$/.test(key) ? `${Number(key) + 1}` : labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")).join(" · ");
}
function value(value: unknown, path: string): string {
  if (value === undefined) return "Not set";
  if (typeof value === "number") {
    if (/Meters(?:\.\d+)?$/.test(path)) return formatDistance(value, "us_survey_feet");
    if (/Degrees$/.test(path)) return `${value}°`;
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "string" ? /(?:mode|direction|kind)$/.test(path) ? value.replace(/_/g, " ") : value : JSON.stringify(value);
}
function changeText(change: MachineValueChange): string {
  const before = value(change.before, change.path); const after = value(change.after, change.path);
  return `${label(change.path)}: ${before} → ${after}${before === after ? " (small change below displayed precision)" : ""}`;
}

/** Proposed locations are rendered independently from the active drawing. This component never adopts. */
export function MachinePlanComparison({ field, proposed, revision, sourceName, sourceDetail, testID }: {
  field: FieldDesign; proposed: readonly FieldPivotMachine[]; revision: number;
  sourceName: string; sourceDetail?: string; testID: string;
}): React.JSX.Element {
  const [exactOpen, setExactOpen] = useState(false);
  const comparison = useMemo(() => compareMachinePlan(field.machines, proposed), [field.machines, proposed]);
  const snapshot = useMemo(() => sha256Text(JSON.stringify(proposed)).slice(0, 12), [proposed]);
  const screen = machinePlanPreviewFrame(field.fieldBoundary, field.machines, proposed);
  const coordinatesInFeet = fieldCoordinatesInFeet(field);
  const location = (machine: FieldPivotMachine) => coordinatesInFeet
    ? `X ${formatDistance(machine.pivotCenter.x, "us_survey_feet")}, Y ${formatDistance(machine.pivotCenter.y, "us_survey_feet")}`
    : `X ${machine.pivotCenter.x}, Y ${machine.pivotCenter.y} (project coordinates; units unconfirmed)`;
  const count = (status: string) => comparison.filter(item => item.status === status).length;
  return <View style={styles.review} testID={testID}>
    <Text style={styles.title}>{sourceName} · {field.name}</Text>
    <Text selectable style={styles.meta} testID={`${testID}-source`}>Review revision {revision} · Proposal {snapshot}{sourceDetail ? ` · ${sourceDetail}` : ""}</Text>
    <View style={styles.previews}>
      {([{ title: "Current", machines: field.machines, key: "current", color: "#58695e" },
        { title: "Proposed", machines: proposed, key: "proposed", color: "#236b89" }] as const).map(panel => <View style={styles.preview} key={panel.key} testID={`${testID}-${panel.key}`}>
        <Text style={styles.title}>{panel.title} · {panel.machines.length} machines</Text>
        {screen ? <Svg viewBox="0 0 220 124" width="100%" height={124} accessibilityLabel={`${panel.title} machine locations, same field scale`}>
          {field.fieldBoundary.length >= 3 && <Polygon points={field.fieldBoundary.map(point => { const p = screen(point); return `${p.x},${p.y}`; }).join(" ")} fill="#e4ece0" stroke="#849b81" strokeWidth={1.2} />}
          {field.obstacles.map(obstacle => <Polygon key={obstacle.id} points={obstacle.polygon.map(point => { const p = screen(point); return `${p.x},${p.y}`; }).join(" ")} fill="#e7d5c9" stroke="#a58370" strokeWidth={1} />)}
          {panel.machines.map(machine => { const p = screen(machine.pivotCenter); const number = comparison.findIndex(item => item.id === machine.id) + 1;
            return <React.Fragment key={machine.id}><Circle cx={p.x} cy={p.y} r={4} fill={panel.color} testID={`${testID}-${panel.key}-location-${machine.id}`} />
              <SvgText x={p.x + 6} y={p.y - 5} fontSize={10} fill={panel.color}>{number}</SvgText></React.Fragment>;
          })}
        </Svg> : <Text style={styles.meta}>No machine locations</Text>}
      </View>)}
    </View>
    <Text style={styles.meta}>Same scale. Dots show pivot centers; watered acreage is reviewed separately.</Text>
    <Text style={styles.title} testID={`${testID}-summary`}>{count("added")} added · {count("moved")} moved · {count("removed")} removed · {count("updated")} changed in place · {count("unchanged")} unchanged</Text>
    {comparison.map((item, index) => <View style={styles.machine} key={item.id} testID={`${testID}-machine-${item.id}`}>
      <Text style={styles.title}>{index + 1}. {item.name} · {item.status === "updated" ? "Changed in place" : item.status[0].toUpperCase() + item.status.slice(1)}</Text>
      {item.status !== "unchanged" && <>
        <Text style={styles.meta}>Current: {item.current ? location(item.current) : "New machine"}</Text>
        <Text style={styles.meta}>Proposed: {item.proposed ? location(item.proposed) : "Removed from this field"}</Text>
        {item.moved && item.current && item.proposed && location(item.current) === location(item.proposed) && <Text style={styles.meta}>Center moved by less than the displayed precision. Open exact values below to review it.</Text>}
        {item.values.map(change => <Text key={change.path} style={styles.meta}>{changeText(change)}</Text>)}
        {!item.values.length && <Text style={styles.meta}>Equipment and source connections unchanged.</Text>}
      </>}
    </View>)}
    {comparison.some(item => item.status !== "unchanged") && <>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: exactOpen }} onPress={() => setExactOpen(open => !open)} testID={`${testID}-exact-toggle`} style={styles.disclosure}>
        <Text style={styles.title}>{exactOpen ? "Hide exact values ▴" : "Exact values ▾"}</Text>
      </Pressable>
      {exactOpen && <View style={styles.machine} testID={`${testID}-exact`}>
        <Text style={styles.meta}>Stored dimensions are shown in meters without rounding. Main readings above use feet.</Text>
        {comparison.filter(item => item.status !== "unchanged").map(item => <View key={item.id} style={styles.machine}>
          <Text style={styles.title}>{item.name}</Text>
          {(item.moved || item.status === "added" || item.status === "removed") && <>
            <Text selectable style={styles.meta}>Current center: {item.current ? `X ${item.current.pivotCenter.x}, Y ${item.current.pivotCenter.y}${coordinatesInFeet ? " m" : " (project coordinates; units unconfirmed)"}` : "New machine"}</Text>
            <Text selectable style={styles.meta}>Proposed center: {item.proposed ? `X ${item.proposed.pivotCenter.x}, Y ${item.proposed.pivotCenter.y}${coordinatesInFeet ? " m" : " (project coordinates; units unconfirmed)"}` : "Removed"}</Text>
          </>}
          {item.values.filter(change => typeof change.before === "number" || typeof change.after === "number").map(change => {
            const exact = (input: unknown) => input === undefined ? "Not set" : `${String(input)}${/Meters(?:\.\d+)?$/.test(change.path) ? " m" : /Degrees$/.test(change.path) ? "°" : ""}`;
            return <Text selectable key={change.path} style={styles.meta}>{label(change.path)}: {exact(change.before)} → {exact(change.after)}</Text>;
          })}
        </View>)}
      </View>}
    </>}
  </View>;
}
const styles = StyleSheet.create({
  review: { gap: 7 }, title: { color: "#284e34", fontSize: 13, fontWeight: "600" },
  meta: { color: "#586358", fontSize: 12, lineHeight: 17 }, previews: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  preview: { flexBasis: 155, flexGrow: 1, padding: 7, backgroundColor: "#f0f4ed", borderRadius: 6 },
  machine: { gap: 3, borderTopWidth: 1, borderTopColor: "#d8e0d5", paddingTop: 6 },
  disclosure: { paddingVertical: 7, alignSelf: "flex-start" },
});
