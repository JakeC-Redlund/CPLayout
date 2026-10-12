import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import { InputRetentionProvider, InputRetentionStore } from "../inputRetention";
import { convertPivotProjectToFieldDesign } from "../../../../packages/core/src/fieldDesignDocument";
import { createFieldDesignEditorState, reduceFieldDesignEditorState, type FieldDesignEditorState } from "../../../../packages/core/src/fieldDesignEditor";
import { sampleProject } from "../../../../packages/core/src/sampleProject";
import type { StraightLateralMachine } from "../../../../packages/core/src/straightLateral";
import type { WorkspaceLateralInputsProps } from "./WorkspaceLateralInputs";
const controls = new Map<string, Record<string, unknown>>();
const host = (tag: string) => (props: Record<string, unknown>) => { if (typeof props.testID === "string") controls.set(props.testID, props); return React.createElement(tag, { "data-testid": props.testID }, tag === "input" ? undefined : props.children as React.ReactNode); };
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }, original = loader._load;
const requireWorkspace = createRequire(resolve(process.cwd(), "package.json"));
const { renderToStaticMarkup } = requireWorkspace("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
let panel: typeof import("./WorkspaceLateralInputs");
try { loader._load = function(request, parent, isMain) { if (request === "react-native") return { View: host("div"), Text: host("span"), TextInput: host("input"), Pressable: host("button"), StyleSheet: { create: (styles: unknown) => styles } }; return original.call(this, request, parent, isMain); }; panel = requireWorkspace(resolve(__dirname, "WorkspaceLateralInputs.tsx")); }
finally { loader._load = original; }
function field() { return convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "synthetic-field", waterSourceId: "water", powerSourceId: "power" }).field; }
const existing: StraightLateralMachine = { id: "synthetic-linear", kind: "straight_lateral", name: "Known machine", leftExtentMeters: 51.123456789123, rightExtentMeters: 25.000000001,
  travelHeadingDegrees: 12.345678901, travel: { start: { x: 501234.123456789, y: 4500000.987654321 }, end: { x: 501900.111111111, y: 4500123.222222222 } }, machineClearanceBufferMeters: .123456789, sprinklerReachMeters: 15.123456789, waterSourceId: "water" };
