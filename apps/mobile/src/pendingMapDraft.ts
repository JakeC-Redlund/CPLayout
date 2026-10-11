import type { ProjectMutationResult } from "@cplayout/core";
import type {
  MapDraftHandoffResult,
  MapDraftOwner,
  MapDraftPurposeReceipt,
  PendingMapFeatureDraft,
} from "@cplayout/map-adapters";

export interface PendingMapDraftScope {
  projectId: string;
  projectCrs: string;
  projectGeneration: number;
  editable: boolean;
  /** Catalog may retain the current owner's draft while all draft commands are disabled. */
  suspended?: boolean;
}

export interface PendingMapDraftState {
  owner: MapDraftOwner;
  draft: PendingMapFeatureDraft;
  error: string | null;
}

function cloneDraft(draft: PendingMapFeatureDraft): PendingMapFeatureDraft {
  return { ...draft, vertices: draft.vertices.map((vertex) => ({ ...vertex })) };
}

function sameOwner(left: MapDraftOwner, right: MapDraftOwner): boolean {
  return left.projectId === right.projectId
    && left.projectCrs === right.projectCrs
    && left.projectGeneration === right.projectGeneration
    && left.draftId === right.draftId;
}

export function createPendingMapDraftSession(getScope: () => PendingMapDraftScope) {
  let pending: PendingMapDraftState | null = null;
  let draftId = 0;
  let sequence = 0;
  const applying = new Set<PendingMapDraftState>();

  function current(): PendingMapDraftState | null {
    const scope = getScope();
    if (pending && ((!scope.editable && !scope.suspended)
      || pending.owner.projectId !== scope.projectId
      || pending.owner.projectCrs !== scope.projectCrs
      || pending.owner.projectGeneration !== scope.projectGeneration)) {
      pending = null;
    }
    return pending;
  }

  function receipt(
    state: PendingMapDraftState,
    outcome: MapDraftPurposeReceipt["outcome"],
    message: string,
  ): MapDraftPurposeReceipt {
    return { owner: { ...state.owner }, sequence: ++sequence, outcome, message };
  }

  return {
    getSnapshot(): PendingMapDraftState | null {
      const state = current();
      return state ? { owner: { ...state.owner }, draft: cloneDraft(state.draft), error: state.error } : null;
    },

    begin(draft: PendingMapFeatureDraft, expectedScope: PendingMapDraftScope): MapDraftHandoffResult {
      const scope = getScope();
      current();
      // Reject retained render callbacks before adopting any pending ownership.
      if (!scope.editable || scope.suspended || !expectedScope.editable || expectedScope.suspended) {
        return { ok: false, error: "Map drafts cannot be edited in the current view." };
      }
      if (scope.projectId !== expectedScope.projectId
        || scope.projectCrs !== expectedScope.projectCrs
        || scope.projectGeneration !== expectedScope.projectGeneration) {
        return { ok: false, error: "The map draft belongs to an outdated project or view." };
      }
      if (current()) return { ok: false, error: "Save or cancel the pending map draft first." };
      const owner: MapDraftOwner = {
        projectId: scope.projectId,
        projectCrs: scope.projectCrs,
        projectGeneration: scope.projectGeneration,
        draftId: ++draftId,
      };
      pending = { owner, draft: cloneDraft(draft), error: null };
      return { ok: true, owner: { ...owner } };
    },

    save(
      owner: MapDraftOwner,
      apply: (draft: PendingMapFeatureDraft) => ProjectMutationResult,
      successMessage: string,
    ): MapDraftPurposeReceipt | null {
      const state = current();
      const scope = getScope();
      if (!scope.editable || scope.suspended || !state || !sameOwner(state.owner, owner) || applying.has(state)) return null;
      let result: ProjectMutationResult;
      applying.add(state);
      try {
        result = apply(cloneDraft(state.draft));
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      } finally {
        applying.delete(state);
      }
      // An apply callback may invalidate this draft and synchronously start newer work.
      if (current() !== state) return null;
      if (!result.ok) {
        pending = { ...state, error: result.error };
        return receipt(state, "rejected", result.error);
      }
      pending = null;
      return receipt(state, "committed", successMessage);
    },

    cancel(owner: MapDraftOwner): MapDraftPurposeReceipt | null {
      const state = current();
      const scope = getScope();
      if (!scope.editable || scope.suspended || !state || !sameOwner(state.owner, owner) || applying.has(state)) return null;
      pending = null;
      return receipt(state, "cancelled", "Map draft cancelled. Project unchanged.");
    },

    invalidate(): void {
      pending = null;
    },
  };
}
