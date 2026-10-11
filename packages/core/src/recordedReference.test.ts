import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { sha256Text } from "./sha256";
import { sampleProject } from "./sampleProject";
import { defaultProjectSettings } from "./settings";
import { parseProjectDocument, serializeProjectDocument, parseProjectDocumentV2 } from "./projectDocument";
import { parseDesignDraftDocument, serializeDesignDraftDocument, tryBuildPivotProject, parseDesignDraftDocumentV3, type DesignDraft } from "./designDraft";
import { convertPivotProjectToFieldDesign, parseFieldDesignDocument, serializeFieldDesignDocument, validateFieldDesign, parseFieldDesignDocumentV3 } from "./fieldDesignDocument";
import { createSurveyCollection, validateSurveyCollection, type SurveyCollection } from "./surveyCollection";
import { applySurveyCollectionToDesign, readSurveyDesignDocument, proposeRecordedReferenceApplication,
  assertRecordedReferenceAttachment, assertRecordedReferenceAttachments, type SurveyDesignKind } from "./surveyCollectionApplication";
import { assertRecordedReferenceHistory, isRecordedReferenceMetadataRecord, validateRecordedReferenceMetadata,
  seedRecordedReferenceOrigins, mergeRetainedReferenceOrigins, RecordedReferenceOriginSchema, recordedReferenceOriginKey,
  remapRecordedReferenceAttachment, retireRecordedReferenceAttachment, RecordedReferenceMetadataRecordSchema,
  type RecordedReferenceMetadataRecord } from "./drawingMetadata";
import { createProjectEditorState, reduceProjectEditorState, type ProjectEditorAction } from "./projectReducer";
import { createDesignDraftEditorState, reduceDesignDraftEditorState } from "./designDraftEditor";
import { createFieldDesignEditorState, reduceFieldDesignEditorState } from "./fieldDesignEditor";
import { SurveyPointSchema } from "./surveyPointSchema";
import { projectLonLatToXy } from "./coordinates";
import type { GnssCaptureEvidenceV2 } from "./gnssEvidence";
import type { OperationalFixedGgaEvidence } from "./operationalGnssEvidence";
import type { ProjectMapFeature, SurveyPoint } from "./types";

const now = "2026-10-10T12:00:00.000Z", later = "2026-10-11T12:00:00.000Z";
const kinds = ["reference_point", "reference_line", "reference_area"] as const;
const geometryTypes = ["Point", "LineString", "Polygon"] as const;
const require = createRequire(import.meta.url);
const fixturePath = fileURLToPath(new URL("../../../tests/fixtures/recorded-reference-legacy-reader.cjs", import.meta.url));
const legacy = require(fixturePath) as Record<string, (input: unknown) => unknown>;
const verification = require(fileURLToPath(new URL("../../../tools/buildRecordedReferenceLegacyReader.cjs", import.meta.url))) as { verify(path: string): { outputSha256: string } };

