import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
  await page.goto("/");
});

async function openSample(page: Page): Promise<void> {
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
}

test("sample save state reflects actual persistence and resets on a new load", async ({ page }) => {
  await openSample(page);
  const state = page.getByTestId("project-save-state");
  await expect(state).toContainText("Unsaved edits");
  expect(await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).toBeNull();
  await page.getByTestId("command-icon-save").click();
  await expect(state).toContainText("Saved");
  const saved = await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"));
  expect(saved).not.toBeNull();
  await openSample(page);
  await expect(state).toContainText("Unsaved edits");
  expect(await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).toBe(saved);
});

test("wizard review and checklist are independent and clipboard rejection is visible", async ({ page }, testInfo) => {
  await openSample(page);
  await page.getByTestId("workspace-nav-files").click();
  const wizard = page.getByTestId("google-earth-import-wizard");
  const checks = wizard.getByRole("checkbox");
  await expect(checks).toHaveCount(7);
  await page.getByTestId("google-earth-wizard-step-ready").click();
  await expect(wizard).toContainText("1/6 complete");
  for (const checkbox of await checks.all()) await expect(checkbox).not.toBeChecked();
  await checks.last().click();
  await expect(checks.last()).toBeChecked();
  for (const checkbox of (await checks.all()).slice(0, -1)) await checkbox.click();
  await expect(wizard.getByRole("checkbox", { checked: true })).toHaveCount(7);
  await checks.first().click();
  await expect(checks.first()).not.toBeChecked();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true, value: { writeText: async () => { throw new Error("Denied in test"); } },
  }));
  await wizard.getByRole("button", { name: "Copy field_boundary", exact: true }).click();
  await expect(wizard.getByRole("alert")).toContainText("Could not copy");
  await expect(wizard.getByText(/^Copied:/)).toHaveCount(0);
  await wizard.getByRole("alert").scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("review-checklist.png") });
});

test("KML selection refreshes replacement warnings and cancel preserves the saved project", async ({ page }, testInfo) => {
  await openSample(page);
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  const saved = await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"));
  await page.getByTestId("workspace-nav-files").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("files-action-import-kml-kmz").click();
  await (await chooser).setFiles({ name: "selection.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from(`
    <kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>field_boundary</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
        -105,40 -104.999,40 -104.999,40.001 -105,40.001 -105,40
      </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>survey_point</name><Point><coordinates>-105,40</coordinates></Point></Placemark>
    </Document></kml>`) });
  await expect(page.getByText(/Existing field boundary will be replaced/)).toBeVisible();
  const boundary = page.getByRole("checkbox").filter({ hasText: /^field_boundary/ });
  await expect(boundary).toBeChecked();
  await boundary.click();
  await expect(boundary).not.toBeChecked();
  await expect(page.getByText(/Existing field boundary will be replaced/)).toHaveCount(0);
  await expect(page.getByTestId("files-status")).toContainText("no boundary");
  await page.getByTestId("files-action-cancel-kml-kmz-import").click();
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  expect(await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).toBe(saved);
  await page.screenshot({ path: testInfo.outputPath("kml-selection-cancel.png") });
});
