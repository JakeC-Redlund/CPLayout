import { expect, type Page } from "@playwright/test";

export async function activateMapTool(page: Page, tool: "pan" | "edit" | "point" | "line" | "polygon" | "circle"): Promise<void> {
  const close = page.getByRole("button", { name: /Collapse (map inspector|right workflow sidebar)/ }).first();
  if (await close.isVisible()) await close.click();
  const toolbar = page.getByTestId("map-bottom-hud");
  const trigger = toolbar.getByTestId(`design-action-${tool}`);
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await toolbar.getByTestId(`design-action-${tool}-start`).click();
  await expect(toolbar.getByTestId("map-tool-options")).toHaveCount(0);
}
