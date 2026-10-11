import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import {
  sampleProject, defaultProjectSettings, serializeProjectDocument, serializeDesignDraftDocument,
  serializeFieldDesignDocument, convertPivotProjectToFieldDesign, createSurveyCollection,
  parseSurveyCollectionDocument, readSurveyDesignDocument, isRecordedReferenceMetadataRecord,
  createFieldLayoutTarget, serializeFieldLayoutTarget, createProjectEditorState, reduceProjectEditorState,
  projectLonLatToXy, sha256Text,
  parseFieldLayoutTarget, parseLayoutSessionDocument,
  mergeRetainedReferenceOrigins,
  type SurveyPoint, type DesignDraft, type PivotProject, type FieldDesign,
} from "@cplayout/core";
import { createVersionedProjectRepository } from "./versionedProjectRepository";
import { createSqliteWorkspaceStore, assertNativeWorkspaceVersion } from "./sqliteWorkspaceStore";
import { WEB_WORKSPACE_KEY, type WorkspaceLocks } from "./webWorkspaceStore";
import { parseWorkspaceDocument, validateWorkspaceDocument, workspaceDesignSource } from "./workspaceDocument";
import { buildDesignWorkspaceBundle, parseDesignWorkspaceBundle, exportDesignWorkspaceBundleZip, importDesignWorkspaceBundleZip } from "./designWorkspaceBundle";
import { buildDesignDraftArchiveBundle, exportDesignDraftArchiveZip, importDesignDraftArchiveZip } from "./designDraftArchive";
import { buildFieldDesignArchiveBundle, exportFieldDesignArchiveZip, importFieldDesignArchiveZip } from "./fieldDesignArchive";
import { buildProjectRecoveryArchiveBundle, exportProjectArchiveZip, importProjectArchiveZip } from "./projectArchive";
import { exportLayoutSessionArchiveZip, importLayoutSessionArchiveZip } from "./layoutSessionArchive";
import type { WorkspaceCommand } from "./workspaceCommands";

