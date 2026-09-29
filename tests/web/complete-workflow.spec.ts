import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { encodeRgbaPng } from "../../tools/pngMetrics";
import { sampleProject, projectXyToLonLat, convertPivotProjectToFieldDesign, formatDistanceInputValue, serializeProjectDocument, parseFieldDesignDocument, parseFieldLayoutTarget, parseLayoutSessionDocument, tryBuildPivotProject } from "../../packages/core/src";
import { buildFieldDesignArchiveBundle, exportFieldDesignArchiveZip } from "../../packages/project-store/src/fieldDesignArchive";
import { importProjectArchiveZip } from "../../packages/project-store/src/projectArchive";
import { activateMapTool } from "./map-toolbar";
import { importLayoutSessionArchiveZip } from "../../packages/project-store/src/layoutSessionArchive";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument, type WorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { createWebWorkspaceStore } from "../../packages/project-store/src/webWorkspaceStore";
import { readWorkspace, workspaceKey } from "./workspace-fixtures";
import { connectOperationalReceiver, emitGga, gga, installOperationalReceiver, type ReceiverFixtureWindow } from "./operational-receiver-fixture";

const now = "2026-09-28T00:00:00.000Z";
test.use({ actionTimeout: 15_000 });
const errors = new WeakMap<BrowserContext, string[]>();
function completeDraftWorkspace(): WorkspaceDocument {
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "workflow-customer", input: {
    companyName: "Workflow Farm", primaryContactFirstName: "Test", primaryContactLastName: "Operator" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now, input: {
    clientId: "workflow-customer", projectId: "workflow-project", projectName: "North project", projectCrs: sampleProject.projectCrs,
    unitSystem: "us_survey_feet", fieldMapId: "workflow-field", fieldMapName: "North field" } }).workspace;
  return applyWorkspaceCommand(workspace, { type: "create_design_draft", now, designId: "workflow-draft", fieldMapId: "workflow-field", name: "Applied draft",
    draft: { ...structuredClone(sampleProject), id: "workflow-payload", name: "Applied draft" } }).workspace;
}

function expectProjectContent(actual: Record<string, unknown>, expected: Record<string, unknown>): void {
  const { wgs84Companion: actualDisplay, ...actualCanonical } = actual;
  const { wgs84Companion: expectedDisplay, ...expectedCanonical } = expected;
  expect(actualCanonical).toEqual(expectedCanonical);
  // Node and Chromium projection math can differ by one ULP in derived display coordinates.
  // Canonical projected XY, evidence and machine configuration above remain exact comparisons.
  function displayEqual(value: unknown, baseline: unknown): void {
    if (typeof baseline === "number") { expect(typeof value).toBe("number"); expect(value).toBeCloseTo(baseline, 11); return; }
    if (Array.isArray(baseline)) {
      expect(Array.isArray(value)).toBe(true); expect(value).toHaveLength(baseline.length);
      baseline.forEach((item, index) => displayEqual((value as unknown[])[index], item)); return;
    }
    if (baseline !== null && typeof baseline === "object") {
      expect(value !== null && typeof value === "object").toBe(true);
      expect(Object.keys(value as object).sort()).toEqual(Object.keys(baseline).sort());
      Object.entries(baseline).forEach(([key, item]) => displayEqual((value as Record<string, unknown>)[key], item)); return;
    }
    expect(value).toEqual(baseline);
  }
  displayEqual(actualDisplay, expectedDisplay);
}

async function seed(context: BrowserContext, workspace = emptyWorkspaceDocument()) {
  const values = new Map<string, string>();
  await createWebWorkspaceStore({ getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, action) => action() }) }).initializeAsync();
  values.set(workspaceKey, serializeWorkspaceDocument(workspace));
  await context.addInitScript(({ key, entries }) => {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    if (localStorage.getItem(key) === null) for (const [name, value] of entries) localStorage.setItem(name, value);
  }, { key: workspaceKey, entries: [...values] });
}
async function drawer(page: Page) {
  const button = page.getByRole("button", { name: "Open project drawer" });
  if (await button.isVisible()) await button.click();
}
async function openDraft(page: Page) {
  await page.goto("/");
  const resume = await page.evaluate(() => JSON.parse(localStorage.getItem("cplayout-desktop-context-v1") ?? "null"));
  if (!resume?.editorOpen || resume?.context?.designId !== "workflow-draft") {
    await drawer(page); await page.getByTestId("catalog-design-workflow-draft-open").click();
  }
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
  await page.getByTestId("draft-autosave").getByRole("switch").uncheck();
}
async function inputs(page: Page) {
  if (!await page.getByTestId("design-draft-inputs").isVisible()) await page.getByTestId("draft-inputs-toggle").click();
}
async function holdWriter(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => { (window as Window & { releaseWorkflowLock?: () => void }).releaseWorkflowLock = release; acquired(); });
      });
    });
  });
}
async function releaseWriter(page: Page) { await page.evaluate(() => (window as Window & { releaseWorkflowLock?: () => void }).releaseWorkflowLock?.()); }
async function bytes(page: Page, command: string): Promise<Buffer> {
  const pending = page.waitForEvent("download"); await page.getByTestId(command).click();
  return readFile((await (await pending).path())!);
}
async function session(page: Page, id?: string) {
  const workspace = await readWorkspace(page);
  const entry = id ? workspace.layoutSessions!.find(item => item.id === id)! : workspace.layoutSessions!.at(-1)!;
  return parseLayoutSessionDocument(entry.document);
}
async function completeAndOpenLayout(page: Page) {
  await page.getByTestId("draft-create-complete").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const close = page.getByRole("button", { name: /^(Close|Collapse) project drawer$/ });
  if (await close.isVisible()) await close.click();
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-create-independent-field").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await page.getByTestId("field-calculate").click();
  await page.getByTestId("field-freeze-target").click();
  const targetBytes = await bytes(page, "field-export-target");
  await page.getByTestId("field-open-layout").click();
  await expect(page.getByTestId("layout-import-review")).toBeVisible();
  const beforeUpgrade = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await page.getByTestId("layout-upgrade-confirm").click();
  await expect(page.getByTestId("layout-upgrade")).toHaveCount(0);
  expect((await readWorkspace(page)).originalPreviousWorkspaceDocument).toBe(beforeUpgrade);
  await page.getByTestId("layout-new-name").fill("North field staking");
  await page.getByTestId("layout-save-new").click();
  await expect(page.getByTestId("layout-session-workspace")).toBeVisible();
  const saved = await session(page);
  expect(saved.targetDocument).toBe(targetBytes.toString("utf8"));
  expect(saved.observations).toEqual([]);
  return saved;
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const found: string[] = []; errors.set(context, found);
  const observe = (tab: Page) => tab.on("pageerror", error => found.push(error.message));
  observe(page); context.on("page", observe);
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
});
test.afterEach(async ({ context }) => { expect(errors.get(context) ?? []).toEqual([]); });

test("empty workspace advances Customer to project and named first field to design without forced onboarding", async ({ page, context }, info) => {
  await seed(context); await page.goto("/"); await drawer(page);
  await page.getByTestId("project-tree-action-new").click();
  await expect(page.getByTestId("client-profile-dialog")).toContainText("Add Customer");
  await expect(page.getByTestId("client-profile-email-input")).toBeHidden();
  await page.getByTestId("client-profile-company-input").fill("North Creek Farm");
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-first-name-input-error")).toBeVisible();
  await expect(page.getByTestId("client-profile-last-name-input-error")).toBeVisible();
  await expect(page.getByTestId("client-profile-company-input")).toHaveValue("North Creek Farm");
  await page.getByTestId("client-profile-first-name-input").fill("Test");
  await page.getByTestId("client-profile-last-name-input").fill("Operator");
  await page.screenshot({ path: info.outputPath("customer-details.png") });
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  await drawer(page); await page.getByTestId("project-tree-action-new").click();
  await expect(page.getByTestId("catalog-dialog")).toContainText("Create Project");
  await page.getByTestId("catalog-dialog-name-input").fill("North Creek");
  await page.getByTestId("catalog-dialog-first-field-input").fill("");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog-first-field-input-error")).toBeVisible();
  expect((await readWorkspace(page)).catalog.projects).toEqual([]);
  await page.getByTestId("catalog-dialog-first-field-input").fill("West eighty");
  await page.screenshot({ path: info.outputPath("project-first-field.png") });
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  const created = await readWorkspace(page);
  expect(created.catalog.clients).toHaveLength(1);
  expect(created.catalog.fieldMaps).toHaveLength(1);
  expect(created.catalog.fieldMaps[0].name).toBe("West eighty");
  expect(created.projectDocuments).toEqual([]);
  await drawer(page); await page.getByTestId("project-tree-action-new").click();
  await expect(page.getByTestId("catalog-dialog")).toContainText("Create Design");
  await page.getByTestId("catalog-dialog-name-input").fill("West eighty pivot");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
  await expect(page.getByTestId("draft-create-complete")).toBeDisabled();
  await page.getByTestId("draft-missing-projectCrs").click();
  await expect(page.getByTestId("draft-crs")).toBeVisible();
  const drafted = await readWorkspace(page);
  expect(drafted.catalog.designs[0].fieldMapId).toBe(created.catalog.fieldMaps[0].id);
  expect(drafted.catalog.designs[0].kind).toBe("draft");
  for (const size of [{ width: 1366, height: 900 }, { width: 390, height: 844 }, { width: 1100, height: 520 }]) {
    await page.setViewportSize(size);
    await expect(page.getByTestId("draft-catalog")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: info.outputPath(`new-draft-${size.width}-${size.height}.png`) });
  }
  expect(await readWorkspace(page)).toEqual(drafted);
});

