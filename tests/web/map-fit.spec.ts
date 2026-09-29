import { expect, test, type Locator, type Page } from "@playwright/test";
import { parseProjectDocument, projectXyToLonLat, type PivotProject, type XY } from "../../packages/core/src";
import { analyzePngPixels, encodeRgbaPng } from "../../tools/pngMetrics";
import { readWorkspace, workspaceStorageBytes } from "./workspace-fixtures";
import { activateMapTool } from "./map-toolbar";

type Renderer = "browser" | "svg";
type Rect = { x: number; y: number; width: number; height: number };
const mapLabel = "CPLayout MapLibre imagery workbench";
const raster = new Uint8Array(256 * 256 * 4);
for (let offset = 0; offset < raster.length; offset += 4) raster.set([230, 235, 230, 255], offset);
const tile = Buffer.from(encodeRgbaPng(256, 256, raster));

function surface(page: Page, renderer: Renderer): Locator {
  return renderer === "browser" ? page.getByLabel(mapLabel) : page.getByTestId("layout-map-svg");
}

async function box(locator: Locator): Promise<Rect> {
  await expect(locator).toBeVisible();
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  expect(result!.width).toBeGreaterThan(0);
  expect(result!.height).toBeGreaterThan(0);
  return result!;
}

async function closePanels(page: Page) {
  for (const name of [/Collapse (map inspector|right workflow sidebar)/, /Collapse project drawer/]) {
    const control = page.getByRole("button", { name }).first();
    if (await control.isVisible()) await control.click();
  }
}

async function openTools(page: Page) {
  const open = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ }).first();
  if (await open.isVisible()) await open.click();
  await page.getByTestId("workflow-sidebar-tab-tools").first().click();
}

async function saveProject(page: Page): Promise<PivotProject> {
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const documents = (await readWorkspace(page)).projectDocuments;
  expect(documents).toHaveLength(1);
  return parseProjectDocument(documents[0].document);
}

async function useSvg(page: Page) {
  await page.getByTestId("browser-map-use-svg").click();
  await expect(page.getByTestId("browser-map-renderer-fallback")).toBeVisible();
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
}

async function setup(page: Page, baseURL: string | undefined, renderer: Renderer) {
  expect(baseURL).toBeTruthy();
  let workerFailures = 0;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) {
      if (renderer === "svg" && /\/maplibre\/[^/]+\/maplibre-gl-shared\.mjs$/.test(url.pathname)) {
        workerFailures++;
        return route.fulfill({ status: 404, contentType: "text/html", body: "Missing worker fixture" });
      }
      return route.continue();
    }
    if (["data:", "blob:"].includes(url.protocol)) return route.continue();
    if (/\/USGSImagery(?:Only|Topo)\/MapServer\/tile\//.test(url.pathname)) {
      return route.fulfill({ contentType: "image/png", body: tile });
    }
    return route.abort("blockedbyclient");
  });
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  const project = await saveProject(page);
  await page.getByTestId("workspace-nav-map").click();
  await closePanels(page);
  if (renderer === "svg") {
    await expect.poll(() => workerFailures).toBeGreaterThan(0);
    await useSvg(page);
  } else {
    await expect(surface(page, renderer)).toHaveAttribute("data-map-loaded", "true");
  }
  await expect(surface(page, renderer)).toBeVisible();
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60_000 });
  await stableView(page, renderer);
  return project;
}

async function stableView(page: Page, renderer: Renderer): Promise<number[]> {
  let previous: string | null = null;
  let unchanged = 0;
  await expect.poll(async () => {
    const current = await surface(page, renderer).getAttribute(renderer === "browser" ? "data-map-camera" : "viewBox");
    unchanged = current !== null && previous === current ? unchanged + 1 : 0;
    previous = current;
    return unchanged;
  }, { intervals: [150], message: `${renderer} camera must settle` }).toBeGreaterThanOrEqual(3);
  const values: number[] = renderer === "browser" ? JSON.parse(previous!) : previous!.trim().split(/[\s,]+/).map(Number);
  expect(values).toHaveLength(renderer === "browser" ? 5 : 4);
  expect(values.every(Number.isFinite)).toBe(true);
  return values;
}

function sameView(actual: number[], expected: number[]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 7));
}

async function fit(page: Page, renderer: Renderer) {
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60_000 });
  const button = page.getByTestId(`${renderer}-map-fit-field`);
  await expect(button).toHaveRole("button");
  await expect(button).toHaveAccessibleName("Fit field");
  await expect(button).toBeEnabled();
  const target = await box(button);
  expect(target.width).toBeGreaterThanOrEqual(44);
  expect(target.height).toBeGreaterThanOrEqual(44);
  const hitTest = await button.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { clear: hit === element || element.contains(hit),
      hit: hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? hit?.tagName ?? "none" };
  });
  expect(hitTest.clear, `Fit field must be unobstructed (hit ${hitTest.hit})`).toBe(true);
  await button.click();
  return stableView(page, renderer);
}

