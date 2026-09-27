import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { newDesignDraft } from "../../apps/mobile/src/newDesignDraft";
import { sampleProject } from "../../packages/core/src";
import { importDesignDraftArchiveZip } from "../../packages/project-store/src/designDraftArchive";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { createWebWorkspaceStore } from "../../packages/project-store/src/webWorkspaceStore";
import { readWorkspace, workspaceKey } from "./workspace-fixtures";

const now = "2026-09-26T00:00:00.000Z";
test.use({ actionTimeout: 15_000 });
const browserErrors = new WeakMap<Page, string[]>();
function fixture() {
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "draft-client",
    input: { companyName: "Draft Farm", primaryContactFirstName: "Test", primaryContactLastName: "Operator" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now,
    input: { clientId: "draft-client", projectId: "draft-folder", projectName: "Draft field", projectCrs: "", unitSystem: "metric", fieldMapId: "draft-field" } }).workspace;
  return applyWorkspaceCommand(workspace, { type: "create_design_draft", now, designId: "draft-design", fieldMapId: "draft-field",
    name: "New irrigation design", draft: newDesignDraft("draft-payload", "New irrigation design", "metric") }).workspace;
}

async function seed(context: BrowserContext) {
  const values = new Map<string, string>();
  const store = createWebWorkspaceStore({
    getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, action) => action() }),
  });
  await store.initializeAsync();
  values.set(workspaceKey, serializeWorkspaceDocument(fixture()));
  await context.addInitScript(({ key, entries }) => {
    if (localStorage.getItem(key) === null) for (const [name, value] of entries) localStorage.setItem(name, value);
  }, { key: workspaceKey, entries: [...values] });
}

async function openDrawer(page: Page) {
  const drawer = page.getByRole("button", { name: "Open project drawer" });
  if (await drawer.isVisible()) await drawer.click();
}

async function open(page: Page) {
  await page.goto("/");
  await openDrawer(page);
  const command = page.getByTestId("catalog-design-draft-design-open");
  if (test.info().project.use.hasTouch) await command.tap();
  else await command.click();
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
}

async function inputs(page: Page) {
  if (!await page.getByTestId("design-draft-inputs").isVisible()) await page.getByTestId("draft-inputs-toggle").click();
}

async function setCrs(page: Page) {
  await inputs(page);
  await page.getByTestId("draft-crs").fill("LOCAL:METERS");
  await page.getByRole("button", { name: "Apply CRS", exact: true }).click();
}

async function boundary(page: Page, csv: string) {
  await inputs(page);
  await page.getByTestId("draft-boundary-csv").fill(csv);
  await page.getByRole("button", { name: "Apply boundary", exact: true }).click();
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
  await seed(context);
});

test.afterEach(async ({ page }) => { expect(browserErrors.get(page) ?? []).toEqual([]); });

test("catalog Open supports Enter and Space without changing stored geometry", async ({ page }) => {
  await page.goto("/");
  const before = await readWorkspace(page);
  for (const key of ["Enter", "Space"]) {
    const drawer = page.getByRole("button", { name: "Open project drawer" });
    if (await drawer.isVisible()) await drawer.click();
    const command = page.getByTestId("catalog-design-draft-design-open");
    await command.focus();
    await command.press(key);
    await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
    expect(await readWorkspace(page)).toEqual(before);
    await page.getByTestId("draft-catalog").click();
    await expect(page.getByTestId("design-draft-workspace")).toHaveCount(0);
  }
});

test("draft App opens missing data, saves two vertices, undoes and reopens without a sample project", async ({ page }, info) => {
  await open(page);
  await expect(page.getByTestId("draft-calculate")).toBeDisabled();
  await expect(page.getByTestId("draft-layout")).toBeDisabled();
  expect((await readWorkspace(page)).projectDocuments).toEqual([]);
  await setCrs(page);
  await boundary(page, "100,200\n300,400");
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  const saved = await readWorkspace(page);
  const draft = JSON.parse(saved.draftDocuments[0].document).draft;
  expect(draft.fieldBoundary).toEqual([{ x: 100, y: 200 }, { x: 300, y: 400 }]);
  expect([draft.pivotCenter, draft.waterSource, draft.powerSource]).toEqual([null, null, null]);
  expect(draft.machine).toEqual({});
  expect(saved.catalog.projects[0].projectCrs).toBe("");
  expect(saved.projectDocuments).toEqual([]);
  await page.getByTestId("draft-undo").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Unsaved");
  await page.getByTestId("draft-redo").click();
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  await page.getByTestId("draft-catalog").click();
  await open(page);
  await inputs(page);
  await expect(page.getByTestId("draft-boundary-csv")).toHaveValue("100,200\n300,400");
  await expect(page.getByTestId("draft-crs")).not.toBeEditable();
  await expect(page.getByTestId("draft-calculate")).toBeDisabled();
  await expect(page.getByTestId("draft-layout")).toBeDisabled();
  await page.screenshot({ path: info.outputPath("incomplete-draft-reopened.png") });
});

