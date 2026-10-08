import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { defaultAppSettings, parseProjectDocument, projectXyToLonLat, type XY } from "../../packages/core/src";
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

async function settleSelectionLayout(page: Page) {
  // Advisory completion may resize the canvas and dock while preserving the
  // camera. Explicit selection must use the completed presentation as its frame.
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60_000 });
  await stableCamera(page);
  let previous: string | null = null;
  let unchanged = 0;
  await expect.poll(async () => {
    const bounds = await page.getByLabel(mapLabel).evaluate(element => {
      const canvas = element.querySelector("canvas")?.getBoundingClientRect();
      const dock = element.parentElement?.querySelector('[data-testid="browser-map-bottom-dock"]')?.getBoundingClientRect();
      if (!canvas || !dock || canvas.width <= 0 || canvas.height <= 0 || dock.width <= 0 || dock.height <= 0) return null;
      return [canvas.x, canvas.y, canvas.width, canvas.height, dock.x, dock.y, dock.width, dock.height];
    });
    const current = bounds ? JSON.stringify(bounds) : null;
    unchanged = current !== null && current === previous ? unchanged + 1 : 0;
    previous = current;
    return unchanged;
  }, { intervals: [200], message: "completed advisory canvas and dock layout must settle before explicit selection" }).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("");
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
  await settleSelectionLayout(page);
  await page.getByTestId("browser-edit-select-boundary").click();
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", /boundary vertex 1 of/);
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

async function offscreenPointThatNudgesFullyIntoCanvas(page: Page, point: XY, projectCrs: string) {
  // The preceding Undo/save schedules a fresh advisory result; settle it before
  // deliberate setup zoom, reselect and pan instead of granting data reflow intent.
  await settleSelectionLayout(page);
  const original = projectXyToLonLat(point, projectCrs);
  const moved = projectXyToLonLat({ ...point, x: point.x + nudgeMeters }, projectCrs);
  const mercatorY = (latitude: number) => (1 - Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) / Math.PI) / 2;
  let camera = await stableCamera(page);
  let shift = { x: 0, y: 0 };
  for (let step = 0; step < 10; step += 1) {
    const worldSize = 512 * 2 ** camera[2];
    shift = { x: (moved.longitude - original.longitude) * worldSize / 360,
      y: (mercatorY(moved.latitude) - mercatorY(original.latitude)) * worldSize };
    if (shift.x > 60) break;
    await page.locator(".maplibregl-ctrl-zoom-in").click();
    camera = await stableCamera(page);
  }
  expect(shift.x, "east nudge must move a completely offscreen handle fully into the canvas").toBeGreaterThan(60);
  expect(camera[3]).toBe(0);
  expect(camera[4]).toBe(0);
  // Explicit setup selection is allowed; the later edit and passive layout are not.
  await settleSelectionLayout(page);
  await page.getByTestId("browser-edit-select-boundary").click();
  await stableCamera(page);
  const map = page.getByLabel(mapLabel);
  const canvas = map.locator("canvas");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const mapBox = (await map.boundingBox())!;
    const dock = (await page.getByTestId("browser-map-bottom-dock").boundingBox())!;
    const handle = (await page.getByTestId("browser-edit-drag-handle").boundingBox())!;
    const center = { x: handle.x + handle.width / 2 - mapBox.x, y: handle.y + handle.height / 2 - mapBox.y };
    const predicted = { x: center.x + shift.x, y: center.y + shift.y };
    if (predicted.x > 22 && predicted.x < 26 && predicted.y - 22 >= 0
      && predicted.y + 22 <= Math.min(mapBox.height, dock.y - mapBox.y)) break;
    const target = { x: 23 - shift.x, y: Math.max(70, (dock.y - mapBox.y) / 2) - shift.y };
    const start = await canvas.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      for (const y of [0.3, 0.45, 0.6]) for (const x of [0.5, 0.65, 0.8]) {
        const point = { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y };
        if (document.elementFromPoint(point.x, point.y) === element) return point;
      }
      throw new Error("No unobstructed canvas point for deliberate setup pan.");
    });
    const beforePanReceipt = await map.getAttribute("data-map-camera");
    expect(beforePanReceipt).not.toBeNull();
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + target.x - center.x, start.y + target.y - center.y, { steps: 12 });
    // Release after the inertia window so the setup has an exact measured endpoint.
    await page.waitForTimeout(350);
    await page.mouse.up();
    await expect.poll(async () => {
      const receipt = await map.getAttribute("data-map-camera");
      return receipt !== null && receipt !== beforePanReceipt;
    }, {
      intervals: [200], message: "public setup pan must publish a changed camera receipt",
    }).toBe(true);
    await stableCamera(page);
    await expect.poll(async () => {
      const receipt = JSON.parse((await map.getAttribute("data-map-camera"))!) as Camera;
      const actualCanvas = (await canvas.boundingBox())!;
      const actualHandle = (await page.getByTestId("browser-edit-drag-handle").boundingBox())!;
      const worldSize = 512 * 2 ** receipt[2];
      const projected = { x: actualCanvas.width / 2 + (original.longitude - receipt[0]) * worldSize / 360,
        y: actualCanvas.height / 2 + (mercatorY(original.latitude) - mercatorY(receipt[1])) * worldSize };
      const observed = { x: actualHandle.x + actualHandle.width / 2 - actualCanvas.x,
        y: actualHandle.y + actualHandle.height / 2 - actualCanvas.y };
      return Math.max(Math.abs(projected.x - observed.x), Math.abs(projected.y - observed.y));
    }, { intervals: [200], message: "setup receipt must project the canonical point to its actual marker" })
      // CSS marker rounding is at most half a pixel per axis; camera precision
      // remains the independent eight-digit preservation assertion below.
      .toBeLessThanOrEqual(0.51);
  }
  const mapBox = (await map.boundingBox())!;
  const dock = (await page.getByTestId("browser-map-bottom-dock").boundingBox())!;
  const handle = (await page.getByTestId("browser-edit-drag-handle").boundingBox())!;
  expect(handle.x + handle.width, "entire handle must start left of the canvas").toBeLessThan(mapBox.x);
  const predicted = { x: handle.x + handle.width / 2 - mapBox.x + shift.x,
    y: handle.y + handle.height / 2 - mapBox.y + shift.y };
  expect(predicted.x, "edited center must put the full44 handle inside the canvas").toBeGreaterThan(22);
  expect(predicted.x, "edited center must remain outside the margin26 reveal rectangle").toBeLessThan(26);
  expect(predicted.y - 22, "edited full44 handle must clear the canvas top").toBeGreaterThanOrEqual(0);
  expect(predicted.y + 22, "edited full44 handle must clear both the canvas bottom and the dock")
    .toBeLessThanOrEqual(Math.min(mapBox.height, dock.y - mapBox.y));
  return stableCamera(page);
}

