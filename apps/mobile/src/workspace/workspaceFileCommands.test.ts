import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import React from "react";
import { convertPivotProjectToFieldDesign, createFieldLayoutTarget, serializeFieldLayoutTarget, sampleProject,
  parseLayoutSessionDocument, parseSurveyCollectionDocument, createSurveyCollection, type LayoutSession } from "@cplayout/core";
import { applyWorkspaceCommand, type WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, type WorkspaceDocument } from "../../../../packages/project-store/src/workspaceDocument";
import { buildDesignWorkspaceBundle, parseDesignWorkspaceBundle, type DesignWorkspaceBundle } from "../../../../packages/project-store/src/designWorkspaceBundle";
import { createInputRetentionBaseline } from "../inputRetention";
import { newDesignDraft } from "../newDesignDraft";
import type { ProjectWorkspaceStatus, SaveFeedbackOwner } from "../hooks/useProjectRepository";

type Controller = ReturnType<typeof import("./useWorkspaceController")["useWorkspaceController"]>;
type Slot = { kind: string; value: any; dependencies?: readonly unknown[]; cleanup?: () => void };
let active: ControllerFixture | null = null;
let boundaryOwner: ControllerFixture | null = null;
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

/** Retained synthetic hook slots execute the actual controller and its effects.
 * Repository I/O is the only command boundary replaced; all commands use the
 * real WorkspaceDocument reducer. This is not mounted React or device proof. */
class ControllerFixture {
  slots: Slot[] = []; cursor = 0; effects: (() => void)[] = []; changed = false;
  reads = 0; writes: WorkspaceCommand[] = []; exports: { filename: string; bytes: string | Uint8Array }[] = [];
  workspace = workspaceFixture(); quotaError: Error | null = null;
  nextRead: (() => Promise<WorkspaceDocument>) | null = null;
  beforeWrite: (() => Promise<void>) | null = null;
  controller!: Controller;
  slot(kind: string, initial: () => any): Slot {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = { kind, value: initial() };
    const slot = this.slots[index]; assert.equal(slot.kind, kind, `Hook slot ${index} changed owner`); return slot;
  }
  repository = {
    // Describes the simulated supported web command boundary; no browser durability proof.
    backendInfo: { backendLabel: "Synthetic web command boundary", runtime: "web", storageEngine: "local_storage", durable: true,
      supportsProjectList: true, supportsZipImport: true, supportsZipExport: true, notes: ["Repository I/O is simulated; commands use the real reducer."] },
    readWorkspace: async () => {
      this.reads++;
      const deferred = this.nextRead; this.nextRead = null;
      return deferred ? deferred() : this.workspace;
    },
    executeWorkspaceCommand: async (command: WorkspaceCommand, revision: number, owner?: SaveFeedbackOwner) => {
      const pause = this.beforeWrite; this.beforeWrite = null; if (pause) await pause();
      if (owner && !owner.isCurrent()) throw new Error("Repository refused a retired command owner");
      assert.equal(revision, this.workspace.revision, "Controller must use the latest acknowledged workspace revision");
      if (this.quotaError) throw this.quotaError;
      const receipt = applyWorkspaceCommand(this.workspace, command);
      this.workspace = receipt.workspace; this.writes.push(command); return receipt;
    },
  } as unknown as ProjectWorkspaceStatus;
  render(): Controller {
    for (let pass = 0; pass < 12; pass++) {
      this.cursor = 0; this.effects = []; this.changed = false; active = this; boundaryOwner = this;
      try { this.controller = useWorkspaceController(); } finally { active = null; }
      this.effects.forEach(effect => effect());
      if (!this.changed) return this.controller;
    }
    throw new Error("Controller fixture did not settle after twelve effect passes");
  }
  dispose() { this.slots.forEach(slot => slot.cleanup?.()); }
  async openDesign() { assert.equal(await this.render().openDesign("design"), true); return this.render(); }
  async openLayout() { assert.equal(await this.render().openLayoutSession("layout"), true); return this.render(); }
  holdRead(readsBeforeHold = 0) {
    let release!: (value: WorkspaceDocument) => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<WorkspaceDocument>(resolve => { release = resolve; });
    const deferred = (): Promise<WorkspaceDocument> => {
      if (readsBeforeHold-- > 0) { this.nextRead = deferred; return Promise.resolve(this.workspace); }
      entered(); return pending;
    };
    this.nextRead = deferred;
    return { started, release: () => release(this.workspace) };
  }
}
const reactHooks = {
  ...React,
  useState<T>(initial: T | (() => T)) {
    if (!active) return React.useState(initial);
    const owner = active, slot = owner.slot("useState", () => typeof initial === "function" ? (initial as () => T)() : initial);
    return [slot.value as T, (value: T | ((old: T) => T)) => {
      const next = typeof value === "function" ? (value as (old: T) => T)(slot.value) : value;
      if (!Object.is(next, slot.value)) { slot.value = next; owner.changed = true; }
    }] as const;
  },
  useRef<T>(initial: T) {
    if (!active) return React.useRef(initial);
    return active.slot("useRef", () => ({ current: initial })).value as { current: T };
  },
  useMemo<T>(factory: () => T, dependencies?: readonly unknown[]) {
    if (!active) return React.useMemo(factory, dependencies!);
    const slot = active.slot("useMemo", () => undefined);
    if (!sameDependencies(slot.dependencies, dependencies)) { slot.value = factory(); slot.dependencies = dependencies; }
    return slot.value as T;
  },
  useCallback<T extends (...args: any[]) => any>(callback: T, dependencies?: readonly unknown[]) {
    if (!active) return React.useCallback(callback, dependencies!);
    const slot = active.slot("useCallback", () => undefined);
    if (!sameDependencies(slot.dependencies, dependencies)) { slot.value = callback; slot.dependencies = dependencies; }
    return slot.value as T;
  },
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    if (!active) return React.useEffect(effect, dependencies);
    const owner = active, slot = owner.slot("useEffect", () => undefined);
    if (!sameDependencies(slot.dependencies, dependencies)) {
      owner.effects.push(() => { slot.cleanup?.(); const cleanup = effect(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; });
      slot.dependencies = dependencies;
    }
  },
  useSyncExternalStore<T>(subscribe: (listener: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T) {
    if (!active) return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    const owner = active, slot = owner.slot("useSyncExternalStore", () => undefined);
    if (slot.value !== subscribe) {
      owner.effects.push(() => { slot.cleanup?.(); slot.cleanup = subscribe(() => { owner.changed = true; }); });
      slot.value = subscribe;
    }
    return getSnapshot();
  },
};
const require = createRequire(import.meta.url);
const loader = require("node:module") as { _load: (name: string, parent: unknown, isMain: boolean) => any };
const originalLoad = loader._load;
loader._load = function (name, parent, isMain) {
  if (name === "react") return reactHooks;
  if (name === "react-native") return { View: "div", Text: "span", Pressable: "button", TextInput: "input", ScrollView: "section", Modal: "dialog",
    Platform: { OS: "web", select: (choices: Record<string, unknown>) => choices.web ?? choices.default },
    StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 1200, height: 800 }) };
  if (name === "react-native-safe-area-context") return { SafeAreaView: "div" };
  if (name === "react-native-svg") return new Proxy({ default: "svg" }, { get: (target, key) => key === "__esModule" ? true : key === "default" ? target.default : "svg" });
  if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
  if (name === "../hooks/useProjectRepository") return { useProjectRepository() { assert(boundaryOwner); return boundaryOwner.repository; } };
  if (name === "@cplayout/project-store") return { ...originalLoad(name, parent, isMain), exportFileAsync: async (filename: string, bytes: string | Uint8Array) => {
    assert(boundaryOwner); boundaryOwner.exports.push({ filename, bytes }); return { ok: true, message: "Synthetic export boundary accepted" };
  } };
  return originalLoad(name, parent, isMain);
};
let useWorkspaceController: typeof import("./useWorkspaceController")["useWorkspaceController"];
try { ({ useWorkspaceController } = require("./useWorkspaceController")); } finally { loader._load = originalLoad; }