test("Calculate previews only; completion atomically retains the latest draft and exact canonical design", async ({ page, context }, info) => {
  await seed(context, completeDraftWorkspace()); await openDraft(page); await inputs(page);
  const before = await readWorkspace(page);
  await page.getByTestId("draft-calculate").click();
  await expect(page.getByTestId("draft-calculation-result")).toBeVisible();
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("draft-name").fill("Latest applied draft");
  await expect(page.getByTestId("draft-create-complete")).toBeDisabled();
  await page.getByRole("button", { name: "Apply name", exact: true }).click();
  await page.screenshot({ path: info.outputPath("completion-ready.png") });
  await holdWriter(page);
  try {
    await page.getByTestId("draft-create-complete").click();
    await expect(page.getByTestId("draft-create-complete")).toBeDisabled();
    await page.getByTestId("draft-create-complete").evaluate(node => { (node as HTMLElement).click(); (node as HTMLElement).click(); });
    expect(await readWorkspace(page)).toEqual(before);
  } finally { await releaseWriter(page); }
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const after = await readWorkspace(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.draftDocuments).toHaveLength(1);
  expect(after.projectDocuments).toHaveLength(1);
  expect(after.catalog.designs).toHaveLength(2);
  expect(after.catalog.designs.map(item => item.fieldMapId)).toEqual(["workflow-field", "workflow-field"]);
  const retained = JSON.parse(after.draftDocuments[0].document).draft;
  expect(retained.name).toBe("Latest applied draft");
  const built = tryBuildPivotProject(retained);
  expect(built.ok).toBe(true); if (!built.ok) throw new Error("Expected complete draft");
  const completed = JSON.parse(after.projectDocuments[0].document).project;
  expect(completed.id).not.toBe(retained.id);
  expectProjectContent({ ...completed, id: built.project.id, name: built.project.name }, JSON.parse(serializeProjectDocument(built.project)).project);
  expect(completed.fieldBoundary).toEqual(retained.fieldBoundary);
});

test("completion quota failure commits nothing and retains applied changes for an explicit retry", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openDraft(page); await inputs(page);
  await page.getByTestId("draft-name").fill("Retained retry");
  await page.getByRole("button", { name: "Apply name", exact: true }).click();
  const before = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    (window as Window & { restoreWorkflowStorage?: () => void }).restoreWorkflowStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(name, value) { if (name === key) throw new DOMException("Synthetic completion quota", "QuotaExceededError"); original.call(this, name, value); };
  }, workspaceKey);
  try {
    await page.getByTestId("draft-create-complete").click();
    await expect(page.getByTestId("draft-error")).toContainText("quota");
    await expect(page.getByTestId("draft-name")).toHaveValue("Retained retry");
    expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(before);
  } finally { await page.evaluate(() => (window as Window & { restoreWorkflowStorage?: () => void }).restoreWorkflowStorage?.()); }
  await page.getByTestId("draft-create-complete").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  expect((await readWorkspace(page)).projectDocuments).toHaveLength(1);
});

test("completed design converts explicitly to an immutable Layout session, collects separately, reopens and copies empty", async ({ page, context }, info) => {
  await seed(context, completeDraftWorkspace()); await installOperationalReceiver(page); await openDraft(page);
  const initial = await completeAndOpenLayout(page);
  const stored = await readWorkspace(page);
  const target = parseFieldLayoutTarget(initial.targetDocument);
  expect(target.field.fieldBoundary).toEqual(sampleProject.fieldBoundary);
  expect(parseFieldDesignDocument(stored.fieldDocuments![0].document).fieldBoundary).toEqual(sampleProject.fieldBoundary);
  await expect(page.getByTestId("layout-collect")).toBeDisabled();
  await connectOperationalReceiver(page);
  await expect(page.getByTestId("layout-collect")).toBeDisabled();
  await emitGga(page, gga());
  await expect(page.getByTestId("layout-collect")).toBeEnabled();
  await page.getByTestId("layout-observation-label").fill("Stake one");
  await page.screenshot({ path: info.outputPath("layout-fixed-ready.png") });
  await page.getByTestId("layout-collect").click();
  await expect(page.getByTestId("layout-save-state")).toContainText("Saved");
  await page.screenshot({ path: info.outputPath("layout-collected.png") });
  const collected = await session(page, initial.id);
  expect(collected.observations).toHaveLength(1);
  expect(collected.targetDocument).toBe(initial.targetDocument);
  expect(collected.targetHash).toBe(initial.targetHash);
  expect(collected.observations[0].evidence).toMatchObject({ schemaVersion: "gnss-operational-fixed-v1", physicalQualification: "unverified", gga: { qualityCode: 4, sentenceIdentifier: "GNGGA" } });
  await expect(page.getByTestId("layout-collect")).toBeDisabled();
  expect((await readWorkspace(page)).fieldDocuments).toEqual(stored.fieldDocuments);
  expect(parseLayoutSessionDocument((await bytes(page, "layout-export-json")).toString("utf8"))).toEqual(collected);
  expect(importLayoutSessionArchiveZip(await bytes(page, "layout-export-zip"))).toEqual(collected);
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  await page.getByTestId("layout-copy-name").fill("Independent empty staking");
  await page.getByTestId("layout-copy").click();
  await expect(page.getByTestId("layout-session-workspace")).toContainText("Independent empty staking");
  const copy = await session(page);
  expect(copy.id).not.toBe(initial.id);
  expect(copy.observations).toEqual([]);
  expect(copy.targetDocument).toBe(initial.targetDocument);
  expect(await session(page, initial.id)).toEqual(collected);
  await page.getByTestId("layout-workspace-back").click();
  await page.getByTestId(`layout-open-${initial.id}`).click();
  await expect(page.getByTestId(`layout-observation-${collected.observations[0].id}`)).toContainText("Stake one");
  await expect(page.getByTestId("layout-collect")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Connect receiver", exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath("layout-reopened-with-observation.png"), fullPage: true });
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(0);
});

test("unsupported Layout import creates nothing and leaves the selected field intact", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openDraft(page);
  await completeAndOpenLayout(page);
  await page.getByTestId("layout-workspace-back").click();
  const before = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await expect(page.getByTestId("layout-import-review")).toBeVisible();
  const retainedName = await page.getByTestId("layout-new-name").inputValue();
  const canceled = page.waitForEvent("filechooser"); await page.getByTestId("layout-import").click();
  await (await canceled).setFiles([]); // A chooser with no selected file preserves the current review.
  await expect(page.getByTestId("layout-import-review")).toBeVisible();
  await expect(page.getByTestId("layout-new-name")).toHaveValue(retainedName);
  const chooser = page.waitForEvent("filechooser"); await page.getByTestId("layout-import").click();
  await (await chooser).setFiles({ name: "unsupported.json", mimeType: "application/json", buffer: Buffer.from('{"documentVersion":"future-layout-v99"}') });
  await expect(page.getByTestId("layout-catalog-feedback")).toContainText("Choose a frozen Layout target JSON");
  await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
  await expect(page.getByTestId("layout-save-new")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(before);
});


test("stale draft completion cannot create a second design or overwrite the newer draft", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openDraft(page);
  const other = await context.newPage();
  try {
    await openDraft(other); await inputs(page);
    await page.getByTestId("draft-name").fill("Newer saved revision");
    await page.getByRole("button", { name: "Apply name", exact: true }).click();
    await page.getByTestId("draft-save").click();
    await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
    const before = await readWorkspace(page);
    await other.getByTestId("draft-create-complete").click();
    await expect(other.getByTestId("draft-error")).toContainText("revision changed");
    await expect(other.getByTestId("design-draft-workspace")).toBeVisible();
    expect(await readWorkspace(other)).toEqual(before);
    expect(before.projectDocuments).toEqual([]);
  } finally { await other.close(); }
});

