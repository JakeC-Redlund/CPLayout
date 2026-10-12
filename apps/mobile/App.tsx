import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthProvider";
import { AuthenticatedWorkspace } from "./src/auth/AuthenticatedWorkspace";
import { AuthenticatedWorkspaceBridge } from "./src/workspace/AuthenticatedWorkspaceBridge";

/** One working workspace; Design, Survey and Layout are presentation modes. */
export default function App(): React.JSX.Element {
  return <SafeAreaProvider><StatusBar style="dark" /><AuthProvider><AuthenticatedWorkspace>
    {session => session.principal && session.workspaceId
      && session.principal.roles.some(role => role === "operator" || role === "admin")
      && session.access?.workspaces.some(item => item.workspaceId === session.workspaceId && item.permissions.includes("field:read"))
      ? <AuthenticatedWorkspaceBridge key={`${session.principal.id}:${session.workspaceId}`} session={session} /> : null}
  </AuthenticatedWorkspace></AuthProvider></SafeAreaProvider>;
}

export { PivotGpsCoordinateForm, MachineSettingsForm, EndGunSettingsForm, CornerArmSheet,
  ManualDesignTransactionPanel, CalculateSheet, AdvisoryCostReviewPanel, FieldPivotPreviewControls,
  PivotCoordinateForm, ProjectedPolygonEditor, MapFeatureEditor, LayersSheet, HelpTrainingPanel }
  from "./src/workspace/ProjectWorkspaceTools";
