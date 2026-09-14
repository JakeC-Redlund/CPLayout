import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";

import { defaultProjectSettings, evaluateDesignDraftCompleteness, type DesignDraft } from "@cplayout/core";
import {
  buildDesignDraftArchiveBundle,
  DESIGN_DRAFT_ARCHIVE_MAX_COMPRESSED_BYTES,
  DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES,
  DESIGN_DRAFT_ARCHIVE_MAX_FILE_COUNT,
  DESIGN_DRAFT_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
  exportDesignDraftArchiveZip,
  importDesignDraftArchiveZip,
  type DesignDraftArchiveBundle,
} from "./designDraftArchive";
import {
  PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES,
  PROJECT_ARCHIVE_MAX_ENTRY_BYTES,
  PROJECT_ARCHIVE_MAX_FILE_COUNT,
  PROJECT_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
} from "./projectArchive";

const createdAt = "2026-09-14T12:00:00.000Z";

function emptyDraft(): DesignDraft {
  const settings = defaultProjectSettings();
  delete settings.aerialImagery.sourcePackageId;
  return {
    id: "synthetic-archive-draft", name: "Synthetic empty draft", projectCrs: null,
    unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null,
    waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [],
  };
}

function completeDraft(): DesignDraft {
  return {
    ...emptyDraft(), projectCrs: "EPSG:32613",
    fieldBoundary: [{ x: 500000, y: 4400000 }, { x: 500200, y: 4400000 }, { x: 500200, y: 4400200 }, { x: 500000, y: 4400200 }],
    pivotCenter: { x: 500100, y: 4400100 }, waterSource: { x: 500090, y: 4400100 }, powerSource: { x: 500080, y: 4400100 },
    machine: {
      id: "synthetic-machine", name: "Synthetic machine", spanLengthsMeters: [30, 30],
      overhangMeters: 5, endGunThrowMeters: 0, towerClearanceBufferMeters: 0,
      machineClearanceBufferMeters: 0, sweep: { mode: "full_circle" },
    },
  };
}

function bundle(draft = emptyDraft()): DesignDraftArchiveBundle {
  return buildDesignDraftArchiveBundle(draft, createdAt);
}

function rawZip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
}

function rejectUnchanged(bytes: Uint8Array, pattern?: RegExp): void {
  const snapshot = bytes.slice();
  if (pattern) assert.throws(() => importDesignDraftArchiveZip(bytes), pattern);
  else assert.throws(() => importDesignDraftArchiveZip(bytes));
  assert.deepEqual(bytes, snapshot);
}

function roundtrip(draft: DesignDraft): DesignDraft {
  const snapshot = structuredClone(draft);
  const archive = bundle(draft);
  const archiveSnapshot = structuredClone(archive);
  const bytes = exportDesignDraftArchiveZip(archive);
  const byteSnapshot = bytes.slice();
  const imported = importDesignDraftArchiveZip(bytes);
  assert.deepEqual(imported, snapshot);
  assert.deepEqual(draft, snapshot);
  assert.deepEqual(archive, archiveSnapshot);
  assert.deepEqual(bytes, byteSnapshot);
  assert.notEqual(imported, draft);
  assert.equal(imported.id, draft.id);
  assert.deepEqual(Object.keys(unzipSync(bytes)).sort(), ["draft.json", "manifest.json"]);
  return imported;
}

interface FixtureEntry {
  name: string;
  contents: string;
  payload?: Uint8Array;
  originalSize?: number;
  compressedSize?: number;
  compression?: number;
  flags?: number;
  descriptor?: "signed" | "unsigned";
  extra?: Record<number, Uint8Array>;
  localName?: string;
  listed?: boolean;
  stored?: boolean;
}

