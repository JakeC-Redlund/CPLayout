import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { sampleProject, serializeProjectDocument } from "../../packages/core/src";
import { emptyProjectCatalog, ensureCatalogEntryForProject } from "../../packages/project-store/src/projectCatalog";
import { buildProjectRecoveryArchiveBundle, exportProjectArchiveZip } from "../../packages/project-store/src/projectArchive";

const workspaceKey = "center-pivot-layout-workspace-v1";
const projectsKey = "center-pivot-layout-projects-v1";
const catalogKey = "center-pivot-layout-project-catalog-v1";
const project = { ...sampleProject, id: "workspace-activation", name: "Workspace Activation" };
const legacy = {
  projects: JSON.stringify({ [project.id]: { document: serializeProjectDocument(project), summary: {
    id: project.id, name: project.name, projectCrs: project.projectCrs, unitSystem: project.unitSystem, updatedAt: "2026-09-17T00:00:00Z",
  } } }),
  catalog: JSON.stringify(ensureCatalogEntryForProject(emptyProjectCatalog(), project)),
};

test.beforeEach(async ({ context, baseURL }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
});

async function ready(page: Page) {
  await page.goto("/");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key) !== null, workspaceKey)).toBe(true);
}
async function sampleFiles(page: Page) {
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-files").click();
}
async function openStored(page: Page) {
  await sampleFiles(page);
  await page.getByLabel(`Open ${project.name}`, { exact: true }).click();
  await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
  await page.getByTestId("project-to-draft-discard-confirm").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(project.name);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
}
async function editSurvey(page: Page, id: string) {
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill(`id,label,role,x,y,source,confidence\n${id},${id},note,501050,4506050,imported,rtk_float\n`);
  await page.getByTestId("files-action-import-csv").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
}
const raw = (page: Page) => page.evaluate(key => localStorage.getItem(key), workspaceKey);
async function seed(context: BrowserContext) {
  await context.addInitScript(({ projectsKey, catalogKey, workspaceKey, legacy }) => {
    if (localStorage.getItem(workspaceKey) === null && localStorage.getItem(projectsKey) === null) {
      localStorage.setItem(projectsKey, legacy.projects); localStorage.setItem(catalogKey, legacy.catalog);
    }
  }, { projectsKey, catalogKey, workspaceKey, legacy });
}

async function newClientForm(page: Page, company: string) {
  const drawer = page.getByRole("button", { name: "Open project drawer" });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByTestId("project-tree-action-more").click();
  await page.getByTestId("project-tree-action-client").click();
  await page.getByTestId("client-profile-company-input").fill(company);
  await page.getByTestId("client-profile-first-name-input").fill("Test");
  await page.getByTestId("client-profile-last-name-input").fill("Operator");
}

test("a catalog form keeps its original revision and typed values across a conflicting refresh", async ({ page, context }) => {
  await ready(page);
  await newClientForm(page, "Pending Farm");
  const second = await context.newPage();
  await ready(second);
  await newClientForm(second, "Committed Farm");
  await second.getByTestId("client-profile-save").click();
  await expect(second.getByTestId("client-profile-dialog")).toBeHidden();
  const committed = await raw(second);
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("workspace-storage-error")).toContainText("revision changed");
  await page.getByTestId("workspace-storage-retry").click();
  await expect(page.getByTestId("workspace-storage-error")).toContainText("revision changed");
  await expect(page.getByTestId("client-profile-company-input")).toHaveValue("Pending Farm");
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("workspace-storage-error")).toContainText("revision changed");
  expect(await raw(page)).toBe(committed);
  await second.close();
});

test("active repository preserves legacy inputs and rejects a stale save from another live tab", async ({ page, context }, testInfo) => {
  await seed(context);
  await ready(page);
  const second = await context.newPage();
  await ready(second);
  await openStored(page);
  await openStored(second);
  await editSurvey(page, "first-tab");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const saved = await raw(page);
  await editSurvey(second, "second-tab");
  await second.getByTestId("command-icon-save").click();
  await expect(second.getByTestId("workspace-storage-error")).toContainText("revision changed");
  await expect(second.getByTestId("project-save-state")).toContainText("Unsaved edits");
  expect(await raw(second)).toBe(saved);
  await second.getByTestId("workspace-storage-retry").click();
  await expect(second.getByTestId("workspace-storage-error")).toContainText("revision changed");
  await second.getByTestId("command-icon-save").click();
  await expect(second.getByTestId("workspace-storage-error")).toContainText("revision changed");
  expect(await raw(second)).toBe(saved);
  expect(await second.evaluate(({ projectsKey, catalogKey }) => [localStorage.getItem(projectsKey), localStorage.getItem(catalogKey)], { projectsKey, catalogKey }))
    .toEqual([legacy.projects, legacy.catalog]);
  await second.screenshot({ path: testInfo.outputPath("stale-editor-preserved.png") });
  await second.close();
});

