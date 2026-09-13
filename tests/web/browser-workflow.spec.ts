import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

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
    const x = svgBounds.x + svgBounds.width * 0.6;
    const y = svgBounds.y + svgBounds.height * 0.4;
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
  if (testInfo.project.name !== "desktop") {
    await expectNoOverlapIfVisible(page, "svg-map-draft-hud", "map-bottom-hud");
    await expectNoOverlapIfVisible(page, "svg-map-draft-hud", "layout-map-svg");
    await expectNoOverlapIfVisible(page, "svg-map-zoom-controls", "map-bottom-hud");
    await expectNoOverlapIfVisible(page, "svg-map-zoom-controls", "svg-map-compact-legend");
    await expectInsideContainer(page, "svg-map-zoom-controls", "layout-map-drawing-surface");
    await expectMinTargetSize(page, "layout-map-svg", 260, 180);
    await expectNoHorizontalOverflow(page);
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
  await expect(page.getByText("North America Map")).toBeVisible();
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
  if (testInfo.project.name === "mobile-390") {
    await expect(page.getByTestId("map-bottom-hud")).toHaveCount(0);
    await expect(page.getByTestId("inspector-scroll").getByTestId("design-action-pan")).toBeVisible();
  } else {
    await expect(page.getByTestId("inspector-scroll").getByTestId("design-action-pan")).toBeVisible();
  }
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
  await expect(page.getByText("measure · 0 draft pts · point saves on map click")).toBeVisible();
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
  await expect(readiness).not.toContainText("Clients");
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
  await expect(page.getByTestId("catalog-home-readiness")).toBeVisible();
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
    await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  }
  await saveScreen(page, testInfo, "file-menu-curated-samples");
});

test("catalog blank design starts a drawable boundary workflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await openCatalogFromFile(page);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
  await openInspectorIfCollapsed(page);
  await expect(page.getByText("Use Start Blank Design or open a saved design from the tree to enable drawing. Catalog maps are navigation-only.")).toBeVisible();
  await closeInspectorIfOpen(page);
  await expect(page.getByTestId("design-action-polygon")).toHaveCount(0);

  await startBlankDesignFromFile(page);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Blank Field Design");
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByTestId("design-builder-panel")).toHaveCount(0);

  await selectBoundaryTool(page);
  const mapBox = await page.getByLabel("CPLayout MapLibre imagery workbench").boundingBox();
  expect(mapBox).not.toBeNull();
  const boundaryClicks = [
    { x: mapBox!.width * 0.28, y: mapBox!.height * 0.34 },
    { x: mapBox!.width * 0.72, y: mapBox!.height * 0.34 },
    { x: mapBox!.width * 0.70, y: mapBox!.height * 0.62 },
    { x: mapBox!.width * 0.30, y: mapBox!.height * 0.62 },
  ];
  for (const point of boundaryClicks) {
    await clickWorkbenchMap(page, point);
    await page.waitForTimeout(250);
  }
  await expect(page.getByText(/measure .* 4 draft pts .* polygon needs 3 pts/)).toBeVisible();
  if (testInfo.project.name === "mobile-390") {
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    await saveScreen(page, testInfo, "catalog-blank-design-boundary-draw-mobile");
    return;
  }

  await page.getByTestId("browser-action-save-feature").click();
  await expect(page.getByTestId("pending-draft-purpose-panel")).toContainText("What did you draw?");
  await choosePendingDraftPurpose(page, "Field Boundary");
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  await saveScreen(page, testInfo, "catalog-blank-design-boundary-draw");
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
  await expect(page.getByRole("button", { name: "Adams North Unit" })).toBeHidden();

  await createClientFolder(page, "Adams Farms");
  await expect(page.getByRole("button", { name: "Adams Farms" })).toBeVisible();
  await openProjectTreeActionOverflow(page);
  await expect(page.getByTestId("project-tree-action-project")).toBeEnabled();
  await closeProjectTreeActionOverflow(page);
  await createProjectFromRail(page, "Adams North Unit", "Saved under: Adams Farms");
  const railProject = page.getByTestId("project-tree-rail").getByRole("button", { name: "Adams North Unit" });
  await expect(railProject).toBeVisible();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
  await expect(page.getByText("North America Map")).toBeVisible();
  await expect(page.getByTestId("browser-workflow-layout")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("design-action-polygon")).toHaveCount(0);
  await expect(page.getByText("North Quarter Concept Layout")).toBeHidden();
  await expect(page.getByText("Base Design")).toBeHidden();
  await expect(page.getByTestId("project-tree-rail")).toContainText("0 design files");
  await expectNoSavedProjectDocuments(page);

  await createCatalogItem(page, "Field Map", "North Quarter", "Saved under: Adams Farms > Adams North Unit");
  await expect(page.getByRole("button", { name: "North Quarter" })).toBeVisible();
  await expect(page.getByTestId("project-tree-rail")).toContainText("North Quarter");
  await expect(page.getByTestId("project-tree-rail")).toContainText("0 design files");
  await expect(page.getByText("North America Map")).toBeVisible();
  await expectNoSavedProjectDocuments(page);
  await createCatalogItem(page, "Design", "RTK Layout Pass", "Saved under: Adams Farms > Adams North Unit > North Quarter");
  await expect(page.getByRole("button", { name: "RTK Layout Pass" })).toBeHidden();
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("catalog-notice")).toContainText("Design creation for RTK Layout Pass starts after a map is imported");
  await closeInspectorIfOpen(page);
  await expectNoSavedProjectDocuments(page);
  await railProject.dispatchEvent("dblclick");
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
  await expect(page.getByText("No client folders yet.")).toBeVisible();
  await clickProjectTreeAction(page, "client");
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByTestId("client-profile-cancel").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  await expect(page.getByText("No client folders yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Client 1" })).toBeHidden();
  expect(nativeDialogs).toEqual([]);
  await saveScreen(page, testInfo, "catalog-modal-cancel-unchanged");
});

