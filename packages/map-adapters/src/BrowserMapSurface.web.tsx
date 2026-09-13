import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Fence,
  Hand,
  Layers,
  LocateFixed,
  MapPinned,
  MousePointer2,
  Plus,
  Satellite,
  Trash2,
  UtilityPole,
  X,
} from "lucide-react-native";
import { maplibregl, maplibreErrorMessage } from "./maplibreRuntime.web";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

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

export function BrowserMapSurface(props: MapSurfaceProps): React.JSX.Element {
  const {
    advisoryFieldPivotPlan, advisoryMachineRenderModel, bottomOverlay,
    controlLayout = "internalRows", project, result, settings, activeMapFeatureKind,
    onMappingWorkflowModeChange, onSelectMapFeature, onSettingsChange,
  } = props;
  const homeView = props.homeView === true;
  const { width } = useWindowDimensions();
  const compactLayout = width < 760;
  const externalHudLayout = controlLayout === "externalHud";
  const designMode = settings.mappingWorkflowMode === "design";
  const canEditOnMap = designMode && !homeView;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
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
    nudgeSelectedVertex, moveSelectedVertexToPoint, insertAfterSelectedVertex,
    deleteSelectedVertex, canCommitDraft, canSaveFeature, canEditSelectedVertex,
    canDeleteSelectedVertex, canInsertSelectedVertex,
  } = controller;
  const interactionRef = useRef(controller);
  interactionRef.current = controller;
  const selectionCallbackRef = useRef(onSelectMapFeature);
  selectionCallbackRef.current = onSelectMapFeature;
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [svgRecoveryRequested, setSvgRecoveryRequested] = useState(false);
  const [mapInitializationError, setMapInitializationError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
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
        featureCollection: projectLayoutToWgs84FeatureCollection(project, result, draftVertices, advisoryFieldPivotPlan, advisoryMachineRenderModel),
        error: null as string | null,
      };
    } catch (error) {
      return {
        featureCollection: { type: "FeatureCollection" as const, features: [] },
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [advisoryFieldPivotPlan, advisoryMachineRenderModel, draftVertices, homeView, project, result]);
  const projectionError = projectionFrame.error ?? overlayState.error;
  const imageryKey = activeImagery
    ? `${activeImagery.id}:${activeImagery.url ?? ""}:${activeImagery.tiles?.join("|") ?? ""}:${activeImagery.minzoom}:${activeImagery.maxzoom}`
    : "no-aerial-imagery";
  const providerKey = aerialImagery.onlineProvider
    ? `${aerialImagery.onlineProvider.id}:${aerialImagery.onlineProvider.tileUrlTemplate}:${aerialImagery.onlineProvider.tileScheme}:${aerialImagery.onlineProvider.minZoom}:${aerialImagery.onlineProvider.maxZoom}`
    : "no-live-imagery";
  const referenceOverlay = referenceView.reference;
  const referenceOverlayKey = [
    referenceOverlay.status,
    referenceOverlay.sourceKind,
    referenceOverlay.packageId ?? "",
    referenceOverlay.source?.url ?? "",
    referenceOverlay.source?.tiles?.join("|") ?? "",
    referenceOverlay.rasterSources?.flatMap((source) => source.tiles).join("|") ?? "",
    settings.referenceOverlay.mode,
    settings.referenceOverlay.roads,
    settings.referenceOverlay.borders,
    settings.referenceOverlay.labels,
    settings.referenceOverlay.schema,
  ].join(":");
  useEffect(() => {
    if (!containerRef.current || projectionError || mapInitializationError || svgRecoveryRequested) return undefined;
    setRuntimeError(null);
    let map: maplibregl.Map;
    try {
      registerPmtilesProtocolOnce();
      map = new maplibregl.Map({
        attributionControl: false,
        // Source loading must not change the camera after capture starts.
        bounds: [
          [projectionFrame.bounds[0], projectionFrame.bounds[1]],
          [projectionFrame.bounds[2], projectionFrame.bounds[3]],
        ],
        container: containerRef.current,
        dragRotate: false,
        fitBoundsOptions: {
          maxZoom: activeImagery ? Math.min(17, activeImagery.maxzoom) : 17,
          padding: 48,
        },
        pitchWithRotate: false,
        style: buildWorkbenchStyle(activeImagery, overlayState.featureCollection, referenceOverlay, settings.referenceOverlay),
      });
      map.doubleClickZoom.disable();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    } catch (error) {
      setMapInitializationError(mapRendererFallbackMessage(error));
      return undefined;
    }
    mapRef.current = map;
    const container = map.getContainer();
    container.dataset.mapLoaded = "false";
    const recordCamera = () => {
      const center = map.getCenter();
      container.dataset.mapCamera = JSON.stringify([center.lng, center.lat, map.getZoom(), map.getBearing(), map.getPitch()]);
    };
    recordCamera();
    map.on("moveend", recordCamera);
    map.once("load", () => { container.dataset.mapLoaded = "true"; });

    let lastTouchHandledAt = 0;
    let touchStartPoint: { x: number; y: number } | null = null;
    const applyMapEvent = (
      point: maplibregl.PointLike,
      lngLat: { lng: number; lat: number },
      closeRequested: boolean,
    ): void => {
      const current = interactionRef.current;
      if (homeView) {
        current.setStatus("North America map is a catalog view. Open a field map or design before editing projected XY geometry.");
        return;
      }
      const selectedFeatureId = mapFeatureIdAtPoint(map, point)
        ?? mapFeatureIdNearLonLat(project, { longitude: lngLat.lng, latitude: lngLat.lat });
      if (selectedFeatureId && (current.mode === "pan" || !canEditOnMap)) {
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
        touchStartPoint = null;
        return;
      }
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
      event.preventDefault();
      const current = interactionRef.current;
      if (homeView) return;
      current.handleLonLat({ longitude: event.lngLat.lng, latitude: event.lngLat.lat }, true);
    });
    map.on("error", (event) => {
      const message = event.error ? maplibreErrorMessage(event.error) : null;
      if (message) setRuntimeError(message);
    });

    return () => {
      mapRef.current = null;
      map.remove();
      delete container.dataset.mapLoaded;
      delete container.dataset.mapCamera;
    };
  }, [activeImagery, canEditOnMap, homeView, imageryKey, mapInitializationError, project.id, projectionError, projectionFrame.bounds, projectionFrame.center, providerKey, referenceOverlayKey, settings.referenceOverlay, svgRecoveryRequested]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || projectionError) return;
    const updateSource = () => syncLayoutSource(map, overlayState.featureCollection);
    if (map.isStyleLoaded()) updateSource();
    else map.once("load", updateSource);
  }, [projectionError, overlayState.featureCollection]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !canEditOnMap || mode !== "edit_vertices" || !selectedVertex) return undefined;
    const selectedPoint = selectedProjectVertexPoint(project, selectedVertex);
    if (!selectedPoint) return undefined;
    const coordinate = projectXyToLonLat(selectedPoint, project.projectCrs);
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
      height: "20px",
      padding: "0",
      width: "20px",
    });
    const marker = new maplibregl.Marker({ anchor: "center", draggable: false, element })
      .setLngLat([coordinate.longitude, coordinate.latitude])
      .addTo(map);
    let dragging = false;
    let activeDragElement: HTMLElement = element;
    const moveMarker = (event: PointerEvent): void => {
      if (!dragging) return;
      const canvasBounds = map.getCanvas().getBoundingClientRect();
      marker.setLngLat(map.unproject([event.clientX - canvasBounds.left, event.clientY - canvasBounds.top]));
    };
    const finishDrag = (event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      activeDragElement.dataset.dragState = "finished";
      activeDragElement.releasePointerCapture?.(event.pointerId);
      activeDragElement.style.cursor = "grab";
      map.dragPan.enable();
      const point = marker.getLngLat();
      moveSelectedVertexToPoint(projectLonLatToXy({ longitude: point.lng, latitude: point.lat }, project.projectCrs));
    };
    const startDrag = (event: PointerEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      element.dataset.dragState = "active";
      activeDragElement.setPointerCapture?.(event.pointerId);
      activeDragElement.style.cursor = "grabbing";
      map.dragPan.disable();
    };
    const moveMarkerWithMouse = (event: MouseEvent): void => {
      if (!dragging) return;
      const canvasBounds = map.getCanvas().getBoundingClientRect();
      marker.setLngLat(map.unproject([event.clientX - canvasBounds.left, event.clientY - canvasBounds.top]));
    };
    const finishMouseDrag = (): void => {
      if (!dragging) return;
      dragging = false;
      activeDragElement.dataset.dragState = "finished";
      activeDragElement.style.cursor = "grab";
      map.dragPan.enable();
      const point = marker.getLngLat();
      moveSelectedVertexToPoint(projectLonLatToXy({ longitude: point.lng, latitude: point.lat }, project.projectCrs));
    };
    const startMouseDrag = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      element.dataset.dragState = "active";
      activeDragElement.style.cursor = "grabbing";
      map.dragPan.disable();
    };
    const delegatedPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-testid="browser-edit-drag-handle"]')
        : null;
      if (!(target instanceof HTMLElement)) return;
      activeDragElement = target;
      startDrag(event);
    };
    const delegatedMouseDown = (event: MouseEvent): void => {
      const target = event.target instanceof Element
        ? event.target.closest('[data-testid="browser-edit-drag-handle"]')
        : null;
      if (!(target instanceof HTMLElement)) return;
      activeDragElement = target;
      startMouseDrag(event);
    };
    const cancelDrag = (): void => {
      if (!dragging) return;
      dragging = false;
      activeDragElement.dataset.dragState = "cancelled";
      activeDragElement.style.cursor = "grab";
      marker.setLngLat([coordinate.longitude, coordinate.latitude]);
      map.dragPan.enable();
    };
    element.addEventListener("pointerdown", startDrag);
    element.addEventListener("mousedown", startMouseDrag);
    element.onpointerdown = startDrag;
    element.onmousedown = startMouseDrag;
    element.dataset.dragReady = "true";
    window.addEventListener("pointermove", moveMarker, true);
    window.addEventListener("pointerdown", delegatedPointerDown, true);
    window.addEventListener("pointerup", finishDrag, true);
    window.addEventListener("pointercancel", cancelDrag, true);
    window.addEventListener("mousemove", moveMarkerWithMouse, true);
    window.addEventListener("mousedown", delegatedMouseDown, true);
    window.addEventListener("mouseup", finishMouseDrag, true);
    return () => {
      element.removeEventListener("pointerdown", startDrag);
      element.removeEventListener("mousedown", startMouseDrag);
      element.onpointerdown = null;
      element.onmousedown = null;
      window.removeEventListener("pointermove", moveMarker, true);
      window.removeEventListener("pointerdown", delegatedPointerDown, true);
      window.removeEventListener("pointerup", finishDrag, true);
      window.removeEventListener("pointercancel", cancelDrag, true);
      window.removeEventListener("mousemove", moveMarkerWithMouse, true);
      window.removeEventListener("mousedown", delegatedMouseDown, true);
      window.removeEventListener("mouseup", finishMouseDrag, true);
      map.dragPan.enable();
      marker.remove();
    };
  }, [canEditOnMap, mode, project, selectedVertex]);

  if (projectionError || mapInitializationError || svgRecoveryRequested) {
    return (
      <View style={styles.fallbackShell} testID="browser-map-renderer-fallback">
        <Text style={styles.fallbackText} testID="browser-map-renderer-fallback-notice">
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
  const showHudActions = !compactLayout
    || canCommitDraft
    || canSaveFeature
    || mode === "edit_vertices"
    || draftVertices.length > 0;

  return (
    <View style={styles.shell} testID="browser-map-workbench">
      <View style={styles.headerRow}>
        <View style={styles.headerTitle}>
          <Text style={styles.title}>{homeView ? "North America Map" : "Imagery Workbench"}</Text>
          <Text style={styles.subtitle}>{homeView ? "Client/project catalog view" : `${project.projectCrs} canonical geometry`} · {activeImagery?.name ?? "offline overlay"} </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use SVG map"
          accessibilityHint={draftVertices.length > 0 ? "Commit or clear the pending draft before changing renderer." : undefined}
          accessibilityState={{ disabled: draftVertices.length > 0 }}
          disabled={draftVertices.length > 0}
          onPress={() => setSvgRecoveryRequested(true)}
          style={[styles.toolButton, styles.recoveryButton, draftVertices.length > 0 && styles.hudButtonDisabled]}
          testID="browser-map-use-svg"
        >
          <MapPinned size={17} color="#173428" />
          <Text style={styles.toolButtonText}>Use SVG map</Text>
        </Pressable>
        <View style={styles.segmented}>
          <ModeSwitch
            active={settings.mappingWorkflowMode === "design"}
            label="Design"
            onPress={() => onMappingWorkflowModeChange?.("design")}
            testID="browser-workflow-design"
          />
          <ModeSwitch
            active={settings.mappingWorkflowMode === "layout"}
            label="Layout"
            onPress={() => onMappingWorkflowModeChange?.("layout")}
            testID="browser-workflow-layout"
          />
        </View>
      </View>

      <View style={[styles.mapFrame, compactLayout && styles.mapFrameCompact]} testID="browser-map-frame">
        {React.createElement("div", {
          "aria-label": "CPLayout MapLibre imagery workbench",
          ref: containerRef,
          style: mapContainerStyle,
        })}
        {!externalHudLayout ? (
          <View style={[styles.toolHud, compactLayout && styles.toolHudCompact]}>
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
          <View pointerEvents="box-none" style={[styles.optionHud, compactLayout && styles.optionHudCompact]}>
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
          <View pointerEvents="box-none" style={[styles.optionHud, compactLayout && styles.optionHudCompact]}>
            {(["pivot_center", "water_source", "power_source"] as DrawingLayerType[]).map((layer) => (
              <Chip key={layer} active={activeLayer === layer} label={layer.replaceAll("_", " ")} onPress={() => setActiveLayer(layer)} />
            ))}
          </View>
        ) : null}

        {canEditOnMap && mode === "capture_point" && !externalHudLayout ? (
          <View pointerEvents="box-none" style={[styles.optionHud, compactLayout && styles.optionHudCompact]}>
            {(["control_point", "field_boundary", "obstacle", "note_point"] as DrawingLayerType[]).map((layer) => (
              <Chip key={layer} active={activeLayer === layer} label={layer.replaceAll("_", " ")} onPress={() => setActiveLayer(layer)} />
            ))}
          </View>
        ) : null}

        {canEditOnMap && mode === "measure" && !externalHudLayout && activeMapFeatureKind ? (
          <View pointerEvents="box-none" style={[styles.optionHud, compactLayout && styles.optionHudCompact]}>
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
            <Text style={styles.layoutHudText}>{homeView ? "Catalog map: open a field map or design before editing." : "Layout mode: RTK-only geometry changes; pointer gestures inspect only."}</Text>
          </View>
        ) : null}

        <View pointerEvents="box-none" style={[styles.bottomDock, compactLayout && styles.bottomDockCompact]} testID="browser-map-bottom-dock">
          {advisoryFieldPivotPlanVisible && advisoryFieldPivotPlan ? (
            <View pointerEvents="none" style={[styles.advisoryPlanHud, compactLayout && styles.advisoryPlanHudCompact]} testID="browser-advisory-generated-field-pivot-layer">
              <MapPinned size={13} color="#5b21b6" />
              <Text numberOfLines={compactLayout ? 1 : undefined} style={styles.advisoryPlanText}>
                Generated advisory plan · {advisoryFieldPivotPlan.selectedMachineCount}/{advisoryFieldPivotPlan.requestedMachineCount} centers · review only
              </Text>
            </View>
          ) : null}
          <View pointerEvents="none" style={[styles.attributionHud, compactLayout && styles.attributionHudCompact]} testID="browser-map-attribution-hud">
            <Satellite size={13} color="#173428" />
            <Text numberOfLines={compactLayout ? 1 : undefined} style={styles.attributionText}>
              {activeImagery ? `${activeImagery.attribution} · ${activeImagery.licenseText}` : aerialImagery.reason}
            </Text>
          </View>
          <View pointerEvents={compactLayout && !canCommitDraft && !canSaveFeature ? "none" : "box-none"} style={[styles.statusHud, externalHudLayout && styles.statusHudExternal, compactLayout && styles.statusHudCompact]} testID="browser-map-status-hud">
            <View pointerEvents="none" style={styles.statusTextGroup}>
              <Text numberOfLines={compactLayout ? 2 : undefined} style={styles.statusText}>{status}</Text>
              <Text numberOfLines={compactLayout ? 1 : undefined} style={styles.statusMeta}>{statusMetaText}</Text>
            </View>
            {showHudActions ? <HudActionRow compact={compactLayout}>
              <HudButton disabled={!canCommitDraft} icon={<Check size={15} color={canCommitDraft ? "#ffffff" : "#718077"} />} label="Commit" onPress={commitDraft} primary={canCommitDraft} testID="browser-action-commit" />
              <HudButton disabled={!canSaveFeature} icon={<Check size={15} color={canSaveFeature ? "#ffffff" : "#718077"} />} label={activeMapFeatureKind ? "Save Feature" : "Choose Purpose"} onPress={saveMapFeatureFromDraft} primary={canSaveFeature} testID="browser-action-save-feature" />
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
              <HudButton disabled={draftVertices.length === 0} icon={<X size={15} color={draftVertices.length > 0 ? "#173428" : "#718077"} />} label="Clear" onPress={() => clearDraft()} testID="browser-action-clear" />
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
    </View>
  );
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
): void {
  const source = map.getSource("layout");
  if (source && "setData" in source) {
    (source as { setData: (data: unknown) => void }).setData(featureCollection);
  }
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
    const compactChildren = React.Children.map(children, (child) => (
      React.isValidElement<{ compact?: boolean }>(child) ? React.cloneElement(child, { compact: true }) : child
    ));
    return (
      <ScrollView
        contentContainerStyle={[styles.hudActions, styles.hudActionsCompact]}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.hudActionsScroller}
        testID="browser-map-hud-actions"
      >
        {compactChildren}
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
    maxWidth: "92%",
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
    alignItems: "center",
    backgroundColor: "rgba(17,28,23,0.92)",
    borderRadius: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    maxWidth: "92%",
    padding: 10,
    width: "100%",
  },
  statusHudExternal: {
    maxHeight: 168,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  statusHudCompact: {
    alignItems: "stretch",
    flexDirection: "column",
    flexWrap: "nowrap",
    gap: 6,
    maxWidth: "100%",
  },
  statusTextGroup: {
    flex: 1,
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
    minHeight: 42,
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
    maxWidth: "92%",
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  attributionHudCompact: {
    maxHeight: 30,
    maxWidth: "100%",
    overflow: "hidden",
    paddingVertical: 5,
  },
  attributionText: {
    color: "#173428",
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
  },
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
