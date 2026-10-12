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

import { UNIFIED_WORKSPACE_RESUME_KEY, parseUnifiedWorkspaceResume, type UnifiedWorkspaceResume } from "../navigation/unifiedWorkspaceResume";

type BaseController = ReturnType<typeof import("./useWorkspaceController")["useWorkspaceController"]>;
type LocalIntentReceipt = Readonly<{ epoch: number }>;
type ResumeDelivery = { generation: number; documentGeneration: number; intentEpoch: number;
  catalogSelection: UnifiedWorkspaceResume["catalogSelection"]; catalogVisible: boolean };
/** Frozen integration expectations; this structural assertion does not implement missing controller APIs. */
type Controller = BaseController & {
  noteUserIntent(): LocalIntentReceipt;
  acceptLocalContext(intent: LocalIntentReceipt, snapshot: UnifiedWorkspaceResume): boolean;
  restoreStartupContext(): Promise<"restored" | "fallback" | "cancelled">;
  resumePhase: "pending" | "settled";
  resumeDelivery: ResumeDelivery | null;
  isResumeDeliveryCurrent(delivery: ResumeDelivery): boolean;
};
class PreferenceBoundary {
  values = new Map<string, string>(); reads = 0; writes: { key: string; value: string }[] = [];
  getError: Error | null = null; setError: Error | null = null;
  getItem = (key: string): string | null => { this.reads++; if (this.getError) throw this.getError; return this.values.get(key) ?? null; };
  setItem = (key: string, value: string): void => { if (this.setError) throw this.setError; this.values.set(key, value); this.writes.push({ key, value }); };
  get raw() { return this.values.get(UNIFIED_WORKSPACE_RESUME_KEY) ?? null; }
  hintWrites() { return this.writes.filter(item => item.key === UNIFIED_WORKSPACE_RESUME_KEY); }
}
type Slot = { kind: string; value: any; dependencies?: readonly unknown[]; cleanup?: () => void };
let active: ControllerFixture | null = null;
let boundaryOwner: ControllerFixture | null = null;
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

/** Retained synthetic hook slots execute the actual controller and its effects.
 * Repository and optional preference I/O are simulated; commands use the real
 * WorkspaceDocument reducer. This is not mounted React, browser durability or device proof. */
