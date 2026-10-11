import { activeCatalogFormInput, fillActiveCatalogFormInput } from "./catalog-form-readiness";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { parseUnifiedWorkspaceResume, UNIFIED_WORKSPACE_RESUME_KEY, type UnifiedWorkspaceResume } from "../../apps/mobile/src/navigation/unifiedWorkspaceResume";
import { parseWorkspaceEditRecovery, WORKSPACE_EDIT_RECOVERY_VERSION, type WorkspaceEditRecoveryCandidate } from "../../apps/mobile/src/workspace/workspaceEditRecovery";
import { WORKSPACE_EDIT_RECOVERY_KEY } from "../../apps/mobile/src/workspace/workspaceEditRecoveryStore";
import { parseDesignDraftDocument } from "../../packages/core/src/designDraft";
import { parseFieldLayoutTarget } from "../../packages/core/src/fieldLayoutTarget";
import { parseLayoutSessionDocument } from "../../packages/core/src/layoutSession";
import { parseSurveyCollectionDocument } from "../../packages/core/src/surveyCollection";
import { sha256Text } from "../../packages/core/src/sha256";
import type { WorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { packageFixture, packageIds, seedPackageWorkspace, sourcePayload, type PackageOwnerKind } from "./workspace-package-fixtures";
import { readWorkspace, workspaceStorageBytes } from "./workspace-fixtures";

// Actual default App and origin storage. Fixtures retain real command-created
// records, unequal machines, immutable Survey history and frozen Layout bytes.
// These are software preservation journeys, never native or physical accuracy proof.
test.use({ actionTimeout: 15_000 });
type Fixture = Awaited<ReturnType<typeof packageFixture>>;
type Mode = "design" | "survey" | "layout";
const sourceContext = (designId: string | null) => ({ clientId: packageIds.customer, projectId: packageIds.project, fieldMapId: packageIds.field, designId });
const browseB = { clientId: "package-customer-b", projectId: "package-project-b", fieldMapId: packageIds.destination, designId: null };
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ context, page, baseURL }) => {
  // This suite measures projected SVG geometry; keep that renderer deterministic.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, ...options: unknown[]) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return Reflect.apply(original, this, [contextId, ...options]);
    } as typeof original;
  });
  pageErrors.set(page, []); page.on("pageerror", error => pageErrors.get(page)!.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });

