export type UserRole = "operator" | "admin" | "support";
export type WorkspacePermission = "field:read" | "field:write" | "catalog:write" | "catalog:archive";
export interface Principal { id: string; username: string; displayName: string; roles: UserRole[] }
export interface WorkspaceAccess {
  workspaceId: string; workspaceName: string; permissions: WorkspacePermission[]; policyRevision: number;
}
export interface AccessSnapshot {
  principal: Principal; workspaces: WorkspaceAccess[]; csrfToken: string; serverTime: string;
}
export interface SessionResponse extends AccessSnapshot { nativeToken?: string }
export interface ApiFailure { code: string; message: string; requestId?: string }
export interface CommandRequest { commandId: string; expectedRevision: number; command: unknown; expectedPrincipalId?: string }
export interface CommandResponse { workspace: unknown; value?: unknown; revision: number; replayed: boolean }
export interface RemoteWorkspace { workspaceId: string; revision: number; document: string; sha256: string }
export interface ProjectMetadata {
  id: string; clientId: string; name: string; customerDisplayName: string;
  projectCrs: string | null; unitSystem: string; createdAt: string; updatedAt: string;
  archived: boolean; individuallyArchived: boolean;
}
export interface CustomerFolderMetadata { id: string; displayName: string; archived: boolean }
export interface CatalogMetadata {
  workspaceId: string; revision: number; principalId: string; policyRevision: number; customers: CustomerFolderMetadata[]; projects: ProjectMetadata[];
}
export function parseCustomerMetadataList(input: unknown): { customers: CustomerFolderMetadata[] } {
  if (!input || typeof input !== "object" || !Array.isArray((input as { customers?: unknown }).customers)) throw new Error("Customer information could not be read.");
  const customers = (input as { customers: CustomerFolderMetadata[] }).customers, identities = new Set<string>();
  for (const customer of customers) {
    if (!customer || typeof customer.id !== "string" || !customer.id || identities.has(customer.id)
      || typeof customer.displayName !== "string" || !customer.displayName || typeof customer.archived !== "boolean") throw new Error("Customer information could not be read. Refresh your customers.");
    identities.add(customer.id);
  }
  return JSON.parse(JSON.stringify({ customers })) as { customers: CustomerFolderMetadata[] };
}
export function parseCatalogMetadata(input: unknown, workspaceId: string): CatalogMetadata {
  if (!input || typeof input !== "object") throw new Error("Customer folders could not be read.");
  const source = input as CatalogMetadata;
  if (source.workspaceId !== workspaceId || !Number.isSafeInteger(source.revision) || source.revision < 0
    || typeof source.principalId !== "string" || !source.principalId || !Number.isSafeInteger(source.policyRevision) || source.policyRevision < 0) throw new Error("Customer folders belong to another workspace or could not be read.");
  const { customers } = parseCustomerMetadataList(source), { projects } = parseProjectMetadataList(source), parents = new Map(customers.map(customer => [customer.id, customer]));
  for (const project of projects) {
    const customer = parents.get(project.clientId);
    if (!customer || project.customerDisplayName !== customer.displayName || project.archived !== (customer.archived || project.individuallyArchived)) throw new Error("Project information does not match its saved customer folder. Refresh your customers.");
  }
  return { workspaceId, revision: source.revision, principalId: source.principalId, policyRevision: source.policyRevision, customers, projects };
}
export function parseProjectMetadataList(input: unknown): { projects: ProjectMetadata[] } {
  if (!input || typeof input !== "object" || !Array.isArray((input as { projects?: unknown }).projects)) throw new Error("Project information could not be read.");
  const projects = (input as { projects: ProjectMetadata[] }).projects, identities = new Set<string>();
  for (const project of projects) {
    if (!project || [project.id, project.clientId, project.name, project.customerDisplayName, project.unitSystem, project.createdAt, project.updatedAt].some(value => typeof value !== "string" || !value.length)
      || identities.has(project.id) || project.projectCrs !== null && typeof project.projectCrs !== "string"
      || typeof project.archived !== "boolean" || typeof project.individuallyArchived !== "boolean") throw new Error("Project or customer information could not be read. Refresh your projects.");
    identities.add(project.id);
  }
  return JSON.parse(JSON.stringify({ projects })) as { projects: ProjectMetadata[] };
}
export interface WorkspaceArchiveState {
  workspaceId: string; revision: number;
  customers: { id: string; displayName: string; archived: boolean }[];
  projects: { id: string; clientId: string; name: string; archived: boolean; individuallyArchived: boolean }[];
}
export interface ArchiveRequest { kind: "customer" | "project"; entityId: string; archived: boolean; expectedRevision: number }
export interface ArchiveAcknowledgment { workspaceId: string; revision: number; kind: "customer" | "project"; entityId: string; archived: boolean }
export function parseWorkspaceArchiveState(input: unknown, workspaceId: string): WorkspaceArchiveState {
  if (!input || typeof input !== "object") throw new Error("Saved archive information is unreadable.");
  const value = input as WorkspaceArchiveState;
  if (value.workspaceId !== workspaceId || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !Array.isArray(value.customers) || !Array.isArray(value.projects)) throw new Error("Archive information belongs to another workspace or is unreadable.");
  const customers = new Set<string>(), projects = new Set<string>();
  for (const item of value.customers) {
    if (!item || typeof item.id !== "string" || !item.id || customers.has(item.id) || typeof item.displayName !== "string" || typeof item.archived !== "boolean") throw new Error("Saved customer archive information is unreadable.");
    customers.add(item.id);
  }
  for (const item of value.projects) {
    if (!item || typeof item.id !== "string" || !item.id || projects.has(item.id) || !customers.has(item.clientId)
      || typeof item.name !== "string" || typeof item.archived !== "boolean" || typeof item.individuallyArchived !== "boolean") throw new Error("Saved project archive information is unreadable.");
    projects.add(item.id);
  }
  return JSON.parse(JSON.stringify(value)) as WorkspaceArchiveState;
}
export interface OfflineGrant {
  grantVersion: "cplayout-offline-grant-v1"; id: string; subject: string; workspaceId: string;
  principal: Principal; workspaceName: string;
  projectIds: string[]; permissions: ("field:read" | "field:write")[]; policyRevision: number;
  issuedAt: string; expiresAt: string;
}
export interface SignedOfflineGrant { payload: string; signature: string; keyId: string }
export interface OfflineGrantResponse { grant: SignedOfflineGrant; verificationKey: string; serverTime: string }
export const OFFLINE_WORK_DURATION_MS = 24 * 60 * 60 * 1000;
export const ROLE_LABELS: Readonly<Record<UserRole, string>> = { operator: "Operator", admin: "Administrator", support: "Support" };

