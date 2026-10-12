import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { type TestContext } from "node:test";
import React from "react";
import { convertPivotProjectToFieldDesign, createFieldLayoutTarget, serializeFieldLayoutTarget, sampleProject,
  parseLayoutSessionDocument, parseDesignDraftDocument, parseSurveyCollectionDocument, createSurveyCollection, formatDistanceInputValue, parseDistanceInput, type LayoutSession } from "@cplayout/core";
import { applyWorkspaceCommand, type WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, validateWorkspaceDocument, type WorkspaceDocument } from "../../../../packages/project-store/src/workspaceDocument";
import { buildDesignWorkspaceBundle, parseDesignWorkspaceBundle, type DesignWorkspaceBundle } from "../../../../packages/project-store/src/designWorkspaceBundle";
import { createInputRetentionBaseline, InputRetentionProvider } from "../inputRetention";
import { newDesignDraft } from "../newDesignDraft";
import type { ProjectWorkspaceStatus, SaveFeedbackOwner } from "../hooks/useProjectRepository";
import type { WorkspaceRepositoryAccess } from "./WorkspaceRepositoryContext";
import { workflowTestField, workflowTestPoint, workflowTestTime } from "../../../../packages/core/src/productionWorkflowTestFixtures";
import { ReceiverSessionOwner } from "../gnss/receiverSessionOwner";
import type { GnssTransportEvent, GnssSession } from "@cplayout/gnss";

