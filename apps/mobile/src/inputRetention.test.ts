import assert from "node:assert/strict";
import type { WorkspaceRecoveryInputs } from "./workspace/workspaceEditRecovery";
import React from "react";
import { createRequire } from "node:module";
import { test } from "node:test";
import { createInputRetentionBaseline as baseline, InputRetentionStore, InputRetentionProvider, InputRetentionAdmissionProvider, useOptionalInputRetentionStore, useRetainedInput } from "./inputRetention";

test("change subscriptions observe complete literal values and a monotonic revision across raw A to B to A", () => {
  const store = new InputRetentionStore();
  const source = baseline({ text: " 120' 6\" ", spans: ["120", "unfinished", ""] });
  const changed = { text: " malformed ", spans: ["", "120", "unfinished"] };
  const snapshots: { revision: number; value: typeof source.value; dirty: boolean }[] = [];
  const { getRevision, subscribeChanges } = store;
  const unsubscribe = subscribeChanges(() => snapshots.push({ revision: getRevision(), value: store.read("draft/raw", source), dirty: store.hasDirty() }));
  let fieldRevision = 0;
  store.subscribe("draft/raw", () => { fieldRevision = getRevision(); });
  assert.equal(getRevision(), 0);
  store.reconcile("draft/raw", source);
  const savedRevision = getRevision();
  store.set("draft/raw", source, changed);
  store.set("draft/raw", source, source.value);
  assert.deepEqual(snapshots, [
    { revision: 1, value: source.value, dirty: false },
    { revision: 2, value: changed, dirty: true },
    { revision: 3, value: source.value, dirty: false },
  ]);
  assert.equal(fieldRevision, 3, "field listeners also see the committed revision");
  assert.notEqual(getRevision(), savedRevision, "returning to identical bytes must invalidate an earlier deferred read");
  assert.equal(store.getRevision, getRevision); assert.equal(store.subscribeChanges, subscribeChanges);
  unsubscribe(); store.set("draft/raw", source, changed);
  assert.equal(getRevision(), 4); assert.equal(snapshots.length, 3);
});

test("equivalent values, clean calls, pure reads, focus, caret and subscriptions do not advance revision", () => {
  const store = new InputRetentionStore(); const source = baseline({ text: "literal", spans: ["1", "2"] });
  store.reconcile("draft/raw", source);
  const revision = store.getRevision(); let changes = 0;
  const unsubscribe = store.subscribeChanges(() => changes++);
  const fieldUnsubscribe = store.subscribe("draft/raw", () => {});
  const scopeUnsubscribe = store.subscribeScope("draft", () => {});
  const resetUnsubscribe = store.subscribeReset(() => {});
  store.reconcile("draft/raw", baseline({ spans: ["1", "2"], text: "literal" }));
  store.set("draft/raw", source, { spans: ["1", "2"], text: "literal" });
  store.set("draft/raw", source, value => value);
  store.markClean("draft/raw"); store.markClean("absent");
  store.read("draft/raw", source); store.read("absent", source);
  store.recordFocus("draft/raw"); store.recordSelection("draft/raw", { start: 1, end: 4 });
  store.recordSelection("draft/raw", { start: -1, end: 4 });
  fieldUnsubscribe(); scopeUnsubscribe(); resetUnsubscribe(); unsubscribe();
  assert.equal(store.getRevision(), revision); assert.equal(changes, 0);
  assert.deepEqual(store.retainedFocus(), { key: "draft/raw", selection: { start: 1, end: 4 } });
});

test("initial setter baseline creation advances once and accepted clean text notifies after cleaning", () => {
  const store = new InputRetentionStore(); const source = baseline("120");
  const snapshots: { revision: number; value: string; dirty: boolean }[] = [];
  store.subscribeChanges(() => snapshots.push({ revision: store.getRevision(), value: store.read("draft/span", source), dirty: store.hasDirty() }));
  store.set("draft/span", source, "120");
  store.set("draft/span", source, "120");
  store.set("draft/span", source, " 120' 6\" ");
  store.markClean("draft/span"); store.markClean("draft/span");
  store.reconcile("draft/span", baseline("120"));
  assert.deepEqual(snapshots, [
    { revision: 1, value: "120", dirty: false },
    { revision: 2, value: " 120' 6\" ", dirty: true },
    { revision: 3, value: " 120' 6\" ", dirty: false },
  ]);
  store.set("draft/span", source, "130");
  store.set("draft/span", source, " 120' 6\" ");
  assert.equal(store.getRevision(), 5); assert.equal(store.hasDirty(), false);
});

