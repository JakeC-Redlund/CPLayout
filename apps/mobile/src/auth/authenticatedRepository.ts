import { ApiError, FieldWorkCache, cacheKey, advanceOfflineClock, offlineCommandAllowed, verifyOfflineGrant,
  type CachedFieldWork, type CommandRequest, type WorkspaceArchiveState, type ArchiveAcknowledgment } from "@cplayout/auth-client";
import { parseProjectDocument } from "@cplayout/core";
import { sha256Text } from "../../../../packages/core/src/sha256";
import { applyWorkspaceDocumentCommand, parseWorkspaceCommand, type WorkspaceCommand, type WorkspaceCommandValue } from "../../../../packages/project-store/src/workspaceCommands";
import { parseWorkspaceDocument, serializeWorkspaceDocument, WorkspaceDocumentError, type WorkspaceDocument } from "../../../../packages/project-store/src/workspaceDocument";
import { readWorkspaceDesign, workspaceBackendInfo, workspaceProjectCatalog } from "../../../../packages/project-store/src/versionedProjectRepository";
import type { ProjectRepository, VersionedWorkspaceRepository } from "../../../../packages/project-store/src/projectRepositoryTypes";
import { workspaceCommandPermission } from "../../../../packages/project-store/src/workspaceCommandPermission";
import type { AuthSession } from "./AuthProvider";
import type { AtomicAuthStorage } from "./authStorage";

export interface AuthenticatedRepositoryStatus { connection: "online" | "offline"; pending: number; rejected: number; message: string | null }
export interface AuthenticatedRepository extends ProjectRepository {
  ready(): Promise<void>; prepareOffline(): Promise<void>; sync(): Promise<void>; refresh(): Promise<void>;
  archiveState(): Promise<WorkspaceArchiveState>;
  subscribeArchiveState(listener: (state: WorkspaceArchiveState | null) => void): () => void;
  acknowledgeArchive(receipt: ArchiveAcknowledgment): Promise<void>;
  readonly canRetainFieldChanges: boolean;
  readonly fieldRetentionReason: string | null;
  readonly canSaveManualField: boolean;
  readonly canCaptureLive: boolean;
  readonly canRetainOfflineField: boolean;
  readonly fieldRecoveryReason: string | null;
  status(): AuthenticatedRepositoryStatus; storagePartition: string;
  subscribeStatus(listener: (status: AuthenticatedRepositoryStatus) => void): () => void;
}
const LIVE_CAPTURES = new Set(["append_survey_capture", "append_layout_mark", "append_layout_observation", "create_rtk_layout_session", "finalize_rtk_layout_session"]);
const ONLINE_CATALOG = new Set(["create_client", "update_client", "delete_client", "delete_project", "delete_design", "archive_and_delete_design",
  "create_project_with_initial_design", "create_project_with_initial_field_map", "create_project_record", "rename_project", "move_project_to_client",
  "rename_field_map", "create_field_map_record", "create_design_record", "start_project_work", "declare_work_crs", "import_design_document", "import_design_workspace_bundle"]);
function onlineOnly(type: string): boolean { return ONLINE_CATALOG.has(type) || !offlineCommandAllowed(type); }

