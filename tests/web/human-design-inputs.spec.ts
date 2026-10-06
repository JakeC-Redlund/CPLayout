import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { newDesignDraft } from "../../apps/mobile/src/newDesignDraft";
import { createDesignDraftEditorState, reduceDesignDraftEditorState, parseDesignDraftDocument, parseFieldDesignDocument, sampleProject, type DraftDrawingCommand } from "../../packages/core/src";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { createWebWorkspaceStore } from "../../packages/project-store/src/webWorkspaceStore";
import { readWorkspace, workspaceKey } from "./workspace-fixtures";

const now = "2026-09-29T00:00:00.000Z";
function fixture(draft: boolean, classification: boolean | "capture" = false, draftSpans?: number[]) {
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "human-client",
    input: { companyName: "Human input farm", primaryContactFirstName: "Test", primaryContactLastName: "Operator" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now,
    input: { clientId: "human-client", projectId: "human-project", projectName: "Human field", projectCrs: draft ? "" : sampleProject.projectCrs,
      unitSystem: "us_survey_feet", fieldMapId: "human-map" } }).workspace;
  if (draft) {
    let state = createDesignDraftEditorState(newDesignDraft("human-draft-payload", "Incomplete human draft", "us_survey_feet"));
    if (draftSpans) state = reduceDesignDraftEditorState(state, { type: "set_machine", machine: { spanLengthsMeters: draftSpans } });
    if (classification) {
      state = reduceDesignDraftEditorState(state, { type: "set_crs", projectCrs: "LOCAL:METERS" });
      const commands: DraftDrawingCommand[] = classification === "capture" ? [
        { type: "set_autosave", enabled: false },
        { type: "begin", id: "retained-line", name: "Unfinished line", geometryType: "LineString" },
        ...[{ x: 20, y: 30 }, { x: 80, y: 90 }, { x: 140, y: 50 }].map(point => ({
          type: "append_vertex" as const, id: "retained-line", vertex: { point, recordedAt: now, wgs84: null, elevation: null },
        })),
      ] : [
        { type: "begin", id: "retained-point", name: "Point", geometryType: "Point" },
        { type: "append_vertex", id: "retained-point", vertex: { point: { x: 20, y: 30 }, recordedAt: now, wgs84: null, elevation: null } },
        { type: "finish", id: "retained-point" },
      ];
      for (const command of commands) {
        state = reduceDesignDraftEditorState(state, { type: "drawing", expectedRevision: state.revision, command });
        if (state.lastError) throw new Error(state.lastError);
      }
    }
    return applyWorkspaceCommand(workspace, { type: "create_design_draft", now, designId: "human-draft", fieldMapId: "human-map",
      name: "Incomplete human draft", draft: state.draft }).workspace;
  }
  const project = structuredClone(sampleProject);
  project.machine.spanLengthsMeters = [51.123456789123, 40.000000001];
  workspace = applyWorkspaceCommand(workspace, { type: "save_project", now, project, createOnly: true }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_design_record", now,
    input: { id: "human-source", fieldMapId: "human-map", pivotProjectId: project.id, name: project.name } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v2", now }).workspace;
  return applyWorkspaceCommand(workspace, { type: "convert_project_to_field_design", now, sourceDesignId: "human-source", expectedDesignRevision: 0,
    designId: "human-field", fieldMapId: "human-map", name: "Human field design", fieldId: "human-field-payload", waterSourceId: "human-water", powerSourceId: "human-power" }).workspace;
}
async function open(context: BrowserContext, page: Page, draft = false, classification: boolean | "capture" = false, draftSpans?: number[]) {
  const values = new Map<string, string>();
  const store = createWebWorkspaceStore({ getStorage: () => ({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); } }), getLocks: () => ({ request: async (_name, _options, action) => action() }) });
  await store.initializeAsync();
  values.set(workspaceKey, serializeWorkspaceDocument(fixture(draft, classification, draftSpans)));
  await context.addInitScript(({ key, entries }) => {
    if (location.protocol === "http:" && localStorage.getItem(key) === null) {
      for (const [name, value] of entries) localStorage.setItem(name, value);
    }
  }, { key: workspaceKey, entries: [...values] });
  await page.goto("/");
  const drawer = page.getByRole("button", { name: "Open project drawer" });
  if (await drawer.isVisible()) await drawer.click();
  await page.getByTestId(`catalog-design-human-${draft ? "draft" : "field"}-open`).click();
  await expect(page.getByTestId(draft ? "design-draft-workspace" : "field-design-workspace")).toBeVisible();
}