const now = "2026-10-10T20:00:00.000Z";
function workspaceFixture(): WorkspaceDocument {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "frozen-field", waterSourceId: "water", powerSourceId: "power" }).field;
  const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 0, expectedRevision: 0, selectedMachineIds: [field.machines[0].id] }));
  let workspace = emptyWorkspaceDocument();
  const apply = (command: WorkspaceCommand) => { workspace = applyWorkspaceCommand(workspace, command).workspace; };
  apply({ type: "create_client", now, id: "customer", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  apply({ type: "create_project_with_initial_field_map", now, input: { clientId: "customer", projectId: "project", projectName: "Project", projectCrs: field.projectCrs, unitSystem: "metric", fieldMapId: "map" } });
  const draft = { ...newDesignDraft("draft", "Saved draft", "metric"), projectCrs: field.projectCrs };
  apply({ type: "create_design_draft", now, designId: "design", fieldMapId: "map", name: draft.name, draft });
  apply({ type: "upgrade_workspace_to_v3", now }); apply({ type: "upgrade_workspace_to_v4", now });
  apply({ type: "create_layout_session", now, sessionId: "layout", fieldMapId: "map", name: "Saved Layout", targetDocument });
  apply({ type: "create_survey_collection", now, expectedDesignRevision: 0, collection: createSurveyCollection({ id: "survey", now, purpose: { kind: "field_boundary" },
    owner: { designId: "design", documentKind: "draft", payloadId: draft.id, fieldMapId: "map", projectCrs: field.projectCrs } }) });
  return workspace;
}
function fixture(t: TestContext) { const f = new ControllerFixture(); t.after(() => f.dispose()); return f; }
function retainRaw(controller: Controller) {
  const baseline = createInputRetentionBaseline({ text: "saved", spans: ["120", "130"] });
  controller.inputs.reconcile("design/raw", baseline);
  return { baseline, key: "design/raw", set: (text: string) => controller.inputs.set("design/raw", baseline, { text, spans: ["120", "130"] }) };
}
function savedLayout(f: ControllerFixture): LayoutSession { return parseLayoutSessionDocument(f.workspace.layoutSessions!.find(item => item.id === "layout")!.document); }

test("unapplied Save refuses before storage, Discard clears its notice, and a genuine quota error survives another input refusal", async t => {
  const f = fixture(t); let controller = await f.openDesign(); const raw = retainRaw(controller); raw.set(" malformed "); controller = f.render();
  const before = f.workspace;
  assert.equal(await controller.save(), false); controller = f.render();
  assert.equal(controller.state.savedState, "saved"); assert.equal(controller.autosaveFailure, null); assert.equal(f.writes.length, 0); assert.equal(f.workspace, before);
  assert.match(controller.state.notice!, /Apply or discard/);
  controller.inputs.resetScope("design"); controller = f.render(); assert.equal(controller.state.notice, null);
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Applied unsaved name" } })); controller = f.render();
  f.quotaError = new Error("Storage quota exceeded at repository write");
  assert.equal(await controller.save(), false); controller = f.render();
  assert.equal(controller.state.savedState, "error"); assert.match(controller.state.notice!, /quota/); assert.match(controller.autosaveFailure!, /save error/);
  const failure = controller.autosaveFailure;
  const newer = retainRaw(controller); newer.set("new malformed text"); controller = f.render();
  assert.equal(await controller.save(), false); controller = f.render();
  assert.equal(controller.state.savedState, "error"); assert.equal(controller.autosaveFailure, failure); assert.equal(f.workspace, before);
  controller.inputs.resetScope("design"); controller = f.render();
  assert.equal(controller.state.savedState, "error"); assert.equal(controller.autosaveFailure, failure);
  f.quotaError = null; assert.equal(await controller.save(), true); controller = f.render();
  assert.equal(controller.state.savedState, "saved"); assert.equal(controller.autosaveFailure, null); assert.equal(f.writes.length, 1);
});

test("clean applied Design Copy refuses dirty literal input and preserves raw text, caret, geometry and history", async t => {
  const f = fixture(t); let controller = await f.openDesign(); const raw = retainRaw(controller); raw.set("  malformed  ");
  controller.inputs.recordFocus(raw.key); controller.inputs.recordSelection(raw.key, { start: 2, end: 5 }); controller = f.render();
  const before = controller.stateRef.current, workspace = f.workspace, reads = f.reads;
  assert.equal(await controller.copyDesign("Excluded inputs copy"), null);
  controller = f.render(); assert.equal(f.reads, reads); assert.equal(f.writes.length, 0); assert.equal(f.workspace, workspace);
  assert.equal(controller.state.editable, before.editable); assert.equal(controller.state.historyPast, before.historyPast);
  assert.deepEqual(controller.inputs.read(raw.key, raw.baseline), { text: "  malformed  ", spans: ["120", "130"] });
  assert.deepEqual(controller.inputs.retainedFocus(), { key: raw.key, selection: { start: 2, end: 5 } });
});

for (const operation of ["copy", "export"] as const) test(`deferred ${operation} refuses raw A to B to A and its duplicate without creating output`, async t => {
  const f = fixture(t); let controller = await f.openDesign(); const raw = retainRaw(controller); controller = f.render();
  const before = f.workspace, read = f.holdRead();
  const job = operation === "copy" ? controller.copyDesign("Deferred copy") : controller.exportDesignWorkspace("json");
  await read.started;
  assert.equal(await controller.copyDesign("Duplicate"), null);
  assert.equal((await controller.exportDesignWorkspace("json")).ok, false);
  raw.set("B"); raw.set("saved"); assert.equal(controller.inputs.hasDirty(), false);
  read.release(); const result = await job;
  if (operation === "copy") assert.equal(result, null); else assert.equal((result as { ok: boolean }).ok, false);
  controller = f.render(); assert.equal(f.workspace, before); assert.equal(f.writes.length, 0); assert.equal(f.exports.length, 0); assert.equal(controller.busy, false);
  assert.deepEqual(controller.inputs.read(raw.key, raw.baseline), raw.baseline.value);
});

test("intentional File dialog text does not self-block complete Design Copy and Export, while Survey interaction ABA does", async t => {
  const f = fixture(t); let controller = await f.openDesign();
  controller.setPendingInteractionInput("file-dialog", true, true); controller = f.render();
  const copyId = await controller.copyDesign("Complete copy"); assert(copyId); controller = f.render();
  assert.equal(f.writes.filter(command => command.type === "copy_design_with_survey").length, 1);
  assert.equal((f.workspace.surveyCollections ?? []).filter(entry => parseSurveyCollectionDocument(entry.document).owner.designId === copyId).length, 1);
  assert.equal((await controller.exportDesignWorkspace("json")).ok, true);
  const bundle = parseDesignWorkspaceBundle(JSON.parse(f.exports[0].bytes as string));
  assert.equal(bundle.surveyDocuments.length, 1); assert.equal(controller.pendingInput("file-dialog"), true);
  controller = f.render(); const before = f.workspace, exports = f.exports.length, read = f.holdRead();
  const job = controller.exportDesignWorkspace("json"); await read.started;
  controller.setPendingInteractionInput("survey-label", true, true); controller.setPendingInteractionInput("survey-label", false, true);
  read.release(); assert.equal((await job).ok, false); assert.equal(f.workspace, before); assert.equal(f.exports.length, exports);
});

test("Layout acknowledgement and rename preserve hidden dirty Design editor, history, literal input, caret and immutable target", async t => {
  const f = fixture(t); await f.openDesign(); let controller = await f.openLayout();
  controller.selectMode("design"); controller = f.render();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Unsaved hidden design" } })); controller = f.render();
  const raw = retainRaw(controller); raw.set("120' unfinished"); controller.inputs.recordFocus(raw.key); controller.inputs.recordSelection(raw.key, { start: 3, end: 7 });
  controller.selectMode("layout"); controller = f.render();
  const before = controller.stateRef.current, target = savedLayout(f), inputRevision = controller.inputs.getRevision(), workspace = f.workspace;
  assert.equal(await controller.acknowledgeLayoutSession(), true); controller = f.render();
  assert.equal(f.workspace, workspace); assert.equal(f.writes.length, 0); assert.equal(controller.layoutSaveState, "saved");
  controller.setPendingInteractionInput("layout-name", true, true); controller.setPendingInteractionInput("layout-label", true, true); controller = f.render();
  assert.equal(await controller.renameLayout("Admitted new session name"), true); controller = f.render();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].type, "rename_layout_session");
  assert.equal(controller.state.layout!.session.name, "Admitted new session name");
  assert.equal(controller.state.layout!.session.targetDocument, target.targetDocument); assert.equal(controller.state.layout!.session.targetHash, target.targetHash);
  assert.equal(controller.state.editable!.editor, before.editable!.editor); assert.equal(controller.state.historyPast, before.historyPast); assert.equal(controller.state.historyFuture, before.historyFuture);
  assert.equal(controller.inputs.getRevision(), inputRevision); assert.deepEqual(controller.inputs.read(raw.key, raw.baseline), { text: "120' unfinished", spans: ["120", "130"] });
  assert.deepEqual(controller.inputs.retainedFocus(), { key: raw.key, selection: { start: 3, end: 7 } }); assert(controller.pendingInput("layout-label"));
});

