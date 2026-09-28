import type { DesignDraft, FieldDesign, LayoutResult, PivotProject } from "@cplayout/core";
import type { WorkspaceDesignRecord, WorkspaceDocument } from "./workspaceDocument";
import type { WorkspaceCommand, WorkspaceCommandValue } from "./workspaceCommands";

export interface ClientRecord {
  id: string;
  displayName: string;
  sortName: string;
  companyName: string;
  contactName: string;
  primaryContactFirstName: string;
  primaryContactMiddleInitial: string;
  primaryContactLastName: string;
  primaryContactSuffix: string;
  email: string;
  phone: string;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogProjectRecord {
  id: string;
  clientId: string;
  name: string;
  projectCrs: string;
  unitSystem: string;
  createdAt: string;
  updatedAt: string;
}

export interface FieldMapRecord {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignRecord {
  id: string;
  fieldMapId: string;
  name: string;
  pivotProjectId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCatalog {
  clients: ClientRecord[];
  projects: CatalogProjectRecord[];
  fieldMaps: FieldMapRecord[];
  designs: DesignRecord[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  projectCrs: string;
  unitSystem: string;
  updatedAt: string;
}

export interface ClientProfileInput {
  companyName?: string;
  primaryContactFirstName: string;
  primaryContactLastName: string;
  primaryContactMiddleInitial?: string;
  primaryContactSuffix?: string;
  displayName?: string;
  sortName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  notes?: string;
}

export interface ClientProfileUpdateInput {
  id: string;
  companyName?: string;
  primaryContactFirstName?: string;
  primaryContactLastName?: string;
  primaryContactMiddleInitial?: string;
  primaryContactSuffix?: string;
  displayName?: string;
  sortName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  location?: string;
  notes?: string;
}

export interface CreateProjectWithInitialDesignInput {
  clientId: string;
  project: PivotProject;
  result?: LayoutResult;
  fieldMapId?: string;
  fieldMapName?: string;
  designId?: string;
  designName?: string;
}

export interface CreateProjectWithInitialFieldMapInput {
  clientId: string;
  projectId?: string;
  projectName: string;
  projectCrs: string;
  unitSystem: string;
  fieldMapId?: string;
  fieldMapName?: string;
}

export interface CreatedProjectWorkspace {
  project: PivotProject;
  projectRecord: CatalogProjectRecord;
  fieldMap: FieldMapRecord;
  design: DesignRecord;
}

export interface CreatedProjectFieldMapWorkspace {
  projectRecord: CatalogProjectRecord;
  fieldMap: FieldMapRecord;
}

export interface ProjectRepositoryBackendInfo {
  backendLabel: string;
  runtime: "native" | "web";
  storageEngine: "sqlite" | "local_storage";
  durable: boolean;
  schemaVersion?: number;
  projectCount?: number;
  supportsProjectList: boolean;
  supportsZipImport: boolean;
  supportsZipExport: boolean;
  notes: string[];
}

export type WorkspaceDesignCatalog = WorkspaceDocument["catalog"];
type OpenedDesignContext = {
  workspaceRevision: number;
  document: string;
  context: { clientId: string; projectId: string; fieldMapId: string; designId: string };
};
export type WorkspaceDesignRead =
  | { kind: "not_found"; workspaceRevision: number }
  | (OpenedDesignContext & { kind: "field"; design: Extract<WorkspaceDesignRecord, { kind: "field" }>; field: FieldDesign; originalProjectDocument?: string })
  | (OpenedDesignContext & { kind: "draft"; design: Extract<WorkspaceDesignRecord, { kind: "draft" }>; draft: DesignDraft })
  | (OpenedDesignContext & { kind: "project"; design: Extract<WorkspaceDesignRecord, { kind: "project" }>; project: PivotProject });

export interface VersionedWorkspaceRepository {
  readAsync(): Promise<WorkspaceDocument>;
  readDesignAsync(designId: string): Promise<WorkspaceDesignRead>;
  executeAsync(expectedRevision: number, command: WorkspaceCommand): Promise<{ workspace: WorkspaceDocument; value: WorkspaceCommandValue }>;
  exportRecoveryAsync(): Promise<string>;
}

export interface ProjectRepository {
  versionedWorkspace?: VersionedWorkspaceRepository;
  describeWorkspace?(workspace: WorkspaceDocument): ProjectRepositoryBackendInfo;
  listProjectsAsync(): Promise<ProjectSummary[]>;
  listProjectCatalogAsync(): Promise<ProjectCatalog>;
  saveProjectAsync(project: PivotProject, result?: LayoutResult): Promise<void>;
  saveDesignProjectAsync(designId: string, project: PivotProject, result?: LayoutResult): Promise<void>;
  loadProjectAsync(projectId: string): Promise<PivotProject | null>;
  loadDesignProjectAsync(designId: string): Promise<PivotProject | null>;
  deleteProjectAsync(projectId: string): Promise<void>;
  createClientAsync(input: ClientProfileInput): Promise<ClientRecord>;
  updateClientAsync(input: ClientProfileUpdateInput): Promise<ClientRecord>;
  deleteClientAsync(clientId: string): Promise<void>;
  createProjectWithInitialDesignAsync(input: CreateProjectWithInitialDesignInput): Promise<CreatedProjectWorkspace>;
  createProjectWithInitialFieldMapAsync(input: CreateProjectWithInitialFieldMapInput): Promise<CreatedProjectFieldMapWorkspace>;
  createProjectRecordAsync(input: { id?: string; clientId: string; name: string; projectCrs: string; unitSystem: string }): Promise<CatalogProjectRecord>;
  renameProjectAsync(projectId: string, name: string): Promise<CatalogProjectRecord>;
  moveProjectToClientAsync(projectId: string, clientId: string): Promise<CatalogProjectRecord>;
  createFieldMapRecordAsync(input: { id?: string; projectId: string; name: string }): Promise<FieldMapRecord>;
  createDesignRecordAsync(input: { id?: string; fieldMapId: string; name: string; pivotProjectId: string; isActive?: boolean }): Promise<DesignRecord>;
  getBackendInfoAsync(): Promise<ProjectRepositoryBackendInfo>;
  backendLabel: string;
}