async function usableRect(page: Page, renderer: Renderer, forClicks = false): Promise<Rect> {
  const frame = await box(surface(page, renderer));
  let left = frame.x + 20;
  let top = frame.y + 20;
  let right = frame.x + frame.width - 20, bottom = frame.y + frame.height - 20;
  const bottomIds = renderer === "browser" ? ["browser-map-bottom-dock"] : ["map-bottom-hud", "svg-map-draft-hud"];
  for (const id of bottomIds) {
    const item = page.getByTestId(id);
    if (await item.isVisible()) {
      const hud = await box(item);
      if (hud.y > frame.y && hud.y < frame.y + frame.height) bottom = Math.min(bottom, hud.y - 8);
    }
  }
  if (renderer === "svg") {
    const overlay = page.getByTestId("svg-map-top-overlay-stack");
    if (await overlay.isVisible()) {
      const hud = await box(overlay);
      top = Math.max(top, hud.y + hud.height + 8);
    }
    if (forClicks) {
      const legend = page.getByTestId("svg-map-legend-open");
      if (await legend.isVisible()) {
        const legendBox = await box(legend);
        if (legendBox.x < frame.x + frame.width / 2
          && legendBox.y < frame.y + frame.height / 2) left = Math.max(left, legendBox.x + legendBox.width + 8);
      }
      const controls = await box(page.getByTestId("svg-map-zoom-controls"));
      if (controls.width > controls.height && controls.x >= frame.x + frame.width / 3) right = Math.min(right, controls.x - 8);
      else if (controls.width > controls.height) top = Math.max(top, controls.y + controls.height + 8);
      else right = Math.min(right, controls.x - 8);
      const panWest = page.getByRole("button", { name: "Pan west", exact: true });
      if (await panWest.isVisible()) right = Math.min(right, (await box(panWest)).x - 8);
      const drawerHandle = page.getByTestId("right-drawer-handle");
      if (await drawerHandle.isVisible()) {
        const handle = await box(drawerHandle);
        if (handle.x < frame.x + frame.width && handle.x + handle.width > frame.x
          && handle.y < frame.y + frame.height && handle.y + handle.height > frame.y) {
          if (handle.width > frame.width / 2) bottom = Math.min(bottom, handle.y - 8);
          else right = Math.min(right, handle.x - 8);
        }
      }
    } else {
      const controls = await box(page.getByTestId("svg-map-zoom-controls"));
      if (controls.width > controls.height) top = Math.max(top, controls.y + controls.height + 8);
    }
  } else {
    for (const selector of [".maplibregl-ctrl-top-right", '[data-testid="browser-map-fit-field"]',
      '[data-testid="browser-map-layout-hud"]']) {
      const control = page.locator(selector);
      if (await control.isVisible()) {
        const hud = await box(control);
        top = Math.max(top, hud.y + hud.height + 8);
      }
    }
  }
  expect(right - left).toBeGreaterThan(0);
  expect(bottom - top).toBeGreaterThan(0);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function screenPoints(page: Page, renderer: Renderer, project: PivotProject, points: readonly XY[]) {
  if (renderer === "svg") {
    return surface(page, renderer).evaluate((element, vertices) => {
      const svg = element as unknown as SVGSVGElement;
      const ctm = svg.getScreenCTM();
      if (!ctm) throw new Error("SVG must have a rendered screen CTM");
      return vertices.map(point => {
        const projected = new DOMPoint(point.x, -point.y).matrixTransform(ctm);
        return { x: projected.x, y: projected.y };
      });
    }, [...points]);
  }
  const [longitude, latitude, zoom, bearing, pitch] = await stableView(page, renderer);
  expect(bearing).toBeCloseTo(0, 8);
  expect(pitch).toBeCloseTo(0, 8);
  const frame = await box(surface(page, renderer));
  // Independent north-up Web Mercator projection, not the production fit helper.
  const mercatorY = (degrees: number) => (1 - Math.asinh(Math.tan(degrees * Math.PI / 180)) / Math.PI) / 2;
  const worldSize = 512 * 2 ** zoom;
  return points.map(point => {
    const lonLat = projectXyToLonLat(point, project.projectCrs);
    return {
      x: frame.x + frame.width / 2 + (lonLat.longitude - longitude) / 360 * worldSize,
      y: frame.y + frame.height / 2 + (mercatorY(lonLat.latitude) - mercatorY(latitude)) * worldSize,
    };
  });
}

async function expectContained(page: Page, renderer: Renderer, project: PivotProject) {
  const available = await usableRect(page, renderer);
  const points = await screenPoints(page, renderer, project, project.fieldBoundary);
  for (const point of points) {
    expect(point.x).toBeGreaterThanOrEqual(available.x - 2);
    expect(point.x).toBeLessThanOrEqual(available.x + available.width + 2);
    expect(point.y).toBeGreaterThanOrEqual(available.y - 2);
    expect(point.y).toBeLessThanOrEqual(available.y + available.height + 2);
  }
  const spanX = Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
  const spanY = Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y));
  expect(Math.max(spanX / available.width, spanY / available.height), "fit must frame the field at a useful scale").toBeGreaterThan(0.45);
}

async function selectBoundary(page: Page, renderer: Renderer) {
  await activateMapTool(page, "edit");
  await closePanels(page);
  await (renderer === "browser" ? page.getByTestId("browser-edit-select-boundary")
    : page.getByRole("button", { name: "Select first boundary vertex", exact: true })).click();
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60_000 });
  await stableView(page, renderer);
}

function selection(page: Page, renderer: Renderer) {
  return renderer === "browser" ? page.getByTestId("browser-edit-drag-handle").getAttribute("aria-label")
    : page.getByTestId("svg-map-draft-hud").innerText();
}

async function zoom(page: Page, renderer: Renderer, direction: "in" | "out") {
  const container = renderer === "browser" ? surface(page, renderer) : page.getByTestId("svg-map-zoom-controls");
  await container.getByRole("button", { name: `Zoom ${direction}`, exact: true }).click();
  return stableView(page, renderer);
}

async function importBoundary(page: Page, renderer: Renderer) {
  const x = 521000, y = 4526000;
  const ring = [[x, y], [x + 1200, y], [x + 1200, y + 700], [x, y + 700], [x, y]];
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({ type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32613" }, features: [{ type: "Feature", properties: { layerType: "field_boundary" },
      geometry: { type: "Polygon", coordinates: [ring] } }],
  }));
  await page.getByTestId("files-action-import-geojson").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  const project = await saveProject(page);
  expect(project.fieldBoundary).toEqual(ring.slice(0, -1).map(([x, y]) => ({ x, y })));
  await page.getByTestId("workspace-nav-map").click();
  // Files navigation unmounts the renderer, so request fallback on the new instance.
  if (renderer === "svg") await useSvg(page);
  await closePanels(page);
  return project;
}

