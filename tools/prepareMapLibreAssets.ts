import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");

export function prepareMapLibreAssets(
  packageJsonPath = createRequire(join(repoRoot, "packages/map-adapters/package.json")).resolve("maplibre-gl/package.json"),
  publicDirectory = join(repoRoot, "apps/mobile/public/maplibre"),
): { version: string; files: { name: string; bytes: number; sha256: string }[] } {
  const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown; license?: unknown };
  if (typeof metadata.version !== "string" || !/^6\.\d+\.\d+$/.test(metadata.version) || metadata.license !== "BSD-3-Clause") {
    throw new Error("Review the MapLibre version, license and worker asset contract before preparing this build.");
  }

  // Read the expected worker assets before replacing any generated asset.
  const packageRoot = dirname(packageJsonPath);
  const assets = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs", "LICENSE.txt"].map((name) => ({
    name,
    data: readFileSync(join(packageRoot, name === "LICENSE.txt" ? name : `dist/${name}`)),
  }));
  const manifest = {
    version: metadata.version,
    files: assets.map(({ name, data }) => ({
      name,
      bytes: data.length,
      sha256: createHash("sha256").update(data).digest("hex"),
    })),
  };
  const destination = join(publicDirectory, metadata.version);
  mkdirSync(destination, { recursive: true });
  for (const { name, data } of assets) writeFileSync(join(destination, name), data);
  writeFileSync(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const manifest = prepareMapLibreAssets();
  console.log(`Prepared local MapLibre ${manifest.version} worker, shared module and license.`);
}
