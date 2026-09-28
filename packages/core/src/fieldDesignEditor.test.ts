import assert from "node:assert/strict";
import test from "node:test";

import { convertPivotProjectToFieldDesign, type FieldDesign, type FieldDrawingMetadataRecord, type FieldDrawingMetadataTarget, type FieldPivotMachine } from "./fieldDesignDocument";
import { DRAWING_CLASSIFICATION_VERSION, drawingPurpose } from "./drawingClassification";
import { createFieldDesignEditorState, reduceFieldDesignEditorState, type FieldDesignEditorAction, type FieldDesignEditorState } from "./fieldDesignEditor";
import { sampleProject } from "./sampleProject";

function fixture(): FieldDesign {
  return convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), {
    fieldId: "field-editor-test", waterSourceId: "shared-water", powerSourceId: "shared-power",
  }).field;
}

function secondMachine(field: FieldDesign): FieldPivotMachine {
  const machine = structuredClone(field.machines[0]);
  machine.id = "machine-b";
  machine.configuration.name = "Independent second pivot";
  machine.configuration.spanLengthsMeters = [30, 35, 40];
  machine.pivotCenter = { x: machine.pivotCenter.x + 100, y: machine.pivotCenter.y + 75 };
  return machine;
}

function edit(state: FieldDesignEditorState, action: FieldDesignEditorAction): FieldDesignEditorState {
  const before = structuredClone(state);
  const input = structuredClone(action);
  const result = reduceFieldDesignEditorState(state, action);
  assert.equal(result.lastError, null);
  assert.deepEqual(state, before, "prior state must not be mutated");
  assert.deepEqual(action, input, "action must not be mutated");
  return result;
}

function reject(state: FieldDesignEditorState, action: unknown): FieldDesignEditorState {
  const before = structuredClone(state);
  const result = reduceFieldDesignEditorState(state, action as FieldDesignEditorAction);
  assert.ok(result.lastError);
  assert.strictEqual(result.field, state.field);
  assert.strictEqual(result.past, state.past);
  assert.strictEqual(result.future, state.future);
  assert.equal(result.revision, state.revision);
  assert.equal(result.selectedMachineId, state.selectedMachineId);
  assert.deepEqual(state, before);
  return result;
}

test("two independent machines share one boundary and updates preserve sibling and shared data", () => {
  const initial = createFieldDesignEditorState(fixture());
  const added = edit(initial, { type: "add_machine", machine: secondMachine(initial.field) });
  assert.deepEqual(added.field.machines.map(machine => machine.id), ["machine-a", "machine-b"]);
  assert.equal(added.selectedMachineId, null);
  assert.equal(added.revision, 1);
  for (const machine of added.field.machines) {
    assert.equal(machine.waterSourceId, "shared-water");
    assert.equal(machine.powerSourceId, "shared-power");
  }
  const machine = structuredClone(added.field.machines[1]);
  machine.pivotCenter.x += 20;
  machine.configuration.spanLengthsMeters[0] = 55;
  machine.configuration.sweep = { mode: "partial_circle", startAngleDegrees: 15, stopAngleDegrees: 120, direction: "clockwise" };
  const updated = edit(added, { type: "update_machine", machine });
  assert.deepEqual(updated.field.machines[0], initial.field.machines[0]);
  assert.deepEqual(updated.field.machines[1], machine);
  const { machines: _initialMachines, ...sharedBefore } = initial.field;
  const { machines: _updatedMachines, ...sharedAfter } = updated.field;
  assert.deepEqual(sharedAfter, sharedBefore);
  assert.equal(updated.revision, 2);
});

test("selection is explicit view state and does not consume undo or discard redo", () => {
  const initial = createFieldDesignEditorState(fixture());
  const added = edit(initial, { type: "add_machine", machine: secondMachine(initial.field) });
  const undone = edit(added, { type: "undo" });
  const selected = edit(undone, { type: "select_machine", id: "machine-a" });
  assert.equal(selected.selectedMachineId, "machine-a");
  assert.strictEqual(selected.field, undone.field);
  assert.strictEqual(selected.past, undone.past);
  assert.strictEqual(selected.future, undone.future);
  assert.equal(selected.revision, undone.revision);
  const cleared = edit(selected, { type: "select_machine", id: null });
  assert.equal(cleared.selectedMachineId, null);
  const redone = edit(cleared, { type: "redo" });
  assert.deepEqual(redone.field, added.field);
  assert.equal(redone.selectedMachineId, null);
});

