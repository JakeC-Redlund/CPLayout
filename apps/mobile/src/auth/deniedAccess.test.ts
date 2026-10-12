import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient, cacheKey } from "@cplayout/auth-client";
import { AccountDenialQueue, deniedAccountKey, retainAccountDenial } from "./deniedAccess";
import type { AtomicAuthStorage } from "./authStorage";
import { AccountNavigationBoundary } from "./navigationBoundary";
import { createSyntheticApi } from "../../../api/src/testHarness";
test("cold known-account denial is durable and cannot revive its cached grant offline", async () => {
  const items = new Map<string, string>(), subject = "known-synthetic-account", workspace = "known-workspace", key = cacheKey(subject, workspace);
  const original = { subject, workspaceId: workspace, document: "exact original field document ", authorization: { grant: "retained previous grant" }, queue: [{ commandId: "evidence", command: { point: "exact immutable observation " }, state: "pending" }] };
  items.set(key, JSON.stringify(original));
  const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, action) => action() };
  await retainAccountDenial(storage, subject, workspace);
  const next = JSON.parse(items.get(key)!); assert.equal(next.authorization, null); assert.equal(next.document, original.document); assert.deepEqual(next.queue, original.queue);
  assert.equal(await storage.read(deniedAccountKey(subject)), "denied");
  assert.deepEqual({ ...next, authorization: original.authorization }, original);
});
test("cache quota failure still retains denial before the old grant can be read by a cold process", async () => {
  const subject = "quota-account", workspace = "quota-workspace", partition = cacheKey(subject, workspace), original = JSON.stringify({ subject, workspaceId: workspace,
    document: "exact untouched work", authorization: { grant: "previously prepared grant" }, queue: [] });
  const items = new Map<string, string>([[partition, original]]), writes: string[] = [];
  const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => {
    writes.push(key); if (key === partition) throw new Error("Synthetic cache quota"); items.set(key, value);
  }, exclusive: async (_key, action) => action() };
  await assert.rejects(retainAccountDenial(storage, subject, workspace), /quota/);
  assert.deepEqual(writes, [deniedAccountKey(subject), partition]);
  assert.equal(items.get(partition), original); assert.equal(await storage.read(deniedAccountKey(subject)), "denied");
  // A separate process uses the durable marker before considering an old grant.
  const coldRead = async () => { if (await storage.read(deniedAccountKey(subject))) throw new Error("Renew access online"); return storage.read(partition); };
  await assert.rejects(coldRead(), /Renew access online/);
});
test("denial-marker failure still attempts to clear authorization without losing work", async () => {
  const subject = "marker-quota", workspace = "marker-workspace", partition = cacheKey(subject, workspace);
  const original = { subject, workspaceId: workspace, document: "exact raw evidence", authorization: { grant: "old grant" }, queue: [] };
  const items = new Map<string, string>([[partition, JSON.stringify(original)]]);
  const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => {
    if (key === deniedAccountKey(subject)) throw new Error("Synthetic marker quota"); items.set(key, value);
  }, exclusive: async (_key, action) => action() };
  await assert.rejects(retainAccountDenial(storage, subject, workspace), /marker quota/);
  assert.deepEqual(JSON.parse(items.get(partition)!), { ...original, authorization: null });
});
test("concurrent real service denials share one preservation boundary and retain exact work before renewal", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let release!: () => void;
  try {
    let cookie = "", entered!: () => void, boundaryActive = false, guardCalls = 0, restored = false;
    const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const fetcher = (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const api = new ApiClient({ fetch: fetcher }), access = await api.login(fixture.username, fixture.password), source = await api.workspace(fixture.workspaceId), grant = await api.offlineGrant(fixture.workspaceId);
    const partition = cacheKey(access.principal.id, fixture.workspaceId), original = { subject: access.principal.id, workspaceId: fixture.workspaceId, document: source.document,
      authorization: { grant: grant.grant, verificationKey: grant.verificationKey, clock: { serverTime: Date.parse(grant.serverTime), lastWallTime: Date.now(), monotonicTime: 0, processId: "denial-fixture" } },
      queue: [{ commandId: "retained-synthetic-evidence", expectedRevision: source.revision, command: { type: "save_design_draft", retained: "exact pending evidence" }, state: "pending" }] };
    const items = new Map<string, string>([[partition, JSON.stringify(original)]]);
    const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, action) => action() };
    const boundary = new AccountNavigationBoundary(() => JSON.stringify([access.principal.id, fixture.workspaceId]));
    boundary.register(async () => { if (boundaryActive) return false; boundaryActive = true; guardCalls++; entered(); await held; boundaryActive = false; return true; });
    const queue = new AccountDenialQueue(), jobs: Promise<void>[] = [];
    const stop = api.subscribeAccessFailures(() => { jobs.push(queue.enqueue("same-account-session-denial", async () => {
      await retainAccountDenial(storage, access.principal.id, fixture.workspaceId, fixture.offlinePublicKey);
      const preserved = await boundary.preserve(); assert.equal(preserved, "preserved"); restored = true;
    })); });
    await fixture.database.transaction(async transaction => transaction.updateUserAccess(access.principal.id, ["admin"], false));
    const failed = await Promise.allSettled([api.workspace(fixture.workspaceId), api.archiveState(fixture.workspaceId)]); await started;
    assert(failed.every(result => result.status === "rejected")); assert.equal(api.accessDenied, true); assert.equal(jobs.length, 2); assert.equal(jobs[0], jobs[1]);
    assert.equal(guardCalls, 1); assert.equal(restored, false); assert.equal(items.get(deniedAccountKey(access.principal.id)), "denied");
    assert.deepEqual(JSON.parse(items.get(partition)!), { ...original, authorization: null });
    release(); await Promise.all(jobs); await queue.whenIdle(); stop(); assert.equal(restored, true); assert.equal(guardCalls, 1);
    await assert.rejects(queue.enqueue("failed-storage", async () => { throw new Error("Synthetic preservation failure"); }), /preservation failure/);
    let later = false; await queue.enqueue("later-preservation-job", async () => { later = true; }); assert.equal(later, true);
  } finally { release?.(); await fixture.api.close(); }
});
