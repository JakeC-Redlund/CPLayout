import {
  ArrowLeft,
  ArrowRight,
  Check,
  MapPinned,
  MousePointer2,
  Satellite,
  Trash2,
  X,
} from "lucide-react-native";
import { Camera, Map as MapLibreMap } from "@maplibre/maplibre-react-native";
import type { NativeSyntheticEvent } from "react-native";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { buildMapReferenceViewModel } from "@cplayout/core";
import { projectLayoutToWgs84FeatureCollection, projectWgs84Bounds, projectWgs84Center } from "./mapOverlayGeoJson";
import {
  buildWorkbenchStyle,
  rasterStyleSourceFromAerialReferenceResolution,
} from "./mapWorkbenchStyle";
import {
  hasMapFeatureVertexSelection,
  hasObstacleVertexSelection,
} from "./projectVertexEditing";
import { SvgMapSurface } from "./SvgMapSurface";
import type { MapSurfaceProps } from "./types";
import { useMapInteractionController } from "./useMapInteractionController";

type NativeMapPressEvent = NativeSyntheticEvent<{
  features?: Array<{ properties?: Record<string, unknown> }>;
  lngLat: [number, number];
  point?: [number, number];
}>;

export function NativeMapWorkbenchSurface(props: MapSurfaceProps): React.JSX.Element {
  const {
    advisoryFieldPivotPlan, advisoryMachineRenderModel, bottomOverlay,
    homeView = false, project, result, settings, onSelectMapFeature,
  } = props;
  const { width } = useWindowDimensions();
  const compactLayout = width < 760;
  const designMode = settings.mappingWorkflowMode === "design";
  const canEditOnMap = designMode && !homeView;
  const referenceView = useMemo(() => buildMapReferenceViewModel({
    settings, mapPackages: project.mapPackages ?? [],
    target: Platform.OS === "ios" ? "ios_maplibre_rn" : "android_maplibre_rn",
    surface: "workbench",
  }), [project.mapPackages, settings.aerialImagery, settings.onlineImagery, settings.referenceOverlay]);
  const aerialImagery = referenceView.aerial;
  const activeImagery = useMemo(() => rasterStyleSourceFromAerialReferenceResolution(aerialImagery), [aerialImagery]);
  const controller = useMapInteractionController(props, { imageryEnabled: Boolean(activeImagery) });
  const {
    mode, draftVertices, selectedVertex, status, statusMetaText,
    clearDraft, commitDraft, saveMapFeatureFromDraft, selectFirstBoundaryVertex,
    selectFirstObstacleVertex, selectFirstMapFeatureVertex, selectAdjacentVertex,
    nudgeSelectedVertex, deleteSelectedVertex, canCommitDraft, canSaveFeature,
    canEditSelectedVertex, canDeleteSelectedVertex,
  } = controller;
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
  const referenceOverlay = referenceView.reference;
  const workbenchStyle = useMemo(
    () => buildWorkbenchStyle(activeImagery, overlayState.featureCollection, referenceOverlay, settings.referenceOverlay),
    [activeImagery, overlayState.featureCollection, referenceOverlay, settings.referenceOverlay],
  );
  if (projectionError) {
    return (
      <View style={styles.fallbackShell} testID="native-map-workbench-fallback">
        <Text style={styles.fallbackText}>Native imagery is unavailable for this project view: {projectionError}</Text>
        <SvgMapSurface {...props} />
      </View>
    );
  }

  function handleMapPress(event: NativeMapPressEvent, closeRequested: boolean): void {
    const nativeEvent = event.nativeEvent;
    const selectedFeatureId = nativeFeatureId(nativeEvent.features);
    const current = controller;
    if (homeView) {
      current.setStatus("Catalog map is read-only. Open a field map or design before editing projected XY geometry.");
      return;
    }
    if (selectedFeatureId && (current.mode === "pan" || !canEditOnMap)) {
      onSelectMapFeature?.(selectedFeatureId);
      current.setStatus(`Selected map feature ${selectedFeatureId}. Project geometry is unchanged.`);
      return;
    }
    const [longitude, latitude] = nativeEvent.lngLat;
    current.handleLonLat({ longitude, latitude }, closeRequested);
  }

  const editStepMeters = Math.max(1, settings.drawing.panStepMeters / 4);
  const imageryAttribution = [...new Set([
    activeImagery?.attribution,
    activeImagery?.licenseText,
    referenceOverlay.canRender ? referenceOverlay.attribution : undefined,
    referenceOverlay.canRender ? referenceOverlay.licenseText : undefined,
  ].filter(Boolean))].join(" · ");
  const imageryStatus = [referenceView.aerialSummary, imageryAttribution].filter(Boolean).join(" · ");

  return (
    <View style={styles.shell} testID="native-map-workbench">
      <MapLibreMap
        androidView="surface"
        attribution={false}
        compass={false}
        logo={false}
        mapStyle={workbenchStyle as never}
        onLongPress={(event) => handleMapPress(event as NativeMapPressEvent, true)}
        onDidFailLoadingMap={() => setRuntimeError("Native MapLibre did not finish loading this imagery style.")}
        onDidFinishLoadingMap={() => setRuntimeError(null)}
        onPress={(event) => handleMapPress(event as NativeMapPressEvent, false)}
        scaleBar={false}
        style={styles.map}
        testID="native-map-workbench-map"
      >
        <Camera
          key={`${project.id}:${homeView ? "catalog" : "project"}`}
          initialViewState={{
            bounds: projectionFrame.bounds,
            padding: {
              top: compactLayout ? 86 : 72,
              right: 32,
              bottom: compactLayout ? 188 : 164,
              left: 32,
            },
          }}
          maxZoom={activeImagery ? Math.min(18, activeImagery.maxzoom) : 18}
        />
      </MapLibreMap>

      {!canEditOnMap ? (
        <View style={[styles.layoutHud, compactLayout && styles.layoutHudCompact]} testID="native-map-layout-hud">
          <MapPinned size={17} color="#173428" />
          <Text style={styles.layoutHudText}>{homeView ? "Catalog map: open a field map or design before editing." : "Layout mode: RTK-only geometry changes; pointer gestures inspect only."}</Text>
        </View>
      ) : null}

      <View pointerEvents="box-none" style={[styles.bottomDock, compactLayout && styles.bottomDockCompact]} testID="native-map-bottom-dock">
        <View pointerEvents="none" style={[styles.attributionHud, compactLayout && styles.attributionHudCompact]} testID="native-map-attribution-hud">
          <Satellite size={13} color="#173428" />
          <Text style={styles.attributionText}>{imageryStatus}</Text>
        </View>
        <View pointerEvents="box-none" style={[styles.statusHud, compactLayout && styles.statusHudCompact]} testID="native-map-status-hud">
          <View pointerEvents="none" style={styles.statusTextGroup}>
            <Text style={styles.statusText}>{status}</Text>
            <Text style={styles.statusMeta}>{statusMetaText}</Text>
          </View>
          <View pointerEvents="box-none" style={styles.hudActions} testID="native-map-hud-actions">
            <HudButton disabled={!canCommitDraft} icon={<Check size={15} color={canCommitDraft ? "#ffffff" : "#718077"} />} label="Commit" onPress={commitDraft} primary={canCommitDraft} testID="native-action-commit" />
            <HudButton disabled={!canSaveFeature} icon={<Check size={15} color={canSaveFeature ? "#ffffff" : "#718077"} />} label="Save Feature" onPress={saveMapFeatureFromDraft} primary={canSaveFeature} testID="native-action-save-feature" />
            {canEditOnMap && mode === "edit_vertices" ? (
              <>
                <HudButton disabled={project.fieldBoundary.length === 0} icon={<MousePointer2 size={15} color={project.fieldBoundary.length > 0 ? "#173428" : "#718077"} />} label="Boundary" onPress={selectFirstBoundaryVertex} testID="native-edit-select-boundary" />
                <HudButton disabled={!hasObstacleVertexSelection(project)} icon={<MousePointer2 size={15} color={hasObstacleVertexSelection(project) ? "#173428" : "#718077"} />} label="Obstacle" onPress={selectFirstObstacleVertex} testID="native-edit-select-obstacle" />
                <HudButton disabled={!hasMapFeatureVertexSelection(project)} icon={<MousePointer2 size={15} color={hasMapFeatureVertexSelection(project) ? "#173428" : "#718077"} />} label="Feature" onPress={selectFirstMapFeatureVertex} testID="native-edit-select-feature" />
                <HudButton disabled={!selectedVertex} icon={<ArrowLeft size={15} color={selectedVertex ? "#173428" : "#718077"} />} label="Prev" onPress={() => selectAdjacentVertex(-1)} testID="native-edit-previous-vertex" />
                <HudButton disabled={!selectedVertex} icon={<ArrowRight size={15} color={selectedVertex ? "#173428" : "#718077"} />} label="Next" onPress={() => selectAdjacentVertex(1)} testID="native-edit-next-vertex" />
                <HudButton disabled={!canEditSelectedVertex} icon={<ArrowRight size={15} color={canEditSelectedVertex ? "#173428" : "#718077"} />} label="Nudge E" onPress={() => nudgeSelectedVertex({ x: editStepMeters, y: 0 })} testID="native-edit-nudge-east" />
                <HudButton disabled={!canDeleteSelectedVertex} icon={<Trash2 size={15} color={canDeleteSelectedVertex ? "#173428" : "#718077"} />} label="Delete" onPress={deleteSelectedVertex} testID="native-edit-delete-vertex" />
              </>
            ) : null}
            <HudButton disabled={draftVertices.length === 0} icon={<X size={15} color={draftVertices.length > 0 ? "#173428" : "#718077"} />} label="Clear" onPress={() => clearDraft()} testID="native-action-clear" />
          </View>
        </View>
        {bottomOverlay ? (
          <View pointerEvents="box-none" style={styles.bottomOverlaySlot}>
            {bottomOverlay}
          </View>
        ) : null}
      </View>
      {runtimeError ? <Text style={styles.runtimeError}>{runtimeError}</Text> : null}
    </View>
  );
}

