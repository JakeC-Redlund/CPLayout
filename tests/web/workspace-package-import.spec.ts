import { expect, test, type Page, type TestInfo } from "./authenticated-test";
import { readFile } from "node:fs/promises";
import { isRecordedReferenceMetadataRecord } from "../../packages/core/src/drawingMetadata";
import { parseSurveyCollectionDocument } from "../../packages/core/src/surveyCollection";
import { parseLayoutSessionDocument } from "../../packages/core/src/layoutSession";
import { buildDesignWorkspaceBundle, importDesignWorkspaceBundleZip, parseDesignWorkspaceBundle } from "../../packages/project-store/src/designWorkspaceBundle";
import { parseWorkspaceDocument, serializeWorkspaceDocument, upgradeWorkspaceDocumentToV5, type WorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { packageFixture, packageIds, seedPackageWorkspace, sourcePayload } from "./workspace-package-fixtures";
import { readWorkspace, workspaceStorageBytes, browseDesignParents } from "./workspace-fixtures";

// Actual default App → browser download → actual file chooser → saved import →
// explicit Open → reload/Recent/Open. No controller, archive or store replacement.
// Imported historical Survey fixtures establish software preservation only.
test.use({ actionTimeout: 15_000 });
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ context, page, baseURL }) => {
  pageErrors.set(page, []); page.on("pageerror", error => pageErrors.get(page)!.push(error.message));
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page) ?? []).toEqual([]); });

