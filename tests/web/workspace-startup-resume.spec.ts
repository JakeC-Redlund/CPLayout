import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { parseUnifiedWorkspaceResume, UNIFIED_WORKSPACE_RESUME_KEY, type UnifiedWorkspaceResume } from "../../apps/mobile/src/navigation/unifiedWorkspaceResume";
import { parseFieldLayoutTarget } from "../../packages/core/src/fieldLayoutTarget";
import { parseLayoutSessionDocument } from "../../packages/core/src/layoutSession";
import { parseSurveyCollectionDocument } from "../../packages/core/src/surveyCollection";
import { sha256Text } from "../../packages/core/src/sha256";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { serializeWorkspaceDocument, type WorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { packageFixture, packageIds, seedPackageWorkspace, sourcePayload } from "./workspace-package-fixtures";
import { readWorkspace, workspaceKey, workspaceStorageBytes } from "./workspace-fixtures";

// Real default App, durable repository-created source records, and the strict v2
// preference boundary. No controller/store replacement, public Open restoration,
// raw-input/undo/camera recovery, or physical receiver qualification is asserted.
test.use({ actionTimeout: 15_000 });
type Fixture = Awaited<ReturnType<typeof packageFixture>>;
const emptySelection = { clientId: null, projectId: null, fieldMapId: null, designId: null };
const sourceSelection = (id: string) => ({ clientId: packageIds.customer, projectId: packageIds.project, fieldMapId: packageIds.field, designId: id });
const destinationSelection = { clientId: "package-customer-b", projectId: "package-project-b", fieldMapId: packageIds.destination, designId: null };
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ context, page, baseURL }) => {
  // This suite measures projected SVG geometry; keep that renderer deterministic.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (contextId: string, ...options: unknown[]) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return Reflect.apply(original, this, [contextId, ...options]);
    } as typeof original;
  });
  errors.set(page, []); page.on("pageerror", error => errors.get(page)!.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
});
test.afterEach(async ({ page }) => { expect(errors.get(page) ?? []).toEqual([]); });

