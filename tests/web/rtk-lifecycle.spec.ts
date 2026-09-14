import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";

type RtkFixture = {
  requestCount: number;
  closeCalls: number;
  openPorts: number;
  failCloseCount: number;
  deferClose: boolean;
  nowMs: number;
  grant(): void;
  releaseClose(): void;
  emit(payload: string): void;
};
type FixtureWindow = typeof window & { rtkLifecycleFixture: RtkFixture };

function payload(time = "123519.00", latitude = "3900.000000", longitude = "10400.000000"): string {
  return [
    `GNGGA,${time},${latitude},N,${longitude},W,4,18,0.6,1600.0,M,-20.0,M,0.5,0000`,
    `GNGST,${time},0.01,0.01,0.01,0.0,0.01,0.01,0.02`,
  ].map((body) => {
    const checksum = [...body].reduce((value, character) => value ^ character.charCodeAt(0), 0);
    return `$${body}*${checksum.toString(16).padStart(2, "0")}\r\n`;
  }).join("");
}

async function prepare(page: Page, baseURL: string): Promise<void> {
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort("blockedbyclient"));
  await page.addInitScript((initialPayload) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const grants: Array<() => void> = [];
    const closeGrants: Array<() => void> = [];
    const fixture: RtkFixture = {
      requestCount: 0, closeCalls: 0, openPorts: 0, failCloseCount: 0, nowMs: 1000, deferClose: false,
      grant() { grants.splice(0).forEach((grant) => grant()); },
      releaseClose() { closeGrants.splice(0).forEach((grant) => grant()); },
      emit(value) { controller.enqueue(new TextEncoder().encode(value)); },
    };
    (window as FixtureWindow).rtkLifecycleFixture = fixture;
    Object.defineProperty(performance, "now", { configurable: true, value: () => fixture.nowMs });
    Object.defineProperty(navigator, "serial", { configurable: true, value: {
      async requestPort() {
        fixture.requestCount += 1;
        await new Promise<void>((resolve) => grants.push(resolve));
        const readable = new ReadableStream<Uint8Array>({ start(value) { controller = value; fixture.emit(initialPayload); } });
        return {
          readable, writable: null, async open() { fixture.openPorts += 1; },
          async close() {
            fixture.closeCalls += 1;
            if (readable.locked) throw new Error("Readable stream remains locked");
            if (fixture.deferClose) await new Promise<void>((resolve) => closeGrants.push(resolve));
            if (fixture.failCloseCount > 0) { fixture.failCloseCount -= 1; throw new Error("Synthetic port cleanup failure"); }
            await readable.cancel();
            fixture.openPorts -= 1;
          },
        };
      },
    } });
  }, payload());
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  await page.getByTestId("workspace-nav-survey").click();
  await page.getByRole("textbox", { name: "Receiver source CRS" }).fill("EPSG:4326");
}

async function connect(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open Serial", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.requestCount)).toBe(1);
  await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.grant());
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate accepted");
}

test("RTK permission requests are single-flight without a second connection", async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.getByRole("button", { name: "Open Serial", exact: true }).click();
  const opening = page.getByRole("button", { name: /^Open(ing)? Serial$/ });
  await opening.evaluate((node) => { (node as HTMLElement).click(); (node as HTMLElement).click(); });
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.requestCount)).toBe(1);
  await expect(opening).toBeDisabled();
  await expect(opening).toHaveText("Opening Serial");
  await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.grant());
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate accepted");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.closeCalls)).toBe(1);
});

test("RTK permission granted after panel unmount closes the late port", async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.getByRole("button", { name: "Open Serial", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.requestCount)).toBe(1);
  await page.getByTestId("workspace-nav-files").click();
  await expect(page.getByTestId("files-view")).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.grant());
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.closeCalls)).toBe(1);
  await expect(page.getByTestId("project-save-state")).toContainText("Unsaved edits");
});

