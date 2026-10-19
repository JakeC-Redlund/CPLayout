import { Directory, File, Paths } from "expo-file-system";
import type { MapPackageManifest } from "@cplayout/core";

import {
  MAP_PACKAGE_ARCHIVE_MAX_ENTRY_BYTES,
  MAP_PACKAGE_MANIFEST_FILENAME,
  MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME,
  MAP_PACKAGE_TILEJSON_FILENAME,
} from "./mapPackageArchive";
import { installMapPackageArchiveWithStorage, rehydrateMapPackageArchiveWithStorage, type RecoverableMapPackageArchiveStorage } from "./mapPackageArchiveInstallCore";

export interface InstalledMapPackageArchive {
  manifest: MapPackageManifest;
  runtimeManifest: MapPackageManifest;
  packageDirectoryUri: string;
  fileCount: number;
}

export async function installMapPackageArchiveZipAsync(data: Uint8Array): Promise<InstalledMapPackageArchive> {
  return installMapPackageArchiveWithStorage(data, nativeStorage(), `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function nativeStorage(): RecoverableMapPackageArchiveStorage {
  const root = new Directory(Paths.document, "map-packages");
  const directory = (name: string) => {
    if (!name || name === "." || name === ".." || /[\\/\u0000-\u001f\u007f]/.test(name)) throw new Error("Map package directory must be a safe single component.");
    return new Directory(root, name);
  };
  return {
    directoryUri: (name) => directory(name).uri,
    exists: (name) => directory(name).exists,
    writeFiles: (name, files) => {
      const destination = directory(name);
      destination.create({ idempotent: true, intermediates: true });
      writeFiles(destination, files);
    },
    // Expo FileSystem 57 move() returns a Promise; the transaction adapter is synchronous.
    moveDirectory: (from, to) => directory(from).moveSync(directory(to)),
    removeDirectory: (name) => directory(name).delete(),
    listDirectoryNames: () => root.exists ? root.list().filter((entry): entry is Directory => entry instanceof Directory).map((entry) => entry.name) : [],
    readFiles: (name) => readInstalledFiles(directory(name)),
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
    return rehydrateMapPackageArchiveWithStorage(mapPackage, nativeStorage());
  } catch {
    return null;
  }
}

function readInstalledFiles(packageDirectory: Directory): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const inspect = (directory: Directory, prefix: string) => {
    for (const entry of directory.list()) {
      if (!entry.name || /[\\/\u0000-\u001f\u007f]/.test(entry.name) || entry.name === "." || entry.name === "..") throw new Error("Installed map package has an unsafe entry name.");
      const filename = `${prefix}${entry.name}`;
      if (entry instanceof Directory) {
        inspect(entry, `${filename}/`);
      } else if (filename !== MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME) {
        if (entry.size > MAP_PACKAGE_ARCHIVE_MAX_ENTRY_BYTES) throw new Error("Installed map package entry exceeds the admission limit.");
        // Re-admit original metadata and concrete resource existence/nonempty/size
        // without loading the complete tile pyramid into JavaScript memory.
        files[filename] = filename === MAP_PACKAGE_TILEJSON_FILENAME || filename === MAP_PACKAGE_MANIFEST_FILENAME
          ? entry.bytesSync() : new Uint8Array(entry.size > 0 ? 1 : 0);
      }
    }
  };
  inspect(packageDirectory, "");
  return files;
}
