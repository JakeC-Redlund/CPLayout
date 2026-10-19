import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { strToU8, zipSync } from "fflate";
import type { MapPackageManifest } from "@cplayout/core";

import { MAP_PACKAGE_MANIFEST_FILENAME, MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME, MAP_PACKAGE_TILEJSON_FILENAME, mapPackageLogicalUrlPrefix } from "./mapPackageArchive";

/** Actual native adapter with a synchronous, byte-preserving Expo filesystem bridge. No device proof. */
export async function runMapPackageRecoveryTests(source: MapPackageManifest, archive: Uint8Array): Promise<void> {
  const root = "/documents/map-packages";
  let directories = new Set<string>();
  let files = new Map<string, Uint8Array>();
  let operations: string[] = [];
  let failedMove: ((from: string, to: string) => boolean) | null = null;
  let failedWrite: string | null = null;
  const locate = (parts: (string | Directory | File)[]) => path.posix.join(...parts.map((part) => typeof part === "string"
    ? part.startsWith("file:") ? fileURLToPath(part) : part : part.location));
  class Directory {
    location: string;
    constructor(...parts: (string | Directory | File)[]) { this.location = locate(parts); }
    get uri() { return pathToFileURL(this.location).href; }
    get name() { return path.posix.basename(this.location); }
    get exists() { return directories.has(this.location); }
    create(options: { idempotent?: boolean; intermediates?: boolean } = {}) {
      operations.push(`mkdir ${this.location}`);
      if (this.exists && !options.idempotent) throw new Error("Directory already exists");
      for (let current = this.location; current !== "/"; current = path.posix.dirname(current)) directories.add(current);
    }
    list(): (Directory | File)[] {
      if (!this.exists) throw new Error("Directory missing");
      return [...[...directories].filter((entry) => entry !== this.location && path.posix.dirname(entry) === this.location).map((entry) => new Directory(entry)),
        ...[...files.keys()].filter((entry) => path.posix.dirname(entry) === this.location).map((entry) => new File(entry))];
    }
    // The pinned Expo API is asynchronous. Deliberately do not perform its work
    // synchronously: treating this Promise as a completed rename must fail tests.
    move(_destination: Directory) { operations.push("UNAWAITED_ASYNC_MOVE"); return Promise.resolve(); }
    moveSync(destination: Directory) {
      operations.push(`move ${this.location} ${destination.location}`);
      if (failedMove?.(this.location, destination.location)) throw new Error("Simulated move interruption");
      if (!this.exists || destination.exists) throw new Error("Invalid move");
      const from = this.location;
      for (const entry of [...directories].filter((entry) => entry === from || entry.startsWith(`${from}/`))) {
        directories.delete(entry); directories.add(destination.location + entry.slice(from.length));
      }
      for (const [entry, bytes] of [...files].filter(([entry]) => entry.startsWith(`${from}/`))) {
        files.delete(entry); files.set(destination.location + entry.slice(from.length), bytes);
      }
      this.location = destination.location;
    }
    delete() {
      operations.push(`delete ${this.location}`);
      for (const entry of [...directories]) if (entry === this.location || entry.startsWith(`${this.location}/`)) directories.delete(entry);
      for (const entry of [...files.keys()]) if (entry.startsWith(`${this.location}/`)) files.delete(entry);
    }
  }
  class File {
    location: string;
    constructor(...parts: (string | Directory | File)[]) { this.location = locate(parts); }
    get name() { return path.posix.basename(this.location); }
    get size() { return files.get(this.location)?.byteLength ?? 0; }
    create() { operations.push(`create ${this.location}`); if (failedWrite === this.location) throw new Error("Simulated write interruption"); }
    write(bytes: Uint8Array) { operations.push(`write ${this.location}`); files.set(this.location, bytes.slice()); }
    bytesSync() { return files.get(this.location)!.slice(); }
  }
  const require = createRequire(import.meta.url);
  const loader = require("node:module") as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
  const originalLoad = loader._load;
  loader._load = function(name, parent, isMain) {
    if (name === "expo-file-system") return { Directory, File, Paths: { document: new Directory("/documents") } };
    return originalLoad(name, parent, isMain);
  };
  let native: typeof import("./mapPackageArchiveInstall.native");
  try { native = require("./mapPackageArchiveInstall.native"); } finally { loader._load = originalLoad; }

  const manifestFor = (id: string): MapPackageManifest => {
    const prefix = mapPackageLogicalUrlPrefix(id);
    return { ...source, id, uri: prefix, tileJsonUrl: `${prefix}tilejson.json`, tileUrlTemplates: [`${prefix}tiles/{z}/{x}/{y}.png`] };
  };
  const payload = (manifest: MapPackageManifest, recorded = true): Record<string, Uint8Array> => ({
    ...(recorded ? { [MAP_PACKAGE_MANIFEST_FILENAME]: strToU8(JSON.stringify(manifest)) } : {}),
    [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8(JSON.stringify({ tiles: manifest.tileUrlTemplates })),
    "tiles/12/856/1549.png": new Uint8Array([137, 80, 78, 71]),
  });
  const seed = (name: string, contents: Record<string, Uint8Array>) => {
    const directory = new Directory(root, name); directory.create();
    for (const [name, bytes] of Object.entries(contents)) {
      new Directory(path.posix.dirname(path.posix.join(directory.location, name))).create({ idempotent: true });
      files.set(path.posix.join(directory.location, name), bytes.slice());
    }
    operations = [];
  };
  const snapshot = () => ({ directories: [...directories].sort(), files: [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => [name, [...bytes]]) });
  const rehydrate = (manifest: MapPackageManifest) => native.rehydrateInstalledMapPackageManifestsAsync([manifest]);
  const refuseUnchanged = async (manifest: MapPackageManifest) => {
    const before = snapshot(); operations = [];
    assert.deepEqual(await rehydrate(manifest), []);
    assert.deepEqual(snapshot(), before, "Refusal preserves every original, pending and backup byte");
    assert.deepEqual(operations, [], "Refusal makes no filesystem mutations");
  };
  const assertOriginal = (name: string, contents: Record<string, Uint8Array>) => {
    for (const [filename, bytes] of Object.entries(contents)) assert.deepEqual(files.get(`${root}/${name}/${filename}`), bytes, `${name}/${filename}`);
  };
  let passed = 0;
  const failures: Error[] = [];
  const test = async (name: string, run: () => Promise<void>) => {
    directories = new Set(); files = new Map(); operations = []; failedMove = null; failedWrite = null;
    try { await run(); passed++; console.log(`PASS package recovery: ${name}`); }
    catch (error) { failures.push(new Error(name, { cause: error })); console.error(`FAIL package recovery: ${name}`, error); }
  };
  const spaced = manifestFor("field imagery"), encoded = encodeURIComponent(spaced.id);
  await test("native installation waits for synchronous directory promotion", async () => {
    const installed = await native.installMapPackageArchiveZipAsync(archive);
    assert.equal(installed.manifest.id, source.id);
    assert(directories.has(`${root}/${encodeURIComponent(source.id)}`));
    assert(!operations.includes("UNAWAITED_ASYNC_MOVE"));
    assert.deepEqual(files.get(`${root}/${source.id}/manifest.json`), strToU8(JSON.stringify(source)));
  });
  for (const id of ["field imagery", "field-plain", "région α"]) await test(`safe legacy ID rehydrates in place: ${id}`, async () => {
    const manifest = manifestFor(id), contents = payload(manifest, false); seed(id, contents);
    const result = await rehydrate(manifest);
    assert.equal(result.length, 1);
    assert.equal(result[0].uri, `${pathToFileURL(`${root}/${id}`).href}/`);
    assertOriginal(id, contents);
    assert(!files.has(`${root}/${id}/manifest.json`), "No synthetic original manifest is created");
    assert(!operations.some((entry) => entry.startsWith("move ") || entry.startsWith("delete ")));
    assert.equal((await rehydrate(manifest)).length, 1, "Repeated startup is idempotent");
  });
  await test("current encoded edition validates recorded metadata", async () => {
    const contents = payload(spaced); seed(encoded, contents);
    assert.equal((await rehydrate(spaced)).length, 1); assertOriginal(encoded, contents);
  });
  await test("recorded manifest property ordering has no effect", async () => {
    const contents = payload(spaced); contents[MAP_PACKAGE_MANIFEST_FILENAME] = strToU8(JSON.stringify(Object.fromEntries(Object.entries(spaced).reverse())));
    seed(encoded, contents); assert.equal((await rehydrate(spaced)).length, 1); assertOriginal(encoded, contents);
  });
  await test("unrecorded raw-percent and encoded-space collision refuses", async () => { seed(encoded, payload(spaced, false)); await refuseUnchanged(spaced); });
  for (const id of ["a%20b", "../outside", "nested/field", "nested\\field", "https:field", "field?x", "field#x"]) await test(`unsafe raw legacy lookup refuses: ${id}`, async () => {
    const manifest = manifestFor(id); seed(id, payload(manifest, false)); await refuseUnchanged(manifest);
  });
  await test("simultaneous canonical and raw legacy editions refuse", async () => { seed(encoded, payload(spaced)); seed(spaced.id, payload(spaced, false)); await refuseUnchanged(spaced); });
  await test("later encoded-ID installation refuses before writing beside retained raw legacy edition", async () => {
    const contents = payload(spaced, false); seed(spaced.id, contents); const before = snapshot();
    await assert.rejects(() => native.installMapPackageArchiveZipAsync(zipSync(payload(spaced))), /legacy raw-ID installation/);
    assert.deepEqual(snapshot(), before); assert.deepEqual(operations, []); assertOriginal(spaced.id, contents);
  });
  await test("plain-ID legacy replacement refuses before moving an unrecorded active edition", async () => {
    const plain = manifestFor("field-plain"), contents = payload(plain, false); seed(plain.id, contents); const before = snapshot();
    await assert.rejects(() => native.installMapPackageArchiveZipAsync(zipSync(payload(plain))), /no recorded identity/);
    assert.deepEqual(snapshot(), before); assert.deepEqual(operations, []); assertOriginal(plain.id, contents);
  });
  await test("recorded same-ID replacement admits a new source edition and retains the prior bytes", async () => {
    const prior = manifestFor("field-plain"), contents = payload(prior); seed(prior.id, contents);
    const replacement = { ...prior, name: "New qualified source edition", imageryProvenance: { ...prior.imageryProvenance!, productId: "new-qualified-source" } };
    const installed = await native.installMapPackageArchiveZipAsync(zipSync(payload(replacement)));
    assert.equal(installed.manifest.imageryProvenance?.productId, "new-qualified-source");
    assertOriginal(prior.id, payload(replacement));
    const backups = [...directories].filter((entry) => path.posix.dirname(entry) === root && path.posix.basename(entry).startsWith(`.${prior.id}.previous-`));
    assert.equal(backups.length, 1); assertOriginal(path.posix.basename(backups[0]), contents);
    assert.equal((await rehydrate(replacement)).length, 1);
    assert(!operations.includes("UNAWAITED_ASYNC_MOVE"));
  });
  for (const recorded of [false, true]) await test(`replacement refuses a colliding destination identity: recorded=${recorded}`, async () => {
    const contents = payload(manifestFor("field%20imagery"), recorded); seed(encoded, contents); const before = snapshot();
    await assert.rejects(() => native.installMapPackageArchiveZipAsync(zipSync(payload(spaced))), /recorded identity|different recorded package identity/);
    assert.deepEqual(snapshot(), before); assert.deepEqual(operations, []); assertOriginal(encoded, contents);
  });
  for (const id of [".foo.pending-tx", ".foo.previous-tx"]) await test(`reserved internal-name package identity refuses before storage: ${id}`, async () => {
    const manifest = manifestFor(id), other = manifestFor("foo"), contents = payload(other); seed(id, contents); const before = snapshot();
    await assert.rejects(() => native.installMapPackageArchiveZipAsync(zipSync(payload(manifest))), /reserved installation transaction directory/);
    assert.deepEqual(snapshot(), before); assert.deepEqual(operations, []); await refuseUnchanged(manifest);
  });
  for (const permission of [false, undefined]) await test(`denied or unknown copying policy refuses: ${permission}`, async () => {
    const denied = { ...spaced, imageryProvenance: permission === undefined ? undefined : { ...spaced.imageryProvenance!, offlineCopyAllowed: false } };
    seed(spaced.id, payload(spaced, false)); await refuseUnchanged(denied);
  });
  for (const invalid of ["external", "malformed", "missing", "empty"]) await test(`invalid legacy resource graph refuses: ${invalid}`, async () => {
    const contents = payload(spaced, false);
    if (invalid === "external") contents[MAP_PACKAGE_TILEJSON_FILENAME] = strToU8(JSON.stringify({ tiles: ["//example.invalid/{z}/{x}/{y}.png"] }));
    if (invalid === "malformed") contents[MAP_PACKAGE_TILEJSON_FILENAME] = strToU8("{");
    if (invalid === "missing") delete contents["tiles/12/856/1549.png"];
    if (invalid === "empty") contents["tiles/12/856/1549.png"] = new Uint8Array();
    seed(spaced.id, contents); await refuseUnchanged(spaced);
  });
  for (const recorded of [manifestFor("other"), { ...spaced, imageryProvenance: { ...spaced.imageryProvenance!, productId: "another-source" } }, { ...spaced, imageryProvenance: { ...spaced.imageryProvenance!, offlineCopyAllowed: false } }]) await test(`recorded identity/source mismatch refuses: ${recorded.id}/${recorded.imageryProvenance?.productId}/${recorded.imageryProvenance?.offlineCopyAllowed}`, async () => {
    const contents = payload(spaced); contents[MAP_PACKAGE_MANIFEST_FILENAME] = strToU8(JSON.stringify(recorded)); seed(encoded, contents); await refuseUnchanged(spaced);
  });
  await test("interruption before backup keeps valid active and uncommitted pending", async () => {
    const contents = payload(spaced); seed(encoded, contents); seed(`.${encoded}.pending-cut`, { [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8("{") });
    const pending = files.get(`${root}/.${encoded}.pending-cut/tilejson.json`);
    assert.equal((await rehydrate(spaced)).length, 1); assertOriginal(encoded, contents);
    assert.deepEqual(files.get(`${root}/.${encoded}.pending-cut/tilejson.json`), pending);
  });
  await test("interruption between backup and promotion restores paired prior edition", async () => {
    const contents = payload(spaced), backup = `.${encoded}.previous-cut`, pending = `.${encoded}.pending-cut`, old = `.${encoded}.previous-older`;
    seed(backup, contents); seed(pending, { [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8("{") }); seed(old, payload({ ...spaced, name: "Older retained edition" }));
    const pendingBytes = files.get(`${root}/${pending}/tilejson.json`), oldManifest = files.get(`${root}/${old}/manifest.json`);
    assert.equal((await rehydrate(spaced)).length, 1); assertOriginal(encoded, contents);
    assert(!directories.has(`${root}/${backup}`));
    assert.deepEqual(files.get(`${root}/${pending}/tilejson.json`), pendingBytes);
    assert.deepEqual(files.get(`${root}/${old}/manifest.json`), oldManifest);
    assert.equal((await rehydrate(spaced)).length, 1, "Reconciliation can run again");
  });
  await test("interruption after promotion keeps committed active and retained prior", async () => {
    const active = payload(spaced), prior = payload(spaced); active["tiles/12/856/1549.png"] = new Uint8Array([2]);
    seed(encoded, active); seed(`.${encoded}.previous-cut`, prior);
    assert.equal((await rehydrate(spaced)).length, 1); assertOriginal(encoded, active); assertOriginal(`.${encoded}.previous-cut`, prior);
    assert(!operations.some((entry) => entry.startsWith("move ")));
  });
  await test("single recorded prior edition can recover without pending", async () => {
    const contents = payload(spaced); seed(`.${encoded}.previous-cut`, contents);
    assert.equal((await rehydrate(spaced)).length, 1); assertOriginal(encoded, contents);
  });
  await test("interrupted initial installation never activates pending", async () => { seed(`.${encoded}.pending-cut`, payload(spaced)); await refuseUnchanged(spaced); });
  await test("multiple retained prior editions without transaction pair refuse", async () => { seed(`.${encoded}.previous-a`, payload(spaced)); seed(`.${encoded}.previous-b`, payload(spaced)); await refuseUnchanged(spaced); });
  await test("multiple pending transactions refuse", async () => { seed(`.${encoded}.previous-a`, payload(spaced)); seed(`.${encoded}.pending-a`, payload(spaced)); seed(`.${encoded}.pending-b`, payload(spaced)); await refuseUnchanged(spaced); });
  await test("unpaired pending and prior editions refuse", async () => { seed(`.${encoded}.previous-a`, payload(spaced)); seed(`.${encoded}.pending-b`, payload(spaced)); await refuseUnchanged(spaced); });
  await test("prior edition without recorded manifest refuses", async () => { seed(`.${encoded}.previous-a`, payload(spaced, false)); await refuseUnchanged(spaced); });
  await test("invalid active does not silently roll back to a valid prior edition", async () => { seed(encoded, { ...payload(spaced), [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8("{") }); seed(`.${encoded}.previous-a`, payload(spaced)); await refuseUnchanged(spaced); });
  await test("invalid paired prior cannot select unrelated historical backup", async () => { seed(`.${encoded}.previous-a`, { ...payload(spaced), [MAP_PACKAGE_TILEJSON_FILENAME]: strToU8("{") }); seed(`.${encoded}.pending-a`, payload(spaced)); seed(`.${encoded}.previous-b`, payload(spaced)); await refuseUnchanged(spaced); });
  await test("failed recovery rename preserves originals and permits retry", async () => {
    const contents = payload(spaced), backup = `.${encoded}.previous-a`; seed(backup, contents);
    failedMove = () => true; const before = snapshot(); assert.deepEqual(await rehydrate(spaced), []); assert.deepEqual(snapshot(), before);
    failedMove = null; assert.equal((await rehydrate(spaced)).length, 1); assertOriginal(encoded, contents);
  });
  await test("failed derived sidecar write preserves recovered originals and permits retry", async () => {
    const contents = payload(spaced); seed(`.${encoded}.previous-a`, contents); failedWrite = `${root}/${encoded}/${MAP_PACKAGE_RUNTIME_TILEJSON_FILENAME}`;
    assert.deepEqual(await rehydrate(spaced), []); assertOriginal(encoded, contents);
    failedWrite = null; assert.equal((await rehydrate(spaced)).length, 1); assertOriginal(encoded, contents);
  });
  await test("native replacement promotion failure synchronously restores prior bytes", async () => {
    const contents = payload(source); seed(source.id, contents);
    failedMove = (from) => from.includes(".pending-");
    await assert.rejects(() => native.installMapPackageArchiveZipAsync(archive), /Simulated move interruption/);
    assertOriginal(source.id, contents);
    assert(![...directories].some((entry) => entry.startsWith(`${root}/.${source.id}.pending-`)));
    assert(!operations.includes("UNAWAITED_ASYNC_MOVE"));
  });
  console.log(`Map package native recovery contract: ${passed} passed, ${failures.length} failed; memory bridge, not device proof.`);
  if (failures.length) throw new AggregateError(failures, "Map package native recovery regressions failed");
}
