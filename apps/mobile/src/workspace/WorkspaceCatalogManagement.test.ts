import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { serializeDesignDraftDocument, createSurveyCollection } from "@cplayout/core";
import { applyWorkspaceCommand, type WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, type WorkspaceDocument } from "../../../../packages/project-store/src/workspaceDocument";
import { buildDesignWorkspaceBundle, exportDesignWorkspaceBundleZip, serializeDesignWorkspaceBundle } from "../../../../packages/project-store/src/designWorkspaceBundle";
import type { ProjectWorkspaceStatus } from "../hooks/useProjectRepository";
import type { WorkspaceCatalogProps } from "./WorkspaceCatalog";
import { newDesignDraft } from "../newDesignDraft";
import { emptyWorkspaceEditRecoveryUi, WORKSPACE_EDIT_RECOVERY_VERSION } from "./workspaceEditRecovery";
import type { WorkspaceRecoveryParticipants, WorkspaceRecoveryTarget } from "./workspaceRecoveryParticipants";
import { workspacePendingBlocksReplacement } from "./workspaceIntegration";

// Synthetic source fixture: execute actual component handlers without a browser,
// native renderer or a second repository. Hook slots survive explicit rerenders.
let active: HookFixture | null = null;
class HookFixture {
  slots: unknown[] = []; cursor = 0; effects: (() => void)[] = [];
  layouts: (() => void)[] = []; cleanups = new Map<number, () => void>();
  body: { type: unknown; key: string | null } | null = null;
  render(props: WorkspaceCatalogProps): React.ReactElement {
    return this.renderComponent(WorkspaceCatalog, props);
  }
  renderComponent<T>(render: (props: T) => React.ReactElement, props: T): React.ReactElement {
    this.cursor = 0; this.effects = []; this.layouts = []; active = this;
    let tree: React.ReactElement;
    try {
      tree = render(props);
      // Public form wrappers identify their private body as React does. Source
      // fixtures must execute that keyed body rather than pretend it is a host.
      if (typeof tree.type === "function" && tree.key !== null) {
        if (this.body && (this.body.type !== tree.type || this.body.key !== tree.key)) {
          this.cleanups.forEach(cleanup => cleanup()); this.cleanups.clear(); this.slots = []; this.cursor = 0;
        }
        this.body = { type: tree.type, key: tree.key };
        tree = (tree.type as (props: unknown) => React.ReactElement)(tree.props);
      }
    } finally { active = null; }
    this.layouts.forEach(effect => effect());
    this.effects.forEach(effect => effect()); return tree!;
  }
}
const require = createRequire(import.meta.url);
const moduleLoader = require("node:module") as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
const originalLoad = moduleLoader._load;
let fallbackRepositoryCalls = 0;
const reactHooks = {
  ...React,
  useState<T>(initial: T | (() => T)) {
    if (!active) return React.useState(initial);
    const owner = active, index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [owner.slots[index] as T, (value: T | ((old: T) => T)) => {
      owner.slots[index] = typeof value === "function" ? (value as (old: T) => T)(owner.slots[index] as T) : value;
    }] as const;
  },
  useRef<T>(initial: T) {
    if (!active) return React.useRef(initial);
    const owner = active, index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = { current: initial };
    return owner.slots[index] as { current: T };
  },
  useMemo<T>(make: () => T) { return make(); },
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    if (!active) return React.useEffect(effect, dependencies);
    const owner = active, index = owner.cursor++, previous = owner.slots[index] as readonly unknown[] | undefined;
    if (!previous || !dependencies || dependencies.some((value, i) => value !== previous[i])) owner.effects.push(() => {
      owner.cleanups.get(index)?.(); const cleanup = effect();
      if (typeof cleanup === "function") owner.cleanups.set(index, cleanup); else owner.cleanups.delete(index);
    });
    owner.slots[index] = dependencies;
  },
  useLayoutEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    if (!active) return React.useLayoutEffect(effect, dependencies);
    const owner = active, index = owner.cursor++, previous = owner.slots[index] as readonly unknown[] | undefined;
    if (!previous || !dependencies || dependencies.some((value, i) => value !== previous[i])) owner.layouts.push(() => {
      owner.cleanups.get(index)?.(); const cleanup = effect();
      if (typeof cleanup === "function") owner.cleanups.set(index, cleanup); else owner.cleanups.delete(index);
    });
    owner.slots[index] = dependencies;
  },
};
const Modal = ({ children }: { children?: React.ReactNode }) => React.createElement("div", { "data-modal": true }, children);
moduleLoader._load = function (name, parent, isMain) {
  if (name === "react") return reactHooks;
  if (name === "react-native") return { View: "div", Text: "span", Pressable: "button", TextInput: "input", ScrollView: "section", Modal,
    Platform: { OS: "web" }, StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value }, useWindowDimensions: () => ({ width: 1200, height: 800 }) };
  if (name === "react-native-safe-area-context") return { SafeAreaView: "div" };
  if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
  if (name.endsWith("/hooks/useProjectRepository")) return { useProjectRepository() { fallbackRepositoryCalls++; throw new Error("Unexpected second repository owner"); } };
  return originalLoad(name, parent, isMain);
};
let catalogModule: typeof import("./WorkspaceCatalog");
let formModule: typeof import("../components/ProjectCatalogDialog");
try {
  catalogModule = require("./WorkspaceCatalog");
  formModule = require("../components/ProjectCatalogDialog");
} finally { moduleLoader._load = originalLoad; }
const { WorkspaceCatalog, EMPTY_CATALOG_SELECTION, normalizeCatalogSelection, nextCatalogCreate, catalogDesignContext,
  createCatalogCommand, previewWorkspaceCatalogImport } = catalogModule!;
