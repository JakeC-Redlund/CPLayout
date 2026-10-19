import assert from "node:assert/strict";

import {
  describeTilePackageReadiness,
  classifyMapTileSourceUrl,
  listAerialImageryCandidates,
  resolveAerialImagerySource,
  resolveAerialReferenceImagerySource,
  toMapLibreTileSourceDescriptor,
  validateMapPackageManifest,
} from "./mapTilePackages";
import type { MapPackageManifest } from "./types";

const packageManifest: MapPackageManifest = {
  id: "field-imagery-z12",
  name: "Field imagery package",
  packageType: "pmtiles",
  tileContentType: "raster",
  uri: "file:///offline/field.pmtiles",
  minZoom: 10,
  maxZoom: 18,
  tileScheme: "xyz",
  boundsWgs84: {
    minLongitude: -105.21,
    minLatitude: 40.01,
    maxLongitude: -105.11,
    maxLatitude: 40.11,
  },
  tileJsonUrl: "http://127.0.0.1:8765/field/tilejson.json",
  tileUrlTemplates: ["http://127.0.0.1:8765/field/{z}/{x}/{y}.png"],
  imageryProvenance: {
    providerId: "usgs_naip",
    providerName: "USGS EROS NAIP",
    sourceUrl: "https://www.usgs.gov/centers/eros/science/national-agriculture-imagery-program-naip",
    productId: "M_4010521_NE_13_1_20250715",
    acquisitionYear: 2025,
    sourceResolutionMeters: 1,
    originalCrs: "EPSG:26913",
    preprocessingSummary: "GDAL preprocessing generated XYZ PNG tiles and TileJSON outside the app.",
    accessedAt: "2026-06-03T12:00:00.000Z",
    attribution: "USDA Farm Service Agency, USGS EROS NAIP",
    licenseText: "Public domain NAIP imagery; verify source notices for the selected product.",
    offlineCopyAllowed: true,
    keyedService: false,
  },
  checksumSha256: "a".repeat(64),
  installStatus: "available",
  attribution: "Local orthomosaic, licensed for offline field use.",
  licenseText: "Operator supplied local imagery.",
  bytes: 123456,
  importedAt: "2026-05-19T12:00:00.000Z",
};

const parsed = validateMapPackageManifest(packageManifest);
assert.equal(parsed.tileScheme, "xyz");
assert.equal(parsed.tileContentType, "raster");
assert.equal(parsed.imageryProvenance?.providerId, "usgs_naip");
assert.equal(parsed.imageryProvenance?.sourceResolutionMeters, 1);

const source = toMapLibreTileSourceDescriptor(parsed);
assert.ok(source);
assert.deepEqual(source.bounds, [-105.21, 40.01, -105.11, 40.11]);
assert.equal(source.type, "raster");
assert.equal(source.scheme, "xyz");
assert.deepEqual(source.tiles, packageManifest.tileUrlTemplates);

const nativeReady = describeTilePackageReadiness(parsed, "native_maplibre_rn");
assert.equal(nativeReady.canRender, true);
assert.equal(nativeReady.requiresAdapter, false);
assert.ok(nativeReady.source);
assert.equal(nativeReady.sourceKind, "generated_tilejson_or_template");

const androidReady = describeTilePackageReadiness(parsed, "android_maplibre_rn");
assert.equal(androidReady.canRender, true);
assert.equal(androidReady.requiresAdapter, false);
assert.equal(androidReady.sourceKind, "generated_tilejson_or_template");

const logicalAppPackage = validateMapPackageManifest({
  ...packageManifest,
  id: "logical-naip-package",
  uri: "app://map-packages/logical-naip-package/",
  tileJsonUrl: "app://map-packages/logical-naip-package/tilejson.json",
  tileUrlTemplates: ["app://map-packages/logical-naip-package/tiles/{z}/{x}/{y}.png"],
});
const logicalAppReadiness = describeTilePackageReadiness(logicalAppPackage, "android_maplibre_rn");
assert.equal(logicalAppReadiness.canRender, false);
assert.equal(logicalAppReadiness.requiresAdapter, false);
assert.match(logicalAppReadiness.reason, /Map package files are unavailable.*Import the map archive/);

