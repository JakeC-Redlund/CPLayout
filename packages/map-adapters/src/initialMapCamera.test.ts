import assert from "node:assert/strict";
import { test } from "node:test";
import { createMapCameraSession } from "./mapCameraSession";
import { createInitialMapCameraAdmission, hasVisibleMapSize } from "./initialMapCamera";

const size = { width: 454, height: 600 };
const view = { center: [-102.51234, 40.12345] as [number, number], zoom: 14.5, bearing: 25, pitch: 30 };

test("hidden and padding-obstructed initialization cannot admit or store the default origin camera", () => {
  const admission = createInitialMapCameraAdmission(false);
  let calls = 0;
  for (const dimensions of [{ width: 0, height: 0 }, { width: 70, height: 600 }, { width: 454, height: 96 },
    { width: NaN, height: 600 }, { width: Infinity, height: 600 }, { width: -5, height: 600 }]) {
    assert.equal(admission.initialize(dimensions, () => { calls++; return view; }), null);
    assert.equal(admission.isReady(), false);
  }
  assert.equal(calls, 0);
  assert.deepEqual(admission.initialize(size, padding => { assert.equal(padding, 48); return view; }), view);
  assert(admission.isReady());
});

test("failed bounds calculation or apply failure remains retryable on a later size or load event", () => {
  const admission = createInitialMapCameraAdmission(false);
  assert.equal(admission.initialize(size, () => null), null);
  assert.equal(admission.isReady(), false);
  assert.throws(() => admission.initialize(size, () => { throw new Error("fit failed"); }), /fit failed/);
  assert.equal(admission.isReady(), false);
  assert.equal(admission.initialize(size, () => ({ ...view, zoom: NaN })), null);
  assert.equal(admission.isReady(), false);
  assert.deepEqual(admission.initialize(size, () => view), view);
  assert(admission.isReady());
});

test("resize events fired synchronously by initial fit cannot recurse or record a partial camera", () => {
  const admission = createInitialMapCameraAdmission(false);
  const actual = admission.initialize(size, () => {
    assert.equal(admission.isReady(), false);
    assert.equal(admission.initialize(size, () => assert.fail("reentrant fit")), null);
    return view;
  });
  assert.deepEqual(actual, view);
  assert(admission.isReady());
});

test("a successful legitimate origin camera is accepted without coordinate heuristics", () => {
  const admission = createInitialMapCameraAdmission(false);
  const origin = { center: [0, 0] as [number, number], zoom: 0, bearing: 0, pitch: 0 };
  assert.deepEqual(admission.initialize(size, () => origin), origin);
  assert(admission.isReady());
});

test("a completed initialization never refits a user's camera during resize or hide and reveal", () => {
  const admission = createInitialMapCameraAdmission(false);
  admission.initialize(size, () => view);
  for (const dimensions of [size, { width: 0, height: 0 }, { width: 1366, height: 768 }, { width: 70, height: 90 }]) {
    assert.equal(admission.initialize(dimensions, () => assert.fail("user view must remain unchanged")), null);
    assert(admission.isReady());
  }
});

test("style reconstruction restores an owned user view after visibility returns without fitting bounds", () => {
  const session = createMapCameraSession();
  const frame = session.useFrame({ projectId: "field", projectCrs: "EPSG:32613", projectGeneration: 1, homeView: false, projectionAvailable: true });
  session.remember(frame, view);
  const restored = session.restore(frame)!;
  const admission = createInitialMapCameraAdmission(true);
  assert.equal(admission.initialize({ width: 0, height: 0 }, () => assert.fail("hidden restore")), null);
  // Restoration does not need the bounds-fit padding allowance.
  const actual = admission.initialize({ width: 70, height: 90 }, () => restored);
  assert.deepEqual(actual, view);
  assert.deepEqual(session.restore(frame), view);
  actual!.center[0] = 0;
  assert.deepEqual(restored, view);
});

test("hiding an admitted map during movement still permits an exact outgoing navigation snapshot", () => {
  const session = createMapCameraSession();
  const identity = { projectId: "field", projectCrs: "EPSG:32613", projectGeneration: 1, homeView: false, projectionAvailable: true };
  const design = session.useFrame(identity);
  const admission = createInitialMapCameraAdmission(false);
  session.remember(design, admission.initialize(size, () => view)!);
  const duringMovement = { center: [-102.51289, 40.12765] as [number, number], zoom: 15.625, bearing: 72, pitch: 14 };
  // React can hide the container before the outgoing layout-effect snapshot,
  // without a moveend event. Admission, not current visibility, owns that view.
  admission.initialize({ width: 0, height: 0 }, () => assert.fail("hidden refit"));
  assert(admission.isReady());
  assert(session.remember(design, duringMovement));
  session.useFrame({ ...identity, homeView: true });
  const resumed = session.useFrame(identity);
  assert.deepEqual(session.restore(resumed), duringMovement);
  assert.equal(session.remember(design, view), false);
  assert.deepEqual(session.restore(resumed), duringMovement);
});

test("only actual positive finite container dimensions count as visible", () => {
  assert(hasVisibleMapSize(size));
  assert.equal(hasVisibleMapSize({ width: 0, height: 600 }), false);
  assert.equal(hasVisibleMapSize({ width: 400, height: NaN }), false);
});

test("projection stays unavailable before admission and when renderer or frame ownership retires", () => {
  const renderer = {};
  let currentRenderer = renderer;
  let currentFrame = 1;
  const admission = createInitialMapCameraAdmission(false, () => currentRenderer === renderer && currentFrame === 1);
  for (const dimensions of [{ width: 0, height: 0 }, { width: 70, height: 600 }, { width: 96, height: 600 }]) {
    assert.equal(admission.initialize(dimensions, () => assert.fail("pending camera must not project")), null);
    assert.equal(admission.canUseCamera(), false);
  }
  assert.deepEqual(admission.initialize(size, () => view), view);
  assert(admission.canUseCamera());
  currentRenderer = {};
  assert.equal(admission.canUseCamera(), false, "style replacement must retire the old renderer");
  currentRenderer = renderer;
  currentFrame = 2;
  assert.equal(admission.canUseCamera(), false, "navigation must retire the old frame");
});

test("ownership lost during initial fitting cannot publish a ready camera or accept a late retry", () => {
  let owned = true;
  const admission = createInitialMapCameraAdmission(false, () => owned);
  assert.equal(admission.initialize(size, () => { owned = false; return view; }), null);
  assert.equal(admission.isReady(), false);
  assert.equal(admission.canUseCamera(), false);
  assert.equal(admission.initialize(size, () => assert.fail("retired camera must not retry")), null);
});
