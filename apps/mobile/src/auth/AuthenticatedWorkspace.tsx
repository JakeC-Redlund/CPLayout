import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth, type AuthSession, type WorkspaceLaunchIntent } from "./AuthProvider";
import { workspaceAccessOwner } from "./accessOwnership";
import type { CatalogMetadata } from "@cplayout/auth-client";

function Action({ label, visibleLabel, onPress, disabled = false, testID }: { label: string; visibleLabel?: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} testID={testID} onPress={onPress} style={[styles.action, disabled && { opacity: .45 }]}><Text style={styles.actionText}>{visibleLabel ?? label}</Text></Pressable>;
}
export function LoginScreen() {
  const auth = useAuth(), [username, setUsername] = useState(""), [password, setPassword] = useState(""), [busy, setBusy] = useState(false), passwordInput = useRef<TextInput>(null);
  async function submit() { if (busy || !username.trim() || !password) return; setBusy(true); try { await auth.signIn(username, password); } finally { setPassword(""); setBusy(false); } }
  return <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.loginContainer} keyboardShouldPersistTaps="handled"><View style={styles.card} testID="auth-login"><Text style={styles.brand}>CPLayout</Text><Text style={styles.title}>Sign in to your field projects</Text>
    <Text style={styles.copy}>Design, survey and lay out your irrigation projects in one workspace.</Text>
    <Text style={styles.label}>Username</Text><TextInput autoCapitalize="none" autoCorrect={false} textContentType="username" autoComplete="username" value={username} editable={!busy} style={styles.input} accessibilityLabel="Username" testID="auth-username" onChangeText={setUsername} returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} />
    <Text style={styles.label}>Password</Text><TextInput ref={passwordInput} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="password" autoComplete="current-password" value={password} editable={!busy} style={styles.input} accessibilityLabel="Password" testID="auth-password" onChangeText={setPassword} returnKeyType="go" onSubmitEditing={() => { void submit(); }} />
    {auth.message && <Text accessibilityRole="alert" style={styles.error}>{auth.message}</Text>}
    <Action label={busy ? "Signing in…" : "Sign in"} disabled={busy || !username.trim() || !password} testID="auth-submit" onPress={() => { void submit(); }} />
    <Text style={styles.copy}>Contact your workspace administrator if you need an account or help signing in.</Text>
  </View></ScrollView>;
}
export function ProjectHome() {
  const auth = useAuth();
  const owner = workspaceAccessOwner(auth.access, auth.workspaceId), currentOwner = useRef(owner); currentOwner.current = owner;
  const [result, setResult] = useState<{ owner: string; metadata: CatalogMetadata | null; error: string | null; loading: boolean } | null>(null);
  const [selection, setSelection] = useState<{ owner: string; customerId: string | null }>({ owner, customerId: null });
  const [archiveChoice, setArchiveChoice] = useState<{ owner: string; shown: boolean }>({ owner, shown: false });
  const businessRole = auth.principal?.roles.some(role => role === "operator" || role === "admin") ?? false;
  const workspace = businessRole ? auth.access?.workspaces.find(item => item.workspaceId === auth.workspaceId && item.permissions.includes("field:read")) : undefined;
  const canManage = workspace?.permissions.includes("catalog:write") ?? false;
  useEffect(() => {
    let current = true; setResult(null); if (!auth.workspaceId || !workspace || auth.authorityBlocked || !auth.homeVisible || auth.reauthRequired) return;
    setResult({ owner, metadata: null, error: null, loading: true });
    void auth.api.catalogMetadata(auth.workspaceId, { principalId: auth.principal!.id, policyRevision: workspace.policyRevision }).then(next => { if (current && currentOwner.current === owner) setResult({ owner, metadata: next, error: null, loading: false }); })
      .catch(reason => { if (current && currentOwner.current === owner) setResult({ owner, metadata: null, error: reason instanceof TypeError ? "Connect to load your customer folders. Retained field work remains available." : reason instanceof Error ? reason.message : "Customer folders could not be loaded.", loading: false }); });
    return () => { current = false; };
  }, [auth.api, owner, !!workspace, auth.authorityBlocked, auth.homeVisible, auth.reauthRequired]);
  const owned = result?.owner === owner ? result : null, metadata = owned?.metadata ?? null, loading = owned?.loading ?? !!workspace, error = owned?.error ?? null;
  const showArchived = archiveChoice.owner === owner && archiveChoice.shown;
  const customers = metadata?.customers.filter(customer => showArchived || !customer.archived) ?? [];
  const customer = selection.owner === owner ? customers.find(item => item.id === selection.customerId) : undefined;
  const retainedProjects = customer ? metadata!.projects.filter(project => project.clientId === customer.id) : [];
  const projects = retainedProjects.filter(project => showArchived || !project.archived);
  const launch = (intent: WorkspaceLaunchIntent) => { if (currentOwner.current === owner && workspace && !auth.authorityBlocked) auth.launch(intent); };
  const chooseCustomer = (id: string | null) => { if (currentOwner.current === owner && workspace && !auth.authorityBlocked && (id === null || customers.some(item => item.id === id))) setSelection({ owner, customerId: id }); };
  return <ScrollView contentContainerStyle={styles.home} testID="auth-project-home"><View style={styles.homeHeader}><Text style={styles.brand}>CPLayout</Text><Text style={styles.copy}>{auth.principal?.displayName}</Text><Action label="Sign out" onPress={() => { void auth.signOut(); }} /></View>
    <Text style={styles.title}>{customer ? customer.displayName : "Your customers"}</Text>
    {auth.access && auth.access.workspaces.length > 1 && <View style={styles.actions}>{auth.access.workspaces.map(item => <Action key={item.workspaceId} label={item.workspaceName} onPress={() => auth.selectWorkspace(item.workspaceId)} />)}</View>}
    {!workspace ? <Text style={styles.copy}>Your account has no field workspace access. Contact your administrator.</Text> : <>
      <Text style={styles.copy}>{workspace.workspaceName}</Text><View style={styles.actions}><Action label="Continue field work" testID="home-continue" disabled={auth.authorityBlocked} onPress={() => launch({ kind: "continue" })} /><Action label="Customer catalog" testID="home-customers" disabled={auth.authorityBlocked} onPress={() => launch({ kind: "customers" })} />
        <Action label="New customer" testID="home-new-customer" disabled={!canManage || auth.authorityBlocked} onPress={() => launch({ kind: "new-customer" })} /></View>
      {loading && <ActivityIndicator accessibilityLabel="Loading customers" />}{error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {!loading && metadata && <Action label={showArchived ? "Hide archived records" : "Show archived records"} testID="home-show-archived" disabled={auth.authorityBlocked} onPress={() => {
        if (currentOwner.current !== owner || !workspace || auth.authorityBlocked) return;
        if (showArchived && customer?.archived) setSelection({ owner, customerId: null });
        setArchiveChoice({ owner, shown: !showArchived });
      }} />}
      {!loading && metadata && !customer && <View style={{ gap: 18 }} testID="home-customer-list">
        {!customers.length && <Text style={styles.copy}>No active customers are saved in this workspace.</Text>}
        {customers.map(item => <View key={item.id} style={styles.project} testID={`home-customer-folder-${item.id}`}><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.projectName}>{item.displayName}{item.archived ? " · Archived" : ""}</Text><Text style={styles.copy}>{metadata.projects.filter(project => project.clientId === item.id && !project.archived).length} active projects</Text></View>
          <Action label={`Open ${item.displayName}`} visibleLabel="Open" testID={`home-customer-${item.id}`} disabled={auth.authorityBlocked} onPress={() => chooseCustomer(item.id)} /></View>)}
      </View>}
      {!loading && customer && <View style={{ gap: 18 }} testID={`home-selected-customer-${customer.id}`}>
        <View style={styles.actions}><Action label="All customers" testID="home-all-customers" disabled={auth.authorityBlocked} onPress={() => chooseCustomer(null)} />
          <Action label={`New project for ${customer.displayName}`} visibleLabel="New project" testID="home-new-project" disabled={!canManage || customer.archived || auth.authorityBlocked} onPress={() => launch({ kind: "new-project", customerId: customer.id })} />
          <Action label={`Customer details for ${customer.displayName}`} visibleLabel="Customer details" testID="home-manage-customer" disabled={auth.authorityBlocked} onPress={() => launch({ kind: "customer", customerId: customer.id })} /></View>
        <Text style={styles.projectName}>Projects</Text>
        {!projects.length && <Text style={styles.copy} testID="home-no-projects">{retainedProjects.length ? "No active projects. Archived projects remain in this customer's records." : "No projects are saved for this customer."}</Text>}
        {projects.map(project => <View key={project.id} style={styles.project} testID={`home-project-${project.id}`}><View style={{ flex: 1, minWidth: 0 }}><Text style={styles.projectName}>{project.name}{project.archived ? " · Archived" : ""}</Text><Text style={styles.copy}>{project.customerDisplayName}</Text></View><Action label={`Open ${project.name} for ${project.customerDisplayName}`} visibleLabel="Open" disabled={auth.authorityBlocked} testID={`home-open-${project.id}`} onPress={() => launch({ kind: "project", projectId: project.id, customerId: customer.id })} /></View>)}
      </View>}
    </>}
  </ScrollView>;
}
/** The children mount only after actual server authentication or verified signed
 * cached field authorization. This wrapper never creates a fake local account. */