for (const operation of ["acknowledge", "rename"] as const) test(`deferred Layout ${operation} is cancelled after mode ABA without reporting storage failure`, async t => {
  const f = fixture(t); await f.openDesign(); let controller = await f.openLayout();
  const before = f.workspace, session = savedLayout(f), read = f.holdRead();
  const job = operation === "acknowledge" ? controller.acknowledgeLayoutSession() : controller.renameLayout("Should not commit");
  await read.started;
  assert.equal(await controller.acknowledgeLayoutSession(), false); assert.equal(await controller.renameLayout("Duplicate"), false);
  controller.selectMode("design"); controller = f.render(); controller.selectMode("layout"); controller = f.render();
  read.release(); assert.equal(await job, false); controller = f.render();
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0); assert.equal(controller.state.notice, null); assert.equal(controller.layoutSaveState, "saved");
  assert.deepEqual(controller.state.layout!.session, session); assert.equal(controller.autosaveFailure, null); assert.equal(controller.busy, false);
});

test("Layout Copy and Export ignore hidden Design inputs, refuse pending session names, and preserve observation labels", async t => {
  const f = fixture(t); await f.openDesign(); let controller = await f.openLayout(); const raw = retainRaw(controller); raw.set("hidden malformed Design text"); controller = f.render();
  controller.setPendingInteractionInput("layout-label", true, true); controller.setPendingInteractionInput("layout-name", true, true); controller = f.render();
  assert.equal(await controller.copyLayout("Refused"), null); assert.equal((await controller.exportLayoutSession("json")).ok, false); assert.equal(f.writes.length, 0); assert.equal(f.exports.length, 0);
  controller.setPendingInteractionInput("layout-name", false, true); controller = f.render();
  const copied = await controller.copyLayout("Frozen copy"); assert(copied); controller = f.render();
  assert.equal((await controller.exportLayoutSession("json")).ok, true);
  const original = savedLayout(f), copy = parseLayoutSessionDocument(f.workspace.layoutSessions!.find(entry => entry.id === copied)!.document);
  assert.equal(copy.targetDocument, original.targetDocument); assert.equal(copy.targetHash, original.targetHash);
  assert.equal(parseLayoutSessionDocument(f.exports[0].bytes as string).id, "layout");
  assert(controller.pendingInput("layout-label")); assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "hidden malformed Design text");
});

