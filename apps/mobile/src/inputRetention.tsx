import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { WorkspaceRecoveryInputs } from "./workspace/workspaceEditRecovery";

export interface InputRecoveryAdmission { readonly kind: "input-recovery-admission" }

export interface InputRetentionControls {
  hasDirty(): boolean;
  markClean(key: string): void;
  reset(): void;
}
export interface InputRetentionBaseline<T> {
  readonly fingerprint: string;
  readonly value: T;
}
export interface InputRetentionScopeOwner {
  readonly scope: string;
  readonly generation: number;
}
export interface RetainedInputFocus {
  readonly key: string;
  readonly selection?: { readonly start: number; readonly end: number };
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
  private readonly changeListeners = new Set<() => void>();
  private readonly userInputListeners = new Set<() => void>();
  private readonly recoveryListeners = new Set<() => void>();
  private revision = 0;
  private generation = 0;
  private readonly scopeGenerations = new Map<string, number>();
  private readonly scopeListeners = new Map<string, Set<() => void>>();
  private readonly sourceGenerations = new Map<string, number>();
  private focus: RetainedInputFocus | null = null;
  private operatorInputOwner: object = Object.freeze({});
  private readonly recoveredKeys = new Set<string>();
  private readonly recoveryAdmissions = new WeakMap<InputRecoveryAdmission, { generation: number; revision: number;
    focusOwner: RetainedInputFocus | null; inputOwner: object; snapshot: WorkspaceRecoveryInputs }>();

  snapshotRecovery = (): WorkspaceRecoveryInputs => freezeJson(JSON.parse(stableJson({
    entries: [...this.entries].map(([key, entry]) => ({ key, baselineFingerprint: entry.baselineFingerprint,
      cleanFingerprint: entry.cleanFingerprint, value: entry.value })), focus: this.focus,
  }))) as WorkspaceRecoveryInputs;

  /** Validate the whole batch without changing any value or serialized ownership. */
  stageRecovery = (input: WorkspaceRecoveryInputs): InputRecoveryAdmission => {
    const snapshot = validateInputRecovery(input);
    const admission = Object.freeze({ kind: "input-recovery-admission" as const });
    this.recoveryAdmissions.set(admission, { generation: this.generation, revision: this.revision,
      focusOwner: this.focus, inputOwner: this.operatorInputOwner, snapshot });
    return admission;
  };

  restoreRecovery = (admission: InputRecoveryAdmission): void => {
    const prepared = this.recoveryAdmissions.get(admission);
    this.recoveryAdmissions.delete(admission);
    if (!prepared || prepared.generation !== this.generation || prepared.revision !== this.revision
      || prepared.focusOwner !== this.focus || prepared.inputOwner !== this.operatorInputOwner)
      throw new Error("The input recovery review changed. Review it again before restoring.");
    const restored = new Map<string, RetainedEntry>();
    for (const entry of prepared.snapshot.entries) {
      const fresh = this.entries.get(entry.key);
      const value = createInputRetentionBaseline(entry.value);
      const baselineFingerprint = fresh?.baselineFingerprint ?? entry.baselineFingerprint;
      restored.set(entry.key, { baselineFingerprint, cleanFingerprint: baselineFingerprint,
        valueFingerprint: value.fingerprint, value: value.value,
        // A parked key has no freshly observed baseline and cannot claim Apply.
        dirty: !fresh || value.fingerprint !== baselineFingerprint });
    }
    const changed = new Set([...this.entries.keys(), ...restored.keys(), ...this.listeners.keys()]);
    this.entries.clear(); restored.forEach((value, key) => this.entries.set(key, value));
    this.recoveredKeys.clear(); restored.forEach((_, key) => this.recoveredKeys.add(key));
    this.generation++; this.scopeGenerations.clear(); this.sourceGenerations.clear();
    this.focus = prepared.snapshot.focus;
    this.emitChange();
    this.resetListeners.forEach(listener => listener());
    changed.forEach(key => this.emit(key));
    this.scopeListeners.forEach(listeners => listeners.forEach(listener => listener()));
  };

