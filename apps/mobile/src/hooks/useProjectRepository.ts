import { useCallback, useEffect, useRef, useState } from "react";
import { parseDesignDraftDocument, parseProjectDocument, type DesignDraft, type LayoutResult, type PivotProject } from "@cplayout/core";
import {
  createCatalogId, exportFileAsync, projectRepository, workspaceBackendInfo, workspaceDesignCatalog,
  type CatalogProjectRecord, type CreatedProjectFieldMapWorkspace, type CreatedProjectWorkspace,
  type CreateProjectWithInitialFieldMapInput, type CreateProjectWithInitialDesignInput,
  type ClientRecord, type ClientProfileInput, type ClientProfileUpdateInput, type DesignRecord,
  type FieldMapRecord, type ProjectCatalog, type ProjectRepositoryBackendInfo, type ProjectSummary,
  type CopyProjectCommand, type VersionedWorkspaceRepository, type WorkspaceCommand, type WorkspaceDesignCatalog,
  type WorkspaceDocument,
} from "@cplayout/project-store";

export type PersistenceRevision = number | null | undefined;
export interface ProjectCatalogContext {
  clientId: string | null; projectId: string | null; fieldMapId: string | null; designId: string | null;
}
export interface OpenedProject {
  project: PivotProject;
  persistenceRevision: PersistenceRevision;
  context: ProjectCatalogContext;
}
export type OpenedDesign = (OpenedProject & { kind: "project" }) | {
  kind: "draft"; draft: DesignDraft; persistenceRevision: number; designRevision: number; context: ProjectCatalogContext;
};
export interface SaveOutcome { saved: boolean; persistenceRevision?: number }
export type OpenedDraft = Extract<OpenedDesign, { kind: "draft" }>;
export interface SaveFeedbackOwner { isCurrent(): boolean }

export interface ProjectWorkspaceStatus {
  backendLabel: string;
  backendInfo: ProjectRepositoryBackendInfo | null;
  catalog: ProjectCatalog;
  designCatalog: WorkspaceDesignCatalog | null;
  catalogRevision: number | null;
  projects: ProjectSummary[];
  statusMessage: string;
  storageError: string | null;
  canExportWorkspaceRecovery: boolean;
  exportWorkspaceRecovery: () => Promise<void>;
  reportError: (error: unknown) => void;
  clearProjectError: () => void;
  clearCatalogError: () => void;
  canCopyProject: boolean;
  canSaveDraft: boolean;
  createDesignDraft: (input: { fieldMapId: string; draft: DesignDraft }, revision: number | null, owner?: SaveFeedbackOwner) => Promise<OpenedDraft | null>;
  saveDesignDraft: (designId: string, draft: DesignDraft, revision: number, designRevision: number, owner?: SaveFeedbackOwner) => Promise<SaveOutcome & { designRevision?: number }>;
  copyProject: (command: CopyProjectCommand, revision: number) => Promise<{ project: PivotProject; persistenceRevision: number }>;
  createClient: (input: ClientProfileInput, revision: number | null) => Promise<ClientRecord | null>;
  updateClient: (input: ClientProfileUpdateInput, revision: number | null) => Promise<ClientRecord | null>;
  deleteClient: (clientId: string, revision: number | null) => Promise<boolean>;
  createProjectWithInitialDesign: (input: CreateProjectWithInitialDesignInput, revision: number | null) => Promise<CreatedProjectWorkspace | null>;
  createProjectWithInitialFieldMap: (input: CreateProjectWithInitialFieldMapInput, revision: number | null) => Promise<CreatedProjectFieldMapWorkspace | null>;
  createProjectRecord: (input: { id?: string; clientId: string; name: string; projectCrs: string; unitSystem: string }, revision: number | null) => Promise<CatalogProjectRecord | null>;
  renameProject: (projectId: string, name: string, revision: number | null) => Promise<CatalogProjectRecord | null>;
  moveProjectToClient: (projectId: string, clientId: string, revision: number | null) => Promise<CatalogProjectRecord | null>;
  createFieldMapRecord: (input: { id?: string; projectId: string; name: string }, revision: number | null) => Promise<FieldMapRecord | null>;
  createDesignRecord: (input: { id?: string; fieldMapId: string; name: string; pivotProjectId: string; isActive?: boolean }, revision: number | null) => Promise<DesignRecord | null>;
  refreshProjects: () => Promise<void>;
  saveProject: (project: PivotProject, result: LayoutResult | undefined, revision: PersistenceRevision, owner?: SaveFeedbackOwner) => Promise<SaveOutcome>;
  saveDesignProject: (designId: string, project: PivotProject, result: LayoutResult | undefined, revision: PersistenceRevision, owner?: SaveFeedbackOwner) => Promise<SaveOutcome>;
  openProject: (projectId: string) => Promise<OpenedProject>;
  openDesignProject: (designId: string) => Promise<OpenedDesign>;
  deleteProject: (projectId: string, revision: number | null) => Promise<boolean>;
}

