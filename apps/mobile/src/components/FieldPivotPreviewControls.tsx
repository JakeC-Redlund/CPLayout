import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { CircleDot, Minus, Plus, TriangleAlert } from "lucide-react-native";
import { formatAreaFromAcres, type AppSettings } from "@cplayout/core";
import type { AdvisoryFieldPivotPlan, AdvisoryMachineRenderModel } from "@cplayout/geometry";
import { IconCommandButton } from "./CommandSurface";
import { ReportNotice, ReportValue, reportStyles } from "./CalculationReport";

export function FieldPivotPreviewControls({ count, onChange, plan, model, settings, failed }: {
  count: number; onChange: (count: number) => void; plan: AdvisoryFieldPivotPlan | null;
  model: AdvisoryMachineRenderModel | null; settings: AppSettings; failed: boolean;
}): React.JSX.Element {
  const area = (acres: number | undefined) => acres === undefined ? "Unavailable" : formatAreaFromAcres(acres, settings.unitSystem);
  return <View style={styles.section} testID="field-pivot-preview-controls">
    <View style={styles.heading}><CircleDot size={20} color="#155c75" /><Text style={styles.title}>Center-pivot layout</Text></View>
    <View style={styles.counter}>
      <Text style={styles.label}>Number of pivots</Text>
      <View style={styles.stepper}>
        <IconCommandButton id="fewer-pivots" label="Fewer preview pivots" icon={<Minus />} disabled={count <= 1}
          onPress={() => onChange(count - 1)} testID="field-pivot-decrease" />
        <Text accessibilityLabel={`${count} requested pivots`} style={styles.count} testID="field-pivot-request-count">{count}</Text>
        <IconCommandButton id="more-pivots" label="More preview pivots" icon={<Plus />} disabled={count >= 4}
          onPress={() => onChange(count + 1)} testID="field-pivot-increase" />
      </View>
    </View>
    <ReportNotice>Proposed layout only. New pivots have not been saved.</ReportNotice>
    {model?.instances.length ? <View testID="field-pivot-outline-summary">
      <ReportValue label="Mapped pivot layouts" value={`${model.instances.length}`} />
      <ReportValue label="Estimated irrigated area" value={area(model.acreLedger.deduplicatedTotalAcres)} />
      <ReportValue label="Overlapping irrigated area" value={area(model.acreLedger.interMachineOverlapFootprintAcres)} />
      <ReportValue label="Additional corner-system area" value={model.instances.some(instance => instance.machine.cornerArm)
        ? area(model.acreLedger.netAddedCornerAcres) : "Not calculated - corner equipment not specified"} />
      <Text style={styles.label}>From mapped pivot outlines. Overlap counted once in the total; not field checked.</Text>
    </View> : null}
    <View style={styles.ledger} accessibilityLiveRegion="polite" testID="field-pivot-preview-status">
      {plan ? <>
        <ReportValue label="Proposed pivot locations" value={`${plan.selectedMachineCount} found / ${plan.requestedMachineCount} requested`} />
        <ReportValue label="Proposed irrigated area" value={area(plan.modeledIrrigatedUnionAcres)} />
        <ReportValue label="Field area not covered" value={area(plan.fieldUnirrigatedAcres)} />
        <Text style={styles.label}>Proposed areas exclude corner-system irrigation.</Text>
        {plan.selectedMachineCount < plan.requestedMachineCount ? <View style={styles.warning}>
          <TriangleAlert size={20} color="#85520d" style={reportStyles.icon} /><Text style={[styles.label, styles.warningText]}>The layout search did not find enough pivot locations with the required separation.</Text>
        </View> : null}
      </> : <Text style={styles.label}>{failed ? "Preview unavailable" : "Calculating preview..."}</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: "#ccd8db", minWidth: 0 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: "#193b46", flexShrink: 1 },
  ledger: { gap: 5 },
  label: { fontSize: 13, lineHeight: 19, color: "#42525a", flexShrink: 1 },
  value: { fontSize: 15, lineHeight: 22, fontWeight: "700", color: "#155c75" },
  counter: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 24, rowGap: 8 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { width: 26, textAlign: "center", fontSize: 18, color: "#193b46", fontWeight: "700" },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  warningText: { color: "#85520d" },
});
