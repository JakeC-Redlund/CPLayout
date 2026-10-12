import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiClient, cacheKey } from "@cplayout/auth-client";
import { createSyntheticApi, seedSyntheticCustomers } from "../../../api/src/testHarness";
import { createSyntheticRtkField } from "../../../api/src/rtkTestFixtures";
import { workflowTestPoint, workflowTestTime } from "../../../../packages/core/src/productionWorkflowTestFixtures";
import { layoutLockFromReceiverCapture, isOfficialLayoutSession } from "../../../../packages/core/src/officialLayout";
import { parseLayoutSessionDocument } from "../../../../packages/core/src/layoutSession";
import { parseFieldLayoutTarget } from "../../../../packages/core/src/fieldLayoutTarget";
import { createAuthenticatedRepository } from "./authenticatedRepository";
import type { AtomicAuthStorage } from "./authStorage";
import type { AuthSession } from "./AuthProvider";
import { createSurveyCollection, parseSurveyCollectionDocument } from "../../../../packages/core/src/surveyCollection";
import { parseDesignDraftDocument } from "../../../../packages/core/src/designDraft";
import { randomBytes, randomUUID } from "node:crypto";
import { argonPasswords } from "../../../api/src/passwords";
import { projectLonLatToXy } from "../../../../packages/core/src/coordinates";
import type { OperationalFixedGgaEvidence } from "../../../../packages/core/src/operationalGnssEvidence";
import type { SurveyPoint } from "../../../../packages/core/src/types";
import type { WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
import { emptyWorkspaceDocument, serializeWorkspaceDocument, upgradeWorkspaceDocumentToV2, upgradeWorkspaceDocumentToV3, upgradeWorkspaceDocumentToV4 } from "../../../../packages/project-store/src/workspaceDocument";

test("real renewed account can refresh retained read work after the preceding session was denied", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "";
  try {
    const api = new ApiClient({ fetch: (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch });
    const access = await api.login(fixture.username, fixture.password), items = new Map<string, string>();
    const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, callback) => callback(),
      writeCurrent: async (key, value, current) => { if (!current()) throw new Error("Read owner retired"); items.set(key, value); } };
    const repository = createAuthenticatedRepository({ api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "renewed-read", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession);
    await repository.ready(); const retained = items.get(repository.storagePartition)!;
    await fixture.database.transaction(transaction => transaction.updateUserAccess(access.principal.id, ["admin"], true));
    await assert.rejects(repository.sync()); assert.equal(api.accessDenied, true); assert.equal(items.get(repository.storagePartition), retained);
    await fixture.database.transaction(transaction => transaction.updateUserAccess(access.principal.id, ["admin"], false));
    await api.login(fixture.username, fixture.password); await repository.refresh();
    assert.equal(api.accessDenied, false); assert.equal(items.get(repository.storagePartition), retained);
    assert.equal((await repository.versionedWorkspace!.readAsync()).revision, JSON.parse(JSON.parse(retained).document).revision);
    assert.equal((await repository.archiveState()).workspaceId, fixture.workspaceId);
  } finally { await fixture.api.close(); }
});

