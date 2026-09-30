import { serializeDesignDraftDocument, type DesignDraft } from "@cplayout/core";
import type { WorkspaceDesignRead } from "@cplayout/project-store";

export interface DraftSaveReceipt {
  kind: "draft"; payloadId: string; designId: string; workspaceRevision: number; designRevision: number;
}
export interface DraftReceiptBaseline {
  designId: string; payloadId: string; designRevision: number; document: string;
  context: { clientId: string; projectId: string; fieldMapId: string; designId: string };
}
const conflict = () => new Error("The saved draft changed while this editor was open. Your edits and undo history are still here. Export draft ZIP to keep applied work. Unapplied inputs remain only in this editor. Return to Projects and reopen the saved draft before saving.");

/** Establish exact stored bytes only after matching the editor's known successful read/save. */
export function captureDraftReceiptBaseline(target: DraftSaveReceipt, knownSavedDraft: DesignDraft,
  context: { clientId: string | null; projectId: string | null; fieldMapId: string | null; designId: string | null },
  read: WorkspaceDesignRead): DraftReceiptBaseline {
  assertIdentity(target, read);
  if (read.kind !== "draft" || read.context.clientId !== context.clientId || read.context.projectId !== context.projectId
    || read.context.fieldMapId !== context.fieldMapId || read.context.designId !== context.designId
    || serializeDesignDraftDocument(read.draft) !== serializeDesignDraftDocument(knownSavedDraft)) throw conflict();
  return { designId: target.designId, payloadId: target.payloadId, designRevision: target.designRevision,
    document: read.document, context: { ...read.context } };
}

/** Advance only the shared workspace receipt; editing state and the saved draft revision are untouched. */
export function reconcileDraftReceipt(target: DraftSaveReceipt, baseline: DraftReceiptBaseline, read: WorkspaceDesignRead): { target: DraftSaveReceipt; siblingWriteAdvanced: boolean } {
  assertIdentity(target, read);
  if (read.kind !== "draft" || baseline.designId !== target.designId || baseline.payloadId !== target.payloadId
    || baseline.designRevision !== target.designRevision || read.document !== baseline.document
    || read.context.clientId !== baseline.context.clientId || read.context.projectId !== baseline.context.projectId
    || read.context.fieldMapId !== baseline.context.fieldMapId || read.context.designId !== baseline.context.designId) throw conflict();
  return { target: { ...target, workspaceRevision: read.workspaceRevision }, siblingWriteAdvanced: read.workspaceRevision > target.workspaceRevision };
}

function assertIdentity(target: DraftSaveReceipt, read: WorkspaceDesignRead): void {
  if (read.kind !== "draft" || read.design.id !== target.designId || read.design.draftId !== target.payloadId
    || read.draft.id !== target.payloadId || read.design.revision !== target.designRevision
    || read.workspaceRevision < target.workspaceRevision) throw conflict();
}
