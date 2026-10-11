import assert from "node:assert/strict";
import { test } from "node:test";
import { createInitialViewport, visibleWidthMeters } from "@cplayout/geometry";
import { anchoredPixelBox, createSvgSymbolScale, placeMapLabels, visibleCircleLabelPoint, visiblePathLabelPoint, type MapLabelCandidate } from "./svgMapLabels";

const viewport = createInitialViewport({ minX: 500000, minY: 4500000, maxX: 501000, maxY: 4501000 }, 1);
const label = (id: string, priority = 0, x = 500500, y = 4500500): MapLabelCandidate =>
  ({ id, priority, point: { x, y }, text: `Label ${id}`, color: "black" });
const screen = { width: 400, height: 400 };

test("SVG marker screen dimensions stay constant through deep zoom", () => {
  for (const zoomLevel of [0.01, 1, 10, 100, 10000]) {
    const view = { ...viewport, zoomLevel };
    const scale = createSvgSymbolScale(view, screen.width);
    const pixelsPerUnit = screen.width / visibleWidthMeters(view);
    assert.ok(Math.abs(scale.px(7) * pixelsPerUnit - 7) < 1e-10);
    assert.ok(Math.abs(scale.stroke(2) * pixelsPerUnit - 2) < 1e-10);
    assert.ok(Math.abs(scale.font(12) * pixelsPerUnit - 12) < 1e-10);
  }
});

test("crowded labels use deterministic priority and never overlap or change anchors", () => {
  const input = [label("low"), label("selected", 100), ...Array.from({ length: 30 }, (_, i) => label(String(i)))];
  const before = structuredClone(input);
  const result = placeMapLabels(input, viewport, screen);
  assert.equal(result[0].id, "selected");
  assert.ok(result.length >= 1 && result.length <= 4);
  assert.deepEqual(placeMapLabels([...input].reverse(), viewport, screen), result);
  assert.deepEqual(input, before);
  for (const a of result) {
    assert.ok(a.box.x >= 4 && a.box.y >= 4);
    assert.ok(a.box.x + a.box.width <= screen.width - 4 && a.box.y + a.box.height <= screen.height - 4);
    for (const b of result) {
      if (a.id === b.id) continue;
      assert.ok(a.box.x + a.box.width <= b.box.x || b.box.x + b.box.width <= a.box.x
        || a.box.y + a.box.height <= b.box.y || b.box.y + b.box.height <= a.box.y);
    }
  }
});

test("offscreen or invalid anchors and invalid viewports cannot produce labels", () => {
  assert.deepEqual(placeMapLabels([label("outside", 0, 502000), label("bad", 0, NaN)], viewport, screen), []);
  assert.deepEqual(placeMapLabels([label("a")], viewport, { width: 0, height: 400 }), []);
  assert.deepEqual(placeMapLabels([label("a")], { ...viewport, center: { x: Infinity, y: 0 } }, screen), []);
});

test("edit handles reserve space even when they do not have their own label", () => {
  const [before] = placeMapLabels([label("a")], viewport, screen);
  const handle = { x: 500000 + (before.box.x + 10) / 400 * 1000,
    y: 4501000 - (before.box.y + 10) / 400 * 1000 };
  const [after] = placeMapLabels([label("a")], viewport, screen, [handle]);
  assert.ok(after);
  assert.notDeepEqual(before.box, after.box);
});

test("long and multiline names retain their original text with a bounded display name", () => {
  const original = { ...label("a"), text: "A very long field name\nwith additional survey notes at this location" };
  const [result] = placeMapLabels([original], viewport, { width: 900, height: 400 });
  assert.equal(result.text, original.text);
  assert.equal(Array.from(result.displayText).length, 28);
  assert.ok(result.displayText.endsWith("..."));
  assert.ok(!result.displayText.includes("\n"));
});

test("pixel placement maps back to projected SVG coordinates at large offsets", () => {
  const [result] = placeMapLabels([label("a")], viewport, screen);
  assert.ok(Math.abs((result.svgX - 500000) / 1000 * 400 - (result.box.x + 4)) < 1e-8);
  assert.ok(Math.abs((result.svgY + 4501000) / 1000 * 400 - (result.box.y + 15)) < 1e-8);
});

