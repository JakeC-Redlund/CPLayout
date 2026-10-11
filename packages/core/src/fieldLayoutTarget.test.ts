import assert from "node:assert/strict";
import test from "node:test";
import { convertPivotProjectToFieldDesign, parseFieldDesignDocument } from "./fieldDesignDocument";
import { createFieldDesignEditorState, reduceFieldDesignEditorState } from "./fieldDesignEditor";
import { createFieldLayoutTarget, fieldLayoutTargetMatches, parseFieldLayoutTarget, serializeFieldLayoutTarget } from "./fieldLayoutTarget";
import { sampleProject } from "./sampleProject";

function fixture() {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), {
    fieldId: "target-field", waterSourceId: "water", powerSourceId: "power",
  }).field;
  const second = structuredClone(field.machines[0]);
  second.id = "second";
  second.configuration.spanLengthsMeters = [10, 20];
  field.machines.push(second);
  return field;
}

test("a durable Layout target freezes the exact field and explicit selected identities", () => {
  const field = fixture();
  const selected = ["second", field.machines[0].id];
  const before = structuredClone(field);
  const target = createFieldLayoutTarget(field, { inputRevision: 7, expectedRevision: 7, selectedMachineIds: selected });
  assert.deepEqual(target.field, before);
  assert.deepEqual(target.source, { fieldId: field.id, inputRevision: 7, selectedMachineIds: selected });
  assert.equal(target.qualification, "design_snapshot_only");
  assert(Object.isFrozen(target));
  assert(Object.isFrozen(target.source.selectedMachineIds));
  assert(Object.isFrozen(target.field.machines[1].configuration.spanLengthsMeters));
  assert.equal(Reflect.set(target.field.fieldBoundary[0], "x", target.field.fieldBoundary[0].x + 1), false);
  assert.deepEqual(target.field.fieldBoundary, before.fieldBoundary);
  field.machines[1].configuration.spanLengthsMeters[0] = 99;
  selected.reverse();
  assert.deepEqual(target.field, before);
  assert.equal(target.source.selectedMachineIds[0], "second");
  const text = serializeFieldLayoutTarget(target);
  const reopened = parseFieldLayoutTarget(text);
  assert.deepEqual(reopened, target);
  assert(Object.isFrozen(reopened.field));
  assert.throws(() => parseFieldDesignDocument(text));
});

test("later design edits and undo cannot mutate the referenced target", () => {
  const state = createFieldDesignEditorState(fixture());
  const target = createFieldLayoutTarget(state.field, {
    inputRevision: state.revision, expectedRevision: state.revision, selectedMachineIds: ["second"],
  });
  const retained = serializeFieldLayoutTarget(target);
  const changed = structuredClone(state.field.machines[1]);
  changed.configuration.spanLengthsMeters[0] = 55;
  const edited = reduceFieldDesignEditorState(state, { type: "update_machine", machine: changed });
  assert.equal(edited.lastError, null);
  assert.equal(serializeFieldLayoutTarget(target), retained);
  assert(fieldLayoutTargetMatches(target, state.field, state.revision));
  assert(!fieldLayoutTargetMatches(target, edited.field, edited.revision));
  const undone = reduceFieldDesignEditorState(edited, { type: "undo" });
  assert.deepEqual(undone.field, state.field);
  assert(!fieldLayoutTargetMatches(target, undone.field, undone.revision));
  assert.equal(serializeFieldLayoutTarget(target), retained);
});

test("stale revision, empty selection, duplicates and missing machines refuse target creation", () => {
  const field = fixture();
  const request = { inputRevision: 5, expectedRevision: 5, selectedMachineIds: ["second"] };
  assert.throws(() => createFieldLayoutTarget(field, { ...request, expectedRevision: 4 }), /revision changed/);
  for (const selectedMachineIds of [[], ["second", "second"], ["missing"]]) {
    assert.throws(() => createFieldLayoutTarget(field, { ...request, selectedMachineIds }));
  }
});

test("snapshot export retains unsupported calculation context without implying eligibility", () => {
  const field = fixture();
  field.projectCrs = "LOCAL:undefined-units";
  delete field.machines[1].waterSourceId;
  const target = createFieldLayoutTarget(field, { inputRevision: 0, expectedRevision: 0, selectedMachineIds: ["second"] });
  assert.equal(target.field.projectCrs, "LOCAL:undefined-units");
  assert.equal(target.field.machines[1].waterSourceId, undefined);
  assert.equal(target.qualification, "design_snapshot_only");
  assert.deepEqual(parseFieldLayoutTarget(serializeFieldLayoutTarget(target)), target);
});

test("strict target import rejects mismatched identity, unknown data, downgraded versions and duplicate members", () => {
  const target = createFieldLayoutTarget(fixture(), { inputRevision: 1, expectedRevision: 1, selectedMachineIds: ["second"] });
  const text = serializeFieldLayoutTarget(target);
  for (const mutate of [
    (raw: any) => { raw.source.fieldId = "different"; },
    (raw: any) => { raw.documentVersion = "field-layout-target-v99"; },
    (raw: any) => { raw.source.selectedMachineIds = ["missing"]; },
    (raw: any) => { raw.qualification = "field_verified"; },
    (raw: any) => { raw.fieldDocument.field.futureData = true; },
    (raw: any) => { raw.crsOptions.futureData = true; },
    (raw: any) => { raw.extra = true; },
  ]) {
    const raw = JSON.parse(text);
    mutate(raw);
    assert.throws(() => parseFieldLayoutTarget(raw));
  }
  assert.throws(() => parseFieldLayoutTarget(text.replace('"inputRevision": 1', '"inputRevision": 0, "inputRevision": 1')), /Duplicate JSON/);
  assert.throws(() => serializeFieldLayoutTarget({ ...target, futureData: true } as typeof target));
});
