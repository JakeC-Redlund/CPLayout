import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { defaultProjectSettings, parseProjectDocument, sampleProject, serializeProjectDocument } from "../../packages/core/src/index";
import { normalizeProjectCatalog } from "../../packages/project-store/src/projectCatalog";
import {
  buildProjectRecoveryArchiveBundle,
  exportProjectArchiveZip,
  importProjectArchiveZip,
} from "../../packages/project-store/src/projectArchive";

async function importZip(page: Page, testId: string, bytes: Uint8Array): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId(testId).click();
  await (await chooser).setFiles({ name: "recovery.zip", mimeType: "application/zip", buffer: Buffer.from(bytes) });
}

for (const span of [1e155, 1e308]) {
  test(`legacy numerical overflow ${span} stays recoverable without calculated views`, async ({ page, baseURL }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
      ? route.continue() : route.abort("blockedbyclient"));
    const legacy = parseProjectDocument({
      ...sampleProject, id: `numerical-${span}`, name: `Numerical recovery ${span}`, projectCrs: "EPSG:32613",
      pivotCenter: span === 1e308 ? { x: Number.MAX_VALUE, y: 0 } : sampleProject.pivotCenter,
      machine: { ...sampleProject.machine, spanLengthsMeters: [span], overhangMeters: 0, endGunThrowMeters: 0 },
    });
    await page.goto("/");
    await page.getByTestId("command-menu-file").click();
    await page.getByTestId("command-file-sample-baseline-needs-review").click();
    await page.getByTestId("workspace-nav-files").click();
    await importZip(page, "files-action-import-zip", exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(legacy)));
    await expect(page.getByTestId("crs-recovery-panel")).toContainText("Project numerical calculations unavailable");
    await expect(page.getByTestId("crs-recovery-project-name")).toHaveText(legacy.name);
    await expect(page.getByTestId("crs-recovery-crs")).toHaveText("EPSG:32613");
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    await expect(page.getByTestId("layout-map-svg")).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByTestId("files-action-export-zip")).toHaveCount(0);
    await expect(page.getByTestId("rtk-gate-badge")).toHaveCount(0);
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("crs-recovery-export").click();
    const stream = await (await downloadPromise).createReadStream();
    if (!stream) throw new Error("Recovery ZIP download has no readable stream.");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const recovered = importProjectArchiveZip(Buffer.concat(chunks));
    expect(recovered.pivotCenter).toEqual(legacy.pivotCenter);
    expect(recovered.machine.spanLengthsMeters).toEqual([span]);
    expect(recovered.fieldBoundary).toEqual(legacy.fieldBoundary);
    expect(recovered.projectCrs).toBe(legacy.projectCrs);
    const stored = await page.evaluate((id) => JSON.parse(JSON.parse(localStorage.getItem("center-pivot-layout-projects-v1") ?? "{}")[id].document).project, legacy.id);
    expect(stored.pivotCenter).toEqual(legacy.pivotCenter);
    expect(stored.machine.spanLengthsMeters).toEqual([span]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`numerical-recovery-${span}.png`) });
  });
}

for (const [projectCrs, reason] of [
  ["EPSG:26741", "Stored coordinate units are not metres"],
  ["LOCAL:FIELD", "Local coordinate units and axes have no verified declaration"],
  ["EPSG:3857", "Web Mercator is limited to map display"],
] as const) {
  test(`${projectCrs} opens, saves and recovers unchanged before returning to a metric project`, async ({ page, baseURL }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
      ? route.continue() : route.abort("blockedbyclient"));
    await page.goto("/");
    await page.getByTestId("command-menu-file").click();
    await page.getByTestId("command-file-sample-baseline-needs-review").click();
    await page.getByTestId("workspace-nav-files").click();

    const legacy = parseProjectDocument({
      ...sampleProject,
      id: `recovery-${projectCrs.replace(/:/g, "-")}`,
      name: `Legacy ${projectCrs}`,
      projectCrs,
      unitSystem: "metric",
      settings: { ...defaultProjectSettings(), unitSystem: "metric", mapStyle: "high_contrast", defaultZoomLevel: 2.5,
        drawing: { ...defaultProjectSettings().drawing, vertexSnapToleranceMeters: 0.37 } },
      pivotCenter: { x: 500410.123456789, y: 4500360.987654321 },
    });
    const initialZip = exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(legacy));
    await importZip(page, "files-action-import-zip", initialZip);
    const recovery = page.getByTestId("crs-recovery-panel");
    await expect(recovery).toBeVisible();
    await expect(page.getByTestId("crs-recovery-crs")).toHaveText(projectCrs);
    await expect(recovery).toContainText(reason);
    await expect(page.getByTestId("crs-recovery-xy")).toContainText("500410.123456789");
    await expect(page.getByTestId("layout-map-svg")).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByTestId("rtk-gate-badge")).toHaveCount(0);
    await expect(page.getByTestId("files-action-export-zip")).toHaveCount(0);
    await expect(page.getByTestId("crs-recovery-undo")).toBeDisabled();
    await expect(page.getByTestId("crs-recovery-redo")).toBeDisabled();

    await page.getByTestId("crs-recovery-save").click();
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    const stored = await page.evaluate((id) => {
      const data = JSON.parse(localStorage.getItem("center-pivot-layout-projects-v1") ?? "{}");
      return JSON.parse(data[id].document).project;
    }, legacy.id);
    expect(stored.projectCrs).toBe(projectCrs);
    expect(stored.pivotCenter).toEqual(legacy.pivotCenter);
    expect(stored.fieldBoundary).toEqual(legacy.fieldBoundary);
    expect(stored.settings).toEqual(legacy.settings);
    expect(stored.unitSystem).toBe("metric");
    await page.getByTestId(`crs-recovery-open-${legacy.id}`).click();
    await expect(page.getByTestId("crs-recovery-project-name")).toHaveText(legacy.name);

    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("crs-recovery-export").click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    if (!stream) throw new Error("Recovery ZIP download has no readable stream.");
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const exportedBytes = Buffer.concat(chunks);
    const entries = unzipSync(exportedBytes);
    expect(Object.keys(entries).sort()).toEqual(["manifest.json", "project.json"]);
    const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
    expect(manifest.files.sort()).toEqual(["manifest.json", "project.json"]);
    const restored = importProjectArchiveZip(exportedBytes);
    expect(restored.projectCrs).toBe(projectCrs);
    for (const key of ["fieldBoundary", "pivotCenter", "waterSource", "powerSource", "obstacles", "surveyPoints", "machine", "settings", "unitSystem"] as const) {
      expect(restored[key]).toEqual(legacy[key]);
    }
    await importZip(page, "crs-recovery-import", exportedBytes);
    await expect(page.getByTestId("crs-recovery-crs")).toHaveText(projectCrs);
    await expect(page.getByTestId("project-save-state")).toHaveText("Unsaved edits");
    await page.getByTestId("crs-recovery-export").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("crs-recovery.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.getByTestId("crs-recovery-open-sample").click();
    await expect(recovery).toHaveCount(0);
    await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(sampleProject.name);
    await page.getByTestId("workspace-nav-files").click();
    await expect(page.getByTestId("files-action-import-zip")).toBeVisible();
    await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
    expect(errors).toEqual([]);
  });
}

