import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { createSurveyCollection, validateSurveyCollection, applySurveyCollectionToDesign, createDesignDraftEditorState,
  serializeDesignDraftDocument, parseDesignDraftDocument, reduceDesignDraftEditorState, proposeSurveyMembershipRestore,
  type SurveyCollection, type SurveyCollectionPurpose, type SurveyPoint } from "@cplayout/core";
import { newDesignDraft } from "../newDesignDraft";
import type { useWorkspaceController } from "./useWorkspaceController";

type Controller = ReturnType<typeof useWorkspaceController>;
type ReferenceInput = { name: string; notes?: string };
type ElementProps = Record<string, any>;
type Slot = { kind: string; value: any; dependencies?: readonly unknown[]; cleanup?: () => void };
let active: PanelHooks | null = null;
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
/** Executes the real panel handlers with retained hook slots. Controller commands
 * and receiver availability are boundaries; no transport or persistence is claimed. */
class PanelHooks {
  slots: Slot[] = []; cursor = 0; effects: (() => void)[] = []; changed = false;
  slot(kind: string, initial: () => any) {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = { kind, value: initial() };
    assert.equal(this.slots[index].kind, kind, `Hook slot ${index} changed owner`); return this.slots[index];
  }
  render(controller: Controller): React.ReactElement {
    for (let pass = 0; pass < 10; pass++) {
      this.cursor = 0; this.effects = []; this.changed = false; active = this;
      let tree: React.ReactElement;
      try { tree = WorkspaceSurveyPanel({ controller }); } finally { active = null; }
      this.effects.forEach(effect => effect());
      if (!this.changed) return tree!;
    }
    throw new Error("Survey panel effects did not settle");
  }
}
const require = createRequire(import.meta.url);
const loader = require("node:module") as { _load: (name: string, parent: unknown, isMain: boolean) => any };
const originalLoad = loader._load;
const hooks = { ...React,
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
  useLayoutEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    return hooks.useEffect(effect, dependencies);
  },
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    if (!active) return React.useEffect(effect, dependencies);
    const owner = active, slot = owner.slot("useEffect", () => undefined);
    if (!sameDependencies(slot.dependencies, dependencies)) {
      slot.dependencies = dependencies;
      owner.effects.push(() => { slot.cleanup?.(); const cleanup = effect(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; });
    }
  },
};
loader._load = function (name, parent, isMain) {
  if (name === "react") return hooks;
  if (name === "react-native") return { View: "div", Text: "span", Pressable: "button", TextInput: "input",
    Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value } };
  return originalLoad(name, parent, isMain);
};
let WorkspaceSurveyPanel: typeof import("./WorkspaceModePanels")["WorkspaceSurveyPanel"];
try { ({ WorkspaceSurveyPanel } = require("./WorkspaceModePanels")); } finally { loader._load = originalLoad; }