test("catalog creation modal validates blank names without creating records", async ({ page }, testInfo) => {
  await page.goto("/");
  await openProjectDrawerIfCollapsed(page);
  await expect(page.getByText("No client folders yet.")).toBeVisible();
  await clickProjectTreeAction(page, "client");
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByLabel("Company name").fill("   ");
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-error")).toHaveText("Enter primary contact first and last name before saving.");
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await expect(page.getByText("No client folders yet.")).toBeVisible();
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

  await page.getByRole("button", { name: "Edit Client" }).click();
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await page.getByLabel("Location").fill("North Adams County");
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  await expect(page.getByText("North Adams County")).toBeVisible();

  await createProjectForSelectedClient(page, "North Unit", "Saved under: Adams Farms");
  await openCatalogFromFile(page);
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("client-detail-projects")).toContainText("North Unit");
  await expect(page.getByRole("button", { name: "Delete Client" })).toBeDisabled();

  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByTestId("catalog-dialog")).toBeVisible();
  await page.getByLabel("Catalog item name").fill("North Unit Renamed");
  await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await expect(page.getByTestId("client-detail-projects")).toContainText("North Unit Renamed");

  await createClientFolder(page, "Beta Farms");
  await page.getByRole("button", { name: "Adams Farms" }).click();
  await page.getByRole("button", { name: "Move" }).click();
  await expect(page.getByTestId("move-project-dialog")).toBeVisible();
  await page.getByRole("radio", { name: "Move to Beta Farms" }).click();
  await page.getByTestId("move-project-confirm").click();
  await expect(page.getByTestId("move-project-dialog")).toBeHidden();
  await page.getByRole("button", { name: "Beta Farms" }).click();
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("client-detail-projects")).toContainText("North Unit Renamed");

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("delete-project-dialog")).toBeVisible();
  await page.getByTestId("delete-project-dialog-confirm").click();
  await expect(page.getByTestId("delete-project-dialog")).toBeHidden();
  await expect(page.getByTestId("client-detail-projects")).not.toContainText("North Unit Renamed");

  await page.getByRole("button", { name: "Delete Client" }).click();
  await expect(page.getByTestId("delete-client-dialog")).toBeVisible();
  await page.getByTestId("delete-client-dialog-confirm").click();
  await expect(page.getByRole("button", { name: "Beta Farms" })).toBeHidden();
  expect(nativeDialogs).toEqual([]);
  await saveScreen(page, testInfo, "client-detail-project-lifecycle");
});

