import assert from "node:assert/strict";
import test from "node:test";
import type { GnssSession } from "@cplayout/gnss";
import { WebSerialSessionOwner } from "./webSerialSessionOwner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function session(close: () => Promise<void>): GnssSession {
  return { id: "synthetic", async *events() {}, close };
}

test("a late port and failed close retain ownership after every panel unsubscribes", async () => {
  const owner = new WebSerialSessionOwner();
  const permission = deferred<GnssSession>();
  const states: string[] = [];
  const unsubscribe = owner.subscribe(() => states.push(owner.getSnapshot().phase));
  const opening = owner.open({ open: () => permission.promise }, {});
  assert.equal(owner.getSnapshot().phase, "opening");
  await assert.rejects(owner.open({ open: () => permission.promise }, {}), /Close the current receiver/);
  unsubscribe();
  let closes = 0;
  const port = session(async () => { closes++; if (closes === 1) throw new Error("late cleanup failed"); });
  permission.resolve(port);
  assert.equal(await opening, port);
  await assert.rejects(owner.close(port), /late cleanup failed/);
  assert.equal(owner.getSnapshot().session, port);
  assert.equal(owner.getSnapshot().phase, "cleanup_failed");
  assert.equal(owner.getSnapshot().error, "late cleanup failed");
  await assert.rejects(owner.open({ open: async () => port }, {}), /Close the current receiver/);
  const remountedStates: string[] = [];
  const stop = owner.subscribe(() => remountedStates.push(owner.getSnapshot().phase));
  await owner.close(port);
  assert.equal(owner.getSnapshot().session, null);
  assert.equal(owner.getSnapshot().phase, "idle");
  assert.equal(closes, 2);
  assert.deepEqual(states, ["opening"]);
  assert.deepEqual(remountedStates, ["closing", "idle"]);
  stop();
});

for (const rejectImmediately of [true, false]) {
  test(`one close attempt is shared and failure requires explicit retry: immediate=${rejectImmediately}`, async () => {
    const owner = new WebSerialSessionOwner();
    const closing = deferred<void>();
    let attempts = 0;
    const port = session(() => {
      attempts++;
      return attempts === 1 ? rejectImmediately ? Promise.reject(new Error("close failed")) : closing.promise : Promise.resolve();
    });
    await owner.open({ open: async () => port }, {});
    const first = owner.close(port);
    const second = owner.close(port);
    assert.equal(first, second);
    const rejected = assert.rejects(first, /close failed/);
    await Promise.resolve();
    if (!rejectImmediately) closing.reject(new Error("close failed"));
    await rejected;
    assert.equal(attempts, 1);
    assert.equal(owner.getSnapshot().phase, "cleanup_failed");
    await Promise.resolve();
    assert.equal(attempts, 1);
    await owner.close(port);
    assert.equal(attempts, 2);
    assert.equal(owner.getSnapshot().phase, "idle");
  });
}

test("permission cancellation restores idle and unrelated sessions cannot close the owner", async () => {
  const owner = new WebSerialSessionOwner();
  await assert.rejects(owner.open({ open: async () => { throw new Error("cancelled"); } }, {}), /cancelled/);
  assert.equal(owner.getSnapshot().phase, "idle");
  const port = session(async () => {});
  await owner.open({ open: async () => port }, {});
  const before = owner.getSnapshot();
  await assert.rejects(owner.close(session(async () => {})), /not owned/);
  assert.equal(owner.getSnapshot(), before);
  await assert.rejects(owner.open({ open: async () => port }, {}), /Close the current receiver/);
  await owner.close(port);
});
