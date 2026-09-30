import assert from "node:assert/strict";
import test from "node:test";
import { DRAWING_CLASSIFICATION_VERSION, DRAWING_PURPOSE_CATALOG, drawingPurpose, type DrawingClassification } from "./drawingClassification";
import { DESIGN_DRAFT_DOCUMENT_VERSION, parseDesignDraftDocument, parseDesignDraftDocumentV2, serializeDesignDraftDocument, tryBuildPivotProject, type DesignDraft } from "./designDraft";
import { createDesignDraftEditorState, reduceDesignDraftEditorState, type DesignDraftEditorState, type DesignDraftEditorAction } from "./designDraftEditor";
import { PROJECT_DOCUMENT_VERSION, parseProjectDocument, parseProjectDocumentV1, serializeProjectDocument } from "./projectDocument";
import { exportProjectGoogleEarthKml } from "./projectKml";
import { exportProjectMapXml } from "./projectXml";
import { sampleProject } from "./sampleProject";
import { defaultProjectSettings } from "./settings";
import { PROJECT_DRAWING_METADATA_VERSION } from "./drawingMetadata";

function selection(purposeId: string): DrawingClassification {
  const purpose = drawingPurpose(purposeId)!;
  return { schemaVersion: DRAWING_CLASSIFICATION_VERSION, purposeId, geometryType: purpose.geometry,
    name: " Literal name ", notes: "Line 1\n <literal> ", assetStatus: "unknown", placement: purpose.placements[0],
    customLabel: purpose.custom ? "Custom category" : null,
    effect: purposeId === "exclusion_area" ? { mode: "exclusion", noSpray: true, hardConflict: false, bufferMeters: 2 }
      : { mode: "informational" } };
}
function edit(state: DesignDraftEditorState, action: DesignDraftEditorAction) {
  const next = reduceDesignDraftEditorState(state, action);
  assert.equal(next.lastError, null);
  return next;
}
function draw(state: DesignDraftEditorState, command: Extract<DesignDraftEditorAction, { type: "drawing" }>["command"]) {
  return edit(state, { type: "drawing", expectedRevision: state.revision, command });
}
function ready(purposeId: string): DesignDraftEditorState {
  let state = createDesignDraftEditorState({ ...structuredClone(sampleProject), settings: defaultProjectSettings() });
  const geometryType = drawingPurpose(purposeId)!.geometry;
  state = draw(state, { type: "begin", id: "capture", name: "Unfinished", geometryType });
  for (const point of [{ x: 1, y: 1 }, { x: 50, y: 1 }, { x: 1, y: 50 }].slice(0, geometryType === "Point" ? 1 : geometryType === "LineString" ? 2 : 3)) {
    state = draw(state, { type: "append_vertex", id: "capture", vertex: { point, recordedAt: "2026-09-27T10:00:00Z", wgs84: null, elevation: null } });
  }
  return draw(state, { type: "finish", id: "capture" });
}
function action(state: DesignDraftEditorState, purposeId: string): Extract<DesignDraftEditorAction, { type: "commit_classified_drawing" }> {
  const purpose = drawingPurpose(purposeId)!;
  return { type: "commit_classified_drawing", expectedRevision: state.revision, captureId: "capture", classification: selection(purposeId),
    ...(purpose.destination === "feature" ? { entityId: "new-feature" } : { replaceExisting: true }) };
}
function reject(state: DesignDraftEditorState, command: DesignDraftEditorAction) {
  const before = JSON.stringify(state);
  const failed = reduceDesignDraftEditorState(state, command);
  assert(failed.lastError);
  assert.strictEqual(failed.draft, state.draft);
  assert.strictEqual(failed.past, state.past);
  assert.strictEqual(failed.future, state.future);
  assert.equal(failed.revision, state.revision);
  assert.equal(JSON.stringify(state), before);
}

