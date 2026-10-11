import type { WorkspaceDocument } from "@cplayout/project-store";
import { resolveWorkspaceEditRecovery, serializeWorkspaceEditRecovery, workspaceRecoveryStableJson,
  type WorkspaceEditRecoveryAdmission, type WorkspaceEditRecoveryCandidate } from "./workspaceEditRecovery";
import type { createWorkspaceEditRecoveryStore, WorkspaceEditRecoveryStoredCandidate } from "./workspaceEditRecoveryStore";

export interface WorkspaceRecoveryReview {
  readonly writerId: string; readonly sequence: number; readonly kind: "ready" | "reconcile_required";
  readonly workspaceRevision: number;
}
export interface WorkspaceRecoveryInstallation {
  isCurrent(): boolean;
  publish(): void;
  complete(): Promise<void>;
  rollback(): Promise<void>;
}
export interface WorkspaceEditRecoveryOwnerDependencies {
  store(): ReturnType<typeof createWorkspaceEditRecoveryStore>;
  readWorkspace(): Promise<WorkspaceDocument>;
  readLease<T>(revision: number, action: (workspace: WorkspaceDocument, assertCurrent: () => void) => T | PromiseLike<T>, isCurrent: () => boolean): Promise<T>;
  capture(writerId: string, sequence: number): WorkspaceEditRecoveryCandidate;
  captureOwner(): () => boolean;
  canRestore(): void;
  stage(admission: WorkspaceEditRecoveryAdmission, workspace: WorkspaceDocument): Promise<WorkspaceRecoveryInstallation>;
  createWriterId(): string;
}
export interface WorkspaceEditRecoveryOwnerState {
  readonly phase: "idle" | "checking" | "saving" | "saved" | "error" | "hydrating";
  readonly message: string | null;
  readonly candidates: readonly WorkspaceEditRecoveryStoredCandidate[];
}