for (const action of ["ready", "refresh", "archive", "offline_grant"] as const)
for (const boundary of ["lock", "persistence"] as const)
test(`cache read ${action} refuses an account switch at its final ${boundary} boundary`, async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "", armed = false;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
  try {
    const id = randomUUID(), password = randomBytes(24).toString("base64url");
    await fixture.database.addUser({ id, username: "read-boundary-member", displayName: "Legitimate shared-workspace member", roles: ["operator"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read"]);
    const api = new ApiClient({ fetch: (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch });
    const access = await api.login(fixture.username, fixture.password), items = new Map<string, string>();
    const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); },
      exclusive: async (_key, callback) => { if (armed && boundary === "lock") { armed = false; entered(); await held; } return callback(); },
      writeCurrent: async (key, value, current) => { if (armed && boundary === "persistence") { armed = false; entered(); await held; } if (!current()) throw new Error("Read owner retired"); items.set(key, value); } };
    const repository = createAuthenticatedRepository({ api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "read-cache-boundary", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession);
    if (action !== "ready") await repository.ready();
    await seedSyntheticCustomers(fixture, [{ customerDisplayName: "Actual later shared catalog source" }]);
    const oldCache = items.get(repository.storagePartition), otherPartition = cacheKey(id, fixture.workspaceId), otherCache = items.get(otherPartition), server = fixture.database.state.workspaces[0].document;
    armed = true; const pending = action === "ready" ? repository.ready() : action === "refresh" ? repository.refresh() : action === "archive" ? repository.archiveState() : repository.prepareOffline(); await waiting;
    await api.login("read-boundary-member", password); release();
    await assert.rejects(pending, /account|owner|access/); assert.equal(api.access!.principal.id, id);
    assert.equal(items.get(repository.storagePartition), oldCache); assert.equal(items.get(otherPartition), otherCache); assert.equal(fixture.database.state.workspaces[0].document, server);
  } finally { release(); await fixture.api.close(); }
});

for (const disposition of ["admitted", "retired_creation", "retired_finalization", "retired_creation_persistence", "retired_finalization_persistence"] as const)
test(`RTK actor-bound final admission preserves evidence for ${disposition}`, async () => {
  const fixture = await createSyntheticRtkField(); let cookie = "", armed = false;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
  try {
    const api = new ApiClient({ fetch: (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch });
    const access = await api.login(fixture.username, fixture.password), items = new Map<string, string>();
    const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); },
      exclusive: async (_key, action) => { if (armed && !disposition.endsWith("persistence")) { armed = false; entered(); await held; } return action(); },
      writeCurrent: async (key, value, current) => { if (armed && disposition.endsWith("persistence")) { armed = false; entered(); await held; } if (!current()) throw new Error("Retired capture owner"); items.set(key, value); } };
    const repository = createAuthenticatedRepository({ api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "rtk-actor-fixture", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession);
    await repository.ready(); await repository.prepareOffline(); const domain = repository.versionedWorkspace!;
    let workspace = await domain.readAsync();
    const creation: WorkspaceCommand = { type: "create_rtk_layout_session", now: workflowTestTime, sessionId: "client-rtk-session", name: "Supplied client RTK Layout", designId: fixture.designId,
      expectedDesignRevision: 1, reviewId: fixture.reviewId, selectedMachineIds: [fixture.field.machines[0].id], creationLock: layoutLockFromReceiverCapture(workflowTestPoint(20), "forged-client-creator") };
    async function execute(command: WorkspaceCommand) { const receipt = await domain.executeAsync(workspace.revision, command, () => true); workspace = receipt.workspace; return receipt; }
    let finalization: WorkspaceCommand | undefined;
    if (!disposition.startsWith("retired_creation")) {
      const created = await execute(creation), saved = parseLayoutSessionDocument(created.value), target = parseFieldLayoutTarget(saved.targetDocument), point = workflowTestPoint(21);
      assert(saved.documentVersion === "layout-session-v3");
      assert.equal(saved.creationLock!.recordedBy, access.principal.id); assert.equal(saved.creationLock!.evidence.physicalQualification, "unverified");
      await execute({ type: "append_layout_mark", now: workflowTestTime, sessionId: saved.id, expectedSessionRevision: 0, observation: { id: "client-rtk-mark", sessionId: saved.id, capturedAt: workflowTestTime, projected: point.projected, evidence: point.captureEvidence! },
        targetPointId: target.targetPoints![0].id, toleranceMeters: .1, recordedBy: "forged-client-station" });
      finalization = { type: "finalize_rtk_layout_session", now: workflowTestTime, sessionId: saved.id, expectedSessionRevision: 1, finalizationLock: layoutLockFromReceiverCapture(workflowTestPoint(22), "forged-client-finalizer") };
      await repository.sync();
    }
    if (disposition === "admitted") {
      const finalized = parseLayoutSessionDocument((await execute(finalization!)).value);
      assert(finalized.documentVersion === "layout-session-v3");
      assert.equal(finalized.finalization!.lock.recordedBy, access.principal.id); assert.equal(finalized.observations[0].marking!.recordedBy, access.principal.id); assert.equal(isOfficialLayoutSession(finalized), true);
      await repository.sync(); const server = parseLayoutSessionDocument(JSON.parse(fixture.database.state.workspaces[0].document).layoutSessions[0].document);
      assert.deepEqual(server, finalized); return;
    }
    const newId = randomUUID(), password = randomBytes(24).toString("base64url");
    await fixture.database.addUser({ id: newId, username: "rtk-other-owner", displayName: "Actual other RTK owner", roles: ["admin"], passwordHash: await argonPasswords.hash(password), disabled: false, accessRevision: 0 }, fixture.workspaceId);
    const source = fixture.database.state.workspaces[0].document, receiptCount = fixture.database.state.receipts.length, cacheBefore = items.get(repository.storagePartition), otherPartition = cacheKey(newId, fixture.workspaceId), otherBefore = items.get(otherPartition);
    armed = true; const pending = execute(disposition.startsWith("retired_creation") ? creation : finalization!); await waiting;
    await api.login("rtk-other-owner", password); release();
    await assert.rejects(pending, /owner|account|authorized access/); assert.equal(api.access!.principal.id, newId);
    assert.equal(fixture.database.state.workspaces[0].document, source); assert.equal(fixture.database.state.receipts.length, receiptCount);
    assert.equal(items.get(repository.storagePartition), cacheBefore); assert.equal(items.get(otherPartition), otherBefore);
  } finally { release(); await fixture.api.close(); }
});

