import { parseAccessSnapshot, parseWorkspaceArchiveState, parseProjectMetadataList, parseCustomerMetadataList, parseCatalogMetadata, type AccessSnapshot, type ApiFailure, type CommandRequest, type CommandResponse,
  type ProjectMetadata, type CustomerFolderMetadata, type CatalogMetadata,
  type OfflineGrantResponse, type RemoteWorkspace, type SessionResponse, type WorkspaceArchiveState, type ArchiveRequest } from "./contracts";

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); this.name = "ApiError"; }
}
/** Native tokens are host-owned secure storage. Web credentials are HttpOnly cookies. */
export interface SecureSessionStore {
  readonly serviceIdentity?: string;
  get(): Promise<string | null>; set(token: string): Promise<void>; clear(): Promise<void>;
  getRevocation?(): Promise<string | null>; retainRevocation?(token: string): Promise<void>; clearRevocation?(): Promise<void>;
}
export interface ApiClientOptions { baseUrl?: string; fetch?: typeof fetch; nativeSession?: SecureSessionStore }
const serviceCredentialTails = new Map<string, Promise<void>>();
export class ApiClient {
  private snapshot: AccessSnapshot | null = null;
  private authEpoch = 0;
  private denied = false;
  private readonly accessListeners = new Set<(failure: { path: string; error: ApiError }) => void>();
  private readonly fetcher: typeof fetch;
  private readonly baseUrl: string;
  private credentialChanging = false;
  private readonly issuedNativeTokens = new Map<string, string>();
  private credentialOperation<T>(operation: () => Promise<T>): Promise<T> {
    const host = globalThis as typeof globalThis & { location?: { href: string }; navigator?: { locks?: LockManager } };
    const service = this.options.nativeSession?.serviceIdentity ?? (this.baseUrl ? new URL(this.baseUrl).origin : host.location ? new URL(host.location.href).origin : "relative-service");
    const name = `cplayout:credentials:${this.options.nativeSession ? "native" : "web"}:${service}`;
    const previous = serviceCredentialTails.get(name) ?? Promise.resolve();
    const result = previous.then(async () => {
      const run = async () => { this.credentialChanging = true; try { return await operation(); } finally { this.credentialChanging = false; } };
      if (!this.options.nativeSession && host.location && host.navigator) {
        if (!host.navigator.locks) throw new Error("Secure account coordination is unavailable in this browser. Use workspace locking before signing in.");
        return host.navigator.locks.request(name, { mode: "exclusive" }, run);
      }
      return run();
    });
    const settled = result.then(() => undefined, () => undefined); serviceCredentialTails.set(name, settled);
    void settled.then(() => { if (serviceCredentialTails.get(name) === settled) serviceCredentialTails.delete(name); }); return result;
  }
  constructor(private readonly options: ApiClientOptions = {}) {
    // Browser fetch is a host method. Calling an unbound copy as an ApiClient
    // property gives it the wrong receiver and can fail before any HTTP request.
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    if (this.baseUrl && !/^https:\/\//i.test(this.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(this.baseUrl)) {
      throw new Error("Sign-in requires HTTPS or a local loopback service.");
    }
  }
  get access(): AccessSnapshot | null { return this.snapshot; }
  get accessDenied(): boolean { return this.denied; }
  subscribeAccessFailures(listener: (failure: { path: string; error: ApiError }) => void): () => void { this.accessListeners.add(listener); return () => { this.accessListeners.delete(listener); }; }
  async request<T>(path: string, options: { method?: string; body?: unknown; csrf?: boolean; revocation?: boolean; credential?: boolean; credentialToken?: string | null; isCurrent?: () => boolean } = {}): Promise<T> {
    if (!path.startsWith("/api/v1/")) throw new Error("Use a CPLayout API route.");
    if (this.credentialChanging && !options.credential) throw new ApiError(409, "account_action_pending", "Finish the current account action before opening or changing saved work.");
    const requestOwner = this.authEpoch;
    const requestPrincipal = this.snapshot?.principal.id;
    const token = options.credentialToken !== undefined ? options.credentialToken : options.revocation ? await this.options.nativeSession?.getRevocation?.() : await this.options.nativeSession?.get();
    if (requestOwner !== this.authEpoch) throw new ApiError(409, "retired_request", "This request belongs to an earlier account action. Your saved work is retained.");
    if (requestPrincipal !== this.snapshot?.principal.id || options.isCurrent && !options.isCurrent()) throw new ApiError(409, "retired_request", "The account or selected work changed before this request. Your entered work is retained.");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (requestPrincipal && path.startsWith("/api/v1/workspaces/")) headers["X-CPLayout-Principal"] = requestPrincipal;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.csrf !== false && options.method && !["GET", "HEAD"].includes(options.method) && this.snapshot) headers["X-CSRF-Token"] = this.snapshot.csrfToken;
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET", credentials: "include", headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new ApiError(response.status, "invalid_response", "The service returned an unreadable response. Your saved work is retained."); }
    if (requestOwner !== this.authEpoch || requestPrincipal !== this.snapshot?.principal.id)
      throw new ApiError(409, "retired_request", "This response belongs to an earlier account action. Your saved work is retained.");
    if (!response.ok) {
      const failure = payload as Partial<ApiFailure>;
      const error = new ApiError(response.status, typeof failure.code === "string" ? failure.code : "request_failed",
        typeof failure.message === "string" ? failure.message : "The request could not be completed. Your work is retained.");
      if (requestOwner === this.authEpoch && !path.includes("/session/login") && ([401, 403].includes(error.status) || error.code === "account_changed")) {
        if (error.status === 401 || error.code === "account_changed" || path.startsWith("/api/v1/workspaces/")) this.denied = true;
        for (const listener of this.accessListeners) listener({ path, error });
      }
      throw error;
    }
    if (this.options.nativeSession && token && path === "/api/v1/session") this.issuedNativeTokens.set(parseAccessSnapshot(payload).csrfToken, token);
    return payload as T;
  }
  login(username: string, password: string): Promise<AccessSnapshot> { return this.credentialOperation(async () => {
    try { return await this.performLogin(username, password); }
    catch (error) { if (!(error instanceof ApiError && error.code === "invalid_credentials")) this.denied = true; throw error; }
  }); }
  private async performLogin(username: string, password: string): Promise<AccessSnapshot> {
    const owner = ++this.authEpoch;
    const result = await this.request<SessionResponse>("/api/v1/session/login", { method: "POST", csrf: false, credential: true,
      body: { username, password, native: !!this.options.nativeSession } });
    const snapshot = parseAccessSnapshot(result);
    if (owner !== this.authEpoch) {
      // Retired authentication may not install authority. Revoke only the issued
      // session: its CSRF/token cannot revoke a different later sign-in.
      try {
        await this.fetcher(`${this.baseUrl}/api/v1/session/logout`, { method: "POST", credentials: "include", headers: result.nativeToken
          ? { Authorization: `Bearer ${result.nativeToken}` } : { "X-CSRF-Token": snapshot.csrfToken } });
      } catch { /* The retired server session still has its bounded expiry. */ }
      throw new ApiError(409, "retired_sign_in", "This sign-in was cancelled by a later account action.");
    }
    if (this.options.nativeSession) {
      if (!result.nativeToken) throw new Error("The service did not return a native session.");
      await this.options.nativeSession.set(result.nativeToken);
      this.issuedNativeTokens.set(snapshot.csrfToken, result.nativeToken);
    }
    this.snapshot = snapshot; this.denied = false; return snapshot;
  }
  async restore(): Promise<AccessSnapshot | null> {
    const owner = this.authEpoch;
    try { const result = parseAccessSnapshot(await this.request<AccessSnapshot>("/api/v1/session")); if (owner === this.authEpoch) { this.snapshot = result; this.denied = false; } return result; }
    catch (error) { if (error instanceof ApiError && error.status === 401) { if (owner === this.authEpoch) { this.snapshot = null; await this.options.nativeSession?.clear(); } return null; } throw error; }
  }
  logout(): Promise<void> { return this.credentialOperation(() => this.performLogout()); }
  private async performLogout(): Promise<void> {
    const owner = ++this.authEpoch;
    const token = this.snapshot && this.options.nativeSession ? this.issuedNativeTokens.get(this.snapshot.csrfToken) ?? await this.options.nativeSession.get() : await this.options.nativeSession?.get();
    try { await this.request("/api/v1/session/logout", { method: "POST", credential: true, credentialToken: token, body: { expectedPrincipalId: this.snapshot?.principal.id } }); await this.options.nativeSession?.clearRevocation?.(); }
    catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) { if (token) await this.options.nativeSession?.retainRevocation?.(token); throw error; }
    } finally { if (owner === this.authEpoch) { if (this.snapshot) this.issuedNativeTokens.delete(this.snapshot.csrfToken); this.snapshot = null; if (!this.options.nativeSession || await this.options.nativeSession.get() === token) await this.options.nativeSession?.clear(); } }
  }
  retryLogout(): Promise<void> { return this.credentialOperation(() => this.performRetryLogout()); }
  private async performRetryLogout(): Promise<void> {
    try {
      if (!this.options.nativeSession) this.snapshot = parseAccessSnapshot(await this.request<AccessSnapshot>("/api/v1/session", { credential: true }));
      await this.request("/api/v1/session/logout", { method: "POST", revocation: !!this.options.nativeSession, credential: true });
    }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
    finally { this.snapshot = null; }
    await this.options.nativeSession?.clearRevocation?.();
  }
  /** Reconciliation targets only the issued session. An older failed metadata
   * transition must never call an unrestricted logout of a newer account. */
  revokeIssuedSession(snapshot: AccessSnapshot): Promise<void> {
    return this.credentialOperation(async () => {
      const token = this.issuedNativeTokens.get(snapshot.csrfToken);
      try {
        const response = await this.fetcher(`${this.baseUrl}/api/v1/session/logout`, { method: "POST", credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : { "X-CSRF-Token": snapshot.csrfToken } });
        if (!response.ok && response.status !== 401) throw new ApiError(response.status, "session_reconciliation", "The preceding sign-in could not be closed. Its saved work stays retained.");
      } finally {
        this.issuedNativeTokens.delete(snapshot.csrfToken);
        if (this.snapshot?.csrfToken === snapshot.csrfToken) { this.authEpoch++; this.snapshot = null; if (!token || await this.options.nativeSession?.get() === token) await this.options.nativeSession?.clear(); }
      }
    });
  }
  workspace(id: string): Promise<RemoteWorkspace> { return this.request(`/api/v1/workspaces/${encodeURIComponent(id)}`); }
  command(id: string, input: CommandRequest, isCurrent?: () => boolean): Promise<CommandResponse> { return this.request(`/api/v1/workspaces/${encodeURIComponent(id)}/commands`, { method: "POST", body: { ...input, expectedPrincipalId: this.snapshot?.principal.id }, isCurrent }); }
  offlineGrant(id: string): Promise<OfflineGrantResponse> { return this.request(`/api/v1/workspaces/${encodeURIComponent(id)}/offline-grant`, { method: "POST" }); }
  async archiveState(id: string): Promise<WorkspaceArchiveState> { return parseWorkspaceArchiveState(await this.request(`/api/v1/workspaces/${encodeURIComponent(id)}/archive-state`), id); }
  archive(id: string, input: ArchiveRequest): Promise<{ revision: number; archived: boolean }> { return this.request(`/api/v1/workspaces/${encodeURIComponent(id)}/archive`, { method: "POST", body: input }); }
  async customers(id: string): Promise<{ customers: CustomerFolderMetadata[] }> { return parseCustomerMetadataList(await this.request(`/api/v1/workspaces/${encodeURIComponent(id)}/customers`)); }
  async catalogMetadata(id: string, expected?: { principalId: string; policyRevision: number }): Promise<CatalogMetadata> {
    const owner = this.authEpoch, precedingPrincipal = this.snapshot?.principal.id, membership = this.snapshot?.workspaces.find(item => item.workspaceId === id);
    const principalId = expected?.principalId ?? precedingPrincipal, policyRevision = expected?.policyRevision ?? membership?.policyRevision;
    if (!principalId || policyRevision === undefined) throw new ApiError(401, "sign_in_required", "Renew access before opening customer folders.");
    if (precedingPrincipal !== undefined && (precedingPrincipal !== principalId || membership?.policyRevision !== policyRevision))
      throw new ApiError(409, "retired_request", "This customer-folder read belongs to an earlier account. Its saved work is retained.");
    const path = `/api/v1/workspaces/${encodeURIComponent(id)}/catalog-metadata`, metadata = parseCatalogMetadata(await this.request(path), id);
    if (owner !== this.authEpoch || precedingPrincipal !== this.snapshot?.principal.id) throw new ApiError(409, "retired_request", "This customer-folder read belongs to an earlier account. Its saved work is retained.");
    if (metadata.principalId !== principalId || metadata.policyRevision !== policyRevision) {
      const error = new ApiError(409, "account_changed", "Workspace access changed. Renew access before opening customer folders; saved work is retained.");
      this.denied = true; for (const listener of this.accessListeners) listener({ path, error }); throw error;
    }
    return metadata;
  }
  async projects(id: string, customerId?: string): Promise<{ projects: ProjectMetadata[] }> { return parseProjectMetadataList(await this.request(`/api/v1/workspaces/${encodeURIComponent(id)}/projects${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ""}`)); }
}