test("every catalog purpose commits to one canonical target with typed classification and one undo", () => {
  for (const purpose of DRAWING_PURPOSE_CATALOG) {
    const before = ready(purpose.id);
    const oldCapture = before.draft.drawingWorkflow!.captures[0];
    const next = edit(before, action(before, purpose.id));
    assert.equal(next.revision, before.revision + 1, purpose.id);
    assert.equal(next.past.length, before.past.length + 1);
    assert.deepEqual(next.draft.drawingWorkflow!.captures, []);
    assert.equal(next.draft.drawingWorkflow!.activeCaptureId, null);
    assert.equal(next.draft.drawingMetadata!.records.length, 1);
    const record = next.draft.drawingMetadata!.records[0];
    assert.deepEqual(record.classification, selection(purpose.id));
    assert.deepEqual(record.capture.vertexRecordedAt, oldCapture.vertices.map(vertex => vertex.recordedAt));
    assert.equal(record.capture.elevation, null);
    assert.equal(record.capture.wgs84, null);
    assert.equal(JSON.stringify(record).includes('"x"'), false);
    assert.deepEqual(next.draft.surveyPoints, before.draft.surveyPoints);
    if (record.target.kind === "map_feature") {
      const feature = next.draft.mapFeatures!.find(item => item.id === "new-feature")!;
      assert.deepEqual(feature.geometry, purpose.geometry === "Point" ? { type: "Point", point: oldCapture.vertices[0].point }
        : { type: purpose.geometry, vertices: oldCapture.vertices.map(vertex => vertex.point) });
      assert.equal(feature.confidence, "user_estimated");
      assert.equal(feature.kind === "end_gun_mark", purpose.id === "end_gun_mark");
    }
    assert.deepEqual(parseDesignDraftDocument(serializeDesignDraftDocument(next.draft)), next.draft);
    const undone = edit(next, { type: "undo" });
    assert.deepEqual(undone.draft, before.draft);
    assert.deepEqual(edit(undone, { type: "redo" }).draft, next.draft);
  }
});

test("stale, paused, canceled, incompatible and injected commits retain capture and history", () => {
  const state = ready("valve");
  const command = action(state, "valve");
  reject(state, { ...command, expectedRevision: state.revision - 1 });
  reject(state, { ...command, captureId: "missing" });
  reject(state, { ...command, classification: selection("pipeline") });
  reject(state, { ...command, confidence: "rtk_fixed" } as unknown as DesignDraftEditorAction);
  reject(state, { ...command, classification: { ...selection("valve"), effect: { mode: "exclusion", noSpray: true, hardConflict: true, bufferMeters: 1 } } });
  const paused = draw(state, { type: "pause", id: "capture" });
  reject(paused, { ...command, expectedRevision: paused.revision });
  const canceled = draw(state, { type: "return_to_drawing", id: "capture" });
  reject(canceled, { ...command, expectedRevision: canceled.revision });
  assert.deepEqual(canceled.draft.drawingWorkflow!.captures[0].vertices, state.draft.drawingWorkflow!.captures[0].vertices);
  const resumed = createDesignDraftEditorState(parseDesignDraftDocument(serializeDesignDraftDocument(paused.draft)));
  const active = draw(resumed, { type: "resume", id: "capture" });
  assert.equal(edit(active, action(active, "valve")).draft.drawingWorkflow!.captures.length, 0);
});

test("singleton replacement is explicit and a well or valve cannot replace the design water source", () => {
  for (const purpose of ["field_boundary", "pivot_center", "project_water_source", "project_power_source"]) {
    const state = ready(purpose);
    reject(state, { ...action(state, purpose), replaceExisting: false });
    reject(state, { ...action(state, purpose), entityId: "duplicate" });
  }
  for (const purpose of ["well", "valve"]) {
    const state = ready(purpose);
    const next = edit(state, action(state, purpose));
    assert.deepEqual(next.draft.waterSource, state.draft.waterSource);
    assert.deepEqual(next.draft.obstacles, state.draft.obstacles);
  }
});

