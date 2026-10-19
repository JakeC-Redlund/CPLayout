import { randomUUID } from "node:crypto";
import { newDesignDraft } from "../../apps/mobile/src/newDesignDraft";
import { parseDesignDraftDocument } from "../../packages/core/src/designDraft";
import { encodeRgbaPng } from "../../tools/pngMetrics";
import { expect, type AuthenticatedBrowserService, type Page } from "./authenticated-test";
import { readWorkspace } from "./workspace-fixtures";

// Synthetic source coordinates are exact binary fractions, in WGS84 / UTM 13N.
// They are deliberately unrelated to captured imagery or a physical survey.
export const GIS_FIXTURE = {
  id: "gis-visual-synthetic-v1", crs: "EPSG:32613", now: "2026-10-18T12:00:00.000Z",
  customer: "gis-visual-customer", project: "gis-visual-project", field: "gis-visual-field",
  design: "gis-visual-design", payload: "gis-visual-payload",
  boundary: [
    { x: 500000.125, y: 4500000.375 }, { x: 500512.625, y: 4500008.875 },
    { x: 500480.375, y: 4500384.125 }, { x: 500016.875, y: 4500320.625 },
  ],
} as const;

/** Seed through the real command/authorization transaction, then enter through
 * the actual Home and Catalog controls. No controller or renderer is replaced. */
export async function seedGisFixture(service: AuthenticatedBrowserService): Promise<void> {
  const login = await service.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: service.username, password: service.password } });
  expect(login.statusCode).toBe(200);
  const headers = { cookie: String(login.headers["set-cookie"]).split(";")[0], "x-csrf-token": login.json().csrfToken };
  const draft = { ...newDesignDraft(GIS_FIXTURE.payload, "Synthetic GIS boundary", "metric"), projectCrs: GIS_FIXTURE.crs,
    fieldBoundary: GIS_FIXTURE.boundary.map(point => ({ ...point })) };
  // Explicitly exercise the source-verified auto-aerial USGS fallback, entirely
  // fulfilled by installGisTileBoundary. Request counters prove this selection
  // ran; the test must not turn green through an imagery-off default.
  draft.settings.aerialImagery = { mode: "auto" };
  const commands = [
    { type: "create_client", id: GIS_FIXTURE.customer, input: { companyName: "Synthetic GIS farm", primaryContactFirstName: "Synthetic", primaryContactLastName: "Operator" } },
    { type: "create_project_with_initial_field_map", input: { clientId: GIS_FIXTURE.customer, projectId: GIS_FIXTURE.project,
      fieldMapId: GIS_FIXTURE.field, projectName: "Synthetic GIS project", fieldMapName: "Synthetic GIS field", projectCrs: GIS_FIXTURE.crs, unitSystem: "metric" } },
    { type: "create_design_draft", designId: GIS_FIXTURE.design, fieldMapId: GIS_FIXTURE.field, name: draft.name, draft },
  ];
  try {
    for (const command of commands) {
      const source = await service.database.transaction(transaction => transaction.workspace(service.workspaceId));
      if (!source) throw new Error("Synthetic GIS source workspace is unavailable.");
      const response = await service.api.inject({ method: "POST", url: `/api/v1/workspaces/${service.workspaceId}/commands`, headers,
        payload: { commandId: randomUUID(), expectedRevision: source.revision, expectedPrincipalId: service.principalId, command: { ...command, now: GIS_FIXTURE.now } } });
      expect(response.statusCode, response.body).toBe(200);
    }
  } finally {
    const logout = await service.api.inject({ method: "POST", url: "/api/v1/session/logout", headers });
    expect(logout.statusCode).toBe(200);
  }
}

export async function openGisFixture(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("auth-project-home")).toBeVisible();
  if (!await page.getByTestId(`home-selected-customer-${GIS_FIXTURE.customer}`).isVisible()) {
    if (await page.getByTestId("home-all-customers").isVisible()) await page.getByTestId("home-all-customers").click();
    await page.getByTestId(`home-customer-${GIS_FIXTURE.customer}`).click();
  }
  await page.getByTestId(`home-open-${GIS_FIXTURE.project}`).click();
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
  await expect(page.getByTestId(`catalog-client-${GIS_FIXTURE.customer}`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`catalog-project-${GIS_FIXTURE.project}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId(`catalog-field-${GIS_FIXTURE.field}`).click();
  await page.getByTestId(`catalog-design-open-${GIS_FIXTURE.design}`).click();
  await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  await page.getByTestId("workspace-mode-design").click();
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Synthetic GIS farm.*Synthetic GIS project.*Synthetic GIS field.*Synthetic GIS boundary/);
  await expect(page.getByTestId("workspace-map-surface")).toHaveCount(1);
}

export async function gisTools(page: Page, shown: boolean): Promise<void> {
  const toggle = page.getByTestId("workspace-tools-toggle");
  await expect(toggle).toBeEnabled();
  if (((await toggle.getAttribute("aria-label")) === "Hide tools") !== shown) await toggle.click();
  if (shown) await expect(page.getByTestId("workspace-mode-tools")).toBeVisible();
  else await expect(page.getByTestId("workspace-mode-tools")).toBeHidden();
}

export async function savedGisDraft(page: Page) {
  const entry = (await readWorkspace(page)).draftDocuments.find(item => item.id === GIS_FIXTURE.payload);
  if (!entry) throw new Error("Expected the actual synthetic GIS Draft document.");
  return { bytes: entry.document, draft: parseDesignDraftDocument(entry.document) };
}

/** Intercept exactly the public raster transport selected by the current App.
 * Every returned pixel is synthetic; all other external requests are refused.
 * route.fallback keeps the authenticated API fixture's own route in control. */
export async function installGisTileBoundary(page: Page, baseURL: string) {
  const origin = new URL(baseURL).origin, unexpected: string[] = [];
  const pixels = new Uint8Array(256 * 256 * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([232, 237, 231, 255], offset);
  const tile = Buffer.from(encodeRgbaPng(256, 256, pixels));
  let hold = false, held = 0, count = 0, release!: () => void;
  let gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.fallback();
    if (url.origin === "https://basemap.nationalmap.gov"
      && /^\/arcgis\/rest\/services\/USGSImagery(?:Only|Topo)\/MapServer\/tile\/\d+\/\d+\/\d+$/.test(url.pathname)
      && !url.username && !url.password && !url.search) {
      count++;
      if (hold) { held++; await gate; }
      return route.fulfill({ status: 200, contentType: "image/png", body: tile });
    }
    unexpected.push(`${url.origin}${url.pathname}`);
    return route.abort("blockedbyclient");
  });
  return {
    unexpected, get requests() { return count; }, get held() { return held; },
    hold() { if (hold) throw new Error("Synthetic tile gate is already held."); hold = true; },
    release() { hold = false; release(); gate = new Promise<void>(resolve => { release = resolve; }); },
  };
}