test("source replacements advance once and refused source owners never execute updaters or publish changes", () => {
  const store = new InputRetentionStore(); const a = baseline("A"), b = baseline("B");
  const snapshots: { revision: number; sourceGeneration: number; value: string; dirty: boolean }[] = [];
  let renderedSource = a;
  store.subscribeChanges(() => snapshots.push({ revision: store.getRevision(), sourceGeneration: store.getSourceGeneration("draft/name"), value: store.read("draft/name", renderedSource), dirty: store.hasDirty() }));
  store.reconcile("draft/name", a);
  const oldSourceGeneration = store.getSourceGeneration("draft/name");
  store.set("draft/name", a, "unfinished");
  renderedSource = b; store.reconcile("draft/name", b);
  let executions = 0;
  const staleUpdater = () => { executions++; return "obsolete"; };
  store.set("draft/name", a, staleUpdater);
  renderedSource = a; store.reconcile("draft/name", a);
  const revision = store.getRevision();
  store.set("draft/name", a, staleUpdater, store.getGeneration(), undefined, oldSourceGeneration);
  store.reconcile("draft/name", b, store.getGeneration(), undefined, oldSourceGeneration);
  assert.equal(executions, 0); assert.equal(store.getRevision(), revision);
  assert.deepEqual(snapshots, [
    { revision: 1, sourceGeneration: 0, value: "A", dirty: false },
    { revision: 2, sourceGeneration: 0, value: "unfinished", dirty: true },
    { revision: 3, sourceGeneration: 1, value: "B", dirty: false },
    { revision: 4, sourceGeneration: 2, value: "A", dirty: false },
  ]);
  assert.throws(() => store.set("draft/name", a, undefined as unknown as string), /Retained inputs/);
  assert.equal(store.getRevision(), revision); assert.equal(snapshots.length, 4);
});

test("scope and global resets notify once after complete retirement including empty resets", () => {
  const store = new InputRetentionStore(); const source = baseline("saved");
  for (const key of ["draft/name", "draft/machine", "draftOther/name"]) {
    store.reconcile(key, source); store.set(key, source, "unfinished");
  }
  const generation = store.getGeneration(); const oldOwner = { scope: "draft", generation: store.getScopeGeneration("draft") };
  store.recordFocus("draft/name", generation, oldOwner); store.recordSelection("draft/name", { start: 1, end: 2 }, generation, oldOwner);
  const snapshots: { revision: number; generation: number; scopeGeneration: number; name: string; machine: string; other: string; dirty: boolean; focus: ReturnType<InputRetentionStore["retainedFocus"]> }[] = [];
  store.subscribeChanges(() => snapshots.push({ revision: store.getRevision(), generation: store.getGeneration(), scopeGeneration: store.getScopeGeneration("draft"),
    name: store.read("draft/name", source), machine: store.read("draft/machine", source), other: store.read("draftOther/name", source), dirty: store.hasDirty(), focus: store.retainedFocus() }));
  let localRevision = 0;
  store.subscribeScope("draft", () => { localRevision = store.getRevision(); });
  store.subscribeReset(() => { localRevision = store.getRevision(); });
  store.resetScope("draft");
  assert.deepEqual(snapshots, [{ revision: 7, generation: 0, scopeGeneration: 1, name: "saved", machine: "saved", other: "unfinished", dirty: true, focus: null }]);
  assert.equal(localRevision, 7);
  let executions = 0;
  const updater = () => { executions++; return "stale"; };
  store.set("draft/name", source, updater, generation, oldOwner);
  store.reconcile("draft/machine", baseline("obsolete"), generation, oldOwner);
  assert.equal(store.getRevision(), 7); assert.equal(executions, 0);
  const replacement = baseline("replacement"); store.reconcile("draftOther/name", replacement);
  assert.equal(store.getSourceGeneration("draftOther/name"), 1);
  store.recordFocus("draftOther/name");
  store.reset();
  assert.deepEqual(snapshots.at(-1), { revision: 9, generation: 1, scopeGeneration: 0, name: "saved", machine: "saved", other: "saved", dirty: false, focus: null });
  assert.equal(store.getSourceGeneration("draftOther/name"), 0); assert.equal(localRevision, 9);
  store.set("draftOther/name", replacement, updater, generation);
  store.reconcile("draft/name", baseline("obsolete"), generation);
  assert.equal(executions, 0); assert.equal(store.getRevision(), 9);
  store.resetScope("empty"); store.reset();
  assert.equal(store.getRevision(), 11); assert.equal(snapshots.length, 5);
  assert.throws(() => store.resetScope(""), /scope requires/);
  assert.throws(() => store.resetScope("draft/"), /scope requires/);
  assert.equal(store.getRevision(), 11); assert.equal(snapshots.length, 5);
});

test("actual retained hook refuses an obsolete pane setter before its updater can replace newer raw input", () => {
  const require = createRequire(import.meta.url);
  const { renderToStaticMarkup } = require("react-dom/server");
  const store = new InputRetentionStore(), source = baseline("original source");
  store.reconcile("project/raw-xml", source);
  let epoch = 0, allowed = true;
  let setter!: React.Dispatch<React.SetStateAction<string>>;
  function Input() { const [value, set] = useRetainedInput("project/raw-xml", "original source"); setter = set; return React.createElement("input", { value, readOnly: true }); }
  function render() {
    const captured = epoch;
    return renderToStaticMarkup(React.createElement(InputRetentionProvider, { store, children:
      React.createElement(InputRetentionAdmissionProvider, { isCurrent: () => allowed && captured === epoch, children: React.createElement(Input) }) }));
  }
  render(); const old = setter; old("before navigation");
  epoch++; allowed = false; render(); const hidden = setter;
  const hiddenRevision = store.getRevision();
  hidden(() => { throw new Error("Hidden pane updater must not run"); });
  assert.equal(store.getRevision(), hiddenRevision);
  epoch++; allowed = true; render(); setter("newer malformed XML");
  let executions = 0;
  const currentRevision = store.getRevision();
  old(() => { executions++; return "obsolete import result"; });
  assert.equal(store.getRevision(), currentRevision);
  assert.equal(executions, 0); assert.equal(store.read("project/raw-xml", source), "newer malformed XML"); assert(store.hasDirty());
  assert.equal(store.getGeneration(), 0, "pane admission never resets the shared store");
  assert.match(render(), /newer malformed XML/);
});