test("numbered field spans retain raw text through failed apply, discard and append/remove-last", async ({ context, page }) => {
  await open(context, page);
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  const before = await readWorkspace(page);
  const first = page.getByTestId("field-input-span-0");
  const originalText = await first.inputValue();
  await first.fill("150' ");
  await page.getByTestId("field-input-name").focus();
  await expect(first).toHaveValue("150' ");
  await first.fill("-");
  await page.getByTestId("field-add-span").click();
  await page.getByTestId("field-input-span-2").fill("12.");
  await page.getByTestId("field-remove-last-span").click();
  await expect(first).toHaveValue("-");
  await expect(page.getByTestId("field-input-span-2")).toHaveCount(0);
  await page.getByTestId("field-apply-machine").click();
  await expect(page.getByTestId("field-feedback")).toBeVisible();
  await expect(first).toHaveValue("-");
  await expect(page.getByTestId("field-layout-next")).toContainText("Apply or discard machine inputs");
  await expect(page.getByTestId("field-save")).toBeDisabled();
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("field-discard-inputs").click();
  await expect(first).toHaveValue(originalText);
  await page.getByTestId("field-input-name").fill("Renamed without changing lengths");
  await page.getByTestId("field-apply-machine").click();
  await expect(page.getByTestId("field-layout-next")).toContainText("Save field");
  await page.getByTestId("field-save").click();
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  const after = await readWorkspace(page);
  expect(parseFieldDesignDocument(after.fieldDocuments![0].document).machines[0].configuration.spanLengthsMeters)
    .toEqual([51.123456789123, 40.000000001]);
});

for (const [label, spans] of [
  ["distinct feet displays", [41.123456789, 52.987654321]],
  ["equal rounded feet displays", [41.123456789, 41.123456790]],
] as const) {
  test(`draft append/remove-last retains raw input and exact surviving spans with ${label}`, async ({ context, page }, info) => {
    await open(context, page, true, false, [...spans]);
    await page.getByTestId("draft-autosave").getByRole("switch").uncheck();
    await page.getByTestId("draft-save").click();
    await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
    if (!await page.getByTestId("design-draft-inputs").isVisible()) await page.getByTestId("draft-inputs-toggle").click();
    const before = await readWorkspace(page);
    const first = page.getByTestId("draft-machine-span-0");
    const second = page.getByTestId("draft-machine-span-1");
    const add = page.getByTestId("draft-machine-add-span");
    const remove = page.getByTestId("draft-machine-remove-last-span");
    const apply = page.getByRole("button", { name: "Apply machine", exact: true });
    const originalFirstText = await first.inputValue();
    const originalSecondText = await second.inputValue();
    if (label === "equal rounded feet displays") expect(originalFirstText).toBe(originalSecondText);
    await expect(add).toHaveAccessibleName("Add span");
    await expect(remove).toHaveAccessibleName("Remove last span");
    await expect(page.locator('[data-testid^="draft-machine-remove-span-"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove span \d+$/ })).toHaveCount(0);
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`draft-spans-${label}-numbered-rows.png`) });
    await remove.scrollIntoViewIfNeeded();
    await expect(add).toBeInViewport();
    await expect(remove).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`draft-spans-${label}-add-remove-last.png`) });

    await first.fill("150' ");
    await second.focus();
    await expect(first).toHaveValue("150' ");
    await first.fill("-");
    await add.click();
    await page.getByTestId("draft-machine-span-2").fill("12.");
    await remove.click();
    await expect(first).toHaveValue("-");
    await expect(second).toHaveValue(originalSecondText);
    await expect(page.getByTestId("draft-machine-span-2")).toHaveCount(0);
    await apply.click();
    await expect(page.getByTestId("design-draft-inputs").getByRole("alert")).toContainText("Span 1");
    await expect(first).toHaveValue("-");
    await expect(page.getByTestId("draft-save")).toBeDisabled();
    expect(await readWorkspace(page)).toEqual(before);
    await page.getByTestId("draft-inputs-discard").click();
    await expect(first).toHaveValue(originalFirstText);
    await expect(second).toHaveValue(originalSecondText);
    await expect(page.getByTestId("design-draft-inputs").getByRole("alert")).toHaveCount(0);

    await remove.click();
    await expect(first).toHaveValue(originalFirstText);
    await expect(second).toHaveCount(0);
    await page.getByTestId("draft-machine-name").fill("Retained precise first span");
    await apply.click();
    await page.getByTestId("draft-save").click();
    await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
    const saved = await readWorkspace(page);
    expect(parseDesignDraftDocument(saved.draftDocuments[0].document).machine.spanLengthsMeters).toEqual([spans[0]]);
    expect(saved.projectDocuments).toHaveLength(0);
    await page.getByTestId("draft-catalog").click();
    const drawer = page.getByRole("button", { name: "Open project drawer" });
    if (await drawer.isVisible()) await drawer.click();
    await page.getByTestId("catalog-design-human-draft-open").click();
    await expect(page.getByTestId("design-draft-workspace")).toBeVisible();
    if (!await page.getByTestId("design-draft-inputs").isVisible()) await page.getByTestId("draft-inputs-toggle").click();
    await expect(first).toHaveValue(originalFirstText);
    await expect(second).toHaveCount(0);
    expect(await readWorkspace(page)).toEqual(saved);
    expect(parseDesignDraftDocument((await readWorkspace(page)).draftDocuments[0].document).machine.spanLengthsMeters).toEqual([spans[0]]);
  });
}

