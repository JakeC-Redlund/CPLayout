import { LegacyBusinessRefusal } from "./legacyBusinessRefusal";
export interface OwnedLegacyDatabase {
    isInTransactionAsync(): Promise<boolean>;
    closeAsync(): Promise<void>;
}
export type LegacyOwnerState = 'legacy' | 'draining' | 'quiescent' | 'handed_off' | 'recovery_required';
const quiescenceBrand: unique symbol = Symbol('legacy-quiescence');
export interface LegacyQuiescence {
    readonly [quiescenceBrand]: true;
}
/** Owns audited repository operations in one JS lifetime, not arbitrary raw SQL users. */
export function createLegacyDatabaseOwner<Database extends OwnedLegacyDatabase>(openOwnedDatabase: () => Promise<Database>) {
    let state: LegacyOwnerState = 'legacy';
    let active = 0;
    let ready: Promise<Database> | undefined;
    let drainComplete: (() => void) | undefined;
    let retirement: Promise<LegacyQuiescence> | undefined;
    let receipt: LegacyQuiescence | undefined;
    const failures: unknown[] = [];
    function recordFailure(error: unknown) {
        if (!failures.includes(error))
            failures.push(error);
        state = 'recovery_required';
    }
    function quiesce(): Promise<LegacyQuiescence> {
        if (retirement)
            return retirement;
        if (state === 'legacy')
            state = 'draining';
        retirement = (async () => {
            if (active !== 0)
                await new Promise<void>(resolve => { drainComplete = resolve; });
            if (ready) {
                try {
                    const database = await ready;
                    if (await database.isInTransactionAsync() !== false) {
                        throw new Error('Legacy connection is not idle; ownership cannot transfer');
                    }
                    // Never retry close: rejection may follow an already-completed native close.
                    await database.closeAsync();
                }
                catch (error) {
                    recordFailure(error);
                }
            }
            if (failures.length)
                throw new AggregateError([...failures], 'Legacy retirement requires recovery');
            state = 'quiescent';
            receipt = Object.freeze({ [quiescenceBrand]: true as const });
            return receipt;
        })();
        return retirement;
    }
    return Object.freeze({
        get state(): LegacyOwnerState { return state; },
        get activeOperations(): number { return active; },
        async run<Value>(operation: (open: () => Promise<Database>) => Promise<Value>): Promise<Value> {
            if (state !== 'legacy')
                throw new Error('Legacy database access is closed: ' + state);
            active++;
            let scopeActive = true;
            const open = async () => {
                if (!scopeActive)
                    throw new Error('Legacy operation scope has ended');
                if (!ready) {
                    ready = Promise.resolve().then(openOwnedDatabase);
                    ready.catch(recordFailure);
                }
                return ready;
            };
            try {
                return await operation(open);
            }
            catch (error) {
                // An arbitrary native rejection cannot prove that child transaction handles closed.
                if (!(error instanceof LegacyBusinessRefusal))
                    recordFailure(error);
                throw error;
            }
            finally {
                scopeActive = false;
                active--;
                if (active === 0) {
                    drainComplete?.();
                    drainComplete = undefined;
                }
            }
        },
        quiesce,
        consumeQuiescence(value: LegacyQuiescence): void {
            if (!receipt || value !== receipt || state !== 'quiescent') {
                throw new Error('A fresh quiescence receipt from this owner is required');
            }
            state = 'handed_off';
        },
    });
}
export type LegacyDatabaseOwner<Database extends OwnedLegacyDatabase> = ReturnType<typeof createLegacyDatabaseOwner<Database>>;