async function reflowDock(page: Page, additionalHeight = 1) {
  const dock = page.getByTestId("browser-map-bottom-dock");
  const before = (await dock.boundingBox())!.height;
  await dock.evaluate((element, additionalHeight) => {
    const view = element as HTMLElement;
    view.style.paddingTop = `${Number.parseFloat(getComputedStyle(view).paddingTop) + additionalHeight}px`;
  }, additionalHeight);
  await expect.poll(async () => (await dock.boundingBox())!.height, { message: "passive dock layout must actually change" }).toBeGreaterThan(before + additionalHeight - 0.5);
}

async function reflowDockAcrossSelectedPoint(page: Page) {
  const map = (await page.getByLabel(mapLabel).boundingBox())!;
  const handle = (await page.getByTestId("browser-edit-drag-handle").boundingBox())!;
  const dock = (await page.getByTestId("browser-map-bottom-dock").boundingBox())!;
  // Require a usable canvas but put the selected point within the reveal margin,
  // so any stale resize authorization would issue a measurable camera command.
  const desiredHeight = map.y + map.height - handle.y - handle.height / 2 - 15;
  expect(desiredHeight, "fixture must enlarge the dock beyond the selected point's clearance").toBeGreaterThan(dock.height);
  await reflowDock(page, desiredHeight - dock.height);
  const usable = await page.getByLabel(mapLabel).evaluate(element => {
    const canvas = element.querySelector("canvas")!.getBoundingClientRect();
    const panel = element.parentElement!;
    const compact = window.innerWidth < 760;
    const toolHud = panel.querySelector('[data-testid="browser-map-tool-hud"]')?.getBoundingClientRect();
    const externalHud = !toolHud;
    const dock = panel.querySelector('[data-testid="browser-map-bottom-dock"]')!.getBoundingClientRect();
    const sheet = compact && externalHud ? document.querySelector('[data-testid="right-workflow-sidebar"]') : null;
    const obstructions = [panel.querySelector('[data-testid="browser-map-status-hud"]'),
      sheet && getComputedStyle(sheet).position === "absolute" ? sheet : null];
    let obstructionInset = 0;
    for (const obstruction of obstructions) {
      if (!obstruction) continue;
      const rect = obstruction.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.top < canvas.bottom && rect.bottom > canvas.top) {
        obstructionInset = Math.max(obstructionInset, canvas.bottom - rect.top + 16);
      }
    }
    const selected = panel.querySelector('[data-testid="browser-edit-drag-handle"]')!.getBoundingClientRect();
    return { width: canvas.width, height: canvas.height,
      left: !externalHud && compact ? Math.max(0, toolHud.right - canvas.left) : 0,
      top: !externalHud && !compact ? Math.max(0, toolHud.bottom - canvas.top) : 0,
      right: 96, bottom: Math.max(dock.height + 8, obstructionInset),
      selectedY: selected.y + selected.height / 2 - canvas.y };
  });
  expect(usable.width, "oversized dock fixture must pass the production horizontal usable-viewport gate")
    .toBeGreaterThan(usable.left + usable.right + 52);
  expect(usable.height, "oversized dock fixture must pass the production vertical usable-viewport gate")
    .toBeGreaterThan(usable.top + usable.bottom + 52);
  expect(usable.selectedY, "selected point must cross the reveal margin while the viewport remains usable")
    .toBeGreaterThan(usable.height - usable.bottom - 26 + 0.5);
}

