import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Crosshair,
  Fence,
  Hand,
  Layers,
  LocateFixed,
  Minus,
  PencilLine,
  Plus,
  Scan,
  Ruler,
  Satellite,
  UtilityPole,
  Undo2,
  X,
} from "lucide-react-native";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent, type ViewStyle } from "react-native";
import Svg, { Circle, G, Image as SvgImage, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { buildLayoutPathOverlays, boundsForGeometry, createCirclePolygon, planOnlineImageryTiles, ringsToSvgPath, supportsSvgOnlineImageryOverlay } from "@cplayout/geometry";
import {
  createInitialViewport,
  DrawingLayerType,
  DrawingMapAction,
  DrawingMapState,
  panViewport,
  panViewportByScreenDelta,
  zoomViewport,
  screenPointToWorld,
  snapPointToGeometry,
  viewportToSvgViewBox,
  visibleHeightMeters,
  visibleWidthMeters,
} from "@cplayout/geometry";
import type { InfrastructurePoint, MapStyle, MappingWorkflowMode, ObstacleZone, ProjectMapFeature, ProjectMapFeatureKind, SurveyPoint } from "@cplayout/core";
import type { AdvisoryFieldPivotPlan, AdvisoryMachineRenderModel, AdvisoryMachineRenderSurface, LayoutPathOverlay } from "@cplayout/geometry";
import { buildMapReferenceViewModel } from "@cplayout/core";
import { XY } from "@cplayout/core";
import { MapLibreImageryPreview } from "./MapLibreImageryPreview";
import {
  UTILITY_FEATURE_OPTIONS,
  draftMeasurementText,
} from "./mapTools";
import {
  hasMapFeatureVertexSelection,
  hasObstacleVertexSelection,
  selectedProjectVertexText,
} from "./projectVertexEditing";
import type { MapSurfaceProps } from "./types";
import { useMapInteractionController } from "./useMapInteractionController";
import { finitePointBounds, fitProjectedBounds, viewportForScreen } from "./mapFit";
import { trackMapPointers } from "./mapPointerGuard";
import { createSvgMapCameraSession, type MapCameraFrame, type MapCameraFrameIdentity } from "./mapCameraSession";
import { anchoredPixelBox, createSvgSymbolScale, MAP_LABEL_FONT_PIXELS, placeMapLabels, visibleCircleLabelPoint, visiblePathLabelPoint, type MapLabelCandidate, type PixelBox } from "./svgMapLabels";

type MapPalette = ReturnType<typeof paletteForMapStyle>;
type SvgSymbolScale = ReturnType<typeof createSvgSymbolScale>;
type SvgMapSurfaceProps = MapSurfaceProps & { webGlRenderingDisabled?: boolean };

const CATALOG_HOME_BOUNDS = {
  minX: -168,
  minY: 15,
  maxX: -52,
  maxY: 72,
};

const overlayAnchors = {
  zoom: { top: 12, right: 12 }, pan: { top: 174, right: 12 }, legend: { top: 12, left: 12 },
  notices: { top: 12, left: 12 }, bottom: { bottom: 8, left: 12 }, draft: { bottom: 84, left: 12 },
};

export function SvgMapSurface(props: SvgMapSurfaceProps): React.JSX.Element {
  const {
    advisoryFieldPivotPlan, advisoryMachineRenderModel, bottomOverlay,
    controlLayout = "internalRows", homeView = false, project, result, settings,
    selectedMapFeatureId, webGlRenderingDisabled = false,
    onMappingWorkflowModeChange, onSelectMapFeature,
  } = props;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const compactLayout = windowWidth < 760;
  const catalogHomeView = homeView === true;
  const externalHudLayout = controlLayout === "externalHud";
  const shortLandscape = externalHudLayout && windowWidth > windowHeight && windowHeight < 500;
  const externalCompactToolbar = externalHudLayout && (compactLayout || shortLandscape);
  const designMode = settings.mappingWorkflowMode === "design" && !catalogHomeView;
  const showProjectGeometry = !catalogHomeView;
  const mapFeatures = project.mapFeatures ?? [];
  const advisoryFieldPivotPlanVisible = showProjectGeometry && (advisoryFieldPivotPlan?.selectedMachineCount ?? 0) > 0;
  const advisoryMachineRenderVisible = showProjectGeometry && (advisoryMachineRenderModel?.instances.length ?? 0) > 0;
  const readyTwoMachineAdvisoryRender = advisoryMachineRenderVisible
    && advisoryMachineRenderModel?.status === "ready"
    && advisoryMachineRenderModel.instances.length >= 2;
  const canonicalMachineLayersVisible = showProjectGeometry && !readyTwoMachineAdvisoryRender;
  const visibleMapFeatures = readyTwoMachineAdvisoryRender
    ? mapFeatures.filter((feature) => !isGeneratedMeasurementCircleFeature(feature))
    : mapFeatures;
  const advisoryFieldPivotPlanRings = advisoryFieldPivotPlanVisible && advisoryFieldPivotPlan
    ? [
      ...advisoryFieldPivotPlan.modeledCoverageUnion.flat(),
      ...advisoryFieldPivotPlan.candidates.flatMap((candidate) => candidate.machineEnvelope.flat()),
    ]
    : [];
  const advisoryMachineRenderRings = advisoryMachineRenderVisible && advisoryMachineRenderModel
    ? advisoryMachineRenderModel.surfaces.flatMap((surface) => [
      surface.preferredOutlinePath,
      ...surface.standardPivotCoverage.flat(),
      ...surface.endGunWetAnnulus.flat(),
      ...surface.cornerArmCoverage.flat(),
      ...surface.clippedWetCoverage.flat(),
      ...surface.physicalEnvelope.flat(),
      ...(surface.lrduPath ? surface.lrduPath.insideFieldEnvelope.flat() : []),
      ...surface.towerPaths.flatMap((overlay) => overlay.insideFieldEnvelope.flat()),
      ...(surface.cornerArmWheelPath ? surface.cornerArmWheelPath.insideFieldEnvelope.flat() : []),
      ...(surface.cornerArmOverhangEndPath ? surface.cornerArmOverhangEndPath.insideFieldEnvelope.flat() : []),
    ])
    : [];
  const layoutPathOverlays = useMemo(
    () => showProjectGeometry ? buildLayoutPathOverlays(project) : [],
    [project, showProjectGeometry],
  );
  const allRings = showProjectGeometry
    ? [
      project.fieldBoundary,
      ...(canonicalMachineLayersVisible ? result.allowedCoverage.flat() : []),
      ...advisoryFieldPivotPlanRings,
      ...advisoryMachineRenderRings,
      ...layoutPathOverlays.flatMap((overlay) => [
        ...overlay.insideFieldEnvelope.flat(),
      ]),
      ...project.obstacles.map((obstacle) => obstacle.polygon),
      ...visibleMapFeatures.flatMap(mapFeatureRings),
    ]
    : [];
  const bounds = showProjectGeometry ? boundsForGeometry(allRings) : CATALOG_HOME_BOUNDS;
  const margin = showProjectGeometry ? 80 : 0;
  const initialViewport = useMemo(
    () => createInitialViewport({
      minX: bounds.minX - margin,
      minY: bounds.minY - margin,
      maxX: bounds.maxX + margin,
      maxY: bounds.maxY + margin,
    }, settings.defaultZoomLevel),
    [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, settings.defaultZoomLevel],
  );
  const [viewport, setViewport] = useState(initialViewport);
  const [mapPixelWidth, setMapPixelWidth] = useState(900);
  const [mapPixelHeight, setMapPixelHeight] = useState(440);
  const effectiveViewport = useMemo(() => viewportForScreen(viewport,
    { width: mapPixelWidth, height: mapPixelHeight }) ?? viewport,
  [viewport, mapPixelWidth, mapPixelHeight]);
  const fieldBounds = useMemo(() => finitePointBounds(project.fieldBoundary), [project.fieldBoundary]);
  const fitObstructions = useRef({ top: 0, draftTop: Infinity, bottom: 0, panWidth: 140 });
  const [labelObstructions, setLabelObstructions] = useState<Record<string, PixelBox>>({});
  const externalDraftBottom = bottomOverlay ? (labelObstructions.bottom?.height ?? 0) + 16 : 8;
  const [localSelectedMapFeatureId, setLocalSelectedMapFeatureId] = useState<string | null>(null);
  const [cameraSession] = useState(createSvgMapCameraSession);
  const cameraFrameRef = useRef<MapCameraFrame | null>(null);
  const committedCameraIdentity = useRef<MapCameraFrameIdentity | null>(null);
  const cameraIdentity = useMemo(() => ({ projectId: project.id, projectCrs: project.projectCrs,
    projectGeneration: props.projectGeneration ?? 0, homeView: catalogHomeView, projectionAvailable: true }),
  [project.id, project.projectCrs, props.projectGeneration, catalogHomeView]);
  const [legendOpen, setLegendOpen] = useState(false);
  const activeSelectedMapFeatureId = selectedMapFeatureId === undefined ? localSelectedMapFeatureId : selectedMapFeatureId;
  const controller = useMapInteractionController(
    { ...props, selectedMapFeatureId: activeSelectedMapFeatureId },
    { imageryEnabled: settings.onlineImagery.enabled },
  );
  const {
    selectedVertex, mapFeatureKind, activeFeatureGeometry, setMapFeatureKind,
    setTool: setToolMode, commitDraft, handleDraftVertexIntent, selectVertex,
    deleteSelectedVertex, selectFirstBoundaryVertex, selectFirstObstacleVertex,
    selectFirstMapFeatureVertex, selectAdjacentVertex, nudgeSelectedVertex,
    insertAfterSelectedVertex, canDeleteSelectedVertex, canInsertSelectedVertex,
  } = controller;
  const mapState = {
    viewport: effectiveViewport, mode: controller.mode, activeLayer: controller.activeLayer,
    draftVertices: controller.draftVertices,
  };
  const [lastSnap, setLastSnap] = useState<{ point: XY; kind: "vertex" | "feature" } | null>(null);
  const lastSvgPressAt = useRef(0);
  const suppressTapUntil = useRef(0);
  const pressStartPoint = useRef<{ x: number; y: number } | null>(null);
  const gestureAllowed = useRef(true);
  const panAllowed = useRef(false);
  const surfaceRef = useRef<View | null>(null);
  const pointerTracking = useRef<ReturnType<typeof trackMapPointers> | null>(null);
  const palette = paletteForMapStyle(settings.mapStyle);
  const viewWidth = visibleWidthMeters(mapState.viewport);
  const viewHeight = visibleHeightMeters(mapState.viewport);
  const symbolScale = useMemo(() => createSvgSymbolScale(mapState.viewport, mapPixelWidth), [mapPixelWidth, mapState.viewport]);
  const minX = mapState.viewport.center.x - viewWidth / 2;
  const maxX = mapState.viewport.center.x + viewWidth / 2;
  const minY = -mapState.viewport.center.y - viewHeight / 2;
  const maxY = -mapState.viewport.center.y + viewHeight / 2;
  const fieldPath = showProjectGeometry ? ringsToSvgPath([[project.fieldBoundary]]) : "";
  const labels: MapLabelCandidate[] = [
    ...([
      ["pivot", "Pivot", project.pivotCenter, palette.pivot],
      ["water", "Water", project.waterSource, palette.water],
      ["power", "Power", project.powerSource, palette.power],
    ] as const).map(([id, text, point, color]) => ({ id, text, point, color, priority: 70 })),
    ...visibleMapFeatures.map(feature => ({ id: `feature-${feature.id}`, featureId: feature.id,
      text: feature.name || shortMapFeatureLabel(feature.kind),
      caption: feature.geometry.type === "Point" ? shortMapFeatureLabel(feature.kind) : undefined,
      point: mapFeatureLabelPoint(feature, mapState.viewport),
      color: colorForMapFeature(feature.kind, palette), priority: activeSelectedMapFeatureId === feature.id ? 100 : 50 })),
    ...project.surveyPoints.map(point => ({ id: `survey-${point.id}`, text: shortSurveyLabel(point.role),
      point: point.projected, color: palette.survey, priority: 20 })),
    ...result.towers.map(tower => ({ id: `tower-${tower.towerIndex}`, text: `T${tower.towerIndex}`,
      point: tower.point, color: palette.fieldStroke, priority: 10 })),
    ...layoutPathOverlays.filter(overlay => overlay.centerlineSegments.some(segment => segment.length > 1)).map(overlay => ({
      id: `path-${overlay.kind}-${overlay.towerIndex ?? "machine"}`, text: layoutPathLabel(overlay),
      point: overlay.centerlineSegments.map(segment => visiblePathLabelPoint(segment, mapState.viewport)).find(point => point !== null)
        ?? { x: NaN, y: NaN },
      color: layoutPathLabelColor(overlay.kind, palette), priority: 15,
    })),
    ...mapState.draftVertices.map((point, index) => ({ id: `draft-${index}`, text: String(index + 1), point,
      color: palette.draft, priority: 110 })),
    ...(lastSnap ? [{ id: "snap", text: `Snap ${lastSnap.kind}`, point: lastSnap.point, color: palette.snap, priority: 120 }] : []),
    ...(advisoryFieldPivotPlanVisible && advisoryFieldPivotPlan ? advisoryFieldPivotPlan.candidates.map(candidate => ({
      id: `generated-${candidate.id}`, text: `G${candidate.sequence}`, point: candidate.pivotCenter,
      color: palette.advisoryStroke, priority: 60,
    })) : []),
    ...(advisoryMachineRenderVisible && advisoryMachineRenderModel ? advisoryMachineRenderModel.instances.map((instance, index) => ({
      id: `advisory-${instance.id}`, text: `A${index + 1}`, point: instance.pivotCenter, color: palette.machinePath, priority: 60,
    })) : []),
  ];
  const imageryPlan = useMemo(
    () => !catalogHomeView && settings.onlineImagery.enabled
      ? planOnlineImageryTiles({
        viewport: mapState.viewport,
        projectCrs: project.projectCrs,
        providerId: settings.onlineImagery.providerId,
        customSource: settings.onlineImagery.customSource,
        maxTiles: settings.onlineImagery.maxTilesPerView,
      })
      : null,
    [
      catalogHomeView,
      mapState.viewport,
      project.projectCrs,
      settings.onlineImagery.enabled,
      settings.onlineImagery.customSource,
      settings.onlineImagery.maxTilesPerView,
      settings.onlineImagery.providerId,
    ],
  );
  const shouldShowMapLibrePreview = !webGlRenderingDisabled
    && !catalogHomeView
    && settings.onlineImagery.enabled
    && !supportsSvgOnlineImageryOverlay(project.projectCrs);
  const referenceOverlayNotice = useMemo(
    () => settings.referenceOverlay.mode === "off" ? null : buildMapReferenceViewModel({
      settings, mapPackages: project.mapPackages ?? [], target: "svg_mvp", surface: "svg",
    }).reference,
    [project.mapPackages, settings.aerialImagery, settings.onlineImagery, settings.referenceOverlay],
  );

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => { startMapTouch(event); return false; },
      onMoveShouldSetPanResponder: (_event, gesture) => gestureAllowed.current && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 6,
      onPanResponderGrant: () => {
        if (!ownsCamera()) return;
        panAllowed.current = gestureAllowed.current;
        suppressTapUntil.current = Infinity;
      },
      onPanResponderTerminate: () => { panAllowed.current = false; suppressTapUntil.current = Date.now() + 350; },
      onPanResponderRelease: (_event, gesture) => {
        if (!ownsCamera()) return;
        suppressTapUntil.current = Date.now() + 350;
        if (!panAllowed.current) return;
        panAllowed.current = false;
        dispatch({
          type: "pan_screen",
          dxPixels: gesture.dx,
          dyPixels: gesture.dy,
          screenWidthPixels: mapPixelWidth,
          screenHeightPixels: mapPixelHeight,
        });
      },
    }),
    [cameraIdentity, designMode, mapPixelHeight, mapPixelWidth, mapState.mode, mapState.viewport, selectedVertex],
  );
  const panHandlers = panResponder.panHandlers;
  // react-native-svg maps onPress to the DOM click handler on web.
  const svgInteractionProps = Platform.OS === "web"
    ? { onPress: (event: GestureResponderEvent) => addDraftVertexFromWebClick(event as unknown as Parameters<typeof addDraftVertexFromWebClick>[0]), onDoubleClick: closeDraftFromWebDoubleClick }
    : { onPress: addDraftVertexFromPress };
  const mapClickLayerProps = Platform.OS === "web" ? { onClick: addDraftVertexFromWebClick, onDoubleClick: closeDraftFromWebDoubleClick } : {};
  const canCommitCurrentDraft = controller.canCommitDraft;
  const canSaveCurrentMapFeature = controller.canSaveFeature || (designMode && mapState.mode === "measure"
    && activeFeatureGeometry === "Point"
    && Boolean(props.activeMapFeatureKind ? props.onAddMapFeature : props.onCreateMapFeatureDraft));
  const mapClickLayerActive = designMode && mapState.mode !== "pan" && mapState.mode !== "edit_vertices";
  useLayoutEffect(() => {
    const previous = cameraFrameRef.current;
    if (previous && cameraSession.isCurrent(previous)) {
      cameraSession.remember(previous, { viewport, selectedMapFeatureId: localSelectedMapFeatureId });
    }
    const current = cameraSession.useFrame(cameraIdentity);
    cameraFrameRef.current = current;
    committedCameraIdentity.current = cameraIdentity;
    if (current !== previous) {
      cancelMapGesture();
      const restored = cameraSession.restore(current);
      setViewport(restored?.viewport ?? initialViewport);
      const selected = restored?.selectedMapFeatureId;
      setLocalSelectedMapFeatureId(selected && mapFeatures.some(feature => feature.id === selected) ? selected : null);
      setLastSnap(null);
    }
  });
  useLayoutEffect(cancelMapGesture, [mapPixelWidth, mapPixelHeight]);
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || typeof ResizeObserver === "undefined") return;
    const svg = (surfaceRef.current as unknown as Element | null)?.querySelector("svg");
    if (!svg) return;
    // RN layout events can round CSS pixels; use the rendered SVG for camera aspect.
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setMapPixelWidth(rect.width);
        setMapPixelHeight(rect.height);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || !surfaceRef.current) return;
    const tracking = trackMapPointers(surfaceRef.current as unknown as Element,
      allowed => {
        gestureAllowed.current = allowed;
        if (!allowed) { panAllowed.current = false; pressStartPoint.current = null; }
      });
    pointerTracking.current = tracking;
    return () => { tracking.dispose(); pointerTracking.current = null; };
  }, []);

  function cancelMapGesture(): void {
    gestureAllowed.current = false;
    panAllowed.current = false;
    pressStartPoint.current = null;
    pointerTracking.current?.cancel();
  }

  function ownsCamera(): boolean {
    const frame = cameraFrameRef.current;
    return committedCameraIdentity.current === cameraIdentity && frame !== null && cameraSession.isCurrent(frame);
  }

  function startMapTouch(event: GestureResponderEvent): void {
    if (Platform.OS === "web") return;
    if (event.nativeEvent.touches.length === 1) gestureAllowed.current = true;
    else cancelMapGesture();
  }

  function fitField(): void {
    if (!ownsCamera() || catalogHomeView || !fieldBounds) return;
    const obstruction = fitObstructions.current;
    const topVisible = !deferMapNotices && (imageryPlan || referenceOverlayNotice || externalHudLayout);
    const insets = {
      top: Math.max(deferMapNotices ? 68 : 12, topVisible ? obstruction.top + 8 : 0),
      right: deferMapNotices ? 20 : obstruction.panWidth + 20,
      bottom: Math.max(20, bottomOverlay && !externalCompactToolbar ? obstruction.bottom + 16 : 0,
        deferMapNotices ? 0 : mapPixelHeight - obstruction.draftTop + 8),
      left: 20,
    };
    if (Platform.OS === "web") {
      const surface = surfaceRef.current as unknown as Element | null;
      const svg = surface?.querySelector("svg");
      const frame = svg?.getBoundingClientRect();
      if (frame && frame.width > 0 && frame.height > 0) {
        // onLayout can retain old positions after an overlay moves without resizing.
        // Current web rectangles replace that cache; native keeps the layout fallback.
        insets.top = deferMapNotices ? 68 : 12;
        insets.bottom = 20;
        const obstructionRect = (testId: string) => surface?.querySelector(`[data-testid="${testId}"]`)?.getBoundingClientRect();
        const reserveTop = (testId: string) => {
          const rect = obstructionRect(testId);
          if (rect && rect.bottom > frame.top && rect.top < frame.bottom)
            insets.top = Math.max(insets.top, rect.bottom - frame.top + 8);
        };
        const reserveBottom = (testId: string) => {
          const rect = obstructionRect(testId);
          if (rect && rect.bottom > frame.top && rect.top < frame.bottom)
            insets.bottom = Math.max(insets.bottom, frame.bottom - rect.top + 8);
        };
        reserveTop("svg-map-top-overlay-stack");
        const zoom = obstructionRect("svg-map-zoom-controls");
        if (zoom && zoom.width > zoom.height) reserveTop("svg-map-zoom-controls");
        else if (zoom) insets.right = Math.max(insets.right, zoom.width + 20);
        reserveTop("svg-map-compact-legend");
        reserveBottom("svg-map-draft-hud");
        reserveBottom("svg-map-bottom-overlay");
      }
    }
    const margin = Math.max(0, Math.min(24, (mapPixelWidth - insets.left - insets.right) / 8,
      (mapPixelHeight - insets.top - insets.bottom) / 8));
    const fitted = fitProjectedBounds(fieldBounds, { width: mapPixelWidth, height: mapPixelHeight }, insets, margin);
    if (!fitted) return;
    cancelMapGesture();
    setViewport(fitted);
  }

  function dispatch(action: DrawingMapAction): void {
    if (!ownsCamera()) return;
    switch (action.type) {
      case "pan":
        cancelMapGesture();
        setViewport((current) => panViewport(current, action.delta));
        break;
      case "pan_screen":
        setViewport((current) => {
          const effective = viewportForScreen(current, { width: action.screenWidthPixels, height: action.screenHeightPixels });
          if (!effective) return current;
          const moved = panViewportByScreenDelta(effective, action.dxPixels, action.dyPixels, action.screenWidthPixels, action.screenHeightPixels);
          return { ...current, center: moved.center };
        });
        break;
      case "zoom":
        cancelMapGesture();
        setViewport((current) => zoomViewport(current, action.factor));
        break;
      case "set_mode":
        controller.setTool(action.mode);
        break;
      case "set_active_layer":
        controller.setActiveLayer(action.activeLayer);
        break;
      case "add_draft_vertex":
        controller.handleDraftVertexIntent(action.vertex, false);
        break;
      case "clear_draft":
        controller.clearDraft();
        break;
      case "select_feature":
        setLocalSelectedMapFeatureId(action.featureId);
        break;
    }
  }

  function addDraftVertexFromPress(event: GestureResponderEvent): void {
    if (!gestureAllowed.current) return;
    if (Date.now() < suppressTapUntil.current) return;
    if ("detail" in event.nativeEvent && typeof event.nativeEvent.detail === "number" && event.nativeEvent.detail > 1) return;
    if (!Number.isFinite(event.nativeEvent.locationX) || !Number.isFinite(event.nativeEvent.locationY)) return;
    lastSvgPressAt.current = Date.now();
    addDraftVertexAtScreenPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
  }

  function startPressGesture(event: GestureResponderEvent): void {
    if (!gestureAllowed.current) return;
    pressStartPoint.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
  }

  function updatePressGesture(event: GestureResponderEvent): void {
    const start = pressStartPoint.current;
    if (!start) return;
    const next = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
    if (Math.hypot(next.x - start.x, next.y - start.y) > 10) pressStartPoint.current = null;
  }

  function releasePressGesture(event: GestureResponderEvent): void {
    const start = pressStartPoint.current;
    pressStartPoint.current = null;
    if (!start) return;
    const next = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
    if (Math.hypot(next.x - start.x, next.y - start.y) > 10) return;
    addDraftVertexFromPress(event);
  }

  function addDraftVertexFromWebClick(event: { nativeEvent?: { clientX?: number; clientY?: number; offsetX?: number; offsetY?: number; detail?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } }; clientX?: number; clientY?: number; detail?: number }): void {
    if (!gestureAllowed.current) return;
    if (Date.now() < suppressTapUntil.current) return;
    if ((event.nativeEvent?.detail ?? event.detail ?? 0) > 1) return;
    if (Date.now() - lastSvgPressAt.current < 80) return;
    const bounds = event.currentTarget?.getBoundingClientRect?.();
    const xPixels = bounds ? (event.clientX ?? event.nativeEvent?.clientX ?? NaN) - bounds.left : event.nativeEvent?.offsetX ?? NaN;
    const yPixels = bounds ? (event.clientY ?? event.nativeEvent?.clientY ?? NaN) - bounds.top : event.nativeEvent?.offsetY ?? NaN;
    addDraftVertexAtScreenPoint(xPixels, yPixels);
  }

  function closeDraftFromWebDoubleClick(event: { preventDefault?: () => void; stopPropagation?: () => void; nativeEvent?: { clientX?: number; clientY?: number; offsetX?: number; offsetY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } }; clientX?: number; clientY?: number }): void {
    event.preventDefault?.();
    event.stopPropagation?.();
    if (!designMode || !gestureAllowed.current || Date.now() < suppressTapUntil.current) return;
    const bounds = event.currentTarget?.getBoundingClientRect?.();
    const xPixels = bounds ? (event.clientX ?? event.nativeEvent?.clientX ?? NaN) - bounds.left : event.nativeEvent?.offsetX ?? NaN;
    const yPixels = bounds ? (event.clientY ?? event.nativeEvent?.clientY ?? NaN) - bounds.top : event.nativeEvent?.offsetY ?? NaN;
    if (!Number.isFinite(xPixels) || !Number.isFinite(yPixels)) return;
    const rawVertex = worldPointAtScreen(xPixels, yPixels);
    if (!rawVertex) return;
    const vertex = snapWorldPoint(rawVertex);
    handleDraftVertexIntent(vertex, true);
  }

  function worldPointAtScreen(xPixels: number, yPixels: number): XY | null {
    if (Platform.OS === "web") {
      // SVG engines can round large projected viewBox values. Follow the rendered transform.
      const svg = (surfaceRef.current as unknown as Element | null)?.querySelector("svg");
      const matrix = svg?.getScreenCTM();
      if (!svg || !matrix) return null;
      const bounds = svg.getBoundingClientRect();
      const point = new DOMPoint(bounds.left + xPixels, bounds.top + yPixels).matrixTransform(matrix.inverse());
      return Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: -point.y } : null;
    }
    return screenPointToWorld(mapState.viewport, { xPixels, yPixels },
      { widthPixels: mapPixelWidth, heightPixels: mapPixelHeight });
  }

  function addDraftVertexAtScreenPoint(xPixels: number, yPixels: number): void {
    if (!designMode) return;
    if (!Number.isFinite(xPixels) || !Number.isFinite(yPixels)) return;
    const rawVertex = worldPointAtScreen(xPixels, yPixels);
    if (!rawVertex) return;
    const vertex = snapWorldPoint(rawVertex);
    if (mapState.mode === "edit_vertices") {
      controller.moveSelectedVertexToPoint(vertex);
      return;
    }
    controller.handleProjectedPoint(vertex);
  }

  function addDraftVertexAtViewCenter(): void {
    controller.handleProjectedPoint(snapWorldPoint(mapState.viewport.center));
  }

  function snapWorldPoint(point: XY): XY {
    const snap = snapPointToGeometry(
      point,
      {
        vertices: [
          project.pivotCenter,
          project.waterSource,
          project.powerSource,
          ...mapFeatures.flatMap((feature) => {
            if (feature.geometry.type === "Point") return [feature.geometry.point];
            if (feature.geometry.type === "Circle") return [feature.geometry.center];
            return [];
          }),
        ],
        lines: [
          ...mapFeatures.flatMap((feature) => feature.geometry.type === "LineString" ? [feature.geometry.vertices] : []),
          mapState.draftVertices,
        ],
        rings: [
          project.fieldBoundary,
          ...project.obstacles.map((obstacle) => obstacle.polygon),
          ...mapFeatures.filter((feature) => feature.geometry.type === "Polygon" || feature.geometry.type === "Circle").flatMap(mapFeatureRings),
        ],
      },
      settings.drawing,
    );
    setLastSnap(snap ? { point: snap.point, kind: snap.kind } : null);
    return snap?.point ?? point;
  }

  function saveMapFeatureFromHud(): void {
    if (activeFeatureGeometry === "Point") {
      controller.handleProjectedPoint(snapWorldPoint(mapState.viewport.center));
    } else {
      controller.saveMapFeatureFromDraft();
    }
  }

  function selectMapFeature(featureId: string): void {
    if (!ownsCamera()) return;
    const nextId = activeSelectedMapFeatureId === featureId ? null : featureId;
    setLocalSelectedMapFeatureId(nextId);
    onSelectMapFeature?.(nextId);
    dispatch({ type: "select_feature", featureId: nextId });
  }

  const shortInspectView = externalHudLayout && windowHeight < 500 && mapState.mode === "pan" && mapState.draftVertices.length === 0;
  const shortLandscapeDraftHud = shortLandscape && designMode && !shortInspectView;
  const deferMapNotices = externalHudLayout && (compactLayout || shortLandscape || mapPixelWidth < 560 || shortInspectView);
  const legendIncludesNotices = deferMapNotices && Boolean(imageryPlan || referenceOverlayNotice);
  const visibleLabelObstructions = Object.entries(labelObstructions).filter(([id]) => id === "zoom"
    || (id === "legend" && deferMapNotices && !catalogHomeView)
    || (id === "pan" && !deferMapNotices)
    || (id === "draft" && !deferMapNotices)
    || (id === "notices" && !deferMapNotices && (imageryPlan || referenceOverlayNotice || (!catalogHomeView && externalHudLayout)))
    || (id === "bottom" && Boolean(bottomOverlay) && !externalCompactToolbar)).map(([id, rect]) => anchoredPixelBox(rect,
      { width: mapPixelWidth, height: mapPixelHeight },
      id === "draft" && externalHudLayout ? { left: 12, bottom: externalDraftBottom }
        : overlayAnchors[id as keyof typeof overlayAnchors] ?? {}));
  const placedLabels = catalogHomeView ? [] : placeMapLabels(labels, mapState.viewport,
    { width: mapPixelWidth, height: mapPixelHeight }, [
      ...project.fieldBoundary,
      ...project.obstacles.flatMap(obstacle => [...obstacle.polygon, centroid(obstacle.polygon)]),
      ...visibleMapFeatures.flatMap(feature => feature.geometry.type === "Point" ? [feature.geometry.point]
        : feature.geometry.type === "Circle" ? [feature.geometry.center,
          { x: feature.geometry.center.x + feature.geometry.radiusMeters, y: feature.geometry.center.y }] : feature.geometry.vertices),
    ], visibleLabelObstructions);
  function recordLabelObstruction(id: string, rect: PixelBox): void {
    setLabelObstructions(previous => {
      const old = previous[id];
      return old && old.x === rect.x && old.y === rect.y && old.width === rect.width && old.height === rect.height
        ? previous : { ...previous, [id]: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    });
  }
  const draftCommands = (
    <>
          <Pressable accessibilityRole="button" accessibilityLabel="Add draft vertex at view center" disabled={!designMode} onPress={addDraftVertexAtViewCenter} style={[styles.clearDraftButton, !designMode && styles.disabledDraftButton]}>
            <Text style={styles.clearDraftText}>{mapState.mode === "capture_point" ? "Capture Center" : "Add Center"}</Text>
          </Pressable>
          {mapState.mode === "edit_vertices" ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Select first boundary vertex" disabled={project.fieldBoundary.length === 0 || !designMode} onPress={selectFirstBoundaryVertex} style={[styles.clearDraftButton, (project.fieldBoundary.length === 0 || !designMode) && styles.disabledDraftButton]}>
                <Text style={styles.clearDraftText}>Boundary</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Select first obstacle vertex" disabled={!hasObstacleVertexSelection(project) || !designMode} onPress={selectFirstObstacleVertex} style={[styles.clearDraftButton, (!hasObstacleVertexSelection(project) || !designMode) && styles.disabledDraftButton]}>
                <Text style={styles.clearDraftText}>Obstacle</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Select first map feature vertex" disabled={!hasMapFeatureVertexSelection(project) || !designMode} onPress={selectFirstMapFeatureVertex} style={[styles.clearDraftButton, (!hasMapFeatureVertexSelection(project) || !designMode) && styles.disabledDraftButton]}>
                <Text style={styles.clearDraftText}>Feature</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Select previous editable vertex" disabled={!selectedVertex || !designMode} onPress={() => selectAdjacentVertex(-1)} style={[styles.clearDraftButton, (!selectedVertex || !designMode) && styles.disabledDraftButton]}>
                <Text style={styles.clearDraftText}>Prev</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Select next editable vertex" disabled={!selectedVertex || !designMode} onPress={() => selectAdjacentVertex(1)} style={[styles.clearDraftButton, (!selectedVertex || !designMode) && styles.disabledDraftButton]}>
                <Text style={styles.clearDraftText}>Next</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Insert vertex after selected" disabled={!canInsertSelectedVertex} onPress={insertAfterSelectedVertex} style={[styles.clearDraftButton, !canInsertSelectedVertex && styles.disabledDraftButton]} testID="svg-edit-insert-vertex">
                <Text style={styles.clearDraftText}>Insert</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Move selected vertex east" disabled={!selectedVertex || !designMode} onPress={() => nudgeSelectedVertex({ x: Math.max(1, settings.drawing.panStepMeters / 4), y: 0 })} style={[styles.clearDraftButton, (!selectedVertex || !designMode) && styles.disabledDraftButton]}>
                <Text style={styles.clearDraftText}>Nudge E</Text>
              </Pressable>
            </>
          ) : null}
          {mapState.mode !== "measure" ? <Pressable accessibilityRole="button" accessibilityLabel="Commit draft geometry" disabled={!canCommitCurrentDraft} onPress={commitDraft} style={[styles.clearDraftButton, canCommitCurrentDraft && styles.commitDraftButton, !canCommitCurrentDraft && styles.disabledDraftButton]}>
            <Text style={[styles.clearDraftText, canCommitCurrentDraft && styles.commitDraftText]}>Commit</Text>
          </Pressable> : null}
          {mapState.mode === "measure" ? <Pressable accessibilityRole="button" accessibilityLabel="Save utility map feature" disabled={!canSaveCurrentMapFeature} onPress={saveMapFeatureFromHud} style={[styles.clearDraftButton, canSaveCurrentMapFeature && styles.commitDraftButton, !canSaveCurrentMapFeature && styles.disabledDraftButton]}>
            <Text style={[styles.clearDraftText, canSaveCurrentMapFeature && styles.commitDraftText]}>{activeFeatureGeometry === "Point" ? "Use Center Point" : "Finish"}</Text>
          </Pressable> : null}
          {mapState.mode === "edit_vertices" ? <Pressable accessibilityRole="button" accessibilityLabel="Delete selected vertex" disabled={!canDeleteSelectedVertex} onPress={deleteSelectedVertex} style={[styles.clearDraftButton, !canDeleteSelectedVertex && styles.disabledDraftButton]}>
            <Text style={styles.clearDraftText}>Delete Vertex</Text>
          </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel="Remove last draft vertex" disabled={!controller.canUndoDraftVertex} onPress={controller.undoDraftVertex} style={[styles.clearDraftButton, !controller.canUndoDraftVertex && styles.disabledDraftButton]} testID="svg-action-undo-draft" {...(Platform.OS === "web" ? { title: "Remove last draft vertex" } : {})}>
            <Undo2 size={17} color="#173428" />
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel="Clear draft vertices" onPress={() => dispatch({ type: "clear_draft" })} style={styles.clearDraftButton}>
            <Text style={styles.clearDraftText}>Clear</Text>
          </Pressable>
    </>
  );
  const draftHud = (
    <View
      style={[styles.draftHud, externalHudLayout && !deferMapNotices && [styles.draftHudExternal, { bottom: externalDraftBottom }],
        deferMapNotices && !shortLandscapeDraftHud && styles.draftHudCompact,
        shortLandscapeDraftHud && styles.draftHudShortLandscape]}
      testID="svg-map-draft-hud"
      onLayout={(event) => { fitObstructions.current.draftTop = event.nativeEvent.layout.y; recordLabelObstruction("draft", event.nativeEvent.layout); }}
    >
      <Text numberOfLines={shortLandscapeDraftHud ? 1 : undefined}
        style={[styles.draftHudText, shortLandscapeDraftHud && styles.draftHudTextShortLandscape]}>
        {designMode
          ? `${mapState.mode === "measure" ? activeFeatureGeometry.replace("String", "") : mapState.activeLayer.replaceAll("_", " ")} \u00b7 ${mapState.draftVertices.length} pts${selectedVertex ? ` \u00b7 ${selectedProjectVertexText(project, selectedVertex)}` : ""}`
          : catalogHomeView ? "Catalog view \u00b7 open a saved design to edit projected XY geometry" : "Layout \u00b7 RTK-only mutation \u00b7 pointer editing controls hidden"}
      </Text>
      {designMode && mapState.draftVertices.length > 1 ? <Text numberOfLines={shortLandscapeDraftHud ? 1 : undefined}
        style={[styles.draftHudText, shortLandscapeDraftHud && styles.draftHudTextShortLandscape]} testID="svg-map-draft-measurement">{draftMeasurementText(mapState.mode === "measure" ? activeFeatureGeometry : "Polygon", mapState.draftVertices, project.projectCrs, settings.unitSystem)}</Text> : null}
      {deferMapNotices ? (
        <View style={shortLandscapeDraftHud ? styles.draftCommandSlotShortLandscape : styles.draftCommandSlotCompact}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            style={[styles.draftCommandScroller, shortLandscapeDraftHud && styles.draftCommandScrollerShortLandscape]}
            contentContainerStyle={styles.draftCommandRow} testID="svg-draft-command-scroller">
            {designMode ? draftCommands : null}
          </ScrollView>
        </View>
      ) : designMode ? draftCommands : null}
    </View>
  );

  return (
    <View style={[styles.shell, compactLayout && styles.shellCompact, webShellClip]} testID="svg-map-shell">
      <View style={[styles.headerRow, deferMapNotices && styles.headerRowCompact,
        shortLandscape && styles.headerRowShortLandscape]}>
        <View style={deferMapNotices ? styles.compactHeaderTitle : undefined}>
          {!deferMapNotices ? <Text style={styles.title}>Map Workspace</Text> : null}
          <Text style={styles.subtitle}>
            {catalogHomeView
              ? deferMapNotices ? "Catalog" : "North America project catalog · no project geometry loaded"
              : deferMapNotices ? project.projectCrs : `${project.projectCrs} · ${workflowModeLabel(settings.mappingWorkflowMode)} · ${mapState.mode.replaceAll("_", " ")} · zoom ${mapState.viewport.zoomLevel.toFixed(2)}x`}
          </Text>
        </View>
        <WorkflowSegmentedControl
          mode={settings.mappingWorkflowMode}
          onChange={(mode) => onMappingWorkflowModeChange?.(mode)}
          short={shortLandscape}
        />
        {shortLandscapeDraftHud ? draftHud : null}
        {!externalHudLayout ? (
          <View style={[styles.modeRow, compactLayout && styles.modeRowCompact]}>
            <ToolButton active={mapState.mode === "pan"} icon={<Hand size={18} />} label="Pan" onPress={() => setToolMode("pan")} />
            {designMode ? (
              <>
                <ToolButton active={mapState.mode === "draw_boundary"} icon={<PencilLine size={18} />} label="Boundary" onPress={() => setToolMode("draw_boundary", "field_boundary")} />
                <ToolButton active={mapState.mode === "mark_obstacle"} icon={<Crosshair size={18} />} label="Obstacle" onPress={() => setToolMode("mark_obstacle", "obstacle")} />
                <ToolButton active={mapState.mode === "edit_vertices"} icon={<Crosshair size={18} />} label="Edit" onPress={() => dispatch({ type: "set_mode", mode: "edit_vertices" })} />
                <ToolButton active={mapState.mode === "capture_point"} icon={<Satellite size={18} />} label="Survey" onPress={() => setToolMode("capture_point", "control_point")} />
                <ToolButton active={mapState.mode === "measure"} icon={<Ruler size={18} />} label="Measure" onPress={() => setToolMode("measure")} />
                <ToolButton active={mapState.mode === "place_pivot"} icon={<LocateFixed size={18} />} label="Pivot" onPress={() => setToolMode("place_pivot", "pivot_center")} />
              </>
            ) : null}
          </View>
        ) : null}
      </View>

      <Text accessibilityLiveRegion="polite" style={[styles.actionStatus, (shortInspectView || shortLandscape) && styles.shortInspectStatus]} testID="svg-map-action-status">
        {controller.status}
      </Text>
      <View
        accessibilityLabel="Layout map drawing surface"
        style={[styles.mapSurface, { backgroundColor: palette.background }]}
        testID="layout-map-drawing-surface"
        ref={surfaceRef}
        onLayout={(event) => {
          if (Platform.OS === "web" && typeof ResizeObserver !== "undefined") return;
          setMapPixelWidth(Math.max(1, event.nativeEvent.layout.width));
          setMapPixelHeight(Math.max(1, event.nativeEvent.layout.height));
        }}
        {...panHandlers}
      >
        <Svg
          viewBox={viewportToSvgViewBox(mapState.viewport)}
          style={[styles.svg, compactLayout && styles.svgCompact]}
          testID="layout-map-svg"
          {...svgInteractionProps}
        >
          <Rect
            x={minX}
            y={minY}
            width={viewWidth}
            height={viewHeight}
            fill={palette.background}
          />
          {imageryPlan?.tiles.map((tile) => (
            <SvgImage
              key={tile.key}
              href={{ uri: tile.href }}
              opacity={0.66}
              preserveAspectRatio="none"
              x={tile.projectedBounds.minX}
              y={-tile.projectedBounds.maxY}
              width={tile.projectedBounds.maxX - tile.projectedBounds.minX}
              height={tile.projectedBounds.maxY - tile.projectedBounds.minY}
            />
          ))}
          <MapBackground minX={minX} maxX={maxX} minY={minY} maxY={maxY} styleName={settings.mapStyle} />
          <Grid minX={minX} maxX={maxX} minY={minY} maxY={maxY} stroke={palette.grid} />
          {catalogHomeView ? (
            <CatalogHomeOverlay minX={minX} maxX={maxX} minY={minY} maxY={maxY} palette={palette} />
          ) : (
            <>
              {canonicalMachineLayersVisible ? <Path d={ringsToSvgPath(result.allowedCoverage)} fill={palette.allowed} opacity={0.54} /> : null}
              {advisoryFieldPivotPlanVisible && advisoryFieldPivotPlan ? (
                <AdvisoryFieldPivotOverlay palette={palette} plan={advisoryFieldPivotPlan} scale={symbolScale} />
              ) : null}
              {advisoryMachineRenderVisible && advisoryMachineRenderModel ? (
                <AdvisoryMachineRenderOverlay model={advisoryMachineRenderModel} palette={palette} scale={symbolScale} />
              ) : null}
              <LayoutPathOverlayLayer overlays={layoutPathOverlays} palette={palette} />
              <Path d={fieldPath} fill="none" stroke={palette.fieldStroke} strokeWidth={7} strokeLinejoin="round" />
              <Path d={ringsToSvgPath(result.obstacles)} fill={palette.obstacle} opacity={0.78} stroke={palette.obstacleStroke} strokeWidth={3} />
              <EditableRing
                color={palette.fieldStroke}
                layerLabel="Boundary"
                scale={symbolScale}
                selected={selectedVertex?.layer === "field_boundary" ? selectedVertex.vertexIndex : null}
                vertices={project.fieldBoundary}
                onSelect={designMode ? (vertexIndex) => selectVertex({ layer: "field_boundary", vertexIndex }) : undefined}
              />
              {project.obstacles.map((obstacle) => (
                <React.Fragment key={obstacle.id}>
                  <G transform={`translate(${centroid(obstacle.polygon).x}, ${-centroid(obstacle.polygon).y}) scale(${symbolScale.px(0.45)})`}>
                    <ObstacleSymbol obstacle={obstacle} color={palette.obstacleStroke} />
                  </G>
                  <EditableRing
                    color={palette.obstacleStroke}
                    layerLabel={`${obstacle.name} obstacle`}
                    scale={symbolScale}
                    selected={selectedVertex?.layer === "obstacle" && selectedVertex.obstacleId === obstacle.id ? selectedVertex.vertexIndex : null}
                    vertices={obstacle.polygon}
                    onSelect={designMode ? (vertexIndex) => selectVertex({ layer: "obstacle", obstacleId: obstacle.id, vertexIndex }) : undefined}
                  />
                </React.Fragment>
              ))}
              {visibleMapFeatures.map((feature) => (
                <React.Fragment key={feature.id}>
                <MapFeatureSymbol
                  feature={feature}
                  palette={palette}
                  scale={symbolScale}
                  selected={activeSelectedMapFeatureId === feature.id}
                  onSelect={() => selectMapFeature(feature.id)}
                />
                  {shouldShowEditableMapFeatureHandles(feature, designMode, mapState.mode, activeSelectedMapFeatureId === feature.id) ? (
                    <EditableMapFeatureHandles
                      feature={feature}
                      palette={palette}
                      scale={symbolScale}
                      selected={selectedVertex?.layer === "map_feature" && selectedVertex.featureId === feature.id ? selectedVertex.vertexIndex : null}
                      onSelect={(vertexIndex) => selectVertex({ layer: "map_feature", featureId: feature.id, vertexIndex })}
                    />
                  ) : null}
                </React.Fragment>
              ))}
              <DraftVertices vertices={mapState.draftVertices} color={palette.draft} scale={symbolScale} polygon={mapState.mode !== "measure" || activeFeatureGeometry === "Polygon"} />
              {lastSnap ? <SnapMarker point={lastSnap.point} color={palette.snap} scale={symbolScale} /> : null}
              <InfrastructureSymbol point={project.pivotCenter} color={palette.pivot} kind="pivot_center" scale={symbolScale} />
              <InfrastructureSymbol point={project.waterSource} color={palette.water} kind="water_source" scale={symbolScale} />
              <InfrastructureSymbol point={project.powerSource} color={palette.power} kind="power_source" scale={symbolScale} />
              {project.surveyPoints.map((point) => (
                <SurveyPointSymbol key={point.id} point={point} color={palette.survey} scale={symbolScale} />
              ))}
              {result.towers.map((tower) => (
                <React.Fragment key={tower.towerIndex}>
                  <Line
                    x1={project.pivotCenter.x}
                    y1={-project.pivotCenter.y}
                    x2={tower.point.x}
                    y2={-tower.point.y}
                    stroke={palette.tower}
                    strokeDasharray="7 8"
                    strokeWidth={1.8}
                  />
                  <Circle cx={tower.point.x} cy={-tower.point.y} r={symbolScale.px(3)} fill={palette.markerFill} stroke={palette.fieldStroke} strokeWidth={symbolScale.stroke(1.5)} />
                </React.Fragment>
              ))}
              <G testID="svg-map-labels">
                {placedLabels.map(label => <G key={label.id} accessibilityLabel={label.text}
                  {...svgElementInteractionProps(() => { if (label.featureId) selectMapFeature(label.featureId); })}>
                  <Rect x={label.svgX - symbolScale.px(3)} y={label.svgY - symbolScale.px(13)}
                    width={symbolScale.px(label.box.width - 2)} height={symbolScale.px(20)}
                    fill={palette.markerFill} opacity={0.9} rx={symbolScale.px(2)} />
                  <SvgText x={label.svgX} y={label.svgY} fill={label.color} fontSize={symbolScale.font(MAP_LABEL_FONT_PIXELS)}
                    fontFamily="monospace" fontWeight="600" testID={`svg-map-label-${label.id}`}>{label.displayText}</SvgText>
                </G>)}
              </G>
            </>
          )}
        </Svg>
        {mapClickLayerActive ? (
          <View
            accessibilityLabel="Map drawing click layer"
            onResponderGrant={startPressGesture}
            onResponderMove={updatePressGesture}
            onResponderRelease={releasePressGesture}
            onStartShouldSetResponder={() => true}
            style={[styles.mapClickLayer, compactLayout && styles.mapClickLayerCompact]}
            testID="layout-map-click-layer"
            {...mapClickLayerProps}
          />
        ) : null}

        <View style={[styles.zoomControls, deferMapNotices && styles.zoomControlsCompact]} testID="svg-map-zoom-controls"
          onLayout={event => recordLabelObstruction("zoom", event.nativeEvent.layout)}>
          <IconControl icon={<Plus size={22} />} label="Zoom in" tooltipPlacement={deferMapNotices ? "below" : "left"} onPress={() => dispatch({ type: "zoom", factor: settings.drawing.zoomStepFactor })} />
          <IconControl icon={<Minus size={22} />} label="Zoom out" tooltipPlacement={deferMapNotices ? "below" : "left"} onPress={() => dispatch({ type: "zoom", factor: 1 / settings.drawing.zoomStepFactor })} />
          <IconControl icon={<Scan size={20} />} label="Fit field" tooltipPlacement={deferMapNotices ? "below" : "left"} disabled={catalogHomeView || !fieldBounds} onPress={fitField} testID="svg-map-fit-field" />
        </View>
        {deferMapNotices && !catalogHomeView ? <View style={styles.compactLegendControl}
          onLayout={event => recordLabelObstruction("legend", event.nativeEvent.layout)}>
          <IconControl icon={<Layers size={20} />} label={legendIncludesNotices ? "Map legend and layer status" : "Map legend"} tooltipPlacement="belowStart" onPress={() => setLegendOpen(true)} testID="svg-map-legend-open" />
        </View> : null}

        {!deferMapNotices ? <View style={styles.panControls}
          onLayout={(event) => { fitObstructions.current.panWidth = event.nativeEvent.layout.width; recordLabelObstruction("pan", event.nativeEvent.layout); }}>
          <IconControl icon={<ArrowUp size={20} />} label="Pan north" onPress={() => dispatch({ type: "pan", delta: { x: 0, y: settings.drawing.panStepMeters } })} />
          <View style={styles.panMiddle}>
            <IconControl icon={<ArrowLeft size={20} />} label="Pan west" onPress={() => dispatch({ type: "pan", delta: { x: -settings.drawing.panStepMeters, y: 0 } })} />
            <IconControl icon={<ArrowRight size={20} />} label="Pan east" onPress={() => dispatch({ type: "pan", delta: { x: settings.drawing.panStepMeters, y: 0 } })} />
          </View>
          <IconControl icon={<ArrowDown size={20} />} label="Pan south" onPress={() => dispatch({ type: "pan", delta: { x: 0, y: -settings.drawing.panStepMeters } })} />
        </View> : null}
        {!deferMapNotices ? draftHud : null}
        {!deferMapNotices && (imageryPlan || referenceOverlayNotice || (!catalogHomeView && externalHudLayout)) ? (
          <View pointerEvents="none" style={styles.topOverlayStack} testID="svg-map-top-overlay-stack"
            onLayout={(event) => { const { y, height } = event.nativeEvent.layout; fitObstructions.current.top = y + height; recordLabelObstruction("notices", event.nativeEvent.layout); }}>
            {!catalogHomeView && externalHudLayout ? (
              <View style={styles.compactLegendBadge} testID="svg-map-compact-legend">
                <LegendSwatch color="#6cb6df" label="Wet" />
                <LegendSwatch color={palette.wheelTrack} label="LRDU / track" />
                <LegendSwatch color="#e68b58" label="Outside" />
                <LegendSwatch color="#c64f43" label="Obstacle" />
                <LegendSwatch color={palette.utility} label="Feature" />
              </View>
            ) : null}
            {!deferMapNotices ? <SvgMapNotices imageryPlan={imageryPlan} referenceOverlayNotice={referenceOverlayNotice} /> : null}
          </View>
        ) : null}
        {bottomOverlay && !externalCompactToolbar ? (
          <View pointerEvents="box-none" style={styles.bottomOverlaySlot} testID="svg-map-bottom-overlay"
            onLayout={(event) => { fitObstructions.current.bottom = event.nativeEvent.layout.height; recordLabelObstruction("bottom", event.nativeEvent.layout); }}>
            {bottomOverlay}
          </View>
        ) : null}
      </View>

      {deferMapNotices && !shortInspectView && !shortLandscapeDraftHud && !shortLandscape ? draftHud : null}
      {bottomOverlay && externalCompactToolbar ? (
        <View style={styles.compactToolbarSlot} testID="svg-map-bottom-overlay">{bottomOverlay}</View>
      ) : null}

      {deferMapNotices && catalogHomeView && !shortLandscape && !shortInspectView && (imageryPlan || referenceOverlayNotice) ? (
        <View style={styles.compactMapNoticeBand}>
          <SvgMapNotices compact imageryPlan={imageryPlan} referenceOverlayNotice={referenceOverlayNotice} />
        </View>
      ) : null}
      {deferMapNotices && !catalogHomeView && imageryPlan && !imageryPlan.error ? (
        <Text style={styles.compactImageryCredit} testID="svg-map-imagery-credit">
          {imageryPlan.provider.attribution} · {imageryPlan.provider.licenseText}
        </Text>
      ) : null}

      <MapLibreImageryPreview
        project={project}
        result={result}
        settings={settings}
        visible={shouldShowMapLibrePreview}
      />

      {designMode && !externalHudLayout ? (
      <View style={styles.layerRow}>
        {UTILITY_FEATURE_OPTIONS.map((option) => (
          <FeatureKindButton
            key={option.kind}
            active={mapFeatureKind === option.kind}
            disabled={!designMode}
            label={option.label}
            onPress={() => {
              setMapFeatureKind(option.kind);
              setToolMode("measure");
            }}
          />
        ))}
      </View>
      ) : null}

      {designMode && !externalHudLayout ? (
      <View style={styles.layerRow}>
        <LayerButton active={mapState.activeLayer === "field_boundary"} disabled={!designMode} label="Boundary" layer="field_boundary" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "obstacle"} disabled={!designMode} label="Obstacle" layer="obstacle" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "road"} disabled={!designMode} label="Road" layer="road" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "ditch"} disabled={!designMode} label="Ditch" layer="ditch" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "fence"} disabled={!designMode} label="Fence" layer="fence" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "exclusion"} disabled={!designMode} label="Exclusion" layer="exclusion" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "pivot_center"} disabled={!designMode} label="Pivot" layer="pivot_center" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "water_source"} disabled={!designMode} label="Water" layer="water_source" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "power_source"} disabled={!designMode} label="Power" layer="power_source" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "control_point"} disabled={!designMode} label="Control" layer="control_point" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
        <LayerButton active={mapState.activeLayer === "note_point"} disabled={!designMode} label="Note" layer="note_point" onPress={(layer) => dispatch({ type: "set_active_layer", activeLayer: layer })} />
      </View>
      ) : null}

      {!catalogHomeView && !externalHudLayout ? (
        <FullMapLegend palette={palette} />
      ) : null}
      <Modal transparent visible={legendOpen} onRequestClose={() => setLegendOpen(false)} animationType="fade">
        <View style={styles.noticeBackdrop}>
          <View accessibilityViewIsModal style={styles.noticeDialog} testID="svg-map-legend-dialog">
            <View style={styles.noticeDialogHeader}>
              <Text style={styles.noticeDialogTitle}>{legendIncludesNotices ? "Map Legend and Layer Status" : "Map Legend"}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close map legend" onPress={() => setLegendOpen(false)} style={styles.noticeClose}>
                <X size={20} color="#26392f" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.noticeDialogBody}>
              <FullMapLegend palette={palette} />
              {legendIncludesNotices ? <SvgMapNotices imageryPlan={imageryPlan} referenceOverlayNotice={referenceOverlayNotice} /> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export const LayoutMap = SvgMapSurface;

function FullMapLegend({ palette }: { palette: MapPalette }): React.JSX.Element {
  return <View style={styles.legend}>
    <LegendSwatch color="#6cb6df" label="Allowed wet area" />
    <LegendSwatch color="#63c7cf" label="End gun" />
    <LegendSwatch color={palette.wheelTrack} label="Tower / LRDU path" />
    <LegendSwatch color={palette.machinePath} label="Machine-end path" />
    <LegendSwatch color={palette.endGun} label="End-gun reach" />
    <LegendSwatch color={palette.cornerArmTrack} label="Configured corner-arm preview" />
    <LegendSwatch color="#e68b58" label="Outside field" />
    <LegendSwatch color={palette.advisory} label="Generated advisory plan" />
    <LegendSwatch color="#c64f43" label="Obstacle/no-spray" />
    <LegendSwatch color={palette.survey} label="Survey/object point" />
    <LegendSwatch color={palette.utility} label="Utility map feature" />
  </View>;
}

function SvgMapNotices({
  compact = false,
  imageryPlan,
  referenceOverlayNotice,
}: {
  compact?: boolean;
  imageryPlan: ReturnType<typeof planOnlineImageryTiles> | null;
  referenceOverlayNotice: ReturnType<typeof buildMapReferenceViewModel>["reference"] | null;
}): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const details = (
    <View style={styles.mapNoticeStack} testID={compact ? "svg-map-layer-status-details" : "svg-map-status-notices"}>
      {imageryPlan ? (
        <View style={styles.imageryBadge}>
          <Text style={styles.imageryBadgeText}>
            {imageryPlan.error ? `Imagery unavailable: ${imageryPlan.error}` : `${imageryPlan.provider.name} · z${imageryPlan.tiles[0]?.z ?? "-"} · ${imageryPlan.tiles.length} tiles${imageryPlan.capped ? " capped" : ""}`}
          </Text>
          <Text style={styles.imageryBadgeSubtext}>
            {imageryPlan.provider.attribution} · {imageryPlan.provider.licenseText}
          </Text>
        </View>
      ) : null}
      {referenceOverlayNotice ? (
        <View style={styles.referenceOverlayBadge} testID="svg-reference-overlay-unavailable">
          <Text style={styles.imageryBadgeText}>Reference overlays unavailable</Text>
          <Text style={styles.imageryBadgeSubtext}>{referenceOverlayNotice.reason}</Text>
        </View>
      ) : null}
    </View>
  );
  if (!compact) return details;
  const summary = [imageryPlan ? imageryPlan.error ? "Imagery unavailable" : "Imagery active" : null,
    referenceOverlayNotice ? "References unavailable" : null].filter(Boolean).join(" / ");
  return <View testID="svg-map-status-notices">
    <Pressable accessibilityRole="button" accessibilityLabel="Open map layer status" onPress={() => setDetailsOpen(true)}
      style={styles.compactNoticeButton} testID="svg-map-layer-status-open">
      <Satellite size={18} color="#405448" />
      <Text style={styles.compactNoticeSummary}>{summary}</Text>
      <ChevronDown size={18} color="#405448" />
    </Pressable>
    {imageryPlan && !imageryPlan.error ? <Text style={styles.imageryBadgeSubtext}>
      {imageryPlan.provider.attribution} · {imageryPlan.provider.licenseText}
    </Text> : null}
    <Modal transparent visible={detailsOpen} onRequestClose={() => setDetailsOpen(false)} animationType="fade">
      <View style={styles.noticeBackdrop}>
        <View accessibilityViewIsModal style={styles.noticeDialog} testID="svg-map-layer-status-dialog">
          <View style={styles.noticeDialogHeader}>
            <Text style={styles.noticeDialogTitle}>Map Layer Status</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close map layer status" onPress={() => setDetailsOpen(false)} style={styles.noticeClose}>
              <X size={20} color="#26392f" />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.noticeDialogBody}>{details}</ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

