import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { serializeDesignDraftDocument } from "@cplayout/core";
import { applyWorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument } from "../../../../packages/project-store/src/workspaceDocument";
import { readWorkspaceDesign } from "../../../../packages/project-store/src/versionedProjectRepository";
import { editableFromSavedDesign } from "./workspaceDocumentAdapters";
import { captureWorkspaceRecoveryEditable, decodeWorkspaceRecoveryImport, emptyWorkspaceEditRecoveryUi, resolveWorkspaceEditRecovery,
  WORKSPACE_EDIT_RECOVERY_VERSION, type WorkspaceEditRecoveryCandidate } from "./workspaceEditRecovery";
import type { WorkspaceCatalogProps } from "./WorkspaceCatalog";
import type { WorkspaceRecoveryParticipants, WorkspaceRecoveryTarget } from "./workspaceRecoveryParticipants";
import { newDesignDraft } from "../newDesignDraft";

type Slot = { value: any; deps?: readonly unknown[]; cleanup?: () => void };
type Scope = { slots: Slot[]; cursor: number };
type Props = Record<string, any>;
let active: { renderer: Renderer; scope: Scope } | null = null;
const originalFrame = globalThis.requestAnimationFrame;
// Validation scrolling is host I/O; recovery focus below uses the owned refs.
globalThis.requestAnimationFrame = () => 0;
test.after(() => { globalThis.requestAnimationFrame = originalFrame; });
const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
/** Executes the actual Catalog, registry bridge, dialog wrappers and local forms.
 * Retained slots model mounting/key changes and ordered commits; only React/DOM
 * host I/O is simulated. No browser durability or whole-controller proof. */
class Renderer {
  scopes = new Map<string, Scope>(); layouts: (() => void)[] = []; effects: (() => void)[] = []; seen = new Set<string>(); changed = false;
  tree: React.ReactNode; focus: string[] = []; selections: unknown[] = [];
  holdFormMount = false;
  constructor(public props: WorkspaceCatalogProps) {}
  walk(node: React.ReactNode, path: string): React.ReactNode {
    if (Array.isArray(node)) return node.map((child, i) => this.walk(child, `${path}/${i}`));
    if (!React.isValidElement<Props>(node)) return node;
    // Match the installed RNWeb ModalAnimation boundary: hidden Modal children
    // are absent. Runtime participants/form owners must be above that boundary.
    if (node.type === "modal" && node.props.visible === false) return React.cloneElement(node, { children: null });
    if (typeof node.type === "function") {
      if (this.holdFormMount && ["CatalogItemForm", "ClientProfileForm"].includes(node.type.name)) return React.createElement("pending-form");
      const address = `${path}:${node.type.name}:${node.key ?? ""}`; this.seen.add(address);
      const scope = this.scopes.get(address) ?? { slots: [], cursor: 0 }; this.scopes.set(address, scope); scope.cursor = 0; active = { renderer: this, scope };
      let result: React.ReactNode;
      try { result = (node.type as (props: Props) => React.ReactNode)(node.props); } finally { active = null; }
      return this.walk(result, address);
    }
    if (node.props.ref && typeof node.props.ref === "object") node.props.ref.current = {
      focus: () => this.focus.push(node.props.testID ?? "host"), scrollTo() {},
      setNativeProps: (value: unknown) => this.selections.push(value),
    };
    return React.cloneElement(node, { children: this.walk(node.props.children, `${path}/children`) });
  }
  render() {
    for (let pass = 0; pass < 20; pass++) {
      this.changed = false; this.layouts = []; this.effects = []; this.seen = new Set();
      this.tree = this.walk(React.createElement(WorkspaceCatalog, this.props), "root");
      for (const [key, scope] of this.scopes) if (!this.seen.has(key)) { scope.slots.forEach(slot => slot.cleanup?.()); this.scopes.delete(key); }
      this.layouts.forEach(run => run()); this.effects.forEach(run => run());
      if (!this.changed) return this.tree;
    }
    throw new Error("Catalog component commit did not settle");
  }
  dispose() { this.scopes.forEach(scope => scope.slots.forEach(slot => slot.cleanup?.())); }
}
function slot(initial: () => any) { assert(active); const { scope } = active, index = scope.cursor++; return scope.slots[index] ?? (scope.slots[index] = { value: initial() }); }
const hooks = { ...React,
  useState<T>(initial: T | (() => T)) { assert(active); const renderer = active.renderer, item = slot(() => typeof initial === "function" ? (initial as () => T)() : initial);
    return [item.value as T, (value: T | ((old: T) => T)) => { const next = typeof value === "function" ? (value as (old: T) => T)(item.value) : value; if (!Object.is(next, item.value)) { item.value = next; renderer.changed = true; } }] as const; },
  useRef<T>(value: T) { return slot(() => ({ current: value })).value as { current: T }; },
  useMemo<T>(factory: () => T, deps?: readonly unknown[]) { const item = slot(() => undefined); if (!same(item.deps, deps)) { item.value = factory(); item.deps = deps; } return item.value as T; },
  useEffect: (run: () => void | (() => void), deps?: readonly unknown[]) => effect(false, run, deps),
  useLayoutEffect: (run: () => void | (() => void), deps?: readonly unknown[]) => effect(true, run, deps),
};
function effect(layout: boolean, run: () => void | (() => void), deps?: readonly unknown[]) { assert(active); const renderer = active.renderer, item = slot(() => undefined);
  if (!same(item.deps, deps)) { (layout ? renderer.layouts : renderer.effects).push(() => { item.cleanup?.(); const cleanup = run(); item.cleanup = typeof cleanup === "function" ? cleanup : undefined; }); item.deps = deps; } }
