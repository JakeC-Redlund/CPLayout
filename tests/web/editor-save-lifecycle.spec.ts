import { expect, test } from "@playwright/test";
import { buildSync } from "esbuild";
import { resolve } from "node:path";

declare global {
  interface Window {
    CplayoutSaveLifecycle: typeof import("./editor-save-lifecycle-fixture");
  }
}

const source = buildSync({
  entryPoints: [resolve(__dirname, "editor-save-lifecycle-fixture.tsx")],
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "CplayoutSaveLifecycle",
  define: { "process.env.NODE_ENV": '"development"' },
}).outputFiles[0].text;

test.beforeEach(async ({ page }) => {
  await page.route("**/save-lifecycle.html", route => route.fulfill({
    contentType: "text/html", body: '<!doctype html><title>Save lifecycle fixture</title><div id="root"></div>',
  }));
  await page.goto("/save-lifecycle.html");
  await page.addScriptTag({ content: source });
  await page.evaluate(() => window.CplayoutSaveLifecycle.mount());
  await expect.poll(() => page.evaluate(() => window.CplayoutSaveLifecycle.read().setups)).toBe(2);
});

test("StrictMode initialization and effect replay keep the initial session active through saves and rerenders", async ({ page }) => {
  const initial = await page.evaluate(() => window.CplayoutSaveLifecycle.read().probe!);
  expect(await page.evaluate(() => window.CplayoutSaveLifecycle.read())).toMatchObject({
    setups: 2, cleanups: 1, probe: { active: true, mounted: true, generation: 1, revision: 0 },
  });
  await page.evaluate(() => window.CplayoutSaveLifecycle.save());
  await page.evaluate(() => window.CplayoutSaveLifecycle.rerender());
  await expect(page.getByTestId("render-count")).toHaveText("1");
  expect(await page.evaluate(() => window.CplayoutSaveLifecycle.read())).toMatchObject({
    setups: 2, cleanups: 1, probe: { active: true, generation: 1, revision: 1 },
    completion: { saved: true, feedbackCurrent: true },
  });
  expect(await page.evaluate(() => window.CplayoutSaveLifecycle.read().probe))
    .toEqual({ ...initial, revision: 1 });
});

test("StrictMode same-ID replacement isolates a delayed save receipt and feedback", async ({ page }) => {
  await page.evaluate(() => window.CplayoutSaveLifecycle.startDelayedSave());
  await expect.poll(() => page.evaluate(() => window.CplayoutSaveLifecycle.read().pending)).toBe(true);
  await page.evaluate(() => window.CplayoutSaveLifecycle.replace());
  await expect(page.getByTestId("render-count")).toHaveText("1");
  const replacement = await page.evaluate(() => window.CplayoutSaveLifecycle.read().probe!);
  await page.evaluate(() => window.CplayoutSaveLifecycle.finish());
  await expect.poll(() => page.evaluate(() => window.CplayoutSaveLifecycle.read().completion))
    .toEqual({ saved: true, feedbackCurrent: false });
  expect(await page.evaluate(() => window.CplayoutSaveLifecycle.read().probe))
    .toEqual(replacement);
  expect(replacement).toMatchObject({ active: true, mounted: true, generation: 2, revision: 10 });
});

test("an accepted save may finish after unmount without reviving feedback or rebasing a remount", async ({ page }) => {
  const initial = await page.evaluate(() => window.CplayoutSaveLifecycle.read().probe!);
  await page.evaluate(() => window.CplayoutSaveLifecycle.startDelayedSave());
  await expect.poll(() => page.evaluate(() => window.CplayoutSaveLifecycle.read().pending)).toBe(true);
  await page.evaluate(() => window.CplayoutSaveLifecycle.unmount());
  expect(await page.evaluate(() => window.CplayoutSaveLifecycle.read().probe?.mounted)).toBe(false);
  await page.evaluate(() => window.CplayoutSaveLifecycle.mount());
  await expect.poll(() => page.evaluate(() => window.CplayoutSaveLifecycle.read().setups)).toBe(4);
  const remounted = await page.evaluate(() => window.CplayoutSaveLifecycle.read().probe!);
  expect(remounted.coordinatorIdentity).not.toBe(initial.coordinatorIdentity);
  expect(remounted.sessionIdentity).not.toBe(initial.sessionIdentity);
  await page.evaluate(() => window.CplayoutSaveLifecycle.finish());
  await expect.poll(() => page.evaluate(() => window.CplayoutSaveLifecycle.read().completion))
    .toEqual({ saved: true, feedbackCurrent: false });
  expect(await page.evaluate(() => window.CplayoutSaveLifecycle.read().probe))
    .toEqual(remounted);
  expect(remounted).toMatchObject({ active: true, mounted: true, generation: 1, revision: 0 });
});