test("new lateral has no invented geometry, and name-only editing retains exact undisplayed values", () => {
  const source = field(), blank = panel.lateralRawInputs(undefined, source);
  for (const value of Object.values(blank)) assert.equal(value, ""); assert.throws(() => panel.parseLateralRawInputs(blank, source, "new"), /name/);
  const raw = panel.lateralRawInputs(existing, source), changed = panel.parseLateralRawInputs({ ...raw, name: "Renamed exact" }, source, existing.id, existing);
  assert.deepEqual({ ...changed, name: existing.name }, existing);
  const unknown = { ...source, projectCrs: "LOCAL:unknown-units" }, unchanged = panel.lateralRawInputs(existing, unknown);
  assert.equal(unchanged.startX, ""); assert.deepEqual(panel.parseLateralRawInputs({ ...unchanged, name: "Unknown-unit rename" }, unknown, existing.id, existing).travel, existing.travel);
  assert.throws(() => panel.parseLateralRawInputs({ ...unchanged, startX: "100" }, unknown, existing.id, existing), /coordinate units/);
});
test("selected straight-path endpoints retain exact XY and refuse drift instead of silently rebuilding", () => {
  const source = field(), vertices = [existing.travel.start, existing.travel.end];
  source.mapFeatures = [{ id: "actual-line", name: "Actual saved line", kind: "linear_move_path", geometry: { type: "LineString", vertices }, confidence: "user_estimated" }];
  const raw = { ...panel.lateralRawInputs(existing, source), pathId: "actual-line", pathFingerprint: JSON.stringify(vertices), name: "From saved path" };
  const parsed = panel.parseLateralRawInputs(raw, source, "new"); assert.deepEqual(parsed.travel, existing.travel);
  source.mapFeatures[0].geometry = { type: "LineString", vertices: [vertices[0], { x: vertices[1].x + 1, y: vertices[1].y }] };
  assert.throws(() => panel.parseLateralRawInputs(raw, source, "new"), /selected saved path changed/);
});
function harness(initial: FieldDesignEditorState) {
  let editor = initial, calls = 0, pending = false; const store = new InputRetentionStore();
  const props = (): WorkspaceLateralInputsProps => ({ editor, createMachineId: () => "new-linear", onAction(action) { calls++; editor = reduceFieldDesignEditorState(editor, action); return !editor.lastError; }, onPendingChange(value) { pending = value; } });
  function render(extra: Partial<WorkspaceLateralInputsProps> = {}) { controls.clear(); return renderToStaticMarkup(React.createElement(InputRetentionProvider, { store, children: React.createElement(panel.WorkspaceLateralInputs, { ...props(), ...extra }) })); }
  function call(id: string, key: string, value?: unknown) { const handler = controls.get(id)?.[key]; assert.equal(typeof handler, "function", `${id}.${key}`); (handler as (value?: unknown) => void)(value); }
  return { render, call, store, get editor() { return editor; }, get calls() { return calls; }, get pending() { return pending; } };
}
test("actual handlers retain invalid raw entry, Discard retires callbacks, and blocked selection cannot discard edits", () => {
  const source = field(); source.lateralMachines = [existing]; const editor = createFieldDesignEditorState(source); editor.selectedMachineId = existing.id;
  const h = harness(editor); h.render(); h.call("lateral-input-startX", "onChangeText", "unfinished 12'"); assert(h.pending); h.render();
  const retired = controls.get("lateral-input-name")!.onChangeText as (value: string) => void;
  h.call("lateral-apply", "onPress"); assert.equal(h.calls, 0); assert(h.render().includes("lateral-input-error"));
  h.call(`lateral-select-${existing.id}`, "onPress"); assert.equal(h.calls, 0);
  h.call("lateral-discard", "onPress"); retired("stale revival"); h.render(); assert.equal(controls.get("lateral-input-name")!.value, existing.name); assert.equal(h.store.hasDirty(), false);
  const disabled = controls.get("lateral-input-name")!.onChangeText as (value: string) => void; h.render({ disabled: true }); h.call("lateral-input-name", "onChangeText", "blocked"); assert.equal(h.calls, 0);
  assert.deepEqual(h.editor.field.lateralMachines![0], existing); void disabled;
});
test("actual Apply and confirmation Remove dispatch explicit real lateral actions and preserve pivot data", () => {
  const source = field(); source.lateralMachines = [existing]; const editor = createFieldDesignEditorState(source); editor.selectedMachineId = existing.id;
  const h = harness(editor), pivot = structuredClone(source.machines[0]); h.render(); h.call("lateral-input-name", "onChangeText", "Changed name"); h.render(); h.call("lateral-apply", "onPress");
  assert.equal(h.editor.field.lateralMachines![0].name, "Changed name"); assert.deepEqual({ ...h.editor.field.lateralMachines![0], name: existing.name }, existing);
  h.render(); assert.equal(controls.get("lateral-remove")!.disabled, false); h.call("lateral-remove", "onPress"); h.render(); assert.equal(h.editor.field.lateralMachines!.length, 1); h.call("lateral-remove-confirm", "onPress");
  assert.equal(h.editor.field.lateralMachines!.length, 0); assert.deepEqual(h.editor.field.machines[0], pivot);
});
test("actual Add requires operator-entered endpoints and lengths before creating a lateral", () => {
  const h = harness(createFieldDesignEditorState(field())); h.render(); h.call("lateral-add", "onPress"); h.render();
  assert.equal(controls.get("lateral-input-startX")!.value, ""); h.call("lateral-apply", "onPress"); assert.equal(h.calls, 0); h.render();
  for (const [key, value] of Object.entries({ name: "Explicit linear", startX: "100", startY: "200", endX: "300", endY: "200", heading: "0", left: "100", right: "0", clearance: "0" })) { h.call(`lateral-input-${key}`, "onChangeText", value); h.render(); }
  h.call("lateral-apply", "onPress"); assert.equal(h.editor.field.lateralMachines!.length, 1); assert.equal(h.editor.field.lateralMachines![0].id, "new-linear"); assert.equal(h.editor.field.lateralMachines![0].name, "Explicit linear");
  assert.equal(h.editor.field.lateralMachines![0].sprinklerReachMeters, undefined); assert.equal(h.editor.field.lateralMachines![0].travelHeadingDegrees, 0);
});
test("Survey saved-path handlers preserve source identity and exact endpoints while refusing coordinate replacement", () => {
  const source = field(), vertices = [existing.travel.start, existing.travel.end];
  source.mapFeatures = [{ id: "supplied-travel-line", name: "Saved travel line", kind: "linear_move_path", geometry: { type: "LineString", vertices }, confidence: "user_estimated" }];
  const originalPath = structuredClone(source.mapFeatures[0]), h = harness(createFieldDesignEditorState(source));
  h.render({ savedPathOnly: true }); h.call("lateral-add", "onPress"); h.render({ savedPathOnly: true });
  assert.equal(controls.get("lateral-input-startX")!.editable, false); h.call("lateral-input-startX", "onChangeText", "invented coordinate");
  h.render({ savedPathOnly: true }); assert.equal(controls.get("lateral-input-startX")!.value, "");
  h.call("lateral-path-supplied-travel-line", "onPress"); h.render({ savedPathOnly: true });
  const originalText = controls.get("lateral-input-startX")!.value;
  h.call("lateral-input-startX", "onChangeText", "another coordinate"); h.render({ savedPathOnly: true });
  assert.equal(controls.get("lateral-input-startX")!.value, originalText);
  for (const [key, value] of Object.entries({ name: "Supplied Survey linear", left: "50", right: "75", clearance: "2" })) { h.call(`lateral-input-${key}`, "onChangeText", value); h.render({ savedPathOnly: true }); }
  h.call("lateral-apply", "onPress"); assert.equal(h.calls, 1);
  const saved = h.editor.field.lateralMachines![0]; assert.deepEqual(saved.travel, existing.travel); assert.equal(saved.waterSourceId, undefined); assert.equal(saved.powerSourceId, undefined);
  assert.deepEqual(h.editor.field.mapFeatures![0], originalPath); assert.equal(h.editor.field.mapFeatures![0].id, "supplied-travel-line");
  assert.deepEqual(h.editor.field.machines, source.machines);
});