test("draft stale tab keeps its edits and cannot overwrite a newer save", async ({ page, context }) => {
  await open(page);
  const second = await context.newPage();
  await open(second);
  await setCrs(page);
  await boundary(page, "100,200");
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  const saved = await readWorkspace(page);
  await setCrs(second);
  await boundary(second, "500,600");
  await second.getByTestId("draft-save").click();
  await expect(second.getByTestId("draft-error")).toContainText("revision changed");
  await expect(second.getByTestId("draft-save-state")).toContainText("Unsaved");
  expect(await readWorkspace(second)).toEqual(saved);
  await second.getByTestId("draft-save").click();
  await expect(second.getByTestId("draft-error")).toContainText("revision changed");
  expect(await readWorkspace(second)).toEqual(saved);
  await second.close();
});

test("pending invalid inputs block save and leaving requires an explicit discard", async ({ page }, info) => {
  await open(page);
  await inputs(page);
  await page.getByTestId("draft-crs").fill("EPSG:4326");
  await expect(page.getByTestId("draft-save")).toBeDisabled();
  await page.getByRole("button", { name: "Apply CRS", exact: true }).click();
  await expect(page.getByTestId("draft-error")).toBeVisible();
  await expect(page.getByTestId("draft-crs")).toHaveValue("EPSG:4326");
  const map = (await page.getByTestId("design-draft-map").boundingBox())!;
  const form = (await page.getByTestId("draft-inputs-scroll").boundingBox())!;
  const status = (await page.getByText("Field qualification: not verified", { exact: true }).locator("..").boundingBox())!;
  expect(map.y + map.height).toBeLessThanOrEqual(status.y + 1);
  expect(form.y + form.height).toBeLessThanOrEqual(status.y + 1);
  if (page.viewportSize()!.width < 800) expect(map.y + map.height).toBeLessThanOrEqual(form.y + 1);
  const camera = (await page.getByTestId("design-draft-camera-controls").boundingBox())!;
  const captureStatus = (await page.getByTestId("design-draft-capture-status").boundingBox())!;
  expect(captureStatus.x + captureStatus.width).toBeLessThanOrEqual(camera.x);
  await page.screenshot({ path: info.outputPath("invalid-draft-inputs.png") });
  await page.getByTestId("draft-catalog").click();
  await expect(page.getByTestId("draft-discard")).toBeVisible();
  await page.getByTestId("draft-discard-cancel").click();
  await expect(page.getByTestId("draft-crs")).toHaveValue("EPSG:4326");
  await page.getByTestId("draft-inputs-discard").click();
  await expect(page.getByTestId("draft-crs")).toHaveValue("");
  await expect(page.getByTestId("draft-save")).toBeEnabled();
  expect((await readWorkspace(page)).revision).toBe(3);
});

test("an in-flight draft save keeps its snapshot and leaves newer drawing inputs unsaved", async ({ page }) => {
  await open(page);
  await setCrs(page);
  await boundary(page, "100,200");
  await page.evaluate(async () => {
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => {
          (window as Window & { releaseDraftTestLock?: () => void }).releaseDraftTestLock = release;
          acquired();
        });
      });
    });
  });
  try {
    await page.getByTestId("draft-save").click();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending
      ?.some(lock => lock.name === "cplayout:workspace:writer:v1") ?? false)).toBe(true);
    await boundary(page, "100,200\n300,400");
  } finally {
    await page.evaluate(() => (window as Window & { releaseDraftTestLock?: () => void }).releaseDraftTestLock?.());
  }
  await expect(page.getByTestId("draft-save-state")).toContainText("Unsaved changes");
  const first = await readWorkspace(page);
  expect(JSON.parse(first.draftDocuments[0].document).draft.fieldBoundary).toEqual([{ x: 100, y: 200 }]);
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  const next = await readWorkspace(page);
  expect(next.revision).toBe(first.revision + 1);
  expect(JSON.parse(next.draftDocuments[0].document).draft.fieldBoundary).toEqual([{ x: 100, y: 200 }, { x: 300, y: 400 }]);
});