const aerialAuto = resolveAerialImagerySource({
  preferences: { mode: "auto" },
  mapPackages: [parsed],
  target: "android_maplibre_rn",
});
assert.equal(aerialAuto.canRender, true);
assert.equal(aerialAuto.status, "ready");
assert.equal(aerialAuto.sourceKind, "local_raster");
assert.equal(aerialAuto.autoApplied, true);
assert.equal(aerialAuto.packageId, parsed.id);
assert.equal(aerialAuto.imageryProvenance?.providerId, "usgs_naip");

const aerialManual = resolveAerialImagerySource({
  preferences: { mode: "manual", sourcePackageId: parsed.id },
  mapPackages: [parsed],
  target: "web_maplibre_gl_js",
});
assert.equal(aerialManual.canRender, true);
assert.equal(aerialManual.autoApplied, false);
assert.equal(aerialManual.source?.tiles?.[0], packageManifest.tileUrlTemplates?.[0]);

const localBeatsConnectedPreview = resolveAerialReferenceImagerySource({
  preferences: { mode: "auto" },
  onlineImagery: { enabled: true, providerId: "usgs_imagery_only", maxTilesPerView: 64 },
  mapPackages: [parsed],
  target: "android_maplibre_rn",
});
assert.equal(localBeatsConnectedPreview.canRender, true);
assert.equal(localBeatsConnectedPreview.sourceKind, "local_raster");
assert.equal(localBeatsConnectedPreview.localAerial.packageId, parsed.id);
assert.equal(localBeatsConnectedPreview.onlineProvider, undefined);

const usgsFallback = resolveAerialReferenceImagerySource({
  preferences: { mode: "auto" },
  onlineImagery: { enabled: false, providerId: "usgs_imagery_only", maxTilesPerView: 64 },
  mapPackages: [],
  target: "android_maplibre_rn",
});
assert.equal(usgsFallback.canRender, true);
assert.equal(usgsFallback.sourceKind, "online_provider");
assert.equal(usgsFallback.onlineProvider?.id, "usgs_imagery_only");
assert.equal(usgsFallback.autoFallback, true);
assert.match(usgsFallback.reason, /connected preview fallback/);

const explicitUsgsOnly = resolveAerialReferenceImagerySource({
  preferences: { mode: "off" },
  onlineImagery: { enabled: true, providerId: "usgs_imagery_only", maxTilesPerView: 64 },
  mapPackages: [parsed],
  target: "android_maplibre_rn",
});
assert.equal(explicitUsgsOnly.canRender, true);
assert.equal(explicitUsgsOnly.sourceKind, "online_provider");
assert.equal(explicitUsgsOnly.autoFallback, false);

const fullyOff = resolveAerialReferenceImagerySource({
  preferences: { mode: "off" },
  onlineImagery: { enabled: false, providerId: "usgs_imagery_only", maxTilesPerView: 64 },
  mapPackages: [parsed],
  target: "android_maplibre_rn",
});
assert.equal(fullyOff.canRender, false);
assert.equal(fullyOff.sourceKind, "none");

assert.deepEqual(listAerialImageryCandidates({
  mapPackages: [parsed],
  target: "android_maplibre_rn",
}).map((candidate) => candidate.packageId), [parsed.id]);

const aerialOff = resolveAerialImagerySource({
  preferences: { mode: "off" },
  mapPackages: [parsed],
  target: "android_maplibre_rn",
});
assert.equal(aerialOff.canRender, false);
assert.equal(aerialOff.status, "off");

