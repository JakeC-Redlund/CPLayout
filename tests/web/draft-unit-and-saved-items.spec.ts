import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { newDesignDraft } from "../../apps/mobile/src/newDesignDraft";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { createWebWorkspaceStore } from "../../packages/project-store/src/webWorkspaceStore";
import { readWorkspace, workspaceKey } from "./workspace-fixtures";

const now = "2026-09-26T00:00:00.000Z";

function fixture(unitSystem: string, savedItems: boolean) {
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "client",
    input: { companyName: "Unit test farm", primaryContactFirstName: "Test", primaryContactLastName: "Operator" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now,
    input: { clientId: "client", projectId: "folder", projectName: "Stored folder", projectCrs: "",
      unitSystem, fieldMapId: "field" } }).workspace;
  if (!savedItems) return workspace;
  const draft = newDesignDraft("payload", "Saved items", "metric");
  draft.projectCrs = "LOCAL:field";
  draft.mapFeatures = [{ id: "saved-line", name: "Saved line", kind: "measurement_line", confidence: "user_estimated",
    geometry: { type: "LineString", vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }] } }];
  draft.obstacles = [{ id: "keep-out", name: "Keep out", kind: "exclusion", confidence: "user_estimated",
    bufferMeters: 0, hardConflict: true, noSpray: true,
    polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }] }];
  return applyWorkspaceCommand(workspace, { type: "create_design_draft", now, designId: "saved-design", fieldMapId: "field",
    name: "Saved items", draft }).workspace;
}

async function seed(context: BrowserContext, unitSystem: string, savedItems = false): Promise<void> {
  const values = new Map<string, string>();
  const store = createWebWorkspaceStore({
    getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, action) => action() }),
  });
  await store.initializeAsync();
  values.set(workspaceKey, serializeWorkspaceDocument(fixture(unitSystem, savedItems)));
  await context.addInitScript(({ key, entries }) => {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    if (localStorage.getItem(key) === null) for (const [name, value] of entries) localStorage.setItem(name, value);
  }, { key: workspaceKey, entries: [...values] });
}

async function openSavedDraft(page: Page): Promise<void> {
  await page.goto("/");
  const resume = await page.evaluate(() => JSON.parse(localStorage.getItem("cplayout-desktop-context-v1") ?? "null"));
  if (!resume?.editorOpen || resume?.context?.designId !== "saved-design") {
    await page.getByTestId("task-projects").click();
    await expect(page.getByTestId("dashboard-workspace")).toBeVisible();
    if (page.viewportSize()!.width < 760) {
      const drawer = page.getByRole("button", { name: "Open project drawer", exact: true });
      await expect(drawer).toBeVisible();
      await expect(drawer).toBeEnabled();
      if (test.info().project.use.hasTouch) await drawer.tap(); else await drawer.click();
      await expect(page.getByTestId("project-tree-rail")).toBeVisible();
    }
    const command = page.getByTestId("catalog-design-saved-design-open");
    await expect(command).toBeVisible();
    await expect(command).toBeEnabled();
    if (test.info().project.use.hasTouch) await command.tap(); else await command.click();
  }
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
  await expect(page.getByTestId("draft-name")).toHaveValue("Saved items");
  if (page.viewportSize()!.width < 800) {
    await expect(page.getByTestId("design-draft-inputs")).toBeHidden();
    await page.getByTestId("draft-inputs-toggle").click();
  }
  await expect(page.getByTestId("design-draft-inputs")).toBeVisible();
}

async function createFromField(page: Page): Promise<void> {
  await page.goto("/");
  const drawer = page.getByRole("button", { name: "Open project drawer" });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByTestId("catalog-field-map-field").click();
  if (await drawer.isVisible()) await drawer.click();
  await page.getByTestId("project-tree-action-more").click();
  await page.getByTestId("project-tree-action-design").click();
  await page.getByLabel("Catalog item name").fill("Metric draft");
  await page.getByTestId("catalog-dialog-create").click();
}

test("new design starts with the selected folder's stored units", async ({ page, context }) => {
  await seed(context, "metric");
  await createFromField(page);
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
  const created = await readWorkspace(page);
  expect(created.draftDocuments).toHaveLength(1);
  const draft = JSON.parse(created.draftDocuments[0].document).draft;
  expect(draft.unitSystem).toBe("metric");
  expect(draft.settings.unitSystem).toBe("metric");
  expect(created.catalog.projects[0].unitSystem).toBe("metric");
  expect(created.projectDocuments).toEqual([]);
});

test("invalid folder units cannot silently inherit the open editor's units", async ({ page, context }) => {
  await seed(context, "invalid-units");
  await createFromField(page);
  await expect(page.getByText(/selected project has no valid unit system/i)).toBeVisible();
  await expect(page.getByTestId("design-draft-workspace")).toHaveCount(0);
  expect((await readWorkspace(page)).draftDocuments).toEqual([]);
});

test("saved features and keep-outs can be deleted, undone, saved, and reopened", async ({ page, context }) => {
  await seed(context, "metric", true);
  await openSavedDraft(page);
  await expect(page.getByTestId("draft-saved-feature-saved-line")).toBeVisible();
  await expect(page.getByTestId("draft-saved-obstacle-keep-out")).toBeVisible();
  await page.getByTestId("draft-delete-feature-saved-line").click();
  await expect(page.getByTestId("draft-saved-feature-saved-line")).toHaveCount(0);
  await page.getByTestId("draft-undo").click();
  await expect(page.getByTestId("draft-saved-feature-saved-line")).toBeVisible();
  await page.getByTestId("draft-delete-obstacle-keep-out").click();
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  const saved = await readWorkspace(page);
  const draft = JSON.parse(saved.draftDocuments[0].document).draft;
  expect(draft.mapFeatures.map((feature: { id: string }) => feature.id)).toEqual(["saved-line"]);
  expect(draft.obstacles).toEqual([]);
  await page.getByTestId("draft-catalog").click();
  await openSavedDraft(page);
  await expect(page.getByTestId("draft-saved-feature-saved-line")).toBeVisible();
  await expect(page.getByTestId("draft-saved-obstacle-keep-out")).toHaveCount(0);
  expect(await readWorkspace(page)).toEqual(saved);
});
