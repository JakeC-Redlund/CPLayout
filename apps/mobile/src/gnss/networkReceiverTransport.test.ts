import assert from "node:assert/strict";
import { test } from "node:test";
import { NetworkReceiverTransport } from "./networkReceiverTransport";
const protocol = "cplayout-receiver-v1";
const config = { method: "network", protocol: "tcp", address: "127.0.0.1", port: 5000 } as const;
function response(value: object, status = 200) { return new Response(JSON.stringify({ protocol, ...value }), { status, headers: { "content-type": "application/json" } }); }
test("default browser fetch retains its global receiver across connect poll and disconnect", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async function(this: typeof globalThis, url, init) {
    assert.equal(this, globalThis, "native browser fetch rejects a transport object as its receiver");
    assert.equal(init?.method, "POST");
    const action = String(url).split("/").pop()!;
    calls.push(action);
    if (action === "hello") return response({ token: "token" });
    if (action === "connect") return response({ sessionId: "session" });
    if (action === "disconnect") return response({ closed: true });
    return response({ sessionId: "session", lines: [{ sequence: 1, sentence: "$GNGGA,x*00", ingressAgeMs: 0 }] });
  };
  try {
    const session = await new NetworkReceiverTransport(config, "http://127.0.0.1:19006").open();
    const events = session.events()[Symbol.asyncIterator]();
    assert.equal((await events.next()).value.type, "bytes");
    await session.close();
    await events.return?.();
    assert.deepEqual(calls, ["hello", "connect", "poll", "disconnect"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("network adapter connects only on open and accounts for server buffering plus browser request duration", async () => {
  const calls: string[] = [];
  const fake: typeof fetch = async (url, init) => {
    const action = String(url).split('/').pop()!; calls.push(action);
    assert.equal(init?.mode, "same-origin");
    if (action === "hello") return response({ token: "token" });
    if (action === "connect") { assert.deepEqual(JSON.parse(init?.body as string).config, config); return response({ sessionId: "session" }); }
    if (action === "disconnect") return response({ closed: true });
    await new Promise(resolve => setTimeout(resolve, 25));
    return response({ sessionId: "session", lines: [{ sequence: 11, sentence: "$GNGGA,x*00", ingressAgeMs: 1500 }], ended: false });
  };
  const transport = new NetworkReceiverTransport(config, "http://127.0.0.1:19006", fake);
  assert.deepEqual(calls, []);
  const session = await transport.open();
  const iterator = session.events()[Symbol.asyncIterator]();
  const result = await iterator.next(); assert.equal(result.value.type, "bytes");
  if (result.value.type === "bytes") { assert.ok(result.value.ingressAgeAtReceiptMs >= 1520); assert.equal(result.value.ingressSequence, 11); }
  await session.close(); await iterator.return?.();
  assert.deepEqual(calls, ["hello", "connect", "poll", "disconnect"]);
});
test("network adapter rejects nonloopback endpoints and wrong session replies", async () => {
  for (const origin of ["https://example.com", "http://192.168.1.1", "http://localhost:19006/path"]) assert.throws(() => new NetworkReceiverTransport(config, origin), /local desktop launcher/);
  const fake: typeof fetch = async (url) => {
    if (String(url).endsWith("hello")) return response({ token: "t" });
    if (String(url).endsWith("connect")) return response({ sessionId: "s" });
    if (String(url).endsWith("disconnect")) return response({ closed: true });
    return response({ sessionId: "wrong", lines: [] });
  };
  const session = await new NetworkReceiverTransport(config, "http://127.0.0.1:19006", fake).open();
  const event = await session.events()[Symbol.asyncIterator]().next(); assert.equal(event.value.type, "error"); await session.close();
});
test("network adapter closes gate on companion rejection, disconnect and malformed receipt", async () => {
  for (const poll of [response({ error: "expired" }, 409), response({ sessionId: "s", lines: [], ended: true }), response({ sessionId: "s", lines: [{ sequence: -1, sentence: "bad", ingressAgeMs: -1 }] })]) {
    const fake: typeof fetch = async url => String(url).endsWith("hello") ? response({ token: "t" }) : String(url).endsWith("connect") ? response({ sessionId: "s" }) : String(url).endsWith("disconnect") ? response({ closed: true }) : poll;
    const session = await new NetworkReceiverTransport(config, "http://127.0.0.1:19006", fake).open();
    const event = await session.events()[Symbol.asyncIterator]().next(); assert.notEqual(event.value.type, "bytes"); await session.close();
  }
});

test("lost connect reply cancels the owned endpoint; lost disconnect reply retries cleanly", async () => {
  const calls: string[] = []; let lostDisconnect = true;
  const connectLost: typeof fetch = async url => {
    const action = String(url).split('/').pop()!; calls.push(action);
    if (action === 'hello') return response({ token: 'token' });
    if (action === 'connect') throw new Error('Reply lost');
    return response({ closed: true });
  };
  await assert.rejects(new NetworkReceiverTransport(config, 'http://127.0.0.1:19006', connectLost).open(), /Reply lost/);
  assert.deepEqual(calls, ['hello', 'connect', 'cancel']);
  const disconnectLost: typeof fetch = async url => {
    const action = String(url).split('/').pop()!;
    if (action === 'hello') return response({ token: 'token' });
    if (action === 'connect') return response({ sessionId: 'session' });
    if (action === 'disconnect' && lostDisconnect) { lostDisconnect = false; throw new Error('Reply lost'); }
    return response({ closed: true });
  };
  const session = await new NetworkReceiverTransport(config, 'http://127.0.0.1:19006', disconnectLost).open();
  await assert.rejects(session.close(), /Reply lost/); await session.close();
});
test("failed cancellation preserves cleanup ownership and expired control receipt proves closure", async () => {
  let attempts = 0;
  const fake: typeof fetch = async url => {
    const action = String(url).split('/').pop()!;
    if (action === 'hello') return response({ token: 'token' });
    if (action === 'connect') throw new Error('Connect reply lost');
    if (++attempts === 1) throw new Error('Cancellation reply lost');
    return response({ error: 'Receiver control session expired.', code: 'control_expired' }, 403);
  };
  try {
    await new NetworkReceiverTransport(config, 'http://127.0.0.1:19006', fake).open(); assert.fail('expected retained cleanup ownership');
  } catch (error) {
    const pending = error as { cleanupSession: { close(): Promise<void> } };
    assert.ok(pending.cleanupSession); await pending.cleanupSession.close();
  }
});