const require = createRequire(import.meta.url), loader = require("node:module") as { _load: (name: string, parent: unknown, isMain: boolean) => any }, original = loader._load;
loader._load = function(name, parent, isMain) {
  if (name === "react") return hooks;
  if (name === "react-native") return { View: "view", Text: "text", Pressable: "button", TextInput: "input", ScrollView: "scroll", Modal: "modal", KeyboardAvoidingView: "keyboard",
    Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value }, useWindowDimensions: () => ({ width: 1200, height: 800 }) };
  if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
  return original(name, parent, isMain);
};
let WorkspaceCatalog: typeof import("./WorkspaceCatalog")["WorkspaceCatalog"], catalogRecoveryUpload: typeof import("./WorkspaceCatalog")["catalogRecoveryUpload"];
let createWorkspaceRecoveryParticipants: typeof import("./workspaceRecoveryParticipants")["createWorkspaceRecoveryParticipants"];
let InputRetentionStore: typeof import("../inputRetention")["InputRetentionStore"];
try { ({ WorkspaceCatalog, catalogRecoveryUpload } = require("./WorkspaceCatalog")); ({ createWorkspaceRecoveryParticipants } = require("./workspaceRecoveryParticipants")); ({ InputRetentionStore } = require("../inputRetention")); } finally { loader._load = original; }
function find(tree: React.ReactNode, id: string): React.ReactElement<Props> | null {
  if (Array.isArray(tree)) { for (const child of tree) { const result = find(child, id); if (result) return result; } return null; }
  if (!React.isValidElement<Props>(tree)) return null; return tree.props.testID === id ? tree : find(tree.props.children, id);
}
function control(renderer: Renderer, id: string) { const value = find(renderer.tree, id); assert(value, `Missing ${id}`); return value.props; }
function press(renderer: Renderer, id: string) { control(renderer, id).onPress(); renderer.render(); }
function change(renderer: Renderer, id: string, value: string) { control(renderer, id).onChangeText(value); renderer.render(); }
const now = "2026-10-11T12:00:00.000Z", context = { clientId: "customer", projectId: "project", fieldMapId: "field", designId: "design" };
function fixture() {
  let workspace = emptyWorkspaceDocument();
  const apply = (command: any) => { workspace = applyWorkspaceCommand(workspace, { now, ...command }).workspace; };
  apply({ type: "create_client", id: "customer", input: { primaryContactFirstName: "Saved", primaryContactLastName: "Owner" } });
  apply({ type: "create_project_with_initial_field_map", input: { clientId: "customer", projectId: "project", fieldMapId: "field", projectName: "Saved project", projectCrs: "LOCAL:field", unitSystem: "metric" } });
  apply({ type: "create_design_draft", designId: "design", fieldMapId: "field", name: "Saved draft", draft: { ...newDesignDraft("payload", "Saved draft", "metric"), projectCrs: "LOCAL:field" } });
  return workspace;
}
function ui(activeContext: WorkspaceCatalogProps["activeContext"] = context) {
  let workspace = fixture(); const inputs = new InputRetentionStore(), registry = createWorkspaceRecoveryParticipants(inputs), defaults = emptyWorkspaceEditRecoveryUi();
  const inert = (value: unknown) => ({ capture: () => value, stage: () => ({ isCurrent: () => true, consume() {} }) });
  registry.register("entry", inert({ entry: defaults.entry, file: defaults.file }) as any); registry.register("frame", inert(defaults.entry) as any);
  registry.register("survey", inert(defaults.survey) as any); registry.register("layout", inert(defaults.layout) as any); registry.register("receiver", inert(defaults.receiver) as any); registry.register("camera", inert([]) as any);
  const calls: unknown[] = [], events: string[] = [];
  const renderer = new Renderer({ repository: { catalog: workspace.catalog, designCatalog: workspace.catalog, catalogRevision: workspace.revision,
    workspaceVersion: workspace.workspaceVersion, layoutSessions: [], refreshProjects: async () => {} } as any,
    recoveryParticipants: registry, activeContext, visible: true, presentation: "embedded",
    executeCatalog: async (command: any) => {
      calls.push(command); const result = applyWorkspaceCommand(workspace, command); workspace = result.workspace;
      renderer.props.repository = { ...renderer.props.repository, catalog: workspace.catalog as any, designCatalog: workspace.catalog, catalogRevision: workspace.revision }; return result.value;
    }, openDesign: async () => true, closeDesign: () => true,
    importDesignWorkspace: async () => { calls.push("import"); return "design"; }, onClose: () => events.push("close"),
    onUserIntent: () => { events.push("intent"); }, onSelectionChange: () => events.push("selection") });
  renderer.render(); return { renderer, registry, inputs, get workspace() { return workspace; }, calls, events,
    setWorkspace(value: typeof workspace) { workspace = value; renderer.props.repository = { ...renderer.props.repository, catalog: workspace.catalog as any, designCatalog: workspace.catalog, catalogRevision: workspace.revision }; renderer.render(); } };
}
function target(value: ReturnType<typeof ui>, catalog: ReturnType<WorkspaceRecoveryParticipants["capture"]>["ui"]["catalog"]): WorkspaceRecoveryTarget {
  const read = readWorkspaceDesign(value.workspace, "design"); assert.notEqual(read.kind, "not_found"); if (read.kind === "not_found") throw new Error("Missing source");
  const editable = editableFromSavedDesign(read), candidate: WorkspaceEditRecoveryCandidate = {
    recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION, writerId: "source-writer", sequence: 1, capturedAt: now, workspaceRevision: value.workspace.revision,
    context: { version: 2, catalogVisible: true, catalogSelection: context, workspace: { mode: "design", design: { designId: "design", fieldMapId: "field", payloadId: "payload", documentKind: "draft", projectCrs: "LOCAL:field" }, layout: null, collectionId: null } },
    editable: captureWorkspaceRecoveryEditable(editable), collections: [], layout: null, controller: { historyPast: [], historyFuture: [], selectedAddress: null },
    inputs: { entries: [], focus: null }, ui: { ...emptyWorkspaceEditRecoveryUi(), catalog }, cameras: [] };
  const resolution = resolveWorkspaceEditRecovery(candidate, value.workspace); assert("admission" in resolution, JSON.stringify(resolution));
  return { admission: resolution.admission, workspace: value.workspace, documentGeneration: 42 };
}
async function deliver(value: ReturnType<typeof ui>, catalog: ReturnType<WorkspaceRecoveryParticipants["capture"]>["ui"]["catalog"]) {
  const destination = target(value, catalog), plans = await value.registry.stage(destination); assert(plans.isCurrent()); value.registry.setBlocked(true);
  const job = plans.consume({ id: "delivery-one", target: destination, isCurrent: () => true });
  value.renderer.render(); await new Promise<void>(resolve => setImmediate(resolve)); value.renderer.render(); await job;
  value.registry.setBlocked(false); value.renderer.render();
}
async function uploaded(value: ReturnType<typeof ui>, bytes: Uint8Array, name: string) {
  const old = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement() { const listeners = new Map<string, () => void>(); return {
    files: [{ name, size: bytes.length, arrayBuffer: async () => new Uint8Array(bytes).buffer }], addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), click: () => listeners.get("change")!(),
  }; } } });
  try { press(value.renderer, "catalog-import"); await new Promise<void>(resolve => setImmediate(resolve)); value.renderer.render(); } finally { if (old) Object.defineProperty(globalThis, "document", old); else Reflect.deleteProperty(globalThis, "document"); }
}