test("read lease admits deliberate recovery publication, checks literal source before publication and expires its assertion", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040");
  try {
    let cookie = "", currentOwner = true, published = 0, expiredAssertion: (() => void) | null = null;
    const fetcher = (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const api = new ApiClient({ fetch: fetcher }), access = await api.login(fixture.username, fixture.password), items = new Map<string, string>();
    const storage: AtomicAuthStorage = { readCurrent: key => items.get(key) ?? null, read: async key => items.get(key) ?? null,
      write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, action) => action() };
    const session = { api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "read-lease-fixture", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession;
    const repository = createAuthenticatedRepository(session); await repository.ready();
    const current = await repository.versionedWorkspace!.readAsync(), partition = repository.storagePartition, originalCache = items.get(partition)!;
    const installed = await repository.versionedWorkspace!.readLeaseAsync!(current.revision, async (source, assertCurrent) => {
      assert(Object.isFrozen(source)); assert(Object.isFrozen(source.catalog)); await Promise.resolve();
      assertCurrent(); expiredAssertion = assertCurrent; published++;
      // Acknowledged recovery publication intentionally retires this source's UI
      // generation. It does not write or replace the saved workspace document.
      currentOwner = false; return { installed: true };
    }, () => currentOwner);
    assert.deepEqual(installed, { installed: true }); assert.equal(published, 1); assert.equal(items.get(partition), originalCache);
    assert.throws(() => expiredAssertion!(), /changed before it could be opened/);
    currentOwner = true;
    await assert.rejects(repository.versionedWorkspace!.readLeaseAsync!(current.revision, async (_source, assertCurrent) => {
      const changed = JSON.parse(items.get(partition)!) as { document: string }; changed.document += " \r\n";
      items.set(partition, JSON.stringify(changed)); assertCurrent(); published++;
    }, () => currentOwner), /changed before it could be opened/);
    assert.equal(published, 1); assert.equal(JSON.parse(items.get(partition)!).document, JSON.parse(originalCache).document + " \r\n");
    items.set(partition, originalCache);
    await assert.rejects(repository.versionedWorkspace!.readLeaseAsync!(current.revision, async (_source, assertCurrent) => {
      await Promise.resolve(); currentOwner = false; assertCurrent(); published++;
    }, () => currentOwner), /changed before it could be opened/);
    assert.equal(published, 1); assert.equal(items.get(partition), originalCache);
  } finally { await fixture.api.close(); }
});

