import type { ReferenceOverlayPreferences, ReferenceOverlayResolution } from "@cplayout/core";
import type { StyleSpecification } from "maplibre-gl";

export const REFERENCE_OVERLAY_SOURCE_ID = "reference-overlay";

export interface ReferenceOverlayStyleParts {
  glyphs?: string;
  layers: StyleSpecification["layers"];
  sources: StyleSpecification["sources"];
}

export function buildReferenceOverlayStyleParts(
  resolution: ReferenceOverlayResolution,
  preferences: ReferenceOverlayPreferences,
): ReferenceOverlayStyleParts {
  if (!resolution.canRender) return { layers: [], sources: {} };

  if (resolution.sourceKind === "public_raster" && resolution.rasterSources?.length) {
    const sources: StyleSpecification["sources"] = {};
    const layers: StyleSpecification["layers"] = [];
    const compositePublicRaster = resolution.rasterSources.length === 1;
    const compositeVisibility = preferences.roads || preferences.borders || preferences.labels ? "visible" : "none";
    for (const source of resolution.rasterSources) {
      sources[source.id] = {
        type: "raster",
        tiles: source.tiles,
        tileSize: source.tileSize,
        minzoom: source.minzoom,
        maxzoom: source.maxzoom,
        attribution: source.attribution,
      } as StyleSpecification["sources"][string];
      layers.push({
        id: source.id,
        type: "raster",
        source: source.id,
        layout: { visibility: compositePublicRaster ? compositeVisibility : preferences[source.layer] ? "visible" : "none" },
        paint: { "raster-opacity": 0.96 },
      });
    }
    return {
      sources,
      layers,
    };
  }

  if (!resolution.source) return { layers: [], sources: {} };

  const source = resolution.source;
  const vectorSource: Record<string, unknown> = {
    type: "vector",
    minzoom: source.minzoom,
    maxzoom: source.maxzoom,
    scheme: source.scheme,
    attribution: source.attribution,
  };
  if (source.url) vectorSource.url = source.url;
  if (source.tiles) vectorSource.tiles = source.tiles;
  if (source.bounds) vectorSource.bounds = source.bounds;
  const sources: StyleSpecification["sources"] = {
    [REFERENCE_OVERLAY_SOURCE_ID]: vectorSource as StyleSpecification["sources"][string],
  };
  const layers = [
    {
      id: "reference-borders",
      type: "line",
      source: REFERENCE_OVERLAY_SOURCE_ID,
      "source-layer": resolution.layers.borders,
      layout: {
        visibility: preferences.borders ? "visible" : "none",
      },
      paint: {
        "line-color": "#8c6b2e",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 9, 1.4, 14, 2.2],
        "line-opacity": 0.82,
        "line-dasharray": [3, 2],
      },
    },
    {
      id: "reference-roads-casing",
      type: "line",
      source: REFERENCE_OVERLAY_SOURCE_ID,
      "source-layer": resolution.layers.roads,
      layout: {
        "line-cap": "round",
        "line-join": "round",
        visibility: preferences.roads ? "visible" : "none",
      },
      paint: {
        "line-color": "#f7f4ea",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 1.2, 10, 3.2, 15, 7],
        "line-opacity": 0.92,
      },
    },
    {
      id: "reference-roads",
      type: "line",
      source: REFERENCE_OVERLAY_SOURCE_ID,
      "source-layer": resolution.layers.roads,
      layout: {
        "line-cap": "round",
        "line-join": "round",
        visibility: preferences.roads ? "visible" : "none",
      },
      paint: {
        "line-color": "#be7b3d",
        "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 10, 1.6, 15, 3.2],
        "line-opacity": 0.86,
      },
    },
    {
      id: "reference-road-labels",
      type: "symbol",
      source: REFERENCE_OVERLAY_SOURCE_ID,
      "source-layer": resolution.layers.roadLabels,
      layout: {
        "symbol-placement": "line",
        "text-field": ["coalesce", ["get", "name"], ["get", "name:en"], ["get", "ref"], ""],
        "text-font": ["Open Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 8, 10, 14, 13],
        visibility: preferences.labels ? "visible" : "none",
      },
      paint: {
        "text-color": "#5e3c1f",
        "text-halo-color": "#fffef8",
        "text-halo-width": 1.5,
        "text-opacity": 0.88,
      },
    },
    {
      id: "reference-place-labels",
      type: "symbol",
      source: REFERENCE_OVERLAY_SOURCE_ID,
      "source-layer": resolution.layers.places,
      layout: {
        "text-field": ["coalesce", ["get", "name"], ["get", "name:en"], ""],
        "text-font": ["Open Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 10, 14],
        visibility: preferences.labels ? "visible" : "none",
      },
      paint: {
        "text-color": "#243d36",
        "text-halo-color": "#fffef8",
        "text-halo-width": 1.8,
        "text-opacity": 0.88,
      },
    },
  ] satisfies StyleSpecification["layers"];

  return {
    layers,
    sources,
  };
}