function resume(fixture: Fixture, mode: Mode = "design", selection = sourceContext(fixture.designId)): UnifiedWorkspaceResume {
  const { source, data } = sourcePayload(fixture.workspace, fixture.designId);
  const session = parseLayoutSessionDocument(fixture.workspace.layoutSessions!.find(item => item.id === packageIds.layout)!.document);
  return parseUnifiedWorkspaceResume({ version: 2, catalogVisible: false, catalogSelection: selection,
    workspace: { mode, design: { designId: fixture.designId, documentKind: source.kind, payloadId: source.payloadId,
      fieldMapId: source.design.fieldMapId, projectCrs: data.projectCrs }, collectionId: "source-current",
      layout: { sessionId: session.id, fieldMapId: session.fieldMapId, projectCrs: parseFieldLayoutTarget(session.targetDocument).field.projectCrs, targetHash: session.targetHash } } });
}
async function seed(context: BrowserContext, fixture: Fixture, hint = resume(fixture)) {
  fixture.values.set(UNIFIED_WORKSPACE_RESUME_KEY, JSON.stringify(hint)); await seedPackageWorkspace(context, fixture);
}
async function ready(page: Page, mode: Mode = "design") {
  await expect(page.getByTestId(`workspace-mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("workspace-save")).toBeEnabled(); await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
  await expect(page.getByTestId("workspace-receiver-summary")).toHaveText("Receiver: idle · Data: waiting · Fix unknown");
}
async function tools(page: Page, open = true) {
  const toggle = page.getByTestId("workspace-tools-toggle"); await expect(toggle).toBeEnabled();
  if ((await toggle.getAttribute("aria-label") === "Hide tools") !== open) await toggle.click();
  await expect(page.getByTestId("workspace-mode-tools"))[open ? "toBeVisible" : "toBeHidden"]();
}
async function file(page: Page, label: string) {
  await page.getByTestId("command-menu-workspace-file").click(); await page.getByRole("menuitem", { name: label, exact: true }).click();
}
async function catalog(page: Page) {
  if (!await page.getByTestId("workspace-catalog").isVisible()) await page.getByRole("button", { name: "Customers & projects", exact: true }).first().click();
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
}
async function closeCatalog(page: Page) {
  await page.getByTestId("catalog-close").click(); await expect(page.getByTestId("workspace-catalog")).toBeHidden();
}
function nameInput(page: Page, kind: "draft" | "field") { return page.getByTestId(kind === "draft" ? "draft-name" : "field-name-input"); }
async function applyTitle(page: Page, kind: PackageOwnerKind, name: string) {
  if (kind === "project") {
    await file(page, "Rename current design"); const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Design name", exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Apply name", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Design name", exact: true })).toBeHidden();
  } else {
    await tools(page); if (kind === "draft") await page.getByTestId("design-task-inputs").click();
    await nameInput(page, kind).fill(name);
    if (kind === "field") await page.getByTestId("field-rename").click();
    else await page.getByTestId("unified-design-panel").getByRole("button", { name: "Apply name", exact: true }).click();
  }
}
function preserved(before: WorkspaceDocument, after: WorkspaceDocument) {
  expect(after.catalog.clients).toEqual(before.catalog.clients); expect(after.catalog.projects).toEqual(before.catalog.projects);
  expect(after.catalog.fieldMaps).toEqual(before.catalog.fieldMaps); expect(after.surveyCollections).toEqual(before.surveyCollections);
  expect(after.layoutSessions).toEqual(before.layoutSessions); expect(after.tombstones).toEqual(before.tombstones);
  expect(after.originalV1Document).toBe(before.originalV1Document);
  expect(after.originalPreviousWorkspaceDocument).toBe(before.originalPreviousWorkspaceDocument);
  for (const entry of after.layoutSessions ?? []) { const session = parseLayoutSessionDocument(entry.document); expect(sha256Text(session.targetDocument)).toBe(session.targetHash); }
  for (const entry of after.surveyCollections ?? []) parseSurveyCollectionDocument(entry.document);
}
function sameSource(fixture: Fixture, after: WorkspaceDocument) {
  const beforeSource = sourcePayload(fixture.workspace, fixture.designId), afterSource = sourcePayload(after, fixture.designId);
  expect(afterSource.source.document).toBe(beforeSource.source.document);
  expect(afterSource.source.originalProjectDocument).toBe(beforeSource.source.originalProjectDocument);
  expect(afterSource.data).toEqual(beforeSource.data);
  expect(after.surveyCollections).toEqual(fixture.workspace.surveyCollections); expect(after.layoutSessions).toEqual(fixture.workspace.layoutSessions);
}
async function candidates(page: Page) {
  const raws = await page.evaluate(key => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw).slots.map((slot: { raw: string }) => slot.raw) as string[] : []; }, WORKSPACE_EDIT_RECOVERY_KEY);
  return raws.map(raw => ({ raw, candidate: parseWorkspaceEditRecovery(raw) }));
}
async function findFieldRenameCheckpoint(page: Page, rawName: string, invalid = false) {
  await expect.poll(async () => (await candidates(page)).some(({ candidate }) => candidate.ui.catalog.form?.kind === "rename_field_map"
    && candidate.ui.catalog.form.name === rawName && (!invalid || candidate.ui.catalog.form.error !== null))).toBe(true);
  return (await candidates(page)).find(({ candidate }) => candidate.ui.catalog.form?.kind === "rename_field_map"
    && candidate.ui.catalog.form.name === rawName && (!invalid || candidate.ui.catalog.form.error !== null))!;
}
async function visibleBoundary(page: Page, expectedVertices: number) {
  const renderer = page.getByTestId("workspace-map-svg-renderer"); await expect(renderer).toBeVisible();
  const frozen = await page.getByTestId("workspace-mode-layout").getAttribute("aria-pressed") === "true";
  // fieldGeometry inserts the field boundary before obstacle polygons. Layout
  // deliberately shares its target color across those separate geometries.
  const boundary = renderer.locator(`polygon[stroke="${frozen ? "#184932" : "#416c49"}"]:not([stroke-dasharray])`).first();
  await expect(boundary).toHaveCount(1);
  expect((await boundary.getAttribute("points"))!.trim().split(/\s+/)).toHaveLength(expectedVertices);
  return boundary.getAttribute("points");
}
async function capturedFieldCamera(page: Page, designId: string, mode: Mode, rawInput: string, workspaceRevision: number,
  previous?: { writerId: string; sequence: number }): Promise<{ writerId: string; sequence: number; camera: WorkspaceEditRecoveryCandidate["cameras"][number] }> {
  let held: { writerId: string; sequence: number; camera: WorkspaceEditRecoveryCandidate["cameras"][number] } | null = null;
  await expect.poll(async () => {
    const latest = (await candidates(page)).find(({ candidate }) => candidate.workspaceRevision === workspaceRevision
      && (!previous || candidate.writerId === previous.writerId && candidate.sequence > previous.sequence)
      && candidate.editable?.identity.designId === designId && candidate.context.workspace.mode === mode
      && !candidate.context.catalogVisible && candidate.ui.catalog.form === null
      && JSON.stringify(candidate.inputs.entries).includes(rawInput));
    const camera = latest?.candidate.cameras.find(item => item.context.kind === "field" && item.context.fieldMapId === packageIds.field);
    held = camera && latest ? { writerId: latest.candidate.writerId, sequence: latest.candidate.sequence, camera } : null;
    return held !== null;
  }).toBe(true);
  return held!;
}
async function assertBoundaryAtCamera(page: Page, vertices: readonly { x: number; y: number }[], camera: WorkspaceEditRecoveryCandidate["cameras"][number]) {
  const renderer = page.getByTestId("workspace-map-svg-renderer"); await expect(renderer).toBeVisible();
  const size = (await renderer.locator("svg").getAttribute("viewBox"))!.split(/\s+/).map(Number);
  const width = size[2], height = size[3]; expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0);
  const logical = camera.viewport;
  // A notice can resize the canvas. Derive its linear XY mapping independently
  // from the retained logical camera and actual measured screen dimensions.
  const scale = Math.min(width / logical.baseWidthMeters, height / logical.baseHeightMeters) * logical.zoomLevel;
  const points = (await visibleBoundary(page, vertices.length))!.trim().split(/\s+/).map(pair => pair.split(",").map(Number));
  vertices.forEach((point, index) => {
    expect(points[index][0]).toBeCloseTo(width / 2 + (point.x - logical.center.x) * scale, 7);
    expect(points[index][1]).toBeCloseTo(height / 2 - (point.y - logical.center.y) * scale, 7);
  });
  await expect(page.getByTestId("workspace-map-readout")).toContainText(`Center X ${logical.center.x.toFixed(3)} · Y ${logical.center.y.toFixed(3)}`);
  await expect(page.getByTestId("workspace-map-readout")).toContainText(`View width ${(width / scale).toFixed(2)} XY units`);
}
function assertDerivedDisplayCache(actual: unknown, expected: unknown, path = "wgs84Companion") {
  // Reuse the qualified package-import contract only for this derived cache.
  // Canonical XY, observed geographies and all evidence retain exact equality.
  if (typeof expected === "number" && /\.(latitude|longitude)$/.test(path)) {
    expect(typeof actual, path).toBe("number"); expect(Number.isFinite(actual), path).toBe(true);
    expect(Math.abs((actual as number) - expected), path).toBeLessThanOrEqual(1e-12); return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true); expect((actual as unknown[]).length, path).toBe(expected.length);
    expected.forEach((value, index) => assertDerivedDisplayCache((actual as unknown[])[index], value, `${path}[${index}]`)); return;
  }
  if (expected !== null && typeof expected === "object") {
    expect(actual !== null && typeof actual === "object" && !Array.isArray(actual), path).toBe(true);
    expect(Object.keys(actual as object).sort(), path).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) assertDerivedDisplayCache((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
    return;
  }
  expect(actual, path).toEqual(expected);
}
function recoveryCard(page: Page, candidate: WorkspaceEditRecoveryCandidate): Locator {
  return page.getByTestId("workspace-recovery-candidate").filter({ hasText: `${candidate.capturedAt} · Checkpoint ${candidate.sequence}` });
}

for (const kind of ["draft", "project", "field"] as const)
test(`${kind} applied title synchronizes its saved list name only on ordinary Save and preserves field/history/targets`, async ({ context, page }) => {
  const fixture = await packageFixture(kind), original = sourcePayload(fixture.workspace, fixture.designId), title = `Operator ${kind} design title`;
  await seed(context, fixture); await page.goto("/"); await ready(page);
  const bytes = await workspaceStorageBytes(page); await applyTitle(page, kind, title);
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(title));
  await expect(page.getByTestId("workspace-saved-list-name")).toHaveText(`Saved list name: ${original.source.design.name}`);
  expect(await workspaceStorageBytes(page)).toEqual(bytes);
  await page.getByTestId("workspace-save").click();
  await expect.poll(async () => sourcePayload(await readWorkspace(page), fixture.designId).source.design.name).toBe(title);
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved"); await expect(page.getByTestId("workspace-saved-list-name")).toHaveCount(0);
  const after = await readWorkspace(page), changed = sourcePayload(after, fixture.designId);
  expect(changed.data.name).toBe(title);
  const expectedCache = "wgs84Companion" in original.data ? original.data.wgs84Companion : undefined;
  if (expectedCache !== undefined) {
    expect(expectedCache).toMatchObject({ source: "derived_from_project_xy" });
    assertDerivedDisplayCache("wgs84Companion" in changed.data ? changed.data.wgs84Companion : undefined, expectedCache);
    expect({ ...changed.data, name: original.data.name, wgs84Companion: expectedCache }).toEqual(original.data);
  } else expect({ ...changed.data, name: original.data.name }).toEqual(original.data);
  expect(changed.source.originalProjectDocument).toBe(original.source.originalProjectDocument); preserved(fixture.workspace, after);
  expect(after.catalog.designs.filter(item => item.id !== fixture.designId)).toEqual(fixture.workspace.catalog.designs.filter(item => item.id !== fixture.designId));
  for (const id of fixture.workspace.catalog.designs.filter(item => item.id !== fixture.designId).map(item => item.id)) {
    expect(sourcePayload(after, id).source.document).toBe(sourcePayload(fixture.workspace, id).source.document);
  }
  await catalog(page); await expect(page.getByTestId(`catalog-recent-${fixture.designId}`)).toHaveAttribute("aria-label", title);
  await expect(page.getByTestId(`catalog-field-${packageIds.field}`)).toHaveAttribute("aria-label", "Source field"); await closeCatalog(page);
  await page.reload(); await ready(page); await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(title));
  expect(sourcePayload(await readWorkspace(page), fixture.designId).data).toEqual(changed.data);
});

