import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type { AuthSession } from "../auth/AuthProvider";
import { createAuthenticatedRepository } from "../auth/authenticatedRepository";
import { CustomerMaintenancePanel } from "./CustomerMaintenancePanel";
import type { WorkspaceArchiveState } from "@cplayout/auth-client";
import { UnifiedWorkspaceEntry } from "./UnifiedWorkspaceEntry";
import { WorkspaceRepositoryProvider } from "./WorkspaceRepositoryContext";

export function AuthenticatedWorkspaceBridge({ session }: { session: AuthSession }) {
  const repository = useMemo(() => createAuthenticatedRepository(session), [session.api, session.principal?.id, session.workspaceId]);
  const [archives, setArchives] = useState<WorkspaceArchiveState | null>(null);
  const [repositoryStatus, setRepositoryStatus] = useState(() => repository.status());
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const storage = useMemo(() => Platform.OS === "web" ? {
    getItem(key: string) { return globalThis.localStorage.getItem(`${repository.storagePartition}:${key}`); },
    setItem(key: string, value: string) { globalThis.localStorage.setItem(`${repository.storagePartition}:${key}`, value); },
  } : null, [repository]);
  const membership = session.access?.workspaces.find(item => item.workspaceId === session.workspaceId);
  useEffect(() => repository.subscribeStatus(setRepositoryStatus), [repository]);
  useEffect(() => {
    let current = true;
    setArchives(null);
    const unsubscribe = repository.subscribeArchiveState(snapshot => { if (current) setArchives(snapshot); });
    void repository.ready().then(async () => {
      const snapshot = await repository.archiveState();
      if (current) setArchives(snapshot);
    }).catch(error => { if (current) setMessage(error instanceof Error ? error.message : "Your workspace could not be opened."); });
    return () => { current = false; unsubscribe(); };
  }, [repository, session.status, session.authorityBlocked, membership?.policyRevision]);
  async function action(run: () => Promise<void>) {
    if (busy) return; setBusy(true); setMessage(null);
    try { await run(); setMessage(repository.status().message ?? "Your workspace is up to date."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Your work is retained. Reconnect and try again."); }
    finally { setBusy(false); }
  }
  const button = (label: string, run: () => void) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={run}
    style={{ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "#a3b6a7", borderRadius: 5 }}><Text style={{ color: "#28513a" }}>{label}</Text></Pressable>;
  return <WorkspaceRepositoryProvider value={{ repository, actorId: session.principal!.id, storage, partition: repository.storagePartition,
    visible: !session.homeVisible && !session.reauthRequired, authorityBlocked: session.authorityBlocked, archives,
    get fieldMutationsAvailable() { return repository.canSaveManualField; },
    get fieldMutationsUnavailableReason() { return repository.canSaveManualField ? null : "Connect to save field changes on this device."; },
    liveCaptureAvailable: repository.canCaptureLive, offlineFieldMutationsAvailable: repository.canRetainOfflineField,
    roles: session.principal?.roles, permissions: session.authorityBlocked ? [] : session.access?.workspaces.find(item => item.workspaceId === session.workspaceId)?.permissions,
    maintenance: options => <CustomerMaintenancePanel api={session.api} principal={session.principal!} workspaceId={session.workspaceId!}
      showArchived={options.showArchived} onShowArchivedChange={options.onShowArchivedChange}
      permissions={session.authorityBlocked ? [] : session.access?.workspaces.find(item => item.workspaceId === session.workspaceId)?.permissions ?? []}
      online={session.status === "signedIn" && !session.authorityBlocked} visible={options.visible} sourceGeneration={options.sourceGeneration}
      selectedCustomerId={options.selectedCustomerId} selectedProjectId={options.selectedProjectId}
      beforeAction={async () => { if (!await options.prepareBoundary()) return false; await repository.sync(); return true; }}
      onAcknowledged={receipt => repository.acknowledgeArchive(receipt)}
      onArchiveStateChanged={setArchives} onCommitted={async () => { await repository.refresh(); setArchives(await repository.archiveState()); await options.onRefresh(); }} />, launchIntent: session.launchIntent, registerBoundaryGuard: session.registerBoundaryGuard }}>
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, padding: 6, backgroundColor: "#edf3ec" }}>
        {button("Home", session.showHome)}
        {!session.authorityBlocked && membership?.permissions.includes("field:write") && button("Prepare offline work", () => { void action(async () => { await repository.archiveState(); await repository.prepareOffline(); }); })}
        {button("Sync", () => { void action(() => repository.sync()); })}
        {button("Sign out", () => { void session.signOut(); })}
        <Text>{repositoryStatus.connection === "offline" ? "Offline saved work" : session.principal?.displayName}</Text>
      </View>
      {message && <Text accessibilityLiveRegion="polite" style={{ padding: 8, color: "#6e3d28" }}>{message}</Text>}
      {repositoryStatus.pending > 0 && <Text accessibilityLiveRegion="polite" style={{ padding: 8, color: "#28513a" }}>Saved on this device. Use Sync to update the shared workspace.</Text>}
      {repositoryStatus.rejected > 0 && <Text accessibilityRole="alert" style={{ padding: 8, color: "#6e3d28" }}>Your saved field work needs review before the shared workspace can be updated.</Text>}
      {repository.fieldRecoveryReason && <Text accessibilityLiveRegion="polite" style={{ padding: 8, color: "#6e3d28" }}>{repository.fieldRecoveryReason}</Text>}
      <UnifiedWorkspaceEntry />
    </View>
  </WorkspaceRepositoryProvider>;
}
