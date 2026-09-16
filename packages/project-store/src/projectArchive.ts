import { strToU8, zipSync } from "fflate";
import { readZipTextArchive } from "./zipTextArchive";
import { z } from "zod";

import {
  exportProjectGoogleEarthKml,
  exportProjectMapXml,
  parseProjectDocument,
  PROJECT_DOCUMENT_VERSION,
  serializeProjectDocument,
} from "@cplayout/core";
import type {
  LayoutResult,
  PivotProject,
  SurveyPoint,
} from "@cplayout/core";

export const PROJECT_ARCHIVE_VERSION = "center-pivot-project-archive-v1";
export const PROJECT_JSON_FILENAME = "project.json";
export const PROJECT_MANIFEST_FILENAME = "manifest.json";
export const PROJECT_GEOJSON_FILENAME = "exports/scenario.geojson";
export const PROJECT_GOOGLE_EARTH_KML_FILENAME = "exports/google-earth.kml";
export const PROJECT_MAP_XML_FILENAME = "exports/map-data.xml";
export const SURVEY_CSV_FILENAME = "exports/survey-points.csv";
export const METRICS_CSV_FILENAME = "exports/scenario-metrics.csv";
export const MAP_PACKAGES_CSV_FILENAME = "exports/map-packages.csv";
export const PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
export const PROJECT_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
export const PROJECT_ARCHIVE_MAX_ENTRY_BYTES = 50 * 1024 * 1024;
export const PROJECT_ARCHIVE_MAX_FILE_COUNT = 16;

export interface ProjectArchiveManifest {
  archiveVersion: typeof PROJECT_ARCHIVE_VERSION;
  createdAt: string;
  projectId: string;
  projectName: string;
  projectCrs: string;
  files: string[];
  offlineFirst: true;
  paidServicesRequired: false;
  projectDocumentVersion: typeof PROJECT_DOCUMENT_VERSION;
}

export interface ProjectArchiveBundle {
  manifest: ProjectArchiveManifest;
  files: Record<string, string>;
}

const ProjectArchiveManifestSchema = z.object({
  archiveVersion: z.literal(PROJECT_ARCHIVE_VERSION),
  createdAt: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  projectCrs: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
  offlineFirst: z.literal(true),
  paidServicesRequired: z.literal(false),
  projectDocumentVersion: z.literal(PROJECT_DOCUMENT_VERSION),
});

/** A recovery package needs neither calculated metrics nor a WGS84 transform. */
export function buildProjectRecoveryArchiveBundle(
  project: PivotProject,
  createdAt = new Date().toISOString(),
): ProjectArchiveBundle {
  const document = serializeProjectDocument(project);
  const manifest: ProjectArchiveManifest = {
    archiveVersion: PROJECT_ARCHIVE_VERSION,
    createdAt,
    projectId: project.id,
    projectName: project.name,
    projectCrs: project.projectCrs,
    files: [PROJECT_MANIFEST_FILENAME, PROJECT_JSON_FILENAME],
    offlineFirst: true,
    paidServicesRequired: false,
    projectDocumentVersion: PROJECT_DOCUMENT_VERSION,
  };
  return {
    manifest,
    files: {
      [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest, null, 2),
      [PROJECT_JSON_FILENAME]: document,
    },
  };
}

