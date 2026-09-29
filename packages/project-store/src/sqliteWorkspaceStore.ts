import { hasOperationalGnssEvidence } from "@cplayout/core";
import { validateWorkspaceDocument, serializeWorkspaceDocument, WorkspaceDocumentError, WORKSPACE_DOCUMENT_VERSION, type WorkspaceDocument, } from "./workspaceDocument";
import { applyWorkspaceCommand, parseWorkspaceCommand, type WorkspaceCommand } from "./workspaceCommands";
import { readWorkspaceDesign } from "./versionedProjectRepository";
import { parseStrictJson } from "./strictJson";
import type { VersionedWorkspaceRepository } from "./projectRepositoryTypes";
export interface WorkspaceDatabase {
    execAsync(sql: string): Promise<void>;
    getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
    runAsync(sql: string, ...params: (string | number)[]): Promise<{
        changes: number;
    }>;
    isInTransactionAsync(): Promise<boolean>;
    closeAsync(): Promise<void>;
}
export interface NativeWorkspaceHost {
    // Dedicated handle with verified schema, FULL durability, FK ON and bounded busy timeout.
    // The opener must NOT run legacy auto-migrations or share another caller's transaction.
    openReadyConnection(): Promise<WorkspaceDatabase>;
    // Read-only admission under the caller's lock, after full backup/recovery gates passed.
    admitLegacy(db: WorkspaceDatabase): Promise<{
        workspace: WorkspaceDocument;
        receipt: string;
    }>;
    // Read-only: verify preserved source/backup identity and reject later legacy writes.
    verifyAdmission(db: WorkspaceDatabase, receipt: string): Promise<void>;
    // Opaque evidence, available even when ordinary admission/document validation fails.
    captureLegacyRecovery(db: WorkspaceDatabase): Promise<unknown>;
    reportCleanupError?(error: unknown): void;
}
export class NativeWorkspaceStoreError extends Error {
    constructor(public readonly code: "not_initialized" | "recovery_required" | "commit_uncertain", message: string, public readonly original?: unknown) {
        super(message);
        this.name = "NativeWorkspaceStoreError";
    }
}
/** A command refusal after validating stored state; cleanup failures still override it. */
export class NativeWorkspaceCommandRefusal extends WorkspaceDocumentError {
    constructor(error: WorkspaceDocumentError) {
        super(error.code, error.message);
        this.name = "NativeWorkspaceCommandRefusal";
    }
}
const storeVersion = "cplayout-native-workspace-v1";
const metaTable = "cplayout_workspace_meta";
const recordsTable = "cplayout_workspace_records";
const admissionTable = "cplayout_workspace_admissions";
const kinds = ["client", "project", "field_map", "design", "project_document", "draft_document",
    "tombstone_design", "tombstone_project_document", "tombstone_draft_document"] as const;