/** Reassemble fflate-produced records; only ZIP headers change, never compression or CRC code. */
function craftedZip(entries: FixtureEntry[], options: { reverseDirectory?: boolean; comment?: string } = {}): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localLength = 0;
  for (const entry of entries) {
    const generatedName = entry.name === "__proto__" ? "prototype" : entry.name;
    const single = zipSync({ [generatedName]: [entry.payload ?? strToU8(entry.contents), { extra: entry.extra }] }, { level: entry.stored ? 0 : 6 });
    const source = new DataView(single.buffer, single.byteOffset, single.byteLength);
    const endOffset = single.byteLength - 22;
    const centralOffset = source.getUint32(endOffset + 16, true);
    let local = single.slice(0, centralOffset);
    const central = single.slice(centralOffset, endOffset);
    const localView = new DataView(local.buffer);
    const centralView = new DataView(central.buffer);
    if (generatedName !== entry.name) {
      const name = strToU8(entry.name);
      assert.equal(name.byteLength, localView.getUint16(26, true));
      local.set(name, 30);
      central.set(name, 46);
    }
    centralView.setUint32(42, localLength, true);
    if (entry.originalSize !== undefined) {
      localView.setUint32(22, entry.originalSize, true);
      centralView.setUint32(24, entry.originalSize, true);
    }
    if (entry.compressedSize !== undefined) {
      localView.setUint32(18, entry.compressedSize, true);
      centralView.setUint32(20, entry.compressedSize, true);
    }
    if (entry.compression !== undefined) {
      localView.setUint16(8, entry.compression, true);
      centralView.setUint16(10, entry.compression, true);
    }
    if (entry.flags !== undefined) {
      localView.setUint16(6, entry.flags, true);
      centralView.setUint16(8, entry.flags, true);
    }
    if (entry.localName !== undefined) {
      const name = strToU8(entry.localName);
      assert.equal(name.byteLength, localView.getUint16(26, true));
      local.set(name, 30);
    }
    if (entry.descriptor) {
      const descriptor = new Uint8Array(entry.descriptor === "signed" ? 16 : 12);
      const descriptorView = new DataView(descriptor.buffer);
      const start = entry.descriptor === "signed" ? 4 : 0;
      if (start) descriptorView.setUint32(0, 0x08074b50, true);
      descriptorView.setUint32(start, centralView.getUint32(16, true), true);
      descriptorView.setUint32(start + 4, centralView.getUint32(20, true), true);
      descriptorView.setUint32(start + 8, centralView.getUint32(24, true), true);
      localView.setUint16(6, localView.getUint16(6, true) | 8, true);
      centralView.setUint16(8, centralView.getUint16(8, true) | 8, true);
      for (const offset of [14, 18, 22]) localView.setUint32(offset, 0, true);
      const joined = new Uint8Array(local.byteLength + descriptor.byteLength);
      joined.set(local);
      joined.set(descriptor, local.byteLength);
      local = joined;
    }
    locals.push(local);
    if (entry.listed !== false) centrals.push(central);
    localLength += local.byteLength;
  }
  if (options.reverseDirectory) centrals.reverse();
  const centralLength = centrals.reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const comment = strToU8(options.comment ?? "");
  const end = new Uint8Array(22 + comment.byteLength);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centrals.length, true);
  endView.setUint16(10, centrals.length, true);
  endView.setUint32(12, centralLength, true);
  endView.setUint32(16, localLength, true);
  endView.setUint16(20, comment.byteLength, true);
  end.set(comment, 22);
  const result = new Uint8Array(localLength + centralLength + end.byteLength);
  let offset = 0;
  for (const part of [...locals, ...centrals, end]) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function fixtureEntries(): FixtureEntry[] {
  return Object.entries(bundle().files).map(([name, contents]) => ({ name, contents }));
}

test("empty and nullable inputs survive without fabricated project data or optional fields", () => {
  const imported = roundtrip(emptyDraft());
  assert.equal(imported.projectCrs, null);
  assert.deepEqual(imported.machine, {});
  assert.equal(Object.hasOwn(imported, "mapFeatures"), false);
  assert.equal(Object.hasOwn(imported.machine, "endGunAngleRanges"), false);
  assert.equal(evaluateDesignDraftCompleteness(imported).complete, false);
});