test("pane admission preserves same-owner callbacks across ordinary renders and absent-context standalone callers", () => {
  const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server");
  const store = new InputRetentionStore(), source = baseline("source"); store.reconcile("input", source);
  let setter!: React.Dispatch<React.SetStateAction<string>>;
  function Input() { const [value, set] = useRetainedInput("input", "source"); setter = set; return React.createElement("input", { value, readOnly: true }); }
  const render = (gated: boolean) => renderToStaticMarkup(React.createElement(InputRetentionProvider, { store, children: gated
    ? React.createElement(InputRetentionAdmissionProvider, { isCurrent: () => true, children: React.createElement(Input) }) : React.createElement(Input) }));
  render(true); const earlier = setter; render(true); earlier("same pane on a later receiver tick");
  assert.equal(store.read("input", source), "same pane on a later receiver tick");
  render(false); setter("standalone remains supported"); assert.match(render(false), /standalone remains supported/);
});

test("same-source remount retains unfinished strings and inactive dirty state", () => {
  const store = new InputRetentionStore();
  const source = baseline("120");
  store.reconcile("machine/span", source);
  const unsubscribe = store.subscribe("machine/span", () => {});
  store.set("machine/span", source, "120' 6\"");
  assert(store.hasDirty(), "dirty must update synchronously before same-event navigation");
  unsubscribe();
  assert(store.hasDirty(), "inactive input still needs discard protection");
  store.reconcile("machine/span", baseline("120"));
  assert.equal(store.read("machine/span", baseline("120")), "120' 6\"");
});

test("source changes replace the old value and baseline, and stale source setters cannot revive it", () => {
  const store = new InputRetentionStore();
  const oldSource = baseline("120");
  const nextSource = baseline("130");
  store.reconcile("span", oldSource); store.set("span", oldSource, "unfinished");
  assert.equal(store.read("span", nextSource), "130", "the new render reads new source before its effect commits");
  assert(store.hasDirty(), "a pure read must not discard the committed old input");
  store.reconcile("span", nextSource);
  assert.equal(store.read("span", nextSource), "130"); assert.equal(store.hasDirty(), false);
  store.set("span", oldSource, "late callback");
  assert.equal(store.read("span", nextSource), "130"); assert.equal(store.hasDirty(), false);
});

test("JSON-equivalent object sources retain values despite property order", () => {
  const store = new InputRetentionStore();
  const first = baseline({ name: "Pivot", lengths: ["120", "130"] });
  const reordered = baseline({ lengths: ["120", "130"], name: "Pivot" });
  store.reconcile("machine", first);
  store.set("machine", first, value => ({ ...value, name: "Unfinished machine" }));
  store.reconcile("machine", reordered);
  assert.equal(store.read("machine", reordered).name, "Unfinished machine");
  assert(store.hasDirty());
});

test("optional undefined object fields are omitted without changing the source identity", () => {
  const store = new InputRetentionStore();
  const source = baseline({ name: "draft", boundary: undefined, nested: { notes: undefined, retained: "yes" } });
  const equivalent = baseline({ name: "draft", nested: { retained: "yes" } });
  assert.equal(source.fingerprint, equivalent.fingerprint);
  assert.deepEqual(source.value, { name: "draft", nested: { retained: "yes" } });
  store.reconcile("manual", source);
  store.set("manual", source, { name: "changed", boundary: undefined, nested: { notes: undefined, retained: "yes" } });
  store.reconcile("manual", equivalent);
  assert.equal(store.read("manual", equivalent).name, "changed"); assert(store.hasDirty());
  assert.throws(() => baseline([undefined]), /Retained inputs/);
  assert.throws(() => baseline({ invalid: () => "no" }), /Retained inputs/);
  assert.throws(() => baseline({ get invalid() { throw new Error("must not invoke getter"); } }), /computed properties/);
});

test("functional updates compose synchronously and returning to baseline clears dirty", () => {
  const store = new InputRetentionStore(); const source = baseline(["a"]);
  store.reconcile("lines", source);
  store.set("lines", source, previous => [...previous, "b"]);
  store.set("lines", source, previous => [...previous, "c"]);
  assert.deepEqual(store.read("lines", source), ["a", "b", "c"]);
  assert(store.hasDirty());
  store.set("lines", source, ["a"]);
  assert.equal(store.hasDirty(), false);
});

