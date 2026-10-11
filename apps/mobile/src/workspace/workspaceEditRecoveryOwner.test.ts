import assert from "node:assert/strict";
import test from "node:test";
import { createWebWorkspaceStore, WEB_WORKSPACE_KEY, WEB_WORKSPACE_LOCK, type WorkspaceLocks } from "../../../../packages/project-store/src/webWorkspaceStore";
import { createWorkspaceEditRecoveryStore, WORKSPACE_EDIT_RECOVERY_KEY, WORKSPACE_EDIT_RECOVERY_LOCK, type StorageLike } from "./workspaceEditRecoveryStore";
import { createWorkspaceEditRecoveryOwner, type WorkspaceEditRecoveryOwnerDependencies, type WorkspaceRecoveryInstallation } from "./workspaceEditRecoveryOwner";
import { emptyWorkspaceEditRecoveryUi, parseWorkspaceEditRecovery, serializeWorkspaceEditRecovery, WORKSPACE_EDIT_RECOVERY_VERSION,
  type WorkspaceEditRecoveryCandidate } from "./workspaceEditRecovery";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
class OriginLocks implements WorkspaceLocks {
  private tails = new Map<string, Promise<unknown>>(); held = new Set<string>();
  request<T>(name: string, _options: { mode: "exclusive" }, action: () => T | PromiseLike<T>): Promise<T> {
    const result = (this.tails.get(name) ?? Promise.resolve()).then(async () => {
      assert.equal(this.held.has(name), false); this.held.add(name); try { return await action(); } finally { this.held.delete(name); }
    });
    this.tails.set(name, result.catch(() => undefined)); return result;
  }
  async hold(name: string) {
    const entered = deferred(), release = deferred(), completed = this.request(name, { mode: "exclusive" }, async () => { entered.resolve(); await release.promise; });
    await entered.promise; return async () => { release.resolve(); await completed; };
  }
}
type RecoveryStore = ReturnType<typeof createWorkspaceEditRecoveryStore>;
async function fixture(backend: "web" | "native" = "web") {
  const values = new Map<string, string>(), locks = new OriginLocks();
  const effects: Array<{ type: "read" | "write"; key: string }> = [];
  const behavior: { quota?: boolean; checkpointBefore?: ReturnType<typeof deferred>; checkpointAfter?: ReturnType<typeof deferred>;
    readAfter?: ReturnType<typeof deferred>; stageAfter?: ReturnType<typeof deferred>; completeAfter?: ReturnType<typeof deferred>;
    completeError?: Error; rollbackError?: Error; publishError?: Error; installationCurrent?: boolean;
    readWorkspaceAfter?: ReturnType<typeof deferred>; acknowledgeError?: Error; onInstallationCheck?: () => void } = {};
  const storage: StorageLike = { getItem(key) { effects.push({ type: "read", key }); return values.get(key) ?? null; },
    setItem(key, raw) { if (behavior.quota && key === WORKSPACE_EDIT_RECOVERY_KEY) throw new DOMException("recovery quota", "QuotaExceededError"); effects.push({ type: "write", key }); values.set(key, raw); } };
  const workspaceStore = createWebWorkspaceStore({ getStorage: () => storage, getLocks: () => locks }), workspace = await workspaceStore.initializeAsync(); effects.length = 0;
  const realStore = createWorkspaceEditRecoveryStore({ backend, storage, withExclusiveLock: (name, action) => locks.request(name, { mode: "exclusive" }, action) });
  const events: string[] = [], staged = deferred(), published = deferred(), completed = deferred();
  let text = "live raw input", inputOwner = {}, gated = false, captures = 0, ids = 0, publications = 0, rollbacks = 0, restores = 0;
  const make = (writerId: string, sequence: number, literal = text): WorkspaceEditRecoveryCandidate => {
    const ui = emptyWorkspaceEditRecoveryUi();
    return { recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION, writerId, sequence, capturedAt: "2026-10-11T12:00:00.000Z", workspaceRevision: workspace.revision,
      context: { version: 2, catalogVisible: true, catalogSelection: { clientId: null, projectId: null, fieldMapId: null, designId: null },
        workspace: { mode: "design", design: null, layout: null, collectionId: null } }, editable: null, collections: [], layout: null,
      controller: { historyPast: [], historyFuture: [], selectedAddress: null }, inputs: { entries: [{ key: "raw/input", value: literal, baselineFingerprint: '""', cleanFingerprint: '""' }], focus: null },
      ui: { ...ui, file: { ...ui.file, text: literal } }, cameras: [] };
  };
  const store: RecoveryStore = { ...realStore,
    async checkpoint(candidate, expected, isCurrent) {
      const before = behavior.checkpointBefore; behavior.checkpointBefore = undefined; if (before) await before.promise;
      const receipt = await realStore.checkpoint(candidate, expected, isCurrent);
      const after = behavior.checkpointAfter; behavior.checkpointAfter = undefined; if (after) await after.promise;
      if (behavior.acknowledgeError) throw behavior.acknowledgeError; return receipt;
    },
    async readCandidates() {
      const receipt = await realStore.readCandidates(), after = behavior.readAfter; behavior.readAfter = undefined;
      if (after) await after.promise; return receipt;
    },
  };
  const deps: WorkspaceEditRecoveryOwnerDependencies = {
    store: () => store,
    readWorkspace: async () => { events.push("workspace read"); const after = behavior.readWorkspaceAfter; behavior.readWorkspaceAfter = undefined; if (after) await after.promise; return workspaceStore.readAsync(); },
    readLease: (revision, action, current) => workspaceStore.readLeaseAsync(revision, async (fresh, guard) => { events.push("lease entered"); return action(fresh, guard); }, current),
    createWriterId: () => `mount-writer-${++ids}`,
    capture: (writerId, sequence) => { captures++; return make(writerId, sequence); },
    captureOwner: () => { const token = inputOwner; return () => inputOwner === token && !gated; },
    canRestore: () => { restores++; if (gated) throw new Error("controls remain gated"); },
    async stage(admission) {
      assert(locks.held.has(WEB_WORKSPACE_LOCK)); events.push("staged under lease"); staged.resolve(); const after = behavior.stageAfter; behavior.stageAfter = undefined; if (after) await after.promise;
      const previous = text;
      const installation: WorkspaceRecoveryInstallation = {
        isCurrent: () => { behavior.onInstallationCheck?.(); return behavior.installationCurrent !== false; },
        publish() { assert(locks.held.has(WEB_WORKSPACE_LOCK)); publications++; events.push("published under lease"); gated = true; text = admission.ui.file.text; published.resolve(); if (behavior.publishError) throw behavior.publishError; },
        async complete() { assert.equal(locks.held.has(WEB_WORKSPACE_LOCK), false); events.push("delivery after lease"); completed.resolve(); const after = behavior.completeAfter; behavior.completeAfter = undefined; if (after) await after.promise; if (behavior.completeError) throw behavior.completeError; gated = false; },
        async rollback() { rollbacks++; events.push("rollback"); if (behavior.rollbackError) throw behavior.rollbackError; text = previous; gated = false; },
      };
      return installation;
    },
  };
  const owner = createWorkspaceEditRecoveryOwner(deps);
  return { owner, realStore, store, deps, values, locks, behavior, effects, events, workspace, workspaceStore, make, staged, published, completed,
    edit(value: string) { text = value; inputOwner = {}; }, retire() { inputOwner = {}; },
    text: () => text, gated: () => gated, captures: () => captures, ids: () => ids, publications: () => publications, rollbacks: () => rollbacks, restores: () => restores,
    snapshot: () => [...values], domainBytes: () => [...values].filter(([key]) => key !== WORKSPACE_EDIT_RECOVERY_KEY),
    async offer(literal = "offered exact raw  \n") { return realStore.checkpoint(make("offered-writer", 1, literal), null, () => true); },
  };
}
async function flush() { await new Promise<void>(done => setImmediate(done)); }