test("independently missing infrastructure and partial machine inputs round-trip", () => {
  for (const key of ["pivotCenter", "waterSource", "powerSource"] as const) {
    const draft = completeDraft();
    draft[key] = null;
    assert.equal(roundtrip(draft)[key], null);
  }
  for (const spans of [[], [null], [30, null, 45]]) {
    const draft = emptyDraft();
    draft.machine = { spanLengthsMeters: spans, sweep: { mode: "partial_circle", startAngleDegrees: 10 } };
    assert.deepEqual(roundtrip(draft).machine, draft.machine);
  }
});

test("complete draft remains draft-backed and preserves XY and identity", () => {
  const imported = roundtrip(completeDraft());
  assert.equal(evaluateDesignDraftCompleteness(imported).complete, true);
  assert.equal(evaluateDesignDraftCompleteness(imported).calculationEligible, true);
});

test("valid large finite inputs remain saveable despite calculation ineligibility", () => {
  const draft = completeDraft();
  draft.machine.spanLengthsMeters = [Number.MAX_VALUE, Number.MAX_VALUE];
  const imported = roundtrip(draft);
  assert.equal(evaluateDesignDraftCompleteness(imported).calculationEligible, false);
});

test("manifest has the distinct versions, nullable CRS and exact inventory", () => {
  const archive = bundle();
  assert.equal(archive.manifest.archiveVersion, "center-pivot-design-draft-archive-v1");
  assert.equal(archive.manifest.draftDocumentVersion, "design-draft-v1");
  assert.equal(archive.manifest.projectCrs, null);
  assert.equal(archive.manifest.createdAt, createdAt);
  assert.deepEqual(archive.manifest.files, ["manifest.json", "draft.json"]);
  assert.doesNotMatch(archive.files["draft.json"], /projectVersion|clientContacts|packageDirectory/);
});

test("crafted stored and deflated fixtures are valid before adversarial header changes", () => {
  for (const stored of [false, true]) {
    assert.deepEqual(importDesignDraftArchiveZip(craftedZip(fixtureEntries().map((entry) => ({ ...entry, stored })))), emptyDraft());
  }
});

test("rejects malformed manifest, unknown versions, kind and identity confusion", () => {
  const archive = bundle();
  const variants: unknown[] = [null, [], {}, { ...archive.manifest, archiveVersion: "center-pivot-project-archive-v1" },
    { ...archive.manifest, archiveVersion: "center-pivot-design-draft-archive-v2" },
    { ...archive.manifest, draftDocumentVersion: "design-draft-v2" },
    { ...archive.manifest, kind: "project" }, { ...archive.manifest, projectId: archive.manifest.draftId },
    { ...archive.manifest, draftId: "other" }, { ...archive.manifest, draftName: "Other" },
    { ...archive.manifest, projectCrs: "EPSG:32613" }, { ...archive.manifest, createdAt: "not-a-date" },
    { ...archive.manifest, paidServicesRequired: true }, { ...archive.manifest, offlineFirst: false }];
  for (const manifest of variants) rejectUnchanged(rawZip({ ...archive.files, "manifest.json": JSON.stringify(manifest) }));
  rejectUnchanged(rawZip({ ...archive.files, "manifest.json": "{" }));
  const complete = bundle(completeDraft());
  rejectUnchanged(rawZip({ ...complete.files, "manifest.json": JSON.stringify({ ...complete.manifest, projectCrs: null }) }), /projectCrs/);
});