test("undo and redo restore whole field snapshots without dangling or resurrected selection", () => {
  const initial = createFieldDesignEditorState(fixture());
  const added = edit(initial, { type: "add_machine", machine: secondMachine(initial.field) });
  const selected = edit(added, { type: "select_machine", id: "machine-b" });
  const undone = edit(selected, { type: "undo" });
  assert.deepEqual(undone.field, initial.field);
  assert.equal(undone.selectedMachineId, null);
  assert.equal(undone.revision, 2);
  const redone = edit(undone, { type: "redo" });
  assert.deepEqual(redone.field, added.field);
  assert.equal(redone.selectedMachineId, null);
  assert.equal(redone.revision, 3);
  const removed = edit(edit(redone, { type: "select_machine", id: "machine-b" }), { type: "remove_machine", id: "machine-b" });
  assert.equal(removed.selectedMachineId, null);
  const restored = edit(removed, { type: "undo" });
  assert.deepEqual(restored.field, added.field);
  assert.equal(restored.selectedMachineId, null);
  const reselected = edit(restored, { type: "select_machine", id: "machine-b" });
  assert.equal(edit(reselected, { type: "redo" }).selectedMachineId, null);
  assert.equal(edit(edit(added, { type: "select_machine", id: "machine-a" }), { type: "undo" }).selectedMachineId, "machine-a");
});

test("multiple undo and redo steps retain ordering and a new edit discards the old future", () => {
  const initial = createFieldDesignEditorState(fixture());
  const added = edit(initial, { type: "add_machine", machine: secondMachine(initial.field) });
  const updated = edit(added, { type: "update_machine", machine: {
    ...added.field.machines[1], pivotCenter: { x: 501500, y: 4506500 },
  } });
  const once = edit(updated, { type: "undo" });
  assert.deepEqual(once.field, added.field);
  const twice = edit(once, { type: "undo" });
  assert.deepEqual(twice.field, initial.field);
  const forward = edit(twice, { type: "redo" });
  assert.deepEqual(forward.field, added.field);
  assert.deepEqual(edit(forward, { type: "redo" }).field, updated.field);
  const branched = edit(forward, { type: "remove_machine", id: "machine-a" });
  assert.equal(branched.future.length, 0);
  assert.strictEqual(edit(branched, { type: "redo" }), branched);
});

test("duplicate adds, unknown identities, and malformed actions preserve data and both histories", () => {
  const initial = createFieldDesignEditorState(fixture());
  const added = edit(initial, { type: "add_machine", machine: secondMachine(initial.field) });
  const removed = edit(added, { type: "remove_machine", id: "machine-b" });
  const state = edit(edit(removed, { type: "undo" }), { type: "select_machine", id: "machine-a" });
  assert.ok(state.past.length && state.future.length);
  for (const action of [
    { type: "add_machine", machine: state.field.machines[0] },
    { type: "update_machine", machine: { ...state.field.machines[0], id: "unknown" } },
    { type: "remove_machine", id: "unknown" },
    { type: "select_machine", id: "unknown" },
    { type: "select_machine", id: undefined },
    { type: "select_machine" },
    { type: "adopt_advisory_outlines" },
    { type: "constructor" },
    { type: "undo", machine: state.field.machines[0] },
    { type: "update_machine", machine: null },
    null,
  ]) reject(state, action);
});

test("pivot movement rejects a stale observation until explicitly detached or reassociated", () => {
  const field = fixture();
  field.machines[0].pivotObservationId = "pivot-rtk";
  const nextPoint = { x: field.machines[0].pivotCenter.x + 10, y: field.machines[0].pivotCenter.y };
  field.surveyPoints.push({ ...structuredClone(field.surveyPoints[0]), id: "pivot-new", projected: nextPoint });
  const state = createFieldDesignEditorState(field);
  const machine = { ...state.field.machines[0], pivotCenter: nextPoint };
  reject(state, { type: "update_machine", machine });
  const { pivotObservationId: _oldObservation, ...detached } = machine;
  const moved = edit(state, { type: "update_machine", machine: detached });
  assert.equal(Object.hasOwn(moved.field.machines[0], "pivotObservationId"), false);
  const reassociated = edit(state, { type: "update_machine", machine: { ...machine, pivotObservationId: "pivot-new" } });
  assert.equal(reassociated.field.machines[0].pivotObservationId, "pivot-new");
  assert.equal(edit(reassociated, { type: "undo" }).field.machines[0].pivotObservationId, "pivot-rtk");
});

