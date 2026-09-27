import assert from "node:assert/strict";
import test from "node:test";
import type { XY } from "@cplayout/core";
import { screenPointToWorld, type MapViewport } from "@cplayout/geometry";
import {
  finitePointBounds,
  fitProjectedBounds,
  viewportForScreen,
  type MapFitBounds,
  type MapScreenInsets,
  type MapScreenSize,
} from "./mapFit";

const screen = Object.freeze({ width: 1000, height: 800 });
const insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const bounds = Object.freeze({ minX: -400, minY: 100, maxX: 800, maxY: 700 });

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

function assertFit(fitBounds: MapFitBounds, size: MapScreenSize, hud: MapScreenInsets, margin = 24): MapViewport {
  const fit = fitProjectedBounds(fitBounds, size, hud, margin);
  assert.ok(fit);
  assert.equal(fit.zoomLevel, 1);
  close(fit.baseWidthMeters / fit.baseHeightMeters, size.width / size.height);
  const mpp = fit.baseWidthMeters / size.width;
  const expectedMpp = Math.max(
    Math.max(fitBounds.maxX - fitBounds.minX, 1) / (size.width - hud.left - hud.right - 2 * margin),
    Math.max(fitBounds.maxY - fitBounds.minY, 1) / (size.height - hud.top - hud.bottom - 2 * margin),
  );
  close(mpp, expectedMpp);
  for (const x of [fitBounds.minX, fitBounds.maxX]) {
    for (const y of [fitBounds.minY, fitBounds.maxY]) {
      const xPixels = size.width / 2 + (x - fit.center.x) / mpp;
      const yPixels = size.height / 2 - (y - fit.center.y) / mpp;
      assert.ok(xPixels >= hud.left + margin - 1e-7 && xPixels <= size.width - hud.right - margin + 1e-7);
      assert.ok(yPixels >= hud.top + margin - 1e-7 && yPixels <= size.height - hud.bottom - margin + 1e-7);
      const world = screenPointToWorld(fit, { xPixels, yPixels }, { widthPixels: size.width, heightPixels: size.height });
      close(world.x, x);
      close(world.y, y);
    }
  }
  return fit;
}

test("finitePointBounds rejects empty or nonfinite input and never mutates points", () => {
  assert.equal(finitePointBounds([]), null);
  const points = Object.freeze([Object.freeze({ x: -17, y: 23 }), Object.freeze({ x: 11, y: -42 })]);
  assert.deepEqual(finitePointBounds(points), { minX: -17, minY: -42, maxX: 11, maxY: 23 });
  assert.deepEqual(points, [{ x: -17, y: 23 }, { x: 11, y: -42 }]);
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const axis of ["x", "y"] as const) {
      assert.equal(finitePointBounds([...points, { x: 0, y: 0, [axis]: value }]), null);
    }
  }
  assert.deepEqual(finitePointBounds([{ x: 2, y: -3 }]), { minX: 2, minY: -3, maxX: 2, maxY: -3 });
});

test("finitePointBounds handles large point collections without argument spreading", () => {
  const points: XY[] = Array.from({ length: 250_000 }, (_, i) => ({ x: i - 100_000, y: -i }));
  assert.deepEqual(finitePointBounds(points), { minX: -100_000, minY: -249_999, maxX: 149_999, maxY: -0 });
});

test("fit preserves aspect and contains corners across portrait, landscape, and asymmetric HUDs", () => {
  const cases = [
    { size: screen, hud: insets },
    { size: { width: 60, height: 10000 }, hud: insets },
    { size: { width: 10000, height: 60 }, hud: insets },
    { size: { width: 390, height: 844 }, hud: { top: 110, right: 48, bottom: 300, left: 24 } },
    { size: { width: 1920, height: 1080 }, hud: { top: 80, right: 450, bottom: 100, left: 240 } },
    { size: { width: 390, height: 844 }, hud: { top: 500, right: 0, bottom: 0, left: 250 } },
  ];
  for (const { size, hud } of cases) assertFit(bounds, size, hud);
  assertFit(bounds, screen, insets, 0);
});

test("fit supports points and horizontal or vertical lines using display-only minimum spans", () => {
  for (const fitBounds of [
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    { minX: -50, minY: -300, maxX: -50, maxY: -300 },
    { minX: -40, minY: 120, maxX: 20, maxY: 120 },
    { minX: 400, minY: -500, maxX: 400, maxY: 1500 },
    { minX: 5, minY: -0.1, maxX: 5.1, maxY: 0.1 },
  ]) assertFit(Object.freeze(fitBounds), screen, insets);
});

test("translation changes only the fitted center and inputs stay unchanged", () => {
  const hud = Object.freeze({ top: 101, right: 207, bottom: 83, left: 52 });
  const initial = assertFit(bounds, screen, hud);
  const moved = assertFit({ minX: bounds.minX + 500000, maxX: bounds.maxX + 500000,
    minY: bounds.minY - 4000000, maxY: bounds.maxY - 4000000 }, screen, hud);
  close(moved.center.x, initial.center.x + 500000);
  close(moved.center.y, initial.center.y - 4000000);
  assert.equal(moved.baseWidthMeters, initial.baseWidthMeters);
  assert.equal(moved.baseHeightMeters, initial.baseHeightMeters);
  initial.center.x = 123;
  assert.deepEqual(bounds, { minX: -400, minY: 100, maxX: 800, maxY: 700 });
  assert.deepEqual(hud, { top: 101, right: 207, bottom: 83, left: 52 });
});

