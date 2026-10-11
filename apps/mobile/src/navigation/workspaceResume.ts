import type { ProjectCatalogContext } from "../hooks/useProjectRepository";
import type { ProjectCatalog, WorkspaceDesignCatalog } from "@cplayout/project-store";

const KEY = "cplayout-desktop-context-v1";
export interface WorkspaceResume {
  version: 1;
  context: ProjectCatalogContext;
  editorOpen: boolean;
  view: "dashboard" | "map" | "survey" | "files" | "settings" | "help";
}
export function readWorkspaceResume(): WorkspaceResume | null {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null");
    if (!value || value.version !== 1 || typeof value.editorOpen !== "boolean"
      || !["dashboard", "map", "survey", "files", "settings", "help"].includes(value.view)) return null;
    if (!value.context || ["clientId", "projectId", "fieldMapId", "designId"].some(key => value.context[key] !== null
      && (typeof value.context[key] !== "string" || !value.context[key]))) return null;
    return value;
  } catch { return null; }
}
export function writeWorkspaceResume(value: WorkspaceResume): void {
  // Preferences cannot invalidate an acknowledged project save when quota/storage is unavailable.
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(value)); } catch { /* optional local preference */ }
}
export function resolveResumeContext(context: ProjectCatalogContext, catalog: ProjectCatalog | WorkspaceDesignCatalog): ProjectCatalogContext {
  const customer = catalog.clients.find(item => item.id === context.clientId);
  const project = customer && catalog.projects.find(item => item.id === context.projectId && item.clientId === customer.id);
  const field = project && catalog.fieldMaps.find(item => item.id === context.fieldMapId && item.projectId === project.id);
  const design = field && catalog.designs.find(item => item.id === context.designId && item.fieldMapId === field.id);
  return { clientId: customer?.id ?? null, projectId: project?.id ?? null, fieldMapId: field?.id ?? null, designId: design?.id ?? null };
}
