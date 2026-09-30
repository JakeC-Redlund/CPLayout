import { expect, test } from "@playwright/test";

test("Will Rhea requested-pivot preview stays transient and separates missing corner evidence", async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort("blockedbyclient");
  });
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-will-rhea-jason-harmelink-example").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Will Rhea");
  await page.getByTestId("task-design").click();
  const initialSaveState = await page.getByTestId("project-save-state").textContent();
  const expectedSaveState = initialSaveState?.includes("Unsaved edits") ? "Project: Unsaved edits" : "Project: Saved";
  const inspector = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ });
  if (await inspector.count() && await inspector.first().isVisible()) await inspector.first().click();
  const tools = page.getByTestId("workflow-sidebar-tab-tools");
  if (await tools.count() && await tools.first().isVisible()) await tools.first().click();
  await page.getByTestId("design-action-calculate").scrollIntoViewIfNeeded();
  await page.getByTestId("design-action-calculate").click();
  const calculation = page.getByTestId("calculation-screen");
  await expect(calculation).toHaveCount(1);
  const expectFullScreen = async () => {
    const bounds = await calculation.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBe(0);
    expect(bounds!.y).toBe(0);
    expect(bounds!.width).toBe(viewport.width);
    expect(bounds!.height).toBe(viewport.height);
  };
  await expectFullScreen();
  await expect(page.getByTestId("calculation-save-state")).toHaveText(expectedSaveState);
  const controls = page.getByTestId("field-pivot-preview-controls");
  await expect(controls).toBeVisible();
  await expect(page.getByTestId("field-pivot-preview-status")).toContainText("3 requested", { timeout: 120000 });
  const before = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b))));
  await expect(page.getByTestId("field-pivot-outline-summary")).toContainText(/Mapped pivot layouts\s*2/);
  await expect(page.getByTestId("field-pivot-outline-summary")).toContainText("Not calculated - corner equipment not specified");
  await page.getByTestId("field-pivot-increase").click();
  await expect(page.getByTestId("field-pivot-increase")).toBeDisabled();
  await expect(page.getByTestId("field-pivot-preview-status")).toContainText("4 requested", { timeout: 120000 });
  for (let i = 0; i < 3; i++) await page.getByTestId("field-pivot-decrease").click();
  await expect(page.getByTestId("field-pivot-decrease")).toBeDisabled();
  await expect(page.getByTestId("field-pivot-preview-status")).toContainText("1 requested", { timeout: 120000 });
  await expect(page.getByTestId("field-pivot-preview-status")).toContainText("Proposed areas exclude corner-system irrigation.");
  await expect(controls).toContainText("New pivots have not been saved.");
  await expect(page.getByTestId("advisory-cost-basis-machine_price")).toBeChecked();
  await page.getByTestId("advisory-cost-pivot-price").fill("81000");
  await page.getByTestId("advisory-cost-includes").fill("Pivot equipment and installation");
  await expect(page.getByTestId("advisory-cost-pivot-price")).toHaveAccessibleName("Price for this pivot");
  await expect(page.getByTestId("advisory-cost-includes")).toHaveAccessibleName("Equipment and work included");
  await expect(page.getByTestId("advisory-cost-currency")).toHaveAccessibleName("Currency");
  await expect(page.getByTestId("advisory-cost-currency")).toHaveValue("USD");
  const costPanel = page.getByTestId("advisory-cost-review-panel");
  await expect(costPanel).toContainText("Pivot equipment cost");
  await expect(page.getByTestId("calculation-current-machine-summary")).toContainText("Current pivot irrigation area");
  await expect(page.getByTestId("advisory-strategy-cost-summary")).toContainText("Pivot options and equipment cost");
  expect(await costPanel.evaluate(node => getComputedStyle(node).borderTopWidth)).toBe("0px");
  expect(await costPanel.evaluate(node => getComputedStyle(node).borderRadius)).toBe("0px");
  await expect(page.getByTestId("calculation-report")).toHaveCount(1);
  const inputs = page.getByTestId("advisory-cost-form").locator("input");
  for (let index = 0; index < await inputs.count(); index++) {
    const box = await inputs.nth(index).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await expect(page.getByTestId("calculation-save-state")).toBeInViewport();
  const originalViewport = page.viewportSize()!;
  for (const viewport of [{ width: 820, height: 700 }, { width: 844, height: 390 }, originalViewport]) {
    await page.setViewportSize(viewport);
    await expectFullScreen();
    await expect(page.getByTestId("design-console-close")).toBeInViewport();
    await expect(page.getByTestId("calculation-save-state")).toBeInViewport();
    await expect(page.getByTestId("design-console-dialog")).toHaveCount(1);
  }
  await page.getByTestId("design-console-close").click();
  await expect(calculation).toHaveCount(0);
  if (await inspector.count() && await inspector.first().isVisible()) await inspector.first().click();
  if (await tools.count() && await tools.first().isVisible()) await tools.first().click();
  await page.getByTestId("design-action-calculate").click();
  await expectFullScreen();
  await expect(page.getByTestId("advisory-cost-pivot-price")).toHaveValue("81000");
  await expect(page.getByTestId("advisory-cost-includes")).toHaveValue("Pivot equipment and installation");
  await expect(page.getByTestId("field-pivot-preview-status")).toContainText("1 requested", { timeout: 120000 });
  await expect(page.getByTestId("calculation-save-state")).toHaveText(expectedSaveState);
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort(([a], [b]) => a.localeCompare(b))))).toBe(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("report cost form keeps clear, missing, invalid and complete states distinct", async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort("blockedbyclient");
  });
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-will-rhea-jason-harmelink-example").click();
  await page.getByTestId("task-design").click();
  const inspector = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ });
  if (await inspector.count() && await inspector.first().isVisible()) await inspector.first().click();
  await page.getByTestId("workflow-sidebar-tab-tools").click();
  await page.getByTestId("design-action-calculate").click();
  const storage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  const status = page.getByTestId("advisory-cost-status");
  await expect(page.getByTestId("advisory-cost-basis-machine_price")).toBeChecked();
  await expect(page.getByTestId("advisory-cost-currency")).toHaveValue("USD");
  await expect(status).toContainText("Pivot price and included equipment are required.");
  await page.getByTestId("advisory-cost-pivot-price").fill("81000");
  await expect(status).toContainText("Pivot price and included equipment are required.");
  await page.getByTestId("advisory-cost-includes").fill("Pivot equipment");
  await expect(status).toContainText("USD 81000.00 for the priced pivot configuration.");
  await page.getByTestId("advisory-cost-basis-length_tower_estimate").click();
  await expect(status).toContainText("Base amount, price per foot, price per tower and included equipment are required.");
  await page.getByTestId("advisory-cost-fixed").fill("-1");
  await expect(status).toContainText("Enter valid amounts of 0 or more");
  await page.getByTestId("advisory-cost-fixed").fill("81000");
  await page.getByTestId("advisory-cost-per-foot").fill("36.576");
  await page.getByTestId("advisory-cost-per-tower").fill("900");
  await expect(status).toContainText("USD 81000.00 base + 36.58/ft + 900.00/tower. Equipment estimate only.");
  await page.getByTestId("advisory-cost-clear").click();
  await expect(page.getByTestId("advisory-cost-basis-machine_price")).toBeChecked();
  await expect(page.getByTestId("advisory-cost-pivot-price")).toHaveValue("");
  await expect(page.getByTestId("advisory-cost-includes")).toHaveValue("");
  await expect(page.getByTestId("advisory-cost-currency")).toHaveValue("USD");
  await expect(status).toContainText("No price has been assumed.");
  await page.getByTestId("advisory-cost-basis-length_tower_estimate").click();
  await expect(page.getByTestId("advisory-cost-fixed")).toHaveValue("");
  await expect(page.getByTestId("advisory-cost-per-foot")).toHaveValue("");
  await expect(page.getByTestId("advisory-cost-per-tower")).toHaveValue("");
  await expect(status).toContainText("Base amount, price per foot, price per tower and included equipment are required.");
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(storage);
});