for (const key of ["layout-name", "layout-label", "layout-copy-name"] as const) test(`null-to-saved Layout open refuses pending ${key} without changing its intent or stored session bytes`, async t => {
  const f = fixture(t); let controller = await f.openDesign(); controller.selectMode("layout"); controller = f.render();
  assert.equal(controller.state.layout, null);
  controller.setPendingInteractionInput(key, true, true); controller = f.render();
  const before = f.workspace, storedBytes = f.workspace.layoutSessions!.find(entry => entry.id === "layout")!.document;
  const reads = f.reads, pendingRevision = controller.pendingInputRevision, editable = controller.state.editable;
  assert.equal(await controller.openLayoutSession("layout"), false); controller = f.render();
  assert.equal(f.reads, reads, "pending Layout intent refuses before repository access");
  assert.equal(controller.state.layout, null); assert.equal(controller.state.editable, editable);
  assert.equal(controller.pendingInput(key), true); assert.equal(controller.pendingInputRevision, pendingRevision);
  assert.equal(controller.openLayout({ session: savedLayout(f), persistenceRevision: f.workspace.revision }), false, "public presentation cannot bypass the pending intent guard");
  controller = f.render();
  assert.equal(controller.state.layout, null); assert.equal(controller.pendingInput(key), true); assert.equal(controller.pendingInputRevision, pendingRevision);
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0); assert.equal(f.workspace.layoutSessions!.find(entry => entry.id === "layout")!.document, storedBytes);
});

for (const readsBeforeHold of [0, 1]) test(`pending Layout name entered during deferred ${readsBeforeHold === 0 ? "initial" : "reconciliation"} read refuses final session presentation`, async t => {
  const f = fixture(t); let controller = await f.openDesign(); controller.selectMode("layout"); controller = f.render();
  const before = f.workspace, storedBytes = f.workspace.layoutSessions!.find(entry => entry.id === "layout")!.document;
  const editor = controller.state.editable!.editor, history = controller.state.historyPast, read = f.holdRead(readsBeforeHold);
  const job = controller.openLayoutSession("layout"); await read.started;
  controller.setPendingInteractionInput("layout-name", true, true); controller = f.render();
  const pendingRevision = controller.pendingInputRevision;
  read.release(); assert.equal(await job, false); controller = f.render();
  assert.equal(controller.state.layout, null); assert.equal(controller.state.presentation.mode, "layout");
  assert.equal(controller.state.editable!.editor, editor); assert.equal(controller.state.historyPast, history);
  assert.equal(controller.pendingInput("layout-name"), true); assert.equal(controller.pendingInputRevision, pendingRevision);
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0); assert.equal(f.workspace.layoutSessions!.find(entry => entry.id === "layout")!.document, storedBytes);
});

test("same-field saved Layout still opens with dirty hidden Design and preserves its exact input, caret and editor history", async t => {
  const f = fixture(t); let controller = await f.openDesign();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Unsaved retained Design name" } })); controller = f.render();
  const raw = retainRaw(controller); raw.set(" 120' unfinished \" ");
  controller.inputs.recordFocus(raw.key); controller.inputs.recordSelection(raw.key, { start: 2, end: 6 }); controller = f.render();
  const before = controller.stateRef.current, workspace = f.workspace, inputRevision = controller.inputs.getRevision(), target = savedLayout(f);
  assert.equal(await controller.openLayoutSession("layout"), true); controller = f.render();
  assert.equal(controller.state.presentation.mode, "layout"); assert.equal(controller.state.layout!.session.id, "layout");
  assert.equal(controller.state.layout!.session.targetDocument, target.targetDocument); assert.equal(controller.state.layout!.session.targetHash, target.targetHash);
  assert.equal(controller.state.editable!.editor, before.editable!.editor); assert.equal(controller.state.historyPast, before.historyPast); assert.equal(controller.state.historyFuture, before.historyFuture);
  assert.equal(controller.state.savedState, "unsaved"); assert.equal(controller.inputs.getRevision(), inputRevision); assert.equal(controller.inputs.hasDirty(), true);
  assert.deepEqual(controller.inputs.read(raw.key, raw.baseline), { text: " 120' unfinished \" ", spans: ["120", "130"] });
  assert.deepEqual(controller.inputs.retainedFocus(), { key: raw.key, selection: { start: 2, end: 6 } });
  assert.equal(f.workspace, workspace); assert.equal(f.writes.length, 0);
});

