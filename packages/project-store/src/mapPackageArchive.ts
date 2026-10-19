import { strFromU8, strToU8, unzipSync } from "fflate";

import { classifyMapTileSourceUrl, validateMapPackageManifest, type MapPackageManifest } from "@cplayout/core";

export const MAP_PACKAGE_ARCHIVE_VERSION = "cplayout-map-package-v1";
export const MAP_PACKAGE_MANIFEST_FILENAME = "manifest.json";
export const MAP_PACKAGE_TILEJSON_FILENAME = "tilejson.json";
export const MAP_PACKAGE_TILES_PREFIX = "tiles/";
export const MAP_PACKAGE_LOGICAL_URL_PREFIX = "app://map-packages/";
export const MAP_PACKAGE_ARCHIVE_MAX_COMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
export const MAP_PACKAGE_ARCHIVE_MAX_ENTRY_BYTES = 128 * 1024 * 1024;
export const MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME = "runtime-tilejson.json";

export interface MapPackageArchiveBundle {
  manifest: MapPackageManifest;
  files: Record<string, Uint8Array>;
  originalManifestBytes?: Uint8Array;
}

export function parseMapPackageArchiveZip(data: Uint8Array): MapPackageArchiveBundle {
  if (data.byteLength > MAP_PACKAGE_ARCHIVE_MAX_COMPRESSED_BYTES) {
    throw new Error(`Map package archive compressed size exceeds ${MAP_PACKAGE_ARCHIVE_MAX_COMPRESSED_BYTES} bytes.`);
  }
  const unzipped = unzipSync(data, {
    filter: (file) => {
      validateMapPackageArchiveEntry(file.name, file.originalSize);
      return true;
    },
  });
  const manifestBytes = unzipped[MAP_PACKAGE_MANIFEST_FILENAME];
  if (!manifestBytes) throw new Error("Map package archive must contain manifest.json.");
  const manifest = validateMapPackageManifest(JSON.parse(strFromU8(manifestBytes)));
  const bundle = {
    manifest,
    originalManifestBytes: manifestBytes,
    files: Object.fromEntries(Object.entries(unzipped).filter(([filename]) => filename !== MAP_PACKAGE_MANIFEST_FILENAME)),
  };
  validateMapPackageArchiveBundle(bundle);
  return bundle;
}

/** Shared by ZIP admission and installed-file rehydration. No IO or metadata mutation. */
export function validateMapPackageArchiveBundle(bundle: MapPackageArchiveBundle): void {
  const manifest = validateMapPackageManifest(bundle.manifest);
  validateMapPackageLogicalUrls(manifest);
  if (manifest.packageType !== "raster_tiles" || manifest.tileContentType !== "raster") {
    throw new Error("Map package archive v1 imports generated raster tile packages only.");
  }
  if (manifest.imageryProvenance?.offlineCopyAllowed !== true) {
    throw new Error(manifest.imageryProvenance?.offlineCopyAllowed === false
      ? "Map package source policy does not allow offline copying or installation."
      : "Map package offline installation requires source provenance explicitly allowing offline copying.");
  }
  for (const [filename, bytes] of Object.entries(bundle.files)) validateMapPackageArchiveEntry(filename, bytes.byteLength);
  if ((manifest.tileUrlTemplates ?? []).length === 0 && !manifest.tileJsonUrl) {
    throw new Error("Map package archive requires tilejsonUrl or tileUrlTemplates.");
  }
  const tilePaths = Object.keys(bundle.files).filter((filename) => filename.startsWith(MAP_PACKAGE_TILES_PREFIX));
  if (tilePaths.length === 0) throw new Error("Map package archive must contain concrete tiles/{z}/{x}/{y}.png entries.");
  for (const filename of tilePaths) {
    const [, z, x, y] = /^tiles\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(filename)!;
    if ([z, x, y].some((coordinate) => String(+coordinate) !== coordinate)
      || +z < manifest.minZoom || +z > manifest.maxZoom || +x >= 2 ** +z || +y >= 2 ** +z || bundle.files[filename].byteLength === 0) {
      throw new Error(`Map package tile is empty or outside its declared zoom/XYZ range: ${filename}.`);
    }
  }
  const references = [...(manifest.tileUrlTemplates ?? []), ...tileJsonTemplates(bundle)];
  for (const reference of references) {
    const path = packageResourcePath(reference, manifest.id, reference.startsWith("app:") ? undefined : `${mapPackageLogicalUrlPrefix(manifest.id)}${MAP_PACKAGE_TILEJSON_FILENAME}`);
    if (!tilePaths.some((filename) => templateMatchesPath(path, filename))) {
      throw new Error(`Map package tile template references missing concrete resources: ${reference}.`);
    }
  }
}