const now = "2026-10-10T20:00:00.000Z";
function apply(workspace: WorkspaceDocument, command: WorkspaceCommand): WorkspaceDocument { return applyWorkspaceCommand(workspace, command).workspace; }
function fixture() {
  let workspace = apply(emptyWorkspaceDocument(), { type: "create_client", now, id: "customer", input: { primaryContactFirstName: "Source", primaryContactLastName: "Owner" } });
  workspace = apply(workspace, { type: "create_client", now, id: "other", input: { primaryContactFirstName: "Other", primaryContactLastName: "Owner" } });
  workspace = apply(workspace, { type: "create_project_with_initial_field_map", now, input: { clientId: "customer", projectId: "project", projectName: "Operator project", projectCrs: "LOCAL:operator-field", unitSystem: "us_survey_feet", fieldMapId: "field", fieldMapName: "First named field" } });
  workspace = apply(workspace, { type: "create_design_draft", now, designId: "design", fieldMapId: "field", name: "Incomplete design", draft: { ...newDesignDraft("payload", "Incomplete design", "us_survey_feet"), projectCrs: "LOCAL:operator-field" } });
  return workspace;
}
const context = { clientId: "customer", projectId: "project", fieldMapId: "field", designId: "design" };
function status(workspace: WorkspaceDocument): ProjectWorkspaceStatus {
  return { catalog: workspace.catalog, designCatalog: workspace.catalog, catalogRevision: workspace.revision, layoutSessions: workspace.layoutSessions ?? [], workspaceVersion: workspace.workspaceVersion,
    canSaveLayout: true, refreshProjects: async () => {} } as unknown as ProjectWorkspaceStatus;
}
type ElementProps = Record<string, any>;
function find(tree: React.ReactNode, predicate: (element: React.ReactElement<ElementProps>) => boolean): React.ReactElement<ElementProps> | null {
  if (Array.isArray(tree)) { for (const child of tree) { const found = find(child, predicate); if (found) return found; } return null; }
  if (!React.isValidElement<ElementProps>(tree)) return null;
  if (predicate(tree)) return tree;
  return find(tree.props.children, predicate) ?? find(tree.props.feedback, predicate);
}
function element(tree: React.ReactNode, id: string) { const found = find(tree, item => item.props.testID === id); assert(found, `Missing ${id}`); return found; }
function component(tree: React.ReactNode, name: string) { const found = find(tree, item => typeof item.type === "function" && item.type.name === name); assert(found, `Missing ${name}`); return found; }
function text(tree: React.ReactNode): string {
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  return React.isValidElement<ElementProps>(tree) ? text(tree.props.children) : "";
}
async function flush() { await new Promise<void>(resolve => setImmediate(resolve)); }
function ui(workspace = fixture(), overrides: Partial<WorkspaceCatalogProps> = {}) {
  const calls: WorkspaceCommand[] = [], opens: string[] = [], pending: { dirty: boolean; busy: boolean }[] = [];
  const props: WorkspaceCatalogProps = { repository: status(workspace), activeContext: context, visible: true, presentation: "embedded", executeCatalog: async command => { calls.push(command); return undefined; },
    openDesign: async id => { opens.push(id); return true; }, closeDesign: () => true, closeLayout: () => true,
    importDesignWorkspace: async () => "imported", onClose: () => {}, onPendingStateChange: value => pending.push(value), ...overrides };
  const hooks = new HookFixture(); return { props, calls, opens, pending, render: () => hooks.render(props) };
}

