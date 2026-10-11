import {
  createDesignDraftEditorState, createFieldDesignEditorState, createProjectEditorState,
  parseDesignDraftDocument, parseFieldDesignDocument, parseProjectDocument,
  reduceDesignDraftEditorState, reduceFieldDesignEditorState, reduceProjectEditorState,
  mergeRetainedReferenceOrigins,
  serializeDesignDraftDocument, serializeFieldDesignDocument, serializeProjectDocument,
  type DesignDraftEditorAction, type DesignDraftEditorState,
  type FieldDesignEditorAction, type FieldDesignEditorState,
  type ProjectEditorAction, type ProjectEditorState,
} from "@cplayout/core";
import type { WorkspaceDesignRead } from "@cplayout/project-store";
import { parseEditableProjectDocument } from "../../../../packages/project-store/src/projectDocumentEditing";
import {
  workspaceMapSceneFromDraft, workspaceMapSceneFromField, workspaceMapSceneFromProject,
  type WorkspaceMapScene, type WorkspaceSceneFrame, type WorkspaceSceneOptions,
} from "../../../../packages/map-adapters/src/workspaceMapScene";
import type { EditorSavePayload, EditorSaveTarget } from "../editorSaveCoordinator";
import { workspaceDocumentIdentityKey, type WorkspaceDocumentIdentity } from "./workspacePresentation";

interface EditableDocumentReceipt {
  readonly identity: WorkspaceDocumentIdentity;
  /** Exact stored/imported source bytes, independent of the editable representation. */
  readonly sourceDocument: string;
  readonly workspaceRevision: number | null;
  readonly designRevision: number | null;
  readonly savedEditorRevision: number;
}
export type WorkspaceEditableDocument =
  | (EditableDocumentReceipt & { readonly kind: "draft"; readonly editor: DesignDraftEditorState })
  | (EditableDocumentReceipt & { readonly kind: "project"; readonly editor: ProjectEditorState })
  | (EditableDocumentReceipt & { readonly kind: "field"; readonly editor: FieldDesignEditorState; readonly originalProjectDocument?: string });
export type WorkspaceEditableAction =
  | { readonly kind: "draft"; readonly action: DesignDraftEditorAction }
  | { readonly kind: "project"; readonly action: Exclude<ProjectEditorAction, { type: "load_project" }> }
  | { readonly kind: "field"; readonly action: Exclude<FieldDesignEditorAction, { type: "load_field" }> };
export type ExistingWorkspaceDesign = Exclude<WorkspaceDesignRead, { kind: "not_found" }>;

export function editableFromSavedDesign(read: ExistingWorkspaceDesign): WorkspaceEditableDocument {
  const data = read.kind === "draft" ? read.draft : read.kind === "field" ? read.field : read.project;
  const common: EditableDocumentReceipt = {
    identity: Object.freeze({ ...read.context, payloadId: data.id, kind: read.kind, projectCrs: data.projectCrs }),
    sourceDocument: read.document, workspaceRevision: read.workspaceRevision,
    designRevision: read.design.revision, savedEditorRevision: 0,
  };
  return read.kind === "draft" ? { ...common, kind: "draft", editor: createDesignDraftEditorState(read.draft) }
    : read.kind === "field" ? { ...common, kind: "field", editor: createFieldDesignEditorState(read.field),
      ...(read.originalProjectDocument === undefined ? {} : { originalProjectDocument: read.originalProjectDocument }) }
      : { ...common, kind: "project", editor: createProjectEditorState(read.project) };
}

