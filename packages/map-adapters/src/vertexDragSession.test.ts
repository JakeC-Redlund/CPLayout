import assert from "node:assert/strict";
import test from "node:test";

import { createVertexDragSession } from "./vertexDragSession";

type Pointer = Parameters<ReturnType<typeof createVertexDragSession>["begin"]>[0];
type Point = { x: number; y: number };
type Call = { type: "preview" | "commit"; point: Point } | { type: "cancel" };

function pointer(overrides: Partial<Pointer> = {}): Pointer {
  return {
    pointerId: 7, button: 0, buttons: 1, isPrimary: true,
    clientX: 10, clientY: 20, ...overrides,
  };
}

function setup(thresholdPixels?: number) {
  const calls: Call[] = [];
  const session = createVertexDragSession({
    preview: (point) => calls.push({ type: "preview", point }),
    commit: (point) => calls.push({ type: "commit", point }),
    cancel: () => calls.push({ type: "cancel" }),
  }, thresholdPixels);
  return { session, calls };
}

// Contract interpretations: primary-button chords qualify while bit 1 is held;
// finite release coordinates determine the final point and displacement.
// Clearing before callbacks applies to commit/cancel; preview retains ownership.
test("idle move, release, and cancellation do nothing", () => {
  const { session, calls } = setup();
  assert.equal(session.activePointerId, null);
  session.move(pointer({ clientX: 30 }));
  session.finish(pointer({ buttons: 0, clientX: 30 }));
  session.cancel(7);
  session.cancel();
  assert.deepEqual(calls, []);
  assert.equal(session.activePointerId, null);
});

test("only an idle primary pointer with button zero and primary bit can begin", () => {
  for (const overrides of [
    { isPrimary: false },
    { button: 1, buttons: 4 },
    { button: 2, buttons: 2 },
    { button: 1, buttons: 5 },
    { button: 2, buttons: 3 },
    { button: -1 },
    { buttons: 0 },
    { buttons: 2 },
    { buttons: 4 },
    { buttons: 6 },
  ]) {
    const { session, calls } = setup();
    assert.equal(session.begin(pointer(overrides)), false, JSON.stringify(overrides));
    assert.equal(session.activePointerId, null);
    assert.deepEqual(calls, []);
    assert.equal(session.begin(pointer()), true);
    assert.equal(session.activePointerId, 7);
  }
});

test("repeated starts cannot replace ownership or reset the starting point", () => {
  const { session, calls } = setup();
  assert.equal(session.begin(pointer()), true);
  assert.equal(session.begin(pointer({ clientX: 100 })), false);
  assert.equal(session.begin(pointer({ pointerId: 8, clientX: 100 })), false);
  assert.equal(session.activePointerId, 7);
  session.finish(pointer({ clientX: 13, buttons: 0 }));
  assert.deepEqual(calls, [{ type: "commit", point: { x: 13, y: 20 } }]);
});

test("foreign moves, releases, and cancellation cannot affect the owner", () => {
  const { session, calls } = setup();
  session.begin(pointer());
  session.move(pointer({ pointerId: 8, clientX: 50 }));
  session.move(pointer({ pointerId: 8, buttons: 0, clientX: NaN }));
  session.finish(pointer({ pointerId: 8, buttons: 0, clientX: 50 }));
  session.finish(pointer({ pointerId: 8, buttons: 0, clientX: NaN }));
  session.cancel(8);
  assert.equal(session.activePointerId, 7);
  assert.deepEqual(calls, []);
  session.move(pointer({ clientX: 14 }));
  session.finish(pointer({ clientX: 14, buttons: 0 }));
  assert.deepEqual(calls, [
    { type: "preview", point: { x: 14, y: 20 } },
    { type: "commit", point: { x: 14, y: 20 } },
  ]);
});

test("primary-button chords may begin and move; other button releases are ignored", () => {
  for (const buttons of [3, 5, 7]) {
    const { session, calls } = setup();
    assert.equal(session.begin(pointer({ buttons })), true);
    session.move(pointer({ button: -1, buttons, clientX: 14 }));
    session.finish(pointer({ button: 2, buttons: 1, clientX: 15 }));
    session.finish(pointer({ button: 1, buttons: 1, clientX: 16 }));
    assert.equal(session.activePointerId, 7);
    assert.deepEqual(calls, [{ type: "preview", point: { x: 14, y: 20 } }]);
    session.finish(pointer({ button: 0, buttons: buttons & ~1, clientX: 17 }));
    assert.deepEqual(calls.at(-1), { type: "commit", point: { x: 17, y: 20 } });
    assert.equal(session.activePointerId, null);
  }
});