// These probes exercise actual Catalog/form callbacks against real command transitions.
// The lock wait is simulated; browser origin locking and rendered acceptance are separate gates.
type Review = NonNullable<Parameters<WorkspaceCatalogProps["executeCatalog"]>[1]>;
function managed(overrides: Partial<WorkspaceCatalogProps> = {}) {
  let workspace = fixture(); const original = JSON.stringify(workspace), reviews: Review[] = [], commands: WorkspaceCommand[] = [];
  let release: (() => void) | null = null, wait = false, rejected: unknown = null;
  const h = ui(workspace, overrides);
  h.props.executeCatalog = async (command, review) => {
    assert(review, "every ordinary mutation requires a strict receipt"); reviews.push(review); commands.push(command);
    if (wait) await new Promise<void>(resolve => { release = resolve; });
    if (review.expectedWorkspaceRevision !== workspace.revision || !review.isCurrent()) { rejected = new Error("Reviewed action retired under lock"); throw rejected; }
    const result = applyWorkspaceCommand(workspace, command); workspace = result.workspace; h.props.repository = status(workspace); return result.value;
  };
  return { ...h, reviews, commands, original, workspace: () => workspace, rejected: () => rejected,
    queue: () => { wait = true; }, release: () => { assert(release); release(); },
    replace: (command: WorkspaceCommand) => { workspace = apply(workspace, command); h.props.repository = status(workspace); } };
}
function rename(h: ReturnType<typeof managed>) {
  element(h.render(), "catalog-rename-field").props.onPress();
  return component(h.render(), "ProjectCatalogDialog");
}
function projectRename(h: ReturnType<typeof managed>) {
  element(h.render(), "catalog-rename-project").props.onPress();
  return component(h.render(), "ProjectCatalogDialog");
}
const contact = { companyName: "", primaryContactFirstName: "New", primaryContactMiddleInitial: "", primaryContactLastName: "Customer", primaryContactSuffix: "", email: "", phone: "", location: "", notes: "" };
test("field rename uses its actual container baseline and metadata command, preserving all design payload bytes", async () => {
  const h = managed(), before = h.workspace(), dialog = rename(h);
  assert.equal(dialog.props.title, "Rename field"); assert.equal(dialog.props.defaultName, before.catalog.fieldMaps[0].name);
  assert.equal(dialog.props.mode, "fieldMap"); await dialog.props.onCreate("Operator container name");
  assert.deepEqual(h.commands.map(command => command.type), ["rename_field_map"]);
  const after = h.workspace(); assert.equal(after.catalog.fieldMaps[0].name, "Operator container name");
  assert.deepEqual(after.projectDocuments, before.projectDocuments); assert.deepEqual(after.draftDocuments, before.draftDocuments);
  assert.deepEqual(after.catalog.designs, before.catalog.designs); assert.deepEqual(after.catalog.projects, before.catalog.projects);
  assert.deepEqual(after.tombstones, before.tombstones); assert.deepEqual(h.opens, []);
});
test("field rename rejects changed source until cancel/reopen, retaining its original form and text", async () => {
  const h = managed(), held = rename(h); h.replace({ type: "rename_field_map", fieldMapId: "field", name: "Other writer", now });
  h.render(); await assert.rejects(held.props.onCreate("Retained name"), /changed/);
  assert.equal(h.commands.length, 0); assert.equal(component(h.render(), "ProjectCatalogDialog").key, held.key);
  element(component(h.render(), "ProjectCatalogDialog").props.feedback, "catalog-form-recheck").props.onPress();
  assert.match(text(h.render()), /cancel and reopen/); assert.equal(h.workspace().catalog.fieldMaps[0].name, "Other writer");
});
for (const event of ["same-value raw", "focus", "disclosure ABA"] as const) test(`queued rename refuses ${event} without committing or closing the form`, async () => {
  const h = managed(), held = rename(h); h.queue(); const pending = held.props.onCreate("Queued old name"); await flush();
  held.props.onRawInputChange(); if (event === "disclosure ABA") held.props.onRawInputChange();
  assert.equal(h.reviews[0].isCurrent(), false); h.release(); await assert.rejects(pending, /retired/);
  assert.equal(JSON.stringify(h.workspace()), h.original); assert.equal(component(h.render(), "ProjectCatalogDialog").key, held.key);
});
test("queued rename refuses hide/show ABA and a retired actor", async () => {
  const h = managed(), held = projectRename(h); h.queue(); const pending = held.props.onCreate("Old name"); await flush();
  h.props.visible = false; h.render(); h.props.visible = true; h.render();
  assert.equal(h.reviews[0].isCurrent(), false); h.release(); await assert.rejects(pending, /retired/); assert.equal(JSON.stringify(h.workspace()), h.original);
});
test("duplicate held form submission cannot enter a second queue", async () => {
  const h = managed(), held = rename(h); h.queue(); const first = held.props.onCreate("First name"); await flush();
  await assert.rejects(held.props.onCreate("Duplicate"), /finish/); assert.equal(h.commands.length, 1);
  h.release(); await first; assert.equal(h.workspace().catalog.fieldMaps[0].name, "First name");
});
test("current-field request is one-use, preserves foreign Browse, uses actual ancestry and never opens", async () => {
  let acknowledgements = 0; const destination = { ...context, designId: null };
  const h = managed({ activeContext: { ...EMPTY_CATALOG_SELECTION, clientId: "other" }, currentFieldCreationRequest: {
    id: "request-1", context: destination, isCurrent: () => true, acknowledge: () => { acknowledgements++; } } });
  h.render(); const held = component(h.render(), "ProjectCatalogDialog"); assert.equal(acknowledgements, 1);
  assert.equal(held.props.contextPreview, [h.workspace().catalog.clients[0].displayName, "Operator project", "First named field"].join(" → "));
  assert.equal(element(h.render(), "catalog-client-other").props.selected, true);
  await held.props.onCreate("Separate actual draft"); assert.equal(h.commands[0].type, "create_design_draft");
  if (h.commands[0].type !== "create_design_draft") return;
  assert.equal(h.commands[0].fieldMapId, "field"); assert.deepEqual(h.commands[0].draft.machine, {}); assert.deepEqual(h.commands[0].draft.fieldBoundary, []);
  assert.equal(element(h.render(), "catalog-client-other").props.selected, true); assert.equal(acknowledgements, 1);
  assert.equal(find(h.render(), item => item.type === formModule!.ProjectCatalogDialog), null); assert.deepEqual(h.opens, []);
  assert.equal(h.workspace().draftDocuments[0].document, JSON.parse(h.original).draftDocuments[0].document);
});
for (const kind of ["retired", "foreign", "hidden", "existing form"] as const) test(`current-field request refuses ${kind} before acknowledgement or mutation`, () => {
  let acknowledgements = 0; const h = managed({ activeContext: null });
  if (kind === "existing form") element(h.render(), "catalog-new").props.onPress();
  h.props.currentFieldCreationRequest = { id: "request", context: { ...context, designId: null, ...(kind === "foreign" ? { clientId: "other" } : {}) },
    isCurrent: () => kind !== "retired", acknowledge: () => { acknowledgements++; } };
  if (kind === "hidden") h.props.visible = false;
  h.render(); h.render(); assert.equal(acknowledgements, 0); assert.equal(h.commands.length, 0);
});
test("confirmation held before cancellation cannot delete and queued cancellation retires strict review", async () => {
  const h = managed(); element(h.render(), "catalog-delete-design").props.onPress();
  const held = component(h.render(), "ConfirmActionDialog"); held.props.onCancel(); await held.props.onConfirm(); assert.equal(h.commands.length, 0);
  element(h.render(), "catalog-delete-design").props.onPress(); const fresh = component(h.render(), "ConfirmActionDialog");
  h.queue(); const pending = fresh.props.onConfirm(); await flush(); fresh.props.onCancel();
  assert.equal(h.reviews[0].isCurrent(), false); h.release(); await pending; assert.equal(JSON.stringify(h.workspace()), h.original);
});
test("project move binds destination ABA and leaves its current destination/form after refusal", async () => {
  const h = managed(); element(h.render(), "catalog-move-project").props.onPress(); let tree = h.render();
  element(tree, "catalog-move-to-other").props.onPress(); tree = h.render(); h.queue(); const pending = element(tree, "catalog-move-confirm").props.onPress(); await flush();
  element(tree, "catalog-move-to-other").props.onPress(); assert.equal(h.reviews[0].isCurrent(), false); h.release(); await pending; await flush();
  assert.equal(JSON.stringify(h.workspace()), h.original); assert.equal(element(h.render(), "catalog-move-to-other").props.selected, true);
});
test("queued customer edit pins raw source and refuses coherent other-writer revision drift", async () => {
  const h = managed(); element(h.render(), "catalog-edit-customer").props.onPress(); const held = component(h.render(), "ClientProfileDialog");
  h.queue(); const pending = held.props.onSave(contact); await flush(); h.replace({ type: "rename_project", projectId: "project", name: "Fresh project", now });
  h.render(); assert.equal(h.reviews[0].isCurrent(), false); h.release(); await assert.rejects(pending, /retired/);
  assert.equal(h.workspace().catalog.clients[0].primaryContactFirstName, "Source"); assert.equal(component(h.render(), "ClientProfileDialog").key, held.key);
});

