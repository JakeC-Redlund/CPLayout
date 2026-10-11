import type { ProjectCatalog } from "@cplayout/project-store";

type Catalog = Pick<ProjectCatalog, "clients" | "projects" | "fieldMaps">;
export interface CatalogFormContext { clientId: string | null; projectId: string | null; fieldMapId: string | null }
/** Rebase only an unchanged form target and its parents. The later write still checks the whole workspace revision. */
export function assertCatalogFormContextUnchanged(before: Catalog, after: Catalog, context: CatalogFormContext, editingClientId?: string | null, editingProjectId?: string | null): void {
  for (const [collection, id, label] of [
    ["clients", editingClientId ?? context.clientId, "customer"],
    ["projects", editingProjectId ?? context.projectId, "project"],
    ["fieldMaps", context.fieldMapId, "field"],
  ] as const) {
    if (!id) continue;
    const original = before[collection].find(item => item.id === id);
    const current = after[collection].find(item => item.id === id);
    if (!original || !current || JSON.stringify(original) !== JSON.stringify(current)) {
      throw new Error(`The saved ${label} changed or was removed. Your entries are still here. Review the updated record before replacing any saved information.`);
    }
  }
}
