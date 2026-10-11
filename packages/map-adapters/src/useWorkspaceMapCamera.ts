import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MapViewport } from "../../geometry/src/mapInteraction";
import { fitProjectedBounds, viewportForScreen, type MapFitBounds, type MapScreenSize } from "./mapFit";

const initialCamera = (): MapViewport => ({ center: { x: 0, y: 0 }, baseWidthMeters: 1000, baseHeightMeters: 1000, zoomLevel: 1 });
const insets = { top: 48, right: 12, bottom: 78, left: 12 };
const copy = (camera: MapViewport): MapViewport => ({ ...camera, center: { ...camera.center } });

export interface WorkspaceCameraRecoveryEntry {
  readonly contextKey: string;
  readonly viewport: MapViewport;
  /** Measured initialization is presentation bookkeeping, never visible-paint proof. */
  readonly initialized: boolean;
}
export interface WorkspaceCameraRecoveryPlan { isCurrent(): boolean; apply(): void }
export interface WorkspaceCameraRecoveryHandle {
  snapshot(): readonly WorkspaceCameraRecoveryEntry[];
  stage(snapshot: readonly WorkspaceCameraRecoveryEntry[]): WorkspaceCameraRecoveryPlan;
}

const measurable = (screen: MapScreenSize): boolean => Number.isFinite(screen.width) && Number.isFinite(screen.height) && screen.width > 0 && screen.height > 0;
function recoveryObject(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("Camera recovery requires explicit plain data.");
  const prototype = Object.getPrototypeOf(input), descriptors = Object.getOwnPropertyDescriptors(input);
  if (prototype !== Object.prototype && prototype !== null || Object.getOwnPropertySymbols(input).length
    || Object.keys(descriptors).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key))
    || Object.entries(descriptors).some(([key, value]) => !keys.includes(key) || !value.enumerable || !Object.hasOwn(value, "value"))) throw new Error("Unknown, missing or computed camera recovery fields.");
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
/** Detached admission for the actual opaque cache keys. Root maps these keys to
 * fresh field/CRS sources; no key here establishes geometry or source authority. */
function recoveryEntries(input: unknown): WorkspaceCameraRecoveryEntry[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > 128 || Object.getOwnPropertySymbols(input).length) throw new Error("Camera recovery requires a bounded camera array.");
  const descriptors = Object.getOwnPropertyDescriptors(input), keys = new Set<string>(), result: WorkspaceCameraRecoveryEntry[] = [];
  if (Object.keys(descriptors).some(key => key !== "length" && (!/^\d+$/.test(key) || String(+key) !== key || +key >= input.length))) throw new Error("Camera arrays cannot contain extra fields.");
  for (let index = 0; index < input.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("Camera arrays cannot be sparse or computed.");
    const data = recoveryObject(descriptor.value, ["contextKey", "viewport", "initialized"]), viewport = recoveryObject(data.viewport, ["center", "baseWidthMeters", "baseHeightMeters", "zoomLevel"]), center = recoveryObject(viewport.center, ["x", "y"]);
    if (typeof data.contextKey !== "string" || !data.contextKey || data.contextKey.length > 8192
      || [...data.contextKey].some(character => { const scalar = character.codePointAt(0)!; return scalar >= 0xd800 && scalar <= 0xdfff; })
      || keys.has(data.contextKey) || typeof data.initialized !== "boolean") throw new Error("Invalid or duplicate camera context/initialization.");
    const values = [center.x, center.y, viewport.baseWidthMeters, viewport.baseHeightMeters, viewport.zoomLevel];
    if (values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Camera recovery requires finite viewport values.");
    const camera: MapViewport = { center: { x: center.x as number, y: center.y as number }, baseWidthMeters: viewport.baseWidthMeters as number, baseHeightMeters: viewport.baseHeightMeters as number, zoomLevel: viewport.zoomLevel as number };
    if (!viewportForScreen(camera, { width: 100, height: 100 })) throw new Error("Camera recovery visible extent is invalid.");
    keys.add(data.contextKey); result.push({ contextKey: data.contextKey, viewport: camera, initialized: data.initialized });
  }
  return result;
}
function frozenEntries(entries: readonly WorkspaceCameraRecoveryEntry[]): readonly WorkspaceCameraRecoveryEntry[] {
  return Object.freeze(entries.map(entry => Object.freeze({ ...entry, viewport: Object.freeze({ ...entry.viewport, center: Object.freeze({ ...entry.viewport.center }) }) })));
}

