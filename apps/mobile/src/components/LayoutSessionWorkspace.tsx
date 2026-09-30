import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Line, Polygon } from "react-native-svg";
import { Archive, ArchiveRestore, ArrowLeft, Check, Copy, Download, Navigation, RefreshCw } from "lucide-react-native";
import { parseFieldLayoutTarget, serializeLayoutSessionDocument, type FieldLayoutTarget, type LayoutObservation } from "@cplayout/core";
import { createCatalogId, exportFileAsync, exportLayoutSessionArchiveZip, exportZipFileAsync } from "@cplayout/project-store";
import { useProjectRepository, type OpenedLayoutSession } from "../hooks/useProjectRepository";
import type { ReceiverSessionOwner } from "../gnss/receiverSessionOwner";
import { ReceiverConnectionPanel } from "./ReceiverConnectionPanel";
import { IconCommandButton } from "./CommandSurface";
import { ConfirmActionDialog } from "./ProjectCatalogDialog";
import { layoutCoordinateLabel, layoutErrorMessage, layoutSessionFilename, layoutTargetViewport } from "./layoutSessionViewModel";

export interface LayoutSessionWorkspaceProps {
  initial: OpenedLayoutSession;
  receiverOwner: ReceiverSessionOwner;
  visible?: boolean;
  navigationGuardRef?: React.MutableRefObject<(() => { dirty: boolean; busy: boolean }) | null>;
  onClose: () => void;
  onOpenCopy: (opened: OpenedLayoutSession) => void;
}