test("RTK late-open cleanup failure survives navigation until explicit retry", async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.getByRole("button", { name: "Open Serial", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.requestCount)).toBe(1);
  await page.getByTestId("workspace-nav-files").click();
  await page.evaluate(() => {
    const fixture = (window as FixtureWindow).rtkLifecycleFixture;
    fixture.failCloseCount = 1;
    fixture.grant();
  });
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.closeCalls)).toBe(1);
  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByRole("button", { name: "Retry Close", exact: true })).toBeEnabled();
  await expect(page.getByTestId("rtk-status")).toContainText("Synthetic port cleanup failure");
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.openPorts)).toBe(1);
  await page.getByRole("button", { name: "Retry Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.openPorts)).toBe(0);
});

for (const deferClose of [false, true]) {
test(`RTK failed cleanup remains retryable and cannot claim a new open port: deferred=${deferClose}`, async ({ page, baseURL }, testInfo) => {
  await prepare(page, baseURL!);
  await connect(page);
  await page.evaluate((defer) => {
    const fixture = (window as FixtureWindow).rtkLifecycleFixture;
    fixture.failCloseCount = 1;
    fixture.deferClose = defer;
  }, deferClose);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  if (deferClose) {
    await expect(page.getByRole("button", { name: "Closing Serial", exact: true })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.closeCalls)).toBe(1);
    await page.evaluate(() => {
      const fixture = (window as FixtureWindow).rtkLifecycleFixture;
      fixture.deferClose = false;
      fixture.releaseClose();
    });
  }
  await expect(page.getByRole("button", { name: "Retry Close", exact: true })).toBeEnabled();
  await expect(page.getByTestId("rtk-status")).toContainText("Synthetic port cleanup failure");
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  await expect(page.getByRole("button", { name: "Capture Survey Point", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("workspace-live-rtk-status")).toContainText("RTK disconnected - gate closed");
  await page.screenshot({ path: testInfo.outputPath("rtk-disconnected-footer.png") });
  await page.getByTestId("workspace-nav-files").click();
  await page.getByTestId("workspace-nav-survey").click();
  await expect(page.getByRole("button", { name: "Retry Close", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.closeCalls)).toBe(1);
  await page.getByRole("button", { name: "Retry Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.closeCalls)).toBe(2);
  await expect(page.getByTestId("rtk-status")).toContainText("Receiver disconnected");
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  await expect(page.getByRole("button", { name: "Capture Survey Point", exact: true })).toBeDisabled();
  await expect(page.getByTestId("workspace-live-rtk-status")).toHaveCount(0);
});
}

test("RTK captured-ring confidence survives disconnect and ZIP round trip", async ({ page, baseURL }, testInfo) => {
  await prepare(page, baseURL!);
  await connect(page);
  await expect(page.getByTestId("workspace-live-rtk-status")).toContainText("RTK gate accepted");
  await page.getByRole("button", { name: "Add Obstacle (0)", exact: true }).click();
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123520.00", "3900.006000"));
  await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toContainText("4");
  await expect(page.getByRole("button", { name: "Add Obstacle (1)", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Add Obstacle (1)", exact: true }).click();
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123521.00", "3900.006000", "10359.994000"));
  await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toContainText("6");
  await page.getByRole("button", { name: "Add Obstacle (2)", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  await page.getByRole("button", { name: "Commit Obstacle", exact: true }).click();
  await expect(page.getByTestId("rtk-status")).toContainText("obstacle ring committed");
  await page.screenshot({ path: testInfo.outputPath("rtk-retained-draft.png") });
  await page.getByTestId("workspace-nav-files").click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  const download = await downloading;
  const archive = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const document = JSON.parse(strFromU8(archive["project.json"]));
  const obstacle = document.project.obstacles.at(-1);
  expect(obstacle.confidence).toBe("rtk_fixed");
  expect(obstacle.vertexCaptureEvidence).toHaveLength(3);
  expect(new Set(obstacle.vertexCaptureEvidence.map((e: { observationId: string }) => e.observationId)).size).toBe(3);
});