test("accepted staged input keeps its own clean baseline independently of source", () => {
  const store = new InputRetentionStore(); const source = baseline({ length: "120" });
  const accepted = { length: "120' 6\"" };
  store.reconcile("manual/span", source); store.set("manual/span", source, accepted);
  store.markClean("manual/span");
  assert.equal(store.hasDirty(), false);
  store.reconcile("manual/span", baseline({ length: "120" }));
  assert.deepEqual(store.read("manual/span", source), accepted);
  assert.equal(store.hasDirty(), false, "same canonical source must not dirty accepted staged text");
  store.set("manual/span", source, { length: "130" }); assert(store.hasDirty());
  store.set("manual/span", source, accepted); assert.equal(store.hasDirty(), false);
  const nextSource = baseline({ length: "140" }); store.reconcile("manual/span", nextSource);
  assert.deepEqual(store.read("manual/span", nextSource), { length: "140" });
  assert.equal(store.hasDirty(), false);
  store.set("manual/span", nextSource, accepted); assert(store.hasDirty(), "actual source change replaces the prior accepted baseline");
});

test("reset clears active and inactive inputs and refuses old project callbacks", () => {
  const store = new InputRetentionStore(); const source = baseline("saved");
  const oldGeneration = store.getGeneration();
  let notifications = 0;
  store.subscribeReset(() => notifications++);
  for (const key of ["active", "inactive"]) { store.reconcile(key, source); store.set(key, source, "unfinished"); }
  store.reset();
  assert.equal(notifications, 1); assert.equal(store.hasDirty(), false);
  assert.equal(store.read("inactive", source), "saved");
  store.set("active", source, "delayed old input", oldGeneration);
  store.reconcile("inactive", baseline("old project"), oldGeneration);
  assert.equal(store.read("active", source), "saved"); assert.equal(store.hasDirty(), false);
  store.set("active", source, "new input", store.getGeneration());
  assert.equal(store.read("active", source), "new input"); assert(store.hasDirty());
});

test("input snapshots are detached and deeply frozen", () => {
  const store = new InputRetentionStore();
  const raw = { values: ["one"] }; const source = baseline(raw);
  raw.values[0] = "caller mutation";
  store.reconcile("field", source);
  assert.deepEqual(store.read("field", source), { values: ["one"] });
  const next = { values: ["two"] };
  store.set("field", source, next); next.values.push("outside");
  const snapshot = store.read("field", source);
  assert.deepEqual(snapshot, { values: ["two"] });
  assert(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.values));
});

test("equivalent writes keep snapshot identity and do not notify", () => {
  const store = new InputRetentionStore(); const source = baseline({ value: "one" });
  store.reconcile("input", source);
  let calls = 0; const unsubscribe = store.subscribe("input", () => calls++);
  const snapshot = store.read("input", source);
  store.set("input", source, { value: "one" });
  assert.equal(store.read("input", source), snapshot); assert.equal(calls, 0);
  store.set("input", source, { value: "two" }); assert.equal(calls, 1);
  unsubscribe(); store.set("input", source, { value: "three" }); assert.equal(calls, 1);
});

test("non-JSON values refuse before replacing a retained input", () => {
  const store = new InputRetentionStore(); const source = baseline("safe");
  store.reconcile("input", source); store.set("input", source, "keep me");
  for (const value of [undefined, NaN, Infinity, new Date(), [, "sparse"]]) {
    assert.throws(() => baseline(value), /Retained inputs/);
  }
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  assert.throws(() => baseline(cycle), /circular/);
  assert.equal(store.read("input", source), "keep me"); assert(store.hasDirty());
});

test("scoped panel remount retains malformed raw values and parser errors against exact section sources", () => {
  const store = new InputRetentionStore();
  const scope = '["draft-inputs","draft-one"]';
  const owner = { scope, generation: store.getScopeGeneration(scope) };
  const sources = {
    name: baseline({ canonical: "Draft one", value: "Draft one", error: null as string | null }),
    point: baseline({ canonical: { x: 10, y: 20 }, value: { x: "10", y: "20" }, error: null as string | null }),
    machine: baseline({ canonical: { spanLengthsMeters: [36.576] }, value: { spans: ["120"] }, error: null as string | null }),
  };
  const subscriptions = Object.keys(sources).map(section => store.subscribe(`${scope}/${section}`, () => {}));
  for (const [section, source] of Object.entries(sources)) store.reconcile<unknown>(`${scope}/${section}`, source, store.getGeneration(), owner);
  store.set(`${scope}/name`, sources.name, { canonical: "Draft one", value: "", error: "Supply a draft document name before applying." }, store.getGeneration(), owner);
  store.set(`${scope}/point`, sources.point, { canonical: { x: 10, y: 20 }, value: { x: "not-a-number", y: "" }, error: "X: enter a finite decimal number." }, store.getGeneration(), owner);
  store.set(`${scope}/machine`, sources.machine, { canonical: { spanLengthsMeters: [36.576] }, value: { spans: ["120' unfinished"] }, error: "Invalid span" }, store.getGeneration(), owner);
  subscriptions.forEach(unsubscribe => unsubscribe());
  for (const [section, source] of Object.entries(sources)) store.reconcile<unknown>(`${scope}/${section}`, source, store.getGeneration(), owner);
  assert.equal(store.read(`${scope}/name`, sources.name).value, "");
  assert.deepEqual(store.read(`${scope}/point`, sources.point).value, { x: "not-a-number", y: "" });
  assert.equal(store.read(`${scope}/machine`, sources.machine).error, "Invalid span");
  assert(store.hasDirty(), "panel unmount must not make retained unfinished input clean");
});

