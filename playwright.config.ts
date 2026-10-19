import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertBrowserProofInventory, browserProofSelection, BROWSER_PROOF_INVENTORY_PATH, resolveBrowserProofScope } from "./tools/browserProofRegistry";

// Qualify the current default App and applicable browser contracts. Retained
// old-presentation contracts stay inventoried for explicit migration, not skips.
const proofScope = resolveBrowserProofScope();
assertBrowserProofInventory(__dirname, JSON.parse(readFileSync(resolve(__dirname, BROWSER_PROOF_INVENTORY_PATH), "utf8")));
const proofSelection = browserProofSelection(proofScope);

const port = Number(process.env.CPLAYOUT_WEB_PROOF_PORT ?? 19006);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...proofSelection,
  metadata: { browserProofScope: proofScope, inventory: BROWSER_PROOF_INVENTORY_PATH },
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  // Leave at least fifteen minutes for install/export and failure artifact
  // custody inside the hosted web job's sixty-minute limit.
  globalTimeout: 45 * 60_000,
  outputDir: "reports/continuous-improvement/playwright-results",
  snapshotPathTemplate: "{testDir}/{testFileName}-snapshots/{platform}/{projectName}/{arg}{ext}",
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1366, height: 900 },
      },
    },
    {
      name: "tablet-768",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 900 },
      },
    },
    {
      name: "mobile-390",
      use: {
        ...devices["Pixel 5"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "reports/continuous-improvement/playwright-html" }],
  ],
  testDir: "tests/web",
  timeout: 120_000,
  use: {
    baseURL,
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx tsx tools/serveStaticWeb.ts apps/mobile/dist ${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: `${baseURL}/__cplayout_static_health`,
  },
});