test("corrupt migration data remains recoverable from catalog home without parsing it", async ({ page }, testInfo) => {
  const damaged = "\n{unparseable synthetic legacy data";
  await page.addInitScript(({ key, damaged }) => localStorage.setItem(key, damaged), { key: projectsKey, damaged });
  await page.goto("/");
  await expect(page.getByTestId("workspace-storage-error")).toContainText("Legacy workspace is invalid");
  const download = page.waitForEvent("download");
  await page.getByTestId("workspace-storage-recovery").click();
  const file = await download;
  const recovery = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(recovery.projectsRaw).toBe(damaged);
  expect(recovery.workspaceRaw).toBeNull();
  expect(recovery.backupRaw).toBeNull();
  expect(recovery.consistency).toBe("cooperative_lock");
  expect(await raw(page)).toBeNull();
  await page.getByTestId("workspace-storage-retry").click();
  await expect(page.getByTestId("workspace-storage-error")).toContainText("Legacy workspace is invalid");
  await page.screenshot({ path: testInfo.outputPath("opaque-workspace-recovery.png") });
});

test("missing Web Locks blocks persistence while keeping explicitly best-effort recovery available", async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }));
  await page.goto("/");
  await expect(page.getByTestId("workspace-storage-error")).toContainText("locking is unavailable");
  const download = page.waitForEvent("download");
  await page.getByTestId("workspace-storage-recovery").click();
  const recovery = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(recovery.consistency).toBe("unlocked_best_effort");
  await sampleFiles(page);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  expect(await raw(page)).toBeNull();
  await page.screenshot({ path: testInfo.outputPath("locking-unavailable.png") });
});

test("an imported project autosave and queued Save consume the same editor session receipts", async ({ page }) => {
  await ready(page);
  await sampleFiles(page);
  await page.evaluate(async () => {
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => {
          (window as Window & { releaseWorkspaceTestLock?: () => void }).releaseWorkspaceTestLock = release;
          acquired();
        });
      });
    });
  });
  try {
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("files-action-import-zip").click();
    await (await chooser).setFiles({ name: "queued.zip", mimeType: "application/zip", buffer: Buffer.from(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(project))) });
    await expect(page.getByTestId("project-import-status")).toContainText("saving locally");
    await page.getByTestId("command-icon-save").click();
  } finally {
    await page.evaluate(() => (window as Window & { releaseWorkspaceTestLock?: () => void }).releaseWorkspaceTestLock?.());
  }
  await expect.poll(async () => JSON.parse((await raw(page))!).revision).toBe(2);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
  const saved = JSON.parse((await raw(page))!);
  expect(saved.projectDocuments).toHaveLength(1);
  expect(saved.projectDocuments[0].summary.id).toBe(project.id);
  expect(saved.catalog.clients).toEqual([]);
});

test("create-only import collision cannot overwrite an existing stored identity", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await sampleFiles(page);
  const before = await raw(page);
  const collision = { ...project, name: "Conflicting imported name" };
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("files-action-import-zip").click();
  await (await chooser).setFiles({ name: "collision.zip", mimeType: "application/zip", buffer: Buffer.from(exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(collision))) });
  await expect(page.getByTestId("project-import-status")).toContainText("not saved");
  await expect(page.getByTestId("workspace-storage-error")).toBeVisible();
  expect(await raw(page)).toBe(before);
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
});

test("same-task edit then Save persists the authoritative editor instead of an older render", async ({ page, context }, testInfo) => {
  await seed(context);
  await ready(page);
  await openStored(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nsame-task-edit,Same task,note,501050,4506050,imported,rtk_float\n");
  await page.evaluate(() => {
    const edit = document.querySelector<HTMLElement>('[data-testid="files-action-import-csv"]');
    const save = document.querySelector<HTMLElement>('[data-testid="command-icon-save"]');
    if (!edit || !save) throw new Error("Missing edit/save controls");
    edit.click();
    save.click();
  });
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await expect.poll(async () => {
    const workspace = JSON.parse((await raw(page))!);
    return JSON.parse(workspace.projectDocuments.find((entry: { summary: { id: string } }) => entry.summary.id === project.id).document).project.surveyPoints;
  }).toContainEqual(expect.objectContaining({ id: "same-task-edit", projected: { x: 501050, y: 4506050 } }));
  await page.screenshot({ path: testInfo.outputPath("same-task-save.png") });
});

test("a delayed Save keeps later edits dirty and the next Save uses its acknowledged receipt", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await openStored(page);
  await editSurvey(page, "first-snapshot");
  await page.evaluate(async () => {
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => {
          (window as Window & { releaseWorkspaceTestLock?: () => void }).releaseWorkspaceTestLock = release;
          acquired();
        });
      });
    });
  });
  try {
    await page.getByTestId("command-icon-save").click();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending
      ?.filter(lock => lock.name === "cplayout:workspace:writer:v1").length ?? 0)).toBe(1);
    await editSurvey(page, "later-unsaved");
  } finally {
    await page.evaluate(() => (window as Window & { releaseWorkspaceTestLock?: () => void }).releaseWorkspaceTestLock?.());
  }
  const points = async () => {
    const workspace = JSON.parse((await raw(page))!);
    return JSON.parse(workspace.projectDocuments.find((entry: { summary: { id: string } }) => entry.summary.id === project.id).document).project.surveyPoints;
  };
  await expect.poll(points).toContainEqual(expect.objectContaining({ id: "first-snapshot" }));
  expect(await points()).not.toContainEqual(expect.objectContaining({ id: "later-unsaved" }));
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await expect.poll(points).toContainEqual(expect.objectContaining({ id: "later-unsaved" }));
  await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
});

