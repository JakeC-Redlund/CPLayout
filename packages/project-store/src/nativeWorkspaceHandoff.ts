import type { SQLiteDatabase } from "./expoSqliteTypes";
import type { NativeDatabase } from "./expoSqliteTypes";
import type { LegacyQuiescence } from "./legacyDatabaseOwner";
import { openNativeSourceLease, type SourceLeaseDependencies, type SourceLeaseNativeHandle } from "./nativeSourceLease";
import { createNativeWorkspaceUpgradeRunner, type NativeWorkspaceUpgradeOptions } from "./nativeWorkspaceUpgrade";
import { verifyNativeWorkspaceSchema } from "./nativeWorkspaceSchema";
import type { UpgradeOutcome } from "./upgradeCoordinator";
type Native = NativeDatabase & SourceLeaseNativeHandle;
export interface LegacyRetirement {
    quiesce(): Promise<LegacyQuiescence>;
    consumeQuiescence(receipt: LegacyQuiescence): void;
}
export type NativeWorkspaceHandoffOptions = Omit<NativeWorkspaceUpgradeOptions, 'openSource' | 'verifyTargetSchema'> & {
    legacy: LegacyRetirement;
    source: SourceLeaseDependencies<Native, SQLiteDatabase>;
};
export type HandoffState = 'idle' | 'running' | 'committed' | 'unchanged' | 'not_committed' | 'recovery_required';
const readyBrand: unique symbol = Symbol('native-ready-permit');
export interface NativeReadyPermit {
    readonly [readyBrand]: true;
}
export type ReadyPermitContext = Pick<NativeWorkspaceHandoffOptions, 'sourceIdentity' | 'expectedSourcePath' | 'source' | 'module' | 'sqlite' | 'sha256' | 'newInspectionId'>;
const permits = new WeakMap<NativeReadyPermit, {
    binding: readonly unknown[];
    consumed: boolean;
}>();
const artifactMethods = ['createSession', 'allocateAttempt', 'openRetainedAttempt', 'backupPath', 'sealBackup',
    'verifyAndCopy', 'inspectionPath', 'closeInspection', 'publishPreparedHex', 'readPreparedHex', 'releaseSession'] as const;
