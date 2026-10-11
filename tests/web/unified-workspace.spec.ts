import { fillActiveCatalogFormInput } from "./catalog-form-readiness";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { newDesignDraft } from "../../apps/mobile/src/newDesignDraft";
import { parseDesignDraftDocument } from "../../packages/core/src/designDraft";
import { parseProjectDocument } from "../../packages/core/src/projectDocument";
import { isRecordedReferenceMetadataRecord } from "../../packages/core/src/drawingMetadata";
import { parseFieldDesignDocument } from "../../packages/core/src/fieldDesignDocument";
import { createFieldLayoutTarget, serializeFieldLayoutTarget, parseFieldLayoutTarget } from "../../packages/core/src/fieldLayoutTarget";
import { parseLayoutSessionDocument } from "../../packages/core/src/layoutSession";
import { parseSurveyCollectionDocument } from "../../packages/core/src/surveyCollection";
import { projectLonLatToXy } from "../../packages/core/src/coordinates";
import { sampleProject } from "../../packages/core/src/sampleProject";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument, type WorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { createWebWorkspaceStore, WEB_WORKSPACE_LOCK } from "../../packages/project-store/src/webWorkspaceStore";
import { parseDesignWorkspaceBundle } from "../../packages/project-store/src/designWorkspaceBundle";
import { readWorkspace, workspaceKey, workspaceStorageBytes } from "./workspace-fixtures";
import { connectOperationalReceiver, emitGga, gga, installOperationalReceiver } from "./operational-receiver-fixture";

// All journeys load the actual default App. Fixtures supply durable documents or
// the synthetic serial transport boundary; no editor/controller hook is replaced.
// Receiver assertions establish software integration, never physical accuracy.
const now = "2026-10-10T00:00:00.000Z";
const clientId = "unified-client", folderId = "unified-project", fieldMapId = "unified-field";
const draftDesignId = "unified-draft-design", draftPayloadId = "unified-draft";
const fieldDesignId = "unified-machine-design", fieldPayloadId = "unified-machines", secondMachineId = "unequal-machine-b";
const errors = new WeakMap<Page, string[]>();
type LockFixtureWindow = Window & { unifiedReleaseWriter?: () => void };
test.use({ actionTimeout: 15_000 });

