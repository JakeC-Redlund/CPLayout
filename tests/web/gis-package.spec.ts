import { randomUUID } from "node:crypto";
import { expect, test as authenticatedTest, type AuthenticatedBrowserService, type Page } from "./authenticated-test";
import { projectXyToLonLat } from "../../packages/core/src/coordinates";
import { parseDesignDraftDocument } from "../../packages/core/src/designDraft";
import { resolveAerialImagerySource } from "../../packages/core/src/mapTilePackages";
import type { MapPackageManifest } from "../../packages/core/src/types";
import { parseWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { mapPackageLogicalUrlPrefix } from "../../packages/project-store/src/mapPackageArchive";
import { createGisEvidence, requireGisMapLibre } from "./gis-evidence";
import { GIS_FIXTURE, gisTools, installGisTileBoundary, openGisFixture, savedGisDraft, seedGisFixture } from "./gis-fixture";
import { workspaceStorageBytes } from "./workspace-fixtures";

const test = authenticatedTest.extend<{ gisEvidence: ReturnType<typeof createGisEvidence> }>({
  gisEvidence: async ({ page, baseURL }, use, info) => {
    const evidence = createGisEvidence(page, info, baseURL!);
    try { await use(evidence); } finally { await evidence.dispose(); }
  },
});

test.use({ autoContinue: false, deviceScaleFactor: 1, locale: "en-US", timezoneId: "America/Denver",
  contextOptions: { reducedMotion: "reduce" }, launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }, actionTimeout: 15_000 });

type PackagePolicy = "permitted" | "denied" | "missing-provenance";
const cases = [
  { policy: "permitted", title: "GL required: portable permitted GIS package stays unresolved while synthetic live fallback preserves metadata" },
  { policy: "denied", title: "GL required: denied offline raster package issues no package requests and preserves source metadata" },
  { policy: "missing-provenance", title: "GL required: raster package without provenance stays unqualified while fallback preserves metadata" },
] as const;

function syntheticPackage(policy: PackagePolicy): MapPackageManifest {
  const id = `gis-portable-raster-${policy}`, prefix = mapPackageLogicalUrlPrefix(id);
  const positions = GIS_FIXTURE.boundary.map(point => projectXyToLonLat(point, GIS_FIXTURE.crs));
  const boundsWgs84 = {
    minLongitude: Math.min(...positions.map(point => point.longitude)), minLatitude: Math.min(...positions.map(point => point.latitude)),
    maxLongitude: Math.max(...positions.map(point => point.longitude)), maxLatitude: Math.max(...positions.map(point => point.latitude)),
  };
  return {
    id, name: `Synthetic portable raster (${policy})`, packageType: "raster_tiles", tileContentType: "raster", uri: prefix,
    minZoom: 12, maxZoom: 18, tileScheme: "xyz", boundsWgs84,
    tileJsonUrl: `${prefix}tilejson.json`, tileUrlTemplates: [`${prefix}tiles/{z}/{x}/{y}.png`], installStatus: "available",
    attribution: "CPLayout synthetic portable package fixture", licenseText: "Synthetic source metadata for policy testing only.", importedAt: GIS_FIXTURE.now,
    ...(policy === "missing-provenance" ? {} : { imageryProvenance: {
      providerId: "cplayout-synthetic-portable", providerName: "CPLayout synthetic portable raster",
      accessedAt: GIS_FIXTURE.now, attribution: "CPLayout synthetic portable package fixture",
      licenseText: "Synthetic source metadata for policy testing only.", offlineCopyAllowed: policy === "permitted", keyedService: false as const,
    } }),
  };
}

/** Preserve portable metadata in the real service transaction. No runtime URL is
 * inserted into a Draft to work around the currently absent package resolver. */
async function seedPackage(service: AuthenticatedBrowserService, mapPackage: MapPackageManifest): Promise<void> {
  await seedGisFixture(service);
  const login = await service.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: service.username, password: service.password } });
  expect(login.statusCode).toBe(200);
  const headers = { cookie: String(login.headers["set-cookie"]).split(";")[0], "x-csrf-token": login.json().csrfToken };
  try {
    const source = await service.database.transaction(transaction => transaction.workspace(service.workspaceId));
    if (!source) throw new Error("Synthetic GIS workspace is unavailable.");
    const workspace = parseWorkspaceDocument(source.document), design = workspace.catalog.designs.find(item => item.id === GIS_FIXTURE.design);
    const entry = workspace.draftDocuments.find(item => item.id === GIS_FIXTURE.payload);
    if (!design || design.kind !== "draft" || !entry) throw new Error("Synthetic GIS Draft identity is unavailable.");
    const draft = parseDesignDraftDocument(entry.document);
    draft.mapPackages = [mapPackage];
    const response = await service.api.inject({ method: "POST", url: `/api/v1/workspaces/${service.workspaceId}/commands`, headers,
      payload: { commandId: randomUUID(), expectedRevision: source.revision, expectedPrincipalId: service.principalId,
        command: { type: "save_design_draft", designId: GIS_FIXTURE.design, expectedDesignRevision: design.revision, draft, now: GIS_FIXTURE.now } } });
    expect(response.statusCode, response.body).toBe(200);
  } finally {
    const logout = await service.api.inject({ method: "POST", url: "/api/v1/session/logout", headers });
    expect(logout.statusCode).toBe(200);
  }
}

