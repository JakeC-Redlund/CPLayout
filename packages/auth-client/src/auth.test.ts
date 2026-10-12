import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ApiClient, ApiError } from "./apiClient";
import { parseAccessSnapshot, parseProjectMetadataList, parseCatalogMetadata, type AccessSnapshot, type OfflineGrant } from "./contracts";
import { advanceOfflineClock, bytesToHex, verifyOfflineGrant } from "./offline";
import { FieldWorkCache, cacheKey, type CachedFieldWork } from "./cache";
import { readPublicServiceConfig, resolveServiceConnection } from "./publicConfig";
const instant = Date.now(), privateKey = randomBytes(32), publicKey = bytesToHex(ed25519.getPublicKey(privateKey));
const principal = { id: "fixture-user", username: "fixture", displayName: "Fixture", roles: ["operator" as const] };
const access: AccessSnapshot = { principal, workspaces: [{ workspaceId: "fixture-workspace", workspaceName: "Fixture", permissions: ["field:read", "field:write"], policyRevision: 0 }], csrfToken: "fixture-csrf", serverTime: new Date(instant).toISOString() };
test("default transport preserves the browser host receiver before authenticating", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = function (this: unknown) {
    assert.equal(this, globalThis, "host fetch must receive its own global object"); calls++;
    return Promise.resolve(new Response(JSON.stringify(access), { status: 200 }));
  } as typeof fetch;
  try { assert.equal((await new ApiClient().login("fixture", "synthetic password")).principal.id, principal.id); assert.equal(calls, 1); }
  finally { globalThis.fetch = original; }
});
test("trusted gateway endpoint and public pin override a compiled synthetic configuration", () => {
  const runtime = readPublicServiceConfig({ __CPLAYOUT_PUBLIC_CONFIG__: { apiUrl: "", offlinePublicKey: "a".repeat(64) } });
  assert.deepEqual(resolveServiceConnection({}, runtime, { apiUrl: "https://synthetic.example", offlinePublicKey: "b".repeat(64) }), { apiUrl: "", offlinePublicKey: "a".repeat(64) });
  assert.deepEqual(resolveServiceConnection({ apiUrl: "https://explicit.example", offlinePublicKey: "c".repeat(64) }, runtime, {}), { apiUrl: "https://explicit.example", offlinePublicKey: "c".repeat(64) });
});
test("project metadata retains actual customer identity and rejects missing names rather than supplying business labels", () => {
  const project = { id: "actual-project", clientId: "actual-customer", name: "Shared project name", customerDisplayName: "Supplied customer name  ", projectCrs: null,
    unitSystem: "metric", createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z", archived: false, individuallyArchived: false };
  const parsed = parseProjectMetadataList({ projects: [project] }); assert.deepEqual(parsed.projects[0], project);
  project.customerDisplayName = "later changed customer"; assert.equal(parsed.projects[0].customerDisplayName, "Supplied customer name  ");
  assert.throws(() => parseProjectMetadataList({ projects: [{ ...project, customerDisplayName: undefined }] }), /customer information/);
  assert.throws(() => parseProjectMetadataList({ projects: [project, { ...project, clientId: "different-customer" }] }), /customer information/);
  const snapshot = { workspaceId: "actual-workspace", revision: 4, principalId: "actual-principal", policyRevision: 0, customers: [{ id: "actual-customer", displayName: project.customerDisplayName, archived: false }, { id: "empty-customer", displayName: "Actual empty customer", archived: false }], projects: [project] };
  assert.deepEqual(parseCatalogMetadata(snapshot, snapshot.workspaceId), snapshot);
  assert.throws(() => parseCatalogMetadata(snapshot, "other-workspace"), /another workspace/);
  assert.throws(() => parseCatalogMetadata({ ...snapshot, projects: [{ ...project, clientId: "unknown-parent" }] }, snapshot.workspaceId), /saved customer folder/);
  assert.throws(() => parseCatalogMetadata({ ...snapshot, projects: [{ ...project, customerDisplayName: "Invented name" }] }, snapshot.workspaceId), /saved customer folder/);
  assert.throws(() => parseCatalogMetadata({ ...snapshot, projects: [{ ...project, archived: true }] }, snapshot.workspaceId), /saved customer folder/);
});
test("customer-folder reads reject a foreign cookie actor or changed policy without publishing its metadata", async () => {
  for (const mismatch of ["principal", "policy"] as const) {
    const metadata = { workspaceId: "fixture-workspace", revision: 0, principalId: mismatch === "principal" ? "other-tab-user" : principal.id,
      policyRevision: mismatch === "policy" ? 1 : 0, customers: [{ id: "actual-empty-customer", displayName: "Actual empty customer", archived: false }], projects: [] };
    const api = new ApiClient({ fetch: (async path => new Response(JSON.stringify(String(path).endsWith("catalog-metadata") ? metadata : access), { status: 200 })) as typeof fetch });
    await api.restore(); const failures: string[] = []; api.subscribeAccessFailures(({ error }) => failures.push(error.code));
    await assert.rejects(api.catalogMetadata("fixture-workspace"), error => error instanceof ApiError && error.code === "account_changed");
    assert.equal(api.access!.principal.id, principal.id); assert.equal(api.accessDenied, true); assert.deepEqual(failures, ["account_changed"]);
  }
});
test("customer-folder response retired by a newer sign-in cannot publish or deny the new account", async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), reading = new Promise<void>(resolve => { entered = resolve; });
  const newer = { ...access, principal: { ...principal, id: "new-account" } };
  const api = new ApiClient({ fetch: (async path => {
    if (String(path).endsWith("catalog-metadata")) { entered(); await held; return new Response(JSON.stringify({ workspaceId: "fixture-workspace", revision: 0, principalId: principal.id, policyRevision: 0, customers: [], projects: [] })); }
    return new Response(JSON.stringify(String(path).endsWith("login") ? newer : access));
  }) as typeof fetch });
  await api.restore(); const preceding = api.catalogMetadata("fixture-workspace"); await reading;
  await api.login("new-account", "synthetic password"); release();
  await assert.rejects(preceding, error => error instanceof ApiError && error.code === "retired_request");
  assert.equal(api.access!.principal.id, newer.principal.id); assert.equal(api.accessDenied, false);
  await assert.rejects(api.catalogMetadata("fixture-workspace", { principalId: principal.id, policyRevision: 0 }), error => error instanceof ApiError && error.code === "retired_request");
  assert.equal(api.accessDenied, false);
});
test("retired successful business response cannot publish after a newer sign-in while its JSON is held", async () => {
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), reading = new Promise<void>(resolve => { entered = resolve; });
  const newer = { ...access, principal: { ...principal, id: "new-field-reader" } };
  const api = new ApiClient({ fetch: (async path => {
    if (String(path).endsWith("fixture-workspace")) return { ok: true, status: 200, async json() { entered(); await held; return { workspaceId: "fixture-workspace", revision: 0, document: "same authoritative shared source", sha256: "synthetic-check" }; } } as Response;
    return new Response(JSON.stringify(String(path).endsWith("login") ? newer : access));
  }) as typeof fetch });
  await api.restore(); const preceding = api.workspace("fixture-workspace"); await reading;
  await api.login("new-field-reader", "synthetic password"); release();
  await assert.rejects(preceding, error => error instanceof ApiError && error.code === "retired_request");
  assert.equal(api.access!.principal.id, newer.principal.id); assert.equal(api.accessDenied, false);
});
function authorization() {
  const grant: OfflineGrant = { grantVersion: "cplayout-offline-grant-v1", id: "fixture-grant", subject: principal.id, workspaceId: "fixture-workspace", principal, workspaceName: "Fixture",
    projectIds: ["fixture-project"], permissions: ["field:read", "field:write"], policyRevision: 0, issuedAt: new Date(instant).toISOString(), expiresAt: new Date(instant + 86_400_000).toISOString() };
  const payload = JSON.stringify(grant);
  return { grant: { payload, signature: bytesToHex(ed25519.sign(new TextEncoder().encode(payload), privateKey)), keyId: "fixture-key" }, verificationKey: publicKey,
    clock: { lastWallTime: instant, serverTime: instant, monotonicTime: 0, processId: "fixture-process" } };
}
test("signed field authorization rejects tampering, wrong principal, expiry and clock rollback", () => {
  const auth = authorization(), expected = { subject: principal.id, workspaceId: "fixture-workspace" };
  assert.equal(verifyOfflineGrant(auth.grant, publicKey, expected, instant).principal.id, principal.id);
  assert.throws(() => verifyOfflineGrant({ ...auth.grant, payload: auth.grant.payload.replace('fixture-project', 'different-project') }, publicKey, expected, instant), /verified/);
  assert.throws(() => verifyOfflineGrant(auth.grant, publicKey, { ...expected, subject: "another-user" }, instant));
  assert.throws(() => verifyOfflineGrant(auth.grant, publicKey, expected, instant + 86_400_000), /expired/);
  assert.throws(() => advanceOfflineClock(auth.clock, { now: () => instant - 1, monotonic: () => 1 }, "new-process"), /clock/);
  assert.throws(() => advanceOfflineClock(auth.clock, { now: () => instant, monotonic: () => 5000 }, "fixture-process"), /clock/);
});
test("offline writes require trusted key, granted project and allowed field operation", async () => {
  const items = new Map<string, string>(), storage = { read: async (key: string) => items.get(key) ?? null, write: async (key: string, value: string) => { items.set(key, value); } };
  const initial: CachedFieldWork = { subject: principal.id, workspaceId: "fixture-workspace", document: "exact original", authorization: authorization(), queue: [] };
  const cache = new FieldWorkCache(storage, principal.id, "fixture-workspace", publicKey); await cache.retain(initial);
  const command = { commandId: "fixture-action", expectedRevision: 0, command: { type: "save_design_draft", exactEvidence: "retained" } }, clock = { now: () => instant + 1, monotonic: () => 1 };
  await assert.rejects(new FieldWorkCache(storage, principal.id, "fixture-workspace").queue(command, "changed", "fixture-project", clock, "fixture-process"), /trusted signing key/);
  await assert.rejects(cache.queue(command, "changed", "other-project", clock, "fixture-process"), /online access/);
  await assert.rejects(cache.queue({ ...command, command: { type: "delete_client" } }, "changed", "fixture-project", clock, "fixture-process"), /online access/);
  assert.equal((await cache.read())!.document, "exact original");
  await cache.queue(command, "exact new", "fixture-project", clock, "fixture-process"); assert.equal((await cache.read())!.queue.length, 1);
  assert.equal(await new FieldWorkCache(storage, "different-user", "fixture-workspace").read(), null);
});
test("revoked synchronization retains exact rejected evidence and every later action", async () => {
  const items = new Map<string, string>(), storage = { read: async (key: string) => items.get(key) ?? null, write: async (key: string, value: string) => { items.set(key, value); } };
  const cache = new FieldWorkCache(storage, principal.id, "fixture-workspace", publicKey), command = { commandId: "first", expectedRevision: 10, command: { type: "append_survey_capture", point: { raw: "exact original evidence " } } };
  const later = { commandId: "later", expectedRevision: 11, command: { type: "save_design_draft", raw: "unsynchronized later raw text" } };
  await cache.retain({ subject: principal.id, workspaceId: "fixture-workspace", document: "combined document", authorization: authorization(), queue: [{ ...command, state: "pending" }, { ...later, state: "pending" }] });
  const api = { access, command: async () => { throw new ApiError(403, "forbidden", "Access was revoked."); } } as unknown as ApiClient;
  await assert.rejects(cache.sync(api), /revoked/); const retained = (await cache.read())!;
  assert.deepEqual(retained.queue[0].command, command.command); assert.deepEqual(retained.queue[1], { ...later, state: "pending" }); assert.equal(retained.queue[0].state, "rejected"); assert.equal(retained.document, "combined document");
  assert.equal(cacheKey(principal.id, "fixture-workspace") === cacheKey("another-user", "fixture-workspace"), false);
});
test("native token never enters public access snapshot and offline sign-out retains only secure revocation", async () => {
  const parsed = parseAccessSnapshot({ ...access, nativeToken: "must-not-be-cached" }); assert.equal("nativeToken" in parsed, false);
  let active: string | null = null, revocation: string | null = null, unavailable = false;
  const store = { get: async () => active, set: async (token: string) => { active = token; }, clear: async () => { active = null; },
    getRevocation: async () => revocation, retainRevocation: async (token: string) => { revocation = token; }, clearRevocation: async () => { revocation = null; } };
  const headers: string[] = [];
  const fetcher = (async (_url: unknown, options: RequestInit) => { if (unavailable) throw new TypeError("Network unavailable"); headers.push((options.headers as Record<string, string>).Authorization ?? ""); return new Response(JSON.stringify(options.method === "POST" && options.body ? { ...access, nativeToken: "fixture-native-token" } : { signedOut: true }), { status: 200 }); }) as typeof fetch;
  const api = new ApiClient({ fetch: fetcher, nativeSession: store }); await api.login("fixture", "synthetic password"); unavailable = true;
  await assert.rejects(api.logout()); assert.equal(active, null); assert.equal(api.access, null); assert.equal(revocation, "fixture-native-token");
  unavailable = false; await api.retryLogout(); assert.equal(revocation, null); assert.equal(headers.at(-1), "Bearer fixture-native-token");
});
test("observed server access denial notifies the current account and retires local mutation authority", async () => {
  let denied = false;
  const fetcher = (async () => new Response(JSON.stringify(denied ? { code: "forbidden", message: "Workspace access changed." } : access), { status: denied ? 403 : 200 })) as typeof fetch;
  const api = new ApiClient({ fetch: fetcher }); await api.restore(); const failures: string[] = []; api.subscribeAccessFailures(({ path }) => failures.push(path));
  denied = true; await assert.rejects(api.workspace("fixture-workspace")); assert.equal(api.accessDenied, true); assert.deepEqual(failures, ["/api/v1/workspaces/fixture-workspace"]);
  assert.equal(api.access!.principal.id, principal.id); denied = false; await api.restore(); assert.equal(api.accessDenied, false);
});
test("account replacement during asynchronous token access retires the preceding request before HTTP", async () => {
  let release!: (token: string | null) => void, calls = 0, tokenReads = 0;
  const token = new Promise<string | null>(resolve => { release = resolve; });
  const store = { get: () => ++tokenReads === 1 ? token : Promise.resolve(null), set: async () => undefined, clear: async () => undefined };
  const api = new ApiClient({ nativeSession: store, fetch: (async () => { calls++; return new Response(JSON.stringify({ ...access, nativeToken: "synthetic-new-session" }), { status: 200 }); }) as typeof fetch });
  const preceding = api.workspace("fixture-workspace"); await api.login("fixture", "synthetic password"); release(null);
  await assert.rejects(preceding, error => error instanceof ApiError && error.code === "retired_request"); assert.equal(calls, 1);
});
