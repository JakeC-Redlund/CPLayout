import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { FolderOpen, PanelLeft, Radio, Save, Undo2, Redo2 } from "lucide-react-native";
import { WorkspaceMapSurface, type WorkspaceMapPointEvent, type WorkspaceMapScene, type WorkspaceSceneLayer } from "@cplayout/map-adapters";
import { CommandBar, IconCommandButton, type CommandMenuItemConfig } from "../components/CommandSurface";
import { WorkspaceSelect } from "./WorkspaceModePanels";
import { ReceiverConnectionPanel } from "../components/ReceiverConnectionPanel";
import { InputRetentionProvider } from "../inputRetention";
import type { useWorkspaceController } from "./useWorkspaceController";
import type { WorkspaceMode } from "./workspacePresentation";
import { workspaceMapContextKey } from "./workspaceMapContext";
import { workspaceEditableIsDirty } from "./workspaceDocumentAdapters";
import { useWorkspaceRecoveryParticipant } from "./workspaceRecoveryParticipants";
import { useWorkspaceRecoveryCamera } from "./useWorkspaceRecoveryCamera";
import { parseFieldLayoutTarget } from "@cplayout/core";

export interface UnifiedWorkspaceProps {
  readonly controller: ReturnType<typeof useWorkspaceController>;
  readonly panels: Readonly<Record<WorkspaceMode, ReactNode>>;
  readonly onOpenCatalog: () => void;
  readonly fileActions: readonly CommandMenuItemConfig[];
  readonly management?: ReactNode;
  readonly canDigitize?: boolean;
  readonly onDesignPoint?: (event: WorkspaceMapPointEvent) => void;
  readonly displayScene?: WorkspaceMapScene | null;
  readonly layerVisibility?: Readonly<Partial<Record<WorkspaceSceneLayer, boolean>>>;
  readonly onRestoreDesignFocus?: () => boolean;
  readonly mapInteractionKey?: string;
  readonly isMapInteractionCurrent?: (event: { cameraContextKey: string; interactionKey: string }) => boolean;
  readonly onSaveCurrentSubject: () => void;
  readonly toolsRevealRequest?: number;
  readonly fileInputIntent?: "copy" | "rename" | null;
}
const modes = [{ id: "design", label: "Design" }, { id: "survey", label: "Survey" }, { id: "layout", label: "Layout" }] as const;

/** Common composition only. The supplied controller remains the sole document,
 * receiver, save and input owner. Mode panels contain no competing working maps. */