test("losing the primary bit cancels and a late release cannot commit", () => {
  for (const buttons of [0, 2, 4, 6]) {
    const { session, calls } = setup();
    session.begin(pointer());
    session.move(pointer({ clientX: 14 }));
    session.move(pointer({ buttons, clientX: 16 }));
    assert.equal(session.activePointerId, null);
    session.move(pointer({ clientX: 18 }));
    session.finish(pointer({ buttons: 0, clientX: 18 }));
    assert.deepEqual(calls, [
      { type: "preview", point: { x: 14, y: 20 } },
      { type: "cancel" },
    ]);
  }
});

test("threshold is inclusive from the original start and preview continues after crossing", () => {
  const { session, calls } = setup();
  session.begin(pointer());
  session.move(pointer({ clientX: 12.999 }));
  assert.deepEqual(calls, []);
  session.move(pointer({ clientX: 13 }));
  session.move(pointer({ clientX: 13.5 }));
  session.move(pointer({ clientX: 12 }));
  session.move(pointer({ clientX: 7 }));
  assert.deepEqual(calls, [
    { type: "preview", point: { x: 13, y: 20 } },
    { type: "preview", point: { x: 13.5, y: 20 } },
    { type: "preview", point: { x: 12, y: 20 } },
    { type: "preview", point: { x: 7, y: 20 } },
  ]);
  assert.equal(session.activePointerId, 7);
});

test("threshold uses Euclidean displacement and supports a custom value", () => {
  const { session, calls } = setup(5);
  session.begin(pointer());
  session.move(pointer({ clientX: 12, clientY: 24 }));
  assert.deepEqual(calls, []);
  session.move(pointer({ clientX: 13, clientY: 24 }));
  session.finish(pointer({ clientX: 13, clientY: 24, buttons: 0 }));
  assert.deepEqual(calls, [
    { type: "preview", point: { x: 13, y: 24 } },
    { type: "commit", point: { x: 13, y: 24 } },
  ]);
});

test("preview activation resets for the next session after commit or cancellation", () => {
  for (const ending of ["commit", "cancel"] as const) {
    const { session, calls } = setup();
    session.begin(pointer());
    session.move(pointer({ clientX: 14 }));
    if (ending === "commit") session.finish(pointer({ clientX: 14, buttons: 0 }));
    else session.cancel();
    const previousCalls = calls.slice();
    assert.equal(session.begin(pointer()), true);
    session.move(pointer({ clientX: 11 }));
    assert.deepEqual(calls, previousCalls);
    session.finish(pointer({ clientX: 11, buttons: 0 }));
    assert.deepEqual(calls, [...previousCalls, { type: "cancel" }]);
  }
});

test("tap and sub-threshold releases cancel without committing geometry", () => {
  for (const clientX of [10, 12.999]) {
    const { session, calls } = setup();
    session.begin(pointer());
    session.move(pointer({ clientX }));
    session.finish(pointer({ clientX, buttons: 0 }));
    session.finish(pointer({ clientX: 30, buttons: 0 }));
    assert.deepEqual(calls, [{ type: "cancel" }]);
    assert.equal(session.activePointerId, null);
  }
});

test("release can cross the threshold without any preceding move", () => {
  const { session, calls } = setup();
  session.begin(pointer());
  session.finish(pointer({ clientX: 13, buttons: 0 }));
  session.finish(pointer({ clientX: 14, buttons: 0 }));
  session.cancel();
  assert.deepEqual(calls, [{ type: "commit", point: { x: 13, y: 20 } }]);
  assert.equal(session.activePointerId, null);
});

test("release coordinates take precedence over the last preview", () => {
  const { session, calls } = setup();
  session.begin(pointer());
  session.move(pointer({ clientX: 14 }));
  session.finish(pointer({ clientX: 18, clientY: 22, buttons: 0 }));
  assert.deepEqual(calls, [
    { type: "preview", point: { x: 14, y: 20 } },
    { type: "commit", point: { x: 18, y: 22 } },
  ]);
});

test("returning inside the threshold keeps preview current but release cancels", () => {
  const { session, calls } = setup();
  session.begin(pointer());
  session.move(pointer({ clientX: 30 }));
  session.move(pointer({ clientX: 11 }));
  session.move(pointer());
  session.finish(pointer({ clientX: 11, buttons: 0 }));
  assert.deepEqual(calls, [
    { type: "preview", point: { x: 30, y: 20 } },
    { type: "preview", point: { x: 11, y: 20 } },
    { type: "preview", point: { x: 10, y: 20 } },
    { type: "cancel" },
  ]);
});

