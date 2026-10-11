import assert from "node:assert/strict";
import test from "node:test";
import {
  feetToMeters, createDesignDraftEditorState, defaultProjectSettings, reduceDesignDraftEditorState, type DesignDraftMachine,
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
    endGunAngleRanges: [], spanLengthsMeters: [null, feetToMeters(30), null], sweep: { mode: "partial_circle", stopAngleDegrees: 90 },
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
  assert.deepEqual(editor.draft.machine, { spanLengthsMeters: [null, feetToMeters(30), null], sweep: { mode: "partial_circle" } });
  values.overhangMeters = "-1";
  const rejected = reduceDesignDraftEditorState(editor, { type: "set_machine", machine: parseDraftMachine(values, editor.draft.machine) });
  assert.ok(rejected.lastError);
  assert.strictEqual(rejected.draft, editor.draft);
  assert.equal(values.overhangMeters, "-1");
});

 test("draft feet editing preserves untouched exact machine dimensions", () => {
  const original: DesignDraftMachine = { overhangMeters: 3.123456789, spanLengthsMeters: [41.123456789, null, 52.987654321] };
  const input = machineInputValues(original);
  assert.deepEqual(parseDraftMachine(input, original), original);
  input.spans![1] = "150' 6\"";
  const edited = parseDraftMachine(input, original);
  assert.equal(edited.overhangMeters, original.overhangMeters);
  assert.equal(edited.spanLengthsMeters![0], original.spanLengthsMeters![0]);
  assert.equal(edited.spanLengthsMeters![2], original.spanLengthsMeters![2]);
  assert.equal(edited.spanLengthsMeters![1], feetToMeters(150.5));
});

test("draft append and remove-last preserve exact original slots even when feet displays match", () => {
  for (const spans of [[41.123456789, 52.987654321], [41.123456789, 41.123456790], [null, 41.123456789, 52.987654321]]) {
    const original: DesignDraftMachine = { spanLengthsMeters: spans, overhangMeters: 3.123456789 };
    const before = JSON.stringify(original);
    const input = machineInputValues(original);
    if (spans[1] === 41.123456790) {
      assert.equal(input.spans![0], input.spans![1], "distinct exact spans must exercise identical rounded feet text");
      assert.notEqual(spans[0], spans[1]);
    }
    input.spans = [...input.spans!, "100"];
    assert.deepEqual(parseDraftMachine(input, original), { ...original, spanLengthsMeters: [...spans, feetToMeters(100)] });
    input.spans = input.spans.slice(0, -1);
    assert.deepEqual(parseDraftMachine(input, original), original, "removing an appended row must leave every original exact value");
    input.spans = input.spans.slice(0, -1);
    assert.deepEqual(parseDraftMachine(input, original), { ...original, spanLengthsMeters: spans.slice(0, -1) });
    assert.equal(JSON.stringify(original), before);
  }
});

test("draft remove-last allows empty span lists without adding complete-machine defaults", () => {
  const original: DesignDraftMachine = {};
  const input = machineInputValues(original);
  input.spans = [""];
  assert.deepEqual(parseDraftMachine(input, original), { spanLengthsMeters: [null] });
  input.spans = input.spans.slice(0, -1);
  const machine = parseDraftMachine(input, original);
  assert.deepEqual(machine, { spanLengthsMeters: [] });
  const settings = defaultProjectSettings();
  const editor = createDesignDraftEditorState({ id: "empty-span-draft", name: "Empty spans", projectCrs: null,
    settings, unitSystem: settings.unitSystem, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null,
    machine: original, obstacles: [], surveyPoints: [] });
  const applied = reduceDesignDraftEditorState(editor, { type: "set_machine", machine });
  assert.equal(applied.lastError, null);
  assert.deepEqual(applied.draft.machine, { spanLengthsMeters: [] });
});