type Controller = ReturnType<typeof import("./useWorkspaceController")["useWorkspaceController"]>;
type Slot = { kind: string; value: any; dependencies?: readonly unknown[]; cleanup?: () => void };
let active: ControllerFixture | null = null;
let boundaryOwner: ControllerFixture | null = null;
const displayDerivations = { target: 0, official: 0, records: 0, readiness: 0, admission: 0 };
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
  includeLayoutPanel = false; layoutTree: React.ReactNode = null;
  includeSurveyInformation = false; surveyInformationTree: React.ReactNode = null;
  surveyInformationHookStart: number | null = null;
  includeCatalog = false; catalogTree: React.ReactNode = null; catalogCloses = 0;
  access: WorkspaceRepositoryAccess = { repository: null as unknown as WorkspaceRepositoryAccess["repository"], actorId: null, storage: null, partition: "synthetic-test", visible: true };
  receiverClock = 1000; receiverSequence = 0;
  receiverQueue: GnssTransportEvent[] = []; receiverWake: ((event: GnssTransportEvent) => void) | null = null;
  receiverSession: GnssSession = { id: "synthetic-owned-receiver", events: async function* (this: GnssSession) { throw new Error("Fixture installs its actual event source before connection"); }, close: async () => { this.receiverPush({ type: "ended", reason: "closed" }); } };
  receiverOwner = new ReceiverSessionOwner(() => ({ open: async () => {
    const fixture = this; this.receiverSession.events = async function* () { while (true) { const event = fixture.receiverQueue.shift() ?? await new Promise<GnssTransportEvent>(resolve => { fixture.receiverWake = resolve; }); yield event; if (event.type === "ended") return; } };
    return this.receiverSession;
  } }), () => this.receiverClock);
  receiverPush(event: GnssTransportEvent) { const wake = this.receiverWake; this.receiverWake = null; if (wake) wake(event); else this.receiverQueue.push(event); }
  async fixedReceiver(quality = 4) {
    if (this.receiverOwner.getSnapshot().phase === "idle") await this.receiverOwner.connect({ method: "usb", baudRate: 115200 });
    this.receiverClock += 100; const time = `1200${String(++this.receiverSequence).padStart(2, "0")}`;
    const body = `GNGGA,${time},4000.0000,N,10500.0000,W,${quality},12,0.8,1600,M,-20,M,0.5,0001`;
    let checksum = 0; for (const character of body) checksum ^= character.charCodeAt(0);
    this.receiverPush({ type: "bytes", bytes: new TextEncoder().encode(`$${body}*${checksum.toString(16).padStart(2, "0")}\r\n`), receivedAt: new Date().toISOString(), receivedMonotonicMs: this.receiverClock });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  slot(kind: string, initial: () => any): Slot {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = { kind, value: initial() };
    const slot = this.slots[index]; assert.equal(slot.kind, kind, `Hook slot ${index} changed owner`); return slot;
  }
  repository = (() => { const fixtureOwner = this; return {
    get layoutSessions() { return fixtureOwner.workspace.layoutSessions?.map(entry => parseLayoutSessionDocument(entry.document)) ?? []; },
    get catalog() { return fixtureOwner.workspace.catalog; },
    get designCatalog() { return fixtureOwner.workspace.catalog; },
    get catalogRevision() { return fixtureOwner.workspace.revision; },
    get workspaceVersion() { return fixtureOwner.workspace.workspaceVersion; },
    // Describes the simulated supported web command boundary; no browser durability proof.
    backendInfo: { backendLabel: "Synthetic web command boundary", runtime: "web", storageEngine: "local_storage", durable: true,
      supportsProjectList: true, supportsZipImport: true, supportsZipExport: true, notes: ["Repository I/O is simulated; commands use the real reducer."] },
    readWorkspace: async () => {
      this.reads++;
      const deferred = this.nextRead; this.nextRead = null;
      return deferred ? deferred() : this.workspace;
    },
    refreshProjects: async () => {},
    executeWorkspaceCommand: async (command: WorkspaceCommand, revision: number, owner?: SaveFeedbackOwner) => {
      const pause = this.beforeWrite; this.beforeWrite = null; if (pause) await pause();
      if (owner && !owner.isCurrent()) throw new Error("Repository refused a retired command owner");
      assert.equal(revision, this.workspace.revision, "Controller must use the latest acknowledged workspace revision");
      if (this.quotaError) throw this.quotaError;
      const receipt = applyWorkspaceCommand(this.workspace, command);
      this.workspace = receipt.workspace; this.writes.push(command); return receipt;
    },
  }; })() as unknown as ProjectWorkspaceStatus;
  render(): Controller {
    for (let pass = 0; pass < 12; pass++) {
      this.cursor = 0; this.effects = []; this.changed = false; active = this; boundaryOwner = this;
      try {
        this.controller = useWorkspaceController();
        if (this.includeLayoutPanel) this.layoutTree = (WorkspaceLayoutPanel as unknown as { render(props: { controller: Controller }, ref: null): React.ReactElement }).render({ controller: this.controller }, null);
        if (this.includeCatalog) this.catalogTree = WorkspaceCatalog({ repository: this.repository, visible: true, presentation: "embedded", activeContext: this.controller.state.editable?.identity,
          onUserIntent: this.controller.noteUserIntent, getLocalIntentReceipt: this.controller.getLocalIntentReceipt, executeCatalog: this.controller.executeCatalog,
          openDesign: this.controller.openDesign, openLayoutSession: this.controller.openLayoutSession, closeDesign: this.controller.closeDesign, closeLayout: this.controller.closeLayout,
          importDesignWorkspace: this.controller.importDesignWorkspace, onClose: () => { this.catalogCloses++; } });
        if (this.includeSurveyInformation) {
          // Use the actual parent JSX admission; a direct call in Design would
          // miss the production unmount that retires this child input owner.
          const parent = WorkspaceSurveyPanel({ controller: this.controller });
          const child = findElement(parent, node => node.type === SurveyKnownInformationPanel);
          if (child) { this.surveyInformationHookStart = this.cursor; this.surveyInformationTree = SurveyKnownInformationPanel({ controller: this.controller }); }
          else {
            this.surveyInformationTree = null;
            if (this.surveyInformationHookStart !== null) {
              this.slots.splice(this.surveyInformationHookStart).forEach(slot => slot.cleanup?.());
              this.surveyInformationHookStart = null;
            }
          }
        }
      } finally { active = null; }
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
  useContext<T>(context: React.Context<T>) {
    if (!active) return React.useContext(context);
    active.slot("useContext", () => undefined);
    return active.access as T;
  },
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
  useLayoutEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]) {
    if (!active) return React.useLayoutEffect(effect, dependencies);
    const owner = active, slot = owner.slot("useLayoutEffect", () => undefined);
    if (!sameDependencies(slot.dependencies, dependencies)) {
      owner.effects.push(() => { slot.cleanup?.(); const cleanup = effect(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; }); slot.dependencies = dependencies;
    }
  },
  useImperativeHandle<T>(ref: React.Ref<T> | undefined, factory: () => T, dependencies?: readonly unknown[]) {
    if (!active) return React.useImperativeHandle(ref, factory, dependencies);
    active.slot("useImperativeHandle", () => undefined);
    if (typeof ref === "function") ref(factory()); else if (ref) (ref as React.MutableRefObject<T>).current = factory();
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
  if (name === "../gnss/receiverSessionOwner") return { ...originalLoad(name, parent, isMain), createBrowserReceiverSessionOwner() { assert(boundaryOwner); return boundaryOwner.receiverOwner; } };
  if (name === "@cplayout/core") {
    const actual = originalLoad(name, parent, isMain) as typeof import("@cplayout/core");
    return { ...actual,
      parseFieldLayoutTarget: (...args: Parameters<typeof actual.parseFieldLayoutTarget>) => { displayDerivations.target++; return actual.parseFieldLayoutTarget(...args); },
      isOfficialLayoutSession: (...args: Parameters<typeof actual.isOfficialLayoutSession>) => { displayDerivations.official++; return actual.isOfficialLayoutSession(...args); },
      layoutFinalizationRecords: (...args: Parameters<typeof actual.layoutFinalizationRecords>) => { displayDerivations.records++; return actual.layoutFinalizationRecords(...args); } };
  }
  if (name === "./workspaceProductionCapabilities") {
    const actual = originalLoad(name, parent, isMain) as typeof import("./workspaceProductionCapabilities");
    return { ...actual, workspaceLayoutAdmission: (...args: Parameters<typeof actual.workspaceLayoutAdmission>) => { displayDerivations.admission++; return actual.workspaceLayoutAdmission(...args); } };
  }
  if (name === "@cplayout/project-store") return { ...originalLoad(name, parent, isMain), exportFileAsync: async (filename: string, bytes: string | Uint8Array) => {
    assert(boundaryOwner); boundaryOwner.exports.push({ filename, bytes }); return { ok: true, message: "Synthetic export boundary accepted" };
  }, getSurveyReadiness: (...args: Parameters<typeof import("@cplayout/project-store")["getSurveyReadiness"]>) => {
    displayDerivations.readiness++; return originalLoad(name, parent, isMain).getSurveyReadiness(...args);
  } };
  return originalLoad(name, parent, isMain);
};
let useWorkspaceController: typeof import("./useWorkspaceController")["useWorkspaceController"];
let WorkspaceLayoutPanel: typeof import("./WorkspaceModePanels")["WorkspaceLayoutPanel"];
let WorkspaceSurveyPanel: typeof import("./WorkspaceModePanels")["WorkspaceSurveyPanel"];
let WorkspaceCatalog: typeof import("./WorkspaceCatalog")["WorkspaceCatalog"];
let SurveyKnownInformationPanel: typeof import("./SurveyKnownInformationPanel")["SurveyKnownInformationPanel"];
try { ({ useWorkspaceController } = require("./useWorkspaceController")); ({ WorkspaceLayoutPanel, WorkspaceSurveyPanel } = require("./WorkspaceModePanels")); ({ WorkspaceCatalog } = require("./WorkspaceCatalog")); ({ SurveyKnownInformationPanel } = require("./SurveyKnownInformationPanel")); } finally { loader._load = originalLoad; }

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
function findElement(node: React.ReactNode, predicate: (node: React.ReactElement<Record<string, any>>) => boolean): React.ReactElement<Record<string, any>> | null {
  if (Array.isArray(node)) { for (const child of node) { const value = findElement(child, predicate); if (value) return value; } return null; }
  if (!React.isValidElement<Record<string, any>>(node)) return null;
  return predicate(node) ? node : findElement(node.props.children, predicate);
}
function panelControl(tree: React.ReactNode, id: string): React.ReactElement<Record<string, any>> {
  const control = findElement(tree, node => node.props.testID === id || node.props.accessibilityLabel === id || node.props.label === id); assert(control, `Missing actual Layout control ${id}`); return control;
}
test("unreviewed real field opens its saved v1 Layout through Catalog and supports read/export/metadata without new capture admission", async t => {
  const f = fixture(t); let controller = await f.openDesign(); controller.selectMode("layout"); controller = f.render(); assert.equal(controller.state.presentation.mode, "design");
  const original = savedLayout(f), workspace = f.workspace; f.includeCatalog = true; controller = f.render();
  await new Promise<void>(resolve => setImmediate(resolve)); f.render();
  panelControl(f.catalogTree, "catalog-layout-sessions").props.onPress(); f.render();
  panelControl(f.catalogTree, "catalog-layout-open-layout").props.onPress(); await new Promise<void>(resolve => setImmediate(resolve)); controller = f.render();
  assert.equal(controller.state.presentation.mode, "layout"); assert.equal(controller.state.layout!.session.id, original.id); assert.equal(controller.state.layout!.session.documentVersion, "layout-session-v1");
  assert.equal(controller.state.layout!.session.targetDocument, original.targetDocument); assert.equal(f.catalogCloses, 1); assert.equal(f.workspace, workspace); assert.equal(f.writes.length, 0);
  assert.equal((await controller.exportLayoutSession("json")).ok, true); assert.deepEqual(parseLayoutSessionDocument(f.exports[0].bytes as string), original);
  controller = f.render(); assert.equal(await controller.renameLayout("Reviewed historical plan name"), true); controller = f.render();
  assert.equal(controller.state.layout!.session.name, "Reviewed historical plan name"); assert.equal(controller.state.layout!.session.targetDocument, original.targetDocument); assert.deepEqual(controller.state.layout!.session.observations, original.observations); assert.equal(controller.layoutAdmission.ready, false); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].type, "rename_layout_session");
  assert.equal(f.workspace.surveyReviews, undefined);
});

