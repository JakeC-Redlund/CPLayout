import { z } from "zod";
import { emptyWorkspaceDocument, validateWorkspaceDocument, WorkspaceDocumentError, type WorkspaceDocument, } from "./workspaceDocument";
const text = z.string();
const id = text.min(1);
const dated = { created_at: text, updated_at: text, deleted_at: text.nullable() };
const schemas = {
    clients: z.object({ id, display_name: text, sort_name: text, company_name: text, contact_name: text,
        primary_contact_first_name: text, primary_contact_middle_initial: text, primary_contact_last_name: text,
        primary_contact_suffix: text, email: text, phone: text, location: text, notes: text, ...dated }).strict(),
    project_records: z.object({ id, client_id: id, name: text, project_crs: text, unit_system: text, ...dated }).strict(),
    field_maps: z.object({ id, project_record_id: id, name: text, ...dated }).strict(),
    designs: z.object({ id, field_map_id: id, name: text, pivot_project_id: id, is_active: z.union([z.literal(0), z.literal(1)]), ...dated }).strict(),
    projects: z.object({ id, name: text, project_crs: text, unit_system: text, source_json_version: text, ...dated }).strict(),
    project_snapshots: z.object({ project_id: id, project_json: text, updated_at: text }).strict(),
};
const SourceSchema = z.object({
    sourceVersion: z.literal("cplayout-sqlite-admission-source-v1"), schemaVersion: z.union([z.literal(11), z.literal(12)]),
    clients: z.array(schemas.clients), project_records: z.array(schemas.project_records),
    field_maps: z.array(schemas.field_maps), designs: z.array(schemas.designs),
    projects: z.array(schemas.projects), project_snapshots: z.array(schemas.project_snapshots),
    otherTables: z.array(text),
}).strict();
export type LegacySqliteSource = z.output<typeof SourceSchema>;
export interface MigrationReader {
    getFirstAsync<T>(sql: string): Promise<T | null>;
    getAllAsync<T>(sql: string): Promise<T[]>;
}
export interface TimestampConversion {
    table: keyof typeof schemas;
    id: string;
    column: string;
    original: string;
    iso: string;
}
/** Caller must supply one transaction-scoped reader; this function never starts or commits a migration. */
export async function readLegacySqliteSourceAsync(transaction: MigrationReader, expectedVersion: 11 | 12 = 11): Promise<LegacySqliteSource> {
    const version = await transaction.getFirstAsync<{
        user_version: unknown;
    }>("PRAGMA main.user_version;");
    if (version?.user_version !== expectedVersion)
        throw new WorkspaceDocumentError("unsupported_version", `Native admission requires an inspected v${expectedVersion} source; no schema upgrade is performed here.`);
    const source: Record<string, unknown> = { sourceVersion: "cplayout-sqlite-admission-source-v1", schemaVersion: expectedVersion };
    for (const table of Object.keys(schemas) as (keyof typeof schemas)[]) {
        const identity = await transaction.getFirstAsync<{
            type: string;
            sql: string;
        }>(`SELECT type, sql FROM main.sqlite_master WHERE name = '${table}';`);
        if (identity?.type !== "table" || /^CREATE\s+VIRTUAL\s+TABLE\b/i.test(identity.sql)) {
            throw new WorkspaceDocumentError("unsupported_version", `Expected an ordinary table for main.${table}.`);
        }
        const columns = await transaction.getAllAsync<{
            name: string;
        }>(`PRAGMA main.table_xinfo(${table});`);
        const names = columns.map(column => column.name).sort();
        if (JSON.stringify(names) !== JSON.stringify(Object.keys(schemas[table].shape).sort())) {
            throw new WorkspaceDocumentError("unsupported_version", `Unrecognized ${table} columns; retain the database for recovery.`);
        }
        source[table] = await transaction.getAllAsync(`SELECT * FROM main.${table} ORDER BY ${table === "project_snapshots" ? "project_id" : "id"};`);
    }
    source.otherTables = (await transaction.getAllAsync<{
        name: string;
    }>("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name;"))
        .map(row => row.name).filter(name => !Object.hasOwn(schemas, name));
    return SourceSchema.parse(source);
}
/** Read-only admission, not a database backup or an activated migration. */
export function admitLegacySqliteWorkspace(input: unknown): {
    workspace: WorkspaceDocument;
    source: LegacySqliteSource;
    revisionOrigin: "migration_baseline";
    timestampConversions: TimestampConversion[];
    retainedOnlyInSource: {
        clients: string[];
        projectRecords: string[];
        fieldMaps: string[];
        deletedProjectSnapshots: string[];
        otherTables: string[];
    };
} {
    const source = SourceSchema.parse(input);
    const timestampConversions: TimestampConversion[] = [];
    const iso = z.iso.datetime({ offset: true });
    function timestamp(table: keyof typeof schemas, id: string, column: string, value: string): string {
        if (iso.safeParse(value).success)
            return value;
        // Native legacy SQL writes CURRENT_TIMESTAMP in this UTC representation.
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
            const converted = value.replace(" ", "T") + ".000Z";
            if (iso.safeParse(converted).success) {
                timestampConversions.push({ table, id, column, original: value, iso: converted });
                return converted;
            }
        }
        throw new WorkspaceDocumentError("invalid_document", `Unsupported timestamp in ${table}.${column}; retain its original value.`);
    }
    function dates(table: keyof typeof schemas, row: {
        id: string;
        created_at: string;
        updated_at: string;
    }) {
        return { createdAt: timestamp(table, row.id, "created_at", row.created_at), updatedAt: timestamp(table, row.id, "updated_at", row.updated_at) };
    }
    for (const table of Object.keys(schemas) as (keyof typeof schemas)[]) {
        const ids = source[table].map(row => "id" in row ? row.id : row.project_id);
        if (new Set(ids).size !== ids.length)
            throw new WorkspaceDocumentError("conflict", `Duplicate ${table} row identity.`);
    }
    const workspace = emptyWorkspaceDocument();
    workspace.catalog.clients = source.clients.filter(row => row.deleted_at === null).map(row => ({ id: row.id, displayName: row.display_name, sortName: row.sort_name,
        companyName: row.company_name, contactName: row.contact_name, primaryContactFirstName: row.primary_contact_first_name,
        primaryContactMiddleInitial: row.primary_contact_middle_initial, primaryContactLastName: row.primary_contact_last_name,
        primaryContactSuffix: row.primary_contact_suffix, email: row.email, phone: row.phone, location: row.location,
        notes: row.notes, ...dates("clients", row) }));
    workspace.catalog.projects = source.project_records.filter(row => row.deleted_at === null).map(row => ({ id: row.id, clientId: row.client_id, name: row.name,
        projectCrs: row.project_crs, unitSystem: row.unit_system, ...dates("project_records", row) }));
    workspace.catalog.fieldMaps = source.field_maps.filter(row => row.deleted_at === null).map(row => ({ id: row.id, projectId: row.project_record_id, name: row.name, ...dates("field_maps", row) }));
    const projects = new Map(source.projects.map(row => [row.id, row]));
    const snapshots = new Map(source.project_snapshots.map(row => [row.project_id, row]));
    for (const snapshot of source.project_snapshots) {
        if (!projects.has(snapshot.project_id))
            throw new WorkspaceDocumentError("identity_mismatch", "Orphan project snapshot requires recovery.");
    }
    for (const row of source.projects) {
        if (row.source_json_version !== "pivot-project-v1")
            throw new WorkspaceDocumentError("unsupported_version", "Unsupported legacy project source version.");
        if (row.deleted_at !== null) {
            workspace.tombstones.push({ entity: "project_document", id: row.id, revision: 0, deletedAt: timestamp("projects", row.id, "deleted_at", row.deleted_at) });
            continue;
        }
        const snapshot = snapshots.get(row.id);
        if (!snapshot)
            throw new WorkspaceDocumentError("invalid_document", "Active project is missing its exact snapshot; reconstruction is not permitted.");
        const updatedAt = timestamp("projects", row.id, "updated_at", row.updated_at);
        const snapshotAt = timestamp("project_snapshots", row.id, "updated_at", snapshot.updated_at);
        if (Date.parse(updatedAt) !== Date.parse(snapshotAt))
            throw new WorkspaceDocumentError("conflict", "Project and snapshot timestamps disagree; reconcile before migration.");
        workspace.projectDocuments.push({ summary: { id: row.id, name: row.name, projectCrs: row.project_crs,
                unitSystem: row.unit_system, updatedAt }, document: snapshot.project_json });
    }
    for (const row of source.designs) {
        if (row.deleted_at !== null) {
            workspace.tombstones.push({ entity: "design", id: row.id, revision: 0, deletedAt: timestamp("designs", row.id, "deleted_at", row.deleted_at) });
        }
        else {
            workspace.catalog.designs.push({ id: row.id, fieldMapId: row.field_map_id, name: row.name, kind: "project",
                pivotProjectId: row.pivot_project_id, isActive: row.is_active === 1, revision: 0, ...dates("designs", row) });
        }
    }
    return { workspace: validateWorkspaceDocument(workspace), source, revisionOrigin: "migration_baseline", timestampConversions,
        retainedOnlyInSource: {
            clients: source.clients.filter(row => row.deleted_at !== null).map(row => row.id),
            projectRecords: source.project_records.filter(row => row.deleted_at !== null).map(row => row.id),
            fieldMaps: source.field_maps.filter(row => row.deleted_at !== null).map(row => row.id),
            deletedProjectSnapshots: source.project_snapshots.filter(row => projects.get(row.project_id)!.deleted_at !== null).map(row => row.project_id),
            otherTables: [...source.otherTables],
        } };
}
