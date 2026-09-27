import { spawn, spawnSync } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEASE_DIR = join(REPO_ROOT, ".cplayout-local", "web-build-lease");
export const WEB_BUILD_LEASE_TOKEN = "CPLAYOUT_WEB_BUILD_LEASE_TOKEN";

export interface WebBuildLeaseOwner {
  pid: number;
  token: string;
  purpose: string;
  startedAt: string;
  activeRun?: { pid: number; processGroup: number | null; command: string };
}

const STALE_REAPER_MIN_AGE_MS = 60_000;

function ownerPath(leaseDir: string): string {
  return join(leaseDir, "owner.json");
}

export function readWebBuildLeaseOwner(leaseDir = LEASE_DIR): WebBuildLeaseOwner | null {
  try {
    const value = JSON.parse(readFileSync(ownerPath(leaseDir), "utf8")) as Partial<WebBuildLeaseOwner>;
    if (!Number.isInteger(value.pid) || (value.pid ?? 0) <= 0 ||
        typeof value.token !== "string" || !value.token ||
        typeof value.purpose !== "string" || typeof value.startedAt !== "string") return null;
    if (value.activeRun && (!Number.isInteger(value.activeRun.pid) || value.activeRun.pid <= 0 ||
        (value.activeRun.processGroup !== null && (!Number.isInteger(value.activeRun.processGroup) || value.activeRun.processGroup <= 0)) ||
        typeof value.activeRun.command !== "string")) return null;
    return value as WebBuildLeaseOwner;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function activeRunAlive(owner: WebBuildLeaseOwner, platform = process.platform): boolean {
  const run = owner.activeRun;
  if (!run) return false;
  if (run.processGroup && platform !== "win32") {
    try {
      process.kill(-run.processGroup, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    }
  }
  return pidAlive(run.pid);
}

export function completedRunIsProven(owner: WebBuildLeaseOwner, platform = process.platform): boolean {
  if (!owner.activeRun || !owner.activeRun.processGroup || platform === "win32" || process.platform === "win32") return false;
  return !activeRunAlive(owner, platform);
}

function writeOwner(leaseDir: string, owner: WebBuildLeaseOwner): void {
  const temporary = join(leaseDir, `owner-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(owner, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, ownerPath(leaseDir));
  } finally {
    rmSync(temporary, { force: true });
  }
}

function updateActiveRun(token: string, run: WebBuildLeaseOwner["activeRun"]): void {
  const owner = readWebBuildLeaseOwner(LEASE_DIR);
  if (!owner || owner.token !== token || owner.pid !== process.pid) return;
  writeOwner(LEASE_DIR, { ...owner, activeRun: run });
}

function describeOwner(owner: WebBuildLeaseOwner | null): string {
  return owner ? `pid ${owner.pid}, ${owner.purpose}, started ${owner.startedAt}` : "owner metadata missing or invalid";
}

export function acquireWebBuildLease(purpose: string, leaseDir = LEASE_DIR, inheritedToken = process.env[WEB_BUILD_LEASE_TOKEN]): {
  token: string;
  release: () => void;
} {
  mkdirSync(dirname(leaseDir), { recursive: true });
  const reaperDir = `${leaseDir}.reaping`;
  if (inheritedToken) {
    const owner = readWebBuildLeaseOwner(leaseDir);
    if (owner?.token !== inheritedToken || !pidAlive(owner.pid)) {
      throw new Error(`Invalid inherited web build lease for ${purpose}; current owner: ${describeOwner(owner)}`);
    }
    return { token: inheritedToken, release: () => {} };
  }

  if (existsSync(reaperDir)) throw new Error(`Web build lease recovery is in progress: ${reaperDir}`);
  const token = randomUUID();
  try {
    mkdirSync(leaseDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = readWebBuildLeaseOwner(leaseDir);
    throw new Error(`Web build lease held at ${leaseDir}: ${describeOwner(owner)}. ` +
      (owner && pidAlive(owner.pid) ? "Wait for its owner to finish." : "Explicit idle-confirmed recovery is required; an orphaned build may still be running."));
  }
  if (existsSync(reaperDir)) {
    throw new Error(`Web build lease recovery raced acquisition at ${reaperDir}; empty lease directory retained for explicit recovery.`);
  }
  const owner: WebBuildLeaseOwner = { pid: process.pid, token, purpose, startedAt: new Date().toISOString() };
  writeFileSync(ownerPath(leaseDir), `${JSON.stringify(owner, null, 2)}\n`, { flag: "wx" });
  return {
    token,
    release: () => {
      const current = readWebBuildLeaseOwner(leaseDir);
      if (current?.token === token && !current.activeRun) rmSync(leaseDir, { recursive: true, force: true });
    },
  };
}

export function recoverWebBuildLease(leaseDir = LEASE_DIR, confirmedIdle = false): void {
  if (!confirmedIdle) throw new Error("Recovery requires explicit confirmation that no web export, proof, or child build is running.");
  const reaperDir = `${leaseDir}.reaping`;
  if (existsSync(reaperDir)) {
    const age = Date.now() - statSync(reaperDir).mtimeMs;
    const reaperOwner = readWebBuildLeaseOwner(reaperDir);
    if (age < STALE_REAPER_MIN_AGE_MS || (reaperOwner && pidAlive(reaperOwner.pid))) {
      throw new Error(`Web build lease recovery is active or recent: ${reaperDir}`);
    }
    const abandoned = `${reaperDir}.abandoned-${randomUUID()}`;
    renameSync(reaperDir, abandoned);
    rmSync(abandoned, { recursive: true, force: true });
  }
  mkdirSync(reaperDir);
  try {
    writeFileSync(ownerPath(reaperDir), JSON.stringify({
      pid: process.pid, token: randomUUID(), purpose: "explicit lease recovery", startedAt: new Date().toISOString(),
    }));
    if (!existsSync(leaseDir)) return;
    const owner = readWebBuildLeaseOwner(leaseDir);
    if (owner && (pidAlive(owner.pid) || activeRunAlive(owner))) {
      throw new Error(`Cannot recover live web build lease: ${describeOwner(owner)}`);
    }
    const retired = `${leaseDir}.retired-${randomUUID()}`;
    renameSync(leaseDir, retired);
    rmSync(retired, { recursive: true, force: true });
  } finally {
    rmSync(reaperDir, { recursive: true, force: true });
  }
}

export async function withWebBuildLease<T>(
  purpose: string,
  action: (token: string) => Promise<T>,
  inheritedToken = process.env[WEB_BUILD_LEASE_TOKEN],
  options: { platform?: typeof process.platform; leaseDir?: string } = {},
): Promise<T> {
  assertWebBuildPlatform(purpose, options.platform);
  const lease = acquireWebBuildLease(purpose, options.leaseDir ?? LEASE_DIR, inheritedToken);
  try {
    return await action(lease.token);
  } finally {
    lease.release();
  }
}

function assertWebBuildPlatform(purpose: string, platform = process.platform): void {
  if (platform === "win32" || process.platform === "win32") {
    throw new Error(`${purpose} is unsupported by native Windows Node. Open the CPLayout workspace in WSL ` +
      "(for example, cd /mnt/h/cplayout) and rerun the npm command there. Native Windows child-tree completion is unverified; no lease or build was started.");
  }
}

export async function runWebBuildCommand(command: string, args: string[], token: string, cwd = REPO_ROOT): Promise<void> {
  assertWebBuildPlatform(`${command} ${args.join(" ")}`);
  await new Promise<void>((resolveRun, rejectRun) => {
    const ownsLease = readWebBuildLeaseOwner(LEASE_DIR)?.pid === process.pid;
    if (ownsLease) updateActiveRun(token, { pid: process.pid, processGroup: null, command: "launching child" });
    const child = spawn(command, args, {
      cwd,
      detached: process.platform !== "win32" && ownsLease,
      env: { ...process.env, [WEB_BUILD_LEASE_TOKEN]: token },
      stdio: "inherit",
    });
    if (child.pid && ownsLease) updateActiveRun(token, {
      pid: child.pid,
      processGroup: process.platform === "win32" ? null : child.pid,
      command: `${command} ${args.join(" ")}`,
    });
    const stopOwnedRun = (signal: NodeJS.Signals) => {
      if (process.platform === "win32" && child.pid) {
        const stopped = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        if (stopped.status === 0) return;
      }
      if (process.platform !== "win32" && ownsLease && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The wrapper may already be gone; ask the child directly as a fallback.
        }
      }
      child.kill(signal);
    };
    const onSigint = () => stopOwnedRun("SIGINT");
    const onSigterm = () => stopOwnedRun("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    child.once("error", (error) => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (ownsLease && !child.pid) updateActiveRun(token, undefined);
      rejectRun(error);
    });
    child.once("close", (code, signal) => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (ownsLease) {
        const owner = readWebBuildLeaseOwner(LEASE_DIR);
        if (!owner || owner.token !== token || owner.pid !== process.pid || !completedRunIsProven(owner)) {
          rejectRun(new Error(`${command} child tree completion cannot be proved after wrapper exit; lease retained for explicit recovery.`));
          return;
        }
        updateActiveRun(token, undefined);
      }
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(" ")} failed (${signal ?? code})`));
    });
  });
}