const rawArchiveOnly = validateMapPackageManifest({
  ...packageManifest,
  id: "raw-only",
  tileJsonUrl: undefined,
  tileUrlTemplates: undefined,
  uri: "file:///offline/raw-only.mbtiles",
  packageType: "mbtiles",
});
const nativeDeferred = describeTilePackageReadiness(rawArchiveOnly, "native_maplibre_rn");
assert.equal(nativeDeferred.canRender, false);
assert.equal(nativeDeferred.requiresAdapter, true);
assert.match(nativeDeferred.reason, /raw PMTiles\/MBTiles files need/);
assert.equal(nativeDeferred.sourceKind, "raw_mbtiles_archive");

const rawAerialDeferred = resolveAerialImagerySource({
  preferences: { mode: "manual", sourcePackageId: rawArchiveOnly.id },
  mapPackages: [rawArchiveOnly],
  target: "android_maplibre_rn",
});
assert.equal(rawAerialDeferred.canRender, false);
assert.equal(rawAerialDeferred.status, "unavailable");
assert.match(rawAerialDeferred.reason, /raw PMTiles\/MBTiles|generated local TileJSON/);

const webPmtiles = validateMapPackageManifest({
  ...packageManifest,
  id: "web-pmtiles",
  tileJsonUrl: undefined,
  tileUrlTemplates: [],
  uri: "pmtiles://http://127.0.0.1:8765/field.pmtiles",
});
const webReady = describeTilePackageReadiness(webPmtiles, "web_maplibre_gl_js");
assert.equal(webReady.canRender, true);
assert.match(webReady.reason, /pmtiles protocol/);

const nativeRawPmtiles = describeTilePackageReadiness(webPmtiles, "native_maplibre_rn");
assert.equal(nativeRawPmtiles.canRender, false);
assert.equal(nativeRawPmtiles.requiresAdapter, true);
assert.match(nativeRawPmtiles.reason, /direct PMTiles/);
assert.equal(nativeRawPmtiles.sourceKind, "raw_pmtiles_archive");

const androidRawPmtiles = describeTilePackageReadiness({
  ...webPmtiles,
  uri: "pmtiles://file:///offline/field.pmtiles",
}, "android_maplibre_rn");
assert.equal(androidRawPmtiles.canRender, false);
assert.equal(androidRawPmtiles.requiresAdapter, true);
assert.match(androidRawPmtiles.reason, /platform-gated/);

const remotePmtiles = validateMapPackageManifest({
  ...packageManifest,
  id: "remote-pmtiles",
  tileJsonUrl: undefined,
  tileUrlTemplates: [],
  uri: "pmtiles://https://tiles.example.invalid/field.pmtiles",
});
const remotePmtilesReadiness = describeTilePackageReadiness(remotePmtiles, "web_maplibre_gl_js");
assert.equal(remotePmtilesReadiness.canRender, false);
assert.equal(remotePmtilesReadiness.requiresAdapter, false);
assert.match(remotePmtilesReadiness.reason, /PMTiles URIs must point to local/);

assert.throws(
  () => validateMapPackageManifest({ ...packageManifest, maxZoom: 9 }),
  /maxZoom/,
);

assert.throws(
  () => validateMapPackageManifest({ ...packageManifest, checksumSha256: "not-sha256" }),
  /Invalid string|checksumSha256/,
);

const remoteTileSource = validateMapPackageManifest({
  ...packageManifest,
  id: "remote-template",
  tileJsonUrl: "https://tiles.example.invalid/tilejson.json",
  tileUrlTemplates: ["https://tiles.example.invalid/{z}/{x}/{y}.png"],
});
assert.equal(toMapLibreTileSourceDescriptor(remoteTileSource), null);
const remoteReadiness = describeTilePackageReadiness(remoteTileSource, "native_maplibre_rn");
assert.equal(remoteReadiness.canRender, false);
assert.equal(remoteReadiness.requiresAdapter, false);
assert.match(remoteReadiness.reason, /local app-readable files or localhost/);

