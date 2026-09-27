import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { defaultAppSettings, parseProjectDocument } from "../../packages/core/src";
import { importProjectArchiveZip } from "../../packages/project-store/src/projectArchive";
import { readWorkspace, workspaceStorageBytes } from "./workspace-fixtures";
import { activateMapTool } from "./map-toolbar";

type Camera = [number, number, number, number, number];
const mapLabel = "CPLayout MapLibre imagery workbench";
const nudgeMeters = Math.max(1, defaultAppSettings().drawing.panStepMeters / 4);

test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === new URL(baseURL!).origin || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort("blockedbyclient");
  });
});

async function stableCamera(page: Page): Promise<Camera> {
  const map = page.getByLabel(mapLabel);
  await expect(map).toHaveAttribute("data-map-instance", /^\d+$/);
  let previous: string | null = null;
  let unchanged = 0;
  await expect.poll(async () => {
    const current = await map.getAttribute("data-map-camera");
    unchanged = current !== null && current === previous ? unchanged + 1 : 0;
    previous = current;
    return unchanged;
  }, { intervals: [200], message: "mapCamera must settle across successive samples" }).toBeGreaterThanOrEqual(3);
  const camera = JSON.parse(previous!) as Camera;
  expect(camera).toHaveLength(5);
  expect(camera.every(Number.isFinite)).toBe(true);
  return camera;
}

async function closePanels(page: Page) {
  for (const name of [/Collapse (map inspector|right workflow sidebar)/, /Collapse project drawer/]) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible()) await button.click();
  }
}

async function openSample(page: Page) {
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
}

async function saveProject(page: Page) {
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const documents = (await readWorkspace(page)).projectDocuments;
  expect(documents).toHaveLength(1);
  return parseProjectDocument(documents[0].document);
}

async function exportProject(page: Page) {
  await page.getByTestId("workspace-nav-files").click();
  const download = page.waitForEvent("download");
  await page.getByTestId("files-action-export-zip").click();
  const stream = await (await download).createReadStream();
  if (!stream) throw new Error("Project ZIP download has no readable stream.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return importProjectArchiveZip(Buffer.concat(chunks));
}

async function selectBoundary(page: Page) {
  await activateMapTool(page, "edit");
  await closePanels(page);
  await page.getByTestId("browser-edit-select-boundary").click();
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", /boundary vertex 1 of/);
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60_000 });
  await stableCamera(page);
}

async function handleIsOnMap(page: Page): Promise<boolean> {
  const handle = await page.getByTestId("browser-edit-drag-handle").boundingBox();
  const map = await page.getByLabel(mapLabel).boundingBox();
  const dock = await page.getByTestId("browser-map-bottom-dock").boundingBox();
  if (!handle || !map) return false;
  return handle.x >= map.x && handle.x + handle.width <= map.x + map.width
    && handle.y >= map.y && handle.y + handle.height <= Math.min(map.y + map.height, dock?.y ?? Infinity);
}

async function panAndZoom(page: Page, offscreenSelection = false): Promise<Camera> {
  const before = await stableCamera(page);
  await page.locator(".maplibregl-ctrl-zoom-in").click();
  const zoomed = await stableCamera(page);
  expect(zoomed[2], "setup must deliberately change zoom").toBeGreaterThan(before[2] + 0.5);
  const canvas = page.getByLabel(mapLabel).locator("canvas");
  // Keyboard navigation exercises the public canvas interaction on all viewport sizes.
  for (let step = 0; step < 16; step += 1) {
    await canvas.focus();
    await canvas.press("ArrowRight");
    await stableCamera(page);
    if (step >= 1 && (!offscreenSelection || !await handleIsOnMap(page))) break;
  }
  const panned = await stableCamera(page);
  expect(Math.hypot(panned[0] - zoomed[0], panned[1] - zoomed[1]), "setup must deliberately pan").toBeGreaterThan(1e-7);
  if (offscreenSelection) expect(await handleIsOnMap(page), "selected vertex must be offscreen before the edit").toBe(false);
  return panned;
}

