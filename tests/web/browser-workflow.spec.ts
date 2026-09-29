import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readWorkspace, workspaceStorageBytes } from "./workspace-fixtures";
import { activateMapTool } from "./map-toolbar";
import { unobstructedMapPoint } from "./map-hit-point";
import { connectOperationalReceiver, emitGga, gga, installOperationalReceiver, type ReceiverFixtureWindow } from "./operational-receiver-fixture";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { defaultAppSettings, parseProjectDocument, projectXyToLonLat } from "../../packages/core/src";

const routeScreens = [
  { nav: "workspace-nav-dashboard", screen: "dashboard-workspace" },
  { nav: "workspace-nav-help", screen: "help-view" },
  { nav: "workspace-nav-map", screen: "map-view" },
  { nav: "workspace-nav-survey", screen: "survey-view" },
  { nav: "workspace-nav-files", screen: "files-view" },
  { nav: "workspace-nav-settings", screen: "settings-view" },
] as const;

test.beforeEach(async ({ page }, testInfo) => {
  await captureConsoleFailures(page);
  const strictOffline = testInfo.title.includes("offline");
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (isAllowedNetworkRequest(url, strictOffline)) {
      void route.continue();
      return;
    }
    void route.abort("blockedbyclient");
  });
});

test("workspace remains usable through the SVG map fallback when WebGL is unavailable", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value(contextId: string, ...args: unknown[]) {
        if (contextId === "webgl" || contextId === "webgl2" || contextId === "experimental-webgl") return null;
        return Reflect.apply(originalGetContext, this, [contextId, ...args]);
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("browser-map-renderer-fallback")).toBeVisible();
  await expect(page.getByTestId("browser-map-renderer-fallback-notice")).toContainText("Offline SVG map mode is active");
  await expect(page.getByTestId("layout-map-svg")).toBeVisible();
  await openBaselineSample(page);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("layout-map-svg")).toBeVisible();
  await expect(page.getByTestId("svg-map-status-notices")).toBeVisible();
  await expect(page.getByTestId("maplibre-preview-fallback")).toHaveCount(0);
  await expectNoOverlapIfVisible(page, "svg-map-status-notices", "map-bottom-hud");
  await selectEditTool(page);
  await page.getByRole("button", { name: "Select first boundary vertex" }).click();
  const svgBounds = await page.getByTestId("layout-map-svg").boundingBox();
  expect(svgBounds).not.toBeNull();
  if (svgBounds) {
    const viewBoxBeforePan = await page.getByTestId("layout-map-svg").getAttribute("viewBox");
    expect(viewBoxBeforePan).toBeTruthy();
    const { x, y } = await unobstructedMapPoint(page.getByTestId("layout-map-svg"),
      { x: svgBounds.x + svgBounds.width * 0.6, y: svgBounds.y + svgBounds.height * 0.4 }, "svg");
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 35, y + 20, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByTestId("layout-map-svg")).not.toHaveAttribute("viewBox", viewBoxBeforePan!);
    await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  }
  await expect(page.getByTestId("svg-edit-insert-vertex")).toBeEnabled();
  await page.getByTestId("svg-edit-insert-vertex").click();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  if (testInfo.project.name === "mobile-390") {
    const scroller = page.getByTestId("svg-draft-command-scroller");
    expect(await scroller.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await scroller.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    const clear = page.getByRole("button", { name: "Clear draft vertices", exact: true });
    await expect(clear).toBeVisible();
    expect(await clear.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === element || element.contains(hit);
    }), "the far-right draft command must be hittable after scrolling").toBe(true);
    await clear.click();
    expect(await page.getByTestId("svg-map-shell").evaluate(element => element.scrollLeft)).toBe(0);
    await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  }
  if (testInfo.project.name !== "desktop") {
    await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60_000 });
    await expectNoOverlapIfVisible(page, "svg-map-draft-hud", "map-bottom-hud");
    if (page.viewportSize()!.width < 760) await expectNoOverlapIfVisible(page, "svg-map-draft-hud", "layout-map-svg");
    else await expectInsideContainer(page, "svg-map-draft-hud", "layout-map-drawing-surface");
    await expectNoOverlapIfVisible(page, "svg-map-zoom-controls", "map-bottom-hud");
    await expectNoOverlapIfVisible(page, "svg-map-zoom-controls", "svg-map-compact-legend");
    await expectInsideContainer(page, "svg-map-zoom-controls", "layout-map-drawing-surface");
    await expectMinTargetSize(page, "layout-map-svg", 260, 170);
    await expectNoHorizontalOverflow(page);
    const stored = await workspaceStorageBytes(page);
    const viewBox = await page.getByTestId("layout-map-svg").getAttribute("viewBox");
    const layerStatusOpen = page.getByTestId("svg-map-layer-status-open");
    if (await layerStatusOpen.isVisible()) {
      await layerStatusOpen.click();
      const layerStatus = page.getByTestId("svg-map-layer-status-dialog");
      await expect(layerStatus).toBeVisible();
      await expect(layerStatus).toContainText("Imagery unavailable");
      await expect(layerStatus).toContainText("Reference overlays unavailable");
      await expect.poll(() => layerStatus.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await layerStatus.screenshot({ path: testInfo.outputPath("svg-layer-status-details.png"), animations: "disabled" });
      await layerStatus.getByRole("button", { name: "Close map layer status", exact: true }).click();
      await expect(layerStatus).toHaveCount(0);
    } else {
      const inlineStatus = page.getByTestId("svg-map-status-notices");
      await expect(inlineStatus).toContainText("Imagery unavailable");
      await expect(inlineStatus).toContainText("Reference overlays unavailable");
    }
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    await expect(page.getByTestId("layout-map-svg")).toHaveAttribute("viewBox", viewBox!);
  }
  await saveScreen(page, testInfo, "webgl-svg-map-fallback");
});

test("launcher and workspace route sweep stay usable without paid APIs or hidden keys", async ({ page }, testInfo) => {
  test.slow();
  const networkLog: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(testInfo.project.use.baseURL ?? "")) networkLog.push(url);
  });

  await page.goto("/");
  await expect(page.getByTestId("workspace-screen")).toBeVisible();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("CPLayout");
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
  await expect(page.getByTestId("browser-map-workbench")).toContainText(/Client\/project catalog view|Catalog/);
  await expect(page.locator(".maplibregl-canvas").first()).toHaveCSS("position", "absolute");
  await expect(page.getByText("Will Rhea / Jason Harmelink Example Map")).toHaveCount(0);
  await expect(page.getByTestId("browser-workflow-layout")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("design-action-polygon")).toHaveCount(0);
  await expectTopToolbarSingleRow(page);
  await expectPassiveBottomStatusBar(page);
  await expect(page.getByTestId("workspace-nav-review")).toHaveCount(0);
  await expect(page.getByTestId("review-view")).toHaveCount(0);
  if (await page.getByRole("button", { name: "Open project drawer" }).count() > 0) {
    await expect(page.getByTestId("left-drawer-handle")).toBeVisible();
  } else {
    await expect(page.getByTestId("project-tree-rail")).toBeVisible();
  }
  await saveScreen(page, testInfo, "map-first-launcher");

  await openBaselineSample(page);
  await expect(page.getByTestId("workspace-screen")).toBeVisible();

  for (const routeScreen of routeScreens) {
    await page.getByTestId(routeScreen.nav).click();
    await expect(page.getByTestId(routeScreen.screen)).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await saveScreen(page, testInfo, routeScreen.screen);
  }

  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByTestId("design-builder-panel")).toHaveCount(0);
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("workflow-sidebar-tab-tools")).toBeVisible();
  await expect(page.getByTestId("map-bottom-hud")).toHaveCount(1);
  await expect(page.getByTestId("inspector-scroll").getByTestId("design-action-pan")).toHaveCount(0);
  await closeInspectorIfOpen(page);
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await expect(page.getByTestId("design-builder-scenarios")).toContainText("Current layout");
  await page.getByTestId("design-console-close").click();
  await openLayersSheet(page);
  await expect(page.getByTestId("places-layers-summary")).toContainText("Live Preview Imagery");
  await expect(page.getByTestId("places-layers-summary")).toContainText("Reference Overlays");
  await expect(page.getByRole("button", { name: "USGS Only", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: /Overlay (On|Off)/ })).toBeEnabled();
  await page.getByTestId("design-console-close").click();
  await expect(page.getByTestId("browser-workflow-design")).toBeVisible();
  await selectBoundaryTool(page);
  await clickWorkbenchMap(page, { x: 180, y: 180 });
  await expect(page.getByText(/measure .* 1 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await selectPanTool(page);
  await expect(page.getByText(/pan mode selected\. No draft vertices are pending\./i)).toBeVisible();
  await selectPipelineTool(page);
  await expect(page.getByText("measure · 0 draft pts · line needs 2 pts")).toBeVisible();
  await selectPumpFeatureTool(page);
  await expect(page.getByText("measure · 0 draft pts · capture point, then choose purpose")).toBeVisible();
  if (testInfo.project.name === "mobile-390") {
    await expect(page.getByText("Saved")).toBeVisible();
    await expectNoOverlapIfVisible(page, "workspace-bottom-status-bar", "map-bottom-hud");
    await expectNoOverlap(page, "workspace-bottom-status-bar", "browser-map-status-hud");
    await expectNoOverlap(page, "workspace-bottom-status-bar", "browser-map-attribution-hud");
    await saveScreen(page, testInfo, "mobile-map-route-sweep-compact");
    return;
  }
  await selectPanTool(page);
  await page.getByTestId("browser-workflow-layout").click();
  await expect(page.getByText("Layout mode: RTK-only geometry changes; pointer gestures inspect only.")).toBeVisible();
  await clickWorkbenchMap(page, { x: 120, y: 160 });
  await expect(page.getByText("Layout mode is RTK-only; switch to Design for pointer-based geometry edits.")).toBeVisible();
  await expect(page.getByText("Saved")).toBeVisible();
  await expectNoOverlap(page, "browser-map-status-hud", "browser-map-attribution-hud");
  await expectNoOverlapIfVisible(page, "workspace-bottom-status-bar", "map-bottom-hud");
  await expectNoOverlap(page, "workspace-bottom-status-bar", "browser-map-status-hud");
  await expectNoOverlap(page, "workspace-bottom-status-bar", "browser-map-attribution-hud");

  const disallowed = networkLog.filter((url) => !isAllowedExternalProofRequest(url));
  expect(disallowed).toEqual([]);
});

test("workspace command menus open without overflow across responsive viewports", async ({ page }, testInfo) => {
  await page.goto("/");
  const compact = page.viewportSize()!.width < 760;
  const expectedMenus = compact ? ["file", "inspect", "view", "settings", "help"] : ["file", "inspect", "settings", "help"];
  await expect(page.getByTestId("workspace-top-toolbar")).toBeVisible();
  await expect(page.getByTestId("workspace-command-bar")).toBeVisible();
  await expectTopToolbarSingleRow(page);
  await expectBreadcrumbLongTextTruncates(page);
  await expectPassiveBottomStatusBar(page);
  await expect(page.getByTestId("command-menu-reports")).toHaveCount(0);
  await expect(page.getByTestId("command-menu-tools")).toHaveCount(0);
  await expect(page.getByTestId("command-menu-connections")).toHaveCount(0);
  if (compact) {
    await expect(page.getByTestId("command-menu-view")).toBeVisible();
  } else {
    await expect(page.getByTestId("command-menu-view")).toHaveCount(0);
  }
  await expect(page.getByTestId("command-icon-save")).toBeVisible();
  await expect(page.getByTestId("command-icon-undo")).toBeVisible();
  await expect(page.getByTestId("command-icon-redo")).toBeVisible();
  await expect(page.getByTestId("command-file-save")).toHaveCount(0);
  await expect(page.getByTestId("command-tools-undo")).toHaveCount(0);
  await expect(page.getByTestId("command-tools-redo")).toHaveCount(0);
  await expect(page.getByTestId("command-tools-calculate")).toHaveCount(0);
  await expect(page.getByTestId("command-tools-layers")).toHaveCount(0);
  for (const menuId of expectedMenus) {
    await openCommandMenu(page, menuId);
    await expect(page.getByTestId(`command-menu-${menuId}-panel`)).toBeVisible();
    if (menuId === "file") {
      await expect(page.getByTestId("command-file-save")).toHaveCount(0);
    }
    if (menuId === "inspect") {
      await expect(page.getByTestId("command-reports-export")).toHaveCount(0);
    }
    await expectInsideViewport(page, `command-menu-${menuId}-panel`);
    await expectNoHorizontalOverflow(page);
    await closeCommandMenu(page, menuId);
  }
  await saveScreen(page, testInfo, "workspace-command-menus-responsive");
});

test("workspace command menu routes preserve existing views and local boundaries", async ({ page }, testInfo) => {
  await page.goto("/");
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-files").click();
  await expect(page.getByTestId("files-view")).toBeVisible();
  await navigateToSurvey(page);
  await expect(page.getByTestId("survey-view")).toBeVisible();
  await openCommandMenu(page, "settings");
  await page.getByTestId("command-settings-open").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await openCommandMenu(page, "help");
  await page.getByTestId("command-help-open").click();
  await expect(page.getByTestId("help-view")).toBeVisible();
  await expect(page.getByTestId("catalog-save-state").getByText("Catalog ready")).toBeVisible();
  await expect(page.getByTestId("project-save-state")).toHaveCount(0);
  await saveScreen(page, testInfo, "workspace-command-menu-routes");
});

test("catalog home readiness replaces global count metrics", async ({ page }, testInfo) => {
  await page.goto("/");
  await openCatalogFromFile(page);
  await openInspectorIfCollapsed(page);
  const readiness = page.getByTestId("catalog-home-readiness");
  await expect(readiness).toContainText("Storage");
  await expect(readiness).toContainText("Active context");
  await expect(readiness).toContainText("Next action");
  await expect(readiness).toContainText("Imagery");
  await expect(readiness).not.toContainText("Customers");
  await expect(readiness).not.toContainText("Projects");
  await expect(readiness).not.toContainText("Field maps");
  await expect(readiness).not.toContainText("Designs");
  await saveScreen(page, testInfo, "catalog-home-readiness-no-counts");
});

test("catalog home routes stay navigation-only and non-project-backed", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
  await expect(page.getByTestId("catalog-save-state")).toContainText("Catalog ready");
  await expect(page.getByTestId("project-save-state")).toHaveCount(0);
  await expect(page.getByTestId("workspace-power-evidence-status")).toHaveCount(0);
  await expect(page.getByText("Will Rhea / Jason Harmelink Example Map")).toHaveCount(0);

  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("dashboard-workspace")).toBeVisible();
  await expect(page.getByTestId("dashboard-workspace").getByTestId("catalog-home-readiness")).toBeVisible();
  await expect(page.getByText("Coverage")).toHaveCount(0);
  await expect(page.getByText("Irrigated")).toHaveCount(0);
  await expect(page.getByText("Will Rhea / Jason Harmelink Example Map")).toHaveCount(0);

  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByTestId("survey-view")).toBeVisible();
  await expect(page.getByText("No Project Open")).toBeVisible();
  await expect(page.getByTestId("survey-metric-points")).toHaveCount(0);

  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("files-view")).toBeVisible();
  await expect(page.getByText("No Project Open")).toBeVisible();
  await expect(page.getByText("Will Rhea / Jason Harmelink Example Map")).toHaveCount(0);
  await expect(page.getByTestId("project-save-state")).toHaveCount(0);

  await page.getByTestId("workspace-nav-settings").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.getByTestId("catalog-save-state")).toContainText("Catalog ready");
  await expect(page.getByTestId("project-save-state")).toHaveCount(0);
  await expect(page.getByText("Unsaved edits")).toHaveCount(0);
  await saveScreen(page, testInfo, "catalog-home-navigation-only");
});

test("file menu opens curated sample designs with projected xy status", async ({ page }, testInfo) => {
  await page.goto("/");
  const samples = [
    { testId: "command-file-sample-baseline-needs-review", title: "North Quarter Concept Layout" },
    { testId: "command-file-sample-improved-full-circle", title: "Improved Full-Circle Conflict Clear" },
    { testId: "command-file-sample-partial-sweep-road-structure", title: "Partial Sweep Near Road And Pad" },
    { testId: "command-file-sample-end-gun-shutoff-arc", title: "End-Gun Shutoff Arc" },
    { testId: "command-file-sample-advisory-corner-arm-footprint", title: "Advisory Corner-Arm Footprint" },
    { testId: "command-file-sample-full-scope-multi-pivot-cost-demo", title: "Full-Scope Multi-Pivot Cost Demo" },
  ];

  for (const sample of samples) {
    await openCommandMenu(page, "file");
    await page.getByTestId(sample.testId).click();
    await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(sample.title);
    await expect(page.getByText("Projected XY").first()).toBeVisible();
    await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  }
  await saveScreen(page, testInfo, "file-menu-curated-samples");
});

test("catalog blank design starts empty and requires explicit coordinates before drawing", async ({ page }, testInfo) => {
  await page.goto("/");
  await openCatalogFromFile(page);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
  await openInspectorIfCollapsed(page);
  await expect(page.getByText("Create a customer and project, name your first field, then add a design. You can return to any saved item from the list.")).toBeVisible();
  await closeInspectorIfOpen(page);
  await expect(page.getByTestId("design-action-polygon")).toHaveCount(0);

  await createClientFolder(page, "Empty Design Farm");
  await createProjectFromRail(page, "Empty field");
  await startBlankDesignFromFile(page);
  await page.getByLabel("Catalog item name").fill("Blank Field Design");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
  await expect(page.getByTestId("design-draft-polygon")).toBeDisabled();
  await expect(page.getByTestId("draft-calculate")).toBeDisabled();
  const before = await readWorkspace(page);
  expect(before.projectDocuments).toEqual([]);
  expect(before.catalog.projects[0].projectCrs).toBe("");
  expect(JSON.parse(before.draftDocuments[0].document).draft.fieldBoundary).toEqual([]);
  if (!await page.getByTestId("design-draft-inputs").isVisible()) await page.getByTestId("draft-inputs-toggle").click();
  await page.getByTestId("draft-crs").fill("LOCAL:METERS");
  await page.getByRole("button", { name: "Apply CRS", exact: true }).click();
  await page.getByTestId("draft-inputs-toggle").click();
  await page.getByTestId("design-draft-polygon").click();
  const map = page.getByTestId("design-draft-map-svg");
  for (const [x, y] of [[0.3, 0.35], [0.65, 0.35], [0.6, 0.6]]) {
    const box = (await map.boundingBox())!;
    const overlay = (await page.getByTestId("design-draft-capture-status").boundingBox())!;
    const camera = (await page.getByTestId("design-draft-camera-controls").boundingBox())!;
    const clearTop = camera.y + camera.height + 8 - box.y;
    const clearWidth = box.width - 20;
    const clearHeight = overlay.y - box.y - clearTop - 8;
    expect(clearWidth).toBeGreaterThan(20);
    expect(clearHeight).toBeGreaterThan(20);
    const position = { x: 10 + clearWidth * x, y: clearTop + clearHeight * y };
    expect(await map.evaluate((element, point) => {
      const bounds = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(bounds.x + point.x, bounds.y + point.y));
    }, position)).toBe(true);
    await map.click({ position });
  }
  await page.getByTestId("design-draft-commit").click();
  await page.getByTestId("drawing-purpose-select").selectOption("field_boundary");
  await page.getByTestId("drawing-classification-keep").click();
  if (await page.getByTestId("drawing-classification-confirm").isVisible()) await page.getByTestId("drawing-classification-confirm").click();
  await expect(page.getByTestId("drawing-classification-inline")).toHaveCount(0);
  await expect(page.getByTestId("draft-error")).toHaveCount(0);
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  const draft = JSON.parse((await readWorkspace(page)).draftDocuments[0].document).draft;
  expect(draft.fieldBoundary).toHaveLength(3);
  expect(draft.pivotCenter).toBeNull();
  expect(draft.machine).toEqual({});
  await saveScreen(page, testInfo, "catalog-real-draft-boundary");
});

test("design console pivot entry defaults to decimal GPS with expert XY hidden", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await openPivotGpsSheet(page);
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await expect(page.getByLabel("Pivot latitude and longitude decimal degrees")).toBeVisible();
  await expect(page.getByTestId("pivot-gps-input")).toHaveValue(/^-?\d+\.\d+, -?\d+\.\d+/);
  await expect(page.getByTestId("pivot-expert-xy")).toHaveCount(0);
  await page.getByRole("button", { name: "Expert XY" }).click();
  await expect(page.getByTestId("pivot-expert-xy")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply Expert XY" })).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "design-console-pivot-gps-default");
});