test("authenticated cache final admission and independent recorded synchronization preserve receiver evidence", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040");
  try {
    let cookie = "", network = true, currentOwner = true, abortFinal = false, writes = 0;
    const fetcher = (async (path: string, init: RequestInit) => {
      if (!network) throw new TypeError("Synthetic connection lost");
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers.entries()), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const api = new ApiClient({ fetch: fetcher }), access = await api.login(fixture.username, fixture.password);
    const items = new Map<string, string>(); let tail: Promise<unknown> = Promise.resolve();
    const storage: AtomicAuthStorage = {
      read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); },
      exclusive(key, action) { const pending = tail.then(action); tail = pending.catch(() => undefined); return pending; },
      async writeCurrent(key, value, predicate) { if (abortFinal) currentOwner = false; if (!predicate()) throw new Error("Captured observation retired before final persistence"); items.set(key, value); writes++; },
    };
    const session = { api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "fixture-process", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession;
    const repository = createAuthenticatedRepository(session), domain = repository.versionedWorkspace!;
    assert.equal(repository.canRetainFieldChanges, true); assert.equal(repository.fieldRetentionReason, null);
    let publishedProjects = 0; const unsubscribe = repository.subscribeArchiveState(value => { publishedProjects = value?.projects.length ?? 0; });
    await repository.ready(); let workspace = await domain.readAsync(); const now = new Date().toISOString();
    async function execute(command: unknown, predicate?: () => boolean) { const result = await domain.executeAsync(workspace.revision, { now, ...command as object } as WorkspaceCommand, predicate); workspace = result.workspace; return result; }
    await execute({ type: "create_client", id: "client", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
    await execute({ type: "start_project_work", clientId: "client", projectId: "project", fieldMapId: "field-map", designId: "design", draftId: "draft", projectName: "Synthetic project", fieldName: "Synthetic field", workName: "Synthetic work", unitSystem: "metric", initialMode: "survey", projectCrs: "EPSG:32613" });
    assert.equal(publishedProjects, 1, "actual acknowledged new-project sidecar publishes to the live host"); unsubscribe();
    await repository.prepareOffline();
    const collection = createSurveyCollection({ id: "collection", now, purpose: { kind: "field_boundary" }, owner: { designId: "design", documentKind: "draft", payloadId: "draft", fieldMapId: "field-map", projectCrs: "EPSG:32613" } });
    await execute({ type: "create_survey_collection", collection, expectedDesignRevision: workspace.catalog.designs[0].revision });
    await repository.sync();
    const payload = "GNGGA,120001.00,4000.0000,N,10500.0000,W,4,12,0.8,1600.0,M,-20.0,M,1.0,42";
    const checksum = [...payload].reduce((value, char) => value ^ char.charCodeAt(0), 0).toString(16).padStart(2, "0");
    const evidence: OperationalFixedGgaEvidence = { schemaVersion: "gnss-operational-fixed-v1", observationId: "synthetic-receiver:1", sessionId: "synthetic-receiver", transport: "local_udp",
      receivedAt: now, receivedMonotonicMs: 1000, sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "unknown", sentenceTypes: ["GGA"],
      gga: { sentence: `$${payload}*${checksum}`, sentenceIdentifier: "GNGGA", utcTime: "120001.00", qualityCode: 4, latitude: 40, longitude: -105 },
      receipt: { sequence: 1, browserReceivedMonotonicMs: 1000, ingressAgeAtReceiptMs: 500, provenance: "loopback_companion" }, capture: { evaluatedMonotonicMs: 1500, ageMs: 1000, maxAgeMs: 2000 },
      projection: { id: "wgs84-projection-v1:EPSG:32613", projectCrs: "EPSG:32613" }, physicalQualification: "unverified" };
    const point: SurveyPoint = { id: "point:1", label: "Synthetic captured point", role: "control", projected: projectLonLatToXy({ latitude: 40, longitude: -105 }, "EPSG:32613"), wgs84: { latitude: 40, longitude: -105 },
      observedAt: now, source: "external_gnss", confidence: "rtk_fixed", captureEvidence: evidence };
    const command = { type: "append_survey_capture", collectionId: collection.id, expectedCollectionRevision: 0, expectedDesignRevision: workspace.catalog.designs[0].revision, point };
    const partition = cacheKey(access.principal.id, fixture.workspaceId), original = items.get(partition), writesBefore = writes;
    abortFinal = true; await assert.rejects(execute(command, () => currentOwner), /retired/); assert.equal(items.get(partition), original); assert.equal(writes, writesBefore);
    abortFinal = false; currentOwner = true; await execute(command, () => currentOwner);
    assert.equal(repository.status().pending, 1);
    assert.equal(parseSurveyCollectionDocument(JSON.parse(fixture.database.state.workspaces[0].document).surveyCollections[0].document).observations.length, 0);
    network = false; await assert.rejects(repository.sync()); assert.equal(repository.status().pending, 1);
    network = true; await repository.sync(); assert.equal(repository.status().pending, 0);
    const serverCollection = parseSurveyCollectionDocument(JSON.parse(fixture.database.state.workspaces[0].document).surveyCollections[0].document);
    assert.deepEqual(serverCollection.observations[0], point); assert.equal(serverCollection.observations[0].captureEvidence!.receivedAt, now);
    const unqualified = { ...storage, writeCurrent: undefined }, other = createAuthenticatedRepository(session, unqualified);
    assert.equal(other.canRetainFieldChanges, false); assert.match(other.fieldRetentionReason!, /cannot safely retain unfinished field edits/);
    await assert.rejects(other.versionedWorkspace!.executeAsync(workspace.revision, { now, ...command } as WorkspaceCommand, () => true), /Live GPS records cannot be saved safely on this device/);
    const sourceDraft = parseDesignDraftDocument(workspace.draftDocuments.find(item => item.id === "draft")!.document);
    await execute({ type: "save_design_draft", designId: "design", expectedDesignRevision: workspace.catalog.designs.find(item => item.id === "design")!.revision,
      draft: { ...sourceDraft, name: "Locally saved before Copy" } }); assert.equal(repository.status().pending, 1);
    await execute({ type: "copy_design_with_survey", sourceDesignId: "design", expectedDesignRevision: workspace.catalog.designs.find(item => item.id === "design")!.revision,
      designId: "copy-design", payloadId: "copy-draft", fieldMapId: "field-map", name: "Actual Copy after Save", collectionIds: [{ sourceId: "collection", id: "copied-collection", expectedRevision: 1 }] });
    assert.equal(repository.status().pending, 0); assert(fixture.database.state.workspaces[0].document.includes("Actual Copy after Save"));
  } finally { await fixture.api.close(); }
});

test("online archive sidecar retains exact document and offline access fails closed without owner-bound status", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "", online = true;
  try {
    const fetcher = (async (path: string, init: RequestInit) => {
      if (!online) throw new TypeError("Synthetic offline transport");
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers.entries()), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const api = new ApiClient({ fetch: fetcher }), access = await api.login(fixture.username, fixture.password), items = new Map<string, string>();
    const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, action) => action() };
    const session = { api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "sidecar-test", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession;
    const repository = createAuthenticatedRepository(session); await repository.ready();
    const partition = repository.storagePartition, before = JSON.parse(items.get(partition)!).document;
    const actual = await repository.archiveState(); assert.equal(JSON.parse(items.get(partition)!).document, before);
    assert.deepEqual(JSON.parse(items.get(partition)!).archives, { subject: access.principal.id, workspaceId: fixture.workspaceId, state: actual });
    await repository.prepareOffline(); online = false;
    const offlineRepository = createAuthenticatedRepository({ ...session, status: "offline" });
    assert.deepEqual(await offlineRepository.archiveState(), actual); assert.equal(JSON.parse(items.get(partition)!).document, before);
    const work = JSON.parse(items.get(partition)!); delete work.archives; items.set(partition, JSON.stringify(work));
    await assert.rejects(createAuthenticatedRepository({ ...session, status: "offline" }).archiveState(), /Archive information was not prepared/);
    work.archives = { subject: "other-account", workspaceId: fixture.workspaceId, state: actual }; items.set(partition, JSON.stringify(work));
    await assert.rejects(createAuthenticatedRepository({ ...session, status: "offline" }).archiveState(), /different account/);
  } finally { await fixture.api.close(); }
});

