import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { CircleAlert, Info, TriangleAlert } from "lucide-react-native";

type Tone = "neutral" | "good" | "warn" | "danger";

export function ReportValue({ label, value, tone = "neutral", testID }: {
  label: string; value: string; tone?: Tone; testID?: string;
}): React.JSX.Element {
  return <View style={reportStyles.row} testID={testID}>
    <Text style={reportStyles.label}>{label}</Text>
    <View style={reportStyles.valueCell}>
      {tone === "warn" ? <TriangleAlert size={18} color="#85520d" style={reportStyles.icon} /> : null}
      {tone === "danger" ? <CircleAlert size={18} color="#a32828" style={reportStyles.icon} /> : null}
      <Text style={[reportStyles.value, tone === "warn" && reportStyles.warning, tone === "danger" && reportStyles.danger]}>{value}</Text>
    </View>
  </View>;
}

export function ReportNotice({ children, tone = "neutral", testID }: {
  children: React.ReactNode; tone?: Tone; testID?: string;
}): React.JSX.Element {
  const color = tone === "danger" ? "#a32828" : tone === "warn" ? "#85520d" : "#42525a";
  const Icon = tone === "danger" ? CircleAlert : tone === "warn" ? TriangleAlert : Info;
  return <View style={reportStyles.notice} testID={testID}>
    <Icon size={20} color={color} style={reportStyles.icon} />
    <Text style={[reportStyles.note, { color }]}>{children}</Text>
  </View>;
}

export function ReportField({ label, value, onChangeText, testID, text = false }: {
  label: string; value: string; onChangeText: (value: string) => void; testID: string; text?: boolean;
}): React.JSX.Element {
  return <View style={reportStyles.field}>
    <Text style={reportStyles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} inputMode={text ? "text" : "decimal"}
      onChangeText={onChangeText} value={value} testID={testID} style={reportStyles.input} />
  </View>;
}

export const reportStyles = StyleSheet.create({
  section: { paddingVertical: 20, borderBottomWidth: 1, borderColor: "#bcc8cc", gap: 12, minWidth: 0 },
  heading: { fontSize: 18, fontWeight: "700", color: "#193b46" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 20, rowGap: 6,
    paddingVertical: 9, borderBottomWidth: 1, borderColor: "#e0e6e8", minWidth: 0 },
  label: { flexBasis: 220, flexGrow: 1, flexShrink: 1, fontSize: 14, lineHeight: 20, color: "#42525a" },
  valueCell: { flexBasis: 200, flexGrow: 1, flexShrink: 1, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  value: { fontSize: 15, lineHeight: 21, fontWeight: "600", color: "#193b46", flexShrink: 1 },
  note: { fontSize: 14, lineHeight: 21, color: "#42525a", flexShrink: 1 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 8, minWidth: 0 },
  icon: { flexShrink: 0 },
  warning: { color: "#85520d" },
  danger: { color: "#a32828" },
  field: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 20, rowGap: 6, paddingVertical: 5 },
  input: { flexBasis: 200, flexGrow: 1, flexShrink: 1, minWidth: 0, minHeight: 44, padding: 10,
    borderWidth: 1, borderColor: "#83999f", borderRadius: 3, fontSize: 15, color: "#193b46", backgroundColor: "#fff" },
});
