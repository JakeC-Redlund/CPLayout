import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createCatalogId, type WorkspaceDocument } from "@cplayout/project-store";
import type { AppSettings } from "@cplayout/core";
import type { InputRetentionStore } from "../inputRetention";
import type { UnifiedWorkspaceResume } from "../navigation/unifiedWorkspaceResume";
import { useWorkspaceRepositoryAccess } from "./WorkspaceRepositoryContext";
import { createWorkspaceEditRecoveryOwner } from "./workspaceEditRecoveryOwner";
import { createWorkspaceEditRecoveryStore } from "./workspaceEditRecoveryStore";
import type { WorkspaceControllerState } from "./workspaceControllerState";
import { captureWorkspaceControllerRecovery, workspaceControllerStateForRecovery } from "./workspaceRecoveryControllerState";
import type { WorkspaceEditRecoveryAdmission } from "./workspaceEditRecovery";
import type { WorkspaceRecoveryDelivery, WorkspaceRecoveryParticipants } from "./workspaceRecoveryParticipants";

export interface WorkspaceEditRecoveryRuntime {
  backend(): "web" | "native" | null;
  state(): WorkspaceControllerState;
  settings(): AppSettings;
  collectionId(): string | null;
  workspaceRevision(): number | null;
  workspaceReceipt(): WorkspaceDocument | null;
  context(): UnifiedWorkspaceResume;
  readWorkspace(): Promise<WorkspaceDocument>;
  readLease<T>(revision: number, action: (workspace: WorkspaceDocument, assertCurrent: () => void) => T | PromiseLike<T>, isCurrent: () => boolean): Promise<T>;
  captureOwner(): () => boolean;
  canRestore(): void;
  publish(state: WorkspaceControllerState, settings: AppSettings, collectionId: string | null, workspace: WorkspaceDocument): void;
  captureRollbackExtras(): () => void;
}
export interface WorkspaceRecoveryUiDelivery extends WorkspaceRecoveryDelivery {
  consume(): Promise<void>;
  readonly awaitingInputRevision: number | null;
  acknowledgeInputs(renderedRevision: number): void;
}

/** Uses existing controller/form values. This hook owns only recovery operations,
 * receipts and the temporary publication/delivery barrier. */
