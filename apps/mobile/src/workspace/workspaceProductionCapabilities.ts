import { parseSurveyCollectionDocument, parseLayoutSessionDocument, type SurveyCollection } from "@cplayout/core";
import { assertLayoutSurveyAdmission, type DesignWorkspaceBundle, type WorkspaceDocument, type WorkspaceCommand } from "@cplayout/project-store";
import type { WorkspaceArchiveState } from "@cplayout/auth-client";

export type WorkspaceArchiveOwnerStatus = "active" | "archived" | "unknown";
export function workspaceArchiveOwnerStatus(catalog: Pick<WorkspaceDocument["catalog"], "clients" | "projects" | "fieldMaps">, archives: WorkspaceArchiveState | null | undefined,
  owner: { clientId?: string | null; projectId?: string | null; fieldMapId?: string | null }): WorkspaceArchiveOwnerStatus {
  if (archives === undefined) return "active";
  const projectId = owner.projectId ?? catalog.fieldMaps.find(field => field.id === owner.fieldMapId)?.projectId ?? null;
  const clientId = owner.clientId ?? catalog.projects.find(project => project.id === projectId)?.clientId ?? null;
  if (owner.fieldMapId && !projectId) return "unknown";
  if (!projectId && !clientId) return "active";
  if (!archives) return "unknown";
  const project = projectId ? archives.projects.find(item => item.id === projectId) : null;
  const customer = clientId ? archives.customers.find(item => item.id === clientId) : null;
  if (projectId && (!project || clientId && project.clientId !== clientId) || clientId && !customer) return "unknown";
  return project?.archived || customer?.archived ? "archived" : "active";
}
/** Source and destination ownership come from the real saved catalog. New IDs do
 * not create archive authority; the strict domain command still checks existence. */
export function workspaceCommandArchiveStatus(workspace: WorkspaceDocument, archives: WorkspaceArchiveState | null | undefined,
  command: WorkspaceCommand): WorkspaceArchiveOwnerStatus {
  const owners: Array<{ clientId?: string; projectId?: string; fieldMapId?: string }> = [];
  const catalog = workspace.catalog, data = command as unknown as Record<string, unknown>;
  const inspect = (value: Record<string, unknown>) => {
    if (typeof value.clientId === "string" && catalog.clients.some(item => item.id === value.clientId)) owners.push({ clientId: value.clientId });
    if (typeof value.projectId === "string" && catalog.projects.some(item => item.id === value.projectId)) owners.push({ projectId: value.projectId });
    if (typeof value.fieldMapId === "string" && catalog.fieldMaps.some(item => item.id === value.fieldMapId)) owners.push({ fieldMapId: value.fieldMapId });
    for (const key of ["designId", "sourceDesignId"]) {
      const design = catalog.designs.find(item => item.id === value[key]); if (design) owners.push({ fieldMapId: design.fieldMapId });
    }
    for (const key of ["sessionId", "sourceSessionId"]) {
      const session = workspace.layoutSessions?.find(item => item.id === value[key]); if (session) owners.push({ fieldMapId: parseLayoutSessionDocument(session.document).fieldMapId });
    }
    const collection = workspace.surveyCollections?.find(item => item.id === value.collectionId);
    if (collection) owners.push({ fieldMapId: parseSurveyCollectionDocument(collection.document).owner.fieldMapId });
  };
  inspect(data);
  if (data.input && typeof data.input === "object") {
    const input = data.input as Record<string, unknown>; inspect(input);
    if (command.type === "update_client" && typeof input.id === "string") owners.push({ clientId: input.id });
  }
  if (command.type === "create_survey_collection") owners.push({ fieldMapId: command.collection.owner.fieldMapId });
  if (command.type === "save_project" || command.type === "copy_project" && command.sourceStored) {
    const id = command.type === "save_project" ? command.project.id : command.source.id;
    const design = catalog.designs.find(item => "pivotProjectId" in item && item.pivotProjectId === id);
    if (design) owners.push({ fieldMapId: design.fieldMapId });
  }
  const statuses = owners.map(owner => workspaceArchiveOwnerStatus(catalog, archives, owner));
  return statuses.includes("archived") ? "archived" : statuses.includes("unknown") ? "unknown" : "active";
}

export function workspaceHasSurveyStorage(version: unknown): boolean {
  return version === "cplayout-workspace-v4" || version === "cplayout-workspace-v5";
}
export function workspaceHasLayoutStorage(version: unknown): boolean {
  return version === "cplayout-workspace-v3" || workspaceHasSurveyStorage(version);
}
export function workspaceCanImportBundle(version: unknown, bundle: Pick<DesignWorkspaceBundle, "bundleVersion">): boolean {
  return bundle.bundleVersion === "cplayout-design-workspace-bundle-v2" ? version === "cplayout-workspace-v5" : workspaceHasSurveyStorage(version);
}
/** Selection convenience only. Strict evidence, owner and geometry validation remains in the saved review command. */
export function surveyReviewCandidateIds(collections: readonly SurveyCollection[]): string[] {
  return collections.filter(collection => collection.state !== "archived" && collection.state !== "cleared"
    && (collection.purpose.kind === "point" ? collection.activePointIds.length > 0
      : collection.state === "applied" && (collection.applications.at(-1)?.sourcePointIds.length ?? 0) > 0)).map(collection => collection.id);
}
export function workspaceLayoutAdmission(workspace: WorkspaceDocument | null, targetDocument: string | null): { ready: boolean; reasons: string[] } {
  if (!targetDocument) return { ready: false, reasons: ["Open a reviewed Layout target before recording positions."] };
  if (!workspace) return { ready: false, reasons: ["Read the saved field work before recording positions."] };
  try { assertLayoutSurveyAdmission(workspace, targetDocument); return { ready: true, reasons: [] }; }
  catch (error) { return { ready: false, reasons: [error instanceof Error ? error.message : "Review the current Survey and target before recording positions."] }; }
}
