import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { ApiClient, type AccessSnapshot } from "@cplayout/auth-client";
import { createSyntheticApi } from "./testHarness";
import { argonPasswords } from "./passwords";

async function browserCookieFixture() {
  const fixture = await createSyntheticApi("http://localhost:19040"), password = randomBytes(24).toString("base64url"), id = randomUUID();
  await fixture.database.addUser({ id, username: "second-synthetic", displayName: "Second synthetic", roles: ["operator"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read"]);
  let cookie = "", loginRequests = 0, delayLogout = false, release!: () => void, entered!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; }), logoutEntered = new Promise<void>(resolve => { entered = resolve; });
  const fetcher = (async (path: string, init: RequestInit) => {
    const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
    if (path.endsWith("/login")) loginRequests++;
    const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers.entries()), payload: init.body as string | undefined });
    if (delayLogout && path.endsWith("/logout")) { delayLogout = false; entered(); await barrier; }
    // Apply response Set-Cookie exactly when this synthetic browser receives it,
    // including a delayed logout response that would clear a later session.
    if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]).split(";")[0];
    return new Response(response.body, { status: response.statusCode });
  }) as typeof fetch;
  const client = new ApiClient({ fetch: fetcher });
  return { fixture, client, fetcher, id, password, logoutEntered, release, delay: () => { delayLogout = true; }, loginRequests: () => loginRequests };
}
test("serialized cookie-changing responses finish logout before a newer login receives its session", async () => {
  const test = await browserCookieFixture();
  try {
    await test.client.login(test.fixture.username, test.fixture.password); test.delay();
    const logout = test.client.logout(); await test.logoutEntered;
    const newer = test.client.login("second-synthetic", test.password); await Promise.resolve();
    assert.equal(test.loginRequests(), 1, "newer login cannot race the delayed logout Set-Cookie");
    test.release(); await logout; const actual = await newer; assert.equal(actual.principal.id, test.id);
    assert.equal((await test.client.restore())!.principal.id, test.id); assert.equal((await test.client.workspace(test.fixture.workspaceId)).workspaceId, test.fixture.workspaceId);
  } finally { test.release(); await test.fixture.api.close(); }
});
test("different client instances share the service credential queue until delayed cookie effects settle", async () => {
  const test = await browserCookieFixture(), second = new ApiClient({ fetch: test.fetcher });
  try {
    await test.client.login(test.fixture.username, test.fixture.password); test.delay();
    const olderLogout = test.client.logout(); await test.logoutEntered;
    const newerLogin = second.login("second-synthetic", test.password); await Promise.resolve(); await Promise.resolve();
    assert.equal(test.loginRequests(), 1); test.release(); await olderLogout; await newerLogin;
    assert.equal((await second.restore())!.principal.id, test.id); assert.equal((await second.workspace(test.fixture.workspaceId)).workspaceId, test.fixture.workspaceId);
  } finally { test.release(); await test.fixture.api.close(); }
});
test("failed older sign-in retention reconciles only its issued session and preserves a newer cookie", async () => {
  const test = await browserCookieFixture();
  try {
    const preceding: AccessSnapshot = await test.client.login(test.fixture.username, test.fixture.password);
    await test.client.login("second-synthetic", test.password);
    await assert.rejects(test.client.revokeIssuedSession(preceding), /preceding sign-in/);
    assert.equal(test.client.access!.principal.id, test.id); assert.equal((await test.client.restore())!.principal.id, test.id);
    assert.equal((await test.client.workspace(test.fixture.workspaceId)).workspaceId, test.fixture.workspaceId);
  } finally { await test.fixture.api.close(); }
});

test("actual server principal check refuses an externally replaced native token before domain mutation", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"), password = randomBytes(24).toString("base64url"), id = randomUUID(); let token: string | null = null;
  try {
    await fixture.database.addUser({ id, username: "native-other", displayName: "Native other", roles: ["admin"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read", "field:write", "catalog:write"]);
    const client = new ApiClient({ nativeSession: { get: async () => token, set: async value => { token = value; }, clear: async () => { token = null; } }, fetch: (async (path: string, init: RequestInit) => {
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(new Headers(init.headers).entries()), payload: init.body as string | undefined });
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch });
    await client.login(fixture.username, fixture.password); const original = fixture.database.state.workspaces[0].document;
    const replacement = await fixture.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: "native-other", password, native: true } }); assert.equal(replacement.statusCode, 200); token = replacement.json().nativeToken;
    await assert.rejects(client.command(fixture.workspaceId, { commandId: randomUUID(), expectedRevision: fixture.database.state.workspaces[0].revision,
      command: { type: "create_client", id: "forbidden-actor", input: { primaryContactFirstName: "Wrong", primaryContactLastName: "Actor" }, now: new Date().toISOString() } }), /signed-in account changed/);
    assert.equal(client.accessDenied, true); assert.equal(fixture.database.state.workspaces[0].document, original); assert.equal(fixture.database.state.receipts.length, 0);
  } finally { await fixture.api.close(); }
});

test("older native client logout targets its issued token and preserves another client's active secure token", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"), password = randomBytes(24).toString("base64url"), id = randomUUID(); let token: string | null = null;
  try {
    await fixture.database.addUser({ id, username: "native-shared", displayName: "Native shared", roles: ["operator"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read"]);
    const store = { serviceIdentity: "actual-synthetic-shared-native-service", get: async () => token, set: async (value: string) => { token = value; }, clear: async () => { token = null; } };
    const fetcher = (async (path: string, init: RequestInit) => {
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(new Headers(init.headers).entries()), payload: init.body as string | undefined });
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const older = new ApiClient({ fetch: fetcher, nativeSession: store }), newer = new ApiClient({ fetch: fetcher, nativeSession: store });
    await older.login(fixture.username, fixture.password); await newer.login("native-shared", password); const newerToken = token;
    await older.logout(); assert.equal(token, newerToken); assert.equal(older.access, null);
    assert.equal((await newer.restore())!.principal.id, id); assert.equal((await newer.workspace(fixture.workspaceId)).workspaceId, fixture.workspaceId);
  } finally { await fixture.api.close(); }
});
