import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import {
  fillSyntheticGnssReferenceDeclaration,
  SYNTHETIC_GNSS_REFERENCE_DECLARATION,
  SYNTHETIC_GNSS_REFERENCE_INPUTS,
} from "./gnss-reference-fixture";

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
  emitBytes(payload: number[]): void;
};
type FixtureWindow = typeof window & { rtkLifecycleFixture: RtkFixture };

function payload(
  time = "123519.00", latitude = "3900.000000", longitude = "10400.000000",
  vertical: { height?: string; geoidSeparation?: string; heightUncertainty?: string; fixQuality?: number } = {},
): string {
  return [
    `GNGGA,${time},${latitude},N,${longitude},W,${vertical.fixQuality ?? 4},18,0.6,${vertical.height ?? "1600.0"},M,${vertical.geoidSeparation ?? "-20.0"},M,0.5,0000`,
    `GNGST,${time},0.01,0.01,0.01,0.0,0.01,0.01,${vertical.heightUncertainty ?? "0.02"}`,
    `GNRMC,${time},A,${latitude},N,${longitude},W,0.0,0.0,130926,,,A`,
  ].map((body) => {
    const checksum = [...body].reduce((value, character) => value ^ character.charCodeAt(0), 0);
    return `$${body}*${checksum.toString(16).padStart(2, "0")}\r\n`;
  }).join("");
}

async function prepare(page: Page, baseURL: string, options: { declareReference?: boolean; initialPayload?: string; layout?: boolean; mapReceiver?: boolean } = {}): Promise<void> {
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
      emitBytes(value) { controller.enqueue(Uint8Array.from(value)); },
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
  }, options.initialPayload ?? payload());
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  if (options.layout) {
    await page.getByTestId("workspace-nav-settings").click();
    await page.getByRole("button", { name: "rtk float", exact: true }).click();
    await page.getByTestId("workspace-nav-map").click();
    await page.getByTestId("browser-workflow-layout").click();
  }
  if (options.mapReceiver) {
    await page.getByTestId("workspace-nav-map").click();
    const open = page.getByRole("button", { name: /Open (map inspector|right workflow sidebar)/ }).first();
    if (await open.isVisible()) await open.click();
    await page.getByTestId("workflow-sidebar-tab-rtk").click();
  } else await page.getByTestId("workspace-nav-survey").click();
  await page.getByRole("textbox", { name: "Receiver source CRS" }).fill("EPSG:4326");
  if (options.declareReference !== false) await fillSyntheticGnssReferenceDeclaration(page);
}

async function connect(page: Page, eligible = true, requestCount = 1): Promise<void> {
  await page.getByRole("button", { name: "Open Serial", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.requestCount)).toBe(requestCount);
  await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.grant());
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeEnabled();
  await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toHaveText(/NMEA lines\s*3$/);
  await expect(page.getByTestId("rtk-gate-badge")).toContainText(eligible ? "Collection eligible" : "Gate closed");
}

async function expectReferenceControlsLocked(page: Page, locked: boolean): Promise<void> {
  const toggle = page.getByTestId("gnss-reference-toggle");
  await expect(toggle).toBeEnabled();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const body = page.getByTestId("gnss-reference-body");
  await expect(body).toBeVisible();
  for (const [name] of SYNTHETIC_GNSS_REFERENCE_INPUTS) {
    await expect(body.getByRole("textbox", { name, exact: true })).toBeEditable({ editable: !locked });
  }
  for (const name of ["Receiver source CRS", "RTK serial baud rate"]) {
    await expect(page.getByRole("textbox", { name, exact: true })).toBeEditable({ editable: !locked });
  }
  const radios = body.getByRole("radio");
  await expect(radios).toHaveCount(6);
  for (const radio of await radios.all()) {
    if (locked) await expect(radio).toBeDisabled();
    else await expect(radio).toBeEnabled();
  }
  await toggle.click();
  await expect(body).toBeHidden();
}

