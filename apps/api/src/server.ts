import Fastify, { type FastifyRequest } from "fastify";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { OFFLINE_WORK_DURATION_MS, bytesToHex, type AccessSnapshot, type CommandResponse, type OfflineGrant, type Principal, type UserRole, type WorkspacePermission, type CatalogMetadata } from "@cplayout/auth-client";
import { applyWorkspaceDocumentCommand, parseWorkspaceCommand } from "../../../packages/project-store/src/workspaceCommands";
import { parseWorkspaceDocument, serializeWorkspaceDocument, WorkspaceDocumentError } from "../../../packages/project-store/src/workspaceDocument";
import type { ApiDatabase, ApiTransaction, SessionRecord, UserRecord, StoredWorkspace, ArchiveRecord } from "./database";
import { sha256 } from "./database";
import { argonPasswords, validateNewPassword, type PasswordService } from "./passwords";
import { parseLayoutSessionDocument } from "../../../packages/core/src/layoutSession";
import { RTK_LAYOUT_SESSION_DOCUMENT_VERSION } from "../../../packages/core/src/officialLayout";
import { assertNotArchived, commandPermission, requireAdmin, requirePermission, ServiceError } from "./permissions";

export interface ApiServerOptions { database: ApiDatabase; signingKey: Uint8Array; origin: string; secureCookies?: boolean; passwords?: PasswordService; now?: () => number }
type SessionOwner = { user: UserRecord; session: SessionRecord; tokenHash: string };
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new ServiceError(400, "invalid_request", "Enter the required information."); return value as Record<string, unknown>; }
function string(value: unknown, label: string, maximum = 200): string { if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new ServiceError(400, "invalid_request", `${label} is required and must be within its supported length.`); return value; }
function uuid(value: unknown): string { const text = string(value, "Identity"); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) throw new ServiceError(400, "invalid_request", "Choose a valid workspace or account."); return text; }
function principal(user: UserRecord): Principal { return { id: user.id, username: user.username, displayName: user.displayName, roles: [...user.roles] }; }
function equal(a: string, b: string): boolean { const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); }
function catalogMetadata(id: string, stored: StoredWorkspace, archives: readonly ArchiveRecord[], principalId: string, policyRevision: number): CatalogMetadata {
  const workspace = parseWorkspaceDocument(stored.document);
  if (stored.id !== id || workspace.revision !== stored.revision) throw new ServiceError(409, "catalog_changed", "The saved customer folders changed. Refresh your customers.");
  const customerArchives = new Set(archives.filter(item => item.kind === "customer").map(item => item.entityId)), projectArchives = new Set(archives.filter(item => item.kind === "project").map(item => item.entityId));
  const customers = workspace.catalog.clients.map(customer => ({ id: customer.id, displayName: customer.displayName, archived: customerArchives.has(customer.id) }));
  const names = new Map(customers.map(customer => [customer.id, customer.displayName]));
  const projects = workspace.catalog.projects.map(project => {
    const customerDisplayName = names.get(project.clientId);
    if (customerDisplayName === undefined) throw new ServiceError(409, "catalog_changed", "The project's customer could not be read. Refresh your customers.");
    return { ...project, customerDisplayName, archived: projectArchives.has(project.id) || customerArchives.has(project.clientId), individuallyArchived: projectArchives.has(project.id) };
  });
  return { workspaceId: id, revision: workspace.revision, principalId, policyRevision, customers, projects };
}

