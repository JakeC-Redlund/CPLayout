import assert from "node:assert/strict";
import test from "node:test";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import { ApiClient, type WorkspaceArchiveState } from "@cplayout/auth-client";
import { createSyntheticApi } from "../../../api/src/testHarness";
import { createAuthenticatedRepository } from "../auth/authenticatedRepository";
import type { AuthSession } from "../auth/AuthProvider";
import type { AtomicAuthStorage } from "../auth/authStorage";
import { parseDesignDraftDocument } from "../../../../packages/core/src/designDraft";
import type { WorkspaceCommand } from "../../../../packages/project-store/src/workspaceCommands";
const loader = Module as unknown as { _load(request: string, parent: unknown, isMain: boolean): unknown }, original = loader._load;
const requireWorkspace = createRequire(resolve(process.cwd(), "package.json"));
let panel: typeof import("./CustomerMaintenancePanel");
try { loader._load = function(request, parent, isMain) { if (request === "react-native") return { StyleSheet: { create: (value: unknown) => value }, Pressable: () => null, View: () => null, Text: () => null }; return original.call(this, request, parent, isMain); }; panel = requireWorkspace(resolve(__dirname, "CustomerMaintenancePanel.tsx")); }
finally { loader._load = original; }
const state: WorkspaceArchiveState = { workspaceId: "fixture-workspace", revision: 7,
  customers: [{ id: "active", displayName: "Active customer", archived: false }, { id: "archived", displayName: "Archived customer", archived: true }],
  projects: [{ id: "current", clientId: "active", name: "Current project", archived: false, individuallyArchived: false },
    { id: "independent", clientId: "active", name: "Individually archived project", archived: true, individuallyArchived: true },
    { id: "inherited", clientId: "archived", name: "Retained child", archived: true, individuallyArchived: false }] };