function point(id: string, x: number, y: number): SurveyPoint {
  return { id, label: `Exact ${id}  `, role: "control", projected: { x, y }, observedAt: now,
    source: "external_gnss", confidence: "rtk_float", notes: "Unchanged historical notes\nwith source text",
    captureEvidence: { schemaVersion: "gnss-capture-v1", observationId: `receiver-${id}`, sessionId: "historical-session", transport: "replay",
      receivedAt: now, receivedMonotonicMs: 1, sourceCoordinateFrame: "EPSG:4326", antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true } };
}
const observations = [point("a", 500100, 4400100), point("b", 500200, 4400100), point("c", 500100, 4400200)];
function initialDocument(kind: SurveyDesignKind, complete = false): string {
  if (kind === "project") return serializeProjectDocument(sampleProject);
  if (kind === "field") return serializeFieldDesignDocument(convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject),
    { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field);
  const draft: DesignDraft = complete ? { ...structuredClone(sampleProject), settings: defaultProjectSettings() }
    : { id: "draft", name: "Incomplete", projectCrs: sampleProject.projectCrs, unitSystem: "metric", settings: { ...defaultProjectSettings(), unitSystem: "metric" },
      fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
  return serializeDesignDraftDocument(draft);
}
function pending(kind: SurveyDesignKind, document: string, index = 1, points = observations.slice(0, index + 1)): SurveyCollection {
  const data = readSurveyDesignDocument(kind, document);
  return validateSurveyCollection({ ...createSurveyCollection({ id: `collection-${kind}-${index}`, now,
    owner: { designId: `design-${kind}`, documentKind: kind, payloadId: data.id, fieldMapId: "field-map", projectCrs: data.projectCrs! },
    purpose: { kind: "map_feature", featureKind: kinds[index], geometryType: geometryTypes[index] } }),
    revision: 7, observations: points, activePointIds: points.map(point => point.id) });
}
function apply(kind: SurveyDesignKind = "project", index = 1, document = initialDocument(kind), points?: SurveyPoint[]) {
  const collection = pending(kind, document, index, points);
  const result = applySurveyCollectionToDesign(kind, document, collection, { applicationId: `apply-${kind}-${index}`, now: later,
    designRevision: 13, targetId: `reference-${index}`, reference: { name: " Actual reference  ", notes: "Actual notes\nraw" } });
  const data = readSurveyDesignDocument(kind, result.document), feature = data.mapFeatures!.at(-1)!;
  const record = data.drawingMetadata!.records.at(-1)!;
  assert.ok(isRecordedReferenceMetadataRecord(record));
  return { ...result, data, feature, record, pending: collection };
}
function propose(collection: SurveyCollection, overrides = {}) {
  return proposeRecordedReferenceApplication(collection, { expectedCollectionRevision: collection.revision, expectedOwner: collection.owner,
    acceptedDesignRevision: 13, applicationId: "application", targetId: "reference", name: "Reference", now: later, ...overrides });
}
function clone<T>(value: T): T { return structuredClone(value); }

test("Point, Line and Area apply to actual incomplete Draft, Project and Field with exact ordered historical provenance", () => {
  for (const kind of ["draft", "project", "field"] as const) for (const index of [0, 1, 2]) {
    const source = initialDocument(kind), before = readSurveyDesignDocument(kind, source), result = apply(kind, index, source);
    assert.equal(JSON.parse(result.document).documentVersion, kind === "draft" ? "design-draft-v5" : kind === "project" ? "pivot-project-v4" : "field-design-v6");
    assert.equal(result.data.drawingMetadata!.schemaVersion, kind === "field" ? "field-drawing-metadata-v2" : "project-drawing-metadata-v2");
    assert.deepEqual(result.record.meaning, { featureKind: kinds[index], geometryType: geometryTypes[index], name: " Actual reference  ", notes: "Actual notes\nraw" });
    assert.equal(result.record.binding, "recorded");
    assert.equal(result.record.capture.source, "recorded_survey");
    assert.deepEqual(result.record.capture.origin, { collectionId: result.pending.id, owner: result.pending.owner, sourceCollectionRevision: 7,
      purpose: result.pending.purpose, receipt: result.collection.applications[0], observations: result.pending.observations });
    assert.equal(result.collection.revision, 8);
    assert.equal(result.record.capture.origin.receipt.designRevision, 13);
    assert.equal(result.record.capture.origin.receipt.geometryHash, sha256Text(JSON.stringify(result.feature.geometry)));
    assert.deepEqual(result.feature.vertexCaptureEvidence, result.pending.observations.map(point => point.captureEvidence));
    assert.deepEqual(result.collection.observations, result.pending.observations);
    assert.deepEqual(result.collection.activePointIds, []);
    assert.deepEqual(result.data.surveyPoints, before.surveyPoints);
    assertRecordedReferenceAttachments(result.data.drawingMetadata!.records, [result.collection], result.collection.owner);
    if (kind === "draft") assert.deepEqual((result.data as DesignDraft).machine, {});
  }
});

test("required neutral name and notes refuse missing/unsupported meanings and non-reference application without mutating inputs", () => {
  const source = initialDocument("project"), collection = pending("project", source), before = JSON.stringify(collection);
  const args = { applicationId: "apply", now: later, designRevision: 1, targetId: "reference" };
  assert.throws(() => applySurveyCollectionToDesign("project", source, collection, args), /reference name|actual reference name/i);
  for (const reference of [{ name: "" }, { name: "Name", assetStatus: "existing" }, { name: "Name", elevation: 1 }]) {
    assert.throws(() => applySurveyCollectionToDesign("project", source, collection, { ...args, reference }));
  }
  const nonReference = validateSurveyCollection({ ...collection, purpose: { kind: "map_feature", featureKind: "measurement_line", geometryType: "LineString" } });
  assert.throws(() => applySurveyCollectionToDesign("project", source, nonReference, { ...args, reference: { name: "Name" } }), /only.*reference/i);
  assert.equal(JSON.stringify(collection), before);
  assert.equal(source, initialDocument("project"));
});

test("factory rejects stale collection revision, wrong owner, incomplete geometry and fabricated accepted revision without partial mutation", () => {
  const collection = pending("project", initialDocument("project")), before = JSON.stringify(collection);
  for (const input of [{ expectedCollectionRevision: 6 }, { expectedOwner: { ...collection.owner, payloadId: "other" } },
    { expectedOwner: { ...collection.owner, projectCrs: "EPSG:32614" } }, { acceptedDesignRevision: 0 }, { acceptedDesignRevision: -1 }]) {
    assert.throws(() => propose(collection, input));
  }
  assert.throws(() => propose(validateSurveyCollection({ ...collection, activePointIds: ["a"] })), /two.*positions/i);
  assert.equal(JSON.stringify(collection), before);
  const result = propose(collection);
  result.record.capture.origin.observations[0].notes = "Mutated proposal";
  assert.equal(JSON.stringify(collection), before);
  assert.notEqual(result.feature.geometry, collection.observations);
});

test("metadata rejects altered ordered snapshots, IDs, receipts, hashes, current XY/evidence/meaning, CRS and invented capture fields", () => {
  const result = apply(), before = JSON.stringify(result.record);
  const mutations: Array<(record: RecordedReferenceMetadataRecord) => void> = [
    record => { record.capture.origin.observations.reverse(); },
    record => { record.capture.origin.observations[0].id = "changed"; },
    record => { record.capture.origin.receipt.sourcePointIds.reverse(); },
    record => { record.capture.origin.receipt.geometryHash = "a".repeat(64); },
    record => { record.capture.origin.receipt.target = { kind: "field_boundary" }; },
    record => { record.capture.origin.purpose = { kind: "map_feature", featureKind: "reference_area", geometryType: "Polygon" }; },
    record => { record.meaning.featureKind = "reference_area"; },
    record => { record.capture.origin.observations[0].captureEvidence = undefined; },
    record => { Object.assign(record.capture, { vertexRecordedAt: [now], elevation: null, wgs84: null }); },
    record => { Object.assign(record.meaning, { assetStatus: "existing" }); },
    record => { Object.assign(record.capture.origin.observations[0], { inventedHeight: 1 }); },
  ];
  for (const mutate of mutations) {
    const record = clone(result.record); mutate(record);
    assert.throws(() => validateRecordedReferenceMetadata(record, { feature: result.feature, projectCrs: result.collection.owner.projectCrs }));
  }
  const changed = clone(result.feature); if (changed.geometry.type === "LineString") changed.geometry.vertices[0].x += 1;
  assert.throws(() => validateRecordedReferenceMetadata(result.record, { feature: changed, projectCrs: result.collection.owner.projectCrs }), /canonical XY/);
  assert.throws(() => validateRecordedReferenceMetadata(result.record, { feature: { ...result.feature, name: "Changed" }, projectCrs: result.collection.owner.projectCrs }), /meaning/);
  assert.throws(() => validateRecordedReferenceMetadata(result.record, { feature: { ...result.feature, vertexCaptureEvidence: [null, null] }, projectCrs: result.collection.owner.projectCrs }), /evidence/);
  assert.throws(() => validateRecordedReferenceMetadata(result.record, { feature: result.feature, projectCrs: "EPSG:32614" }), /CRS/);
  assert.equal(JSON.stringify(result.record), before);
});

test("Project move/insert/remove/rename, Undo/Redo and deletion retain immutable origin and honestly invalidate edited evidence", () => {
  const result = apply(), original = result.record.capture.origin;
  let state = createProjectEditorState(parseProjectDocument(result.document));
  const edit = (action: ProjectEditorAction) => {
    const previous = state, next = reduceProjectEditorState(state, action);
    assert.equal(next.lastError, null); assert.equal(next.revision, previous.revision + 1);
    assert.deepEqual(reduceProjectEditorState(next, { type: "undo" }).project, previous.project);
    assert.deepEqual(reduceProjectEditorState(reduceProjectEditorState(next, { type: "undo" }), { type: "redo" }).project, next.project);
    state = next;
    const record = state.project.drawingMetadata!.records.at(-1)!; assert.ok(isRecordedReferenceMetadataRecord(record));
    assert.deepEqual(record.capture.origin, original); return record;
  };
  const renamed = edit({ type: "update_map_feature", feature: { ...state.project.mapFeatures!.at(-1)!, name: "Renamed" } });
  assert.equal(state.project.mapFeatures!.at(-1)!.confidence, "rtk_float");
  assert.equal(renamed.binding, "recorded"); assert.equal(renamed.meaning.name, "Renamed");
  const moved = edit({ type: "move_map_feature_vertex", featureId: result.feature.id, vertexIndex: 0, point: { x: 500101, y: 4400100 } });
  assert.equal(moved.binding, "edited"); assert.equal(state.project.mapFeatures!.at(-1)!.confidence, "user_estimated");
  assert.deepEqual(state.project.mapFeatures!.at(-1)!.vertexCaptureEvidence, [null, observations[1].captureEvidence]);
  edit({ type: "insert_map_feature_vertex", featureId: result.feature.id, afterVertexIndex: 0, point: { x: 500150, y: 4400100 } });
  assert.equal(state.project.mapFeatures!.at(-1)!.confidence, "user_estimated");
  assert.deepEqual(state.project.mapFeatures!.at(-1)!.vertexCaptureEvidence, [null, null, observations[1].captureEvidence]);
  edit({ type: "delete_map_feature_vertex", featureId: result.feature.id, vertexIndex: 1 });
  assert.equal(state.project.mapFeatures!.at(-1)!.confidence, "user_estimated");
  assert.deepEqual(state.project.mapFeatures!.at(-1)!.vertexCaptureEvidence, [null, observations[1].captureEvidence]);
  const before = state, deleted = reduceProjectEditorState(state, { type: "delete_map_feature", id: result.feature.id });
  assert.equal(deleted.lastError, null); assert.deepEqual(deleted.project.drawingMetadata!.records, []);
  assert.deepEqual(reduceProjectEditorState(deleted, { type: "undo" }).project, before.project);
  assert.deepEqual(result.collection.observations, result.pending.observations);
  const forged = { ...clone(before.project), drawingMetadata: { ...clone(before.project.drawingMetadata!), records: [] } };
  const refused = reduceProjectEditorState(before, { type: "apply_project_import", project: forged });
  assert.match(refused.lastError ?? "", /retain.*immutable/i); assert.strictEqual(refused.project, before.project);
});

test("Draft edits mark edited binding, keep origin through Undo/Redo and remove only attached metadata on deletion", () => {
  const result = apply("draft"), initial = createDesignDraftEditorState(parseDesignDraftDocument(result.document));
  const moved = reduceDesignDraftEditorState(initial, { type: "set_feature_geometry", id: result.feature.id, geometry: { type: "LineString", vertices: [{ x: 5, y: 6 }, { x: 7, y: 8 }] } });
  assert.equal(moved.lastError, null);
  const record = moved.draft.drawingMetadata!.records[0]; assert.ok(isRecordedReferenceMetadataRecord(record));
  assert.equal(record.binding, "edited"); assert.deepEqual(record.capture.origin, result.record.capture.origin);
  assert.equal(moved.draft.mapFeatures![0].vertexCaptureEvidence, undefined);
  assert.equal(moved.draft.mapFeatures![0].confidence, "user_estimated");
  assert.deepEqual(reduceDesignDraftEditorState(moved, { type: "undo" }).draft, initial.draft);
  assert.deepEqual(reduceDesignDraftEditorState(reduceDesignDraftEditorState(moved, { type: "undo" }), { type: "redo" }).draft, moved.draft);
  const deleted = reduceDesignDraftEditorState(moved, { type: "delete_feature", id: result.feature.id });
  assert.equal(deleted.lastError, null); assert.deepEqual(deleted.draft.drawingMetadata!.records, []);
});

test("edited current meaning never changes the pinned historical purpose or permits invented vertex evidence", () => {
  const result = apply(), record = { ...clone(result.record), binding: "edited" as const };
  const feature = { ...clone(result.feature), geometry: { type: "LineString" as const, vertices: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } };
  assert.throws(() => validateRecordedReferenceMetadata(record, { feature, projectCrs: result.collection.owner.projectCrs }), /edited.*evidence/i);
  delete feature.vertexCaptureEvidence;
  feature.confidence = "user_estimated";
  validateRecordedReferenceMetadata(record, { feature, projectCrs: result.collection.owner.projectCrs });
  const retyped: ProjectMapFeature = { ...feature, kind: "reference_point", geometry: { type: "Point", point: { x: 1, y: 2 } } };
  record.meaning = { featureKind: "reference_point", geometryType: "Point", name: feature.name, notes: feature.notes };
  validateRecordedReferenceMetadata(record, { feature: retyped, projectCrs: result.collection.owner.projectCrs });
  assert.equal(record.capture.origin.purpose.featureKind, "reference_line");
  assert.equal(record.capture.origin.purpose.geometryType, "LineString");
});

test("attachment remap and retirement preserve exact origins, require unique exhaustive mappings, and validate clone revision0 histories", () => {
  const result = apply(), owner = { ...result.collection.owner, designId: "copy-design", payloadId: "copy-payload", fieldMapId: "copy-map" };
  const copy = validateSurveyCollection({ ...clone(result.collection), id: "copy-collection", revision: 0, owner });
  const mapped = remapRecordedReferenceAttachment(result.record, [{ sourceCollectionId: result.collection.id, collectionId: copy.id }]);
  assert.equal(mapped.attachment!.collectionId, copy.id); assert.deepEqual(mapped.capture.origin, result.record.capture.origin);
  assertRecordedReferenceAttachment(mapped, copy, owner);
  assert.throws(() => remapRecordedReferenceAttachment(result.record, []), /unique.*exhaustive/);
  assert.throws(() => remapRecordedReferenceAttachment(result.record, [{ sourceCollectionId: result.collection.id, collectionId: "one" }, { sourceCollectionId: result.collection.id, collectionId: "two" }]), /unique/);
  assert.throws(() => assertRecordedReferenceAttachment(mapped, copy, result.collection.owner), /owner/);
  assert.throws(() => assertRecordedReferenceAttachments([mapped], [copy, copy], owner), /exactly one/);
  assert.throws(() => assertRecordedReferenceAttachments([mapped], [], owner), /exactly one/);
  const altered = clone(copy); altered.observations[0].notes = "Changed exact snapshot";
  assert.throws(() => assertRecordedReferenceAttachment(mapped, altered, owner), /snapshots/);
  const changedReceipt = clone(copy); changedReceipt.applications[0].designRevision++;
  assert.throws(() => assertRecordedReferenceAttachment(mapped, changedReceipt, owner), /receipt/);
  const retired = retireRecordedReferenceAttachment(mapped);
  assert.equal(retired.attachment, undefined); assert.deepEqual(retired.capture.origin, result.record.capture.origin);
  assertRecordedReferenceAttachments([retired], [], owner);
  assert.deepEqual(result.record.attachment, { collectionId: result.collection.id, applicationId: result.collection.applications[0].id });
});

test("history assertion rejects rewritten origin or retyping on surviving canonical targets", () => {
  const result = apply(), changed = clone(result.record); changed.capture.origin.sourceCollectionRevision++;
  assert.throws(() => assertRecordedReferenceHistory([result.record], [changed]), /immutable origin/);
  const digitized = { target: result.record.target, classification: {}, capture: { source: "map_digitized" } };
  assert.throws(() => assertRecordedReferenceHistory([result.record], [digitized]), /immutable origin/);
  assertRecordedReferenceHistory([result.record], []); // Geometry deletion is separately checked by its owning document/store.
  const edited = { ...result.record, binding: "edited" as const };
  assertRecordedReferenceHistory([result.record], [edited]);
});

test("completion and explicit Project→Field conversion retire current locators while preserving origin, source bytes and metadata version", () => {
  const result = apply("draft", 1, initialDocument("draft", true)), draft = parseDesignDraftDocument(result.document), before = JSON.stringify(draft);
  const built = tryBuildPivotProject(draft); assert.ok(built.ok);
  const record = built.project.drawingMetadata!.records.at(-1)!; assert.ok(isRecordedReferenceMetadataRecord(record));
  assert.equal(record.attachment, undefined); assert.deepEqual(record.capture.origin, result.record.capture.origin);
  assert.equal(built.project.drawingMetadata!.schemaVersion, "project-drawing-metadata-v2");
  assert.equal(JSON.stringify(draft), before); assert.ok(result.record.attachment);
  const project = apply("project"), converted = convertPivotProjectToFieldDesign(project.document, { fieldId: "new-field", waterSourceId: "new-water", powerSourceId: "new-power" });
  assert.equal(converted.originalProjectDocument, project.document);
  const fieldRecord = converted.field.drawingMetadata!.records.at(-1)!; assert.ok(isRecordedReferenceMetadataRecord(fieldRecord));
  assert.equal(fieldRecord.attachment, undefined); assert.deepEqual(fieldRecord.capture.origin, project.record.capture.origin);
  assert.equal(converted.field.drawingMetadata!.schemaVersion, "field-drawing-metadata-v2");
  assert.equal(JSON.parse(serializeFieldDesignDocument(converted.field)).documentVersion, "field-design-v6");
  assert.ok(readSurveyDesignDocument("project", converted.originalProjectDocument).drawingMetadata!.records.at(-1)!.capture.source === "recorded_survey");
  const state = createFieldDesignEditorState(converted.field), renamed = reduceFieldDesignEditorState(state, { type: "rename", name: "Field renamed" });
  assert.equal(renamed.lastError, null); assert.deepEqual(renamed.field.drawingMetadata, state.field.drawingMetadata);
});

test("actual frozen pre-wave reader closure refuses every new and falsely old-labelled reference document and preserves old golden bytes", () => {
  assert.equal(verification.verify(fixturePath).outputSha256, "443a00825cd4d08afc9edb9cb6b050b0f7b9d0aece67d7a6ef04ce56ebfeba03");
  for (const kind of ["project", "draft", "field"] as const) {
    const name = kind === "project" ? "Project" : kind === "draft" ? "DesignDraft" : "FieldDesign";
    const source = initialDocument(kind), result = apply(kind);
    assert.equal(legacy[`serialize${name}Document`](legacy[`parse${name}Document`](source)), source);
    assert.throws(() => legacy[`parse${name}Document`](result.document));
    const current = kind === "project" ? parseProjectDocument : kind === "draft" ? parseDesignDraftDocument : parseFieldDesignDocument;
    const envelope = JSON.parse(result.document);
    const oldVersions = kind === "project" ? ["pivot-project-v1", "pivot-project-v2", "pivot-project-v3"]
      : kind === "draft" ? ["design-draft-v1", "design-draft-v2", "design-draft-v3", "design-draft-v4"]
        : ["field-design-v1", "field-design-v2", "field-design-v3", "field-design-v4", "field-design-v5"];
    for (const documentVersion of oldVersions) {
      const falselyOld = { ...envelope, documentVersion };
      assert.throws(() => current(falselyOld)); assert.throws(() => legacy[`parse${name}Document`](falselyOld));
    }
  }
  assert.throws(() => parseProjectDocumentV2(apply("project").document));
  assert.throws(() => parseDesignDraftDocumentV3(apply("draft").document));
  assert.throws(() => parseFieldDesignDocumentV3(apply("field").document));
  const field = JSON.parse(apply("field").document);
  field.field.physicsScenarios = [];
  assert.throws(() => parseFieldDesignDocument(field));
});

function fixedPoint(): SurveyPoint {
  const payload = "GNGGA,120000.00,4000.0000,N,10500.0000,W,4,12,0.8,1600.0,M,-20.0,M,1.0,42";
  const checksum = [...payload].reduce((sum, c) => sum ^ c.charCodeAt(0), 0).toString(16).padStart(2, "0").toUpperCase();
  const evidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: "fixed-observation", sessionId: "session", transport: "local_udp",
    receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true,
    gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime: "120000.00", qualityCode: 4, latitude: 40, longitude: -105 },
    receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" }, capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 },
    projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
  return { id: "fixed-point", label: "Actual fixed fixture", role: "control", projected: projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:32613"),
    wgs84: { latitude: 40, longitude: -105 }, source: "external_gnss", confidence: "rtk_fixed", observedAt: now, captureEvidence: evidence };
}

