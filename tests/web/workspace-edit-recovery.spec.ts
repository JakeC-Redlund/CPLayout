import { fillActiveCatalogFormInput } from "./catalog-form-readiness";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { formatDistanceInputValue, parseDesignDraftDocument, parseLayoutSessionDocument, parseSurveyCollectionDocument } from "../../packages/core/src/index";
import { readWorkspaceDesign } from "../../packages/project-store/src/versionedProjectRepository";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { machineInputValues } from "../../apps/mobile/src/components/designDraftInputValues";
import { fieldMachineInputs } from "../../apps/mobile/src/components/fieldMachineInputs";
import { editableFromSavedDesign, reduceWorkspaceEditable } from "../../apps/mobile/src/workspace/workspaceDocumentAdapters";
import { createWorkspaceControllerState, openControllerDocument, openControllerLayout, reduceControllerDocument, retainControllerCollections, selectControllerMode } from "../../apps/mobile/src/workspace/workspaceControllerState";
import { workspaceHistorySnapshot } from "../../apps/mobile/src/workspace/workspaceIntegration";
import { captureWorkspaceControllerRecovery } from "../../apps/mobile/src/workspace/workspaceRecoveryControllerState";
import { emptyWorkspaceEditRecoveryUi, parseWorkspaceEditRecovery, serializeWorkspaceEditRecovery, workspaceRecoveryStableJson,
  type WorkspaceEditRecoveryCandidate, type WorkspaceRecoveryJson } from "../../apps/mobile/src/workspace/workspaceEditRecovery";
import { WORKSPACE_EDIT_RECOVERY_KEY, WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION } from "../../apps/mobile/src/workspace/workspaceEditRecoveryStore";
import { UNIFIED_WORKSPACE_RESUME_KEY, type UnifiedWorkspaceResume } from "../../apps/mobile/src/navigation/unifiedWorkspaceResume";
import { packageFixture, packageIds, seedPackageWorkspace, sourcePayload, type PackageOwnerKind } from "./workspace-package-fixtures";
import { readWorkspace, workspaceStorageBytes } from "./workspace-fixtures";
import { connectOperationalReceiver, installOperationalReceiver, type ReceiverFixtureWindow } from "./operational-receiver-fixture";

// Actual default App, its origin storage, File/Review/Restore controls and downloads.
// Seeded checkpoints are synthetic previously entered work, never device/field
// observations or an executed App capture. Separate journeys verify real capture.
test.use({ actionTimeout: 15_000 });
type Fixture = Awaited<ReturnType<typeof packageFixture>>;
type Mutable<T> = T extends readonly (infer V)[] ? Mutable<V>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const capturedAt = "2026-10-10T12:34:56.789Z", rawSpan = "  unfinished 12' x  ", rawError = "Retained invalid machine entry.";
const recoveredName = "Recovered unsaved design", rawNotes = "  Unsubmitted reference notes\nsecond line  ";
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, context, baseURL }) => {
  errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
});
test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });

function ledger(candidate: WorkspaceEditRecoveryCandidate, raw = serializeWorkspaceEditRecovery(candidate)) {
  return JSON.stringify({ ledgerVersion: WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, slots: [{ writerId: candidate.writerId, sequence: candidate.sequence, raw }] });
}
function input(key: string, baseline: unknown, value: unknown) {
  const fingerprint = workspaceRecoveryStableJson(baseline);
  return { key, baselineFingerprint: fingerprint, cleanFingerprint: fingerprint, value: value as WorkspaceRecoveryJson };
}
async function managed(kind: PackageOwnerKind, dirty = true) {
  const fixture = await packageFixture(kind), read = readWorkspaceDesign(fixture.workspace, fixture.designId);
  if (read.kind === "not_found") throw new Error("Expected actual saved fixture owner.");
  let editable = editableFromSavedDesign(read);
  if (editable.kind === "field") editable = reduceWorkspaceEditable(editable, { kind: "field", action: { type: "select_machine", id: "package-unequal-machine" } });
  const collections = fixture.workspace.surveyCollections!.map(item => parseSurveyCollectionDocument(item.document)).filter(item => item.owner.designId === fixture.designId);
  const session = parseLayoutSessionDocument(fixture.workspace.layoutSessions![0].document);
  let state = retainControllerCollections(openControllerDocument(createWorkspaceControllerState(), editable, { dirty: false, busy: false }, true), collections);
  state = selectControllerMode(openControllerLayout(state, { session, persistenceRevision: fixture.workspace.revision }, { dirty: false, busy: false }), "design");
  if (dirty) {
    const renamed = { type: "rename" as const, name: recoveredName };
    state = reduceControllerDocument(state, editable.kind === "draft" ? { kind: "draft", action: renamed } : editable.kind === "field" ? { kind: "field", action: renamed } : { kind: "project", action: renamed });
    const futureName = { type: "rename" as const, name: "Possible future redo name" };
    const future = reduceControllerDocument(state, editable.kind === "draft" ? { kind: "draft", action: futureName } : editable.kind === "field" ? { kind: "field", action: futureName } : { kind: "project", action: futureName });
    state = { ...state, historyFuture: [workspaceHistorySnapshot(future)] };
  }
  const ui = structuredClone(emptyWorkspaceEditRecoveryUi()) as Mutable<ReturnType<typeof emptyWorkspaceEditRecoveryUi>>;
  ui.entry.designTask = kind === "field" ? "machines" : "inputs"; ui.entry.toolsOpen = true;
  ui.survey = { ...ui.survey, referenceName: "Exact current reference  ", referenceNotes: dirty ? rawNotes : "Original reference notes\nretained",
    referenceBaselineName: "Exact current reference  ", referenceBaselineNotes: "Original reference notes\nretained", referenceDetails: dirty };
  ui.layout = { name: dirty ? "  " : session.name, nameBaseline: session.name, label: dirty ? "  Uncollected Layout label  " : "", copyName: dirty ? "  Unsubmitted copy  " : "", details: dirty };
  const context: UnifiedWorkspaceResume = { version: 2, catalogVisible: false,
    catalogSelection: { clientId: packageIds.customer, projectId: packageIds.project, fieldMapId: packageIds.field, designId: fixture.designId },
    workspace: { mode: "design", design: { designId: fixture.designId, documentKind: kind, payloadId: editable.identity.payloadId, fieldMapId: packageIds.field, projectCrs: editable.identity.projectCrs },
      layout: { sessionId: session.id, fieldMapId: session.fieldMapId, projectCrs: editable.identity.projectCrs!, targetHash: session.targetHash }, collectionId: "source-current" } };
  const candidate = structuredClone(captureWorkspaceControllerRecovery(state, { writerId: `browser-recovery-${kind}`, sequence: 1, capturedAt,
    workspaceRevision: fixture.workspace.revision, context, inputs: { entries: [], focus: null }, ui,
    cameras: [{ context: { kind: "field", fieldMapId: packageIds.field, projectCrs: editable.identity.projectCrs },
      viewport: { center: { x: 501234.125, y: 4506421.375 }, baseWidthMeters: 1200, baseHeightMeters: 900, zoomLevel: 2 }, initialized: true }] }, fixture.workspace)) as Mutable<WorkspaceEditRecoveryCandidate>;
  let originalSpan = "";
  if (dirty && editable.kind === "draft") {
    const values = machineInputValues(editable.editor.draft.machine), baseline = { canonical: editable.editor.draft.machine, value: values, error: null };
    originalSpan = values.spans![0];
    candidate.inputs.entries = [input(`${JSON.stringify(["draft-inputs", editable.identity.payloadId])}/machine`, baseline,
      { ...baseline, value: { ...values, spans: [rawSpan, ...values.spans!.slice(1)] }, error: rawError })];
  } else if (dirty && editable.kind === "field") {
    const field = editable.editor.field, machine = field.machines.find(item => item.id === editable.editor.selectedMachineId)!;
    const values = fieldMachineInputs(machine, field), baseline = { values, error: null }; originalSpan = values.spans[0];
    candidate.inputs.entries = [input(`field-inputs/${encodeURIComponent(field.id)}/machine/${encodeURIComponent(machine.id)}`, baseline,
      { values: { ...values, spans: [rawSpan, ...values.spans.slice(1)] }, error: rawError })];
  } else if (dirty && editable.kind === "project") {
    const rows = editable.editor.project.machine.spanLengthsMeters.map(value => formatDistanceInputValue(value, ui.settings.unitSystem)); originalSpan = rows[0];
    candidate.inputs.entries = [input("machine:spanRows", rows, [rawSpan, ...rows.slice(1)])];
  }
  return { fixture, candidate: parseWorkspaceEditRecovery(candidate), context, originalSpan };
}
async function seed(context: BrowserContext, fixture: Fixture, hint: UnifiedWorkspaceResume | null, candidate?: WorkspaceEditRecoveryCandidate, candidateRaw?: string) {
  if (hint) fixture.values.set(UNIFIED_WORKSPACE_RESUME_KEY, JSON.stringify(hint));
  if (candidate) fixture.values.set(WORKSPACE_EDIT_RECOVERY_KEY, ledger(candidate, candidateRaw));
  await seedPackageWorkspace(context, fixture);
}
async function waitManaged(page: Page) {
  await expect(page.getByTestId("workspace-save")).toBeEnabled(); await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
  await expect(page.getByTestId("workspace-catalog")).toBeHidden();
}
async function tools(page: Page) {
  const button = page.getByTestId("workspace-tools-toggle"); await expect(button).toBeEnabled();
  if (await button.getAttribute("aria-label") !== "Hide tools") await button.click(); await expect(page.getByTestId("workspace-mode-tools")).toBeVisible();
}
async function recovery(page: Page) {
  await page.getByTestId("command-menu-workspace-file").click(); await page.getByRole("menuitem", { name: "Recover unfinished work", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close recovery", exact: true })).toBeVisible();
}
function card(page: Page, candidate: WorkspaceEditRecoveryCandidate): Locator {
  return page.getByTestId("workspace-recovery-candidate").filter({ hasText: `${candidate.capturedAt} · Checkpoint ${candidate.sequence}` });
}
async function restore(page: Page, candidate: WorkspaceEditRecoveryCandidate) {
  await recovery(page); const checkpoint = card(page, candidate); await expect(checkpoint).toHaveCount(1);
  await checkpoint.getByRole("button", { name: "Review restore", exact: true }).click();
  const apply = checkpoint.getByRole("button", { name: "Restore unfinished work", exact: true }); await expect(apply).toBeEnabled(); await apply.click();
  await expect(page.getByRole("button", { name: "Close recovery", exact: true })).toBeHidden();
}
async function exactDownload(page: Page, button: Locator, filename: string) {
  const pending = page.waitForEvent("download"); await button.click(); const download = await pending;
  expect(download.suggestedFilename()).toBe(filename); const path = await download.path(); expect(path).toBeTruthy(); return readFile(path!, "utf8");
}
async function stored(page: Page) {
  const rows = await page.evaluate(key => {
    const raw = localStorage.getItem(key); if (!raw) return [];
    return (JSON.parse(raw) as { slots: Array<{ writerId: string; sequence: number; raw: string }> }).slots;
  }, WORKSPACE_EDIT_RECOVERY_KEY);
  return rows.map(row => ({ ...row, candidate: parseWorkspaceEditRecovery(row.raw) }));
}
async function disconnected(page: Page) { await expect(page.getByTestId("workspace-receiver-summary")).toHaveText("Receiver: idle · Data: waiting · Fix unknown"); }
function machineInput(page: Page, kind: PackageOwnerKind) {
  return kind === "draft" ? page.getByTestId("draft-machine-span-0") : kind === "field" ? page.getByTestId("field-input-span-0")
    : page.getByTestId("project-design-machine").getByRole("textbox", { name: /^Span 1 \(/ });
}

for (const kind of ["draft", "project", "field"] as const)
test(`${kind} actual File Review/Restore recovers raw inputs, history, independent camera and Survey/Layout while preserving exact sources`, async ({ context, page }) => {
  const { fixture, candidate, context: hint, originalSpan } = await managed(kind); await seed(context, fixture, hint, candidate); await page.goto("/"); await waitManaged(page);
  const before = await workspaceStorageBytes(page); await restore(page, candidate); await tools(page);
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(recoveredName));
  await expect(machineInput(page, kind)).toHaveValue(rawSpan); await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply");
  if (kind !== "project") await expect(page.getByText(rawError, { exact: true })).toBeVisible();
  await expect(page.getByTestId("workspace-map-readout")).toContainText("Center X 501234.125 · Y 4506421.375");
  await expect(page.getByTestId("workspace-undo")).toBeEnabled(); await expect(page.getByTestId("workspace-redo")).toBeEnabled();
  if (kind === "draft") await page.getByTestId("draft-inputs-discard").click();
  else if (kind === "field") await page.getByTestId("field-discard-inputs").click();
  else await machineInput(page, kind).fill(originalSpan);
  await page.getByTestId("workspace-undo").click(); await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(sourcePayload(fixture.workspace, fixture.designId).data.name));
  await page.getByTestId("workspace-redo").click(); await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(recoveredName));
  await expect(page.getByTestId("workspace-map-readout")).toContainText("Center X 501234.125 · Y 4506421.375");
  await page.getByTestId("workspace-mode-survey").click(); await expect(page.getByTestId("survey-collection")).toHaveValue("source-current");
  await expect(page.getByTestId("survey-reference-name")).toHaveValue("Exact current reference  "); await expect(page.getByTestId("survey-reference-notes")).toHaveValue(rawNotes);
  await expect(page.getByTestId("survey-reference-provenance")).toHaveText("Recorded Survey reference — original observations retained.");
  await page.getByTestId("workspace-mode-layout").click();
  await expect(page.getByRole("textbox", { name: "Layout session name", exact: true })).toHaveValue("  ");
  await expect(page.getByTestId("layout-observation-label")).toHaveValue("  Uncollected Layout label  ");
  await expect(page.getByRole("textbox", { name: "Copy Layout session name", exact: true })).toHaveValue("  Unsubmitted copy  ");
  await expect(page.getByTestId("unified-layout-panel")).toContainText(`Target hash: ${candidate.layout!.targetHash}`); await expect(page.getByTestId("layout-collect")).toBeDisabled();
  await disconnected(page); expect(await workspaceStorageBytes(page)).toEqual(before); expect(await readWorkspace(page)).toEqual(fixture.workspace);
  expect((await readWorkspace(page)).surveyCollections).toEqual(fixture.workspace.surveyCollections); expect((await readWorkspace(page)).layoutSessions).toEqual(fixture.workspace.layoutSessions);
});

