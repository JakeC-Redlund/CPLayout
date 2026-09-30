export interface Migration {
    id: number;
    name: string;
    statements: readonly string[];
    dataStep?: string;
}
export interface UpgradeDatabase {
    execAsync(sql: string): Promise<void>;
    getFirstAsync<T>(sql: string): Promise<T | null>;
    getAllAsync<T>(sql: string): Promise<T[]>;
    runAsync(sql: string, ...parameters: (number | string)[]): Promise<unknown>;
    isInTransactionAsync(): Promise<boolean>;
    closeAsync(): Promise<void>;
}
export interface BackupArtifact {
    identity: string;
    sha256: string;
}
export interface PreparedUpgrade {
    format: "cplayout-prepared-upgrade-v1";
    attemptId: string;
    sourceIdentity: string;
    fromVersion: number;
    toVersion: number;
    planSha256: string;
    backup: BackupArtifact;
}
export interface UpgradeHost {
    sourceIdentity: string;
    // A new, private handle; never a shared repository/transaction handle.
    openSource(): Promise<UpgradeDatabase>;
    sha256(text: string): Promise<string>;
    // Allocate a unique durable destination; retain failed artifacts, never overwrite.
    backupMain(source: UpgradeDatabase, attemptId: string): Promise<BackupArtifact>;
    // Reopen the completed backup and compare its schema/content to this pinned source.
    // Integrity/version alone are insufficient. Verify file digest and sidecar handling.
    verifyBackup(source: UpgradeDatabase, artifact: BackupArtifact): Promise<void>;
    // Check required schema objects/constraints, not only ledger and user_version.
    verifyTargetSchema(source: UpgradeDatabase): Promise<void>;
    // Exclusive, durable write of an immutable prepared receipt, BEFORE source writes.
    persistPrepared(receipt: PreparedUpgrade): Promise<void>;
    // Trusted, versioned data step. Must not open/commit/rollback its own transaction.
    applyDataStep?(db: UpgradeDatabase, step: string, receipt: PreparedUpgrade): Promise<void>;
}
export interface UpgradeOutcome {
    state: "unchanged" | "committed" | "not_committed" | "recovery_required";
    prepared?: PreparedUpgrade;
    error?: unknown;
    cleanupErrors: unknown[];
}
const receiptTable = "cplayout_upgrade_receipts";
const shaPattern = /^[a-f0-9]{64}$/;
// Verified in commit 01fb543: only labels changed; keep the original ledger intact.
const historicalNames = new Map<number, readonly [
    string,
    string
]>([
    [5, ["add_client_project_field_design_catalog", "add_customer_project_field_design_catalog"]],
    [6, ["add_client_profile_fields", "add_customer_profile_fields"]],
    [7, ["add_client_structured_contact_fields", "add_customer_structured_contact_fields"]],
]);
function snapshotPlan(input: readonly Migration[]): Migration[] {
    if (input.length === 0)
        throw new Error("Migration plan is empty.");
    return input.map((migration, index) => {
        if (migration.id !== index + 1 || !migration.name || migration.statements.length === 0) {
            throw new Error("Migration plan must have contiguous named versions starting at one.");
        }
        if (migration.statements.some((sql) => typeof sql !== "string" || !sql.trim())) {
            throw new Error("Migration statements must be nonempty trusted SQL.");
        }
        if (migration.dataStep !== undefined && !/^[a-zA-Z0-9_-]{1,100}$/.test(migration.dataStep)) {
            throw new Error("Invalid versioned migration data step.");
        }
        return { id: migration.id, name: migration.name, statements: [...migration.statements],
            ...(migration.dataStep === undefined ? {} : { dataStep: migration.dataStep }) };
    });
}
export function serializeMigrationPlan(input: readonly Migration[]): string {
    return JSON.stringify(snapshotPlan(input));
}
async function readVersion(db: UpgradeDatabase, maximum: number): Promise<number> {
    const value = (await db.getFirstAsync<{
        user_version: unknown;
    }>("PRAGMA main.user_version;"))?.user_version;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
        throw new Error("Database version is invalid or unsupported; migration withheld.");
    }
    return value;
}
export async function verifyLedger(db: UpgradeDatabase, plan: readonly Migration[], version: number): Promise<void> {
    if (version === 0) {
        const objects = await db.getAllAsync<{
            name: string;
        }>("SELECT name FROM main.sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name<>'schema_migrations';");
        if (objects.length)
            throw new Error("Unversioned application schema requires explicit recovery.");
    }
    const table = await db.getFirstAsync<{
        type: string;
    }>("SELECT type FROM main.sqlite_schema WHERE name='schema_migrations';");
    if (!table && version === 0)
        return;
    if (table?.type !== "table")
        throw new Error("Migration ledger is missing or not a table.");
    const rows = await db.getAllAsync<{
        id: number;
        name: string;
    }>("SELECT id,name FROM main.schema_migrations ORDER BY id;");
    if (rows.length !== version || rows.some((row, index) => {
        const currentName = plan[index]?.name;
        const aliases = historicalNames.get(row.id);
        const historicalMatch = aliases?.[0] === currentName && aliases[1] === row.name;
        return row.id !== index + 1 || (row.name !== currentName && !historicalMatch);
    })) {
        throw new Error("Migration ledger disagrees with the declared version/plan.");
    }
}
async function verifyForeignKeys(db: UpgradeDatabase): Promise<void> {
    if ((await db.getAllAsync("PRAGMA main.foreign_key_check;")).length) {
        throw new Error("Foreign-key violations require recovery before migration admission.");
    }
}
async function verifyReceiptSchema(db: UpgradeDatabase, optional = false): Promise<void> {
    const object = await db.getFirstAsync<{
        type: string;
    }>(`SELECT type FROM main.sqlite_schema WHERE name='${receiptTable}';`);
    if (!object && optional)
        return;
    if (object?.type !== "table")
        throw new Error("Upgrade receipt table is missing or invalid.");
    const columns = await db.getAllAsync<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
        hidden: number;
        dflt_value: unknown;
    }>(`PRAGMA main.table_xinfo('${receiptTable}');`);
    const expected = ["attempt_id", "receipt_json"];
    if (columns.length !== 2 || columns.some((column, index) => column.name !== expected[index] ||
        column.type !== "TEXT" || column.notnull !== 1 || column.pk !== (index === 0 ? 1 : 0) ||
        column.hidden !== 0 || column.dflt_value !== null)) {
        throw new Error("Upgrade receipt schema/constraints are invalid.");
    }
}
// Only the coordinator owns BEGIN/COMMIT. Inputs are the repository's trusted plan.
export async function applyPendingMigrationsInTransaction(db: UpgradeDatabase, plan: readonly Migration[], fromVersion: number, applyDataStep?: (db: UpgradeDatabase, step: string) => Promise<void>): Promise<void> {
    if (!await db.isInTransactionAsync())
        throw new Error("An owned transaction is required.");
    if (plan.some(entry => entry.id > fromVersion && entry.dataStep) && !applyDataStep) {
        throw new Error("Migration data step implementation is missing.");
    }
    for (const migration of plan.filter((entry) => entry.id > fromVersion)) {
        for (const sql of migration.statements)
            await db.execAsync(sql);
        if (migration.dataStep) {
            await applyDataStep!(db, migration.dataStep);
            if (!await db.isInTransactionAsync())
                throw new Error("Data step lost its owned transaction.");
        }
        await db.runAsync("INSERT INTO main.schema_migrations (id,name) VALUES (?,?);", migration.id, migration.name);
        await db.execAsync(`PRAGMA main.user_version=${migration.id};`);
    }
}
export async function coordinateUpgrade(host: UpgradeHost, inputPlan: readonly Migration[], attemptId: string): Promise<UpgradeOutcome> {
    let db: UpgradeDatabase | undefined;
    let ownedTransaction = false;
    let commitAttempted = false;
    const result: UpgradeOutcome = { state: "not_committed", cleanupErrors: [] };
    try {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(attemptId) || !host.sourceIdentity)
            throw new Error("Invalid attempt/source identity.");
        const plan = snapshotPlan(inputPlan);
        const maximum = plan.length;
        const planSha256 = await host.sha256(serializeMigrationPlan(plan));
        if (!shaPattern.test(planSha256))
            throw new Error("Invalid migration-plan digest.");
        db = await host.openSource();
        if (await db.isInTransactionAsync())
            throw new Error("Source handle already has a transaction.");
        await readVersion(db, maximum);
        const databases = await db.getAllAsync<{
            name: string;
        }>("PRAGMA database_list;");
        if (databases.some((entry) => entry.name !== "main" && entry.name !== "temp")) {
            throw new Error("Attached databases are outside this main-database preservation policy.");
        }
        const journal = await db.getFirstAsync<{
            journal_mode: string;
        }>("PRAGMA main.journal_mode;");
        if (!journal || !["wal", "delete", "truncate", "persist"].includes(journal.journal_mode)) {
            throw new Error("Unsafe or unsupported journal mode.");
        }
        await db.execAsync("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA read_uncommitted=OFF;");
        const fk = await db.getFirstAsync<{
            foreign_keys: number;
        }>("PRAGMA foreign_keys;");
        const sync = await db.getFirstAsync<{
            synchronous: number;
        }>("PRAGMA synchronous;");
        const dirty = await db.getFirstAsync<{
            read_uncommitted: number;
        }>("PRAGMA read_uncommitted;");
        if (fk?.foreign_keys !== 1 || sync?.synchronous !== 2 || dirty?.read_uncommitted !== 0) {
            throw new Error("Connection safety settings were not applied.");
        }
        await db.execAsync("BEGIN DEFERRED;");
        ownedTransaction = true;
        // user_version begins the authoritative read snapshot before backup or migration.
        const fromVersion = await readVersion(db, maximum);
        await verifyLedger(db, plan, fromVersion);
        await verifyForeignKeys(db);
        if (fromVersion === maximum) {
            await host.verifyTargetSchema(db);
            await verifyReceiptSchema(db, true);
            await db.execAsync("ROLLBACK;");
            ownedTransaction = false;
            result.state = "unchanged";
        }
        else {
            const rawArtifact = await host.backupMain(db, attemptId);
            const backup = Object.freeze({ identity: rawArtifact.identity, sha256: rawArtifact.sha256 });
            if (!backup.identity || backup.identity === host.sourceIdentity || !shaPattern.test(backup.sha256)) {
                throw new Error("Invalid/distinct backup identity or digest.");
            }
            await host.verifyBackup(db, backup);
            if (!await db.isInTransactionAsync())
                throw new Error("Backup lost the source transaction.");
            const receipt: PreparedUpgrade = Object.freeze({
                format: "cplayout-prepared-upgrade-v1", attemptId, sourceIdentity: host.sourceIdentity,
                fromVersion, toVersion: maximum, planSha256, backup,
            });
            await host.persistPrepared(receipt);
            result.prepared = receipt;
            await applyPendingMigrationsInTransaction(db, plan, fromVersion, host.applyDataStep ? (connection, step) => host.applyDataStep!(connection, step, receipt) : undefined);
            // Candidate storage-contract addition; native activation must version this table.
            await db.execAsync(`CREATE TABLE IF NOT EXISTS main.${receiptTable} (
        attempt_id TEXT PRIMARY KEY NOT NULL, receipt_json TEXT NOT NULL
      );`);
            await verifyReceiptSchema(db);
            await db.runAsync(`INSERT INTO main.${receiptTable} (attempt_id,receipt_json) VALUES (?,?);`, attemptId, JSON.stringify(receipt));
            const stored = await db.getAllAsync<{
                attempt_id: string;
                receipt_json: string;
            }>(`SELECT attempt_id,receipt_json FROM main.${receiptTable};`);
            const matching = stored.filter((row) => row.attempt_id === attemptId);
            if (matching.length !== 1 || matching[0].receipt_json !== JSON.stringify(receipt)) {
                throw new Error("Upgrade receipt was not stored exactly; migration withheld.");
            }
            if (await readVersion(db, maximum) !== maximum)
                throw new Error("Migration did not reach target version.");
            await verifyLedger(db, plan, maximum);
            await verifyForeignKeys(db);
            await host.verifyTargetSchema(db);
            commitAttempted = true;
            await db.execAsync("COMMIT;");
            ownedTransaction = false;
            result.state = "committed";
        }
    }
    catch (error) {
        result.error = error;
        // A bridge can reject after SQLite committed. Only a fresh receipt read resolves that.
        if (commitAttempted)
            result.state = "recovery_required";
        if (db && ownedTransaction) {
            try {
                if (await db.isInTransactionAsync())
                    await db.execAsync("ROLLBACK;");
            }
            catch (cleanupError) {
                result.cleanupErrors.push(cleanupError);
                result.state = "recovery_required";
            }
        }
    }
    finally {
        if (db) {
            try {
                await db.closeAsync();
            }
            catch (error) {
                result.cleanupErrors.push(error);
            }
        }
    }
    return result;
}
export async function reconcileUpgrade(db: UpgradeDatabase, inputPlan: readonly Migration[], prepared: PreparedUpgrade, context: {
    sourceIdentity: string;
    sha256(text: string): Promise<string>;
    verifyRetainedBackup(receipt: PreparedUpgrade): Promise<void>;
    verifyTargetSchema(source: UpgradeDatabase): Promise<void>;
}): Promise<"committed" | "not_committed" | "recovery_required"> {
    // Caller owns a fresh connection/read transaction and validates manifest provenance.
    if (!await db.isInTransactionAsync())
        throw new Error("Reconciliation requires a pinned read transaction.");
    try {
        const plan = snapshotPlan(inputPlan);
        if (prepared.format !== "cplayout-prepared-upgrade-v1" || prepared.sourceIdentity !== context.sourceIdentity ||
            prepared.toVersion !== plan.length || !Number.isSafeInteger(prepared.fromVersion) ||
            prepared.fromVersion < 0 || prepared.fromVersion >= prepared.toVersion ||
            prepared.planSha256 !== await context.sha256(serializeMigrationPlan(plan)))
            return "recovery_required";
        await context.verifyRetainedBackup(prepared);
        const version = await readVersion(db, plan.length);
        const exists = await db.getFirstAsync<{
            type: string;
        }>(`SELECT type FROM main.sqlite_schema WHERE name='${receiptTable}';`);
        if (exists && exists.type !== "table")
            return "recovery_required";
        if (exists)
            await verifyReceiptSchema(db);
        const rows = exists ? await db.getAllAsync<{
            attempt_id: string;
            receipt_json: string;
        }>(`SELECT attempt_id,receipt_json FROM main.${receiptTable};`) : [];
        const matching = rows.filter((row) => row.attempt_id === prepared.attemptId);
        if (matching.length > 1)
            return "recovery_required";
        const receipt = matching[0];
        if (receipt) {
            if (receipt.receipt_json !== JSON.stringify(prepared) || version !== prepared.toVersion)
                return "recovery_required";
            await verifyLedger(db, plan, version);
            await verifyForeignKeys(db);
            await context.verifyTargetSchema(db);
            return "committed";
        }
        if (version !== prepared.fromVersion)
            return "recovery_required";
        await verifyLedger(db, plan, version);
        return "not_committed";
    }
    catch {
        return "recovery_required";
    }
}