async function beginBoundaryCapture(page: Page) {
  await openTools(page);
  await page.getByTestId("manual-design-source-boundary-map_click").click();
}

function draftInput(page: Page) {
  return page.getByLabel("Draft boundary projected XY", { exact: true });
}

async function drawTool(page: Page, tool: "polygon" | "line" | "point") {
  await activateMapTool(page, tool);
  await expect(page.getByTestId("design-console-dialog")).toHaveCount(0);
  await closePanels(page);
}

for (const renderer of ["browser", "svg"] as const) {
  test(`${renderer}: labeled map tool menus share Design and Layout appearance without authorizing pointer edits`, async ({ page, baseURL }, testInfo) => {
    await setup(page, baseURL, renderer);
    const before = await workspaceStorageBytes(page);
    const toolbar = page.getByTestId("map-bottom-hud");
    for (const id of ["pan", "edit", "point", "line", "polygon", "circle"]) {
      const trigger = toolbar.getByTestId(`design-action-${id}`);
      await expect(trigger).toContainText(id === "circle" ? "Coverage" : new RegExp(id, "i"));
      await trigger.click();
      await expect(trigger).toHaveAttribute("aria-expanded", "true");
      await expect(toolbar.getByTestId(`design-action-${id}-start`)).toBeEnabled();
      await trigger.press("Escape");
      await expect(toolbar.getByTestId("map-tool-options")).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await toolbar.getByTestId("design-action-polygon").click();
    await expect(toolbar.getByTestId("map-tool-field-boundary")).toBeEnabled();
    await expect(toolbar.getByTestId("map-tool-keep-out")).toBeEnabled();
    const mapBounds = await box(surface(page, renderer));
    const toolbarBounds = await box(toolbar);
    expect(toolbarBounds.x).toBeGreaterThanOrEqual(mapBounds.x);
    expect(toolbarBounds.x + toolbarBounds.width).toBeLessThanOrEqual(mapBounds.x + mapBounds.width + 1);
    if (renderer === "svg" && page.viewportSize()!.width < 760) {
      expect(toolbarBounds.y).toBeGreaterThanOrEqual(mapBounds.y + mapBounds.height);
      const usable = await usableRect(page, renderer, true);
      expect(usable.height, "compact SVG map retains a usable drawing area").toBeGreaterThan(110);
    } else {
      expect(toolbarBounds.y).toBeGreaterThanOrEqual(mapBounds.y);
      expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(mapBounds.y + mapBounds.height + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`${renderer}-overlay-design.png`) });
    expect(await workspaceStorageBytes(page)).toEqual(before);
    await toolbar.getByRole("button", { name: "Close tool options" }).click();
    await (renderer === "browser" ? page.getByTestId("browser-workflow-layout") : page.getByRole("button", { name: "Layout", exact: true })).click();
    await toolbar.getByTestId("design-action-polygon").click();
    for (const id of ["design-action-polygon-start", "map-tool-field-boundary", "map-tool-keep-out"]) await expect(toolbar.getByTestId(id)).toBeDisabled();
    await expect(toolbar.getByTestId("map-tool-rtk")).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`${renderer}-overlay-layout.png`) });
    await toolbar.getByTestId("map-tool-rtk").click();
    await expect(page.getByRole("button", { name: "Capture Survey Point", exact: true })).toBeDisabled();
    await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  });

  test(`${renderer}: standard drawing tools measure, undo, cancel and save polygon line point purposes`, async ({ page, baseURL }, testInfo) => {
    test.slow();
    const project = await setup(page, baseURL, renderer);
    const stored = await workspaceStorageBytes(page);
    const center = project.fieldBoundary.reduce((sum, point) => ({ x: sum.x + point.x / project.fieldBoundary.length, y: sum.y + point.y / project.fieldBoundary.length }), { x: 0, y: 0 });
    const points = [{ x: center.x - 60, y: center.y - 60 }, { x: center.x + 60, y: center.y - 60 }, { x: center.x, y: center.y + 60 }];
    const clickPoint = async (point: XY) => {
      const [screen] = await screenPoints(page, renderer, project, [point]);
      await page.mouse.click(screen.x, screen.y);
    };
    const finish = () => renderer === "browser" ? page.getByTestId("browser-action-save-feature") : page.getByRole("button", { name: "Save utility map feature", exact: true });
    const measurement = page.getByTestId(`${renderer}-map-draft-measurement`);
    const purpose = page.getByTestId("pending-draft-purpose-panel");

    await drawTool(page, "polygon");
    await fit(page, renderer);
    for (const point of points) await clickPoint(point);
    await expect(measurement).toContainText("XY area");
    await expect(measurement).toContainText("perimeter");
    if (renderer === "svg") await expect(page.getByTestId("svg-draft-preview")).toHaveAttribute("d", /Z$/);
    if (renderer === "svg") {
      await stableView(page, "svg");
      const overlaps = await page.evaluate(() => {
        const ids = ["map-bottom-hud", "svg-map-zoom-controls", "svg-map-draft-hud"];
        const controls = ids.flatMap(id => [...document.querySelectorAll(`[data-testid="${id}"]`)]).map(el => el.getBoundingClientRect());
        return [...document.querySelectorAll('[data-testid="svg-map-labels"] text')].filter(el => {
          const a = el.getBoundingClientRect();
          return controls.some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
        }).map(el => el.textContent);
      });
      expect(overlaps, "drawing measurement reflow must update toolbar label exclusions").toEqual([]);
    }
    await page.screenshot({ path: testInfo.outputPath(`${renderer}-polygon-preview.png`), fullPage: true });
    await page.getByTestId(`${renderer}-action-undo-draft`).click();
    await expect(finish()).toBeDisabled();
    await expect(measurement).toContainText("XY length");
    if (renderer === "svg") await expect(page.getByTestId("svg-draft-preview")).not.toHaveAttribute("d", /Z$/);
    await drawTool(page, "polygon");
    await expect(measurement).toContainText("XY length");
    await clickPoint(points[2]);
    await finish().click();
    await expect(purpose).toContainText("XY area");
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    await page.getByTestId("pending-draft-cancel").click();
    expect(await workspaceStorageBytes(page)).toEqual(stored);

    await drawTool(page, "polygon");
    await fit(page, renderer);
    await expect(measurement).toContainText("XY area");
    await expect(finish()).toBeEnabled();
    await finish().click();
    await expect(purpose).toBeVisible();
    await purpose.getByTestId("pending-draft-purpose-select").selectOption({ label: "Keep-Out / No-Spray" });
    await purpose.getByTestId("pending-draft-keep").click();
    await expect(purpose).toHaveCount(0);
    const withPolygon = await saveProject(page);
    expect(withPolygon.obstacles).toHaveLength(project.obstacles.length + 1);
    expect(withPolygon.obstacles.at(-1)?.kind).toBe("exclusion");
    expect(withPolygon.obstacles.at(-1)?.polygon).toHaveLength(3);

    await drawTool(page, "line");
    await fit(page, renderer);
    for (const point of points.slice(0, 2)) await clickPoint(point);
    await expect(measurement).toContainText("XY length");
    await finish().click();
    await purpose.getByTestId("pending-draft-purpose-select").selectOption({ label: "Measurement Line" });
    await purpose.getByTestId("pending-draft-keep").click();
    const withLine = await saveProject(page);
    expect(withLine.mapFeatures?.at(-1)?.geometry.type).toBe("LineString");
    expect(withLine.mapFeatures?.at(-1)?.kind).toBe("measurement_line");

    await drawTool(page, "point");
    await fit(page, renderer);
    await clickPoint(center);
    await purpose.getByTestId("pending-draft-purpose-select").selectOption({ label: "Well" });
    await purpose.getByTestId("pending-draft-keep").click();
    const final = await saveProject(page);
    expect(final.mapFeatures?.at(-1)?.geometry.type).toBe("Point");
    expect(final.mapFeatures?.at(-1)?.kind).toBe("well_location");
    expect(final.surveyPoints).toEqual(project.surveyPoints);
    expect(final.fieldBoundary).toEqual(project.fieldBoundary);
    await closePanels(page);
    await page.screenshot({ path: testInfo.outputPath(`${renderer}-standard-drawing.png`), fullPage: true });
  });
}