/** Independent previews have their actual payload identity and no invented catalog association. */
export function editableFromIndependentDocument(kind: WorkspaceEditableDocument["kind"], document: string): WorkspaceEditableDocument {
  const context = { clientId: null, projectId: null, fieldMapId: null, designId: null };
  const common = { sourceDocument: document, workspaceRevision: null, designRevision: null, savedEditorRevision: 0 };
  if (kind === "draft") {
    const draft = parseDesignDraftDocument(document);
    return { ...common, kind, identity: Object.freeze({ ...context, kind, payloadId: draft.id, projectCrs: draft.projectCrs }), editor: createDesignDraftEditorState(draft) };
  }
  if (kind === "field") {
    const field = parseFieldDesignDocument(document);
    return { ...common, kind, identity: Object.freeze({ ...context, kind, payloadId: field.id, projectCrs: field.projectCrs }), editor: createFieldDesignEditorState(field) };
  }
  const project = parseEditableProjectDocument(document);
  return { ...common, kind, identity: Object.freeze({ ...context, kind, payloadId: project.id, projectCrs: project.projectCrs }), editor: createProjectEditorState(project) };
}

export function serializeWorkspaceEditable(editable: WorkspaceEditableDocument): string {
  return editable.kind === "draft" ? serializeDesignDraftDocument(editable.editor.draft)
    : editable.kind === "field" ? serializeFieldDesignDocument(editable.editor.field)
      : serializeProjectDocument(editable.editor.project);
}

export function workspaceEditableIsDirty(editable: WorkspaceEditableDocument | null): boolean {
  return editable !== null && editable.editor.revision !== editable.savedEditorRevision;
}

export function reduceWorkspaceEditable(editable: WorkspaceEditableDocument, input: WorkspaceEditableAction): WorkspaceEditableDocument {
  if (input.kind !== editable.kind) throw new Error("The input belongs to another document kind.");
  // Runtime callers cannot use a load action to bypass guarded replacement/history.
  const actionType: string = input.action.type;
  if (actionType === "load_project" || actionType === "load_field") throw new Error("Use guarded Open or Reload to replace the workspace document.");
  if (editable.kind === "draft" && input.kind === "draft") {
    const editor = reduceDesignDraftEditorState(editable.editor, input.action);
    return editor === editable.editor ? editable : { ...editable, editor,
      identity: Object.freeze({ ...editable.identity, projectCrs: editor.draft.projectCrs }) };
  }
  if (editable.kind === "field" && input.kind === "field") {
    const editor = reduceFieldDesignEditorState(editable.editor, input.action);
    return editor === editable.editor ? editable : { ...editable, editor };
  }
  if (editable.kind === "project" && input.kind === "project") {
    const editor = reduceProjectEditorState(editable.editor, input.action);
    return editor === editable.editor ? editable : { ...editable, editor };
  }
  throw new Error("The editor adapter does not match the current document.");
}

export function workspaceEditableScene(editable: WorkspaceEditableDocument, frame: WorkspaceSceneFrame, options: WorkspaceSceneOptions = {}): WorkspaceMapScene {
  return editable.kind === "draft" ? workspaceMapSceneFromDraft(editable.editor.draft, frame, options)
    : editable.kind === "field" ? workspaceMapSceneFromField(editable.editor.field, frame, options)
      : workspaceMapSceneFromProject(editable.editor.project, frame, options);
}

/** One admitted user gesture may need begin+append. Validate it against one
 * source, stage every reduction, and publish one undo entry only if all succeed. */
export function reduceWorkspaceEditableBatch(editable: WorkspaceEditableDocument, actions: readonly WorkspaceEditableAction[]): WorkspaceEditableDocument {
  let next = editable;
  for (const input of actions) {
    if (input.action.type === "undo" || input.action.type === "redo") throw new Error("History commands require their own user action.");
    let admitted = input;
    if (input.kind === "draft" && input.action.type === "drawing") {
      if (input.action.expectedRevision !== editable.editor.revision) throw new Error("The drawing gesture belongs to an earlier editor revision.");
      admitted = { kind: "draft", action: { ...input.action, expectedRevision: next.editor.revision } };
    }
    const reduced = reduceWorkspaceEditable(next, admitted);
    if (reduced.editor.lastError) throw new Error(reduced.editor.lastError);
    next = reduced;
  }
  if (next.editor.revision === editable.editor.revision) return next;
  const revision = nextRevision(editable.editor.revision);
  if (editable.kind === "draft" && next.kind === "draft") return { ...next, editor: { ...next.editor,
    revision, past: [...editable.editor.past, editable.editor.draft], future: [] } };
  if (editable.kind === "field" && next.kind === "field") return { ...next, editor: { ...next.editor,
    revision, past: [...editable.editor.past, editable.editor.field], future: [] } };
  if (editable.kind === "project" && next.kind === "project") return { ...next, editor: { ...next.editor,
    revision, past: [...editable.editor.past, editable.editor.project], future: [] } };
  throw new Error("The atomic gesture changed document kind.");
}

