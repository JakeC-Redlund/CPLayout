import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { convertPivotProjectToFieldDesign, sampleProject, serializeProjectDocument } from "@cplayout/core";
import { buildFieldDesignArchiveBundle, exportFieldDesignArchiveZip, importFieldDesignArchiveZip } from "./fieldDesignArchive";
import { importDesignDraftArchiveZip } from "./designDraftArchive";
import { importProjectArchiveZip } from "./projectArchive";

const now = "2026-09-27T12:00:00.000Z";
const original = ` \n${serializeProjectDocument(sampleProject)} \n`;
function field() {
  const field = convertPivotProjectToFieldDesign(original, { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  const second = structuredClone(field.machines[0]);
  second.id = "second"; second.configuration.spanLengthsMeters = [30, 40]; second.pivotCenter.x += 200;
  field.machines.push(second);
  return field;
}

test("dedicated field archive round-trips unequal pivots and exact original project text", () => {
  const value = field(); const before = structuredClone(value);
  const bundle = buildFieldDesignArchiveBundle(value, now, original);
  const bytes = exportFieldDesignArchiveZip(bundle);
  const reopened = importFieldDesignArchiveZip(bytes);
  assert.deepEqual(reopened, { field: before, originalProjectDocument: original });
  assert.notDeepEqual(reopened.field.machines[0].configuration.spanLengthsMeters, reopened.field.machines[1].configuration.spanLengthsMeters);
  assert.deepEqual(value, before);
  assert.throws(() => importDesignDraftArchiveZip(bytes));
  assert.throws(() => importProjectArchiveZip(bytes));
});

test("original source remains absent when none supplied and manifest identities cannot lie", () => {
  const bundle = buildFieldDesignArchiveBundle(field(), now);
  assert.deepEqual(importFieldDesignArchiveZip(exportFieldDesignArchiveZip(bundle)), { field: field() });
  const wrong = structuredClone(bundle); wrong.manifest.fieldId = "wrong";
  wrong.files["manifest.json"] = JSON.stringify(wrong.manifest);
  assert.throws(() => exportFieldDesignArchiveZip(wrong), /fieldId/);
  const undeclared = structuredClone(bundle); undeclared.files["original-project.json"] = original;
  assert.throws(() => exportFieldDesignArchiveZip(undeclared), /file set/);
  const broken = structuredClone(bundle); broken.manifest.fieldDocumentVersion = "field-design-v99" as never;
  broken.files["manifest.json"] = JSON.stringify(broken.manifest);
  assert.throws(() => exportFieldDesignArchiveZip(broken));
});

test("field archive refuses malformed source, unknown entries and duplicate JSON keys", () => {
  assert.throws(() => buildFieldDesignArchiveBundle(field(), now, original.replace('"id":', '"id":"ambiguous", "id":')));
  const bundle = buildFieldDesignArchiveBundle(field(), now);
  const raw = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])));
  assert.throws(() => importFieldDesignArchiveZip(raw({ ...bundle.files, "extra.json": "{}" })), /file count|Unexpected|unsupported/i);
  assert.throws(() => importFieldDesignArchiveZip(raw({ ...bundle.files, "field.json": bundle.files["field.json"].replace('"documentVersion":', '"documentVersion":"field-design-v99", "documentVersion":') })));
});

test("classified field v2 metadata survives the dedicated archive with its declared version", () => {
  const value = field();
  value.drawingMetadata = { schemaVersion: "field-drawing-metadata-v1", autosaveEnabled: false, records: [] };
  const bundle = buildFieldDesignArchiveBundle(value, now, original);
  assert.equal(bundle.manifest.fieldDocumentVersion, "field-design-v2");
  assert.deepEqual(importFieldDesignArchiveZip(exportFieldDesignArchiveZip(bundle)), { field: value, originalProjectDocument: original });
});

test("field v3 preserves explicit laterals and legacy original bytes through its dedicated archive", () => {
  const value = field();
  value.lateralMachines = [{ id: "lateral", kind: "straight_lateral", name: "Exact lateral",
    leftExtentMeters: 31.125, rightExtentMeters: 57.375, travelHeadingDegrees: 0,
    travel: { start: { x: 501200, y: 4506400 }, end: { x: 501350, y: 4506400 } },
    machineClearanceBufferMeters: 2.25, waterSourceId: "water" }];
  const bundle = buildFieldDesignArchiveBundle(value, now, original);
  assert.equal(bundle.manifest.fieldDocumentVersion, "field-design-v3");
  const reopened = importFieldDesignArchiveZip(exportFieldDesignArchiveZip(bundle));
  assert.deepEqual(reopened, { field: value, originalProjectDocument: original });
  const disguised = structuredClone(bundle);
  disguised.manifest.fieldDocumentVersion = "field-design-v2";
  disguised.files["manifest.json"] = JSON.stringify(disguised.manifest);
  disguised.files["field.json"] = disguised.files["field.json"].replace('"field-design-v3"', '"field-design-v2"');
  assert.throws(() => exportFieldDesignArchiveZip(disguised), /lateral|version|v3/i);
});
