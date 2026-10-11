import { recordWorkspaceHistory, type WorkspaceHistorySnapshot } from "./workspaceIntegration";
import { parseLayoutSessionDocument, parseSurveyCollectionDocument, type SurveyCollection } from "@cplayout/core";
import type { OpenedLayoutSession } from "../hooks/useProjectRepository";
import { mapContextForLayoutSession, mapContextForWorkspaceDocument, sameWorkspaceMapContext, type WorkspaceMapContext } from "./workspaceMapContext";
import { createWorkspacePresentation, replaceWorkspaceDocument, renewWorkspaceDocumentGeneration,
  retireWorkspaceInteractions, selectWorkspaceMode, workspaceDocumentIdentityKey, type WorkspaceMode, type WorkspacePresentation } from "./workspacePresentation";
import { reduceWorkspaceEditable, reduceWorkspaceEditableBatch, workspaceEditableIsDirty, type WorkspaceEditableAction, type WorkspaceEditableDocument } from "./workspaceDocumentAdapters";

export interface WorkspaceControllerState {
  readonly presentation: WorkspacePresentation;
  readonly editable: WorkspaceEditableDocument | null;
  readonly mapContext: WorkspaceMapContext | null;
  readonly layout: OpenedLayoutSession | null;
  readonly collections: readonly SurveyCollection[];
  readonly selectedAddress: string | null;
  readonly savedState: "saved" | "unsaved" | "saving" | "error";
  readonly notice: string | null;
  readonly historyPast: readonly WorkspaceHistorySnapshot[];
  readonly historyFuture: readonly WorkspaceHistorySnapshot[];
}
export interface WorkspaceReplacementGuard { readonly dirty: boolean; readonly busy: boolean }

export function createWorkspaceControllerState(): WorkspaceControllerState {
  return { presentation: createWorkspacePresentation(null), editable: null, mapContext: null,
    layout: null, collections: [], selectedAddress: null, savedState: "saved", notice: null, historyPast: [], historyFuture: [] };
}

/** This is the entire mode transition. No domain reducer, source receipt, camera,
 * input store, drawing history or receiver lifecycle participates. */
export function selectControllerMode(state: WorkspaceControllerState, mode: WorkspaceMode): WorkspaceControllerState {
  const presentation = selectWorkspaceMode(state.presentation, mode);
  return presentation === state.presentation ? state : { ...state, presentation };
}

export function openControllerDocument(state: WorkspaceControllerState, editable: WorkspaceEditableDocument,
  guard: WorkspaceReplacementGuard | null, reload = false): WorkspaceControllerState {
  const sameIdentity = workspaceDocumentIdentityKey(state.presentation.document) === workspaceDocumentIdentityKey(editable.identity);
  if (sameIdentity && !reload) return state;
  const presentation = sameIdentity ? renewWorkspaceDocumentGeneration(state.presentation, guard)
    : replaceWorkspaceDocument(state.presentation, editable.identity, guard);
  const context = mapContextForWorkspaceDocument(editable.identity);
  const layout = state.layout && sameWorkspaceMapContext(mapContextForLayoutSession(state.layout.session), context) ? state.layout : null;
  return { ...state, presentation, editable, mapContext: context, layout, collections: [], selectedAddress: null,
    savedState: editable.workspaceRevision === null ? "unsaved" : "saved", notice: null, historyPast: [], historyFuture: [] };
}

export function closeControllerDocument(state: WorkspaceControllerState, guard: WorkspaceReplacementGuard | null): WorkspaceControllerState {
  if (!state.editable) return state;
  const presentation = replaceWorkspaceDocument(state.presentation, null, guard);
  return { ...state, presentation, editable: null, collections: [], selectedAddress: null,
    mapContext: state.layout ? mapContextForLayoutSession(state.layout.session) : null, savedState: "saved", notice: null, historyPast: [], historyFuture: [] };
}

export function reduceControllerDocument(state: WorkspaceControllerState, action: WorkspaceEditableAction): WorkspaceControllerState {
  if (state.presentation.mode !== "design") throw new Error("Return to Design mode to edit the design.");
  if (!state.editable) throw new Error("Open a design before editing.");
  const editable = reduceWorkspaceEditable(state.editable, action);
  return publishEditableReduction(state, editable);
}

export function reduceControllerDocumentBatch(state: WorkspaceControllerState, actions: readonly WorkspaceEditableAction[]): WorkspaceControllerState {
  if (state.presentation.mode !== "design") throw new Error("Return to Design mode to edit the design.");
  if (!state.editable) throw new Error("Open a design before editing.");
  return publishEditableReduction(state, reduceWorkspaceEditableBatch(state.editable, actions));
}

