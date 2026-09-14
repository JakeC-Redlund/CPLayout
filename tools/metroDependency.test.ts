import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "..");
const rootRequire = createRequire(join(root, "package.json"));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
  packages: Record<string, { version?: string }>;
};
const metroVersion = "0.83.8";
const wrapperVersion = "55.1.2";
const metroFamily = /^(?:metro(?:-[a-z-]+)?|ob1)$/;

// RN's ranged consumers and Expo's exact cohort must resolve the same patched graph.
for (const name of ["expo", "@expo/metro", "@expo/metro-config", "@react-native/community-cli-plugin", "react-native"]) {
  const manifestPath = rootRequire.resolve(`${name}/package.json`);
  const metadata = JSON.parse(readFileSync(manifestPath, "utf8")) as { dependencies: Record<string, string> };
  const consumerRequire = createRequire(manifestPath);
  for (const dependency of Object.keys(metadata.dependencies)) {
    if (dependency !== "@expo/metro" && !metroFamily.test(dependency)) continue;
    const resolvedPath = consumerRequire.resolve(`${dependency}/package.json`);
    const installed = JSON.parse(readFileSync(resolvedPath, "utf8")) as { version: string };
    assert.equal(installed.version, dependency === "@expo/metro" ? wrapperVersion : metroVersion, `${name} -> ${dependency}`);
    assert.equal(resolvedPath, rootRequire.resolve(`${dependency}/package.json`), `${dependency} must not retain a second cohort`);
  }
}

let metroEntries = 0;
for (const [path, entry] of Object.entries(lock.packages)) {
  assert.doesNotMatch(path, /(?:^|\/)node_modules\/image-size$/, "the reviewed Metro patch removes image-size");
  const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  if (name === "@expo/metro") assert.equal(entry.version, wrapperVersion, path);
  if (!metroFamily.test(name)) continue;
  metroEntries += 1;
  assert.equal(entry.version, metroVersion, path);
}
assert.equal(metroEntries, 15, "review all 14 Metro packages and ob1 together before changing this gate");
assert.throws(() => rootRequire.resolve("image-size"), { code: "MODULE_NOT_FOUND" });

const config = rootRequire(join(root, "apps/mobile/metro.config.js")) as {
  resolver: { assetExts: string[] };
  transformer: { babelTransformerPath: string };
};
assert.ok(config.resolver.assetExts.includes("wasm"));
assert.equal(typeof config.transformer.babelTransformerPath, "string");
console.log("Expo/React Native Metro dependency cohort and config compatibility checks passed.");