test("actual tolerance handler pins invalid raw to its session and refuses Open B until explicit Discard", async t => {
  const f = fixture(t); f.includeLayoutPanel = true; f.access = { ...f.access, actorId: "synthetic-operator" };
  const apply = (command: WorkspaceCommand) => { f.workspace = applyWorkspaceCommand(f.workspace, command).workspace; };
  apply({ type: "upgrade_workspace_to_v5", now }); const field = workflowTestField();
  apply({ type: "create_field_design", now, designId: "target-design", fieldMapId: "map", name: field.name, field });
  apply({ type: "create_survey_collection", now: workflowTestTime, expectedDesignRevision: 0, collection: createSurveyCollection({ id: "target-control", now: workflowTestTime,
    owner: { designId: "target-design", documentKind: "field", payloadId: field.id, fieldMapId: "map", projectCrs: field.projectCrs }, purpose: { kind: "point", role: "control" } }) });
  apply({ type: "append_survey_capture", now: workflowTestTime, collectionId: "target-control", expectedCollectionRevision: 0, expectedDesignRevision: 0, point: workflowTestPoint(19) });
  apply({ type: "review_survey", now: workflowTestTime, reviewId: "target-review", designId: "target-design", expectedDesignRevision: 1, includedCollectionIds: ["target-control"], excludedCollectionIds: [], completedBy: "synthetic-operator" });
  for (const id of ["layout-a", "layout-b"]) apply({ type: "create_reviewed_layout_session", now: workflowTestTime, sessionId: id, name: id, designId: "target-design", expectedDesignRevision: 1, reviewId: "target-review", selectedMachineIds: [field.machines[0].id] });
  let controller = await f.openDesign(); assert.equal(await controller.openLayoutSession("layout-a"), true); controller = f.render();
  const before = f.workspace, session = controller.state.layout!.session, reads = f.reads;
  panelControl(f.layoutTree, "layout-tolerance").props.onChangeText("  invalid feet literal  ");
  assert.equal(controller.pendingInput("layout-tolerance"), true); assert.equal(await controller.openLayoutSession("layout-b"), false); controller = f.render();
  assert.equal(controller.state.layout!.session, session); assert.equal(panelControl(f.layoutTree, "layout-tolerance").props.value, "  invalid feet literal  "); assert.equal(f.reads, reads); assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
  f.access = { ...f.access, roles: ["operator"], permissions: ["field:read"] }; controller = f.render();
  assert.equal(panelControl(f.layoutTree, "layout-tolerance").props.editable, false); assert.equal(panelControl(f.layoutTree, "layout-collect").props.disabled, true); assert.equal(panelControl(f.layoutTree, "layout-discard-tolerance").props.disabled, false);
  panelControl(f.layoutTree, "layout-discard-tolerance").props.onPress(); controller = f.render(); assert.equal(controller.pendingInput("layout-tolerance"), false);
  assert.equal(await controller.openLayoutSession("layout-b"), true); controller = f.render(); assert.equal(controller.state.layout!.session.id, "layout-b"); assert.equal(panelControl(f.layoutTree, "layout-tolerance").props.value, ""); assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
});
function archiveState(f: ControllerFixture, archived = false): NonNullable<WorkspaceRepositoryAccess["archives"]> {
  return { workspaceId: "synthetic-workspace", revision: f.workspace.revision,
    customers: f.workspace.catalog.clients.map(item => ({ id: item.id, displayName: item.displayName, archived: false })),
    projects: f.workspace.catalog.projects.map(item => ({ id: item.id, clientId: item.clientId, name: item.name, archived, individuallyArchived: archived })) };
}
function blankProductionWorkspace(): WorkspaceDocument {
  let workspace = emptyWorkspaceDocument(); const apply = (command: WorkspaceCommand) => { workspace = applyWorkspaceCommand(workspace, command).workspace; };
  apply({ type: "create_client", now, id: "customer", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
  apply({ type: "upgrade_workspace_to_v5", now });
  apply({ type: "start_project_work", now, clientId: "customer", projectId: "project", fieldMapId: "map", designId: "design", draftId: "draft", projectName: "Actual entered project", fieldName: "Actual entered field", workName: "Actual entered work", unitSystem: "metric", initialMode: "design" });
  return workspace;
}
function readySurveyWorkspace(): WorkspaceDocument {
  let workspace = blankProductionWorkspace(); const apply = (command: WorkspaceCommand) => { workspace = applyWorkspaceCommand(workspace, command).workspace; };
  apply({ type: "declare_work_crs", designId: "design", expectedDesignRevision: 0, projectCrs: "EPSG:32613", now });
  const owner = { designId: "design", documentKind: "draft" as const, payloadId: "draft", fieldMapId: "map", projectCrs: "EPSG:32613" };
  const revision = () => workspace.catalog.designs.find(item => item.id === "design")!.revision;
  apply({ type: "create_survey_collection", expectedDesignRevision: revision(), collection: createSurveyCollection({ id: "actual-boundary", owner, purpose: { kind: "field_boundary" }, now }), now });
  for (const [index, coordinate] of [[40, -105], [40, -104.999], [40.001, -105]].entries()) apply({ type: "append_survey_capture", collectionId: "actual-boundary", expectedCollectionRevision: index, expectedDesignRevision: revision(), point: workflowTestPoint(index + 1, "control", coordinate[0], coordinate[1]), now });
  apply({ type: "apply_survey_collection", collectionId: "actual-boundary", expectedCollectionRevision: 3, expectedDesignRevision: revision(), applicationId: "applied-boundary", now });
  apply({ type: "create_survey_collection", expectedDesignRevision: revision(), collection: createSurveyCollection({ id: "actual-pivot", owner, purpose: { kind: "point", role: "pivot_center" }, now }), now });
  const point = workflowTestPoint(4, "pivot_center", 40.0002, -104.9998); apply({ type: "append_survey_capture", collectionId: "actual-pivot", expectedCollectionRevision: 0, expectedDesignRevision: revision(), point, now });
  apply({ type: "bind_recorded_pivot", designId: "design", expectedDesignRevision: revision(), collectionId: "actual-pivot", expectedCollectionRevision: 1, pointId: point.id, now });
  const draft = parseDesignDraftDocument(workspace.draftDocuments.find(item => item.id === "draft")!.document);
  draft.machine = { id: "supplied-machine", name: "Actual supplied machine", spanLengthsMeters: [61], overhangMeters: 0, endGunThrowMeters: 0, towerClearanceBufferMeters: 0, machineClearanceBufferMeters: 0, sweep: { mode: "full_circle" } };
  apply({ type: "save_design_draft", designId: "design", expectedDesignRevision: revision(), draft, now });
  apply({ type: "review_survey", designId: "design", expectedDesignRevision: revision(), reviewId: "actual-source-review", includedCollectionIds: ["actual-boundary", "actual-pivot"], excludedCollectionIds: [], completedBy: "operator", now });
  return workspace;
}

for (const operation of ["review", "prepare"] as const) for (const boundary of ["read", "commit"] as const) test(`${operation} Survey callback refuses mode ABA during delayed ${boundary} without writing or replacing current work`, async t => {
  const f = fixture(t); f.workspace = readySurveyWorkspace(); f.access = { ...f.access, actorId: "operator" }; let controller = await f.openDesign(); controller.selectMode("survey"); controller = f.render();
  const before = f.workspace, editor = controller.state.editable!.editor; let release!: () => void; let started: Promise<void>;
  if (boundary === "read") { const held = f.holdRead(); started = held.started; release = held.release; }
  else { let entered!: () => void; started = new Promise<void>(resolve => { entered = resolve; }); f.beforeWrite = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); }; }
  const job = operation === "review" ? controller.completeSurvey(["actual-boundary", "actual-pivot"]) : controller.prepareSurveyedField(); await started;
  controller.selectMode("design"); f.render(); controller.selectMode("survey"); f.render(); release(); assert.equal(await job, false); controller = f.render();
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0); assert.equal(controller.state.editable!.editor, editor); assert.equal(controller.state.editable!.kind, "draft"); assert.equal(controller.state.presentation.mode, "survey");
});

