import { expect, test, type Page, type Locator, type AuthenticatedBrowserService } from "./authenticated-test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { argonPasswords } from "../../apps/api/src/passwords";
import { parseDesignDraftDocument } from "../../packages/core/src/designDraft";
import { readWorkspace, readWorkspaceRaw, readAccountPreference } from "./workspace-fixtures";
import { fillActiveCatalogFormInput } from "./catalog-form-readiness";
import { WORKSPACE_EDIT_RECOVERY_KEY } from "../../apps/mobile/src/workspace/workspaceEditRecoveryStore";
import { deniedAccountKey } from "../../apps/mobile/src/auth/deniedAccess";
import { ACCOUNT_TRANSITION_KEY } from "../../apps/mobile/src/auth/authTransition";
import { packageFixture, packageIds, seedPackageWorkspace } from "./workspace-package-fixtures";
import { applyWorkspaceCommand } from "../../packages/project-store/src/workspaceCommands";
import { newDesignDraft } from "../../apps/mobile/src/newDesignDraft";
import { parseSurveyCollectionDocument } from "../../packages/core/src/surveyCollection";
import { parseSurveyReview } from "../../packages/core/src/surveyReview";
import { parseFieldDesignDocument } from "../../packages/core/src/fieldDesignDocument";
import { parseFieldLayoutTarget } from "../../packages/core/src/fieldLayoutTarget";
import { parseLayoutSessionDocument } from "../../packages/core/src/layoutSession";
import { isOfficialLayoutSession } from "../../packages/core/src/officialLayout";
import { connectOperationalReceiver, emitGga, gga, installOperationalReceiver, type ReceiverFixtureWindow } from "./operational-receiver-fixture";
import { seedSyntheticCustomers } from "../../apps/api/src/testHarness";
import { cacheKey } from "../../packages/auth-client/src/cache";
test.use({ signedIn: false, autoContinue: false, actionTimeout: 15_000 });
async function signIn(page: Page, service: AuthenticatedBrowserService) {
  await page.getByTestId("auth-username").fill(service.username); await page.getByTestId("auth-password").fill(service.password);
  await page.getByTestId("auth-submit").click(); await expect(page.getByTestId("auth-project-home")).toBeVisible();
}
async function chooseHomeCustomer(page: Page, customerId: string) {
  await expect(page.getByTestId("auth-project-home")).toBeVisible();
  if (await page.getByTestId(`home-selected-customer-${customerId}`).isVisible()) return;
  if (await page.getByTestId("home-all-customers").isVisible()) await page.getByTestId("home-all-customers").click();
  await page.getByTestId(`home-customer-${customerId}`).click();
  await expect(page.getByTestId(`home-selected-customer-${customerId}`)).toBeVisible();
}
async function withPairedLayoutClock<T>(page: Page, action: () => Promise<T>): Promise<T> {
  await page.evaluate(() => {
    const fixture = window as ReceiverFixtureWindow & { restoreProductionLayoutDate?: () => void };
    if (fixture.restoreProductionLayoutDate) throw new Error("The paired Layout clock is already installed.");
    const nativeDate = Date, wallAnchor = nativeDate.now(), monoAnchor = fixture.operationalReceiver.nowMs;
    const now = () => wallAnchor + fixture.operationalReceiver.nowMs - monoAnchor;
    const pairedDate = new Proxy(nativeDate, {
      construct(target, args, newTarget) { return Reflect.construct(target, args.length ? args : [now()], newTarget); },
      apply(target) { return new target(now()).toString(); },
      get(target, property, receiver) { return property === "now" ? now : Reflect.get(target, property, receiver); },
    });
    globalThis.Date = pairedDate;
    fixture.restoreProductionLayoutDate = () => { globalThis.Date = nativeDate; delete fixture.restoreProductionLayoutDate; };
  });
  try { return await action(); }
  finally { await page.evaluate(() => { (window as ReceiverFixtureWindow & { restoreProductionLayoutDate?: () => void }).restoreProductionLayoutDate?.(); }); }
}
async function newCustomerAndProject(page: Page, mode: "design" | "survey") {
  await page.getByTestId("home-new-customer").click();
  await fillActiveCatalogFormInput(page, "client-profile-first-name-input", "Synthetic", "client-profile-dialog");
  await fillActiveCatalogFormInput(page, "client-profile-last-name-input", "Operator", "client-profile-dialog");
  await fillActiveCatalogFormInput(page, "client-profile-company-input", "Production workflow test farm", "client-profile-dialog");
  await page.getByTestId("client-profile-save").click(); await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  await expect(page.getByTestId("catalog-new")).toHaveText("New project"); await page.getByTestId("catalog-new").click();
  await fillActiveCatalogFormInput(page, "catalog-dialog-name-input", "Actual new project");
  await fillActiveCatalogFormInput(page, "catalog-dialog-first-field-input", "Actual first field");
  await expect(page.getByTestId("catalog-project-crs")).toHaveValue("");
  if (mode === "survey") await page.getByTestId("catalog-start-survey").click();
  await page.getByTestId("catalog-dialog-create").click(); await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  await expect(page.getByTestId(`workspace-mode-${mode}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Production workflow test farm.*Actual new project.*Actual first field/);
}
test("real username/password sign-in rejects anonymous API access and retains the workspace when visiting Home", async ({ page, authenticatedService }) => {
  const customers = await seedSyntheticCustomers(authenticatedService, [{ customerDisplayName: "Actual eastern customer", projectName: "Shared project name" }, { customerDisplayName: "Actual western customer", projectName: "Shared project name" }, { customerDisplayName: "Actual customer without projects" }]);
  const projects = customers.filter(customer => customer.project).map(customer => ({ ...customer, ...customer.project! })), empty = customers.find(customer => !customer.project)!;
  await page.goto("/"); await expect(page.getByTestId("auth-login")).toBeVisible(); await expect(page.getByTestId("unified-workspace")).toHaveCount(0);
  const anonymousStatus = await page.evaluate(async id => (await fetch(`/api/v1/workspaces/${id}`)).status, authenticatedService.workspaceId); expect(anonymousStatus).toBe(401);
  await page.getByTestId("auth-username").fill(authenticatedService.username); await page.getByTestId("auth-password").fill("Incorrect synthetic password"); await page.getByTestId("auth-submit").click();
  await expect(page.getByRole("alert")).toContainText("Username or password is incorrect"); await expect(page.getByTestId("auth-password")).toHaveValue("");
  await signIn(page, authenticatedService);
  await expect(page.getByTestId("home-customer-list")).toBeVisible(); await expect(page.getByTestId(/^home-project-/)).toHaveCount(0);
  for (const customer of customers) await expect(page.getByTestId(`home-customer-folder-${customer.clientId}`)).toContainText(customer.customerDisplayName);
  await chooseHomeCustomer(page, empty.clientId); await expect(page.getByTestId("home-no-projects")).toHaveText("No projects are saved for this customer.");
  await expect(page.getByTestId("home-new-project")).toHaveAttribute("aria-label", `New project for ${empty.customerDisplayName}`);
  await page.getByTestId("home-new-project").click(); await expect(page.getByTestId("catalog-dialog-name-input")).toBeVisible();
  await expect(page.getByTestId(`catalog-client-${empty.clientId}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("catalog-dialog-cancel").click();
  expect((await readWorkspace(page)).catalog.projects.filter(project => project.clientId === empty.clientId)).toEqual([]);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  for (const project of projects) {
    await chooseHomeCustomer(page, project.clientId);
    const row = page.getByTestId(`home-project-${project.projectId}`); await expect(row).toContainText(project.customerDisplayName);
    await expect(row.getByTestId(`home-open-${project.projectId}`)).toHaveAttribute("aria-label", `Open Shared project name for ${project.customerDisplayName}`);
    const other = projects.find(item => item.clientId !== project.clientId)!; await expect(page.getByTestId(`home-project-${other.projectId}`)).toHaveCount(0);
  }
  const initialViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 500 });
  for (const project of projects) {
    await chooseHomeCustomer(page, project.clientId);
    const row = page.getByTestId(`home-project-${project.projectId}`), action = row.getByTestId(`home-open-${project.projectId}`);
    await expect(action).toHaveText("Open"); await action.scrollIntoViewIfNeeded(); await action.focus(); await expect(action).toBeFocused();
    const bounds = (await action.boundingBox())!, card = (await row.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(card.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(Math.min(card.x + card.width, 390) + 1);
    expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(501);
    expect(await action.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.setViewportSize(initialViewport);
  for (const project of projects) {
    await chooseHomeCustomer(page, project.clientId);
    await page.getByTestId(`home-open-${project.projectId}`).click(); await expect(page.getByTestId("workspace-catalog")).toBeVisible();
    await expect(page.getByTestId(`catalog-client-${project.clientId}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`catalog-project-${project.projectId}`)).toHaveAttribute("aria-pressed", "true");
    const other = projects.find(item => item.clientId !== project.clientId)!; await expect(page.getByTestId(`catalog-client-${other.clientId}`)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId(`catalog-project-${other.projectId}`)).toHaveCount(0);
    // With no working document, Catalog is the inline workspace. Its real Home
    // action returns to project choices; a modal Close control is not present.
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.getByTestId("auth-project-home")).toBeVisible();
  }
  const working = projects[0]; await chooseHomeCustomer(page, working.clientId); await page.getByTestId(`home-open-${working.projectId}`).click();
  await expect(page.getByTestId(`catalog-project-${working.projectId}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId(`catalog-field-${working.fieldMapId}`).click(); await page.getByTestId(`catalog-design-open-${working.designId}`).click();
  await expect(page.getByTestId("workspace-catalog")).toBeHidden(); await expect(page.getByTestId("workspace-map-owner")).toHaveCount(1);
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Actual eastern customer.*Shared project name.*Synthetic supplied field/);
  await page.evaluate(() => { (window as Window & { productionMapNode?: Element | null }).productionMapNode = document.querySelector('[data-testid="workspace-map-owner"]'); });
  await page.getByRole("button", { name: "Home", exact: true }).click(); await expect(page.getByTestId("auth-project-home")).toBeVisible();
  await page.getByTestId("home-continue").click(); await expect(page.getByTestId("workspace-common-controls")).toBeVisible();
  expect(await page.evaluate(() => !!(window as Window & { productionMapNode?: Element | null }).productionMapNode
    && (window as Window & { productionMapNode?: Element | null }).productionMapNode === document.querySelector('[data-testid="workspace-map-owner"]'))).toBe(true);
});
test("new customer and project open Design without GPS or fabricated coordinate and machine data", async ({ page, authenticatedService }, info) => {
  await page.goto("/"); await signIn(page, authenticatedService); await newCustomerAndProject(page, "design");
  const source = await readWorkspace(page); expect(source.workspaceVersion).toBe("cplayout-workspace-v5"); expect(source.catalog.projects).toHaveLength(1); expect(source.catalog.fieldMaps).toHaveLength(1); expect(source.catalog.designs).toHaveLength(1);
  expect(source.catalog.projects[0].projectCrs).toBeNull(); const draft = parseDesignDraftDocument(source.draftDocuments[0].document);
  expect(draft.fieldBoundary).toEqual([]); expect(draft.projectCrs).toBeNull(); expect(draft.pivotCenter).toBeNull(); expect(draft.machine).toEqual({});
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await chooseHomeCustomer(page, source.catalog.projects[0].clientId);
  await expect(page.getByTestId(`home-open-${source.catalog.projects[0].id}`)).toBeVisible();
  await page.getByTestId("home-continue").click();
  await page.getByRole("combobox", { name: "Choose field coordinate system", exact: true }).selectOption("EPSG:32613");
  await expect(page.getByTestId("workspace-coordinate-onboarding")).toBeHidden();
  const designTools = page.getByTestId("workspace-tools-toggle"); if (await designTools.getAttribute("aria-label") !== "Hide tools") await designTools.click();
  await page.getByTestId("design-task-drawing").click(); await expect(page.getByTestId("drawing-tool-Polygon")).toBeEnabled();
  await page.getByTestId("drawing-tool-Polygon").click(); await designTools.click();
  const web = page.getByTestId("workspace-map-web-renderer"), svg = page.getByTestId("workspace-map-svg-renderer");
  await expect(web.or(svg)).toHaveCount(1);
  let canvas: Locator;
  if (await web.count()) {
    await expect(web).toHaveAttribute("data-map-loaded", "true"); await expect(web).toHaveAttribute("data-map-settled", "true");
    canvas = web.locator("canvas.maplibregl-canvas");
    await info.attach("manual-design-renderer.json", { body: JSON.stringify({ renderer: "MapLibre", camera: await web.getAttribute("data-map-camera-state") }), contentType: "application/json" });
  } else {
    canvas = svg; await expect(svg).toBeVisible();
    await info.attach("manual-design-renderer.json", { body: JSON.stringify({ renderer: "projected SVG", displayedReason: await page.getByTestId("workspace-map-surface").innerText() }), contentType: "application/json" });
  }
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox(); if (!box) throw new Error("The actual manual Design map is unavailable.");
  for (const [x, y] of [[.25, .35], [.6, .35], [.5, .65]]) {
    const point = { x: box.x + box.width * x, y: box.y + box.height * y };
    expect(await canvas.evaluate((node, point) => node.contains(document.elementFromPoint(point.x, point.y)), point)).toBe(true);
    await page.mouse.click(point.x, point.y);
  }
  await designTools.click(); await page.getByTestId("drawing-finish").click();
  await page.getByTestId("drawing-purpose-select").selectOption("field_boundary"); await page.getByTestId("drawing-classification-keep").click();
  await page.getByTestId("workspace-save").click(); await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  const drawn = parseDesignDraftDocument((await readWorkspace(page)).draftDocuments[0].document);
  expect(drawn.projectCrs).toBe("EPSG:32613"); expect(drawn.fieldBoundary).toHaveLength(3); expect(drawn.pivotCenter).toBeNull(); expect(drawn.machine).toEqual({});
  expect(drawn.drawingMetadata!.records[0].capture.source).toBe("map_digitized"); expect((await readWorkspace(page)).surveyCollections).toEqual([]);
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  await expect(page.getByText("Field work is synchronized.", { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByTestId("auth-project-home")).toBeVisible(); await page.getByTestId("home-continue").click();
  await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  expect(parseDesignDraftDocument((await readWorkspace(page)).draftDocuments[0].document).fieldBoundary).toEqual(drawn.fieldBoundary);
  await page.getByTestId("workspace-mode-survey").click();
  const tools = page.getByTestId("workspace-tools-toggle"); if (await tools.getAttribute("aria-label") !== "Hide tools") await tools.click();
  await expect(page.getByTestId("survey-continue-layout")).toBeDisabled();
  expect((await readWorkspace(page)).surveyReviews).toEqual([]);
});
test("Survey-first project skips manual Design and still requires actual survey evidence before Layout", async ({ page, authenticatedService }) => {
  await page.goto("/"); await signIn(page, authenticatedService); await newCustomerAndProject(page, "survey");
  const source = await readWorkspace(page), draft = parseDesignDraftDocument(source.draftDocuments[0].document);
  expect(draft.fieldBoundary).toEqual([]); expect(draft.surveyPoints).toEqual([]); expect(draft.pivotCenter).toBeNull(); expect(source.surveyReviews).toEqual([]);
  const tools = page.getByTestId("workspace-tools-toggle"); if (await tools.getAttribute("aria-label") !== "Hide tools") await tools.click();
  await expect(page.getByTestId("survey-complete-review")).toBeDisabled(); await expect(page.getByTestId("survey-continue-layout")).toBeDisabled();
});
test("Survey-first recorded boundary and pivot progress through fresh field review to an immutable marked Layout without invented infrastructure", async ({ page, authenticatedService }, info) => {
  await installOperationalReceiver(page, gga());
  await page.goto("/"); await signIn(page, authenticatedService); await newCustomerAndProject(page, "survey");
  const initial = await readWorkspace(page), sourceDesign = initial.catalog.designs[0];
  expect(parseDesignDraftDocument(initial.draftDocuments[0].document).fieldBoundary).toEqual([]);
  expect(initial.projectDocuments).toEqual([]); expect(initial.surveyReviews).toEqual([]);
  await page.getByRole("combobox", { name: "Choose field coordinate system", exact: true }).selectOption("EPSG:32613");
  await expect(page.getByTestId("workspace-coordinate-onboarding")).toBeHidden();
  const tools = page.getByTestId("workspace-tools-toggle"); if (await tools.getAttribute("aria-label") !== "Hide tools") await tools.click();
  // All measured coordinates enter through the actual serial adapter and capture controls.
  // The synthetic receiver proves software admission/retention, never physical accuracy.
  await expect(page.getByTestId("draft-pivot_center-x")).toHaveCount(0); await expect(page.getByTestId("draft-boundary-csv")).toHaveCount(0);
  await page.getByTestId("survey-purpose").selectOption(JSON.stringify({ kind: "field_boundary" })); await page.getByTestId("survey-start").click();
  await page.getByTestId("workspace-receiver-toggle").click(); await connectOperationalReceiver(page);
  await expect(page.getByTestId("workspace-receiver-summary")).toContainText("RTK Fixed");
  for (const [index, sample] of [
    { sentence: null, position: "Position: 40.0000000, -105.0000000" },
    { sentence: gga("120001.00", 4, "GNGGA", "4000.1200"), position: "Position: 40.0020000, -105.0000000" },
    { sentence: gga("120002.00", 4, "GNGGA", "4000.0800", "10500.1200"), position: "Position: 40.0013333, -105.0020000" },
  ].entries()) {
    if (sample.sentence) await emitGga(page, sample.sentence, 1000);
    await expect(page.getByText(sample.position, { exact: true })).toBeVisible(); await expect(page.getByTestId("survey-collect")).toBeEnabled();
    await page.getByTestId("survey-collect").click();
    await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).observations.length).toBe(index + 1);
  }
  await page.getByTestId("survey-apply").click();
  await expect.poll(async () => parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document).state).toBe("applied");
  const boundary = parseSurveyCollectionDocument((await readWorkspace(page)).surveyCollections![0].document);
  expect(boundary.observations.map(point => point.captureEvidence && "gga" in point.captureEvidence ? point.captureEvidence.gga.utcTime : null)).toEqual(["120000.00", "120001.00", "120002.00"]);
  await page.getByTestId("survey-purpose").selectOption(JSON.stringify({ kind: "point", role: "pivot_center" })); await page.getByTestId("survey-start").click();
  await emitGga(page, gga("120003.00", 4, "GNGGA", "4000.0480", "10500.0360"), 1000);
  await expect(page.getByText("Position: 40.0008000, -105.0006000", { exact: true })).toBeVisible(); await expect(page.getByTestId("survey-collect")).toBeEnabled();
  await page.getByTestId("survey-collect").click();
  await expect.poll(async () => (await readWorkspace(page)).surveyCollections!.map(entry => parseSurveyCollectionDocument(entry.document)).find(collection => collection.purpose.kind === "point")?.observations.length).toBe(1);
  const pivot = (await readWorkspace(page)).surveyCollections!.map(entry => parseSurveyCollectionDocument(entry.document)).find(collection => collection.purpose.kind === "point")!.observations[0];
  await page.getByTestId(`survey-use-pivot-${pivot.id}`).click();
  await expect.poll(async () => parseDesignDraftDocument((await readWorkspace(page)).draftDocuments[0].document).infrastructureObservationRefs?.pivot_center).toBe(pivot.id);
  await page.getByTestId("draft-machine-id").fill("supplied-pivot-machine"); await page.getByTestId("draft-machine-name").fill("Supplied pivot machine");
  for (const field of ["overhangMeters", "endGunThrowMeters", "towerClearanceBufferMeters", "machineClearanceBufferMeters"]) await page.getByTestId(`draft-machine-${field}`).fill("0");
  await page.getByTestId("draft-machine-add-span").click(); await page.getByTestId("draft-machine-span-0").fill("200");
  await page.getByRole("radio", { name: "Sweep: Full circle", exact: true }).click(); await page.getByRole("button", { name: "Apply machine", exact: true }).click();
  await page.getByTestId("workspace-save").click(); await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  await page.getByTestId("survey-complete-review").click(); await expect(page.getByTestId("survey-prepare-field")).toBeEnabled();
  const reviewedSource = await readWorkspace(page), sourceDocument = reviewedSource.draftDocuments[0].document;
  const sourceDraft = parseDesignDraftDocument(sourceDocument), originalCollections = reviewedSource.surveyCollections!;
  expect(sourceDraft.fieldBoundary).toEqual(boundary.observations.map(point => point.projected)); expect(sourceDraft.pivotCenter).toEqual(pivot.projected);
  expect(sourceDraft.waterSource).toBeNull(); expect(sourceDraft.powerSource).toBeNull(); expect(sourceDraft.machine.endGunAngleRanges).toBeUndefined();
  const sourceReview = parseSurveyReview(reviewedSource.surveyReviews![0].document);
  expect(sourceReview.owner.designId).toBe(sourceDesign.id); expect(sourceReview.completedBy).toBe(authenticatedService.principalId);
  await page.getByTestId("survey-prepare-field").click();
  await expect.poll(async () => (await readWorkspace(page)).fieldDocuments.length).toBe(1); await expect(page.getByTestId("survey-prepare-field")).toHaveCount(0);
  await expect(page.getByTestId("workspace-mode-survey")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("survey-continue-layout")).toBeDisabled(); await expect(page.getByTestId("workspace-mode-layout")).toBeDisabled();
  const prepared = await readWorkspace(page), fieldDocument = prepared.fieldDocuments[0].document, field = parseFieldDesignDocument(fieldDocument);
  const fieldDesign = prepared.catalog.designs.find(design => design.kind === "field")!;
  expect(prepared.projectDocuments).toEqual([]); expect(prepared.draftDocuments[0].document).toBe(sourceDocument); expect(prepared.surveyReviews).toEqual(reviewedSource.surveyReviews);
  expect(field.infrastructure).toEqual([]); expect(field.fieldBoundary).toEqual(sourceDraft.fieldBoundary); expect(field.fieldBoundaryCaptureEvidence).toEqual(sourceDraft.fieldBoundaryCaptureEvidence);
  expect(field.machines).toHaveLength(1); expect(field.machines[0].pivotCenter).toEqual(pivot.projected); expect(field.machines[0].pivotObservationId).toBe(pivot.id);
  const { id: suppliedId, ...suppliedConfiguration } = sourceDraft.machine;
  expect(field.machines[0].id).toBe(suppliedId); expect(field.machines[0].configuration).toEqual(suppliedConfiguration);
  const conversion = prepared.workflowConversions![0]; expect(conversion.source.document).toBe(sourceDocument); expect(conversion.destination.document).toBe(fieldDocument);
  expect(conversion.collectionMappings).toHaveLength(originalCollections.length); expect(conversion.sourceReviews).toContain(reviewedSource.surveyReviews![0].document);
  for (const original of originalCollections) {
    expect(prepared.surveyCollections!.find(entry => entry.id === original.id)?.document).toBe(original.document);
    const mapping = conversion.collectionMappings.find(entry => entry.sourceId === original.id)!; expect(mapping.sourceDocument).toBe(original.document);
    expect(prepared.surveyCollections!.find(entry => entry.id === mapping.destinationId)?.document).toBe(mapping.destinationDocument);
    expect(parseSurveyCollectionDocument(mapping.destinationDocument).observations).toEqual(parseSurveyCollectionDocument(original.document).observations);
  }
  // Linear work stays in Survey: its actual two recorded endpoints become a saved
  // path, then the operator supplies the member configuration against that path.
  await page.getByTestId("survey-purpose").selectOption(JSON.stringify({ kind: "map_feature", featureKind: "linear_move_path", geometryType: "LineString" }));
  await page.getByTestId("survey-start").click();
  for (const [index, sample] of [
    { sentence: gga("120004.00", 4, "GNGGA", "4000.0480", "10500.0180"), position: "Position: 40.0008000, -105.0003000" },
    { sentence: gga("120005.00", 4, "GNGGA", "4000.0780", "10500.0420"), position: "Position: 40.0013000, -105.0007000" },
  ].entries()) {
    await emitGga(page, sample.sentence, 1000); await expect(page.getByText(sample.position, { exact: true })).toBeVisible();
    await expect(page.getByTestId("survey-collect")).toBeEnabled(); await page.getByTestId("survey-collect").click();
    await expect.poll(async () => (await readWorkspace(page)).surveyCollections!.map(entry => parseSurveyCollectionDocument(entry.document))
      .find(collection => collection.owner.designId === fieldDesign.id && collection.purpose.kind === "map_feature" && collection.purpose.featureKind === "linear_move_path")?.observations.length).toBe(index + 1);
  }
  await page.getByTestId("survey-apply").click();
  await expect.poll(async () => (await readWorkspace(page)).surveyCollections!.map(entry => parseSurveyCollectionDocument(entry.document))
    .find(collection => collection.owner.designId === fieldDesign.id && collection.purpose.kind === "map_feature" && collection.purpose.featureKind === "linear_move_path")?.state).toBe("applied");
  const pathWorkspace = await readWorkspace(page), recordedPathEntry = pathWorkspace.surveyCollections!.find(entry => {
    const collection = parseSurveyCollectionDocument(entry.document); return collection.owner.designId === fieldDesign.id && collection.purpose.kind === "map_feature" && collection.purpose.featureKind === "linear_move_path";
  })!, recordedPath = parseSurveyCollectionDocument(recordedPathEntry.document);
  const savedPath = parseFieldDesignDocument(pathWorkspace.fieldDocuments[0].document).mapFeatures!.find(feature => feature.kind === "linear_move_path")!;
  expect(savedPath.geometry).toEqual({ type: "LineString", vertices: recordedPath.observations.map(point => point.projected) });
  expect(recordedPath.applications[0].target).toEqual({ kind: "map_feature", id: savedPath.id });
  await page.getByTestId("lateral-add").click(); await expect(page.getByTestId("lateral-input-startX")).not.toBeEditable();
  await page.getByTestId(`lateral-path-${savedPath.id}`).click();
  await page.getByTestId("lateral-input-name").fill("Supplied Survey linear machine");
  await page.getByTestId("lateral-input-left").fill("50"); await page.getByTestId("lateral-input-right").fill("75"); await page.getByTestId("lateral-input-clearance").fill("2");
  await expect(page.getByTestId("survey-continue-layout")).toBeDisabled(); await page.getByTestId("lateral-apply").click();
  await page.getByTestId("workspace-save").click(); await expect(page.getByTestId("workspace-save-state")).toHaveText("Saved");
  const suppliedField = parseFieldDesignDocument((await readWorkspace(page)).fieldDocuments[0].document), linear = suppliedField.lateralMachines![0];
  expect(linear.name).toBe("Supplied Survey linear machine"); expect(linear.travel).toEqual({ start: recordedPath.observations[0].projected, end: recordedPath.observations[1].projected });
  expect(linear.waterSourceId).toBeUndefined(); expect(linear.powerSourceId).toBeUndefined(); expect(linear.sprinklerReachMeters).toBeUndefined();
  expect(suppliedField.infrastructure).toEqual([]); expect(suppliedField.machines).toEqual(field.machines); expect(suppliedField.mapFeatures!.find(feature => feature.id === savedPath.id)).toEqual(savedPath);
  expect((await readWorkspace(page)).surveyCollections!.find(entry => entry.id === recordedPath.id)?.document).toBe(recordedPathEntry.document);
  await page.getByTestId("survey-complete-review").click(); await expect(page.getByTestId("survey-continue-layout")).toBeEnabled();
  const reviewedField = await readWorkspace(page), destinationReview = reviewedField.surveyReviews!.map(entry => parseSurveyReview(entry.document)).find(review => review.owner.designId === fieldDesign.id)!;
  expect(destinationReview.id).not.toBe(sourceReview.id); expect(destinationReview.completedBy).toBe(authenticatedService.principalId); expect(destinationReview.sourceDocument).toBe(reviewedField.fieldDocuments[0].document);
  expect(destinationReview.includedCollectionIds).toContain(recordedPath.id);
  await page.getByTestId("survey-continue-layout").click(); await page.getByRole("combobox", { name: "Machine to lay out", exact: true }).selectOption(linear.id);
  await page.getByRole("textbox", { name: "New Layout session name", exact: true }).fill("Survey-first saved Layout");
  const { session, target, both, finalized } = await withPairedLayoutClock(page, async () => {
  // UTC and reception clocks advance together, including both deliberate stale
  // intervals. Fresh samples must pass the real stream-coherence guard.
  await emitGga(page, gga("120005.20", 1), 200); await expect(page.getByTestId("layout-freeze")).toBeDisabled();
  expect((await readWorkspace(page)).layoutSessions).toEqual([]);
  await emitGga(page, gga("120005.30", 4), 100); await expect(page.getByTestId("layout-freeze")).toBeEnabled();
  await page.evaluate(() => { (window as ReceiverFixtureWindow).operationalReceiver.nowMs += 2001; });
  await expect(page.getByTestId("layout-freeze")).toBeDisabled(); expect((await readWorkspace(page)).layoutSessions).toEqual([]);
  await emitGga(page, gga("120007.40", 4), 99); await expect(page.getByTestId("layout-freeze")).toBeEnabled();
  await page.getByTestId("layout-freeze").click(); await expect.poll(async () => (await readWorkspace(page)).layoutSessions!.length).toBe(1);
  const session = parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document), target = parseFieldLayoutTarget(session.targetDocument);
  expect(session.documentVersion).toBe("layout-session-v3"); if (session.documentVersion !== "layout-session-v3") throw new Error("The admitted Layout must retain its actual RTK creation lock.");
  expect(session.creationLock.recordedBy).toBe(authenticatedService.principalId); expect(session.creationLock.evidence.gga.utcTime).toBe("120007.40");
  expect(session.creationLock.evidence.gga.qualityCode).toBe(4); expect(session.creationLock.evidence.physicalQualification).toBe("unverified"); expect(session.finalization).toBeNull();
  await expect(page.getByTestId("layout-official-status")).toHaveText("RTK Layout in progress"); await expect(page.getByTestId("layout-finalize")).toBeDisabled();
  expect(target.documentVersion).toBe("field-layout-target-v2"); expect(target.workflow!.reviewId).toBe(destinationReview.id); expect(target.workflow!.designId).toBe(fieldDesign.id);
  expect(target.source.selectedMachineIds).toEqual([linear.id]); expect(target.field.machines).toEqual(field.machines);
  expect(target.targetPoints).toEqual([{ id: `${linear.id}:lateral_start`, machineId: linear.id, role: "lateral_start", projected: linear.travel.start },
    { id: `${linear.id}:lateral_end`, machineId: linear.id, role: "lateral_end", projected: linear.travel.end }]);
  await page.getByRole("combobox", { name: "Select a Layout point", exact: true }).selectOption(target.targetPoints![0].id);
  await page.getByTestId("layout-tolerance").fill("0.1"); await page.getByTestId("layout-observation-label").fill("Explicit synthetic travel start mark");
  await emitGga(page, gga("120007.50", 1, "GNGGA", "4000.0480", "10500.0180"), 100); await expect(page.getByTestId("layout-collect")).toBeDisabled();
  await emitGga(page, gga("120008.00", 4, "GNGGA", "4000.0480", "10500.0180"), 500); await expect(page.getByTestId("layout-collect")).toBeEnabled();
  await page.getByTestId("layout-collect").click(); await expect.poll(async () => parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document).observations.length).toBe(1);
  const marked = parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document), observation = marked.observations[0];
  expect(marked.targetDocument).toBe(session.targetDocument); expect(marked.targetHash).toBe(session.targetHash); expect(observation.projected).toEqual(linear.travel.start);
  expect(observation.targetPointId).toBe(target.targetPoints![0].id); expect(observation.marking).toMatchObject({ recordedBy: authenticatedService.principalId, assessment: "within_tolerance", residual: { distanceMeters: 0 } });
  expect(observation.marking!.toleranceMeters).toBeGreaterThan(0); expect(observation.evidence.gga.utcTime).toBe("120008.00"); expect(observation.evidence.physicalQualification).toBe("unverified");
  await expect(page.getByTestId("layout-finalize")).toBeDisabled();
  await page.getByRole("combobox", { name: "Select a Layout point", exact: true }).selectOption(target.targetPoints![1].id);
  await page.getByTestId("layout-observation-label").fill("Explicit synthetic travel end mark");
  await emitGga(page, gga("120009.00", 4, "GNGGA", "4000.0780", "10500.0420"), 1000); await expect(page.getByTestId("layout-collect")).toBeEnabled();
  await page.getByTestId("layout-collect").click(); await expect.poll(async () => parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document).observations.length).toBe(2);
  const both = parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document);
  expect(both.observations[1].projected).toEqual(linear.travel.end); expect(both.observations[1].targetPointId).toBe(target.targetPoints![1].id);
  expect(both.observations[1].marking).toMatchObject({ recordedBy: authenticatedService.principalId, assessment: "within_tolerance", toleranceMeters: observation.marking!.toleranceMeters, residual: { distanceMeters: 0 } });
  await expect(page.getByTestId("layout-finalize")).toBeEnabled();
  await emitGga(page, gga("120009.20", 1), 200); await expect(page.getByTestId("layout-finalize")).toBeDisabled();
  await emitGga(page, gga("120009.30", 4), 100); await expect(page.getByTestId("layout-finalize")).toBeEnabled();
  await page.evaluate(() => { (window as ReceiverFixtureWindow).operationalReceiver.nowMs += 2001; });
  await expect(page.getByTestId("layout-finalize")).toBeDisabled();
  expect(isOfficialLayoutSession(parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document))).toBe(false);
  await emitGga(page, gga("120011.40", 4), 99); await expect(page.getByTestId("layout-finalize")).toBeEnabled(); await page.getByTestId("layout-finalize").click();
  await expect(page.getByTestId("layout-official-status")).toHaveText("Official recorded RTK stations"); await expect(page.getByTestId("layout-collect")).toBeDisabled();
  const finalized = parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions![0].document);
  if (finalized.documentVersion !== "layout-session-v3") throw new Error("Finalization must retain the V3 RTK receipt.");
  expect(isOfficialLayoutSession(finalized)).toBe(true); expect(finalized.targetDocument).toBe(session.targetDocument); expect(finalized.targetHash).toBe(session.targetHash);
  expect(finalized.observations).toEqual(both.observations); expect(finalized.finalization!.lock.recordedBy).toBe(authenticatedService.principalId);
  expect(finalized.finalization!.lock.evidence.gga.utcTime).toBe("120011.40"); expect(finalized.finalization!.lock.evidence.physicalQualification).toBe("unverified");
  expect(finalized.finalization!.targetObservationIds).toEqual(target.targetPoints!.map((point, index) => ({ targetPointId: point.id, observationId: both.observations[index].id })));
  await page.getByTestId("layout-discard-tolerance").click(); await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  return { session, target, both, finalized };
  });
  // The native wall clock is restored before real session synchronization and
  // signed-grant preparation; only this synthetic RTK stage uses paired time.
  await page.getByRole("button", { name: "Sync", exact: true }).click();
  // This journey retains 21 admitted commands. Wait for their actual durable
  // acknowledgments before checking completion and the shared exact document.
  await expect.poll(() => page.evaluate(partition => {
    const retained = localStorage.getItem(partition); if (!retained) throw new Error("The actual account cache is unavailable.");
    return JSON.parse(retained).queue.length;
  }, authenticatedService.partition), { timeout: 30_000 }).toBe(0);
  await expect(page.getByText("Field work is synchronized.", { exact: true })).toBeVisible({ timeout: 30_000 });
  const shared = await authenticatedService.database.transaction(transaction => transaction.workspace(authenticatedService.workspaceId));
  expect(shared).not.toBeNull(); expect(await readWorkspaceRaw(page)).toBe(shared!.document);
  const acknowledged = parseLayoutSessionDocument((await readWorkspace(page)).layoutSessions!.find(saved => saved.id === session.id)!.document);
  expect(acknowledged).toEqual(finalized); expect(isOfficialLayoutSession(acknowledged)).toBe(true);
  await page.getByRole("button", { name: "Customers & projects", exact: true }).click();
  await expect(page.getByTestId(`catalog-field-${fieldDesign.fieldMapId}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("catalog-content-survey").click(); await page.getByTestId(`catalog-survey-${sourceReview.id}`).click();
  await expect(page.getByTestId(`catalog-layout-open-${session.id}`)).toHaveCount(0);
  await page.getByTestId(`catalog-survey-${destinationReview.id}`).click(); await expect(page.getByTestId(`catalog-layout-open-${session.id}`)).toBeVisible();
  await page.getByTestId(`catalog-layout-open-${session.id}`).click(); await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  await page.getByRole("button", { name: "Prepare offline work", exact: true }).click(); await expect(page.getByText("Offline field access is prepared for 24 hours.", { exact: true })).toBeVisible();
  const durable = await readWorkspace(page), durableRaw = await readWorkspaceRaw(page);
  await page.route("**/api/v1/**", route => route.abort("internetdisconnected")); await page.reload();
  await expect(page.getByTestId("auth-login")).toBeHidden(); await expect(page.getByTestId("workspace-common-controls")).toBeVisible();
  const reopenedTools = page.getByTestId("workspace-tools-toggle"); if (await reopenedTools.getAttribute("aria-label") !== "Hide tools") await reopenedTools.click();
  await expect(page.getByTestId("layout-official-status")).toHaveText("Official recorded RTK stations"); await expect(page.getByTestId("layout-collect")).toBeDisabled();
  const reopened = await readWorkspace(page); expect(await readWorkspaceRaw(page)).toBe(durableRaw); expect(reopened.draftDocuments).toEqual(durable.draftDocuments);
  expect(reopened.fieldDocuments).toEqual(durable.fieldDocuments); expect(reopened.surveyCollections).toEqual(durable.surveyCollections); expect(reopened.surveyReviews).toEqual(durable.surveyReviews); expect(reopened.layoutSessions).toEqual(durable.layoutSessions);
  await page.getByTestId("command-menu-workspace-file").click(); const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export Layout session & saved observations (JSON)", exact: true }).click();
  const download = await downloading, downloadPath = await download.path(); expect(downloadPath).toBeTruthy();
  expect(parseLayoutSessionDocument(await readFile(downloadPath!, "utf8"))).toEqual(finalized); expect(await readWorkspaceRaw(page)).toBe(durableRaw);
  await info.attach("survey-first-layout-evidence.json", { body: JSON.stringify({ sourceDesignId: sourceDesign.id, preparedFieldDesignId: fieldDesign.id,
    reviews: [sourceReview.id, destinationReview.id], targetVersion: target.documentVersion, sessionVersion: finalized.documentVersion,
    recordedTimes: [...boundary.observations.map(point => point.captureEvidence && "gga" in point.captureEvidence ? point.captureEvidence.gga.utcTime : null), "120003.00", "120004.00", "120005.00", session.creationLock.evidence.gga.utcTime, ...both.observations.map(point => point.evidence.gga.utcTime), finalized.finalization!.lock.evidence.gga.utcTime], physicalQualification: "unverified" }), contentType: "application/json" });
});
test("Support cannot read field data through the server even with a supplied workspace membership", async ({ page, authenticatedService }) => {
  const password = randomBytes(24).toString("base64url"), id = randomUUID();
  await authenticatedService.database.addUser({ id, username: "synthetic-support", displayName: "Synthetic Support", roles: ["support"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, authenticatedService.workspaceId, ["field:read", "field:write"]);
  await page.goto("/"); await page.getByTestId("auth-username").fill("synthetic-support"); await page.getByTestId("auth-password").fill(password); await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-project-home")).toBeVisible();
  const denied = await page.evaluate(async id => (await fetch(`/api/v1/workspaces/${id}`)).status, authenticatedService.workspaceId); expect(denied).toBe(403);
  await expect(page.getByTestId("home-continue")).toHaveCount(0); await expect(page.getByTestId("workspace-map-surface")).toHaveCount(0);
  await expect(page.getByText("Your account has no field workspace access. Contact your administrator.", { exact: true })).toBeVisible();
});
test("prepared offline reload verifies the signed grant and rejects tampering while retaining exact field data", async ({ page, authenticatedService }) => {
  await page.goto("/"); await signIn(page, authenticatedService); await newCustomerAndProject(page, "design");
  await page.getByRole("button", { name: "Prepare offline work", exact: true }).click(); await expect(page.getByText("Offline field access is prepared for 24 hours.", { exact: true })).toBeVisible();
  const original = await readWorkspaceRaw(page);
  await page.route("**/api/v1/**", route => route.abort("internetdisconnected")); await page.reload();
  await expect(page.getByTestId("auth-login")).toBeHidden(); await expect(page.getByTestId("workspace-common-controls")).toBeVisible(); expect(await readWorkspaceRaw(page)).toBe(original);
  await page.evaluate(partition => { const work = JSON.parse(localStorage.getItem(partition)!); const grant = JSON.parse(work.authorization.grant.payload); grant.subject = "forged-subject"; work.authorization.grant.payload = JSON.stringify(grant); localStorage.setItem(partition, JSON.stringify(work)); }, authenticatedService.partition);
  await page.reload(); await expect(page.getByTestId("auth-login")).toBeVisible(); expect(await readWorkspaceRaw(page)).toBe(original);
});
test("short narrow sign-in keeps focused credentials, submit and help reachable without horizontal overflow", async ({ page, authenticatedService }) => {
  await page.setViewportSize({ width: 320, height: 400 }); await page.goto("/");
  const username = page.getByTestId("auth-username"), password = page.getByTestId("auth-password");
  await username.fill(authenticatedService.username); await username.press("Tab"); await expect(password).toBeFocused();
  await password.fill(authenticatedService.password); await password.scrollIntoViewIfNeeded(); await expect(password).toBeVisible();
  await page.getByTestId("auth-submit").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId("auth-submit").click(); await expect(page.getByTestId("auth-project-home")).toBeVisible();
});
test("service denial preserves unfinished customer modal before hiding it for renewed sign-in", async ({ page, authenticatedService }) => {
  await page.goto("/"); await signIn(page, authenticatedService); await page.getByTestId("home-new-customer").click();
  await fillActiveCatalogFormInput(page, "client-profile-first-name-input", "  Immediate retained first  ", "client-profile-dialog");
  await fillActiveCatalogFormInput(page, "client-profile-last-name-input", "  Immediate retained last  ", "client-profile-dialog");
  const original = await readWorkspaceRaw(page);
  await authenticatedService.database.transaction(async transaction => transaction.updateUserAccess(authenticatedService.principalId, ["admin"], false));
  await page.getByTestId("client-profile-save").click();
  await expect(page.getByTestId("auth-login")).toBeVisible(); await expect(page.getByTestId("client-profile-dialog")).toBeHidden();
  await expect.poll(() => readAccountPreference(page, WORKSPACE_EDIT_RECOVERY_KEY)).toContain("  Immediate retained first  ");
  expect(await readWorkspaceRaw(page)).toBe(original);
  await page.getByTestId("auth-username").fill(authenticatedService.username); await page.getByTestId("auth-password").fill(authenticatedService.password); await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-login")).toBeHidden();
  await expect(page.getByTestId("client-profile-dialog")).toBeVisible();
  await expect(page.getByTestId("client-profile-first-name-input")).toHaveValue("  Immediate retained first  ");
  await expect(page.getByTestId("client-profile-last-name-input")).toHaveValue("  Immediate retained last  ");
});
test("cold service session denial prevents subsequent offline grant revival while retaining exact work", async ({ page, authenticatedService }) => {
  await page.goto("/"); await signIn(page, authenticatedService); await newCustomerAndProject(page, "design");
  await page.getByRole("button", { name: "Prepare offline work", exact: true }).click(); await expect(page.getByText("Offline field access is prepared for 24 hours.", { exact: true })).toBeVisible();
  const original = await readWorkspaceRaw(page);
  await authenticatedService.database.transaction(async transaction => transaction.updateUserAccess(authenticatedService.principalId, ["admin"], false));
  await page.reload(); await expect(page.getByTestId("auth-login")).toBeVisible();
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), deniedAccountKey(authenticatedService.principalId))).toBe("denied");
  await page.route("**/api/v1/**", route => route.abort("internetdisconnected")); await page.reload();
  await expect(page.getByTestId("auth-login")).toBeVisible(); await expect(page.getByTestId("workspace-map-surface")).toHaveCount(0);
  expect(await readWorkspaceRaw(page)).toBe(original);
  expect(await page.evaluate(partition => JSON.parse(localStorage.getItem(partition)!).authorization, authenticatedService.partition)).toBeNull();
});
test("post-login device quota reconciles service identity and then isolates a read-only operator account", async ({ page, authenticatedService }) => {
  const password = randomBytes(24).toString("base64url"), userId = randomUUID(), workspaceId = randomUUID();
  await authenticatedService.database.transaction(async transaction => {
    const source = await transaction.workspace(authenticatedService.workspaceId); if (!source) throw new Error("Synthetic workspace source missing.");
    await transaction.insertWorkspace({ ...source, id: workspaceId, name: "Separate operator workspace" });
  });
  await authenticatedService.database.addUser({ id: userId, username: "synthetic-readonly", displayName: "Read-only Operator", roles: ["operator"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, workspaceId, ["field:read"]);
  await page.goto("/"); await signIn(page, authenticatedService); await newCustomerAndProject(page, "design");
  await authenticatedService.database.transaction(async transaction => transaction.updateUserAccess(authenticatedService.principalId, ["admin"], false));
  await page.getByRole("button", { name: "Sync", exact: true }).click(); await expect(page.getByTestId("auth-login")).toBeVisible();
  const original = await readWorkspaceRaw(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key: string, value: string) { if (key === "cplayout.account-hint-v1") { Storage.prototype.setItem = original; throw new DOMException("Synthetic metadata quota", "QuotaExceededError"); } return original.call(this, key, value); };
  });
  await page.getByTestId("auth-username").fill("synthetic-readonly"); await page.getByTestId("auth-password").fill(password); await page.getByTestId("auth-submit").click();
  await expect(page.getByRole("alert")).toContainText("Sign-in could not retain this account safely");
  expect(await page.evaluate(async () => (await fetch("/api/v1/session")).status)).toBe(401);
  expect(await page.evaluate(key => localStorage.getItem(key), ACCOUNT_TRANSITION_KEY)).toBe("pending"); expect(await readWorkspaceRaw(page)).toBe(original);
  await page.getByTestId("auth-password").fill(password); await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("auth-project-home")).toBeVisible();
  await expect(page.getByText("Separate operator workspace", { exact: true })).toBeVisible();
  await expect(page.getByTestId("home-new-customer")).toBeDisabled(); await expect(page.getByTestId("home-customers")).toBeEnabled();
  await expect(page.getByTestId(/^home-open-/)).toHaveCount(0); expect(await readWorkspaceRaw(page)).toBe(original);
});

test("actual Catalog customer archive and restore retain field history through an acknowledged status-read failure", async ({ context, page, authenticatedService }) => {
  const fixture = await packageFixture("field"), draft = { ...newDesignDraft("maintenance-blank-draft", "Retained blank Draft", "metric"), projectCrs: "EPSG:32613" };
  fixture.workspace = applyWorkspaceCommand(fixture.workspace, { type: "create_design_draft", now: new Date().toISOString(), designId: "maintenance-blank-design", fieldMapId: packageIds.field, name: draft.name, draft }).workspace;
  await seedPackageWorkspace(context, fixture);
  await page.goto("/"); await signIn(page, authenticatedService); await page.getByTestId("home-customers").click();
  await expect(page.getByTestId("workspace-catalog")).toBeVisible(); await page.getByTestId(`catalog-client-${packageIds.customer}`).click();
  await expect(page.getByTestId(`maintenance-customer-${packageIds.customer}`)).toBeEnabled();
  const original = await readWorkspace(page), protectedHistory = (value: typeof original) => ({ projectDocuments: value.projectDocuments, draftDocuments: value.draftDocuments,
    fieldDocuments: value.fieldDocuments, surveyCollections: value.surveyCollections, layoutSessions: value.layoutSessions, tombstones: value.tombstones });
  let acknowledged = false, failedRead = false;
  const receipt = (response: import("@playwright/test").Response) => { if (response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/archive") && response.status() === 200) acknowledged = true; };
  page.on("response", receipt);
  await page.route("**/api/v1/workspaces/*/archive-state", async route => {
    if (acknowledged && !failedRead) { failedRead = true; return route.abort("internetdisconnected"); } return route.fallback();
  });
  await page.getByTestId(`maintenance-customer-${packageIds.customer}`).click();
  await expect(page.getByTestId("maintenance-confirmation")).toContainText("Archive Source customer?"); await page.getByTestId("maintenance-confirm").click();
  await expect(page.getByTestId("maintenance-message")).toContainText("The service saved this archive action"); expect(failedRead).toBe(true);
  const retained = await page.evaluate(partition => JSON.parse(localStorage.getItem(partition)!), authenticatedService.partition);
  expect(retained.document).toBe(JSON.stringify(original)); expect(retained.archives).toBeUndefined();
  expect(retained.archiveReceipt).toMatchObject({ entityId: packageIds.customer, kind: "customer", archived: true, revision: original.revision + 1 });
  await page.getByTestId("maintenance-cancel").click(); await page.getByTestId("maintenance-refresh").click();
  await expect(page.getByTestId(`catalog-client-${packageIds.customer}`)).toHaveCount(0);
  await page.getByTestId("catalog-show-archived").click(); await expect(page.getByTestId(`catalog-client-${packageIds.customer}`)).toContainText("Archived");
  await page.getByTestId(`catalog-client-${packageIds.customer}`).click();
  await expect(page.getByTestId(`maintenance-customer-${packageIds.customer}`)).toHaveAttribute("aria-label", "Restore customer");
  await page.getByTestId(`maintenance-customer-${packageIds.customer}`).click(); await page.getByTestId("maintenance-confirm").click();
  await expect(page.getByTestId("maintenance-message")).toContainText("Restored.");
  expect(protectedHistory(await readWorkspace(page))).toEqual(protectedHistory(original));
  await page.getByTestId("catalog-show-archived").click(); await expect(page.getByTestId(`catalog-client-${packageIds.customer}`)).toBeVisible();
  await expect(page.getByTestId(`catalog-client-${packageIds.customer}`)).not.toContainText("Archived");
  page.off("response", receipt);
});

test("two actual App pages serialize sign-out response cookies before a newer username/password sign-in", async ({ context, page, authenticatedService }) => {
  const password = randomBytes(24).toString("base64url"), id = randomUUID();
  await authenticatedService.database.addUser({ id, username: "two-page-operator", displayName: "Two-page Operator", roles: ["operator"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, authenticatedService.workspaceId, ["field:read"]);
  await page.goto("/");
  const other = await context.newPage(); await other.goto("/"); await expect(other.getByTestId("auth-login")).toBeVisible();
  await signIn(page, authenticatedService);
  await expect.poll(() => readWorkspaceRaw(page)).not.toBeNull(); const originalAccountDocument = await readWorkspaceRaw(page);
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), received = new Promise<void>(resolve => { entered = resolve; });
  await page.route("**/api/v1/session/logout", async route => {
    const request = route.request(), response = await authenticatedService.api.inject({ method: "POST", url: "/api/v1/session/logout", headers: await request.allHeaders(), payload: request.postData() ?? undefined });
    expect(response.statusCode).toBe(200); entered(); await held;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) if (value !== undefined && !["content-length", "connection", "transfer-encoding"].includes(key)) headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
    await route.fulfill({ status: response.statusCode, headers, body: response.body });
  });
  try {
    await page.getByRole("button", { name: "Sign out", exact: true }).click(); await received;
    await expect(other.getByTestId("auth-login")).toBeVisible();
    await other.getByTestId("auth-username").fill("two-page-operator"); await other.getByTestId("auth-password").fill(password); await other.getByTestId("auth-submit").click();
    await expect(other.getByTestId("auth-submit")).toHaveText("Signing in…");
    await expect.poll(() => other.evaluate(async () => (await navigator.locks.query()).pending?.some(lock => lock.name?.startsWith("cplayout:credentials:web:")) ?? false)).toBe(true);
    release(); const home = other.getByTestId("auth-project-home"); await expect(home).toBeVisible(); await expect(home.getByText("Two-page Operator", { exact: true })).toBeVisible();
    expect(await other.evaluate(async () => (await (await fetch("/api/v1/session")).json()).principal.id)).toBe(id);
    expect(await other.evaluate(async workspaceId => (await fetch(`/api/v1/workspaces/${workspaceId}`)).status, authenticatedService.workspaceId)).toBe(200);
    const newPartition = cacheKey(id, authenticatedService.workspaceId);
    await expect.poll(() => other.evaluate(key => { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw).subject : null; }, newPartition)).toBe(id);
    const nextAccount = await other.evaluate(key => JSON.parse(localStorage.getItem(key)!), newPartition);
    expect(nextAccount.workspaceId).toBe(authenticatedService.workspaceId); expect(nextAccount.document).toBe(originalAccountDocument); expect(nextAccount.queue).toEqual([]);
    expect(await readWorkspaceRaw(page)).toBe(originalAccountDocument);
    await expect(page.getByTestId("auth-login")).toBeVisible();
  } finally { release(); await other.close(); }
});
