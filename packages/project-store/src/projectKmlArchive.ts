import { strToU8, zipSync } from "fflate";
import { readZipArchive } from "./zipArchive";
import { decodeUtf8Strict } from "./utf8";

export const GOOGLE_EARTH_KMZ_DOC_FILENAME = "doc.kml";
export const GOOGLE_EARTH_KMZ_MAX_BYTES = 25 * 1024 * 1024;
export const GOOGLE_EARTH_KMZ_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const GOOGLE_EARTH_KMZ_MAX_FILE_COUNT = 256;

export interface PickedGoogleEarthFile {
  filename: string;
  bytes: Uint8Array;
  mimeType?: string;
}

export interface GoogleEarthKmlFile {
  filename: string;
  kmlText: string;
  kind: "kml" | "kmz";
  warnings: string[];
}

export function createGoogleEarthKmz(kmlText: string): Uint8Array {
  return zipSync({ [GOOGLE_EARTH_KMZ_DOC_FILENAME]: strToU8(kmlText) }, { mtime: new Date(Date.now()) });
}

export function extractKmlFromKmz(data: Uint8Array): string {
  return readKmz(data).kmlText;
}

function readKmz(data: Uint8Array): { path: string; kmlText: string } {
  if (data.byteLength > GOOGLE_EARTH_KMZ_MAX_BYTES) {
    throw new Error("KMZ import is larger than the supported 25 MB limit.");
  }
  const files = readZipArchive(data, {
    label: "KMZ import", maxCompressedBytes: GOOGLE_EARTH_KMZ_MAX_BYTES,
    maxEntryBytes: GOOGLE_EARTH_KMZ_MAX_BYTES, maxUncompressedBytes: GOOGLE_EARTH_KMZ_MAX_UNCOMPRESSED_BYTES,
    maxFileCount: GOOGLE_EARTH_KMZ_MAX_FILE_COUNT, allowDirectories: true,
    validateEntries(names) {
      const paths = names.filter(isKmlPath);
      if (paths.length === 0) throw new Error("KMZ import must contain a KML file.");
      if (paths.length > 1) throw new Error("KMZ import must contain exactly one KML file for this CPLayout workflow.");
    },
    retainEntry: isKmlPath,
  });
  const [path, bytes] = [...files][0];
  return { path, kmlText: decodeKml(bytes) };
}

export function readGoogleEarthKmlFile(file: PickedGoogleEarthFile): GoogleEarthKmlFile {
  if (file.bytes.byteLength > GOOGLE_EARTH_KMZ_MAX_BYTES) {
    throw new Error("KML/KMZ import is larger than the supported 25 MB limit.");
  }
  const filename = file.filename || "selected-google-earth-file";
  if (isKmzFile(filename, file.mimeType, file.bytes)) {
    const content = readKmz(file.bytes);
    return {
      filename,
      kmlText: content.kmlText,
      kind: "kmz",
      warnings: content.path === GOOGLE_EARTH_KMZ_DOC_FILENAME ? [] : [`KMZ used ${content.path}; exported CPLayout KMZ files use top-level doc.kml for Google Earth compatibility.`],
    };
  }
  return {
    filename,
    kmlText: decodeKml(file.bytes),
    kind: "kml",
    warnings: [],
  };
}

function isKmlPath(path: string): boolean {
  return path.toLowerCase().endsWith(".kml");
}

function decodeKml(bytes: Uint8Array): string {
  const text = decodeUtf8Strict(bytes, "KML import").replace(/^\ufeff/, "");
  const declaration = /^<\?xml\s[^?]*\?>/.exec(text)?.[0];
  const encoding = declaration && /\bencoding\s*=\s*(["'])([^"']+)\1/.exec(declaration)?.[2];
  if (encoding && encoding.toLowerCase() !== "utf-8") throw new Error("KML import supports UTF-8 encoding; export this file as UTF-8 before importing.");
  return text;
}

function isKmzFile(filename: string, mimeType: string | undefined, bytes: Uint8Array): boolean {
  const lowerFilename = filename.toLowerCase();
  const lowerMime = (mimeType ?? "").toLowerCase();
  return lowerFilename.endsWith(".kmz")
    || lowerMime.includes("kmz")
    || lowerMime.includes("google-earth.kmz")
    || (bytes[0] === 0x50 && bytes[1] === 0x4b);
}
