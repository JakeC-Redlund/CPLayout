import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { newDesignDraft } from "../../apps/mobile/src/newDesignDraft";
import { parseFieldDesignDocument, parseProjectDocument, projectXyToLonLat, sampleProject, serializeProjectDocument } from "../../packages/core/src";
import { encodeRgbaPng } from "../../tools/pngMetrics";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { importProjectArchiveZip } from "../../packages/project-store/src/projectArchive";
import { emptyWorkspaceDocument, serializeWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { createWebWorkspaceStore } from "../../packages/project-store/src/webWorkspaceStore";
import { readWorkspace, workspaceKey, workspaceStorageBytes } from "./workspace-fixtures";
import { activateMapTool } from "./map-toolbar";

const now = "2026-09-29T00:00:00.000Z";
function fixture(draft: boolean, fieldName = "Human field design") {
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "human-client",
    input: { companyName: "Human input farm", primaryContactFirstName: "Test", primaryContactLastName: "Operator" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now,
    input: { clientId: "human-client", projectId: "human-project", projectName: "Human field", projectCrs: draft ? "" : sampleProject.projectCrs,
      unitSystem: "us_survey_feet", fieldMapId: "human-map" } }).workspace;
  if (draft) return applyWorkspaceCommand(workspace, { type: "create_design_draft", now, designId: "human-draft", fieldMapId: "human-map",
    name: "Incomplete human draft", draft: newDesignDraft("human-draft-payload", "Incomplete human draft", "us_survey_feet") }).workspace;
  const project = structuredClone(sampleProject);
  project.machine.spanLengthsMeters = [51.123456789123, 40.000000001];
  workspace = applyWorkspaceCommand(workspace, { type: "save_project", now, project, createOnly: true }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_design_record", now,
    input: { id: "human-source", fieldMapId: "human-map", pivotProjectId: project.id, name: project.name } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v2", now }).workspace;
  return applyWorkspaceCommand(workspace, { type: "convert_project_to_field_design", now, sourceDesignId: "human-source", expectedDesignRevision: 0,
    designId: "human-field", fieldMapId: "human-map", name: fieldName, fieldId: "human-field-payload", waterSourceId: "human-water", powerSourceId: "human-power" }).workspace;
}
async function openProjectDrawer(page: Page) {
  const drawer = page.getByRole("button", { name: "Open project drawer", exact: true });
  if (await drawer.isVisible()) await drawer.click();
}

async function open(context: BrowserContext, page: Page, draft = false, fieldName = "Human field design", completeSource = false) {
  const values = new Map<string, string>();
  const store = createWebWorkspaceStore({ getStorage: () => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); } }), getLocks: () => ({ request: async (_name, _options, action) => action() }) });
  await store.initializeAsync();
  values.set(workspaceKey, serializeWorkspaceDocument(fixture(draft, fieldName)));
  await context.addInitScript(({ key, entries }) => {
    if (location.protocol === "http:" && localStorage.getItem(key) === null) {
      for (const [name, value] of entries) localStorage.setItem(name, value);
    }
  }, { key: workspaceKey, entries: [...values] });
  await page.goto("/");
  await openProjectDrawer(page);
  const design = page.getByTestId(`catalog-design-human-${draft ? "draft" : completeSource ? "source" : "field"}-open`);
  const main = page.getByTestId("workspace-main-content");
  if ((page.viewportSize()?.width ?? 900) < 700 && await main.count() === 1 && await main.isHidden()) {
    // An explicitly opened compact drawer owns the shell width before selecting a saved design.
    const shell = (await page.getByTestId("workspace-shell").boundingBox())!;
    await expect.poll(async () => (await page.getByTestId("workspace-rail").boundingBox())?.width ?? -1).toBe(shell.width);
    await design.scrollIntoViewIfNeeded();
    await expect(design).toBeInViewport({ ratio: 1 });
  }
  await design.click();
  await expect(page.getByTestId(draft ? "design-draft-workspace" : completeSource ? "map-view" : "field-design-workspace")).toBeVisible();
}

async function installDrawingImagery(page: Page) {
  // Match complete-workflow's local PNG fixture so map readiness never depends on raster retries.
  const pixels = new Uint8Array(256 * 256 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([20, 40, 60, 255], offset);
  const tile = Buffer.from(encodeRgbaPng(256, 256, pixels));
  await page.route(/\/USGSImagery(?:Only|Topo)\/MapServer\/tile\/\d+\/\d+\/\d+(?:\?.*)?$/, route =>
    route.fulfill({ contentType: "image/png", body: tile }));
}

async function readyMap(page: Page) {
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  await expect(map).toHaveAttribute("data-map-loaded", "true");
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60_000 });
  const center = projectXyToLonLat(sampleProject.pivotCenter, sampleProject.projectCrs);
  let previous: string | null = null;
  let stableReads = 0;
  await expect.poll(async () => {
    const current = await map.getAttribute("data-map-camera");
    stableReads = current !== null && current === previous ? stableReads + 1 : 0;
    previous = current;
    const camera = current ? JSON.parse(current) as number[] : [];
    return stableReads >= 2 && Number.isFinite(camera[2]) && camera[2] > 0
      && Math.abs(camera[0] - center.longitude) < 0.1 && Math.abs(camera[1] - center.latitude) < 0.1;
  }, { intervals: [150], timeout: 10_000, message: "Saved design camera finishes its field fit before interaction" }).toBe(true);
  await settledMapCamera(map);
  return map;
}

async function settledMapCamera(map: Locator) {
  let previous: string | null = null, stableReads = 0;
  await expect.poll(async () => {
    const frame = await map.evaluate(element => {
      const canvas = element.querySelector("canvas.maplibregl-canvas");
      return { matched: canvas instanceof HTMLCanvasElement && element.clientWidth > 0 && element.clientHeight > 0
        && canvas.clientWidth === element.clientWidth && canvas.clientHeight === element.clientHeight,
      camera: (element as HTMLElement).dataset.mapCamera ?? null };
    });
    stableReads = frame.matched && frame.camera !== null && frame.camera === previous ? stableReads + 1 : 0;
    previous = frame.camera;
    return stableReads >= 2;
  }, { intervals: [150], message: "Renderer canvas matches the visible container and camera telemetry has settled" }).toBe(true);
  return (await map.getAttribute("data-map-camera"))!;
}

async function expectReachableSelection(selection: Locator, map: Locator) {
  await expect(selection).toBeInViewport({ ratio: 1 });
  const frame = (await map.boundingBox())!, marker = (await selection.boundingBox())!;
  expect(marker.x).toBeGreaterThanOrEqual(frame.x);
  expect(marker.y).toBeGreaterThanOrEqual(frame.y);
  expect(marker.x + marker.width).toBeLessThanOrEqual(frame.x + frame.width);
  expect(marker.y + marker.height).toBeLessThanOrEqual(frame.y + frame.height);
  await expect.poll(() => selection.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), { message: "Selected vertex handle receives pointer input outside overlays" }).toBe(true);
}

