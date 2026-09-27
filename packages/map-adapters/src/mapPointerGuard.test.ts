import assert from "node:assert/strict";
import test from "node:test";

import { createMapPointerGuard } from "./mapPointerGuard";

type Pointer = Parameters<ReturnType<typeof createMapPointerGuard>["begin"]>[0];

function pointer(pointerId = 1, overrides: Partial<Pointer> = {}): Pointer {
  return { pointerId, isPrimary: true, button: 0, ...overrides };
}

test("a fresh primary drawing gesture permits its following click after owner release", () => {
  const guard = createMapPointerGuard();
  const input = Object.freeze(pointer());
  assert.equal(guard.canActivate(), false);
  guard.begin(input, true);
  assert.equal(guard.canActivate(), true);
  guard.end(input.pointerId);
  assert.equal(guard.canActivate(), true);
  assert.equal(guard.canActivate(), true, "reading permission does not consume the following click");
  assert.deepEqual(input, { pointerId: 1, isPrimary: true, button: 0 });
  guard.begin(pointer(2), true);
  guard.end(2, false);
  assert.equal(guard.canActivate(), true);
});

test("Fit cancellation survives the held owner's later release and the next real gesture works", () => {
  const guard = createMapPointerGuard();
  guard.begin(pointer(), true);
  guard.cancel();
  assert.equal(guard.canActivate(), false);
  guard.cancel();
  guard.end(1);
  assert.equal(guard.canActivate(), false, "a late release cannot restore canceled click permission");
  guard.begin(pointer(), true);
  assert.equal(guard.canActivate(), true, "a fully drained pointer ID may begin a new gesture");
  guard.end(1);
  assert.equal(guard.canActivate(), true);
});

test("cancel retains all held contacts so another primary cannot revive permission", () => {
  const guard = createMapPointerGuard();
  guard.begin(pointer(10), true);
  guard.begin(pointer(20, { isPrimary: false }), false);
  guard.cancel();
  guard.end(10);
  guard.begin(pointer(30), true);
  assert.equal(guard.canActivate(), false, "the outside contact remains held after owner release");
  guard.end(20);
  guard.begin(pointer(40), true);
  assert.equal(guard.canActivate(), false, "a rejected begin must still be tracked as a held contact");
  guard.end(30);
  guard.end(40);
  assert.equal(guard.canActivate(), false);
  guard.begin(pointer(50), true);
  guard.end(50);
  assert.equal(guard.canActivate(), true);
});

test("both secondary contacts and another device's primary cancel the whole gesture in either release order", () => {
  for (const isPrimary of [false, true]) {
    for (const releaseOrder of [[1, 2], [2, 1]]) {
      const guard = createMapPointerGuard();
      guard.begin(pointer(1), true);
      // Different device types can both report isPrimary; pointer ID ownership still matters.
      guard.begin(pointer(2, { isPrimary }), true);
      assert.equal(guard.canActivate(), false);
      guard.end(releaseOrder[0]);
      assert.equal(guard.canActivate(), false);
      guard.end(releaseOrder[1]);
      assert.equal(guard.canActivate(), false);
      guard.begin(pointer(3), true);
      guard.end(3);
      assert.equal(guard.canActivate(), true);
    }
  }
});

test("a mixed-device primary arriving after Fit stays blocked until both contacts drain", () => {
  for (const firstRelease of [11, 22]) {
    const guard = createMapPointerGuard();
    guard.begin(pointer(11), true);
    guard.cancel();
    guard.begin(pointer(22), true);
    assert.equal(guard.canActivate(), false);
    guard.end(firstRelease);
    assert.equal(guard.canActivate(), false);
    guard.end(firstRelease === 11 ? 22 : 11);
    assert.equal(guard.canActivate(), false);
    guard.begin(pointer(33), true);
    assert.equal(guard.canActivate(), true);
  }
});

test("a canceled touch cannot authorize a compatibility click without a new physical begin", () => {
  for (const cancellation of ["Fit", "pointercancel"] as const) {
    const guard = createMapPointerGuard();
    guard.begin(pointer(17), true);
    if (cancellation === "Fit") guard.cancel();
    guard.end(17, cancellation === "pointercancel");
    assert.equal(guard.canActivate(), false);
    // Compatibility mouse/click events do not call the physical-pointer begin API.
    assert.equal(guard.canActivate(), false);
    guard.end(17);
    assert.equal(guard.canActivate(), false);
    guard.begin(pointer(18), true);
    guard.end(18);
    assert.equal(guard.canActivate(), true);
  }
});

