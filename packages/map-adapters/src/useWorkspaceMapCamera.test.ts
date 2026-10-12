import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { createRequire } from "node:module";
import { createWorkspaceCameraStore, type WorkspaceCameraRecoveryEntry, type WorkspaceCameraRecoveryHandle } from "./useWorkspaceMapCamera";
import { viewportForScreen } from "./mapFit";
import { workspaceMapSceneFromDraft } from "./workspaceMapScene";
import { defaultAppSettings, defaultProjectSettings } from "../../core/src/settings";
import type { DesignDraft } from "../../core/src/designDraft";
import type { MapViewport } from "../../geometry/src/mapInteraction";
import type { WorkspaceCanvasProps, WorkspaceMapFrameProps } from "./workspaceMapSurfaceTypes";

const size = { width: 800, height: 600 }, first = { minX: 1000, minY: 2000, maxX: 1500, maxY: 2400 };
test("camera context retains user intent across scene revision, mode-equivalent activations and resize until explicit Fit", () => {
  const store = createWorkspaceCameraStore(), initial = store.activate("field:crs", first, size), owner = store.ticket();
  const panned = { ...initial, center: { x: 1300.123456789, y: 2200.987654321 }, zoomLevel: 2 };
  assert.equal(store.update("field:crs", panned, owner), true);
  const changedGeometry = { minX: 900000, minY: 900000, maxX: 901000, maxY: 901000 };
  assert.deepEqual(store.activate("field:crs", changedGeometry, size), panned);
  assert.deepEqual(store.activate("field:crs", changedGeometry, { width: 400, height: 500 }), panned);
  assert.equal(store.ticket(), owner);
  const fitted = store.fit("field:crs", changedGeometry, size)!;
  assert(fitted.center.x > 899000); assert.notDeepEqual(fitted, panned);
});
test("context away/back restores exact camera but rejects prior activation callbacks and invalid viewport", () => {
  const store = createWorkspaceCameraStore(), old = store.activate("field-a", first, size), ticket = store.ticket();
  store.activate("field-b", { minX: 50, minY: 50, maxX: 100, maxY: 100 }, size);
  assert.equal(store.update("field-a", { ...old, center: { x: 0, y: 0 } }, ticket), false);
  assert.deepEqual(store.activate("field-a", first, size), old);
  assert.equal(store.update("field-a", { ...old, center: { x: 0, y: 0 } }, ticket), false);
  assert.equal(store.update("field-a", { ...old, zoomLevel: NaN }, store.ticket()), false);
  assert.deepEqual(store.activate("field-a", first, size), old);
});
test("initial fit waits for measurable working space; empty scenes do not later acquire implicit geometry fits", () => {
  const store = createWorkspaceCameraStore();
  store.activate("hidden", first, { width: 0, height: 0 });
  store.activate("hidden", first, { width: 50, height: 50 });
  const visible = store.activate("hidden", first, size);
  assert(visible.center.x > 900);
  const empty = store.activate("empty", null, size);
  assert.deepEqual(store.activate("empty", first, size), empty);
  assert.notDeepEqual(store.fit("empty", first, size), empty);
});

const camera = (x = 1234.123456789, y = 2345.987654321): MapViewport => ({ center: { x, y }, baseWidthMeters: 900, baseHeightMeters: 600, zoomLevel: 2 });
const entry = (contextKey: string, viewport = camera(), initialized = true): WorkspaceCameraRecoveryEntry => ({ contextKey, viewport, initialized });

test("recovery snapshot captures every cached context and initialization as frozen detached camera data", () => {
  const store = createWorkspaceCameraStore(); store.activate("first", first, size);
  store.update("first", camera(), store.ticket()); store.activate("hidden", first, { width: 0, height: 0 });
  const snapshot = store.snapshot(); assert.deepEqual(snapshot.map(value => [value.contextKey, value.initialized]), [["first", true], ["hidden", false]]);
  assert.deepEqual(snapshot[0].viewport, camera()); assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot[0].viewport.center));
  assert.notStrictEqual(store.snapshot()[0].viewport, snapshot[0].viewport);
  const copied = structuredClone(snapshot); copied[0].viewport.center.x = -900;
  assert.deepEqual(store.snapshot()[0].viewport, camera());
});

