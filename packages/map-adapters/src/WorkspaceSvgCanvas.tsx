import React, { useLayoutEffect, useMemo, useRef } from "react";
import { PanResponder, Platform, View, Text, StyleSheet } from "react-native";
import Svg, { Circle, G, Polygon, Polyline, Text as SvgText } from "react-native-svg";
import { panViewportByScreenDelta, screenPointToWorld } from "../../geometry/src/mapInteraction";
import { createWorkspaceGestureSession, workspaceGeometryPoints, workspaceHitTest, workspacePointToScreen, workspaceRenderPrimitives } from "./workspaceSceneRendering";
import type { WorkspaceCanvasProps } from "./workspaceMapSurfaceTypes";

export function WorkspaceSvgCanvas(props: WorkspaceCanvasProps & { readonly reason?: string }): React.JSX.Element {
  const surface = useRef<View>(null);
  const [gesture] = React.useState(createWorkspaceGestureSession);
  const current = useRef(props);
  const held = useRef<{ id: number; x: number; y: number; viewport: WorkspaceCanvasProps["viewport"] } | null>(null);
  useLayoutEffect(() => { current.current = props; });
  useLayoutEffect(() => { gesture.cancel(); held.current = null; }, [props.interactionKey, props.cameraContextKey, props.scene.identity.projectCrs, props.cameraCommandGeneration, gesture]);
  const activate = (position: { x: number; y: number }) => {
    const state = current.current;
    if (position.x < 0 || position.y < 0 || position.x > state.screen.width || position.y > state.screen.height) return;
    const point = screenPointToWorld(state.viewport, { xPixels: position.x, yPixels: position.y }, { widthPixels: state.screen.width, heightPixels: state.screen.height });
    state.onReadout(point);
    if (state.pointInputEnabled && state.onPoint) state.onPoint({ point, cameraContextKey: state.cameraContextKey, interactionKey: state.interactionKey });
    else if (state.selectionEnabled !== false) state.onSelect?.({ address: workspaceHitTest(workspaceRenderPrimitives(state.scene, state.layerVisibility), state.viewport, state.screen, position), cameraContextKey: state.cameraContextKey, interactionKey: state.interactionKey });
  };
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const node = surface.current as unknown as HTMLElement | null;
    if (!node || !node.ownerDocument) return;
    const win = node.ownerDocument.defaultView;
    const position = (event: PointerEvent) => { const rect = node.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => {
      if (gesture.begin(event, current.current, position(event), node.contains(event.target as Node))) held.current = { id: event.pointerId, x: event.clientX, y: event.clientY, viewport: current.current.viewport };
      else held.current = null;
    };
    const move = (event: PointerEvent) => {
      const start = held.current;
      if (!start || start.id !== event.pointerId) return;
      const pos = position(event);
      if (gesture.move(event.pointerId, pos)) current.current.setViewport(panViewportByScreenDelta(start.viewport, event.clientX - start.x, event.clientY - start.y, current.current.screen.width, current.current.screen.height));
    };
    const end = (event: PointerEvent) => { if (gesture.end(event.pointerId, current.current, event.type === "pointercancel")) activate(position(event)); held.current = null; };
    const clear = () => { gesture.clear(); held.current = null; };
    const visibility = () => { if (node.ownerDocument.hidden) clear(); };
    win?.addEventListener("pointerdown", down, true); win?.addEventListener("pointermove", move); win?.addEventListener("pointerup", end); win?.addEventListener("pointercancel", end); win?.addEventListener("blur", clear); node.ownerDocument.addEventListener("visibilitychange", visibility);
    return () => { clear(); win?.removeEventListener("pointerdown", down, true); win?.removeEventListener("pointermove", move); win?.removeEventListener("pointerup", end); win?.removeEventListener("pointercancel", end); win?.removeEventListener("blur", clear); node.ownerDocument.removeEventListener("visibilitychange", visibility); };
  }, [gesture]);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event, movement) => {
      const id = movement.stateID;
      const position = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      if (event.nativeEvent.touches.length !== 1 || !gesture.begin({ pointerId: id, isPrimary: true, button: 0 }, current.current, position)) { gesture.cancel(); held.current = null; return; }
      held.current = { id, x: position.x, y: position.y, viewport: current.current.viewport };
    },
    onPanResponderMove: (event, movement) => {
      const start = held.current;
      if (!start || event.nativeEvent.touches.length !== 1) { gesture.cancel(); held.current = null; return; }
      if (gesture.move(start.id, { x: start.x + movement.dx, y: start.y + movement.dy })) current.current.setViewport(panViewportByScreenDelta(start.viewport, movement.dx, movement.dy, current.current.screen.width, current.current.screen.height));
    },
    onPanResponderRelease: (event, movement) => {
      const start = held.current;
      if (start && gesture.end(start.id, current.current)) activate({ x: start.x + movement.dx, y: start.y + movement.dy });
      gesture.clear(); held.current = null;
    },
    onPanResponderTerminate: () => { gesture.clear(); held.current = null; },
  }), [gesture]);
  const primitives = workspaceRenderPrimitives(props.scene, props.layerVisibility);
  const width = Math.max(1, props.screen.width), height = Math.max(1, props.screen.height);
  return <View ref={surface} style={[styles.root, Platform.OS === "web" && ({ touchAction: "none", userSelect: "none" } as never)]}
    {...(Platform.OS !== "web" ? responder.panHandlers : {})} testID="workspace-map-svg-renderer">
    <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" pointerEvents={Platform.OS === "web" ? "auto" : "none"}>
      {primitives.map(primitive => {
        const points = workspaceGeometryPoints(primitive.geometry).map(point => workspacePointToScreen(point, props.viewport, props.screen));
        const selected = primitive.sourceAddress === props.selectedAddress;
        const vertices = points.map(point => `${point.x},${point.y}`).join(" ");
        const closed = primitive.geometry.type === "Circle" || (primitive.geometry.type === "Polygon" && points.length >= 3);
        return <G key={primitive.address}>
          {points.length === 1 ? <Circle cx={points[0].x} cy={points[0].y} r={selected ? 8 : 5} fill={primitive.color} stroke="#fff" />
            : closed ? <Polygon points={vertices} fill={primitive.color} fillOpacity={primitive.nominal ? 0.035 : 0.12} stroke={primitive.color} strokeWidth={selected ? 4 : 2} strokeDasharray={primitive.nominal ? "5 4" : undefined} />
              : <Polyline points={vertices} fill="none" stroke={primitive.color} strokeWidth={selected ? 4 : 2} />}
          {primitive.geometry.type === "Pending" && points.length > 1 && points.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={4} fill={primitive.color} stroke="#fff" />)}
          {primitive.label && points[0] && <SvgText x={points[0].x + 9} y={points[0].y - 9} fontSize={12} fill={primitive.color}>{primitive.label}</SvgText>}
        </G>;
      })}
    </Svg>
    {props.reason && <Text pointerEvents="none" style={styles.notice} testID="workspace-map-fallback-status">{props.reason}</Text>}
  </View>;
}
const styles = StyleSheet.create({ root: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "#eef2ec" }, notice: { position: "absolute", left: 8, top: 46, right: 8, color: "#73531d", backgroundColor: "rgba(255,255,255,0.9)", padding: 5, fontSize: 11 } });