type Kind = typeof kinds[number];
interface StoredRow {
    workspace_id: number;
    kind: Kind;
    id: string;
    position: number;
    record_json: string;
}
interface MetaRow {
    singleton: number;
    store_version: string;
    workspace_version: string;
    revision: number;
    admission_json: string;
}
// Schema installation belongs to the protected/versioned migration, never read/open.
export const SQLITE_WORKSPACE_SCHEMA = [
    `CREATE TABLE ${admissionTable} (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1), receipt_json TEXT NOT NULL
  )`,
    `CREATE TABLE ${metaTable} (
    singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
    store_version TEXT NOT NULL, workspace_version TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
    admission_json TEXT NOT NULL
  )`,
    `CREATE TABLE ${recordsTable} (
    workspace_id INTEGER NOT NULL DEFAULT 1 CHECK(workspace_id=1),
    kind TEXT NOT NULL CHECK(kind IN (${kinds.map(kind => `'${kind}'`).join(",")})),
    id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 9007199254740991),
    record_json TEXT NOT NULL, PRIMARY KEY(kind,id),
    FOREIGN KEY(workspace_id) REFERENCES ${metaTable}(singleton)
  )`,
    `CREATE INDEX main.cplayout_workspace_record_order ON ${recordsTable}(kind,position)`,
] as const;
function fail(message: string): never { throw new NativeWorkspaceStoreError("recovery_required", message); }
const key = (row: Pick<StoredRow, "kind" | "id">) => JSON.stringify([row.kind, row.id]);
/** Native schema v1 has no field row kind. Refuse before any SQL writes; no runtime v2 claim. */
export function assertNativeWorkspaceVersion(workspace: WorkspaceDocument): void {
    if (workspace.workspaceVersion !== WORKSPACE_DOCUMENT_VERSION) throw new WorkspaceDocumentError("unsupported_version", "Native field workspace v2 persistence requires a separately verified schema upgrade.");
}
function flatten(workspace: WorkspaceDocument): StoredRow[] {
    assertNativeWorkspaceVersion(workspace);
    const rows: StoredRow[] = [];
    const push = (kind: Kind, id: string, position: number, value: unknown) => rows.push({ workspace_id: 1, kind, id, position, record_json: JSON.stringify(value) });
    workspace.catalog.clients.forEach((item, index) => push("client", item.id, index, item));
    workspace.catalog.projects.forEach((item, index) => push("project", item.id, index, item));
    workspace.catalog.fieldMaps.forEach((item, index) => push("field_map", item.id, index, item));
    workspace.catalog.designs.forEach((item, index) => push("design", item.id, index, item));
    workspace.projectDocuments.forEach((item, index) => push("project_document", item.summary.id, index, item));
    workspace.draftDocuments.forEach((item, index) => push("draft_document", item.id, index, item));
    workspace.tombstones.forEach((item, index) => {
        if (item.entity === "field_document") throw new WorkspaceDocumentError("unsupported_version", "Native field tombstones require a v2 schema.");
        push(`tombstone_${item.entity}`, item.id, index, item);
    });
    return rows;
}
function hydrate(meta: MetaRow, rows: StoredRow[]): WorkspaceDocument {
    const catalog = { clients: [] as unknown[], projects: [] as unknown[], fieldMaps: [] as unknown[], designs: [] as unknown[] };
    const documents = { projectDocuments: [] as unknown[], draftDocuments: [] as unknown[], tombstones: [] as unknown[] };
    const groups: Record<Kind, unknown[]> = { client: catalog.clients, project: catalog.projects, field_map: catalog.fieldMaps,
        design: catalog.designs, project_document: documents.projectDocuments, draft_document: documents.draftDocuments,
        tombstone_design: documents.tombstones, tombstone_project_document: documents.tombstones, tombstone_draft_document: documents.tombstones };
    const seen = new Set<string>();
    for (const row of [...rows].sort((a, b) => a.position - b.position)) {
        if (row.workspace_id !== 1 || !kinds.includes(row.kind) || typeof row.id !== "string" || !row.id || typeof row.record_json !== "string" ||
            !Number.isSafeInteger(row.position) || row.position < 0 || seen.has(key(row)))
            fail("Invalid or duplicate workspace record.");
        seen.add(key(row));
        let item: unknown;
        try {
            item = parseStrictJson(row.record_json);
        }
        catch {
            return fail("Workspace record is not unambiguous JSON.");
        }
        if (!item || typeof item !== "object")
            fail("Invalid workspace record payload.");
        const value = item as {
            id?: unknown;
            summary?: {
                id?: unknown;
            };
            entity?: unknown;
        };
        if ((row.kind === "project_document" ? value.summary?.id : value.id) !== row.id)
            fail("Workspace row identity differs from its payload.");
        if (row.kind.startsWith("tombstone_") && `tombstone_${value.entity}` !== row.kind)
            fail("Deletion record kind differs from its payload.");
        const group = groups[row.kind];
        if (row.position !== group.length)
            fail("Workspace record order is missing, duplicated or invalid.");
        group.push(item);
    }
    return validateWorkspaceDocument({ workspaceVersion: meta.workspace_version, revision: meta.revision, catalog, ...documents });
}
async function readState(db: WorkspaceDatabase): Promise<{
    meta: MetaRow;
    rows: StoredRow[];
    workspace: WorkspaceDocument;
}> {
    const meta = await db.getAllAsync<MetaRow>(`SELECT singleton,store_version,workspace_version,revision,admission_json FROM main.${metaTable};`);
    if (!meta.length) {
        const admissions = await db.getAllAsync(`SELECT singleton FROM main.${admissionTable} LIMIT 1;`);
        const records = await db.getAllAsync(`SELECT id FROM main.${recordsTable} LIMIT 1;`);
        if (admissions.length || records.length)
            fail("Native workspace header is missing from previously stored data; recovery is required.");
        throw new NativeWorkspaceStoreError("not_initialized", "Native workspace admission has not completed.");
    }
    const header = meta[0];
    if (meta.length !== 1 || header.singleton !== 1 || header.store_version !== storeVersion ||
        header.workspace_version !== WORKSPACE_DOCUMENT_VERSION || !Number.isSafeInteger(header.revision) || header.revision < 0 ||
        typeof header.admission_json !== "string" || !header.admission_json)
        fail("Native workspace header is invalid or unsupported.");
    const admission = await db.getAllAsync<{
        singleton: number;
        receipt_json: string;
    }>(`SELECT * FROM main.${admissionTable};`);
    if (admission.length !== 1 || admission[0].singleton !== 1 || admission[0].receipt_json !== header.admission_json) {
        fail("Native admission history is missing or conflicts with the workspace.");
    }
    const rows = await db.getAllAsync<StoredRow>(`SELECT workspace_id,kind,id,position,record_json FROM main.${recordsTable};`);
    return { meta: header, rows, workspace: hydrate(header, rows) };
}
export function assertDeletionContinuity(previous: WorkspaceDocument, next: WorkspaceDocument): void {
    const tombstones = new Map(next.tombstones.map(item => [JSON.stringify([item.entity, item.id]), item]));
    for (const old of previous.tombstones) {
        const retained = tombstones.get(JSON.stringify([old.entity, old.id]));
        if (!retained || retained.revision !== old.revision || retained.deletedAt !== old.deletedAt) {
            throw new WorkspaceDocumentError("conflict", "Deletion history cannot be removed or rewritten.");
        }
    }
    const collections = [
        { entity: "design", before: previous.catalog.designs.map(item => item.id), after: next.catalog.designs.map(item => item.id) },
        { entity: "project_document", before: previous.projectDocuments.map(item => item.summary.id), after: next.projectDocuments.map(item => item.summary.id) },
        { entity: "draft_document", before: previous.draftDocuments.map(item => item.id), after: next.draftDocuments.map(item => item.id) },
    ];
    for (const collection of collections) {
        const retained = new Set(collection.after);
        for (const id of collection.before) {
            if (!retained.has(id) && !tombstones.has(JSON.stringify([collection.entity, id]))) {
                throw new WorkspaceDocumentError("conflict", "Removed designs and documents require deletion records.");
            }
        }
    }
}
async function writeRows(db: WorkspaceDatabase, previous: StoredRow[], next: StoredRow[]) {
    const old = new Map(previous.map(row => [key(row), row]));
    const keep = new Set(next.map(key));
    for (const row of previous) {
        if (!keep.has(key(row))) {
            const result = await db.runAsync(`DELETE FROM main.${recordsTable} WHERE kind=? AND id=?;`, row.kind, row.id);
            if (result.changes !== 1)
                fail("Workspace delete did not affect exactly its intended row.");
        }
    }
    for (const row of next) {
        const prior = old.get(key(row));
        if (prior && prior.position === row.position && prior.record_json === row.record_json)
            continue;
        const result = prior
            ? await db.runAsync(`UPDATE main.${recordsTable} SET position=?,record_json=? WHERE kind=? AND id=?;`, row.position, row.record_json, row.kind, row.id)
            : await db.runAsync(`INSERT INTO main.${recordsTable}(kind,id,position,record_json) VALUES(?,?,?,?);`, row.kind, row.id, row.position, row.record_json);
        if (result.changes !== 1)
            fail("Workspace write did not affect exactly its intended row.");
    }
}
export async function initializeWorkspaceInTransaction(db: WorkspaceDatabase, host: Pick<NativeWorkspaceHost, "admitLegacy" | "verifyAdmission">): Promise<WorkspaceDocument> {
    if (!await db.isInTransactionAsync())
        fail("Admission requires the migration owner's transaction.");
    const checked = async () => {
        const state = await readState(db);
        await host.verifyAdmission(db, state.meta.admission_json);
        return state.workspace;
    };
    const headers = await db.getAllAsync(`SELECT singleton FROM main.${metaTable};`);
    if (headers.length)
        return checked();
    if ((await db.getAllAsync(`SELECT singleton FROM main.${admissionTable};`)).length)
        fail("A previously admitted workspace is missing; preserve it for recovery instead of reinitializing.");
    if ((await db.getAllAsync(`SELECT id FROM main.${recordsTable} LIMIT 1;`)).length)
        fail("Workspace rows exist without their admission header.");
    const admitted = await host.admitLegacy(db);
    const workspace = validateWorkspaceDocument(admitted.workspace);
    assertNativeWorkspaceVersion(workspace);
    if (workspace.revision !== 0)
        fail("Legacy admission must explicitly establish revision zero.");
    if (typeof admitted.receipt !== "string" || !admitted.receipt)
        fail("Native admission receipt is missing.");
    await host.verifyAdmission(db, admitted.receipt);
    await db.runAsync(`INSERT INTO main.${admissionTable}(singleton,receipt_json) VALUES(1,?);`, admitted.receipt);
    await db.runAsync(`INSERT INTO main.${metaTable}(singleton,store_version,workspace_version,revision,admission_json) VALUES(1,?,?,?,?);`, storeVersion, workspace.workspaceVersion, workspace.revision, admitted.receipt);
    await writeRows(db, [], flatten(workspace));
    const stored = await checked();
    if (serializeWorkspaceDocument(stored) !== serializeWorkspaceDocument(workspace))
        fail("Workspace initialization did not persist the exact admitted state.");
    return stored;
}
export async function readWorkspaceInTransaction(db: WorkspaceDatabase, verify: NativeWorkspaceHost["verifyAdmission"]): Promise<WorkspaceDocument> {
    if (!await db.isInTransactionAsync())
        fail("Workspace read requires its owner's transaction.");
    const state = await readState(db);
    await verify(db, state.meta.admission_json);
    return state.workspace;
}
export function createSqliteWorkspaceStore(host: NativeWorkspaceHost): VersionedWorkspaceRepository & {
    initializeAdmittedAsync(): Promise<WorkspaceDocument>;
} {
    function cleanup(error: unknown) { try {
        host.reportCleanupError?.(error);
    }
    catch { /* Reporting must not change a commit outcome. */ } }
    async function transaction<T>(write: boolean, action: (db: WorkspaceDatabase) => Promise<T>): Promise<T> {
        const db = await host.openReadyConnection();
        let active = false;
        let commitAttempted = false;
        let result!: T;
        let failed = false;
        let primaryError: unknown;
        const cleanupErrors: unknown[] = [];
        try {
            if (await db.isInTransactionAsync())
                fail("Native workspace requires its own connection.");
            await db.execAsync(write ? "BEGIN IMMEDIATE;" : "BEGIN;");
            active = true;
            result = await action(db);
            if (write) {
                commitAttempted = true;
                await db.execAsync("COMMIT;");
            }
            else
                await db.execAsync("ROLLBACK;");
            active = false;
        }
        catch (error) {
            failed = true;
            primaryError = error;
            if (active) {
                try {
                    if (await db.isInTransactionAsync())
                        await db.execAsync("ROLLBACK;");
                }
                catch (rollbackError) {
                    cleanupErrors.push(rollbackError);
                    cleanup(rollbackError);
                }
            }
        }
        finally {
            try {
                await db.closeAsync();
            }
            catch (error) {
                cleanupErrors.push(error);
                cleanup(error);
            }
        }
        const errors = [...(failed ? [primaryError] : []), ...cleanupErrors];
        if (commitAttempted && errors.length)
            throw new NativeWorkspaceStoreError("commit_uncertain", "Save acknowledgement or cleanup failed; reopen to reconcile before retrying.", new AggregateError(errors));
        if (cleanupErrors.length)
            throw new NativeWorkspaceStoreError("recovery_required", "Workspace operation cleanup failed; recovery is required.", new AggregateError(errors));
        if (failed)
            throw primaryError;
        return result;
    }
    async function checked(db: WorkspaceDatabase) {
        const state = await readState(db);
        await host.verifyAdmission(db, state.meta.admission_json);
        return state;
    }
    const store = {
        async initializeAdmittedAsync(): Promise<WorkspaceDocument> {
            return transaction(true, db => initializeWorkspaceInTransaction(db, host));
        },
        readAsync(): Promise<WorkspaceDocument> { return transaction(false, async (db) => (await checked(db)).workspace); },
        async readDesignAsync(designId: string) { return readWorkspaceDesign(await store.readAsync(), designId); },
        async executeAsync(expectedRevision: number, command: WorkspaceCommand) {
            const captured = parseWorkspaceCommand(command);
            if (hasOperationalGnssEvidence(captured)) throw new NativeWorkspaceCommandRefusal(new WorkspaceDocumentError("unsupported_version", "Operational fixed-GGA persistence requires the browser workspace; native activation is not verified."));
            if (["import_design_document", "upgrade_workspace_to_v3", "create_complete_design_from_draft", "create_layout_session", "append_layout_observation", "rename_layout_session", "archive_layout_session", "copy_layout_session", "import_layout_session", "upgrade_workspace_to_v2", "create_field_design", "save_field_design", "copy_field_design", "convert_project_to_field_design", "adopt_field_plan"].includes(captured.type)) {
                throw new NativeWorkspaceCommandRefusal(new WorkspaceDocumentError("unsupported_version", "Native field workspace v2 and workflow v3 operations are not supported by the current schema; preserve the source and use a verified adapter."));
            }
            if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
                throw new NativeWorkspaceCommandRefusal(new WorkspaceDocumentError("conflict", "Invalid loaded workspace revision."));
            return transaction(true, async (db) => {
                const latest = await checked(db);
                if (latest.workspace.revision !== expectedRevision)
                    throw new NativeWorkspaceCommandRefusal(new WorkspaceDocumentError("conflict", "Workspace changed; reload before saving."));
                let result: ReturnType<typeof applyWorkspaceCommand>;
                try {
                    result = applyWorkspaceCommand(latest.workspace, captured);
                }
                catch (error) {
                    if (error instanceof WorkspaceDocumentError)
                        throw new NativeWorkspaceCommandRefusal(error);
                    throw error;
                }
                const next = validateWorkspaceDocument(result.workspace);
                if (next.revision !== expectedRevision + 1 || !Number.isSafeInteger(next.revision))
                    throw new WorkspaceDocumentError("conflict", "Workspace must advance one revision.");
                assertDeletionContinuity(latest.workspace, next);
                await writeRows(db, latest.rows, flatten(next));
                const updated = await db.runAsync(`UPDATE main.${metaTable} SET revision=? WHERE singleton=1 AND revision=?;`, next.revision, expectedRevision);
                if (updated.changes !== 1)
                    throw new WorkspaceDocumentError("conflict", "Workspace revision compare-and-swap failed.");
                const stored = await checked(db);
                if (serializeWorkspaceDocument(stored.workspace) !== serializeWorkspaceDocument(next))
                    fail("Workspace transaction did not persist its exact result.");
                return { workspace: stored.workspace, value: result.value };
            });
        },
        exportRecoveryAsync(): Promise<string> {
            return transaction(false, async (db) => JSON.stringify({
                recoveryVersion: "cplayout-native-workspace-recovery-v1", consistency: "sqlite_read_transaction",
                metaRows: await db.getAllAsync(`SELECT * FROM main.${metaTable};`),
                admissionRows: await db.getAllAsync(`SELECT * FROM main.${admissionTable};`),
                recordRows: await db.getAllAsync(`SELECT * FROM main.${recordsTable} ORDER BY kind,id;`),
                legacyEvidence: await host.captureLegacyRecovery(db),
            }));
        },
    };
    return store;
}
