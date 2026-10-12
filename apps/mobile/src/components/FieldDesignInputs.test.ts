import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import { InputRetentionProvider, InputRetentionStore } from "../inputRetention";
import { convertPivotProjectToFieldDesign } from "../../../../packages/core/src/fieldDesignDocument";
import { createFieldDesignEditorState, reduceFieldDesignEditorState, type FieldDesignEditorState } from "../../../../packages/core/src/fieldDesignEditor";
import { advisoryCornerArmSampleProject, sampleProject } from "../../../../packages/core/src/sampleProject";
import { createFieldCalculationInput } from "../../../../packages/core/src/fieldCalculationInput";
import { evaluateLayout } from "../../../../packages/geometry/src/geometry";
import { fieldMachineInputs } from "./fieldMachineInputs";
import type { FieldDesignInputsProps } from "./FieldDesignInputs";

// Render the real controlled panel/hooks against inert host primitives. No browser/native runtime is asserted.
const controls = new Map<string, Record<string, unknown>>();
const host = (tag: string, input = false) => (props: Record<string, unknown>) => {
  if (typeof props.testID === "string") controls.set(props.testID, props);
  return React.createElement(tag, { "data-testid": props.testID, "aria-label": props.accessibilityLabel,
    ...(input ? { value: props.value, readOnly: true, disabled: props.editable === false } : {}) }, input ? undefined : props.children as React.ReactNode);
};
const svg = host("svg"), icon = () => null;
const native = { View: host("div"), Text: host("span"), TextInput: host("input", true), Pressable: host("button"), Switch: host("input", true),
  ScrollView: host("div"), KeyboardAvoidingView: host("div"), Modal: (props: Record<string, unknown>) => props.visible ? React.createElement("div", null, props.children as React.ReactNode) : null,
  Platform: { OS: "web" }, useWindowDimensions: () => ({ width: 800, height: 600 }), StyleSheet: { create: (value: unknown) => value } };
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown };
const originalLoad = loader._load;
const workspaceRequire = createRequire(resolve(process.cwd(), "package.json"));
const { renderToStaticMarkup } = workspaceRequire("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
const nowForFixture = "2026-10-10T12:00:00.000Z";
let panel: typeof import("./FieldDesignInputs");
try {
  loader._load = function(request, parent, isMain) {
    if (request === "react-native") return native;
    if (request === "react-native-svg") return { __esModule: true, default: svg, Svg: svg, Circle: host("circle"), Polygon: host("polygon"), Text: host("text") };
    if (request === "lucide-react-native") return new Proxy({ __esModule: true }, { get: (target, key) => key === "__esModule" ? true : icon });
    return originalLoad.call(this, request, parent, isMain);
  };
  panel = workspaceRequire(resolve(__dirname, "FieldDesignInputs.tsx"));
} finally { loader._load = originalLoad; }

function fixture(): FieldDesignEditorState {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "field", waterSourceId: "water", powerSourceId: "power" }).field;
  field.machines[0].pivotCenter = { x: 501234.123456789, y: 4500000.987654321 };
  field.machines[0].configuration.spanLengthsMeters = [51.123456789123, 40.000000001];
  const state = createFieldDesignEditorState(field); return { ...state, selectedMachineId: field.machines[0].id };
}
function retainedPanel() {
  const refs: Array<{ current: unknown }> = []; let cursor = 0;
  const retainedReact = { ...React, useRef(value: unknown) { return refs[cursor++] ?? (refs[cursor - 1] = { current: value }); }, useLayoutEffect(effect: () => unknown) { effect(); } };
  const path = resolve(__dirname, "FieldDesignInputs.tsx"); delete workspaceRequire.cache[path];
  let loaded: typeof panel;
  try { loader._load = function(request, parent, isMain) {
    if (request === "react") return retainedReact;
    if (request === "react-native") return native;
    if (request === "react-native-svg") return { __esModule: true, default: svg, Svg: svg, Circle: host("circle"), Polygon: host("polygon"), Text: host("text") };
    if (request === "lucide-react-native") return new Proxy({ __esModule: true }, { get: (_target, key) => key === "__esModule" ? true : icon });
    return originalLoad.call(this, request, parent, isMain);
  }; loaded = workspaceRequire(path); } finally { loader._load = originalLoad; }
  return { module: loaded, beginRender() { cursor = 0; } };
}
function harness(initial = fixture(), retained?: ReturnType<typeof retainedPanel>) {
  let editor = initial, calls = 0, pending = false;
  const store = new InputRetentionStore();
  const props = (): FieldDesignInputsProps => ({ editor, createMachineId: () => `new-${editor.field.machines.length}`,
    onAction(action) { calls++; const next = reduceFieldDesignEditorState(editor, action); editor = next; return next.lastError === null; },
    onPendingChange(value) { pending = value; }, onRawInputChange() { pending = true; },
    onRenameField: () => false, advisoryPanels: { layoutSearch: React.createElement("span", null, "Retained layout search"), lateralReview: React.createElement("span", null, "Retained lateral review"), machineClearance: React.createElement("span", null, "Retained machine clearance") } });
  const render = (extra: Partial<FieldDesignInputsProps> = {}) => { retained?.beginRender(); controls.clear(); return renderToStaticMarkup(React.createElement(InputRetentionProvider, { store, children: React.createElement((retained?.module ?? panel).FieldDesignInputs, { ...props(), ...extra }) })); };
  const call = (id: string, key: string, value?: unknown) => {
    const handler = controls.get(id)?.[key]; assert.equal(typeof handler, "function", `${id}.${key} exists`);
    (handler as (input?: unknown) => void)(value);
  };
  return { render, call, store, get editor() { return editor; }, get calls() { return calls; }, get pending() { return pending; } };
}