test("operational fixed-GGA observations remain exact, and changed GGA/XY cannot qualify through the reference branch", () => {
  const result = apply("project", 0, initialDocument("project"), [fixedPoint()]);
  assert.deepEqual(result.record.capture.origin.observations, [fixedPoint()]);
  assert.equal(JSON.parse(result.document).documentVersion, "pivot-project-v4");
  for (const mutate of [(point: SurveyPoint) => { point.projected.x++; }, (point: SurveyPoint) => {
    if (point.captureEvidence?.schemaVersion === "gnss-operational-fixed-v1") point.captureEvidence.gga.latitude++;
  }]) {
    const record = clone(result.record); mutate(record.capture.origin.observations[0]);
    assert.throws(() => RecordedReferenceMetadataRecordSchema.parse(record));
  }
});

test("distinct observations at coincident positions retain full ordered line identity and snapshots", () => {
  const points = [...observations.slice(0, 2), point("closing", observations[0].projected.x, observations[0].projected.y)], result = apply("project", 1, initialDocument("project"), points);
  assert.deepEqual(result.record.capture.origin.observations, points);
  assert.deepEqual(result.record.capture.origin.receipt.sourcePointIds, ["a", "b", "closing"]);
  assert.deepEqual(result.feature.geometry, { type: "LineString", vertices: points.map(point => point.projected) });
});

