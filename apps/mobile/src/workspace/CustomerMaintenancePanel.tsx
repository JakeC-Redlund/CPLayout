import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ApiClient, ArchiveRequest, ArchiveAcknowledgment, Principal, WorkspaceArchiveState, WorkspacePermission } from "@cplayout/auth-client";

export interface MaintenanceChoice { kind: "customer" | "project"; entityId: string; archived: boolean }
export interface MaintenanceReview extends MaintenanceChoice { label: string; expectedRevision: number; workspaceId: string }
export function visibleMaintenanceRecords(state: WorkspaceArchiveState, showArchived: boolean, customerId?: string | null) {
  return { customers: state.customers.filter(customer => (!customerId || customer.id === customerId) && (showArchived || !customer.archived)),
    projects: state.projects.filter(project => (!customerId || project.clientId === customerId) && (showArchived || !project.archived)) };
}
export function reviewMaintenanceChoice(state: WorkspaceArchiveState, choice: MaintenanceChoice): MaintenanceReview {
  const entity = choice.kind === "customer" ? state.customers.find(item => item.id === choice.entityId) : state.projects.find(item => item.id === choice.entityId);
  if (!entity) throw new Error("The customer or project is no longer available. Refresh the saved list.");
  if (choice.kind === "project") {
    const project = entity as WorkspaceArchiveState["projects"][number], customer = state.customers.find(item => item.id === project.clientId);
    if (!customer) throw new Error("The project's customer is unavailable. Refresh the saved list.");
    if (customer.archived) throw new Error("Restore this project's customer before changing the project archive.");
    if (project.individuallyArchived === choice.archived) throw new Error("This project's archive state already changed. Review its current saved list.");
  } else if (entity.archived === choice.archived) throw new Error("This customer's archive state already changed. Review its current saved list.");
  return { ...choice, label: "displayName" in entity ? entity.displayName : entity.name, expectedRevision: state.revision, workspaceId: state.workspaceId };
}
export async function commitMaintenanceReview(api: Pick<ApiClient, "archiveState" | "archive">, review: MaintenanceReview, isCurrent: () => boolean,
  onCommitted?: (state: WorkspaceArchiveState) => Promise<void>, onAcknowledged?: (receipt: ArchiveAcknowledgment) => Promise<void>): Promise<WorkspaceArchiveState> {
  if (!isCurrent()) throw new Error("The selected customer or project changed. Review its current archive state.");
  const fresh = await api.archiveState(review.workspaceId);
  if (!isCurrent() || fresh.revision !== review.expectedRevision) throw new Error("Saved work changed before confirmation. Your records are retained; review the current list.");
  const current = reviewMaintenanceChoice(fresh, review);
  if (current.label !== review.label) throw new Error("The customer or project name changed. Review its current saved name.");
  const command: ArchiveRequest = { kind: review.kind, entityId: review.entityId, archived: review.archived, expectedRevision: review.expectedRevision };
  const response = await api.archive(review.workspaceId, command);
  if (!Number.isSafeInteger(response.revision) || response.revision !== review.expectedRevision + 1 || response.archived !== review.archived) throw new Error("The archive response could not be verified. Connect to review current saved status.");
  const receipt: ArchiveAcknowledgment = { workspaceId: review.workspaceId, revision: response.revision, kind: review.kind, entityId: review.entityId, archived: response.archived };
  try { await onAcknowledged?.(receipt); }
  catch { throw new Error("The service saved this archive action. Its current status still needs verification on this device; field work is retained."); }
  // A server-committed archive cannot be undone by a retired UI callback. The
  // caller publishes only the subsequent owned fresh sidecar read.
  let committed: WorkspaceArchiveState;
  try { committed = await api.archiveState(review.workspaceId); }
  catch { throw new Error("The service saved this archive action. Connect to verify current customer and project status before changing field work."); }
  // Receipt/cache refresh belongs to this account's captured repository, even
  // if this panel was hidden while the acknowledged request was in flight.
  await onCommitted?.(committed); return committed;
}
export interface CustomerMaintenancePanelProps {
  api: ApiClient; principal: Principal; workspaceId: string; permissions: readonly WorkspacePermission[]; online: boolean;
  visible?: boolean; sourceGeneration?: number; selectedCustomerId?: string | null; selectedProjectId?: string | null;
  showArchived?: boolean; onShowArchivedChange?(value: boolean): void;
  beforeAction?(): Promise<boolean>;
  onArchiveStateChanged?(state: WorkspaceArchiveState): void;
  onCommitted?(state: WorkspaceArchiveState): Promise<void>;
  onAcknowledged?(receipt: ArchiveAcknowledgment): Promise<void>;
  onPendingChange?(pending: boolean): void;
}
/** Server archive metadata only. No domain document, observation or linked field
 * is deleted or normalized by this panel. There are no free-form inputs to lose. */
