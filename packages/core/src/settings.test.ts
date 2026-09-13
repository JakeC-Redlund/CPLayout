import assert from "node:assert/strict";

import {
  buildOnlineImageryTileUrl,
  DEFAULT_LAYOUT_SAFETY_ZONE_METERS,
  defaultAppSettings,
  gpsFixMeetsThreshold,
  mergeAppSettings,
  ONLINE_IMAGERY_PROVIDER_CATALOG,
  parseAppSettings,
  projectSettingsFromApp,
  resolveOnlineImageryProvider,
  validateCustomOpenImagerySource,
} from "./settings";

const defaults = defaultAppSettings();
assert.equal(defaults.offlineMaps.allowNetworkTiles, false);
assert.equal(defaults.offlineMaps.requireAttribution, true);
assert.equal(defaults.onlineImagery.enabled, false);
assert.equal(defaults.onlineImagery.providerId, "usgs_imagery_only");
assert.equal(defaults.aerialImagery.mode, "auto");
assert.equal(defaults.referenceOverlay.mode, "auto");
assert.equal(defaults.referenceOverlay.schema, "cplayout_reference_v1");
assert.equal(defaults.layoutReview.requiredBoundaryClearanceMeters, DEFAULT_LAYOUT_SAFETY_ZONE_METERS);
assert.equal(defaults.layoutReview.showMachineBoundaryDistances, true);
assert.match(ONLINE_IMAGERY_PROVIDER_CATALOG.usgs_imagery_only.tileUrlTemplate, /basemap\.nationalmap\.gov/);
assert.equal(ONLINE_IMAGERY_PROVIDER_CATALOG.usgs_imagery_only.tileScheme, "xyz");
assert.equal(ONLINE_IMAGERY_PROVIDER_CATALOG.usgs_imagery_only.tileSize, 256);
assert.equal(ONLINE_IMAGERY_PROVIDER_CATALOG.usgs_imagery_only.projection, "EPSG:3857");
assert.equal(ONLINE_IMAGERY_PROVIDER_CATALOG.usgs_imagery_only.cachePolicy, "interactive_only");
assert.equal(defaults.coordinateDisplayFormat, "decimal_degrees");
assert.equal(defaults.mappingWorkflowMode, "design");
assert.equal(defaults.gpsQuality.minimumFixType, "rtk_fixed");
assert.equal(defaults.gpsQuality.maxObservationAgeSeconds, 2);
assert.equal(parseAppSettings({ ...defaults, referenceOverlay: { ...defaults.referenceOverlay, enabled: false, mode: undefined } }).referenceOverlay.mode, "off");
assert.equal(parseAppSettings({ ...defaults, referenceOverlay: { ...defaults.referenceOverlay, enabled: true, mode: undefined } }).referenceOverlay.mode, "manual");

const merged = mergeAppSettings({
  coordinateDisplayFormat: "degrees_minutes_seconds",
  drawing: { vertexSnapToleranceMeters: 2.5 },
  layoutReview: { requiredBoundaryClearanceMeters: 12 },
});
assert.equal(merged.coordinateDisplayFormat, "degrees_minutes_seconds");
assert.equal(merged.mappingWorkflowMode, "design");
assert.equal(merged.drawing.vertexSnapToleranceMeters, 2.5);
assert.equal(merged.drawing.featureSnapToleranceMeters, defaults.drawing.featureSnapToleranceMeters);
assert.equal(merged.layoutReview.requiredBoundaryClearanceMeters, 12);
assert.equal(merged.layoutReview.showMachineBoundaryDistances, true);

const projectSettings = projectSettingsFromApp(merged);
assert.equal(projectSettings.mappingWorkflowMode, "design");
assert.equal(projectSettings.aerialImagery.mode, "auto");
assert.equal(projectSettings.layoutReview.requiredBoundaryClearanceMeters, 12);
assert.equal(projectSettings.layoutReview.showMachineBoundaryDistances, true);
assert.equal(projectSettings.offlineMaps.allowNetworkTiles, false);
assert.equal("packageDirectory" in projectSettings.offlineMaps, false);
assert.equal("onlineImagery" in projectSettings, false);
assert.equal("referenceOverlay" in projectSettings, false);
assert.deepEqual(parseAppSettings(merged), merged);

