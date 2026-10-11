import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { defaultAppSettings, defaultProjectSettings } from "../../core/src/settings";
import { projectXyToLonLat } from "../../core/src/coordinates";
import type { DesignDraft } from "../../core/src/designDraft";
import type { MapViewport } from "../../geometry/src/mapInteraction";
import { workspaceMapSceneFromDraft } from "./workspaceMapScene";
import { workspaceSceneGeoJson } from "./workspaceSceneRendering";
import type { WorkspaceCanvasProps, WorkspaceMapFrameProps } from "./workspaceMapSurfaceTypes";

type Callback = (...args: any[]) => void;
type Slot = { kind: string; value: any; dependencies?: readonly unknown[]; cleanup?: () => void };
type Camera = { center: [number, number]; zoom: number; bearing?: number; pitch?: number };
type Bounds = [[number, number], [number, number]];
let active: CanvasFixture | null = null;
const sameDependencies = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

/** Retained hook slots execute the actual component and its ordered effects.
 * Only DOM/React mounting and renderer I/O are simulated. Coordinate conversion,
 * scene/style derivation and all source/camera control logic are production code.
 * This is a component regression test, not mounted-browser or WebGL proof. */
class CanvasFixture {
  slots: Slot[] = []; cursor = 0; changed = false;
  layouts: Callback[] = []; effects: Callback[] = [];
  node = new FakeNode(); reports: MapViewport[] = []; props: WorkspaceCanvasProps;
  component: (props: WorkspaceCanvasProps) => React.ReactElement;
  constructor(overrides: Partial<WorkspaceCanvasProps> = {}) {
    this.props = { scene: scene(), settings: defaultAppSettings(), cameraContextKey: "field-a:EPSG:32613", interactionKey: "design-a",
      viewport: { center: { x: 501000, y: 4506500 }, baseWidthMeters: 1200, baseHeightMeters: 800, zoomLevel: 1 },
      screen: { width: 900, height: 600 }, cameraCommandGeneration: 0, setViewport: camera => this.reports.push(camera), onReadout() {}, ...overrides };
    this.node.clientWidth = this.props.screen.width; this.node.clientHeight = this.props.screen.height;
    // Reach the private real canvas through the public surface's renderCanvas prop.
    const frame = WorkspaceMapSurface(this.props) as React.ReactElement<WorkspaceMapFrameProps>;
    const canvas = frame.props.renderCanvas(this.props) as React.ReactElement<WorkspaceCanvasProps>;
    this.component = canvas.type as typeof this.component;
  }
  slot(kind: string, initial: () => any): Slot {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = { kind, value: initial() };
    assert.equal(this.slots[index].kind, kind, `Hook slot ${index} changed owner`); return this.slots[index];
  }
  render(overrides: Partial<WorkspaceCanvasProps> = {}) {
    this.props = { ...this.props, ...overrides };
    for (let pass = 0; pass < 12; pass++) {
      this.cursor = 0; this.layouts = []; this.effects = []; this.changed = false; active = this;
      let tree: React.ReactElement;
      try { tree = this.component(this.props); } finally { active = null; }
      const host = find(tree!, element => element.props["data-testid"] === "workspace-map-web-renderer");
      if (host) {
        const ref = host.props.ref;
        if (typeof ref === "function") ref(this.node); else if (ref) ref.current = this.node;
      }
      this.layouts.forEach(effect => effect()); this.effects.forEach(effect => effect());
      if (!this.changed) return this;
    }
    throw new Error("Web canvas effects did not settle");
  }
  get renderer() { const found = FakeMap.instances.find(map => map.node === this.node && !map.removed); assert(found, "Renderer was not created"); return found; }
  resize(width: number, height: number) {
    this.node.clientWidth = width; this.node.clientHeight = height;
    for (const observer of FakeResizeObserver.instances) if (observer.node === this.node && !observer.disconnected) observer.callback([], observer);
    this.render({ screen: { width, height } });
  }
  dispose() { this.slots.forEach(slot => { slot.cleanup?.(); slot.cleanup = undefined; }); }
}