test("canonical changes invalidate only the affected section including hidden exact machine data", () => {
  const store = new InputRetentionStore();
  const name = baseline({ canonical: "One", value: "One", error: null as string | null });
  const oldMachine = baseline({ canonical: { length: 1, hidden: "old" }, value: "3.28", error: null as string | null });
  const newMachine = baseline({ canonical: { length: 1, hidden: "new" }, value: "3.28", error: null as string | null });
  store.reconcile("draft/name", name); store.reconcile("draft/machine", oldMachine);
  store.set("draft/name", name, { canonical: "One", value: "Unfinished name", error: null });
  store.set("draft/machine", oldMachine, { canonical: { length: 1, hidden: "old" }, value: "unfinished", error: "Invalid length" });
  store.reconcile("draft/machine", newMachine);
  assert.deepEqual(store.read("draft/machine", newMachine), newMachine.value);
  assert.equal(store.read("draft/name", name).value, "Unfinished name");
});

test("scoped discard retires stale setters and effects while preserving other panels and discard generation", () => {
  const store = new InputRetentionStore(); const source = baseline("saved");
  const scope = "draft"; const generation = store.getGeneration(); const retired = { scope, generation: 0 };
  for (const key of ["draft/name", "draft/machine", "draftOther/name", "files/name"]) { store.reconcile(key, source); store.set(key, source, "unfinished"); }
  store.resetScope(scope);
  assert.equal(store.getScopeGeneration(scope), 1);
  assert.equal(store.read("draft/name", source), "saved");
  assert.equal(store.read("draftOther/name", source), "unfinished");
  assert.equal(store.read("files/name", source), "unfinished");
  store.set("draft/name", source, "late old raw value", generation, retired);
  store.reconcile("draft/machine", baseline("stale canonical"), generation, retired);
  assert.equal(store.read("draft/name", source), "saved");
  assert.equal(store.read("draft/machine", source), "saved");
  const remounted = { scope, generation: store.getScopeGeneration(scope) };
  store.reconcile("draft/name", source, generation, remounted);
  store.set("draft/name", source, "new current raw value", generation, remounted);
  assert.equal(store.read("draft/name", source), "new current raw value");
  assert.equal(store.getScopeGeneration(scope), 1, "unsubscribe/remount does not reset discard ownership");
});

test("canonical A to B to A does not revive old source setters or reconciliation effects", () => {
  const store = new InputRetentionStore(); const a = baseline("A"), b = baseline("B");
  store.reconcile("draft/name", a);
  const oldSourceGeneration = store.getSourceGeneration("draft/name");
  store.reconcile("draft/name", b);
  store.reconcile("draft/name", a);
  store.set("draft/name", a, "stale A setter", store.getGeneration(), undefined, oldSourceGeneration);
  store.reconcile("draft/name", b, store.getGeneration(), undefined, oldSourceGeneration);
  assert.equal(store.read("draft/name", a), "A");
  assert(!store.hasDirty());
  store.set("draft/name", a, "current A setter", store.getGeneration(), undefined, store.getSourceGeneration("draft/name"));
  assert.equal(store.read("draft/name", a), "current A setter");
});

test("logical focus and caret survive remount without nodes and retire on discard or document replacement", () => {
  const store = new InputRetentionStore(); const generation = store.getGeneration(); const owner = { scope: "draft", generation: 0 };
  store.recordFocus("draft/focus/name", generation, owner);
  const caret = { start: 2, end: 5 };
  store.recordSelection("draft/focus/name", caret, generation, owner);
  caret.start = 0;
  assert.deepEqual(store.retainedFocus(), { key: "draft/focus/name", selection: { start: 2, end: 5 } });
  assert(Object.isFrozen(store.retainedFocus()) && Object.isFrozen(store.retainedFocus()?.selection));
  store.recordSelection("draft/focus/name", { start: -1, end: 5 }, generation, owner);
  assert.equal(store.retainedFocus()?.selection?.start, 2);
  store.resetScope("draft");
  store.recordFocus("draft/focus/name", generation, owner);
  assert.equal(store.retainedFocus(), null);
  store.recordFocus("draft/focus/current", generation, { scope: "draft", generation: 1 });
  store.reset();
  store.recordFocus("draft/focus/current", generation, { scope: "draft", generation: 1 });
  assert.equal(store.retainedFocus(), null);
});

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup(element: React.ReactNode): string;
};

