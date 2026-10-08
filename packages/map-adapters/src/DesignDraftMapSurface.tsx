import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Polygon, Polyline, Text as SvgText } from "react-native-svg";
import { Check, Hand, Info, MapPin, Minus, Pause, Pentagon, Play, Plus, Scan, Spline, TriangleAlert, Undo2, X, type LucideIcon } from "lucide-react-native";
import { draftDrawingFinishError, type DesignDraft, type DraftDrawingCommand, type DraftDrawingGeometryType, type ProjectMapFeatureGeometry, type XY } from "@cplayout/core";
import {
  panViewportByScreenDelta, screenPointToWorld, viewportToSvgViewBox, zoomViewport,
  type MapViewport,
} from "@cplayout/geometry";
import { finitePointBounds, fitProjectedBounds, viewportForScreen } from "./mapFit";
import { trackMapPointers } from "./mapPointerGuard";
import { draftMeasurementText } from "./mapTools";
import { createSvgSymbolScale, placeMapLabels, visiblePathLabelPoint, type MapLabelCandidate } from "./svgMapLabels";
import {
  designDraftBounds, draftDrawingAllowed, draftPointFromInverseCtm,
} from "./designDraftMap";

export interface DesignDraftMapSurfaceProps {
  draft: DesignDraft;
  onDrawing: (command: DraftDrawingCommand) => void;
  disabled?: boolean;
}

const emptyCamera: MapViewport = { center: { x: 0, y: 0 }, baseWidthMeters: 1000, baseHeightMeters: 1000, zoomLevel: 1 };
const frameInsets = { top: 78, right: 12, bottom: 190, left: 12 };

/** Session identity changes retire all temporary pointer, capture, and camera state. */
export function DesignDraftMapSurface(props: DesignDraftMapSurfaceProps): React.JSX.Element {
  return <DraftSurfaceSession key={JSON.stringify([props.draft.id, props.draft.projectCrs])} {...props} />;
}