test("importing an independent blocked ZIP cannot reassign or overwrite the active saved design", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL!).origin
    ? route.continue() : route.abort("blockedbyclient"));
  const savedA = parseProjectDocument({ ...sampleProject, id: "affiliated-A", name: "Saved Design A" });
  const importedB = parseProjectDocument({ ...sampleProject, id: "independent-B", name: "Independent Legacy B", projectCrs: "LOCAL:FIELD",
    unitSystem: "metric", settings: { ...defaultProjectSettings(), unitSystem: "metric", mapStyle: "high_contrast" } });
  const timestamp = "2026-09-14T00:00:00.000Z";
  const catalog = normalizeProjectCatalog({
    clients: [{ id: "client-A", displayName: "Client A", sortName: "Client A", companyName: "Client A", contactName: "",
      primaryContactFirstName: "", primaryContactMiddleInitial: "", primaryContactLastName: "", primaryContactSuffix: "",
      email: "", phone: "", location: "", notes: "", createdAt: timestamp, updatedAt: timestamp }],
    projects: [{ id: savedA.id, clientId: "client-A", name: savedA.name, projectCrs: savedA.projectCrs,
      unitSystem: savedA.unitSystem, createdAt: timestamp, updatedAt: timestamp }],
    fieldMaps: [{ id: "field-A", projectId: savedA.id, name: "Field A", createdAt: timestamp, updatedAt: timestamp }],
    designs: [{ id: "design-A", fieldMapId: "field-A", pivotProjectId: savedA.id, name: savedA.name,
      isActive: true, createdAt: timestamp, updatedAt: timestamp }],
  });
  const savedDocument = serializeProjectDocument(savedA);
  const savedEntry = { document: savedDocument, summary: { id: savedA.id, name: savedA.name, projectCrs: savedA.projectCrs,
    unitSystem: savedA.unitSystem, updatedAt: timestamp } };
  await page.addInitScript(({ catalog, id, entry }) => {
    localStorage.setItem("center-pivot-layout-project-catalog-v1", JSON.stringify(catalog));
    localStorage.setItem("center-pivot-layout-projects-v1", JSON.stringify({ [id]: entry }));
  }, { catalog, id: savedA.id, entry: savedEntry });
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-files").click();
  await page.getByLabel(`Open ${savedA.name}`, { exact: true }).click();
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(savedA.name);
  await expect(page.getByTestId("project-save-state")).toContainText("Saved");
  await page.getByTestId("workspace-nav-files").click();
  await importZip(page, "files-action-import-zip", exportProjectArchiveZip(buildProjectRecoveryArchiveBundle(importedB)));
  await expect(page.getByTestId("crs-recovery-project-name")).toHaveText(importedB.name);
  await page.getByTestId("crs-recovery-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  const stored = await page.evaluate(() => ({
    catalog: JSON.parse(localStorage.getItem("center-pivot-layout-project-catalog-v1") ?? "{}"),
    projects: JSON.parse(localStorage.getItem("center-pivot-layout-projects-v1") ?? "{}"),
  }));
  expect(stored.catalog.designs.find((design: { id: string }) => design.id === "design-A")).toEqual(catalog.designs[0]);
  expect(stored.catalog.fieldMaps.find((field: { id: string }) => field.id === "field-A")).toEqual(catalog.fieldMaps[0]);
  expect(stored.projects[savedA.id]).toEqual(savedEntry);
  expect(parseProjectDocument(stored.projects[importedB.id].document)).toEqual(importedB);
  await page.getByTestId(`crs-recovery-open-${savedA.id}`).click();
  await expect(page.getByTestId("crs-recovery-panel")).toHaveCount(0);
  await expect(page.getByTestId("workspace-breadcrumb-current")).toContainText(savedA.name);
  expect(errors).toEqual([]);
});