test("retained Layout Copy callback refuses an active Export synchronously before any rerender", async t => {
  const f = fixture(t); await f.openDesign(); const controller = await f.openLayout();
  const retainedCopy = controller.copyLayout, before = f.workspace, target = savedLayout(f), read = f.holdRead();
  const exportJob = controller.exportLayoutSession("json"); await read.started;
  const reads = f.reads;
  assert.equal(await retainedCopy("Must not exist"), null);
  assert.equal(f.reads, reads, "retained Copy must not start a second read"); assert.equal(f.writes.length, 0); assert.equal(f.workspace, before);
  read.release(); assert.equal((await exportJob).ok, true);
  const next = f.render(); assert.equal(next.busy, false); assert.equal(f.writes.length, 0); assert.equal(f.workspace, before); assert.equal(f.exports.length, 1);
  assert.deepEqual(parseLayoutSessionDocument(f.exports[0].bytes as string), target);
});

for (const returnToDesign of [false, true]) test(`initial stale Design Export refuses before saving dirty managed Field after ${returnToDesign ? "mode ABA" : "entering Layout"}`, async t => {
  const f = fixture(t);
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "editable-field", waterSourceId: "editable-water", powerSourceId: "editable-power" }).field;
  f.workspace = applyWorkspaceCommand(f.workspace, { type: "create_field_design", now, designId: "managed-field", fieldMapId: "map", name: field.name, field }).workspace;
  let controller = f.render(); assert.equal(await controller.openDesign("managed-field"), true); controller = f.render();
  assert.equal(await controller.openLayoutSession("layout"), true); controller = f.render();
  controller.selectMode("design"); controller = f.render();
  assert(controller.dispatch({ kind: "field", action: { type: "rename", name: "Unsaved applied Field name" } })); controller = f.render();
  assert.equal(controller.state.editable!.kind, "field"); assert.equal(controller.state.savedState, "unsaved");
  const editor = controller.state.editable!.editor, historyPast = controller.state.historyPast, historyFuture = controller.state.historyFuture;
  assert(editor.past.length > 0, "fixture must contain actual unsaved editor history");
  const retainedExport = controller.exportDesignWorkspace, workspace = f.workspace, workspaceBytes = JSON.stringify(f.workspace), revision = f.workspace.revision;
  const target = controller.state.layout!.session;
  controller.selectMode("layout"); controller = f.render();
  if (returnToDesign) { controller.selectMode("design"); controller = f.render(); }
  const reads = f.reads;
  const result = await retainedExport("json"); assert.equal(result.ok, false); controller = f.render();
  assert.equal(f.reads, reads, "an initially retired export must refuse before repository access");
  assert.equal(f.writes.length, 0); assert.equal(f.exports.length, 0); assert.equal(f.workspace, workspace);
  assert.equal(f.workspace.revision, revision); assert.equal(JSON.stringify(f.workspace), workspaceBytes);
  assert.equal(controller.state.editable!.editor, editor); assert.equal(controller.state.historyPast, historyPast); assert.equal(controller.state.historyFuture, historyFuture);
  assert.equal(controller.state.savedState, "unsaved"); assert.equal(controller.state.notice, null); assert.equal(controller.autosaveFailure, null);
  assert.equal(controller.layoutSaveState, "saved"); assert.equal(controller.state.layout!.session, target); assert.equal(controller.saving, false); assert.equal(controller.busy, false);
});

function packageWorkspace(version: 1 | 2 | 3 | 4): WorkspaceDocument {
  const v4 = workspaceFixture();
  if (version === 4) return v4;
  const v3 = JSON.parse(v4.originalSurveyUpgradeDocument!) as WorkspaceDocument;
  if (version === 3) return v3;
  const v1 = JSON.parse(v3.originalPreviousWorkspaceDocument!) as WorkspaceDocument;
  return version === 1 ? v1 : applyWorkspaceCommand(v1, { type: "upgrade_workspace_to_v2", now }).workspace;
}
function packageReview(f: ControllerFixture, isCurrent: () => boolean = () => true) {
  return { expectedWorkspaceRevision: f.workspace.revision, isCurrent };
}
function packageOperation(controller: Controller, operation: "prepare" | "import", bundle: DesignWorkspaceBundle,
  fieldMapId: string, review: ReturnType<typeof packageReview>) {
  return operation === "prepare" ? controller.preparePackageStorageStep(bundle, fieldMapId, review)
    : controller.importDesignWorkspace(bundle, fieldMapId, review);
}
function assertPackageUnchanged(f: ControllerFixture, before: WorkspaceDocument, bytes = JSON.stringify(before)) {
  assert.equal(f.workspace, before); assert.equal(JSON.stringify(f.workspace), bytes);
  assert.equal(f.workspace.revision, before.revision); assert.equal(f.workspace.workspaceVersion, before.workspaceVersion);
  assert.equal(f.writes.length, 0, "refused preparation/import must not partially upgrade or import");
}

for (const version of [1, 2, 3, 4] as const) test(`explicit package preparation acknowledges exactly one step from v${version}`, async t => {
  const f = fixture(t); f.workspace = packageWorkspace(version);
  const before = f.workspace, bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design"), controller = f.render();
  const receipt = await controller.preparePackageStorageStep(bundle, "map", packageReview(f));
  const nextVersion = version <= 2 ? "cplayout-workspace-v3" : "cplayout-workspace-v4";
  assert.deepEqual(receipt, { workspaceRevision: before.revision + (version === 4 ? 0 : 1), workspaceVersion: nextVersion });
  assert.equal(f.writes.length, version === 4 ? 0 : 1);
  if (version === 4) assertPackageUnchanged(f, before);
  else {
    assert.equal(f.writes[0].type, version <= 2 ? "upgrade_workspace_to_v3" : "upgrade_workspace_to_v4");
    assert.equal(version <= 2 ? f.workspace.originalPreviousWorkspaceDocument : f.workspace.originalSurveyUpgradeDocument, JSON.stringify(before));
    assert.deepEqual(f.workspace.catalog, before.catalog); assert.deepEqual(f.workspace.draftDocuments, before.draftDocuments);
    assert.equal(f.workspace.catalog.designs.length, before.catalog.designs.length, "preparation creates no imported copy");
    if (version <= 2) assert.equal(f.workspace.surveyCollections, undefined, "second preparation is separately acknowledged");
    else assert.deepEqual(f.workspace.surveyCollections, []);
  }
});