test("provider uses the supplied controller store and fresh React trees read retained raw state", () => {
  const store = new InputRetentionStore(); const scope = "draft";
  const source = { canonical: "Draft one", value: "Draft one", error: null as string | null };
  store.reconcile("draft/name", baseline(source));
  store.set("draft/name", baseline(source), { ...source, value: "unfinished", error: "Invalid name" });
  const observed: (InputRetentionStore | null)[] = [];
  function Probe() {
    observed.push(useOptionalInputRetentionStore());
    const [retained] = useRetainedInput("draft/name", source, scope);
    return React.createElement("span", null, `${retained.value}:${retained.error ?? ""}`);
  }
  const render = () => renderToStaticMarkup(React.createElement(InputRetentionProvider, { store, children: React.createElement(Probe) }));
  assert.equal(render(), "<span>unfinished:Invalid name</span>");
  assert.equal(render(), "<span>unfinished:Invalid name</span>");
  assert.deepEqual(observed, [store, store], "a supplied provider does not allocate or substitute a controller store");
  store.resetScope(scope);
  assert.equal(render(), "<span>Draft one:</span>");
});

test("standalone provider supplies a fallback and outside consumers can detect absence", () => {
  const observed: { current: InputRetentionStore | null } = { current: null };
  function Probe() { observed.current = useOptionalInputRetentionStore(); return React.createElement("span", null, observed.current ? "retained" : "absent"); }
  assert.equal(renderToStaticMarkup(React.createElement(Probe)), "<span>absent</span>");
  assert.equal(renderToStaticMarkup(React.createElement(InputRetentionProvider, { children: React.createElement(Probe) })), "<span>retained</span>");
  assert(observed.current instanceof InputRetentionStore);
});

test("DraftInputs source wiring reconstructs retained text and error in fresh React trees and keeps standalone callers", () => {
  // Synthetic server render checks the actual panel/context wiring. Host stubs do
  // not exercise native effects, mounted DOM, focus, gestures or device behavior.
  const require = createRequire(import.meta.url);
  const modules = require("node:module") as { _load: (request: string, parent: unknown, isMain: boolean) => unknown };
  const originalLoad = modules._load;
  const host = (tag: string) => ({ children, testID }: { children?: React.ReactNode; testID?: string }) => React.createElement(tag, { "data-testid": testID }, children);
  const native = {
    View: host("div"), Text: host("span"), Pressable: host("button"), ScrollView: host("div"),
    TextInput: ({ value, testID, multiline }: { value: string; testID?: string; multiline?: boolean }) => React.createElement(multiline ? "textarea" : "input", { "data-testid": testID, defaultValue: value }),
    StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value, absoluteFillObject: {}, hairlineWidth: 1 },
    Platform: { OS: "web", select: (values: Record<string, unknown>) => values.web ?? values.default },
    useWindowDimensions: () => ({ width: 1200, height: 800, scale: 1, fontScale: 1 }),
  };
  modules._load = (request, parent, isMain) => request === "react-native" ? native
    : request === "lucide-react-native" ? new Proxy({}, { get: () => host("i") })
      : originalLoad(request, parent, isMain);
  try {
    const { DesignDraftInputs } = require("./components/DesignDraftInputs") as { DesignDraftInputs: React.ComponentType<Record<string, unknown>> };
    const { newDesignDraft } = require("./newDesignDraft") as typeof import("./newDesignDraft");
    const { createDesignDraftEditorState } = require("@cplayout/core") as Pick<typeof import("@cplayout/core"), "createDesignDraftEditorState">;
    const draft = newDesignDraft("retention-fixture", "Draft fixture", "metric");
    const editor = createDesignDraftEditorState(draft);
    const store = new InputRetentionStore();
    const scope = JSON.stringify(["draft-inputs", draft.id]);
    const source = { canonical: draft.name, value: draft.name, error: null as string | null };
    store.reconcile(`${scope}/name`, baseline(source));
    store.set(`${scope}/name`, baseline(source), { ...source, value: "raw unfinished name", error: "Retained parser failure" });
    const pointSource = { canonical: null, value: { x: "", y: "" }, error: null as string | null };
    store.reconcile(`${scope}/pivot_center`, baseline(pointSource));
    store.set(`${scope}/pivot_center`, baseline(pointSource), { ...pointSource, value: { x: "not-a-coordinate", y: "" }, error: "Retained point error" });
    const boundarySource = { canonical: [], value: "", error: null as string | null };
    store.reconcile(`${scope}/boundary`, baseline(boundarySource));
    store.set(`${scope}/boundary`, baseline(boundarySource), { ...boundarySource, value: "malformed boundary row", error: "Retained boundary error" });
    const { machineInputValues } = require("./components/designDraftInputValues") as typeof import("./components/designDraftInputValues");
    const machineSource = { canonical: draft.machine, value: machineInputValues(draft.machine), error: null as string | null };
    store.reconcile(`${scope}/machine`, baseline(machineSource));
    store.set(`${scope}/machine`, baseline(machineSource), { ...machineSource, value: { ...machineSource.value, spans: ["unfinished-span"] }, error: "Retained machine error" });
    const panel = () => React.createElement(DesignDraftInputs, { editor, onAction: () => {} });
    const retainedRender = () => renderToStaticMarkup(React.createElement(InputRetentionProvider, { store, children: panel() }));
    for (let mount = 0; mount < 2; mount++) {
      const rendered = retainedRender();
      assert.match(rendered, /value="raw unfinished name"/);
      assert.match(rendered, /Retained parser failure/);
      assert.match(rendered, /value="not-a-coordinate"/);
      assert.match(rendered, /malformed boundary row/);
      assert.match(rendered, /value="unfinished-span"/);
      for (const error of ["Retained point error", "Retained boundary error", "Retained machine error"]) assert(rendered.includes(error));
    }
    assert(store.hasDirty());
    store.resetScope(scope);
    const discarded = retainedRender();
    assert.match(discarded, /value="Draft fixture"/);
    assert.doesNotMatch(discarded, /Retained (?:parser failure|point error|boundary error|machine error)/);
    assert.doesNotMatch(discarded, /not-a-coordinate|malformed boundary row|unfinished-span/);
    assert.match(renderToStaticMarkup(panel()), /value="Draft fixture"/, "standalone panel supplies its fallback provider");
  } finally { modules._load = originalLoad; }
});