export function CustomerMaintenancePanel(props: CustomerMaintenancePanelProps) {
  const [state, setState] = useState<WorkspaceArchiveState | null>(null), [localShowArchived, setLocalShowArchived] = useState(false);
  const showArchived = props.showArchived ?? localShowArchived;
  function setShowArchived(value: boolean) { if (props.onShowArchivedChange) props.onShowArchivedChange(value); else setLocalShowArchived(value); }
  const [review, setReview] = useState<MaintenanceReview | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const ownerKey = JSON.stringify([props.principal.id, props.principal.roles, props.permissions, props.workspaceId, props.selectedCustomerId, props.selectedProjectId, props.sourceGeneration, props.visible !== false, props.online]);
  const owner = useRef(ownerKey); owner.current = ownerKey; const request = useRef(0), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  const canRead = props.principal.roles.some(role => role === "operator" || role === "admin") && props.permissions.includes("field:read");
  const canManage = props.principal.roles.includes("admin") && props.permissions.includes("catalog:archive") && props.online && props.visible !== false && !props.api.accessDenied;
  function owns(key = ownerKey) { return mounted.current && owner.current === key && props.visible !== false; }
  function publish(next: WorkspaceArchiveState, key: string) {
    if (!owns(key) || next.workspaceId !== props.workspaceId) return;
    setState(next); props.onArchiveStateChanged?.(next);
  }
  async function refresh(replacingOwner = false) {
    if (!owns() || !canRead || !props.online || busy && !replacingOwner) return;
    const key = ownerKey, generation = ++request.current; setBusy(true); setMessage(null);
    try { const next = await props.api.archiveState(props.workspaceId); if (generation === request.current) publish(next, key); }
    catch (error) { if (owns(key)) setMessage(error instanceof Error ? error.message : "The saved customer list could not be loaded."); }
    finally { if (owns(key)) setBusy(false); }
  }
  useEffect(() => { setState(null); setReview(null); setMessage(null); setBusy(false); if (canRead && props.online && props.visible !== false) void refresh(true); }, [ownerKey, canRead]);
  useEffect(() => { props.onPendingChange?.(busy || review !== null); return () => { props.onPendingChange?.(false); }; }, [busy, review !== null, props.onPendingChange]);
  async function choose(choice: MaintenanceChoice) {
    if (!canManage || busy || !owns()) return;
    const key = ownerKey; setBusy(true); setMessage(null);
    try {
      if (props.beforeAction && !await props.beforeAction()) throw new Error("Preserve and synchronize the current field work before changing its customer or project.");
      const current = await props.api.archiveState(props.workspaceId);
      if (owns(key)) { publish(current, key); setReview(reviewMaintenanceChoice(current, choice)); }
    } catch (error) { if (owns(key)) setMessage(error instanceof Error ? error.message : "The archive review could not be prepared."); }
    finally { if (owns(key)) setBusy(false); }
  }
  async function confirm() {
    if (!review || !canManage || busy || !owns()) return;
    const held = review, key = ownerKey; setBusy(true); setMessage(null);
    try {
      const next = await commitMaintenanceReview(props.api, held, () => owns(key) && !props.api.accessDenied, props.onCommitted, async receipt => {
        try { await props.onAcknowledged?.(receipt); }
        finally { if (owns(key)) setState(null); }
      });
      if (owns(key)) { publish(next, key); setReview(null); setMessage(held.archived ? "Archived. Saved field work and history are retained." : "Restored. Individually archived projects stay archived."); }
    } catch (error) { if (owns(key)) setMessage(error instanceof Error ? error.message : "The action could not finish. Your saved records are retained."); }
    finally { if (owns(key)) setBusy(false); }
  }
  const action = (label: string, id: string, run: () => void, disabled = false) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled} testID={id}
    onPress={() => { if (owns() && !busy && !disabled) run(); }} style={[styles.button, (busy || disabled) && styles.disabled]}><Text style={styles.label}>{label}</Text></Pressable>;
  if (!canRead) return <Text style={styles.help}>Customer maintenance requires workspace access.</Text>;
  const rows = state ? visibleMaintenanceRecords(state, showArchived, props.selectedCustomerId) : { customers: [], projects: [] };
  return <View style={styles.panel} testID="customer-maintenance-panel"><Text style={styles.heading}>Customer maintenance</Text>
    {!props.online && <Text style={styles.help}>Connect to view current customer maintenance records.</Text>}
    <View style={styles.actions}>{action("Refresh customer list", "maintenance-refresh", () => { void refresh(); }, !props.online || !!review)}
      {props.showArchived === undefined && action(showArchived ? "Hide archived records" : "Show archived records", "maintenance-show-archived", () => setShowArchived(!showArchived), !!review)}</View>
    {!canManage && <Text style={styles.help}>Archive and restore require online administrator access.</Text>}
    {message && <Text accessibilityRole="alert" style={styles.message} testID="maintenance-message">{message}</Text>}
    {rows.customers.map(customer => <View key={customer.id} style={styles.row}><Text style={styles.label}>{customer.displayName}{customer.archived ? " · Archived" : ""}</Text>
      {canManage && action(customer.archived ? "Restore customer" : "Archive customer", `maintenance-customer-${customer.id}`, () => { void choose({ kind: "customer", entityId: customer.id, archived: !customer.archived }); }, !!review)}
      {rows.projects.filter(project => project.clientId === customer.id && (!props.selectedProjectId || project.id === props.selectedProjectId)).map(project => <View key={project.id} style={styles.project}>
        <Text style={styles.help}>{project.name}{project.archived ? " · Archived" : ""}</Text>
        {customer.archived ? <Text style={styles.help}>Restore this customer to manage its projects.</Text> : canManage && action(project.individuallyArchived ? "Restore project" : "Archive project", `maintenance-project-${project.id}`,
          () => { void choose({ kind: "project", entityId: project.id, archived: !project.individuallyArchived }); }, !!review)}
      </View>)}
    </View>)}
    {review && <View style={styles.confirmation} testID="maintenance-confirmation"><Text style={styles.heading}>{review.archived ? "Archive" : "Restore"} {review.label}?</Text>
      <Text style={styles.help}>{review.archived ? "Saved projects, field geometry, Survey history and Layout plans stay retained. Archived work is hidden from active lists." : "Active projects become visible again. Projects archived individually stay archived."}</Text>
      <View style={styles.actions}>{action("Cancel", "maintenance-cancel", () => setReview(null))}{action(review.archived ? "Confirm archive" : "Confirm restore", "maintenance-confirm", () => { void confirm(); }, !canManage)}</View>
    </View>}
  </View>;
}
const styles = StyleSheet.create({ panel: { gap: 10, paddingVertical: 12 }, heading: { fontSize: 17, fontWeight: "700", color: "#284c35" }, label: { color: "#284c35", fontWeight: "600" },
  help: { fontSize: 13, lineHeight: 19, color: "#526557" }, message: { fontSize: 13, lineHeight: 19, color: "#6e3d28" }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { padding: 10, borderWidth: 1, borderColor: "#b5c8b0", borderRadius: 6 }, disabled: { opacity: .45 }, row: { gap: 8, padding: 10, backgroundColor: "#f3f7f0", borderRadius: 5 },
  project: { gap: 6, marginLeft: 14 }, confirmation: { padding: 12, borderWidth: 1, borderColor: "#b5c8b0", borderRadius: 5, gap: 8 } });