export function UnifiedWorkspace({ controller, panels, onOpenCatalog, fileActions, management,
  canDigitize = false, onDesignPoint, displayScene, layerVisibility, onRestoreDesignFocus, mapInteractionKey, isMapInteractionCurrent,
  onSaveCurrentSubject, toolsRevealRequest = 0, fileInputIntent = null }: UnifiedWorkspaceProps): React.JSX.Element {
  const { width } = useWindowDimensions();
  const compact = width < 900;
  const [toolsOpen, setToolsOpen] = useState(!compact);
  const toolsOpenRef = useRef(toolsOpen); toolsOpenRef.current = toolsOpen;
  const [receiverOpen, setReceiverOpen] = useState(false);
  const frameEpoch = useRef(0), frameState = useRef({ toolsOpen, receiverOpen }); frameState.current = { toolsOpen, receiverOpen };
  const recoveryCamera = useWorkspaceRecoveryCamera(controller);
  useWorkspaceRecoveryParticipant(controller.recoveryParticipants, "frame", {
    capture: () => ({ ...frameState.current, diagnosticOpen: false }),
    stage(value, target) {
      if (value.diagnosticOpen) throw new Error("Diagnostic controls have no recovery owner.");
      const epoch = frameEpoch.current, inputOwner = controller.recoveryParticipants.getInputOwner();
      return { isCurrent: () => frameEpoch.current === epoch && controller.recoveryParticipants.getInputOwner() === inputOwner,
        consume(delivery) {
          if (!delivery.isCurrent() || delivery.target !== target) throw new Error("The common controls recovery delivery retired.");
          toolsOpenRef.current = value.toolsOpen; setToolsOpen(value.toolsOpen); setReceiverOpen(value.receiverOpen);
          frameState.current = { toolsOpen: value.toolsOpen, receiverOpen: value.receiverOpen }; focusOwners.current.clear();
        } };
    },
  });
  const [workingSize, setWorkingSize] = useState({ width: 0, height: 0 });
  const { state, repository, settings } = controller;
  const scene = displayScene === undefined ? controller.scene : displayScene;
  const mode = state.presentation.mode;
  const hasWorkingDocument = !!(state.editable || state.layout);
  const toolsVisible = toolsOpen && hasWorkingDocument;
  const fullTools = compact && workingSize.height > 0 && workingSize.height < 302;
  const dockHeight = Math.min(Math.max(142, workingSize.height * 0.4), Math.max(142, workingSize.height - 160));
  const mapHidden = !scene && !!management || toolsVisible && fullTools;
  const mapVisible = !!scene && !mapHidden;
  const visibilityOwner = useRef({ visible: mapVisible, epoch: 0 });
  if (visibilityOwner.current.visible !== mapVisible) visibilityOwner.current = { visible: mapVisible, epoch: visibilityOwner.current.epoch + 1 };
  function changeToolsVisibility(open: boolean) {
    if (!controller.recoveryParticipants.canEdit()) return;
    frameEpoch.current++; controller.recoveryParticipants.notifyChanged();
    const visible = !!scene && !(open && hasWorkingDocument && fullTools);
    if (visibilityOwner.current.visible !== visible) visibilityOwner.current = { visible, epoch: visibilityOwner.current.epoch + 1 };
    toolsOpenRef.current = open; setToolsOpen(open);
  }
  const revealedRequest = useRef(toolsRevealRequest);
  useEffect(() => {
    if (revealedRequest.current === toolsRevealRequest) return;
    revealedRequest.current = toolsRevealRequest; changeToolsVisibility(true);
  }, [toolsRevealRequest]);
  const rootRef = useRef<View>(null);
  const modeRef = useRef(mode); modeRef.current = mode;
  const restoreDesignRef = useRef(onRestoreDesignFocus); restoreDesignRef.current = onRestoreDesignFocus;
  const focusOwners = useRef(new Map<WorkspaceMode, { node: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; selection: { start: number; end: number } | null }>());
  const documentGeneration = state.presentation.documentGeneration;
  useEffect(() => {
    focusOwners.current.clear();
    if (Platform.OS !== "web") return;
    const root = rootRef.current as unknown as HTMLElement | null;
    if (!root) return;
    const remember = () => {
      const node = document.activeElement;
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement)
        || !root.contains(node) || !node.closest(`[data-testid="workspace-panel-${modeRef.current}"]`)) return;
      const selection = "selectionStart" in node && node.selectionStart !== null && node.selectionEnd !== null
        ? { start: node.selectionStart, end: node.selectionEnd } : null;
      focusOwners.current.set(modeRef.current, { node, selection });
    };
    root.addEventListener("focusin", remember);
    document.addEventListener("selectionchange", remember);
    return () => { root.removeEventListener("focusin", remember); document.removeEventListener("selectionchange", remember); focusOwners.current.clear(); };
  }, [documentGeneration]);
  useEffect(() => {
    if (!toolsOpen || !(state.editable || state.layout)) return;
    // Child registrations/disabled states settle before restoration. The effect
    // runs for visibility transitions, never the receiver's age tick rerenders.
    const restore = () => {
      if (mode === "design" && restoreDesignRef.current?.()) return;
      if (Platform.OS !== "web") return;
      const retained = focusOwners.current.get(mode);
      if (!retained?.node.isConnected || retained.node.disabled || retained.node.getClientRects().length === 0) return;
      retained.node.focus();
      if (retained.selection && "setSelectionRange" in retained.node && retained.node.type !== "number") {
        retained.node.setSelectionRange(retained.selection.start, retained.selection.end);
      }
    };
    if (Platform.OS === "web") { const frame = requestAnimationFrame(restore); return () => cancelAnimationFrame(frame); }
    restore();
  }, [mode, toolsOpen, documentGeneration]);
  const fieldId = state.editable?.identity.fieldMapId ?? state.layout?.session.fieldMapId ?? null;
  const field = repository.catalog.fieldMaps.find(item => item.id === fieldId);
  const project = repository.catalog.projects.find(item => item.id === field?.projectId);
  const customer = repository.catalog.clients.find(item => item.id === project?.clientId);
  const designName = state.editable?.kind === "draft" ? state.editable.editor.draft.name
    : state.editable?.kind === "field" ? state.editable.editor.field.name
      : state.editable?.kind === "project" ? state.editable.editor.project.name : null;
  const customerName = customer?.companyName || customer?.contactName || (customer ? `${customer.primaryContactFirstName} ${customer.primaryContactLastName}`.trim() : null);
  const context = [customerName, project?.name, field?.name, designName].filter(Boolean).join("  ›  ");
  const showingSession = !!state.layout && (mode === "layout" || !state.editable);
  const activeName = showingSession ? state.layout!.session.name : designName;
  const compactContext = [activeName, field?.name].filter(Boolean).join("  ·  ");
  const completeContext = showingSession
    ? [customerName, project?.name, field?.name, `Layout session: ${state.layout!.session.name}`].filter(Boolean).join("  ›  ")
      + (designName ? `; Retained design: ${designName}` : "")
    : context;
  const fieldEditor = state.editable?.kind === "field" ? state.editable.editor : null;
  const selectedMachine = fieldEditor?.field.machines.find(item => item.id === fieldEditor.selectedMachineId);
  const selectedLateral = fieldEditor?.field.lateralMachines?.find(item => item.id === fieldEditor.selectedMachineId);
  const frozenTarget = showingSession ? parseFieldLayoutTarget(state.layout!.session.targetDocument) : null;
  const machineContext = frozenTarget ? `Frozen target: ${frozenTarget.source.selectedMachineIds.map(id => {
    const machine = frozenTarget.field.machines.find(item => item.id === id);
    return machine?.configuration.name || frozenTarget.field.lateralMachines?.find(item => item.id === id)?.name || "Unavailable machine";
  }).join(", ") || "No machines"}`
    : selectedMachine ? `Selected machine: ${selectedMachine.configuration.name}` : selectedLateral ? `Selected machine: ${selectedLateral.name}` : null;
  const savedListName = !showingSession && state.editable?.identity.designId
    ? (repository.designCatalog ?? repository.catalog).designs.find(item => item.id === state.editable!.identity.designId)?.name : null;
  const receiver = controller.receiver.getSnapshot();
  const savePhase = mode === "layout" ? controller.layoutSaveState : state.savedState;
  const pendingIntent = mode === "layout"
    ? controller.pendingInput("layout-name") ? "Name awaiting Save" : controller.pendingInput("layout-label") ? "Label awaiting collection"
      : controller.pendingInput("layout-copy-name") ? "Copy name awaiting Copy" : null
    : controller.designInputsPending ? "Inputs awaiting Apply" : controller.pendingInput("manual-drawing") ? "Drawing unfinished"
      : controller.pendingInput("file-dialog") ? fileInputIntent === "copy" ? "Copy name awaiting Copy" : "Name awaiting Apply"
      : controller.pendingInput("survey-reference") ? "Reference details awaiting Apply"
      : controller.pendingInput("survey-label") ? "Label awaiting collection" : null;
  const saveStatus = mode === "layout" && !state.layout ? "No Layout session open"
    : !state.editable && !state.layout ? "No design open"
      : mode !== "layout" && state.editable && !state.editable.identity.designId ? workspaceEditableIsDirty(state.editable) ? "Unsaved changes — independent file" : "Independent file — associate with a field"
        : savePhase === "saving" ? "Saving…" : savePhase === "error" ? "Save needs attention"
          : pendingIntent ?? (savePhase === "saved" ? "Saved" : "Unsaved changes");
  const parentInteractionKey = mapInteractionKey ?? controller.interactionKey;
  const sceneOwner = { cameraContextKey: controller.cameraContextKey, interactionKey: JSON.stringify([parentInteractionKey, visibilityOwner.current.epoch]) };
  const surfaceOwnerRef = useRef(sceneOwner.interactionKey); surfaceOwnerRef.current = sceneOwner.interactionKey;
  function ownsEvent(event: { cameraContextKey: string; interactionKey: string }): boolean {
    const current = controller.stateRef.current;
    const currentInteraction = JSON.stringify([current.presentation.documentGeneration, current.presentation.interactionGeneration]);
    return mapVisible && visibilityOwner.current.visible && event.cameraContextKey === sceneOwner.cameraContextKey && event.interactionKey === sceneOwner.interactionKey
      && event.interactionKey === surfaceOwnerRef.current && event.cameraContextKey === workspaceMapContextKey(current.mapContext)
      && controller.interactionKey === currentInteraction && (isMapInteractionCurrent?.({ ...event, interactionKey: parentInteractionKey }) ?? true);
  }
  return <InputRetentionProvider store={controller.inputs}><View ref={rootRef} style={styles.root} testID="unified-workspace">
    <View style={[styles.header, compact && styles.compactHeader]} testID="workspace-common-header">
      <Text style={styles.brand}>CPLayout</Text>
      <View style={{ flex: 1 }}><Text style={styles.context} numberOfLines={compact ? 1 : 2} accessibilityLabel={completeContext || "Choose or create a customer, project and field"} testID="workspace-context">{(compact ? compactContext : completeContext) || "Choose or create a customer, project and field"}</Text>
        {machineContext && <Text style={styles.status} numberOfLines={compact ? 1 : 2} accessibilityLabel={machineContext} testID="workspace-selected-machine">{machineContext}</Text>}
        {savedListName && savedListName !== designName && <Text style={styles.status} numberOfLines={1} testID="workspace-saved-list-name">Saved list name: {savedListName}</Text>}
      </View>
      <Text accessibilityLiveRegion="polite" accessibilityLabel={`${mode === "layout" ? "Layout session" : "Design"}: ${saveStatus}${savePhase === "error" && pendingIntent ? `; ${pendingIntent}` : ""}`} style={styles.saved} testID="workspace-save-state">{saveStatus}</Text>
    </View>
    <View style={[styles.toolbar, compact && styles.compactToolbar]} testID="workspace-common-controls">
      <IconCommandButton id="workspace-projects" label="Customers & projects" icon={<FolderOpen />} showLabel={!compact} onPress={onOpenCatalog} />
      <View style={styles.modes} accessibilityLabel="Workspace mode" testID="workspace-mode-toggle">
        {modes.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.label} mode`}
          accessibilityState={{ selected: mode === item.id, disabled: item.id === "layout" && !state.layout && controller.surveyReadiness?.status !== "ready" }} disabled={item.id === "layout" && !state.layout && controller.surveyReadiness?.status !== "ready"} aria-pressed={mode === item.id}
          testID={`workspace-mode-${item.id}`} onPress={() => controller.selectMode(item.id)}
          style={[styles.mode, mode === item.id && styles.activeMode]}><Text style={[styles.modeText, mode === item.id && styles.activeText]}>{item.label}</Text></Pressable>)}
      </View>
      <IconCommandButton id="workspace-undo" label="Undo" icon={<Undo2 />} disabled={controller.busy || !controller.canUndo || mode === "layout"}
        onPress={() => { void controller.undo(); }} testID="workspace-undo" />
      <IconCommandButton id="workspace-redo" label="Redo" icon={<Redo2 />} disabled={controller.busy || !controller.canRedo || mode === "layout"}
        onPress={() => { void controller.redo(); }} testID="workspace-redo" />
      <IconCommandButton id="workspace-save" label="Save" icon={<Save />} showLabel={!compact}
        disabled={(mode === "layout" ? !state.layout : !state.editable?.identity.designId) || controller.busy || controller.saving}
        onPress={onSaveCurrentSubject} testID="workspace-save" />
      <CommandBar menus={[{ id: "workspace-file", label: "File", items: [...fileActions] }]} />
      <IconCommandButton id="workspace-receiver" label="Receiver" icon={<Radio />} showLabel={!compact} selected={receiverOpen}
        disabled={controller.recovery.hydrating} onPress={() => {
          if (!controller.recoveryParticipants.canEdit()) return; controller.noteUserIntent(); frameEpoch.current++;
          controller.recoveryParticipants.notifyChanged(); setReceiverOpen(value => !value);
        }} testID="workspace-receiver-toggle" />
      <IconCommandButton id="workspace-tools" label={toolsVisible ? "Hide tools" : "Show tools"} icon={<PanelLeft />} showLabel={!compact} selected={toolsVisible} disabled={!hasWorkingDocument}
        onPress={() => changeToolsVisibility(!toolsOpenRef.current)} testID="workspace-tools-toggle" />
    </View>
    {state.editable && state.editable.identity.projectCrs === null && <View style={{ padding: 10, backgroundColor: "#edf3ec", gap: 6 }} testID="workspace-coordinate-onboarding">
      <Text style={styles.status}>Choose the field coordinate system before drawing or collecting positions. No GPS is needed for Design.</Text>
      <WorkspaceSelect label="Choose field coordinate system" value="" disabled={controller.busy}
        choices={[{ id: "", label: "Choose the actual WGS84 UTM coordinate system…" }, ...["North", "South"].flatMap((hemisphere, h) => Array.from({ length: 60 }, (_, i) => ({ id: `EPSG:${(h === 0 ? 32600 : 32700) + i + 1}`, label: `WGS84 / UTM zone ${i + 1} ${hemisphere}` })))]}
        onChange={value => { if (value) void controller.declareCoordinateSystem(value); }} />
    </View>}
    <View style={styles.receiverStatus}>
      <Text style={styles.status} testID="workspace-receiver-summary">Receiver: {receiver.phase} · Data: {receiver.incomingData} · {receiver.receiverQuality?.fixType === "rtk_fixed" ? "RTK Fixed — receiver reported" : receiver.receiverQuality?.fixType?.replaceAll("_", " ") ?? "Fix unknown"}</Text>
      {controller.recovery.available && <Text style={styles.status} accessibilityLiveRegion="polite" testID="workspace-unfinished-status">
        {controller.recovery.hydrating ? "Unfinished work: restoring controls…" : controller.recovery.state.phase === "saving" ? "Unfinished work: checkpointing…"
          : controller.recovery.state.phase === "saved" ? "Unfinished work: checkpoint stored" : controller.recovery.state.phase === "error" ? "Unfinished work: checkpoint needs attention — File → Recover unfinished work" : "Unfinished work: local recovery available"}
      </Text>}
    </View>
    <View style={{ display: receiverOpen ? "flex" : "none", maxHeight: compact ? 260 : 210 }} testID="workspace-common-receiver">
      <ScrollView><ReceiverConnectionPanel recoveryParticipants={controller.recoveryParticipants} onUserIntent={controller.noteUserIntent} owner={controller.receiver} projectCrs={state.mapContext?.projectCrs ?? null} /></ScrollView>
    </View>
    {state.notice || repository.storageError ? <View style={styles.notice}><Text accessibilityRole="alert" style={styles.noticeText}>{state.notice ?? repository.storageError}</Text></View> : null}
    <View style={[styles.body, compact && styles.compactBody]} testID="workspace-working-area" onLayout={event => {
      const { width, height } = event.nativeEvent.layout;
      if (width > 0 && height > 0) setWorkingSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    }}>
      <View style={[styles.map, mapHidden ? { display: "none" } : null]} testID="workspace-map-owner">
        {scene ? <WorkspaceMapSurface scene={scene} settings={settings} {...sceneOwner} {...recoveryCamera} selectedAddress={state.selectedAddress} layerVisibility={layerVisibility}
          pointInputEnabled={mapVisible && mode === "design" && canDigitize && !controller.busy} selectionEnabled={mapVisible}
          onPoint={event => { if (ownsEvent(event) && mode === "design") onDesignPoint?.({ ...event, interactionKey: parentInteractionKey }); }}
          onSelect={event => { if (ownsEvent(event)) controller.selectAddress(event.address); }} />
          : <View style={styles.emptyMap}><Text style={styles.emptyTitle}>Your field workspace</Text><Text style={styles.emptyHelp}>Create or open a design to begin. Design, Survey and Layout share this map and the same file and receiver controls.</Text>
            <IconCommandButton id="workspace-empty-open" label="Customers & projects" icon={<FolderOpen />} showLabel onPress={onOpenCatalog} /></View>}
      </View>
      <View style={[styles.tools, compact && styles.dock, compact && { height: fullTools ? "100%" : dockHeight }, { display: toolsVisible ? "flex" : "none" }]} testID="workspace-mode-tools">
        {!compact && <View style={styles.toolsHeader}><Text style={styles.toolsTitle}>{modes.find(item => item.id === mode)?.label} tools</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close tools" onPress={() => changeToolsVisibility(false)} style={styles.close}><Text>Close</Text></Pressable></View>
        }
        {fullTools && <Text style={styles.status} testID="workspace-full-tools-note">Hide tools to return to the map in this short window.</Text>}
        {modes.map(item => <View key={item.id} style={{ flex: 1, minHeight: 0, display: mode === item.id ? "flex" : "none" }} testID={`workspace-panel-${item.id}`}>
          {item.id === "design" ? panels.design : <ScrollView style={styles.toolsScroll} contentContainerStyle={styles.toolsContent}>{panels[item.id]}</ScrollView>}
        </View>)}
      </View>
      {management}
    </View>
  </View></InputRetentionProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: "#f4f6f3" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderColor: "#d7dfd5", backgroundColor: "#fff" },
  compactHeader: { paddingVertical: 6, gap: 8, paddingHorizontal: 10 },
  brand: { fontSize: 20, fontWeight: "800", color: "#254234" }, context: { flex: 1, fontSize: 13, color: "#405344" }, saved: { fontSize: 12, color: "#405344" },
  toolbar: { position: "relative", zIndex: 20, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderColor: "#d7dfd5", backgroundColor: "#fff" },
  compactToolbar: { paddingVertical: 3, gap: 4 },
  modes: { flexDirection: "row", borderWidth: 1, borderColor: "#bacabb", borderRadius: 7, overflow: "hidden" },
  mode: { paddingHorizontal: 13, paddingVertical: 10, backgroundColor: "#f8faf7" }, activeMode: { backgroundColor: "#254234" }, modeText: { color: "#254234", fontSize: 13, fontWeight: "600" }, activeText: { color: "#fff" },
  receiverStatus: { paddingHorizontal: 14, paddingVertical: 5, backgroundColor: "#e9efe7" }, status: { fontSize: 12, color: "#405344" },
  notice: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff3df" }, noticeText: { fontSize: 13, color: "#793f20" },
  body: { flex: 1, minHeight: 0, flexDirection: "row", position: "relative", zIndex: 0 }, map: { flex: 1, minWidth: 0, minHeight: 0 },
  compactBody: { flexDirection: "column" },
  tools: { width: 350, minHeight: 0, borderLeftWidth: 1, borderColor: "#d7dfd5", backgroundColor: "#fff" }, dock: { width: "100%", borderLeftWidth: 0, borderTopWidth: 1 },
  toolsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: 1, borderColor: "#d7dfd5" }, toolsTitle: { fontSize: 15, fontWeight: "700", color: "#254234" }, close: { padding: 8 },
  toolsScroll: { flex: 1 }, toolsContent: { padding: 12, paddingBottom: 32 },
  emptyMap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 30 }, emptyTitle: { fontSize: 22, fontWeight: "700", color: "#254234" }, emptyHelp: { fontSize: 14, maxWidth: 440, textAlign: "center", color: "#607061", lineHeight: 21 },
});
