import { expect, test } from "@playwright/test";

test("retained demo boundary evidence is not claimed as the active field after replacement", async ({ page, baseURL }, testInfo) => {
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-will-rhea-jason-harmelink-example").click();
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-geojson-import-input").fill(JSON.stringify({
    type: "FeatureCollection",
    properties: { projectCrs: "EPSG:32614" },
    features: [{
      type: "Feature",
      properties: { layerType: "field_boundary" },
      geometry: {
        type: "Polygon",
        coordinates: [[[600000, 4450000], [600300, 4450000], [600300, 4450300], [600000, 4450300], [600000, 4450000]]],
      },
    }],
  }));
  await page.getByRole("button", { name: "Import GeoJSON", exact: true }).click();
  await expect(page.getByTestId("files-status")).toContainText("Imported projected GeoJSON boundary");
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
  await page.getByTestId("workspace-nav-dashboard").click();
  const panel = page.getByTestId("will-rhea-guided-demo-panel");
  await expect(panel).toContainText("Boundary evidence");
  await expect(panel).toContainText("Recorded");
  await expect(panel).not.toContainText("Active boundary");
  await expect(page.getByTestId("will-rhea-evidence-status")).toContainText("Current boundary match unverified");
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("retained-boundary-evidence.png") });
});

test("manual pivot input consumes the complete coordinate without changing saved geometry", async ({ page, baseURL }, testInfo) => {
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-action-save-local").click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).not.toBeNull();
  await page.getByTestId("workspace-nav-map").click();
  const openInspector = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ });
  if (await openInspector.first().isVisible()) await openInspector.first().click();
  await page.getByTestId("workflow-sidebar-tab-tools").click();
  const transaction = page.getByTestId("manual-design-transaction");
  await transaction.getByRole("button", { name: "Pivot", exact: true }).click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const original = await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"));
  expect(original).not.toBeNull();
  const coordinate = transaction.getByTestId("pivot-gps-input");
  for (const invalid of ["39,-104 garbage", "-39 N,-104", "39,-104,0"]) {
    await coordinate.fill(invalid);
    await transaction.getByRole("button", { name: "Apply GPS", exact: true }).click();
    await expect(transaction.getByText(/Enter exactly one latitude|Coordinate sign conflicts/)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).toBe(original);
    await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  }
  await coordinate.fill("3.9e1,-1.04e2");
  await transaction.getByRole("button", { name: "Apply GPS", exact: true }).click();
  await expect(page.getByTestId("manual-design-status")).toContainText("Projected pivot staged");
  await expect(coordinate).toHaveValue("39.0000000, -104.0000000");
  expect(await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).toBe(original);
  const heading = page.getByTestId("manual-design-heading");
  await heading.scrollIntoViewIfNeeded();
  const headingBox = await heading.boundingBox();
  const statusBox = await page.getByTestId("manual-design-readiness").boundingBox();
  const panelBox = await transaction.boundingBox();
  expect(headingBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(statusBox!.x);
  expect(statusBox!.x + statusBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width);
  await page.screenshot({ path: testInfo.outputPath("manual-pivot-coordinate-and-heading.png") });
});