function nativeFeatureId(features: Array<{ properties?: Record<string, unknown> }> | undefined): string | null {
  const id = features?.find((feature) => typeof feature.properties?.id === "string")?.properties?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function HudButton({ disabled = false, icon, label, onPress, primary = false, testID }: { disabled?: boolean; icon: React.ReactNode; label: string; onPress: () => void; primary?: boolean; testID?: string }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} aria-disabled={disabled} disabled={disabled} onPress={onPress} style={[styles.hudButton, primary && styles.hudButtonPrimary, disabled && styles.hudButtonDisabled]} testID={testID}>
      {icon}
      <Text style={[styles.hudButtonText, primary && styles.hudButtonTextPrimary, disabled && styles.hudButtonTextDisabled]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignSelf: "stretch",
    backgroundColor: "#eef2ec",
    borderColor: "#ccd8cf",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
  },
  map: {
    flex: 1,
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
    left: 8,
    right: 8,
  },
  bottomOverlaySlot: {
    maxWidth: "100%",
    width: "100%",
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
  statusHudCompact: {
    alignItems: "flex-start",
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
    top: 12,
    zIndex: 3,
  },
  layoutHudCompact: {
    left: 8,
    maxWidth: "94%",
    right: 8,
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
    maxWidth: "100%",
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
    padding: 8,
    position: "absolute",
    right: 12,
    top: 76,
  },
  fallbackShell: {
    flex: 1,
    gap: 10,
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