function catalogFixture(projectCrs = "EPSG:32613") {
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: clientId,
    input: { companyName: "Unified workflow test farm", primaryContactFirstName: "Synthetic", primaryContactLastName: "Operator" } }).workspace;
  return applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now,
    input: { clientId, projectId: folderId, projectName: "Explicit workflow project", projectCrs, unitSystem: "metric", fieldMapId, fieldMapName: "Operator named first field" } }).workspace;
}
function draftFixture(complete = false, projectCrs = "EPSG:32613") {
  const draft = { ...newDesignDraft(draftPayloadId, "Actual Draft fixture", "metric"), projectCrs };
  if (complete) Object.assign(draft, { fieldBoundary: structuredClone(sampleProject.fieldBoundary), pivotCenter: { ...sampleProject.pivotCenter },
    waterSource: { ...sampleProject.waterSource }, powerSource: { ...sampleProject.powerSource }, machine: structuredClone(sampleProject.machine), obstacles: structuredClone(sampleProject.obstacles) });
  return applyWorkspaceCommand(catalogFixture(projectCrs), { type: "create_design_draft", now, designId: draftDesignId, fieldMapId,
    name: draft.name, draft }).workspace;
}
function fieldFixture() {
  let workspace = catalogFixture();
  const project = { ...structuredClone(sampleProject), id: "unified-source-project", name: "Source complete fixture" };
  workspace = applyWorkspaceCommand(workspace, { type: "save_project", now, project, createOnly: true }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_design_record", now, input: { id: "unified-source-design", fieldMapId, pivotProjectId: project.id, name: project.name } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v2", now }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "convert_project_to_field_design", now, sourceDesignId: "unified-source-design", expectedDesignRevision: 0,
    designId: fieldDesignId, fieldMapId, name: "Independent unequal machines", fieldId: fieldPayloadId, waterSourceId: "actual-water", powerSourceId: "actual-power" }).workspace;
  const field = parseFieldDesignDocument(workspace.fieldDocuments![0].document), first = field.machines[0];
  const second = { ...structuredClone(first), id: secondMachineId, pivotCenter: { x: first.pivotCenter.x + 140.125, y: first.pivotCenter.y - 70.375 },
    configuration: { ...structuredClone(first.configuration), name: "Unequal second pivot", spanLengthsMeters: [31.125, 42.375, 27.0625], overhangMeters: 12.875, endGunThrowMeters: 17.625 } };
  return applyWorkspaceCommand(workspace, { type: "save_field_design", now, designId: fieldDesignId, expectedDesignRevision: 0, field: { ...field, machines: [first, second] } }).workspace;
}
function savedLayoutFixture() {
  let workspace = fieldFixture();
  workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v3", now }).workspace;
  const field = parseFieldDesignDocument(workspace.fieldDocuments![0].document);
  const revision = workspace.catalog.designs.find(item => item.id === fieldDesignId)!.revision;
  const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: revision, expectedRevision: revision, selectedMachineIds: [secondMachineId] }));
  return applyWorkspaceCommand(workspace, { type: "create_layout_session", now, sessionId: "file-layout", fieldMapId, name: "Saved file Layout", targetDocument }).workspace;
}
async function seed(context: BrowserContext, workspace: WorkspaceDocument) {
  const values = new Map<string, string>();
  const store = createWebWorkspaceStore({ getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, action) => action() }) });
  await store.initializeAsync(); values.set(workspaceKey, serializeWorkspaceDocument(workspace));
  await context.addInitScript(({ key, entries }) => {
    if (["http:", "https:"].includes(location.protocol) && localStorage.getItem(key) === null) for (const [name, value] of entries) localStorage.setItem(name, value);
  }, { key: workspaceKey, entries: [...values] });
}
async function tools(page: Page, visible: boolean) {
  const toggle = page.getByTestId("workspace-tools-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  const shown = (await toggle.getAttribute("aria-label")) === "Hide tools";
  if (shown !== visible) await toggle.click();
  if (visible) await expect(page.getByTestId("workspace-mode-tools")).toBeVisible();
}
async function catalog(page: Page) {
  if (!await page.getByTestId("workspace-catalog").isVisible()) await page.getByRole("button", { name: "Customers & projects", exact: true }).first().click();
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
}
async function open(page: Page, id: string) {
  await catalog(page);
  // Recent and tree entries can coexist; both are real explicit Open commands.
  const recent = page.getByTestId(`catalog-recent-open-${id}`);
  if (await recent.isVisible()) await recent.click();
  else {
    await page.getByTestId(`catalog-client-${clientId}`).click();
    await page.getByTestId(`catalog-project-${folderId}`).click();
    await page.getByTestId(`catalog-field-${fieldMapId}`).click();
    await page.getByTestId(`catalog-design-open-${id}`).click();
  }
  // Open preserves the current mode. These journeys explicitly request Design
  // tools, including when startup has restored the saved Survey mode.
  await page.getByTestId("workspace-mode-design").click();
  await tools(page, true); await expect(page.getByTestId("unified-design-panel")).toBeVisible();
}
async function reloadSavedWorkspace(page: Page) {
  await page.reload();
  // Await the restored owner before checking Catalog visibility: its initial
  // embedded presentation can disappear once automatic startup resume settles.
  await expect(page.getByTestId("workspace-save")).toBeEnabled();
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
  await expect(page.getByTestId("workspace-catalog")).toBeHidden();
}
async function start(page: Page, id: string) { await page.goto("/"); await open(page, id); }
async function save(page: Page) {
  await page.getByTestId("workspace-save").click();
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
}
async function draftStored(page: Page, id = draftPayloadId) {
  const entry = (await readWorkspace(page)).draftDocuments.find(item => item.id === id);
  if (!entry) throw new Error(`Expected durable actual Draft ${id}`); return parseDesignDraftDocument(entry.document);
}
async function sessionStored(page: Page) {
  const entries = (await readWorkspace(page)).layoutSessions ?? []; expect(entries).toHaveLength(1);
  return parseLayoutSessionDocument(entries[0].document);
}
async function receiver(page: Page) {
  await page.getByTestId("workspace-receiver-toggle").click();
  await connectOperationalReceiver(page); await expect(page.getByTestId("workspace-receiver-summary")).toContainText("RTK Fixed");
}
async function holdWriter(page: Page) {
  // Hold the browser's actual repository writer lock, without replacing the store.
  await page.evaluate(async lockName => {
    const state = window as LockFixtureWindow;
    let acquired!: () => void;
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    void navigator.locks.request(lockName, { mode: "exclusive" }, async () => {
      await new Promise<void>(resolve => { state.unifiedReleaseWriter = resolve; acquired(); });
      delete state.unifiedReleaseWriter;
    });
    await ready;
  }, WEB_WORKSPACE_LOCK);
}
async function releaseWriter(page: Page) { await page.evaluate(() => (window as LockFixtureWindow).unifiedReleaseWriter?.()); }
test.beforeEach(async ({ page, context, baseURL }) => {
  // This suite measures projected SVG geometry; keep that renderer deterministic.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, ...options: unknown[]) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return Reflect.apply(original, this, [contextId, ...options]);
    } as typeof original;
  });
  errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
});
test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });

test("empty default App creates explicit customer/project/first field/CRS and opens an actual empty Draft", async ({ context, page }) => {
  await seed(context, emptyWorkspaceDocument()); await page.goto("/");
  await expect(page.getByTestId("unified-workspace")).toBeVisible();
  const empty = await readWorkspace(page); expect(empty.catalog.designs).toEqual([]); expect(empty.projectDocuments).toEqual([]);
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(0);
  await catalog(page); await page.getByTestId("catalog-new").click();
  await fillActiveCatalogFormInput(page, "client-profile-first-name-input", "Actual entered", "client-profile-dialog", "");
  await fillActiveCatalogFormInput(page, "client-profile-last-name-input", "Customer", "client-profile-dialog", "");
  await fillActiveCatalogFormInput(page, "client-profile-company-input", "Explicit browser farm", "client-profile-dialog", "");
  await page.getByTestId("client-profile-save").click(); await expect(page.getByTestId("catalog-new")).toHaveAttribute("aria-label", "New project");
  await page.getByTestId("catalog-new").click(); await fillActiveCatalogFormInput(page, "catalog-dialog-name-input", "Explicit project name", "catalog-dialog", "");
  await fillActiveCatalogFormInput(page, "catalog-dialog-first-field-input", "", "catalog-dialog", "Field 1"); await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog-first-field-input-error")).toBeVisible();
  await page.getByTestId("catalog-dialog-first-field-input").fill("Operator entered first field");
  await expect(page.getByTestId("catalog-project-crs")).toHaveValue(""); await page.getByTestId("catalog-dialog-create").click();
  await expect.poll(async () => (await readWorkspace(page)).catalog.projects.length).toBe(0);
  await expect(page.getByTestId("catalog-dialog-save-error")).toBeVisible();
  await page.getByTestId("catalog-project-crs").fill("EPSG:32613"); await page.getByTestId("catalog-units-metric").click(); await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-new")).toHaveAttribute("aria-label", "New design");
  const created = await readWorkspace(page); expect(created.catalog.projects[0]).toMatchObject({ name: "Explicit project name", projectCrs: "EPSG:32613", unitSystem: "metric" });
  expect(created.catalog.fieldMaps[0].name).toBe("Operator entered first field");
  await page.getByTestId("catalog-new").click(); await fillActiveCatalogFormInput(page, "catalog-dialog-name-input", "Actual first draft", "catalog-dialog", ""); await page.getByTestId("catalog-dialog-create").click();
  await expect.poll(async () => (await readWorkspace(page)).catalog.designs.length).toBe(1);
  const stored = await readWorkspace(page), design = stored.catalog.designs[0]; expect(design.kind).toBe("draft");
  const draft = parseDesignDraftDocument(stored.draftDocuments[0].document); expect(draft.fieldBoundary).toEqual([]); expect(draft.pivotCenter).toBeNull(); expect(draft.machine).toEqual({}); expect(draft.projectCrs).toBe("EPSG:32613");
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(0);
  await page.getByTestId(`catalog-design-open-${design.id}`).click(); await tools(page, true);
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1); await page.getByTestId("design-task-review").click(); await expect(page.getByTestId("draft-create-complete")).toBeDisabled();
});

