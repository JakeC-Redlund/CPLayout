import { expect, test, type Page } from "@playwright/test";
import { parseProjectDocument, sampleProject, serializeProjectDocument, type PivotProject } from "../../packages/core/src";
import { emptyProjectCatalog, ensureCatalogEntryForProject } from "../../packages/project-store/src/projectCatalog";
import { buildProjectRecoveryArchiveBundle, exportProjectArchiveZip } from "../../packages/project-store/src/projectArchive";
import { readWorkspace, workspaceKey, workspaceStorageBytes } from "./workspace-fixtures";

const fixedUuid = "10000000-0000-4000-8000-000000000001";
const source = { ...sampleProject, id: "project-copy-source", name: "Synthetic Copy Source" };
const collisionTarget = { ...sampleProject, id: `project-copy-${fixedUuid}`, name: "Synthetic Collision Target" };
const writerLock = "cplayout:workspace:writer:v1";
type Workspace = Awaited<ReturnType<typeof readWorkspace>>;
type FixtureWindow = Window & {
  releaseProjectCopyLock?: () => void;
  restoreProjectCopyWrites?: () => void;
  completedProjectCopyReads?: number;
};

function legacyEntry(project: PivotProject) {
  return { document: serializeProjectDocument(project), summary: {
    id: project.id, name: project.name, projectCrs: project.projectCrs,
    unitSystem: project.unitSystem, updatedAt: "2026-09-17T00:00:00Z",
  } };
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
  await context.addInitScript(({ key, projects, catalog }) => {
    if (localStorage.getItem(key) === null && localStorage.getItem("center-pivot-layout-projects-v1") === null) {
      localStorage.setItem("center-pivot-layout-projects-v1", projects);
      localStorage.setItem("center-pivot-layout-project-catalog-v1", catalog);
    }
    const read = FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer = function (blob) {
      this.addEventListener("loadend", () => setTimeout(() => {
        const target = window as FixtureWindow;
        target.completedProjectCopyReads = (target.completedProjectCopyReads ?? 0) + 1;
      }, 0), { once: true });
      read.call(this, blob);
    };
  }, {
    key: workspaceKey,
    projects: JSON.stringify({ [source.id]: legacyEntry(source), [collisionTarget.id]: legacyEntry(collisionTarget) }),
    catalog: JSON.stringify(ensureCatalogEntryForProject(emptyProjectCatalog(), source)),
  });
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

async function openSource(page: Page) {
  await ready(page);
  await sampleFiles(page);
  await page.getByLabel(`Open ${source.name}`, { exact: true }).click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(source.name);
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("project-save-copy")).toBeEnabled();
}

async function editSurvey(page: Page, id: string) {
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill(
    `id,label,role,x,y,source,confidence\n${id},${id},note,501050,4506050,imported,rtk_float\n`,
  );
  await page.getByTestId("files-action-import-csv").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
}

async function copyForm(page: Page, name: string) {
  await page.getByTestId("project-save-copy").click();
  await expect(page.getByTestId("catalog-dialog")).toBeVisible();
  await page.getByTestId("catalog-dialog-name-input").fill(name);
}

async function confirmCopy(page: Page) {
  await page.getByRole("button", { name: "Confirm Save Copy", exact: true }).click();
}

async function savedCopy(page: Page, name: string) {
  await expect.poll(async () => (await readWorkspace(page)).projectDocuments.some(entry => entry.summary.name === name)).toBe(true);
  return (await readWorkspace(page)).projectDocuments.find(entry => entry.summary.name === name)!;
}

function entry(workspace: Workspace, id = source.id) {
  const found = workspace.projectDocuments.find(item => item.summary.id === id);
  expect(found).toBeDefined();
  return found!;
}

async function holdWriter(page: Page) {
  await page.evaluate(async name => {
    await new Promise<void>(acquired => {
      void navigator.locks.request(name, async () => {
        await new Promise<void>(release => {
          (window as FixtureWindow).releaseProjectCopyLock = release;
          acquired();
        });
      });
    });
  }, writerLock);
}

async function pendingWrite(page: Page) {
  await expect.poll(() => page.evaluate(async name => (await navigator.locks.query()).pending
    ?.filter(lock => lock.name === name).length ?? 0, writerLock)).toBe(1);
}

async function releaseWriter(page: Page) {
  await page.evaluate(() => (window as FixtureWindow).releaseProjectCopyLock?.());
  await page.evaluate(name => navigator.locks.request(name, () => undefined), writerLock);
}

async function failWrites(page: Page) {
  await page.evaluate(key => {
    const set = Storage.prototype.setItem;
    (window as FixtureWindow).restoreProjectCopyWrites = () => { Storage.prototype.setItem = set; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Synthetic project copy quota failure", "QuotaExceededError");
      set.call(this, name, value);
    };
  }, workspaceKey);
}

