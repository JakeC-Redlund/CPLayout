import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareMapLibreAssets } from "./prepareMapLibreAssets";

const temporary = mkdtempSync(join(tmpdir(), "cplayout-maplibre-assets-"));
try {
  const source = join(temporary, "package");
  const destination = join(temporary, "public");
  mkdirSync(join(source, "dist"), { recursive: true });
  const metadata = join(source, "package.json");
  writeFileSync(metadata, JSON.stringify({ version: "6.9.0", license: "BSD-3-Clause" }));
  writeFileSync(join(source, "dist/maplibre-gl-worker.mjs"), 'import "./maplibre-gl-shared.mjs";');
  writeFileSync(join(source, "LICENSE.txt"), "Synthetic license fixture");
  assert.throws(() => prepareMapLibreAssets(metadata, destination), /ENOENT/);
  assert.equal(existsSync(destination), false, "a missing sibling must not produce a partial build");
  writeFileSync(join(source, "dist/maplibre-gl-shared.mjs"), "export const fixture = true;");
  const first = prepareMapLibreAssets(metadata, destination);
  assert.equal(first.version, "6.9.0");
  assert.equal(first.files.length, 3);
  for (const file of first.files) {
    const data: Buffer = readFileSync(join(destination, first.version, file.name));
    assert.equal(data.length, file.bytes);
    assert.equal(createHash("sha256").update(data).digest("hex"), file.sha256);
  }
  assert.deepEqual(prepareMapLibreAssets(metadata, destination), first, "preparation must be deterministic");
  assert.deepEqual(JSON.parse(readFileSync(join(destination, "6.9.0/manifest.json"), "utf8")), first);
  writeFileSync(metadata, JSON.stringify({ version: "7.0.0", license: "BSD-3-Clause" }));
  assert.throws(() => prepareMapLibreAssets(metadata, destination), /Review the MapLibre/);
  writeFileSync(metadata, JSON.stringify({ version: "6.9.0", license: "unreviewed" }));
  assert.throws(() => prepareMapLibreAssets(metadata, destination), /license/);
  console.log("MapLibre worker asset preparation tests passed");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
