import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer as createHttpServer } from "node:http";
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
  async function request(action: string, body: object = {}, token?: string, extraHeaders: Record<string, string> = {}) {
    const response = await fetch(`${origin}/__cplayout_receiver/v1/${action}`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-cplayout-receiver': protocol, ...(token ? { 'x-cplayout-receiver-token': token } : {}), ...extraHeaders }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, any> };
  }
  return { companion, request, async close() { await companion.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
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
