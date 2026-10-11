import { openNativeSourceLease, type SourceFileIdentity, type SourceLeaseDependencies, type SourceLeaseNativeHandle } from "./nativeSourceLease";

export interface NativeInspectionDatabase {
    execAsync(sql: string): Promise<void>;
    getAllAsync<T>(sql: string): Promise<T[]>;
    isInTransactionAsync(): Promise<boolean>;
    closeAsync(): Promise<void>;
}
export type NativeWorkspaceInspection = Readonly<{
    kind: 'legacy_candidate' | 'workspace_candidate' | 'unsupported';
    schemaVersion: number;
    identity: SourceFileIdentity;
}>;

/** Routing evidence only, never admission. Open errors are not evidence of absence. */
export async function inspectNativeWorkspaceSource<Native extends SourceLeaseNativeHandle>(
    path: string,
    dependencies: SourceLeaseDependencies<Native, NativeInspectionDatabase>,
): Promise<NativeWorkspaceInspection> {
    // Capture constructors before the first await; callers cannot redirect the wrapper mid-open.
    const source: SourceLeaseDependencies<Native, NativeInspectionDatabase> = {
        platform: dependencies.platform,
        nativeModule: {
            cplayoutExistingOnlyVersion: dependencies.nativeModule.cplayoutExistingOnlyVersion,
            cplayoutSourceLeaseVersion: dependencies.nativeModule.cplayoutSourceLeaseVersion,
            NativeDatabase: dependencies.nativeModule.NativeDatabase,
        },
        SQLiteDatabase: dependencies.SQLiteDatabase,
    };
    const lease = await openNativeSourceLease(path, source);
    const db = lease.database;
    const errors: unknown[] = [];
    let beginAttempted = false;
    let result: NativeWorkspaceInspection | undefined;
    async function pinned() {
        await lease.assertOwned();
        if (await db.isInTransactionAsync() !== true)
            throw new Error('Native inspection lost its pinned transaction');
    }
    async function read<T>(sql: string): Promise<T[]> {
        await pinned();
        const rows = await db.getAllAsync<T>(sql);
        await pinned();
        return rows;
    }
    try {
        if (await db.isInTransactionAsync() !== false)
            throw new Error('Native inspection requires an idle private connection');
        await lease.assertOwned();
        await db.execAsync('PRAGMA query_only=ON; PRAGMA read_uncommitted=OFF;');
        beginAttempted = true;
        await db.execAsync('BEGIN DEFERRED;');
        // BEGIN alone does not pin a snapshot. Read main before inspecting its version.
        await read('SELECT name FROM main.sqlite_schema LIMIT 1;');
        const queryOnly = await read<{ query_only: unknown }>('PRAGMA query_only;');
        const isolation = await read<{ read_uncommitted: unknown }>('PRAGMA read_uncommitted;');
        if (queryOnly.length !== 1 || queryOnly[0].query_only !== 1 ||
            isolation.length !== 1 || isolation[0].read_uncommitted !== 0)
            throw new Error('Native inspection requires query-only isolated reads');
        const rows = await read<{ user_version: unknown }>('PRAGMA main.user_version;');
        const version = rows[0]?.user_version;
        if (rows.length !== 1 || typeof version !== 'number' || !Number.isInteger(version) ||
            version < -2147483648 || version > 2147483647)
            throw new Error('Native inspection returned an invalid schema version');
        result = Object.freeze({
            kind: version === 11 ? 'legacy_candidate' : version === 12 ? 'workspace_candidate' : 'unsupported',
            schemaVersion: version,
            identity: lease.identity,
        });
    }
    catch (error) {
        errors.push(error);
    }
    // Even an uncertain BEGIN acknowledgement must be followed by a rollback attempt.
    if (beginAttempted) {
        try {
            await db.execAsync('ROLLBACK;');
            if (await db.isInTransactionAsync() !== false)
                throw new Error('Native inspection rollback left a transaction active');
        }
        catch (error) {
            errors.push(error);
        }
    }
    try {
        await lease.assertOwned();
    }
    catch (error) {
        errors.push(error);
    }
    try {
        await db.closeAsync();
    }
    catch (error) {
        errors.push(error);
    }
    if (errors.length)
        throw new AggregateError(errors, 'Native source inspection or cleanup failed; preserve the source for recovery');
    return result!;
}
