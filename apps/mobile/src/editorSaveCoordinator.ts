import {
  parseDesignDraftDocument, parseProjectDocument, serializeDesignDraftDocument, serializeProjectDocument,
  parseFieldDesignDocument, serializeFieldDesignDocument,
  type DesignDraft, type PivotProject, type FieldDesign,
} from "@cplayout/core";

import { parseWorkspaceDocument, upgradeWorkspaceDocumentToV5, type WorkspaceDocument } from "@cplayout/project-store";
import { projectDataKey } from "../../../packages/core/src/projectDataComparison";
import { captureProjectSourceProof, verifyRetainedProjectSource, type ProjectSourceProof } from "./projectReceiptReconciliation";

export type EditorPersistenceRevision = number | null | undefined;
export type EditorSavePayload = { kind: "project"; project: PivotProject } | { kind: "draft"; draft: DesignDraft }
  | { kind: "field"; field: FieldDesign };
export type EditorSaveTarget =
  | { kind: "project"; payloadId: string; designId: string | null; workspaceRevision: EditorPersistenceRevision }
  | { kind: "draft" | "field"; payloadId: string; designId: string; workspaceRevision: number; designRevision: number };
export interface EditorSaveSession {
  readonly generation: number;
  readonly kind: EditorSaveTarget["kind"];
  readonly payloadId: string;
}
export interface EditorWriteOutcome {
  saved: boolean;
  persistenceRevision?: number;
  designRevision?: number;
}
export interface EditorSaveCompletion extends EditorWriteOutcome {
  session: EditorSaveSession;
  editorRevision: number;
}

/** Opaque coordinator-owned proof; cloning this token does not transfer its authority. */
export interface RetainedProjectReceipt {
  readonly session: EditorSaveSession;
  readonly workspaceRevision: number;
  readonly sourceStored: boolean;
}
interface RetainedProjectProof {
  targetRevision: number | null;
  lastWorkspaceRevision: number;
  source: ProjectSourceProof;
}

interface ProjectSiblingWriteRequest<T> {
  session: EditorSaveSession;
  sourceId: string;
  sourceStored: boolean;
  expectedRevision: number;
  write: () => Promise<T>;
}