export function mapPackageRuntimeUrl(logicalUrl: string, packageId: string, baseFileUri: string): string {
  const expectedPrefix = mapPackageLogicalUrlPrefix(packageId);
  if (!logicalUrl.startsWith(expectedPrefix)) throw new Error(`Map package URL must start with ${expectedPrefix}.`);
  const classification = classifyMapTileSourceUrl(baseFileUri);
  if (classification.kind !== "file" || baseFileUri.includes("?") || baseFileUri.includes("#")) {
    throw new Error("Map package installation requires a supported local file directory URI.");
  }
  const path = logicalUrl.slice(expectedPrefix.length);
  if (path) validateMapPackageArchivePath(path, true);
  return `${baseFileUri.endsWith("/") ? baseFileUri : `${baseFileUri}/`}${path}`;
}

export function rewriteMapPackageRuntimeUrls(manifest: MapPackageManifest, baseFileUri: string): MapPackageManifest {
  const parsed = validateMapPackageManifest(manifest);
  validateMapPackageLogicalUrls(parsed);
  return validateMapPackageManifest({
    ...parsed,
    uri: mapPackageRuntimeUrl(parsed.uri, parsed.id, baseFileUri),
    tileJsonUrl: parsed.tileJsonUrl ? mapPackageRuntimeUrl(parsed.tileJsonUrl, parsed.id, baseFileUri) : undefined,
    tileUrlTemplates: (parsed.tileUrlTemplates ?? []).map((template) => mapPackageRuntimeUrl(template, parsed.id, baseFileUri)),
  });
}

/** Derive runtime-only data; original manifest and TileJSON bytes remain unchanged. */
export function prepareMapPackageRuntimeBundle(bundle: MapPackageArchiveBundle, baseFileUri: string): MapPackageArchiveBundle {
  validateMapPackageArchiveBundle(bundle);
  const manifest = rewriteMapPackageRuntimeUrls(bundle.manifest, baseFileUri);
  const files = { ...bundle.files };
  if (bundle.manifest.tileJsonUrl) {
    const templates = tileJsonTemplates(bundle).map((reference) => {
      const path = packageResourcePath(reference, bundle.manifest.id, bundle.manifest.tileJsonUrl);
      return mapPackageRuntimeUrl(`${mapPackageLogicalUrlPrefix(bundle.manifest.id)}${path}`, bundle.manifest.id, baseFileUri);
    });
    const b = bundle.manifest.boundsWgs84;
    files[MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME] = strToU8(JSON.stringify({
      tilejson: "3.0.0", tiles: templates, minzoom: manifest.minZoom, maxzoom: manifest.maxZoom,
      scheme: manifest.tileScheme, bounds: [b.minLongitude, b.minLatitude, b.maxLongitude, b.maxLatitude],
      attribution: manifest.attribution,
    }));
    manifest.tileJsonUrl = mapPackageRuntimeUrl(`${mapPackageLogicalUrlPrefix(manifest.id)}${MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME}`, manifest.id, baseFileUri);
    manifest.tileUrlTemplates = templates;
  }
  return { manifest, files, originalManifestBytes: bundle.originalManifestBytes };
}

