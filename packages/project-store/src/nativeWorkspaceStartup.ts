import { captureNativeReadyContext, createNativeWorkspaceHandoff } from "./nativeWorkspaceHandoff";
import { openNativeReadyRepository, type NativeReadyRepositoryOptions } from "./nativeReadyRepository";
import { NativeWorkspaceStoreError } from "./sqliteWorkspaceStore";
import type { NativeVersionedProjectRepository } from "./nativeProjectRepository";
type ColdOptions = Extract<NativeReadyRepositoryOptions, {
    legacy: object;
}>;
export type NativeWorkspaceStartupOptions = ColdOptions & {
    intent: {
        kind: 'open';
    } | {
        kind: 'upgrade';
        attemptId: string;
    };
};
export type NativeWorkspaceStartupState = 'idle' | 'starting' | 'ready' | 'recovery_required';
/** Explicit existing-file startup. No creation, legacy migration, retry or fallback. */
export function createNativeWorkspaceStartup(input: NativeWorkspaceStartupOptions) {
    const { intent, legacy: owner, source: sourceInput, ...settings } = input;
    const kind = intent?.kind;
    const attemptId = intent && 'attemptId' in intent ? intent.attemptId : undefined;
    const quiesce = owner?.quiesce, consume = owner?.consumeQuiescence;
    if ((kind !== 'open' && kind !== 'upgrade') ||
        (kind === 'upgrade' && (typeof attemptId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(attemptId))) ||
        typeof settings.captureLegacyRecovery !== 'function' || owner?.state !== 'legacy' ||
        typeof quiesce !== 'function' || typeof consume !== 'function') {
        throw new Error('Startup requires an explicit open/upgrade intent and a fresh legacy owner');
    }
    const legacy = Object.freeze({
        quiesce: quiesce.bind(owner), consumeQuiescence: consume.bind(owner),
        get state() { return owner.state; },
    });
    const source = Object.freeze({
        platform: sourceInput.platform,
        nativeModule: Object.freeze({
            cplayoutExistingOnlyVersion: sourceInput.nativeModule.cplayoutExistingOnlyVersion,
            cplayoutSourceLeaseVersion: sourceInput.nativeModule.cplayoutSourceLeaseVersion,
            NativeDatabase: sourceInput.nativeModule.NativeDatabase,
        }),
        SQLiteDatabase: sourceInput.SQLiteDatabase,
    });
    const captured = { ...settings, source, legacy };
    const adapters = captureNativeReadyContext(captured).adapters;
    const options = Object.freeze({ ...captured, ...adapters });
    // Construct the one-shot owner before yielding; startup never recreates it after failure.
    const handoff = kind === 'upgrade' ? createNativeWorkspaceHandoff(options) : undefined;
    let runtime: Awaited<ReturnType<typeof openNativeReadyRepository>> | undefined;
    let state: NativeWorkspaceStartupState = 'idle';
    let start: Promise<NativeVersionedProjectRepository> | undefined;
    return Object.freeze({
        get state(): NativeWorkspaceStartupState {
            return runtime?.state === 'recovery_required' ? 'recovery_required' : state;
        },
        start(): Promise<NativeVersionedProjectRepository> {
            if (runtime?.state === 'recovery_required') {
                return Promise.reject(new NativeWorkspaceStoreError('recovery_required', 'Native startup cannot reopen an access owner that requires recovery'));
            }
            if (start)
                return start;
            state = 'starting';
            start = Promise.resolve().then(async () => {
                try {
                    if (handoff) {
                        const outcome = await handoff.run(attemptId!);
                        if ((outcome.state !== 'committed' && outcome.state !== 'unchanged') ||
                            outcome.error !== undefined || outcome.cleanupErrors.length !== 0) {
                            throw new NativeWorkspaceStoreError('recovery_required', 'Native upgrade did not complete cleanly', new AggregateError([outcome.error, ...outcome.cleanupErrors], 'Upgrade and cleanup evidence'));
                        }
                        const { legacy: _legacy, ...ready } = options;
                        runtime = await openNativeReadyRepository({ ...ready, handoffPermit: handoff.takeReadyPermit() });
                    }
                    else {
                        runtime = await openNativeReadyRepository(options);
                    }
                    state = 'ready';
                    return runtime.repository;
                }
                catch (error) {
                    state = 'recovery_required';
                    throw error;
                }
            });
            return start;
        },
    });
}