class ControllerFixture {
  slots: Slot[] = []; cursor = 0; effects: (() => void)[] = []; changed = false;
  reads = 0; writes: WorkspaceCommand[] = []; exports: { filename: string; bytes: string | Uint8Array }[] = [];
  workspace = workspaceFixture(); quotaError: Error | null = null;
  ready = true; runtime: "web" | "native" = "web";
  preferences = new PreferenceBoundary(); storageGetterError: Error | null = null;
  publications: { state: BaseController["state"]; collectionId: string | null }[] = [];
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
    get backendInfo() { return boundaryOwner!.ready ? { backendLabel: "Synthetic command boundary", runtime: boundaryOwner!.runtime,
      storageEngine: boundaryOwner!.runtime === "web" ? "local_storage" : "sqlite", durable: true,
      supportsProjectList: true, supportsZipImport: true, supportsZipExport: true, notes: ["Simulated I/O; real reducer."] } : null; },
    get catalogRevision() { return boundaryOwner!.ready ? boundaryOwner!.workspace.revision : null; },
    get catalog() { return boundaryOwner!.workspace.catalog; },
    get designCatalog() { return boundaryOwner!.ready ? boundaryOwner!.workspace.catalog : null; },
    get workspaceVersion() { return boundaryOwner!.ready ? boundaryOwner!.workspace.workspaceVersion : null; },
    backendLabel: "Synthetic command boundary", storageError: null, statusMessage: "Synthetic repository ready",
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
      try { this.controller = useWorkspaceController() as Controller; } finally { active = null; }
      this.effects.forEach(effect => effect());
      if (!this.changed) return this.controller;
    }
    throw new Error("Controller fixture did not settle after twelve effect passes");
  }
  dispose() { this.slots.forEach(slot => slot.cleanup?.()); }
  api(): Controller {
    const controller = this.render();
    for (const method of ["noteUserIntent", "acceptLocalContext", "restoreStartupContext", "isResumeDeliveryCurrent"] as const)
      assert.equal(typeof controller[method], "function", `Missing frozen A2 controller API: ${method}`);
    return controller;
  }
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
  // These retained-slot tests exercise the existing isolated repository owner.
  // Authenticated provider/actor admission is tested by the real auth suites.
  useContext: () => null,
  useState<T>(initial: T | (() => T)) {
    if (!active) return React.useState(initial);
    const owner = active, slot = owner.slot("useState", () => typeof initial === "function" ? (initial as () => T)() : initial);
    return [slot.value as T, (value: T | ((old: T) => T)) => {
      const next = typeof value === "function" ? (value as (old: T) => T)(slot.value) : value;
      if (!Object.is(next, slot.value)) {
        if (next && typeof next === "object" && "presentation" in next && "editable" in next && "collections" in next)
          owner.publications.push({ state: next as unknown as BaseController["state"], collectionId: owner.controller?.getSelectedCollectionId() ?? null });
        slot.value = next; owner.changed = true;
      }
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
function fixture(t: TestContext, hint?: UnifiedWorkspaceResume | string | null) {
  const f = new ControllerFixture();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { if (f.storageGetterError) throw f.storageGetterError; return f.preferences; } });
  if (hint !== null) f.preferences.values.set(UNIFIED_WORKSPACE_RESUME_KEY, typeof hint === "string" ? hint : JSON.stringify(hint ?? dualHint(f.workspace)));
  f.preferences.values.set("unrelated-preference", "retain exactly");
  t.after(() => { f.dispose(); if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else Reflect.deleteProperty(globalThis, "localStorage"); });
  return f;
}
function retainRaw(controller: Controller) {
  const baseline = createInputRetentionBaseline({ text: "saved", spans: ["120", "130"] });
  controller.inputs.reconcile("design/raw", baseline);
  return { baseline, key: "design/raw", set: (text: string) => controller.inputs.set("design/raw", baseline, { text, spans: ["120", "130"] }) };
}
function savedLayout(f: ControllerFixture): LayoutSession { return parseLayoutSessionDocument(f.workspace.layoutSessions!.find(item => item.id === "layout")!.document); }

function dualHint(workspace: WorkspaceDocument): UnifiedWorkspaceResume {
  const layout = parseLayoutSessionDocument(workspace.layoutSessions!.find(entry => entry.id === "layout")!.document);
  return { version: 2, catalogVisible: true,
    catalogSelection: { clientId: "customer", projectId: "project", fieldMapId: "map", designId: "design" },
    workspace: { mode: "survey", design: { designId: "design", documentKind: "draft", payloadId: "draft", fieldMapId: "map", projectCrs: sampleProject.projectCrs },
      layout: { sessionId: "layout", fieldMapId: "map", projectCrs: sampleProject.projectCrs, targetHash: layout.targetHash }, collectionId: "survey" } };
}
function snapshot(controller: Controller, catalogSelection = dualHint(workspaceFixture()).catalogSelection, catalogVisible = false): UnifiedWorkspaceResume {
  const editable = controller.stateRef.current.editable, layout = controller.stateRef.current.layout?.session;
  return { version: 2, catalogVisible, catalogSelection: { ...catalogSelection }, workspace: {
    mode: controller.stateRef.current.presentation.mode,
    design: editable?.identity.designId && editable.identity.fieldMapId ? { designId: editable.identity.designId,
      documentKind: editable.kind, payloadId: editable.identity.payloadId, fieldMapId: editable.identity.fieldMapId, projectCrs: editable.identity.projectCrs } : null,
    layout: layout ? { sessionId: layout.id, fieldMapId: layout.fieldMapId, projectCrs: sampleProject.projectCrs, targetHash: layout.targetHash } : null,
    collectionId: controller.getSelectedCollectionId() } };
}
async function restore(f: ControllerFixture) { const controller = f.api(); const result = await controller.restoreStartupContext(); return { result, controller: f.api() }; }
function assertNoStorageMutation(f: ControllerFixture, before: WorkspaceDocument, raw: string | null) {
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0); assert.equal(f.preferences.raw, raw);
  assert.equal(f.preferences.hintWrites().length, 0); assert.equal(f.preferences.values.get("unrelated-preference"), "retain exactly");
}

