import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Pool } from "pg";
import { bytesToHex } from "@cplayout/auth-client";
import { createApi, type ApiServerOptions } from "../apps/api/src/server";
import { PostgresDatabase } from "../apps/api/src/database";
import { serviceConfig } from "../apps/api/src/config";
import { createReceiverCompanion } from "./receiverCompanion";

const mimeTypes: Readonly<Record<string, string>> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8", ".wasm": "application/wasm", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".pmtiles": "application/octet-stream" };
function within(root: string, candidate: string): boolean { const path = relative(root, candidate); return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`); }
export async function resolveProductionAsset(root: string, rawPath: string): Promise<string | null> {
  let pathname: string; try { pathname = decodeURIComponent(rawPath.split("?")[0]); } catch { return null; }
  if (!pathname.startsWith("/") || pathname.includes("\0") || pathname.includes("\\") || pathname.split("/").some(part => part === ".." || part.startsWith("."))
    || pathname.startsWith("/api/") || pathname.startsWith("/__cplayout_receiver/")) return null;
  const base = await realpath(root), candidate = resolve(base, `.${pathname}`);
  if (!within(base, candidate)) return null;
  try { const actual = await realpath(candidate); if (!within(base, actual)) return null; const information = await stat(actual); if (information.isFile()) return actual; } catch { /* A clean application route can use index.html. */ }
  if (extname(pathname) || pathname.startsWith("/_expo/") || pathname.startsWith("/assets/")) return null;
  const index = await realpath(resolve(base, "index.html")); return within(base, index) && (await stat(index)).isFile() ? index : null;
}
export function injectProductionPublicConfig(html: string, publicKey: string): string {
  if (!/^[a-f0-9]{64}$/i.test(publicKey)) throw new Error("Use the actual service's Ed25519 public key.");
  const value = JSON.stringify({ apiUrl: "", offlinePublicKey: publicKey }).replaceAll("<", "\\u003c");
  const script = `<script>window.__CPLAYOUT_PUBLIC_CONFIG__=${value};</script>`;
  if (!/<head(?:\s[^>]*)?>/i.test(html)) throw new Error("The app export needs an HTML head before loading its trusted public configuration.");
  return html.replace(/<head(?:\s[^>]*)?>/i, head => `${head}${script}`);
}
export interface ProductionGatewayOptions extends ApiServerOptions { appDist: string; receiverCompanion?: boolean }
/** Construction opens no HTTP listener, database bootstrap or receiver connection. */
export async function createProductionGateway(options: ProductionGatewayOptions) {
  const root = await realpath(options.appDist), index = resolve(root, "index.html");
  if (!(await stat(index)).isFile()) throw new Error("Export the app before starting its service gateway.");
  const publicKey = bytesToHex(ed25519.getPublicKey(options.signingKey)), app = await createApi(options);
  if (options.receiverCompanion) {
    const origin = new URL(options.origin);
    if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) throw new Error("The optional receiver companion is limited to the explicit owned loopback HTTP origin.");
    const receiver = createReceiverCompanion({ allowedOrigin: origin.origin });
    app.addHook("onClose", async () => { await receiver.close(); });
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith("/__cplayout_receiver/v1/")) return;
      const session = await app.inject({ method: "GET", url: "/api/v1/session", headers: { ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}), ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}) } });
      const access = session.statusCode === 200 ? session.json() as { principal: { roles: string[] }; workspaces: { permissions: string[] }[] } : null;
      if (!access || !access.principal.roles.some(role => role === "operator" || role === "admin") || !access.workspaces.some(workspace => workspace.permissions.includes("field:write"))) return reply.code(403).send({ error: "Sign in with field access before connecting a receiver." });
      reply.hijack(); receiver.handle(request.raw, reply.raw);
    });
    app.all("/__cplayout_receiver/v1/*", async (_request, reply) => { if (!reply.sent) return reply.code(404).send({ error: "Receiver action was not admitted." }); });
  }
  app.get("/*", async (request, reply) => {
    const path = await resolveProductionAsset(root, request.url);
    if (!path) return reply.code(404).type("text/plain; charset=utf-8").send("Not found");
    reply.header("Cross-Origin-Embedder-Policy", "credentialless").header("Cross-Origin-Opener-Policy", "same-origin")
      .header("Referrer-Policy", "same-origin").header("X-Frame-Options", "DENY").header("Cache-Control", "no-store");
    const extension = extname(path).toLowerCase(); reply.type(mimeTypes[extension] ?? "application/octet-stream");
    if (extension === ".html") return injectProductionPublicConfig(await readFile(path, "utf8"), publicKey);
    return reply.send(createReadStream(path));
  });
  return app;
}
export async function startProductionGateway(): Promise<void> {
  const config = serviceConfig(), pool = new Pool({ connectionString: config.connectionString, max: 10 });
  let app: Awaited<ReturnType<typeof createProductionGateway>> | null = null;
  try {
    const version = await pool.query("SHOW server_version_num"), number = Number(version.rows[0]?.server_version_num);
    if (number < 180006 || number >= 190000) throw new Error("Qualify PostgreSQL 18.6 in the stable 18.x series before starting the gateway.");
    const appDist = process.env.CPLAYOUT_APP_DIST ?? resolve("apps/mobile/dist");
    app = await createProductionGateway({ ...config, database: new PostgresDatabase(pool), appDist, receiverCompanion: process.env.CPLAYOUT_ENABLE_RECEIVER_COMPANION === "1" });
    await app.listen({ host: config.host, port: config.port });
    process.stdout.write("CPLayout app and service gateway is listening.\n");
    let stopping = false; const stop = async () => { if (stopping) return; stopping = true; await app!.close(); await pool.end(); };
    process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
  } catch { await app?.close(); await pool.end(); throw new Error("The app gateway could not start. Check the export, database, migrations and protected service configuration."); }
}
if (basename(process.argv[1] ?? "") === "serveProductionApp.ts") {
  void startProductionGateway().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "The app gateway could not start."}\n`); process.exitCode = 1; });
}