const now = "2026-10-11T12:00:00.000Z", later = "2026-10-11T12:01:00.000Z";
const referencePurpose: SurveyCollectionPurpose = { kind: "map_feature", featureKind: "reference_line", geometryType: "LineString" };
function observation(id: string, x: number): SurveyPoint {
  return { id, label: `Historical ${id}`, role: "control", projected: { x, y: 4400100 }, observedAt: now,
    source: "external_gnss", confidence: "rtk_float", captureEvidence: { schemaVersion: "gnss-capture-v1", observationId: `receiver-${id}`,
      sessionId: "historical-session", transport: "replay", receivedAt: now, receivedMonotonicMs: 1,
      sourceCoordinateFrame: "EPSG:4326", antennaReference: "unknown", sentenceTypes: ["GGA"], coherent: true } };
}
function recordedCollection(id = "reference", purpose = referencePurpose): SurveyCollection {
  const observations = [observation(`${id}-a`, 500100), observation(`${id}-b`, 500200)];
  return validateSurveyCollection({ ...createSurveyCollection({ id, now, purpose,
    owner: { designId: "design", documentKind: "draft", payloadId: "draft", fieldMapId: "field", projectCrs: "EPSG:32613" } }),
    revision: 2, observations, activePointIds: observations.map(point => point.id) });
}
class SurveyFixture {
  hooks = new PanelHooks(); selectedId = "reference";
  pending = new Set<string>(); pendingCalls: { key: string; pending: boolean; changed?: boolean }[] = [];
  applyCalls: (ReferenceInput | undefined)[] = []; collectCalls: string[] = [];
  applyResult = true; deferredApply: ((input: ReferenceInput | undefined) => Promise<boolean>) | null = null;
  applications = 0;
  state: any = { presentation: { documentGeneration: 1, interactionGeneration: 1, mode: "survey" },
    editable: { kind: "draft", identity: { designId: "design", payloadId: "draft", fieldMapId: "field", projectCrs: "EPSG:32613" },
      editor: createDesignDraftEditorState({ ...newDesignDraft("draft", "Survey fixture", "metric"), projectCrs: "EPSG:32613" }) },
    collections: [recordedCollection(), recordedCollection("other")] };
  controller = { state: this.state, stateRef: { current: this.state }, busy: false,
    repository: { workspaceVersion: "cplayout-workspace-v4" }, referenceApplicationSupported: true,
    receiver: { collectionGate: () => ({ accepted: false, reason: "Receiver disconnected." }), getSnapshot: () => ({ observation: null }) },
    getSelectedCollectionId: () => this.selectedId,
    setPendingInteractionInput: (key: string, pending: boolean, changed?: boolean) => {
      if (pending) this.pending.add(key); else this.pending.delete(key); this.pendingCalls.push({ key, pending, changed });
    },
    applySurvey: async (input?: ReferenceInput) => {
      this.applyCalls.push(input);
      const deferred = this.deferredApply; this.deferredApply = null;
      if (deferred) return deferred(input);
      if (!this.applyResult) return false;
      this.commit(input); return true;
    },
    collectSurvey: async (label: string) => { this.collectCalls.push(label); return false; },
    selectCollection: (id: string) => this.select(id), startSurvey: async () => false, enableSurvey: async () => false, changeMembership: async () => false,
  } as unknown as Controller;
  constructor(purpose = referencePurpose) { this.state.collections[0] = recordedCollection("reference", purpose); this.sync(); }
  sync() {
    this.controller.state = this.state; this.controller.stateRef.current = this.state;
    this.controller.selectedCollectionId = this.selectedId;
    this.controller.selectedCollection = this.state.collections.find((collection: SurveyCollection) => collection.id === this.selectedId) ?? null;
    this.controller.interactionKey = JSON.stringify([this.state.presentation.documentGeneration, this.state.presentation.interactionGeneration]);
  }
  select(id: string) { this.selectedId = id; this.sync(); }
  mode(mode: string) { this.state = { ...this.state, presentation: { ...this.state.presentation, mode, interactionGeneration: this.state.presentation.interactionGeneration + 1 } }; this.sync(); }
  replaceDocument() { this.state = { ...this.state, presentation: { ...this.state.presentation, documentGeneration: this.state.presentation.documentGeneration + 1 } }; this.sync(); }
  render() { this.sync(); return this.hooks.render(this.controller); }
  commit(input?: ReferenceInput) {
    const selected = this.controller.selectedCollection!;
    const result = applySurveyCollectionToDesign("draft", serializeDesignDraftDocument(this.state.editable.editor.draft), selected,
      { applicationId: `application-${++this.applications}`, targetId: `feature-${this.applications}`, designRevision: this.applications, now: later, ...(input === undefined ? {} : { reference: input }) });
    this.state = { ...this.state, editable: { ...this.state.editable, editor: createDesignDraftEditorState(parseDesignDraftDocument(result.document)) },
      collections: this.state.collections.map((collection: SurveyCollection) => collection.id === selected.id ? result.collection : collection) };
    this.sync();
  }
  holdApply() {
    let entered!: () => void, release!: (accepted: boolean) => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    this.deferredApply = input => new Promise<boolean>(resolve => { entered(); release = accepted => { if (accepted) this.commit(input); resolve(accepted); }; });
    return { started, release: (accepted = true) => release(accepted) };
  }
}
function find(tree: React.ReactNode, predicate: (element: React.ReactElement<ElementProps>) => boolean): React.ReactElement<ElementProps> | null {
  if (Array.isArray(tree)) { for (const child of tree) { const found = find(child, predicate); if (found) return found; } return null; }
  if (!React.isValidElement<ElementProps>(tree)) return null;
  return predicate(tree) ? tree : find(tree.props.children, predicate);
}
function element(tree: React.ReactNode, id: string) { const result = find(tree, element => element.props.testID === id); assert(result, `Missing ${id}`); return result; }
function text(tree: React.ReactNode): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return React.isValidElement<ElementProps>(tree) ? text(tree.props.children) : "";
}
function press(tree: React.ReactNode, id: string) { const button = element(tree, id); assert.notEqual(button.props.disabled, true, `${id} is disabled`); button.props.onPress(); }
function change(tree: React.ReactNode, id: string, value: string) { element(tree, id).props.onChangeText(value); }
function details(f: SurveyFixture) { let tree = f.render(); press(tree, "survey-reference-details"); return f.render(); }
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); }