// These tests exercise the real controller; missing API is a baseline failure, not a skipped feature.
test("startup publishes Design, Layout, collection and final mode once, then immediate Save uses its installed receipt", async t => {
  const f = fixture(t), before = f.workspace, original = f.preferences.raw, hint = dualHint(before); const controller = f.api();
  assert.equal(controller.resumePhase, "pending"); assert.equal(f.preferences.hintWrites().length, 0);
  const result = await controller.restoreStartupContext(); const restored = f.api();
  assert.equal(result, "restored"); assert.equal(restored.resumePhase, "settled"); assert.equal(f.publications.length, 1);
  const publication = f.publications[0]; assert.equal(publication.state.presentation.mode, "survey");
  assert.equal(publication.state.editable!.identity.designId, "design"); assert.equal(publication.state.layout!.session.id, "layout");
  assert.equal(publication.state.collections.length, 1); assert.equal(publication.collectionId, "survey", "collection ref must precede final publication");
  assert.equal(restored.state.layout!.session.targetDocument, savedLayout(f).targetDocument); assert.equal(restored.state.layout!.session.targetHash, hint.workspace.layout!.targetHash);
  assert.equal(restored.state.editable!.workspaceRevision, before.revision); assert.equal(restored.state.layout!.persistenceRevision, before.revision);
  assert.equal(restored.receiver.getSnapshot().phase, "idle"); assert.equal(restored.receiver.getSnapshot().sessionId, null);
  assert(restored.resumeDelivery); assert.equal(restored.isResumeDeliveryCurrent(restored.resumeDelivery), true);
  assert.deepEqual(restored.resumeDelivery.catalogSelection, hint.catalogSelection); assert.equal(restored.resumeDelivery.catalogVisible, true);
  assertNoStorageMutation(f, before, original);
  restored.selectMode("design"); const editable = f.api();
  assert(editable.dispatch({ kind: "draft", action: { type: "rename", name: "Acknowledged restored Draft" } }));
  assert.equal(await f.api().save(), true); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].type, "save_design_draft");
  assert.equal(f.api().state.savedState, "saved"); assert.equal(f.api().state.editable!.workspaceRevision, f.workspace.revision);
  assert.equal(f.preferences.raw, original, "domain Save does not receive context preference authority");
});

test("pre-initialization operator intent cancels startup before preference or workspace reads", async t => {
  const f = fixture(t); f.ready = false; const controller = f.api(), before = f.workspace, raw = f.preferences.raw;
  assert.equal(controller.resumePhase, "pending"); controller.noteUserIntent(); controller.selectMode("design");
  f.ready = true; const ready = f.api(); assert.equal(await ready.restoreStartupContext(), "cancelled");
  assert.equal(f.reads, 0); assert.equal(f.preferences.reads, 0); assertNoStorageMutation(f, before, raw);
});

for (const action of ["same mode", "mode ABA", "raw ABA", "visibility ABA", "explicit Open", "failed Open", "unmount"] as const)
  test(`deferred startup cancellation after ${action} preserves exact operator state and old hint`, async t => {
    const f = fixture(t), controller = f.api(), before = f.workspace, raw = f.preferences.raw, held = f.holdRead();
    const job = controller.restoreStartupContext(); await held.started;
    if (action === "unmount") f.dispose();
    else {
      controller.noteUserIntent();
      if (action === "same mode") controller.selectMode("design");
      if (action === "mode ABA") { controller.selectMode("survey"); f.api().selectMode("design"); }
      if (action === "raw ABA") { const inputs = retainRaw(controller); inputs.set("B"); controller.noteUserIntent(); inputs.set("saved"); assert.equal(controller.inputs.hasDirty(), false); }
      if (action === "visibility ABA") controller.noteUserIntent();
      if (action === "explicit Open") assert.equal(await f.api().openDesign("design"), true);
      if (action === "failed Open") assert.equal(await f.api().openDesign("missing-design"), false);
    }
    const operatorState = controller.stateRef.current, inputsRevision = controller.inputs.getRevision();
    held.release(); assert.equal(await job, "cancelled");
    assert.equal(controller.stateRef.current, operatorState); assert.equal(controller.inputs.getRevision(), inputsRevision);
    assertNoStorageMutation(f, before, raw);
    if (action !== "unmount") assert.equal(f.api().resumePhase, "settled");
  });