async function restoreWrites(page: Page) {
  await page.evaluate(() => (window as FixtureWindow).restoreProjectCopyWrites?.());
}

async function forceCollision(page: Page) {
  await page.evaluate(uuid => Object.defineProperty(crypto, "randomUUID", { configurable: true, value: () => uuid }), fixedUuid);
}

function zipFixture(project = source, unknownExtension = false) {
  const bundle = buildProjectRecoveryArchiveBundle(project);
  if (unknownExtension) {
    // Inject after serialization so the fixture really contains unsupported source data.
    const document = JSON.parse(bundle.files["project.json"]) as { project: { machine: Record<string, unknown> } };
    document.project.machine.futureCalibration = { retain: "synthetic unsupported extension" };
    bundle.files["project.json"] = JSON.stringify(document);
  }
  return { name: "synthetic-copy.zip", mimeType: "application/zip", buffer: Buffer.from(exportProjectArchiveZip(bundle)) };
}

async function importZip(page: Page, asCopy: boolean, fixture = zipFixture()) {
  const completed = () => page.evaluate(() => (window as FixtureWindow).completedProjectCopyReads ?? 0);
  const before = await completed();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId(asCopy ? "files-action-import-copy" : "files-action-import-zip").click();
  await (await chooser).setFiles(fixture);
  await expect.poll(completed).toBe(before + 1);
}

