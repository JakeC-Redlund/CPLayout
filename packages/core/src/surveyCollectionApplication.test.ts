import assert from "node:assert/strict";
import test from "node:test";
import { applySurveyCollectionToDesign, appendSurveyPointToDesign, readSurveyDesignDocument } from "./surveyCollectionApplication";
import { createSurveyCollection, validateSurveyCollection } from "./surveyCollection";
import { serializeDesignDraftDocument } from "./designDraft";
import { serializeProjectDocument } from "./projectDocument";
import { convertPivotProjectToFieldDesign, serializeFieldDesignDocument } from "./fieldDesignDocument";
import { sampleProject } from "./sampleProject";
import { defaultProjectSettings } from "./settings";
import type { SurveyPoint } from "./types";

const now = "2026-10-10T12:00:00.000Z";
function record(id: string, x: number, y: number): SurveyPoint {
  return { id, label: id, role: "control", source: "external_gnss", confidence: "rtk_float", projected: { x, y }, observedAt: now,
    captureEvidence: { schemaVersion: "gnss-capture-v1", observationId: `historical-${id}`, sessionId: "historical", transport: "replay", receivedAt: now,
      receivedMonotonicMs: 1, sourceCoordinateFrame: "EPSG:4326", antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true } };
}
const records = [record("one", 1, 1), record("two", 101, 1), record("three", 1, 101)];
test("recorded boundary applies to actual incomplete Draft, Project and independent Field without a receiver", () => {
  const draft = { id: "draft", name: "Partial", projectCrs: "EPSG:32613", unitSystem: "metric" as const,
    settings: { ...defaultProjectSettings(), unitSystem: "metric" as const }, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
  const field = convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  for (const [kind, document] of [["draft", serializeDesignDraftDocument(draft)], ["project", serializeProjectDocument(sampleProject)], ["field", serializeFieldDesignDocument(field)]] as const) {
    const source = readSurveyDesignDocument(kind, document);
    const collection = validateSurveyCollection({ ...createSurveyCollection({ id: `boundary-${kind}`, now,
      owner: { designId: "design", documentKind: kind, payloadId: source.id, fieldMapId: "field-map", projectCrs: source.projectCrs! }, purpose: { kind: "field_boundary" } }),
      observations: records, activePointIds: records.map(point => point.id) });
    const applied = applySurveyCollectionToDesign(kind, document, collection, { applicationId: "application", now, designRevision: 1 });
    const actual = readSurveyDesignDocument(kind, applied.document);
    assert.deepEqual(actual.fieldBoundary, records.map(point => point.projected));
    assert.deepEqual(actual.fieldBoundaryCaptureEvidence, records.map(point => point.captureEvidence));
    assert.deepEqual(actual.surveyPoints, source.surveyPoints);
    assert.deepEqual(applied.collection.observations, records);
    assert.equal(applied.collection.state, "applied");
    if (kind === "draft") assert.deepEqual("machine" in actual && actual.machine, {});
    if (kind === "field") assert.deepEqual("machines" in actual && actual.machines, field.machines);
  }
});
test("point insertion cannot implicitly promote its role or rewrite a colliding observation", () => {
  const source = serializeProjectDocument(sampleProject), pivot = { ...sampleProject.pivotCenter };
  const observation = { ...records[0], role: "pivot_center" as const };
  const saved = readSurveyDesignDocument("project", appendSurveyPointToDesign("project", source, observation));
  assert.deepEqual("pivotCenter" in saved && saved.pivotCenter, pivot);
  assert.deepEqual(saved.surveyPoints.at(-1), observation);
  assert.throws(() => appendSurveyPointToDesign("project", appendSurveyPointToDesign("project", source, observation), { ...observation, projected: { x: 2, y: 3 } }), /identity conflicts/i);
});
test("partial and self-intersecting recorded polygons fail before producing an applied document", () => {
  const source = serializeProjectDocument(sampleProject);
  const owner = { designId: "design", documentKind: "project" as const, payloadId: sampleProject.id, fieldMapId: "map", projectCrs: sampleProject.projectCrs };
  const incomplete = validateSurveyCollection({ ...createSurveyCollection({ id: "boundary", owner, purpose: { kind: "field_boundary" }, now }), observations: records.slice(0, 2), activePointIds: ["one", "two"] });
  assert.throws(() => applySurveyCollectionToDesign("project", source, incomplete, { applicationId: "apply", now, designRevision: 1 }), /three vertices/i);
  const crossed = [record("cross-1", 1, 1), record("cross-2", 101, 101), record("cross-3", 1, 101), record("cross-4", 101, 1)];
  const crossing = validateSurveyCollection({ ...createSurveyCollection({ id: "cross", owner, purpose: { kind: "field_boundary" }, now }), observations: crossed, activePointIds: crossed.map(item => item.id) });
  assert.throws(() => applySurveyCollectionToDesign("project", source, crossing, { applicationId: "apply", now, designRevision: 1 }), /self-intersect/i);
  assert.equal(source, serializeProjectDocument(sampleProject));
});

test("point capture preserves exact source properties and companion; changed Draft geometry invalidates only its derived companion", () => {
  const source = readSurveyDesignDocument("project", serializeProjectDocument(sampleProject));
  const raw = structuredClone(source);
  delete raw.mapFeatures;
  const document = JSON.stringify({ documentVersion: "pivot-project-v1", project: raw });
  const appended = JSON.parse(appendSurveyPointToDesign("project", document, records[0])).project;
  assert.equal(Object.hasOwn(appended, "mapFeatures"), false);
  assert.deepEqual(appended.wgs84Companion, raw.wgs84Companion);
  for (const key of Object.keys(raw).filter(key => key !== "surveyPoints")) assert.deepEqual(appended[key], raw[key as keyof typeof raw]);
  const draft = { ...source, settings: source.settings ?? { ...defaultProjectSettings(), unitSystem: source.unitSystem } };
  const draftDocument = serializeDesignDraftDocument(draft);
  const collection = validateSurveyCollection({ ...createSurveyCollection({ id: "draft-boundary", now, purpose: { kind: "field_boundary" },
    owner: { designId: "design", documentKind: "draft", payloadId: draft.id, fieldMapId: "map", projectCrs: draft.projectCrs } }), observations: records, activePointIds: records.map(item => item.id) });
  const changed = applySurveyCollectionToDesign("draft", draftDocument, collection, { applicationId: "apply", now, designRevision: 1 });
  assert.equal(Object.hasOwn(JSON.parse(changed.document).draft, "wgs84Companion"), false);
  assert.deepEqual(JSON.parse(changed.document).draft.machine, draft.machine);
  assert.throws(() => appendSurveyPointToDesign("project", JSON.stringify({ documentVersion: "pivot-project-v1", project: { ...raw, privateExtension: true } }), records[0]), /unsupported source/i);
});

test("reference Apply refuses false digitized provenance while existing line kinds retain containment policy", () => {
  const source = serializeProjectDocument(sampleProject);
  const owner = { designId: "design", documentKind: "project" as const, payloadId: sampleProject.id, fieldMapId: "map", projectCrs: sampleProject.projectCrs };
  const create = (featureKind: "reference_line" | "measurement_line" | "machine_zone") => validateSurveyCollection({ ...createSurveyCollection({ id: featureKind, owner, now,
    purpose: { kind: "map_feature", featureKind, geometryType: "LineString" } }), observations: records.slice(0, 2), activePointIds: ["one", "two"] });
  const pending = create("reference_line");
  const before = structuredClone(pending);
  assert.throws(() => applySurveyCollectionToDesign("project", source, pending, { applicationId: "apply", now, designRevision: 1, targetId: "reference-feature" }), /recorded and pending.*digitized/i);
  assert.deepEqual(pending, before);
  const line = applySurveyCollectionToDesign("project", source, create("measurement_line"), { applicationId: "apply", now, designRevision: 1, targetId: "line-feature" });
  assert.equal(readSurveyDesignDocument("project", line.document).mapFeatures?.at(-1)?.kind, "measurement_line");
  assert.throws(() => applySurveyCollectionToDesign("project", source, create("machine_zone"), { applicationId: "apply", now, designRevision: 1, targetId: "control-feature" }), /inside.*boundary/i);
});
