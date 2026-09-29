import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { feetToMeters, formatDistanceInputValue, metersToFeet, parseFieldDesignDocument, parseFieldLayoutTarget, sampleProject, type FieldDesign, type FieldPivotMachine } from "../../packages/core/src";
import { buildFieldDesignArchiveBundle, exportFieldDesignArchiveZip, importFieldDesignArchiveZip } from "../../packages/project-store/src/fieldDesignArchive";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { createWebWorkspaceStore } from "../../packages/project-store/src/webWorkspaceStore";
import { readWorkspace, workspaceKey } from "./workspace-fixtures";

const now = "2026-09-27T00:00:00.000Z";
const fieldId = "independent-field";
const designId = "independent-design";
const secondId = "machine-b";
test.use({ actionTimeout: 15_000 });
const browserErrors = new WeakMap<BrowserContext, string[]>();

function sourceFixture() {
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "field-client",
    input: { companyName: "Independent Machine Farm", primaryContactFirstName: "Test", primaryContactLastName: "Operator" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now,
    input: { clientId: "field-client", projectId: "field-folder", projectName: "Machine field", projectCrs: sampleProject.projectCrs,
      unitSystem: sampleProject.unitSystem, fieldMapId: "field-map" } }).workspace;
  const project = { ...structuredClone(sampleProject), id: "source-project", name: "Original saved project" };
  project.machine.endGunAngleRanges = [{ startAngleDegrees: 30, stopAngleDegrees: 75, direction: "clockwise" }];
  workspace = applyWorkspaceCommand(workspace, { type: "save_project", now, project, createOnly: true }).workspace;
  return applyWorkspaceCommand(workspace, { type: "create_design_record", now,
    input: { id: "source-design", fieldMapId: "field-map", pivotProjectId: project.id, name: project.name } }).workspace;
}
function fixture() {
  let workspace = applyWorkspaceCommand(sourceFixture(), { type: "upgrade_workspace_to_v2", now }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "convert_project_to_field_design", now, sourceDesignId: "source-design", expectedDesignRevision: 0,
    designId, fieldMapId: "field-map", name: "Two independent machines", fieldId, waterSourceId: "field-water", powerSourceId: "field-power" }).workspace;
  const field = parseFieldDesignDocument(workspace.fieldDocuments![0].document);
  const first = field.machines[0];
  const second: FieldPivotMachine = { ...structuredClone(first), id: secondId,
    pivotCenter: { x: first.pivotCenter.x + 140, y: first.pivotCenter.y - 70 }, configuration: {
      ...structuredClone(first.configuration), name: "Unequal second pivot", spanLengthsMeters: [31.125, 42.375, 27.0625],
      overhangMeters: 12.875, endGunThrowMeters: 17.625, towerClearanceBufferMeters: 3.75, machineClearanceBufferMeters: 9.125,
      sweep: { mode: "partial_circle", startAngleDegrees: 45, stopAngleDegrees: 270, direction: "counterclockwise" },
    } };
  return applyWorkspaceCommand(workspace, { type: "save_field_design", now, designId, expectedDesignRevision: 0,
    field: { ...field, machines: [first, second] } }).workspace;
}
async function seed(context: BrowserContext) {
  const values = new Map<string, string>();
  const store = createWebWorkspaceStore({ getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, action) => action() }) });
  await store.initializeAsync();
  values.set(workspaceKey, serializeWorkspaceDocument(fixture()));
  await context.addInitScript(({ key, entries }) => {
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    if (localStorage.getItem(key) === null) for (const [name, value] of entries) localStorage.setItem(name, value);
  }, { key: workspaceKey, entries: [...values] });
}
async function openCatalogDesign(page: Page, id = designId) {
  await page.goto("/");
  const resume = await page.evaluate(() => JSON.parse(localStorage.getItem("cplayout-desktop-context-v1") ?? "null"));
  if (!resume?.editorOpen || resume?.context?.designId !== id) {
    const drawer = page.getByRole("button", { name: "Open project drawer" });
    if (await drawer.isVisible()) await drawer.click();
    const open = page.getByTestId(`catalog-design-${id}-open`);
    if (test.info().project.use.hasTouch) await open.tap(); else await open.click();
  }
}
async function openField(page: Page) {
  await openCatalogDesign(page);
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
}
async function storedField(page: Page): Promise<FieldDesign> {
  const workspace = await readWorkspace(page);
  return parseFieldDesignDocument(workspace.fieldDocuments!.find(entry => entry.id === fieldId)!.document);
}
async function applyInputs(page: Page, values: Record<string, string>) {
  // Fixtures state canonical metres; normal machine inputs are feet.
  const lengths = new Set(["x", "y", "spans", "overhang", "endGun", "towerClearance", "machineClearance"]);
  for (const [key, value] of Object.entries(values)) {
    const entered = lengths.has(key) ? value.split(",").map(part => String(metersToFeet(Number(part.trim())))).join(", ") : value;
    await page.getByTestId(`field-input-${key}`).fill(entered);
  }
  await page.getByTestId("field-apply-machine").click();
}
async function save(page: Page) {
  await page.getByTestId("field-save").click();
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
}
async function downloadBytes(page: Page, command: string): Promise<Buffer> {
  const pending = page.waitForEvent("download");
  await page.getByTestId(command).click();
  const download = await pending;
  return readFile((await download.path())!);
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const errors: string[] = [];
  browserErrors.set(context, errors);
  const observe = (tab: Page) => tab.on("pageerror", error => errors.push(error.message));
  observe(page); context.on("page", observe);
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
  await seed(context);
});
test.afterEach(async ({ context }) => { expect(browserErrors.get(context) ?? []).toEqual([]); });