const now = "2026-10-10T12:00:00.000Z";
const require = createRequire(import.meta.url);
const fixturePath = fileURLToPath(new URL("../../../tests/fixtures/recorded-reference-legacy-reader.cjs", import.meta.url));
const legacy = require(fixturePath) as Record<string, (value: unknown) => unknown>;
const fixtureVerifier = require(fileURLToPath(new URL("../../../tools/buildRecordedReferenceLegacyReader.cjs", import.meta.url))) as { verify(path: string): { outputSha256: string } };
class Storage {
  values = new Map<string, string>(); fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail && key === WEB_WORKSPACE_KEY) throw new Error("Synthetic quota failure"); this.values.set(key, value); }
}
class Locks implements WorkspaceLocks {
  tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, _options: { mode: "exclusive" }, run: () => T | PromiseLike<T>): Promise<T> {
    const result = this.tail.then(run); this.tail = result.catch(() => undefined); return result;
  }
}
type Kind = "project" | "draft" | "field";
async function fixture(kind: Kind = "draft", complete = false) {
  const storage = new Storage(), locks = new Locks();
  const api = createVersionedProjectRepository({ getStorage: () => storage, getLocks: () => locks }).versionedWorkspace!;
  let current = await api.readAsync();
  const execute = async (command: unknown) => {
    const result = await api.executeAsync(current.revision, { now, ...command as object } as WorkspaceCommand, () => true);
    current = result.workspace; return result;
  };
  await execute({ type: "create_client", id: "client", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  await execute({ type: "create_project_with_initial_field_map", input: { clientId: "client", projectId: "folder", projectName: "Synthetic", projectCrs: sampleProject.projectCrs, unitSystem: "metric", fieldMapId: "map" } });
  await execute({ type: "upgrade_workspace_to_v3" });
  if (kind === "project") await execute({ type: "import_design_document", designId: "design", payloadId: "payload", fieldMapId: "map", document: serializeProjectDocument(sampleProject) });
  else if (kind === "field") await execute({ type: "create_field_design", designId: "design", fieldMapId: "map", name: "Field", field: convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "payload", waterSourceId: "water", powerSourceId: "power" }).field });
  else {
    const draft: DesignDraft = complete ? { ...structuredClone(sampleProject), id: "payload", settings: defaultProjectSettings() }
      : { id: "payload", name: "Incomplete", projectCrs: sampleProject.projectCrs, unitSystem: "metric", settings: { ...defaultProjectSettings(), unitSystem: "metric" }, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
    await execute({ type: "create_design_draft", designId: "design", fieldMapId: "map", name: draft.name, draft });
  }
  await execute({ type: "upgrade_workspace_to_v4" });
  return { api, storage, execute, current: () => current, kind };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function point(id: string, x: number, y: number): SurveyPoint {
  return { id, label: `Exact ${id}  `, notes: "Historical notes\nretained", role: "control", projected: { x, y }, observedAt: now,
    source: "external_gnss", confidence: "rtk_float", captureEvidence: { schemaVersion: "gnss-capture-v1", observationId: `receiver-${id}`, sessionId: "historical", transport: "replay", receivedAt: now,
      receivedMonotonicMs: 1, sourceCoordinateFrame: "EPSG:4326", antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true } };
}
const historicalPoints = [point("a", 500100, 4400100), point("b", 500200, 4400100), point("c", 500100, 4400200)];
function livePoint(sequence: number, latitude = 40, longitude = -105): SurveyPoint {
  const coord = (value: number, width: number) => `${String(Math.floor(Math.abs(value))).padStart(width, "0")}${((Math.abs(value) % 1) * 60).toFixed(4).padStart(7, "0")}`;
  const utcTime = `1200${String(sequence).padStart(2, "0")}.00`;
  const nmea = `GNGGA,${utcTime},${coord(latitude, 2)},N,${coord(longitude, 3)},W,4,12,0.8,1600.0,M,-20.0,M,1.0,42`;
  const checksum = [...nmea].reduce((value, char) => value ^ char.charCodeAt(0), 0).toString(16).padStart(2, "0");
  return { id: ["a", "b", "c"][sequence - 1], label: "Synthetic captured point", role: "control", projected: projectLonLatToXy({ latitude, longitude }, sampleProject.projectCrs), wgs84: { latitude, longitude },
    observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: { schemaVersion: "gnss-operational-fixed-v1", observationId: `receiver:${sequence}`, sessionId: "receiver", transport: "local_udp", receivedAt: now,
      receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
      gga: { sentence: `$${nmea}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime, qualityCode: 4, latitude, longitude },
      receipt: { sequence, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" },
      capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 }, projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" } };
}
const points = [livePoint(1), livePoint(2, 40.01), livePoint(3, 40, -105.01)];
const referenceKinds = ["reference_point", "reference_line", "reference_area"] as const;
const geometryTypes = ["Point", "LineString", "Polygon"] as const;
function source(f: Fixture, designId = "design") { return workspaceDesignSource(f.current(), designId); }
function payload(f: Fixture, designId = "design") { const owner = source(f, designId); return readSurveyDesignDocument(owner.kind, owner.document); }
function record(f: Fixture, designId = "design") {
  const result = payload(f, designId).drawingMetadata!.records[0]; assert.ok(isRecordedReferenceMetadataRecord(result)); return result;
}
function collection(f: Fixture, id = "survey") { return parseSurveyCollectionDocument(f.current().surveyCollections!.find(entry => entry.id === id)!.document); }
async function pending(f: Fixture, index = 1, purpose = { kind: "map_feature" as const, featureKind: referenceKinds[index], geometryType: geometryTypes[index] }) {
  const owner = source(f), data = payload(f);
  await f.execute({ type: "create_survey_collection", expectedDesignRevision: owner.design.revision,
    collection: createSurveyCollection({ id: "survey", now, purpose, owner: { designId: "design", documentKind: owner.kind, payloadId: data.id, fieldMapId: "map", projectCrs: data.projectCrs! } }) });
  for (const observed of points.slice(0, index + 1)) await f.execute({ type: "append_survey_capture", collectionId: "survey", expectedCollectionRevision: collection(f).revision, expectedDesignRevision: source(f).design.revision, point: observed });
}
async function apply(f: Fixture, reference: { name: string; notes?: string } | undefined = { name: " Actual reference  ", notes: "Source notes\nraw" }) {
  return f.execute({ type: "apply_survey_collection", collectionId: "survey", expectedCollectionRevision: collection(f).revision,
    expectedDesignRevision: source(f).design.revision, applicationId: "application", targetId: "reference", ...(reference === undefined ? {} : { reference }) });
}
async function save(f: Fixture, data: ReturnType<typeof payload>, designId = "design") {
  const design = source(f, designId).design;
  return f.execute(design.kind === "project" ? { type: "save_design_project", designId: design.id, project: data }
    : design.kind === "draft" ? { type: "save_design_draft", designId: design.id, expectedDesignRevision: design.revision, draft: data }
      : { type: "save_field_design", designId: design.id, expectedDesignRevision: design.revision, field: data });
}
function deletedReference(data: ReturnType<typeof payload>) {
  return { ...data, mapFeatures: data.mapFeatures!.filter(feature => feature.id !== "reference"),
    drawingMetadata: { ...data.drawingMetadata!, records: data.drawingMetadata!.records.filter(record => record.target.kind !== "map_feature" || record.target.id !== "reference") } } as typeof data;
}
function serializePayload(kind: Kind, data: ReturnType<typeof payload>): string {
  return kind === "project" ? serializeProjectDocument(data as PivotProject) : kind === "draft" ? serializeDesignDraftDocument(data as DesignDraft) : serializeFieldDesignDocument(data as FieldDesign);
}
function copyCommand(f: Fixture, destination = "copy") {
  return { type: "copy_design_with_survey", sourceDesignId: "design", expectedDesignRevision: source(f).design.revision, designId: destination,
    payloadId: `${destination}-payload`, fieldMapId: "map", name: destination, collectionIds: [{ sourceId: "survey", id: `${destination}-survey`, expectedRevision: collection(f).revision }] };
}
async function importHistoricalAndApply(f: Fixture) {
  const owner = source(f), document = owner.document;
  const captured = { ...createSurveyCollection({ id: "historical-source", now,
    owner: { designId: "design", documentKind: owner.kind, payloadId: owner.payloadId, fieldMapId: "map", projectCrs: sampleProject.projectCrs },
    purpose: { kind: "map_feature", featureKind: "reference_line", geometryType: "LineString" } }), revision: 2,
    observations: historicalPoints.slice(0, 2), activePointIds: ["a", "b"] };
  const surveyDocument = JSON.stringify(captured);
  const bundle = parseDesignWorkspaceBundle({ bundleVersion: "cplayout-design-workspace-bundle-v1", designId: "design", documentKind: owner.kind, payloadId: owner.payloadId, fieldMapId: "map",
    designDocument: document, surveyDocuments: [surveyDocument], inventory: [{ filename: "design.json", sha256: sha256Text(document) }, { filename: "survey-0.json", sha256: sha256Text(surveyDocument) }] });
  await f.execute({ type: "import_design_workspace_bundle", bundle, designId: "historical", payloadId: "historical-payload", fieldMapId: "map", collectionIds: [{ sourceId: "historical-source", id: "historical-current", expectedRevision: 2 }] });
  await f.execute({ type: "apply_survey_collection", collectionId: "historical-current", expectedCollectionRevision: 0, expectedDesignRevision: 0, applicationId: "historical-application", targetId: "reference", reference: { name: "Historical reference" } });
  return payload(f, "historical");
}
function falselyOldArchive(bytes: Uint8Array, filename: string, versionKey: string, oldVersion: string): Uint8Array {
  const files = unzipSync(bytes), document = JSON.parse(strFromU8(files[filename])), manifest = JSON.parse(strFromU8(files["manifest.json"]));
  document.documentVersion = oldVersion; manifest[versionKey] = oldVersion;
  files[filename] = strToU8(JSON.stringify(document)); files["manifest.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

test("frozen actual old reader output and every external runtime library remain unchanged", () => {
  assert.equal(fixtureVerifier.verify(fixturePath).outputSha256, "443a00825cd4d08afc9edb9cb6b050b0f7b9d0aece67d7a6ef04ce56ebfeba03");
  assert.equal(legacy.serializeProjectDocument(legacy.parseProjectDocument(serializeProjectDocument(sampleProject))), serializeProjectDocument(sampleProject));
});

test("actual frozen readers continue accepting metadata-free workspace, bundle, archive, target and session data", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind);
    assert.doesNotThrow(() => legacy.parseWorkspaceDocument(f.storage.getItem(WEB_WORKSPACE_KEY)!));
    const bundle = buildDesignWorkspaceBundle(f.current(), "design");
    assert.doesNotThrow(() => legacy.parseDesignWorkspaceBundle(bundle)); assert.doesNotThrow(() => legacy.importDesignWorkspaceBundleZip(exportDesignWorkspaceBundleZip(bundle)));
    if (kind === "draft") assert.doesNotThrow(() => legacy.importDesignDraftArchiveZip(exportDesignDraftArchiveZip(buildDesignDraftArchiveBundle(payload(f) as DesignDraft, now))));
    else if (kind === "project") assert.doesNotThrow(() => legacy.importProjectArchiveZip(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(payload(f) as PivotProject, now))));
    else {
      const field = payload(f) as FieldDesign;
      assert.doesNotThrow(() => legacy.importFieldDesignArchiveZip(exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(field, now))));
      const target = serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 0, expectedRevision: 0, selectedMachineIds: [field.machines[0].id] }));
      assert.doesNotThrow(() => legacy.parseFieldLayoutTarget(target));
      await f.execute({ type: "create_layout_session", sessionId: "layout", fieldMapId: "map", name: "Layout", targetDocument: target });
      assert.doesNotThrow(() => legacy.parseLayoutSessionDocument(f.current().layoutSessions![0].document));
      assert.doesNotThrow(() => legacy.importLayoutSessionArchiveZip(exportLayoutSessionArchiveZip(parseLayoutSessionDocument(f.current().layoutSessions![0].document))));
    }
  }
});

for (const kind of ["draft", "project", "field"] as const) test(`${kind} imported historical collection applies disconnected through actual commands without new-live append`, async () => {
  const f = await fixture(kind), document = source(f).document;
  await importHistoricalAndApply(f);
  assert.deepEqual(record(f, "historical").capture.origin.observations, historicalPoints.slice(0, 2));
  assert.equal(record(f, "historical").capture.origin.sourceCollectionRevision, 0);
  assert.equal(record(f, "historical").capture.origin.receipt.designRevision, 1);
  assert.equal(source(f).document, document);
});

for (const kind of ["draft", "project", "field"] as const) for (const index of [0, 1, 2]) test(`${kind} ${referenceKinds[index]} persists atomically with exact snapshots and accepted revisions`, async () => {
  const f = await fixture(kind), initial = source(f).document; await pending(f, index);
  const before = collection(f), designRevision = source(f).design.revision; await apply(f);
  const observed = record(f), accepted = collection(f), reopened = await f.api.readAsync();
  assert.deepEqual(reopened, f.current());
  assert.equal(observed.binding, "recorded"); assert.equal(observed.capture.origin.sourceCollectionRevision, before.revision);
  assert.equal(observed.capture.origin.receipt.designRevision, designRevision + 1);
  assert.equal(accepted.revision, before.revision + 1);
  assert.deepEqual(observed.capture.origin.observations, before.observations);
  assert.deepEqual(observed.capture.origin.receipt, accepted.applications[0]);
  assert.deepEqual(observed.capture.origin.owner, before.owner); assert.deepEqual(observed.capture.origin.purpose, before.purpose);
  assert.deepEqual(observed.attachment, { collectionId: "survey", applicationId: "application" });
  assert.equal(JSON.parse(source(f).document).documentVersion, kind === "draft" ? "design-draft-v5" : kind === "project" ? "pivot-project-v4" : "field-design-v6");
  assert.notEqual(source(f).document, initial);
});

test("reference command names are mandatory and refused for non-reference purposes", async () => {
  const f = await fixture(); await pending(f); const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  const cmd = { type: "apply_survey_collection", collectionId: "survey", expectedCollectionRevision: 2, expectedDesignRevision: 0, applicationId: "application", targetId: "reference" };
  await assert.rejects(f.execute(cmd), /name|reference/i);
  await assert.rejects(f.execute({ ...cmd, reference: { name: "Name", agriculturalPurpose: "invented" } }), /invalid/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  const nonReference = await fixture();
  await pending(nonReference, 1, { kind: "map_feature", featureKind: "measurement_line", geometryType: "LineString" } as never);
  const otherBefore = nonReference.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(apply(nonReference), /only.*reference/i);
  assert.equal(nonReference.storage.getItem(WEB_WORKSPACE_KEY), otherBefore);
});

test("quota, stale collection/design/workspace revisions and invalid target create no partial reference or receipt", async () => {
  const f = await fixture(); await pending(f); const before = f.storage.getItem(WEB_WORKSPACE_KEY), revision = f.current().revision;
  const cmd = { type: "apply_survey_collection", now, collectionId: "survey", expectedCollectionRevision: 2, expectedDesignRevision: 0, applicationId: "application", targetId: "reference", reference: { name: "Name" } } as const;
  for (const bad of [{ ...cmd, expectedCollectionRevision: 1 }, { ...cmd, expectedDesignRevision: 1 }, { ...cmd, targetId: undefined }]) await assert.rejects(f.execute(bad));
  await assert.rejects(f.api.executeAsync(revision - 1, cmd));
  f.storage.fail = true; await assert.rejects(f.execute(cmd), /quota|storage|atomic/i); f.storage.fail = false;
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before); assert.equal(collection(f).applications.length, 0); assert.equal(payload(f).mapFeatures?.length ?? 0, 0);
  await apply(f); assert.equal(record(f).capture.origin.receipt.designRevision, 1);
});

for (const kind of ["draft", "project", "field"] as const) test(`${kind} complete copy and bundle import remap current locators while origin/receipt and clone revision zero remain exact`, async () => {
  const f = await fixture(kind); await pending(f); await apply(f); const original = record(f), ledger = collection(f), sourceDocument = source(f).document;
  const bundle = buildDesignWorkspaceBundle(f.current(), "design");
  assert.deepEqual(importDesignWorkspaceBundleZip(exportDesignWorkspaceBundleZip(bundle)), bundle);
  await f.execute(copyCommand(f));
  assert.equal(source(f).document, sourceDocument); assert.deepEqual(record(f).capture.origin, original.capture.origin);
  assert.deepEqual(record(f, "copy").capture.origin, original.capture.origin);
  assert.equal(record(f, "copy").attachment!.collectionId, "copy-survey");
  assert.equal(collection(f, "copy-survey").revision, 0); assert.deepEqual(collection(f, "copy-survey").applications, ledger.applications);
  await f.execute({ type: "import_design_workspace_bundle", bundle, designId: "import", payloadId: "import-payload", fieldMapId: "map", collectionIds: [{ sourceId: "survey", id: "import-survey", expectedRevision: ledger.revision }] });
  assert.deepEqual(record(f, "import").capture.origin, original.capture.origin); assert.equal(record(f, "import").attachment!.collectionId, "import-survey");
  assert.equal(collection(f, "import-survey").revision, 0); assert.deepEqual(collection(f, "import-survey").observations, ledger.observations);
});

test("copy/import mapping gaps, duplicates, stale sources and occupied destinations preserve the exact workspace", async () => {
  const f = await fixture(); await pending(f); await apply(f); const command = copyCommand(f), before = f.storage.getItem(WEB_WORKSPACE_KEY);
  for (const collectionIds of [[], [{ sourceId: "foreign", id: "copy-survey", expectedRevision: 3 }], [{ sourceId: "survey", id: "copy-survey", expectedRevision: 2 }],
    [{ sourceId: "survey", id: "survey", expectedRevision: 3 }], [...command.collectionIds, ...command.collectionIds]]) {
    await assert.rejects(f.execute({ ...command, collectionIds })); assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  }
  f.storage.fail = true; await assert.rejects(f.execute(command)); f.storage.fail = false;
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before); assert.equal(f.current().catalog.designs.length, 1); assert.equal(f.current().surveyCollections!.length, 1);
});

test("foreign/dangling attachments refuse editable, archived owner and complete bundle admission", async () => {
  const f = await fixture(); await pending(f); await apply(f);
  for (const change of [(w: ReturnType<typeof f.current>) => { w.surveyCollections = []; },
    (w: ReturnType<typeof f.current>) => { const raw = JSON.parse(w.draftDocuments[0].document); raw.draft.drawingMetadata.records[0].attachment.collectionId = "foreign"; w.draftDocuments[0].document = JSON.stringify(raw); },
    (w: ReturnType<typeof f.current>) => { w.surveyCollections!.push(structuredClone(w.surveyCollections![0])); }]) {
    const bad = structuredClone(f.current()); change(bad); assert.throws(() => validateWorkspaceDocument(bad));
  }
  const bundle = buildDesignWorkspaceBundle(f.current(), "design");
  assert.throws(() => parseDesignWorkspaceBundle({ ...bundle, surveyDocuments: [] }), /current collection/i);
  assert.throws(() => parseDesignWorkspaceBundle({ ...bundle, surveyDocuments: [...bundle.surveyDocuments, ...bundle.surveyDocuments] }), /Duplicate/i);
  await f.execute({ type: "archive_and_delete_design", designId: "design", expectedDesignRevision: 1, collectionIds: [{ id: "survey", expectedRevision: 3 }] });
  assert.deepEqual(record(f).capture.origin.receipt, collection(f).applications[0]);
  const archived = structuredClone(f.current()), raw = JSON.parse(archived.surveyOwnerArchives![0].document);
  raw.draft.drawingMetadata.records[0].attachment.collectionId = "dangling"; archived.surveyOwnerArchives![0].document = JSON.stringify(raw);
  assert.throws(() => validateWorkspaceDocument(archived));
});

for (const kind of ["draft", "project", "field"] as const) test(`${kind} standalone import retires locators, preserves origin, and creates no collection`, async () => {
  const f = await fixture(kind); await pending(f); await apply(f); const original = record(f), document = source(f).document, count = f.current().surveyCollections!.length;
  await f.execute({ type: "import_design_document", document, designId: "standalone", payloadId: "standalone-payload", fieldMapId: "map" });
  assert.deepEqual(record(f, "standalone").capture.origin, original.capture.origin); assert.equal(record(f, "standalone").attachment, undefined);
  assert.equal(f.current().surveyCollections!.length, count); assert.equal(source(f).document, document);
  const unresolved = JSON.parse(document), data = unresolved[kind === "draft" ? "draft" : kind === "field" ? "field" : "project"];
  data.drawingMetadata.records[0].attachment.collectionId = "unresolved-outside-source-workspace";
  await f.execute({ type: "import_design_document", document: JSON.stringify(unresolved), designId: "detached", payloadId: "detached-payload", fieldMapId: "map" });
  assert.equal(record(f, "detached").attachment, undefined); assert.deepEqual(record(f, "detached").capture.origin, original.capture.origin);
});

test("completion supports collection-free retirement and complete current-locator remapping without altering the source", async () => {
  for (const withCollections of [false, true]) {
    const f = await fixture("draft", true); await pending(f); await apply(f); const original = record(f), ledger = f.current().surveyCollections![0].document;
    await f.execute({ type: "create_complete_design_from_draft", sourceDesignId: "design", expectedDesignRevision: 1, draft: payload(f), designId: "complete", projectId: "complete-payload", name: "Complete",
      ...(withCollections ? { surveyCollectionIds: [{ sourceId: "survey", id: "complete-survey", expectedRevision: 3 }] } : {}) });
    assert.deepEqual(record(f, "complete").capture.origin, original.capture.origin);
    assert.equal(record(f, "complete").attachment?.collectionId, withCollections ? "complete-survey" : undefined);
    assert.equal(f.current().surveyCollections![0].document, ledger); assert.equal(record(f).attachment!.collectionId, "survey");
  }
});

test("explicit Project→Field conversion retires current locators and preserves the exact original document", async () => {
  const f = await fixture("project"); await pending(f); await apply(f); const document = source(f).document, original = record(f);
  await f.execute({ type: "convert_project_to_field_design", sourceDesignId: "design", expectedDesignRevision: 1, designId: "converted", fieldMapId: "map", name: "Converted", fieldId: "converted-payload", waterSourceId: "converted-water", powerSourceId: "converted-power" });
  assert.equal(record(f, "converted").attachment, undefined); assert.deepEqual(record(f, "converted").capture.origin, original.capture.origin);
  assert.equal(f.current().fieldDocuments!.find(entry => entry.id === "converted-payload")!.originalProjectDocument, document); assert.equal(source(f).document, document);
});

test("destination catalog CRS mismatch refuses complete copy, bundle/standalone import and conversion without relabelling", async () => {
  const f = await fixture("project"); await pending(f); await apply(f);
  await f.execute({ type: "create_project_record", input: { id: "other-folder", clientId: "client", name: "Other", projectCrs: "EPSG:32614", unitSystem: "metric" } });
  await f.execute({ type: "create_field_map_record", input: { id: "other-map", projectId: "other-folder", name: "Other" } });
  const before = f.storage.getItem(WEB_WORKSPACE_KEY), bundle = buildDesignWorkspaceBundle(f.current(), "design");
  for (const command of [{ ...copyCommand(f), fieldMapId: "other-map" },
    { type: "import_design_workspace_bundle", bundle, designId: "import", payloadId: "import-payload", fieldMapId: "other-map", collectionIds: copyCommand(f).collectionIds },
    { type: "import_design_document", designId: "standalone", payloadId: "standalone-payload", fieldMapId: "other-map", document: source(f).document },
    { type: "convert_project_to_field_design", sourceDesignId: "design", expectedDesignRevision: 1, designId: "converted", fieldMapId: "other-map", name: "Converted", fieldId: "converted-payload", waterSourceId: "water", powerSourceId: "power" }]) {
    await assert.rejects(f.execute(command), /CRS/i); assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  }
});

test("ordinary Save rejects removed/retyped origins for surviving geometry, retains edited history and ledger after deletion", async () => {
  const f = await fixture("project"); await pending(f); await apply(f); const original = record(f), ledger = f.current().surveyCollections![0].document;
  for (const omit of [true, false]) {
    const data = payload(f); if (omit) delete data.drawingMetadata; else data.drawingMetadata!.records = [];
    const before = f.storage.getItem(WEB_WORKSPACE_KEY); await assert.rejects(save(f, data)); assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  }
  const retyped = payload(f), feature = retyped.mapFeatures![0];
  retyped.drawingMetadata!.records = [{ target: { kind: "map_feature", id: "reference" }, classification: {
    schemaVersion: "agricultural-feature-classification-v1", geometryType: "LineString", purposeId: "reference_line", name: feature.name, notes: feature.notes!, assetStatus: "unknown",
    placement: "not_applicable", customLabel: null, effect: { mode: "informational" } }, capture: { captureId: "retyped", source: "map_digitized", vertexRecordedAt: [null, null], wgs84: null, elevation: null } }];
  const beforeRetype = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(save(f, retyped), /origin|retyped/i); assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), beforeRetype);
  let editor = createProjectEditorState(payload(f) as PivotProject);
  editor = reduceProjectEditorState(editor, { type: "move_map_feature_vertex", featureId: "reference", vertexIndex: 0, point: { x: 500110, y: 4400110 } });
  assert.equal(editor.lastError, null); await save(f, editor.project);
  assert.equal(record(f).binding, "edited"); assert.deepEqual(record(f).capture.origin, original.capture.origin);
  editor = reduceProjectEditorState(editor, { type: "delete_map_feature", id: "reference" }); await save(f, editor.project);
  assert.equal(payload(f).mapFeatures!.length, 0); assert.equal(payload(f).drawingMetadata!.records.length, 0);
  assert.equal(f.current().surveyCollections![0].document, ledger);
});

for (const kind of ["draft", "project", "field"] as const) test(`${kind} current reference name/notes save preserves immutable origin and attachment`, async () => {
  const f = await fixture(kind); await pending(f); await apply(f); const original = record(f), data = payload(f);
  const metadata = data.drawingMetadata!.records[0]; assert.ok(isRecordedReferenceMetadataRecord(metadata));
  data.mapFeatures![0].name = "Renamed actual reference"; data.mapFeatures![0].notes = "Updated current notes";
  metadata.meaning.name = data.mapFeatures![0].name; metadata.meaning.notes = data.mapFeatures![0].notes;
  await save(f, data);
  assert.deepEqual(record(f).capture.origin, original.capture.origin); assert.deepEqual(record(f).attachment, original.attachment);
  assert.equal(record(f).meaning.name, "Renamed actual reference"); assert.equal(record(f).binding, "recorded");
});

for (const route of ["standalone-project", "standalone-draft", "standalone-field", "completion", "conversion"] as const) test(`detached ${route} real repository Delete→Save→Undo→Save retains exact authorised origin without an owner collection`, async () => {
  const kind = route === "completion" || route === "standalone-draft" ? "draft" : route === "standalone-field" ? "field" : "project";
  const f = await fixture(kind, route === "completion"); await pending(f); await apply(f);
  const origin = record(f).capture.origin, sourceDocument = source(f).document;
  if (route === "completion") await f.execute({ type: "create_complete_design_from_draft", sourceDesignId: "design", expectedDesignRevision: 1, draft: payload(f), designId: "detached", projectId: "detached-payload", name: "Complete" });
  else if (route === "conversion") await f.execute({ type: "convert_project_to_field_design", sourceDesignId: "design", expectedDesignRevision: 1, designId: "detached", fieldMapId: "map", name: "Converted", fieldId: "detached-payload", waterSourceId: "detached-water", powerSourceId: "detached-power" });
  else await f.execute({ type: "import_design_document", document: sourceDocument, designId: "detached", payloadId: "detached-payload", fieldMapId: "map" });
  assert.equal(f.current().surveyCollections!.some(entry => parseSurveyCollectionDocument(entry.document).owner.designId === "detached"), false);
  const restored = payload(f, "detached");
  await save(f, deletedReference(restored), "detached");
  assert.equal(payload(f, "detached").mapFeatures!.length, 0);
  await save(f, restored, "detached");
  assert.deepEqual(record(f, "detached").capture.origin, origin); assert.equal(record(f, "detached").attachment, undefined);
  if (route !== "completion") assert.equal(source(f).document, sourceDocument);
  assert.deepEqual(await f.api.readAsync(), f.current());
});

test("Undo/Redo restore exact existing history and refuse invented detached receipts", async () => {
  const f = await fixture(); const originalDocument = source(f).document; await pending(f); await apply(f);
  const appliedDocument = source(f).document, origin = record(f).capture.origin, applications = collection(f).applications;
  const restored = mergeRetainedReferenceOrigins(payload(f), readSurveyDesignDocument("draft", originalDocument));
  await f.execute({ type: "restore_design_survey_history", designId: "design", expectedDesignRevision: 1, document: serializePayload("draft", restored),
    memberships: [{ collectionId: "survey", expectedCollectionRevision: 3, activePointIds: ["a", "b"], state: "pending" }] });
  const fake = JSON.parse(appliedDocument); fake.draft.drawingMetadata.records[0].capture.origin.receipt.id = "invented"; delete fake.draft.drawingMetadata.records[0].attachment;
  fake.draft.drawingMetadata.retainedReferenceOrigins = [fake.draft.drawingMetadata.records[0].capture.origin];
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(f.execute({ type: "restore_design_survey_history", designId: "design", expectedDesignRevision: 2, document: JSON.stringify(fake), memberships: [] }), /invent|authority/i);
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  await f.execute({ type: "restore_design_survey_history", designId: "design", expectedDesignRevision: 2, document: appliedDocument,
    memberships: [{ collectionId: "survey", expectedCollectionRevision: 4, activePointIds: [], state: "applied" }] });
  assert.deepEqual(record(f).capture.origin, origin); assert.deepEqual(collection(f).applications, applications);
});

for (const kind of ["draft", "project", "field"] as const) test(`${kind} Apply→Undo to an earlier document carries retained authority and refuses raw omission`, async () => {
  const f = await fixture(kind), earlier = payload(f); await pending(f); await apply(f); const current = payload(f), origin = record(f).capture.origin;
  const before = f.storage.getItem(WEB_WORKSPACE_KEY);
  await assert.rejects(save(f, earlier), /authority/i); assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  const restored = mergeRetainedReferenceOrigins(current, earlier); await save(f, restored);
  assert.equal(payload(f).mapFeatures?.length ?? 0, 0); assert.deepEqual(payload(f).drawingMetadata!.retainedReferenceOrigins, [origin]);
  assert.equal(JSON.parse(source(f).document).documentVersion, kind === "draft" ? "design-draft-v5" : kind === "project" ? "pivot-project-v4" : "field-design-v6");
  await save(f, mergeRetainedReferenceOrigins(payload(f), current)); assert.deepEqual(record(f).capture.origin, origin);
});

for (const kind of ["draft", "project", "field"] as const) test(`${kind} deleted-reference history exports, reimports, reopens and restores without an owner collection`, async () => {
  const f = await fixture(kind); await pending(f); await apply(f);
  await f.execute({ type: "import_design_document", document: source(f).document, designId: "detached", payloadId: "detached-payload", fieldMapId: "map" });
  const active = payload(f, "detached"), origin = record(f, "detached").capture.origin;
  await save(f, deletedReference(active), "detached"); const deleted = payload(f, "detached"), deletedDocument = source(f, "detached").document;
  assert.deepEqual(deleted.drawingMetadata!.retainedReferenceOrigins, [origin]);
  const reader = kind === "project" ? "parseProjectDocument" : kind === "draft" ? "parseDesignDraftDocument" : "parseFieldDesignDocument";
  assert.throws(() => legacy[reader](deletedDocument));
  const falselyOld = JSON.parse(deletedDocument); falselyOld.documentVersion = kind === "draft" ? "design-draft-v4" : kind === "project" ? "pivot-project-v3" : "field-design-v4";
  assert.throws(() => legacy[reader](falselyOld)); assert.throws(() => readSurveyDesignDocument(kind, JSON.stringify(falselyOld)));
  let portable: typeof deleted;
  if (kind === "project") portable = importProjectArchiveZip(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(deleted as PivotProject, now)));
  else if (kind === "draft") portable = importDesignDraftArchiveZip(exportDesignDraftArchiveZip(buildDesignDraftArchiveBundle(deleted as DesignDraft, now)));
  else portable = importFieldDesignArchiveZip(exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(deleted as FieldDesign, now))).field;
  assert.deepEqual(portable.drawingMetadata!.retainedReferenceOrigins, [origin]);
  const bundle = buildDesignWorkspaceBundle(f.current(), "detached");
  assert.equal(bundle.surveyDocuments.length, 0); assert.deepEqual(importDesignWorkspaceBundleZip(exportDesignWorkspaceBundleZip(bundle)), bundle);
  await f.execute({ type: "import_design_document", document: serializePayload(kind, portable), designId: "reopened", payloadId: "reopened-payload", fieldMapId: "map" });
  const restarted = createVersionedProjectRepository({ getStorage: () => f.storage, getLocks: () => new Locks() }).versionedWorkspace!;
  const reopened = await restarted.readDesignAsync("reopened"); assert.equal(reopened.kind, kind);
  assert.deepEqual(payload(f, "reopened").drawingMetadata!.retainedReferenceOrigins, [origin]);
  const restore = mergeRetainedReferenceOrigins(payload(f, "reopened"), { ...active, id: "reopened-payload", name: payload(f, "reopened").name });
  await save(f, restore, "reopened"); assert.deepEqual(record(f, "reopened").capture.origin, origin);
  assert.equal(f.current().surveyCollections!.some(entry => parseSurveyCollectionDocument(entry.document).owner.designId === "reopened"), false);
  assert.equal(source(f, "detached").document, deletedDocument);
});

test("history-only ordinary saves refuse dropped, changed, reordered, duplicated or invented authority and quota failure retains exact bytes", async () => {
  const f = await fixture("project"); await pending(f); await apply(f);
  await f.execute({ type: "set_survey_membership", collectionId: "survey", expectedCollectionRevision: 3, expectedDesignRevision: 1, activePointIds: ["a", "b"], state: "pending" });
  await f.execute({ type: "apply_survey_collection", collectionId: "survey", expectedCollectionRevision: 4, expectedDesignRevision: 1, applicationId: "second-application", targetId: "reference-second", reference: { name: "Second reference" } });
  await f.execute({ type: "import_design_document", document: source(f).document, designId: "detached", payloadId: "detached-payload", fieldMapId: "map" });
  const deleting = payload(f, "detached"); deleting.mapFeatures = []; deleting.drawingMetadata!.records = [];
  await save(f, deleting, "detached");
  const accepted = payload(f, "detached"), before = f.storage.getItem(WEB_WORKSPACE_KEY);
  const droppedMetadata = structuredClone(accepted); delete droppedMetadata.drawingMetadata;
  const droppedHistory = structuredClone(accepted); delete droppedHistory.drawingMetadata!.retainedReferenceOrigins;
  const changed = structuredClone(accepted); changed.drawingMetadata!.retainedReferenceOrigins![0].observations[0].notes = "Changed historical source notes";
  const invented = structuredClone(accepted), unknown = structuredClone(invented.drawingMetadata!.retainedReferenceOrigins![0]);
  unknown.owner.designId = "invented-owner"; if (unknown.receipt.target.kind === "map_feature") unknown.receipt.target.id = "invented-target";
  invented.drawingMetadata!.retainedReferenceOrigins!.push(unknown);
  const duplicated = structuredClone(accepted); duplicated.drawingMetadata!.retainedReferenceOrigins!.push(structuredClone(duplicated.drawingMetadata!.retainedReferenceOrigins![0]));
  const reordered = structuredClone(accepted); reordered.drawingMetadata!.retainedReferenceOrigins!.reverse();
  const retyped = structuredClone(accepted); retyped.drawingMetadata!.schemaVersion = "project-drawing-metadata-v1";
  for (const bad of [droppedMetadata, droppedHistory, changed, invented, duplicated, reordered, retyped]) {
    await assert.rejects(save(f, bad, "detached")); assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before);
  }
  f.storage.fail = true; const renamed = structuredClone(accepted); renamed.name = "Quota fails";
  await assert.rejects(save(f, renamed, "detached")); f.storage.fail = false;
  assert.equal(f.storage.getItem(WEB_WORKSPACE_KEY), before); assert.deepEqual(payload(f, "detached"), accepted);
});

test("sealed Layout target bytes/hash, earlier workspace bytes and original conversion bytes survive source edits and copy", async () => {
  const f = await fixture("field"); await pending(f); await apply(f); const field = payload(f) as FieldDesign;
  const target = `\n${serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 1, expectedRevision: 1, selectedMachineIds: [field.machines[0].id] }))}\n`;
  await f.execute({ type: "create_layout_session", sessionId: "layout", fieldMapId: "map", name: "Layout", targetDocument: target });
  const sealed = f.current().layoutSessions![0].document, earlier = f.current().originalSurveyUpgradeDocument;
  const changed = payload(f); changed.name = "Renamed source"; await save(f, changed); await f.execute(copyCommand(f));
  assert.equal(f.current().layoutSessions![0].document, sealed); assert.equal(f.current().originalSurveyUpgradeDocument, earlier);
  const session = JSON.parse(sealed); assert.equal(session.targetDocument, target);
  assert.deepEqual(importLayoutSessionArchiveZip(exportLayoutSessionArchiveZip(session)), session);
  assert.throws(() => legacy.parseFieldLayoutTarget(target)); assert.throws(() => legacy.parseLayoutSessionDocument(sealed));
  assert.throws(() => legacy.importLayoutSessionArchiveZip(exportLayoutSessionArchiveZip(session)));
  const falselyOldTarget = JSON.parse(target); falselyOldTarget.fieldDocument.documentVersion = "field-design-v4";
  const falselyOldTargetDocument = JSON.stringify(falselyOldTarget);
  assert.throws(() => legacy.parseFieldLayoutTarget(falselyOldTargetDocument)); assert.throws(() => parseFieldLayoutTarget(falselyOldTargetDocument));
  const falselyOldSession = { ...session, targetDocument: falselyOldTargetDocument, targetHash: sha256Text(falselyOldTargetDocument) };
  assert.throws(() => legacy.parseLayoutSessionDocument(JSON.stringify(falselyOldSession))); assert.throws(() => parseLayoutSessionDocument(JSON.stringify(falselyOldSession)));
});

test("new and falsely old labelled capabilities are refused by actual frozen nested workspace/bundle/archive readers", async () => {
  for (const kind of ["draft", "project", "field"] as const) {
    const f = await fixture(kind); await pending(f); await apply(f); const document = source(f).document;
    assert.throws(() => legacy.parseWorkspaceDocument(f.storage.getItem(WEB_WORKSPACE_KEY)!));
    const bundle = buildDesignWorkspaceBundle(f.current(), "design");
    assert.throws(() => legacy.parseDesignWorkspaceBundle(bundle)); assert.throws(() => legacy.importDesignWorkspaceBundleZip(exportDesignWorkspaceBundleZip(bundle)));
    const falseOld = JSON.parse(document); falseOld.documentVersion = kind === "project" ? "pivot-project-v3" : kind === "draft" ? "design-draft-v4" : "field-design-v4";
    const reader = kind === "project" ? "parseProjectDocument" : kind === "draft" ? "parseDesignDraftDocument" : "parseFieldDesignDocument";
    assert.throws(() => legacy[reader](falseOld));
    assert.throws(() => readSurveyDesignDocument(kind, JSON.stringify(falseOld)));
    const w = structuredClone(f.current());
    if (kind === "project") w.projectDocuments[0].document = JSON.stringify(falseOld);
    else if (kind === "draft") w.draftDocuments[0].document = JSON.stringify(falseOld);
    else w.fieldDocuments![0].document = JSON.stringify(falseOld);
    assert.throws(() => legacy.validateWorkspaceDocument(w)); assert.throws(() => validateWorkspaceDocument(w));
    const falseOldBundle = { ...bundle, designDocument: JSON.stringify(falseOld), inventory: bundle.inventory.map(entry => entry.filename === "design.json" ? { ...entry, sha256: sha256Text(JSON.stringify(falseOld)) } : entry) };
    assert.throws(() => legacy.parseDesignWorkspaceBundle(falseOldBundle)); assert.throws(() => parseDesignWorkspaceBundle(falseOldBundle));
    if (kind === "draft") {
      const zip = exportDesignDraftArchiveZip(buildDesignDraftArchiveBundle(payload(f) as DesignDraft, now));
      assert.deepEqual(importDesignDraftArchiveZip(zip), payload(f)); assert.throws(() => legacy.importDesignDraftArchiveZip(zip));
      const falseOldZip = falselyOldArchive(zip, "draft.json", "draftDocumentVersion", "design-draft-v4");
      assert.throws(() => legacy.importDesignDraftArchiveZip(falseOldZip)); assert.throws(() => importDesignDraftArchiveZip(falseOldZip));
    } else if (kind === "field") {
      const zip = exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(payload(f) as FieldDesign, now));
      assert.deepEqual(importFieldDesignArchiveZip(zip).field, payload(f)); assert.throws(() => legacy.importFieldDesignArchiveZip(zip));
      const falseOldZip = falselyOldArchive(zip, "field.json", "fieldDocumentVersion", "field-design-v4");
      assert.throws(() => legacy.importFieldDesignArchiveZip(falseOldZip)); assert.throws(() => importFieldDesignArchiveZip(falseOldZip));
      const held = JSON.parse(document); held.documentVersion = "field-design-v5"; assert.throws(() => readSurveyDesignDocument("field", JSON.stringify(held)));
    } else {
      const zip = exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(payload(f) as PivotProject, now));
      assert.deepEqual(importProjectArchiveZip(zip), payload(f)); assert.throws(() => legacy.importProjectArchiveZip(zip));
      const falseOldZip = falselyOldArchive(zip, "project.json", "projectDocumentVersion", "pivot-project-v3");
      assert.throws(() => legacy.importProjectArchiveZip(falseOldZip)); assert.throws(() => importProjectArchiveZip(falseOldZip));
    }
  }
});

test("native refuses historical recorded-reference commands without operational fixed-GGA before database access", async () => {
  let touches = 0;
  const store = createSqliteWorkspaceStore(new Proxy({}, { get() { return () => { touches++; throw new Error("Unexpected database access"); }; } }) as never);
  for (const kind of ["project", "draft"] as const) {
    const f = await fixture(kind), data = await importHistoricalAndApply(f);
    const command = kind === "project" ? { type: "save_design_project", now, designId: "historical", project: data }
      : { type: "save_design_draft", now, designId: "historical", expectedDesignRevision: 1, draft: data };
    assert.equal(record(f, "historical").capture.origin.observations[0].captureEvidence!.schemaVersion, "gnss-capture-v1");
    await assert.rejects(store.executeAsync(0, command as WorkspaceCommand), /Recorded-reference/i);
    const historicalOnly = deletedReference(data);
    await assert.rejects(store.executeAsync(0, { ...command, ...(kind === "project" ? { project: historicalOnly } : { draft: historicalOnly }) } as WorkspaceCommand), /Recorded-reference/i);
    const v1 = { ...f.current(), workspaceVersion: "cplayout-workspace-v1" as const };
    assert.throws(() => assertNativeWorkspaceVersion(v1), /recorded-reference/i);
  }
  assert.equal(touches, 0);
});