const remoteAerial = resolveAerialImagerySource({
  preferences: { mode: "manual", sourcePackageId: remoteTileSource.id },
  mapPackages: [remoteTileSource],
  target: "android_maplibre_rn",
});
assert.equal(remoteAerial.canRender, false);
assert.match(remoteAerial.reason, /local app-readable files or localhost/);

assert.throws(
  () => validateMapPackageManifest({
    ...packageManifest,
    imageryProvenance: {
      ...packageManifest.imageryProvenance,
      keyedService: true,
    },
  }),
  /Invalid input|keyedService/,
);

for (const unsafe of ["//tiles.example.invalid/{z}/{x}/{y}.png", "http://user:pass@localhost/{z}/{x}/{y}.png", "file:///offline/../private/{z}/{x}/{y}.png", "content://unverified/{z}/{x}/{y}.png", "app://unregistered/{z}/{x}/{y}.png", "data:image/png;base64,eA==", "../tiles/{z}/{x}/{y}.png", "pmtiles://file:///offline/{z}/{x}/{y}.png"]) {
  const unsafePackage = { ...packageManifest, tileJsonUrl: undefined, tileUrlTemplates: [unsafe] };
  assert.equal(describeTilePackageReadiness(unsafePackage, "web_maplibre_gl_js").canRender, false, unsafe);
  assert.equal(describeTilePackageReadiness(unsafePackage, "android_maplibre_rn").canRender, false, unsafe);
}
assert.equal(classifyMapTileSourceUrl("./tiles/{z}/{x}/{y}.png").kind, "unsupported", "Relative references require an explicit resolution base");
assert.equal(classifyMapTileSourceUrl("./tiles/{z}/{x}/{y}.png", "app://map-packages/fixture/tilejson.json").kind, "logical_package");
assert.equal(classifyMapTileSourceUrl("//tiles.example.invalid/{z}/{x}/{y}.png", "http://localhost/").kind, "unsupported");
assert.equal(classifyMapTileSourceUrl("http://[::1]:8765/tiles/{z}/{x}/{y}.png").kind, "loopback_http");
assert.equal(classifyMapTileSourceUrl("file://remote-host/private/map.png").kind, "unsupported");
assert.equal(classifyMapTileSourceUrl("file:///offline/%2e%2e/private/map.png").kind, "unsupported");
const installedFileSource = { ...packageManifest, tileJsonUrl: "file:///documents/runtime-tilejson.json", tileUrlTemplates: ["file:///documents/tiles/{z}/{x}/{y}.png"] };
assert.equal(describeTilePackageReadiness(installedFileSource, "web_maplibre_gl_js").canRender, false, "Browser file transport requires an explicit adapter");
assert.equal(describeTilePackageReadiness(installedFileSource, "android_maplibre_rn").canRender, true, "Native file source configuration remains separate from device proof");
assert.equal(describeTilePackageReadiness({ ...webPmtiles, uri: "pmtiles://file:///offline/field.pmtiles" }, "web_maplibre_gl_js").canRender, false);
for (const imageryProvenance of [undefined, { ...packageManifest.imageryProvenance!, offlineCopyAllowed: false }]) {
  const unqualified = { ...packageManifest, imageryProvenance };
  const before = JSON.stringify(unqualified);
  assert.equal(toMapLibreTileSourceDescriptor(unqualified), null);
  assert.equal(describeTilePackageReadiness(unqualified, "web_maplibre_gl_js").canRender, false);
  assert.equal(resolveAerialImagerySource({ mapPackages: [unqualified], preferences: { mode: "manual", sourcePackageId: unqualified.id }, target: "web_maplibre_gl_js" }).canRender, false);
  assert.deepEqual(listAerialImageryCandidates({ mapPackages: [unqualified], target: "web_maplibre_gl_js" }), []);
  assert.equal(JSON.stringify(unqualified), before, "Readiness keeps unqualified metadata unchanged");
}

console.log("map tile package tests passed");