test("Layout collection waiting on storage rechecks freshness and preserves the label after refusal", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await installOperationalReceiver(page); await openDraft(page);
  const initial = await completeAndOpenLayout(page); await connectOperationalReceiver(page);
  await emitGga(page, gga());
  await expect(page.getByTestId("layout-collect")).toBeEnabled();
  await page.getByTestId("layout-observation-label").fill("Retained after stale write");
  await holdWriter(page);
  try {
    await page.getByTestId("layout-collect").click();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending?.some(item => item.name === "cplayout:workspace:writer:v1") ?? false)).toBe(true);
    await page.evaluate(() => { (window as ReceiverFixtureWindow).operationalReceiver.nowMs += 2001; });
  } finally { await releaseWriter(page); }
  await expect(page.getByTestId("layout-save-state")).toContainText("Action failed");
  await expect(page.getByTestId("layout-observation-label")).toHaveValue("Retained after stale write");
  expect(await session(page, initial.id)).toEqual(initial);
  await emitGga(page, gga("120003.00"));
  await expect(page.getByTestId("layout-collect")).toBeEnabled();
  await page.getByTestId("layout-collect").click();
  await expect.poll(async () => (await session(page, initial.id)).observations.length).toBe(1);
  await disconnectReceiver(page);
});

async function disconnectReceiver(page: Page) {
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect receiver", exact: true })).toBeEnabled();
}

test("Layout target import requires review and retains exact bytes through rename, archive, restore and reload", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openDraft(page);
  const initial = await completeAndOpenLayout(page);
  await page.getByTestId("layout-workspace-back").click();
  const before = await readWorkspace(page);
  const targetDocument = `  ${initial.targetDocument}\n`;
  const chooser = page.waitForEvent("filechooser"); await page.getByTestId("layout-import").click();
  await (await chooser).setFiles({ name: "frozen-target.json", mimeType: "application/json", buffer: Buffer.from(targetDocument) });
  await expect(page.getByTestId("layout-catalog-feedback")).toContainText("File checked");
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("layout-associate-workflow-field").click();
  await page.getByTestId("layout-new-name").fill("Imported frozen field");
  await page.getByTestId("layout-save-new").click();
  await expect(page.getByTestId("layout-session-workspace")).toBeVisible();
  const imported = await session(page);
  expect(imported.targetDocument).toBe(targetDocument);
  expect(imported.targetHash).not.toBe(initial.targetHash);
  expect(parseFieldLayoutTarget(imported.targetDocument)).toEqual(parseFieldLayoutTarget(initial.targetDocument));
  await page.getByTestId("layout-rename-input").fill("Renamed imported field");
  await page.getByTestId("layout-rename").click();
  await expect(page.getByTestId("layout-save-state")).toContainText("Saved");
  await page.getByTestId("layout-archive").click();
  await page.getByTestId("layout-archive-confirm-confirm").click();
  await expect(page.getByTestId("layout-save-state")).toContainText("Archived");
  await expect(page.getByTestId("layout-collect")).toBeDisabled();
  await page.getByTestId("layout-archive").click();
  await expect(page.getByTestId("layout-save-state")).not.toContainText("Archived");
  await page.getByTestId("layout-reload").click();
  const restored = await session(page, imported.id);
  expect(restored.name).toBe("Renamed imported field");
  expect(restored.targetDocument).toBe(targetDocument);
  expect(restored.targetHash).toBe(imported.targetHash);
  expect(restored.observations).toEqual([]);
  expect(restored.archived).toBe(false);
  expect((await readWorkspace(page)).projectDocuments).toEqual(before.projectDocuments);
});


test("catalog import checks unsupported files and requires a destination before saving an independent copy", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await page.goto("/");
  await page.getByTestId("workspace-nav-dashboard").click();
  const startImport = page.getByTestId("dashboard-workspace").getByTestId("start-import");
  await startImport.click();
  await expect(page.getByTestId("catalog-archive-import")).toBeVisible();
  const before = await readWorkspace(page);
  async function choose(name: string, document: string) {
    const chooser = page.waitForEvent("filechooser"); await page.getByTestId("catalog-import-choose").click();
    await (await chooser).setFiles({ name, mimeType: "application/json", buffer: Buffer.from(document) });
  }
  await choose("future.json", '{"documentVersion":"future-design-v99"}');
  await expect(page.getByTestId("catalog-import-error")).toBeVisible();
  await expect(page.getByTestId("catalog-import-copy")).toBeDisabled();
  expect(await readWorkspace(page)).toEqual(before);
  await choose("complete-design.json", serializeProjectDocument(sampleProject));
  await expect(page.getByTestId("catalog-import-preview")).toContainText(sampleProject.name);
  await expect(page.getByTestId("catalog-import-copy")).toBeDisabled();
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("catalog-import-field").selectOption("workflow-field");
  await page.getByTestId("catalog-import-name").fill("Imported independent pivot");
  await page.getByTestId("catalog-import-copy").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const after = await readWorkspace(page);
  expect(after.draftDocuments).toEqual(before.draftDocuments);
  expect(after.projectDocuments).toHaveLength(1);
  const imported = JSON.parse(after.projectDocuments[0].document).project;
  expect(imported.id).not.toBe(sampleProject.id);
  expect(imported.name).toBe("Imported independent pivot");
  expectProjectContent({ ...imported, id: sampleProject.id, name: sampleProject.name }, JSON.parse(serializeProjectDocument(sampleProject)).project);
  expect(imported.fieldBoundary).toEqual(sampleProject.fieldBoundary);
  expect(after.catalog.designs.at(-1)!.fieldMapId).toBe("workflow-field");
});


async function returnToField(page: Page) {
  await page.getByTestId("layout-workspace-back").click();
  await page.getByTestId("layout-cancel-import").click();
  await page.getByTestId("layout-catalog-back").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
}

test("Layout writes refresh catalog counts and returning field can save a later edit without changing the target", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await installOperationalReceiver(page); await openDraft(page);
  const initial = await completeAndOpenLayout(page); await connectOperationalReceiver(page);
  await emitGga(page, gga()); await expect(page.getByTestId("layout-collect")).toBeEnabled();
  await page.getByTestId("layout-collect").click();
  await expect.poll(async () => (await session(page, initial.id)).observations.length).toBe(1);
  await disconnectReceiver(page);
  await page.getByTestId("layout-rename-input").fill("Observed field session");
  await page.getByTestId("layout-rename").click();
  await expect(page.getByTestId("layout-save-state")).toContainText("Saved");
  let retainedSession = await session(page, initial.id);
  await page.getByTestId("layout-workspace-back").click();
  await expect(page.getByTestId(`layout-session-row-${initial.id}`)).toContainText("Observed field session");
  await expect(page.getByTestId(`layout-session-row-${initial.id}`)).toContainText("1 saved observations");
  await page.getByTestId(`layout-open-${initial.id}`).click();
  await page.getByTestId("layout-archive").click();
  await page.getByTestId("layout-archive-confirm-confirm").click();
  await expect(page.getByTestId("layout-archive-confirm-backdrop")).toHaveCount(0);
  await expect(page.getByTestId("layout-save-state")).toContainText("Archived");
  await page.getByTestId("layout-workspace-back").click();
  await expect(page.getByTestId("layout-session-catalog")).toBeVisible();
  await expect(page.getByTestId(`layout-session-row-${initial.id}`)).toHaveCount(0);
  await page.getByTestId("layout-show-archived").click();
  await expect(page.getByTestId(`layout-session-row-${initial.id}`)).toContainText("Archived");
  await page.getByTestId(`layout-open-${initial.id}`).click();
  await page.getByTestId("layout-archive").click();
  await expect(page.getByTestId("layout-save-state")).not.toContainText("Archived");
  retainedSession = await session(page, initial.id);
  await page.getByTestId("layout-copy-name").fill("Empty catalog copy");
  await page.getByTestId("layout-copy").click();
  await expect(page.getByTestId("layout-session-workspace")).toContainText("Empty catalog copy");
  const copy = await session(page);
  await page.getByTestId("layout-workspace-back").click();
  await expect(page.getByTestId(`layout-session-row-${copy.id}`)).toContainText("0 saved observations");
  await expect(page.getByTestId(`layout-session-row-${initial.id}`)).toContainText("1 saved observations");
  await page.getByTestId(`layout-open-${initial.id}`).click();
  await returnToField(page);
  const before = await readWorkspace(page);
  const originalField = parseFieldDesignDocument(before.fieldDocuments![0].document);
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  await page.getByTestId("field-input-name").fill("Revised after Layout");
  await page.getByTestId("field-apply-machine").click();
  await page.getByTestId("field-save").click();
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  const after = await readWorkspace(page);
  const revised = parseFieldDesignDocument(after.fieldDocuments![0].document);
  expect(revised.machines[0].configuration.name).toBe("Revised after Layout");
  expect(revised.fieldBoundary).toEqual(originalField.fieldBoundary);
  expect(revised.machines[0].pivotCenter).toEqual(originalField.machines[0].pivotCenter);
  expect(await session(page, initial.id)).toEqual(retainedSession);
  await page.getByTestId("field-undo").click();
  await page.getByTestId("field-save").click();
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  expect(parseFieldDesignDocument((await readWorkspace(page)).fieldDocuments![0].document)).toEqual(originalField);
});