function hintFor(fixture: Fixture, overrides: Partial<UnifiedWorkspaceResume> = {}): UnifiedWorkspaceResume {
  const { source, data } = sourcePayload(fixture.workspace, fixture.designId);
  const session = parseLayoutSessionDocument(fixture.workspace.layoutSessions!.find(item => item.id === packageIds.layout)!.document);
  return parseUnifiedWorkspaceResume({ version: 2, catalogVisible: false, catalogSelection: sourceSelection(fixture.designId),
    workspace: { mode: "survey", design: { designId: fixture.designId, documentKind: source.kind, payloadId: source.payloadId,
      fieldMapId: source.design.fieldMapId, projectCrs: data.projectCrs },
    layout: { sessionId: session.id, fieldMapId: session.fieldMapId, projectCrs: parseFieldLayoutTarget(session.targetDocument).field.projectCrs, targetHash: session.targetHash },
    collectionId: "source-current" }, ...overrides });
}
async function seed(context: BrowserContext, fixture: Fixture, hint: UnifiedWorkspaceResume | string | null) {
  if (hint !== null) fixture.values.set(UNIFIED_WORKSPACE_RESUME_KEY, typeof hint === "string" ? hint : JSON.stringify(hint));
  await seedPackageWorkspace(context, fixture);
}
const rawHint = (page: Page) => page.evaluate(key => localStorage.getItem(key), UNIFIED_WORKSPACE_RESUME_KEY);
async function acceptedHint(page: Page, expected: UnifiedWorkspaceResume) {
  await expect.poll(() => rawHint(page)).toBe(JSON.stringify(expected));
  expect(parseUnifiedWorkspaceResume((await rawHint(page))!)).toEqual(expected);
}
async function tools(page: Page) {
  const toggle = page.getByTestId("workspace-tools-toggle"); await expect(toggle).toBeEnabled();
  if (await toggle.getAttribute("aria-label") !== "Hide tools") await toggle.click();
  await expect(page.getByTestId("workspace-mode-tools")).toBeVisible();
}
async function catalog(page: Page) {
  if (!await page.getByTestId("workspace-catalog").isVisible()) await page.getByRole("button", { name: "Customers & projects", exact: true }).first().click();
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
}
async function disconnected(page: Page) {
  await expect(page.getByTestId("workspace-receiver-summary")).toHaveText("Receiver: idle · Data: waiting · Fix unknown");
  await expect(page.getByTestId("workspace-common-receiver")).toBeHidden();
}
async function restored(page: Page, fixture: Fixture, mode: "design" | "survey" | "layout") {
  await expect(page.getByTestId(`workspace-mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(`Source customer.*Source project.*Source field.*${sourcePayload(fixture.workspace, fixture.designId).data.name}`));
  await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  await disconnected(page);
}
async function assertSeedUnchanged(page: Page, fixture: Fixture) {
  const expected = [workspaceKey, "center-pivot-layout-projects-v1", "center-pivot-layout-project-catalog-v1", "center-pivot-layout-workspace-legacy-backup-v1"]
    .map(key => key === workspaceKey ? serializeWorkspaceDocument(fixture.workspace) : fixture.values.get(key) ?? null);
  expect(await workspaceStorageBytes(page)).toEqual(expected);
  expect(await readWorkspace(page)).toEqual(fixture.workspace);
  const saved = sourcePayload(await readWorkspace(page), fixture.designId), original = sourcePayload(fixture.workspace, fixture.designId);
  expect(saved.source.document).toBe(original.source.document); expect(saved.data).toEqual(original.data);
  expect(saved.source.originalProjectDocument).toBe(original.source.originalProjectDocument);
  expect((await readWorkspace(page)).surveyCollections).toEqual(fixture.workspace.surveyCollections);
  const layout = parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document);
  expect(layout).toEqual(parseLayoutSessionDocument(fixture.workspace.layoutSessions![0].document));
  expect(sha256Text(layout.targetDocument)).toBe(layout.targetHash);
}
async function assertFrozenGeometry(page: Page, workspace: WorkspaceDocument) {
  const session = parseLayoutSessionDocument(workspace.layoutSessions!.find(item => item.id === packageIds.layout)!.document);
  const target = parseFieldLayoutTarget(session.targetDocument), boundary = target.field.fieldBoundary;
  const machine = target.field.machines.find(item => item.id === target.source.selectedMachineIds[0])!;
  expect(target.source.selectedMachineIds).toEqual(["package-unequal-machine"]);
  expect(sha256Text(session.targetDocument)).toBe(session.targetHash);
  const renderer = page.getByTestId("workspace-map-svg-renderer"); await expect(renderer).toBeVisible();
  // Independently compare the full rendered projected shape. Solve its affine
  // screen transform from two boundary points, then verify every other vertex
  // and selected unequal pivot. This does not assert any restored camera value.
  const polygons = await renderer.locator('polygon[stroke="#184932"]:not([stroke-dasharray])').evaluateAll(nodes => nodes.map(node => node.getAttribute("points")!));
  const points = polygons.map(value => value.trim().split(/\s+/).map(pair => pair.split(",").map(Number)))
    .find(values => values.length === boundary.length);
  expect(points).toBeDefined();
  const second = boundary.findIndex(point => point.x !== boundary[0].x); expect(second).toBeGreaterThan(0);
  const scale = (points![second][0] - points![0][0]) / (boundary[second].x - boundary[0].x);
  expect(Number.isFinite(scale)).toBe(true); expect(scale).toBeGreaterThan(0);
  const originX = points![0][0] - scale * boundary[0].x, originY = points![0][1] + scale * boundary[0].y;
  boundary.forEach((point, index) => {
    expect(points![index][0]).toBeCloseTo(originX + scale * point.x, 7);
    expect(points![index][1]).toBeCloseTo(originY - scale * point.y, 7);
  });
  const pivot = renderer.locator("g").filter({ has: page.locator("text").filter({ hasText: machine.configuration.name }) }).locator("circle");
  await expect(pivot).toHaveCount(1);
  expect(Number(await pivot.getAttribute("cx"))).toBeCloseTo(originX + scale * machine.pivotCenter.x, 7);
  expect(Number(await pivot.getAttribute("cy"))).toBeCloseTo(originY - scale * machine.pivotCenter.y, 7);
  await expect(renderer.locator("text").filter({ hasText: target.field.machines[0].configuration.name })).toHaveCount(0);
}

for (const kind of ["draft", "project", "field"] as const)
test(`${kind} automatically reloads the exact saved design, Survey collection and immutable histories`, async ({ context, page }) => {
  const fixture = await packageFixture(kind), hint = hintFor(fixture); await seed(context, fixture, hint); await page.goto("/");
  await restored(page, fixture, "survey"); await expect(page.getByTestId("workspace-catalog")).toBeHidden(); await tools(page);
  await expect(page.getByTestId("survey-collection")).toHaveValue("source-current");
  await page.getByTestId("survey-reference-details").click();
  await expect(page.getByTestId("survey-reference-name")).toHaveValue("Exact current reference  ");
  await expect(page.getByTestId("survey-reference-notes")).toHaveValue("Original reference notes\nretained");
  await expect(page.getByTestId("survey-reference-provenance")).toHaveText("Recorded Survey reference — original observations retained.");
  const collections = fixture.workspace.surveyCollections!.map(entry => parseSurveyCollectionDocument(entry.document));
  expect(collections.filter(item => item.applications.length > 0)).toHaveLength(2);
  expect(sourcePayload(fixture.workspace, fixture.designId).data.drawingMetadata!.retainedReferenceOrigins).toHaveLength(2);
  await assertSeedUnchanged(page, fixture); expect(await rawHint(page)).toBe(JSON.stringify(hint));
  await page.reload(); await restored(page, fixture, "survey"); await tools(page);
  await expect(page.getByTestId("survey-collection")).toHaveValue("source-current");
  await assertSeedUnchanged(page, fixture); expect(await rawHint(page)).toBe(JSON.stringify(hint));
});

test("dual-subject startup retains the exact Layout target and acknowledges Layout and Design saves separately", async ({ context, page }) => {
  const fixture = await packageFixture("field"), base = hintFor(fixture), hint = { ...base, workspace: { ...base.workspace, mode: "layout" as const } };
  await seed(context, fixture, hint); await page.goto("/"); await restored(page, fixture, "layout"); await tools(page);
  await expect(page.getByTestId("unified-layout-panel")).toContainText("Machines: Unequal second pivot");
  await assertFrozenGeometry(page, fixture.workspace); await assertSeedUnchanged(page, fixture);
  // Immediate Save must use the restored owner, without an explicit public Open.
  await page.getByTestId("workspace-save").click(); await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  await assertSeedUnchanged(page, fixture);
  await page.getByRole("button", { name: "Session details & actions", exact: true }).click();
  await expect(page.getByTestId("unified-layout-panel")).toContainText(`Target hash: ${hint.workspace.layout!.targetHash}`);
  await page.getByRole("textbox", { name: "Layout session name", exact: true }).fill("Separately acknowledged Layout");
  await page.getByTestId("workspace-save").click();
  await expect.poll(async () => parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document).name).toBe("Separately acknowledged Layout");
  const afterLayout = await readWorkspace(page), originalLayout = fixture.workspace.layoutSessions![0];
  expect(afterLayout.fieldDocuments).toEqual(fixture.workspace.fieldDocuments);
  expect(afterLayout.surveyCollections).toEqual(fixture.workspace.surveyCollections);
  const renamedLayout = parseLayoutSessionDocument(afterLayout.layoutSessions![0].document), frozen = parseLayoutSessionDocument(originalLayout.document);
  expect(renamedLayout.targetDocument).toBe(frozen.targetDocument); expect(renamedLayout.targetHash).toBe(frozen.targetHash); expect(renamedLayout.observations).toEqual(frozen.observations);
  await page.getByTestId("workspace-mode-design").click();
  await page.getByTestId("command-menu-workspace-file").click(); await page.getByRole("menuitem", { name: "Rename current design", exact: true }).click();
  await page.getByRole("textbox", { name: "Design name", exact: true }).fill("Separately acknowledged Design");
  await page.getByRole("button", { name: "Apply name", exact: true }).click(); await page.getByTestId("workspace-save").click();
  await expect.poll(async () => sourcePayload(await readWorkspace(page), fixture.designId).data.name).toBe("Separately acknowledged Design");
  const afterDesign = await readWorkspace(page), beforeSource = sourcePayload(fixture.workspace, fixture.designId), afterSource = sourcePayload(afterDesign, fixture.designId);
  expect({ ...afterSource.data, name: beforeSource.data.name }).toEqual(beforeSource.data);
  expect(afterSource.source.originalProjectDocument).toBe(beforeSource.source.originalProjectDocument);
  expect(afterDesign.layoutSessions).toEqual(afterLayout.layoutSessions); expect(afterDesign.surveyCollections).toEqual(fixture.workspace.surveyCollections);
  await acceptedHint(page, { ...hint, workspace: { ...hint.workspace, mode: "design" } });
  await page.reload(); await expect(page.getByTestId("workspace-mode-design")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Separately acknowledged Design/);
  await page.getByTestId("workspace-mode-layout").click(); await tools(page); await assertFrozenGeometry(page, afterDesign);
  await expect(page.getByTestId("unified-layout-panel")).toContainText("Separately acknowledged Layout");
  expect(await readWorkspace(page)).toEqual(afterDesign); await disconnected(page);
});

test("Browse remains separate from Open and startup restores catalog selection and visibility after source reset", async ({ context, page }) => {
  const fixture = await packageFixture("draft"), hint = hintFor(fixture, { catalogVisible: true, catalogSelection: destinationSelection });
  await seed(context, fixture, hint); await page.goto("/"); await restored(page, fixture, "survey");
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
  for (const [prefix, id] of [["client", destinationSelection.clientId], ["project", destinationSelection.projectId], ["field", destinationSelection.fieldMapId]])
    await expect(page.getByTestId(`catalog-${prefix}-${id}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("catalog-new")).toHaveAttribute("aria-label", "New design");
  await page.getByTestId("catalog-close").click(); await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  await tools(page); await expect(page.getByTestId("survey-collection")).toHaveValue("source-current");
  await assertSeedUnchanged(page, fixture);
  await acceptedHint(page, { ...hint, catalogVisible: false });
  await page.reload(); await restored(page, fixture, "survey"); await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  await catalog(page); await expect(page.getByTestId(`catalog-field-${packageIds.destination}`)).toHaveAttribute("aria-pressed", "true");
  await assertSeedUnchanged(page, fixture);
});

