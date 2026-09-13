import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { analyzePngPixels, encodeRgbaPng } from "../../tools/pngMetrics";

const packageRoot = dirname(createRequire(resolve("packages/map-adapters/package.json")).resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string };
const assetRoot = `/maplibre/${version}`;

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
    const original = await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"));
    expect(original).not.toBeNull();
    await page.getByTestId("workspace-nav-map").click();
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
    const points = [[0.2, 0.25], [0.8, 0.25], [0.8, 0.55], [0.2, 0.55]]
      .map(([x, y]) => ({ x: box!.x + box!.width * x, y: box!.y + box!.height * y }));
    await expect(map).toHaveAttribute("data-map-loaded", "false");
    const initialCamera = await map.getAttribute("data-map-camera");
    expect(initialCamera).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.4, box!.y + box!.height * 0.4);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.45, { steps: 8 });
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
    expect(analyzePngPixels(previousImage!).grayMean).toBeGreaterThan(150);
    const pannedCamera = await map.getAttribute("data-map-camera");
    expect(pannedCamera).not.toBeNull();
    expect(pannedCamera).not.toBe(initialCamera);
    await page.mouse.click(points[0].x, points[0].y);
    await expect(page.getByTestId("manual-design-status")).toContainText("1 map-click boundary vertices staged");
    const boundaryInput = page.getByLabel("Draft boundary projected XY", { exact: true });
    await expect(boundaryInput).not.toHaveValue("");
    const firstVertex = await boundaryInput.inputValue();
    releaseImagery();
    await expect(map).toHaveAttribute("data-map-loaded", "true");
    // Pixel evidence confirms that the delayed tile responses have rendered.
    await expect.poll(async () => analyzePngPixels(await canvas.screenshot()).grayMean,
      { timeout: 20_000 }).toBeLessThan(120);
    await expect(map).toHaveAttribute("data-map-camera", pannedCamera!);
    await expect(boundaryInput).toHaveValue(firstVertex);
    for (const point of points.slice(1)) await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("manual-design-status")).toContainText("4 map-click boundary vertices staged");
    expect((await boundaryInput.inputValue()).split("\n")[0]).toBe(firstVertex);
    await page.mouse.dblclick(points[0].x, points[0].y);
    await expect(page.getByTestId("browser-map-status-hud")).toContainText("0 draft pts");
    await expect(page.getByTestId("manual-design-status")).toContainText("4 map-click boundary vertices staged");
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    expect(await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).toBe(original);
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
  await page.getByTestId("workspace-nav-map").click();
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
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width / 2 + 60, bounds!.y + bounds!.height / 2 + 25, { steps: 8 });
  await page.mouse.up();
  await expect(async () => expect((await canvas.screenshot()).equals(before)).toBe(false)).toPass();
  await expect(page.getByTestId("project-save-state").getByText("Saved", { exact: true })).toBeVisible();
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
