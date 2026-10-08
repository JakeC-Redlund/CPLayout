import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildCornerGpsFltInventoryReport,
  buildCornerGpsFltInventorySummary,
  type InventoryRoot,
} from "./cornerGpsFltInventory";

const root = mkdtempSync(join(tmpdir(), "cplayout-cornergps-flt-inventory-"));
const installRoot = join(root, "install");
const dataRoot = join(root, "data");
mkdirSync(join(installRoot, "config"), { recursive: true });
mkdirSync(join(dataRoot, "client-a"), { recursive: true });
writeFileSync(join(installRoot, "config", "synthetic.config"), "<configuration />\n");
writeFileSync(join(installRoot, "gpsmap.exe"), "synthetic executable fixture\n");
writeFileSync(join(dataRoot, "client-a", "field.bpf"), "<BorderPoints />\n");
writeFileSync(join(dataRoot, "client-a", "field.kml"), "<kml />\n");
writeFileSync(join(dataRoot, "client-a", "field.vri"), "synthetic vri fixture\n");
writeFileSync(join(dataRoot, "client-a", "do-not-hash.config"), "data config fixture\n");
// Exchange files remain counts-only even when present under an installation root.
const exchangeFixtures = [
  { directory: installRoot, filename: "private-install.path", content: "synthetic private install path coordinates\n" },
  { directory: installRoot, filename: "private-install.GPS", content: "synthetic private install GPS coordinates\n" },
  { directory: join(dataRoot, "client-a"), filename: "private-field.PATH", content: "synthetic private field PATH coordinates\n" },
  { directory: join(dataRoot, "client-a"), filename: "private-field.gps", content: "synthetic private field gps coordinates\n" },
];
for (const fixture of exchangeFixtures) writeFileSync(join(fixture.directory, fixture.filename), fixture.content);
symlinkSync(join(root, "missing-private-target"), join(installRoot, "private-unreadable.PATH"));
symlinkSync(join(root, "missing-private-target"), join(dataRoot, "client-a", "private-unreadable.config"));

const roots: InventoryRoot[] = [
  {
    id: "synthetic-install",
    label: "Synthetic install",
    localPath: installRoot,
    role: "install",
    maxDepth: 4,
  },
  {
    id: "synthetic-data",
    label: "Synthetic data",
    localPath: dataRoot,
    role: "data",
    maxDepth: 4,
  },
];

const report = buildCornerGpsFltInventoryReport("2026-06-08T00:00:00.000Z", { roots });
assert.equal(report.roots.length, 2);
assert.equal(report.supportedFileTypeCounts[".bpf"], 1);
assert.equal(report.supportedFileTypeCounts[".kml"], 1);
assert.equal(report.supportedFileTypeCounts[".vri"], 1);
assert.equal(report.supportedFileTypeCounts[".path"], 2);
assert.equal(report.supportedFileTypeCounts[".gps"], 2);
assert.equal(Object.hasOwn(report.supportedFileTypeCounts, ".PATH"), false);
assert.equal(Object.hasOwn(report.supportedFileTypeCounts, ".GPS"), false);
assert.equal(report.artifacts.length, 2);
assert.equal(report.artifacts.every((artifact) => artifact.rootId === "synthetic-install"), true);
assert.equal(report.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)), true);
assert.equal(report.artifacts.some((artifact) => artifact.redactedPath.includes(root)), false);
assert.equal(report.skipped.length, 2);
assert.equal(JSON.stringify(report).includes("private-unreadable"), false);
assert.equal(JSON.stringify(report).includes("missing-private-target"), false);
assert.equal(report.skipped.some(item => item.redactedPath.includes("client-a")), false);

const summary = buildCornerGpsFltInventorySummary(report, true);
assert.equal(summary.schemaVersion, "cplayout-cornergps-flt-inventory-summary-v1");
assert.equal(summary.dryRun, true);
assert.equal(summary.artifactCount, 2);
assert.equal(summary.artifactRootRoleCounts.install, 2);
assert.equal(summary.artifactRootRoleCounts.data, 0);
assert.equal(summary.supportedFileTypeCounts[".bpf"], 1);
assert.equal(summary.supportedFileTypeCounts[".path"], 2);
assert.equal(summary.supportedFileTypeCounts[".gps"], 2);
assert.equal(JSON.stringify(summary).includes("redactedPath"), false);
assert.equal(JSON.stringify(summary).includes("sha256"), false);

const countsOnly = buildCornerGpsFltInventoryReport("2026-06-08T00:00:00.000Z", {
  roots, includeInstallArtifactHashes: false,
});
assert.deepEqual(countsOnly.supportedFileTypeCounts, report.supportedFileTypeCounts);
assert.equal(countsOnly.artifacts.length, 0);
for (const fixture of exchangeFixtures) {
  const filePath = join(fixture.directory, fixture.filename);
  assert.equal(readFileSync(filePath, "utf8"), fixture.content, "Inventory must preserve exchange file contents.");
  const hash = createHash("sha256").update(fixture.content).digest("hex");
  for (const output of [report, summary, countsOnly]) {
    const serialized = JSON.stringify(output);
    for (const privateValue of [fixture.filename, fixture.content.trim(), filePath, hash]) {
      assert.equal(serialized.includes(privateValue), false, "Exchange files must expose counts only, without names, contents, paths or hashes.");
    }
  }
}

console.log("CornerGPSMap / FLT inventory tests passed");
