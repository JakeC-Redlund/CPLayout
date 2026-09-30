import assert from "node:assert/strict";
import test from "node:test";

import {
  createMapCameraSession,
  createSvgMapCameraSession,
  type MapCameraFrameIdentity,
  type MapCameraView,
} from "./mapCameraSession";

function identity(overrides: Partial<MapCameraFrameIdentity> = {}): MapCameraFrameIdentity {
  return {
    projectId: "project-a",
    projectCrs: "EPSG:32613",
    projectGeneration: 1,
    homeView: false,
    projectionAvailable: true,
    ...overrides,
  };
}

function view(overrides: Partial<MapCameraView> = {}): MapCameraView {
  return { center: [-102.5, 40.1], zoom: 12, bearing: 20, pitch: 30, ...overrides };
}

test("equal identities reuse the token and latest camera snapshot", () => {
  const session = createMapCameraSession();
  const frame = session.useFrame(identity());
  assert.equal(session.isCurrent(frame), true);
  assert.equal(session.restore(frame), null);
  assert.equal(session.remember(frame, view()), true);
  assert.equal(session.useFrame(identity()), frame);
  assert.deepEqual(session.restore(frame), view());
  assert.equal(session.remember(frame, view({ zoom: 13 })), true);
  assert.deepEqual(session.restore(frame), view({ zoom: 13 }));
});

const transitions: [string, Partial<MapCameraFrameIdentity>][] = [
  ["projectId", { projectId: "project-b" }],
  ["projectCrs", { projectCrs: "EPSG:32614" }],
  ["projectGeneration", { projectGeneration: 2 }],
  ["projectionAvailable", { projectionAvailable: false }],
];

test("Catalog roundtrips retain exact independent design and home cameras with new ownership tokens", () => {
  const session = createMapCameraSession();
  const design = session.useFrame(identity());
  const designView = view({ center: [-102.5123456789, 40.123456789], zoom: 13.456, bearing: -47.5, pitch: 61.25 });
  session.remember(design, designView);
  const catalog = session.useFrame(identity({ homeView: true }));
  assert.equal(session.restore(catalog), null);
  assert.equal(session.remember(design, view({ zoom: 99 })), false);
  const catalogView = view({ center: [-98, 49], zoom: 3, bearing: 0, pitch: 0 });
  session.remember(catalog, catalogView);
  const resumed = session.useFrame(identity());
  assert.notEqual(resumed, design); assert.notEqual(resumed, catalog);
  assert.deepEqual(session.restore(resumed), designView);
  for (const retired of [design, catalog]) {
    assert.equal(session.isCurrent(retired), false);
    assert.equal(session.remember(retired, view({ zoom: 98 })), false);
    assert.equal(session.restore(retired), null);
  }
  assert.deepEqual(session.restore(resumed), designView);
  session.remember(resumed, view({ zoom: 15 }));
  const catalogAgain = session.useFrame(identity({ homeView: true }));
  assert.deepEqual(session.restore(catalogAgain), catalogView);
  assert.deepEqual(session.restore(session.useFrame(identity())), view({ zoom: 15 }));
});

test("project identity and projection changes while in Catalog invalidate both remembered cameras", () => {
  for (const [, change] of transitions) {
    const session = createMapCameraSession();
    session.remember(session.useFrame(identity()), view());
    const home = session.useFrame(identity({ homeView: true }));
    session.remember(home, view({ zoom: 3 }));
    const changedHome = session.useFrame(identity({ ...change, homeView: true }));
    assert.equal(session.restore(changedHome), null);
    assert.equal(session.remember(home, view()), false);
    assert.equal(session.restore(session.useFrame(identity({ ...change, homeView: false }))), null);
    assert.equal(session.restore(session.useFrame(identity())), null);
  }
});

