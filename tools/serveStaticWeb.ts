import { createReadStream, existsSync, statSync } from "node:fs";
import type { ReadStream } from "node:fs";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const [rootArg = "apps/mobile/dist", portArg = "19006"] = process.argv.slice(2);
const root = resolve(rootArg);
const port = Number(portArg);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid static server port: ${portArg}`);
}

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

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (url.pathname === healthPath) {
    response.writeHead(200, {
      ...baseHeaders,
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ app: "cplayout", server: "serveStaticWeb", root, port, ok: true }));
    return;
  }

  const pathname = decodeURIComponent(url.pathname);
  const requested = normalize(join(root, pathname));
  const filePath = resolve(requested).startsWith(root)
    ? resolve(requested)
    : join(root, "index.html");
  const candidate = fileForPath(filePath);

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

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}`);
});

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

function fileForPath(filePath: string): string | null {
  if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  const index = join(root, "index.html");
  return existsSync(index) ? index : null;
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