export function projectCatalogFromDesignCatalog(catalog: WorkspaceDesignCatalog): ProjectCatalog {
  return { ...catalog, designs: catalog.designs.flatMap((design) => {
    if (design.kind !== "project") return [];
    const { kind: _kind, revision: _revision, ...record } = design;
    return [record];
  }) };
}

export async function readVersionedDesign(repository: VersionedWorkspaceRepository, designId: string): Promise<OpenedDesign> {
  const read = await repository.readDesignAsync(designId);
  if (read.kind === "not_found") throw new Error("Project or design was not found in local storage.");
  const shared = { context: read.context, persistenceRevision: read.workspaceRevision };
  return read.kind === "draft"
    ? { ...shared, kind: "draft", draft: read.draft, designRevision: read.design.revision }
    : { ...shared, kind: "project", project: read.project };
}

export function useProjectRepository(): ProjectWorkspaceStatus {
  const [catalog, setCatalog] = useState<ProjectCatalog>({ clients: [], projects: [], fieldMaps: [], designs: [] });
  const [designCatalog, setDesignCatalog] = useState<WorkspaceDesignCatalog | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [statusMessage, setStatusMessage] = useState(`Storage: ${projectRepository.backendLabel}`);
  const [readError, setReadError] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const operationErrors = useRef<{ project: string | null; catalog: string | null }>({ project: null, catalog: null });
  const storageError = readError ?? catalogError ?? projectError;
  const [backendInfo, setBackendInfo] = useState<ProjectRepositoryBackendInfo | null>(null);
  const [catalogRevision, setCatalogRevision] = useState<number | null>(null);
  const latestCatalogRevision = useRef<number | null>(null);
  const refreshSequence = useRef(0);
  const versioned = projectRepository.versionedWorkspace;

  const reportError = useCallback((error: unknown) => {
    const message = errorMessage(error);
    operationErrors.current.project = message;
    setProjectError(message);
    setStatusMessage(message);
  }, []);

  const clearProjectError = useCallback(() => { operationErrors.current.project = null; setProjectError(null); }, []);
  const clearCatalogError = useCallback(() => { operationErrors.current.catalog = null; setCatalogError(null); }, []);

  const publishSnapshot = useCallback((workspace: WorkspaceDocument) => {
    if (latestCatalogRevision.current !== null && workspace.revision < latestCatalogRevision.current) return;
    const completeCatalog = workspaceDesignCatalog(workspace);
    latestCatalogRevision.current = workspace.revision;
    setCatalogRevision(workspace.revision);
    setDesignCatalog(completeCatalog);
    setCatalog(projectCatalogFromDesignCatalog(completeCatalog));
    setProjects(workspace.projectDocuments.map(entry => entry.summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    setBackendInfo(workspaceBackendInfo(workspace));
  }, []);

  const refreshProjects = useCallback(async (): Promise<void> => {
    const request = ++refreshSequence.current;
    try {
      if (projectRepository.versionedWorkspace) {
        const workspace = await projectRepository.versionedWorkspace.readAsync();
        if (request !== refreshSequence.current) return;
        publishSnapshot(workspace);
      } else {
        const [projectList, projectCatalog, info] = await Promise.all([
          projectRepository.listProjectsAsync(), projectRepository.listProjectCatalogAsync(), projectRepository.getBackendInfoAsync(),
        ]);
        if (request !== refreshSequence.current) return;
        setProjects(projectList); setCatalog(projectCatalog); setDesignCatalog(null); setBackendInfo(info);
      }
      setReadError(null);
      setStatusMessage(operationErrors.current.catalog ?? operationErrors.current.project ?? `Storage: ${projectRepository.backendLabel}`);
    } catch (error) {
      if (request === refreshSequence.current) {
        setReadError(errorMessage(error));
        setStatusMessage(errorMessage(error));
      }
    }
  }, [publishSnapshot, reportError]);

  useEffect(() => { void refreshProjects(); return () => { refreshSequence.current++; }; }, [refreshProjects]);

  async function execute(command: WorkspaceCommand, revision: number | null | undefined) {
    if (!versioned || revision === null || revision === undefined) throw new Error("Refresh the catalog or reopen the project before saving; no loaded workspace revision is available.");
    const receipt = await versioned.executeAsync(revision, command);
    refreshSequence.current++;
    publishSnapshot(receipt.workspace);
    return receipt;
  }

  async function save(project: PivotProject, result: LayoutResult | undefined, revision: PersistenceRevision, designId?: string, owner?: SaveFeedbackOwner): Promise<SaveOutcome> {
    try {
      let persistenceRevision: number | undefined;
      if (versioned) {
        const now = new Date().toISOString();
        const command: WorkspaceCommand = designId
          ? { type: "save_design_project", designId, project, now }
          : { type: "save_project", project, createOnly: revision === null, now };
        const receipt = await execute(command, revision === null ? latestCatalogRevision.current : revision);
        persistenceRevision = receipt.workspace.revision;
      } else {
        if (designId) await projectRepository.saveDesignProjectAsync(designId, project, result);
        else await projectRepository.saveProjectAsync(project, result);
        await refreshProjects();
      }
      if (!owner || owner.isCurrent()) {
        clearProjectError();
        setReadError(null);
        setStatusMessage(`Saved ${project.name} with ${projectRepository.backendLabel}.`);
      }
      return { saved: true, persistenceRevision };
    } catch (error) { if (!owner || owner.isCurrent()) reportError(error); return { saved: false }; }
  }

  async function open(id: string, byDesign: boolean): Promise<OpenedProject> {
    const workspace = versioned ? await versioned.readAsync() : null;
    const currentCatalog = workspace ? workspaceDesignCatalog(workspace) : await projectRepository.listProjectCatalogAsync();
    const design = currentCatalog.designs.find(item => byDesign ? item.id === id : "pivotProjectId" in item && item.pivotProjectId === id);
    const payloadId = byDesign && design && "pivotProjectId" in design ? design.pivotProjectId : id;
    const entry = workspace?.projectDocuments.find(item => item.summary.id === payloadId);
    const project = workspace ? entry ? parseProjectDocument(entry.document) : null
      : byDesign ? await projectRepository.loadDesignProjectAsync(id) : await projectRepository.loadProjectAsync(id);
    if (!project) throw new Error("Project or design was not found in local storage.");
    const field = currentCatalog.fieldMaps.find(item => item.id === design?.fieldMapId);
    const folder = currentCatalog.projects.find(item => item.id === field?.projectId);
    return { project, persistenceRevision: workspace?.revision,
      context: { clientId: folder?.clientId ?? null, projectId: folder?.id ?? null, fieldMapId: field?.id ?? null, designId: design?.id ?? null } };
  }

  async function mutate<T>(command: WorkspaceCommand, revision: number | null, native: () => Promise<T>, message: (value: T) => string): Promise<T | null> {
    try {
      const value = versioned ? (await execute(command, revision)).value as T : await native();
      if (!versioned) await refreshProjects();
      clearCatalogError(); setReadError(null); setStatusMessage(message(value));
      return value;
    } catch (error) {
      const message = errorMessage(error);
      operationErrors.current.catalog = message;
      setCatalogError(message); setStatusMessage(message);
      return null;
    }
  }

  const now = () => new Date().toISOString();
  const id = createCatalogId;
  return {
    backendLabel: projectRepository.backendLabel, backendInfo, catalog, designCatalog, catalogRevision, projects, statusMessage, storageError,
    canExportWorkspaceRecovery: Boolean(versioned), reportError, clearProjectError, clearCatalogError, refreshProjects,
    canCopyProject: Boolean(versioned),
    canSaveDraft: Boolean(versioned),
    async createDesignDraft(input, revision, owner) {
      try {
        const designId = id("design");
        const receipt = await execute({ type: "create_design_draft", designId, fieldMapId: input.fieldMapId,
          draft: input.draft, name: input.draft.name, now: now() }, revision);
        const field = receipt.workspace.catalog.fieldMaps.find(item => item.id === input.fieldMapId)!;
        const folder = receipt.workspace.catalog.projects.find(item => item.id === field.projectId)!;
        const entry = receipt.workspace.draftDocuments.find(item => item.id === input.draft.id)!;
        if (!owner || owner.isCurrent()) clearCatalogError();
        return { kind: "draft", draft: parseDesignDraftDocument(entry.document), persistenceRevision: receipt.workspace.revision,
          designRevision: 0, context: { clientId: folder.clientId, projectId: folder.id, fieldMapId: field.id, designId } };
      } catch (error) { if (!owner || owner.isCurrent()) reportError(error); return null; }
    },
    async saveDesignDraft(designId, draft, revision, designRevision, owner) {
      try {
        const receipt = await execute({ type: "save_design_draft", designId, draft,
          expectedDesignRevision: designRevision, now: now() }, revision);
        const design = receipt.workspace.catalog.designs.find(item => item.id === designId)!;
        if (!owner || owner.isCurrent()) { clearProjectError(); setStatusMessage(`Saved ${draft.name}.`); }
        return { saved: true, persistenceRevision: receipt.workspace.revision, designRevision: design.revision };
      } catch (error) { if (!owner || owner.isCurrent()) reportError(error); return { saved: false }; }
    },
    async copyProject(command, revision) {
      // The invoking dialog owns feedback; a late copy cannot report on another editor.
      const receipt = await execute(command, revision);
      return { project: receipt.value as PivotProject, persistenceRevision: receipt.workspace.revision };
    },
    async exportWorkspaceRecovery() {
      try {
        if (!versioned) throw new Error("Workspace recovery export is unavailable for this backend.");
        const outcome = await exportFileAsync("cplayout-workspace.recovery.json", await versioned.exportRecoveryAsync(), { mimeType: "application/json" });
        if (!outcome.ok) throw new Error(outcome.message);
        setStatusMessage(outcome.message);
      } catch (error) { setReadError(errorMessage(error)); setStatusMessage(errorMessage(error)); }
    },
    saveProject: (project, result, revision, owner) => save(project, result, revision, undefined, owner),
    saveDesignProject: (designId, project, result, revision, owner) => save(project, result, revision, designId, owner),
    openProject: projectId => open(projectId, false),
    openDesignProject: designId => versioned ? readVersionedDesign(versioned, designId)
      : open(designId, true).then((loaded) => ({ ...loaded, kind: "project" as const })),
    createClient: (input, revision) => mutate<ClientRecord>({ type: "create_client", input, id: id("client"), now: now() }, revision,
      () => projectRepository.createClientAsync(input), record => `Created client folder ${record.displayName}.`),
    updateClient: (input, revision) => mutate<ClientRecord>({ type: "update_client", input, now: now() }, revision,
      () => projectRepository.updateClientAsync(input), record => `Updated client folder ${record.displayName}.`),
    deleteClient: async (clientId, revision) => (await mutate<void>({ type: "delete_client", clientId, now: now() }, revision,
      () => projectRepository.deleteClientAsync(clientId), () => "Deleted empty client folder.")) !== null,
    deleteProject: async (projectId, revision) => (await mutate<void>({ type: "delete_project", projectId, now: now() }, revision,
      () => projectRepository.deleteProjectAsync(projectId), () => "Deleted local project entry.")) !== null,
    createProjectWithInitialDesign: (input, revision) => mutate<CreatedProjectWorkspace>({ type: "create_project_with_initial_design", input, now: now() }, revision,
      () => projectRepository.createProjectWithInitialDesignAsync(input), value => `Created project ${value.project.name}.`),
    createProjectWithInitialFieldMap: (input, revision) => mutate<CreatedProjectFieldMapWorkspace>({ type: "create_project_with_initial_field_map", input: { ...input, projectId: input.projectId ?? id("project") }, now: now() }, revision,
      () => projectRepository.createProjectWithInitialFieldMapAsync(input), value => `Created project ${value.projectRecord.name}.`),
    createProjectRecord: (input, revision) => mutate<CatalogProjectRecord>({ type: "create_project_record", input: { ...input, id: input.id ?? id("project") }, now: now() }, revision,
      () => projectRepository.createProjectRecordAsync(input), value => `Created project ${value.name}.`),
    renameProject: (projectId, name, revision) => mutate<CatalogProjectRecord>({ type: "rename_project", projectId, name, now: now() }, revision,
      () => projectRepository.renameProjectAsync(projectId, name), value => `Renamed project ${value.name}.`),
    moveProjectToClient: (projectId, clientId, revision) => mutate<CatalogProjectRecord>({ type: "move_project_to_client", projectId, clientId, now: now() }, revision,
      () => projectRepository.moveProjectToClientAsync(projectId, clientId), value => `Moved project ${value.name}.`),
    createFieldMapRecord: (input, revision) => mutate<FieldMapRecord>({ type: "create_field_map_record", input: { ...input, id: input.id ?? id("field-map") }, now: now() }, revision,
      () => projectRepository.createFieldMapRecordAsync(input), value => `Created field map ${value.name}.`),
    createDesignRecord: (input, revision) => mutate<DesignRecord>({ type: "create_design_record", input: { ...input, id: input.id ?? id("design") }, now: now() }, revision,
      () => projectRepository.createDesignRecordAsync(input), value => `Created design ${value.name}.`),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Local project storage operation failed.";
}
