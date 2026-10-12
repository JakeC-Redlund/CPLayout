import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { ApiClient, ApiError, parseProjectMetadataList, parseCatalogMetadata } from "@cplayout/auth-client";
import { parseWorkspaceDocument } from "../../../packages/project-store/src/workspaceDocument";
import { argonPasswords } from "./passwords";
import { createSyntheticApi, seedSyntheticCustomers } from "./testHarness";

test("authorized project metadata distinguishes duplicate project names by actual customer and retains archive/read-only/Support boundaries", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040");
  try {
    const customers = await seedSyntheticCustomers(fixture, [{ customerDisplayName: "Actual eastern customer", projectName: "Shared project name" }, { customerDisplayName: "Actual western customer", projectName: "Shared project name" }, { customerDisplayName: "Actual customer without projects" }]);
    const entries = customers.filter(customer => customer.project).map(customer => ({ ...customer, ...customer.project! })), empty = customers.find(customer => !customer.project)!;
    const readPassword = randomBytes(24).toString("base64url"), supportPassword = randomBytes(24).toString("base64url"), readerId = randomUUID();
    await fixture.database.addUser({ id: readerId, username: "project-reader", displayName: "Synthetic read-only Operator", roles: ["operator"], passwordHash: await argonPasswords.hash(readPassword), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read"]);
    await fixture.database.addUser({ id: randomUUID(), username: "project-support", displayName: "Synthetic Support", roles: ["support"], passwordHash: await argonPasswords.hash(supportPassword), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read"]);
    const login = async (username: string, password: string) => {
      const response = await fixture.api.inject({ method: "POST", url: "/api/v1/session/login", payload: { username, password } });
      assert.equal(response.statusCode, 200); return { cookie: String(response.headers["set-cookie"]), "x-csrf-token": response.json<{ csrfToken: string }>().csrfToken };
    };
    const reader = await login("project-reader", readPassword), url = `/api/v1/workspaces/${fixture.workspaceId}/projects`;
    assert.equal((await fixture.api.inject({ url })).statusCode, 401);
    const read = await fixture.api.inject({ url, headers: reader }); assert.equal(read.statusCode, 200);
    const metadata = parseProjectMetadataList(read.json()).projects;
    assert.deepEqual(metadata.map(item => ({ id: item.id, clientId: item.clientId, name: item.name, customerDisplayName: item.customerDisplayName })),
      entries.map(item => ({ id: item.projectId, clientId: item.clientId, name: item.projectName, customerDisplayName: item.customerDisplayName })));
    const stored = (await fixture.database.transaction(transaction => transaction.workspace(fixture.workspaceId)))!;
    const source = parseWorkspaceDocument(stored.document);
    const snapshotUrl = `/api/v1/workspaces/${fixture.workspaceId}/catalog-metadata`;
    assert.equal((await fixture.api.inject({ url: snapshotUrl })).statusCode, 401);
    const snapshotResponse = await fixture.api.inject({ url: snapshotUrl, headers: reader }); assert.equal(snapshotResponse.statusCode, 200);
    const snapshot = parseCatalogMetadata(snapshotResponse.json(), fixture.workspaceId);
    assert.equal(snapshot.principalId, readerId); assert.equal(snapshot.policyRevision, 0);
    assert.equal(snapshot.revision, stored.revision); assert.deepEqual(snapshot.customers, source.catalog.clients.map(customer => ({ id: customer.id, displayName: customer.displayName, archived: false })));
    assert.deepEqual(snapshot.projects, metadata); assert(snapshot.customers.some(customer => customer.id === empty.clientId)); assert.equal(snapshot.projects.filter(project => project.clientId === empty.clientId).length, 0);
    for (const item of metadata) assert.equal(item.customerDisplayName, source.catalog.clients.find(customer => customer.id === item.clientId)!.displayName);
    const filtered = await fixture.api.inject({ url: `${url}?customerId=${entries[1].clientId}`, headers: reader });
    assert.deepEqual(parseProjectMetadataList(filtered.json()).projects.map(item => item.id), [entries[1].projectId]);
    const support = await login("project-support", supportPassword);
    assert.equal((await fixture.api.inject({ url, headers: support })).statusCode, 403);
    assert.equal((await fixture.api.inject({ url: snapshotUrl, headers: support })).statusCode, 403);
    const administrator = await login(fixture.username, fixture.password), archive = { kind: "customer", entityId: entries[0].clientId, archived: true, expectedRevision: stored.revision };
    assert.equal((await fixture.api.inject({ method: "POST", url: `/api/v1/workspaces/${fixture.workspaceId}/archive`, headers: reader, payload: archive })).statusCode, 403);
    assert.equal((await fixture.api.inject({ method: "POST", url: `/api/v1/workspaces/${fixture.workspaceId}/archive`, headers: administrator, payload: archive })).statusCode, 200);
    const active = await fixture.api.inject({ url, headers: reader }); assert.deepEqual(parseProjectMetadataList(active.json()).projects.map(item => item.id), [entries[1].projectId]);
    const all = parseProjectMetadataList((await fixture.api.inject({ url: `${url}?includeArchived=true`, headers: reader })).json()).projects;
    assert.equal(all.find(item => item.id === entries[0].projectId)!.customerDisplayName, entries[0].customerDisplayName);
    assert.equal(all.find(item => item.id === entries[0].projectId)!.archived, true); assert.equal(all.find(item => item.id === entries[0].projectId)!.individuallyArchived, false);
    const archived = parseCatalogMetadata((await fixture.api.inject({ url: snapshotUrl, headers: reader })).json(), fixture.workspaceId);
    assert.equal(archived.customers.find(customer => customer.id === entries[0].clientId)!.archived, true); assert.equal(archived.projects.find(project => project.id === entries[0].projectId)!.archived, true);
    assert(archived.customers.some(customer => customer.id === empty.clientId)); assert.equal(archived.projects.filter(project => project.clientId === empty.clientId).length, 0);
    await fixture.database.transaction(transaction => transaction.setMembership(readerId, fixture.workspaceId, ["field:read"]));
    const renewed = parseCatalogMetadata((await fixture.api.inject({ url: snapshotUrl, headers: reader })).json(), fixture.workspaceId);
    assert.equal(renewed.principalId, readerId); assert.equal(renewed.policyRevision, 1); assert.deepEqual(renewed.customers, archived.customers);
    const retained = parseWorkspaceDocument((await fixture.database.transaction(transaction => transaction.workspace(fixture.workspaceId)))!.document);
    assert.deepEqual(retained.catalog, source.catalog); assert.deepEqual(retained.draftDocuments, source.draftDocuments);
  } finally { await fixture.api.close(); }
});

test("real customer-folder response binds its cookie actor and current membership policy before SDK publication", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "";
  try {
    await seedSyntheticCustomers(fixture, [{ customerDisplayName: "Actual retained empty customer" }]);
    const id = randomUUID(), password = randomBytes(24).toString("base64url");
    await fixture.database.addUser({ id, username: "other-folder-reader", displayName: "Actual other folder reader", roles: ["operator"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read"]);
    const fetcher = (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const preceding = new ApiClient({ fetch: fetcher }), otherTab = new ApiClient({ fetch: fetcher });
    await preceding.login(fixture.username, fixture.password); await otherTab.login("other-folder-reader", password);
    const original = fixture.database.state.workspaces[0].document;
    await assert.rejects(preceding.catalogMetadata(fixture.workspaceId), error => error instanceof ApiError && error.code === "account_changed");
    assert.equal(preceding.access!.principal.id, fixture.administratorId); assert.equal(preceding.accessDenied, true); assert.equal(otherTab.accessDenied, false);
    await preceding.restore(); const current = await preceding.catalogMetadata(fixture.workspaceId); assert.equal(current.principalId, id); assert.equal(current.policyRevision, 0);
    await fixture.database.transaction(transaction => transaction.setMembership(id, fixture.workspaceId, ["field:read"]));
    await assert.rejects(preceding.catalogMetadata(fixture.workspaceId), error => error instanceof ApiError && error.code === "account_changed");
    assert.equal(preceding.access!.workspaces[0].policyRevision, 0); assert.equal(preceding.accessDenied, true);
    await preceding.restore(); const renewed = await preceding.catalogMetadata(fixture.workspaceId); assert.equal(renewed.policyRevision, 1); assert.equal(renewed.principalId, id);
    assert.equal(fixture.database.state.workspaces[0].document, original); assert.deepEqual(renewed.customers, current.customers); assert.deepEqual(renewed.projects, []);
  } finally { await fixture.api.close(); }
});

test("business workspace reads refuse a shared service cookie owned by another legitimate member", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "";
  try {
    const id = randomUUID(), password = randomBytes(24).toString("base64url");
    await fixture.database.addUser({ id, username: "other-field-reader", displayName: "Other legitimate field reader", roles: ["operator"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read"]);
    const fetcher = (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const preceding = new ApiClient({ fetch: fetcher }), otherTab = new ApiClient({ fetch: fetcher });
    await preceding.login(fixture.username, fixture.password); const original = await preceding.workspace(fixture.workspaceId);
    await otherTab.login("other-field-reader", password);
    await assert.rejects(preceding.workspace(fixture.workspaceId), error => error instanceof ApiError && error.code === "account_changed");
    await assert.rejects(preceding.archiveState(fixture.workspaceId), error => error instanceof ApiError && error.code === "account_changed");
    assert.equal(preceding.access!.principal.id, fixture.administratorId); assert.equal(otherTab.access!.principal.id, id);
    assert.equal(preceding.accessDenied, true); assert.equal(otherTab.accessDenied, false); assert.equal((await otherTab.workspace(fixture.workspaceId)).document, original.document);
    // A legacy caller without the additive expectation is still authorized by its
    // real cookie and membership. The response shape and permissions stay intact.
    const legacy = await fixture.api.inject({ url: `/api/v1/workspaces/${fixture.workspaceId}`, headers: { cookie } });
    assert.equal(legacy.statusCode, 200); assert.equal(legacy.json().document, original.document);
  } finally { await fixture.api.close(); }
});