async function rescuePreviouslyVisibleSelection(page: Page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await openSample(page);
  const original = await saveProject(page);
  await page.getByTestId("task-design").click();
  await selectBoundary(page);
  await expect.poll(() => handleIsOnMap(page)).toBe(true);
  const selection = (await page.getByTestId("browser-edit-drag-handle").getAttribute("aria-label"))!;
  const stored = await workspaceStorageBytes(page);
  const beforeShrink = await stableCamera(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => handleIsOnMap(page), { message: "setup must genuinely rescue a previously visible vertex" }).toBe(true);
  const rescued = await stableCamera(page);
  expect(rescued, "setup shrink must actually move the camera to rescue the selection").not.toEqual(beforeShrink);
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", selection);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  return { original, stored, selection, rescued };
}

test("offscreen accepted vertex edit and undo/redo preserve camera and canonical XY", async ({ page }, testInfo) => {
  await page.goto("/");
  await openSample(page);
  const original = await saveProject(page);
  await page.getByTestId("task-design").click();
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

  // Keep the original fully offscreen edit above, then exercise the harder
  // accepted edit that becomes fully visible and used to authorize a 3px pan.
  await page.getByTestId("command-icon-undo").click();
  expect((await saveProject(page)).fieldBoundary).toEqual(original.fieldBoundary);
  const storedBeforeSetup = await workspaceStorageBytes(page);
  const edgeCamera = await offscreenPointThatNudgesFullyIntoCanvas(page, original.fieldBoundary[0], original.projectCrs);
  expect(await workspaceStorageBytes(page)).toEqual(storedBeforeSetup);
  await page.getByTestId("browser-edit-nudge-east").click();
  await expect(page.getByTestId("browser-map-action-status")).toContainText("Moved boundary vertex 1");
  expect((await saveProject(page)).fieldBoundary).toEqual(moved);
  await expectPreserved(page, edgeCamera, instance, "fully-visible-accepted-edit", testInfo);
  expect(await handleIsOnMap(page), "accepted edit must itself put the full handle into the canvas").toBe(true);
  const savedMoved = await workspaceStorageBytes(page);
  await reflowDock(page);
  await expectPreserved(page, edgeCamera, instance, "fully-visible-passive-dock", testInfo);
  expect(await workspaceStorageBytes(page)).toEqual(savedMoved);
  await page.getByTestId("command-icon-undo").click();
  expect((await saveProject(page)).fieldBoundary).toEqual(original.fieldBoundary);
  await reflowDock(page);
  await expectPreserved(page, edgeCamera, instance, "fully-visible-undo", testInfo);
  expect(await handleIsOnMap(page)).toBe(false);
  await page.getByTestId("command-icon-redo").click();
  expect((await saveProject(page)).fieldBoundary).toEqual(moved);
  expect(await handleIsOnMap(page)).toBe(true);
  const savedRedo = await workspaceStorageBytes(page);
  await reflowDock(page);
  await expectPreserved(page, edgeCamera, instance, "fully-visible-redo", testInfo);
  expect(await workspaceStorageBytes(page)).toEqual(savedRedo);

});