test("local upgrade admission and actual server sync both preserve exact imported v1-v4 source text", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "";
  try {
    const fetcher = (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers.entries()), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const api = new ApiClient({ fetch: fetcher }), access = await api.login(fixture.username, fixture.password);
    const v1 = emptyWorkspaceDocument(), v2 = upgradeWorkspaceDocumentToV2(serializeWorkspaceDocument(v1)),
      v3 = upgradeWorkspaceDocumentToV3(serializeWorkspaceDocument(v2)), v4 = upgradeWorkspaceDocumentToV4(serializeWorkspaceDocument(v3));
    for (const [source, retainedKey] of [[v1, "originalPreviousWorkspaceDocument"], [v2, "originalPreviousWorkspaceDocument"],
      [v3, "originalSurveyUpgradeDocument"], [v4, "originalWorkflowUpgradeDocument"]] as const) {
      const original = JSON.stringify(source, null, 2).replaceAll("\n", "\r\n") + "  \r\n";
      await fixture.database.transaction(async transaction => { const current = await transaction.workspace(fixture.workspaceId); if (!current) throw new Error("Synthetic source missing."); await transaction.writeWorkspace({ ...current, revision: source.revision, document: original }); });
      const items = new Map<string, string>();
      const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, action) => action(),
        writeCurrent: async (key, value, current) => { if (!current()) throw new Error("Retired source"); items.set(key, value); } };
      const session = { api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "raw-upgrade", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession;
      const repository = createAuthenticatedRepository(session); await repository.ready();
      const result = await repository.versionedWorkspace!.executeAsync(source.revision, { type: "upgrade_workspace_to_v5", now: new Date().toISOString() });
      assert.equal(result.workspace[retainedKey], original); assert.equal(repository.status().pending, 1);
      await repository.sync(); assert.equal(repository.status().pending, 0);
      assert.equal((await repository.versionedWorkspace!.readAsync())[retainedKey], original);
      assert.equal(JSON.parse(fixture.database.state.workspaces[0].document)[retainedKey], original);
    }
  } finally { await fixture.api.close(); }
});