test("pivot quote and length estimate retain separate raw amounts until same-ID project reload", async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort("blockedbyclient");
  });
  await page.goto("/");
  const loadSample = async () => {
    await page.getByTestId("command-menu-file").click();
    await page.getByTestId("command-file-will-rhea-jason-harmelink-example").click();
    await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Will Rhea");
    await page.getByTestId("task-design").click();
  };
  const open = async () => {
    const inspector = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ });
    if (await inspector.count() && await inspector.first().isVisible()) await inspector.first().click();
    const tools = page.getByTestId("workflow-sidebar-tab-tools");
    if (await tools.count() && await tools.first().isVisible()) await tools.first().click();
    await page.getByTestId("design-action-calculate").click();
  };
  await loadSample();
  await open();
  const storage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  const saved = await page.getByTestId("calculation-save-state").textContent();
  const quote = page.getByTestId("advisory-cost-basis-machine_price");
  const estimate = page.getByTestId("advisory-cost-basis-length_tower_estimate");
  const status = page.getByTestId("advisory-cost-status");
  await expect(quote).toBeChecked();
  await expect(page.getByTestId("advisory-cost-fixed")).toHaveCount(0);
  await page.getByTestId("advisory-cost-pivot-price").fill("0081000.00");
  await page.getByTestId("advisory-cost-includes").fill("Pivot, towers and installation");
  await expect(status).toContainText("USD 81000.00 for the priced pivot configuration.");
  await estimate.click();
  await expect(estimate).toBeChecked();
  await expect(page.getByTestId("advisory-cost-pivot-price")).toHaveCount(0);
  await expect(page.getByTestId("advisory-cost-fixed")).toHaveValue("");
  await expect(page.getByTestId("advisory-cost-per-foot")).toHaveValue("");
  await expect(page.getByTestId("advisory-cost-per-tower")).toHaveValue("");
  const estimateFields = [
    { id: "fixed", raw: "001200.50", label: "Base equipment amount" },
    { id: "per-foot", raw: "00036.5760", label: "Additional cost per foot of pivot" },
    { id: "per-tower", raw: "00900.00", label: "Additional cost per drive tower" },
  ];
  for (const field of estimateFields) {
    await expect(page.getByTestId(`advisory-cost-${field.id}`)).toHaveAccessibleName(field.label);
    await page.getByTestId(`advisory-cost-${field.id}`).fill(field.raw);
  }
  await expect(status).toContainText("USD 1200.50 base + 36.58/ft + 900.00/tower. Equipment estimate only.");
  await quote.click();
  await expect(page.getByTestId("advisory-cost-pivot-price")).toHaveValue("0081000.00");
  await expect(status).toContainText("USD 81000.00 for the priced pivot configuration.");
  await page.getByTestId("advisory-cost-pivot-price").fill("invalid quote");
  await expect(status).toContainText("Enter valid amounts of 0 or more");
  await estimate.click();
  await expect(status).toContainText("USD 1200.50 base + 36.58/ft + 900.00/tower.");
  await page.getByTestId("design-console-close").click();
  await open();
  await expect(estimate).toBeChecked();
  for (const field of estimateFields) await expect(page.getByTestId(`advisory-cost-${field.id}`)).toHaveValue(field.raw);
  await quote.click();
  await expect(page.getByTestId("advisory-cost-pivot-price")).toHaveValue("invalid quote");
  await expect(page.getByTestId("advisory-cost-includes")).toHaveValue("Pivot, towers and installation");
  await expect(page.getByTestId("calculation-save-state")).toHaveText(saved!);
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(storage);
  await page.getByTestId("design-console-close").click();
  // Reopening the same sample exercises a new load generation with the same project ID.
  await loadSample();
  await open();
  await expect(quote).toBeChecked();
  await expect(page.getByTestId("advisory-cost-pivot-price")).toHaveValue("");
  await expect(page.getByTestId("advisory-cost-includes")).toHaveValue("");
  await expect(page.getByTestId("advisory-cost-currency")).toHaveValue("USD");
  await expect(status).toContainText("No price has been assumed.");
  await estimate.click();
  for (const field of estimateFields) await expect(page.getByTestId(`advisory-cost-${field.id}`)).toHaveValue("");
  await expect(status).toContainText("Base amount, price per foot, price per tower and included equipment are required.");
});

