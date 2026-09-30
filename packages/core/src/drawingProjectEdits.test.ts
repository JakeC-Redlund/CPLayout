import assert from "node:assert/strict";
import test from "node:test";
import { DRAWING_CLASSIFICATION_VERSION, type DrawingClassification } from "./drawingClassification";
import { PROJECT_DRAWING_METADATA_VERSION } from "./drawingMetadata";
import { createProjectEditorState, reduceProjectEditorState, type ProjectEditorAction, type ProjectEditorState } from "./projectReducer";
import { importProjectedGeoJsonToProject, importSurveyCsvToProject } from "./projectImports";
import { sampleProject } from "./sampleProject";
import type { PivotProject, XY } from "./types";

const observed = "2026-09-27T10:00:00Z";
function classification(purposeId: "field_boundary" | "valve", name: string): DrawingClassification {
  return { schemaVersion: DRAWING_CLASSIFICATION_VERSION, geometryType: purposeId === "valve" ? "Point" : "Polygon",
    purposeId, name, notes: "Original notes", assetStatus: "unknown", placement: "not_applicable", customLabel: null,
    effect: { mode: "informational" } };
}
function project(): PivotProject {
  const source = structuredClone(sampleProject);
  source.mapFeatures = [{ id: "valve", name: "Valve", notes: "Original notes", kind: "reference_point", confidence: "user_estimated",
    geometry: { type: "Point", point: { ...source.pivotCenter } } }];
  source.drawingMetadata = { schemaVersion: PROJECT_DRAWING_METADATA_VERSION, autosaveEnabled: false, records: [
    { target: { kind: "field_boundary" }, classification: classification("field_boundary", "Field"),
      capture: { captureId: "boundary-capture", source: "map_digitized", vertexRecordedAt: source.fieldBoundary.map(() => observed), wgs84: null, elevation: null } },
    { target: { kind: "map_feature", id: "valve" }, classification: classification("valve", "Valve"),
      capture: { captureId: "valve-capture", source: "map_digitized", vertexRecordedAt: [observed], wgs84: null, elevation: null } },
  ] };
  return source;
}
function geoJson(source: PivotProject, boundary: XY[]) {
  return { type: "FeatureCollection", properties: { projectCrs: source.projectCrs }, features: [
    { type: "Feature", properties: { layerType: "field_boundary" }, geometry: {
      type: "Polygon", coordinates: [[...boundary, boundary[0]].map(point => [point.x, point.y])],
    } },
  ] };
}
function edit(state: ProjectEditorState, action: ProjectEditorAction): ProjectEditorState {
  const next = reduceProjectEditorState(state, action);
  assert.equal(next.lastError, null);
  return next;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function exactUndo(before: ProjectEditorState, next: ProjectEditorState) {
  assert.equal(next.revision, before.revision + 1);
  assert.equal(next.past.length, before.past.length + 1);
  const undone = edit(next, { type: "undo" });
  assert.deepEqual(undone.project, before.project);
  assert.deepEqual(edit(undone, { type: "redo" }).project, next.project);
}

test("GeoJSON replaces a classified boundary with a different vertex count before validating retained metadata", () => {
  const source = project();
  source.fieldBoundaryCaptureEvidence = source.fieldBoundary.map(() => null);
  const boundary = source.fieldBoundary.slice(0, 3);
  const input = freeze(geoJson(source, boundary));
  const before = JSON.stringify(source);
  freeze(source);
  const result = importProjectedGeoJsonToProject(source, input);
  assert.deepEqual(result.project.fieldBoundary, boundary);
  assert.deepEqual(result.project.drawingMetadata!.records[0].capture.vertexRecordedAt, [null, null, null]);
  assert.deepEqual(result.project.drawingMetadata!.records[1], source.drawingMetadata!.records[1]);
  assert.equal(result.project.fieldBoundaryCaptureEvidence, undefined);
  assert.equal(JSON.stringify(source), before);
  const state = createProjectEditorState(source);
  const next = edit(state, { type: "import_projected_geojson", geoJson: input });
  assert.deepEqual(next.project.fieldBoundary, boundary);
  assert.deepEqual(next.project.drawingMetadata, result.project.drawingMetadata);
  exactUndo(state, next);
});

test("same-count imported coordinate changes reset times while unchanged imports retain them", () => {
  const source = project();
  const changed = source.fieldBoundary.map(point => ({ x: point.x + 3, y: point.y + 2 }));
  const result = importProjectedGeoJsonToProject(source, geoJson(source, changed));
  assert.deepEqual(result.project.drawingMetadata!.records[0].capture.vertexRecordedAt, changed.map(() => null));
  const same = importProjectedGeoJsonToProject(source, geoJson(source, source.fieldBoundary));
  assert.deepEqual(same.project.drawingMetadata, source.drawingMetadata);
});

test("renaming a classified feature synchronizes classification without changing geometry times or caller input", () => {
  for (const type of ["update_map_feature", "upsert_map_features"] as const) {
    for (const notes of ["New notes", undefined]) {
      const state = createProjectEditorState(project());
      freeze(state.project);
      const feature = { ...state.project.mapFeatures![0], name: " Renamed ", notes };
      if (notes === undefined) delete feature.notes;
      freeze(feature);
      const before = JSON.stringify(feature);
      const command: ProjectEditorAction = type === "update_map_feature" ? { type, feature } : { type, features: [feature] };
      const next = edit(state, command);
      const record = next.project.drawingMetadata!.records[1];
      assert.equal(record.classification.name, " Renamed ");
      assert.equal(record.classification.notes, notes ?? "");
      assert.deepEqual(record.capture, state.project.drawingMetadata!.records[1].capture);
      assert.equal(next.project.mapFeatures![0].notes, notes ?? "");
      assert.equal(JSON.stringify(feature), before);
      assert.equal(Object.hasOwn(feature, "notes"), notes !== undefined);
      exactUndo(state, next);
    }
  }
});

test("deleting a classified feature removes only its target metadata and undo restores both exactly", () => {
  const state = createProjectEditorState(project());
  const before = JSON.stringify(state.project);
  freeze(state.project);
  const next = edit(state, { type: "delete_map_feature", id: "valve" });
  assert.deepEqual(next.project.mapFeatures, []);
  assert.deepEqual(next.project.drawingMetadata!.records, [state.project.drawingMetadata!.records[0]]);
  assert.equal(next.project.drawingMetadata!.autosaveEnabled, false);
  assert.equal(JSON.stringify(state.project), before);
  exactUndo(state, next);
});

test("complete project imports retain supplied metadata rather than inheriting timestamps or labels", () => {
  const state = createProjectEditorState(project());
  const imported = structuredClone(state.project);
  imported.fieldBoundary = imported.fieldBoundary.slice(0, 3);
  imported.drawingMetadata!.records[0].capture.vertexRecordedAt = imported.fieldBoundary.map(() => "2026-09-27T11:00:00Z");
  imported.mapFeatures![0].name = "Imported valve";
  imported.drawingMetadata!.records[1].classification.name = "Imported valve";
  imported.drawingMetadata!.records[1].capture.vertexRecordedAt = ["2026-09-27T12:00:00Z"];
  const before = JSON.stringify(imported);
  freeze(imported);
  const next = edit(state, { type: "apply_project_import", project: imported });
  assert.deepEqual(next.project.drawingMetadata, imported.drawingMetadata);
  assert.equal(JSON.stringify(imported), before);
  exactUndo(state, next);

  // Even an identical object reference does not grant permission to rewrite supplied import evidence.
  const inconsistent = { ...state.project, fieldBoundary: state.project.fieldBoundary.slice(0, 3) };
  const failed = reduceProjectEditorState(state, { type: "apply_project_import", project: inconsistent });
  assert.match(failed.lastError ?? "", /align/);
  assert.strictEqual(failed.project, state.project);
  assert.strictEqual(failed.past, state.past);
  assert.equal(failed.revision, state.revision);
});

test("CSV survey imports retain classified geometry metadata without modifying the source", () => {
  const source = freeze(project());
  const before = JSON.stringify(source);
  const csv = "id,label,role,x,y,source,confidence\nnew-point,Control,control,501010,4506010,imported,user_estimated\n";
  const direct = importSurveyCsvToProject(source, csv);
  assert.deepEqual(direct.project.drawingMetadata, source.drawingMetadata);
  assert.equal(JSON.stringify(source), before);
  const state = createProjectEditorState(source);
  const next = edit(state, { type: "import_survey_csv", csv });
  assert.deepEqual(next.project.drawingMetadata, source.drawingMetadata);
  exactUndo(state, next);
});

test("invalid classified edits fail without mutating shared state, command, or undo history", () => {
  const state = createProjectEditorState(project());
  const feature = freeze({ ...state.project.mapFeatures![0], name: " " });
  const before = JSON.stringify(state);
  const failed = reduceProjectEditorState(state, { type: "update_map_feature", feature });
  assert(failed.lastError);
  assert.strictEqual(failed.project, state.project);
  assert.strictEqual(failed.past, state.past);
  assert.equal(failed.revision, state.revision);
  assert.equal(JSON.stringify(state), before);
  assert.equal(feature.name, " ");
});
