import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { ReadStream } from "node:fs";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { createReceiverCompanion } from "./receiverCompanion";

const [rootArg = "apps/mobile/dist", portArg = "19006"] = process.argv.slice(2);
const root = resolve(rootArg);
const port = Number(portArg);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

const healthPath = "/__cplayout_static_health";
const baseHeaders = {
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Opener-Policy": "same-origin",
  "x-cplayout-static-server": "serveStaticWeb",
};

export function assessStaticExport(exportRoot: string): { ok: boolean; missing: string[] } {
  const index = join(exportRoot, "index.html");
  if (!isRegularFile(index)) return { ok: false, missing: ["index.html"] };
  let html: string;
  try {
    html = readFileSync(index, "utf8");
  } catch {
    return { ok: false, missing: ["index.html"] };
  }
  const missing = new Set<string>();
  const pending = [...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => ({ reference: match[1], base: "/" }));
  const seenCss = new Set<string>();
  while (pending.length > 0) {
    const { reference, base } = pending.pop()!;
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(reference)) continue;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(reference, `http://127.0.0.1${base}`).pathname);
    } catch {
      missing.add(reference);
      continue;
    }
    const file = resolve(exportRoot, `.${pathname}`);
    const withinRoot = relative(exportRoot, file);
    if (isAbsolute(withinRoot) || withinRoot === ".." || withinRoot.startsWith(`..${sep}`) || !isRegularFile(file)) {
      missing.add(pathname);
      continue;
    }
    if (extname(file).toLowerCase() !== ".css" || seenCss.has(file)) continue;
    seenCss.add(file);
    try {
      const css = readFileSync(file, "utf8");
      for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)) {
        pending.push({ reference: (match[1] ?? match[2]).trim(), base: pathname });
      }
    } catch {
      missing.add(pathname);
    }
  }
  return { ok: missing.size === 0, missing: [...missing].sort() };
}

function isRegularFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function staticHealthResponse(exportRoot: string): { statusCode: number; body: { ok: boolean; missing: string[] } } {
  const body = assessStaticExport(exportRoot);
  return { statusCode: body.ok ? 200 : 503, body };
}

const receiver = createReceiverCompanion({ allowedOrigin: `http://127.0.0.1:${port}` });
const server = createServer((request, response) => {
  if (receiver.handle(request, response)) return;
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (url.pathname === healthPath) {
    const health = staticHealthResponse(root);
    response.writeHead(health.statusCode, {
      ...baseHeaders,
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ app: "cplayout", server: "serveStaticWeb", root, port, receiver: receiver.status(), ...health.body }));
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { ...baseHeaders, "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid URL path");
    return;
  }
  const requested = normalize(join(root, pathname));
  const withinRoot = relative(root, resolve(requested));
  const filePath = isAbsolute(withinRoot) || withinRoot === ".." || withinRoot.startsWith(`..${sep}`)
    ? join(root, "index.html") : resolve(requested);
  const candidate = fileForPath(filePath, pathname);

  if (!candidate) {
    response.writeHead(404, { ...baseHeaders, "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    ...baseHeaders,
    "cache-control": "no-store",
    "content-type": contentTypes[extname(candidate)] ?? "application/octet-stream",
  });
  const stream = createReadStream(candidate);
  pipeFileResponse(stream, response);
});

if (basename(process.argv[1] ?? "") === "serveStaticWeb.ts") {
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid static server port: ${portArg}`);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Serving ${root} at http://127.0.0.1:${port}`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void receiver.close().finally(() => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use.`);
      console.error(`Static root: ${root}`);
      console.error("Run `npm run ui:test:status` to inspect launcher-owned CPLayout servers.");
      console.error("Run `npm run ui:test:stop` to stop only launcher-owned CPLayout servers.");
      console.error("For deterministic Playwright proof, set CPLAYOUT_WEB_PROOF_PORT to a free port.");
    } else {
      console.error(`Static web server failed on port ${port}: ${error.message}`);
    }
    process.exit(1);
  });
}

function fileForPath(filePath: string, pathname: string): string | null {
  if (isRegularFile(filePath)) return filePath;
  if (extname(pathname) || pathname.startsWith("/_expo/") || pathname.startsWith("/assets/")) return null;
  const index = join(root, "index.html");
  return isRegularFile(index) ? index : null;
}

function pipeFileResponse(stream: ReadStream, response: ServerResponse): void {
  stream.on("error", () => {
    if (!response.headersSent) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    }
    response.end("Static asset read failed");
  });
  response.on("close", () => {
    stream.destroy();
  });
  stream.pipe(response);
}