test("Layout preparation names matching preview and retains an earlier frozen revision", async ({ context, page }) => {
  await open(context, page);
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  await expect(page.getByTestId("field-layout-next")).toContainText("Calculate preview");
  await page.getByTestId("field-calculate").click();
  await expect(page.getByTestId("field-layout-next")).toContainText("Freeze layout target");
  await page.getByTestId("field-freeze-target").click();
  await expect(page.getByTestId("field-layout-next")).toContainText("Open in Layout");
  await page.getByTestId("field-input-name").fill("Later applied machine");
  await page.getByTestId("field-apply-machine").click();
  await expect(page.getByTestId("field-target-output-source")).toContainText("Earlier design retained; current edits are not in this target");
  await expect(page.getByTestId("field-layout-next")).toContainText("Save field");
  await expect(page.getByTestId("field-freeze-target")).toBeDisabled();
});

test("draft missing-input links focus an editable input without discarding partial text", async ({ context, page }) => {
  await open(context, page, true);
  await page.getByTestId("draft-missing-projectCrs").click();
  await expect(page.getByTestId("draft-crs")).toBeFocused();
  await page.getByTestId("draft-crs").fill("LOCAL:");
  await page.getByTestId("draft-missing-pivotCenter").click();
  await expect(page.getByTestId("draft-pivot_center-x")).toBeFocused();
  await page.getByTestId("draft-pivot_center-x").fill("123");
  await page.getByTestId("draft-pivot_center-x").fill("");
  await page.getByTestId("draft-missing-pivotCenter").click();
  await expect(page.getByTestId("draft-pivot_center-x")).toBeFocused();
  await expect(page.getByTestId("draft-pivot_center-y")).toHaveValue("");
  await page.getByTestId("draft-pivot_center-x").fill("-");
  await page.getByTestId("draft-inputs-toggle").click();
  await page.getByTestId("draft-inputs-toggle").click();
  await expect(page.getByTestId("draft-crs")).toHaveValue("LOCAL:");
  await expect(page.getByTestId("draft-pivot_center-x")).toHaveValue("-");
  await expect(page.getByTestId("draft-save")).toBeDisabled();
  await expect(page.getByTestId("draft-create-complete")).toBeDisabled();
  expect((await readWorkspace(page)).projectDocuments).toHaveLength(0);
});