function shouldShowEditableMapFeatureHandles(
  feature: ProjectMapFeature,
  designMode: boolean,
  mode: DrawingMapState["mode"],
  selected: boolean,
): boolean {
  if (!designMode) return false;
  if (!isEvidencePreferredMapFeature(feature)) return true;
  return selected && mode === "edit_vertices";
}

function isEvidencePreferredMapFeature(feature: ProjectMapFeature): boolean {
  return feature.properties?.preferredMachineOutline === true
    || feature.properties?.advisoryDesignRole === "preferred_machine_outline"
    || feature.properties?.evidenceOnly === true;
}

function isGeneratedMeasurementCircleFeature(feature: ProjectMapFeature): boolean {
  return feature.geometry.type === "Circle"
    && feature.properties?.generatedFromImportedMeasurement === true;
}

function mapFeatureRings(feature: ProjectMapFeature): XY[][] {
  if (feature.geometry.type === "Point") return [];
  if (feature.geometry.type === "LineString") return [feature.geometry.vertices];
  if (feature.geometry.type === "Polygon") return [feature.geometry.vertices];
  return [createCirclePolygon(feature.geometry.center, feature.geometry.radiusMeters, 72)];
}

function Grid({ minX, maxX, minY, maxY, stroke }: { minX: number; maxX: number; minY: number; maxY: number; stroke: string }): React.JSX.Element {
  const spacing = 100;
  const verticals: number[] = [];
  const horizontals: number[] = [];
  for (let x = Math.ceil(minX / spacing) * spacing; x <= maxX; x += spacing) verticals.push(x);
  for (let y = Math.ceil(minY / spacing) * spacing; y <= maxY; y += spacing) horizontals.push(y);

  return (
    <>
      {verticals.map((x) => <Line key={`v-${x}`} x1={x} y1={minY} x2={x} y2={maxY} stroke={stroke} strokeWidth={1.2} />)}
      {horizontals.map((y) => <Line key={`h-${y}`} x1={minX} y1={y} x2={maxX} y2={y} stroke={stroke} strokeWidth={1.2} />)}
    </>
  );
}

