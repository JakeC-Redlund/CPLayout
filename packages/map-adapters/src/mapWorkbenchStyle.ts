import {
  resolveReferenceOverlaySource,
  type AerialReferenceImageryResolution,
  type MapLibreTileSourceDescriptor,
  type OnlineImageryProvider,
} from "@cplayout/core";
import type { StyleSpecification } from "maplibre-gl";
import { projectLayoutToWgs84FeatureCollection } from "./mapOverlayGeoJson";
import { buildReferenceOverlayStyleParts } from "./referenceOverlayStyle";
import type { MapSurfaceProps } from "./types";

export interface RasterImageryStyleSource {
  id: string;
  name: string;
  attribution: string;
  licenseText: string;
  minzoom: number;
  maxzoom: number;
  scheme: "xyz" | "tms";
  tileSize: number;
  tiles?: string[];
  url?: string;
}

export function buildWorkbenchStyle(
  imagery: RasterImageryStyleSource | null,
  featureCollection: ReturnType<typeof projectLayoutToWgs84FeatureCollection>,
  referenceOverlay: ReturnType<typeof resolveReferenceOverlaySource>,
  referenceOverlayPreferences: MapSurfaceProps["settings"]["referenceOverlay"],
): StyleSpecification {
  const referenceOverlayParts = buildReferenceOverlayStyleParts(referenceOverlay, referenceOverlayPreferences);
  const sources: StyleSpecification["sources"] = {
    ...referenceOverlayParts.sources,
    layout: {
      type: "geojson",
      data: featureCollection,
    },
  };
  const layers: StyleSpecification["layers"] = [
    {
      id: "background",
      type: "background",
      paint: { "background-color": imagery ? "#d8dfd5" : "#eef2ec" },
    },
  ];

  if (imagery) {
    const source: Record<string, unknown> = {
      type: "raster",
      tileSize: imagery.tileSize,
      minzoom: imagery.minzoom,
      maxzoom: imagery.maxzoom,
      scheme: imagery.scheme,
      attribution: imagery.attribution,
    };
    if (imagery.url) source.url = imagery.url;
    if (imagery.tiles) source.tiles = imagery.tiles.map(toMapLibreTileTemplate);
    sources.imagery = source as StyleSpecification["sources"][string];
    layers.push({
      id: "imagery",
      type: "raster",
      source: "imagery",
      paint: { "raster-opacity": 0.88 },
    });
  }

  layers.push(
    ...referenceOverlayParts.layers,
    fillLayer("field-fill", "field_boundary", "#f4f1df", 0.18),
    fillLayer("allowed-fill", "allowed_coverage", "#2f8fc1", 0.34),
    fillLayer("end-gun-fill", "end_gun_coverage", "#33a79b", 0.28),
    fillLayer("outside-fill", "outside_field_coverage", "#d8893f", 0.28),
    fillLayer("advisory-generated-field-pivot-fill", "advisory_generated_field_pivot_coverage", "#8b5cf6", 0.22),
    fillLayer("wheel-track-outside-fill", "wheel_track_outside_field", "#d8893f", 0.2),
    fillLayer("end-machine-path-outside-fill", "end_machine_outside_field", "#d8893f", 0.24),
    fillLayer("combined-machine-path-outside-fill", "combined_last_wheel_machine_end_outside_field", "#d8893f", 0.24),
    fillLayer("end-gun-reach-outside-fill", "end_gun_reach_outside_field", "#d8893f", 0.2),
    fillLayer("corner-arm-wheel-track-outside-fill", "corner_arm_wheel_track_outside_field", "#d8893f", 0.2),
    fillLayer("corner-arm-overhang-end-outside-fill", "corner_arm_overhang_end_outside_field", "#d8893f", 0.22),
    fillLayer("advisory-machine-standard-fill", "advisory_machine_standard_coverage", "#2f8fc1", 0.16),
    fillLayer("advisory-machine-end-gun-fill", "advisory_machine_end_gun_annulus", "#33a79b", 0.14),
    fillLayer("advisory-machine-corner-arm-fill", "advisory_machine_corner_arm_coverage", "#8b6f2a", 0.12),
    fillLayer("advisory-machine-wet-fill", "advisory_machine_wet_coverage", "#0ea5a2", 0.12),
    fillLayer("advisory-machine-physical-fill", "advisory_machine_physical_envelope", "#253f2f", 0.08),
    fillLayer("advisory-machine-lrdu-path-outside-fill", "advisory_machine_lrdu_path_outside_field", "#d8893f", 0.18),
    fillLayer("advisory-machine-tower-path-outside-fill", "advisory_machine_tower_path_outside_field", "#d8893f", 0.18),
    fillLayer("advisory-machine-corner-wheel-path-outside-fill", "advisory_machine_corner_arm_wheel_path_outside_field", "#d8893f", 0.2),
    fillLayer("advisory-machine-corner-overhang-path-outside-fill", "advisory_machine_corner_arm_overhang_end_path_outside_field", "#d8893f", 0.22),
    fillLayer("advisory-machine-conflict-fill", "advisory_machine_collision_conflict", "#b00020", 0.34),
    fillLayer("obstacle-fill", "obstacle", "#b73f35", 0.5),
    fillLayer("map-feature-polygon", "map_feature", "#7c5b14", 0.18, ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "layerType"], "map_feature"]]),
    lineLayer("wheel-track-line", "wheel_track_path", "#4f5a50", 1.5, undefined, { "line-dasharray": [1.4, 1.1] }),
    lineLayer("wheel-track-outside-line", "wheel_track_outside_field", "#a14322", 2, undefined, { "line-dasharray": [1, 1] }),
    lineLayer("end-machine-path-halo", "end_machine_path", "#fffef8", 5),
    lineLayer("end-machine-path-line", "end_machine_path", "#111c17", 2.5),
    lineLayer("combined-machine-path-line", "combined_last_wheel_machine_end_path", "#0f766e", 3, undefined, { "line-dasharray": [5, 1.5, 1, 1.5] }),
    lineLayer("end-gun-reach-line", "end_gun_reach_path", "#b42318", 2, undefined, { "line-dasharray": [6, 2, 1, 2] }),
    lineLayer("end-machine-path-outside-halo", "end_machine_outside_field", "#fff4e8", 5),
    lineLayer("end-machine-path-outside-line", "end_machine_outside_field", "#a14322", 2.5, undefined, { "line-dasharray": [2, 1.2] }),
    lineLayer("corner-arm-wheel-track-line", "corner_arm_wheel_track_path", "#80631f", 2, undefined, { "line-dasharray": [1.2, 1.2] }),
    lineLayer("corner-arm-wheel-track-outside-line", "corner_arm_wheel_track_outside_field", "#a14322", 2, undefined, { "line-dasharray": [1, 1] }),
    lineLayer("corner-arm-overhang-end-line", "corner_arm_overhang_end_path", "#1f5f66", 2.2, undefined, { "line-dasharray": [3, 1.4] }),
    lineLayer("corner-arm-overhang-end-outside-line", "corner_arm_overhang_end_outside_field", "#a14322", 2.4, undefined, { "line-dasharray": [2, 1.2] }),
    lineLayer("advisory-machine-preferred-outline-line", "advisory_machine_preferred_outline", "#0f172a", 3, undefined, { "line-dasharray": [8, 4] }),
    lineLayer("advisory-machine-standard-line", "advisory_machine_standard_coverage", "#1d6f99", 1.6),
    lineLayer("advisory-machine-end-gun-line", "advisory_machine_end_gun_annulus", "#0f766e", 1.6, undefined, { "line-dasharray": [4, 4] }),
    lineLayer("advisory-machine-corner-arm-line", "advisory_machine_corner_arm_coverage", "#80631f", 1.8, undefined, { "line-dasharray": [5, 3] }),
    lineLayer("advisory-machine-physical-line", "advisory_machine_physical_envelope", "#15241b", 2.2),
    lineLayer("advisory-machine-lrdu-path-line", "advisory_machine_lrdu_path", "#111c17", 2.6),
    lineLayer("advisory-machine-lrdu-path-outside-line", "advisory_machine_lrdu_path_outside_field", "#a14322", 2.2, undefined, { "line-dasharray": [2, 1.2] }),
    lineLayer("advisory-machine-tower-path-line", "advisory_machine_tower_path", "#54645a", 1.6, undefined, { "line-dasharray": [1.2, 1.2] }),
    lineLayer("advisory-machine-tower-path-outside-line", "advisory_machine_tower_path_outside_field", "#a14322", 2, undefined, { "line-dasharray": [1, 1] }),
    lineLayer("advisory-machine-corner-wheel-path-line", "advisory_machine_corner_arm_wheel_path", "#80631f", 2, undefined, { "line-dasharray": [1.2, 1.2] }),
    lineLayer("advisory-machine-corner-wheel-path-outside-line", "advisory_machine_corner_arm_wheel_path_outside_field", "#a14322", 2, undefined, { "line-dasharray": [1, 1] }),
    lineLayer("advisory-machine-corner-overhang-path-line", "advisory_machine_corner_arm_overhang_end_path", "#1f5f66", 2.2, undefined, { "line-dasharray": [3, 1.4] }),
    lineLayer("advisory-machine-corner-overhang-path-outside-line", "advisory_machine_corner_arm_overhang_end_path_outside_field", "#a14322", 2.4, undefined, { "line-dasharray": [2, 1.2] }),
    lineLayer("advisory-machine-conflict-line", "advisory_machine_collision_conflict", "#7f1d1d", 2.4),
    lineLayer("field-line", "field_boundary", "#111c17", 3),
    lineLayer("advisory-generated-field-pivot-line", "advisory_generated_field_pivot_coverage", "#6d28d9", 2),
    lineLayer("obstacle-line", "obstacle", "#6d251f", 2),
    lineLayer("map-feature-line", "map_feature", "#7c5b14", 3, ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "layerType"], "map_feature"]]),
    lineLayer("draft-line", "draft_vertices", "#ffffff", 5, ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "layerType"], "draft_vertices"]]),
    lineLayer("draft-line-core", "draft_vertices", "#0f766e", 2, ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "layerType"], "draft_vertices"]]),
    circleLayer("pivot-point", "pivot_center", "#111827", 7),
    circleLayer("advisory-generated-field-pivot-center", "advisory_generated_field_pivot_center", "#6d28d9", 8),
    circleLayer("advisory-machine-pivot-center", "advisory_machine_pivot_center", "#0f172a", 8),
    circleLayer("water-point", "water_source", "#006a9f", 6),
    circleLayer("power-point", "power_source", "#a36500", 6),
    circleLayer("tower-point", "tower_location", "#49574f", 3),
    circleLayer("map-feature-point", "map_feature", "#7c5b14", 6),
    circleLayer("draft-point", "draft_vertices", "#0f766e", 7),
  );

  const style: StyleSpecification = {
    version: 8,
    sources,
    layers,
  };
  if (referenceOverlayParts.glyphs) style.glyphs = referenceOverlayParts.glyphs;
  return style;
}

