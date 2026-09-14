import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { analyzePngPixels } from "./pngMetrics";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resourceRoot = "apps/mobile/android/app/src/main/res";
const background = new DOMParser().parseFromString(
  readFileSync(resolve(root, resourceRoot, "drawable/ic_launcher_background.xml"), "utf8"),
  "application/xml",
);
const bitmap = background.getElementsByTagName("bitmap").item(0);
assert.equal(bitmap?.getAttributeNS("http://schemas.android.com/apk/res/android", "src"), "@drawable/splashscreen_logo");

for (const [density, size] of [["mdpi", 288], ["hdpi", 432], ["xhdpi", 576], ["xxhdpi", 864], ["xxxhdpi", 1152]] as const) {
  const path = `${resourceRoot}/drawable-${density}/splashscreen_logo.png`;
  assert.ok(existsSync(resolve(root, path)), `Missing native splash resource: ${path}`);
  const metrics = analyzePngPixels(readFileSync(resolve(root, path)));
  assert.equal(metrics.width, size);
  assert.equal(metrics.height, size);
  assert.ok(metrics.grayVariance > 0, `Blank native splash resource: ${path}`);

  // A local ignored asset can hide a clean-checkout Android resource-link failure.
  if (existsSync(resolve(root, ".git"))) {
    const ignored = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", path], { cwd: root });
    assert.equal(ignored.status, 1, `${path} must be eligible for version control: ${ignored.stderr?.toString() ?? ""}`);
  }
}

console.log("Android splash resource tests passed");