function MapBackground({ minX, maxX, minY, maxY, styleName }: { minX: number; maxX: number; minY: number; maxY: number; styleName: MapStyle }): React.JSX.Element {
  if (styleName !== "imagery_package" && styleName !== "topographic") return <></>;

  const blocks: React.JSX.Element[] = [];
  const size = styleName === "imagery_package" ? 180 : 140;
  let index = 0;
  for (let x = Math.floor(minX / size) * size; x <= maxX; x += size) {
    for (let y = Math.floor(minY / size) * size; y <= maxY; y += size) {
      const even = (Math.round(x / size) + Math.round(y / size)) % 2 === 0;
      if (styleName === "imagery_package") {
        blocks.push(
          <Rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width={size}
            height={size}
            fill={even ? "#dfe4d2" : "#cfd9c3"}
            opacity={0.55}
          />,
        );
      } else if (index % 2 === 0) {
        blocks.push(<Line key={`contour-${x}-${y}`} x1={x} y1={y + size / 2} x2={x + size} y2={y + size / 4} stroke="#b6a66d" strokeWidth={1.4} opacity={0.6} />);
      }
      index += 1;
    }
  }
  return <>{blocks}</>;
}

function InfrastructureSymbol({ color, kind, point: anchor, scale: displayScale }: { color: string; kind: InfrastructurePoint; point: XY; scale: SvgSymbolScale }): React.JSX.Element {
  const point = { x: 0, y: 0 }, y = 0;
  const scale = { px: (value: number) => value, stroke: (value: number) => value };
  return (
    <G transform={`translate(${anchor.x}, ${-anchor.y}) scale(${displayScale.px(0.45)})`} testID={`svg-map-symbol-${kind}`}>
      {kind === "pivot_center" ? (
        <>
          <Circle cx={point.x} cy={y} r={scale.px(18)} fill="#fffef8" stroke={color} strokeWidth={scale.stroke(5)} />
          <Circle cx={point.x} cy={y} r={scale.px(6)} fill={color} />
          <Line x1={point.x - scale.px(25)} y1={y} x2={point.x + scale.px(25)} y2={y} stroke={color} strokeWidth={scale.stroke(4)} />
          <Line x1={point.x} y1={y - scale.px(25)} x2={point.x} y2={y + scale.px(25)} stroke={color} strokeWidth={scale.stroke(4)} />
        </>
      ) : null}
      {kind === "water_source" ? (
        <Path d={`M ${point.x} ${y - scale.px(24)} C ${point.x + scale.px(20)} ${y - scale.px(2)}, ${point.x + scale.px(16)} ${y + scale.px(19)}, ${point.x} ${y + scale.px(21)} C ${point.x - scale.px(16)} ${y + scale.px(19)}, ${point.x - scale.px(20)} ${y - scale.px(2)}, ${point.x} ${y - scale.px(24)} Z`} fill="#fffef8" stroke={color} strokeWidth={scale.stroke(5)} />
      ) : null}
      {kind === "power_source" ? (
        <Path d={`M ${point.x - scale.px(5)} ${y - scale.px(25)} L ${point.x + scale.px(18)} ${y - scale.px(25)} L ${point.x + scale.px(4)} ${y - scale.px(3)} L ${point.x + scale.px(20)} ${y - scale.px(3)} L ${point.x - scale.px(9)} ${y + scale.px(26)} L ${point.x - scale.px(1)} ${y + scale.px(5)} L ${point.x - scale.px(19)} ${y + scale.px(5)} Z`} fill="#fffef8" stroke={color} strokeWidth={scale.stroke(5)} />
      ) : null}
    </G>
  );
}

