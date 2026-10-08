import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { readFile } from "node:fs/promises";
import { connectOperationalReceiver, emitGga, gga, installOperationalReceiver, type ReceiverFixtureWindow } from "./operational-receiver-fixture";

// The desktop policy now collects from current checksummed quality-4 GGA without a
// receiver/reference questionnaire. Historical gnss-capture-v1/v2 evidence remains
// unchanged in core and archive compatibility tests; these browser cases verify
// the distinct operational evidence, transport lifecycle and command-time gate.
async function prepare(page: Page, baseURL: string, initialPayload = "", mapReceiver = false) {
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.abort("blockedbyclient"));
  await installOperationalReceiver(page, initialPayload);
  await page.goto("/");
  await page.getByTestId("command-menu-file").click();
  await page.getByTestId("command-file-sample-baseline-needs-review").click();
  if (mapReceiver) {
    await page.getByTestId("task-design").click();
    const close = page.getByRole("button", { name: /Collapse (map inspector|right workflow sidebar)/ }).first();
    if (await close.isVisible()) await close.click();
    await page.getByTestId("map-bottom-hud").getByTestId("design-action-point").click();
    await page.getByTestId("map-tool-rtk").click();
  } else await page.getByTestId("task-survey").click();
}
async function selectPurpose(page: Page, purpose: "point" | "boundary" | "obstacle" | "feature") {
  await page.getByTestId(`survey-purpose-${purpose}`).click();
  await expect(page.getByTestId(`survey-${purpose}-controls`)).toBeVisible();
}
async function openReceiverSettings(page: Page) {
  if (!await page.getByTestId("receiver-settings").isVisible()) await page.getByTestId("receiver-settings-toggle").click();
  await expect(page.getByTestId("receiver-settings")).toBeVisible();
}
async function ready(page: Page) {
  await selectPurpose(page, "point");
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Live capture available");
  await expect(page.getByRole("button", { name: "Capture Survey Point", exact: true })).toBeEnabled();
}
async function blocked(page: Page) {
  await expect(page.getByTestId("rtk-gate-badge")).toContainText("Live capture unavailable");
  for (const [purpose, name] of [["point", "Capture Survey Point"], ["boundary", "Add Boundary (0)"], ["obstacle", "Add Obstacle (0)"], ["feature", "Add Feature Vertex (0)"]] as const) {
    await selectPurpose(page, purpose);
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await selectPurpose(page, "point");
}
async function disconnect(page: Page) {
  await openReceiverSettings(page);
  await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect receiver", exact: true })).toBeEnabled();
}
async function exportProject(page: Page) {
  await page.getByTestId("workspace-nav-files").click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
  const bytes = await readFile((await (await downloading).path())!);
  const archive = unzipSync(new Uint8Array(bytes));
  return { bytes, document: JSON.parse(strFromU8(archive["project.json"])) };
}

test("shared receiver survives Survey, Files and map navigation with one owned port", async ({ page, baseURL }) => {
  await prepare(page, baseURL!, gga(), true);
  await connectOperationalReceiver(page); await ready(page);
  await selectPurpose(page, "boundary");
  await page.getByRole("button", { name: "Add Boundary (0)", exact: true }).click();
  await page.getByTestId("task-design").click();
  const closeSidebar = page.getByRole("button", { name: /Collapse (map inspector|right workflow sidebar)/ }).first();
  if (await closeSidebar.isVisible()) await closeSidebar.click();
  const toolbar = page.getByTestId("map-bottom-hud");
  await toolbar.getByTestId("design-action-pan").click();
  await toolbar.getByTestId("design-action-pan-start").click();
  await page.getByTestId("task-survey").click();
  await selectPurpose(page, "boundary");
  await expect(page.getByRole("button", { name: "Add Boundary (1)", exact: true })).toBeEnabled();
  await page.getByTestId("workspace-nav-files").click();
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(1);
  await page.getByTestId("task-survey").click(); await ready(page);
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.requestCount)).toBe(1);
  await disconnect(page);
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(0);
});

