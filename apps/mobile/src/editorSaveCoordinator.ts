import {
  parseDesignDraftDocument, parseProjectDocument, serializeDesignDraftDocument, serializeProjectDocument,
  parseFieldDesignDocument, serializeFieldDesignDocument,
  type DesignDraft, type PivotProject, type FieldDesign,
} from "@cplayout/core";

import type { WorkspaceDocument } from "@cplayout/project-store";
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

    async save(request: {
      session: EditorSaveSession;
      payload: EditorSavePayload;
      editorRevision: number;
      feedbackIsCurrent?: () => boolean;
      write: (payload: EditorSavePayload, target: EditorSaveTarget, owner: { isCurrent(): boolean }) => Promise<EditorWriteOutcome>;
    }): Promise<EditorSaveCompletion> {
      const { session, editorRevision, write, feedbackIsCurrent } = request;
      requireActive(session);
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
        return { ...outcome, session, editorRevision };
      });
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