for (const kind of ["draft", "field"] as const)
test(`${kind} File Rename focuses its retained raw name from collapsed tools without a duplicate File form`, async ({ context, page }) => {
  const fixture = await packageFixture(kind); await seed(context, fixture); await page.goto("/"); await ready(page); await tools(page);
  if (kind === "draft") await page.getByTestId("design-task-inputs").click();
  const raw = `  Unapplied ${kind} name  `, input = nameInput(page, kind); await input.fill(raw);
  const bytes = await workspaceStorageBytes(page);
  if (kind === "draft") await page.getByTestId("workspace-mode-survey").click();
  else await page.getByTestId("design-task-review").click();
  await tools(page, false); await page.setViewportSize({ width: 390, height: 430 });
  await file(page, "Rename current design"); await expect(page.getByTestId("workspace-mode-design")).toHaveAttribute("aria-pressed", "true");
  await expect(input).toBeVisible(); await expect(input).toHaveValue(raw); await expect(input).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Design name", exact: true })).toHaveCount(1);
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "Design name", exact: true })).toHaveCount(0);
  const box = await input.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(391); expect(box!.y + box!.height).toBeLessThanOrEqual(431);
  await input.press("End"); await input.press("!"); await expect(input).toHaveValue(`${raw}!`);
  await input.press("Tab");
  const apply = page.getByRole("button", { name: kind === "field" ? "Apply design name" : "Apply name", exact: true });
  await expect(apply).toBeFocused(); const applyBox = await apply.boundingBox(); expect(applyBox).not.toBeNull();
  expect(applyBox!.y).toBeGreaterThanOrEqual(0); expect(applyBox!.y + applyBox!.height).toBeLessThanOrEqual(431);
  if (kind === "field") {
    await apply.press("Tab"); const discard = page.getByTestId("field-name-discard"); await expect(discard).toBeFocused();
    const discardBox = await discard.boundingBox(); expect(discardBox).not.toBeNull();
    expect(discardBox!.y).toBeGreaterThanOrEqual(0); expect(discardBox!.y + discardBox!.height).toBeLessThanOrEqual(431);
  }
  expect(await workspaceStorageBytes(page)).toEqual(bytes); sameSource(fixture, await readWorkspace(page));
});