test("direct Survey preparation opens only its owned Field and explicitly requires destination review before Layout", async t => {
  const f = fixture(t); f.workspace = readySurveyWorkspace(); f.access = { ...f.access, actorId: "operator" }; let controller = await f.openDesign(); controller.selectMode("survey"); controller = f.render();
  assert.equal(await controller.prepareSurveyedField(), true); controller = f.render(); assert.equal(controller.state.presentation.mode, "survey"); assert.equal(controller.state.editable!.kind, "field"); assert.equal(controller.surveyReadiness!.status, "needs_review");
  assert.equal(f.workspace.projectDocuments.length, 0); assert.equal(f.workspace.workflowConversions!.at(-1)!.source.kind, "draft");
  assert.equal(await controller.completeSurvey(controller.state.collections.map(item => item.id)), true); controller = f.render(); assert.equal(controller.surveyReadiness!.status, "ready"); controller.selectMode("layout"); controller = f.render();
  await f.fixedReceiver(); controller = f.render(); assert.equal(await controller.createLayoutSession("Actual Layout"), true); controller = f.render(); assert.equal(controller.state.layout!.session.documentVersion, "layout-session-v3");
});

test("static Layout validation is reused across age renders while live freshness, raw ownership and new source admission remain current", async t => {
  const f = fixture(t); f.includeLayoutPanel = true; f.workspace = readySurveyWorkspace(); f.access = { ...f.access, actorId: "operator" };
  const originalInterval = globalThis.setInterval, originalClear = globalThis.clearInterval;
  const intervals = new Map<unknown, number>();
  globalThis.setInterval = ((callback: () => void, delay?: number, ...args: unknown[]) => {
    const timer = originalInterval(callback, delay, ...args); intervals.set(timer, delay ?? 0); return timer;
  }) as typeof globalThis.setInterval;
  globalThis.clearInterval = ((timer: Parameters<typeof globalThis.clearInterval>[0]) => {
    intervals.delete(timer); originalClear(timer);
  }) as typeof globalThis.clearInterval;
  try {
    let controller = await f.openDesign(); assert.equal(intervals.size, 0);
    controller.selectMode("survey"); controller = f.render(); assert.equal(await controller.prepareSurveyedField(), true); controller = f.render();
    assert.equal(await controller.completeSurvey(controller.state.collections.map(item => item.id)), true); controller = f.render(); controller.selectMode("layout"); controller = f.render();
    await f.fixedReceiver(); controller = f.render(); assert.equal(intervals.size, 2); assert.equal(await controller.createLayoutSession("Actual memo proof"), true); controller = f.render();
    const staticCalls = { ...displayDerivations }, targetDocument = controller.state.layout!.session.targetDocument, workspace = f.workspace;
    const reusedAt = performance.now(); for (let i = 0; i < 6; i++) controller = f.render();
    console.log(JSON.stringify({ profile: "actual controller/Layout retained hook renders", renders: 6, elapsedMs: Number((performance.now() - reusedAt).toFixed(2)), repeatedStaticDerivations: Object.keys(displayDerivations).reduce((sum, key) => sum + displayDerivations[key as keyof typeof displayDerivations] - staticCalls[key as keyof typeof staticCalls], 0) }));
    assert.deepEqual(displayDerivations, staticCalls); assert.equal(controller.layoutAdmission.ready, true);
    panelControl(f.layoutTree, "layout-tolerance").props.onChangeText(" invalid literal tolerance "); controller = f.render();
    f.receiverClock += 2001; controller = f.render(); assert.equal(panelControl(f.layoutTree, "layout-collect").props.disabled, true);
    assert.equal(panelControl(f.layoutTree, "layout-tolerance").props.value, " invalid literal tolerance "); assert.equal(controller.pendingInput("layout-tolerance"), true);
    assert.equal(controller.state.layout!.session.targetDocument, targetDocument); assert.equal(f.workspace, workspace); assert.deepEqual(displayDerivations, staticCalls);
    f.access = { ...f.access, visible: false }; controller = f.render(); assert.equal(intervals.size, 1);
    f.access = { ...f.access, visible: true }; controller = f.render(); assert.equal(intervals.size, 2);
    await f.receiverOwner.disconnect(); controller = f.render(); assert.equal(intervals.size, 0);
    panelControl(f.layoutTree, "layout-discard-tolerance").props.onPress(); controller = f.render(); controller.selectMode("design"); controller = f.render();
    assert.equal(controller.state.editable!.kind, "field"); if (controller.state.editable!.kind !== "field") throw new Error("Expected actual Field");
    const machine = structuredClone(controller.state.editable!.editor.field.machines[0]); machine.configuration.spanLengthsMeters[0] += 1;
    assert.equal(controller.dispatch({ kind: "field", action: { type: "update_machine", machine } }), true); controller = f.render();
    assert.equal(await controller.save(), true); controller = f.render(); assert.equal(controller.layoutAdmission.ready, false);
    assert(displayDerivations.admission > staticCalls.admission); assert(displayDerivations.readiness > staticCalls.readiness);
    assert.equal(controller.state.layout!.session.targetDocument, targetDocument);
  } finally { f.dispose(); globalThis.setInterval = originalInterval; globalThis.clearInterval = originalClear; }
});