test("Draft map clicks classify inline and save/reopen exact ordered geometry, labels and digitized times", async ({ context, page }) => {
  await seed(context, draftFixture(false, "LOCAL:METERS")); await start(page, draftDesignId);
  await page.getByTestId("drawing-tool-Polygon").click(); await tools(page, false);
  const canvas = page.getByTestId("workspace-map-svg-renderer"); await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox(); if (!box) throw new Error("Expected actual drawing canvas geometry.");
  for (const [x, y] of [[0.23, 0.36], [0.61, 0.36], [0.48, 0.65]]) await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  await save(page); const pending = await draftStored(page), capture = pending.drawingWorkflow!.captures[0];
  expect(capture.vertices).toHaveLength(3); expect(capture.stage).toBe("drawing"); expect(pending.fieldBoundary).toEqual([]);
  await tools(page, true); await page.getByTestId("drawing-finish").click();
  const classification = page.getByTestId("drawing-classification-inline"); await expect(classification).toBeVisible();
  await expect(classification.getByRole("combobox", { name: "Drawing purpose" })).toHaveCount(1);
  await page.getByTestId("drawing-purpose-select").selectOption("field_boundary"); await page.getByTestId("drawing-details-toggle").click();
  await page.getByTestId("drawing-name").fill("Exact boundary label  "); await page.getByTestId("drawing-notes").fill("Exact notes\nsecond line");
  await page.getByTestId("drawing-classification-keep").click(); await expect(classification).toHaveCount(0); await save(page);
  const committed = await draftStored(page); expect(committed.fieldBoundary).toEqual(capture.vertices.map(vertex => vertex.point)); expect(committed.drawingWorkflow!.captures).toEqual([]);
  const record = committed.drawingMetadata!.records[0]; expect(record.classification).toMatchObject({ name: "Exact boundary label  ", notes: "Exact notes\nsecond line", purposeId: "field_boundary" });
  expect(record.capture.vertexRecordedAt).toEqual(capture.vertices.map(vertex => vertex.recordedAt)); expect(record.capture.source).toBe("map_digitized");
  await reloadSavedWorkspace(page); await open(page, draftDesignId); expect(await draftStored(page)).toEqual(committed); await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
  await expect(page.getByTestId("draft-boundary-csv")).toHaveValue(committed.fieldBoundary.map(point => `${point.x},${point.y}`).join("\n"));
});

test("Design/Survey/Layout retain one map node and camera while malformed machine text and caret survive mode changes", async ({ context, page }) => {
  await seed(context, draftFixture()); await start(page, draftDesignId);
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Unified workflow test farm.*Explicit workflow project.*Operator named first field.*Actual Draft fixture/);
  if (page.viewportSize()!.width < 900) await expect(page.getByTestId("workspace-context")).toHaveText(/^Actual Draft fixture/);
  await tools(page, false); const initialReadout = await page.getByTestId("workspace-map-readout").innerText();
  await page.getByTestId("workspace-map-zoom-in").click(); await expect(page.getByTestId("workspace-map-readout")).not.toHaveText(initialReadout); await tools(page, true);
  await page.getByTestId("design-task-inputs").click(); await page.getByTestId("draft-machine-add-span").click(); const input = page.getByTestId("draft-machine-span-0");
  await input.fill("unfinished 12' x"); await input.focus(); await input.press("Home");
  for (let i = 0; i < 3; i++) await input.press("ArrowRight"); for (let i = 0; i < 4; i++) await input.press("Shift+ArrowRight");
  const selection = await input.evaluate(node => ({ start: (node as HTMLInputElement).selectionStart, end: (node as HTMLInputElement).selectionEnd }));
  expect(selection).toEqual({ start: 3, end: 7 });
  const bytes = await workspaceStorageBytes(page);
  const map = await page.getByTestId("workspace-map-surface").elementHandle(); if (!map) throw new Error("Expected actual shared map node.");
  const readout = await page.getByTestId("workspace-map-readout").innerText(); const contextText = await page.getByTestId("workspace-context").innerText();
  for (const mode of ["survey", "layout", "design"] as const) {
    await page.getByTestId(`workspace-mode-${mode}`).click(); await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
    expect(await map.evaluate(node => node === document.querySelector('[data-testid="workspace-map-surface"]'))).toBe(true);
    await expect.poll(() => page.getByTestId("workspace-map-readout").innerText()).toBe(readout); await expect(page.getByTestId("workspace-context")).toHaveText(contextText);
    await expect(page.getByTestId("workspace-common-controls")).toBeVisible();
  }
  await expect(input).toHaveValue("unfinished 12' x"); await expect(input).toBeFocused();
  expect(await input.evaluate(node => ({ start: (node as HTMLInputElement).selectionStart, end: (node as HTMLInputElement).selectionEnd }))).toEqual(selection);
  expect(await workspaceStorageBytes(page)).toEqual(bytes);
  await page.getByTestId("command-menu-workspace-file").click(); await page.getByRole("menuitem", { name: "Reload saved design", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /finish its entered inputs/ })).toBeVisible(); await expect(input).toHaveValue("unfinished 12' x");
});