test("real panel/hook remounts retain malformed spans, raw names, errors and synchronous dirty reporting", () => {
  const h = harness(); h.render();
  h.call("field-input-span-0", "onChangeText", "malformed 12' unfinished"); assert(h.store.hasDirty()); assert(h.pending);
  h.render(); h.call("field-input-name", "onChangeText", "Raw name  ");
  h.render(); h.call("field-apply-machine", "onPress"); assert.equal(h.calls, 0);
  const html = h.render(); assert(html.includes("malformed 12&#x27; unfinished")); assert(html.includes("Raw name  ")); assert(html.includes("field-input-error"));
  assert.equal(h.editor.revision, 0); assert.deepEqual(h.editor.field.machines[0].configuration.spanLengthsMeters, [51.123456789123, 40.000000001]);
  h.call("field-name-input", "onChangeText", "Field draft name");
  assert(h.render().includes("Field draft name"));
});

test("scoped Discard retires old machine/name callbacks while preserving unrelated unfinished entries", () => {
  const h = harness(); h.render();
  const staleSpan = controls.get("field-input-span-0")!.onChangeText as (value: string) => void;
  h.call("field-input-span-0", "onChangeText", "broken"); h.render();
  h.call("field-name-input", "onChangeText", "Keep this field name"); h.render();
  h.call("field-discard-inputs", "onPress"); staleSpan("resurrected");
  let html = h.render(); assert.equal(html.includes("resurrected"), false); assert(html.includes("Keep this field name"));
  const staleName = controls.get("field-name-input")!.onChangeText as (value: string) => void;
  h.call("field-name-discard", "onPress"); staleName("revived field name");
  html = h.render(); assert.equal(html.includes("revived field name"), false); assert.equal(h.store.hasDirty(), false);
});

test("name-only machine edits retain exact unchanged coordinates and undisplayed configuration; unknown units never become zero", () => {
  const state = fixture();
  state.field.machines[0].configuration.cornerArm = structuredClone(advisoryCornerArmSampleProject.machine.cornerArm);
  state.field.machines[0].configuration.catalogSelection = { catalogId: "synthetic-catalog", manufacturer: "Fixture", model: "Retained model", sourceUrl: "https://example.test/catalog", sourceAccessedAt: nowForFixture, advisoryOnly: true };
  const before = structuredClone(state.field.machines[0]);
  const action = panel.fieldMachineInputAction(state, { ...fieldMachineInputs(before, state.field), name: "Renamed exact" });
  assert.equal(action.type, "update_machine");
  if (action.type !== "update_machine") throw new Error("Expected machine action.");
  assert.deepEqual(action.machine.pivotCenter, before.pivotCenter);
  assert.deepEqual({ ...action.machine.configuration, name: before.configuration.name }, before.configuration);
  assert.equal(action.machine.configuration.cornerArm?.notes, before.configuration.cornerArm?.notes);
  const local = { ...state, field: { ...state.field, projectCrs: "LOCAL:unknown-units" } };
  const values = fieldMachineInputs(before, local.field), unchanged = panel.fieldMachineInputAction(local, { ...values, name: "Local rename" });
  assert.equal(values.x, ""); assert.equal(values.y, "");
  if (unchanged.type !== "update_machine") throw new Error("Expected machine action.");
  assert.deepEqual(unchanged.machine.pivotCenter, before.pivotCenter);
  assert.throws(() => panel.fieldMachineInputAction(local, { ...values, x: "100" }), /Confirm the location units/);
});