test("initial Layout creation freezes its submitted name while retaining newer owned raw name under the writer lock", async t => {
  const f = fixture(t); f.includeLayoutPanel = true; f.workspace = readySurveyWorkspace(); f.access = { ...f.access, actorId: "operator", fieldMutationsAvailable: true };
  let controller = await f.openDesign(); controller.selectMode("survey"); controller = f.render();
  assert.equal(await controller.prepareSurveyedField(), true); controller = f.render();
  assert.equal(await controller.completeSurvey(controller.state.collections.map(item => item.id)), true); controller = f.render();
  controller.selectMode("layout"); controller = f.render(); assert.equal(controller.state.layout, null);
  await f.fixedReceiver(); controller = f.render();
  panelControl(f.layoutTree, "New Layout session name").props.onChangeText("Submitted name A"); controller = f.render();
  let release!: () => void, entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  f.beforeWrite = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); };
  const actualCreate = controller.createLayoutSession; let saving!: Promise<boolean>;
  controller.createLayoutSession = name => { saving = actualCreate(name); return saving; };
  panelControl(f.layoutTree, "layout-freeze").props.onPress(); await started; controller = f.render();
  assert.equal(panelControl(f.layoutTree, "New Layout session name").props.editable, true);
  assert.equal(panelControl(f.layoutTree, "layout-freeze").props.disabled, true);
  const input = panelControl(f.layoutTree, "New Layout session name"); input.props.onChangeText("Newer literal name B  "); controller = f.render();
  assert.equal(panelControl(f.layoutTree, "New Layout session name").props.value, "Newer literal name B  ");
  f.access = { ...f.access, fieldMutationsAvailable: false }; controller = f.render();
  assert.equal(panelControl(f.layoutTree, "New Layout session name").props.editable, false); input.props.onChangeText("Unavailable overwrite");
  f.access = { ...f.access, fieldMutationsAvailable: true }; controller = f.render(); release(); assert.equal(await saving, true); controller = f.render();
  assert.equal(controller.state.layout!.session.name, "Submitted name A"); assert.equal(controller.state.layout!.session.documentVersion, "layout-session-v3");
  panelControl(f.layoutTree, "Session details & actions").props.onPress(); controller = f.render();
  assert.equal(panelControl(f.layoutTree, "Layout session name").props.value, "Newer literal name B  "); assert.equal(controller.pendingInput("layout-name"), true);
});

test("acknowledged preparation retains its saved child when later mode intent retires automatic opening", async t => {
  const f = fixture(t); f.workspace = readySurveyWorkspace(); f.access = { ...f.access, actorId: "operator" }; let controller = await f.openDesign(); controller.selectMode("survey"); controller = f.render();
  const source = controller.state.editable!.identity.designId, execute = f.repository.executeWorkspaceCommand; let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.repository.executeWorkspaceCommand = async (...args) => { const result = await execute(...args); entered(); await new Promise<void>(resolve => { release = resolve; }); return result; };
  const preparing = controller.prepareSurveyedField(); await started; controller.selectMode("design"); f.render(); controller.selectMode("survey"); f.render(); release(); assert.equal(await preparing, false); controller = f.render();
  assert.equal(controller.state.editable!.identity.designId, source); assert.equal(controller.state.editable!.kind, "draft"); assert.equal(f.workspace.catalog.designs.filter(item => item.kind === "field").length, 1); assert.equal(f.writes.length, 1);
  assert.equal(controller.state.editable!.workspaceRevision, f.workspace.revision);
});
for (const completion of ["apply", "discard"] as const) test(`held measurement-unit handler preserves actual machine text/caret/dirty until ${completion}, while map preferences remain allowed`, async t => {
  const f = fixture(t), project = { ...structuredClone(sampleProject), id: "measurement-project", name: "Synthetic measurement source" };
  f.workspace = applyWorkspaceCommand(f.workspace, { type: "create_project_with_initial_design", now, input: { clientId: "customer", project, fieldMapId: "measurement-field", designId: "measurement-design" } }).workspace;
  let controller = f.render(); assert.equal(await controller.openDesign("measurement-design"), true); controller = f.render();
  assert.equal(controller.setSettings({ ...controller.settings, unitSystem: "us_survey_feet" }), true); controller = f.render();
  const key = "machine:spanRows", baseline = createInputRetentionBaseline(project.machine.spanLengthsMeters.map(value => formatDistanceInputValue(value, controller.settings.unitSystem)));
  controller.inputs.reconcile(key, baseline); const raw = ["unfinished 12'", ...baseline.value.slice(1)]; controller.inputs.set(key, baseline, raw);
  controller.inputs.recordFocus(key); controller.inputs.recordSelection(key, { start: 2, end: 12 }); controller = f.render(); const heldHandler = controller.setSettings, previous = controller.settings;
  assert.equal(heldHandler({ ...previous, unitSystem: "metric" }), false); controller = f.render();
  assert.equal(controller.settings.unitSystem, "us_survey_feet"); assert.equal(controller.inputs.hasDirty(), true);
  controller.inputs.reconcile(key, createInputRetentionBaseline(project.machine.spanLengthsMeters.map(value => formatDistanceInputValue(value, controller.settings.unitSystem))));
  assert.deepEqual(controller.inputs.read(key, baseline), raw); assert.deepEqual(controller.inputs.retainedFocus(), { key, selection: { start: 2, end: 12 } }); assert.match(controller.state.notice!, /Apply or discard entered values/);
  assert.equal(heldHandler({ ...controller.settings, mapStyle: "high_contrast" }), true); controller = f.render(); assert.equal(controller.settings.mapStyle, "high_contrast"); assert.equal(controller.inputs.hasDirty(), true); assert.deepEqual(controller.inputs.read(key, baseline), raw);
  if (completion === "discard") controller.inputs.resetScope(key);
  else {
    const corrected = ["156'", ...baseline.value.slice(1)]; controller.inputs.set(key, baseline, corrected);
    assert(controller.state.editable?.kind === "project"); const machine = { ...controller.state.editable.editor.project.machine, spanLengthsMeters: corrected.map((value, index) => parseDistanceInput(value, "us_survey_feet", `Span ${index + 1}`)) };
    assert.equal(controller.dispatch({ kind: "project", action: { type: "update_machine", machine } }), true); controller = f.render();
    controller.inputs.reconcile(key, createInputRetentionBaseline(machine.spanLengthsMeters.map(value => formatDistanceInputValue(value, controller.settings.unitSystem))));
  }
  controller = f.render(); assert.equal(controller.inputs.hasDirty(), false); assert.equal(controller.setSettings({ ...controller.settings, unitSystem: "metric" }), true); controller = f.render(); assert.equal(controller.settings.unitSystem, "metric"); assert.equal(f.writes.length, 0);
});

