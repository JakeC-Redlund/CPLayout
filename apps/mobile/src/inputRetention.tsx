import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";

export interface InputRetentionControls {
  hasDirty(): boolean;
  markClean(key: string): void;
  reset(): void;
}
export interface InputRetentionBaseline<T> {
  readonly fingerprint: string;
  readonly value: T;
}
interface RetainedEntry {
  baselineFingerprint: string;
  cleanFingerprint: string;
  valueFingerprint: string;
  value: unknown;
  dirty: boolean;
}

/** Detached JSON snapshots make caller mutation unable to change a retained field or its baseline. */
export function createInputRetentionBaseline<T>(source: T): InputRetentionBaseline<T> {
  const fingerprint = stableJson(source);
  return Object.freeze({ fingerprint, value: freezeJson(JSON.parse(fingerprint)) as T });
}

/** Pure store: subscribing and unsubscribing never remove unfinished input. */
export class InputRetentionStore implements InputRetentionControls {
  private readonly entries = new Map<string, RetainedEntry>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly resetListeners = new Set<() => void>();
  private generation = 0;

  getGeneration = (): number => this.generation;
  subscribeReset = (listener: () => void): (() => void) => {
    this.resetListeners.add(listener);
    return () => { this.resetListeners.delete(listener); };
  };
  subscribe(key: string, listener: () => void): () => void {
    let listeners = this.listeners.get(key);
    if (!listeners) { listeners = new Set(); this.listeners.set(key, listeners); }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }
  read<T>(key: string, baseline: InputRetentionBaseline<T>): T {
    const current = this.entries.get(key);
    return current?.baselineFingerprint === baseline.fingerprint ? current.value as T : baseline.value;
  }
  /** Commit the rendered source in an effect, never by publishing during React render. */
  reconcile<T>(key: string, baseline: InputRetentionBaseline<T>, generation = this.generation): void {
    if (generation !== this.generation || this.entries.get(key)?.baselineFingerprint === baseline.fingerprint) return;
    this.entries.set(key, { baselineFingerprint: baseline.fingerprint, cleanFingerprint: baseline.fingerprint, valueFingerprint: baseline.fingerprint, value: baseline.value, dirty: false });
    this.emit(key);
  }
  set<T>(key: string, baseline: InputRetentionBaseline<T>, update: SetStateAction<T>, generation = this.generation): void {
    if (generation !== this.generation) return;
    const current = this.entries.get(key);
    // A delayed callback from a replaced source cannot revive its earlier form values.
    if (current && current.baselineFingerprint !== baseline.fingerprint) return;
    const previous = current ? current.value as T : baseline.value;
    const next = createInputRetentionBaseline(typeof update === "function" ? (update as (value: T) => T)(previous) : update);
    if (current?.valueFingerprint === next.fingerprint) return;
    const cleanFingerprint = current?.cleanFingerprint ?? baseline.fingerprint;
    this.entries.set(key, { baselineFingerprint: baseline.fingerprint, cleanFingerprint, valueFingerprint: next.fingerprint,
      value: next.value, dirty: next.fingerprint !== cleanFingerprint });
    this.emit(key);
  }
  hasDirty = (): boolean => [...this.entries.values()].some(entry => entry.dirty);
  /** Accepted input may differ in shape from canonical source; retain it as the new clean value. */
  markClean = (key: string): void => {
    const current = this.entries.get(key);
    if (!current) return;
    this.entries.set(key, { ...current, cleanFingerprint: current.valueFingerprint, dirty: false });
  };
  reset = (): void => {
    this.entries.clear();
    this.generation++;
    // The generation also rerenders clean mounted fields, replacing their stale setter owners.
    this.resetListeners.forEach(listener => listener());
    this.listeners.forEach(listeners => listeners.forEach(listener => listener()));
  };
  private emit(key: string): void { this.listeners.get(key)?.forEach(listener => listener()); }
}

const InputRetentionContext = createContext<InputRetentionStore | null>(null);

export function InputRetentionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const store = useRef<InputRetentionStore | null>(null);
  if (!store.current) store.current = new InputRetentionStore();
  return <InputRetentionContext.Provider value={store.current}>{children}</InputRetentionContext.Provider>;
}

export function useInputRetention(): InputRetentionControls {
  return useStore();
}

/** Keys identify one form input within the active project; callers must avoid duplicate owners. */
export function useRetainedInput<T>(key: string, source: T): [T, Dispatch<SetStateAction<T>>] {
  const store = useStore();
  const fingerprint = stableJson(source);
  const baseline = useMemo(() => createInputRetentionBaseline(source), [fingerprint]);
  const generation = useSyncExternalStore(store.subscribeReset, store.getGeneration, store.getGeneration);
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [store, key]);
  const read = useCallback(() => store.read(key, baseline), [store, key, baseline]);
  const value = useSyncExternalStore(subscribe, read, read);
  useEffect(() => { store.reconcile(key, baseline, generation); }, [store, key, baseline, generation]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    store.set(key, baseline, update, generation);
  }, [store, key, baseline, generation]);
  return [value, setValue];
}

function useStore(): InputRetentionStore {
  const store = useContext(InputRetentionContext);
  if (!store) throw new Error("Retained inputs require InputRetentionProvider around the workspace.");
  return store;
}

function stableJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== "object") throw new Error("Retained inputs require finite JSON values without undefined or functions.");
  if (ancestors.has(value)) throw new Error("Retained inputs cannot contain circular references.");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error("Retained inputs require plain JSON objects and arrays.");
  if (Object.getOwnPropertySymbols(value).length) throw new Error("Retained inputs cannot contain symbol properties.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new Error("Retained inputs cannot contain sparse arrays.");
        items.push(stableJson(value[index], ancestors));
      }
      return `[${items.join(",")}]`;
    }
    return `{${Object.keys(value).sort().flatMap(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!Object.hasOwn(descriptor, "value")) throw new Error("Retained inputs cannot contain computed properties.");
      // Optional object members follow JSON.stringify omission; array entries stay strict.
      if (descriptor.value === undefined) return [];
      return [`${JSON.stringify(key)}:${stableJson(descriptor.value, ancestors)}`];
    }).join(",")}}`;
  } finally { ancestors.delete(value); }
}

function freezeJson(value: unknown): unknown {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}
