import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { parseLayoutSessionDocument, parseSurveyCollectionDocument } from "@cplayout/core";
import { readWorkspaceDesign } from "@cplayout/project-store";
import { packageFixture, packageIds } from "../../../../tests/web/workspace-package-fixtures";
import { editableFromSavedDesign } from "./workspaceDocumentAdapters";
import { createWorkspaceControllerState, openControllerDocument, openControllerLayout, retainControllerCollections, selectControllerMode } from "./workspaceControllerState";
import { captureWorkspaceRecoveryEditable, resolveWorkspaceEditRecovery, WORKSPACE_EDIT_RECOVERY_VERSION, type WorkspaceEditRecoveryCandidate } from "./workspaceEditRecovery";
import type { WorkspaceRecoveryDelivery, WorkspaceRecoveryParts, WorkspaceRecoveryTarget, WorkspaceRecoveryParticipants } from "./workspaceRecoveryParticipants";
import type { useWorkspaceController } from "./useWorkspaceController";
import type { WorkspaceLayoutPanelHandle } from "./WorkspaceModePanels";

type Controller = ReturnType<typeof useWorkspaceController>;
type Element = React.ReactElement<Record<string, any>>;
type Slot = { kind: string; value: any; dependencies?: readonly unknown[]; cleanup?: () => void };
let active: PanelHooks | null = null;
const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
// Execute the real component and registry handlers with retained hook slots and
// layout-before-passive effect ordering. Controller commands are observed bounds;
// this is not a rendered-browser or integrated Root hydration claim.
class PanelHooks {
  slots: Slot[] = []; cursor = 0; changed = false; layouts: Array<() => void> = []; effects: Array<() => void> = [];
  slot(kind: string, init: () => any) {
    const index = this.cursor++; if (!this.slots[index]) this.slots[index] = { kind, value: init() };
    assert.equal(this.slots[index].kind, kind); return this.slots[index];
  }
  render(component: () => React.ReactElement) {
    for (let pass = 0; pass < 15; pass++) {
      this.cursor = 0; this.changed = false; this.layouts = []; this.effects = []; active = this;
      let tree: React.ReactElement; try { tree = component(); } finally { active = null; }
      this.layouts.forEach(effect => effect()); this.effects.forEach(effect => effect());
      if (!this.changed) return tree;
    }
    throw new Error("Mode recovery effects did not settle.");
  }
  unmount() { this.slots.forEach(slot => slot.cleanup?.()); }
}
function effect(kind: "layout" | "effect", callback: () => void | (() => void), dependencies?: readonly unknown[]) {
  assert(active); const owner = active, slot = owner.slot(kind, () => undefined);
  if (!same(slot.dependencies, dependencies)) {
    slot.dependencies = dependencies;
    (kind === "layout" ? owner.layouts : owner.effects).push(() => { slot.cleanup?.(); const cleanup = callback(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; });
  }
}
const hooks = { ...React,
  useState<T>(initial: T | (() => T)) {
    assert(active); const owner = active, slot = owner.slot("state", () => typeof initial === "function" ? (initial as () => T)() : initial);
    return [slot.value, (value: T | ((old: T) => T)) => {
      const next = typeof value === "function" ? (value as (old: T) => T)(slot.value) : value;
      if (!Object.is(next, slot.value)) { slot.value = next; owner.changed = true; }
    }] as const;
  },
  useRef<T>(initial: T) { assert(active); return active.slot("ref", () => ({ current: initial })).value as { current: T }; },
  useEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => effect("effect", callback, dependencies),
  useLayoutEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => effect("layout", callback, dependencies),
  useImperativeHandle(ref: { current: unknown } | null, factory: () => unknown) { effect("layout", () => { if (ref) ref.current = factory(); }); },
};
const require = createRequire(import.meta.url), loader = require("node:module") as { _load(name: string, parent: unknown, isMain: boolean): any }, original = loader._load;
loader._load = function (name, parent, isMain) {
  if (name === "react") return hooks;
  if (name === "react-native") return { View: "div", Text: "span", TextInput: "input", Pressable: "button", Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value } };
  return original(name, parent, isMain);
};
let SurveyPanel: typeof import("./WorkspaceModePanels")["WorkspaceSurveyPanel"], LayoutPanel: typeof import("./WorkspaceModePanels")["WorkspaceLayoutPanel"];
let makeRegistry: typeof import("./workspaceRecoveryParticipants")["createWorkspaceRecoveryParticipants"];
try {
  ({ WorkspaceSurveyPanel: SurveyPanel, WorkspaceLayoutPanel: LayoutPanel } = require("./WorkspaceModePanels"));
  ({ createWorkspaceRecoveryParticipants: makeRegistry } = require("./workspaceRecoveryParticipants"));
} finally { loader._load = original; }
function find(tree: React.ReactNode, predicate: (value: Element) => boolean): Element | null {
  if (Array.isArray(tree)) { for (const child of tree) { const result = find(child, predicate); if (result) return result; } return null; }
  if (!React.isValidElement<Record<string, any>>(tree)) return null;
  return predicate(tree) ? tree : find(tree.props.children, predicate);
}
function element(tree: React.ReactNode, id: string) { const result = find(tree, value => value.props.testID === id); assert(result, `Missing ${id}`); return result; }
function named(tree: React.ReactNode, name: string) { const result = find(tree, value => value.props.accessibilityLabel === name || value.props.label === name); assert(result, `Missing ${name}`); return result; }