test("unit changes also preserve unfinished pane fields and become available after their explicit discard", async t => {
  const f = fixture(t); let controller = await f.openDesign(); const before = controller.settings; controller.setPendingInteractionInput("layout-tolerance", true, true); controller = f.render();
  const other = before.unitSystem === "metric" ? "us_survey_feet" : "metric";
  assert.equal(controller.setSettings({ ...before, unitSystem: other }), false); controller = f.render(); assert.equal(controller.settings.unitSystem, before.unitSystem); assert.equal(controller.pendingInput("layout-tolerance"), true);
  controller.setPendingInteractionInput("layout-tolerance", false, true); controller = f.render(); assert.equal(controller.setSettings({ ...before, unitSystem: other }), true); assert.equal(f.writes.length, 0);
});

test("Survey raw input survives the return to Design; actual Draft Discard clears raw ownership and permits units without phantom pending", async t => {
  const f = fixture(t); f.includeSurveyInformation = true; let controller = await f.openDesign(); const controls = new Map<string, Record<string, any>>();
  const path = require.resolve("../components/DesignDraftInputs"); delete require.cache[path];
  let DraftInputs: typeof import("../components/DesignDraftInputs")["DesignDraftInputs"];
  const host = (tag: string) => (props: Record<string, any>) => { if (props.testID) controls.set(props.testID, props); return React.createElement(tag, null, tag === "input" ? undefined : props.children); };
  try { loader._load = function(name, parent, isMain) {
    if (name === "react-native") return { View: host("div"), Text: host("span"), Pressable: host("button"), TextInput: host("input"), StyleSheet: { create: (value: unknown) => value } };
    if (name === "lucide-react-native") return new Proxy({}, { get: () => () => null });
    if (name === "./CommandSurface") return { IconCommandButton: host("button") };
    return originalLoad(name, parent, isMain);
  }; ({ DesignDraftInputs: DraftInputs } = require(path)); } finally { loader._load = originalLoad; }
  const { renderToStaticMarkup } = require("react-dom/server") as { renderToStaticMarkup(node: React.ReactNode): string };
  const renderDraft = () => {
    controls.clear(); assert(controller.state.editable?.kind === "draft");
    renderToStaticMarkup(React.createElement(InputRetentionProvider, { store: controller.inputs, children: React.createElement(DraftInputs, { editor: controller.state.editable.editor,
      onAction: action => { controller.dispatch({ kind: "draft", action }); } }) }));
  };
  renderDraft(); controls.get("draft-name")!.onChangeText("unfinished 12' x"); renderDraft();
  controls.get("draft-name")!.onFocus(); controls.get("draft-name")!.onSelectionChange({ nativeEvent: { selection: { start: 2, end: 9 } } });
  const focus = controller.inputs.retainedFocus(); const bytes = f.workspace, before = controller.settings, other = before.unitSystem === "metric" ? "us_survey_feet" : "metric";
  controller.selectMode("survey"); controller = f.render();
  const surveyInformation = findElement(f.surveyInformationTree, node => typeof node.props.onPendingChange === "function"); assert(surveyInformation); surveyInformation.props.onPendingChange(true); controller = f.render();
  assert.equal(controller.pendingInput("survey-known-information"), true); controller.selectMode("design"); controller = f.render();
  assert.equal(f.surveyInformationTree, null); assert.equal(controller.pendingInput("survey-known-information"), false);
  assert.equal(controller.setSettings({ ...before, unitSystem: other }), false); controller = f.render(); renderDraft();
  assert.equal(controls.get("draft-name")!.value, "unfinished 12' x"); assert.deepEqual(controller.inputs.retainedFocus(), focus); assert(controller.inputs.hasDirty());
  controls.get("draft-inputs-discard")!.onPress(); controller = f.render(); renderDraft();
  const discarded = controller.state.editable; assert(discarded?.kind === "draft"); assert.equal(controls.get("draft-name")!.value, discarded.editor.draft.name);
  assert.equal(controller.inputs.hasDirty(), false); assert.equal(controller.setSettings({ ...before, unitSystem: other }), true); controller = f.render();
  assert.equal(controller.settings.unitSystem, other); assert.equal(f.workspace, bytes); assert.equal(f.writes.length, 0);
});

test("coordinate declaration refuses retained raw inputs before storage and new private pane text under the writer lock", async t => {
  const f = fixture(t); f.workspace = blankProductionWorkspace(); let controller = await f.openDesign(); const raw = retainRaw(controller); raw.set("  entered field name  "); controller = f.render();
  const before = f.workspace; assert.equal(await controller.declareCoordinateSystem("EPSG:32613"), false); assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
  assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "  entered field name  "); controller.inputs.resetScope("design"); controller = f.render();
  let release!: () => void, entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  f.beforeWrite = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); };
  const choosing = controller.declareCoordinateSystem("EPSG:32613"); await reached;
  controller.setPendingInteractionInput("file-dialog", true, true); f.render(); release(); assert.equal(await choosing, false); controller = f.render();
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0); assert.equal(controller.state.editable!.identity.projectCrs, null); assert.equal(controller.pendingInput("file-dialog"), true);
});
test("async opening newly created Survey-first work applies its intended mode in the admitted document transition", async t => {
  const f = fixture(t); f.workspace = blankProductionWorkspace(); const controller = f.render(), heldModeChange = controller.selectMode;
  const read = f.holdRead(); const opening = controller.openDesign("design", false, "survey"); await read.started; read.release();
  assert.equal(await opening, true); assert.equal(controller.stateRef.current.presentation.mode, "survey");
  heldModeChange("survey"); const current = f.render(); assert.equal(current.state.presentation.mode, "survey"); assert.equal(current.state.editable!.identity.designId, "design"); assert.equal(f.writes.length, 0);
});

test("verified archive status gates field changes while archived saved work remains readable and dirty/raw owners stay retained", async t => {
  const f = fixture(t); f.access = { ...f.access, archives: archiveState(f) }; let controller = await f.openDesign();
  assert.equal(controller.fieldArchiveStatus(), "active"); assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Unsaved retained title" } })); controller = f.render();
  const raw = retainRaw(controller); raw.set("  retained raw machine size  "); controller = f.render(); const editor = controller.state.editable!.editor, before = f.workspace;
  f.access = { ...f.access, archives: archiveState(f, true) }; controller = f.render();
  assert.equal(controller.fieldArchiveStatus(), "archived"); assert.equal(controller.canEditField(), false); assert.equal(await controller.save(), false);
  assert.equal(controller.stateRef.current.editable!.editor, editor); assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "  retained raw machine size  ");
  await assert.rejects(controller.executeCatalog({ type: "rename_field_map", fieldMapId: "map", name: "Not allowed", now }), /Restore this customer/);
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
  f.access = { ...f.access, archives: null }; controller = f.render(); assert.equal(controller.fieldArchiveStatus(), "unknown"); assert.equal(controller.canEditField(), false);
  controller.inputs.resetScope("design"); controller = f.render();
  const clean = fixture(t); clean.access = { ...clean.access, archives: archiveState(clean, true) }; assert.equal(await clean.render().openDesign("design"), true);
  assert.equal(clean.render().fieldArchiveStatus(), "archived"); assert.equal(clean.writes.length, 0);
});