function withReferences(): FieldDesign {
  const field = fixture();
  field.mapFeatures = [
    { id: "guidance", name: "Explicit guidance", kind: "measurement_line", confidence: "user_estimated",
      geometry: { type: "LineString", vertices: [{ x: 501000, y: 4506200 }, { x: 501050, y: 4506250 }] } },
    { id: "outline", name: "Advisory outline", kind: "machine_zone", confidence: "user_estimated",
      geometry: { type: "Circle", center: { x: 501400, y: 4506500 }, radiusMeters: 100 },
      properties: { evidenceOnly: true, preferredMachineOutline: true } },
  ];
  return field;
}

test("machine edits delegate dangling, duplicate, and incompatible references to the field validator", () => {
  const state = createFieldDesignEditorState(withReferences());
  const base = state.field.machines[0];
  for (const references of [
    { pivotObservationId: "missing" },
    { waterSourceId: "missing" },
    { powerSourceId: "missing" },
    { waterSourceId: "shared-power" },
    { powerSourceId: "shared-water" },
    { cornerGuidanceFeatureId: "missing" },
    { cornerGuidanceFeatureId: "outline" },
    { sourceFeatureIds: ["missing"] },
    { sourceFeatureIds: ["guidance", "guidance"] },
  ]) {
    reject(state, { type: "update_machine", machine: { ...base, ...references } });
    reject(state, { type: "add_machine", machine: { ...base, ...references, id: "machine-b" } });
  }
  const accepted = edit(state, { type: "update_machine", machine: {
    ...base, pivotObservationId: "pivot-rtk", sourceFeatureIds: ["guidance", "outline"], cornerGuidanceFeatureId: "guidance",
  } });
  assert.deepEqual(accepted.field.machines[0].sourceFeatureIds, ["guidance", "outline"]);
  assert.deepEqual(accepted.field.mapFeatures, state.field.mapFeatures);
});

test("empty machine lists stay empty and advisory outlines are never auto-adopted", () => {
  const field = withReferences();
  field.machines = [];
  const state = createFieldDesignEditorState(field);
  assert.deepEqual(state.field.machines, []);
  assert.equal(state.selectedMachineId, null);
  assert.strictEqual(edit(state, { type: "undo" }), state);
  assert.strictEqual(edit(state, { type: "redo" }), state);
  const single = createFieldDesignEditorState(fixture());
  const removed = edit(single, { type: "remove_machine", id: "machine-a" });
  assert.deepEqual(removed.field.machines, []);
  assert.equal(edit(removed, { type: "undo" }).field.machines[0].id, "machine-a");
});

test("initial, add, update, and load inputs cannot later mutate field or history snapshots", () => {
  const field = fixture();
  const expected = structuredClone(field);
  const initial = createFieldDesignEditorState(field);
  field.fieldBoundary[0].x += 999;
  field.machines[0].configuration.spanLengthsMeters[0] = 999;
  assert.deepEqual(initial.field, expected);
  const machine = secondMachine(initial.field);
  const added = edit(initial, { type: "add_machine", machine });
  const expectedAdded = structuredClone(added.field);
  machine.pivotCenter.x += 999;
  machine.configuration.spanLengthsMeters[0] = 999;
  assert.deepEqual(added.field, expectedAdded);
  const replacement = structuredClone(added.field.machines[1]);
  replacement.configuration.name = "Updated second pivot";
  const updated = edit(added, { type: "update_machine", machine: replacement });
  const expectedUpdated = structuredClone(updated.field);
  const undone = edit(updated, { type: "undo" });
  replacement.configuration.spanLengthsMeters[0] = 999;
  replacement.pivotCenter.y += 999;
  assert.deepEqual(undone.future[0], expectedUpdated);
  assert.deepEqual(undone.field, expectedAdded);
  assert.deepEqual(updated.past, [expected, expectedAdded]);
  const loadedField = fixture();
  const loaded = edit(updated, { type: "load_field", field: loadedField });
  loadedField.infrastructure[0].point.x += 999;
  loadedField.surveyPoints[0].projected.y += 999;
  assert.deepEqual(loaded.field, expected);
});

