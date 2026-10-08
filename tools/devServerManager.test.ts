import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ServerState,
  classifyPort,
  checkStaticHealth,
  getManagerPaths,
  readStateFile,
  selectPort,
  statePathFor,
  processStartIdentity,
  stopTargetedState,
  isPortFree,
} from "./devServerManager";

void main();

async function main(): Promise<void> {
  const repoRoot = mkdtempSync(join(tmpdir(), "cplayout-dev-server-manager-"));
  mkdirSync(getManagerPaths(repoRoot).serversDir, { recursive: true });
  const base = await findFreeBlock(6);

  const free = await classifyPort("ui-test", base, repoRoot);
  assert.equal(free.kind, "free");

  const staleState = buildState(repoRoot, base + 1, 999_999);
  writeState(repoRoot, staleState);
  const stale = await classifyPort("ui-test", base + 1, repoRoot);
  assert.equal(stale.kind, "ownedStale");

  const unknownServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("not cplayout");
  });
  await listen(unknownServer, base + 2);
  try {
    const unknown = await classifyPort("ui-test", base + 2, repoRoot);
    assert.equal(unknown.kind, "occupiedUnknown");

    const selected = await selectPort("ui-test", base + 2, base + 3, repoRoot);
    assert.equal(selected.kind, "free");
    assert.equal(selected.port, base + 3);
  } finally {
    await close(unknownServer);
  }

  const cplayoutServer = createServer((request, response) => {
    if (request.url === "/__cplayout_static_health") {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-cplayout-static-server": "serveStaticWeb",
      });
      response.end(JSON.stringify({ app: "cplayout", server: "serveStaticWeb", root: join(repoRoot, "apps/mobile/dist"), port: base + 4, ok: true }));
      return;
    }
    response.writeHead(404).end();
  });
  await listen(cplayoutServer, base + 4);
  try {
    const compatible = await classifyPort("ui-test", base + 4, repoRoot);
    assert.equal(compatible.kind, "likelyCplayoutNoState");
  } finally {
    await close(cplayoutServer);
  }

  for (const [name, identity] of [
    ["another checkout", { app: "cplayout", server: "serveStaticWeb", root: "/another/checkout/dist", port: base + 5, ok: true }],
    ["another port", { app: "cplayout", server: "serveStaticWeb", root: join(repoRoot, "apps/mobile/dist"), port: base + 4, ok: true }],
    ["missing server", { app: "cplayout", root: join(repoRoot, "apps/mobile/dist"), port: base + 5, ok: true }],
  ] as const) {
    const impostor = createServer((_request, response) => {
      response.writeHead(200, { "x-cplayout-static-server": "serveStaticWeb" });
      response.end(JSON.stringify(identity));
    });
    await listen(impostor, base + 5);
    try {
      assert.equal((await checkStaticHealth(base + 5, repoRoot)).ok, false, name);
      assert.equal((await classifyPort("ui-test", base + 5, repoRoot)).kind, "occupiedUnknown", name);
    } finally {
      await close(impostor);
    }
  }

  assert.equal(readStateFile(statePathFor("ui-test", 19999, repoRoot)), null);

  const reserved = createServer();
  await new Promise<void>((resolve, reject) => { reserved.once("error", reject); reserved.listen(0, "127.0.0.1", resolve); });
  const targetPort = (reserved.address() as { port: number }).port;
  await close(reserved);
  const child = spawn(process.execPath, ["-e", "require('node:http').createServer((q,r)=>r.end('owned')).listen(Number(process.argv[2]),'127.0.0.1')", "serveStaticWeb.ts", String(targetPort)], {
    cwd: repoRoot, stdio: "ignore",
  });
  try {
    for (let i = 0; i < 50 && await isPortFree(targetPort); i += 1) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await isPortFree(targetPort), false);
    const owned = { ...buildState(repoRoot, targetPort, child.pid!), command: [process.execPath, "--import", "tsx", "tools/serveStaticWeb.ts", "apps/mobile/dist", String(targetPort)], processStartIdentity: processStartIdentity(child.pid!)! };
    writeState(repoRoot, owned);
    const wrong = { ...owned, processStartIdentity: "incorrect" };
    assert.equal(await stopTargetedState(wrong, repoRoot, 200), "unknown");
    assert.equal(await isPortFree(targetPort), false);
    assert.equal(await stopTargetedState(owned, repoRoot), "verified-stopped");
    assert.equal(await isPortFree(targetPort), true);
    assert.equal(readStateFile(statePathFor("ui-test", targetPort, repoRoot)), null);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }

  const legacyPortServer = createServer();
  await new Promise<void>((resolve, reject) => { legacyPortServer.once("error", reject); legacyPortServer.listen(0, "127.0.0.1", resolve); });
  const legacyPort = (legacyPortServer.address() as { port: number }).port;
  await close(legacyPortServer);
  const healthBody = JSON.stringify({ app: "cplayout", server: "serveStaticWeb", root: join(repoRoot, "apps/mobile/dist"), port: legacyPort, ok: true });
  const legacyChildCode = `require('node:http').createServer((q,r)=>{r.writeHead(200,{'x-cplayout-static-server':'serveStaticWeb'});r.end(${JSON.stringify(healthBody)})}).listen(Number(process.argv[2]),'127.0.0.1')`;
  const legacyLeaderCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(legacyChildCode)},'tools/serveStaticWeb.ts',${JSON.stringify(String(legacyPort))}],{stdio:'ignore'}).unref();setTimeout(()=>process.exit(0),500)`;
  const legacyLeader = spawn(process.execPath, ["-e", legacyLeaderCode], { cwd: repoRoot, detached: true, stdio: "ignore" });
  const legacyStartIdentity = processStartIdentity(legacyLeader.pid!);
  assert.ok(legacyStartIdentity);
  await new Promise(resolve => legacyLeader.once("exit", resolve));
  for (let i = 0; i < 50 && await isPortFree(legacyPort); i += 1) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await isPortFree(legacyPort), false);
  const legacyState = { ...buildState(repoRoot, legacyPort, legacyLeader.pid!), processStartIdentity: legacyStartIdentity! };
  writeState(repoRoot, legacyState);
  assert.equal(await stopTargetedState(legacyState, repoRoot), "verified-stopped");
  assert.equal(await isPortFree(legacyPort), true);

  writeFileSync(statePathFor("ui-test", 19999, repoRoot), "{\"app\":\"other\"}\n", "utf8");
  assert.equal(readStateFile(statePathFor("ui-test", 19999, repoRoot)), null);

  console.log("dev server manager tests passed");
}

async function findFreeBlock(length: number): Promise<number> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = (server.address() as { port: number }).port;
    await close(server);
    if (base + length >= 65535) continue;
    if ((await Promise.all(Array.from({ length }, (_, index) => isPortFree(base + index)))).every(Boolean)) return base;
  }
  throw new Error("Could not allocate free test port block");
}

function buildState(repoRoot: string, port: number, pid: number): ServerState {
  return {
    app: "cplayout",
    manager: "tools/devServerManager.ts",
    version: 1,
    mode: "ui-test",
    pid,
    port,
    url: `http://127.0.0.1:${port}`,
    startedAt: "2026-06-12T00:00:00.000Z",
    cwd: repoRoot,
    command: ["npx", "tsx", "tools/serveStaticWeb.ts", "apps/mobile/dist", String(port)],
    logPath: join(repoRoot, ".cplayout-local/logs/test.log"),
  };
}

function writeState(repoRoot: string, state: ServerState): void {
  writeFileSync(statePathFor(state.mode, state.port, repoRoot), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
