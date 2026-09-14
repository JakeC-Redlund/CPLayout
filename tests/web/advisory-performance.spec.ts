import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort("blockedbyclient");
  });
});

test("catalog project switches do not wait for advisory analysis", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-screen")).toBeVisible();
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("");
  const samples = [
    { id: "command-file-sample-baseline-needs-review", name: "North Quarter Concept Layout" },
    { id: "command-file-real-proof", name: "Public Adams County Center Pivot Proof" },
  ];
  const durations: number[] = [];
  for (let repeat = 0; repeat < 3; repeat += 1) {
    for (const sample of samples) {
      await page.getByTestId("command-menu-file").click();
      const elapsed = await page.evaluate(async ({ id, name }) => {
        const button = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (!button) throw new Error("Missing sample command");
        const start = performance.now();
        button.click();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (!document.querySelector('[data-testid="workspace-breadcrumb-current"]')?.textContent?.includes(name)) {
          throw new Error("Requested project was not rendered within the measured frames");
        }
        return performance.now() - start;
      }, sample);
      await expect(page.getByTestId("dashboard-workspace")).toBeVisible();
      await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(sample.name);
      durations.push(elapsed);
    }
  }
  await testInfo.attach("project-switch-timings.json", { body: JSON.stringify({ durations, viewport: page.viewportSize(), method: "DOM command click through two animation frames; development-host browser only" }), contentType: "application/json" });
  expect(Math.max(...durations)).toBeLessThan(1000);
  await page.screenshot({ path: testInfo.outputPath("responsive-dashboard.png") });
});

test("pending advisory jobs do not prevent leaving the map", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("advisory-map-job-status")).toContainText("Calculating");
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("files-view")).toBeVisible();
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
});

test("advisory overlay completion preserves the stored project", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("files-action-save-local").click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).not.toBeNull();
  await page.getByTestId("workspace-nav-map").click();
  await expect(page.getByTestId("advisory-map-job-status")).toContainText("Calculating");
  const before = await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"));
  expect(before).toContain("North Quarter Concept Layout");
  await expect(page.getByTestId("advisory-map-job-status")).toHaveText("", { timeout: 60000 });
  expect(await page.evaluate(() => localStorage.getItem("center-pivot-layout-projects-v1"))).toBe(before);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await expect(page.locator(".maplibregl-canvas").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("advisory-overlays-complete.png") });
});