test("independent edits autosave, reopen, undo, redo and export without changing siblings or the original project", async ({ page }, info) => {
  await openField(page);
  await expect(page.getByTestId("field-autosave").getByRole("switch")).toBeChecked();
  const initial = await storedField(page);
  const originalWorkspace = await readWorkspace(page);
  await page.getByTestId(`field-machine-${secondId}`).click();
  const editedCenter = { x: initial.machines[1].pivotCenter.x + 15.25, y: initial.machines[1].pivotCenter.y + 7.5 };
  await applyInputs(page, { spans: "35.125, 44.375, 29.0625", x: String(editedCenter.x), y: String(editedCenter.y), overhang: "14.875" });
  await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  const edited = await storedField(page);
  expect(edited.machines[0]).toEqual(initial.machines[0]);
  // Explicitly edited values traverse the feet input conversion; untouched fields remain byte-exact.
  const enteredMeters = (value: number) => feetToMeters(metersToFeet(value));
  expect(edited.machines[1]).toEqual({ ...initial.machines[1], pivotCenter: { x: enteredMeters(editedCenter.x), y: enteredMeters(editedCenter.y) }, configuration: {
    ...initial.machines[1].configuration, spanLengthsMeters: [35.125, 44.375, 29.0625].map(enteredMeters), overhangMeters: enteredMeters(14.875) } });
  expect((await readWorkspace(page)).projectDocuments).toEqual(originalWorkspace.projectDocuments);
  await openField(page);
  await page.getByTestId(`field-machine-${secondId}`).click();
  await expect(page.getByTestId("field-input-spans")).toHaveValue([35.125, 44.375, 29.0625].map(value => formatDistanceInputValue(value, "us_survey_feet")).join(", "));
  await expect(page.getByTestId("field-input-x")).toHaveValue(formatDistanceInputValue(editedCenter.x, "us_survey_feet"));
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  await applyInputs(page, { endGun: "22.625" });
  await page.getByTestId("field-undo").click();
  await expect(page.getByTestId("field-input-endGun")).toHaveValue(formatDistanceInputValue(17.625, "us_survey_feet"));
  await page.getByTestId("field-redo").click();
  await expect(page.getByTestId("field-input-endGun")).toHaveValue(formatDistanceInputValue(22.625, "us_survey_feet"));
  await save(page);
  const saved = await storedField(page);
  const archive = importFieldDesignArchiveZip(await downloadBytes(page, "field-export"));
  expect(archive.field).toEqual(saved);
  expect(archive.originalProjectDocument).toBe(originalWorkspace.projectDocuments[0].document);
  expect(saved.machines[0]).toEqual(initial.machines[0]);
  expect(saved.machines[1].configuration.endGunAngleRanges).toEqual(initial.machines[1].configuration.endGunAngleRanges);
  expect(saved.machines[1].configuration.sweep).toEqual(initial.machines[1].configuration.sweep);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.getByTestId(page.viewportSize()!.width < 850 ? "field-machine-form" : "field-location-diagram").evaluate(node => node.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: info.outputPath("independent-field-saved.png"), fullPage: true });
  await writeFigureMarks(page, info.outputPath("independent-field-saved.json"), ["field-save-state", "field-machine-machine-b", "field-input-spans"]);
});

