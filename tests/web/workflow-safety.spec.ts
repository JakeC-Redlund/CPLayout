import { expect, test, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { readWorkspace, workspaceStorageBytes } from "./workspace-fixtures";

test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
  await page.goto("/");
});

async function openSample(page: Page): Promise<void> {
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
}

test("sample save state reflects actual persistence and resets on a new load", async ({ page }) => {
  await openSample(page);
  const state = page.getByTestId("project-save-state");
  await expect(state).toContainText("Unsaved edits");
  const empty = await readWorkspace(page);
  expect(empty.revision).toBe(0);
  expect(empty.projectDocuments).toEqual([]);
  const initialBytes = await workspaceStorageBytes(page);
  expect(initialBytes.slice(1, 3)).toEqual([null, null]);
  await page.getByTestId("command-icon-save").click();
  await expect(state).toContainText("Saved");
  const saved = await workspaceStorageBytes(page);
  const workspace = await readWorkspace(page);
  expect(workspace.projectDocuments).toHaveLength(1);
  expect(workspace.catalog).toEqual({ clients: [], projects: [], fieldMaps: [], designs: [] });
  expect(saved.slice(1)).toEqual(initialBytes.slice(1));
  await openSample(page);
  await expect(state).toContainText("Unsaved edits");
  expect(await workspaceStorageBytes(page)).toEqual(saved);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("workspace-storage-error")).toContainText("Document identity is already used");
  await expect(state).toContainText("Unsaved edits");
  expect(await workspaceStorageBytes(page)).toEqual(saved);
});

test("wizard review and checklist are independent and clipboard rejection is visible", async ({ page }, testInfo) => {
  await openSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const wizard = page.getByTestId("google-earth-import-wizard");
  const checks = wizard.getByRole("checkbox");
  await expect(checks).toHaveCount(7);
  await page.getByTestId("google-earth-wizard-step-ready").click();
  await expect(wizard).toContainText("1/6 complete");
  for (const checkbox of await checks.all()) await expect(checkbox).not.toBeChecked();
  await checks.last().click();
  await expect(checks.last()).toBeChecked();
  for (const checkbox of (await checks.all()).slice(0, -1)) await checkbox.click();
  await expect(wizard.getByRole("checkbox", { checked: true })).toHaveCount(7);
  await checks.first().click();
  await expect(checks.first()).not.toBeChecked();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async () => { throw new Error("Denied in test"); } },
  }));
  await wizard.getByRole("button", { name: "Copy field_boundary", exact: true }).click();
  await expect(wizard.getByRole("alert")).toContainText("Could not copy");
  await expect(wizard.getByText(/^Copied:/)).toHaveCount(0);
  await wizard.getByRole("alert").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("review-checklist.png") });
});

