import type { SQLiteDatabase, SQLiteOpenOptions } from "./expoSqliteTypes";
import type { BackupDatabase, NativeBackupPorts } from "./nativeBackupHost";
/** One native session owns the tokens. Paths must revalidate native allocation identity. */
export interface ArtifactSession {
    readonly protocolVersion: 1;
    readonly artifactRoot: string;
    allocateAttempt(id: string): Promise<string>;
    openRetainedAttempt(id: string): Promise<string>;
    backupPath(token: string): Promise<string>;
    sealBackup(token: string): Promise<{
        path: string;
        sha256: string;
        bytes: number;
    }>;
    verifyAndCopy(token: string, digest: string, id: string): Promise<string>;
    inspectionPath(token: string): Promise<string>;
    closeInspection(token: string): Promise<void>;
    publishPrepared(token: string, text: string): Promise<void>;
    readPrepared(token: string): Promise<string>;
    /** Forget session tokens only. Never delete files or close SQLite handles. */
    release(): Promise<void>;
}
export interface ExpoSqlitePort {
    openDatabaseAsync(name: string, options: SQLiteOpenOptions, directory: string): Promise<SQLiteDatabase>;
    backupDatabaseAsync(options: {
        sourceDatabase: SQLiteDatabase;
        destDatabase: SQLiteDatabase;
        sourceDatabaseName: string;
        destDatabaseName: string;
    }): Promise<void>;
}
export type AttemptHandle = Readonly<{
    kind: "attempt";
}>;
export type InspectionHandle = Readonly<{
    kind: "inspection";
}>;
type SqlHandle = {
    raw: SQLiteDatabase;
    wrapper: BackupDatabase;
    state: "open" | "closing" | "closed" | "failed";
    closeError?: unknown;
};
type Attempt = {
    token: string;
    path: string;
    retained: boolean;
    opened: boolean;
    sql?: SqlHandle;
    backedUp: boolean;
    sealed?: string;
};
type Inspection = {
    token: string;
    path: string;
    opened: boolean;
    sql?: SqlHandle;
    state: "active" | "closed" | "failed";
};
function fail(message: string): never { throw new Error(message); }
function token(value: string) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
        fail("Invalid artifact token.");
}
function digest(value: string) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
        fail("Invalid backup digest.");
}
function absolute(value: string) {
    if (typeof value !== "string" || !value.startsWith("/") || /[\s\x00-\x1f\\%?#]/.test(value) ||
        value.slice(1).split("/").some(part => !part || part === "." || part === ".."))
        fail("Expected a canonical absolute filesystem path.");
}
/** Does not open or migrate the source. The bootstrap/coordinator owns that handle. */
export function createExpoBackupPorts(options: {
    native: ArtifactSession;
    sqlite: ExpoSqlitePort;
    source?: SQLiteDatabase;
    newInspectionId(): string;
}): {
    ports: NativeBackupPorts<AttemptHandle, InspectionHandle>;
    release(): Promise<void>;
} {
    const { native, sqlite, source, newInspectionId } = options;
    const methods = ["allocateAttempt", "openRetainedAttempt", "backupPath", "sealBackup", "verifyAndCopy", "inspectionPath", "closeInspection", "publishPrepared", "readPrepared", "release"] as const;
    if (!native || native.protocolVersion !== 1 || methods.some(key => typeof native[key] !== "function") ||
        typeof sqlite?.openDatabaseAsync !== "function" || typeof sqlite.backupDatabaseAsync !== "function" || typeof newInspectionId !== "function")
        fail("Native backup bridge is unavailable or incompatible.");
    const root = native.artifactRoot;
    absolute(root);
    if (source && (!source.nativeDatabase || source.options.useNewConnection !== true))
        fail("Source must be an original private Expo connection.");
    const attempts = new WeakMap<AttemptHandle, Attempt>(), inspections = new WeakMap<InspectionHandle, Inspection>();
    const sqlHandles = new Set<SqlHandle>(), nativeTokens = new Set<string>();
    const destinationOwners = new WeakMap<BackupDatabase, Attempt>(), completedBackups = new WeakSet<Attempt>();
    let busy = false, released = false, activeQueries = 0;
    const alive = () => { if (released)
        fail("Native backup session has been released."); };
    async function exclusive<T>(body: () => Promise<T>) {
        alive();
        if (busy || activeQueries)
            fail("Another adapter operation is in progress.");
        busy = true;
        try {
            return await body();
        }
        finally {
            busy = false;
        }
    }
    function attempt(handle: AttemptHandle) { return attempts.get(handle) ?? fail("Foreign attempt handle."); }
    function inspection(handle: InspectionHandle) { return inspections.get(handle) ?? fail("Foreign inspection handle."); }
    function captureToken(value: string) { token(value); if (nativeTokens.has(value))
        fail("Native bridge reused an artifact token."); nativeTokens.add(value); return value; }
    async function checkPath(expected: string, read: () => Promise<string>) {
        const actual = await read();
        absolute(actual);
        if (actual !== expected)
            fail("Native artifact path differs from its allocation.");
        return actual;
    }
    function ownSql(raw: SQLiteDatabase): SqlHandle {
        if (!raw?.nativeDatabase || raw === source || (source && raw.nativeDatabase === source.nativeDatabase) ||
            [...sqlHandles].some(handle => handle.raw === raw || handle.raw.nativeDatabase === raw.nativeDatabase))
            fail("Native SQL handle aliases an existing connection.");
        const handle: SqlHandle = { raw, wrapper: undefined as unknown as BackupDatabase, state: "open" };
        const open = () => { alive(); if (busy || handle.state !== "open")
            fail("Owned SQL handle is unavailable."); };
        async function query<T>(body: () => Promise<T>) {
            open();
            activeQueries++;
            try {
                return await body();
            }
            finally {
                activeQueries--;
            }
        }
        handle.wrapper = {
            execAsync: sql => query(() => raw.execAsync(sql)),
            getFirstAsync: <T>(sql: string) => query(() => raw.getFirstAsync<T>(sql)),
            getAllAsync: <T>(sql: string, ...params: string[]) => query(() => raw.getAllAsync<T>(sql, ...params)),
            runAsync: (sql, ...params) => query(() => raw.runAsync(sql, ...params)),
            isInTransactionAsync: () => query(() => raw.isInTransactionAsync()),
            async *getEachAsync<T>(sql: string, ...params: string[]) {
                open();
                activeQueries++;
                try {
                    yield* raw.getEachAsync<T>(sql, ...params);
                }
                finally {
                    activeQueries--;
                }
            },
            async closeAsync() {
                if (busy)
                    fail("Cannot close SQL while an adapter operation is in progress.");
                await closeOwned(handle);
            },
        };
        sqlHandles.add(handle);
        return handle;
    }
    async function closeOwned(handle: SqlHandle) {
        if (handle.state === "closed")
            return;
        if (handle.state === "failed")
            throw handle.closeError;
        if (handle.state === "closing" || activeQueries)
            fail("Cannot close SQL while an operation is in progress.");
        handle.state = "closing";
        try {
            await handle.raw.closeAsync();
            handle.state = "closed";
        }
        catch (error) {
            handle.state = "failed";
            handle.closeError = error;
            throw error;
        }
    }
    async function openSql(expected: string, pathReader: () => Promise<string>): Promise<SqlHandle> {
        await checkPath(expected, pathReader);
        const split = expected.lastIndexOf("/");
        const raw = await sqlite.openDatabaseAsync(expected.slice(split + 1), {
            useNewConnection: true, finalizeUnusedStatementsBeforeClosing: true,
        }, expected.slice(0, split));
        const handle = ownSql(raw);
        try {
            if (raw.databasePath !== expected || raw.options.useNewConnection !== true)
                fail("Expo opened an unexpected or shared database.");
            await checkPath(expected, pathReader);
            return handle;
        }
        catch (error) {
            try {
                await closeOwned(handle);
            }
            catch (closeError) {
                throw new AggregateError([error, closeError], "SQL open validation and close failed.");
            }
            throw error;
        }
    }
    async function allocate(id: string, retained: boolean): Promise<AttemptHandle> {
        token(id);
        const nativeToken = captureToken(await (retained ? native.openRetainedAttempt(id) : native.allocateAttempt(id)));
        const path = root + "/" + id + "/backup.db";
        await checkPath(path, () => native.backupPath(nativeToken));
        const handle: AttemptHandle = Object.freeze({ kind: "attempt" });
        attempts.set(handle, { token: nativeToken, path, retained, opened: false, backedUp: false });
        return handle;
    }
    const ports: NativeBackupPorts<AttemptHandle, InspectionHandle> = {
        allocateAttempt: id => exclusive(() => allocate(id, false)),
        openRetainedAttempt: id => exclusive(() => allocate(id, true)),
        backupPath: handle => exclusive(async () => { const a = attempt(handle); return checkPath(a.path, () => native.backupPath(a.token)); }),
        openDestination: handle => exclusive(async () => {
            const a = attempt(handle);
            if (a.retained || a.opened)
                fail("Destination is retained or was already opened.");
            a.opened = true;
            a.sql = await openSql(a.path, () => native.backupPath(a.token));
            destinationOwners.set(a.sql.wrapper, a);
            return a.sql.wrapper;
        }),
        backupDatabase: (original, destination) => exclusive(async () => {
            if (!source || original !== source)
                fail("Backup source is not the configured private connection.");
            const sql = [...sqlHandles].find(handle => handle.wrapper === destination);
            if (!sql || sql.state !== "open")
                fail("Backup destination is not an open owned connection.");
            // Find the destination owner without exposing native tokens to callers.
            const a = destinationOwners.get(destination);
            if (!a || a.backedUp)
                fail("Backup destination is unallocated or has already been used.");
            a.backedUp = true;
            await checkPath(a.path, () => native.backupPath(a.token));
            await sqlite.backupDatabaseAsync({ sourceDatabase: source, destDatabase: sql.raw, sourceDatabaseName: "main", destDatabaseName: "main" });
            completedBackups.add(a);
        }),
        sealBackup: handle => exclusive(async () => {
            const a = attempt(handle);
            if (a.retained || a.sealed || a.sql?.state !== "closed" || !completedBackups.has(a))
                fail("Sealing requires a completed backup and confirmed SQL close.");
            const sealed = await native.sealBackup(a.token);
            digest(sealed.sha256);
            if (sealed.path !== a.path || !Number.isSafeInteger(sealed.bytes) || sealed.bytes < 100)
                fail("Native sealed artifact differs from allocation.");
            a.sealed = sealed.sha256;
            return Object.freeze({ identity: a.path, sha256: sealed.sha256 });
        }),
        verifyAndCopy: (handle, sha, id) => exclusive(async () => {
            const a = attempt(handle);
            token(id);
            digest(sha);
            if (!a.retained && a.sealed !== sha)
                fail("Inspection requires the sealed backup digest.");
            const nativeToken = captureToken(await native.verifyAndCopy(a.token, sha, id));
            const path = a.path.slice(0, a.path.lastIndexOf("/")) + "/inspect-" + id + "/copy.db";
            await checkPath(path, () => native.inspectionPath(nativeToken));
            const result: InspectionHandle = Object.freeze({ kind: "inspection" });
            inspections.set(result, { token: nativeToken, path, opened: false, state: "active" });
            return result;
        }),
        inspectionPath: handle => exclusive(async () => { const i = inspection(handle); return checkPath(i.path, () => native.inspectionPath(i.token)); }),
        openInspection: handle => exclusive(async () => {
            const i = inspection(handle);
            if (i.opened || i.state !== "active")
                fail("Inspection was already opened or closed.");
            i.opened = true;
            i.sql = await openSql(i.path, () => native.inspectionPath(i.token));
            return i.sql.wrapper;
        }),
        closeInspection: handle => exclusive(async () => {
            const i = inspection(handle);
            if (i.state !== "active" || i.sql?.state !== "closed")
                fail("Native inspection close requires confirmed SQL close.");
            i.state = "failed";
            await native.closeInspection(i.token);
            i.state = "closed";
        }),
        publishPrepared: (handle, text) => exclusive(async () => {
            const a = attempt(handle);
            if (a.retained || !a.sealed)
                fail("Prepared publication requires a newly sealed attempt.");
            await native.publishPrepared(a.token, text);
        }),
        readPrepared: handle => exclusive(() => native.readPrepared(attempt(handle).token)),
        newInspectionId: () => { alive(); const value = newInspectionId(); token(value); return value; },
    };
    return {
        ports,
        release: () => exclusive(async () => {
            if ([...sqlHandles].some(handle => handle.state !== "closed"))
                fail("Cannot release while SQL close is incomplete.");
            released = true;
            await native.release();
        }),
    };
}