test("actual name form snapshots invalid raw fields/errors and fresh child delivery follows resets without user callbacks", async () => {
  const source = ui({ clientId: "customer", projectId: null, fieldMapId: null, designId: null });
  press(source.renderer, "catalog-new"); change(source.renderer, "catalog-dialog-name-input", "  exact name\n"); change(source.renderer, "catalog-dialog-first-field-input", "   ");
  press(source.renderer, "catalog-dialog-create"); const saved = source.registry.capture().ui.catalog;
  assert.equal(saved.form!.name, "  exact name\n"); assert.equal(saved.form!.fieldName, "   "); assert(saved.form!.fieldError);
  const recipient = ui(), before = recipient.events.length; await deliver(recipient, saved);
  assert.equal(control(recipient.renderer, "catalog-dialog-name-input").value, saved.form!.name);
  assert.equal(control(recipient.renderer, "catalog-dialog-first-field-input").value, saved.form!.fieldName);
  assert.deepEqual(recipient.registry.capture().ui.catalog.form!.fieldError, saved.form!.fieldError);
  assert.equal(recipient.events.length, before); assert.equal(recipient.calls.length, 0);
  source.renderer.dispose(); recipient.renderer.dispose();
});

test("customer raw fields, errors and details remain exact; capture returns detached values", async () => {
  const source = ui(); press(source.renderer, "catalog-edit-customer"); change(source.renderer, "client-profile-first-name-input", "  ");
  change(source.renderer, "client-profile-notes-input", "  notes\n\t"); press(source.renderer, "client-profile-details-toggle"); press(source.renderer, "client-profile-save");
  const saved = source.registry.capture().ui.catalog; assert.equal(saved.form!.client!.notes, "  notes\n\t"); assert(saved.form!.errors.some(error => error.field === "primaryContactFirstName"));
  const recipient = ui(); await deliver(recipient, saved);
  assert.equal(control(recipient.renderer, "client-profile-first-name-input").value, "  "); assert.equal(control(recipient.renderer, "client-profile-notes-input").value, "  notes\n\t");
  assert.equal(recipient.registry.capture().ui.catalog.form!.detailsOpen, true);
  (saved.form!.client as any).notes = "external mutation"; assert.equal(source.registry.capture().ui.catalog.form!.client!.notes, "  notes\n\t");
  source.renderer.dispose(); recipient.renderer.dispose();
});

