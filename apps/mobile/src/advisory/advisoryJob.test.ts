import assert from "node:assert/strict";
import { AdvisoryJob, type AdvisoryScheduler } from "./advisoryJob";
import { advisoryDemand } from "./advisoryDemand";

function harness() {
  let time = 0;
  const callbacks = new Set<() => void>();
  const clock: AdvisoryScheduler = {
    now: () => time,
    schedule(callback) { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
  };
  const job = new AdvisoryJob<number>(clock);
  const tick = () => { const next = callbacks.values().next().value; if (next) { callbacks.delete(next); next(); } };
  const drain = () => { for (let n = 0; callbacks.size && n < 100; n += 1) tick(); assert.equal(callbacks.size, 0); };
  function* steps() { for (let n = 0; n < 4; n += 1) { time += 5; yield; } return 42; }
  return { job, callbacks, tick, drain, steps };
}

{
  const h = harness(); const key = {}; let calls = 0;
  const create = () => { calls += 1; return h.steps(); };
  h.job.request(key, create);
  assert.equal(calls, 0, "request cannot calculate in the caller's render");
  h.job.request(key, create);
  assert.equal(h.callbacks.size, 1);
  h.tick();
  assert.equal(h.job.getSnapshot().status, "pending", "yield between bounded batches");
  h.drain();
  assert.deepEqual(h.job.getSnapshot(), { status: "ready", key, value: 42 });
  h.job.request(key, create); h.job.cancel(); h.job.request(key, create);
  assert.equal(calls, 1, "completed unchanged input is cached across visibility changes");
}
{
  const h = harness(); const oldKey = {}; const newKey = {};
  h.job.request(oldKey, h.steps);
  const lateCallback = [...h.callbacks][0];
  h.tick();
  h.job.request(newKey, function* () { return 7; });
  lateCallback(); h.drain();
  assert.deepEqual(h.job.getSnapshot(), { status: "ready", key: newKey, value: 7 });
}
{
  const h = harness(); const key = {}; let calls = 0;
  h.job.request(key, () => { calls += 1; return h.steps(); });
  const lateCallback = [...h.callbacks][0];
  h.job.cancel(); lateCallback();
  assert.equal(calls, 0, "unmount before timer fires does not start work");
  assert.equal(h.job.getSnapshot().status, "idle");
  h.job.request(key, h.steps); h.tick(); h.job.cancel();
  assert.equal(h.callbacks.size, 0);
  h.job.request(key, h.steps); h.drain();
  assert.equal(h.job.getSnapshot().status, "ready", "cancelled work can restart");
}
{
  const h = harness(); const key = {}; const error = new Error("bad calculation");
  h.job.request(key, function* () { yield; throw error; }); h.drain();
  assert.deepEqual(h.job.getSnapshot(), { status: "error", key, error });
  h.job.retry(key, h.steps); h.drain();
  assert.equal(h.job.getSnapshot().status, "ready", "an error can be explicitly retried with unchanged input");
  h.job.request({}, h.steps); h.drain();
  assert.equal(h.job.getSnapshot().status, "ready", "new input recovers from errors");
}
{
  const h = harness(); const oldKey = {}; const newKey = {}; let obsoleteCalls = 0;
  const fail = function* (): Generator<void, number, void> { throw new Error("failed"); };
  const obsoleteRetry = () => h.job.retry(oldKey, function* () { obsoleteCalls += 1; return 1; });
  h.job.request(oldKey, fail); h.drain();
  h.job.request(newKey, function* () { return 2; }); obsoleteRetry(); h.drain();
  assert.deepEqual(h.job.getSnapshot(), { status: "ready", key: newKey, value: 2 });
  h.job.request(oldKey, fail); h.drain(); h.job.cancel(); obsoleteRetry(); h.drain();
  assert.equal(h.job.getSnapshot().status, "idle", "retry cannot revive an error after owner cancellation");
  assert.equal(obsoleteCalls, 0);
}
{
  const h = harness(); const keyB = {}; const keyC = {}; let callsC = 0;
  h.job.request({}, h.steps);
  let once = true;
  const published: unknown[] = [];
  h.job.subscribe(() => {
    const state = h.job.getSnapshot();
    if (state.status === "ready") published.push(state);
    if (once && state.status === "idle") {
      once = false;
      h.job.request(keyB, function* () { for (let n = 0; n < 128; n += 1) yield; return 2; });
    }
  });
  h.job.request(keyC, function* () { callsC += 1; return 3; });
  h.drain();
  assert.deepEqual(h.job.getSnapshot(), { status: "ready", key: keyB, value: 2 }, "a reentrant newer request owns its result");
  assert.deepEqual(published, [{ status: "ready", key: keyB, value: 2 }], "no transient result may be published under a different request key");
  assert.equal(callsC, 0);
}
{
  const h = harness(); const keyB = {}; let callsA = 0;
  h.job.request({}, () => {
    h.job.request(keyB, function* () { return 2; });
    return (function* () { callsA += 1; return 1; })();
  });
  h.drain();
  assert.deepEqual(h.job.getSnapshot(), { status: "ready", key: keyB, value: 2 });
  assert.equal(callsA, 0, "obsolete factory output cannot overwrite a reentrant request");
}
{
  const h = harness(); let notifications = 0;
  const unsubscribe = h.job.subscribe(() => { notifications += 1; });
  h.job.request({}, h.steps); h.drain(); unsubscribe();
  const before = notifications;
  h.job.request({}, h.steps); h.drain();
  assert.equal(notifications, before);
  assert.throws(() => new AdvisoryJob(undefined, NaN));
  assert.throws(() => new AdvisoryJob(undefined, 0));
}
console.log("Advisory job: scheduling, caching, cancellation, stale callbacks, errors and subscriptions pass.");

for (const view of ["map", "dashboard", "files", "settings", "survey", "help"]) {
  assert.deepEqual(advisoryDemand({ homeView: true, view, modal: null, sidebar: "overview", sidebarOpen: true }), {
    fieldPlan: false, renderModel: false, multiMachine: false, cornerArm: false,
  });
}
assert.equal(advisoryDemand({ homeView: false, view: "dashboard", modal: null, sidebar: "overview", sidebarOpen: true }).fieldPlan, false);
assert.deepEqual(advisoryDemand({ homeView: false, view: "map", modal: null, sidebar: "tools", sidebarOpen: true }), {
  fieldPlan: true, renderModel: true, multiMachine: false, cornerArm: false,
});
assert.equal(advisoryDemand({ homeView: false, view: "map", modal: null, sidebar: "overview", sidebarOpen: false }).multiMachine, false);
console.log("Advisory demand: catalog and unrelated views cannot request expensive analysis.");