for (const renderer of ["browser", "svg"] as const) {
  test(`${renderer}: Fit field preserves selection, saved bytes and undo; repeats and works in Layout`, async ({ page, baseURL }, testInfo) => {
    const original = await setup(page, baseURL, renderer);
    await selectBoundary(page, renderer);
    await (renderer === "browser" ? page.getByTestId("browser-edit-nudge-east")
      : page.getByRole("button", { name: "Move selected vertex east", exact: true })).click();
    const edited = await saveProject(page);
    expect(edited.fieldBoundary).not.toEqual(original.fieldBoundary);
    const selected = await selection(page, renderer);
    expect(selected?.toLowerCase()).toContain("boundary vertex 1 of");
    const away = await zoom(page, renderer, "in");
    const stored = await workspaceStorageBytes(page);
    const beforePixels = renderer === "browser" ? await surface(page, renderer).locator("canvas").screenshot() : null;
    const fitted = await fit(page, renderer);
    expect(fitted).not.toEqual(away);
    expect(await selection(page, renderer)).toBe(selected);
    await expectContained(page, renderer, edited);
    sameView(await fit(page, renderer), fitted);
    sameView(await fit(page, renderer), fitted);
    if (renderer === "svg" && page.viewportSize()!.width < 700) {
      const legendButton = page.getByTestId("svg-map-legend-open");
      await expect(legendButton).toHaveAccessibleName("Map legend");
      await legendButton.click();
      const dialog = page.getByTestId("svg-map-legend-dialog");
      await expect(dialog).toBeVisible();
      for (const label of ["Allowed wet area", "Tower / LRDU path", "Machine-end path", "End-gun reach",
        "Configured corner-arm preview", "Outside field", "Generated advisory plan", "Obstacle/no-spray",
        "Survey/object point", "Utility map feature"]) await expect(dialog.getByText(label, { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("svg-map-legend.png"), animations: "disabled" });
      await dialog.getByRole("button", { name: "Close map legend" }).click();
      await expect(dialog).toHaveCount(0);
      sameView(await stableView(page, renderer), fitted);
      expect(await selection(page, renderer)).toBe(selected);
      expect(await workspaceStorageBytes(page)).toEqual(stored);
    }
    await page.screenshot({ path: testInfo.outputPath(`${renderer}-field-fit.png`), animations: "disabled" });
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    if (renderer === "browser") {
      const canvas = surface(page, renderer).locator("canvas");
      await expect.poll(async () => (await canvas.screenshot()).equals(beforePixels!)).toBe(false);
      const pixels = await canvas.screenshot({ path: testInfo.outputPath("fit-field-canvas.png") });
      expect(analyzePngPixels(pixels).grayVariance).toBeGreaterThan(2);
    }
    await page.getByTestId("command-icon-undo").click();
    expect((await saveProject(page)).fieldBoundary, "one undo must undo the geometry edit, not Fit").toEqual(original.fieldBoundary);
    await page.getByTestId("command-icon-redo").click();
    expect((await saveProject(page)).fieldBoundary).toEqual(edited.fieldBoundary);
    await page.getByTestId(renderer === "browser" ? "browser-workflow-layout" : "workflow-layout-mode").click();
    await closePanels(page);
    const layoutBytes = await workspaceStorageBytes(page);
    await zoom(page, renderer, "in");
    await fit(page, renderer);
    await expectContained(page, renderer, edited);
    await page.screenshot({ path: testInfo.outputPath(`${renderer}-layout-field-fit.png`), animations: "disabled" });
    expect(await workspaceStorageBytes(page)).toEqual(layoutBytes);
  });

  test(`${renderer}: Fit uses the current imported boundary and excludes remote infrastructure and staged draft`, async ({ page, baseURL }) => {
    await setup(page, baseURL, renderer);
    const initial = await fit(page, renderer);
    const project = await importBoundary(page, renderer);
    const importedFit = await fit(page, renderer);
    expect(importedFit).not.toEqual(initial);
    await expectContained(page, renderer, project);
    const [pivot] = await screenPoints(page, renderer, project, [project.pivotCenter]);
    const frame = await box(surface(page, renderer));
    expect(pivot.x < frame.x || pivot.x > frame.x + frame.width || pivot.y < frame.y || pivot.y > frame.y + frame.height,
      "remote infrastructure must not expand field-only fit").toBe(true);

    await beginBoundaryCapture(page);
    await fit(page, renderer);
    for (let step = 0; step < 6; step++) await zoom(page, renderer, "out");
    const available = await usableRect(page, renderer, true);
    await page.mouse.click(available.x + available.width * 0.2, available.y + available.height * 0.25);
    await expect(page.getByTestId("manual-design-status")).toContainText("1 map-click boundary vertices staged");
    const draft = await draftInput(page).inputValue();
    const coordinates = draft.trim().split(/\s*,\s*/).map(Number);
    expect(coordinates).toHaveLength(2);
    expect(coordinates.every(Number.isFinite)).toBe(true);
    const stored = await workspaceStorageBytes(page);
    const fitted = await fit(page, renderer);
    await expectContained(page, renderer, project);
    await expect(draftInput(page)).toHaveValue(draft);
    const [staged] = await screenPoints(page, renderer, project, [{ x: coordinates[0], y: coordinates[1] }]);
    const fittedFrame = await box(surface(page, renderer));
    expect(staged.x < fittedFrame.x || staged.x > fittedFrame.x + fittedFrame.width
      || staged.y < fittedFrame.y || staged.y > fittedFrame.y + fittedFrame.height,
    "the staged point must remain outside the boundary-only fitted view").toBe(true);
    sameView(await fit(page, renderer), fitted);
    await expect(draftInput(page)).toHaveValue(draft);
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  });
}

async function expectSvgAspect(page: Page) {
  // Allow subpixel CSS rounding while requiring the projected viewBox aspect to track the rendered SVG.
  await expect.poll(async () => surface(page, "svg").evaluate(element => {
    const svg = element as unknown as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    return Math.abs(svg.viewBox.baseVal.width / svg.viewBox.baseVal.height - rect.width / rect.height);
  })).toBeLessThan(1e-5);
}

test("SVG aspect and corner click XY survive Fit and resize; held release cannot add a draft vertex", async ({ page, baseURL }, testInfo) => {
  const project = await setup(page, baseURL, "svg");
  await expectSvgAspect(page);
  await fit(page, "svg");
  await expectSvgAspect(page);
  await expectContained(page, "svg", project);
  const configured = page.viewportSize()!;
  await page.setViewportSize({ width: configured.height, height: configured.width });
  await expectSvgAspect(page);
  await fit(page, "svg");
  await expectContained(page, "svg", project);
  await page.setViewportSize(configured);
  await expectSvgAspect(page);
  await beginBoundaryCapture(page);
  await fit(page, "svg");
  await expectSvgAspect(page);
  const stored = await workspaceStorageBytes(page);
  const expected: XY[] = [];
  await testInfo.attach("svg-transform.json", { contentType: "application/json", body: JSON.stringify(
    await surface(page, "svg").evaluate(element => {
      const svg = element as unknown as SVGSVGElement;
      const view = svg.viewBox.baseVal;
      return { attribute: svg.getAttribute("viewBox"), parsed: { x: view.x, y: view.y, width: view.width, height: view.height },
        rect: svg.getBoundingClientRect().toJSON(), matrix: svg.getScreenCTM() };
    })) });
  for (const [fractionX, fractionY] of [[0.08, 0.08], [0.92, 0.08], [0.92, 0.92], [0.08, 0.92]]) {
    const available = await usableRect(page, "svg", true);
    // MouseEvent client coordinates are integral; use the delivered pixel for the CTM oracle.
    const screen = { x: Math.round(available.x + available.width * fractionX), y: Math.round(available.y + available.height * fractionY) };
    expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.getAttribute("data-testid"), screen),
      "coordinate capture must target the drawing layer, not a map control").toBe("layout-map-click-layer");
    const point = await surface(page, "svg").evaluate((element, target) => {
      const ctm = (element as unknown as SVGSVGElement).getScreenCTM();
      if (!ctm) throw new Error("Missing SVG CTM for click oracle");
      const world = new DOMPoint(target.x, target.y).matrixTransform(ctm.inverse());
      return { x: world.x, y: -world.y };
    }, screen);
    expected.push(point);
    await page.mouse.click(screen.x, screen.y);
    await expect(page.getByTestId("manual-design-status")).toContainText(`${expected.length} map-click boundary vertices staged`);
    const actual = (await draftInput(page).inputValue()).trim().split("\n").map(line => line.split(/\s*,\s*/).map(Number));
    expect(actual).toHaveLength(expected.length);
    // UI coordinates round to millimetres; points are chosen away from snap targets.
    expected.forEach((vertex, index) => {
      expect(actual[index][0]).toBeCloseTo(vertex.x, 1);
      expect(actual[index][1]).toBeCloseTo(vertex.y, 1);
    });
  }
  const draft = await draftInput(page).inputValue();
  const available = await usableRect(page, "svg", true);
  await page.mouse.move(available.x + available.width / 2, available.y + available.height / 2);
  await page.mouse.down();
  try {
    const button = page.getByTestId("svg-map-fit-field");
    await button.focus();
    await button.press("Enter");
    await stableView(page, "svg");
  } finally {
    await page.mouse.up();
  }
  await expect(draftInput(page)).toHaveValue(draft);
  await expect(page.getByTestId("manual-design-status")).toContainText("4 map-click boundary vertices staged");
  expect(await workspaceStorageBytes(page)).toEqual(stored);
});

