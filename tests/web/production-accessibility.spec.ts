import AxeBuilder from "@axe-core/playwright";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo, type AuthenticatedBrowserService } from "./authenticated-test";

test.use({ signedIn: false, autoContinue: false });

async function seedProject(service: AuthenticatedBrowserService): Promise<{customerId: string; projectId: string; fieldId: string; designId: string}> {
  const login = await service.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: service.username, password: service.password } });
  expect(login.statusCode).toBe(200);
  const headers = { cookie: String(login.headers["set-cookie"]).split(";")[0], "x-csrf-token": login.json().csrfToken };
  const source = await service.api.inject({ url: `/api/v1/workspaces/${service.workspaceId}`, headers });
  expect(source.statusCode).toBe(200);
  let revision: number = source.json().revision;
  const customerId = randomUUID(), projectId = randomUUID(), fieldId = randomUUID(), designId = randomUUID(), now = new Date().toISOString();
  const commands = [
    { type: "create_client", id: customerId, input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Accessibility", companyName: "Accessibility test farm" }, now },
    { type: "start_project_work", now, clientId: customerId, projectId, fieldMapId: fieldId, designId, draftId: randomUUID(),
      projectName: "Accessible project", fieldName: "Accessible first field", workName: "Accessible project", projectCrs: null,
      unitSystem: "us_survey_feet", initialMode: "design" },
  ];
  for (const command of commands) {
    const response = await service.api.inject({ method: "POST", url: `/api/v1/workspaces/${service.workspaceId}/commands`, headers,
      payload: { commandId: randomUUID(), expectedRevision: revision, expectedPrincipalId: service.principalId, command } });
    expect(response.statusCode).toBe(200); revision = response.json().revision;
  }
  return {customerId, projectId, fieldId, designId};
}

async function recordAndAudit(page: Page, info: TestInfo, scene: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  await info.attach(`${scene}-axe.json`, { body: JSON.stringify(result), contentType: "application/json" });
  const png = await page.screenshot({ animations: "disabled" }), dom = Buffer.from(await page.content());
  await info.attach(`${scene}.png`, { body: png, contentType: "image/png" });
  await info.attach(`${scene}.html`, { body: dom, contentType: "text/html" });
  const servedScripts = await page.locator("script[src]").evaluateAll(nodes => nodes.map(node => (node as HTMLScriptElement).src));
  const servedBundles = await Promise.all(servedScripts.map(async url => {
    const response = await page.request.get(url); expect(response.ok()).toBe(true);
    return { url, sha256: createHash("sha256").update(await response.body()).digest("hex") };
  }));
  await info.attach(`${scene}-binding.json`, { body: JSON.stringify({ classification: "synthetic", scenario: scene, viewport: page.viewportSize(),
    pngSha256: createHash("sha256").update(png).digest("hex"), pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20),
    domSha256: createHash("sha256").update(dom).digest("hex"),
    sourceSha256: createHash("sha256").update(await readFile(__filename)).digest("hex"),
    servedBundles,
    axeVersion: result.testEngine.version, tags: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }), contentType: "application/json" });
  expect(result.violations.map(item => ({ id: item.id, impact: item.impact, targets: item.nodes.map(node => node.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("operator sign-in, Home, Design and Survey stay keyboard reachable and pass automated accessibility checks", async ({ page, authenticatedService }, info) => {
  const {customerId, projectId, fieldId, designId} = await seedProject(authenticatedService);
  await page.goto("/"); await expect(page.getByTestId("auth-login")).toBeVisible();
  await recordAndAudit(page, info, "sign-in");
  await page.getByTestId("auth-username").focus(); await page.keyboard.type(authenticatedService.username); await page.keyboard.press("Tab");
  await expect(page.getByTestId("auth-password")).toBeFocused(); await page.keyboard.type(authenticatedService.password); await page.keyboard.press("Enter");
  await expect(page.getByTestId("auth-project-home")).toBeVisible(); await expect(page.getByTestId(`home-customer-${customerId}`)).toBeVisible();
  await expect(page.getByTestId(`home-open-${projectId}`)).toHaveCount(0);
  await recordAndAudit(page, info, "customer-home");
  await page.getByTestId(`home-customer-${customerId}`).focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId(`home-open-${projectId}`)).toBeVisible();
  await recordAndAudit(page, info, "project-home");
  await page.getByTestId(`home-open-${projectId}`).focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
  await expect(page.getByTestId(`catalog-project-${projectId}`)).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId(`catalog-field-${fieldId}`).focus(); await page.keyboard.press("Enter");
  await page.getByTestId(`catalog-design-open-${designId}`).focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("workspace-context")).toHaveAttribute("aria-label", /Accessible project.*Accessible first field/);
  await expect(page.getByTestId("workspace-catalog")).toBeHidden();
  await page.getByTestId("workspace-map-readout").focus();
  await expect(page.getByTestId("workspace-map-readout")).toBeFocused();
  if (!await page.getByTestId("workspace-mode-tools").isVisible()) {
    await page.getByTestId("workspace-tools-toggle").focus(); await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("workspace-panel-design")).toBeVisible();
  await recordAndAudit(page, info, "design");
  await page.getByTestId("workspace-mode-survey").focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("workspace-mode-survey")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("workspace-mode-layout")).toBeDisabled();
  await expect(page.getByTestId("workspace-panel-survey")).toBeVisible();
  await recordAndAudit(page, info, "survey");
  const viewport = page.viewportSize()!; await page.setViewportSize({ width: viewport.width, height: 500 });
  await page.getByRole("button", { name: "Customers & projects", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("workspace-catalog")).toBeVisible();
  await recordAndAudit(page, info, "short-catalog");
  await page.getByTestId("catalog-close").focus(); await page.keyboard.press("Enter");
  await expect(page.getByTestId("workspace-catalog")).toBeHidden();
});