test("same-value child input retires a staged review and blocked retained controls cannot alter raw values or submit", async () => {
  const value = ui(); press(value.renderer, "catalog-edit-customer"); const saved = value.registry.capture().ui.catalog;
  const stage = await value.registry.stage(target(value, saved)); const field = control(value.renderer, "client-profile-first-name-input");
  field.onChangeText(field.value); assert.equal(stage.isCurrent(), false);
  const before = value.registry.capture().ui.catalog, inputOwner = value.registry.getInputOwner(); value.registry.setBlocked(true);
  field.onChangeText("blocked"); control(value.renderer, "client-profile-save").onPress(); control(value.renderer, "client-profile-cancel").onPress();
  value.renderer.render(); assert.deepEqual(value.registry.capture().ui.catalog, before); assert.equal(value.registry.getInputOwner(), inputOwner); assert.equal(value.calls.length, 0);
  value.registry.setBlocked(false); value.renderer.dispose();
});

test("stage validates every raw field before setters and refuses changed form ancestry", async () => {
  const source = ui(); press(source.renderer, "catalog-edit-customer"); const recipient = ui(), saved = source.registry.capture().ui.catalog;
  const bad = structuredClone(saved); (bad.form!.client as any).notes = 4;
  await assert.rejects(recipient.registry.stage({ ...target(recipient, saved), admission: { ...target(recipient, saved).admission, ui: { ...target(recipient, saved).admission.ui, catalog: bad } } }), /Recovery|form|JSON|text/i);
  assert.equal(recipient.registry.capture().ui.catalog.form, null);
  const foreign = structuredClone(saved); foreign.form!.context.clientId = "removed";
  await assert.rejects(recipient.registry.stage({ ...target(recipient, saved), admission: { ...target(recipient, saved).admission, ui: { ...target(recipient, saved).admission.ui, catalog: foreign } } }), /destination changed/);
  assert.equal(recipient.registry.capture().ui.catalog.form, null); source.renderer.dispose(); recipient.renderer.dispose();
});