test("archive CAS metadata receipt advances the shared Save baseline and retains exact dirty editor, raw focus, Survey and Layout target", async t => {
  const f = fixture(t); f.access = { ...f.access, archives: archiveState(f) }; let controller = await f.openDesign();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Dirty title" } })); controller = f.render();
  const raw = retainRaw(controller); raw.set("  unfinished  "); controller.inputs.recordFocus(raw.key); controller.inputs.recordSelection(raw.key, { start: 2, end: 5 }); controller = f.render();
  const editor = controller.state.editable!.editor, history = controller.state.historyPast, collections = controller.state.collections, target = savedLayout(f).targetDocument;
  f.workspace = validateWorkspaceDocument({ ...f.workspace, revision: f.workspace.revision + 1 }); f.access = { ...f.access, archives: archiveState(f) }; controller = f.render();
  await controller.refreshMetadataReceipts(); controller = f.render();
  assert.equal(controller.state.editable!.workspaceRevision, f.workspace.revision); assert.equal(controller.state.editable!.editor, editor); assert.equal(controller.state.historyPast, history); assert.equal(controller.state.collections, collections);
  assert.deepEqual(controller.inputs.retainedFocus(), { key: raw.key, selection: { start: 2, end: 5 } }); assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "  unfinished  ");
  assert.equal(savedLayout(f).targetDocument, target); assert.equal(f.writes.length, 0);
  controller.inputs.resetScope("design"); controller = f.render(); assert.equal(await controller.save(), true); assert.equal(f.writes.length, 1);
});

test("maintenance refresh refuses changed domain evidence instead of blessing a newer receipt or losing private raw inputs", async t => {
  const f = fixture(t); let controller = await f.openDesign(); const raw = retainRaw(controller); raw.set("Private raw"); controller = f.render();
  const editor = controller.state.editable!.editor, revision = controller.state.editable!.workspaceRevision;
  f.workspace = applyWorkspaceCommand(f.workspace, { type: "save_design_draft", designId: "design", expectedDesignRevision: 0,
    draft: { ...newDesignDraft("draft", "Competing saved title", "metric"), projectCrs: sampleProject.projectCrs }, now }).workspace;
  await assert.rejects(controller.refreshMetadataReceipts(), /retained design receipt changed/); controller = f.render();
  assert.equal(controller.state.editable!.editor, editor); assert.equal(controller.state.editable!.workspaceRevision, revision); assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "Private raw"); assert.equal(f.writes.length, 0);
});

test("actual empty permissions preserve browsing but refuse field and catalog writes, including held callbacks after access changes", async t => {
  const f = fixture(t); let controller = await f.openDesign();
  const heldSave = controller.save;
  f.access = { ...f.access, roles: ["operator"], permissions: [] }; controller = f.render();
  assert.equal(controller.canEditField(), false); assert.equal(controller.canMaintainCatalog(), false); assert.equal(controller.canArchiveCatalog(), false);
  const before = f.workspace, editor = controller.state.editable!.editor;
  assert.equal(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Unauthorized" } }), false);
  assert.equal(await heldSave(), false); assert.equal(await controller.openDesign("design"), true);
  controller = f.render(); assert.equal(JSON.stringify(controller.state.editable!.editor), JSON.stringify(editor));
  await assert.rejects(controller.executeCatalog({ type: "rename_project", projectId: "project", name: "Unauthorized", now }), /cannot change/);
  assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
  f.access = { ...f.access, roles: ["support"], permissions: ["field:write", "catalog:write", "catalog:archive"] }; controller = f.render();
  assert.equal(controller.canEditField(), false); assert.equal(controller.canMaintainCatalog(), false); assert.equal(controller.canArchiveCatalog(), false);
  f.access = { ...f.access, roles: ["operator"], permissions: ["field:write", "catalog:archive"] }; controller = f.render();
  assert.equal(controller.canEditField(), true); assert.equal(controller.canArchiveCatalog(), false);
});
test("actual manual/live ports preserve online field editing, deny unsafe live capture and dynamically disable unsupported offline writes without changing membership", async t => {
  const f = fixture(t); let manualAvailable = true;
  f.access = { ...f.access, roles: ["operator"], permissions: ["field:read", "field:write", "catalog:write"], liveCaptureAvailable: false, offlineFieldMutationsAvailable: false,
    fieldMutationsUnavailableReason: "Connect to save field changes on this device.", get fieldMutationsAvailable() { return manualAvailable; } };
  let controller = await f.openDesign(); assert.equal(controller.canEditField(), true); assert.equal(controller.canCaptureLive(), false);
  assert.equal(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Known online change" } }), true); controller = f.render(); assert.equal(await controller.save(), true); controller = f.render();
  const permissions = [...f.access.permissions!], workspace = f.workspace, receiverCapture = controller.receiver.capture;
  controller.receiver.capture = () => { assert.fail("A host without the live port must refuse before capturing receiver evidence"); };
  controller.selectMode("survey"); controller = f.render(); assert.equal(await controller.collectSurvey("Not admitted"), false); controller = f.render(); assert.match(controller.state.notice!, /Live GPS collection is unavailable/); assert.equal(f.workspace, workspace);
  controller.receiver.capture = receiverCapture; controller.selectMode("design"); controller = f.render(); const heldSave = controller.save;
  manualAvailable = false; assert.equal(controller.canEditField(), false); assert.equal(controller.canMaintainCatalog(), true); assert.equal(await heldSave(), false);
  controller = f.render(); assert.match(controller.state.notice!, /Connect to save field changes/); assert.deepEqual(f.access.permissions, permissions);
  await controller.executeCatalog({ type: "rename_project", projectId: "project", name: "Allowed customer maintenance", now }); controller = f.render();
  assert.equal(f.writes.at(-1)?.type, "rename_project"); assert.equal(controller.canEditField(), false);
  manualAvailable = true; controller = f.render(); assert.equal(controller.canEditField(), true); assert.equal(controller.canCaptureLive(), false);
});

test("Home hide and show retire held interaction callbacks without losing editor, raw values, focus or receiver owner", async t => {
  const f = fixture(t); let controller = await f.openDesign();
  const raw = retainRaw(controller); raw.set("  unfinished field name  "); controller.inputs.recordFocus(raw.key); controller.inputs.recordSelection(raw.key, { start: 2, end: 9 }); controller = f.render();
  const heldDispatch = controller.dispatch, before = controller.state, receiver = controller.receiver, generation = before.presentation.interactionGeneration;
  f.access = { ...f.access, visible: false }; controller = f.render();
  assert.equal(controller.active, false); assert.equal(heldDispatch({ kind: "draft", action: { type: "rename", name: "Hidden" } }), false);
  f.access = { ...f.access, visible: true }; controller = f.render();
  assert.equal(controller.active, true); assert.equal(controller.state.presentation.interactionGeneration, generation + 2);
  assert.equal(heldDispatch({ kind: "draft", action: { type: "rename", name: "Retired" } }), false);
  assert.equal(controller.state.editable!.editor, before.editable!.editor); assert.equal(controller.receiver, receiver);
  assert.deepEqual(controller.inputs.read(raw.key, raw.baseline), { text: "  unfinished field name  ", spans: ["120", "130"] });
  assert.deepEqual(controller.inputs.retainedFocus(), { key: raw.key, selection: { start: 2, end: 9 } }); assert.equal(f.writes.length, 0);
});

test("permission retirement during an admitted catalog writer lock refuses atomically without altering saved records", async t => {
  const f = fixture(t); f.access = { ...f.access, roles: ["operator"], permissions: ["catalog:write", "field:write"] }; await f.openDesign(); const controller = f.render(), before = f.workspace;
  let release!: () => void, entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  f.beforeWrite = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); };
  const changing = controller.executeCatalog({ type: "rename_project", projectId: "project", name: "Refused after permission change", now }); await reached;
  f.access = { ...f.access, permissions: [] }; f.render(); release();
  await assert.rejects(changing, /retired command owner/); assert.equal(f.workspace, before); assert.equal(f.writes.length, 0);
});