test("external raw-hint drift during startup cancels publication and preserves the newer exact bytes", async t => {
  const f = fixture(t), controller = f.api(), before = f.workspace, held = f.holdRead(); const job = controller.restoreStartupContext(); await held.started;
  const newer = JSON.stringify({ ...dualHint(before), catalogVisible: false }); f.preferences.values.set(UNIFIED_WORKSPACE_RESUME_KEY, newer);
  const state = controller.stateRef.current; held.release(); assert.equal(await job, "cancelled");
  assert.equal(controller.stateRef.current, state); assert.equal(f.api().resumeDelivery, null); assertNoStorageMutation(f, before, newer);
});

for (const kind of ["absent", "invalid", "deleted"] as const) test(`${kind} startup hint falls back without writing an empty replacement`, async t => {
  const f = fixture(t, kind === "absent" ? null : kind === "invalid" ? "{ broken retained hint" : undefined);
  if (kind === "deleted") {
    const hint = dualHint(f.workspace); hint.workspace.design!.designId = "deleted-design"; hint.workspace.layout = null; hint.workspace.collectionId = null;
    hint.catalogSelection.designId = "deleted-design"; f.preferences.values.set(UNIFIED_WORKSPACE_RESUME_KEY, JSON.stringify(hint));
  }
  const before = f.workspace, raw = f.preferences.raw; const { result, controller } = await restore(f);
  assert.equal(result, "fallback"); assert.equal(controller.resumePhase, "settled"); assert.equal(controller.state.editable, null); assert.equal(controller.state.layout, null);
  assertNoStorageMutation(f, before, raw);
  if (kind === "deleted") { assert(controller.resumeDelivery); assert.equal(controller.resumeDelivery.catalogVisible, true); assert.equal(controller.resumeDelivery.catalogSelection.designId, null); }
});

test("archived target-only Layout restores read-only with exact target and disconnected receiver", async t => {
  const f = fixture(t); const layout = savedLayout(f);
  f.workspace = applyWorkspaceCommand(f.workspace, { type: "archive_layout_session", now, sessionId: "layout", expectedSessionRevision: layout.revision, archived: true }).workspace;
  const hint = dualHint(f.workspace); hint.workspace.mode = "layout"; hint.workspace.design = null; hint.workspace.collectionId = null; hint.catalogVisible = false;
  f.preferences.values.set(UNIFIED_WORKSPACE_RESUME_KEY, JSON.stringify(hint)); const before = f.workspace, raw = f.preferences.raw;
  const { result, controller } = await restore(f); assert.equal(result, "restored"); assert.equal(controller.state.presentation.mode, "layout");
  assert.equal(controller.state.editable, null); assert.equal(controller.state.layout!.session.archived, true);
  assert.equal(controller.state.layout!.session.targetDocument, layout.targetDocument); assert.equal(controller.state.layout!.session.targetHash, layout.targetHash);
  assert.equal(controller.receiver.getSnapshot().phase, "idle"); assert.equal(controller.receiver.getSnapshot().config, null); assertNoStorageMutation(f, before, raw);
});

test("accepted Catalog Browse changes only its hint selection and visibility, never the open Design or Layout", async t => {
  const f = fixture(t); let { controller } = await restore(f); const state = controller.stateRef.current, before = f.workspace;
  const browse = { clientId: "customer", projectId: null, fieldMapId: null, designId: null };
  const intent = controller.noteUserIntent(), receipt = snapshot(controller, browse, true);
  assert.equal(controller.acceptLocalContext(intent, receipt), true); controller = f.api();
  assert.equal(controller.stateRef.current, state); assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
  const stored = parseUnifiedWorkspaceResume(f.preferences.raw!); assert.deepEqual(stored.catalogSelection, browse);
  assert.equal(stored.workspace.design!.designId, "design"); assert.equal(stored.workspace.layout!.sessionId, "layout"); assert.equal(stored.catalogVisible, true);
  assert.equal(f.preferences.hintWrites().length, 1);
  assert.equal(controller.acceptLocalContext(intent, receipt), true); assert.equal(f.preferences.hintWrites().length, 1, "unchanged accepted context is deduplicated");
  receipt.catalogSelection.clientId = "caller-mutated"; receipt.workspace.design!.designId = "caller-mutated";
  assert.deepEqual(parseUnifiedWorkspaceResume(f.preferences.raw!), stored, "accepted snapshot is detached from caller mutations");
});

