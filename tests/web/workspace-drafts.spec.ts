import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { defaultProjectSettings, sampleProject, type DesignDraft } from "../../packages/core/src";
import type { WorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { WEB_WORKSPACE_KEY } from "../../packages/project-store/src/webWorkspaceStore";

declare global {
  interface Window {
    CplayoutDraftHarness: typeof import("../../packages/project-store/src/versionedProjectRepository");
  }
}

const source = buildSync({
  entryPoints: [resolve(__dirname, "../../packages/project-store/src/versionedProjectRepository.ts")],
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "CplayoutDraftHarness",
}).outputFiles[0].text;
const sourceHash = createHash("sha256").update(source).digest("hex");
const now = "2026-09-25T00:00:00.000Z";

async function harness(page: Page) {
  await page.route("**/draft-harness.html", route => route.fulfill({
    contentType: "text/html", body: "<!doctype html><title>CPLayout draft storage test harness</title>",
  }));
  await page.goto("/draft-harness.html");
  await page.addScriptTag({ content: source });
  expect(await page.evaluate(() => Boolean(navigator.locks))).toBe(true);
}

const read = (page: Page) => page.evaluate(async () => window.CplayoutDraftHarness.createVersionedProjectRepository({
  getStorage: () => localStorage, getLocks: () => navigator.locks,
}).versionedWorkspace!.readAsync());

const open = (page: Page, id = "draft-design") => page.evaluate(async id => window.CplayoutDraftHarness.createVersionedProjectRepository({
  getStorage: () => localStorage, getLocks: () => navigator.locks,
}).versionedWorkspace!.readDesignAsync(id), id);

const execute = (page: Page, revision: number, command: WorkspaceCommand) => page.evaluate(async ({ revision, command }) => {
  const api = window.CplayoutDraftHarness.createVersionedProjectRepository({
    getStorage: () => localStorage, getLocks: () => navigator.locks,
  }).versionedWorkspace!;
  try { return { ok: true as const, receipt: await api.executeAsync(revision, command) }; }
  catch (error) { return { ok: false as const, error: String(error) }; }
}, { revision, command });

test("draft repository persists missing inputs across tabs and reloads with revision and deletion protection", async ({ page, context }, testInfo) => {
  await testInfo.attach("repository-harness-identity", { body: JSON.stringify({ sourceHash }), contentType: "application/json" });
  const second = await context.newPage();
  await harness(page);
  await harness(second);
  await read(page);
  expect((await execute(page, 0, { type: "create_client", now, id: "client", input: {
    primaryContactFirstName: "Synthetic", primaryContactLastName: "Client",
  } })).ok).toBe(true);
  expect((await execute(page, 1, { type: "create_project_with_initial_design", now, input: {
    clientId: "client", project: structuredClone(sampleProject), fieldMapId: "field", designId: "legacy-design",
  } })).ok).toBe(true);
  const legacy = (await read(page)).projectDocuments[0].document;
  const settings = defaultProjectSettings();
  delete settings.aerialImagery.sourcePackageId;
  const draft: DesignDraft = { id: "draft-payload", name: "Incomplete field", projectCrs: null, unitSystem: settings.unitSystem, settings,
    fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
  const create: WorkspaceCommand = { type: "create_design_draft", now, designId: "draft-design", fieldMapId: "field", name: "Draft", draft };
  expect((await execute(page, 2, create)).ok).toBe(true);
  const missing = await open(second);
  expect(missing.kind).toBe("draft");
  if (missing.kind !== "draft") throw new Error("Expected draft");
  expect(missing.draft).toEqual(draft);
  const save: WorkspaceCommand = { type: "save_design_draft", now, designId: "draft-design", expectedDesignRevision: 0,
    draft: { ...missing.draft, projectCrs: "EPSG:32613", fieldBoundary: [{ x: 500000, y: 4500000 }] } };
  const race = await Promise.all([execute(page, 3, save), execute(second, 3, save)]);
  expect(race.filter(item => item.ok)).toHaveLength(1);
  expect(race.find(item => !item.ok)?.error).toContain("revision changed");
  const stored = await page.evaluate(key => localStorage.getItem(key), WEB_WORKSPACE_KEY);
  const staleDesign = await execute(second, 4, save);
  expect(staleDesign.ok).toBe(false);
  if (!staleDesign.ok) expect(staleDesign.error).toContain("revision changed");
  expect(await page.evaluate(key => localStorage.getItem(key), WEB_WORKSPACE_KEY)).toBe(stored);
  await harness(second);
  const reopened = await open(second);
  expect(reopened.kind).toBe("draft");
  if (reopened.kind !== "draft") throw new Error("Expected draft");
  expect(reopened.workspaceRevision).toBe(4);
  expect(reopened.design.revision).toBe(1);
  expect(reopened.draft.fieldBoundary).toEqual(save.draft.fieldBoundary);
  expect(reopened.draft.pivotCenter).toBeNull();
  expect(reopened.draft.waterSource).toBeNull();
  expect(reopened.draft.powerSource).toBeNull();
  expect(reopened.draft.machine).toEqual({});
  const partial = { ...reopened.draft, fieldBoundary: [...reopened.draft.fieldBoundary, { x: 500010, y: 4500010 }],
    machine: { spanLengthsMeters: [null, 45, null] } };
  expect((await execute(second, reopened.workspaceRevision, { ...save, expectedDesignRevision: reopened.design.revision, draft: partial })).ok).toBe(true);
  await harness(page);
  const restored = await open(page);
  expect(restored.kind).toBe("draft");
  if (restored.kind !== "draft") throw new Error("Expected draft");
  expect(restored.draft).toEqual(partial);
  const mixed = await page.evaluate(async () => {
    const api = window.CplayoutDraftHarness.createVersionedProjectRepository({ getStorage: () => localStorage, getLocks: () => navigator.locks }).versionedWorkspace!;
    return window.CplayoutDraftHarness.workspaceDesignCatalog(await api.readAsync());
  });
  expect(mixed.designs.map(item => item.kind).sort()).toEqual(["draft", "project"]);
  expect((await read(page)).projectDocuments[0].document).toBe(legacy);
  expect((await execute(page, restored.workspaceRevision, { type: "delete_design", now, designId: "draft-design", expectedDesignRevision: 2 })).ok).toBe(true);
  expect(await open(second)).toEqual({ kind: "not_found", workspaceRevision: 6 });
  expect((await execute(second, 6, create)).ok).toBe(false);
  const final = await read(second);
  expect(final.catalog.designs.map(item => item.id)).toEqual(["legacy-design"]);
  expect(final.projectDocuments[0].document).toBe(legacy);
  expect(final.draftDocuments).toEqual([]);
  expect(final.tombstones.map(item => item.entity).sort()).toEqual(["design", "draft_document"]);
  await second.close();
});