test("camera staging validates every entry before mutation and rejects aliases, duplicates, nonfinite/extreme extents and descriptor tricks", () => {
  const store = createWorkspaceCameraStore(); store.activate("owned", first, size);
  const before = store.snapshot(), ticket = store.ticket(), control = store.stage([entry("owned")]);
  const malformed: unknown[] = [[entry("a"), entry("a")], [entry("a"), entry("bad", { ...camera(), zoomLevel: 0 })],
    [entry("a"), entry("bad", { ...camera(), center: { x: NaN, y: 0 } })],
    [entry("bad", { center: { x: 1.7e308, y: 1.7e308 }, baseWidthMeters: 1.7e308, baseHeightMeters: 1.7e308, zoomLevel: 1 })],
    [entry(""), { ...entry("b"), extra: "unsupported" }], Array.from({ length: 129 }, (_, index) => entry(`context-${index}`))];
  let calls = 0;
  const accessor = entry("getter"); Object.defineProperty(accessor.viewport.center, "x", { enumerable: true, get() { calls++; return 1; } }); malformed.push([accessor]);
  const arrayAccessor = [entry("array-getter")]; Object.defineProperty(arrayAccessor, "0", { enumerable: true, get() { calls++; return entry("wrong"); } }); malformed.push(arrayAccessor);
  const sparse = new Array(1); malformed.push(sparse);
  const extraIndex = [entry("index")]; Object.defineProperty(extraIndex, "01", { value: entry("extra"), enumerable: true }); malformed.push(extraIndex);
  const hidden = entry("hidden-key"); Object.defineProperty(hidden, "secret", { value: 1 }); malformed.push([hidden]);
  const hooked = { ...entry("toJSON"), toJSON() { calls++; return entry("changed"); } }; malformed.push([hooked]);
  for (const value of malformed) { assert.throws(() => store.stage(value as WorkspaceCameraRecoveryEntry[])); assert.deepEqual(store.snapshot(), before); assert.equal(store.ticket(), ticket); assert.equal(control.isCurrent(), true); }
  assert.equal(calls, 0);
  const incoming = [entry("owned", camera(8000, 9000))], plan = store.stage(incoming); incoming[0].viewport.center.x = -100;
  plan.apply(); assert.equal(store.snapshot()[0].viewport.center.x, 8000);
});

test("staged camera recovery survives source-context activation and resize and applies the fresh active context's real screen", () => {
  const store = createWorkspaceCameraStore(); store.activate("old", first, size);
  const incoming = [entry("old", camera(100, 200)), entry("target", camera(300, 400)), entry("cached", camera(500, 600), false)], plan = store.stage(incoming);
  store.activate("intermediate", null, { width: 0, height: 0 }); store.activate("target", first, { width: 400, height: 700 });
  const oldTicket = store.ticket(); assert.equal(plan.isCurrent(), true);
  plan.apply(); assert.equal(plan.isCurrent(), false); assert.notEqual(store.ticket(), oldTicket);
  assert.deepEqual(store.snapshot().map(value => value.contextKey), ["old", "target", "cached"]);
  assert.deepEqual(store.activate("target", first, { width: 400, height: 700 }), viewportForScreen(incoming[1].viewport, { width: 400, height: 700 }));
  assert.equal(store.update("target", camera(0, 0), oldTicket), false);
  assert.deepEqual(store.snapshot().find(value => value.contextKey === "cached")!.viewport, incoming[2].viewport);
});

test("accepted pan/zoom/Fit and same-value/away-back camera changes retire staged reviews; invalid or retired callbacks cannot mutate them", () => {
  const store = createWorkspaceCameraStore(), original = store.activate("owned", first, size), ticket = store.ticket();
  const sameValue = store.stage([entry("owned")]); assert.equal(store.update("owned", original, ticket), true); assert.equal(sameValue.isCurrent(), false);
  assert.throws(() => sameValue.apply(), /stale/);
  const aba = store.stage([entry("owned")]); store.update("owned", camera(1, 2), ticket); store.update("owned", original, ticket); assert.equal(aba.isCurrent(), false);
  const fit = store.stage([entry("owned")]); assert.ok(store.fit("owned", first, size)); assert.equal(fit.isCurrent(), false);
  const denied = store.stage([entry("owned")]); assert.equal(store.update("owned", { ...camera(), zoomLevel: NaN }, ticket), false); assert.equal(denied.isCurrent(), true);
  store.activate("other", first, size); assert.equal(store.update("owned", camera(), ticket), false); assert.equal(denied.isCurrent(), true);
  store.activate("owned", first, size); assert.equal(denied.isCurrent(), true);
});