function canonicalProjectGeometry(project: ReturnType<typeof parseProjectDocument>) {
  return { projectCrs: project.projectCrs, fieldBoundary: project.fieldBoundary,
    pivotCenter: project.pivotCenter, waterSource: project.waterSource, powerSource: project.powerSource,
    machine: project.machine, obstacles: project.obstacles, surveyPoints: project.surveyPoints, mapFeatures: project.mapFeatures };
}

async function clearCanvasPoint(map: Locator, previous: Array<{ x: number; y: number }> = []) {
  const point = await map.evaluate((element, accepted) => {
    const box = element.getBoundingClientRect();
    const canvas = element.querySelector("canvas.maplibregl-canvas");
    if (!canvas) return null;
    const candidates: Array<{ x: number; y: number }> = [];
    for (let y = 32; y < box.height - 32; y += 12) for (let x = 32; x < box.width - 32; x += 12) {
      if (document.elementFromPoint(box.x + x, box.y + y) === canvas
        && accepted.every(point => Math.hypot(point.x - x, point.y - y) >= 40)) candidates.push({ x, y });
    }
    candidates.sort((a, b) => Math.hypot(a.x - box.width / 2, a.y - box.height / 3)
      - Math.hypot(b.x - box.width / 2, b.y - box.height / 3));
    return candidates[0] ?? null;
  }, previous);
  expect(point, "Actual canvas point outside map overlays").not.toBeNull();
  if (!point) throw new Error("No clear map canvas point");
  return point;
}

async function panClearCanvas(page: Page, map: Locator) {
  const path = await map.evaluate(element => {
    const frame = element.getBoundingClientRect();
    const canvas = element.querySelector("canvas.maplibregl-canvas");
    if (!canvas) return null;
    for (let y = 32; y < frame.height - 32; y += 12) for (let x = 32; x < frame.width - 96; x += 12) {
      if ([0, 16, 32, 48, 64].every(dx => document.elementFromPoint(frame.x + x + dx, frame.y + y) === canvas)) {
        return { x: frame.x + x, y: frame.y + y };
      }
    }
    return null;
  });
  expect(path, "Pan starts and travels on unobstructed canvas").not.toBeNull();
  if (!path) throw new Error("No unobstructed pan path");
  const camera = await map.getAttribute("data-map-camera");
  await page.mouse.move(path.x, path.y);
  await page.mouse.down();
  await page.mouse.move(path.x + 64, path.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => map.getAttribute("data-map-camera")).not.toBe(camera);
}

async function expectClearCanvasArea(map: Locator) {
  const area = await map.evaluate(element => {
    const frame = element.getBoundingClientRect();
    const canvas = element.querySelector("canvas.maplibregl-canvas");
    if (!canvas) return null;
    for (let y = 0; y + 96 <= frame.height; y += 8) for (let x = 0; x + 120 <= frame.width; x += 8) {
      let clear = true;
      for (let dy = 0; dy <= 96 && clear; dy += 8) for (let dx = 0; dx <= 120; dx += 8) {
        if (document.elementFromPoint(frame.x + x + dx, frame.y + y + dy) !== canvas) { clear = false; break; }
      }
      if (clear) return { x: frame.x + x, y: frame.y + y, width: 120, height: 96 };
    }
    return null;
  });
  expect(area, "At least 120 by 96 pixels of canvas receive pointer input outside every overlay").not.toBeNull();
}

async function currentProjectArchive(page: Page) {
  await page.getByTestId("workspace-nav-files").click();
  const downloading = page.waitForEvent("download");
  await page.getByTestId("files-action-export-zip").click();
  const stream = await (await downloading).createReadStream();
  if (!stream) throw new Error("Project ZIP has no readable stream");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return importProjectArchiveZip(Buffer.concat(chunks));
}

async function expectCurrentTask(page: Page, task: "projects" | "design" | "survey" | "layout") {
  const navigation = page.getByTestId("primary-task-navigation");
  await expect(navigation.getByTestId(`task-${task}`)).toHaveAttribute("aria-current", "page");
  await expect(navigation.locator('[role="button"][aria-current="page"]')).toHaveCount(1);
}

// Reach a control with actual wheel events in the editor, without forcing a click or moving the DOM.
async function scrollFieldControlIntoView(page: Page, target: Locator) {
  const body = page.getByTestId("field-content-scroll");
  await expect.poll(async () => {
    const viewport = await body.boundingBox();
    const control = await target.boundingBox();
    if (!viewport || !control) return false;
    if (control.y >= viewport.y && control.y + control.height <= viewport.y + viewport.height) return true;
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    const step = Math.max(16, (viewport.height - control.height) * 0.75);
    await page.mouse.wheel(0, (control.y < viewport.y ? -1 : 1) * step);
    return false;
  }, { message: "Field input or recovery command can be reached by scrolling", intervals: [100], timeout: 15_000 }).toBe(true);
  await expect(target).toBeInViewport({ ratio: 1 });
}

async function expectUnobstructedProjectsControl(control: Locator) {
  await expect(control).toBeInViewport({ ratio: 1 });
  expect(await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), "Projects control receives ordinary pointer input").toBe(true);
}

async function scrollProjectsControlIntoView(page: Page, target: Locator) {
  const body = page.getByTestId("workspace-main-content");
  await expect.poll(async () => {
    const viewport = await body.boundingBox(), control = await target.boundingBox();
    if (!viewport || !control) return false;
    if (control.y >= viewport.y && control.y + control.height <= viewport.y + viewport.height) return true;
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.mouse.wheel(0, (control.y < viewport.y ? -1 : 1) * Math.max(16, (viewport.height - control.height) * 0.75));
    return false;
  }, { intervals: [100], message: "Projects content can be reached with wheel scrolling", timeout: 15_000 }).toBe(true);
  await expectUnobstructedProjectsControl(target);
}