const effect = (kind: "layout" | "effect", run: () => void | (() => void), dependencies?: readonly unknown[]) => {
  assert(active); const owner = active, slot = owner.slot(kind, () => undefined);
  if (!sameDependencies(slot.dependencies, dependencies)) {
    (kind === "layout" ? owner.layouts : owner.effects).push(() => { slot.cleanup?.(); const cleanup = run(); slot.cleanup = typeof cleanup === "function" ? cleanup : undefined; });
    slot.dependencies = dependencies;
  }
};
const hooks = { ...React,
  useState<T>(initial: T | (() => T)) {
    assert(active); const owner = active, slot = owner.slot("state", () => typeof initial === "function" ? (initial as () => T)() : initial);
    return [slot.value as T, (value: T | ((old: T) => T)) => { const next = typeof value === "function" ? (value as (old: T) => T)(slot.value) : value;
      if (!Object.is(next, slot.value)) { slot.value = next; owner.changed = true; } }] as const;
  },
  useRef<T>(initial: T) { assert(active); return active.slot("ref", () => ({ current: initial })).value as { current: T }; },
  useMemo<T>(factory: () => T, dependencies?: readonly unknown[]) { assert(active); const slot = active.slot("memo", () => undefined);
    if (!sameDependencies(slot.dependencies, dependencies)) { slot.value = factory(); slot.dependencies = dependencies; } return slot.value as T; },
  useEffect: (run: () => void | (() => void), dependencies?: readonly unknown[]) => effect("effect", run, dependencies),
  useLayoutEffect: (run: () => void | (() => void), dependencies?: readonly unknown[]) => effect("layout", run, dependencies),
};

class FakeEvents {
  listeners = new Map<string, Set<Callback>>();
  addEventListener(name: string, callback: Callback) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name)!.add(callback); }
  removeEventListener(name: string, callback: Callback) { this.listeners.get(name)?.delete(callback); }
  emit(name: string, event: unknown = {}) { [...this.listeners.get(name) ?? []].forEach(callback => callback(event)); }
}
class FakeNode extends FakeEvents {
  clientWidth = 900; clientHeight = 600; dataset: Record<string, string> = {};
  ownerDocument = Object.assign(new FakeEvents(), { hidden: false, defaultView: new FakeEvents() });
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  contains(node: unknown) { return node === this; }
}
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  node: unknown; disconnected = false;
  constructor(public callback: Callback) { FakeResizeObserver.instances.push(this); }
  observe(node: unknown) { this.node = node; }
  disconnect() { this.disconnected = true; }
}
class FakeSource {
  data: unknown[] = [];
  constructor(public renderer: FakeMap) {}
  setData(data: unknown) { this.data.push(data); this.renderer.styleLoaded = false; return Promise.resolve(); }
}
class FakeMap extends FakeEvents {
  static instances: FakeMap[] = [];
  static holdInitialCamera = false;
  node: FakeNode; source: FakeSource | null = null; canvas = new FakeEvents(); removed = false;
  canFit = !FakeMap.holdInitialCamera;
  styleLoaded = false; styles: unknown[] = []; fits: Bounds[] = []; jumps: Camera[] = []; resizeCalls = 0;
  styleOptions: ({ diff?: boolean } | undefined)[] = [];
  center: [number, number]; zoom: number; bounds: Bounds = [[-180, -85], [180, 85]];
  proposedBounds: Bounds | null = null;
  dragPan = { disable() {}, enable() {} }; touchZoomRotate = { disable() {}, enable() {}, disableRotation() {} }; doubleClickZoom = { disable() {} };
  constructor(options: { container: FakeNode; center: [number, number]; zoom: number; style: unknown }) {
    super(); this.node = options.container; this.center = options.center; this.zoom = options.zoom; this.styles.push(options.style); FakeMap.instances.push(this);
  }
  on(name: string, callback: Callback) { this.addEventListener(name, callback); return this; }
  off(name: string, callback: Callback) { this.removeEventListener(name, callback); return this; }
  getContainer() { return this.node; } getCanvas() { return this.canvas; }
  getSource(id: string) { return id === "workspace" ? this.source : undefined; }
  isStyleLoaded() { return this.styleLoaded; } loaded() { return this.styleLoaded; }
  isMoving() { return false; } areTilesLoaded() { return this.styleLoaded; }
  getCenter() { return { lng: this.center[0], lat: this.center[1], toArray: () => [...this.center] }; }
  getZoom() { return this.zoom; } getBearing() { return 0; } getPitch() { return 0; }
  getBounds() { const [[west, south], [east, north]] = this.bounds; return { getWest: () => west, getSouth: () => south, getEast: () => east, getNorth: () => north,
    toArray: () => [[west, south], [east, north]] }; }
  cameraForBounds(bounds: Bounds) {
    if (!this.canFit) return undefined;
    this.fits.push(structuredClone(bounds)); this.proposedBounds = structuredClone(bounds);
    return { center: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2], zoom: 12 + Math.log2(Math.max(this.node.clientWidth, 1) / 900), bearing: 0 };
  }
  jumpTo(camera: Camera) { this.jumps.push(structuredClone(camera)); this.center = camera.center; this.zoom = camera.zoom;
    if (this.proposedBounds) this.bounds = structuredClone(this.proposedBounds); this.emit("move"); return this; }
  setStyle(style: unknown, options?: { diff?: boolean }) {
    this.styles.push(style); this.styleOptions.push(options); this.styleLoaded = false;
    // MapLibre's default successful diff retains unchanged source objects and
    // emits style.load synchronously. The full replacement path is asynchronous.
    if (this.source && options?.diff !== false) {
      const data = (style as { sources?: { workspace?: { data?: unknown } } }).sources?.workspace?.data;
      if (data) this.source.setData(data);
      this.emit("style.load");
    } else this.source = null;
    return this;
  }
  styleLoad(replace = true) { if (replace || !this.source) this.source = new FakeSource(this); this.styleLoaded = false; this.emit("style.load"); return this.source!; }
  idle() { this.styleLoaded = true; this.emit("idle"); }
  resize() { this.resizeCalls++; this.emit("move"); return this; }
  stop() { return this; } remove() { this.removed = true; }
  triggerRepaint() {}
  unproject(point: [number, number]) {
    const [[west, south], [east, north]] = this.bounds;
    return { lng: west + point[0] / this.node.clientWidth * (east - west), lat: north - point[1] / this.node.clientHeight * (north - south) };
  }
  queryRenderedFeatures() { return [{ properties: { address: "synthetic-rendered-feature" } }]; }
}