function SurveyPointSymbol({ color, point, scale }: { color: string; point: SurveyPoint; scale: SvgSymbolScale }): React.JSX.Element {
  const x = point.projected.x;
  const y = -point.projected.y;
  if (point.role === "note") {
    return (
      <>
        <Rect x={x - scale.px(5)} y={y - scale.px(5)} width={scale.px(10)} height={scale.px(10)} rx={scale.px(2)} fill="#fffef8" stroke={color} strokeWidth={scale.stroke(1.5)} />
      </>
    );
  }
  return (
    <>
      <Circle cx={x} cy={y} r={scale.px(4)} fill="#fffef8" stroke={color} strokeWidth={scale.stroke(1.5)} />
    </>
  );
}

function AdvisoryFieldPivotOverlay({
  palette,
  plan,
  scale,
}: {
  palette: MapPalette;
  plan: AdvisoryFieldPivotPlan;
  scale: SvgSymbolScale;
}): React.JSX.Element {
  const coveragePath = ringsToSvgPath(plan.modeledCoverageUnion);
  return (
    <G accessibilityLabel="Generated advisory field pivot overlay" testID="svg-advisory-generated-field-pivot-overlay">
      {coveragePath ? (
        <Path
          d={coveragePath}
          fill={palette.advisory}
          opacity={0.2}
          stroke={palette.advisoryStroke}
          strokeDasharray="14 8"
          strokeLinejoin="round"
          strokeWidth={2.4}
        />
      ) : null}
      {plan.candidates.map((candidate) => {
        const envelopePath = ringsToSvgPath(candidate.machineEnvelope);
        const modeledPath = ringsToSvgPath(candidate.modeledCoverage);
        return (
          <React.Fragment key={candidate.id}>
            {modeledPath ? <Path d={modeledPath} fill={palette.advisory} opacity={0.08} /> : null}
            {envelopePath ? (
              <Path
                d={envelopePath}
                fill="none"
                opacity={0.9}
                stroke={palette.advisoryStroke}
                strokeDasharray="20 10"
                strokeLinejoin="round"
                strokeWidth={3}
              />
            ) : null}
            <Circle cx={candidate.pivotCenter.x} cy={-candidate.pivotCenter.y} r={scale.px(7)} fill="#fffef8" stroke={palette.advisoryStroke} strokeWidth={scale.stroke(2)} />
            <Circle cx={candidate.pivotCenter.x} cy={-candidate.pivotCenter.y} r={scale.px(2)} fill={palette.advisoryStroke} />
          </React.Fragment>
        );
      })}
    </G>
  );
}

