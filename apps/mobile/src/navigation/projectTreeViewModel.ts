import type { ProjectCatalog, WorkspaceDesignCatalog } from "@cplayout/project-store";

export interface ProjectTreeActiveContext {
  clientId: string | null;
  projectId: string | null;
  fieldMapId: string | null;
  designId: string | null;
}

export interface ProjectTreeDesignNode {
  id: string;
  isActive: boolean;
  label: string;
  meta: string;
}

export interface ProjectTreeFieldMapNode {
  designs: ProjectTreeDesignNode[];
  id: string;
  label: string;
  meta: string;
}

export interface ProjectTreeProjectNode {
  fieldMaps: ProjectTreeFieldMapNode[];
  id: string;
  label: string;
  meta: string;
  showChildren: boolean;
}

export interface ProjectTreeClientNode {
  id: string;
  label: string;
  meta: string;
  projects: ProjectTreeProjectNode[];
}

export interface ProjectTreeViewModel {
  activeProjectLabel: string;
  clients: ProjectTreeClientNode[];
}

export function buildProjectTreeViewModel(catalog: ProjectCatalog | WorkspaceDesignCatalog, activeContext: ProjectTreeActiveContext): ProjectTreeViewModel {
  const visibleClients = activeContext.projectId
    ? catalog.clients.filter((client) => client.id === activeContext.clientId)
    : catalog.clients;
  const activeProject = activeContext.projectId
    ? catalog.projects.find((project) => project.id === activeContext.projectId) ?? null
    : null;

  return {
    activeProjectLabel: activeProject ? activeProject.name : "Project Catalog",
    clients: visibleClients.map((client) => {
      const projects = catalog.projects.filter((project) => project.clientId === client.id);
      return {
        id: client.id,
        label: client.displayName,
        meta: `${projects.length} project${projects.length === 1 ? "" : "s"}`,
        projects: projects.map((projectRecord) => {
          const fieldMaps = catalog.fieldMaps.filter((fieldMap) => fieldMap.projectId === projectRecord.id);
          const designCount = fieldMaps.reduce((count, fieldMap) => (
            count + catalog.designs.filter((design) => design.fieldMapId === fieldMap.id).length
          ), 0);
          return {
            id: projectRecord.id,
            label: projectRecord.name,
            meta: `${fieldMaps.length} field${fieldMaps.length === 1 ? "" : "s"} - ${designCount} design${designCount === 1 ? "" : "s"}`,
            showChildren: activeContext.projectId === null || activeContext.projectId === projectRecord.id,
            fieldMaps: fieldMaps.map((fieldMap) => {
              const designs = catalog.designs.filter((design) => design.fieldMapId === fieldMap.id);
              return {
                id: fieldMap.id,
                label: fieldMap.name,
                meta: `${designs.length} design${designs.length === 1 ? "" : "s"}`,
                designs: [
                  ...designs.filter((design) => design.isActive).map((design) => ({
                    id: design.id,
                    isActive: true,
                    label: design.name,
                    meta: "kind" in design && design.kind === "draft" ? "saved draft" : "active design",
                  })),
                  ...designs.filter((design) => !design.isActive).map((design) => ({
                    id: design.id,
                    isActive: false,
                    label: design.name,
                    meta: "kind" in design && design.kind === "draft" ? "saved draft" : "layout variant",
                  })),
                ],
              };
            }),
          };
        }),
      };
    }),
  };
}