function DraftSurfaceSession({ draft, onDrawing, disabled = false }: DesignDraftMapSurfaceProps): React.JSX.Element {
  const [screen, setScreen] = useState({ width: 640, height: 480 });
  const [bottomHeight, setBottomHeight] = useState(180);
  const [captureHeight, setCaptureHeight] = useState(0);
  const bounds = useMemo(() => {
    const committed = designDraftBounds(draft);
    return finitePointBounds([
      ...(committed ? [{ x: committed.minX, y: committed.minY }, { x: committed.maxX, y: committed.maxY }] : []),
      ...(draft.drawingWorkflow?.captures.flatMap(item => item.vertices.map(vertex => vertex.point)) ?? []),
    ]);
  }, [draft]);
  const [camera, setCamera] = useState<MapViewport>(() => bounds
    ? fitProjectedBounds(bounds, screen, frameInsets) ?? emptyCamera : emptyCamera);
  const viewport = useMemo(() => viewportForScreen(camera, screen) ?? camera, [camera, screen]);
  // Only the camera and armed tool are local. Every captured vertex lives in the draft.
  const [armed, setArmed] = useState<DraftDrawingGeometryType | null>(() =>
    !draft.drawingWorkflow && draft.fieldBoundary.length === 0 ? "Polygon" : null);
  const active = draft.drawingWorkflow?.captures.find(item => item.id === draft.drawingWorkflow?.activeCaptureId);
  const geometryType = active?.geometryType ?? armed;
  const vertices = active?.vertices.map(item => item.point) ?? [];
  const paused = draft.drawingWorkflow?.captures.filter(item => item.id !== active?.id) ?? [];
  const [message, setMessage] = useState<string | null>(null);
  const surface = useRef<View>(null);
  const pointerAllowed = useRef(false);
  const sequence = useRef(0);
  const crsAllowed = draftDrawingAllowed(draft.projectCrs);
  const allowed = crsAllowed && !disabled;
  const validation = geometryType ? draftDrawingFinishError(geometryType, vertices) : null;
  const symbols = createSvgSymbolScale(viewport, screen.width);

  function capture(point: XY) {
    if (!allowed || !geometryType || active?.stage === "classification" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    setMessage(null);
    if (active && geometryType === "Polygon" && vertices.length >= 3
      && Math.hypot(point.x - vertices[0].x, point.y - vertices[0].y) <= symbols.px(12)) {
      if (validation) { setMessage(validation); return; }
      onDrawing({ type: "finish", id: active.id });
      return;
    }
    if (geometryType === "Point" && vertices.length > 0) {
      setMessage("Finish this point or remove it before choosing a different position."); return;
    }
    if (vertices.at(-1)?.x === point.x && vertices.at(-1)?.y === point.y) return;
    const id = active?.id ?? `drawing-${Date.now()}-${++sequence.current}`;
    if (!active) onDrawing({ type: "begin", id, geometryType,
      name: geometryType === "Polygon" && draft.fieldBoundary.length === 0 ? "Field boundary" : `${geometryType === "LineString" ? "Line" : geometryType} drawing` });
    onDrawing({ type: "append_vertex", id, vertex: { point: { ...point }, recordedAt: new Date().toISOString(), wgs84: null, elevation: null } });
  }

  const interaction = useRef({ viewport, screen, capture });
  interaction.current = { viewport, screen, capture };
  const cancelGesture = useRef<() => void>(() => {});

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const svg = (surface.current as unknown as Element | null)?.querySelector("svg");
    if (!svg) return;
    svg.style.touchAction = "none";
    const ownerWindow = svg.ownerDocument.defaultView;
    let drag: { id: number; x: number; y: number; camera: MapViewport; moved: boolean } | null = null;
    const tracking = trackMapPointers(svg, (value) => { pointerAllowed.current = value; });
    const cancel = () => { drag = null; tracking.cancel(); };
    cancelGesture.current = cancel;
    const down = (event: PointerEvent) => {
      if (!pointerAllowed.current) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
        camera: interaction.current.viewport, moved: false };
    };
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId || !pointerAllowed.current) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      if (drag.moved) {
        const rect = svg.getBoundingClientRect();
        setCamera(panViewportByScreenDelta(drag.camera, dx, dy, rect.width, rect.height));
      }
    };
    const up = (event: PointerEvent) => {
      const current = drag;
      drag = null;
      if (!current || current.id !== event.pointerId || !pointerAllowed.current || current.moved
        || Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6) return;
      const rect = svg.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      try {
        const matrix = svg.getScreenCTM();
        if (!matrix) return;
        const point = draftPointFromInverseCtm(event.clientX, event.clientY, matrix.inverse());
        if (point) interaction.current.capture(point);
      } catch { /* A detached or singular SVG cannot provide a trustworthy coordinate. */ }
    };
    svg.addEventListener("pointerdown", down);
    ownerWindow?.addEventListener("pointermove", move);
    ownerWindow?.addEventListener("pointerup", up);
    ownerWindow?.addEventListener("pointercancel", cancel);
    ownerWindow?.addEventListener("blur", cancel);
    return () => {
      tracking.dispose();
      svg.removeEventListener("pointerdown", down);
      ownerWindow?.removeEventListener("pointermove", move);
      ownerWindow?.removeEventListener("pointerup", up);
      ownerWindow?.removeEventListener("pointercancel", cancel);
      ownerWindow?.removeEventListener("blur", cancel);
    };
  }, []);

  const nativeGesture = useRef<{ camera: MapViewport; moved: boolean; valid: boolean } | null>(null);
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      nativeGesture.current = { camera: interaction.current.viewport, moved: false, valid: event.nativeEvent.touches.length === 1 };
    },
    onPanResponderStart: (event) => {
      if (nativeGesture.current && event.nativeEvent.touches.length !== 1) nativeGesture.current.valid = false;
    },
    onPanResponderMove: (event, gesture) => {
      const state = nativeGesture.current;
      if (!state) return;
      if (event.nativeEvent.touches.length !== 1) state.valid = false;
      if (!state.valid) return;
      if (Math.hypot(gesture.dx, gesture.dy) > 6) state.moved = true;
      if (state.moved) setCamera(panViewportByScreenDelta(state.camera, gesture.dx, gesture.dy,
        interaction.current.screen.width, interaction.current.screen.height));
    },
    onPanResponderRelease: (event, gesture) => {
      const state = nativeGesture.current;
      nativeGesture.current = null;
      if (!state?.valid || state.moved || Math.hypot(gesture.dx, gesture.dy) > 6) return;
      const { width, height } = interaction.current.screen;
      const { locationX, locationY } = event.nativeEvent;
      if (![locationX, locationY].every(Number.isFinite) || locationX < 0 || locationY < 0 || locationX > width || locationY > height) return;
      interaction.current.capture(screenPointToWorld(state.camera,
        { xPixels: locationX, yPixels: locationY }, { widthPixels: width, heightPixels: height }));
    },
    onPanResponderTerminate: () => { nativeGesture.current = null; },
  }), []);

  function cancelActiveGesture() {
    cancelGesture.current();
    nativeGesture.current = null;
  }

  useEffect(() => { cancelActiveGesture(); }, [disabled]);

  function choose(next: DraftDrawingGeometryType | null) {
    cancelActiveGesture();
    if (!allowed) return;
    if (active) onDrawing({ type: "pause", id: active.id });
    setArmed(next);
    setMessage(null);
  }

  function finish() {
    cancelActiveGesture();
    if (!allowed || !active) return;
    onDrawing({ type: "finish", id: active.id });
  }

  const infrastructure = [
    { id: "pivot", text: "Pivot", point: draft.pivotCenter, color: "#14734b" },
    { id: "water", text: "Water", point: draft.waterSource, color: "#007eaa" },
    { id: "power", text: "Power", point: draft.powerSource, color: "#9b6610" },
  ].filter((item): item is typeof item & { point: XY } => item.point !== null);
  const labelCandidates: MapLabelCandidate[] = infrastructure.map((item) => ({ ...item, priority: 90 }));
  for (const feature of draft.mapFeatures ?? []) {
    const geometry = feature.geometry;
    const point = geometry.type === "Point" ? geometry.point : geometry.type === "Circle" ? geometry.center
      : visiblePathLabelPoint(geometry.vertices, viewport, geometry.type === "Polygon");
    if (point) labelCandidates.push({ id: `feature-${feature.id}`, text: feature.name, point, color: "#43545c", priority: 40 });
  }
  for (const obstacle of draft.obstacles) {
    const point = visiblePathLabelPoint(obstacle.polygon, viewport, true);
    if (point) labelCandidates.push({ id: `obstacle-${obstacle.id}`, text: obstacle.name, point, color: "#ad3645", priority: 50 });
  }
  const labels = placeMapLabels(labelCandidates, viewport, screen, vertices, [
    { x: screen.width - 162, y: 0, width: 162, height: 68 },
    { x: 0, y: screen.height - bottomHeight - 20, width: screen.width, height: bottomHeight + 20 },
  ]);
  const measurement = geometryType && draft.projectCrs && vertices.length && !validation
    ? draftMeasurementText(geometryType, vertices, draft.projectCrs, draft.unitSystem) : "";

  function renderGeometry(geometry: ProjectMapFeatureGeometry, color: string, key: string) {
    const common = { stroke: color, strokeWidth: symbols.px(2) };
    if (geometry.type === "Point") return <Circle key={key} cx={geometry.point.x} cy={-geometry.point.y} r={symbols.px(5)} fill={color} />;
    if (geometry.type === "Circle") return <Circle key={key} cx={geometry.center.x} cy={-geometry.center.y} r={geometry.radiusMeters} fill="none" {...common} />;
    const points = geometry.vertices.map((point) => `${point.x},${-point.y}`).join(" ");
    return geometry.type === "Polygon" ? <Polygon key={key} points={points} fill={color} fillOpacity={0.1} {...common} />
      : <Polyline key={key} points={points} fill="none" {...common} />;
  }

  return <View style={styles.root} testID="design-draft-map">
    <View ref={surface} style={styles.canvas} onLayout={(event) => {
      const { width, height } = event.nativeEvent.layout;
      if (width > 0 && height > 0) setScreen({ width, height });
    }} {...(Platform.OS !== "web" ? responder.panHandlers : {})}>
      <Svg width="100%" height="100%" viewBox={viewportToSvgViewBox(viewport)} preserveAspectRatio="none"
        pointerEvents={Platform.OS === "web" ? "auto" : "none"} testID="design-draft-map-svg">
        <G>
          {draft.fieldBoundary.length > 1 && renderGeometry({ type: draft.fieldBoundary.length >= 3 ? "Polygon" : "LineString",
            vertices: draft.fieldBoundary }, "#32805b", "boundary")}
          {draft.fieldBoundary.map((point, index) => <Circle key={`boundary-${index}`} cx={point.x} cy={-point.y}
            r={symbols.px(3.5)} fill="#32805b" />)}
          {draft.obstacles.map((obstacle) => renderGeometry({ type: "Polygon", vertices: obstacle.polygon }, "#bc4250", `obstacle-${obstacle.id}`))}
          {(draft.mapFeatures ?? []).map((feature) => renderGeometry(feature.geometry, "#537a8c", `feature-${feature.id}`))}
          {infrastructure.map((item) => <Circle key={item.id} cx={item.point.x} cy={-item.point.y}
            r={symbols.px(6)} fill={item.color} stroke="#fff" strokeWidth={symbols.px(2)} />)}
          {paused.filter(item => item.vertices.length > 0).map(item => renderGeometry(item.geometryType === "Point"
            ? { type: "Point", point: item.vertices[0]?.point ?? { x: 0, y: 0 } }
            : { type: item.geometryType === "Polygon" && item.vertices.length >= 3 ? "Polygon" : "LineString", vertices: item.vertices.map(vertex => vertex.point) }, "#9c7b41", `paused-${item.id}`))}
          {vertices.length > 1 && renderGeometry({ type: geometryType === "Polygon" && vertices.length >= 3 ? "Polygon" : "LineString",
            vertices }, "#b14492", "capture")}
          {vertices.map((point, index) => <Circle key={`capture-${index}`} cx={point.x} cy={-point.y} r={symbols.px(4)} fill="#b14492" />)}
          {labels.map((label) => <SvgText key={label.id} x={label.svgX} y={label.svgY} fontSize={symbols.px(12)}
            fill={label.color} stroke="#fff" strokeWidth={symbols.px(0.3)}>{label.displayText}</SvgText>)}
        </G>
      </Svg>
    </View>
    <View style={styles.camera} testID="design-draft-camera-controls">
      <MapButton icon={Plus} label="Zoom in" iconOnly tooltipPlacement="below" onPress={() => { cancelActiveGesture(); setCamera(zoomViewport(viewport, 1.5)); }} />
      <MapButton icon={Minus} label="Zoom out" iconOnly tooltipPlacement="below" onPress={() => { cancelActiveGesture(); setCamera(zoomViewport(viewport, 1 / 1.5)); }} />
      <MapButton icon={Scan} label="Fit design" iconOnly tooltipPlacement="below" disabled={!bounds} onPress={() => {
        cancelActiveGesture();
        if (bounds) { const fitted = fitProjectedBounds(bounds, screen, frameInsets); if (fitted) setCamera(fitted); }
      }} />
    </View>
    <View pointerEvents="box-none" style={styles.bottom} testID="design-draft-capture-status" onLayout={(event) => setBottomHeight(event.nativeEvent.layout.height)}>
      <ScrollView style={{ maxHeight: Math.max(40, screen.height - 160 - (active ? captureHeight : 0)), maxWidth: "100%" }}
        contentContainerStyle={styles.details} keyboardShouldPersistTaps="handled" testID="design-draft-tool-details">
        {!crsAllowed && <MapNotice warning>A projected or local coordinate system is required for drawing.</MapNotice>}
        {disabled && <MapNotice warning>Apply or discard design inputs before drawing.</MapNotice>}
        {!!measurement && <MapNotice>{measurement}</MapNotice>}
        {(message || (vertices.length > 0 && validation)) && <MapNotice warning>{message || validation}</MapNotice>}
        {!active && armed && <Text style={styles.status}>{armed === "Polygon" && draft.fieldBoundary.length === 0 ? "Draw the field boundary" : `Draw ${armed === "LineString" ? "a line" : armed.toLowerCase()}`}: select points, then Finish.</Text>}
        {paused.map(item => <MapButton key={item.id} icon={Play} label={`Resume ${item.name}`} disabled={!allowed || !!active}
          testID={`design-draft-resume-${item.id}`} onPress={() => { cancelActiveGesture(); setArmed(null); onDrawing({ type: "resume", id: item.id }); }} />)}
      </ScrollView>
      <View style={styles.tools} testID="design-draft-drawing-toolbar">
        <MapButton icon={Hand} label="Pan" tool color="#17647a" tooltipPlacement="above-start"
          hint="Pause the drawing and move around the map." active={!geometryType} disabled={disabled} onPress={() => choose(null)} />
        {([
          ["Polygon", "Polygon", Pentagon, "#237446"], ["LineString", "Line", Spline, "#875500"], ["Point", "Point", MapPin, "#8b3677"],
        ] as const).map(([type, label, icon, color]) => <MapButton key={type} icon={icon} label={label} tool color={color}
          hint={`Draw ${label.toLowerCase()} geometry, then choose what it represents.`}
          disabled={!allowed} active={geometryType === type} onPress={() => choose(type)} />)}
      </View>
      {active && <View style={styles.capture} onLayout={(event) => setCaptureHeight(event.nativeEvent.layout.height)}>
        <Text style={styles.status} testID="design-draft-capture-summary">{active.name} ({vertices.length} points)</Text>
        <View style={styles.captureButtons}>
          <MapButton icon={Undo2} label="Remove last captured point" displayLabel="Remove last" color="#875500" tooltipPlacement="above-start"
            hint="Remove the most recently drawn point." disabled={!allowed || !vertices.length || active.stage !== "drawing"}
            onPress={() => { cancelActiveGesture(); onDrawing({ type: "remove_last_vertex", id: active.id }); }} />
          <MapButton icon={Pause} color="#875500" label="Pause drawing" displayLabel="Pause" testID="design-draft-pause"
            hint="Keep this unfinished drawing and save it for later." disabled={!allowed}
            onPress={() => { cancelActiveGesture(); setArmed(null); onDrawing({ type: "pause", id: active.id }); }} />
          <MapButton icon={Check} color="#237446" label="Finish drawing" displayLabel="Finish"
            hint="Check the shape and choose its purpose." testID="design-draft-commit"
            disabled={!allowed || !!validation || active.stage !== "drawing"} onPress={finish} />
          <MapButton icon={X} color="#a33335" label="Discard drawing" displayLabel="Discard"
            hint="Remove this unfinished drawing. Undo can restore it." disabled={disabled} onPress={() => {
              cancelActiveGesture(); setArmed(null); onDrawing({ type: "discard", id: active.id }); setMessage(null);
            }} />
        </View>
      </View>}
    </View>
  </View>;
}

