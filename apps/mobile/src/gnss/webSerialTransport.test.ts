import assert from "node:assert/strict";

import { WebSerialGnssTransport, type WebSerialPortLike } from "./webSerialTransport";

async function run(): Promise<void> {
  const written: Uint8Array[] = [];
  let openedBaudRate: number | null = null;
  let closeCount = 0;
  const port: WebSerialPortLike = {
  async open(options) {
    openedBaudRate = options.baudRate;
  },
  async close() {
    closeCount += 1;
  },
  readable: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  }),
  writable: new WritableStream<Uint8Array>({
    write(chunk) {
      written.push(chunk);
    },
  }),
  };

  let clockTick = 100;
  const transport = new WebSerialGnssTransport({ requestPort: async () => port }, {
    nowIso: () => "2026-08-09T12:00:00.000Z",
    monotonicMs: () => clockTick++,
  });
  const session = await transport.open({ baudRate: 115200 });
  assert.equal(openedBaudRate, 115200);
  assert.match(session.id, /^web-serial-/);
  const events = [];
  for await (const event of session.events()) events.push(event);
  assert.equal(events[0]?.type, "bytes");
  if (events[0]?.type === "bytes") {
    assert.deepEqual([...events[0].bytes], [1, 2, 3]);
    assert.equal(events[0].receivedAt, "2026-08-09T12:00:00.000Z");
  }
  assert.deepEqual(events.at(-1), { type: "ended", reason: "eof" });
  await session.writeCorrections?.(new Uint8Array([9, 8]));
  assert.deepEqual([...written[0]], [9, 8]);
  await session.close();
  assert.equal(closeCount, 1);
  await session.close();
  assert.equal(closeCount, 1);

  await assert.rejects(() => transport.open({ baudRate: 0 }), /positive integer baud rate/);

  const unreadableTransport = new WebSerialGnssTransport({
    requestPort: async () => ({
      open: async () => undefined,
      close: async () => undefined,
      readable: null,
    }),
  });
  const unreadableSession = await unreadableTransport.open({ baudRate: 9600 });
  const unreadableEvents = [];
  for await (const event of unreadableSession.events()) unreadableEvents.push(event);
  assert.equal(unreadableEvents[0]?.type, "error");
  assert.deepEqual(unreadableEvents[1], { type: "ended", reason: "eof" });
}

void run().then(() => console.log("web serial transport tests passed"));