test("add/select/exact copy/removal use only the supplied reducer and keep sibling/history values", () => {
  const h = harness(), original = structuredClone(h.editor.field.machines[0]); h.render();
  assert.equal((controls.get(`field-machine-${original.id}`)!.accessibilityState as { selected: boolean }).selected, true);
  h.call("field-copy-machine", "onPress"); h.render();
  assert.equal(h.editor.field.machines.length, 2, h.editor.lastError ?? `Reducer calls: ${h.calls}`); assert.equal(h.editor.selectedMachineId, "new-1");
  assert.deepEqual({ ...h.editor.field.machines[1], id: original.id }, original);
  h.call(`field-machine-${original.id}`, "onPress"); h.render(); assert.equal(h.editor.selectedMachineId, original.id);
  h.call("field-remove-new-1", "onPress"); h.render(); h.call("field-remove-confirm-confirm", "onPress"); h.render();
  assert.deepEqual(h.editor.field.machines, [original]); assert(h.editor.past.length > 0);
  h.call("field-add-machine", "onPress"); h.render(); assert(controls.has("field-machine-form")); assert(h.store.hasDirty());
  h.call("field-discard-inputs", "onPress"); assert.equal(h.editor.field.machines.length, 1);
});

test("rejected actions and field rename keep raw values/error instead of pretending accepted persistence", () => {
  const h = harness(); h.render(); h.call("field-input-name", "onChangeText", "Rejected machine name");
  h.render({ onAction: () => false }); h.call("field-apply-machine", "onPress");
  let html = h.render(); assert(html.includes("Rejected machine name")); assert(html.includes("not accepted")); assert.equal(h.editor.revision, 0);
  h.call("field-name-input", "onChangeText", "Rejected field name"); h.render(); h.call("field-rename", "onPress");
  html = h.render(); assert(html.includes("Rejected field name")); assert(html.includes("field-name-error")); assert(h.store.hasDirty());
});

test("controlled choices retain partial sweep/direction, explicit Unassigned associations and supplied advisory slots", () => {
  const h = harness(); let html = h.render();
  assert(html.includes("Retained layout search") && html.includes("Retained lateral review") && html.includes("Retained machine clearance"));
  assert(html.includes("Unassigned"));
  h.call("field-sweep-1", "onPress"); html = h.render(); assert(html.includes("Start angle (degrees)")); assert(html.includes("Counterclockwise"));
  h.call("field-input-start", "onChangeText", "unclosed angle"); assert(h.render().includes("unclosed angle"));
  h.call("field-discard-inputs", "onPress");
  h.render(); const oldCopy = controls.get("field-copy-machine")!.onPress as () => void;
  h.call("field-input-span-0", "onChangeText", "not a length"); oldCopy(); assert.equal(h.editor.field.machines.length, 1);
});

test("infrastructure choices show business labels and declared-unit coordinates without exposing storage IDs", () => {
  const h = harness(), field = h.editor.field, source = field.infrastructure[0];
  const label = panel.fieldInfrastructureLabel(field, source, 1);
  assert(label.includes(source.kind === "water_source" ? "Water source 1" : "Power source 1"));
  assert(label.includes("(X ") && label.includes(" ft)")); assert(!label.includes(source.id));
  assert.equal(panel.fieldInfrastructureLabel({ ...field, projectCrs: "LOCAL:unknown-units" }, source, 1), source.kind === "water_source" ? "Water source 1" : "Power source 1");
});

test("actual Field radio choices expose explicit checked DOM props through choice changes and disabled handlers", () => {
  const h = harness(); h.render();
  assert.equal(controls.get("field-sweep-0")!["aria-checked"], true); assert.equal(controls.get("field-sweep-1")!["aria-checked"], false);
  h.call("field-sweep-1", "onPress"); h.render();
  assert.equal(controls.get("field-sweep-0")!["aria-checked"], false); assert.equal(controls.get("field-sweep-1")!["aria-checked"], true);
  assert.equal(controls.get("field-direction-0")!["aria-checked"], true); h.call("field-direction-1", "onPress"); h.render();
  assert.equal(controls.get("field-direction-0")!["aria-checked"], false); assert.equal(controls.get("field-direction-1")!["aria-checked"], true);
  h.render({ disabled: true }); assert.equal(controls.get("field-sweep-0")!["aria-disabled"], true); h.call("field-sweep-0", "onPress");
  h.render(); assert.equal(controls.get("field-sweep-1")!["aria-checked"], true); assert.equal(h.editor.revision, 0);
});

test("actual supplied calculation preview shows only its current revision and selected machine", () => {
  const h = harness(), state = h.editor;
  const admitted = createFieldCalculationInput(state.field, { machineId: state.selectedMachineId!, inputRevision: state.revision, expectedRevision: state.revision });
  if (admitted.status !== "ready") throw new Error("Expected calculation-ready synthetic field.");
  const preview = { machineId: state.selectedMachineId!, revision: state.revision, result: evaluateLayout(admitted.project, admitted.crsOptions) };
  assert(h.render({ calculationPreview: preview }).includes("field-calculation-result"));
  assert.equal(h.render({ calculationPreview: { ...preview, revision: state.revision + 1 } }).includes("field-calculation-result"), false);
  assert.equal(h.render({ calculationPreview: { ...preview, machineId: "other" } }).includes("field-calculation-result"), false);
});