test("short landscape SVG keeps Fit and drawing space clear of the toolbar", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390");
  const project = await setup(page, baseURL, "svg");
  const saved = await workspaceStorageBytes(page);
  for (const width of [780, 844, 1024]) {
    await page.setViewportSize({ width, height: 390 });
    await expectSvgAspect(page);
    await fit(page, "svg");
    await expectContained(page, "svg", project);
    const available = await usableRect(page, "svg", true);
    expect(available.height).toBeGreaterThan(60);
    const map = await box(surface(page, "svg"));
    const toolbar = await box(page.getByTestId("map-bottom-hud"));
    expect(toolbar.y).toBeGreaterThanOrEqual(map.y + map.height - 2);
    expect(await workspaceStorageBytes(page)).toEqual(saved);
    const trigger = page.getByTestId("design-action-polygon");
    await trigger.click();
    await expect(page.getByTestId("map-tool-options")).toBeVisible();
    const close = page.getByRole("button", { name: "Close tool options" });
    const closeBox = await box(close);
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("map-tool-options")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`svg-short-landscape-${width}.png`), animations: "disabled" });
  }
  await activateMapTool(page, "polygon");
  for (const width of [780, 844, 1024]) {
    await page.setViewportSize({ width, height: 390 });
    await fit(page, "svg");
    const available = await usableRect(page, "svg", true);
    expect(available.height).toBeGreaterThan(60);
    const frame = await box(surface(page, "svg"));
    expect(available.width).toBeGreaterThan(Math.min(200, frame.width * 0.35));
    expect(available.width * available.height).toBeGreaterThan(12_000);
    const centerHit = await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return hit?.closest('[data-testid="layout-map-drawing-surface"]') !== null;
    }, { x: available.x + available.width / 2, y: available.y + available.height / 2 });
    expect(centerHit, "short landscape must expose a hittable SVG drawing area").toBe(true);
    const draftHud = page.getByTestId("svg-map-draft-hud");
    await expect(draftHud).toBeVisible();
    const hud = await box(draftHud);
    const map = await box(surface(page, "svg"));
    expect(hud.y + hud.height, "draft HUD must leave the drawing surface clear").toBeLessThanOrEqual(map.y + 2);
    const addCenter = page.getByRole("button", { name: "Add draft vertex at view center" });
    await expect(addCenter).toBeVisible();
    expect(await addCenter.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === element || element.contains(hit);
    }), "draft HUD command must be unobstructed").toBe(true);
    await addCenter.click();
    await expect(draftHud).toContainText("1 pts");
    await page.getByTestId("svg-action-undo-draft").click();
    await expect(draftHud).toContainText("0 pts");
    expect(await workspaceStorageBytes(page)).toEqual(saved);
  }
});

