import { comparePinnedSqliteDatabases, type ComparisonDatabase } from "./losslessSqliteComparison";
import { parsePreparedUpgrade } from "./preparedUpgrade";
import { serializeMigrationPlan, type BackupArtifact, type Migration, type PreparedUpgrade, type UpgradeDatabase, type UpgradeHost } from "./upgradeCoordinator";
export type BackupDatabase = UpgradeDatabase & ComparisonDatabase;
/** Trusted native handles, not caller-supplied paths. No method may overwrite retained evidence. */
export interface NativeBackupPorts<Attempt, Inspection> {
    allocateAttempt(id: string): Promise<Attempt>;
    openRetainedAttempt(id: string): Promise<Attempt>;
    backupPath(attempt: Attempt): Promise<string>;
    sealBackup(attempt: Attempt): Promise<BackupArtifact>;
    verifyAndCopy(attempt: Attempt, digest: string, id: string): Promise<Inspection>;
    inspectionPath(inspection: Inspection): Promise<string>;
    closeInspection(inspection: Inspection): Promise<void>;
    publishPrepared(attempt: Attempt, canonicalJson: string): Promise<void>;
    readPrepared(attempt: Attempt): Promise<string>;
    openDestination(attempt: Attempt): Promise<BackupDatabase>;
    openInspection(inspection: Inspection): Promise<BackupDatabase>;
    backupDatabase(source: BackupDatabase, destination: BackupDatabase): Promise<void>;
    newInspectionId(): string;
}
export interface NativeBackupOperations extends Pick<UpgradeHost, "backupMain" | "verifyBackup" | "persistPrepared"> {
    verifyRetainedPrepared(receipt: PreparedUpgrade): Promise<void>;
}
export class NativeBackupHostError extends Error {
    readonly failures: unknown[];
    constructor(message: string, failures: unknown[] = []) { super(message); this.name = "NativeBackupHostError"; this.failures = failures; }
}
const fail = (message: string): never => { throw new NativeBackupHostError(message); };
const token = (value: string) => { if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    fail("Invalid artifact token."); };
const digest = (value: string) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    fail("Invalid artifact digest."); };
function throwFailures(errors: unknown[]) {
    if (errors.length === 1)
        throw errors[0];
    if (errors.length > 1)
        throw new NativeBackupHostError("Backup operation and/or cleanup failed.", errors);
}
function capable(db: UpgradeDatabase): BackupDatabase {
    if (typeof (db as Partial<ComparisonDatabase>).getEachAsync !== "function")
        fail("Source does not support lossless streaming comparison.");
    return db as BackupDatabase;
}
async function version(db: UpgradeDatabase) {
    const row = await db.getFirstAsync<{
        user_version: unknown;
    }>("PRAGMA main.user_version;");
    if (!row || typeof row.user_version !== "number" || !Number.isSafeInteger(row.user_version) || row.user_version < 0) {
        fail("Invalid backup database version.");
    }
    return row!.user_version as number;
}
async function mainPath(db: UpgradeDatabase) {
    const rows = await db.getAllAsync<{
        name: string;
        file: string;
    }>("PRAGMA database_list;");
    const main = rows.filter(row => row.name === "main");
    if (main.length !== 1 || typeof main[0].file !== "string" || !main[0].file || rows.some(row => row.name !== "main" && row.name !== "temp")) {
        fail("Expected one file-backed main database without attachments.");
    }
    return main[0].file;
}
async function integrity(db: UpgradeDatabase) {
    const rows = await db.getAllAsync<Record<string, unknown>>("PRAGMA main.integrity_check;");
    if (rows.length !== 1 || Object.keys(rows[0]).length !== 1 || Object.values(rows[0])[0] !== "ok")
        fail("Backup integrity check failed.");
}
/** One factory per upgrade attempt; historical verification remains read-only. */
export async function createNativeBackupOperations<A, I>(options: {
    sourceIdentity: string;
    expectedSourcePath: string;
    plan: readonly Migration[];
    sha256(text: string): Promise<string>;
    ports: NativeBackupPorts<A, I>;
}): Promise<NativeBackupOperations> {
    const { sourceIdentity, expectedSourcePath, ports } = options;
    if (typeof sourceIdentity !== "string" || !sourceIdentity || sourceIdentity.length > 4096)
        fail("Invalid source identity.");
    if (typeof expectedSourcePath !== "string" || !expectedSourcePath.startsWith("/") || expectedSourcePath.includes("\0"))
        fail("A trusted canonical source path is required.");
    const methods: (keyof NativeBackupPorts<A, I>)[] = ["allocateAttempt", "openRetainedAttempt", "backupPath", "sealBackup", "verifyAndCopy",
        "inspectionPath", "closeInspection", "publishPrepared", "readPrepared", "openDestination", "openInspection", "backupDatabase", "newInspectionId"];
    if (!ports || methods.some(method => typeof ports[method] !== "function"))
        fail("Native backup capability is unavailable.");
    const planJson = serializeMigrationPlan(options.plan);
    const toVersion = (JSON.parse(planJson) as Migration[]).length;
    const planSha256 = await options.sha256(planJson);
    digest(planSha256);
    type Entry = {
        attemptId: string;
        attempt: A;
        source: BackupDatabase;
        sourcePath: string;
        fromVersion: number;
        backup: BackupArtifact;
        stage: "sealed" | "verified" | "published" | "failed";
    };
    let entry: Entry | undefined;
    let attempted = false, busy = false;
    async function exclusive<T>(body: () => Promise<T>) {
        if (busy)
            fail("Another backup operation is in progress.");
        busy = true;
        try {
            return await body();
        }
        finally {
            busy = false;
        }
    }
    async function assertSource(current: Entry) {
        if (!await current.source.isInTransactionAsync() || await mainPath(current.source) !== current.sourcePath ||
            await version(current.source) !== current.fromVersion)
            fail("Pinned source identity or version changed.");
    }
    function receiptSnapshot(receipt: PreparedUpgrade) {
        const value = parsePreparedUpgrade(JSON.stringify(receipt));
        if (value.sourceIdentity !== sourceIdentity || value.toVersion !== toVersion || value.planSha256 !== planSha256) {
            fail("Prepared receipt identifies a different source or migration plan.");
        }
        return value;
    }
    async function inspect(attempt: A, backup: BackupArtifact, expectedVersion: number, source?: BackupDatabase) {
        if (await ports.backupPath(attempt) !== backup.identity)
            fail("Retained backup identity differs from its owned attempt.");
        const id = ports.newInspectionId();
        token(id);
        const inspection = await ports.verifyAndCopy(attempt, backup.sha256, id);
        const expectedPath = await ports.inspectionPath(inspection);
        if (!expectedPath || expectedPath === backup.identity || expectedPath === expectedSourcePath || (source && expectedPath === await mainPath(source)))
            fail("Inspection is not a distinct disposable copy.");
        let db: BackupDatabase | undefined;
        let owned = false, transaction = false, closed = false;
        const errors: unknown[] = [];
        try {
            db = await ports.openInspection(inspection);
            if (db === source || db === entry?.source)
                fail("Inspection connection aliases the coordinator source.");
            owned = true;
            if (await mainPath(db) !== expectedPath)
                fail("Inspection connection does not identify its authorized copy.");
            if (await db.isInTransactionAsync())
                fail("Inspection connection is not private and idle.");
            await db.execAsync("PRAGMA query_only=ON; PRAGMA read_uncommitted=OFF;");
            if ((await db.getFirstAsync<{
                query_only: number;
            }>("PRAGMA query_only;"))?.query_only !== 1 ||
                (await db.getFirstAsync<{
                    read_uncommitted: number;
                }>("PRAGMA read_uncommitted;"))?.read_uncommitted !== 0)
                fail("Inspection safety settings were not applied.");
            await db.execAsync("BEGIN DEFERRED;");
            transaction = true;
            if (await version(db) !== expectedVersion)
                fail("Backup version differs from the prepared source.");
            await integrity(db);
            if (source)
                await comparePinnedSqliteDatabases(source, db);
        }
        catch (error) {
            errors.push(error);
        }
        finally {
            if (db && owned) {
                if (transaction) {
                    try {
                        if (await db.isInTransactionAsync())
                            await db.execAsync("ROLLBACK;");
                    }
                    catch (error) {
                        errors.push(error);
                    }
                }
                try {
                    await db.closeAsync();
                    closed = true;
                }
                catch (error) {
                    errors.push(error);
                }
            }
        }
        // Keep failed copies. Never remove a copy while SQL close is uncertain.
        if (!errors.length && closed) {
            try {
                await ports.closeInspection(inspection);
            }
            catch (error) {
                errors.push(error);
            }
        }
        throwFailures(errors);
    }
    async function verifyEntry(current: Entry) {
        await assertSource(current);
        await inspect(current.attempt, current.backup, current.fromVersion, current.source);
        await assertSource(current);
    }
    return {
        async backupMain(source, attemptId) {
            return exclusive(async () => {
                if (attempted)
                    fail("This host already attempted an upgrade; use a fresh host and attempt id.");
                attempted = true;
                token(attemptId);
                const original = capable(source);
                if (!await original.isInTransactionAsync())
                    fail("Source must already hold the coordinator transaction.");
                const sourcePath = await mainPath(original);
                if (sourcePath !== expectedSourcePath)
                    fail("Source connection does not match the configured source identity.");
                const fromVersion = await version(original);
                if (fromVersion >= toVersion)
                    fail("Source does not need the configured migration.");
                const attempt = await ports.allocateAttempt(attemptId), expectedPath = await ports.backupPath(attempt);
                if (!expectedPath || expectedPath === sourcePath || expectedPath === sourceIdentity)
                    fail("Backup destination is not distinct.");
                let destination: BackupDatabase | undefined, owned = false;
                const errors: unknown[] = [];
                try {
                    destination = await ports.openDestination(attempt);
                    if (destination === original)
                        fail("Destination connection aliases the coordinator source.");
                    owned = true;
                    if (await mainPath(destination) !== expectedPath)
                        fail("Destination connection does not identify its allocated artifact.");
                    if (await destination.isInTransactionAsync())
                        fail("Backup destination already has a transaction.");
                    if ((await destination.getAllAsync("SELECT name FROM main.sqlite_schema;")).length)
                        fail("Allocated backup destination is not empty.");
                    await destination.execAsync("PRAGMA main.journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000; PRAGMA read_uncommitted=OFF;");
                    if ((await destination.getFirstAsync<{
                        journal_mode: string;
                    }>("PRAGMA main.journal_mode;"))?.journal_mode !== "delete" ||
                        (await destination.getFirstAsync<{
                            synchronous: number;
                        }>("PRAGMA synchronous;"))?.synchronous !== 2 ||
                        (await destination.getFirstAsync<{
                            read_uncommitted: number;
                        }>("PRAGMA read_uncommitted;"))?.read_uncommitted !== 0)
                        fail("Destination safety settings were not applied.");
                    await ports.backupDatabase(original, destination);
                    // Read the copied database before normalizing its journal format.
                    if (await version(destination) !== fromVersion)
                        fail("Backup version differs.");
                    await destination.execAsync("PRAGMA main.journal_mode=DELETE;");
                    if ((await destination.getFirstAsync<{
                        journal_mode: string;
                    }>("PRAGMA main.journal_mode;"))?.journal_mode !== "delete" ||
                        await version(destination) !== fromVersion)
                        fail("Backup format or version differs.");
                    await integrity(destination);
                }
                catch (error) {
                    errors.push(error);
                }
                finally {
                    if (destination && owned) {
                        try {
                            await destination.closeAsync();
                        }
                        catch (error) {
                            errors.push(error);
                        }
                    }
                }
                throwFailures(errors);
                const sealed = await ports.sealBackup(attempt);
                const backup = Object.freeze({ identity: sealed.identity, sha256: sealed.sha256 });
                digest(backup.sha256);
                if (backup.identity !== expectedPath)
                    fail("Sealed backup identity differs from allocation.");
                entry = { attemptId, attempt, source: original, sourcePath, fromVersion, backup, stage: "sealed" };
                try {
                    await assertSource(entry);
                }
                catch (error) {
                    entry.stage = "failed";
                    throw error;
                }
                return backup;
            });
        },
        async verifyBackup(source, artifact) {
            return exclusive(async () => {
                const current = entry;
                if (!current || current.stage !== "sealed")
                    fail("No sealed backup is awaiting verification.");
                try {
                    if (source !== current!.source || artifact.identity !== current!.backup.identity || artifact.sha256 !== current!.backup.sha256)
                        fail("Backup does not belong to this pinned source.");
                    await verifyEntry(current!);
                    current!.stage = "verified";
                }
                catch (error) {
                    current!.stage = "failed";
                    throw error;
                }
            });
        },
        async persistPrepared(receipt) {
            return exclusive(async () => {
                const current = entry;
                if (!current || current.stage !== "verified")
                    fail("Prepared publication requires successful backup verification.");
                try {
                    const value = receiptSnapshot(receipt), canonical = JSON.stringify(value);
                    if (value.attemptId !== current!.attemptId || value.fromVersion !== current!.fromVersion ||
                        value.backup.identity !== current!.backup.identity || value.backup.sha256 !== current!.backup.sha256)
                        fail("Prepared receipt does not bind this backup attempt.");
                    await verifyEntry(current!);
                    await ports.publishPrepared(current!.attempt, canonical);
                    if (await ports.readPrepared(current!.attempt) !== canonical)
                        fail("Prepared receipt readback differs.");
                    await assertSource(current!);
                    current!.stage = "published";
                }
                catch (error) {
                    current!.stage = "failed";
                    throw error;
                }
            });
        },
        async verifyRetainedPrepared(receipt) {
            return exclusive(async () => {
                const value = receiptSnapshot(receipt), canonical = JSON.stringify(value);
                const attempt = await ports.openRetainedAttempt(value.attemptId);
                const raw = await ports.readPrepared(attempt);
                if (raw !== canonical || JSON.stringify(parsePreparedUpgrade(raw)) !== canonical)
                    fail("Retained prepared receipt binding differs.");
                await inspect(attempt, value.backup, value.fromVersion);
                if (await ports.readPrepared(attempt) !== canonical)
                    fail("Retained receipt changed during verification.");
            });
        },
    };
}
