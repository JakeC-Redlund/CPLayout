import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "..");
const rootRequire = createRequire(join(root, "package.json"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string }>;
};
// Exact Expo57/RN0.86 cohort reviewed against published manifests and this lock.
// Expo57 intentionally consumes the Metro wrapper's56.x version line.
const metroVersion = "0.84.5";
const wrapperVersion = "56.0.2";
const metroFamily = /^(?:metro(?:-[a-z-]+)?|ob1)$/;
const reviewedConsumers = { expo: "57.0.27", "@expo/metro": wrapperVersion, "@expo/metro-config": "57.0.13",
  "@react-native/community-cli-plugin": "0.86.3", "react-native": "0.86.3" };
const reviewedMetroPackages = ["metro", "metro-babel-transformer", "metro-cache", "metro-cache-key", "metro-config", "metro-core",
  "metro-file-map", "metro-minify-terser", "metro-resolver", "metro-runtime", "metro-source-map", "metro-symbolicate",
  "metro-transform-plugins", "metro-transform-worker", "ob1"].sort();
const semver = rootRequire("semver") as { satisfies(version: string, range: string): boolean };

// RN's ranged consumers and Expo's exact cohort must resolve the same patched graph.
for (const [name, version] of Object.entries(reviewedConsumers)) {
  const manifestPath = rootRequire.resolve(`${name}/package.json`);
  const metadata = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string; dependencies: Record<string, string> };
  assert.equal(metadata.version, version, `review the supported consumer cohort before changing ${name}`);
  const consumerRequire = createRequire(manifestPath);
  for (const dependency of Object.keys(metadata.dependencies)) {
    if (dependency !== "@expo/metro" && !metroFamily.test(dependency)) continue;
    const resolvedPath = consumerRequire.resolve(`${dependency}/package.json`);
    const installed = JSON.parse(readFileSync(resolvedPath, "utf8")) as { version: string };
    assert.equal(installed.version, dependency === "@expo/metro" ? wrapperVersion : metroVersion, `${name} -> ${dependency}`);
    assert.ok(semver.satisfies(installed.version, metadata.dependencies[dependency]), `${name} must admit the selected ${dependency}`);
    assert.equal(resolvedPath, rootRequire.resolve(`${dependency}/package.json`), `${dependency} must not retain a second cohort`);
  }
}

const metroEntries: string[] = [];
let wrapperEntries = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  assert.doesNotMatch(path, /(?:^|\/)node_modules\/image-size$/, "the reviewed Metro patch removes image-size");
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  if (name === "@expo/metro") { wrapperEntries += 1; assert.equal(entry.version, wrapperVersion, path); }
  if (!metroFamily.test(name)) continue;
  metroEntries.push(name);
  assert.equal(entry.version, metroVersion, path);
}
assert.deepEqual(metroEntries.sort(), reviewedMetroPackages, "review all 14 Metro packages and ob1 together; no missing, added or nested cohort");
assert.equal(wrapperEntries, 1, "Expo must resolve one wrapper cohort");
assert.throws(() => rootRequire.resolve("image-size"), { code: "MODULE_NOT_FOUND" });

const config = rootRequire(join(root, "apps/mobile/metro.config.js")) as {
  resolver: { assetExts: string[] };
  transformer: { babelTransformerPath: string };
};
assert.ok(config.resolver.assetExts.includes("wasm"));
assert.equal(typeof config.transformer.babelTransformerPath, "string");
console.log("Expo/React Native Metro dependency cohort and config compatibility checks passed.");
