import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import { defaultAppSettings, defaultProjectSettings } from "../../../../packages/core/src/settings";
import { sampleProject } from "../../../../packages/core/src/sampleProject";
import { serializeProjectDocument } from "../../../../packages/core/src/projectDocument";
import { serializeDesignDraftDocument } from "../../../../packages/core/src/designDraft";
import { convertPivotProjectToFieldDesign, serializeFieldDesignDocument } from "../../../../packages/core/src/fieldDesignDocument";
import { evaluateLayout } from "../../../../packages/geometry/src/geometry";
import { editableFromIndependentDocument, serializeWorkspaceEditable, type WorkspaceEditableDocument } from "./workspaceDocumentAdapters";
import type { UnifiedDesignCalculation, UnifiedDesignPanelProps } from "./UnifiedDesignPanel";
import { InputRetentionProvider, InputRetentionStore, useRetainedInput } from "../inputRetention";

// Controlled routing boundaries only. Real reusable input/advisory behavior has
// independent tests; no browser, native focus, or solver-execution proof is claimed.
const controls = new Map<string, Record<string, unknown>>(), children = new Map<string, Record<string, unknown>>();
const host = (tag: string) => (props: Record<string, unknown>) => { if (typeof props.testID === "string") controls.set(props.testID, props); return React.createElement(tag, null, props.children as React.ReactNode); };
const child = (name: string) => (props: Record<string, unknown>) => { children.set(name, props); return React.createElement("div", { "data-child": name }); };
const requireCurrent = createRequire(resolve(process.cwd(), "package.json")), loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }, original = loader._load;
const { renderToStaticMarkup } = requireCurrent("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
let panel: typeof import("./UnifiedDesignPanel");
try { loader._load = function(request, parent, isMain) {
  if (request === "react-native") return { Pressable: host("button"), View: host("div"), Text: host("span"), ScrollView: host("section"), Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value } };
  const name = ["DesignDraftInputs", "FieldDesignInputs", "FieldLayoutSearchPanel", "FieldLateralReview", "FieldMachinePairReview", "ProjectDesignPanel", "WorkspaceDrawingPanel"].find(value => request.endsWith(`/${value}`));
  if (name) return { [name]: child(name) };
  return original.call(this, request, parent, isMain);
}; panel = requireCurrent(resolve(__dirname, "UnifiedDesignPanel.tsx")); } finally { loader._load = original; }
function retainedPanel(projectProbe?: React.ReactNode) {
  const refs: Array<{ current: unknown }> = []; let cursor = 0, focusCalls = 0, handle: import("./UnifiedDesignPanel").UnifiedDesignPanelHandle | null = null;
  const states: unknown[] = [], tabFocus: string[] = []; let stateCursor = 0;
  const visibility = { shown: true };
  const root = { isConnected: true, getClientRects: () => ({ length: visibility.shown ? 1 : 0 }) };
  const retainedReact = { ...React, useRef(value: unknown) { return refs[cursor++] ?? (refs[cursor - 1] = { current: value }); },
    useState(initial: unknown) { const index = stateCursor++; if (!(index in states)) states[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [states[index], (update: unknown) => { states[index] = typeof update === "function" ? (update as (previous: unknown) => unknown)(states[index]) : update; }]; },
    useImperativeHandle(_ref: unknown, create: () => import("./UnifiedDesignPanel").UnifiedDesignPanelHandle) { handle = create(); } };
  const path = resolve(__dirname, "UnifiedDesignPanel.tsx"); delete requireCurrent.cache[path]; let loaded: typeof panel;
  try { loader._load = function(request, parent, isMain) {
    if (request === "react") return retainedReact;
    if (request === "react-native") return { Pressable: (props: Record<string, unknown>) => { if (typeof props.ref === "function") (props.ref as (node: unknown) => void)({ focus() { tabFocus.push(String(props.testID)); } }); return host("button")(props); }, Text: host("span"), ScrollView: host("section"), Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value },
      View: (props: Record<string, unknown>) => { if (props.testID === "unified-design-panel" && props.ref) (props.ref as { current: unknown }).current = root; return host("div")(props); } };
    const name = ["DesignDraftInputs", "FieldDesignInputs", "FieldLayoutSearchPanel", "FieldLateralReview", "FieldMachinePairReview", "ProjectDesignPanel", "WorkspaceDrawingPanel"].find(value => request.endsWith(`/${value}`));
    if (name) return { [name]: (props: Record<string, unknown>) => {
      if (props.ref) (props.ref as { current: unknown }).current = { restoreRetainedFocus() { focusCalls++; return true; } };
      if (name === "ProjectDesignPanel" && projectProbe) {
        children.set(name, props); const presentation = props.presentation as import("./ProjectDesignPanel").ProjectDesignPanelPresentation;
        return React.createElement(React.Fragment, null, presentation.renderSurface("inputs", projectProbe), presentation.renderSurface("review", null));
      }
      return child(name)(props);
    } };
    return original.call(this, request, parent, isMain);
  }; loaded = requireCurrent(path); } finally { loader._load = original; }
  return { module: loaded, visibility, tabFocus, beginRender() { cursor = 0; stateCursor = 0; }, get focusCalls() { return focusCalls; }, get handle() { return handle!; } };
}
function render(editable: WorkspaceEditableDocument | null, extra: Partial<UnifiedDesignPanelProps> = {}, retained?: ReturnType<typeof retainedPanel>, store?: InputRetentionStore) {
  retained?.beginRender();
  controls.clear(); children.clear();
  const props: UnifiedDesignPanelProps = { sourceGeneration: 0, editable, settings: defaultAppSettings(), dispatch: () => true, dispatchBatch: () => true,
    activeTask: editable?.kind === "field" ? "machines" : "inputs", onRequestTaskChange: () => true,
    drawingInteraction: null, onDrawingInteractionChange() {}, createEntityId: () => "real-created-id", onCalculate() {}, onCompleteDesign() {}, onCreateFieldFromProject() {},
    project: { onSettingsChange() {}, onActivateTool() {}, onOpenSurvey() {}, onRequestMapCapture() {}, mapCapture: null, onRequestApplyPivotCandidate() {}, onSaveGeneratedFieldPivotZones() {}, cornerEvaluation: null }, ...extra };
  const node = React.createElement((retained?.module ?? panel).UnifiedDesignPanel, props);
  return renderToStaticMarkup(store ? React.createElement(InputRetentionProvider, { store, children: node }) : node);
}
function preview(editable: WorkspaceEditableDocument, machineId: string): UnifiedDesignCalculation {
  return { kind: editable.kind, documentId: editable.identity.payloadId, inputRevision: editable.editor.revision,
    sourceDocument: serializeWorkspaceEditable(editable), machineIds: [machineId], results: [{ machineId, result: evaluateLayout(sampleProject) }] };
}
test("empty selection renders no editor or invented design", () => {
  assert(render(null).includes("Open or create an actual design")); assert.equal(children.size, 0); assert.equal(controls.size, 1);
});
test("incomplete Draft stays actual, completion stays gated, and saved complete Open is explicit", () => {
  const settings = defaultProjectSettings();
  const editable = editableFromIndependentDocument("draft", serializeDesignDraftDocument({ id: "incomplete", name: "Raw actual Draft", projectCrs: null, unitSystem: settings.unitSystem,
    settings, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] }));
  let completed = 0, opened = ""; render(editable, { onCompleteDesign() { completed++; }, savedCompleteDesignId: "saved-real-id", onOpenCompleteDesign(id) { opened = id; } });
  assert.equal(children.get("DesignDraftInputs")!.editor, editable.editor); assert.equal(children.has("ProjectDesignPanel"), false); assert.equal(children.has("FieldDesignInputs"), false);
  assert.equal(controls.get("draft-create-complete")!.disabled, true); assert.equal(completed, 0); assert.equal(opened, "");
  (controls.get("draft-open-saved-complete")!.onPress as () => void)(); assert.equal(opened, "saved-real-id"); assert.equal(completed, 0);
});
test("Project preview requires exact current source bytes, revision and actual matching machine identity", () => {
  const editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject));
  if (editable.kind !== "project") throw new Error("Expected Project.");
  const calculation = preview(editable, editable.editor.project.machine.id);
  render(editable, { calculation }); assert.equal(children.get("ProjectDesignPanel")!.result, calculation.results[0].result);
  for (const stale of [{ ...calculation, inputRevision: calculation.inputRevision + 1 }, { ...calculation, sourceDocument: `${calculation.sourceDocument} ` },
    { ...calculation, documentId: "foreign" }, { ...calculation, results: [] }, { ...calculation, results: [{ ...calculation.results[0], machineId: "other-machine" }] }]) {
    render(editable, { calculation: stale }); assert.equal(children.get("ProjectDesignPanel")!.result, null);
  }
});
test("Field route preserves independent machine selection and supplies all actual advisory slots", () => {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "actual-field", waterSourceId: "water", powerSourceId: "power" }).field;
  const original = editableFromIndependentDocument("field", serializeFieldDesignDocument(field));
  if (original.kind !== "field") throw new Error("Expected Field.");
  const editable = { ...original, editor: { ...original.editor, selectedMachineId: field.machines[0].id } }, calculation = preview(original, field.machines[0].id);
  render(editable, { calculation }); const props = children.get("FieldDesignInputs")!;
  assert.equal(props.editor, editable.editor); assert.equal(children.has("ProjectDesignPanel"), false);
  assert.equal((props.calculationPreview as { result: unknown }).result, calculation.results[0].result);
  const slots = props.advisoryPanels as Record<string, React.ReactElement>; assert.deepEqual(Object.keys(slots), ["layoutSearch", "lateralReview", "machineClearance"]);
  for (const slot of Object.values(slots)) assert(React.isValidElement(slot));
  render({ ...editable, editor: { ...editable.editor, selectedMachineId: null } }, { calculation }); assert.equal(children.get("FieldDesignInputs")!.calculationPreview, null);
});
test("controlled task admission requests only presentation and never dispatches a drawing or history action", () => {
  const editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject));
  const requests: string[] = []; let actions = 0;
  render(editable, { activeTask: "drawing", onRequestTaskChange(task) { requests.push(task); return false; }, dispatch() { actions++; return true; }, dispatchBatch() { actions++; return true; } });
  (controls.get("design-task-inputs")!.onPress as () => void)();
  assert.deepEqual(requests, ["inputs"]); assert.equal(actions, 0);
  const presentation = children.get("ProjectDesignPanel")!.presentation as import("./ProjectDesignPanel").ProjectDesignPanelPresentation;
  assert.equal(presentation.activeSurface, null);
  render(editable, { activeTask: "inputs", onRequestTaskChange(task) { requests.push(task); return true; } });
  assert.equal((children.get("ProjectDesignPanel")!.presentation as import("./ProjectDesignPanel").ProjectDesignPanelPresentation).activeSurface, "inputs");
  assert.equal(controls.get("design-task-machines"), undefined); assert.equal(controls.get("design-task-scroll-drawing")!.style instanceof Array, true);
});
test("Draft review uses actual completeness blockers to request the existing relevant input section", () => {
  const settings = defaultProjectSettings(), editable = editableFromIndependentDocument("draft", serializeDesignDraftDocument({ id: "missing", name: "Actual incomplete Draft", projectCrs: null,
    unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] }));
  const requests: string[] = [];
  render(editable, { activeTask: "review", onRequestTaskChange(task) { requests.push(task); return true; } });
  assert.equal(children.get("DesignDraftInputs")!.disabled, true);
  const blocker = [...controls.entries()].find(([id, props]) => id.startsWith("draft-review-blocker-") && String(props.accessibilityLabel).toLowerCase().includes("machine"));
  assert(blocker); (blocker[1].onPress as () => void)(); assert.deepEqual(requests, ["inputs"]);
  assert.deepEqual(panel.draftReviewBlockerTarget({ path: "machine.spanLengthsMeters.0", code: "missing", message: "Actual missing span" }), { task: "inputs", section: "machine" });
  assert.deepEqual(panel.draftReviewBlockerTarget({ path: "drawingWorkflow", code: "unfinished_drawing", message: "Actual unfinished capture" }), { task: "drawing", section: null });
  render(editable, { activeTask: "inputs" }); assert.equal(children.get("DesignDraftInputs")!.disabled, false);
  assert.deepEqual(panel.unifiedDesignTasks("field"), ["machines", "review"]);
});
test("pending Field raw input synchronously prevents externally supplied advisory adoption from replacing its source", () => {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "actual-field", waterSourceId: "water", powerSourceId: "power" }).field;
  const editable = editableFromIndependentDocument("field", serializeFieldDesignDocument(field));
  let admissions = 0;
  render(editable, { activeTask: "review", dispatch() { admissions++; return true; } });
  const inputProps = children.get("FieldDesignInputs")!;
  const slot = (inputProps.advisoryPanels as { layoutSearch: React.ReactElement<{ onAdopt: (machines: typeof field.machines, revision: number, ids: string[]) => boolean }> }).layoutSearch;
  (inputProps.onPendingChange as (value: boolean) => void)(true);
  assert.equal(slot.props.onAdopt(field.machines, 0, []), false); assert.equal(admissions, 0);
  (inputProps.onPendingChange as (value: boolean) => void)(false);
  assert.equal(slot.props.onAdopt(field.machines, 0, []), true); assert.equal(admissions, 1);
});
test("captured Field advisory adoption cannot revive after Review→Machines→Review while same-pane receiver rerenders remain valid", () => {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "actual-field", waterSourceId: "water", powerSourceId: "power" }).field;
  const editable = editableFromIndependentDocument("field", serializeFieldDesignDocument(field)), retained = retainedPanel(); let admissions = 0;
  const show = (activeTask: UnifiedDesignPanelProps["activeTask"], sourceGeneration = 0) => render(editable, { activeTask, sourceGeneration, dispatch() { admissions++; return true; } }, retained);
  type Slot = React.ReactElement<{ onAdopt(machines: typeof field.machines, revision: number, ids: string[]): boolean }>;
  const adopt = () => (children.get("FieldDesignInputs")!.advisoryPanels as { layoutSearch: Slot }).layoutSearch.props.onAdopt;
  show("review"); const oldAdopt = adopt(); show("machines"); show("review");
  assert.equal(oldAdopt(field.machines, 0, []), false); assert.equal(admissions, 0);
  const current = adopt(); show("review"); assert.equal(current(field.machines, 0, []), true); assert.equal(admissions, 1);
  const beforeReload = adopt(); show("review", 1); assert.equal(beforeReload(field.machines, 0, []), false); assert.equal(admissions, 1);
});
test("ancestor-hidden web root refuses child focus delegation before touching Inputs and same-ID reload retires old focus handles", () => {
  const settings = defaultProjectSettings(), editable = editableFromIndependentDocument("draft", serializeDesignDraftDocument({ id: "focus-draft", name: "Actual focus fixture", projectCrs: null,
    unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] }));
  const retained = retainedPanel(); render(editable, { activeTask: "inputs" }, retained);
  retained.visibility.shown = false; assert.equal(retained.handle.restoreRetainedFocus(), false); assert.equal(retained.focusCalls, 0);
  retained.visibility.shown = true; assert.equal(retained.handle.restoreRetainedFocus(), true); assert.equal(retained.focusCalls, 1);
  const oldHandle = retained.handle; render(editable, { activeTask: "inputs", sourceGeneration: 1 }, retained);
  assert.equal(oldHandle.restoreRetainedFocus(), false); assert.equal(retained.focusCalls, 1);
  assert.equal(panel.visibleDesignRoot({ isConnected: true, getClientRects: () => ({ length: 0 }) }), false);
  assert.equal(panel.visibleDesignRoot({ isConnected: false, getClientRects: () => ({ length: 1 }) }), false);
});
test("actual task surface admission protects internal retained setters before a retired functional updater executes", () => {
  let setter!: React.Dispatch<React.SetStateAction<string>>;
  function RetainedProbe() { const [value, set] = useRetainedInput("project/raw-xml", "<original />"); setter = set; return React.createElement("input", { value, readOnly: true }); }
  const retained = retainedPanel(React.createElement(RetainedProbe)), store = new InputRetentionStore();
  const editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject));
  const show = (activeTask: UnifiedDesignPanelProps["activeTask"], sourceGeneration = 0) => render(editable, { activeTask, sourceGeneration }, retained, store);
  show("inputs"); const old = setter; setter("<unfinished old />"); show("review"); show("inputs"); setter("<current exact raw />");
  let updaterCalls = 0; old(() => { updaterCalls++; return "retired overwrite"; });
  assert.equal(updaterCalls, 0); assert(show("inputs").includes("&lt;current exact raw /&gt;"));
  const beforeReload = setter; show("inputs", 1); setter("<reloaded raw />"); beforeReload(() => { updaterCalls++; return "old reload overwrite"; });
  assert.equal(updaterCalls, 0); assert(show("inputs", 1).includes("&lt;reloaded raw /&gt;"));
  const samePane = setter; show("inputs", 1); samePane("<same-pane update />"); assert(show("inputs", 1).includes("&lt;same-pane update /&gt;"));
});
test("task tabs expose explicit selected state and linked panels; arrows move only focus and Space/Enter request one activation", () => {
  const editable = editableFromIndependentDocument("project", serializeProjectDocument(sampleProject)), retained = retainedPanel();
  const requested: string[] = [];
  const show = (activeTask: UnifiedDesignPanelProps["activeTask"]) => render(editable, { activeTask, onRequestTaskChange(task) { requested.push(task); return true; } }, retained);
  show("drawing");
  const drawing = controls.get("design-task-drawing")!, inputs = controls.get("design-task-inputs")!, review = controls.get("design-task-review")!;
  assert.equal(drawing["aria-selected"], true); assert.equal(inputs["aria-selected"], false); assert.equal(review["aria-selected"], false);
  assert.equal(drawing.tabIndex, 0); assert.equal(inputs.tabIndex, -1); assert.equal((drawing.accessibilityState as { selected: boolean }).selected, true);
  const drawingPanel = controls.get("design-task-scroll-drawing")!; assert.equal(drawing["aria-controls"], drawingPanel.nativeID); assert.equal(drawingPanel["aria-labelledby"], drawing.nativeID); assert.equal(drawingPanel.role, "tabpanel");
  const key = (props: Record<string, unknown>, value: string) => {
    let prevented = false; (props.onKeyDownCapture as (event: unknown) => void)({ key: value, repeat: false, preventDefault() { prevented = true; }, stopPropagation() {} }); return prevented;
  };
  assert(key(drawing, "ArrowRight")); assert.deepEqual(retained.tabFocus, ["design-task-inputs"]); assert.deepEqual(requested, []);
  assert(key(inputs, "End")); assert.equal(retained.tabFocus.at(-1), "design-task-review"); assert.deepEqual(requested, []);
  assert(key(inputs, " ")); assert.deepEqual(requested, ["inputs"]); show("inputs"); assert.equal(controls.get("design-task-inputs")!["aria-selected"], true);
  assert(key(controls.get("design-task-review")!, "Enter")); assert.deepEqual(requested, ["inputs", "review"]);
  assert.deepEqual(panel.designTabFocusTarget(["drawing", "inputs", "review"], "drawing", "ArrowLeft"), "review");
});
test("friendly Review actions preserve distinct real machine inputs and exact diagnostics behind optional details", () => {
  const settings = defaultProjectSettings(), editable = editableFromIndependentDocument("draft", serializeDesignDraftDocument({ id: "friendly", name: "Actual incomplete fixture", projectCrs: null,
    unitSystem: settings.unitSystem, settings, fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] }));
  const retained = retainedPanel(); const show = (sourceGeneration = 0) => render(editable, { activeTask: "review", sourceGeneration }, retained);
  const initial = show(); assert(!initial.includes("expected object")); assert(initial.includes("Set pivot center")); assert(initial.includes("Set water source")); assert(initial.includes("Set power source"));
  assert(initial.includes("Set machine ID")); assert(initial.includes("Set machine name")); assert(initial.includes("Set span lengths")); assert(initial.includes("Choose full circle or sector"));
  (controls.get("draft-review-details-toggle")!.onPress as () => void)(); const details = show(); assert(controls.has("draft-review-validation-details")); assert(details.includes("Invalid input: expected object, received null"));
  show(1); assert(!controls.has("draft-review-validation-details"));
  const blockers = [{ path: "pivotCenter.x", code: "invalid_type", message: "Exact X diagnostic" }, { path: "pivotCenter.y", code: "invalid_type", message: "Exact Y diagnostic" },
    { path: "machine.id", code: "missing", message: "Exact ID diagnostic" }, { path: "machine.name", code: "missing", message: "Exact name diagnostic" },
    { path: "machine.spanLengthsMeters.0", code: "missing", message: "Exact span 1" }, { path: "machine.spanLengthsMeters.2", code: "missing", message: "Exact span 3" }];
  const before = structuredClone(blockers), actions = panel.draftReviewActions(blockers);
  assert.equal(actions.length, 4); assert.deepEqual(actions[0].diagnostics, blockers.slice(0, 2)); assert.deepEqual(actions.at(-1)!.diagnostics, blockers.slice(4));
  assert.deepEqual(actions.slice(1).map(action => action.label), ["Set machine ID", "Set machine name", "Set span lengths"]); assert.deepEqual(blockers, before);
  assert.deepEqual(actions.at(-1)!.target, { task: "inputs", section: "machine" });
});