function historicalV2Point(): SurveyPoint {
  const evidence: GnssCaptureEvidenceV2 = {
    schemaVersion: "gnss-capture-v2", observationId: "synthetic-v2-observation", sessionId: "synthetic-v2-session", transport: "web_serial",
    receivedAt: "2026-09-17T12:00:00.000Z", receiverObservedAt: "2026-09-17T12:00:00.000Z",
    receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true,
    height: { meters: 1500, type: "orthometric", geoidSeparationMeters: -20 },
    antennaReference: "arp", sentenceTypes: ["GGA", "GST", "RMC"], rawRecordHashes: ["synthetic-record"],
    referenceDeclaration: {
      schemaVersion: "gnss-reference-declaration-v1", provenance: "operator_declared",
      receiverModel: "Synthetic receiver", receiverFirmware: "synthetic-v1", referenceFrame: "WGS84",
      realization: "Synthetic realization", coordinateEpochUtc: "2026-09-17T12:00:00.000Z",
      verticalDatum: "Synthetic datum", geoidModel: "Synthetic geoid", antennaModel: "Synthetic antenna",
      antennaReference: "arp", reportedPoint: "Antenna ARP", targetPoint: "Antenna ARP",
      antennaHeightMeters: 2, offsetTreatment: "none_reported_point",
    },
    qualityScreen: {
      policy: "cplayout-nmea-collection-v2", uncertaintySource: "nmea_gst_component_standard_deviations",
      receiverQuality: { fixType: "rtk_fixed", satellites: 16, hdop: 0.7, vdop: null, pdop: null,
        correctionAgeSeconds: 1, horizontalAccuracyMeters: 0.02, verticalAccuracyMeters: 0.04,
        nmeaQualityCode: 4, baseStationId: "synthetic-base" },
      thresholds: { minimumFixType: "rtk_fixed", minSatellites: 10, maxHdop: 2,
        maxHorizontalAccuracyMeters: 0.05, maxCorrectionAgeSeconds: 3, maxObservationAgeSeconds: 2 },
      evaluatedMonotonicMs: 1500, physicalQualification: "unverified",
    },
  };
  const observed: SurveyPoint = { id: "historical-v2", label: "Synthetic historical v2", role: "control", projected: { x: 500000, y: 4400000 },
    observedAt: evidence.receiverObservedAt, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: evidence,
    rtk: { ...evidence.qualityScreen.receiverQuality, correctionAgeSeconds: 1.5 } };
  return observed;
}

