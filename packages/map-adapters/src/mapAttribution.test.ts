import assert from "node:assert/strict";

import {
  ONLINE_IMAGERY_PROVIDER_CATALOG,
  REFERENCE_OVERLAY_LAYER_CONTRACTS,
  defaultAppSettings,
  resolveReferenceOverlaySource,
  type ReferenceOverlayResolution,
} from "@cplayout/core";
import { visibleMapAttributions } from "./mapAttribution";
import { buildWorkbenchStyle, rasterStyleSourceFromOnlineProvider, type RasterImageryStyleSource } from "./mapWorkbenchStyle";

const settings = defaultAppSettings();
const features = { type: "FeatureCollection" as const, features: [] };
const imageryOnly = rasterStyleSourceFromOnlineProvider(ONLINE_IMAGERY_PROVIDER_CATALOG.usgs_imagery_only);
const publicReference = resolveReferenceOverlaySource({
  allowPublicNetwork: true,
  preferences: { ...settings.referenceOverlay, mode: "auto" },
  target: "web_maplibre_gl_js",
});

const simultaneous = buildWorkbenchStyle(imageryOnly, features, publicReference, settings.referenceOverlay);
assert.deepEqual(visibleMapAttributions(simultaneous), [
  "USDA, USGS The National Map: Orthoimagery",
  "USGS The National Map: Orthoimagery and US Topo",
]);

const allReferenceLayersOff = {
  ...settings.referenceOverlay,
  roads: false,
  borders: false,
  labels: false,
};
assert.deepEqual(visibleMapAttributions(buildWorkbenchStyle(imageryOnly, features, publicReference, allReferenceLayersOff)), [
  imageryOnly.attribution,
]);
assert.deepEqual(visibleMapAttributions(buildWorkbenchStyle(imageryOnly, features, publicReference, {
  ...allReferenceLayersOff,
  roads: true,
})), [imageryOnly.attribution, publicReference.attribution]);

const localRaster: RasterImageryStyleSource = {
  ...imageryOnly,
  id: "operator-raster",
  name: "Operator raster",
  tiles: ["pmtiles://local-raster/{z}/{x}/{y}"],
  attribution: "Operator raster credit",
  licenseText: "Operator raster license",
};
const localVector: ReferenceOverlayResolution = {
  status: "ready",
  canRender: true,
  reason: "Local vector package is ready.",
  mode: "manual",
  autoApplied: false,
  sourceKind: "vector",
  source: {
    id: "operator-vector",
    type: "vector",
    tiles: ["pmtiles://local-vector/{z}/{x}/{y}"],
    minzoom: 0,
    maxzoom: 14,
    scheme: "xyz",
    attribution: "Operator vector credit",
  },
  schema: "cplayout_reference_v1",
  layers: REFERENCE_OVERLAY_LAYER_CONTRACTS.cplayout_reference_v1,
  attribution: "Operator vector credit",
  licenseText: "Operator vector license",
};
assert.deepEqual(visibleMapAttributions(buildWorkbenchStyle(localRaster, features, localVector, settings.referenceOverlay)), [
  "Operator raster credit",
  "Operator vector credit",
]);
assert.deepEqual(visibleMapAttributions(buildWorkbenchStyle(null, features, localVector, settings.referenceOverlay)), [
  "Operator vector credit",
]);

const sharedCredit = " Shared operator credit ";
assert.deepEqual(visibleMapAttributions(buildWorkbenchStyle(
  { ...localRaster, attribution: sharedCredit },
  features,
  { ...localVector, source: { ...localVector.source!, attribution: sharedCredit } },
  settings.referenceOverlay,
)), [sharedCredit.trim()]);

const noReference = resolveReferenceOverlaySource({
  preferences: { ...settings.referenceOverlay, mode: "off" },
  target: "web_maplibre_gl_js",
});
assert.deepEqual(visibleMapAttributions(buildWorkbenchStyle(null, features, noReference, settings.referenceOverlay)), []);

console.log("map attribution tests passed");