const manualAerial = projectSettingsFromApp(mergeAppSettings({
  aerialImagery: { mode: "manual", sourcePackageId: "naip-local-package" },
  onlineImagery: { enabled: true, providerId: "usgs_imagery_only", maxTilesPerView: 32 },
}));
assert.deepEqual(manualAerial.aerialImagery, { mode: "manual", sourcePackageId: "naip-local-package" });
assert.equal("onlineImagery" in manualAerial, false);

assert.equal(gpsFixMeetsThreshold("rtk_fixed", "rtk_float"), true);
assert.equal(gpsFixMeetsThreshold("autonomous", "rtk_float"), false);
assert.equal(gpsFixMeetsThreshold("unknown", "autonomous"), false);
assert.equal(gpsFixMeetsThreshold("ppp", "rtk_float"), false);

assert.throws(
  () => parseAppSettings({ ...defaults, offlineMaps: { ...defaults.offlineMaps, allowNetworkTiles: true } }),
  /Invalid input/,
);

assert.throws(
  () => parseAppSettings({ ...defaults, onlineImagery: { ...defaults.onlineImagery, maxTilesPerView: 1000 } }),
  /Too big/,
);

assert.throws(
  () => parseAppSettings({ ...defaults, layoutReview: { ...defaults.layoutReview, requiredBoundaryClearanceMeters: -1 } }),
  /Too small/,
);

assert.equal(
  buildOnlineImageryTileUrl(ONLINE_IMAGERY_PROVIDER_CATALOG.usgs_imagery_only, { z: 3, x: 4, y: 5 }),
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/3/5/4",
);

const customSource = {
  name: "Open farm tiles",
  tileUrlTemplate: "https://tiles.example.org/open/default/{TileMatrix}/{TileRow}/{TileCol}.png",
  minZoom: 2,
  maxZoom: 17,
  tileScheme: "xyz" as const,
  tileSize: 256,
  projection: "EPSG:3857" as const,
  coverageLabel: "Example open imagery coverage",
  termsUrl: "https://tiles.example.org/terms",
  sourceUrl: "https://tiles.example.org",
  cachePolicy: "interactive_only" as const,
  attribution: "Example Open Imagery",
  licenseText: "CC-BY 4.0 compatible example imagery.",
};
const customValidation = validateCustomOpenImagerySource(customSource);
assert.equal(customValidation.ok, true);
if (customValidation.ok) {
  const provider = resolveOnlineImageryProvider("custom_open_xyz", customValidation.source);
  assert.equal(provider.name, "Open farm tiles");
  assert.equal(provider.attribution, "Example Open Imagery");
  assert.equal(
    buildOnlineImageryTileUrl(provider, { z: 6, x: 12, y: 21 }),
    "https://tiles.example.org/open/default/6/21/12.png",
  );
}

const tmsValidation = validateCustomOpenImagerySource({
  ...customSource,
  tileScheme: "tms" as const,
  tileUrlTemplate: "https://tiles.example.org/open/{z}/{x}/{y}.png",
});
assert.equal(tmsValidation.ok, true);
if (tmsValidation.ok) {
  assert.equal(
    buildOnlineImageryTileUrl(resolveOnlineImageryProvider("custom_open_xyz", tmsValidation.source), { z: 3, x: 2, y: 1 }),
    "https://tiles.example.org/open/3/2/6.png",
  );
}

assert.equal(validateCustomOpenImagerySource({ ...customSource, attribution: "" }).ok, false);
assert.equal(validateCustomOpenImagerySource({ ...customSource, licenseText: "" }).ok, false);
assert.match(
  customSourceError({ ...customSource, tileUrlTemplate: "https://tiles.example.org/{z}/{x}/{y}.png?api_key=secret" }),
  /hidden API keys/,
);
assert.match(
  customSourceError({ ...customSource, tileUrlTemplate: "https://api.mapbox.com/styles/v1/open/{z}/{x}/{y}.png" }),
  /Mapbox/,
);
assert.match(
  customSourceError({ ...customSource, tileUrlTemplate: "https://tiles.example.org/{z}/{x}/{y}/{Time}.png" }),
  /placeholder/,
);
assert.throws(
  () => parseAppSettings({ ...defaults, onlineImagery: { enabled: true, providerId: "custom_open_xyz", maxTilesPerView: 16 } }),
  /Custom open imagery requires/,
);

console.log("settings tests passed");

function customSourceError(value: unknown): string {
  const result = validateCustomOpenImagerySource(value);
  if (result.ok) throw new Error("Expected custom source validation to fail.");
  return result.error;
}
