import { createFieldCalculationInput, tryBuildPivotProject, type CrsQualificationOptions, type LayoutResult, type SurveyCollection } from "@cplayout/core";
import { evaluateLayout } from "@cplayout/geometry";
import { readWorkspaceDesign, type WorkspaceDocument } from "@cplayout/project-store";
import { projectDataKey } from "../../../../packages/core/src/projectDataComparison";
import { editableFromSavedDesign, serializeWorkspaceEditable, type ExistingWorkspaceDesign, type WorkspaceEditableDocument } from "./workspaceDocumentAdapters";
import { workspaceDocumentIdentityKey } from "./workspacePresentation";
import type { WorkspaceControllerState } from "./workspaceControllerState";

export interface WorkspaceSiblingProof {
  designId: string; document: string; designRevision: number; identity: string; originalProjectDocument?: string;
}
export function workspacePendingBlocksReplacement(pending: ReadonlySet<string>, ignored: readonly string[] = []): boolean {
  if (ignored.some(key => key !== "catalog")) throw new Error("Only the submitting catalog form may retain its own pending close allowance.");
  return [...pending].some(key => !ignored.includes(key));
}
export function captureWorkspaceSiblingProof(editable: WorkspaceEditableDocument, workspace: WorkspaceDocument, allowReceiptAdvance = false): WorkspaceSiblingProof {
  const read = readWorkspaceDesign(workspace, editable.identity.designId!);
  if (read.kind === "not_found" || editable.workspaceRevision === null || (allowReceiptAdvance ? editable.workspaceRevision > workspace.revision : editable.workspaceRevision !== workspace.revision) || editable.designRevision !== read.design.revision || editable.sourceDocument !== read.document) throw new Error("The retained design receipt changed; preserve edits and reconcile its source before another workspace operation.");
  const admitted = editableFromSavedDesign(read);
  // CRS may be an unsaved input; ownership proof uses the exact retained source.
  const expected = { ...editable.identity, projectCrs: admitted.identity.projectCrs };
  if (workspaceDocumentIdentityKey(expected) !== workspaceDocumentIdentityKey(admitted.identity)) throw new Error("The retained design ownership changed.");
  if (editable.kind === "field" && read.kind === "field" && editable.originalProjectDocument !== read.originalProjectDocument) throw new Error("Retained original project provenance changed.");
  return { designId: read.design.id, document: read.document, designRevision: read.design.revision,
    identity: workspaceDocumentIdentityKey(admitted.identity), ...(read.kind === "field" && read.originalProjectDocument !== undefined ? { originalProjectDocument: read.originalProjectDocument } : {}) };
}
export function reconcileWorkspaceSibling(editable: WorkspaceEditableDocument, proof: WorkspaceSiblingProof, workspace: WorkspaceDocument): WorkspaceEditableDocument {
  const read = readWorkspaceDesign(workspace, proof.designId);
  if (read.kind === "not_found" || read.document !== proof.document || read.design.revision !== proof.designRevision) throw new Error("The sibling operation changed the retained design; preserve current edits before reopening.");
  const admitted = editableFromSavedDesign(read);
  if (workspaceDocumentIdentityKey(admitted.identity) !== proof.identity || (read.kind === "field" ? read.originalProjectDocument : undefined) !== proof.originalProjectDocument) throw new Error("The sibling operation changed design ownership or original provenance.");
  return { ...editable, workspaceRevision: workspace.revision };
}

export interface WorkspaceHistorySnapshot {
  document: string;
  memberships: Array<{ collectionId: string; activePointIds: string[]; state: "pending" | "applied" | "cleared" }>;
}
export function workspaceHistorySnapshot(state: WorkspaceControllerState): WorkspaceHistorySnapshot {
  if (!state.editable) throw new Error("Open a design before recording history.");
  return { document: serializeWorkspaceEditable(state.editable), memberships: state.collections.filter(item => item.state !== "archived").map(item => ({
    collectionId: item.id, activePointIds: [...item.activePointIds], state: item.state as "pending" | "applied" | "cleared" })) };
}
export function recordWorkspaceHistory(before: WorkspaceControllerState, after: WorkspaceControllerState): WorkspaceControllerState {
  if (!before.editable || !after.editable || workspaceDocumentIdentityKey({ ...before.editable.identity, projectCrs: null }) !== workspaceDocumentIdentityKey({ ...after.editable.identity, projectCrs: null })) return after;
  const previous = workspaceHistorySnapshot(before), next = workspaceHistorySnapshot(after);
  if (projectDataKey(previous) === projectDataKey(next)) return after;
  return { ...after, historyPast: [...before.historyPast, previous], historyFuture: [] };
}
export function historyMemberships(snapshot: WorkspaceHistorySnapshot, collections: readonly SurveyCollection[]) {
  return collections.filter(item => item.state !== "archived").map(collection => {
    const previous = snapshot.memberships.find(item => item.collectionId === collection.id);
    return { collectionId: collection.id, expectedCollectionRevision: collection.revision,
      activePointIds: previous ? [...previous.activePointIds] : [], state: previous?.state ?? "cleared" as const };
  });
}

export interface WorkspaceCalculationPreview {
  kind: WorkspaceEditableDocument["kind"]; documentId: string; inputRevision: number; machineIds: string[];
  results: Array<{ machineId: string; result: LayoutResult }>; sourceDocument: string;
}
export function calculateWorkspaceEditable(editable: WorkspaceEditableDocument, options: CrsQualificationOptions = {}): WorkspaceCalculationPreview {
  let project;
  if (editable.kind === "project") project = editable.editor.project;
  else if (editable.kind === "draft") {
    const built = tryBuildPivotProject(editable.editor.draft);
    if (!built.ok) {
      const blockers = "completeness" in built ? [...built.completeness.blockers, ...built.completeness.calculationBlockers] : built.blockers;
      throw new Error(blockers.map(item => item.message).join(" ") || "Complete the supplied inputs and coordinate qualification before calculation.");
    }
    project = built.project;
  } else {
    const machineId = editable.editor.selectedMachineId;
    if (!machineId) throw new Error("Select an actual field machine before calculating its preview.");
    const prepared = createFieldCalculationInput(editable.editor.field, { machineId, inputRevision: editable.editor.revision, expectedRevision: editable.editor.revision, crsOptions: options });
    if (prepared.status !== "ready") throw new Error(prepared.blockers.map(item => item.message).join(" "));
    project = prepared.project;
  }
  return { kind: editable.kind, documentId: editable.identity.payloadId, inputRevision: editable.editor.revision,
    machineIds: [project.machine.id], results: [{ machineId: project.machine.id, result: evaluateLayout(project, options) }], sourceDocument: serializeWorkspaceEditable(editable) };
}
export function calculationIsCurrent(preview: WorkspaceCalculationPreview | null, editable: WorkspaceEditableDocument | null): boolean {
  return !!preview && !!editable && preview.kind === editable.kind && preview.documentId === editable.identity.payloadId
    && preview.inputRevision === editable.editor.revision && preview.sourceDocument === serializeWorkspaceEditable(editable)
    && (editable.kind !== "field" || preview.machineIds[0] === editable.editor.selectedMachineId);
}
