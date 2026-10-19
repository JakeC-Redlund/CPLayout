import { strFromU8, strToU8 } from "fflate";
import { validateMapPackageManifest, type MapPackageManifest } from "@cplayout/core";

import {
  MAP_PACKAGE_MANIFEST_FILENAME, MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME,
  mapPackageManifestHasLogicalUrls, parseMapPackageArchiveZip, prepareMapPackageRuntimeBundle,
} from "./mapPackageArchive";

/** Synchronous adapter keeps admission and rollback testable without an Expo runtime. */
export interface MapPackageArchiveStorage {
  directoryUri(name: string): string;
  exists(name: string): boolean;
  /** Original metadata bytes and nonempty/size evidence for concrete tiles. */
  readFiles(name: string): Record<string, Uint8Array>;
  writeFiles(name: string, files: Record<string, Uint8Array>): void;
  moveDirectory(from: string, to: string): void;
  removeDirectory(name: string): void;
}

export interface RecoverableMapPackageArchiveStorage extends MapPackageArchiveStorage {
  /** Immediate directory names only, never paths or recursive descendants. */
  listDirectoryNames(): string[];
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
  const name = encodeURIComponent(parsed.manifest.id);
  if (reservedTransactionName(name)) throw new Error("Map package identity collides with a reserved installation transaction directory; choose a different package ID.");
  if (!/^[A-Za-z0-9-]+$/.test(transactionId)) throw new Error("Map package installation transaction identity is unsafe.");
  if (parsed.manifest.id !== name && safeLegacyDirectoryName(parsed.manifest.id) && storage.exists(parsed.manifest.id)) {
    throw new Error("Map package has a legacy raw-ID installation; preserve it for inspection before installing an encoded-ID replacement.");
  }
  if (storage.exists(name)) {
    const recordedBytes = storage.readFiles(name)[MAP_PACKAGE_MANIFEST_FILENAME];
    if (recordedBytes) {
      const recorded = validateMapPackageManifest(JSON.parse(strFromU8(recordedBytes)));
      if (recorded.id !== parsed.manifest.id) throw new Error("Map package installation directory belongs to a different recorded package identity.");
    } else {
      // A legacy edition without a recorded manifest cannot later qualify as
      // a recovery backup. Refuse before moving it into the transaction namespace.
      throw new Error("Map package installation directory has no recorded identity; preserve the legacy edition for inspection before replacement.");
    }
  }
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

/** Startup reconciliation is synchronous so installation cannot interleave in this JS turn. */
export function rehydrateMapPackageArchiveWithStorage(
  mapPackage: MapPackageManifest,
  storage: RecoverableMapPackageArchiveStorage,
): MapPackageManifest | null {
  const manifest = validateMapPackageManifest(mapPackage);
  if (!mapPackageManifestHasLogicalUrls(manifest)) return null;
  // Denied or unknown source policy must never trigger recovery writes.
  if (manifest.imageryProvenance?.offlineCopyAllowed !== true) return null;
  const name = encodeURIComponent(manifest.id);
  if (reservedTransactionName(name)) return null;
  const names = storage.listDirectoryNames();
  const legacyName = manifest.id !== name && safeLegacyDirectoryName(manifest.id) ? manifest.id : null;
  const hasLegacy = legacyName !== null && names.includes(legacyName);
  const previous = transactionDirectories(names, name, "previous");
  const pending = transactionDirectories(names, name, "pending");
  let selected: string;
  let legacy = false;

  if (names.includes(name)) {
    if (hasLegacy) throw new Error("Map package has ambiguous canonical and legacy installations; preserve both for inspection.");
    selected = name;
  } else if (hasLegacy) {
    if (previous.length || pending.length) throw new Error("Map package legacy installation conflicts with interrupted transactions.");
    selected = legacyName!;
    legacy = true;
  } else {
    // Pending directories have never been committed. A unique pending/previous
    // pair identifies the interrupted replacement even with older retained backups.
    if (pending.length > 1) throw new Error("Map package has ambiguous interrupted transactions.");
    const paired = pending.length === 1
      ? previous.filter((entry) => entry.transactionId === pending[0].transactionId)
      : previous;
    if (paired.length !== 1) return null;
    selected = paired[0].name;
  }

  const stored = storage.readFiles(selected);
  const originalManifest = stored[MAP_PACKAGE_MANIFEST_FILENAME];
  if (originalManifest) {
    const recorded = validateMapPackageManifest(JSON.parse(strFromU8(originalManifest)));
    if (canonicalJson(recorded) !== canonicalJson(manifest)) {
      throw new Error("Installed map package manifest differs from the requested identity or source metadata.");
    }
  } else if (selected !== manifest.id) {
    // Old installations used raw IDs without a manifest. An encoded directory
    // alone could instead be another package's raw percent-containing identity.
    throw new Error("Map package recovery requires recorded package identity; encoded legacy location is ambiguous.");
  }
  const files = Object.fromEntries(Object.entries(stored)
    .filter(([filename]) => filename !== MAP_PACKAGE_MANIFEST_FILENAME && filename !== MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME));
  const runtimeName = legacy ? selected : name;
  const runtime = prepareMapPackageRuntimeBundle({ manifest, files }, storage.directoryUri(runtimeName));
  // Legacy directories remain in place: inventing a manifest or renaming them
  // would require a separate durable migration protocol. Runtime paths stay ephemeral.
  if (!legacy && selected !== name) storage.moveDirectory(selected, name);
  const sidecar = runtime.files[MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME];
  if (sidecar) storage.writeFiles(runtimeName, { [MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME]: sidecar });
  return runtime.manifest;
}

function safeLegacyDirectoryName(name: string): boolean {
  return name !== "." && name !== ".." && !name.startsWith(".") && !/[\\/%:?#\u0000-\u001f\u007f]/.test(name);
}

function reservedTransactionName(name: string): boolean {
  return /^\..+\.(?:pending|previous)-[A-Za-z0-9-]+$/.test(name);
}

function transactionDirectories(names: string[], name: string, kind: "pending" | "previous"): { name: string; transactionId: string }[] {
  const prefix = `.${name}.${kind}-`;
  return names.filter((entry) => entry.startsWith(prefix) && /^[A-Za-z0-9-]+$/.test(entry.slice(prefix.length)))
    .map((entry) => ({ name: entry, transactionId: entry.slice(prefix.length) }));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