test("rejects bare payloads, project envelopes and unsupported draft documents", () => {
  const archive = bundle();
  for (const payload of [emptyDraft(), { documentVersion: "design-draft-v2", draft: emptyDraft() },
    { documentVersion: "design-draft-v1", project: completeDraft() },
    { documentVersion: "design-draft-v1", draft: { ...emptyDraft(), clientContacts: [] } },
    { documentVersion: "design-draft-v1", draft: { ...emptyDraft(), projectCrs: null, pivotCenter: { x: 1, y: 2 } } }]) {
    rejectUnchanged(rawZip({ ...archive.files, "draft.json": JSON.stringify(payload) }));
  }
  rejectUnchanged(rawZip({ ...archive.files, "draft.json": "{" }));
});

test("rejects missing, unlisted, duplicate and unexpected manifest inventory", () => {
  const archive = bundle();
  for (const files of [[], ["manifest.json"], ["draft.json"], ["draft.json", "draft.json"],
    ["manifest.json", "project.json"], ["manifest.json", "draft.json", "extra.json"],
    ["manifest.json", "../draft.json"]]) {
    rejectUnchanged(rawZip({ ...archive.files, "manifest.json": JSON.stringify({ ...archive.manifest, files }) }));
  }
  for (const name of ["manifest.json", "draft.json"] as const) rejectUnchanged(rawZip({ [name]: archive.files[name] }), /exactly/);
  rejectUnchanged(rawZip({}), /exactly/);
});

test("duplicate central-directory entries fail before any expansion", () => {
  for (const duplicate of fixtureEntries()) {
    const corruptFirst = { ...duplicate, contents: "not JSON", compression: 8, stored: true };
    rejectUnchanged(craftedZip([corruptFirst, duplicate]), /duplicate/);
  }
});

test("rejects traversal, backslashes, absolute paths and unexpected entries", () => {
  for (const name of ["../draft.json", "/draft.json", "C:/draft.json", "C:\\draft.json", "folder\\draft.json",
    "./draft.json", "folder/../draft.json", "folder//draft.json", "folder/", "project.json", "exports/metrics.csv", "__proto__"]) {
    rejectUnchanged(craftedZip([{ name, contents: "{}" }, fixtureEntries()[0]]), /unsafe path|unexpected file/);
  }
});

test("rejects local-only files, duplicate local headers and central/local name mismatches", () => {
  const entries = fixtureEntries();
  rejectUnchanged(craftedZip([{ name: "extra.json", contents: "{}", listed: false }, ...entries]), /unlisted/);
  rejectUnchanged(craftedZip([{ ...entries[0], listed: false }, ...entries]), /unlisted local/);
  rejectUnchanged(craftedZip([entries[0], { ...entries[1], localName: "other.json" }]), /unlisted/);
});

test("rejects file-count and advertised compression budgets before expansion", () => {
  rejectUnchanged(craftedZip([...fixtureEntries(), { name: "extra.json", contents: "{}" }]), /file-count/);
  rejectUnchanged(new Uint8Array(DESIGN_DRAFT_ARCHIVE_MAX_COMPRESSED_BYTES + 1), /compressed size/);
  for (const compressedSize of [DESIGN_DRAFT_ARCHIVE_MAX_COMPRESSED_BYTES + 1, 100000]) {
    const entries = fixtureEntries();
    entries[0].compressedSize = compressedSize;
    rejectUnchanged(craftedZip(entries), /compressed size/);
  }
});

test("rejects per-entry and aggregate declared expansion budgets", () => {
  const entries = fixtureEntries();
  entries[0].originalSize = DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES + 1;
  rejectUnchanged(craftedZip(entries), /entry manifest.json exceeds/);
  rejectUnchanged(craftedZip(fixtureEntries().map((entry) => ({ ...entry, originalSize: DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES }))), /uncompressed size exceeds/);
  const inflated = fixtureEntries();
  inflated[1].contents = " ".repeat(DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES + 1);
  rejectUnchanged(craftedZip(inflated), /entry draft.json exceeds/);
});