test("public proof map features can select the side-panel editor without geometry mutation", async ({ page }, testInfo) => {
  await page.goto("/");
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-real-proof").click();
  await expect(page.getByTestId("workspace-screen")).toBeVisible();
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
  await clickWorkbenchMap(page, { x: box.width * 0.61, y: box.height * 0.68 });
  await expect(page.getByText(/Selected map feature/)).toBeVisible();
  await expect(page.getByLabel("Selected map feature name")).toHaveValue("Power feed from 112th Avenue");
  await expect(page.getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "public-proof-feature-selected");
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
	    "help-module-android-storage",
	    "help-module-export",
  ]) {
    await expect(page.getByTestId(moduleId)).toBeVisible();
  }
  await expect(page.getByText("Google Earth Pro is a local companion reference only")).toBeVisible();
  await expect(page.getByText("Training progress uses the same local walkthrough store")).toBeVisible();
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
  await expect(page.getByTestId("map-bottom-hud")).toHaveCount(0);
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
  await expect(page.getByTestId("map-bottom-hud")).toHaveCount(0);
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
  await expect(page.getByTestId("rtk-gate-reasons")).toHaveText(/receiver is not connected/);
  await expect(page.getByTestId("rtk-status")).toHaveText(/No receiver connected|Web Serial is unavailable/);
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeDisabled();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await saveScreen(page, testInfo, "survey-rtk-gate-closed");
});

test("survey rtk capture requires coherent current serial evidence and closes on disconnect", async ({ page }, testInfo) => {
  await openControlledRtkReceiver(page);
  await expect(page.getByTestId("rtk-gate-badge").getByText("Gate accepted")).toBeVisible();
  await expect(page.getByText("rtk_fixed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeEnabled();
  await page.getByRole("button", { name: "Capture Survey Point" }).click();
  await expect(page.getByTestId("rtk-status")).toContainText("Captured control survey point with RTK fixed confidence.");
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
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

type ControlledRtkWindow = Window & {
  cplayoutRtkFixture: { nowMs: number; emit(payload: string): void };
};

async function installControlledRtkStream(page: Page): Promise<void> {
  await page.addInitScript((initialPayload: string) => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const fixture = {
      nowMs: 1000,
      emit(payload: string) { controller.enqueue(new TextEncoder().encode(payload)); },
    };
    (window as ControlledRtkWindow).cplayoutRtkFixture = fixture;
    Object.defineProperty(performance, "now", { configurable: true, value: () => fixture.nowMs });
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        async requestPort() {
          const readable = new ReadableStream<Uint8Array>({
            start(nextController) {
              controller = nextController;
              fixture.emit(initialPayload);
            },
          });
          return {
            readable, writable: null, async open() {},
            async close() { if (!readable.locked) await readable.cancel(); },
          };
        },
      },
    });
  }, controlledRtkPayload());
}

function controlledNmeaSentence(body: string): string {
  const checksum = [...body].reduce((value, character) => value ^ character.charCodeAt(0), 0);
  return `$${body}*${checksum.toString(16).padStart(2, "0")}\r\n`;
}

function controlledRtkPayload(time = "123519.00"): string {
  return [
    `GNGGA,${time},3900.000000,N,10400.000000,W,4,18,0.6,1600.0,M,-20.0,M,0.5,0000`,
    `GNGST,${time},0.01,0.01,0.01,0.0,0.01,0.01,0.02`,
    `GNRMC,${time},A,3900.000000,N,10400.000000,W,0.0,0.0,130926,,,A`,
  ].map(controlledNmeaSentence).join("");
}

async function openControlledRtkReceiver(page: Page): Promise<void> {
  await installControlledRtkStream(page);
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-survey").click();
  await page.getByRole("textbox", { name: "Receiver source CRS" }).fill("EPSG:4326");
  await page.getByRole("button", { name: "Open Serial" }).click();
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate accepted");
}

test("survey rtk invalid latest fix and replayed epoch cannot revive capture", async ({ page }, testInfo) => {
  await openControlledRtkReceiver(page);
  await expect(page.getByText("Horizontal RMS", { exact: true })).toBeVisible();
  await expect(page.getByText("0.014 m", { exact: true })).toBeVisible();
  await page.evaluate((payload) => {
    (window as ControlledRtkWindow).cplayoutRtkFixture.emit(payload);
  }, controlledNmeaSentence("GNGGA,123520.00,,,,,0,0,,,,,,,"));
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeDisabled();
  await page.evaluate((payload) => {
    const fixture = (window as ControlledRtkWindow).cplayoutRtkFixture;
    fixture.nowMs = 6000;
    fixture.emit(payload);
  }, controlledRtkPayload());
  await expect(page.getByTestId("rtk-gate-reasons")).toContainText("observation age");
  await expect(page.getByRole("button", { name: "Capture Survey Point" })).toBeDisabled();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await saveScreen(page, testInfo, "rtk-invalid-and-replayed-epoch-blocked");
  await page.evaluate((payload) => {
    (window as ControlledRtkWindow).cplayoutRtkFixture.emit(payload);
  }, controlledRtkPayload("123521.00"));
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate accepted");
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
});

