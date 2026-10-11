import { parseLayoutSessionDocument, parseSurveyCollectionDocument } from "@cplayout/core";
import type { WorkspaceDocument } from "@cplayout/project-store";
import { WORKSPACE_EDIT_RECOVERY_VERSION, captureWorkspaceRecoveryEditable,
  parseWorkspaceEditRecovery, workspaceRecoveryStableJson, type WorkspaceEditRecoveryAdmission, type WorkspaceEditRecoveryCandidate } from "./workspaceEditRecovery";
import type { WorkspaceControllerState } from "./workspaceControllerState";
import { mapContextForLayoutSession, mapContextForWorkspaceDocument } from "./workspaceMapContext";
import { workspaceEditableIsDirty } from "./workspaceDocumentAdapters";

export function captureWorkspaceControllerRecovery(state: WorkspaceControllerState,
  rest: Omit<WorkspaceEditRecoveryCandidate, "recoveryVersion" | "editable" | "collections" | "layout" | "controller">,
  acknowledgedWorkspace: WorkspaceDocument | null): WorkspaceEditRecoveryCandidate {
  const collections = state.collections.map(collection => {
    const source = acknowledgedWorkspace?.surveyCollections?.find(entry => entry.id === collection.id);
    if (!source || workspaceRecoveryStableJson(parseSurveyCollectionDocument(source.document)) !== workspaceRecoveryStableJson(collection))
      throw new Error("Read the acknowledged Survey sources before checkpointing. Entered values are retained.");
    return { id: collection.id, revision: collection.revision, document: source.document };
  });
  const sessionSource = state.layout && acknowledgedWorkspace?.layoutSessions?.find(entry => entry.id === state.layout!.session.id);
  if (state.layout && (!sessionSource || workspaceRecoveryStableJson(parseLayoutSessionDocument(sessionSource.document)) !== workspaceRecoveryStableJson(state.layout.session)))
    throw new Error("Read the acknowledged Layout source before checkpointing. Entered values are retained.");
  return parseWorkspaceEditRecovery({ ...rest, recoveryVersion: WORKSPACE_EDIT_RECOVERY_VERSION,
    editable: state.editable ? captureWorkspaceRecoveryEditable(state.editable) : null,
    collections,
    layout: state.layout ? { id: state.layout.session.id, revision: state.layout.session.revision,
      persistenceRevision: state.layout.persistenceRevision, document: sessionSource!.document,
      fieldMapId: state.layout.session.fieldMapId, targetHash: state.layout.session.targetHash,
      targetDocument: state.layout.session.targetDocument } : null,
    controller: { historyPast: state.historyPast, historyFuture: state.historyFuture, selectedAddress: state.selectedAddress } });
}

/** A restoration replaces content even when its identity is unchanged. Every
 * held command/gesture gets a new generation, including an empty catalog start. */
export function workspaceControllerStateForRecovery(before: WorkspaceControllerState,
  admission: WorkspaceEditRecoveryAdmission): WorkspaceControllerState {
  const generation = before.presentation.documentGeneration + 1;
  const interaction = before.presentation.interactionGeneration + 1;
  if (!Number.isSafeInteger(generation) || !Number.isSafeInteger(interaction)) throw new Error("Workspace ownership generation is exhausted.");
  const editable = admission.editable, layout = admission.layout;
  const mode = admission.staged.context.workspace.mode;
  return { presentation: { ...before.presentation, document: editable?.identity ?? null, mode,
    documentGeneration: generation, interactionGeneration: interaction }, editable, layout,
    collections: admission.collections, historyPast: admission.historyPast, historyFuture: admission.historyFuture,
    selectedAddress: admission.staged.controller.selectedAddress,
    mapContext: layout && (mode === "layout" || !editable) ? mapContextForLayoutSession(layout.session)
      : mapContextForWorkspaceDocument(editable?.identity ?? null),
    savedState: workspaceEditableIsDirty(editable) ? "unsaved" : "saved", notice: null };
}