for (const geometry of ["Line", "Polygon"]) {
  test(`captured ${geometry} vertices retain evidence while live collection closes after disconnect`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!);
    await selectPurpose(page, "feature");
    if (geometry === "Polygon") await page.getByRole("button", { name: "Planning boundary", exact: true }).click();
    await connectOperationalReceiver(page);
    for (let index = 0; index < 3; index++) {
      await emitGga(page, gga(`12000${index}.00`, 4, "GNGGA", index === 0 ? "4042.5900" : "4042.5960", index === 2 ? "10458.9940" : "10459.0000"));
      await ready(page);
      await selectPurpose(page, "obstacle");
      await page.getByRole("button", { name: `Add Obstacle (${index})`, exact: true }).click();
      await selectPurpose(page, "feature");
      await page.getByRole("button", { name: `Add Feature Vertex (${index})`, exact: true }).click();
    }
    await disconnect(page);
    await selectPurpose(page, "obstacle");
    await expect(page.getByRole("button", { name: "Add Obstacle (3)", exact: true })).toBeDisabled();
    await selectPurpose(page, "feature");
    await expect(page.getByRole("button", { name: "Add Feature Vertex (3)", exact: true })).toBeDisabled();
    // Saving already captured work remains possible without inventing a fresh observation.
    await selectPurpose(page, "obstacle");
    await page.getByRole("button", { name: "Use captured obstacle in this design", exact: true }).click();
    await expect(page.getByTestId("rtk-status")).toContainText("obstacle ring committed");
    await selectPurpose(page, "feature");
    await page.getByRole("button", { name: `Save ${geometry} Feature`, exact: true }).click();
    await expect(page.getByTestId("rtk-status")).toContainText("saved as projected XY");
    const { document } = await exportProject(page);
    const obstacle = document.project.obstacles.at(-1);
    const feature = document.project.mapFeatures.at(-1);
    expect(obstacle.vertexCaptureEvidence).toHaveLength(3);
    expect(feature.vertexCaptureEvidence).toEqual(obstacle.vertexCaptureEvidence);
    expect(new Set(obstacle.vertexCaptureEvidence.map((value: { observationId: string }) => value.observationId)).size).toBe(3);
    expect(feature.geometry.type).toBe(geometry === "Line" ? "LineString" : "Polygon");
    expect(feature.vertexCaptureEvidence.every((value: { schemaVersion: string }) => value.schemaVersion === "gnss-operational-fixed-v1")).toBe(true);
  });
}

test("all non-4 qualities, invalid checksums, duplicate and late epochs close collection", async ({ page, baseURL }) => {
  await prepare(page, baseURL!); await connectOperationalReceiver(page);
  let seconds = 0;
  const epoch = () => `1200${String(seconds++).padStart(2, "0")}.00`;
  for (const quality of [0, 1, 2, 3, 5, 6, 7, 8]) {
    await emitGga(page, gga(epoch())); await ready(page);
    await emitGga(page, gga(epoch(), quality)); await blocked(page);
  }
  const current = epoch();
  await emitGga(page, gga(current)); await ready(page);
  await emitGga(page, gga(current)); await blocked(page);
  await emitGga(page, gga("115959.00")); await blocked(page);
  await emitGga(page, gga(epoch())); await ready(page);
  await emitGga(page, gga(epoch()).replace(/\*[a-f0-9]{2}/i, "*ZZ")); await blocked(page);
  await emitGga(page, gga(epoch())); await ready(page);
  await disconnect(page);
});