test("actual hidden-Catalog raw edit checkpoints automatically and reload Restore returns its exact unfinished input", async ({ context, page }) => {
  const base = await managed("draft", false); await seed(context, base.fixture, base.context); await page.goto("/"); await waitManaged(page); await tools(page);
  await page.getByTestId("design-task-inputs").click(); await page.getByTestId("draft-machine-span-0").fill("  actual automatic unfinished text  ");
  const before = await workspaceStorageBytes(page); let checkpoint!: WorkspaceEditRecoveryCandidate;
  await expect.poll(async () => {
    const found = (await stored(page)).find(row => row.candidate.editable?.identity.designId === base.fixture.designId
      && row.candidate.inputs.entries.some(entry => typeof entry.value === "object" && entry.value !== null && !Array.isArray(entry.value)
        && JSON.stringify(entry.value).includes("actual automatic unfinished text")));
    if (found) checkpoint = found.candidate; return !!found;
  }).toBe(true);
  expect(checkpoint.context.catalogVisible).toBe(false); expect(checkpoint.ui.entry.designTask).toBe("inputs");
  await page.reload(); await waitManaged(page); await restore(page, checkpoint); await tools(page);
  await expect(page.getByTestId("draft-machine-span-0")).toHaveValue("  actual automatic unfinished text  ");
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply"); await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  expect(await workspaceStorageBytes(page)).toEqual(before); await disconnected(page);
});