  /** A monotonic snapshot detects raw-input changes even when values return to their earlier bytes. */
  getRevision = (): number => this.revision;
  /** Operator setters are distinct from reconciliation, reset and Save acknowledgement. */
  subscribeUserInput = (listener: () => void): (() => void) => {
    this.userInputListeners.add(listener);
    return () => { this.userInputListeners.delete(listener); };
  };
  subscribeChanges = (listener: () => void): (() => void) => {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  };
  /** Recovery observes caret/focus as well as values without changing edit revisions. */
  subscribeRecoveryChanges = (listener: () => void): (() => void) => {
    this.recoveryListeners.add(listener);
    return () => { this.recoveryListeners.delete(listener); };
  };
  getGeneration = (): number => this.generation;
  subscribeReset = (listener: () => void): (() => void) => {
    this.resetListeners.add(listener);
    return () => { this.resetListeners.delete(listener); };
  };
  getScopeGeneration = (scope: string): number => this.scopeGenerations.get(scope) ?? 0;
  getSourceGeneration = (key: string): number => this.sourceGenerations.get(key) ?? 0;
  subscribeScope = (scope: string, listener: () => void): (() => void) => {
    let listeners = this.scopeListeners.get(scope);
    if (!listeners) { listeners = new Set(); this.scopeListeners.set(scope, listeners); }
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.scopeListeners.delete(scope); };
  };
  /** Discard one panel's inputs, including inactive entries, and retire its old setters. */
  resetScope = (scope: string): void => {
    if (!scope || scope.endsWith("/")) throw new Error("Input retention scope requires a nonempty address without a trailing slash.");
    this.scopeGenerations.set(scope, this.getScopeGeneration(scope) + 1);
    const belongs = (key: string) => key === scope || key.startsWith(`${scope}/`);
    const changed = new Set([...this.entries.keys(), ...this.listeners.keys()].filter(belongs));
    changed.forEach(key => { this.entries.delete(key); this.recoveredKeys.delete(key); });
    if (this.focus && belongs(this.focus.key)) this.focus = null;
    this.emitChange();
    this.scopeListeners.get(scope)?.forEach(listener => listener());
    changed.forEach(key => this.emit(key));
  };
  recordFocus = (key: string, generation = this.generation, owner?: InputRetentionScopeOwner): void => {
    if (!this.ownerIsCurrent(generation, owner)) return;
    this.focus = Object.freeze({ key, ...(this.focus?.key === key && this.focus.selection ? { selection: this.focus.selection } : {}) });
    this.recoveryListeners.forEach(listener => listener());
  };
  recordSelection = (key: string, selection: { start: number; end: number }, generation = this.generation, owner?: InputRetentionScopeOwner): void => {
    if (!this.ownerIsCurrent(generation, owner) || this.focus?.key !== key) return;
    if (!Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end) || selection.start < 0 || selection.end < selection.start) return;
    this.focus = Object.freeze({ key, selection: Object.freeze({ ...selection }) });
    this.recoveryListeners.forEach(listener => listener());
  };
  retainedFocus = (): RetainedInputFocus | null => this.focus;
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
    return current && (current.baselineFingerprint === baseline.fingerprint || this.recoveredKeys.has(key)) ? current.value as T : baseline.value;
  }
  /** Commit the rendered source in an effect, never by publishing during React render. */
  reconcile<T>(key: string, baseline: InputRetentionBaseline<T>, generation = this.generation, owner?: InputRetentionScopeOwner, sourceGeneration?: number): void {
    if (!this.ownerIsCurrent(generation, owner) || (sourceGeneration !== undefined && sourceGeneration !== this.getSourceGeneration(key))) return;
    const previous = this.entries.get(key);
    if (previous && this.recoveredKeys.has(key)) {
      this.recoveredKeys.delete(key);
      const restored = { ...previous, baselineFingerprint: baseline.fingerprint, cleanFingerprint: baseline.fingerprint,
        dirty: previous.valueFingerprint !== baseline.fingerprint };
      if (previous.baselineFingerprint !== baseline.fingerprint) this.sourceGenerations.set(key, this.getSourceGeneration(key) + 1);
      this.entries.set(key, restored);
      if (previous.baselineFingerprint !== restored.baselineFingerprint || previous.cleanFingerprint !== restored.cleanFingerprint || previous.dirty !== restored.dirty) {
        this.emitChange(); this.emit(key);
      }
      return;
    }
    if (previous?.baselineFingerprint === baseline.fingerprint) return;
    if (previous) this.sourceGenerations.set(key, this.getSourceGeneration(key) + 1);
    this.entries.set(key, { baselineFingerprint: baseline.fingerprint, cleanFingerprint: baseline.fingerprint, valueFingerprint: baseline.fingerprint, value: baseline.value, dirty: false });
    this.emitChange();
    this.emit(key);
  }
  set<T>(key: string, baseline: InputRetentionBaseline<T>, update: SetStateAction<T>, generation = this.generation, owner?: InputRetentionScopeOwner, sourceGeneration?: number): void {
    if (!this.ownerIsCurrent(generation, owner) || (sourceGeneration !== undefined && sourceGeneration !== this.getSourceGeneration(key))) return;
    const current = this.entries.get(key);
    // A delayed callback from a replaced source cannot revive its earlier form values.
    if (current && current.baselineFingerprint !== baseline.fingerprint) return;
    this.operatorInputOwner = Object.freeze({});
    this.userInputListeners.forEach(listener => listener());
    const previous = current ? current.value as T : baseline.value;
    const next = createInputRetentionBaseline(typeof update === "function" ? (update as (value: T) => T)(previous) : update);
    if (current?.valueFingerprint === next.fingerprint) return;
    const cleanFingerprint = current?.cleanFingerprint ?? baseline.fingerprint;
    this.entries.set(key, { baselineFingerprint: baseline.fingerprint, cleanFingerprint, valueFingerprint: next.fingerprint,
      value: next.value, dirty: next.fingerprint !== cleanFingerprint });
    this.emitChange();
    this.emit(key);
  }
  hasDirty = (): boolean => [...this.entries.values()].some(entry => entry.dirty);
  /** Accepted input may differ in shape from canonical source; retain it as the new clean value. */
  markClean = (key: string): void => {
    const current = this.entries.get(key);
    if (!current || !current.dirty) return;
    this.entries.set(key, { ...current, cleanFingerprint: current.valueFingerprint, dirty: false });
    this.emitChange();
  };
  reset = (): void => {
    this.entries.clear();
    this.recoveredKeys.clear();
    this.generation++;
    this.scopeGenerations.clear();
    this.sourceGenerations.clear();
    this.focus = null;
    this.emitChange();
    // The generation also rerenders clean mounted fields, replacing their stale setter owners.
    this.resetListeners.forEach(listener => listener());
    this.listeners.forEach(listeners => listeners.forEach(listener => listener()));
    this.scopeListeners.forEach(listeners => listeners.forEach(listener => listener()));
  };
  private ownerIsCurrent(generation: number, owner?: InputRetentionScopeOwner): boolean {
    return generation === this.generation && (!owner || owner.generation === this.getScopeGeneration(owner.scope));
  }
  private emitChange(): void {
    this.revision++;
    this.changeListeners.forEach(listener => listener());
    this.recoveryListeners.forEach(listener => listener());
  }
  private emit(key: string): void { this.listeners.get(key)?.forEach(listener => listener()); }
}