for (const mode of ["design", "survey", "layout"] as const)
test(`current-field New in ${mode} keeps Browse B and dirty Source A until an explicit guarded Open`, async ({ context, page }) => {
  const fixture = await packageFixture("field"); await seed(context, fixture, resume(fixture, "design", browseB)); await page.goto("/"); await ready(page);
  const sourceBoundary = sourcePayload(fixture.workspace, fixture.designId).data.fieldBoundary;
  const expectedVertices = sourceBoundary.length;
  await tools(page, false); await page.getByTestId("workspace-map-zoom-in").click(); await tools(page);
  await page.getByTestId("field-machine-package-unequal-machine").click();
  const raw = "  unfinished machine span  "; await page.getByTestId("field-input-span-0").fill(raw);
  if (mode !== "design") await page.getByTestId(`workspace-mode-${mode}`).click(); await tools(page, false);
  const camera = await page.getByTestId("workspace-map-readout").innerText(), boundary = await visibleBoundary(page, expectedVertices), bytes = await workspaceStorageBytes(page);
  const capturedCamera = await capturedFieldCamera(page, fixture.designId, mode, raw, fixture.workspace.revision);
  await assertBoundaryAtCamera(page, sourceBoundary, capturedCamera.camera);
  if (mode === "layout") await expect(page.getByTestId("workspace-selected-machine")).toHaveAttribute("aria-label", "Frozen target: Unequal second pivot (package-unequal-machine)");
  else await expect(page.getByTestId("workspace-selected-machine")).toHaveAttribute("aria-label", "Selected machine: Unequal second pivot (package-unequal-machine)");
  await file(page, "New design in current field…"); const form = page.getByTestId("catalog-dialog");
  await expect(form.getByTestId("catalog-form-recheck")).toHaveCount(0);
  await expect(page.getByTestId("catalog-dialog-context")).toHaveText("Source customer → Source project → Source field");
  await fillActiveCatalogFormInput(page, "catalog-dialog-name-input", "Cancelled intention", "catalog-dialog", ""); await form.getByTestId("catalog-dialog-cancel").click();
  await expect(page.getByTestId(`catalog-field-${packageIds.destination}`)).toHaveAttribute("aria-pressed", "true");
  expect(await workspaceStorageBytes(page)).toEqual(bytes); await closeCatalog(page);
  await expect(page.getByTestId("workspace-map-readout")).toHaveText(camera, { useInnerText: true }); expect(await visibleBoundary(page, expectedVertices)).toBe(boundary);
  await file(page, "New design in current field…"); await expect(page.getByTestId("catalog-dialog-context")).toHaveText("Source customer → Source project → Source field");
  const name = `New independent ${mode} draft`; await fillActiveCatalogFormInput(page, "catalog-dialog-name-input", name, "catalog-dialog", ""); await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await expect.poll(async () => (await readWorkspace(page)).catalog.designs.some(item => item.name === name)).toBe(true);
  const after = await readWorkspace(page), created = after.catalog.designs.find(item => item.name === name)!;
  expect(after.catalog.designs).toHaveLength(fixture.workspace.catalog.designs.length + 1); expect(created.id).not.toBe(fixture.designId);
  expect(created.kind).toBe("draft"); expect(created.fieldMapId).toBe(packageIds.field); const draft = parseDesignDraftDocument(sourcePayload(after, created.id).source.document);
  expect(draft.name).toBe(name); expect(draft.projectCrs).toBe("EPSG:32613"); expect(draft.fieldBoundary).toEqual([]); expect(draft.machine).toEqual({});
  expect(draft.pivotCenter).toBeNull(); expect(draft.waterSource).toBeNull(); expect(draft.powerSource).toBeNull(); preserved(fixture.workspace, after); sameSource(fixture, after);
  await expect(page.getByTestId(`catalog-field-${packageIds.destination}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`workspace-mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId(`catalog-recent-open-${created.id}`).click();
  await expect(page.getByRole("alert").filter({ hasText: "Save or preserve the current design and finish its entered inputs before opening another design." })).toBeVisible();
  await expect(page.getByTestId("workspace-catalog")).toBeVisible(); sameSource(fixture, await readWorkspace(page));
  await closeCatalog(page);
  const afterRefusal = await capturedFieldCamera(page, fixture.designId, mode, raw, after.revision, capturedCamera);
  expect(afterRefusal.camera).toEqual(capturedCamera.camera);
  await assertBoundaryAtCamera(page, sourceBoundary, capturedCamera.camera);
  await page.getByTestId("workspace-mode-design").click(); await tools(page);
  await expect(page.getByTestId("field-input-span-0")).toHaveValue(raw);
  await expect(page.getByTestId("workspace-selected-machine")).toHaveAttribute("aria-label", "Selected machine: Unequal second pivot (package-unequal-machine)");
  await page.getByTestId("field-discard-inputs").click(); await catalog(page); await page.getByTestId(`catalog-recent-open-${created.id}`).click();
  await expect(page.getByTestId("workspace-catalog")).toBeHidden(); await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(name));
  await expect(page.getByTestId("design-task-drawing")).toBeVisible(); sameSource(fixture, await readWorkspace(page));
});

test("early customer entry keeps an emptied required name, validates it and preserves all saved design work", async ({ context, page }) => {
  const fixture = await packageFixture("field"); await seed(context, fixture); await page.goto("/"); await ready(page);
  const bytes = await workspaceStorageBytes(page); await catalog(page); await page.getByTestId("catalog-edit-customer").click();
  await expect(page.getByTestId("catalog-form-recheck")).toHaveCount(0);
  const first = await activeCatalogFormInput(page, "client-profile-first-name-input", "client-profile-dialog");
  await expect(first).toHaveValue(fixture.workspace.catalog.clients.find(item => item.id === packageIds.customer)!.primaryContactFirstName!);
  await first.fill(""); await expect(first).toHaveValue("");
  await page.getByTestId("client-profile-save").click();
  await expect(first).toHaveValue("");
  await expect(page.getByTestId("client-profile-first-name-input-error")).toContainText(/first name/i);
  expect(await workspaceStorageBytes(page)).toEqual(bytes);
  await first.fill("Updated first name"); await page.getByTestId("client-profile-save").click();
  await expect(first).toBeHidden(); const after = await readWorkspace(page);
  expect(after.catalog.clients.find(item => item.id === packageIds.customer)!.primaryContactFirstName).toBe("Updated first name");
  expect(after.catalog.clients.filter(item => item.id !== packageIds.customer)).toEqual(fixture.workspace.catalog.clients.filter(item => item.id !== packageIds.customer));
  expect(after.catalog.projects).toEqual(fixture.workspace.catalog.projects); expect(after.catalog.fieldMaps).toEqual(fixture.workspace.catalog.fieldMaps);
  expect(after.catalog.designs).toEqual(fixture.workspace.catalog.designs); expect(after.projectDocuments).toEqual(fixture.workspace.projectDocuments);
  expect(after.draftDocuments).toEqual(fixture.workspace.draftDocuments); expect(after.fieldDocuments).toEqual(fixture.workspace.fieldDocuments);
  expect(after.layoutSessions).toEqual(fixture.workspace.layoutSessions); expect(after.surveyCollections).toEqual(fixture.workspace.surveyCollections);
  expect(after.tombstones).toEqual(fixture.workspace.tombstones); sameSource(fixture, after);
});

test("field container Rename is metadata-only, reachable on a short viewport and checkpointed as recovery v2", async ({ context, page }) => {
  const fixture = await packageFixture("field"); await seed(context, fixture); await page.goto("/"); await ready(page);
  await page.setViewportSize({ width: 390, height: 430 }); await catalog(page); await page.getByTestId("catalog-rename-field").click();
  await expect(page.getByTestId("catalog-dialog")).toContainText("Rename field"); await expect(page.getByTestId("catalog-dialog-name-input")).toHaveValue("Source field");
  await expect(page.getByTestId("catalog-dialog-create")).toHaveAttribute("aria-label", "Save field name");
  const name = "Operator field container"; await fillActiveCatalogFormInput(page, "catalog-dialog-name-input", name, "catalog-dialog", "Source field");
  const checkpoint = await findFieldRenameCheckpoint(page, name); expect(checkpoint.candidate.recoveryVersion).toBe(WORKSPACE_EDIT_RECOVERY_VERSION);
  expect(checkpoint.candidate.ui.catalog.form!.defaultName).toBe("Source field"); expect(checkpoint.candidate.ui.catalog.form!.context.fieldMapId).toBe(packageIds.field);
  await page.getByTestId("catalog-dialog-create").click(); await expect(page.getByTestId("catalog-dialog")).toBeHidden();
  await expect.poll(async () => (await readWorkspace(page)).catalog.fieldMaps.find(item => item.id === packageIds.field)!.name).toBe(name);
  const after = await readWorkspace(page), original = fixture.workspace.catalog.fieldMaps.find(item => item.id === packageIds.field)!;
  expect(after.revision).toBe(fixture.workspace.revision + 1);
  expect(after.catalog.fieldMaps.find(item => item.id === packageIds.field)).toEqual({ ...original, name, updatedAt: after.catalog.fieldMaps.find(item => item.id === packageIds.field)!.updatedAt });
  expect(after.catalog.fieldMaps.filter(item => item.id !== packageIds.field)).toEqual(fixture.workspace.catalog.fieldMaps.filter(item => item.id !== packageIds.field));
  expect(after.catalog.clients).toEqual(fixture.workspace.catalog.clients); expect(after.catalog.projects).toEqual(fixture.workspace.catalog.projects);
  expect(after.catalog.designs).toEqual(fixture.workspace.catalog.designs); expect(after.projectDocuments).toEqual(fixture.workspace.projectDocuments);
  expect(after.draftDocuments).toEqual(fixture.workspace.draftDocuments); expect(after.fieldDocuments).toEqual(fixture.workspace.fieldDocuments);
  expect(after.surveyCollections).toEqual(fixture.workspace.surveyCollections); expect(after.layoutSessions).toEqual(fixture.workspace.layoutSessions);
  expect(after.tombstones).toEqual(fixture.workspace.tombstones);
  expect(after.originalV1Document).toBe(fixture.workspace.originalV1Document); expect(after.originalPreviousWorkspaceDocument).toBe(fixture.workspace.originalPreviousWorkspaceDocument); sameSource(fixture, after);
  await closeCatalog(page); await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(`Source project.*${name}`));
});