test("compact browser Fit and selected vertex stay clear of the open inspector", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390");
  const project = await setup(page, baseURL, "browser");
  const saved = await workspaceStorageBytes(page);
  await openTools(page);
  const sheet = page.getByTestId("right-workflow-sidebar");
  await expect(sheet).toBeVisible();
  await fit(page, "browser");
  const sheetTop = (await box(sheet)).y;
  const statusTop = (await box(page.getByTestId("browser-map-status-hud"))).y;
  const clearBottom = Math.min(sheetTop, statusTop) - 8;
  const points = await screenPoints(page, "browser", project, project.fieldBoundary);
  for (const point of points) {
    expect(point.y, "fitted field vertex must remain above compact overlays").toBeLessThan(clearBottom);
  }
  await activateMapTool(page, "edit");
  await openTools(page);
  await expect(sheet).toBeVisible();
  await page.getByTestId("browser-edit-select-boundary").click();
  const handle = await box(page.getByTestId("browser-edit-drag-handle"));
  const selectedClearBottom = Math.min((await box(sheet)).y, (await box(page.getByTestId("browser-map-status-hud"))).y) - 8;
  expect(handle.y + handle.height, "selected edit handle must remain above compact overlays").toBeLessThan(selectedClearBottom);
  await closePanels(page);
  await fit(page, "browser");
  const canvas = surface(page, "browser").locator("canvas");
  let preOpenHandle = await box(page.getByTestId("browser-edit-drag-handle"));
  for (let step = 0; step < 6 && preOpenHandle.y + preOpenHandle.height / 2 <= sheetTop + 12; step++) {
    await canvas.focus();
    await canvas.press("ArrowUp");
    await stableView(page, "browser");
    preOpenHandle = await box(page.getByTestId("browser-edit-drag-handle"));
  }
  const preOpenCenterY = preOpenHandle.y + preOpenHandle.height / 2;
  expect(preOpenCenterY, "selected vertex must be in the future inspector's covered area")
    .toBeGreaterThan(sheetTop + 12);
  const preOpenCamera = await stableView(page, "browser");
  await openTools(page);
  await expect.poll(async () => {
    const selected = await box(page.getByTestId("browser-edit-drag-handle"));
    return selected.y + selected.height < Math.min((await box(sheet)).y,
      (await box(page.getByTestId("browser-map-status-hud"))).y) - 8;
  }, { message: "opening the inspector must reveal an already-selected vertex" }).toBe(true);
  expect(await stableView(page, "browser")).not.toEqual(preOpenCamera);
  expect(await workspaceStorageBytes(page)).toEqual(saved);
});