test("a pending saved-project open cannot replace edits made while its read waits", async ({ page, context }) => {
  await seed(context);
  await ready(page);
  await sampleFiles(page);
  const title = await page.getByTestId("workspace-breadcrumb-current").innerText();
  const before = await raw(page);
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending
    ?.filter(lock => lock.name === "cplayout:workspace:writer:v1").length ?? 0)).toBe(0);
  await page.evaluate(async () => {
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => {
          (window as Window & { releaseWorkspaceTestLock?: () => void }).releaseWorkspaceTestLock = release;
          acquired();
        });
      });
    });
  });
  try {
    await page.getByLabel(`Open ${project.name}`, { exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).pending
      ?.filter(lock => lock.name === "cplayout:workspace:writer:v1").length ?? 0)).toBe(1);
    await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nedit-during-open,edit-during-open,note,501050,4506050,imported,rtk_float\n");
    await page.getByTestId("files-action-import-csv").click();
    await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  } finally {
    await page.evaluate(() => (window as Window & { releaseWorkspaceTestLock?: () => void }).releaseWorkspaceTestLock?.());
  }
  await page.evaluate(() => navigator.locks.request("cplayout:workspace:writer:v1", () => undefined));
  await expect(page.getByTestId("workspace-breadcrumb-current")).toHaveText(title);
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  expect(await raw(page)).toBe(before);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const entries = JSON.parse((await raw(page))!).projectDocuments;
  expect(JSON.parse(entries.find((entry: { summary: { id: string } }) => entry.summary.id === sampleProject.id).document).project.surveyPoints)
    .toContainEqual(expect.objectContaining({ id: "edit-during-open", projected: { x: 501050, y: 4506050 } }));
  expect(entries.find((entry: { summary: { id: string } }) => entry.summary.id === project.id).document)
    .toBe(JSON.parse(before!).projectDocuments[0].document);
});

test("editing a loaded legacy project cannot erase unsupported stored fields", async ({ page, context }) => {
  const entries = JSON.parse(legacy.projects);
  const document = JSON.parse(entries[project.id].document);
  document.project.machine.extension = { retain: "synthetic future metadata" };
  entries[project.id].document = JSON.stringify(document);
  await context.addInitScript(({ projectsKey, catalogKey, projects, catalog }) => {
    localStorage.setItem(projectsKey, projects);
    localStorage.setItem(catalogKey, catalog);
  }, { projectsKey, catalogKey, projects: JSON.stringify(entries), catalog: legacy.catalog });
  await ready(page);
  await openStored(page);
  const before = await raw(page);
  await editSurvey(page, "extension-safe-edit");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("workspace-storage-error")).toContainText("Stored project contains unsupported fields");
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  expect(await raw(page)).toBe(before);
  const download = page.waitForEvent("download");
  await page.getByTestId("workspace-storage-recovery").click();
  const recovery = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(recovery.workspaceRaw).toBe(before);
});

test("a failed client write keeps the form and typed values available for retry", async ({ page }, testInfo) => {
  await ready(page);
  await newClientForm(page, "Retained Synthetic Farm");
  const before = await raw(page);
  await page.evaluate(key => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      setItem.call(this, name, value);
    };
    (window as Window & { restoreWorkspaceStorage?: () => void }).restoreWorkspaceStorage = () => { Storage.prototype.setItem = setItem; };
  }, workspaceKey);
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("workspace-storage-error")).toContainText("quota");
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await expect(page.getByTestId("client-profile-company-input")).toHaveValue("Retained Synthetic Farm");
  expect(await raw(page)).toBe(before);
  const download = page.waitForEvent("download");
  await page.getByTestId("workspace-storage-recovery").click();
  const recovery = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(recovery.workspaceRaw).toBe(before);
  await page.getByTestId("workspace-storage-retry").click();
  await expect(page.getByTestId("workspace-storage-error")).toContainText("quota");
  await expect(page.getByTestId("client-profile-company-input")).toHaveValue("Retained Synthetic Farm");
  await page.screenshot({ path: testInfo.outputPath("client-write-retry.png") });
  await page.evaluate(() => (window as Window & { restoreWorkspaceStorage?: () => void }).restoreWorkspaceStorage?.());
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  expect(JSON.parse((await raw(page))!).catalog.clients[0].companyName).toBe("Retained Synthetic Farm");
});