test("legacy non-reference Apply forwards no metadata and keeps disconnected historical shape application enabled", async () => {
  const f = new SurveyFixture({ kind: "map_feature", featureKind: "measurement_line", geometryType: "LineString" });
  const tree = f.render(); assert.equal(find(tree, item => item.props.testID === "survey-reference-details"), null);
  press(tree, "survey-apply"); await flush();
  assert.deepEqual(f.applyCalls, [undefined]); assert.equal(f.controller.selectedCollection!.state, "applied");
});

test("unsupported references show an honest disabled Apply while preserving saved observations", () => {
  const f = new SurveyFixture(); f.controller.referenceApplicationSupported = false;
  const tree = f.render(); assert.equal(element(tree, "survey-apply").props.disabled, true);
  assert.match(text(tree), /Applying a reference feature requires the recorded-reference document support/);
  assert.deepEqual(f.applyCalls, []); assert.equal(f.controller.selectedCollection!.observations.length, 2);
});

test("reference Apply forwards detached exact name and notes, acknowledges metadata, and omits blank notes", async () => {
  for (const notes of ["Exact notes\n  untrimmed  ", ""]) {
    const f = new SurveyFixture(); let tree = details(f);
    assert.equal(element(tree, "survey-reference-name").props.value, "Reference line");
    change(tree, "survey-reference-name", "  Actual reference A  "); change(tree, "survey-reference-notes", notes); tree = f.render();
    assert(f.pending.has("survey-reference")); press(tree, "survey-apply"); await flush(); tree = f.render();
    assert.deepEqual(f.applyCalls, [{ name: "  Actual reference A  ", ...(notes === "" ? {} : { notes }) }]);
    assert.equal(element(tree, "survey-reference-name").props.value, "  Actual reference A  "); assert.equal(element(tree, "survey-reference-notes").props.value, notes);
    assert.equal(f.pending.has("survey-reference"), false); assert.equal(element(tree, "survey-reference-discard").props.disabled, true);
    assert.match(text(element(tree, "survey-reference-provenance")), /Recorded Survey reference/);
  }
});

test("failed reference Apply retains exact unfinished details and pending intent, and toggles preserve the sole text owner", async () => {
  const f = new SurveyFixture(); f.applyResult = false; let tree = details(f);
  change(tree, "survey-reference-name", "Failure name  "); change(tree, "survey-reference-notes", "Failure\nnotes"); tree = f.render();
  const before = JSON.stringify(f.state.editable.editor.draft); press(tree, "survey-apply"); await flush(); tree = f.render();
  assert.equal(f.pending.has("survey-reference"), true); assert.equal(JSON.stringify(f.state.editable.editor.draft), before);
  press(tree, "survey-reference-details"); tree = f.render(); assert.equal(find(tree, item => item.props.testID === "survey-reference-name"), null);
  press(tree, "survey-reference-details"); tree = f.render();
  assert.equal(element(tree, "survey-reference-name").props.value, "Failure name  "); assert.equal(element(tree, "survey-reference-notes").props.value, "Failure\nnotes");
  press(tree, "survey-reference-discard"); tree = f.render(); assert.equal(element(tree, "survey-reference-name").props.value, "Reference line"); assert.equal(element(tree, "survey-reference-notes").props.value, ""); assert.equal(f.pending.has("survey-reference"), false);
});