for (const disposition of ["conflict", "retired_account", "retired_input", "delayed_lock_account", "delayed_lock_denied", "delayed_lock_permissions"] as const)
test(`automatic administrative synchronization preserves field work and refuses ${disposition}`, async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "", api!: ApiClient, retireDuringRestore = false, current = true, administrativePosts = 0;
  let armFinalLock = false, finalLocks = 0, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), waiting = new Promise<void>(resolve => { entered = resolve; });
  const secondPassword = randomBytes(24).toString("base64url");
  try {
    if (disposition === "retired_account" || disposition === "delayed_lock_account") await fixture.database.addUser({ id: randomUUID(), username: "different-synthetic", displayName: "Different account", roles: ["admin"], passwordHash: await argonPasswords.hash(secondPassword), disabled: false, accessRevision: 0 }, fixture.workspaceId, ["field:read", "field:write", "catalog:write"]);
    const fetcher = (async (path: string, init: RequestInit) => {
      const headers = new Headers(init.headers); if (cookie) headers.set("cookie", cookie);
      if (path.endsWith("/commands") && JSON.parse(String(init.body)).command.type === "rename_project") administrativePosts++;
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers.entries()), payload: init.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      if (retireDuringRestore && path === "/api/v1/session") { retireDuringRestore = false; if (disposition === "retired_account") await api.login("different-synthetic", secondPassword); else current = false; }
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    api = new ApiClient({ fetch: fetcher }); const access = await api.login(fixture.username, fixture.password), items = new Map<string, string>();
    const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, action) => {
      if (armFinalLock && ++finalLocks === 2) { entered(); await gate; } return action();
    },
      writeCurrent: async (key, value, active) => { if (!active()) throw new Error("Retired admission"); items.set(key, value); } };
    const session = { api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "admin-sync", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession;
    const repository = createAuthenticatedRepository(session), domain = repository.versionedWorkspace!; await repository.ready(); let workspace = await domain.readAsync(); const now = new Date().toISOString();
    for (const command of [{ type: "create_client", id: "customer", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } },
      { type: "start_project_work", clientId: "customer", projectId: "project", fieldMapId: "field", designId: "design", draftId: "draft", projectName: "Original project", fieldName: "Field", workName: "Work", unitSystem: "metric", initialMode: "design", projectCrs: null }]) workspace = (await domain.executeAsync(workspace.revision, { now, ...command } as WorkspaceCommand)).workspace;
    await repository.prepareOffline(); const serverRevision = workspace.revision, draft = parseDesignDraftDocument(workspace.draftDocuments[0].document);
    workspace = (await domain.executeAsync(workspace.revision, { type: "save_design_draft", now, designId: "design", expectedDesignRevision: 0, draft: { ...draft, name: "Exact locally saved field edit" } })).workspace;
    const original = JSON.parse(items.get(repository.storagePartition)!);
    if (disposition === "conflict") await api.command(fixture.workspaceId, { commandId: randomUUID(), expectedRevision: serverRevision, command: { type: "create_client", id: "independent", input: { primaryContactFirstName: "Independent", primaryContactLastName: "Writer" }, now } });
    else if (disposition.startsWith("delayed_lock_")) armFinalLock = true; else retireDuringRestore = true;
    const administrative = domain.executeAsync(workspace.revision, { type: "rename_project", now, projectId: "project", name: "Forbidden administrative rename" }, () => current);
    if (armFinalLock) {
      await waiting;
      if (disposition === "delayed_lock_account") await api.login("different-synthetic", secondPassword);
      else {
        await fixture.database.transaction(async transaction => transaction.setMembership(access.principal.id, fixture.workspaceId, disposition === "delayed_lock_denied" ? [] : ["field:read"]));
        if (disposition === "delayed_lock_denied") await assert.rejects(api.workspace(fixture.workspaceId)); else await api.restore();
      }
      release();
    }
    await assert.rejects(administrative);
    assert.equal(administrativePosts, 0); const retained = JSON.parse(items.get(repository.storagePartition)!);
    assert.equal(retained.document, original.document); assert.equal(JSON.parse(fixture.database.state.workspaces[0].document).catalog.projects[0].name, "Original project");
    if (disposition === "conflict") { assert.equal(retained.queue[0].state, "rejected"); assert.deepEqual(retained.queue[0].command, original.queue[0].command); }
    else if (disposition === "retired_account") assert.deepEqual(retained.queue, original.queue);
    else { assert.equal(retained.queue.length, 0); assert.equal(parseDesignDraftDocument(JSON.parse(fixture.database.state.workspaces[0].document).draftDocuments[0].document).name, "Exact locally saved field edit"); }
  } finally { release(); await fixture.api.close(); }
});

