import assert from "node:assert/strict";
import test from "node:test";
import {
  createDesignDraftEditorState, defaultProjectSettings, reduceDesignDraftEditorState, type DesignDraftMachine,
} from "@cplayout/core";
import { machineInputValues, parseDraftBoundary, parseDraftMachine, parseDraftNumber, parseDraftPoint } from "./designDraftInputValues";

test("blank numbers and points never silently become zero", () => {
  assert.equal(parseDraftNumber("  ", "Length"), undefined);
  assert.equal(parseDraftPoint("", " "), null);
  assert.deepEqual(parseDraftPoint("0", "-2.5e2"), { x: 0, y: -250 });
  for (const value of ["NaN", "Infinity", "1e999", "12 meters", "0x12", "1,200", "-", "."]) {
    assert.throws(() => parseDraftNumber(value, "Length"), /finite decimal number/);
  }
  assert.throws(() => parseDraftPoint("1", ""), /both X and Y/);
  assert.throws(() => parseDraftPoint("", "2"), /both X and Y/);
});

test("boundary CSV preserves zero, one and two vertices and rejects incomplete rows", () => {
  assert.deepEqual(parseDraftBoundary(" \n"), []);
  assert.deepEqual(parseDraftBoundary("0,0"), [{ x: 0, y: 0 }]);
  assert.deepEqual(parseDraftBoundary("1,2\r\n\n3,4\n"), [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  for (const text of [",", "1,", ",2", "1,2,3", "1 2", "1,2\nNaN,4"]) {
    assert.throws(() => parseDraftBoundary(text), /Boundary row/);
  }
});

test("partial machines round-trip missing fields, null slots and optional data without defaults", () => {
  const machines: DesignDraftMachine[] = [
    {}, { spanLengthsMeters: [] }, { spanLengthsMeters: [null] },
    { spanLengthsMeters: [null, 30, null], sweep: { mode: "partial_circle" } },
    { sweep: { mode: "partial_circle", startAngleDegrees: 0 } },
    { sweep: { mode: "partial_circle", direction: "counterclockwise" }, endGunAngleRanges: [] },
    { id: " machine ", name: "Name", overhangMeters: 0, endGunThrowMeters: 2, towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 1, sweep: { mode: "full_circle" } },
  ];
  for (const machine of machines) {
    const before = JSON.stringify(machine);
    assert.deepEqual(parseDraftMachine(machineInputValues(machine), machine), machine);
    assert.equal(JSON.stringify(machine), before);
  }
});

test("clearing fields omits values and retains blank span slots in order", () => {
  const original: DesignDraftMachine = { id: "old", overhangMeters: 2, endGunAngleRanges: [] };
  const values = machineInputValues(original);
  values.id = "";
  values.overhangMeters = "";
  values.spans = ["", "30", ""];
  values.mode = "partial_circle";
  values.stopAngleDegrees = "90";
  assert.deepEqual(parseDraftMachine(values, original), {
    endGunAngleRanges: [], spanLengthsMeters: [null, 30, null], sweep: { mode: "partial_circle", stopAngleDegrees: 90 },
  });
  values.spans[1] = "bad";
  assert.throws(() => parseDraftMachine(values, original), /Span 2/);
  assert.deepEqual(values.spans, ["", "bad", ""]);
});

test("section payloads remain incomplete through the actual reducer and domain errors remain rejected", () => {
  const settings = defaultProjectSettings();
  let editor = createDesignDraftEditorState({ id: "draft", name: "Draft", projectCrs: "LOCAL:field", settings, unitSystem: settings.unitSystem,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] });
  editor = reduceDesignDraftEditorState(editor, { type: "replace_boundary", vertices: parseDraftBoundary("1,2\n3,4") });
  assert.equal(editor.lastError, null);
  const values = machineInputValues({});
  values.spans = ["", "30", ""];
  values.mode = "partial_circle";
  editor = reduceDesignDraftEditorState(editor, { type: "set_machine", machine: parseDraftMachine(values, editor.draft.machine) });
  assert.equal(editor.lastError, null);
  assert.deepEqual(editor.draft.machine, { spanLengthsMeters: [null, 30, null], sweep: { mode: "partial_circle" } });
  values.overhangMeters = "-1";
  const rejected = reduceDesignDraftEditorState(editor, { type: "set_machine", machine: parseDraftMachine(values, editor.draft.machine) });
  assert.ok(rejected.lastError);
  assert.strictEqual(rejected.draft, editor.draft);
  assert.equal(values.overhangMeters, "-1");
});
