import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Pool } from "pg";
import { ed25519 } from "@noble/curves/ed25519.js";
import { PostgresDatabase } from "../apps/api/src/database";
import { migrateDatabase } from "../apps/api/src/migrations";
import { bootstrapAdministrator } from "../apps/api/src/bootstrapService";
import { createProductionGateway } from "./serveProductionApp";
import { workflowTestField, workflowTestPoint, workflowTestTime } from "../packages/core/src/productionWorkflowTestFixtures";
import { createSurveyCollection } from "../packages/core/src/surveyCollection";
import { layoutLockFromReceiverCapture } from "../packages/core/src/officialLayout";
import { parseLayoutSessionDocument } from "../packages/core/src/layoutSession";
import { parseFieldLayoutTarget } from "../packages/core/src/fieldLayoutTarget";
import type { CatalogMetadata, CommandResponse } from "../packages/auth-client/src/contracts";
import type { WorkspaceCommand } from "../packages/project-store/src/workspaceCommands";
import { parseWorkspaceDocument, type WorkspaceDocument } from "../packages/project-store/src/workspaceDocument";

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", done); });
  const address = server.address(); assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
  return port;
}

test("actual PostgreSQL gateway authenticates over HTTP and retains exact source through customer archive and restore", {
  skip: !process.env.CPLAYOUT_TEST_DATABASE_URL,
}, async () => {
  const schema = `cplayout_gateway_${randomUUID().replaceAll("-", "")}`;
  const host = new Pool({ connectionString: process.env.CPLAYOUT_TEST_DATABASE_URL, max: 1 });
  await host.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.CPLAYOUT_TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 4 });
  let gateway: Awaited<ReturnType<typeof createProductionGateway>> | null = null;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert(version >= 180006 && version < 190000, "Qualify PostgreSQL 18.6 in the stable 18.x series.");
    await migrateDatabase(pool);
    const database = new PostgresDatabase(pool), password = randomBytes(24).toString("base64url"), signingKey = randomBytes(32);
    const account = await bootstrapAdministrator(database, { username: "synthetic-http", displayName: "Synthetic HTTP operator", password, workspaceName: "Synthetic gateway test" });
    const origin = `http://127.0.0.1:${await availableLoopbackPort()}`;
    gateway = await createProductionGateway({ database, signingKey, origin, secureCookies: false,
      appDist: resolve(process.env.CPLAYOUT_APP_DIST ?? "apps/mobile/dist") });
    await gateway.listen({ host: "127.0.0.1", port: Number(new URL(origin).port) });
    const html = await (await fetch(origin)).text();
    assert(html.includes(Buffer.from(ed25519.getPublicKey(signingKey)).toString("hex")));
    assert(!html.includes(signingKey.toString("hex")));
    assert.equal((await fetch(`${origin}/api/v1/workspaces/${account.workspaceId}`)).status, 401);
    const login = await fetch(`${origin}/api/v1/session/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ username: "synthetic-http", password }) });
    assert.equal(login.status, 200);
    const access = await login.json() as { csrfToken: string; principal: { id: string } }, cookie = login.headers.get("set-cookie")?.split(";")[0]; assert(cookie);
    const headers = { "Content-Type": "application/json", Origin: origin, Cookie: cookie, "X-CSRF-Token": access.csrfToken };
    const initial = await database.transaction(transaction => transaction.workspace(account.workspaceId)); assert(initial);
    const customerId = randomUUID();
    const commandResponse = await fetch(`${origin}/api/v1/workspaces/${account.workspaceId}/commands`, { method: "POST", headers,
      body: JSON.stringify({ commandId: randomUUID(), expectedRevision: initial.revision, command: { type: "create_client", id: customerId,
        input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "HTTP customer" }, now: new Date().toISOString() } }) });
    assert.equal(commandResponse.status, 200, commandResponse.ok ? undefined : await commandResponse.text());
    const committed = await database.transaction(transaction => transaction.workspace(account.workspaceId)); assert(committed);
    for (const [index, archived] of [true, false].entries()) {
      const result: Response = await fetch(`${origin}/api/v1/workspaces/${account.workspaceId}/archive`, { method: "POST", headers,
        body: JSON.stringify({ kind: "customer", entityId: customerId, archived, expectedRevision: committed.revision + index }) });
      assert.equal(result.status, 200);
      const archive = await (await fetch(`${origin}/api/v1/workspaces/${account.workspaceId}/archive-state`, { headers })).json() as { customers: { id: string; archived: boolean }[] };
      assert.equal(archive.customers.find(customer => customer.id === customerId)?.archived, archived);
      const saved = await database.transaction(transaction => transaction.workspace(account.workspaceId)); assert(saved);
      assert.deepEqual({ ...JSON.parse(saved.document), revision: committed.revision }, JSON.parse(committed.document));
      assert.equal((await pool.query("SELECT document FROM cplayout_workspaces WHERE id=$1", [account.workspaceId])).rows[0].document, saved.document);
    }
    const catalogUrl = `${origin}/api/v1/workspaces/${account.workspaceId}/catalog-metadata`;
    const emptyCustomerResponse = await fetch(catalogUrl, { headers }); assert.equal(emptyCustomerResponse.status, 200);
    const emptyCustomer = await emptyCustomerResponse.json() as CatalogMetadata;
    assert.equal(emptyCustomer.principalId, access.principal.id); assert.equal(emptyCustomer.customers[0].id, customerId); assert.deepEqual(emptyCustomer.projects, []);
    const wrongActor = await fetch(catalogUrl, { headers: { ...headers, "X-CPLayout-Principal": randomUUID() } }); assert.equal(wrongActor.status, 409);
    let revision = emptyCustomer.revision;
    const send = async (command: WorkspaceCommand): Promise<CommandResponse & { workspace: WorkspaceDocument }> => {
      const response = await fetch(`${origin}/api/v1/workspaces/${account.workspaceId}/commands`, { method: "POST", headers: { ...headers, "X-CPLayout-Principal": access.principal.id },
        body: JSON.stringify({ commandId: randomUUID(), expectedRevision: revision, expectedPrincipalId: access.principal.id, command }) });
      assert.equal(response.status, 200, response.ok ? undefined : await response.text());
      const result = await response.json() as CommandResponse, workspace = parseWorkspaceDocument(JSON.stringify(result.workspace));
      assert.equal(workspace.revision, result.revision); revision = result.revision; return { ...result, workspace };
    };
    // Retained synthetic GGA evidence exercises HTTP/SQL admission, not a live device or field precision.
    const time = workflowTestTime, field = workflowTestField(), projectId = randomUUID(), fieldMapId = randomUUID(), designId = randomUUID();
    assert.equal(parseWorkspaceDocument(committed.document).workspaceVersion, "cplayout-workspace-v5");
    await send({ type: "create_project_record", input: { id: projectId, clientId: customerId, name: "Synthetic RTK project", projectCrs: field.projectCrs, unitSystem: "metric" }, now: time });
    await send({ type: "create_field_map_record", input: { id: fieldMapId, projectId, name: "Synthetic measured field" }, now: time });
    await send({ type: "create_field_design", designId, fieldMapId, name: "Synthetic field design", field, now: time });
    const collection = createSurveyCollection({ id: randomUUID(), owner: { designId, documentKind: "field", payloadId: field.id, fieldMapId, projectCrs: field.projectCrs }, purpose: { kind: "point", role: "control" }, now: time });
    await send({ type: "create_survey_collection", collection, expectedDesignRevision: 0, now: time });
    await send({ type: "append_survey_capture", collectionId: collection.id, expectedCollectionRevision: 0, expectedDesignRevision: 0, point: workflowTestPoint(), now: time });
    const reviewId = randomUUID(), sessionId = randomUUID();
    await send({ type: "review_survey", designId, expectedDesignRevision: 1, reviewId, includedCollectionIds: [collection.id], excludedCollectionIds: [], completedBy: "untrusted-caller", now: time });
    const retainedSurveySource = await database.transaction(transaction => transaction.workspace(account.workspaceId)); assert(retainedSurveySource);
    const receiptCount = (await pool.query("SELECT count(*)::integer AS count FROM cplayout_command_receipts")).rows[0].count;
    const deletion = await fetch(`${origin}/api/v1/workspaces/${account.workspaceId}/commands`, { method: "POST", headers,
      body: JSON.stringify({ commandId: randomUUID(), expectedRevision: revision, command: { type: "delete_project", projectId, now: time } }) });
    assert.equal(deletion.status, 409); assert((await deletion.json() as { message: string }).message.includes("retained field surveys"));
    assert.equal((await database.transaction(transaction => transaction.workspace(account.workspaceId)))?.document, retainedSurveySource.document);
    assert.equal((await pool.query("SELECT count(*)::integer AS count FROM cplayout_command_receipts")).rows[0].count, receiptCount);
    const started = await send({ type: "create_rtk_layout_session", designId, expectedDesignRevision: 1, reviewId, sessionId, name: "Synthetic recorded RTK map", selectedMachineIds: [field.machines[0].id], creationLock: layoutLockFromReceiverCapture(workflowTestPoint(2), "untrusted-caller"), now: time });
    const session = parseLayoutSessionDocument(started.workspace.layoutSessions![0].document); assert.equal(session.documentVersion, "layout-session-v3");
    if (session.documentVersion !== "layout-session-v3") throw new Error("The stored RTK contract is unavailable.");
    assert.equal(session.creationLock.recordedBy, access.principal.id);
    const target = parseFieldLayoutTarget(session.targetDocument), point = workflowTestPoint(3);
    await send({ type: "append_layout_mark", sessionId, expectedSessionRevision: 0, targetPointId: target.targetPoints![0].id, toleranceMeters: 0.1, recordedBy: "untrusted-caller", now: time,
      observation: { id: point.id, sessionId, capturedAt: time, projected: point.projected, evidence: point.captureEvidence } });
    const finished = await send({ type: "finalize_rtk_layout_session", sessionId, expectedSessionRevision: 1, finalizationLock: layoutLockFromReceiverCapture(workflowTestPoint(4), "untrusted-caller"), now: time });
    const official = parseLayoutSessionDocument(finished.workspace.layoutSessions![0].document); assert.equal(official.documentVersion, "layout-session-v3");
    if (official.documentVersion !== "layout-session-v3") throw new Error("The finalized RTK contract is unavailable.");
    assert.equal(official.finalization?.lock.recordedBy, access.principal.id); assert.equal(official.observations[0].marking?.recordedBy, access.principal.id);
    assert.equal(official.finalization?.targetObservationIds.length, 1); assert.equal(official.observations[0].evidence.physicalQualification, "unverified");
    const metadata = await (await fetch(catalogUrl, { headers })).json() as CatalogMetadata;
    assert.equal(metadata.projects[0].clientId, customerId); assert.equal(metadata.projects[0].id, projectId); assert.equal(metadata.revision, revision);
    const currentSource = await database.transaction(transaction => transaction.workspace(account.workspaceId)); assert(currentSource);
    assert.equal((await pool.query("SELECT document FROM cplayout_workspaces WHERE id=$1", [account.workspaceId])).rows[0].document, currentSource.document);
    assert.deepEqual(JSON.parse(currentSource.document), finished.workspace);
    const { "Content-Type": _contentType, ...sessionHeaders } = headers;
    assert.equal((await fetch(`${origin}/api/v1/session/logout`, { method: "POST", headers: sessionHeaders })).status, 200);
    assert.equal((await fetch(`${origin}/api/v1/workspaces/${account.workspaceId}`, { headers })).status, 401);
  } finally {
    await gateway?.close(); await pool.end(); await host.query(`DROP SCHEMA ${schema} CASCADE`); await host.end();
  }
});