test("actual rename form emits same-value/focus/caret events after refs update and exposes truthful Save action", () => {
  const h = managed(), held = rename(h), child = new HookFixture();
  const props = { ...held.props } as Parameters<typeof formModule.CatalogItemForm>[0];
  const render = () => child.renderComponent(formModule!.CatalogItemForm, props);
  let tree = render(); tree = render(); const input = element(tree, "catalog-dialog-name-input");
  assert.equal(element(tree, "catalog-dialog-create").props.accessibilityLabel, "Save field name");
  const captured: string[] = []; props.onRawInputChange = () => { captured.push(props.recoveryHandle!.current!.capture().name); };
  tree = render(); const actual = element(tree, "catalog-dialog-name-input");
  actual.props.onChangeText(actual.props.value); actual.props.onFocus(); actual.props.onSelectionChange({ nativeEvent: { selection: { start: 1, end: 2 } } });
  assert.deepEqual(captured, ["First named field", "First named field", "First named field"]);
  actual.props.onChangeText("Raw latest name"); assert.equal(captured.at(-1), "Raw latest name");
});
test("actual customer disclosure ABA retires a queued management receipt", async () => {
  const h = managed(); element(h.render(), "catalog-edit-customer").props.onPress(); const held = component(h.render(), "ClientProfileDialog");
  const child = new HookFixture(), render = () => child.renderComponent(formModule!.ClientProfileForm, { ...held.props, modalVisible: true } as Parameters<typeof formModule.ClientProfileForm>[0]);
  let tree = render(); tree = render(); h.queue(); const pending = held.props.onSave(contact); await flush();
  element(tree, "client-profile-details-toggle").props.onPress(); tree = render(); element(tree, "client-profile-details-toggle").props.onPress();
  assert.equal(h.reviews[0].isCurrent(), false); h.release(); await assert.rejects(pending, /retired/); assert.equal(JSON.stringify(h.workspace()), h.original);
});
test("ordinary design creation preserves its existing Browse selection and publishes only a separate record", async () => {
  const h = managed(); const selectedBefore = element(h.render(), "catalog-design-design").props.selected;
  element(h.render(), "catalog-new").props.onPress(); const held = component(h.render(), "ProjectCatalogDialog");
  await held.props.onCreate("New separate draft"); assert.equal(element(h.render(), "catalog-design-design").props.selected, selectedBefore);
  assert.equal(h.workspace().catalog.designs.length, 2); assert.deepEqual(h.opens, []);
});