test("retired, forged and source-inconsistent context receipts cannot publish hints or remain valid deliveries", async t => {
  const f = fixture(t), { controller } = await restore(f), raw = f.preferences.raw, delivery = controller.resumeDelivery!;
  const old = controller.noteUserIntent(), current = controller.noteUserIntent(); assert.notEqual(old, current); assert(current.epoch > old.epoch);
  assert.equal(controller.acceptLocalContext(old, snapshot(controller)), false);
  assert.equal(controller.acceptLocalContext({ epoch: current.epoch }, snapshot(controller)), false, "epoch equality is not token ownership");
  const foreign = snapshot(controller); foreign.workspace.design!.designId = "foreign-design";
  assert.equal(controller.acceptLocalContext(current, foreign), false);
  assert.equal(controller.isResumeDeliveryCurrent(delivery), false); assert.equal(f.preferences.raw, raw); assert.equal(f.preferences.hintWrites().length, 0);
});

test("failed Open after restoration leaves the preexisting hint byte-exact and gives no context-write receipt", async t => {
  const f = fixture(t), { controller } = await restore(f), raw = f.preferences.raw, before = f.workspace;
  controller.noteUserIntent(); assert.equal(await controller.openDesign("missing-design"), false); f.api();
  assertNoStorageMutation(f, before, raw); assert.equal(f.api().state.editable!.identity.designId, "design");
});

test("age ticks and a delayed ordinary Save cannot overwrite a newer accepted Browse context", async t => {
  const f = fixture(t); let { controller } = await restore(f); controller.selectMode("design"); controller = f.api();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Delayed saved work" } })); controller = f.api();
  let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; }); f.beforeWrite = async () => { entered(); await wait; };
  const saving = controller.save(); await started; controller = f.api();
  const intent = controller.noteUserIntent(), browse = snapshot(controller, { clientId: "customer", projectId: null, fieldMapId: null, designId: null }, true);
  assert.equal(controller.acceptLocalContext(intent, browse), true); const raw = f.preferences.raw, writes = f.preferences.hintWrites().length;
  release(); assert.equal(await saving, true); controller = f.api(); assert.equal(controller.state.savedState, "saved");
  await new Promise(resolve => setTimeout(resolve, 225)); f.api();
  assert.equal(f.preferences.raw, raw); assert.equal(f.preferences.hintWrites().length, writes); assert.equal(controller.receiver.getSnapshot().phase, "idle");
});

for (const failure of ["storage getter", "getItem", "setItem quota"] as const) test(`optional preference ${failure} cannot poison an acknowledged domain Save`, async t => {
  const f = fixture(t); let { controller } = await restore(f); controller.selectMode("design"); controller = f.api();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: `Saved despite ${failure}` } })); controller = f.api();
  if (failure === "storage getter") f.storageGetterError = new Error("Optional preference getter unavailable");
  if (failure === "getItem") f.preferences.getError = new Error("Optional preference read unavailable");
  if (failure === "setItem quota") f.preferences.setError = new Error("Optional preference quota exceeded");
  const intent = controller.noteUserIntent(); assert.doesNotThrow(() => controller.acceptLocalContext(intent, snapshot(controller, undefined, true)));
  assert.equal(await controller.save(), true); controller = f.api(); assert.equal(controller.state.savedState, "saved");
  assert.equal(controller.autosaveFailure, null); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].type, "save_design_draft");
});

test("unsupported native startup settles without workspace or preference reads and without preference writes", async t => {
  const f = fixture(t); f.runtime = "native"; const before = f.workspace, raw = f.preferences.raw;
  const { result, controller } = await restore(f); assert.equal(result, "fallback"); assert.equal(controller.resumePhase, "settled");
  assert.equal(f.reads, 0); assert.equal(f.preferences.reads, 0); assert.equal(controller.state.editable, null); assert.equal(controller.resumeDelivery, null);
  assert.equal(controller.acceptLocalContext(controller.noteUserIntent(), snapshot(controller)), false); assertNoStorageMutation(f, before, raw);
});

test("actual createResumeSnapshot retains the Layout target CRS and admits a matching accepted context", async t => {
  const f = fixture(t), { controller } = await restore(f);
  const browse = { clientId: "customer", projectId: null, fieldMapId: null, designId: null };
  const intent = controller.noteUserIntent(), actual = controller.createResumeSnapshot(browse, true);
  const target = require("@cplayout/core").parseFieldLayoutTarget(controller.state.layout!.session.targetDocument);
  assert.equal(actual.workspace.layout!.projectCrs, target.field.projectCrs);
  assert.equal(actual.workspace.layout!.targetHash, controller.state.layout!.session.targetHash);
  assert.equal(actual.workspace.design!.designId, "design"); assert.equal(actual.workspace.collectionId, "survey");
  assert.equal(controller.acceptLocalContext(intent, actual), true);
  assert.deepEqual(parseUnifiedWorkspaceResume(f.preferences.raw!), actual); assert.equal(f.writes.length, 0);
});