function AdvisoryMachineRenderOverlay({
  model,
  palette,
  scale,
}: {
  model: AdvisoryMachineRenderModel;
  palette: MapPalette;
  scale: SvgSymbolScale;
}): React.JSX.Element | null {
  if (model.surfaces.length === 0) return null;
  return (
    <G accessibilityLabel="Advisory machine render overlay" testID="svg-advisory-machine-render-overlay">
      {model.surfaces.map((surface) => (
        <AdvisoryMachineSurfaceOverlay key={surface.instanceId} palette={palette} surface={surface} />
      ))}
      {model.instances.map((instance) => (
        <React.Fragment key={instance.id}>
          <Circle cx={instance.pivotCenter.x} cy={-instance.pivotCenter.y} r={scale.px(6)} fill="#fffef8" stroke={palette.machinePath} strokeWidth={scale.stroke(2)} />
          <Circle cx={instance.pivotCenter.x} cy={-instance.pivotCenter.y} r={scale.px(2)} fill={palette.machinePath} />
        </React.Fragment>
      ))}
      {model.conflicts.map((conflict) => {
        const conflictPath = ringsToSvgPath(conflict.collisionZone);
        return conflictPath ? (
          <Path
            key={conflict.id}
            d={conflictPath}
            fill="#b00020"
            opacity={0.28}
            stroke="#7f1d1d"
            strokeLinejoin="round"
            strokeWidth={3}
          />
        ) : null;
      })}
    </G>
  );
}

