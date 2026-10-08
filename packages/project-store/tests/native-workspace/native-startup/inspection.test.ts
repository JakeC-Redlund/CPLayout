import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectNativeWorkspaceSource, type NativeInspectionDatabase } from "../../../src/nativeWorkspaceInspection";
import { SOURCE_LEASE_OPTIONS, type SourceLeaseDependencies } from "../../../src/nativeSourceLease";

// Real SQLite; the bridge and source lease are simulated, not Android/JNI evidence.
async function fixture(body: (f: ReturnType<typeof setup>) => Promise<void>, version = 11) {
    const f = setup(version);
    try { await body(f); }
    finally { for (const h of f.handles) if (!h.closed) h.db.close(); }
}
function setup(version: number) {
    const path = join(mkdtempSync(join(import.meta.dirname, 'inspection-')), 'source.db');
    const seed = new DatabaseSync(path);
    seed.exec('CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES (\'unchanged\'); PRAGMA user_version=' + version);
    seed.close();
    const original = readFileSync(path);
    const events: string[] = [];
    const faults: {
        init?: boolean; close?: boolean; rollback?: boolean; beginAcknowledgement?: boolean;
        read?: boolean; lostTransaction?: boolean; queryOnly?: boolean; isolation?: boolean;
        closeBefore?: boolean; rollbackNoop?: boolean; rollbackStatus?: boolean; wrapper?: boolean;
        version?: unknown; versionRows?: unknown[]; identityAt?: number; busy?: boolean;
        onInit?: () => void; onVersion?: () => void;
    } = {};
    const handles: Native[] = [];
    class Native {
        db: DatabaseSync;
        closed = false;
        closes = 0;
        assertions = 0;
        constructor(actual: string, options: typeof SOURCE_LEASE_OPTIONS) {
            events.push('construct');
            assert.equal(actual, path);
            assert.equal(options, SOURCE_LEASE_OPTIONS);
            // This fixture deliberately refuses absence before using Node's creating opener.
            if (!existsSync(path)) throw new Error('existing source unavailable');
            this.db = new DatabaseSync(path);
            handles.push(this);
        }
        async initAsync() {
            faults.onInit?.();
            if (faults.init) throw new Error('init fault');
            if (faults.busy) this.db.exec('BEGIN');
        }
        async assertSourceLeaseAsync() {
            const stat = statSync(path, { bigint: true });
            return { path, device: String(stat.dev), inode: String(stat.ino + (++this.assertions === faults.identityAt ? 1n : 0n)) };
        }
        async closeAsync() {
            events.push('close');
            this.closes++;
            if (faults.closeBefore) throw new Error('close before release fault');
            this.db.close();
            this.closed = true;
            if (faults.close) throw new Error('close fault');
        }
    }
    class Wrapper implements NativeInspectionDatabase {
        private rolledBack = false;
        constructor(_path: string, _options: typeof SOURCE_LEASE_OPTIONS, private native: Native) {
            if (faults.wrapper) throw new Error('wrapper constructor fault');
        }
        async execAsync(sql: string) {
            events.push(sql);
            if (sql === 'ROLLBACK;' && faults.rollback) throw new Error('rollback fault');
            if (sql === 'ROLLBACK;' && faults.rollbackNoop) return;
            this.native.db.exec(sql);
            if (sql === 'ROLLBACK;') this.rolledBack = true;
            if (sql === 'BEGIN DEFERRED;' && faults.beginAcknowledgement) throw new Error('begin acknowledgement fault');
        }
        async getAllAsync<T>(sql: string): Promise<T[]> {
            events.push(sql);
            assert.equal(this.native.db.isTransaction, true);
            if (faults.read) throw new Error('read fault');
            if (sql === 'PRAGMA query_only;' && faults.queryOnly) return [{ query_only: 0 }] as T[];
            if (sql === 'PRAGMA read_uncommitted;' && faults.isolation) return [{ read_uncommitted: 1 }] as T[];
            if (sql === 'PRAGMA main.user_version;') {
                faults.onVersion?.();
                if ('versionRows' in faults) return faults.versionRows as T[];
                if ('version' in faults) return [{ user_version: faults.version }] as T[];
            }
            const rows = this.native.db.prepare(sql).all() as T[];
            if (faults.lostTransaction) this.native.db.exec('ROLLBACK');
            return rows;
        }
        async isInTransactionAsync() {
            if (this.rolledBack && faults.rollbackStatus) throw new Error('rollback status fault');
            return this.native.db.isTransaction;
        }
        closeAsync() { return this.native.closeAsync(); }
    }
    const source: SourceLeaseDependencies<Native, NativeInspectionDatabase> = {
        platform: 'android',
        nativeModule: { cplayoutExistingOnlyVersion: 1, cplayoutSourceLeaseVersion: 1, NativeDatabase: Native },
        SQLiteDatabase: Wrapper,
    };
    return { path, original, faults, handles, events, source };
}
function errors(error: unknown): string[] {
    return error instanceof AggregateError ? error.errors.flatMap(errors) : [String(error)];
}
function closed(f: ReturnType<typeof setup>) {
    for (const h of f.handles) { assert.equal(h.closed, true); assert.equal(h.closes, 1); }
}
for (const version of [0, 10, 11, 12, 13, -1]) {
    test('inspection routes version ' + version + ' without admission or mutation', async () => fixture(async f => {
        const result = await inspectNativeWorkspaceSource(f.path, f.source);
        assert.equal(result.kind, version === 11 ? 'legacy_candidate' : version === 12 ? 'workspace_candidate' : 'unsupported');
        assert.equal(result.schemaVersion, version);
        assert.equal(result.identity.path, f.path);
        assert.ok(Object.isFrozen(result) && Object.isFrozen(result.identity));
        assert.equal(f.events.at(-1), 'close');
        assert.ok(f.events.indexOf('SELECT name FROM main.sqlite_schema LIMIT 1;') < f.events.indexOf('PRAGMA main.user_version;'));
        assert.deepEqual(readFileSync(f.path), f.original);
        assert.equal(f.events.some(sql => /^(CREATE|INSERT|UPDATE|DELETE|COMMIT)/.test(sql)), false);
        closed(f);
    }, version));
}
for (const fault of ['init', 'close', 'rollback', 'beginAcknowledgement', 'read', 'lostTransaction', 'queryOnly', 'isolation', 'busy'] as const) {
    test('inspection withholds routing on ' + fault + ' failure', async () => fixture(async f => {
        f.faults[fault] = true;
        await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source));
        closed(f);
        assert.deepEqual(readFileSync(f.path), f.original);
        if (fault === 'beginAcknowledgement') assert.ok(f.events.includes('ROLLBACK;'));
        if (fault === 'busy') assert.equal(f.events.includes('ROLLBACK;'), false);
    }));
}
test('inspection retains primary and both cleanup failures', async () => fixture(async f => {
    f.faults.read = f.faults.rollback = f.faults.close = true;
    await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source), error => {
        assert.deepEqual(errors(error), ['Error: read fault', 'Error: rollback fault', 'Error: close fault']);
        return true;
    });
    closed(f);
}));
test('failed close before release withholds the candidate and never retries close', async () => fixture(async f => {
    f.faults.closeBefore = true;
    await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source), error => {
        assert.deepEqual(errors(error), ['Error: close before release fault']);
        return true;
    });
    assert.equal(f.handles.length, 1);
    assert.equal(f.handles[0].closes, 1);
    assert.equal(f.handles[0].closed, false);
    assert.equal(f.handles[0].db.isTransaction, false);
}));
for (const fault of ['rollbackNoop', 'rollbackStatus'] as const) {
    test('inspection refuses unconfirmed cleanup after ' + fault, async () => fixture(async f => {
        f.faults[fault] = true;
        await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source), error => {
            assert.deepEqual(errors(error), [fault === 'rollbackNoop'
                ? 'Error: Native inspection rollback left a transaction active' : 'Error: rollback status fault']);
            return true;
        });
        closed(f);
    }));
}
test('wrapper failure retains native close failure before lease delivery', async () => fixture(async f => {
    f.faults.wrapper = f.faults.closeBefore = true;
    await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source), error => {
        assert.deepEqual(errors(error), ['Error: wrapper constructor fault', 'Error: close before release fault']);
        return true;
    });
    assert.equal(f.handles.length, 1);
    assert.equal(f.handles[0].closes, 1);
    assert.equal(f.handles[0].closed, false);
    assert.deepEqual(f.events, ['construct', 'close']);
}));
for (const version of [undefined, null, '12', 12.5, NaN, Infinity, 2147483648, -2147483649]) {
    test('inspection rejects malformed version ' + String(version), async () => fixture(async f => {
        f.faults.version = version;
        await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source), error => errors(error).some(message => message.includes('invalid schema version')));
        closed(f);
    }));
}
for (const rows of [[], [{ user_version: 12 }, { user_version: 12 }]]) {
    test('inspection rejects ' + rows.length + ' version rows', async () => fixture(async f => {
        f.faults.versionRows = rows;
        await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source));
        closed(f);
    }));
}
for (const identityAt of [2, 4, 11]) {
    test('inspection refuses identity change at assertion ' + identityAt, async () => fixture(async f => {
        f.faults.identityAt = identityAt;
        await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source), error => errors(error).some(message => message.includes('identity changed')));
        closed(f);
    }));
}
test('inspection cannot recreate a missing file', async () => fixture(async f => {
    unlinkSync(f.path);
    await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source), /existing source unavailable/);
    assert.equal(existsSync(f.path), false);
    assert.equal(f.handles.length, 0);
}));
test('unreadable database contents are preserved, not treated as fresh installation', async () => fixture(async f => {
    const corrupt = Buffer.from('retained non-SQLite evidence');
    writeFileSync(f.path, corrupt);
    await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source));
    assert.deepEqual(readFileSync(f.path), corrupt);
    closed(f);
}));
test('inspection captures dependencies before native initialization yields', async () => fixture(async f => {
    f.faults.onInit = () => {
        f.source.SQLiteDatabase = class { constructor() { throw new Error('redirected wrapper'); } } as never;
        f.source.platform = 'ios';
    };
    assert.equal((await inspectNativeWorkspaceSource(f.path, f.source)).kind, 'legacy_candidate');
    closed(f);
}));
test('inspection rejects unsupported platform before native allocation', async () => fixture(async f => {
    f.source.platform = 'ios';
    await assert.rejects(inspectNativeWorkspaceSource(f.path, f.source), /requires Android/);
    assert.deepEqual(f.events, []);
}));
test('WAL reader retains one snapshot across a concurrent version change', async () => fixture(async f => {
    const writer = new DatabaseSync(f.path);
    try {
        writer.exec('PRAGMA journal_mode=WAL;');
        f.faults.onVersion = () => { writer.exec('PRAGMA user_version=12;'); };
        const result = await inspectNativeWorkspaceSource(f.path, f.source);
        assert.equal(result.schemaVersion, 11);
        assert.equal(writer.prepare('PRAGMA user_version').get()!.user_version, 12);
        closed(f);
    }
    finally { writer.close(); }
}));
