import React from "react";
import { Download, RefreshCw } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ProjectWorkspaceStatus } from "../hooks/useProjectRepository";

export function WorkspaceStorageNotice({ repository }: { repository: ProjectWorkspaceStatus }): React.JSX.Element | null {
  if (!repository.storageError) return null;
  return (
    <View accessibilityRole="alert" style={styles.notice} testID="workspace-storage-error">
      <Text style={styles.message}>{repository.storageError}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry storage" onPress={() => void repository.refreshProjects()} style={styles.action} testID="workspace-storage-retry">
          <RefreshCw size={18} color="#8d2b20" /><Text style={styles.label}>Retry storage</Text>
        </Pressable>
        {repository.canExportWorkspaceRecovery && (
          <Pressable accessibilityRole="button" accessibilityLabel="Export workspace recovery" onPress={() => void repository.exportWorkspaceRecovery()} style={styles.action} testID="workspace-storage-recovery">
            <Download size={18} color="#8d2b20" /><Text style={styles.label}>Export recovery</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { backgroundColor: "#fff2ef", borderBottomWidth: 1, borderColor: "#dba99f", paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  message: { color: "#8d2b20", fontSize: 13, flexShrink: 1 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8 },
  label: { color: "#8d2b20", fontSize: 13, fontWeight: "700" },
});
