import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { WEB_BUILD_LEASE_TOKEN, runWebBuildCommand, withWebBuildLease } from "./webBuildLease";

export type ServerMode = "ui-test" | "dev-web";
export type PortClassification =
  | { kind: "free"; port: number }
  | { kind: "ownedHealthy"; port: number; state: ServerState; health: HealthCheck }
  | { kind: "ownedStale"; port: number; state: ServerState; reason: string }
  | { kind: "occupiedUnknown"; port: number; reason: string }
  | { kind: "likelyCplayoutNoState"; port: number; health: HealthCheck };

export interface ServerState {
  app: "cplayout";
  manager: "tools/devServerManager.ts";
  version: 1;
  mode: ServerMode;
  pid: number;
  port: number;
  url: string;
  root?: string;
  startedAt: string;
  cwd: string;
  command: string[];
  logPath: string;
  processStartIdentity?: string;
  stopRequestedAt?: string;
}

export interface HealthCheck {
  ok: boolean;
  statusCode?: number;
  header?: string | string[];
  body?: string;
  reason?: string;
}

export interface ManagerPaths {
  localDir: string;
  serversDir: string;
  logsDir: string;
}

interface StartOptions {
  mode: ServerMode;
  port?: number;
  reuseExport: boolean;
  openBrowser: boolean;
}

const TOOL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TOOL_DIR, "..");
const STATIC_ROOT = resolve(REPO_ROOT, "apps/mobile/dist");
const DEFAULT_STATIC_PORT = 19006;
const DEFAULT_DEV_PORT = 8081;
const STATIC_PORT_END = 19020;
const DEV_PORT_END = 8099;
const HEALTH_PATH = "/__cplayout_static_health";
const STATIC_HEALTH_HEADER = "x-cplayout-static-server";
const STATIC_HEALTH_VALUE = "serveStaticWeb";

export function getManagerPaths(repoRoot = REPO_ROOT): ManagerPaths {
  const localDir = join(repoRoot, ".cplayout-local");
  return {
    localDir,
    serversDir: join(localDir, "servers"),
    logsDir: join(localDir, "logs"),
  };
}

export function readStateFile(path: string): ServerState | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ServerState>;
    if (
      parsed.app !== "cplayout" ||
      parsed.manager !== "tools/devServerManager.ts" ||
      parsed.version !== 1 ||
      !["ui-test", "dev-web"].includes(parsed.mode ?? "") ||
      !Number.isInteger(parsed.pid) ||
      !Number.isInteger(parsed.port) ||
      parsed.port! <= 0 ||
      typeof parsed.cwd !== "string" ||
      typeof parsed.startedAt !== "string" ||
      parsed.url !== `http://127.0.0.1:${parsed.port}` ||
      !Array.isArray(parsed.command)
    ) {
      return null;
    }
    return parsed as ServerState;
  } catch {
    return null;
  }
}

export function statePathFor(mode: ServerMode, port: number, repoRoot = REPO_ROOT): string {
  return join(getManagerPaths(repoRoot).serversDir, `${mode}-${port}.json`);
}

export function listStateFiles(repoRoot = REPO_ROOT): string[] {
  const { serversDir } = getManagerPaths(repoRoot);
  if (!existsSync(serversDir)) return [];
  return readdirSync(serversDir)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => join(serversDir, entry));
}

export function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    if (existsSync(`/proc/${pid}/stat`)) {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function processMatchesState(state: ServerState): boolean {
  if (!isProcessRunning(state.pid)) return false;
  if (!state.processStartIdentity || processStartIdentity(state.pid) !== state.processStartIdentity) return false;
  const procDir = `/proc/${state.pid}`;
  if (existsSync(procDir)) {
    try {
      const liveCwd = realpathSync(join(procDir, "cwd"));
      const expectedCwd = realpathSync(state.cwd);
      const cmdline = readFileSync(join(procDir, "cmdline"), "utf8").replace(/\0/g, " ");
      if (liveCwd !== expectedCwd) return false;
      if (state.mode === "ui-test") {
        return cmdline.includes("serveStaticWeb.ts") && cmdline.includes(String(state.port));
      }
      return cmdline.includes(String(state.port)) && (cmdline.includes("expo") || cmdline.includes("@cplayout/mobile"));
    } catch {
      return false;
    }
  }
  return false;
}

export function processStartIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/)[19] ?? null;
  } catch { return null; }
}

