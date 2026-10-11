import { serializeFieldDesignDocument, type FieldDesign } from "@cplayout/core";
import type { WorkspaceDesignRead } from "@cplayout/project-store";

export interface FieldSaveReceipt {
  kind: "field"; payloadId: string; designId: string; workspaceRevision: number; designRevision: number;
}
export interface FieldReceiptBaseline {
  designId: string; payloadId: string; designRevision: number; document: string;
  context: { clientId: string; projectId: string; fieldMapId: string; designId: string };
  originalProjectDocument?: string;
}
export interface LayoutTargetSaved { fieldMapId: string; targetDocument: string }
const conflict = () => new Error("The saved field changed while this editor was open. Your edits and undo history are still here. Export field ZIP to keep this work, then return to Catalog and reopen the saved field before saving.");

/** Establish exact stored bytes only after matching the editor's known successful read/save. */
export function captureFieldReceiptBaseline(target: FieldSaveReceipt, knownSavedField: FieldDesign,
  context: { clientId: string | null; projectId: string | null; fieldMapId: string | null; designId: string | null },
  originalProjectDocument: string | undefined, read: WorkspaceDesignRead): FieldReceiptBaseline {
  assertIdentity(target, read);
  if (read.kind !== "field" || read.context.clientId !== context.clientId || read.context.projectId !== context.projectId
    || read.context.fieldMapId !== context.fieldMapId || read.context.designId !== context.designId
    || read.originalProjectDocument !== originalProjectDocument
    || serializeFieldDesignDocument(read.field) !== serializeFieldDesignDocument(knownSavedField)) throw conflict();
  return { designId: target.designId, payloadId: target.payloadId, designRevision: target.designRevision,
    document: read.document, context: { ...read.context },
    ...(read.originalProjectDocument === undefined ? {} : { originalProjectDocument: read.originalProjectDocument }) };
}

/** Advance only the shared workspace receipt; editing state and the saved field revision are untouched. */
export function reconcileFieldReceipt(target: FieldSaveReceipt, baseline: FieldReceiptBaseline, read: WorkspaceDesignRead): { target: FieldSaveReceipt; siblingWriteAdvanced: boolean } {
  assertIdentity(target, read);
  if (read.kind !== "field" || baseline.designId !== target.designId || baseline.payloadId !== target.payloadId
    || baseline.designRevision !== target.designRevision || read.document !== baseline.document
    || read.originalProjectDocument !== baseline.originalProjectDocument
    || read.context.clientId !== baseline.context.clientId || read.context.projectId !== baseline.context.projectId
    || read.context.fieldMapId !== baseline.context.fieldMapId || read.context.designId !== baseline.context.designId) throw conflict();
  return { target: { ...target, workspaceRevision: read.workspaceRevision }, siblingWriteAdvanced: read.workspaceRevision > target.workspaceRevision };
}

function assertIdentity(target: FieldSaveReceipt, read: WorkspaceDesignRead): void {
  if (read.kind !== "field" || read.design.id !== target.designId || read.design.fieldDesignId !== target.payloadId
    || read.field.id !== target.payloadId || read.design.revision !== target.designRevision
    || read.workspaceRevision < target.workspaceRevision) throw conflict();
}

export function layoutTargetSavedMatches(document: string | undefined, fieldMapId: string | null,
  saved: LayoutTargetSaved | undefined): boolean {
  return document !== undefined && fieldMapId !== null && saved !== undefined
    && saved.fieldMapId === fieldMapId && saved.targetDocument === document;
}