for (const archived of [false, true])
test(`Layout-only startup ${archived ? "keeps archived collection disabled" : "opens without an editable design"} and preserves frozen geometry`, async ({ context, page }) => {
  const fixture = await packageFixture("draft");
  if (archived) fixture.workspace = applyWorkspaceCommand(fixture.workspace, { type: "archive_layout_session", now: "2026-10-11T12:00:00.000Z",
    sessionId: packageIds.layout, expectedSessionRevision: 0, archived: true }).workspace;
  const base = hintFor(fixture), hint = { ...base, catalogSelection: { ...sourceSelection(fixture.designId), designId: null },
    workspace: { ...base.workspace, mode: "layout" as const, design: null, collectionId: null } };
  await seed(context, fixture, hint); await page.goto("/");
  await expect(page.getByTestId("workspace-mode-layout")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Layout session: Frozen existing Layout$/);
  await expect(page.getByTestId("workspace-catalog")).toBeHidden(); await tools(page);
  await expect(page.getByTestId("layout-collect")).toBeDisabled(); await assertFrozenGeometry(page, fixture.workspace);
  if (archived) await expect(page.getByTestId("layout-readiness")).toHaveText("Restore this session to collect.");
  await page.getByTestId("workspace-mode-design").click();
  // A Layout-only owner can keep its frozen map visible in other modes; no
  // editable design or Design Save target may be manufactured from that target.
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1); await expect(page.getByTestId("workspace-save")).toBeDisabled();
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Layout session: Frozen existing Layout$/);
  expect(await readWorkspace(page)).toEqual(fixture.workspace); await disconnected(page);
  await page.getByTestId("workspace-mode-layout").click(); await page.reload(); await tools(page);
  await assertFrozenGeometry(page, fixture.workspace); expect(await readWorkspace(page)).toEqual(fixture.workspace);
});