export async function createApi(options: ApiServerOptions) {
  if (options.signingKey.length !== 32) throw new Error("Configure a 32-byte offline signing key.");
  const origin = new URL(options.origin).origin, secureCookies = options.secureCookies ?? true, now = options.now ?? Date.now;
  if (!secureCookies && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) throw new Error("Insecure cookies are limited to a loopback test service.");
  const cookieName = secureCookies ? "__Host-cplayout_session" : "cplayout_session";
  const passwords = options.passwords ?? argonPasswords, dummyHash = await passwords.hash(randomBytes(32).toString("base64url"));
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024, requestTimeout: 30_000 });
  const loginAttempts = new Map<string, { count: number; expires: number }>();
  const publicKey = bytesToHex(ed25519.getPublicKey(options.signingKey)), keyId = sha256(publicKey).slice(0, 16);
  const cookie = (token: string, clear = false) => `${cookieName}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict${secureCookies ? "; Secure" : ""}; Max-Age=${clear ? "0" : "86400"}`;
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store"); reply.header("X-Content-Type-Options", "nosniff");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.headers.origin && request.headers.origin !== origin || request.headers["sec-fetch-site"] === "cross-site") throw new ServiceError(403, "origin_refused", "This action must come from the signed-in workspace.");
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ServiceError) return reply.code(error.status).send({ code: error.code, message: error.message, requestId: request.id });
    if (error instanceof WorkspaceDocumentError) return reply.code(error.code === "conflict" || error.code === "identity_mismatch" ? 409 : 422).send({ code: error.code, message: error.message, requestId: request.id });
    const validation = error as { validation?: unknown; statusCode?: number; code?: string };
    if (validation.statusCode === 400 || validation.validation) return reply.code(400).send({ code: "invalid_request", message: "The request could not be read. Your saved work is retained.", requestId: request.id });
    return reply.code(500).send({ code: "service_unavailable", message: "The service could not finish this action. Your work is retained.", requestId: request.id });
  });
  function token(request: FastifyRequest): string | null {
    const auth = request.headers.authorization;
    if (auth) return /^Bearer ([A-Za-z0-9_-]{43})$/.exec(auth)?.[1] ?? null;
    const values = (request.headers.cookie ?? "").split(";").map(part => part.trim());
    return values.find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? null;
  }
  async function authenticate(transaction: ApiTransaction, request: FastifyRequest, mutate = false): Promise<SessionOwner> {
    const bearer = token(request);
    if (!bearer) throw new ServiceError(401, "sign_in_required", "Sign in to continue.");
    const tokenHash = sha256(bearer), session = await transaction.session(tokenHash), user = session ? await transaction.userById(session.userId) : null;
    if (!session || !user || user.disabled || session.accessRevision !== user.accessRevision || Date.parse(session.expiresAt) <= now()) throw new ServiceError(401, "session_expired", "Sign in again to continue. Your saved work is retained.");
    const expectedPrincipal = request.headers["x-cplayout-principal"];
    if (request.url.startsWith("/api/v1/workspaces/") && expectedPrincipal !== undefined && expectedPrincipal !== user.id)
      throw new ServiceError(409, "account_changed", "The signed-in account changed before this workspace read or action. Renew access; saved work is retained.");
    if (mutate && !request.headers.authorization && (typeof request.headers["x-csrf-token"] !== "string" || !equal(request.headers["x-csrf-token"], session.csrfToken))) throw new ServiceError(403, "csrf_refused", "Refresh your signed-in workspace before trying this action.");
    return { user, session, tokenHash };
  }
  async function snapshot(transaction: ApiTransaction, owner: SessionOwner): Promise<AccessSnapshot> { return { principal: principal(owner.user), workspaces: await transaction.memberships(owner.user.id), csrfToken: owner.session.csrfToken, serverTime: new Date(now()).toISOString() }; }
  function limitLogin(request: FastifyRequest, username: string) {
    const instant = now();
    if (loginAttempts.size > 10_000) for (const [key, value] of loginAttempts) if (value.expires <= instant) loginAttempts.delete(key);
    for (const key of [sha256(`ip:${request.ip}`), sha256(`username:${username}`)]) {
      const previous = loginAttempts.get(key), current = previous && previous.expires > instant ? previous : { count: 0, expires: instant + 15 * 60_000 };
      current.count++; loginAttempts.set(key, current);
      if (current.count > 10 || loginAttempts.size > 10_000) throw new ServiceError(429, "sign_in_limited", "Too many sign-in attempts. Wait 15 minutes before trying again.");
    }
  }
  app.get("/api/v1/health", async () => ({ service: "CPLayout", status: "ready" }));
  app.post("/api/v1/session/login", async (request, reply) => {
    const body = object(request.body), username = string(body.username, "Username", 100).trim().toLowerCase(), password = string(body.password, "Password", 1024);
    if (body.native !== undefined && typeof body.native !== "boolean") throw new ServiceError(400, "invalid_request", "The sign-in request is invalid.");
    limitLogin(request, username);
    const result = await options.database.transaction(async transaction => {
      const user = await transaction.userByUsername(username), matches = await passwords.verify(user?.passwordHash ?? dummyHash, password);
      if (!user || user.disabled || !matches) throw new ServiceError(401, "invalid_credentials", "Username or password is incorrect.");
      const bearer = randomBytes(32).toString("base64url"), session: SessionRecord = { tokenHash: sha256(bearer), userId: user.id, accessRevision: user.accessRevision,
        csrfToken: randomBytes(32).toString("base64url"), expiresAt: new Date(now() + OFFLINE_WORK_DURATION_MS).toISOString() };
      await transaction.insertSession(session); await transaction.audit(user.id, null, "session.login");
      return { ...(await snapshot(transaction, { user, session, tokenHash: session.tokenHash })), bearer };
    });
    const { bearer, ...access } = result;
    if (body.native === true) return { ...access, nativeToken: bearer };
    reply.header("Set-Cookie", cookie(bearer)); return access;
  });
  app.get("/api/v1/session", request => options.database.transaction(async transaction => snapshot(transaction, await authenticate(transaction, request))));
  app.post("/api/v1/session/logout", async (request, reply) => {
    await options.database.transaction(async transaction => {
      const owner = await authenticate(transaction, request, true), expected = request.body && typeof request.body === "object" ? (request.body as { expectedPrincipalId?: unknown }).expectedPrincipalId : undefined;
      if (expected !== undefined && expected !== owner.user.id) throw new ServiceError(409, "account_changed", "The signed-in account changed before this action. Your saved work is retained.");
      await transaction.deleteSession(owner.tokenHash); await transaction.audit(owner.user.id, null, "session.logout");
    });
    reply.header("Set-Cookie", cookie("", true)); return { signedOut: true };
  });
  app.get("/api/v1/workspaces/:workspaceId", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request), id = uuid((request.params as { workspaceId: string }).workspaceId);
    requirePermission(owner.user, await transaction.membership(owner.user.id, id), "field:read");
    const workspace = await transaction.workspace(id); if (!workspace) throw new ServiceError(404, "not_found", "Workspace not found.");
    return { workspaceId: id, revision: workspace.revision, document: workspace.document, sha256: sha256(workspace.document) };
  }));
  app.post("/api/v1/workspaces/:workspaceId/import", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request, true); requireAdmin(owner.user);
    const id = uuid((request.params as { workspaceId: string }).workspaceId), body = object(request.body);
    requirePermission(owner.user, await transaction.membership(owner.user.id, id), "catalog:write");
    const document = string(body.document, "Workspace recovery document", 32 * 1024 * 1024), sourceHash = string(body.sha256, "Source hash", 64);
    if (sha256(document) !== sourceHash) throw new ServiceError(422, "source_mismatch", "The recovery document differs from its reviewed hash. Keep the original source.");
    const imported = parseWorkspaceDocument(document), stored = await transaction.workspace(id, true);
    if (!stored) throw new ServiceError(404, "not_found", "Workspace not found.");
    if (stored.revision !== body.expectedRevision) throw new ServiceError(409, "revision_conflict", "The destination changed before import. Review its current source.");
    const previous = parseWorkspaceDocument(stored.document);
    if (previous.catalog.clients.length || previous.catalog.projects.length || previous.catalog.designs.length || previous.projectDocuments.length || previous.draftDocuments.length
      || previous.fieldDocuments?.length || previous.layoutSessions?.length || previous.surveyCollections?.length || previous.tombstones.length) throw new ServiceError(409, "destination_not_empty", "Import requires an empty destination workspace. Your existing saved work is retained.");
    if (imported.layoutSessions?.some(entry => parseLayoutSessionDocument(entry.document).documentVersion === RTK_LAYOUT_SESSION_DOCUMENT_VERSION))
      throw new ServiceError(422, "layout_reference_import_required", "Import saved RTK Layout maps individually as reference records. Keep the original workspace recovery file.");
    if (imported.revision <= stored.revision)
      throw new ServiceError(409, "import_revision_conflict", "This recovery file cannot advance the workspace's saved version safely. Keep the original recovery file.");
    // TEXT bytes, original document revisions and all recovery chains are preserved.
    // A strictly newer revision prevents queued commands from reusing an earlier
    // CAS generation. No capability upgrade or merge changes the reviewed import.
    await transaction.writeWorkspace({ ...stored, revision: imported.revision, document });
    await transaction.audit(owner.user.id, id, "workspace.import", sourceHash);
    return { workspaceId: id, revision: imported.revision, document, sha256: sourceHash };
  }));
  app.post("/api/v1/workspaces/:workspaceId/commands", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request, true), id = uuid((request.params as { workspaceId: string }).workspaceId), body = object(request.body);
    if (body.expectedPrincipalId !== undefined && body.expectedPrincipalId !== owner.user.id) throw new ServiceError(409, "account_changed", "The signed-in account changed before this action. Your saved work is retained.");
    const commandId = string(body.commandId, "Action identity"), expected = body.expectedRevision;
    if (!Number.isSafeInteger(expected) || Number(expected) < 0) throw new ServiceError(400, "invalid_revision", "Reload the saved source before changing it.");
    const raw = object(body.command), commandInput = { ...raw };
    if (raw.type === "review_survey") commandInput.completedBy = owner.user.id;
    if (raw.type === "append_layout_mark") commandInput.recordedBy = owner.user.id;
    if (raw.type === "create_rtk_layout_session") commandInput.creationLock = { ...object(raw.creationLock), recordedBy: owner.user.id };
    if (raw.type === "finalize_rtk_layout_session") commandInput.finalizationLock = { ...object(raw.finalizationLock), recordedBy: owner.user.id };
    const command = parseWorkspaceCommand(commandInput), permission = commandPermission(command.type);
    requirePermission(owner.user, await transaction.membership(owner.user.id, id), permission);
    if (permission === "catalog:archive") requireAdmin(owner.user);
    const stored = await transaction.workspace(id, true); if (!stored) throw new ServiceError(404, "not_found", "Workspace not found.");
    const requestHash = sha256(JSON.stringify({ expectedRevision: expected, command })), previous = await transaction.receipt(id, commandId);
    if (previous) {
      if (previous.userId !== owner.user.id || previous.requestHash !== requestHash) throw new ServiceError(409, "duplicate_action", "This action identity already belongs to different saved work.");
      return { ...JSON.parse(previous.responseDocument) as CommandResponse, replayed: true };
    }
    if (stored.revision !== expected) throw new ServiceError(409, "revision_conflict", "The saved workspace changed. Keep your entered work and reconcile its source before synchronizing.");
    const workspace = parseWorkspaceDocument(stored.document);
    assertNotArchived(workspace, command, await transaction.archives(id));
    // Client captures have already committed under its actual live receiver lock.
    // This server transaction imports retained evidence, and does not assert live freshness.
    const result = applyWorkspaceDocumentCommand(stored.document, command), document = serializeWorkspaceDocument(result.workspace);
    await transaction.writeWorkspace({ ...stored, revision: result.workspace.revision, document });
    const response: CommandResponse = { workspace: result.workspace, ...(result.value === undefined ? {} : { value: result.value }), revision: result.workspace.revision, replayed: false };
    await transaction.insertReceipt(id, commandId, { userId: owner.user.id, requestHash, responseDocument: JSON.stringify(response) });
    await transaction.audit(owner.user.id, id, `workspace.${command.type}`, commandId); return response;
  }));
  app.post("/api/v1/workspaces/:workspaceId/offline-grant", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request, true), id = uuid((request.params as { workspaceId: string }).workspaceId);
    const access = requirePermission(owner.user, await transaction.membership(owner.user.id, id), "field:read"), stored = await transaction.workspace(id);
    if (!stored) throw new ServiceError(404, "not_found", "Workspace not found.");
    const workspace = parseWorkspaceDocument(stored.document), archives = await transaction.archives(id);
    const archivedProjects = new Set(archives.filter(item => item.kind === "project").map(item => item.entityId)), customers = new Set(archives.filter(item => item.kind === "customer").map(item => item.entityId));
    const issuedAt = now();
    const grant: OfflineGrant = { grantVersion: "cplayout-offline-grant-v1", id: randomUUID(), subject: owner.user.id, workspaceId: id, principal: principal(owner.user), workspaceName: stored.name,
      projectIds: workspace.catalog.projects.filter(project => !archivedProjects.has(project.id) && !customers.has(project.clientId)).map(project => project.id),
      permissions: access.permissions.filter((permission): permission is "field:read" | "field:write" => permission === "field:read" || permission === "field:write"), policyRevision: access.policyRevision,
      issuedAt: new Date(issuedAt).toISOString(), expiresAt: new Date(issuedAt + OFFLINE_WORK_DURATION_MS).toISOString() };
    const payload = JSON.stringify(grant); await transaction.audit(owner.user.id, id, "offline.grant", grant.id);
    return { grant: { payload, signature: bytesToHex(ed25519.sign(new TextEncoder().encode(payload), options.signingKey)), keyId }, verificationKey: publicKey, serverTime: new Date(now()).toISOString() };
  }));
  app.get("/api/v1/workspaces/:workspaceId/customers", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request), id = uuid((request.params as { workspaceId: string }).workspaceId);
    requirePermission(owner.user, await transaction.membership(owner.user.id, id), "field:read");
    const stored = await transaction.workspace(id); if (!stored) throw new ServiceError(404, "not_found", "Workspace not found.");
    const archives = await transaction.archives(id), archived = new Set(archives.filter(item => item.kind === "customer").map(item => item.entityId));
    return { customers: parseWorkspaceDocument(stored.document).catalog.clients.map(customer => ({ ...customer, archived: archived.has(customer.id) })) };
  }));
  app.get("/api/v1/workspaces/:workspaceId/projects", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request), id = uuid((request.params as { workspaceId: string }).workspaceId);
    const access = requirePermission(owner.user, await transaction.membership(owner.user.id, id), "field:read");
    const stored = await transaction.workspace(id, true); if (!stored) throw new ServiceError(404, "not_found", "Workspace not found.");
    const metadata = catalogMetadata(id, stored, await transaction.archives(id), owner.user.id, access.policyRevision);
    const query = request.query as { customerId?: string; includeArchived?: string };
    return { projects: metadata.projects.filter(project => !query.customerId || project.clientId === query.customerId)
      .filter(project => query.includeArchived === "true" || !project.archived) };
  }));
  app.get("/api/v1/workspaces/:workspaceId/catalog-metadata", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request), id = uuid((request.params as { workspaceId: string }).workspaceId);
    const access = requirePermission(owner.user, await transaction.membership(owner.user.id, id), "field:read");
    // Catalog commands and archive changes acquire this same workspace row lock.
    // Holding it across both reads gives one actual folder/archive receipt.
    const stored = await transaction.workspace(id, true); if (!stored) throw new ServiceError(404, "not_found", "Workspace not found.");
    return catalogMetadata(id, stored, await transaction.archives(id), owner.user.id, access.policyRevision);
  }));
  app.post("/api/v1/workspaces/:workspaceId/archive", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request, true); requireAdmin(owner.user);
    const id = uuid((request.params as { workspaceId: string }).workspaceId), body = object(request.body), entityId = string(body.entityId, "Customer or project");
    if (!['customer', 'project'].includes(String(body.kind)) || typeof body.archived !== "boolean") throw new ServiceError(400, "invalid_request", "Choose the customer or project and archive action.");
    requirePermission(owner.user, await transaction.membership(owner.user.id, id), "catalog:archive");
    const stored = await transaction.workspace(id, true); if (!stored) throw new ServiceError(404, "not_found", "Workspace not found.");
    if (body.expectedRevision !== stored.revision) throw new ServiceError(409, "revision_conflict", "The workspace changed. Review the current customer or project before archiving.");
    const workspace = parseWorkspaceDocument(stored.document), kind = body.kind as "customer" | "project";
    if (!(kind === "customer" ? workspace.catalog.clients : workspace.catalog.projects).some(item => item.id === entityId)) throw new ServiceError(404, "not_found", "Customer or project not found.");
    await transaction.archive(id, owner.user.id, kind, entityId, body.archived);
    // Archive is metadata outside immutable domain documents; advance the workspace
    // CAS revision so queued writes cannot ignore a changed archive disposition.
    workspace.revision++; await transaction.writeWorkspace({ ...stored, revision: workspace.revision, document: serializeWorkspaceDocument(workspace) });
    await transaction.audit(owner.user.id, id, `${kind}.${body.archived ? "archive" : "restore"}`, entityId);
    return { revision: workspace.revision, archived: body.archived };
  }));
  app.get("/api/v1/workspaces/:workspaceId/archive-state", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request), id = uuid((request.params as { workspaceId: string }).workspaceId);
    requirePermission(owner.user, await transaction.membership(owner.user.id, id), "field:read");
    // Lock one source row while reading its sidecar so revision and archive state
    // cannot come from different concurrent transactions.
    const stored = await transaction.workspace(id, true); if (!stored) throw new ServiceError(404, "not_found", "Workspace not found.");
    const workspace = parseWorkspaceDocument(stored.document), archives = await transaction.archives(id);
    const customers = new Set(archives.filter(item => item.kind === "customer").map(item => item.entityId));
    const projects = new Set(archives.filter(item => item.kind === "project").map(item => item.entityId));
    return { workspaceId: id, revision: stored.revision,
      customers: workspace.catalog.clients.map(customer => ({ id: customer.id, displayName: customer.displayName, archived: customers.has(customer.id) })),
      projects: workspace.catalog.projects.map(project => ({ id: project.id, clientId: project.clientId, name: project.name,
        archived: projects.has(project.id) || customers.has(project.clientId), individuallyArchived: projects.has(project.id) })) };
  }));
  app.get("/api/v1/admin/users", request => options.database.transaction(async transaction => { const owner = await authenticate(transaction, request); requireAdmin(owner.user); return { users: await transaction.users() }; }));
  app.post("/api/v1/admin/users", async request => {
    const body = object(request.body), username = string(body.username, "Username", 100).trim().toLowerCase(), displayName = string(body.displayName, "Name"), password = string(body.password, "Password", 1024);
    if (!/^[a-z0-9][a-z0-9_.@-]{0,99}$/.test(username)) throw new ServiceError(400, "invalid_request", "Use letters, numbers, periods, underscores, hyphens or @ in the username.");
    try { validateNewPassword(password); } catch { throw new ServiceError(400, "invalid_request", "Use a password between 15 and 1024 characters."); }
    const roles = body.roles;
    if (!Array.isArray(roles) || !roles.length || roles.some(role => !["operator", "admin", "support"].includes(role))) throw new ServiceError(400, "invalid_request", "Choose valid account roles.");
    return options.database.transaction(async transaction => { const owner = await authenticate(transaction, request, true); requireAdmin(owner.user);
      if (await transaction.userByUsername(username)) throw new ServiceError(409, "existing_user", "This username is already in use.");
      const user: UserRecord = { id: randomUUID(), username, displayName, roles: roles as UserRole[], passwordHash: await passwords.hash(password), disabled: false, accessRevision: 0 };
      await transaction.insertUser(user); await transaction.audit(owner.user.id, null, "user.create", user.id); return { user: principal(user) }; });
  });
  app.post("/api/v1/admin/users/:userId/access", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request, true); requireAdmin(owner.user); const id = uuid((request.params as { userId: string }).userId), body = object(request.body);
    if (id === owner.user.id) throw new ServiceError(409, "self_access_refused", "Another administrator must change your account access.");
    const user = await transaction.userById(id); if (!user) throw new ServiceError(404, "not_found", "Account not found.");
    if (!Array.isArray(body.roles) || !body.roles.length || body.roles.some(role => !["operator", "admin", "support"].includes(role)) || typeof body.disabled !== "boolean") throw new ServiceError(400, "invalid_request", "Choose valid account access.");
    await transaction.updateUserAccess(id, body.roles as UserRole[], body.disabled); await transaction.audit(owner.user.id, null, "user.access", id); return { updated: true };
  }));
  app.post("/api/v1/admin/users/:userId/memberships", request => options.database.transaction(async transaction => {
    const owner = await authenticate(transaction, request, true); requireAdmin(owner.user); const id = uuid((request.params as { userId: string }).userId), body = object(request.body), workspaceId = uuid(body.workspaceId);
    if (!await transaction.userById(id) || !await transaction.workspace(workspaceId)) throw new ServiceError(404, "not_found", "Account or workspace not found.");
    if (!Array.isArray(body.permissions) || body.permissions.some(permission => !["field:read", "field:write", "catalog:write", "catalog:archive"].includes(permission))) throw new ServiceError(400, "invalid_request", "Choose valid workspace permissions.");
    await transaction.setMembership(id, workspaceId, body.permissions as WorkspacePermission[]); await transaction.audit(owner.user.id, workspaceId, "membership.set", id); return { updated: true };
  }));
  return app;
}