test("original upload custody survives strict decode failure and stage redecodes without importing", async () => {
  const source = ui(), bytes = new Uint8Array([255, 254, 0, 10]); await uploaded(source, bytes, "bad-source.json");
  const saved = source.registry.capture().ui.catalog; assert(saved.import); assert.deepEqual(decodeWorkspaceRecoveryImport(saved.import), bytes); assert.equal(source.calls.length, 0);
  const recipient = ui(); await deliver(recipient, saved); assert.deepEqual(decodeWorkspaceRecoveryImport(recipient.registry.capture().ui.catalog.import!), bytes);
  assert.equal(find(recipient.renderer.tree, "workspace-import-save"), null); assert.equal(recipient.calls.length, 0);
  source.renderer.dispose(); recipient.renderer.dispose();
});

test("valid original upload returns only a recheck-required review; acknowledged copy captures no pending bytes and restores Open", async () => {
  const source = ui(), document = serializeDesignDraftDocument({ ...newDesignDraft("uploaded", "Upload", "metric"), projectCrs: "LOCAL:field" });
  await uploaded(source, new TextEncoder().encode(document), "source.json"); const saved = source.registry.capture().ui.catalog, recipient = ui(); await deliver(recipient, saved);
  assert.equal(control(recipient.renderer, "workspace-import-save").disabled, true); assert.equal(recipient.calls.length, 0);
  press(source.renderer, "workspace-import-save"); await new Promise<void>(resolve => setImmediate(resolve)); source.renderer.render();
  const acknowledged = source.registry.capture().ui.catalog; assert(acknowledged.savedImportId); assert(source.workspace.catalog.designs.some(item => item.id === acknowledged.savedImportId)); assert.equal(acknowledged.import, null);
  const reopened = ui(); reopened.setWorkspace(source.workspace); await deliver(reopened, acknowledged); assert(find(reopened.renderer.tree, "workspace-import-open")); assert.equal(reopened.calls.length, 0);
  source.renderer.dispose(); recipient.renderer.dispose(); reopened.renderer.dispose();
});

test("binary custody and logical focus clamp never depend on form sequences or DOM selectors", async () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index), upload = catalogRecoveryUpload(bytes, "bytes.zip"); bytes[0] = 99;
  assert.deepEqual(decodeWorkspaceRecoveryImport(upload), Uint8Array.from({ length: 256 }, (_, index) => index));
  const source = ui({ clientId: "customer", projectId: null, fieldMapId: null, designId: null }); press(source.renderer, "catalog-new"); change(source.renderer, "catalog-dialog-name-input", "raw");
  const recipient = ui(); recipient.inputs.recordFocus("catalog/form/name"); recipient.inputs.recordSelection("catalog/form/name", { start: 1, end: 999 });
  await deliver(recipient, source.registry.capture().ui.catalog); assert(recipient.renderer.focus.includes("catalog-dialog-name-input"));
  assert.deepEqual(recipient.renderer.selections.at(-1), { selection: { start: 1, end: 3 } }); source.renderer.dispose(); recipient.renderer.dispose();
});

test("Catalog delivery stays pending and disabled until its fresh child mounts and acknowledges after resets", async () => {
  const source = ui({ clientId: "customer", projectId: null, fieldMapId: null, designId: null }); press(source.renderer, "catalog-new");
  change(source.renderer, "catalog-dialog-name-input", "  restored  "); const recipient = ui(), saved = source.registry.capture().ui.catalog;
  const destination = target(recipient, saved), stage = await recipient.registry.stage(destination); recipient.registry.setBlocked(true); recipient.renderer.holdFormMount = true;
  let acknowledged = false; const job = stage.consume({ id: "delayed-child", target: destination, isCurrent: () => true }).then(() => { acknowledged = true; });
  recipient.renderer.render(); await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(acknowledged, false);
  assert.equal(control(recipient.renderer, "catalog-new").disabled, true); assert.throws(() => recipient.registry.capture(), /mount|acknowledge|admitted action/i);
  recipient.renderer.holdFormMount = false; recipient.renderer.render(); await new Promise<void>(resolve => setImmediate(resolve)); recipient.renderer.render(); await job;
  assert.equal(acknowledged, true); assert.equal(control(recipient.renderer, "catalog-dialog-name-input").value, "  restored  ");
  recipient.registry.setBlocked(false); source.renderer.dispose(); recipient.renderer.dispose();
});