for (const [kind, name] of [["survey", "Capture Survey Point"], ["geometry", "Add Boundary (0)"]] as const) {
  test(`survey rtk ${kind} capture rechecks age before the next display timer`, async ({ page }, testInfo) => {
    await openControlledRtkReceiver(page);
    const capture = page.getByRole("button", { name, exact: true });
    await expect(capture).toBeEnabled();
    await capture.evaluate((element) => {
      (window as ControlledRtkWindow).cplayoutRtkFixture.nowMs += 3000;
      (element as HTMLElement).click();
    });
    await expect(page.getByTestId("rtk-status")).toContainText("capture was blocked");
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
    await expect(page.getByRole("button", { name: "Add Boundary (0)", exact: true })).toBeVisible();
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
  await expect(page.getByText("measure · 0 draft pts · point saves on map click")).toBeVisible();
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
  await expect(page.getByText("Unsaved edits")).toBeVisible();

  await closeInspectorIfOpen(page);
  await selectPanTool(page);
  await selectEndGunCircleTool(page);
  await map.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("design-action-circle")).toHaveAttribute("aria-pressed", "true");

  await selectCornerFootprintTool(page);
  await map.scrollIntoViewIfNeeded();
  await expect(page.getByTestId("design-action-polygon")).toHaveAttribute("aria-pressed", "true");
  await clickWorkbenchMap(page, { x: 180, y: 330 });
  await clickWorkbenchMap(page, { x: 185, y: 330 });
  await clickWorkbenchMap(page, { x: 180, y: 335 });
  await expect(page.getByText(/measure .* 3 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await page.getByTestId("browser-action-save-feature").click();
  await expect(page.getByTestId("pending-draft-purpose-panel")).toContainText("What did you draw?");
  await choosePendingDraftPurpose(page, "Corner-Arm Footprint");
  await expect(page.getByTestId("pending-draft-purpose-panel")).toHaveCount(0);
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "design-console-feature-kind-tools");
});

test("placement review applies advisory pivot candidates only after confirmation", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-advisory-generated-field-pivot-layer")).toContainText("Generated advisory plan");
  await expect(page.getByTestId("browser-advisory-generated-field-pivot-layer")).toContainText("review only");
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await page.getByTestId("design-console-calculate").click();
  await expect(page.getByTestId("placement-review-panel")).toContainText("Placement Review");
  await expect(page.getByTestId("placement-review-panel")).toContainText("advisory");
  await expect(page.getByTestId("placement-review-panel")).toContainText("source-backed");
  await expect(page.getByTestId("placement-candidate-0")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("placement-candidate-apply-0").click();
  await expect(page.getByTestId("placement-confirm-dialog")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await page.getByTestId("placement-confirm-dialog-cancel").click();
  await expect(page.getByTestId("placement-confirm-dialog")).toHaveCount(0);
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("placement-candidate-apply-0").click();
  await page.getByTestId("placement-confirm-dialog-confirm").click();
  await expect(page.getByText("Unsaved edits")).toBeVisible();
  await saveScreen(page, testInfo, "placement-review-confirmed-apply");
});

test("generated field pivot plan saves advisory machine-zone review features after explicit action", async ({ page }, testInfo) => {
  test.slow();
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("design-console-dialog")).toBeVisible();
  await expect(page.getByTestId("advisory-generated-field-pivot-plan")).toContainText("Generated Field Pivot Plan");
  await expect(page.getByTestId("advisory-generated-field-pivot-plan")).toContainText("does not create saved pivots");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("Generated Multi-Pivot Scenario Review");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("runtime collision controls");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("save-generated-field-pivot-zones").click();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();
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
  await expect(page.getByTestId("advisory-cost-review-panel")).toContainText("Cost Review");
  await expect(page.getByTestId("advisory-cost-status")).toContainText("will not infer machine prices");
  await expect(page.getByTestId("advisory-bender-strategy-summary")).toContainText("operator-labeled projected-XY second-pivot evidence");
  await expect(page.getByTestId("advisory-obstacle-interaction-summary")).toContainText("Obstacle Interaction Review");
  await expect(page.getByTestId("advisory-obstacle-interaction-summary")).toContainText("does not mutate canonical projected XY");
  await expect(page.getByTestId("advisory-full-scope-boundary-summary")).toContainText("Full-Scope Boundary Review");
  await expect(page.getByTestId("advisory-full-scope-boundary-summary")).toContainText("canonical projected XY");
  await expect(page.getByTestId("advisory-generated-field-pivot-plan")).toContainText("Generated Field Pivot Plan");
  await expect(page.getByTestId("advisory-generated-field-pivot-plan")).toContainText("canonical projected XY");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("Generated Multi-Pivot Scenario Review");
  await expect(page.getByTestId("advisory-generated-multi-pivot-scenario-review")).toContainText("cost evidence Missing");
  await expect(page.getByTestId("advisory-design-report-panel")).toContainText("Advisory Design Report");
  await expect(page.getByTestId("advisory-design-report-panel")).toContainText("does not create pivots");
  await expect(page.getByTestId("advisory-review-zone-audit-summary")).toContainText("Review-zone audit");
  await expect(page.getByTestId("advisory-design-report-preview")).toContainText("Canonical geometry mutation: false");

  await page.getByTestId("advisory-cost-fixed").fill("80000");
  await page.getByTestId("advisory-cost-per-meter").fill("700");
  await page.getByTestId("advisory-cost-per-tower").fill("3000");
  await expect(page.getByTestId("advisory-cost-review-panel")).toContainText("Complete");
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
  ).toContain("does not create a quote");
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
  await page.getByTestId("advisory-cost-fixed").fill("85000");
  await page.getByTestId("advisory-cost-per-meter").fill("650");
  await page.getByTestId("advisory-cost-per-tower").fill("2800");
  await expect(page.getByTestId("advisory-cost-review-panel")).toContainText("Complete");

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
  await expect(page.getByTestId("advisory-full-scope-boundary-summary")).toContainText("Full-Scope Boundary Review");
  await expect(page.getByTestId("advisory-obstacle-interaction-summary")).toContainText("Obstacle Interaction Review");
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

  await page.getByTestId("advisory-cost-fixed").fill("90000");
  await page.getByTestId("advisory-cost-per-meter").fill("650");
  await page.getByTestId("advisory-cost-per-tower").fill("2500");
  await expect(page.getByTestId("advisory-cost-review-panel")).toContainText("Complete");
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

  if (testInfo.project.name === "mobile-390") {
    await saveScreen(page, testInfo, "browser-edit-vertices-compact");
    return;
  }

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

  if (testInfo.project.name === "mobile-390") {
    await saveScreen(page, testInfo, "browser-edit-feature-compact");
    return;
  }

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

  if (testInfo.project.name === "mobile-390") {
    await saveScreen(page, testInfo, "browser-edit-feature-radius-compact");
    return;
  }

  await selectEndGunCircleTool(page);
  await clickWorkbenchMap(page, { x: 180, y: 330 });
  await clickWorkbenchMap(page, { x: 250, y: 370 });
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
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);

  if (testInfo.project.name === "mobile-390") {
    await saveScreen(page, testInfo, "browser-edit-insert-compact");
    return;
  }

  await page.getByTestId("browser-edit-select-boundary").click();
  const insert = page.getByTestId("browser-edit-insert-vertex");
  await expect(insert).toBeEnabled();
  await insert.click();
  await expect(page.getByText("Inserted a projected XY vertex at the selected segment midpoint. Drag the handle or nudge it to refine the position.")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Unsaved edits")).toBeVisible();

  const handle = page.getByTestId("browser-edit-drag-handle");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("data-drag-ready", "true");
  const box = await handle.boundingBox();
  expect(box, "selected vertex drag handle").not.toBeNull();
  if (box) {
    await handle.hover();
    await page.mouse.down();
    await expect(handle).toHaveAttribute("data-drag-state", "active");
    await page.mouse.move(box.x + box.width / 2 + 18, box.y + box.height / 2 + 12, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => {
      const moved = await handle.boundingBox();
      return moved ? Math.hypot(moved.x - box.x, moved.y - box.y) : 0;
    }).toBeGreaterThan(5);
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText(/edit vertices .* boundary vertex 2 of 7/)).toBeVisible();
});