test("changing pivot equipment excludes the old price until re-entry", async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort("blockedbyclient");
  });
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-full-scope-multi-pivot-cost-demo").click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText("Full-Scope Multi-Pivot Cost Demo");
  await page.getByTestId("task-design").click();
  const tools = async () => {
    const inspector = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ });
    if (await inspector.count() && await inspector.first().isVisible()) await inspector.first().click();
    await page.getByTestId("workflow-sidebar-tab-tools").click();
  };
  await tools();
  await page.getByTestId("design-action-calculate").click();
  await page.getByTestId("advisory-cost-pivot-price").fill("81000");
  await page.getByTestId("advisory-cost-includes").fill("Pivot equipment");
  await expect(page.getByTestId("advisory-cost-active-note")).toHaveCount(1);
  await expect(page.getByTestId("advisory-cost-row-current-machine")).toContainText("USD", { timeout: 60000 });
  await page.getByTestId("design-console-close").click();
  await tools();
  await page.getByTestId("design-action-machine").click();
  await page.getByRole("button", { name: "Remove Span", exact: true }).click();
  await page.getByRole("button", { name: "Apply Machine Settings", exact: true }).click();
  await page.getByTestId("design-console-close").click();
  await tools();
  await page.getByTestId("design-action-calculate").click();
  await expect(page.getByTestId("advisory-cost-pivot-price")).toHaveValue("81000");
  await expect(page.getByTestId("advisory-cost-status")).toContainText("The pivot equipment has changed");
  await expect(page.getByTestId("advisory-cost-active-note")).toHaveCount(0);
  await expect(page.getByTestId("advisory-cost-row-current-machine")).toContainText("Missing", { timeout: 60000 });
  await page.getByTestId("advisory-cost-pivot-price").fill("82000");
  await expect(page.getByTestId("advisory-cost-status")).toContainText("USD 82000.00 for the priced pivot configuration");
  await expect(page.getByTestId("advisory-cost-active-note")).toHaveCount(1);
  await expect(page.getByTestId("advisory-cost-row-current-machine")).toContainText("USD", { timeout: 60000 });
});