test("map-first catalog tree creates client projects and field maps without hidden sample designs", async ({ page }, testInfo) => {
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto("/");
  await openCatalogFromFile(page);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("catalog-home-status")).toContainText(/Browser local storage/);
  await openProjectDrawerIfCollapsed(page);
  const railNewButton = page.getByTestId("project-tree-action-new");
  await expect(railNewButton).toBeVisible();
  await expect(railNewButton).toBeEnabled();
  await openProjectTreeActionOverflow(page);
  const railProjectButton = page.getByTestId("project-tree-action-project");
  await expect(railProjectButton).toBeVisible();
  await expect(railProjectButton).toBeDisabled();
  await closeProjectTreeActionOverflow(page);
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await expect(page.getByRole("button", { name: "Adams North Unit", exact: true })).toBeHidden();

  await createClientFolder(page, "Adams Farms");
  await expect(page.getByRole("button", { name: "Adams Farms", exact: true })).toBeVisible();
  await openProjectTreeActionOverflow(page);
  await expect(page.getByTestId("project-tree-action-project")).toBeEnabled();
  await closeProjectTreeActionOverflow(page);
  await createProjectFromRail(page, "Adams North Unit", "Saved under: Adams Farms");
  const railProject = page.getByTestId("project-tree-rail").getByRole("button", { name: "Adams North Unit", exact: true });
  await expect(railProject).toBeVisible();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
  await expect(page.getByTestId("browser-map-workbench")).toContainText(/Client\/project catalog view|Catalog/);
  await expect(page.getByTestId("browser-workflow-layout")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("design-action-polygon")).toHaveCount(0);
  await expect(page.getByText("North Quarter Concept Layout")).toBeHidden();
  await expect(page.getByText("Base Design")).toBeHidden();
  await expect(page.getByTestId("project-tree-rail")).toContainText("0 designs");
  await expectNoSavedProjectDocuments(page);

  await createCatalogItem(page, "Field Map", "North Quarter", "Saved under: Adams Farms > Adams North Unit");
  await expect(page.getByRole("button", { name: "North Quarter", exact: true })).toBeVisible();
  await expect(page.getByTestId("project-tree-rail")).toContainText("North Quarter");
  await expect(page.getByTestId("project-tree-rail")).toContainText("0 designs");
  await expect(page.getByTestId("browser-map-workbench")).toContainText(/Client\/project catalog view|Catalog/);
  await expectNoSavedProjectDocuments(page);
  await createCatalogItem(page, "Design", "RTK Layout Pass", "Saved under: Adams Farms > Adams North Unit > North Quarter");
  await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
  await expect(page.getByTestId("draft-layout")).toBeDisabled();
  expect((await readWorkspace(page)).draftDocuments).toHaveLength(1);
  expect((await readWorkspace(page)).projectDocuments).toEqual([]);
  await page.getByTestId("draft-catalog").click();
  await openProjectDrawerIfCollapsed(page);
  await page.getByTestId(`${await railProject.getAttribute("data-testid")}-open`).click();
  await openProjectDrawerIfCollapsed(page);
  await expect(page.getByTestId("project-tree-rail")).toContainText("North Quarter");
  await expect(page.getByTestId("catalog-save-state")).toContainText("Catalog ready");
  await expect(page.getByTestId("project-save-state")).toHaveCount(0);
  await closeProjectDrawerIfOpen(page);
  await openBaselineSample(page);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await page.getByTestId("workspace-nav-map").click();
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("design-action-polygon")).toBeVisible();
  expect(nativeDialogs).toEqual([]);
  await saveScreen(page, testInfo, "map-first-catalog-tree-create");
});

test("catalog creation modal cancel leaves the tree unchanged", async ({ page }, testInfo) => {
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto("/");
  await openProjectDrawerIfCollapsed(page);
  await expect(page.getByText("No customers yet.")).toBeVisible();
  await clickProjectTreeAction(page, "client");
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByTestId("client-profile-cancel").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  await expect(page.getByText("No customers yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Customer 1" })).toBeHidden();
  expect((await readWorkspace(page)).catalog.clients).toEqual([]);
  expect(nativeDialogs).toEqual([]);
  await saveScreen(page, testInfo, "catalog-modal-cancel-unchanged");
});

test("catalog creation modal validates blank names without creating records", async ({ page }, testInfo) => {
  await page.goto("/");
  await openProjectDrawerIfCollapsed(page);
  await expect(page.getByText("No customers yet.")).toBeVisible();
  await clickProjectTreeAction(page, "client");
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByLabel("Company name").fill("   ");
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-first-name-input-error")).toHaveText("Enter the contact\'s first name.");
  await expect(page.getByTestId("client-profile-last-name-input-error")).toHaveText("Enter the contact\'s last name.");
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await expect(page.getByText("No customers yet.")).toBeVisible();
  await page.getByTestId("client-profile-cancel").click();
  await saveScreen(page, testInfo, "catalog-modal-blank-validation");
});

test("project creation modal stays reachable on a 390px mobile viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await createClientFolder(page, "Mobile Farms");
  await openProjectDrawerIfCollapsed(page);
  await clickProjectTreeAction(page, "project");
  await expect(page.getByTestId("catalog-dialog")).toBeVisible();
  await expect(page.getByTestId("catalog-dialog-context")).toContainText("Saved under: Mobile Farms");
  await expect(page.getByTestId("catalog-dialog-create")).toBeVisible();
  await expect(page.getByTestId("catalog-dialog-cancel")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectInsideViewport(page, "catalog-dialog");
  await saveScreen(page, testInfo, "catalog-modal-mobile-390");
});

test("client detail manages profile and contained project lifecycle", async ({ page }, testInfo) => {
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto("/");
  await createClientFolder(page, "Adams Farms", {
    firstName: "Ana",
    middleInitial: "J",
    lastName: "Operator",
    suffix: "Jr.",
    email: "ana@example.test",
    phone: "555-0100",
    location: "Adams County",
  });
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("client-detail-panel")).toContainText("Adams Farms");
  await expect(page.getByText("Operator, Ana J. Jr.")).toBeVisible();

  await page.getByRole("button", { name: "Edit Customer" }).click();
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByTestId("client-profile-details-toggle").click();
  await page.getByLabel("Location").fill("North Adams County");
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  await expect(page.getByText("North Adams County")).toBeVisible();

  await createProjectForSelectedClient(page, "North Unit", "Saved under: Adams Farms");
  await openCatalogFromFile(page);
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("client-detail-projects")).toContainText("North Unit");
  await expect(page.getByRole("button", { name: "Delete Customer" })).toBeDisabled();

  const beforeRename = await readWorkspace(page);
  const originalKeys = (await workspaceStorageBytes(page)).slice(1);
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByTestId("catalog-dialog")).toBeVisible();
  await page.getByLabel("Catalog item name").fill("North Unit Renamed");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await expect(page.getByTestId("client-detail-projects")).toContainText("North Unit Renamed");
  const afterRename = await readWorkspace(page);
  expect(afterRename.revision).toBe(beforeRename.revision + 1);
  expect(afterRename.projectDocuments).toEqual(beforeRename.projectDocuments);
  expect(afterRename.draftDocuments).toEqual(beforeRename.draftDocuments);
  expect(afterRename.catalog.designs).toEqual(beforeRename.catalog.designs);
  expect(afterRename.catalog.fieldMaps).toEqual(beforeRename.catalog.fieldMaps);
  expect(afterRename.catalog.clients).toEqual(beforeRename.catalog.clients);
  expect(afterRename.tombstones).toEqual(beforeRename.tombstones);
  expect(afterRename.catalog.projects).toEqual(beforeRename.catalog.projects.map(folder => ({
    ...folder, name: "North Unit Renamed", updatedAt: expect.any(String),
  })));
  expect((await workspaceStorageBytes(page)).slice(1)).toEqual(originalKeys);

  await createClientFolder(page, "Beta Farms");
  await page.getByRole("button", { name: "Adams Farms", exact: true }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByTestId("move-project-dialog")).toBeVisible();
  await page.getByRole("radio", { name: "Move to Beta Farms" }).click();
  await page.getByTestId("move-project-confirm").click();
  await expect(page.getByTestId("move-project-dialog")).toBeHidden();
  await page.getByRole("button", { name: "Beta Farms", exact: true }).click();
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("client-detail-projects")).toContainText("North Unit Renamed");

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("delete-project-dialog")).toBeVisible();
  await page.getByTestId("delete-project-dialog-confirm").click();
  await expect(page.getByTestId("delete-project-dialog")).toBeHidden();
  await expect(page.getByTestId("client-detail-projects")).not.toContainText("North Unit Renamed");

  await page.getByRole("button", { name: "Delete Customer" }).click();
  await expect(page.getByTestId("delete-client-dialog")).toBeVisible();
  await page.getByTestId("delete-client-dialog-confirm").click();
  await expect(page.getByRole("button", { name: "Beta Farms", exact: true })).toBeHidden();
  expect(nativeDialogs).toEqual([]);
  await saveScreen(page, testInfo, "client-detail-project-lifecycle");
});

test("public proof map features can select the side-panel editor without geometry mutation", async ({ page }, testInfo) => {
  await page.goto("/");
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-real-proof").click();
  await expect(page.getByTestId("workspace-screen")).toBeVisible();
  await page.getByTestId("command-icon-save").click();
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByText("Saved")).toBeVisible();

  const workbench = page.getByLabel("CPLayout MapLibre imagery workbench");
  const box = await workbench.boundingBox();
  expect(box, "map workbench bounding box").not.toBeNull();
  if (!box) return;
  if (testInfo.project.name === "mobile-390") {
    await expect(page.getByText("Saved")).toBeVisible();
    await saveScreen(page, testInfo, "public-proof-feature-mobile-map-visible");
    return;
  }
  const storedBefore = await workspaceStorageBytes(page);
  const sourceProject = parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document);
  const powerFeed = sourceProject.mapFeatures?.find(feature => feature.id === "power-feed-from-112th");
  expect(powerFeed?.geometry.type).toBe("LineString");
  if (!powerFeed || powerFeed.geometry.type !== "LineString") throw new Error("Public proof power feed is missing");
  const [start, end] = powerFeed.geometry.vertices;
  await closeInspectorIfOpen(page);
  await clickWorkbenchProjectedPoint(page, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 });
  await expect(page.getByText(/Selected map feature/)).toBeVisible();
  await expect(page.getByLabel("Selected map feature name")).toHaveValue("Power feed from 112th Avenue");
  await expect(page.getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "public-proof-feature-selected");
  const mapNode = await workbench.elementHandle();
  const camera = await workbench.getAttribute("data-map-camera");
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("calculation-screen")).toBeVisible();
  await page.getByTestId("design-console-close").click();
  await expect(page.getByTestId("workflow-sidebar-tab-tools")).toHaveAttribute("aria-selected", "true");
  expect(await mapNode!.evaluate(node => node.isConnected)).toBe(true);
  await expect(workbench).toHaveAttribute("data-map-camera", camera!);
  await page.getByTestId("workflow-sidebar-tab-feature").click();
  await expect(page.getByLabel("Selected map feature name")).toHaveValue("Power feed from 112th Avenue");
  expect(await workspaceStorageBytes(page)).toEqual(storedBefore);
});

test("workspace rail exposes the selected view state", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await expect(page.getByTestId("workspace-nav-dashboard")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("workspace-nav-dashboard")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("workspace-nav-map")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("workspace-nav-review")).toHaveCount(0);
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("workspace-nav-map")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("workspace-nav-files")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("workspace-nav-help").click();
  await expect(page.getByTestId("workspace-nav-files")).toHaveAttribute("aria-selected", "false");
  await expect(page.getByTestId("workspace-nav-help")).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "workspace-rail-selected-state");
});

test("workspace compact rail stays within the viewport while switching routes", async ({ page }, testInfo) => {
  // Rail geometry is independent of live imagery availability.
  await page.route("https://basemap.nationalmap.gov/**", route => route.abort("blockedbyclient"));
  await page.goto("/");
  await openBaselineSample(page);
  const viewport = page.viewportSize();
  expect(viewport, "viewport").not.toBeNull();
  const railBox = await page.getByTestId("workspace-rail").boundingBox();
  expect(railBox, "workspace rail bounding box").not.toBeNull();
  if (!viewport || !railBox) return;
  expect(railBox.x).toBeGreaterThanOrEqual(0);
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(viewport.width + 2);
  for (const routeScreen of routeScreens) {
    await page.getByTestId(routeScreen.nav).click();
    await expect(page.getByTestId(routeScreen.screen)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  }
  await expectMinTargetSize(page, "workspace-nav-help", 48, 48);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "workspace-compact-rail-overflow");
});

test("help training route links into the real workflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-help").click();
  await expect(page.getByTestId("help-view")).toBeVisible();
  await expect(page.getByTestId("help-training-panel")).toContainText("workflow checkpoints");
  for (const moduleId of [
    "help-module-start",
    "help-module-map-tools",
	    "help-module-google-earth",
	    "help-module-imagery",
	    "help-module-layout-validation",
	    "help-module-rtk",
	    "help-module-android-storage",
	    "help-module-export",
  ]) {
    await expect(page.getByTestId(moduleId)).toBeVisible();
  }
  await expect(page.getByText("Google Earth Pro is a local companion reference only")).toBeVisible();
  await expect(page.getByText("Training progress uses the same local walkthrough store")).toBeVisible();
  await expect(page.getByTestId("help-module-rtk")).toContainText("independent field control");
  await expectNoHorizontalOverflow(page);

  await page.getByTestId("help-action-map").click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await page.getByTestId("workspace-nav-help").click();
  await page.getByTestId("help-action-files").click();
  await expect(page.getByTestId("files-view")).toBeVisible();
  await page.getByTestId("workspace-nav-help").click();
  await page.getByTestId("help-action-settings").click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("workspace-nav-help").click();
  await page.getByTestId("help-module-rtk-route").click();
  await expect(page.getByTestId("survey-view")).toBeVisible();
  await page.getByTestId("workspace-nav-help").click();
  await page.getByTestId("help-module-layout-validation-route").click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("review-view")).toHaveCount(0);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "help-training-route");
});

test("tablet portrait map console keeps drawers collapsed and HUD above the viewport floor", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("left-drawer-handle")).toBeVisible();
  await expect(page.getByTestId("right-drawer-handle")).toBeVisible();
  await expect(page.getByTestId("map-bottom-hud")).toBeVisible();
  await expect(page.getByTestId("map-bottom-hud-toggle")).toHaveCount(0);
  await expectNoPageScroll(page);
  await expectNoHorizontalOverflow(page);
  await expectMinTargetSize(page, "left-drawer-handle", 56, 56);
  await expectMinTargetSize(page, "right-drawer-handle", 56, 56);
  await expectInsideContainer(page, "browser-map-bottom-dock", "browser-map-frame");
  await expectBottomGap(page, "browser-map-bottom-dock", "browser-map-frame", 4, 18);
  const collapsedMap = await page.getByTestId("browser-map-frame").boundingBox();
  await page.getByTestId("right-drawer-handle").click();
  await expect(page.getByTestId("workflow-sidebar-tab-tools")).toBeVisible();
  await expectInsideViewport(page, "design-action-pan");
  await expect(page.getByTestId("design-action-files")).toHaveCount(0);
  await expect(page.getByTestId("design-workflow-actions")).toBeVisible();
  const expandedMap = await page.getByTestId("browser-map-frame").boundingBox();
  expect(collapsedMap, "collapsed map bounding box").not.toBeNull();
  expect(expandedMap, "expanded map bounding box").not.toBeNull();
  if (collapsedMap && expandedMap) {
    expect(expandedMap.width).toBeLessThan(collapsedMap.width);
  }
  await saveScreen(page, testInfo, "tablet-portrait-map-console");
});

test("tablet landscape map console has fixed page bounds and drawer handles", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("left-drawer-handle")).toBeVisible();
  await expect(page.getByTestId("right-drawer-handle")).toBeVisible();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByTestId("map-bottom-hud")).toBeVisible();
  await expect(page.getByTestId("map-bottom-hud-toggle")).toHaveCount(0);
  await expectNoPageScroll(page);
  await expectNoHorizontalOverflow(page);
  await expectMinTargetSize(page, "workspace-nav-map", 48, 48);
  await expectMinTargetSize(page, "left-drawer-handle", 56, 56);
  await expectMinTargetSize(page, "right-drawer-handle", 56, 56);
  await expectInsideContainer(page, "browser-map-bottom-dock", "browser-map-frame");
  await expectBottomGap(page, "browser-map-bottom-dock", "browser-map-frame", 4, 18);
  await page.getByTestId("right-drawer-handle").click();
  await expectInsideViewport(page, "design-action-pan");
  await saveScreen(page, testInfo, "tablet-landscape-map-console");
});

test("survey rtk receiver starts closed without mutating the project", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByTestId("survey-view")).toBeVisible();
  await expect(page.getByTestId("rtk-gate-badge").getByText("Gate closed")).toBeVisible();
  await expect(page.getByTestId("receiver-collection-readiness")).toHaveText("Connect a receiver to collect a position.");
  await expect(page.getByTestId("receiver-status")).toHaveText("No receiver connected.");
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeDisabled();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "survey-rtk-gate-closed");
});