export async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolveResult) => {
    const server = createServer();
    server.once("error", () => resolveResult(false));
    server.once("listening", () => {
      server.close(() => resolveResult(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function checkStaticHealth(port: number, repoRoot = REPO_ROOT): Promise<HealthCheck> {
  return new Promise((resolveResult) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: HEALTH_PATH,
        method: "GET",
        timeout: 1_500,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const header = res.headers[STATIC_HEALTH_HEADER];
          let reportedOk = false;
          let reason: string | undefined;
          try {
            const reported = JSON.parse(body) as {
              ok?: unknown; app?: unknown; server?: unknown; root?: unknown; port?: unknown; missing?: unknown;
            };
            reportedOk = reported.ok === true && reported.app === "cplayout" &&
              reported.server === "serveStaticWeb" && reported.root === resolve(repoRoot, "apps/mobile/dist") &&
              reported.port === port;
            if (!reportedOk && Array.isArray(reported.missing)) reason = `missing export files: ${reported.missing.join(", ")}`;
            else if (!reportedOk) reason = "static health identity or export did not match this checkout and port";
          } catch {
            reason = "invalid static health response";
          }
          resolveResult({
            ok: res.statusCode === 200 && header === STATIC_HEALTH_VALUE && reportedOk,
            statusCode: res.statusCode,
            header,
            body,
            reason,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Timed out")));
    req.on("error", (error) => resolveResult({ ok: false, reason: error.message }));
    req.end();
  });
}

async function waitForStaticHealth(port: number): Promise<HealthCheck> {
  let last: HealthCheck = { ok: false, reason: "not checked" };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    last = await checkStaticHealth(port);
    if (last.ok) return last;
    await new Promise((resolveResult) => setTimeout(resolveResult, 250));
  }
  return last;
}

async function listenerHealth(port: number): Promise<HealthCheck> {
  if (await isPortFree(port)) return { ok: false, reason: "port is free" };
  return { ok: true, reason: "port has a listener" };
}

export async function classifyPort(mode: ServerMode, port: number, repoRoot = REPO_ROOT): Promise<PortClassification> {
  const state = readStateFile(statePathFor(mode, port, repoRoot));
  if (await isPortFree(port)) {
    if (state) return { kind: "ownedStale", port, state, reason: "state file exists but port is free" };
    return { kind: "free", port };
  }

  const health = await checkStaticHealth(port, repoRoot);
  if (state) {
    if (processMatchesState(state) && (mode === "dev-web" || health.ok)) {
      return { kind: "ownedHealthy", port, state, health };
    }
    return { kind: "ownedStale", port, state, reason: "state exists but live process or health did not match" };
  }
  if (health.ok) return { kind: "likelyCplayoutNoState", port, health };
  return { kind: "occupiedUnknown", port, reason: health.reason ?? "listener did not expose CPLayout static health" };
}

export async function selectPort(mode: ServerMode, preferredPort: number, lastPort: number, repoRoot = REPO_ROOT): Promise<PortClassification> {
  for (let port = preferredPort; port <= lastPort; port += 1) {
    const classified = await classifyPort(mode, port, repoRoot);
    if (classified.kind !== "occupiedUnknown") return classified;
    console.log(`Port ${port} is occupied by an unknown listener; leaving it alone.`);
  }
  throw new Error(`No available ${mode} port in ${preferredPort}-${lastPort}`);
}

export function stopOwnedState(state: ServerState): "stop-requested" | "identity-mismatch" | "failed" {
  if (!processMatchesState(state)) return "identity-mismatch";
  try {
    process.kill(state.pid, "SIGTERM");
    return "stop-requested";
  } catch {
    return "failed";
  }
}

function verifiedLegacyStaticGroup(state: ServerState): number[] | null {
  if (process.platform !== "linux" || state.mode !== "ui-test" || state.command[0] !== "npx" ||
      !state.processStartIdentity || !existsSync("/proc")) return null;
  const members: number[] = [];
  for (const entry of readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    try {
      const procDir = `/proc/${pid}`;
      const statText = readFileSync(join(procDir, "stat"), "utf8");
      const stat = statText.slice(statText.lastIndexOf(")") + 2).trim().split(/\s+/);
      if (Number(stat[2]) !== state.pid || stat[0] === "Z") continue;
      const args = readFileSync(join(procDir, "cmdline"), "utf8").split("\0");
      if (realpathSync(join(procDir, "cwd")) !== realpathSync(state.cwd) ||
          !args.some((arg) => arg.endsWith("tools/serveStaticWeb.ts")) ||
          !args.includes(String(state.port)) || Number(stat[19]) < Number(state.processStartIdentity)) return null;
      members.push(pid);
    } catch { return null; }
  }
  return members.length ? members : null;
}

async function stopLegacyStaticGroup(state: ServerState, statePath: string, repoRoot: string, timeoutMs: number): Promise<StopResult> {
  const members = verifiedLegacyStaticGroup(state);
  if (!members || !(await checkStaticHealth(state.port, repoRoot)).ok) return "unknown";
  writeFileSync(statePath, `${JSON.stringify({ ...state, stopRequestedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  try { process.kill(-state.pid, "SIGTERM"); } catch { return "failed"; }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!verifiedLegacyStaticGroup(state) && await isPortFree(state.port)) {
      rmSync(statePath, { force: true });
      return "verified-stopped";
    }
    await new Promise((resolveResult) => setTimeout(resolveResult, 100));
  }
  return "failed";
}

export type StopResult = "verified-stopped" | "failed" | "unknown";

export async function stopTargetedState(state: ServerState, repoRoot = REPO_ROOT, timeoutMs = 5_000): Promise<StopResult> {
  const statePath = statePathFor(state.mode, state.port, repoRoot);
  const current = readStateFile(statePath);
  if (!current || current.pid !== state.pid || current.startedAt !== state.startedAt ||
      current.processStartIdentity !== state.processStartIdentity ||
      resolve(current.cwd) !== resolve(repoRoot)) return "unknown";
  if (current.mode === "ui-test" && current.command[0] === "npx" && !(await isPortFree(current.port))) {
    return stopLegacyStaticGroup(current, statePath, repoRoot, timeoutMs);
  }
  if (!isProcessRunning(current.pid)) {
    if (!(await isPortFree(current.port))) return "unknown";
    rmSync(statePath, { force: true });
    return "verified-stopped";
  }
  if (!processMatchesState(current)) return "unknown";
  writeFileSync(statePath, `${JSON.stringify({ ...current, stopRequestedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  if (stopOwnedState(current) !== "stop-requested") return "failed";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessRunning(current.pid) && await isPortFree(current.port)) {
      rmSync(statePath, { force: true });
      return "verified-stopped";
    }
    await new Promise((resolveResult) => setTimeout(resolveResult, 100));
  }
  return "failed";
}

async function start(options: StartOptions): Promise<void> {
  const mode = options.mode;
  const preferredPort = options.port ?? defaultPort(mode);
  const lastPort = mode === "ui-test" ? STATIC_PORT_END : DEV_PORT_END;
  ensureLocalDirs();
  let classified = await selectPort(mode, preferredPort, lastPort);

  if (classified.kind === "ownedHealthy") {
    console.log(`Reusing launcher-owned CPLayout ${mode} server at ${classified.state.url}`);
    if (options.openBrowser) openUrl(classified.state.url);
    return;
  }

  if (classified.kind === "likelyCplayoutNoState" && mode === "ui-test" && options.reuseExport) {
    const url = `http://127.0.0.1:${classified.port}`;
    console.log(`Reusing compatible CPLayout static server without launcher state at ${url}`);
    if (options.openBrowser) openUrl(url);
    return;
  }

  if (classified.kind === "ownedStale") {
    const result = await stopTargetedState(classified.state);
    console.log(`Launcher state for port ${classified.port}: ${result}.`);
    classified = await selectPort(mode, result === "verified-stopped" ? classified.port : classified.port + 1, lastPort);
  }

  if (classified.kind !== "free") {
    const next = await selectPort(mode, classified.port + 1, lastPort);
    classified = next;
  }

  if (mode === "ui-test") {
    if (!options.reuseExport) await runExportWeb();
    await startStaticServer(classified.port, options.openBrowser);
    return;
  }
  startExpoWeb(classified.port, options.openBrowser);
}

async function startStaticServer(port: number, openBrowser: boolean): Promise<void> {
  const logPath = logPathFor("ui-test", port);
  const command = [process.execPath, "--import", "tsx", "tools/serveStaticWeb.ts", "apps/mobile/dist", String(port)];
  const child = spawn(command[0], command.slice(1), {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", openLog(logPath), openLog(logPath)],
  });
  child.unref();
  const state = buildState("ui-test", child.pid ?? -1, port, command, logPath, STATIC_ROOT);
  writeState(state);
  const url = state.url;
  const health = await waitForStaticHealth(port);
  console.log(`Started CPLayout UI test server at ${url}`);
  console.log(`Health: ${health.ok ? "healthy" : `unhealthy (${health.reason ?? health.statusCode ?? "unknown"})`}`);
  console.log(`Log: ${logPath}`);
  if (!health.ok) {
    await stopTargetedState(state);
    throw new Error(`Static UI test server did not become healthy: ${health.reason ?? health.statusCode ?? "unknown"}`);
  }
  if (openBrowser) openUrl(url);
}

function startExpoWeb(port: number, openBrowser: boolean): void {
  const logPath = logPathFor("dev-web", port);
  const command = ["npm", "run", "web", "-w", "@cplayout/mobile", "--", "--port", String(port)];
  const child = spawn(command[0], command.slice(1), {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", openLog(logPath), openLog(logPath)],
    env: { ...process.env, BROWSER: openBrowser ? process.env.BROWSER ?? "" : "none" },
  });
  child.unref();
  const state = buildState("dev-web", child.pid ?? -1, port, command, logPath);
  writeState(state);
  console.log(`Started CPLayout Expo web dev server at ${state.url}`);
  console.log(`Log: ${logPath}`);
  if (openBrowser) openUrl(state.url);
}

function buildState(mode: ServerMode, pid: number, port: number, command: string[], logPath: string, root?: string): ServerState {
  return {
    app: "cplayout",
    manager: "tools/devServerManager.ts",
    version: 1,
    mode,
    pid,
    port,
    url: `http://127.0.0.1:${port}`,
    root,
    startedAt: new Date().toISOString(),
    cwd: REPO_ROOT,
    command,
    logPath,
    processStartIdentity: processStartIdentity(pid) ?? undefined,
  };
}

function writeState(state: ServerState): void {
  writeFileSync(statePathFor(state.mode, state.port), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function status(): Promise<void> {
  const states = listStateFiles().map((path) => ({ path, state: readStateFile(path) }));
  if (states.length === 0) {
    console.log("No launcher-owned CPLayout servers are recorded.");
    return;
  }
  for (const { path, state } of states) {
    if (!state) {
      console.log(`${path}: unreadable or invalid state`);
      continue;
    }
    const owned = processMatchesState(state);
    console.log(`${state.mode} ${state.url}`);
    console.log(`  pid: ${state.pid}`);
    console.log(`  port: ${state.port}`);
    console.log(`  startedAt: ${state.startedAt}`);
    console.log(`  launcherOwned: ${owned}`);
    const health = state.mode === "ui-test" ? await checkStaticHealth(state.port) : await listenerHealth(state.port);
    console.log(`  health: ${health.ok ? "healthy" : `unhealthy (${health.reason ?? health.statusCode ?? "unknown"})`}`);
    console.log(`  cwd: ${state.cwd}`);
    console.log(`  log: ${state.logPath}`);
  }
}

async function stop(selector?: { mode?: ServerMode; port?: number }): Promise<void> {
  const files = listStateFiles();
  if (files.length === 0) {
    console.log("No launcher-owned CPLayout servers are recorded.");
    return;
  }
  let failed = false;
  for (const path of files) {
    const name = basename(path);
    if (selector?.mode && !name.startsWith(`${selector.mode}-`)) continue;
    if (selector?.port && !name.endsWith(`-${selector.port}.json`)) continue;
    const state = readStateFile(path);
    if (!state) {
      console.log(`${path}: invalid state; metadata retained for inspection.`);
      failed = true;
      continue;
    }
    if (selector?.mode && state.mode !== selector.mode) continue;
    if (selector?.port && state.port !== selector.port) continue;
    const result = await stopTargetedState(state);
    console.log(`${state.mode} ${state.url}: ${result}`);
    if (result !== "verified-stopped") failed = true;
  }
  if (failed) throw new Error("One or more launcher resources were not verified stopped; retained state needs review.");
}

async function runExportWeb(): Promise<void> {
  const token = process.env[WEB_BUILD_LEASE_TOKEN];
  if (!token) throw new Error("UI export requires the active web build lease token.");
  console.log("Exporting CPLayout web app before starting static UI test server...");
  await runWebBuildCommand("npm", ["run", "export:web"], token);
}

function openUrl(url: string): void {
  const opener: [string, string[]] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] :
    process.platform === "darwin" ? ["open", [url]] :
    ["xdg-open", [url]];
  const result = spawnSync(opener[0], opener[1], { stdio: "ignore" });
  if (result.error) console.log(`Could not open browser automatically: ${result.error.message}`);
}

function defaultPort(mode: ServerMode): number {
  const raw = mode === "ui-test" ? process.env.CPLAYOUT_UI_TEST_PORT : process.env.CPLAYOUT_DEV_WEB_PORT;
  const fallback = mode === "ui-test" ? DEFAULT_STATIC_PORT : DEFAULT_DEV_PORT;
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${mode} port override: ${raw}`);
  return parsed;
}

function ensureLocalDirs(): void {
  const paths = getManagerPaths();
  mkdirSync(paths.serversDir, { recursive: true });
  mkdirSync(paths.logsDir, { recursive: true });
}

function logPathFor(mode: ServerMode, port: number): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(getManagerPaths().logsDir, `${mode}-${port}-${stamp}.log`);
}

function openLog(path: string): number {
  mkdirSync(dirname(path), { recursive: true });
  return openSync(path, "a");
}

function parseArgs(argv: string[]): { command: string; options: StartOptions; stopMode?: ServerMode } {
  const [command = "status", ...rest] = argv;
  const mode: ServerMode = command === "dev-web-smart" ? "dev-web" : "ui-test";
  const options: StartOptions = {
    mode,
    reuseExport: false,
    openBrowser: process.env.CPLAYOUT_NO_OPEN !== "1",
  };
  let stopMode: ServerMode | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--reuse-export") options.reuseExport = true;
    else if (arg === "--no-open") options.openBrowser = false;
    else if (arg === "--port") options.port = Number(rest[++i]);
    else if (arg.startsWith("--port=")) options.port = Number(arg.slice("--port=".length));
    else if (arg === "--mode") stopMode = rest[++i] as ServerMode;
    else if (arg.startsWith("--mode=")) stopMode = arg.slice("--mode=".length) as ServerMode;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (stopMode && !["ui-test", "dev-web"].includes(stopMode)) throw new Error(`Invalid stop mode: ${stopMode}`);
  if (command !== "stop" && stopMode) throw new Error("--mode is only valid for stop");
  if (options.port !== undefined && (!Number.isSafeInteger(options.port) || options.port <= 0)) throw new Error("Invalid port");
  return { command, options, stopMode };
}

async function main(): Promise<void> {
  const { command, options, stopMode } = parseArgs(process.argv.slice(2));
  if (command === "start") {
    await withWebBuildLease("ui:test:start", async (token) => {
      const previous = process.env[WEB_BUILD_LEASE_TOKEN];
      process.env[WEB_BUILD_LEASE_TOKEN] = token;
      try {
        await start(options);
      } finally {
        if (previous === undefined) delete process.env[WEB_BUILD_LEASE_TOKEN];
        else process.env[WEB_BUILD_LEASE_TOKEN] = previous;
      }
    }, "");
  }
  else if (command === "dev-web-smart") await start(options);
  else if (command === "status") await status();
  else if (command === "stop") await stop({ mode: stopMode, port: options.port });
  else throw new Error(`Unknown dev server manager command: ${command}`);
}

if (basename(process.argv[1] ?? "") === "devServerManager.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
