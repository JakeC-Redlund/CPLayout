import { expect, test } from "@playwright/test";
import { readWorkspace, workspaceStorageBytes } from "./workspace-fixtures";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const packageRoot = dirname(createRequire(resolve("packages/map-adapters/package.json")).resolve("maplibre-gl/package.json"));
const { version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string };

for (const asset of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  for (const failure of ["missing", "bad-mime"] as const) {
    test(`SVG recovery preserves the saved project when ${asset} is ${failure}`, async ({ page, baseURL }) => {
      let intercepted = 0;
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.message));
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== new URL(baseURL!).origin) return route.abort("blockedbyclient");
        if (url.pathname === `/maplibre/${version}/${asset}`) {
          intercepted++;
          return route.fulfill({
            status: failure === "missing" ? 404 : 200,
            contentType: "text/html",
            body: failure === "missing" ? "<!doctype html><title>Missing worker asset</title>"
              : readFileSync(join(packageRoot, "dist", asset)),
          });
        }
        return route.continue();
      });
      await page.goto("/");
      await page.getByTestId("command-menu-file").click();
      await page.getByTestId("command-file-sample-baseline-needs-review").click();
      await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("North Quarter Concept Layout");
      await page.getByTestId("workspace-nav-files").click();
      await page.getByTestId("files-action-save-local").click();
      await expect.poll(async () => (await readWorkspace(page)).projectDocuments.length).toBe(1);
      await page.getByTestId("workspace-nav-map").click();
      await expect.poll(() => intercepted).toBeGreaterThan(0);
      await expect(page.getByTestId("project-save-state").getByText("Saved", { exact: true })).toBeVisible();
      const stored = await workspaceStorageBytes(page);
      expect((await readWorkspace(page)).projectDocuments).toHaveLength(1);
      await page.getByTestId("browser-map-use-svg").click();
      await expect(page.getByTestId("browser-map-renderer-fallback")).toBeVisible();
      await expect(page.getByTestId("layout-map-svg")).toBeVisible();
      await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
      expect(await page.getByTestId("layout-map-svg").locator("path").count()).toBeGreaterThan(0);
      expect(await workspaceStorageBytes(page)).toEqual(stored);
      expect(pageErrors).toEqual([]);
    });
  }
}
