import { strToU8, zipSync } from "fflate";
import { readZipTextArchive } from "./zipTextArchive";
import { z } from "zod";

import {
  DESIGN_DRAFT_DOCUMENT_VERSION,
  parseDesignDraftDocument,
  serializeDesignDraftDocument,
  type DesignDraft,
} from "@cplayout/core";

export const DESIGN_DRAFT_ARCHIVE_VERSION = "center-pivot-design-draft-archive-v1";
export const DESIGN_DRAFT_MANIFEST_FILENAME = "manifest.json";
export const DESIGN_DRAFT_JSON_FILENAME = "draft.json";
export const DESIGN_DRAFT_ARCHIVE_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES = 8 * 1024 * 1024;
export const DESIGN_DRAFT_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 12 * 1024 * 1024;
export const DESIGN_DRAFT_ARCHIVE_MAX_FILE_COUNT = 2;

const filenames = [DESIGN_DRAFT_MANIFEST_FILENAME, DESIGN_DRAFT_JSON_FILENAME] as const;
const ManifestSchema = z.object({
  archiveVersion: z.literal(DESIGN_DRAFT_ARCHIVE_VERSION),
  createdAt: z.iso.datetime({ offset: true }),
  draftId: z.string().min(1),
  draftName: z.string().min(1),
  projectCrs: z.string().min(1).nullable(),
  files: z.array(z.enum(filenames)).length(DESIGN_DRAFT_ARCHIVE_MAX_FILE_COUNT)
    .refine((files) => new Set(files).size === DESIGN_DRAFT_ARCHIVE_MAX_FILE_COUNT, "Duplicate manifest files."),
  offlineFirst: z.literal(true),
  paidServicesRequired: z.literal(false),
  draftDocumentVersion: z.literal(DESIGN_DRAFT_DOCUMENT_VERSION),
}).strict();
const FilesSchema = z.object({ "manifest.json": z.string(), "draft.json": z.string() }).strict();
const BundleSchema = z.object({ manifest: ManifestSchema, files: FilesSchema }).strict();

export type DesignDraftArchiveManifest = z.output<typeof ManifestSchema>;
export type DesignDraftArchiveBundle = z.output<typeof BundleSchema>;

/** Packages only supplied draft data; completion and calculation admission are separate. */
export function buildDesignDraftArchiveBundle(
  draft: DesignDraft,
  createdAt = new Date().toISOString(),
): DesignDraftArchiveBundle {
  const document = serializeDesignDraftDocument(draft);
  const validated = parseDesignDraftDocument(document);
  const manifest = ManifestSchema.parse({
    archiveVersion: DESIGN_DRAFT_ARCHIVE_VERSION,
    createdAt,
    draftId: validated.id,
    draftName: validated.name,
    projectCrs: validated.projectCrs,
    files: [...filenames],
    offlineFirst: true,
    paidServicesRequired: false,
    draftDocumentVersion: DESIGN_DRAFT_DOCUMENT_VERSION,
  });
  const bundle = {
    manifest,
    files: { "manifest.json": JSON.stringify(manifest, null, 2), "draft.json": document },
  };
  encodeFiles(bundle.files);
  return bundle;
}

/** Both manifest copies and the draft are validated before compression. */
export function exportDesignDraftArchiveZip(bundle: DesignDraftArchiveBundle): Uint8Array {
  const validated = BundleSchema.parse(bundle);
  const files = encodeFiles(validated.files);
  const manifest = ManifestSchema.parse(JSON.parse(validated.files[DESIGN_DRAFT_MANIFEST_FILENAME]));
  if (JSON.stringify(manifest) !== JSON.stringify(validated.manifest)) {
    throw new Error("Draft archive bundle manifest does not match manifest.json.");
  }
  validateDraftIdentity(manifest, validated.files[DESIGN_DRAFT_JSON_FILENAME]);
  const bytes = zipSync(files);
  validateCompressedSize(bytes.byteLength);
  return bytes;
}

/** Pure import preserves identity; the future atomic-create caller owns fresh identities. */
export function importDesignDraftArchiveZip(bytes: Uint8Array): DesignDraft {
  const extracted = readZipTextArchive(bytes, {
    label: "Draft archive", maxCompressedBytes: DESIGN_DRAFT_ARCHIVE_MAX_COMPRESSED_BYTES,
    maxEntryBytes: DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES, maxUncompressedBytes: DESIGN_DRAFT_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
    maxFileCount: DESIGN_DRAFT_ARCHIVE_MAX_FILE_COUNT, allowedFilenames: new Set(filenames), requiredFilenames: filenames,
  });
  const manifest = ManifestSchema.parse(JSON.parse(extracted.get(DESIGN_DRAFT_MANIFEST_FILENAME)!));
  return validateDraftIdentity(manifest, extracted.get(DESIGN_DRAFT_JSON_FILENAME)!);
}

function validateDraftIdentity(manifest: DesignDraftArchiveManifest, document: string): DesignDraft {
  const draft = parseDesignDraftDocument(document);
  for (const [key, actual] of [["draftId", draft.id], ["draftName", draft.name], ["projectCrs", draft.projectCrs]] as const) {
    if (manifest[key] !== actual) throw new Error(`Draft archive manifest ${key} does not match draft.json.`);
  }
  return draft;
}

function encodeFiles(files: DesignDraftArchiveBundle["files"]): Record<string, Uint8Array> {
  let total = 0;
  return Object.fromEntries(filenames.map((name) => {
    validateEntrySize(name, files[name].length);
    const bytes = strToU8(files[name]);
    validateEntrySize(name, bytes.byteLength);
    total += bytes.byteLength;
    validateTotalSize(total);
    return [name, bytes];
  }));
}

function validateCompressedSize(size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > DESIGN_DRAFT_ARCHIVE_MAX_COMPRESSED_BYTES) {
    throw new Error("Draft archive compressed size exceeds budget.");
  }
}

function validateEntrySize(name: string, size: number): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES) {
    throw new Error(`Draft archive entry ${name} exceeds uncompressed size budget.`);
  }
}

function validateTotalSize(size: number): void {
  if (size > DESIGN_DRAFT_ARCHIVE_MAX_UNCOMPRESSED_BYTES) throw new Error("Draft archive uncompressed size exceeds budget.");
}
