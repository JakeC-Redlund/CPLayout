import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { createCatalogId } from "@cplayout/project-store";
import { parseAppSettings, type ProjectMapFeature, type XY } from "@cplayout/core";
import { analyzeAdvisoryMultiMachineLayoutSteps, buildAdvisoryMachineRenderModelSteps, analyzeIdealPivotCenter, buildDesignScenarioPreview,
  evaluateAdvisoryCornerArm, planAdvisoryFieldPivotsSteps,
  type AdvisoryCostInput, type AdvisoryFieldPivotPlan, type DrawingLayerType, type DrawingMode, type PivotPlacementCandidate } from "@cplayout/geometry";
import { UTILITY_FEATURE_OPTIONS, withWorkspaceManualDrawing, type ManualDesignMapCapture, type ManualDesignMapCaptureRole,
  type WorkspaceMapPointEvent, type WorkspaceSceneLayer } from "@cplayout/map-adapters";
import { useAdvisoryJob } from "../advisory/useAdvisoryJob";
import { CommandMenuItemConfig } from "../components/CommandSurface";
import { type LocalIntentReceipt, useWorkspaceController } from "./useWorkspaceController";
import { UnifiedWorkspace } from "./UnifiedWorkspace";
import { UnifiedDesignPanel, type UnifiedDesignPanelHandle, type UnifiedDesignTask } from "./UnifiedDesignPanel";
import { EMPTY_CATALOG_SELECTION, WorkspaceCatalog } from "./WorkspaceCatalog";
import { generatedFieldPivotZoneFeature } from "./ProjectWorkspaceTools";
import { WorkspaceSurveyPanel, WorkspaceLayoutPanel, WorkspaceButton, WorkspaceSelect, type WorkspaceLayoutPanelHandle } from "./WorkspaceModePanels";
import { initialWorkspaceDrawingInteraction, prepareWorkspaceDrawingPoint, workspaceDrawingOwnerKey,
  workspaceDrawingPreview, workspaceDrawingSelectionForLegacyTool, type WorkspaceDrawingInteraction } from "./WorkspaceDrawingPanel";
import { useWorkspaceRecoveryParticipant } from "./workspaceRecoveryParticipants";
import { workspaceRecoveryStableJson } from "./workspaceEditRecovery";
import { resolveUnifiedWorkspaceResume } from "../navigation/unifiedWorkspaceResume";
import { WorkspaceRecoveryPanel } from "./WorkspaceRecoveryPanel";

/** Actual App composition: one controller, one common map, retained controlled
 * tools and a supporting catalog. There are no legacy whole-editor mounts. */
