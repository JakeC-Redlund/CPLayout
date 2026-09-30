import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  convertPivotProjectToFieldDesign, createFieldLayoutTarget, formatDistance, parseFieldDesignDocument, parseLayoutSessionDocument,
  sampleProject, serializeFieldLayoutTarget, serializeLayoutSessionDocument, serializeProjectDocument,
} from "../../packages/core/src";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { createWebWorkspaceStore } from "../../packages/project-store/src/webWorkspaceStore";
import { buildFieldDesignArchiveBundle, exportFieldDesignArchiveZip } from "../../packages/project-store/src/fieldDesignArchive";
import { connectOperationalReceiver, emitGga, gga, installOperationalReceiver, type ReceiverFixtureWindow } from "./operational-receiver-fixture";
import { readWorkspace, workspaceKey } from "./workspace-fixtures";

// Synthetic browser proof only: no physical receiver or field accuracy claim.
test.beforeEach(async ({ context, baseURL }) => {
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
});
async function survey(page: Page) {
  await installOperationalReceiver(page);
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("task-survey").click();
}
async function seedLayout(context: BrowserContext, withDesign = false, withOtherField = false, smallSearchFixture = false) {
  const now = "2026-09-29T12:00:00.000Z";
  let workspace = emptyWorkspaceDocument();
  workspace = applyWorkspaceCommand(workspace, { type: "create_client", now, id: "field-ops-customer", input: { primaryContactFirstName: "Field", primaryContactLastName: "Operator" } }).workspace;
  workspace = applyWorkspaceCommand(workspace, { type: "create_project_with_initial_field_map", now, input: {
    clientId: "field-ops-customer", projectId: "field-ops-project", projectName: "Field operations", projectCrs: sampleProject.projectCrs,
    unitSystem: "us_survey_feet", fieldMapId: "field-ops-field", fieldMapName: "North field",
  } }).workspace;
  if (withOtherField) workspace = applyWorkspaceCommand(workspace, { type: "create_field_map_record", now,
    input: { id: "field-ops-other-field", projectId: "field-ops-project", name: "South field" } }).workspace;
  if (withDesign) {
    workspace = applyWorkspaceCommand(workspace, { type: "save_project", now, project: sampleProject, createOnly: true }).workspace;
    workspace = applyWorkspaceCommand(workspace, { type: "create_design_record", now, input: {
      id: "field-ops-source", fieldMapId: "field-ops-field", pivotProjectId: sampleProject.id, name: sampleProject.name,
    } }).workspace;
    workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v2", now }).workspace;
    workspace = applyWorkspaceCommand(workspace, { type: "convert_project_to_field_design", now, sourceDesignId: "field-ops-source", expectedDesignRevision: 0,
      designId: "field-ops-design", fieldMapId: "field-ops-field", name: "Field operations design", fieldId: "field-ops-target", waterSourceId: "field-ops-water", powerSourceId: "field-ops-power" }).workspace;
    if (smallSearchFixture) {
      const field = parseFieldDesignDocument(workspace.fieldDocuments![0].document);
      workspace = applyWorkspaceCommand(workspace, { type: "save_field_design", now, designId: "field-ops-design", expectedDesignRevision: 0,
        field: { ...field, obstacles: [], machines: field.machines.map(machine => ({ ...machine, configuration: { ...machine.configuration,
          spanLengthsMeters: [40], overhangMeters: 0, endGunThrowMeters: 0, towerClearanceBufferMeters: 2, machineClearanceBufferMeters: 2,
          sweep: { mode: "full_circle" }, endGunAngleRanges: [] } })) } }).workspace;
    }
  }
  workspace = applyWorkspaceCommand(workspace, { type: "upgrade_workspace_to_v3", now }).workspace;
  const field = withDesign ? parseFieldDesignDocument(workspace.fieldDocuments![0].document)
    : convertPivotProjectToFieldDesign(serializeProjectDocument(sampleProject), { fieldId: "field-ops-target", waterSourceId: "field-ops-water", powerSourceId: "field-ops-power" }).field;
  const targetDocument = serializeFieldLayoutTarget(createFieldLayoutTarget(field, { inputRevision: 1, expectedRevision: 1, selectedMachineIds: [field.machines[0].id] }));
  workspace = applyWorkspaceCommand(workspace, { type: "create_layout_session", now, sessionId: "field-ops-session", fieldMapId: "field-ops-field", name: "North field observations", targetDocument }).workspace;
  const values = new Map<string, string>();
  await createWebWorkspaceStore({ getStorage: () => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } }),
    getLocks: () => ({ request: async (_name, _options, action) => action() }) }).initializeAsync();
  values.set(workspaceKey, serializeWorkspaceDocument(workspace));
  await context.addInitScript(({ key, entries }) => {
    if (location.protocol.startsWith("http") && localStorage.getItem(key) === null) for (const [name, value] of entries) localStorage.setItem(name, value);
  }, { key: workspaceKey, entries: [...values] });
  return targetDocument;
}
async function layout(page: Page) {
  await installOperationalReceiver(page);
  await page.goto("/");
  await page.getByTestId("task-layout").click();
  await page.getByTestId("layout-associate-field-ops-field").click();
  await page.getByTestId("layout-open-field-ops-session").click();
  await expect(page.getByTestId("layout-session-workspace")).toBeVisible();
}

