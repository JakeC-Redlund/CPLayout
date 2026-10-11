import assert from "node:assert/strict";
import test from "node:test";
import { emptyWorkspaceEditRecoveryUi, parseWorkspaceEditRecovery, serializeWorkspaceEditRecovery, WORKSPACE_EDIT_RECOVERY_VERSION,
  type WorkspaceEditRecoveryCandidate } from "./workspaceEditRecovery";
import { createWorkspaceEditRecoveryStore, WorkspaceEditRecoveryStoreError, WORKSPACE_EDIT_RECOVERY_KEY, WORKSPACE_EDIT_RECOVERY_LOCK,
  WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, WORKSPACE_EDIT_RECOVERY_MAX_BYTES,
  type StorageLike, type WorkspaceEditRecoveryExclusiveLock, type WorkspaceEditRecoveryStoreErrorCode } from "./workspaceEditRecoveryStore";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function originLock() {
  let tail: Promise<void> = Promise.resolve(), held = false;
  const lock: WorkspaceEditRecoveryExclusiveLock = (name, task) => {
    assert.equal(name, WORKSPACE_EDIT_RECOVERY_LOCK);
    const result = tail.then(async () => { assert.equal(held, false); held = true; try { return await task(); } finally { held = false; } });
    tail = result.then(() => undefined, () => undefined); return result;
  };
  return { lock, isHeld: () => held, async hold() {
    const entered = deferred(), release = deferred();
    const completion = lock(WORKSPACE_EDIT_RECOVERY_LOCK, async () => { entered.resolve(); await release.promise; });
    await entered.promise; return async () => { release.resolve(); await completion; };
  } };
}
function storageFixture(origin = originLock()) {
  const values = new Map<string, string>([["center-pivot-layout-workspace-v1", "exact durable workspace"],
    ["cplayout-unified-context-v2", "exact optional context"], ["cplayout-workspace-resume-v1", "exact legacy preference"]]);
  const effects: Array<{ operation: "read" | "write"; key: string; raw?: string }> = [];
  const behavior: { readFailure?: Error; writeFailure?: Error; afterRead?: (value: string | null) => void } = {};
  const storage: StorageLike = {
    getItem(key) {
      assert.equal(origin.isHeld(), true, "all reads require the shared origin lock");
      effects.push({ operation: "read", key }); if (behavior.readFailure) throw behavior.readFailure;
      const value = values.get(key) ?? null; behavior.afterRead?.(value); return value;
    },
    setItem(key, raw) {
      assert.equal(origin.isHeld(), true, "all writes require the shared origin lock");
      effects.push({ operation: "write", key, raw }); if (behavior.writeFailure) throw behavior.writeFailure;
      values.set(key, raw);
    },
  };
  const store = createWorkspaceEditRecoveryStore({ backend: "web", storage, withExclusiveLock: origin.lock });
  return { values, effects, behavior, storage, store, origin,
    snapshot: () => [...values], raw: () => values.get(WORKSPACE_EDIT_RECOVERY_KEY) ?? null,
    assertProtected() {
      assert.equal(values.get("center-pivot-layout-workspace-v1"), "exact durable workspace");
      assert.equal(values.get("cplayout-unified-context-v2"), "exact optional context");
      assert.equal(values.get("cplayout-workspace-resume-v1"), "exact legacy preference");
      assert(effects.every(effect => effect.key === WORKSPACE_EDIT_RECOVERY_KEY));
    } };
}
function candidate(writerId = "writer-a", sequence = 1, fileText = "unfinished 12' x  \n  € 🧭") {
  const ui = emptyWorkspaceEditRecoveryUi();
  return { recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION, writerId, sequence, capturedAt: "2026-10-11T12:00:00.000Z",
    context: { version: 2 as const, catalogVisible: true, catalogSelection: { clientId: null, projectId: null, fieldMapId: null, designId: null },
      workspace: { mode: "design" as const, design: null, layout: null, collectionId: null } },
    workspaceRevision: 0, editable: null, collections: [], layout: null,
    controller: { historyPast: [], historyFuture: [], selectedAddress: null },
    inputs: { entries: [{ key: "raw/unfinished", baselineFingerprint: '"baseline"', cleanFingerprint: '"baseline"', value: "  invalid entered text\n\t  " }], focus: null },
    ui: { ...ui, file: { ...ui.file, text: fileText } }, cameras: [] } satisfies WorkspaceEditRecoveryCandidate;
}
function ledger(slots: Array<{ writerId: string; sequence: number; raw: string }>) {
  return JSON.stringify({ ledgerVersion: WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, slots });
}
async function refuses(operation: Promise<unknown>, code: WorkspaceEditRecoveryStoreErrorCode) {
  await assert.rejects(operation, error => error instanceof WorkspaceEditRecoveryStoreError && error.code === code);
}
const current = () => true;