for (const version of [1, 2, 3] as const) test(`strict package Import refuses v${version} without any implicit upgrade`, async t => {
  const f = fixture(t); f.workspace = packageWorkspace(version); const before = f.workspace;
  const bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design"), controller = f.render();
  await assert.rejects(controller.importDesignWorkspace(bundle, "map", packageReview(f)), /Prepare storage/);
  assertPackageUnchanged(f, before);
});

for (const operation of ["prepare", "import"] as const) for (const version of [1, 2, 3, 4] as const)
  test(`wrong-CRS ${operation} from v${version} preserves the exact workspace and storage version`, async t => {
    const f = fixture(t); f.workspace = packageWorkspace(version);
    f.workspace = applyWorkspaceCommand(f.workspace, { type: "create_project_with_initial_field_map", now,
      input: { clientId: "customer", projectId: "foreign-project", projectName: "Other CRS", projectCrs: "EPSG:3857", unitSystem: "metric", fieldMapId: "foreign-map" } }).workspace;
    const before = f.workspace, controller = f.render(), bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design");
    await assert.rejects(packageOperation(controller, operation, bundle, "foreign-map", packageReview(f)), /CRS must exactly match/);
    assertPackageUnchanged(f, before);
  });

for (const operation of ["prepare", "import"] as const) for (const refusal of ["missing destination", "review revision", "retired review"] as const)
  test(`${operation} refuses ${refusal} before any version or record mutation`, async t => {
    const f = fixture(t); f.workspace = packageWorkspace(operation === "prepare" ? 3 : 4);
    const before = f.workspace, controller = f.render(), bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design");
    const review = packageReview(f, () => refusal !== "retired review");
    if (refusal === "review revision") review.expectedWorkspaceRevision--;
    await assert.rejects(packageOperation(controller, operation, bundle, refusal === "missing destination" ? "missing-map" : "map", review));
    assertPackageUnchanged(f, before);
  });

for (const operation of ["prepare", "import"] as const) test(`${operation} quota refusal preserves version, exact records and dirty raw input`, async t => {
  const f = fixture(t); f.workspace = packageWorkspace(operation === "prepare" ? 3 : 4);
  let controller = await f.openDesign(); const raw = retainRaw(controller); raw.set(" unfinished package review "); controller = f.render();
  const before = f.workspace, editor = controller.state.editable!.editor, bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design");
  f.quotaError = new Error("Quota exceeded for package command");
  await assert.rejects(packageOperation(controller, operation, bundle, "map", packageReview(f)), /Quota exceeded/);
  controller = f.render(); assertPackageUnchanged(f, before); assert.equal(controller.state.editable!.editor, editor);
  assert.equal(controller.inputs.read(raw.key, raw.baseline).text, " unfinished package review "); assert.equal(controller.inputs.hasDirty(), true);
});

for (const operation of ["prepare", "import"] as const) for (const stage of ["initial read", "locked callback"] as const)
  test(`${operation} refuses retired UI review after ${stage}, including destination/file ABA`, async t => {
    const f = fixture(t); f.workspace = packageWorkspace(operation === "prepare" ? 3 : 4);
    const controller = f.render(), bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design"), before = f.workspace;
    let reviewEpoch = 0; const review = packageReview(f, () => reviewEpoch === 0);
    if (stage === "locked callback") {
      f.beforeWrite = async () => { reviewEpoch++; reviewEpoch++; }; // A -> B -> A remains a newer review.
      await assert.rejects(packageOperation(controller, operation, bundle, "map", review), /retired|stale|changed/i);
    } else {
      const held = f.holdRead(); const job = packageOperation(controller, operation, bundle, "map", review); await held.started;
      reviewEpoch++; reviewEpoch++; held.release(); await assert.rejects(job, /retired|stale|changed|cancel/i);
    }
    assertPackageUnchanged(f, before); assert.equal(f.render().busy, false);
  });

for (const operation of ["prepare", "import"] as const) test(`${operation} captured callback refuses workspace mode ABA`, async t => {
  const f = fixture(t); f.workspace = packageWorkspace(operation === "prepare" ? 3 : 4);
  const controller = f.render(), bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design"), before = f.workspace;
  const review = packageReview(f), held = f.holdRead(); const job = packageOperation(controller, operation, bundle, "map", review);
  await held.started; controller.selectMode("survey"); f.render().selectMode("design"); f.render();
  held.release(); await assert.rejects(job, /retired|stale|changed|cancel/i);
  assertPackageUnchanged(f, before); assert.equal(f.render().state.presentation.mode, "design");
});

for (const change of ["revision", "destination CRS"] as const) test(`preparation rechecks ${change} inside its sibling-command snapshot`, async t => {
  const f = fixture(t); f.workspace = packageWorkspace(3);
  const controller = f.render(), bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design"), review = packageReview(f), held = f.holdRead(1);
  const job = controller.preparePackageStorageStep(bundle, "map", review); await held.started;
  // A competing/replaced boundary receipt differs from the reviewed preflight.
  f.workspace = change === "revision" ? applyWorkspaceCommand(f.workspace, { type: "create_client", now, id: "other-customer",
    input: { primaryContactFirstName: "Other", primaryContactLastName: "Owner" } }).workspace
    : { ...f.workspace, catalog: { ...f.workspace.catalog, projects: f.workspace.catalog.projects.map(project => ({ ...project, projectCrs: "EPSG:3857" })) } };
  const changed = f.workspace; held.release(); await assert.rejects(job, change === "revision" ? /catalog changed/i : /CRS must exactly match/);
  assertPackageUnchanged(f, changed);
});

for (const operation of ["prepare", "import"] as const) test(`${operation} refuses unsupported native backend before read or write`, async t => {
  const f = fixture(t); f.workspace = packageWorkspace(3);
  f.repository.backendInfo = { ...f.repository.backendInfo!, runtime: "native", storageEngine: "sqlite" };
  const before = f.workspace, controller = f.render(), reads = f.reads, bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design");
  await assert.rejects(packageOperation(controller, operation, bundle, "map", packageReview(f)), /supported browser workspace/);
  assert.equal(f.reads, reads); assertPackageUnchanged(f, before);
});