// Exercise normal wheel navigation in the short editor body; never force clicks or move the DOM.
async function reachFieldReviewItem(page: Page, target: Locator) {
  const body = page.getByTestId("field-content-scroll");
  const bodyBox = await body.boundingBox(); const viewport = page.viewportSize()!;
  expect(bodyBox).not.toBeNull(); expect(bodyBox!.height).toBeGreaterThanOrEqual(96);
  expect(bodyBox!.y).toBeGreaterThanOrEqual(0); expect(bodyBox!.y + bodyBox!.height).toBeLessThanOrEqual(viewport.height);
  await expect.poll(async () => {
    const frame = await body.boundingBox(); const item = await target.boundingBox();
    if (!frame || !item) return false;
    if (item.y >= frame.y && item.y + item.height <= frame.y + frame.height) return true;
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.mouse.wheel(0, (item.y < frame.y ? -1 : 1) * Math.max(16, (frame.height - item.height) * 0.75));
    return false;
  }, { message: "Review preview, value, or adoption command is reachable by normal wheel scrolling", intervals: [100], timeout: 15_000 }).toBe(true);
  await expect(target).toBeInViewport({ ratio: 1 });
  const box = await target.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
}

test("Survey purpose changes preserve captured geometry and allow recorded boundary application disconnected", async ({ page }) => {
  await survey(page);
  await expect(page.getByTestId("survey-purpose-point")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("survey-boundary-controls")).toHaveCount(0);
  await connectOperationalReceiver(page);
  await page.getByTestId("survey-purpose-boundary").click();
  for (let index = 0; index < 3; index++) {
    await emitGga(page, gga(`12000${index}.00`, 4, "GNGGA", index === 0 ? "4042.5900" : "4042.5960", index === 2 ? "10458.9940" : "10459.0000"));
    await page.getByRole("button", { name: `Add Boundary (${index})`, exact: true }).click();
  }
  await page.getByTestId("survey-purpose-feature").click();
  await expect(page.getByTestId("survey-boundary-controls")).toHaveCount(0);
  await page.getByTestId("survey-purpose-boundary").click();
  await expect(page.getByRole("button", { name: "Add Boundary (3)", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add Boundary (3)", exact: true })).toBeDisabled();
  await expect(page.getByTestId("rtk-gate-badge")).toHaveText("Live capture unavailable");
  await expect(page.getByTestId("survey-recorded-shape-help")).toContainText("can still be applied");
  const apply = page.getByRole("button", { name: "Use captured boundary in this design", exact: true });
  await expect(apply).toBeEnabled(); await apply.click();
  await expect(page.getByTestId("rtk-status")).toContainText("boundary ring committed");
  await expect(page.getByRole("button", { name: "Add Boundary (0)", exact: true })).toBeDisabled();
});

test("Survey retains feature classification and communications text through purpose and settings changes", async ({ page }) => {
  await survey(page);
  await page.getByLabel("Baud rate", { exact: true }).fill("57600");
  await page.getByTestId("receiver-settings-toggle").click();
  await page.getByTestId("survey-purpose-feature").click();
  await page.getByTestId("receiver-settings-toggle").click();
  await expect(page.getByLabel("Baud rate", { exact: true })).toHaveValue("57600");
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.requestCount)).toBe(0);
  await connectOperationalReceiver(page); await emitGga(page, gga());
  await page.getByRole("button", { name: "Add Feature Vertex (0)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Planning boundary", exact: true })).toBeDisabled();
  await page.getByTestId("survey-purpose-point").click();
  await page.getByTestId("survey-purpose-feature").click();
  await expect(page.getByRole("button", { name: "Add Feature Vertex (1)", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Pipe line", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Layout keeps collection reachable and reports session blockers independently from receiver position", async ({ page, context }) => {
  const targetDocument = await seedLayout(context); await layout(page);
  const layoutWorkspace = page.locator('[data-testid="layout-session-workspace"]:visible');
  await expect(layoutWorkspace.getByTestId("receiver-settings")).toBeVisible();
  await expect(page.getByTestId("layout-export-json")).toHaveCount(0);
  await connectOperationalReceiver(page); await emitGga(page, gga());
  await expect(layoutWorkspace.getByTestId("receiver-collection-readiness")).toHaveText("Receiver position available");
  await layoutWorkspace.getByTestId("receiver-settings-toggle").click();
  const label = page.getByTestId("layout-observation-label");
  await label.fill("North corner");
  for (const viewport of [{ width: 390, height: 600 }, { width: 900, height: 420 }]) {
    await page.setViewportSize(viewport);
    const box = await page.getByTestId("layout-collect").boundingBox();
    expect(box).not.toBeNull(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.evaluate(async () => {
    await new Promise<void>(acquired => {
      void navigator.locks.request("cplayout:workspace:writer:v1", async () => {
        await new Promise<void>(release => { (window as Window & { releaseFieldOpsLock?: () => void }).releaseFieldOpsLock = release; acquired(); });
      });
    });
  });
  try {
    await page.getByTestId("layout-collect").click();
    await expect(page.getByTestId("layout-collection-readiness")).toContainText("Wait before collecting");
    await expect(page.getByTestId("layout-collect")).toBeDisabled();
    await expect(layoutWorkspace.getByTestId("receiver-collection-readiness")).toHaveText("Receiver position available");
    await page.evaluate(() => { (window as ReceiverFixtureWindow).operationalReceiver.nowMs += 2001; });
  } finally {
    await page.evaluate(() => (window as Window & { releaseFieldOpsLock?: () => void }).releaseFieldOpsLock?.());
  }
  const footerFeedback = page.getByTestId("layout-collection").getByTestId("layout-collection-feedback");
  await expect(footerFeedback).toContainText("Observation not saved");
  await expect(footerFeedback).toContainText("retry Collect and save observation");
  await expect(label).toHaveValue("North corner");
  expect(parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document).observations).toEqual([]);
  await emitGga(page, gga("120003.00"));
  await expect(page.getByTestId("layout-collect")).toBeEnabled();
  await expect(footerFeedback).toContainText("Observation not saved");
  await page.getByTestId("layout-collect").click();
  await expect(footerFeedback).toContainText("Saved North corner");
  await expect(page.getByTestId("layout-collection-readiness")).toContainText("already saved");
  await expect(page.getByTestId("layout-collect")).toBeDisabled();
  const saved = parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document);
  expect(saved.targetDocument).toBe(targetDocument); expect(saved.observations).toHaveLength(1); expect(saved.observations[0].label).toBe("North corner");
  await label.fill("Retained through connection loss"); await label.focus();
  await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.end());
  await expect(layoutWorkspace.getByTestId("receiver-settings-toggle")).toContainText("Reconnect");
  await expect(layoutWorkspace.getByTestId("receiver-settings")).toHaveCount(0);
  await expect(label).toBeFocused(); await expect(label).toHaveValue("Retained through connection loss");
  await label.fill("");
  await page.getByTestId("layout-session-actions-toggle").click();
  const download = page.waitForEvent("download"); await page.getByTestId("layout-export-json").click();
  const exported = parseLayoutSessionDocument(await readFile((await (await download).path())!, "utf8"));
  expect(exported.targetDocument).toBe(targetDocument); expect(exported.observations).toEqual(saved.observations);
  await page.getByTestId("layout-archive").click();
  await page.getByTestId("layout-archive-confirm").getByRole("button", { name: "Archive session", exact: true }).click();
  await expect(page.getByTestId("layout-collection-readiness")).toContainText("Restore this session");
  await expect(page.getByTestId("layout-collect")).toBeDisabled();
});

test("Layout close cancellation and task switches retain copy names and raw labels", async ({ page, context }) => {
  await seedLayout(context); await layout(page);
  const before = await readWorkspace(page);
  await page.getByTestId("layout-session-actions-toggle").click();
  await page.getByTestId("layout-copy-name").fill("  Next crew session  ");
  await page.getByTestId("layout-workspace-back").click();
  await expect(page.getByTestId("layout-close-confirm")).toBeVisible();
  await page.getByTestId("layout-close-confirm-cancel").click();
  await expect(page.getByTestId("layout-copy-name")).toHaveValue("  Next crew session  ");
  await page.getByTestId("layout-observation-label").fill("   ");
  await page.getByTestId("task-survey").click();
  await expect(page.getByTestId("layout-close-confirm")).toHaveCount(0);
  await page.getByTestId("task-layout").click();
  await expect(page.getByTestId("layout-copy-name")).toHaveValue("  Next crew session  ");
  await expect(page.getByTestId("layout-observation-label")).toHaveValue("   ");
  await page.getByTestId("layout-copy-name").fill("North field observations copy");
  await page.getByTestId("layout-workspace-back").click();
  await expect(page.getByTestId("layout-close-confirm")).toBeVisible();
  await page.getByTestId("layout-close-confirm-cancel").click();
  await expect(page.getByTestId("layout-observation-label")).toHaveValue("   ");
  expect(await readWorkspace(page)).toEqual(before);
});

test("Layout target review retains unfinished work until explicit confirmed close retires it", async ({ page, context }) => {
  const targetDocument = await seedLayout(context, true); await layout(page);
  await page.getByTestId("layout-workspace-back").click();
  await page.getByTestId("layout-associate-field-ops-field").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("layout-import").click();
  await (await chooser).setFiles({ name: "retained-target.json", mimeType: "application/json", buffer: Buffer.from(targetDocument) });
  await expect(page.getByTestId("layout-import-review")).toBeVisible();
  await page.getByTestId("layout-new-name").fill("  Unfinished field review  ");
  const before = await readWorkspace(page);
  const beforeBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await page.getByTestId("task-projects").click();
  await expect(page.getByTestId("layout-catalog-close-confirm")).toHaveCount(0);
  await page.getByTestId("task-layout").click();
  await expect(page.getByTestId("layout-new-name")).toHaveValue("  Unfinished field review  ");
  await expect(page.getByTestId("layout-associate-field-ops-field")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("layout-catalog-back").click();
  await expect(page.getByTestId("layout-catalog-close-confirm")).toBeVisible();
  await page.getByTestId("layout-catalog-close-confirm-cancel").click();
  await expect(page.getByTestId("layout-new-name")).toHaveValue("  Unfinished field review  ");
  await expect(page.getByTestId("layout-import-review")).toBeVisible();
  expect(await readWorkspace(page)).toEqual(before);
  // Opening an existing session does not consume the unfinished import review.
  await page.getByTestId("layout-open-field-ops-session").click();
  await expect(page.getByTestId("layout-session-workspace")).toBeVisible();
  await page.getByTestId("layout-workspace-back").click();
  await expect(page.getByTestId("layout-new-name")).toHaveValue("  Unfinished field review  ");
  await page.getByTestId("layout-catalog-back").click();
  await page.getByTestId("layout-catalog-close-confirm").getByRole("button", { name: "Leave import review", exact: true }).click();
  await expect(page.getByTestId("layout-session-catalog")).toHaveCount(0);
  await page.getByTestId("task-layout").click();
  await expect(page.getByTestId("layout-session-catalog")).toBeVisible();
  await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
  await expect(page.getByTestId("layout-catalog-close-confirm")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
  await prepareDesignTarget(page);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
});

async function prepareDesignTarget(page: Page) {
  await page.getByTestId("task-projects").click();
  await openProjectDrawer(page);
  await page.getByTestId("catalog-design-field-ops-design-open").click();
  await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  await page.getByTestId("field-calculate").click();
  await page.getByTestId("field-freeze-target").click();
  await page.getByTestId("field-open-layout").click();
  await expect(page.getByTestId("task-layout")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("layout-import-review")).toBeVisible();
  await expect(page.getByTestId("layout-new-name")).toHaveValue("Field operations design Layout");
}

async function openProjectDrawer(page: Page) {
  const drawer = page.getByRole("button", { name: "Open project drawer", exact: true });
  if (await drawer.isVisible()) await drawer.click();
}

for (const operation of ["create", "import"] as const) {
  test(`Layout ${operation} success consumes the submitted review and permits the next design target`, async ({ context, page }) => {
    await seedLayout(context, true);
    await page.goto("/");
    const before = await readWorkspace(page);
    if (operation === "create") {
      await prepareDesignTarget(page);
      await page.getByTestId("layout-new-name").fill("Saved review session");
    } else {
      await page.getByTestId("task-layout").click();
      await page.getByTestId("layout-associate-field-ops-field").click();
      const imported = { ...parseLayoutSessionDocument(before.layoutSessions![0].document), id: "imported-field-ops-session", name: "Saved review session" };
      const choosing = page.waitForEvent("filechooser");
      await page.getByTestId("layout-import").click();
      await (await choosing).setFiles({ name: "session.json", mimeType: "application/json", buffer: Buffer.from(serializeLayoutSessionDocument(imported)) });
    }
    await page.getByTestId("layout-save-new").click();
    await expect(page.getByTestId("layout-session-workspace")).toBeVisible();
    const saved = await readWorkspace(page);
    expect(saved.revision).toBe(before.revision + 1);
    expect(saved.layoutSessions).toHaveLength(before.layoutSessions!.length + 1);
    expect(saved.fieldDocuments).toEqual(before.fieldDocuments);
    expect(saved.projectDocuments).toEqual(before.projectDocuments);
    expect(saved.catalog).toEqual(before.catalog);
    const savedBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
    await page.getByTestId("layout-workspace-back").click();
    await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
    await expect(page.getByTestId("layout-catalog-close-confirm")).toHaveCount(0);
    await prepareDesignTarget(page);
    expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
  });
}

type LayoutReviewTestWindow = Window & { releaseReviewWriter?: () => void; restoreReviewWrites?: () => void };
const reviewWriterLock = "cplayout:workspace:writer:v1";

test("Layout save completing while hidden retires only its review without opening or duplicating a session", async ({ context, page }) => {
  await seedLayout(context, true); await page.goto("/");
  await prepareDesignTarget(page);
  await page.getByTestId("layout-new-name").fill("Saved while checking Design");
  const before = await readWorkspace(page);
  await page.evaluate(async lock => {
    await new Promise<void>(acquired => {
      void navigator.locks.request(lock, () => new Promise<void>(release => {
        (window as LayoutReviewTestWindow).releaseReviewWriter = release; acquired();
      }));
    });
  }, reviewWriterLock);
  try {
    await page.getByTestId("layout-save-new").click();
    await expect.poll(() => page.evaluate(async lock => (await navigator.locks.query()).pending?.filter(item => item.name === lock).length ?? 0, reviewWriterLock)).toBe(1);
    await page.getByTestId("task-design").click();
    await expect(page.getByTestId("field-design-workspace")).toBeVisible();
  } finally {
    await page.evaluate(() => (window as LayoutReviewTestWindow).releaseReviewWriter?.());
    await page.evaluate(lock => navigator.locks.request(lock, () => undefined), reviewWriterLock);
  }
  await expect.poll(async () => (await readWorkspace(page)).layoutSessions?.length).toBe(before.layoutSessions!.length + 1);
  await expect(page.getByTestId("task-design")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("layout-session-workspace")).toHaveCount(0);
  // Confirm the saved-target receipt reached the retained design even without session activation.
  await expect(page.getByTestId("field-freeze-target")).toBeEnabled();
  const savedBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await page.getByTestId("task-layout").click();
  await expect(page.getByTestId("layout-session-catalog")).toBeVisible();
  await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
  await expect(page.getByTestId("layout-save-new")).toHaveCount(0);
  await expect(page.getByTestId("layout-catalog-back")).toBeEnabled();
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
  await prepareDesignTarget(page);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(savedBytes);
});

test("failed Layout save retains raw review and association through task switches, then succeeds once", async ({ context, page }) => {
  await seedLayout(context, true); await page.goto("/"); await prepareDesignTarget(page);
  await page.getByTestId("layout-new-name").fill("  Retry this target  ");
  const before = await readWorkspace(page);
  const beforeBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    (window as LayoutReviewTestWindow).restoreReviewWrites = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Synthetic Layout quota failure", "QuotaExceededError");
      original.call(this, name, value);
    };
  }, workspaceKey);
  try {
    await page.getByTestId("layout-save-new").click();
    await expect(page.getByTestId("layout-catalog-feedback")).toContainText(/quota/i);
    await expect(page.getByTestId("layout-save-new")).toBeEnabled();
    await page.getByTestId("task-design").click();
    await page.getByTestId("task-layout").click();
    await expect(page.getByTestId("layout-new-name")).toHaveValue("  Retry this target  ");
    await expect(page.getByTestId("layout-associate-field-ops-field")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("layout-session-workspace")).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
  } finally {
    await page.evaluate(() => (window as LayoutReviewTestWindow).restoreReviewWrites?.());
  }
  await page.getByTestId("layout-save-new").click();
  await expect(page.getByTestId("layout-session-workspace")).toBeVisible();
  const saved = await readWorkspace(page);
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.layoutSessions).toHaveLength(before.layoutSessions!.length + 1);
  expect(saved.fieldDocuments).toEqual(before.fieldDocuments);
  await page.getByTestId("layout-workspace-back").click();
  await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
});

test("Cancel Layout import retains browsing association but releases the review without saving its frozen target", async ({ context, page }) => {
  await seedLayout(context, true, true); await page.goto("/"); await prepareDesignTarget(page);
  const beforeBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  const frozenSummary = await page.getByTestId("field-target-output-source").textContent();
  await page.getByTestId("layout-new-name").fill("Unsubmitted changed association");
  await page.getByTestId("layout-associate-field-ops-other-field").click();
  await expect(page.getByTestId("layout-associate-field-ops-other-field")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("layout-cancel-import").click();
  await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
  await expect(page.getByTestId("layout-catalog-close-confirm")).toHaveCount(0);
  await expect(page.getByTestId("layout-associate-field-ops-other-field")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
  await page.getByTestId("task-design").click();
  await expect(page.getByTestId("field-target-output-source")).toHaveText(frozenSummary!);
  await expect(page.getByTestId("field-freeze-target")).toBeDisabled();
  await expect(page.getByTestId("field-retained-target-notice")).toContainText("A frozen target is waiting");
  // Reopen the same retained target: Cancel must not acknowledge it as saved or allow replacing it.
  await page.getByTestId("field-open-layout").click();
  await expect(page.getByTestId("task-layout")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("layout-import-review")).toBeVisible();
  await expect(page.getByTestId("layout-new-name")).toHaveValue("Field operations design Layout");
  await expect(page.getByTestId("layout-associate-field-ops-field")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
});


test("empty Layout catalog keeps its browsing field across tasks without blocking a new design target", async ({ context, page }) => {
  await seedLayout(context, true, true); await page.goto("/");
  const beforeBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  await page.getByTestId("task-layout").click();
  await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
  await page.getByTestId("layout-associate-field-ops-other-field").click();
  await page.getByTestId("task-projects").click();
  await page.getByTestId("task-layout").click();
  await expect(page.getByTestId("layout-associate-field-ops-other-field")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
  await prepareDesignTarget(page);
  await expect(page.getByTestId("layout-associate-field-ops-field")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
});

test("a malformed chosen Layout file retains explicit review protection until confirmed Back", async ({ context, page }) => {
  await seedLayout(context, true); await page.goto("/"); await prepareDesignTarget(page);
  const beforeBytes = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
  const choosing = page.waitForEvent("filechooser");
  await page.getByTestId("layout-import").click();
  await (await choosing).setFiles({ name: "malformed-target.json", mimeType: "application/json", buffer: Buffer.from("{") });
  await expect(page.getByTestId("layout-catalog-feedback")).toContainText("Invalid JSON document");
  await expect(page.getByTestId("layout-import-review")).toHaveCount(0);
  await page.getByTestId("task-design").click();
  await page.getByTestId("field-open-layout").click();
  await expect(page.getByTestId("task-design")).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Your RTK Layout import review is still open.", { exact: false })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
  await page.getByTestId("task-layout").click();
  await page.getByTestId("layout-catalog-back").click();
  await expect(page.getByTestId("layout-catalog-close-confirm")).toBeVisible();
  await page.getByTestId("layout-catalog-close-confirm-cancel").click();
  await expect(page.getByTestId("layout-catalog-feedback")).toContainText("Invalid JSON document");
  await page.getByTestId("layout-catalog-back").click();
  await page.getByTestId("layout-catalog-close-confirm").getByRole("button", { name: "Leave import review", exact: true }).click();
  await expect(page.getByTestId("layout-session-catalog")).toHaveCount(0);
  await expect(page.getByTestId("field-freeze-target")).toBeDisabled();
  await page.getByTestId("field-open-layout").click();
  await expect(page.getByTestId("layout-import-review")).toBeVisible();
  await expect(page.getByTestId("layout-new-name")).toHaveValue("Field operations design Layout");
  expect(await page.evaluate(key => localStorage.getItem(key), workspaceKey)).toBe(beforeBytes);
});

test("imported machine review shows actual moved centers and individual configuration changes before guarded adoption", async ({ context, page }, info) => {
  await seedLayout(context, true); await page.goto("/");
  await page.getByTestId("task-projects").click();
  await openProjectDrawer(page);
  await page.getByTestId("catalog-design-field-ops-design-open").click();
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  const before = await readWorkspace(page);
  const field = parseFieldDesignDocument(before.fieldDocuments![0].document);
  const original = field.machines[0];
  const moved = structuredClone(original);
  moved.pivotCenter.x += 25.123456789; moved.pivotCenter.y += 15.987654321;
  moved.configuration.spanLengthsMeters[0] += 1.234567891;
  moved.configuration.spanLengthsMeters[1] += 0.000000001;
  moved.configuration.overhangMeters += 2.345678912;
  const added = { ...structuredClone(original), id: "review-added-pivot", pivotCenter: { x: original.pivotCenter.x - 60, y: original.pivotCenter.y - 40 },
    configuration: { ...structuredClone(original.configuration), name: "Additional reviewed pivot", spanLengthsMeters: [24.123456789, 18.987654321] } };
  const proposed = { ...field, machines: [moved, added] };
  const bytes = exportFieldDesignArchiveZip(buildFieldDesignArchiveBundle(proposed, "2026-09-30T12:00:00.000Z", before.fieldDocuments![0].originalProjectDocument));
  const reviewPlan = async () => {
    const chooser = page.waitForEvent("filechooser"); await page.getByTestId("field-import-plan").click();
    await (await chooser).setFiles({ name: "actual-machine-changes.zip", mimeType: "application/zip", buffer: Buffer.from(bytes) });
    await expect(page.getByTestId("field-plan-comparison")).toBeVisible();
  };
  await reviewPlan();
  const review = page.getByTestId("field-plan-comparison");
  await expect(review.getByTestId("field-plan-comparison-summary")).toHaveText("1 added · 1 moved · 0 removed · 0 changed in place · 0 unchanged");
  await expect(review.getByTestId("field-plan-comparison-source")).toContainText("Review revision 0 · Proposal");
  const originalDot = page.getByTestId(`field-plan-comparison-current-location-${original.id}`);
  const proposedDot = page.getByTestId(`field-plan-comparison-proposed-location-${original.id}`);
  expect(await originalDot.getAttribute("cx")).not.toBe(await proposedDot.getAttribute("cx"));
  expect(await originalDot.getAttribute("cy")).not.toBe(await proposedDot.getAttribute("cy"));
  await expect(page.getByTestId("field-plan-comparison-current-location-review-added-pivot")).toHaveCount(0);
  await expect(page.getByTestId("field-plan-comparison-proposed-location-review-added-pivot")).toHaveCount(1);
  const movedRow = page.getByTestId(`field-plan-comparison-machine-${original.id}`);
  await expect(movedRow).toContainText(`Span · 1: ${formatDistance(original.configuration.spanLengthsMeters[0], "us_survey_feet")} → ${formatDistance(moved.configuration.spanLengthsMeters[0], "us_survey_feet")}`);
  await expect(movedRow).toContainText(`Overhang: ${formatDistance(original.configuration.overhangMeters, "us_survey_feet")} → ${formatDistance(moved.configuration.overhangMeters, "us_survey_feet")}`);
  await expect(movedRow).toContainText("small change below displayed precision");
  await page.setViewportSize({ width: 390, height: 430 });
  const currentPreview = page.getByTestId("field-plan-comparison-current"); const proposedPreview = page.getByTestId("field-plan-comparison-proposed");
  await reachFieldReviewItem(page, currentPreview); await expect(currentPreview).toContainText("Current · 1 machines");
  await reachFieldReviewItem(page, proposedPreview); await expect(proposedPreview).toContainText("Proposed · 2 machines");
  await info.attach("imported-current-proposed-review-390x430", { body: await page.screenshot(), contentType: "image/png" });
  await expect(page.getByTestId("field-plan-comparison-exact")).toHaveCount(0);
  await reachFieldReviewItem(page, page.getByTestId("field-plan-comparison-exact-toggle"));
  await page.getByTestId("field-plan-comparison-exact-toggle").click();
  const exactSpan = `Span · 2: ${original.configuration.spanLengthsMeters[1]} m → ${moved.configuration.spanLengthsMeters[1]} m`;
  await expect(page.getByTestId("field-plan-comparison-exact")).toContainText(exactSpan);
  await expect(page.getByTestId("field-plan-comparison-exact")).toContainText(`Proposed center: X ${moved.pivotCenter.x}, Y ${moved.pivotCenter.y} m`);
  await reachFieldReviewItem(page, page.getByTestId("field-plan-comparison-exact").getByText(exactSpan, { exact: true }));
  await info.attach("imported-exact-machine-values-390x430", { body: await page.screenshot(), contentType: "image/png" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reachFieldReviewItem(page, page.getByTestId("field-adopt-plan"));
  await page.getByTestId("field-adopt-plan").click();
  await expect(page.getByTestId("field-feedback")).toContainText("Allow replacement of the affected machine");
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId(`field-unlock-${original.id}`).getByRole("switch").check();
  await page.getByTestId("field-adopt-plan").click();
  await expect(page.getByTestId("field-plan-review")).toHaveCount(0);
  await page.getByTestId("field-save").click(); await expect(page.getByTestId("field-save-state")).toContainText("Saved");
  expect(parseFieldDesignDocument((await readWorkspace(page)).fieldDocuments![0].document).machines).toEqual(proposed.machines);
  await reviewPlan();
  await page.getByTestId("field-input-name").fill("Edit after comparison");
  await expect(page.getByTestId("field-adopt-plan")).toBeDisabled();
  await page.getByTestId("field-apply-machine").click();
  await expect(page.getByTestId("field-plan-review")).toContainText("field changed");
  await expect(page.getByTestId("field-adopt-plan")).toBeDisabled();
  const after = await readWorkspace(page);
  expect(after.projectDocuments).toEqual(before.projectDocuments);
  expect(after.layoutSessions).toEqual(before.layoutSessions);
  expect(parseFieldDesignDocument(after.fieldDocuments![0].document).machines).toEqual(proposed.machines);
});

test("layout search previews its actual additional machine and preserves saved positions until adoption", async ({ context, page }, info) => {
  test.setTimeout(120_000);
  await seedLayout(context, true, false, true); await page.goto("/");
  await page.getByTestId("task-projects").click(); await openProjectDrawer(page);
  await page.getByTestId("catalog-design-field-ops-design-open").click();
  await page.getByTestId("field-autosave").getByRole("switch").uncheck();
  const before = await readWorkspace(page); const field = parseFieldDesignDocument(before.fieldDocuments![0].document);
  await expect(page.getByTestId(`field-search-unlock-${field.machines[0].id}`).getByRole("switch")).toBeChecked();
  await page.getByTestId(`field-search-count-${field.machines[0].id}`).fill("1");
  await page.getByTestId("field-search-limit").fill("2");
  await page.getByTestId("field-search-run").click();
  await expect(page.getByTestId("field-search-adopt")).toBeEnabled({ timeout: 90_000 });
  await expect(page.getByTestId("field-search-comparison-summary")).toHaveText("1 added · 0 moved · 0 removed · 0 changed in place · 1 unchanged");
  const current = page.getByTestId(`field-search-comparison-current-location-${field.machines[0].id}`);
  const pinned = page.getByTestId(`field-search-comparison-proposed-location-${field.machines[0].id}`);
  expect(await pinned.getAttribute("cx")).toBe(await current.getAttribute("cx"));
  expect(await pinned.getAttribute("cy")).toBe(await current.getAttribute("cy"));
  const proposedLocations = await page.locator('[data-testid^="field-search-comparison-proposed-location-"]').evaluateAll(nodes => nodes.map(node => [node.getAttribute("cx"), node.getAttribute("cy")]));
  expect(proposedLocations).toHaveLength(2); expect(proposedLocations[0]).not.toEqual(proposedLocations[1]);
  await expect(page.getByTestId("field-search-result")).toContainText("equipment costs are unknown");
  await expect(page.getByTestId("field-search-result")).not.toContainText("enter equipment prices");
  await page.setViewportSize({ width: 390, height: 430 });
  await reachFieldReviewItem(page, page.getByTestId("field-search-comparison-current"));
  await expect(page.getByTestId("field-search-comparison-current")).toContainText("Current · 1 machines");
  await reachFieldReviewItem(page, page.getByTestId("field-search-comparison-proposed"));
  await expect(page.getByTestId("field-search-comparison-proposed")).toContainText("Proposed · 2 machines");
  await info.attach("search-proposed-machine-review-390x430", { body: await page.screenshot(), contentType: "image/png" });
  await reachFieldReviewItem(page, page.getByTestId("field-search-adopt"));
  await expect(page.getByTestId("field-search-adopt")).toBeEnabled();
  expect(await readWorkspace(page)).toEqual(before);
  await page.getByTestId("field-input-name").fill("Newer review inputs");
  await expect(page.getByTestId("field-search-adopt")).toBeDisabled();
  await page.getByTestId("field-apply-machine").click();
  await expect(page.getByTestId("field-search-result")).toContainText("field changed");
  await expect(page.getByTestId("field-search-adopt")).toBeDisabled();
  expect(await readWorkspace(page)).toEqual(before);
});
