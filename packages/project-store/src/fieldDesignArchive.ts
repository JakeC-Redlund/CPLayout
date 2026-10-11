import { strToU8, zipSync } from "fflate";
import { readZipTextArchive } from "./zipTextArchive";
import { parseStrictJson } from "./strictJson";
import { z } from "zod";

import {
  FIELD_DESIGN_DOCUMENT_VERSIONS,
  parseFieldDesignDocument,
  serializeFieldDesignDocument,
  type FieldDesign, parseProjectDocument, PROJECT_DOCUMENT_VERSIONS,
} from "@cplayout/core";

export const FIELD_DESIGN_ARCHIVE_VERSION = "center-pivot-field-design-archive-v1";
export const FIELD_DESIGN_MANIFEST_FILENAME = "manifest.json";
export const FIELD_DESIGN_JSON_FILENAME = "field.json";
export const FIELD_DESIGN_ARCHIVE_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const FIELD_DESIGN_ARCHIVE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;
export const FIELD_DESIGN_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 12 * 1024 * 1024;
export const FIELD_DESIGN_ARCHIVE_MAX_FILE_COUNT = 3;
export const FIELD_DESIGN_ORIGINAL_PROJECT_FILENAME = "original-project.json";

const filenames = [FIELD_DESIGN_MANIFEST_FILENAME, FIELD_DESIGN_JSON_FILENAME, FIELD_DESIGN_ORIGINAL_PROJECT_FILENAME] as const;
const DocumentVersionSchema = z.object({ documentVersion: z.enum(FIELD_DESIGN_DOCUMENT_VERSIONS) });
const ManifestSchema = z.object({
  archiveVersion: z.literal(FIELD_DESIGN_ARCHIVE_VERSION),
  createdAt: z.iso.datetime({ offset: true }),
  fieldId: z.string().min(1),
  fieldName: z.string().min(1),
  projectCrs: z.string().min(1).nullable(),
  files: z.array(z.enum(filenames)).min(2).max(FIELD_DESIGN_ARCHIVE_MAX_FILE_COUNT)
    .refine(files => new Set(files).size === files.length && files.includes("manifest.json") && files.includes("field.json"), "Missing or duplicate manifest files."),
  offlineFirst: z.literal(true),
  paidServicesRequired: z.literal(false),
  fieldDocumentVersion: z.enum(FIELD_DESIGN_DOCUMENT_VERSIONS),
}).strict();
const FilesSchema = z.object({ "manifest.json": z.string(), "field.json": z.string(), "original-project.json": z.string().optional() }).strict();
const BundleSchema = z.object({ manifest: ManifestSchema, files: FilesSchema }).strict();

export type FieldDesignArchiveManifest = z.output<typeof ManifestSchema>;
export type FieldDesignArchiveBundle = z.output<typeof BundleSchema>;

/** Packages only supplied field data; completion and calculation admission are separate. */
export function buildFieldDesignArchiveBundle(
  field: FieldDesign,
  createdAt = new Date().toISOString(),
  originalProjectDocument?: string,
): FieldDesignArchiveBundle {
  const document = serializeFieldDesignDocument(field);
  const envelope = parseStrictJson(document);
  const validated = parseFieldDesignDocument(envelope);
  const manifest = ManifestSchema.parse({
    archiveVersion: FIELD_DESIGN_ARCHIVE_VERSION,
    createdAt,
    fieldId: validated.id,
    fieldName: validated.name,
    projectCrs: validated.projectCrs,
    files: originalProjectDocument === undefined ? filenames.slice(0, 2) : [...filenames],
    offlineFirst: true,
    paidServicesRequired: false,
    fieldDocumentVersion: DocumentVersionSchema.parse(envelope).documentVersion,
  });
  const bundle = {
    manifest,
    files: { "manifest.json": JSON.stringify(manifest, null, 2), "field.json": document,
      ...(originalProjectDocument === undefined ? {} : { "original-project.json": originalProjectDocument }) },
  };
  validateOriginalProject(bundle.files[FIELD_DESIGN_ORIGINAL_PROJECT_FILENAME]);
  encodeFiles(bundle.files);
  return bundle;
}

