import assert from "node:assert/strict";
import test from "node:test";
import { AccountNavigationBoundary } from "./navigationBoundary";
test("an immediate departure waits for raw-input recovery and refuses a failed checkpoint", async () => {
  const boundary = new AccountNavigationBoundary(() => "principal/field"), completed: string[] = [];
  let release!: (value: boolean) => void;
  boundary.register(() => new Promise<boolean>(resolve => { release = resolve; }));
  const leaving = boundary.preserve().then(value => { completed.push(value); return value; });
  await Promise.resolve(); assert.deepEqual(completed, []); release(false); assert.equal(await leaving, "preservation_pending");
  boundary.register(async () => { throw new Error("Synthetic quota failure"); }); assert.equal(await boundary.preserve(), "preservation_failed");
});
test("new account, owner or departure invalidates an earlier completed asynchronous flush", async () => {
  let identity = "old-account/workspace", release!: (value: boolean) => void;
  const boundary = new AccountNavigationBoundary(() => identity);
  const oldCleanup = boundary.register(() => new Promise<boolean>(resolve => { release = resolve; })), old = boundary.preserve();
  identity = "new-account/workspace"; release(true); assert.equal(await old, "source_changed");
  const current = async () => true; boundary.register(current); oldCleanup(); assert.equal(await boundary.preserve(), "preserved");
  boundary.register(() => new Promise<boolean>(resolve => { release = resolve; })); const replaced = boundary.preserve();
  boundary.register(current); release(true); assert.equal(await replaced, "source_changed");
});