test("explicit same-vertex reselect reveals the panned-offscreen selection without editing XY", async ({ page }) => {
  await page.goto("/");
  await openSample(page);
  await saveProject(page);
  await page.getByTestId("task-design").click();
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
  await page.getByTestId("task-design").click();
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
  await page.getByTestId("task-design").click();
  await closePanels(page);
  // Establish the reference fit at the same panel dimensions as the later reopen.
  await openSample(page);
  await page.getByTestId("task-design").click();
  const fit = await stableCamera(page);
  const away = await panAndZoom(page);
  const instance = await page.getByLabel(mapLabel).getAttribute("data-map-instance");
  const oldCanvas = await page.getByLabel(mapLabel).locator("canvas").elementHandle();
  expect(oldCanvas).not.toBeNull();
  await openSample(page);
  await page.getByTestId("task-design").click();
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
  await page.getByTestId("task-design").click();
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
  await page.getByTestId("task-design").click();
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

test("Fit replaces resize rescue intent before a later passive dock reflow", async ({ page }, testInfo) => {
  const { original, stored, selection, rescued } = await rescuePreviouslyVisibleSelection(page);
  const instance = await page.getByLabel(mapLabel).getAttribute("data-map-instance");
  await page.getByTestId("browser-map-fit-field").click();
  const fitted = await stableCamera(page);
  expect(fitted, "Fit must actually replace the rescued camera").not.toEqual(rescued);
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", selection);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await reflowDockAcrossSelectedPoint(page);
  await expectPreserved(page, fitted, instance, "rescue-fit-passive-dock", testInfo);
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", selection);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect(parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary).toEqual(original.fieldBoundary);
});

test("same-frame imagery reconstruction retires its previous renderer's resize rescue intent", async ({ page }, testInfo) => {
  const { original, stored, selection } = await rescuePreviouslyVisibleSelection(page);
  const open = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ }).first();
  if (await open.isVisible()) await open.click();
  const tools = page.getByTestId("workflow-sidebar-tab-tools").first();
  if (await tools.isVisible()) await tools.click();
  await page.getByTestId("inspector-scroll").getByTestId("design-action-layers").click();
  await expect(page.getByTestId("places-layers-summary")).toBeVisible();
  const camera = await stableCamera(page);
  const map = page.getByLabel(mapLabel);
  const instance = await map.getAttribute("data-map-instance");
  const oldCanvas = await map.locator("canvas").elementHandle();
  expect(oldCanvas).not.toBeNull();
  await page.getByRole("button", { name: "Aerial Off", exact: true }).click();
  await page.getByTestId("design-console-close").click();
  await expect.poll(() => oldCanvas!.evaluate(element => element.isConnected), { message: "replacement must retire the actual old renderer" }).toBe(false);
  const restored = await stableCamera(page);
  expectSameCamera(restored, camera, "rescued selection during same-frame imagery reconstruction");
  const nextInstance = await map.getAttribute("data-map-instance");
  expect(Number(nextInstance), "reconstruction must have a new renderer identity").toBeGreaterThan(Number(instance));
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", selection);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await reflowDockAcrossSelectedPoint(page);
  await expectPreserved(page, camera, nextInstance, "rescue-reconstruction-passive-dock", testInfo);
  await expect(page.getByTestId("browser-edit-drag-handle")).toHaveAttribute("aria-label", selection);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect(parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary).toEqual(original.fieldBoundary);
  await testInfo.attach("rescued-selection-renderer-retirement.json", {
    body: JSON.stringify({ camera, restored, instance, nextInstance, selection }), contentType: "application/json",
  });
});