test("returning field refuses to overwrite an independently changed design after Layout", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openDraft(page);
  await completeAndOpenLayout(page);
  const before = await readWorkspace(page);
  const storedField = before.fieldDocuments![0];
  const field = parseFieldDesignDocument(storedField.document);
  const design = before.catalog.designs.find(item => item.kind === "field" && item.fieldDesignId === field.id)!;
  const updated = { ...field, name: "Other operator revision" };
  const changed = applyWorkspaceCommand(before, { type: "save_field_design", now, designId: design.id,
    expectedDesignRevision: design.revision, field: updated }).workspace;
  const other = await context.newPage();
  try {
    await other.goto("/");
    await other.evaluate(({ key, document }) => localStorage.setItem(key, document), { key: workspaceKey, document: serializeWorkspaceDocument(changed) });
    await returnToField(page);
    await page.getByTestId("field-autosave").getByRole("switch").uncheck();
    await page.getByTestId("field-input-name").fill("Retained original editor change");
    await page.getByTestId("field-apply-machine").click();
    await expect(page.getByTestId("field-receipt-conflict")).toContainText("saved field changed");
    await expect(page.getByTestId("field-save")).toBeDisabled();
    await expect(page.getByTestId("field-input-name")).toHaveValue("Retained original editor change");
    expect(await readWorkspace(page)).toEqual(changed);
  } finally { await other.close(); }
});

test("canceling imported copy activation retains the original unsaved editor and its undo and next save", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openDraft(page);
  await page.getByTestId("draft-create-complete").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const before = await readWorkspace(page);
  const originalId = before.projectDocuments[0].summary.id;
  const close = page.getByRole("button", { name: /^(Close|Collapse) project drawer$/ });
  if (await close.isVisible()) await close.click();
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nretained-import-edit,Retained input,note,501050,4506050,imported,rtk_float\n");
  await page.getByTestId("files-action-import-csv").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-catalog").click();
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByTestId("start-import").click();
  const chooser = page.waitForEvent("filechooser"); await page.getByTestId("catalog-import-choose").click();
  await (await chooser).setFiles({ name: "independent.json", mimeType: "application/json", buffer: Buffer.from(serializeProjectDocument(sampleProject)) });
  await page.getByTestId("catalog-import-field").selectOption("workflow-field");
  await page.getByTestId("catalog-import-name").fill("Retained imported sibling");
  await page.getByTestId("catalog-import-copy").click();
  await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
  const withCopy = await readWorkspace(page);
  expect(withCopy.projectDocuments).toHaveLength(2);
  expect(withCopy.projectDocuments.find(item => item.summary.id === originalId)).toEqual(before.projectDocuments[0]);
  await page.getByTestId("project-to-draft-discard-cancel").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  await page.getByTestId("command-icon-undo").click();
  await expect(page.getByTestId("command-icon-redo")).toBeEnabled();
  await page.getByTestId("workspace-nav-files").click();
  const undone = importProjectArchiveZip(await bytes(page, "files-action-export-zip"));
  expect(undone.surveyPoints?.some(point => point.id === "retained-import-edit")).toBe(false);
  expect(undone.fieldBoundary).toEqual(sampleProject.fieldBoundary);
  expect(await readWorkspace(page)).toEqual(withCopy);
  await page.getByTestId("command-icon-redo").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const after = await readWorkspace(page);
  const original = JSON.parse(after.projectDocuments.find(item => item.summary.id === originalId)!.document).project;
  expect(original.surveyPoints).toContainEqual(expect.objectContaining({ id: "retained-import-edit" }));
  expect(after.projectDocuments.find(item => item.summary.id !== originalId)).toEqual(withCopy.projectDocuments.find(item => item.summary.id !== originalId));
  expect(original.fieldBoundary).toEqual(sampleProject.fieldBoundary);
});

test("unapplied complete-machine input survives panel navigation and canceled imported-copy activation", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openDraft(page);
  await page.getByTestId("draft-create-complete").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const before = await readWorkspace(page);
  const original = before.projectDocuments[0];
  const pendingSpan = "173.125";
  async function openMachine() {
    await page.getByTestId("workspace-nav-map").click();
    const openInspector = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ }).first();
    if (await openInspector.isVisible()) await openInspector.click();
    await page.getByTestId("workflow-sidebar-tab-tools").click();
    await page.getByTestId("inspector-scroll").getByTestId("design-action-machine").click();
    await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  }
  const firstSpan = () => page.getByTestId("design-console-dialog").getByText(/^Span 1 \(/).locator("..").getByRole("textbox");
  await openMachine();
  await firstSpan().fill(pendingSpan);
  await page.getByTestId("design-console-dialog").getByRole("button", { name: "End Gun Settings", exact: true }).click();
  await expect(page.getByTestId("design-console-dialog")).toContainText("End Gun");
  await page.getByTestId("design-console-close").click();
  await openMachine();
  await expect(firstSpan()).toHaveValue(pendingSpan);
  expect((await readWorkspace(page)).projectDocuments).toEqual(before.projectDocuments);
  await page.getByTestId("design-console-close").click();
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-catalog").click();
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByTestId("start-import").click();
  const chooser = page.waitForEvent("filechooser"); await page.getByTestId("catalog-import-choose").click();
  await (await chooser).setFiles({ name: "pending-input-copy.json", mimeType: "application/json", buffer: Buffer.from(serializeProjectDocument(sampleProject)) });
  await page.getByTestId("catalog-import-field").selectOption("workflow-field");
  await page.getByTestId("catalog-import-name").fill("Independent imported machine");
  await page.getByTestId("catalog-import-copy").click();
  await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
  await page.getByTestId("project-to-draft-discard-cancel").click();
  await openMachine();
  await expect(firstSpan()).toHaveValue(pendingSpan);
  const after = await readWorkspace(page);
  expect(after.projectDocuments).toHaveLength(2);
  expect(after.projectDocuments.find(item => item.summary.id === original.summary.id)).toEqual(original);
  expect(after.projectDocuments.find(item => item.summary.id !== original.summary.id)!.summary.name).toBe("Independent imported machine");
});