test("authority denial freezes visible inputs and retires callbacks; unsupported recovery retains raw work without a fresh server read", async t => {
  const f = fixture(t); let controller = await f.openDesign(); const raw = retainRaw(controller); raw.set("  account-private unfinished text  "); controller = f.render();
  const held = controller.dispatch, before = controller.state.editable!.editor, reads = f.reads, receiver = controller.receiver;
  f.access = { ...f.access, authorityBlocked: true }; controller = f.render();
  assert.equal(f.access.visible, true); assert.equal(controller.active, false); assert.equal(controller.canEditField(), false); assert.equal(controller.canMaintainCatalog(), false); assert.equal(controller.canArchiveCatalog(), false);
  assert.equal(held({ kind: "draft", action: { type: "rename", name: "Denied" } }), false);
  assert.equal(await controller.prepareNavigationBoundary(), false); assert.equal(f.reads, reads);
  assert.equal(controller.stateRef.current.editable!.editor, before); assert.equal(controller.receiver, receiver);
  assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "  account-private unfinished text  ");
  f.access = { ...f.access, authorityBlocked: false }; controller = f.render();
  assert.equal(controller.active, true); assert.equal(held({ kind: "draft", action: { type: "rename", name: "Revived" } }), false); assert.equal(f.writes.length, 0);
});

test("account boundary waits for an admitted Save and keeps its receipt, while unsupported unfinished recovery refuses navigation", async t => {
  const f = fixture(t); let controller = await f.openDesign();
  assert(controller.dispatch({ kind: "draft", action: { type: "rename", name: "Saved before leaving" } })); controller = f.render();
  let release!: () => void, entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  f.beforeWrite = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); };
  const saving = controller.save(); await reached;
  let settled = false; const leaving = controller.prepareNavigationBoundary().then(result => { settled = true; return result; });
  await Promise.resolve(); assert.equal(settled, false); assert.equal(controller.isActive(), false);
  release(); assert.equal(await saving, true); assert.equal(await leaving, true); controller = f.render();
  assert.equal(controller.state.savedState, "saved"); assert.equal(f.writes.length, 1);
  const raw = retainRaw(controller); raw.set("unfinished account-private value"); controller = f.render();
  assert.equal(await controller.prepareNavigationBoundary(), false); controller = f.render();
  assert.equal(controller.active, true); assert.equal(controller.inputs.read(raw.key, raw.baseline).text, "unfinished account-private value");
  assert.equal(f.writes.length, 1); assert.match(controller.state.notice!, /Preserve or finish/);
});

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
  const heldMode = controller.state.presentation.mode;
  const before = f.workspace, storedBytes = f.workspace.layoutSessions!.find(entry => entry.id === "layout")!.document;
  const editor = controller.state.editable!.editor, history = controller.state.historyPast, read = f.holdRead(readsBeforeHold);
  const job = controller.openLayoutSession("layout"); await read.started;
  controller.setPendingInteractionInput("layout-name", true, true); controller = f.render();
  const pendingRevision = controller.pendingInputRevision;
  read.release(); assert.equal(await job, false); controller = f.render();
  assert.equal(controller.state.layout, null); assert.equal(controller.state.presentation.mode, heldMode);
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

for (const version of [1, 2, 3, 4] as const) test(`explicit package preparation acknowledges the exact lossless upgrade from v${version}`, async t => {
  const f = fixture(t); f.workspace = packageWorkspace(version);
  const before = f.workspace, bundle = buildDesignWorkspaceBundle(workspaceFixture(), "design"), controller = f.render();
  const receipt = await controller.preparePackageStorageStep(bundle, "map", packageReview(f));
  assert.deepEqual(receipt, { workspaceRevision: before.revision + (version <= 2 ? 3 : version === 3 ? 2 : 0), workspaceVersion: version === 4 ? "cplayout-workspace-v4" : "cplayout-workspace-v5" });
  assert.equal(f.writes.length, version === 4 ? 0 : 1);
  if (version === 4) { assertPackageUnchanged(f, before); return; }
  {
    assert.equal(f.writes[0].type, "upgrade_workspace_to_v5");
    assert.equal(version <= 2 ? f.workspace.originalPreviousWorkspaceDocument : version === 3 ? f.workspace.originalSurveyUpgradeDocument : f.workspace.originalWorkflowUpgradeDocument, JSON.stringify(before));
    assert.deepEqual(f.workspace.catalog, before.catalog); assert.deepEqual(f.workspace.draftDocuments, before.draftDocuments);
    assert.equal(f.workspace.catalog.designs.length, before.catalog.designs.length, "preparation creates no imported copy");
    assert.deepEqual(f.workspace.surveyCollections, before.surveyCollections ?? []);
    assert.deepEqual(f.workspace.workItems, []); assert.deepEqual(f.workspace.surveyReviews, []);
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
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].type, "upgrade_workspace_to_v5"); assert.equal(prepared.workspaceVersion, "cplayout-workspace-v5");
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