async function expectPreserved(page: Page, expected: Camera, instance: string | null, label: string, testInfo: TestInfo) {
  const actual = await stableCamera(page);
  if (label === "accepted-edit" || label === "rejected-edit") {
    await page.screenshot({ path: testInfo.outputPath(`${label}.png`), animations: "disabled" });
  }
  await testInfo.attach(`${label}-camera.json`, {
    body: JSON.stringify({ expected, actual, instanceBefore: instance, instanceAfter: await page.getByLabel(mapLabel).getAttribute("data-map-instance") }),
    contentType: "application/json",
  });
  expectSameCamera(actual, expected, label);
  expect(instance).not.toBeNull();
  expect.soft(await page.getByLabel(mapLabel).getAttribute("data-map-instance"), `${label}: no renderer remount`).toBe(instance);
}

function expectSameCamera(actual: Camera, expected: Camera, label: string) {
  // Reconstructed MapLibre transforms can round-trip latitude at floating-point precision.
  for (let index = 0; index < expected.length; index += 1) {
    expect.soft(actual[index], `${label}: preserve camera component ${index}`).toBeCloseTo(expected[index], 8);
  }
}

test("offscreen accepted vertex edit and undo/redo preserve camera and canonical XY", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSample(page);
  const original = await saveProject(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectBoundary(page);
  const camera = await panAndZoom(page, true);
  const instance = await page.getByLabel(mapLabel).getAttribute("data-map-instance");
  const moved = original.fieldBoundary.map((point, index) => index === 0 ? { ...point, x: point.x + nudgeMeters } : point);

  await page.getByTestId("browser-edit-nudge-east").click();
  await expect(page.getByTestId("browser-map-action-status")).toContainText("Moved boundary vertex 1");
  expect((await saveProject(page)).fieldBoundary).toEqual(moved);
  await expectPreserved(page, camera, instance, "accepted-edit", testInfo);
  expect.soft(await handleIsOnMap(page), "accepted edit must not reveal an offscreen selection").toBe(false);

  await page.getByTestId("command-icon-undo").click();
  expect((await saveProject(page)).fieldBoundary).toEqual(original.fieldBoundary);
  await expectPreserved(page, camera, instance, "undo", testInfo);
  await page.getByTestId("command-icon-redo").click();
  expect((await saveProject(page)).fieldBoundary).toEqual(moved);
  await expectPreserved(page, camera, instance, "redo", testInfo);

});

test("explicit same-vertex reselect reveals the panned-offscreen selection without editing XY", async ({ page }) => {
  await page.goto("/");
  await openSample(page);
  await saveProject(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectBoundary(page);
  const away = await panAndZoom(page, true);
  const selection = await page.getByTestId("browser-edit-drag-handle").getAttribute("aria-label");
  const stored = await workspaceStorageBytes(page);
  await page.getByTestId("browser-edit-select-boundary").click();
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", selection!);
  await expect.poll(() => handleIsOnMap(page), { message: "explicit same-vertex reselect must reveal the handle" }).toBe(true);
  expect(await stableCamera(page)).not.toEqual(away);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
});

test("rejected duplicate vertex edit preserves panned zoomed camera, selection and saved XY", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSample(page);
  await saveProject(page);
  await page.getByTestId("workspace-nav-files").click();
  const x = 501000, y = 4506000;
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({ type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32613" }, features: [{ type: "Feature", properties: { layerType: "field_boundary" },
      geometry: { type: "Polygon", coordinates: [[[x, y], [x + nudgeMeters, y], [x + nudgeMeters, y + 120], [x, y + 120], [x, y]]] } }],
  }));
  await page.getByTestId("files-action-import-geojson").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  const original = await saveProject(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectBoundary(page);
  const camera = await panAndZoom(page, true);
  const instance = await page.getByLabel(mapLabel).getAttribute("data-map-instance");
  const stored = await workspaceStorageBytes(page);
  await page.getByTestId("browser-edit-nudge-east").click();
  await expect(page.getByTestId("browser-map-action-status")).toContainText(/Map edit rejected:.*duplicate/i);
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", "Drag boundary vertex 1 of 4");
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect(parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary).toEqual(original.fieldBoundary);
  await expectPreserved(page, camera, instance, "rejected-edit", testInfo);
  expect.soft(await handleIsOnMap(page), "rejection must not reveal an offscreen selection").toBe(false);
});

