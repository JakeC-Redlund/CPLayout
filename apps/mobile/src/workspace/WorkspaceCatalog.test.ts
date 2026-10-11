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
import { workspacePendingBlocksReplacement } from "./workspaceIntegration";

// Synthetic source fixture: execute actual component handlers without a browser,
// native renderer or a second repository. Hook slots survive explicit rerenders.
let active: HookFixture | null = null;
class HookFixture {
  slots: unknown[] = []; cursor = 0; effects: (() => void)[] = [];
  render(props: WorkspaceCatalogProps): React.ReactElement {
    return this.renderComponent(WorkspaceCatalog, props);
  }
  renderComponent<T>(render: (props: T) => React.ReactElement, props: T): React.ReactElement {
    this.cursor = 0; this.effects = []; active = this;
    let tree: React.ReactElement;
    try { tree = render(props); } finally { active = null; }
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
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    if (!active) return React.useEffect(effect, dependencies);
    const owner = active, index = owner.cursor++, previous = owner.slots[index] as readonly unknown[] | undefined;
    if (!previous || !dependencies || dependencies.some((value, i) => value !== previous[i])) owner.effects.push(() => { effect(); });
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
let archiveModule: typeof import("../components/CatalogArchiveImport");
let layoutModule: typeof import("../components/LayoutSessionCatalog");
try {
  catalogModule = require("./WorkspaceCatalog");
  archiveModule = require("../components/CatalogArchiveImport");
  layoutModule = require("../components/LayoutSessionCatalog");
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

test("hierarchy admission refuses foreign children and contextual New follows the real selected parent", () => {
  const catalog = fixture().catalog;
  assert.deepEqual(normalizeCatalogSelection(catalog, { ...context, clientId: "other" }), { clientId: "other", projectId: null, fieldMapId: null, designId: null });
  assert.deepEqual(catalogDesignContext(catalog, "design"), context);
  assert.throws(() => catalogDesignContext(catalog, "missing"), /missing/);
  assert.equal(nextCatalogCreate(catalog, EMPTY_CATALOG_SELECTION), "client");
  assert.equal(nextCatalogCreate(catalog, { ...EMPTY_CATALOG_SELECTION, clientId: "customer" }), "project");
  assert.equal(nextCatalogCreate(catalog, { ...context, fieldMapId: null, designId: null }), "fieldMap");
  assert.equal(nextCatalogCreate(catalog, context), "design");
});
test("project admission requires explicit CRS, first field name and units; creation is one atomic real command", () => {
  const workspace = fixture(), parent = { ...EMPTY_CATALOG_SELECTION, clientId: "customer" }, ids = { projectId: "new-project", fieldMapId: "new-field" };
  const values = { name: "Entered project", firstFieldName: "Entered first field", projectCrs: "LOCAL:entered", unitSystem: "us_survey_feet" };
  assert.throws(() => createCatalogCommand("project", workspace.catalog, parent, { ...values, projectCrs: "" }, ids, now), /coordinate system/);
  assert.throws(() => createCatalogCommand("project", workspace.catalog, parent, { ...values, firstFieldName: " " }, ids, now), /first field/);
  assert.throws(() => createCatalogCommand("project", workspace.catalog, parent, { ...values, unitSystem: "unknown" }, ids, now), /units/);
  assert.throws(() => createCatalogCommand("project", workspace.catalog, parent, { ...values, projectCrs: "EPSG:4326" }, ids, now), /projected|geographic/i);
  const next = apply(workspace, createCatalogCommand("project", workspace.catalog, parent, values, ids, now));
  assert.equal(next.revision, workspace.revision + 1);
  assert.equal(next.catalog.projects.find(item => item.id === "new-project")?.projectCrs, "LOCAL:entered");
  assert.equal(next.catalog.fieldMaps.find(item => item.id === "new-field")?.name, "Entered first field");
  assert.equal(next.catalog.designs.length, workspace.catalog.designs.length, "project creation does not invent a completed design");
});
test("new design inherits only real declared project CRS/units and remains incomplete with no sample machine/location", () => {
  const workspace = fixture();
  const command = createCatalogCommand("design", workspace.catalog, context, { name: "Operator draft" }, { designId: "new-design", payloadId: "new-payload" }, now);
  assert.equal(command.type, "create_design_draft"); if (command.type !== "create_design_draft") return;
  assert.equal(command.draft.projectCrs, "LOCAL:operator-field"); assert.equal(command.draft.unitSystem, "us_survey_feet");
  assert.deepEqual(command.draft.fieldBoundary, []); assert.deepEqual(command.draft.machine, {});
  assert.equal(command.draft.pivotCenter, null); assert.equal(command.draft.waterSource, null);
  const next = apply(workspace, command); assert.equal(next.catalog.designs.at(-1)?.kind, "draft");
});
test("complete JSON and ZIP retain exact design and unfinished Survey history while legacy design admission is labeled separately", () => {
  let workspace = fixture(); workspace = apply(workspace, { type: "upgrade_workspace_to_v3", now }); workspace = apply(workspace, { type: "upgrade_workspace_to_v4", now });
  const collection = createSurveyCollection({ id: "pending", now, purpose: { kind: "field_boundary" }, owner: { designId: "design", documentKind: "draft", payloadId: "payload", fieldMapId: "field", projectCrs: "LOCAL:operator-field" } });
  workspace = apply(workspace, { type: "create_survey_collection", now, collection, expectedDesignRevision: 0 });
  const bundle = buildDesignWorkspaceBundle(workspace, "design");
  for (const [bytes, filename] of [[new TextEncoder().encode(serializeDesignWorkspaceBundle(bundle)), "complete.json"], [exportDesignWorkspaceBundleZip(bundle), "complete.zip"]] as const) {
    const admitted = previewWorkspaceCatalogImport(bytes, filename); assert.equal(admitted.format, "complete");
    if (admitted.format === "complete") { assert.equal(admitted.bundle.designDocument, bundle.designDocument); assert.deepEqual(admitted.bundle.surveyDocuments, bundle.surveyDocuments); }
  }
  const exact = `\n${serializeDesignDraftDocument(newDesignDraft("foreign-payload", "Imported", "metric"))}\n`;
  const legacy = previewWorkspaceCatalogImport(new TextEncoder().encode(exact), "legacy.json"); assert.equal(legacy.format, "design_only");
  if (legacy.format === "design_only") assert.equal(legacy.preview.document, exact);
});
test("unknown versions, malformed UTF-8, unsupported keys and corrupted bundle hashes are rejected before commands", () => {
  const workspace = fixture(), before = JSON.stringify(workspace), bundle = buildDesignWorkspaceBundle(workspace, "design");
  const invalid = [new TextEncoder().encode('{"bundleVersion":"future"}'), new Uint8Array([0xff]), new TextEncoder().encode('{"documentVersion":"future","draft":{}}'),
    new TextEncoder().encode(JSON.stringify({ ...bundle, designDocument: bundle.designDocument + " " })), new TextEncoder().encode(JSON.stringify({ ...bundle, extra: "unsupported" }))];
  for (const bytes of invalid) assert.throws(() => previewWorkspaceCatalogImport(bytes, "invalid.json"));
  assert.equal(JSON.stringify(workspace), before);
});
test("embedded empty workspace exposes Create/Import/recent inline without onboarding Modal; dialog uses same content", () => {
  const fixture = ui(emptyWorkspaceDocument(), { activeContext: null }); let tree = fixture.render();
  assert.equal(element(tree, "catalog-new").props.label, "New customer"); assert(element(tree, "catalog-import"));
  assert.match(text(tree), /Recent designs/); assert.equal(find(tree, item => item.type === Modal), null);
  fixture.props.presentation = "dialog"; tree = fixture.render(); assert.equal(tree.type, Modal); assert(element(tree, "workspace-catalog"));
});
test("browse selection never calls Open; explicit Open invokes only supplied guarded callback", async () => {
  const fixture = ui(); let tree = fixture.render(); element(tree, "catalog-recent-design").props.onPress(); tree = fixture.render();
  assert.equal(fixture.opens.length, 0); assert.equal(fixture.calls.length, 0);
  element(tree, "catalog-recent-open-design").props.onPress(); await flush(); assert.deepEqual(fixture.opens, ["design"]); assert.equal(fixture.calls.length, 0);
});
test("guarded Open stays locally busy without dirtying its own parent replacement guard after a delayed read", async () => {
  const pending = new Set<string>(); let release!: () => void, admitted = false, closed = 0;
  const fixture = ui(fixtureWorkspace(), {
    onPendingStateChange: value => { if (value.dirty || value.busy) pending.add("catalog"); else pending.delete("catalog"); },
    openDesign: async () => {
      if (workspacePendingBlocksReplacement(pending)) return false;
      await new Promise<void>(resolve => { release = resolve; });
      if (workspacePendingBlocksReplacement(pending)) return false;
      admitted = true; return true;
    }, onClose: () => { closed++; },
  });
  let tree = fixture.render(); element(tree, "catalog-recent-open-design").props.onPress(); tree = fixture.render();
  assert.equal(element(tree, "catalog-recent-open-design").props.disabled, true, "the local Open UI must remain disabled while reading");
  assert.equal(workspacePendingBlocksReplacement(pending), false, "the catalog must not dirty its own admitted guarded Open");
  release(); await flush(); fixture.render(); assert.equal(admitted, true); assert.equal(closed, 1);
});
test("an unrelated input appearing during guarded Open still blocks the parent's second replacement guard", async () => {
  const pending = new Set<string>(); let release!: () => void, closed = 0;
  const fixture = ui(fixtureWorkspace(), {
    onPendingStateChange: value => { if (value.dirty || value.busy) pending.add("catalog"); else pending.delete("catalog"); },
    openDesign: async () => {
      if (workspacePendingBlocksReplacement(pending)) return false;
      await new Promise<void>(resolve => { release = resolve; });
      return !workspacePendingBlocksReplacement(pending);
    }, onClose: () => { closed++; },
  });
  let tree = fixture.render(); element(tree, "catalog-recent-open-design").props.onPress(); fixture.render();
  pending.add("survey-label"); release(); await flush(); tree = fixture.render();
  assert.equal(closed, 0); assert.equal(pending.has("survey-label"), true); assert.match(text(tree), /Open was blocked/);
});
test("same-render stale Open cannot bypass a newly entered catalog form before pending effects commit", async () => {
  const fixture = ui(); let tree = fixture.render(); const retiredOpen = element(tree, "catalog-recent-open-design").props.onPress;
  element(tree, "catalog-new").props.onPress(); retiredOpen(); await flush(); tree = fixture.render();
  assert(component(tree, "ProjectCatalogDialog")); assert.equal(fixture.opens.length, 0);
  assert.equal(fixture.pending.at(-1)?.dirty, true); assert.match(text(tree), /entered form or import review/);
});
test("late Open completion cannot close a catalog hidden and reopened during its read", async () => {
  let release!: (opened: boolean) => void, closed = 0;
  const fixture = ui(fixtureWorkspace(), { openDesign: () => new Promise<boolean>(resolve => { release = resolve; }), onClose: () => { closed++; } });
  let tree = fixture.render(); const retiredNew = element(tree, "catalog-new").props.onPress;
  element(tree, "catalog-recent-open-design").props.onPress(); retiredNew(); tree = fixture.render();
  assert.equal(find(tree, item => typeof item.type === "function" && item.type.name === "ProjectCatalogDialog"), null, "same-render form cannot start while Open is active");
  fixture.props.visible = false; fixture.render(); fixture.props.visible = true; fixture.render();
  release(true); await flush(); tree = fixture.render(); assert.equal(closed, 0); assert.equal(element(tree, "catalog-new").props.disabled, false);
});
test("project form exposes first field, blank CRS and visible Imperial default; failed submit retains same form owner", async () => {
  const fixture = ui(fixtureWorkspace(), { activeContext: { ...EMPTY_CATALOG_SELECTION, clientId: "customer" }, executeCatalog: async () => { throw new Error("Synthetic quota failure"); } });
  let tree = fixture.render(); element(tree, "catalog-new").props.onPress(); tree = fixture.render();
  let dialog = component(tree, "ProjectCatalogDialog"), owner = dialog.key;
  assert.equal(dialog.props.defaultFieldName, "Field 1"); assert.equal(element(dialog.props.feedback, "catalog-project-crs").props.value, "");
  assert.equal(element(dialog.props.feedback, "catalog-units-imperial").props.selected, true);
  element(dialog.props.feedback, "catalog-project-crs").props.onChangeText("LOCAL:actual"); tree = fixture.render(); dialog = component(tree, "ProjectCatalogDialog");
  await assert.rejects(dialog.props.onCreate(" Raw operator project ", " Raw first field "), /quota/); tree = fixture.render();
  dialog = component(tree, "ProjectCatalogDialog"); assert.equal(dialog.key, owner);
  assert.equal(element(dialog.props.feedback, "catalog-project-crs").props.value, "LOCAL:actual"); assert.match(text(dialog.props.feedback), /quota failure/);
  assert.equal(fixture.pending.at(-1)?.dirty, true);
});
function fixtureWorkspace() { return fixture(); }
test("stale create form keeps fields and refuses queue submission until explicit context recheck", async () => {
  const fixture = ui(fixtureWorkspace(), { activeContext: { ...EMPTY_CATALOG_SELECTION, clientId: "customer" } });
  let tree = fixture.render(); element(tree, "catalog-new").props.onPress(); tree = fixture.render();
  element(component(tree, "ProjectCatalogDialog").props.feedback, "catalog-project-crs").props.onChangeText("LOCAL:entered");
  fixture.props.repository = { ...fixture.props.repository, catalogRevision: fixture.props.repository.catalogRevision! + 1 };
  tree = fixture.render(); let dialog = component(tree, "ProjectCatalogDialog"); await assert.rejects(dialog.props.onCreate("Name", "Field"), /changed/);
  assert.equal(fixture.calls.length, 0); tree = fixture.render(); element(component(tree, "ProjectCatalogDialog").props.feedback, "catalog-form-recheck").props.onPress();
  tree = fixture.render(); dialog = component(tree, "ProjectCatalogDialog"); await dialog.props.onCreate("Name", "Field"); assert.equal(fixture.calls.length, 1);
});
test("retired form callbacks cannot submit, cancel or recheck a later reopened form", async () => {
  const initial = fixtureWorkspace();
  const fixture = ui(initial, { activeContext: { ...EMPTY_CATALOG_SELECTION, clientId: "customer" } });
  let tree = fixture.render(); element(tree, "catalog-new").props.onPress(); tree = fixture.render();
  assert.equal(find(component(tree, "ProjectCatalogDialog").props.feedback, item => item.props.testID === "catalog-form-recheck"), null, "fresh forms have no redundant review action");
  fixture.props.repository = status(apply(initial, { type: "create_client", id: "external-customer", now,
    input: { primaryContactFirstName: "External", primaryContactLastName: "Owner" } }));
  tree = fixture.render();
  const oldForm = component(tree, "ProjectCatalogDialog"); oldForm.props.onCancel(); tree = fixture.render();
  element(tree, "catalog-new").props.onPress(); tree = fixture.render(); const newForm = component(tree, "ProjectCatalogDialog");
  assert.notEqual(newForm.key, oldForm.key); element(newForm.props.feedback, "catalog-project-crs").props.onChangeText("LOCAL:new-owner");
  oldForm.props.onCancel(); element(oldForm.props.feedback, "catalog-form-recheck").props.onPress();
  await assert.rejects(oldForm.props.onCreate("Old stale name", "Old stale field"), /Return to this catalog form/);
  tree = fixture.render(); assert.equal(component(tree, "ProjectCatalogDialog").key, newForm.key); assert.equal(fixture.calls.length, 0);
  assert.equal(element(component(tree, "ProjectCatalogDialog").props.feedback, "catalog-project-crs").props.value, "LOCAL:new-owner");
});
test("same-event busy guard refuses selection before React rerenders", async () => {
  let release!: (opened: boolean) => void;
  const fixture = ui(fixtureWorkspace(), { activeContext: { ...EMPTY_CATALOG_SELECTION, clientId: "customer" }, openDesign: () => new Promise<boolean>(resolve => { release = resolve; }) });
  let tree = fixture.render(); const before = element(tree, "catalog-new").props.label;
  element(tree, "catalog-recent-open-design").props.onPress(); element(tree, "catalog-recent-design").props.onPress();
  tree = fixture.render(); assert.equal(element(tree, "catalog-new").props.label, before); assert.equal(find(tree, item => item.props.testID === "catalog-delete-design"), null);
  release(false); await flush();
});
test("actual command-backed management creates customer/project/field/draft, edits, renames, moves and deletes without implicit Open", async () => {
  let workspace = emptyWorkspaceDocument(); const commands: WorkspaceCommand[] = [];
  const fixture = ui(workspace, { activeContext: null, executeCatalog: async command => {
    const result = applyWorkspaceCommand(workspace, command); workspace = result.workspace; commands.push(command); fixture.props.repository = status(workspace); return result.value;
  } });
  let tree = fixture.render(); element(tree, "catalog-new").props.onPress(); tree = fixture.render();
  await component(tree, "ClientProfileDialog").props.onSave({ primaryContactFirstName: "Actual", primaryContactLastName: "Operator", companyName: "Named company" });
  tree = fixture.render(); assert.equal(element(tree, "catalog-new").props.label, "New project"); element(tree, "catalog-new").props.onPress(); tree = fixture.render();
  let form = component(tree, "ProjectCatalogDialog"); element(form.props.feedback, "catalog-project-crs").props.onChangeText("LOCAL:entered-project");
  tree = fixture.render(); await component(tree, "ProjectCatalogDialog").props.onCreate("Entered project", "Visible first field");
  tree = fixture.render(); assert.equal(element(tree, "catalog-new").props.label, "New design"); element(tree, "catalog-new").props.onPress(); tree = fixture.render();
  await component(tree, "ProjectCatalogDialog").props.onCreate("Entered incomplete design"); tree = fixture.render();
  assert.equal(workspace.catalog.designs[0].kind, "draft"); assert.equal(fixture.opens.length, 0);
  element(tree, "catalog-edit-customer").props.onPress(); tree = fixture.render();
  await component(tree, "ClientProfileDialog").props.onSave({ primaryContactFirstName: "Edited", primaryContactLastName: "Operator", companyName: "Named company" });
  tree = fixture.render(); element(tree, `catalog-project-${workspace.catalog.projects[0].id}`).props.onPress(); tree = fixture.render();
  element(tree, "catalog-rename-project").props.onPress(); tree = fixture.render(); await component(tree, "ProjectCatalogDialog").props.onCreate("Renamed project");
  assert.equal(workspace.catalog.projects[0].name, "Renamed project"); tree = fixture.render();
  const projectId = workspace.catalog.projects[0].id; element(tree, `catalog-project-${projectId}`).props.onPress(); tree = fixture.render();
  assert.equal(element(tree, "catalog-new").props.label, "New field"); element(tree, "catalog-new").props.onPress(); tree = fixture.render(); await component(tree, "ProjectCatalogDialog").props.onCreate("Second entered field");
  assert.equal(workspace.catalog.fieldMaps.length, 2);
  // A second customer is created through the same actual queue, then selected as move destination.
  const second = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "destination", input: { primaryContactFirstName: "Move", primaryContactLastName: "Destination" } }); workspace = second.workspace; fixture.props.repository = status(workspace); tree = fixture.render();
  element(tree, "catalog-move-project").props.onPress(); tree = fixture.render(); element(tree, "catalog-move-to-destination").props.onPress(); tree = fixture.render(); element(tree, "catalog-move-confirm").props.onPress(); await flush();
  assert.equal(workspace.catalog.projects[0].clientId, "destination"); assert.equal(workspace.catalog.fieldMaps.length, 2); assert.equal(workspace.catalog.designs.length, 1);
  tree = fixture.render(); element(tree, `catalog-recent-${workspace.catalog.designs[0].id}`).props.onPress(); tree = fixture.render();
  element(tree, "catalog-delete-design").props.onPress(); tree = fixture.render(); await component(tree, "ConfirmActionDialog").props.onConfirm(); tree = fixture.render(); assert.equal(workspace.catalog.designs.length, 0);
  element(tree, "catalog-delete-project").props.onPress(); tree = fixture.render(); await component(tree, "ConfirmActionDialog").props.onConfirm(); tree = fixture.render(); assert.equal(workspace.catalog.projects.length, 0); assert.equal(workspace.catalog.fieldMaps.length, 0);
  element(tree, "catalog-delete-customer").props.onPress(); tree = fixture.render(); await component(tree, "ConfirmActionDialog").props.onConfirm(); assert.equal(workspace.catalog.clients.length, 1);
  assert.deepEqual(commands.map(command => command.type), ["create_client", "create_project_with_initial_field_map", "create_design_draft", "update_client", "rename_project", "create_field_map_record", "move_project_to_client", "delete_design", "delete_project", "delete_client"]);
  assert.equal(fixture.opens.length, 0);
});
test("project move pins original context and retains destination after stale revision or guarded owner refusal", async () => {
  let closed = 0;
  const fixture = ui(fixtureWorkspace(), { closeDesign: () => { closed++; return false; } });
  let tree = fixture.render(); element(tree, "catalog-move-project").props.onPress(); tree = fixture.render(); element(tree, "catalog-move-to-other").props.onPress();
  fixture.props.repository = { ...fixture.props.repository, catalogRevision: fixture.props.repository.catalogRevision! + 1 }; tree = fixture.render();
  element(tree, "catalog-move-confirm").props.onPress(); await flush(); tree = fixture.render(); assert.equal(fixture.calls.length, 0); assert.equal(closed, 0);
  assert.equal(element(tree, "catalog-move-to-other").props.selected, true); assert.match(text(tree), /Recheck the move/);
  element(tree, "catalog-move-recheck").props.onPress(); tree = fixture.render(); element(tree, "catalog-move-confirm").props.onPress(); await flush();
  tree = fixture.render(); assert.equal(fixture.calls.length, 0); assert.equal(closed, 1); assert.equal(element(tree, "catalog-move-to-other").props.selected, true);
});
function browserFileFixture() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  let file: { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> } | null = null;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
    const callbacks = new Map<string, () => void>();
    return { files: file ? [file] : [], addEventListener: (name: string, callback: () => void) => callbacks.set(name, callback),
      click: () => callbacks.get(file ? "change" : "cancel")?.() };
  } } });
  return {
    choose(document: string, name = "source.json") { const bytes = new TextEncoder().encode(document); file = { name, size: bytes.length, arrayBuffer: async () => bytes.buffer as ArrayBuffer }; },
    failRead() { file = { name: "unreadable.json", size: 20, arrayBuffer: async () => { throw new Error("Synthetic file read failure"); } }; },
    restore() { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); },
  };
}
test("legacy upload failure retains exact source/name/destination, successful queued copy stays separate from explicit Open", async () => {
  const file = browserFileFixture(), source = `\n${serializeDesignDraftDocument(newDesignDraft("source-id", "Source draft", "metric"))}\n`;
  const commands: WorkspaceCommand[] = []; let fail = true;
  const fixture = ui(fixtureWorkspace(), { executeCatalog: async command => { commands.push(command); if (fail) throw new Error("Synthetic import write failure"); return undefined; } });
  try {
    file.choose(source); let tree = fixture.render(); element(tree, "catalog-import").props.onPress(); await flush(); tree = fixture.render();
    element(tree, "workspace-import-name").props.onChangeText(" Raw retained name "); tree = fixture.render(); element(tree, "workspace-import-save").props.onPress(); await flush();
    tree = fixture.render(); assert.equal(element(tree, "workspace-import-name").props.value, " Raw retained name "); assert.equal(element(tree, "workspace-import-field-field").props.selected, true);
    assert.match(text(tree), /import write failure/); assert.equal(fixture.opens.length, 0);
    assert.equal(commands[0].type, "import_design_document"); if (commands[0].type === "import_design_document") { assert.equal(commands[0].document, source); assert.equal(commands[0].name, "Raw retained name"); }
    fail = false; element(tree, "workspace-import-save").props.onPress(); await flush(); tree = fixture.render();
    assert(element(tree, "workspace-import-open")); assert.equal(fixture.opens.length, 0); assert.equal(fixture.pending.at(-1)?.dirty, false);
    element(tree, "workspace-import-open").props.onPress(); await flush(); assert.equal(fixture.opens.length, 1);
  } finally { file.restore(); }
});
test("unfinished upload remains dirty and cannot use the guarded Open activity exception", async () => {
  const file = browserFileFixture(), fixture = ui();
  try {
    file.choose(serializeDesignDraftDocument(newDesignDraft("pending-upload", "Retained upload", "metric")));
    let tree = fixture.render(); const staleOpen = element(tree, "catalog-recent-open-design").props.onPress;
    element(tree, "catalog-import").props.onPress(); await flush(); staleOpen(); await flush(); tree = fixture.render();
    assert.equal(fixture.opens.length, 0); assert.equal(fixture.pending.at(-1)?.dirty, true);
    assert(element(tree, "workspace-import-save")); assert.equal(element(tree, "workspace-import-name").props.value, "Retained upload copy");
    assert.match(text(tree), /entered form or import review/);
  } finally { file.restore(); }
});
test("rejected replacement and unreadable file retire the old admitted upload; no previous source can be submitted", async () => {
  const file = browserFileFixture(), fixture = ui();
  try {
    file.choose(serializeDesignDraftDocument(newDesignDraft("old", "Old admitted source", "metric")));
    let tree = fixture.render(); element(tree, "catalog-import").props.onPress(); await flush(); tree = fixture.render(); const retiredSave = element(tree, "workspace-import-save").props.onPress;
    file.choose('{"documentVersion":"unsupported"}'); element(tree, "catalog-import").props.onPress(); await flush(); tree = fixture.render();
    assert.equal(find(tree, item => item.props.testID === "workspace-import-save"), null); assert.doesNotMatch(text(tree), /Old admitted source/); assert.equal(fixture.calls.length, 0);
    retiredSave(); await flush(); assert.equal(fixture.calls.length, 0, "old save callback cannot revive replaced source");
    file.failRead(); element(tree, "catalog-import").props.onPress(); await flush(); tree = fixture.render();
    assert.equal(find(tree, item => item.props.testID === "workspace-import-save"), null); assert.match(text(tree), /file read failure/); assert.equal(fixture.calls.length, 0);
  } finally { file.restore(); }
});
test("hidden catalog cannot admit a delayed file or invoke explicit Open", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document"); let release!: (buffer: ArrayBuffer) => void;
  const bytes = new TextEncoder().encode(serializeDesignDraftDocument(newDesignDraft("late", "Late source", "metric")));
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => { let change!: () => void; return {
    files: [{ name: "late.json", size: bytes.length, arrayBuffer: () => new Promise<ArrayBuffer>(resolve => { release = resolve; }) }],
    addEventListener: (name: string, callback: () => void) => { if (name === "change") change = callback; }, click: () => change(),
  }; } } });
  const fixture = ui();
  try {
    let tree = fixture.render(); element(tree, "catalog-import").props.onPress(); fixture.render();
    assert.equal(fixture.pending.at(-1)?.busy, true, "unrelated upload reads still participate in the parent busy guard");
    fixture.props.visible = false; fixture.render();
    release(bytes.buffer as ArrayBuffer); await flush(); tree = fixture.render();
    assert.equal(find(tree, item => item.props.testID === "workspace-import-save"), null); assert.equal(fixture.calls.length, 0);
    element(tree, "catalog-recent-open-design").props.onPress(); await flush(); assert.equal(fixture.opens.length, 0);
  } finally { if (previous) Object.defineProperty(globalThis, "document", previous); else Reflect.deleteProperty(globalThis, "document"); }
});
test("supplied legacy catalog status avoids second repository hooks and leaves lifecycle guards in the body", () => {
  const repository = status(fixture()); fallbackRepositoryCalls = 0;
  const archive = archiveModule!.CatalogArchiveImport({ fieldMapId: "field", repository, onOpenDesign: () => {}, onClose: () => {} });
  const layout = layoutModule!.LayoutSessionCatalog({ fieldMapId: "field", repository, onOpenSession: () => {}, onClose: () => {} });
  assert.equal(archive.props.repository, repository); assert.equal(layout.props.repository, repository);
  new HookFixture().renderComponent(archive.type as (props: any) => React.ReactElement, archive.props);
  new HookFixture().renderComponent(layout.type as (props: any) => React.ReactElement, layout.props);
  assert.equal(fallbackRepositoryCalls, 0); assert.match((archive.type as Function).name, /Body/); assert.match((layout.type as Function).name, /Body/);
});