/** Both manifest copies and the field are validated before compression. */
export function exportFieldDesignArchiveZip(bundle: FieldDesignArchiveBundle): Uint8Array {
  const validated = BundleSchema.parse(bundle);
  const files = encodeFiles(validated.files);
  const manifest = ManifestSchema.parse(parseStrictJson(validated.files[FIELD_DESIGN_MANIFEST_FILENAME]));
  if (JSON.stringify(manifest) !== JSON.stringify(validated.manifest)) {
    throw new Error("Field archive bundle manifest does not match manifest.json.");
  }
  validateFieldIdentity(manifest, validated.files[FIELD_DESIGN_JSON_FILENAME]);
  validateOriginalProject(validated.files[FIELD_DESIGN_ORIGINAL_PROJECT_FILENAME]);
  if (JSON.stringify(Object.keys(files).sort()) !== JSON.stringify([...manifest.files].sort())) throw new Error("Field archive manifest file set differs from archive entries.");
  const bytes = zipSync(files, { mtime: new Date(Date.now()) });
  validateCompressedSize(bytes.byteLength);
  return bytes;
}

/** Pure import preserves identity; the future atomic-create caller owns fresh identities. */
export interface FieldDesignArchiveContents { field: FieldDesign; originalProjectDocument?: string }

export function importFieldDesignArchiveZip(bytes: Uint8Array): FieldDesignArchiveContents {
  const extracted = readZipTextArchive(bytes, {
    label: "Field archive", maxCompressedBytes: FIELD_DESIGN_ARCHIVE_MAX_COMPRESSED_BYTES,
    maxEntryBytes: FIELD_DESIGN_ARCHIVE_MAX_ENTRY_BYTES, maxUncompressedBytes: FIELD_DESIGN_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
    maxFileCount: FIELD_DESIGN_ARCHIVE_MAX_FILE_COUNT, allowedFilenames: new Set(filenames), requiredFilenames: filenames.slice(0, 2),
  });
  const manifest = ManifestSchema.parse(parseStrictJson(extracted.get(FIELD_DESIGN_MANIFEST_FILENAME)!));
  if (JSON.stringify([...extracted.keys()].sort()) !== JSON.stringify([...manifest.files].sort())) throw new Error("Field archive manifest file set differs from archive entries.");
  const originalProjectDocument = extracted.get(FIELD_DESIGN_ORIGINAL_PROJECT_FILENAME);
  validateOriginalProject(originalProjectDocument);
  return { field: validateFieldIdentity(manifest, extracted.get(FIELD_DESIGN_JSON_FILENAME)!),
    ...(originalProjectDocument === undefined ? {} : { originalProjectDocument }) };
}

function validateFieldIdentity(manifest: FieldDesignArchiveManifest, document: string): FieldDesign {
  const envelope = parseStrictJson(document);
  const field = parseFieldDesignDocument(envelope);
  if (manifest.fieldDocumentVersion !== DocumentVersionSchema.parse(envelope).documentVersion) {
    throw new Error("Field archive manifest fieldDocumentVersion does not match field.json.");
  }
  for (const [key, actual] of [["fieldId", field.id], ["fieldName", field.name], ["projectCrs", field.projectCrs]] as const) {
    if (manifest[key] !== actual) throw new Error(`Field archive manifest ${key} does not match field.json.`);
  }
  return field;
}

function encodeFiles(files: FieldDesignArchiveBundle["files"]): Record<string, Uint8Array> {
  let total = 0;
  return Object.fromEntries(filenames.filter(name => files[name] !== undefined).map((name) => {
    validateEntrySize(name, files[name]!.length);
    const bytes = strToU8(files[name]!);
    validateEntrySize(name, bytes.byteLength);
    total += bytes.byteLength;
    validateTotalSize(total);
    return [name, bytes];
  }));
}

function validateCompressedSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > FIELD_DESIGN_ARCHIVE_MAX_COMPRESSED_BYTES) {
    throw new Error("Field archive compressed size exceeds budget.");
  }
}

function validateEntrySize(name: string, size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > FIELD_DESIGN_ARCHIVE_MAX_ENTRY_BYTES) {
    throw new Error(`Field archive entry ${name} exceeds uncompressed size budget.`);
  }
}

function validateTotalSize(size: number): void {
  if (size > FIELD_DESIGN_ARCHIVE_MAX_UNCOMPRESSED_BYTES) throw new Error("Field archive uncompressed size exceeds budget.");
}

function validateOriginalProject(document: string | undefined): void {
  if (document === undefined) return;
  const value = parseStrictJson(document);
  if (value !== null && typeof value === "object" && "documentVersion" in value
    && !(PROJECT_DOCUMENT_VERSIONS as readonly unknown[]).includes(value.documentVersion)) throw new Error("Unsupported original project version.");
  parseProjectDocument(value);
}