const InputRetentionContext = createContext<InputRetentionStore | null>(null);
const InputRetentionAdmissionContext = createContext<(() => boolean) | null>(null);

/** Presentation admission only; this provider owns no values or store. Its
 * closure captures the enclosing pane's literal source/interaction owner. */
export function InputRetentionAdmissionProvider({ children, isCurrent }: {
  children: React.ReactNode; isCurrent: () => boolean;
}): React.JSX.Element {
  return <InputRetentionAdmissionContext.Provider value={isCurrent}>{children}</InputRetentionAdmissionContext.Provider>;
}

function applyRetainedInputUpdate<T>(store: InputRetentionStore, key: string, baseline: InputRetentionBaseline<T>,
  update: SetStateAction<T>, generation: number, owner: InputRetentionScopeOwner | undefined,
  sourceGeneration: number, admission: (() => boolean) | null = null): void {
  if (admission && !admission()) return;
  store.set(key, baseline, update, generation, owner, sourceGeneration);
}

export function InputRetentionProvider({ children, store }: { children: React.ReactNode; store?: InputRetentionStore }): React.JSX.Element {
  const fallback = useRef<InputRetentionStore | null>(null);
  if (!store && !fallback.current) fallback.current = new InputRetentionStore();
  return <InputRetentionContext.Provider value={store ?? fallback.current!}>{children}</InputRetentionContext.Provider>;
}

export function useOptionalInputRetentionStore(): InputRetentionStore | null { return useContext(InputRetentionContext); }
export function useInputRetentionStore(): InputRetentionStore { return useStore(); }