/** Session observations are appended independently; the exact target document is never edited here. */
export function LayoutSessionWorkspace({ initial, receiverOwner, onClose, onOpenCopy, visible = true, navigationGuardRef }: LayoutSessionWorkspaceProps): React.JSX.Element {
  const visibleRef = useRef(visible); visibleRef.current = visible;
  const repository = useProjectRepository();
  const [opened, setOpened] = useState(initial);
  const openedRef = useRef(opened);
  const [name, setNameState] = useState(initial.session.name);
  const [copyName, setCopyNameState] = useState(`${initial.session.name} copy`);
  const [label, setLabelState] = useState("");
  const nameRef = useRef(name), labelRef = useRef(label), copyNameRef = useRef(copyName);
  const initialCopyNameRef = useRef(copyName);
  function setName(value: string) { nameRef.current = value; setNameState(value); }
  function setLabel(value: string) { labelRef.current = value; setLabelState(value); }
  function setCopyName(value: string) { copyNameRef.current = value; setCopyNameState(value); }
  function hasUnfinishedInput(): boolean {
    return nameRef.current !== openedRef.current.session.name || labelRef.current.length > 0 || copyNameRef.current !== initialCopyNameRef.current;
  }
  const [details, setDetails] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Saving…");
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [collectionFeedback, setCollectionFeedback] = useState<{ message: string; failed: boolean } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => tick(value => value + 1), 200);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  useSyncExternalStore(receiverOwner.subscribe, receiverOwner.getSnapshot, receiverOwner.getSnapshot);
  const session = opened.session;
  const target = useMemo(() => parseFieldLayoutTarget(session.targetDocument), [session.targetDocument]);
  const gate = receiverOwner.collectionGate(target.field.projectCrs);
  const fields = repository.catalog.fieldMaps;
  const field = fields.find(item => item.id === session.fieldMapId);
  const project = repository.catalog.projects.find(item => item.id === field?.projectId);
  const customer = repository.catalog.clients.find(item => item.id === project?.clientId);
  const nameDirty = name !== session.name;
  if (navigationGuardRef) navigationGuardRef.current = () => ({ dirty: hasUnfinishedInput(), busy: busyRef.current });
  const mayWrite = repository.canSaveLayout && repository.workspaceVersion === "cplayout-workspace-v3";
  const active = !session.archived && mayWrite;
  const currentReceiver = receiverOwner.getSnapshot().observation;
  const alreadySaved = !!currentReceiver && session.observations.some(item => item.evidence.observationId === currentReceiver.id);
  // One ordered state drives both the collection message and command eligibility.
  const collectionBlock = !visible ? "Return to RTK Layout to collect an observation." : session.archived ? "Restore this session to collect observations."
    : !mayWrite ? "This workspace cannot save Layout observations."
    : busy ? `${busyLabel} Wait before collecting another observation.`
    : alreadySaved ? "This receiver position is already saved. Waiting for the next observation."
    : !gate.accepted ? gate.reason : null;
  const ready = collectionBlock === null;

  function accept(next: OpenedLayoutSession): void {
    const current = openedRef.current;
    if (next.session.id !== current.session.id || next.session.targetDocument !== current.session.targetDocument || next.session.targetHash !== current.session.targetHash) {
      throw new Error("The saved Layout target differs from the open session. Preserve this session and reopen it from the catalog.");
    }
    if (!mounted.current) return;
    openedRef.current = next; setOpened(next);
  }
  async function run(operation: () => Promise<void>, operationLabel = "Saving…", onFailure?: (message: string) => void): Promise<void> {
    if (!visibleRef.current || busyRef.current || !mounted.current) return;
    busyRef.current = true; setBusy(true); setBusyLabel(operationLabel); setMessage(null); setFailed(false);
    try { await operation(); }
    catch (error) { if (mounted.current) { const failure = layoutErrorMessage(error); setMessage(failure); setFailed(true); onFailure?.(failure); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function collect(): Promise<void> {
    if (!visibleRef.current || !active || busyRef.current) return;
    setCollectionFeedback(null);
    await run(async () => {
      const captured = openedRef.current;
      const point = receiverOwner.capture(target.field.projectCrs, createCatalogId("layout-observation"), labelRef.current.trim() || `Observation ${captured.session.observations.length + 1}`);
      const evidence = point.captureEvidence;
      const observation: LayoutObservation = { id: point.id, sessionId: captured.session.id, capturedAt: point.observedAt,
        projected: { ...point.projected }, evidence, label: point.label };
      const owner = { isCurrent: () => {
        const live = receiverOwner.getSnapshot();
        const currentGate = receiverOwner.collectionGate(target.field.projectCrs);
        // The repository evaluates this again under its write lock, before its atomic update.
        return mounted.current && visibleRef.current && openedRef.current === captured && !captured.session.archived
          && live.phase === "connected" && live.sessionId === evidence.sessionId
          && live.observation?.id === evidence.observationId && currentGate.accepted
          && currentGate.projectionId === evidence.projection.id;
      } };
      if (!owner.isCurrent()) throw new Error("Receiver position changed before collection. Review the live status and collect again.");
      const next = await repository.appendLayoutObservation(captured.session.id, observation, captured.persistenceRevision, captured.session.revision, owner);
      if (!mounted.current) return;
      accept(next); setLabel("");
      const savedMessage = `Saved ${observation.label}. The frozen target is unchanged.`;
      setMessage(savedMessage); setCollectionFeedback({ message: savedMessage, failed: false });
    }, "Saving…", failure => setCollectionFeedback({ message: `Observation not saved. ${failure} Your label is kept. Review the message and readiness, then retry Collect and save observation.`, failed: true }));
  }
  async function exportSession(format: "json" | "zip"): Promise<void> {
    await run(async () => {
      const saved = openedRef.current.session;
      const result = format === "json"
        ? await exportFileAsync(layoutSessionFilename(saved.name, format), serializeLayoutSessionDocument(saved), { mimeType: "application/json" })
        : await exportZipFileAsync(layoutSessionFilename(saved.name, format), exportLayoutSessionArchiveZip(saved));
      if (!result.ok) throw new Error(result.message);
      if (mounted.current) setMessage(`${result.message} Saved session revision ${saved.revision}; design revision ${target.source.inputRevision}.`);
    }, "Preparing export…");
  }
  async function archive(): Promise<void> {
    if (!visibleRef.current || busyRef.current) return;
    setConfirmArchive(false);
    await run(async () => {
      const current = openedRef.current;
      const next = await repository.archiveLayoutSession(current.session.id, !current.session.archived, current.persistenceRevision, current.session.revision);
      if (mounted.current) { accept(next); setMessage(next.session.archived ? "Session archived. Its target and observations remain saved." : "Session restored."); }
    });
  }
  return <SafeAreaView style={styles.root} testID="layout-session-workspace">
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.header}><View style={styles.grow}><Text style={styles.title}>{session.name}</Text>
        <Text style={styles.meta}>{customer?.displayName ?? "Customer"} → {project?.name ?? "Project"} → {field?.name ?? "Field"} → Layout</Text>
        <Text accessibilityLiveRegion="polite" style={styles.saveState} testID="layout-save-state">{busy ? busyLabel : failed ? "Action failed — saved work retained" : nameDirty ? "Unsaved session name" : "Saved"}{session.archived ? " · Archived" : ""} · Session revision {session.revision}</Text>
      </View><IconCommandButton id="layout-back" label="Layout sessions" icon={<ArrowLeft />} showLabel disabled={busy} onPress={() => { if (!visibleRef.current || busyRef.current) return; if (hasUnfinishedInput()) setConfirmClose(true); else onClose(); }} testID="layout-workspace-back" /></View>
      <IconCommandButton id="layout-session-actions" label="Session actions" icon={<Check />} showLabel selected={actionsOpen} onPress={() => setActionsOpen(value => !value)} testID="layout-session-actions-toggle" />
      {actionsOpen && <View style={styles.card} testID="layout-session-actions"><Text style={styles.heading}>Session actions</Text>
      <View style={styles.toolbar}>
        <IconCommandButton id="layout-export-json" label="Export session JSON" icon={<Download />} showLabel disabled={busy} onPress={() => exportSession("json")} testID="layout-export-json" />
        <IconCommandButton id="layout-export-zip" label="Export session ZIP" icon={<Download />} showLabel disabled={busy} onPress={() => exportSession("zip")} testID="layout-export-zip" />
        <IconCommandButton id="layout-reload" label="Reload saved work" icon={<RefreshCw />} showLabel disabled={busy} onPress={() => run(async () => {
          const next = await repository.openLayoutSession(openedRef.current.session.id);
          if (mounted.current) { accept(next); setMessage("Saved work reloaded. Your entered text has been kept."); }
        }, "Reloading…")} testID="layout-reload" />
      </View>

        <Text style={styles.label}>Session name</Text><TextInput value={name} onChangeText={setName} editable={!busy && mayWrite} maxLength={200} accessibilityLabel="Rename Layout session" style={styles.input} testID="layout-rename-input" />
        <IconCommandButton id="layout-rename" label="Save name" icon={<Check />} showLabel disabled={busy || !mayWrite || !name.trim() || !nameDirty} onPress={() => run(async () => {
          const current = openedRef.current;
          const next = await repository.renameLayoutSession(current.session.id, name.trim(), current.persistenceRevision, current.session.revision);
          if (mounted.current) { accept(next); setName(next.session.name); setMessage("Session name saved."); }
        })} testID="layout-rename" />
        <Text style={styles.label}>Name for a new copy</Text><TextInput value={copyName} onChangeText={setCopyName} editable={!busy && mayWrite} maxLength={200} accessibilityLabel="Copy Layout session name" style={styles.input} testID="layout-copy-name" />
        <Text style={styles.meta}>A copy keeps this exact target and starts with no observations.</Text>
        {(nameDirty || label.length > 0) && <Text style={styles.meta}>Save the session name and collect or clear the observation label before opening a copy.</Text>}
        <IconCommandButton id="layout-copy" label="Create empty copy" icon={<Copy />} showLabel disabled={busy || !mayWrite || !copyName.trim() || nameDirty || label.length > 0} onPress={() => run(async () => {
          const current = openedRef.current;
          const next = await repository.copyLayoutSession(current.session.id, copyName.trim(), current.persistenceRevision, current.session.revision);
          if (mounted.current && visibleRef.current) onOpenCopy(next);
        })} testID="layout-copy" />
        <IconCommandButton id="layout-archive" label={session.archived ? "Restore session" : "Archive session"} icon={session.archived ? <ArchiveRestore /> : <Archive />} showLabel disabled={busy || !mayWrite} onPress={() => session.archived ? archive() : setConfirmArchive(true)} testID="layout-archive" />
      </View>}
      {(message || repository.storageError) && <Text accessibilityLiveRegion="polite" style={[styles.notice, failed && styles.error]} testID="layout-feedback">{message ?? repository.storageError}</Text>}
      <ReceiverConnectionPanel owner={receiverOwner} projectCrs={target.field.projectCrs} />
      <View style={styles.card} testID="layout-target-card"><Text style={styles.heading}>Frozen design target</Text>
        <Text style={styles.label}>{target.field.name} · Design revision {target.source.inputRevision}</Text>
        <Text style={styles.meta}>The boundary and machine locations below stay fixed. Blue marks are saved observations.</Text>
        <TargetDiagram target={target} observations={session.observations} />
        {target.source.selectedMachineIds.map(id => {
          const machine = target.field.machines.find(item => item.id === id);
          return <View key={id} style={styles.machineRow}><Text style={styles.label}>{machine?.configuration.name ?? id}</Text>
            <Text selectable style={styles.meta}>Machine ID: {id}</Text>{machine && <Text style={styles.meta}>{layoutCoordinateLabel(machine.pivotCenter, target)}</Text>}</View>;
        })}
        <Text selectable style={styles.meta}>Coordinate system: {target.field.projectCrs}</Text>
        <IconCommandButton id="layout-details" label={details ? "Hide target details" : "Show target details"} icon={<Check />} showLabel selected={details} onPress={() => setDetails(value => !value)} testID="layout-target-details-toggle" />
        {details && <View style={styles.details} testID="layout-target-details"><Text selectable style={styles.meta}>Session ID: {session.id}</Text><Text selectable style={styles.meta}>Source field ID: {target.source.fieldId}</Text>
          <Text selectable style={styles.hash}>Target SHA-256: {session.targetHash}</Text><Text style={styles.meta}>Exact frozen target bytes are retained in every session export.</Text></View>}
      </View>
      <View style={styles.card}><Text style={styles.heading}>Saved observations ({session.observations.length})</Text>
        {session.observations.length === 0 && <Text style={styles.meta}>No observations collected. Connect the receiver above when ready.</Text>}
        {session.observations.slice(-100).reverse().map(observation => <View style={styles.observation} key={observation.id} testID={`layout-observation-${observation.id}`}><Text style={styles.label}>{observation.label ?? observation.id}</Text>
          <Text style={styles.meta}>{layoutCoordinateLabel(observation.projected, target)}</Text>
          <Text style={styles.meta}>{observation.capturedAt} · {observation.evidence.gga.sentenceIdentifier} · {(observation.evidence.capture.ageMs / 1000).toFixed(2)} s old when captured</Text>
        </View>)}
        {session.observations.length > 100 && <Text style={styles.meta}>Showing the latest 100 observations. JSON and ZIP exports contain all observations.</Text>}
      </View>
    </ScrollView>
      <View style={styles.collection} testID="layout-collection"><Text style={styles.heading}>Save an observation</Text>
        {collectionFeedback && <ScrollView style={styles.collectionFeedback} keyboardShouldPersistTaps="handled"><Text accessibilityLiveRegion="polite" style={[styles.meta, collectionFeedback.failed ? styles.collectionError : styles.ready]} testID="layout-collection-feedback">{collectionFeedback.message}</Text></ScrollView>}
        <Text accessibilityLiveRegion="polite" style={ready ? styles.ready : styles.meta} testID="layout-collection-readiness">{collectionBlock ?? "Ready to collect — RTK Fixed — receiver reported"}</Text>
        <View style={styles.collectionControls}><View style={styles.collectionLabel}><Text style={styles.label}>Observation label (optional)</Text><TextInput value={label} onChangeText={setLabel} editable={!busy && active} accessibilityLabel="Layout observation label" placeholder={`Observation ${session.observations.length + 1}`} style={styles.input} maxLength={500} testID="layout-observation-label" /></View>
        <IconCommandButton id="layout-collect" label="Collect and save observation" icon={<Navigation />} showLabel disabled={!ready} onPress={collect} testID="layout-collect" /></View>
      </View>

    <ConfirmActionDialog visible={visible && confirmClose} title="Leave unfinished input?" message="Saved observations and the frozen target are safe. The session name, copy name, or observation label you have not saved will be discarded." confirmLabel="Leave Layout" onCancel={() => setConfirmClose(false)} onConfirm={() => { if (visibleRef.current && !busyRef.current) onClose(); }} testID="layout-close-confirm" />
    <ConfirmActionDialog visible={visible && confirmArchive} title="Archive this session?" message="The frozen target and observations remain saved. Restore this session to collect more observations." confirmLabel="Archive session" onCancel={() => setConfirmArchive(false)} onConfirm={archive} testID="layout-archive-confirm" />
  </SafeAreaView>;
}

function TargetDiagram({ target, observations }: { target: FieldLayoutTarget; observations: readonly LayoutObservation[] }): React.JSX.Element {
  const viewport = useMemo(() => layoutTargetViewport(target), [target]);
  const polygon = target.field.fieldBoundary.map(point => { const display = viewport.point(point); return `${display.x},${display.y}`; }).join(" ");
  return <View style={styles.diagram} testID="layout-target-diagram"><Svg width="100%" height={300} viewBox={`0 0 ${viewport.width} ${viewport.height}`} accessibilityLabel="Frozen field boundary, selected machine locations, and separately saved observations">
    <Polygon points={polygon} fill="#edf4e3" stroke="#5b794e" strokeWidth={2} />
    {target.field.machines.filter(machine => target.source.selectedMachineIds.includes(machine.id)).map(machine => {
      const point = viewport.point(machine.pivotCenter);
      return <React.Fragment key={machine.id}><Circle cx={point.x} cy={point.y} r={9} fill="#254234" /><Line x1={point.x - 15} y1={point.y} x2={point.x + 15} y2={point.y} stroke="#254234" strokeWidth={2} /><Line x1={point.x} y1={point.y - 15} x2={point.x} y2={point.y + 15} stroke="#254234" strokeWidth={2} /></React.Fragment>;
    })}
    {observations.slice(-1000).map(observation => { const point = viewport.point(observation.projected); return <Circle key={observation.id} cx={point.x} cy={point.y} r={4} fill="#236cbb" stroke="#fff" strokeWidth={1} />; })}
  </Svg><Text style={styles.meta}>Green cross: frozen machine location · Blue dot: saved observation. Points outside the target view remain in the list and exports.{observations.length > 1000 ? " The diagram shows the latest 1,000 observations." : ""}</Text></View>;
}

const styles = StyleSheet.create({
  collectionFeedback: { maxHeight: 100, flexGrow: 0 }, collectionError: { color: "#883918" },
  collection: { backgroundColor: "#fff", borderTopWidth: 1, borderColor: "#d5dfd3", padding: 12, gap: 6 },
  collectionControls: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 8 }, collectionLabel: { flexGrow: 1, flexShrink: 1, minWidth: 160, gap: 4 },
  root: { flex: 1, backgroundColor: "#f3f5ef" }, content: { gap: 14, padding: 18, paddingBottom: 40, width: "100%", maxWidth: 1120, alignSelf: "center" },
  header: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }, grow: { flex: 1, minWidth: 180 },
  title: { color: "#173428", fontSize: 26, fontWeight: "800" }, heading: { color: "#173428", fontSize: 17, fontWeight: "800" }, label: { color: "#254234", fontSize: 13, fontWeight: "700" },
  meta: { color: "#59695f", fontSize: 13, lineHeight: 20, flexShrink: 1 }, saveState: { color: "#254234", fontSize: 12, lineHeight: 20 }, ready: { color: "#265b24", fontWeight: "700", fontSize: 13, lineHeight: 20 },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, card: { backgroundColor: "#fff", borderColor: "#d5dfd3", borderWidth: 1, borderRadius: 10, padding: 16, gap: 10 },
  notice: { backgroundColor: "#edf3e9", color: "#254234", padding: 12, borderRadius: 7, fontSize: 13, lineHeight: 20 }, error: { backgroundColor: "#fff0e8", color: "#883918" },
  input: { borderColor: "#aabaaa", borderWidth: 1, borderRadius: 6, padding: 11, minHeight: 44, color: "#173428", backgroundColor: "#fff", fontSize: 15 },
  details: { gap: 6 }, hash: { color: "#59695f", fontSize: 11, lineHeight: 18, flexShrink: 1 }, diagram: { gap: 6, overflow: "hidden" }, machineRow: { gap: 3 },
  observation: { paddingVertical: 10, borderBottomColor: "#e3e8df", borderBottomWidth: 1, gap: 3 },
});