async function showTools(page: Page) {
  const toggle = page.getByTestId("workspace-tools-toggle");
  await expect(toggle).toBeEnabled();
  if (await toggle.getAttribute("aria-label") !== "Hide tools") await toggle.click();
  await expect(page.getByTestId("workspace-mode-tools")).toBeVisible();
}
async function showCatalog(page: Page) {
  if (!await page.getByTestId("workspace-catalog").isVisible()) await page.getByRole("button", { name: "Customers & projects", exact: true }).first().click();
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
}
async function openRecent(page: Page, id: string) {
  await showCatalog(page); await browseDesignParents(page, id); await page.getByTestId(`catalog-recent-open-${id}`).click();
  // Open preserves the current mode; this helper requests Design tools explicitly.
  await page.getByTestId("workspace-mode-design").click();
  await showTools(page); await expect(page.getByTestId("unified-design-panel")).toBeVisible();
}
async function reloadSavedWorkspace(page: Page) {
  await page.reload();
  // Wait for the saved owner and restored hidden Catalog before the explicit
  // Customers & projects → Recent/Open journey begins.
  await expect(page.getByTestId("workspace-save")).toBeEnabled();
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
  await expect(page.getByTestId("workspace-catalog")).toBeHidden();
}
async function downloadPackage(page: Page, format: "json" | "zip", info: TestInfo) {
  const before = await readWorkspace(page);
  await page.getByTestId("command-menu-workspace-file").click();
  const pending = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: `Export complete design workspace (${format.toUpperCase()})`, exact: true }).click();
  const download = await pending, path = info.outputPath(`actual-downloaded-design-workspace.${format}`);
  expect(download.suggestedFilename()).toBe(`design-workspace.${format}`);
  await download.saveAs(path);
  const bytes = await readFile(path);
  const bundle = format === "zip" ? importDesignWorkspaceBundleZip(bytes) : parseDesignWorkspaceBundle(bytes.toString("utf8"));
  expect(await readWorkspace(page)).toEqual(before);
  return { path, bytes, bundle };
}
async function upload(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await showCatalog(page);
  const pending = page.waitForEvent("filechooser"); await page.getByTestId("catalog-import").click();
  await (await pending).setFiles(file);
  await expect(page.getByTestId("catalog-import-review")).toBeVisible();
}
async function assertImportPresentation(page: Page, collections: number) {
  await expect(page.getByTestId("catalog-import-review")).toContainText(`Design and Survey package: ${collections} retained Survey collections`);
  await expect(page.getByTestId("catalog-import-review")).toContainText("Layout sessions are exported separately in RTK Layout.");
  await expect(page.getByTestId("workspace-import-field-package-destination-field-a")).toHaveAttribute("aria-label", "Customer Alpha → Duplicated project → Duplicated field");
  await expect(page.getByTestId(`workspace-import-field-${packageIds.destination}`)).toHaveAttribute("aria-label", "Customer Beta → Duplicated project → Duplicated field");
}
async function prepareStorageStep(page: Page) {
  const before = await readWorkspace(page), rawBefore = (await workspaceStorageBytes(page))[0];
  expect(rawBefore).toBe(serializeWorkspaceDocument(before));
  if (rawBefore === null) throw new Error("The actual saved import source is missing.");
  const expected = upgradeWorkspaceDocumentToV5(rawBefore);
  await expect(page.getByTestId("workspace-import-prepare")).toBeEnabled(); await page.getByTestId("workspace-import-prepare").click();
  await expect.poll(async () => readWorkspace(page)).toEqual(expected);
  await expect(page.getByTestId("workspace-catalog")).toContainText("Saved field work is prepared. Import saved copy will now save the package separately.");
  await expect(page.getByTestId("workspace-import-save")).toBeEnabled();
  const after = await readWorkspace(page); expect(after.workspaceVersion).toBe("cplayout-workspace-v5"); assertExistingPreserved(before, after, rawBefore);
  expect(after.catalog).toEqual(before.catalog);
  const v4 = parseWorkspaceDocument(after.originalWorkflowUpgradeDocument!);
  expect(v4.workspaceVersion).toBe("cplayout-workspace-v4");
  if (before.workspaceVersion === "cplayout-workspace-v4") {
    expect(after.originalWorkflowUpgradeDocument).toBe(rawBefore);
  } else {
    const v3 = parseWorkspaceDocument(v4.originalSurveyUpgradeDocument!); expect(v3.workspaceVersion).toBe("cplayout-workspace-v3");
    if (before.workspaceVersion === "cplayout-workspace-v3") expect(v4.originalSurveyUpgradeDocument).toBe(rawBefore);
    else expect(v3.originalPreviousWorkspaceDocument).toBe(rawBefore);
  }
  expect(after.surveyReviews).toEqual([]); expect(after.workflowConversions).toEqual([]); await expect(page.getByTestId("workspace-import-prepare")).toHaveCount(0);
  expect(after).toEqual(expected); return after;
}
async function saveImport(page: Page, before: WorkspaceDocument) {
  await page.getByTestId(`workspace-import-field-${packageIds.destination}`).click();
  await page.getByTestId("workspace-import-save").click();
  await expect(page.getByTestId("workspace-import-open")).toBeVisible();
  const after = await readWorkspace(page);
  const added = after.catalog.designs.filter(design => !before.catalog.designs.some(source => source.id === design.id));
  expect(added).toHaveLength(1);
  expect(added[0].fieldMapId).toBe(packageIds.destination);
  expect(after.catalog.fieldMaps.find(field => field.id === added[0].fieldMapId)?.projectId).toBe("package-project-b");
  expect(after.catalog.projects.find(project => project.id === "package-project-b")?.clientId).toBe("package-customer-b");
  return { after, copyId: added[0].id };
}
function assertExistingPreserved(before: WorkspaceDocument, after: WorkspaceDocument, exactUpgradeSource?: string) {
  for (const key of ["clients", "projects", "fieldMaps"] as const) expect(after.catalog[key]).toEqual(before.catalog[key]);
  expect(after.catalog.designs.filter(item => before.catalog.designs.some(source => source.id === item.id))).toEqual(before.catalog.designs);
  expect(after.projectDocuments.filter(item => before.projectDocuments.some(source => source.summary.id === item.summary.id))).toEqual(before.projectDocuments);
  for (const key of ["draftDocuments", "fieldDocuments", "layoutSessions", "surveyCollections"] as const)
    expect((after[key] ?? []).filter(item => (before[key] ?? []).some(source => source.id === item.id))).toEqual(before[key] ?? []);
  for (const key of ["tombstones", "originalV1Document"] as const) expect(after[key]).toEqual(before[key]);
  if ((before.workspaceVersion === "cplayout-workspace-v1" || before.workspaceVersion === "cplayout-workspace-v2")
    && ["cplayout-workspace-v3", "cplayout-workspace-v4", "cplayout-workspace-v5"].includes(after.workspaceVersion)) {
    expect(exactUpgradeSource).toBeDefined(); expect(after.originalPreviousWorkspaceDocument).toBe(exactUpgradeSource);
  }
  else expect(after.originalPreviousWorkspaceDocument).toBe(before.originalPreviousWorkspaceDocument);
  // The real v3→v4 upgrade introduces empty collection/archive arrays. Retained
  // entries and the exact predecessor remain authoritative, including when empty.
  expect(after.surveyOwnerArchives ?? []).toEqual(before.surveyOwnerArchives ?? []);
  if (before.workspaceVersion === "cplayout-workspace-v4") expect(after.originalSurveyUpgradeDocument).toBe(before.originalSurveyUpgradeDocument);
  else if (before.workspaceVersion === "cplayout-workspace-v3" && ["cplayout-workspace-v4", "cplayout-workspace-v5"].includes(after.workspaceVersion)) {
    expect(exactUpgradeSource).toBeDefined(); expect(after.originalSurveyUpgradeDocument).toBe(exactUpgradeSource);
  }
  if (before.layoutSessions?.length) {
    const oldLayout = parseLayoutSessionDocument(before.layoutSessions[0].document), newLayout = parseLayoutSessionDocument(after.layoutSessions![0].document);
    expect(newLayout.targetDocument).toBe(oldLayout.targetDocument); expect(newLayout.targetHash).toBe(oldLayout.targetHash);
  }
  expect(after.layoutSessions ?? []).toEqual(before.layoutSessions ?? []);
}
function assertDerivedDisplayCache(actual: unknown, expected: unknown, path = "wgs84Companion") {
  // projectDocument.ts recomputes this display cache from exact canonical XY.
  // Only latitude/longitude leaves get a 1e-12 degree Node/Chromium rounding
  // allowance; structure, provenance, CRS, radii and every other leaf stay exact.
  // This numerical cache comparison makes no physical GNSS accuracy claim.
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
function assertCopy(before: WorkspaceDocument, after: WorkspaceDocument, sourceId: string, copyId: string) {
  assertExistingPreserved(before, after);
  const source = sourcePayload(before, sourceId), copy = sourcePayload(after, copyId);
  expect(copy.source.kind).toBe(source.source.kind); expect(copy.source.payloadId).not.toBe(source.source.payloadId);
  expect(copy.source.design.id).not.toBe(sourceId); expect(copy.source.originalProjectDocument).toBe(source.source.originalProjectDocument);
  const originals = (before.surveyCollections ?? []).map(entry => parseSurveyCollectionDocument(entry.document)).filter(collection => collection.owner.designId === sourceId);
  const copies = (after.surveyCollections ?? []).map(entry => parseSurveyCollectionDocument(entry.document)).filter(collection => collection.owner.designId === copyId);
  expect(copies).toHaveLength(originals.length); expect(after.surveyCollections ?? []).toHaveLength((before.surveyCollections?.length ?? 0) + originals.length);
  const mapping = new Map<string, string>();
  originals.forEach(original => {
    const copied = copies.find(item => item.observations[0]?.id === original.observations[0]?.id);
    expect(copied).toBeDefined(); expect(copied!.id).not.toBe(original.id); mapping.set(original.id, copied!.id);
    expect(copied).toEqual({ ...original, id: copied!.id, revision: 0,
      owner: { ...original.owner, designId: copyId, payloadId: copy.source.payloadId, fieldMapId: packageIds.destination } });
    expect(copied!.observations).toEqual(original.observations); expect(copied!.applications).toEqual(original.applications);
  });
  expect(new Set(copies.map(collection => collection.id)).size).toBe(copies.length);
  const expected = structuredClone(source.data); expected.id = copy.source.payloadId;
  for (const record of expected.drawingMetadata?.records ?? []) if (isRecordedReferenceMetadataRecord(record) && record.attachment)
    record.attachment.collectionId = mapping.get(record.attachment.collectionId)!;
  if (source.source.kind === "project") {
    const actualCache = "wgs84Companion" in copy.data ? copy.data.wgs84Companion : undefined;
    const expectedCache = "wgs84Companion" in expected ? expected.wgs84Companion : undefined;
    expect(expectedCache).toMatchObject({ source: "derived_from_project_xy" });
    assertDerivedDisplayCache(actualCache, expectedCache);
    // Every canonical coordinate, source metadata and non-cache value is exact.
    expect({ ...copy.data, wgs84Companion: expectedCache }).toEqual(expected);
  } else expect(copy.data).toEqual(expected);
  expect(copy.data.drawingMetadata?.retainedReferenceOrigins).toEqual(source.data.drawingMetadata?.retainedReferenceOrigins);
  if (originals.length) {
    expect(copy.data.drawingMetadata!.retainedReferenceOrigins).toHaveLength(2);
    expect(copy.data.mapFeatures?.some(feature => feature.id === "reference-deleted")).toBe(false);
    expect(copy.data.drawingMetadata!.records.filter(isRecordedReferenceMetadataRecord)).toHaveLength(1);
  }
  if (source.source.kind === "field") {
    expect("machines" in copy.data && copy.data.machines).toEqual("machines" in source.data && source.data.machines);
    expect(copy.source.originalProjectDocument).toBeTruthy();
  }
  expect(after.catalog.designs).toHaveLength(before.catalog.designs.length + 1);
  expect(after.projectDocuments.length + after.draftDocuments.length + (after.fieldDocuments?.length ?? 0)).toBe(before.projectDocuments.length + before.draftDocuments.length + (before.fieldDocuments?.length ?? 0) + 1);
  return copies;
}
async function assertOpenedContext(page: Page, name: string) {
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", new RegExp(`Customer Beta.*Duplicated project.*Duplicated field.*${name}`));
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
}

for (const kind of ["draft", "project", "field"] as const) for (const format of ["json", "zip"] as const)
test(`${kind} actual ${format.toUpperCase()} download uploads retained history to distinct saved copy and reloads Recent/Open`, async ({ context, page }, info) => {
  const fixture = await packageFixture(kind); await seedPackageWorkspace(context, fixture); await page.goto("/"); await openRecent(page, fixture.designId);
  const before = await readWorkspace(page), file = await downloadPackage(page, format, info);
  expect(file.bundle).toEqual(buildDesignWorkspaceBundle(before, fixture.designId));
  await upload(page, file.path);
  await assertImportPresentation(page, file.bundle.surveyDocuments.length);
  await expect(page.getByTestId("workspace-import-prepare")).toHaveCount(0);
  const { after, copyId } = await saveImport(page, before);
  expect(after.revision).toBe(before.revision + 1); const copies = assertCopy(before, after, fixture.designId, copyId);
  await page.getByTestId("workspace-import-open").click(); await showTools(page);
  const copyName = sourcePayload(after, copyId).data.name; await assertOpenedContext(page, copyName);
  await page.getByTestId("workspace-mode-survey").click();
  const current = copies.find(collection => collection.observations[0].id === "current-a")!;
  await page.getByTestId("survey-collection").selectOption(current.id); await page.getByTestId("survey-reference-details").click();
  await expect(page.getByTestId("survey-reference-name")).toHaveValue("Exact current reference  ");
  await expect(page.getByTestId("survey-reference-notes")).toHaveValue("Original reference notes\nretained");
  await expect(page.getByTestId("survey-reference-provenance")).toHaveText("Recorded Survey reference — original observations retained.");
  expect(await readWorkspace(page)).toEqual(after);
  await reloadSavedWorkspace(page); await openRecent(page, copyId); await assertOpenedContext(page, copyName);
  expect(await readWorkspace(page)).toEqual(after); assertCopy(before, await readWorkspace(page), fixture.designId, copyId);
  await page.getByTestId("workspace-mode-survey").click(); await page.getByTestId("survey-collection").selectOption(current.id);
  await page.getByTestId("survey-reference-details").click(); await expect(page.getByTestId("survey-reference-name")).toHaveValue("Exact current reference  ");
});

for (const format of ["json", "zip"] as const)
test(`actual ${format.toUpperCase()} package without Survey history imports without fabricated collections`, async ({ context, page, authenticatedService }, info) => {
  const fixture = await packageFixture("draft", false); await seedPackageWorkspace(context, fixture); await page.goto("/"); await openRecent(page, fixture.designId);
  const before = await readWorkspace(page), file = await downloadPackage(page, format, info); expect(file.bundle.surveyDocuments).toEqual([]);
  await upload(page, file.path); await assertImportPresentation(page, 0); await page.getByTestId(`workspace-import-field-${packageIds.destination}`).click();
  const originalReceiptCount = authenticatedService.database.state.receipts.length;
  const prepared = await prepareStorageStep(page);
  const { after, copyId } = await saveImport(page, prepared); expect(after.revision).toBe(prepared.revision + 1);
  const receipts = authenticatedService.database.state.receipts.slice(originalReceiptCount);
  expect(receipts.map(receipt => JSON.parse(receipt.responseDocument).revision)).toEqual([prepared.revision, after.revision]);
  assertCopy(prepared, after, fixture.designId, copyId); expect(after.surveyCollections).toEqual([]);
  await page.getByTestId("workspace-import-open").click(); await showTools(page); await assertOpenedContext(page, sourcePayload(after, copyId).data.name);
  await reloadSavedWorkspace(page); await openRecent(page, copyId); expect(await readWorkspace(page)).toEqual(after);
});

for (const version of ["v1", "v2"] as const)
test(`${version} actual package prepares the retained Field/Layout/Survey chain before one saved-copy import`, async ({ context, page, authenticatedService }, info) => {
  const fixture = await packageFixture("draft", false, version); await seedPackageWorkspace(context, fixture); await page.goto("/"); await openRecent(page, fixture.designId);
  const file = await downloadPackage(page, "json", info); await upload(page, file.path); await assertImportPresentation(page, 0);
  await page.getByTestId(`workspace-import-field-${packageIds.destination}`).click();
  const original = await readWorkspace(page), rawBefore = await workspaceStorageBytes(page); expect(original.workspaceVersion).toBe(`cplayout-workspace-${version}`);
  await page.getByTestId("workspace-import-save").click();
  await expect(page.getByTestId("workspace-catalog")).toContainText("Prepare storage for this import before saving the copy.");
  expect(await workspaceStorageBytes(page)).toEqual(rawBefore);
  const originalReceiptCount = authenticatedService.database.state.receipts.length, prepared = await prepareStorageStep(page);
  expect(prepared.catalog.designs).toEqual(original.catalog.designs); expect(prepared.originalPreviousWorkspaceDocument).toBe(rawBefore[0]);
  const { after, copyId } = await saveImport(page, prepared); expect(after.revision).toBe(prepared.revision + 1);
  const receipts = authenticatedService.database.state.receipts.slice(originalReceiptCount);
  expect(receipts.map(receipt => JSON.parse(receipt.responseDocument).revision)).toEqual([prepared.revision, after.revision]);
  assertCopy(prepared, after, fixture.designId, copyId); expect(after.surveyCollections).toEqual([]);
  await page.getByTestId("workspace-import-open").click(); await showTools(page); await assertOpenedContext(page, sourcePayload(after, copyId).data.name);
  await reloadSavedWorkspace(page); await openRecent(page, copyId); expect(await readWorkspace(page)).toEqual(after);
});

test("v3 actual storage Prepare refuses wrong CRS without an upgrade or any byte change", async ({ context, page }, info) => {
  const fixture = await packageFixture("draft", false); await seedPackageWorkspace(context, fixture); await page.goto("/"); await openRecent(page, fixture.designId);
  const file = await downloadPackage(page, "json", info); await upload(page, file.path);
  await page.getByTestId(`workspace-import-field-${packageIds.wrongCrs}`).click();
  const before = await workspaceStorageBytes(page), workspace = await readWorkspace(page);
  await page.getByTestId("workspace-import-prepare").click();
  await expect(page.getByTestId("workspace-catalog")).toContainText("Destination project CRS must exactly match");
  await expect(page.getByTestId("workspace-import-prepare")).toBeEnabled(); await expect(page.getByTestId("workspace-import-open")).toHaveCount(0);
  expect(await workspaceStorageBytes(page)).toEqual(before); expect(await readWorkspace(page)).toEqual(workspace);
  expect(workspace.workspaceVersion).toBe("cplayout-workspace-v3");
});

for (const replacement of ["unknown", "corrupt"] as const)
test(`actual upload of ${replacement} replacement retires previously admitted package without records`, async ({ context, page }, info) => {
  const fixture = await packageFixture("draft"); await seedPackageWorkspace(context, fixture); await page.goto("/"); await openRecent(page, fixture.designId);
  const file = await downloadPackage(page, "json", info), before = await workspaceStorageBytes(page);
  await upload(page, file.path); await page.getByTestId(`workspace-import-field-${packageIds.destination}`).click();
  await expect(page.getByTestId("workspace-import-save")).toBeEnabled();
  const rejected = replacement === "unknown" ? { bundleVersion: "future-unknown-package" } : { ...file.bundle, designDocument: file.bundle.designDocument + " " };
  await upload(page, { name: `${replacement}-replacement.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(rejected)) });
  await expect(page.getByTestId("catalog-import-review")).toContainText("No file is admitted");
  await expect(page.getByTestId("workspace-import-save")).toHaveCount(0); await expect(page.getByTestId("workspace-import-open")).toHaveCount(0);
  expect(await workspaceStorageBytes(page)).toEqual(before);
  // A new real selection is required after rejection; its success cannot revive
  // any cached prior candidate or silently create extra copies.
  await upload(page, file.path); const workspace = await readWorkspace(page), result = await saveImport(page, workspace);
  assertCopy(workspace, result.after, fixture.designId, result.copyId);
});

for (const version of ["v3", "v4"] as const)
test(`${version} actual complete upload refuses mismatched CRS atomically including workspace version`, async ({ context, page }, info) => {
  const fixture = await packageFixture("draft", version === "v4"); await seedPackageWorkspace(context, fixture); await page.goto("/"); await openRecent(page, fixture.designId);
  const file = await downloadPackage(page, "json", info); await upload(page, file.path);
  await page.getByTestId(`workspace-import-field-${packageIds.wrongCrs}`).click();
  const before = await workspaceStorageBytes(page), workspace = await readWorkspace(page); expect(workspace.workspaceVersion).toBe(`cplayout-workspace-${version}`);
  await page.getByTestId("workspace-import-save").click();
  await expect(page.getByText(/Destination project CRS must exactly match/)).toBeVisible();
  await expect(page.getByTestId("workspace-import-save")).toBeEnabled(); await expect(page.getByTestId("workspace-import-open")).toHaveCount(0);
  expect(await workspaceStorageBytes(page)).toEqual(before); expect(await readWorkspace(page)).toEqual(workspace);
  await expect(page.getByTestId("catalog-import-review")).toContainText("actual-downloaded-design-workspace.json");
});

test("actual saved-copy Open refuses dirty current input and retains raw text until explicit Discard", async ({ context, page }, info) => {
  const fixture = await packageFixture("draft"); await seedPackageWorkspace(context, fixture); await page.goto("/"); await openRecent(page, fixture.designId);
  const file = await downloadPackage(page, "zip", info), before = await readWorkspace(page);
  await page.getByTestId("design-task-inputs").click(); const input = page.getByTestId("draft-machine-span-0"), original = await input.inputValue();
  await input.fill("unfinished 12' x  "); await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply");
  await upload(page, file.path); const { after, copyId } = await saveImport(page, before); assertCopy(before, after, fixture.designId, copyId);
  await page.getByTestId("workspace-import-open").click();
  await expect(page.getByTestId("workspace-catalog")).toContainText("Open was blocked. Save or preserve your current work before opening this design.");
  expect(await readWorkspace(page)).toEqual(after);
  await page.getByTestId("catalog-close").click(); await expect(page.getByTestId("workspace-catalog")).toBeHidden(); await showTools(page);
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Source customer.*Source project.*Source field/);
  await expect(input).toHaveValue("unfinished 12' x  "); await expect(page.getByTestId("workspace-save-state")).toHaveText("Inputs awaiting Apply");
  await page.getByTestId("draft-inputs-discard").click(); await expect(input).toHaveValue(original);
  await openRecent(page, copyId); await assertOpenedContext(page, sourcePayload(after, copyId).data.name);
  expect(await readWorkspace(page)).toEqual(after);
});