/** Field/CRS context owns its camera. Revisions, mode and scene geometry are deliberately absent from identity. */
export function createWorkspaceCameraStore() {
  const cameras = new Map<string, MapViewport>();
  const initialized = new Set<string>();
  const parkedRecovery = new Set<string>();
  let active: string | null = null;
  let activeScreen: MapScreenSize = { width: 0, height: 0 };
  let epoch = 0;
  let alive = true, lifetime = Object.freeze({}), operatorOwner = Object.freeze({}), publicationOwner = Object.freeze({});
  const reviews = new WeakMap<WorkspaceCameraRecoveryPlan, { lifetime: object; operatorOwner: object; publicationOwner: object; entries: WorkspaceCameraRecoveryEntry[] }>();
  const current = (plan: WorkspaceCameraRecoveryPlan): boolean => { const review = reviews.get(plan);
    return alive && !!review && review.lifetime === lifetime && review.operatorOwner === operatorOwner && review.publicationOwner === publicationOwner; };
  return {
    activate(key: string, bounds: MapFitBounds | null, screen: MapScreenSize): MapViewport {
      if (!alive) throw new Error("The camera component lifetime ended.");
      if (active !== key) { active = key; epoch++; }
      activeScreen = { ...screen };
      let camera = cameras.get(key) ?? initialCamera();
      if (parkedRecovery.has(key) && measurable(screen)) {
        const adapted = viewportForScreen(camera, screen);
        if (!adapted) throw new Error("The recovered camera cannot fit the measured screen.");
        camera = adapted; initialized.add(key); parkedRecovery.delete(key);
      } else if (!parkedRecovery.has(key) && !initialized.has(key) && measurable(screen)) {
        const fitted = bounds ? fitProjectedBounds(bounds, screen, insets, 12) : camera;
        if (fitted) { camera = fitted; initialized.add(key); }
      }
      cameras.set(key, copy(camera)); return copy(camera);
    },
    ticket: () => epoch,
    update(key: string, camera: MapViewport, expectedEpoch: number): boolean {
      if (!alive || key !== active || expectedEpoch !== epoch || !viewportForScreen(camera, { width: 100, height: 100 })) return false;
      // Even an equal-value update is a newer admitted operator camera action.
      operatorOwner = Object.freeze({});
      cameras.set(key, copy(camera)); initialized.add(key); parkedRecovery.delete(key); return true;
    },
    fit(key: string, bounds: MapFitBounds | null, screen: MapScreenSize): MapViewport | null {
      const camera = bounds && fitProjectedBounds(bounds, screen, insets, 12);
      return camera && this.update(key, camera, epoch) ? copy(camera) : null;
    },
    snapshot(): readonly WorkspaceCameraRecoveryEntry[] {
      return frozenEntries([...cameras].map(([contextKey, viewport]) => ({ contextKey, viewport: copy(viewport), initialized: initialized.has(contextKey) })));
    },
    stage(snapshot: readonly WorkspaceCameraRecoveryEntry[]): WorkspaceCameraRecoveryPlan {
      if (!alive) throw new Error("The camera component lifetime ended.");
      const entries = recoveryEntries(snapshot);
      const plan: WorkspaceCameraRecoveryPlan = Object.freeze({ isCurrent: () => current(plan), apply: () => {
        if (!current(plan)) throw new Error("The camera recovery review is stale or already consumed.");
        const review = reviews.get(plan)!; reviews.delete(plan);
        // Source activation and resize deliberately do not retire the review.
        // Resolve its active viewport using the newly committed context/screen.
        const incoming = review.entries.map(entry => ({ ...entry, viewport: copy(entry.viewport) }));
        const selected = incoming.find(entry => entry.contextKey === active);
        if (selected && measurable(activeScreen)) {
          const adapted = viewportForScreen(selected.viewport, activeScreen);
          if (!adapted) throw new Error("The recovered camera cannot fit the measured screen.");
          selected.viewport = adapted; selected.initialized = true;
        }
        // Every validation/adaptation completes before any camera-map mutation.
        cameras.clear(); initialized.clear(); parkedRecovery.clear();
        for (const entry of incoming) { cameras.set(entry.contextKey, copy(entry.viewport));
          if (entry.initialized) initialized.add(entry.contextKey);
          if (entry !== selected || !measurable(activeScreen)) parkedRecovery.add(entry.contextKey); }
        publicationOwner = Object.freeze({}); epoch++;
      } });
      reviews.set(plan, { lifetime, operatorOwner, publicationOwner, entries }); return plan;
    },
    /** Hook lifecycle only; no serialized counter can renew a retired plan. */
    mount(): void { if (!alive) { alive = true; lifetime = Object.freeze({}); epoch++; } },
    retire(): void { alive = false; lifetime = Object.freeze({}); epoch++; },
  };
}

