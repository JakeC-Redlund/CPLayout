import type { StyleSpecification } from "maplibre-gl";
import { maplibregl, maplibreErrorMessage } from "./maplibreRuntime.web";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { resolveOnlineImageryProvider, resolveReferenceOverlaySource, type OnlineImageryProvider } from "@cplayout/core";
import { projectLayoutToWgs84FeatureCollection, projectWgs84Bounds, projectWgs84Center } from "./mapOverlayGeoJson";
import type { MapLibreImageryPreviewProps } from "./MapLibreImageryPreview";
import { registerPmtilesProtocolOnce } from "./pmtilesProtocol.web";
import { buildReferenceOverlayStyleParts } from "./referenceOverlayStyle";

export function MapLibreImageryPreview({
  project,
  result,
  settings,
  visible,
}: MapLibreImageryPreviewProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [previewClosed, setPreviewClosed] = useState(false);
  const [mapInitializationError, setMapInitializationError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const provider = useMemo(() => {
    if (!settings.onlineImagery.enabled) return null;
    try {
      return resolveOnlineImageryProvider(settings.onlineImagery.providerId, settings.onlineImagery.customSource);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [settings.onlineImagery.customSource, settings.onlineImagery.enabled, settings.onlineImagery.providerId]);
  const featureCollection = useMemo(() => projectLayoutToWgs84FeatureCollection(project, result), [project, result]);
  const bounds = useMemo(() => projectWgs84Bounds(project), [project]);
  const center = useMemo(() => projectWgs84Center(project), [project]);
  const referenceOverlay = useMemo(
    () => resolveReferenceOverlaySource({
      allowPublicNetwork: Boolean(provider && !(provider instanceof Error)),
      preferences: settings.referenceOverlay,
      mapPackages: project.mapPackages ?? [],
      target: "web_maplibre_gl_js",
    }),
    [project.mapPackages, provider, settings.referenceOverlay],
  );

  useEffect(() => {
    if (!visible || previewClosed || !containerRef.current || provider === null || provider instanceof Error || mapInitializationError) return undefined;
    setRuntimeError(null);
    let map: maplibregl.Map;
    try {
      registerPmtilesProtocolOnce();
      map = new maplibregl.Map({
        attributionControl: false,
        center,
        container: containerRef.current,
        interactive: false,
        style: buildPreviewStyle(provider, featureCollection, referenceOverlay, settings.referenceOverlay),
        zoom: Math.min(15, provider.maxZoom),
      });

      map.fitBounds(
        [
          [bounds[0], bounds[1]],
          [bounds[2], bounds[3]],
        ],
        {
          duration: 0,
          maxZoom: Math.min(17, provider.maxZoom),
          padding: 36,
        },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMapInitializationError(/webgl/i.test(detail)
        ? "WebGL imagery preview is unavailable. The projected SVG map remains active."
        : "The imagery preview could not start. The projected SVG map remains active.");
      return undefined;
    }
    map.on("error", (event) => {
      const message = event.error ? maplibreErrorMessage(event.error) : null;
      if (message) setRuntimeError(message);
    });

    return () => {
      map.remove();
    };
  }, [bounds, center, featureCollection, mapInitializationError, previewClosed, provider, referenceOverlay, settings.referenceOverlay, visible]);

  if (!visible || previewClosed) return null;

  const providerError = provider instanceof Error ? provider.message : null;
  const activeProvider = provider instanceof Error || provider === null ? null : provider;

  return (
    <View style={styles.previewBand}>
      <View style={styles.previewHeader}>
        <View>
          <Text style={styles.previewTitle}>MapLibre Imagery Preview</Text>
          <Text style={styles.previewSubtitle}>{activeProvider?.name ?? "Custom source"} · WGS84 display overlay</Text>
        </View>
        <Text style={styles.previewBadge}>Preview only</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close imagery preview"
          onPress={() => setPreviewClosed(true)}
          style={styles.closeButton}
          testID="maplibre-preview-close"
        >
          <X size={18} color="#254234" />
        </Pressable>
      </View>
      {providerError || mapInitializationError ? (
        <Text style={styles.errorText} testID="maplibre-preview-fallback">{providerError ?? mapInitializationError}</Text>
      ) : (
        React.createElement("div", {
          "aria-label": "MapLibre imagery preview",
          ref: containerRef,
          style: mapContainerStyle,
        })
      )}
      {runtimeError && !mapInitializationError ? <Text numberOfLines={2} style={styles.errorText}>{runtimeError}</Text> : null}
      <Text style={styles.attributionText}>
        {(activeProvider ?? settingsFallbackProvider()).attribution} · {(activeProvider ?? settingsFallbackProvider()).licenseText}
      </Text>
    </View>
  );
}

function buildPreviewStyle(
  provider: OnlineImageryProvider,
  featureCollection: ReturnType<typeof projectLayoutToWgs84FeatureCollection>,
  referenceOverlay: ReturnType<typeof resolveReferenceOverlaySource>,
  referenceOverlayPreferences: MapLibreImageryPreviewProps["settings"]["referenceOverlay"],
): StyleSpecification {
  const referenceOverlayParts = buildReferenceOverlayStyleParts(referenceOverlay, referenceOverlayPreferences);
  const style: StyleSpecification = {
    version: 8,
    sources: {
      imagery: {
        type: "raster",
        tiles: [toMapLibreTileTemplate(provider.tileUrlTemplate)],
        tileSize: provider.tileSize,
        minzoom: provider.minZoom,
        maxzoom: provider.maxZoom,
        scheme: provider.tileScheme,
        attribution: provider.attribution,
      },
      layout: {
        type: "geojson",
        data: featureCollection,
      },
      ...referenceOverlayParts.sources,
    },
    layers: [
      {
        id: "imagery",
        type: "raster",
        source: "imagery",
        paint: { "raster-opacity": 0.72 },
      },
      ...referenceOverlayParts.layers,
      fillLayer("allowed-fill", "allowed_coverage", "#6cb6df", 0.36),
      fillLayer("end-gun-fill", "end_gun_coverage", "#63c7cf", 0.28),
      fillLayer("outside-fill", "outside_field_coverage", "#e68b58", 0.22),
      fillLayer("wheel-track-fill", "wheel_track_path", "#54645a", 0.18),
      fillLayer("wheel-track-outside-fill", "wheel_track_outside_field", "#e68b58", 0.2),
      fillLayer("end-machine-path-fill", "end_machine_path", "#253f2f", 0.16),
      fillLayer("end-machine-path-outside-fill", "end_machine_outside_field", "#e68b58", 0.24),
      fillLayer("combined-machine-path-outside-fill", "combined_last_wheel_machine_end_outside_field", "#e68b58", 0.24),
      fillLayer("end-gun-reach-outside-fill", "end_gun_reach_outside_field", "#e68b58", 0.2),
      fillLayer("corner-arm-wheel-track-fill", "corner_arm_wheel_track_path", "#8b6f2a", 0.16),
      fillLayer("corner-arm-wheel-track-outside-fill", "corner_arm_wheel_track_outside_field", "#e68b58", 0.2),
      fillLayer("corner-arm-overhang-end-fill", "corner_arm_overhang_end_path", "#2f6d73", 0.14),
      fillLayer("corner-arm-overhang-end-outside-fill", "corner_arm_overhang_end_outside_field", "#e68b58", 0.22),
      fillLayer("obstacle-fill", "obstacle", "#c64f43", 0.52),
      lineLayer("wheel-track-line", "wheel_track_path", "#54645a", 1.5, { "line-dasharray": [1.4, 1.1] }),
      lineLayer("wheel-track-outside-line", "wheel_track_outside_field", "#a14322", 2, { "line-dasharray": [1, 1] }),
      lineLayer("end-machine-path-halo", "end_machine_path", "#fffef8", 5),
      lineLayer("end-machine-path-line", "end_machine_path", "#15241b", 2.5),
      lineLayer("combined-machine-path-line", "combined_last_wheel_machine_end_path", "#0f766e", 3, { "line-dasharray": [5, 1.5, 1, 1.5] }),
      lineLayer("end-gun-reach-line", "end_gun_reach_path", "#b42318", 2, { "line-dasharray": [6, 2, 1, 2] }),
      lineLayer("end-machine-path-outside-halo", "end_machine_outside_field", "#fff4e8", 5),
      lineLayer("end-machine-path-outside-line", "end_machine_outside_field", "#a14322", 2.5, { "line-dasharray": [2, 1.2] }),
      lineLayer("corner-arm-wheel-track-line", "corner_arm_wheel_track_path", "#80631f", 2, { "line-dasharray": [1.2, 1.2] }),
      lineLayer("corner-arm-wheel-track-outside-line", "corner_arm_wheel_track_outside_field", "#a14322", 2, { "line-dasharray": [1, 1] }),
      lineLayer("corner-arm-overhang-end-line", "corner_arm_overhang_end_path", "#1f5f66", 2.2, { "line-dasharray": [3, 1.4] }),
      lineLayer("corner-arm-overhang-end-outside-line", "corner_arm_overhang_end_outside_field", "#a14322", 2.4, { "line-dasharray": [2, 1.2] }),
      lineLayer("field-line", "field_boundary", "#15241b", 3),
      lineLayer("obstacle-line", "obstacle", "#70271f", 2),
      circleLayer("pivot-point", "pivot_center", "#151c2a", 6),
      circleLayer("water-point", "water_source", "#006a9f", 5),
      circleLayer("power-point", "power_source", "#a36500", 5),
      circleLayer("tower-point", "tower_location", "#54645a", 3),
    ],
  };
  if (referenceOverlayParts.glyphs) style.glyphs = referenceOverlayParts.glyphs;
  return style;
}

function fillLayer(id: string, layerType: string, color: string, opacity: number): StyleSpecification["layers"][number] {
  return {
    id,
    type: "fill",
    source: "layout",
    filter: ["==", ["get", "layerType"], layerType],
    paint: {
      "fill-color": color,
      "fill-opacity": opacity,
    },
  };
}

function lineLayer(id: string, layerType: string, color: string, width: number, paintOverrides: Record<string, unknown> = {}): StyleSpecification["layers"][number] {
  return {
    id,
    type: "line",
    source: "layout",
    filter: ["==", ["get", "layerType"], layerType],
    paint: {
      "line-color": color,
      "line-width": width,
      ...paintOverrides,
    },
  };
}

function circleLayer(id: string, layerType: string, color: string, radius: number): StyleSpecification["layers"][number] {
  return {
    id,
    type: "circle",
    source: "layout",
    filter: ["==", ["get", "layerType"], layerType],
    paint: {
      "circle-color": "#fffef8",
      "circle-radius": radius,
      "circle-stroke-color": color,
      "circle-stroke-width": 2,
    },
  };
}

function toMapLibreTileTemplate(template: string): string {
  return template
    .replace(/\{TileMatrix\}/gi, "{z}")
    .replace(/\{TileCol\}/gi, "{x}")
    .replace(/\{TileRow\}/gi, "{y}")
    .replace(/\{level\}/gi, "{z}")
    .replace(/\{column\}/gi, "{x}")
    .replace(/\{col\}/gi, "{x}")
    .replace(/\{row\}/gi, "{y}");
}

function settingsFallbackProvider(): Pick<OnlineImageryProvider, "attribution" | "licenseText"> {
  return {
    attribution: "Attribution required for custom open imagery",
    licenseText: "Live imagery preview only; do not bulk cache.",
  };
}

const mapContainerStyle: React.CSSProperties = {
  height: 300,
  minHeight: 300,
  width: "100%",
};

const styles = StyleSheet.create({
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    height: 36,
    width: 36,
  },
  previewBand: {
    backgroundColor: "#eef3ea",
    borderTopColor: "#d8ded6",
    borderTopWidth: 1,
    gap: 8,
    padding: 12,
  },
  previewHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  previewTitle: {
    color: "#15241b",
    fontSize: 15,
    fontWeight: "900",
  },
  previewSubtitle: {
    color: "#53655a",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  previewBadge: {
    backgroundColor: "#fffef8",
    borderColor: "#b9c5b6",
    borderRadius: 8,
    borderWidth: 1,
    color: "#254234",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  attributionText: {
    color: "#405448",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
  },
  errorText: {
    backgroundColor: "#fff8ed",
    borderColor: "#e6c29c",
    borderRadius: 8,
    borderWidth: 1,
    color: "#8a4d1f",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    padding: 10,
  },
});