function publishEditableReduction(state: WorkspaceControllerState, editable: WorkspaceEditableDocument): WorkspaceControllerState {
  if (editable === state.editable) return state;
  const context = mapContextForWorkspaceDocument(editable.identity);
  // CRS may be supplied to a genuinely empty Draft. Rebind only that explicit input change.
  const changedIdentity = workspaceDocumentIdentityKey(editable.identity) !== workspaceDocumentIdentityKey(state.presentation.document);
  const presentation = changedIdentity ? replaceWorkspaceDocument(state.presentation, editable.identity, { dirty: false, busy: false }) : state.presentation;
  return recordWorkspaceHistory(state, { ...state, presentation, editable, mapContext: context,
    savedState: workspaceEditableIsDirty(editable) ? "unsaved" : state.savedState,
    notice: editable.editor.lastError });
}

/** Explicit Open in Layout admits a real frozen target; it cannot give an independent
 * target a fabricated editable design. Different map contexts require replacement admission. */
export function openControllerLayout(state: WorkspaceControllerState, input: OpenedLayoutSession,
  guard: WorkspaceReplacementGuard | null): WorkspaceControllerState {
  const session = parseLayoutSessionDocument(input.session);
  if (state.layout?.session.id === session.id) {
    const retained = state.layout.session;
    if (retained.targetHash !== session.targetHash || retained.targetDocument !== session.targetDocument
      || retained.fieldMapId !== session.fieldMapId) throw new Error("This Layout session identity already belongs to its exact immutable target. Import another target with a new session identity.");
    // Selecting the retained session is presentation only. Saved observation/name
    // receipts have a separate explicit acknowledgement path.
    return selectControllerMode(state, "layout");
  }
  const context = mapContextForLayoutSession(session);
  const changesContext = !sameWorkspaceMapContext(state.mapContext, context);
  const changesSession = !!state.layout && state.layout.session.id !== session.id;
  if ((changesContext || changesSession) && (!guard || guard.dirty !== false || guard.busy !== false)) {
    throw new Error("Save or preserve your current design and unfinished inputs before opening a Layout target in another field.");
  }
  const aligned = state.editable && sameWorkspaceMapContext(mapContextForWorkspaceDocument(state.editable.identity), context);
  let presentation = aligned ? state.presentation : replaceWorkspaceDocument(state.presentation, null, guard);
  if (!state.layout || state.layout.session.id !== session.id || state.layout.session.targetHash !== session.targetHash) presentation = retireWorkspaceInteractions(presentation);
  presentation = selectWorkspaceMode(presentation, "layout");
  return { ...state, presentation, editable: aligned ? state.editable : null, mapContext: context,
    layout: { session, persistenceRevision: input.persistenceRevision }, collections: aligned ? state.collections : [],
    selectedAddress: changesContext ? null : state.selectedAddress,
    savedState: aligned ? state.savedState : "saved", notice: null };
}

export function acceptControllerLayoutReceipt(state: WorkspaceControllerState, input: OpenedLayoutSession): WorkspaceControllerState {
  const current = state.layout;
  const session = parseLayoutSessionDocument(input.session);
  if (!current || current.session.id !== session.id || current.session.targetHash !== session.targetHash
    || current.session.targetDocument !== session.targetDocument || current.session.fieldMapId !== session.fieldMapId) {
    throw new Error("The saved Layout receipt does not match the open frozen target.");
  }
  if (input.persistenceRevision < current.persistenceRevision || session.revision < current.session.revision) throw new Error("The Layout receipt moved backwards.");
  return { ...state, layout: { session, persistenceRevision: input.persistenceRevision }, notice: null };
}

export function retainControllerCollections(state: WorkspaceControllerState, inputs: readonly SurveyCollection[]): WorkspaceControllerState {
  const identity = state.editable?.identity;
  if (!identity?.designId || !identity.fieldMapId || !identity.projectCrs) {
    if (inputs.length) throw new Error("A collection requires its actual managed design and field owner.");
    return state.collections.length ? { ...state, collections: [] } : state;
  }
  const ids = new Set<string>();
  const collections = inputs.map(input => {
    const collection = parseSurveyCollectionDocument(input), owner = collection.owner;
    if (ids.has(collection.id) || owner.designId !== identity.designId || owner.documentKind !== identity.kind
      || owner.payloadId !== identity.payloadId || owner.fieldMapId !== identity.fieldMapId || owner.projectCrs !== identity.projectCrs) {
      throw new Error("Survey collections do not match the current document ownership.");
    }
    ids.add(collection.id); return collection;
  });
  return { ...state, collections };
}