/** Binding and adapter capabilities must come from the same property reads. */
function snapshotReadyContext(context: ReadyPermitContext) {
    const bind = <T>(owner: unknown, value: T): T => typeof value === 'function' ? value.bind(owner) as T : value;
    const module = context.module;
    const sqlite = context.sqlite;
    const methods = module == null ? undefined : {
        protocolVersion: module.protocolVersion,
        createSession: module.createSession, allocateAttempt: module.allocateAttempt,
        openRetainedAttempt: module.openRetainedAttempt, backupPath: module.backupPath,
        sealBackup: module.sealBackup, verifyAndCopy: module.verifyAndCopy,
        inspectionPath: module.inspectionPath, closeInspection: module.closeInspection,
        publishPreparedHex: module.publishPreparedHex, readPreparedHex: module.readPreparedHex,
        releaseSession: module.releaseSession,
    };
    const openDatabaseAsync = sqlite?.openDatabaseAsync, backupDatabaseAsync = sqlite?.backupDatabaseAsync;
    const binding = Object.freeze([context.sourceIdentity, context.expectedSourcePath, module, sqlite,
        context.sha256, context.newInspectionId, context.source.platform,
        context.source.nativeModule.cplayoutExistingOnlyVersion, context.source.nativeModule.cplayoutSourceLeaseVersion,
        context.source.nativeModule.NativeDatabase, context.source.SQLiteDatabase, methods?.protocolVersion,
        ...artifactMethods.map(name => methods?.[name]), openDatabaseAsync, backupDatabaseAsync]);
    const adapters = Object.freeze({
        module: module == null ? module : Object.freeze({
            protocolVersion: methods!.protocolVersion,
            createSession: bind(module, methods!.createSession), allocateAttempt: bind(module, methods!.allocateAttempt),
            openRetainedAttempt: bind(module, methods!.openRetainedAttempt), backupPath: bind(module, methods!.backupPath),
            sealBackup: bind(module, methods!.sealBackup), verifyAndCopy: bind(module, methods!.verifyAndCopy),
            inspectionPath: bind(module, methods!.inspectionPath), closeInspection: bind(module, methods!.closeInspection),
            publishPreparedHex: bind(module, methods!.publishPreparedHex), readPreparedHex: bind(module, methods!.readPreparedHex),
            releaseSession: bind(module, methods!.releaseSession),
        }),
        sqlite: Object.freeze({ openDatabaseAsync: bind(sqlite, openDatabaseAsync),
            backupDatabaseAsync: bind(sqlite, backupDatabaseAsync) }),
    });
    return { binding, adapters };
}
function checkNativeReadyPermit(permit: NativeReadyPermit, binding: readonly unknown[]): void {
    const record = permits.get(permit);
    if (!record || record.consumed || binding.some((value, index) => value !== record.binding[index])) {
        throw new Error('Fresh successful handoff authorization for this exact source configuration is required');
    }
}
export function captureNativeReadyContext(context: ReadyPermitContext) {
    const snapshot = snapshotReadyContext(context);
    return Object.freeze({
        adapters: snapshot.adapters,
        checkPermit(permit: NativeReadyPermit) { checkNativeReadyPermit(permit, snapshot.binding); },
        consumePermit(permit: NativeReadyPermit) {
            checkNativeReadyPermit(permit, snapshot.binding);
            checkNativeReadyPermit(permit, snapshotReadyContext(context).binding);
            permits.get(permit)!.consumed = true;
        },
    });
}
/** One explicit upgrade attempt. Construction never retires legacy access or opens SQL. */
export function createNativeWorkspaceHandoff(options: NativeWorkspaceHandoffOptions) {
    const { legacy, source, ...upgrade } = options;
    const quiesce = legacy.quiesce.bind(legacy);
    const consume = legacy.consumeQuiescence.bind(legacy);
    // Capture constructors/capabilities so a caller cannot swap the bridge while legacy drains.
    const dependencies: SourceLeaseDependencies<Native, SQLiteDatabase> = {
        platform: source.platform,
        nativeModule: {
            cplayoutExistingOnlyVersion: source.nativeModule.cplayoutExistingOnlyVersion,
            cplayoutSourceLeaseVersion: source.nativeModule.cplayoutSourceLeaseVersion,
            NativeDatabase: source.nativeModule.NativeDatabase,
        },
        SQLiteDatabase: source.SQLiteDatabase,
    };
    let state: HandoffState = 'idle';
    let used = false;
    let readyAllowed = false, permitIssued = false;
    const captured = snapshotReadyContext({ ...upgrade, source: dependencies });
    const binding = captured.binding;
    let ownershipFailed = false;
    let lease: Awaited<ReturnType<typeof openNativeSourceLease<Native, SQLiteDatabase>>> | undefined;
    async function assertOwned() {
        try {
            await lease!.assertOwned();
        }
        catch (error) {
            ownershipFailed = true;
            throw error;
        }
    }
    const runner = createNativeWorkspaceUpgradeRunner({
        ...upgrade,
        ...captured.adapters,
        async openSource() {
            try {
                const receipt = await quiesce();
                consume(receipt);
                lease = await openNativeSourceLease(upgrade.expectedSourcePath, dependencies);
                return lease.database;
            }
            catch (error) {
                // A constructor can throw without transferring a handle, and native suppressed
                // cleanup errors need not survive the bridge. Never imply retry is safe here.
                throw error instanceof AggregateError ? error : new AggregateError([error], 'Legacy retirement or native source allocation requires recovery');
            }
        },
        async verifyTargetSchema(database) {
            if (!lease || database !== lease.database)
                throw new Error('Upgrade verification received a foreign source');
            await assertOwned();
            await verifyNativeWorkspaceSchema(database);
            await assertOwned();
        },
    });
    return Object.freeze({
        get state(): HandoffState { return state; },
        takeReadyPermit(): NativeReadyPermit {
            if (!readyAllowed || permitIssued)
                throw new Error('Successful closed handoff is required before issuing one ready permit');
            permitIssued = true;
            const permit = Object.freeze({ [readyBrand]: true as const });
            permits.set(permit, { binding, consumed: false });
            return permit;
        },
        async run(attemptId: string): Promise<UpgradeOutcome> {
            if (used)
                throw new Error('Native handoff has already been used; reconcile before retrying');
            used = true;
            state = 'running';
            try {
                if (dependencies.platform !== 'android' || dependencies.nativeModule.cplayoutExistingOnlyVersion !== 1 ||
                    dependencies.nativeModule.cplayoutSourceLeaseVersion !== 1 ||
                    typeof dependencies.nativeModule.NativeDatabase !== 'function' || typeof dependencies.SQLiteDatabase !== 'function') {
                    state = 'not_committed';
                    return { state, error: new Error('Required Android source-lease capability is unavailable'), cleanupErrors: [] };
                }
                const path = upgrade.expectedSourcePath;
                if (typeof path !== 'string' || path.length > 4096 || !path.startsWith('/') ||
                    path.slice(1).split('/').some(part => !part || part === '.' || part === '..' || /[^A-Za-z0-9_.-]/.test(part)) ||
                    upgrade.sourceIdentity !== path) {
                    state = 'not_committed';
                    return { state, error: new Error('Android receipt identity must equal the canonical source path'), cleanupErrors: [] };
                }
                const outcome = await runner.run(attemptId);
                const result: UpgradeOutcome = ownershipFailed ? { ...outcome, state: 'recovery_required' } : outcome;
                state = result.state;
                readyAllowed = (state === 'committed' || state === 'unchanged') &&
                    result.error === undefined && result.cleanupErrors.length === 0;
                return result;
            }
            catch (error) {
                state = 'recovery_required';
                return { state, error, cleanupErrors: [] };
            }
        },
    });
}
