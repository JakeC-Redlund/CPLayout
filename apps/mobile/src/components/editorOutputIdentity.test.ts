import assert from "node:assert/strict";
import { test } from "node:test";
import { convertPivotProjectToFieldDesign, createFieldLayoutTarget, defaultProjectSettings, parseFieldLayoutTarget, sampleProject,
  serializeFieldLayoutTarget, serializeProjectDocument, sha256Text, type DesignDraft } from "@cplayout/core";
import { buildDesignDraftArchiveBundle, buildFieldDesignArchiveBundle, exportDesignDraftArchiveZip, exportFieldDesignArchiveZip,
  importDesignDraftArchiveZip, importFieldDesignArchiveZip } from "@cplayout/project-store";
import { editorOutputIdentity, type EditorOutputSource } from "./editorOutputIdentity";

const source: EditorOutputSource = { designId: "saved-design", documentId: "document", document: "exact source text\n",
  savedRevision: 7, inputRevision: 3, scope: "draft", machineIds: ["pivot-1"] };

test("filename identifies saved base revision and applied input revision without changing source bytes", () => {
  const output = editorOutputIdentity(source);
  assert.equal(output.hash, sha256Text(source.document));
  assert.match(output.stem, /design-saved-design\.document\.machine-pivot-1\.r7\.e3\.[a-f0-9]{12}$/);
  assert.notEqual(editorOutputIdentity({ ...source, document: source.document.trim() }).hash, output.hash);
  assert.match(editorOutputIdentity({ ...source, savedRevision: null }).stem, /\.runconfirmed\./);
});

test("bounded filenames retain revisions and hash with arbitrary imported IDs and many machines", () => {
  const hostile = "../long imported /machine:*?".repeat(200);
  for (const scope of ["draft", "all-machines", "frozen-target"] as const) {
    const output = editorOutputIdentity({ ...source, designId: hostile, documentId: hostile,
      machineIds: Array.from({ length: 100 }, (_, index) => `${index}${hostile}`), scope,
      savedRevision: Number.MAX_SAFE_INTEGER, inputRevision: Number.MAX_SAFE_INTEGER });
    assert(`${output.stem}.field-layout-target.json`.length <= 220);
    assert(`${output.stem}.design-draft.cplayout.zip`.length <= 220);
    assert.match(output.stem, /^[A-Za-z0-9._-]+$/);
    assert(output.stem.includes(`r${Number.MAX_SAFE_INTEGER}.e${Number.MAX_SAFE_INTEGER}`));
    assert(output.stem.endsWith(output.hash.slice(0, 12)));
  }
});

test("draft labels hash the exact archive document and retain the historical archive shape", () => {
  const draft: DesignDraft = { id: "draft", name: "Draft", projectCrs: null, unitSystem: "us_survey_feet",
    settings: JSON.parse(JSON.stringify(defaultProjectSettings())), fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null,
    machine: {}, obstacles: [], surveyPoints: [] };
  draft.settings.unitSystem = draft.unitSystem;
  const bundle = buildDesignDraftArchiveBundle(draft, "2026-09-28T12:00:00.000Z");
  const before = JSON.stringify(bundle);
  const output = editorOutputIdentity({ ...source, documentId: draft.id, document: bundle.files["draft.json"], machineIds: [] });
  assert.match(output.stem, /machine-unassigned/);
  assert.equal(output.hash, sha256Text(bundle.files["draft.json"]));
  assert.equal(JSON.stringify(bundle), before);
  assert.deepEqual(Object.keys(bundle.files).sort(), ["draft.json", "manifest.json"]);
  assert.deepEqual(importDesignDraftArchiveZip(exportDesignDraftArchiveZip(bundle)), draft);
});

test("field ZIP identity covers all unequal machines and retains archive and original document bytes", () => {
  const original = ` \n${serializeProjectDocument(sampleProject)}\n `;
  const field = convertPivotProjectToFieldDesign(original, { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  field.machines.push({ ...structuredClone(field.machines[0]), id: "second-machine", pivotCenter: { x: 42.123456789, y: 73.987654321 } });
  const bundle = buildFieldDesignArchiveBundle(field, "2026-09-28T12:00:00.000Z", original);
  const before = JSON.stringify(bundle);
  const output = editorOutputIdentity({ ...source, scope: "all-machines", documentId: field.id, document: bundle.files["field.json"], machineIds: field.machines.map(machine => machine.id) });
  assert.match(output.stem, /all-machines-2/);
  assert.equal(JSON.stringify(bundle), before);
  assert.deepEqual(importFieldDesignArchiveZip(exportFieldDesignArchiveZip(bundle)), { field, originalProjectDocument: original });
});

test("frozen target filenames use retained source revision and machine IDs after source edits", () => {
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  const selectedId = field.machines[0].id;
  const document = serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 17, expectedRevision: 17, selectedMachineIds: [selectedId] }));
  field.machines[0].id = "later-machine"; field.name = "Later source name";
  const retained = parseFieldLayoutTarget(document);
  const output = editorOutputIdentity({ ...source, documentId: retained.source.fieldId, document, savedRevision: retained.source.inputRevision,
    inputRevision: 5, scope: "frozen-target", machineIds: retained.source.selectedMachineIds });
  assert(output.stem.includes(".r17.e5."));
  assert(!output.stem.includes("later-machine"));
  assert.equal(output.hash, sha256Text(document));
  assert.deepEqual(retained.source.selectedMachineIds, [selectedId]);
});