test("draft ZIP exports supplied incomplete geometry without complete-project outputs", async ({ page }) => {
  await open(page);
  await setCrs(page);
  await boundary(page, "10,20");
  const download = page.waitForEvent("download");
  await page.getByTestId("draft-export").click();
  const file = await download;
  const draft = importDesignDraftArchiveZip(await readFile((await file.path())!));
  expect(draft.fieldBoundary).toEqual([{ x: 10, y: 20 }]);
  expect(draft.pivotCenter).toBeNull();
  expect(draft.machine).toEqual({});
  expect((await readWorkspace(page)).revision).toBe(3);
});

test("calculations require complete supplied inputs and never promote a draft to Layout", async ({ page }) => {
  await page.goto("/");
  const complete = { ...structuredClone(sampleProject), id: "draft-payload", name: "Complete draft" };
  const workspace = applyWorkspaceCommand(fixture(), { type: "save_design_draft", now, designId: "draft-design",
    expectedDesignRevision: 0, draft: complete }).workspace;
  await page.evaluate(({ key, document }) => localStorage.setItem(key, document),
    { key: workspaceKey, document: serializeWorkspaceDocument(workspace) });
  await open(page);
  await expect(page.getByTestId("draft-calculate")).toBeEnabled();
  await page.getByTestId("draft-calculate").click();
  await expect(page.getByTestId("draft-calculation-result")).toContainText("Coverage:");
  await expect(page.getByTestId("draft-layout")).toBeDisabled();
  await boundary(page, "100,200");
  await expect(page.getByTestId("draft-calculate")).toBeDisabled();
  await expect(page.getByTestId("draft-calculation-result")).toHaveCount(0);
  expect((await readWorkspace(page)).projectDocuments).toEqual([]);
});

test("opening a draft cannot silently discard a complete project's unsaved edits", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nretained,Retained,note,501050,4506050,imported,rtk_float\n");
  await page.getByTestId("files-action-import-csv").click();
  const drawer = page.getByRole("button", { name: "Open project drawer" });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByTestId("catalog-design-draft-design").click();
  await openDrawer(page);
  if (test.info().project.name === "desktop") await page.getByTestId("catalog-design-draft-design").dblclick();
  else await page.getByTestId("catalog-design-draft-design-open").click();
  await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
  await expect(page.getByTestId("design-draft-workspace")).toHaveCount(0);
  await page.getByTestId("project-to-draft-discard-cancel").click();
  const closeDrawer = page.getByRole("button", { name: /^(Close|Collapse) project drawer$/ });
  if (await closeDrawer.isVisible()) await closeDrawer.click();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-action-save-local").click();
  await expect.poll(async () => (await readWorkspace(page)).projectDocuments.length).toBe(1);
  const workspace = await readWorkspace(page);
  expect(JSON.parse(workspace.projectDocuments[0].document).project.surveyPoints.some((point: { id: string }) => point.id === "retained")).toBe(true);
  if (await drawer.isVisible()) await drawer.click();
  await page.getByTestId("catalog-design-draft-design-open").click();
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
  await expect(page.getByTestId("project-to-draft-discard")).toBeHidden();
});

test("canceling new draft creation preserves a saved project's revision and subsequent save", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const before = await readWorkspace(page);
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nretained-create,Retained,note,501050,4506050,imported,rtk_float\n");
  await page.getByTestId("files-action-import-csv").click();
  const drawer = page.getByRole("button", { name: "Open project drawer" });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByTestId("catalog-design-draft-design").click();
  await openDrawer(page);
  await page.getByTestId("project-tree-action-more").click();
  await page.getByTestId("project-tree-action-design").click();
  await page.getByLabel("Catalog item name").fill("Canceled draft");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("project-to-draft-discard-cancel").click();
  const closeDrawer = page.getByRole("button", { name: /^(Close|Collapse) project drawer$/ });
  if (await closeDrawer.isVisible()) await closeDrawer.click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const after = await readWorkspace(page);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.draftDocuments).toEqual(before.draftDocuments);
  expect(JSON.parse(after.projectDocuments[0].document).project.surveyPoints).toContainEqual(expect.objectContaining({ id: "retained-create" }));
});