async function expectCollectionBlocked(page: Page): Promise<void> {
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  for (const name of ["Capture Survey Point", "Add Boundary (0)", "Add Obstacle (0)", "Add Feature Vertex (0)", "Save Line Feature"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByText("3D field accuracy", { exact: true }).locator("..")).toContainText("Unverified");
}

test("Pan map preserves the open receiver session and captured draft in Layout", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page, baseURL!, { layout: true, mapReceiver: true });
  await connect(page);
  await page.getByRole("button", { name: "Add Boundary (0)", exact: true }).click();
  const toolbar = page.getByTestId("map-bottom-hud");
  await toolbar.getByTestId("design-action-pan").click();
  await toolbar.getByTestId("design-action-pan-start").click();
  await expect(page.getByRole("button", { name: "Disconnect", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Add Boundary (1)", exact: true })).toBeEnabled();
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Collection eligible");
  await expect(page.getByTestId("browser-workflow-layout")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.openPorts)).toBe(1);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
});

for (const geometry of ["Line", "Polygon"]) {
test(`Layout requires current RTK-fixed lock for capture and retained ${geometry} draft commits despite permissive settings`, async ({ page, baseURL }) => {
  await prepare(page, baseURL!, { layout: true });
  if (geometry === "Polygon") await page.getByRole("button", { name: "Planning boundary", exact: true }).click();
  await page.getByTestId("command-icon-save").click();
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await connect(page);
  for (let index = 0; index < 3; index++) {
    await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value),
      payload(`12352${index}.00`, index === 0 ? "3900.000000" : "3900.006000", index === 2 ? "10359.994000" : "10400.000000"));
    await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toHaveText(new RegExp(`NMEA lines\\s*${6 + index * 3}$`));
    await page.getByRole("button", { name: `Add Boundary (${index})`, exact: true }).click();
    await page.getByRole("button", { name: `Add Obstacle (${index})`, exact: true }).click();
    await page.getByRole("button", { name: `Add Feature Vertex (${index})`, exact: true }).click();
  }
  const commitLabels = ["Commit Boundary", "Commit Obstacle", `Save ${geometry} Feature`];
  for (const name of commitLabels) await expect(page.getByRole("button", { name, exact: true })).toBeEnabled();
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123523.00", undefined, undefined, { fixQuality: 5 }));
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  for (const name of [...commitLabels, "Capture Survey Point", "Add Boundary (3)", "Add Obstacle (3)", "Add Feature Vertex (3)"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  for (const [index, name] of commitLabels.entries()) {
    await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload(`12352${4 + index}.00`));
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeEnabled();
    // Advance the clock and activate in the same task, before the UI's age timer can disable it.
    await button.evaluate((element) => {
      (window as FixtureWindow).rtkLifecycleFixture.nowMs += 2100;
      (element as HTMLButtonElement).click();
    });
    await expect(page.getByTestId("rtk-status")).toContainText("capture was blocked");
    await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
    for (const label of ["Add Boundary (3)", "Add Obstacle (3)", "Add Feature Vertex (3)"]) await expect(page.getByRole("button", { name: label, exact: true })).toBeDisabled();
    for (const label of commitLabels) await expect(page.getByRole("button", { name: label, exact: true })).toBeDisabled();
  }
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123527.00"));
  await expect(page.getByRole("button", { name: "Commit Obstacle", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  for (const name of commitLabels) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  await connect(page, true, 2);
  await page.getByRole("button", { name: "Commit Obstacle", exact: true }).click();
  await expect(page.getByTestId("rtk-status")).toContainText("obstacle ring committed");
  await expect(page.getByText("3D field accuracy", { exact: true }).locator("..")).toContainText("Unverified");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
});
}

test("RTK binary payload cannot inject NMEA fixes or resume collection in the same session", async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await connect(page);
  const raw = [0xee, ...new TextEncoder().encode(payload("123520.00"))];
  const frame = [0xa0, 0xa1, raw.length >>> 8, raw.length & 0xff, ...raw, raw.reduce((sum, byte) => sum ^ byte, 0), 13, 10];
  await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.emitBytes([0xa0]));
  await expectCollectionBlocked(page);
  await page.evaluate((bytes) => (window as FixtureWindow).rtkLifecycleFixture.emitBytes(bytes), frame.slice(1));
  await expectCollectionBlocked(page);
  await expect(page.getByTestId("rtk-status")).toContainText("Binary receiver stream detected");
  await expect(page.getByTestId("rtk-gate-reasons")).toContainText("no coherent GGA observation is available");
  await expect(page.getByTestId("rtk-gate-reasons")).not.toContainText("does not belong to the current receiver session");
  await expect(page.getByTestId("rtk-gate-reasons")).not.toContainText("Disconnect to edit reference declaration.");
  const receiverPanel = page.getByTestId("rtk-status").locator("..");
  await expect.poll(() => receiverPanel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await receiverPanel.screenshot({ path: test.info().outputPath("receiver-binary-gate.png") });
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123521.00"));
  await expectCollectionBlocked(page);
  await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toHaveText(/NMEA lines\s*3$/);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  await connect(page, true, 2);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
});

test("RTK old partial GGA cannot gain fresh reception age from its completing chunk", async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await connect(page);
  const next = payload("123520.00");
  const endGga = next.indexOf("\r\n") + 2;
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), next.slice(0, 25));
  await page.evaluate((value) => {
    const fixture = (window as FixtureWindow).rtkLifecycleFixture;
    fixture.nowMs += 2100;
    fixture.emit(value);
  }, next.slice(25));
  await expectCollectionBlocked(page);
  // GST/RMC alone must not retain the previous fix after an expired frame.
  await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toHaveText(/NMEA lines\s*5$/);
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), next.slice(0, endGga));
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Collection eligible");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
});