const require = createRequire(import.meta.url), loader = require("node:module") as { _load: (name: string, parent: unknown, isMain: boolean) => any };
const originalLoad = loader._load;
loader._load = function(name, parent, isMain) {
  if (name === "react") return hooks;
  if (name === "./maplibreRuntime.web") return { maplibregl: { Map: FakeMap }, maplibreErrorMessage: (error: Error) => error.message };
  if (name === "./pmtilesProtocol.web") return { registerPmtilesProtocolOnce() {} };
  if (name === "./WorkspaceMapFrame") return { WorkspaceMapFrame: "synthetic-frame-boundary" };
  if (name === "./WorkspaceSvgCanvas") return { WorkspaceSvgCanvas: "synthetic-svg-boundary" };
  return originalLoad(name, parent, isMain);
};
let WorkspaceMapSurface: typeof import("./WorkspaceMapSurface.web")["WorkspaceMapSurface"];
try { ({ WorkspaceMapSurface } = require("./WorkspaceMapSurface.web")); } finally { loader._load = originalLoad; }

function find(tree: React.ReactNode, predicate: (node: React.ReactElement<Record<string, any>>) => boolean): React.ReactElement<Record<string, any>> | null {
  if (Array.isArray(tree)) { for (const child of tree) { const result = find(child, predicate); if (result) return result; } return null; }
  if (!React.isValidElement<Record<string, any>>(tree)) return null;
  return predicate(tree) ? tree : find(tree.props.children, predicate);
}
function scene(offset = 0) {
  const settings = defaultProjectSettings();
  const draft: DesignDraft = { id: "draft", name: "Real projected geometry", projectCrs: "EPSG:32613", unitSystem: settings.unitSystem, settings,
    fieldBoundary: [{ x: 500600 + offset, y: 4506100 }, { x: 501400 + offset, y: 4506100 }, { x: 501400 + offset, y: 4506900 }],
    pivotCenter: { x: 501000 + offset, y: 4506500 }, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
  return workspaceMapSceneFromDraft(draft, { id: "field-a", generation: 1 });
}
function expectedBounds(props: WorkspaceCanvasProps): Bounds {
  const { center, baseWidthMeters, baseHeightMeters, zoomLevel } = props.viewport;
  const sw = projectXyToLonLat({ x: center.x - baseWidthMeters / zoomLevel / 2, y: center.y - baseHeightMeters / zoomLevel / 2 }, props.scene.identity.projectCrs!);
  const ne = projectXyToLonLat({ x: center.x + baseWidthMeters / zoomLevel / 2, y: center.y + baseHeightMeters / zoomLevel / 2 }, props.scene.identity.projectCrs!);
  return [[sw.longitude, sw.latitude], [ne.longitude, ne.latitude]];
}
function withFixture(run: (fixture: CanvasFixture) => void, overrides: Partial<WorkspaceCanvasProps> = {}) {
  const originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
  const fixture = new CanvasFixture(overrides);
  try { run(fixture); } finally { fixture.dispose(); FakeMap.holdInitialCamera = false; globalThis.ResizeObserver = originalObserver; }
}

test("actual canvas flushes available GeoJSON and drives projected camera while style workers remain pending", () => {
  withFixture(fixture => {
    fixture.render(); const renderer = fixture.renderer;
    const source = renderer.styleLoad();
    assert.equal(renderer.isStyleLoaded(), false, "Worker/source loading must not be disguised as readiness");
    assert.equal(source.data.length, 1, "Existing source must receive current geometry despite pending tiles");
    assert.deepEqual(source.data[0], workspaceSceneGeoJson(fixture.props.scene));
    assert(renderer.jumps.length > 0, "Pending source workers must not leave the renderer at constructor zoom zero");
    assert.deepEqual(renderer.fits.at(-1), expectedBounds(fixture.props));
    assert.equal(renderer.jumps.at(-1)!.zoom, 12);
    assert.equal(fixture.reports.length, 0, "Programmatic drive must not feed back as an operator camera");
    for (let i = 0; i < 3; i++) { renderer.emit("style.load"); renderer.idle(); fixture.render(); }
    assert.equal(source.data.length, 1, "Identical source/data pair is not repeatedly flushed by load/idle/render");
  });
});

test("source absence defers data; replacement style source receives latest scene exactly once", () => {
  withFixture(fixture => {
    fixture.render(); const renderer = fixture.renderer;
    const first = renderer.styleLoad(); assert.equal(first.data.length, 1);
    fixture.render({ settings: { ...fixture.props.settings, aerialImagery: { mode: "off" } } });
    assert.equal(renderer.source, null, "Simulated style swap removes its source before style.load");
    const nextScene = scene(25); fixture.render({ scene: nextScene });
    assert.equal(first.data.length, 1, "Retired source must not receive data destined for the replacement");
    const replacement = renderer.styleLoad();
    assert.notEqual(replacement, first); assert.equal(replacement.data.length, 1);
    assert.deepEqual(replacement.data[0], workspaceSceneGeoJson(nextScene));
    renderer.emit("style.load"); renderer.idle(); fixture.render();
    assert.equal(replacement.data.length, 1);
    fixture.render({ scene: scene(50) });
    assert.equal(replacement.data.length, 2, "New data identity must be admitted even when setData made the source pending");
    assert.deepEqual(replacement.data[1], workspaceSceneGeoJson(fixture.props.scene));
  });
});

test("startup world move cannot override requested XY; resize, viewport and context reach the renderer", () => {
  withFixture(fixture => {
    // Simulate a constructor transform that cannot fit until its first resize,
    // while React has already reported positive screen dimensions.
    FakeMap.holdInitialCamera = true;
    fixture.render(); const renderer = fixture.renderer; FakeMap.holdInitialCamera = false;
    renderer.styleLoaded = true; renderer.emit("move");
    assert.equal(fixture.reports.length, 0, "World camera feedback is excluded before a requested camera is successfully applied");
    renderer.canFit = true; fixture.resize(900, 600); renderer.styleLoad();
    assert(renderer.jumps.length > 0); assert.deepEqual(renderer.fits.at(-1), expectedBounds(fixture.props));
    let previous = renderer.fits.length;
    fixture.render({ viewport: { ...fixture.props.viewport, center: { x: 502000, y: 4507500 }, zoomLevel: 2 } });
    assert(renderer.fits.length > previous); assert.deepEqual(renderer.fits.at(-1), expectedBounds(fixture.props));
    previous = renderer.fits.length; fixture.resize(1200, 600);
    assert(renderer.resizeCalls > 0); assert(renderer.fits.length > previous, "Positive resize must recompute renderer camera even when viewport object is retained");
    previous = renderer.fits.length;
    fixture.render({ cameraContextKey: "field-b:EPSG:32613", interactionKey: "survey-b" });
    assert(renderer.fits.length > previous, "New camera owner must apply its current request even when numerical bounds match");
    assert.deepEqual(renderer.fits.at(-1), expectedBounds(fixture.props));
  });
});

test("requested/applied diagnostics settle only after idle and refer to actual renderer camera", () => {
  withFixture(fixture => {
    fixture.render(); const renderer = fixture.renderer; renderer.styleLoad();
    const data = fixture.node.dataset;
    assert(data.mapRequestedCamera, "Requested camera must be captured separately from projected readout text");
    assert.equal(data.mapAppliedCamera, data.mapRequestedCamera);
    assert.equal(data.mapSettled, "false", "Applying a camera is not settled paint proof");
    renderer.idle(); assert.equal(data.mapSettled, "true");
    const state = JSON.parse(data.mapCameraState);
    assert(state && typeof state === "object");
    const serialized = JSON.stringify(state);
    assert(serialized.includes(String(renderer.getZoom())), "Diagnostic state includes actual zoom");
    assert(serialized.includes(String(renderer.getCenter().lng)), "Diagnostic state includes actual center");
    assert(state.bounds, "Diagnostic state includes actual renderer bounds");
    assert(state.expected, "Diagnostic state includes expected applied camera");
    const prior = data.mapRequestedCamera;
    fixture.render({ viewport: { ...fixture.props.viewport, zoomLevel: 3 } });
    assert.notEqual(data.mapRequestedCamera, prior);
    assert.equal(data.mapAppliedCamera, data.mapRequestedCamera); assert.equal(data.mapSettled, "false");
    renderer.idle(); assert.equal(data.mapSettled, "true");
    renderer.zoom -= 1; renderer.idle();
    assert.equal(data.mapSettled, "false", "Idle alone cannot declare a camera settled when actual zoom differs from the applied request");
  });
});

test("disposed renderer callbacks cannot publish camera state or diagnostics for a new owner", () => {
  withFixture(fixture => {
    fixture.render(); const renderer = fixture.renderer; renderer.styleLoad(); renderer.idle();
    const staleMove = [...renderer.listeners.get("move") ?? []], staleIdle = [...renderer.listeners.get("idle") ?? []], staleLoad = [...renderer.listeners.get("style.load") ?? []];
    const observer = FakeResizeObserver.instances.find(item => item.node === fixture.node)!;
    fixture.dispose(); assert.equal(renderer.removed, true); assert.equal(observer.disconnected, true);
    const diagnostics = { ...fixture.node.dataset }, reports = fixture.reports.length, fits = renderer.fits.length;
    renderer.center = [-100, 35]; renderer.zoom = 0;
    [...staleMove, ...staleIdle, ...staleLoad].forEach(callback => callback({})); observer.callback([], observer);
    assert.equal(fixture.reports.length, reports); assert.equal(renderer.fits.length, fits); assert.deepEqual(fixture.node.dataset, diagnostics);
    assert.equal(renderer.canvas.listeners.get("webglcontextlost")?.size ?? 0, 0);
  });
});

test("renderer lifecycle preserves canonical scene, source document and settings", () => {
  withFixture(fixture => {
    const before = structuredClone({ scene: fixture.props.scene, settings: fixture.props.settings });
    fixture.render(); const renderer = fixture.renderer; renderer.styleLoad(); renderer.idle();
    fixture.render({ viewport: { ...fixture.props.viewport, zoomLevel: 2 } }); fixture.resize(1100, 650); renderer.idle(); fixture.dispose();
    assert.deepEqual({ scene: fixture.props.scene, settings: fixture.props.settings }, before);
    assert.equal(FakeMap.instances.filter(map => map.node === fixture.node).length, 1, "Changes retain the shared renderer instance");
  });
});

test("style swap explicitly replaces style without recreating map and restores latest geometry and applied camera", () => {
  withFixture(fixture => {
    fixture.render(); const renderer = fixture.renderer, oldSource = renderer.styleLoad(); renderer.idle();
    const originalScene = structuredClone(fixture.props.scene), oldData = [...oldSource.data];
    fixture.render({ settings: { ...fixture.props.settings, aerialImagery: { mode: "off" } } });
    assert.equal(renderer.styleOptions.at(-1)?.diff, false, "Full replacement is required to avoid synchronous retained-source diff/cache races");
    assert.equal(renderer.source, null, "Replacement source must not be confused with the retired source");
    assert.equal(fixture.renderer, renderer, "Style replacement preserves the shared Map instance");
    const latest = scene(70); fixture.render({ scene: latest });
    const source = renderer.styleLoad(); renderer.idle();
    assert.notEqual(source, oldSource); assert.equal(source.data.length, 1);
    assert.deepEqual(source.data[0], workspaceSceneGeoJson(latest));
    assert.deepEqual(oldSource.data, oldData, "Retired source remains untouched after the explicit replacement");
    assert.deepEqual(renderer.fits.at(-1), expectedBounds(fixture.props));
    assert.equal(fixture.node.dataset.mapAppliedCamera, fixture.node.dataset.mapRequestedCamera);
    const state = JSON.parse(fixture.node.dataset.mapCameraState);
    assert(state.expected, "Replacement lifecycle must preserve the camera established in its load callback");
    assert.equal(fixture.node.dataset.mapSettled, "true");
    assert.deepEqual(originalScene, scene());
  });
});

test("held pointer cannot add or select after resize, requested viewport or style change; fresh click remains usable", () => {
  for (const mode of ["point", "select"] as const) for (const change of ["resize", "viewport", "style"] as const) {
    const points: unknown[] = [], selections: unknown[] = [];
    withFixture(fixture => {
      fixture.render(); const renderer = fixture.renderer; renderer.styleLoad(); renderer.idle();
      const before = structuredClone(fixture.props.scene);
      const pointer = (type: "pointerdown" | "pointerup", pointerId: number) => fixture.node.ownerDocument.defaultView.emit(type,
        { type, pointerId, isPrimary: true, button: 0, clientX: 100, clientY: 150, target: fixture.node });
      pointer("pointerdown", 10);
      if (change === "resize") fixture.resize(1100, 650);
      else if (change === "viewport") fixture.render({ viewport: { ...fixture.props.viewport, center: { x: 501040, y: 4506540 } } });
      else { fixture.render({ settings: { ...fixture.props.settings, aerialImagery: { mode: "off" } } }); renderer.styleLoad(); }
      pointer("pointerup", 10);
      assert.equal(points.length, 0, `${mode}/${change}: retired held pointer must not add a coordinate`);
      assert.equal(selections.length, 0, `${mode}/${change}: retired held pointer must not select a feature`);
      renderer.idle(); pointer("pointerdown", 11); pointer("pointerup", 11);
      assert.equal(points.length, mode === "point" ? 1 : 0, `${mode}/${change}: fresh click admits exactly one point when enabled`);
      assert.equal(selections.length, mode === "select" ? 1 : 0, `${mode}/${change}: fresh click admits exactly one selection when enabled`);
      if (mode === "point") {
        const event = points[0] as { cameraContextKey: string; point: { x: number; y: number } };
        assert.equal(event.cameraContextKey, fixture.props.cameraContextKey); assert(Number.isFinite(event.point.x)); assert(Number.isFinite(event.point.y));
      }
      assert.deepEqual(fixture.props.scene, before, "Admission callbacks do not mutate canonical scene/source geometry");
    }, { pointInputEnabled: mode === "point", onPoint: event => points.push(event), onSelect: event => selections.push(event) });
  }
});