test("KML selection refreshes replacement warnings and cancel preserves the saved project", async ({ page }, testInfo) => {
  await openSample(page);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const saved = await workspaceStorageBytes(page);
  await page.getByTestId("workspace-nav-files").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("files-action-import-kml-kmz").click();
  await (await chooser).setFiles({ name: "selection.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from(`
    <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>field_boundary</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
        -105,40 -104.999,40 -104.999,40.001 -105,40.001 -105,40
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>survey_point</name><Point><coordinates>-105,40</coordinates></Point></Placemark>
    </Document></kml>`) });
  await expect(page.getByText(/Existing field boundary will be replaced/)).toBeVisible();
  const boundary = page.getByRole("checkbox").filter({ hasText: /^field_boundary/ });
  await expect(boundary).toBeChecked();
  await boundary.click();
  await expect(boundary).not.toBeChecked();
  await expect(page.getByText(/Existing field boundary will be replaced/)).toHaveCount(0);
  await expect(page.getByTestId("files-status")).toContainText("no boundary");
  await page.getByTestId("files-action-cancel-kml-kmz-import").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await workspaceStorageBytes(page)).toEqual(saved);
  await page.screenshot({ path: testInfo.outputPath("kml-selection-cancel.png") });
});

const retryKml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>survey_point</name><Point><coordinates>-105,40,123</coordinates></Point></Placemark></Document></kml>`;
const makeKmz = (files: Record<string, Uint8Array>) => Buffer.from(zipSync(files, { level: 0, mtime: new Date("2026-09-17T00:00:00Z") }));
const validKmz = () => makeKmz({ "folder/": new Uint8Array(), "folder/\u00e9.kml": strToU8(`\ufeff${retryKml}`), "folder/image.bin": new Uint8Array([0xff, 0, 0xfe]) });
const savedBytes = workspaceStorageBytes;
async function chooseKmz(page: Page, buffer: Buffer, name: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("files-action-import-kml-kmz").click();
  await (await chooser).setFiles({ name, mimeType: "application/vnd.google-earth.kmz", buffer });
}

test("KMZ corruption clears old previews, preserves storage and permits a valid retry", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openSample(page);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const before = await savedBytes(page);
  await page.getByTestId("workspace-nav-files").click();
  const damagedKml = makeKmz({ "doc.kml": strToU8(retryKml) });
  const coordinate = damagedKml.indexOf("-105");
  expect(coordinate).toBeGreaterThan(0);
  damagedKml[coordinate + 3] = 0x36;
  const damagedAsset = validKmz();
  const asset = damagedAsset.indexOf(Buffer.from([0xff, 0, 0xfe]));
  expect(asset).toBeGreaterThan(0);
  damagedAsset[asset] = 0xfd;
  const failures = [
    { bytes: damagedKml, message: "CRC-32 mismatch: doc.kml" },
    { bytes: damagedAsset, message: "CRC-32 mismatch: folder/image.bin" },
    { bytes: makeKmz({ "doc.kml": new Uint8Array([0xff]) }), message: "invalid UTF-8" },
    { bytes: makeKmz({ "a.kml": strToU8(retryKml), "b.kml": strToU8(retryKml) }), message: "exactly one KML" },
  ];
  for (const [index, failure] of failures.entries()) {
    await chooseKmz(page, validKmz(), `preview-${index}.kmz`);
    await expect(page.getByTestId("files-action-apply-kml-kmz-import")).toBeVisible();
    await chooseKmz(page, failure.bytes, `rejected-${index}.kmz`);
    await expect(page.getByTestId("files-status")).toContainText(failure.message);
    await expect(page.getByTestId("files-action-apply-kml-kmz-import")).toHaveCount(0);
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    expect(await savedBytes(page)).toEqual(before);
  }
  await page.getByTestId("files-status").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("kmz-corrupt-rejection.png") });
  await chooseKmz(page, validKmz(), "valid-retry.kmz");
  await expect(page.getByTestId("files-status")).toContainText("folder/\u00e9.kml");
  expect(await savedBytes(page)).toEqual(before);
  await page.getByTestId("files-action-cancel-kml-kmz-import").click();
  expect(await savedBytes(page)).toEqual(before);
  await chooseKmz(page, validKmz(), "valid-apply.kmz");
  await page.getByTestId("files-action-apply-kml-kmz-import").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  expect(await savedBytes(page)).toEqual(before);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const after = await savedBytes(page);
  const workspaceBefore = JSON.parse(before[0]!);
  const workspaceAfter = await readWorkspace(page);
  expect(workspaceAfter.revision).toBe(workspaceBefore.revision + 1);
  expect(workspaceAfter.projectDocuments).toHaveLength(1);
  expect(workspaceAfter.catalog).toEqual(workspaceBefore.catalog);
  expect(after.slice(1)).toEqual(before.slice(1));
  const original = JSON.parse(workspaceBefore.projectDocuments[0].document).project;
  const updated = JSON.parse(workspaceAfter.projectDocuments[0].document).project;
  expect(updated.fieldBoundary).toEqual(original.fieldBoundary);
  expect(updated.pivotCenter).toEqual(original.pivotCenter);
  expect(updated.surveyPoints.length).toBe(original.surveyPoints.length + 1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("kmz-valid-retry-saved.png") });
});

test("a KML picker from a superseded project cannot create a preview", async ({ page }) => {
  await openSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const before = await savedBytes(page);
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer = function (blob) {
      this.addEventListener("loadend", () => setTimeout(() => {
        document.documentElement.dataset.lateKmlRead = "completed";
      }, 0), { once: true });
      read.call(this, blob);
    };
  });
  const picker = page.waitForEvent("filechooser");
  await page.getByTestId("files-action-import-kml-kmz").click();
  const chooser = await picker;
  await openSample(page);
  await chooser.setFiles({ name: "late.kmz", mimeType: "application/vnd.google-earth.kmz", buffer: validKmz() });
  await expect(page.locator("html")).toHaveAttribute("data-late-kml-read", "completed");
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("files-action-apply-kml-kmz-import")).toHaveCount(0);
  await expect(page.getByTestId("files-status")).not.toContainText("late.kmz");
  expect(await savedBytes(page)).toEqual(before);
});