export function useWorkspaceMapCamera(contextKey: string, bounds: MapFitBounds | null, screen: MapScreenSize,
  onCameraChange?: (viewport: MapViewport) => void, onRecoveryCameraHandle?: (handle: WorkspaceCameraRecoveryHandle | null) => void) {
  const [store] = useState(createWorkspaceCameraStore);
  const [camera, setCamera] = useState<MapViewport>(initialCamera);
  const [ownerEpoch, setOwnerEpoch] = useState(0);
  const [recoveryGeneration, setRecoveryGeneration] = useState(0);
  const latest = useRef({ contextKey, bounds, screen, onCameraChange });
  useLayoutEffect(() => { store.mount(); return () => store.retire(); }, [store]);
  useLayoutEffect(() => { latest.current = { contextKey, bounds, screen, onCameraChange }; });
  useLayoutEffect(() => { setCamera(store.activate(contextKey, bounds, screen)); setOwnerEpoch(store.ticket()); }, [contextKey, screen.width, screen.height, store]);
  const recoveryHandle = useMemo<WorkspaceCameraRecoveryHandle>(() => Object.freeze({
    snapshot: () => store.snapshot(),
    stage(snapshot: readonly WorkspaceCameraRecoveryEntry[]) {
      const review = store.stage(snapshot);
      return Object.freeze({ isCurrent: () => review.isCurrent(), apply() {
        review.apply();
        const current = latest.current;
        const viewport = store.activate(current.contextKey, current.bounds, current.screen);
        setCamera(copy(viewport)); setOwnerEpoch(store.ticket()); setRecoveryGeneration(value => value + 1);
        // Restoration is not an operator camera event or a replayed gesture.
      } });
    },
  }), [store]);
  useLayoutEffect(() => { onRecoveryCameraHandle?.(recoveryHandle); return () => onRecoveryCameraHandle?.(null); }, [onRecoveryCameraHandle, recoveryHandle]);
  const setViewport = useCallback((next: MapViewport) => {
    if (!store.update(contextKey, next, ownerEpoch)) return;
    setCamera(copy(next)); latest.current.onCameraChange?.(copy(next));
  }, [contextKey, ownerEpoch, store]);
  const fit = useCallback(() => {
    const current = latest.current;
    const next = store.fit(current.contextKey, current.bounds, current.screen);
    if (next) { setCamera(next); current.onCameraChange?.(copy(next)); }
  }, [store]);
  return { viewport: viewportForScreen(camera, screen) ?? camera, setViewport, fit, recoveryGeneration };
}
