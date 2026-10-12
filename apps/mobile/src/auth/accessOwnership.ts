import type { AccessSnapshot } from "@cplayout/auth-client";

/** Changing role, membership policy or permission can retire the working subtree
 * even when the principal and workspace IDs stay the same. */
export function workspaceAccessOwner(access: AccessSnapshot | null, workspaceId: string | null): string {
  const membership = access?.workspaces.find(item => item.workspaceId === workspaceId);
  return JSON.stringify([access?.principal.id ?? null, workspaceId, access?.principal.roles ?? [],
    membership?.policyRevision ?? null, membership?.permissions ?? []]);
}
export function workspaceAccessMustPreserve(before: AccessSnapshot | null, beforeWorkspace: string | null,
  after: AccessSnapshot | null, afterWorkspace: string | null): boolean {
  return before !== null && workspaceAccessOwner(before, beforeWorkspace) !== workspaceAccessOwner(after, afterWorkspace);
}
