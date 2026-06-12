import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ServerState,
  classifyPort,
  getManagerPaths,
  readStateFile,
  selectPort,
  statePathFor,
} from "./devServerManager";

void main();

async function main(): Promise<void> {
  const repoRoot = mkdtempSync(join(tmpdir(), "cplayout-dev-server-manager-"));
  mkdirSync(getManagerPaths(repoRoot).serversDir, { recursive: true });

  const free = await classifyPort("ui-test", 19180, repoRoot);
  assert.equal(free.kind, "free");

  const staleState = buildState(repoRoot, 19181, 999_999);
  writeState(repoRoot, staleState);
  const stale = await classifyPort("ui-test", 19181, repoRoot);
  assert.equal(stale.kind, "ownedStale");

  const unknownServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("not cplayout");
  });
  await listen(unknownServer, 19182);
  try {
    const unknown = await classifyPort("ui-test", 19182, repoRoot);
    assert.equal(unknown.kind, "occupiedUnknown");

    const selected = await selectPort("ui-test", 19182, 19183, repoRoot);
    assert.equal(selected.kind, "free");
    assert.equal(selected.port, 19183);
  } finally {
    await close(unknownServer);
  }

  const cplayoutServer = createServer((request, response) => {
    if (request.url === "/__cplayout_static_health") {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-cplayout-static-server": "serveStaticWeb",
      });
      response.end(JSON.stringify({ app: "cplayout", ok: true }));
      return;
    }
    response.writeHead(404).end();
  });
  await listen(cplayoutServer, 19184);
  try {
    const compatible = await classifyPort("ui-test", 19184, repoRoot);
    assert.equal(compatible.kind, "likelyCplayoutNoState");
  } finally {
    await close(cplayoutServer);
  }

  assert.equal(readStateFile(statePathFor("ui-test", 19999, repoRoot)), null);
  writeFileSync(statePathFor("ui-test", 19999, repoRoot), "{\"app\":\"other\"}\n", "utf8");
  assert.equal(readStateFile(statePathFor("ui-test", 19999, repoRoot)), null);

  console.log("dev server manager tests passed");
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