export function mapPackageManifestHasLogicalUrls(manifest: MapPackageManifest): boolean {
  const parsed = validateMapPackageManifest(manifest);
  return [parsed.uri, parsed.tileJsonUrl, ...(parsed.tileUrlTemplates ?? [])]
    .some((url) => typeof url === "string" && url.startsWith(mapPackageLogicalUrlPrefix(parsed.id)));
}

export function mapPackageLogicalUrlPrefix(packageId: string): string {
  if (!packageId || packageId === "." || packageId === ".." || /[\u0000-\u001f\u007f]/.test(packageId)) {
    throw new Error("Map package has an unsafe package identity.");
  }
  return `${MAP_PACKAGE_LOGICAL_URL_PREFIX}${encodeURIComponent(packageId)}/`;
}

function validateMapPackageLogicalUrls(manifest: MapPackageManifest): void {
  const expectedPrefix = mapPackageLogicalUrlPrefix(manifest.id);
  for (const url of [manifest.uri, manifest.tileJsonUrl, ...(manifest.tileUrlTemplates ?? [])].filter((url): url is string => typeof url === "string")) {
    if (!url.startsWith(expectedPrefix)) throw new Error(`Map package archive URLs must use ${expectedPrefix} logical app URLs.`);
    const path = url.slice(expectedPrefix.length);
    if (path) validateMapPackageArchivePath(path, true);
  }
  if (manifest.uri !== expectedPrefix || (manifest.tileJsonUrl && manifest.tileJsonUrl !== `${expectedPrefix}${MAP_PACKAGE_TILEJSON_FILENAME}`)) {
    throw new Error("Map package v1 requires the package root URI and tilejson.json at that root.");
  }
}

function tileJsonTemplates(bundle: MapPackageArchiveBundle): string[] {
  const bytes = bundle.files[MAP_PACKAGE_TILEJSON_FILENAME];
  if (!bytes && !bundle.manifest.tileJsonUrl) return [];
  if (!bytes) throw new Error("Map package manifest lists tilejson.json, but the archive does not contain it.");
  let json: unknown;
  try { json = JSON.parse(strFromU8(bytes)); } catch { throw new Error("Map package TileJSON must contain valid JSON."); }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Map package TileJSON must be an object.");
  const tileJson = json as Record<string, unknown>;
  validateTileJsonSourceMetadata(tileJson, bundle.manifest);
  if (!Array.isArray(tileJson.tiles) || tileJson.tiles.length === 0 || !tileJson.tiles.every((tile) => typeof tile === "string" && tile.length > 0)) {
    throw new Error("Map package TileJSON requires a nonempty tiles array of package-local templates.");
  }
  for (const field of ["grids", "data", "url", "urls", "source", "sources", "sprite", "glyphs"]) {
    if (tileJson[field] !== undefined && !(Array.isArray(tileJson[field]) && tileJson[field].length === 0)) {
      throw new Error(`Map package TileJSON contains unsupported resource references: ${field}.`);
    }
  }
  return tileJson.tiles as string[];
}