export function UnifiedWorkspaceEntry(): React.JSX.Element {
  const controller = useWorkspaceController();
  const { state } = controller, editable = state.editable;
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [currentFieldCreationRequest, setCurrentFieldCreationRequest] = useState<{
    id: number; context: { clientId: string; projectId: string; fieldMapId: string; designId: null };
    isCurrent(): boolean; acknowledge(): void;
  } | null>(null);
  const creationRequestSequence = useRef(0);
  const [nameFocusRequest, setNameFocusRequest] = useState<{ id: number; sourceGeneration: number; payloadId: string;
    intent: LocalIntentReceipt | null; inputRevision: number; focus: ReturnType<typeof controller.inputs.retainedFocus> } | null>(null);
  const nameRequestSequence = useRef(0);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const recoveryEntryEpoch = useRef(0), consumedRecovery = useRef<string | null>(null);
  const entryLatest = useRef({ controller, dialog: null as "copy" | "rename" | "preferences" | null,
    dialogText: "", savedCopyId: null as string | null, layerVisibility: {} as Partial<Record<WorkspaceSceneLayer, boolean>> });
  const catalogVisibleRef = useRef(false), catalogContextRef = useRef({ ...EMPTY_CATALOG_SELECTION });
  const consumedResume = useRef(0);
  function publishContext(intent: LocalIntentReceipt) {
    const current = controller.stateRef.current;
    controller.acceptLocalContext(intent, controller.createResumeSnapshot(catalogContextRef.current,
      !current.editable && !current.layout || catalogVisibleRef.current));
  }
  const [dialog, setDialog] = useState<"copy" | "rename" | "preferences" | null>(null);
  const [dialogText, setDialogText] = useState("");
  const fileNameInput = useRef<TextInput>(null);
  const dialogOwner = useRef({ generation: 0, inputEpoch: 0, sourceGeneration: -1,
    subjectKey: "", kind: null as typeof dialog, text: "", baseline: "" });
  const renderedDialogGeneration = dialogOwner.current.generation;
  const [savedCopyId, setSavedCopyId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<WorkspaceDrawingInteraction | null>(null);
  const drawingRef = useRef(drawing); drawingRef.current = drawing;
  const [manualRequest, setManualRequest] = useState<ManualDesignMapCaptureRole | null>(null);
  const [manualCapture, setManualCapture] = useState<(ManualDesignMapCapture & { sequence: number }) | null>(null);
  const manualSequence = useRef(0);
  const manualBoundary = useRef<XY[]>([]);
  const designPanelRef = useRef<UnifiedDesignPanelHandle>(null);
  const layoutPanelRef = useRef<WorkspaceLayoutPanelHandle>(null);
  const [toolsRevealRequest, setToolsRevealRequest] = useState(0);
  const [designTask, setDesignTask] = useState<UnifiedDesignTask>("drawing");
  const taskRef = useRef(designTask); taskRef.current = designTask;
  const mapEpochRef = useRef(0), [mapEpoch, setMapEpoch] = useState(0);
  const surfaceInteractionKey = JSON.stringify([controller.interactionKey, mapEpoch]);
  const surfaceOwnerRef = useRef(surfaceInteractionKey); surfaceOwnerRef.current = surfaceInteractionKey;
  const [layerVisibility, setLayerVisibility] = useState<Partial<Record<WorkspaceSceneLayer, boolean>>>({});
  entryLatest.current = { controller, dialog, dialogText, savedCopyId, layerVisibility };
  const [advisoryInputs, setAdvisoryInputs] = useState<{ costInput: AdvisoryCostInput | undefined; requestedFieldPivots: number }>({ costInput: undefined, requestedFieldPivots: 1 });
  const sourceGeneration = state.presentation.documentGeneration;
  const subjectKey = JSON.stringify([state.presentation.mode === "layout" ? "layout" : "design",
    state.presentation.mode === "layout" ? state.layout?.session.id : editable?.identity.payloadId, sourceGeneration]);
  const interactionKey = controller.interactionKey;
  function currentInteraction(): boolean {
    if (!controller.recoveryParticipants.canEdit()) return false;
    const presentation = controller.stateRef.current.presentation;
    return interactionKey === JSON.stringify([presentation.documentGeneration, presentation.interactionGeneration]);
  }
  useEffect(() => {
    const current = controller.stateRef.current.editable;
    const next = current ? initialWorkspaceDrawingInteraction(current) : null;
    drawingRef.current = next; setDrawing(next);
    setManualRequest(null); setManualCapture(null); setSavedCopyId(null);
    setCurrentFieldCreationRequest(null); setNameFocusRequest(null);
    catalogVisibleRef.current = false; setCatalogOpen(false);
    const task = current?.kind === "field" ? "machines" : current?.kind === "project" ? "inputs" : "drawing";
    taskRef.current = task; setDesignTask(task);
    dialogOwner.current = { ...dialogOwner.current, generation: dialogOwner.current.generation + 1, sourceGeneration,
      kind: null, text: "", baseline: "" };
    setDialog(null); setDialogText("");
    manualBoundary.current = [];
    setAdvisoryInputs({ costInput: undefined, requestedFieldPivots: 1 });
  }, [sourceGeneration]);
  useEffect(() => {
    if (controller.repository.backendInfo) void controller.restoreStartupContext();
  }, [controller.repository.backendInfo?.runtime, controller.repository.catalogRevision]);
  useEffect(() => {
    const delivery = controller.resumeDelivery;
    if (!delivery || consumedResume.current === delivery.generation || !controller.isResumeDeliveryCurrent(delivery)) return;
    consumedResume.current = delivery.generation; catalogContextRef.current = { ...delivery.catalogSelection };
    catalogVisibleRef.current = delivery.catalogVisible; setCatalogOpen(delivery.catalogVisible);
  }, [controller.resumeDelivery, sourceGeneration]);
  useEffect(() => {
    const accepted = controller.getAcceptedContextTransition();
    if (!accepted) return;
    const snapshot = controller.createResumeSnapshot(catalogContextRef.current, catalogVisibleRef.current
      || !controller.stateRef.current.editable && !controller.stateRef.current.layout);
    if (JSON.stringify(snapshot.workspace) === JSON.stringify(accepted.workspace)) controller.acceptLocalContext(accepted.intent, snapshot);
  }, [controller.acceptedContextSequence, controller.repository.catalogRevision]);
  useEffect(() => controller.recoveryParticipants.registerContextCapture(() => ({
    catalogSelection: { ...catalogContextRef.current }, catalogVisible: catalogVisibleRef.current
      || !controller.stateRef.current.editable && !controller.stateRef.current.layout })), [controller.recoveryParticipants]);
  useWorkspaceRecoveryParticipant(controller.recoveryParticipants, "entry", {
    capture() {
      const actual = entryLatest.current;
      // Field has no manual drawing reducer/tool. Its empty presentation
      // placeholder cannot become a recoverable pending drawing owner.
      const drawing = actual.controller.stateRef.current.editable?.kind === "field" ? null : drawingRef.current;
      return { entry: { designTask: taskRef.current, drawing: drawing ? {
        geometryType: drawing.geometryType, vertices: drawing.vertices, vertexRecordedAt: drawing.vertexRecordedAt,
        stage: drawing.stage, selectionId: drawing.selectionId, name: drawing.name, notes: drawing.notes,
        detailsOpen: drawing.detailsOpen, choicesOpen: drawing.choicesOpen, error: drawing.error,
        replacing: drawing.replacing, captureId: drawing.captureId, paused: drawing.paused ?? false } : null,
        layerVisibility: Object.entries(actual.layerVisibility).map(([layer, visible]) => ({ layer: layer as WorkspaceSceneLayer, visible: visible! })) },
        file: { dialog: actual.dialog, text: dialogOwner.current.text, baseline: dialogOwner.current.baseline, savedCopyId: actual.savedCopyId } };
    },
    stage(value, target) {
      const epoch = recoveryEntryEpoch.current, oldGeneration = controller.stateRef.current.presentation.documentGeneration;
      const inputOwner = controller.recoveryParticipants.getInputOwner();
      const admitted = target.admission.editable;
      if (admitted && (admitted.kind === "field" ? !["machines", "review"].includes(value.entry.designTask) : value.entry.designTask === "machines"))
        throw new Error("The recovered Design page is not available for this document kind.");
      if (value.entry.drawing && !admitted) throw new Error("A recovered drawing needs its actual editable document.");
      const raw = workspaceRecoveryStableJson(value), detached = JSON.parse(raw) as typeof value;
      return { isCurrent: () => recoveryEntryEpoch.current === epoch
        && controller.stateRef.current.presentation.documentGeneration === oldGeneration
        && controller.recoveryParticipants.getInputOwner() === inputOwner,
        consume(delivery) {
          const actual = entryLatest.current.controller;
          if (!delivery.isCurrent() || delivery.target !== target
            || actual.stateRef.current.presentation.documentGeneration !== target.documentGeneration) throw new Error("The drawing and File recovery delivery retired.");
          const interaction = admitted && detached.entry.drawing ? { ...detached.entry.drawing, ownerKey: workspaceDrawingOwnerKey(admitted) } : null;
          drawingRef.current = interaction; setDrawing(interaction); taskRef.current = detached.entry.designTask; setDesignTask(detached.entry.designTask);
          const layers = Object.fromEntries(detached.entry.layerVisibility.map(item => [item.layer, item.visible])); setLayerVisibility(layers);
          setManualRequest(null); setManualCapture(null); manualBoundary.current = []; retireMapInteraction();
          const context = resolveUnifiedWorkspaceResume(target.admission.staged.context, target.workspace);
          catalogContextRef.current = { ...context.catalogSelection }; catalogVisibleRef.current = context.catalogVisible; setCatalogOpen(context.catalogVisible);
          const nextSubject = JSON.stringify([actual.stateRef.current.presentation.mode === "layout" ? "layout" : "design",
            actual.stateRef.current.presentation.mode === "layout" ? actual.stateRef.current.layout?.session.id : admitted?.identity.payloadId, target.documentGeneration]);
          dialogOwner.current = { generation: dialogOwner.current.generation + 1, inputEpoch: 0, sourceGeneration: target.documentGeneration,
            subjectKey: nextSubject, kind: detached.file.dialog, text: detached.file.text, baseline: detached.file.baseline };
          setDialog(detached.file.dialog); setDialogText(detached.file.text); setSavedCopyId(detached.file.savedCopyId);
          actual.setPendingInteractionInput("file-dialog", detached.file.dialog !== null && detached.file.dialog !== "preferences" && detached.file.text !== detached.file.baseline);
          actual.setPendingInteractionInput("manual-drawing", !!interaction && (admitted?.kind === "project" && interaction.vertices.length > 0 || !!interaction.name || !!interaction.notes));
        } };
    },
  });
  useEffect(() => {
    const delivery = controller.recovery.delivery;
    if (!delivery || consumedRecovery.current === delivery.id) return;
    consumedRecovery.current = delivery.id;
    void delivery.consume().catch(() => undefined); // The owner rolls back and reports delivery errors.
  }, [controller.recovery.delivery, sourceGeneration]);
  useEffect(() => {
    const delivery = controller.recovery.delivery;
    if (delivery?.awaitingInputRevision !== null && delivery) delivery.acknowledgeInputs(controller.inputRevision);
  }, [controller.recovery.delivery, controller.inputRevision, sourceGeneration]);
  useEffect(() => {
    if (controller.recovery.hydrating || recoveryOpen) return;
    const focus = controller.inputs.retainedFocus();
    if (focus?.key === "file/name" && (dialog === "copy" || dialog === "rename")) {
      const node = fileNameInput.current as unknown as HTMLInputElement | null;
      if (!node?.isConnected || !node.getClientRects().length || node.disabled) return;
      node.focus({ preventScroll: true });
      if (focus.selection) node.setSelectionRange(Math.min(focus.selection.start, dialogText.length), Math.min(focus.selection.end, dialogText.length));
    } else if (state.presentation.mode === "design") designPanelRef.current?.restoreRetainedFocus();
  }, [controller.recovery.hydrating, recoveryOpen, dialog, sourceGeneration]);
  function changeDrawing(next: WorkspaceDrawingInteraction) {
    if (!currentInteraction() || !editable || next.ownerKey !== workspaceDrawingOwnerKey(editable)) return;
    recoveryEntryEpoch.current++; controller.recoveryParticipants.notifyChanged(); drawingRef.current = next; setDrawing(next);
    controller.setPendingInteractionInput("manual-drawing", editable.kind === "project" && next.vertices.length > 0 || !!next.name || !!next.notes, true);
  }
  function retireMapInteraction() {
    const epoch = ++mapEpochRef.current;
    surfaceOwnerRef.current = JSON.stringify([controller.interactionKey, epoch]);
    setMapEpoch(epoch);
  }
  function requestDesignTask(task: UnifiedDesignTask): boolean {
    if (!controller.recoveryParticipants.canEdit()) return false;
    controller.noteUserIntent();
    if (!currentInteraction() || !editable || (editable.kind === "field" ? task !== "machines" && task !== "review" : task === "machines")) return false;
    if (taskRef.current === task) return true;
    // Presentation suspends capture; it never changes pending vertices, document
    // revision/history, accepted Save ownership or the receiver connection.
    recoveryEntryEpoch.current++; controller.recoveryParticipants.notifyChanged(); taskRef.current = task; setDesignTask(task); retireMapInteraction(); setManualRequest(null);
    return true;
  }
  const effectiveDrawing = editable && drawing?.ownerKey === workspaceDrawingOwnerKey(editable) ? drawing : editable ? initialWorkspaceDrawingInteraction(editable) : null;
  function onPoint(event: WorkspaceMapPointEvent) {
    controller.noteUserIntent();
    const current = controller.stateRef.current.editable;
    if (!currentInteraction() || event.interactionKey !== surfaceOwnerRef.current || !current || controller.stateRef.current.presentation.mode !== "design"
      || !manualRequest && taskRef.current !== "drawing") return;
    try {
      if (manualRequest && current.kind === "project") {
        const requestId = ++manualSequence.current;
        if (manualRequest === "boundary") {
          manualBoundary.current = [...manualBoundary.current, { ...event.point }];
          setManualCapture({ role: manualRequest, vertices: [...manualBoundary.current], requestId, sequence: requestId });
        } else setManualCapture({ role: manualRequest, point: { ...event.point }, requestId, sequence: requestId });
        if (manualRequest !== "boundary") { retireMapInteraction(); setManualRequest(null); }
        return;
      }
      const capture = drawingRef.current?.ownerKey === workspaceDrawingOwnerKey(current) ? drawingRef.current : initialWorkspaceDrawingInteraction(current);
      const prepared = prepareWorkspaceDrawingPoint(current, capture, { ...event.point }, createCatalogId("drawing"), new Date().toISOString());
      if (!prepared.actions.length || controller.dispatchBatch(prepared.actions)) changeDrawing(prepared.interaction);
    } catch (error) { controller.reportError(error); }
  }
  function legacyTool(mode: DrawingMode, layer: DrawingLayerType, featureKind?: ProjectMapFeature["kind"]) {
    if (!currentInteraction() || !editable || !effectiveDrawing) return;
    if (!requestDesignTask("drawing")) return;
    const option = featureKind ? UTILITY_FEATURE_OPTIONS.find(item => item.kind === featureKind) : undefined;
    const geometryType = mode === "draw_boundary" || mode === "mark_obstacle" ? "Polygon" : mode === "place_pivot" ? "Point" : option?.geometry ?? "LineString";
    changeDrawing({ ...initialWorkspaceDrawingInteraction(editable, false), geometryType,
      selectionId: workspaceDrawingSelectionForLegacyTool(editable, geometryType, layer, featureKind) });
  }
  const displayScene = useMemo(() => {
    const scene = controller.scene;
    if (!scene || !editable || editable.kind !== "project" || !effectiveDrawing || scene.identity.documentKind !== "project") return scene;
    try { return withWorkspaceManualDrawing(scene, workspaceDrawingPreview(editable, effectiveDrawing)); }
    catch { return scene; }
  }, [controller.scene, editable, effectiveDrawing]);
  const project = editable?.kind === "project" ? editable.editor.project : null;
  const currentCalculation = project && controller.calculation?.kind === "project" && controller.calculation.documentId === project.id
    && controller.calculation.inputRevision === editable?.editor.revision;
  const calculateAdvisory = !!currentCalculation && state.presentation.mode === "design";
  const fieldRequest = useMemo(() => ({ create: () => {
    if (!project) throw new Error("Open an actual Project before calculating advisory machine choices.");
    return planAdvisoryFieldPivotsSteps(project, { gridDivisions: 6, maxMachines: advisoryInputs.requestedFieldPivots,
      candidatePoolSize: 24, collisionBufferMeters: project.machine.machineClearanceBufferMeters, costInput: advisoryInputs.costInput });
  } }), [project, sourceGeneration, advisoryInputs]);
  const renderRequest = useMemo(() => ({ create: () => {
    if (!project) throw new Error("No actual Project is open.");
    return buildAdvisoryMachineRenderModelSteps(project, { maxInstances: 2 });
  } }), [project, sourceGeneration]);
  const multiRequest = useMemo(() => ({ create: () => {
    if (!project) throw new Error("No actual Project is open.");
    return analyzeAdvisoryMultiMachineLayoutSteps(project, { maxCandidates: 3, collisionBufferMeters: project.machine.machineClearanceBufferMeters });
  } }), [project, sourceGeneration]);
  const fieldJob = useAdvisoryJob(fieldRequest, calculateAdvisory);
  const renderJob = useAdvisoryJob(renderRequest, calculateAdvisory);
  const multiJob = useAdvisoryJob(multiRequest, calculateAdvisory);
  const analysisRequest = useMemo(() => ({ create: function* () {
    if (!project) throw new Error("No actual Project is open.");
    yield;
    return analyzeIdealPivotCenter(project, { maxCandidates: 4, costInput: advisoryInputs.costInput,
      minimumBoundaryClearanceMeters: controller.settings.layoutReview.requiredBoundaryClearanceMeters });
  } }), [project, sourceGeneration, advisoryInputs, controller.settings.layoutReview.requiredBoundaryClearanceMeters]);
  const scenarioRequest = useMemo(() => ({ create: function* () {
    if (!project) throw new Error("No actual Project is open.");
    yield;
    return buildDesignScenarioPreview(project, { maxOptimizedCandidates: 3 });
  } }), [project, sourceGeneration]);
  const analysisJob = useAdvisoryJob(analysisRequest, calculateAdvisory);
  const scenarioJob = useAdvisoryJob(scenarioRequest, calculateAdvisory);
  const cornerEvaluation = useMemo(() => project && currentCalculation ? evaluateAdvisoryCornerArm(project) : null, [project, currentCalculation]);
  const updateAdvisoryInputs = useCallback((inputs: typeof advisoryInputs) => setAdvisoryInputs(previous =>
    JSON.stringify(previous) === JSON.stringify(inputs) ? previous : inputs), []);
  function adoptPivot(candidate: PivotPlacementCandidate) {
    const current = controller.stateRef.current.editable;
    if (controller.inputs.hasDirty()) { controller.reportError(new Error("Apply or discard your entered inputs before adopting a proposed location.")); return; }
    if (!currentInteraction() || !project || !currentCalculation || current?.editor.revision !== editable?.editor.revision
      || analysisJob.status !== "ready" || !analysisJob.value.candidates.includes(candidate)) { controller.reportError(new Error("This placement belongs to an earlier calculation. Recalculate and review the current design.")); return; }
    controller.dispatch({ kind: "project", action: { type: "place_pivot", point: candidate.pivotCenter } });
  }
  function keepZones(plan: AdvisoryFieldPivotPlan) {
    if (!currentInteraction() || !project) return;
    try {
      if (controller.inputs.hasDirty()) throw new Error("Apply or discard your entered inputs before saving generated coverage zones.");
      if (controller.stateRef.current.editable?.editor.revision !== editable?.editor.revision) throw new Error("The design changed. Calculate and review its current coverage zones.");
      if (fieldJob.status !== "ready" || fieldJob.value !== plan || !currentCalculation) throw new Error("The generated review changed. Calculate and review the current plan before saving it.");
      const features = plan.candidates.map(candidate => generatedFieldPivotZoneFeature(project, candidate));
      controller.dispatch({ kind: "project", action: { type: "upsert_map_features", features } });
    } catch (error) { controller.reportError(error); }
  }
  function run(operation: () => Promise<unknown>) { void operation().catch(controller.reportError); }
  function showCatalog() { const intent = controller.noteUserIntent(); if (currentInteraction()) { retireMapInteraction(); catalogVisibleRef.current = true; setCatalogOpen(true); publishContext(intent); } }
  function hideCatalog() { const intent = controller.noteUserIntent(); if (currentInteraction()) { retireMapInteraction(); catalogVisibleRef.current = false; setCatalogOpen(false); publishContext(intent); } }
  function finishCatalog(intent?: LocalIntentReceipt) {
    if (!currentInteraction() || intent && controller.getLocalIntentReceipt() !== intent) return;
    retireMapInteraction(); catalogVisibleRef.current = false; setCatalogOpen(false);
    if (intent) publishContext(intent);
  }
  function openDialog(kind: typeof dialog) {
    controller.noteUserIntent();
    if (!currentInteraction()) return;
    if (kind === "rename" && editable && editable.kind !== "project") {
      if (dialog !== null) { controller.reportError(new Error("Finish or close the retained File dialog before using the design name input.")); return; }
      controller.selectMode("design"); retireMapInteraction(); setToolsRevealRequest(value => value + 1);
      setNameFocusRequest({ id: ++nameRequestSequence.current, sourceGeneration, payloadId: editable.identity.payloadId,
        intent: controller.getLocalIntentReceipt(), inputRevision: controller.inputs.getRevision(), focus: controller.inputs.retainedFocus() });
      return;
    }
    if (kind === "rename" && state.presentation.mode === "survey") controller.selectMode("design");
    retireMapInteraction();
    const text = kind === "rename" ? editable?.kind === "draft" ? editable.editor.draft.name : editable?.kind === "field" ? editable.editor.field.name : project?.name ?? "" : "";
    dialogOwner.current = { generation: dialogOwner.current.generation + 1, inputEpoch: 0, sourceGeneration, subjectKey, kind, text, baseline: text };
    setDialogText(text);
    setDialog(kind);
    controller.setPendingInteractionInput("file-dialog", false);
  }
  useEffect(() => {
    const request = nameFocusRequest;
    if (!request || state.presentation.mode !== "design") return;
    const ownsRequest = () => controller.recoveryParticipants.canEdit()
      && controller.stateRef.current.presentation.documentGeneration === request.sourceGeneration
      && controller.stateRef.current.editable?.identity.payloadId === request.payloadId
      && controller.getLocalIntentReceipt() === request.intent
      && controller.inputs.getRevision() === request.inputRevision && controller.inputs.retainedFocus() === request.focus;
    if (!ownsRequest() || controller.busy || dialog !== null || catalogOpen) { setNameFocusRequest(null); return; }
    const accepted = designPanelRef.current?.requestDesignNameFocus(ownsRequest);
    // Revealing the retained task creates its own operator intent. Carry only
    // that synchronous request's accepted token; later events still retire it.
    request.intent = controller.getLocalIntentReceipt();
    setNameFocusRequest(null);
    if (!accepted) controller.reportError(new Error("Open the current Design tools before editing its name."));
  }, [nameFocusRequest, state.presentation.mode, sourceGeneration, controller.busy, dialog, catalogOpen]);
  function createInCurrentField() {
    if (!currentInteraction() || controller.busy || dialog !== null) return;
    const before = controller.stateRef.current, mode = before.presentation.mode;
    const fieldMapId = mode === "layout" ? before.layout?.session.fieldMapId : before.editable?.identity.fieldMapId;
    const catalog = controller.repository.catalog, field = catalog.fieldMaps.find(item => item.id === fieldMapId);
    const project = catalog.projects.find(item => item.id === field?.projectId), customer = catalog.clients.find(item => item.id === project?.clientId);
    if (!field || !project || !customer) { controller.reportError(new Error("Open a saved design or Layout session associated with a field before creating a design in that field.")); return; }
    const intent = controller.noteUserIntent(); retireMapInteraction(); catalogVisibleRef.current = true; setCatalogOpen(true);
    const id = ++creationRequestSequence.current, generation = before.presentation.documentGeneration;
    const context = { clientId: customer.id, projectId: project.id, fieldMapId: field.id, designId: null };
    const fingerprint = JSON.stringify([customer, project, field]);
    setCurrentFieldCreationRequest({ id, context,
      isCurrent: () => {
        const actual = entryLatest.current.controller, current = actual.stateRef.current, latest = actual.repository.catalog;
        const ownedFieldId = current.presentation.mode === "layout" ? current.layout?.session.fieldMapId : current.editable?.identity.fieldMapId;
        return actual.recoveryParticipants.canEdit() && actual.getLocalIntentReceipt() === intent
          && current.presentation.documentGeneration === generation && current.presentation.mode === mode
          && ownedFieldId === field.id && creationRequestSequence.current === id && catalogVisibleRef.current
          && JSON.stringify([latest.clients.find(item => item.id === customer.id), latest.projects.find(item => item.id === project.id), latest.fieldMaps.find(item => item.id === field.id)]) === fingerprint;
      }, acknowledge: () => { setCurrentFieldCreationRequest(current => current?.id === id ? null : current); } });
  }
  function closeDialog() {
    controller.noteUserIntent();
    finishDialog();
  }
  function finishDialog() {
    if (!currentInteraction() || dialogOwner.current.generation !== renderedDialogGeneration) return;
    retireMapInteraction();
    dialogOwner.current = { ...dialogOwner.current, generation: dialogOwner.current.generation + 1, kind: null };
    setDialog(null); controller.setPendingInteractionInput("file-dialog", false);
  }
  function changeDialogText(value: string) {
    controller.noteUserIntent();
    const owner = dialogOwner.current;
    if (!currentInteraction() || owner.generation !== renderedDialogGeneration || owner.kind !== dialog || owner.sourceGeneration !== sourceGeneration || owner.subjectKey !== subjectKey) return;
    recoveryEntryEpoch.current++; controller.recoveryParticipants.notifyChanged();
    dialogOwner.current = { ...owner, inputEpoch: owner.inputEpoch + 1, text: value };
    setDialogText(value); controller.setPendingInteractionInput("file-dialog", value !== owner.baseline, true);
  }
  async function saveDialog() {
    const submitted = dialogOwner.current;
    if (!currentInteraction() || submitted.generation !== renderedDialogGeneration || submitted.kind !== dialog || submitted.sourceGeneration !== sourceGeneration || submitted.subjectKey !== subjectKey) return;
    function ownsSubmittedInput() {
      const current = dialogOwner.current;
      return controller.stateRef.current.presentation.documentGeneration === submitted.sourceGeneration
        && current.generation === submitted.generation && current.inputEpoch === submitted.inputEpoch
        && current.kind === submitted.kind && current.text === submitted.text;
    }
    if (submitted.kind === "copy") {
      const pending = controller.copyDesign(submitted.text);
      const intent = controller.getLocalIntentReceipt();
      const id = await pending;
      if (id && controller.stateRef.current.presentation.documentGeneration === submitted.sourceGeneration) {
        setSavedCopyId(id);
        if (ownsSubmittedInput() && intent && controller.getLocalIntentReceipt() === intent) finishDialog();
      }
    } else if (submitted.kind === "rename" && editable && submitted.text.trim()) {
      const action = { type: "rename" as const, name: submitted.text };
      const accepted = editable.kind === "draft" ? controller.dispatch({ kind: "draft", action })
        : editable.kind === "field" ? controller.dispatch({ kind: "field", action }) : controller.dispatch({ kind: "project", action });
      if (accepted && ownsSubmittedInput()) finishDialog();
    }
  }
  useEffect(() => {
    if (!dialog || dialog === "preferences" || dialogOwner.current.subjectKey === subjectKey) return;
    // A File dialog's unfinished text belongs to its source. Do not discard it
    // or apply it to a different subject; the original dialog returns with it.
    controller.reportError(new Error("This File dialog belongs to the retained design. Return to Design or Survey to finish or close it."));
  }, [subjectKey]);
  function showLayoutDetails(section: "name" | "copy") {
    if (!currentInteraction() || state.presentation.mode !== "layout" || !state.layout) return;
    setToolsRevealRequest(value => value + 1); layoutPanelRef.current?.showDetails(section);
  }
  const subjectFileActions: CommandMenuItemConfig[] = state.presentation.mode === "layout" ? [
    { id: "rename-layout", label: "Rename current Layout session", disabled: !state.layout || controller.busy, onPress: () => showLayoutDetails("name") },
    { id: "copy-layout", label: "Copy target into an empty session", disabled: !state.layout || controller.busy, onPress: () => showLayoutDetails("copy") },
    { id: "export-layout-zip", label: "Export Layout session & saved observations (ZIP)", disabled: !state.layout || controller.busy, onPress: () => run(() => controller.exportLayoutSession("zip")) },
    { id: "export-layout-json", label: "Export Layout session & saved observations (JSON)", disabled: !state.layout || controller.busy, onPress: () => run(() => controller.exportLayoutSession("json")) },
    { id: "close-layout", label: "Close current Layout session", disabled: !state.layout || controller.busy, onPress: () => { controller.closeLayout(); } },
  ] : [
    { id: "rename-design", label: "Rename current design", disabled: !editable || controller.busy, onPress: () => openDialog("rename") },
    { id: "copy-design", label: "Copy complete design workspace", disabled: !editable?.identity.designId || controller.busy, onPress: () => openDialog("copy") },
    { id: "reopen-design", label: "Reload saved design", disabled: !editable?.identity.designId || controller.busy, onPress: () => { if (editable?.identity.designId) run(() => controller.openDesign(editable.identity.designId!, true)); } },
    { id: "export-design-zip", label: "Export complete design workspace (ZIP)", disabled: !editable?.identity.designId || controller.busy, onPress: () => run(() => controller.exportDesignWorkspace("zip")) },
    { id: "export-design-json", label: "Export complete design workspace (JSON)", disabled: !editable?.identity.designId || controller.busy, onPress: () => run(() => controller.exportDesignWorkspace("json")) },
    { id: "close-design", label: "Close current design", disabled: !editable || controller.busy, onPress: () => { controller.closeDesign(); } },
  ];
  const fileActions: CommandMenuItemConfig[] = [
    { id: "new-design-current-field", label: "New design in current field…", disabled: controller.busy
      || !(state.presentation.mode === "layout" ? state.layout?.session.fieldMapId : editable?.identity.fieldMapId), onPress: createInCurrentField },
    ...subjectFileActions,
    { id: "unfinished-work", label: "Recover unfinished work", disabled: controller.busy, onPress: () => {
      if (!controller.recoveryParticipants.canEdit()) return; controller.noteUserIntent(); setRecoveryOpen(true); void controller.recovery.owner.refresh(); } },
    { id: "workspace-recovery", label: "Export workspace recovery", disabled: !controller.repository.canExportWorkspaceRecovery, onPress: controller.repository.exportWorkspaceRecovery },
    { id: "preferences", label: "Units, map & layer preferences", onPress: () => openDialog("preferences") },
  ];
  const activeDesignTask = editable?.kind === "field" ? designTask === "review" ? "review" : "machines" : designTask === "machines" ? "drawing" : designTask;
  const canDigitize = !catalogOpen && dialog === null && (!!manualRequest || activeDesignTask === "drawing" && !!effectiveDrawing?.geometryType && !effectiveDrawing.paused && effectiveDrawing.stage === "drawing" && editable?.kind !== "field");
  const catalogPending = useCallback((pending: { dirty: boolean; busy: boolean }) => controller.setPendingInteractionInput("catalog", pending.dirty || pending.busy), [controller.setPendingInteractionInput]);
  return <UnifiedWorkspace controller={controller} displayScene={displayScene} layerVisibility={layerVisibility} canDigitize={canDigitize} onDesignPoint={onPoint}
    fileInputIntent={dialog === "copy" || dialog === "rename" ? dialog : null} toolsRevealRequest={toolsRevealRequest} onSaveCurrentSubject={() => {
      if (!currentInteraction()) return;
      if (state.presentation.mode === "layout") { void layoutPanelRef.current?.save(); }
      else { void controller.save(); }
    }}
    mapInteractionKey={surfaceInteractionKey}
    isMapInteractionCurrent={event => event.interactionKey === surfaceOwnerRef.current}
    onRestoreDesignFocus={() => designPanelRef.current?.restoreRetainedFocus() ?? false}
    onOpenCatalog={showCatalog} fileActions={fileActions}
    panels={{
      design: <View style={[styles.panel, { flex: 1, minHeight: 0 }]}>
        <UnifiedDesignPanel ref={designPanelRef} editable={editable} settings={controller.settings} dispatch={controller.dispatch} dispatchBatch={controller.dispatchBatch}
          activeTask={activeDesignTask} onRequestTaskChange={requestDesignTask}
          sourceGeneration={sourceGeneration}
          disabled={controller.busy || state.presentation.mode !== "design" || catalogOpen || dialog !== null} drawingInteraction={effectiveDrawing} onDrawingInteractionChange={changeDrawing}
          createEntityId={() => createCatalogId("entity")} onCalculate={() => run(controller.calculate)} calculation={controller.calculation}
          onCompleteDesign={() => run(controller.completeDesign)} savedCompleteDesignId={controller.savedCompleteDesignId}
          onOpenCompleteDesign={id => run(() => controller.openDesign(id))} onCreateFieldFromProject={() => run(controller.createFieldFromProject)}
          project={{ onSettingsChange: settings => controller.setSettings(parseAppSettings(settings)), onActivateTool: legacyTool,
            onOpenSurvey: () => controller.selectMode("survey"), mapCapture: manualCapture, onRequestMapCapture: role => {
              if (!currentInteraction() || taskRef.current !== "inputs") return;
              manualBoundary.current = []; retireMapInteraction(); setManualRequest(role);
            },
            onRequestApplyPivotCandidate: adoptPivot, onSaveGeneratedFieldPivotZones: keepZones, cornerEvaluation,
            onAdvisoryInputsChange: updateAdvisoryInputs,
            advisory: { fieldPivotPlan: fieldJob.status === "ready" ? fieldJob.value : null, advisoryMachineRenderModel: renderJob.status === "ready" ? renderJob.value : null,
              multiMachineReview: multiJob.status === "ready" ? multiJob.value : null,
              idealCenterAnalysis: analysisJob.status === "ready" ? analysisJob.value : null,
              placementCandidates: analysisJob.status === "ready" ? analysisJob.value.candidates : null,
              preview: scenarioJob.status === "ready" ? scenarioJob.value : null } }} />
        {savedCopyId && <WorkspaceButton label="Open saved design copy" onPress={() => run(() => controller.openDesign(savedCopyId))} />}
      </View>,
      survey: <WorkspaceSurveyPanel controller={controller} />,
      layout: <WorkspaceLayoutPanel ref={layoutPanelRef} controller={controller} />,
    }} management={<>
      <WorkspaceCatalog repository={controller.repository} activeContext={editable?.identity ?? null} activeLayoutFieldMapId={state.layout?.session.fieldMapId}
        currentFieldCreationRequest={currentFieldCreationRequest}
        recoveryParticipants={controller.recoveryParticipants}
        visible={(!editable && !state.layout) || catalogOpen} presentation={editable || state.layout ? "dialog" : "embedded"} busy={controller.busy || controller.saving}
        onUserIntent={controller.noteUserIntent} getLocalIntentReceipt={controller.getLocalIntentReceipt}
        onSelectionChange={(context, intent) => { catalogContextRef.current = { ...context }; if (intent) publishContext(intent); }}
        resumeSelection={controller.resumeDelivery ? { generation: controller.resumeDelivery.generation,
          context: controller.resumeDelivery.catalogSelection, isCurrent: () => controller.isResumeDeliveryCurrent(controller.resumeDelivery!) } : null}
        onPendingStateChange={catalogPending} executeCatalog={controller.executeCatalog} openDesign={controller.openDesign}
        closeDesign={() => controller.closeDesign({ ignorePendingInputKeys: ["catalog"] })} closeLayout={() => controller.closeLayout({ ignorePendingInputKeys: ["catalog"] })}
        importDesignWorkspace={controller.importDesignWorkspace} preparePackageStorageStep={controller.preparePackageStorageStep}
        onOpenLayoutCatalog={() => { hideCatalog(); controller.selectMode("layout"); }} onClose={finishCatalog} />
      <Modal visible={dialog !== null} transparent onRequestClose={closeDialog}>
        <View style={styles.backdrop}><View style={styles.dialog}><ScrollView contentContainerStyle={styles.panel}>
          <Text style={styles.heading}>{dialog === "preferences" ? "Workspace preferences" : dialog === "rename" ? "Rename design" : "Copy design workspace"}</Text>
          {dialog === "preferences" ? <>
            <WorkspaceSelect label="Measurements" value={controller.settings.unitSystem} choices={[{ id: "us_survey_feet", label: "Feet & acres" }, { id: "metric", label: "Metres & hectares" }]}
              onChange={unitSystem => controller.setSettings(parseAppSettings({ ...controller.settings, unitSystem }))} />
            <WorkspaceSelect label="Map style" value={controller.settings.mapStyle} choices={[{ id: "field_light", label: "Field map" }, { id: "high_contrast", label: "High contrast" }, { id: "topographic", label: "Topographic" }, { id: "imagery_package", label: "Imagery" }]}
              onChange={mapStyle => controller.setSettings(parseAppSettings({ ...controller.settings, mapStyle }))} />
            <Text style={styles.label}>Map layers</Text>{(["boundary", "machine", "map_feature", "obstacle", "saved_survey", "manual_capture", "survey_capture", "layout_observation", "receiver"] as const).map(layer =>
              <WorkspaceButton key={layer} disabled={controller.recovery.hydrating} label={`${layerVisibility[layer] === false ? "Show" : "Hide"} ${layer.replaceAll("_", " ")}`} onPress={() => {
                if (!currentInteraction()) return; controller.noteUserIntent(); recoveryEntryEpoch.current++; controller.recoveryParticipants.notifyChanged();
                setLayerVisibility(values => ({ ...values, [layer]: values[layer] === false }));
              }} />)}
          </> : <><Text style={styles.label}>Design name</Text><TextInput ref={fileNameInput} value={dialogText} editable={!controller.recovery.hydrating} accessibilityLabel="Design name" style={styles.input}
            onFocus={() => { if (currentInteraction()) controller.recoveryParticipants.recordFocus("file/name"); }}
            onSelectionChange={event => { if (currentInteraction()) controller.recoveryParticipants.recordFocus("file/name", event.nativeEvent.selection); }} onChangeText={changeDialogText} />
            <WorkspaceButton label={dialog === "rename" ? "Apply name" : "Save separate copy"} disabled={controller.busy || !dialogText.trim()} onPress={() => run(saveDialog)} /></>}
          <WorkspaceButton label="Close" onPress={closeDialog} />
        </ScrollView></View></View>
      </Modal>
      <WorkspaceRecoveryPanel controller={controller} visible={recoveryOpen} onClose={() => {
        if (controller.recoveryParticipants.canEdit()) setRecoveryOpen(false);
      }} />
    </>} />;
}
const styles = StyleSheet.create({ panel: { gap: 12 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  backdrop: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(20,40,25,0.35)", padding: 12 },
  dialog: { width: "100%", maxWidth: 560, maxHeight: "85%", padding: 18, backgroundColor: "white", borderRadius: 9 },
  heading: { fontSize: 19, fontWeight: "700", color: "#254234" }, label: { fontSize: 13, color: "#254234", fontWeight: "600" },
  input: { minHeight: 40, padding: 8, borderWidth: 1, borderColor: "#a8b9aa", borderRadius: 5 },
});