export function useInputRetentionScopeGeneration(scope: string): number {
  const store = useStore();
  const subscribe = useCallback((listener: () => void) => store.subscribeScope(scope, listener), [store, scope]);
  const read = useCallback(() => store.getScopeGeneration(scope), [store, scope]);
  return useSyncExternalStore(subscribe, read, read);
}

export function useInputRetention(): InputRetentionControls {
  return useStore();
}

/** Keys identify one form input within the active project; callers must avoid duplicate owners. */
export function useRetainedInput<T>(key: string, source: T, scope?: string): [T, Dispatch<SetStateAction<T>>] {
  const store = useStore();
  const admission = useContext(InputRetentionAdmissionContext);
  const fingerprint = stableJson(source);
  const baseline = useMemo(() => createInputRetentionBaseline(source), [fingerprint]);
  const generation = useSyncExternalStore(store.subscribeReset, store.getGeneration, store.getGeneration);
  const scopeGeneration = useInputRetentionScopeGeneration(scope ?? "");
  const owner = useMemo(() => scope === undefined ? undefined : { scope, generation: scopeGeneration }, [scope, scopeGeneration]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [store, key]);
  const readSourceGeneration = useCallback(() => store.getSourceGeneration(key), [store, key]);
  const sourceGeneration = useSyncExternalStore(subscribe, readSourceGeneration, readSourceGeneration);
  const read = useCallback(() => store.read(key, baseline), [store, key, baseline]);
  const value = useSyncExternalStore(subscribe, read, read);
  useEffect(() => { store.reconcile(key, baseline, generation, owner, sourceGeneration); }, [store, key, baseline, generation, owner, sourceGeneration]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    applyRetainedInputUpdate(store, key, baseline, update, generation, owner, sourceGeneration, admission);
  }, [store, key, baseline, generation, owner, sourceGeneration, admission]);
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
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string"
        || key !== "length" && !(/^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length)))
        throw new Error("Retained inputs require plain arrays without additional properties.");
      const items: string[] = [];
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new Error("Retained inputs cannot contain sparse arrays.");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))!;
        if (!Object.hasOwn(descriptor, "value")) throw new Error("Retained inputs cannot contain computed properties.");
        items.push(stableJson(descriptor.value, ancestors));
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

function validateInputRecovery(input: WorkspaceRecoveryInputs): WorkspaceRecoveryInputs {
  // stableJson rejects accessors, cycles and non-JSON values before touching state.
  const snapshot = JSON.parse(stableJson(input)) as WorkspaceRecoveryInputs;
  const exactKeys = (value: object, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  if (!snapshot || typeof snapshot !== "object" || !exactKeys(snapshot, ["entries", "focus"]) || !Array.isArray(snapshot.entries) || snapshot.entries.length > 4096)
    throw new Error("Invalid input recovery snapshot.");
  const keys = new Set<string>();
  for (const entry of snapshot.entries) {
    if (!entry || typeof entry !== "object" || !exactKeys(entry, ["key", "baselineFingerprint", "cleanFingerprint", "value"])
      || typeof entry.key !== "string" || !entry.key || entry.key.length > 8192 || keys.has(entry.key)
      || typeof entry.baselineFingerprint !== "string" || typeof entry.cleanFingerprint !== "string") throw new Error("Invalid or duplicate recovered input.");
    for (const fingerprint of [entry.baselineFingerprint, entry.cleanFingerprint]) {
      if (stableJson(JSON.parse(fingerprint)) !== fingerprint) throw new Error("Invalid recovered input fingerprint.");
    }
    createInputRetentionBaseline(entry.value); keys.add(entry.key);
  }
  const focus = snapshot.focus;
  if (focus !== null) {
    if (!focus || typeof focus !== "object" || !["key", "selection"].every(key => key === "selection" || Object.hasOwn(focus, key))
      || Object.keys(focus).some(key => key !== "key" && key !== "selection") || typeof focus.key !== "string" || !focus.key || focus.key.length > 8192)
      throw new Error("Invalid recovered input focus.");
    const selection = focus.selection;
    if (selection !== undefined && (!selection || typeof selection !== "object" || !exactKeys(selection, ["start", "end"])
      || !Number.isSafeInteger(selection.start) || !Number.isSafeInteger(selection.end)
      || selection.start < 0 || selection.end < selection.start)) throw new Error("Invalid recovered input caret.");
  }
  return freezeJson(snapshot) as WorkspaceRecoveryInputs;
}

function freezeJson(value: unknown): unknown {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}
