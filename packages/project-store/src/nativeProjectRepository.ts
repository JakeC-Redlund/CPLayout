import { parseEditableProjectDocument } from "./projectDocumentEditing";
import { workspaceProjectCatalog } from "./versionedProjectRepository";
import { validateWorkspaceDocument, WorkspaceDocumentError, type WorkspaceDocument } from "./workspaceDocument";
import type { ProjectRepository, ProjectRepositoryBackendInfo, VersionedWorkspaceRepository } from "./projectRepositoryTypes";
import { createSqliteWorkspaceStore, type NativeWorkspaceHost } from "./sqliteWorkspaceStore";
import { WORKSPACE_MIGRATION } from "./nativeWorkspaceBinding";
export interface NativeVersionedProjectRepository extends ProjectRepository {
    versionedWorkspace: VersionedWorkspaceRepository;
    // Project counts and backend identity describe the same accepted snapshot, without another read.
    describeWorkspace(workspace: WorkspaceDocument): ProjectRepositoryBackendInfo;
}
export function describeNativeWorkspace(workspace: WorkspaceDocument): ProjectRepositoryBackendInfo {
    const current = validateWorkspaceDocument(workspace);
    return {
        backendLabel: "Expo SQLite", runtime: "native", storageEngine: "sqlite", durable: true,
        schemaVersion: WORKSPACE_MIGRATION.id, projectCount: current.projectDocuments.length,
        supportsProjectList: true, supportsZipImport: false, supportsZipExport: false,
        notes: [
            "Workspace saves use SQLite transactions and loaded revisions. Keep a separate recovery export.",
            "Retained legacy tables are read-only. New survey logging and native ZIP workflows are not enabled by this adapter.",
            "Android/iOS runtime verification remains required; backend identity is not device qualification.",
        ],
    };
}
/** The host must have completed protected migration; ordinary reads never initialize it. */
export function createNativeVersionedProjectRepository(host: NativeWorkspaceHost): NativeVersionedProjectRepository {
    const store = createSqliteWorkspaceStore(host);
    const versionedWorkspace: VersionedWorkspaceRepository = {
        readAsync: () => store.readAsync(),
        readDesignAsync: designId => store.readDesignAsync(designId),
        executeAsync: (revision, command) => store.executeAsync(revision, command),
        exportRecoveryAsync: () => store.exportRecoveryAsync(),
    };
    const revisionRequired = async (): Promise<never> => {
        throw new WorkspaceDocumentError("conflict", "Reload the project or catalog and save with its original workspace revision.");
    };
    return {
        backendLabel: "Expo SQLite", versionedWorkspace, describeWorkspace: describeNativeWorkspace,
        async getBackendInfoAsync() { return describeNativeWorkspace(await versionedWorkspace.readAsync()); },
        async listProjectsAsync() {
            return (await versionedWorkspace.readAsync()).projectDocuments.map(entry => entry.summary)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        },
        async listProjectCatalogAsync() { return workspaceProjectCatalog(await versionedWorkspace.readAsync()); },
        async loadProjectAsync(projectId) {
            const entry = (await versionedWorkspace.readAsync()).projectDocuments.find(item => item.summary.id === projectId);
            return entry ? parseEditableProjectDocument(entry.document) : null;
        },
        async loadDesignProjectAsync(designId) {
            const read = await versionedWorkspace.readDesignAsync(designId);
            if (read.kind === "not_found")
                return null;
            if (read.kind !== "project")
                throw new WorkspaceDocumentError("unsupported_version", "Open this document with the incomplete-design editor.");
            return read.project;
        },
        saveProjectAsync: revisionRequired, saveDesignProjectAsync: revisionRequired, deleteProjectAsync: revisionRequired,
        createClientAsync: revisionRequired, updateClientAsync: revisionRequired, deleteClientAsync: revisionRequired,
        createProjectWithInitialDesignAsync: revisionRequired, createProjectWithInitialFieldMapAsync: revisionRequired,
        createProjectRecordAsync: revisionRequired, renameProjectAsync: revisionRequired, moveProjectToClientAsync: revisionRequired,
        createFieldMapRecordAsync: revisionRequired, createDesignRecordAsync: revisionRequired,
    };
}
