import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { UnifiedWorkspaceEntry } from "./src/workspace/UnifiedWorkspaceEntry";

/** One working workspace; Design, Survey and Layout are presentation modes. */
export default function App(): React.JSX.Element {
  return <SafeAreaProvider><StatusBar style="dark" /><UnifiedWorkspaceEntry /></SafeAreaProvider>;
}

export { PivotGpsCoordinateForm, MachineSettingsForm, EndGunSettingsForm, CornerArmSheet,
  ManualDesignTransactionPanel, CalculateSheet, AdvisoryCostReviewPanel, FieldPivotPreviewControls,
  PivotCoordinateForm, ProjectedPolygonEditor, MapFeatureEditor, LayersSheet, HelpTrainingPanel }
  from "./src/workspace/ProjectWorkspaceTools";