/** This suite proves current unified-workspace refusal/fallback and retention.
 * It does not qualify an installed package, its pixels, or bounds suppression.
 * scenePackages currently supplies persisted logical references without a
 * browser package resolver; using a legacy localhost Project would bypass that gap. */
for (const scenario of cases) test(scenario.title, async ({ page, authenticatedService, baseURL, gisEvidence: evidence }) => {
  const mapPackage = syntheticPackage(scenario.policy), requests: string[] = [];
  const onRequest = (request: { url(): string }) => { requests.push(request.url()); };
  page.on("request", onRequest);
  const tiles = await installGisTileBoundary(page, baseURL!);
  try {
    // This admission reason is a source-level cross-check, separate from the
    // browser observations below. No unsupported package pixels are fabricated.
    const admission = resolveAerialImagerySource({ mapPackages: [mapPackage], preferences: { mode: "manual", sourcePackageId: mapPackage.id }, target: "web_maplibre_gl_js" });
    expect(admission.canRender).toBe(false);
    if (scenario.policy === "permitted") expect(admission.reason).toMatch(/files are unavailable.*Import the map archive/);
    if (scenario.policy === "denied") expect(admission.reason).toMatch(/does not allow offline copying/);
    if (scenario.policy === "missing-provenance") expect(admission.reason).toMatch(/requires source provenance/);
    expect(Object.values(mapPackage.boundsWgs84).every(Number.isFinite)).toBe(true);
    await seedPackage(authenticatedService, mapPackage);
    await openGisFixture(page); await gisTools(page, false);
    await requireGisMapLibre(page);
    const saved = await savedGisDraft(page), durable = await workspaceStorageBytes(page);
    expect(saved.draft.mapPackages).toEqual([mapPackage]);
    expect(saved.draft.fieldBoundary).toEqual(GIS_FIXTURE.boundary);
    await expect(page.getByTestId("workspace-map-attribution")).toContainText("USGS");
    await expect(page.getByTestId("workspace-map-attribution")).not.toContainText(mapPackage.attribution);
    expect(tiles.requests, "current live fallback must actually request synthetic fulfilled raster pixels").toBeGreaterThan(0);
    // A real camera change and settled fit exercise the renderer while the
    // package stays unqualified. Only the intercepted live fallback may request tiles.
    await page.getByTestId("workspace-map-zoom-in").click(); await requireGisMapLibre(page);
    await page.getByTestId("workspace-map-fit").click(); await requireGisMapLibre(page);
    expect(await workspaceStorageBytes(page)).toEqual(durable);
    const packageRequests = requests.filter(url => url.startsWith(mapPackageLogicalUrlPrefix(mapPackage.id)) || url.includes(`/map-packages/${mapPackage.id}/`));
    expect(packageRequests, "unresolved or unqualified package resources must never be fetched").toEqual([]);
    expect(tiles.unexpected).toEqual([]); expect(evidence.errors).toEqual([]);
    await evidence.capture(`portable-package-${scenario.policy}`, "maplibre-required", { id: `${GIS_FIXTURE.id}-portable-${scenario.policy}`, crs: GIS_FIXTURE.crs }, {
      policy: scenario.policy, portableManifest: mapPackage,
      sourceOnlyAdmission: { canRender: admission.canRender, reason: admission.reason },
      browserObserved: { renderer: "actual-maplibre", syntheticFallbackRequests: tiles.requests, packageRequests, unexpectedOutbound: tiles.unexpected },
      unqualified: { packageRendering: "No portable app:// browser package resolver is wired to the unified scene.",
        finiteBoundsRequestSuppression: "Not exercised: package source cannot reach the actual browser renderer through the current portable metadata path." },
    });
    await openGisFixture(page); await gisTools(page, false); await requireGisMapLibre(page);
    expect((await savedGisDraft(page)).bytes).toBe(saved.bytes);
    expect((await savedGisDraft(page)).draft.mapPackages).toEqual([mapPackage]);
    expect(await workspaceStorageBytes(page)).toEqual(durable);
    expect(requests.filter(url => url.startsWith(mapPackageLogicalUrlPrefix(mapPackage.id)) || url.includes(`/map-packages/${mapPackage.id}/`))).toEqual([]);
    expect(tiles.unexpected).toEqual([]); expect(evidence.errors).toEqual([]);
  } finally { tiles.release(); page.off("request", onRequest); }
});