test("survey rtk capture requires current fixed GGA and closes on disconnect", async ({ page }, testInfo) => {
  await openControlledRtkReceiver(page);
  await expect(page.getByTestId("rtk-gate-badge").getByText("Collection eligible")).toBeVisible();
  await expect(page.getByText(/Measured field accuracy remains unverified/)).toBeVisible();
  await expect(page.getByText("Fix: RTK Fixed — receiver reported", { exact: true })).toBeVisible();
  await expect(page.getByText("Sentence: GNGGA", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeEnabled();
  await page.getByRole("button", { name: "Capture Survey Point" }).click();
  await expect(page.getByTestId("rtk-status")).toContainText("Captured control survey point with RTK fixed confidence.");
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  await expect(page.getByTestId("rtk-gate-badge").getByText("Gate closed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeDisabled();
  await saveScreen(page, testInfo, "survey-rtk-coherent-capture");
});

test("survey rtk closed gate disables geometry capture controls", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByTestId("rtk-gate-badge").getByText("Gate closed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Boundary (0)" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Commit Boundary" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add Obstacle (0)" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Commit Obstacle" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add Feature Vertex (0)" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Line Feature" })).toBeDisabled();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "survey-rtk-geometry-disabled");
});

function controlledNmeaSentence(body: string): string {
  const checksum = [...body].reduce((value, character) => value ^ character.charCodeAt(0), 0);
  return `$${body}*${checksum.toString(16).padStart(2, "0")}\r\n`;
}

async function openControlledRtkReceiver(page: Page): Promise<void> {
  await installOperationalReceiver(page, gga());
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByRole("textbox", { name: "Receiver source CRS" })).toHaveCount(0);
  await connectOperationalReceiver(page);
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Collection eligible");
}

test("survey rtk invalid latest fix and replayed epoch cannot revive capture", async ({ page }, testInfo) => {
  await openControlledRtkReceiver(page);
  const storedBefore = await workspaceStorageBytes(page);
  await expect(page.getByText("Sentence: GNGGA", { exact: true })).toBeVisible();
  await emitGga(page, controlledNmeaSentence("GNGGA,120001.00,,,,,0,0,,,,,,,"));
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeDisabled();
  await emitGga(page, gga(), 0);
  await expect(page.getByTestId("receiver-collection-readiness")).toContainText("Duplicate GGA epoch");
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeDisabled();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await saveScreen(page, testInfo, "rtk-invalid-and-replayed-epoch-blocked");
  await emitGga(page, gga("120002.00"));
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Collection eligible");
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await workspaceStorageBytes(page)).toEqual(storedBefore);
});

for (const [kind, name] of [["survey", "Capture Survey Point"], ["geometry", "Add Boundary (0)"]] as const) {
  test(`survey rtk ${kind} capture rechecks age before the next display timer`, async ({ page }, testInfo) => {
    await openControlledRtkReceiver(page);
    const storedBefore = await workspaceStorageBytes(page);
    const capture = page.getByRole("button", { name, exact: true });
    await expect(capture).toBeEnabled();
    await capture.evaluate((element) => {
      (window as ReceiverFixtureWindow).operationalReceiver.nowMs += 3000;
      (element as HTMLElement).click();
    });
    await expect(page.getByTestId("rtk-status")).toContainText("Collection blocked: Receiver position is stale");
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    await expect(page.getByRole("button", { name: "Add Boundary (0)", exact: true })).toBeVisible();
    expect(await workspaceStorageBytes(page)).toEqual(storedBefore);
    await saveScreen(page, testInfo, `rtk-${kind}-capture-time-gate`);
  });
}

test("survey rtk role selection stays local while gate is closed", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-survey").click();
  await page.getByRole("button", { name: "Pivot", exact: true }).click();
  await page.getByRole("button", { name: "Water", exact: true }).click();
  await page.getByRole("button", { name: "Power", exact: true }).click();
  await expect(page.getByTestId("rtk-gate-badge").getByText("Gate closed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeDisabled();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect(page.getByText("Unsaved edits")).toHaveCount(0);
  await saveScreen(page, testInfo, "survey-rtk-role-local");
});

test("survey rtk map feature selection stays local while gate is closed", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-survey").click();
  await page.getByRole("button", { name: "Pump point" }).click();
  await expect(page.getByRole("button", { name: "Save Point Feature" })).toBeDisabled();
  await page.getByRole("button", { name: "Power line" }).click();
  await expect(page.getByRole("button", { name: "Add Feature Vertex (0)" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Line Feature" })).toBeDisabled();
  await expect(page.getByTestId("rtk-gate-badge").getByText("Gate closed")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect(page.getByText("Unsaved edits")).toHaveCount(0);
  await saveScreen(page, testInfo, "survey-rtk-feature-local");
});

test("browser boundary commit keeps projected geometry status explicit", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await selectBoundaryTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await clickWorkbenchMap(page, { x: 240, y: 180 });
  await clickWorkbenchMap(page, { x: 220, y: 250 });
  await expect(page.getByText(/measure .* 3 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await page.getByTestId("browser-action-save-feature").click();
  await expect(page.getByTestId("pending-draft-purpose-panel")).toContainText("What did you draw?");
  await choosePendingDraftPurpose(page, "Field Boundary");
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "boundary-commit-status");
});

test("browser utility line save keeps projected feature status explicit", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await selectPipelineTool(page);
  await clickWorkbenchMap(page, { x: 170, y: 330 });
  await clickWorkbenchMap(page, { x: 250, y: 370 });
  await expect(page.getByText(/measure .* 2 draft pts .* line needs 2 pts/)).toBeVisible();
  await page.getByTestId("browser-action-save-feature").click();
  await expect(page.getByTestId("pending-draft-purpose-panel")).toContainText("What did you draw?");
  await choosePendingDraftPurpose(page, "Pipeline");
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "utility-line-save-status");
});

test("browser utility point save keeps projected feature status explicit", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await selectPumpFeatureTool(page);
  await expect(page.getByText("measure · 0 draft pts · capture point, then choose purpose")).toBeVisible();
  await clickWorkbenchMap(page, { x: 190, y: 220 });
  await expect(page.getByTestId("pending-draft-purpose-panel")).toContainText("What did you draw?");
  await choosePendingDraftPurpose(page, "Pump");
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "utility-point-save-status");
});

test("design console selects end-gun circle and corner footprint utility tools", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const x = 500000, y = 4505200;
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({ type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32613" }, features: [{ type: "Feature", properties: { layerType: "field_boundary" },
      geometry: { type: "Polygon", coordinates: [[[x, y], [x + 3000, y], [x + 3000, y + 3000], [x, y + 3000], [x, y]]] } }],
  }));
  await page.getByTestId("files-action-import-geojson").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();

  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  await selectEndGunCircleTool(page);
  await map.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("design-action-circle")).toHaveAttribute("aria-pressed", "true");
  await clickWorkbenchMap(page, { x: 180, y: 330 });
  await clickWorkbenchMap(page, { x: 250, y: 370 });
  await expect(page.getByText(/measure .* 2 draft pts .* circle needs center \+ radius/)).toBeVisible();
  await page.getByTestId("browser-action-save-feature").click();
  await expect(page.getByTestId("pending-draft-purpose-panel")).toContainText("What did you draw?");
  await choosePendingDraftPurpose(page, "End-Gun Circle");
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByTestId("browser-map-action-status")).toContainText("End-Gun Circle committed in projected XY");
  await expectShortMapControlsClear(page);
  await expect(page.getByText("Unsaved edits")).toBeVisible();

  await closeInspectorIfOpen(page);
  await selectPanTool(page);
  await selectEndGunCircleTool(page);
  await map.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("design-action-circle")).toHaveAttribute("aria-pressed", "true");

  await selectCornerFootprintTool(page);
  await map.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("design-action-polygon")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60000 });
  if (testInfo.project.name === "mobile-390") {
    await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60000 });
    const bounds = await map.boundingBox();
    if (!bounds) throw new Error("Missing map bounds");
    const beforePan = await map.getAttribute("data-map-camera");
    await page.mouse.move(bounds.x + 60, bounds.y + 140);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 60, bounds.y + 60, { steps: 8 });
    await page.mouse.up();
    await expect(map).not.toHaveAttribute("data-map-camera", beforePan!);
    let previousCamera: string | null = null;
    await expect.poll(async () => {
      const current = await map.getAttribute("data-map-camera");
      const stable = current !== null && current === previousCamera;
      previousCamera = current;
      return stable;
    }, { intervals: [200] }).toBe(true);
  }
  const desktopFootprint = testInfo.project.name === "desktop";
  if (desktopFootprint) await page.getByTestId("browser-map-fit-field").click();
  const footprintPoints = desktopFootprint
    ? [{ x: x + 1300, y: y + 1300 }, { x: x + 1700, y: y + 1300 }, { x: x + 1300, y: y + 1700 }]
    : [{ x: 140, y: 420 }, { x: 220, y: 420 }, { x: 180, y: 470 }];
  for (const point of footprintPoints) {
    if (desktopFootprint) await clickWorkbenchProjectedPoint(page, point);
    else await clickWorkbenchMap(page, point);
    const feedback = await page.getByTestId("browser-map-action-status").innerText();
    const coordinates = feedback.match(/draft vertex (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/);
    expect(coordinates, "Each footprint point must report projected XY").not.toBeNull();
    const px = Number(coordinates![1]), py = Number(coordinates![2]);
    expect(px).toBeGreaterThan(x);
    expect(px).toBeLessThan(x + 3000);
    expect(py).toBeGreaterThan(y);
    expect(py).toBeLessThan(y + 3000);
    if (desktopFootprint) {
      expect(Math.hypot(px - point.x, py - point.y), "projected click must land near its requested XY").toBeLessThan(250);
    }
  }
  await expect(page.getByText(/measure .* 3 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await page.getByTestId("browser-action-save-feature").click();
  await expect(page.getByTestId("pending-draft-purpose-panel")).toContainText("What did you draw?");
  await choosePendingDraftPurpose(page, "Corner-Arm Footprint");
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByTestId("browser-map-action-status")).toContainText("Corner-Arm Footprint committed in projected XY");
  await expectShortMapControlsClear(page);
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "design-console-feature-kind-tools");
});

test("pending map purpose reports rejection retry and cancellation without stale feedback", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const x = 500000, y = 4505200;
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({ type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32613" }, features: [{ type: "Feature", properties: { layerType: "field_boundary" },
      geometry: { type: "Polygon", coordinates: [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]] } }],
  }));
  await page.getByTestId("files-action-import-geojson").click();
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await page.getByTestId("workspace-nav-map").click();
  await selectCornerFootprintTool(page);
  for (const point of [{ x: 140, y: 240 }, { x: 210, y: 240 }, { x: 175, y: 320 }]) {
    await clickWorkbenchMap(page, point);
    const feedback = await page.getByTestId("browser-map-action-status").innerText();
    const coordinates = feedback.match(/draft vertex (-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)/);
    expect(coordinates).not.toBeNull();
    const px = Number(coordinates![1]), py = Number(coordinates![2]);
    expect(px < x || px > x + 10 || py < y || py > y + 10, "The rejection fixture must be outside the field").toBe(true);
  }
  await page.getByTestId("browser-action-save-feature").click();
  await choosePendingDraftPurpose(page, "Corner-Arm Footprint");
  const error = page.getByTestId("pending-draft-error");
  await expect(error).toContainText("must be inside the field boundary");
  await expect(page.getByTestId("browser-map-action-status")).toContainText("must be inside the field boundary");
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await expect.poll(async () => (await measureTextClipping(error)).clippedBy).toEqual([]);
  await expectShortMapControlsClear(page);
  await saveScreen(page, testInfo, "pending-purpose-rejected");

  await choosePendingDraftPurpose(page, "Field Boundary");
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByTestId("browser-map-action-status")).toContainText("Field Boundary committed in projected XY");
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  await expectShortMapControlsClear(page);
  await saveScreen(page, testInfo, "pending-purpose-retry-committed");
  await selectPumpFeatureTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 250 });
  await expect(page.getByTestId("pending-draft-purpose-panel")).toBeVisible();
  await expect(page.getByTestId("pending-draft-error")).toHaveCount(0);
  await page.getByTestId("pending-draft-cancel").click();
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByTestId("browser-map-action-status")).toContainText(/cancelled/i);
  await expectShortMapControlsClear(page);
  await saveScreen(page, testInfo, "pending-purpose-cancelled");
  await closeInspectorIfOpen(page);
  if (testInfo.project.name === "mobile-390") await expect(page.getByTestId("map-bottom-hud")).toBeVisible();
  await selectPumpFeatureTool(page);
  await expect(page.getByText(/measure .* 1 draft pts .* capture point, then choose purpose/)).toBeVisible();
  await clickWorkbenchMap(page, { x: 180, y: 250 });
  await expect(page.getByTestId("pending-draft-purpose-panel")).toBeVisible();
  await expect(page.getByTestId("browser-map-action-status")).not.toContainText(/cancelled|committed|must be inside/i);
  await choosePendingDraftPurpose(page, "Pump");
  await expect(page.getByTestId("browser-map-action-status")).toContainText("Pump committed in projected XY");
  await closeInspectorIfOpen(page);
  await clickWorkbenchMap(page, { x: 190, y: 250 });
  await expect(page.getByTestId("pending-draft-purpose-panel")).toBeVisible();
  await choosePendingDraftPurpose(page, "Well");
  await expect(page.getByTestId("browser-map-action-status")).toContainText("Well committed in projected XY");
  await closeInspectorIfOpen(page);
  await clickWorkbenchMap(page, { x: 200, y: 250 });
  await expect(page.getByTestId("pending-draft-purpose-panel")).toBeVisible();
  await page.getByTestId("pending-draft-cancel").click();
  await expect(page.getByTestId("browser-map-action-status")).toContainText(/cancelled/i);
  await closeInspectorIfOpen(page);
  await clickWorkbenchMap(page, { x: 210, y: 250 });
  await expect(page.getByTestId("pending-draft-purpose-panel")).toBeVisible();
  await openCatalogFromFile(page);
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByTestId("browser-map-action-status")).not.toContainText(/Choose its purpose|must be inside/i);
});

test("full-screen calculation preserves unfinished map drawing and camera", async ({ page }) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await activateMapTool(page, "polygon");
  await clickWorkbenchMap(page, { x: 180, y: 240 });
  await clickWorkbenchMap(page, { x: 200, y: 270 });
  const draftStatus = page.getByText(/measure .* 2 draft pts .* polygon needs 3 pts/);
  await expect(draftStatus).toBeVisible();
  const feedback = await page.getByTestId("browser-map-action-status").textContent();
  const stored = await workspaceStorageBytes(page);
  await openInspectorIfCollapsed(page);
  await page.getByTestId("workflow-sidebar-tab-tools").click();
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  const node = await map.elementHandle();
  const camera = await map.getAttribute("data-map-camera");
  await page.getByTestId("design-action-calculate").click();
  await expect(page.getByTestId("calculation-screen")).toBeVisible();
  await page.getByTestId("design-console-close").click();
  expect(await node!.evaluate(element => element.isConnected)).toBe(true);
  await expect(map).toHaveAttribute("data-map-camera", camera!);
  await expect(draftStatus).toBeVisible();
  await expect(page.getByTestId("browser-map-action-status")).toHaveText(feedback!);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
});

test("placement review applies advisory pivot candidates only after confirmation", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60000 });
  await expect(page.getByTestId("browser-advisory-generated-field-pivot-layer")).toContainText("Generated advisory plan");
  await expect(page.getByTestId("browser-advisory-generated-field-pivot-layer")).toContainText("review only");
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await page.getByTestId("design-console-calculate").click();
  await expect(page.getByTestId("placement-review-panel")).toContainText("Placement Review");
  await expect(page.getByTestId("placement-review-panel")).toContainText(/advisory/i);
  await expect(page.getByTestId("placement-review-panel")).toContainText(/source-backed/i);
  await expect(page.getByTestId("placement-candidate-0")).toBeVisible();
  await expect(page.getByTestId("calculation-save-state")).toHaveText("Project: Saved");

  await page.getByTestId("placement-candidate-apply-0").click();
  await expect(page.getByTestId("placement-confirm-dialog")).toBeVisible();
  await expect(page.getByTestId("calculation-save-state")).toHaveText("Project: Saved");
  await expect(page.getByTestId("design-console-dialog")).toBeHidden();
  await page.getByTestId("placement-confirm-dialog-cancel").click();
  await expect(page.getByTestId("placement-confirm-dialog")).toHaveCount(0);
  await expect(page.getByTestId("calculation-save-state")).toHaveText("Project: Saved");

  await page.getByTestId("placement-candidate-apply-0").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("placement-confirm-dialog")).toHaveCount(0);
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();

  await page.getByTestId("placement-candidate-apply-0").click();
  await page.getByTestId("placement-confirm-dialog-confirm").click();
  await expect(page.getByTestId("calculation-save-state")).toHaveText("Project: Unsaved edits");
  await saveScreen(page, testInfo, "placement-review-confirmed-apply");
});

test("generated field pivot plan saves advisory machine-zone review features after explicit action", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await expect(page.getByTestId("advisory-calculation-status")).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId("advisory-generated-field-pivot-plan")).toContainText("Proposed pivot layout");
  await expect(page.getByTestId("advisory-generated-field-pivot-plan")).toContainText("Proposed locations are not saved pivots");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("Generated Multi-Pivot Scenario Review");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("runtime collision controls");
  await expect(page.getByTestId("calculation-save-state")).toHaveText("Project: Saved");

  await page.getByTestId("save-generated-field-pivot-zones").click();
  await expect(page.getByTestId("calculation-save-state")).toHaveText("Project: Unsaved edits");
  await expect(page.getByTestId("advisory-calculation-status")).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId("generated-field-pivot-zone-save-status")).toHaveText(/Review zones: [1-9]\d* current \/ 0 missing \/ 0 stale/);

  await page.getByTestId("design-console-calculate").click();
  await expect.poll(
    async () => page.getByTestId("placement-review-panel").evaluate((node) => node.textContent ?? ""),
    { timeout: 30000 },
  ).toContain("Generated Pivot Zone 1");
  await expect(page.getByTestId("placement-review-panel")).toContainText("machine zone");
  await saveScreen(page, testInfo, "generated-field-pivot-review-zones-saved");
});

test("advisory cost review uses local assumptions without dirtying geometry", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await expect(page.getByTestId("advisory-calculation-status")).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId("advisory-cost-review-panel")).toContainText("Pivot equipment cost");
  await expect(page.getByTestId("advisory-cost-status")).toContainText("No price has been assumed.");
  await expect(page.getByTestId("advisory-bender-strategy-summary")).toContainText("operator-labeled projected-XY second-pivot evidence");
  await expect(page.getByTestId("advisory-obstacle-interaction-summary")).toContainText("Obstacles and clearances");
  await expect(page.getByTestId("advisory-obstacle-interaction-summary")).toContainText("checked in the field before operation");
  await expect(page.getByTestId("advisory-full-scope-boundary-summary")).toContainText("Whole-field coverage");
  await expect(page.getByTestId("advisory-full-scope-boundary-summary")).toContainText("saved boundary and equipment remain unchanged");
  await expect(page.getByTestId("advisory-generated-field-pivot-plan")).toContainText("Proposed pivot layout");
  await expect(page.getByTestId("advisory-generated-field-pivot-plan")).toContainText("without changing the active pivot");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("Generated Multi-Pivot Scenario Review");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("cost evidence Missing");
  await expect(page.getByTestId("advisory-design-report-panel")).toContainText("Advisory Design Report");
  await expect(page.getByTestId("advisory-design-report-panel")).toContainText("does not create pivots");
  await expect(page.getByTestId("advisory-review-zone-audit-summary")).toContainText("Review-zone audit");
  await expect(page.getByTestId("advisory-design-report-preview")).toContainText("Canonical geometry mutation: false");

  await page.getByTestId("advisory-cost-basis-length_tower_estimate").click();
  await expect(page.getByTestId("advisory-cost-currency")).toHaveValue("USD");
  await page.getByTestId("advisory-cost-fixed").fill("80000");
  await page.getByTestId("advisory-cost-per-foot").fill("213.36");
  await page.getByTestId("advisory-cost-per-tower").fill("3000");
  await page.getByTestId("advisory-cost-includes").fill("Pivot equipment and drive towers");
  await expect(page.getByTestId("advisory-calculation-status")).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId("advisory-cost-status")).toContainText("USD 80000.00 base + 213.36/ft + 3000.00/tower.");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("cost evidence Complete");
  await expect(page.getByText("Unsaved edits")).toHaveCount(0, { timeout: 2000 });

  await page.getByTestId("design-console-calculate").click();
  await expect.poll(
    async () => page.getByTestId("advisory-strategy-cost-summary").evaluate((node) => node.textContent ?? ""),
    { timeout: 30000 },
  ).toContain("Cost input USD");
  await expect.poll(
    async () => page.getByTestId("advisory-strategy-cost-summary").evaluate((node) => node.textContent ?? ""),
    { timeout: 30000 },
  ).toContain("are not purchase recommendations");
  await expect.poll(
    async () => page.getByTestId("placement-review-panel").evaluate((node) => node.textContent ?? ""),
    { timeout: 30000 },
  ).toContain("Cost input USD");
  const reportDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-advisory-design-report").click();
  const reportDownload = await reportDownloadPromise;
  expect(reportDownload.suggestedFilename()).toMatch(/\.advisory-design-report\.txt$/);
  const reportPath = await reportDownload.path();
  expect(reportPath, "report download path").not.toBeNull();
  const reportText = await readFile(reportPath!, "utf8");
  expect(reportText).toContain("Advisory Design Report");
  expect(reportText).toContain("Advisory only: true");
  expect(reportText).toContain("Canonical geometry mutation: false");
  expect(reportText).toContain("Review-zone audit:");
  expect(reportText).toContain("Generated Multi-Pivot Scenario Review");
  expect(reportText).toContain("runtime collision prevention");
  expect(reportText).toContain("Cost review is local and advisory");
  await expect(page.getByTestId("advisory-design-report-export-status")).toContainText("Advisory report is review-only");
  await expect(page.getByText("Unsaved edits")).toHaveCount(0, { timeout: 2000 });
  await saveScreen(page, testInfo, "advisory-cost-review-local-assumptions");
});