function addPackageField(workspace: WorkspaceDocument): WorkspaceDocument {
  const field = convertPivotProjectToFieldDesign(JSON.stringify(sampleProject), { fieldId: "package-field", waterSourceId: "package-water", powerSourceId: "package-power" }).field;
  return applyWorkspaceCommand(workspace, { type: "create_field_design", now, designId: "package-source", fieldMapId: "map", name: field.name,
    field, originalProjectDocument: JSON.stringify(sampleProject) }).workspace;
}

test("acknowledged preparation then separate Import keeps source provenance, target bytes, dirty editor and raw inputs while making a distinct copy", async t => {
  const f = fixture(t); f.workspace = addPackageField(packageWorkspace(3));
  const target = savedLayout({ workspace: workspaceFixture() } as ControllerFixture);
  f.workspace = applyWorkspaceCommand(f.workspace, { type: "create_layout_session", now, sessionId: "layout", fieldMapId: "map", name: target.name, targetDocument: target.targetDocument }).workspace;
  let source = addPackageField(workspaceFixture());
  source = applyWorkspaceCommand(source, { type: "create_survey_collection", now, expectedDesignRevision: 0,
    collection: createSurveyCollection({ id: "field-survey", now, purpose: { kind: "field_boundary" },
      owner: { designId: "package-source", documentKind: "field", payloadId: "package-field", fieldMapId: "map", projectCrs: sampleProject.projectCrs } }) }).workspace;
  const bundle = buildDesignWorkspaceBundle(source, "package-source"), sourceBytes = JSON.stringify(source), bundleBytes = JSON.stringify(bundle);
  let controller = await f.openDesign();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Unsaved entered Design" } })); controller = f.render();
  const raw = retainRaw(controller); raw.set("  unfinished '  "); controller.inputs.recordFocus(raw.key); controller.inputs.recordSelection(raw.key, { start: 2, end: 8 }); controller = f.render();
  const before = f.workspace, editor = controller.state.editable!.editor, history = controller.state.historyPast, inputRevision = controller.inputs.getRevision();
  const prepared = await controller.preparePackageStorageStep(bundle, "map", packageReview(f)); controller = f.render();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].type, "upgrade_workspace_to_v4"); assert.equal(prepared.workspaceVersion, "cplayout-workspace-v4");
  assert.equal(f.workspace.originalSurveyUpgradeDocument, JSON.stringify(before)); assert.equal(f.workspace.catalog.designs.length, before.catalog.designs.length);
  assert.deepEqual(f.workspace.layoutSessions, before.layoutSessions); assert.deepEqual(f.workspace.fieldDocuments, before.fieldDocuments);
  const preparedWorkspace = f.workspace;
  const importedId = await controller.importDesignWorkspace(bundle, "map", packageReview(f)); assert(importedId); controller = f.render();
  assert.equal(f.writes.length, 2); assert.equal(f.writes[1].type, "import_design_workspace_bundle"); assert.equal(f.workspace.revision, prepared.workspaceRevision + 1);
  assert.notEqual(importedId, bundle.designId); assert.equal(f.workspace.catalog.designs.length, before.catalog.designs.length + 1);
  const imported = f.workspace.catalog.designs.find(design => design.id === importedId)!; assert.equal(imported.kind, "field");
  assert(imported.kind === "field"); assert.notEqual(imported.fieldDesignId, bundle.payloadId);
  const copiedField = f.workspace.fieldDocuments!.find(entry => entry.id === imported.fieldDesignId)!;
  assert.equal(copiedField.originalProjectDocument, bundle.originalProjectDocument);
  const collections = f.workspace.surveyCollections!.map(entry => parseSurveyCollectionDocument(entry.document));
  assert.equal(collections.length, 1); assert.equal(collections[0].owner.designId, importedId); assert.equal(collections[0].owner.payloadId, imported.fieldDesignId);
  assert.notEqual(collections[0].id, "field-survey"); assert.deepEqual(collections[0].observations, []);
  assert.deepEqual(f.workspace.layoutSessions, before.layoutSessions); assert.deepEqual(f.workspace.fieldDocuments!.filter(entry => entry.id === "package-field"), before.fieldDocuments);
  assert.deepEqual(f.workspace.draftDocuments, before.draftDocuments); assert.deepEqual(f.workspace.tombstones, before.tombstones);
  assert.equal(f.workspace.originalSurveyUpgradeDocument, preparedWorkspace.originalSurveyUpgradeDocument);
  assert.equal(JSON.stringify(source), sourceBytes); assert.equal(JSON.stringify(bundle), bundleBytes);
  assert.equal(controller.state.editable!.identity.designId, "design", "Import does not implicitly Open its saved copy");
  assert.equal(controller.state.editable!.editor, editor); assert.equal(controller.state.historyPast, history); assert.equal(controller.state.savedState, "unsaved");
  assert.equal(controller.inputs.getRevision(), inputRevision); assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "  unfinished '  ");
  assert.deepEqual(controller.inputs.retainedFocus(), { key: raw.key, selection: { start: 2, end: 8 } });
});

test("failed Import after acknowledged preparation preserves the prepared baseline and permits a separate retry", async t => {
  const f = fixture(t); f.workspace = packageWorkspace(3); const bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design");
  let controller = f.render(); const prepared = await controller.preparePackageStorageStep(bundle, "map", packageReview(f)); controller = f.render();
  const before = f.workspace, bytes = JSON.stringify(before), review = packageReview(f);
  f.quotaError = new Error("Quota exceeded during separate Import");
  await assert.rejects(controller.importDesignWorkspace(bundle, "map", review), /Quota/);
  assert.equal(f.workspace, before); assert.equal(JSON.stringify(f.workspace), bytes); assert.equal(f.workspace.workspaceVersion, prepared.workspaceVersion);
  assert.equal(f.writes.length, 1); assert.equal(f.workspace.catalog.designs.length, 1);
  f.quotaError = null; controller = f.render(); assert(await controller.importDesignWorkspace(bundle, "map", packageReview(f)));
  assert.equal(f.writes.length, 2); assert.equal(f.workspace.revision, prepared.workspaceRevision + 1);
});