test("fit rejects nonfinite, reversed, negative, and obstructed inputs", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
      assert.equal(fitProjectedBounds({ ...bounds, [key]: value }, screen, insets), null);
    }
  }
  for (const value of [NaN, Infinity, -Infinity, -1]) {
    for (const key of ["top", "right", "bottom", "left"] as const) {
      assert.equal(fitProjectedBounds(bounds, screen, { ...insets, [key]: value }), null);
    }
    assert.equal(fitProjectedBounds(bounds, screen, insets, value), null);
  }
  for (const value of [NaN, Infinity, -Infinity, -1, 0]) {
    for (const key of ["width", "height"] as const) {
      assert.equal(fitProjectedBounds(bounds, { ...screen, [key]: value }, insets), null);
    }
  }
  assert.equal(fitProjectedBounds({ ...bounds, minX: 801 }, screen, insets), null);
  assert.equal(fitProjectedBounds({ ...bounds, minY: 701 }, screen, insets), null);
  assert.equal(fitProjectedBounds(bounds, screen, { ...insets, left: 952 }), null);
  assert.equal(fitProjectedBounds(bounds, screen, { ...insets, top: 752 }), null);
  assert.equal(fitProjectedBounds(bounds, screen, { ...insets, right: 1001 }), null);
  assert.equal(fitProjectedBounds(bounds, screen, insets, 400), null);
});

test("fit rejects overflow and uses stable midpoint arithmetic", () => {
  const max = Number.MAX_VALUE;
  assert.equal(fitProjectedBounds({ minX: -max, maxX: max, minY: 0, maxY: 1 }, screen, insets), null);
  assert.equal(fitProjectedBounds(bounds, { width: max, height: 1 }, insets, 0), null);
  assert.equal(fitProjectedBounds(bounds, { width: Number.MIN_VALUE, height: 1 }, insets, 0), null);
  assert.equal(fitProjectedBounds(bounds, screen, insets, max), null);
  const fit = fitProjectedBounds({ minX: 1e308, maxX: 1.1e308, minY: 0, maxY: 1 }, { width: 100, height: 100 }, insets, 0);
  assert.ok(fit);
  close(fit.center.x, 1e308 / 2 + 1.1e308 / 2);
  assert.equal(fitProjectedBounds({ minX: max, maxX: max, minY: 0, maxY: 1e308 }, screen,
    { ...insets, right: 500 }, 0), null);
});

const viewport: MapViewport = Object.freeze({
  center: Object.freeze({ x: -1200, y: 4300000 }), baseWidthMeters: 1000, baseHeightMeters: 500, zoomLevel: 2.5,
});

test("viewportForScreen expands only the required base axis, preserving center and zoom", () => {
  for (const [size, width, height] of [
    [{ width: 2000, height: 500 }, 2000, 500],
    [{ width: 500, height: 2000 }, 1000, 4000],
    [{ width: 1000, height: 500 }, 1000, 500],
  ] as const) {
    const result = viewportForScreen(viewport, size);
    assert.ok(result);
    assert.equal(result.baseWidthMeters, width);
    assert.equal(result.baseHeightMeters, height);
    assert.equal(result.zoomLevel, viewport.zoomLevel);
    assert.deepEqual(result.center, viewport.center);
    assert.notEqual(result, viewport);
    assert.notEqual(result.center, viewport.center);
    assert.deepEqual(viewportForScreen(result, size), result);
    result.center.x = 50;
    assert.equal(viewport.center.x, -1200);
  }
});

test("viewportForScreen is idempotent and does not crop across fractional aspect ratios", () => {
  for (const size of [{ width: 393, height: 852 }, { width: 1919, height: 1079 }, { width: 1, height: 9999 }]) {
    for (const baseWidthMeters of [0.1, 1 / 3, 98765.4321]) {
      const input = { ...viewport, baseWidthMeters, baseHeightMeters: 1.23456789 };
      const result = viewportForScreen(input, size);
      assert.ok(result);
      assert.ok(result.baseWidthMeters >= input.baseWidthMeters);
      assert.ok(result.baseHeightMeters >= input.baseHeightMeters);
      close(result.baseWidthMeters / result.baseHeightMeters, size.width / size.height);
      for (let i = 0; i < 10; i++) assert.deepEqual(viewportForScreen(result, size), result);
    }
  }
});

test("viewportForScreen rejects invalid dimensions, center, zoom and derived overflow or underflow", () => {
  for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
    for (const key of ["baseWidthMeters", "baseHeightMeters", "zoomLevel"] as const) {
      assert.equal(viewportForScreen({ ...viewport, [key]: value }, screen), null);
    }
    for (const key of ["width", "height"] as const) {
      assert.equal(viewportForScreen(viewport, { ...screen, [key]: value }), null);
    }
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    for (const axis of ["x", "y"] as const) {
      assert.equal(viewportForScreen({ ...viewport, center: { ...viewport.center, [axis]: value } }, screen), null);
    }
  }
  assert.equal(viewportForScreen(viewport, { width: Number.MAX_VALUE, height: Number.MIN_VALUE }), null);
  assert.equal(viewportForScreen(viewport, { width: Number.MIN_VALUE, height: Number.MAX_VALUE }), null);
  assert.equal(viewportForScreen(viewport, { width: Number.MAX_VALUE, height: 1 }), null);
  assert.equal(viewportForScreen({ ...viewport, zoomLevel: Number.MIN_VALUE }, screen), null);
  assert.equal(viewportForScreen({ ...viewport, baseWidthMeters: Number.MIN_VALUE, zoomLevel: Number.MAX_VALUE }, screen), null);
  assert.equal(viewportForScreen({ ...viewport, center: { x: Number.MAX_VALUE, y: 0 },
    baseWidthMeters: Number.MAX_VALUE, zoomLevel: 1 }, screen), null);
});
