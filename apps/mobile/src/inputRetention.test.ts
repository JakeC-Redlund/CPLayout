import assert from "node:assert/strict";
import { test } from "node:test";
import { createInputRetentionBaseline as baseline, InputRetentionStore } from "./inputRetention";

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