test("unchanged extracted SurveyPoint leaf keeps v2 refinements and reference snapshots retain genuine supplied height evidence", () => {
  const observed = historicalV2Point();
  assert.deepEqual(SurveyPointSchema.parse(observed), observed);
  const result = apply("project", 0, initialDocument("project"), [observed]);
  assert.deepEqual(result.record.capture.origin.observations, [observed]);
  for (const modify of [(value: SurveyPoint) => { value.observedAt = now; }, (value: SurveyPoint) => { value.rtk!.correctionAgeSeconds = 1; },
    (value: SurveyPoint) => { value.confidence = "rtk_float"; }]) {
    const invalid = clone(observed); modify(invalid);
    assert.throws(() => SurveyPointSchema.parse(invalid));
    const invalidRecord = clone(result.record); invalidRecord.capture.origin.observations[0] = invalid;
    assert.throws(() => RecordedReferenceMetadataRecordSchema.parse(invalidRecord));
  }
});

test("receipt target cannot be transplanted to another recorded or edited feature, including detached origins", () => {
  const result = apply(), sourceRecord = JSON.stringify(result.record);
  for (const binding of ["recorded", "edited"] as const) for (const attached of [true, false]) {
    const record = { ...clone(result.record), target: { kind: "map_feature" as const, id: "transplanted-feature" }, binding };
    if (!attached) delete record.attachment;
    const feature = { ...clone(result.feature), id: record.target.id };
    assert.throws(() => validateRecordedReferenceMetadata(record, { feature, projectCrs: result.collection.owner.projectCrs }), /receipt.*target/i);
    assert.throws(() => assertRecordedReferenceAttachment(record, result.collection, result.collection.owner), /receipt.*target/i);
    assert.throws(() => RecordedReferenceMetadataRecordSchema.parse(record), /receipt.*target/i);
  }
  assert.equal(JSON.stringify(result.record), sourceRecord);
});

test("current attachment graph explicitly refuses duplicate collection and application locators", () => {
  const result = apply(), duplicate = clone(result.record);
  assert.throws(() => assertRecordedReferenceAttachments([result.record, duplicate], [result.collection], result.collection.owner), /duplicate.*attachment/i);
  const retired = retireRecordedReferenceAttachment(result.record);
  assertRecordedReferenceAttachments([result.record, retired], [result.collection], result.collection.owner);
});

test("geometry hashes are stable for valid supplied XY property order without altering immutable observation snapshots", () => {
  const fixed = fixedPoint();
  fixed.projected = { y: fixed.projected.y, x: fixed.projected.x };
  const linePoints = observations.slice(0, 2).map(point => ({ ...clone(point), projected: { y: point.projected.y, x: point.projected.x } }));
  for (const [index, points] of [[0, [fixed]], [1, linePoints]] as const) {
    const collection = pending("project", initialDocument("project"), index, [...points]), before = JSON.stringify(collection);
    const proposal = propose(collection);
    assert.equal(JSON.stringify(proposal.record.capture.origin.observations), JSON.stringify(collection.observations));
    assert.equal(JSON.stringify(proposal.collection.observations), JSON.stringify(collection.observations));
    assert.equal(JSON.stringify(collection), before);
    assert.deepEqual(proposal.feature.geometry, index === 0 ? { type: "Point", point: { x: points[0].projected.x, y: points[0].projected.y } }
      : { type: "LineString", vertices: points.map(point => ({ x: point.projected.x, y: point.projected.y })) });
    assert.equal(proposal.receipt.geometryHash, sha256Text(JSON.stringify(proposal.feature.geometry)));
    validateRecordedReferenceMetadata(proposal.record, { feature: proposal.feature, projectCrs: collection.owner.projectCrs });
    assertRecordedReferenceAttachment(proposal.record, proposal.collection, collection.owner);
  }
});

function detachedEditedDocument(kind: SurveyDesignKind, points: SurveyPoint[]): string {
  const source = initialDocument(kind), envelope = JSON.parse(source);
  const data = kind === "project" ? envelope.project : kind === "draft" ? envelope.draft : envelope.field;
  const proposals = points.map((point, index) => propose(pending(kind, source, 0, [point]), { targetId: `historical-reference-${index}`, applicationId: `application-${index}` }));
  data.mapFeatures = [...(data.mapFeatures ?? []), ...proposals.map((proposal, index) => ({ ...proposal.feature,
    geometry: { type: "Point", point: { x: 500500 + index, y: 4400500 } }, confidence: "user_estimated", vertexCaptureEvidence: [] }))];
  // Omit absent vertex evidence instead of a structurally misaligned empty array.
  data.mapFeatures.slice(-proposals.length).forEach((feature: ProjectMapFeature) => delete feature.vertexCaptureEvidence);
  data.drawingMetadata = { schemaVersion: kind === "field" ? "field-drawing-metadata-v2" : "project-drawing-metadata-v2", autosaveEnabled: true,
    records: proposals.map(proposal => ({ ...retireRecordedReferenceAttachment(proposal.record), binding: "edited" })) };
  envelope.documentVersion = kind === "project" ? "pivot-project-v4" : kind === "draft" ? "design-draft-v5" : "field-design-v6";
  return JSON.stringify(envelope);
}
function changedFixedPoint(first: SurveyPoint): SurveyPoint {
  const next = clone(first), evidence = next.captureEvidence;
  assert.ok(evidence?.schemaVersion === "gnss-operational-fixed-v1");
  const fields = evidence.gga.sentence.slice(1).split("*")[0].split(","); fields[2] = "4000.6000";
  const payload = fields.join(","), checksum = [...payload].reduce((sum, character) => sum ^ character.charCodeAt(0), 0).toString(16).padStart(2, "0").toUpperCase();
  evidence.gga.sentence = `$${payload}*${checksum}`; evidence.gga.latitude = 40.01;
  next.projected = projectLonLatToXy({ latitude: 40.01, longitude: -105 }, "EPSG:32613");
  next.wgs84 = { latitude: 40.01, longitude: -105 }; next.id = "different-source-point";
  return next;
}
test("combined detached edited origins reject conflicting legacy, v2 and operational receiver identities in all actual document owners", () => {
  for (const first of [point("legacy-origin", 500100, 4400100), historicalV2Point(), fixedPoint()]) {
    const second = first.captureEvidence?.schemaVersion === "gnss-operational-fixed-v1" ? changedFixedPoint(first)
      : { ...clone(first), id: "different-source-point", projected: { x: first.projected.x + 1, y: first.projected.y } };
    for (const kind of ["project", "draft", "field"] as const) {
      const document = detachedEditedDocument(kind, [first, second]);
      assert.throws(() => readSurveyDesignDocument(kind, document), /conflicting.*observation/i);
    }
  }
});
test("genuine receiver aliases preserve version-specific recapture policy and evaluation times across detached edited origins", () => {
  for (const first of [point("legacy-origin", 500100, 4400100), historicalV2Point(), fixedPoint()]) {
    const second = { ...clone(first), id: "recaptured-source-point", label: "Later historical capture", notes: "Different point label is not a rewritten receiver payload." };
    const evidence = second.captureEvidence;
    if (evidence?.schemaVersion === "gnss-capture-v2") {
      evidence.qualityScreen.evaluatedMonotonicMs += 100; evidence.qualityScreen.thresholds.maxHdop += 1;
      second.rtk!.correctionAgeSeconds! += 0.1;
    } else if (evidence?.schemaVersion === "gnss-operational-fixed-v1") {
      evidence.capture.evaluatedMonotonicMs += 100; evidence.capture.ageMs += 100;
    }
    for (const kind of ["project", "draft", "field"] as const) {
      const data = readSurveyDesignDocument(kind, detachedEditedDocument(kind, [first, second]));
      const records = data.drawingMetadata!.records;
      assert.equal(records.length, 2);
      assert.ok(isRecordedReferenceMetadataRecord(records[0]) && isRecordedReferenceMetadataRecord(records[1]));
      assert.deepEqual(records[0].capture.origin.observations, [first]);
      assert.deepEqual(records[1].capture.origin.observations, [second]);
    }
  }
});
test("edited manual geometry cannot retain RTK confidence after current vertex evidence is invalidated", () => {
  const result = apply("project", 0, initialDocument("project"), [fixedPoint()]);
  const record = { ...clone(result.record), binding: "edited" as const };
  const feature = { ...clone(result.feature), geometry: { type: "Point" as const, point: { x: 500100, y: 4400100 } } };
  delete feature.vertexCaptureEvidence;
  assert.throws(() => validateRecordedReferenceMetadata(record, { feature, projectCrs: result.collection.owner.projectCrs }), /edited.*confidence/i);
  feature.confidence = "user_estimated";
  validateRecordedReferenceMetadata(record, { feature, projectCrs: result.collection.owner.projectCrs });
});