test("explicit owner or unconditional cancellation happens once and permits a new session", () => {
  for (const pointerId of [7, undefined]) {
    const { session, calls } = setup();
    session.begin(pointer());
    session.cancel(pointerId);
    session.cancel(pointerId);
    session.finish(pointer({ buttons: 0, clientX: 30 }));
    assert.deepEqual(calls, [{ type: "cancel" }]);
    assert.equal(session.activePointerId, null);
    assert.equal(session.begin(pointer({ pointerId: 8 })), true);
    session.finish(pointer({ pointerId: 7, buttons: 0, clientX: 30 }));
    assert.equal(session.activePointerId, 8);
    assert.deepEqual(calls, [{ type: "cancel" }]);
  }
});

for (const coordinate of ["clientX", "clientY"] as const) {
  for (const value of [NaN, Infinity, -Infinity]) {
    test(`nonfinite ${coordinate}=${value} fails closed at begin, move, and finish`, () => {
      const invalid = pointer({ [coordinate]: value });
      const rejected = setup();
      assert.equal(rejected.session.begin(invalid), false);
      assert.equal(rejected.session.activePointerId, null);
      assert.deepEqual(rejected.calls, []);

      for (const method of ["move", "finish"] as const) {
        const { session, calls } = setup();
        session.begin(pointer());
        session.move(pointer({ clientX: 14 }));
        session[method](invalid);
        assert.equal(session.activePointerId, null);
        session.finish(pointer({ clientX: 30, buttons: 0 }));
        assert.deepEqual(calls, [
          { type: "preview", point: { x: 14, y: 20 } },
          { type: "cancel" },
        ]);
      }
    });
  }
}

test("touch-like primary pointer accepts button -1 movement and commits its release", () => {
  const { session, calls } = setup();
  assert.equal(session.begin(pointer({ pointerId: 42, clientX: 0, clientY: 0 })), true);
  session.move(pointer({ pointerId: 42, button: -1, clientX: 0, clientY: 4 }));
  session.finish(pointer({ pointerId: 42, buttons: 0, clientX: 0, clientY: 5 }));
  assert.deepEqual(calls, [
    { type: "preview", point: { x: 0, y: 4 } },
    { type: "commit", point: { x: 0, y: 5 } },
  ]);
  assert.equal(session.activePointerId, null);
});

test("preview retains ownership and may explicitly cancel the session", () => {
  let cancellations = 0;
  const session = createVertexDragSession({
    preview: () => {
      assert.equal(session.activePointerId, 7);
      session.cancel();
    },
    commit: () => assert.fail("a cancelled preview must not commit"),
    cancel: () => { cancellations += 1; },
  });
  session.begin(pointer());
  session.move(pointer({ clientX: 14 }));
  session.finish(pointer({ clientX: 14, buttons: 0 }));
  assert.equal(cancellations, 1);
  assert.equal(session.activePointerId, null);
});

test("terminal callbacks see cleared state and can begin a new session safely", () => {
  for (const ending of ["commit", "tap", "cancel", "invalidMove", "invalidFinish", "lostButton"] as const) {
    let terminals = 0;
    const onTerminal = () => {
      terminals += 1;
      assert.equal(session.activePointerId, null);
      session.cancel();
      assert.equal(session.begin(pointer({ pointerId: 8 })), true);
    };
    const session = createVertexDragSession({
      preview: () => {},
      commit: () => { assert.equal(ending, "commit"); onTerminal(); },
      cancel: () => { assert.notEqual(ending, "commit"); onTerminal(); },
    });
    session.begin(pointer());
    if (ending === "commit") session.finish(pointer({ clientX: 14, buttons: 0 }));
    if (ending === "tap") session.finish(pointer({ buttons: 0 }));
    if (ending === "cancel") session.cancel();
    if (ending === "invalidMove") session.move(pointer({ clientX: NaN }));
    if (ending === "invalidFinish") session.finish(pointer({ clientY: Infinity, buttons: 0 }));
    if (ending === "lostButton") session.move(pointer({ buttons: 0 }));
    assert.equal(terminals, 1);
    assert.equal(session.activePointerId, 8);
  }
});

test("throwing terminal callbacks cannot leave the old session active", () => {
  for (const ending of ["commit", "cancel"] as const) {
    const failure = new Error("callback failure");
    const session = createVertexDragSession({
      preview: () => {},
      commit: () => { throw failure; },
      cancel: () => { throw failure; },
    });
    session.begin(pointer());
    assert.throws(() => {
      if (ending === "commit") session.finish(pointer({ clientX: 14, buttons: 0 }));
      else session.cancel();
    }, (error) => error === failure);
    assert.equal(session.activePointerId, null);
    assert.equal(session.begin(pointer({ pointerId: 8 })), true);
  }
});