test("Browser Fit cancels a held vertex drag and its later pointer release cannot mutate geometry", async ({ page, baseURL }) => {
  const original = await setup(page, baseURL, "browser");
  await selectBoundary(page, "browser");
  await fit(page, "browser");
  const stored = await workspaceStorageBytes(page);
  const undoState = await page.getByTestId("command-icon-undo").getAttribute("aria-disabled");
  const selected = await selection(page, "browser");
  const handle = await box(page.getByTestId("browser-edit-drag-handle"));
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + 30, y + 20, { steps: 5 });
    await expect.poll(async () => {
      const moved = await box(page.getByTestId("browser-edit-drag-handle"));
      return Math.hypot(moved.x - handle.x, moved.y - handle.y);
    }, { message: "the vertex drag must actually start before Fit cancels it" }).toBeGreaterThan(10);
    // Keyboard activation leaves the real pointer held across the Fit boundary.
    const button = page.getByTestId("browser-map-fit-field");
    await button.focus();
    await button.press("Enter");
    await stableView(page, "browser");
    await page.mouse.move(x + 65, y + 30, { steps: 3 });
  } finally {
    await page.mouse.up();
  }
  await stableView(page, "browser");
  expect(await selection(page, "browser")).toBe(selected);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await page.getByTestId("command-icon-undo").getAttribute("aria-disabled")).toBe(undoState);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect((await saveProject(page)).fieldBoundary).toEqual(original.fieldBoundary);
  await expectContained(page, "browser", original);
});

for (const renderer of ["browser", "svg"] as const) {
  test(`${renderer}: Fit retires held touch and mixed-input clicks, then accepts a fresh gesture`, async ({ page, baseURL }) => {
    await setup(page, baseURL, renderer);
    await beginBoundaryCapture(page);
    await fit(page, renderer);
    const stored = await workspaceStorageBytes(page);
    const draft = await draftInput(page).inputValue();
    const available = await usableRect(page, renderer, true);
    const x = Math.round(available.x + available.width / 2), y = Math.round(available.y + available.height / 2);
    const cdp = await page.context().newCDPSession(page);
    let touchActive = false;
    try {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
      touchActive = true;
      const button = page.getByTestId(`${renderer}-map-fit-field`);
      await button.focus();
      await button.press("Enter");
      const fitted = await stableView(page, renderer);
      // Mouse and touch may both report isPrimary; neither can revive the retired touch.
      await page.mouse.move(x + 5, y + 5);
      await page.mouse.down();
      await page.mouse.up();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      touchActive = false;
      await expect(draftInput(page)).toHaveValue(draft);
      sameView(await stableView(page, renderer), fitted);
      expect(await workspaceStorageBytes(page)).toEqual(stored);
      await page.mouse.click(x, y);
      await expect(page.getByTestId("manual-design-status")).toContainText("1 map-click boundary vertices staged");
      expect(await workspaceStorageBytes(page)).toEqual(stored);
    } finally {
      try {
        if (touchActive) await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      } finally { await cdp.detach(); }
    }
  });
}

test("SVG Fit cancels a held vertex click before shape selection and accepts the next fresh click", async ({ page, baseURL }) => {
  const original = await setup(page, baseURL, "svg");
  await selectBoundary(page, "svg");
  await fit(page, "svg");
  const stored = await workspaceStorageBytes(page);
  const selected = await selection(page, "svg");
  const undoState = await page.getByTestId("command-icon-undo").getAttribute("aria-disabled");
  const vertex = page.getByLabel("Boundary vertex 2", { exact: true });
  const target = await box(vertex);
  const x = target.x + target.width / 2, y = target.y + target.height / 2;
  expect(await vertex.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
  }), "the held gesture must start directly on the SVG vertex").toBe(true);
  // Observe the browser-generated click before the surface guard can stop propagation.
  await vertex.evaluate(element => {
    const observed: string[] = [];
    (window as unknown as { heldVertexClicks: string[] }).heldVertexClicks = observed;
    window.addEventListener("click", event => {
      if (event.target === element) observed.push(event.isTrusted ? "trusted" : "synthetic");
    }, true);
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    const button = page.getByTestId("svg-map-fit-field");
    await button.focus();
    await button.press("Enter");
    await stableView(page, "svg");
    const afterFit = await box(vertex);
    expect(afterFit.x).toBeCloseTo(target.x, 5);
    expect(afterFit.y).toBeCloseTo(target.y, 5);
  } finally {
    await page.mouse.up();
  }
  expect(await page.evaluate(() => (window as unknown as { heldVertexClicks: string[] }).heldVertexClicks)).toEqual(["trusted"]);
  expect(await selection(page, "svg")).toBe(selected);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await page.getByTestId("command-icon-undo").getAttribute("aria-disabled")).toBe(undoState);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await vertex.click();
  await expect(page.getByTestId("svg-map-draft-hud")).toContainText(/boundary vertex 2 of/i);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect((await saveProject(page)).fieldBoundary).toEqual(original.fieldBoundary);
});