test("native-shaped storage supports online manual Save while offline and live capture remain refused", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let activeToken: string | null = null, online = true, pauseToken = false, release!: () => void, entered!: () => void;
  const tokenBarrier = new Promise<void>(resolve => { release = resolve; }), tokenEntered = new Promise<void>(resolve => { entered = resolve; });
  try {
    const fetcher = (async (path: string, init: RequestInit) => {
      if (!online) throw new TypeError("Synthetic offline connection");
      const response = await fixture.api.inject({ method: init.method as "GET" | "POST", url: path, headers: Object.fromEntries(new Headers(init.headers).entries()), payload: init.body as string | undefined });
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const secureStore = { get: async () => { if (pauseToken) { pauseToken = false; entered(); await tokenBarrier; } return activeToken; }, set: async (token: string) => { activeToken = token; }, clear: async () => { activeToken = null; } };
    const api = new ApiClient({ fetch: fetcher, nativeSession: secureStore }), access = await api.login(fixture.username, fixture.password), items = new Map<string, string>();
    const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, action) => action() };
    const session = { api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "native-shaped", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession;
    const repository = createAuthenticatedRepository(session), domain = repository.versionedWorkspace!; await repository.ready(); let workspace = await domain.readAsync(); const now = new Date().toISOString();
    for (const command of [{ type: "create_client", id: "customer", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } },
      { type: "start_project_work", clientId: "customer", projectId: "project", fieldMapId: "field", designId: "design", draftId: "draft", projectName: "Native manual project", fieldName: "Field", workName: "Work", unitSystem: "metric", initialMode: "design", projectCrs: null }]) workspace = (await domain.executeAsync(workspace.revision, { now, ...command } as WorkspaceCommand)).workspace;
    assert.equal(repository.canSaveManualField, true); assert.equal(repository.canCaptureLive, false); assert.equal(repository.canRetainOfflineField, false);
    let draft = parseDesignDraftDocument(workspace.draftDocuments[0].document);
    workspace = (await domain.executeAsync(workspace.revision, { type: "save_design_draft", now, designId: "design", expectedDesignRevision: 0, draft: { ...draft, name: "Actually saved through native server CAS" } })).workspace;
    assert.equal(repository.status().pending, 0); assert.equal(parseDesignDraftDocument(JSON.parse(fixture.database.state.workspaces[0].document).draftDocuments[0].document).name, "Actually saved through native server CAS");
    draft = parseDesignDraftDocument(workspace.draftDocuments[0].document); const original = JSON.parse(items.get(repository.storagePartition)!).document;
    let current = true; pauseToken = true;
    const held = domain.executeAsync(workspace.revision, { type: "save_design_draft", now, designId: "design", expectedDesignRevision: workspace.catalog.designs[0].revision, draft: { ...draft, name: "Refused during secure-token wait" } }, () => current);
    await tokenEntered; current = false; release(); await assert.rejects(held, /selected work changed/); assert.equal(JSON.parse(items.get(repository.storagePartition)!).document, original);
    await repository.prepareOffline(); const connections: string[] = []; repository.subscribeStatus(status => { connections.push(status.connection); });
    online = false; await assert.rejects(repository.sync()); assert.equal(connections.at(-1), "offline"); assert.equal(repository.canSaveManualField, false);
    const offline = createAuthenticatedRepository({ ...session, status: "offline", processId: "native-cold" }); await offline.ready();
    assert.equal(offline.canSaveManualField, false); assert.equal(offline.canCaptureLive, false); assert.equal(offline.canRetainOfflineField, false);
    await assert.rejects(offline.versionedWorkspace!.executeAsync(workspace.revision, { type: "save_design_draft", now, designId: "design", expectedDesignRevision: workspace.catalog.designs[0].revision, draft }), /Offline field changes cannot be saved safely on this device/);
    const collection = createSurveyCollection({ id: "refused-capture", now, purpose: { kind: "point", role: "control" }, owner: { designId: "design", documentKind: "draft", payloadId: "draft", fieldMapId: "field", projectCrs: "EPSG:32613" } });
    // Structural command parsing succeeds; its unavailable host admission refuses
    // before reducer/storage/server claims a collected receiver observation.
    await assert.rejects(domain.executeAsync(workspace.revision, { type: "append_survey_capture", now, collectionId: collection.id, expectedCollectionRevision: 0, expectedDesignRevision: workspace.catalog.designs[0].revision,
      point: { id: "unadmitted", label: "Refused", role: "control", projected: { x: 1, y: 2 }, observedAt: now, source: "manual", confidence: "user_estimated" } }, () => true), /Live GPS records cannot be saved safely on this device/);
  } finally { release(); await fixture.api.close(); }
});