test("failed confirmed draft creation restores its name and leaves storage unchanged for retry", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await openDrawer(page);
  await page.getByTestId("catalog-design-draft-design").click();
  await openDrawer(page);
  await page.getByTestId("project-tree-action-more").click();
  await page.getByTestId("project-tree-action-design").click();
  await page.getByLabel("Catalog item name").fill("Retry retained draft");
  const before = await readWorkspace(page);
  await page.evaluate(key => {
    const set = Storage.prototype.setItem;
    (window as Window & { restoreDraftStorage?: () => void }).restoreDraftStorage = () => { Storage.prototype.setItem = set; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Synthetic draft quota failure", "QuotaExceededError");
      set.call(this, name, value);
    };
  }, workspaceKey);
  try {
    await page.getByTestId("catalog-dialog-create").click();
    await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
    await expect(page.getByTestId("catalog-dialog")).toHaveCount(0);
    await page.getByTestId("project-to-draft-discard-confirm").click();
    await expect(page.getByTestId("catalog-dialog")).toBeVisible();
    await expect(page.getByLabel("Catalog item name")).toHaveValue("Retry retained draft");
    await expect(page.getByTestId("workspace-storage-error")).toContainText("quota");
    expect(await readWorkspace(page)).toEqual(before);
  } finally {
    await page.evaluate(() => (window as Window & { restoreDraftStorage?: () => void }).restoreDraftStorage?.());
  }
  await page.getByTestId("catalog-dialog-create").click();
  await page.getByTestId("project-to-draft-discard-confirm").click();
  await expect(page.getByTestId("design-draft-workspace")).toContainText("Retry retained draft");
  expect((await readWorkspace(page)).draftDocuments).toHaveLength(2);
});

test("Undo during desktop draft creation retains the edited project and its next save", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "This race uses the desktop inline form; compact forms are modal.");
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nundo-create,Undo,note,501050,4506050,imported,rtk_float\n");
  await page.getByTestId("files-action-import-csv").click();
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const before = await readWorkspace(page);
  await page.getByTestId("catalog-design-draft-design").click();
  await page.getByTestId("project-tree-action-more").click();
  await page.getByTestId("project-tree-action-design").click();
  await page.getByLabel("Catalog item name").fill("Saved sibling draft");
  await page.evaluate(async () => {
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => {
          (window as Window & { releaseDraftTestLock?: () => void }).releaseDraftTestLock = release;
          acquired();
        });
      });
    });
  });
  try {
    await page.getByTestId("catalog-dialog-create").click();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending
      ?.some(lock => lock.name === "cplayout:workspace:writer:v1") ?? false)).toBe(true);
    await page.getByTestId("command-icon-undo").click();
  } finally {
    await page.evaluate(() => (window as Window & { releaseDraftTestLock?: () => void }).releaseDraftTestLock?.());
  }
  await expect.poll(async () => (await readWorkspace(page)).draftDocuments.length).toBe(2);
  await expect(page.getByTestId("design-draft-workspace")).toHaveCount(0);
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  expect((await readWorkspace(page)).projectDocuments).toEqual(before.projectDocuments);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const after = await readWorkspace(page);
  expect(after.revision).toBe(before.revision + 2);
  expect(after.draftDocuments).toHaveLength(2);
  expect(JSON.parse(after.projectDocuments[0].document).project.surveyPoints).not.toContainEqual(expect.objectContaining({ id: "undo-create" }));
});

test("late desktop draft creation failures cannot report on a newer editor", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "Navigation during a pending inline form is desktop-specific.");
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("catalog-design-draft-design").click();
  await page.getByTestId("project-tree-action-more").click();
  await page.getByTestId("project-tree-action-design").click();
  await page.getByLabel("Catalog item name").fill("Abandoned failing draft");
  const before = await readWorkspace(page);
  await page.evaluate(async key => {
    const set = Storage.prototype.setItem;
    const state = window as Window & { failedDraftWrites?: number };
    state.failedDraftWrites = 0;
    (window as Window & { restoreDraftStorage?: () => void }).restoreDraftStorage = () => { Storage.prototype.setItem = set; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) {
        state.failedDraftWrites! += 1;
        throw new DOMException("Synthetic late draft failure", "QuotaExceededError");
      }
      set.call(this, name, value);
    };
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => {
          (window as Window & { releaseDraftTestLock?: () => void }).releaseDraftTestLock = release;
          acquired();
        });
      });
    });
  }, workspaceKey);
  try {
    await page.getByTestId("catalog-dialog-create").click();
    await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
    await expect(page.getByTestId("catalog-dialog")).toHaveCount(0);
    await page.getByTestId("project-to-draft-discard-confirm").click();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending
      ?.some(lock => lock.name === "cplayout:workspace:writer:v1") ?? false)).toBe(true);
    await page.getByTestId("command-menu-file").click();
    await page.getByTestId("command-file-sample-baseline-needs-review").click();
  } finally {
    await page.evaluate(() => (window as Window & { releaseDraftTestLock?: () => void }).releaseDraftTestLock?.());
    await page.evaluate(() => navigator.locks.request("cplayout:workspace:writer:v1", () => undefined));
    await page.evaluate(() => (window as Window & { restoreDraftStorage?: () => void }).restoreDraftStorage?.());
  }
  expect(await page.evaluate(() => (window as Window & { failedDraftWrites?: number }).failedDraftWrites)).toBe(1);
  await expect(page.getByTestId("catalog-dialog")).toHaveCount(0);
  await expect(page.getByTestId("design-draft-workspace")).toHaveCount(0);
  await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  expect(await readWorkspace(page)).toEqual(before);
});

