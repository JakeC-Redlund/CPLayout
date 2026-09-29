import assert from "node:assert/strict";
import test from "node:test";
import {
  convertPivotProjectToFieldDesign, parseDesignDraftDocument, parseFieldDesignDocument, parseProjectDocument,
  sampleProject, serializeDesignDraftDocument, serializeFieldDesignDocument, serializeProjectDocument,
} from "@cplayout/core";
import {
  applyWorkspaceCommand, emptyWorkspaceDocument, readWorkspaceDesign, buildProjectRecoveryArchiveBundle, exportProjectArchiveZip, buildDesignDraftArchiveBundle,
  exportDesignDraftArchiveZip, buildFieldDesignArchiveBundle, exportFieldDesignArchiveZip,
} from "@cplayout/project-store";
import { newDesignDraft } from "../newDesignDraft";
import { previewCatalogImport } from "./catalogArchiveImport";
const bytes = (value: string) => new TextEncoder().encode(value);
const draft = newDesignDraft("original-draft", "Partial field", "us_survey_feet");
const original = ` \n${serializeProjectDocument(sampleProject)}\n `;
const field = convertPivotProjectToFieldDesign(original, { fieldId: "original-field", waterSourceId: "water", powerSourceId: "power" }).field;

test("strict JSON previews preserve source identities, document strings and geometry", () => {
  const projectDocument = serializeProjectDocument(sampleProject);
  const projectPreview = previewCatalogImport(bytes(projectDocument), "design.json");
  assert.equal(projectPreview.kind, "project");
  assert.equal(projectPreview.document, projectDocument);
  assert.deepEqual(parseProjectDocument(projectPreview.document).fieldBoundary, sampleProject.fieldBoundary);
  assert.equal(parseProjectDocument(projectPreview.document).id, sampleProject.id);
  const draftDocument = serializeDesignDraftDocument(draft);
  const draftPreview = previewCatalogImport(bytes(draftDocument), "draft.json");
  assert.equal(draftPreview.kind, "draft");
  assert.equal(draftPreview.document, draftDocument);
  assert.equal(draftPreview.machineCount, 0);
  assert.deepEqual(parseDesignDraftDocument(draftPreview.document), draft);
  const fieldDocument = serializeFieldDesignDocument(field);
  const fieldPreview = previewCatalogImport(bytes(fieldDocument), "field.json");
  assert.equal(fieldPreview.kind, "field");
  assert.equal(fieldPreview.document, fieldDocument);
  assert.deepEqual(parseFieldDesignDocument(fieldPreview.document), field);
});

test("project, draft and field ZIPs use their strict importers and retain conversion evidence", () => {
  const projectPreview = previewCatalogImport(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(sampleProject)), "project.zip");
  assert.equal(projectPreview.kind, "project");
  assert.deepEqual(parseProjectDocument(projectPreview.document).fieldBoundary, sampleProject.fieldBoundary);
  const draftPreview = previewCatalogImport(exportDesignDraftArchiveZip(buildDesignDraftArchiveBundle(draft)), "draft.zip");
  assert.equal(draftPreview.kind, "draft");
  assert.deepEqual(parseDesignDraftDocument(draftPreview.document), draft);
  const archive = exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(field, undefined, original));
  const fieldPreview = previewCatalogImport(archive, "field.zip");
  assert.equal(fieldPreview.kind, "field");
  assert.equal(fieldPreview.originalProjectDocument, original);
  assert.deepEqual(parseFieldDesignDocument(fieldPreview.document), field);
  assert.equal(previewCatalogImport(archive, "download.bin").kind, "field");
});

test("unsupported formats, malformed JSON and future keys refuse before returning a candidate", () => {
  assert.throws(() => previewCatalogImport(bytes('<kml><Document/></kml>'), "field.kml"), /valid JSON/);
  assert.throws(() => previewCatalogImport(new Uint8Array([0xff, 0xfe]), "field.json"), /UTF-8/);
  assert.throws(() => previewCatalogImport(bytes('{"documentVersion":"pivot-project-v999"}'), "future.json"), /unsupported/);
  assert.throws(() => previewCatalogImport(bytes('{"a":1,"a":2}'), "duplicate.json"), /valid JSON/);
  const project = JSON.parse(serializeProjectDocument(sampleProject));
  project.project.futureEvidence = { mustRetain: true };
  assert.throws(() => previewCatalogImport(bytes(JSON.stringify(project)), "future-fields.json"), /unsupported fields/);
  assert.throws(() => previewCatalogImport(new Uint8Array(), "empty.json"), /nonempty/);
});

test("a mismatched ZIP manifest cannot fall through to another document type", () => {
  const bundle = buildProjectRecoveryArchiveBundle(sampleProject);
  const manifest = JSON.parse(bundle.files["manifest.json"]);
  manifest.projectId = "different-project";
  bundle.files["manifest.json"] = JSON.stringify(manifest);
  assert.throws(() => previewCatalogImport(exportProjectArchiveZip(bundle), "bad.zip"), /not a valid CPLayout design export/);
});

test("bare legacy project preview feeds the actual atomic import command without geometry loss", () => {
  const legacy = JSON.stringify(sampleProject);
  const preview = previewCatalogImport(bytes(legacy), "legacy.json");
  assert.equal(preview.kind, "project");
  assert.ok(JSON.parse(preview.document).documentVersion);
  assert.deepEqual(parseProjectDocument(preview.document).fieldBoundary, sampleProject.fieldBoundary);
  const now = "2026-09-28T20:00:00.000Z";
  let workspace = applyWorkspaceCommand(emptyWorkspaceDocument(), { type: "create_client", now, id: "customer", input: { primaryContactFirstName: "First", primaryContactLastName: "Last" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_design", now, input: { clientId: "customer", project: sampleProject, designId: "source", fieldMapId: "field" } }).workspace;
  const imported = applyWorkspaceCommand(workspace, { type: "import_design_document", now, fieldMapId: "field", designId: "imported", payloadId: "imported-payload", document: preview.document });
  const opened = readWorkspaceDesign(imported.workspace, "imported");
  assert.equal(opened.kind, "project");
  if (opened.kind === "project") {
    assert.equal(opened.project.id, "imported-payload");
    assert.deepEqual(opened.project.fieldBoundary, sampleProject.fieldBoundary);
    assert.deepEqual(opened.project.machine, parseProjectDocument(legacy).machine);
  }
});
