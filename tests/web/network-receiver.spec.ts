import { expect, test } from "@playwright/test";
import { createServer, type Socket } from "node:net";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { gga } from "./operational-receiver-fixture";

// Real local TCP/UDP + owned HTTP companion + browser adapter, with synthetic NMEA.
// This proves software integration only, not a physical receiver or field accuracy.
for (const protocol of ["tcp", "udp"] as const) {
  test(`${protocol}: owned companion carries NMEA to Survey, closes collection and cleans up`, async ({ page, baseURL }, info) => {
    const failures: string[] = []; page.on("pageerror", error => failures.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === new URL(baseURL!).origin ? route.continue() : route.abort("blockedbyclient"));
    const sockets = new Set<Socket>();
    const tcp = createServer(socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    const udp = createSocket("udp4");
    let port: number;
    if (protocol === "tcp") {
      tcp.listen(0, "127.0.0.1"); await once(tcp, "listening"); port = (tcp.address() as { port: number }).port;
    } else {
      const probe = createSocket("udp4"); probe.bind(0, "127.0.0.1"); await once(probe, "listening"); port = probe.address().port;
      await new Promise<void>(resolve => probe.close(() => resolve()));
      udp.bind(0, "127.0.0.1"); await once(udp, "listening");
    }
    const send = (sentence: string) => protocol === "tcp"
      ? Promise.resolve([...sockets][0]!.write(sentence))
      : new Promise<void>((resolve, reject) => udp.send(sentence, port, "127.0.0.1", error => error ? reject(error) : resolve()));
    // Advance synthetic receiver UTC with elapsed time, independent of host
    // wall-clock corrections, without masking queued or stale observations.
    const utcOriginMs = Date.now();
    const monotonicOriginMs = performance.now();
    const currentGga = (quality = 4) => gga(new Date(utcOriginMs + performance.now() - monotonicOriginMs)
      .toISOString().slice(11, 23).replace(/:/g, ""), quality);
    try {
      await page.goto("/");
      await page.getByTestId("command-menu-file").click();
      await page.getByTestId("command-file-sample-baseline-needs-review").click();
      await page.getByTestId("workspace-nav-survey").click();
      await page.getByRole("button", { name: "Wi-Fi / network", exact: true }).click();
      await page.getByRole("button", { name: protocol === "tcp" ? "TCP client" : "UDP receive", exact: true }).click();
      await page.getByRole("textbox", { name: protocol === "tcp" ? "Receiver IP address" : "Local listening IP address", exact: true }).fill("127.0.0.1");
      await page.getByRole("textbox", { name: "Network port", exact: true }).fill(String(port));
      if (protocol === "udp") await page.getByRole("textbox", { name: "Source IP filter (optional)", exact: true }).fill("127.0.0.1");
      expect(sockets.size).toBe(0);
      await page.screenshot({ path: info.outputPath(`${protocol}-communications-settings.png`) });
      await page.getByRole("button", { name: "Connect receiver", exact: true }).click();
      await expect(page.getByText("Connection: connected", { exact: true })).toBeVisible();
      const collect = page.getByRole("button", { name: "Capture Survey Point", exact: true });
      await expect(collect).toBeDisabled();
      await send(currentGga()); await expect(collect).toBeEnabled(); await collect.click();
      await send(currentGga(5)); await expect(collect).toBeDisabled();
      await send(currentGga()); await expect(collect).toBeEnabled();
      await expect(collect).toBeDisabled({ timeout: 5000 }); // includes bridge buffering and browser delivery age
      await page.getByTestId("workspace-nav-files").click();
      await page.getByTestId("workspace-nav-survey").click();
      await expect(page.getByText("Connection: connected", { exact: true })).toBeVisible();
      await expect(collect).toBeDisabled();
      await send(currentGga()); await expect(collect).toBeEnabled();
      await page.getByRole("button", { name: "Disconnect receiver", exact: true }).click();
      await expect(page.getByRole("button", { name: "Connect receiver", exact: true })).toBeEnabled();
      await expect(collect).toBeDisabled();
      if (protocol === "tcp") await expect.poll(() => sockets.size).toBe(0);
      else {
        const reclaimed = createSocket("udp4"); reclaimed.bind(port, "127.0.0.1"); await once(reclaimed, "listening");
        await new Promise<void>(resolve => reclaimed.close(() => resolve()));
      }
      await page.getByTestId("workspace-nav-files").click();
      const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
      const archive = unzipSync(await readFile((await (await download).path())!));
      const document = JSON.parse(strFromU8(archive["project.json"]));
      const point = document.project.surveyPoints.at(-1);
      expect(point.captureEvidence.schemaVersion).toBe("gnss-operational-fixed-v1");
      expect(point.captureEvidence.transport).toBe(`local_${protocol}`);
      expect(point.captureEvidence.physicalQualification).toBe("unverified");
      expect(failures).toEqual([]);
    } finally {
      const disconnect = page.getByRole("button", { name: "Disconnect receiver", exact: true });
      if (await disconnect.isVisible()) await disconnect.click();
      for (const socket of sockets) socket.destroy();
      if (tcp.listening) await new Promise<void>(resolve => tcp.close(() => resolve()));
      try { await new Promise<void>(resolve => udp.close(() => resolve())); } catch { /* TCP case never opened UDP */ }
    }
  });
}
