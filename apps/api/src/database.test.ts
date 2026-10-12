import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresDatabase } from "./database";
import { migrateDatabase } from "./migrations";
import { bootstrapAdministrator } from "./bootstrapService";
import { createApi } from "./server";
import { emptyWorkspaceDocument, serializeWorkspaceDocument, upgradeWorkspaceDocumentToV2, upgradeWorkspaceDocumentToV3, upgradeWorkspaceDocumentToV4 } from "../../../packages/project-store/src/workspaceDocument";

test("PostgreSQL migrations, guarded bootstrap, two-client CAS, rollback and TEXT source retention", { skip: !process.env.CPLAYOUT_TEST_DATABASE_URL }, async () => {
  const connectionString = process.env.CPLAYOUT_TEST_DATABASE_URL!, schema = `cplayout_test_${randomUUID().replaceAll("-", "")}`;
  const host = new Pool({ connectionString, max: 1 }); await host.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}`, max: 4 }), database = new PostgresDatabase(pool);
  let api: Awaited<ReturnType<typeof createApi>> | null = null;
  try {
    await migrateDatabase(pool); await migrateDatabase(pool);
    const password = randomBytes(24).toString("base64url");
    const attempts = await Promise.allSettled([1, 2].map(index => bootstrapAdministrator(database, { username: `admin-${index}`, displayName: "Synthetic administrator", password, workspaceName: "Database fixture" })));
    assert.equal(attempts.filter(item => item.status === "fulfilled").length, 1);
    const accepted = attempts.find(item => item.status === "fulfilled") as PromiseFulfilledResult<{ administratorId: string; workspaceId: string }>;
    const users = await database.transaction(transaction => transaction.users());
    api = await createApi({ database, signingKey: randomBytes(32), origin: "http://localhost:19040", secureCookies: false });
    const login = await api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username: users[0].username, password } }); assert.equal(login.statusCode, 200);
    const headers = { cookie: login.headers["set-cookie"] as string, "x-csrf-token": login.json().csrfToken }, workspaceId = accepted.value.workspaceId;
    const before = await database.transaction(transaction => transaction.workspace(workspaceId)); assert(before);
    const command = (id: string) => ({ commandId: randomUUID(), expectedRevision: before.revision, command: { type: "create_client", id, input: { primaryContactFirstName: "Database", primaryContactLastName: "Fixture" }, now: new Date().toISOString() } });
    const writes = await Promise.all([1, 2].map(() => api!.inject({ method: "POST", url: `/api/v1/workspaces/${workspaceId}/commands`, headers, payload: command(randomUUID()) })));
    assert.deepEqual(writes.map(item => item.statusCode).sort(), [200, 409]);
    const current = await database.transaction(transaction => transaction.workspace(workspaceId)); assert(current); assert.equal(current.revision, before.revision + 1);
    const exact = await pool.query("SELECT document FROM cplayout_workspaces WHERE id=$1", [workspaceId]); assert.equal(exact.rows[0].document, current.document);
    await assert.rejects(database.transaction(async transaction => { await transaction.writeWorkspace({ ...current, document: "corrupt" }); throw new Error("Injected transaction failure"); }), /Injected/);
    assert.equal((await database.transaction(transaction => transaction.workspace(workspaceId)))!.document, current.document);
    const receipts = await pool.query("SELECT count(*)::integer AS count FROM cplayout_command_receipts"); assert.equal(receipts.rows[0].count, 1);
    const customer = (JSON.parse(current.document) as { catalog: { clients: { id: string }[] } }).catalog.clients[0];
    const archiveState = await api.inject({ url: `/api/v1/workspaces/${workspaceId}/archive-state`, headers }); assert.equal(archiveState.statusCode, 200); assert.equal(archiveState.json().revision, current.revision);
    const archived = await api.inject({ method: "POST", url: `/api/v1/workspaces/${workspaceId}/archive`, headers, payload: { kind: "customer", entityId: customer.id, archived: true, expectedRevision: current.revision } }); assert.equal(archived.statusCode, 200);
    const sidecar = await api.inject({ url: `/api/v1/workspaces/${workspaceId}/archive-state`, headers }); assert.equal(sidecar.json().customers[0].archived, true); assert.equal(sidecar.json().revision, current.revision + 1);
    const domainAfterArchive = await database.transaction(transaction => transaction.workspace(workspaceId)); assert(domainAfterArchive);
    assert.deepEqual({ ...JSON.parse(domainAfterArchive.document), revision: current.revision }, JSON.parse(current.document));
    const v1 = emptyWorkspaceDocument(), v2 = upgradeWorkspaceDocumentToV2(serializeWorkspaceDocument(v1)),
      v3 = upgradeWorkspaceDocumentToV3(serializeWorkspaceDocument(v2)), v4 = upgradeWorkspaceDocumentToV4(serializeWorkspaceDocument(v3));
    for (const [source, retainedKey] of [[v1, "originalPreviousWorkspaceDocument"], [v2, "originalPreviousWorkspaceDocument"],
      [v3, "originalSurveyUpgradeDocument"], [v4, "originalWorkflowUpgradeDocument"]] as const) {
      const id = randomUUID(), document = JSON.stringify(source, null, 2).replaceAll("\n", "\r\n") + "  \r\n";
      await database.transaction(async transaction => {
        await transaction.insertWorkspace({ id, name: "Exact imported legacy test", revision: source.revision, document });
        await transaction.setMembership(accepted.value.administratorId, id, ["field:read", "field:write"]);
      });
      const upgraded: Awaited<ReturnType<typeof api.inject>> = await api.inject({ method: "POST", url: `/api/v1/workspaces/${id}/commands`, headers,
        payload: { commandId: randomUUID(), expectedRevision: source.revision, command: { type: "upgrade_workspace_to_v5", now: new Date().toISOString() } } });
      assert.equal(upgraded.statusCode, 200, upgraded.body); assert.equal(upgraded.json().workspace[retainedKey], document);
      const saved = await pool.query("SELECT document FROM cplayout_workspaces WHERE id=$1", [id]);
      assert.equal(JSON.parse(saved.rows[0].document)[retainedKey], document);
    }
  } finally { await api?.close(); await pool.end(); await host.query(`DROP SCHEMA ${schema} CASCADE`); await host.end(); }
});