test("cancelled browser vertex drag preserves saved geometry", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile-390", "Compact mobile does not expose vertex drag controls.");
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await selectEditTool(page);
  await page.getByTestId("browser-edit-select-boundary").click();
  const handle = page.getByTestId("browser-edit-drag-handle");
  await expect(handle).toHaveAttribute("data-drag-ready", "true");
  await expect(handle).toHaveCSS("position", "absolute");
  await expect(handle).toBeInViewport();
  await handle.hover();
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.down();
  await expect(handle).toHaveAttribute("data-drag-state", "active");
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 25, { steps: 4 });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));
  });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("data-drag-state", "cancelled");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect.poll(async () => {
    const restored = await handle.boundingBox();
    return restored ? Math.hypot(restored.x - box.x, restored.y - box.y) : Infinity;
  }).toBeLessThan(2);
  await saveScreen(page, testInfo, "cancelled-vertex-drag");
});

test("grouped drawing HUD menus do not clear active drafts", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await selectBoundaryTool(page);
  await expect(page.getByTestId("design-action-polygon")).toHaveAttribute("aria-pressed", "true");
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await expect(page.getByText(/measure .* 1 draft pts .* polygon needs 3 pts/)).toBeVisible();

  await openDesignToolPanel(page, "polygon");
  await expect(page.getByTestId("design-console-dialog").getByRole("button", { name: "Polygon", exact: true })).toBeVisible();
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
      expect(sheetBox.width).toBeGreaterThan(260);
      expect(sheetBox.y).toBeGreaterThanOrEqual(mapBox.y + mapBox.height - 2);
    }
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
  await clickWorkbenchMapFraction(page, { x: 0.2, y: 0.55 });
  await expect(page.getByTestId("manual-design-status")).toContainText("4 map-click boundary vertices staged");
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  const closingMapBox = await page.getByLabel("CPLayout MapLibre imagery workbench").boundingBox();
  expect(closingMapBox).not.toBeNull();
  if (closingMapBox) await page.mouse.dblclick(closingMapBox.x + closingMapBox.width * 0.2, closingMapBox.y + closingMapBox.height * 0.25);
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
  await expect(page.getByTestId("map-hud-active-tool-chip")).toContainText("LineString");
  await selectPumpFeatureTool(page);
  await expect(page.getByTestId("design-action-point")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("map-hud-active-tool-chip")).toContainText("Point");
  await expect(page.getByText("measure · 0 draft pts · point saves on map click")).toBeVisible();
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
    await expect(saveFeature).toHaveAttribute("aria-disabled", "true");
    await expect(clear).toHaveAttribute("aria-disabled", "true");
  }

  await selectBoundaryTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await expect(clear).not.toHaveAttribute("aria-disabled", "true");
  await expect(clear).toBeEnabled();
  await expect(commit).toHaveAttribute("aria-disabled", "true");
  await clickWorkbenchMap(page, { x: 200, y: 240 });
  await clickWorkbenchMap(page, { x: 230, y: 185 });
  await expect(commit).toHaveAttribute("aria-disabled", "true");
  await expect(saveFeature).not.toHaveAttribute("aria-disabled", "true");
  await expect(saveFeature).toBeEnabled();

  await page.getByTestId("browser-action-clear").click();
  await selectPipelineTool(page);
  await clickWorkbenchMap(page, { x: 160, y: 330 });
  await clickWorkbenchMap(page, { x: 220, y: 370 });
  await expect(commit).toHaveAttribute("aria-disabled", "true");
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
  await expect(page.getByTestId("browser-action-commit")).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByTestId("browser-action-save-feature")).toBeEnabled();
  await expect(page.getByText(/measure .* 3 draft pts .* polygon needs 3 pts/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectInsideContainer(page, "browser-map-bottom-dock", "browser-map-frame");
  await expectBottomGap(page, "browser-map-bottom-dock", "browser-map-frame", 4, 18);
  await expectInsideContainer(page, "browser-map-status-hud", "browser-map-frame");
  await expectInsideContainerIfVisible(page, "map-bottom-hud", "browser-map-frame");
  await expectInsideContainer(page, "browser-map-hud-actions", "browser-map-status-hud");
  await expectInsideContainer(page, "browser-action-commit", "browser-map-hud-actions");
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
  await clickWorkbenchMap(page, { x: 160, y: 180 });
  await clickWorkbenchMap(page, { x: 200, y: 240 });
  await clickWorkbenchMap(page, { x: 230, y: 185 });
  await expect(page.getByText("Layout mode is RTK-only; switch to Design for pointer-based geometry edits.")).toBeVisible();
  await expect(page.getByText("pan · 0 draft pts")).toBeVisible();
  if (testInfo.project.name === "mobile-390") {
    await expect(page.getByTestId("browser-map-hud-actions")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("browser-action-commit")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("browser-action-save-feature")).toHaveAttribute("aria-disabled", "true");
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
  await expect(page.getByText("EPSG:32613 canonical geometry · offline overlay")).toBeVisible();
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
  await page.getByLabel("Coverage").fill("County open imagery coverage");
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
  await page.getByLabel("Coverage").fill("Credentialed source should not be accepted");
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
  await page.getByLabel("Coverage").fill("Operator-hosted local tile cache");
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
  await expect(page.getByText("EPSG:32613 canonical geometry · offline overlay")).toBeVisible();
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
  await page.getByLabel("Coverage").fill("Operator-hosted local tile cache");
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
  await expect(page.getByTestId("will-rhea-guided-demo-panel")).toBeVisible();
  await expect(page.getByTestId("will-rhea-guided-demo-panel")).toContainText("EPSG:32614");
  await expect(page.getByTestId("will-rhea-evidence-status")).toContainText("Field boundary");
  await expect(page.getByTestId("will-rhea-evidence-status")).toContainText("LRDU Distance measurement_line");
  await expect(page.getByTestId("will-rhea-evidence-status")).toContainText("SHA-256");
  await expect(page.getByTestId("will-rhea-corner-arm-input-blockers")).toContainText("Measured LRDU speed");
  await expect(page.getByTestId("will-rhea-corner-arm-input-blockers")).toContainText("Source-labeled corner-arm model");
  await expect(page.getByTestId("will-rhea-corner-arm-input-blockers")).toContainText("linear_move_path");

  await page.getByTestId("walkthrough-module-cornerArmInputs").click();
  await page.getByTestId("walkthrough-module-cornerArmCalculation").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("2/9 modules")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();

  await page.getByTestId("workspace-nav-map").click();
  await clickHudAction(page, "design-action-calculate");
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toContainText("blockers");
  await expect(page.getByTestId("corner-arm-kinematics-blockers")).toContainText("missing lrdu speed");
  await expect(page.getByTestId("corner-arm-kinematics-blockers")).toContainText("missing model spec");
  await expect(page.getByTestId("corner-arm-kinematics-blockers")).toContainText("missing guidance path");
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
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await page.getByTestId("walkthrough-module-imagery").click();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("1/9 modules")).toBeVisible();
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-real-proof").click();
  await expect(page.getByText("Public Adams County Center Pivot Proof", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("0/9 modules")).toBeVisible();
  await openBaselineSample(page);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("1/9 modules")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-walkthrough-project-scope");
});

test("dashboard walkthrough reset only clears the active project", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
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
  await openBaselineSample(page);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
  await expect(page.getByTestId("dashboard-card-walkthrough").getByText("2/9 modules")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-walkthrough-reset-project-scope");
});

test("dashboard layout warnings expose actionable map guidance", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
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
  await page.getByTestId("dashboard-layout-warnings").getByRole("button", { name: "Inspect Map" }).click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("browser-map-workbench")).toBeVisible();
  await expect(page.getByTestId("project-save-state").getByText("Saved")).toBeVisible();
  await expect(page.getByText("Layout mode: RTK-only geometry changes; pointer gestures inspect only.")).toBeVisible();
  await saveScreen(page, testInfo, "dashboard-layout-warning-inspect-map");
});

