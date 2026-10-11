import { expect, type Locator, type Page } from "@playwright/test";

type CatalogFormId = "catalog-dialog" | "client-profile-dialog";

/** RNWeb assigns dialog ownership after modal activation; visibility alone is insufficient. */
export async function activeCatalogFormInput(page: Page, testId: string, formId: CatalogFormId = "catalog-dialog"): Promise<Locator> {
  const dialog = page.getByRole("dialog").filter({ has: page.getByTestId(formId) });
  await expect(dialog).toBeVisible();
  const input = dialog.getByTestId(testId);
  await input.focus(); await expect(input).toBeFocused();
  return input;
}

export async function fillActiveCatalogFormInput(page: Page, testId: string, value: string, formId: CatalogFormId = "catalog-dialog", initial?: string): Promise<void> {
  const input = await activeCatalogFormInput(page, testId, formId);
  if (initial !== undefined) await expect(input).toHaveValue(initial);
  await input.fill(value); await expect(input).toHaveValue(value);
}