test("RTK incomplete reference declaration blocks capture while serial monitoring works", async ({ page, baseURL }) => {
  await prepare(page, baseURL!, { declareReference: false });
  await expect(page.getByTestId("gnss-reference-form")).toContainText("Incomplete");
  await page.getByTestId("gnss-reference-toggle").click();
  for (const [name] of SYNTHETIC_GNSS_REFERENCE_INPUTS) {
    await expect(page.getByRole("textbox", { name, exact: true })).toHaveValue("");
  }
  await expect(page.getByTestId("gnss-reference-body").getByRole("radio", { checked: true })).toHaveCount(0);
  await page.getByTestId("gnss-reference-toggle").click();
  await connect(page, false);
  await expect(page.getByTestId("rtk-status")).toContainText("Reading NMEA");
  await expect(page.getByText("rtk_fixed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("rtk-gate-reasons")).toContainText("Complete the receiver reference declaration");
  await expect(page.getByTestId("rtk-gate-reasons")).toContainText("Disconnect to edit reference declaration.");
  await expectCollectionBlocked(page);
  await expectReferenceControlsLocked(page, true);
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123520.00"));
  await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toHaveText(/NMEA lines\s*6$/);
  await expectCollectionBlocked(page);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  await fillSyntheticGnssReferenceDeclaration(page);
  await expectCollectionBlocked(page);
  await connect(page, true, 2);
  await expect(page.getByRole("button", { name: "Capture Survey Point", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
});

for (const missingField of ["Vertical datum", "Geoid model"]) {
  test(`RTK missing declared ${missingField.toLowerCase()} blocks collection`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!);
    await page.getByTestId("gnss-reference-toggle").click();
    await page.getByRole("textbox", { name: missingField, exact: true }).fill("");
    await expect(page.getByTestId("gnss-reference-form")).toContainText("Incomplete");
    await page.getByTestId("gnss-reference-toggle").click();
    await connect(page, false);
    await expect(page.getByTestId("rtk-gate-reasons")).toContainText("Complete the receiver reference declaration");
    await expectCollectionBlocked(page);
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  });
}

for (const [label, vertical] of [
  ["GGA height", { height: "" }],
  ["GGA geoid separation", { geoidSeparation: "" }],
  ["GST height uncertainty", { heightUncertainty: "" }],
] as const) {
  test(`RTK missing vertical evidence (${label}) blocks capture despite a complete declaration`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!, { initialPayload: payload("123519.00", "3900.000000", "10400.000000", vertical) });
    await connect(page, false);
    await expect(page.getByTestId("gnss-reference-form")).toContainText("Declared, unverified");
    await expect(page.getByTestId("rtk-gate-reasons")).toContainText("coherent reported height, geoid separation and GST height standard uncertainty");
    await expectCollectionBlocked(page);
    await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123520.00"));
    await expect(page.getByTestId("rtk-gate-badge")).toContainText("Collection eligible");
    await expect(page.getByRole("button", { name: "Capture Survey Point", exact: true })).toBeEnabled();
    await expect(page.getByText("3D field accuracy", { exact: true }).locator("..")).toContainText("Unverified");
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  });
}

test("RTK permission requests are single-flight without a second connection", async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await expectReferenceControlsLocked(page, false);
  await page.getByRole("button", { name: "Open Serial", exact: true }).click();
  const opening = page.getByRole("button", { name: /^Open(ing)? Serial$/ });
  await opening.evaluate((node) => { (node as HTMLElement).click(); (node as HTMLElement).click(); });
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.requestCount)).toBe(1);
  await expect(opening).toBeDisabled();
  await expect(opening).toHaveText("Opening Serial");
  await expectReferenceControlsLocked(page, true);
  await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.grant());
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Collection eligible");
  await expectReferenceControlsLocked(page, true);
  await page.getByTestId("gnss-reference-toggle").click();
  for (const [name, value] of SYNTHETIC_GNSS_REFERENCE_INPUTS) {
    await expect(page.getByRole("textbox", { name, exact: true })).toHaveValue(value);
  }
  await expect(page.getByRole("textbox", { name: "Receiver source CRS", exact: true })).toHaveValue("EPSG:4326");
  await page.getByTestId("gnss-reference-toggle").click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.closeCalls)).toBe(1);
  await expectReferenceControlsLocked(page, false);
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
  await expectReferenceControlsLocked(page, true);
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
    await expectReferenceControlsLocked(page, true);
    await expect.poll(() => page.evaluate(() => (window as FixtureWindow).rtkLifecycleFixture.closeCalls)).toBe(1);
    await page.evaluate(() => {
      const fixture = (window as FixtureWindow).rtkLifecycleFixture;
      fixture.deferClose = false;
      fixture.releaseClose();
    });
  }
  await expect(page.getByRole("button", { name: "Retry Close", exact: true })).toBeEnabled();
  await expectReferenceControlsLocked(page, true);
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
  await expectReferenceControlsLocked(page, false);
});
}