async function fixture(kind: "draft" | "project" | "field" = "draft") {
  const seed = await packageFixture(kind), workspace = seed.workspace, read = readWorkspaceDesign(workspace, seed.designId); assert.notEqual(read.kind, "not_found");
  if (read.kind === "not_found") throw new Error("Missing actual source");
  const editable = editableFromSavedDesign(read), collections = workspace.surveyCollections!.map(item => parseSurveyCollectionDocument(item.document)).filter(item => item.owner.designId === seed.designId);
  const session = parseLayoutSessionDocument(workspace.layoutSessions![0].document);
  let state = retainControllerCollections(openControllerDocument(createWorkspaceControllerState(), editable, { dirty: false, busy: false }, true), collections);
  state = selectControllerMode(openControllerLayout(state, { session, persistenceRevision: workspace.revision }, { dirty: false, busy: false }), "survey");
  const registry = makeRegistry(), survey = new PanelHooks(), layout = new PanelHooks(), handle = { current: null as WorkspaceLayoutPanelHandle | null };
  const pending = new Map<string, boolean>(), calls: string[] = [], pendingCalls: Array<{ key: string; dirty: boolean; changed?: boolean; receiver: string }> = [];
  let selectedId: string | null = "source-current";
  const currentState = { current: state };
  const setPending = (receiver: string) => (key: string, dirty: boolean, changed?: boolean) => { pending.set(key, dirty); pendingCalls.push({ key, dirty, changed, receiver }); };
  let controller = { state, stateRef: currentState, interactionKey: JSON.stringify([state.presentation.documentGeneration, state.presentation.interactionGeneration]),
    busy: false, recoveryParticipants: registry, selectedCollectionId: selectedId, selectedCollection: collections.find(item => item.id === selectedId),
    repository: { workspaceVersion: workspace.workspaceVersion, layoutSessions: [session] }, referenceApplicationSupported: true,
    receiver: { collectionGate: () => ({ accepted: false, reason: "Receiver disconnected" }), getSnapshot: () => ({ observation: null }) },
    getSelectedCollectionId: () => selectedId, setPendingInteractionInput: setPending("initial"), replacementGuard: () => ({ dirty: false, busy: false }),
    reportError: () => { calls.push("error"); }, applySurvey: async () => { calls.push("apply"); return false; }, collectSurvey: async () => { calls.push("survey collect"); return false; },
    enableSurvey: async () => { calls.push("enable"); return false; }, startSurvey: async () => { calls.push("start"); return false; }, selectCollection: () => { calls.push("select"); },
    changeMembership: async () => { calls.push("membership"); return false; }, collectLayout: async () => { calls.push("layout collect"); return false; },
    renameLayout: async () => { calls.push("rename"); return false; }, acknowledgeLayoutSession: async () => { calls.push("acknowledge"); return true; },
    createLayoutSession: async () => { calls.push("freeze"); return false; }, copyLayout: async () => { calls.push("copy"); return null; },
    openLayoutSession: async () => { calls.push("open layout"); return false; }, archiveLayout: async () => { calls.push("archive"); return false; },
    createFieldFromProject: async () => { calls.push("create field"); return null; }, openDesign: async () => { calls.push("open design"); return false; },
  } as unknown as Controller;
  const empty = (await import("./workspaceEditRecovery")).emptyWorkspaceEditRecoveryUi();
  const passive = <K extends "entry" | "frame" | "catalog" | "receiver" | "camera">(name: K, value: WorkspaceRecoveryParts[K]) => registry.register(name, {
    capture: () => value, stage: () => ({ isCurrent: () => true, consume: () => undefined }) });
  passive("entry", { entry: empty.entry, file: empty.file }); passive("frame", empty.entry); passive("catalog", empty.catalog); passive("receiver", empty.receiver); passive("camera", []);
  function sync() {
    controller.state = state; currentState.current = state; controller.interactionKey = JSON.stringify([state.presentation.documentGeneration, state.presentation.interactionGeneration]);
    controller.selectedCollectionId = selectedId; controller.selectedCollection = state.collections.find(item => item.id === selectedId) ?? null;
  }
  function render() {
    sync(); const surveyTree = survey.render(() => SurveyPanel({ controller }));
    const layoutTree = layout.render(() => (LayoutPanel as unknown as { render(props: { controller: Controller }, ref: typeof handle): React.ReactElement }).render({ controller }, handle));
    return { survey: surveyTree, layout: layoutTree };
  }
  render();
  function target(values?: { survey?: Partial<WorkspaceRecoveryParts["survey"]>; layout?: Partial<WorkspaceRecoveryParts["layout"]> }): WorkspaceRecoveryTarget {
    const parts = registry.capture(), ui = { ...parts.ui, survey: { ...parts.ui.survey, ...values?.survey }, layout: { ...parts.ui.layout, ...values?.layout } };
    const candidate: WorkspaceEditRecoveryCandidate = { recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION, writerId: "recovery-panel-writer", sequence: 1,
      capturedAt: "2026-10-11T12:00:00.000Z", workspaceRevision: workspace.revision,
      context: { version: 2, catalogVisible: false, catalogSelection: { clientId: packageIds.customer, projectId: packageIds.project, fieldMapId: packageIds.field, designId: seed.designId },
        workspace: { mode: "design", design: { designId: seed.designId, documentKind: kind, payloadId: editable.identity.payloadId, fieldMapId: packageIds.field, projectCrs: editable.identity.projectCrs },
          layout: { sessionId: session.id, fieldMapId: session.fieldMapId, targetHash: session.targetHash, projectCrs: editable.identity.projectCrs! }, collectionId: selectedId } },
      editable: captureWorkspaceRecoveryEditable(editable), collections: collections.map(item => ({ id: item.id, revision: item.revision, document: workspace.surveyCollections!.find(entry => entry.id === item.id)!.document })),
      layout: { id: session.id, revision: session.revision, persistenceRevision: workspace.revision, document: workspace.layoutSessions![0].document,
        targetDocument: session.targetDocument, targetHash: session.targetHash, fieldMapId: session.fieldMapId },
      controller: { historyPast: [], historyFuture: [], selectedAddress: null }, inputs: { entries: [], focus: null }, ui, cameras: [] };
    const resolved = resolveWorkspaceEditRecovery(candidate, workspace); assert.equal(resolved.kind, "ready");
    if (resolved.kind !== "ready") throw new Error("Recovery source admission failed");
    return { admission: resolved.admission, workspace, documentGeneration: state.presentation.documentGeneration + 1 };
  }
  function publish(target: WorkspaceRecoveryTarget) {
    state = { ...state, editable: target.admission.editable, collections: target.admission.collections, layout: target.admission.layout,
      presentation: { ...state.presentation, mode: "design", documentGeneration: target.documentGeneration, interactionGeneration: state.presentation.interactionGeneration + 1 } };
    selectedId = target.admission.staged.context.workspace.collectionId; sync();
  }
  return { workspace, registry, pending, calls, pendingCalls, render, target, publish, survey, layout, handle,
    setBusy(value: boolean) { controller.busy = value; },
    holdRename() {
      let release!: () => void;
      controller.renameLayout = async () => {
        calls.push("rename"); controller.busy = true;
        await new Promise<void>(resolve => { release = resolve; });
        controller.busy = false; return false;
      };
      return () => release();
    },
    mode(mode: "design" | "survey" | "layout") { state = selectControllerMode(state, mode); sync(); },
    replaceController() { controller = { ...controller, setPendingInteractionInput: setPending("replacement") }; sync(); },
    changeSource(kind: "editable" | "session") {
      state = kind === "editable" ? { ...state, editable: { ...state.editable!, sourceDocument: state.editable!.sourceDocument + " " } }
        : { ...state, layout: { ...state.layout!, session: { ...state.layout!.session, name: "Newly acknowledged session", revision: state.layout!.session.revision + 1 } } };
      sync();
    },
    source() { return JSON.stringify({ editable: state.editable, collections: state.collections, layout: state.layout }); },
    delivery(target: WorkspaceRecoveryTarget): WorkspaceRecoveryDelivery { return { id: "one-use-panel-delivery", target, isCurrent: () => currentState.current.presentation.documentGeneration === target.documentGeneration }; },
  };
}

