import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { verifyOfflineGrant } from "@cplayout/auth-client";
import { createApi } from "./server";
import { TestDatabase } from "./testDatabase";
import { bootstrapAdministrator } from "./bootstrapService";
import { argonPasswords } from "./passwords";
import { emptyWorkspaceDocument, serializeWorkspaceDocument } from "../../../packages/project-store/src/workspaceDocument";
import { exerciseRecoveryImportCas } from "./recoveryImportCasTestFixtures";
const database = new TestDatabase(), password = randomBytes(24).toString("base64url"), bootstrap = await bootstrapAdministrator(database, { username: "synthetic-admin", displayName: "Test administrator", password, workspaceName: "Synthetic workspace" });
const signingKey = randomBytes(32), clock = { now: Date.now() }, api = await createApi({ database, signingKey, origin: "http://localhost:19040", secureCookies: false, now: () => clock.now });
after(() => api.close());
async function login(username = "synthetic-admin", secret = password) { const response = await api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username, password: secret } }); return { response, body: response.json(), cookie: response.headers["set-cookie"] as string }; }
function headers(owner: Awaited<ReturnType<typeof login>>) { return { cookie: owner.cookie, "x-csrf-token": owner.body.csrfToken }; }
test("real Argon2id hashes and guarded bootstrap are never default credentials", async () => {
  assert.match(database.state.users[0].passwordHash, /^\$argon2id\$/); assert.notEqual(database.state.users[0].passwordHash, password);
  await assert.rejects(bootstrapAdministrator(database, { username: "second", displayName: "Second", password, workspaceName: "Second" }), /already complete/);
});
test("session uses HttpOnly cookie, rejects unauthenticated reads and CSRF/cross-origin commands", async () => {
  assert.equal((await api.inject({ url: `/api/v1/workspaces/${bootstrap.workspaceId}` })).statusCode, 401);
  const owner = await login(); assert.equal(owner.response.statusCode, 200); assert.match(owner.cookie, /HttpOnly/); assert.match(owner.cookie, /SameSite=Strict/); assert.equal(owner.body.nativeToken, undefined);
  const url = `/api/v1/workspaces/${bootstrap.workspaceId}/commands`, payload = { commandId: randomUUID(), expectedRevision: 4, command: { type: "create_client", id: randomUUID(), input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Operator" }, now: new Date(clock.now).toISOString() } };
  assert.equal((await api.inject({ method: "POST", url, headers: { cookie: owner.cookie }, payload })).statusCode, 403);
  assert.equal((await api.inject({ method: "POST", url, headers: { ...headers(owner), origin: "https://other.example" }, payload })).statusCode, 403);
});
test("revision CAS, identity replay and exact domain source persist atomically", async () => {
  const owner = await login(), workspaceId = bootstrap.workspaceId, original = database.state.workspaces[0], url = `/api/v1/workspaces/${workspaceId}/commands`;
  const payload = { commandId: randomUUID(), expectedRevision: original.revision, command: { type: "create_client", id: randomUUID(), input: { primaryContactFirstName: "Fixture", primaryContactLastName: "Customer" }, now: new Date(clock.now).toISOString() } };
  const first = await api.inject({ method: "POST", url, headers: headers(owner), payload }); assert.equal(first.statusCode, 200, first.body);
  const replay = await api.inject({ method: "POST", url, headers: headers(owner), payload }); assert.equal(replay.statusCode, 200); assert.equal(replay.json().replayed, true); assert.deepEqual(replay.json().workspace, first.json().workspace);
  assert.equal((await api.inject({ method: "POST", url, headers: headers(owner), payload: { ...payload, command: { ...payload.command, id: randomUUID() } } })).statusCode, 409);
  assert.equal((await api.inject({ method: "POST", url, headers: headers(owner), payload: { ...payload, commandId: randomUUID() } })).statusCode, 409);
  const read = await api.inject({ url: `/api/v1/workspaces/${workspaceId}`, headers: headers(owner) }); assert.equal(read.json().document, database.state.workspaces[0].document);
  assert.equal(database.state.receipts.length, 1);
});
test("Support and missing membership cannot access customer data or business writes", async () => {
  const id = randomUUID(), secret = randomBytes(24).toString("base64url");
  await database.addUser({ id, username: "synthetic-support", displayName: "Support", roles: ["support"], passwordHash: await argonPasswords.hash(secret), disabled: false, accessRevision: 0 }, bootstrap.workspaceId, ["field:read", "field:write"]);
  const owner = await login("synthetic-support", secret);
  assert.equal((await api.inject({ url: `/api/v1/workspaces/${bootstrap.workspaceId}/customers`, headers: headers(owner) })).statusCode, 403);
  assert.equal((await api.inject({ url: `/api/v1/workspaces/${randomUUID()}`, headers: headers(owner) })).statusCode, 403);
});
test("24-hour grant is signed, expires exactly, and logout invalidates server session", async () => {
  const owner = await login(), response = await api.inject({ method: "POST", url: `/api/v1/workspaces/${bootstrap.workspaceId}/offline-grant`, headers: headers(owner) });
  assert.equal(response.statusCode, 200); const result = response.json();
  const grant = verifyOfflineGrant(result.grant, result.verificationKey, { subject: bootstrap.administratorId, workspaceId: bootstrap.workspaceId }, clock.now);
  assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), 86_400_000);
  assert.throws(() => verifyOfflineGrant(result.grant, result.verificationKey, { subject: bootstrap.administratorId, workspaceId: bootstrap.workspaceId }, clock.now + 86_400_000), /expired/);
  const logout = await api.inject({ method: "POST", url: "/api/v1/session/logout", headers: headers(owner) }); assert.equal(logout.statusCode, 200);
  assert.equal((await api.inject({ url: "/api/v1/session", headers: headers(owner) })).statusCode, 401);
});
test("recovery import preserves exact higher source while refusing lower/equal CAS generations and stale queued commands", async () => {
  const fixture = new TestDatabase(), setup = await bootstrapAdministrator(fixture, { username: "synthetic-import-admin", displayName: "Synthetic import administrator", password, workspaceName: "Import regression" });
  const workspaceId = randomUUID(), document = serializeWorkspaceDocument(emptyWorkspaceDocument());
  await fixture.transaction(async transaction => { await transaction.insertWorkspace({ id: workspaceId, name: "Initial legacy import fixture", revision: 0, document });
    await transaction.setMembership(setup.administratorId, workspaceId, ["field:read", "field:write", "catalog:write", "catalog:archive"]); });
  const service = await createApi({ database: fixture, signingKey: randomBytes(32), origin: "http://localhost:19040", secureCookies: false });
  try {
    const owner = await service.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: "synthetic-import-admin", password } }); assert.equal(owner.statusCode, 200);
    await exerciseRecoveryImportCas({ api: service, workspaceId, headers: { cookie: owner.headers["set-cookie"] as string, "x-csrf-token": owner.json().csrfToken },
      inspect: async () => { const saved = fixture.state.workspaces.find(item => item.id === workspaceId)!;
        return { revision: saved.revision, document: saved.document, receiptCount: fixture.state.receipts.filter(item => item.workspaceId === workspaceId).length, auditCount: fixture.state.audits.length }; } });
  } finally { await service.close(); }
});
