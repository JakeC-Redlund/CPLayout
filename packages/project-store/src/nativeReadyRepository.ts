import type { SQLiteDatabase } from "./expoSqliteTypes";
import type { NativeDatabase } from "./expoSqliteTypes";
import { captureNativeReadyContext, type NativeReadyPermit, type LegacyRetirement } from "./nativeWorkspaceHandoff";
import { openNativeSourceLease, type SourceLeaseDependencies, type SourceLeaseNativeHandle } from "./nativeSourceLease";
import { createVerifiedNativeWorkspaceHost } from "./nativeWorkspaceReadiness";
import type { NativeRetainedVerifierOptions } from "./nativeRetainedVerifier";
import { NativeWorkspaceStoreError, NativeWorkspaceCommandRefusal } from "./sqliteWorkspaceStore";
import { createNativeVersionedProjectRepository, type NativeVersionedProjectRepository } from "./nativeProjectRepository";
import type { BoundDatabase } from "./nativeWorkspaceBinding";
import { parseWorkspaceCommand, type WorkspaceCommand } from "./workspaceCommands";
import { WorkspaceDocumentError } from "./workspaceDocument";
import { workspaceProjectCatalog } from "./versionedProjectRepository";
type Native = NativeDatabase & SourceLeaseNativeHandle;
type State = 'unopened' | 'active' | 'available' | 'recovery_required';
interface ReadyOptions extends NativeRetainedVerifierOptions {
    source: SourceLeaseDependencies<Native, SQLiteDatabase>;
    captureLegacyRecovery(db: BoundDatabase): Promise<unknown>;
}
export type NativeReadyRepositoryOptions = ReadyOptions & ({
    legacy: LegacyRetirement & {
        readonly state: string;
    };
    handoffPermit?: never;
} | {
    handoffPermit: NativeReadyPermit;
    legacy?: never;
});
/** App startup receives a repository only after a verified, non-migrating workspace read. */
export async function openNativeReadyRepository(options: NativeReadyRepositoryOptions) {
    const runtime = createNativeReadyRepository(options);
    await runtime.repository.versionedWorkspace.readAsync();
    return runtime;
}
/** One app-lifetime owner for an already admitted workspace. Never creates or migrates SQL. */
export function createNativeReadyRepository(options: NativeReadyRepositoryOptions) {
    const { legacy, handoffPermit, source, captureLegacyRecovery, ...retained } = options;
    const path = retained.expectedSourcePath;
    const dependencies: SourceLeaseDependencies<Native, SQLiteDatabase> = {
        platform: source.platform,
        nativeModule: {
            cplayoutExistingOnlyVersion: source.nativeModule.cplayoutExistingOnlyVersion,
            cplayoutSourceLeaseVersion: source.nativeModule.cplayoutSourceLeaseVersion,
            NativeDatabase: source.nativeModule.NativeDatabase,
        },
        SQLiteDatabase: source.SQLiteDatabase,
    };
    if ((handoffPermit === undefined ? legacy?.state !== 'legacy' : legacy !== undefined) || dependencies.platform !== 'android' ||
        dependencies.nativeModule.cplayoutExistingOnlyVersion !== 1 || dependencies.nativeModule.cplayoutSourceLeaseVersion !== 1 ||
        typeof dependencies.nativeModule.NativeDatabase !== 'function' || typeof dependencies.SQLiteDatabase !== 'function' ||
        typeof captureLegacyRecovery !== 'function' || typeof path !== 'string' || path.length > 4096 || !path.startsWith('/') ||
        path.slice(1).split('/').some(part => !part || part === '.' || part === '..' || /[^A-Za-z0-9_.-]/.test(part)) ||
        retained.sourceIdentity !== path)
        throw new Error('Ready startup requires a fresh legacy owner, Android source lease and canonical path identity');
    const permitContext = { ...retained, source: dependencies };
    const captured = captureNativeReadyContext(permitContext);
    if (handoffPermit !== undefined)
        captured.checkPermit(handoffPermit);
    const quiesce = legacy?.quiesce.bind(legacy), consume = legacy?.consumeQuiescence.bind(legacy);
    const leases = new WeakMap<BoundDatabase, () => Promise<void>>();
    let retired = false, blocked = false, state: State = 'unopened', failure: unknown;
    let tail: Promise<void> = Promise.resolve();
    function poison(error: unknown) {
        if (!blocked)
            failure = error;
        blocked = true;
        state = 'recovery_required';
    }
    async function owned(db: BoundDatabase) {
        const assertOwned = leases.get(db);
        if (!assertOwned)
            throw new Error('Foreign ready connection');
        try {
            await assertOwned();
        }
        catch (error) {
            poison(error);
            throw error;
        }
    }
    const verified = createVerifiedNativeWorkspaceHost({
        async openReadyConnection() {
            if (!retired) {
                if (handoffPermit !== undefined)
                    captured.consumePermit(handoffPermit);
                else {
                    const receipt = await quiesce!();
                    consume!(receipt);
                }
                retired = true;
            }
            const lease = await openNativeSourceLease(path, dependencies);
            const raw = lease.database;
            let closing = false;
            const db: BoundDatabase = {
                async execAsync(sql) {
                    // Rollback must still be attempted after ownership verification fails.
                    if (sql !== 'ROLLBACK;')
                        await owned(db);
                    return raw.execAsync(sql);
                },
                getAllAsync: raw.getAllAsync.bind(raw), getFirstAsync: raw.getFirstAsync.bind(raw),
                runAsync: raw.runAsync.bind(raw), isInTransactionAsync: raw.isInTransactionAsync.bind(raw),
                async closeAsync() {
                    if (closing)
                        throw new Error('Ready source close already attempted');
                    closing = true;
                    const errors: unknown[] = [];
                    try {
                        await owned(db);
                    }
                    catch (error) {
                        errors.push(error);
                    }
                    try {
                        await raw.closeAsync();
                    }
                    catch (error) {
                        errors.push(error);
                    }
                    leases.delete(db);
                    if (errors.length) {
                        const error = new AggregateError(errors, 'Ready source ownership or close failed');
                        poison(error);
                        throw error;
                    }
                },
            };
            leases.set(db, lease.assertOwned);
            try {
                if (await raw.isInTransactionAsync() !== false)
                    throw new Error('Ready source must be idle');
                await db.execAsync('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA read_uncommitted=OFF; PRAGMA ignore_check_constraints=OFF; PRAGMA busy_timeout=5000;');
                return db;
            }
            catch (error) {
                try {
                    await db.closeAsync();
                }
                catch (cleanup) {
                    throw new AggregateError([error, cleanup], 'Ready configuration and cleanup failed');
                }
                throw error;
            }
        },
        async captureLegacyRecovery(db) {
            await owned(db as BoundDatabase);
            const evidence = await captureLegacyRecovery(db as BoundDatabase);
            await owned(db as BoundDatabase);
            return evidence;
        },
        reportCleanupError: poison,
    }, { ...retained, ...captured.adapters });
    const raw = createNativeVersionedProjectRepository({
        ...verified,
        async openReadyConnection() {
            try {
                return await verified.openReadyConnection();
            }
            catch (error) {
                poison(error);
                throw error;
            }
        },
        async verifyAdmission(db, receipt) {
            try {
                await owned(db as BoundDatabase);
                await verified.verifyAdmission(db, receipt);
                await owned(db as BoundDatabase);
            }
            catch (error) {
                poison(error);
                throw error;
            }
        },
    });
    function enqueue<T>(action: () => Promise<T>): Promise<T> {
        const result = tail.then(async () => {
            if (blocked)
                throw new NativeWorkspaceStoreError('recovery_required', 'Native access is blocked until explicit recovery', failure);
            state = 'active';
            try {
                const value = await action();
                if (blocked)
                    throw new NativeWorkspaceStoreError('recovery_required', 'Native cleanup reported failure', failure);
                state = 'available';
                return value;
            }
            catch (error) {
                // Only explicit domain refusals are safe to continue after successful cleanup.
                if (!(error instanceof NativeWorkspaceCommandRefusal) || blocked)
                    poison(error);
                else
                    state = 'available';
                if (blocked)
                    failure = error;
                throw error;
            }
        });
        tail = result.then(() => undefined, () => undefined);
        return result;
    }
    const repository: NativeVersionedProjectRepository = Object.freeze({
        ...raw,
        versionedWorkspace: Object.freeze({
            readAsync: () => enqueue(() => raw.versionedWorkspace.readAsync()),
            readDesignAsync: (id: string) => enqueue(() => raw.versionedWorkspace.readDesignAsync(id)),
            async executeAsync(revision: number, command: WorkspaceCommand) {
                // Snapshot before queueing so a caller cannot change a delayed save's intent.
                const captured = parseWorkspaceCommand(command);
                return enqueue(() => raw.versionedWorkspace.executeAsync(revision, captured));
            },
            exportRecoveryAsync: () => enqueue(() => raw.versionedWorkspace.exportRecoveryAsync()),
        }),
        getBackendInfoAsync: () => enqueue(() => raw.getBackendInfoAsync()),
        listProjectsAsync: () => enqueue(() => raw.listProjectsAsync()),
        async listProjectCatalogAsync() {
            return workspaceProjectCatalog(await enqueue(() => raw.versionedWorkspace.readAsync()));
        },
        loadProjectAsync: (id: string) => enqueue(() => raw.loadProjectAsync(id)),
        async loadDesignProjectAsync(id: string) {
            const read = await enqueue(() => raw.versionedWorkspace.readDesignAsync(id));
            if (read.kind === 'not_found')
                return null;
            if (read.kind !== 'project')
                throw new WorkspaceDocumentError('unsupported_version', 'Open this document with the incomplete-design editor.');
            return read.project;
        },
    });
    return Object.freeze({ repository, get state(): State { return state; } });
}