async function openCompleteEditor(page: Page) {
  await openDraft(page);
  await page.getByTestId("draft-create-complete").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const close = page.getByRole("button", { name: /^(Close|Collapse) project drawer$/ });
  if (await close.isVisible()) await close.click();
}
async function openCatalog(page: Page) {
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-catalog").click();
}
async function importSiblingAndCancelActivation(page: Page, name: string) {
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByTestId("start-import").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("catalog-import-choose").click();
  await (await chooser).setFiles({ name: "retained-source-copy.json", mimeType: "application/json", buffer: Buffer.from(serializeProjectDocument(sampleProject)) });
  await page.getByTestId("catalog-import-field").selectOption("workflow-field");
  await page.getByTestId("catalog-import-name").fill(name);
  await page.getByTestId("catalog-import-copy").click();
  await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
  await page.getByTestId("project-to-draft-discard-cancel").click();
}
async function drawingMap(page: Page) {
  await page.getByTestId("workspace-nav-map").click();
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  await expect(map).toHaveAttribute("data-map-loaded", "true");
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60_000 });
  const fieldCenter = projectXyToLonLat(sampleProject.pivotCenter, sampleProject.projectCrs);
  let previous: string | null = null;
  let stableReads = 0;
  await expect.poll(async () => {
    const current = await map.getAttribute("data-map-camera");
    stableReads = current !== null && current === previous ? stableReads + 1 : 0;
    previous = current;
    const camera = current ? JSON.parse(current) as number[] : [];
    return { settled: stableReads >= 2, zoomed: Number.isFinite(camera[2]) && camera[2] > 0,
      nearField: Number.isFinite(camera[0]) && Number.isFinite(camera[1])
        && Math.abs(camera[0] - fieldCenter.longitude) < 0.1 && Math.abs(camera[1] - fieldCenter.latitude) < 0.1 };
  }, { timeout: 10_000, intervals: [150], message: "The newly opened design must finish its initial field fit; a loaded world-origin camera is not drawing-ready" })
    .toEqual({ settled: true, zoomed: true, nearField: true });
  return map;
}

async function installDrawingImagery(page: Page): Promise<void> {
  // These retention checks need a fully loaded map. Blocked raster retries can
  // delay its load event, so supply only the expected imagery tiles locally.
  const pixels = new Uint8Array(256 * 256 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([20, 40, 60, 255], offset);
  const tile = Buffer.from(encodeRgbaPng(256, 256, pixels));
  await page.route(/\/USGSImagery(?:Only|Topo)\/MapServer\/tile\/\d+\/\d+\/\d+(?:\?.*)?$/, route =>
    route.fulfill({ contentType: "image/png", body: tile }));
}

test("finished drawing purpose and optional input survive File Catalog and canceled imported-copy activation", async ({ page, context }, info) => {
  await installDrawingImagery(page);
  await seed(context, completeDraftWorkspace()); await openCompleteEditor(page);
  const before = await readWorkspace(page);
  const original = before.projectDocuments[0];
  const map = await drawingMap(page);
  await activateMapTool(page, "point");
  const fieldPoint = await unobstructedFieldPoint(map);
  await clickMapCanvas(map, fieldPoint);
  const purpose = page.getByTestId("pending-draft-purpose-panel");
  await expect(purpose).toBeVisible();
  await page.getByTestId("pending-draft-purpose-select").selectOption("map_feature:well_location");
  await page.screenshot({ path: info.outputPath("finished-drawing-purpose.png") });
  await purpose.getByRole("button", { name: "Name and notes (optional)", exact: true }).click();
  await page.getByRole("textbox", { name: "Drawing name", exact: true }).fill("Retained well position");
  await page.getByRole("textbox", { name: "Drawing notes", exact: true }).fill("Unfinished purpose details");
  const camera = await map.getAttribute("data-map-camera");
  await openCatalog(page);
  await expect(purpose).toBeHidden();
  expect(await readWorkspace(page)).toEqual(before);
  await importSiblingAndCancelActivation(page, "Sibling while purpose pending");
  await expect(purpose).toBeVisible();
  await expect(page.getByTestId("pending-draft-purpose-select")).toHaveValue("map_feature:well_location");
  const reveal = purpose.getByRole("button", { name: "Name and notes (optional)", exact: true });
  if (await reveal.isVisible()) await reveal.click();
  await expect(page.getByRole("textbox", { name: "Drawing name", exact: true })).toHaveValue("Retained well position");
  await expect(page.getByRole("textbox", { name: "Drawing notes", exact: true })).toHaveValue("Unfinished purpose details");
  await expect(purpose.getByText("What did you draw?", { exact: true })).toBeVisible();
  await expect(purpose.getByRole("button", { name: "Hide optional details", exact: true })).toBeVisible();
  await expect(page.getByTestId("pending-draft-keep")).toBeEnabled();
  await expect(map).toHaveAttribute("data-map-camera", camera!);
  const siblingWrite = await readWorkspace(page);
  expect(siblingWrite.projectDocuments.find(item => item.summary.id === original.summary.id)).toEqual(original);
  await page.getByTestId("pending-draft-keep").click();
  await expect(purpose).toHaveCount(0);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const after = await readWorkspace(page);
  const saved = JSON.parse(after.projectDocuments.find(item => item.summary.id === original.summary.id)!.document).project;
  expect(saved.mapFeatures).toContainEqual(expect.objectContaining({ kind: "well_location", name: "Retained well position", notes: "Unfinished purpose details" }));
  const well = saved.mapFeatures.find((feature: { name: string }) => feature.name === "Retained well position");
  expect(well.geometry.type).toBe("Point");
  expect(insideSampleField(well.geometry.point)).toBe(true);
  expect(saved.fieldBoundary).toEqual(sampleProject.fieldBoundary);
  expect(after.projectDocuments.find(item => item.summary.id !== original.summary.id)).toEqual(siblingWrite.projectDocuments.find(item => item.summary.id !== original.summary.id));
});

test("unsubmitted CSV and GeoJSON text survive panel navigation and File Catalog import cancellation without geometry changes", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openCompleteEditor(page);
  const before = await readWorkspace(page);
  const original = before.projectDocuments[0];
  const csv = "id,label,role,x,y,source,confidence\nnot-imported,Still typing,note,501050,4506050,imported,rtk_float\n";
  const geojson = '{"type":"FeatureCollection","features":['; // Deliberately unfinished: navigation must not parse or apply it.
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill(csv);
  await page.getByTestId("files-geojson-import-input").fill(geojson);
  await page.getByTestId("workspace-nav-map").click();
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("files-survey-csv-import-input")).toHaveValue(csv);
  await expect(page.getByTestId("files-geojson-import-input")).toHaveValue(geojson);
  expect(await readWorkspace(page)).toEqual(before);
  await openCatalog(page);
  await importSiblingAndCancelActivation(page, "Sibling while files input pending");
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("files-survey-csv-import-input")).toHaveValue(csv);
  await expect(page.getByTestId("files-geojson-import-input")).toHaveValue(geojson);
  const snapshot = importProjectArchiveZip(await bytes(page, "files-action-export-zip"));
  expectProjectContent(snapshot as unknown as Record<string, unknown>, JSON.parse(original.document).project);
  const after = await readWorkspace(page);
  expect(after.projectDocuments).toHaveLength(2);
  expect(after.projectDocuments.find(item => item.summary.id === original.summary.id)).toEqual(original);
});

test("field conversion quota after workspace upgrade preserves the source and permits its next save and conversion retry", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openCompleteEditor(page);
  const beforeBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  const before = await readWorkspace(page);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    let writes = 0;
    (window as Window & { restoreWorkflowStorage?: () => void }).restoreWorkflowStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function(name, value) {
      if (name === key && ++writes === 2) throw new DOMException("Synthetic conversion quota", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, workspaceKey);
  try {
    await page.getByTestId("command-menu-file").click();
    await page.getByTestId("command-create-independent-field").click();
    await expect(page.getByText(/quota/i).first()).toBeVisible();
    await expect(page.getByTestId("field-design-workspace")).toHaveCount(0);
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    const upgraded = await readWorkspace(page);
    expect(upgraded.workspaceVersion).toBe("cplayout-workspace-v2");
    expect(upgraded.originalV1Document).toBe(beforeBytes);
    expect(upgraded.projectDocuments).toEqual(before.projectDocuments);
    expect(upgraded.catalog).toEqual(before.catalog);
    expect(upgraded.fieldDocuments).toEqual([]);
    expect(upgraded.revision).toBe(before.revision + 1);
  } finally { await page.evaluate(() => (window as Window & { restoreWorkflowStorage?: () => void }).restoreWorkflowStorage?.()); }
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nafter-quota,Source retry,note,501050,4506050,imported,rtk_float\n");
  await page.getByTestId("files-action-import-csv").click();
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const saved = await readWorkspace(page);
  expect(JSON.parse(saved.projectDocuments[0].document).project.surveyPoints).toContainEqual(expect.objectContaining({ id: "after-quota" }));
  expect(JSON.parse(saved.projectDocuments[0].document).project.fieldBoundary).toEqual(sampleProject.fieldBoundary);
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-create-independent-field").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  const converted = await readWorkspace(page);
  expect(converted.projectDocuments).toEqual(saved.projectDocuments);
  expect(converted.fieldDocuments).toHaveLength(1);
  expect(parseFieldDesignDocument(converted.fieldDocuments![0].document).fieldBoundary).toEqual(sampleProject.fieldBoundary);
});

