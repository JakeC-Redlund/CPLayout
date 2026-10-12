import type { Principal, WorkspaceAccess, WorkspacePermission } from "@cplayout/auth-client";
import type { WorkspaceDocument } from "../../../packages/project-store/src/workspaceDocument";
import type { ArchiveRecord } from "./database";
import { workspaceCommandPermission } from "../../../packages/project-store/src/workspaceCommandPermission";

export class ServiceError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ServiceError"; } }
export function requireAdmin(user: Principal): void { if (!user.roles.includes("admin")) throw new ServiceError(403, "forbidden", "Administrator access is required."); }
export function requirePermission(user: Principal, membership: WorkspaceAccess | null, permission: WorkspacePermission): WorkspaceAccess {
  if (!user.roles.some(role => role === "operator" || role === "admin") || !membership?.permissions.includes(permission)) throw new ServiceError(403, "forbidden", "Your account does not have access to this workspace action.");
  return membership;
}
export const commandPermission = workspaceCommandPermission;

/** Resolve real catalog ancestry, never rely on a request's claimed project scope.
 * New catalog entities are checked after the shared reducer has validated parents. */
export function touchedProjects(workspace: WorkspaceDocument, command: unknown): Set<string> {
  const projectByField = new Map(workspace.catalog.fieldMaps.map(field => [field.id, field.projectId]));
  const projectByDesign = new Map(workspace.catalog.designs.map(design => [design.id, projectByField.get(design.fieldMapId)!]));
  const projectByPayload = new Map(workspace.catalog.designs.map(design => [design.kind === "field" ? design.fieldDesignId : design.kind === "draft" ? design.draftId : design.pivotProjectId, projectByField.get(design.fieldMapId)!]));
  const projectByCollection = new Map((workspace.surveyCollections ?? []).map(entry => { const collection = JSON.parse(entry.document) as { owner: { designId: string } }; return [entry.id, projectByDesign.get(collection.owner.designId)!]; }));
  const projectBySession = new Map((workspace.layoutSessions ?? []).map(entry => { const session = JSON.parse(entry.document) as { fieldMapId: string }; return [entry.id, projectByField.get(session.fieldMapId)!]; }));
  const projects = new Set(workspace.catalog.projects.map(project => project.id)), found = new Set<string>();
  const scan = (value: unknown, depth: number) => {
    if (depth > 64) throw new ServiceError(400, "invalid_command", "The action contains unsupported nesting.");
    if (typeof value === "string") {
      const project = projects.has(value) ? value : projectByField.get(value) ?? projectByDesign.get(value) ?? projectByPayload.get(value) ?? projectByCollection.get(value) ?? projectBySession.get(value);
      if (project) found.add(project);
    } else if (Array.isArray(value)) value.forEach(item => scan(item, depth + 1));
    else if (value && typeof value === "object") Object.values(value).forEach(item => scan(item, depth + 1));
  };
  scan(command, 0); return found;
}
export function assertNotArchived(workspace: WorkspaceDocument, command: unknown, archives: ArchiveRecord[]): void {
  const projects = touchedProjects(workspace, command);
  const archivedProjects = new Set(archives.filter(item => item.kind === "project").map(item => item.entityId));
  const archivedCustomers = new Set(archives.filter(item => item.kind === "customer").map(item => item.entityId));
  for (const project of workspace.catalog.projects) if (archivedCustomers.has(project.clientId)) archivedProjects.add(project.id);
  if ([...projects].some(id => archivedProjects.has(id))) throw new ServiceError(409, "archived", "Restore the customer or project before changing its saved work.");
  const raw = command as { clientId?: string; id?: string; input?: { clientId?: string; id?: string }; type?: string };
  const customerId = raw.clientId ?? raw.input?.clientId ?? (raw.type === "update_client" ? raw.input?.id : raw.type === "delete_client" ? raw.clientId : null);
  if (customerId && archivedCustomers.has(customerId)) throw new ServiceError(409, "archived", "Restore this customer before changing its saved work.");
}
