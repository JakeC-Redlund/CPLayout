import React, { useLayoutEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { zoomViewport } from "../../geometry/src/mapInteraction";
import { workspaceSceneBounds } from "./workspaceSceneRendering";
import { useWorkspaceMapCamera } from "./useWorkspaceMapCamera";
import type { WorkspaceMapFrameProps } from "./workspaceMapSurfaceTypes";
import type { XY } from "../../core/src/types";

export function WorkspaceMapFrame(props: WorkspaceMapFrameProps): React.JSX.Element {
  const [screen, setScreen] = useState({ width: 0, height: 0 });
  const [readout, setReadout] = useState<XY | null>(null);
  const [cameraCommandGeneration, retireGesture] = useState(0);
  const bounds = useMemo(() => workspaceSceneBounds(props.scene, props.layerVisibility), [props.scene, props.layerVisibility]);
  const cameraKey = JSON.stringify([props.cameraContextKey, props.scene.identity.projectCrs]);
  useLayoutEffect(() => { setReadout(null); }, [props.cameraContextKey, props.scene.identity.projectCrs]);
  const camera = useWorkspaceMapCamera(cameraKey, bounds, screen, props.onCameraChange, props.onRecoveryCameraHandle);
  const button = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityLabel={label}
    disabled={disabled} onPress={onPress} style={[styles.button, disabled && { opacity: 0.45 }]} testID={`workspace-map-${label.toLowerCase().replaceAll(" ", "-")}`}><Text style={styles.buttonText}>{label}</Text></Pressable>;
  return <View style={styles.root} testID="workspace-map-surface" onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    setScreen(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }}>
    {props.renderCanvas({ ...props, viewport: camera.viewport, screen, setViewport: camera.setViewport, onReadout: setReadout,
      cameraCommandGeneration: cameraCommandGeneration + camera.recoveryGeneration })}
    <View style={styles.camera} testID="workspace-map-camera-controls">
      {button("Zoom in", () => { retireGesture(value => value + 1); camera.setViewport(zoomViewport(camera.viewport, 1.5)); })}
      {button("Zoom out", () => { retireGesture(value => value + 1); camera.setViewport(zoomViewport(camera.viewport, 1 / 1.5)); })}
      {button("Fit", () => { retireGesture(value => value + 1); camera.fit(); }, !bounds)}
    </View>
    <ScrollView style={styles.readout} contentContainerStyle={{ padding: 4 }} testID="workspace-map-readout">
      <Text style={styles.meta}>{props.scene.identity.projectCrs ?? "Coordinate system unconfirmed"}</Text>
      <Text style={styles.meta}>{readout ? `X ${readout.x.toFixed(3)} · Y ${readout.y.toFixed(3)}` : `Center X ${camera.viewport.center.x.toFixed(3)} · Y ${camera.viewport.center.y.toFixed(3)}`}</Text>
      <Text style={styles.meta}>View width {(camera.viewport.baseWidthMeters / camera.viewport.zoomLevel).toFixed(2)} XY units · {props.selectedAddress ? "Feature selected" : "No selection"}</Text>
      <Text style={styles.meta}>Purple: drawing · Orange: Survey · Green: target · Blue: observations · Pink: receiver</Text>
      <Text style={styles.meta}>Nominal ring: machine length only; coverage requires calculation.</Text>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, minHeight: 120, minWidth: 0, overflow: "hidden", backgroundColor: "#eef2ec" },
  camera: { position: "absolute", top: 8, right: 8, flexDirection: "row", gap: 4 }, button: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#a9bba8", borderRadius: 5, paddingHorizontal: 10, paddingVertical: 9 },
  buttonText: { color: "#234633", fontWeight: "700", fontSize: 12 }, readout: { position: "absolute", bottom: 5, left: 8, backgroundColor: "rgba(255,255,255,0.88)", borderRadius: 4, maxWidth: "53%", maxHeight: 72 },
  meta: { color: "#304a36", fontSize: 10, lineHeight: 13 } });