export function AuthenticatedWorkspace({ children }: { children: (session: AuthSession) => React.ReactNode }) {
  const auth = useAuth();
  if (auth.status === "checking" && !auth.principal) return <View style={styles.background} testID="auth-startup"><Text style={styles.brand}>CPLayout</Text><ActivityIndicator accessibilityLabel="Opening your workspace" /><Text style={styles.copy}>Opening your workspace…</Text><Text style={styles.version}>Version 0.1.0</Text></View>;
  if (!auth.principal) return <LoginScreen />;
  return <View style={{ flex: 1, minHeight: 0 }}>
    <View style={{ flex: 1, minHeight: 0, display: auth.homeVisible || auth.reauthRequired ? "none" : "flex" }} testID="authenticated-working-workspace">{children(auth)}</View>
    <View style={{ flex: 1, minHeight: 0, display: auth.homeVisible && !auth.reauthRequired ? "flex" : "none" }} testID="authenticated-project-home"><ProjectHome /></View>
    {auth.reauthRequired && <LoginScreen />}
  </View>;
}
const styles = StyleSheet.create({
  loginContainer: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#edf3ec", gap: 20 },
  background: { flex: 1, minHeight: 0, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#edf3ec", gap: 20 },
  card: { width: "100%", maxWidth: 430, backgroundColor: "#fff", borderRadius: 12, padding: 26, gap: 12 }, brand: { fontSize: 30, fontWeight: "700", color: "#28513a" },
  title: { fontSize: 23, fontWeight: "600", color: "#213c2c" }, copy: { fontSize: 14, lineHeight: 21, color: "#4d6054" }, label: { fontSize: 14, fontWeight: "600", color: "#213c2c" },
  input: { backgroundColor: "#fafcf9", borderWidth: 1, borderColor: "#a3b6a7", padding: 12, borderRadius: 6, fontSize: 16 },
  action: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#28513a", borderRadius: 6, alignItems: "center" }, actionText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  error: { color: "#9a3228", fontSize: 14, lineHeight: 20 }, version: { fontSize: 12, color: "#65746b" },
  home: { flexGrow: 1, padding: 24, gap: 18, backgroundColor: "#edf3ec" }, homeHeader: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, project: { padding: 18, backgroundColor: "#fff", borderRadius: 8, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }, projectName: { fontSize: 17, fontWeight: "600", color: "#213c2c" },
});