test("actual Catalog-only unfinished customer form checkpoints and reload Restore preserves invalid fields and errors without records", async ({ context, page }) => {
  const fixture = await packageFixture("draft", false); fixture.workspace = emptyWorkspaceDocument(); await seed(context, fixture, null); await page.goto("/");
  await expect(page.getByTestId("workspace-catalog")).toBeVisible(); await expect(page.getByTestId("catalog-new")).toBeEnabled();
  await page.getByTestId("catalog-new").click(); await fillActiveCatalogFormInput(page, "client-profile-first-name-input", "  Unfinished first  ", "client-profile-dialog", "");
  await fillActiveCatalogFormInput(page, "client-profile-last-name-input", "  ", "client-profile-dialog", ""); await fillActiveCatalogFormInput(page, "client-profile-company-input", "  Exact raw company  ", "client-profile-dialog", "");
  await page.getByTestId("client-profile-details-toggle").click(); await page.getByTestId("client-profile-notes-input").fill("  Notes\nretained  ");
  await page.getByTestId("client-profile-save").click(); await expect(page.getByTestId("client-profile-last-name-input-error")).toBeVisible();
  const error = await page.getByTestId("client-profile-last-name-input-error").innerText(), before = await workspaceStorageBytes(page); let checkpoint!: WorkspaceEditRecoveryCandidate;
  await expect.poll(async () => {
    const found = (await stored(page)).find(row => row.candidate.ui.catalog.form?.kind === "client" && row.candidate.ui.catalog.form.client?.companyName === "  Exact raw company  "
      && row.candidate.ui.catalog.form.errors.some(item => item.field === "primaryContactLastName"));
    if (found) checkpoint = found.candidate; return !!found;
  }).toBe(true);
  expect(checkpoint.editable).toBeNull(); await page.reload(); await expect(page.getByTestId("catalog-new")).toBeEnabled(); await restore(page, checkpoint);
  await expect(page.getByTestId("client-profile-first-name-input")).toHaveValue("  Unfinished first  "); await expect(page.getByTestId("client-profile-last-name-input")).toHaveValue("  ");
  await expect(page.getByTestId("client-profile-company-input")).toHaveValue("  Exact raw company  "); await expect(page.getByTestId("client-profile-notes-input")).toHaveValue("  Notes\nretained  ");
  await expect(page.getByTestId("client-profile-last-name-input-error")).toHaveText(error);
  expect(await workspaceStorageBytes(page)).toEqual(before); expect((await readWorkspace(page)).catalog.clients).toEqual([]); await disconnected(page);
});

