import React, { useEffect, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArchiveRestore, ArrowLeft, Check, FolderOpen, RefreshCw, Upload } from "lucide-react-native";
import { parseFieldLayoutTarget, parseLayoutSessionDocument, parseStrictJson, serializeLayoutSessionDocument, type FieldLayoutTarget } from "@cplayout/core";
import { importLayoutSessionArchiveZip } from "@cplayout/project-store";
import { useProjectRepository, type OpenedLayoutSession } from "../hooks/useProjectRepository";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
import { layoutErrorMessage } from "./layoutSessionViewModel";

export interface PendingLayoutTarget {
  targetDocument: string;
  fieldMapId: string;
  expectedWorkspaceRevision: number;
}
export interface LayoutSessionCatalogProps {
  fieldMapId: string | null;
  /** The catalog can remain mounted behind an open session to retain import review input. */
  visible?: boolean;
  onOpenSession: (opened: OpenedLayoutSession) => void;
  onClose: () => void;
  pendingTarget?: PendingLayoutTarget;
}
type ImportCandidate = { kind: "target" | "session"; document: string; target: FieldLayoutTarget; name: string };

/** Owns import review and association. No document is written before the explicit save action. */
export function LayoutSessionCatalog({ fieldMapId, visible = true, onOpenSession, onClose, pendingTarget }: LayoutSessionCatalogProps): React.JSX.Element {
  const repository = useProjectRepository();
  const wasVisible = useRef(visible);
  const [association, setAssociation] = useState(pendingTarget?.fieldMapId ?? fieldMapId);
  const [candidate, setCandidate] = useState<ImportCandidate | null>(null);
  const [name, setName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [expectedTargetRevision, setExpectedTargetRevision] = useState<number | null>(pendingTarget?.expectedWorkspaceRevision ?? null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const returningToCatalog = visible && !wasVisible.current;
    wasVisible.current = visible;
    // The repository owns the initial read. Returning only refreshes saved listings;
    // it must not rebase the pending import's revision or replace its entered name.
    if (returningToCatalog) void repository.refreshProjects();
  }, [visible, repository.refreshProjects]);
  useEffect(() => {
    if (!pendingTarget) return;
    try {
      const target = parseFieldLayoutTarget(pendingTarget.targetDocument);
      const nextName = `${target.field.name} Layout`;
      setCandidate({ kind: "target", document: pendingTarget.targetDocument, target, name: nextName });
      setName(nextName); setAssociation(pendingTarget.fieldMapId);
      setExpectedTargetRevision(pendingTarget.expectedWorkspaceRevision);
    } catch (error) { setMessage(layoutErrorMessage(error)); setFailed(true); }
  }, [pendingTarget]);
  const field = repository.catalog.fieldMaps.find(item => item.id === association);
  const project = repository.catalog.projects.find(item => item.id === field?.projectId);
  const customer = repository.catalog.clients.find(item => item.id === project?.clientId);
  const upgradeNeeded = repository.workspaceVersion !== "cplayout-workspace-v3";
  const canWrite = repository.canSaveLayout && !upgradeNeeded && !!field && !busy;
  const sessions = repository.layoutSessions.filter(session => session.fieldMapId === association && (showArchived || !session.archived));

  async function run(operation: () => Promise<void>): Promise<void> {
    if (busyRef.current || !mounted.current) return;
    busyRef.current = true; setBusy(true); setMessage(null); setFailed(false);
    try { await operation(); }
    catch (error) { if (mounted.current) { setMessage(layoutErrorMessage(error)); setFailed(true); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function revision(): number {
    if (repository.catalogRevision === null) throw new Error("Reload saved work before continuing.");
    return repository.catalogRevision;
  }
  async function pickImport(): Promise<void> {
    await run(async () => {
      const picked = await pickLayoutFile(() => {
        if (!mounted.current) return;
        // A chosen replacement retires the old review before reading or validating it.
        // Canceling the chooser never invokes this callback and keeps the old review.
        setCandidate(null); setName(""); setExpectedTargetRevision(null);
      });
      if (!picked || !mounted.current) return;
      let next: ImportCandidate;
      if (/\.zip$/i.test(picked.name)) {
        const session = importLayoutSessionArchiveZip(picked.bytes);
        next = { kind: "session", document: serializeLayoutSessionDocument(session), target: parseFieldLayoutTarget(session.targetDocument), name: session.name };
      } else {
        const document = new TextDecoder("utf-8", { fatal: true }).decode(picked.bytes);
        const raw = parseStrictJson(document);
        const version = raw && typeof raw === "object" && "documentVersion" in raw ? raw.documentVersion : null;
        if (version === "field-layout-target-v1") {
          const target = parseFieldLayoutTarget(document);
          next = { kind: "target", document, target, name: `${target.field.name} Layout` };
        } else if (version === "layout-session-v1") {
          const session = parseLayoutSessionDocument(document);
          next = { kind: "session", document, target: parseFieldLayoutTarget(session.targetDocument), name: session.name };
        } else throw new Error("Choose a frozen Layout target JSON, or a Layout session JSON or ZIP. Open project and field archives from the design catalog first, then create a Layout target.");
      }
      setCandidate(next); setName(next.name); setExpectedTargetRevision(repository.catalogRevision);
      setMessage("File checked. Confirm the field association below before saving.");
    });
  }
  async function saveCandidate(): Promise<void> {
    if (!candidate || !canWrite || !association) return;
    if (!name.trim()) { setMessage("Enter a Layout session name."); setFailed(true); return; }
    const capturedCandidate = candidate;
    const capturedAssociation = association;
    await run(async () => {
      const expectedRevision = expectedTargetRevision ?? revision();
      const opened = capturedCandidate.kind === "target"
        ? await repository.createLayoutSession({ fieldMapId: capturedAssociation, targetDocument: capturedCandidate.document, name: name.trim() }, expectedRevision)
        : await repository.importLayoutSession(capturedCandidate.document, capturedAssociation, expectedRevision);
      if (mounted.current) onOpenSession(opened);
    });
  }
  return <SafeAreaView style={styles.root} testID="layout-session-catalog">
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View style={styles.grow}><Text style={styles.title}>Layout sessions</Text>
        <Text style={styles.meta}>{field ? `${customer?.displayName ?? "Customer"} → ${project?.name ?? "Project"} → ${field.name}` : "Choose the field where this Layout session belongs."}</Text></View>
        <IconCommandButton id="layout-back" label="Back" icon={<ArrowLeft />} showLabel disabled={busy} onPress={() => candidate ? setConfirmClose(true) : onClose()} testID="layout-catalog-back" /></View>
      <Text style={styles.meta}>Keep a frozen design target and save field observations alongside it. Collecting observations cannot move the target.</Text>
      <View style={styles.toolbar}>
        <IconCommandButton id="layout-import" label="Import layout target or session" icon={<Upload />} showLabel disabled={busy || Platform.OS !== "web"} onPress={pickImport} testID="layout-import" />
        <IconCommandButton id="layout-refresh" label="Reload saved work" icon={<RefreshCw />} showLabel disabled={busy} onPress={() => run(async () => { await repository.refreshProjects(); setExpectedTargetRevision(null); setMessage("Saved work reloaded. Review your field and try again."); })} testID="layout-catalog-reload" />
      </View>
      {Platform.OS !== "web" && <Text style={styles.notice}>Layout session storage and import are available in the desktop browser. This device has not enabled this workspace format.</Text>}
      {(message || repository.storageError) && <Text accessibilityLiveRegion="polite" style={[styles.notice, failed && styles.error]} testID="layout-catalog-feedback">{message ?? repository.storageError}</Text>}
      <View style={styles.card}><Text style={styles.heading}>Field association</Text>
        <Text style={styles.meta}>Choose the saved field that owns this session. The target’s original field identity stays unchanged.</Text>
        <View style={styles.toolbar}>{repository.catalog.fieldMaps.map(item => {
          const folder = repository.catalog.projects.find(value => value.id === item.projectId);
          return <IconCommandButton key={item.id} id={`layout-field-${item.id}`} label={`${folder?.name ?? "Project"} / ${item.name}`} icon={<FolderOpen />} showLabel selected={association === item.id} disabled={busy}
            onPress={() => setAssociation(item.id)} testID={`layout-associate-${item.id}`} />;
        })}</View>
        {!repository.catalog.fieldMaps.length && <Text style={styles.notice}>Create a customer, project, and field in the catalog before saving a Layout session.</Text>}
      </View>
      {upgradeNeeded && <View style={styles.card} testID="layout-upgrade"><Text style={styles.heading}>Enable saved Layout sessions</Text>
        <Text style={styles.meta}>This adds Layout sessions to your workspace and retains the exact previous workspace for recovery. Older app versions cannot open the new workspace.</Text>
        <IconCommandButton id="layout-upgrade" label="Enable Layout sessions" icon={<Check />} showLabel disabled={busy || Platform.OS !== "web" || repository.catalogRevision === null}
          onPress={() => run(async () => { const nextRevision = await repository.upgradeLayoutWorkspace(revision()); setExpectedTargetRevision(nextRevision); setMessage("Layout sessions enabled. The previous workspace has been retained."); })} testID="layout-upgrade-confirm" />
      </View>}
      {candidate && <View style={styles.card} testID="layout-import-review"><Text style={styles.heading}>{candidate.kind === "target" ? "Create session from frozen target" : "Import saved Layout session"}</Text>
        <Text style={styles.meta}>Target: {candidate.target.field.name} · Design revision {candidate.target.source.inputRevision}</Text>
        <Text selectable style={styles.meta}>Source field ID: {candidate.target.source.fieldId}</Text>
        {candidate.target.source.selectedMachineIds.map(id => <Text key={id} selectable style={styles.label}>Machine: {candidate.target.field.machines.find(machine => machine.id === id)?.configuration.name ?? id} · {id}</Text>)}
        <Text style={styles.label}>Save under: {field ? `${project?.name ?? "Project"} / ${field.name}` : "Choose a field above"}</Text>
        <Text style={styles.label}>Layout session name</Text><TextInput value={name} editable={!busy && candidate.kind === "target"} onChangeText={setName} accessibilityLabel="Layout session name" style={styles.input} testID="layout-new-name" />
        {candidate.kind === "session" && <Text style={styles.meta}>The imported session retains its name, identity, target, and observations. If it already exists, open it and use Copy to create an empty session.</Text>}
        <View style={styles.toolbar}><IconCommandButton id="layout-save-new" label={busy ? "Saving…" : candidate.kind === "target" ? "Save and open in Layout" : "Import and open session"} icon={<Check />} showLabel disabled={!canWrite || !name.trim()} onPress={saveCandidate} testID="layout-save-new" />
          <IconCommandButton id="layout-cancel-import" label="Cancel import" icon={<ArrowLeft />} showLabel disabled={busy} onPress={() => { setCandidate(null); setMessage(null); }} testID="layout-cancel-import" /></View>
      </View>}
      <View style={styles.header}><Text style={styles.heading}>Saved for this field</Text><IconCommandButton id="layout-show-archived" label={showArchived ? "Hide archived" : "Show archived"} icon={<ArchiveRestore />} showLabel selected={showArchived} disabled={busy} onPress={() => setShowArchived(value => !value)} testID="layout-show-archived" /></View>
      {sessions.length === 0 && <Text style={styles.meta}>No {showArchived ? "" : "active "}Layout sessions for this field. Open a frozen target from a completed design, or import one above.</Text>}
      {sessions.map(session => <View style={styles.card} key={session.id} testID={`layout-session-row-${session.id}`}><Text style={styles.heading}>{session.name}{session.archived ? " · Archived" : ""}</Text>
        <Text style={styles.meta}>{session.observations.length} saved observations · Session revision {session.revision}</Text>
        <Text selectable style={styles.meta}>Session ID: {session.id}</Text>
        <IconCommandButton id={`layout-open-${session.id}`} label={session.archived ? "Open archived session" : "Open in Layout"} icon={<FolderOpen />} showLabel disabled={busy}
          onPress={() => run(async () => { const opened = await repository.openLayoutSession(session.id); if (mounted.current) onOpenSession(opened); })} testID={`layout-open-${session.id}`} />
      </View>)}
    </ScrollView>
    <ConfirmActionDialog visible={confirmClose} title="Leave this import review?" message="No session has been created. The selected target and entered name will leave this screen; your source file stays unchanged." confirmLabel="Leave import review" onCancel={() => setConfirmClose(false)} onConfirm={onClose} testID="layout-catalog-close-confirm" />
  </SafeAreaView>;
}

async function pickLayoutFile(onSelected: () => void): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (typeof document === "undefined") throw new Error("Import a Layout file in the desktop browser.");
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,.zip,application/json,application/zip";
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      onSelected();
      if (file.size > 20 * 1024 * 1024) { reject(new Error("This file is larger than 20 MB. Choose a Layout target or session export.")); return; }
      void file.arrayBuffer().then(buffer => resolve({ name: file.name, bytes: new Uint8Array(buffer) }), reject);
    }, { once: true });
    input.click();
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f3f5ef" }, content: { gap: 14, padding: 18, paddingBottom: 40, width: "100%", maxWidth: 1120, alignSelf: "center" },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }, grow: { flex: 1, minWidth: 180 },
  title: { color: "#173428", fontSize: 26, fontWeight: "800" }, heading: { color: "#173428", fontSize: 17, fontWeight: "800" },
  label: { color: "#254234", fontSize: 13, fontWeight: "700" }, meta: { color: "#59695f", fontSize: 13, lineHeight: 20, flexShrink: 1 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, card: { backgroundColor: "#fff", borderColor: "#d5dfd3", borderWidth: 1, borderRadius: 10, padding: 16, gap: 10 },
  notice: { backgroundColor: "#edf3e9", color: "#254234", padding: 12, borderRadius: 7, fontSize: 13, lineHeight: 20 }, error: { backgroundColor: "#fff0e8", color: "#883918" },
  input: { borderColor: "#aabaaa", borderWidth: 1, borderRadius: 6, padding: 11, minHeight: 44, color: "#173428", backgroundColor: "#fff", fontSize: 15 },
});