test("validated load resets selection and history; invalid loads retain the active editor", () => {
  const initial = createFieldDesignEditorState(fixture());
  const added = edit(initial, { type: "add_machine", machine: secondMachine(initial.field) });
  const state = edit(added, { type: "select_machine", id: "machine-b" });
  const invalid = fixture();
  invalid.machines.push(structuredClone(invalid.machines[0]));
  reject(state, { type: "load_field", field: invalid });
  assert.throws(() => createFieldDesignEditorState(invalid));
  const dangling = fixture();
  dangling.machines[0].pivotObservationId = "missing";
  reject(state, { type: "load_field", field: dangling });
  const loaded = edit(state, { type: "load_field", field: fixture() });
  assert.deepEqual(loaded, initial);
});

test("identical updates preserve redo and revision, and errors can be cleared without mutation", () => {
  const initial = createFieldDesignEditorState(fixture());
  const added = edit(initial, { type: "add_machine", machine: secondMachine(initial.field) });
  const state = edit(added, { type: "undo" });
  assert.strictEqual(edit(state, { type: "update_machine", machine: structuredClone(state.field.machines[0]) }), state);
  const failed = reject(state, { type: "remove_machine", id: "missing" });
  assert.deepEqual(edit(failed, { type: "clear_error" }), state);
  assert.deepEqual(edit(failed, { type: "update_machine", machine: state.field.machines[0] }), state);
});

test("malformed nested machine input and accessor actions fail without executing hooks", () => {
  const state = createFieldDesignEditorState(fixture());
  reject(state, { type: "update_machine", machine: { ...state.field.machines[0], unexpected: "discard me" } });
  reject(state, { type: "update_machine", machine: { ...state.field.machines[0], pivotCenter: { x: NaN, y: 1 } } });
  const action = { type: "update_machine", get machine() { throw new Error("Getter must not run"); } };
  assert.match(reject(state, action).lastError!, /accessors/);
  const cyclic: Record<string, unknown> = { type: "add_machine" };
  cyclic.machine = cyclic;
  assert.match(reject(state, cyclic).lastError!, /Cyclic/);
});

test("invalid or exhausted revisions cannot partially apply mutations or history travel", () => {
  const initial = createFieldDesignEditorState(fixture());
  const added = edit(initial, { type: "add_machine", machine: secondMachine(initial.field) });
  for (const revision of [-1, 1.5, Number.MAX_SAFE_INTEGER]) {
    const state = { ...added, revision };
    reject(state, { type: "remove_machine", id: "machine-b" });
    reject(state, { type: "undo" });
  }
});

test("complete plan adoption is one revision and one undo while existing machines stay pinned", () => {
  const initial = createFieldDesignEditorState(fixture());
  const machines = [structuredClone(initial.field.machines[0]), secondMachine(initial.field)];
  const adopted = edit(initial, { type: "adopt_plan", expectedRevision: 0, machines });
  assert.equal(adopted.revision, 1);
  assert.equal(adopted.past.length, 1);
  assert.deepEqual(edit(adopted, { type: "undo" }).field, initial.field);
  machines[1].configuration.spanLengthsMeters[0] = 900;
  assert.equal(adopted.field.machines[1].configuration.spanLengthsMeters[0], 30);
  const updatedA = { ...adopted.field.machines[0], pivotCenter: { x: 4, y: 5 } };
  const changedA = edit(adopted, { type: "update_machine", machine: updatedA });
  const updatedB = { ...changedA.field.machines[1], pivotCenter: { x: 6, y: 7 } };
  const changedB = edit(changedA, { type: "update_machine", machine: updatedB });
  const undoneB = edit(changedB, { type: "undo" });
  assert.deepEqual(undoneB.field.machines[0], updatedA);
  assert.deepEqual(undoneB.field.machines[1], adopted.field.machines[1]);
  assert.deepEqual(edit(undoneB, { type: "undo" }).field, adopted.field);
});