test("corner inputs require explicit choices, stay temporary, and invalidate old results", async ({ page }, testInfo) => {
  const exceptions: string[] = [];
  page.on("pageerror", error => exceptions.push(String(error)));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort("blockedbyclient");
  });
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-will-rhea-jason-harmelink-example").click();
  await page.getByTestId("task-design").click();
  const open = async () => {
    const inspector = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ });
    if (await inspector.count() && await inspector.first().isVisible()) await inspector.first().click();
    const tools = page.getByTestId("workflow-sidebar-tab-tools");
    if (await tools.count() && await tools.first().isVisible()) await tools.first().click();
    await page.getByTestId("design-action-calculate").click();
  };
  await open();
  const storage = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  const saved = await page.getByTestId("calculation-save-state").textContent();
  const form = page.getByTestId("corner-arm-input-form");
  await form.scrollIntoViewIfNeeded();
  await expect(form).toContainText("1. Last regular drive tower speed at 100% timer (ft/min)");
  await expect(page.getByTestId("corner-input-speed")).toHaveAccessibleName("Last regular drive tower speed at 100 percent timer in feet per minute");
  await expect(page.getByTestId("corner-input-missing")).toContainText("Positive last regular drive tower speed in ft/min");
  const originalViewport = page.viewportSize()!;
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, originalViewport]) {
    await page.setViewportSize(viewport);
    for (const id of ["speed", "model", "rotation", "orientation", "guidance", "run"]) {
      const box = await page.getByTestId(`corner-input-${id}`).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
  }
  await expect(page.getByTestId("corner-input-run")).toBeDisabled();
  for (const id of ["model", "orientation", "rotation", "guidance"]) await expect(page.getByTestId(`corner-input-${id}`)).toContainText("Not selected");
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("corner-inputs-missing.png") });
  await page.getByTestId("corner-input-speed").fill("1.25");
  await page.getByTestId("corner-input-model").click();
  await page.locator('[data-testid^="corner-option-model-"]').nth(1).click();
  await page.getByTestId("corner-input-rotation").click();
  await page.getByTestId("corner-option-rotation-clockwise").click();
  await page.getByTestId("corner-input-orientation").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("corner-option-orientation-none")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByTestId("corner-option-orientation-trailing")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("corner-input-orientation")).toBeFocused();
  await expect(page.getByTestId("corner-input-orientation")).toHaveAccessibleName("4. Corner orientation: Trailing");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("calculation-screen")).toBeVisible();
  await expect(page.getByTestId("corner-input-orientation")).toBeFocused();
  await expect(page.getByTestId("corner-input-run")).toBeDisabled();
  await page.getByTestId("corner-input-guidance").click();
  await page.getByTestId("corner-option-guidance-will-rhea-lrdu-distance").click();
  await expect(page.getByTestId("corner-input-model-warning")).toContainText("Not verified equipment");
  await expect(page.getByTestId("corner-input-model-warning")).toContainText(/\d+\.\d{2} ft span \+ \d+\.\d{2} ft overhang/);
  const warningIcon = await page.getByTestId("corner-input-model-warning").locator("svg").boundingBox();
  expect(warningIcon?.width).toBe(20);
  expect(warningIcon?.height).toBe(20);
  await expect(page.getByTestId("corner-input-guidance-note")).toContainText("Guidance suitability unverified");
  await expect(page.getByTestId("corner-input-run")).toBeEnabled();
  await page.getByTestId("corner-input-run").click();
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toBeVisible();
  await expect(page.getByTestId("corner-arm-kinematics-panel")).not.toContainText("Ready");
  await page.screenshot({ path: testInfo.outputPath("corner-inputs-calculated.png") });
  await page.getByTestId("corner-input-speed").fill("0");
  await expect(page.getByTestId("corner-input-run")).toBeDisabled();
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toHaveCount(0);
  await page.getByTestId("corner-input-speed").fill("1.25");
  await page.getByTestId("design-console-close").click();
  await open();
  await expect(page.getByTestId("corner-input-speed")).toHaveValue("1.25");
  await expect(page.getByTestId("corner-input-orientation")).toContainText("Trailing");
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toHaveCount(0);
  await expect(page.getByTestId("calculation-save-state")).toHaveText(saved!);
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(storage);
  await page.getByTestId("corner-input-run").click();
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toBeVisible();
  await page.getByTestId("machine-boundary-clearance-increase").click();
  await expect(page.getByTestId("corner-input-speed")).toHaveValue("1.25");
  await expect(page.getByTestId("corner-input-orientation")).toContainText("Trailing");
  await expect(page.getByTestId("corner-input-guidance")).toContainText("LRDU Distance");
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("calculation-screen")).toHaveCount(0);
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-will-rhea-jason-harmelink-example").click();
  await page.getByTestId("task-design").click();
  await open();
  await expect(page.getByTestId("corner-input-speed")).toHaveValue("");
  await expect(page.getByTestId("corner-input-model")).toContainText("Not selected");
  await expect(page.getByTestId("corner-input-guidance")).toContainText("Not selected");
  await expect(page.getByTestId("corner-arm-kinematics-panel")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(exceptions).toEqual([]);
});