test("unfinished vertices retain drawing mode and camera through File Catalog and canceled design activation", async ({ page, context }) => {
  await installDrawingImagery(page);
  await seed(context, completeDraftWorkspace()); await openCompleteEditor(page);
  const before = await readWorkspace(page);
  const original = before.projectDocuments[0];
  const source = before.catalog.designs.find(item => item.kind === "project" && item.pivotProjectId === original.summary.id);
  expect(source).toBeDefined();
  const map = await drawingMap(page);
  await activateMapTool(page, "polygon");
  const points = [await nextUnobstructedMapTrianglePoint(map, [])];
  await clickMapCanvas(map, points[0]);
  await expect(page.getByText(/measure .* 1 draft pts .* polygon needs 3 pts/)).toBeVisible();
  points.push(await nextUnobstructedMapTrianglePoint(map, points));
  await clickMapCanvas(map, points[1]);
  const vertices = page.getByText(/measure .* 2 draft pts .* polygon needs 3 pts/);
  await expect(vertices).toBeVisible();
  const camera = await map.getAttribute("data-map-camera");
  const feedback = await page.getByTestId("browser-map-action-status").innerText();
  await openCatalog(page);
  await drawer(page);
  await page.getByTestId(`catalog-design-${source!.id}-open`).click();
  await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
  await page.getByTestId("project-to-draft-discard-cancel").click();
  const close = page.getByRole("button", { name: /^(Close|Collapse) project drawer$/ });
  if (await close.isVisible()) await close.click();
  const closeInspector = page.getByRole("button", { name: /Collapse (map inspector|right workflow sidebar)/ }).first();
  if (await closeInspector.isVisible()) await closeInspector.click();
  await expect(vertices).toBeVisible();
  await expect(page.getByTestId("design-action-polygon")).toHaveAttribute("aria-pressed", "true");
  await expect(map).toHaveAttribute("data-map-camera", camera!);
  await expect(page.getByTestId("browser-map-action-status")).toHaveText(feedback);
  expect(await readWorkspace(page)).toEqual(before);
  points.push(await nextUnobstructedMapTrianglePoint(map, points));
  await clickMapCanvas(map, points[2]);
  await expect(page.getByText(/measure .* 3 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await page.getByTestId("browser-action-save-feature").click();
  await page.getByTestId("pending-draft-purpose-select").selectOption("map_feature:measurement_area");
  await page.getByTestId("pending-draft-keep").click();
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const saved = JSON.parse((await readWorkspace(page)).projectDocuments[0].document).project;
  expect(saved.fieldBoundary).toEqual(sampleProject.fieldBoundary);
  const added = saved.mapFeatures.filter((item: { id: string }) => !JSON.parse(original.document).project.mapFeatures?.some((old: { id: string }) => old.id === item.id));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ kind: "measurement_area" });
  expect(added[0].geometry).toMatchObject({ type: "Polygon" });
  expect(added[0].geometry.vertices).toHaveLength(3);
});

type ExpectedResumeContext = { clientId: string; projectId: string; fieldMapId: string; designId: string };
async function expectResume(page: Page, context: ExpectedResumeContext) {
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cplayout-desktop-context-v1") ?? "null")))
    .toMatchObject({ version: 1, editorOpen: true, view: "map", context });
}
async function expectCatalogSelection(page: Page, context: ExpectedResumeContext) {
  await drawer(page);
  for (const [kind, id] of [["client", context.clientId], ["project", context.projectId], ["field-map", context.fieldMapId], ["design", context.designId]]) {
    await expect(page.getByTestId(`catalog-${kind}-${id}`)).toHaveAttribute("aria-selected", "true");
  }
}

for (const autosave of [false, true]) {
  test(`reload restores a newly created ${autosave ? "autosaved" : "manually saved"} draft and its complete catalog context`, async ({ page, context }) => {
    await seed(context, completeDraftWorkspace()); await page.goto("/"); await drawer(page);
    await page.getByTestId("catalog-field-map-workflow-field").click();
    await page.getByTestId("project-tree-action-new").click();
    await expect(page.getByTestId("catalog-dialog")).toContainText("Create Design");
    await page.getByTestId("catalog-dialog-name-input").fill("New reload draft");
    await page.getByTestId("catalog-dialog-create").click();
    await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
    const switchControl = page.getByTestId("draft-autosave").getByRole("switch");
    if (autosave) await switchControl.check(); else await switchControl.uncheck();
    await inputs(page);
    const savedName = autosave ? "Autosaved new draft" : "Manually saved new draft";
    await page.getByTestId("draft-name").fill(savedName);
    await page.getByRole("button", { name: "Apply name", exact: true }).click();
    if (!autosave) await page.getByTestId("draft-save").click();
    await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
    await expect.poll(async () => (await readWorkspace(page)).catalog.designs.find(item => item.name === savedName)?.kind).toBe("draft");
    const saved = await readWorkspace(page);
    const design = saved.catalog.designs.find(item => item.kind === "draft" && item.name === savedName)!;
    expect(design.id).not.toBe("workflow-draft");
    const selected = { clientId: "workflow-customer", projectId: "workflow-project", fieldMapId: "workflow-field", designId: design.id };
    await expectResume(page, selected);
    const savedBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
    // No helper may open a catalog row here: startup must choose the actual newly created editor.
    await page.reload();
    await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
    await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
    await inputs(page);
    await expect(page.getByTestId("draft-name")).toHaveValue(savedName);
    await expectResume(page, selected);
    expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
    expect((await readWorkspace(page)).draftDocuments).toEqual(saved.draftDocuments);
    await page.getByTestId("draft-catalog").click();
    await expectCatalogSelection(page, selected);
  });
}

test("reload restores the newly converted saved field instead of its complete source editor", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await openCompleteEditor(page);
  const original = (await readWorkspace(page)).projectDocuments;
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-create-independent-field").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  await page.getByTestId("field-input-name").fill("Converted machine after save");
  await page.getByTestId("field-apply-machine").click();
  await page.getByTestId("field-save").click();
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  const saved = await readWorkspace(page);
  const design = saved.catalog.designs.find(item => item.kind === "field")!;
  const field = parseFieldDesignDocument(saved.fieldDocuments![0].document);
  expect(field.machines[0].configuration.name).toBe("Converted machine after save");
  expect(saved.projectDocuments).toEqual(original);
  const selected = { clientId: "workflow-customer", projectId: "workflow-project", fieldMapId: "workflow-field", designId: design.id };
  await expectResume(page, selected);
  const savedBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await page.reload();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  await expect(page.getByTestId("field-input-name")).toHaveValue("Converted machine after save");
  await expect(page.getByTestId("field-reconciling")).toHaveCount(0);
  await expectResume(page, selected);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
  expect((await readWorkspace(page)).projectDocuments).toEqual(original);
  await page.getByTestId("field-catalog").click();
  await expectCatalogSelection(page, selected);
});