test("recovered form requires explicit fresh Recheck before its ordinary strict metadata submission", async () => {
  const source = ui(); press(source.renderer, "catalog-rename-project"); change(source.renderer, "catalog-dialog-name-input", "  operator rename  ");
  const recipient = ui(), saved = source.registry.capture().ui.catalog, sourceBytes = recipient.workspace.draftDocuments[0].document;
  await deliver(recipient, saved); press(recipient.renderer, "catalog-dialog-create"); await new Promise<void>(resolve => setImmediate(resolve)); recipient.renderer.render();
  assert.equal(recipient.calls.length, 0); assert.equal(control(recipient.renderer, "catalog-dialog-name-input").value, "  operator rename  ");
  press(recipient.renderer, "catalog-form-recheck"); press(recipient.renderer, "catalog-dialog-create"); await new Promise<void>(resolve => setImmediate(resolve)); recipient.renderer.render();
  assert.equal(recipient.calls.length, 1); assert.equal(recipient.workspace.catalog.projects[0].name, "operator rename"); assert.equal(recipient.workspace.draftDocuments[0].document, sourceBytes);
  source.renderer.dispose(); recipient.renderer.dispose();
});

test("hidden outer Modal retains the catalog participant and local child value owners above hidden presentation", async () => {
  const value = ui(); value.renderer.props.presentation = "dialog"; value.renderer.props.visible = false; value.renderer.render();
  assert.equal(find(value.renderer.tree, "workspace-catalog"), null);
  assert.equal(value.registry.capture().ui.catalog.form, null, "Catalog registration survives hidden Modal child removal");
  value.renderer.props.visible = true; value.renderer.render(); press(value.renderer, "catalog-edit-customer");
  change(value.renderer, "client-profile-notes-input", "  parked hidden values\n"); const held = control(value.renderer, "client-profile-notes-input");
  value.renderer.props.visible = false; value.renderer.render(); assert.equal(find(value.renderer.tree, "client-profile-notes-input"), null);
  held.onChangeText("retired hidden event"); assert.equal(value.registry.capture().ui.catalog.form!.client!.notes, "  parked hidden values\n");
  const saved = value.registry.capture().ui.catalog, recipient = ui(); recipient.renderer.props.presentation = "dialog"; recipient.renderer.props.visible = false; recipient.renderer.render();
  await deliver(recipient, saved); assert.equal(find(recipient.renderer.tree, "client-profile-notes-input"), null);
  assert.equal(recipient.registry.capture().ui.catalog.form!.client!.notes, "  parked hidden values\n");
  recipient.renderer.props.visible = true; recipient.renderer.render(); assert.equal(control(recipient.renderer, "client-profile-notes-input").value, "  parked hidden values\n");
  value.renderer.dispose(); recipient.renderer.dispose();
});

test("a committed import with a delayed reply records its saved receipt even when later raw input retires the review", async () => {
  const value = ui(), document = serializeDesignDraftDocument({ ...newDesignDraft("uploaded", "Upload", "metric"), projectCrs: "LOCAL:field" });
  await uploaded(value, new TextEncoder().encode(document), "source.json");
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const execute = value.renderer.props.executeCatalog;
  value.renderer.props.executeCatalog = async (...args) => { const receipt = await execute(...args); await pending; return receipt; };
  value.renderer.render();
  const name = control(value.renderer, "workspace-import-name"); press(value.renderer, "workspace-import-save");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(value.calls.length, 1, "The actual import command committed before its delayed reply");
  assert.throws(() => value.registry.capture(), /admitted action/);
  name.onChangeText("  later entered name  "); release(); await new Promise<void>(resolve => setImmediate(resolve)); value.renderer.render();
  const captured = value.registry.capture().ui.catalog; assert(captured.savedImportId); assert.equal(captured.import, null);
  assert.equal(captured.importName, "  later entered name  "); assert(value.workspace.catalog.designs.some(item => item.id === captured.savedImportId));
  value.renderer.dispose();
});
