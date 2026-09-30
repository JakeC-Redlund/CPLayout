import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Fence,
  Hand,
  Info,
  Layers,
  LocateFixed,
  MapPinned,
  MousePointer2,
  Plus,
  Satellite,
  Scan,
  Undo2,
  Trash2,
  UtilityPole,
  X,
} from "lucide-react-native";
import { maplibregl, maplibreErrorMessage } from "./maplibreRuntime.web";
import { createVertexDragSession } from "./vertexDragSession";
import { createMapCameraSession, type MapCameraFrame } from "./mapCameraSession";
import { createInitialMapCameraAdmission, hasVisibleMapSize } from "./initialMapCamera";
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import {
  projectLonLatToXy,
  projectXyToLonLat,
  buildMapReferenceViewModel,
  type LonLat,
  type ProjectMapFeature,
  type ReferenceOverlayLayerKey,
  type XY,
} from "@cplayout/core";
import type { DrawingLayerType } from "@cplayout/geometry";
import {
  UTILITY_FEATURE_OPTIONS,
  draftMeasurementText,
} from "./mapTools";
import { projectLayoutToWgs84FeatureCollection, projectWgs84Bounds, projectWgs84Center } from "./mapOverlayGeoJson";
import {
  buildWorkbenchStyle,
  rasterStyleSourceFromAerialReferenceResolution,
  type RasterImageryStyleSource,
} from "./mapWorkbenchStyle";
import { registerPmtilesProtocolOnce } from "./pmtilesProtocol.web";
import {
  hasMapFeatureVertexSelection,
  hasObstacleVertexSelection,
  selectedProjectVertexPoint,
  selectedProjectVertexText,
} from "./projectVertexEditing";
import { SvgMapSurface } from "./SvgMapSurface";
import type { MapSurfaceProps } from "./types";
import { useMapInteractionController } from "./useMapInteractionController";
import { panOffsetToRevealPoint } from "./mapViewport";
import { finitePointBounds } from "./mapFit";
import { trackMapPointers } from "./mapPointerGuard";
import { visibleMapAttributions } from "./mapAttribution";