test("adoption rejects stale revisions, pinned changes, duplicate IDs and dangling references atomically", () => {
  const state = createFieldDesignEditorState(fixture());
  const a = state.field.machines[0];
  const b = secondMachine(state.field);
  for (const change of [
    { expectedRevision: 1, machines: [a, b] },
    { expectedRevision: 0, machines: [b] },
    { expectedRevision: 0, machines: [a, a] },
    { expectedRevision: 0, machines: [a, { ...b, waterSourceId: "missing" }] },
    { expectedRevision: 0, machines: [{ ...a, pivotCenter: { x: 4, y: 5 } }, b] },
    { expectedRevision: 0, machines: [a, b], allowedReplacementMachineIds: ["unknown"] },
    { expectedRevision: 0, machines: [a, b], allowedReplacementMachineIds: [a.id, a.id] },
  ]) reject(state, { type: "adopt_plan", ...change });
  const replaced = edit(state, { type: "adopt_plan", expectedRevision: 0, machines: [b], allowedReplacementMachineIds: [a.id] });
  assert.deepEqual(replaced.field.machines, [b]);
  assert.deepEqual(edit(replaced, { type: "undo" }).field, state.field);
});

function classifiedField(): FieldDesign {
  const field = fixture();
  field.machines.push(secondMachine(field));
  field.mapFeatures = [{ id: "reference-line", name: "Shared reference", notes: "Retain shared evidence", kind: "reference_line",
    confidence: "user_estimated", geometry: { type: "LineString", vertices: field.fieldBoundary.slice(0, 2) } }];
  const specifications: Array<{ purposeId: string; target: FieldDrawingMetadataTarget; count: number }> = [
    { purposeId: "field_boundary", target: { kind: "field_boundary" }, count: field.fieldBoundary.length },
    { purposeId: "pivot_center", target: { kind: "pivot_center", machineId: field.machines[0].id }, count: 1 },
    { purposeId: "project_water_source", target: { kind: "water_source", infrastructureId: "shared-water" }, count: 1 },
    { purposeId: "pivot_center", target: { kind: "pivot_center", machineId: field.machines[1].id }, count: 1 },
    { purposeId: "reference_line", target: { kind: "map_feature", id: "reference-line" }, count: 2 },
    { purposeId: "project_power_source", target: { kind: "power_source", infrastructureId: "shared-power" }, count: 1 },
  ];
  field.drawingMetadata = { schemaVersion: "field-drawing-metadata-v1", autosaveEnabled: false,
    records: specifications.map((specification, index): FieldDrawingMetadataRecord => {
      const purpose = drawingPurpose(specification.purposeId)!;
      return { target: specification.target,
        classification: { schemaVersion: DRAWING_CLASSIFICATION_VERSION, geometryType: purpose.geometry, purposeId: purpose.id,
          name: specification.target.kind === "map_feature" ? "Shared reference" : purpose.label,
          notes: "Retain shared evidence", assetStatus: "proposed", placement: purpose.placements[0], customLabel: null,
          effect: { mode: "informational" } },
        capture: { captureId: `capture-${index}`, source: "map_digitized",
          vertexRecordedAt: Array(specification.count).fill(`2026-09-27T12:0${index}:00.000Z`), wgs84: null, elevation: null } };
    }),
  };
  return field;
}

function pivotRecord(field: FieldDesign, machineId: string): FieldDrawingMetadataRecord | undefined {
  return field.drawingMetadata!.records.find(record => record.target.kind === "pivot_center" && record.target.machineId === machineId);
}

test("classified machine updates clear only moved pivot capture time and undo restores the exact record", () => {
  const initial = createFieldDesignEditorState(classifiedField());
  const machine = structuredClone(initial.field.machines[1]);
  machine.configuration.name = "Reconfigured without moving";
  machine.configuration.spanLengthsMeters[0] += 5;
  const reconfigured = edit(initial, { type: "update_machine", machine });
  assert.deepEqual(reconfigured.field.drawingMetadata, initial.field.drawingMetadata);
  machine.pivotCenter.y += 15;
  const moved = edit(reconfigured, { type: "update_machine", machine });
  assert.deepEqual(pivotRecord(moved.field, machine.id), { ...pivotRecord(initial.field, machine.id)!,
    capture: { ...pivotRecord(initial.field, machine.id)!.capture, vertexRecordedAt: [null] } });
  assert.deepEqual(moved.field.drawingMetadata!.records.filter(record => record.target.kind !== "pivot_center" || record.target.machineId !== machine.id),
    initial.field.drawingMetadata!.records.filter(record => record.target.kind !== "pivot_center" || record.target.machineId !== machine.id));
  assert.equal(moved.field.drawingMetadata!.autosaveEnabled, false);
  assert.deepEqual(edit(moved, { type: "undo" }).field, reconfigured.field);
  assert.deepEqual(edit(edit(moved, { type: "undo" }), { type: "redo" }).field, moved.field);
});