test("narrow-short map retains camera, unfinished vertices and undo across Inputs and resize breakpoints", async ({ context, page }) => {
  const tallViewport = { width: 390, height: 844 };
  await page.setViewportSize(tallViewport);
  await open(context, page, true, "capture");
  const savedBefore = await readWorkspace(page);
  const expectedDraft = parseDesignDraftDocument(savedBefore.draftDocuments[0].document);
  const svg = page.getByTestId("design-draft-map-svg");
  const path = svg.locator("polyline");
  const summary = page.getByTestId("design-draft-capture-summary");
  const inputs = page.getByTestId("draft-inputs-scroll");
  const toggle = page.getByTestId("draft-inputs-toggle");
  await expect(summary).toHaveText("Unfinished line (3 points)");
  await expect(path).toHaveAttribute("points", "20,-30 80,-90 140,-50");
  await expect(page.getByTestId("draft-undo")).toBeDisabled();

  // Make a real editor history entry while the capture controls have room.
  // No map clicks are needed under the overlapping HUD on a short viewport.
  await page.getByRole("button", { name: "Remove last captured point", exact: true }).click();
  await expect(summary).toHaveText("Unfinished line (2 points)");
  await expect(path).toHaveAttribute("points", "20,-30 80,-90");
  const initialViewBox = await svg.getAttribute("viewBox");
  await page.getByTestId("design-draft-zoom-in").click();
  await expect(svg).not.toHaveAttribute("viewBox", initialViewBox!);
  const retainedViewBox = (await svg.getAttribute("viewBox"))!;
  const [x, y, width, height] = retainedViewBox.split(/\s+/).map(Number);
  const retainedCenter = [x + width / 2, y + height / 2];

  await toggle.click();
  await expect(inputs).toBeVisible();
  await expect(svg).toHaveCount(1);
  await expect(svg).toBeHidden();
  await expect.poll(async () => (await inputs.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(96);
  await toggle.click();
  await expect(inputs).toBeHidden();
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute("viewBox", retainedViewBox);
  await expect(path).toHaveAttribute("points", "20,-30 80,-90");
  await toggle.click();
  await page.setViewportSize({ width: 390, height: 430 });
  await expect(svg).toHaveCount(1);
  await expect(svg).toBeHidden();
  await expect.poll(async () => (await inputs.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(96);

  // Crossing the width breakpoint reveals the same map beside the open inputs.
  await page.setViewportSize({ width: 900, height: 430 });
  await expect(svg).toBeVisible();
  await expect(inputs).toBeVisible();
  await expect(path).toHaveAttribute("points", "20,-30 80,-90");
  await expect.poll(async () => {
    const [left, top, w, h] = (await svg.getAttribute("viewBox"))!.split(/\s+/).map(Number);
    return Math.max(Math.abs(left + w / 2 - retainedCenter[0]), Math.abs(top + h / 2 - retainedCenter[1]));
  }).toBeLessThan(0.000001);
  await page.setViewportSize({ width: 390, height: 430 });
  await expect(svg).toBeHidden();
  await toggle.click();
  await expect(inputs).toBeHidden();
  await expect(svg).toBeVisible();
  await expect(path).toHaveAttribute("points", "20,-30 80,-90");

  // Returning to identical dimensions must restore the entire camera, including zoom.
  await page.setViewportSize(tallViewport);
  await expect(svg).toHaveAttribute("viewBox", retainedViewBox);
  await expect(page.getByTestId("draft-undo")).toBeEnabled();
  expect(await readWorkspace(page)).toEqual(savedBefore);
  await page.getByTestId("draft-undo").click();
  await expect(summary).toHaveText("Unfinished line (3 points)");
  await expect(path).toHaveAttribute("points", "20,-30 80,-90 140,-50");
  await page.getByTestId("draft-redo").click();
  await expect(summary).toHaveText("Unfinished line (2 points)");
  await expect(path).toHaveAttribute("points", "20,-30 80,-90");
  await expect(svg).toHaveAttribute("viewBox", retainedViewBox);

  expectedDraft.drawingWorkflow!.captures[0].vertices.pop();
  await page.getByTestId("draft-save").click();
  await expect.poll(async () => parseDesignDraftDocument((await readWorkspace(page)).draftDocuments[0].document))
    .toEqual(expectedDraft);
  const savedAfter = await readWorkspace(page);
  expect(savedAfter.catalog.designs.find(design => design.id === "human-draft")!.revision)
    .toBeGreaterThan(savedBefore.catalog.designs.find(design => design.id === "human-draft")!.revision);
  expect(savedAfter.projectDocuments).toHaveLength(0);
});


test("unfinished classification retains local name and notes across task navigation and warns before closing", async ({ context, page }) => {
  await open(context, page, true, true);
  await expect(page.getByTestId("drawing-classification-inline")).toBeVisible();
  await page.getByTestId("drawing-details-toggle").click();
  await page.getByTestId("drawing-name").fill("Uncommitted name");
  await page.getByTestId("drawing-notes").fill("Uncommitted notes");
  await page.getByTestId("task-projects").click();
  await expect(page.getByTestId("drawing-classification-inline")).not.toBeVisible();
  await expect(page.getByTestId("draft-discard-confirm")).not.toBeVisible();
  await page.getByTestId("task-design").click();
  await expect(page.getByTestId("drawing-name")).toHaveValue("Uncommitted name");
  await expect(page.getByTestId("drawing-notes")).toHaveValue("Uncommitted notes");
  await page.getByTestId("draft-catalog").click();
  await expect(page.getByTestId("draft-discard-confirm")).toBeVisible();
  await page.getByTestId("draft-discard-cancel").click();
  await expect(page.getByTestId("drawing-name")).toHaveValue("Uncommitted name");
});

test("returning from a sibling customer write refreshes only the draft save receipt", async ({ context, page }) => {
  await open(context, page, true);
  if (!await page.getByTestId("draft-name").isVisible()) await page.getByTestId("draft-inputs-toggle").click();
  await page.getByTestId("draft-name").fill("Retained partial name");
  await page.getByTestId("task-projects").click();
  const original = await readWorkspace(page);
  const sibling = applyWorkspaceCommand(original, { type: "create_client", now, id: "sibling-customer",
    input: { primaryContactFirstName: "Sibling", primaryContactLastName: "Customer" } }).workspace;
  await page.evaluate(({ key, document }) => localStorage.setItem(key, document), { key: workspaceKey, document: serializeWorkspaceDocument(sibling) });
  await page.getByTestId("task-design").click();
  await expect(page.getByTestId("draft-name")).toHaveValue("Retained partial name");
  await page.getByRole("button", { name: "Apply name", exact: true }).click();
  await expect(page.getByTestId("draft-save")).toBeEnabled();
  await page.getByTestId("draft-save").click();
  await expect(page.getByTestId("draft-save-state")).toContainText("Saved");
  const saved = await readWorkspace(page);
  expect(saved.catalog.clients.some(client => client.id === "sibling-customer")).toBe(true);
  expect(parseDesignDraftDocument(saved.draftDocuments[0].document).name).toBe("Retained partial name");
});

test("a foreign save to the same draft blocks overwrite and preserves pending text", async ({ context, page }, testInfo) => {
  await open(context, page, true);
  if (!await page.getByTestId("draft-name").isVisible()) await page.getByTestId("draft-inputs-toggle").click();
  await page.getByTestId("draft-name").fill("My pending local name");
  await page.getByTestId("task-projects").click();
  const workspace = await readWorkspace(page);
  const design = workspace.catalog.designs.find(item => item.id === "human-draft")!;
  const foreign = applyWorkspaceCommand(workspace, { type: "save_design_draft", now, designId: design.id,
    expectedDesignRevision: design.revision, draft: { ...parseDesignDraftDocument(workspace.draftDocuments[0].document), name: "Foreign saved name" } }).workspace;
  await page.evaluate(({ key, document }) => localStorage.setItem(key, document), { key: workspaceKey, document: serializeWorkspaceDocument(foreign) });
  await page.getByTestId("task-design").click();
  await expect(page.getByTestId("draft-receipt-conflict")).toBeVisible();
  await expect(page.getByTestId("draft-name")).toHaveValue("My pending local name");
  const inputs = page.getByTestId("draft-inputs-scroll");
  const svg = page.getByTestId("design-draft-map-svg");
  const name = page.getByTestId("draft-name");
  const apply = page.getByRole("button", { name: "Apply name", exact: true });
  // Preserve the project viewport's original desktop, narrow, or short conflict workflow.
  if ((page.viewportSize()?.height ?? 900) < 650) {
    await expect.poll(async () => (await inputs.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(96);
  }
  expect(await readWorkspace(page)).toEqual(foreign);
  await apply.click({ timeout: 10_000 });
  await expect(page.getByTestId("design-draft-workspace").getByText("My pending local name", { exact: true })).toBeVisible();
  await expect(page.getByTestId("draft-save")).toBeDisabled();
  await expect(page.getByTestId("draft-create-complete")).toBeDisabled();
  expect(await readWorkspace(page)).toEqual(foreign);
  for (const height of [844, 430]) {
    const pendingName = `My pending local name at 390x${height}`;
    await name.fill(pendingName);
    await page.setViewportSize({ width: 390, height });
    // Resize and conflict feedback retain the raw value until an ordinary Apply click succeeds.
    await expect(name).toHaveValue(pendingName);
    await name.focus();
    await expect(name).toBeFocused();
    await expect(svg).toHaveCount(1);
    await expect(svg).toBeHidden();
    await expect.poll(async () => (await inputs.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(96);
    const bounds = await inputs.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    await apply.scrollIntoViewIfNeeded();
    await testInfo.attach(`foreign-save-inputs-390x${height}-before-apply`, {
      body: await page.screenshot(), contentType: "image/png",
    });
    expect(await readWorkspace(page)).toEqual(foreign);
    await apply.click({ timeout: 10_000 });
    await expect(page.getByTestId("design-draft-workspace").getByText(pendingName, { exact: true })).toBeVisible();
    await expect(page.getByTestId("draft-save")).toBeDisabled();
    await expect(page.getByTestId("draft-create-complete")).toBeDisabled();
    expect(await readWorkspace(page)).toEqual(foreign);
  }
});
