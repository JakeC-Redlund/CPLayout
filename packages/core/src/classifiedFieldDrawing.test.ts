import assert from "node:assert/strict";
import test from "node:test";
import { workflowTestField, workflowTestPoint, workflowTestTime as now } from "./productionWorkflowTestFixtures";
import { createFieldDesignEditorState, reduceFieldDesignEditorState } from "./fieldDesignEditor";
import { serializeFieldDesignDocument, parseFieldDesignDocument, type FieldDrawingMetadataTarget } from "./fieldDesignDocument";
import { DRAWING_CLASSIFICATION_VERSION } from "./drawingClassification";
import type { ClassifiedFieldDrawingCommand } from "./classifiedFieldDrawing";
import type { XY } from "./types";

function drawing(target: FieldDrawingMetadataTarget, purposeId: string, geometryType: "Point" | "LineString" | "Polygon", points: XY[]): ClassifiedFieldDrawingCommand {
  return { type: "commit_manual_geometry", fieldId: "synthetic-field", projectCrs: "EPSG:32613", expectedRevision: 0,
    captureId: "actual-field-clicks", geometryType, vertices: points.map(point => ({ point: { ...point }, recordedAt: now, wgs84: null, elevation: null })),
    classification: { schemaVersion: DRAWING_CLASSIFICATION_VERSION, purposeId, geometryType, name: "Exact field drawing name  ", notes: "Exact notes\nsecond line", assetStatus: "unknown", placement: "not_applicable", customLabel: null, effect: { mode: "informational" } }, target };
}
test("Field manual boundary commits actual click geometry and provenance once; undo retains original recorded observations", () => {
  const field = workflowTestField(), point = workflowTestPoint(); field.surveyPoints.push(point);
  const state = createFieldDesignEditorState(field), before = structuredClone(state.field);
  const action = drawing({ kind: "field_boundary" }, "field_boundary", "Polygon", [{ x: 499900, y: 4427700 }, { x: 500100, y: 4427700 }, { x: 500100, y: 4427900 }]); action.replaceExisting = true;
  const next = reduceFieldDesignEditorState(state, action); assert.equal(next.lastError, null); assert.equal(next.revision, 1);
  assert.deepEqual(next.field.fieldBoundary, action.vertices.map(vertex => vertex.point)); assert.deepEqual(next.field.surveyPoints, before.surveyPoints); assert.deepEqual(state.field, before);
  const record = next.field.drawingMetadata!.records[0]; assert.equal(record.capture.source, "map_digitized"); assert("classification" in record);
  assert.equal(record.classification.notes, action.classification.notes); assert.deepEqual(record.capture.vertexRecordedAt, [now, now, now]);
  assert.deepEqual(parseFieldDesignDocument(serializeFieldDesignDocument(next.field)), next.field);
  assert.deepEqual(reduceFieldDesignEditorState(next, { type: "undo" }).field, before);
  assert(reduceFieldDesignEditorState(next, { ...action, expectedRevision: 1 }).lastError?.includes("already committed"));
});
test("Field pivot drawing explicitly resolves an existing machine, preserves evidence and removes only its replaced current link", () => {
  const field = workflowTestField(), point = workflowTestPoint(1, "pivot_center"); field.surveyPoints.push(point); field.machines[0].pivotObservationId = point.id;
  const state = createFieldDesignEditorState(field), action = drawing({ kind: "pivot_center", machineId: field.machines[0].id }, "pivot_center", "Point", [{ x: point.projected.x + 1, y: point.projected.y }]); action.replaceExisting = true;
  const next = reduceFieldDesignEditorState(state, action); assert.equal(next.lastError, null); assert.equal(next.field.machines[0].pivotObservationId, undefined);
  assert.deepEqual(next.field.surveyPoints, field.surveyPoints); assert.equal(next.field.drawingMetadata!.records[0].capture.source, "map_digitized");
  const record = next.field.drawingMetadata!.records[0]; assert("classification" in record); assert.deepEqual(record.capture.vertexRecordedAt, [now]);
  assert(reduceFieldDesignEditorState(state, { ...action, target: { kind: "pivot_center", machineId: "missing" } }).lastError?.includes("actual pivot"));
  assert(reduceFieldDesignEditorState(state, { ...action, replaceExisting: false }).lastError?.includes("Confirm replacing"));
});
test("actual Field line and point purposes retain independent identities; wrong source and stale callbacks refuse", () => {
  const state = createFieldDesignEditorState(workflowTestField()), action = drawing({ kind: "map_feature", id: "line" }, "reference_line", "LineString", [{ x: 499900, y: 4427700 }, { x: 500100, y: 4427900 }]);
  const next = reduceFieldDesignEditorState(state, action); assert.equal(next.lastError, null); assert.equal(next.field.mapFeatures!.at(-1)!.id, "line");
  for (const change of [{ fieldId: "other" }, { projectCrs: "EPSG:32612" }, { expectedRevision: 10 }, { geometryType: "Point" as const }, { target: { kind: "pivot_center" as const, machineId: "missing" } }]) {
    const rejected = reduceFieldDesignEditorState(state, { ...action, ...change }); assert(rejected.lastError); assert.deepEqual(rejected.field, state.field); assert.equal(rejected.revision, state.revision);
  }
});
test("lateral creation, selection and history use its real model and never manufacture pivot configuration", () => {
  const state = createFieldDesignEditorState(workflowTestField()), lateral = { id: "lateral", kind: "straight_lateral" as const, name: "Actual entered lateral",
    leftExtentMeters: 100, rightExtentMeters: 50, travelHeadingDegrees: 0, travel: { start: { x: 499900, y: 4427700 }, end: { x: 500100, y: 4427700 } }, machineClearanceBufferMeters: 1 };
  const added = reduceFieldDesignEditorState(state, { type: "add_lateral", machine: lateral }); assert.equal(added.lastError, null); assert.deepEqual(added.field.machines, state.field.machines);
  const selected = reduceFieldDesignEditorState(added, { type: "select_machine", id: lateral.id }); assert.equal(selected.selectedMachineId, lateral.id);
  assert.equal(reduceFieldDesignEditorState(selected, { type: "select_lateral", id: "missing" }).selectedMachineId, lateral.id);
  assert.deepEqual(reduceFieldDesignEditorState(added, { type: "undo" }).field, state.field);
});
