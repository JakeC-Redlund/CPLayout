import assert from "node:assert/strict";

import { strFromU8, strToU8, zipSync } from "fflate";

import {
  MAP_PACKAGE_MANIFEST_FILENAME,
  MAP_PACKAGE_TILEJSON_FILENAME,
  mapPackageManifestHasLogicalUrls,
  mapPackageLogicalUrlPrefix,
  mapPackageRuntimeUrl,
  parseMapPackageArchiveZip,
  rewriteMapPackageRuntimeUrls,
  prepareMapPackageRuntimeBundle,
  MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME,
} from "./mapPackageArchive";
import { rehydrateInstalledMapPackageManifestsAsync } from "./mapPackageArchiveInstall";
import { installMapPackageArchiveWithStorage, type MapPackageArchiveStorage } from "./mapPackageArchiveInstallCore";
import { runMapPackageRecoveryTests } from "./mapPackageArchiveRecovery.test";

const packageId = "naip-local-aerial";
const prefix = mapPackageLogicalUrlPrefix(packageId);
const manifest = {
  id: packageId,
  name: "NAIP local aerial",
  packageType: "raster_tiles",
  tileContentType: "raster",
  uri: prefix,
  minZoom: 12,
  maxZoom: 18,
  tileScheme: "xyz",
  boundsWgs84: {
    minLongitude: -105.2,
    minLatitude: 40.01,
    maxLongitude: -105.1,
    maxLatitude: 40.08,
  },
  tileJsonUrl: `${prefix}tilejson.json`,
  tileUrlTemplates: [`${prefix}tiles/{z}/{x}/{y}.png`],
  imageryProvenance: {
    providerId: "usgs_naip",
    providerName: "USGS EROS NAIP",
    sourceUrl: "https://www.usgs.gov/centers/eros/science/national-agriculture-imagery-program-naip",
    productId: "M_4010521_NE_13_1_20250715",
    acquisitionYear: 2025,
    sourceResolutionMeters: 1,
    originalCrs: "EPSG:26913",
    preprocessingSummary: "GDAL generated XYZ PNG tiles and TileJSON outside the app.",
    accessedAt: "2026-06-03T12:00:00.000Z",
    attribution: "USDA Farm Service Agency, USGS EROS NAIP",
    licenseText: "Public domain NAIP imagery; verify source notices for the selected product.",
    offlineCopyAllowed: true,
    keyedService: false,
  },
  checksumSha256: "c".repeat(64),
  installStatus: "available",
  attribution: "USDA Farm Service Agency, USGS EROS NAIP",
  licenseText: "Public domain NAIP imagery; verify source notices for the selected product.",
  bytes: 512,
  importedAt: "2026-06-03T12:00:00.000Z",
};

