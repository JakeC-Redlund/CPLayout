import type { SQLiteDatabase } from "./expoSqliteTypes";
import type { ProjectRepository } from "./projectRepositoryTypes";
import type { LegacyDatabaseOwner } from "./legacyDatabaseOwner";
import { createLegacySqliteProjectRepository, type SqliteRepositoryOptions } from "./legacySqliteRepository";
export function createManagedLegacyRepository(options: SqliteRepositoryOptions, owner: LegacyDatabaseOwner<SQLiteDatabase>): ProjectRepository {
    const run = <Value>(task: (repository: ProjectRepository) => Promise<Value>) => owner.run(open => task(createLegacySqliteProjectRepository(options, open)));
    // Each raw factory lives inside one admitted operation; nested methods keep its scope.
    return Object.freeze({
        backendLabel: options.backendLabel,
        getBackendInfoAsync: () => run(r => r.getBackendInfoAsync()),
        listProjectsAsync: () => run(r => r.listProjectsAsync()),
        listProjectCatalogAsync: () => run(r => r.listProjectCatalogAsync()),
        saveProjectAsync: (...args) => run(r => r.saveProjectAsync(...args)),
        saveDesignProjectAsync: (...args) => run(r => r.saveDesignProjectAsync(...args)),
        loadProjectAsync: (...args) => run(r => r.loadProjectAsync(...args)),
        loadDesignProjectAsync: (...args) => run(r => r.loadDesignProjectAsync(...args)),
        deleteProjectAsync: (...args) => run(r => r.deleteProjectAsync(...args)),
        createClientAsync: (...args) => run(r => r.createClientAsync(...args)),
        updateClientAsync: (...args) => run(r => r.updateClientAsync(...args)),
        deleteClientAsync: (...args) => run(r => r.deleteClientAsync(...args)),
        createProjectWithInitialDesignAsync: (...args) => run(r => r.createProjectWithInitialDesignAsync(...args)),
        createProjectWithInitialFieldMapAsync: (...args) => run(r => r.createProjectWithInitialFieldMapAsync(...args)),
        createProjectRecordAsync: (...args) => run(r => r.createProjectRecordAsync(...args)),
        renameProjectAsync: (...args) => run(r => r.renameProjectAsync(...args)),
        moveProjectToClientAsync: (...args) => run(r => r.moveProjectToClientAsync(...args)),
        createFieldMapRecordAsync: (...args) => run(r => r.createFieldMapRecordAsync(...args)),
        createDesignRecordAsync: (...args) => run(r => r.createDesignRecordAsync(...args)),
    } satisfies ProjectRepository);
}