function MapNotice({ children, warning = false }: { children: React.ReactNode; warning?: boolean }): React.JSX.Element {
  const Icon = warning ? TriangleAlert : Info;
  return <View style={[styles.notice, warning && styles.warning]} accessibilityRole={warning ? "alert" : undefined}>
    <Icon size={22} color="#85520d" />
    <Text style={[styles.noticeText, warning && styles.warningText]}>{children}</Text>
  </View>;
}

function MapButton({ icon: Icon, label, displayLabel, hint, onPress, active = false, disabled = false, iconOnly = false, tool = false, color, suppressTooltip = false, tooltipPlacement = "above", testID }: {
  icon: LucideIcon; label: string; onPress: () => void; active?: boolean; disabled?: boolean; iconOnly?: boolean; testID?: string;
  displayLabel?: string; hint?: string; tool?: boolean; color?: string; suppressTooltip?: boolean;
  tooltipPlacement?: "above" | "above-start" | "below";
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const id = testID ?? `design-draft-${label.toLowerCase().replaceAll(" ", "-")}`;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected: active }}
    accessibilityHint={hint}
    testID={id} disabled={disabled} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[styles.button, tool && styles.toolButton, color ? { backgroundColor: color, borderColor: color } : undefined,
      iconOnly && styles.iconButton, active && styles.active, disabled && styles.disabled]}>
    <Icon size={22} color={color && !active ? "#fff" : active ? color ?? "#14734b" : "#293b40"} />
    {!iconOnly && <Text style={[styles.buttonText, color ? { color: active ? color : "#fff" } : undefined]}>{displayLabel ?? label}</Text>}
    {!suppressTooltip && (hovered || focused) && <View pointerEvents="none" testID={`${id}-tooltip`} style={[styles.tooltip,
      tooltipPlacement === "below" ? styles.tooltipBelow : tooltipPlacement === "above-start" ? styles.tooltipAboveStart : styles.tooltipAbove]}><Text style={styles.tooltipText}>{hint ?? label}</Text></View>}
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0, width: "100%", backgroundColor: "#f1f5f3", position: "relative", overflow: "hidden" },
  canvas: { ...StyleSheet.absoluteFillObject },
  tools: { flexDirection: "row", gap: 6, width: 360, maxWidth: "100%" },
  button: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    paddingHorizontal: 8, backgroundColor: "#fff", borderWidth: 2, borderColor: "#a6b7af", borderRadius: 5, position: "relative", flexShrink: 1 },
  toolButton: { flex: 1, minWidth: 0, minHeight: 60, flexDirection: "column", gap: 2, paddingHorizontal: 3 },
  iconButton: { width: 48, height: 48, paddingHorizontal: 0, flexShrink: 0 },
  buttonText: { fontSize: 14, fontWeight: "600", color: "#293b40", flexShrink: 1 },
  active: { backgroundColor: "#fff", borderColor: "#173a2c" },
  disabled: { opacity: 0.45 },
  camera: { position: "absolute", right: 10, top: 10, gap: 4, flexDirection: "row" },
  details: { gap: 6, alignItems: "center" },
  bottom: { position: "absolute", bottom: 10, left: 10, right: 10, gap: 6, alignItems: "center" },
  capture: { alignItems: "center", gap: 6, maxWidth: "100%" },
  captureButtons: { flexDirection: "row", gap: 6, maxWidth: "100%" },
  status: { fontSize: 14, fontWeight: "600", color: "#293b40", backgroundColor: "#fff", padding: 7, flexShrink: 1 },
  notice: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fff6df", borderLeftWidth: 3,
    borderLeftColor: "#ad7519", padding: 8, maxWidth: "100%" },
  noticeText: { fontSize: 14, lineHeight: 20, color: "#755017", flexShrink: 1 },
  warning: { backgroundColor: "#fff6df", borderLeftColor: "#ad7519" },
  warningText: { color: "#755017" },
  tooltip: { position: "absolute", width: 150, padding: 6, backgroundColor: "#243c32", borderRadius: 4, zIndex: 20 },
  tooltipAbove: { right: 0, bottom: "100%", marginBottom: 6 },
  tooltipAboveStart: { left: 0, bottom: "100%", marginBottom: 6 },
  tooltipBelow: { right: 0, top: "100%", marginTop: 6 },
  tooltipText: { fontSize: 12, color: "#fff" },
});
