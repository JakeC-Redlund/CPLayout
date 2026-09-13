import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CPLAYOUT_WEB_PROOF_PORT ?? 19006);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  outputDir: "reports/continuous-improvement/playwright-results",
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
    url: baseURL,
  },
});