test("reload restores an imported saved field in its selected customer project and field", async ({ page, context }, info) => {
  let workspace = completeDraftWorkspace();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "import-customer", input: {
    companyName: "Import Destination Farm", primaryContactFirstName: "Second", primaryContactLastName: "Operator" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now, input: {
    clientId: "import-customer", projectId: "import-project", projectName: "Imported project", projectCrs: sampleProject.projectCrs,
    unitSystem: "us_survey_feet", fieldMapId: "import-field", fieldMapName: "Imported field container" } }).workspace;
  await seed(context, workspace); await openCompleteEditor(page);
  const sourceDocuments = (await readWorkspace(page)).projectDocuments;
  const originalProjectDocument = serializeProjectDocument(sampleProject);
  const converted = convertPivotProjectToFieldDesign(originalProjectDocument, { fieldId: "external-field", waterSourceId: "external-water", powerSourceId: "external-power" }).field;
  const first = converted.machines[0];
  const source = { ...converted, machines: [first, { ...structuredClone(first), id: "external-second-pivot",
    pivotCenter: { x: first.pivotCenter.x + 140, y: first.pivotCenter.y - 70 }, configuration: { ...first.configuration,
      name: "Unequal second pivot", spanLengthsMeters: [31.125, 42.375, 27.0625], overhangMeters: 12.875, endGunThrowMeters: 17.625 } }] };
  const archive = exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(source, now, originalProjectDocument));
  await openCatalog(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByTestId("start-import").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("catalog-import-choose").click();
  await (await chooser).setFiles({ name: "external-field.zip", mimeType: "application/zip", buffer: Buffer.from(archive) });
  await page.getByTestId("catalog-import-field").selectOption("import-field");
  await page.getByTestId("catalog-import-name").fill("Imported field to resume");
  await page.getByTestId("catalog-import-upgrade-confirm").click();
  await expect(page.getByTestId("catalog-import-upgrade")).toHaveCount(0);
  await page.getByTestId("catalog-import-copy").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  const saved = await readWorkspace(page);
  const design = saved.catalog.designs.find(item => item.kind === "field" && item.name === "Imported field to resume")!;
  expect(design.fieldMapId).toBe("import-field");
  const field = parseFieldDesignDocument(saved.fieldDocuments![0].document);
  expect(field.id).not.toBe(source.id);
  expect(field.fieldBoundary).toEqual(source.fieldBoundary);
  expect(field.machines).toHaveLength(2);
  expect(field.machines[0].configuration.spanLengthsMeters).not.toEqual(field.machines[1].configuration.spanLengthsMeters);
  for (const [index, machine] of field.machines.entries()) {
    await page.getByTestId(`field-machine-${machine.id}`).click();
    await expect(page.getByTestId("field-selected-machine")).toContainText(machine.configuration.name);
    await expect(page.getByTestId("field-machine-form")).toContainText("Showing the applied machine values.");
    await expect(page.getByTestId("field-input-spans")).toHaveValue(machine.configuration.spanLengthsMeters.map(value => formatDistanceInputValue(value, "us_survey_feet")).join(", "));
    await page.getByTestId("field-input-spans").scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`field-machine-${index + 1}-applied-imperial.png`) });
  }
  expect(saved.projectDocuments).toEqual(sourceDocuments);
  const selected = { clientId: "import-customer", projectId: "import-project", fieldMapId: "import-field", designId: design.id };
  await expectResume(page, selected);
  const savedBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await page.reload();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await expect(page.getByTestId("field-design-workspace")).toContainText("Imported field to resume");
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  await expect(page.getByTestId("field-selected-machine")).toContainText(field.machines[0].id);
  await expect(page.getByTestId("field-reconciling")).toHaveCount(0);
  await expectResume(page, selected);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
  await page.getByTestId("field-catalog").click();
  await expectCatalogSelection(page, selected);
});

async function nextUnobstructedMapTrianglePoint(map: Locator, previous: Array<{ x: number; y: number }>): Promise<{ x: number; y: number }> {
  // Accepted vertices can expand the HUD. Re-scan the current canvas before each click.
  const point = await map.evaluate((element, accepted) => {
    const frame = element.getBoundingClientRect();
    const canvas = element.querySelector("canvas.maplibregl-canvas");
    if (!canvas) return null;
    const clear: Array<{ x: number; y: number }> = [];
    for (let y = 24; y < frame.height - 24; y += 12) {
      for (let x = 24; x < frame.width - 24; x += 12) {
        if (document.elementFromPoint(frame.x + x, frame.y + y) === canvas) clear.push({ x, y });
      }
    }
    const [fx, fy] = [[0.35, 0.35], [0.5, 0.55], [0.65, 0.35]][accepted.length];
    const candidates = clear.filter(candidate => accepted.every(previous => Math.hypot(previous.x - candidate.x, previous.y - candidate.y) >= 28));
    candidates.sort((a, b) => Math.hypot(a.x - frame.width * fx, a.y - frame.height * fy) - Math.hypot(b.x - frame.width * fx, b.y - frame.height * fy));
    return candidates.find(candidate => accepted.length < 2 || Math.abs((accepted[1].x - accepted[0].x) * (candidate.y - accepted[0].y)
      - (accepted[1].y - accepted[0].y) * (candidate.x - accepted[0].x)) > 200) ?? null;
  }, previous);
  expect(point, "Map must expose the next separated non-collinear canvas point outside its current overlays").not.toBeNull();
  if (!point) throw new Error("No unobstructed triangle point is available");
  return point;
}
async function clickMapCanvas(map: Locator, point: { x: number; y: number }) {
  expect(await map.evaluate((element, position) => {
    const frame = element.getBoundingClientRect();
    return document.elementFromPoint(frame.x + position.x, frame.y + position.y) === element.querySelector("canvas.maplibregl-canvas");
  }, point), "Drawing click must hit the canvas, not an attribution or tool overlay").toBe(true);
  await map.click({ position: point });
}
async function expectUnobstructedControl(control: Locator) {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  expect(await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    return box.width > 0 && box.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
      && element.contains(document.elementFromPoint(x, y));
  }), "Rail control center must be inside the viewport and receive pointer input").toBe(true);
}