export function createEditorSaveCoordinator() {
  const targets = new WeakMap<EditorSaveSession, EditorSaveTarget>();
  const retainedProjects = new WeakMap<RetainedProjectReceipt, RetainedProjectProof>();
  let active: EditorSaveSession | null = null;
  let generation = 0;
  let tail: Promise<void> = Promise.resolve();
  let pendingRecordedTransactions = 0;

  function targetFor(session: EditorSaveSession): EditorSaveTarget {
    const target = targets.get(session);
    if (!target) throw new Error("Save session is not owned by this editor coordinator.");
    return target;
  }

  function requireActive(session: EditorSaveSession): void {
    targetFor(session);
    if (active !== session) throw new Error("This editor was replaced; save from the current editor instead.");
  }

  function enqueue<T>(write: () => Promise<T>): Promise<T> {
    const result = tail.then(write);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function writeAlongsideProject<T extends { persistenceRevision: number } | null>(request: ProjectSiblingWriteRequest<T>): Promise<T> {
    const { session, sourceId, sourceStored, expectedRevision, write } = request;
    requireActive(session);
    assertRevision(expectedRevision, "Sibling workspace revision");
    if (session.kind !== "project") throw new Error("Sibling project writes cannot advance a draft session.");
    return enqueue(async () => {
      const receipt = await write();
      if (receipt === null) return receipt;
      assertNextRevision(expectedRevision, receipt.persistenceRevision, "Sibling workspace revision");
      const target = targetFor(session);
      // A separate creation leaves source bytes unchanged; never rebase stale or unsaved source receipts.
      if (target.kind === "project" && sourceStored && target.payloadId === sourceId && target.workspaceRevision === expectedRevision) {
        targets.set(session, { ...target, workspaceRevision: receipt.persistenceRevision });
      }
      return receipt;
    });
  }

  return {
    open(target: EditorSaveTarget): EditorSaveSession {
      validateTarget(target);
      if (!Number.isSafeInteger(generation + 1)) throw new Error("Editor session generation is exhausted.");
      const session = Object.freeze({ generation: ++generation, kind: target.kind, payloadId: target.payloadId });
      targets.set(session, { ...target });
      active = session;
      return session;
    },
    isCurrent(session: EditorSaveSession): boolean { return active === session; },
    retire(session?: EditorSaveSession): void { if (!session || active === session) active = null; },
    receipt(session: EditorSaveSession): EditorSaveTarget { return { ...targetFor(session) }; },
    /** Read-only drain. Navigation callers separately block new admissions before awaiting it. */
    async whenIdle(): Promise<void> { await tail; },

    async save(request: {
      session: EditorSaveSession;
      payload: EditorSavePayload;
      editorRevision: number;
      feedbackIsCurrent?: () => boolean;
      onCommitted?: (completion: EditorSaveCompletion) => void;
      write: (payload: EditorSavePayload, target: EditorSaveTarget, owner: { isCurrent(): boolean }) => Promise<EditorWriteOutcome>;
    }): Promise<EditorSaveCompletion> {
      const { session, editorRevision, write, feedbackIsCurrent, onCommitted } = request;
      requireActive(session);
      if (pendingRecordedTransactions > 0) throw new Error("Wait for the recorded workspace operation before saving another design snapshot.");
      assertRevision(editorRevision, "Editor revision");
      const payload = snapshotPayload(request.payload);
      const payloadId = payload.kind === "project" ? payload.project.id : payload.kind === "draft" ? payload.draft.id : payload.field.id;
      if (payload.kind !== session.kind || payloadId !== session.payloadId) throw new Error("Save payload does not belong to this editor session.");
      const owner = { isCurrent: () => active === session && (feedbackIsCurrent?.() ?? true) };
      // Accepted requests keep their snapshot and ordering even if navigation retires their UI owner.
      return enqueue(async () => {
        const target = targetFor(session);
        const outcome = await write(payload, { ...target }, owner);
        if (outcome.saved) {
          validateReceipt(target, outcome);
          targets.set(session, target.kind !== "project"
            ? { ...target, workspaceRevision: outcome.persistenceRevision!, designRevision: outcome.designRevision! }
            : { ...target, workspaceRevision: outcome.persistenceRevision });
        }
        const completion = { ...outcome, session, editorRevision };
        if (outcome.saved) onCommitted?.(completion);
        return completion;
      });
    },

    /** Shared ordering for recorded workspace operations. Earlier admitted saves
     * finish first. Unlike ordinary saves, these commands must retain their live
     * or interaction owner until the repository's final commit check. */
    async transact<T>(request: {
      session: EditorSaveSession;
      isCurrent: () => boolean;
      write: (target: EditorSaveTarget, owner: { isCurrent(): boolean }) => Promise<{
        value: T; persistenceRevision: number; designRevision?: number;
      }>;
    }): Promise<T> {
      requireActive(request.session);
      const owner = { isCurrent: () => active === request.session && request.isCurrent() };
      if (!owner.isCurrent()) throw new Error("The workspace operation is no longer current.");
      pendingRecordedTransactions++;
      try { return await enqueue(async () => {
        if (!owner.isCurrent()) throw new Error("The workspace changed while this operation waited for earlier saves.");
        const target = targetFor(request.session);
        if (target.workspaceRevision === null || target.workspaceRevision === undefined || !target.designId) {
          throw new Error("Save and associate this design with a field before recording workspace operations.");
        }
        const outcome = await request.write({ ...target }, owner);
        assertNextRevision(target.workspaceRevision, outcome.persistenceRevision, "Workspace operation revision");
        if (target.kind !== "project") {
          assertRevision(outcome.designRevision, "Recorded design revision");
          if (outcome.designRevision !== target.designRevision && outcome.designRevision !== target.designRevision + 1) {
            throw new Error("Recorded design revision changed unexpectedly; preserve the result and reopen explicitly.");
          }
          targets.set(request.session, { ...target, workspaceRevision: outcome.persistenceRevision, designRevision: outcome.designRevision });
        } else targets.set(request.session, { ...target, workspaceRevision: outcome.persistenceRevision });
        return outcome.value;
      }); } finally { pendingRecordedTransactions--; }
    },

    /** Explicit source-proof receipt refresh is not a Save or an ownership transfer. */
    async reconcileRead<T>(request: {
      session: EditorSaveSession; isCurrent: () => boolean;
      read: (target: EditorSaveTarget) => Promise<{ value: T; workspaceRevision: number; designRevision?: number }>;
      onCommitted: (value: T) => void;
    }): Promise<T> {
      requireActive(request.session);
      return enqueue(async () => {
        requireActive(request.session);
        if (!request.isCurrent()) throw new Error("The receipt source owner retired.");
        const target = targetFor(request.session), result = await request.read({ ...target });
        requireActive(request.session);
        if (!request.isCurrent() || targetFor(request.session) !== target) throw new Error("The source receipt changed during reconciliation.");
        assertRevision(result.workspaceRevision, "Reconciled workspace revision");
        if (target.workspaceRevision === null || target.workspaceRevision === undefined || result.workspaceRevision < target.workspaceRevision) throw new Error("Reconciliation cannot move the loaded receipt backwards.");
        if (target.kind !== "project" && result.designRevision !== target.designRevision) throw new Error("Reconciliation cannot bless a changed design revision.");
        targets.set(request.session, { ...target, workspaceRevision: result.workspaceRevision });
        request.onCommitted(result.value); return result.value;
      });
    },

    /** One shared queue for catalog/Layout siblings, including target-only workspaces.
     * The caller proves its exact retained source before rebasing a document receipt. */
    async exclusive<T>(request: {
      session?: EditorSaveSession;
      isCurrent: () => boolean;
      write: (target: EditorSaveTarget | null, owner: { isCurrent(): boolean }) => Promise<{ value: T; previousRevision: number; persistenceRevision: number; designRevision?: number;
        migration?: { kind: "workspace_v5_upgrade"; sourceWorkspace: WorkspaceDocument; resultWorkspace: WorkspaceDocument } }>;
      onCommitted?: (value: T) => void;
    }): Promise<T> {
      if (request.session) requireActive(request.session);
      const owner = { isCurrent: () => (!request.session || active === request.session) && request.isCurrent() };
      if (!owner.isCurrent()) throw new Error("The workspace operation is no longer current.");
      pendingRecordedTransactions++;
      try { return await enqueue(async () => {
        if (!owner.isCurrent()) throw new Error("The workspace operation retired while waiting for earlier writes.");
        const target = request.session ? targetFor(request.session) : null;
        const outcome = await request.write(target ? { ...target } : null, owner);
        if (outcome.migration) {
          const migration = outcome.migration;
          if (migration.kind !== "workspace_v5_upgrade" || migration.sourceWorkspace.revision !== outcome.previousRevision || migration.resultWorkspace.revision !== outcome.persistenceRevision) throw new Error("The explicit workspace upgrade receipt does not match its source and saved revision.");
          const result = migration.resultWorkspace;
          const v4 = parseWorkspaceDocument(result.originalWorkflowUpgradeDocument ?? "");
          const v3 = parseWorkspaceDocument(v4.originalSurveyUpgradeDocument ?? "");
          const exactSource = migration.sourceWorkspace.workspaceVersion === "cplayout-workspace-v4" ? result.originalWorkflowUpgradeDocument!
            : migration.sourceWorkspace.workspaceVersion === "cplayout-workspace-v3" ? v4.originalSurveyUpgradeDocument! : v3.originalPreviousWorkspaceDocument!;
          if (projectDataKey(parseWorkspaceDocument(exactSource)) !== projectDataKey(migration.sourceWorkspace)
            || projectDataKey(upgradeWorkspaceDocumentToV5(exactSource)) !== projectDataKey(result)) throw new Error("The workspace upgrade must retain its exact reviewed source chain and change no ordinary records.");
        } else assertNextRevision(outcome.previousRevision, outcome.persistenceRevision, "Sibling workspace revision");
        if (target && request.session) {
          if (target.workspaceRevision !== outcome.previousRevision) throw new Error("The sibling source receipt changed before its write.");
          if (target.kind !== "project") {
            assertRevision(outcome.designRevision, "Sibling design revision");
            if (outcome.designRevision !== target.designRevision) throw new Error("The sibling operation changed its retained design.");
            targets.set(request.session, { ...target, workspaceRevision: outcome.persistenceRevision });
          } else targets.set(request.session, { ...target, workspaceRevision: outcome.persistenceRevision });
        }
        request.onCommitted?.(outcome.value);
        return outcome.value;
      }); } finally { pendingRecordedTransactions--; }
    },

    /** Drain earlier saves before retaining the exact stored source around independent sibling writes. */
    async captureRetainedProject(request: { session: EditorSaveSession; read: () => Promise<WorkspaceDocument> }): Promise<RetainedProjectReceipt> {
      const { session, read } = request;
      requireActive(session);
      return enqueue(async () => {
        requireActive(session);
        const target = targetFor(session);
        if (target.kind !== "project" || target.workspaceRevision === undefined) throw new Error("Retained project reconciliation requires a versioned project editor.");
        const snapshot = await read();
        requireActive(session);
        if (targetFor(session) !== target) throw new Error("The project save receipt changed while retaining its source. Try again after saving finishes.");
        const proof = captureProjectSourceProof(snapshot, { payloadId: target.payloadId, designId: target.designId, workspaceRevision: target.workspaceRevision });
        const baseline = Object.freeze({ session: session, workspaceRevision: proof.workspaceRevision, sourceStored: proof.source.document !== null });
        retainedProjects.set(baseline, { targetRevision: target.workspaceRevision, lastWorkspaceRevision: proof.workspaceRevision, source: proof.source });
        return baseline;
      });
    },

    /** Advance only the workspace receipt; never load/reset the editor, fabricate a save, or replace its session. */
    async reconcileRetainedProject(request: { baseline: RetainedProjectReceipt; read: () => Promise<WorkspaceDocument> }): Promise<boolean> {
      const { baseline, read } = request;
      const proof = retainedProjects.get(baseline);
      if (!proof) throw new Error("Retained project proof is not owned by this editor coordinator.");
      const session = baseline.session;
      requireActive(session);
      return enqueue(async () => {
        requireActive(session);
        const target = targetFor(session);
        if (target.kind !== "project" || target.payloadId !== proof.source.payloadId || target.designId !== proof.source.designId
          || target.workspaceRevision !== proof.targetRevision) throw new Error("The project's save receipt changed after its source was retained. Capture its current saved source before continuing.");
        const snapshot = await read();
        requireActive(session);
        if (targetFor(session) !== target) throw new Error("The project save receipt changed during reconciliation. Keep your edits and retry.");
        const workspaceRevision = verifyRetainedProjectSource(snapshot, proof.source, proof.lastWorkspaceRevision);
        // An absent unsaved project stays create-only. The proof must never bless it as an update.
        const targetRevision = target.workspaceRevision === null ? null : workspaceRevision;
        targets.set(session, { ...target, workspaceRevision: targetRevision });
        proof.targetRevision = targetRevision;
        proof.lastWorkspaceRevision = workspaceRevision;
        return true;
      });
    },

    writeAlongsideProject,
    copyProject<T extends { persistenceRevision: number }>(request: ProjectSiblingWriteRequest<T>): Promise<T> {
      return writeAlongsideProject(request);
    },
  };
}

function snapshotPayload(payload: EditorSavePayload): EditorSavePayload {
  if (payload.kind === "field") return { kind: "field", field: parseFieldDesignDocument(serializeFieldDesignDocument(payload.field)) };
  return payload.kind === "draft"
    ? { kind: "draft", draft: parseDesignDraftDocument(serializeDesignDraftDocument(payload.draft)) }
    : { kind: "project", project: parseProjectDocument(serializeProjectDocument(payload.project)) };
}

function validateTarget(target: EditorSaveTarget): void {
  if (target.kind !== "project" && target.kind !== "draft" && target.kind !== "field") throw new Error("Unknown editor save kind.");
  if (typeof target.payloadId !== "string" || !target.payloadId.trim()
    || (target.designId !== null && (typeof target.designId !== "string" || !target.designId.trim()))
    || (target.kind !== "project" && target.designId === null)) {
    throw new Error("Save target requires explicit payload and design identities.");
  }
  if (target.kind !== "project") {
    assertRevision(target.workspaceRevision, "Draft workspace revision");
    assertRevision(target.designRevision, "Draft design revision");
  } else if (target.workspaceRevision !== null && target.workspaceRevision !== undefined) {
    assertRevision(target.workspaceRevision, "Project workspace revision");
  }
}

function validateReceipt(target: EditorSaveTarget, outcome: EditorWriteOutcome): void {
  if (target.workspaceRevision === undefined) {
    if (outcome.persistenceRevision !== undefined) throw new Error("Unexpected versioned receipt for a native legacy session.");
    return;
  }
  if (target.workspaceRevision === null) assertRevision(outcome.persistenceRevision, "Created project workspace revision");
  else assertNextRevision(target.workspaceRevision, outcome.persistenceRevision, "Workspace revision");
  if (target.kind !== "project") assertNextRevision(target.designRevision, outcome.designRevision, "Design revision");
}

function assertRevision(value: number | undefined, label: string): asserts value is number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is missing or invalid; reopen explicitly.`);
}

function assertNextRevision(previous: number, value: number | undefined, label: string): void {
  assertRevision(value, label);
  if (value !== previous + 1) throw new Error(`${label} did not advance exactly once; reopen explicitly.`);
}