test("full-scope demo compares cost versus acres across advisory strategies", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openFullScopeCostDemoSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();

  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await page.getByTestId("advisory-cost-basis-length_tower_estimate").click();
  await expect(page.getByTestId("advisory-cost-currency")).toHaveValue("USD");
  await page.getByTestId("advisory-cost-fixed").fill("85000");
  await page.getByTestId("advisory-cost-per-foot").fill("198.12");
  await page.getByTestId("advisory-cost-per-tower").fill("2800");
  await page.getByTestId("advisory-cost-includes").fill("Pivot equipment and drive towers");
  await expect(page.getByTestId("advisory-cost-status")).toContainText("USD 85000.00 base + 198.12/ft + 2800.00/tower.");

  await expect(page.getByTestId("advisory-cost-acres-comparison")).toContainText("Strategy");
  await expect(page.getByTestId("advisory-cost-row-current-machine")).toContainText("Current");
  await expect(page.getByTestId("advisory-cost-row-current-machine")).toContainText("USD");
  await expect(page.getByTestId("advisory-cost-row-full-circle")).toContainText("Full circle");
  await expect(page.getByTestId("advisory-cost-row-full-circle")).toContainText("/ac");
  await expect(page.getByTestId("advisory-radius-sensitivity-table")).toContainText("Radius Alternatives");
  await expect(page.getByTestId("advisory-radius-sensitivity-table")).toContainText("canonical projected XY");
  await expect(page.getByTestId("advisory-radius-sensitivity-table")).toContainText("Full circle");
  await expect(page.getByTestId("advisory-radius-sensitivity-table")).toContainText("/ac");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("Generated Multi-Pivot Scenario Review");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("cost evidence Complete");
  await expect(page.getByTestId("advisory-end-gun-sensitivity-table")).toContainText("End-Gun Throw Alternatives");
  await expect(page.getByTestId("advisory-end-gun-sensitivity-table")).toContainText("pressure, wind, nozzle package");
  await expect(page.getByTestId("advisory-end-gun-sensitivity-table")).toContainText("Added");
  await expect(page.getByTestId("advisory-cost-row-linear-lateral")).toContainText("Linear/lateral");
  await expect(page.getByTestId("advisory-cost-row-linear-lateral")).toContainText("/ac");
  await expect(page.getByTestId("advisory-cost-row-bender-second-pivot")).toContainText("Bender");
  await expect(page.getByTestId("advisory-cost-row-bender-second-pivot")).toContainText("/ac");
  await expect(page.getByTestId("advisory-full-scope-boundary-summary")).toContainText("Whole-field coverage");
  await expect(page.getByTestId("advisory-obstacle-interaction-summary")).toContainText("Obstacles and clearances");
  await expect(page.getByText("Unsaved edits")).toHaveCount(0, { timeout: 2000 });

  const reportDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-advisory-design-report").click();
  const reportDownload = await reportDownloadPromise;
  const reportPath = await reportDownload.path();
  expect(reportPath, "report download path").not.toBeNull();
  const reportText = await readFile(reportPath!, "utf8");
  expect(reportText).toContain("Full-Scope");
  expect(reportText).toContain("Generated Field-Pivot Review");
  expect(reportText).toContain("Generated Multi-Pivot Scenario Review");
  expect(reportText).toContain("Machine Strategy And Cost Review");
  expect(reportText).toContain("Generated radius alternatives:");
  expect(reportText).toContain("End-Gun Throw Sensitivity");
  expect(reportText).toContain("End-gun review is advisory only");
  expect(reportText).toContain("Obstacle And Utility Review");
  expect(reportText).toContain("Canonical geometry mutation: false");
  await expect(page.getByText("Unsaved edits")).toHaveCount(0, { timeout: 2000 });
  await saveScreen(page, testInfo, "full-scope-cost-demo-comparison");
});

test("partial-sweep sample exposes advisory sweep efficiency comparison", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openPartialSweepSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();

  await page.getByTestId("advisory-cost-basis-length_tower_estimate").click();
  await expect(page.getByTestId("advisory-cost-currency")).toHaveValue("USD");
  await page.getByTestId("advisory-cost-fixed").fill("90000");
  await page.getByTestId("advisory-cost-per-foot").fill("198.12");
  await page.getByTestId("advisory-cost-per-tower").fill("2500");
  await page.getByTestId("advisory-cost-includes").fill("Pivot equipment and drive towers");
  await expect(page.getByTestId("advisory-cost-status")).toContainText("USD 90000.00 base + 198.12/ft + 2500.00/tower.");
  await expect(page.getByTestId("advisory-sweep-efficiency-table")).toContainText("Sweep Efficiency");
  await expect(page.getByTestId("advisory-sweep-efficiency-table")).toContainText("Same radius full circle");
  await expect(page.getByTestId("advisory-sweep-efficiency-table")).toContainText("Shorter full circle");
  await expect(page.getByTestId("advisory-sweep-efficiency-table")).toContainText("does not create a quote");
  await expect(page.getByText("Unsaved edits")).toHaveCount(0, { timeout: 2000 });

  const reportDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-advisory-design-report").click();
  const reportDownload = await reportDownloadPromise;
  const reportPath = await reportDownload.path();
  expect(reportPath, "report download path").not.toBeNull();
  const reportText = await readFile(reportPath!, "utf8");
  expect(reportText).toContain("Sweep Efficiency Review");
  expect(reportText).toContain("Sweep-efficiency review is advisory only");
  expect(reportText).toContain("Canonical geometry mutation: false");
  await saveScreen(page, testInfo, "partial-sweep-efficiency-comparison");
});

test("corner arm advisory save requires confirmation and remains advisory", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await openCornerArmAdvisorySheet(page);
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await expect(page.getByTestId("corner-arm-advisory-badges")).toContainText("advisory");
  await expect(page.getByTestId("corner-arm-advisory-badges")).toContainText("unverified kinematics");
  await expect(page.getByTestId("corner-arm-evaluation-panel")).toContainText("Corner-Arm Review");
  await expect(page.getByTestId("corner-arm-evaluation-panel")).toContainText("missing config");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("corner-arm-save-advisory").click();
  await expect(page.getByTestId("placement-confirm-dialog")).toBeVisible();
  await page.getByTestId("placement-confirm-dialog-cancel").click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("corner-arm-save-advisory").click();
  await page.getByTestId("placement-confirm-dialog-confirm").click();
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await expect(page.getByTestId("corner-arm-evaluation-panel")).toContainText("operator-confirmed");
  await expect(page.getByTestId("corner-arm-evaluation-panel")).toContainText("unverified kinematics");
  await saveScreen(page, testInfo, "corner-arm-advisory-confirmed-save");
});

test("browser map tool buttons expose active state", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await openInspectorIfCollapsed(page);
  await expectToolPressed(page, "design-action-pan", true);
  await expectToolPressed(page, "design-action-polygon", false);
  await selectBoundaryTool(page);
  await expectToolPressed(page, "design-action-pan", false);
  await expectToolPressed(page, "design-action-polygon", true);
  await selectPipelineTool(page);
  await expectToolPressed(page, "design-action-polygon", false);
  await expectToolPressed(page, "design-action-line", true);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "browser-map-tool-active-state");
});

for (const renderer of ["SVG", "MapLibre"] as const) {
  test(`${renderer} rejected boundary nudge preserves selection and saved geometry for correction`, async ({ page }, testInfo) => {
    if (renderer === "SVG") await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value(id: string, ...args: unknown[]) {
          return ["webgl", "webgl2", "experimental-webgl"].includes(id) ? null : Reflect.apply(original, this, [id, ...args]);
        },
      });
    });
    await page.goto("/");
    await openBaselineSample(page);
    await page.getByTestId("workspace-nav-files").click();
    const step = Math.max(1, defaultAppSettings().drawing.panStepMeters / 4);
    const x = 501000, y = 4506000;
    await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({ type: "FeatureCollection",
      properties: { projectCrs: "EPSG:32613" }, features: [{ type: "Feature", properties: { layerType: "field_boundary" },
        geometry: { type: "Polygon", coordinates: [[[x, y], [x + step, y], [x + step, y + 120], [x, y + 120], [x, y]]] } }],
    }));
    await page.getByTestId("files-action-import-geojson").click();
    await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
    await page.getByTestId("command-icon-save").click();
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    const stored = await workspaceStorageBytes(page);
    await page.getByTestId("workspace-nav-map").click();
    await selectEditTool(page);
    if (renderer === "SVG") await page.getByRole("button", { name: "Select first boundary vertex", exact: true }).click();
    else await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
    const nudge = renderer === "SVG" ? page.getByRole("button", { name: "Move selected vertex east", exact: true }) : page.getByTestId("browser-edit-nudge-east");
    await activateMapControl(nudge, testInfo);
    if (renderer === "SVG") {
      expect(await page.getByTestId("svg-map-shell").evaluate(element => element.scrollLeft),
        "activating a draft command must not scroll the outer map shell").toBe(0);
    }
    const rejection = page.getByText(/^Map edit rejected:.*duplicate/i);
    await expect(rejection).toBeVisible();
    const rejectionLayout = await measureTextClipping(rejection);
    await testInfo.attach("rejection-text-layout.json", { body: JSON.stringify(rejectionLayout, null, 2), contentType: "application/json" });
    expect(rejectionLayout.clippedBy, "Every rejection text line must remain inside its visible panel").toEqual([]);
    if (renderer === "MapLibre") {
      await page.getByTestId("browser-edit-delete-vertex").scrollIntoViewIfNeeded();
      expect((await measureTextClipping(rejection)).clippedBy).toEqual([]);
      await page.addStyleTag({ content: '[data-testid="browser-map-action-status"] { font-size: 18px !important; line-height: 24px !important; }' });
      expect((await measureTextClipping(rejection)).clippedBy).toEqual([]);
      await expectNoOverlap(page, "browser-map-action-status", "browser-map-hud-actions");
      await expectInsideContainer(page, "browser-map-bottom-dock", "browser-map-frame");
      await expectMinTargetSize(page, "browser-edit-delete-vertex", 44, 44);
    }
    await expect(page.getByText(/^Moved boundary vertex/)).toHaveCount(0);
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    await expect(nudge).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`${renderer.toLowerCase()}-rejected-vertex.png`), animations: "disabled" });
    // Correct a different vertex without reselecting the object; accepted edits remain undoable.
    if (renderer === "SVG") await page.getByRole("button", { name: "Select next editable vertex", exact: true }).click();
    else await activateMapControl(page.getByTestId("browser-edit-next-vertex"), testInfo);
    await activateMapControl(nudge, testInfo);
    await expect(page.getByText(/^Moved boundary vertex 2 of 4/)).toBeVisible();
    await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
    await page.getByTestId("command-icon-undo").click();
    await page.getByTestId("command-icon-save").click();
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    const saved = parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document);
    expect(saved.fieldBoundary).toEqual([{ x, y }, { x: x + step, y }, { x: x + step, y: y + 120 }, { x, y: y + 120 }]);
  });
}

test("text clipping probe distinguishes visible overflow from trailing wrap whitespace", async ({ page }) => {
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div data-testid="browser-map-status-hud"><div data-testid="probe-text" style="font-family:monospace;font-size:16px;line-height:20px;white-space:pre-wrap;overflow:hidden">Alpha beta</div></div>');
  const text = page.getByTestId("probe-text");
  await text.evaluate(element => {
    const range = document.createRange();
    range.setStart(element.firstChild!, 0);
    range.setEnd(element.firstChild!, 5);
    (element as HTMLElement).style.width = `${range.getBoundingClientRect().width + 0.5}px`;
  });
  expect(await text.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return [...range.getClientRects()].some(box => box.right > element.getBoundingClientRect().right + 1);
  })).toBe(true);
  expect((await measureTextClipping(text)).clippedBy).toEqual([]);
  await text.evaluate(element => { (element as HTMLElement).style.width = `${element.getBoundingClientRect().width - 6}px`; });
  expect((await measureTextClipping(text)).clippedBy).toContain("probe-text");
  await text.evaluate(element => { (element as HTMLElement).style.width = "200px"; });
  await page.getByTestId("browser-map-status-hud").evaluate(element => { (element as HTMLElement).style.height = "12px"; });
  expect((await measureTextClipping(text)).clippedBy).toContain("browser-map-status-hud");
});

test("browser map source details preserve camera, selection and saved geometry", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60000 });
  const stored = await workspaceStorageBytes(page);
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  const camera = await map.getAttribute("data-map-camera");
  const handle = page.getByTestId("browser-edit-drag-handle");
  const selection = await handle.getAttribute("aria-label");
  expect((await measureTextClipping(page.getByTestId("browser-map-attribution-credit"))).clippedBy).toEqual([]);
  const source = page.getByRole("button", { name: "Map source details", exact: true });
  await expectMinTargetSize(page, "browser-map-attribution-hud", 44, 44);
  await source.focus();
  await activateMapControl(source, testInfo);
  const dialog = page.getByTestId("browser-map-source-dialog");
  const attribution = dialog.getByText("USDA, USGS The National Map: Orthoimagery", { exact: true });
  const license = dialog.getByText(/USGS public National Map imagery service;/);
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Map Sources", exact: true })).toBeVisible();
  expect((await measureTextClipping(attribution)).clippedBy).toEqual([]);
  expect((await measureTextClipping(license)).clippedBy).toEqual([]);
  await dialog.screenshot({ path: testInfo.outputPath("map-source-details.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Close map source details", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(source).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(source).toBeFocused();
  await expect(map).toHaveAttribute("data-map-camera", camera!);
  await expect(handle).toHaveAttribute("aria-label", selection!);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await handle.hover();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing drag handle");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 - 8, { steps: 3 });
  await expect(handle).toHaveAttribute("data-drag-state", "active");
  await source.evaluate(element => (element as HTMLElement).click());
  await expect(dialog).toBeVisible();
  await expect(handle).toHaveAttribute("data-drag-state", "cancelled");
  await page.mouse.up();
  await page.getByRole("button", { name: "Close map source details", exact: true }).click();
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
});

test("browser map panel resize keeps feedback visible and cancels an active drag", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60000 });
  const stored = await workspaceStorageBytes(page);
  const frame = page.getByTestId("browser-map-frame");
  const status = page.getByTestId("browser-map-action-status");
  const actions = page.getByTestId("browser-map-hud-actions");
  await openInspectorIfCollapsed(page);
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeLessThan(600);
  await expect.poll(() => actions.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect((await measureTextClipping(status)).clippedBy).toEqual([]);
  await closeInspectorIfOpen(page);
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(600);
  expect((await measureTextClipping(status)).clippedBy).toEqual([]);
  await openInspectorIfCollapsed(page);
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeLessThan(600);
  const handle = page.getByTestId("browser-edit-drag-handle");
  await handle.hover();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing drag handle");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 - 8, { steps: 3 });
  await expect(handle).toHaveAttribute("data-drag-state", "active");
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(handle).not.toHaveAttribute("data-drag-state", "active");
  await page.mouse.up();
  expect((await measureTextClipping(status)).clippedBy).toEqual([]);
  await expectInsideContainer(page, "browser-map-bottom-dock", "browser-map-frame");
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  const camera = await map.getAttribute("data-map-camera");
  const canvas = await map.locator("canvas").boundingBox();
  if (!canvas) throw new Error("Missing map canvas");
  const start = { x: canvas.x + canvas.width * 0.6, y: canvas.y + canvas.height * 0.3 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 30, start.y - 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => map.getAttribute("data-map-camera")).not.toBe(camera);
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await saveScreen(page, testInfo, "resized-map-feedback");
});

test("browser map edit vertices nudges projected boundary through reducer actions", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await selectEditTool(page);
  await expect(page.getByTestId("design-action-edit")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("edit vertices · 0 draft pts")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("browser-edit-select-boundary").click();
  await expect(page.getByText(/Selected boundary vertex 1 of \d+ for projected XY editing\./)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await activateBrowserNudgeEast(page);
  await expect(page.getByText(/Moved boundary vertex 1 of \d+ in projected XY\. Save Local to persist\./)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "browser-edit-vertices-nudge");
});

test("browser map edit vertices nudges selected map feature through reducer actions", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await selectPipelineTool(page);
  await clickWorkbenchMap(page, { x: 170, y: 330 });
  await clickWorkbenchMap(page, { x: 250, y: 370 });
  await clickWorkbenchMap(page, { x: 285, y: 342 });
  await page.getByTestId("browser-action-save-feature").click();
  await choosePendingDraftPurpose(page, "Pipeline");
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await page.getByRole("button", { name: /Save.*\*/ }).first().click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await selectEditTool(page);
  await page.getByTestId("browser-edit-select-feature").click();
  await expect(page.getByText("Selected underground pipeline line vertex 1 of 3 for projected XY editing.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await activateBrowserNudgeEast(page);
  await expect(page.getByText("Moved underground pipeline line vertex 1 of 3 in projected XY. Save Local to persist.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
});

test("browser map edit vertices resizes selected circle map feature through radius handle", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  const sourceProject = parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document);
  await selectEndGunCircleTool(page);
  await closeInspectorIfOpen(page);
  // Draw safely inside the saved field; screen offsets depend on the current camera.
  await clickWorkbenchProjectedPoint(page, sourceProject.pivotCenter);
  await clickWorkbenchProjectedPoint(page, { x: sourceProject.pivotCenter.x + 40, y: sourceProject.pivotCenter.y });
  await page.getByTestId("browser-action-save-feature").click();
  await choosePendingDraftPurpose(page, "End-Gun Circle");
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await page.getByRole("button", { name: /Save.*\*/ }).first().click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await selectEditTool(page);
  await page.getByTestId("browser-edit-select-feature").click();
  await expect(page.getByText("Selected end gun arc circle center 1 of 2 for projected XY editing.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("browser-edit-next-vertex").click();
  await expect(page.getByText("Selected end gun arc circle radius handle 2 of 2 for projected XY editing.")).toBeVisible();
  await activateBrowserNudgeEast(page);
  await expect(page.getByText("Moved end gun arc circle radius handle 2 of 2 in projected XY. Save Local to persist.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
});

test("browser map edit inserts and drags a selected boundary vertex through reducer actions", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  const originalBoundary = parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary;
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);

  await page.getByTestId("browser-edit-select-boundary").click();
  const insert = page.getByTestId("browser-edit-insert-vertex");
  await expect(insert).toBeEnabled();
  await insert.click();
  await expect(page.getByText("Inserted a projected XY vertex at the selected segment midpoint. Drag the handle or nudge it to refine the position.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();

  const handle = page.getByTestId("browser-edit-drag-handle");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("data-drag-ready", "true");
  const box = await dragBrowserVertex(page, testInfo, { x: 18, y: 12 });
  await expect.poll(async () => {
    const moved = await handle.boundingBox();
    return moved ? Math.hypot(moved.x - box.x, moved.y - box.y) : 0;
  }).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText(/edit vertices .* boundary vertex 2 of 7/)).toBeVisible();
  await activateMapControl(page.getByTestId("browser-edit-delete-vertex"), testInfo);
  await expect(page.getByText("Deleted selected projected XY vertex.")).toBeVisible();
  await page.getByTestId("command-icon-undo").click();
  await page.getByTestId("command-icon-undo").click();
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary).toEqual(originalBoundary);
  await saveScreen(page, testInfo, "browser-edit-insert-drag-delete-undo");
});

test("cancelled browser vertex drag preserves saved geometry", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  const savedBefore = await workspaceStorageBytes(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await page.getByTestId("browser-edit-select-boundary").click();
  const handle = page.getByTestId("browser-edit-drag-handle");
  await expect(handle).toHaveAttribute("data-drag-ready", "true");
  await expect(handle).toHaveCSS("position", "absolute");
  await expect(handle).toBeInViewport();
  await expect.poll(() => handle.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  })).toBe(true);
  const box = await dragBrowserVertex(page, testInfo, { x: 35, y: 25 }, true);
  await expect(handle).toHaveAttribute("data-drag-state", "cancelled");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect.poll(async () => {
    const restored = await handle.boundingBox();
    return restored ? Math.hypot(restored.x - box.x, restored.y - box.y) : Infinity;
  }).toBeLessThan(2);
  expect(await workspaceStorageBytes(page)).toEqual(savedBefore);
  await saveScreen(page, testInfo, "cancelled-vertex-drag");
});

test("browser vertex handle tap and secondary buttons do not edit geometry", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  const stored = await workspaceStorageBytes(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  const handle = page.getByTestId("browser-edit-drag-handle");
  await expectMinTargetSize(page, "browser-edit-drag-handle", 44, 44);
  await activateMapControl(handle, testInfo);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  for (const button of ["right", "middle"] as const) {
    await handle.hover();
    await page.mouse.down({ button });
    await page.mouse.move(160, 250, { steps: 3 });
    await page.mouse.up({ button });
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  }
  expect(await workspaceStorageBytes(page)).toEqual(stored);
});

test("browser rejected vertex drag restores its marker and permits correction", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const x = 501370, y = 4506530;
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({ type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32613" }, features: [{ type: "Feature", properties: { layerType: "field_boundary" },
      geometry: { type: "Polygon", coordinates: [[[x, y], [x + 80, y], [x + 80, y + 60], [x, y + 60], [x, y]]] } }],
  }));
  await page.getByTestId("files-action-import-geojson").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const stored = await workspaceStorageBytes(page);
  const originalBoundary = parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary;
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60000 });
  const handle = page.getByTestId("browser-edit-drag-handle");
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  // Keep all rectangle corners in view before collecting screen coordinates across selections.
  const initialZoom = JSON.parse((await map.getAttribute("data-map-camera"))!)[2] as number;
  await map.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect.poll(async () => JSON.parse((await map.getAttribute("data-map-camera"))!)[2] as number)
    .toBeCloseTo(initialZoom - 1, 5);
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  const camera = await map.getAttribute("data-map-camera");
  await activateMapControl(page.getByTestId("browser-edit-next-vertex"), testInfo);
  await expect(map).toHaveAttribute("data-map-camera", camera!);
  await activateMapControl(page.getByTestId("browser-edit-next-vertex"), testInfo);
  await expect(handle).toHaveAttribute("aria-label", "Drag boundary vertex 3 of 4");
  await expect(map).toHaveAttribute("data-map-camera", camera!);
  const oppositeRight = await handle.boundingBox();
  await activateMapControl(page.getByTestId("browser-edit-next-vertex"), testInfo);
  await expect(handle).toHaveAttribute("aria-label", "Drag boundary vertex 4 of 4");
  await expect(map).toHaveAttribute("data-map-camera", camera!);
  const oppositeLeft = await handle.boundingBox();
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  await expect(handle).toHaveAttribute("aria-label", "Drag boundary vertex 1 of 4");
  await expect(map).toHaveAttribute("data-map-camera", camera!);
  const original = await handle.boundingBox();
  if (!original || !oppositeRight || !oppositeLeft) throw new Error("Missing boundary handles");
  // Move the first rectangle corner beyond the midpoint of its opposite edge to create a crossing.
  const oppositeMidpoint = {
    x: (oppositeRight.x + oppositeRight.width / 2 + oppositeLeft.x + oppositeLeft.width / 2) / 2,
    y: (oppositeRight.y + oppositeRight.height / 2 + oppositeLeft.y + oppositeLeft.height / 2) / 2,
  };
  await dragBrowserVertex(page, testInfo, {
    x: (oppositeMidpoint.x - original.x - original.width / 2) * 1.25,
    y: (oppositeMidpoint.y - original.y - original.height / 2) * 1.25,
  });
  await expect(page.getByText(/^Map edit rejected:/)).toBeVisible();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await expect.poll(async () => {
    const restored = await handle.boundingBox();
    return restored ? Math.hypot(restored.x - original.x, restored.y - original.y) : Infinity;
  }).toBeLessThan(2);
  await dragBrowserVertex(page, testInfo, { x: 12, y: -8 });
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  await page.getByTestId("command-icon-undo").click();
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary)
    .toEqual(originalBoundary);
});