export function affectedProjects(workspace: WorkspaceDocument, command: WorkspaceCommand): string[] {
  const raw = command as unknown as Record<string, unknown>;
  const fields = new Set<string>(), projects = new Set<string>();
  if (typeof raw.fieldMapId === "string") fields.add(raw.fieldMapId);
  for (const designId of [raw.designId, raw.sourceDesignId]) if (typeof designId === "string") {
    const design = workspace.catalog.designs.find(item => item.id === designId); if (design) fields.add(design.fieldMapId);
  }
  if (command.type === "copy_project" && command.sourceStored) {
    for (const design of workspace.catalog.designs) if (design.kind === "project" && design.pivotProjectId === command.source.id) fields.add(design.fieldMapId);
  }
  if (typeof raw.collectionId === "string") { const entry = workspace.surveyCollections?.find(item => item.id === raw.collectionId); if (entry) fields.add((JSON.parse(entry.document) as { owner: { fieldMapId: string } }).owner.fieldMapId); }
  if (raw.collection && typeof raw.collection === "object") fields.add((raw.collection as { owner: { fieldMapId: string } }).owner.fieldMapId);
  for (const sessionId of [raw.sessionId, raw.sourceSessionId]) if (typeof sessionId === "string") {
    const entry = workspace.layoutSessions?.find(item => item.id === sessionId); if (entry) fields.add((JSON.parse(entry.document) as { fieldMapId: string }).fieldMapId);
  }
  for (const fieldId of fields) { const projectId = workspace.catalog.fieldMaps.find(item => item.id === fieldId)?.projectId; if (projectId) projects.add(projectId); }
  if (typeof raw.projectId === "string" && workspace.catalog.projects.some(item => item.id === raw.projectId)) projects.add(raw.projectId);
  return [...projects];
}
/** Domain Save means admitted durable local work. Server synchronization is a
 * separate receipt and never retroactively claims physical receiver freshness. */