test("actual checkpoint Export and conditional Discard preserve exact candidate bytes and every durable source", async ({ context, page }) => {
  const base = await managed("draft"), raw = serializeWorkspaceEditRecovery(base.candidate); await seed(context, base.fixture, base.context, base.candidate); await page.goto("/"); await waitManaged(page);
  const before = await workspaceStorageBytes(page); await recovery(page); const checkpoint = card(page, base.candidate); await expect(checkpoint).toHaveCount(1);
  const output = await exactDownload(page, checkpoint.getByRole("button", { name: "Export checkpoint", exact: true }), "cplayout-unfinished-work.json");
  expect(output).toBe(raw); expect(parseWorkspaceEditRecovery(output)).toEqual(base.candidate);
  await checkpoint.getByRole("button", { name: "Discard checkpoint", exact: true }).click(); await checkpoint.getByRole("button", { name: "Confirm discard", exact: true }).click();
  await expect(checkpoint).toHaveCount(0); expect((await stored(page)).some(row => row.writerId === base.candidate.writerId)).toBe(false);
  expect(await workspaceStorageBytes(page)).toEqual(before); expect(await readWorkspace(page)).toEqual(base.fixture.workspace);
});

test("actual corrupt-checkpoint refusal keeps exact opaque ledger Export available without normalization or source writes", async ({ context, page }) => {
  const base = await managed("draft"), rejected = JSON.stringify({ ...base.candidate, unsupported: "must not disappear" }), corrupt = ledger(base.candidate, rejected);
  await seed(context, base.fixture, base.context, base.candidate, rejected); await page.goto("/"); await waitManaged(page); const before = await workspaceStorageBytes(page);
  await recovery(page); await expect(page.getByTestId("workspace-recovery-status")).toContainText("Recovery ledger is invalid");
  await expect(page.getByRole("button", { name: "Restore unfinished work", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Recovery storage details", exact: true }).click();
  const exported = await exactDownload(page, page.getByRole("button", { name: "Export stored recovery bytes", exact: true }), "cplayout-recovery-ledger.json");
  expect(exported).toBe(corrupt); expect(await page.evaluate(key => localStorage.getItem(key), WORKSPACE_EDIT_RECOVERY_KEY)).toBe(corrupt);
  expect(await workspaceStorageBytes(page)).toEqual(before); await disconnected(page);
});

test("actual Review refuses a changed saved source while retaining the checkpoint and newer design exact", async ({ context, page }) => {
  const base = await managed("draft"), source = sourcePayload(base.fixture.workspace, base.fixture.designId).source;
  base.fixture.workspace = applyWorkspaceCommand(base.fixture.workspace, { type: "save_design_draft", designId: base.fixture.designId,
    expectedDesignRevision: source.design.revision, draft: { ...parseDesignDraftDocument(source.document), name: "Newer actual saved source" }, now: "2026-10-11T12:00:00.000Z" }).workspace;
  await seed(context, base.fixture, base.context, base.candidate); await page.goto("/"); await waitManaged(page); const before = await workspaceStorageBytes(page);
  await recovery(page); const checkpoint = card(page, base.candidate); await checkpoint.getByRole("button", { name: "Review restore", exact: true }).click();
  await expect(page.getByTestId("workspace-recovery-status")).toContainText("exact saved design/source/original identity, ancestry or revision changed");
  await expect(checkpoint.getByRole("button", { name: "Restore unfinished work", exact: true })).toHaveCount(0);
  expect((await stored(page)).find(row => row.writerId === base.candidate.writerId)!.raw).toBe(serializeWorkspaceEditRecovery(base.candidate));
  expect(await workspaceStorageBytes(page)).toEqual(before); await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Newer actual saved source/);
});

test("actual Restore refuses a connected synthetic receiver and never reconnects it implicitly", async ({ context, page }) => {
  const base = await managed("field"); await seed(context, base.fixture, base.context, base.candidate); await installOperationalReceiver(page); await page.goto("/"); await waitManaged(page);
  await page.getByTestId("workspace-receiver-toggle").click(); await connectOperationalReceiver(page); const before = await workspaceStorageBytes(page);
  await recovery(page); const checkpoint = card(page, base.candidate); await checkpoint.getByRole("button", { name: "Review restore", exact: true }).click();
  await checkpoint.getByRole("button", { name: "Restore unfinished work", exact: true }).click();
  await expect(page.getByTestId("workspace-recovery-status")).toContainText("Disconnect the receiver before restoring unfinished work");
  expect(await page.evaluate(() => {
    const fixture = (window as unknown as ReceiverFixtureWindow).operationalReceiver;
    return { requests: fixture.requestCount, ports: fixture.openPorts };
  })).toEqual({ requests: 1, ports: 1 });
  expect(await workspaceStorageBytes(page)).toEqual(before); await page.getByRole("button", { name: "Close recovery", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click(); await disconnected(page);
});