const archive = zipSync({
  [MAP_PACKAGE_MANIFEST_FILENAME]: strToU8(JSON.stringify(manifest)),
  [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8(JSON.stringify({
    tilejson: "3.0.0",
    tiles: manifest.tileUrlTemplates,
    minzoom: manifest.minZoom,
    maxzoom: manifest.maxZoom,
  })),
  "tiles/12/856/1549.png": new Uint8Array([137, 80, 78, 71]),
});

const parsed = parseMapPackageArchiveZip(archive);
assert.equal(parsed.manifest.id, packageId);
assert.equal(parsed.manifest.imageryProvenance?.providerId, "usgs_naip");
assert.equal(mapPackageManifestHasLogicalUrls(parsed.manifest), true);
assert.equal(parsed.manifest.tileJsonUrl, `${prefix}tilejson.json`);
assert.ok(parsed.files[MAP_PACKAGE_TILEJSON_FILENAME]);
assert.ok(parsed.files["tiles/12/856/1549.png"]);

assert.equal(
  mapPackageRuntimeUrl(`${prefix}tiles/{z}/{x}/{y}.png`, packageId, "file:///documents/map-packages/naip-local-aerial"),
  "file:///documents/map-packages/naip-local-aerial/tiles/{z}/{x}/{y}.png",
);

const runtimeManifest = rewriteMapPackageRuntimeUrls(parsed.manifest, "file:///documents/map-packages/naip-local-aerial/");
assert.equal(runtimeManifest.tileJsonUrl, "file:///documents/map-packages/naip-local-aerial/tilejson.json");
assert.deepEqual(runtimeManifest.tileUrlTemplates, ["file:///documents/map-packages/naip-local-aerial/tiles/{z}/{x}/{y}.png"]);
assert.equal(mapPackageManifestHasLogicalUrls(runtimeManifest), false);

const originalManifest = JSON.stringify(parsed.manifest);
const originalTileJson = parsed.files[MAP_PACKAGE_TILEJSON_FILENAME].slice();
const runtime = prepareMapPackageRuntimeBundle(parsed, "file:///documents/map-packages/naip-local-aerial");
const runtimeTileJson = JSON.parse(strFromU8(runtime.files[MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME]));
assert.deepEqual(runtimeTileJson.tiles, ["file:///documents/map-packages/naip-local-aerial/tiles/{z}/{x}/{y}.png"]);
assert.deepEqual(runtimeTileJson.bounds, [-105.2, 40.01, -105.1, 40.08]);
assert.equal(runtime.manifest.tileJsonUrl, "file:///documents/map-packages/naip-local-aerial/runtime-tilejson.json");
assert.equal(JSON.stringify(parsed.manifest), originalManifest);
assert.deepEqual(parsed.files[MAP_PACKAGE_TILEJSON_FILENAME], originalTileJson);
assert.deepEqual(runtime.files[MAP_PACKAGE_TILEJSON_FILENAME], originalTileJson, "Original TileJSON bytes remain available");
assert.doesNotMatch(JSON.stringify(parsed.manifest), /file:\/\/\/documents/);

function makeArchive(tileJson: unknown, overrides: Record<string, unknown> = {}, tiles: Record<string, Uint8Array> = { "tiles/12/856/1549.png": new Uint8Array([1]) }): Uint8Array {
  return zipSync({
    [MAP_PACKAGE_MANIFEST_FILENAME]: strToU8(JSON.stringify({ ...manifest, ...overrides })),
    [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8(typeof tileJson === "string" ? tileJson : JSON.stringify(tileJson)),
    ...tiles,
  });
}

for (const relative of ["tiles/{z}/{x}/{y}.png", "./tiles/{z}/{x}/{y}.png", "tiles/12/856/1549.png"]) {
  const bundle = parseMapPackageArchiveZip(makeArchive({ tilejson: "3.0.0", tiles: [relative] }, { tileUrlTemplates: [] }));
  const resolved = prepareMapPackageRuntimeBundle(bundle, "file:///packages/test");
  assert.equal(resolved.manifest.tileUrlTemplates?.[0], `file:///packages/test/${relative.replace(/^\.\//, "")}`);
}

for (const malformed of ["{", [], {}, { tiles: [] }, { tiles: [4] }, { tiles: manifest.tileUrlTemplates, grids: ["https://example.invalid/grid"] }, { tiles: manifest.tileUrlTemplates, data: ["//example.invalid/data"] }]) {
  assert.throws(() => parseMapPackageArchiveZip(makeArchive(malformed)), /TileJSON/);
}
const compatibleTileJson = {
  tiles: manifest.tileUrlTemplates, scheme: manifest.tileScheme,
  minzoom: manifest.minZoom, maxzoom: manifest.maxZoom,
  bounds: [-105.2, 40.01, -105.1, 40.08], tileSize: 256, format: "png",
};
assert.doesNotThrow(() => parseMapPackageArchiveZip(makeArchive(compatibleTileJson)));
const conflictingTileJson = [
  { scheme: "tms" }, { scheme: "unknown" }, { minzoom: 11 }, { maxzoom: 19 }, { minzoom: "12" },
  { bounds: [-106, 40.01, -105.1, 40.08] }, { bounds: [-105.2, 40.01, -105.1] },
  { tileSize: 512 }, { format: "pbf" }, { vector_layers: [{ id: "roads" }] }, { encoding: "mapbox" },
  { attribution: "Additional contributor whose credits must not be dropped" }, { attribution: "" },
];
for (const conflicting of conflictingTileJson) {
  const invalid = makeArchive({ ...compatibleTileJson, ...conflicting });
  assert.throws(() => parseMapPackageArchiveZip(invalid), /TileJSON.*conflict|TileJSON.*unsupported/i, JSON.stringify(conflicting));
}
for (const imageryProvenance of [undefined, { ...manifest.imageryProvenance, offlineCopyAllowed: false }]) {
  assert.throws(() => parseMapPackageArchiveZip(makeArchive({ tiles: manifest.tileUrlTemplates }, { imageryProvenance })), /offline copying|source provenance/);
}
const invalidTiles: Record<string, Uint8Array>[] = [{ "tiles/{z}/{x}/{y}.png": new Uint8Array([1]) }, { "tiles/12/856/1549.png": new Uint8Array() }, { "tiles/12/99999/1549.png": new Uint8Array([1]) }, { "tiles/012/856/1549.png": new Uint8Array([1]) }];
for (const tiles of invalidTiles) {
  assert.throws(() => parseMapPackageArchiveZip(makeArchive({ tiles: manifest.tileUrlTemplates }, {}, tiles)), /concrete XYZ|empty or outside/);
}
assert.throws(() => parseMapPackageArchiveZip(makeArchive({ tiles: [`${prefix}tiles/12/999/1549.png`] })), /missing concrete/);
assert.throws(() => mapPackageRuntimeUrl(`${prefix}tiles/../private.png`, packageId, "file:///packages/test"), /unsafe path/);
assert.throws(() => mapPackageRuntimeUrl(`${prefix}tiles/{z}/{x}/{y}.png`, packageId, "content://unverified/packages"), /supported local file/);

class MemoryStorage implements MapPackageArchiveStorage {
  directories = new Map<string, Record<string, Uint8Array>>();
  operations: string[] = [];
  failWrite = false;
  failPromotion = false;
  directoryUri(name: string) { return `file:///packages/${name}`; }
  exists(name: string) { return this.directories.has(name); }
  readFiles(name: string) { return structuredClone(this.directories.get(name)!); }
  writeFiles(name: string, files: Record<string, Uint8Array>) {
    this.operations.push(`write ${name}`);
    this.directories.set(name, structuredClone(files));
    if (this.failWrite) throw new Error("Simulated write failure");
  }
  moveDirectory(from: string, to: string) {
    this.operations.push(`move ${from} ${to}`);
    if (this.failPromotion && from.includes(".pending-")) throw new Error("Simulated promotion failure");
    assert(!this.directories.has(to));
    this.directories.set(to, this.directories.get(from)!);
    this.directories.delete(from);
  }
  removeDirectory(name: string) { this.operations.push(`remove ${name}`); this.directories.delete(name); }
}
const storage = new MemoryStorage();
const installed = installMapPackageArchiveWithStorage(archive, storage, "first");
assert.equal(installed.manifest.tileJsonUrl, manifest.tileJsonUrl);
assert.deepEqual(storage.directories.get(packageId)?.[MAP_PACKAGE_TILEJSON_FILENAME], originalTileJson);
assert.deepEqual(storage.directories.get(packageId)?.[MAP_PACKAGE_MANIFEST_FILENAME], strToU8(JSON.stringify(manifest)));
assert.ok(storage.directories.get(packageId)?.[MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME]);
const preceding = structuredClone(storage.directories.get(packageId));
for (const conflicting of conflictingTileJson) {
  const beforeOperations = storage.operations.length;
  assert.throws(() => installMapPackageArchiveWithStorage(makeArchive({ ...compatibleTileJson, ...conflicting }), storage, "metadata-conflict"), /TileJSON.*conflict|TileJSON.*unsupported/i);
  assert.equal(storage.operations.length, beforeOperations, "Conflicting source metadata refuses before storage writes");
  assert.deepEqual(storage.directories.get(packageId), preceding);
}
storage.failWrite = true;
assert.throws(() => installMapPackageArchiveWithStorage(archive, storage, "write-failure"), /Simulated write failure/);
assert.deepEqual(storage.directories.get(packageId), preceding);
assert(!storage.directories.has(`.${packageId}.pending-write-failure`));
storage.failWrite = false;
storage.failPromotion = true;
assert.throws(() => installMapPackageArchiveWithStorage(archive, storage, "promote-failure"), /Simulated promotion failure/);
assert.deepEqual(storage.directories.get(packageId), preceding);
storage.failPromotion = false;
installMapPackageArchiveWithStorage(archive, storage, "replacement");
assert.deepEqual(storage.directories.get(`.${packageId}.previous-replacement`), preceding, "Replacement keeps recovery edition");
const operationsBeforeRefusal = storage.operations.length;
assert.throws(() => installMapPackageArchiveWithStorage(makeArchive({ tiles: ["//example.invalid/{z}/{x}/{y}.png"] }), storage, "unsafe"), /inside the admitted package/);
assert.equal(storage.operations.length, operationsBeforeRefusal, "Unsafe admission has no storage side effects");
assert.deepEqual(storage.directories.get(packageId), preceding);

for (const template of ["//tiles.example.invalid/{z}/{x}/{y}.png", "https://tiles.example.invalid/{z}/{x}/{y}.png", "http://user:pass@localhost/{z}/{x}/{y}.png", `${prefix}tiles/../private.png`, `${prefix}tiles/%2e%2e/private.png`, "app://map-packages/other/tiles/{z}/{x}/{y}.png"]) {
  assert.throws(() => parseMapPackageArchiveZip(zipSync({
    [MAP_PACKAGE_MANIFEST_FILENAME]: strToU8(JSON.stringify(manifest)),
    [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8(JSON.stringify({ tilejson: "3.0.0", tiles: [template] })),
    "tiles/12/856/1549.png": new Uint8Array([1]),
  })), /TileJSON|unsafe|package/i, template);
}
for (const imageryProvenance of [undefined, { ...manifest.imageryProvenance, offlineCopyAllowed: false }]) {
  const beforeRefusal = storage.operations.length;
  assert.throws(() => installMapPackageArchiveWithStorage(makeArchive({ tiles: manifest.tileUrlTemplates }, { imageryProvenance }), storage, "policy-refusal"), /offline copying|source provenance/);
  assert.equal(storage.operations.length, beforeRefusal);
  assert.deepEqual(storage.directories.get(packageId), preceding);
}

assert.throws(
  () => parseMapPackageArchiveZip(zipSync({
    [MAP_PACKAGE_MANIFEST_FILENAME]: strToU8(JSON.stringify({
      ...manifest,
      tileJsonUrl: "file:///tmp/tilejson.json",
    })),
    [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8("{}"),
    "tiles/12/856/1549.png": new Uint8Array([1]),
  })),
  /logical app URLs/,
);

assert.throws(
  () => parseMapPackageArchiveZip(zipSync({
    [MAP_PACKAGE_MANIFEST_FILENAME]: strToU8(JSON.stringify(manifest)),
    "../evil.png": new Uint8Array([1]),
  })),
  /unsafe path/,
);

assert.throws(
  () => parseMapPackageArchiveZip(zipSync({
    [MAP_PACKAGE_MANIFEST_FILENAME]: strToU8(JSON.stringify({
      ...manifest,
      packageType: "mbtiles",
      uri: `${prefix}raw.mbtiles`,
      tileJsonUrl: undefined,
      tileUrlTemplates: [],
    })),
    "raw.mbtiles": new Uint8Array([1]),
  })),
  /generated raster tile packages only|unsupported file/,
);

void rehydrateInstalledMapPackageManifestsAsync([parsed.manifest, runtimeManifest])
  .then(async (runtimeManifests) => {
    assert.deepEqual(runtimeManifests, []);
    await runMapPackageRecoveryTests(parsed.manifest, archive);
    console.log("map package archive tests passed");
  }).catch((error) => { console.error(error); process.exitCode = 1; });