/** Checkpoint metadata only; working documents and inputs remain controller-owned. */
export function createWorkspaceEditRecoveryOwner(deps: WorkspaceEditRecoveryOwnerDependencies) {
  let alive = true, activation: object = {}, activeRestore: object | null = null;
  let writer = { id: deps.createWriterId(), sequence: null as number | null };
  let checkpointRunning = false, checkpointWanted = false, lastSignature: string | null = null;
  let candidateEpoch = 0, refreshSequence = 0;
  let state: WorkspaceEditRecoveryOwnerState = Object.freeze({ phase: "idle", message: null, candidates: Object.freeze([]) });
  const listeners = new Set<() => void>();
  const reviews = new WeakMap<WorkspaceRecoveryReview, { raw: string; isCurrent: () => boolean }>();
  const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
  function publish(update: Partial<WorkspaceEditRecoveryOwnerState>) {
    if (!alive) return;
    state = Object.freeze({ ...state, ...update }); listeners.forEach(listener => listener());
  }
  function own() { const generation = activation; return () => alive && activation === generation; }
  async function refresh() {
    const lifetime = own(), capturedEpoch = candidateEpoch, sequence = ++refreshSequence;
    const current = () => lifetime() && capturedEpoch === candidateEpoch && sequence === refreshSequence;
    try { const candidates = await deps.store().readCandidates(); if (current()) publish({ candidates: Object.freeze(candidates), message: null }); }
    catch (error) { if (current()) publish({ phase: "error", message: errorText(error) }); }
  }
  async function checkpoint() {
    checkpointWanted = true;
    if (checkpointRunning || activeRestore || !alive) return;
    checkpointRunning = true;
    const lifetime = own();
    try {
      while (checkpointWanted && lifetime() && !activeRestore) {
        checkpointWanted = false;
        const ownedWriter = writer, isCurrent = deps.captureOwner();
        if (!lifetime() || !isCurrent()) continue;
        const candidate = deps.capture(ownedWriter.id, (ownedWriter.sequence ?? 0) + 1);
        const signature = workspaceRecoveryStableJson({ ...candidate, writerId: "semantic", sequence: 1, capturedAt: "2000-01-01T00:00:00.000Z" });
        if (signature === lastSignature) continue;
        publish({ phase: "saving", message: null });
        try {
          const receipt = await deps.store().checkpoint(candidate, ownedWriter.sequence, () => lifetime() && writer === ownedWriter && !activeRestore && isCurrent());
          if (!lifetime() || writer !== ownedWriter) continue;
          ownedWriter.sequence = receipt.sequence; lastSignature = signature;
          candidateEpoch++;
          publish({ phase: "saved", message: null, candidates: Object.freeze([...state.candidates.filter(item => item.writerId !== receipt.writerId), receipt]) });
        } catch (error) {
          if (!lifetime()) continue;
          // An obsolete capture cannot authorize a retry. Only another observed
          // change can request fresh work; otherwise a retired owner would spin.
          if (!isCurrent()) continue;
          publish({ phase: "error", message: errorText(error) });
        }
      }
    } catch (error) { if (lifetime()) publish({ phase: "error", message: errorText(error) }); }
    finally {
      checkpointRunning = false;
      if (checkpointWanted && alive && !activeRestore) void checkpoint();
    }
  }
  async function prepareRestore(writerId: string): Promise<WorkspaceRecoveryReview | null> {
    const lifetime = own(), isCurrent = deps.captureOwner();
    publish({ phase: "checking", message: null });
    try {
      const candidate = (await deps.store().readCandidates()).find(item => item.writerId === writerId);
      if (!candidate) throw new Error("That recovery checkpoint changed. Refresh the list.");
      const workspace = await deps.readWorkspace();
      if (!lifetime() || !isCurrent()) throw new Error("The workspace changed while reviewing recovery. Review it again.");
      const resolution = resolveWorkspaceEditRecovery(candidate.candidate, workspace);
      if ("reason" in resolution) throw new Error(resolution.reason);
      const review = Object.freeze({ writerId, sequence: candidate.sequence, kind: resolution.kind, workspaceRevision: workspace.revision });
      reviews.set(review, { raw: candidate.raw, isCurrent: () => lifetime() && isCurrent() }); publish({ phase: "idle", message: null });
      return review;
    } catch (error) { if (lifetime()) publish({ phase: "error", message: errorText(error) }); return null; }
  }
  async function restore(review: WorkspaceRecoveryReview): Promise<boolean> {
    const reviewed = reviews.get(review); reviews.delete(review);
    if (!reviewed || activeRestore || checkpointRunning || !alive) { publish({ phase: "error", message: "Recovery review changed or a checkpoint is still saving. Review again." }); return false; }
    const lifetime = own(), job = {}; activeRestore = job;
    const current = () => lifetime() && activeRestore === job && reviewed.isCurrent();
    let installation: WorkspaceRecoveryInstallation | null = null, published = false;
    try {
      deps.canRestore();
      if (!current()) throw new Error("Recovery review belongs to earlier inputs. Review it again.");
      installation = await deps.readLease(review.workspaceRevision, async (workspace, assertCurrent) => {
        const stored = (await deps.store().readCandidates()).find(item => item.writerId === review.writerId);
        if (!stored || stored.sequence !== review.sequence || stored.raw !== reviewed.raw) throw new Error("Recovery checkpoint changed before restoring. Review it again.");
        const resolution = resolveWorkspaceEditRecovery(stored.candidate, workspace);
        if ("reason" in resolution) throw new Error(resolution.reason);
        const prepared = await deps.stage(resolution.admission, workspace);
        await deps.store().withReviewedCandidate(review.writerId, review.sequence, reviewed.raw, current, (_candidate, assertRecoveryCurrent) => {
          deps.canRestore();
          if (!current() || !prepared.isCurrent()) throw new Error("Entered values changed before recovery publication.");
          assertCurrent(); assertRecoveryCurrent();
          publish({ phase: "hydrating", message: null });
          // Subscribers/participant admission may expose a reentrant change.
          // Recheck both literal ledgers after those calls, before UI mutation.
          if (!prepared.isCurrent()) throw new Error("The staged controls changed before recovery publication.");
          assertCurrent(); assertRecoveryCurrent();
          installation = prepared; published = true; prepared.publish();
        });
        return prepared;
      }, current);
      await installation.complete();
      if (!lifetime() || activeRestore !== job) throw new Error("Recovery delivery was retired.");
      writer = { id: deps.createWriterId(), sequence: null }; lastSignature = null;
      publish({ phase: "idle", message: "Unfinished work restored. Apply its inputs and Save when ready." });
      return true;
    } catch (error) {
      if (published && installation && lifetime()) {
        try { await installation.rollback(); }
        catch (rollbackError) { publish({ phase: "error", message: `Recovery remains gated after an incomplete rollback: ${errorText(rollbackError)}. Export the retained checkpoint.` }); return false; }
      }
      if (lifetime()) publish({ phase: "error", message: errorText(error) }); return false;
    } finally {
      if (activeRestore === job) activeRestore = null;
      if (checkpointWanted && alive && !checkpointRunning && !activeRestore) void checkpoint();
    }
  }
  async function discard(writerId: string, sequence: number): Promise<boolean> {
    const lifetime = own(), isCurrent = deps.captureOwner();
    try {
      await deps.store().discard(writerId, sequence, () => lifetime() && !activeRestore && isCurrent());
      if (!lifetime()) return false;
      if (writer.id === writerId) { writer = { id: deps.createWriterId(), sequence: null }; lastSignature = null; }
      candidateEpoch++;
      publish({ candidates: Object.freeze(state.candidates.filter(item => item.writerId !== writerId)), message: "Recovery checkpoint discarded; saved documents are unchanged." }); return true;
    } catch (error) { if (lifetime()) publish({ phase: "error", message: errorText(error) }); return false; }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    activate() {
      if (!alive) { writer = { id: deps.createWriterId(), sequence: null }; lastSignature = null; }
      alive = true; activation = {};
    },
    dispose() { alive = false; activation = {}; activeRestore = null; checkpointWanted = false; },
    refresh, checkpoint, prepareRestore, restore, discard,
    exportCandidate: (writerId: string) => deps.store().exportCandidate(writerId),
    exportRawLedger: () => deps.store().exportRawLedger(),
    exportCurrent: () => serializeWorkspaceEditRecovery(deps.capture(writer.id, (writer.sequence ?? 0) + 1)),
    isRestoring: () => activeRestore !== null,
  };
}
