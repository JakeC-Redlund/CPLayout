import { test as base, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createSyntheticApi } from "../../apps/api/src/testHarness";
import { hexToBytes, cacheKey } from "../../packages/auth-client/src";
import { parseWorkspaceDocument } from "../../packages/project-store/src/workspaceDocument";
import { UNIFIED_WORKSPACE_RESUME_KEY } from "../../apps/mobile/src/navigation/unifiedWorkspaceResume";
import { WORKSPACE_EDIT_RECOVERY_KEY } from "../../apps/mobile/src/workspace/workspaceEditRecoveryStore";
import { registerAuthenticatedPage, workspaceKey } from "./workspace-fixtures";
export { expect };
export type { Page, BrowserContext, Locator, TestInfo } from "@playwright/test";

export interface AuthenticatedBrowserService {
  api: Awaited<ReturnType<typeof createSyntheticApi>>["api"];
  database: Awaited<ReturnType<typeof createSyntheticApi>>["database"];
  username: string; password: string; principalId: string; workspaceId: string; partition: string;
  offlinePublicKey: string; navigationErrors: string[];
}
type Options = { signedIn: boolean; autoContinue: boolean };
type Fixtures = { authenticatedService: AuthenticatedBrowserService };
async function signingKey(): Promise<Uint8Array | undefined> {
  const seed = process.env.CPLAYOUT_TEST_SIGNING_SEED; if (!seed) return undefined;
  const hex = /^[a-f0-9]{64}$/i.test(seed) ? seed : (await readFile(seed, "utf8")).trim();
  const value = hexToBytes(hex); if (value.length !== 32) throw new Error("Use the owned 32-byte synthetic service seed."); return value;
}
export const test = base.extend<Options & Fixtures>({
  signedIn: [true, { option: true }], autoContinue: [true, { option: true }],
  authenticatedService: [async ({ context, baseURL, signedIn }, use) => {
    if (!baseURL) throw new Error("Authenticated browser proof requires its actual app origin.");
    const origin = new URL(baseURL).origin, fixture = await createSyntheticApi(origin, await signingKey());
    const service: AuthenticatedBrowserService = { ...fixture, principalId: fixture.administratorId,
      partition: cacheKey(fixture.administratorId, fixture.workspaceId), navigationErrors: [] };
    if (signedIn) {
      const login = await fixture.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: fixture.username, password: fixture.password } });
      if (login.statusCode !== 200) throw new Error("The real synthetic service could not authenticate its test account.");
      const cookie = String(login.headers["set-cookie"]).split(";")[0], split = cookie.indexOf("=");
      await context.addCookies([{ name: cookie.slice(0, split), value: cookie.slice(split + 1), url: origin, httpOnly: true, sameSite: "Strict", secure: origin.startsWith("https:") }]);
    }
    let seedJob: Promise<void> | null = null, closing = false;
    const activeRoutes = new Set<Promise<void>>();
    async function seedActualSource(page: Page) {
      if (seedJob) return seedJob;
      seedJob = (async () => {
        const raw = await page.evaluate(key => localStorage.getItem(key), workspaceKey);
        if (raw !== null) {
          const workspace = parseWorkspaceDocument(raw);
          await fixture.database.transaction(async transaction => { const current = await transaction.workspace(fixture.workspaceId); if (!current) throw new Error("Synthetic workspace disappeared."); await transaction.writeWorkspace({ ...current, revision: workspace.revision, document: raw }); });
        }
        // This explicit test import binds historical seed preferences to its real
        // authenticated synthetic owner. Product code never aliases global keys.
        await page.evaluate(({ partition, keys }) => {
          for (const key of keys) { const raw = localStorage.getItem(key), destination = `${partition}:${key}`; if (raw !== null && localStorage.getItem(destination) === null) localStorage.setItem(destination, raw); }
        }, { partition: service.partition, keys: [UNIFIED_WORKSPACE_RESUME_KEY, WORKSPACE_EDIT_RECOVERY_KEY, "cplayout-desktop-context-v1"] });
      })(); return seedJob;
    }
    async function bind(page: Page) {
      registerAuthenticatedPage(page, service);
      await page.route("**/api/v1/**", async route => {
        const pending = (async () => {
        if (closing) { await route.abort("blockedbyclient"); return; }
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) return route.abort("blockedbyclient");
        if (request.method() === "GET" && url.pathname.startsWith(`/api/v1/workspaces/${fixture.workspaceId}`)) await seedActualSource(page);
        const response = await fixture.api.inject({ method: request.method() as "GET" | "POST", url: `${url.pathname}${url.search}`,
          headers: await request.allHeaders(), payload: request.postData() ?? undefined });
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(response.headers)) if (value !== undefined && !["content-length", "connection", "transfer-encoding"].includes(key)) headers[key] = Array.isArray(value) ? value.join(", ") : String(value);
        await route.fulfill({ status: response.statusCode, headers, body: response.body });
        })(); activeRoutes.add(pending);
        try { await pending; }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!closing || !/Target page, context or browser has been closed|Execution context was destroyed|Test ended/.test(message)) throw error;
        } finally { activeRoutes.delete(pending); }
      });
    }
    const listener = (page: Page) => { void bind(page).catch(error => service.navigationErrors.push(error instanceof Error ? error.message : "Page API routing failed.")); };
    context.on("page", listener); for (const page of context.pages()) await bind(page);
    try { await use(service); if (service.navigationErrors.length) throw new Error(service.navigationErrors.join("; ")); }
    finally {
      closing = true; context.off("page", listener);
      // Keep the real service alive for every already-dispatched API callback.
      // New callbacks abort at the fixture boundary until Playwright closes its
      // owned pages/context and finishes screenshot/trace collection.
      await Promise.allSettled([...activeRoutes]); await fixture.api.close();
    }
  }, { auto: true }],
  page: async ({ page, autoContinue, authenticatedService }, use) => {
    async function continueWork() {
      if (!autoContinue || new URL(page.url()).pathname !== "/") return;
      const control = page.getByTestId("home-continue");
      await control.waitFor({ state: "visible", timeout: 15_000 }); await control.click();
      await expect(page.getByTestId("auth-project-home")).toBeHidden();
      await expect(page.getByTestId("workspace-common-controls")).toBeVisible();
    }
    // These old workspace journeys explicitly choose the real Home continuation.
    // Await that operator action before navigation returns; an event callback
    // cannot race the journey's own Catalog/Open action or another reload.
    const goto = page.goto.bind(page), reload = page.reload.bind(page);
    page.goto = async (url, options) => { const response = await goto(url, options); await continueWork(); return response; };
    page.reload = async options => { const response = await reload(options); await continueWork(); return response; };
    try { await use(page); } finally { page.goto = goto; page.reload = reload; }
  },
});