test("calculation is preview only and explicit completion creates a separate saved child before explicit Open", async ({ context, page }) => {
  await seed(context, draftFixture(true)); await start(page, draftDesignId);
  const before = await readWorkspace(page), source = before.draftDocuments[0].document;
  await page.getByTestId("design-task-inputs").click(); await expect(page.getByTestId("draft-inputs-discard")).toBeDisabled();
  await page.getByTestId("design-task-review").click(); await page.getByTestId("draft-calculate").click(); await expect(page.getByTestId("draft-calculation-result")).toContainText("Coverage");
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("draft-create-complete").click(); await expect(page.getByTestId("draft-open-saved-complete")).toBeVisible();
  const after = await readWorkspace(page), complete = after.catalog.designs.find(item => item.kind === "project");
  expect(complete).toBeDefined(); expect(complete!.id).not.toBe(draftDesignId); expect(complete!.fieldMapId).toBe(fieldMapId);
  expect(after.catalog.designs.filter(item => item.kind === "draft")).toHaveLength(1); expect(after.draftDocuments[0].document).toBe(source); expect(after.projectDocuments).toHaveLength(1);
  await expect(page.getByTestId("design-draft-inputs")).toHaveCount(1); await expect(page.getByTestId("design-draft-inputs")).toBeHidden();
  await expect(page.getByTestId("design-task-review")).toHaveAttribute("aria-selected", "true"); await expect(page.getByTestId("project-design-panel")).toHaveCount(0);
  await page.getByTestId("draft-open-saved-complete").click(); await expect(page.getByTestId("project-design-panel")).toBeVisible(); await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
});

test("task tabs retire held map gestures and retain malformed input, caret and independent scroll positions", async ({ context, page }) => {
  await seed(context, draftFixture(false, "LOCAL:METERS")); await start(page, draftDesignId);
  const inputs = page.getByTestId("design-task-inputs"), drawing = page.getByTestId("design-task-drawing");
  await drawing.focus(); await drawing.press("ArrowRight"); await expect(inputs).toBeFocused();
  await expect(drawing).toHaveAttribute("aria-selected", "true");
  await inputs.press("Space"); await expect(inputs).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("draft-inputs-discard")).toBeDisabled();
  await inputs.press("Tab"); await expect(page.getByTestId("draft-name")).toBeFocused();
  await page.getByTestId("draft-name").press("Shift+Tab"); await expect(inputs).toBeFocused();
  await drawing.focus(); await drawing.press("Enter"); await expect(drawing).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("drawing-tool-LineString").click();
  const canvas = page.getByTestId("workspace-map-svg-renderer"), box = await canvas.boundingBox();
  if (!box) throw new Error("Expected exposed actual map.");
  const hit = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.4 };
  expect(await canvas.evaluate((node, point) => node.contains(document.elementFromPoint(point.x, point.y)), hit)).toBe(true);
  const bytes = await workspaceStorageBytes(page);
  await page.mouse.move(hit.x, hit.y); await page.mouse.down();
  await inputs.focus(); await inputs.press("Enter"); await expect(inputs).toHaveAttribute("aria-selected", "true");
  await expect(drawing).toHaveAttribute("aria-selected", "false"); await expect(page.getByTestId("design-task-scroll-inputs")).toBeVisible();
  await drawing.focus(); await drawing.press("Enter"); await expect(drawing).toHaveAttribute("aria-selected", "true");
  await expect(inputs).toHaveAttribute("aria-selected", "false"); await expect(page.getByTestId("design-task-scroll-inputs")).toBeHidden();
  await page.mouse.up(); await expect(page.getByTestId("workspace-drawing-panel")).toContainText("0 vertices");
  expect(await workspaceStorageBytes(page)).toEqual(bytes);
  await page.mouse.click(hit.x, hit.y); await expect(page.getByTestId("workspace-drawing-panel")).toContainText("1 vertices");
  await save(page); expect((await draftStored(page)).drawingWorkflow!.captures[0].vertices).toHaveLength(1);
  await inputs.click(); await page.getByTestId("draft-machine-add-span").click();
  const span = page.getByTestId("draft-machine-span-0"); await span.fill("12 feet unfinished"); await span.focus();
  await expect(page.getByTestId("draft-inputs-discard")).toBeEnabled();
  await span.press("Home"); await span.press("ArrowRight"); await span.press("Shift+ArrowRight");
  const selection = await span.evaluate(node => ({ start: (node as HTMLInputElement).selectionStart, end: (node as HTMLInputElement).selectionEnd }));
  const scroll = page.getByTestId("design-task-scroll-inputs");
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const top = await scroll.evaluate(node => node.scrollTop);
  await page.getByTestId("design-task-review").click(); await expect(span).toBeHidden();
  await inputs.click(); await expect(span).toHaveValue("12 feet unfinished"); await expect(span).toBeFocused();
  expect(await span.evaluate(node => ({ start: (node as HTMLInputElement).selectionStart, end: (node as HTMLInputElement).selectionEnd }))).toEqual(selection);
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeCloseTo(top, 0);
});