test("browser vertex drag ignores foreign pointers and cancels on focus or capture loss", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  const stored = await workspaceStorageBytes(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  await expect(page.getByTestId("browser-advisory-generated-field-pivot-layer")).toBeVisible();
  const handle = page.getByTestId("browser-edit-drag-handle");
  for (const interruption of ["blur", "capture", "escape"] as const) {
    await handle.hover();
    const original = await handle.boundingBox();
    if (!original) throw new Error("Missing handle");
    await page.mouse.down();
    await expect(handle).toHaveAttribute("data-drag-state", "active");
    const map = page.getByLabel("CPLayout MapLibre imagery workbench");
    const camera = await map.getAttribute("data-map-camera");
    await page.locator(".maplibregl-canvas").focus();
    await page.keyboard.press("ArrowUp");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(map).toHaveAttribute("data-map-camera", camera!);
    await page.mouse.move(original.x + 34, original.y + 32, { steps: 3 });
    const preview = await handle.boundingBox();
    await page.evaluate(() => {
      for (const type of ["pointermove", "pointerup", "pointercancel"]) window.dispatchEvent(new PointerEvent(type,
        { pointerId: 999, pointerType: "touch", clientX: 10, clientY: 10, button: 0, buttons: type === "pointermove" ? 1 : 0 }));
    });
    await expect(handle).toHaveAttribute("data-drag-state", "active");
    expect(await handle.boundingBox()).toEqual(preview);
    if (interruption === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else if (interruption === "capture") {
      await handle.evaluate(element => element.releasePointerCapture(1));
      await page.mouse.move(original.x + 35, original.y + 33);
    }
    else await page.keyboard.press("Escape");
    await expect(handle).toHaveAttribute("data-drag-state", "cancelled");
    await page.mouse.up();
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    await expect.poll(async () => {
      const restored = await handle.boundingBox();
      return restored ? Math.hypot(restored.x - original.x, restored.y - original.y) : Infinity;
    }).toBeLessThan(2);
  }
  expect(await workspaceStorageBytes(page)).toEqual(stored);
});

test("browser vertex selection survives imagery replacement and SVG teardown cancels an active drag", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  const originalBoundary = parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary;
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  const handle = page.getByTestId("browser-edit-drag-handle");
  const oldHandle = await handle.elementHandle();
  if (!oldHandle) throw new Error("Missing handle");
  await openLayersSheet(page);
  await page.getByRole("button", { name: "Aerial Off", exact: true }).click();
  await page.getByTestId("design-console-close").click();
  await expect.poll(() => oldHandle.evaluate(element => element.isConnected)).toBe(false);
  await expect(handle).toHaveCount(1);
  await expect(handle).toHaveAttribute("aria-label", "Drag boundary vertex 1 of 6");
  // Settings changes use the ordinary project transaction; isolate the following drag.
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(parseProjectDocument((await readWorkspace(page)).projectDocuments[0].document).fieldBoundary).toEqual(originalBoundary);
  const stored = await workspaceStorageBytes(page);
  await handle.hover();
  await page.mouse.down();
  await expect(handle).toHaveAttribute("data-drag-state", "active");
  await page.getByTestId("browser-map-use-svg").evaluate(element => (element as HTMLElement).click());
  await expect(page.getByTestId("layout-map-svg")).toBeVisible();
  await expect(handle).toHaveCount(0);
  await page.mouse.move(150, 300);
  await page.mouse.up();
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0, clientX: 10, clientY: 10 })));
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await workspaceStorageBytes(page)).toEqual(stored);
});

test("browser camera controls cancel an active vertex drag before accepting late release", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  const stored = await workspaceStorageBytes(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await activateMapControl(page.getByTestId("browser-edit-select-boundary"), testInfo);
  await expect(page.getByTestId("browser-advisory-generated-field-pivot-layer")).toBeVisible();
  const handle = page.getByTestId("browser-edit-drag-handle");
  await handle.hover();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Missing handle");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 - 8, { steps: 3 });
  await expect(handle).toHaveAttribute("data-drag-state", "active");
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  const before = await map.getAttribute("data-map-camera");
  // A separate control activation must not reinterpret a captured drag in a new camera frame.
  await page.getByRole("button", { name: "Zoom in", exact: true }).evaluate(element => (element as HTMLElement).click());
  await expect.poll(() => map.getAttribute("data-map-camera")).not.toBe(before);
  await expect(handle).toHaveAttribute("data-drag-state", "cancelled");
  await page.mouse.up();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await workspaceStorageBytes(page)).toEqual(stored);
  await saveScreen(page, testInfo, "camera-control-cancels-vertex-drag");
});

test.describe("touch vertex ownership", () => {
  test.use({ hasTouch: true });
  test("a second finger cannot pitch the map or finish the active vertex drag", async ({ page }) => {
    await page.goto("/");
    await openBaselineSample(page);
    const stored = await workspaceStorageBytes(page);
    await page.getByTestId("workspace-nav-map").click();
    await selectEditTool(page);
    await page.getByTestId("browser-edit-select-boundary").tap();
    await expect(page.getByTestId("browser-advisory-generated-field-pivot-layer")).toBeVisible();
    const handle = page.getByTestId("browser-edit-drag-handle");
    const box = await handle.boundingBox();
    if (!box) throw new Error("Missing handle");
    const owner = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
    const other = { x: owner.x + 60, y: owner.y, id: 2 };
    const map = page.getByLabel("CPLayout MapLibre imagery workbench");
    const camera = await map.getAttribute("data-map-camera");
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [owner] });
      await expect(handle).toHaveAttribute("data-drag-state", "active");
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [owner, other] });
      for (let offset = 4; offset <= 16; offset += 4) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...owner, y: owner.y - offset }, { ...other, y: other.y - offset }] });
      }
      await expect(map).toHaveAttribute("data-map-camera", camera!);
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...owner, y: owner.y - 16 }] });
      await expect(handle).toHaveAttribute("data-drag-state", "active");
      await expect(page.getByTestId("project-save-state")).toContainText("Saved");
      await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await expect(handle).toHaveAttribute("data-drag-state", "cancelled");
    } finally {
      await session.detach();
    }
    expect(await workspaceStorageBytes(page)).toEqual(stored);
    await expect(map).toHaveAttribute("data-map-camera", camera!);
  });
});

test("browser boundary vertex selection keeps handles clear of the editing dock without changing saved data", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  const savedBefore = await workspaceStorageBytes(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await page.getByTestId("browser-edit-select-boundary").click();
  const handle = page.getByTestId("browser-edit-drag-handle");
  for (let vertex = 0; vertex < 6; vertex++) {
    await expect(handle).toHaveAttribute("aria-label", `Drag boundary vertex ${vertex + 1} of 6`);
    await expect.poll(() => handle.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
    })).toBe(true);
    await handle.hover();
    if (vertex < 5) await page.getByTestId("browser-edit-next-vertex").click();
  }
  expect(await workspaceStorageBytes(page)).toEqual(savedBefore);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "unobscured-boundary-vertex");
});

test("reselecting a drawing tool and opening machine settings preserve active drafts", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await selectBoundaryTool(page);
  await expect(page.getByTestId("design-action-polygon")).toHaveAttribute("aria-pressed", "true");
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await expect(page.getByText(/measure .* 1 draft pts .* polygon needs 3 pts/)).toBeVisible();

  await selectBoundaryTool(page);
  await expect(page.getByTestId("design-console-dialog")).toHaveCount(0);
  await expect(page.getByText(/measure .* 1 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await openDesignToolPanel(page, "machine");
  await expect(page.getByText(/measure .* 1 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await page.getByTestId("design-console-close").click();
  await expect(page.getByTestId("design-console-dialog")).toHaveCount(0);
  await expect(page.getByText(/measure .* 1 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "grouped-drawing-hud-draft-preserved");
});

test("browser map workflow modes expose active state", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-workflow-design")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("browser-workflow-layout")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("browser-workflow-layout").click();
  await expect(page.getByTestId("browser-workflow-design")).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("browser-workflow-layout")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Layout mode: RTK-only geometry changes; pointer gestures inspect only.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "browser-map-workflow-active-state");
});

test("compact warnings navigation reveals its tab without blocking map controls", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390");
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await page.getByTestId("command-menu-inspect").click();
  await page.getByTestId("command-inspect-warnings").click();
  const tabs = page.getByTestId("workflow-sidebar-tabs");
  const selected = page.getByTestId("workflow-sidebar-tab-warnings");
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect.poll(async () => {
    const strip = await tabs.boundingBox();
    const tab = await selected.boundingBox();
    return Boolean(strip && tab && tab.x >= strip.x - 1 && tab.x + tab.width <= strip.x + strip.width + 1);
  }).toBe(true);
  await expectInsideContainer(page, "right-workflow-sidebar", "map-view");
  await page.getByTestId("right-drawer-handle").click();
  const fit = page.getByTestId("browser-map-fit-field");
  await expect(fit).toBeEnabled();
  await expect.poll(() => fit.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
  const saved = await workspaceStorageBytes(page);
  await fit.click();
  expect(await workspaceStorageBytes(page)).toEqual(saved);
});

test("guided manual design stages required geometry without mutating until apply", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await openInspectorIfCollapsed(page);
  await page.getByTestId("workflow-sidebar-tab-tools").click();

  const transaction = page.getByTestId("manual-design-transaction");
  await transaction.scrollIntoViewIfNeeded();
  await expect(transaction).toBeVisible();
  if (testInfo.project.name === "mobile-390") {
    const mapBox = await page.getByTestId("browser-map-frame").boundingBox();
    const sheetBox = await page.getByTestId("right-workflow-sidebar").boundingBox();
    expect(mapBox, "mobile map bounding box").not.toBeNull();
    expect(sheetBox, "mobile workflow sheet bounding box").not.toBeNull();
    if (mapBox && sheetBox) {
      expect(mapBox.width).toBeGreaterThan(260);
      expect(mapBox.height).toBeGreaterThan(180);
      expect(sheetBox.width).toBeGreaterThan(260);
    }
    await expectInsideContainer(page, "right-workflow-sidebar", "map-view");
    await expectInsideViewport(page, "right-drawer-handle");
    await expectMinTargetSize(page, "right-drawer-handle", 44, 44);
    await expect(page.getByTestId("browser-map-status-hud")).toBeVisible();
    await expectInsideContainer(page, "browser-map-status-hud", "browser-map-frame");
    await expectInsideContainer(page, "browser-map-attribution-hud", "browser-map-frame");
    await expectNoOverlap(page, "browser-map-status-hud", "browser-map-attribution-hud");
    await expectNoOverlap(page, "browser-map-status-hud", "right-workflow-sidebar");
    await expectNoHorizontalOverflow(page);
  }
  await expect(transaction.getByRole("button", { name: "Boundary", exact: true })).toBeVisible();
  await expect(page.getByTestId("manual-design-boundary-sources")).toContainText("Map clicks");
  await expect(page.getByTestId("manual-design-boundary-sources")).toContainText("Projected XY");
  await expect(page.getByTestId("manual-design-boundary-sources")).toContainText("RTK");
  await expect(page.getByTestId("manual-design-boundary-sources")).toContainText("Imported");

  await page.getByTestId("manual-design-source-boundary-map_click").click();
  await clickWorkbenchMapFraction(page, { x: 0.2, y: 0.25 });
  await clickWorkbenchMapFraction(page, { x: 0.8, y: 0.25 });
  await clickWorkbenchMapFraction(page, { x: 0.8, y: 0.55 });
  const closingPoint = await clickWorkbenchMapFraction(page, { x: 0.2, y: 0.55 });
  await expect(page.getByTestId("manual-design-status")).toContainText("4 map-click boundary vertices staged");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await page.mouse.dblclick(closingPoint.x, closingPoint.y);
  await expect(page.getByTestId("browser-map-status-hud")).toContainText("0 draft pts");
  await expect(page.getByTestId("manual-design-status")).toContainText("4 map-click boundary vertices staged");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await transaction.getByRole("button", { name: "Pivot", exact: true }).click();
  await expect(page.getByTestId("manual-design-pivot-sources")).toContainText("WGS84");
  await page.getByTestId("manual-design-source-pivot-map_click").click();
  await clickWorkbenchMapFraction(page, { x: 0.5, y: 0.4 });
  await expect(page.getByTestId("manual-design-status")).toContainText("Map-click pivot staged");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await transaction.getByRole("button", { name: "Last Wheel", exact: true }).click();
  await expect(page.getByTestId("manual-design-last_wheel-sources")).toContainText("Machine specs");
  await expect(page.getByTestId("manual-design-span-rows")).toBeVisible();
  await page.getByTestId("manual-design-source-last_wheel-map_click").click();
  await clickWorkbenchMapFraction(page, { x: 0.58, y: 0.4 });
  await expect(page.getByTestId("manual-design-status")).toContainText("Map-click last wheel radius staged");
  await transaction.getByRole("button", { name: "Machine End", exact: true }).click();
  await expect(page.getByTestId("manual-design-machine_end-sources")).toContainText("RTK radius");
  await page.getByTestId("manual-design-source-machine_end-map_click").click();
  await clickWorkbenchMapFraction(page, { x: 0.68, y: 0.4 });
  await expect(page.getByTestId("manual-design-status")).toContainText("Map-click machine end radius staged");
  await transaction.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByTestId("manual-design-review")).toBeVisible();
  await expect(page.getByTestId("manual-design-apply")).toBeEnabled();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await page.getByTestId("manual-design-apply").click();
  await expect(page.getByTestId("manual-design-status")).toContainText("Manual design applied atomically");
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "guided-manual-design-review");
});

test("browser map utility sheets expose active state", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectPipelineTool(page);
  await expect(page.getByTestId("design-action-line")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("map-hud-active-tool-chip")).toContainText("Draw line");
  await selectPumpFeatureTool(page);
  await expect(page.getByTestId("design-action-point")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("map-hud-active-tool-chip")).toContainText("Draw point");
  await expect(page.getByText("measure · 0 draft pts · capture point, then choose purpose")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "browser-map-chip-active-state");
});

test("browser map HUD actions expose disabled state", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  const commit = page.getByTestId("browser-action-commit");
  const saveFeature = page.getByTestId("browser-action-save-feature");
  const clear = page.getByTestId("browser-action-clear");
  if (testInfo.project.name === "mobile-390") {
    await expect(commit).toHaveCount(0);
    await expect(saveFeature).toHaveCount(0);
    await expect(clear).toHaveCount(0);
  } else {
    await expect(commit).toHaveAttribute("aria-disabled", "true");
    await expect(saveFeature).toHaveCount(0);
    await expect(clear).toHaveAttribute("aria-disabled", "true");
  }

  await selectBoundaryTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await expect(clear).not.toHaveAttribute("aria-disabled", "true");
  await expect(clear).toBeEnabled();
  await expect(commit).toHaveCount(0);
  await expect(saveFeature).toBeDisabled();
  await clickWorkbenchMap(page, { x: 200, y: 240 });
  await clickWorkbenchMap(page, { x: 230, y: 185 });
  await expect(commit).toHaveCount(0);
  await expect(saveFeature).not.toHaveAttribute("aria-disabled", "true");
  await expect(saveFeature).toBeEnabled();

  await page.getByTestId("browser-action-clear").click();
  await selectPipelineTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 330 });
  await clickWorkbenchMap(page, { x: 220, y: 370 });
  await expect(commit).toHaveCount(0);
  await expect(saveFeature).not.toHaveAttribute("aria-disabled", "true");
  await expect(saveFeature).toBeEnabled();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "browser-map-hud-action-disabled-state");
});

test("browser map compact HUD actions stay inside the status panel", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectBoundaryTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await clickWorkbenchMap(page, { x: 200, y: 240 });
  await clickWorkbenchMap(page, { x: 230, y: 185 });
  await expect(page.getByTestId("browser-action-commit")).toHaveCount(0);
  await expect(page.getByTestId("browser-action-save-feature")).toBeEnabled();
  await expect(page.getByText(/measure .* 3 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectInsideContainer(page, "browser-map-bottom-dock", "browser-map-frame");
  await expectBottomGap(page, "browser-map-bottom-dock", "browser-map-frame", 4, 18);
  await expectInsideContainer(page, "browser-map-status-hud", "browser-map-frame");
  await expectInsideContainerIfVisible(page, "map-bottom-hud", "browser-map-frame");
  await expectInsideContainer(page, "browser-map-hud-actions", "browser-map-status-hud");
  await expectInsideContainer(page, "browser-action-undo-draft", "browser-map-hud-actions");
  await expectInsideContainer(page, "browser-action-save-feature", "browser-map-hud-actions");
  await expectInsideContainer(page, "browser-action-clear", "browser-map-hud-actions");
  await expectNoOverlap(page, "browser-map-status-hud", "browser-map-attribution-hud");
  await expectNoOverlapIfVisible(page, "map-bottom-hud", "browser-map-attribution-hud");
  await expectNoOverlapIfVisible(page, "map-bottom-hud", "browser-map-status-hud");
  await expectNoOverlapIfVisible(page, "workspace-bottom-status-bar", "map-bottom-hud");
  await expectNoOverlap(page, "workspace-bottom-status-bar", "browser-map-status-hud");
  await expectNoOverlap(page, "workspace-bottom-status-bar", "browser-map-attribution-hud");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "browser-map-compact-hud-actions");
});

test("layout mode keeps map clicks read-only and actions disabled", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await page.getByTestId("browser-workflow-layout").click();
  await expect(page.getByText("Layout mode: RTK-only geometry changes; pointer gestures inspect only.")).toBeVisible();
  const canvas = page.locator(".maplibregl-canvas");
  await canvas.click({ position: { x: 24, y: 180 } });
  await canvas.click({ position: { x: 32, y: 220 } });
  await canvas.click({ position: { x: 40, y: 190 } });
  await expect(page.getByText("Layout mode is RTK-only; switch to Design for pointer-based geometry edits.")).toBeVisible();
  await expect(page.getByText("pan · 0 draft pts")).toBeVisible();
  if (testInfo.project.name === "mobile-390") {
    await expect(page.getByTestId("browser-map-hud-actions")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("browser-action-commit")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("browser-action-save-feature")).toHaveCount(0);
    await expect(page.getByTestId("browser-action-clear")).toHaveAttribute("aria-disabled", "true");
  }
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "layout-mode-actions-disabled");
});