test("SVG retains projected viewport and feature selection independently from Catalog", () => {
  const session = createSvgMapCameraSession();
  const design = session.useFrame(identity());
  const designView = { viewport: { center: { x: 512345.678901, y: 4467890.123456 }, baseWidthMeters: 1000, baseHeightMeters: 700, zoomLevel: 2.5 }, selectedMapFeatureId: "field-road" };
  session.remember(design, designView);
  const home = session.useFrame(identity({ homeView: true }));
  const homeView = { viewport: { center: { x: -98, y: 49 }, baseWidthMeters: 116, baseHeightMeters: 57, zoomLevel: 1 }, selectedMapFeatureId: null };
  session.remember(home, homeView);
  const resumed = session.useFrame(identity());
  assert.deepEqual(session.restore(resumed), designView);
  const returned = session.restore(resumed)!;
  returned.viewport.center.x = 0; returned.selectedMapFeatureId = "altered";
  assert.deepEqual(session.restore(resumed), designView);
  assert.equal(session.remember(design, homeView), false);
  assert.equal(session.remember(home, homeView), false);
  assert.deepEqual(session.restore(resumed), designView);
  assert.deepEqual(session.restore(session.useFrame(identity({ homeView: true }))), homeView);
  assert.equal(session.restore(session.useFrame(identity({ projectGeneration: 2 }))), null);
});

for (const [field, change] of transitions) {
  test(`${field} transitions clear the snapshot and A -> B -> A never revives a token`, () => {
    const session = createMapCameraSession();
    const a = session.useFrame(identity());
    session.remember(a, view());
    const b = session.useFrame(identity(change));
    assert.notEqual(b, a);
    assert.equal(session.isCurrent(a), false);
    assert.equal(session.isCurrent(b), true);
    assert.equal(session.restore(b), null);
    assert.equal(session.remember(a, view({ zoom: 50 })), false);
    assert.equal(session.restore(a), null);
    assert.equal(session.restore(b), null);
    assert.equal(session.remember(b, view({ zoom: 14 })), true);
    assert.equal(session.remember(a, view({ zoom: 51 })), false);
    assert.deepEqual(session.restore(b), view({ zoom: 14 }));

    const nextA = session.useFrame(identity());
    assert.notEqual(nextA, a);
    assert.notEqual(nextA, b);
    assert.equal(session.restore(nextA), null);
    assert.equal(session.remember(nextA, view({ zoom: 15 })), true);
    for (const stale of [a, b]) {
      assert.equal(session.isCurrent(stale), false);
      assert.equal(session.remember(stale, view({ zoom: 52 })), false);
      assert.equal(session.restore(stale), null);
    }
    assert.deepEqual(session.restore(nextA), view({ zoom: 15 }));
  });
}

test("an unavailable projection frame invalidates A even without remembering a camera", () => {
  const session = createMapCameraSession();
  const a = session.useFrame(identity());
  session.remember(a, view());
  const invalidB = session.useFrame(identity({ projectCrs: "invalid", projectionAvailable: false }));
  assert.equal(session.restore(invalidB), null);
  const nextA = session.useFrame(identity());
  assert.notEqual(nextA, a);
  assert.equal(session.restore(nextA), null);
  assert.equal(session.remember(a, view()), false);
  assert.equal(session.remember(invalidB, view()), false);
});

test("identity inputs are copied before caller mutation", () => {
  for (const [, change] of transitions) {
    const session = createMapCameraSession();
    const input = identity();
    const frame = session.useFrame(input);
    session.remember(frame, view());
    Object.assign(input, change);
    assert.equal(session.useFrame(identity()), frame);
    assert.deepEqual(session.restore(frame), view());
    assert.notEqual(session.useFrame(input), frame);
  }
});