test("midnight rollover accepts new GPGGA and stale capture is rechecked before its command executes", async ({ page, baseURL }) => {
  await prepare(page, baseURL!); await connectOperationalReceiver(page);
  await emitGga(page, gga("235959.00", 4, "GPGGA")); await ready(page);
  await emitGga(page, gga("000000.00", 4, "GPGGA")); await ready(page);
  await expect(page.getByText("Sentence: GPGGA", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Capture Survey Point", exact: true }).evaluate(node => {
    (window as ReceiverFixtureWindow).operationalReceiver.nowMs += 2001;
    (node as HTMLElement).click();
  });
  await expect(page.getByTestId("rtk-status")).toContainText("Collection blocked");
  await blocked(page);
  await emitGga(page, gga("000002.00", 4, "GPGGA")); await ready(page);
  await disconnect(page);
});

test("binary payload cannot inject GGA or resume collection in the same connection", async ({ page, baseURL }) => {
  await prepare(page, baseURL!, gga()); await connectOperationalReceiver(page); await ready(page);
  const raw = [0xee, ...new TextEncoder().encode(gga("120001.00"))];
  const frame = [0xa0, 0xa1, raw.length >>> 8, raw.length & 0xff, ...raw, raw.reduce((sum, byte) => sum ^ byte, 0), 13, 10];
  await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.emitBytes([0xa0])); await blocked(page);
  await page.evaluate(bytes => (window as ReceiverFixtureWindow).operationalReceiver.emitBytes(bytes), frame.slice(1));
  await blocked(page);
  await expect(page.getByTestId("receiver-status")).toContainText("Binary");
  await emitGga(page, gga("120002.00")); await blocked(page);
  await disconnect(page); await connectOperationalReceiver(page, 2); await ready(page); await disconnect(page);
});

test("old partial GGA cannot acquire fresh age from a later completing chunk", async ({ page, baseURL }) => {
  await prepare(page, baseURL!, gga()); await connectOperationalReceiver(page); await ready(page);
  const next = gga("120001.00");
  await emitGga(page, next.slice(0, 25));
  await emitGga(page, next.slice(25), 2100); await blocked(page);
  await emitGga(page, gga("120004.00")); await ready(page); await disconnect(page);
});

for (const identifier of ["GPGGA", "GNGGA"]) {
  test(`${identifier} alone collects with unknown supplementary height and reference evidence`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!, gga("120000.00", 4, identifier, undefined, undefined, false));
    await expect(page.getByRole("textbox", { name: "Baud rate", exact: true })).toHaveValue("115200");
    await expect(page.getByTestId("gnss-reference-form")).toHaveCount(0);
    await connectOperationalReceiver(page); await ready(page);
    await expect(page.getByText("Fix: RTK Fixed — receiver reported", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Capture Survey Point", exact: true }).click();
    await disconnect(page);
    const { document } = await exportProject(page);
    const evidence = document.project.surveyPoints.at(-1).captureEvidence;
    expect(document.schemaVersion ?? document.documentVersion).toBe("pivot-project-v3");
    expect(evidence).toMatchObject({ schemaVersion: "gnss-operational-fixed-v1", antennaReference: "unknown", physicalQualification: "unverified", gga: { qualityCode: 4, sentenceIdentifier: identifier } });
    expect(evidence.referenceDeclaration).toBeUndefined();
    expect(evidence.height).toBeUndefined();
    expect(evidence.capture.ageMs).toBeLessThanOrEqual(2000);
  });
}

test("permission denial and rapid repeated connect requests never create a second port", async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.evaluate(() => { (window as ReceiverFixtureWindow).operationalReceiver.denyNext = true; });
  await page.getByRole("button", { name: "Connect receiver", exact: true }).click();
  await expect(page.getByTestId("receiver-status")).toContainText("Synthetic chooser denial");
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(0);
  await page.getByRole("button", { name: "Connect receiver", exact: true }).click();
  const opening = page.getByRole("button", { name: "Connecting…", exact: true });
  await expect(opening).toBeDisabled();
  await opening.evaluate(node => { (node as HTMLElement).click(); (node as HTMLElement).click(); });
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.requestCount)).toBe(2);
  await expect(page.getByRole("textbox", { name: "Baud rate", exact: true })).not.toBeEditable();
  await page.getByTestId("workspace-nav-files").click();
  await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.grant());
  await page.getByTestId("task-survey").click();
  await expect(page.getByRole("button", { name: "Disconnect receiver", exact: true })).toBeEnabled();
  await blocked(page);
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(1);
  await emitGga(page, gga()); await ready(page); await disconnect(page);
});

