import { workspaceHasSurveyStorage, workspaceHasLayoutStorage, workspaceCanImportBundle, surveyReviewCandidateIds, workspaceLayoutAdmission, workspaceArchiveOwnerStatus, workspaceCommandArchiveStatus } from "./workspaceProductionCapabilities";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  createSurveyCollection, defaultAppSettings, parseAppSettings, parseSurveyCollectionDocument, createFieldLayoutTarget, serializeFieldLayoutTarget, parseFieldLayoutTarget, parseLayoutSessionDocument, serializeLayoutSessionDocument,
  readSurveyDesignDocument, type AppSettings, type SurveyCollection, type SurveyCollectionPurpose, type CrsQualificationOptions, type LayoutObservation,
  layoutLockFromReceiverCapture, RTK_LAYOUT_SESSION_DOCUMENT_VERSION,
} from "@cplayout/core";
import { createCatalogId, readWorkspaceDesign, buildDesignWorkspaceBundle, parseDesignWorkspaceBundle, serializeDesignWorkspaceBundle,
  exportDesignWorkspaceBundleZip, exportLayoutSessionArchiveZip, exportFileAsync, type ArchiveIoResult, type DesignWorkspaceBundle,
  parseWorkspaceCommand, workspaceCommandPermission, type WorkspaceCommand, type WorkspaceCommandValue, type WorkspaceDocument, getSurveyReadiness } from "@cplayout/project-store";
import { workspaceMapSceneFromSession, type WorkspaceMapScene, type WorkspaceSceneOptions } from "@cplayout/map-adapters";
import { createEditorSaveCoordinator, type EditorSaveSession } from "../editorSaveCoordinator";
import { createBrowserReceiverSessionOwner, layoutObservationFromReceiverCapture } from "../gnss/receiverSessionOwner";
import { useWorkspaceRepositoryAccess } from "./WorkspaceRepositoryContext";
import { useProjectRepository, type ProjectCatalogContext, type OpenedLayoutSession } from "../hooks/useProjectRepository";
import { InputRetentionStore } from "../inputRetention";
import { createWorkspaceRecoveryParticipants } from "./workspaceRecoveryParticipants";
import { useWorkspaceEditRecovery } from "./useWorkspaceEditRecovery";
import {
  acceptCommittedWorkspaceDesign, acknowledgeWorkspaceSave, editableFromIndependentDocument,
  editableFromSavedDesign, serializeWorkspaceEditable, workspaceEditableIsDirty,
  workspaceEditableScene, workspaceSavePayload, workspaceSaveTarget, restoreWorkspaceEditableDocument,
  type ExistingWorkspaceDesign, type WorkspaceEditableAction,
} from "./workspaceDocumentAdapters";
import { acceptControllerLayoutReceipt, closeControllerDocument, createWorkspaceControllerState, openControllerDocument,
  openControllerLayout, reduceControllerDocument, reduceControllerDocumentBatch, retainControllerCollections, selectControllerMode,
  type WorkspaceControllerState } from "./workspaceControllerState";
import { captureWorkspaceOperationOwner, isWorkspaceOperationCurrent, replaceWorkspaceDocument, retireWorkspaceInteractions, type WorkspaceMode } from "./workspacePresentation";
import { workspaceMapContextKey, mapContextForWorkspaceDocument } from "./workspaceMapContext";
import { captureWorkspaceSiblingProof, reconcileWorkspaceSibling, workspaceHistorySnapshot, recordWorkspaceHistory, historyMemberships,
  calculateWorkspaceEditable, calculationIsCurrent, workspacePendingBlocksReplacement, type WorkspaceCalculationPreview } from "./workspaceIntegration";
import { projectDataKey } from "../../../../packages/core/src/projectDataComparison";

import { UNIFIED_WORKSPACE_RESUME_KEY, readUnifiedWorkspaceResume, parseUnifiedWorkspaceResume,
  resolveUnifiedWorkspaceResume, writeUnifiedWorkspaceResume, type UnifiedWorkspaceResume } from "../navigation/unifiedWorkspaceResume";

export type LocalIntentReceipt = Readonly<{ epoch: number }>;
export interface WorkspaceResumeDelivery {
  generation: number; documentGeneration: number; intentEpoch: number;
  catalogSelection: ProjectCatalogContext; catalogVisible: boolean;
}
type ResumeRaw = { kind: "available"; raw: string | null } | { kind: "unavailable" };
function readResumeRaw(storage: { getItem(key: string): string | null } | null): ResumeRaw {
  try {
    const raw = storage?.getItem(UNIFIED_WORKSPACE_RESUME_KEY);
    return raw === null || typeof raw === "string" ? { kind: "available", raw } : { kind: "unavailable" };
  } catch { return { kind: "unavailable" }; }
}

class WorkspaceInputNotice extends Error {
  constructor(message: string, readonly isResolved: () => boolean) { super(message); }
}

/** The single editable document, raw-input, repository, save and receiver owner.
 * Panels receive commands/state; none can recreate this hook on a mode change. */