export function useWorkspaceEditRecovery(runtime: WorkspaceEditRecoveryRuntime, inputs: InputRetentionStore,
  participants: WorkspaceRecoveryParticipants) {
  const account = useWorkspaceRepositoryAccess();
  const latest = useRef(runtime); latest.current = runtime;
  const alive = useRef(true), epoch = useRef(0), activation = useRef<object>({});
  const storage = useRef<ReturnType<typeof createWorkspaceEditRecoveryStore> | null>(null);
  const [delivery, setDelivery] = useState<WorkspaceRecoveryUiDelivery | null>(null);
  const pending = useRef<{ cancel(error: Error): void } | null>(null);
  function store() {
    const backend = latest.current.backend();
    if (backend !== "web") return createWorkspaceEditRecoveryStore({ backend: "native", storage: null, withExclusiveLock: null });
    if (!storage.current) {
      // Browser getters may throw. They affect edit recovery only, never Save.
      let browserStorage: import("./workspaceEditRecoveryStore").StorageLike | null = null, locks: LockManager | null = null;
      try { browserStorage = account.storage; locks = globalThis.navigator?.locks ?? null; } catch { /* Explicit unsupported recovery surface. */ }
      storage.current = createWorkspaceEditRecoveryStore({ backend: "web", storage: browserStorage,
        withExclusiveLock: locks ? async (name, task) => await locks!.request(`${account.partition}:${name}`, { mode: "exclusive" }, task) : null });
    }
    return storage.current;
  }
  function capture(writerId: string, sequence: number) {
    const owned = latest.current, captured = participants.capture();
    return captureWorkspaceControllerRecovery(owned.state(), { writerId, sequence, capturedAt: new Date().toISOString(),
      workspaceRevision: owned.workspaceRevision(), context: owned.context(), inputs: inputs.snapshotRecovery(),
      ui: { ...captured.ui, settings: owned.settings() }, cameras: captured.cameras }, owned.workspaceReceipt());
  }
  function captureOwner() {
    const owner = latest.current.captureOwner(), capturedEpoch = epoch.current, mounted = activation.current;
    return () => alive.current && activation.current === mounted && epoch.current === capturedEpoch && owner();
  }
  function deliver(target: WorkspaceRecoveryDelivery["target"], plan: Awaited<ReturnType<typeof participants.stage>>): Promise<void> {
    const mounted = activation.current, job = {};
    let done = false, started = false;
    return new Promise<void>((resolve, reject) => {
      let inputRevision: number | null = null, inputGeneration: number | null = null, inputAcknowledgement: (() => void) | null = null;
      let cancelInputAcknowledgement: ((error: Error) => void) | null = null;
      const isCurrent = () => alive.current && activation.current === mounted && !done
        && latest.current.state().presentation.documentGeneration === target.documentGeneration;
      const value: WorkspaceRecoveryUiDelivery = { id: createCatalogId("recovery-delivery"), target, isCurrent,
        get awaitingInputRevision() { return inputRevision; },
        acknowledgeInputs(renderedRevision) {
          if (!isCurrent() || inputRevision === null || inputGeneration !== inputs.getGeneration()
            || renderedRevision < inputRevision || renderedRevision !== inputs.getRevision()) return;
          inputAcknowledgement?.(); inputAcknowledgement = null;
        },
        async consume() {
          if (!isCurrent() || started) throw new Error("This recovery delivery has retired or was already consumed.");
          started = true;
          try {
            const focus = target.admission.inputs.focus;
            if (focus) { inputs.recordFocus(focus.key); if (focus.selection) inputs.recordSelection(focus.key, focus.selection); }
            await plan.consume(value);
            if (!isCurrent()) throw new Error("The recovery controls changed before input delivery.");
            // Ordinary source effects have installed fresh canonical baselines.
            // The new ticket recomputes pending Apply; serialized clean bits do
            // not authorize any command or resurrect old setter ownership.
            const inputCommitted = new Promise<void>((acknowledge, cancel) => { inputAcknowledgement = acknowledge; cancelInputAcknowledgement = cancel; });
            inputs.restoreRecovery(inputs.stageRecovery(target.admission.inputs));
            inputRevision = inputs.getRevision(); inputGeneration = inputs.getGeneration();
            setDelivery({ ...value });
            // Parent acknowledgement follows the actual child commit with fresh
            // retained values and owners. Do not enable commands on the storage
            // notification alone.
            await inputCommitted;
            if (!isCurrent()) throw new Error("The input delivery belongs to an earlier workspace.");
            done = true; if (pending.current === cancellation) pending.current = null;
            resolve();
          } catch (error) { done = true; if (pending.current === cancellation) pending.current = null; reject(error); }
        } };
      const cancellation = { job, cancel(error: Error) { if (!done) { done = true; cancelInputAcknowledgement?.(error); reject(error); } } };
      pending.current = cancellation;
      setDelivery(value);
    });
  }
  async function stage(admission: WorkspaceEditRecoveryAdmission, workspace: WorkspaceDocument) {
    const owned = latest.current, previous = owned.state(), previousSettings = owned.settings(), previousCollection = owned.collectionId();
    const undoExtras = owned.captureRollbackExtras();
    const previousCandidate = capture("rollback", 1);
    const next = workspaceControllerStateForRecovery(previous, admission);
    const target = { admission, workspace, documentGeneration: next.presentation.documentGeneration };
    inputs.stageRecovery(admission.inputs); // All input validation precedes publication.
    const plan = await participants.stage(target);
    const current = captureOwner();
    let completion: Promise<void> | null = null;
    return {
      isCurrent: () => current() && plan.isCurrent(),
      publish() {
        if (!current() || !plan.isCurrent()) throw new Error("Recovery publication was retired.");
        participants.setBlocked(true);
        owned.publish(next, admission.ui.settings, admission.staged.context.workspace.collectionId, workspace);
        completion = deliver(target, plan);
      },
      async complete() {
        if (!completion) throw new Error("Recovery was not published.");
        await completion;
        participants.setBlocked(false); setDelivery(null); participants.refresh();
      },
      async rollback() {
        // A failed participant may have renewed its owner. Stage the retained
        // previous values against those fresh owners before the rollback publish.
        const rollbackAdmission: WorkspaceEditRecoveryAdmission = { candidate: previousCandidate, staged: previousCandidate,
          editable: previous.editable, layout: previous.layout, collections: previous.collections,
          historyPast: previous.historyPast, historyFuture: previous.historyFuture, ui: previousCandidate.ui,
          inputs: previousCandidate.inputs, requiresImportReview: previousCandidate.ui.catalog.import !== null,
          requiresCatalogReview: previousCandidate.ui.catalog.form !== null || previousCandidate.ui.catalog.moveOpen };
        const renewed = workspaceControllerStateForRecovery(latest.current.state(), rollbackAdmission);
        const rollbackState = { ...previous, presentation: renewed.presentation };
        const rollbackTarget = { admission: rollbackAdmission, workspace, documentGeneration: renewed.presentation.documentGeneration };
        const rollbackPlan = await participants.stage(rollbackTarget);
        if (!rollbackPlan.isCurrent() || !alive.current) throw new Error("Previous workspace controls cannot acknowledge rollback. Export the retained checkpoint.");
        latest.current.publish(rollbackState, previousSettings, previousCollection, workspace);
        undoExtras();
        await deliver(rollbackTarget, rollbackPlan);
        participants.setBlocked(false); setDelivery(null); participants.refresh();
      },
    };
  }
  const [owner] = useState(() => createWorkspaceEditRecoveryOwner({ store, capture, captureOwner, stage,
    readWorkspace: () => latest.current.readWorkspace(),
    readLease: (revision, action, isCurrent) => latest.current.readLease(revision, action, isCurrent),
    canRestore: () => latest.current.canRestore(), createWriterId: () => createCatalogId("edit-recovery") }));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  useSyncExternalStore(participants.subscribe, participants.getRevision, participants.getRevision);
  const available = runtime.backend() === "web", ready = available && participants.isReady();
  useEffect(() => {
    alive.current = true; activation.current = {}; owner.activate();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const changed = () => {
      epoch.current++;
      if (timer !== null) clearTimeout(timer);
      if (latest.current.backend() !== "web" || !participants.canEdit() || !participants.isReady()) return;
      timer = setTimeout(() => { timer = null; void owner.checkpoint(); }, 220);
    };
    const stopInputs = inputs.subscribeRecoveryChanges(changed), stopUi = participants.subscribe(changed);
    return () => {
      alive.current = false; activation.current = {}; owner.dispose(); stopInputs(); stopUi();
      if (timer !== null) clearTimeout(timer);
      pending.current?.cancel(new Error("The workspace unmounted during recovery.")); pending.current = null;
    };
  }, [owner, inputs, participants]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void owner.refresh();
    void latest.current.readWorkspace().then(() => { if (!cancelled && alive.current) void owner.checkpoint(); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [ready, owner]);
  useEffect(() => {
    if (!ready || !participants.canEdit()) return;
    const timer = setTimeout(() => { if (alive.current) void owner.checkpoint(); }, 220);
    return () => clearTimeout(timer);
  }, [runtime.state(), runtime.settings(), ready, owner, participants]);
  return { owner, state, delivery, hydrating: state.phase === "hydrating" || !participants.canEdit(), available };
}