test("copy selected exactly creates a separate machine whose later edits and removal retain both siblings", async ({ page }) => {
  await openField(page);
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  const before = await storedField(page);
  await page.getByTestId(`field-machine-${secondId}`).click();
  await page.getByTestId("field-copy-machine").click();
  await save(page);
  const copied = (await storedField(page)).machines.find(machine => !before.machines.some(existing => existing.id === machine.id))!;
  expect({ ...copied, id: secondId }).toEqual(before.machines[1]);
  await applyInputs(page, { name: "Separate copied pivot", spans: "20.5, 31.25", x: String(copied.pivotCenter.x + 80) });
  await save(page);
  const changed = await storedField(page);
  expect(changed.machines.slice(0, 2)).toEqual(before.machines);
  expect(changed.machines[2].configuration.spanLengthsMeters).toEqual([20.5, 31.25]);
  expect(changed.machines[2].pivotCenter.x).toBe(copied.pivotCenter.x + 80);
  await page.getByTestId(`field-remove-${copied.id}`).click();
  await page.getByTestId("field-remove-confirm-confirm").click();
  await save(page);
  expect((await storedField(page)).machines).toEqual(before.machines);
  await page.getByTestId("field-undo").click();
  await save(page);
  expect((await storedField(page)).machines).toEqual(changed.machines);
});

test("stale field tabs retain edits but cannot overwrite a newer field save", async ({ page, context }) => {
  await openField(page);
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  const second = await context.newPage();
  try {
    await openField(second);
    await second.getByTestId("field-autosave").getByRole("switch").uncheck();
    await applyInputs(page, { name: "Acknowledged first-tab edit" });
    await save(page);
    const saved = await readWorkspace(page);
    await second.getByTestId(`field-machine-${secondId}`).click();
    await applyInputs(second, { name: "Retained stale-tab edit" });
    await second.getByTestId("field-save").click();
    await expect(second.getByTestId("field-feedback")).toContainText("revision changed");
    await expect(second.getByTestId("field-receipt-conflict")).toContainText("saved field changed");
    for (let attempt = 0; attempt < 2; attempt++) {
      await second.getByTestId("field-conflict-recheck").click();
      await expect(second.getByTestId("field-receipt-conflict")).toContainText("saved field changed");
      await expect(second.getByTestId("field-save")).toBeDisabled();
      await expect(second.getByTestId("field-save-state")).toContainText("Unsaved");
      await expect(second.getByTestId("field-input-name")).toHaveValue("Retained stale-tab edit");
      expect(await readWorkspace(second)).toEqual(saved);
    }
  } finally { await second.close(); }
});

test("frozen layout export retains its original selected machine and all field bytes after later edits", async ({ page }) => {
  await openField(page);
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  await page.getByTestId(`field-machine-${secondId}`).click();
  const before = await storedField(page);
  await page.getByTestId("field-calculate").click();
  await expect(page.getByTestId("field-calculation-result")).toContainText("Coverage:");
  await page.getByTestId("field-freeze-target").click();
  const first = await downloadBytes(page, "field-export-target");
  const target = parseFieldLayoutTarget(first.toString("utf8"));
  expect(target.field).toEqual(before);
  expect(target.source.selectedMachineIds).toEqual([secondId]);
  expect(target.qualification).toBe("design_snapshot_only");
  await applyInputs(page, { name: "Later design revision", spans: "20.125, 25.875" });
  await save(page);
  await expect(page.getByTestId("field-calculation-result")).toHaveCount(0);
  await expect(page.getByTestId("field-freeze-target")).toBeDisabled();
  await expect(page.getByTestId("field-frozen-target")).toContainText("Earlier design retained");
  expect(await downloadBytes(page, "field-export-target")).toEqual(first);
  expect((await storedField(page)).machines[1].configuration.name).toBe("Later design revision");
});

