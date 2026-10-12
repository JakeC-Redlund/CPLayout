import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { ApiClient, ApiError, FieldWorkCache, readPublicServiceConfig, resolveServiceConnection, advanceOfflineClock, verifyOfflineGrant, type AccessSnapshot, type Principal, type SecureSessionStore } from "@cplayout/auth-client";
import { createAuthStorage, createNativeSessionStore, type AtomicAuthStorage } from "./authStorage";
import { AccountNavigationBoundary } from "./navigationBoundary";
import { ACCOUNT_TRANSITION_KEY, AccountTransitionError, signInWithDurableTransition } from "./authTransition";
import { AccountDenialQueue, deniedAccountKey, retainAccountDenial } from "./deniedAccess";
import { workspaceAccessMustPreserve } from "./accessOwnership";

export type WorkspaceLaunchIntent = { kind: "continue" | "customers" | "new-customer" }
  | { kind: "customer"; customerId: string }
  | { kind: "new-project"; customerId?: string }
  | { kind: "project"; projectId: string; customerId?: string };
export interface AuthSession {
  api: ApiClient; access: AccessSnapshot | null; principal: Principal | null; workspaceId: string | null;
  storage: AtomicAuthStorage; trustedVerificationKey: string | null; processId: string;
  status: "checking" | "signedOut" | "signedIn" | "offline" | "error" | "accessDenied"; message: string | null;
  authorityBlocked: boolean; reauthRequired: boolean;
  homeVisible: boolean; launchIntent: WorkspaceLaunchIntent | null;
  signIn(username: string, password: string): Promise<boolean>; signOut(): Promise<void>; retry(): Promise<void>;
  selectWorkspace(id: string): Promise<void>; launch(intent: WorkspaceLaunchIntent): void; showHome(): void;
  registerBoundaryGuard(guard: () => Promise<boolean>): () => void;
}
const AuthContext = createContext<AuthSession | null>(null);
export interface AuthProviderProps { children: React.ReactNode; baseUrl?: string; trustedVerificationKey?: string; api?: ApiClient; storage?: AtomicAuthStorage; nativeSession?: SecureSessionStore }
type AccountHint = { subject: string; username: string; displayName: string; workspaceId: string; workspaceName: string };
const ACCOUNT_HINT = "cplayout.account-hint-v1";
export function AuthProvider({ children, baseUrl, trustedVerificationKey, api: suppliedApi, storage: suppliedStorage, nativeSession }: AuthProviderProps) {
  const publicConfig = useMemo(() => readPublicServiceConfig(), []);
  const service = resolveServiceConnection({ apiUrl: baseUrl, offlinePublicKey: trustedVerificationKey }, publicConfig,
    { apiUrl: process.env.EXPO_PUBLIC_CPLAYOUT_API_URL, offlinePublicKey: process.env.EXPO_PUBLIC_CPLAYOUT_OFFLINE_PUBLIC_KEY });
  const storage = useMemo(() => suppliedStorage ?? createAuthStorage(), [suppliedStorage]);
  const api = useMemo(() => suppliedApi ?? new ApiClient({ baseUrl: service.apiUrl,
    nativeSession: Platform.OS === "web" ? undefined : nativeSession ?? createNativeSessionStore(service.apiUrl || "cplayout") }), [suppliedApi, service.apiUrl, nativeSession]);
  const pinnedKey = service.offlinePublicKey;
  const processId = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2)}`).current;
  const [access, setAccess] = useState<AccessSnapshot | null>(null), [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthSession["status"]>("checking"), [message, setMessage] = useState<string | null>(null);
  const [authorityBlocked, setAuthorityBlocked] = useState(false), [reauthRequired, setReauthRequired] = useState(false);
  const [homeVisible, setHomeVisible] = useState(true), [launchIntent, setLaunchIntent] = useState<WorkspaceLaunchIntent | null>(null);
  const mounted = useRef(true), epoch = useRef(0);
  const sourceIdentity = useRef<string>(""); sourceIdentity.current = JSON.stringify([access?.principal.id, workspaceId]);
  const boundaryOwner = useMemo(() => new AccountNavigationBoundary(() => sourceIdentity.current), []);
  const denialQueue = useMemo(() => new AccountDenialQueue(), []);
  const latest = useRef({ access, workspaceId, homeVisible, status, authorityBlocked, reauthRequired }); latest.current = { access, workspaceId, homeVisible, status, authorityBlocked, reauthRequired };
  useEffect(() => api.subscribeAccessFailures(({ path, error }) => {
    const actual = latest.current;
    if (path.includes("/session/logout")) return;
    const scoped = actual.workspaceId && path.startsWith(`/api/v1/workspaces/${encodeURIComponent(actual.workspaceId)}`);
    const requiresSignIn = error.status === 401 || error.code === "account_changed";
    if (requiresSignIn || scoped && error.status === 403) {
      if (actual.access) {
        setAuthorityBlocked(true); setStatus("accessDenied");
        setMessage(requiresSignIn ? "Preserving unfinished work before renewing access…" : "Your workspace access changed. Check access before continuing; saved work is retained.");
      }
      const disposition = denialQueue.enqueue(JSON.stringify([actual.access?.principal.id ?? "known-account-hint", actual.workspaceId, requiresSignIn]), async () => {
        const hintRaw = actual.access ? null : await storage.read(ACCOUNT_HINT);
        const hint = hintRaw ? JSON.parse(hintRaw) as Partial<AccountHint> : null;
        const subject = actual.access?.principal.id ?? hint?.subject, workspace = actual.workspaceId ?? hint?.workspaceId;
        if (typeof subject !== "string" || !subject) return;
        await retainAccountDenial(storage, subject, typeof workspace === "string" ? workspace : null, pinnedKey ?? undefined);
        if (actual.access && requiresSignIn) {
          if (!mounted.current || latest.current.access?.principal.id !== subject) return;
          const preserved = await boundaryOwner.preserve();
          if (mounted.current && latest.current.access?.principal.id === subject) {
            setReauthRequired(preserved === "preserved");
            setMessage(preserved === "preserved" ? "Sign in again to renew access. Your unfinished work is retained."
              : "Unfinished work still needs preservation. Keep this workspace open and export its recovery copy before renewing access.");
          }
        }
      });
      void disposition.catch(() => { /* In-memory denial remains active; retained evidence is not removed. */ });
    }
  }), [api, storage, pinnedKey, boundaryOwner, denialQueue]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  async function retainHint(snapshot: AccessSnapshot, selected: string | null) {
    const workspace = snapshot.workspaces.find(item => item.workspaceId === selected);
    if (workspace) await storage.write(ACCOUNT_HINT, JSON.stringify({ subject: snapshot.principal.id, username: snapshot.principal.username, displayName: snapshot.principal.displayName,
      workspaceId: workspace.workspaceId, workspaceName: workspace.workspaceName } satisfies AccountHint));
  }
  const restore = useCallback(async () => {
    const owner = ++epoch.current; setStatus("checking"); setMessage(null);
    try {
      await denialQueue.whenIdle();
      // An offline logout keeps a revocation retry, never live local permissions.
      const logout = await storage.read("cplayout.pending-logout-v1");
      if (logout) { await api.retryLogout(); await storage.write("cplayout.pending-logout-v1", ""); }
      const snapshot = await api.restore(); if (!mounted.current || owner !== epoch.current) return;
      if (!snapshot && latest.current.access) {
        setAuthorityBlocked(true); setStatus("accessDenied"); await denialQueue.whenIdle();
        const preserved = await preserveBoundary(); setReauthRequired(preserved);
        if (preserved) setMessage("Sign in again to renew access. Your unfinished work is retained."); return;
      }
      const preceding = latest.current, selected = snapshot?.workspaces.some(item => item.workspaceId === preceding.workspaceId) ? preceding.workspaceId : snapshot?.workspaces[0]?.workspaceId ?? null;
      if (workspaceAccessMustPreserve(preceding.access, preceding.workspaceId, snapshot, selected)) {
        setAuthorityBlocked(true);
        if (!await preserveBoundary()) { setStatus("accessDenied"); return; }
      }
      if (!mounted.current || owner !== epoch.current) return;
      setAccess(snapshot); setWorkspaceId(selected);
      if (snapshot) await storage.write(deniedAccountKey(snapshot.principal.id), "");
      setAuthorityBlocked(false); setReauthRequired(false); setStatus(snapshot ? "signedIn" : "signedOut"); setHomeVisible(true); if (snapshot) await retainHint(snapshot, selected);
    } catch (error) {
      if (!mounted.current || owner !== epoch.current) return;
      // A service-declared session denial must never be reinterpreted as offline authorization.
      if (error instanceof ApiError) { if (latest.current.access) { setAuthorityBlocked(true); setStatus("accessDenied"); await denialQueue.whenIdle(); if (error.status === 401) setReauthRequired(await preserveBoundary()); } else { setAccess(null); setStatus(error.status === 401 ? "signedOut" : "error"); } setMessage(error.message); return; }
      try {
        if (await storage.read("cplayout.pending-logout-v1")) throw new Error("Sign in online to finish signing out of the preceding session.");
        if (await storage.read(ACCOUNT_TRANSITION_KEY)) throw new Error("Finish the pending account transition online before opening retained field work.");
        if (api.accessDenied || latest.current.authorityBlocked) throw new Error("Connect and renew this account's access before opening its retained field work.");
        if (!pinnedKey) throw new Error("Connect to sign in. Offline access needs the workspace's trusted signing key.");
        const text = await storage.read(ACCOUNT_HINT); if (!text) throw new Error("Connect to sign in before opening cached field work.");
        const hint = JSON.parse(text) as AccountHint, cache = new FieldWorkCache(storage, hint.subject, hint.workspaceId, pinnedKey), work = await cache.read();
        if (await storage.read(deniedAccountKey(hint.subject))) throw new Error("Connect and renew this account's access before opening its retained field work.");
        if (!work?.authorization || work.authorization.verificationKey !== pinnedKey) throw new Error("Prepare this workspace online before using it offline.");
        const clock = advanceOfflineClock(work.authorization.clock, { now: Date.now, monotonic: () => performance.now() }, processId);
        const grant = verifyOfflineGrant(work.authorization.grant, pinnedKey, { subject: hint.subject, workspaceId: hint.workspaceId }, clock.lastWallTime);
        await cache.retain({ ...work, authorization: { ...work.authorization, clock } });
        if (!mounted.current || owner !== epoch.current) return;
        // Account hints select a partition only. Signed identity, roles and permissions
        // authorize offline work; an unsigned cached AccessSnapshot never does.
        const snapshot: AccessSnapshot = { principal: grant.principal,
          workspaces: [{ workspaceId: grant.workspaceId, workspaceName: grant.workspaceName, permissions: grant.permissions, policyRevision: grant.policyRevision }], csrfToken: "", serverTime: grant.issuedAt };
        setAccess(snapshot); setWorkspaceId(grant.workspaceId); setStatus("offline"); setHomeVisible(false);
        setMessage(storage.writeCurrent ? "Working offline. Field changes stay on this device until synchronized." : "Offline project viewing is available. Reconnect to save changes.");
      } catch (offlineError) { setAccess(null); setStatus("signedOut"); setMessage(offlineError instanceof Error ? offlineError.message : "Connect to sign in."); }
    }
  }, [api, storage, pinnedKey, processId, denialQueue]);
  useEffect(() => { void restore(); }, [restore]);
  async function signIn(username: string, password: string) {
    const preceding = latest.current;
    if (preceding.access && !await preserveBoundary()) return false;
    await denialQueue.whenIdle();
    const owner = ++epoch.current; setMessage(null);
    try {
      if (await storage.read("cplayout.pending-logout-v1")) {
        await api.retryLogout(); await storage.write("cplayout.pending-logout-v1", "");
      }
      const snapshot = await signInWithDurableTransition(api, storage, username, password, async next => {
        const selected = next.workspaces.some(item => item.workspaceId === preceding.workspaceId) ? preceding.workspaceId : next.workspaces[0]?.workspaceId ?? null;
        await retainHint(next, selected); await storage.write(deniedAccountKey(next.principal.id), "");
      });
      if (!mounted.current || owner !== epoch.current) return false;
      const selected = snapshot.workspaces.some(item => item.workspaceId === preceding.workspaceId) ? preceding.workspaceId : snapshot.workspaces[0]?.workspaceId ?? null;
      setAccess(snapshot); setWorkspaceId(selected); setAuthorityBlocked(false); setReauthRequired(false);
      setHomeVisible(preceding.access?.principal.id === snapshot.principal.id ? preceding.homeVisible : true); setLaunchIntent(null); setStatus("signedIn"); return true;
    } catch (error) { if (mounted.current && owner === epoch.current) {
      if (error instanceof AccountTransitionError && error.kind === "uncertain") { setAuthorityBlocked(true); setReauthRequired(!!preceding.access); setStatus(preceding.access ? "accessDenied" : "signedOut"); }
      else setStatus(preceding.access ? preceding.status : "signedOut");
      setMessage(error instanceof Error ? error.message : "Sign-in could not complete.");
    } return false; }
  }
  async function preserveBoundary(): Promise<boolean> {
    const result = await boundaryOwner.preserve();
    if (result === "preserved") return true;
    setMessage(result === "preservation_pending" ? "Your unfinished work still needs to be saved for recovery. Keep this workspace open and try again."
      : result === "source_changed" ? "The workspace changed while preserving its work. Try the account action again."
        : "Unfinished work could not be preserved. Export its recovery copy before leaving this workspace."); return false;
  }
  async function signOut() {
    if (!await preserveBoundary()) return;
    try { await storage.write("cplayout.pending-logout-v1", "pending"); await storage.write(ACCOUNT_HINT, ""); }
    catch { setMessage("Sign-out could not be prepared on this device. Keep the workspace open and export its recovery copy."); return; }
    epoch.current++; setAccess(null); setWorkspaceId(null); setAuthorityBlocked(false); setReauthRequired(false); setStatus("signedOut"); setHomeVisible(true); setLaunchIntent(null);
    try { await api.logout(); await storage.write("cplayout.pending-logout-v1", ""); setMessage(null); }
    catch { setMessage("Signed out on this device. The service session will be closed when you reconnect."); }
  }
  const registerBoundaryGuard = useCallback((guard: () => Promise<boolean>) => boundaryOwner.register(guard), [boundaryOwner]);
  async function selectWorkspace(id: string) {
    if (authorityBlocked) { setMessage("Renew this account's access before switching workspaces. Its retained field work stays saved."); return; }
    if (!access?.workspaces.some(item => item.workspaceId === id)) return;
    if (id === workspaceId || !await preserveBoundary()) return;
    setWorkspaceId(id); setHomeVisible(true); setLaunchIntent(null); void retainHint(access, id);
  }
  const value: AuthSession = { api, access, principal: access?.principal ?? null, workspaceId, storage, trustedVerificationKey: pinnedKey, processId, status, message, homeVisible, launchIntent, authorityBlocked, reauthRequired,
    signIn, signOut, retry: restore, selectWorkspace, registerBoundaryGuard,
    launch: intent => { setLaunchIntent(intent); setHomeVisible(false); }, showHome: () => { setHomeVisible(true); setLaunchIntent(null); } };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthSession { const value = useContext(AuthContext); if (!value) throw new Error("Wrap the workspace in AuthProvider."); return value; }