export function workspaceSavePayload(editable: WorkspaceEditableDocument): EditorSavePayload {
  return editable.kind === "draft" ? { kind: "draft", draft: editable.editor.draft }
    : editable.kind === "field" ? { kind: "field", field: editable.editor.field }
      : { kind: "project", project: editable.editor.project };
}

export function workspaceSaveTarget(editable: WorkspaceEditableDocument): EditorSaveTarget {
  const { identity, workspaceRevision, designRevision } = editable;
  if (editable.kind === "project") return { kind: "project", payloadId: identity.payloadId,
    designId: identity.designId, workspaceRevision };
  if (!identity.designId || workspaceRevision === null || designRevision === null) {
    throw new Error("Associate this imported design with a field before saving it to the workspace.");
  }
  return { kind: editable.kind, payloadId: identity.payloadId, designId: identity.designId, workspaceRevision, designRevision };
}

/** The repository receipt is the admission source. This is an accepted domain
 * transaction, never a load/reopen action: current history and selection survive. */
export function acceptCommittedWorkspaceDesign(current: WorkspaceEditableDocument, read: ExistingWorkspaceDesign,
  expected: { readonly editorRevision: number; readonly document: string }): WorkspaceEditableDocument {
  if (workspaceEditableIsDirty(current)) throw new Error("Save the applied design before accepting a recorded Survey transaction.");
  if (current.editor.revision !== expected.editorRevision || serializeWorkspaceEditable(current) !== expected.document) {
    throw new Error("The editor changed before its recorded transaction completed. Keep the current edits and reopen the saved result explicitly.");
  }
  const incoming = editableFromSavedDesign(read);
  if (workspaceDocumentIdentityKey(incoming.identity) !== workspaceDocumentIdentityKey(current.identity)) throw new Error("The saved transaction belongs to another design or field.");
  if (current.workspaceRevision === null || current.designRevision === null
    || read.workspaceRevision < current.workspaceRevision || read.design.revision < current.designRevision) {
    throw new Error("The saved design receipt moved backwards or has no current workspace owner.");
  }
  const changed = serializeWorkspaceEditable(incoming) !== expected.document;
  const revision = changed ? nextRevision(current.editor.revision) : current.editor.revision;
  const receipt = { sourceDocument: read.document, workspaceRevision: read.workspaceRevision,
    designRevision: read.design.revision, savedEditorRevision: revision };
  if (current.kind === "draft" && incoming.kind === "draft") return { ...current, ...receipt,
    editor: { ...current.editor, draft: incoming.editor.draft, revision, lastError: null,
      lockedCrs: current.editor.lockedCrs ?? incoming.editor.lockedCrs,
      past: changed ? [...current.editor.past, current.editor.draft] : current.editor.past,
      future: changed ? [] : current.editor.future } };
  if (current.kind === "field" && incoming.kind === "field") {
    if (current.originalProjectDocument !== incoming.originalProjectDocument) throw new Error("The retained original project source changed during the transaction.");
    return { ...current, ...receipt, editor: { ...current.editor, field: incoming.editor.field, revision, lastError: null,
      selectedMachineId: incoming.editor.field.machines.some(machine => machine.id === current.editor.selectedMachineId) ? current.editor.selectedMachineId : null,
      past: changed ? [...current.editor.past, current.editor.field] : current.editor.past,
      future: changed ? [] : current.editor.future } };
  }
  if (current.kind === "project" && incoming.kind === "project") return { ...current, ...receipt,
    editor: { ...current.editor, project: incoming.editor.project, revision, lastError: null,
      past: changed ? [...current.editor.past, current.editor.project] : current.editor.past,
      future: changed ? [] : current.editor.future } };
  throw new Error("The saved transaction changed document kind.");
}

