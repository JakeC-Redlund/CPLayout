import { expect, test } from "@playwright/test";
import { unobstructedMapPoint } from "./map-hit-point";
import { activateMapTool } from "./map-toolbar";
import { readWorkspace, workspaceStorageBytes } from "./workspace-fixtures";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { analyzePngPixels, encodeRgbaPng } from "../../tools/pngMetrics";
import { parseProjectDocument, projectLonLatToXy } from "../../packages/core/src";

const packageRoot = dirname(createRequire(resolve("packages/map-adapters/package.json")).resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string };
const assetRoot = `/maplibre/${version}`;

function expectedProjectedClick(
  camera: number[],
  canvas: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
  projectCrs: string,
) {
  const [centerLongitude, centerLatitude, zoom, bearing, pitch] = camera;
  expect(camera).toHaveLength(5);
  expect(bearing).toBeCloseTo(0, 8);
  expect(pitch).toBeCloseTo(0, 8);
  const radians = Math.PI / 180;
  const mercatorY = (latitude: number) => (1 - Math.asinh(Math.tan(latitude * radians)) / Math.PI) / 2;
  const worldSize = 512 * 2 ** zoom;
  const longitude = centerLongitude + (point.x - canvas.x - canvas.width / 2) * 360 / worldSize;
  const screenMercatorY = mercatorY(centerLatitude) + (point.y - canvas.y - canvas.height / 2) / worldSize;
  const latitude = Math.atan(Math.sinh(Math.PI * (1 - 2 * screenMercatorY))) / radians;
  return {
    projected: projectLonLatToXy({ longitude, latitude }, projectCrs),
    toleranceMeters: Math.max(2, 2 * 40_075_016.686 * Math.cos(latitude * radians) / worldSize),
  };
}

function expectDraftPointNearClick(
  draft: string,
  index: number,
  camera: number[],
  canvas: { x: number; y: number; width: number; height: number },
  point: { x: number; y: number },
  projectCrs: string,
): void {
  const row = draft.trim().split(/\r?\n/)[index];
  expect(row, `draft vertex ${index + 1}`).toBeDefined();
  const coordinates = row.split(",").map(value => Number(value.trim()));
  expect(coordinates).toHaveLength(2);
  expect(coordinates.every(Number.isFinite)).toBe(true);
  const expected = expectedProjectedClick(camera, canvas, point, projectCrs);
  const distance = Math.hypot(coordinates[0] - expected.projected.x, coordinates[1] - expected.projected.y);
  expect(distance, `draft vertex ${index + 1} must be near its canvas click in projected XY`)
    .toBeLessThanOrEqual(expected.toleranceMeters);
}