test("combined edited origins bind immutable receiver evidence beyond coordinates and reject mixed evidence versions", () => {
  for (const first of [point("legacy-origin", 500100, 4400100), historicalV2Point(), fixedPoint()]) {
    const second = { ...clone(first), id: "second-source-point" }, evidence = second.captureEvidence!;
    if (evidence.schemaVersion === "gnss-capture-v1") evidence.receivedAt = "2026-10-10T12:00:01.000Z";
    else if (evidence.schemaVersion === "gnss-capture-v2") { evidence.qualityScreen.receiverQuality.satellites! += 1; second.rtk!.satellites! += 1; }
    else evidence.receipt.sequence += 1;
    for (const kind of ["project", "draft", "field"] as const) assert.throws(() => readSurveyDesignDocument(kind, detachedEditedDocument(kind, [first, second])), /conflicting.*observation/i);
  }
  const v2 = historicalV2Point(), legacy = point("legacy-mixed", v2.projected.x, v2.projected.y);
  legacy.captureEvidence!.observationId = v2.captureEvidence!.observationId;
  for (const kind of ["project", "draft", "field"] as const) assert.throws(() => readSurveyDesignDocument(kind, detachedEditedDocument(kind, [legacy, v2])), /mixed GNSS evidence/i);
});
test("combined edited-origin guards also compare current survey carriers with historical reference evidence", () => {
  for (const origin of [point("legacy-origin", 500100, 4400100), historicalV2Point(), fixedPoint()]) {
    const current = origin.captureEvidence?.schemaVersion === "gnss-operational-fixed-v1" ? changedFixedPoint(origin)
      : { ...clone(origin), id: "current-survey-carrier", projected: { x: origin.projected.x + 1, y: origin.projected.y } };
    for (const kind of ["project", "draft", "field"] as const) {
      const envelope = JSON.parse(detachedEditedDocument(kind, [origin]));
      const data = kind === "project" ? envelope.project : kind === "draft" ? envelope.draft : envelope.field;
      data.surveyPoints.push(current);
      assert.throws(() => readSurveyDesignDocument(kind, JSON.stringify(envelope)), /conflicting.*observation/i);
    }
  }
});

test("each Project move, insert and remove starts from recorded RTK evidence, marks estimated confidence, and restores exact evidence on Undo/Redo", () => {
  const first = fixedPoint(), second = changedFixedPoint(first), third = clone(second);
  second.captureEvidence!.observationId = "receiver-second"; third.id = "third-source-point"; third.captureEvidence!.observationId = "receiver-third";
  const result = apply("project", 1, initialDocument("project"), [first, second, third]);
  const initial = createProjectEditorState(parseProjectDocument(result.document));
  assert.equal(initial.project.mapFeatures!.at(-1)!.confidence, "rtk_fixed");
  const actions: ProjectEditorAction[] = [
    { type: "move_map_feature_vertex", featureId: result.feature.id, vertexIndex: 0, point: { x: first.projected.x + 1, y: first.projected.y } },
    { type: "insert_map_feature_vertex", featureId: result.feature.id, afterVertexIndex: 0, point: { x: first.projected.x + 2, y: first.projected.y } },
    { type: "delete_map_feature_vertex", featureId: result.feature.id, vertexIndex: 1 },
  ];
  for (const action of actions) {
    const next = reduceProjectEditorState(initial, action);
    assert.equal(next.lastError, null);
    const feature = next.project.mapFeatures!.at(-1)!, record = next.project.drawingMetadata!.records.at(-1)!;
    assert.ok(isRecordedReferenceMetadataRecord(record)); assert.equal(record.binding, "edited"); assert.equal(feature.confidence, "user_estimated");
    assert.deepEqual(record.capture.origin, result.record.capture.origin);
    assert.deepEqual(feature.vertexCaptureEvidence, action.type === "move_map_feature_vertex" ? [null, second.captureEvidence, third.captureEvidence]
      : action.type === "insert_map_feature_vertex" ? [first.captureEvidence, null, second.captureEvidence, third.captureEvidence]
        : [first.captureEvidence, third.captureEvidence]);
    const undone = reduceProjectEditorState(next, { type: "undo" });
    assert.deepEqual(undone.project, initial.project); assert.equal(undone.project.mapFeatures!.at(-1)!.confidence, "rtk_fixed");
    assert.deepEqual(reduceProjectEditorState(undone, { type: "redo" }).project, next.project);
  }
});

