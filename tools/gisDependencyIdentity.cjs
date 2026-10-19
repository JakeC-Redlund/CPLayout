"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { createHash } = require("node:crypto");
const consumers = {
  ".": ["expo", "react-native", "proj4", "@playwright/test", "@axe-core/playwright"],
  "apps/mobile": ["expo", "react-native", "@maplibre/maplibre-react-native", "expo-sqlite"],
  "packages/map-adapters": ["maplibre-gl", "pmtiles", "@maplibre/maplibre-react-native"],
  "packages/core": ["proj4", "@xmldom/xmldom"],
  "apps/api": ["argon2"],
};
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
function packageMetadata(request, name) {
  try { return request.resolve(name + "/package.json"); }
  catch {
    let directory = path.dirname(request.resolve(name));
    while (directory !== path.dirname(directory)) {
      const file = path.join(directory, "package.json");
      if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file)).name === name) return file;
      directory = path.dirname(directory);
    }
    throw new Error("Package metadata is unavailable: " + name);
  }
}
function logicalInstalledPath(root, consumer, name, metadataFile) {
  const actual = fs.realpathSync(metadataFile), boundary = path.resolve(root);
  let directory = path.resolve(root, consumer);
  while (directory === boundary || directory.startsWith(boundary + path.sep)) {
    const candidate = path.join(directory, "node_modules", name, "package.json");
    if (fs.existsSync(candidate) && fs.realpathSync(candidate) === actual) return path.relative(root, path.dirname(candidate)).split(path.sep).join("/");
    directory = path.dirname(directory);
  }
  throw Error("Consumed package is outside the owned dependency links: " + name);
}
function expectedLockPath(root, consumer, name, lock) {
  const boundary = path.resolve(root); let directory = path.resolve(root, consumer);
  while (directory === boundary || directory.startsWith(boundary + path.sep)) {
    const key = path.relative(root, path.join(directory, "node_modules", name)).split(path.sep).join("/");
    if (lock.packages[key]) return key;
    directory = path.dirname(directory);
  }
  throw Error("Consumer has no locked package slot: " + name);
}
function consumedEntry(request, name, metadataFile, metadata) {
  let file;
  try { file = request.resolve(name); }
  catch (error) {
    // MapLibre GL ships an import-only export. Validate the actual published
    // import target without executing it or pretending a CJS entry exists.
    const target = metadata.exports?.["."]?.import;
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" || typeof target !== "string" || !target.startsWith("./")) throw error;
    const base = path.dirname(metadataFile); file = path.resolve(base, target);
    if (!file.startsWith(base + path.sep)) throw Error("Import target escapes its package: " + name);
  }
  if (!fs.statSync(file).isFile()) throw Error("Consumed package entry is not a file: " + name);
  return file;
}
function inspectGisDependencies(root, { assets = false, selectedConsumers = consumers } = {}) {
  const lockBytes = fs.readFileSync(path.join(root, "package-lock.json"));
  const lock = JSON.parse(lockBytes), errors = [], packages = [];
  for (const [consumer, names] of Object.entries(selectedConsumers)) {
    const manifest = path.resolve(root, consumer, "package.json");
    const declaration = JSON.parse(fs.readFileSync(manifest));
    const request = createRequire(manifest);
    for (const name of names) {
      try {
        const file = packageMetadata(request, name), bytes = fs.readFileSync(file), metadata = JSON.parse(bytes);
        consumedEntry(request, name, file, metadata);
        const relative = logicalInstalledPath(root, consumer, name, file);
        const expected = expectedLockPath(root, consumer, name, lock);
        const locked = lock.packages[expected]?.version;
        if (relative !== expected) errors.push(`${consumer}: ${name} consumed ${relative}, expected locked slot ${expected}`);
        const declared = declaration.dependencies?.[name] ?? declaration.devDependencies?.[name];
        if (!declared) errors.push(`${consumer}: ${name} has no direct declaration`);
        if (typeof declared === "string" && /^\d+\.\d+\.\d+$/.test(declared) && declared !== metadata.version) errors.push(`${consumer}: ${name} installed ${metadata.version}, declared ${declared}`);
        if (locked !== metadata.version) errors.push(`${consumer}: ${name} installed ${metadata.version}, locked ${locked ?? "missing"}`);
        packages.push({ consumer, name, declared, installed: metadata.version, locked: locked ?? null, metadataSha256: sha(bytes) });
      } catch (error) { errors.push(`${consumer}: ${name}: ${error.message}`); }
    }
  }
  let workerAssets = null;
  const map = packages.find(item => item.consumer === "packages/map-adapters" && item.name === "maplibre-gl");
  if (map) {
    const manifest = path.join(root, "apps/mobile/public/maplibre", map.installed, "manifest.json");
    if (fs.existsSync(manifest)) {
      try {
        const data = JSON.parse(fs.readFileSync(manifest));
        const packageRoot = path.dirname(packageMetadata(createRequire(path.join(root, "packages/map-adapters/package.json")), "maplibre-gl"));
        if (data.version !== map.installed || !Array.isArray(data.files) || data.files.length !== 3) throw Error("Invalid asset manifest");
        for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs", "LICENSE.txt"]) {
          const item = data.files.find(item => item.name === name);
          const generated = fs.readFileSync(path.join(path.dirname(manifest), name));
          const published = fs.readFileSync(path.join(packageRoot, name === "LICENSE.txt" ? name : "dist/" + name));
          if (!item || item.bytes !== generated.length || item.sha256 !== sha(generated) || !generated.equals(published)) throw Error("Worker/license asset mismatch: " + name);
        }
        workerAssets = { version: data.version, manifestSha256: sha(fs.readFileSync(manifest)), verified: true };
      } catch (error) { errors.push(error.message); }
    } else if (assets) errors.push("Prepared MapLibre assets are missing for " + map.installed);
  }
  return { schemaVersion: 1, claim: "Installed package and generated-asset identity only; no renderer/device proof.", lockSha256: sha(lockBytes), node: process.version, packages, workerAssets, errors };
}
module.exports = { inspectGisDependencies };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--assets", "--registry"].includes(arg))) throw Error("Supported options: --assets --registry");
  (async () => {
    const result = inspectGisDependencies(path.resolve(__dirname, ".."), { assets: args.includes("--assets") });
    if (args.includes("--registry")) {
      result.registry = await Promise.all([...new Set(Object.values(consumers).flat())].map(async name => {
        const url = "https://registry.npmjs.org/" + encodeURIComponent(name);
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw Error("HTTP " + response.status);
          const data = await response.json(), version = data["dist-tags"].latest;
          return { name, url, retrievedAt: new Date().toISOString(), latest: version, publishedAt: data.time[version], claim: "Availability only; compatibility and runtime unqualified." };
        } catch (error) {
          result.errors.push("Registry unavailable for " + name + ": " + error.message);
          return { name, url, error: error.message };
        }
      }));
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.errors.length) process.exitCode = 1;
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
