import assert from "node:assert/strict";
import { test } from "node:test";
import { createLegacyDatabaseOwner, type LegacyQuiescence } from "../../../src/legacyDatabaseOwner";
import { assertPending, deferred, observe } from "./testFixture";
function fixture(options: {
    status?: () => Promise<boolean>;
    close?: () => Promise<void>;
} = {}) {
    const calls: string[] = [];
    const database = {
        async isInTransactionAsync() {
            calls.push('status');
            return options.status ? options.status() : false;
        },
        async closeAsync() {
            calls.push('close');
            await options.close?.();
        },
    };
    const owner = createLegacyDatabaseOwner(async () => {
        calls.push('open');
        return database;
    });
    return { owner, database, calls };
}
function hasFailure(expected: unknown) {
    return (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.ok(error.errors.includes(expected));
        return true;
    };
}
test('quiesce synchronously stops admission and drains operations admitted before it', async () => {
    const { owner, calls } = fixture();
    const gate = deferred<void>();
    const operation = owner.run(async (open) => {
        await gate.promise;
        await open();
        return 42;
    });
    assert.equal(owner.activeOperations, 1);
    const retirement = owner.quiesce();
    const retired = observe(retirement);
    assert.equal(owner.state, 'draining');
    let entered = false;
    await assert.rejects(owner.run(async () => { entered = true; }), /access is closed/);
    assert.equal(entered, false);
    await assertPending(retired);
    assert.deepEqual(calls, []);
    gate.resolve();
    assert.equal(await operation, 42);
    await retirement;
    assert.equal(owner.activeOperations, 0);
    assert.equal(owner.state, 'quiescent');
    assert.deepEqual(calls, ['open', 'status', 'close']);
});
test('concurrent operations share a single deferred lazy open and retirement waits for all', async () => {
    const opened = deferred<ReturnType<typeof fixture>['database']>();
    const siblingGate = deferred<void>();
    const { database, calls } = fixture();
    let opens = 0;
    const owner = createLegacyDatabaseOwner(() => { opens++; return opened.promise; });
    assert.equal(opens, 0);
    const first = owner.run(open => open());
    const sibling = owner.run(async (open) => {
        const value = await open();
        await siblingGate.promise;
        return value;
    });
    const retirement = owner.quiesce();
    const retired = observe(retirement);
    await assertPending(retired);
    assert.equal(opens, 1);
    assert.equal(owner.activeOperations, 2);
    opened.resolve(database);
    assert.equal(await first, database);
    await assertPending(retired);
    assert.equal(owner.activeOperations, 1);
    assert.deepEqual(calls, []);
    siblingGate.resolve();
    assert.equal(await sibling, database);
    await retirement;
    assert.equal(opens, 1);
    assert.deepEqual(calls, ['status', 'close']);
});
test('a rejected operation does not let retirement overtake either admitted sibling', async () => {
    const { owner, calls } = fixture();
    const rejectGate = deferred<void>();
    const secondGate = deferred<void>();
    const thirdGate = deferred<void>();
    const failure = new Error('operation failed');
    const first = owner.run(async (open) => { await open(); await rejectGate.promise; });
    const rejected = assert.rejects(first, error => error === failure);
    const second = owner.run(async (open) => { await secondGate.promise; await open(); });
    const third = owner.run(async () => { await thirdGate.promise; });
    const retirement = owner.quiesce();
    const retirementRejected = assert.rejects(retirement, hasFailure(failure));
    const retired = observe(retirement);
    rejectGate.reject(failure);
    await rejected;
    assert.equal(owner.state, 'recovery_required');
    assert.equal(owner.activeOperations, 2);
    await assertPending(retired);
    assert.deepEqual(calls, ['open']);
    secondGate.resolve();
    await second;
    await assertPending(retired);
    assert.equal(owner.activeOperations, 1);
    assert.deepEqual(calls, ['open']);
    thirdGate.resolve();
    await third;
    await retirementRejected;
    assert.equal(owner.activeOperations, 0);
    assert.deepEqual(calls, ['open', 'status', 'close']);
    assert.equal(owner.quiesce(), retirement);
    await assert.rejects(owner.run(async () => undefined), /recovery_required/);
    assert.throws(() => owner.consumeQuiescence({} as LegacyQuiescence), /fresh quiescence receipt/);
});
for (const outcome of ['resolve', 'reject'] as const) {
    test(`an escaped operation scope is revoked after ${outcome}`, async () => {
        const { owner, calls } = fixture();
        let escaped!: Parameters<Parameters<typeof owner.run>[0]>[0];
        const failure = new Error('scope rejection');
        const operation = owner.run(async (open) => {
            escaped = open;
            if (outcome === 'reject')
                throw failure;
        });
        if (outcome === 'reject')
            await assert.rejects(operation, error => error === failure);
        else
            await operation;
        await assert.rejects(escaped(), /scope has ended/);
        assert.deepEqual(calls, []);
        assert.equal(owner.activeOperations, 0);
    });
}
test('an escaped scope cannot reuse an already-open handle', async () => {
    const { owner, calls } = fixture();
    let escaped!: Parameters<Parameters<typeof owner.run>[0]>[0];
    await owner.run(async (open) => { escaped = open; await open(); });
    await assert.rejects(escaped(), /scope has ended/);
    assert.deepEqual(calls, ['open']);
    await owner.quiesce();
});
test('unused quiescence does not open a database and always returns the same receipt promise', async () => {
    const { owner, calls } = fixture();
    const retirement = owner.quiesce();
    assert.equal(owner.quiesce(), retirement);
    const receipt = await retirement;
    assert.equal(await owner.quiesce(), receipt);
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(calls, []);
    await assert.rejects(owner.run(async (open) => open()), /access is closed/);
});
test('concurrent and repeated retirement calls close once and wait for close completion', async () => {
    const closeGate = deferred<void>();
    const closeEntered = deferred<void>();
    const { owner, calls } = fixture({ close: () => { closeEntered.resolve(); return closeGate.promise; } });
    await owner.run(open => open());
    const retirement = owner.quiesce();
    const retired = observe(retirement);
    assert.equal(owner.quiesce(), retirement);
    await closeEntered.promise;
    await assertPending(retired);
    assert.equal(owner.state, 'draining');
    closeGate.resolve();
    const receipt = await retirement;
    assert.equal(owner.quiesce(), retirement);
    assert.equal(await owner.quiesce(), receipt);
    assert.deepEqual(calls, ['open', 'status', 'close']);
});
test('close failure latches recovery and cannot trigger a second close', async () => {
    const failure = new Error('close failed after native close');
    const { owner, calls } = fixture({ close: async () => { throw failure; } });
    await owner.run(open => open());
    const retirement = owner.quiesce();
    await assert.rejects(retirement, hasFailure(failure));
    assert.equal(owner.state, 'recovery_required');
    assert.equal(owner.quiesce(), retirement);
    await assert.rejects(owner.quiesce(), hasFailure(failure));
    await assert.rejects(owner.run(async () => undefined), /recovery_required/);
    assert.throws(() => owner.consumeQuiescence({} as LegacyQuiescence), /fresh quiescence receipt/);
    assert.deepEqual(calls, ['open', 'status', 'close']);
});
test('deferred initialization failure drains an admitted sibling and permanently latches recovery', async () => {
    const opening = deferred<ReturnType<typeof fixture>['database']>();
    const siblingGate = deferred<void>();
    const failure = new Error('initialization failed');
    let opens = 0;
    const owner = createLegacyDatabaseOwner(() => { opens++; return opening.promise; });
    const first = owner.run(open => open());
    const firstRejected = assert.rejects(first, error => error === failure);
    const sibling = owner.run(async () => { await siblingGate.promise; });
    const retirement = owner.quiesce();
    const retirementRejected = assert.rejects(retirement, hasFailure(failure));
    const retired = observe(retirement);
    opening.reject(failure);
    await firstRejected;
    await assertPending(retired);
    assert.equal(owner.activeOperations, 1);
    assert.equal(owner.state, 'recovery_required');
    siblingGate.resolve();
    await sibling;
    await retirementRejected;
    assert.equal(owner.quiesce(), retirement);
    await assert.rejects(owner.run(open => open()), /recovery_required/);
    assert.equal(opens, 1);
});
for (const mode of ['transaction', 'status-error'] as const) {
    test(`${mode} refuses both close and a quiescence receipt`, async () => {
        const failure = new Error('status unavailable');
        const { owner, calls } = fixture({ status: async () => {
                if (mode === 'status-error')
                    throw failure;
                return true;
            } });
        await owner.run(open => open());
        const retirement = owner.quiesce();
        await assert.rejects(retirement, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            if (mode === 'status-error')
                assert.ok(error.errors.includes(failure));
            else
                assert.match(String(error.errors[0]), /not idle/);
            return true;
        });
        assert.equal(owner.state, 'recovery_required');
        assert.equal(owner.quiesce(), retirement);
        assert.deepEqual(calls, ['open', 'status']);
        assert.throws(() => owner.consumeQuiescence({} as LegacyQuiescence), /fresh quiescence receipt/);
        await assert.rejects(owner.run(async () => undefined), /recovery_required/);
    });
}
test('forged, copied, cross-owner, and repeated receipts cannot consume ownership', async () => {
    const { owner, calls } = fixture();
    const other = fixture().owner;
    assert.throws(() => owner.consumeQuiescence({} as LegacyQuiescence), /fresh quiescence receipt/);
    const receipt = await owner.quiesce();
    const otherReceipt = await other.quiesce();
    for (const invalid of [{}, { ...receipt }, Object.create(receipt), otherReceipt]) {
        assert.throws(() => owner.consumeQuiescence(invalid as LegacyQuiescence), /fresh quiescence receipt/);
        assert.equal(owner.state, 'quiescent');
    }
    assert.throws(() => other.consumeQuiescence(receipt), /fresh quiescence receipt/);
    owner.consumeQuiescence(receipt);
    assert.equal(owner.state, 'handed_off');
    assert.throws(() => owner.consumeQuiescence(receipt), /fresh quiescence receipt/);
    await assert.rejects(owner.run(async (open) => open()), /handed_off/);
    assert.equal(await owner.quiesce(), receipt);
    assert.equal(owner.state, 'handed_off');
    assert.throws(() => owner.consumeQuiescence(receipt), /fresh quiescence receipt/);
    assert.deepEqual(calls, []);
    other.consumeQuiescence(otherReceipt);
    assert.equal(other.state, 'handed_off');
});
