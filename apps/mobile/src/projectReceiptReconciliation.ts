import { validateWorkspaceDocument, type WorkspaceDocument } from "@cplayout/project-store";

export interface ProjectReceiptIdentity {
  payloadId: string;
  designId: string | null;
  workspaceRevision: number | null;
}
export interface ProjectSourceProof {
  payloadId: string;
  designId: string | null;
  /** Exact retained source string; never regenerated from the current, possibly dirty editor. */
  document: string | null;
  summary: string | null;
  designRevision: number | null;
  fieldMapId: string | null;
  projectId: string | null;
  clientId: string | null;
}

/** Admission and source identity come from one detached snapshot with one workspace revision. */
export function captureProjectSourceProof(input: WorkspaceDocument, target: ProjectReceiptIdentity): {
  workspaceRevision: number; source: ProjectSourceProof;
} {
  const workspace = validateWorkspaceDocument(input);
  if (target.workspaceRevision !== null && workspace.revision !== target.workspaceRevision) {
    throw new Error("Workspace changed before opening the other workflow. Save or reopen the current design first.");
  }
  if (target.workspaceRevision === null) {
    if (target.designId !== null) throw new Error("An unsaved project cannot claim a saved design identity.");
    requireAbsentProjectIdentity(workspace, target.payloadId);
    return { workspaceRevision: workspace.revision, source: { payloadId: target.payloadId, designId: null,
      document: null, summary: null, designRevision: null, fieldMapId: null, projectId: null, clientId: null } };
  }
  return { workspaceRevision: workspace.revision, source: storedProjectSource(workspace, target.payloadId, target.designId) };
}

export function verifyRetainedProjectSource(input: WorkspaceDocument, source: ProjectSourceProof, minimumRevision: number): number {
  const workspace = validateWorkspaceDocument(input);
  if (workspace.revision < minimumRevision) throw new Error("Workspace revision moved backwards. Keep the current edits and recover the original workspace.");
  if (source.document === null) requireAbsentProjectIdentity(workspace, source.payloadId);
  else {
    const current = storedProjectSource(workspace, source.payloadId, source.designId);
    if (Object.keys(source).some(key => source[key as keyof ProjectSourceProof] !== current[key as keyof ProjectSourceProof])) {
      throw new Error("The saved source design changed while another workflow was open. Keep your edits and reopen or export a recovery copy before saving.");
    }
  }
  return workspace.revision;
}

function storedProjectSource(workspace: WorkspaceDocument, payloadId: string, designId: string | null): ProjectSourceProof {
  const entry = workspace.projectDocuments.find(item => item.summary.id === payloadId);
  if (!entry) throw new Error("The retained project was removed or changed document kind. Keep your current edits for recovery.");
  const owner = workspace.catalog.designs.find(item => item.kind === "project" && item.pivotProjectId === payloadId);
  if ((owner?.id ?? null) !== designId || (owner && owner.kind !== "project")) throw new Error("The retained project's saved design ownership changed. Keep your edits before reopening.");
  const field = owner ? workspace.catalog.fieldMaps.find(item => item.id === owner.fieldMapId)! : null;
  const folder = field ? workspace.catalog.projects.find(item => item.id === field.projectId)! : null;
  return { payloadId, designId, document: entry.document, summary: JSON.stringify(entry.summary),
    designRevision: owner?.revision ?? null, fieldMapId: field?.id ?? null, projectId: folder?.id ?? null, clientId: folder?.clientId ?? null };
}

function requireAbsentProjectIdentity(workspace: WorkspaceDocument, payloadId: string): void {
  if (workspace.projectDocuments.some(item => item.summary.id === payloadId)
    || workspace.draftDocuments.some(item => item.id === payloadId)
    || workspace.fieldDocuments?.some(item => item.id === payloadId)
    || workspace.catalog.projects.some(item => item.id === payloadId)
    || workspace.tombstones.some(item => item.entity !== "design" && item.id === payloadId)) {
    throw new Error("This unsaved project's identity was saved or reserved elsewhere. Keep the current edits and save a new copy.");
  }
}