for (const group of ["absent/malformed", "deleted/foreign"] as const)
test(`${group} startup hints fall back without preference or workspace-byte writes`, async ({ context, page }) => {
  const fixture = await packageFixture("draft"), valid = hintFor(fixture);
  const deleted = applyWorkspaceCommand(fixture.workspace, { type: "archive_and_delete_design", now: "2026-10-11T12:00:00.000Z", designId: fixture.designId,
    expectedDesignRevision: fixture.workspace.catalog.designs.find(item => item.id === fixture.designId)!.revision,
    collectionIds: fixture.workspace.surveyCollections!.map(entry => parseSurveyCollectionDocument(entry.document)).filter(item => item.owner.designId === fixture.designId)
      .map(item => ({ id: item.id, expectedRevision: item.revision })) }).workspace;
  const cases = group === "absent/malformed" ? [{ name: "absent", raw: null, workspace: fixture.workspace }, { name: "malformed", raw: JSON.stringify({ ...valid, unexpected: "reject" }), workspace: fixture.workspace }]
    : [{ name: "deleted", raw: JSON.stringify({ ...valid, workspace: { ...valid.workspace, layout: null } }), workspace: deleted },
      { name: "foreign", raw: JSON.stringify({ ...valid, workspace: { ...valid.workspace, design: { ...valid.workspace.design!, payloadId: "foreign-payload" }, layout: null } }), workspace: fixture.workspace }];
  await seed(context, fixture, null); await page.goto("/"); await expect(page.getByTestId("workspace-catalog")).toBeVisible();
  for (const item of cases) await test.step(item.name, async () => {
    await page.evaluate(({ workspaceRaw, raw, key, preference }) => {
      localStorage.setItem(key, workspaceRaw); if (raw === null) localStorage.removeItem(preference); else localStorage.setItem(preference, raw);
    }, { workspaceRaw: serializeWorkspaceDocument(item.workspace), raw: item.raw, key: workspaceKey, preference: UNIFIED_WORKSPACE_RESUME_KEY });
    const bytes = await workspaceStorageBytes(page); await page.reload();
    await expect(page.getByTestId("workspace-catalog")).toBeVisible(); await expect(page.getByTestId("catalog-refresh")).toBeEnabled();
    await expect(page.getByTestId("workspace-map-surface")).toHaveCount(0); await expect(page.getByTestId("workspace-save")).toBeDisabled();
    expect(await workspaceStorageBytes(page)).toEqual(bytes); expect(await rawHint(page)).toBe(item.raw);
    expect(await readWorkspace(page)).toEqual(item.workspace); await disconnected(page);
  });
});

