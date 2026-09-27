import assert from "node:assert/strict";
import test from "node:test";
import { panOffsetToRevealPoint } from "./mapViewport";

const viewport = Object.freeze({ width: 680, height: 620 });
const insets = Object.freeze({ left: 0, top: 0, right: 48, bottom: 288 });

test("an already visible handle leaves the camera unchanged", () => {
  assert.equal(panOffsetToRevealPoint(Object.freeze({ x: 340, y: 300 }), viewport, insets), null);
  assert.equal(panOffsetToRevealPoint({ x: 18, y: 314 }, viewport, insets), null);
});

test("a handle behind the measured bottom dock pans up by only the required pixels", () => {
  const point = Object.freeze({ x: 48, y: 572 });
  assert.deepEqual(panOffsetToRevealPoint(point, viewport, insets), { x: 0, y: 258 });
  assert.deepEqual(point, { x: 48, y: 572 });
});

test("camera offsets place every outside edge inside the usable screen rectangle", () => {
  const toolInsets = { ...insets, left: 72, top: 100 };
  for (const point of [{ x: -40, y: -20 }, { x: 690, y: -20 }, { x: -40, y: 700 }, { x: 690, y: 700 }]) {
    const offset = panOffsetToRevealPoint(point, viewport, toolInsets)!;
    assert.ok(offset);
    const shown = { x: point.x - offset.x, y: point.y - offset.y };
    assert.ok(shown.x >= 90 && shown.x <= 614);
    assert.ok(shown.y >= 118 && shown.y <= 314);
    assert.equal(panOffsetToRevealPoint(shown, viewport, toolInsets), null);
  }
});

test("subpixel projection noise does not repeatedly pan the camera", () => {
  assert.equal(panOffsetToRevealPoint({ x: 17.9, y: 314.1 }, viewport, insets), null);
});

test("empty or fully covered viewports and invalid measurements cannot produce a camera command", () => {
  const point = { x: 1, y: 1 };
  for (const size of [{ width: 0, height: 620 }, { width: 680, height: -1 }, { width: Infinity, height: 620 }]) {
    assert.equal(panOffsetToRevealPoint(point, size, insets), null);
  }
  for (const value of [-1, Infinity, NaN]) {
    assert.equal(panOffsetToRevealPoint(point, viewport, { ...insets, bottom: value }), null);
    assert.equal(panOffsetToRevealPoint(point, viewport, insets, value), null);
  }
  assert.equal(panOffsetToRevealPoint({ x: NaN, y: 1 }, viewport, insets), null);
  assert.equal(panOffsetToRevealPoint(point, viewport, { ...insets, bottom: 620 }), null);
  assert.equal(panOffsetToRevealPoint(point, viewport, { ...insets, right: 680 }), null);
});