test("draft map captures polygons lines and points while camera changes preserve saved geometry", async ({ page }, info) => {
  await open(page);
  await setCrs(page);
  await page.getByTestId("draft-inputs-toggle").click();
  const map = page.getByTestId("design-draft-map-svg");
  for (const [tool, purpose, positions] of [
    ["polygon", "area", [[0.25, 0.38], [0.65, 0.38], [0.5, 0.65]]],
    ["line", "path", [[0.3, 0.45], [0.6, 0.55]]],
    ["point", "marker", [[0.4, 0.5]]],
  ] as const) {
    await page.getByTestId(`design-draft-${tool}`).click();
    await page.getByTestId(`design-draft-purpose-${purpose}`).click();
    const box = (await map.boundingBox())!;
    for (const [x, y] of positions) await map.click({ position: { x: box.width * x, y: box.height * y } });
    await expect(page.getByTestId("draft-save")).toBeDisabled();
    await page.getByTestId("design-draft-commit").click();
    await expect(page.getByTestId("draft-save")).toBeEnabled();
  }
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  const saved = await readWorkspace(page);
  const draft = JSON.parse(saved.draftDocuments[0].document).draft;
  expect(draft.mapFeatures.map((feature: { kind: string }) => feature.kind)).toEqual(["measurement_area", "access_lane", "end_gun_mark"]);
  expect(draft.fieldBoundary).toEqual([]);
  await page.getByTestId("design-draft-zoom-in").click();
  await page.getByTestId("design-draft-fit-design").click();
  await page.getByTestId("design-draft-fit-design").hover();
  const tooltip = page.getByText("Fit design", { exact: true }).locator("..");
  await expect(tooltip).toBeVisible();
  const tooltipBox = (await tooltip.boundingBox())!;
  const cameraBox = (await page.getByTestId("design-draft-camera-controls").boundingBox())!;
  expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(cameraBox.x);
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  expect(await readWorkspace(page)).toEqual(saved);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("draft-polygon-line-point.png") });
});

test("a newer create form supersedes an older draft open waiting for storage", async ({ page }) => {
  await page.goto("/");
  await openDrawer(page);
  await page.getByTestId("catalog-design-draft-design").click();
  await openDrawer(page);
  await page.evaluate(async () => {
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => {
          (window as Window & { releaseDraftTestLock?: () => void }).releaseDraftTestLock = release;
          acquired();
        });
      });
    });
  });
  try {
    await page.getByTestId("catalog-design-draft-design-open").click();
    await page.getByTestId("project-tree-action-more").click();
    await page.getByTestId("project-tree-action-design").click();
    await page.getByLabel("Catalog item name").fill("Newer design request");
    await page.getByTestId("catalog-dialog-create").click();
    await expect(page.getByTestId("catalog-dialog-create")).toBeDisabled();
  } finally {
    await page.evaluate(() => (window as Window & { releaseDraftTestLock?: () => void }).releaseDraftTestLock?.());
  }
  await expect(page.getByTestId("design-draft-workspace")).toContainText("Newer design request");
  const workspace = await readWorkspace(page);
  expect(workspace.draftDocuments).toHaveLength(2);
  expect(JSON.parse(workspace.draftDocuments.find(item => item.id === "draft-payload")!.document).draft).toEqual(newDesignDraft("draft-payload", "New irrigation design", "metric"));
});