test("distinct field-rename recovery stages without replaying create and retires on actual raw change", () => {
  const inputOwner = {}, registry = { canEdit: () => true, notifyChanged() {}, refresh() {}, getInputOwner: () => inputOwner, getFocus: () => null } as unknown as WorkspaceRecoveryParticipants;
  const h = managed({ recoveryParticipants: registry }), held = rename(h), child = new HookFixture();
  child.renderComponent(formModule!.CatalogItemForm, held.props as Parameters<typeof formModule.CatalogItemForm>[0]);
  const participant = component(h.render(), "CatalogRecoveryBridge").props.participant;
  const captured = participant.capture(); assert.equal(captured.form.kind, "rename_field_map");
  const defaults = emptyWorkspaceEditRecoveryUi(), staged = { recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION,
    writerId: "recovered-field-name", sequence: 1, capturedAt: now, workspaceRevision: h.workspace().revision,
    context: { version: 2, catalogVisible: true, catalogSelection: context, workspace: { mode: "design", design: null, layout: null, collectionId: null } },
    editable: null, collections: [], layout: null, controller: { historyPast: [], historyFuture: [], selectedAddress: null },
    inputs: { entries: [], focus: null }, ui: { ...defaults, catalog: captured }, cameras: [] };
  const target = { workspace: h.workspace(), admission: { staged } } as unknown as WorkspaceRecoveryTarget;
  const stage = participant.stage(captured, target); assert.equal(stage.isCurrent(), true); assert.equal(h.commands.length, 0);
  held.props.onRawInputChange(); assert.equal(stage.isCurrent(), false); assert.equal(h.commands.length, 0);
  assert.equal(component(h.render(), "ProjectCatalogDialog").props.title, "Rename field");
});

test("an acknowledged write with a delayed reply cannot close a form whose operator epoch changed", async () => {
  const h = managed(), held = rename(h); let release!: () => void, saved = h.workspace();
  h.props.executeCatalog = async (command, review) => {
    assert(review?.isCurrent()); saved = applyWorkspaceCommand(saved, command).workspace;
    await new Promise<void>(resolve => { release = resolve; }); h.props.repository = status(saved); return undefined;
  };
  const pending = held.props.onCreate("Acknowledged field name"); await flush();
  assert.equal(saved.catalog.fieldMaps[0].name, "Acknowledged field name"); held.props.onRawInputChange();
  release(); await pending; assert.equal(component(h.render(), "ProjectCatalogDialog").key, held.key);
  assert.equal(h.props.repository.catalog.fieldMaps[0].name, "Acknowledged field name"); assert.deepEqual(h.opens, []);
});
