import assert from "node:assert/strict";
import test from "node:test";
import type { SQLiteDatabase } from "../../../src/expoSqliteTypes";
import { createLegacyAccess } from "../../../src/legacyAccess";
import { LegacyBusinessRefusal } from "../../../src/legacyBusinessRefusal";
import { sampleProject } from "../../../../core/src/sampleProject";
const options = { backendLabel: 'test', runtime: 'native' as const, notes: [] };
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    return { promise, resolve };
}
test('proof reads and repository calls share one owner and both block retirement', async () => {
    const entered = deferred(), release = deferred();
    const calls: string[] = [];
    let opens = 0;
    const fake = {
        async getFirstAsync(sql: string, projectId?: string) {
            calls.push(sql);
            if (sql === 'PRAGMA user_version;') {
                entered.resolve();
                await release.promise;
                return { user_version: 11 };
            }
            assert.equal(projectId, 'proof-id');
            return { count: 1 };
        },
        async getAllAsync(sql: string) { calls.push(sql); return []; },
        async isInTransactionAsync() { calls.push('idle'); return false; },
        async closeAsync() { calls.push('close'); },
    } as unknown as SQLiteDatabase;
    const access = createLegacyAccess(options, async () => { opens++; return fake; });
    const proof = access.collectSqliteProof('proof-id');
    await entered.promise;
    const listing = access.repository.listProjectsAsync();
    const retirement = access.quiesce();
    assert.equal(access.state, 'draining');
    await listing;
    assert.equal(calls.includes('close'), false);
    await assert.rejects(access.repository.listProjectsAsync(), /Legacy database access is closed/);
    await assert.rejects(access.collectSqliteProof('another'), /Legacy database access is closed/);
    release.resolve();
    const report = await proof;
    assert.equal(report.pragmaUserVersion, 11);
    assert.equal(report.geometryRowsPopulated, true);
    const receipt = await retirement;
    assert.equal(opens, 1);
    assert.equal(calls.length, 9);
    assert.deepEqual(calls.slice(-2), ['idle', 'close']);
    access.consumeQuiescence(receipt);
    assert.equal(access.state, 'handed_off');
});
test('a failed proof read drains other work but cannot authorize ownership transfer', async () => {
    const entered = deferred(), release = deferred();
    let closes = 0;
    const failure = Error('proof-read-failure');
    const fake = {
        async getFirstAsync() { await release.promise; throw failure; },
        async getAllAsync() { entered.resolve(); await release.promise; return []; },
        async isInTransactionAsync() { return false; },
        async closeAsync() { closes++; },
    } as unknown as SQLiteDatabase;
    const access = createLegacyAccess(options, async () => fake);
    const proof = access.collectSqliteProof('id');
    const checkedProof = assert.rejects(proof, error => error === failure);
    const listing = access.repository.listProjectsAsync();
    await entered.promise;
    const retirement = access.quiesce();
    const checkedRetirement = assert.rejects(retirement, (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [failure]);
        return true;
    });
    assert.equal(closes, 0);
    release.resolve();
    await listing;
    await checkedProof;
    await checkedRetirement;
    assert.equal(closes, 1);
    assert.equal(access.state, 'recovery_required');
    assert.equal(access.quiesce(), retirement);
});
test('unused public access quiesces without invoking even a throwing opener', async () => {
    let opens = 0;
    const access = createLegacyAccess(options, async () => { opens++; throw Error('must not open'); });
    const receipt = await access.quiesce();
    access.consumeQuiescence(receipt);
    assert.equal(opens, 0);
    await assert.rejects(access.collectSqliteProof('id'), /access is closed/);
});
test('nonempty-client refusal preserves availability and permits a later clean handoff', async () => {
    let writes = 0, closes = 0;
    const fake = {
        async getFirstAsync() { return { count: 1 }; },
        async getAllAsync() { return []; },
        async runAsync() { writes++; },
        async isInTransactionAsync() { return false; },
        async closeAsync() { closes++; },
    } as unknown as SQLiteDatabase;
    const access = createLegacyAccess(options, async () => fake);
    await assert.rejects(access.repository.deleteClientAsync('nonempty'), LegacyBusinessRefusal);
    assert.equal(access.state, 'legacy');
    assert.deepEqual(await access.repository.listProjectsAsync(), []);
    const receipt = await access.quiesce();
    access.consumeQuiescence(receipt);
    assert.equal(writes, 0);
    assert.equal(closes, 1);
});
for (const failedCleanup of [false, true]) {
    test(`business refusal within transaction preserves cleanup failure authority (${failedCleanup})`, async () => {
        const cleanup = Error('transaction cleanup failed');
        let closes = 0, transactionFinished = false;
        const fake = {
            async getFirstAsync() { return null; },
            async getAllAsync() { return []; },
            async withExclusiveTransactionAsync(task: (db: SQLiteDatabase) => Promise<void>) {
                try {
                    await task(fake);
                }
                finally {
                    transactionFinished = true;
                    if (failedCleanup)
                        throw cleanup;
                }
            },
            async isInTransactionAsync() { assert.equal(transactionFinished, true); return false; },
            async closeAsync() { closes++; },
        } as unknown as SQLiteDatabase;
        const access = createLegacyAccess(options, async () => fake);
        await assert.rejects(access.repository.createDesignRecordAsync({ fieldMapId: 'missing', name: 'Test', pivotProjectId: 'project' }), error => failedCleanup ? error === cleanup : error instanceof LegacyBusinessRefusal);
        if (failedCleanup) {
            assert.equal(access.state, 'recovery_required');
            await assert.rejects(access.repository.listProjectsAsync(), /access is closed/);
            await assert.rejects(access.quiesce(), (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.deepEqual(error.errors, [cleanup]);
                return true;
            });
        }
        else {
            assert.equal(access.state, 'legacy');
            assert.deepEqual(await access.repository.listProjectsAsync(), []);
            access.consumeQuiescence(await access.quiesce());
        }
        assert.equal(closes, 1);
    });
}
for (const failedStage of ['open', 'status', 'close'] as const) {
    test(`business marker cannot exempt ${failedStage} failure from recovery`, async () => {
        const failure = new LegacyBusinessRefusal('simulated failure outside local preconditions');
        let closes = 0;
        const fake = {
            async getAllAsync() { return []; },
            async isInTransactionAsync() { if (failedStage === 'status')
                throw failure; return false; },
            async closeAsync() { closes++; if (failedStage === 'close')
                throw failure; },
        } as unknown as SQLiteDatabase;
        const access = createLegacyAccess(options, async () => { if (failedStage === 'open')
            throw failure; return fake; });
        if (failedStage === 'open')
            await assert.rejects(access.repository.listProjectsAsync(), error => error === failure);
        else
            await access.repository.listProjectsAsync();
        const retirement = access.quiesce();
        await assert.rejects(retirement, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [failure]);
            return true;
        });
        assert.equal(access.state, 'recovery_required');
        assert.equal(access.quiesce(), retirement);
        assert.equal(closes, failedStage === 'close' ? 1 : 0);
    });
}
for (const invalidInput of ['contact', 'save-plan'] as const) {
    test(`invalid ${invalidInput} pure validation rejects without writes and preserves availability`, async () => {
        let writes = 0, transactions = 0, closes = 0;
        const fake = {
            async getAllAsync() { return []; },
            async runAsync() { writes++; },
            async withExclusiveTransactionAsync() { transactions++; },
            async isInTransactionAsync() { return false; },
            async closeAsync() { closes++; },
        } as unknown as SQLiteDatabase;
        const access = createLegacyAccess(options, async () => fake);
        const result = invalidInput === 'contact'
            ? access.repository.createClientAsync({ primaryContactFirstName: '', primaryContactLastName: '' })
            : access.repository.saveProjectAsync({ ...sampleProject, fieldBoundary: [{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] });
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof LegacyBusinessRefusal);
            assert.ok(error.cause instanceof Error);
            return true;
        });
        assert.equal(access.state, 'legacy');
        assert.deepEqual(await access.repository.listProjectsAsync(), []);
        access.consumeQuiescence(await access.quiesce());
        assert.equal(writes, 0);
        assert.equal(transactions, 0);
        assert.equal(closes, 1);
    });
}