test("Save Copy keeps the saved source and catalog unchanged until the independent copy is opened explicitly", async ({ page }) => {
  await openSource(page);
  const before = await readWorkspace(page);
  const legacyBytes = (await workspaceStorageBytes(page)).slice(1);
  const title = await page.getByTestId("workspace-breadcrumb-current").innerText();
  await copyForm(page, "Independent saved fork");
  const dialog = page.getByTestId("catalog-dialog");
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.screenshot({ path: test.info().outputPath("project-copy-dialog.png"), animations: "disabled" });
  await confirmCopy(page);
  await expect(page.getByTestId("project-copy-status")).toHaveText("Saved copy: Independent saved fork.");
  await expect(page.getByTestId("workspace-breadcrumb-current")).toHaveText(title);
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const copy = await savedCopy(page, "Independent saved fork");
  expect(copy.summary.id).toMatch(/^project-copy-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(parseProjectDocument(copy.document)).toEqual({ ...parseProjectDocument(entry(before).document), id: copy.summary.id, name: copy.summary.name });
  const after = await readWorkspace(page);
  expect(after.projectDocuments).toHaveLength(before.projectDocuments.length + 1);
  expect(entry(after)).toEqual(entry(before));
  expect(after.catalog).toEqual(before.catalog);
  expect((await workspaceStorageBytes(page)).slice(1)).toEqual(legacyBytes);
  await page.getByLabel(`Open ${copy.summary.name}`, { exact: true }).click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(copy.summary.name);
  await editSurvey(page, "copy-only-edit");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const edited = await readWorkspace(page);
  expect(parseProjectDocument(entry(edited, copy.summary.id).document).surveyPoints).toContainEqual(expect.objectContaining({ id: "copy-only-edit" }));
  expect(entry(edited)).toEqual(entry(before));
  expect(edited.catalog).toEqual(before.catalog);
});

test("Save Copy retains dirty edits and undo history and does not make the original Save falsely stale", async ({ page }) => {
  await openSource(page);
  const before = await readWorkspace(page);
  await editSurvey(page, "unsaved-source-edit");
  await copyForm(page, "Dirty snapshot fork");
  await confirmCopy(page);
  const copy = await savedCopy(page, "Dirty snapshot fork");
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  expect(entry(await readWorkspace(page))).toEqual(entry(before));
  expect(parseProjectDocument(copy.document).surveyPoints).toContainEqual(expect.objectContaining({ id: "unsaved-source-edit" }));
  await expect(page.getByTestId("command-icon-undo")).toBeEnabled();
  await page.getByTestId("command-icon-undo").click();
  await expect(page.getByTestId("command-icon-redo")).toBeEnabled();
  await page.getByTestId("command-icon-redo").click();
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
  const after = await readWorkspace(page);
  expect(parseProjectDocument(entry(after).document).surveyPoints).toContainEqual(expect.objectContaining({ id: "unsaved-source-edit" }));
  expect(entry(after, copy.summary.id)).toEqual(copy);
  expect(after.catalog.designs.some(design => design.kind === "project" && design.pivotProjectId === copy.summary.id)).toBe(false);
});

test("copying an unsaved sample does not upgrade its null receipt or prevent its first normal Save", async ({ page }) => {
  await ready(page);
  await sampleFiles(page);
  const before = await readWorkspace(page);
  expect(before.projectDocuments.some(item => item.summary.id === sampleProject.id)).toBe(false);
  await copyForm(page, "Unsaved sample fork");
  await confirmCopy(page);
  const copy = await savedCopy(page, "Unsaved sample fork");
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(sampleProject.name);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
  const after = await readWorkspace(page);
  expect(after.projectDocuments).toHaveLength(before.projectDocuments.length + 2);
  expect(entry(after, sampleProject.id).summary.name).toBe(sampleProject.name);
  expect(entry(after, copy.summary.id)).toEqual(copy);
  expect(after.catalog).toEqual(before.catalog);
});

test("Refresh allows a stale source to be copied without authorizing overwrite of the newer original", async ({ page, context }) => {
  await openSource(page);
  await editSurvey(page, "local-stale-edit");
  const second = await context.newPage();
  try {
    await openSource(second);
    await editSurvey(second, "remote-committed-edit");
    await second.getByTestId("command-icon-save").click();
    await expect(second.getByTestId("project-save-state")).toHaveText("Saved");
    const remote = await readWorkspace(second);
    await page.getByTestId("command-icon-save").click();
    await expect(page.getByTestId("workspace-storage-error")).toContainText("revision changed");
    await page.getByTestId("files-action-refresh").click();
    await page.evaluate(name => navigator.locks.request(name, () => undefined), writerLock);
    await expect(page.getByTestId("workspace-storage-error")).toContainText("revision changed");
    await copyForm(page, "Recovered stale fork");
    await confirmCopy(page);
    const copy = await savedCopy(page, "Recovered stale fork");
    await expect(page.getByTestId("catalog-dialog")).toBeHidden();
    const points = parseProjectDocument(copy.document).surveyPoints;
    expect(points).toContainEqual(expect.objectContaining({ id: "local-stale-edit" }));
    expect(points).not.toContainEqual(expect.objectContaining({ id: "remote-committed-edit" }));
    const copied = await workspaceStorageBytes(page);
    expect(entry(await readWorkspace(page))).toEqual(entry(remote));
    expect((await readWorkspace(page)).catalog).toEqual(remote.catalog);
    await page.getByTestId("command-icon-save").click();
    await expect(page.getByTestId("workspace-storage-error")).toContainText("revision changed");
    await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
    await page.evaluate(name => navigator.locks.request(name, () => undefined), writerLock);
    expect(await workspaceStorageBytes(page)).toEqual(copied);
  } finally {
    await second.close();
  }
});

test("closing a pending copy and editing preserves the invocation snapshot without late success feedback", async ({ page }) => {
  await openSource(page);
  const before = await readWorkspace(page);
  await copyForm(page, "Pending snapshot fork");
  await holdWriter(page);
  try {
    await confirmCopy(page);
    await pendingWrite(page);
    await expect(page.getByTestId("catalog-dialog-cancel")).toBeEnabled();
    await page.getByTestId("catalog-dialog-cancel").click();
    await editSurvey(page, "edit-after-copy-start");
  } finally {
    await releaseWriter(page);
  }
  const copy = await savedCopy(page, "Pending snapshot fork");
  await expect(page.getByTestId("project-save-copy")).toBeEnabled();
  await expect(page.getByTestId("project-copy-status")).toHaveCount(0);
  await expect(page.getByTestId("project-copy-error")).toHaveCount(0);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(source.name);
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  expect(parseProjectDocument(copy.document).surveyPoints).not.toContainEqual(expect.objectContaining({ id: "edit-after-copy-start" }));
  expect(entry(await readWorkspace(page))).toEqual(entry(before));
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  expect(parseProjectDocument(entry(await readWorkspace(page)).document).surveyPoints).toContainEqual(expect.objectContaining({ id: "edit-after-copy-start" }));
});

test("a copy failure after closing and navigating cannot report on the new editor", async ({ page }) => {
  await openSource(page);
  const before = await workspaceStorageBytes(page);
  await copyForm(page, "Abandoned failing fork");
  await failWrites(page);
  await holdWriter(page);
  try {
    await confirmCopy(page);
    await pendingWrite(page);
    await page.getByTestId("catalog-dialog-cancel").click();
    await sampleFiles(page);
  } finally {
    await releaseWriter(page);
    await restoreWrites(page);
  }
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(sampleProject.name);
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  await expect(page.getByTestId("project-copy-error")).toHaveCount(0);
  await expect(page.getByTestId("project-copy-status")).toHaveCount(0);
  await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
  await expect(page.getByTestId("files-status")).not.toContainText("quota");
  expect(await workspaceStorageBytes(page)).toEqual(before);
});

test("a current copy quota failure keeps its name and source available for retry", async ({ page }) => {
  await openSource(page);
  const before = await workspaceStorageBytes(page);
  await copyForm(page, "Retry retained fork");
  await failWrites(page);
  try {
    await confirmCopy(page);
    await expect(page.getByTestId("project-copy-error")).toContainText("quota");
    await expect(page.getByTestId("catalog-dialog-name-input")).toHaveValue("Retry retained fork");
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
    expect(await workspaceStorageBytes(page)).toEqual(before);
  } finally {
    await restoreWrites(page);
  }
  await confirmCopy(page);
  await savedCopy(page, "Retry retained fork");
  await expect(page.getByTestId("project-copy-status")).toContainText("Saved copy: Retry retained fork.");
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(source.name);
});

test("Import ZIP remains create-only while explicit Import Copy recovers a same-ID archive independently", async ({ page }) => {
  await openSource(page);
  const before = await readWorkspace(page);
  const bytes = await workspaceStorageBytes(page);
  const imported = { ...source, name: "Imported collision fork" };
  await importZip(page, false, zipFixture(imported));
  await expect(page.getByTestId("project-import-status")).toContainText("was not saved locally");
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  expect(await workspaceStorageBytes(page)).toEqual(bytes);
  await page.getByTestId("workspace-nav-files").click();
  await importZip(page, true, zipFixture(imported));
  await expect(page.getByTestId("project-import-status")).toHaveText("Imported project saved locally.");
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
  const copy = await savedCopy(page, imported.name);
  expect(copy.summary.id).not.toBe(source.id);
  expect(copy.summary.id).toMatch(/^project-copy-/);
  const after = await readWorkspace(page);
  expect(entry(after)).toEqual(entry(before));
  expect(after.catalog).toEqual(before.catalog);
  expect(after.projectDocuments).toHaveLength(before.projectDocuments.length + 1);
  await editSurvey(page, "imported-copy-edit");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const edited = await readWorkspace(page);
  expect(parseProjectDocument(entry(edited, copy.summary.id).document).surveyPoints).toContainEqual(expect.objectContaining({ id: "imported-copy-edit" }));
  expect(entry(edited)).toEqual(entry(before));
  expect(edited.catalog).toEqual(before.catalog);
});

test("Save Copy rejects a forced UUID collision without modifying either stored identity", async ({ page }) => {
  await openSource(page);
  const before = await workspaceStorageBytes(page);
  await forceCollision(page);
  await copyForm(page, "Blocked colliding fork");
  await confirmCopy(page);
  await expect(page.getByTestId("project-copy-error")).toBeVisible();
  await expect(page.getByTestId("catalog-dialog-name-input")).toHaveValue("Blocked colliding fork");
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(source.name);
  expect(await workspaceStorageBytes(page)).toEqual(before);
});

test("Import Copy rejects a forced UUID collision and leaves its unsaved editor unable to overwrite the target", async ({ page }) => {
  await openSource(page);
  const before = await workspaceStorageBytes(page);
  await forceCollision(page);
  await importZip(page, true, zipFixture({ ...source, name: "Blocked imported fork" }));
  await expect(page.getByTestId("project-import-status")).toContainText("was not saved locally");
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  expect(await workspaceStorageBytes(page)).toEqual(before);
  await page.getByTestId("command-icon-save").click();
  await page.evaluate(name => navigator.locks.request(name, () => undefined), writerLock);
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  expect(await workspaceStorageBytes(page)).toEqual(before);
});

test("both ZIP import modes reject a nested unknown extension instead of persisting a partial copy", async ({ page }) => {
  await openSource(page);
  const before = await workspaceStorageBytes(page);
  const title = await page.getByTestId("workspace-breadcrumb-current").innerText();
  for (const asCopy of [false, true]) {
    await importZip(page, asCopy, zipFixture(source, true));
    await expect(page.getByTestId("files-status")).toContainText("unsupported fields");
    await expect(page.getByTestId("workspace-breadcrumb-current")).toHaveText(title);
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    expect(await workspaceStorageBytes(page)).toEqual(before);
  }
});

test("a delayed normal Save failure cannot attach its error to a subsequently loaded editor", async ({ page }) => {
  await openSource(page);
  await editSurvey(page, "old-editor-unsaved");
  const before = await workspaceStorageBytes(page);
  await failWrites(page);
  await holdWriter(page);
  try {
    await page.getByTestId("command-icon-save").click();
    await pendingWrite(page);
    await sampleFiles(page);
  } finally {
    await releaseWriter(page);
    await restoreWrites(page);
  }
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(sampleProject.name);
  await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
  await expect(page.getByTestId("workspace-storage-error")).toHaveCount(0);
  await expect(page.getByTestId("files-status")).not.toContainText("quota");
  expect(await workspaceStorageBytes(page)).toEqual(before);
});