export function formatReferenceOverlayStatus(referenceOverlay: ReturnType<typeof resolveReferenceOverlaySource>): string {
  if (referenceOverlay.sourceKind === "public_raster") {
    return `${referenceOverlay.autoApplied ? "Auto-applied" : "Manual"}: ${referenceOverlay.packageName ?? "USGS public reference"} · public no-key raster`;
  }
  return `${referenceOverlay.autoApplied ? "Auto-applied" : "Manual"}: ${referenceOverlay.packageName ?? referenceOverlay.packageId} · ${referenceOverlay.schema.replaceAll("_", " ")}`;
}

export function rasterStyleSourceFromAerialReferenceResolution(resolution: AerialReferenceImageryResolution): RasterImageryStyleSource | null {
  if (resolution.sourceKind === "online_provider" && resolution.onlineProvider) {
    return rasterStyleSourceFromOnlineProvider(resolution.onlineProvider);
  }
  if (!resolution.localAerial.canRender || !resolution.localAerial.source) return null;
  return {
    ...rasterStyleSourceFromTileDescriptor(resolution.localAerial.source),
    name: resolution.localAerial.packageName ?? resolution.localAerial.packageId ?? resolution.localAerial.source.id,
    attribution: resolution.localAerial.attribution ?? resolution.localAerial.source.attribution,
    licenseText: resolution.localAerial.licenseText ?? "License metadata required.",
  };
}