for (const kind of ["draft", "project", "field"] as const)
test(`${kind} parked Survey/Layout recovery follows normal resets and preserves exact invalid raw values and source history`, async () => {
  const f = await fixture(kind), target = f.target({ survey: { label: "  unfinished label\n", referenceName: "", referenceNotes: "  invalid notes\n\t", referenceDetails: true },
    layout: { name: "  ", label: "uncollected\n", copyName: "  unsubmitted copy  ", details: true } });
  const before = f.registry.capture(), inputOwner = f.registry.getInputOwner(), staged = await f.registry.stage(target);
  assert(staged.isCurrent()); assert.deepEqual(f.registry.capture(), before); f.registry.setBlocked(true); f.publish(target); f.render();
  const source = f.source(); await staged.consume(f.delivery(target)); f.render();
  const captured = f.registry.capture(); assert.deepEqual(captured.ui.survey, target.admission.ui.survey); assert.deepEqual(captured.ui.layout, target.admission.ui.layout);
  assert.equal(f.registry.getInputOwner(), inputOwner); assert.equal(f.source(), source); assert.deepEqual(f.calls, []);
  assert.equal(f.pending.get("survey-label"), true); assert.equal(f.pending.get("survey-reference"), true);
  assert.equal(f.pending.get("layout-name"), true); assert.equal(f.pending.get("layout-label"), true); assert.equal(f.pending.get("layout-copy-name"), true);
  assert(f.pendingCalls.slice(-5).every(call => call.changed === undefined));
  f.registry.setBlocked(false); f.mode("survey"); const trees = f.render();
  assert.equal(element(trees.survey, "survey-reference-name").props.value, ""); assert.equal(element(trees.survey, "survey-reference-notes").props.value, "  invalid notes\n\t");
  f.mode("layout"); const layoutTree = f.render().layout; assert.equal(named(layoutTree, "Layout session name").props.value, "  ");
  assert.equal(named(layoutTree, "Copy Layout session name").props.value, "  unsubmitted copy  ");
});
test("reference/session baseline disagreement and invalid purpose fail staging without partial local values", async () => {
  const f = await fixture(), before = f.registry.capture();
  for (const values of [{ survey: { referenceBaselineName: "invented baseline" } }, { layout: { nameBaseline: "wrong saved session" } }, { survey: { purposeId: "unknown-purpose" } }])
    await assert.rejects(f.registry.stage(f.target(values)), /baseline|purpose/);
  assert.deepEqual(f.registry.capture(), before); assert.deepEqual(f.calls, []);
});
test("same-value user events and disclosure ABA retire a staged plan after current refs are updated", async () => {
  const f = await fixture(); let tree = f.render().survey;
  const staged = await f.registry.stage(f.target()), owner = f.registry.getInputOwner();
  element(tree, "survey-point-label").props.onChangeText(""); assert.notEqual(f.registry.getInputOwner(), owner); assert.equal(staged.isCurrent(), false);
  const another = await f.registry.stage(f.target());
  element(tree, "survey-reference-details").props.onPress(); tree = f.render().survey; element(tree, "survey-reference-details").props.onPress(); f.render();
  assert.equal(f.registry.capture().ui.survey.referenceDetails, false); assert.equal(another.isCurrent(), false);
});
test("held raw/disclosure/purpose and command handlers do nothing while recovery delivery is blocked", async () => {
  const f = await fixture(); let trees = f.render(); element(trees.survey, "survey-reference-details").props.onPress(); trees = f.render();
  const survey = trees.survey; f.mode("layout"); trees = f.render(); named(trees.layout, "Session details & actions").props.onPress(); trees = f.render();
  const layout = trees.layout, before = f.registry.capture(), owner = f.registry.getInputOwner(); f.registry.setBlocked(true);
  element(survey, "survey-point-label").props.onChangeText("overwrite"); element(survey, "survey-reference-name").props.onChangeText("overwrite");
  element(survey, "survey-reference-details").props.onPress(); element(survey, "survey-purpose").props.onChange(JSON.stringify({ kind: "point", role: "control" }));
  element(survey, "survey-apply").props.onPress(); named(layout, "Layout session name").props.onChangeText("overwrite");
  element(layout, "layout-observation-label").props.onChangeText("overwrite"); named(layout, "Copy Layout session name").props.onChangeText("overwrite");
  named(layout, "Hide session details").props.onPress(); named(layout, "Copy target into an empty session").props.onPress();
  await f.handle.current!.save(); f.render(); assert.deepEqual(f.registry.capture(), before); assert.equal(f.registry.getInputOwner(), owner); assert.deepEqual(f.calls, []);
});
test("delivery uses the latest controller callbacks, retires old handlers, and cannot consume twice", async () => {
  const f = await fixture(), oldTree = f.render().survey, target = f.target({ survey: { label: "recovered" }, layout: { label: "recovered Layout" } });
  const staged = await f.registry.stage(target); f.registry.setBlocked(true); f.publish(target); f.replaceController(); f.render();
  const calls = f.pendingCalls.length; await staged.consume(f.delivery(target)); f.render();
  assert(f.pendingCalls.slice(calls).every(call => call.receiver === "replacement"));
  f.registry.setBlocked(false); f.mode("survey"); f.render(); const before = f.registry.capture();
  element(oldTree, "survey-point-label").props.onChangeText("retired input"); element(oldTree, "survey-reference-details").props.onPress(); f.render();
  assert.deepEqual(f.registry.capture(), before); await assert.rejects(staged.consume(f.delivery(target)), /earlier source|earlier session/);
});
test("retired delivery and unmounted participant cannot mutate local controls", async () => {
  const f = await fixture(), target = f.target({ survey: { label: "recovery" } }), staged = await f.registry.stage(target), before = f.registry.capture();
  await assert.rejects(staged.consume({ id: "retired", target, isCurrent: () => false }), /earlier workspace/);
  assert.deepEqual(f.registry.capture(), before); f.survey.unmount(); assert.equal(staged.isCurrent(), false);
});
for (const source of ["editable", "session"] as const)
test(`${source} source change retires staged recovery even without a presentation-generation change`, async () => {
  const f = await fixture(), plan = await f.registry.stage(f.target()); assert(plan.isCurrent());
  f.changeSource(source); f.render(); assert.equal(plan.isCurrent(), false); assert.deepEqual(f.calls, []);
});
test("only its owned queued name Save leaves Layout name input editable; recovery still blocks it", async () => {
  const f = await fixture(); f.mode("layout");
  named(f.render().layout, "Session details & actions").props.onPress();
  f.setBusy(true);
  let tree = f.render().layout;
  assert.equal(named(tree, "Layout session name").props.editable, false);
  f.setBusy(false); tree = f.render().layout;
  named(tree, "Layout session name").props.onChangeText("Submitted name A"); f.render();
  const release = f.holdRename(), saving = f.handle.current!.save();
  tree = f.render().layout;
  assert.equal(named(tree, "Layout session name").props.editable, true);
  assert.equal(named(tree, "Copy Layout session name").props.editable, false);
  named(tree, "Layout session name").props.onChangeText("Newer name B");
  tree = f.render().layout; assert.equal(named(tree, "Layout session name").props.value, "Newer name B");
  f.registry.setBlocked(true); tree = f.render().layout;
  assert.equal(named(tree, "Layout session name").props.editable, false);
  named(tree, "Layout session name").props.onChangeText("Blocked overwrite");
  assert.equal(named(f.render().layout, "Layout session name").props.value, "Newer name B");
  release(); assert.equal(await saving, false);
  assert.deepEqual(f.calls, ["rename"]);
});