test("actual raw-input setters cancel deferred startup through ABA without any manual noteUserIntent call", async t => {
  const f = fixture(t), controller = f.api(), raw = retainRaw(controller), before = f.workspace, hint = f.preferences.raw;
  const held = f.holdRead(), job = controller.restoreStartupContext(); await held.started;
  const state = controller.stateRef.current;
  raw.set("B"); raw.set("saved"); assert.equal(controller.inputs.hasDirty(), false);
  const receipt = controller.getLocalIntentReceipt(); assert(receipt); assert(receipt.epoch >= 2);
  const revision = controller.inputs.getRevision(); held.release(); assert.equal(await job, "cancelled");
  assert.equal(controller.stateRef.current, state); assert.equal(controller.inputs.getRevision(), revision);
  assert.deepEqual(controller.inputs.read(raw.key, raw.baseline), raw.baseline.value); assertNoStorageMutation(f, before, hint);
});

test("input reconciliation and resets during a deferred startup do not invent operator intent", async t => {
  const f = fixture(t), controller = f.api(), before = f.workspace, hint = f.preferences.raw, held = f.holdRead();
  const job = controller.restoreStartupContext(); await held.started;
  const baseline = createInputRetentionBaseline({ text: "rendered source" });
  const revision = controller.inputs.getRevision(); controller.inputs.reconcile("design/rendered", baseline);
  controller.inputs.resetScope("design"); controller.inputs.reset();
  assert(controller.inputs.getRevision() > revision, "bookkeeping must actually emit changed snapshots");
  assert.equal(controller.getLocalIntentReceipt(), null); held.release(); assert.equal(await job, "restored");
  assert.equal(f.api().state.editable!.identity.designId, "design"); assertNoStorageMutation(f, before, hint);
});

test("markClean, source reconciliation and resets preserve the exact current operator token", async t => {
  const f = fixture(t), controller = f.api(), raw = retainRaw(controller);
  raw.set("actual edited input"); assert(controller.inputs.hasDirty()); const intent = controller.getLocalIntentReceipt(); assert(intent);
  const revision = controller.inputs.getRevision(); controller.inputs.markClean(raw.key);
  assert.equal(controller.inputs.hasDirty(), false); assert(controller.inputs.getRevision() > revision);
  assert.equal(controller.getLocalIntentReceipt(), intent, "accepted input acknowledgement is bookkeeping");
  controller.inputs.reconcile(raw.key, createInputRetentionBaseline({ text: "new acknowledged source", spans: ["120", "130"] }));
  assert.equal(controller.getLocalIntentReceipt(), intent);
  controller.inputs.resetScope("design"); controller.inputs.reset(); assert.equal(controller.getLocalIntentReceipt(), intent);
  assert.equal(f.preferences.hintWrites().length, 0);
});

test("known native backend with null catalog revision settles unsupported before all reads", async t => {
  const f = fixture(t); f.runtime = "native";
  Object.defineProperty(f.repository, "catalogRevision", { configurable: true, get: () => null });
  const before = f.workspace, raw = f.preferences.raw, { result, controller } = await restore(f);
  assert.equal(result, "fallback"); assert.equal(controller.resumePhase, "settled");
  assert.equal(f.reads, 0); assert.equal(f.preferences.reads, 0); assert.equal(controller.resumeDelivery, null);
  assertNoStorageMutation(f, before, raw);
});