test("an outside or HUD begin never arms and blocks an inside gesture while still held", () => {
  const guard = createMapPointerGuard();
  guard.begin(pointer(1), false);
  assert.equal(guard.canActivate(), false);
  guard.begin(pointer(2), true);
  assert.equal(guard.canActivate(), false);
  guard.end(1);
  assert.equal(guard.canActivate(), false);
  guard.end(2);
  assert.equal(guard.canActivate(), false);
  guard.begin(pointer(3), true);
  guard.end(3);
  assert.equal(guard.canActivate(), true);
  guard.begin(pointer(4), false);
  assert.equal(guard.canActivate(), false, "a HUD begin also retires permission from an earlier click");
  guard.end(4);
  assert.equal(guard.canActivate(), false);
});

test("an outside contact arriving during an armed drawing gesture cancels it", () => {
  const guard = createMapPointerGuard();
  guard.begin(pointer(1), true);
  assert.equal(guard.canActivate(), true);
  guard.begin(pointer(2), false);
  assert.equal(guard.canActivate(), false);
  guard.end(2);
  guard.end(1);
  assert.equal(guard.canActivate(), false);
});

test("nonprimary and nonzero-button starts stay tracked even though they cannot arm", () => {
  for (const overrides of [{ isPrimary: false }, { button: -1 }, { button: 1 }, { button: 2 }]) {
    const guard = createMapPointerGuard();
    guard.begin(pointer(1, overrides), true);
    assert.equal(guard.canActivate(), false);
    guard.begin(pointer(2), true);
    assert.equal(guard.canActivate(), false);
    guard.end(2);
    guard.end(1);
    assert.equal(guard.canActivate(), false);
    guard.begin(pointer(3), true);
    guard.end(3);
    assert.equal(guard.canActivate(), true);
  }
});

test("duplicate begin for the held owner cancels instead of resetting permission", () => {
  const guard = createMapPointerGuard();
  guard.begin(pointer(1), true);
  guard.begin(pointer(1), true);
  assert.equal(guard.canActivate(), false);
  guard.end(1);
  assert.equal(guard.canActivate(), false);
  guard.begin(pointer(1), true);
  guard.end(1);
  assert.equal(guard.canActivate(), true);
});

test("foreign or canceled ends retire permission without draining the held owner", () => {
  for (const canceled of [false, true]) {
    const guard = createMapPointerGuard();
    guard.end(99, canceled);
    assert.equal(guard.canActivate(), false);
    guard.begin(pointer(1), true);
    guard.end(99, canceled);
    assert.equal(guard.canActivate(), false);
    guard.begin(pointer(2), true);
    assert.equal(guard.canActivate(), false, "foreign release cannot erase the original contact");
    guard.end(1);
    guard.end(2);
    guard.begin(pointer(3), true);
    guard.end(3);
    assert.equal(guard.canActivate(), true);
    guard.end(99, canceled);
    assert.equal(guard.canActivate(), false, "foreign release also retires pending click permission");
  }
});

test("clear drains every held contact for blur or disposal and never arms a click", () => {
  const guard = createMapPointerGuard();
  guard.begin(pointer(1), true);
  guard.begin(pointer(2), false);
  guard.clear();
  assert.equal(guard.canActivate(), false);
  guard.clear();
  guard.end(1);
  guard.end(2, true);
  assert.equal(guard.canActivate(), false);
  guard.begin(pointer(3), true);
  assert.equal(guard.canActivate(), true, "clear drains contacts without requiring their releases");
  guard.begin(pointer(4), false);
  guard.clear();
  guard.begin(pointer(5), true);
  guard.end(5);
  assert.equal(guard.canActivate(), true);
  guard.clear();
  assert.equal(guard.canActivate(), false, "clear also retires permission after owner release");
});

test("cancel after owner release retires its pending click; separate guards remain independent", () => {
  const first = createMapPointerGuard();
  const second = createMapPointerGuard();
  first.begin(pointer(1), true);
  first.end(1);
  second.begin(pointer(1), true);
  first.cancel();
  assert.equal(first.canActivate(), false);
  assert.equal(second.canActivate(), true);
  first.clear();
  second.end(1);
  assert.equal(second.canActivate(), true);
  first.begin(pointer(1), true);
  assert.equal(first.canActivate(), true);
});