test("RTK captured v2 evidence and unverified qualification survive reconnect metadata changes and ZIP round trip", async ({ page, baseURL }, testInfo) => {
  await prepare(page, baseURL!);
  await connect(page);
  await expect(page.getByTestId("workspace-live-rtk-status")).toContainText("RTK gate accepted");
  await page.getByRole("button", { name: "Capture Survey Point", exact: true }).click();
  await expect(page.getByTestId("rtk-status")).toContainText("Captured control survey point");
  await page.getByRole("button", { name: "Add Obstacle (0)", exact: true }).click();
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123520.00", "3900.006000"));
  await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toHaveText(/NMEA lines\s*6$/);
  await expect(page.getByRole("button", { name: "Add Obstacle (1)", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Add Obstacle (1)", exact: true }).click();
  await page.evaluate((value) => (window as FixtureWindow).rtkLifecycleFixture.emit(value), payload("123521.00", "3900.006000", "10359.994000"));
  await expect(page.getByText("NMEA lines", { exact: true }).locator("..")).toHaveText(/NMEA lines\s*9$/);
  await page.getByRole("button", { name: "Add Obstacle (2)", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Gate closed");
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  const reconnectedDeclaration = {
    ...SYNTHETIC_GNSS_REFERENCE_DECLARATION,
    receiverFirmware: "SYNTHETIC reconnect firmware 2",
    antennaHeightMeters: 2,
  };
  await page.getByTestId("gnss-reference-toggle").click();
  await page.getByRole("textbox", { name: "Receiver firmware", exact: true }).fill(reconnectedDeclaration.receiverFirmware);
  await page.getByRole("textbox", { name: "Antenna height metres", exact: true }).fill(String(reconnectedDeclaration.antennaHeightMeters));
  await expect(page.getByTestId("gnss-reference-form")).toContainText("Declared, unverified");
  await page.getByTestId("gnss-reference-toggle").click();
  await connect(page, true, 2);
  await page.getByRole("button", { name: "Capture Survey Point", exact: true }).click();
  await expect(page.getByTestId("rtk-status")).toContainText("Captured control survey point");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Serial", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Commit Obstacle", exact: true }).click();
  await expect(page.getByTestId("rtk-status")).toContainText("obstacle ring committed");
  await page.screenshot({ path: testInfo.outputPath("rtk-retained-draft.png") });
  await page.getByTestId("workspace-nav-files").click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  const download = await downloading;
  const zipBytes = await readFile((await download.path())!);
  const archive = unzipSync(new Uint8Array(zipBytes));
  const document = JSON.parse(strFromU8(archive["project.json"]));
  const obstacle = document.project.obstacles.at(-1);
  expect(obstacle.confidence).toBe("rtk_fixed");
  expect(obstacle.vertexCaptureEvidence).toHaveLength(3);
  expect(new Set(obstacle.vertexCaptureEvidence.map((e: { observationId: string }) => e.observationId)).size).toBe(3);
  const surveyPoint = document.project.surveyPoints.at(-2);
  const reconnectedPoint = document.project.surveyPoints.at(-1);
  expect(surveyPoint.confidence).toBe("rtk_fixed");
  expect(surveyPoint.captureEvidence.receiverObservedAt).toBe("2026-09-13T12:35:19.000Z");
  for (const evidence of [surveyPoint.captureEvidence, ...obstacle.vertexCaptureEvidence]) {
    expect(evidence).toMatchObject({
      schemaVersion: "gnss-capture-v2",
      transport: "web_serial",
      sourceCoordinateFrame: "EPSG:4326",
      antennaReference: "arp",
      coherent: true,
      height: { meters: 1600, type: "orthometric", geoidSeparationMeters: -20 },
      qualityScreen: {
        policy: "cplayout-nmea-collection-v2",
        physicalQualification: "unverified",
        receiverQuality: { fixType: "rtk_fixed", verticalAccuracyMeters: 0.02 },
      },
    });
    expect(evidence.referenceDeclaration).toEqual(SYNTHETIC_GNSS_REFERENCE_DECLARATION);
    expect(evidence.sentenceTypes).toEqual(expect.arrayContaining(["GGA", "GST", "RMC"]));
    expect(evidence.sessionId).toBe(surveyPoint.captureEvidence.sessionId);
  }
  expect(reconnectedPoint.captureEvidence).toMatchObject({
    schemaVersion: "gnss-capture-v2",
    receiverObservedAt: "2026-09-13T12:35:19.000Z",
    qualityScreen: { physicalQualification: "unverified" },
  });
  expect(reconnectedPoint.captureEvidence.referenceDeclaration).toEqual(reconnectedDeclaration);
  expect(reconnectedPoint.captureEvidence.sessionId).not.toBe(surveyPoint.captureEvidence.sessionId);
  expect(reconnectedPoint.captureEvidence.observationId).not.toBe(surveyPoint.captureEvidence.observationId);

  const choosing = page.waitForEvent("filechooser");
  await page.getByTestId("files-action-import-zip").click();
  await (await choosing).setFiles({ name: "SYNTHETIC-gnss-v2-round-trip.zip", mimeType: "application/zip", buffer: zipBytes });
  await expect(page.getByTestId("project-import-status")).toHaveText("Imported project saved locally.");
  await expect(page.getByTestId("project-save-state")).toHaveText("Saved");
  await page.getByTestId("workspace-nav-files").click();
  const reexporting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  const reexport = await reexporting;
  const roundTripArchive = unzipSync(new Uint8Array(await readFile((await reexport.path())!)));
  const roundTripDocument = JSON.parse(strFromU8(roundTripArchive["project.json"]));
  expect(roundTripDocument.project.surveyPoints.at(-2)).toEqual(surveyPoint);
  expect(roundTripDocument.project.surveyPoints.at(-1)).toEqual(reconnectedPoint);
  expect(roundTripDocument.project.obstacles.at(-1)).toEqual(obstacle);
});