test("construction performs zero storage access, and all unsupported methods refuse before reads or lock fallback", async () => {
  for (const scenario of ["native", "no lock", "no storage"] as const) {
    let reads = 0, writes = 0, locks = 0;
    const storage: StorageLike = { getItem() { reads++; throw new Error("must not read"); }, setItem() { writes++; throw new Error("must not write"); } };
    const store = createWorkspaceEditRecoveryStore({ backend: scenario === "native" ? "native" : "web", storage: scenario === "no storage" ? null : storage,
      withExclusiveLock: scenario === "no lock" ? null : async (_name, task) => { locks++; return task(); } });
    assert.deepEqual({ reads, writes, locks }, { reads: 0, writes: 0, locks: 0 });
    await refuses(store.readCandidates(), "unsupported"); await refuses(store.checkpoint(candidate(), null, current), "unsupported");
    await refuses(store.discard("writer-a", 1, current), "unsupported"); await refuses(store.exportCandidate("writer-a"), "unsupported");
    await refuses(store.exportRawLedger(), "unsupported"); assert.deepEqual({ reads, writes, locks }, { reads: 0, writes: 0, locks: 0 });
  }
  // Missing/native support must short-circuit even storage method getters.
  let propertyReads = 0;
  const surface = Object.defineProperty({}, "getItem", { get() { propertyReads++; throw new Error("storage property must remain untouched"); } }) as StorageLike;
  for (const backend of ["web", "native"] as const) {
    const store = createWorkspaceEditRecoveryStore({ backend, storage: surface, withExclusiveLock: null });
    await refuses(store.readCandidates(), "unsupported"); await refuses(store.checkpoint(candidate(), null, current), "unsupported");
  }
  assert.equal(propertyReads, 0);
});
test("unavailable origin lock and storage reads are typed refusals with no unlocked retry", async () => {
  let reads = 0;
  const broken = createWorkspaceEditRecoveryStore({ backend: "web", storage: { getItem() { reads++; return null; }, setItem() { assert.fail("must not write"); } },
    withExclusiveLock: async () => { throw new Error("origin lock unavailable"); } });
  await refuses(broken.readCandidates(), "unsupported"); assert.equal(reads, 0);
  const f = storageFixture(); f.behavior.readFailure = new DOMException("access denied", "SecurityError");
  const before = f.snapshot(); await refuses(f.store.checkpoint(candidate(), null, current), "unsupported"); assert.deepEqual(f.snapshot(), before);
});
test("a checkpoint returns only a recovery receipt and preserves exact raw whitespace and protected domain keys", async () => {
  const f = storageFixture(), input = candidate(), expected = serializeWorkspaceEditRecovery(input);
  assert.deepEqual(await f.store.readCandidates(), []); assert.equal(await f.store.exportRawLedger(), null);
  const receipt = await f.store.checkpoint(input, null, current);
  assert.deepEqual(Object.keys(receipt).sort(), ["candidate", "raw", "sequence", "writerId"]);
  assert.equal(receipt.raw, expected); assert.deepEqual(receipt.candidate, parseWorkspaceEditRecovery(expected));
  assert.equal(receipt.candidate.inputs.entries[0].value, "  invalid entered text\n\t  ");
  assert.equal(receipt.candidate.ui.file.text, input.ui.file.text);
  assert.equal(await f.store.exportCandidate("writer-a"), expected);
  assert.equal(await f.store.exportRawLedger(), f.raw()); f.assertProtected();
});
test("candidate admission detaches before waiting, and returned objects cannot mutate durable checkpoints", async () => {
  const f = storageFixture(), release = await f.origin.hold(), input = candidate(), expected = serializeWorkspaceEditRecovery(input);
  const pending = f.store.checkpoint(input, null, current); input.ui.file.text = "newer unacknowledged input"; input.inputs.entries[0].value = "newer raw input";
  await release(); const receipt = await pending;
  assert.equal(receipt.raw, expected); receipt.writerId = "mutated receipt metadata";
  const listed = await f.store.readCandidates(); listed[0].raw = "mutated returned raw"; listed.length = 0;
  assert.equal(await f.store.exportCandidate("writer-a"), expected);
  assert.equal((await f.store.readCandidates())[0].candidate.ui.file.text, candidate().ui.file.text);
});
test("two stores sharing the origin lock preserve each other's independent writer slots", async () => {
  const f = storageFixture(), other = createWorkspaceEditRecoveryStore({ backend: "web", storage: f.storage, withExclusiveLock: f.origin.lock });
  const [a, b] = await Promise.all([f.store.checkpoint(candidate("writer-a"), null, current), other.checkpoint(candidate("writer-b"), null, current)]);
  await other.checkpoint(candidate("writer-b", 2, "B newer"), 1, current);
  assert.equal(await f.store.exportCandidate("writer-a"), a.raw);
  assert.notEqual(await other.exportCandidate("writer-b"), b.raw);
  assert.deepEqual((await f.store.readCandidates()).map(slot => [slot.writerId, slot.sequence]), [["writer-a", 1], ["writer-b", 2]]); f.assertProtected();
});
test("competing tabs cannot both acknowledge creation of the same writer sequence", async () => {
  const f = storageFixture(), other = createWorkspaceEditRecoveryStore({ backend: "web", storage: f.storage, withExclusiveLock: f.origin.lock });
  const outcomes = await Promise.allSettled([f.store.checkpoint(candidate(), null, current), other.checkpoint(candidate("writer-a", 1, "competing input"), null, current)]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  const rejected = outcomes.find(result => result.status === "rejected"); assert(rejected?.status === "rejected");
  assert(rejected.reason instanceof WorkspaceEditRecoveryStoreError); assert.equal(rejected.reason.code, "stale");
  assert.equal(await f.store.exportCandidate("writer-a"), serializeWorkspaceEditRecovery(candidate()));
});
test("one store's FIFO admits consecutive checkpoints and refuses a duplicate without advancing it", async () => {
  const f = storageFixture(), release = await f.origin.hold();
  const first = f.store.checkpoint(candidate(), null, current), second = f.store.checkpoint(candidate("writer-a", 2, "second"), 1, current);
  const duplicate = f.store.checkpoint(candidate("writer-a", 2, "obsolete duplicate"), 1, current);
  const outcome = Promise.allSettled([first, second, duplicate]); await release(); const results = await outcome;
  assert.deepEqual(results.map(result => result.status), ["fulfilled", "fulfilled", "rejected"]);
  assert.equal((await f.store.readCandidates())[0].sequence, 2);
  assert.equal((await f.store.readCandidates())[0].candidate.ui.file.text, "second");
  assert.equal(f.effects.filter(effect => effect.operation === "write").length, 2);
});
test("retired owner and mode ABA while waiting for the origin lock cannot publish or discard", async () => {
  const f = storageFixture(); await f.store.checkpoint(candidate(), null, current); const before = f.snapshot();
  const release = await f.origin.hold(); let epoch = 1, mode = "design"; const admitted = epoch;
  const checkpoint = refuses(f.store.checkpoint(candidate("writer-a", 2), 1, () => epoch === admitted && mode === "design"), "cancelled");
  const discard = refuses(f.store.discard("writer-a", 1, () => epoch === admitted && mode === "design"), "cancelled");
  mode = "survey"; epoch++; mode = "design"; epoch++;
  await release(); await Promise.all([checkpoint, discard]); assert.deepEqual(f.snapshot(), before);
});
test("ownership is checked again immediately before the effect, even after initial admission succeeds", async () => {
  const f = storageFixture(); await f.store.checkpoint(candidate(), null, current); const before = f.snapshot(); let calls = 0;
  await refuses(f.store.checkpoint(candidate("writer-a", 2), 1, () => ++calls === 1), "cancelled");
  assert.equal(calls, 2); assert.deepEqual(f.snapshot(), before);
});
test("exact prior ledger recheck refuses semantic-equivalent byte drift without overwriting the external bytes", async () => {
  const f = storageFixture(); await f.store.checkpoint(candidate(), null, current); const before = f.raw()!, external = ` \n${before}\t `;
  f.behavior.afterRead = () => { f.behavior.afterRead = undefined; f.values.set(WORKSPACE_EDIT_RECOVERY_KEY, external); };
  await refuses(f.store.checkpoint(candidate("writer-a", 2), 1, current), "stale");
  assert.equal(f.raw(), external); assert.equal(await f.store.exportCandidate("writer-a"), serializeWorkspaceEditRecovery(candidate()));
});
test("a reentrant owner predicate cannot overwrite a foreign writer inserted before the final CAS", async () => {
  const f = storageFixture(); await f.store.checkpoint(candidate(), null, current);
  const a = serializeWorkspaceEditRecovery(candidate()), b = serializeWorkspaceEditRecovery(candidate("foreign-writer"));
  const external = ledger([{ writerId: "writer-a", sequence: 1, raw: a }, { writerId: "foreign-writer", sequence: 1, raw: b }]); let calls = 0;
  await refuses(f.store.checkpoint(candidate("writer-a", 2), 1, () => { if (++calls === 2) f.values.set(WORKSPACE_EDIT_RECOVERY_KEY, external); return true; }), "stale");
  assert.equal(f.raw(), external); assert.equal(await f.store.exportCandidate("foreign-writer"), b);
});
test("conditional discard removes only the reviewed sequence and never another writer", async () => {
  const f = storageFixture(); await f.store.checkpoint(candidate(), null, current); const b = await f.store.checkpoint(candidate("writer-b"), null, current);
  await f.store.checkpoint(candidate("writer-a", 2), 1, current); const before = f.snapshot();
  await refuses(f.store.discard("writer-a", 1, current), "stale"); assert.deepEqual(f.snapshot(), before);
  await f.store.discard("writer-a", 2, current); assert.deepEqual((await f.store.readCandidates()).map(slot => slot.writerId), ["writer-b"]);
  assert.equal(await f.store.exportCandidate("writer-b"), b.raw); await refuses(f.store.exportCandidate("writer-a"), "stale");
  const after = f.snapshot(); await refuses(f.store.discard("writer-a", 2, current), "stale"); assert.deepEqual(f.snapshot(), after);
});
test("quota failure retains every prior byte and FIFO remains usable for a later explicit retry", async () => {
  const f = storageFixture(); await f.store.checkpoint(candidate(), null, current); const before = f.snapshot();
  f.behavior.writeFailure = new DOMException("browser quota", "QuotaExceededError");
  await refuses(f.store.checkpoint(candidate("writer-a", 2), 1, current), "quota"); assert.deepEqual(f.snapshot(), before);
  await refuses(f.store.discard("writer-a", 1, current), "quota"); assert.deepEqual(f.snapshot(), before);
  f.behavior.writeFailure = undefined; await f.store.checkpoint(candidate("writer-a", 2), 1, current);
  assert.equal((await f.store.readCandidates())[0].sequence, 2); f.assertProtected();
});
test("other write failures are unsupported and retain the checkpoint without eviction or domain effects", async () => {
  const f = storageFixture(); await f.store.checkpoint(candidate(), null, current); const before = f.snapshot();
  f.behavior.writeFailure = new DOMException("storage disabled", "SecurityError");
  await refuses(f.store.checkpoint(candidate("writer-a", 2), 1, current), "unsupported"); assert.deepEqual(f.snapshot(), before); f.assertProtected();
});
test("corrupt and foreign ledgers are exportable exactly but never repaired by checkpoint or discard", async () => {
  const raw = serializeWorkspaceEditRecovery(candidate());
  const invalid = ["{ corrupt exact bytes\n", JSON.stringify({ ledgerVersion: "future", slots: [] }),
    JSON.stringify({ ledgerVersion: WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, slots: [], extra: true }),
    ledger([{ writerId: "writer-a", sequence: 2, raw }]), ledger([{ writerId: "foreign", sequence: 1, raw }]),
    ledger([{ writerId: "writer-a", sequence: 1, raw }, { writerId: "writer-a", sequence: 1, raw }]),
    ledger([{ writerId: "writer-a", sequence: 1, raw: JSON.stringify({ ...candidate(), unexpected: true }) }]),
    `{"ledgerVersion":"${WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION}","slots":[],"slots":[]}`];
  for (const corrupt of invalid) {
    const f = storageFixture(); f.values.set(WORKSPACE_EDIT_RECOVERY_KEY, corrupt); const before = f.snapshot();
    assert.equal(await f.store.exportRawLedger(), corrupt); await refuses(f.store.readCandidates(), "corrupt");
    await refuses(f.store.exportCandidate("writer-a"), "corrupt"); await refuses(f.store.checkpoint(candidate(), null, current), "corrupt");
    await refuses(f.store.discard("writer-a", 1, current), "corrupt"); assert.deepEqual(f.snapshot(), before);
  }
});
test("sixteen writers remain intact when a seventeenth slot is refused; updating a reviewed slot remains possible", async () => {
  const f = storageFixture();
  for (let i = 0; i < 16; i++) await f.store.checkpoint(candidate(`writer-${i}`), null, current);
  const before = f.snapshot(); await refuses(f.store.checkpoint(candidate("writer-16"), null, current), "limit"); assert.deepEqual(f.snapshot(), before);
  const first = await f.store.exportCandidate("writer-0"); await f.store.checkpoint(candidate("writer-15", 2), 1, current);
  assert.equal((await f.store.readCandidates()).length, 16); assert.equal(await f.store.exportCandidate("writer-0"), first);
  await f.store.discard("writer-15", 2, current); await f.store.checkpoint(candidate("new-mount-writer"), null, current);
  assert.equal((await f.store.readCandidates()).length, 16);
});
test("UTF-8 ledger size includes escaped raw candidates and rejects overflow without truncation", async () => {
  const f = storageFixture(), input = candidate("writer-a", 1, '"'.repeat(3 * 1024 * 1024));
  const raw = serializeWorkspaceEditRecovery(input); assert(Buffer.byteLength(raw, "utf8") < WORKSPACE_EDIT_RECOVERY_MAX_BYTES);
  assert(Buffer.byteLength(ledger([{ writerId: input.writerId, sequence: 1, raw }]), "utf8") > WORKSPACE_EDIT_RECOVERY_MAX_BYTES);
  const before = f.snapshot(); await refuses(f.store.checkpoint(input, null, current), "limit"); assert.deepEqual(f.snapshot(), before);
  // An existing over-bound ledger still has a lossless opaque export path.
  const oversized = " ".repeat(WORKSPACE_EDIT_RECOVERY_MAX_BYTES + 1); f.values.set(WORKSPACE_EDIT_RECOVERY_KEY, oversized);
  await refuses(f.store.readCandidates(), "limit"); assert.equal(await f.store.exportRawLedger(), oversized);
});
test("multi-byte ledger overflow preserves the already acknowledged independent writer", async () => {
  const f = storageFixture(), text = "🧭".repeat(1_100_000);
  const first = await f.store.checkpoint(candidate("writer-a", 1, text), null, current), before = f.snapshot();
  await refuses(f.store.checkpoint(candidate("writer-b", 1, text), null, current), "limit");
  assert.deepEqual(f.snapshot(), before); assert.equal(await f.store.exportCandidate("writer-a"), first.raw);
});
test("exhausted sequences cannot wrap, and malformed candidate/expected sequence cannot write", async () => {
  const f = storageFixture(), exhausted = candidate("writer-a", Number.MAX_SAFE_INTEGER), raw = serializeWorkspaceEditRecovery(exhausted);
  f.values.set(WORKSPACE_EDIT_RECOVERY_KEY, ledger([{ writerId: exhausted.writerId, sequence: exhausted.sequence, raw }]));
  const before = f.snapshot(); await refuses(f.store.checkpoint(exhausted, Number.MAX_SAFE_INTEGER, current), "limit"); assert.deepEqual(f.snapshot(), before);
  await refuses(f.store.checkpoint(candidate("writer-b", 2), null, current), "invalid");
  await refuses(f.store.checkpoint(candidate("writer-b"), 0, current), "invalid");
  await refuses(f.store.checkpoint({ ...candidate("writer-b"), sequence: 0 }, null, current), "invalid");
  await refuses(f.store.discard("writer-a", 0, current), "invalid"); assert.deepEqual(f.snapshot(), before);
});
test("candidate export preserves accepted noncanonical source formatting exactly", async () => {
  const f = storageFixture(), input = candidate(), raw = ` \n${JSON.stringify(input, null, 2)}\t `;
  parseWorkspaceEditRecovery(raw); f.values.set(WORKSPACE_EDIT_RECOVERY_KEY, ledger([{ writerId: input.writerId, sequence: 1, raw }]));
  const before = f.snapshot(); assert.equal(await f.store.exportCandidate(input.writerId), raw);
  assert.equal((await f.store.readCandidates())[0].raw, raw); assert.deepEqual(f.snapshot(), before);
});