function AdvisoryMachineSurfaceOverlay({
  palette,
  surface,
}: {
  palette: MapPalette;
  surface: AdvisoryMachineRenderSurface;
}): React.JSX.Element {
  const preferredPath = lineSvgPath(surface.preferredOutlinePath);
  const standardPath = ringsToSvgPath(surface.standardPivotCoverage);
  const endGunPath = ringsToSvgPath(surface.endGunWetAnnulus);
  const cornerArmPath = ringsToSvgPath(surface.cornerArmCoverage);
  const wetPath = ringsToSvgPath(surface.clippedWetCoverage);
  const physicalPath = ringsToSvgPath(surface.physicalEnvelope);
  return (
    <G>
      {wetPath ? <Path d={wetPath} fill={palette.endGun} opacity={0.08} stroke="none" /> : null}
      {standardPath ? <Path d={standardPath} fill={palette.allowed} opacity={0.1} stroke={palette.allowed} strokeLinejoin="round" strokeWidth={1.5} /> : null}
      {endGunPath ? <Path d={endGunPath} fill={palette.endGun} opacity={0.11} stroke={palette.endGun} strokeDasharray="6 5" strokeLinejoin="round" strokeWidth={1.7} /> : null}
      {cornerArmPath ? <Path d={cornerArmPath} fill={palette.cornerArmReach} opacity={0.11} stroke={palette.cornerArmReach} strokeDasharray="7 5" strokeLinejoin="round" strokeWidth={1.8} /> : null}
      {physicalPath ? <Path d={physicalPath} fill="none" opacity={0.9} stroke={palette.machinePath} strokeLinejoin="round" strokeWidth={2.4} /> : null}
      <AdvisoryMachinePathEnvelope overlay={surface.lrduPath} stroke={palette.machinePath} width={2.8} />
      {surface.towerPaths.map((overlay) => (
        <AdvisoryMachinePathEnvelope key={`${surface.instanceId}-${overlay.kind}-${overlay.towerIndex}`} overlay={overlay} stroke={palette.wheelTrack} width={1.7} dash="2 3" />
      ))}
      <AdvisoryMachinePathEnvelope overlay={surface.cornerArmWheelPath} stroke={palette.cornerArmTrack} width={2.1} dash="5 5" />
      <AdvisoryMachinePathEnvelope overlay={surface.cornerArmOverhangEndPath} stroke={palette.cornerArmReach} width={2.3} dash="12 7" />
      {preferredPath ? (
        <Path
          d={preferredPath}
          fill="none"
          opacity={0.9}
          stroke={palette.fieldStroke}
          strokeDasharray="13 7"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3.2}
        />
      ) : null}
    </G>
  );
}

function AdvisoryMachinePathEnvelope({
  dash,
  overlay,
  stroke,
  width,
}: {
  dash?: string;
  overlay: LayoutPathOverlay | null;
  stroke: string;
  width: number;
}): React.JSX.Element | null {
  if (!overlay) return null;
  const paths = overlay.centerlineSegments.map(lineSvgPath).filter(Boolean);
  if (paths.length === 0) return null;
  return (
    <G>
      {paths.map((path, index) => (
        <Path
          key={`${overlay.kind}-${overlay.towerIndex ?? "machine"}-${index}`}
          d={path}
          fill="none"
          opacity={0.9}
          stroke={stroke}
          strokeDasharray={dash}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={width}
        />
      ))}
    </G>
  );
}

function lineSvgPath(vertices: XY[]): string {
  if (vertices.length < 2) return "";
  return `M ${vertices.map((vertex) => `${vertex.x} ${-vertex.y}`).join(" L ")}`;
}