test("active lists hide archived descendants while include-archived retains independent disposition", () => {
  const visible = panel.visibleMaintenanceRecords(state, false); assert.deepEqual(visible.customers.map(item => item.id), ["active"]); assert.deepEqual(visible.projects.map(item => item.id), ["current"]);
  const all = panel.visibleMaintenanceRecords(state, true); assert.equal(all.projects.length, 3); assert.equal(all.projects.find(item => item.id === "independent")!.individuallyArchived, true);
  assert.throws(() => panel.reviewMaintenanceChoice(state, { kind: "project", entityId: "inherited", archived: false }), /Restore.*customer/);
});
test("retired ownership, changed revision/name and changed disposition refuse archive before POST", async () => {
  const review = panel.reviewMaintenanceChoice(state, { kind: "customer", entityId: "active", archived: true }); let posts = 0, current = true;
  const api = { archiveState: async () => { current = false; return state; }, archive: async () => { posts++; return { revision: 8, archived: true }; } };
  await assert.rejects(panel.commitMaintenanceReview(api, review, () => current), /changed/); assert.equal(posts, 0);
  current = true; api.archiveState = async () => ({ ...state, revision: 8 }); await assert.rejects(panel.commitMaintenanceReview(api, review, () => current), /changed/); assert.equal(posts, 0);
  api.archiveState = async () => ({ ...state, customers: state.customers.map(item => item.id === "active" ? { ...item, displayName: "Renamed" } : item) });
  await assert.rejects(panel.commitMaintenanceReview(api, review, () => current), /name changed/); assert.equal(posts, 0);
});
test("acknowledged archive refreshes captured account cache after panel visibility retires", async () => {
  const review = panel.reviewMaintenanceChoice(state, { kind: "customer", entityId: "active", archived: true }); let current = true, reads = 0, refreshed = false;
  const committed = { ...state, revision: 8, customers: state.customers.map(item => item.id === "active" ? { ...item, archived: true } : item) };
  const api = { archiveState: async () => ++reads === 1 ? state : committed, archive: async () => { current = false; return { revision: 8, archived: true }; } };
  const result = await panel.commitMaintenanceReview(api, review, () => current, async next => { assert.equal(current, false); assert.equal(next.revision, 8); refreshed = true; });
  assert.equal(refreshed, true); assert.equal(result.revision, 8);
});
test("actual service customer archive/restore retains exact documents and independently archived child", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "";
  try {
    const fetcher = (async (path: string, options: RequestInit) => { const headers = new Headers(options.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: options.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers.entries()), payload: options.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]); return new Response(response.body, { status: response.statusCode }); }) as typeof fetch;
    const api = new ApiClient({ fetch: fetcher }); await api.login(fixture.username, fixture.password);
    const id = fixture.workspaceId, now = new Date().toISOString(); let remote = await api.workspace(id), sequence = 0;
    async function execute(command: unknown) { const result = await api.command(id, { commandId: `maintenance-${++sequence}`, expectedRevision: remote.revision, command: { now, ...command as object } }); remote = await api.workspace(id); return result; }
    await execute({ type: "create_client", id: "customer", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } });
    for (const name of ["A", "B"]) await execute({ type: "start_project_work", clientId: "customer", projectId: `project-${name}`, fieldMapId: `field-${name}`, designId: `design-${name}`, draftId: `draft-${name}`, projectName: `Project ${name}`, fieldName: `Field ${name}`, workName: `Work ${name}`, unitSystem: "metric", initialMode: "design", projectCrs: null });
    const before = JSON.parse(remote.document), draftDocuments = structuredClone(before.draftDocuments);
    let archive = await api.archiveState(id);
    await panel.commitMaintenanceReview(api, panel.reviewMaintenanceChoice(archive, { kind: "project", entityId: "project-B", archived: true }), () => true);
    archive = await api.archiveState(id); await panel.commitMaintenanceReview(api, panel.reviewMaintenanceChoice(archive, { kind: "customer", entityId: "customer", archived: true }), () => true);
    archive = await api.archiveState(id); assert(archive.projects.every(item => item.archived));
    const restored = await panel.commitMaintenanceReview(api, panel.reviewMaintenanceChoice(archive, { kind: "customer", entityId: "customer", archived: false }), () => true);
    assert.equal(restored.projects.find(item => item.id === "project-A")!.archived, false); assert.equal(restored.projects.find(item => item.id === "project-B")!.archived, true);
    const after = JSON.parse((await api.workspace(id)).document); assert.deepEqual(after.draftDocuments, draftDocuments); assert.deepEqual(after.catalog, before.catalog); assert.deepEqual(after.tombstones, before.tombstones);
    assert.equal(after.revision, before.revision + 3);
  } finally { await fixture.api.close(); }
});
test("acknowledged POST then status-read failure retains receipt and refuses stale field admission online and offline", async () => {
  const fixture = await createSyntheticApi("http://localhost:19040"); let cookie = "", online = true;
  try {
    const fetcher = (async (path: string, options: RequestInit) => {
      if (!online) throw new TypeError("Synthetic offline transport");
      const headers = new Headers(options.headers); if (cookie) headers.set("cookie", cookie);
      const response = await fixture.api.inject({ method: options.method as "GET" | "POST", url: path, headers: Object.fromEntries(headers.entries()), payload: options.body as string | undefined });
      if (response.headers["set-cookie"]) cookie = String(response.headers["set-cookie"]);
      return new Response(response.body, { status: response.statusCode });
    }) as typeof fetch;
    const api = new ApiClient({ fetch: fetcher }), access = await api.login(fixture.username, fixture.password), items = new Map<string, string>();
    const storage: AtomicAuthStorage = { read: async key => items.get(key) ?? null, write: async (key, value) => { items.set(key, value); }, exclusive: async (_key, action) => action(),
      writeCurrent: async (key, value, current) => { if (!current()) throw new Error("Retired field source"); items.set(key, value); } };
    const session = { api, access, principal: access.principal, workspaceId: fixture.workspaceId, storage, status: "signedIn", processId: "acknowledged-test", trustedVerificationKey: fixture.offlinePublicKey } as AuthSession;
    const repository = createAuthenticatedRepository(session), domain = repository.versionedWorkspace!; await repository.ready();
    const now = new Date().toISOString(); let workspace = await domain.readAsync();
    for (const command of [{ type: "create_client", id: "customer", input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Owner" } },
      { type: "start_project_work", clientId: "customer", projectId: "project", fieldMapId: "field", designId: "design", draftId: "draft", projectName: "Saved project", fieldName: "Saved field", workName: "Saved work", unitSystem: "metric", initialMode: "design", projectCrs: null }]) {
      workspace = (await domain.executeAsync(workspace.revision, { now, ...command } as WorkspaceCommand)).workspace;
    }
    await repository.prepareOffline(); const before = JSON.parse(items.get(repository.storagePartition)!);
    let published: WorkspaceArchiveState | null = await repository.archiveState(); repository.subscribeArchiveState(next => { published = next; });
    const review = panel.reviewMaintenanceChoice(published!, { kind: "project", entityId: "project", archived: true }); let statusReads = 0;
    const failingRead = { archive: api.archive.bind(api), archiveState: async (id: string) => { if (++statusReads > 1) throw new TypeError("Synthetic post-acknowledgment read failure"); return api.archiveState(id); } };
    await assert.rejects(panel.commitMaintenanceReview(failingRead, review, () => true, undefined, receipt => repository.acknowledgeArchive(receipt)), /service saved this archive action/);
    assert.equal(published, null); const retained = JSON.parse(items.get(repository.storagePartition)!);
    assert.equal(retained.document, before.document); assert.deepEqual(retained.queue, before.queue); assert.equal(retained.archives, undefined);
    assert.deepEqual(retained.archiveReceipt, { subject: access.principal.id, workspaceId: fixture.workspaceId, revision: workspace.revision + 1, kind: "project", entityId: "project", archived: true });
    const draft = parseDesignDraftDocument(workspace.draftDocuments[0].document), save = { type: "save_design_draft", now, designId: "design", expectedDesignRevision: 0, draft: { ...draft, name: "Refused stale edit" } } as const;
    await assert.rejects(domain.executeAsync(workspace.revision, save), /Verify the customer and project status/);
    online = false; const cold = createAuthenticatedRepository({ ...session, status: "offline", processId: "cold-acknowledged-test" });
    await assert.rejects(cold.archiveState(), /Archive information was not prepared/);
    await assert.rejects(cold.versionedWorkspace!.executeAsync(workspace.revision, save), /Verify the customer and project status/);
    assert.equal(JSON.parse(items.get(repository.storagePartition)!).document, before.document);
    online = true; await repository.refresh(); const current = await repository.archiveState(); assert.equal(current.projects[0].archived, true);
    assert.deepEqual(JSON.parse(items.get(repository.storagePartition)!).archiveReceipt, retained.archiveReceipt);
  } finally { await fixture.api.close(); }
});