test("informational areas remain informational and exclusions retain exactly the selected effects", () => {
  const state = ready("soil_zone");
  const information = edit(state, action(state, "soil_zone"));
  assert.deepEqual(information.draft.obstacles, state.draft.obstacles);
  for (const [noSpray, hardConflict] of [[true, false], [false, true], [true, true]]) {
    const command = action(state, "soil_zone");
    command.classification.effect = { mode: "exclusion", noSpray, hardConflict, bufferMeters: 2 };
    const next = edit(state, command);
    assert.deepEqual(next.draft.mapFeatures, state.draft.mapFeatures);
    const obstacle = next.draft.obstacles.at(-1)!;
    assert.equal(obstacle.noSpray, noSpray); assert.equal(obstacle.hardConflict, hardConflict); assert.equal(obstacle.bufferMeters, 2);
  }
});

test("classified documents preserve preference and metadata on promotion and refuse frozen older readers", () => {
  let state = ready("valve");
  state = draw(state, { type: "set_autosave", enabled: false });
  const next = edit(state, action(state, "valve"));
  const text = serializeDesignDraftDocument(next.draft);
  assert.equal(JSON.parse(text).documentVersion, DESIGN_DRAFT_DOCUMENT_VERSION);
  assert.throws(() => parseDesignDraftDocumentV2(text));
  for (const documentVersion of ["design-draft-v1", "design-draft-v2"]) {
    assert.throws(() => parseDesignDraftDocument({ documentVersion, draft: next.draft }));
  }
  const promoted = tryBuildPivotProject(next.draft);
  assert(promoted.ok);
  assert.deepEqual(promoted.project.drawingMetadata, next.draft.drawingMetadata);
  assert.equal(promoted.project.drawingMetadata!.autosaveEnabled, false);
  assert.equal(Object.hasOwn(promoted.project, "drawingWorkflow"), false);
  const projectText = serializeProjectDocument(promoted.project);
  assert.equal(JSON.parse(projectText).documentVersion, PROJECT_DOCUMENT_VERSION);
  assert.deepEqual(parseProjectDocument(projectText).drawingMetadata, next.draft.drawingMetadata);
  assert.throws(() => parseProjectDocumentV1(projectText));
  assert.throws(() => parseProjectDocument({ documentVersion: "pivot-project-v1", project: promoted.project }));
  assert.throws(() => parseProjectDocument(promoted.project));
  assert.throws(() => exportProjectGoogleEarthKml(promoted.project), /lossless/);
  assert.throws(() => exportProjectMapXml(promoted.project), /lossless/);
});

test("workflow-only promotion explicitly maps both autosave preferences into project metadata", () => {
  for (const enabled of [true, false]) {
    let state = createDesignDraftEditorState({ ...structuredClone(sampleProject), settings: defaultProjectSettings() });
    state = draw(state, { type: "set_autosave", enabled });
    const before = JSON.stringify(state.draft);
    const promoted = tryBuildPivotProject(state.draft);
    assert(promoted.ok);
    assert.deepEqual(promoted.project.drawingMetadata, { schemaVersion: PROJECT_DRAWING_METADATA_VERSION, autosaveEnabled: enabled, records: [] });
    assert.equal(JSON.stringify(state.draft), before);
  }
});

test("editing classified geometry invalidates its digitization time and deleting removes only its metadata", () => {
  const state = ready("valve");
  const next = edit(state, action(state, "valve"));
  const moved = edit(next, { type: "set_feature_geometry", id: "new-feature", geometry: { type: "Point", point: { x: 6, y: 9 } } });
  assert.deepEqual(moved.draft.drawingMetadata!.records[0].capture.vertexRecordedAt, [null]);
  assert.deepEqual(edit(moved, { type: "undo" }).draft, next.draft);
  const removed = edit(moved, { type: "delete_feature", id: "new-feature" });
  assert.deepEqual(removed.draft.drawingMetadata!.records, []);
  assert.equal(removed.draft.drawingMetadata!.autosaveEnabled, true);
});

