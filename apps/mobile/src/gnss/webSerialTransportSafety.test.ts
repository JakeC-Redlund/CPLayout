import assert from "node:assert/strict";
import { test } from "node:test";

import { WebSerialGnssTransport, type WebSerialPortLike } from "./webSerialTransport";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(options: { bytes?: number[]; write?: (chunk: Uint8Array) => Promise<void>; close?: () => Promise<void> } = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closeCalls = 0;
  const written: Uint8Array[] = [];
  const port: WebSerialPortLike = {
    open: async () => undefined,
    close: async () => {
      closeCalls += 1;
      assert.equal(port.readable?.locked, false, "port.close requires an unlocked readable stream");
      assert.equal(port.writable?.locked, false, "port.close requires an unlocked writable stream");
      await options.close?.();
    },
    readable: new ReadableStream<Uint8Array>({
      start(value) { controller = value; if (options.bytes) value.enqueue(new Uint8Array(options.bytes)); },
    }),
    writable: new WritableStream<Uint8Array>({
      async write(chunk) { written.push(chunk.slice()); await options.write?.(chunk); },
    }),
  };
  const transport = new WebSerialGnssTransport({ requestPort: async () => port });
  return { port, controller: () => controller, written, transport, closeCalls: () => closeCalls };
}

test("close releases the stream lock while the consumer is paused at a byte event", async () => {
  const f = fixture({ bytes: [1, 2, 3] });
  const session = await f.transport.open({ baudRate: 115200 });
  const iterator = session.events()[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.type, "bytes");
  try {
    await session.close();
    assert.equal(f.port.readable?.locked, false);
    assert.deepEqual((await iterator.next()).value, { type: "ended", reason: "closed" });
    await session.close();
    assert.equal(f.closeCalls(), 1);
  } finally {
    await iterator.return?.();
  }
});

test("close interrupts a pending read and emits exactly one terminal event", async () => {
  const f = fixture();
  const session = await f.transport.open({ baudRate: 9600 });
  const iterator = session.events()[Symbol.asyncIterator]();
  const next = iterator.next();
  await session.close();
  assert.deepEqual((await next).value, { type: "ended", reason: "closed" });
  assert.equal((await iterator.next()).done, true);
  assert.equal(f.port.readable?.locked, false);
});

test("bytes resolved concurrently with close cannot escape after closure", async () => {
  const f = fixture();
  const session = await f.transport.open({ baudRate: 9600 });
  const iterator = session.events()[Symbol.asyncIterator]();
  const next = iterator.next();
  f.controller().enqueue(new Uint8Array([7]));
  await session.close();
  try {
    assert.deepEqual((await next).value, { type: "ended", reason: "closed" });
  } finally { await iterator.return?.(); }
});

test("events after close do not acquire a stream or report a missing-stream error", async () => {
  let closed = 0;
  const session = await new WebSerialGnssTransport({ requestPort: async () => ({
    open: async () => undefined, close: async () => { closed += 1; }, readable: null,
  }) }).open({ baudRate: 9600 });
  await session.close();
  const events = [];
  for await (const event of session.events()) events.push(event);
  assert.deepEqual(events, [{ type: "ended", reason: "closed" }]);
  assert.equal(closed, 1);
});

test("concurrent closes await the same port cleanup, and failed cleanup can be retried", async () => {
  const firstAttempt = deferred();
  let attempt = 0;
  const f = fixture({ close: () => ++attempt === 1 ? firstAttempt.promise : Promise.resolve() });
  const session = await f.transport.open({ baudRate: 9600 });
  const first = session.close();
  const second = session.close();
  const results = Promise.allSettled([first, second]);
  firstAttempt.reject(new Error("device close failed"));
  assert.deepEqual((await results).map((r) => r.status), ["rejected", "rejected"]);
  assert.equal(f.closeCalls(), 1);
  await session.close();
  assert.equal(f.closeCalls(), 2);
  await session.close();
  assert.equal(f.closeCalls(), 2);
  await assert.rejects(session.writeCorrections!(new Uint8Array([1])), /closed/);
});

test("correction writes are ordered, use owned byte copies, and do not compete for locks", async () => {
  const firstWrite = deferred();
  const started = deferred();
  let calls = 0;
  const f = fixture({ write: async () => { if (++calls === 1) { started.resolve(); await firstWrite.promise; } } });
  const session = await f.transport.open({ baudRate: 115200 });
  const input = new Uint8Array([1, 2]);
  const first = session.writeCorrections!(input);
  input[0] = 9;
  await started.promise;
  const secondInput = new Uint8Array([3, 4]);
  const second = session.writeCorrections!(secondInput);
  secondInput[0] = 8;
  const results = Promise.allSettled([first, second]);
  firstWrite.resolve();
  assert.deepEqual((await results).map((r) => r.status), ["fulfilled", "fulfilled"]);
  assert.deepEqual(f.written.map((chunk) => [...chunk]), [[1, 2], [3, 4]]);
  assert.equal(f.port.writable?.locked, false);
  await session.close();
});

test("close waits for an active correction write and rejects queued writes", async () => {
  const write = deferred();
  const started = deferred();
  const f = fixture({ write: async () => { started.resolve(); await write.promise; } });
  const session = await f.transport.open({ baudRate: 115200 });
  const active = session.writeCorrections!(new Uint8Array([1]));
  await started.promise;
  const queued = session.writeCorrections!(new Uint8Array([2]));
  const queuedResult = assert.rejects(queued, /closed/);
  const closing = session.close();
  const closingResult = closing.then(() => "closed", () => "failed");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const prematureCloseCalls = f.closeCalls();
  write.resolve();
  await active;
  await queuedResult;
  assert.equal(await closingResult, "closed");
  assert.equal(prematureCloseCalls, 0);
  assert.deepEqual(f.written.map((chunk) => [...chunk]), [[1]]);
  assert.equal(f.closeCalls(), 1);
});

test("a write failure releases its lock and still allows explicit close", async () => {
  const f = fixture({ write: async () => { throw new Error("write failed"); } });
  const session = await f.transport.open({ baudRate: 115200 });
  await assert.rejects(session.writeCorrections!(new Uint8Array([1])), /write failed/);
  assert.equal(f.port.writable?.locked, false);
  await session.close();
  assert.equal(f.closeCalls(), 1);
});

test("read failure and an early consumer return release the readable lock", async () => {
  const f = fixture();
  const session = await f.transport.open({ baudRate: 115200 });
  const iterator = session.events()[Symbol.asyncIterator]();
  const next = iterator.next();
  f.controller().error(new Error("receiver detached"));
  assert.equal((await next).value.type, "error");
  await iterator.return?.();
  assert.equal(f.port.readable?.locked, false);
  await session.close();
  const second = fixture({ bytes: [1] });
  const secondSession = await second.transport.open({ baudRate: 9600 });
  for await (const _ of secondSession.events()) break;
  assert.equal(second.port.readable?.locked, false);
  await secondSession.close();
});

test("event consumption remains single-use and invalid baud never requests permission", async () => {
  let permissions = 0;
  const f = fixture({ bytes: [1] });
  const transport = new WebSerialGnssTransport({ requestPort: async () => { permissions += 1; return f.port; } });
  for (const baudRate of [0, -1, NaN, Infinity, 1.5, undefined]) {
    await assert.rejects(transport.open({ baudRate }), /positive integer baud rate/);
  }
  assert.equal(permissions, 0);
  const session = await transport.open({ baudRate: 9600 });
  for await (const _ of session.events()) break;
  await assert.rejects(async () => { for await (const _ of session.events()) { /* exhaust */ } }, /only be consumed once/);
  await session.close();
});