test("offline browser map workbench stays usable with external requests blocked", async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(testInfo.project.use.baseURL ?? "") && !url.startsWith("data:") && !url.startsWith("blob:")) {
      externalRequests.push(url);
    }
  });

  await page.goto("/");
  await openBaselineSample(page);
  await expect(page.getByTestId("workspace-screen")).toBeVisible();
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await expect(page.getByText(/project exports keep projected\/local XY geometry/)).toBeVisible();
  externalRequests.length = 0;
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByText(testInfo.project.name === "mobile-390"
    ? "EPSG:32613" : "EPSG:32613 canonical geometry · offline overlay", { exact: true })).toBeVisible();
  await expect(page.getByText(/Aerial imagery is off/)).toBeVisible();
  await selectBoundaryTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await expect(page.getByText(/measure .* 1 draft pts .* polygon needs 3 pts/)).toBeVisible();
  expect(externalRequests).toEqual([]);
  await saveScreen(page, testInfo, "offline-map-workbench");
});

test("settings custom imagery guidance blocks hidden-key assumptions", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Custom open" }).click();
  await expect(page.getByText(/Custom sources must be open, no-key/)).toBeVisible();
  await expect(page.getByText(/Hidden keys, tokens, paid hosted imagery/)).toBeVisible();
  await expect(page.getByLabel("Tile URL")).toBeVisible();
  await saveScreen(page, testInfo, "settings-custom-imagery-guidance");
});

test("settings custom imagery rejects credentialed tile templates", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/No connected aerial provider selected/);
  await page.getByRole("button", { name: "Custom open" }).click();
  await page.getByLabel("Source name").fill("Open County Tiles");
  await page.getByLabel("Tile URL").fill("https://example.org/tiles/{z}/{x}/{y}.png?token=secret");
  await page.getByRole("textbox", { name: "Coverage", exact: true }).fill("County open imagery coverage");
  await page.getByLabel("Attribution").fill("County GIS imagery");
  await page.getByLabel("License").fill("Open imagery license");
  await expect(page.getByText(/cannot include hidden API keys, tokens, signatures, or subscription credentials/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply custom open imagery source" })).toBeDisabled();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/No connected aerial provider selected/);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-custom-imagery-token-rejected");
});

test("settings rejected credentialed imagery never reaches map requests", async ({ page }, testInfo) => {
  const requestedUrls: string[] = [];
  page.on("request", (request) => {
    requestedUrls.push(request.url());
  });
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await page.getByRole("button", { name: "Custom open" }).click();
  await page.getByLabel("Source name").fill("Rejected Token Tiles");
  await page.getByLabel("Tile URL").fill("https://tiles.example.com/{z}/{x}/{y}.png?token=secret");
  await page.getByRole("textbox", { name: "Coverage", exact: true }).fill("Credentialed source should not be accepted");
  await page.getByLabel("Attribution").fill("Rejected attribution");
  await page.getByLabel("License").fill("Rejected license");
  await expect(page.getByRole("button", { name: "Apply custom open imagery source" })).toBeDisabled();
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByText(/Aerial imagery is off/)).toBeVisible();
  expect(requestedUrls.filter((url) => url.includes("tiles.example.com"))).toEqual([]);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-rejected-imagery-no-request");
});

test("network allowlist blocks credential query strings on allowed imagery hosts", async ({ page }, testInfo) => {
  await page.goto("/");
  expect(isAllowedNetworkRequest("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/0/0/0")).toBe(true);
  expect(isAllowedNetworkRequest("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/0/0/0")).toBe(true);
  expect(isAllowedNetworkRequest("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/0/0/0?token=secret")).toBe(false);
  expect(isAllowedNetworkRequest("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/0/0/0?token=secret")).toBe(false);
  expect(isAllowedExternalProofRequest("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/0/0/0?api_key=secret")).toBe(false);
  expect(isAllowedExternalProofRequest("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/0/0/0?api_key=secret")).toBe(false);
  await saveScreen(page, testInfo, "network-credential-query-blocked");
});

test("settings custom imagery applies no-key local tile templates", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await page.getByRole("button", { name: "Custom open" }).click();
  await page.getByLabel("Source name").fill("Local Open Tiles");
  await page.getByLabel("Tile URL").fill("http://127.0.0.1:8088/tiles/{z}/{x}/{y}.png");
  await page.getByRole("textbox", { name: "Coverage", exact: true }).fill("Operator-hosted local tile cache");
  await page.getByLabel("Attribution").fill("Operator open imagery");
  await page.getByLabel("License").fill("Open local imagery license");
  await expect(page.getByText("Custom source ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply custom open imagery source" })).toBeEnabled();
  await page.getByRole("button", { name: "Apply custom open imagery source" }).click();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/Operator-hosted local tile cache/);
  await expect(page.getByTestId("settings-imagery-guardrail-summary")).toHaveText(/imagery is reference-only and never canonical geometry/);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-custom-imagery-local-applied");
});

test("settings offline imagery guardrail exposes local-only export boundary", async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(testInfo.project.use.baseURL ?? "") && !url.startsWith("data:") && !url.startsWith("blob:")) {
      externalRequests.push(url);
    }
  });

  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/No connected aerial provider selected/);
  await expect(page.getByTestId("settings-imagery-guardrail-summary")).toHaveText(/project exports keep projected\/local XY geometry/);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  externalRequests.length = 0;
  expect(externalRequests).toEqual([]);
  await saveScreen(page, testInfo, "settings-offline-imagery-guardrail");
});

test("settings aerial workflow exposes local package and USGS preview modes", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await expect(page.getByTestId("settings-aerial-mode-off")).toBeVisible();
  await expect(page.getByTestId("settings-aerial-mode-auto")).toBeVisible();
  await expect(page.getByTestId("settings-aerial-mode-manual-local")).toBeVisible();
  await expect(page.getByTestId("settings-aerial-mode-usgs-only")).toBeVisible();
  await expect(page.getByTestId("settings-aerial-summary")).toHaveText(/Auto USGS fallback|USGS/);

  await page.getByTestId("settings-aerial-mode-auto").click();
  await expect(page.getByTestId("settings-aerial-summary")).toHaveText(/Auto USGS fallback/);
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/live preview only/);

  await page.getByTestId("settings-aerial-mode-manual-local").click();
  await expect(page.getByTestId("settings-aerial-summary")).toHaveText(/Choose a local raster aerial package/);

  await page.getByTestId("settings-aerial-mode-usgs-only").click();
  await expect(page.getByTestId("settings-aerial-summary")).toHaveText(/USGS only/);
  await expect(page.getByTestId("settings-aerial-guardrail")).toHaveText(/USGS live preview is connected-only/);

  await page.getByTestId("settings-aerial-mode-off").click();
  await expect(page.getByTestId("settings-aerial-summary")).toHaveText(/Aerial imagery is off/);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-aerial-workflow-modes");
});

test("settings tile cap stepper clamps interactive preview budget", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  const tileCap = page.getByTestId("settings-tile-cap-stepper");
  await expect(tileCap.getByTestId("settings-tile-cap-stepper-value")).toHaveText("64");
  await expect(tileCap.getByRole("button", { name: "Decrease Tile cap" })).toBeVisible();
  await expect(tileCap.getByRole("button", { name: "Increase Tile cap" })).toBeVisible();

  for (let index = 0; index < 9; index += 1) {
    await tileCap.getByRole("button", { name: "Increase Tile cap" }).click();
  }
  await expect(tileCap.getByTestId("settings-tile-cap-stepper-value")).toHaveText("128");

  for (let index = 0; index < 16; index += 1) {
    await tileCap.getByRole("button", { name: "Decrease Tile cap" }).click();
  }
  await expect(tileCap.getByTestId("settings-tile-cap-stepper-value")).toHaveText("8");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-tile-cap-stepper");
});

test("settings offline package guardrail keeps network tiles disabled", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  const packageSummary = page.getByTestId("settings-offline-package-summary");
  await expect(packageSummary).toHaveText(/Network tiles: disabled/);
  await expect(packageSummary).toHaveText(/Attribution: required/);
  await expect(packageSummary).toHaveText(/Local directory: offline-map-packages/);
  await expect(page.getByRole("button", { name: "PMTILES" })).toBeVisible();
  await expect(page.getByRole("button", { name: "MBTILES" })).toBeVisible();
  await expect(page.getByRole("button", { name: "RASTER TILES" })).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-offline-package-guardrail");
});

test("settings offline package type changes keep local-only guardrails", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  const packageSummary = page.getByTestId("settings-offline-package-summary");
  await page.getByRole("button", { name: "MBTILES" }).click();
  await expect(packageSummary).toHaveText(/Network tiles: disabled/);
  await expect(packageSummary).toHaveText(/Attribution: required/);
  await page.getByRole("button", { name: "RASTER TILES" }).click();
  await expect(packageSummary).toHaveText(/Network tiles: disabled/);
  await expect(packageSummary).toHaveText(/Local directory: offline-map-packages/);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-offline-package-type-change");
});

test("settings map style changes do not enable online imagery", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/No connected aerial provider selected/);
  await page.getByRole("button", { name: "Imagery", exact: true }).click();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/No connected aerial provider selected/);
  await expect(page.getByTestId("settings-imagery-guardrail-summary")).toHaveText(/project exports keep projected\/local XY geometry/);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByText(testInfo.project.name === "mobile-390"
    ? "EPSG:32613" : "EPSG:32613 canonical geometry · offline overlay", { exact: true })).toBeVisible();
  await expect(page.getByText(/Aerial imagery is off/)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-map-style-offline-imagery");
});

test("settings offline imagery off blocks map tile requests after live source is active", async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(testInfo.project.use.baseURL ?? "") && !url.startsWith("data:") && !url.startsWith("blob:")) {
      externalRequests.push(url);
    }
  });

  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/live preview only/);
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/No connected aerial provider selected/);
  externalRequests.length = 0;
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByText(/Aerial imagery is off/)).toBeVisible();
  expect(externalRequests).toEqual([]);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-offline-map-no-tile-requests");
});

test("settings browser-local imagery settings stay out of project zip", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "MBTILES" }).click();
  await page.getByRole("button", { name: "Custom open" }).click();
  await page.getByLabel("Source name").fill("Local Open Tiles");
  await page.getByLabel("Tile URL").fill("http://127.0.0.1:8088/tiles/{z}/{x}/{y}.png");
  await page.getByRole("textbox", { name: "Coverage", exact: true }).fill("Operator-hosted local tile cache");
  await page.getByLabel("Attribution").fill("Operator open imagery");
  await page.getByLabel("License").fill("Open local imagery license");
  await page.getByRole("button", { name: "Apply custom open imagery source" }).click();
  await expect(page.getByTestId("settings-imagery-source-summary")).toHaveText(/Operator-hosted local tile cache/);
  await page.getByTestId("workspace-nav-files").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP" }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath, "download path").not.toBeNull();
  if (!archivePath) return;
  const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  const projectJsonBytes = archive["project.json"];
  expect(projectJsonBytes, "project.json in archive").toBeDefined();
  if (!projectJsonBytes) return;
  const projectJson = strFromU8(projectJsonBytes);
  expect(projectJson).not.toContain("onlineImagery");
  expect(projectJson).not.toContain("referenceOverlay");
  expect(projectJson).not.toContain("tileUrlTemplate");
  expect(projectJson).not.toContain("Local Open Tiles");
  expect(projectJson).not.toContain("offline-map-packages");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "settings-local-imagery-excluded-from-zip");
});

test("dashboard walkthrough progress stays out of project zip", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByTestId("walkthrough-module-imagery").click();
  await page.getByTestId("walkthrough-module-export").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("2/9 modules")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await page.getByTestId("workspace-nav-files").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP" }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath, "download path").not.toBeNull();
  if (!archivePath) return;
  const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  const projectJsonBytes = archive["project.json"];
  expect(projectJsonBytes, "project.json in archive").toBeDefined();
  if (!projectJsonBytes) return;
  const projectJson = strFromU8(projectJsonBytes);
  expect(projectJson).not.toContain("walkthrough");
  expect(projectJson).not.toContain("cplayout.walkthrough-progress");
  expect(projectJson).not.toContain("Setup Imagery");
  expect(projectJson).not.toContain("Export Package");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-walkthrough-excluded-from-zip");
});

test("Will Rhea guided demo exposes evidence status and blocked corner-arm calculation", async ({ page }, testInfo) => {
  await page.goto("/");
  await openWillRheaExample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("will-rhea-guided-demo-panel")).toBeVisible();
  await expect(page.getByTestId("will-rhea-guided-demo-panel")).toContainText("EPSG:32614");
  await expect(page.getByTestId("will-rhea-evidence-status")).toContainText("Field boundary");
  await expect(page.getByTestId("will-rhea-evidence-status")).toContainText("LRDU Distance measurement_line");
  await expect(page.getByTestId("will-rhea-evidence-status")).toContainText("SHA-256");
  await expect(page.getByTestId("will-rhea-corner-arm-input-blockers")).toContainText("Measured LRDU speed");
  await expect(page.getByTestId("will-rhea-corner-arm-input-blockers")).toContainText("Source-labeled corner-arm model");
  await expect(page.getByTestId("will-rhea-corner-arm-input-blockers")).toContainText("Explicit SDU guidance-line");

  await page.getByTestId("walkthrough-module-cornerArmInputs").click();
  await page.getByTestId("walkthrough-module-cornerArmCalculation").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("2/9 modules")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("workspace-nav-map").click();
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("corner-input-missing")).toContainText("Positive last regular drive tower speed in ft/min");
  await expect(page.getByTestId("corner-input-missing")).toContainText("Corner model");
  await expect(page.getByTestId("corner-input-missing")).toContainText("Steerable corner tower guidance line");
  await expect(page.getByTestId("corner-input-run")).toBeDisabled();
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toHaveCount(0);
  await page.getByTestId("design-console-close").click();

  await openCornerArmAdvisorySheet(page);
  await expect(page.getByRole("button", { name: "Draw SDU Guidance Path", exact: true })).toBeVisible();
  await expect(page.getByText("Draw Track Evidence")).toHaveCount(0);
  await saveScreen(page, testInfo, "will-rhea-guided-demo-corner-arm-blocked");
});

test("dashboard next step separates imagery-off from live-source confirmation", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await page.getByRole("button", { name: /Save.*\*/ }).first().click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("dashboard-workspace")).toBeVisible();
  await expect(page.getByText("Next: choose local aerial package or USGS preview in Settings.")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-imagery-off-next-step");
});

test("dashboard offline imagery path advances after imagery walkthrough progress", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await page.getByRole("button", { name: /Save.*\*/ }).first().click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByText("Next: choose local aerial package or USGS preview in Settings.")).toBeVisible();
  await page.getByRole("checkbox", { name: "Complete Setup Imagery walkthrough checkpoint" }).click();
  await expect(page.getByText("Next: trace or inspect the field boundary in Design mode.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-offline-imagery-progress");
});

test("dashboard next step advances after imagery walkthrough progress", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByText("Next: confirm imagery attribution and source status.")).toBeVisible();
  await page.getByTestId("walkthrough-module-imagery").click();
  await expect(page.getByText("Next: trace or inspect the field boundary in Design mode.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-next-step-after-imagery-progress");
});

test("dashboard export readiness reflects unsaved browser geometry edits", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectBoundaryTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await clickWorkbenchMap(page, { x: 240, y: 180 });
  await clickWorkbenchMap(page, { x: 220, y: 250 });
  await page.getByTestId("browser-action-save-feature").click();
  await choosePendingDraftPurpose(page, "Field Boundary");
  await page.getByTestId("workspace-nav-dashboard").click();
  const exportCard = page.getByTestId("dashboard-card-export");
  await expect(exportCard.getByText("Save before export")).toBeVisible();
  await expect(exportCard.getByText(/Project ZIP excludes browser-local imagery settings/)).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-export-dirty-state");
});

test("files status keeps the canonical archive message visible", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const status = page.getByTestId("files-status");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status.getByText(/Browser local storage/)).toBeVisible();
  await expect(status.getByText(/Project ZIP is the canonical project package/)).toBeVisible();
  await expect(page.getByText("Project Files")).toBeVisible();
  await expect(page.getByText("Project Package", { exact: true })).toBeVisible();
  await saveScreen(page, testInfo, "files-status-canonical-package");
});

test("files actions expose accessible browser buttons", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("files-action-save-local")).toBeVisible();
  await expect(page.getByTestId("files-action-export-zip")).toBeVisible();
  await expect(page.getByTestId("files-action-import-zip")).toBeVisible();
  await expect(page.getByTestId("files-action-import-map-package")).toBeVisible();
  await expect(page.getByTestId("files-action-import-bpf")).toBeVisible();
  await expect(page.getByTestId("files-action-export-bpf")).toBeVisible();
  await expect(page.getByTestId("files-action-review-legacy-evidence")).toBeVisible();
  await expect(page.getByTestId("files-action-import-kml-kmz")).toBeVisible();
  await expect(page.getByTestId("files-action-export-kml")).toBeVisible();
  await expect(page.getByTestId("files-action-export-kmz")).toBeVisible();
  await expect(page.getByTestId("files-action-import-geojson")).toBeVisible();
  await expect(page.getByTestId("files-action-import-csv")).toBeVisible();
  await saveScreen(page, testInfo, "files-action-buttons");
});

test("google earth import wizard keeps companion boundaries visible", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const wizard = page.getByTestId("google-earth-import-wizard");
  await expect(wizard).toContainText("Search and stage Places");
  await expect(page.getByTestId("google-earth-wizard-boundary-note")).toContainText("Places are import candidates");
  await expect(page.getByTestId("google-earth-wizard-boundary-note")).toContainText("projected import-preview geometry");
  await page.getByTestId("google-earth-wizard-next").click();
  await expect(wizard).toContainText("Add Polygon for boundaries");
  await page.getByTestId("google-earth-wizard-step-ready").click();
  await expect(wizard).toContainText("1/6 complete");
  await expectNoHorizontalOverflow(page);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "files-google-earth-wizard-companion-boundary");
});

test("files map package import keeps web storage boundary explicit", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByRole("button", { name: "Import Map Package" }).click();
  await expect(page.getByTestId("files-status")).toContainText("Map package ZIP install is native-only until web package storage is configured.");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "files-map-package-native-only-boundary");
});

test("files export zip downloads the canonical project package", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.center-pivot\.zip$/);
  const status = page.getByTestId("files-status");
  await expect(status.getByText(/Downloaded .*\.center-pivot\.zip/)).toBeVisible();
  await expect(status.getByText(/Project ZIP is the canonical project package/)).toHaveCount(0);
  await saveScreen(page, testInfo, "files-export-zip-download");
});

test("files zip export excludes retired review contract files", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP" }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath, "download path").not.toBeNull();
  if (!archivePath) return;
  await expect(page.getByTestId("files-status")).toContainText("Downloaded");

  const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  expect(archive["exports/layout-evidence.jsonl"], "retired layout evidence file").toBeUndefined();
  expect(archive["exports/layout-decisions.jsonl"], "retired layout decisions file").toBeUndefined();
  expect(archive["exports/model-recommendations.geojson"], "retired model recommendations file").toBeUndefined();
  const manifest = archive["manifest.json"] ? strFromU8(archive["manifest.json"]) : "";
  expect(manifest).not.toContain("exports/layout-evidence.jsonl");
  expect(manifest).not.toContain("exports/layout-decisions.jsonl");
  expect(manifest).not.toContain("exports/model-recommendations.geojson");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "files-zip-retired-review-files-excluded");
});

test("files export kml downloads visual interchange data without runtime claims", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export KML" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.google-earth\.kml$/);
  const status = page.getByTestId("files-status");
  await expect(status.getByText(/Downloaded .*\.google-earth\.kml/)).toBeVisible();
  await expect(status.getByText(/Exported \d+ Google Earth feature/)).toBeVisible();
  await expect(status.getByText(/render proof/i)).toHaveCount(0);
  await saveScreen(page, testInfo, "files-export-kml-download");
});

test("files export kmz downloads a doc-kml archive without runtime claims", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export KMZ" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.google-earth\.kmz$/);
  const status = page.getByTestId("files-status");
  await expect(status.getByText(/Downloaded .*\.google-earth\.kmz/)).toBeVisible();
  await expect(status.getByText(/KMZ contains doc\.kml with \d+ feature/)).toBeVisible();
  await expect(status.getByText(/render proof/i)).toHaveCount(0);
  await saveScreen(page, testInfo, "files-export-kmz-download");
});

test("files projected geojson import dirties the project with projected xy status", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({
    type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32613" },
    features: [{
      type: "Feature",
      properties: { layerType: "field_boundary" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [501000, 4506000],
          [501300, 4506000],
          [501300, 4506300],
          [501000, 4506300],
          [501000, 4506000],
        ]],
      },
    }],
  }));
  await page.getByRole("button", { name: "Import GeoJSON" }).click();
  await expect(page.getByTestId("files-status").getByText(/Imported projected GeoJSON boundary/)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "files-geojson-import-projected-boundary");
});

