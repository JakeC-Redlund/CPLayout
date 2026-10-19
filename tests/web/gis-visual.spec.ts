import { expect, test as authenticatedTest, type Page, type Locator } from "./authenticated-test";
import { projectLonLatToXy } from "../../packages/core/src/coordinates";
import { analyzePngPixels } from "../../tools/pngMetrics";
import { unobstructedMapPoint } from "./map-hit-point";
import { workspaceStorageBytes } from "./workspace-fixtures";
import { createGisEvidence, compareGisControls, GIS_PROOF_CASES, requireGisMapLibre } from "./gis-evidence";
import { GIS_FIXTURE, gisTools, installGisTileBoundary, openGisFixture, savedGisDraft, seedGisFixture } from "./gis-fixture";

const test = authenticatedTest.extend<{ gisEvidence: ReturnType<typeof createGisEvidence> }>({
  gisEvidence: async ({ page, baseURL }, use, info) => {
    const evidence = createGisEvidence(page, info, baseURL!);
    try { await use(evidence); } finally { await evidence.dispose(); }
  },
});

// This suite executes the default App, never the retired editor navigation.
// Chromium software WebGL is explicit and distinct from native/device proof.
test.use({ autoContinue: false, deviceScaleFactor: 1, locale: "en-US", timezoneId: "America/Denver",
  contextOptions: { reducedMotion: "reduce" }, launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }, actionTimeout: 15_000 });

async function save(page: Page) {
  await page.getByTestId("workspace-save").click();
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
}
async function clearPoint(page: Page, renderer: Locator, kind: "canvas" | "svg", x = .5, y = .45) {
  const box = await renderer.boundingBox(); if (!box) throw new Error("Actual GIS map bounds are unavailable.");
  return { box, point: await unobstructedMapPoint(renderer, { x: box.x + box.width * x, y: box.y + box.height * y }, kind) };
}
async function camera(renderer: Locator) {
  const raw = await renderer.getAttribute("data-map-camera-state"); if (!raw) throw new Error("Actual MapLibre camera diagnosis is absent.");
  return JSON.parse(raw) as { center: { longitude: number; latitude: number }; zoom: number; requestedKey: string; appliedKey: string; screen: { width: number; height: number } };
}
async function assertClickReadout(page: Page, renderer: Locator, hit: Awaited<ReturnType<typeof clearPoint>>) {
  const state = await camera(renderer), radians = Math.PI / 180, world = 512 * 2 ** state.zoom;
  const mx = state.center.longitude + (hit.point.x - hit.box.x - hit.box.width / 2) * 360 / world;
  const my = (1 - Math.asinh(Math.tan(state.center.latitude * radians)) / Math.PI) / 2 + (hit.point.y - hit.box.y - hit.box.height / 2) / world;
  const expected = projectLonLatToXy({ longitude: mx, latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) / radians }, GIS_FIXTURE.crs);
  await page.mouse.click(hit.point.x, hit.point.y);
  await expect.poll(async () => {
    const match = /(?:Center )?X ([\d.-]+) · Y ([\d.-]+)/.exec(await page.getByTestId("workspace-map-readout").innerText());
    return match ? Math.hypot(Number(match[1]) - expected.x, Number(match[2]) - expected.y) : Infinity;
  }).toBeLessThan(.003);
}
async function visibleControlBounds(locator: Locator) {
  const issues = await locator.evaluate(root => Array.from(root.querySelectorAll<HTMLElement>('[role="button"], button')).flatMap(node => {
    const box = node.getBoundingClientRect(); if (!box.width || !box.height) return [];
    const issues: string[] = [], label = node.getAttribute("aria-label") || node.textContent || "unnamed";
    if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) issues.push(`${label}: control exceeds viewport`);
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode; if (!text.textContent?.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      for (const line of Array.from(range.getClientRects())) if (line.left < box.left - 1 || line.right > box.right + 1 || line.top < box.top - 1 || line.bottom > box.bottom + 1) issues.push(`${label}: label exceeds control`);
    }
    return issues;
  }));
  expect(issues).toEqual([]);
}