test("full-width project drawer retains the same map, vertex selection and unfinished drawing", async ({ context, page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDrawingImagery(page);
  await open(context, page, false, "Human field design", true);
  const main = page.getByTestId("workspace-main-content");
  const map = await readyMap(page);
  const node = await map.elementHandle();
  const instance = await map.getAttribute("data-map-instance");
  const saved = await readWorkspace(page), stored = await workspaceStorageBytes(page);
  // Accepting a saved design from the foreground catalog returns directly to its usable map.
  await expect(page.getByTestId("left-drawer-handle")).toHaveAccessibleName("Open project drawer");
  await expect(main).toBeVisible();
  await activateMapTool(page, "edit");
  await page.getByTestId("browser-edit-select-boundary").click();
  await page.getByTestId("browser-edit-next-vertex").click();
  const selection = page.getByTestId("browser-edit-drag-handle");
  await expect(selection).toHaveAttribute("aria-label", /boundary vertex 2 of/);
  const selectedLabel = (await selection.getAttribute("aria-label"))!;
  await readyMap(page);
  const selectedCamera = await settledMapCamera(map);
  await expectReachableSelection(selection, map);
  await page.getByTestId("left-drawer-handle").click();
  await expect(main).toBeHidden();
  await expect(map).toHaveCount(1);
  await expect(map).toBeHidden();
  const rail = (await page.getByTestId("workspace-rail").boundingBox())!;
  const shell = (await page.getByTestId("workspace-shell").boundingBox())!;
  expect(rail.x).toBeCloseTo(shell.x, 1);
  expect(rail.width).toBeCloseTo(shell.width, 1);
  await expect(page.getByTestId("catalog-design-human-source")).toHaveAttribute("aria-selected", "true");
  await info.attach("full-width-project-drawer-390x844", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByTestId("left-drawer-handle").click();
  await expect(main).toBeVisible();
  await settledMapCamera(map);
  await expect(selection).toHaveAttribute("aria-label", selectedLabel);
  await expect(map).toHaveAttribute("data-map-camera", selectedCamera);
  await page.getByTestId("left-drawer-handle").click();
  await page.setViewportSize({ width: 900, height: 420 });
  await expect(main).toBeVisible();
  const landscapeCamera = await settledMapCamera(map);
  await expect(selection).toHaveAttribute("aria-label", selectedLabel);
  await expectReachableSelection(selection, map);
  // Resize may translate the center to reveal this selected vertex, but cannot refit its zoom or orientation.
  expect(JSON.parse(landscapeCamera).slice(2)).toEqual(JSON.parse(selectedCamera).slice(2));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(main).toBeVisible();
  await expect(page.getByTestId("left-drawer-handle")).toHaveAccessibleName("Open project drawer");
  const returnedCamera = await settledMapCamera(map);
  await expect(selection).toHaveAttribute("aria-label", selectedLabel);
  await expectReachableSelection(selection, map);
  expect(JSON.parse(returnedCamera).slice(2)).toEqual(JSON.parse(selectedCamera).slice(2));
  await page.getByTestId("left-drawer-handle").click();
  await expect(main).toBeHidden();
  await expect(map).toBeHidden();
  await page.getByTestId("left-drawer-handle").click();
  await expect(main).toBeVisible();
  await settledMapCamera(map);
  await expect(selection).toHaveAttribute("aria-label", selectedLabel);
  await expectReachableSelection(selection, map);
  await expect(map).toHaveAttribute("data-map-camera", returnedCamera);
  expect(await node!.evaluate(element => element.isConnected
    && element === document.querySelector('[aria-label="CPLayout MapLibre imagery workbench"]'))).toBe(true);
  await expect(map).toHaveAttribute("data-map-instance", instance!);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect(canonicalProjectGeometry(await currentProjectArchive(page)))
    .toEqual(canonicalProjectGeometry(parseProjectDocument(saved.projectDocuments[0].document)));
  await page.getByTestId("task-design").click();
  await settledMapCamera(map);
  await expect(selection).toHaveAttribute("aria-label", selectedLabel);
  await expect(map).toHaveAttribute("data-map-camera", returnedCamera);
  expect(await workspaceStorageBytes(page)).toEqual(stored);

  // Files uses the catalog camera frame; returning to Design starts this drawing-phase renderer.
  const drawingInstance = await map.getAttribute("data-map-instance");
  await activateMapTool(page, "polygon");
  const first = await clearCanvasPoint(map);
  await map.click({ position: first });
  const second = await clearCanvasPoint(map, [first]);
  await map.click({ position: second });
  const count = page.getByText(/measure .* 2 draft pts .* polygon needs 3 pts/);
  await expect(count).toBeVisible();
  const measurement = (await page.getByTestId("browser-map-draft-measurement").textContent())!;
  const feedback = (await page.getByTestId("browser-map-action-status").textContent())!;
  const drawingCamera = await settledMapCamera(map);
  await page.getByTestId("left-drawer-handle").click();
  await expect(main).toBeHidden();
  await page.getByTestId("catalog-design-human-field-open").click();
  await expect(page.getByTestId("project-to-draft-discard")).toBeVisible();
  await page.getByTestId("project-to-draft-discard-cancel").click();
  const collapse = page.getByRole("button", { name: "Collapse project drawer", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  await expect(main).toBeVisible();
  await settledMapCamera(map);
  await expect(page.getByTestId("field-design-workspace")).toHaveCount(0);
  await expect(count).toBeVisible();
  await expect(page.getByTestId("design-action-polygon")).toHaveAttribute("aria-pressed", "true");
  await expect(map).toHaveAttribute("data-map-camera", drawingCamera);
  await expect(page.getByTestId("browser-map-action-status")).toHaveText(feedback);
  await expect(page.getByTestId("browser-map-draft-measurement")).toHaveText(measurement);
  await page.setViewportSize({ width: 760, height: 420 });
  await settledMapCamera(map);
  await expect(count).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await settledMapCamera(map);
  await expect(map).toHaveAttribute("data-map-camera", drawingCamera);
  await expect(page.getByTestId("browser-map-draft-measurement")).toHaveText(measurement);
  expect(await node!.evaluate(element => element.isConnected
    && element === document.querySelector('[aria-label="CPLayout MapLibre imagery workbench"]'))).toBe(true);
  await expect(map).toHaveAttribute("data-map-instance", drawingInstance!);
  // The retained drawing remains editable; removing a new point restores the original two-point measurement.
  await map.click({ position: await clearCanvasPoint(map, [first, second]) });
  await expect(page.getByText(/measure .* 3 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await page.getByTestId("browser-action-undo-draft").click();
  await expect(count).toBeVisible();
  await expect(page.getByTestId("browser-map-draft-measurement")).toHaveText(measurement);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect(await readWorkspace(page)).toEqual(saved);
  await info.attach("rejected-replacement-retained-drawing-390x844", { body: await page.screenshot(), contentType: "image/png" });
});

test("short Design canvas pans without geometry writes and context controls keep Prepare and Layout reachable", async ({ context, page }, info) => {
  await page.setViewportSize({ width: 900, height: 420 });
  await installDrawingImagery(page);
  await open(context, page, false, "Human field design", true);
  const map = await readyMap(page);
  const stored = await workspaceStorageBytes(page), before = await readWorkspace(page);
  const original = parseProjectDocument(before.projectDocuments[0].document);
  for (const width of [900, 760, 650]) {
    await page.setViewportSize({ width, height: 420 });
    await activateMapTool(page, "pan");
    await settledMapCamera(map);
    const canvas = (await map.locator("canvas.maplibregl-canvas").boundingBox())!;
    expect(canvas.height, "Visible short-screen canvas height").toBeGreaterThanOrEqual(180);
    expect(canvas.y).toBeGreaterThanOrEqual(0);
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(420);
    await expectClearCanvasArea(map);
    const toolbar = (await page.getByTestId("workspace-top-toolbar").boundingBox())!;
    const controls = page.getByTestId("workspace-command-bar").getByRole("button");
    const boxes = await controls.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { label: element.getAttribute("aria-label"), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    expect(boxes.length).toBeGreaterThan(2);
    for (const box of boxes) {
      expect(box.height, `${box.label} touch target`).toBeGreaterThanOrEqual(48);
      expect(box.y, `${box.label} stays inside toolbar`).toBeGreaterThanOrEqual(toolbar.y);
      expect(box.y + box.height, `${box.label} stays inside toolbar`).toBeLessThanOrEqual(toolbar.y + toolbar.height);
      if (width >= 760) {
        expect(box.x, `${box.label} stays inside viewport`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${box.label} stays inside viewport`).toBeLessThanOrEqual(width);
      }
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y,
        `${a.label} and ${b.label} do not overlap`).toBe(false);
    }
    if (width < 760) {
      const scroller = await page.getByTestId("workspace-command-bar").evaluate(element => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) {
            const box = parent.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height };
          }
        }
        return null;
      });
      expect(scroller, "Compact commands use an actual horizontal scroll surface").not.toBeNull();
      const disabledCommandHits: Array<Record<string, unknown>> = [];
      for (let index = 0; index < boxes.length; index++) {
        const control = controls.nth(index);
        let acceptedDisabledHit: Record<string, unknown> | null = null;
        // Normal focus can reveal an off-screen command; wheel events handle clipped disabled controls too.
        await control.focus();
        await expect.poll(async () => {
          const box = await control.boundingBox();
          if (!box || !scroller) return false;
          const fits = box.x >= scroller.x && box.x + box.width <= scroller.x + scroller.width
            && box.y >= scroller.y && box.y + box.height <= scroller.y + scroller.height;
          const probe = fits ? await control.evaluate(element => {
            const rect = element.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            const disabled = element.getAttribute("aria-disabled") === "true";
            const pointerEvents = getComputedStyle(element).pointerEvents;
            const interactive = hit?.closest('button,[role="button"],a,[role="link"],input,select,textarea') ?? null;
            const otherInteractive = interactive !== null && interactive !== element && !element.contains(interactive);
            const commandSurfaceContainsHit = !!element.closest('[data-testid="workspace-command-bar"]')?.contains(hit);
            const hitContainsControl = !!hit?.contains(element);
            const ancestors = [];
            for (let ancestor = hit; ancestor && ancestors.length < 6; ancestor = ancestor.parentElement) {
              ancestors.push({ tag: ancestor.tagName, testID: ancestor.getAttribute("data-testid"), role: ancestor.getAttribute("role"), containsControl: ancestor.contains(element) });
            }
            return {
              accepted: disabled ? pointerEvents === "none" && !otherInteractive && (commandSurfaceContainsHit || hitContainsControl) : element.contains(hit),
              disabled, pointerEvents, controlLabel: element.getAttribute("aria-label"), controlTestID: element.getAttribute("data-testid"),
              hitTag: hit?.tagName ?? null, hitTestID: hit?.getAttribute("data-testid") ?? null, hitRole: hit?.getAttribute("role") ?? null,
              commandSurfaceContainsHit, hitContainsControl, otherInteractive,
              closestInteractive: interactive ? { tag: interactive.tagName, testID: interactive.getAttribute("data-testid"), role: interactive.getAttribute("role") } : null,
              ancestors,
            };
          }) : null;
          if (probe?.accepted) {
            if (probe.disabled) acceptedDisabledHit = probe;
            return true;
          }
          await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
          await page.mouse.wheel((box.x < scroller.x ? -1 : 1) * Math.max(24, box.width * 0.75), 0);
          return false;
        }, { intervals: [100], timeout: 10_000, message: `${boxes[index].label} is reachable and hit-tested by focus and horizontal wheel scrolling` }).toBe(true);
        await expect(control).toBeInViewport({ ratio: 1 });
        await expect(page.getByTestId("design-context-open")).toBeInViewport({ ratio: 1 });
        if (acceptedDisabledHit) disabledCommandHits.push(acceptedDisabledHit);
      }
      await info.attach(`disabled-command-hit-targets-${width}x420`, { body: Buffer.from(JSON.stringify(disabledCommandHits, null, 2)), contentType: "application/json" });
    }
    await panClearCanvas(page, map);
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    await info.attach(`short-design-canvas-${width}x420-after-pan`, { body: await page.screenshot(), contentType: "image/png" });
    await activateMapTool(page, "edit");
    await page.getByTestId("browser-edit-select-boundary").click();
    await page.getByTestId("browser-edit-next-vertex").click();
    const selection = page.getByTestId("browser-edit-drag-handle");
    await expect(selection).toHaveAttribute("aria-label", /boundary vertex 2 of/);
    const selectedLabel = (await selection.getAttribute("aria-label"))!;
    const selectedCamera = await settledMapCamera(map);
    const instance = (await map.getAttribute("data-map-instance"))!;
    await expectReachableSelection(selection, map);
    await openProjectDrawer(page);
    await expect(page.getByTestId("workspace-main-content")).toBeHidden();
    await expect(map).toBeHidden();
    const shell = (await page.getByTestId("workspace-shell").boundingBox())!;
    const rail = (await page.getByTestId("workspace-rail").boundingBox())!;
    expect(rail.x).toBeCloseTo(shell.x, 1);
    expect(rail.width).toBeCloseTo(shell.width, 1);
    await info.attach(`short-design-foreground-drawer-${width}x420`, { body: await page.screenshot(), contentType: "image/png" });
    await page.getByRole("button", { name: "Collapse project drawer", exact: true }).click();
    await settledMapCamera(map);
    await expect(selection).toHaveAttribute("aria-label", selectedLabel);
    await expectReachableSelection(selection, map);
    await expect(map).toHaveAttribute("data-map-camera", selectedCamera);
    await expect(map).toHaveAttribute("data-map-instance", instance);
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    const opener = page.getByTestId("design-context-open");
    const dialog = page.getByRole("dialog", { name: "Design context", exact: true });
    await opener.focus();
    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Human input farm");
    await expect(dialog).toContainText("Human field");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await opener.press("Enter");
    await expect(dialog).toBeVisible();
    await info.attach(`short-design-context-${width}x420`, { body: await page.screenshot(), contentType: "image/png" });
    await dialog.getByTestId("prepare-rtk-layout").click();
    await expect(page.getByTestId("prepare-layout-panel")).toBeVisible();
    await expect(page.getByTestId("prepare-create-field")).toBeEnabled();
    await page.getByTestId("prepare-layout-close").click();
    await opener.click();
    await dialog.getByTestId("open-layout-sessions").click();
    await expectCurrentTask(page, "layout");
    await expect(page.getByTestId("layout-session-catalog")).toBeVisible();
    await page.getByTestId("task-design").click();
    await expectCurrentTask(page, "design");
    await expect(map).toBeVisible();
    // Tall narrow screens retain compact context; wide screens leave this mode and dismiss it.
    await opener.click();
    await expect(dialog).toBeVisible();
    await page.setViewportSize({ width, height: 620 });
    if (width < 760) {
      await expect(dialog).toBeVisible();
      await dialog.getByTestId("design-context-close").click();
      await expect(opener).toBeFocused();
    } else await expect(dialog).toBeHidden();
    await page.setViewportSize({ width, height: 420 });
    await expect(dialog).toBeHidden();
    expect(canonicalProjectGeometry(await currentProjectArchive(page))).toEqual(canonicalProjectGeometry(original));
    await page.getByTestId("task-design").click();
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    expect(await readWorkspace(page)).toEqual(before);
  }
});

test("portrait Design context keeps keyboard return and both Layout actions reachable without changing the retained map", async ({ context, page }, info) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await installDrawingImagery(page);
  await open(context, page, false, "Human field design", true);
  const map = await readyMap(page);
  const stored = await workspaceStorageBytes(page), saved = await readWorkspace(page);
  const fieldName = saved.catalog.fieldMaps.find(field => field.id === "human-map")!.name;
  await activateMapTool(page, "edit");
  await page.getByTestId("browser-edit-select-boundary").click();
  await page.getByTestId("browser-edit-next-vertex").click();
  const selection = page.getByTestId("browser-edit-drag-handle");
  const selectedLabel = (await selection.getAttribute("aria-label"))!;
  const initialCamera = JSON.parse(await settledMapCamera(map)) as number[];
  const node = await map.elementHandle();
  const opener = page.getByTestId("design-context-open");
  const dialog = page.getByRole("dialog", { name: "Design context", exact: true });
  for (const height of [600, 844]) {
    await page.setViewportSize({ width: 390, height });
    const camera = await settledMapCamera(map);
    expect((JSON.parse(camera) as number[]).slice(2), "Resize preserves zoom, bearing and pitch while revealing the selected vertex").toEqual(initialCamera.slice(2));
    await expect(selection).toHaveAttribute("aria-label", selectedLabel);
    const instance = (await map.getAttribute("data-map-instance"))!;
    await expect(opener).toBeVisible(); await expect(opener).toBeInViewport({ ratio: 1 });
    await expect(opener).toHaveAccessibleName(`Design context: Human input farm → Human field → ${fieldName} → ${sampleProject.name}`);
    const target = (await opener.boundingBox())!;
    expect(target.height, "Portrait context has a 48px touch target").toBeGreaterThanOrEqual(48);
    expect(target.width).toBeGreaterThanOrEqual(48);
    expect(target.x).toBeGreaterThanOrEqual(0); expect(target.x + target.width).toBeLessThanOrEqual(390);
    expect(await opener.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), "Context trigger receives ordinary pointer input").toBe(true);
    await opener.focus(); await opener.press("Enter");
    await expect(dialog).toBeVisible();
    for (const part of ["Human input farm", "Human field", fieldName, sampleProject.name]) await expect(dialog).toContainText(part);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
    await opener.press("Enter");
    await expect(dialog).toBeVisible();
    const prepare = dialog.getByTestId("prepare-rtk-layout"), sessions = dialog.getByTestId("open-layout-sessions");
    await expect(prepare).toBeInViewport({ ratio: 1 }); await expect(sessions).toBeInViewport({ ratio: 1 });
    for (const action of [prepare, sessions]) {
      expect(await action.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), "Layout action receives normal pointer input").toBe(true);
    }
    await info.attach(`portrait-design-context-390x${height}`, { body: await page.screenshot(), contentType: "image/png" });
    await dialog.getByTestId("design-context-close").click();
    await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
    await expect(map).toHaveAttribute("data-map-instance", instance);
    await expect(map).toHaveAttribute("data-map-camera", camera);
    await expect(selection).toHaveAttribute("aria-label", selectedLabel);
    expect(await workspaceStorageBytes(page)).toEqual(stored);

    await opener.click(); await dialog.getByTestId("prepare-rtk-layout").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("prepare-layout-panel")).toBeVisible();
    await expect(page.getByTestId("prepare-create-field")).toBeEnabled();
    await page.getByTestId("prepare-layout-close").click();
    await expect(map).toHaveAttribute("data-map-instance", instance);
    await expect(map).toHaveAttribute("data-map-camera", camera);
    await expect(selection).toHaveAttribute("aria-label", selectedLabel);
    await opener.click(); await dialog.getByTestId("open-layout-sessions").click();
    await expect(dialog).toBeHidden(); await expectCurrentTask(page, "layout");
    await expect(page.getByTestId("layout-session-catalog")).toBeVisible();
    await page.getByTestId("task-design").click(); await expectCurrentTask(page, "design");
    await expect(map).toBeVisible(); await settledMapCamera(map);
    await expect(map).toHaveAttribute("data-map-camera", camera);
    await expect(selection).toHaveAttribute("aria-label", selectedLabel);
    expect(await node!.evaluate(element => element.isConnected && element === document.querySelector('[aria-label="CPLayout MapLibre imagery workbench"]'))).toBe(true);
    expect(await workspaceStorageBytes(page)).toEqual(stored); expect(await readWorkspace(page)).toEqual(saved);
  }
});

test("customer Open shows the selected details and its callback cannot retire an unfinished customer form", async ({ context, page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await open(context, page);
  const stored = await workspaceStorageBytes(page), saved = await readWorkspace(page);
  await page.getByTestId("task-projects").click();
  await expectCurrentTask(page, "projects"); await expect(page.getByTestId("dashboard-workspace")).toBeVisible();
  await openProjectDrawer(page);
  const customerOpen = page.getByTestId("catalog-client-human-client-open");
  await expect(customerOpen).toBeInViewport({ ratio: 1 });
  await customerOpen.click();
  await expect(page.getByTestId("client-detail-panel")).toBeVisible();
  await expect(page.getByTestId("client-detail-panel")).toContainText("Human input farm");
  await expect(page.getByTestId("workspace-main-content")).toBeVisible();
  await expect(page.getByTestId("left-drawer-handle")).toHaveAccessibleName("Open project drawer");
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await openProjectDrawer(page);
  await page.getByTestId("project-tree-action-more").click();
  await page.getByTestId("project-tree-action-client").click();
  const form = page.getByTestId("client-profile-dialog"); const firstName = page.getByTestId("client-profile-first-name-input");
  await expect(form).toBeVisible(); await firstName.fill("  Retain this unfinished contact  ");
  const input = await firstName.elementHandle();
  // Synthetic callback guard only: the real modal correctly prevents normal clicks on the tree behind it.
  await customerOpen.evaluate(element => (element as HTMLElement).click());
  await expect(form).toBeVisible();
  await expect(firstName).toHaveValue("  Retain this unfinished contact  ");
  expect(await input!.evaluate(element => element.isConnected && element === document.querySelector('[data-testid="client-profile-first-name-input"]'))).toBe(true);
  expect(await workspaceStorageBytes(page)).toEqual(stored); expect(await readWorkspace(page)).toEqual(saved);
  await page.getByTestId("client-profile-cancel").click();
  await expect(form).toBeHidden();
});

test("primary tasks preserve unapplied machine input and block replacement of unfinished work", async ({ context, page }) => {
  await open(context, page, false, "Human field design — North quarter beside the irrigation supply road and original boundary survey");
  await expectCurrentTask(page, "design");
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  const before = await readWorkspace(page);
  const beforeBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  const span = page.getByTestId("field-input-span-0");
  const originalSpan = await span.inputValue();
  await span.fill("-");
  await page.getByTestId("task-projects").click();
  await expectCurrentTask(page, "projects");
  await expect(page.getByTestId("dashboard-workspace")).toBeVisible();
  await page.getByTestId("task-layout").click();
  await expectCurrentTask(page, "layout");
  await expect(page.getByTestId("layout-session-catalog")).toBeVisible();
  await page.getByTestId("task-survey").click();
  await expectCurrentTask(page, "survey");
  await expect(page.getByTestId("retained-design-survey")).toContainText("Human field design");
  await expect(page.getByTestId("retained-design-survey")).toContainText("capture for this independent-machine field is not available");
  await page.getByTestId("task-design").click();
  await expectCurrentTask(page, "design");
  await expect(span).toHaveValue("-");
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("task-projects").click();
  await expectCurrentTask(page, "projects");
  await openProjectDrawer(page);
  await page.getByTestId("catalog-design-human-source-open").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await expectCurrentTask(page, "design");
  await expect(span).toHaveValue("-");
  await expect(page.getByText("Your open design has unfinished work.", { exact: false })).toBeVisible();
  expect(await readWorkspace(page)).toEqual(before);

  for (const viewport of [{ width: 390, height: 430 }, { width: 900, height: 420 }]) {
    await scrollFieldControlIntoView(page, span);
    await span.click();
    const retainedInput = await span.elementHandle();
    await page.setViewportSize(viewport);
    await expect(span).toBeFocused();
    expect(await retainedInput!.evaluate(node => node === document.querySelector('[data-testid="field-input-span-0"]'))).toBe(true);
    await expect(span).toHaveValue("-");
    const body = await page.getByTestId("field-content-scroll").boundingBox();
    expect(body).not.toBeNull();
    expect(body!.height).toBeGreaterThanOrEqual(96);
    expect(body!.y).toBeGreaterThanOrEqual(0);
    expect(body!.y + body!.height).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByTestId("field-save")).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId("field-calculate")).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const form = await page.getByTestId("field-machine-form").boundingBox();
    const handoff = await page.getByTestId("field-layout-handoff").boundingBox();
    expect(form!.y + form!.height).toBeLessThanOrEqual(handoff!.y);
    await scrollFieldControlIntoView(page, span);
    await span.click();
    await expect(span).toBeFocused();
    await expect(page.getByTestId("field-save")).toBeDisabled();
    await expect(page.getByTestId("field-calculate")).toBeDisabled();
    await test.info().attach(`field-input-recovery-${viewport.width}x${viewport.height}`, {
      body: await page.screenshot(), contentType: "image/png",
    });
    if (viewport.width === 390) {
      // A failed Apply reveals feedback once. Returning later must not reveal that same message again.
      await scrollFieldControlIntoView(page, page.getByTestId("field-apply-machine"));
      await page.getByTestId("field-apply-machine").click();
      const feedback = page.getByTestId("field-feedback");
      await expect(feedback).toBeInViewport();
      const previousFeedback = await feedback.textContent();
      expect(previousFeedback).toBeTruthy();
      await test.info().attach("field-failed-apply-feedback-390x430", {
        body: await page.screenshot(), contentType: "image/png",
      });
      await scrollFieldControlIntoView(page, span);
      await span.click();
      const scroll = page.getByTestId("field-content-scroll");
      // Keep the focused input fully visible one-third down the body. A scroll-to-top bug
      // followed by browser focus centering or nearest-edge recovery cannot recreate this offset.
      const scrollBox = (await scroll.boundingBox())!;
      const inputBox = (await span.boundingBox())!;
      await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
      await page.mouse.wheel(0, inputBox.y + inputBox.height / 2 - scrollBox.y - scrollBox.height / 3);
      await expect.poll(async () => {
        const currentInput = (await span.boundingBox())!;
        const currentScroll = (await scroll.boundingBox())!;
        return Math.abs(currentInput.y + currentInput.height / 2 - currentScroll.y - currentScroll.height / 3);
      }).toBeLessThan(2);
      await expect(span).toBeFocused();
      await expect(span).toBeInViewport({ ratio: 1 });
      const positionedInput = (await span.boundingBox())!;
      expect(positionedInput.y - scrollBox.y).toBeGreaterThan(12);
      expect(scrollBox.y + scrollBox.height - positionedInput.y - positionedInput.height).toBeGreaterThan(12);
      const previousScroll = await scroll.evaluate(node => node.scrollTop);
      expect(previousScroll).toBeGreaterThan(96);
      const previousInput = await span.elementHandle();
      await page.getByTestId("task-projects").click();
      await expect(page.getByTestId("dashboard-workspace")).toBeVisible();
      await page.getByTestId("task-design").click();
      // Do not click, focus, or scroll any editor control before these return-state assertions.
      await expect(span).toBeFocused();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await scroll.evaluate(node => node.scrollTop)).toBeCloseTo(previousScroll, 0);
      expect(await previousInput!.evaluate(node => node === document.querySelector('[data-testid="field-input-span-0"]'))).toBe(true);
      await expect(span).toBeInViewport({ ratio: 1 });
      await expect(span).toHaveValue("-");
      await expect(feedback).toHaveText(previousFeedback!);
      expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
    }
    await scrollFieldControlIntoView(page, page.getByTestId("field-discard-inputs"));
    await page.getByTestId("field-discard-inputs").click();
    await expect(span).toHaveValue(originalSpan);
    await expect(page.getByTestId("field-save-state")).toContainText("Saved");
    expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
    if (viewport.width === 390) {
      await scrollFieldControlIntoView(page, span);
      await span.fill("-");
    }
  }
  // Recovery releases the replacement guard without writing the original workspace.
  await page.getByTestId("task-projects").click();
  await openProjectDrawer(page);
  await page.getByTestId("catalog-design-human-source-open").click();
  await expect(page.getByTestId("field-design-workspace")).toHaveCount(0);
  await expect(page.getByTestId("map-view")).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
});

test("short Projects keeps its body and navigation usable while create, import and reopen preserve saved context and bytes", async ({ context, page }, info) => {
  await page.setViewportSize({ width: 390, height: 430 });
  await open(context, page);
  const before = await readWorkspace(page), stored = await workspaceStorageBytes(page);
  const main = page.getByTestId("workspace-main-content");
  const dashboard = page.getByTestId("dashboard-workspace");
  await page.getByTestId("task-projects").click();
  await expectCurrentTask(page, "projects");
  await expect(dashboard).toBeVisible();
  await expect(page.getByTestId("left-drawer-handle")).toHaveAccessibleName("Open project drawer");
  const shell = (await page.getByTestId("workspace-shell").boundingBox())!;
  const body = (await main.boundingBox())!;
  const collapsedRail = (await page.getByTestId("workspace-rail").boundingBox())!;
  expect(body.height, "Short Projects retains a usable scrolling body").toBeGreaterThanOrEqual(96);
  expect(body.width, "Collapsed drawer leaves a readable Projects body").toBeGreaterThanOrEqual(300);
  expect(body.width).toBeCloseTo(shell.width - collapsedRail.width, 1);
  expect(body.y).toBeGreaterThanOrEqual(0);
  expect(body.y + body.height).toBeLessThanOrEqual(430);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const task of ["survey", "layout", "projects"] as const) {
    const command = page.getByTestId(`task-${task}`);
    await expect(command).toBeInViewport({ ratio: 1 });
    await command.click();
    await expectCurrentTask(page, task);
    expect(await workspaceStorageBytes(page)).toEqual(stored);
  }
  await openProjectDrawer(page);
  await expect(main).toBeHidden();
  const rail = (await page.getByTestId("workspace-rail").boundingBox())!;
  expect(rail.width).toBeCloseTo(shell.width, 1);
  await expect(page.getByTestId("catalog-design-human-field")).toHaveAttribute("aria-selected", "true");
  await info.attach("short-projects-foreground-catalog-390x430", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "Collapse project drawer", exact: true }).click();
  await expect(dashboard).toBeVisible();
  await scrollProjectsControlIntoView(page, dashboard.getByTestId("start-create-customer"));
  await expectUnobstructedProjectsControl(dashboard.getByTestId("start-import"));
  await dashboard.getByTestId("start-create-customer").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByTestId("client-profile-first-name-input").fill("  Uncommitted short customer  ");
  await expect(page.getByTestId("client-profile-save")).toBeInViewport({ ratio: 1 });
  await page.getByTestId("client-profile-cancel").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  expect(await workspaceStorageBytes(page)).toEqual(stored);

  await dashboard.getByTestId("start-import").click();
  const review = page.getByTestId("catalog-archive-import");
  await expect(review).toBeVisible();
  const choosing = page.waitForEvent("filechooser");
  await review.getByTestId("catalog-import-choose").click();
  await (await choosing).setFiles({ name: "short-projects-source.json", mimeType: "application/json", buffer: Buffer.from(serializeProjectDocument(sampleProject)) });
  await expect(review.getByTestId("catalog-import-preview")).toContainText(sampleProject.name);
  await review.getByTestId("catalog-import-field").selectOption("human-map");
  await review.getByTestId("catalog-import-name").fill("  Retained short import  ");
  await page.getByTestId("task-design").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await page.getByTestId("task-projects").click();
  await expect(review).toBeVisible();
  await expect(review.getByTestId("catalog-import-filename")).toHaveText("short-projects-source.json");
  await expect(review.getByTestId("catalog-import-field")).toHaveValue("human-map");
  await expect(review.getByTestId("catalog-import-name")).toHaveValue("  Retained short import  ");
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await review.getByTestId("catalog-import-back").click();
  await page.getByTestId("catalog-import-discard-confirm").click();
  await expect(review).toHaveCount(0);
  await expect(dashboard).toBeVisible();
  await scrollProjectsControlIntoView(page, dashboard.getByTestId("recent-work").getByText("Recent work", { exact: true }));
  const beforeStatusScroll = await main.evaluate(element => element.scrollTop);
  await scrollProjectsControlIntoView(page, dashboard.getByTestId("catalog-home-status").getByText("Storage details", { exact: true }));
  expect(await main.evaluate(element => element.scrollTop), "Storage details remain reachable after scrolling past recent work").toBeGreaterThan(beforeStatusScroll);
  await expect(dashboard.getByTestId("catalog-home-status")).toContainText(/Browser local storage/);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await info.attach("short-projects-body-390x430", { body: await page.screenshot(), contentType: "image/png" });
  await dashboard.getByTestId("recent-design-human-field").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await expect(page.getByTestId("field-design-workspace")).toContainText("Human field design");
  await expectCurrentTask(page, "design");
  await page.getByTestId("task-projects").click();
  await expect(page.getByTestId("left-drawer-handle")).toHaveAccessibleName("Open project drawer");
  await openProjectDrawer(page);
  await expect(page.getByTestId("catalog-design-human-field")).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Collapse project drawer", exact: true }).click();
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect(await readWorkspace(page)).toEqual(before);
});

test("Projects renders previews from each saved document without changing its bytes", async ({ context, page }, info) => {
  await open(context, page);
  const before = await readWorkspace(page), stored = await workspaceStorageBytes(page);
  await page.getByTestId("task-projects").click();
  await expect(page.getByTestId("saved-design-preview-human-field")).toBeVisible();
  await expect(page.getByTestId("saved-design-preview-human-source")).toBeVisible();
  await expect(page.getByTestId("saved-design-preview-human-field")).toContainText("Field design");
  await page.setViewportSize({ width: 390, height: 600 });
  const dashboard = page.getByTestId("dashboard-workspace");
  const handle = page.getByTestId("left-drawer-handle");
  await expect(dashboard).toBeVisible();
  await expect(page.getByTestId("saved-design-preview-human-field")).toBeVisible();
  await expect(page.getByTestId("saved-design-preview-human-source")).toBeVisible();
  await expect(handle).toHaveAccessibleName("Open project drawer");
  const create = dashboard.getByTestId("start-create-customer"), importAction = dashboard.getByTestId("start-import");
  await expectUnobstructedProjectsControl(create);
  await expectUnobstructedProjectsControl(importAction);
  await create.click();
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByTestId("client-profile-cancel").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await importAction.click();
  await expect(page.getByTestId("catalog-archive-import")).toBeVisible();
  await page.getByTestId("catalog-import-back").click();
  await expect(page.getByTestId("catalog-archive-import")).toHaveCount(0);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await info.attach("projects-resize-reveals-dashboard-390x600", { body: await page.screenshot(), contentType: "image/png" });
  await handle.click();
  await expect(dashboard).toBeHidden();
  await expect(handle).toHaveAccessibleName("Collapse project drawer");
  await page.setViewportSize({ width: 740, height: 900 });
  await expect(handle).toHaveAccessibleName("Collapse project drawer");
  await page.setViewportSize({ width: 650, height: 430 });
  await expect(handle).toHaveAccessibleName("Collapse project drawer");
  await expect(dashboard).toBeHidden();
  const landscapeShell = (await page.getByTestId("workspace-shell").boundingBox())!;
  const landscapeRail = (await page.getByTestId("workspace-rail").boundingBox())!;
  expect(landscapeRail.width).toBeCloseTo(landscapeShell.width, 1);
  await page.setViewportSize({ width: 360, height: 620 });
  await expect(handle).toHaveAccessibleName("Collapse project drawer");
  await expect(dashboard).toBeHidden();
  const shell = (await page.getByTestId("workspace-shell").boundingBox())!;
  const rail = (await page.getByTestId("workspace-rail").boundingBox())!;
  expect(rail.width).toBeCloseTo(shell.width, 1);
  expect(await readWorkspace(page)).toEqual(before);
  await handle.click();
  await expect(handle).toHaveAccessibleName("Open project drawer");
  await expect(dashboard).toBeVisible();
  await expect(page.getByTestId("saved-design-preview-human-field")).toBeVisible();
  await expect(page.getByTestId("saved-design-preview-human-source")).toBeVisible();
  await page.getByTestId("recent-design-human-field").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  expect(await readWorkspace(page)).toEqual(before);
});


test("saved import retry and close preserve unfinished field input and commit only one independent copy", async ({ context, page }) => {
  await open(context, page);
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  const before = await readWorkspace(page);
  const beforeBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  const originalField = parseFieldDesignDocument(before.fieldDocuments![0].document);
  const span = page.getByTestId("field-input-span-0");
  await span.fill("-");
  await page.getByTestId("task-projects").click();
  const dashboard = page.getByTestId("dashboard-workspace");
  await expect(dashboard).toBeVisible();
  await dashboard.getByTestId("start-import").click();
  const review = page.getByTestId("catalog-archive-import");
  await expect(review).toBeVisible();
  const sourceDocument = serializeProjectDocument(sampleProject);
  const choosing = page.waitForEvent("filechooser");
  await review.getByTestId("catalog-import-choose").click();
  await (await choosing).setFiles({ name: "human-import-copy.json", mimeType: "application/json", buffer: Buffer.from(sourceDocument) });
  await expect(review.getByTestId("catalog-import-preview")).toContainText(sampleProject.name);
  await review.getByTestId("catalog-import-field").selectOption("human-map");
  await review.getByTestId("catalog-import-name").fill("Saved sibling awaiting activation");
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
  await expect(review.getByTestId("catalog-import-copy")).toHaveAccessibleName("Import copy");
  await review.getByTestId("catalog-import-copy").click();

  // Import commits its copy, but activation must not replace the retained unfinished field.
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await expectCurrentTask(page, "design");
  await expect(span).toHaveValue("-");
  await expect(page.getByText("Your open design has unfinished work.", { exact: false })).toBeVisible();
  const saved = await readWorkspace(page);
  const savedBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  expect(savedBytes).not.toBe(beforeBytes);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.projectDocuments).toHaveLength(before.projectDocuments.length + 1);
  expect(saved.catalog.designs).toHaveLength(before.catalog.designs.length + 1);
  expect(saved.fieldDocuments).toEqual(before.fieldDocuments);
  expect(saved.draftDocuments).toEqual(before.draftDocuments);
  expect(saved.catalog.clients).toEqual(before.catalog.clients);
  expect(saved.catalog.projects).toEqual(before.catalog.projects);
  expect(saved.catalog.fieldMaps).toEqual(before.catalog.fieldMaps);
  for (const entry of before.projectDocuments) {
    expect(saved.projectDocuments.find(item => item.summary.id === entry.summary.id)).toEqual(entry);
  }
  for (const design of before.catalog.designs) {
    expect(saved.catalog.designs.find(item => item.id === design.id)).toEqual(design);
  }
  const copies = saved.catalog.designs.filter(item => !before.catalog.designs.some(previous => previous.id === item.id));
  expect(copies).toHaveLength(1);
  const copy = copies[0];
  expect(copy).toMatchObject({ kind: "project", fieldMapId: "human-map", name: "Saved sibling awaiting activation" });
  if (copy.kind !== "project") throw new Error("Expected an imported complete-design copy");
  const importedEntry = saved.projectDocuments.find(item => item.summary.id === copy.pivotProjectId)!;
  const imported = JSON.parse(importedEntry.document).project;
  expect(imported.id).not.toBe(sampleProject.id);
  expect(imported.name).toBe("Saved sibling awaiting activation");
  // WGS84 is derived display data; all canonical projected geometry and recorded evidence stay exact.
  const canonical = (project: Record<string, unknown>) => Object.fromEntries(
    Object.entries(project).filter(([key]) => !["id", "name", "wgs84Companion"].includes(key)));
  expect(canonical(imported)).toEqual(canonical(JSON.parse(sourceDocument).project));

  await page.getByTestId("task-projects").click();
  await expect(review).toBeVisible();
  await expect(review.getByRole("status")).toContainText("Copy saved");
  await expect(review.getByTestId("catalog-import-name")).not.toBeEditable();
  await expect(review.getByTestId("catalog-import-field")).toBeDisabled();
  await expect(review.getByTestId("catalog-import-copy")).toHaveAccessibleName("Open saved copy");
  await review.getByTestId("catalog-import-copy").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await expectCurrentTask(page, "design");
  await expect(span).toHaveValue("-");
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
  expect(await readWorkspace(page)).toEqual(saved);
  expect(parseFieldDesignDocument((await readWorkspace(page)).fieldDocuments![0].document)).toEqual(originalField);

  await page.getByTestId("task-projects").click();
  await expect(review).toBeVisible();
  await expect(review.getByRole("status")).toContainText("Copy saved");
  await expect(review.getByTestId("catalog-import-back")).toHaveAccessibleName("Close import review");
  await review.getByTestId("catalog-import-back").click();
  await expect(page.getByTestId("catalog-import-discard")).toContainText("The imported copy remains saved in its field.");
  await page.getByRole("button", { name: "Close review", exact: true }).click();
  await expect(page.getByTestId("catalog-import-discard-backdrop")).toHaveCount(0);
  await expect(review).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
  expect(await readWorkspace(page)).toEqual(saved);
  expect((await readWorkspace(page)).projectDocuments.find(item => item.summary.id === copy.pivotProjectId)?.document).toBe(importedEntry.document);
  await page.getByTestId("task-design").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await expect(span).toHaveValue("-");
  expect(parseFieldDesignDocument((await readWorkspace(page)).fieldDocuments![0].document)).toEqual(originalField);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
});