test("unequal Field machines freeze an exact selected Layout target and observations survive save, later design edit and reopen", async ({ context, page }) => {
  await seed(context, fieldFixture()); await installOperationalReceiver(page, gga()); await start(page, fieldDesignId);
  await page.getByTestId(`field-machine-${secondMachineId}`).click(); await page.getByTestId("design-task-review").click(); await page.getByTestId("field-calculate").click(); await expect(page.getByTestId("field-calculation-result")).toContainText(secondMachineId);
  const original = await readWorkspace(page), fieldEntry = original.fieldDocuments!.find(item => item.id === fieldPayloadId)!, field = parseFieldDesignDocument(fieldEntry.document);
  await page.getByTestId("workspace-mode-layout").click(); await page.getByRole("textbox", { name: "New Layout session name", exact: true }).fill("Unified frozen target");
  await holdWriter(page);
  try {
    await page.getByTestId("layout-freeze").click();
    await expect.poll(() => page.evaluate(async lockName => (await navigator.locks.query()).pending?.some(lock => lock.name === lockName) ?? false, WEB_WORKSPACE_LOCK)).toBe(true);
    await expect(page.getByRole("textbox", { name: "New Layout session name", exact: true })).toBeEditable();
    await page.getByRole("textbox", { name: "New Layout session name", exact: true }).fill("Newer unsaved session name");
  } finally { await releaseWriter(page); }
  await expect(page.getByTestId("layout-collect")).toBeVisible();
  const frozen = await sessionStored(page), target = parseFieldLayoutTarget(frozen.targetDocument);
  expect(frozen.name).toBe("Unified frozen target");
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /^Unified workflow test farm\s+›\s+Explicit workflow project\s+›\s+Operator named first field\s+›\s+Layout session: Unified frozen target; Retained design: Independent unequal machines$/);
  if (page.viewportSize()!.width < 900) await expect(page.getByTestId("workspace-context")).toHaveText(/^Unified frozen target/);
  await page.getByRole("button", { name: "Session details & actions", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Layout session name", exact: true })).toHaveValue("Newer unsaved session name");
  await page.getByRole("textbox", { name: "Layout session name", exact: true }).fill(frozen.name);
  expect(target.source.selectedMachineIds).toEqual([secondMachineId]); expect(target.field).toEqual(field); expect(frozen.observations).toEqual([]);
  await receiver(page); await expect(page.getByTestId("layout-collect")).toBeEnabled(); await page.getByTestId("layout-observation-label").fill("Actual synthetic observation"); await page.getByTestId("layout-collect").click();
  await expect.poll(async () => (await sessionStored(page)).observations.length).toBe(1);
  const observed = await sessionStored(page); expect(observed.targetDocument).toBe(frozen.targetDocument); expect(observed.targetHash).toBe(frozen.targetHash);
  expect(observed.observations[0].projected).toEqual(projectLonLatToXy({ latitude: 40, longitude: -105 }, field.projectCrs)); expect(observed.observations[0].evidence.physicalQualification).toBe("unverified");
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click(); await page.getByTestId("workspace-mode-design").click();
  await page.getByTestId("design-task-machines").click();
  await page.getByTestId("field-input-name").fill("Changed after target freeze"); await page.getByTestId("field-apply-machine").click(); await save(page);
  const changed = await readWorkspace(page); expect(parseFieldDesignDocument(changed.fieldDocuments!.find(item => item.id === fieldPayloadId)!.document).machines[1].configuration.name).toBe("Changed after target freeze");
  expect(changed.fieldDocuments!.find(item => item.id === fieldPayloadId)!.originalProjectDocument).toBe(fieldEntry.originalProjectDocument);
  expect(await sessionStored(page)).toEqual(observed); await reloadSavedWorkspace(page); await open(page, fieldDesignId); await page.getByTestId("workspace-mode-layout").click();
  await page.getByRole("button", { name: "Unified frozen target", exact: true }).click(); await expect(page.getByTestId("layout-collect")).toBeDisabled();
  await expect(page.getByTestId("unified-layout-panel")).toContainText("Actual synthetic observation"); expect(await sessionStored(page)).toEqual(observed);
});

test("Survey retains immutable evidence through mode changes and clear/Undo, then applies a real line while disconnected", async ({ context, page }) => {
  await seed(context, draftFixture()); await installOperationalReceiver(page, gga()); await start(page, draftDesignId);
  await page.getByTestId("workspace-mode-survey").click(); await page.getByTestId("survey-enable").click(); await expect(page.getByTestId("survey-start")).toBeVisible();
  await page.getByTestId("survey-purpose").selectOption(JSON.stringify({ kind: "map_feature", featureKind: "measurement_line", geometryType: "LineString" }));
  await page.getByTestId("survey-start").click(); await receiver(page); await expect(page.getByTestId("survey-collect")).toBeEnabled();
  await page.getByTestId("survey-point-label").fill("First saved position"); await page.getByTestId("survey-collect").click();
  await emitGga(page, gga("120001.00", 4, "GNGGA", "4000.0030"), 500); await expect(page.getByTestId("survey-collect")).toBeEnabled(); await page.getByTestId("survey-collect").click();
  await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).observations.length).toBe(2);
  const before = parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document); expect(before.activePointIds).toEqual(before.observations.map(point => point.id));
  await page.getByTestId("workspace-mode-design").click(); await page.getByTestId("workspace-mode-survey").click();
  expect(parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document)).toEqual(before);
  await page.getByRole("button", { name: "Clear active shape", exact: true }).click();
  await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).activePointIds.length).toBe(0);
  const cleared = parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document); expect(cleared.observations).toEqual(before.observations);
  await page.getByTestId("workspace-undo").click(); await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).activePointIds).toEqual(before.activePointIds);
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click(); await expect(page.getByTestId("survey-collect")).toBeDisabled(); await page.getByTestId("survey-apply").click();
  await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).state).toBe("applied");
  const applied = parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document); expect(applied.observations).toEqual(before.observations);
  const feature = (await draftStored(page)).mapFeatures!.find(item => item.kind === "measurement_line")!;
  expect(feature.geometry).toEqual({ type: "LineString", vertices: before.activePointIds.map(id => before.observations.find(point => point.id === id)!.projected) });
  await reloadSavedWorkspace(page); await open(page, draftDesignId); await page.getByTestId("workspace-mode-survey").click(); await page.getByTestId("survey-collection").selectOption(applied.id);
  await expect(page.getByTestId("unified-survey-panel")).toContainText("First saved position"); expect(parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document)).toEqual(applied);
});