test("machine-plan import requires explicit replacement permission and becomes stale after editing", async ({ page }) => {
  await openField(page);
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  const before = await storedField(page);
  const original = (await readWorkspace(page)).fieldDocuments![0].originalProjectDocument;
  const proposed = { ...before, machines: before.machines.map(machine => machine.id !== secondId ? machine : {
    ...machine, configuration: { ...machine.configuration, name: "Reviewed imported machine" } }) };
  const bytes = exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(proposed, now, original));
  const importPlan = async () => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByTestId("field-import-plan").click();
    await (await chooser).setFiles({ name: "field-plan.zip", mimeType: "application/zip", buffer: Buffer.from(bytes) });
    await expect(page.getByTestId("field-plan-review")).toBeVisible();
  };
  await importPlan();
  await page.getByTestId("field-adopt-plan").click();
  await expect(page.getByTestId("field-feedback")).toContainText("Allow replacement of the affected machine");
  expect(await storedField(page)).toEqual(before);
  await page.getByTestId(`field-unlock-${secondId}`).getByRole("switch").check();
  await page.getByTestId("field-adopt-plan").click();
  await expect(page.getByTestId("field-plan-review")).toHaveCount(0);
  await save(page);
  expect(await storedField(page)).toEqual(proposed);
  await importPlan();
  await applyInputs(page, { name: "Newer field edit" });
  await expect(page.getByTestId("field-adopt-plan")).toBeDisabled();
  await expect(page.getByTestId("field-plan-review")).toContainText("field changed");
  await page.getByTestId("field-discard-plan").click();
});

test("saved project command creates a field copy and retains the original project document", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(({ key, document }) => localStorage.setItem(key, document), { key: workspaceKey, document: serializeWorkspaceDocument(sourceFixture()) });
  await openCatalogDesign(page, "source-design");
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const before = await readWorkspace(page);
  const closeDrawer = page.getByRole("button", { name: /^(Close|Collapse) project drawer$/ });
  if (await closeDrawer.isVisible()) await closeDrawer.click();
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-create-independent-field").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  const after = await readWorkspace(page);
  expect(after.workspaceVersion).toBe("cplayout-workspace-v2");
  expect(after.projectDocuments.map(entry => entry.document)).toEqual(before.projectDocuments.map(entry => entry.document));
  expect(after.fieldDocuments).toHaveLength(1);
  expect(after.fieldDocuments![0].originalProjectDocument).toBe(before.projectDocuments[0].document);
  const field = parseFieldDesignDocument(after.fieldDocuments![0].document);
  expect(field.id).not.toBe("source-project");
  expect(field.machines[0].configuration.spanLengthsMeters).toEqual(sampleProject.machine.spanLengthsMeters);
  expect(field.fieldBoundary).toEqual(sampleProject.fieldBoundary);
});

