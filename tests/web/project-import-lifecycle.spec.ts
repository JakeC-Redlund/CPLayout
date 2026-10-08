import { expect, test, type FileChooser, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { sampleProject } from "../../packages/core/src/index";
import { buildProjectRecoveryArchiveBundle, exportProjectArchiveZip } from "../../packages/project-store/src/projectArchive";
import { readWorkspace, workspaceKey, workspaceStorageBytes } from "./workspace-fixtures";

type FileReadWindow = Window & { completedCplayoutFileReads?: number };

test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer = function (blob) {
      this.addEventListener("loadend", () => {
        // Observe completion after the import promise continuations have run.
        setTimeout(() => {
          const target = window as FileReadWindow;
          target.completedCplayoutFileReads = (target.completedCplayoutFileReads ?? 0) + 1;
        }, 0);
      }, { once: true });
      read.call(this, blob);
    };
  });
});

async function selectFile(page: Page, chooser: FileChooser, file: Parameters<FileChooser["setFiles"]>[0]) {
  const completed = () => page.evaluate(() => (window as FileReadWindow).completedCplayoutFileReads ?? 0);
  const before = await completed();
  await chooser.setFiles(file);
  await expect.poll(completed).toBe(before + 1);
}

function fixture(id: string, projectCrs = "EPSG:26741") {
  const project = { ...sampleProject, id, name: id, projectCrs };
  return { name: `${id}.zip`, mimeType: "application/zip", buffer: Buffer.from(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(project))) };
}

async function files(page: Page) {
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("files-action-import-zip")).toBeVisible();
}

async function picker(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("files-action-import-zip").click();
  return chooser;
}

async function expectMapBreadcrumb(page: Page, label: string) {
  const { width, height } = page.viewportSize()!;
  const compactContext = width < 760 || (width > height && height < 500);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toHaveText(compactContext ? label : `CPLayout / ${label}`);
  if (compactContext) await expect(page.getByTestId("design-context-open")).toBeVisible();
  else await expect(page.getByTestId("design-context-open")).toHaveCount(0);
}

for (const malformed of [false, true]) {
  test(`late ${malformed ? "malformed" : "valid"} ZIP after catalog navigation cannot load or persist`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await files(page);
    const before = await workspaceStorageBytes(page);
    const chooser = await picker(page);
    await page.getByTestId("command-menu-file").click();
    await page.getByTestId("command-file-catalog").click();
    await expectMapBreadcrumb(page, "Project Catalog");
    await selectFile(page, chooser, malformed
      ? { name: "malformed.zip", mimeType: "application/zip", buffer: Buffer.from("not a ZIP") }
      : fixture("stale-catalog-import"));
    await expectMapBreadcrumb(page, "Project Catalog");
    await expect(page.getByTestId("crs-recovery-panel")).toHaveCount(0);
    expect(await workspaceStorageBytes(page)).toEqual(before);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`late-${malformed ? "malformed" : "valid"}-zip-cancelled.png`) });
  });
}

test("leaving Files for Dashboard cancels a pending project import", async ({ page }) => {
  await files(page);
  const before = await workspaceStorageBytes(page);
  const chooser = await picker(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("files-action-import-zip")).toHaveCount(0);
  await selectFile(page, chooser, fixture("stale-dashboard-import"));
  await expect(page.getByTestId("workspace-breadcrumb-current")).toHaveText("CPLayout / North Quarter Concept Layout");
  await expect(page.getByTestId("crs-recovery-panel")).toHaveCount(0);
  expect(await workspaceStorageBytes(page)).toEqual(before);
});

test("newer project picker wins and stale completion cannot persist another project", async ({ page }) => {
  await files(page);
  const first = await picker(page);
  const second = await picker(page);
  await selectFile(page, second, fixture("latest-picker-import"));
  await expect(page.getByTestId("crs-recovery-project-name")).toHaveText("latest-picker-import");
  await expect.poll(() => readWorkspace(page).then(workspace => workspace.projectDocuments.some(entry => entry.summary.id === "latest-picker-import"))).toBe(true);
  const beforeStaleCompletion = await workspaceStorageBytes(page);
  await selectFile(page, first, fixture("obsolete-picker-import"));
  await expect(page.getByTestId("crs-recovery-project-name")).toHaveText("latest-picker-import");
  expect(await readWorkspace(page).then(workspace => workspace.projectDocuments.some(entry => entry.summary.id === "obsolete-picker-import"))).toBe(false);
  expect(await workspaceStorageBytes(page)).toEqual(beforeStaleCompletion);
});