test("camera plans are one-use and lifetime-owned; a publication retires competing plans without reviving old pan owners", () => {
  const store = createWorkspaceCameraStore(); store.activate("owned", first, size);
  const firstPlan = store.stage([entry("owned", camera(10, 20))]), competing = store.stage([entry("owned", camera(30, 40))]);
  firstPlan.apply(); assert.equal(firstPlan.isCurrent(), false); assert.equal(competing.isCurrent(), false); assert.throws(() => firstPlan.apply()); assert.throws(() => competing.apply());
  const old = store.stage([entry("owned")]), ticket = store.ticket(), retained = store.snapshot();
  store.retire(); assert.equal(old.isCurrent(), false); assert.throws(() => old.apply()); assert.throws(() => store.stage([entry("owned")]));
  assert.deepEqual(store.snapshot(), retained); assert.equal(store.update("owned", camera(), ticket), false);
  store.mount(); assert.equal(old.isCurrent(), false); assert.notEqual(store.ticket(), ticket); assert.equal(store.stage([entry("owned")]).isCurrent(), true);
});

test("hidden/unknown screen parks a recovered camera without fitting geometry; later measurable layout adapts that same view", () => {
  const store = createWorkspaceCameraStore(); store.activate("hidden", first, { width: 0, height: 0 });
  const recovered = camera(9000, 10000), plan = store.stage([entry("hidden", recovered, false)]); plan.apply();
  assert.deepEqual(store.snapshot()[0], entry("hidden", recovered, false));
  assert.deepEqual(store.activate("hidden", { minX: -100, minY: -100, maxX: 0, maxY: 0 }, { width: 0, height: 0 }), recovered);
  assert.equal(store.snapshot()[0].initialized, false);
  const actualScreen = { width: 300, height: 900 }, visible = store.activate("hidden", first, actualScreen);
  assert.deepEqual(visible, viewportForScreen(recovered, actualScreen)); assert.equal(visible.center.x, 9000); assert.equal(store.snapshot()[0].initialized, true);
});

test("fresh real-screen adaptation failure refuses before changing any camera map or pan owner", () => {
  const store = createWorkspaceCameraStore(); store.activate("owned", first, { width: 900, height: 600 });
  const extreme = { center: { x: 0, y: 0 }, baseWidthMeters: 1.6e308, baseHeightMeters: 1.6e308, zoomLevel: 1 };
  assert.ok(viewportForScreen(extreme, { width: 100, height: 100 })); assert.equal(viewportForScreen(extreme, { width: 900, height: 600 }), null);
  const before = store.snapshot(), ticket = store.ticket(), plan = store.stage([entry("owned", extreme)]);
  assert.throws(() => plan.apply(), /measured screen/); assert.deepEqual(store.snapshot(), before); assert.equal(store.ticket(), ticket); assert.equal(plan.isCurrent(), false);
});

type Slot = { kind: string; value: any; dependencies?: readonly unknown[]; cleanup?: () => void; run?: () => void | (() => void) };
let activeFixture: ComponentFixture | null = null;
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
/** Executes the actual hook/Frame and ordered layout effects. Mounting/layout are
 * simulated; this does not qualify a browser/native renderer or visible paint. */
