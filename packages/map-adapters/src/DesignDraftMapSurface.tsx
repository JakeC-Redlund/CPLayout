import React, { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, G, Polygon, Polyline, Text as SvgText } from "react-native-svg";
import { Check, Hand, MapPin, Minus, Pentagon, Plus, Scan, Spline, Undo2, X, type LucideIcon } from "lucide-react-native";
import type { DesignDraft, DesignDraftEditorAction, ProjectMapFeatureGeometry, XY } from "@cplayout/core";
import {
  panViewportByScreenDelta, screenPointToWorld, viewportToSvgViewBox, zoomViewport,
  type MapViewport,
} from "@cplayout/geometry";
import { fitProjectedBounds, viewportForScreen } from "./mapFit";
import { trackMapPointers } from "./mapPointerGuard";
import { draftMeasurementText } from "./mapTools";
import { createSvgSymbolScale, placeMapLabels, visiblePathLabelPoint, type MapLabelCandidate } from "./svgMapLabels";
import {
  DESIGN_DRAFT_PURPOSES, buildDraftCaptureAction, designDraftBounds, draftCaptureError,
  draftContainsCapture, draftDrawingAllowed, draftPointFromInverseCtm,
  type DesignDraftPurpose, type DesignDraftToolGroup,
} from "./designDraftMap";

export interface DesignDraftMapSurfaceProps {
  draft: DesignDraft;
  onAction: (action: DesignDraftEditorAction) => void;
  onPendingChange?: (pending: boolean) => void;
  disabled?: boolean;
}

const emptyCamera: MapViewport = { center: { x: 0, y: 0 }, baseWidthMeters: 1000, baseHeightMeters: 1000, zoomLevel: 1 };
const frameInsets = { top: 68, right: 58, bottom: 110, left: 12 };

/** Session identity changes retire all temporary pointer, capture, and camera state. */
export function DesignDraftMapSurface(props: DesignDraftMapSurfaceProps): React.JSX.Element {
  return <DraftSurfaceSession key={JSON.stringify([props.draft.id, props.draft.projectCrs])} {...props} />;
}