for (const crs of ["EPSG:32613", "EPSG:26741"]) {
  test(`accepted ${crs} import acknowledges persistence outside Files`, async ({ page }, testInfo) => {
    await files(page);
    await selectFile(page, await picker(page), fixture("saved-import", crs));
    await expect(page.getByTestId("project-import-status")).toHaveText("Imported project saved locally.");
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    expect(await readWorkspace(page).then(workspace => workspace.projectDocuments.some(entry => entry.summary.id === "saved-import"))).toBe(true);
    const imported = await readWorkspace(page);
    const originalKeys = (await workspaceStorageBytes(page)).slice(1);
    expect(imported.catalog).toEqual({ clients: [], projects: [], fieldMaps: [], designs: [] });
    await page.getByTestId(crs === "EPSG:26741" ? "crs-recovery-save" : "command-icon-save").click();
    await expect.poll(async () => (await readWorkspace(page)).revision).toBe(imported.revision + 1);
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    expect((await readWorkspace(page)).projectDocuments.map(entry => entry.document)).toEqual(imported.projectDocuments.map(entry => entry.document));
    expect((await workspaceStorageBytes(page)).slice(1)).toEqual(originalKeys);
    await page.screenshot({ path: testInfo.outputPath(`import-saved-${crs.replace(":", "-")}.png`) });
  });

  test(`accepted ${crs} import shows save failure and can retry`, async ({ page }, testInfo) => {
    await files(page);
    const before = await workspaceStorageBytes(page);
    expect((await readWorkspace(page)).projectDocuments).toEqual([]);
    await page.evaluate((key) => {
      const set = Storage.prototype.setItem;
      (window as Window & { allowProjectWrites?: () => void }).allowProjectWrites = () => { Storage.prototype.setItem = set; };
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new DOMException("Storage full in test", "QuotaExceededError");
        set.call(this, name, value);
      };
    }, workspaceKey);
    await selectFile(page, await picker(page), fixture("unsaved-import", crs));
    await expect(page.getByTestId("project-import-status")).toContainText("was not saved locally");
    await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
    expect(await workspaceStorageBytes(page)).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath(`import-save-failed-${crs.replace(":", "-")}.png`) });
    await page.evaluate(() => (window as Window & { allowProjectWrites?: () => void }).allowProjectWrites!());
    await page.getByTestId(crs === "EPSG:26741" ? "crs-recovery-save" : "command-icon-save").click();
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    await expect(page.getByTestId("project-import-status")).toHaveText("Imported project saved locally.");
    expect(await readWorkspace(page).then(workspace => workspace.projectDocuments.some(entry => entry.summary.id === "unsaved-import"))).toBe(true);
  });
}

test("current malformed ZIP leaves a visible Files error without loading or saving", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await files(page);
  const before = await workspaceStorageBytes(page);
  expect((await readWorkspace(page)).projectDocuments).toEqual([]);
  await selectFile(page, await picker(page), { name: "malformed.zip", mimeType: "application/zip", buffer: Buffer.from("not a ZIP") });
  await expect(page.getByTestId("files-status")).toContainText("invalid zip data");
  await expect(page.getByTestId("files-status")).not.toContainText("Project ZIP is the canonical project package.");
  await expect(page.getByTestId("workspace-breadcrumb-current")).toHaveText("CPLayout / North Quarter Concept Layout");
  expect(await workspaceStorageBytes(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("corrupt project coordinates fail CRC without replacing saved data and a valid retry succeeds", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await files(page);
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const storedData = () => workspaceStorageBytes(page);
  const before = await storedData();
  const project = { ...structuredClone(sampleProject), id: "crc-recovery-import", name: "CRC recovery import", projectCrs: "EPSG:26741" };
  project.fieldBoundary[0].x = 123456;
  const archive = buildProjectRecoveryArchiveBundle(project);
  const validBytes = Buffer.from(zipSync(Object.fromEntries(Object.entries(archive.files).map(([name, contents]) => [name, strToU8(contents)])), { level: 0 }));
  const corruptBytes = Buffer.from(validBytes);
  const offset = corruptBytes.indexOf("123456");
  expect(offset).toBeGreaterThanOrEqual(0);
  corruptBytes[offset + 5] = "7".charCodeAt(0);
  await selectFile(page, await picker(page), { name: "corrupt-coordinate.zip", mimeType: "application/zip", buffer: corruptBytes });
  await expect(page.getByTestId("files-status")).toContainText("CRC-32 mismatch: project.json");
  await expect(page.getByTestId("workspace-breadcrumb-current")).toHaveText("CPLayout / North Quarter Concept Layout");
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  expect(await storedData()).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath("corrupt-coordinate-rejected.png") });
  await selectFile(page, await picker(page), { name: "valid-coordinate.zip", mimeType: "application/zip", buffer: validBytes });
  await expect(page.getByTestId("crs-recovery-project-name")).toHaveText(project.name);
  await expect(page.getByTestId("project-import-status")).toHaveText("Imported project saved locally.");
  const stored = (await readWorkspace(page)).projectDocuments.find(entry => entry.summary.id === "crc-recovery-import")!.document;
  expect(JSON.parse(stored).project.fieldBoundary[0].x).toBe(123456);
  expect(errors).toEqual([]);
});

test("opening a saved project supersedes the old Files picker", async ({ page }) => {
  await files(page);
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const before = await workspaceStorageBytes(page);
  const chooser = await picker(page);
  await page.getByLabel("Open North Quarter Concept Layout", { exact: true }).click();
  await expect(page.getByTestId("files-action-import-zip")).toHaveCount(0);
  await selectFile(page, chooser, fixture("superseded-import"));
  await expectMapBreadcrumb(page, "North Quarter Concept Layout");
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  expect(await workspaceStorageBytes(page)).toEqual(before);
});

test("editing project data while Files remains mounted cancels its old picker", async ({ page }) => {
  await files(page);
  const chooser = await picker(page);
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nimport-lifecycle-point,New point,control,501010,4506010,imported,rtk_fixed\n");
  await page.getByTestId("files-action-import-csv").click();
  await expect(page.getByTestId("files-status")).toContainText("Imported 1 survey");
  await selectFile(page, chooser, fixture("pre-edit-import"));
  await expect(page.getByTestId("files-action-import-zip")).toBeVisible();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toHaveText("CPLayout / North Quarter Concept Layout");
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const documents = (await readWorkspace(page)).projectDocuments.map(entry => entry.document);
  expect(documents).toHaveLength(1);
  expect(documents[0]).toContain("import-lifecycle-point");
  expect(documents[0]).not.toContain("pre-edit-import");
});