for (const retireFeedback of [false, true]) test(`deferred A acknowledgement preserves newer B details and Discard restores acknowledged A${retireFeedback ? " after mode retirement" : ""}`, async () => {
  const f = new SurveyFixture(); let tree = details(f);
  change(tree, "survey-reference-name", "Submitted A"); change(tree, "survey-reference-notes", "A notes"); tree = f.render();
  const pending = f.holdApply(); press(tree, "survey-apply"); await pending.started;
  change(tree, "survey-reference-name", "Newer B"); change(tree, "survey-reference-notes", "B notes"); tree = f.render();
  if (retireFeedback) { f.mode("design"); f.render(); }
  pending.release(); await flush(); tree = f.render();
  if (retireFeedback) { f.mode("survey"); tree = f.render(); }
  assert.deepEqual(f.applyCalls, [{ name: "Submitted A", notes: "A notes" }]);
  assert.equal(element(tree, "survey-reference-name").props.value, "Newer B"); assert.equal(element(tree, "survey-reference-notes").props.value, "B notes"); assert(f.pending.has("survey-reference"));
  press(tree, "survey-reference-discard"); tree = f.render();
  assert.equal(element(tree, "survey-reference-name").props.value, "Submitted A"); assert.equal(element(tree, "survey-reference-notes").props.value, "A notes"); assert.equal(f.pending.has("survey-reference"), false);
});

for (const scope of ["mode", "collection", "document"] as const) test(`held reference input, Discard and Apply handlers refuse after a ${scope} round trip`, async () => {
  const f = new SurveyFixture(); const old = details(f);
  const name = element(old, "survey-reference-name").props.onChangeText, notes = element(old, "survey-reference-notes").props.onChangeText;
  const discard = element(old, "survey-reference-discard").props.onPress, apply = element(old, "survey-apply").props.onPress;
  if (scope === "mode") { f.mode("design"); f.render(); f.mode("survey"); }
  if (scope === "collection") { f.select("other"); f.render(); f.select("reference"); }
  if (scope === "document") { f.replaceDocument(); f.render(); f.replaceDocument(); }
  let tree = f.render();
  if (!find(tree, item => item.props.testID === "survey-reference-name")) { press(tree, "survey-reference-details"); tree = f.render(); }
  change(tree, "survey-reference-name", "Current owner"); change(tree, "survey-reference-notes", "Current notes"); tree = f.render();
  const pendingCalls = f.pendingCalls.length;
  name("Obsolete name"); notes("Obsolete notes"); discard(); apply(); await flush(); tree = f.render();
  assert.equal(element(tree, "survey-reference-name").props.value, "Current owner"); assert.equal(element(tree, "survey-reference-notes").props.value, "Current notes");
  assert.equal(f.pendingCalls.length, pendingCalls); assert.equal(f.applyCalls.length, 0); assert(f.pending.has("survey-reference"));
});

test("reopened metadata uses the latest current attachment name and real geometry edits display edited provenance", async () => {
  const f = new SurveyFixture(); let tree = details(f);
  change(tree, "survey-reference-name", "First applied reference"); tree = f.render(); press(tree, "survey-apply"); await flush(); f.render();
  const applied = f.controller.selectedCollection!;
  const resumed = proposeSurveyMembershipRestore(applied, { expectedRevision: applied.revision, now: later, state: "pending", activePointIds: applied.observations.map(point => point.id) });
  f.state.collections = f.state.collections.map((collection: SurveyCollection) => collection.id === applied.id ? resumed : collection); f.sync();
  f.commit({ name: "Latest attached reference", notes: "Current stored notes" });
  f.hooks = new PanelHooks(); tree = details(f);
  assert.equal(element(tree, "survey-reference-name").props.value, "Latest attached reference"); assert.equal(element(tree, "survey-reference-notes").props.value, "Current stored notes"); assert.equal(f.pending.has("survey-reference"), false);
  assert.match(text(element(tree, "survey-reference-provenance")), /Recorded Survey reference/);
  const feature = f.state.editable.editor.draft.mapFeatures.at(-1);
  assert.equal(feature.geometry.type, "LineString");
  f.state.editable.editor = reduceDesignDraftEditorState(f.state.editable.editor, { type: "set_feature_geometry", id: feature.id,
    geometry: { type: "LineString", vertices: [{ x: 500150, y: 4400150 }, feature.geometry.vertices[1]] } });
  assert.equal(f.state.editable.editor.lastError, null); f.sync(); tree = f.render();
  assert.match(text(element(tree, "survey-reference-provenance")), /Edited reference geometry.*original Survey observations retained/);
  assert.equal(element(tree, "survey-reference-name").props.value, "Latest attached reference");
});