export function buildProjectArchiveBundle(
  project: PivotProject,
  result: LayoutResult,
  geoJson: object,
  createdAt = new Date().toISOString(),
): ProjectArchiveBundle {
  const manifest: ProjectArchiveManifest = {
    archiveVersion: PROJECT_ARCHIVE_VERSION,
    createdAt,
    projectId: project.id,
    projectName: project.name,
    projectCrs: project.projectCrs,
    files: [
      PROJECT_MANIFEST_FILENAME,
      PROJECT_JSON_FILENAME,
      PROJECT_GEOJSON_FILENAME,
      PROJECT_GOOGLE_EARTH_KML_FILENAME,
      PROJECT_MAP_XML_FILENAME,
      SURVEY_CSV_FILENAME,
      METRICS_CSV_FILENAME,
      MAP_PACKAGES_CSV_FILENAME,
    ],
    offlineFirst: true,
    paidServicesRequired: false,
    projectDocumentVersion: PROJECT_DOCUMENT_VERSION,
  };

  return {
    manifest,
    files: {
      [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest, null, 2),
      [PROJECT_JSON_FILENAME]: serializeProjectDocument(project),
      [PROJECT_GEOJSON_FILENAME]: JSON.stringify(geoJson, null, 2),
      [PROJECT_GOOGLE_EARTH_KML_FILENAME]: exportProjectGoogleEarthKml(project, result).kml,
      [PROJECT_MAP_XML_FILENAME]: exportProjectMapXml(project),
      [SURVEY_CSV_FILENAME]: surveyPointsToCsv(project.surveyPoints),
      [METRICS_CSV_FILENAME]: metricsToCsv(result),
      [MAP_PACKAGES_CSV_FILENAME]: mapPackagesToCsv(project),
    },
  };
}

export function exportProjectArchiveZip(bundle: ProjectArchiveBundle): Uint8Array {
  const files = Object.fromEntries(
    Object.entries(bundle.files).map(([path, contents]) => [path, strToU8(contents)]),
  );
  return zipSync(files);
}

export function importProjectArchiveZip(data: Uint8Array): PivotProject {
  const files = readZipTextArchive(data, {
    label: "Project archive", maxCompressedBytes: PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES,
    maxEntryBytes: PROJECT_ARCHIVE_MAX_ENTRY_BYTES, maxUncompressedBytes: PROJECT_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
    maxFileCount: PROJECT_ARCHIVE_MAX_FILE_COUNT,
    allowedFilenames: new Set([...PROJECT_ARCHIVE_ALLOWED_FILENAMES, ...LEGACY_PROJECT_ARCHIVE_IGNORED_FILENAMES]),
    requiredFilenames: [PROJECT_MANIFEST_FILENAME, PROJECT_JSON_FILENAME],
  });
  const manifest = ProjectArchiveManifestSchema.parse(JSON.parse(files.get(PROJECT_MANIFEST_FILENAME)!));
  for (const requiredFile of [PROJECT_MANIFEST_FILENAME, PROJECT_JSON_FILENAME]) {
    if (!manifest.files.includes(requiredFile)) throw new Error(`Project archive manifest must list ${requiredFile}.`);
  }
  validateProjectArchiveManifestFiles(manifest, [...files.keys()]);
  const project = parseProjectDocument(files.get(PROJECT_JSON_FILENAME)!);
  if (manifest.projectId !== project.id) throw new Error("Project archive manifest projectId does not match project.json.");
  if (manifest.projectCrs !== project.projectCrs) throw new Error("Project archive manifest projectCrs does not match project.json.");
  return project;
}