test("operator Open, mode, collection, Browse and catalog visibility publish accepted hints that reload automatically", async ({ context, page }) => {
  const fixture = await packageFixture("draft"), base = hintFor(fixture), expected = { ...base, workspace: { ...base.workspace, layout: null, collectionId: null, mode: "design" as const } };
  await seed(context, fixture, null); await page.goto("/"); await expect(page.getByTestId("workspace-catalog")).toBeVisible();
  await page.getByTestId(`catalog-recent-open-${fixture.designId}`).click(); await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  await acceptedHint(page, { ...expected, catalogSelection: emptySelection });
  await page.getByTestId("workspace-mode-survey").click(); await tools(page);
  await page.getByTestId("survey-collection").selectOption("source-pending");
  const survey = { ...expected, catalogSelection: emptySelection, workspace: { ...expected.workspace, mode: "survey" as const, collectionId: "source-pending" } };
  await acceptedHint(page, survey); await catalog(page);
  await page.getByTestId("catalog-client-package-customer-b").click(); await page.getByTestId("catalog-project-package-project-b").click();
  await page.getByTestId(`catalog-field-${packageIds.destination}`).click();
  const visible = { ...survey, catalogSelection: destinationSelection, catalogVisible: true }; await acceptedHint(page, visible);
  await page.reload(); await restored(page, fixture, "survey"); await expect(page.getByTestId("workspace-catalog")).toBeVisible();
  await expect(page.getByTestId(`catalog-field-${packageIds.destination}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("catalog-close").click(); await acceptedHint(page, { ...visible, catalogVisible: false });
  await tools(page); await expect(page.getByTestId("survey-collection")).toHaveValue("source-pending");
  await page.reload(); await restored(page, fixture, "survey"); await tools(page); await expect(page.getByTestId("survey-collection")).toHaveValue("source-pending");
  await assertSeedUnchanged(page, fixture);
});

for (const refusal of ["dirty input", "externally deleted destination"] as const)
test(`${refusal} Open refusal keeps the previous accepted hint and saved source exact`, async ({ context, page }) => {
  const fixture = await packageFixture("draft"), base = hintFor(fixture), hint = { ...base, workspace: { ...base.workspace, mode: "design" as const } };
  await seed(context, fixture, hint); await page.goto("/"); await restored(page, fixture, "design"); await tools(page);
  if (refusal === "dirty input") {
    await page.getByTestId("design-task-inputs").click(); await page.getByTestId("draft-machine-span-0").fill("unfinished 12' x  ");
    await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply");
  }
  await catalog(page); const accepted = await rawHint(page); const target = page.getByTestId("catalog-recent-open-package-base-design"); await expect(target).toBeVisible();
  let expectedWorkspace = fixture.workspace;
  if (refusal === "externally deleted destination") {
    // A real valid external repository command invalidates the rendered old Open
    // entry. Only durable seed bytes change; no method or read result is mocked.
    const record = fixture.workspace.catalog.designs.find(item => item.id === "package-base-design")!;
    expectedWorkspace = applyWorkspaceCommand(fixture.workspace, { type: "delete_design", now: "2026-10-11T12:00:00.000Z", designId: record.id, expectedDesignRevision: record.revision }).workspace;
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: workspaceKey, raw: serializeWorkspaceDocument(expectedWorkspace) });
  }
  const bytes = await workspaceStorageBytes(page); await target.click();
  await expect(page.getByTestId("workspace-catalog")).toContainText("Open was blocked. Save or preserve your current work before opening this design.");
  expect(await rawHint(page)).toBe(accepted); expect(await workspaceStorageBytes(page)).toEqual(bytes);
  expect(await readWorkspace(page)).toEqual(expectedWorkspace);
  expect(sourcePayload(expectedWorkspace, fixture.designId).source.document).toBe(sourcePayload(fixture.workspace, fixture.designId).source.document);
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Saved Draft package/);
  await page.getByTestId("catalog-close").click(); await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  if (refusal === "dirty input") { await tools(page); await expect(page.getByTestId("draft-machine-span-0")).toHaveValue("unfinished 12' x  "); }
  await disconnected(page);
});