test("field search keeps saved machines pinned, requires adoption and rejects an earlier revision", async ({ page }, info) => {
  await page.goto("/");
  let workspace = fixture();
  const loaded = parseFieldDesignDocument(workspace.fieldDocuments![0].document);
  const field = { ...loaded, obstacles: [], machines: loaded.machines.map((machine, index) => ({
    ...machine, pivotCenter: { x: loaded.machines[0].pivotCenter.x + index * 200, y: loaded.machines[0].pivotCenter.y },
    configuration: { ...machine.configuration, spanLengthsMeters: [index ? 25 : 40], overhangMeters: 0, endGunThrowMeters: 0,
      machineClearanceBufferMeters: 2, towerClearanceBufferMeters: 2, sweep: { mode: "full_circle" as const }, endGunAngleRanges: [] },
  })) };
  workspace = applyWorkspaceCommand(workspace, { type: "save_field_design", now, designId, expectedDesignRevision: 1, field }).workspace;
  await page.evaluate(({ key, document }) => localStorage.setItem(key, document), { key: workspaceKey, document: serializeWorkspaceDocument(workspace) });
  await openField(page);
  const before = await storedField(page);
  await page.getByTestId("field-search-run").click();
  await expect(page.getByTestId("field-search-result")).toContainText("Search completed");
  await expect(page.getByTestId("field-search-result")).toContainText("2 machines");
  await expect(page.getByTestId("field-search-result")).toContainText("Equipment cost: Unavailable");
  expect(await storedField(page)).toEqual(before);
  await expect(page.getByTestId("field-search-adopt")).toBeEnabled();
  await applyInputs(page, { name: "Changed after layout review" });
  await expect(page.getByTestId("field-search-result")).toContainText("field changed");
  await expect(page.getByTestId("field-search-adopt")).toBeDisabled();
  await save(page);
  await page.getByTestId("field-search-run").click();
  await expect(page.getByTestId("field-search-adopt")).toBeEnabled();
  const current = await storedField(page);
  await page.getByTestId("field-search-adopt").click();
  await expect(page.getByTestId("field-search-result")).toHaveCount(0);
  await save(page);
  expect((await storedField(page)).machines).toEqual(current.machines);
  await page.getByTestId("field-search-run").click();
  await expect(page.getByTestId("field-search-adopt")).toBeEnabled();
  await page.getByTestId("field-search-result").evaluate(node => node.scrollIntoView({ block: "end" }));
  await page.screenshot({ path: info.outputPath("field-layout-review.png"), fullPage: true });
  await writeFigureMarks(page, info.outputPath("field-layout-review.json"), ["field-search-result", "field-search-adopt"]);
});

test("saved lateral uses its explicit straight travel model and stays outside pivot search", async ({ page }) => {
  await page.goto("/");
  let workspace = fixture();
  const loaded = parseFieldDesignDocument(workspace.fieldDocuments![0].document);
  const center = loaded.machines[0].pivotCenter;
  const field: FieldDesign = { ...loaded, lateralMachines: [{ id: "straight-lateral", kind: "straight_lateral", name: "Straight lateral review",
    leftExtentMeters: 31.125, rightExtentMeters: 27.375, travelHeadingDegrees: 0,
    travel: { start: center, end: { x: center.x + 100, y: center.y } }, machineClearanceBufferMeters: 1,
    waterSourceId: loaded.machines[0].waterSourceId }] };
  workspace = applyWorkspaceCommand(workspace, { type: "save_field_design", now, designId, expectedDesignRevision: 1, field }).workspace;
  await page.evaluate(({ key, document }) => localStorage.setItem(key, document), { key: workspaceKey, document: serializeWorkspaceDocument(workspace) });
  await openField(page);
  await expect(page.getByTestId("field-laterals")).toContainText("Straight lateral review");
  await page.getByTestId("field-lateral-calculate-straight-lateral").click();
  await expect(page.getByTestId("field-lateral-result-straight-lateral")).toContainText("1.45 acres");
  await expect(page.getByTestId("field-lateral-result-straight-lateral")).toContainText("unknown without sprinkler reach");
  await page.getByTestId("field-search-run").click();
  await expect(page.getByTestId("field-search-result")).toContainText("Inputs need attention");
  expect(await storedField(page)).toEqual(field);
  const archive = importFieldDesignArchiveZip(await downloadBytes(page, "field-export"));
  expect(archive.field.lateralMachines).toEqual(field.lateralMachines);
});

async function writeFigureMarks(page: Page, file: string, ids: string[]) {
  const viewport = page.viewportSize()!;
  const marks = [];
  for (const id of ids) {
    const box = await page.getByTestId(id).boundingBox();
    const exposed = box && await page.getByTestId(id).evaluate(node => {
      const r = node.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return top !== null && (node === top || node.contains(top));
    });
    if (exposed && box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1) marks.push({ id, ...box });
  }
  await writeFile(file, JSON.stringify({ viewport, marks }, null, 2));
}
