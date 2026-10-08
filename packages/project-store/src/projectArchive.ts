import { strToU8, zipSync } from "fflate";
import { readZipTextArchive } from "./zipTextArchive";
import { parseEditableProjectDocument } from "./projectDocumentEditing";
import { parseStrictJson } from "./strictJson";
import { z } from "zod";

import {
  exportProjectGoogleEarthKml,
  exportProjectMapXml,
  LEGACY_PROJECT_DOCUMENT_VERSION,
  PROJECT_DOCUMENT_VERSIONS,
  serializeProjectDocument,
  sha256Text,
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

/** Saved design identity and local edit revision are separate output labels. */
export interface ProjectArchiveOutputContext {
  designId: string | null;
  designRevision: number | null;
  editRevision: number;
  includesUnsavedEdits: boolean;
}

export interface ProjectArchiveSource extends ProjectArchiveOutputContext {
  machineId: string;
  canonicalSnapshotSha256: string;
}

export interface ProjectArchiveManifest {
  archiveVersion: typeof PROJECT_ARCHIVE_VERSION;
  createdAt: string;
  projectId: string;
  projectName: string;
  projectCrs: string;
  files: string[];
  offlineFirst: true;
  paidServicesRequired: false;
  projectDocumentVersion: typeof PROJECT_DOCUMENT_VERSIONS[number];
  source?: ProjectArchiveSource;
  notes?: string[];
}

export interface ProjectArchiveBundle {
  manifest: ProjectArchiveManifest;
  files: Record<string, string>;
}

const ProjectArchiveOutputContextSchema = z.object({
  designId: z.string().min(1).nullable(),
  designRevision: z.number().int().nonnegative().nullable(),
  editRevision: z.number().int().nonnegative(),
  includesUnsavedEdits: z.boolean(),
}).strict();
const ProjectArchiveSourceSchema = ProjectArchiveOutputContextSchema.extend({
  machineId: z.string().min(1),
  canonicalSnapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
});
const ProjectArchiveManifestSchema = z.object({
  archiveVersion: z.literal(PROJECT_ARCHIVE_VERSION),
  createdAt: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
  projectCrs: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
  offlineFirst: z.literal(true),
  paidServicesRequired: z.literal(false),
  projectDocumentVersion: z.enum(PROJECT_DOCUMENT_VERSIONS),
  source: ProjectArchiveSourceSchema.optional(),
  notes: z.array(z.string().min(1)).optional(),
});

/** A recovery package needs neither calculated metrics nor a WGS84 transform. */
export function buildProjectRecoveryArchiveBundle(
  project: PivotProject,
  createdAt = new Date().toISOString(),
  outputContext?: ProjectArchiveOutputContext,
): ProjectArchiveBundle {
  return canonicalProjectArchive(project, serializeProjectDocument(project), createdAt, outputContext);
}

function canonicalProjectArchive(
  project: PivotProject,
  document: string,
  createdAt: string,
  outputContext?: ProjectArchiveOutputContext,
): ProjectArchiveBundle {
  const manifest: ProjectArchiveManifest = {
    archiveVersion: PROJECT_ARCHIVE_VERSION,
    createdAt,
    projectId: project.id,
    projectName: project.name,
    projectCrs: project.projectCrs,
    files: [PROJECT_MANIFEST_FILENAME, PROJECT_JSON_FILENAME],
    offlineFirst: true,
    paidServicesRequired: false,
    projectDocumentVersion: projectDocumentVersion(document),
    ...(outputContext === undefined ? {} : { source: archiveSource(project, document, outputContext) }),
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
  outputContext?: ProjectArchiveOutputContext,
): ProjectArchiveBundle {
  const document = serializeProjectDocument(project);
  // Exchange companions cannot retain classified drawing metadata or operational
  // evidence. Keep the exact canonical document instead of stripping those fields
  // or failing the very ZIP export recommended by the exchange-format refusal.
  if (projectDocumentVersion(document) !== LEGACY_PROJECT_DOCUMENT_VERSION) {
    const bundle = canonicalProjectArchive(project, document, createdAt, outputContext);
    bundle.manifest.notes = [
      "Canonical project.json retains all geometry, drawing metadata, and recorded evidence. Reopen this ZIP in CPLayout.",
      "GIS, KML, XML, and CSV exchange companions are omitted because they cannot retain this document's full metadata and evidence. No calculated companion files are included.",
    ];
    bundle.files[PROJECT_MANIFEST_FILENAME] = JSON.stringify(bundle.manifest, null, 2);
    return bundle;
  }
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
    projectDocumentVersion: projectDocumentVersion(document),
    ...(outputContext === undefined ? {} : { source: archiveSource(project, document, outputContext) }),
  };

  return {
    manifest,
    files: {
      [PROJECT_MANIFEST_FILENAME]: JSON.stringify(manifest, null, 2),
      [PROJECT_JSON_FILENAME]: document,
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
  // fflate otherwise reads the clock independently for local and central headers.
  return zipSync(files, { mtime: new Date(Date.now()) });
}

export function importProjectArchiveZip(data: Uint8Array): PivotProject {
  const files = readZipTextArchive(data, {
    label: "Project archive", maxCompressedBytes: PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES,
    maxEntryBytes: PROJECT_ARCHIVE_MAX_ENTRY_BYTES, maxUncompressedBytes: PROJECT_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
    maxFileCount: PROJECT_ARCHIVE_MAX_FILE_COUNT,
    allowedFilenames: new Set([...PROJECT_ARCHIVE_ALLOWED_FILENAMES, ...LEGACY_PROJECT_ARCHIVE_IGNORED_FILENAMES]),
    requiredFilenames: [PROJECT_MANIFEST_FILENAME, PROJECT_JSON_FILENAME],
  });
  const manifest = ProjectArchiveManifestSchema.parse(parseStrictJson(files.get(PROJECT_MANIFEST_FILENAME)!));
  for (const requiredFile of [PROJECT_MANIFEST_FILENAME, PROJECT_JSON_FILENAME]) {
    if (!manifest.files.includes(requiredFile)) throw new Error(`Project archive manifest must list ${requiredFile}.`);
  }
  validateProjectArchiveManifestFiles(manifest, [...files.keys()]);
  const document = files.get(PROJECT_JSON_FILENAME)!;
  const project = parseEditableProjectDocument(document);
  if (manifest.projectDocumentVersion !== projectDocumentVersion(document)) throw new Error("Project archive manifest version does not match project.json.");
  if (manifest.projectId !== project.id) throw new Error("Project archive manifest projectId does not match project.json.");
  if (manifest.projectCrs !== project.projectCrs) throw new Error("Project archive manifest projectCrs does not match project.json.");
  if (manifest.source?.machineId !== undefined && manifest.source.machineId !== project.machine.id) {
    throw new Error("Project archive manifest source machineId does not match project.json.");
  }
  if (manifest.source && manifest.source.canonicalSnapshotSha256 !== sha256Text(document)) {
    throw new Error("Project archive manifest source snapshot hash does not match project.json.");
  }
  return project;
}

function archiveSource(project: PivotProject, document: string, context: ProjectArchiveOutputContext): ProjectArchiveSource {
  return { ...ProjectArchiveOutputContextSchema.parse(context), machineId: project.machine.id, canonicalSnapshotSha256: sha256Text(document) };
}

function projectDocumentVersion(document: string): typeof PROJECT_DOCUMENT_VERSIONS[number] {
  const raw = parseStrictJson(document);
  if (raw !== null && typeof raw === "object" && "documentVersion" in raw) {
    return z.enum(PROJECT_DOCUMENT_VERSIONS).parse(raw.documentVersion);
  }
  return LEGACY_PROJECT_DOCUMENT_VERSION;
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
