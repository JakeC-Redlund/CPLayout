import type { Page } from "@playwright/test";
import { parseWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";

export const workspaceKey = "center-pivot-layout-workspace-v1";

export async function readWorkspace(page: Page) {
  const raw = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  if (raw === null) throw new Error("Expected the app to initialize the workspace envelope.");
  return parseWorkspaceDocument(raw);
}

// Pass keys explicitly: Playwright serializes callbacks without their module closures.
export function workspaceStorageBytes(page: Page) {
  return page.evaluate(keys => keys.map(key => localStorage.getItem(key)), [
    workspaceKey,
    "center-pivot-layout-projects-v1",
    "center-pivot-layout-project-catalog-v1",
    "center-pivot-layout-workspace-legacy-backup-v1",
  ]);
}
