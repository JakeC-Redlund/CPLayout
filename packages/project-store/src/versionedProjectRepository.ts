import { parseDesignDraftDocument, parseFieldDesignDocument, parseProjectDocument } from "@cplayout/core";
import { sortProjectCatalog } from "./projectCatalog";
import { parseEditableProjectDocument } from "./projectDocumentEditing";
import type {
  ProjectCatalog, ProjectRepository, ProjectRepositoryBackendInfo, VersionedWorkspaceRepository,
  WorkspaceDesignCatalog, WorkspaceDesignRead,
} from "./projectRepositoryTypes";
import { createWebWorkspaceStore, type WebWorkspaceStoreDependencies } from "./webWorkspaceStore";
import { applyWorkspaceCommand, parseWorkspaceCommand, type WorkspaceCommandValue } from "./workspaceCommands";
import { validateWorkspaceDocument, WorkspaceDocumentError, type WorkspaceDocument } from "./workspaceDocument";

/** Mixed catalog for draft-aware callers; never disguise a draft as a legacy project. */
export function workspaceDesignCatalog(workspace: WorkspaceDocument): WorkspaceDesignCatalog {
  return sortProjectCatalog(validateWorkspaceDocument(workspace).catalog);
}

/** Payload, ownership and both revisions come from one validated, detached snapshot. */
export function readWorkspaceDesign(workspace: WorkspaceDocument, designId: string): WorkspaceDesignRead {
  if (typeof designId !== "string" || designId.length === 0) {
    throw new WorkspaceDocumentError("invalid_document", "A design identity is required.");
  }
  const current = validateWorkspaceDocument(workspace);
  const design = current.catalog.designs.find(item => item.id === designId);
  if (!design) return { kind: "not_found", workspaceRevision: current.revision };
  const field = current.catalog.fieldMaps.find(item => item.id === design.fieldMapId)!;
  const project = current.catalog.projects.find(item => item.id === field.projectId)!;
  const shared = {
    workspaceRevision: current.revision,
    context: { clientId: project.clientId, projectId: project.id, fieldMapId: field.id, designId: design.id },
  };
  if (design.kind === "field") {
    const entry = current.fieldDocuments!.find(item => item.id === design.fieldDesignId)!;
    return { ...shared, kind: "field", design, document: entry.document, field: parseFieldDesignDocument(entry.document),
      ...(entry.originalProjectDocument === undefined ? {} : { originalProjectDocument: entry.originalProjectDocument }) };
  }
  if (design.kind === "draft") {
    const document = current.draftDocuments.find(item => item.id === design.draftId)!.document;
    return { ...shared, kind: "draft", design, document, draft: parseDesignDraftDocument(document) };
  }
  const document = current.projectDocuments.find(item => item.summary.id === design.pivotProjectId)!.document;
  return { ...shared, kind: "project", design, document, project: parseEditableProjectDocument(document) };
}

export function workspaceProjectCatalog(workspace: WorkspaceDocument): ProjectCatalog {
  const designs = workspace.catalog.designs.map(design => {
    if (design.kind !== "project") throw new WorkspaceDocumentError("unsupported_version", design.kind === "draft"
      ? "This workspace contains incomplete designs; a draft-aware catalog is required. Export recovery data before changing it."
      : "This workspace contains field designs; a version-aware catalog is required. Export recovery data before changing it.");
    const { kind: _kind, revision: _revision, ...record } = design;
    return record;
  });
  return sortProjectCatalog({ ...workspace.catalog, designs });
}

export function workspaceBackendInfo(workspace: WorkspaceDocument): ProjectRepositoryBackendInfo {
  return {
    backendLabel: "Browser local storage", runtime: "web", storageEngine: "local_storage", durable: true,
    projectCount: workspace.projectDocuments.length, supportsProjectList: true, supportsZipImport: true, supportsZipExport: true,
    notes: ["Workspace writes use a shared browser lock and revision checks. Keep a separate recovery export.",
      "Browser storage may be cleared or evicted; it is not an external backup."],
  };
}

/** Legacy-shaped writes are deliberately unavailable: callers must supply a loaded revision. */
export function createVersionedProjectRepository(dependencies: WebWorkspaceStoreDependencies): ProjectRepository {
  const store = createWebWorkspaceStore(dependencies);
  const versionedWorkspace: VersionedWorkspaceRepository = {
    readAsync: () => store.initializeAsync(),
    async readDesignAsync(designId) { return readWorkspaceDesign(await store.initializeAsync(), designId); },
    async executeAsync(expectedRevision, command, isCurrent) {
      const captured = parseWorkspaceCommand(command);
      let value: WorkspaceCommandValue = undefined;
      const workspace = await store.transactAsync(expectedRevision, current => {
        if (isCurrent && !isCurrent()) throw new WorkspaceDocumentError("conflict", "The active editor or live observation changed before saving; retry from the current screen.");
        const result = applyWorkspaceCommand(current, captured);
        value = result.value;
        return result.workspace;
      });
      return { workspace, value };
    },
    exportRecoveryAsync: () => store.exportRecoveryAsync(),
  };
  const revisionRequired = async (): Promise<never> => {
    throw new WorkspaceDocumentError("conflict", "Reload the project or catalog and save with its original workspace revision.");
  };
  return {
    backendLabel: "Browser local storage", versionedWorkspace, describeWorkspace: workspaceBackendInfo,
    async getBackendInfoAsync() { return workspaceBackendInfo(await versionedWorkspace.readAsync()); },
    async listProjectsAsync() { return (await versionedWorkspace.readAsync()).projectDocuments.map(entry => entry.summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async listProjectCatalogAsync() { return workspaceProjectCatalog(await versionedWorkspace.readAsync()); },
    async loadProjectAsync(projectId) {
      const entry = (await versionedWorkspace.readAsync()).projectDocuments.find(item => item.summary.id === projectId);
      return entry ? parseProjectDocument(entry.document) : null;
    },
    async loadDesignProjectAsync(designId) {
      const workspace = await versionedWorkspace.readAsync();
      const design = workspace.catalog.designs.find(item => item.id === designId);
      if (!design) return null;
      if (design.kind !== "project") throw new WorkspaceDocumentError("unsupported_version", design.kind === "draft" ? "Open this document with the incomplete-design editor." : "Open this document with the field editor.");
      return parseProjectDocument(workspace.projectDocuments.find(item => item.summary.id === design.pivotProjectId)!.document);
    },
    saveProjectAsync: revisionRequired, saveDesignProjectAsync: revisionRequired, deleteProjectAsync: revisionRequired,
    createClientAsync: revisionRequired, updateClientAsync: revisionRequired, deleteClientAsync: revisionRequired,
    createProjectWithInitialDesignAsync: revisionRequired, createProjectWithInitialFieldMapAsync: revisionRequired,
    createProjectRecordAsync: revisionRequired, renameProjectAsync: revisionRequired, moveProjectToClientAsync: revisionRequired,
    createFieldMapRecordAsync: revisionRequired, createDesignRecordAsync: revisionRequired,
  };
}
