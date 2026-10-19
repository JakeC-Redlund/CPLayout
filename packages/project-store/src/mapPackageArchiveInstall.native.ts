import { Directory, File, Paths } from "expo-file-system";
import { validateMapPackageManifest, type MapPackageManifest } from "@cplayout/core";

import {
  MAP_PACKAGE_ARCHIVE_MAX_ENTRY_BYTES,
  MAP_PACKAGE_MANIFEST_FILENAME,
  MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME,
  MAP_PACKAGE_TILEJSON_FILENAME,
  mapPackageManifestHasLogicalUrls,
  prepareMapPackageRuntimeBundle,
} from "./mapPackageArchive";
import { installMapPackageArchiveWithStorage, type MapPackageArchiveStorage } from "./mapPackageArchiveInstallCore";

export interface InstalledMapPackageArchive {
  manifest: MapPackageManifest;
  runtimeManifest: MapPackageManifest;
  packageDirectoryUri: string;
  fileCount: number;
}

export async function installMapPackageArchiveZipAsync(data: Uint8Array): Promise<InstalledMapPackageArchive> {
  return installMapPackageArchiveWithStorage(data, nativeStorage(), `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function nativeStorage(): MapPackageArchiveStorage {
  const directory = (name: string) => new Directory(Paths.document, "map-packages", name);
  return {
    directoryUri: (name) => directory(name).uri,
    exists: (name) => directory(name).exists,
    writeFiles: (name, files) => {
      const destination = directory(name);
      destination.create({ intermediates: true });
      writeFiles(destination, files);
    },
    moveDirectory: (from, to) => directory(from).move(directory(to)),
    removeDirectory: (name) => directory(name).delete(),
  };
}

function writeFiles(destination: Directory, files: Record<string, Uint8Array>): void {
  for (const [filename, bytes] of Object.entries(files)) {
    const parts = filename.split("/");
    const basename = parts.at(-1)!;
    let directory = destination;
    for (const segment of parts.slice(0, -1)) {
      directory = new Directory(directory, segment);
      directory.create({ idempotent: true, intermediates: true });
    }
    const file = new File(directory, basename);
    file.create({ intermediates: true, overwrite: true });
    file.write(bytes);
  }
}

export async function rehydrateInstalledMapPackageManifestsAsync(
  mapPackages: MapPackageManifest[] = [],
): Promise<MapPackageManifest[]> {
  const runtimeManifests: MapPackageManifest[] = [];
  for (const mapPackage of mapPackages) {
    const runtimeManifest = rehydrateInstalledMapPackageManifest(mapPackage);
    if (runtimeManifest) runtimeManifests.push(runtimeManifest);
  }
  return runtimeManifests;
}

function rehydrateInstalledMapPackageManifest(mapPackage: MapPackageManifest): MapPackageManifest | null {
  try {
    const manifest = validateMapPackageManifest(mapPackage);
    if (!mapPackageManifestHasLogicalUrls(manifest)) return null;
    const packageDirectory = new Directory(Paths.document, "map-packages", encodeURIComponent(manifest.id));
    if (!packageDirectory.exists) return null;
    const files: Record<string, Uint8Array> = {};
    const inspect = (directory: Directory, prefix: string) => {
      for (const entry of directory.list()) {
        const filename = `${prefix}${entry.name}`;
        if (entry instanceof Directory) {
          inspect(entry, `${filename}/`);
        } else if (filename !== MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME && filename !== MAP_PACKAGE_MANIFEST_FILENAME) {
          if (entry.size > MAP_PACKAGE_ARCHIVE_MAX_ENTRY_BYTES) throw new Error("Installed map package entry exceeds the admission limit.");
          // Re-admit the complete resource graph from original TileJSON. Concrete tiles
          // need existence/nonempty/size proof here; avoid reading the entire tile pyramid.
          files[filename] = filename === MAP_PACKAGE_TILEJSON_FILENAME ? entry.bytesSync() : new Uint8Array(entry.size > 0 ? 1 : 0);
        }
      }
    };
    inspect(packageDirectory, "");
    const runtime = prepareMapPackageRuntimeBundle({ manifest, files }, packageDirectory.uri);
    const tileJson = runtime.files[MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME];
    if (tileJson) writeFiles(packageDirectory, { [MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME]: tileJson });
    return runtime.manifest;
  } catch {
    return null;
  }
}