test("SVG vertex clicks select without mutation and background placement follows the rendered XY", async ({ page, baseURL }) => {
  const original = await setup(page, baseURL, "svg");
  await selectBoundary(page, "svg");
  await fit(page, "svg");
  const stored = await workspaceStorageBytes(page);
  await page.getByLabel("Boundary vertex 2", { exact: true }).click();
  await expect(page.getByTestId("svg-map-draft-hud")).toContainText(/boundary vertex 2 of/i);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const points = await screenPoints(page, "svg", original, original.fieldBoundary);
  const center = { x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  const start = points[1];
  const fraction = Math.min(0.6, Math.max(0.25, 28 / Math.hypot(center.x - start.x, center.y - start.y)));
  const screen = { x: Math.round(start.x + (center.x - start.x) * fraction),
    y: Math.round(start.y + (center.y - start.y) * fraction) };
  const expected = await surface(page, "svg").evaluate((element, point) => {
    const matrix = (element as unknown as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error("Missing SVG placement transform");
    const world = new DOMPoint(point.x, point.y).matrixTransform(matrix.inverse());
    return { x: world.x, y: -world.y };
  }, screen);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.getByTestId("svg-map-action-status")).toContainText("Moved boundary vertex 2");
  const edited = await saveProject(page);
  expect(edited.fieldBoundary[1].x).toBeCloseTo(expected.x, 5);
  expect(edited.fieldBoundary[1].y).toBeCloseTo(expected.y, 5);
  expect(edited.fieldBoundary.filter((_, index) => index !== 1)).toEqual(original.fieldBoundary.filter((_, index) => index !== 1));
  await page.getByTestId("command-icon-undo").click();
  expect((await saveProject(page)).fieldBoundary).toEqual(original.fieldBoundary);
});

test("SVG labels stay separated and screen-sized through zoom and resize without changing geometry", async ({ page, baseURL }, testInfo) => {
  await setup(page, baseURL, "svg");
  const stored = await workspaceStorageBytes(page);
  await fit(page, "svg");
  const markerSizes = new Map<string, { width: number; height: number }>();
  const inspect = async (requireLabels = true) => {
    const metrics = await surface(page, "svg").evaluate(element => {
      const frame = element.getBoundingClientRect();
      const labels = [...element.querySelectorAll('[data-testid="svg-map-labels"] text')].map(node => {
        const rect = node.getBoundingClientRect();
        const text = node as SVGTextElement;
        const matrix = text.getScreenCTM()!;
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          font: Number.parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b) };
      });
      return { frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height }, labels };
    });
    if (requireLabels) expect(metrics.labels.length).toBeGreaterThan(0);
    for (const a of metrics.labels) {
      expect(a.font).toBeCloseTo(12, 2);
      expect(a.height).toBeLessThan(19);
      expect(a.x).toBeGreaterThanOrEqual(metrics.frame.x);
      expect(a.y).toBeGreaterThanOrEqual(metrics.frame.y);
      expect(a.x + a.width).toBeLessThanOrEqual(metrics.frame.x + metrics.frame.width);
      expect(a.y + a.height).toBeLessThanOrEqual(metrics.frame.y + metrics.frame.height);
      for (const b of metrics.labels) {
        if (a === b) continue;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
          "visible map labels must not overlap").toBe(true);
      }
      for (const control of [page.getByTestId("svg-map-zoom-controls"), page.getByTestId("svg-map-legend-open"),
        page.getByTestId("map-bottom-hud")]) {
        if (!(await control.isVisible())) continue;
        const b = await box(control);
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
          "map labels must not sit beneath map controls").toBe(true);
      }
    }
    for (const kind of ["pivot_center", "water_source", "power_source"]) {
      const marker = await page.getByTestId(`svg-map-symbol-${kind}`).boundingBox();
      expect(marker).not.toBeNull();
      expect(marker!.width).toBeGreaterThan(10);
      // Includes stroke/miter extents, unlike SVG getBBox's centerline bounds.
      expect(marker!.width).toBeLessThan(33);
      expect(marker!.height).toBeLessThan(33);
      const original = markerSizes.get(kind);
      if (original) {
        // SVG user-space coordinates at UTM magnitudes can round at subpixel precision.
        expect(Math.abs(marker!.width - original.width)).toBeLessThan(0.5);
        expect(Math.abs(marker!.height - original.height)).toBeLessThan(0.5);
      } else markerSizes.set(kind, { width: marker!.width, height: marker!.height });
    }
  };
  await inspect();
  await page.screenshot({ path: testInfo.outputPath("svg-labels-fit.png"), fullPage: true });
  await zoom(page, "svg", "out");
  await inspect();
  await zoom(page, "svg", "in");
  await zoom(page, "svg", "in");
  await inspect(false);
  await page.setViewportSize({ width: 844, height: 390 });
  await closePanels(page);
  await fit(page, "svg");
  await inspect(false);
  await page.screenshot({ path: testInfo.outputPath("svg-labels-landscape.png"), fullPage: true });
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
});

test("SVG label presses select their feature without moving the selected boundary vertex", async ({ page, baseURL }) => {
  const project = await setup(page, baseURL, "svg");
  await selectBoundary(page, "svg");
  const editView = await fit(page, "svg");
  await drawTool(page, "point");
  await fit(page, "svg");
  // The Edit HUD changes Fit padding; place the Well near that eventual camera center.
  const [point] = await screenPoints(page, "svg", project, [{
    x: editView[0] + editView[2] / 2,
    y: -(editView[1] + editView[3] / 2),
  }]);
  await page.mouse.click(point.x, point.y);
  await page.getByTestId("pending-draft-purpose-select").selectOption({ label: "Well" });
  await page.getByTestId("pending-draft-keep").click();
  const saved = await saveProject(page);
  const feature = saved.mapFeatures!.at(-1)!;
  await selectBoundary(page, "svg");
  await fit(page, "svg");
  const stored = await workspaceStorageBytes(page);
  const label = page.getByTestId(`svg-map-label-feature-${feature.id}`);
  // Dense views may correctly suppress the caption. Reveal it through ordinary camera controls.
  for (let attempt = 0; attempt < 5 && !(await label.isVisible()); attempt++) await zoom(page, "svg", "in");
  await expect(label).toBeVisible();
  if (feature.geometry.type !== "Point") throw new Error("Expected a point feature");
  const marker = surface(page, "svg").locator(`circle[cx="${feature.geometry.point.x}"][cy="${-feature.geometry.point.y}"]`).first();
  const beforeFill = await marker.getAttribute("fill");
  await label.click();
  await expect(marker).not.toHaveAttribute("fill", beforeFill!);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect((await saveProject(page)).fieldBoundary).toEqual(project.fieldBoundary);
  await drawTool(page, "line");
  await fit(page, "svg");
  const captureLabel = page.getByTestId("svg-map-labels").locator("text").first();
  const caption = await box(captureLabel);
  // In drawing mode the capture layer deliberately owns taps, including caption locations.
  await page.mouse.click(caption.x + caption.width / 2, caption.y + caption.height / 2);
  await expect(page.getByTestId("svg-map-draft-hud")).toContainText("1 pts");
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
});