export function parseAccessSnapshot(input: unknown): AccessSnapshot {
  if (!input || typeof input !== "object") throw new Error("The sign-in response is invalid.");
  const value = input as AccessSnapshot;
  if (!value.principal || typeof value.principal.id !== "string" || !value.principal.id
    || typeof value.principal.username !== "string" || typeof value.principal.displayName !== "string"
    || !Array.isArray(value.principal.roles) || value.principal.roles.some(role => !["operator", "admin", "support"].includes(role))
    || !Array.isArray(value.workspaces) || typeof value.csrfToken !== "string" || !value.csrfToken
    || !Number.isFinite(Date.parse(value.serverTime))) throw new Error("The sign-in response is invalid.");
  for (const workspace of value.workspaces) {
    if (!workspace || typeof workspace.workspaceId !== "string" || !workspace.workspaceId
      || typeof workspace.workspaceName !== "string" || !Number.isSafeInteger(workspace.policyRevision) || workspace.policyRevision < 0
      || !Array.isArray(workspace.permissions) || workspace.permissions.some(permission => !["field:read", "field:write", "catalog:write", "catalog:archive"].includes(permission))) throw new Error("Workspace access is invalid.");
  }
  return JSON.parse(JSON.stringify({ principal: value.principal, workspaces: value.workspaces, csrfToken: value.csrfToken, serverTime: value.serverTime })) as AccessSnapshot;
}
