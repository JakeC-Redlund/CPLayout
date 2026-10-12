import { expect, type Page } from "@playwright/test";
import { parseWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import type { AuthenticatedBrowserService } from "./authenticated-test";

export const workspaceKey = "center-pivot-layout-workspace-v1";
const authenticatedPages = new WeakMap<Page, AuthenticatedBrowserService>();
export function registerAuthenticatedPage(page: Page, service: AuthenticatedBrowserService): void { authenticatedPages.set(page, service); }
export function authenticatedPartition(page: Page): string | null { return authenticatedPages.get(page)?.partition ?? null; }
export function accountPreferenceKey(page: Page, key: string): string { const partition = authenticatedPartition(page); return partition ? `${partition}:${key}` : key; }
export function actualWorkspaceWriterLock(page: Page): string { const partition = authenticatedPartition(page); return partition ? `cplayout:authenticated:${partition}` : "cplayout:workspace:writer:v1"; }
export async function readWorkspaceRaw(page: Page): Promise<string | null> {
  const partition = authenticatedPartition(page);
  return page.evaluate(({ partition, legacy }) => { if (!partition) return localStorage.getItem(legacy); const cache = localStorage.getItem(partition); return cache ? (JSON.parse(cache) as { document: string }).document : null; }, { partition, legacy: workspaceKey });
}
export async function writeWorkspaceFixture(page: Page, document: string): Promise<void> {
  const partition = authenticatedPartition(page);
  await page.evaluate(({ partition, legacy, document }) => {
    if (!partition) { localStorage.setItem(legacy, document); return; }
    const raw = localStorage.getItem(partition); if (!raw) throw new Error("Authenticated source cache is unavailable."); const cache = JSON.parse(raw); cache.document = document; localStorage.setItem(partition, JSON.stringify(cache));
  }, { partition, legacy: workspaceKey, document });
  const service = authenticatedPages.get(page);
  if (service) { const workspace = parseWorkspaceDocument(document); await service.database.transaction(async transaction => { const current = await transaction.workspace(service.workspaceId); if (!current) throw new Error("Synthetic source workspace disappeared."); await transaction.writeWorkspace({ ...current, revision: workspace.revision, document }); }); }
}
export function readAccountPreference(page: Page, key: string) { return page.evaluate(key => localStorage.getItem(key), accountPreferenceKey(page, key)); }
export function writeAccountPreference(page: Page, key: string, value: string | null) { return page.evaluate(({ key, value }) => { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }, { key: accountPreferenceKey(page, key), value }); }

export async function readWorkspace(page: Page) {
  const raw = await readWorkspaceRaw(page);
  if (raw === null) throw new Error("Expected the app to initialize the workspace envelope.");
  return parseWorkspaceDocument(raw);
}

/** Deliberate browsing changes Catalog selection only. It never opens a document
 * or supplies replacement parents for retained history with missing folders. */
export async function browseDesignParents(page: Page, designId: string) {
  const workspace = await readWorkspace(page), design = workspace.catalog.designs.find(item => item.id === designId);
  const field = workspace.catalog.fieldMaps.find(item => item.id === design?.fieldMapId);
  const project = workspace.catalog.projects.find(item => item.id === field?.projectId);
  const customer = workspace.catalog.clients.find(item => item.id === project?.clientId);
  if (!design || !field || !project || !customer) throw new Error("The saved design's actual customer, project and field folders are unavailable.");
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
  for (const [kind, id] of [["client", customer.id], ["project", project.id], ["field", field.id]] as const) {
    const parent = page.getByTestId(`catalog-${kind}-${id}`); await parent.click(); await expect(parent).toHaveAttribute("aria-pressed", "true");
  }
  const category = page.getByTestId("catalog-content-map"); await category.click(); await expect(category).toHaveAttribute("aria-pressed", "true");
  return { clientId: customer.id, projectId: project.id, fieldMapId: field.id, designId: null };
}

// Pass keys explicitly: Playwright serializes callbacks without their module closures.
export function workspaceStorageBytes(page: Page) {
  const partition = authenticatedPartition(page);
  return page.evaluate(({ keys, partition }) => keys.map((key, index) => index === 0 && partition ? (() => { const raw = localStorage.getItem(partition); return raw ? JSON.parse(raw).document as string : null; })() : localStorage.getItem(key)), { partition, keys: [
    workspaceKey,
    "center-pivot-layout-projects-v1",
    "center-pivot-layout-project-catalog-v1",
    "center-pivot-layout-workspace-legacy-backup-v1",
  ] });
}