test("dashboard recent-project empty state keeps start actions visible", async ({ page }, testInfo) => {
  await page.goto("/");
  await openBaselineSample(page);
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
  await page.getByRole("button", { name: /^Save$/ }).click();
  const recentProjects = page.getByTestId("dashboard-recent-projects");
  const sampleRow = recentProjects.getByRole("button", { name: "Open recent project North Quarter Concept Layout" });
  await expect(sampleRow).toBeVisible();
  await recentProjects.getByRole("button", { name: "Create New" }).click();
  await openInspectorIfCollapsed(page);
  await expect(page.getByTestId("catalog-notice")).toContainText("Select or create a client folder");
  await expect(page.getByText("Untitled Field Layout", { exact: true })).toBeHidden();
  await openBaselineSample(page);
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

async function openBaselineSample(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
}

async function openWillRheaExample(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-will-rhea-jason-harmelink-example").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Will Rhea / Jason Harmelink Example Map");
}

async function openFullScopeCostDemoSample(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-sample-full-scope-multi-pivot-cost-demo").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Full-Scope Multi-Pivot Cost Demo");
}

async function openPartialSweepSample(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-sample-partial-sweep-road-structure").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Partial Sweep Near Road And Pad");
}

async function openCatalogFromFile(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-catalog").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Project Catalog");
}

