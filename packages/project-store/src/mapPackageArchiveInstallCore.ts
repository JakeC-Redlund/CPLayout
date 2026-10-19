import { strToU8 } from "fflate";
import type { MapPackageManifest } from "@cplayout/core";

import { MAP_PACKAGE_MANIFEST_FILENAME, parseMapPackageArchiveZip, prepareMapPackageRuntimeBundle } from "./mapPackageArchive";

/** Synchronous adapter keeps admission and rollback testable without an Expo runtime. */
export interface MapPackageArchiveStorage {
  directoryUri(name: string): string;
  exists(name: string): boolean;
  writeFiles(name: string, files: Record<string, Uint8Array>): void;
  moveDirectory(from: string, to: string): void;
  removeDirectory(name: string): void;
}

export interface InstalledMapPackageArchiveResult {
  manifest: MapPackageManifest;
  runtimeManifest: MapPackageManifest;
  packageDirectoryUri: string;
  fileCount: number;
}

export function installMapPackageArchiveWithStorage(
  data: Uint8Array,
  storage: MapPackageArchiveStorage,
  transactionId: string,
): InstalledMapPackageArchiveResult {
  // Parse the complete resource graph and source policy before any storage operation.
  const parsed = parseMapPackageArchiveZip(data);
  if (!/^[A-Za-z0-9-]+$/.test(transactionId)) throw new Error("Map package installation transaction identity is unsafe.");
  const name = encodeURIComponent(parsed.manifest.id);
  const pending = `.${name}.pending-${transactionId}`;
  const backup = `.${name}.previous-${transactionId}`;
  if (storage.exists(pending) || storage.exists(backup)) throw new Error("Map package installation transaction already exists.");
  const packageDirectoryUri = storage.directoryUri(name);
  const runtime = prepareMapPackageRuntimeBundle(parsed, packageDirectoryUri);
  let backedUp = false;
  try {
    storage.writeFiles(pending, {
      ...runtime.files,
      [MAP_PACKAGE_MANIFEST_FILENAME]: parsed.originalManifestBytes ?? strToU8(JSON.stringify(parsed.manifest)),
    });
    if (storage.exists(name)) {
      storage.moveDirectory(name, backup);
      backedUp = true;
    }
    storage.moveDirectory(pending, name);
  } catch (error) {
    // A failed promotion must not replace the preceding complete installation.
    // Keep recovery files if cleanup/restoration itself fails.
    if (backedUp && !storage.exists(name)) storage.moveDirectory(backup, name);
    if (storage.exists(pending)) storage.removeDirectory(pending);
    throw error;
  }
  // Keep a replaced edition outside the active directory as recovery evidence.
  return { manifest: parsed.manifest, runtimeManifest: runtime.manifest, packageDirectoryUri, fileCount: Object.keys(parsed.files).length };
}