export function surveyPointsToCsv(points: SurveyPoint[]): string {
  const rows = [
    ["id", "label", "role", "x", "y", "longitude", "latitude", "observedAt", "source", "confidence", "notes"],
    ...points.map((point) => [
      point.id,
      point.label,
      point.role,
      point.projected.x,
      point.projected.y,
      point.wgs84?.longitude ?? "",
      point.wgs84?.latitude ?? "",
      point.observedAt,
      point.source,
      point.confidence,
      point.notes ?? "",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function metricsToCsv(result: LayoutResult): string {
  const rows = [
    ["metric", "value"],
    ...Object.entries(result.metrics).map(([metric, value]) => [metric, value]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function mapPackagesToCsv(project: PivotProject): string {
  const rows = [
    [
      "id",
      "name",
      "packageType",
      "tileContentType",
      "uri",
      "minZoom",
      "maxZoom",
      "tileScheme",
      "minLongitude",
      "minLatitude",
      "maxLongitude",
      "maxLatitude",
      "tileJsonUrl",
      "tileUrlTemplates",
      "vectorOverlay",
      "imageryProvenance",
      "checksumSha256",
      "installStatus",
      "attribution",
      "licenseText",
      "bytes",
      "importedAt",
    ],
    ...(project.mapPackages ?? []).map((mapPackage) => [
      mapPackage.id,
      mapPackage.name,
      mapPackage.packageType,
      mapPackage.tileContentType,
      mapPackage.uri,
      mapPackage.minZoom,
      mapPackage.maxZoom,
      mapPackage.tileScheme,
      mapPackage.boundsWgs84.minLongitude,
      mapPackage.boundsWgs84.minLatitude,
      mapPackage.boundsWgs84.maxLongitude,
      mapPackage.boundsWgs84.maxLatitude,
      mapPackage.tileJsonUrl ?? "",
      (mapPackage.tileUrlTemplates ?? []).join(" "),
      mapPackage.vectorOverlay ? JSON.stringify(mapPackage.vectorOverlay) : "",
      mapPackage.imageryProvenance ? JSON.stringify(mapPackage.imageryProvenance) : "",
      mapPackage.checksumSha256 ?? "",
      mapPackage.installStatus ?? "metadata_only",
      mapPackage.attribution,
      mapPackage.licenseText,
      mapPackage.bytes ?? "",
      mapPackage.importedAt,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function csvCell(value: unknown): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

const PROJECT_ARCHIVE_ALLOWED_FILENAMES = new Set([
  PROJECT_MANIFEST_FILENAME,
  PROJECT_JSON_FILENAME,
  PROJECT_GEOJSON_FILENAME,
  PROJECT_GOOGLE_EARTH_KML_FILENAME,
  PROJECT_MAP_XML_FILENAME,
  SURVEY_CSV_FILENAME,
  METRICS_CSV_FILENAME,
  MAP_PACKAGES_CSV_FILENAME,
]);

const LEGACY_PROJECT_ARCHIVE_IGNORED_FILENAMES = new Set([
  "exports/layout-evidence.jsonl",
  "exports/layout-decisions.jsonl",
  "exports/model-recommendations.geojson",
]);

function validateProjectArchiveManifestFiles(manifest: ProjectArchiveManifest, archiveFilenames: string[]): void {
  const manifestFiles = new Set(manifest.files);
  const archiveFiles = new Set(archiveFilenames);
  for (const filename of manifest.files) {
    validateProjectArchivePath(filename);
    if (LEGACY_PROJECT_ARCHIVE_IGNORED_FILENAMES.has(filename)) continue;
    if (!PROJECT_ARCHIVE_ALLOWED_FILENAMES.has(filename)) {
      throw new Error(`Project archive manifest lists unsupported file: ${filename}.`);
    }
    if (!archiveFiles.has(filename)) {
      throw new Error(`Project archive manifest lists ${filename}, but the archive does not contain it.`);
    }
  }
  for (const filename of archiveFilenames) {
    if (LEGACY_PROJECT_ARCHIVE_IGNORED_FILENAMES.has(filename)) continue;
    if (!manifestFiles.has(filename)) {
      throw new Error(`Project archive contains ${filename}, but manifest.json does not list it.`);
    }
  }
}

function validateProjectArchivePath(filename: string): void {
  if (filename.length === 0 || filename.length > 180) {
    throw new Error(`Project archive contains unsafe path length: ${filename}.`);
  }
  if (filename.startsWith("/") || filename.startsWith("\\") || /^[A-Za-z]:/.test(filename) || filename.includes("\\")) {
    throw new Error(`Project archive contains unsafe path: ${filename}.`);
  }
  const parts = filename.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new Error(`Project archive contains unsafe path: ${filename}.`);
  }
}
