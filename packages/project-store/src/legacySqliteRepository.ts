import { parseProjectDocument, serializeProjectDocument } from "../../core/src/index";
import { LegacyBusinessRefusal, legacyBusinessValidation } from "./legacyBusinessRefusal";
import type { LayoutResult, PivotProject } from "../../core/src/index";
import { buildSaveProjectStatementPlan } from "./projectPersistence";
import { LOAD_ACTIVE_PROJECT_BY_ID_SQL } from "./projectRepositorySql";
import { defaultDesignId, defaultFieldMapId, LEGACY_CLIENT_ID, LEGACY_CLIENT_NAME, assertClientPrimaryContact, normalizeCatalogSortName, normalizeClientRecord, createCatalogId, } from "./projectCatalog";
import type { SQLiteDatabase } from "./expoSqliteTypes";
import type { CatalogProjectRecord, CreatedProjectFieldMapWorkspace, CreatedProjectWorkspace, CreateProjectWithInitialFieldMapInput, CreateProjectWithInitialDesignInput, ClientRecord, ClientProfileInput, ClientProfileUpdateInput, DesignRecord, FieldMapRecord, ProjectCatalog, ProjectRepository, ProjectRepositoryBackendInfo, ProjectSummary, } from "./projectRepositoryTypes";
export interface SqliteRepositoryOptions {
    backendLabel: string;
    runtime: ProjectRepositoryBackendInfo["runtime"];
    storageEngine?: ProjectRepositoryBackendInfo["storageEngine"];
    notes: string[];
}
type SqliteProjectDatabase = SQLiteDatabase;
type SqliteAsyncExecutor = Pick<SqliteProjectDatabase, "execAsync" | "getAllAsync" | "getFirstAsync" | "runAsync">;
async function withRepositoryTransactionAsync(db: SqliteProjectDatabase, task: (transaction: SqliteAsyncExecutor) => Promise<void>): Promise<void> {
    await db.withExclusiveTransactionAsync(async (transaction) => {
        await task(transaction);
    });
}
export function createLegacySqliteProjectRepository(options: SqliteRepositoryOptions, openProjectDatabaseAsync: () => Promise<SQLiteDatabase>): ProjectRepository {
    const repository: ProjectRepository = {
        backendLabel: options.backendLabel,
        async getBackendInfoAsync() {
            const db = await openProjectDatabaseAsync();
            await ensureCatalogRowsAsync(db);
            const version = await db.getFirstAsync<{
                user_version: number | null;
            }>("PRAGMA user_version;");
            const count = await db.getFirstAsync<{
                count: number;
            }>("SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NULL;");
            const clientCount = await db.getFirstAsync<{
                count: number;
            }>("SELECT COUNT(*) AS count FROM clients WHERE deleted_at IS NULL;");
            return {
                backendLabel: repository.backendLabel,
                runtime: options.runtime,
                storageEngine: options.storageEngine ?? "sqlite",
                durable: true,
                schemaVersion: Number(version?.user_version ?? 0),
                projectCount: Number(count?.count ?? 0),
                supportsProjectList: true,
                supportsZipImport: true,
                supportsZipExport: true,
                notes: [
                    ...options.notes,
                    `Catalog contains ${Number(clientCount?.count ?? 0)} client folder${Number(clientCount?.count ?? 0) === 1 ? "" : "s"}.`,
                ],
            };
        },
        async listProjectsAsync(): Promise<ProjectSummary[]> {
            const db = await openProjectDatabaseAsync();
            const rows = await db.getAllAsync<{
                id: string;
                name: string;
                project_crs: string;
                unit_system: string;
                updated_at: string;
            }>("SELECT id, name, project_crs, unit_system, updated_at FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC;");
            return rows.map((row) => ({
                id: row.id,
                name: row.name,
                projectCrs: row.project_crs,
                unitSystem: row.unit_system,
                updatedAt: row.updated_at,
            }));
        },
        async listProjectCatalogAsync(): Promise<ProjectCatalog> {
            const db = await openProjectDatabaseAsync();
            await ensureCatalogRowsAsync(db);
            return readCatalogAsync(db);
        },
        async saveProjectAsync(project: PivotProject, result?: LayoutResult): Promise<void> {
            const db = await openProjectDatabaseAsync();
            const plan = legacyBusinessValidation(() => buildSaveProjectStatementPlan(project, result));
            await withRepositoryTransactionAsync(db, async (transaction) => {
                for (const statement of plan) {
                    await transaction.runAsync(statement.sql, statement.params);
                }
                const clientCount = await transaction.getFirstAsync<{
                    count: number;
                }>("SELECT COUNT(*) AS count FROM clients WHERE deleted_at IS NULL;");
                if (Number(clientCount?.count ?? 0) === 0) {
                    await ensureCatalogPathForProjectAsync(transaction, project);
                }
            });
        },
        async saveDesignProjectAsync(designId: string, project: PivotProject, result?: LayoutResult): Promise<void> {
            await repository.saveProjectAsync(project, result);
            const db = await openProjectDatabaseAsync();
            const now = new Date().toISOString();
            await db.runAsync(`UPDATE designs
        SET name = ?, pivot_project_id = ?, updated_at = ?, deleted_at = NULL
        WHERE id = ?`, project.name, project.id, now, designId);
        },
        async loadProjectAsync(projectId: string): Promise<PivotProject | null> {
            const db = await openProjectDatabaseAsync();
            const row = await db.getFirstAsync<{
                project_json: string;
            }>(LOAD_ACTIVE_PROJECT_BY_ID_SQL, projectId);
            return row ? parseProjectDocument(row.project_json) : null;
        },
        async loadDesignProjectAsync(designId: string): Promise<PivotProject | null> {
            const db = await openProjectDatabaseAsync();
            const row = await db.getFirstAsync<{
                pivot_project_id: string;
            }>("SELECT pivot_project_id FROM designs WHERE id = ? AND deleted_at IS NULL;", designId);
            return row ? repository.loadProjectAsync(row.pivot_project_id) : null;
        },
        async deleteProjectAsync(projectId: string): Promise<void> {
            const db = await openProjectDatabaseAsync();
            await withRepositoryTransactionAsync(db, async (transaction) => {
                await transaction.runAsync(`UPDATE projects
          SET deleted_at = CURRENT_TIMESTAMP
          WHERE id = ? OR id IN (
            SELECT d.pivot_project_id
            FROM designs d
            JOIN field_maps f ON f.id = d.field_map_id
            WHERE f.project_record_id = ? AND d.deleted_at IS NULL
          );`, projectId, projectId);
                await transaction.runAsync("UPDATE project_records SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?;", projectId);
                await transaction.runAsync(`UPDATE field_maps
          SET deleted_at = CURRENT_TIMESTAMP
          WHERE project_record_id = ?`, projectId);
                await transaction.runAsync(`UPDATE designs
          SET deleted_at = CURRENT_TIMESTAMP
          WHERE pivot_project_id = ? OR field_map_id IN (
            SELECT id FROM field_maps WHERE project_record_id = ?
          )`, projectId, projectId);
            });
        },
        async createClientAsync(input: ClientProfileInput): Promise<ClientRecord> {
            const db = await openProjectDatabaseAsync();
            const now = new Date().toISOString();
            const record = normalizeClientRecord({
                id: createCatalogId("client", now),
                ...input,
                createdAt: now,
                updatedAt: now,
            });
            if (!record)
                throw new LegacyBusinessRefusal("Client folder could not be created.");
            legacyBusinessValidation(() => assertClientPrimaryContact(record));
            await db.runAsync(`INSERT INTO clients (
          id,
          display_name,
          sort_name,
          company_name,
          contact_name,
          primary_contact_first_name,
          primary_contact_middle_initial,
          primary_contact_last_name,
          primary_contact_suffix,
          email,
          phone,
          location,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, record.id, record.displayName, record.sortName, record.companyName, record.contactName, record.primaryContactFirstName, record.primaryContactMiddleInitial, record.primaryContactLastName, record.primaryContactSuffix, record.email, record.phone, record.location, record.notes, record.createdAt, record.updatedAt);
            return record;
        },
        async updateClientAsync(input: ClientProfileUpdateInput): Promise<ClientRecord> {
            const db = await openProjectDatabaseAsync();
            const existing = await db.getFirstAsync<{
                id: string;
                display_name: string;
                sort_name: string;
                company_name: string | null;
                contact_name: string | null;
                primary_contact_first_name: string | null;
                primary_contact_middle_initial: string | null;
                primary_contact_last_name: string | null;
                primary_contact_suffix: string | null;
                email: string | null;
                phone: string | null;
                location: string | null;
                notes: string | null;
                created_at: string;
                updated_at: string;
            }>(`SELECT
          id,
          display_name,
          sort_name,
          company_name,
          contact_name,
          primary_contact_first_name,
          primary_contact_middle_initial,
          primary_contact_last_name,
          primary_contact_suffix,
          email,
          phone,
          location,
          notes,
          created_at,
          updated_at
        FROM clients
        WHERE id = ? AND deleted_at IS NULL;`, input.id);
            if (!existing)
                throw new LegacyBusinessRefusal("Client folder was not found in the local catalog.");
            const now = new Date().toISOString();
            const { id: _inputId, ...profileInput } = input;
            const record = normalizeClientRecord({
                id: existing.id,
                displayName: existing.display_name,
                sortName: existing.sort_name,
                companyName: textField(existing.company_name),
                contactName: textField(existing.contact_name),
                primaryContactFirstName: textField(existing.primary_contact_first_name),
                primaryContactMiddleInitial: textField(existing.primary_contact_middle_initial),
                primaryContactLastName: textField(existing.primary_contact_last_name),
                primaryContactSuffix: textField(existing.primary_contact_suffix),
                email: textField(existing.email),
                phone: textField(existing.phone),
                location: textField(existing.location),
                notes: textField(existing.notes),
                ...profileInput,
                createdAt: existing.created_at,
                updatedAt: now,
            });
            if (!record)
                throw new LegacyBusinessRefusal("Client folder could not be updated.");
            legacyBusinessValidation(() => assertClientPrimaryContact(record));
            await db.runAsync(`UPDATE clients
        SET
          display_name = ?,
          sort_name = ?,
          company_name = ?,
          contact_name = ?,
          primary_contact_first_name = ?,
          primary_contact_middle_initial = ?,
          primary_contact_last_name = ?,
          primary_contact_suffix = ?,
          email = ?,
          phone = ?,
          location = ?,
          notes = ?,
          updated_at = ?
        WHERE id = ? AND deleted_at IS NULL;`, record.displayName, record.sortName, record.companyName, record.contactName, record.primaryContactFirstName, record.primaryContactMiddleInitial, record.primaryContactLastName, record.primaryContactSuffix, record.email, record.phone, record.location, record.notes, record.updatedAt, record.id);
            return record;
        },
        async deleteClientAsync(clientId: string): Promise<void> {
            const db = await openProjectDatabaseAsync();
            const projectCount = await db.getFirstAsync<{
                count: number;
            }>("SELECT COUNT(*) AS count FROM project_records WHERE client_id = ? AND deleted_at IS NULL;", clientId);
            if (Number(projectCount?.count ?? 0) > 0) {
                throw new LegacyBusinessRefusal("Client folder still contains projects. Move or delete those projects before deleting the client.");
            }
            await db.runAsync("UPDATE clients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL;", clientId);
        },
        async createProjectWithInitialDesignAsync(input: CreateProjectWithInitialDesignInput): Promise<CreatedProjectWorkspace> {
            const db = await openProjectDatabaseAsync();
            const project = input.project;
            const now = new Date().toISOString();
            const projectRecord: CatalogProjectRecord = {
                id: project.id,
                clientId: input.clientId,
                name: normalizeCatalogSortName(project.name),
                projectCrs: project.projectCrs,
                unitSystem: project.unitSystem,
                createdAt: now,
                updatedAt: now,
            };
            const fieldMap: FieldMapRecord = {
                id: input.fieldMapId ?? defaultFieldMapId(project.id),
                projectId: project.id,
                name: normalizeCatalogSortName(input.fieldMapName ?? "Primary Field Map"),
                createdAt: now,
                updatedAt: now,
            };
            const design: DesignRecord = {
                id: input.designId ?? defaultDesignId(project.id),
                fieldMapId: fieldMap.id,
                name: normalizeCatalogSortName(input.designName ?? "Base Design"),
                pivotProjectId: project.id,
                isActive: true,
                createdAt: now,
                updatedAt: now,
            };
            await withRepositoryTransactionAsync(db, async (transaction) => {
                const client = await transaction.getFirstAsync<{
                    id: string;
                }>("SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL;", input.clientId);
                if (!client)
                    throw new LegacyBusinessRefusal("Select or create a client folder before creating a project.");
                const plan = legacyBusinessValidation(() => buildSaveProjectStatementPlan(project, input.result));
                for (const statement of plan)
                    await transaction.runAsync(statement.sql, statement.params);
                await transaction.runAsync(`INSERT INTO project_records (id, client_id, name, project_crs, unit_system, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            client_id = excluded.client_id,
            name = excluded.name,
            project_crs = excluded.project_crs,
            unit_system = excluded.unit_system,
            updated_at = excluded.updated_at,
            deleted_at = NULL`, projectRecord.id, projectRecord.clientId, projectRecord.name, projectRecord.projectCrs, projectRecord.unitSystem, projectRecord.createdAt, projectRecord.updatedAt);
                await transaction.runAsync(`INSERT INTO field_maps (id, project_record_id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            project_record_id = excluded.project_record_id,
            name = excluded.name,
            updated_at = excluded.updated_at,
            deleted_at = NULL`, fieldMap.id, fieldMap.projectId, fieldMap.name, fieldMap.createdAt, fieldMap.updatedAt);
                await transaction.runAsync(`INSERT INTO designs (id, field_map_id, name, pivot_project_id, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            field_map_id = excluded.field_map_id,
            name = excluded.name,
            pivot_project_id = excluded.pivot_project_id,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at,
            deleted_at = NULL`, design.id, design.fieldMapId, design.name, design.pivotProjectId, design.createdAt, design.updatedAt);
            });
            return { project, projectRecord, fieldMap, design };
        },
        async createProjectWithInitialFieldMapAsync(input: CreateProjectWithInitialFieldMapInput): Promise<CreatedProjectFieldMapWorkspace> {
            const db = await openProjectDatabaseAsync();
            const now = new Date().toISOString();
            const projectId = input.projectId ?? createCatalogId("project", now);
            const projectRecord: CatalogProjectRecord = {
                id: projectId,
                clientId: input.clientId,
                name: normalizeCatalogSortName(input.projectName),
                projectCrs: normalizeCatalogSortName(input.projectCrs),
                unitSystem: normalizeCatalogSortName(input.unitSystem),
                createdAt: now,
                updatedAt: now,
            };
            const fieldMap: FieldMapRecord = {
                id: input.fieldMapId ?? defaultFieldMapId(projectId),
                projectId,
                name: normalizeCatalogSortName(input.fieldMapName ?? "Primary Field Map"),
                createdAt: now,
                updatedAt: now,
            };
            await withRepositoryTransactionAsync(db, async (transaction) => {
                const client = await transaction.getFirstAsync<{
                    id: string;
                }>("SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL;", input.clientId);
                if (!client)
                    throw new LegacyBusinessRefusal("Select or create a client folder before creating a project.");
                await transaction.runAsync(`INSERT INTO project_records (id, client_id, name, project_crs, unit_system, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            client_id = excluded.client_id,
            name = excluded.name,
            project_crs = excluded.project_crs,
            unit_system = excluded.unit_system,
            updated_at = excluded.updated_at,
            deleted_at = NULL`, projectRecord.id, projectRecord.clientId, projectRecord.name, projectRecord.projectCrs, projectRecord.unitSystem, projectRecord.createdAt, projectRecord.updatedAt);
                await transaction.runAsync(`INSERT INTO field_maps (id, project_record_id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            project_record_id = excluded.project_record_id,
            name = excluded.name,
            updated_at = excluded.updated_at,
            deleted_at = NULL`, fieldMap.id, fieldMap.projectId, fieldMap.name, fieldMap.createdAt, fieldMap.updatedAt);
            });
            return { projectRecord, fieldMap };
        },
        async createProjectRecordAsync(input: {
            id?: string;
            clientId: string;
            name: string;
            projectCrs: string;
            unitSystem: string;
        }): Promise<CatalogProjectRecord> {
            const db = await openProjectDatabaseAsync();
            const now = new Date().toISOString();
            const record: CatalogProjectRecord = {
                id: input.id ?? createCatalogId("project", now),
                clientId: input.clientId,
                name: normalizeCatalogSortName(input.name),
                projectCrs: input.projectCrs,
                unitSystem: input.unitSystem,
                createdAt: now,
                updatedAt: now,
            };
            await db.runAsync(`INSERT INTO project_records (id, client_id, name, project_crs, unit_system, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          client_id = excluded.client_id,
          name = excluded.name,
          project_crs = excluded.project_crs,
          unit_system = excluded.unit_system,
          updated_at = excluded.updated_at,
          deleted_at = NULL`, record.id, record.clientId, record.name, record.projectCrs, record.unitSystem, record.createdAt, record.updatedAt);
            return record;
        },
        async renameProjectAsync(projectId: string, name: string): Promise<CatalogProjectRecord> {
            const db = await openProjectDatabaseAsync();
            const trimmedName = normalizeCatalogSortName(name);
            const now = new Date().toISOString();
            let updatedRecord: CatalogProjectRecord | null = null;
            await withRepositoryTransactionAsync(db, async (transaction) => {
                const projectRecord = await transaction.getFirstAsync<{
                    id: string;
                    client_id: string;
                    name: string;
                    project_crs: string;
                    unit_system: string;
                    created_at: string;
                    updated_at: string;
                }>("SELECT id, client_id, name, project_crs, unit_system, created_at, updated_at FROM project_records WHERE id = ? AND deleted_at IS NULL;", projectId);
                if (!projectRecord)
                    throw new LegacyBusinessRefusal("Project folder was not found in the local catalog.");
                updatedRecord = {
                    id: projectRecord.id,
                    clientId: projectRecord.client_id,
                    name: trimmedName,
                    projectCrs: projectRecord.project_crs,
                    unitSystem: projectRecord.unit_system,
                    createdAt: projectRecord.created_at,
                    updatedAt: now,
                };
                await transaction.runAsync("UPDATE projects SET name = ?, updated_at = ?, deleted_at = NULL WHERE id = ?;", trimmedName, now, projectId);
                const snapshot = await transaction.getFirstAsync<{
                    project_json: string;
                }>(LOAD_ACTIVE_PROJECT_BY_ID_SQL, projectId);
                if (snapshot) {
                    const updatedProject = { ...parseProjectDocument(snapshot.project_json), name: trimmedName };
                    await transaction.runAsync("UPDATE project_snapshots SET project_json = ?, updated_at = ? WHERE project_id = ?;", serializeProjectDocument(updatedProject), now, projectId);
                }
                await transaction.runAsync("UPDATE project_records SET name = ?, updated_at = ?, deleted_at = NULL WHERE id = ?;", trimmedName, now, projectId);
            });
            if (!updatedRecord)
                throw new LegacyBusinessRefusal("Project folder was not found in the local catalog.");
            return updatedRecord;
        },
        async moveProjectToClientAsync(projectId: string, clientId: string): Promise<CatalogProjectRecord> {
            const db = await openProjectDatabaseAsync();
            const now = new Date().toISOString();
            let moved: CatalogProjectRecord | null = null;
            await withRepositoryTransactionAsync(db, async (transaction) => {
                const client = await transaction.getFirstAsync<{
                    id: string;
                }>("SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL;", clientId);
                if (!client)
                    throw new LegacyBusinessRefusal("Target client folder was not found in the local catalog.");
                const projectRecord = await transaction.getFirstAsync<{
                    id: string;
                    client_id: string;
                    name: string;
                    project_crs: string;
                    unit_system: string;
                    created_at: string;
                    updated_at: string;
                }>("SELECT id, client_id, name, project_crs, unit_system, created_at, updated_at FROM project_records WHERE id = ? AND deleted_at IS NULL;", projectId);
                if (!projectRecord)
                    throw new LegacyBusinessRefusal("Project folder was not found in the local catalog.");
                moved = {
                    id: projectRecord.id,
                    clientId,
                    name: projectRecord.name,
                    projectCrs: projectRecord.project_crs,
                    unitSystem: projectRecord.unit_system,
                    createdAt: projectRecord.created_at,
                    updatedAt: now,
                };
                await transaction.runAsync("UPDATE project_records SET client_id = ?, updated_at = ?, deleted_at = NULL WHERE id = ?;", clientId, now, projectId);
            });
            if (!moved)
                throw new LegacyBusinessRefusal("Project folder was not found in the local catalog.");
            return moved;
        },
        async createFieldMapRecordAsync(input: {
            id?: string;
            projectId: string;
            name: string;
        }): Promise<FieldMapRecord> {
            const db = await openProjectDatabaseAsync();
            const now = new Date().toISOString();
            const record: FieldMapRecord = {
                id: input.id ?? createCatalogId("field-map", now),
                projectId: input.projectId,
                name: normalizeCatalogSortName(input.name),
                createdAt: now,
                updatedAt: now,
            };
            await db.runAsync(`INSERT INTO field_maps (id, project_record_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_record_id = excluded.project_record_id,
          name = excluded.name,
          updated_at = excluded.updated_at,
          deleted_at = NULL`, record.id, record.projectId, record.name, record.createdAt, record.updatedAt);
            return record;
        },
        async createDesignRecordAsync(input: {
            id?: string;
            fieldMapId: string;
            name: string;
            pivotProjectId: string;
            isActive?: boolean;
        }): Promise<DesignRecord> {
            const db = await openProjectDatabaseAsync();
            const now = new Date().toISOString();
            const record: DesignRecord = {
                id: input.id ?? createCatalogId("design", now),
                fieldMapId: input.fieldMapId,
                name: normalizeCatalogSortName(input.name),
                pivotProjectId: input.pivotProjectId,
                isActive: input.isActive ?? true,
                createdAt: now,
                updatedAt: now,
            };
            await withRepositoryTransactionAsync(db, async (transaction) => {
                const fieldMap = await transaction.getFirstAsync<{
                    id: string;
                }>("SELECT id FROM field_maps WHERE id = ? AND deleted_at IS NULL;", input.fieldMapId);
                if (!fieldMap)
                    throw new LegacyBusinessRefusal("Field map was not found in the local catalog.");
                const pivotProject = await transaction.getFirstAsync<{
                    id: string;
                }>("SELECT id FROM projects WHERE id = ? AND deleted_at IS NULL;", input.pivotProjectId);
                if (!pivotProject)
                    throw new LegacyBusinessRefusal("Create or import a saved design project before adding a design row.");
                await transaction.runAsync(`INSERT INTO designs (id, field_map_id, name, pivot_project_id, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            field_map_id = excluded.field_map_id,
            name = excluded.name,
            pivot_project_id = excluded.pivot_project_id,
            is_active = excluded.is_active,
            updated_at = excluded.updated_at,
            deleted_at = NULL`, record.id, record.fieldMapId, record.name, record.pivotProjectId, record.isActive ? 1 : 0, record.createdAt, record.updatedAt);
            });
            return record;
        },
    };
    return repository;
}
async function readCatalogAsync(db: SqliteAsyncExecutor): Promise<ProjectCatalog> {
    const clients = await db.getAllAsync<{
        id: string;
        display_name: string;
        sort_name: string;
        company_name: string | null;
        contact_name: string | null;
        primary_contact_first_name: string | null;
        primary_contact_middle_initial: string | null;
        primary_contact_last_name: string | null;
        primary_contact_suffix: string | null;
        email: string | null;
        phone: string | null;
        location: string | null;
        notes: string | null;
        created_at: string;
        updated_at: string;
    }>(`SELECT
      id,
      display_name,
      sort_name,
      company_name,
      contact_name,
      primary_contact_first_name,
      primary_contact_middle_initial,
      primary_contact_last_name,
      primary_contact_suffix,
      email,
      phone,
      location,
      notes,
      created_at,
      updated_at
    FROM clients
    WHERE deleted_at IS NULL
    ORDER BY sort_name COLLATE NOCASE, display_name COLLATE NOCASE;`);
    const projects = await db.getAllAsync<{
        id: string;
        client_id: string;
        name: string;
        project_crs: string;
        unit_system: string;
        created_at: string;
        updated_at: string;
    }>("SELECT id, client_id, name, project_crs, unit_system, created_at, updated_at FROM project_records WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;");
    const fieldMaps = await db.getAllAsync<{
        id: string;
        project_record_id: string;
        name: string;
        created_at: string;
        updated_at: string;
    }>("SELECT id, project_record_id, name, created_at, updated_at FROM field_maps WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE;");
    const designs = await db.getAllAsync<{
        id: string;
        field_map_id: string;
        name: string;
        pivot_project_id: string;
        is_active: number;
        created_at: string;
        updated_at: string;
    }>("SELECT id, field_map_id, name, pivot_project_id, is_active, created_at, updated_at FROM designs WHERE deleted_at IS NULL ORDER BY is_active DESC, name COLLATE NOCASE;");
    return {
        clients: clients
            .map((row) => normalizeClientRecord({
            id: row.id,
            displayName: row.display_name,
            sortName: row.sort_name,
            companyName: textField(row.company_name),
            contactName: textField(row.contact_name),
            primaryContactFirstName: textField(row.primary_contact_first_name),
            primaryContactMiddleInitial: textField(row.primary_contact_middle_initial),
            primaryContactLastName: textField(row.primary_contact_last_name),
            primaryContactSuffix: textField(row.primary_contact_suffix),
            email: textField(row.email),
            phone: textField(row.phone),
            location: textField(row.location),
            notes: textField(row.notes),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }))
            .filter((client): client is ClientRecord => Boolean(client)),
        projects: projects.map((row) => ({
            id: row.id,
            clientId: row.client_id,
            name: row.name,
            projectCrs: row.project_crs,
            unitSystem: row.unit_system,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })),
        fieldMaps: fieldMaps.map((row) => ({
            id: row.id,
            projectId: row.project_record_id,
            name: row.name,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })),
        designs: designs.map((row) => ({
            id: row.id,
            fieldMapId: row.field_map_id,
            name: row.name,
            pivotProjectId: row.pivot_project_id,
            isActive: row.is_active === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        })),
    };
}
async function ensureCatalogRowsAsync(db: SqliteProjectDatabase): Promise<void> {
    const existing = await db.getFirstAsync<{
        count: number;
    }>("SELECT COUNT(*) AS count FROM clients WHERE deleted_at IS NULL;");
    if (Number(existing?.count ?? 0) > 0)
        return;
    const summaries = await db.getAllAsync<{
        id: string;
        name: string;
        project_crs: string;
        unit_system: string;
        created_at: string;
        updated_at: string;
    }>("SELECT id, name, project_crs, unit_system, created_at, updated_at FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC;");
    if (summaries.length === 0)
        return;
    const now = new Date().toISOString();
    await withRepositoryTransactionAsync(db, async (transaction) => {
        await insertLegacyClientAsync(transaction, now);
        for (const summary of summaries) {
            await transaction.runAsync(`INSERT OR IGNORE INTO project_records (id, client_id, name, project_crs, unit_system, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, summary.id, LEGACY_CLIENT_ID, summary.name, summary.project_crs, summary.unit_system, summary.created_at, summary.updated_at);
            await transaction.runAsync(`INSERT OR IGNORE INTO field_maps (id, project_record_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`, defaultFieldMapId(summary.id), summary.id, "Primary Field Map", summary.created_at, summary.updated_at);
            await transaction.runAsync(`INSERT OR IGNORE INTO designs (id, field_map_id, name, pivot_project_id, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)`, defaultDesignId(summary.id), defaultFieldMapId(summary.id), summary.name, summary.id, summary.created_at, summary.updated_at);
        }
    });
}
async function ensureCatalogPathForProjectAsync(db: SqliteAsyncExecutor, project: PivotProject): Promise<void> {
    const design = await db.getFirstAsync<{
        id: string;
    }>("SELECT id FROM designs WHERE pivot_project_id = ? AND deleted_at IS NULL LIMIT 1;", project.id);
    if (design)
        return;
    const now = new Date().toISOString();
    await insertLegacyClientAsync(db, now);
    await db.runAsync(`INSERT OR IGNORE INTO project_records (id, client_id, name, project_crs, unit_system, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, project.id, LEGACY_CLIENT_ID, project.name, project.projectCrs, project.unitSystem, now, now);
    await db.runAsync(`INSERT OR IGNORE INTO field_maps (id, project_record_id, name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)`, defaultFieldMapId(project.id), project.id, "Primary Field Map", now, now);
    await db.runAsync(`INSERT OR IGNORE INTO designs (id, field_map_id, name, pivot_project_id, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)`, defaultDesignId(project.id), defaultFieldMapId(project.id), project.name, project.id, now, now);
}
async function insertLegacyClientAsync(db: SqliteAsyncExecutor, now: string): Promise<void> {
    await db.runAsync(`INSERT OR IGNORE INTO clients (
      id,
      display_name,
      sort_name,
      company_name,
      contact_name,
      primary_contact_first_name,
      primary_contact_middle_initial,
      primary_contact_last_name,
      primary_contact_suffix,
      email,
      phone,
      location,
      notes,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, '', '', '', '', '', '', '', '', '', '', ?, ?)`, LEGACY_CLIENT_ID, LEGACY_CLIENT_NAME, LEGACY_CLIENT_NAME, now, now);
}
function textField(value: unknown): string {
    return typeof value === "string" ? value : "";
}