function standaloneDesignCommand(workspace: WorkspaceDocument): Extract<WorkspaceCommand, { type: "import_design_document" }> {
  return { type: "import_design_document", now, fieldMapId: "map", designId: "standalone-copy", payloadId: "standalone-payload",
    document: workspace.draftDocuments.find(entry => entry.id === "draft")!.document };
}

test("strict design-only Import saves one distinct Draft without upgrading, Opening, or changing its source and dirty editor", async t => {
  const f = fixture(t); f.workspace = packageWorkspace(1); let controller = await f.openDesign();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Unsaved standalone review" } })); controller = f.render();
  const raw = retainRaw(controller); raw.set("  retained unfinished input  "); controller.inputs.recordFocus(raw.key);
  controller.inputs.recordSelection(raw.key, { start: 3, end: 8 }); controller = f.render();
  const before = f.workspace, command = standaloneDesignCommand(before), editor = controller.state.editable!.editor, history = controller.state.historyPast;
  const inputRevision = controller.inputs.getRevision(), sourceBytes = command.document;
  await controller.executeCatalog(command, packageReview(f)); controller = f.render();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].type, "import_design_document");
  assert.equal(f.workspace.workspaceVersion, before.workspaceVersion); assert.equal(f.workspace.revision, before.revision + 1);
  assert.equal(f.workspace.catalog.designs.length, before.catalog.designs.length + 1);
  const imported = f.workspace.catalog.designs.find(design => design.id === command.designId)!;
  assert.equal(imported.kind, "draft"); assert(imported.kind === "draft"); assert.equal(imported.draftId, command.payloadId);
  assert.notEqual(imported.id, "design"); assert.notEqual(imported.draftId, "draft");
  assert.equal(f.workspace.draftDocuments.find(entry => entry.id === "draft")!.document, sourceBytes);
  assert.deepEqual(f.workspace.catalog.designs.filter(design => design.id === "design"), before.catalog.designs);
  assert.deepEqual(f.workspace.projectDocuments, before.projectDocuments); assert.deepEqual(f.workspace.tombstones, before.tombstones);
  assert.equal(f.workspace.layoutSessions, undefined); assert.equal(f.workspace.surveyCollections, undefined);
  assert.equal(controller.state.editable!.identity.designId, "design"); assert.equal(controller.state.editable!.editor, editor);
  assert.equal(controller.state.historyPast, history); assert.equal(controller.state.savedState, "unsaved");
  assert.equal(controller.inputs.getRevision(), inputRevision); assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "  retained unfinished input  ");
  assert.deepEqual(controller.inputs.retainedFocus(), { key: raw.key, selection: { start: 3, end: 8 } });
});

test("strict design-only Import refuses an earlier reviewed revision without a global notice or partial mutation", async t => {
  const f = fixture(t); f.workspace = packageWorkspace(1); const controller = f.render(), before = f.workspace, review = packageReview(f);
  review.expectedWorkspaceRevision--;
  await assert.rejects(controller.executeCatalog(standaloneDesignCommand(before), review), /Saved catalog changed before this action\. Recheck the current item and destination\./);
  assertPackageUnchanged(f, before); assert.equal(f.render().state.notice, null, "strict review owns its refusal feedback");
});

test("strict design-only Import refuses retired raw-input ownership despite A to B to A and clean final values", async t => {
  const f = fixture(t); f.workspace = packageWorkspace(1); let controller = await f.openDesign(); const raw = retainRaw(controller); controller = f.render();
  const before = f.workspace, command = standaloneDesignCommand(before), epoch = controller.inputs.getRevision();
  const review = packageReview(f, () => controller.inputs.getRevision() === epoch);
  raw.set("B"); raw.set("saved"); assert.equal(controller.inputs.hasDirty(), false);
  const reads = f.reads;
  await assert.rejects(controller.executeCatalog(command, review), /no longer current/);
  assert.equal(f.reads, reads, "retired review cannot reach the repository command read"); assertPackageUnchanged(f, before);
  assert.deepEqual(controller.inputs.read(raw.key, raw.baseline), raw.baseline.value); assert.equal(f.render().state.notice, null);
});

for (const cause of ["review ABA", "workspace mode ABA"] as const) for (const stage of ["deferred read", "writer lock callback"] as const)
  test(`strict design-only Import rejects ${cause} during ${stage} and retains the exact saved source`, async t => {
    const f = fixture(t); f.workspace = packageWorkspace(1); const controller = f.render(), before = f.workspace;
    let reviewEpoch = 0; const review = packageReview(f, () => reviewEpoch === 0);
    const retire = () => {
      if (cause === "review ABA") { reviewEpoch++; reviewEpoch++; }
      else { controller.selectMode("survey"); f.render().selectMode("design"); f.render(); }
    };
    const command = standaloneDesignCommand(before);
    if (stage === "writer lock callback") {
      f.beforeWrite = async () => { retire(); };
      await assert.rejects(controller.executeCatalog(command, review), /retired|stale|changed|cancel/i);
    } else {
      const held = f.holdRead(); const job = controller.executeCatalog(command, review); await held.started;
      retire(); held.release(); await assert.rejects(job, /retired|stale|changed|cancel/i);
    }
    assertPackageUnchanged(f, before); const current = f.render(); assert.equal(current.busy, false); assert.equal(current.state.notice, null);
    assert.equal(current.state.presentation.mode, "design");
  });

test("strict design-only Import quota failure stays in its review and leaves v1 source and records exact", async t => {
  const f = fixture(t); f.workspace = packageWorkspace(1); const controller = f.render(), before = f.workspace;
  f.quotaError = new Error("Standalone import storage quota exceeded");
  await assert.rejects(controller.executeCatalog(standaloneDesignCommand(before), packageReview(f)), /storage quota exceeded/);
  assertPackageUnchanged(f, before); assert.equal(f.render().state.notice, null);
});
