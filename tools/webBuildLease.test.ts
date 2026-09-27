import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireWebBuildLease, checkProofPort, completedRunIsProven, readWebBuildLeaseOwner, recoverWebBuildLease, withWebBuildLease } from "./webBuildLease";

if (process.argv[2] === "--child-try") {
  try {
    acquireWebBuildLease("child export", process.argv[3], undefined).release();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} else {
  void main();
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "cplayout-web-lease-"));
  const leaseDir = join(root, "web-build-lease");
  try {
  let actionCalled = false;
  for (const purpose of ["export:web", "workspace export:web", "proof:web", "ui:test:start"]) {
    await assert.rejects(withWebBuildLease(purpose, async () => {
      actionCalled = true;
    }, "", { platform: "win32", leaseDir }), /unsupported by native Windows Node.*no lease or build was started/);
    assert.equal(actionCalled, false);
    assert.equal(existsSync(leaseDir), false);
  }
  await withWebBuildLease("linux export", async () => {
    actionCalled = true;
    assert.equal(existsSync(leaseDir), true);
  }, "", { platform: "linux", leaseDir });
  assert.equal(actionCalled, true);
  assert.equal(existsSync(leaseDir), false);
  const first = acquireWebBuildLease("first export", leaseDir, undefined);
  assert.equal(readWebBuildLeaseOwner(leaseDir)?.purpose, "first export");
  assert.throws(() => acquireWebBuildLease("second export", leaseDir, undefined), /pid .*first export/);
  const childCommand = ["--import", "tsx", fileURLToPath(import.meta.url), "--child-try", leaseDir];
  const blockedChild = spawnSync(process.execPath, childCommand, { encoding: "utf8" });
  assert.equal(blockedChild.status, 1);
  assert.match(blockedChild.stderr, /first export/);
  const nested = acquireWebBuildLease("nested export", leaseDir, first.token);
  nested.release();
  assert.equal(readWebBuildLeaseOwner(leaseDir)?.token, first.token);
  assert.throws(() => acquireWebBuildLease("invalid nested", leaseDir, "wrong"), /Invalid inherited/);
  first.release();
  assert.equal(existsSync(leaseDir), false);
  assert.equal(spawnSync(process.execPath, childCommand, { encoding: "utf8" }).status, 0);

  mkdirSync(leaseDir);
  writeFileSync(join(leaseDir, "owner.json"), JSON.stringify({
    pid: 999_999_999,
    token: "dead-owner",
    purpose: "crashed proof",
    startedAt: "2026-09-26T00:00:00.000Z",
  }));
  assert.throws(() => acquireWebBuildLease("stale owner", leaseDir, undefined), /Explicit idle-confirmed recovery/);
  assert.throws(() => recoverWebBuildLease(leaseDir), /explicit confirmation/);
  recoverWebBuildLease(leaseDir, true);
  const recovered = acquireWebBuildLease("recovered proof", leaseDir, undefined);
  assert.equal(readWebBuildLeaseOwner(leaseDir)?.purpose, "recovered proof");
  recovered.release();

  mkdirSync(leaseDir);
  writeFileSync(join(leaseDir, "owner.json"), "{invalid");
  assert.throws(() => acquireWebBuildLease("uncertain owner", leaseDir, undefined), /owner metadata missing or invalid/);
  assert.equal(readFileSync(join(leaseDir, "owner.json"), "utf8"), "{invalid");
  recoverWebBuildLease(leaseDir, true);
  assert.equal(existsSync(leaseDir), false);

  mkdirSync(leaseDir);
  writeFileSync(join(leaseDir, "owner.json"), "");
  const reaperDir = `${leaseDir}.reaping`;
  mkdirSync(reaperDir);
  assert.throws(() => recoverWebBuildLease(leaseDir, true), /active or recent/);
  assert.equal(existsSync(leaseDir), true);
  const old = new Date(Date.now() - 120_000);
  utimesSync(reaperDir, old, old);
  recoverWebBuildLease(leaseDir, true);
  assert.equal(existsSync(leaseDir), false);
  assert.equal(existsSync(reaperDir), false);

  const orphan = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: process.platform !== "win32", stdio: "ignore",
  });
  assert.ok(orphan.pid);
  try {
    // A Windows npm wrapper can be gone while its grandchild is still running.
    assert.equal(completedRunIsProven({
      pid: process.pid, token: "windows-wrapper", purpose: "proof", startedAt: "2026-09-26T00:00:00.000Z",
      activeRun: { pid: 999_999_999, processGroup: null, command: "npm run proof:web" },
    }, "win32"), false);
    assert.equal(process.kill(orphan.pid, 0), true);
    mkdirSync(leaseDir);
    writeFileSync(join(leaseDir, "owner.json"), JSON.stringify({
      pid: 999_999_999,
      token: "orphaned-build",
      purpose: "crashed proof with active child",
      startedAt: "2026-09-26T00:00:00.000Z",
      activeRun: { pid: orphan.pid, processGroup: process.platform === "win32" ? null : orphan.pid, command: "test child" },
    }));
    assert.throws(() => recoverWebBuildLease(leaseDir, true), /Cannot recover live web build lease/);
    assert.equal(existsSync(leaseDir), true);
  } finally {
    orphan.kill("SIGTERM");
    await new Promise<void>((resolveClose) => orphan.once("close", () => resolveClose()));
  }
  recoverWebBuildLease(leaseDir, true);
  assert.equal(existsSync(leaseDir), false);

  const unknown = createServer((_request, response) => response.writeHead(200).end("unrelated"));
  await new Promise<void>((resolveListen) => unknown.listen(0, "127.0.0.1", resolveListen));
  const address = unknown.address();
  assert.ok(address && typeof address !== "string");
  await assert.rejects(checkProofPort(address.port), /unknown or unhealthy listener/);
  await new Promise<void>((resolveClose) => unknown.close(() => resolveClose()));
  assert.equal(await checkProofPort(address.port), "free");

  const otherCheckout = createServer((_request, response) => {
    response.writeHead(200, { "x-cplayout-static-server": "serveStaticWeb" });
    response.end(JSON.stringify({ app: "cplayout", server: "serveStaticWeb", ok: true, root: "/another/checkout/dist" }));
  });
  await new Promise<void>((resolveListen) => otherCheckout.listen(0, "127.0.0.1", resolveListen));
  const otherAddress = otherCheckout.address();
  assert.ok(otherAddress && typeof otherAddress !== "string");
  await assert.rejects(checkProofPort(otherAddress.port), /unknown or unhealthy listener/);
  await new Promise<void>((resolveClose) => otherCheckout.close(() => resolveClose()));

  const sameCheckout = createServer((_request, response) => {
    const address = sameCheckout.address();
    assert.ok(address && typeof address !== "string");
    response.writeHead(200, { "x-cplayout-static-server": "serveStaticWeb" });
    response.end(JSON.stringify({
      app: "cplayout", server: "serveStaticWeb", ok: true,
      root: resolve(dirname(fileURLToPath(import.meta.url)), "../apps/mobile/dist"), port: address.port,
    }));
  });
  await new Promise<void>((resolveListen) => sameCheckout.listen(0, "127.0.0.1", resolveListen));
  const sameAddress = sameCheckout.address();
  assert.ok(sameAddress && typeof sameAddress !== "string");
  try {
    assert.equal(await checkProofPort(sameAddress.port), "cplayout-static");
  } finally {
    await new Promise<void>((resolveClose) => sameCheckout.close(() => resolveClose()));
  }
  console.log("web build lease tests passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