function externalCatalogChange(f: ControllerFixture, kind: "deleted" | "moved") {
  f.workspace = applyWorkspaceCommand(f.workspace, kind === "deleted" ? { type: "archive_and_delete_design", now, designId: "design", expectedDesignRevision: 0,
    collectionIds: [{ id: "survey", expectedRevision: 0 }] }
    : { type: "move_project_to_client", now, projectId: "project", clientId: "destination-customer" }).workspace;
}
function addResumeReviewCustomers(f: ControllerFixture) {
  for (const id of ["destination-customer", "browse-customer"]) f.workspace = applyWorkspaceCommand(f.workspace, { type: "create_client", now, id,
    input: { primaryContactFirstName: id, primaryContactLastName: "Synthetic" } }).workspace;
}
for (const change of ["deleted", "moved"] as const) for (const known of ["stale", "fresh"] as const) for (const browse of ["empty", "unrelated"] as const)
  test(`${known} acknowledged bytes cannot let ${browse} Browse hide a ${change} active Design pointer`, async t => {
    const f = fixture(t); addResumeReviewCustomers(f); let { controller } = await restore(f);
    const oldIdentity = controller.state.editable!.identity, raw = f.preferences.raw; externalCatalogChange(f, change); controller = f.api();
    assert(f.repository.catalogRevision! > controller.state.editable!.workspaceRevision!);
    if (change === "moved") {
      assert.equal(f.workspace.catalog.projects.find(project => project.id === "project")!.clientId, "destination-customer");
      assert.equal(oldIdentity.clientId, "customer", "retained editor still belongs to its preceding ancestry");
    } else assert.equal(f.workspace.catalog.designs.some(design => design.id === "design"), false);
    if (known === "fresh") {
      assert.equal(await controller.openDesign("missing-design"), false, "failed read caches the actual new durable snapshot without replacing the editor"); controller = f.api();
    }
    const intent = controller.noteUserIntent(), selection = { clientId: browse === "empty" ? null : "browse-customer", projectId: null, fieldMapId: null, designId: null };
    const candidate = controller.createResumeSnapshot(selection, true);
    assert.equal(candidate.workspace.design!.designId, "design", "the independent active pointer remains in the candidate");
    assert.equal(controller.acceptLocalContext(intent, candidate), false);
    assert.equal(controller.stateRef.current.editable!.identity, oldIdentity); assert.equal(f.preferences.raw, raw);
    assert.equal(f.preferences.hintWrites().length, 0); assert.equal(f.writes.length, 0);
  });

test("subject-free Browse after fallback can use the fresh catalog without inventing a durable subject receipt", async t => {
  const f = fixture(t, null); addResumeReviewCustomers(f); const { result, controller } = await restore(f); assert.equal(result, "fallback");
  const selection = { clientId: "browse-customer", projectId: null, fieldMapId: null, designId: null };
  const intent = controller.noteUserIntent(), candidate = controller.createResumeSnapshot(selection, true);
  assert.equal(candidate.workspace.design, null); assert.equal(candidate.workspace.layout, null); assert.equal(candidate.workspace.collectionId, null);
  assert.equal(controller.acceptLocalContext(intent, candidate), true); assert.deepEqual(parseUnifiedWorkspaceResume(f.preferences.raw!), candidate);
  assert.equal(f.reads, 0); assert.equal(f.writes.length, 0);
});

test("late successful Save after newer intent cannot mint an accepted context transition or rewrite its Browse hint", async t => {
  const f = fixture(t); let { controller } = await restore(f); controller.selectMode("design"); controller = f.api();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Late admitted Save" } })); controller = f.api();
  let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; }); f.beforeWrite = async () => { entered(); await pending; };
  const saving = controller.save(); await started; controller = f.api(); const sequence = controller.acceptedContextSequence;
  const intent = controller.noteUserIntent(), browse = controller.createResumeSnapshot({ clientId: "customer", projectId: null, fieldMapId: null, designId: null }, true);
  assert.equal(controller.acceptLocalContext(intent, browse), true); const raw = f.preferences.raw, writes = f.preferences.hintWrites().length;
  assert.equal(controller.getAcceptedContextTransition(), null); release(); assert.equal(await saving, true); controller = f.api();
  assert.equal(controller.state.savedState, "saved"); assert.equal(controller.getLocalIntentReceipt(), intent);
  assert.equal(controller.acceptedContextSequence, sequence); assert.equal(controller.getAcceptedContextTransition(), null);
  assert.equal(f.preferences.raw, raw); assert.equal(f.preferences.hintWrites().length, writes); assert.equal(f.writes.length, 1);
});