export function createAuthenticatedRepository(session: AuthSession, storage: AtomicAuthStorage = session.storage): AuthenticatedRepository {
  if (!session.principal || !session.workspaceId || !session.access) throw new Error("Sign in and choose a workspace before opening its repository.");
  const subject = session.principal.id, workspaceId = session.workspaceId, partition = cacheKey(subject, workspaceId);
  const cache = new FieldWorkCache(storage, subject, workspaceId, session.trustedVerificationKey ?? undefined);
  let initialized: Promise<void> | null = null, connection: "online" | "offline" = session.status === "offline" ? "offline" : "online", message: string | null = null;
  let pendingCount = 0, rejectedCount = 0, accessDenied = false, onlineVerifiedKey: string | null = null;
  let knownArchives: WorkspaceArchiveState | null = null;
  let acknowledgedArchiveRevision = -1;
  const archiveListeners = new Set<(state: WorkspaceArchiveState | null) => void>();
  const statusListeners = new Set<(status: AuthenticatedRepositoryStatus) => void>();
  let lastPublishedStatus: string | null = null;
  function statusSnapshot(): AuthenticatedRepositoryStatus { return { connection, pending: pendingCount, rejected: rejectedCount, message }; }
  function publishStatus() { const status = statusSnapshot(), key = JSON.stringify(status); if (key === lastPublishedStatus) return; lastPublishedStatus = key;
    for (const listener of statusListeners) { try { listener(status); } catch { /* UI publication cannot cancel retained evidence. */ } } }
  function setConnection(next: "online" | "offline") { connection = next; publishStatus(); }
  function publishArchives(state: WorkspaceArchiveState | null) { knownArchives = state; for (const listener of archiveListeners) { try { listener(state); } catch { /* UI publication cannot cancel a saved service receipt. */ } } }
  function currentArchiveReceipt(state: WorkspaceArchiveState) {
    if (state.revision < acknowledgedArchiveRevision) throw new Error("The archive acknowledgment is newer than this status read. Verify current saved customer and project status.");
    return state;
  }
  function report(work: CachedFieldWork) { pendingCount = work.queue.filter(item => item.state === "pending").length; rejectedCount = work.queue.filter(item => item.state === "rejected").length; publishStatus(); }
  function requireAccount() { if (session.api.access && session.api.access.principal.id !== subject) throw new Error("This workspace belongs to the preceding account. Preserve its recovery copy before switching."); }
  function requireReadAccount() {
    requireAccount();
    if (session.api.accessDenied) throw new ApiError(403, "access_changed", "The service denied this account's access. Renew access before refreshing its saved field work.");
    if (connection === "online") {
      const current = session.api.access, membership = current?.workspaces.find(item => item.workspaceId === workspaceId);
      if (!current || !current.principal.roles.some(role => role === "operator" || role === "admin") || !membership?.permissions.includes("field:read"))
        throw new ApiError(403, "access_changed", "This account cannot read the current field workspace. Its saved work stays retained.");
    }
  }
  function requireReadOwner(owner: typeof session.api.access) {
    requireReadAccount();
    if (session.api.access !== owner) throw new ApiError(409, "retired_request", "This field work belongs to an earlier account action. Reopen it with the current account; your saved work is retained.");
  }
  async function retainRead(value: CachedFieldWork, owner: typeof session.api.access): Promise<void> {
    requireReadOwner(owner);
    if (storage.writeCurrent) await storage.writeCurrent(partition, JSON.stringify(value), () => { requireReadOwner(owner); return true; });
    else await cache.retain(value);
    requireReadOwner(owner);
  }
  function requireMutationAccount(command: WorkspaceCommand) {
    requireAccount();
    if (accessDenied || session.api.accessDenied) throw new Error("The service denied this account's access. Renew authorized access before changing saved work.");
    if (connection === "online") {
      const principal = session.api.access?.principal, membership = session.api.access?.workspaces.find(item => item.workspaceId === workspaceId), permission = workspaceCommandPermission(command.type);
      if (!principal || principal.id !== subject || !principal.roles.some(role => role === "operator" || role === "admin") || !membership?.permissions.includes(permission)
        || permission === "catalog:archive" && !principal.roles.includes("admin")) throw new Error("Your account cannot perform this action in the current workspace.");
    }
  }
  async function work(): Promise<CachedFieldWork> { const current = await cache.read(); if (!current) throw new Error("Prepare this workspace online before opening it offline."); report(current); return current; }
  function offlineAdmission(current: CachedFieldWork, projectId: string | null, commandType?: string) {
    const trustedKey = session.trustedVerificationKey ?? (connection === "online" ? onlineVerifiedKey : null);
    if (!trustedKey || !current.authorization || current.authorization.verificationKey !== trustedKey) throw new Error("Offline access needs the workspace's trusted signing key and prepared field grant.");
    const clock = advanceOfflineClock(current.authorization.clock, { now: Date.now, monotonic: () => performance.now() }, session.processId);
    const grant = verifyOfflineGrant(current.authorization.grant, trustedKey, { subject, workspaceId }, clock.lastWallTime);
    if (!grant.permissions.includes("field:read") || commandType && (!grant.permissions.includes("field:write") || !offlineCommandAllowed(commandType))
      || projectId !== null && !grant.projectIds.includes(projectId)) throw new Error("This project action needs online authorization. Your saved work is retained.");
    return { ...current.authorization, clock };
  }
  async function prepareOffline(): Promise<void> {
    requireReadAccount(); if (!session.api.access) throw new Error("Connect and sign in to prepare offline field work.");
    const owner = session.api.access;
    let archives: WorkspaceArchiveState, grant;
    try { archives = currentArchiveReceipt(await session.api.archiveState(workspaceId)); requireReadOwner(owner); grant = await session.api.offlineGrant(workspaceId); requireReadOwner(owner); }
    catch (error) { if (error instanceof TypeError) setConnection("offline"); throw error; }
    if (session.trustedVerificationKey && grant.verificationKey !== session.trustedVerificationKey) throw new Error("The service's signing key changed. Keep your field work and review workspace configuration.");
    const instant = Date.now(); verifyOfflineGrant(grant.grant, grant.verificationKey, { subject, workspaceId }, instant);
    onlineVerifiedKey = grant.verificationKey;
    await storage.exclusive(partition, async () => {
      requireReadOwner(owner); const current = await work(); requireReadOwner(owner);
      await retainRead({ ...current, archives: { subject, workspaceId, state: archives }, authorization: { grant: grant.grant, verificationKey: grant.verificationKey,
        clock: { lastWallTime: instant, serverTime: Date.parse(grant.serverTime), monotonicTime: performance.now(), processId: session.processId } } }, owner);
    });
    requireReadOwner(owner);
    publishArchives(archives); message = "Offline field access is prepared for 24 hours."; setConnection("online");
  }
  async function ready(): Promise<void> {
    if (initialized) return initialized;
    initialized = (async () => {
      requireReadAccount(); const owner = session.api.access, current = await cache.read(); requireReadOwner(owner); acknowledgedArchiveRevision = Math.max(acknowledgedArchiveRevision, current?.archiveReceipt?.revision ?? -1); publishArchives(current?.archives?.state ?? null);
      if (current?.queue.length) { report(current); if (connection === "offline") offlineAdmission(current, null); return; }
      try {
        if (!session.api.access) throw new TypeError("Online session unavailable.");
        const remote = await session.api.workspace(workspaceId);
        requireReadOwner(owner);
        if (sha256Text(remote.document) !== remote.sha256 || parseWorkspaceDocument(remote.document).revision !== remote.revision) throw new Error("The downloaded workspace could not be verified. Your saved work on this device is retained.");
        await storage.exclusive(partition, async () => {
          requireReadOwner(owner); const latest = await cache.read(); requireReadOwner(owner); if (latest?.queue.length) { report(latest); return; }
          await retainRead({ subject, workspaceId, document: remote.document, authorization: latest?.authorization ?? null, queue: [], ...(latest?.archives ? { archives: latest.archives } : {}), ...(latest?.archiveReceipt ? { archiveReceipt: latest.archiveReceipt } : {}) }, owner);
        }); requireReadOwner(owner); setConnection("online");
      } catch (error) {
        requireReadOwner(owner); if (!(error instanceof TypeError) || !current) throw error;
        offlineAdmission(current, null); message = "Working offline. Server synchronization is pending."; setConnection("offline");
      }
    })().catch(error => { initialized = null; throw error; }); return initialized;
  }
  async function read(): Promise<WorkspaceDocument> { await ready(); requireReadAccount(); const owner = session.api.access, current = await work(); requireReadOwner(owner); if (connection === "offline") offlineAdmission(current, null); return parseWorkspaceDocument(current.document); }
  async function refresh(): Promise<void> {
    await ready(); requireReadAccount(); const owner = session.api.access;
    const remote = await session.api.workspace(workspaceId);
    requireReadOwner(owner);
    if (sha256Text(remote.document) !== remote.sha256 || parseWorkspaceDocument(remote.document).revision !== remote.revision) throw new Error("The downloaded workspace could not be verified. Your saved work on this device is retained.");
    await storage.exclusive(partition, async () => {
      requireReadOwner(owner); const current = await work(); requireReadOwner(owner); if (current.queue.length) throw new Error("Synchronize or reconcile local field work before loading a newer shared workspace.");
      await retainRead({ ...current, document: remote.document }, owner);
    }); requireReadOwner(owner); setConnection("online"); accessDenied = false;
  }
  async function sync(): Promise<void> {
    requireAccount();
    try { await session.api.restore(); }
    catch (error) {
      if (error instanceof ApiError) accessDenied = true; else setConnection("offline");
      message = error instanceof Error ? error.message : "Synchronization is unavailable. Your local evidence is retained.";
      throw error;
    }
    if (session.api.access?.principal.id !== subject) { accessDenied = true; throw new Error("Sign in with this field work's owner before synchronizing."); }
    await storage.exclusive(partition, async () => {
      try { await cache.sync(session.api); report(await work()); message = pendingCount ? "Some field work is still waiting for synchronization." : "Field work is synchronized."; setConnection("online"); accessDenied = false; }
      catch (error) { report(await work()); message = error instanceof Error ? error.message : "Synchronization needs attention. Your local evidence is retained."; if (!(error instanceof ApiError)) setConnection("offline"); else if ([401, 403].includes(error.status)) accessDenied = true; publishStatus(); throw error; }
    });
  }
  const versioned: VersionedWorkspaceRepository = {
    readAsync: read,
    async readDesignAsync(id) { return readWorkspaceDesign(await read(), id); },
    async readLeaseAsync(expected, action, isCurrent) {
      await ready(); return storage.exclusive(partition, async () => {
        requireAccount();
        if (!storage.readCurrent) throw new WorkspaceDocumentError("conflict", "This device cannot safely restore unfinished work. Keep a recovery copy and reopen the saved workspace.");
        const document = (await work()).document, current = parseWorkspaceDocument(document);
        if (!Number.isSafeInteger(expected) || expected < 0 || current.revision !== expected) throw new WorkspaceDocumentError("conflict", "The saved workspace changed before it could be opened. Keep your entries and reopen the current saved work.");
        let active = true;
        const assertCurrent = () => {
          requireAccount();
          const raw = storage.readCurrent!(partition), retained = raw === null ? null : JSON.parse(raw) as CachedFieldWork;
          if (!active || !isCurrent() || !retained || retained.subject !== subject || retained.workspaceId !== workspaceId || retained.document !== document)
            throw new WorkspaceDocumentError("conflict", "The saved workspace changed before it could be opened. Keep your entries and reopen the current saved work.");
        };
        const freezeReceipt = (value: unknown): void => { if (value && typeof value === "object") { Object.values(value).forEach(freezeReceipt); Object.freeze(value); } };
        freezeReceipt(current); assertCurrent();
        try { return await action(current, assertCurrent); }
        // The action may intentionally publish a new UI owner. The old owner is
        // checked up to that publication and cannot invalidate its acknowledgment.
        finally { active = false; }
      });
    },
    async executeAsync(expectedRevision, input, isCurrent) {
      await ready(); requireAccount(); let command = parseWorkspaceCommand(input);
      if (accessDenied || session.api.accessDenied) throw new Error("The service denied this account's access. Keep its recovery copy and renew authorized access before saving.");
      if (command.type === "review_survey") command = { ...command, completedBy: subject };
      if (command.type === "append_layout_mark") command = { ...command, recordedBy: subject };
      if (command.type === "create_rtk_layout_session") command = { ...command, creationLock: { ...command.creationLock, recordedBy: subject } };
      if (command.type === "finalize_rtk_layout_session") command = { ...command, finalizationLock: { ...command.finalizationLock, recordedBy: subject } };
      const live = LIVE_CAPTURES.has(command.type);
      if (live && (!isCurrent || !storage.writeCurrent)) throw new WorkspaceDocumentError("conflict", "Live GPS records cannot be saved safely on this device. Your saved field work is retained.");
      if (connection === "offline" && !storage.writeCurrent) throw new Error("Offline field changes cannot be saved safely on this device. Keep a recovery copy and reconnect to save.");
      const directOnline = onlineOnly(command.type) || !storage.writeCurrent;
      if (directOnline && connection === "online" && (await work()).queue.length) {
        if (isCurrent && !isCurrent()) throw new WorkspaceDocumentError("conflict", "This action belongs to an earlier workspace. Your entered work is retained.");
        // Synchronize admitted local field evidence before an administrative
        // command takes its own final CAS lock. Never acquire the same lock twice.
        await sync(); requireAccount();
      }
      if (!directOnline && connection === "online") {
        const retained = await work();
        try { const projects = affectedProjects(parseWorkspaceDocument(retained.document), command); for (const projectId of projects.length ? projects : [null]) offlineAdmission(retained, projectId, command.type); }
        catch { await prepareOffline(); }
      }
      const commandId = `${subject}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return storage.exclusive(partition, async () => {
        requireMutationAccount(command);
        const retained = await work(), current = parseWorkspaceDocument(retained.document);
        requireMutationAccount(command);
        if (retained.queue.some(item => item.state === "rejected")) throw new Error("Reconcile the rejected saved work before adding another field action. Its exact evidence is retained.");
        if (current.revision !== expectedRevision || isCurrent && !isCurrent()) throw new WorkspaceDocumentError("conflict", "The source or active operation changed before saving. Preserve your entered work.");
        const projects = affectedProjects(current, command);
        if (projects.some(projectId => knownArchives?.projects.some(project => project.id === projectId && project.archived))) throw new Error("Restore this customer or project before changing its saved field work.");
        if (directOnline) {
          if (connection === "offline" || !session.api.access) throw new Error("This customer, project or file action requires online access.");
          if (retained.queue.length) throw new Error("Synchronize or reconcile the retained field work before changing customer or project records.");
          let response;
          try { response = await session.api.command(workspaceId, { commandId, expectedRevision, command }, () => { requireMutationAccount(command); return !isCurrent || isCurrent(); }); }
          catch (error) { if (error instanceof TypeError) setConnection("offline"); throw error; }
          const saved = parseWorkspaceDocument(JSON.stringify(response.workspace));
          const savedWork = { ...retained, document: serializeWorkspaceDocument(saved) };
          await cache.retain(savedWork);
          try {
            const archives = currentArchiveReceipt(await session.api.archiveState(workspaceId)); requireAccount();
            await cache.retain({ ...savedWork, archives: { subject, workspaceId, state: archives } }); publishArchives(archives);
          } catch { publishArchives(null); message = "The command was saved. Connect to verify current customer and project status before changing field work."; }
          return { workspace: saved, value: response.value as WorkspaceCommandValue };
        }
        if (projects.some(projectId => !knownArchives?.projects.some(project => project.id === projectId))) throw new Error("Verify the customer and project status before changing this field work. Its saved records are retained.");
        let authorization = offlineAdmission(retained, null, command.type);
        for (const projectId of projects) authorization = offlineAdmission(retained, projectId, command.type);
        if (connection === "online") {
          const membership = session.api.access?.workspaces.find(item => item.workspaceId === workspaceId);
          if (!membership?.permissions.includes("field:write") || !session.api.access?.principal.roles.some(role => role === "operator" || role === "admin")) throw new Error("Your account cannot save field changes in this workspace.");
        }
        const result = applyWorkspaceDocumentCommand(retained.document, command), document = serializeWorkspaceDocument(result.workspace);
        const request: CommandRequest = { commandId, expectedRevision, command };
        const next: CachedFieldWork = { ...retained, document, authorization, queue: [...retained.queue, { ...request, state: "pending" }] };
        const serialized = JSON.stringify(next);
        // Snapshot, immutable receiver evidence, outbox and command membership share
        // the same durable commit. No await occurs between final predicate and browser setItem.
        if (storage.writeCurrent) await storage.writeCurrent(partition, serialized, () => { requireMutationAccount(command); return !isCurrent || isCurrent(); });
        else { if (isCurrent && !isCurrent()) throw new WorkspaceDocumentError("conflict", "The selected field work changed before saving. Keep your entries and try again."); await cache.retain(next); }
        message = "Saved on this device. Synchronize to update the shared workspace."; report(next);
        return result;
      });
    },
    async exportRecoveryAsync() { return (await work()).document; },
  };
  const loadedRevisionRequired = async (): Promise<never> => { throw new WorkspaceDocumentError("conflict", "Reopen the current customer, project or field before saving changes."); };
  const repository: AuthenticatedRepository = {
    backendLabel: "Shared workspace with local field cache", versionedWorkspace: versioned, storagePartition: partition, ready, prepareOffline, sync, refresh,
    canRetainFieldChanges: typeof storage.writeCurrent === "function",
    fieldRetentionReason: storage.writeCurrent ? null : "This device cannot safely retain unfinished field edits. Saved work remains available for viewing and export.",
    get canSaveManualField() { return typeof storage.writeCurrent === "function" || connection === "online"; },
    canCaptureLive: typeof storage.writeCurrent === "function", canRetainOfflineField: typeof storage.writeCurrent === "function",
    fieldRecoveryReason: storage.writeCurrent ? null : "Save or discard unfinished entries before leaving this workspace. Automatic recovery, offline field editing and live GPS collection are unavailable on this device.",
    subscribeArchiveState(listener) { archiveListeners.add(listener); listener(knownArchives); return () => { archiveListeners.delete(listener); }; },
    async acknowledgeArchive(receipt) {
      if (receipt.workspaceId !== workspaceId || !Number.isSafeInteger(receipt.revision) || receipt.revision < 0
        || !["customer", "project"].includes(receipt.kind) || !receipt.entityId || typeof receipt.archived !== "boolean") throw new Error("The archive acknowledgment belongs to a different workspace or is unreadable.");
      acknowledgedArchiveRevision = Math.max(acknowledgedArchiveRevision, receipt.revision); publishArchives(null);
      // This receipt was already accepted by the service. It remains in the
      // captured account partition even if another account now owns the UI.
      await storage.exclusive(partition, async () => {
        const current = await work(); const { archives: _previousAuthority, ...retained } = current;
        await cache.retain({ ...retained, archiveReceipt: current.archiveReceipt && current.archiveReceipt.revision > receipt.revision ? current.archiveReceipt : { ...receipt, subject } });
      });
    },
    async archiveState() {
      await ready(); requireReadAccount(); const owner = session.api.access;
      if (connection !== "offline") {
        let state: WorkspaceArchiveState | null = null;
        try {
          state = currentArchiveReceipt(await session.api.archiveState(workspaceId)); requireReadOwner(owner);
        } catch (error) { if (error instanceof ApiError || session.api.accessDenied || !(error instanceof TypeError)) throw error; setConnection("offline"); }
        if (state) {
          const savedState = state;
          await storage.exclusive(partition, async () => {
            requireReadOwner(owner); const current = await work(); requireReadOwner(owner);
            await retainRead({ ...current, archives: { subject, workspaceId, state: savedState } }, owner);
          });
          requireReadOwner(owner);
          publishArchives(savedState); return savedState;
        }
      }
      const retained = await work(); requireReadOwner(owner); offlineAdmission(retained, null);
      if (!retained.archives || retained.archives.state.revision < acknowledgedArchiveRevision) throw new Error("Archive information was not prepared on this device. Connect to verify the customer and project status before changing field work.");
      publishArchives(retained.archives.state); return retained.archives.state;
    },
    status: statusSnapshot,
    subscribeStatus(listener) { statusListeners.add(listener); listener(statusSnapshot()); return () => { statusListeners.delete(listener); }; },
    describeWorkspace: current => ({ ...workspaceBackendInfo(current), storageEngine: "postgres_with_local_cache", backendLabel: "Shared workspace with local field cache", notes: [pendingCount || rejectedCount ? "Some local work has not been acknowledged by the shared workspace." : "Field work has a separate server synchronization receipt."] }),
    async getBackendInfoAsync() { return repository.describeWorkspace!(await read()); },
    async listProjectsAsync() { return (await read()).projectDocuments.map(item => item.summary); },
    async listProjectCatalogAsync() { return workspaceProjectCatalog(await read()); },
    async loadProjectAsync(id) { const entry = (await read()).projectDocuments.find(item => item.summary.id === id); return entry ? parseProjectDocument(entry.document) : null; },
    async loadDesignProjectAsync(id) { const design = readWorkspaceDesign(await read(), id); if (design.kind === "not_found") return null; if (design.kind !== "project") throw new Error("Open this saved work with its Design or Field editor."); return design.project; },
    saveProjectAsync: loadedRevisionRequired, saveDesignProjectAsync: loadedRevisionRequired, deleteProjectAsync: loadedRevisionRequired,
    createClientAsync: loadedRevisionRequired, updateClientAsync: loadedRevisionRequired, deleteClientAsync: loadedRevisionRequired,
    createProjectWithInitialDesignAsync: loadedRevisionRequired, createProjectWithInitialFieldMapAsync: loadedRevisionRequired,
    createProjectRecordAsync: loadedRevisionRequired, renameProjectAsync: loadedRevisionRequired, moveProjectToClientAsync: loadedRevisionRequired,
    createFieldMapRecordAsync: loadedRevisionRequired, createDesignRecordAsync: loadedRevisionRequired,
  };
  return repository;
}
