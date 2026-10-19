import assert from "node:assert/strict";

import { defaultAppSettings, resolveReferenceOverlaySource, type MapPackageManifest } from "@cplayout/core";
import { buildReferenceOverlayStyleParts, REFERENCE_OVERLAY_SOURCE_ID } from "./referenceOverlayStyle";
import { buildWorkbenchStyle, rasterStyleSourceFromTileDescriptor } from "./mapWorkbenchStyle";

const settings = defaultAppSettings();
const vectorPackage: MapPackageManifest = {
  id: "local-reference",
  name: "Local reference overlay",
  packageType: "pmtiles",
  tileContentType: "vector",
  uri: "pmtiles://http://127.0.0.1:8765/reference.pmtiles",
  minZoom: 0,
  maxZoom: 14,
  tileScheme: "xyz",
  boundsWgs84: {
    minLongitude: -125,
    minLatitude: 24,
    maxLongitude: -66,
    maxLatitude: 50,
  },
  vectorOverlay: {
    schema: "cplayout_reference_v1",
    sourceLayers: {
      roads: "roads",
      roadLabels: "road_labels",
      borders: "borders",
      places: "places",
    },
  },
  installStatus: "available",
  attribution: "US Census TIGER/Line; Natural Earth",
  licenseText: "Local offline reference overlay package.",
  importedAt: "2026-06-01T00:00:00.000Z",
};

const ready = resolveReferenceOverlaySource({
  preferences: { ...settings.referenceOverlay, mode: "manual", sourcePackageId: vectorPackage.id },
  mapPackages: [vectorPackage],
  target: "web_maplibre_gl_js",
});
const parts = buildReferenceOverlayStyleParts(ready, { ...settings.referenceOverlay, mode: "manual", sourcePackageId: vectorPackage.id });
assert.equal(parts.sources[REFERENCE_OVERLAY_SOURCE_ID]?.type, "vector");
assert.deepEqual((parts.sources[REFERENCE_OVERLAY_SOURCE_ID] as { bounds?: number[] }).bounds, [-125, 24, -66, 50]);
const rasterDescriptor = { ...ready.source!, type: "raster" as const };
const imagery = rasterStyleSourceFromTileDescriptor(rasterDescriptor);
assert.deepEqual(imagery.bounds, [-125, 24, -66, 50]);
const rasterStyle = buildWorkbenchStyle(imagery, { type: "FeatureCollection", features: [] }, { ...ready, canRender: false }, settings.referenceOverlay);
assert.deepEqual((rasterStyle.sources.imagery as { bounds?: number[] }).bounds, [-125, 24, -66, 50]);
assert.deepEqual(parts.layers.map((layer) => layer.id), [
  "reference-borders",
  "reference-roads-casing",
  "reference-roads",
  "reference-road-labels",
  "reference-place-labels",
]);
const roadsLayer = parts.layers.find((layer) => layer.id === "reference-roads") as { source?: string; "source-layer"?: string } | undefined;
const bordersLayer = parts.layers.find((layer) => layer.id === "reference-borders") as { "source-layer"?: string } | undefined;
assert.equal(roadsLayer?.source, REFERENCE_OVERLAY_SOURCE_ID);
assert.equal(roadsLayer?.["source-layer"], "roads");
assert.equal(bordersLayer?.["source-layer"], "borders");
assert.equal(parts.glyphs, undefined);

const labelsOff = buildReferenceOverlayStyleParts(ready, {
  ...settings.referenceOverlay,
  mode: "manual",
  labels: false,
  sourcePackageId: vectorPackage.id,
});
assert.equal(labelsOff.layers.find((layer) => layer.id === "reference-road-labels")?.layout?.visibility, "none");
assert.equal(labelsOff.glyphs, undefined);

const disabled = buildReferenceOverlayStyleParts(
  resolveReferenceOverlaySource({
    preferences: { ...settings.referenceOverlay, mode: "off" },
    mapPackages: [vectorPackage],
    target: "web_maplibre_gl_js",
  }),
  { ...settings.referenceOverlay, mode: "off" },
);
assert.equal(Object.keys(disabled.sources).length, 0);
assert.equal(disabled.layers.length, 0);

const publicReady = resolveReferenceOverlaySource({
  allowPublicNetwork: true,
  preferences: { ...settings.referenceOverlay, mode: "auto" },
  mapPackages: [],
  target: "web_maplibre_gl_js",
});
const publicParts = buildReferenceOverlayStyleParts(publicReady, { ...settings.referenceOverlay, mode: "auto" });
assert.equal(publicParts.layers.length, publicReady.rasterSources?.length);
assert.ok(publicParts.layers.every((layer) => layer.type === "raster"));
assert.ok(Object.values(publicParts.sources).every((source) => source.type === "raster"));
assert.ok(
  Object.values(publicParts.sources).every((source) => (source as { tiles?: string[] }).tiles?.[0]?.includes("USGSImageryTopo")),
);
assert.equal(publicParts.glyphs, undefined);

const publicRoadsOff = buildReferenceOverlayStyleParts(publicReady, {
  ...settings.referenceOverlay,
  mode: "auto",
  roads: false,
});
assert.equal(publicRoadsOff.layers.find((layer) => layer.id === "reference-public-imagery-topo")?.layout?.visibility, "visible");

const publicAllOff = buildReferenceOverlayStyleParts(publicReady, {
  ...settings.referenceOverlay,
  mode: "auto",
  roads: false,
  borders: false,
  labels: false,
});
assert.equal(publicAllOff.layers.find((layer) => layer.id === "reference-public-imagery-topo")?.layout?.visibility, "none");

console.log("reference overlay style tests passed");