test("remember and every restore isolate the object and nested center tuple", () => {
  const session = createMapCameraSession();
  const frame = session.useFrame(identity());
  const input = view();
  assert.equal(session.remember(frame, input), true);
  input.center[0] = 999;
  input.center[1] = 888;
  input.zoom = 777;
  input.bearing = 666;
  input.pitch = 555;
  const first = session.restore(frame);
  const second = session.restore(frame);
  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first, view());
  assert.notEqual(first, second);
  assert.notEqual(first.center, second.center);
  first.center[0] = 111;
  first.center[1] = 222;
  first.zoom = 333;
  first.bearing = 444;
  first.pitch = 555;
  assert.deepEqual(second, view());
  assert.deepEqual(session.restore(frame), view());
});

for (const field of ["longitude", "latitude", "zoom", "bearing", "pitch"] as const) {
  for (const value of [NaN, Infinity, -Infinity]) {
    test(`nonfinite ${field}=${value} rejects without overwriting a valid snapshot`, () => {
      const session = createMapCameraSession();
      const frame = session.useFrame(identity());
      const invalid = view();
      if (field === "longitude") invalid.center[0] = value;
      else if (field === "latitude") invalid.center[1] = value;
      else invalid[field] = value;
      assert.equal(session.remember(frame, invalid), false);
      assert.equal(session.restore(frame), null);
      assert.equal(session.remember(frame, view()), true);
      assert.equal(session.remember(frame, invalid), false);
      assert.deepEqual(session.restore(frame), view());
    });
  }
}

test("all finite values round-trip without clamping or wrapping", () => {
  const session = createMapCameraSession();
  const frame = session.useFrame(identity());
  for (const input of [
    view({ center: [1080.5, -120], zoom: -4, bearing: -725, pitch: -100 }),
    view({ center: [-1080.5, 120], zoom: 100, bearing: 725, pitch: 100 }),
    view({ center: [-0, Number.MAX_VALUE], zoom: -Number.MAX_VALUE, bearing: Number.MIN_VALUE, pitch: -0 }),
  ]) {
    assert.equal(session.remember(frame, input), true);
    assert.deepEqual(session.restore(frame), input);
  }
});

test("disposal before or after a project transition cannot leak the previous camera", () => {
  for (const disposeFirst of [true, false]) {
    const session = createMapCameraSession();
    const a = session.useFrame(identity());
    const disposeA = () => session.remember(a, view({ zoom: 16 }));
    if (disposeFirst) assert.equal(disposeA(), true);
    const b = session.useFrame(identity({ projectId: "project-b" }));
    if (!disposeFirst) assert.equal(disposeA(), false);
    assert.equal(session.restore(b), null);
    session.remember(b, view({ zoom: 17 }));
    assert.equal(disposeA(), false);
    assert.deepEqual(session.restore(b), view({ zoom: 17 }));
  }
});

test("multiple style reconstructions within one frame retain the disposal camera", () => {
  const session = createMapCameraSession();
  const frame = session.useFrame(identity());
  let expected: MapCameraView | null = null;
  for (let reconstruction = 0; reconstruction < 5; reconstruction += 1) {
    const rendererFrame = session.useFrame(identity());
    assert.equal(rendererFrame, frame);
    assert.deepEqual(session.restore(rendererFrame), expected);
    expected = view({ zoom: reconstruction, bearing: -360 * reconstruction });
    assert.equal(session.remember(rendererFrame, expected), true);
  }
  assert.deepEqual(session.restore(frame), expected);
});

test("tokens from another session cannot read or overwrite the current camera", () => {
  const session = createMapCameraSession();
  const other = createMapCameraSession();
  const foreign = other.useFrame(identity());
  assert.equal(session.isCurrent(foreign), false);
  assert.equal(session.remember(foreign, view()), false);
  assert.equal(session.restore(foreign), null);
  const frame = session.useFrame(identity());
  assert.notEqual(frame, foreign);
  session.remember(frame, view());
  assert.equal(session.isCurrent(foreign), false);
  assert.equal(session.remember(foreign, view({ zoom: 99 })), false);
  assert.equal(session.restore(foreign), null);
  assert.deepEqual(session.restore(frame), view());
  assert.equal(other.restore(foreign), null);
});