for (const mode of ["survey", "layout"] as const)
test(`${mode} active raw and disclosure handlers are blocked dynamically even before a disabled rerender`, async () => {
  const f = await fixture(); f.mode(mode); let trees = f.render();
  if (mode === "survey") element(trees.survey, "survey-reference-details").props.onPress(); else named(trees.layout, "Session details & actions").props.onPress();
  trees = f.render(); const before = f.registry.capture(), owner = f.registry.getInputOwner(); f.registry.setBlocked(true);
  if (mode === "survey") {
    element(trees.survey, "survey-point-label").props.onChangeText("blocked raw"); element(trees.survey, "survey-reference-name").props.onChangeText("blocked reference");
    element(trees.survey, "survey-reference-details").props.onPress(); element(trees.survey, "survey-purpose").props.onChange(before.ui.survey.purposeId);
  } else {
    named(trees.layout, "Layout session name").props.onChangeText("blocked raw"); named(trees.layout, "Copy Layout session name").props.onChangeText("blocked copy");
    named(trees.layout, "Hide session details").props.onPress(); element(trees.layout, "layout-observation-label").props.onChangeText("blocked label");
  }
  f.render(); assert.deepEqual(f.registry.capture(), before); assert.equal(f.registry.getInputOwner(), owner); assert.deepEqual(f.calls, []);
});
