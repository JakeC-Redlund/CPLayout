import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

export type PrimaryTask = "projects" | "design" | "survey" | "layout";
const tasks: { id: PrimaryTask; label: string; hint: string }[] = [
  { id: "projects", label: "Projects", hint: "Customers, projects, fields and saved designs" },
  { id: "design", label: "Design", hint: "Resume drawing, machine inputs and calculations" },
  { id: "survey", label: "Survey", hint: "Collect receiver evidence for the open design" },
  { id: "layout", label: "RTK Layout", hint: "Frozen targets and separately saved field observations" },
];
export function PrimaryTaskNavigation({ task, onNavigate }: { task: PrimaryTask; onNavigate: (task: PrimaryTask) => void }) {
  return <View accessibilityLabel="Workspace tasks" style={styles.bar} testID="primary-task-navigation">
    {tasks.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label}
      accessibilityHint={item.hint} accessibilityState={{ selected: task === item.id }}
      {...(Platform.OS === "web" && task === item.id ? { "aria-current": "page" as const } : {})}
      onPress={() => onNavigate(item.id)} style={[styles.tab, task === item.id && styles.selected]} testID={`task-${item.id}`}>
      <Text style={[styles.label, task === item.id && styles.activeLabel]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: "#edf2e9", borderBottomWidth: 1, borderColor: "#b8c8b4", flexShrink: 0 },
  tab: { flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", paddingHorizontal: 5, borderBottomWidth: 3, borderColor: "transparent" },
  selected: { backgroundColor: "#fff", borderColor: "#285945" },
  label: { color: "#4d5c50", fontSize: 13, fontWeight: "600" },
  activeLabel: { color: "#173e2b", fontWeight: "800" },
});
