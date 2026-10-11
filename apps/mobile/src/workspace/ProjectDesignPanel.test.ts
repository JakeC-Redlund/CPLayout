import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import { createProjectEditorState, reduceProjectEditorState } from "../../../../packages/core/src/projectReducer";
import { defaultAppSettings } from "../../../../packages/core/src/settings";
import { sampleProject } from "../../../../packages/core/src/sampleProject";
import { evaluateLayout } from "../../../../packages/geometry/src/geometry";
import { InputRetentionProvider, InputRetentionStore, createInputRetentionBaseline, useRetainedInput } from "../inputRetention";
import { EMPTY_ADVISORY_COST_DRAFT, updateMachinePrice } from "../advisory/costInputs";
import type { ProjectDesignPanelProps } from "./ProjectDesignPanel";

// Exercise this panel's controlled wiring/hooks. Existing Project helpers are inert
// boundaries here; these tests make no claims about their own rendering or runtime.
const controls = new Map<string, Record<string, unknown>>();
const tools = new Map<string, Record<string, unknown>[]>();
const host = (tag: string) => (props: Record<string, unknown>) => {
  if (typeof props.testID === "string") controls.set(props.testID, props);
  return React.createElement(tag, { "data-testid": props.testID }, props.children as React.ReactNode);
};
const toolNames = ["PivotGpsCoordinateForm", "PivotCoordinateForm", "ProjectedPolygonEditor", "MachineSettingsForm", "EndGunSettingsForm", "CornerArmSheet", "ManualDesignTransactionPanel", "CalculateSheet", "AdvisoryCostReviewPanel", "FieldPivotPreviewControls", "MapFeatureEditor"];
const helperBoundary = Object.fromEntries(toolNames.map(name => [name, (props: Record<string, unknown>) => {
  tools.set(name, [...(tools.get(name) ?? []), props]); return React.createElement("div", { "data-helper": name });
}]));
const requireCurrent = createRequire(resolve(process.cwd(), "package.json"));
const { renderToStaticMarkup } = requireCurrent("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }, original = loader._load;
let panel: typeof import("./ProjectDesignPanel");
try { loader._load = function(request, parent, isMain) {
  if (request === "react-native") return { View: host("div"), Text: host("span"), Pressable: host("button"), StyleSheet: { create: (value: unknown) => value } };
  if (request === "./ProjectWorkspaceTools") return helperBoundary;
  return original.call(this, request, parent, isMain);
}; panel = requireCurrent(resolve(__dirname, "ProjectDesignPanel.tsx")); } finally { loader._load = original; }
const one = (name: string) => { const values = tools.get(name); assert.equal(values?.length, 1, `${name} mounted once`); return values![0]; };
function retainedPanel(probe?: React.ReactNode) {
  const refs: Array<{ current: unknown }> = []; let cursor = 0;
  const retainedReact = { ...React, useRef(value: unknown) { return refs[cursor++] ?? (refs[cursor - 1] = { current: value }); } };
  const path = resolve(__dirname, "ProjectDesignPanel.tsx"); delete requireCurrent.cache[path];
  let loaded: typeof panel;
  try { loader._load = function(request, parent, isMain) {
    if (request === "react") return retainedReact;
    if (request === "react-native") return { View: host("div"), Text: host("span"), Pressable: host("button"), StyleSheet: { create: (value: unknown) => value } };
    if (request === "./ProjectWorkspaceTools") return probe ? { ...helperBoundary, MachineSettingsForm: () => probe } : helperBoundary;
    return original.call(this, request, parent, isMain);
  }; loaded = requireCurrent(path); } finally { loader._load = original; }
  return { module: loaded, beginRender() { cursor = 0; } };
}
function harness(project = sampleProject, retained?: ReturnType<typeof retainedPanel>) {
  let editor = createProjectEditorState(project), calls = 0, calculations = 0;
  const store = new InputRetentionStore();
  const props = (): ProjectDesignPanelProps => ({ editor, settings: defaultAppSettings(), result: null, cornerEvaluation: null,
    onAction(action) { calls++; editor = reduceProjectEditorState(editor, action); return editor.lastError === null; },
    onCalculate() { calculations++; }, onSettingsChange() {}, onActivateTool() {}, onOpenSurvey() {}, mapCapture: null,
    onRequestMapCapture() {}, onRequestApplyPivotCandidate() {}, onSaveGeneratedFieldPivotZones() {} });
  const render = (extra: Partial<ProjectDesignPanelProps> = {}) => { retained?.beginRender(); tools.clear(); controls.clear(); return renderToStaticMarkup(React.createElement(InputRetentionProvider, {
    store, children: React.createElement((retained?.module ?? panel).ProjectDesignPanel, { ...props(), ...extra }),
  })); };
  return { render, store, get editor() { return editor; }, get calls() { return calls; }, get calculations() { return calculations; } };
}
test("all actual Project configuration sections stay mounted with nullable uncalculated metrics", () => {
  const h = harness(), before = structuredClone(h.editor.project); h.render();
  assert.equal(one("MachineSettingsForm").machine, h.editor.project.machine);
  assert.equal(one("EndGunSettingsForm").result, null); assert.equal(one("CornerArmSheet").result, null);
  assert.equal(one("CornerArmSheet").evaluation, null); assert.equal(one("ManualDesignTransactionPanel").project, h.editor.project);
  assert.equal(tools.has("CalculateSheet"), false);
  for (const section of ["coordinates", "machine", "endGun", "cornerArm", "manual", "features", "calculate"]) assert(controls.has(`project-design-${section}`));
  (controls.get("project-design-tab-coordinates")!.onPress as () => void)(); h.render();
  assert.equal(one("MachineSettingsForm").machine, h.editor.project.machine); assert.equal(tools.has("CalculateSheet"), false);
  assert.deepEqual(h.editor.project, before); assert.equal(h.calls, 0); assert.equal(h.store.hasDirty(), false);
});
test("water, boundary and same-named obstacle controls dispatch actual source-bound actions without aliasing", () => {
  const project = structuredClone(sampleProject); project.obstacles.forEach(obstacle => { obstacle.name = "Same visible name"; });
  const h = harness(project); h.render();
  const polygons = tools.get("ProjectedPolygonEditor")!;
  assert.equal(new Set(polygons.map(item => item.retentionKey)).size, project.obstacles.length + 1);
  assert(polygons.some(item => String(item.retentionKey).endsWith(`/obstacle/${project.obstacles[0].id}`)));
  const exact = { x: 501025.123456789, y: 4506235.987654321 };
  (tools.get("PivotCoordinateForm")![0].onApply as (point: typeof exact) => void)(exact);
  assert.deepEqual(h.editor.project.waterSource, exact); assert.equal(h.calls, 1);
  h.render(); const vertices = project.obstacles[0].polygon.map(point => ({ ...point, x: point.x + 0.123456789 }));
  (tools.get("ProjectedPolygonEditor")![1].onApply as (points: typeof vertices) => void)(vertices);
  assert.deepEqual(h.editor.project.obstacles[0].polygon, vertices); assert.deepEqual(h.editor.project.obstacles[1].polygon, project.obstacles[1].polygon);
});
test("malformed advisory input survives remount; Calculate accepts only preview keys and retains machine dirty input", () => {
  const h = harness(), scope = `project-tools/${encodeURIComponent(h.editor.project.id)}`; h.render();
  const invalid = { ...EMPTY_ADVISORY_COST_DRAFT, machinePrice: "unfinished 1,2x", includes: "Exact raw inclusion  " };
  (one("AdvisoryCostReviewPanel").onChange as (draft: typeof invalid) => void)(invalid);
  (one("FieldPivotPreviewControls").onChange as (count: number) => void)(3);
  assert(h.store.hasDirty()); h.render(); assert.deepEqual(one("AdvisoryCostReviewPanel").draft, invalid); assert.equal(one("FieldPivotPreviewControls").count, 3);
  const machineKey = "real-machine-form/input", baseline = createInputRetentionBaseline("old"); h.store.set(machineKey, baseline, "invalid raw span");
  (controls.get("project-calculate")!.onPress as () => void)(); assert.equal(h.calculations, 1); assert(h.store.hasDirty());
  h.store.markClean(machineKey); assert.equal(h.store.hasDirty(), false);
  const calculated = evaluateLayout(h.editor.project); h.render({ result: calculated });
  assert.deepEqual(one("CalculateSheet").advisoryCostDraft, invalid); assert.equal(one("CalculateSheet").advisoryCostInput, undefined);
  assert.equal(one("CalculateSheet").result, calculated); assert.equal(one("CalculateSheet").project, h.editor.project);
  assert.equal(h.store.read(`${scope}/pivotCount`, createInputRetentionBaseline(1)), 3);
});
test("actual accepted cost evidence reaches CalculateSheet and disabled calls admit no domain changes", () => {
  const h = harness(); h.render();
  const priced = updateMachinePrice({ ...EMPTY_ADVISORY_COST_DRAFT, includes: "Actual priced equipment" }, "175000.25", h.editor.project.machine);
  (one("AdvisoryCostReviewPanel").onChange as (value: typeof priced) => void)(priced);
  const actualResult = evaluateLayout(h.editor.project); h.render({ result: actualResult, disabled: true });
  assert.equal((one("CalculateSheet").advisoryCostInput as { pricing: { amount: number } }).pricing.amount, 175000.25);
  (one("MachineSettingsForm").onChange as (machine: typeof sampleProject.machine) => void)({ ...h.editor.project.machine, name: "Rejected change" });
  (controls.get("project-calculate")!.onPress as () => void)(); assert.equal(h.calls, 0); assert.equal(h.calculations, 0); assert(h.store.hasDirty());
});
test("ordinary presentation callbacks retain one input/review owner and all real helpers across surface changes", () => {
  const h = harness(), surfaces: string[] = [];
  const renderSurface: import("./ProjectDesignPanel").ProjectDesignPanelPresentation["renderSurface"] = (surface, content) => {
    surfaces.push(surface); return React.createElement("section", { key: surface, "data-surface": surface }, content);
  };
  h.render({ presentation: { sourceGeneration: 0, activeSurface: "review", renderSurface } }); assert.deepEqual(surfaces, ["inputs", "review"]);
  assert.equal(controls.has("project-design-tab-calculate"), false);
  for (const tab of ["coordinates", "machine", "endGun", "cornerArm", "manual", "features"]) assert(controls.has(`project-design-tab-${tab}`));
  assert.equal(one("MachineSettingsForm").machine, h.editor.project.machine); assert.equal(one("EndGunSettingsForm").result, null);
  const raw = { ...EMPTY_ADVISORY_COST_DRAFT, machinePrice: "unfinished 12x", includes: "Exact raw inclusion  " };
  (one("AdvisoryCostReviewPanel").onChange as (draft: typeof raw) => void)(raw);
  (one("MachineSettingsForm").onChange as (machine: typeof sampleProject.machine) => void)({ ...h.editor.project.machine, name: "Hidden mutation" }); assert.equal(h.calls, 0);
  surfaces.length = 0; h.render({ presentation: { sourceGeneration: 0, activeSurface: "inputs", renderSurface } }); assert.deepEqual(surfaces, ["inputs", "review"]);
  assert.deepEqual(one("AdvisoryCostReviewPanel").draft, raw); assert(h.store.hasDirty());
  surfaces.length = 0; h.render({ presentation: { sourceGeneration: 0, activeSurface: null, renderSurface } }); assert.deepEqual(surfaces, ["inputs", "review"]); assert.deepEqual(one("AdvisoryCostReviewPanel").draft, raw);
  (controls.get("project-calculate")!.onPress as () => void)(); assert.equal(h.calculations, 0);
  h.render({ presentation: { sourceGeneration: 0, activeSurface: "review", renderSurface } }); (controls.get("project-calculate")!.onPress as () => void)(); assert.equal(h.calculations, 1);
});
test("retained Review callbacks cannot revive after Review→Inputs→Review or clean new same-ID reload input", () => {
  const h = harness(sampleProject, retainedPanel());
  const renderSurface = (_surface: string, content: React.ReactNode) => content;
  const render = (surface: "inputs" | "review", sourceGeneration = 0) => h.render({ presentation: { sourceGeneration, activeSurface: surface, renderSurface } });
  render("review"); const oldSetter = one("AdvisoryCostReviewPanel").onChange as (value: typeof EMPTY_ADVISORY_COST_DRAFT) => void;
  const oldCalculate = controls.get("project-calculate")!.onPress as () => void;
  render("inputs"); render("review");
  const fresh = { ...EMPTY_ADVISORY_COST_DRAFT, machinePrice: "current raw 123x", includes: "Current evidence  " };
  (one("AdvisoryCostReviewPanel").onChange as typeof oldSetter)(fresh);
  oldSetter({ ...fresh, machinePrice: "retired overwrite" }); oldCalculate();
  assert(h.store.hasDirty()); assert.equal(h.calculations, 0); render("review"); assert.deepEqual(one("AdvisoryCostReviewPanel").draft, fresh);
  // A same-pane receiver tick keeps this rendered callback authorized.
  const samePane = controls.get("project-calculate")!.onPress as () => void; render("review"); samePane(); assert.equal(h.calculations, 1);
  const reloadCalculate = controls.get("project-calculate")!.onPress as () => void; h.store.reset(); render("review", 1);
  const reloaded = { ...fresh, machinePrice: "new reload raw 456x" }; (one("AdvisoryCostReviewPanel").onChange as typeof oldSetter)(reloaded);
  reloadCalculate(); assert(h.store.hasDirty()); assert.equal(h.calculations, 1); render("review", 1); assert.deepEqual(one("AdvisoryCostReviewPanel").draft, reloaded);
});
test("internal Project input retention admission retires Machine→Locations→Machine callbacks without dropping raw content", () => {
  let setter!: React.Dispatch<React.SetStateAction<string>>;
  function RetainedProbe() { const [value, set] = useRetainedInput("project/internal-raw", "<original />"); setter = set; return React.createElement("input", { value, readOnly: true }); }
  const h = harness(sampleProject, retainedPanel(React.createElement(RetainedProbe))), renderSurface = (_surface: string, content: React.ReactNode) => content;
  const render = () => h.render({ presentation: { sourceGeneration: 0, activeSurface: "inputs", renderSurface } });
  render(); const old = setter;
  (controls.get("project-design-tab-coordinates")!.onPress as () => void)(); render();
  (controls.get("project-design-tab-machine")!.onPress as () => void)(); render(); setter("<current exact raw />");
  let updates = 0; old(() => { updates++; return "retired raw overwrite"; });
  assert.equal(updates, 0); assert(render().includes("&lt;current exact raw /&gt;")); assert(h.store.hasDirty()); assert.equal(h.calls, 0);
});