test("invalid field rename reloads through File Review/Restore as its original rename form and requires Recheck", async ({ context, page }) => {
  const fixture = await packageFixture("draft"); await seed(context, fixture); await page.goto("/"); await ready(page); const bytes = await workspaceStorageBytes(page);
  await catalog(page); await page.getByTestId("catalog-rename-field").click();
  // The nested modal owns focus only after RNWeb marks it as the active dialog.
  const name = await activeCatalogFormInput(page, "catalog-dialog-name-input");
  await expect(name).toHaveValue(fixture.workspace.catalog.fieldMaps.find(item => item.id === packageIds.field)!.name);
  await name.fill(""); await expect(name).toHaveValue("");
  await page.getByTestId("catalog-dialog-create").click(); await expect(page.getByTestId("catalog-dialog-error")).toContainText("Enter a name");
  const held = await findFieldRenameCheckpoint(page, "", true); expect(held.candidate.recoveryVersion).toBe(WORKSPACE_EDIT_RECOVERY_VERSION);
  expect(await workspaceStorageBytes(page)).toEqual(bytes); await page.reload(); await ready(page);
  if (await page.getByTestId("workspace-catalog").isVisible()) await closeCatalog(page);
  await file(page, "Recover unfinished work"); const card = recoveryCard(page, held.candidate); await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "Review restore", exact: true }).click();
  await card.getByRole("button", { name: "Restore unfinished work", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close recovery", exact: true })).toBeHidden();
  await expect(page.getByTestId("catalog-dialog")).toContainText("Rename field"); await expect(page.getByTestId("catalog-dialog-name-input")).toHaveValue("");
  await expect(page.getByTestId("catalog-dialog-error")).toHaveText(held.candidate.ui.catalog.form!.error!);
  await fillActiveCatalogFormInput(page, "catalog-dialog-name-input", "Recovered field container", "catalog-dialog", ""); await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog-save-error")).toContainText("Recheck the recovered form"); expect(await workspaceStorageBytes(page)).toEqual(bytes);
  await page.getByTestId("catalog-form-recheck").click(); await page.getByTestId("catalog-dialog-create").click();
  await expect(page.getByTestId("catalog-dialog")).toBeHidden(); const after = await readWorkspace(page);
  expect(after.catalog.fieldMaps.find(item => item.id === packageIds.field)!.name).toBe("Recovered field container");
  expect(after.catalog.fieldMaps).toHaveLength(fixture.workspace.catalog.fieldMaps.length); expect(after.catalog.designs).toEqual(fixture.workspace.catalog.designs);
  expect(after.draftDocuments).toEqual(fixture.workspace.draftDocuments); expect(after.projectDocuments).toEqual(fixture.workspace.projectDocuments);
  expect(after.fieldDocuments).toEqual(fixture.workspace.fieldDocuments); sameSource(fixture, after);
});