function LayoutPathOverlayLayer({ overlays, palette }: { overlays: LayoutPathOverlay[]; palette: MapPalette }): React.JSX.Element | null {
  if (overlays.length === 0) return null;
  return (
    <G accessibilityLabel="Wheel track and end of machine path overlays" testID="svg-layout-path-overlays">
      {overlays.map((overlay) => {
        const key = `${overlay.kind}-${overlay.towerIndex ?? "machine"}`;
        const centerlinePaths = overlay.centerlineSegments.map(lineSvgPath).filter(Boolean);
        return (
          <G key={key} accessibilityLabel={overlay.label} testID={`svg-machine-path-${overlay.machinePathRoles.join("-")}-${overlay.towerIndex ?? "path"}`}>
            {centerlinePaths.map((centerlinePath, segmentIndex) => (
              <React.Fragment key={`${key}-centerline-${segmentIndex}`}>
                {overlay.kind === "end_of_machine" ? (
                  <Path d={centerlinePath} fill="none" stroke={palette.markerFill} strokeLinecap="round" strokeLinejoin="round" strokeWidth={7} />
                ) : null}
                <Path
                  d={centerlinePath}
                  fill="none"
                  stroke={layoutPathLabelColor(overlay.kind, palette)}
                  strokeDasharray={layoutPathCenterlineDash(overlay)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={layoutPathCenterlineWidth(overlay)}
                />
              </React.Fragment>
            ))}
          </G>
        );
      })}
    </G>
  );
}

function layoutPathLabel(overlay: LayoutPathOverlay): string {
  if (overlay.coincidentPath) return "LRDU / END";
  if (overlay.kind === "wheel_track") return `T${overlay.towerIndex}`;
  if (overlay.kind === "end_of_machine") return "EOM";
  if (overlay.kind === "end_gun_reach") return "EGR";
  if (overlay.kind === "corner_arm_wheel_track") return "CAW";
  return "CAO";
}

function layoutPathCenterlineDash(overlay: LayoutPathOverlay): string | undefined {
  if (overlay.coincidentPath) return "12 4 2 4";
  const kind = overlay.kind;
  if (kind === "wheel_track" || kind === "corner_arm_wheel_track") return "6 7";
  if (kind === "end_gun_reach") return "16 6 3 6";
  if (kind === "corner_arm_overhang_end") return "14 7";
  return undefined;
}

function layoutPathCenterlineWidth(overlay: LayoutPathOverlay): number {
  if (overlay.coincidentPath) return 3.4;
  const kind = overlay.kind;
  if (kind === "wheel_track") return 2;
  if (kind === "end_of_machine") return 3.2;
  if (kind === "end_gun_reach") return 2.4;
  if (kind === "corner_arm_wheel_track") return 2.2;
  return 2.6;
}

function layoutPathLabelColor(kind: LayoutPathOverlay["kind"], palette: MapPalette): string {
  if (kind === "wheel_track") return palette.wheelTrack;
  if (kind === "end_of_machine") return palette.machinePath;
  if (kind === "end_gun_reach") return palette.endGun;
  if (kind === "corner_arm_wheel_track") return palette.cornerArmTrack;
  return palette.cornerArmReach;
}

function ObstacleSymbol({ color, obstacle }: { color: string; obstacle: ObstacleZone }): React.JSX.Element {
  const x = 0, y = 0;
  if (obstacle.kind === "road") {
    return (
      <>
        <Line x1={x - 28} y1={y} x2={x + 28} y2={y} stroke="#fffef8" strokeWidth={14} />
        <Line x1={x - 28} y1={y} x2={x + 28} y2={y} stroke={color} strokeWidth={5} strokeDasharray="10 7" />
      </>
    );
  }
  if (obstacle.kind === "ditch" || obstacle.kind === "canal") {
    return <Path d={`M ${x - 28} ${y + 8} C ${x - 10} ${y - 14}, ${x + 10} ${y + 26}, ${x + 28} ${y - 2}`} fill="none" stroke={color} strokeWidth={6} />;
  }
  if (obstacle.kind === "fence") {
    return (
      <>
        <Line x1={x - 28} y1={y} x2={x + 28} y2={y} stroke={color} strokeWidth={4} strokeDasharray="5 5" />
        {[-20, 0, 20].map((offset) => <Line key={offset} x1={x + offset} y1={y - 14} x2={x + offset} y2={y + 14} stroke={color} strokeWidth={4} />)}
      </>
    );
  }
  if (obstacle.kind === "tree") {
    return (
      <>
        <Circle cx={x} cy={y - 8} r={16} fill="#fffef8" stroke={color} strokeWidth={5} />
        <Line x1={x} y1={y + 8} x2={x} y2={y + 26} stroke={color} strokeWidth={5} />
      </>
    );
  }
  if (obstacle.kind === "building") {
    return <Rect x={x - 18} y={y - 18} width={36} height={36} fill="#fffef8" stroke={color} strokeWidth={5} />;
  }
  return (
    <>
      <Path d={`M ${x} ${y - 24} L ${x + 24} ${y + 20} L ${x - 24} ${y + 20} Z`} fill="#fffef8" stroke={color} strokeWidth={5} />
      <Line x1={x} y1={y - 8} x2={x} y2={y + 8} stroke={color} strokeWidth={5} />
      <Circle cx={x} cy={y + 15} r={3} fill={color} />
    </>
  );
}

function mapFeatureLabelPoint(feature: ProjectMapFeature, viewport: DrawingMapState["viewport"]): XY {
  const geometry = feature.geometry;
  if (geometry.type === "Point") return geometry.point;
  if (geometry.type === "Circle") return visibleCircleLabelPoint(geometry.center, geometry.radiusMeters, viewport) ?? { x: NaN, y: NaN };
  return visiblePathLabelPoint(geometry.vertices, viewport, geometry.type === "Polygon") ?? { x: NaN, y: NaN };
}

function MapFeatureSymbol({
  feature,
  onSelect,
  palette,
  scale,
  selected,
}: {
  feature: ProjectMapFeature;
  onSelect: () => void;
  palette: MapPalette;
  scale: SvgSymbolScale;
  selected: boolean;
}): React.JSX.Element {
  const color = colorForMapFeature(feature.kind, palette);
  const strokeWidth = scale.stroke(selected ? 7 : 4);
  if (feature.geometry.type === "LineString") {
    const vertices = feature.geometry.vertices;
    if (vertices.length < 2) return <></>;
    const path = `M ${vertices.map((vertex) => `${vertex.x} ${-vertex.y}`).join(" L ")}`;
    return (
      <>
        <Path
          d={path}
          fill="none"
          stroke={color}
          strokeDasharray={dashForMapFeature(feature.kind)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
          {...svgElementInteractionProps(onSelect)}
        />
      </>
    );
  }
  if (feature.geometry.type === "Polygon") {
    const vertices = feature.geometry.vertices;
    if (vertices.length < 3) return <></>;
    const path = ringsToSvgPath([[vertices]]);
    return (
      <>
        <Path
          d={path}
          fill={color}
          opacity={selected ? 0.24 : 0.14}
          stroke={color}
          strokeDasharray={dashForMapFeature(feature.kind)}
          strokeLinejoin="round"
          strokeWidth={strokeWidth}
          {...svgElementInteractionProps(onSelect)}
        />
      </>
    );
  }
  if (feature.geometry.type === "Circle") {
    const point = feature.geometry.center;
    const y = -point.y;
    return (
      <>
        <Circle
          cx={point.x}
          cy={y}
          fill={color}
          opacity={selected ? 0.2 : 0.12}
          r={feature.geometry.radiusMeters}
          stroke={color}
          strokeDasharray={dashForMapFeature(feature.kind)}
          strokeWidth={strokeWidth}
          {...svgElementInteractionProps(onSelect)}
        />
        <Circle cx={point.x} cy={y} fill="#fffef8" r={scale.px(selected ? 10 : 7)} stroke={color} strokeWidth={scale.stroke(4)} />
      </>
    );
  }
  const point = feature.geometry.point;
  const y = -point.y;
  return (
    <>
      <Circle
        cx={point.x}
        cy={y}
        fill={selected ? color : "#fffef8"}
        r={scale.px(selected ? 13 : 10)}
        stroke={color}
        strokeWidth={scale.stroke(4)}
        {...svgElementInteractionProps(onSelect)}
      />
    </>
  );
}

function EditableMapFeatureHandles({
  feature,
  onSelect,
  palette,
  scale,
  selected,
}: {
  feature: ProjectMapFeature;
  onSelect: (vertexIndex: number) => void;
  palette: MapPalette;
  scale: SvgSymbolScale;
  selected: number | null;
}): React.JSX.Element {
  const color = colorForMapFeature(feature.kind, palette);
  if (feature.geometry.type === "LineString" || feature.geometry.type === "Polygon") {
    return (
      <EditableRing
        color={color}
        layerLabel={`${feature.name} map feature`}
        scale={scale}
        selected={selected}
        vertices={feature.geometry.vertices}
        onSelect={onSelect}
      />
    );
  }
  if (feature.geometry.type === "Circle") {
    const center = feature.geometry.center;
    const radiusHandle = { x: center.x + feature.geometry.radiusMeters, y: center.y };
    return (
      <>
        <Circle
          accessibilityLabel={`${feature.name} center`}
          cx={center.x}
          cy={-center.y}
          fill={selected === 0 ? color : "#fffef8"}
          r={scale.px(selected === 0 ? 11 : 7)}
          stroke={color}
          strokeWidth={scale.stroke(4)}
          {...svgElementInteractionProps(() => onSelect(0))}
        />
        <Circle
          accessibilityLabel={`${feature.name} radius handle`}
          cx={radiusHandle.x}
          cy={-radiusHandle.y}
          fill={selected === 1 ? color : "#fffef8"}
          r={scale.px(selected === 1 ? 11 : 7)}
          stroke={color}
          strokeDasharray="6 4"
          strokeWidth={scale.stroke(4)}
          {...svgElementInteractionProps(() => onSelect(1))}
        />
      </>
    );
  }
  const point = feature.geometry.point;
  return (
    <Circle
      accessibilityLabel={`${feature.name} point`}
      cx={point.x}
      cy={-point.y}
      fill={selected === 0 ? color : "#fffef8"}
      r={scale.px(selected === 0 ? 11 : 7)}
      stroke={color}
      strokeWidth={scale.stroke(4)}
      {...svgElementInteractionProps(() => onSelect(0))}
    />
  );
}

function shortSurveyLabel(role: SurveyPoint["role"]): string {
  switch (role) {
    case "pivot_center":
      return "P";
    case "water_source":
      return "W";
    case "power_source":
      return "E";
    case "boundary":
      return "B";
    case "obstacle":
      return "O";
    case "control":
      return "C";
    case "note":
      return "N";
  }
}

function centroid(vertices: XY[]): XY {
  const sum = vertices.reduce((accumulator, vertex) => ({ x: accumulator.x + vertex.x, y: accumulator.y + vertex.y }), { x: 0, y: 0 });
  return { x: sum.x / Math.max(1, vertices.length), y: sum.y / Math.max(1, vertices.length) };
}

function DraftVertices({ vertices, color, scale, polygon }: { vertices: XY[]; color: string; scale: SvgSymbolScale; polygon: boolean }): React.JSX.Element {
  if (vertices.length === 0) return <></>;
  const closed = polygon && vertices.length >= 3;
  const path = vertices.length >= 2 ? `M ${vertices.map((vertex) => `${vertex.x} ${-vertex.y}`).join(" L ")}${closed ? " Z" : ""}` : "";
  return (
    <>
      {path ? <Path d={path} fill={closed ? color : "none"} fillOpacity={0.16} stroke={color} strokeDasharray="10 8" strokeWidth={scale.stroke(5)} testID="svg-draft-preview" /> : null}
      {vertices.map((vertex, index) => (
        <React.Fragment key={`${vertex.x}-${vertex.y}-${index}`}>
          <Circle cx={vertex.x} cy={-vertex.y} r={scale.px(5)} fill="#ffffff" stroke={color} strokeWidth={scale.stroke(2)} />
        </React.Fragment>
      ))}
    </>
  );
}

function CatalogHomeOverlay({
  minX,
  maxX,
  minY,
  maxY,
  palette,
}: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  palette: MapPalette;
}): React.JSX.Element {
  const labelX = minX + (maxX - minX) * 0.08;
  const labelY = minY + (maxY - minY) * 0.14;
  return (
    <>
      <Path
        d="M -166 -66 L -150 -70 L -136 -63 L -124 -50 L -118 -34 L -106 -24 L -96 -18 L -82 -25 L -77 -39 L -66 -47 L -55 -54 L -69 -60 L -88 -57 L -104 -60 L -123 -64 L -144 -61 Z"
        fill={palette.allowed}
        opacity={0.16}
        stroke={palette.fieldStroke}
        strokeOpacity={0.42}
        strokeWidth={1.8}
      />
      <Path
        d="M -142 -30 L -128 -29 L -114 -23 L -103 -18 L -92 -17 L -88 -22 L -97 -28 L -112 -32 L -129 -34 Z"
        fill={palette.endGun}
        opacity={0.16}
        stroke={palette.fieldStroke}
        strokeOpacity={0.28}
        strokeWidth={1.4}
      />
      <SvgText x={labelX} y={labelY} fill={palette.fieldStroke} fontSize={5.6} fontWeight="700">
        North America project catalog
      </SvgText>
    </>
  );
}

function EditableRing({
  color,
  layerLabel,
  onSelect,
  scale,
  selected,
  vertices,
}: {
  color: string;
  layerLabel: string;
  onSelect?: (vertexIndex: number) => void;
  scale: SvgSymbolScale;
  selected: number | null;
  vertices: XY[];
}): React.JSX.Element {
  return (
    <>
      {vertices.map((vertex, index) => (
        <Circle
          key={`${vertex.x}-${vertex.y}-${index}`}
          accessibilityLabel={`${layerLabel} vertex ${index + 1}`}
          cx={vertex.x}
          cy={-vertex.y}
          fill={selected === index ? color : "#fffef8"}
          r={scale.px(selected === index ? 11 : 7)}
          stroke={color}
          strokeWidth={scale.stroke(4)}
          {...(onSelect ? svgElementInteractionProps(() => onSelect(index)) : {})}
        />
      ))}
    </>
  );
}

function svgElementInteractionProps(onActivate: () => void): object {
  if (Platform.OS === "web") {
    return {
      onPress: (event: { stopPropagation?: () => void }) => {
        event.stopPropagation?.();
        onActivate();
      },
    };
  }
  return { onPress: onActivate };
}

function SnapMarker({ point, color, scale }: { point: XY; color: string; scale: SvgSymbolScale }): React.JSX.Element {
  return (
    <>
      <Circle cx={point.x} cy={-point.y} r={scale.px(9)} fill="none" stroke={color} strokeDasharray={`${scale.px(3)} ${scale.px(2)}`} strokeWidth={scale.stroke(2)} />
    </>
  );
}

function WorkflowSegmentedControl({ mode, onChange, short = false }: { mode: MappingWorkflowMode; onChange: (mode: MappingWorkflowMode) => void; short?: boolean }): React.JSX.Element {
  return (
    <View accessibilityLabel="Mapping workflow mode" style={styles.workflowSegment}>
      {(["design", "layout"] as const).map((option) => {
        const active = mode === option;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={option}
            onPress={() => onChange(option)}
            style={[styles.workflowSegmentButton, short && styles.workflowSegmentButtonShortLandscape,
              active && styles.workflowSegmentButtonActive]}
            testID={`workflow-${option}-mode`}
          >
            <Text style={[styles.workflowSegmentText, active && styles.workflowSegmentTextActive]}>{workflowModeLabel(option)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function workflowModeLabel(mode: MappingWorkflowMode): string {
  return mode === "design" ? "Design" : "Layout";
}

function ToolButton({ active, disabled = false, icon, label, onPress }: { active: boolean; disabled?: boolean; icon: React.ReactNode; label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={[styles.toolButton, active && styles.toolButtonActive, disabled && styles.toolButtonDisabled]}>
      {icon}
      <Text style={[styles.toolLabel, active && styles.toolLabelActive, disabled && styles.toolLabelDisabled]}>{label}</Text>
    </Pressable>
  );
}

function IconControl({ icon, label, onPress, disabled = false, testID, tooltipPlacement = "left" }: { icon: React.ReactNode; label: string; onPress: () => void; disabled?: boolean; testID?: string; tooltipPlacement?: "left" | "below" | "belowStart" }): React.JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}
      onPress={onPress} style={[styles.iconControl, disabled && styles.disabledDraftButton]} testID={testID}>
      {icon}
      {hovered ? <View pointerEvents="none" style={[styles.controlTooltip, tooltipPlacement === "below" && styles.controlTooltipBelow, tooltipPlacement === "belowStart" && styles.controlTooltipBelowStart]}><Text style={styles.controlTooltipText}>{label}</Text></View> : null}
    </Pressable>
  );
}

function LayerButton({ active, disabled = false, label, layer, onPress }: { active: boolean; disabled?: boolean; label: string; layer: DrawingLayerType; onPress: (layer: DrawingLayerType) => void }): React.JSX.Element {
  return (
    <Pressable disabled={disabled} onPress={() => onPress(layer)} style={[styles.layerButton, active && styles.layerButtonActive, disabled && styles.layerButtonDisabled]}>
      <Text style={[styles.layerLabel, active && styles.layerLabelActive, disabled && styles.layerLabelDisabled]}>{label}</Text>
    </Pressable>
  );
}

function FeatureKindButton({ active, disabled = false, label, onPress }: { active: boolean; disabled?: boolean; label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.layerButton, active && styles.layerButtonActive, disabled && styles.layerButtonDisabled]}>
      {label === "Power line" || label === "Pole" ? <UtilityPole size={15} color={active ? "#ffffff" : "#314339"} /> : null}
      {label === "Fence" ? <Fence size={15} color={active ? "#ffffff" : "#314339"} /> : null}
      <Text style={[styles.layerLabel, active && styles.layerLabelActive, disabled && styles.layerLabelDisabled]}>{label}</Text>
    </Pressable>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }): React.JSX.Element {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

function colorForMapFeature(kind: ProjectMapFeatureKind, palette: MapPalette): string {
  if (kind === "power_line" || kind === "power_pole") return palette.power;
  if (kind === "underground_wire") return palette.power;
  if (kind === "underground_pipeline" || kind === "pump_location" || kind === "well_location") return palette.water;
  if (kind === "planning_boundary" || kind === "machine_zone" || kind === "measurement_line" || kind === "linear_move_path") return palette.fieldStroke;
  if (kind === "tree") return palette.survey;
  return palette.utility;
}

function dashForMapFeature(kind: ProjectMapFeatureKind): string | undefined {
  if (kind === "underground_pipeline" || kind === "underground_wire") return "12 8";
  if (kind === "linear_move_path") return "20 6 4 6";
  if (kind === "planning_boundary" || kind === "machine_zone") return "18 8";
  if (kind === "measurement_line") return "4 6";
  if (kind === "fence") return "5 5";
  if (kind === "ditch" || kind === "canal") return "14 7 4 7";
  return undefined;
}

function shortMapFeatureLabel(kind: ProjectMapFeatureKind): string {
  switch (kind) {
    case "pump_location":
      return "Pump";
    case "well_location":
      return "Well";
    case "power_pole":
      return "Pole";
    case "tree":
      return "Tree";
    case "planning_boundary":
      return "Plan";
    case "machine_zone":
      return "Zone";
    case "linear_move_path":
      return "Linear";
    case "measurement_line":
      return "Measure";
    case "end_gun_mark":
      return "EG";
    default:
      return kind.replaceAll("_", " ");
  }
}

function paletteForMapStyle(style: MapStyle): {
  background: string;
  grid: string;
  outside: string;
  endGun: string;
  allowed: string;
  advisory: string;
  advisoryStroke: string;
  wheelTrack: string;
  wheelTrackOutside: string;
  machinePath: string;
  machinePathOutside: string;
  cornerArmTrack: string;
  cornerArmReach: string;
  cornerArmOutside: string;
  fieldStroke: string;
  obstacle: string;
  obstacleStroke: string;
  pivot: string;
  water: string;
  power: string;
  tower: string;
  markerFill: string;
  draft: string;
  snap: string;
  survey: string;
  utility: string;
} {
  if (style === "high_contrast") {
    return {
      background: "#f9f9f2",
      grid: "#a5a99f",
      outside: "#b84b2f",
      endGun: "#007d86",
      allowed: "#006bb0",
      advisory: "#8b5cf6",
      advisoryStroke: "#4c1d95",
      wheelTrack: "#1a1f1c",
      wheelTrackOutside: "#b84b2f",
      machinePath: "#000000",
      machinePathOutside: "#b84b2f",
      cornerArmTrack: "#6d4f00",
      cornerArmReach: "#005f66",
      cornerArmOutside: "#b84b2f",
      fieldStroke: "#0b160f",
      obstacle: "#b00020",
      obstacleStroke: "#3b0008",
      pivot: "#000000",
      water: "#004e8a",
      power: "#7a4a00",
      tower: "#1a1f1c",
      markerFill: "#ffffff",
      draft: "#8b1e18",
      snap: "#005f52",
      survey: "#5f2e00",
      utility: "#4d276f",
    };
  }

  if (style === "imagery_package") {
    return {
      background: "#dfe6d0",
      grid: "#b8c0ad",
      outside: "#d77b46",
      endGun: "#4ab4bd",
      allowed: "#458fc4",
      advisory: "#9b5de5",
      advisoryStroke: "#5b21b6",
      wheelTrack: "#4f5a50",
      wheelTrackOutside: "#d77b46",
      machinePath: "#203526",
      machinePathOutside: "#d77b46",
      cornerArmTrack: "#80631f",
      cornerArmReach: "#1f5f66",
      cornerArmOutside: "#d77b46",
      fieldStroke: "#203526",
      obstacle: "#bb4b42",
      obstacleStroke: "#70271f",
      pivot: "#101722",
      water: "#006a9f",
      power: "#a36500",
      tower: "#4f5a50",
      markerFill: "#fffef8",
      draft: "#7b1f5a",
      snap: "#005f52",
      survey: "#6b3e00",
      utility: "#673f8f",
    };
  }

  if (style === "topographic") {
    return {
      background: "#f6f2df",
      grid: "#d0c390",
      outside: "#db844d",
      endGun: "#52aeb8",
      allowed: "#5e9dcc",
      advisory: "#8b5cf6",
      advisoryStroke: "#5b21b6",
      wheelTrack: "#5b624e",
      wheelTrackOutside: "#db844d",
      machinePath: "#2b3c24",
      machinePathOutside: "#db844d",
      cornerArmTrack: "#80631f",
      cornerArmReach: "#1f5f66",
      cornerArmOutside: "#db844d",
      fieldStroke: "#2b3c24",
      obstacle: "#c4513f",
      obstacleStroke: "#71301e",
      pivot: "#151c2a",
      water: "#006a9f",
      power: "#946500",
      tower: "#5b624e",
      markerFill: "#fffef8",
      draft: "#7b1f5a",
      snap: "#005f52",
      survey: "#744200",
      utility: "#5b3b87",
    };
  }

  return {
    background: "#f4f2e8",
    grid: "#d7d2bf",
    outside: "#e68b58",
    endGun: "#63c7cf",
    allowed: "#6cb6df",
    advisory: "#9b5de5",
    advisoryStroke: "#5b21b6",
    wheelTrack: "#54645a",
    wheelTrackOutside: "#e68b58",
    machinePath: "#253f2f",
    machinePathOutside: "#e68b58",
    cornerArmTrack: "#80631f",
    cornerArmReach: "#1f5f66",
    cornerArmOutside: "#e68b58",
    fieldStroke: "#253f2f",
    obstacle: "#c64f43",
    obstacleStroke: "#70271f",
    pivot: "#151c2a",
    water: "#006a9f",
    power: "#c78500",
    tower: "#54645a",
    markerFill: "#fffdf5",
    draft: "#7b1f5a",
    snap: "#005f52",
    survey: "#6f3f00",
    utility: "#62418f",
  };
}

// React Native's ViewStyle omits CSS overflow: clip; web needs it to prevent focus scrolling the outer map shell.
const webShellClip = Platform.OS === "web" ? ({ overflow: "clip" } as unknown as ViewStyle) : undefined;

const styles = StyleSheet.create({
  shell: {
    backgroundColor: "#fbfcf8",
    borderColor: "#d8ded6",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
  },
  shellCompact: {
    flexBasis: "100%",
    minHeight: 0,
    width: "100%",
  },
  headerRow: {
    alignItems: "center",
    borderBottomColor: "#dde3da",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    color: "#15241b",
    fontSize: 18,
    fontWeight: "800",
  },
  headerRowCompact: { paddingHorizontal: 8, paddingVertical: 6, gap: 6 },
  headerRowShortLandscape: { paddingVertical: 0 },
  compactHeaderTitle: { flex: 1, minWidth: 0 },
  subtitle: {
    color: "#607067",
    fontSize: 12,
    fontWeight: "600",
  },
  actionStatus: {
    color: "#26392f",
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingVertical: 6,
    flexShrink: 0,
  },
  shortInspectStatus: { height: 0, paddingVertical: 0, overflow: "hidden" },
  svg: {
    flex: 1,
    width: "100%",
  },
  svgCompact: {
    flex: 1,
  },
  mapSurface: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    ...(Platform.OS === "web" ? { userSelect: "none" as const } : {}),
  },
  mapClickLayer: {
    backgroundColor: "transparent",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
  },
  mapClickLayerCompact: {
    bottom: 0,
  },
  bottomOverlaySlot: {
    ...overlayAnchors.bottom,
    maxWidth: "100%",
    position: "absolute",
    right: 12,
    zIndex: 3,
  },
  compactToolbarSlot: {
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingBottom: 8,
    width: "100%",
  },
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    gap: 8,
    maxWidth: "100%",
  },
  modeRowCompact: {
    width: "100%",
  },
  workflowSegment: {
    alignItems: "center",
    backgroundColor: "#edf3eb",
    borderColor: "#c9d6c7",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3,
  },
  workflowSegmentButton: {
    borderRadius: 6,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  workflowSegmentButtonShortLandscape: {
    minHeight: 44,
    paddingVertical: 4,
  },
  workflowSegmentButtonActive: {
    backgroundColor: "#254234",
  },
  workflowSegmentText: {
    color: "#314339",
    fontSize: 12,
    fontWeight: "900",
  },
  workflowSegmentTextActive: {
    color: "#ffffff",
  },
  toolButton: {
    alignItems: "center",
    backgroundColor: "#eef3ea",
    borderColor: "#c7d4c5",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    flexShrink: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  toolButtonActive: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  toolButtonDisabled: {
    opacity: 0.45,
  },
  toolLabel: {
    color: "#314339",
    fontSize: 12,
    fontWeight: "900",
  },
  toolLabelActive: {
    color: "#ffffff",
  },
  toolLabelDisabled: {
    color: "#5f6f64",
  },
  zoomControls: {
    ...overlayAnchors.zoom,
    gap: 8,
    position: "absolute",
    zIndex: 3,
  },
  panControls: {
    ...overlayAnchors.pan,
    alignItems: "center",
    gap: 6,
    position: "absolute",
    zIndex: 3,
  },
  compactLegendControl: { position: "absolute", ...overlayAnchors.legend, zIndex: 3 },
  zoomControlsCompact: {
    flexDirection: "row",
    gap: 6,
  },
  panMiddle: {
    flexDirection: "row",
    gap: 44,
  },
  draftHud: {
    ...overlayAnchors.draft,
    alignItems: "center",
    backgroundColor: "#fffef8",
    borderColor: "#b9c5b6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
    position: "absolute",
    right: 12,
    zIndex: 2,
  },
  draftHudExternal: {
    maxHeight: 70,
    overflow: "hidden",
  },
  draftHudCompact: {
    alignItems: "stretch",
    borderRadius: 0,
    borderWidth: 0,
    borderTopWidth: 1,
    bottom: 0,
    flexDirection: "column",
    flexShrink: 0,
    left: 0,
    position: "relative",
    right: 0,
  },
  draftHudShortLandscape: {
    alignItems: "center",
    bottom: 0,
    flex: 2,
    flexDirection: "row",
    height: 44,
    left: 0,
    maxHeight: 44,
    minWidth: 0,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: "relative",
    right: 0,
  },
  draftHudTextShortLandscape: {
    flexShrink: 1,
    maxWidth: 140,
  },
  draftCommandScroller: {
    flexGrow: 0,
    flexShrink: 0,
    height: 40,
    width: "100%",
  },
  draftCommandSlotShortLandscape: {
    flex: 1,
    minWidth: 0,
  },
  draftCommandSlotCompact: {
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  draftCommandScrollerShortLandscape: {
    height: 38,
    width: "100%",
  },
  draftCommandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  imageryBadge: {
    backgroundColor: "rgba(255, 254, 248, 0.92)",
    borderColor: "#b9c5b6",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  referenceOverlayBadge: {
    backgroundColor: "rgba(255, 250, 235, 0.95)",
    borderColor: "#dfc77f",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  mapNoticeStack: {
    gap: 6,
  },
  compactMapNoticeBand: {
    backgroundColor: "#f4f7f2",
    borderTopColor: "#d8ded6",
    borderTopWidth: 1,
    padding: 8,
  },
  compactImageryCredit: { color: "#405448", fontSize: 11, lineHeight: 14, paddingHorizontal: 8, paddingBottom: 4, flexShrink: 0 },
  compactNoticeButton: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  compactNoticeSummary: { flex: 1, color: "#26392f", fontSize: 12, lineHeight: 16 },
  noticeBackdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(19,33,27,0.58)" },
  noticeDialog: { width: "100%", maxWidth: 480, maxHeight: "80%", backgroundColor: "#fbfcf8", borderRadius: 8, overflow: "hidden" },
  noticeDialogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: 16 },
  noticeDialogTitle: { flex: 1, color: "#26392f", fontSize: 16, fontWeight: "700" },
  noticeClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  noticeDialogBody: { padding: 12, gap: 8 },
  topOverlayStack: {
    ...overlayAnchors.notices,
    gap: 6,
    maxWidth: 560,
    position: "absolute",
    right: 76,
    zIndex: 2,
  },
  imageryBadgeText: {
    color: "#26392f",
    fontSize: 12,
    fontWeight: "900",
  },
  imageryBadgeSubtext: {
    color: "#405448",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  draftHudText: {
    color: "#26392f",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  clearDraftButton: {
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  clearDraftText: {
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
  },
  commitDraftButton: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  commitDraftText: {
    color: "#ffffff",
  },
  disabledDraftButton: {
    opacity: 0.45,
  },
  iconControl: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#aebbae",
    borderRadius: 8,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  controlTooltip: { position: "absolute", top: 8, right: 52, minWidth: 90, padding: 6, backgroundColor: "#26392f", borderRadius: 4, zIndex: 10 },
  controlTooltipBelow: { top: 54, right: 0 },
  controlTooltipBelowStart: { top: 54, right: "auto", left: 0 },
  controlTooltipText: { color: "#ffffff", fontSize: 12 },
  layerRow: {
    borderTopColor: "#dde3da",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 12,
  },
  layerButton: {
    alignItems: "center",
    backgroundColor: "#f1f5ee",
    borderColor: "#cdd8ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  layerButtonActive: {
    backgroundColor: "#254234",
    borderColor: "#254234",
  },
  layerButtonDisabled: {
    opacity: 0.45,
  },
  layerLabel: {
    color: "#314339",
    fontSize: 12,
    fontWeight: "900",
  },
  layerLabelActive: {
    color: "#ffffff",
  },
  layerLabelDisabled: {
    color: "#5f6f64",
  },
  legend: {
    borderTopColor: "#dde3da",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    padding: 12,
  },
  compactLegendBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255, 254, 248, 0.9)",
    borderColor: "#b9c5b6",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    maxWidth: 360,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  legendItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  swatch: {
    borderColor: "#2f3f35",
    borderRadius: 2,
    borderWidth: 1,
    height: 14,
    width: 14,
  },
  legendLabel: {
    color: "#4e5e55",
    fontSize: 12,
    fontWeight: "700",
  },
});