test("recovery keeps literal text, arrays and caret detached and publishes all values together", () => {
  const source = new InputRetentionStore(); const text = baseline("saved"), rows = baseline(["1", "2"]);
  source.set("draft/name", text, "  invalid\r\nname  "); source.set("draft/rows", rows, ["not a number", ""]);
  source.recordFocus("draft/name"); source.recordSelection("draft/name", { start: 2, end: 9 });
  const snapshot = source.snapshotRecovery();
  source.set("draft/name", text, "newer source input");
  assert.equal(snapshot.entries.find(entry => entry.key === "draft/name")!.value, "  invalid\r\nname  ");
  assert(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.entries) && Object.isFrozen(snapshot.entries[1].value));
  const target = new InputRetentionStore(); target.reconcile("draft/name", text); target.reconcile("draft/rows", rows);
  const observed: unknown[] = []; let operatorEvents = 0;
  target.subscribeUserInput(() => operatorEvents++);
  target.subscribeChanges(() => observed.push([target.read("draft/name", text), target.read("draft/rows", rows), target.hasDirty()]));
  target.restoreRecovery(target.stageRecovery(snapshot));
  assert.deepEqual(observed, [["  invalid\r\nname  ", ["not a number", ""], true]]);
  assert.equal(operatorEvents, 0);
  assert.deepEqual(target.retainedFocus(), { key: "draft/name", selection: { start: 2, end: 9 } });
});

test("invalid later recovery entries cannot partially replace current work", () => {
  const target = new InputRetentionStore(), text = baseline("saved"); target.set("keep", text, "current work");
  const valid = target.snapshotRecovery(); const before = target.getRevision(); let notifications = 0;
  target.subscribeChanges(() => notifications++);
  const cases: unknown[] = [
    { ...valid, entries: [...valid.entries, { ...valid.entries[0] }] },
    { ...valid, entries: [...valid.entries, { ...valid.entries[0], key: "late", baselineFingerprint: "not JSON" }] },
    { ...valid, entries: [...valid.entries, { ...valid.entries[0], key: "late", value: Infinity }] },
    { ...valid, focus: { key: "keep", selection: { start: 5, end: 1 } } },
    { ...valid, focus: { key: "keep", selection: null } },
  ];
  let getterCalled = false;
  cases.push({ entries: valid.entries, get focus() { getterCalled = true; return null; } });
  for (const candidate of cases) assert.throws(() => target.stageRecovery(candidate as WorkspaceRecoveryInputs));
  assert.equal(getterCalled, false); assert.equal(target.getRevision(), before); assert.equal(notifications, 0);
  assert.equal(target.read("keep", text), "current work"); assert(target.hasDirty());
});

test("recovery tickets are single-use and refuse forged, foreign, generation and input ABA owners", () => {
  const original = new InputRetentionStore(), text = baseline("A"); original.set("key", text, "recover");
  const snapshot = original.snapshotRecovery(); const target = new InputRetentionStore(); target.reconcile("key", text);
  assert.throws(() => target.restoreRecovery(Object.freeze({ kind: "input-recovery-admission" })), /review changed/);
  assert.throws(() => target.restoreRecovery(original.stageRecovery(snapshot)), /review changed/);
  const aba = target.stageRecovery(snapshot); target.set("key", text, "B"); target.set("key", text, "A");
  assert.throws(() => target.restoreRecovery(aba), /review changed/); assert.equal(target.read("key", text), "A");
  const stale = target.stageRecovery(snapshot); target.reset();
  assert.throws(() => target.restoreRecovery(stale), /review changed/); assert.equal(target.read("key", text), "A");
  const fresh = target.stageRecovery(snapshot); target.restoreRecovery(fresh);
  assert.throws(() => target.restoreRecovery(fresh), /review changed/); assert.equal(target.read("key", text), "recover");
});