test("reopening the same project ID discards the previous camera and freshly fits", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSample(page);
  const original = await saveProject(page);
  await page.getByTestId("workspace-nav-map").click();
  await closePanels(page);
  // Establish the reference fit at the same panel dimensions as the later reopen.
  await openSample(page);
  await page.getByTestId("workspace-nav-map").click();
  const fit = await stableCamera(page);
  const away = await panAndZoom(page);
  const instance = await page.getByLabel(mapLabel).getAttribute("data-map-instance");
  const oldCanvas = await page.getByLabel(mapLabel).locator("canvas").elementHandle();
  expect(oldCanvas).not.toBeNull();
  await openSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await closePanels(page);
  const reopened = await stableCamera(page);
  expect(reopened).not.toEqual(away);
  for (let index = 0; index < fit.length; index += 1) expect(reopened[index], `fresh fit camera component ${index}`).toBeCloseTo(fit[index], 5);
  const nextInstance = await page.getByLabel(mapLabel).getAttribute("data-map-instance");
  await expect.poll(() => oldCanvas!.evaluate(element => element.isConnected), { message: "reopen must replace the previous generation's canvas" }).toBe(false);
  // Reopening a sample with a saved ID is intentionally unsaved; export the active document.
  const exported = await exportProject(page);
  expect(exported.id).toBe(original.id);
  expect(exported.fieldBoundary).toEqual(original.fieldBoundary);
  await testInfo.attach("same-id-reopen-camera.json", { body: JSON.stringify({ fit, away, reopened, instance, nextInstance }), contentType: "application/json" });
});

test("same-frame imagery replacement preserves a deliberately panned and zoomed camera", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSample(page);
  const original = await saveProject(page);
  await page.getByTestId("workspace-nav-map").click();
  await closePanels(page);
  const camera = await panAndZoom(page);
  const instance = await page.getByLabel(mapLabel).getAttribute("data-map-instance");
  const oldCanvas = await page.getByLabel(mapLabel).locator("canvas").elementHandle();
  expect(oldCanvas).not.toBeNull();
  const open = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ }).first();
  if (await open.isVisible()) await open.click();
  const tools = page.getByTestId("workflow-sidebar-tab-tools").first();
  if (await tools.isVisible()) await tools.click();
  await page.getByTestId("inspector-scroll").getByTestId("design-action-layers").click();
  await expect(page.getByTestId("places-layers-summary")).toBeVisible();
  await page.getByRole("button", { name: "Aerial Off", exact: true }).click();
  await page.getByTestId("design-console-close").click();
  await closePanels(page);
  await expect.poll(() => oldCanvas!.evaluate(element => element.isConnected), { message: "imagery replacement must reconstruct the style renderer" }).toBe(false);
  const restored = await stableCamera(page);
  await page.screenshot({ path: testInfo.outputPath("style-replacement.png"), animations: "disabled" });
  expectSameCamera(restored, camera, "style reconstruction");
  const nextInstance = await page.getByLabel(mapLabel).getAttribute("data-map-instance");
  if (instance !== null) expect(Number(nextInstance)).toBeGreaterThan(Number(instance));
  const saved = await saveProject(page);
  expect(saved.id).toBe(original.id);
  expect(saved.fieldBoundary).toEqual(original.fieldBoundary);
  await testInfo.attach("style-replacement-camera.json", { body: JSON.stringify({ camera, restored, instance, nextInstance }), contentType: "application/json" });
});

test("large viewport shrink reveals a visible selection but leaves an offscreen selection alone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await openSample(page);
  await saveProject(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectBoundary(page);
  await expect.poll(() => handleIsOnMap(page)).toBe(true);
  const stored = await workspaceStorageBytes(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => handleIsOnMap(page), { message: "previously visible handle survives a large shrink" }).toBe(true);
  await stableCamera(page);
  await page.screenshot({ path: testInfo.outputPath("large-shrink-visible-selection.png") });
  await page.setViewportSize({ width: 1366, height: 900 });
  const away = await panAndZoom(page, true);
  await page.setViewportSize({ width: 390, height: 844 });
  expectSameCamera(await stableCamera(page), away, "offscreen selection during large shrink");
  expect(await handleIsOnMap(page)).toBe(false);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
});