test("short window keeps New and every catalog hierarchy control reachable before and after opening an editor", async ({ page, context }, info) => {
  await page.setViewportSize({ width: 1000, height: 580 });
  const initial = completeDraftWorkspace();
  await seed(context, initial); await page.goto("/"); await drawer(page);
  const newAction = page.getByTestId("project-tree-action-new");
  await expectUnobstructedControl(newAction);
  await newAction.click();
  await expect.poll(async () => await page.getByTestId("client-profile-dialog").isVisible() || await page.getByTestId("catalog-dialog").isVisible()).toBe(true);
  if (await page.getByTestId("client-profile-dialog").isVisible()) await page.getByTestId("client-profile-cancel").click();
  else await page.getByTestId("catalog-dialog-cancel").click();
  const ids = ["catalog-client-workflow-customer", "catalog-project-workflow-project", "catalog-field-map-workflow-field", "catalog-design-workflow-draft"];
  for (const id of ids) {
    const control = page.getByTestId(id);
    await expectUnobstructedControl(control);
    await control.click();
    await expect(control).toHaveAttribute("aria-selected", "true");
  }
  await expectUnobstructedControl(newAction);
  await page.screenshot({ path: info.outputPath("catalog-short-1000x580.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await readWorkspace(page)).toEqual(initial);
  const open = page.getByTestId("catalog-design-workflow-draft-open");
  await expectUnobstructedControl(open);
  await open.click();
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
  await page.getByTestId("draft-catalog").click();
  await drawer(page);
  await expectUnobstructedControl(newAction);
  for (const id of ids) await expectUnobstructedControl(page.getByTestId(id));
  expect(await readWorkspace(page)).toEqual(initial);
});


test("catalog import Back confirmation cancels without losing the review and discards only after confirmation", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await page.goto("/");
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByTestId("dashboard-workspace").getByTestId("start-import").click();
  const before = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  const source = serializeProjectDocument({ ...structuredClone(sampleProject), name: "Exact pending source" });
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("catalog-import-choose").click();
  await (await chooser).setFiles({ name: "pending-source.json", mimeType: "application/json", buffer: Buffer.from(source) });
  await page.getByTestId("catalog-import-field").selectOption("workflow-field");
  await page.getByTestId("catalog-import-name").fill("Unfinished import name  ");
  await expect(page.getByTestId("catalog-import-copy")).toBeEnabled();
  const destination = await page.getByTestId("catalog-import-destination").innerText();
  await page.getByTestId("catalog-import-back").click();
  await expect(page.getByTestId("catalog-import-discard")).toContainText("Discard this import review?");
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(before);
  await page.getByTestId("catalog-import-discard-cancel").click();
  await expect(page.getByTestId("catalog-import-discard")).toBeHidden();
  await expect(page.getByTestId("catalog-archive-import")).toBeVisible();
  await expect(page.getByTestId("catalog-import-filename")).toHaveText("pending-source.json");
  await expect(page.getByTestId("catalog-import-preview")).toContainText("Complete design: Exact pending source");
  await expect(page.getByTestId("catalog-import-field")).toHaveValue("workflow-field");
  await expect(page.getByTestId("catalog-import-destination")).toHaveText(destination);
  await expect(page.getByTestId("catalog-import-name")).toHaveValue("Unfinished import name  ");
  await expect(page.getByTestId("catalog-import-copy")).toBeEnabled();
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(before);
  await page.getByTestId("catalog-import-back").click();
  await page.getByTestId("catalog-import-discard-confirm").click();
  await expect(page.getByTestId("catalog-archive-import")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(before);
  await page.getByTestId("dashboard-workspace").getByTestId("start-import").click();
  await expect(page.getByTestId("catalog-import-preview")).toHaveCount(0);
  await expect(page.getByTestId("catalog-import-filename")).toHaveCount(0);
  await expect(page.getByTestId("catalog-import-field")).toHaveValue("");
  await expect(page.getByTestId("catalog-import-copy")).toBeDisabled();
  await page.getByTestId("catalog-import-back").click();
  await expect(page.getByTestId("catalog-archive-import")).toHaveCount(0);
  await expect(page.getByTestId("catalog-import-discard")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(before);
});

test("Survey and Layout share active receiver configuration errors and unfinished communications inputs", async ({ page, context }) => {
  await seed(context, completeDraftWorkspace()); await installOperationalReceiver(page); await openDraft(page);
  const initial = await completeAndOpenLayout(page);
  await returnToField(page);
  await page.getByTestId("field-catalog").click();
  await page.getByTestId("workspace-nav-survey").click();
  const baseline = await readWorkspace(page);
  await page.evaluate(() => {
    type Port = { open(options: { baudRate: number }): Promise<void> };
    const serial = (navigator as unknown as { serial: { requestPort(): Promise<Port> } }).serial;
    const requestPort = serial.requestPort.bind(serial);
    (window as Window & { recordedReceiverBauds?: number[] }).recordedReceiverBauds = [];
    serial.requestPort = async () => {
      const port = await requestPort();
      const open = port.open.bind(port);
      port.open = async options => {
        (window as Window & { recordedReceiverBauds: number[] }).recordedReceiverBauds.push(options.baudRate);
        await open(options);
      };
      return port;
    };
  });
  const status = page.locator('[data-testid="receiver-status"]:visible');
  const readiness = page.locator('[data-testid="receiver-collection-readiness"]:visible');
  async function toLayout() {
    await page.getByTestId("open-layout-sessions").click();
    await page.getByTestId(`layout-open-${initial.id}`).click();
    await expect(page.getByTestId("layout-session-workspace")).toBeVisible();
  }
  async function toSurvey() {
    await page.getByTestId("layout-workspace-back").click();
    await page.getByTestId("layout-catalog-back").click();
    await page.getByTestId("workspace-nav-survey").click();
    await expect(page.getByRole("button", { name: "Capture Survey Point", exact: true })).toBeVisible();
  }
  async function expectSerial(method: "Bluetooth serial" | "COM / USB", baud: string) {
    await expect(page.getByRole("button", { name: method, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: "Baud rate", exact: true })).toHaveValue(baud);
    await expect(page.getByRole("textbox", { name: "Baud rate", exact: true })).not.toBeEditable();
    await expect(page.getByRole("button", { name: "Disconnect receiver", exact: true })).toBeEnabled();
  }
  async function expectNetwork(address: string, port: string, filter: string) {
    await expect(page.getByRole("button", { name: "Wi-Fi / network", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "UDP receive", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: "Local listening IP address", exact: true })).toHaveValue(address);
    await expect(page.getByRole("textbox", { name: "Network port", exact: true })).toHaveValue(port);
    await expect(page.getByRole("textbox", { name: "Source IP filter (optional)", exact: true })).toHaveValue(filter);
  }
  await page.getByRole("button", { name: "Bluetooth serial", exact: true }).click();
  await page.getByRole("textbox", { name: "Baud rate", exact: true }).fill("57600");
  await connectOperationalReceiver(page);
  await emitGga(page, gga());
  await expect(readiness).toHaveText("Ready to collect");
  await expectSerial("Bluetooth serial", "57600");
  await toLayout();
  await expectSerial("Bluetooth serial", "57600");
  await expect(readiness).toHaveText("Ready to collect");
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.requestCount)).toBe(1);
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(1);
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect receiver", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Wi-Fi / network", exact: true }).click();
  await page.getByRole("button", { name: "UDP receive", exact: true }).click();
  await page.getByRole("textbox", { name: "Local listening IP address", exact: true }).fill("192.168.");
  await page.getByRole("textbox", { name: "Network port", exact: true }).fill("21x");
  await page.getByRole("textbox", { name: "Source IP filter (optional)", exact: true }).fill("10.1.");
  await page.getByRole("button", { name: "Connect receiver", exact: true }).click();
  await expect(status).toContainText(/port|address|invalid/i);
  const error = await status.innerText();
  await expect(page.getByTestId("layout-collect")).toBeDisabled();
  await toSurvey();
  await expectNetwork("192.168.", "21x", "10.1.");
  await expect(status).toHaveText(error);
  await expect(page.getByRole("button", { name: "Capture Survey Point", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(0);
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.requestCount)).toBe(1);
  // The previously mounted Survey panel edits the same latest form now used by Layout.
  await page.getByRole("textbox", { name: "Local listening IP address", exact: true }).fill("172.16.");
  await page.getByRole("textbox", { name: "Network port", exact: true }).fill("21500");
  await toLayout();
  await expectNetwork("172.16.", "21500", "10.1.");
  await expect(status).not.toHaveText(error);
  await toSurvey();
  await page.getByRole("button", { name: "COM / USB", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Baud rate", exact: true })).toHaveValue("57600");
  await page.getByRole("textbox", { name: "Baud rate", exact: true }).fill("38400");
  await connectOperationalReceiver(page, 2);
  await expect(readiness).not.toHaveText("Ready to collect");
  await emitGga(page, gga("120000.00", 4, "GPGGA"));
  await expect(readiness).toHaveText("Ready to collect");
  await toLayout();
  await expectSerial("COM / USB", "38400");
  await expect(readiness).toHaveText("Ready to collect");
  await toSurvey();
  await expectSerial("COM / USB", "38400");
  expect(await page.evaluate(() => (window as Window & { recordedReceiverBauds: number[] }).recordedReceiverBauds)).toEqual([57600, 38400]);
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.requestCount)).toBe(2);
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect receiver", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(0);
  expect(await session(page, initial.id)).toEqual(initial);
  expect(await readWorkspace(page)).toEqual(baseline);
});


function insideSampleField(point: { x: number; y: number }): boolean {
  const ring = sampleProject.fieldBoundary;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
async function unobstructedFieldPoint(map: Locator): Promise<{ x: number; y: number }> {
  let previous: string | null = null;
  await expect.poll(async () => {
    const camera = await map.getAttribute("data-map-camera");
    const stable = camera !== null && camera === previous;
    previous = camera;
    return stable;
  }, { intervals: [150], message: "Map camera must settle before selecting an in-field click" }).toBe(true);
  const [longitude, latitude, zoom, bearing, pitch] = JSON.parse(previous!) as number[];
  expect(bearing).toBeCloseTo(0, 8); expect(pitch).toBeCloseTo(0, 8);
  const frame = (await map.boundingBox())!;
  const mercatorY = (degrees: number) => (1 - Math.asinh(Math.tan(degrees * Math.PI / 180)) / Math.PI) / 2;
  const worldSize = 512 * 2 ** zoom;
  const candidates = [sampleProject.pivotCenter];
  for (const radius of [60, 120, 180, 240]) for (let angle = 0; angle < 360; angle += 30) {
    const point = { x: sampleProject.pivotCenter.x + radius * Math.cos(angle * Math.PI / 180),
      y: sampleProject.pivotCenter.y + radius * Math.sin(angle * Math.PI / 180) };
    if (insideSampleField(point)) candidates.push(point);
  }
  const positions = candidates.map(point => {
    const target = projectXyToLonLat(point, sampleProject.projectCrs);
    return { x: frame.width / 2 + (target.longitude - longitude) / 360 * worldSize,
      y: frame.height / 2 + (mercatorY(target.latitude) - mercatorY(latitude)) * worldSize };
  });
  const position = await map.evaluate((element, options) => {
    const bounds = element.getBoundingClientRect();
    const canvas = element.querySelector("canvas.maplibregl-canvas");
    return options.find(point => point.x > 12 && point.y > 12 && point.x < bounds.width - 12 && point.y < bounds.height - 12
      && document.elementFromPoint(bounds.x + point.x, bounds.y + point.y) === canvas) ?? null;
  }, positions);
  expect(position, `At least one point inside the field must be reachable on the map canvas without an overlay (camera ${previous})`).not.toBeNull();
  return position!;
}