test("actual output size rejects forged small and large declarations for both methods", () => {
  for (const stored of [false, true]) {
    for (const delta of [-1, 1]) {
      const entries = fixtureEntries().map((entry) => ({ ...entry, stored }));
      const target = entries[1];
      target.originalSize = strToU8(target.contents).byteLength + delta;
      rejectUnchanged(craftedZip(entries), /actual size mismatch/);
    }
  }
  const bomb = fixtureEntries();
  bomb[1] = { ...bomb[1], contents: " ".repeat(DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES + 1), originalSize: 1 };
  rejectUnchanged(craftedZip(bomb), /actual size mismatch|uncompressed size budget/);
});

test("invalid and truncated ZIP input is rejected without altering source bytes", () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([1, 2, 3]), new Uint8Array(25)]) rejectUnchanged(bytes);
  const valid = exportDesignDraftArchiveZip(bundle());
  rejectUnchanged(valid.slice(0, valid.byteLength - 5));
  rejectUnchanged(craftedZip(fixtureEntries().map((entry) => ({ ...entry, compression: 99 }))), /unsupported compression/);
});

test("export validates both manifest copies, payload identity and exact files without mutation", () => {
  const valid = bundle();
  const candidates: unknown[] = [
    { ...valid, manifest: { ...valid.manifest, draftName: "Changed copy" } },
    { ...valid, files: { ...valid.files, "manifest.json": JSON.stringify({ ...valid.manifest, draftId: "other" }) } },
    { ...valid, files: { ...valid.files, "draft.json": "{}" } },
    { ...valid, files: { ...valid.files, "project.json": "{}" } },
    { ...valid, files: { "draft.json": valid.files["draft.json"] } },
    { ...valid, files: { ...valid.files, "draft.json": " ".repeat(DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES + 1) } },
    { ...valid, contacts: [] },
  ];
  for (const candidate of candidates) {
    const before = structuredClone(candidate);
    assert.throws(() => exportDesignDraftArchiveZip(candidate as DesignDraftArchiveBundle));
    assert.deepEqual(candidate, before);
  }
  const mismatch = bundle();
  mismatch.manifest.draftName = "Wrong name in both copies";
  mismatch.files["manifest.json"] = JSON.stringify(mismatch.manifest);
  assert.throws(() => exportDesignDraftArchiveZip(mismatch), /draftName does not match/);
});

test("build and export reject invalid draft inputs without repairing or mutating them", () => {
  const invalid = emptyDraft();
  invalid.pivotCenter = { x: 1, y: 2 };
  const before = structuredClone(invalid);
  assert.throws(() => bundle(invalid), /Present XY/);
  assert.deepEqual(invalid, before);
  assert.throws(() => buildDesignDraftArchiveBundle(emptyDraft(), "bad-date"));
  const withLocalPath = emptyDraft();
  Object.assign(withLocalPath.settings.offlineMaps, { packageDirectory: "/local/private/tiles" });
  assert.throws(() => bundle(withLocalPath));
});

test("UTF-8 byte budgets and draft limits are no larger than legacy project limits", () => {
  const archive = bundle();
  archive.files["draft.json"] = "\u00e9".repeat(DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES / 2 + 1);
  assert.throws(() => exportDesignDraftArchiveZip(archive), /entry draft.json exceeds/);
  assert.ok(DESIGN_DRAFT_ARCHIVE_MAX_COMPRESSED_BYTES <= PROJECT_ARCHIVE_MAX_COMPRESSED_BYTES);
  assert.ok(DESIGN_DRAFT_ARCHIVE_MAX_ENTRY_BYTES <= PROJECT_ARCHIVE_MAX_ENTRY_BYTES);
  assert.ok(DESIGN_DRAFT_ARCHIVE_MAX_UNCOMPRESSED_BYTES <= PROJECT_ARCHIVE_MAX_UNCOMPRESSED_BYTES);
  assert.equal(DESIGN_DRAFT_ARCHIVE_MAX_FILE_COUNT, 2);
  assert.ok(DESIGN_DRAFT_ARCHIVE_MAX_FILE_COUNT <= PROJECT_ARCHIVE_MAX_FILE_COUNT);
});