export function useWorkspaceController() {
  const access = useWorkspaceRepositoryAccess();
  const accessRef = useRef(access); accessRef.current = access;
  const navigationPending = useRef(false), [preparingNavigation, setPreparingNavigation] = useState(false);
  function isActive() { return accessRef.current.visible !== false && accessRef.current.authorityBlocked !== true && !navigationPending.current; }
  function roleCanWrite() { return accessRef.current.authorityBlocked !== true && (accessRef.current.roles === undefined || accessRef.current.roles.some(role => role === "operator" || role === "admin")); }
  function fieldArchiveStatus() {
    const current = stateRef.current;
    const owner = current.presentation.mode === "layout" && current.layout ? { fieldMapId: current.layout.session.fieldMapId }
      : current.editable?.identity ?? (current.layout ? { fieldMapId: current.layout.session.fieldMapId } : {});
    return workspaceArchiveOwnerStatus(knownWorkspace.current?.catalog ?? repositoryRef.current.catalog, accessRef.current.archives, owner);
  }
  function canEditField() { return accessRef.current.fieldMutationsAvailable !== false && roleCanWrite() && fieldArchiveStatus() === "active" && (accessRef.current.permissions === undefined || accessRef.current.permissions.includes("field:write")); }
  function canCaptureLive() { return canEditField() && accessRef.current.liveCaptureAvailable !== false; }
  const liveCommand = (type: string) => ["append_survey_capture", "append_layout_mark", "append_layout_observation", "create_rtk_layout_session", "finalize_rtk_layout_session"].includes(type);
  function canMaintainCatalog() { return roleCanWrite() && (accessRef.current.permissions === undefined || accessRef.current.permissions.includes("catalog:write")); }
  function canArchiveCatalog() { return accessRef.current.authorityBlocked !== true && (accessRef.current.permissions === undefined && accessRef.current.roles === undefined
    || accessRef.current.permissions?.includes("catalog:archive") === true && accessRef.current.roles?.includes("admin") === true); }
  function hasMutationPermission(type: string) {
    const permissions = accessRef.current.permissions;
    return roleCanWrite() && (permissions === undefined || permissions.includes(workspaceCommandPermission(type)))
      && (workspaceCommandPermission(type) !== "catalog:archive" || canArchiveCatalog())
      && (workspaceCommandPermission(type) !== "field:write" || accessRef.current.fieldMutationsAvailable !== false)
      && (!liveCommand(type) || accessRef.current.liveCaptureAvailable !== false);
  }
  function requireMutationPermission(type: string) {
    if (workspaceCommandPermission(type) === "field:write" && accessRef.current.fieldMutationsAvailable === false) throw new Error(accessRef.current.fieldMutationsUnavailableReason ?? "Connect to save field changes on this device.");
    if (liveCommand(type) && accessRef.current.liveCaptureAvailable === false) throw new Error("Live GPS collection is unavailable on this device. Use a device that can retain fresh observations.");
    if (!hasMutationPermission(type)) throw new Error("Your account cannot change this saved work.");
  }
  const visibilityOwner = useRef(access.visible !== false && access.authorityBlocked !== true);
  const repository = useProjectRepository();
  const repositoryRef = useRef(repository); repositoryRef.current = repository;
  const [state, renderState] = useState(createWorkspaceControllerState);
  const stateRef = useRef(state);
  const knownWorkspace = useRef<WorkspaceDocument | null>(null);
  const renderedInteractionOwner = captureWorkspaceOperationOwner(state.presentation, "interaction");
  const renderedDocumentOwner = captureWorkspaceOperationOwner(state.presentation, "document");
  const openRequestGeneration = useRef(0);
  const [inputs] = useState(() => new InputRetentionStore());
  const [recoveryParticipants] = useState(() => createWorkspaceRecoveryParticipants(inputs));
  const [receiver] = useState(createBrowserReceiverSessionOwner);
  const [saveCoordinator] = useState(createEditorSaveCoordinator);
  const saveSession = useRef<EditorSaveSession | null>(null);
  const mounted = useRef(true), busyRef = useRef(false);
  const operationJobs = useRef(new Set<Promise<unknown>>());
  const savingCount = useRef(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const collectionSelection = useRef<string | null>(null);
  const pendingInteractionInputs = useRef(new Set<string>());
  const pendingInputEpochs = useRef(new Map<string, number>());
  const [pendingInputRevision, setPendingInputRevision] = useState(0);
  const inputRevision = useSyncExternalStore(inputs.subscribeChanges, inputs.getRevision, inputs.getRevision);
  const fileJob = useRef(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [layoutSaveState, setLayoutSaveState] = useState<"saved" | "saving" | "error">("saved");
  const inputNotice = useRef<{ error: WorkspaceInputNotice; generation: number } | null>(null);
  const catalogCloseHandoff = useRef<{ from: typeof renderedDocumentOwner; to: typeof renderedDocumentOwner;
    fromInteraction: typeof renderedInteractionOwner; toInteraction: typeof renderedInteractionOwner; intent: LocalIntentReceipt | null } | null>(null);
  const [calculation, setCalculation] = useState<WorkspaceCalculationPreview | null>(null);
  const [savedCompleteDesignId, setSavedCompleteDesignId] = useState<string | null>(null);
  const [savedFieldDesignId, setSavedFieldDesignId] = useState<string | null>(null);
  const [designViewRequest, setDesignViewRequest] = useState<{ sequence: number; designId: string; documentGeneration: number; category: "machine" | "map" } | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const [autosaveFailure, setAutosaveFailure] = useState<string | null>(null);
  const autosaveAttempt = useRef<string | null>(null);
  function setCollectionSelection(id: string | null) { collectionSelection.current = id; setSelectedCollectionId(id); }
  const [acceptedContextSequence, setAcceptedContextSequence] = useState(0);
  const acceptedTransition = useRef<{ intent: LocalIntentReceipt; workspace: UnifiedWorkspaceResume["workspace"] } | null>(null);
  const [resumePhase, setResumePhase] = useState<"pending" | "settled">("pending");
  const [resumeDelivery, setResumeDelivery] = useState<WorkspaceResumeDelivery | null>(null);
  const startup = useRef({ epoch: 0, started: false, settled: false, deliverySequence: 0,
    intent: null as LocalIntentReceipt | null, raw: { kind: "unavailable" } as ResumeRaw,
    delivery: null as WorkspaceResumeDelivery | null,
    accepted: null as UnifiedWorkspaceResume | null,
    job: null as Promise<"restored" | "fallback" | "cancelled"> | null });
  const [, tickAge] = useState(0);
  const liveReceiver = useSyncExternalStore(receiver.subscribe, receiver.getSnapshot, receiver.getSnapshot);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; saveCoordinator.retire(); void receiver.disconnect().catch(() => undefined); };
  }, [receiver, saveCoordinator]);
  useEffect(() => {
    if (liveReceiver.phase !== "connected" || !liveReceiver.observation || access.visible === false || access.authorityBlocked === true) return;
    const timer = setInterval(() => tickAge(value => value + 1), 200);
    return () => clearInterval(timer);
  }, [liveReceiver.phase, !!liveReceiver.observation, access.visible, access.authorityBlocked]);

  useEffect(() => {
    const active = access.visible !== false && access.authorityBlocked !== true;
    if (visibilityOwner.current === active) return;
    visibilityOwner.current = active; openRequestGeneration.current++;
    update(current => ({ ...current, presentation: retireWorkspaceInteractions(current.presentation) }));
  }, [access.visible, access.authorityBlocked]);

  function update(next: WorkspaceControllerState | ((current: WorkspaceControllerState) => WorkspaceControllerState)) {
    const value = typeof next === "function" ? next(stateRef.current) : next;
    stateRef.current = value;
    if (mounted.current) renderState(value);
  }
  function notice(error: unknown) {
    const message = error instanceof Error ? error.message : "The workspace operation failed. Keep your work and retry.";
    inputNotice.current = error instanceof WorkspaceInputNotice ? { error, generation: stateRef.current.presentation.documentGeneration } : null;
    update(current => ({ ...current, notice: message }));
  }
  function replacementGuard(options: { ignorePendingInputKeys?: readonly string[] } = {}) {
    const ignored = options.ignorePendingInputKeys ?? [];
    const externalDirty = workspacePendingBlocksReplacement(pendingInteractionInputs.current, ignored);
    return { dirty: workspaceEditableIsDirty(stateRef.current.editable) || inputs.hasDirty()
      || externalDirty, busy: busyRef.current || savingCount.current > 0 || fileJob.current };
  }
  function rememberCatalogClose(options: { ignorePendingInputKeys?: readonly string[] }) {
    catalogCloseHandoff.current = options.ignorePendingInputKeys?.includes("catalog")
      ? { from: renderedDocumentOwner, to: captureWorkspaceOperationOwner(stateRef.current.presentation, "document"),
        fromInteraction: renderedInteractionOwner, toInteraction: captureWorkspaceOperationOwner(stateRef.current.presentation, "interaction"), intent: startup.current.intent } : null;
  }
  function ownsCatalogClose(options: { ignorePendingInputKeys?: readonly string[] }): boolean {
    if (isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return true;
    const handoff = catalogCloseHandoff.current;
    return !!(options.ignorePendingInputKeys?.includes("catalog") && handoff && handoff.intent === startup.current.intent
      && JSON.stringify(handoff.from) === JSON.stringify(renderedDocumentOwner)
      && JSON.stringify(handoff.fromInteraction) === JSON.stringify(renderedInteractionOwner)
      && isWorkspaceOperationCurrent(stateRef.current.presentation, handoff.to)
      && isWorkspaceOperationCurrent(stateRef.current.presentation, handoff.toInteraction));
  }
  function requireEditable() {
    const editable = stateRef.current.editable;
    if (!editable) throw new Error("Open a design before using this command.");
    return editable;
  }
  function requireManaged() {
    const editable = requireEditable();
    if (!editable.identity.designId || !editable.identity.fieldMapId || editable.workspaceRevision === null || editable.designRevision === null) {
      throw new Error("Import this design into a customer, project and field before recording or saving workspace work.");
    }
    return editable;
  }
  function existingRead(workspace: WorkspaceDocument, designId: string): ExistingWorkspaceDesign {
    const read = readWorkspaceDesign(workspace, designId);
    if (read.kind === "not_found") throw new Error("The saved design is no longer in this workspace. Keep your current edits for recovery.");
    return read;
  }
  function collectionsFor(workspace: WorkspaceDocument, designId: string): SurveyCollection[] {
    return (workspace.surveyCollections ?? []).map(entry => parseSurveyCollectionDocument(entry.document)).filter(collection => collection.owner.designId === designId);
  }
  function installSaveSession() {
    const editable = stateRef.current.editable;
    saveCoordinator.retire(); saveSession.current = null;
    if (editable?.identity.designId && editable.workspaceRevision !== null) saveSession.current = saveCoordinator.open(workspaceSaveTarget(editable));
  }

  async function readWorkspaceReceipt(): Promise<WorkspaceDocument> {
    const workspace = await repositoryRef.current.readWorkspace();
    if (!knownWorkspace.current || workspace.revision >= knownWorkspace.current.revision) knownWorkspace.current = workspace;
    return workspace;
  }
  async function executeWorkspaceReceipt(...args: Parameters<typeof repository.executeWorkspaceCommand>) {
    const [command, revision, owner] = args;
    requireMutationPermission(command.type);
    const archiveAllowed = () => !knownWorkspace.current || workspaceCommandArchiveStatus(knownWorkspace.current, accessRef.current.archives, command) === "active";
    if (!archiveAllowed()) throw new Error("Restore this customer or project before changing its saved work. Wait for its status if it is still loading.");
    const guarded = owner ? { ...owner, isCurrent: () => owner.isCurrent() && hasMutationPermission(command.type) && archiveAllowed() } : undefined;
    const result = await repositoryRef.current.executeWorkspaceCommand(command, revision, guarded);
    if (!knownWorkspace.current || result.workspace.revision >= knownWorkspace.current.revision) knownWorkspace.current = result.workspace;
    return result;
  }
  function resumeReady(): boolean {
    return repositoryRef.current.backendInfo !== null && typeof repositoryRef.current.catalogRevision === "number";
  }
  const noteUserIntent = useCallback((): LocalIntentReceipt => {
    if (!recoveryParticipants.canEdit()) return startup.current.intent ?? Object.freeze({ epoch: startup.current.epoch });
    catalogCloseHandoff.current = null;
    const owner = startup.current, intent = Object.freeze({ epoch: ++owner.epoch });
    owner.intent = intent; owner.accepted = null; owner.delivery = null; acceptedTransition.current = null;
    owner.raw = repositoryRef.current.backendInfo?.runtime === "web" && resumeReady() ? readResumeRaw(access.storage) : { kind: "unavailable" };
    owner.settled = true;
    if (mounted.current) { setResumePhase("settled"); setResumeDelivery(null); }
    return intent;
  }, [recoveryParticipants]);
  useEffect(() => inputs.subscribeUserInput(noteUserIntent), [inputs, noteUserIntent]);
  function createResumeSnapshot(catalogSelection: ProjectCatalogContext, catalogVisible: boolean): UnifiedWorkspaceResume {
    const current = stateRef.current, identity = current.editable?.identity, session = current.layout?.session;
    return { version: 2, catalogVisible, catalogSelection: { ...catalogSelection }, workspace: {
      mode: current.presentation.mode,
      design: identity?.designId && identity.fieldMapId ? { designId: identity.designId, documentKind: identity.kind,
        payloadId: identity.payloadId, fieldMapId: identity.fieldMapId, projectCrs: identity.projectCrs } : null,
      layout: session ? { sessionId: session.id, fieldMapId: session.fieldMapId,
        projectCrs: parseFieldLayoutTarget(session.targetDocument).field.projectCrs, targetHash: session.targetHash } : null,
      collectionId: identity?.designId ? collectionSelection.current : null } };
  }
  function acceptLocalContext(intent: LocalIntentReceipt, input: UnifiedWorkspaceResume): boolean {
    const owner = startup.current;
    if (!mounted.current || !owner.settled || !resumeReady() || repositoryRef.current.backendInfo?.runtime !== "web" || owner.intent !== intent) return false;
    try {
      const snapshot = parseUnifiedWorkspaceResume(input);
      if (JSON.stringify(snapshot.workspace) !== JSON.stringify(createResumeSnapshot(snapshot.catalogSelection, snapshot.catalogVisible).workspace)) return false;
      const catalog = repositoryRef.current.designCatalog ?? repositoryRef.current.catalog, selected = snapshot.catalogSelection;
      const client = catalog.clients.find(item => item.id === selected.clientId);
      const project = client && catalog.projects.find(item => item.id === selected.projectId && item.clientId === client.id);
      const field = project && catalog.fieldMaps.find(item => item.id === selected.fieldMapId && item.projectId === project.id);
      const design = field && catalog.designs.find(item => item.id === selected.designId && item.fieldMapId === field.id);
      if (JSON.stringify(selected) !== JSON.stringify({ clientId: client?.id ?? null, projectId: project?.id ?? null, fieldMapId: field?.id ?? null, designId: design?.id ?? null })) return false;
      const durable = knownWorkspace.current;
      if ((!durable || durable.revision < repositoryRef.current.catalogRevision!) && (snapshot.workspace.design || snapshot.workspace.layout || snapshot.workspace.collectionId)) return false;
      // Fresh acknowledged/read bytes prove active pointers independently of browsing selection.
      if (durable && durable.revision >= repositoryRef.current.catalogRevision!) {
        const resolved = resolveUnifiedWorkspaceResume(snapshot, durable);
        if (resolved.reasons.length) return false;
        const active = stateRef.current.editable?.identity;
        if (active?.designId && resolved.designRead && (active.clientId !== resolved.designRead.context.clientId
          || active.projectId !== resolved.designRead.context.projectId)) return false;
      }
      owner.accepted = snapshot;
      const currentRaw = readResumeRaw(access.storage);
      if (owner.raw.kind !== "available" || currentRaw.kind !== "available") return true;
      if (currentRaw.raw !== owner.raw.raw) { owner.accepted = null; return false; }
      const serialized = JSON.stringify(snapshot);
      if (serialized === currentRaw.raw) return true;
      const result = writeUnifiedWorkspaceResume(snapshot, access.storage);
      if (result.kind === "success") owner.raw = { kind: "available", raw: result.raw };
      return true;
    } catch { return false; }
  }
  function isResumeDeliveryCurrent(delivery: WorkspaceResumeDelivery): boolean {
    return mounted.current && startup.current.delivery === delivery && startup.current.epoch === delivery.intentEpoch
      && stateRef.current.presentation.documentGeneration === delivery.documentGeneration;
  }
  function restoreStartupContext(): Promise<"restored" | "fallback" | "cancelled"> {
    const owner = startup.current;
    if (owner.job) return owner.job;
    function settle(result: "restored" | "fallback" | "cancelled") {
      owner.settled = true; if (mounted.current) setResumePhase("settled"); return result;
    }
    const runtime = repositoryRef.current.backendInfo?.runtime;
    if (runtime && runtime !== "web") return Promise.resolve(settle("fallback"));
    if (!resumeReady()) return Promise.resolve("cancelled");
    if (owner.epoch !== 0 || owner.settled) return Promise.resolve(settle("cancelled"));
    owner.started = true;
    const hint = readUnifiedWorkspaceResume(access.storage);
    if (hint.kind !== "success") return Promise.resolve(settle("fallback"));
    const operation = captureWorkspaceOperationOwner(stateRef.current.presentation, "interaction"), request = openRequestGeneration.current;
    const isCurrent = () => mounted.current && owner.epoch === 0 && request === openRequestGeneration.current
      && isWorkspaceOperationCurrent(stateRef.current.presentation, operation) && !replacementGuard().dirty && !replacementGuard().busy;
    owner.job = (async () => {
      try {
        const workspace = await readWorkspaceReceipt();
        if (!isCurrent()) return settle("cancelled");
        const resolved = resolveUnifiedWorkspaceResume(hint.hint, workspace);
        let next = stateRef.current;
        if (resolved.designRead) next = retainControllerCollections(openControllerDocument(next, editableFromSavedDesign(resolved.designRead), replacementGuard(), true), resolved.collections);
        if (resolved.layoutSession) next = openControllerLayout(next, { session: resolved.layoutSession, persistenceRevision: workspace.revision }, replacementGuard());
        next = selectControllerMode(next, resolved.mode);
        const target = next.editable ? workspaceSaveTarget(next.editable) : null;
        const freshHint = readUnifiedWorkspaceResume(access.storage);
        if (!isCurrent() || freshHint.kind !== "success" || freshHint.raw !== hint.raw) return settle("cancelled");
        // All domain validation precedes the one owner publication. No durable command occurs.
        inputs.reset(); pendingInteractionInputs.current.clear(); setCalculation(null); setSavedCompleteDesignId(null); setSavedFieldDesignId(null);
        saveCoordinator.retire(); saveSession.current = target ? saveCoordinator.open(target) : null;
        setCollectionSelection(resolved.selectedCollectionId);
        const delivery: WorkspaceResumeDelivery = { generation: ++owner.deliverySequence,
          documentGeneration: next.presentation.documentGeneration, intentEpoch: owner.epoch,
          catalogSelection: { ...resolved.catalogSelection }, catalogVisible: resolved.catalogVisible };
        owner.delivery = delivery; setResumeDelivery(delivery);
        if (next !== stateRef.current) update(next);
        return settle(resolved.designRead || resolved.layoutSession ? "restored" : "fallback");
      } catch { return settle("fallback"); }
    })();
    return owner.job;
  }
  // Only operator-facing methods use this wrapper. Reconciliation, callbacks,
  // Save acknowledgements and receiver ticks retain their existing ownership.
  function operator<T extends (...args: any[]) => any>(command: T): T {
    return ((...args: Parameters<T>) => {
      if (!isActive() || !recoveryParticipants.canEdit()) return false;
      const held = command === closeDesign || command === closeLayout || command === executeCatalog ? catalogCloseHandoff.current : null;
      const handoff = held && held.intent === startup.current.intent
        && isWorkspaceOperationCurrent(stateRef.current.presentation, held.to)
        && isWorkspaceOperationCurrent(stateRef.current.presentation, held.toInteraction) ? held : null;
      const intent = noteUserIntent();
      if (handoff) catalogCloseHandoff.current = { ...handoff, intent };
      const signature = () => JSON.stringify([stateRef.current.presentation.mode, stateRef.current.editable?.identity,
        stateRef.current.layout?.session.id, stateRef.current.layout?.session.targetHash, collectionSelection.current]);
      const before = signature();
      function completed(result: any) {
        if (mounted.current && startup.current.intent === intent && result !== false && result !== null
          && (before !== signature() || command === selectMode || command === save && result === true)) {
          try {
            acceptedTransition.current = { intent, workspace: parseUnifiedWorkspaceResume(createResumeSnapshot(
              { clientId: null, projectId: null, fieldMapId: null, designId: null }, false)).workspace };
            setAcceptedContextSequence(value => value + 1);
          } catch { /* Remembering context is optional and cannot invalidate an accepted command. */ }
        }
        return result;
      }
      if ([dispatch, dispatchBatch, save, completeSurvey, completeDesign, createFieldFromProject, undo, redo, enableSurvey, startSurvey, collectSurvey, applySurvey, changeMembership,
        createLayoutSession, finalizeLayoutSession, collectLayout, renameLayout, archiveLayout, copyLayout, copyDesign, dispatchSurveyInformation, prepareSurveyedField, useRecordedPivot].some(value => value === command) && !canEditField()) {
        notice(new Error(accessRef.current.fieldMutationsAvailable === false ? accessRef.current.fieldMutationsUnavailableReason ?? "Connect to save field changes on this device." : "Your account can view this field work. Editing and recording positions require field access.")); return false;
      }
      const result = command(...args);
      if (result && typeof result.then === "function") {
        const tracked = Promise.resolve(result).then(completed);
        operationJobs.current.add(tracked);
        void tracked.then(() => operationJobs.current.delete(tracked), () => operationJobs.current.delete(tracked));
        return tracked;
      }
      return completed(result);
    }) as T;
  }

  function selectMachineForLayout(id: string | null): boolean {
    const current = stateRef.current, editable = current.editable;
    if (!isActive() || busyRef.current || !editable || editable.kind !== "field"
      || !isWorkspaceOperationCurrent(current.presentation, renderedInteractionOwner)) return false;
    if (id !== null && ![...editable.editor.field.machines, ...(editable.editor.field.lateralMachines ?? [])].some(machine => machine.id === id)) {
      notice(new Error("Choose a machine from this field.")); return false;
    }
    update(state => ({ ...state, editable: { ...editable, editor: { ...editable.editor, selectedMachineId: id } } }));
    return true;
  }
  function changeSettings(value: AppSettings): boolean {
    const next = parseAppSettings(value);
    if (next.unitSystem !== settingsRef.current.unitSystem && (inputs.hasDirty() || pendingInteractionInputs.current.size > 0)) {
      notice(new WorkspaceInputNotice("Apply or discard entered values before changing measurement units.", () => !inputs.hasDirty() && pendingInteractionInputs.current.size === 0));
      return false;
    }
    settingsRef.current = next; setSettings(next); return true;
  }
  function selectMode(mode: WorkspaceMode) {
    if (!isActive()) return;
    if (mode === "layout" && !stateRef.current.layout) {
      const id = stateRef.current.editable?.identity.designId;
      if (!id || !knownWorkspace.current || getSurveyReadiness(knownWorkspace.current, id).status !== "ready") {
        notice(new Error("Complete the Survey review before starting Layout.")); return;
      }
    }
    update(current => selectControllerMode(current, mode));
  }
  async function ensureProductionWorkspace(): Promise<void> {
    let workspace = await readWorkspaceReceipt();
    if (workspace.workspaceVersion !== "cplayout-workspace-v5") {
      await siblingCommand(() => ({ type: "upgrade_workspace_to_v5", now: new Date().toISOString() }));
    }
  }
  async function completeSurvey(includedCollectionIds?: readonly string[]): Promise<boolean> {
    try {
      const owns = captureSurveyWorkflowAdmission();
      if (!access.actorId) throw new Error("Sign in before completing a Survey review.");
      if (workspaceEditableIsDirty(requireEditable()) && !await save()) return false;
      if (!owns()) throw new Error("The Survey work or entered information changed. Review the current work before completing it.");
      const editable = requireManaged();
      if (designFileInputsPending()) throw new Error("Finish or discard the entered Survey details before reviewing it.");
      await ensureProductionWorkspace();
      if (!owns()) throw new Error("The Survey review belongs to an earlier view. Your observations remain saved.");
      const included = includedCollectionIds ? [...includedCollectionIds] : stateRef.current.collections.filter(item => item.activePointIds.length > 0 || item.state === "applied" && item.applications.some(application => application.sourcePointIds.length > 0)).map(item => item.id);
      const excluded = stateRef.current.collections.filter(item => !included.includes(item.id)).map(item => item.id);
      await siblingCommand(() => ({ type: "review_survey", reviewId: createCatalogId("survey-review"),
        designId: editable.identity.designId!, expectedDesignRevision: editable.designRevision!,
        includedCollectionIds: included, excludedCollectionIds: excluded, completedBy: access.actorId!, now: new Date().toISOString() }), owns, renderedInteractionOwner);
      return true;
    } catch (error) { notice(error); return false; }
  }
  function captureSurveyWorkflowAdmission(): () => boolean {
    if (stateRef.current.presentation.mode !== "survey") throw new Error("Open Survey before using its review or preparation controls.");
    const owner = renderedInteractionOwner, editable = requireManaged(), document = serializeWorkspaceEditable(editable), revision = editable.editor.revision;
    const actor = accessRef.current.actorId, partition = accessRef.current.partition, intent = startup.current.intent;
    const input = inputs.getRevision(), ui = recoveryParticipants.getInputOwner(), epochs = JSON.stringify([...pendingInputEpochs.current]);
    return () => mounted.current && isActive() && canEditField() && stateRef.current.presentation.mode === "survey"
      && isWorkspaceOperationCurrent(stateRef.current.presentation, owner) && accessRef.current.actorId === actor && accessRef.current.partition === partition
      && startup.current.intent === intent && inputs.getRevision() === input && recoveryParticipants.getInputOwner() === ui
      && JSON.stringify([...pendingInputEpochs.current]) === epochs && stateRef.current.editable?.identity.designId === editable.identity.designId
      && stateRef.current.editable.editor.revision === revision && serializeWorkspaceEditable(stateRef.current.editable) === document;
  }
  async function declareCoordinateSystem(projectCrs: string): Promise<boolean> {
    try {
      requireMutationPermission("declare_work_crs");
      const editable = requireManaged();
      if (replacementGuard().dirty || designFileInputsPending()) throw new Error("Save, apply or preserve unfinished inputs before choosing the field coordinate system.");
      await ensureProductionWorkspace();
      const workspace = await readWorkspaceReceipt();
      if (busyRef.current) throw new Error("Wait for the current field operation before choosing its coordinate system.");
      busyRef.current = true; setBusy(true);
      try {
        await executeWorkspaceReceipt({ type: "declare_work_crs", designId: editable.identity.designId!,
          expectedDesignRevision: editable.designRevision!, projectCrs, now: new Date().toISOString() }, workspace.revision,
          { isCurrent: () => mounted.current && accessRef.current.visible !== false
            && isWorkspaceOperationCurrent(stateRef.current.presentation, renderedDocumentOwner)
            && stateRef.current.editable?.sourceDocument === editable.sourceDocument
            && !replacementGuard().dirty && !designFileInputsPending() });
      } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
      return await openDesign(editable.identity.designId!, true);
    } catch (error) { notice(error); return false; }
  }
  async function openDesign(designId: string, reload = false, initialMode?: "design" | "survey", view?: { category: "machine" | "map"; machineId?: string }): Promise<boolean> {
    const owner = renderedInteractionOwner;
    if (!isWorkspaceOperationCurrent(stateRef.current.presentation, owner)) return false;
    const requestGeneration = ++openRequestGeneration.current;
    const initialGuard = replacementGuard();
    if (initialGuard.dirty || initialGuard.busy) { notice(new Error("Save or preserve the current design and finish its entered inputs before opening another design.")); return false; }
    try {
      const workspace = await readWorkspaceReceipt();
      if (!mounted.current || requestGeneration !== openRequestGeneration.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, owner)) return false;
      const read = existingRead(workspace, designId);
      let opened = openControllerDocument(stateRef.current, editableFromSavedDesign(read), replacementGuard(), reload);
      if (view?.machineId !== undefined) {
        const editable = opened.editable;
        if (editable?.kind === "field") {
          if (![...editable.editor.field.machines, ...(editable.editor.field.lateralMachines ?? [])].some(item => item.id === view.machineId)) throw new Error("This machine is no longer present in the saved field work.");
          opened = { ...opened, editable: { ...editable, editor: { ...editable.editor, selectedMachineId: view.machineId } } };
        } else if (editable?.kind === "project" ? editable.editor.project.machine.id !== view.machineId : editable?.kind === "draft" ? editable.editor.draft.machine.id !== view.machineId : true)
          throw new Error("This machine is no longer present in the saved field work.");
      }
      const next = initialMode ? selectControllerMode(opened, initialMode) : opened;
      if (view) setDesignViewRequest(previous => ({ sequence: (previous?.sequence ?? 0) + 1, designId,
        documentGeneration: next.presentation.documentGeneration, category: view.category }));
      if (opened === stateRef.current) { if (next !== opened) update(next); return true; }
      inputs.reset(); pendingInteractionInputs.current.clear(); setCalculation(null); setSavedCompleteDesignId(null); setSavedFieldDesignId(null); update(retainControllerCollections(next, collectionsFor(workspace, designId)));
      setCollectionSelection(null); installSaveSession(); return true;
    } catch (error) { if (requestGeneration === openRequestGeneration.current && isWorkspaceOperationCurrent(stateRef.current.presentation, owner)) notice(error); return false; }
  }
  function openIndependent(kind: "draft" | "project" | "field", document: string): boolean {
    try {
      if (!isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return false;
      const next = openControllerDocument(stateRef.current, editableFromIndependentDocument(kind, document), replacementGuard(), true);
      openRequestGeneration.current++; inputs.reset(); pendingInteractionInputs.current.clear(); setCalculation(null); setSavedCompleteDesignId(null); setSavedFieldDesignId(null); update(next); setCollectionSelection(null); installSaveSession(); return true;
    } catch (error) { notice(error); return false; }
  }
  function dispatch(action: WorkspaceEditableAction): boolean {
    if (!isActive()) return false;
    if (busyRef.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)
      || stateRef.current.editable?.editor.revision !== state.editable?.editor.revision) return false;
    try {
      const next = reduceControllerDocument(stateRef.current, action);
      if (next !== stateRef.current) openRequestGeneration.current++;
      update(next); return !next.editable?.editor.lastError;
    } catch (error) { notice(error); return false; }
  }
  function dispatchSurveyInformation(action: WorkspaceEditableAction): boolean {
    const current = stateRef.current;
    if (!isActive() || !canEditField() || busyRef.current || current.presentation.mode !== "survey" || !current.editable
      || !isWorkspaceOperationCurrent(current.presentation, renderedInteractionOwner)) return false;
    const allowed = action.kind === "draft" ? ["rename", "set_machine", "clear_error"] : action.kind === "field"
      ? ["rename", "add_machine", "update_machine", "remove_machine", "select_machine", "clear_error", "select_lateral", "add_lateral", "update_lateral", "remove_lateral"] : [];
    if (action.kind !== current.editable.kind || !allowed.includes(action.action.type)) { notice(new Error("Use Survey collection controls for measured coordinates. Known information cannot replace saved observations.")); return false; }
    try {
      const editing = { ...current, presentation: { ...current.presentation, mode: "design" as const } };
      const reduced = reduceControllerDocument(editing, action);
      update({ ...reduced, presentation: current.presentation }); return !reduced.editable?.editor.lastError;
    } catch (error) { notice(error); return false; }
  }
  function useRecordedPivot(pointId: string): Promise<boolean> {
    if (stateRef.current.presentation.mode !== "survey" || stateRef.current.editable?.kind !== "draft") return Promise.resolve(false);
    const collection = currentCollection();
    return recordedCommand(editable => ({ type: "bind_recorded_pivot", designId: editable.identity.designId!, expectedDesignRevision: editable.designRevision!,
      collectionId: collection.id, expectedCollectionRevision: collection.revision, pointId, now: new Date().toISOString() }),
      () => collectionSelection.current === collection.id && stateRef.current.collections.find(item => item.id === collection.id)?.revision === collection.revision);
  }
  async function prepareSurveyedField(): Promise<boolean> {
    try {
      const owns = captureSurveyWorkflowAdmission();
      if (replacementGuard().dirty && (inputs.hasDirty() || designFileInputsPending())) throw new Error("Apply or discard the entered field and machine information before preparing Layout.");
      if (workspaceEditableIsDirty(requireEditable()) && !await save()) return false;
      if (!owns()) throw new Error("Survey work changed before preparation. Your entered values remain here.");
      const editable = requireManaged(); if (editable.kind !== "draft") throw new Error("Prepare the original Survey work before opening its field.");
      const designId = createCatalogId("design"), fieldId = createCatalogId("field");
      const receipt = await siblingCommand(() => ({ type: "prepare_surveyed_field", sourceDesignId: editable.identity.designId!, expectedDesignRevision: editable.designRevision!,
        designId, fieldMapId: editable.identity.fieldMapId!, fieldId, waterSourceId: createCatalogId("water"), powerSourceId: createCatalogId("power"), name: editable.editor.draft.name, now: new Date().toISOString() }), owns, renderedInteractionOwner);
      const read = existingRead(receipt.workspace, designId);
      if (!owns() || replacementGuard().dirty) throw new Error("The prepared field was saved. Preserve your later entered work before opening its saved record.");
      const next = retainControllerCollections(selectControllerMode(openControllerDocument(stateRef.current, editableFromSavedDesign(read), { dirty: false, busy: false }), "survey"), collectionsFor(receipt.workspace, designId));
      inputs.reset(); pendingInteractionInputs.current.clear(); setCalculation(null); update(next); setCollectionSelection(null); installSaveSession();
      return true;
    } catch (error) { notice(error); return false; }
  }
  function dispatchBatch(actions: readonly WorkspaceEditableAction[]): boolean {
    if (!isActive()) return false;
    if (busyRef.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)
      || stateRef.current.editable?.editor.revision !== state.editable?.editor.revision) return false;
    try {
      const next = reduceControllerDocumentBatch(stateRef.current, actions);
      if (next !== stateRef.current) openRequestGeneration.current++;
      update(next); return !next.editable?.editor.lastError;
    } catch (error) { notice(error); return false; }
  }

  function save(): Promise<boolean> {
    if (!isWorkspaceOperationCurrent(stateRef.current.presentation, renderedDocumentOwner)) return Promise.resolve(false);
    if (busyRef.current) { notice(new Error("Wait for the recorded Survey or Layout operation before saving another design snapshot.")); return Promise.resolve(false); }
    // A refusal before storage is entered is an input notice, never a quota or
    // conflict failure. Keep an earlier genuine storage error until a retry saves.
    if (inputs.hasDirty() || pendingInteractionInputs.current.has("manual-drawing")) {
      notice(new WorkspaceInputNotice(inputs.hasDirty() ? "Apply or discard your entered inputs before saving the design." : "Finish or discard the current drawing before saving the design.",
        () => !inputs.hasDirty() && !pendingInput("manual-drawing")));
      return Promise.resolve(false);
    }
    setAutosaveFailure(null); autosaveAttempt.current = null;
    return persistAppliedDesign().then(ok => {
      if (!ok && mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, renderedDocumentOwner)) setAutosaveFailure("Autosave paused after a save error. Current inputs and history are retained; retry Save explicitly.");
      return ok;
    });
  }
  async function persistAppliedDesign(): Promise<boolean> {
    const owner = captureWorkspaceOperationOwner(stateRef.current.presentation, "document");
    if (inputs.hasDirty()) { notice(new WorkspaceInputNotice("Apply or discard your entered inputs before saving the design.", () => !inputs.hasDirty())); return false; }
    savingCount.current++; setSaving(true);
    try {
      const editable = requireManaged(), session = saveSession.current;
      if (!session) throw new Error("The save session has no loaded receipt. Preserve your work and reopen explicitly.");
      const request = { editorRevision: editable.editor.revision, document: serializeWorkspaceEditable(editable) };
      let written: WorkspaceDocument | null = null;
      update(current => ({ ...current, savedState: "saving", notice: null }));
      const completion = await saveCoordinator.save({ session, payload: workspaceSavePayload(editable), editorRevision: request.editorRevision,
        feedbackIsCurrent: () => mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, owner),
        onCommitted() {
          // Publish the acknowledged source before releasing the ordered queue.
          // A following capture must see its own earlier Save's actual receipt.
          if (!mounted.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, owner) || !written) return;
          const current = requireEditable();
          const acknowledged = acknowledgeWorkspaceSave(current, existingRead(written, editable.identity.designId!), request);
          update(currentState => {
            let next: WorkspaceControllerState = { ...currentState, editable: acknowledged, savedState: workspaceEditableIsDirty(acknowledged) ? "unsaved" as const : "saved" as const, notice: null };
            if (currentState.layout) {
              const entry = written!.layoutSessions?.find(item => item.id === currentState.layout!.session.id);
              if (!entry) throw new Error("The saved workspace no longer contains the retained Layout target.");
              next = acceptControllerLayoutReceipt(next, { session: parseLayoutSessionDocument(entry.document), persistenceRevision: written!.revision });
            }
            return next;
          });
        },
        async write(payload, target) {
          if (target.workspaceRevision === null || target.workspaceRevision === undefined || !target.designId) throw new Error("A managed design receipt is required for saving.");
          const now = new Date().toISOString();
          const command: WorkspaceCommand = payload.kind === "draft" && target.kind === "draft"
            ? { type: "save_design_draft", designId: target.designId, expectedDesignRevision: target.designRevision, draft: payload.draft, syncCatalogName: true, now }
            : payload.kind === "field" && target.kind === "field"
              ? { type: "save_field_design", designId: target.designId, expectedDesignRevision: target.designRevision, field: payload.field, syncCatalogName: true, now }
              : payload.kind === "project" && target.kind === "project"
                ? { type: "save_design_project", designId: target.designId, project: payload.project, syncCatalogName: true, now }
                : (() => { throw new Error("Save payload and source receipt have different document kinds."); })();
          // Deliberately no current-owner predicate: an admitted ordinary save
          // retains its exact snapshot and ordered write after UI retirement.
          const receipt = await executeWorkspaceReceipt(command, target.workspaceRevision);
          written = receipt.workspace;
          return { saved: true, persistenceRevision: receipt.workspace.revision,
            designRevision: existingRead(receipt.workspace, target.designId).design.revision };
        } });
      if (!completion.saved) return false;
      return true;
    } catch (error) {
      if (mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, owner)) {
        notice(error); update(current => ({ ...current, savedState: "error" }));
      }
      return false;
    } finally { savingCount.current--; if (mounted.current) setSaving(savingCount.current > 0); }
  }

  /** One serialized recorded transaction, bound to the applied design snapshot,
   * mode generation and optional receiver observation through final persistence. */
  async function recordedCommand(build: (editable: ReturnType<typeof requireManaged>, workspace: WorkspaceDocument) => WorkspaceCommand,
    extraIsCurrent: () => boolean = () => true, addHistory = true,
    commitPolicy: "saved_source" | "atomic_draft_completion" = "saved_source"): Promise<boolean> {
    if (busyRef.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return false;
    const owner = renderedInteractionOwner;
    const documentOwner = captureWorkspaceOperationOwner(stateRef.current.presentation, "document");
    busyRef.current = true; setBusy(true);
    try {
      if (inputs.hasDirty()) throw new Error("Apply or discard your entered inputs before recording Survey work.");
      const admitted = requireManaged();
      if (commitPolicy === "atomic_draft_completion" && admitted.kind !== "draft") throw new Error("Atomic completion requires an actual Draft.");
      // Completion already saves the latest supplied Draft and creates its child
      // in one repository transaction. A separate pre-save would violate refusal
      // and quota atomicity. Earlier accepted ordinary Saves still drain in transact.
      if (commitPolicy === "saved_source" && workspaceEditableIsDirty(admitted) && !await persistAppliedDesign()) return false;
      const editable = requireManaged(), session = saveSession.current;
      const historyBefore = stateRef.current;
      if (!session) throw new Error("The workspace save session was replaced.");
      const expected = { editorRevision: editable.editor.revision, document: serializeWorkspaceEditable(editable) };
      const isCurrent = () => mounted.current && isActive() && isWorkspaceOperationCurrent(stateRef.current.presentation, owner)
        && stateRef.current.editable?.editor.revision === expected.editorRevision
        && !inputs.hasDirty() && extraIsCurrent();
      const receipt = await saveCoordinator.transact({ session, isCurrent,
        async write(target, commitOwner) {
          const workspace = await readWorkspaceReceipt();
          if (!commitOwner.isCurrent()) throw new Error("The active design, mode or live observation changed before recording.");
          if (workspace.revision !== target.workspaceRevision) throw new Error("The workspace changed in another tab or operation. Keep your work and reopen or reconcile its saved source explicitly.");
          const currentEditable = requireManaged();
          const source = existingRead(workspace, currentEditable.identity.designId!);
          if (source.document !== currentEditable.sourceDocument || source.design.revision !== currentEditable.designRevision
            || serializeWorkspaceEditable(currentEditable) !== expected.document) throw new Error("The saved source design changed. Preserve your edits before reopening it.");
          const command = build(currentEditable, workspace);
          requireMutationPermission(command.type);
          if (commitPolicy === "atomic_draft_completion" && (command.type !== "create_complete_design_from_draft"
            || currentEditable.kind !== "draft" || command.sourceDesignId !== currentEditable.identity.designId
            || command.expectedDesignRevision !== currentEditable.designRevision)) throw new Error("Atomic completion cannot run another recorded command or change its saved source.");
          const result = await executeWorkspaceReceipt(command, workspace.revision, commitOwner);
          const read = existingRead(result.workspace, editable.identity.designId!);
          return { value: { workspace: result.workspace, read }, persistenceRevision: result.workspace.revision, designRevision: read.design.revision };
        } });
      // A mode change after successful persistence retires interaction callbacks,
      // while the acknowledged domain receipt still belongs to this document.
      if (!mounted.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, documentOwner)) return true;
      const committed = commitPolicy === "atomic_draft_completion"
        ? acknowledgeWorkspaceSave(requireEditable(), receipt.read, expected)
        : acceptCommittedWorkspaceDesign(requireEditable(), receipt.read, expected);
      update(current => {
        let next = retainControllerCollections({ ...current, editable: committed, savedState: "saved", notice: null }, collectionsFor(receipt.workspace, committed.identity.designId!));
        if (current.layout) {
          const entry = receipt.workspace.layoutSessions?.find(item => item.id === current.layout!.session.id);
          if (!entry) throw new Error("The recorded workspace no longer contains the retained Layout target.");
          next = acceptControllerLayoutReceipt(next, { session: parseLayoutSessionDocument(entry.document), persistenceRevision: receipt.workspace.revision });
        }
        return addHistory ? recordWorkspaceHistory(historyBefore, next) : next;
      });
      return true;
    } catch (error) { if (mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, owner)) notice(error); return false; }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }

  async function enableSurvey(): Promise<boolean> {
    if (!isActive()) return false;
    try { await ensureProductionWorkspace(); return workspaceHasSurveyStorage(knownWorkspace.current?.workspaceVersion); }
    catch (error) { notice(error); return false; }
  }
  async function startSurvey(purpose: SurveyCollectionPurpose): Promise<boolean> {
    if (pendingInput("survey-reference")) { notice(new WorkspaceInputNotice("Apply or discard the entered reference details before starting another collection.", () => !pendingInput("survey-reference"))); return false; }
    const collectionId = createCatalogId("survey");
    const accepted = await recordedCommand(editable => {
      const identity = editable.identity;
      if (!identity.projectCrs) throw new Error("Declare the field's projected coordinate system before collecting Survey work.");
      const now = new Date().toISOString();
      return { type: "create_survey_collection", expectedDesignRevision: editable.designRevision!, now,
        collection: createSurveyCollection({ id: collectionId, now, purpose, owner: { designId: identity.designId!,
          documentKind: identity.kind, payloadId: identity.payloadId, fieldMapId: identity.fieldMapId!, projectCrs: identity.projectCrs } }) };
    });
    if (accepted && stateRef.current.collections.some(collection => collection.id === collectionId)) setCollectionSelection(collectionId);
    return accepted;
  }
  function currentCollection(): SurveyCollection {
    const collection = stateRef.current.collections.find(item => item.id === collectionSelection.current);
    if (!collection) throw new Error("Start or select a recorded Survey collection first.");
    return collection;
  }
  async function collectSurvey(label: string): Promise<boolean> {
    try {
      requireMutationPermission("append_survey_capture");
      if (stateRef.current.presentation.mode !== "survey") throw new Error("Select Survey mode before collecting a receiver position.");
      const editable = requireManaged(), collection = currentCollection(), crs = editable.identity.projectCrs;
      if (!crs) throw new Error("A resolved projected field coordinate system is required.");
      // This is human display metadata for a NEW observation only. The count
      // comes from its immutable retained ledger; receiver evidence is unchanged.
      const displayLabel = label.trim().length ? label : `Observation ${collection.observations.length + 1}`;
      const point = receiver.capture(crs, createCatalogId("survey-point"), displayLabel,
        collection.purpose.kind === "point" ? collection.purpose.role : "control");
      const receiverObservation = point.captureEvidence.observationId, receiverSession = point.captureEvidence.sessionId;
      return await recordedCommand(current => ({ type: "append_survey_capture", collectionId: collection.id,
        expectedCollectionRevision: collection.revision, expectedDesignRevision: current.designRevision!, point, now: new Date().toISOString() }),
        () => {
          const snapshot = receiver.getSnapshot(), gate = receiver.collectionGate(crs);
          const selected = stateRef.current.collections.find(item => item.id === collection.id);
          return isActive() && snapshot.phase === "connected" && snapshot.sessionId === receiverSession
            && snapshot.observation?.id === receiverObservation && gate.accepted
            && gate.projectionId === point.captureEvidence.projection.id
            && collectionSelection.current === collection.id && selected?.revision === collection.revision
            && JSON.stringify(selected.purpose) === JSON.stringify(collection.purpose);
        });
    } catch (error) { notice(error); return false; }
  }
  function applySurvey(reference?: { name: string; notes?: string }): Promise<boolean> {
    if (!selectedCollectionId || busyRef.current || collectionSelection.current !== selectedCollectionId
      || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return Promise.resolve(false);
    const submitted = reference === undefined ? undefined : { ...reference };
    const selected = currentCollection();
    return recordedCommand(editable => {
      const collection = currentCollection();
      return { type: "apply_survey_collection", collectionId: collection.id,
        expectedCollectionRevision: collection.revision, expectedDesignRevision: editable.designRevision!,
        applicationId: createCatalogId("survey-application"),
        ...(submitted === undefined ? {} : { reference: submitted }),
        ...(collection.purpose.kind === "obstacle" || collection.purpose.kind === "map_feature" ? { targetId: createCatalogId("feature") } : {}),
        now: new Date().toISOString() };
    }, () => collectionSelection.current === selected.id
      && stateRef.current.collections.find(item => item.id === selected.id)?.revision === selected.revision);
  }
  function changeMembership(action: "clear" | "remove_last"): Promise<boolean> {
    return recordedCommand(editable => {
      const collection = currentCollection(), activePointIds = action === "clear" ? [] : collection.activePointIds.slice(0, -1);
      return { type: "set_survey_membership", collectionId: collection.id, expectedCollectionRevision: collection.revision,
        expectedDesignRevision: editable.designRevision!, activePointIds, state: activePointIds.length ? "pending" : "cleared", now: new Date().toISOString() };
    });
  }
  function selectCollection(id: string) {
    if (!isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return;
    if (busyRef.current) throw new Error("Wait for the current collection operation before selecting another purpose or collection.");
    if (collectionSelection.current !== id && pendingInput("survey-reference")) {
      notice(new WorkspaceInputNotice("Apply or discard the entered reference details before selecting another collection.", () => !pendingInput("survey-reference"))); return;
    }
    if (!stateRef.current.collections.some(collection => collection.id === id)) throw new Error("The collection is not owned by this design.");
    setCollectionSelection(id);
  }
  function layoutInputsBlockOpen(sessionId: string, admittedCreation = false): boolean {
    return stateRef.current.layout?.session.id !== sessionId && ["layout-name", "layout-label", "layout-copy-name", "layout-tolerance"]
      .some(key => !(admittedCreation && key === "layout-name") && pendingInteractionInputs.current.has(key));
  }
  function openLayout(input: OpenedLayoutSession): boolean { return presentLayout(input); }
  function presentLayout(input: OpenedLayoutSession, admittedCreation = false): boolean {
    try {
      if (!isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return false;
      if (layoutInputsBlockOpen(input.session.id, admittedCreation)) throw new Error("Finish or preserve the entered Layout session name and labels before opening another saved session.");
      const next = openControllerLayout(stateRef.current, input, replacementGuard());
      const replacesEditable = next.editable !== stateRef.current.editable;
      if (replacesEditable) { inputs.reset(); setSavedCompleteDesignId(null); setSavedFieldDesignId(null); setCalculation(null); }
      openRequestGeneration.current++; update(next);
      if (replacesEditable) installSaveSession();
      return true;
    } catch (error) { notice(error); return false; }
  }
  function acceptLayoutReceipt(input: OpenedLayoutSession) { update(current => acceptControllerLayoutReceipt(current, input)); }

  // Stable within a document/session: reconciliation effects do not loop on
  // receiver ticks. Event changes advance an epoch even when pending stays true.
  const setPendingInteractionInput = useCallback((key: string, pending: boolean, changed = false) => {
    if (stateRef.current.presentation.documentGeneration !== state.presentation.documentGeneration
      || stateRef.current.layout?.session.id !== state.layout?.session.id) return;
    const membershipChanged = pendingInteractionInputs.current.has(key) !== pending;
    if (!membershipChanged && !changed) return;
    if (pending) pendingInteractionInputs.current.add(key); else pendingInteractionInputs.current.delete(key);
    pendingInputEpochs.current.set(key, (pendingInputEpochs.current.get(key) ?? 0) + 1);
    setPendingInputRevision(value => value + 1);
  }, [state.presentation.documentGeneration, state.layout?.session.id]);
  function pendingInput(key: string): boolean { return pendingInteractionInputs.current.has(key); }
  function designFileInputsPending(): boolean {
    return inputs.hasDirty() || [...pendingInteractionInputs.current].some(key => !key.startsWith("layout-") && key !== "file-dialog");
  }
  function captureFileInputOwner(subject: "design" | "layout"): () => boolean {
    const owner = renderedInteractionOwner;
    const revision = inputs.getRevision();
    const relevant = (key: string) => subject === "layout" ? key === "layout-name" : !key.startsWith("layout-") && key !== "file-dialog";
    const epochs = () => JSON.stringify([...pendingInputEpochs.current].filter(([key]) => relevant(key)).sort(([a], [b]) => a.localeCompare(b)));
    const capturedEpochs = epochs();
    const layout = stateRef.current.layout?.session;
    const editable = stateRef.current.editable;
    const designDocument = editable ? serializeWorkspaceEditable(editable) : null;
    const editorRevision = editable?.editor.revision;
    return () => mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, owner)
      && epochs() === capturedEpochs && (subject === "design" ? inputs.getRevision() === revision && !designFileInputsPending()
        && !!stateRef.current.editable && stateRef.current.editable.editor.revision === editorRevision
        && serializeWorkspaceEditable(stateRef.current.editable) === designDocument
        : !pendingInput("layout-name") && stateRef.current.layout?.session.id === layout?.id
          && stateRef.current.layout?.session.revision === layout?.revision && stateRef.current.layout?.session.targetDocument === layout?.targetDocument
          && stateRef.current.layout?.session.targetHash === layout?.targetHash);
  }
  function closeLayout(options: { ignorePendingInputKeys?: readonly string[] } = {}): boolean {
    try {
      const guard = replacementGuard(options);
      if (guard.busy || guard.dirty) throw new Error("Save or preserve current work and entered text before closing Layout.");
      if (!ownsCatalogClose(options)) return false;
      openRequestGeneration.current++;
      update(current => ({ ...current, layout: null, mapContext: mapContextForWorkspaceDocument(current.editable?.identity ?? null),
        presentation: retireWorkspaceInteractions(current.presentation), selectedAddress: null }));
      rememberCatalogClose(options); return true;
    } catch (error) { notice(error); return false; }
  }
  function closeDesign(options: { ignorePendingInputKeys?: readonly string[] } = {}): boolean {
    try {
      if (!ownsCatalogClose(options)) return false;
      const next = closeControllerDocument(stateRef.current, replacementGuard(options));
      inputs.reset();
      for (const key of [...pendingInteractionInputs.current]) if (!options.ignorePendingInputKeys?.includes(key)) pendingInteractionInputs.current.delete(key);
      setCalculation(null); setSavedCompleteDesignId(null); setSavedFieldDesignId(null); openRequestGeneration.current++;
      update(next); setCollectionSelection(null); installSaveSession(); rememberCatalogClose(options); return true;
    } catch (error) { notice(error); return false; }
  }

  /** A sibling write keeps exact stored source authority and all dirty editor/history/input state. */
  async function siblingCommand(build: (workspace: WorkspaceDocument) => WorkspaceCommand, extra: () => boolean = () => true, owner = renderedDocumentOwner) {
    const receiptOwner = captureWorkspaceOperationOwner(stateRef.current.presentation, "document");
    if (busyRef.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, owner)) throw new Error("The workspace operation is busy or its source retired.");
    const session = saveSession.current ?? undefined;
    busyRef.current = true; setBusy(true);
    try {
      return await saveCoordinator.exclusive({ session,
        isCurrent: () => mounted.current && isActive() && isWorkspaceOperationCurrent(stateRef.current.presentation, owner) && extra(),
        async write(target, commitOwner) {
          const before = await readWorkspaceReceipt();
          if (!commitOwner.isCurrent()) throw new Error("The workspace source changed while reading its receipt.");
          const editable = stateRef.current.editable;
          const proof = editable?.identity.designId ? captureWorkspaceSiblingProof(editable, before) : null;
          if (target && target.workspaceRevision !== before.revision) throw new Error("The shared source receipt changed; preserve current edits and reconcile before writing.");
          const layout = stateRef.current.layout;
          const oldLayout = layout ? before.layoutSessions?.find(item => item.id === layout.session.id) : undefined;
          if (layout && (!oldLayout || projectDataKey(parseLayoutSessionDocument(oldLayout.document)) !== projectDataKey(layout.session))) throw new Error("The open Layout source changed; reopen its saved session explicitly.");
          const command = build(before);
          requireMutationPermission(command.type);
          const receipt = await executeWorkspaceReceipt(command, before.revision, commitOwner);
          const afterEditable = editable && proof ? reconcileWorkspaceSibling(editable, proof, receipt.workspace) : editable;
          return { previousRevision: before.revision, persistenceRevision: receipt.workspace.revision, designRevision: proof?.designRevision,
            ...(command.type === "upgrade_workspace_to_v5" ? { migration: { kind: "workspace_v5_upgrade" as const, sourceWorkspace: before, resultWorkspace: receipt.workspace } } : {}),
            value: { ...receipt, editable: afterEditable, documentOwner: receiptOwner } };
        },
        onCommitted(receipt) {
          if (!mounted.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, receipt.documentOwner)) return;
          update(current => {
            let next: WorkspaceControllerState = { ...current, editable: receipt.editable, notice: null };
            if (current.layout) {
              const entry = receipt.workspace.layoutSessions?.find(item => item.id === current.layout!.session.id);
              if (!entry) throw new Error("The sibling operation removed the open Layout session.");
              next = acceptControllerLayoutReceipt(next, { session: parseLayoutSessionDocument(entry.document), persistenceRevision: receipt.workspace.revision });
            }
            return next;
          });
        } });
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  async function executeCatalog(command: WorkspaceCommand, review?: { expectedWorkspaceRevision: number; isCurrent: () => boolean }): Promise<WorkspaceCommandValue> {
    command = parseWorkspaceCommand(command);
    requireMutationPermission(command.type);
    const allowed = new Set(["start_project_work", "create_client", "update_client", "delete_client", "create_project_with_initial_design", "create_project_with_initial_field_map", "create_project_record", "rename_project", "rename_field_map", "move_project_to_client", "create_field_map_record", "create_design_record", "create_design_draft", "create_field_design", "delete_design", "archive_and_delete_design", "delete_project", "import_design_document"]);
    if (!allowed.has(command.type)) throw new Error("Use the dedicated design, Survey or Layout command for this operation.");
    const identity = stateRef.current.editable?.identity;
    if (identity && (((command.type === "delete_design" || command.type === "archive_and_delete_design") && command.designId === identity.designId)
      || (command.type === "delete_project" && (command.projectId === identity.projectId || command.projectId === identity.payloadId))
      || (command.type === "move_project_to_client" && command.projectId === identity.projectId))) throw new Error("Close the retained design before changing or deleting its ownership.");
    let owner = renderedDocumentOwner, interactionOwner = renderedInteractionOwner;
    const handoff = catalogCloseHandoff.current;
    const admittedHandoff = handoff && handoff.intent === startup.current.intent
      && JSON.stringify(handoff.from) === JSON.stringify(owner)
      && JSON.stringify(handoff.fromInteraction) === JSON.stringify(interactionOwner)
      && isWorkspaceOperationCurrent(stateRef.current.presentation, handoff.to)
      && isWorkspaceOperationCurrent(stateRef.current.presentation, handoff.toInteraction) ? handoff : null;
    if (!isWorkspaceOperationCurrent(stateRef.current.presentation, owner)) {
      if (!admittedHandoff) throw new Error("This catalog callback belongs to an earlier workspace.");
      owner = admittedHandoff.to;
    }
    if (admittedHandoff) interactionOwner = admittedHandoff.toInteraction;
    catalogCloseHandoff.current = null;
    const intent = startup.current.intent, inputRevision = inputs.getRevision();
    const pending = () => JSON.stringify([...pendingInputEpochs.current].filter(([key]) => key !== "catalog"));
    const pendingEpochs = pending();
    const isCurrent = () => (!review || review.isCurrent()) && (!review || startup.current.intent === intent
      && inputs.getRevision() === inputRevision && pending() === pendingEpochs
      && isWorkspaceOperationCurrent(stateRef.current.presentation, interactionOwner));
    try { return (await siblingCommand(before => {
      if (review && before.revision !== review.expectedWorkspaceRevision) throw new Error("Saved catalog changed before this action. Recheck the current item and destination.");
      return command;
    }, isCurrent, owner)).value; } catch (error) { if (!review) notice(error); throw error; }
  }

  async function calculate(options: CrsQualificationOptions = {}): Promise<boolean> {
    try {
      if (busyRef.current || inputs.hasDirty() || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) throw new Error("Apply the current inputs before calculating their preview.");
      const preview = calculateWorkspaceEditable(requireEditable(), options); setCalculation(preview); return true;
    } catch (error) { notice(error); return false; }
  }
  async function completeDesign(): Promise<string | null> {
    const id = createCatalogId("design"), payloadId = createCatalogId("project");
    const ok = await recordedCommand(editable => {
      if (editable.kind !== "draft") throw new Error("Only an actual Draft can create a completed design.");
      return { type: "create_complete_design_from_draft", sourceDesignId: editable.identity.designId!, expectedDesignRevision: editable.designRevision!,
        draft: editable.editor.draft, designId: id, projectId: payloadId, name: editable.editor.draft.name,
        surveyCollectionIds: stateRef.current.collections.map(item => ({ sourceId: item.id, id: createCatalogId("survey"), expectedRevision: item.revision })), now: new Date().toISOString() };
    }, () => true, true, "atomic_draft_completion");
    if (ok) { if (mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, renderedDocumentOwner)) setSavedCompleteDesignId(id); return id; } return null;
  }
  async function createFieldFromProject(): Promise<string | null> {
    try {
      if (workspaceEditableIsDirty(requireEditable()) && !await save()) return null;
      const editable = requireManaged(), id = createCatalogId("design");
      if (editable.kind !== "project") throw new Error("Explicit independent-machine conversion requires a completed Project.");
      // Source Survey remains with its original Project; copied ownership uses the complete-bundle lane.
      await ensureWorkspaceVersion(false);
      await siblingCommand(() => ({ type: "convert_project_to_field_design", sourceDesignId: editable.identity.designId!, expectedDesignRevision: requireManaged().designRevision!,
        designId: id, fieldMapId: editable.identity.fieldMapId!, fieldId: createCatalogId("field"), waterSourceId: createCatalogId("water"), powerSourceId: createCatalogId("power"), name: `${editable.editor.project.name} independent machines`, now: new Date().toISOString() }));
      if (mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, renderedDocumentOwner)) setSavedFieldDesignId(id); return id;
    } catch (error) { notice(error); return null; }
  }
  async function ensureWorkspaceVersion(survey: boolean, extra: () => boolean = () => true): Promise<void> {
    let workspace = await readWorkspaceReceipt();
    if (!extra()) throw new Error("The entered inputs or active source changed while reading the workspace.");
    if (!workspaceHasLayoutStorage(workspace.workspaceVersion)) {
      workspace = (await siblingCommand(() => ({ type: "upgrade_workspace_to_v3", now: new Date().toISOString() }), extra)).workspace;
    }
    if (survey && !workspaceHasSurveyStorage(workspace.workspaceVersion)) await siblingCommand(() => ({ type: "upgrade_workspace_to_v4", now: new Date().toISOString() }), extra);
  }
  async function copyDesign(name: string, fieldMapId?: string): Promise<string | null> {
    if (fileJob.current || busyRef.current || savingCount.current) return null;
    const id = createCatalogId("design");
    try {
      if (designFileInputsPending()) throw new WorkspaceInputNotice("Apply, collect or discard your entered design and Survey inputs before copying their saved workspace.", () => !designFileInputsPending());
      const isCurrent = captureFileInputOwner("design");
      if (!isCurrent()) return null;
      fileJob.current = true; setFileBusy(true);
      if (workspaceEditableIsDirty(requireEditable()) && !await save()) return null;
      if (!isCurrent()) throw new Error("The entered inputs or active source changed before copying. Your work is retained; retry Copy.");
      await ensureWorkspaceVersion(true, isCurrent);
      await siblingCommand(workspace => {
        const editable = requireManaged();
        const bundle = buildDesignWorkspaceBundle(workspace, editable.identity.designId!);
        return { type: "copy_design_with_survey", sourceDesignId: editable.identity.designId!, expectedDesignRevision: editable.designRevision!, designId: id,
          payloadId: createCatalogId(editable.kind), fieldMapId: fieldMapId ?? editable.identity.fieldMapId!, name,
          collectionIds: bundle.surveyDocuments.map(document => { const item = parseSurveyCollectionDocument(document); return { sourceId: item.id, id: createCatalogId("survey"), expectedRevision: item.revision }; }), now: new Date().toISOString() };
      }, isCurrent); return id;
    } catch (error) { if (isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) notice(error); return null; }
    finally { fileJob.current = false; if (mounted.current) setFileBusy(false); }
  }
  function requirePackageDestination(workspace: WorkspaceDocument, bundle: DesignWorkspaceBundle, fieldMapId: string) {
    const field = workspace.catalog.fieldMaps.find(item => item.id === fieldMapId);
    const project = workspace.catalog.projects.find(item => item.id === field?.projectId);
    const payload = readSurveyDesignDocument(bundle.documentKind, bundle.designDocument);
    if (!field || !project || !workspace.catalog.clients.some(item => item.id === project.clientId)) throw new Error("Select an existing customer, project and destination field before importing.");
    if (project.projectCrs !== payload.projectCrs) throw new Error("Destination project CRS must exactly match the imported or copied payload; no relabelling or reprojection is performed.");
  }
  async function preparePackageStorageStep(input: DesignWorkspaceBundle, fieldMapId: string,
    review: { expectedWorkspaceRevision: number; isCurrent: () => boolean }): Promise<{ workspaceRevision: number; workspaceVersion: WorkspaceDocument["workspaceVersion"] }> {
    if (repositoryRef.current.backendInfo?.runtime !== "web") throw new Error("Package storage preparation requires the supported browser workspace.");
    const bundle = parseDesignWorkspaceBundle(input);
    const isCurrent = () => review.isCurrent() && isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner);
    const current = await readWorkspaceReceipt();
    if (!isCurrent() || current.revision !== review.expectedWorkspaceRevision) throw new Error("Saved catalog or import review changed. Recheck the current file and destination before preparing storage.");
    requirePackageDestination(current, bundle, fieldMapId);
    if (workspaceCanImportBundle(current.workspaceVersion, bundle)) return { workspaceRevision: current.revision, workspaceVersion: current.workspaceVersion };
    const receipt = await siblingCommand(before => {
      if (before.revision !== review.expectedWorkspaceRevision) throw new Error("Saved catalog changed before storage preparation. Recheck the destination; your file is retained.");
      requirePackageDestination(before, bundle, fieldMapId);
      return { type: "upgrade_workspace_to_v5", now: new Date().toISOString() };
    }, isCurrent);
    return { workspaceRevision: receipt.workspace.revision, workspaceVersion: receipt.workspace.workspaceVersion };
  }
  async function importDesignWorkspace(input: DesignWorkspaceBundle, fieldMapId: string,
    review?: { expectedWorkspaceRevision: number; isCurrent: () => boolean }): Promise<string | null> {
    const id = createCatalogId("design");
    const isCurrent = () => (!review || review.isCurrent()) && isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner);
    try {
      const bundle = parseDesignWorkspaceBundle(input);
      if (repositoryRef.current.backendInfo?.runtime !== "web") throw new Error("Complete package import requires the supported browser workspace.");
      await siblingCommand(before => {
        if (review && before.revision !== review.expectedWorkspaceRevision) throw new Error("Saved catalog changed. Recheck the import destination; the original file is retained.");
        requirePackageDestination(before, bundle, fieldMapId);
        if (!workspaceCanImportBundle(before.workspaceVersion, bundle)) throw new Error("Prepare storage for this import before saving the copy. The file and current workspace are unchanged.");
        return { type: "import_design_workspace_bundle", bundle, designId: id, payloadId: createCatalogId(bundle.documentKind), fieldMapId,
          collectionIds: bundle.surveyDocuments.map(document => { const item = parseSurveyCollectionDocument(document); return { sourceId: item.id, id: createCatalogId("survey"), expectedRevision: item.revision }; }), now: new Date().toISOString() };
      }, isCurrent);
      return id;
    } catch (error) { if (review) throw error; if (isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) notice(error); return null; }
  }

  async function openLayoutSession(id: string): Promise<boolean> {
    try {
      if (replacementGuard().busy || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return false;
      if (layoutInputsBlockOpen(id)) throw new Error("Finish or preserve the entered Layout session name and labels before opening another saved session.");
      const generation = ++openRequestGeneration.current;
      const workspace = await readWorkspaceReceipt();
      if (generation !== openRequestGeneration.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return false;
      if (layoutInputsBlockOpen(id)) throw new Error("Entered Layout inputs changed while opening the saved session. Finish or preserve them first.");
      const entry = workspace.layoutSessions?.find(item => item.id === id);
      if (!entry) throw new Error("The saved Layout session no longer exists.");
      const editable = stateRef.current.editable, session = saveSession.current;
      let admitted = workspace;
      if (editable?.identity.designId && session) {
        admitted = await saveCoordinator.reconcileRead({ session, isCurrent: () => mounted.current && generation === openRequestGeneration.current && isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner),
          async read() {
            const fresh = await readWorkspaceReceipt(), current = requireManaged();
            const proof = captureWorkspaceSiblingProof(current, fresh, true);
            return { value: { workspace: fresh, editable: reconcileWorkspaceSibling(current, proof, fresh) }, workspaceRevision: fresh.revision, designRevision: current.designRevision! };
          }, onCommitted(value) { update(current => ({ ...current, editable: value.editable })); } }).then(value => value.workspace);
      }
      if (!mounted.current || generation !== openRequestGeneration.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return false;
      const actual = admitted.layoutSessions?.find(item => item.id === id);
      if (!actual) throw new Error("The Layout session disappeared during source reconciliation.");
      return openLayout({ session: parseLayoutSessionDocument(actual.document), persistenceRevision: admitted.revision });
    } catch (error) { if (isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) notice(error); return false; }
  }
  async function createLayoutSession(name: string): Promise<boolean> {
    try {
      const initial = requireManaged();
      if (initial.kind !== "field") throw new Error("Open the surveyed field before starting RTK Layout.");
      const captured = captureLayoutLock(initial.editor.field.projectCrs, "create_rtk_layout_session");
      if (workspaceEditableIsDirty(requireEditable()) && !await save()) return false;
      if (!captured.isCurrent()) throw new Error("The RTK Fixed lock or current field changed. Start Layout again from the current position.");
      const editable = requireManaged();
      if (editable.kind !== "field") throw new Error("Create and explicitly open a saved independent-machine Field before freezing a Layout target.");
      const machines = [...editable.editor.field.machines, ...(editable.editor.field.lateralMachines ?? [])];
      const machineId = editable.editor.selectedMachineId ?? (machines.length === 1 ? machines[0].id : null);
      if (!machineId) throw new Error("Select the actual field machine to include in the frozen target.");
      await ensureProductionWorkspace();
      if (!captured.isCurrent()) throw new Error("The RTK Fixed lock changed while preparing Layout.");
      const workspace = await readWorkspaceReceipt();
      const readiness = getSurveyReadiness(workspace, editable.identity.designId!);
      if (readiness.status !== "ready" || !readiness.review) throw new Error("Complete the Survey review before starting Layout.");
      const id = createCatalogId("layout");
      const receipt = await siblingCommand(() => ({ type: "create_rtk_layout_session", sessionId: id,
        designId: editable.identity.designId!, expectedDesignRevision: editable.designRevision!, reviewId: readiness.review!.id,
        selectedMachineIds: [machineId], creationLock: captured.lock, name, now: new Date().toISOString() }), captured.isCurrent, captured.owner);
      const entry = receipt.workspace.layoutSessions!.find(item => item.id === id)!;
      // The command is committed and its busy owner released before guarded presentation.
      if (!captured.isCurrent()) { notice(new Error("The RTK Layout was saved. Open its retained record after checking the current receiver lock.")); return false; }
      return presentLayout({ session: parseLayoutSessionDocument(entry.document), persistenceRevision: receipt.workspace.revision }, true);
    } catch (error) { notice(error); return false; }
  }
  function captureLayoutLock(crs: string, type: "create_rtk_layout_session" | "finalize_rtk_layout_session") {
    requireMutationPermission(type);
    if (!isActive() || stateRef.current.presentation.mode !== "layout" || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) throw new Error("Open the current Layout controls before recording its RTK lock.");
    const actor = accessRef.current.actorId, partition = accessRef.current.partition, owner = renderedInteractionOwner;
    if (!actor) throw new Error("Sign in before starting or finalizing RTK Layout.");
    const point = receiver.capture(crs, createCatalogId("layout-lock"), "RTK Layout operation");
    const lock = layoutLockFromReceiverCapture(point, actor), source = stateRef.current.editable ? serializeWorkspaceEditable(stateRef.current.editable) : null;
    const session = stateRef.current.layout?.session;
    const machine = stateRef.current.editable?.kind === "field" ? stateRef.current.editable.editor.selectedMachineId : null;
    const isCurrent = () => {
      const live = receiver.getSnapshot(), gate = receiver.collectionGate(crs);
      return mounted.current && isActive() && hasMutationPermission(type) && isWorkspaceOperationCurrent(stateRef.current.presentation, owner)
        && accessRef.current.actorId === actor && accessRef.current.partition === partition
        && (stateRef.current.editable ? serializeWorkspaceEditable(stateRef.current.editable) : null) === source
        && (stateRef.current.editable?.kind !== "field" || stateRef.current.editable.editor.selectedMachineId === machine)
        && stateRef.current.layout?.session.id === session?.id && stateRef.current.layout?.session.targetHash === session?.targetHash
        && live.phase === "connected" && live.sessionId === lock.evidence.sessionId && live.observation?.id === lock.evidence.observationId
        && gate.accepted && gate.projectionId === lock.evidence.projection.id;
    };
    if (!isCurrent()) throw new Error("A fresh owned RTK Fixed lock is required for this Layout operation.");
    return { lock, isCurrent, owner };
  }
  async function finalizeLayoutSession(): Promise<boolean> {
    try {
      const current = stateRef.current.layout;
      if (!current) throw new Error("Open the current RTK Layout before finalizing its stations.");
      const captured = captureLayoutLock(parseFieldLayoutTarget(current.session.targetDocument).field.projectCrs, "finalize_rtk_layout_session");
      return await layoutCommand(opened => ({ type: "finalize_rtk_layout_session", sessionId: opened.session.id,
        expectedSessionRevision: opened.session.revision, finalizationLock: captured.lock, now: new Date().toISOString() }), captured.isCurrent);
    } catch (error) { notice(error); return false; }
  }
  async function layoutCommand(build: (opened: OpenedLayoutSession) => WorkspaceCommand, extra: () => boolean = () => true): Promise<boolean> {
    try {
      const current = stateRef.current.layout;
      if (!current || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) throw new Error("Open the current frozen Layout session before using this command.");
      const id = current.session.id, hash = current.session.targetHash;
      await siblingCommand(() => build(current), () => isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)
        && stateRef.current.layout?.session.id === id && stateRef.current.layout.session.targetHash === hash && extra());
      return true;
    } catch (error) { if (isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) notice(error); return false; }
  }
  async function collectLayout(label: string, targetPointId?: string, toleranceMeters?: number): Promise<boolean> {
    try {
      requireMutationPermission("append_layout_mark");
      if (stateRef.current.presentation.mode !== "layout") throw new Error("Select Layout mode before recording an observation.");
      if (!access.actorId) throw new Error("Sign in before recording a Layout position.");
      const opened = stateRef.current.layout;
      if (!opened) throw new Error("Open a frozen Layout target first.");
      if (opened.session.documentVersion !== RTK_LAYOUT_SESSION_DOCUMENT_VERSION || opened.session.referenceSourceDocument !== undefined || opened.session.finalization)
        throw new Error("This recorded map is retained history. Start a current RTK Layout to mark new stations.");
      const target = parseFieldLayoutTarget(opened.session.targetDocument), crs = target.field.projectCrs;
      const point = receiver.capture(crs, createCatalogId("layout-observation"), label);
      const evidence = point.captureEvidence;
      const observation: LayoutObservation = layoutObservationFromReceiverCapture(opened.session.id, point);
      return await layoutCommand(current => ({ type: "append_layout_mark", sessionId: current.session.id, expectedSessionRevision: current.session.revision, observation, recordedBy: access.actorId!, ...(targetPointId ? { targetPointId } : {}), ...(toleranceMeters === undefined ? {} : { toleranceMeters }), now: new Date().toISOString() }), () => {
        const live = receiver.getSnapshot(), gate = receiver.collectionGate(crs);
        return isActive() && live.phase === "connected" && live.sessionId === evidence.sessionId && live.observation?.id === evidence.observationId && gate.accepted && gate.projectionId === evidence.projection.id;
      });
    } catch (error) { notice(error); return false; }
  }
  async function renameLayout(name: string, extra: () => boolean = () => true): Promise<boolean> {
    if (!name.trim()) { notice(new Error("Enter a Layout session name before saving.")); return false; }
    if (busyRef.current || savingCount.current || fileJob.current || !extra()) return false;
    const documentOwner = renderedDocumentOwner, sessionId = stateRef.current.layout?.session.id;
    const previousPhase = layoutSaveState;
    setLayoutSaveState("saving");
    const ok = await layoutCommand(current => ({ type: "rename_layout_session", sessionId: current.session.id, expectedSessionRevision: current.session.revision, name, now: new Date().toISOString() }), extra);
    if (mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, documentOwner) && stateRef.current.layout?.session.id === sessionId) {
      setLayoutSaveState(ok ? "saved" : isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner) ? "error" : previousPhase);
    }
    return ok;
  }
  async function acknowledgeLayoutSession(extra: () => boolean = () => true): Promise<boolean> {
    const opened = stateRef.current.layout;
    if (!opened || busyRef.current || savingCount.current || fileJob.current || !extra()
      || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return false;
    const owner = renderedInteractionOwner, documentOwner = renderedDocumentOwner;
    const previousPhase = layoutSaveState;
    const expected = projectDataKey(opened.session);
    const isCurrent = () => mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, owner)
      && stateRef.current.layout?.session.id === opened.session.id && projectDataKey(stateRef.current.layout.session) === expected && extra();
    busyRef.current = true; setBusy(true); setLayoutSaveState("saving");
    try {
      const read = async () => {
        const workspace = await readWorkspaceReceipt();
        if (!isCurrent()) throw new Error("The Layout source changed while checking its saved session.");
        const entry = workspace.layoutSessions?.find(item => item.id === opened.session.id);
        if (!entry || projectDataKey(parseLayoutSessionDocument(entry.document)) !== expected) throw new Error("The saved Layout session changed in another operation. Keep entered text and reopen or reconcile its source explicitly.");
        const editable = stateRef.current.editable;
        const proof = editable?.identity.designId ? captureWorkspaceSiblingProof(editable, workspace, true) : null;
        return { workspace, editable: editable && proof ? reconcileWorkspaceSibling(editable, proof, workspace) : editable };
      };
      const commit = (receipt: Awaited<ReturnType<typeof read>>) => {
        if (!mounted.current || !isWorkspaceOperationCurrent(stateRef.current.presentation, documentOwner) || stateRef.current.layout?.session.id !== opened.session.id) return;
        update(current => acceptControllerLayoutReceipt({ ...current, editable: receipt.editable, notice: null },
          { session: opened.session, persistenceRevision: receipt.workspace.revision }));
        setLayoutSaveState("saved");
      };
      const session = saveSession.current;
      if (session && stateRef.current.editable?.identity.designId) {
        await saveCoordinator.reconcileRead({ session, isCurrent, async read() {
          const value = await read();
          return { value, workspaceRevision: value.workspace.revision, designRevision: value.editable!.designRevision! };
        }, onCommitted: commit });
      } else { const receipt = await read(); if (!isCurrent()) return false; commit(receipt); }
      return true;
    } catch (error) {
      if (mounted.current && isWorkspaceOperationCurrent(stateRef.current.presentation, documentOwner) && stateRef.current.layout?.session.id === opened.session.id) {
        if (isWorkspaceOperationCurrent(stateRef.current.presentation, owner)) { notice(error); setLayoutSaveState("error"); }
        else setLayoutSaveState(previousPhase);
      }
      return false;
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function archiveLayout(archived: boolean) { return layoutCommand(current => ({ type: "archive_layout_session", sessionId: current.session.id, expectedSessionRevision: current.session.revision, archived, now: new Date().toISOString() })); }
  async function copyLayout(name: string): Promise<string | null> {
    if (fileJob.current || busyRef.current || savingCount.current) return null;
    if (pendingInput("layout-name")) { notice(new WorkspaceInputNotice("Save the current Layout session name before copying its target.", () => !pendingInput("layout-name"))); return null; }
    const id = createCatalogId("layout");
    const isCurrent = captureFileInputOwner("layout");
    const ok = await layoutCommand(current => ({ type: "copy_layout_session", sourceSessionId: current.session.id, expectedSessionRevision: current.session.revision, sessionId: id, name, now: new Date().toISOString() }), isCurrent);
    return ok ? id : null;
  }
  async function exportDesignWorkspace(format: "json" | "zip"): Promise<ArchiveIoResult> {
    if (fileJob.current) return { ok: false, message: "Wait for the current file operation." };
    try {
      if (!isWorkspaceOperationCurrent(stateRef.current.presentation, renderedDocumentOwner) || busyRef.current) throw new Error("The export callback belongs to an earlier or busy workspace.");
      if (designFileInputsPending()) throw new WorkspaceInputNotice("Apply, collect or discard your entered design and Survey inputs before exporting their saved workspace.", () => !designFileInputsPending());
      const isCurrent = captureFileInputOwner("design");
      if (!isCurrent()) return { ok: false, message: "The export callback belongs to an earlier mode or source." };
      fileJob.current = true; setFileBusy(true);
      if (workspaceEditableIsDirty(requireEditable()) && !await save()) throw new Error("The design was not saved; current inputs are retained.");
      const editable = requireManaged(), workspace = await readWorkspaceReceipt();
      if (!isCurrent()) throw new Error("The export source or entered inputs changed while reading its saved workspace. Your work is retained; retry Export.");
      captureWorkspaceSiblingProof(editable, workspace);
      const bundle = buildDesignWorkspaceBundle(workspace, editable.identity.designId!);
      if (!isCurrent()) throw new Error("The export inputs changed before the file could be created.");
      return await exportFileAsync(`design-workspace.${format}`, format === "zip" ? exportDesignWorkspaceBundleZip(bundle) : serializeDesignWorkspaceBundle(bundle), { mimeType: format === "zip" ? "application/zip" : "application/json" });
    } catch (error) { if (isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) notice(error); return { ok: false, message: error instanceof Error ? error.message : "Workspace export failed; saved work retained." }; }
    finally { fileJob.current = false; if (mounted.current) setFileBusy(false); }
  }
  async function exportLayoutSession(format: "json" | "zip"): Promise<ArchiveIoResult> {
    const opened = stateRef.current.layout;
    if (!opened || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) return { ok: false, message: "Open the current Layout session before exporting." };
    if (fileJob.current || busyRef.current || savingCount.current) return { ok: false, message: "Wait for the current workspace operation before exporting." };
    try {
      if (pendingInput("layout-name")) throw new WorkspaceInputNotice("Save the current Layout session name before exporting its frozen target and saved observations.", () => !pendingInput("layout-name"));
      const isCurrent = captureFileInputOwner("layout");
      fileJob.current = true; setFileBusy(true);
      const workspace = await readWorkspaceReceipt();
      if (!isCurrent()) throw new Error("The Layout source or name changed while reading its saved session. Retry Export.");
      const entry = workspace.layoutSessions?.find(item => item.id === opened.session.id);
      if (!entry || projectDataKey(parseLayoutSessionDocument(entry.document)) !== projectDataKey(opened.session)) throw new Error("The saved Layout session changed. Reopen or reconcile its source before exporting.");
      const bytes = format === "zip" ? exportLayoutSessionArchiveZip(opened.session) : serializeLayoutSessionDocument(opened.session);
      if (!isCurrent()) throw new Error("The Layout export source changed before creating its file.");
      return await exportFileAsync(`layout-session.${format}`, bytes, { mimeType: format === "zip" ? "application/zip" : "application/json" });
    } catch (error) { if (isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) notice(error); return { ok: false, message: error instanceof Error ? error.message : "Layout export failed; saved work retained." }; }
    finally { fileJob.current = false; if (mounted.current) setFileBusy(false); }
  }

  async function travelHistory(direction: "undo" | "redo"): Promise<boolean> {
    try {
      if (busyRef.current || inputs.hasDirty() || stateRef.current.presentation.mode === "layout" || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) throw new Error("Finish entered text and return to Design or Survey before using history.");
      const before = stateRef.current, stack = direction === "undo" ? before.historyPast : before.historyFuture;
      const target = direction === "undo" ? stack.at(-1) : stack[0];
      if (!target || !before.editable) return false;
      const current = workspaceHistorySnapshot(before);
      const memberships = historyMemberships(target, before.collections);
      const membershipChanged = projectDataKey(target.memberships) !== projectDataKey(current.memberships);
      const restored = restoreWorkspaceEditableDocument(before.editable, target.document);
      if (membershipChanged) {
        const restoredDocument = serializeWorkspaceEditable(restored);
        const ok = await recordedCommand(editable => ({ type: "restore_design_survey_history", designId: editable.identity.designId!, expectedDesignRevision: editable.designRevision!, document: restoredDocument, memberships: historyMemberships(target, stateRef.current.collections), now: new Date().toISOString() }), () => true, false);
        if (!ok) return false;
      } else {
        const editable = restored;
        const presentation = editable.identity.projectCrs === before.editable.identity.projectCrs ? before.presentation : replaceWorkspaceDocument(before.presentation, editable.identity, { dirty: false, busy: false });
        update({ ...before, editable, presentation, mapContext: mapContextForWorkspaceDocument(editable.identity), savedState: "unsaved", notice: null });
      }
      update(next => ({ ...next,
        historyPast: direction === "undo" ? before.historyPast.slice(0, -1) : [...before.historyPast, current],
        historyFuture: direction === "undo" ? [current, ...before.historyFuture] : before.historyFuture.slice(1) }));
      return true;
    } catch (error) { notice(error); return false; }
  }

  useEffect(() => { setLayoutSaveState("saved"); }, [state.presentation.documentGeneration, state.layout?.session.id]);
  useEffect(() => {
    const retained = inputNotice.current;
    if (!retained) return;
    if (retained.generation !== stateRef.current.presentation.documentGeneration) { inputNotice.current = null; return; }
    if (!retained.error.isResolved()) return;
    inputNotice.current = null;
    if (stateRef.current.notice === retained.error.message) update(current => ({ ...current, notice: null }));
  }, [inputRevision, pendingInputRevision, state.presentation.documentGeneration]);
  function undo() { return travelHistory("undo"); }
  function redo() { return travelHistory("redo"); }

  useEffect(() => {
    if (!autosaveEnabled || autosaveFailure || busyRef.current || savingCount.current || inputs.hasDirty() || !workspaceEditableIsDirty(state.editable) || !state.editable?.identity.designId) return;
    const key = JSON.stringify([state.presentation.documentGeneration, state.editable.editor.revision]);
    if (autosaveAttempt.current === key) return;
    const timer = setTimeout(() => {
      if (!mounted.current || busyRef.current || savingCount.current || inputs.hasDirty()
        || !isWorkspaceOperationCurrent(stateRef.current.presentation, renderedDocumentOwner)
        || stateRef.current.editable?.editor.revision !== state.editable?.editor.revision) return;
      autosaveAttempt.current = key;
      void persistAppliedDesign().then(ok => { if (!ok && mounted.current) setAutosaveFailure("Autosave paused after a storage/conflict error. Inputs and history are retained; retry Save explicitly before further autosaves."); });
    }, 700);
    return () => clearTimeout(timer);
  }, [autosaveEnabled, autosaveFailure, state.editable?.editor.revision, state.presentation.documentGeneration]);

  const recovery = useWorkspaceEditRecovery({
    backend: () => repositoryRef.current.backendInfo?.runtime ?? null,
    state: () => stateRef.current, settings: () => settingsRef.current,
    collectionId: () => collectionSelection.current,
    workspaceRevision: () => knownWorkspace.current?.revision ?? null,
    workspaceReceipt: () => knownWorkspace.current,
    context: () => {
      const captured = recoveryParticipants.captureContext();
      return createResumeSnapshot(captured.catalogSelection, captured.catalogVisible);
    },
    readWorkspace: readWorkspaceReceipt,
    readLease: (revision, action, isCurrent) => {
      const read = repositoryRef.current.readWorkspaceLease;
      if (repositoryRef.current.backendInfo?.runtime !== "web" || !read) throw new Error("Restore unfinished work in the browser workspace.");
      return read(revision, action, isCurrent);
    },
    captureOwner: () => {
      const before = stateRef.current, intent = startup.current.intent, input = inputs.getRevision();
      const uiOwner = recoveryParticipants.getInputOwner(), settingsOwner = settingsRef.current;
      const receiverOwner = receiver.getSnapshot(), pending = JSON.stringify([...pendingInputEpochs.current]);
      const catalogRevision = repositoryRef.current.catalogRevision;
      return () => mounted.current && stateRef.current === before && startup.current.intent === intent
        && (recoveryParticipants.canEdit() || navigationPending.current)
        && inputs.getRevision() === input && recoveryParticipants.getInputOwner() === uiOwner
        && settingsRef.current === settingsOwner && (navigationPending.current || receiver.getSnapshot() === receiverOwner)
        && pending === JSON.stringify([...pendingInputEpochs.current]) && repositoryRef.current.catalogRevision === catalogRevision
        && !busyRef.current && !savingCount.current && !fileJob.current;
    },
    canRestore: () => {
      if (!recoveryParticipants.canEdit()) throw new Error("A previous recovery delivery remains gated. Export its retained checkpoint before resolving it.");
      if (repositoryRef.current.backendInfo?.runtime !== "web") throw new Error("Restore unfinished work in the browser workspace.");
      if (busyRef.current || savingCount.current || fileJob.current) throw new Error("Wait for the current save or workspace operation before restoring.");
      const live = receiver.getSnapshot();
      if (live.phase !== "idle" || live.sessionId !== null || live.observation !== null) throw new Error("Disconnect the receiver before restoring unfinished work. Reconnect explicitly when ready.");
      if (replacementGuard().dirty) throw new Error("Finish or preserve the current design and its entered values before restoring another checkpoint.");
    },
    publish: (next, nextSettings, collectionId, workspace) => {
      const target = next.editable?.identity.designId && next.editable.workspaceRevision !== null ? workspaceSaveTarget(next.editable) : null;
      const acceptRead = repositoryRef.current.acceptWorkspaceReadReceipt;
      if (!acceptRead) throw new Error("The repository cannot publish its reviewed read receipt.");
      acceptRead(workspace, () => mounted.current && repositoryRef.current.backendInfo?.runtime === "web");
      openRequestGeneration.current++; inputs.reset(); pendingInteractionInputs.current.clear(); pendingInputEpochs.current.clear();
      setCalculation(null); setSavedCompleteDesignId(null); setSavedFieldDesignId(null); setAutosaveEnabled(false);
      setAutosaveFailure(null); autosaveAttempt.current = null;
      startup.current.delivery = null; startup.current.accepted = null; startup.current.settled = true;
      acceptedTransition.current = null; setResumeDelivery(null); setResumePhase("settled");
      settingsRef.current = nextSettings; setSettings(nextSettings);
      setCollectionSelection(collectionId);
      saveCoordinator.retire(); saveSession.current = target ? saveCoordinator.open(target) : null;
      update(next);
    },
    captureRollbackExtras: () => {
      const previous = { calculation, savedCompleteDesignId, savedFieldDesignId, autosaveEnabled, autosaveFailure,
        autosaveAttempt: autosaveAttempt.current };
      return () => { setCalculation(previous.calculation); setSavedCompleteDesignId(previous.savedCompleteDesignId);
        setSavedFieldDesignId(previous.savedFieldDesignId); setAutosaveEnabled(previous.autosaveEnabled);
        setAutosaveFailure(previous.autosaveFailure); autosaveAttempt.current = previous.autosaveAttempt; };
    },
  }, inputs, recoveryParticipants);

  const cameraContextKey = workspaceMapContextKey(state.mapContext);
  const interactionKey = JSON.stringify([state.presentation.documentGeneration, state.presentation.interactionGeneration]);
  const crs = state.mapContext?.projectCrs ?? null;
  const gate = crs ? receiver.collectionGate(crs) : null;
  const receiverDisplay = gate?.accepted && gate.projected && liveReceiver.observation && crs
    ? { observationId: liveReceiver.observation.id, projectCrs: crs, point: gate.projected } : undefined;
  const scene: WorkspaceMapScene | null = useMemo(() => {
    const options: WorkspaceSceneOptions = receiverDisplay ? { receiver: receiverDisplay } : {};
    if (state.layout && (state.presentation.mode === "layout" || !state.editable)) return workspaceMapSceneFromSession(state.layout.session,
      { id: state.layout.session.id, generation: state.presentation.documentGeneration, inputRevision: state.layout.session.revision }, options);
    if (!state.editable) return null;
    const identity = state.editable.identity;
    return workspaceEditableScene(state.editable, { id: identity.payloadId, generation: state.presentation.documentGeneration,
      inputRevision: state.editable.editor.revision, ...(identity.designId && identity.fieldMapId
        ? { catalogOwner: { designId: identity.designId, fieldMapId: identity.fieldMapId, projectCrs: identity.projectCrs } } : {}) },
      { ...options, surveyCollections: state.collections,
        ...(calculationIsCurrent(calculation, state.editable) ? { calculation: { sourceDocumentId: calculation!.documentId, inputRevision: calculation!.inputRevision, machineIds: calculation!.machineIds, result: calculation!.results[0].result, overlays: [] } } : {}) });
  }, [state, calculation, receiverDisplay?.observationId, receiverDisplay?.point.x, receiverDisplay?.point.y]);

  async function prepareNavigationBoundary(): Promise<boolean> {
    if (navigationPending.current || recovery.hydrating || !recoveryParticipants.canEdit()) { notice(new Error("Wait for the current recovery operation before leaving this workspace.")); return false; }
    navigationPending.current = true; recoveryParticipants.setBlocked(true); setPreparingNavigation(true);
    try {
      await saveCoordinator.whenIdle();
      await Promise.allSettled([...operationJobs.current]);
      if (busyRef.current || fileJob.current || savingCount.current) throw new Error("Finish the current saved-work operation before leaving. Your inputs remain here.");
      if (!recovery.available || !recoveryParticipants.isReady() || accessRef.current.storage === null) {
        if (!replacementGuard().dirty) return true;
        throw new Error("Preserve or finish the unfinished inputs before changing accounts or workspaces.");
      }
      const waitForCheckpoint = async () => {
        if (recovery.owner.getSnapshot().phase !== "saving") return;
        await new Promise<void>(resolve => {
          const stop = recovery.owner.subscribe(() => { if (recovery.owner.getSnapshot().phase !== "saving") { stop(); resolve(); } });
          if (recovery.owner.getSnapshot().phase !== "saving") { stop(); resolve(); }
        });
      };
      await waitForCheckpoint();
      await recovery.owner.checkpoint();
      await waitForCheckpoint();
      const checkpoint = recovery.owner.getSnapshot();
      if (checkpoint.phase !== "saved" || checkpoint.message) throw new Error(checkpoint.message ?? "Unfinished inputs could not be preserved. Keep this workspace open and export recovery.");
      return true;
    } catch (error) { notice(error); return false; }
    finally { navigationPending.current = false; recoveryParticipants.setBlocked(false); if (mounted.current) setPreparingNavigation(false); }
  }
  /** Archive metadata may advance the account's workspace CAS receipt without
   * changing its domain. Prove the saved source and ledger, then rebase only the
   * loaded receipt. Raw controls, history, receiver and mounted map stay owned. */
  async function refreshMetadataReceipts(): Promise<void> {
    if (busyRef.current || fileJob.current || navigationPending.current || !mounted.current) throw new Error("Wait for the current field operation before refreshing customer status.");
    const owner = captureWorkspaceOperationOwner(stateRef.current.presentation, "document"), session = saveSession.current, actor = accessRef.current.actorId, partition = accessRef.current.partition;
    const isCurrent = () => mounted.current && accessRef.current.actorId === actor && accessRef.current.partition === partition && isWorkspaceOperationCurrent(stateRef.current.presentation, owner);
    busyRef.current = true; setBusy(true);
    try {
      const read = async () => {
        const before = knownWorkspace.current;
        const fresh = await readWorkspaceReceipt();
        if (!isCurrent()) throw new Error("The displayed field changed during customer maintenance. Its entered values remain retained.");
        const current = stateRef.current, editable = current.editable;
        if (editable?.identity.designId) {
          if (!before) throw new Error("Read the saved field before reconciling customer maintenance.");
          const owned = (workspace: WorkspaceDocument) => (workspace.surveyCollections ?? []).filter(item => parseSurveyCollectionDocument(item.document).owner.designId === editable.identity.designId).sort((a, b) => a.id.localeCompare(b.id));
          if (projectDataKey(owned(before)) !== projectDataKey(owned(fresh))) throw new Error("Saved Survey evidence changed during customer maintenance. Preserve entered work before reviewing its new source.");
        }
        const proof = editable?.identity.designId ? captureWorkspaceSiblingProof(editable, fresh, true) : null;
        let next = editable && proof ? { ...current, editable: reconcileWorkspaceSibling(editable, proof, fresh) } : current;
        if (current.layout) {
          const entry = fresh.layoutSessions?.find(item => item.id === current.layout!.session.id);
          if (!entry || projectDataKey(parseLayoutSessionDocument(entry.document)) !== projectDataKey(current.layout.session)) throw new Error("The saved Layout changed during customer maintenance. Keep entered text and review its current session.");
          next = acceptControllerLayoutReceipt(next, { session: current.layout.session, persistenceRevision: fresh.revision });
        }
        return { next, fresh };
      };
      if (session && stateRef.current.editable?.identity.designId) {
        await saveCoordinator.reconcileRead({ session, isCurrent, async read() {
          const value = await read(); return { value, workspaceRevision: value.fresh.revision, designRevision: value.next.editable!.designRevision! };
        }, onCommitted(value) { update(value.next); } });
      } else { await saveCoordinator.whenIdle(); const value = await read(); if (!isCurrent()) throw new Error("Customer status refresh retired."); update(value.next); }
      await repositoryRef.current.refreshProjects();
    } catch (error) { notice(error); throw error; }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  const displayWorkspace = knownWorkspace.current;
  const layoutAdmission = useMemo(() => workspaceLayoutAdmission(displayWorkspace, state.layout?.session.targetDocument ?? null),
    [displayWorkspace, state.layout?.session.targetDocument]);
  const surveyReadiness = useMemo(() => displayWorkspace && state.editable?.identity.designId
    ? getSurveyReadiness(displayWorkspace, state.editable.identity.designId)
    : { status: "not_started" as const, review: null, reasons: ["Open a saved field project to review its Survey."] },
  [displayWorkspace, state.editable?.identity.designId]);
  return { state, stateRef, repository, inputs, receiver, settings, setSettings: operator(changeSettings), recoveryParticipants, recovery,
    noteUserIntent, acceptLocalContext, createResumeSnapshot, restoreStartupContext, resumePhase, resumeDelivery, isResumeDeliveryCurrent,
    getLocalIntentReceipt: () => startup.current.intent, acceptedContextSequence,
    getAcceptedContextTransition: () => acceptedTransition.current, busy: busy || fileBusy || preparingNavigation || recovery.hydrating, saving, scene, cameraContextKey, interactionKey,
    referenceApplicationSupported: repository.backendInfo?.runtime === "web",
    inputRevision, pendingInputRevision, pendingInput, designInputsPending: inputs.hasDirty(), layoutSaveState,
    calculation: calculationIsCurrent(calculation, state.editable) ? calculation : null, savedCompleteDesignId, savedFieldDesignId, designViewRequest, autosaveEnabled, setAutosaveEnabled: operator(setAutosaveEnabled), autosaveFailure,
    canUndo: state.historyPast.length > 0, canRedo: state.historyFuture.length > 0,
    executeCatalog: operator(executeCatalog), calculate: operator(calculate), completeDesign: operator(completeDesign), createFieldFromProject: operator(createFieldFromProject), undo: operator(undo), redo: operator(redo), openLayoutSession: operator(openLayoutSession), createLayoutSession: operator(createLayoutSession), finalizeLayoutSession: operator(finalizeLayoutSession), collectLayout: operator(collectLayout), renameLayout: operator(renameLayout), acknowledgeLayoutSession, archiveLayout: operator(archiveLayout), copyLayout: operator(copyLayout),
    exportDesignWorkspace: operator(exportDesignWorkspace), exportLayoutSession: operator(exportLayoutSession), copyDesign: operator(copyDesign), importDesignWorkspace: operator(importDesignWorkspace), preparePackageStorageStep: operator(preparePackageStorageStep), closeDesign: operator(closeDesign), closeLayout: operator(closeLayout), setPendingInteractionInput,
    selectMachineForLayout: operator(selectMachineForLayout), useRecordedPivot: operator(useRecordedPivot), dispatchSurveyInformation: operator(dispatchSurveyInformation), prepareSurveyedField: operator(prepareSurveyedField), canEditField, canCaptureLive, canMaintainCatalog, canArchiveCatalog, fieldArchiveStatus, isActive, prepareNavigationBoundary, refreshMetadataReceipts, layoutAdmission, active: isActive(), actorId: access.actorId, prepareProductionWorkspace: operator(ensureProductionWorkspace), completeSurvey: operator(completeSurvey), declareCoordinateSystem: operator(declareCoordinateSystem),
    surveyReadiness,
    selectedCollectionId, getSelectedCollectionId: () => collectionSelection.current,
    selectedCollection: state.collections.find(collection => collection.id === selectedCollectionId) ?? null,
    selectMode: operator(selectMode), openDesign: operator(openDesign), openIndependent: operator(openIndependent), openLayout: operator(openLayout), acceptLayoutReceipt, dispatch: operator(dispatch), dispatchBatch: operator(dispatchBatch), save: operator(save),
    enableSurvey: operator(enableSurvey), startSurvey: operator(startSurvey), selectCollection: operator(selectCollection), collectSurvey: operator(collectSurvey), applySurvey: operator(applySurvey), changeMembership: operator(changeMembership),
    replacementGuard, reportError: notice,
    selectAddress(address: string | null) {
      if (isActive() && recoveryParticipants.canEdit() && isWorkspaceOperationCurrent(stateRef.current.presentation, renderedInteractionOwner)) update(current => ({ ...current, selectedAddress: address }));
    } };
}
