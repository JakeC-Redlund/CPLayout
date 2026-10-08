import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer as createHttpServer, request as requestHttp } from "node:http";
import { createServer as createTcpServer, type Socket } from "node:net";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { createReceiverCompanion, type ReceiverCompanion } from "./receiverCompanion";
const protocol = "cplayout-receiver-v1";
const line = "$GNGGA,120000,4000.0000,N,10500.0000,W,4,12,0.8,1600,M,-20,M,0.5,0001*49\r\n";
async function harness() {
  let companion: ReceiverCompanion;
  const server = createHttpServer((request, response) => { if (!companion.handle(request, response)) { response.writeHead(404); response.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  companion = createReceiverCompanion({ allowedOrigin: origin });
  async function request(action: string, body: object | string = {}, token?: string, extraHeaders: Record<string, string> = {}) {
    // node:http preserves an explicitly supplied Host header; fetch may replace it with the URL host.
    return new Promise<{ status: number; body: Record<string, any> }>((resolve, reject) => {
      const outgoing = requestHttp(`${origin}/__cplayout_receiver/v1/${action}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-cplayout-receiver': protocol, ...(token ? { 'x-cplayout-receiver-token': token } : {}), ...extraHeaders } }, response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => {
          try { resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
          catch (error) { reject(error); }
        });
      });
      outgoing.on('error', reject);
      outgoing.end(typeof body === 'string' ? body : JSON.stringify(body));
    });
  }
  return { companion, request, origin, async close() { await companion.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
async function delay(ms = 20) { await new Promise(resolve => setTimeout(resolve, ms)); }

test("companion refuses wrong origin/protocol/token without opening hardware", async () => {
  const h = await harness();
  try {
    assert.equal(h.companion.status().connected, false);
    assert.equal((await h.request('hello', {}, undefined, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await h.request('hello', {}, undefined, { 'x-cplayout-receiver': 'old' })).status, 403);
    assert.equal((await h.request('connect', {}, 'bad')).status, 403);
    const hello = await h.request('hello'); assert.equal(hello.status, 200);
    assert.equal((await h.request('connect', { config: { method: 'network', protocol: 'tcp', address: 'example.com', port: 1234 } }, hello.body.token)).status, 400);
    assert.equal(h.companion.status().connected, false);
  } finally { await h.close(); }
});
test("exact Host and UTF-8 body limits reject connect before opening a receiver socket", async () => {
  const peers: Socket[] = [];
  const tcp = createTcpServer(socket => { peers.push(socket); });
  tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening');
  const address = tcp.address(); assert.ok(address && typeof address === 'object');
  const h = await harness();
  try {
    const token = (await h.request('hello')).body.token;
    const body = { config: { method: 'network', protocol: 'tcp', address: '127.0.0.1', port: address.port }, padding: '' };
    const { port } = new URL(h.origin);
    for (const host of [`localhost:${port}`, '127.0.0.1', `127.0.0.1:${address.port}`]) {
      const result = await h.request('connect', body, token, { host });
      assert.equal(result.status, 403, `Host ${host} must match the companion origin exactly`);
      assert.equal(peers.length, 0);
      assert.deepEqual(h.companion.status(), { protocol, connected: false, sessionId: null });
    }
    const remainingBytes = 4096 - Buffer.byteLength(JSON.stringify(body), 'utf8');
    const atLimit = JSON.stringify({ ...body, padding: 'a'.repeat(remainingBytes) });
    const overLimit = JSON.stringify({ ...body, padding: 'a'.repeat(remainingBytes - 1) + 'é' });
    assert.equal(Buffer.byteLength(atLimit, 'utf8'), 4096);
    assert.equal(overLimit.length, 4096);
    assert.equal(Buffer.byteLength(overLimit, 'utf8'), 4097);
    const rejected = await h.request('connect', overLimit, token);
    assert.equal(rejected.status, 400);
    assert.match(rejected.body.error, /too large/i);
    assert.equal(peers.length, 0);
    assert.deepEqual(h.companion.status(), { protocol, connected: false, sessionId: null });
    const opened = await h.request('connect', atLimit, token);
    assert.equal(opened.status, 200);
    assert.equal(peers.length, 1);
    assert.equal((await h.request('disconnect', { sessionId: opened.body.sessionId }, token)).status, 200);
  } finally { peers.forEach(peer => peer.destroy()); await h.close(); await new Promise<void>(resolve => tcp.close(() => resolve())); }
});

test("an abandoned owner lease closes TCP and allows another tab to reuse the companion", { timeout: 18000 }, async () => {
  const peers: Socket[] = [];
  const tcp = createTcpServer(socket => { peers.push(socket); });
  tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening');
  const address = tcp.address(); assert.ok(address && typeof address === 'object');
  const h = await harness();
  try {
    const owner = (await h.request('hello')).body.token;
    const config = { method: 'network', protocol: 'tcp', address: '127.0.0.1', port: address.port };
    const initialAcceptance = once(tcp, 'connection', { signal: AbortSignal.timeout(2000) });
    const [opened, [initialPeer]] = await Promise.all([h.request('connect', { config }, owner), initialAcceptance]);
    assert.equal(opened.status, 200);
    assert.equal(peers.length, 1);
    assert.strictEqual(peers[0], initialPeer);
    const successor = (await h.request('hello')).body.token;
    assert.equal((await h.request('connect', { config }, successor)).status, 409);
    // No owner polls or disconnects: observe the real lease expiring and the transport closing.
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        once(peers[0], 'close'),
        new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Abandoned TCP receiver remained open beyond its lease')), 13000); }),
      ]);
    } finally { clearTimeout(deadline); }
    assert.deepEqual(h.companion.status(), { protocol, connected: false, sessionId: null });
    assert.equal((await h.request('poll', { sessionId: opened.body.sessionId }, owner)).status, 409);
    const successorAcceptance = once(tcp, 'connection', { signal: AbortSignal.timeout(2000) });
    const [reused, [successorPeer]] = await Promise.all([h.request('connect', { config }, successor), successorAcceptance]);
    assert.equal(reused.status, 200);
    assert.notEqual(reused.body.sessionId, opened.body.sessionId);
    assert.equal(peers.length, 2);
    assert.strictEqual(peers[1], successorPeer);
    assert.equal((await h.request('disconnect', { sessionId: opened.body.sessionId }, owner)).status, 200);
    assert.equal(h.companion.status().sessionId, reused.body.sessionId);
    peers[1].write(line); await delay();
    const polled = await h.request('poll', { sessionId: reused.body.sessionId }, successor);
    assert.equal(polled.status, 200);
    assert.deepEqual(polled.body.lines.map((entry: any) => entry.sentence), [line.trim()]);
    const closed = once(peers[1], 'close');
    assert.equal((await h.request('disconnect', { sessionId: reused.body.sessionId }, successor)).status, 200);
    await closed;
    assert.equal(h.companion.status().connected, false);
  } finally { peers.forEach(peer => peer.destroy()); await h.close(); await new Promise<void>(resolve => tcp.close(() => resolve())); }
});

test("TCP explicit connect, session ownership, bounded NMEA buffering, ingress age and cleanup", async () => {
  let peer: Socket | undefined;
  const tcp = createTcpServer(socket => { peer = socket; }); tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening');
  const address = tcp.address(); assert.ok(address && typeof address === 'object');
  const h = await harness();
  try {
    assert.equal(peer, undefined);
    const token = (await h.request('hello')).body.token;
    const opened = await h.request('connect', { config: { method: 'network', protocol: 'tcp', address: '127.0.0.1', port: address.port } }, token);
    assert.equal(opened.status, 200); const sessionId = opened.body.sessionId;
    assert.equal(h.companion.status().connected, true);
    assert.equal((await h.request('poll', { sessionId: 'wrong' }, token)).status, 409);
    const other = (await h.request('hello')).body.token;
    assert.equal((await h.request('disconnect', { sessionId }, other)).status, 409);
    peer!.write(line.repeat(300)); await delay(50);
    const data = await h.request('poll', { sessionId }, token);
    assert.ok(data.body.lines.length <= 128); assert.ok(data.body.lines.some((entry: any) => entry.sentence === null));
    assert.ok(data.body.lines.every((entry: any, index: number, lines: any[]) => entry.ingressAgeMs >= 20 && (!index || entry.sequence > lines[index - 1].sequence)));
    const closed = once(peer!, 'close');
    assert.equal((await h.request('disconnect', { sessionId }, token)).status, 200); await closed;
    assert.equal(h.companion.status().connected, false);
  } finally { peer?.destroy(); await h.close(); await new Promise<void>(resolve => tcp.close(() => resolve())); }
});
test("UDP receive filters source and companion shutdown releases the selected port", async () => {
  const reserve = createSocket('udp4'); reserve.bind(0, '127.0.0.1'); await once(reserve, 'listening'); const port = reserve.address().port; reserve.close(); await once(reserve, 'close');
  const sender = createSocket('udp4'); sender.bind(0, '127.0.0.1'); await once(sender, 'listening');
  const h = await harness();
  try {
    let token = (await h.request('hello')).body.token;
    let opened = await h.request('connect', { config: { method: 'network', protocol: 'udp', address: '127.0.0.1', port, sourceAddress: '127.0.0.2' } }, token);
    assert.equal(opened.status, 200);
    sender.send(line, port, '127.0.0.1'); await delay(); assert.deepEqual((await h.request('poll', { sessionId: opened.body.sessionId }, token)).body.lines, []);
    await h.request('disconnect', { sessionId: opened.body.sessionId }, token);
    token = (await h.request('hello')).body.token;
    opened = await h.request('connect', { config: { method: 'network', protocol: 'udp', address: '127.0.0.1', port, sourceAddress: '127.0.0.1' } }, token);
    sender.send(line, port, '127.0.0.1'); await delay(); assert.equal((await h.request('poll', { sessionId: opened.body.sessionId }, token)).body.lines.length, 1);
    await h.companion.close();
    const reclaimed = createSocket('udp4'); reclaimed.bind(port, '127.0.0.1'); await once(reclaimed, 'listening'); reclaimed.close(); await once(reclaimed, 'close');
  } finally { sender.close(); await h.close(); }
});
test("partial NMEA receipt age starts at the first byte and non-NMEA data is invalidation only", async () => {
  let peer: Socket | undefined;
  const tcp = createTcpServer(socket => { peer = socket; }); tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening');
  const address = tcp.address(); assert.ok(address && typeof address === 'object'); const h = await harness();
  try {
    const token = (await h.request('hello')).body.token;
    const { body } = await h.request('connect', { config: { method: 'network', protocol: 'tcp', address: '127.0.0.1', port: address.port } }, token);
    peer!.write(line.slice(0, 10)); await delay(40); peer!.write(line.slice(10)); await delay(20);
    const result = await h.request('poll', { sessionId: body.sessionId }, token); assert.ok(result.body.lines[0].ingressAgeMs >= 40);
    peer!.write(Buffer.from([0, 1, 2, 3])); await delay(); const invalid = await h.request('poll', { sessionId: body.sessionId }, token); assert.ok(invalid.body.lines.every((entry: any) => entry.sentence === null));
  } finally { peer?.destroy(); await h.close(); await new Promise<void>(resolve => tcp.close(() => resolve())); }
});

test("binary data latches collection closed even when it contains valid NMEA payload text", async () => {
  let peer: Socket | undefined;
  const tcp = createTcpServer(socket => { peer = socket; }); tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening');
  const address = tcp.address(); assert.ok(address && typeof address === 'object'); const h = await harness();
  try {
    const token = (await h.request('hello')).body.token;
    const { body } = await h.request('connect', { config: { method: 'network', protocol: 'tcp', address: '127.0.0.1', port: address.port } }, token);
    peer!.write(Buffer.concat([Buffer.from([0xa0]), Buffer.from(line)])); await delay();
    const result = await h.request('poll', { sessionId: body.sessionId }, token);
    assert.equal(result.body.ended, true); assert.match(result.body.error, /Binary/); assert.deepEqual(result.body.lines, []);
    assert.equal((await h.request('disconnect', { sessionId: body.sessionId }, token)).status, 200);
    assert.equal((await h.request('disconnect', { sessionId: body.sessionId }, token)).status, 200);
  } finally { peer?.destroy(); await h.close(); await new Promise<void>(resolve => tcp.close(() => resolve())); }
});
test("UDP fragments and complete lines from another sender cannot replace the owned endpoint", async () => {
  const reserve = createSocket('udp4'); reserve.bind(0, '127.0.0.1'); await once(reserve, 'listening'); const port = reserve.address().port; reserve.close(); await once(reserve, 'close');
  const first = createSocket('udp4'), second = createSocket('udp4'); first.bind(0, '127.0.0.1'); second.bind(0, '127.0.0.1'); await Promise.all([once(first, 'listening'), once(second, 'listening')]);
  const h = await harness();
  try {
    const token = (await h.request('hello')).body.token;
    const { body } = await h.request('connect', { config: { method: 'network', protocol: 'udp', address: '127.0.0.1', port } }, token);
    first.send(line.slice(0, 15), port, '127.0.0.1'); await delay(); second.send(line.slice(15) + line, port, '127.0.0.1'); await delay();
    assert.deepEqual((await h.request('poll', { sessionId: body.sessionId }, token)).body.lines, []);
    first.send(line.slice(15), port, '127.0.0.1'); await delay(); assert.equal((await h.request('poll', { sessionId: body.sessionId }, token)).body.lines.length, 1);
    assert.equal((await h.request('cancel', {}, token)).status, 200); assert.equal(h.companion.status().connected, false);
  } finally { first.close(); second.close(); await h.close(); }
});