test("recovery compares actual fresh baselines and never treats serialized clean as accepted Apply", () => {
  const previous = new InputRetentionStore(), old = baseline("120");
  previous.set("machine/span", old, " 120' 6\" "); previous.markClean("machine/span");
  assert.equal(previous.hasDirty(), false);
  const target = new InputRetentionStore(), fresh = baseline("120.5"); target.reconcile("machine/span", fresh);
  const oldGeneration = target.getGeneration(), oldScope = { scope: "machine", generation: target.getScopeGeneration("machine") };
  target.restoreRecovery(target.stageRecovery(previous.snapshotRecovery()));
  assert.equal(target.read("machine/span", fresh), " 120' 6\" "); assert(target.hasDirty());
  target.set("machine/span", fresh, "retired setter", oldGeneration, oldScope);
  assert.equal(target.read("machine/span", fresh), " 120' 6\" ");
  target.reconcile("machine/span", fresh); assert(target.hasDirty());
  target.markClean("machine/span"); assert.equal(target.hasDirty(), false);
});

test("inactive recovered values rebase on fresh mounting without losing raw input", () => {
  const previous = new InputRetentionStore(); previous.set("inactive/point", baseline(["old"]), ["bad x", "bad y"]);
  previous.set("inactive/clean", baseline("same"), "same");
  const target = new InputRetentionStore(); target.restoreRecovery(target.stageRecovery(previous.snapshotRecovery()));
  const fresh = baseline(["new baseline"]);
  assert.deepEqual(target.read("inactive/point", fresh), ["bad x", "bad y"]);
  target.reconcile("inactive/point", fresh);
  assert.deepEqual(target.read("inactive/point", fresh), ["bad x", "bad y"]); assert(target.hasDirty());
  target.reconcile("inactive/clean", baseline("same"));
  target.resetScope("inactive");
  assert.equal(target.hasDirty(), false); assert.deepEqual(target.read("inactive/point", fresh), ["new baseline"]);
});

test("new focus during recovery review refuses hydration without stealing its caret", () => {
  const store = new InputRetentionStore(), text = baseline("saved"); store.set("key", text, "unfinished");
  store.recordFocus("key"); store.recordSelection("key", { start: 1, end: 2 });
  const ticket = store.stageRecovery(store.snapshotRecovery());
  store.recordSelection("key", { start: 3, end: 4 });
  assert.throws(() => store.restoreRecovery(ticket), /review changed/);
  assert.deepEqual(store.retainedFocus(), { key: "key", selection: { start: 3, end: 4 } });
  assert.equal(store.read("key", text), "unfinished");
});

test("recovery notifications observe caret separately while normal input revision semantics stay unchanged", () => {
  const store = new InputRetentionStore(), text = baseline("saved"); store.reconcile("key", text);
  const revision = store.getRevision(); let recovery = 0, changes = 0, user = 0;
  const unsubscribe = store.subscribeRecoveryChanges(() => recovery++);
  store.subscribeChanges(() => changes++); store.subscribeUserInput(() => user++);
  store.recordFocus("key"); store.recordSelection("key", { start: 1, end: 3 });
  store.recordSelection("key", { start: -1, end: 3 });
  assert.equal(recovery, 2); assert.equal(changes, 0); assert.equal(user, 0); assert.equal(store.getRevision(), revision);
  store.set("key", text, "raw"); assert.equal(recovery, 3); assert.equal(changes, 1); assert.equal(user, 1);
  unsubscribe(); store.recordSelection("key", { start: 0, end: 1 }); assert.equal(recovery, 3);
});

test("recovery rejects array getters, prototypes and extra properties before any live side effect", () => {
  const target = new InputRetentionStore(), text = baseline("saved"); target.set("keep", text, "keep this work");
  const snapshot = target.snapshotRecovery(); let getterCalls = 0;
  const values: string[] = [];
  Object.defineProperty(values, "0", { enumerable: true, configurable: true, get() {
    getterCalls++; target.set("keep", text, "rewritten by accessor"); return "bad";
  } });
  const outer: unknown[] = [];
  Object.defineProperty(outer, "0", { enumerable: true, get() { getterCalls++; return snapshot.entries[0]; } });
  const inherited = ["value"]; Object.setPrototypeOf(inherited, Object.create(Array.prototype));
  const extra = Object.assign(["value"], { ignored: "must remain visible" });
  for (const value of [values, inherited, extra]) {
    const candidate = { ...snapshot, entries: [{ ...snapshot.entries[0], value }] } as WorkspaceRecoveryInputs;
    assert.throws(() => target.stageRecovery(candidate), /computed properties|plain arrays/);
  }
  assert.throws(() => target.stageRecovery({ ...snapshot, entries: outer } as WorkspaceRecoveryInputs), /computed properties/);
  assert.equal(getterCalls, 0); assert.equal(target.read("keep", text), "keep this work");
});

test("same-value operator input retires a recovery ticket without changing normal revisions", () => {
  const store = new InputRetentionStore(), text = baseline("saved"); store.set("key", text, "same raw");
  const snapshot = store.snapshotRecovery(), ticket = store.stageRecovery(snapshot), revision = store.getRevision();
  store.set("key", text, "same raw");
  assert.equal(store.getRevision(), revision);
  assert.throws(() => store.restoreRecovery(ticket), /review changed/);
  assert.equal(store.read("key", text), "same raw");
});