test("reviewed Catalog move carries one uninterrupted Layout then Design close through the original callback", async t => {
  const f = fixture(t, null); addResumeReviewCustomers(f);
  await f.openDesign(); await f.openLayout();
  const controller = f.api(), before = f.workspace;
  assert.equal(controller.closeLayout({ ignorePendingInputKeys: ["catalog"] }), true);
  assert.equal(controller.closeDesign({ ignorePendingInputKeys: ["catalog"] }), true);
  await controller.executeCatalog({ type: "move_project_to_client", projectId: "project", clientId: "destination-customer", now },
    { expectedWorkspaceRevision: before.revision, isCurrent: () => true });
  assert.equal(f.writes.length, 1);
  assert.equal(f.workspace.catalog.projects.find(item => item.id === "project")!.clientId, "destination-customer");
  assert.deepEqual(f.workspace.draftDocuments, before.draftDocuments);
  assert.deepEqual(f.workspace.layoutSessions, before.layoutSessions);
  assert.deepEqual(f.workspace.surveyCollections, before.surveyCollections);
  assert.equal(controller.stateRef.current.editable, null); assert.equal(controller.stateRef.current.layout, null);
  await assert.rejects(controller.executeCatalog({ type: "rename_field_map", fieldMapId: "map", name: "Replayed", now },
    { expectedWorkspaceRevision: f.workspace.revision, isCurrent: () => true }), /earlier workspace/);
  assert.equal(f.writes.length, 1, "the close handoff was consumed once");
});

for (const interruption of ["intent", "mode ABA", "same-value input"] as const)
test(`${interruption} retires a Catalog close handoff before the next close or write`, async t => {
  const f = fixture(t, null); addResumeReviewCustomers(f); await f.openDesign(); await f.openLayout();
  const controller = f.api(), before = f.workspace;
  assert(controller.closeLayout({ ignorePendingInputKeys: ["catalog"] }));
  if (interruption === "intent") controller.noteUserIntent();
  else if (interruption === "mode ABA") { f.api().selectMode("design"); f.api().selectMode("layout"); }
  else { const raw = retainRaw(f.api()); raw.set("saved"); assert.equal(controller.inputs.hasDirty(), false); }
  assert.equal(controller.closeDesign({ ignorePendingInputKeys: ["catalog"] }), false);
  await assert.rejects(controller.executeCatalog({ type: "move_project_to_client", projectId: "project", clientId: "destination-customer", now },
    { expectedWorkspaceRevision: before.revision, isCurrent: () => true }), /Close the retained design/);
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
});

test("ordinary close without Catalog scope cannot borrow an intentional close handoff", async t => {
  const f = fixture(t, null); await f.openDesign(); await f.openLayout(); const controller = f.api();
  assert(controller.closeLayout({ ignorePendingInputKeys: ["catalog"] }));
  assert.equal(controller.closeDesign(), false); assert.equal(f.writes.length, 0);
  assert.equal(controller.stateRef.current.editable!.identity.designId, "design");
});

function holdManagementWrite(f: ControllerFixture) {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.beforeWrite = async () => { entered(); await pending; };
  return { started, release };
}
for (const retirement of ["mode ABA", "same-value input", "form owner"] as const)
test(`queued reviewed Catalog rename refuses ${retirement} while preserving exact source bytes`, async t => {
  const f = fixture(t, null); await f.openDesign(); const controller = f.api(), before = f.workspace, held = holdManagementWrite(f);
  let formCurrent = true;
  const job = controller.executeCatalog({ type: "rename_field_map", fieldMapId: "map", name: "Late queued field", now },
    { expectedWorkspaceRevision: before.revision, isCurrent: () => formCurrent });
  await held.started;
  if (retirement === "mode ABA") { f.api().selectMode("survey"); f.api().selectMode("design"); }
  else if (retirement === "same-value input") { const raw = retainRaw(f.api()); raw.set("saved"); }
  else formCurrent = false;
  held.release(); await assert.rejects(job, /retired command owner/);
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
});

test("ordinary Draft Save synchronizes only an actually applied title and keeps Field container identity", async t => {
  const f = fixture(t, null); await f.openDesign(); const before = f.workspace;
  assert(f.api().dispatch({ kind: "draft", action: { type: "rename", name: "Applied title" } }));
  assert.equal(await f.api().save(), true);
  assert.equal(f.writes.at(-1)!.type, "save_design_draft");
  assert.equal((f.writes.at(-1)! as Extract<WorkspaceCommand, { type: "save_design_draft" }>).syncCatalogName, true);
  assert.equal(f.workspace.catalog.designs.find(item => item.id === "design")!.name, "Applied title");
  assert.deepEqual(f.workspace.catalog.fieldMaps, before.catalog.fieldMaps);
});