export async function checkProofPort(port: number): Promise<"free" | "cplayout-static"> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`Invalid web proof port: ${port}`);
  const free = await new Promise<boolean>((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolvePort(false);
      else rejectPort(error);
    });
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
  });
  if (free) return "free";
  const healthy = await new Promise<boolean>((resolveHealth) => {
    const request = httpRequest({
      host: "127.0.0.1", port, path: "/__cplayout_static_health", timeout: 1500,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          const status = JSON.parse(body) as { ok?: unknown; app?: unknown; server?: unknown; root?: unknown; port?: unknown };
          resolveHealth(response.statusCode === 200 &&
            response.headers["x-cplayout-static-server"] === "serveStaticWeb" &&
            status.ok === true && status.app === "cplayout" && status.server === "serveStaticWeb" &&
            status.root === join(REPO_ROOT, "apps/mobile/dist") && status.port === port);
        } catch {
          resolveHealth(false);
        }
      });
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolveHealth(false));
    request.end();
  });
  if (!healthy) throw new Error(`Web proof port ${port} is occupied by an unknown or unhealthy listener; choose a free CPLAYOUT_WEB_PROOF_PORT.`);
  return "cplayout-static";
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "export") {
    await withWebBuildLease("export:web", (token) => runWebBuildCommand("npm", ["run", "export:web", "-w", "@cplayout/mobile"], token));
  } else if (mode === "workspace-export") {
    await withWebBuildLease("workspace export:web", async (token) => {
      const mobile = join(REPO_ROOT, "apps/mobile");
      await runWebBuildCommand("npx", ["tsx", "../../tools/prepareMapLibreAssets.ts"], token, mobile);
      await runWebBuildCommand("npx", ["expo", "export", "--platform", "web", "--clear", "--max-workers", "2"], token, mobile);
    });
  } else if (mode === "proof") {
    await withWebBuildLease("proof:web", async (token) => {
      const port = Number(process.env.CPLAYOUT_WEB_PROOF_PORT ?? 19006);
      const portState = await checkProofPort(port);
      console.log(`Web proof port ${port}: ${portState}`);
      await runWebBuildCommand("npm", ["run", "export:web"], token);
      await checkProofPort(port);
      await runWebBuildCommand("npm", ["run", "test:web:e2e", "--", ...process.argv.slice(3)], token);
    }, "");
  } else if (mode === "recover") {
    if (process.argv[3] !== "--confirm-idle") throw new Error("Run recover --confirm-idle only after auditing active web build processes.");
    recoverWebBuildLease(LEASE_DIR, true);
  } else {
    throw new Error(`Unknown web build lease command: ${mode ?? "(none)"}`);
  }
}

if (basename(process.argv[1] ?? "") === "webBuildLease.ts") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
