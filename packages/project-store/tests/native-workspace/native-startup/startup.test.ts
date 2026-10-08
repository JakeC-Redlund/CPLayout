import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createNativeWorkspaceStartup, type NativeWorkspaceStartupOptions } from "../../../src/nativeWorkspaceStartup";
import { withHandoffFixture, deferred, until } from "../test-overlays/handoffFixture";
import { readyOptions, inspect, assertSingleCloses } from "../test-overlays/readyFixture";
import { createNativeWorkspaceHandoff } from "../../../src/nativeWorkspaceHandoff";
test('intent accessors cannot change open into upgrade after validation', async () => withHandoffFixture(async f => {
    let reads = 0;
    const intent = { get kind() { return ++reads <= 2 ? 'open' : 'upgrade'; }, attemptId: 'unexpected-upgrade' };
    const startup = createNativeWorkspaceStartup({ ...readyOptions(f), intent } as NativeWorkspaceStartupOptions);
    await assert.rejects(startup.start());
    assert.equal(reads, 1);
    assert.equal(inspect(f.path, db => db.prepare('PRAGMA user_version').get()!.user_version), 11);
    assert.equal(f.base.events.includes('publish-hex'), false);
}, { primeLegacy: false }));
test('cold startup binds retirement callbacks before caller replacement', async () => withHandoffFixture(async f => {
    assert.equal((await createNativeWorkspaceHandoff(readyOptions(f)).run('callback-seed')).state, 'committed');
    await f.freshLegacy(false);
    const options = readyOptions(f);
    let drained = 0, consumed = 0;
    const wrapper = {
        get state() { return f.owner.state; },
        quiesce() { assert.equal(this, wrapper); drained++; return f.owner.quiesce(); },
        consumeQuiescence(receipt: Parameters<typeof f.owner.consumeQuiescence>[0]) {
            assert.equal(this, wrapper); consumed++; f.owner.consumeQuiescence(receipt);
        },
    };
    const startup = createNativeWorkspaceStartup({ ...options, legacy: wrapper, intent: { kind: 'open' } });
    wrapper.quiesce = () => { throw Error('replacement quiesce'); };
    wrapper.consumeQuiescence = () => { throw Error('replacement consume'); };
    await startup.start();
    assert.equal(drained, 1);
    assert.equal(consumed, 1);
    assert.equal(f.legacyAllocated, false);
    assertSingleCloses(f);
}));
test('committed handoff cannot expose a repository when its initial ready read fails', async () => withHandoffFixture(async f => {
    const options = readyOptions(f);
    const Base = options.source.nativeModule.NativeDatabase;
    let inits = 0;
    options.source = { ...options.source, nativeModule: { ...options.source.nativeModule,
        NativeDatabase: class extends Base {
            async initAsync() {
                if (++inits === 2) throw Error('initial-ready-failure');
                return super.initAsync();
            }
        },
    } };
    const startup = createNativeWorkspaceStartup({ ...options, intent: { kind: 'upgrade', attemptId: 'initial-read-failure' } });
    const result = startup.start();
    await assert.rejects(result, /initial-ready-failure/);
    assert.equal(startup.state, 'recovery_required');
    assert.equal(inspect(f.path, db => db.prepare('PRAGMA user_version').get()!.user_version), 12);
    assert.equal(startup.start(), result);
    await assert.rejects(startup.start());
    assert.equal(inits, 2);
    assertSingleCloses(f);
}));
test('construction is inert and simultaneous upgrades share one startup promise and repository', async () => withHandoffFixture(async (f) => {
    const events = [...f.base.events];
    const startup = createNativeWorkspaceStartup({ ...readyOptions(f), intent: { kind: 'upgrade', attemptId: 'startup-upgrade' } });
    assert.equal(startup.state, 'idle');
    assert.deepEqual(f.base.events, events);
    const first = startup.start(), second = startup.start();
    assert.equal(first, second);
    assert.equal(startup.state, 'starting');
    const repository = await first;
    assert.equal(startup.state, 'ready');
    assert.equal(await second, repository);
    assert.equal(await startup.start(), repository);
    assert.equal(f.base.events.filter(event => event === 'publish-hex').length, 1);
    const saved = await repository.versionedWorkspace.executeAsync(0, {
        type: 'create_client', id: 'startup-client', now: '2026-09-27T08:00:00.000Z',
        input: { primaryContactFirstName: 'Startup', primaryContactLastName: 'Test' },
    });
    assert.equal(saved.workspace.revision, 1);
    assert.equal(inspect(f.path, db => db.prepare('SELECT project_json FROM project_snapshots').get()!.project_json), f.document);
    assertSingleCloses(f);
}));
test('repository remains withheld while admitted legacy work drains', async () => withHandoffFixture(async (f) => {
    const gate = deferred(), work = f.owner.run(() => gate.promise);
    const startup = createNativeWorkspaceStartup({ ...readyOptions(f), intent: { kind: 'upgrade', attemptId: 'drain' } });
    const result = startup.start();
    try {
        await until(() => f.owner.state === 'draining');
        assert.equal(startup.state, 'starting');
        assert.equal(f.handles.length, 0);
        assert.equal(result, startup.start());
    }
    finally {
        gate.resolve();
    }
    await work;
    await result;
    assert.equal(startup.state, 'ready');
    assertSingleCloses(f);
}));
test('cold v12 open never calls the unused legacy opener or publishes another migration', async () => withHandoffFixture(async (f) => {
    assert.equal((await createNativeWorkspaceHandoff(readyOptions(f)).run('seed')).state, 'committed');
    await f.freshLegacy(false);
    const offset = f.base.events.length;
    const startup = createNativeWorkspaceStartup({ ...readyOptions(f), intent: { kind: 'open' } });
    const repository = await startup.start();
    assert.equal(startup.state, 'ready');
    assert.equal((await repository.versionedWorkspace.readAsync()).revision, 0);
    assert.equal(f.legacyAllocated, false);
    assert.equal(f.base.events.slice(offset).some(event => event === 'legacy-open' || event === 'publish-hex'), false);
    assert.equal(f.base.events.slice(offset).some(event => /source-sql:.*(?:CREATE|INSERT|UPDATE|DELETE|COMMIT)/.test(event)), false);
    assertSingleCloses(f);
}));
test('open intent cannot silently migrate a v11 source or retry', async () => withHandoffFixture(async (f) => {
    const startup = createNativeWorkspaceStartup({ ...readyOptions(f), intent: { kind: 'open' } });
    const first = startup.start();
    await assert.rejects(first);
    const count = f.handles.length;
    assert.equal(startup.state, 'recovery_required');
    assert.equal(first, startup.start());
    await assert.rejects(startup.start());
    assert.equal(f.handles.length, count);
    assert.equal(inspect(f.path, db => db.prepare('PRAGMA user_version').get()!.user_version), 11);
    assert.equal(f.base.events.includes('publish-hex'), false);
    assertSingleCloses(f);
}, { primeLegacy: false }));
test('missing existing source is not recreated or retried', async () => withHandoffFixture(async (f) => {
    unlinkSync(f.path);
    const startup = createNativeWorkspaceStartup({ ...readyOptions(f), intent: { kind: 'open' } });
    await assert.rejects(startup.start());
    assert.equal(startup.state, 'recovery_required');
    assert.equal(existsSync(f.path), false);
    await assert.rejects(startup.start());
    assert.equal(f.handles.length, 0);
    assert.equal(f.legacyAllocated, false);
}, { primeLegacy: false }));
for (const fault of ['constructorFailure', 'init', 'schemaInvalid', 'close', 'commitAcknowledgment'] as const) {
    test('startup retains ' + fault + ' failure without fallback or second allocation', async () => withHandoffFixture(async (f) => {
        f.faults[fault] = true;
        const startup = createNativeWorkspaceStartup({ ...readyOptions(f), intent: { kind: 'upgrade', attemptId: 'failure-' + fault } });
        const result = startup.start();
        await assert.rejects(result);
        assert.equal(startup.state, 'recovery_required');
        const count = f.handles.length;
        delete f.faults[fault];
        assert.equal(startup.start(), result);
        await assert.rejects(startup.start());
        assert.equal(f.handles.length, count);
        assertSingleCloses(f);
    }));
}
test('unsupported native profile performs no source allocation', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f);
    options.source = { ...options.source, platform: 'ios' };
    const startup = createNativeWorkspaceStartup({ ...options, intent: { kind: 'open' } });
    await assert.rejects(startup.start());
    assert.equal(f.handles.length, 0);
    assert.equal(f.owner.state, 'legacy');
    assert.equal(startup.state, 'recovery_required');
}));
test('invalid intent is rejected without any effects', async () => withHandoffFixture(async (f) => {
    const events = [...f.base.events];
    for (const intent of [{ kind: 'automatic' }, { kind: 'upgrade', attemptId: '../overwrite' }, null]) {
        assert.throws(() => createNativeWorkspaceStartup({ ...readyOptions(f), intent } as unknown as NativeWorkspaceStartupOptions), /explicit open\/upgrade/);
    }
    assert.deepEqual(f.base.events, events);
}));
test('changed caller configuration does not redirect queued startup', async () => withHandoffFixture(async (f) => {
    const options: NativeWorkspaceStartupOptions = { ...readyOptions(f), intent: { kind: 'upgrade', attemptId: 'captured' } };
    const startup = createNativeWorkspaceStartup(options);
    const result = startup.start();
    options.sourceIdentity = '/foreign';
    options.expectedSourcePath = '/foreign';
    options.intent = { kind: 'open' };
    options.source.nativeModule.NativeDatabase = class {
        constructor() { throw Error('changed constructor'); }
    } as never;
    options.sha256 = async () => 'invalid';
    options.sqlite = { ...options.sqlite, openDatabaseAsync: async () => { throw Error('changed sql'); } };
    assert.equal((await result).backendLabel, 'Expo SQLite');
    assert.equal(startup.state, 'ready');
    assertSingleCloses(f);
}));
test('post-startup admission failure is reflected by startup and never reopens through start', async () => withHandoffFixture(async (f) => {
    const startup = createNativeWorkspaceStartup({ ...readyOptions(f), intent: { kind: 'upgrade', attemptId: 'later-failure' } });
    const repository = await startup.start();
    const damaged = new DatabaseSync(f.path);
    try {
        damaged.exec('DROP TABLE cplayout_workspace_binding');
    }
    finally {
        damaged.close();
    }
    await assert.rejects(repository.versionedWorkspace.readAsync());
    assert.equal(startup.state, 'recovery_required');
    const count = f.handles.length;
    await assert.rejects(startup.start(), /cannot reopen/);
    assert.equal(f.handles.length, count);
    assertSingleCloses(f);
}));
