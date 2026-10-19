import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { test, type TestContext } from "node:test";
import { PMTiles, Protocol } from "pmtiles";

// Synthetic v3 MVT archive: one z0 tile outside the initial 16 KiB prefetch.
// No third-party map data, imagery, files or network provider is involved.
function archive() {
  const bytes = Buffer.alloc(16387); bytes.write("PMTiles"); bytes[7] = 3;
  for (const [offset, value] of [[8, 127], [16, 5], [24, 132], [32, 2], [56, 16384], [64, 3], [72, 1], [80, 1], [88, 1]]) bytes.writeBigUInt64LE(BigInt(value!), offset!);
  bytes[96] = 1; bytes[97] = 1; bytes[98] = 1; bytes[99] = 1; bytes[101] = 1;
  for (const [offset, value] of [[102, -1800000000], [106, -850000000], [110, 1800000000], [114, 850000000]]) bytes.writeInt32LE(value!, offset!);
  bytes.set([1, 0, 1, 3, 1], 127); bytes.write("{}", 132); bytes.set([1, 2, 3], 16384);
  return bytes;
}

// The root points at a leaf directory beyond the header prefetch. Cancelling
// these requests exercises directory IO, separately from direct tile IO above.
function leafArchive() {
  const bytes = Buffer.alloc(32771); bytes.set(archive());
  bytes.writeBigUInt64LE(16384n, 40); bytes.writeBigUInt64LE(5n, 48);
  bytes.writeBigUInt64LE(32768n, 56);
  bytes.set([1, 0, 0, 5, 1], 127);
  bytes.set([1, 0, 1, 3, 1], 16384);
  bytes.set([1, 2, 3], 32768);
  return bytes;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

async function leafServer(t: TestContext) {
  const bytes = leafArchive(), ranges: string[] = [], held: Array<{ response: ServerResponse; send: () => void }> = [];
  const started = deferred<void>(), closed = deferred<void>();
  let hold = true;
  const server = createServer((request, response) => {
    const range = request.headers.range; ranges.push(range ?? "missing");
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (!match) { response.writeHead(400).end(); return; }
    const first = Number(match[1]), last = Math.min(Number(match[2]), bytes.length - 1);
    const send = () => response.writeHead(206, { "Content-Range": `bytes ${first}-${last}/${bytes.length}`, "Content-Length": last - first + 1, ETag: '"synthetic-leaf-v1"' }).end(bytes.subarray(first, last + 1));
    if (hold && first === 16384) {
      held.push({ response, send });
      response.once("close", () => { if (!response.writableEnded) closed.resolve(); });
      started.resolve();
    } else send();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/synthetic-leaf.pmtiles`;
  const protocol = new Protocol(), source = new PMTiles(url); protocol.add(source);
  // Header sharing has its own lifetime. Warm it so these tests isolate leaf IO.
  await source.getHeader();
  return {
    protocol, source, url, ranges, held, started: started.promise, closed: closed.promise,
    release() { hold = false; for (const item of held) if (!item.response.destroyed) item.send(); },
    invoke(controller: AbortController) { return protocol.tile({ url: `pmtiles://${url}/0/0/0`, type: "arrayBuffer" }, controller); },
  };
}

test("PMTiles protocol uses byte ranges, preserves registration across consumers and cancels tile requests", async t => {
  const bytes = archive(), ranges: string[] = [];
  let delay = false, started: (() => void) | undefined, cancelled = false;
  const server = createServer((request, response) => {
    const range = request.headers.range; ranges.push(range ?? "missing");
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (!match) { response.writeHead(400).end(); return; }
    const first = Number(match[1]), last = Math.min(Number(match[2]), bytes.length - 1);
    const send = () => response.writeHead(206, { "Content-Range": `bytes ${first}-${last}/${bytes.length}`, "Content-Length": last - first + 1, ETag: '"synthetic-v1"' }).end(bytes.subarray(first, last + 1));
    if (delay && first >= 16384) {
      const timer = setTimeout(send, 5000); response.on("close", () => { clearTimeout(timer); cancelled = !response.writableEnded; }); started?.();
    } else send();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address(); assert(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/synthetic.pmtiles`;
  const protocol = new Protocol(), source = new PMTiles(url); protocol.add(source);
  assert.equal(protocol.get(url), source);
  const invoke = (suffix: string, controller = new AbortController()) => protocol.tile({ url: `pmtiles://${url}${suffix}`, type: "arrayBuffer" }, controller);
  const first = await invoke("/0/0/0"); assert.deepEqual(Array.from(first.data as Uint8Array), [1, 2, 3]);
  const secondConsumer = await invoke("/0/0/0"); assert.deepEqual(first.data, secondConsumer.data);
  const missing = await invoke("/1/1/1"); assert.equal((missing.data as Uint8Array).length, 0);
  assert(ranges.includes("bytes=0-16383")); assert(ranges.includes("bytes=16384-16386"));
  delay = true; const controller = new AbortController();
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  const pending = invoke("/0/0/0", controller); const refused = assert.rejects(pending, error => (error as Error).name === "AbortError");
  await requestStarted; controller.abort(); await refused;
  for (let i = 0; i < 20 && !cancelled; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert(cancelled, "a disposed tile consumer must abort its owned network request");
  assert.equal(protocol.get(url), source, "map recreation must not lose application-owned source identity");
  await assert.rejects(protocol.tile({ url: "not-pmtiles", type: "arrayBuffer" }, new AbortController()), /Invalid PMTiles/);
});

test("one cancelled consumer cannot abort a directory still required by another consumer", { timeout: 5000 }, async t => {
  const fixture = await leafServer(t), first = new AbortController(), second = new AbortController();
  const cancelled = fixture.invoke(first), surviving = fixture.invoke(second);
  const refused = assert.rejects(cancelled, error => (error as Error).name === "AbortError");
  await fixture.started;
  assert.equal(fixture.held.length, 1, "concurrent consumers share one leaf-directory request");
  first.abort();
  // A surviving request must finish from the same held network response.
  fixture.release();
  const result = await surviving;
  await refused;
  assert.deepEqual(Array.from(result.data as Uint8Array), [1, 2, 3]);
  assert.equal(fixture.ranges.filter(range => range === "bytes=16384-16388").length, 1);
  assert.equal(fixture.ranges.filter(range => range === "bytes=32768-32770").length, 1);
  assert.equal(fixture.protocol.get(fixture.url), fixture.source);
});

test("all cancelled consumers abort directory IO and a recreated consumer retries successfully", { timeout: 5000 }, async t => {
  const fixture = await leafServer(t), first = new AbortController(), second = new AbortController();
  const cancelled = [fixture.invoke(first), fixture.invoke(second)];
  const outcomes = Promise.all(cancelled.map(pending => assert.rejects(pending, error => (error as Error).name === "AbortError")));
  await fixture.started;
  assert.equal(fixture.held.length, 1, "both consumers depend on one directory fetch");
  first.abort(); second.abort();
  const networkClosed = await Promise.race([
    fixture.closed.then(() => true),
    new Promise<false>(resolve => { const timer = setTimeout(() => resolve(false), 500); timer.unref(); }),
  ]);
  // Release only to settle unsupported older implementations before failing.
  fixture.release();
  await outcomes;
  assert(networkClosed, "all disposed consumers must abort their pending leaf-directory request (PMTiles 4.5 contract)");
  const recreated = await fixture.invoke(new AbortController());
  assert.deepEqual(Array.from(recreated.data as Uint8Array), [1, 2, 3]);
  assert.equal(fixture.ranges.filter(range => range === "bytes=16384-16388").length, 2, "aborted directory work must not poison the cache or survive recreation");
  assert.equal(fixture.protocol.get(fixture.url), fixture.source, "recreation retains the registered public source identity");
});

test("application PMTiles registration is shared once across map, preview and recreation consumers", () => {
  const require = createRequire(import.meta.url);
  const modulePath = require.resolve("../packages/map-adapters/src/pmtilesProtocol.web.ts");
  const cached = require.cache[modulePath];
  const loader = require("node:module") as { _load: (name: string, parent: unknown, isMain: boolean) => unknown };
  const originalLoad = loader._load;
  const instances: Protocol[] = [], registrations: Array<{ name: string; handler: Protocol["tile"] }> = [];
  class RegisteredProtocol extends Protocol { constructor() { super(); instances.push(this); } }
  loader._load = function(name, parent, isMain) {
    if (name === "maplibre-gl") return { addProtocol: (scheme: string, handler: Protocol["tile"]) => registrations.push({ name: scheme, handler }) };
    if (name === "pmtiles") return { Protocol: RegisteredProtocol };
    return originalLoad(name, parent, isMain);
  };
  delete require.cache[modulePath];
  try {
    const first = require(modulePath) as { registerPmtilesProtocolOnce: () => void };
    first.registerPmtilesProtocolOnce();
    const nextConsumer = require(modulePath) as typeof first;
    nextConsumer.registerPmtilesProtocolOnce();
    first.registerPmtilesProtocolOnce();
    assert.equal(registrations.length, 1);
    assert.equal(instances.length, 1);
    assert.equal(registrations[0].name, "pmtiles");
    assert.equal(registrations[0].handler, instances[0].tile);
  } finally {
    loader._load = originalLoad;
    if (cached) require.cache[modulePath] = cached; else delete require.cache[modulePath];
  }
});