test("files projected geojson import can be saved locally", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({
    type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32613" },
    features: [{
      type: "Feature",
      properties: { layerType: "field_boundary" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [501000, 4506000],
          [501300, 4506000],
          [501300, 4506300],
          [501000, 4506300],
          [501000, 4506000],
        ]],
      },
    }],
  }));
  await page.getByRole("button", { name: "Import GeoJSON" }).click();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect(page.getByTestId("files-status").getByText(/Browser local storage/)).toBeVisible();
  await saveScreen(page, testInfo, "files-geojson-import-save-local");
});

test("files projected geojson import clears the paste field after success", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const input = page.getByTestId("files-geojson-import-input");
  await input.fill(JSON.stringify({
    type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32613" },
    features: [{
      type: "Feature",
      properties: { layerType: "field_boundary" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [501000, 4506000],
          [501300, 4506000],
          [501300, 4506300],
          [501000, 4506300],
          [501000, 4506000],
        ]],
      },
    }],
  }));
  await page.getByRole("button", { name: "Import GeoJSON" }).click();
  await expect(page.getByTestId("files-status").getByText(/Imported projected GeoJSON boundary/)).toBeVisible();
  await expect(input).toHaveValue("");
  await saveScreen(page, testInfo, "files-geojson-import-clears-input");
});

test("files geojson import rejects wgs84 as canonical geometry", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({
    type: "FeatureCollection",
    properties: { projectCrs: "EPSG:4326" },
    features: [{
      type: "Feature",
      properties: { layerType: "field_boundary" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-104.1, 40.1],
          [-104.0, 40.1],
          [-104.0, 40.2],
          [-104.1, 40.2],
          [-104.1, 40.1],
        ]],
      },
    }],
  }));
  await page.getByRole("button", { name: "Import GeoJSON" }).click();
  await expect(page.getByTestId("files-status").getByText(/WGS84 is an input\/display layer only/)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "files-geojson-wgs84-rejected");
});

test("files rejected geojson import preserves the paste field for correction", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const input = page.getByTestId("files-geojson-import-input");
  const rejectedGeoJson = JSON.stringify({
    type: "FeatureCollection",
    properties: { projectCrs: "EPSG:4326" },
    features: [{
      type: "Feature",
      properties: { layerType: "field_boundary" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-104.1, 40.1],
          [-104.0, 40.1],
          [-104.0, 40.2],
          [-104.1, 40.2],
          [-104.1, 40.1],
        ]],
      },
    }],
  });
  await input.fill(rejectedGeoJson);
  await page.getByRole("button", { name: "Import GeoJSON" }).click();
  await expect(page.getByTestId("files-status").getByText(/WGS84 is an input\/display layer only/)).toBeVisible();
  await expect(input).toHaveValue(rejectedGeoJson);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "files-geojson-rejected-preserves-input");
});

test("files survey csv import dirties the project with projected point status", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\np1,Point 1,control,501010,4506010,imported,rtk_fixed\n");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByTestId("files-status").getByText(/Imported 1 survey point/)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "files-survey-csv-import-point");
});

test("files survey csv import can be saved locally", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\np1,Point 1,control,501010,4506010,imported,rtk_fixed\n");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect(page.getByTestId("files-status").getByText(/Browser local storage/)).toBeVisible();
  await saveScreen(page, testInfo, "files-survey-csv-import-save-local");
});

test("files survey csv import clears the paste field after success", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const input = page.getByTestId("files-survey-csv-import-input");
  await input.fill("id,label,role,x,y,source,confidence\np1,Point 1,control,501010,4506010,imported,rtk_fixed\n");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByTestId("files-status").getByText(/Imported 1 survey point/)).toBeVisible();
  await expect(input).toHaveValue("");
  await saveScreen(page, testInfo, "files-survey-csv-import-clears-input");
});

test("files survey csv import rejects missing projected xy columns", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,longitude,latitude\np1,No XY,-104,40\n");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByTestId("files-status").getByText(/projected x and y columns/)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "files-survey-csv-missing-xy-rejected");
});

test("survey view reflects imported projected survey csv evidence", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nsurvey-import-rtk-float,Imported Float,water_source,501030,4506030,imported,rtk_float\n");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await expect(page.getByTestId("files-status").getByText(/Imported 1 survey point/)).toBeVisible();
  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByTestId("survey-metric-points")).toContainText("3");
  await expect(page.getByTestId("survey-metric-rtk-fixed")).toContainText("1");
  await expect(page.getByTestId("survey-metric-draft-inputs")).toContainText("2");
  await expect(page.getByTestId("survey-point-survey-import-rtk-float").getByText("Imported Float")).toBeVisible();
  await expect(page.getByTestId("survey-point-survey-import-rtk-float").getByText(/water_source .* imported .* rtk_float/)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "survey-imported-csv-evidence");
});

test("survey point promotion writes projected water source after explicit action", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nsurvey-water-promote,Imported Water,water_source,501030,4506030,imported,rtk_fixed\n");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await page.getByTestId("workspace-nav-survey").click();
  const importedPoint = page.getByTestId("survey-point-survey-water-promote");
  await expect(importedPoint.getByText("Imported Water")).toBeVisible();
  await importedPoint.getByRole("button", { name: "Set Water from Imported Water" }).click();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await page.getByTestId("workspace-nav-files").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP" }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath, "download path").not.toBeNull();
  if (!archivePath) return;
  const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  const projectJsonBytes = archive["project.json"];
  expect(projectJsonBytes, "project.json in archive").toBeDefined();
  if (!projectJsonBytes) return;
  const projectDocument = JSON.parse(strFromU8(projectJsonBytes)) as { project?: { waterSource?: { x?: number; y?: number } } };
  expect(projectDocument.project?.waterSource).toEqual({ x: 501030, y: 4506030 });
  await saveScreen(page, testInfo, "survey-water-promotion-export");
});

test("survey point delete removes imported evidence from canonical export", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nsurvey-delete-me,Delete Me,note,501050,4506050,imported,rtk_float\n");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page.getByTestId("files-action-save-local").click();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await page.getByTestId("workspace-nav-survey").click();
  const importedPoint = page.getByTestId("survey-point-survey-delete-me");
  await expect(importedPoint.getByText("Delete Me")).toBeVisible();
  await importedPoint.getByRole("button", { name: "Delete survey point Delete Me" }).click();
  await expect(importedPoint).toHaveCount(0);
  await expect(page.getByTestId("survey-metric-points")).toContainText("2");
  await expect(page.getByTestId("survey-metric-draft-inputs")).toContainText("1");
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await page.getByTestId("workspace-nav-files").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP" }).click();
  const download = await downloadPromise;
  const archivePath = await download.path();
  expect(archivePath, "download path").not.toBeNull();
  if (!archivePath) return;
  const archive = unzipSync(new Uint8Array(await readFile(archivePath)));
  const projectJsonBytes = archive["project.json"];
  expect(projectJsonBytes, "project.json in archive").toBeDefined();
  if (!projectJsonBytes) return;
  const projectDocument = JSON.parse(strFromU8(projectJsonBytes)) as { project?: { surveyPoints?: { id?: string }[] } };
  expect(projectDocument.project?.surveyPoints?.some((point) => point.id === "survey-delete-me")).toBe(false);
  await saveScreen(page, testInfo, "survey-delete-export");
});

test("survey rtk float import counts as draft input", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-survey-csv-import-input").fill("id,label,role,x,y,source,confidence\nfloat-only,Float Only,control,501010,4506010,imported,rtk_float\n");
  await page.getByRole("button", { name: "Import CSV" }).click();
  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByTestId("survey-metric-points")).toContainText("3");
  await expect(page.getByTestId("survey-metric-rtk-fixed")).toContainText("1");
  await expect(page.getByTestId("survey-metric-draft-inputs")).toContainText("2");
  await expect(page.getByTestId("survey-point-float-only").getByText(/control .* imported .* rtk_float/)).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "survey-rtk-float-planning-grade");
});

test("survey point row actions expose point-specific accessible names", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByRole("button", { name: "Set Pivot from Pivot center repeated shot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete survey point Pivot center repeated shot" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete survey point Road digitized from imagery" })).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "survey-point-accessible-actions");
});

test("dashboard dirty geometry priority outranks imagery-off guidance", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-settings").click();
  await page.getByRole("button", { name: "Aerial Off" }).click();
  await page.getByTestId("workspace-nav-map").click();
  await selectBoundaryTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await clickWorkbenchMap(page, { x: 240, y: 180 });
  await clickWorkbenchMap(page, { x: 220, y: 250 });
  await page.getByTestId("browser-action-save-feature").click();
  await choosePendingDraftPurpose(page, "Field Boundary");
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByText("Next: save local edits and export a project package.")).toBeVisible();
  await expect(page.getByTestId("dashboard-card-imagery").getByText("Live imagery disabled")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-dirty-over-imagery-off");
});

test("dashboard walkthrough progress stays local and export-ready", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("0/9 modules")).toBeVisible();
  await page.getByTestId("walkthrough-module-imagery").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("1/9 modules")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect(page.getByTestId("dashboard-card-export").getByText("Ready to package")).toBeVisible();
  await expect(page.getByText("Progress is local-only and is never written into PivotProject or project archives.")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-walkthrough-local-progress");
});

test("dashboard walkthrough modules expose checkbox state and keyboard activation", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  const imagery = page.getByRole("checkbox", { name: "Complete Setup Imagery walkthrough checkpoint" });
  await expect(imagery).toBeVisible();
  await expect(imagery).not.toBeChecked();
  await imagery.focus();
  await page.keyboard.press("Space");
  const completedImagery = page.getByRole("checkbox", { name: "Clear Setup Imagery walkthrough checkpoint" });
  await expect(completedImagery).toBeChecked();
  const boundary = page.getByRole("checkbox", { name: "Complete Trace Boundary walkthrough checkpoint" });
  await boundary.click();
  await expect(page.getByRole("checkbox", { name: "Clear Trace Boundary walkthrough checkpoint" })).toBeChecked();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("2/9 modules")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-walkthrough-accessible-controls");
});

test("dashboard walkthrough progress is scoped to the active project", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await page.getByTestId("walkthrough-module-imagery").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("1/9 modules")).toBeVisible();
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-real-proof").click();
  await expect(page.getByText("Public Adams County Center Pivot Proof", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("0/9 modules")).toBeVisible();
  await openBaselineSample(page, false);
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("1/9 modules")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-walkthrough-project-scope");
});

test("dashboard walkthrough reset only clears the active project", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await page.getByTestId("walkthrough-module-imagery").click();
  await page.getByTestId("walkthrough-module-boundary").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("2/9 modules")).toBeVisible();
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-real-proof").click();
  await page.getByTestId("walkthrough-module-survey").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("1/9 modules")).toBeVisible();
  await page.getByRole("button", { name: "Reset walkthrough progress for active project" }).click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("0/9 modules")).toBeVisible();
  await openBaselineSample(page, false);
  await page.getByTestId("workspace-nav-dashboard").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("2/9 modules")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-walkthrough-reset-project-scope");
});

test("dashboard layout warnings expose actionable map guidance", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  const warnings = page.getByTestId("dashboard-layout-warnings");
  await expect(warnings.getByText("Layout Warnings")).toBeVisible();
  await expect(warnings.getByText("1 no-spray obstacle or exclusion zone removes modeled wet coverage.")).toBeVisible();
  await expect(warnings.getByText("1 obstacle conflict detected.")).toBeVisible();
  await expect(warnings.getByRole("button", { name: "Inspect Map" })).toBeVisible();
  await expect(page.getByTestId("review-view")).toHaveCount(0);
  await saveScreen(page, testInfo, "dashboard-layout-warning-guidance");
});

test("dashboard layout warnings can inspect the map without geometry mutation", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByTestId("dashboard-layout-warnings").getByRole("button", { name: "Inspect Map" }).click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect(page.getByText("Layout mode: RTK-only geometry changes; pointer gestures inspect only.")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-layout-warning-inspect-map");
});

test("dashboard recent-project empty state keeps start actions visible", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page, false);
  await page.getByTestId("workspace-nav-dashboard").click();
  const recentProjects = page.getByTestId("dashboard-recent-projects");
  await expect(recentProjects.getByText("Recent Projects")).toBeVisible();
  await expect(recentProjects.getByText("No saved browser projects yet.")).toBeVisible();
  await expect(recentProjects.getByRole("button", { name: "Create New" })).toBeVisible();
  await expect(recentProjects.getByRole("button", { name: "Open Sample" })).toBeVisible();
  await expect(recentProjects.getByRole("button", { name: "Real Proof" })).toBeVisible();
  await expect(recentProjects.getByRole("button", { name: "Improved Pivot Proof" })).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-recent-project-empty-state");
});

test("dashboard recent-project row can reopen a saved browser project", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByRole("button", { name: /^Save$/ }).click();
  const recentProjects = page.getByTestId("dashboard-recent-projects");
  const sampleRow = recentProjects.getByRole("button", { name: "Open recent project North Quarter Concept Layout" });
  await expect(sampleRow).toBeVisible();
  await recentProjects.getByRole("button", { name: "Create New" }).click();
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("catalog-notice")).toContainText("Select or create a customer");
  await expect(page.getByText("Untitled Field Layout", { exact: true })).toBeHidden();
  await openBaselineSample(page, false);
  await page.getByTestId("workspace-nav-dashboard").click();
  await page.getByTestId("dashboard-recent-projects").getByRole("button", { name: "Open recent project North Quarter Concept Layout" }).click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-recent-project-reopen");
});

async function captureConsoleFailures(page: Page): Promise<void> {
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      if (text.includes("Failed to load resource: net::ERR_BLOCKED_BY_CLIENT")) return;
      if (text.includes("Failed to load resource: net::ERR_NETWORK_CHANGED")) return;
      throw new Error(`Browser console error: ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    throw error;
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectNoPageScroll(page: Page): Promise<void> {
  const scroll = await page.evaluate(() => ({
    body: document.body.scrollHeight - document.body.clientHeight,
    document: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(scroll.body, "body page scroll delta").toBeLessThanOrEqual(2);
  expect(scroll.document, "document page scroll delta").toBeLessThanOrEqual(2);
  expect(scroll.x, "document horizontal overflow").toBeLessThanOrEqual(2);
}

async function expectMinTargetSize(page: Page, testId: string, minWidth: number, minHeight: number): Promise<void> {
  const box = await page.getByTestId(testId).boundingBox();
  expect(box, `${testId} bounding box`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${testId} width`).toBeGreaterThanOrEqual(minWidth);
  expect(box.height, `${testId} height`).toBeGreaterThanOrEqual(minHeight);
}

async function openProjectDrawerIfCollapsed(page: Page): Promise<void> {
  const openButton = page.getByRole("button", { name: "Open project drawer" });
  if (await openButton.count() === 0) return;
  if (await openButton.first().isVisible()) await openButton.first().click();
}

async function closeProjectDrawerIfOpen(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: "Collapse project drawer" });
  if (await closeButton.count() === 0) return;
  if (await closeButton.first().isVisible()) await closeButton.first().click();
}

async function openInspectorIfCollapsed(page: Page): Promise<void> {
  const openButton = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ });
  if (await openButton.count() === 0) return;
  if (await openButton.first().isVisible()) await openButton.first().click();
}

async function closeInspectorIfOpen(page: Page): Promise<void> {
  const closeButton = page.getByRole("button", { name: /Collapse (map inspector|right workflow sidebar)/ });
  if (await closeButton.count() === 0) return;
  if (await closeButton.first().isVisible()) await closeButton.first().click();
}

async function expectShortMapControlsClear(page: Page): Promise<void> {
  await expectInsideContainer(page, "browser-map-bottom-dock", "browser-map-frame");
  for (const selector of [".maplibregl-ctrl-zoom-in", ".maplibregl-ctrl-zoom-out"]) {
    const zoomBox = await page.locator(selector).boundingBox();
    expect(zoomBox).not.toBeNull();
    for (const id of ["browser-map-attribution-hud", "browser-map-status-hud"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box).not.toBeNull();
      const overlaps = box!.x < zoomBox!.x + zoomBox!.width && box!.x + box!.width > zoomBox!.x
        && box!.y < zoomBox!.y + zoomBox!.height && box!.y + box!.height > zoomBox!.y;
      expect(overlaps, `${id} must not cover ${selector}`).toBe(false);
    }
  }
  expect((await measureTextClipping(page.getByTestId("browser-map-action-status"))).clippedBy).toEqual([]);
  const creditBox = await page.getByTestId("browser-map-attribution-hud").boundingBox();
  expect(creditBox!.height).toBeGreaterThanOrEqual(44);
}

async function openCommandMenu(page: Page, menuId: string): Promise<void> {
  const panel = page.getByTestId(`command-menu-${menuId}-panel`);
  if (await panel.count() > 0 && await panel.first().isVisible()) {
    await closeCommandMenu(page, menuId);
  }
  await page.getByTestId(`command-menu-${menuId}`).click();
  await expect(panel).toBeVisible();
}

async function closeCommandMenu(page: Page, menuId: string): Promise<void> {
  const closeButton = page.getByTestId(`command-menu-${menuId}-close`);
  if (await closeButton.count() > 0 && await closeButton.first().isVisible()) {
    await closeButton.first().click();
    await expect(page.getByTestId(`command-menu-${menuId}-panel`)).toBeHidden();
    return;
  }
  await page.getByTestId(`command-menu-${menuId}`).click();
  await expect(page.getByTestId(`command-menu-${menuId}-panel`)).toBeHidden();
}

async function openBaselineSample(page: Page, persist = true): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  // These workflows compare edits against a persisted baseline, not an unsaved sample.
  if (persist) {
    await page.getByTestId("command-icon-save").click();
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  }
}

async function openWillRheaExample(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-will-rhea-jason-harmelink-example").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Will Rhea / Jason Harmelink Example Map");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
}

async function openFullScopeCostDemoSample(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-sample-full-scope-multi-pivot-cost-demo").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Full-Scope Multi-Pivot Cost Demo");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
}

async function openPartialSweepSample(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-sample-partial-sweep-road-structure").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Partial Sweep Near Road And Pad");
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
}

async function openCatalogFromFile(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-catalog").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
}

async function startBlankDesignFromFile(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-blank-design").click();
  await expect(page.getByTestId("catalog-dialog")).toBeVisible();
}

async function navigateToSurvey(page: Page): Promise<void> {
  if (await page.getByTestId("command-menu-view").count() > 0) {
    await openCommandMenu(page, "view");
    await page.getByTestId("command-view-survey").click();
    return;
  }
  await page.getByTestId("workspace-nav-survey").click();
}

async function expectTopToolbarSingleRow(page: Page): Promise<void> {
  const metrics = await page.getByTestId("workspace-top-toolbar").evaluate((node) => {
    const toolbar = node as HTMLElement;
    const commandBar = toolbar.querySelector("[data-testid='workspace-command-bar']") as HTMLElement | null;
    const rect = toolbar.getBoundingClientRect();
    const buttonTops = Array.from(commandBar?.querySelectorAll("[role='button']") ?? []).map((button) => Math.round((button as HTMLElement).getBoundingClientRect().top));
    return {
      buttonCount: buttonTops.length,
      buttonTopSpread: buttonTops.length > 1 ? Math.max(...buttonTops) - Math.min(...buttonTops) : 0,
      commandBarFlexWrap: commandBar ? getComputedStyle(commandBar).flexWrap : null,
      height: rect.height,
      toolbarFlexWrap: getComputedStyle(toolbar).flexWrap,
    };
  });
  expect(metrics.height, "toolbar height").toBeLessThanOrEqual(64);
  expect(metrics.toolbarFlexWrap, "toolbar flex-wrap").toBe("nowrap");
  expect(metrics.commandBarFlexWrap, "command bar flex-wrap").toBe("nowrap");
  expect(metrics.buttonTopSpread, "toolbar command button row spread").toBeLessThanOrEqual(3);
}

async function expectBreadcrumbLongTextTruncates(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const toolbar = document.querySelector("[data-testid='workspace-top-toolbar']") as HTMLElement | null;
    const breadcrumb = document.querySelector("[data-testid='workspace-breadcrumb-current']") as HTMLElement | null;
    if (!toolbar || !breadcrumb) return null;
    const original = breadcrumb.textContent;
    const before = toolbar.getBoundingClientRect().height;
    try {
      breadcrumb.textContent = `CPLayout / ${"Very Long Project Name ".repeat(24)}`;
      const after = toolbar.getBoundingClientRect().height;
      const toolbarRect = toolbar.getBoundingClientRect();
      const breadcrumbRect = breadcrumb.getBoundingClientRect();
      return {
        after,
        before,
        breadcrumbRight: breadcrumbRect.right,
        toolbarRight: toolbarRect.right,
      };
    } finally {
      breadcrumb.textContent = original;
    }
  });
  expect(metrics, "breadcrumb metrics").not.toBeNull();
  if (!metrics) return;
  expect(metrics.after, "toolbar height after long breadcrumb").toBeLessThanOrEqual(metrics.before + 1);
  expect(metrics.after, "toolbar long-name height cap").toBeLessThanOrEqual(64);
  expect(metrics.breadcrumbRight, "breadcrumb stays inside toolbar").toBeLessThanOrEqual(metrics.toolbarRight + 2);
}