test("loaded map updates edited geometry while later raster requests remain pending", async ({ page, baseURL }, testInfo) => {
  const pixels = new Uint8Array(256 * 256 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([230, 235, 230, 255], offset);
  const tile = Buffer.from(encodeRgbaPng(256, 256, pixels));
  let holdTiles = false;
  let heldTiles = 0;
  let releaseTiles!: () => void;
  const gate = new Promise<void>(resolve => { releaseTiles = resolve; });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (!/\/USGSImagery(?:Only|Topo)\/MapServer\/tile\//.test(url.pathname)) return route.abort("blockedbyclient");
    if (holdTiles) { heldTiles++; await gate; }
    await route.fulfill({ contentType: "image/png", body: tile });
  });
  try {
    await page.goto("/");
    await page.getByTestId("command-menu-file").click();
    await page.getByTestId("command-file-sample-baseline-needs-review").click();
    await page.getByTestId("task-design").click();
    await activateMapTool(page, "edit");
    await page.getByTestId("browser-edit-select-boundary").click();
    const map = page.getByLabel("CPLayout MapLibre imagery workbench");
    const canvas = map.locator("canvas");
    await expect(map).toHaveAttribute("data-map-loaded", "true");
    const instance = await map.getAttribute("data-map-instance");
    expect(instance).not.toBeNull();
    holdTiles = true;
    // Zooming in can overscale cached max-zoom imagery; a coarser level needs new tiles.
    await map.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect.poll(() => heldTiles).toBeGreaterThan(0);
    let prior: string | null = null;
    let steady = 0;
    await expect.poll(async () => {
      const next = await map.getAttribute("data-map-camera");
      steady = next === prior && next !== null ? steady + 1 : 0;
      prior = next;
      return steady;
    }, { intervals: [250] }).toBeGreaterThanOrEqual(4);
    const camera = await map.getAttribute("data-map-camera");
    const before = await canvas.screenshot();
    expect(analyzePngPixels(before).grayVariance).toBeGreaterThan(20);
    const nudge = page.getByTestId("browser-edit-nudge-east");
    await nudge.scrollIntoViewIfNeeded();
    await nudge.click();
    await expect(page.getByTestId("browser-map-status-hud")).toContainText("Moved boundary vertex");
    await expect(map).toHaveAttribute("data-map-instance", instance!);
    await expect(map).toHaveAttribute("data-map-camera", camera!);
    await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
    const firstEdit = await canvas.screenshot();
    await nudge.click();
    await expect.poll(async () => (await canvas.screenshot()).equals(firstEdit)).toBe(false);
    await page.getByTestId("command-icon-undo").click();
    await expect.poll(async () => (await canvas.screenshot()).equals(firstEdit)).toBe(true);
    await expect(map).toHaveAttribute("data-map-camera", camera!);
    await expect(map).toHaveAttribute("data-map-instance", instance!);
    await expect(map).toHaveAttribute("data-map-loaded", "true");
    await page.screenshot({ path: testInfo.outputPath("pending-raster-current-geometry.png") });
    expect(errors).toEqual([]);
  } finally {
    releaseTiles();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("delayed imagery preserves a panned camera and a four-vertex boundary draft", async ({ page, baseURL }, testInfo) => {
  const pixels = new Uint8Array(256 * 256 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([20, 40, 60, 255], offset);
  const tile = Buffer.from(encodeRgbaPng(256, 256, pixels));
  let releaseImagery!: () => void;
  const imageryGate = new Promise<void>((resolve) => { releaseImagery = resolve; });
  let heldTiles = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (!/\/USGSImagery(?:Only|Topo)\/MapServer\/tile\//.test(url.pathname)) return route.abort("blockedbyclient");
    heldTiles += 1;
    await imageryGate;
    await route.fulfill({ contentType: "image/png", body: tile });
  });
  try {
    await page.goto("/");
    await page.getByTestId("command-menu-file").click();
    await page.getByTestId("command-file-sample-baseline-needs-review").click();
    await page.getByTestId("workspace-nav-files").click();
    await page.getByTestId("files-action-save-local").click();
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    const original = await workspaceStorageBytes(page);
    const documents = (await readWorkspace(page)).projectDocuments;
    expect(documents).toHaveLength(1);
    const projectCrs = parseProjectDocument(documents[0].document).projectCrs;
    await page.getByTestId("task-design").click();
    const openInspector = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ });
    if (await openInspector.first().isVisible()) await openInspector.first().click();
    await page.getByTestId("workflow-sidebar-tab-tools").click();
    await page.getByTestId("manual-design-source-boundary-map_click").click();
    const map = page.getByLabel("CPLayout MapLibre imagery workbench");
    const canvas = map.locator("canvas");
    await map.scrollIntoViewIfNeeded();
    await expect.poll(() => heldTiles).toBeGreaterThan(0);
    const box = await map.boundingBox();
    expect(box).not.toBeNull();
    const firstPoint = await unobstructedMapPoint(map,
      { x: box!.x + box!.width * 0.2, y: box!.y + box!.height * 0.25 }, "canvas");
    await expect(map).toHaveAttribute("data-map-loaded", "false");
    const initialCamera = await map.getAttribute("data-map-camera");
    expect(initialCamera).not.toBeNull();
    const panStart = await unobstructedMapPoint(map,
      { x: box!.x + box!.width * 0.4, y: box!.y + box!.height * 0.4 }, "canvas");
    const panEnd = await unobstructedMapPoint(map,
      { x: panStart.x + box!.width * 0.1, y: panStart.y + box!.height * 0.05 }, "canvas");
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panEnd.x, panEnd.y, { steps: 8 });
    await page.mouse.up();
    // Let pan inertia settle while tile responses remain held.
    let previousImage: Buffer | undefined;
    let stableFrames = 0;
    await expect.poll(async () => {
      const current = await canvas.screenshot();
      stableFrames = previousImage?.equals(current) ? stableFrames + 1 : 0;
      previousImage = current;
      return stableFrames;
    }, { intervals: [200], timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    const beforeTileMean = analyzePngPixels(previousImage!).grayMean;
    expect(beforeTileMean).toBeGreaterThan(150);
    const pannedCamera = await map.getAttribute("data-map-camera");
    expect(pannedCamera).not.toBeNull();
    expect(pannedCamera).not.toBe(initialCamera);
    const cameraValues = JSON.parse(pannedCamera!) as number[];
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    await page.mouse.click(firstPoint.x, firstPoint.y);
    await expect(page.getByTestId("manual-design-status")).toContainText("1 map-click boundary vertices staged");
    const boundaryInput = page.getByLabel("Draft boundary projected XY", { exact: true });
    await expect(boundaryInput).not.toHaveValue("");
    const firstVertex = await boundaryInput.inputValue();
    expectDraftPointNearClick(firstVertex, 0, cameraValues, canvasBox!, firstPoint, projectCrs);
    releaseImagery();
    await expect(map).toHaveAttribute("data-map-loaded", "true");
    // Pixel evidence confirms that the delayed tile responses have rendered.
    await expect.poll(async () => beforeTileMean - analyzePngPixels(await canvas.screenshot()).grayMean,
      { timeout: 20_000 }).toBeGreaterThan(15);
    await expect(map).toHaveAttribute("data-map-camera", pannedCamera!);
    await expect(boundaryInput).toHaveValue(firstVertex);
    const latePoints = [];
    for (const [x, y] of [[0.8, 0.25], [0.8, 0.45], [0.2, 0.45]]) {
      latePoints.push(await unobstructedMapPoint(map,
        { x: box!.x + box!.width * x, y: box!.y + box!.height * y }, "canvas"));
    }
    for (const point of latePoints) await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("manual-design-status")).toContainText("4 map-click boundary vertices staged");
    const fourVertices = await boundaryInput.inputValue();
    expect(fourVertices.split("\n")[0]).toBe(firstVertex);
    [firstPoint, ...latePoints].forEach((point, index) => expectDraftPointNearClick(fourVertices, index, cameraValues, canvasBox!, point, projectCrs));
    await page.mouse.dblclick(firstPoint.x, firstPoint.y);
    await expect(page.getByTestId("browser-map-status-hud")).toContainText("0 draft pts");
    await expect(page.getByTestId("manual-design-status")).toContainText("4 map-click boundary vertices staged");
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    expect(await workspaceStorageBytes(page)).toEqual(original);
    await page.screenshot({ path: testInfo.outputPath("delayed-imagery-boundary.png") });
  } finally {
    releaseImagery();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("offline MapLibre worker modules render and move projected layout overlays", async ({ page, request, baseURL }, testInfo) => {
  const pageErrors: string[] = [];
  const workers: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));

  for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
    const response = await request.get(`${assetRoot}/${name}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/javascript/);
    expect(createHash("sha256").update(await response.body()).digest("hex"))
      .toBe(createHash("sha256").update(readFileSync(join(packageRoot, "dist", name))).digest("hex"));
  }

  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await page.getByTestId("task-design").click();
  const canvas = page.locator(".maplibregl-canvas").first();
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveCSS("position", "absolute");
  await expect(page.getByTestId("browser-map-renderer-fallback")).toHaveCount(0);
  const sourceNotice = page.getByTestId("browser-map-runtime-error");
  await expect(sourceNotice).toHaveText("Map source unavailable. Check the connection or source settings.");
  const noticeBounds = await sourceNotice.boundingBox();
  const frameBounds = await page.getByTestId("browser-map-frame").boundingBox();
  expect(noticeBounds).not.toBeNull();
  expect(frameBounds).not.toBeNull();
  expect(noticeBounds!.x).toBeGreaterThanOrEqual(frameBounds!.x);
  expect(noticeBounds!.x + noticeBounds!.width).toBeLessThanOrEqual(frameBounds!.x + frameBounds!.width);
  expect(noticeBounds!.height).toBeLessThanOrEqual(48);
  await expect.poll(() => workers.filter((url) => url.endsWith(`${assetRoot}/maplibre-gl-worker.mjs`)).length).toBeGreaterThan(0);
  await expect(async () => {
    const metrics = analyzePngPixels(await canvas.screenshot());
    expect(metrics.width).toBeGreaterThan(200);
    expect(metrics.height).toBeGreaterThan(180);
    expect(metrics.grayVariance).toBeGreaterThan(20);
  }).toPass({ timeout: 20_000 });
  const before = await canvas.screenshot({ path: testInfo.outputPath("offline-layout-before.png") });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  const panStart = await unobstructedMapPoint(map,
    { x: bounds!.x + bounds!.width / 2, y: bounds!.y + bounds!.height / 2 }, "canvas");
  const panEnd = await unobstructedMapPoint(map,
    { x: panStart.x + 60, y: panStart.y + 25 }, "canvas");
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down();
  await page.mouse.move(panEnd.x, panEnd.y, { steps: 8 });
  await page.mouse.up();
  await expect(async () => expect((await canvas.screenshot()).equals(before)).toBe(false)).toPass();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits", { exact: true })).toBeVisible();
  await canvas.screenshot({ path: testInfo.outputPath("offline-layout-after-pan.png") });
  await page.screenshot({ path: testInfo.outputPath("offline-maplibre-workspace.png") });
  expect(pageErrors).toEqual([]);
});

test("MapLibre attribution rejects consecutive unsafe attributes", async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL!).origin) return route.abort("blockedbyclient");
    if (url.pathname === "/__maplibre-security-fixture") {
      return route.fulfill({ contentType: "text/html", body: '<!doctype html><div id="map" style="width:300px;height:300px"></div>' });
    }
    const module = url.pathname.slice("/__maplibre-test/".length);
    if (url.pathname.startsWith("/__maplibre-test/") && ["maplibre-gl.mjs", "maplibre-gl-shared.mjs"].includes(module)) {
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(join(packageRoot, "dist", module)) });
    }
    return route.continue();
  });
  await page.goto("/__maplibre-security-fixture");
  const result = await page.evaluate(async ({ moduleUrl, workerUrl }) => {
    const lib = await import(moduleUrl) as typeof import("maplibre-gl");
    lib.setWorkerUrl(workerUrl);
    const target = window as typeof window & { attributionExecuted?: boolean };
    const map = new lib.Map({ container: "map", attributionControl: false, style: { version: 8, sources: {}, layers: [] } });
    try {
      await new Promise<void>((resolve) => map.once("load", () => resolve()));
      map.addControl(new lib.AttributionControl({ compact: false, customAttribution: [
        '<details open onload="void 0" ontoggle="window.attributionExecuted=true"><summary>Local fixture</summary></details>',
        '<a onclick="void 0" href="javascript:window.attributionExecuted=true">Unsafe link</a>',
        '<a href="https://example.org/">Valid attribution</a>',
      ] }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const control = document.querySelector(".maplibregl-ctrl-attrib")!;
      const unsafe = [...control.querySelectorAll("*")].flatMap((element) => [...element.attributes]
        .filter((attribute) => /^on/i.test(attribute.name) || /^javascript:/i.test(attribute.value))
        .map((attribute) => attribute.name));
      return { unsafe, executed: target.attributionExecuted ?? false, retainedCredit: control.textContent?.includes("Valid attribution") };
    } finally {
      map.remove();
    }
  }, { moduleUrl: "/__maplibre-test/maplibre-gl.mjs", workerUrl: `${assetRoot}/maplibre-gl-worker.mjs` });
  expect(result).toEqual({ unsafe: [], executed: false, retainedCredit: true });
  expect(pageErrors).toEqual([]);
});