for (const deferred of [false, true]) {
  test(`cleanup failure remains owned across navigation until explicit retry: deferred=${deferred}`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!, gga()); await connectOperationalReceiver(page); await ready(page);
    await page.evaluate(defer => { const fixture = (window as ReceiverFixtureWindow).operationalReceiver; fixture.failCloseCount = 1; fixture.deferClose = defer; }, deferred);
    await openReceiverSettings(page);
    await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
    if (deferred) {
      await expect(page.getByRole("button", { name: "Disconnecting…", exact: true })).toBeDisabled();
      await page.evaluate(() => { const fixture = (window as ReceiverFixtureWindow).operationalReceiver; fixture.deferClose = false; fixture.releaseClose(); });
    }
    await expect(page.getByTestId("receiver-status")).toContainText("Synthetic port cleanup failure");
    await blocked(page);
    await expect(page.getByRole("button", { name: "Connect receiver", exact: true })).toHaveCount(0);
    await page.getByTestId("workspace-nav-files").click(); await page.getByTestId("task-survey").click();
    expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(1);
    expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.closeCalls)).toBe(1);
    await disconnect(page);
    expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.closeCalls)).toBe(2);
    expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.openPorts)).toBe(0);
    await blocked(page);
  });
}

test("switching from USB to Bluetooth creates fresh identities, requires new GGA and round-trips captured evidence", async ({ page, baseURL }) => {
  await prepare(page, baseURL!); await connectOperationalReceiver(page);
  await emitGga(page, gga()); await ready(page);
  await page.getByRole("button", { name: "Capture Survey Point", exact: true }).click();
  await disconnect(page);
  await page.getByRole("button", { name: "Bluetooth serial", exact: true }).click();
  await connectOperationalReceiver(page, 2); await blocked(page);
  await emitGga(page, gga()); await ready(page);
  await page.getByRole("button", { name: "Capture Survey Point", exact: true }).click();
  await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.end());
  await expect(page.getByRole("button", { name: "Connect receiver", exact: true })).toBeEnabled(); await blocked(page);
  const exported = await exportProject(page);
  const points = exported.document.project.surveyPoints.slice(-2);
  expect(points[0].captureEvidence.transport).toBe("web_serial");
  expect(points[1].captureEvidence.transport).toBe("bluetooth_spp");
  expect(points[1].captureEvidence.sessionId).not.toBe(points[0].captureEvidence.sessionId);
  expect(points[1].captureEvidence.observationId).not.toBe(points[0].captureEvidence.observationId);
  const choosing = page.waitForEvent("filechooser"); await page.getByTestId("files-action-import-zip").click();
  await (await choosing).setFiles({ name: "synthetic-operational-roundtrip.zip", mimeType: "application/zip", buffer: exported.bytes });
  await expect(page.getByTestId("project-import-status")).toHaveText("Imported project saved locally.");
  const reopened = await exportProject(page);
  expect(reopened.document.project.surveyPoints.slice(-2)).toEqual(points);
});

test("network setup exposes communications fields without starting an unsolicited connection", async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.getByRole("button", { name: "Wi-Fi / network", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Receiver IP address", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "UDP receive", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Local listening IP address", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Source IP filter (optional)", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Network port", exact: true })).toBeVisible();
  await blocked(page);
  expect(await page.evaluate(() => (window as ReceiverFixtureWindow).operationalReceiver.requestCount)).toBe(0);
});