test("Current/Proposed review retains explicit replacement permission and adopts through the real revision-checked reducer", () => {
  const h = harness(), proposed = structuredClone(h.editor.field);
  proposed.machines[0].pivotCenter.x += 1;
  const comparison = { id: "review", field: proposed, revision: h.editor.revision, sourceName: "Imported fixture plan" };
  let accepted = 0;
  const props = { comparison, onComparisonAccepted: () => accepted++ };
  const original = structuredClone(h.editor.field);
  const html = h.render(props); assert(html.includes("Current") && html.includes("Proposed"));
  h.call("field-adopt-plan", "onPress"); assert.equal(accepted, 0); assert.deepEqual(h.editor.field, original);
  h.render(props); h.call(`field-unlock-${original.machines[0].id}`, "onValueChange", true);
  h.render(props); h.call("field-adopt-plan", "onPress");
  assert.equal(accepted, 1); assert.deepEqual(h.editor.field.machines, proposed.machines);
  assert.deepEqual(h.editor.past[0], original);
});

test("explicit document reset rejects stale setters/actions without clearing retained work merely on remount", () => {
  const h = harness(); h.render();
  const oldChange = controls.get("field-input-name")!.onChangeText as (value: string) => void;
  const oldCopy = controls.get("field-copy-machine")!.onPress as () => void;
  h.call("field-input-name", "onChangeText", "Unfinished"); assert(h.render().includes("Unfinished"));
  h.store.reset(); oldChange("revived"); oldCopy();
  assert.equal(h.calls, 0); assert.equal(h.render().includes("revived"), false); assert.equal(h.store.hasDirty(), false);
});
test("Machines/Review presentation preserves malformed input/errors and renders every actual advisory slot exactly once", () => {
  const h = harness(), surfaces: string[] = [];
  const renderSurface: import("./FieldDesignInputs").FieldDesignInputsPresentation["renderSurface"] = (surface, content) => {
    surfaces.push(surface); return React.createElement("section", { key: surface, "data-surface": surface }, content);
  };
  h.render({ presentation: { sourceGeneration: 0, activeSurface: "machines", renderSurface } }); assert.deepEqual(surfaces, ["machines", "review"]);
  h.call("field-input-span-0", "onChangeText", "malformed 12' pending"); h.render({ presentation: { sourceGeneration: 0, activeSurface: "machines", renderSurface } }); h.call("field-apply-machine", "onPress");
  surfaces.length = 0; const review = h.render({ presentation: { sourceGeneration: 0, activeSurface: "review", renderSurface } }); assert.deepEqual(surfaces, ["machines", "review"]);
  assert.equal(controls.get("field-input-span-0")!.editable, false); assert(review.includes("field-input-error"));
  for (const text of ["Retained layout search", "Retained lateral review", "Retained machine clearance"]) assert.equal(review.split(text).length - 1, 1);
  h.call("field-input-span-0", "onChangeText", "silent replacement");
  h.render({ presentation: { sourceGeneration: 0, activeSurface: "machines", renderSurface } }); assert.equal(controls.get("field-input-span-0")!.value, "malformed 12' pending");
  assert.equal(controls.get("field-input-span-0")!.editable, true); assert(h.store.hasDirty()); assert.equal(h.calls, 0);
});
test("Machines raw/apply callbacks captured before a surface round trip cannot revive without a geometry revision change", () => {
  const h = harness(fixture(), retainedPanel()), renderSurface = (_surface: string, content: React.ReactNode) => content;
  const render = (surface: "machines" | "review") => h.render({ presentation: { sourceGeneration: 0, activeSurface: surface, renderSurface } });
  render("machines"); h.call("field-input-name", "onChangeText", "Earlier pending name"); render("machines");
  const oldRaw = controls.get("field-input-name")!.onChangeText as (value: string) => void, oldApply = controls.get("field-apply-machine")!.onPress as () => void;
  const original = structuredClone(h.editor.field); render("review"); render("machines");
  h.call("field-input-name", "onChangeText", "Current pending name"); oldRaw("Retired overwrite"); oldApply();
  assert.equal(h.calls, 0); assert.equal(h.editor.revision, 0); assert.deepEqual(h.editor.field, original); render("machines");
  assert.equal(controls.get("field-input-name")!.value, "Current pending name");
  const currentApply = controls.get("field-apply-machine")!.onPress as () => void; render("machines"); currentApply();
  assert.equal(h.calls, 1); assert.equal(h.editor.field.machines[0].configuration.name, "Current pending name");
});