async function expectPassiveBottomStatusBar(page: Page): Promise<void> {
  await expect(page.getByTestId("workspace-bottom-status-bar")).toBeVisible();
  const metrics = await page.getByTestId("workspace-bottom-status-bar").evaluate((node) => {
    const statusBar = node as HTMLElement;
    const commandBar = document.querySelector("[data-testid='workspace-command-bar']") as HTMLElement | null;
    const rect = statusBar.getBoundingClientRect();
    return {
      buttonCount: statusBar.querySelectorAll("[role='button'],button").length,
      commandBarHasSaveState: Boolean(commandBar?.querySelector("[data-testid='project-save-state']")),
      hasCatalogState: Boolean(statusBar.querySelector("[data-testid='catalog-save-state']")),
      hasSaveState: Boolean(statusBar.querySelector("[data-testid='project-save-state']")),
      height: rect.height,
    };
  });
  expect(metrics.height, "bottom status bar height").toBeGreaterThanOrEqual(28);
  expect(metrics.height, "bottom status bar height").toBeLessThanOrEqual(36);
  expect(metrics.buttonCount, "bottom status bar command buttons").toBe(0);
  expect(metrics.hasCatalogState || metrics.hasSaveState, "catalog or project state moved to bottom status bar").toBe(true);
  expect(metrics.commandBarHasSaveState, "save state absent from top command bar").toBe(false);
}

async function expectNoSavedProjectDocuments(page: Page): Promise<void> {
  const workspace = await readWorkspace(page);
  expect(workspace.catalog.designs).toEqual([]);
  expect(workspace.projectDocuments).toEqual([]);
  expect((await workspaceStorageBytes(page)).slice(1, 3)).toEqual([null, null]);
}

async function createClientFolder(
  page: Page,
  name: string,
  profile: Partial<{
    firstName: string;
    middleInitial: string;
    lastName: string;
    suffix: string;
    email: string;
    phone: string;
    location: string;
    notes: string;
  }> = {},
): Promise<void> {
  await openProjectDrawerIfCollapsed(page);
  await clickProjectTreeAction(page, "client");
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Last name").fill(profile.lastName ?? "Contact");
  await page.getByLabel("First name").fill(profile.firstName ?? "Primary");
  if (Object.keys(profile).length) await page.getByTestId("client-profile-details-toggle").click();
  if (profile.middleInitial !== undefined) await page.getByLabel("M.I.").fill(profile.middleInitial);
  if (profile.suffix !== undefined) await page.getByLabel("Suffix").fill(profile.suffix);
  if (profile.email !== undefined) await page.getByLabel("Email").fill(profile.email);
  if (profile.phone !== undefined) await page.getByLabel("Phone").fill(profile.phone);
  if (profile.location !== undefined) await page.getByLabel("Location").fill(profile.location);
  if (profile.notes !== undefined) await page.getByLabel("Notes").fill(profile.notes);
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
}

async function createProjectForSelectedClient(page: Page, itemName: string, contextText?: string | RegExp): Promise<void> {
  await openInspectorIfCollapsed(page);
  await page.getByTestId("inspector-scroll").getByRole("button", { name: "New Project", exact: true }).click();
  await expect(page.getByTestId("catalog-dialog")).toBeVisible();
  if (contextText) await expect(page.getByTestId("catalog-dialog-context")).toContainText(contextText);
  await page.getByLabel("Catalog item name").fill(itemName);
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
}

async function createProjectFromRail(page: Page, itemName: string, contextText?: string | RegExp): Promise<void> {
  await openProjectDrawerIfCollapsed(page);
  await clickProjectTreeAction(page, "project");
  await expect(page.getByTestId("catalog-dialog")).toBeVisible();
  if (contextText) await expect(page.getByTestId("catalog-dialog-context")).toContainText(contextText);
  await page.getByLabel("Catalog item name").fill(itemName);
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
}

async function createCatalogItem(page: Page, actionName: string, itemName: string, contextText?: string | RegExp): Promise<void> {
  await openProjectDrawerIfCollapsed(page);
  await clickProjectTreeAction(page, projectTreeActionId(actionName));
  await expect(page.getByTestId("catalog-dialog")).toBeVisible();
  if (contextText) await expect(page.getByTestId("catalog-dialog-context")).toContainText(contextText);
  await page.getByLabel("Catalog item name").fill(itemName);
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
}

type ProjectTreeActionId = "client" | "project" | "field-map" | "design" | "blank-design" | "open-sample";

function projectTreeActionId(label: string): ProjectTreeActionId {
  if (label === "Client") return "client";
  if (label === "Project") return "project";
  if (label === "Field Map") return "field-map";
  if (label === "Design") return "design";
  if (label === "Blank Design") return "blank-design";
  if (label === "Open Sample") return "open-sample";
  throw new Error(`Unknown project tree action ${label}`);
}

async function openProjectTreeActionOverflow(page: Page): Promise<void> {
  await openProjectDrawerIfCollapsed(page);
  const overflow = page.getByTestId("project-tree-action-overflow");
  if (await overflow.count() > 0 && await overflow.isVisible()) return;
  await page.getByTestId("project-tree-action-more").click();
  await expect(overflow).toBeVisible();
}

async function closeProjectTreeActionOverflow(page: Page): Promise<void> {
  const overflow = page.getByTestId("project-tree-action-overflow");
  if (await overflow.count() === 0 || !(await overflow.isVisible())) return;
  await page.getByTestId("project-tree-action-more").click();
  await expect(overflow).toBeHidden();
}

async function clickProjectTreeAction(page: Page, actionId: ProjectTreeActionId): Promise<void> {
  await openProjectTreeActionOverflow(page);
  await page.getByTestId(`project-tree-action-${actionId}`).click();
  await expect(page.getByTestId("project-tree-action-overflow")).toBeHidden();
}

async function saveScreen(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  await page.screenshot({
    fullPage: true,
    path: testInfo.outputPath(`${label}.png`),
  });
}

async function clickHudAction(page: Page, testId: string): Promise<void> {
  const geometryAction = /^design-action-(pan|edit|point|line|polygon|circle)$/.test(testId);
  if (geometryAction) {
    await activateMapTool(page, testId.replace("design-action-", "") as Parameters<typeof activateMapTool>[1]);
    return;
  }
  let action;
  {
    await openInspectorIfCollapsed(page);
    const toolsTab = page.getByTestId("workflow-sidebar-tab-tools");
    if (await toolsTab.count() > 0 && await toolsTab.first().isVisible()) await toolsTab.first().click();
    action = page.getByTestId("inspector-scroll").getByTestId(testId).first();
  }
  await action.scrollIntoViewIfNeeded();
  await action.click();
}

async function expectToolPressed(page: Page, testId: string, pressed: boolean): Promise<void> {
  const tool = page.getByTestId(testId);
  if (pressed) {
    await expect(tool).toHaveAttribute("aria-pressed", "true");
    return;
  }
  await expect(tool).not.toHaveAttribute("aria-pressed", "true");
}

async function openDesignToolPanel(page: Page, action: "point" | "line" | "polygon" | "circle" | "machine" | "layers" | "calculate"): Promise<void> {
  await clickHudAction(page, `design-action-${action}`);
  if (action === "layers") {
    await expect(page.getByTestId("places-layers-summary")).toBeVisible();
    return;
  }
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
}

async function chooseDesignConsoleTool(page: Page, label: string): Promise<void> {
  await page.getByTestId("design-console-dialog").getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByTestId("design-console-dialog")).toHaveCount(0);
}

async function openLayersSheet(page: Page): Promise<void> {
  await openDesignToolPanel(page, "layers");
  await expect(page.getByTestId("places-layers-summary")).toBeVisible();
}

async function openPivotGpsSheet(page: Page): Promise<void> {
  await openDesignToolPanel(page, "machine");
  await page.getByRole("button", { name: "Pivot GPS Entry", exact: true }).click();
  await expect(page.getByLabel("Pivot latitude and longitude decimal degrees")).toBeVisible();
}

async function openCornerArmAdvisorySheet(page: Page): Promise<void> {
  await openDesignToolPanel(page, "machine");
  await page.getByRole("button", { name: "Corner Arm Advisory", exact: true }).click();
  await expect(page.getByTestId("corner-arm-advisory-badges")).toBeVisible();
}

async function selectBoundaryTool(page: Page): Promise<void> {
  await clickHudAction(page, "design-action-polygon");
}

async function selectPipelineTool(page: Page): Promise<void> {
  await clickHudAction(page, "design-action-line");
}

async function selectPumpFeatureTool(page: Page): Promise<void> {
  await clickHudAction(page, "design-action-point");
}

async function selectEndGunCircleTool(page: Page): Promise<void> {
  await openDesignToolPanel(page, "circle");
  await chooseDesignConsoleTool(page, "Circle");
}

async function selectCornerFootprintTool(page: Page): Promise<void> {
  await clickHudAction(page, "design-action-polygon");
}

async function choosePendingDraftPurpose(page: Page, label: string): Promise<void> {
  const panel = page.getByTestId("pending-draft-purpose-panel");
  await expect(panel).toBeVisible();
  await panel.getByTestId("pending-draft-purpose-select").selectOption({ label });
  await panel.getByTestId("pending-draft-keep").click();
}

async function selectPanTool(page: Page): Promise<void> {
  await clickHudAction(page, "design-action-pan");
}

async function selectEditTool(page: Page): Promise<void> {
  await clickHudAction(page, "design-action-edit");
}

async function activateBrowserNudgeEast(page: Page): Promise<void> {
  const button = page.getByTestId("browser-edit-nudge-east");
  await expect(button).toBeEnabled();
  await button.click();
}

async function measureTextClipping(control: Locator) {
  return control.evaluate(element => {
    const rect = (box: DOMRect) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height });
    const range = document.createRange();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const lines: ReturnType<typeof rect>[] = [];
    // Wrapped trailing whitespace can extend beyond the line without clipped visible text.
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const word of (node.textContent ?? "").matchAll(/\S+/g)) {
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        lines.push(...[...range.getClientRects()].filter(box => box.width > 0 && box.height > 0).map(rect));
      }
    }
    const ancestors = [];
    const clippedBy: string[] = [];
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const bounds = rect(parent.getBoundingClientRect());
      const name = parent.getAttribute("data-testid") ?? parent.tagName;
      const contained = parent === element || parent.matches('[data-testid="browser-map-status-hud"], [data-testid="browser-map-attribution-hud"]');
      const clipX = contained || /hidden|clip|auto|scroll/.test(style.overflowX);
      const clipY = contained || /hidden|clip|auto|scroll/.test(style.overflowY);
      ancestors.push({ name, bounds, clipX, clipY });
      if (lines.some(line => (clipX && (line.left < bounds.left - 1 || line.right > bounds.right + 1))
        || (clipY && (line.top < bounds.top - 1 || line.bottom > bounds.bottom + 1)))) clippedBy.push(name);
    }
    if (!lines.length) clippedBy.push("no text rectangles");
    if (lines.some(line => line.left < -1 || line.right > innerWidth + 1 || line.top < -1 || line.bottom > innerHeight + 1)) clippedBy.push("viewport");
    return { lines, ancestors, clippedBy };
  });
}

async function activateMapControl(control: Locator, testInfo: TestInfo): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  if (testInfo.project.use.hasTouch) await control.tap();
  else await control.click();
}

async function dragBrowserVertex(page: Page, testInfo: TestInfo, delta: { x: number; y: number }, cancel = false) {
  const handle = page.getByTestId("browser-edit-drag-handle");
  const box = await handle.boundingBox();
  expect(box, "selected vertex drag handle").not.toBeNull();
  if (!box) throw new Error("Selected vertex drag handle is missing.");
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (testInfo.project.use.hasTouch) {
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
      await expect(handle).toHaveAttribute("data-drag-state", "active");
      for (let step = 1; step <= 4; step++) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + delta.x * step / 4, y: start.y + delta.y * step / 4, id: 1 }] });
      }
      await session.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
    } finally {
      await session.detach();
    }
  } else {
    await handle.hover();
    await page.mouse.down();
    await expect(handle).toHaveAttribute("data-drag-state", "active");
    await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 4 });
    if (cancel) await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 })));
    await page.mouse.up();
  }
  return box;
}

async function clickWorkbenchMap(page: Page, position: { x: number; y: number }): Promise<void> {
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  expect(box, "map workbench bounding box").not.toBeNull();
  if (!box) return;
  const viewport = page.viewportSize();
  const phoneLayout = Boolean(viewport && viewport.width < 700);
  const tabletLayout = Boolean(viewport && viewport.width >= 700 && viewport.width < 900);
  const dock = await page.getByTestId("browser-map-bottom-dock").boundingBox();
  const availableBottom = Math.min(box.height - 16, dock ? dock.y - box.y - 16 : box.height - 16);
  const target = phoneLayout
    ? {
      x: Math.min(Math.max(position.x, 28), Math.max(28, box.width - 28)),
      y: 48 + Math.min(1, Math.max(0, position.y / 500)) * (availableBottom - 48),
    }
    : tabletLayout
      ? {
        x: Math.min(Math.max(position.x, 32), Math.max(32, box.width - 32)),
        y: 48 + Math.min(1, Math.max(0, position.y / 500)) * (availableBottom - 48),
      }
    : position;
  expect(availableBottom, "unobstructed map height").toBeGreaterThan(120);
  const hit = await unobstructedMapPoint(map, { x: box.x + target.x, y: box.y + target.y }, "canvas");
  await page.mouse.click(hit.x, hit.y);
}

async function clickWorkbenchProjectedPoint(page: Page, position: { x: number; y: number }): Promise<void> {
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  await map.scrollIntoViewIfNeeded();
  let previousCamera: string | null = null;
  await expect.poll(async () => {
    const current = await map.getAttribute("data-map-camera");
    const stable = current !== null && current === previousCamera;
    previousCamera = current;
    return stable;
  }, { intervals: [200], message: "map camera must settle before projecting a test click" }).toBe(true);
  const cameraText = await map.getAttribute("data-map-camera");
  expect(cameraText, "loaded map camera").not.toBeNull();
  const [longitude, latitude, zoom, bearing, pitch] = JSON.parse(cameraText!) as number[];
  expect(bearing).toBeCloseTo(0, 8);
  expect(pitch).toBeCloseTo(0, 8);
  const frame = await map.boundingBox();
  expect(frame, "map workbench bounding box").not.toBeNull();
  if (!frame) return;
  const target = projectXyToLonLat(position, "EPSG:32613");
  const mercatorY = (degrees: number) => (1 - Math.asinh(Math.tan(degrees * Math.PI / 180)) / Math.PI) / 2;
  const worldSize = 512 * 2 ** zoom;
  const requested = {
    x: frame.x + frame.width / 2 + (target.longitude - longitude) / 360 * worldSize,
    y: frame.y + frame.height / 2 + (mercatorY(target.latitude) - mercatorY(latitude)) * worldSize,
  };
  const hit = await unobstructedMapPoint(map, requested, "canvas");
  await page.mouse.click(hit.x, hit.y);
}

async function clickWorkbenchMapFraction(page: Page, position: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  expect(box, "map workbench bounding box").not.toBeNull();
  if (!box) throw new Error("Missing map workbench bounding box");
  const hit = await unobstructedMapPoint(map, {
    x: box.x + Math.min(0.9, Math.max(0.1, position.x)) * box.width,
    y: box.y + Math.min(0.7, Math.max(0.15, position.y)) * box.height,
  }, "canvas");
  await page.mouse.click(hit.x, hit.y);
  return hit;
}

async function expectNoOverlap(page: Page, firstTestId: string, secondTestId: string): Promise<void> {
  const first = await page.getByTestId(firstTestId).boundingBox();
  const second = await page.getByTestId(secondTestId).boundingBox();
  expect(first, `${firstTestId} bounding box`).not.toBeNull();
  expect(second, `${secondTestId} bounding box`).not.toBeNull();
  const overlaps = Boolean(first && second
    && first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y);
  expect(overlaps, `${firstTestId} should not overlap ${secondTestId}`).toBe(false);
}

async function expectNoOverlapIfVisible(page: Page, firstTestId: string, secondTestId: string): Promise<void> {
  const first = page.getByTestId(firstTestId).first();
  const second = page.getByTestId(secondTestId).first();
  if (await first.count() === 0 || await second.count() === 0) return;
  if (!await first.isVisible() || !await second.isVisible()) return;
  await expectNoOverlap(page, firstTestId, secondTestId);
}

async function expectInsideContainer(page: Page, childTestId: string, containerTestId: string): Promise<void> {
  const child = await page.getByTestId(childTestId).boundingBox();
  const container = await page.getByTestId(containerTestId).boundingBox();
  expect(child, `${childTestId} bounding box`).not.toBeNull();
  expect(container, `${containerTestId} bounding box`).not.toBeNull();
  if (!child || !container) return;
  expect(child.x, `${childTestId} left edge`).toBeGreaterThanOrEqual(container.x - 2);
  expect(child.y, `${childTestId} top edge`).toBeGreaterThanOrEqual(container.y - 2);
  expect(child.x + child.width, `${childTestId} right edge`).toBeLessThanOrEqual(container.x + container.width + 2);
  expect(child.y + child.height, `${childTestId} bottom edge`).toBeLessThanOrEqual(container.y + container.height + 2);
}

async function expectInsideContainerIfVisible(page: Page, childTestId: string, containerTestId: string): Promise<void> {
  const child = page.getByTestId(childTestId).first();
  const container = page.getByTestId(containerTestId).first();
  if (await child.count() === 0 || await container.count() === 0) return;
  if (!await child.isVisible() || !await container.isVisible()) return;
  await expectInsideContainer(page, childTestId, containerTestId);
}

async function expectBottomGap(page: Page, childTestId: string, containerTestId: string, minGap: number, maxGap: number): Promise<void> {
  const child = await page.getByTestId(childTestId).boundingBox();
  const container = await page.getByTestId(containerTestId).boundingBox();
  expect(child, `${childTestId} bounding box`).not.toBeNull();
  expect(container, `${containerTestId} bounding box`).not.toBeNull();
  if (!child || !container) return;
  const gap = (container.y + container.height) - (child.y + child.height);
  expect(gap, `${childTestId} bottom gap`).toBeGreaterThanOrEqual(minGap);
  expect(gap, `${childTestId} bottom gap`).toBeLessThanOrEqual(maxGap);
}

async function expectInsideViewport(page: Page, testId: string): Promise<void> {
  const viewport = page.viewportSize();
  const box = await page.getByTestId(testId).boundingBox();
  expect(viewport, "viewport").not.toBeNull();
  expect(box, `${testId} bounding box`).not.toBeNull();
  if (!viewport || !box) return;
  expect(box.x, `${testId} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${testId} top edge`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${testId} right edge`).toBeLessThanOrEqual(viewport.width + 2);
  expect(box.y + box.height, `${testId} bottom edge`).toBeLessThanOrEqual(viewport.height + 2);
}

function isAllowedNetworkRequest(url: string, strictOffline = false): boolean {
  if (hasCredentialQueryParameter(url)) return false;
  if (url.startsWith("http://127.0.0.1:")) return true;
  if (strictOffline) return url.startsWith("data:") || url.startsWith("blob:");
  if (url.startsWith("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/")) return true;
  if (url.startsWith("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/")) return true;
  return url.startsWith("data:") || url.startsWith("blob:");
}

function isAllowedExternalProofRequest(url: string): boolean {
  if (hasCredentialQueryParameter(url)) return false;
  if (url.startsWith("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/")) return true;
  if (url.startsWith("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/")) return true;
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  return false;
}

function hasCredentialQueryParameter(url: string): boolean {
  const credentialKey = /^(api[_-]?key|key|token|access[_-]?token|signature|sig)$/i;
  try {
    const parsed = new URL(url);
    return Array.from(parsed.searchParams.keys()).some((key) => credentialKey.test(key));
  } catch {
    return /[?&](api[_-]?key|key|token|access[_-]?token|signature|sig)=/i.test(url);
  }
}