test("visible line anchor clips long segments even with both endpoints offscreen", () => {
  const vertices = [{ x: 490000, y: 4500500 }, { x: 502000, y: 4500500 }];
  const before = structuredClone(vertices);
  assert.deepEqual(visiblePathLabelPoint(vertices, viewport), { x: 500500, y: 4500500 });
  assert.deepEqual(visiblePathLabelPoint([...vertices].reverse(), viewport), { x: 500500, y: 4500500 });
  assert.equal(visiblePathLabelPoint([{ x: 0, y: 0 }, { x: 2, y: 4 }], viewport), null);
  assert.deepEqual(vertices, before);
});

test("concave polygon labels anchor on the visible perimeter instead of an exterior vertex average", () => {
  const ring = [[0, 0], [1000, 0], [1000, 200], [200, 200], [200, 1000], [0, 1000]]
    .map(([x, y]) => ({ x: x + 500000, y: y + 4500000 }));
  const point = visiblePathLabelPoint(ring, viewport, true)!;
  assert.ok(point);
  assert.ok(point.x <= 500200 || point.y <= 4500200);
  assert.notDeepEqual(point, { x: 500400, y: 4500400 });
});

test("controls reserve space independently of geographic features", () => {
  const [first] = placeMapLabels([label("a")], viewport, screen);
  const [moved] = placeMapLabels([label("a")], viewport, screen, [], [first.box]);
  assert.ok(moved);
  assert.notDeepEqual(moved.box, first.box);
  assert.deepEqual(placeMapLabels([label("a")], viewport, screen, [], [{ x: 0, y: 0, ...screen }]), []);
});

test("an otherwise unlabeled view can show one nearby caption without moving anchors", () => {
  const input = [
    { ...label("power", 70), text: "Power" },
    { ...label("water", 60), text: "Water" },
  ];
  const handles = [[240, 200], [178, 200], [200, 170], [200, 235]].map(([x, y]) => ({
    x: 500000 + x / 400 * 1000,
    y: 4501000 - y / 400 * 1000,
  }));
  const before = structuredClone({ input, handles });
  const result = placeMapLabels(input, viewport, screen, handles);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "power");
  assert.deepEqual(result[0].box, { x: 112, y: 189, width: 48, height: 22 });
  assert.deepEqual(result[0].point, input[0].point);
  assert.deepEqual(placeMapLabels([...input].reverse(), viewport, screen, handles), result);
  assert.deepEqual({ input, handles }, before);
  assert.deepEqual(placeMapLabels(input, viewport, screen, handles, [{ x: 0, y: 0, ...screen }]), []);
});

test("ordinary label placement retains its original nearby slot", () => {
  const [result] = placeMapLabels([label("a")], viewport, screen);
  assert.deepEqual(result.box, { x: 220, y: 189, width: 64, height: 22 });
});

test("short point captions preserve the full accessible name", () => {
  const [result] = placeMapLabels([{ ...label("a"), text: "Western supply well", caption: "Well" }], viewport, screen);
  assert.equal(result.text, "Western supply well");
  assert.equal(result.displayText, "Well");
});

test("circle caption anchors stay on visible arcs without changing the radius", () => {
  const center = { x: 501100, y: 4500500 }, radius = 250;
  const point = visibleCircleLabelPoint(center, radius, viewport)!;
  assert.ok(point && point.x >= 500000 && point.x <= 501000);
  assert.ok(Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius) < 1e-8);
  assert.equal(visibleCircleLabelPoint({ x: 500500, y: 4500500 }, 10000, viewport), null);
  assert.equal(visibleCircleLabelPoint(center, -1, viewport), null);
});

test("absolute overlay reservations follow resized viewports even when the overlay size does not change", () => {
  const old = { x: 12, y: 216, width: 284, height: 108 };
  assert.deepEqual(anchoredPixelBox(old, { width: 308, height: 310 }, { left: 12, bottom: 8 }),
    { x: 12, y: 194, width: 284, height: 108 });
  assert.deepEqual(anchoredPixelBox({ x: 500, y: 12, width: 156, height: 48 }, screen, { right: 12, top: 12 }),
    { x: 232, y: 12, width: 156, height: 48 });
  assert.equal(old.y, 216);
});
