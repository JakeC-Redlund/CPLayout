import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { resolve } from "node:path";
import { sampleProject, serializeProjectDocument } from "../../packages/core/src";
import { emptyProjectCatalog, ensureCatalogEntryForProject } from "../../packages/project-store/src/projectCatalog";
import {
  LEGACY_CATALOG_KEY, LEGACY_PROJECTS_KEY, WEB_WORKSPACE_BACKUP_KEY, WEB_WORKSPACE_KEY,
} from "../../packages/project-store/src/webWorkspaceStore";

declare global {
  interface Window {
    CplayoutWorkspaceHarness: typeof import("../../packages/project-store/src/webWorkspaceStore");
  }
}

const source = buildSync({
  entryPoints: [resolve(__dirname, "../../packages/project-store/src/webWorkspaceStore.ts")],
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "CplayoutWorkspaceHarness",
}).outputFiles[0].text;

async function harness(page: Page) {
  await page.route("**/workspace-harness.html", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>CPLayout storage test harness</title>",
  }));
  await page.goto("/workspace-harness.html");
  await page.addScriptTag({ content: source });
  expect(await page.evaluate(() => Boolean(navigator.locks))).toBe(true);
}

test("workspace foundation serializes two browser tabs and rejects stale saves", async ({ page, context }) => {
  const second = await context.newPage();
  await harness(page);
  await harness(second);
  const project = structuredClone(sampleProject);
  const sources = {
    projectsRaw: JSON.stringify({ [project.id]: { document: serializeProjectDocument(project), summary: {
      id: project.id, name: project.name, projectCrs: project.projectCrs, unitSystem: project.unitSystem, updatedAt: "2026-09-17T00:00:00Z",
    } } }),
    catalogRaw: JSON.stringify(ensureCatalogEntryForProject(emptyProjectCatalog(), project)),
  };
  await page.evaluate(({ keys, sources }) => {
    localStorage.setItem(keys.projects, sources.projectsRaw);
    localStorage.setItem(keys.catalog, sources.catalogRaw);
  }, { keys: { projects: LEGACY_PROJECTS_KEY, catalog: LEGACY_CATALOG_KEY }, sources });
  const initialize = (tab: Page) => tab.evaluate(async () => {
    const store = window.CplayoutWorkspaceHarness.createWebWorkspaceStore({ getStorage: () => localStorage, getLocks: () => navigator.locks });
    return store.initializeAsync();
  });
  const initial = await Promise.all([initialize(page), initialize(second)]);
  expect(initial[0]).toEqual(initial[1]);
  expect(initial[0].revision).toBe(0);
  const save = (tab: Page, expectedRevision: number, name: string) => tab.evaluate(async ({ expectedRevision, name }) => {
    const store = window.CplayoutWorkspaceHarness.createWebWorkspaceStore({ getStorage: () => localStorage, getLocks: () => navigator.locks });
    try {
      const result = await store.transactAsync(expectedRevision, latest => {
        latest.catalog.clients[0].displayName = name;
        latest.revision += 1;
        return latest;
      });
      return { ok: true, revision: result.revision };
    } catch (error) { return { ok: false, error: String(error) }; }
  }, { expectedRevision, name });
  const attempts = await Promise.all([save(page, 0, "First tab"), save(second, 0, "Second tab")]);
  expect(attempts.filter(result => result.ok)).toHaveLength(1);
  expect(attempts.find(result => !result.ok)?.error).toContain("revision changed");
  const read = (tab: Page) => tab.evaluate(async () => window.CplayoutWorkspaceHarness.createWebWorkspaceStore({ getStorage: () => localStorage, getLocks: () => navigator.locks }).readAsync());
  const current = await read(second);
  expect(current.revision).toBe(1);
  expect(["First tab", "Second tab"]).toContain(current.catalog.clients[0].displayName);
  expect(await save(second, current.revision, "Explicit reload and retry")).toEqual({ ok: true, revision: 2 });
  expect((await read(page)).catalog.clients[0].displayName).toBe("Explicit reload and retry");
  const retained = await page.evaluate(keys => ({
    projectsRaw: localStorage.getItem(keys.projects), catalogRaw: localStorage.getItem(keys.catalog),
    backup: JSON.parse(localStorage.getItem(keys.backup)!), envelope: JSON.parse(localStorage.getItem(keys.workspace)!),
  }), { projects: LEGACY_PROJECTS_KEY, catalog: LEGACY_CATALOG_KEY, backup: WEB_WORKSPACE_BACKUP_KEY, workspace: WEB_WORKSPACE_KEY });
  expect(retained.projectsRaw).toBe(sources.projectsRaw);
  expect(retained.catalogRaw).toBe(sources.catalogRaw);
  expect(retained.backup.projectsRaw).toBe(sources.projectsRaw);
  expect(retained.backup.catalogRaw).toBe(sources.catalogRaw);
  expect(retained.envelope.revision).toBe(2);
  await second.close();
});