/** A save acknowledgement advances its source receipt and saved revision only.
 * Edits admitted after the save snapshot retain their history and remain unsaved. */
export function acknowledgeWorkspaceSave(current: WorkspaceEditableDocument, read: ExistingWorkspaceDesign,
  request: { readonly editorRevision: number; readonly document: string }): WorkspaceEditableDocument {
  const incoming = editableFromSavedDesign(read);
  if (workspaceDocumentIdentityKey(incoming.identity) !== workspaceDocumentIdentityKey(current.identity)
    || serializeWorkspaceEditable(incoming) !== request.document) throw new Error("The saved source differs from the admitted save snapshot.");
  if (!Number.isSafeInteger(request.editorRevision) || request.editorRevision < 0 || request.editorRevision > current.editor.revision
    || (current.workspaceRevision !== null && read.workspaceRevision < current.workspaceRevision)
    || (current.designRevision !== null && read.design.revision < current.designRevision)) throw new Error("The save acknowledgement has a stale or invalid revision.");
  if (current.kind === "field" && incoming.kind === "field" && current.originalProjectDocument !== incoming.originalProjectDocument) {
    throw new Error("The retained original project source changed during saving.");
  }
  return { ...current, sourceDocument: read.document, workspaceRevision: read.workspaceRevision,
    designRevision: read.design.revision, savedEditorRevision: request.editorRevision };
}

/** Local history restores actual values, never resets the loaded receipt or clears raw inputs. */
export function restoreWorkspaceEditableDocument(current: WorkspaceEditableDocument, document: string): WorkspaceEditableDocument {
  const restored = editableFromIndependentDocument(current.kind, document);
  if (restored.identity.payloadId !== current.identity.payloadId) throw new Error("History belongs to another document.");
  const revision = nextRevision(current.editor.revision);
  if (current.kind === "draft" && restored.kind === "draft") {
    if (current.editor.lockedCrs !== null && restored.identity.projectCrs !== current.editor.lockedCrs) throw new Error("History cannot relabel the retained drawing coordinate frame.");
    // Reuse the actual Draft history transition so removing the first captured
    // vertices cannot discard its durable drawing CRS lock.
    const traveled = reduceDesignDraftEditorState({ ...current.editor, past: [restored.editor.draft], future: [] }, { type: "undo" });
    if (traveled.lastError) throw new Error(traveled.lastError);
    return { ...current, identity: Object.freeze({ ...current.identity, projectCrs: traveled.draft.projectCrs }), editor: { ...traveled,
      revision, past: [...current.editor.past, current.editor.draft], future: [] } };
  }
  if (current.identity.projectCrs !== restored.identity.projectCrs) throw new Error("History cannot relabel existing projected coordinates.");
  if (current.kind === "project" && restored.kind === "project") return { ...current, editor: { ...current.editor,
    project: mergeRetainedReferenceOrigins(current.editor.project, restored.editor.project), revision, lastError: null, past: [...current.editor.past, current.editor.project], future: [] } };
  if (current.kind === "field" && restored.kind === "field") return { ...current, editor: { ...current.editor,
    field: mergeRetainedReferenceOrigins(current.editor.field, restored.editor.field), revision, lastError: null, past: [...current.editor.past, current.editor.field], future: [],
    selectedMachineId: restored.editor.field.machines.some(machine => machine.id === current.editor.selectedMachineId) ? current.editor.selectedMachineId : null } };
  throw new Error("History changed document kind.");
}

function nextRevision(revision: number): number {
  if (!Number.isSafeInteger(revision) || revision < 0 || revision === Number.MAX_SAFE_INTEGER) throw new Error("Editor revision is exhausted; preserve your work and reopen explicitly.");
  return revision + 1;
}