class ComponentFixture {
  slots: Slot[] = []; cursor = 0; changed = false; layouts: Array<() => void> = []; output: any;
  constructor(public component: (props: any) => any, public props: any) {}
  slot(kind: string, initialize: () => any): Slot { const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = { kind, value: initialize() };
    assert.equal(this.slots[index].kind, kind); return this.slots[index]; }
  render(overrides = {}): this { this.props = { ...this.props, ...overrides };
    for (let pass = 0; pass < 12; pass++) {
      this.cursor = 0; this.layouts = []; this.changed = false; activeFixture = this;
      try { this.output = this.component(this.props); } finally { activeFixture = null; }
      this.layouts.forEach(run => run()); if (!this.changed) return this;
    } throw new Error("Camera component layout effects did not settle."); }
  dispose(): void { this.slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); }
  restartEffects(): void {
    this.slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; });
    this.slots.forEach(slot => { if (slot.run) { const cleanup = slot.run(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; } });
    this.render();
  }
}
const effect = (run: () => void | (() => void), dependencies?: readonly unknown[]) => {
  assert(activeFixture); const owner = activeFixture, slot = owner.slot("layout", () => undefined); slot.run = run;
  if (!sameDependencies(slot.dependencies, dependencies)) { owner.layouts.push(() => { slot.cleanup?.(); const cleanup = run(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; }); slot.dependencies = dependencies; }
};
const hooks = { ...React,
  useState<T>(initial: T | (() => T)) { assert(activeFixture); const owner = activeFixture, slot = owner.slot("state", () => typeof initial === "function" ? (initial as () => T)() : initial);
    return [slot.value as T, (value: T | ((old: T) => T)) => { const next = typeof value === "function" ? (value as (old: T) => T)(slot.value) : value;
      if (!Object.is(next, slot.value)) { slot.value = next; owner.changed = true; } }] as const; },
  useRef<T>(initial: T) { assert(activeFixture); return activeFixture.slot("ref", () => ({ current: initial })).value as { current: T }; },
  useMemo<T>(factory: () => T, dependencies?: readonly unknown[]) { assert(activeFixture); const slot = activeFixture.slot("memo", () => undefined);
    if (!sameDependencies(slot.dependencies, dependencies)) { slot.value = factory(); slot.dependencies = dependencies; } return slot.value as T; },
  useCallback<T extends (...args: any[]) => any>(callback: T, dependencies?: readonly unknown[]): T { return hooks.useMemo(() => callback, dependencies); },
  useLayoutEffect: effect,
};
const require = createRequire(import.meta.url), reactId = require.resolve("react"), nativeId = require.resolve("react-native"), hookId = require.resolve("./useWorkspaceMapCamera.ts"), frameId = require.resolve("./WorkspaceMapFrame.tsx");
const originalReact = require.cache[reactId], originalNative = require.cache[nativeId], originalHook = require.cache[hookId], originalFrame = require.cache[frameId];
let actualHook: typeof import("./useWorkspaceMapCamera")["useWorkspaceMapCamera"], actualFrame: typeof import("./WorkspaceMapFrame")["WorkspaceMapFrame"];
try {
  require.cache[reactId] = { ...originalReact, exports: hooks } as any;
  require.cache[nativeId] = { exports: { Platform: { OS: "web" }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View", StyleSheet: { create: (value: unknown) => value } } } as any;
  delete require.cache[hookId]; delete require.cache[frameId];
  actualHook = require(hookId).useWorkspaceMapCamera; actualFrame = require(frameId).WorkspaceMapFrame;
} finally {
  if (originalReact) require.cache[reactId] = originalReact; else delete require.cache[reactId];
  if (originalNative) require.cache[nativeId] = originalNative; else delete require.cache[nativeId];
  if (originalHook) require.cache[hookId] = originalHook; else delete require.cache[hookId];
  if (originalFrame) require.cache[frameId] = originalFrame; else delete require.cache[frameId];
}

test("actual hook exposes one live handle, restores after fresh source activation, updates existing viewport silently and retires old setters", () => {
  let handle: WorkspaceCameraRecoveryHandle | null = null; const availability: Array<WorkspaceCameraRecoveryHandle | null> = [], reports: MapViewport[] = [];
  const callback = (value: WorkspaceCameraRecoveryHandle | null) => { availability.push(value); handle = value; };
  const fixture = new ComponentFixture(props => actualHook(props.contextKey, props.bounds, props.screen, props.onCameraChange, props.onRecoveryCameraHandle),
    { contextKey: "old", bounds: first, screen: size, onCameraChange: (value: MapViewport) => reports.push(value), onRecoveryCameraHandle: callback }).render();
  assert(handle); const live = handle as WorkspaceCameraRecoveryHandle, oldSetter = fixture.output.setViewport;
  const plan = live.stage([entry("old", camera(1, 2)), entry("target", camera(8000, 9000))]);
  fixture.render({ contextKey: "target", screen: { width: 400, height: 700 }, bounds: { minX: -100, minY: -100, maxX: 0, maxY: 0 } });
  assert.equal(plan.isCurrent(), true); plan.apply(); fixture.render();
  assert.deepEqual(fixture.output.viewport, viewportForScreen(camera(8000, 9000), { width: 400, height: 700 }));
  assert.equal(fixture.output.recoveryGeneration, 1); assert.deepEqual(reports, []); assert.equal(availability.length, 1);
  oldSetter(camera(-1, -2)); fixture.render(); assert.deepEqual(reports, []); assert.equal(fixture.output.viewport.center.x, 8000);
  const changed = live.stage(live.snapshot()); fixture.output.setViewport(fixture.output.viewport); fixture.render(); assert.equal(changed.isCurrent(), false); assert.equal(reports.length, 1);
  fixture.dispose(); assert.equal(availability.at(-1), null); assert.throws(() => live.stage(live.snapshot()));
});

test("actual camera hook lifetime restart invalidates old plans while source/callback bookkeeping leaves live plans intact", () => {
  const handles: Array<WorkspaceCameraRecoveryHandle | null> = [], firstCallback = (value: WorkspaceCameraRecoveryHandle | null) => handles.push(value);
  const fixture = new ComponentFixture(props => actualHook(props.contextKey, null, props.screen, undefined, props.onRecoveryCameraHandle),
    { contextKey: "field", screen: size, onRecoveryCameraHandle: firstCallback }).render();
  const handle = handles[0]!, plan = handle.stage([entry("field")]), secondAvailability: Array<WorkspaceCameraRecoveryHandle | null> = [];
  fixture.render({ onRecoveryCameraHandle: (value: WorkspaceCameraRecoveryHandle | null) => secondAvailability.push(value), screen: { width: 400, height: 500 } });
  assert.equal(plan.isCurrent(), true); assert.equal(handles.at(-1), null); assert.strictEqual(secondAvailability[0], handle);
  fixture.restartEffects(); assert.equal(plan.isCurrent(), false); const fresh = handle.stage([entry("field")]); assert.equal(fresh.isCurrent(), true); fixture.dispose(); assert.equal(fresh.isCurrent(), false);
});

function scene() {
  const draft: DesignDraft = { id: "draft", name: "Source", projectCrs: "EPSG:32613", unitSystem: "metric", settings: defaultProjectSettings(),
    fieldBoundary: [{ x: 1000, y: 2000 }, { x: 1500, y: 2000 }, { x: 1000, y: 2400 }], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
  return workspaceMapSceneFromDraft(draft, { id: "source", generation: 0 });
}
test("actual sole Frame forwards recovery availability and renews canvas gesture generation without source/point/selection events", () => {
  const source = scene(), sourceBytes = JSON.stringify(source), calls: WorkspaceCanvasProps[] = [], availability: Array<WorkspaceCameraRecoveryHandle | null> = [];
  let points = 0, selections = 0, changes = 0;
  const props: WorkspaceMapFrameProps = { scene: source, settings: defaultAppSettings(), cameraContextKey: "field-owner", interactionKey: "design-owner",
    onPoint: () => points++, onSelect: () => selections++, onCameraChange: () => changes++, onRecoveryCameraHandle: value => availability.push(value),
    renderCanvas: value => { calls.push(value); return null; } };
  const fixture = new ComponentFixture(actualFrame, props).render();
  fixture.output.props.onLayout({ nativeEvent: { layout: { width: 900, height: 600 } } }); fixture.render();
  const handle = availability[0]!, key = JSON.stringify([props.cameraContextKey, source.identity.projectCrs]), before = calls.at(-1)!;
  assert.equal(handle.snapshot()[0].contextKey, key);
  const plan = handle.stage([entry(key, camera(6000, 7000))]); plan.apply(); fixture.render();
  const after = calls.at(-1)!; assert.deepEqual(after.viewport, viewportForScreen(camera(6000, 7000), { width: 900, height: 600 }));
  assert(after.cameraCommandGeneration > before.cameraCommandGeneration); assert.strictEqual(after.scene, source); assert.equal(JSON.stringify(source), sourceBytes);
  assert.equal(points, 0); assert.equal(selections, 0); assert.equal(changes, 0); assert.equal(availability.length, 1);
  fixture.dispose(); assert.equal(availability.at(-1), null);
});
