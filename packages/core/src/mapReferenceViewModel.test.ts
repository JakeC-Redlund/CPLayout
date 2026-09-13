import assert from "node:assert/strict";
import { buildMapReferenceViewModel } from "./mapReferenceViewModel";
import { defaultAppSettings } from "./settings";
import type { MapPackageManifest } from "./types";

const settings = defaultAppSettings();
settings.aerialImagery = { mode: "off" };
settings.onlineImagery.enabled = false;
settings.referenceOverlay.mode = "auto";
const input = { settings, target: "web_maplibre_gl_js" as const, surface: "workbench" as const };
const off = buildMapReferenceViewModel(input);
assert.equal(off.aerial.sourceKind, "none");
assert.equal(off.reference.canRender, false);
assert.equal(off.layers.roads.requested, true);
assert.equal(off.layers.roads.available, false);
assert.equal(off.layers.roads.active, false);
assert.equal(off.referenceSummary, off.reference.reason);

settings.aerialImagery.mode = "auto";
const fallback = buildMapReferenceViewModel(input);
assert.equal(fallback.aerial.autoFallback, true);
assert.equal(fallback.reference.sourceKind, "public_raster");
assert.match(fallback.aerialSummary, /connected preview only/);
assert.equal(fallback.layers.labels.active, true);

const previewOff = buildMapReferenceViewModel({ ...input, surface: "online_preview" });
assert.equal(previewOff.aerial.sourceKind, "none");
assert.equal(previewOff.reference.canRender, false);
const svg = buildMapReferenceViewModel({ ...input, surface: "svg", target: "android_maplibre_rn" });
assert.equal(svg.aerial.sourceKind, "none");
assert.equal(svg.reference.status, "unavailable");
assert.equal(svg.runtimeLabel, "Native runtime unverified");

settings.onlineImagery.enabled = true;
settings.onlineImagery.providerId = "custom_open_xyz";
settings.onlineImagery.customSource = undefined;
const invalid = buildMapReferenceViewModel({ ...input, surface: "online_preview" });
assert.equal(invalid.aerial.canRender, false);
assert.equal(invalid.reference.canRender, false);
assert.equal(invalid.aerialSummary, invalid.aerial.reason);

settings.onlineImagery.providerId = "usgs_imagery_only";
const raster: MapPackageManifest = {
  id: "local-aerial",
  name: "Local aerial",
  packageType: "pmtiles",
  tileContentType: "raster",
  uri: "file:///offline/aerial.pmtiles",
  tileUrlTemplates: ["http://127.0.0.1:8765/aerial/{z}/{x}/{y}.png"],
  minZoom: 0,
  maxZoom: 18,
  tileScheme: "xyz",
  boundsWgs84: { minLongitude: -105, minLatitude: 39, maxLongitude: -104, maxLatitude: 40 },
  installStatus: "available",
  attribution: "Operator supplied imagery",
  licenseText: "Licensed for local use",
  importedAt: "2026-09-12T00:00:00.000Z",
};
const mapPackages = [raster];
const before = JSON.stringify({ settings, mapPackages });
const local = buildMapReferenceViewModel({ ...input, mapPackages, target: "android_maplibre_rn" });
assert.equal(local.aerial.sourceKind, "local_raster");
assert.match(local.aerialSummary, /Local aerial/);
assert.equal(local.aerial.localAerial.attribution, raster.attribution);
assert.equal(local.runtimeLabel, "Native runtime unverified");
assert.equal(local.evidenceLabel, "Reference only");
assert.equal(JSON.stringify({ settings, mapPackages }), before);
const preview = buildMapReferenceViewModel({ ...input, mapPackages, surface: "online_preview" });
assert.equal(preview.aerial.sourceKind, "online_provider");
assert.equal(preview.aerial.autoFallback, false);

settings.onlineImagery.enabled = false;
settings.aerialImagery = { mode: "manual", sourcePackageId: raster.id };
settings.referenceOverlay = { ...settings.referenceOverlay, mode: "manual", sourcePackageId: "missing", roads: false };
const missing = buildMapReferenceViewModel({ ...input, mapPackages });
assert.equal(missing.aerial.sourceKind, "local_raster");
assert.equal(missing.reference.status, "missing_package");
assert.equal(missing.referenceSummary, missing.reference.reason);
assert.deepEqual(missing.layers.roads, { requested: false, available: false, active: false });

settings.aerialImagery.mode = "off";
settings.referenceOverlay.mode = "off";
const allOff = buildMapReferenceViewModel({ ...input, mapPackages });
assert.equal(allOff.aerial.canRender, false);
assert.equal(allOff.reference.status, "off");
assert.equal(allOff.aerialWorkflow, "off");
assert.equal(allOff.runtimeLabel, null);

console.log("mapReferenceViewModel tests passed");