export function rasterStyleSourceFromOnlineProvider(provider: OnlineImageryProvider): RasterImageryStyleSource {
  return {
    id: `online-${provider.id}`,
    name: provider.name,
    attribution: provider.attribution,
    licenseText: provider.licenseText,
    minzoom: provider.minZoom,
    maxzoom: provider.maxZoom,
    scheme: provider.tileScheme,
    tileSize: provider.tileSize,
    tiles: [provider.tileUrlTemplate],
  };
}

export function rasterStyleSourceFromTileDescriptor(source: MapLibreTileSourceDescriptor): RasterImageryStyleSource {
  return {
    id: source.id,
    name: source.id,
    attribution: source.attribution,
    licenseText: "License metadata required.",
    minzoom: source.minzoom,
    maxzoom: source.maxzoom,
    scheme: source.scheme,
    tileSize: 256,
    tiles: source.tiles,
    url: source.url,
  };
}

export function toMapLibreTileTemplate(template: string): string {
  return template
    .replace(/\{TileMatrix\}/gi, "{z}")
    .replace(/\{TileCol\}/gi, "{x}")
    .replace(/\{TileRow\}/gi, "{y}")
    .replace(/\{level\}/gi, "{z}")
    .replace(/\{column\}/gi, "{x}")
    .replace(/\{col\}/gi, "{x}")
    .replace(/\{row\}/gi, "{y}");
}

function fillLayer(
  id: string,
  layerType: string,
  color: string,
  opacity: number,
  filter: unknown[] = ["==", ["get", "layerType"], layerType],
): StyleSpecification["layers"][number] {
  return {
    id,
    type: "fill",
    source: "layout",
    filter: filter as never,
    paint: {
      "fill-color": color,
      "fill-opacity": opacity,
    },
  };
}

function lineLayer(
  id: string,
  layerType: string,
  color: string,
  width: number,
  filter: unknown[] = ["==", ["get", "layerType"], layerType],
  paintOverrides: Record<string, unknown> = {},
): StyleSpecification["layers"][number] {
  return {
    id,
    type: "line",
    source: "layout",
    filter: filter as never,
    paint: {
      "line-color": color,
      "line-width": width,
      "line-opacity": 0.95,
      ...paintOverrides,
    },
  };
}

function circleLayer(id: string, layerType: string, color: string, radius: number): StyleSpecification["layers"][number] {
  return {
    id,
    type: "circle",
    source: "layout",
    filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "layerType"], layerType]],
    paint: {
      "circle-color": "#fffef8",
      "circle-radius": radius,
      "circle-stroke-color": color,
      "circle-stroke-width": 2,
    },
  };
}