export function BrowserMapSurface(props: MapSurfaceProps): React.JSX.Element {
  const {
    advisoryFieldPivotPlan, advisoryMachineRenderModel, bottomOverlay,
    controlLayout = "internalRows", project, result, settings, activeMapFeatureKind,
    onMappingWorkflowModeChange, onSelectMapFeature, onSettingsChange,
  } = props;
  const homeView = props.homeView === true;
  const { width, height } = useWindowDimensions();
  const compactLayout = width < 760;
  const shortFallback = width > height && height < 500;
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [sheetInsetBottom, setSheetInsetBottom] = useState(0);
  const compactHud = panelWidth === null ? compactLayout : panelWidth < 600;
  const compactHeader = compactHud || shortFallback;
  const shortLandscapeHud = panelWidth !== null && panelWidth >= 400
    && panelHeight !== null && panelHeight > 0 && panelHeight < 400;
  const navigationClearanceStyle = shortLandscapeHud ? { maxWidth: panelWidth - 120 } : undefined;
  const externalHudLayout = controlLayout === "externalHud";
  const designMode = settings.mappingWorkflowMode === "design";
  const canEditOnMap = designMode && !homeView;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<maplibregl.Map | null>(null);
  const cameraAdmissionRef = useRef<ReturnType<typeof createInitialMapCameraAdmission> | null>(null);
  const [readyCamera, setReadyCamera] = useState<ReturnType<typeof createInitialMapCameraAdmission> | null>(null);
  const disposeVertexDragRef = useRef<(() => void) | null>(null);
  const cancelVertexDragRef = useRef<(() => void) | null>(null);
  const cancelMapTapRef = useRef<(() => void) | null>(null);
  const bottomDockHeightRef = useRef(0);
  const toolHudBoundsRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const revealSelectedVertexRef = useRef<((explicitSelection?: boolean) => void) | null>(null);
  const selectedVertexVisibleRef = useRef<((size?: { width: number; height: number }) => boolean) | null>(null);
  useLayoutEffect(() => {
    if (!compactLayout || !externalHudLayout) {
      setSheetInsetBottom(0);
      return;
    }
    const frame = containerRef.current?.parentElement;
    const sheet = document.querySelector('[data-testid="right-workflow-sidebar"]');
    if (!frame || !sheet || getComputedStyle(sheet).position !== "absolute") {
      setSheetInsetBottom(0);
      return;
    }
    const frameRect = frame.getBoundingClientRect();
    const sheetRect = sheet.getBoundingClientRect();
    const intersects = sheetRect.top < frameRect.bottom && sheetRect.bottom > frameRect.top;
    setSheetInsetBottom(intersects ? Math.max(0, frameRect.bottom - sheetRect.top + 8) : 0);
  });
  useLayoutEffect(() => {
    if (sheetInsetBottom > 0) revealSelectedVertexRef.current?.(true);
  }, [sheetInsetBottom]);
  const [cameraSession] = useState(createMapCameraSession);
  const cameraFrameRef = useRef<MapCameraFrame | null>(null);
  const mapSequenceRef = useRef(0);
  const revealedSelectionRef = useRef<{ frame: MapCameraFrame; selection: typeof selectedVertex } | null>(null);
  const pendingSelectionRevealRef = useRef<{ frame: MapCameraFrame; selection: typeof selectedVertex } | null>(null);
  const referenceView = useMemo(() => buildMapReferenceViewModel({
    settings, mapPackages: project.mapPackages ?? [],
    target: "web_maplibre_gl_js", surface: "workbench",
  }), [project.mapPackages, settings.aerialImagery, settings.onlineImagery, settings.referenceOverlay]);
  const aerialImagery = referenceView.aerial;
  const activeImagery = useMemo(() => rasterStyleSourceFromAerialReferenceResolution(aerialImagery), [aerialImagery]);
  const controller = useMapInteractionController(props, { imageryEnabled: Boolean(activeImagery) });
  const {
    mode, activeLayer, draftVertices, mapFeatureKind,
    selectedVertex, status, statusMetaText, setTool, setActiveLayer, setMapFeatureKind,
    clearDraft, commitDraft, saveMapFeatureFromDraft, selectFirstBoundaryVertex,
    selectFirstObstacleVertex, selectFirstMapFeatureVertex, selectAdjacentVertex,
    nudgeSelectedVertex, insertAfterSelectedVertex,
    deleteSelectedVertex, canCommitDraft, canSaveFeature, canEditSelectedVertex,
    canDeleteSelectedVertex, canInsertSelectedVertex,
  } = controller;
  const interactionRef = useRef(controller);
  const selectionCallbackRef = useRef(onSelectMapFeature);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(false);
  const [svgRecoveryRequested, setSvgRecoveryRequested] = useState(false);
  const [mapInitializationError, setMapInitializationError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [recoveryHovered, setRecoveryHovered] = useState(false);
  const projectionFrame = useMemo(() => {
    if (homeView) {
      return {
        center: [-98, 49] as [number, number],
        bounds: [-168, 15, -52, 72] as [number, number, number, number],
        error: null as string | null,
      };
    }
    try {
      return {
        center: projectWgs84Center(project),
        bounds: projectWgs84Bounds(project),
        error: null as string | null,
      };
    } catch (error) {
      return {
        center: [0, 0] as [number, number],
        bounds: [-1, -1, 1, 1] as [number, number, number, number],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [homeView, project]);
  const overlayState = useMemo(() => {
    if (homeView) {
      return {
        featureCollection: { type: "FeatureCollection" as const, features: [] },
        error: null as string | null,
      };
    }
    try {
      return {
        featureCollection: projectLayoutToWgs84FeatureCollection(project, result, draftVertices, advisoryFieldPivotPlan, advisoryMachineRenderModel,
          mode === "measure" ? controller.activeFeatureGeometry : "Polygon"),
        error: null as string | null,
      };
    } catch (error) {
      return {
        featureCollection: { type: "FeatureCollection" as const, features: [] },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [advisoryFieldPivotPlan, advisoryMachineRenderModel, draftVertices, homeView, project, result, mode, controller.activeFeatureGeometry]);
  const projectionError = projectionFrame.error ?? overlayState.error;
  const fieldFitBounds = useMemo(() => {
    if (homeView) return null;
    try {
      return finitePointBounds(project.fieldBoundary.map(point => {
        const coordinate = projectXyToLonLat(point, project.projectCrs);
        return { x: coordinate.longitude, y: coordinate.latitude };
      }));
    } catch { return null; }
  }, [homeView, project.fieldBoundary, project.projectCrs]);
  const referenceOverlay = referenceView.reference;
  const cameraIdentity = useMemo(() => ({
    projectId: project.id,
    projectCrs: project.projectCrs,
    projectGeneration: props.projectGeneration ?? 0,
    homeView,
    projectionAvailable: !projectionError,
  }), [project.id, project.projectCrs, props.projectGeneration, homeView, Boolean(projectionError)]);
  // Geometry updates do not change style identity. Include every other style input.
  const workbenchStyle = buildWorkbenchStyle(activeImagery,
    { type: "FeatureCollection", features: [] }, referenceOverlay, settings.referenceOverlay);
  const styleKey = JSON.stringify(workbenchStyle);
  const attributionCredit = [
    !activeImagery ? aerialImagery.reason : null,
    ...visibleMapAttributions(workbenchStyle),
  ].filter(Boolean).join(" · ") || "Map attribution unavailable";
  const renderStateRef = useRef({ project, homeView, canEditOnMap, projectionFrame, activeImagery,
    referenceOverlay, referencePreferences: settings.referenceOverlay, overlay: overlayState.featureCollection });
  useLayoutEffect(() => {
    // Snapshot the outgoing view before retiring its frame, including navigation during movement.
    const previousFrame = cameraFrameRef.current;
    const previousMap = mapRef.current;
    if (previousFrame && previousMap && cameraSession.isCurrent(previousFrame)
      && previousMap.getContainer().dataset.mapCameraReady === "true") {
      const center = previousMap.getCenter();
      cameraSession.remember(previousFrame, { center: [center.lng, center.lat], zoom: previousMap.getZoom(),
        bearing: previousMap.getBearing(), pitch: previousMap.getPitch() });
    }
    // Commit ownership before passive cleanup; an abandoned render must not retire a live camera.
    cameraFrameRef.current = cameraSession.useFrame(cameraIdentity);
    interactionRef.current = controller;
    selectionCallbackRef.current = onSelectMapFeature;
    renderStateRef.current = { project, homeView, canEditOnMap, projectionFrame, activeImagery,
      referenceOverlay, referencePreferences: settings.referenceOverlay, overlay: overlayState.featureCollection };
  });
  useEffect(() => {
    const cameraFrame = cameraFrameRef.current;
    if (!cameraFrame || !containerRef.current || projectionError || mapInitializationError || svgRecoveryRequested) return undefined;
    setRuntimeError(null);
    const current = renderStateRef.current;
    const restoredCamera = cameraSession.restore(cameraFrame);
    let map: maplibregl.Map;
    try {
      registerPmtilesProtocolOnce();
      map = new maplibregl.Map({
        attributionControl: false,
        // Initial bounds fitting happens only after measuring the actual visible container.
        ...(restoredCamera ?? { center: current.projectionFrame.center, zoom: 0 }),
        container: containerRef.current,
        // One owned observer captures visibility before resizing, including large panel changes.
        trackResize: typeof ResizeObserver === "undefined",
        dragRotate: false,
        pitchWithRotate: false,
        style: buildWorkbenchStyle(current.activeImagery, current.overlay, current.referenceOverlay, current.referencePreferences),
      });
      map.doubleClickZoom.disable();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    } catch (error) {
      setMapInitializationError(mapRendererFallbackMessage(error));
      return undefined;
    }
    mapRef.current = map;
    let disposed = false;
    const ownsMap = () => !disposed && mapRef.current === map && cameraSession.isCurrent(cameraFrame);
    const cameraAdmission = createInitialMapCameraAdmission(restoredCamera !== null, ownsMap);
    cameraAdmissionRef.current = cameraAdmission;
    const container = map.getContainer();
    let styleLoaded = false;
    container.dataset.mapLoaded = "false";
    container.dataset.mapCameraReady = "false";
    delete container.dataset.mapCamera;
    container.dataset.mapInstance = String(++mapSequenceRef.current);
    const recordCamera = (retiring = false) => {
      if (!ownsMap() || !cameraAdmission.isReady()
        || (!retiring && !hasVisibleMapSize({ width: container.clientWidth, height: container.clientHeight }))) return;
      const center = map.getCenter();
      const view = { center: [center.lng, center.lat] as [number, number], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
      cameraSession.remember(cameraFrame, view);
      container.dataset.mapCamera = JSON.stringify([...view.center, view.zoom, view.bearing, view.pitch]);
    };
    const initializeCamera = () => {
      if (!ownsMap()) return;
      try {
        const initialized = cameraAdmission.initialize({ width: container.clientWidth, height: container.clientHeight }, padding => {
          map.resize();
          const camera = restoredCamera ?? map.cameraForBounds([
            [current.projectionFrame.bounds[0], current.projectionFrame.bounds[1]],
            [current.projectionFrame.bounds[2], current.projectionFrame.bounds[3]],
          ], { padding, maxZoom: current.activeImagery ? Math.min(17, current.activeImagery.maxzoom) : 17 });
          if (!camera) return null;
          map.jumpTo({ ...camera, pitch: restoredCamera?.pitch ?? 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
          const center = map.getCenter();
          return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
        });
        if (initialized) {
          container.dataset.mapCameraReady = "true";
          recordCamera();
          // A retained selection can attach its marker only after this renderer's
          // initial fit/restoration succeeds, including a later resize retry.
          setReadyCamera(cameraAdmission);
        }
        container.dataset.mapLoaded = String(styleLoaded && cameraAdmission.isReady());
      } catch (error) {
        if (ownsMap()) setRuntimeError(maplibreErrorMessage(error instanceof Error ? error : { message: String(error) }));
      }
    };
    map.on("moveend", () => recordCamera());
    map.on("resize", initializeCamera);
    map.once("load", () => { if (ownsMap()) { styleLoaded = true; initializeCamera(); } });
    initializeCamera();

    let lastTouchHandledAt = 0;
    let touchStartPoint: { x: number; y: number } | null = null;
    let tapAllowed = false;
    const pointerTracking = trackMapPointers(container, allowed => { tapAllowed = allowed; });
    const cancelMapTap = () => { pointerTracking.cancel(); touchStartPoint = null; };
    cancelMapTapRef.current = cancelMapTap;
    const applyMapEvent = (
      point: maplibregl.PointLike,
      lngLat: { lng: number; lat: number },
      closeRequested: boolean,
    ): void => {
      if (!ownsMap() || !cameraAdmission.isReady() || !tapAllowed) return;
      const current = interactionRef.current;
      const rendered = renderStateRef.current;
      if (rendered.homeView) {
        current.setStatus("North America map is a catalog view. Open a field map or design before editing projected XY geometry.");
        return;
      }
      const renderedFeatureId = mapFeatureIdAtPoint(map, point);
      const selectedFeatureId = renderedFeatureId && rendered.project.mapFeatures?.some(feature => feature.id === renderedFeatureId)
        ? renderedFeatureId
        : mapFeatureIdNearLonLat(rendered.project, { longitude: lngLat.lng, latitude: lngLat.lat });
      if (selectedFeatureId && (current.mode === "pan" || !rendered.canEditOnMap)) {
        selectionCallbackRef.current?.(selectedFeatureId);
        current.setStatus(`Selected map feature ${selectedFeatureId}. Project geometry is unchanged.`);
        return;
      }
      current.handleLonLat({ longitude: lngLat.lng, latitude: lngLat.lat }, closeRequested);
    };
    map.on("click", (event) => {
      if (event.originalEvent.detail > 1) return;
      if (Date.now() - lastTouchHandledAt < 350) return;
      applyMapEvent(event.point, event.lngLat, false);
    });
    map.on("touchstart", (event) => {
      const originalEvent = event.originalEvent;
      if (originalEvent.touches.length !== 1) {
        cancelMapTap();
        return;
      }
      if (!tapAllowed) return;
      touchStartPoint = pointLikeToXY(event.point);
    });
    map.on("touchmove", (event) => {
      if (!touchStartPoint) return;
      const point = pointLikeToXY(event.point);
      if (distanceBetweenPoints(touchStartPoint, point) > 10) touchStartPoint = null;
    });
    map.on("touchend", (event) => {
      const originalEvent = event.originalEvent;
      const startPoint = touchStartPoint;
      touchStartPoint = null;
      if (!startPoint) return;
      if (originalEvent.changedTouches.length !== 1 || originalEvent.touches.length > 0) return;
      if (distanceBetweenPoints(startPoint, pointLikeToXY(event.point)) > 10) return;
      event.preventDefault();
      lastTouchHandledAt = Date.now();
      applyMapEvent(event.point, event.lngLat, false);
    });
    map.on("dblclick", (event) => {
      if (!ownsMap() || !cameraAdmission.isReady() || !tapAllowed) return;
      event.preventDefault();
      const current = interactionRef.current;
      if (renderStateRef.current.homeView) return;
      current.handleLonLat({ longitude: event.lngLat.lng, latitude: event.lngLat.lat }, true);
    });
    map.on("error", (event) => {
      if (!ownsMap()) return;
      const message = event.error ? maplibreErrorMessage(event.error) : null;
      if (message) setRuntimeError(message);
    });

    setMapInstance(map);
    return () => {
      recordCamera(true);
      disposed = true;
      if (cameraAdmissionRef.current === cameraAdmission) cameraAdmissionRef.current = null;
      setReadyCamera(current => current === cameraAdmission ? null : current);
      cancelMapTap();
      pointerTracking.dispose();
      if (cancelMapTapRef.current === cancelMapTap) cancelMapTapRef.current = null;
      disposeVertexDragRef.current?.();
      mapRef.current = null;
      setMapInstance(null);
      map.remove();
      delete container.dataset.mapLoaded;
      delete container.dataset.mapCameraReady;
      delete container.dataset.mapCamera;
      delete container.dataset.mapInstance;
    };
  }, [cameraIdentity, cameraSession, styleKey, mapInitializationError, projectionError, svgRecoveryRequested]);

  useEffect(() => {
    const map = mapInstance;
    const cameraFrame = cameraFrameRef.current;
    if (!cameraFrame || !map || map !== mapRef.current || projectionError) return;
    let disposed = false;
    const updateSource = () => {
      if (disposed || map !== mapRef.current || !cameraSession.isCurrent(cameraFrame)) return;
      map.off("styledata", updateSource);
      if (!syncLayoutSource(map, renderStateRef.current.overlay)) map.on("styledata", updateSource);
    };
    // Source readiness is independent of slow raster tiles and the one-shot load event.
    map.on("styledata", updateSource);
    updateSource();
    return () => { disposed = true; map.off("styledata", updateSource); };
  }, [cameraIdentity, cameraSession, mapInstance, projectionError, overlayState.featureCollection]);

  useEffect(() => {
    const map = mapInstance;
    const cameraFrame = cameraFrameRef.current;
    if (!cameraFrame || !map || map !== mapRef.current || typeof ResizeObserver === "undefined") return undefined;
    const container = map.getContainer();
    let previous = { width: map.getCanvas().clientWidth, height: map.getCanvas().clientHeight };
    let hiddenSelection: typeof interactionRef.current.selectedVertex = null;
    let visibleBeforeHide = false;
    const observer = new ResizeObserver(() => {
      if (map !== mapRef.current || !cameraSession.isCurrent(cameraFrame)) return;
      const next = { width: container.clientWidth, height: container.clientHeight };
      if (next.width === previous.width && next.height === previous.height) return;
      const currentSelection = interactionRef.current.selectedVertex;
      const wasVisible = hasVisibleMapSize(previous)
        ? selectedVertexVisibleRef.current?.(previous) ?? false
        : hiddenSelection === currentSelection && visibleBeforeHide;
      previous = next;
      cancelVertexDragRef.current?.();
      cancelMapTapRef.current?.();
      if (!hasVisibleMapSize(next)) {
        hiddenSelection = currentSelection;
        visibleBeforeHide = wasVisible;
        return;
      }
      hiddenSelection = null;
      visibleBeforeHide = false;
      if (wasVisible && currentSelection) pendingSelectionRevealRef.current = { frame: cameraFrame, selection: currentSelection };
      map.resize();
      map.redraw();
      if (wasVisible) revealSelectedVertexRef.current?.(true);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [cameraIdentity, cameraSession, mapInstance]);

  useEffect(() => {
    const map = mapInstance;
    const cameraFrame = cameraFrameRef.current;
    if (!canEditOnMap || mode !== "edit_vertices" || !selectedVertex) {
      revealedSelectionRef.current = null;
      pendingSelectionRevealRef.current = null;
      return undefined;
    }
    if (!cameraFrame || !map || map !== mapRef.current || !cameraSession.isCurrent(cameraFrame)) return undefined;
    const cameraAdmission = cameraAdmissionRef.current;
    if (!cameraAdmission || readyCamera !== cameraAdmission || !cameraAdmission.canUseCamera()) return undefined;
    const selectedPoint = selectedProjectVertexPoint(project, selectedVertex);
    if (!selectedPoint) return undefined;
    const coordinate = projectXyToLonLat(selectedPoint, project.projectCrs);
    let disposed = false;
    const ownsSelection = () => !disposed && cameraAdmissionRef.current === cameraAdmission && cameraAdmission.canUseCamera()
      && map === mapRef.current && cameraSession.isCurrent(cameraFrame)
      && renderStateRef.current.project === project && renderStateRef.current.canEditOnMap
      && interactionRef.current.mode === "edit_vertices" && interactionRef.current.selectedVertex === selectedVertex;
    const element = document.createElement("button");
    element.type = "button";
    element.setAttribute("aria-label", `Drag ${selectedProjectVertexText(project, selectedVertex)}`);
    element.setAttribute("data-testid", "browser-edit-drag-handle");
    Object.assign(element.style, {
      background: "#ffffff",
      border: "3px solid #0f766e",
      borderRadius: "50%",
      boxShadow: "0 1px 4px rgba(17, 28, 23, 0.35)",
      cursor: "grab",
      height: "44px",
      padding: "0",
      touchAction: "none",
      userSelect: "none",
      width: "44px",
    });
    const marker = new maplibregl.Marker({ anchor: "center", draggable: false, element })
      .setLngLat([coordinate.longitude, coordinate.latitude])
      .addTo(map);
    let capturedPointerId: number | null = null;
    let grabOffset = { x: 0, y: 0 };
    const navigation = [map.dragPan, map.touchZoomRotate, map.touchPitch, map.scrollZoom,
      map.keyboard, map.boxZoom, map.dragRotate, map.doubleClickZoom];
    let enabledNavigation: typeof navigation = [];
    const restoreNavigation = (): void => {
      const pointerId = capturedPointerId;
      capturedPointerId = null;
      if (pointerId !== null && element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
      element.style.cursor = "grab";
      for (const handler of enabledNavigation) handler.enable();
      enabledNavigation = [];
    };
    const session = createVertexDragSession({
      preview: (point) => {
        if (!ownsSelection()) { session.cancel(); return; }
        const canvas = map.getCanvas().getBoundingClientRect();
        marker.setLngLat(map.unproject([point.x - canvas.left - grabOffset.x, point.y - canvas.top - grabOffset.y]));
      },
      commit: (point) => {
        if (!ownsSelection()) { restoreNavigation(); return; }
        const canvas = map.getCanvas().getBoundingClientRect();
        const target = map.unproject([point.x - canvas.left - grabOffset.x, point.y - canvas.top - grabOffset.y]);
        element.dataset.dragState = "finished";
        restoreNavigation();
        if (!ownsSelection()) return;
        // The preview is never canonical, including when reducer admission rejects the move.
        marker.setLngLat([coordinate.longitude, coordinate.latitude]);
        if (ownsSelection()) interactionRef.current.moveSelectedVertexToPoint(projectLonLatToXy({ longitude: target.lng, latitude: target.lat }, project.projectCrs));
      },
      cancel: () => {
        element.dataset.dragState = "cancelled";
        restoreNavigation();
        if (ownsSelection()) marker.setLngLat([coordinate.longitude, coordinate.latitude]);
      },
    });
    const selectedVertexVisible = (size?: { width: number; height: number }): boolean => {
      if (!ownsSelection()) return false;
      const canvas = size ?? map.getCanvas().getBoundingClientRect();
      const point = map.project(marker.getLngLat());
      return point.x + 22 >= 0 && point.y + 22 >= 0 && point.x - 22 <= canvas.width && point.y - 22 <= canvas.height;
    };
    const revealSelectedVertex = (explicitSelection = false): void => {
      if (session.activePointerId !== null || !ownsSelection()) return;
      const pending = pendingSelectionRevealRef.current;
      const requested = explicitSelection || (pending?.frame === cameraFrame && pending.selection === selectedVertex);
      if (!requested && !selectedVertexVisible()) return;
      if (requested) pendingSelectionRevealRef.current = { frame: cameraFrame, selection: selectedVertex };
      const canvas = map.getCanvas().getBoundingClientRect();
      const toolHud = toolHudBoundsRef.current;
      const insets = {
        left: !externalHudLayout && compactLayout ? toolHud.x + toolHud.width : 0,
        top: !externalHudLayout && !compactLayout ? toolHud.y + toolHud.height : 0,
        right: 96,
        bottom: Math.max(bottomDockHeightRef.current + 8,
          visibleBottomMapInset(canvas, map.getContainer().parentElement, compactLayout, externalHudLayout)),
      };
      // Keep resize eligibility until the responsive dock has a usable rectangle.
      if (canvas.width < insets.left + insets.right + 52 || canvas.height < insets.top + insets.bottom + 52) return;
      const offset = panOffsetToRevealPoint(map.project(marker.getLngLat()), canvas, insets, 26);
      pendingSelectionRevealRef.current = null;
      if (offset) map.panBy([offset.x, offset.y], { duration: 0 });
    };
    const moveMarker = (event: PointerEvent): void => {
      if (!ownsSelection()) { session.cancel(); return; }
      session.move(event);
    };
    const finishDrag = (event: PointerEvent): void => {
      if (!ownsSelection()) { session.cancel(); return; }
      session.finish(event);
    };
    const startDrag = (event: PointerEvent): void => {
      if (!ownsSelection()) return;
      if (!session.begin(event)) return;
      event.preventDefault();
      event.stopPropagation();
      element.dataset.dragState = "active";
      const canvas = map.getCanvas().getBoundingClientRect();
      const center = map.project(marker.getLngLat());
      grabOffset = { x: event.clientX - canvas.left - center.x, y: event.clientY - canvas.top - center.y };
      capturedPointerId = event.pointerId;
      element.setPointerCapture(event.pointerId);
      element.style.cursor = "grabbing";
      map.stop();
      enabledNavigation = navigation.filter(handler => handler.isEnabled());
      for (const handler of enabledNavigation) handler.disable();
    };
    const cancelPointer = (event: PointerEvent): void => session.cancel(event.pointerId);
    const cancelDrag = (event?: unknown): void => {
      session.cancel();
      if (event && typeof event === "object" && "originalEvent" in event && event.originalEvent) pendingSelectionRevealRef.current = null;
    };
    const cancelHiddenDrag = (): void => { if (document.hidden) session.cancel(); };
    const cancelWithEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") session.cancel(); };
    const stopHandleClick = (event: Event): void => { event.stopPropagation(); };
    element.addEventListener("pointerdown", startDrag);
    element.addEventListener("lostpointercapture", cancelPointer);
    element.addEventListener("click", stopHandleClick);
    element.dataset.dragReady = "true";
    window.addEventListener("pointermove", moveMarker, true);
    window.addEventListener("pointerup", finishDrag, true);
    window.addEventListener("pointercancel", cancelPointer, true);
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("keydown", cancelWithEscape);
    document.addEventListener("visibilitychange", cancelHiddenDrag);
    map.on("movestart", cancelDrag);
    cancelVertexDragRef.current = cancelDrag;
    revealSelectedVertexRef.current = revealSelectedVertex;
    selectedVertexVisibleRef.current = selectedVertexVisible;
    const revealed = revealedSelectionRef.current;
    if (revealed?.frame !== cameraFrame || revealed.selection !== selectedVertex) revealSelectedVertex(true);
    revealedSelectionRef.current = { frame: cameraFrame, selection: selectedVertex };
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      session.cancel();
      if (disposeVertexDragRef.current === dispose) disposeVertexDragRef.current = null;
      if (cancelVertexDragRef.current === cancelDrag) cancelVertexDragRef.current = null;
      if (revealSelectedVertexRef.current === revealSelectedVertex) revealSelectedVertexRef.current = null;
      if (selectedVertexVisibleRef.current === selectedVertexVisible) selectedVertexVisibleRef.current = null;
      element.removeEventListener("pointerdown", startDrag);
      element.removeEventListener("lostpointercapture", cancelPointer);
      element.removeEventListener("click", stopHandleClick);
      window.removeEventListener("pointermove", moveMarker, true);
      window.removeEventListener("pointerup", finishDrag, true);
      window.removeEventListener("pointercancel", cancelPointer, true);
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("keydown", cancelWithEscape);
      document.removeEventListener("visibilitychange", cancelHiddenDrag);
      map.off("movestart", cancelDrag);
      marker.remove();
    };
    disposeVertexDragRef.current = dispose;
    return dispose;
  }, [cameraIdentity, cameraSession, mapInstance, readyCamera, canEditOnMap, compactLayout, externalHudLayout, mode, project, selectedVertex]);

  if (projectionError || mapInitializationError || svgRecoveryRequested) {
    return (
      <View style={[styles.fallbackShell, shortFallback && styles.fallbackShellShort]} testID="browser-map-renderer-fallback">
        <Text style={[styles.fallbackText, shortFallback && styles.fallbackTextShort]} testID="browser-map-renderer-fallback-notice">
          {projectionError
            ? `Browser imagery is unavailable for this project view: ${projectionError}`
            : mapInitializationError ?? "SVG map selected. Imagery preview is disabled."}
        </Text>
        <SvgMapSurface {...props} webGlRenderingDisabled />
      </View>
    );
  }

  function toggleReferenceLayer(layer: ReferenceOverlayLayerKey): void {
    if (!onSettingsChange || !referenceOverlay.canRender) return;
    const nextReferenceOverlay = {
      ...settings.referenceOverlay,
      [layer]: !settings.referenceOverlay[layer],
    };
    onSettingsChange({ ...settings, referenceOverlay: nextReferenceOverlay });
  }

  const editStepMeters = Math.max(1, settings.drawing.panStepMeters / 4);
  const canToggleReferenceOverlay = Boolean(onSettingsChange && referenceOverlay.canRender);
  const advisoryFieldPivotPlanVisible = !homeView && (advisoryFieldPivotPlan?.selectedMachineCount ?? 0) > 0;
  const shortAdvisoryHeader = shortLandscapeHud && advisoryFieldPivotPlanVisible;
  const advisoryPlanDescription = advisoryFieldPivotPlan
    ? `Generated advisory plan · ${advisoryFieldPivotPlan.selectedMachineCount}/${advisoryFieldPivotPlan.requestedMachineCount} centers · review only`
    : "";
  const showHudActions = (!compactLayout && !shortLandscapeHud)
    || canCommitDraft
    || canSaveFeature
    || mode === "edit_vertices"
    || draftVertices.length > 0;

  const sourceControl = <Pressable accessibilityRole="button" accessibilityLabel="Map source details"
    onPress={() => { cancelVertexDragRef.current?.(); setSourceDetailsOpen(true); }}
    style={[styles.attributionHud, compactHud && styles.attributionHudCompact,
      shortLandscapeHud ? styles.attributionHeader : navigationClearanceStyle]} testID="browser-map-attribution-hud">
    <Satellite size={13} color="#173428" />
    <Text numberOfLines={shortLandscapeHud ? 1 : undefined} style={styles.attributionText} testID="browser-map-attribution-credit">{attributionCredit}</Text>
    <Info size={16} color="#173428" />
  </Pressable>;
  return (
    <View style={[styles.shell, shortLandscapeHud && styles.shellShort]} testID="browser-map-workbench">
      <View style={[styles.headerRow, compactHeader && styles.headerRowCompact, shortFallback && styles.headerRowShort]}>
        <View style={[styles.headerTitle, compactHeader && styles.compactHeaderTitle,
          shortAdvisoryHeader && styles.advisoryHeaderTitle]}>
          {!compactHeader ? <Text style={styles.title}>{homeView ? "North America Map" : "Imagery Workbench"}</Text> : null}
          {shortAdvisoryHeader && advisoryFieldPivotPlan ?
            <View pointerEvents="none" accessibilityLabel={advisoryPlanDescription}
              testID="browser-advisory-generated-field-pivot-layer">
              <Text numberOfLines={1} style={styles.advisoryPlanHeader}>Advisory {advisoryFieldPivotPlan.selectedMachineCount}/{advisoryFieldPivotPlan.requestedMachineCount}</Text>
              <Text numberOfLines={1} style={styles.advisoryPlanHeader}>review only</Text>
            </View> :
            <Text numberOfLines={compactHeader ? 1 : undefined} style={styles.subtitle}>{compactHeader ? homeView ? "Catalog" : project.projectCrs
              : `${homeView ? "Customer/project catalog view" : `${project.projectCrs} canonical geometry`} · ${activeImagery?.name ?? "offline overlay"}`}</Text>}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use SVG map"
          accessibilityHint={draftVertices.length > 0 ? "Commit or clear the pending draft before changing renderer." : undefined}
          accessibilityState={{ disabled: draftVertices.length > 0 }}
          disabled={draftVertices.length > 0}
          onPress={() => setSvgRecoveryRequested(true)}
          onHoverIn={() => setRecoveryHovered(true)} onHoverOut={() => setRecoveryHovered(false)}
          onFocus={() => setRecoveryHovered(true)} onBlur={() => setRecoveryHovered(false)}
          style={[styles.toolButton, styles.recoveryButton, compactHeader && styles.recoveryButtonCompact, draftVertices.length > 0 && styles.hudButtonDisabled]}
          testID="browser-map-use-svg"
        >
          <MapPinned size={17} color="#173428" />
          {!compactHeader ? <Text style={styles.toolButtonText}>Use SVG map</Text> : null}
          {compactHeader && recoveryHovered ? <Text style={styles.recoveryTooltip}>Use SVG map</Text> : null}
        </Pressable>
        {shortLandscapeHud ? sourceControl : null}
        <View style={styles.segmented}>
          <ModeSwitch
            active={settings.mappingWorkflowMode === "design"}
            label="Edit map"
            onPress={() => onMappingWorkflowModeChange?.("design")}
            testID="browser-workflow-design"
          />
          <ModeSwitch
            active={settings.mappingWorkflowMode === "layout"}
            label="Inspect map"
            onPress={() => onMappingWorkflowModeChange?.("layout")}
            testID="browser-workflow-layout"
          />
        </View>
      </View>

      <View style={[styles.mapFrame, compactLayout && styles.mapFrameCompact]} testID="browser-map-frame"
        onLayout={event => {
          setPanelWidth(event.nativeEvent.layout.width);
          setPanelHeight(event.nativeEvent.layout.height);
        }}>
        {React.createElement("div", {
          "aria-label": "CPLayout MapLibre imagery workbench",
          ref: containerRef,
          style: mapContainerStyle,
        })}
        {React.createElement("button", {
          type: "button", title: "Fit field", "aria-label": "Fit field", "data-testid": "browser-map-fit-field",
          disabled: !fieldFitBounds || !mapInstance,
          onClick: () => {
            const map = mapRef.current;
            const frame = cameraFrameRef.current;
            if (!map || !frame || !cameraSession.isCurrent(frame) || !fieldFitBounds) return;
            const rect = map.getContainer().getBoundingClientRect();
            const padding = { top: 80, right: 24, bottom: bottomDockHeightRef.current + 24, left: 24 };
            const panel = map.getContainer().parentElement;
            for (const id of ["browser-map-tool-hud", "browser-map-option-hud", "browser-reference-layers-panel", "browser-map-layout-hud", "browser-map-runtime-error"]) {
              const hud = panel?.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
              if (!hud) continue;
              if (id === "browser-map-tool-hud" && compactLayout) padding.left = Math.max(padding.left, hud.right - rect.left + 16);
              else padding.top = Math.max(padding.top, hud.bottom - rect.top + 16);
            }
            padding.bottom = Math.max(padding.bottom,
              visibleBottomMapInset(rect, panel, compactLayout, externalHudLayout));
            if (padding.left + padding.right >= rect.width || padding.top + padding.bottom >= rect.height) return;
            const camera = map.cameraForBounds([[fieldFitBounds.minX, fieldFitBounds.minY], [fieldFitBounds.maxX, fieldFitBounds.maxY]],
              { padding, maxZoom: 20, bearing: 0 });
            if (!camera) return;
            cancelVertexDragRef.current?.();
            cancelMapTapRef.current?.();
            map.stop();
            map.jumpTo({ ...camera, pitch: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } });
          },
          style: { position: "absolute", top: 10, right: 52, width: 44, height: 44, padding: 0,
            display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #aebbae",
            borderRadius: 6, background: "#ffffff", color: "#26392f", cursor: "pointer", zIndex: 4,
            opacity: fieldFitBounds && mapInstance ? 1 : 0.45 },
        }, <Scan size={22} />)}
        {!externalHudLayout ? (
          <View testID="browser-map-tool-hud" style={[styles.toolHud, compactLayout && styles.toolHudCompact]} onLayout={(event) => {
            const next = event.nativeEvent.layout;
            const previous = toolHudBoundsRef.current;
            if (next.x === previous.x && next.y === previous.y && next.width === previous.width && next.height === previous.height) return;
            toolHudBoundsRef.current = next;
            revealSelectedVertexRef.current?.();
          }}>
            <ToolButton active={mode === "pan"} compact={compactLayout} icon={<Hand size={17} color={mode === "pan" ? "#ffffff" : "#173428"} />} label="Pan" onPress={() => setTool("pan")} testID="browser-tool-pan" />
            <ToolButton active={layersPanelOpen} compact={compactLayout} icon={<Layers size={17} color={layersPanelOpen ? "#ffffff" : "#173428"} />} label="Layers" onPress={() => setLayersPanelOpen((open) => !open)} testID="browser-reference-layers-button" />
            {canEditOnMap ? (
              <>
                <ToolButton active={mode === "measure"} compact={compactLayout} icon={<UtilityPole size={17} color={mode === "measure" ? "#ffffff" : "#173428"} />} label="Utility" onPress={() => setTool("measure")} testID="browser-tool-utility" />
                <ToolButton active={mode === "draw_boundary"} compact={compactLayout} icon={<Fence size={17} color={mode === "draw_boundary" ? "#ffffff" : "#173428"} />} label="Boundary" onPress={() => setTool("draw_boundary", "field_boundary")} testID="browser-tool-boundary" />
                <ToolButton active={mode === "mark_obstacle"} compact={compactLayout} icon={<Layers size={17} color={mode === "mark_obstacle" ? "#ffffff" : "#173428"} />} label="Obstacle" onPress={() => setTool("mark_obstacle", "obstacle")} testID="browser-tool-obstacle" />
                <ToolButton active={mode === "edit_vertices"} compact={compactLayout} icon={<MousePointer2 size={17} color={mode === "edit_vertices" ? "#ffffff" : "#173428"} />} label="Edit" onPress={() => setTool("edit_vertices", "field_boundary")} testID="browser-tool-edit-vertices" />
                <ToolButton active={mode === "place_pivot"} compact={compactLayout} icon={<LocateFixed size={17} color={mode === "place_pivot" ? "#ffffff" : "#173428"} />} label="Pivot" onPress={() => setTool("place_pivot", "pivot_center")} testID="browser-tool-pivot" />
                <ToolButton active={mode === "capture_point"} compact={compactLayout} icon={<Crosshair size={17} color={mode === "capture_point" ? "#ffffff" : "#173428"} />} label="Survey" onPress={() => setTool("capture_point", "control_point")} testID="browser-tool-survey" />
              </>
            ) : null}
          </View>
        ) : null}

        {canEditOnMap && mode === "mark_obstacle" && !externalHudLayout ? (
          <View testID="browser-map-option-hud" pointerEvents="box-none" style={[styles.optionHud, compactLayout && styles.optionHudCompact]}>
            {(["obstacle", "road", "ditch", "fence", "tree", "building", "canal", "exclusion"] as DrawingLayerType[]).map((layer) => (
              <Chip key={layer} active={activeLayer === layer} label={layer.replaceAll("_", " ")} onPress={() => setActiveLayer(layer)} />
            ))}
          </View>
        ) : null}

        {layersPanelOpen ? (
          <View style={[styles.referenceLayerHud, compactLayout && styles.referenceLayerHudCompact]} testID="browser-reference-layers-panel">
            <Text style={styles.referenceLayerTitle}>Reference Layers</Text>
            <Text style={styles.referenceLayerMeta}>
              {referenceView.referenceSummary}
            </Text>
            <View style={styles.referenceLayerActions}>
              <LayerToggle
                active={referenceOverlay.canRender && settings.referenceOverlay.roads}
                disabled={!canToggleReferenceOverlay}
                label="Roads"
                onPress={() => toggleReferenceLayer("roads")}
                testID="reference-layer-roads"
              />
              <LayerToggle
                active={referenceOverlay.canRender && settings.referenceOverlay.borders}
                disabled={!canToggleReferenceOverlay}
                label="Borders"
                onPress={() => toggleReferenceLayer("borders")}
                testID="reference-layer-borders"
              />
              <LayerToggle
                active={referenceOverlay.canRender && settings.referenceOverlay.labels}
                disabled={!canToggleReferenceOverlay}
                label="Labels"
                onPress={() => toggleReferenceLayer("labels")}
                testID="reference-layer-labels"
              />
            </View>
            <Text style={styles.referenceLayerAttribution}>
              {referenceOverlay.attribution
                ? `${referenceOverlay.attribution} · ${referenceOverlay.licenseText ?? "License metadata required"}`
                : "Local vector overlays only; no public OSM raster tiles or hosted basemap APIs are requested."}
            </Text>
          </View>
        ) : null}

        {canEditOnMap && mode === "place_pivot" && !externalHudLayout ? (
          <View testID="browser-map-option-hud" pointerEvents="box-none" style={[styles.optionHud, compactLayout && styles.optionHudCompact]}>
            {(["pivot_center", "water_source", "power_source"] as DrawingLayerType[]).map((layer) => (
              <Chip key={layer} active={activeLayer === layer} label={layer.replaceAll("_", " ")} onPress={() => setActiveLayer(layer)} />
            ))}
          </View>
        ) : null}

        {canEditOnMap && mode === "capture_point" && !externalHudLayout ? (
          <View testID="browser-map-option-hud" pointerEvents="box-none" style={[styles.optionHud, compactLayout && styles.optionHudCompact]}>
            {(["control_point", "field_boundary", "obstacle", "note_point"] as DrawingLayerType[]).map((layer) => (
              <Chip key={layer} active={activeLayer === layer} label={layer.replaceAll("_", " ")} onPress={() => setActiveLayer(layer)} />
            ))}
          </View>
        ) : null}

        {canEditOnMap && mode === "measure" && !externalHudLayout && activeMapFeatureKind ? (
          <View testID="browser-map-option-hud" pointerEvents="box-none" style={[styles.optionHud, compactLayout && styles.optionHudCompact]}>
            {UTILITY_FEATURE_OPTIONS.map((option) => (
              <Chip
                key={option.kind}
                active={mapFeatureKind === option.kind}
                label={option.label}
                onPress={() => setMapFeatureKind(option.kind)}
              />
            ))}
          </View>
        ) : null}

        {!canEditOnMap ? (
          <View style={[styles.layoutHud, compactLayout && styles.layoutHudCompact]} testID="browser-map-layout-hud">
            <MapPinned size={17} color="#173428" />
            <Text style={styles.layoutHudText}>{homeView ? "Catalog map: open a field map or design before editing." : "Inspect map: pointer gestures select and view. Form edits remain available."}</Text>
          </View>
        ) : null}

        <View pointerEvents="box-none" style={[styles.bottomDock, compactLayout && styles.bottomDockCompact]} testID="browser-map-bottom-dock" onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (height === bottomDockHeightRef.current) return;
          bottomDockHeightRef.current = height;
          revealSelectedVertexRef.current?.();
        }}>
          {advisoryFieldPivotPlanVisible && advisoryFieldPivotPlan && !shortLandscapeHud ? (
            <View pointerEvents="none" accessibilityLabel={advisoryPlanDescription}
              style={[styles.advisoryPlanHud, compactLayout && styles.advisoryPlanHudCompact]} testID="browser-advisory-generated-field-pivot-layer">
              <MapPinned size={13} color="#5b21b6" />
              <Text numberOfLines={compactLayout ? 1 : undefined} style={styles.advisoryPlanText}>
                Generated advisory plan · {advisoryFieldPivotPlan.selectedMachineCount}/{advisoryFieldPivotPlan.requestedMachineCount} centers · review only
              </Text>
            </View>
          ) : null}
          {!shortLandscapeHud ? sourceControl : null}
          <View pointerEvents={showHudActions ? "box-none" : "none"}
            style={[styles.statusHud, compactHud && styles.statusHudCompact, shortLandscapeHud && styles.statusHudShort, navigationClearanceStyle,
              sheetInsetBottom > 0 && [styles.statusHudAboveSheet, { bottom: sheetInsetBottom }]]}
            testID="browser-map-status-hud">
            <View pointerEvents="none" style={styles.statusTextGroup}>
              <Text style={styles.statusText} testID="browser-map-action-status">{status}</Text>
              {!(shortLandscapeHud && mode === "edit_vertices") && <Text style={styles.statusMeta}>{statusMetaText}</Text>}
              {draftVertices.length > 1 ? <Text style={styles.statusMeta} testID="browser-map-draft-measurement">{draftMeasurementText(mode === "measure" ? controller.activeFeatureGeometry : "Polygon", draftVertices, project.projectCrs, settings.unitSystem)}</Text> : null}
            </View>
            {showHudActions ? <HudActionRow compact={compactHud || shortLandscapeHud}>
              {mode !== "edit_vertices" ? <>
                {mode !== "measure" ? <HudButton disabled={!canCommitDraft} icon={<Check size={15} color={canCommitDraft ? "#ffffff" : "#718077"} />} label="Commit" onPress={commitDraft} primary={canCommitDraft} testID="browser-action-commit" /> : null}
                {mode === "measure" ? <HudButton disabled={!canSaveFeature} icon={<Check size={15} color={canSaveFeature ? "#ffffff" : "#718077"} />} label={activeMapFeatureKind ? "Save Feature" : "Finish"} onPress={saveMapFeatureFromDraft} primary={canSaveFeature} testID="browser-action-save-feature" /> : null}
                <HudButton disabled={!controller.canUndoDraftVertex} icon={<Undo2 size={15} color="#173428" />} label="Remove last vertex" onPress={controller.undoDraftVertex} testID="browser-action-undo-draft" />
              </> : null}
              {canEditOnMap && mode === "edit_vertices" ? (
                <>
                  <HudButton disabled={project.fieldBoundary.length === 0} icon={<MousePointer2 size={15} color={project.fieldBoundary.length > 0 ? "#173428" : "#718077"} />} label="Boundary" onPress={selectFirstBoundaryVertex} testID="browser-edit-select-boundary" />
                  <HudButton disabled={!hasObstacleVertexSelection(project)} icon={<MousePointer2 size={15} color={hasObstacleVertexSelection(project) ? "#173428" : "#718077"} />} label="Obstacle" onPress={selectFirstObstacleVertex} testID="browser-edit-select-obstacle" />
                  <HudButton disabled={!hasMapFeatureVertexSelection(project)} icon={<MousePointer2 size={15} color={hasMapFeatureVertexSelection(project) ? "#173428" : "#718077"} />} label="Feature" onPress={selectFirstMapFeatureVertex} testID="browser-edit-select-feature" />
                  <HudButton disabled={!selectedVertex} icon={<ArrowLeft size={15} color={selectedVertex ? "#173428" : "#718077"} />} label="Prev" onPress={() => selectAdjacentVertex(-1)} testID="browser-edit-previous-vertex" />
                  <HudButton disabled={!selectedVertex} icon={<ArrowRight size={15} color={selectedVertex ? "#173428" : "#718077"} />} label="Next" onPress={() => selectAdjacentVertex(1)} testID="browser-edit-next-vertex" />
                  <HudButton disabled={!canInsertSelectedVertex} icon={<Plus size={15} color={canInsertSelectedVertex ? "#173428" : "#718077"} />} label="Insert" onPress={insertAfterSelectedVertex} testID="browser-edit-insert-vertex" />
                  <HudButton disabled={!canEditSelectedVertex} icon={<ArrowRight size={15} color={canEditSelectedVertex ? "#173428" : "#718077"} />} label="Nudge E" onPress={() => nudgeSelectedVertex({ x: editStepMeters, y: 0 })} testID="browser-edit-nudge-east" />
                  <HudButton disabled={!canDeleteSelectedVertex} icon={<Trash2 size={15} color={canDeleteSelectedVertex ? "#173428" : "#718077"} />} label="Delete" onPress={deleteSelectedVertex} testID="browser-edit-delete-vertex" />
                </>
              ) : null}
              {mode !== "edit_vertices" ? <HudButton disabled={draftVertices.length === 0} icon={<X size={15} color={draftVertices.length > 0 ? "#173428" : "#718077"} />} label="Clear" onPress={() => clearDraft()} testID="browser-action-clear" /> : null}
            </HudActionRow> : null}
          </View>
          {bottomOverlay ? (
            <View pointerEvents="box-none" style={styles.bottomOverlaySlot}>
              {bottomOverlay}
            </View>
          ) : null}
        </View>
        {runtimeError ? <Text numberOfLines={2} style={styles.runtimeError} testID="browser-map-runtime-error">{runtimeError}</Text> : null}
      </View>
      <Modal accessibilityLabel="Map Sources" transparent visible={sourceDetailsOpen} onRequestClose={() => setSourceDetailsOpen(false)} animationType="none">
        <View style={styles.sourceBackdrop}>
          <View accessibilityViewIsModal style={styles.sourceDialog} testID="browser-map-source-dialog">
            <View style={styles.sourceDialogHeader}>
              <Text style={styles.sourceDialogTitle}>Map Sources</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close map source details" onPress={() => setSourceDetailsOpen(false)} style={styles.sourceClose}>
                <X size={20} color="#26392f" />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.sourceDialogBody}>
              <Text style={styles.sourceName}>{activeImagery?.name ?? "Imagery unavailable"}</Text>
              <Text selectable style={styles.sourceText}>{activeImagery?.attribution ?? aerialImagery.reason}</Text>
              {activeImagery?.licenseText ? <Text selectable style={styles.sourceText}>{activeImagery.licenseText}</Text> : null}
              <Text style={styles.sourceName}>Reference Layers</Text>
              <Text selectable style={styles.sourceText}>{referenceView.referenceSummary}</Text>
              {referenceOverlay.attribution ? <Text selectable style={styles.sourceText}>{referenceOverlay.attribution}</Text> : null}
              {referenceOverlay.licenseText ? <Text selectable style={styles.sourceText}>{referenceOverlay.licenseText}</Text> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function visibleBottomMapInset(
  mapRect: DOMRect,
  panel: Element | null,
  compactLayout: boolean,
  externalHudLayout: boolean,
): number {
  const sheet = compactLayout && externalHudLayout
    ? document.querySelector('[data-testid="right-workflow-sidebar"]') : null;
  const obstructions = [panel?.querySelector('[data-testid="browser-map-status-hud"]'),
    sheet && getComputedStyle(sheet).position === "absolute" ? sheet : null];
  let inset = 0;
  for (const obstruction of obstructions) {
    if (!obstruction) continue;
    const rect = obstruction.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.top < mapRect.bottom && rect.bottom > mapRect.top) {
      inset = Math.max(inset, mapRect.bottom - rect.top + 16);
    }
  }
  return inset;
}

function mapRendererFallbackMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  const reason = /webgl/i.test(detail)
    ? "WebGL is unavailable in this browser session."
    : "The browser map renderer could not start.";
  return `${reason} Offline SVG map mode is active; projected project geometry is unchanged.`;
}

function syncLayoutSource(
  map: maplibregl.Map,
  featureCollection: ReturnType<typeof projectLayoutToWgs84FeatureCollection>,
): boolean {
  const source = map.getSource("layout");
  if (source && "setData" in source) {
    (source as { setData: (data: unknown) => void }).setData(featureCollection);
    return true;
  }
  return false;
}

function mapFeatureIdAtPoint(map: maplibregl.Map, point: maplibregl.PointLike): string | null {
  const screenPoint = pointLikeToXY(point);
  const tolerancePixels = 10;
  const features = map.queryRenderedFeatures([
    [screenPoint.x - tolerancePixels, screenPoint.y - tolerancePixels],
    [screenPoint.x + tolerancePixels, screenPoint.y + tolerancePixels],
  ], {
    layers: ["map-feature-polygon", "map-feature-line", "map-feature-point"],
  });
  const id = features.find((feature) => typeof feature.properties?.id === "string")?.properties?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function mapFeatureIdNearLonLat(project: MapSurfaceProps["project"], lonLat: LonLat): string | null {
  const point = projectLonLatToXy(lonLat, project.projectCrs);
  const selectionToleranceMeters = 80;
  const candidates = (project.mapFeatures ?? [])
    .map((feature) => ({ feature, distanceMeters: distanceToMapFeature(point, feature) }))
    .filter((candidate) => candidate.distanceMeters <= selectionToleranceMeters)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  return candidates[0]?.feature.id ?? null;
}

function distanceToMapFeature(point: XY, feature: ProjectMapFeature): number {
  if (feature.geometry.type === "Point") return distanceBetweenPoints(point, feature.geometry.point);
  if (feature.geometry.type === "Circle") {
    return Math.abs(distanceBetweenPoints(point, feature.geometry.center) - feature.geometry.radiusMeters);
  }
  if (feature.geometry.type === "Polygon") {
    if (pointInPolygon(point, feature.geometry.vertices)) return 0;
    return minDistanceToPolyline(point, [...feature.geometry.vertices, feature.geometry.vertices[0]]);
  }
  return minDistanceToPolyline(point, feature.geometry.vertices);
}

function minDistanceToPolyline(point: XY, vertices: XY[]): number {
  if (vertices.length === 0) return Number.POSITIVE_INFINITY;
  if (vertices.length === 1) return distanceBetweenPoints(point, vertices[0]);
  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < vertices.length; index += 1) {
    best = Math.min(best, distanceToSegment(point, vertices[index - 1], vertices[index]));
  }
  return best;
}

function distanceToSegment(point: XY, start: XY, end: XY): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceBetweenPoints(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distanceBetweenPoints(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function pointInPolygon(point: XY, vertices: XY[]): boolean {
  let inside = false;
  for (let index = 0, previousIndex = vertices.length - 1; index < vertices.length; previousIndex = index, index += 1) {
    const current = vertices[index];
    const previous = vertices[previousIndex];
    const crosses = (current.y > point.y) !== (previous.y > point.y)
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointLikeToXY(point: maplibregl.PointLike): { x: number; y: number } {
  if (Array.isArray(point)) return { x: point[0], y: point[1] };
  return { x: point.x, y: point.y };
}

function distanceBetweenPoints(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function ModeSwitch({ active, label, onPress, testID }: { active: boolean; label: string; onPress: () => void; testID?: string }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} aria-pressed={active} onPress={onPress} style={[styles.modeSwitch, active && styles.modeSwitchActive]} testID={testID}>
      <Text style={[styles.modeSwitchText, active && styles.modeSwitchTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ToolButton({ active, compact = false, icon, label, onPress, testID }: { active: boolean; compact?: boolean; icon: React.ReactNode; label: string; onPress: () => void; testID?: string }): React.JSX.Element {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ selected: active }} aria-pressed={active} onPress={onPress} style={[styles.toolButton, compact && styles.toolButtonCompact, active && styles.toolButtonActive]} testID={testID}>
      {icon}
      {!compact ? <Text style={[styles.toolButtonText, active && styles.toolButtonTextActive]}>{label}</Text> : null}
    </Pressable>
  );
}

function LayerToggle({ active, disabled, label, onPress, testID }: { active: boolean; disabled: boolean; label: string; onPress: () => void; testID?: string }): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ checked: active, disabled }}
      aria-disabled={disabled}
      aria-pressed={active}
      disabled={disabled}
      onPress={onPress}
      style={[styles.layerToggle, active && styles.layerToggleActive, disabled && styles.layerToggleDisabled]}
      testID={testID}
    >
      <Text style={[styles.layerToggleText, active && styles.layerToggleTextActive, disabled && styles.layerToggleTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

function Chip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} aria-pressed={active} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function HudButton({ compact = false, disabled = false, icon, label, onPress, primary = false, testID }: { compact?: boolean; disabled?: boolean; icon: React.ReactNode; label: string; onPress: () => void; primary?: boolean; testID?: string }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} aria-disabled={disabled} disabled={disabled} onPress={onPress} style={[styles.hudButton, compact && styles.hudButtonCompact, primary && styles.hudButtonPrimary, disabled && styles.hudButtonDisabled]} testID={testID}>
      {icon}
      <Text style={[styles.hudButtonText, compact && styles.hudButtonTextCompact, primary && styles.hudButtonTextPrimary, disabled && styles.hudButtonTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

function HudActionRow({ children, compact }: { children: React.ReactNode; compact: boolean }): React.JSX.Element {
  if (compact) {
    const compactChildren = (nodes: React.ReactNode): React.ReactNode => React.Children.map(nodes, (child) => {
      if (!React.isValidElement<{ children?: React.ReactNode; compact?: boolean }>(child)) return child;
      return child.type === React.Fragment
        ? React.cloneElement(child, {}, compactChildren(child.props.children))
        : React.cloneElement(child, { compact: true });
    });
    return (
      <ScrollView
        contentContainerStyle={[styles.hudActions, styles.hudActionsCompact]}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.hudActionsScroller}
        testID="browser-map-hud-actions"
      >
        {compactChildren(children)}
      </ScrollView>
    );
  }
  return <View pointerEvents="box-none" style={styles.hudActions} testID="browser-map-hud-actions">{children}</View>;
}

const mapContainerStyle: React.CSSProperties = {
  bottom: 0,
  left: 0,
  position: "absolute",
  right: 0,
  top: 0,
};

const styles = StyleSheet.create({
  shell: {
    alignSelf: "stretch",
    backgroundColor: "#f7faf5",
    borderColor: "#ccd8cf",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 10,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
  },
  shellShort: { gap: 4 },
  headerRow: {
    alignItems: "center",
    backgroundColor: "#fbfdf9",
    borderBottomColor: "#d7e0d8",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  title: {
    color: "#111c17",
    fontSize: 16,
    fontWeight: "900",
  },
  headerRowCompact: { paddingHorizontal: 8, paddingVertical: 6, gap: 6 },
  headerRowShort: { paddingVertical: 2, flexWrap: "nowrap" },
  compactHeaderTitle: { flex: 1, minWidth: 0 },
  advisoryHeaderTitle: { minWidth: 72 },
  recoveryButtonCompact: { flexBasis: 44, width: 44, paddingHorizontal: 0 },
  recoveryTooltip: { position: "absolute", top: 44, right: 0, width: 100, padding: 6, borderRadius: 4,
    backgroundColor: "#26392f", color: "#ffffff", fontSize: 12, zIndex: 10 },
  subtitle: {
    color: "#506259",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  segmented: {
    backgroundColor: "#e8efe8",
    borderColor: "#c9d6cb",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  modeSwitch: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  modeSwitchActive: {
    backgroundColor: "#173428",
  },
  modeSwitchText: {
    color: "#173428",
    fontSize: 12,
    fontWeight: "900",
  },
  modeSwitchTextActive: {
    color: "#ffffff",
  },
  mapFrame: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
  },
  mapFrameCompact: {
    minHeight: 0,
  },
  toolHud: {
    backgroundColor: "rgba(251,253,249,0.95)",
    borderColor: "#c9d6cb",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    left: 12,
    right: 108,
    padding: 6,
    position: "absolute",
    top: 12,
    zIndex: 4,
  },
  toolHudCompact: {
    flexDirection: "column",
    flexWrap: "nowrap",
    left: 8,
    maxWidth: 58,
    top: 72,
    width: 58,
  },
  headerTitle: {
    maxWidth: "100%",
    flexShrink: 1,
  },
  recoveryButton: {
    flexBasis: 130,
    flexShrink: 0,
    height: 44,
    justifyContent: "center",
  },
  toolButton: {
    alignItems: "center",
    backgroundColor: "#edf4ed",
    borderColor: "#cbd8ce",
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 74,
    flexGrow: 0,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  toolButtonActive: {
    backgroundColor: "#173428",
    borderColor: "#173428",
  },
  toolButtonCompact: {
    flexBasis: 44,
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 0,
    paddingVertical: 0,
    width: 44,
  },
  toolButtonText: {
    color: "#173428",
    fontSize: 12,
    fontWeight: "900",
  },
  toolButtonTextActive: {
    color: "#ffffff",
  },
  optionHud: {
    backgroundColor: "rgba(251,253,249,0.95)",
    borderColor: "#c9d6cb",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    left: 12,
    maxWidth: "78%",
    padding: 6,
    position: "absolute",
    top: 70,
    zIndex: 3,
  },
  optionHudCompact: {
    left: 74,
    maxWidth: "72%",
    top: 72,
  },
  referenceLayerHud: {
    backgroundColor: "rgba(251,253,249,0.97)",
    borderColor: "#c9d6cb",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    left: 12,
    maxWidth: 340,
    padding: 10,
    position: "absolute",
    top: 70,
  },
  referenceLayerHudCompact: {
    left: 74,
    maxWidth: "72%",
    right: 8,
    top: 72,
  },
  referenceLayerTitle: {
    color: "#173428",
    fontSize: 13,
    fontWeight: "900",
  },
  referenceLayerMeta: {
    color: "#47584d",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 15,
  },
  referenceLayerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  referenceLayerAttribution: {
    color: "#57675e",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
  },
  layerToggle: {
    backgroundColor: "#f5f8f2",
    borderColor: "#d2ded4",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  layerToggleActive: {
    backgroundColor: "#173428",
    borderColor: "#173428",
  },
  layerToggleDisabled: {
    opacity: 0.56,
  },
  layerToggleText: {
    color: "#173428",
    fontSize: 11,
    fontWeight: "900",
  },
  layerToggleTextActive: {
    color: "#ffffff",
  },
  layerToggleTextDisabled: {
    color: "#66776d",
  },
  chip: {
    backgroundColor: "#f5f8f2",
    borderColor: "#d2ded4",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  chipActive: {
    backgroundColor: "#dcece6",
    borderColor: "#59937e",
  },
  chipText: {
    color: "#365044",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  chipTextActive: {
    color: "#173428",
  },
  bottomDock: {
    bottom: 8,
    gap: 8,
    left: 12,
    position: "absolute",
    right: 12,
    zIndex: 5,
  },
  bottomDockCompact: {
    bottom: 8,
    left: 8,
    right: 8,
  },
  bottomOverlaySlot: {
    maxWidth: "100%",
    width: "100%",
  },
  advisoryPlanHud: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(250,245,255,0.96)",
    borderColor: "#c4b5fd",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    maxWidth: "92%",
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  advisoryPlanHeader: { lineHeight: 14, color: "#4c1d95", backgroundColor: "#faf5ff", fontSize: 10, fontWeight: "800" },
  advisoryPlanHudCompact: {
    maxWidth: "100%",
    overflow: "hidden",
    paddingVertical: 5,
  },
  advisoryPlanText: {
    color: "#4c1d95",
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 14,
  },
  statusHud: {
    alignItems: "stretch",
    backgroundColor: "rgba(17,28,23,0.92)",
    borderRadius: 8,
    flexDirection: "column",
    gap: 10,
    maxWidth: "92%",
    padding: 10,
    width: "100%",
  },
  statusHudCompact: {
    alignItems: "stretch",
    flexDirection: "column",
    flexWrap: "nowrap",
    gap: 6,
    maxWidth: "100%",
  },
  statusHudShort: { padding: 4, gap: 4 },
  statusHudAboveSheet: {
    left: 0,
    position: "absolute",
    right: 0,
  },
  statusTextGroup: {
    flexShrink: 0,
    gap: 2,
    minWidth: 0,
  },
  statusText: {
    color: "#f8fbf6",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 17,
  },
  statusMeta: {
    color: "#c9d8d0",
    fontSize: 11,
    fontWeight: "800",
  },
  hudActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    maxWidth: "100%",
  },
  hudActionsCompact: {
    flexWrap: "nowrap",
    minWidth: 0,
    paddingRight: 6,
  },
  hudActionsScroller: {
    alignSelf: "stretch",
    maxWidth: "100%",
  },
  hudButton: {
    alignItems: "center",
    backgroundColor: "#eef5ef",
    borderColor: "#c7d6ca",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  hudButtonCompact: {
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  hudButtonPrimary: {
    backgroundColor: "#0f766e",
    borderColor: "#0f766e",
  },
  hudButtonDisabled: {
    opacity: 0.58,
  },
  hudButtonText: {
    color: "#173428",
    fontSize: 11,
    fontWeight: "900",
  },
  hudButtonTextCompact: {
    fontSize: 10,
  },
  hudButtonTextPrimary: {
    color: "#ffffff",
  },
  hudButtonTextDisabled: {
    color: "#718077",
  },
  layoutHud: {
    alignItems: "center",
    backgroundColor: "rgba(255,250,235,0.96)",
    borderColor: "#dfc77f",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    left: 12,
    maxWidth: "90%",
    padding: 10,
    position: "absolute",
    top: 70,
  },
  layoutHudCompact: {
    left: 74,
    maxWidth: "72%",
    right: 8,
    top: 72,
  },
  layoutHudText: {
    color: "#553b09",
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "900",
  },
  attributionHud: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(251,253,249,0.95)",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    minHeight: 44,
    maxWidth: "92%",
    minWidth: 0,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  attributionHeader: { alignSelf: "center", maxWidth: "40%", flexShrink: 1, paddingHorizontal: 6 },
  attributionHudCompact: {
    maxWidth: "100%",
    paddingVertical: 5,
  },
  attributionText: {
    color: "#173428",
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
    minWidth: 0,
  },
  sourceBackdrop: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16, backgroundColor: "rgba(19,33,27,0.58)" },
  sourceDialog: { width: "100%", maxWidth: 480, maxHeight: "80%", backgroundColor: "#fbfcf8", borderRadius: 8, overflow: "hidden" },
  sourceDialogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingLeft: 16 },
  sourceDialogTitle: { flex: 1, color: "#26392f", fontSize: 16, fontWeight: "700" },
  sourceClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  sourceDialogBody: { padding: 16, gap: 10 },
  sourceName: { color: "#26392f", fontSize: 13, fontWeight: "700" },
  sourceText: { color: "#405448", fontSize: 13, lineHeight: 19 },
  runtimeError: {
    backgroundColor: "#fff2df",
    borderColor: "#e4b56d",
    borderRadius: 8,
    borderWidth: 1,
    color: "#7a3d10",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 15,
    left: 12,
    padding: 8,
    position: "absolute",
    right: 12,
    top: 76,
  },
  fallbackShell: {
    flex: 1,
    gap: 10,
    minHeight: 0,
    minWidth: 0,
  },
  fallbackShellShort: { gap: 2 },
  fallbackTextShort: { paddingVertical: 2, paddingHorizontal: 8 },
  fallbackText: {
    backgroundColor: "#fff2df",
    borderColor: "#e4b56d",
    borderRadius: 8,
    borderWidth: 1,
    color: "#7a3d10",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 17,
    padding: 10,
  },
});