test("origin schema is strict and explicit constructors seed authority before the first edit without parser seeding", () => {
  for (const kind of ["project", "draft", "field"] as const) {
    const result = apply(kind), raw = JSON.parse(result.document), data = kind === "project" ? raw.project : kind === "draft" ? raw.draft : raw.field;
    delete data.drawingMetadata.retainedReferenceOrigins;
    const source = JSON.stringify(raw), parsed = readSurveyDesignDocument(kind, source);
    assert.equal(parsed.drawingMetadata!.retainedReferenceOrigins, undefined);
    assert.equal(source, JSON.stringify(raw));
    const seeded = seedRecordedReferenceOrigins(parsed);
    assert.deepEqual(seeded.drawingMetadata!.retainedReferenceOrigins, [result.record.capture.origin]);
    assert.equal(parsed.drawingMetadata!.retainedReferenceOrigins, undefined);
    const constructed = kind === "project" ? createProjectEditorState(readSurveyDesignDocument("project", source)).project
      : kind === "draft" ? createDesignDraftEditorState(readSurveyDesignDocument("draft", source)).draft
        : createFieldDesignEditorState(readSurveyDesignDocument("field", source)).field;
    assert.deepEqual(constructed.drawingMetadata!.retainedReferenceOrigins, [result.record.capture.origin]);
    assert.deepEqual(RecordedReferenceOriginSchema.parse(result.record.capture.origin), result.record.capture.origin);
    const unsupported = clone(result.record.capture.origin); Object.assign(unsupported, { attachment: { collectionId: "invented", applicationId: "invented" } });
    assert.throws(() => RecordedReferenceOriginSchema.parse(unsupported));
    const unsupportedObservation = clone(result.record.capture.origin); Object.assign(unsupportedObservation.observations[0], { inventedHeight: 1 });
    assert.throws(() => RecordedReferenceOriginSchema.parse(unsupportedObservation));
  }
});
test("detached Project and Draft deletion, save/reopen, Undo/Redo and reopened restoration preserve immutable authority", () => {
  for (const kind of ["project", "draft"] as const) {
    const result = apply(kind), source = JSON.parse(result.document), payload = kind === "project" ? source.project : source.draft;
    payload.drawingMetadata.records = payload.drawingMetadata.records.map((record: typeof result.record) => retireRecordedReferenceAttachment(record));
    const document = JSON.stringify(source);
    if (kind === "project") {
      const initial = createProjectEditorState(parseProjectDocument(document)), deleted = reduceProjectEditorState(initial, { type: "delete_map_feature", id: result.feature.id });
      assert.equal(deleted.lastError, null); assert.deepEqual(deleted.project.drawingMetadata!.records, []);
      assert.deepEqual(deleted.project.drawingMetadata!.retainedReferenceOrigins, [result.record.capture.origin]);
      const reopened = parseProjectDocument(serializeProjectDocument(deleted.project));
      assert.deepEqual(reopened.drawingMetadata!.retainedReferenceOrigins, [result.record.capture.origin]);
      assert.deepEqual(reduceProjectEditorState(deleted, { type: "undo" }).project, initial.project);
      assert.deepEqual(reduceProjectEditorState(reduceProjectEditorState(deleted, { type: "undo" }), { type: "redo" }).project, deleted.project);
      assert.deepEqual(mergeRetainedReferenceOrigins(reopened, initial.project), initial.project);
    } else {
      const initial = createDesignDraftEditorState(parseDesignDraftDocument(document)), deleted = reduceDesignDraftEditorState(initial, { type: "delete_feature", id: result.feature.id });
      assert.equal(deleted.lastError, null); assert.deepEqual(deleted.draft.drawingMetadata!.records, []);
      assert.deepEqual(deleted.draft.drawingMetadata!.retainedReferenceOrigins, [result.record.capture.origin]);
      const reopened = parseDesignDraftDocument(serializeDesignDraftDocument(deleted.draft));
      assert.deepEqual(reopened.drawingMetadata!.retainedReferenceOrigins, [result.record.capture.origin]);
      assert.deepEqual(reduceDesignDraftEditorState(deleted, { type: "undo" }).draft, initial.draft);
      assert.deepEqual(reduceDesignDraftEditorState(reduceDesignDraftEditorState(deleted, { type: "undo" }), { type: "redo" }).draft, deleted.draft);
      assert.deepEqual(mergeRetainedReferenceOrigins(reopened, initial.draft), initial.draft);
    }
    assert.equal(document, JSON.stringify(source));
  }
});
test("real reference Apply can Undo to an earlier source snapshot while retaining admitted authority in every Core editor", () => {
  for (const kind of ["project", "draft", "field"] as const) {
    const before = initialDocument(kind), result = apply(kind, 1, before), origin = result.record.capture.origin;
    if (kind === "project") {
      const state = createProjectEditorState(parseProjectDocument(result.document));
      state.past = [parseProjectDocument(before)];
      const undone = reduceProjectEditorState(state, { type: "undo" }); assert.equal(undone.lastError, null);
      assert.deepEqual(undone.project.mapFeatures, parseProjectDocument(before).mapFeatures);
      assert.deepEqual(undone.project.drawingMetadata!.records, []); assert.deepEqual(undone.project.drawingMetadata!.retainedReferenceOrigins, [origin]);
      assert.deepEqual(reduceProjectEditorState(undone, { type: "redo" }).project, state.project);
      assert.equal(JSON.parse(serializeProjectDocument(undone.project)).documentVersion, "pivot-project-v4");
    } else if (kind === "draft") {
      const state = createDesignDraftEditorState(parseDesignDraftDocument(result.document));
      state.past = [parseDesignDraftDocument(before)];
      const undone = reduceDesignDraftEditorState(state, { type: "undo" }); assert.equal(undone.lastError, null);
      assert.equal(undone.draft.mapFeatures, undefined); assert.deepEqual(undone.draft.drawingMetadata!.records, []);
      assert.deepEqual(undone.draft.drawingMetadata!.retainedReferenceOrigins, [origin]);
      assert.deepEqual(reduceDesignDraftEditorState(undone, { type: "redo" }).draft, state.draft);
      assert.equal(JSON.parse(serializeDesignDraftDocument(undone.draft)).documentVersion, "design-draft-v5");
    } else {
      const state = createFieldDesignEditorState(parseFieldDesignDocument(result.document));
      state.past = [parseFieldDesignDocument(before)];
      const undone = reduceFieldDesignEditorState(state, { type: "undo" }); assert.equal(undone.lastError, null);
      assert.deepEqual(undone.field.mapFeatures, parseFieldDesignDocument(before).mapFeatures);
      assert.deepEqual(undone.field.drawingMetadata!.records, []); assert.deepEqual(undone.field.drawingMetadata!.retainedReferenceOrigins, [origin]);
      assert.deepEqual(reduceFieldDesignEditorState(undone, { type: "redo" }).field, state.field);
      assert.equal(JSON.parse(serializeFieldDesignDocument(undone.field)).documentVersion, "field-design-v6");
    }
    assert.equal(before, initialDocument(kind));
  }
});
test("history-only origin data refuses old labels and actual frozen readers while current parsers preserve it", () => {
  for (const kind of ["project", "draft", "field"] as const) {
    const result = apply(kind), envelope = JSON.parse(result.document), data = kind === "project" ? envelope.project : kind === "draft" ? envelope.draft : envelope.field;
    data.mapFeatures = data.mapFeatures.filter((feature: ProjectMapFeature) => feature.id !== result.feature.id);
    data.drawingMetadata.records = [];
    const document = JSON.stringify(envelope), read = readSurveyDesignDocument(kind, document);
    assert.deepEqual(read.drawingMetadata!.retainedReferenceOrigins, [result.record.capture.origin]);
    const name = kind === "project" ? "Project" : kind === "draft" ? "DesignDraft" : "FieldDesign";
    assert.throws(() => legacy[`parse${name}Document`](document));
    const oldVersions = kind === "project" ? ["pivot-project-v1", "pivot-project-v2", "pivot-project-v3"]
      : kind === "draft" ? ["design-draft-v1", "design-draft-v2", "design-draft-v3", "design-draft-v4"]
        : ["field-design-v1", "field-design-v2", "field-design-v3", "field-design-v4", "field-design-v5"];
    for (const documentVersion of oldVersions) {
      const falselyOld = { ...envelope, documentVersion };
      assert.throws(() => readSurveyDesignDocument(kind, JSON.stringify(falselyOld)));
      assert.throws(() => legacy[`parse${name}Document`](falselyOld));
    }
  }
});
test("retained authority is unique by historical owner and target, exact under restoration, and cannot acquire altered or unknown origins", () => {
  const result = apply(), source = readSurveyDesignDocument("project", result.document), origin = result.record.capture.origin;
  assert.equal(recordedReferenceOriginKey(origin), recordedReferenceOriginKey(clone(origin)));
  const duplicate = clone(source); duplicate.drawingMetadata!.retainedReferenceOrigins = [origin, clone(origin)];
  assert.throws(() => serializeProjectDocument(duplicate), /duplicate retained/i);
  assert.throws(() => seedRecordedReferenceOrigins(duplicate), /duplicate retained/i);
  const altered = clone(source); altered.drawingMetadata!.retainedReferenceOrigins![0].observations[0].notes = "Changed immutable observation";
  assert.throws(() => serializeProjectDocument(altered), /conflicting immutable reference origin/i);
  assert.throws(() => mergeRetainedReferenceOrigins(source, altered), /exact.*authority/i);
  const forged = clone(source); forged.drawingMetadata!.records = []; forged.mapFeatures = forged.mapFeatures!.filter(feature => feature.id !== result.feature.id);
  const forgedOrigin = clone(origin); forgedOrigin.receipt.target = { kind: "map_feature", id: "unknown-history-target" };
  forged.drawingMetadata!.retainedReferenceOrigins = [forgedOrigin];
  assert.throws(() => mergeRetainedReferenceOrigins(source, forged), /exact.*authority/i);
  const dropped = clone(forged); delete dropped.drawingMetadata!.retainedReferenceOrigins;
  const restored = mergeRetainedReferenceOrigins(source, dropped);
  assert.deepEqual(restored.drawingMetadata!.retainedReferenceOrigins, [origin]); assert.equal(dropped.drawingMetadata!.retainedReferenceOrigins, undefined);
  const blank = readSurveyDesignDocument("project", initialDocument("project"));
  assert.throws(() => mergeRetainedReferenceOrigins(blank, source), /exact.*authority/i);
});
test("history-only metadata participates in combined receiver conflict guards and permits genuine recapture aliases", () => {
  for (const first of [point("history-first", 500100, 4400100), historicalV2Point(), fixedPoint()]) {
    for (const conflicting of [true, false]) {
      const second = conflicting ? first.captureEvidence?.schemaVersion === "gnss-operational-fixed-v1" ? changedFixedPoint(first)
        : { ...clone(first), id: "second-history-point", projected: { x: first.projected.x + 1, y: first.projected.y } }
          : { ...clone(first), id: "second-history-point", label: "A distinct historical point" };
      const envelope = JSON.parse(detachedEditedDocument("project", [first, second]));
      envelope.project.drawingMetadata.retainedReferenceOrigins = envelope.project.drawingMetadata.records.map((record: { capture: { origin: unknown } }) => record.capture.origin);
      envelope.project.drawingMetadata.records = []; envelope.project.mapFeatures = [];
      if (conflicting) assert.throws(() => parseProjectDocument(envelope), /conflicting.*observation/i);
      else assert.equal(parseProjectDocument(envelope).drawingMetadata!.retainedReferenceOrigins!.length, 2);
    }
  }
});
test("collection-free completion and conversion preserve retained authority through deletion and restore, with exact original source text", () => {
  const draftResult = apply("draft", 1, initialDocument("draft", true)), draft = parseDesignDraftDocument(draftResult.document), before = JSON.stringify(draft);
  const built = tryBuildPivotProject(draft); assert.ok(built.ok);
  assert.deepEqual(built.project.drawingMetadata!.retainedReferenceOrigins, [draftResult.record.capture.origin]);
  const projectState = createProjectEditorState(built.project), deleted = reduceProjectEditorState(projectState, { type: "delete_map_feature", id: draftResult.feature.id });
  assert.equal(deleted.lastError, null); assert.deepEqual(parseProjectDocument(serializeProjectDocument(deleted.project)).drawingMetadata!.retainedReferenceOrigins, [draftResult.record.capture.origin]);
  assert.deepEqual(reduceProjectEditorState(deleted, { type: "undo" }).project, projectState.project);
  assert.equal(JSON.stringify(draft), before);
  const project = apply("project"), converted = convertPivotProjectToFieldDesign(project.document, { fieldId: "history-field", waterSourceId: "history-water", powerSourceId: "history-power" });
  assert.equal(converted.originalProjectDocument, project.document);
  assert.deepEqual(converted.field.drawingMetadata!.retainedReferenceOrigins, [project.record.capture.origin]);
  const emptied = clone(converted.field); emptied.mapFeatures = emptied.mapFeatures!.filter(feature => feature.id !== project.feature.id); emptied.drawingMetadata!.records = [];
  const persisted = parseFieldDesignDocument(serializeFieldDesignDocument(validateFieldDesign(emptied)));
  assert.deepEqual(mergeRetainedReferenceOrigins(persisted, converted.field), converted.field);
  const state = createFieldDesignEditorState(persisted); state.past = [converted.field];
  assert.deepEqual(reduceFieldDesignEditorState(state, { type: "undo" }).field, converted.field);
});
test("actual same-owner load_field preserves dropped history in current state and through the next Undo", () => {
  const result = apply("field"), source = parseFieldDesignDocument(result.document), deleted = clone(source);
  deleted.mapFeatures = deleted.mapFeatures!.filter(feature => feature.id !== result.feature.id); deleted.drawingMetadata!.records = [];
  const initial = createFieldDesignEditorState(deleted), incoming = clone(deleted); delete incoming.drawingMetadata!.retainedReferenceOrigins;
  const loaded = reduceFieldDesignEditorState(initial, { type: "load_field", field: incoming }); assert.equal(loaded.lastError, null);
  assert.deepEqual(loaded.field.drawingMetadata!.retainedReferenceOrigins, source.drawingMetadata!.retainedReferenceOrigins);
  const renamed = reduceFieldDesignEditorState(loaded, { type: "rename", name: "History retained" }); assert.equal(renamed.lastError, null);
  const undone = reduceFieldDesignEditorState(renamed, { type: "undo" }); assert.equal(undone.lastError, null);
  assert.deepEqual(undone.field, loaded.field); assert.deepEqual(undone.field.drawingMetadata!.retainedReferenceOrigins, source.drawingMetadata!.retainedReferenceOrigins);
});