test("removing a classified machine drops only its identity record and undo restores it at the original position", () => {
  const initial = createFieldDesignEditorState(classifiedField());
  const selected = edit(initial, { type: "select_machine", id: initial.field.machines[0].id });
  const removed = edit(selected, { type: "remove_machine", id: initial.field.machines[0].id });
  assert.equal(removed.selectedMachineId, null);
  assert.equal(pivotRecord(removed.field, initial.field.machines[0].id), undefined);
  assert.deepEqual(removed.field.drawingMetadata!.records, initial.field.drawingMetadata!.records.filter(record =>
    record.target.kind !== "pivot_center" || record.target.machineId !== initial.field.machines[0].id));
  assert.deepEqual(removed.field.infrastructure, initial.field.infrastructure);
  assert.deepEqual(removed.field.mapFeatures, initial.field.mapFeatures);
  assert.deepEqual(edit(removed, { type: "undo" }).field, initial.field);
  const readded = edit(removed, { type: "add_machine", machine: initial.field.machines[0] });
  assert.equal(pivotRecord(readded.field, initial.field.machines[0].id), undefined, "re-adding an identity cannot invent its old digitization time");
});

test("classified complete-plan adoption reconciles moved and removed IDs atomically independent of machine ordering", () => {
  const initial = createFieldDesignEditorState(classifiedField());
  const a = structuredClone(initial.field.machines[0]);
  const b = structuredClone(initial.field.machines[1]);
  const reordered = edit(initial, { type: "adopt_plan", expectedRevision: 0, machines: [b, a] });
  assert.deepEqual(reordered.field.drawingMetadata, initial.field.drawingMetadata);
  a.pivotCenter.x += 25;
  const replacement = { ...structuredClone(b), id: "replacement" };
  const adopted = edit(reordered, { type: "adopt_plan", expectedRevision: 1,
    machines: [replacement, a], allowedReplacementMachineIds: [a.id, b.id] });
  assert.equal(adopted.revision, 2);
  assert.equal(adopted.past.length, 2);
  assert.deepEqual(pivotRecord(adopted.field, a.id)!.capture.vertexRecordedAt, [null]);
  assert.equal(pivotRecord(adopted.field, b.id), undefined);
  assert.equal(pivotRecord(adopted.field, replacement.id), undefined);
  assert.deepEqual(adopted.field.drawingMetadata!.records.filter(record => record.target.kind !== "pivot_center"),
    initial.field.drawingMetadata!.records.filter(record => record.target.kind !== "pivot_center"));
  assert.deepEqual(edit(adopted, { type: "undo" }).field, reordered.field);
  assert.deepEqual(edit(edit(adopted, { type: "undo" }), { type: "undo" }).field, initial.field);
  assert.deepEqual(edit(edit(adopted, { type: "undo" }), { type: "redo" }).field, adopted.field);
});

test("rejected classified updates and adoptions leave timestamps and history untouched", () => {
  const initial = createFieldDesignEditorState(classifiedField());
  const changed = structuredClone(initial.field.machines[0]);
  changed.pivotCenter.x += 25;
  const machines = [changed, structuredClone(initial.field.machines[1])];
  reject(initial, { type: "adopt_plan", expectedRevision: 0, machines });
  reject(initial, { type: "adopt_plan", expectedRevision: 1, machines, allowedReplacementMachineIds: [changed.id] });
  reject(initial, { type: "update_machine", machine: { ...changed, waterSourceId: "missing" } });
  reject(initial, { type: "adopt_plan", expectedRevision: 0, machines: [changed, changed], allowedReplacementMachineIds: initial.field.machines.map(machine => machine.id) });
  assert.deepEqual(initial.field.drawingMetadata, classifiedField().drawingMetadata);
});