function DraftSurfaceSession({ draft, onAction, onPendingChange, disabled = false }: DesignDraftMapSurfaceProps): React.JSX.Element {
  const [screen, setScreen] = useState({ width: 640, height: 480 });
  const [topHeight, setTopHeight] = useState(52);
  const [bottomHeight, setBottomHeight] = useState(100);
  const bounds = useMemo(() => designDraftBounds(draft), [draft]);
  const [camera, setCamera] = useState<MapViewport>(() => bounds
    ? fitProjectedBounds(bounds, screen, frameInsets) ?? emptyCamera : emptyCamera);
  const viewport = useMemo(() => viewportForScreen(camera, screen) ?? camera, [camera, screen]);
  const [menu, setMenu] = useState<DesignDraftToolGroup | null>(null);
  const [purpose, setPurpose] = useState<DesignDraftPurpose | null>(null);
  const [vertices, setVertices] = useState<XY[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<DesignDraftEditorAction | null>(null);
  const surface = useRef<View>(null);
  const pointerAllowed = useRef(false);
  const sequence = useRef(0);
  const crsAllowed = draftDrawingAllowed(draft.projectCrs);
  const allowed = crsAllowed && !disabled;
  const selected = DESIGN_DRAFT_PURPOSES.find((option) => option.id === purpose);
  const validation = purpose ? draftCaptureError(purpose, vertices) : null;
  const symbols = createSvgSymbolScale(viewport, screen.width);
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  const pending = vertices.length > 0;

  useEffect(() => { onPendingChange?.(pending); }, [onPendingChange, pending]);
  useEffect(() => () => { pendingCallback.current?.(false); }, []);

  useEffect(() => {
    if (submitted && draftContainsCapture(draft, submitted)) {
      setSubmitted(null);
      setVertices([]);
      setPurpose(null);
      setMessage(null);
    }
  }, [draft, submitted]);

  function capture(point: XY) {
    if (!allowed || !purpose || menu || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    setMessage(null);
    setSubmitted(null);
    setVertices((current) => selected?.geometry === "Point" ? [{ ...point }]
      : current.at(-1)?.x === point.x && current.at(-1)?.y === point.y ? current : [...current, { ...point }]);
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

  function choose(next: DesignDraftPurpose) {
    cancelActiveGesture();
    if (!allowed) return;
    if (vertices.length && next !== purpose) {
      setMessage("Finish or cancel the current capture first.");
      return;
    }
    setPurpose(next);
    setMenu(null);
    setMessage(null);
    if (!vertices.length && next === "boundary" && draft.fieldBoundary.length < 3) {
      setVertices(draft.fieldBoundary.map((point) => ({ ...point })));
    }
  }

  function commit() {
    cancelActiveGesture();
    if (!allowed || !purpose) return;
    try {
      const existingIds = new Set([...draft.obstacles, ...(draft.mapFeatures ?? [])].map((item) => item.id));
      let id: string;
      do { id = `design-${draft.id}-${Date.now()}-${++sequence.current}`; } while (existingIds.has(id));
      const action = buildDraftCaptureAction(draft.projectCrs, purpose, vertices, id);
      setSubmitted(action);
      onAction(action);
    } catch (error) {
      setSubmitted(null);
      setMessage(error instanceof Error ? error.message : "The edit could not be applied.");
    }
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
    { x: 0, y: 0, width: screen.width, height: topHeight + 20 },
    { x: screen.width - 60, y: 100, width: 60, height: 150 },
    { x: 0, y: screen.height - bottomHeight - 20, width: screen.width, height: bottomHeight + 20 },
  ]);
  const measurement = selected && draft.projectCrs && vertices.length && !validation
    ? draftMeasurementText(selected.geometry, vertices, draft.projectCrs, draft.unitSystem) : "";

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
          {vertices.length > 1 && renderGeometry({ type: selected?.geometry === "Polygon" && vertices.length >= 3 ? "Polygon" : "LineString",
            vertices }, "#b14492", "capture")}
          {vertices.map((point, index) => <Circle key={`capture-${index}`} cx={point.x} cy={-point.y} r={symbols.px(4)} fill="#b14492" />)}
          {labels.map((label) => <SvgText key={label.id} x={label.svgX} y={label.svgY} fontSize={symbols.px(12)}
            fill={label.color} stroke="#fff" strokeWidth={symbols.px(0.3)}>{label.displayText}</SvgText>)}
        </G>
      </Svg>
    </View>
    <View pointerEvents="box-none" style={styles.top} onLayout={(event) => setTopHeight(event.nativeEvent.layout.height)}>
      <View style={styles.tools}>
        <MapButton icon={Hand} label="Pan" active={!purpose && !menu} onPress={() => {
          cancelActiveGesture();
          if (disabled) return;
          if (vertices.length) { setMessage("Finish or cancel the current capture first."); setMenu(null); return; }
          setPurpose(null); setMenu(null); setMessage(null);
        }} />
        {([
          ["polygon", "Polygon", Pentagon], ["line", "Line", Spline], ["point", "Point", MapPin],
        ] as const).map(([group, label, icon]) => <MapButton key={group} icon={icon} label={label}
          disabled={!allowed} active={menu === group || selected?.group === group}
          onPress={() => { cancelActiveGesture(); setMenu(menu === group ? null : group); }} />)}
      </View>
      {menu && <View style={styles.menu} testID="design-draft-purpose-menu">
        {DESIGN_DRAFT_PURPOSES.filter((option) => option.group === menu).map((option) => <Pressable
          key={option.id} accessibilityRole="button" accessibilityLabel={option.label} style={styles.menuItem} disabled={!allowed}
          testID={`design-draft-purpose-${option.id}`} onPress={() => choose(option.id)}>
          <Text style={styles.menuText}>{option.label}</Text>
          {purpose === option.id && <Check size={16} color="#14734b" />}
        </Pressable>)}
      </View>}
    </View>
    <View style={styles.camera} testID="design-draft-camera-controls">
      <MapButton icon={Plus} label="Zoom in" iconOnly tooltipPlacement="left" onPress={() => { cancelActiveGesture(); setCamera(zoomViewport(viewport, 1.5)); }} />
      <MapButton icon={Minus} label="Zoom out" iconOnly tooltipPlacement="left" onPress={() => { cancelActiveGesture(); setCamera(zoomViewport(viewport, 1 / 1.5)); }} />
      <MapButton icon={Scan} label="Fit design" iconOnly tooltipPlacement="left" disabled={!bounds} onPress={() => {
        cancelActiveGesture();
        if (bounds) { const fitted = fitProjectedBounds(bounds, screen, frameInsets); if (fitted) setCamera(fitted); }
      }} />
    </View>
    <View pointerEvents="box-none" style={styles.bottom} testID="design-draft-capture-status" onLayout={(event) => setBottomHeight(event.nativeEvent.layout.height)}>
      {!crsAllowed && <Text style={styles.notice} accessibilityRole="alert">A projected or local coordinate system is required for drawing.</Text>}
      {disabled && <Text style={styles.notice}>Unapplied design inputs</Text>}
      {purpose && <View style={styles.capture}>
        <Text style={styles.status}>{selected?.label} ({vertices.length})</Text>
        <View style={styles.captureButtons}>
          <MapButton icon={Undo2} label="Remove last captured point" iconOnly disabled={!allowed || !vertices.length}
            onPress={() => { if (!allowed) return; cancelActiveGesture(); setVertices((current) => current.slice(0, -1)); setSubmitted(null); setMessage(null); }} />
          <MapButton icon={Check} label={purpose === "boundary" && draft.fieldBoundary.length >= 3 ? "Replace boundary" : "Keep"}
            testID="design-draft-commit" disabled={!allowed || !!validation} onPress={commit} />
          <MapButton icon={X} label="Cancel capture" iconOnly disabled={disabled} onPress={() => {
            if (disabled) return;
            cancelActiveGesture(); setVertices([]); setSubmitted(null); setPurpose(null); setMenu(null); setMessage(null);
          }} />
        </View>
      </View>}
      {!!measurement && <Text style={styles.notice}>{measurement}</Text>}
      {(message || (vertices.length > 0 && validation)) && <Text style={styles.notice} accessibilityRole="alert">{message || validation}</Text>}
    </View>
  </View>;
}

function MapButton({ icon: Icon, label, onPress, active = false, disabled = false, iconOnly = false, tooltipPlacement = "above", testID }: {
  icon: LucideIcon; label: string; onPress: () => void; active?: boolean; disabled?: boolean; iconOnly?: boolean; testID?: string;
  tooltipPlacement?: "above" | "left";
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected: active }}
    testID={testID ?? `design-draft-${label.toLowerCase().replaceAll(" ", "-")}`} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[styles.button, iconOnly && styles.iconButton, active && styles.active, disabled && styles.disabled]}>
    <Icon size={18} color={active ? "#14734b" : "#293b40"} />
    {!iconOnly && <Text style={styles.buttonText}>{label}</Text>}
    {iconOnly && hovered && <View pointerEvents="none" style={[styles.tooltip,
      tooltipPlacement === "left" ? styles.tooltipLeft : styles.tooltipAbove]}><Text style={styles.tooltipText}>{label}</Text></View>}
  </Pressable>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 300, minWidth: 0, width: "100%", backgroundColor: "#f1f5f3", position: "relative", overflow: "hidden" },
  canvas: { ...StyleSheet.absoluteFillObject },
  top: { position: "absolute", top: 10, left: 10, right: 10, alignItems: "flex-start", gap: 6 },
  tools: { flexDirection: "row", flexWrap: "wrap", gap: 4, maxWidth: "100%" },
  button: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5,
    paddingHorizontal: 9, backgroundColor: "#fff", borderWidth: 1, borderColor: "#cbd6d0", borderRadius: 5, position: "relative" },
  iconButton: { width: 42, height: 42, paddingHorizontal: 0 },
  buttonText: { fontSize: 12, fontWeight: "600", color: "#293b40", flexShrink: 1 },
  active: { backgroundColor: "#e1f2e8", borderColor: "#32805b" },
  disabled: { opacity: 0.45 },
  menu: { width: 220, maxWidth: "100%", backgroundColor: "#fff", borderColor: "#cbd6d0", borderWidth: 1, borderRadius: 5 },
  menuItem: { minHeight: 42, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  menuText: { fontSize: 13, color: "#293b40", flexShrink: 1 },
  camera: { position: "absolute", right: 10, top: 110, gap: 4 },
  bottom: { position: "absolute", bottom: 10, left: 10, right: 62, gap: 4 },
  capture: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 6 },
  captureButtons: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  status: { fontSize: 13, color: "#293b40", backgroundColor: "#fff", padding: 7, flexShrink: 1 },
  notice: { fontSize: 12, color: "#34454b", backgroundColor: "#fff", padding: 7, alignSelf: "flex-start", maxWidth: "100%" },
  tooltip: { position: "absolute", width: 150, padding: 6, backgroundColor: "#243c32", borderRadius: 4, zIndex: 20 },
  tooltipAbove: { right: 0, bottom: "100%" },
  tooltipLeft: { right: "100%", top: 4, marginRight: 6 },
  tooltipText: { fontSize: 12, color: "#fff" },
});