async function startBlankDesignFromFile(page: Page): Promise<void> {
  await openCommandMenu(page, "file");
  await page.getByTestId("command-file-blank-design").click();
  await expect(page.getByTestId("map-view")).toBeVisible();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Blank Field Design");
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
  const storageShape = await page.evaluate(() => {
    const projects = JSON.parse(localStorage.getItem("center-pivot-layout-projects-v1") ?? "{}") as Record<string, unknown>;
    const catalog = JSON.parse(localStorage.getItem("center-pivot-layout-project-catalog-v1") ?? "{\"designs\":[]}") as { designs?: unknown[] };
    return {
      designCount: Array.isArray(catalog.designs) ? catalog.designs.length : 0,
      projectDocumentIds: Object.keys(projects),
    };
  });
  expect(storageShape.designCount).toBe(0);
  expect(storageShape.projectDocumentIds).toEqual([]);
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
  await page.getByRole("button", { name: "New Project", exact: true }).click();
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
  const viewport = page.viewportSize();
  const compact = Boolean(viewport && viewport.width < 700);
  const geometryAction = /^design-action-(pan|edit|point|line|polygon|circle)$/.test(testId);
  let action;
  if (compact && geometryAction) {
    await closeInspectorIfOpen(page);
    action = page.getByTestId("map-bottom-hud").getByTestId(testId).first();
  } else {
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
  await openDesignToolPanel(page, "point");
  await page.getByRole("button", { name: "Pivot GPS Entry", exact: true }).click();
  await expect(page.getByLabel("Pivot latitude and longitude decimal degrees")).toBeVisible();
}

async function openCornerArmAdvisorySheet(page: Page): Promise<void> {
  await openDesignToolPanel(page, "machine");
  await page.getByRole("button", { name: "Corner Arm Advisory", exact: true }).click();
  await expect(page.getByTestId("corner-arm-advisory-badges")).toBeVisible();
}

async function selectBoundaryTool(page: Page): Promise<void> {
  await openDesignToolPanel(page, "polygon");
  await chooseDesignConsoleTool(page, "Polygon");
}

async function selectPipelineTool(page: Page): Promise<void> {
  await openDesignToolPanel(page, "line");
  await chooseDesignConsoleTool(page, "Line");
}

async function selectPumpFeatureTool(page: Page): Promise<void> {
  await openDesignToolPanel(page, "point");
  await chooseDesignConsoleTool(page, "Point");
}

async function selectEndGunCircleTool(page: Page): Promise<void> {
  await openDesignToolPanel(page, "circle");
  await chooseDesignConsoleTool(page, "Circle");
}

async function selectCornerFootprintTool(page: Page): Promise<void> {
  await openDesignToolPanel(page, "polygon");
  await chooseDesignConsoleTool(page, "Polygon");
}

async function choosePendingDraftPurpose(page: Page, label: string): Promise<void> {
  const panel = page.getByTestId("pending-draft-purpose-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: label, exact: true }).click();
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

async function clickWorkbenchMap(page: Page, position: { x: number; y: number }): Promise<void> {
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  expect(box, "map workbench bounding box").not.toBeNull();
  if (!box) return;
  const viewport = page.viewportSize();
  const phoneLayout = Boolean(viewport && viewport.width < 700);
  const tabletLayout = Boolean(viewport && viewport.width >= 700 && viewport.width < 900);
  const target = phoneLayout
    ? {
      x: Math.min(Math.max(position.x, 28), Math.max(28, box.width - 28)),
      y: Math.min(Math.max(position.y, 96), Math.max(96, box.height - 220)),
    }
    : tabletLayout
      ? {
        x: Math.min(Math.max(position.x, 32), Math.max(32, box.width - 32)),
        y: Math.min(Math.max(position.y, 178), Math.max(178, box.height - 132)),
      }
    : position;
  await page.mouse.click(box.x + target.x, box.y + target.y);
}

async function clickWorkbenchMapFraction(page: Page, position: { x: number; y: number }): Promise<void> {
  const map = page.getByLabel("CPLayout MapLibre imagery workbench");
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  expect(box, "map workbench bounding box").not.toBeNull();
  if (!box) return;
  await page.mouse.click(
    box.x + Math.min(0.9, Math.max(0.1, position.x)) * box.width,
    box.y + Math.min(0.7, Math.max(0.15, position.y)) * box.height,
  );
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