test("semantic duplicate checkpoints do not advance an acknowledged sequence or touch durable workspace bytes", async () => {
  const f = await fixture(), domain = f.domainBytes(); await f.owner.checkpoint(); const raw = await f.owner.exportCandidate("mount-writer-1");
  await f.owner.checkpoint(); await f.owner.checkpoint();
  assert.equal(await f.owner.exportCandidate("mount-writer-1"), raw); assert.equal((await f.realStore.readCandidates())[0].sequence, 1);
  assert.equal(f.owner.getSnapshot().phase, "saved"); assert.deepEqual(f.domainBytes(), domain); assert.equal(f.text(), "live raw input");
});
test("concurrent checkpoint requests coalesce into the newest separately requested current input", async () => {
  const f = await fixture(), gate = deferred(); f.behavior.checkpointBefore = gate;
  const first = f.owner.checkpoint(); f.edit("newer B  \n"); await f.owner.checkpoint(); f.edit("newest C\t"); await f.owner.checkpoint();
  gate.resolve(); await first;
  const slots = await f.realStore.readCandidates(); assert.equal(slots.length, 1); assert.equal(slots[0].candidate.ui.file.text, "newest C\t");
  assert.equal(slots[0].sequence, 1); assert.equal(f.captures(), 2); assert.equal(f.owner.getSnapshot().phase, "saved");
});
test("obsolete capture without an independent checkpoint request neither retries nor writes", async () => {
  const f = await fixture(), gate = deferred(); f.behavior.checkpointBefore = gate; const first = f.owner.checkpoint();
  f.retire(); gate.resolve(); await first; await flush();
  assert.equal(f.captures(), 1); assert.deepEqual(await f.realStore.readCandidates(), []); assert.notEqual(f.owner.getSnapshot().phase, "saved");
});
test("a newer input while an admitted receipt awaits acknowledgement stays intact and gets the next checkpoint", async () => {
  const f = await fixture(), gate = deferred(); f.behavior.checkpointAfter = gate; const first = f.owner.checkpoint(); await flush();
  assert.equal((await f.realStore.readCandidates())[0].sequence, 1); f.edit("newer after committed A"); await f.owner.checkpoint(); gate.resolve(); await first;
  const slot = (await f.realStore.readCandidates())[0]; assert.equal(slot.sequence, 2); assert.equal(slot.candidate.ui.file.text, "newer after committed A");
  assert.equal(f.text(), "newer after committed A");
});
test("dispose/activate forks a writer and independently requested work survives the retired delayed checkpoint", async () => {
  const f = await fixture(), gate = deferred(); f.behavior.checkpointAfter = gate; const old = f.owner.checkpoint(); await flush();
  f.owner.dispose(); f.owner.activate(); f.edit("new mount raw"); await f.owner.checkpoint(); gate.resolve(); await old; await flush();
  const slots = await f.realStore.readCandidates(); assert.deepEqual(slots.map(slot => [slot.writerId, slot.sequence]), [["mount-writer-1", 1], ["mount-writer-2", 1]]);
  assert.equal(slots[1].candidate.ui.file.text, "new mount raw"); assert.equal(f.owner.getSnapshot().phase, "saved");
});
test("quota error preserves exact prior checkpoint and explicit retry can acknowledge the current raw input", async () => {
  const f = await fixture(); await f.owner.checkpoint(); const before = f.snapshot(); f.edit("new input during quota"); f.behavior.quota = true;
  await f.owner.checkpoint(); assert.equal(f.owner.getSnapshot().phase, "error"); assert.match(f.owner.getSnapshot().message!, /quota/i); assert.deepEqual(f.snapshot(), before);
  assert.equal(f.text(), "new input during quota"); f.behavior.quota = false; await f.owner.checkpoint();
  assert.equal((await f.realStore.readCandidates())[0].sequence, 2); assert.equal(f.owner.getSnapshot().phase, "saved");
});
test("native recovery refuses store operations before storage/source reads while current in-memory export stays explicit", async () => {
  const f = await fixture("native"), before = f.snapshot(); f.effects.length = 0;
  await f.owner.checkpoint(); assert.equal(f.owner.getSnapshot().phase, "error"); await f.owner.refresh();
  assert.equal(await f.owner.prepareRestore("offered-writer"), null); assert.equal(await f.owner.discard("offered-writer", 1), false);
  await assert.rejects(f.owner.exportRawLedger(), /browser storage/i); await assert.rejects(f.owner.exportCandidate("offered-writer"), /browser storage/i);
  assert.equal(parseWorkspaceEditRecovery(f.owner.exportCurrent()).ui.file.text, "live raw input");
  assert.deepEqual(f.snapshot(), before); assert.deepEqual(f.effects, []); assert.deepEqual(f.events, []);
});
test("review pins exact slot bytes, not only matching writer and sequence", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  const ledger = JSON.parse(f.values.get(WORKSPACE_EDIT_RECOVERY_KEY)!); ledger.slots[0].raw += " \n"; f.values.set(WORKSPACE_EDIT_RECOVERY_KEY, JSON.stringify(ledger)); const before = f.snapshot();
  assert.equal(await f.owner.restore(review), false); assert.equal(f.publications(), 0); assert.deepEqual(f.snapshot(), before);
  assert.match(f.owner.getSnapshot().message!, /checkpoint changed/i);
});
test("restore review is one-use and raw input ABA retires it even when text returns to the original bytes", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  const text = f.text(); f.edit("temporary input"); f.edit(text);
  assert.equal(await f.owner.restore(review), false); assert.equal(await f.owner.restore(review), false); assert.equal(f.publications(), 0); assert.equal(f.text(), text);
});
test("review from a disposed activation cannot authorize Restore after reactivation", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  f.owner.dispose(); f.owner.activate();
  assert.equal(await f.owner.restore(review), false); assert.equal(f.publications(), 0); assert.equal(f.text(), "live raw input");
});
test("review preparation retired during a delayed source read cannot publish a review into the new activation", async () => {
  const f = await fixture(), offered = await f.offer(), gate = deferred(); f.behavior.readWorkspaceAfter = gate;
  const prepared = f.owner.prepareRestore(offered.writerId); await flush(); f.owner.dispose(); f.owner.activate(); await f.owner.checkpoint(); const state = f.owner.getSnapshot();
  gate.resolve(); assert.equal(await prepared, null); assert.equal(f.owner.getSnapshot(), state); assert.equal(f.publications(), 0);
});
test("successful Restore publishes under the workspace lease, delivers after release, and forks a writer without domain writes", async () => {
  const f = await fixture(), offered = await f.offer(), domain = f.domainBytes(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  assert.equal(await f.owner.restore(review), true); assert.equal(f.text(), offered.candidate.ui.file.text); assert.equal(f.gated(), false);
  assert.deepEqual(f.events.slice(-4), ["lease entered", "staged under lease", "published under lease", "delivery after lease"]);
  assert.equal(f.owner.isRestoring(), false); assert.equal(f.ids(), 2); assert.equal(await f.owner.restore(review), false);
  assert.equal(await f.owner.exportCandidate(offered.writerId), offered.raw); assert.deepEqual(f.domainBytes(), domain);
  await f.owner.checkpoint(); assert((await f.realStore.readCandidates()).some(slot => slot.writerId === "mount-writer-2"));
});
test("a writer advances the offered slot while asynchronous staging waits, so stale reviewed bytes cannot publish", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  const gate = deferred(); f.behavior.stageAfter = gate; const restore = f.owner.restore(review); await f.staged.promise;
  const newer = await f.realStore.checkpoint(f.make(offered.writerId, 2, "newer offered slot"), 1, () => true);
  gate.resolve(); assert.equal(await restore, false); assert.equal(f.publications(), 0); assert.equal(f.text(), "live raw input");
  assert.equal(await f.owner.exportCandidate(offered.writerId), newer.raw);
});
test("runtime and participant retirement during staging refuse before publication", async () => {
  for (const retired of ["input", "participant"] as const) {
    const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
    const gate = deferred(); f.behavior.stageAfter = gate; const restore = f.owner.restore(review); await f.staged.promise;
    if (retired === "input") f.retire(); else f.behavior.installationCurrent = false;
    gate.resolve(); assert.equal(await restore, false); assert.equal(f.publications(), 0); assert.equal(f.gated(), false); assert.equal(f.text(), "live raw input");
  }
});
test("delivery failure rolls back before enabling controls and retains the exact recovery slot", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  f.behavior.completeError = new Error("participant delivery failed"); assert.equal(await f.owner.restore(review), false);
  assert.equal(f.publications(), 1); assert.equal(f.rollbacks(), 1); assert.equal(f.text(), "live raw input"); assert.equal(f.gated(), false);
  assert.equal(f.owner.isRestoring(), false); assert.equal(await f.owner.exportCandidate(offered.writerId), offered.raw); assert.match(f.owner.getSnapshot().message!, /delivery failed/);
});
test("failed rollback keeps the actor's external controls gated and preserves the offered checkpoint for export", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  f.behavior.completeError = new Error("delivery failed"); f.behavior.rollbackError = new Error("rollback refused");
  assert.equal(await f.owner.restore(review), false); assert.equal(f.gated(), true); assert.equal(f.owner.getSnapshot().phase, "error");
  assert.match(f.owner.getSnapshot().message!, /remains gated.*rollback refused/i); assert.equal(await f.owner.exportCandidate(offered.writerId), offered.raw);
  const before = f.snapshot(); await f.owner.checkpoint(); assert.deepEqual(f.snapshot(), before);
  assert.equal(f.owner.getSnapshot().phase, "error"); assert.match(f.owner.getSnapshot().message ?? "", /remains gated/i);
});
test("a partially published installation which throws is rolled back without losing raw input", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  f.behavior.publishError = new Error("publication failed after mutation"); assert.equal(await f.owner.restore(review), false);
  assert.equal(f.rollbacks(), 1); assert.equal(f.text(), "live raw input"); assert.equal(f.gated(), false); assert.equal(await f.owner.exportCandidate(offered.writerId), offered.raw);
});
test("disposed delayed delivery cannot change the reactivated actor's newer checkpoint state", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  const gate = deferred(); f.behavior.completeAfter = gate; const restore = f.owner.restore(review); await f.completed.promise;
  f.owner.dispose(); f.owner.activate(); f.behavior.completeError = new Error("retired old delivery");
  // A replacement mounted UI has its own gate and owner; mimic its ready raw input.
  f.behavior.completeError = undefined; gate.resolve(); assert.equal(await restore, false);
  f.edit("reactivated input"); await f.owner.checkpoint(); const state = f.owner.getSnapshot();
  assert.equal(state.phase, "saved"); assert.equal((await f.realStore.readCandidates()).find(slot => slot.writerId === "mount-writer-2")!.candidate.ui.file.text, "reactivated input");
});
test("stale delayed refresh cannot erase an acknowledged checkpoint from current actor metadata", async () => {
  const f = await fixture(), gate = deferred(); f.behavior.readAfter = gate;
  const refresh = f.owner.refresh(); await flush(); await f.owner.checkpoint(); assert.equal(f.owner.getSnapshot().candidates.length, 1);
  gate.resolve(); await refresh; assert.equal(f.owner.getSnapshot().candidates.length, 1); assert.equal(f.owner.getSnapshot().candidates[0].writerId, "mount-writer-1");
});
test("conditional discard and exact exports preserve saved workspace bytes and fork a discarded current writer", async () => {
  const f = await fixture(), offered = await f.offer(), domain = f.domainBytes(); await f.owner.checkpoint(); await f.owner.refresh();
  assert.equal(await f.owner.discard("mount-writer-1", 2), false); assert.equal(await f.owner.exportCandidate(offered.writerId), offered.raw);
  assert.equal(await f.owner.discard("mount-writer-1", 1), true); assert.equal(f.ids(), 2); await f.owner.checkpoint();
  assert.equal((await f.realStore.readCandidates()).find(slot => slot.writerId === "mount-writer-2")!.sequence, 1);
  assert.equal(await f.owner.exportRawLedger(), f.values.get(WORKSPACE_EDIT_RECOVERY_KEY)); assert.deepEqual(f.domainBytes(), domain);
});
test("export of current raw work is parsed and detached without checkpoint or domain acknowledgement", async () => {
  const f = await fixture(), before = f.snapshot(); f.edit("  current invalid input\n\t"); const raw = f.owner.exportCurrent(), parsed = parseWorkspaceEditRecovery(raw);
  assert.equal(parsed.ui.file.text, "  current invalid input\n\t"); assert.equal(parsed.sequence, 1); assert.equal(parsed.writerId, "mount-writer-1");
  assert.equal(serializeWorkspaceEditRecovery(parsed), raw); assert.deepEqual(f.snapshot(), before); assert.equal(f.owner.getSnapshot().phase, "idle");
});
test("an independently requested checkpoint during delivery resumes only after complete and writer fork", async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  const gate = deferred(); f.behavior.completeAfter = gate; const restore = f.owner.restore(review); await f.completed.promise;
  await f.owner.checkpoint(); assert.equal(f.captures(), 0); assert.equal(f.gated(), true); gate.resolve(); assert.equal(await restore, true); await flush();
  const own = (await f.realStore.readCandidates()).find(slot => slot.writerId === "mount-writer-2"); assert(own);
  assert.equal(own.sequence, 1); assert.equal(own.candidate.ui.file.text, offered.candidate.ui.file.text);
});
for (const reentrant of ["installation guard", "phase subscriber"] as const)
test(`${reentrant} exact-slot drift before synchronous publication refuses the stale actor effect`, async () => {
  const f = await fixture(), offered = await f.offer(), review = await f.owner.prepareRestore(offered.writerId); assert(review);
  let changed = false;
  const drift = () => {
    if (changed) return; changed = true;
    const ledger = JSON.parse(f.values.get(WORKSPACE_EDIT_RECOVERY_KEY)!); ledger.slots[0].raw += " \n"; f.values.set(WORKSPACE_EDIT_RECOVERY_KEY, JSON.stringify(ledger));
  };
  if (reentrant === "installation guard") f.behavior.onInstallationCheck = drift;
  else f.owner.subscribe(() => { if (f.owner.getSnapshot().phase === "hydrating") drift(); });
  assert.equal(await f.owner.restore(review), false); assert.equal(f.publications(), 0); assert.equal(f.text(), "live raw input");
  assert.equal(await f.owner.exportCandidate(offered.writerId), offered.raw + " \n");
});
test("reviewed-candidate origin lease expires its escaped guard and preserves exact stored bytes", async () => {
  const f = await fixture(), offered = await f.offer(), before = f.snapshot(); let escaped!: () => void, effects = 0;
  await f.realStore.withReviewedCandidate(offered.writerId, offered.sequence, offered.raw, () => true, (slot, assertCurrent) => {
    assert.equal(slot.raw, offered.raw); escaped = assertCurrent; assertCurrent();
  });
  const reads = f.effects.length; assert.throws(() => { escaped(); effects++; }, /expired/);
  assert.equal(effects, 0); assert.equal(f.effects.length, reads); assert.deepEqual(f.snapshot(), before);
});
test("reviewed-candidate lease on unsupported native refuses before source or storage reads", async () => {
  const f = await fixture("native"), raw = serializeWorkspaceEditRecovery(f.make("offered-writer", 1)); f.effects.length = 0; let effects = 0;
  await assert.rejects(f.realStore.withReviewedCandidate("offered-writer", 1, raw, () => true, () => { effects++; }), /browser storage/);
  assert.equal(effects, 0); assert.deepEqual(f.effects, []); assert.deepEqual(f.events, []);
});