test(GIS_PROOF_CASES[0].title, async ({ page, authenticatedService, baseURL, gisEvidence: evidence }) => {
  const tiles = await installGisTileBoundary(page, baseURL!);
  try {
    await seedGisFixture(authenticatedService); await openGisFixture(page); await gisTools(page, false);
    const renderer = await requireGisMapLibre(page), node = await renderer.elementHandle();
    expect(tiles.requests, "explicit synthetic connected preview must issue intercepted raster requests").toBeGreaterThan(0);
    if (!node) throw new Error("Expected retained actual MapLibre node.");
    const instance = await renderer.getAttribute("data-map-instance"); expect(instance).toBeTruthy();
    expect(analyzePngPixels(await renderer.locator("canvas").screenshot()).grayVariance, "saved synthetic boundary must paint into the actual GL canvas").toBeGreaterThan(1);
    const bytes = await workspaceStorageBytes(page), initialCamera = await camera(renderer);
    await assertClickReadout(page, renderer, await clearPoint(page, renderer, "canvas", .65, .4));
    expect(await workspaceStorageBytes(page)).toEqual(bytes);
    await page.getByTestId("workspace-map-zoom-in").click(); await requireGisMapLibre(page);
    expect((await camera(renderer)).zoom).toBeGreaterThan(initialCamera.zoom);
    await page.getByTestId("workspace-map-fit").click(); await requireGisMapLibre(page);
    const start = await clearPoint(page, renderer, "canvas");
    await page.mouse.move(start.point.x, start.point.y); await page.mouse.down();
    await page.mouse.move(start.point.x + 60, start.point.y + 20, { steps: 8 }); await page.mouse.up(); await requireGisMapLibre(page);
    const retainedCamera = await camera(renderer); expect(retainedCamera.center).not.toEqual(initialCamera.center);
    for (const mode of ["survey", "design"] as const) {
      await page.getByTestId(`workspace-mode-${mode}`).click(); await expect(page.getByTestId(`workspace-mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
      await requireGisMapLibre(page); expect(await node.evaluate(element => element === document.querySelector('[data-testid="workspace-map-web-renderer"]'))).toBe(true);
      expect(await renderer.getAttribute("data-map-instance")).toBe(instance); expect((await camera(renderer)).center).toEqual(retainedCamera.center);
    }
    await expect(page.getByTestId("workspace-mode-layout")).toBeDisabled();
    expect(await workspaceStorageBytes(page)).toEqual(bytes);
    expect((await savedGisDraft(page)).draft.fieldBoundary).toEqual(GIS_FIXTURE.boundary);
    await evidence.capture("actual-maplibre", GIS_PROOF_CASES[0].renderer, GIS_FIXTURE, { syntheticRasterRequests: tiles.requests });
    const beforeReload = (await savedGisDraft(page)).bytes; await openGisFixture(page); await gisTools(page, false); await requireGisMapLibre(page);
    expect((await savedGisDraft(page)).bytes).toBe(beforeReload);
    await evidence.capture("actual-maplibre-reopened", GIS_PROOF_CASES[0].renderer, GIS_FIXTURE);
    expect(tiles.unexpected).toEqual([]); expect(evidence.errors).toEqual([]);
  } finally { tiles.release(); }
});

test(GIS_PROOF_CASES[1].title, async ({ page, authenticatedService, baseURL, gisEvidence: evidence }) => {
  const tiles = await installGisTileBoundary(page, baseURL!);
  try {
    await seedGisFixture(authenticatedService); await openGisFixture(page); await gisTools(page, true);
    await page.getByTestId("design-task-drawing").click(); await page.getByTestId("drawing-tool-LineString").click(); await gisTools(page, false);
    const renderer = await requireGisMapLibre(page), instance = await renderer.getAttribute("data-map-instance");
    tiles.hold(); await page.getByTestId("workspace-map-zoom-out").click(); await expect.poll(() => tiles.held).toBeGreaterThan(0);
    await requireGisMapLibre(page, false);
    for (const [x, y] of [[.35, .38], [.65, .52]]) await assertClickReadout(page, renderer, await clearPoint(page, renderer, "canvas", x, y));
    await save(page); const drawn = (await savedGisDraft(page)).draft, capture = drawn.drawingWorkflow!.captures[0];
    expect(capture.vertices).toHaveLength(2); expect(capture.stage).toBe("drawing"); expect(drawn.fieldBoundary).toEqual(GIS_FIXTURE.boundary);
    await page.getByTestId("workspace-undo").click(); await save(page);
    expect((await savedGisDraft(page)).draft.drawingWorkflow!.captures[0].vertices).toEqual(capture.vertices.slice(0, 1));
    await page.getByTestId("workspace-redo").click(); await save(page);
    expect((await savedGisDraft(page)).draft.drawingWorkflow!.captures[0].vertices).toEqual(capture.vertices);
    expect(await renderer.getAttribute("data-map-instance")).toBe(instance);
    await evidence.capture("delayed-tiles-editable", GIS_PROOF_CASES[1].renderer, GIS_FIXTURE, { heldRequests: tiles.held, vertices: capture.vertices });
    tiles.release(); await requireGisMapLibre(page);
    expect((await savedGisDraft(page)).draft.fieldBoundary).toEqual(GIS_FIXTURE.boundary);
    expect(tiles.unexpected).toEqual([]); expect(evidence.errors).toEqual([]);
  } finally { tiles.release(); }
});

test(GIS_PROOF_CASES[2].title, async ({ page, authenticatedService, baseURL, gisEvidence: evidence }) => {
  const tiles = await installGisTileBoundary(page, baseURL!);
  try {
    await seedGisFixture(authenticatedService); await openGisFixture(page); await gisTools(page, true);
    await page.getByTestId("design-task-drawing").click(); await page.getByTestId("drawing-tool-LineString").click(); await gisTools(page, false);
    const renderer = await requireGisMapLibre(page), surface = await page.getByTestId("workspace-map-surface").elementHandle();
    if (!surface) throw new Error("Expected actual shared map surface.");
    await assertClickReadout(page, renderer, await clearPoint(page, renderer, "canvas", .4, .4)); await save(page);
    const before = await savedGisDraft(page), bytes = await workspaceStorageBytes(page), readout = await page.getByTestId("workspace-map-readout").innerText();
    await renderer.locator("canvas").dispatchEvent("webglcontextlost", { cancelable: true });
    const svg = page.getByTestId("workspace-map-svg-renderer"); await expect(svg).toBeVisible(); await expect(renderer).toHaveCount(0);
    await expect(page.getByTestId("workspace-map-fallback-status")).toHaveText("Web map graphics were interrupted. Projected XY remains available.");
    await expect(page.getByRole("button", { name: "Retry web map", exact: true })).toBeVisible();
    expect(await surface.evaluate(node => node === document.querySelector('[data-testid="workspace-map-surface"]'))).toBe(true);
    await expect.poll(() => page.getByTestId("workspace-map-readout").innerText()).toBe(readout); expect(await workspaceStorageBytes(page)).toEqual(bytes);
    await gisTools(page, true); await expect(page.getByTestId("workspace-drawing-panel")).toContainText("1 points");
    await page.getByTestId("drawing-finish").click(); await expect(page.getByTestId("workspace-drawing-panel").getByRole("alert").filter({ hasText: /line.*(?:two|2)|at least.*(?:two|2)/i })).toBeVisible();
    await save(page); expect((await savedGisDraft(page)).draft).toEqual(before.draft);
    await gisTools(page, false); await evidence.capture("induced-svg-recovery", GIS_PROOF_CASES[2].renderer, GIS_FIXTURE, { sourceBytesUnchanged: (await savedGisDraft(page)).bytes === before.bytes });
    await page.getByRole("button", { name: "Retry web map", exact: true }).click(); await requireGisMapLibre(page);
    expect((await savedGisDraft(page)).draft.drawingWorkflow!.captures).toEqual(before.draft.drawingWorkflow!.captures);
    expect(tiles.unexpected).toEqual([]); expect(evidence.errors).toEqual([]);
  } finally { tiles.release(); }
});

test(GIS_PROOF_CASES[3].title, async ({ page, authenticatedService, baseURL, gisEvidence: evidence }, info) => {
  const tiles = await installGisTileBoundary(page, baseURL!);
  try {
    await seedGisFixture(authenticatedService); await openGisFixture(page); await gisTools(page, false);
    const bytes = await workspaceStorageBytes(page), controls = page.getByTestId("workspace-common-controls");
    await expect(page.getByTestId("workspace-map-surface")).toBeVisible(); await visibleControlBounds(controls);
    await page.getByTestId("workspace-map-readout").focus(); await compareGisControls(controls, info, "gis-common-controls");
    await page.getByTestId("workspace-mode-design").focus(); await page.keyboard.press("Tab"); await expect(page.getByTestId("workspace-mode-survey")).toBeFocused();
    await page.keyboard.press("Tab"); await expect(page.getByTestId("workspace-save")).toBeFocused();
    await page.keyboard.press("Tab"); const file = page.getByTestId("command-menu-workspace-file"); await expect(file).toBeFocused();
    await page.keyboard.press("Enter"); await expect(file).toHaveAttribute("aria-expanded", "true");
    const panel = page.getByTestId("command-menu-workspace-file-panel"); await expect(panel).toBeVisible();
    const item = page.getByRole("menuitem", { name: "Units, map & layer preferences", exact: true }); await item.focus(); await page.keyboard.press("Escape");
    await expect(panel).toBeHidden(); await expect(file).toBeFocused();
    await page.keyboard.press("Enter"); await item.scrollIntoViewIfNeeded(); await item.click();
    const measurements = page.getByRole("combobox", { name: "Measurements", exact: true }); await expect(measurements).toBeVisible();
    // Escape in the preferences modal must close that owner only; no design action.
    await measurements.focus(); await page.keyboard.press("Escape"); await expect(measurements).toBeHidden();
    expect(await workspaceStorageBytes(page)).toEqual(bytes);
    await evidence.capture("gis-controls-keyboard", GIS_PROOF_CASES[3].renderer, GIS_FIXTURE); expect(tiles.unexpected).toEqual([]); expect(evidence.errors).toEqual([]);
  } finally { tiles.release(); }
});

test(GIS_PROOF_CASES[4].title, async ({ page, authenticatedService, baseURL, gisEvidence: evidence }, info) => {
  const tiles = await installGisTileBoundary(page, baseURL!);
  try {
    await seedGisFixture(authenticatedService); await openGisFixture(page); await gisTools(page, true);
    await page.getByTestId("design-task-drawing").click(); await page.getByTestId("drawing-tool-Polygon").click(); await gisTools(page, false);
    const initialRenderer = await page.getByTestId("workspace-map-web-renderer").isVisible() ? await requireGisMapLibre(page) : page.getByTestId("workspace-map-svg-renderer");
    const initialKind = await initialRenderer.getAttribute("data-testid") === "workspace-map-web-renderer" ? "canvas" : "svg";
    const first = await clearPoint(page, initialRenderer, initialKind);
    await page.mouse.click(first.point.x, first.point.y); await save(page);
    const pending = await savedGisDraft(page); expect(pending.draft.drawingWorkflow!.captures).toHaveLength(1);
    expect(pending.draft.drawingWorkflow!.captures[0].vertices).toHaveLength(1);
    const bytes = await workspaceStorageBytes(page), surface = await page.getByTestId("workspace-map-surface").elementHandle();
    if (!surface) throw new Error("Expected retained GIS map surface.");
    for (const viewport of [{ width: 390, height: 500 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport); await gisTools(page, true);
      await page.getByTestId("drawing-remove-last").scrollIntoViewIfNeeded(); await expect(page.getByTestId("drawing-remove-last")).toBeEnabled();
      await gisTools(page, false); await expect(page.getByTestId("workspace-map-surface")).toBeVisible();
      const controls = page.getByTestId("workspace-common-controls"); await visibleControlBounds(controls);
      await page.getByTestId("workspace-map-readout").focus(); await compareGisControls(controls, info, `gis-controls-${viewport.width}x${viewport.height}`);
      const renderer = await page.getByTestId("workspace-map-web-renderer").isVisible() ? page.getByTestId("workspace-map-web-renderer") : page.getByTestId("workspace-map-svg-renderer");
      const kind = await renderer.getAttribute("data-testid") === "workspace-map-web-renderer" ? "canvas" : "svg";
      const hit = await clearPoint(page, renderer, kind); expect(hit.box.width).toBeGreaterThanOrEqual(320); expect(hit.box.height).toBeGreaterThanOrEqual(120);
      // Require a usable drawing rectangle rather than an edge sliver. Its
      // complete grid and every CSS pixel of its center stroke are hit-tested.
      const clearance = await unobstructedDrawingClearance(renderer, kind, 80, 120);
      expect(await surface.evaluate(node => node === document.querySelector('[data-testid="workspace-map-surface"]'))).toBe(true);
      expect(await workspaceStorageBytes(page)).toEqual(bytes);
      expect((await savedGisDraft(page)).bytes).toBe(pending.bytes);
      await evidence.capture(`short-${viewport.width}x${viewport.height}`, GIS_PROOF_CASES[4].renderer, GIS_FIXTURE, {
        hitPoint: hit.point, unobstructedStroke: clearance.stroke, unobstructedDrawingRectangle: clearance.rectangle, viewport });
    }
    expect((await savedGisDraft(page)).draft.fieldBoundary).toEqual(GIS_FIXTURE.boundary); expect(tiles.unexpected).toEqual([]); expect(evidence.errors).toEqual([]);
  } finally { tiles.release(); }
});

async function unobstructedDrawingClearance(renderer: Locator, kind: "canvas" | "svg", width: number, height: number) {
  const clearance = await renderer.evaluate((element, input) => {
    const box = element.getBoundingClientRect(), gridStep = 8;
    const isMap = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return (input.kind === "canvas" ? hit instanceof HTMLCanvasElement : hit instanceof SVGElement) && element.contains(hit);
    };
    const gridOffsets = (length: number) => {
      const values = [0]; for (let value = gridStep; value < length; value += gridStep) values.push(value);
      values.push(length); return values;
    };
    const gridX = gridOffsets(input.width), gridY = gridOffsets(input.height), lefts: number[] = [];
    for (let left = Math.ceil(box.left + 1); left + input.width <= box.right - 1; left += 4) lefts.push(left);
    lefts.sort((a, b) => Math.abs(a + input.width / 2 - box.left - box.width / 2) - Math.abs(b + input.width / 2 - box.left - box.width / 2));
    // Visit every possible CSS-pixel top: a valid rectangle can end just above
    // the readout, so a coarser y stride could falsely reject real clear space.
    for (let top = Math.ceil(box.top + 1); top + input.height <= box.bottom - 1; top++) for (const left of lefts) {
      const right = left + input.width, bottom = top + input.height;
      if (![isMap(left, top), isMap(right, top), isMap(left, bottom), isMap(right, bottom)].every(Boolean)) continue;
      if (!gridY.every(dy => gridX.every(dx => isMap(left + dx, top + dy)))) continue;
      const centerX = left + input.width / 2; let strokeClear = true;
      for (let offset = 0; offset <= input.height; offset++) if (!isMap(centerX, top + offset)) { strokeClear = false; break; }
      if (!strokeClear) continue;
      return { rectangle: { x: left, y: top, width: input.width, height: input.height, sampleStepCssPixels: gridStep,
        checkedPoints: gridX.length * gridY.length, includesAllEdges: true, renderer: input.kind },
      stroke: { start: { x: centerX, y: top }, end: { x: centerX, y: bottom }, height: input.height,
        sampleStepCssPixels: 1, checkedPoints: input.height + 1, renderer: input.kind } };
    }
    return null;
  }, { kind, width, height });
  expect(clearance, `an actual ${width}x${height}px drawing rectangle must pass its complete grid and every pixel of its vertical stroke`).not.toBeNull();
  if (!clearance) throw new Error("The actual map has no unobstructed drawing rectangle of the required size.");
  return clearance;
}