test("mismatched, future or orphan metadata refuses import instead of losing fields", () => {
  const state = ready("valve");
  const committed = edit(state, action(state, "valve")).draft;
  for (const mutate of [
    (draft: DesignDraft) => { draft.drawingMetadata!.schemaVersion = "future" as never; },
    (draft: DesignDraft) => { draft.drawingMetadata!.records[0].target = { kind: "map_feature", id: "missing" }; },
    (draft: DesignDraft) => { draft.drawingMetadata!.records[0].capture.vertexRecordedAt = []; },
    (draft: DesignDraft) => { draft.drawingMetadata!.records.push(draft.drawingMetadata!.records[0]); },
    (draft: DesignDraft) => { draft.drawingMetadata!.autosaveEnabled = false; },
    (draft: DesignDraft) => { draft.drawingMetadata!.records[0].classification.name = "Mismatch"; },
    (draft: DesignDraft) => { Object.assign(draft.drawingMetadata!, { future: true }); },
  ]) {
    const modified = structuredClone(committed); mutate(modified);
    const text = JSON.stringify(modified);
    assert.throws(() => serializeDesignDraftDocument(modified));
    assert.equal(JSON.stringify(modified), text);
  }
});

test("a promoted disabled preference survives reopening as a draft, drawing and undo", () => {
  const base = { ...structuredClone(sampleProject), settings: defaultProjectSettings(), drawingMetadata: {
    schemaVersion: PROJECT_DRAWING_METADATA_VERSION as typeof PROJECT_DRAWING_METADATA_VERSION, autosaveEnabled: false, records: [],
  } };
  const state = createDesignDraftEditorState(base);
  const begun = draw(state, { type: "begin", id: "next", name: "Next", geometryType: "Point" });
  assert.equal(begun.draft.drawingWorkflow!.autosaveEnabled, false);
  assert.equal(begun.draft.drawingMetadata!.autosaveEnabled, false);
  const undone = edit(begun, { type: "undo" });
  assert.equal(undone.draft.drawingMetadata!.autosaveEnabled, false);
  assert.equal(undone.draft.drawingWorkflow!.autosaveEnabled, false);
  const changed = draw(begun, { type: "set_autosave", enabled: true });
  assert.equal(changed.draft.drawingMetadata!.autosaveEnabled, true);
  assert.equal(parseDesignDraftDocument(serializeDesignDraftDocument(changed.draft)).drawingWorkflow!.autosaveEnabled, true);
});

test("project v2 refuses unknown fields in envelope, nested machine, geometry and settings without touching input", () => {
  const readyState = ready("valve");
  const result = tryBuildPivotProject(edit(readyState, action(readyState, "valve")).draft);
  assert(result.ok);
  const original = JSON.parse(serializeProjectDocument(result.project));
  for (const mutate of [
    (value: typeof original) => { value.futureWrapper = { retained: true }; },
    (value: typeof original) => { value.project.vendorFuture = { retained: true }; },
    (value: typeof original) => { value.project.machine.vendorFuture = { retained: true }; },
    (value: typeof original) => { value.project.machine.sweep.vendorFuture = { retained: true }; },
    (value: typeof original) => { value.project.mapFeatures[0].geometry.vendorFuture = { retained: true }; },
    (value: typeof original) => { value.project.settings.drawing.vendorFuture = { retained: true }; },
  ]) {
    const value = structuredClone(original);
    mutate(value);
    const before = JSON.stringify(value);
    assert.throws(() => parseProjectDocument(value), /unsupported fields/);
    assert.throws(() => parseProjectDocument(before), /unsupported fields/);
    if (!Object.hasOwn(value, "futureWrapper")) assert.throws(() => serializeProjectDocument(value.project), /unsupported fields/);
    assert.equal(JSON.stringify(value), before);
  }
  const legacy = structuredClone(sampleProject);
  Object.assign(legacy.machine, { vendorFuture: { legacyNormalization: true } });
  assert.doesNotThrow(() => parseProjectDocument({ documentVersion: "pivot-project-v1", project: legacy }));
  assert.doesNotThrow(() => serializeProjectDocument(legacy));
});