function validateTileJsonSourceMetadata(tileJson: Record<string, unknown>, manifest: MapPackageManifest): void {
  for (const [field, expected] of [["scheme", manifest.tileScheme], ["minzoom", manifest.minZoom], ["maxzoom", manifest.maxZoom], ["attribution", manifest.attribution]] as const) {
    if (tileJson[field] !== undefined && tileJson[field] !== expected) {
      throw new Error(`Map package TileJSON ${field} conflicts with its manifest; preserve the original package and regenerate consistent tile metadata before installation.`);
    }
  }
  if (tileJson.bounds !== undefined) {
    const b = manifest.boundsWgs84;
    const expected = [b.minLongitude, b.minLatitude, b.maxLongitude, b.maxLatitude];
    if (!Array.isArray(tileJson.bounds) || tileJson.bounds.length !== 4
      || !tileJson.bounds.every((coordinate, index) => coordinate === expected[index])) {
      throw new Error("Map package TileJSON bounds conflict with its manifest; preserve the original package and regenerate consistent tile metadata before installation.");
    }
  }
  // The current raster adapter configures 256-pixel PNG tiles. Other source types
  // or encodings need a separate adapter rather than a silently rewritten TileJSON.
  if ((tileJson.tileSize !== undefined && tileJson.tileSize !== 256)
    || (tileJson.format !== undefined && tileJson.format !== "png")
    || (tileJson.vector_layers !== undefined && !(Array.isArray(tileJson.vector_layers) && tileJson.vector_layers.length === 0))
    || tileJson.encoding !== undefined) {
    throw new Error("Map package TileJSON declares an unsupported raster size, format, vector layer or encoding; generated raster package v1 requires 256-pixel PNG source configuration.");
  }
}

function packageResourcePath(reference: string, packageId: string, resolutionBase?: string): string {
  const prefix = mapPackageLogicalUrlPrefix(packageId);
  if (classifyMapTileSourceUrl(reference, resolutionBase).kind !== "logical_package") {
    throw new Error(`Map package TileJSON references must resolve inside the admitted package: ${reference}.`);
  }
  let logical = reference;
  if (!reference.startsWith(prefix)) {
    if (!resolutionBase || /^[A-Za-z][A-Za-z\d+.-]*:/.test(reference) || reference.startsWith("/")) {
      throw new Error(`Map package TileJSON references must resolve inside the admitted package: ${reference}.`);
    }
    const relative = reference.startsWith("./") ? reference.slice(2) : reference;
    logical = `${prefix}${relative}`;
  }
  const path = logical.slice(prefix.length);
  validateMapPackageArchivePath(path, true);
  if (!path.startsWith(MAP_PACKAGE_TILES_PREFIX)) throw new Error(`Map package TileJSON must reference package tiles: ${reference}.`);
  return path;
}

function templateMatchesPath(template: string, concretePath: string): boolean {
  if (template === concretePath) return true;
  return template === "tiles/{z}/{x}/{y}.png" && /^tiles\/\d+\/\d+\/\d+\.png$/.test(concretePath);
}

function validateMapPackageArchiveEntry(filename: string, originalSize: number): void {
  validateMapPackageArchivePath(filename);
  if (filename !== MAP_PACKAGE_MANIFEST_FILENAME && filename !== MAP_PACKAGE_TILEJSON_FILENAME && !filename.startsWith(MAP_PACKAGE_TILES_PREFIX)) {
    throw new Error(`Map package archive contains unsupported file: ${filename}.`);
  }
  if (originalSize > MAP_PACKAGE_ARCHIVE_MAX_ENTRY_BYTES) {
    throw new Error(`Map package archive entry ${filename} exceeds ${MAP_PACKAGE_ARCHIVE_MAX_ENTRY_BYTES} uncompressed bytes.`);
  }
}

function validateMapPackageArchivePath(filename: string, allowTemplate = false): void {
  if (!filename || filename.length > 220) throw new Error(`Map package archive contains unsafe path length: ${filename}.`);
  if (filename.startsWith("/") || /[\\%:?#\u0000-\u0020\u007f]/.test(filename)
    || filename.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Map package archive contains unsafe path: ${filename}.`);
  }
  if (filename.startsWith(MAP_PACKAGE_TILES_PREFIX)
    && !/^tiles\/\d+\/\d+\/\d+\.png$/.test(filename)
    && !(allowTemplate && filename === "tiles/{z}/{x}/{y}.png")) {
    throw new Error(`Map package archive tile path requires concrete XYZ PNG tiles or a tiles/{z}/{x}/{y}.png reference: ${filename}.`);
  }
}