test("validated origin-free Project history retains exact snapshots while blank authority still refuses active and retained unknown origins", () => {
  const initial = createProjectEditorState(sampleProject), source = JSON.stringify(initial.project);
  const changed = reduceProjectEditorState(initial, { type: "rename", name: "Legacy snapshot identity" });
  assert.equal(changed.lastError, null); assert.strictEqual(changed.past.at(-1), initial.project);
  assert.strictEqual(mergeRetainedReferenceOrigins(initial.project, changed.project), changed.project);
  const undone = reduceProjectEditorState(changed, { type: "undo" });
  assert.equal(undone.lastError, null); assert.strictEqual(undone.project, initial.project); assert.strictEqual(undone.future[0], changed.project);
  const redone = reduceProjectEditorState(undone, { type: "redo" });
  assert.equal(redone.lastError, null); assert.strictEqual(redone.project, changed.project); assert.strictEqual(redone.past.at(-1), initial.project);
  const unknown = readSurveyDesignDocument("project", apply("project").document);
  assert.throws(() => mergeRetainedReferenceOrigins(initial.project, unknown), /exact.*authority/i);
  const activeOnly = clone(unknown); delete activeOnly.drawingMetadata!.retainedReferenceOrigins;
  assert.throws(() => mergeRetainedReferenceOrigins(initial.project, activeOnly), /exact.*authority/i);
  const historyOnly = clone(unknown); historyOnly.drawingMetadata!.records = [];
  historyOnly.mapFeatures = historyOnly.mapFeatures!.filter(feature => !feature.kind.startsWith("reference_"));
  assert.throws(() => mergeRetainedReferenceOrigins(initial.project, historyOnly), /exact.*authority/i);
  assert.equal(JSON.stringify(initial.project), source);
});