test("common Save shows unapplied inputs, refuses without storage error, and File copy exports exact applied source", async ({ context, page }) => {
  await seed(context, draftFixture(true)); await start(page, draftDesignId);
  await page.getByTestId("design-task-inputs").click();
  const input = page.getByTestId("draft-machine-span-0"), original = await input.inputValue();
  const before = await readWorkspace(page);
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  await input.fill("unfinished 12' x");
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply");
  await page.getByTestId("workspace-save").click();
  await expect(page.getByRole("alert").filter({ hasText: "Apply or discard your entered inputs before saving" })).toBeVisible();
  await expect(page.getByTestId("workspace-save-state")).not.toContainText("attention");
  await page.getByTestId("command-menu-workspace-file").click();
  await page.getByRole("menuitem", { name: "Copy complete design workspace", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Design name", exact: true }).fill("Own intended copy name");
  await page.getByRole("button", { name: "Save separate copy", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /before copying/ })).toBeVisible();
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByTestId("command-menu-workspace-file").click();
  await page.getByRole("menuitem", { name: "Export complete design workspace (JSON)", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /before exporting/ })).toBeVisible();
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("draft-inputs-discard").click();
  await expect(input).toHaveValue(original); await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  await expect(page.getByRole("alert").filter({ hasText: /before exporting/ })).toHaveCount(0);
  await page.getByTestId("command-menu-workspace-file").click();
  await page.getByRole("menuitem", { name: "Copy complete design workspace", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Design name", exact: true }).fill("Own intended copy name");
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Copy name awaiting Copy");
  await page.getByRole("button", { name: "Save separate copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open saved design copy", exact: true })).toBeVisible();
  const after = await readWorkspace(page), copy = after.catalog.designs.find(item => item.name === "Own intended copy name")!;
  expect(copy.id).not.toBe(draftDesignId); expect(after.draftDocuments.find(item => item.id === draftPayloadId)!.document).toBe(before.draftDocuments[0].document);
  await page.getByTestId("command-menu-workspace-file").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export complete design workspace (JSON)", exact: true }).click();
  const download = await downloadPromise, path = await download.path(); expect(path).toBeTruthy();
  const bundle = parseDesignWorkspaceBundle(JSON.parse(await readFile(path!, "utf8")));
  expect(bundle.designId).toBe(draftDesignId); expect(bundle.designDocument).toBe(before.draftDocuments[0].document);
  await expect(input).toHaveValue(original); await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
  await page.getByTestId("command-menu-workspace-file").click();
  await page.getByRole("menuitem", { name: "Rename current design", exact: true }).click();
  const name = page.getByTestId("draft-name"), appliedName = await name.inputValue();
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(name).toBeFocused();
  await name.fill("Unapplied File rename");
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply");
  await page.getByTestId("draft-inputs-discard").click(); await expect(name).toHaveValue(appliedName);
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  expect(await readWorkspace(page)).toEqual(after);
});

test("Layout common Save names its session while hidden Design input and newer names remain separate", async ({ context, page }) => {
  await seed(context, savedLayoutFixture()); await start(page, fieldDesignId);
  const before = await readWorkspace(page), fieldSource = before.fieldDocuments![0].document;
  await page.getByTestId(`field-machine-${secondMachineId}`).click();
  await page.getByTestId("field-input-span-0").fill("unfinished field span");
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply");
  await page.getByTestId("workspace-mode-layout").click();
  await page.getByRole("button", { name: "Saved file Layout", exact: true }).click();
  const frozen = await sessionStored(page);
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  await tools(page, false);
  await page.getByTestId("command-menu-workspace-file").click();
  await expect(page.getByRole("menuitem", { name: "Export complete design workspace (JSON)", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Rename current Layout session", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Layout session name", exact: true });
  await expect(name).toBeVisible(); await expect(name).toBeFocused();
  await expect(page.getByRole("button", { name: "Apply session name", exact: true })).toHaveCount(0);
  await name.fill(""); await page.getByTestId("workspace-save").click();
  await expect(page.getByRole("alert").filter({ hasText: "Enter a Layout session name" })).toBeVisible();
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Name awaiting Save");
  await name.fill("Admitted session name A"); await holdWriter(page);
  try {
    await page.getByTestId("workspace-save").click();
    await expect.poll(() => page.evaluate(async lockName => (await navigator.locks.query()).pending?.some(lock => lock.name === lockName) ?? false, WEB_WORKSPACE_LOCK)).toBe(true);
    await expect(name).toBeEditable(); await name.fill("Newer session name B");
  } finally { await releaseWriter(page); }
  await expect.poll(async () => (await sessionStored(page)).name).toBe("Admitted session name A");
  await expect(name).toHaveValue("Newer session name B"); await expect(page.getByTestId("workspace-save-state")).toHaveText("Name awaiting Save");
  await save(page); const renamed = await sessionStored(page); expect(renamed.name).toBe("Newer session name B");
  expect(renamed.targetDocument).toBe(frozen.targetDocument); expect(renamed.targetHash).toBe(frozen.targetHash); expect(renamed.observations).toEqual(frozen.observations);
  await page.getByTestId("layout-observation-label").fill("Uncollected intention");
  await page.getByRole("textbox", { name: "Copy Layout session name", exact: true }).fill("Unsubmitted copy intention");
  const savedRevision = (await readWorkspace(page)).revision; await page.getByTestId("workspace-save").click();
  await expect(page.getByTestId("workspace-save")).toBeEnabled();
  expect((await readWorkspace(page)).revision).toBe(savedRevision);
  await expect(page.getByTestId("layout-observation-label")).toHaveValue("Uncollected intention");
  await expect(page.getByRole("textbox", { name: "Copy Layout session name", exact: true })).toHaveValue("Unsubmitted copy intention");
  await page.getByTestId("command-menu-workspace-file").click(); const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Layout session & saved observations (JSON)", exact: true }).click();
  const download = await downloadPromise, path = await download.path(); expect(path).toBeTruthy();
  const output = parseLayoutSessionDocument(await readFile(path!, "utf8")); expect(output).toEqual(renamed);
  expect((await readWorkspace(page)).fieldDocuments![0].document).toBe(fieldSource);
  await page.getByTestId("workspace-mode-design").click();
  await expect(page.getByTestId("field-input-span-0")).toHaveValue("unfinished field span");
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply");
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
});

test("opening saved Layout refuses an unfinished new-session name and explicit Discard preserves the saved target", async ({ context, page }) => {
  await seed(context, savedLayoutFixture()); await start(page, fieldDesignId);
  const before = await readWorkspace(page);
  await page.getByTestId("workspace-mode-layout").click();
  const name = page.getByRole("textbox", { name: "New Layout session name", exact: true });
  await name.fill("Unfrozen session intention A");
  await page.getByRole("button", { name: "Saved file Layout", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: /entered Layout session name/ })).toBeVisible();
  await expect(name).toHaveValue("Unfrozen session intention A");
  await expect(page.getByTestId("layout-collect")).toHaveCount(0);
  await expect(page.getByTestId("workspace-save")).toBeDisabled();
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("layout-discard-new-name").click(); await expect(name).toHaveValue("Layout session");
  await page.getByRole("button", { name: "Saved file Layout", exact: true }).click();
  await expect(page.getByTestId("layout-collect")).toBeVisible(); await save(page);
  expect(await readWorkspace(page)).toEqual(before);
  const saved = await sessionStored(page); expect(saved.name).toBe("Saved file Layout");
  expect(saved.targetDocument).toBe(parseLayoutSessionDocument(before.layoutSessions![0].document).targetDocument);
});

for (const owner of ["draft", "project", "field"] as const) for (const shape of [
  { featureKind: "reference_point", geometryType: "Point", count: 1 },
  { featureKind: "reference_line", geometryType: "LineString", count: 2 },
  { featureKind: "reference_area", geometryType: "Polygon", count: 3 },
] as const) test(`recorded ${shape.geometryType} reference applies in actual ${owner} while disconnected and reopens honest provenance`, async ({ context, page }) => {
  await seed(context, owner === "draft" ? draftFixture(true) : fieldFixture());
  await installOperationalReceiver(page, gga());
  const id = owner === "draft" ? draftDesignId : owner === "field" ? fieldDesignId : "unified-source-design";
  await start(page, id); const map = await page.getByTestId("workspace-map-surface").elementHandle(); expect(map).toBeTruthy();
  await page.getByTestId("workspace-mode-survey").click(); await page.getByTestId("survey-enable").click();
  await page.getByTestId("survey-purpose").selectOption(JSON.stringify({ kind: "map_feature", featureKind: shape.featureKind, geometryType: shape.geometryType }));
  await page.getByTestId("survey-start").click(); await receiver(page);
  await page.getByTestId("survey-collect").click();
  await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).observations.length).toBe(1);
  if (shape.count > 1) {
    await emitGga(page, gga("120001.00", 4, "GNGGA", "4000.0030"), 500);
    await expect(page.getByText("Position: 40.0000500, -105.0000000", { exact: true })).toBeVisible();
    await page.getByTestId("survey-collect").click();
    await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).observations.length).toBe(2);
  }
  if (shape.count > 2) {
    await emitGga(page, gga("120002.00", 4, "GNGGA", "4000.0020", "10500.0030"), 500);
    await expect(page.getByText("Position: 40.0000333, -105.0000500", { exact: true })).toBeVisible();
    await page.getByTestId("survey-collect").click();
  }
  await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).observations.length).toBe(shape.count);
  const captured = parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document);
  expect(captured.observations.map(point => point.captureEvidence && "gga" in point.captureEvidence ? point.captureEvidence.gga.utcTime : null))
    .toEqual(["120000.00", "120001.00", "120002.00"].slice(0, shape.count));
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  await expect(page.getByTestId("survey-collect")).toBeDisabled();
  await page.getByTestId("survey-reference-details").click();
  const name = `Exact ${owner} ${shape.featureKind} label  `, notes = "Original reference notes\nsecond line";
  await page.getByTestId("survey-reference-name").fill(name); await page.getByTestId("survey-reference-notes").fill(notes);
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Reference details awaiting Apply");
  await page.getByTestId("survey-apply").click();
  await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).state).toBe("applied");
  const workspace = await readWorkspace(page), collection = parseSurveyCollectionDocument(workspace.surveyCollections![0].document);
  expect(collection.observations).toEqual(captured.observations); expect(collection.activePointIds).toEqual([]);
  const payloadDocument = owner === "draft" ? workspace.draftDocuments.find(item => item.id === draftPayloadId)!.document
    : owner === "field" ? workspace.fieldDocuments!.find(item => item.id === fieldPayloadId)!.document
      : workspace.projectDocuments.find(item => item.summary.id === "unified-source-project")!.document;
  expect(JSON.parse(payloadDocument).documentVersion).toBe(owner === "draft" ? "design-draft-v5" : owner === "field" ? "field-design-v6" : "pivot-project-v4");
  const data = owner === "draft" ? parseDesignDraftDocument(payloadDocument) : owner === "field" ? parseFieldDesignDocument(payloadDocument) : parseProjectDocument(payloadDocument);
  const record = data.drawingMetadata!.records.find(isRecordedReferenceMetadataRecord)!;
  expect(record).toBeDefined(); expect(record.meaning).toEqual({ featureKind: shape.featureKind, geometryType: shape.geometryType, name, notes });
  expect(data.drawingMetadata!.retainedReferenceOrigins).toEqual([record.capture.origin]);
  expect(record.capture.origin.observations).toEqual(captured.observations); expect(record.capture.origin.sourceCollectionRevision).toBe(captured.revision);
  expect(record.capture.origin.receipt).toEqual(collection.applications.at(-1)); expect(record.attachment).toEqual({ collectionId: collection.id, applicationId: collection.applications.at(-1)!.id });
  const feature = data.mapFeatures!.find(item => item.id === record.target.id)!;
  expect(feature.geometry).toEqual(shape.geometryType === "Point" ? { type: "Point", point: captured.observations[0].projected }
    : { type: shape.geometryType, vertices: captured.observations.map(point => point.projected) });
  expect(feature.vertexCaptureEvidence).toEqual(captured.observations.map(point => point.captureEvidence));
  await expect(page.getByTestId("survey-reference-provenance")).toHaveText("Recorded Survey reference — original observations retained.");
  expect(await map!.evaluate(node => node === document.querySelector('[data-testid="workspace-map-surface"]'))).toBe(true);
  const currentPayload = async () => {
    const saved = await readWorkspace(page);
    const document = owner === "draft" ? saved.draftDocuments.find(item => item.id === draftPayloadId)!.document
      : owner === "field" ? saved.fieldDocuments!.find(item => item.id === fieldPayloadId)!.document
        : saved.projectDocuments.find(item => item.summary.id === "unified-source-project")!.document;
    return owner === "draft" ? parseDesignDraftDocument(document) : owner === "field" ? parseFieldDesignDocument(document) : parseProjectDocument(document);
  };
  await page.getByTestId("workspace-undo").click();
  await expect.poll(async () => (await currentPayload()).mapFeatures?.some(item => item.id === record.target.id) ?? false).toBe(false);
  await save(page);
  expect((await currentPayload()).drawingMetadata!.retainedReferenceOrigins).toEqual([record.capture.origin]);
  expect(parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).observations).toEqual(captured.observations);
  await page.getByTestId("workspace-redo").click();
  await expect.poll(async () => (await currentPayload()).mapFeatures?.find(item => item.id === record.target.id)).toEqual(feature);
  await save(page);
  const redone = await currentPayload();
  expect(redone.drawingMetadata!.records.find(isRecordedReferenceMetadataRecord)).toEqual(record);
  expect(redone.drawingMetadata!.retainedReferenceOrigins).toEqual([record.capture.origin]);
  const reopenedCollectionDocument = (await readWorkspace(page)).surveyCollections![0].document;
  expect(parseSurveyCollectionDocument(reopenedCollectionDocument).applications).toEqual(collection.applications);
  await reloadSavedWorkspace(page); await open(page, id); await page.getByTestId("workspace-mode-survey").click();
  await page.getByTestId("survey-collection").selectOption(collection.id); await page.getByTestId("survey-reference-details").click();
  await expect(page.getByTestId("survey-reference-name")).toHaveValue(name); await expect(page.getByTestId("survey-reference-notes")).toHaveValue(notes);
  expect((await readWorkspace(page)).surveyCollections![0].document).toBe(reopenedCollectionDocument);
  await writeFile(test.info().outputPath("recorded-reference-workspace.json"), serializeWorkspaceDocument(await readWorkspace(page)));
  await writeFile(test.info().outputPath("recorded-reference-storage.json"), JSON.stringify(await workspaceStorageBytes(page)));
});
