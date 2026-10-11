import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { withHandoffFixture, deferred, until } from "../test-overlays/handoffFixture";
import { readyOptions, assertSingleCloses, inspect } from "../test-overlays/readyFixture";
import { createNativeWorkspaceHandoff, type NativeReadyPermit } from "../../../src/nativeWorkspaceHandoff";
import { createNativeReadyRepository, openNativeReadyRepository, type NativeReadyRepositoryOptions } from "../../../src/nativeReadyRepository";
test('successful upgrade opens a verified ready workspace in the same lifetime without another legacy owner', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.throws(() => handoff.takeReadyPermit(), /Successful closed handoff/);
    const result = await handoff.run('same-session');
    assert.equal(result.state, 'committed', String(result.error));
    assert.equal(f.owner.state, 'handed_off');
    assertSingleCloses(f);
    const permit = handoff.takeReadyPermit();
    assert.ok(Object.isFrozen(permit));
    assert.throws(() => handoff.takeReadyPermit(), /one ready permit/);
    const { legacy, ...rest } = options;
    const ready = await openNativeReadyRepository({ ...rest, handoffPermit: permit });
    const saved = await ready.repository.versionedWorkspace.executeAsync(0, {
        type: 'create_client', id: 'same-session-client', now: '2026-09-27T07:00:00.000Z',
        input: { primaryContactFirstName: 'Same', primaryContactLastName: 'Session' },
    });
    assert.equal(saved.workspace.revision, 1);
    assert.equal(f.legacy.closes, 1);
    assert.equal(legacy, f.owner);
    assert.equal(inspect(f.path, db => db.prepare('SELECT project_json FROM project_snapshots').get()!.project_json), f.document);
    assert.equal(f.base.events.filter(event => event === 'publish-hex').length, 1);
    assertSingleCloses(f);
    assert.ok(f.base.connections.every(connection => connection.closed));
}));
test('a verified unchanged upgrade also authorizes same-session ready access', async () => withHandoffFixture(async (f) => {
    assert.equal((await createNativeWorkspaceHandoff(readyOptions(f)).run('first')).state, 'committed');
    await f.freshLegacy();
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('current')).state, 'unchanged');
    const { legacy: _, ...rest } = options;
    const runtime = await openNativeReadyRepository({ ...rest, handoffPermit: handoff.takeReadyPermit() });
    assert.equal(runtime.state, 'available');
    assertSingleCloses(f);
}));
test('an in-flight upgrade cannot issue authority while legacy operations drain', async () => withHandoffFixture(async (f) => {
    const gate = deferred();
    const work = f.owner.run(async () => gate.promise);
    const handoff = createNativeWorkspaceHandoff(readyOptions(f));
    const running = handoff.run('draining');
    try {
        await until(() => f.owner.state === 'draining');
        assert.throws(() => handoff.takeReadyPermit(), /Successful closed handoff/);
        assert.equal(f.handles.length, 0);
    }
    finally {
        gate.resolve();
    }
    await work;
    assert.equal((await running).state, 'committed');
    assert.ok(handoff.takeReadyPermit());
    assertSingleCloses(f);
}));
for (const fault of ['constructorFailure', 'init', 'schemaInvalid', 'close', 'commitAcknowledgment'] as const) {
    test(fault + ' never authorizes ready access even if the caller rewrites the reported outcome', async () => withHandoffFixture(async (f) => {
        f.faults[fault] = true;
        const handoff = createNativeWorkspaceHandoff(readyOptions(f));
        const outcome = await handoff.run('failed');
        assert.ok(outcome.state === 'not_committed' || outcome.state === 'recovery_required');
        outcome.state = 'committed';
        outcome.cleanupErrors.length = 0;
        delete outcome.error;
        assert.throws(() => handoff.takeReadyPermit(), /Successful closed handoff/);
        await assert.rejects(handoff.run('retry'), /already been used/);
    }));
}
test('forged or copied permits cannot open native access', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('original')).state, 'committed');
    const permit = handoff.takeReadyPermit();
    const { legacy: _, ...rest } = options;
    const count = f.handles.length;
    for (const forged of [{}, { ...permit }]) {
        assert.throws(() => createNativeReadyRepository({ ...rest, handoffPermit: forged as NativeReadyPermit }), /authorization/);
    }
    assert.equal(f.handles.length, count);
    await openNativeReadyRepository({ ...rest, handoffPermit: permit });
    assertSingleCloses(f);
}));
for (const changed of ['path', 'module', 'sqlite', 'sha256', 'inspection', 'native', 'wrapper'] as const) {
    test('changed ' + changed + ' cannot reuse successful handoff authority', async () => withHandoffFixture(async (f) => {
        const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
        assert.equal((await handoff.run('bound')).state, 'committed');
        const permit = handoff.takeReadyPermit();
        const { legacy: _, ...rest } = options;
        const attempt = { ...rest, handoffPermit: permit, source: { ...rest.source,
                nativeModule: { ...rest.source.nativeModule } } };
        if (changed === 'path')
            attempt.sourceIdentity = attempt.expectedSourcePath = '/different/source.db';
        if (changed === 'module')
            attempt.module = f.options().module;
        if (changed === 'sqlite')
            attempt.sqlite = { ...rest.sqlite };
        if (changed === 'sha256')
            attempt.sha256 = async (text) => rest.sha256(text);
        if (changed === 'inspection')
            attempt.newInspectionId = () => rest.newInspectionId();
        if (changed === 'native') {
            const Base = rest.source.nativeModule.NativeDatabase;
            attempt.source.nativeModule.NativeDatabase = class extends Base {
            };
        }
        if (changed === 'wrapper') {
            const Base = rest.source.SQLiteDatabase;
            attempt.source.SQLiteDatabase = class extends Base {
            };
        }
        const count = f.handles.length;
        assert.throws(() => createNativeReadyRepository(attempt), /authorization/);
        assert.equal(f.handles.length, count);
        // A configuration typo does not consume the legitimate caller's unused permit.
        await openNativeReadyRepository({ ...rest, handoffPermit: permit });
        assertSingleCloses(f);
    }));
}
test('only one of two pending ready runtimes may consume a permit', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('single')).state, 'committed');
    const { legacy: _, ...rest } = options;
    const config = { ...rest, handoffPermit: handoff.takeReadyPermit() };
    const a = createNativeReadyRepository(config), b = createNativeReadyRepository(config);
    const count = f.handles.length;
    const results = await Promise.allSettled([a.repository.versionedWorkspace.readAsync(), b.repository.versionedWorkspace.readAsync()]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(b.state, 'recovery_required');
    assert.equal(f.handles.length, count + 1);
    assert.throws(() => createNativeReadyRepository(config), /authorization/);
    assert.equal((await a.repository.versionedWorkspace.readAsync()).revision, 0);
    assertSingleCloses(f);
}));
test('a consumed permit stays spent after ready initialization fails', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('ready-failure')).state, 'committed');
    const { legacy: _, ...rest } = options;
    const config = { ...rest, handoffPermit: handoff.takeReadyPermit() };
    f.faults.init = true;
    await assert.rejects(openNativeReadyRepository(config), /source-init-failure/);
    delete f.faults.init;
    const count = f.handles.length;
    assert.throws(() => createNativeReadyRepository(config), /authorization/);
    assert.throws(() => handoff.takeReadyPermit(), /one ready permit/);
    assert.equal(f.handles.length, count);
    assertSingleCloses(f);
}));
test('cold legacy and handoff authority are mutually exclusive', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('one-mode')).state, 'committed');
    const permit = handoff.takeReadyPermit();
    const count = f.handles.length;
    const ambiguous = { ...options, handoffPermit: permit } as unknown as NativeReadyRepositoryOptions;
    assert.throws(() => createNativeReadyRepository(ambiguous), /fresh legacy owner/);
    assert.equal(f.handles.length, count);
    const { legacy: _, ...rest } = options;
    await openNativeReadyRepository({ ...rest, handoffPermit: permit });
}));
test('handoff captures adapter methods and changed methods cannot gain ready authority', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    const module = options.module!;
    const original = module.createSession;
    let replacements = 0;
    module.createSession = async () => { replacements++; throw new Error('replacement must not run'); };
    assert.equal((await handoff.run('captured-method')).state, 'committed');
    assert.equal(replacements, 0);
    const { legacy: _, ...rest } = options;
    const config = { ...rest, handoffPermit: handoff.takeReadyPermit() };
    assert.throws(() => createNativeReadyRepository(config), /authorization/);
    module.createSession = original;
    await openNativeReadyRepository(config);
    assertSingleCloses(f);
}));
test('method replacement after construction is refused before consuming or opening the permit', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('before-claim')).state, 'committed');
    const { legacy: _, ...rest } = options;
    const config = { ...rest, handoffPermit: handoff.takeReadyPermit() };
    const ready = createNativeReadyRepository(config), count = f.handles.length;
    const sqlite = options.sqlite, original = sqlite.openDatabaseAsync;
    sqlite.openDatabaseAsync = async () => { throw new Error('replacement must not run'); };
    await assert.rejects(ready.repository.versionedWorkspace.readAsync(), /authorization/);
    assert.equal(ready.state, 'recovery_required');
    assert.equal(f.handles.length, count);
    sqlite.openDatabaseAsync = original;
    // Validation failed before consumption; only a new runtime may attempt the valid configuration.
    await openNativeReadyRepository(config);
    assertSingleCloses(f);
}));
test('claimed ready runtime retains captured adapter methods between operations', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('after-claim')).state, 'committed');
    const { legacy: _, ...rest } = options;
    const ready = await openNativeReadyRepository({ ...rest, handoffPermit: handoff.takeReadyPermit() });
    let replacements = 0;
    options.module!.createSession = async () => { replacements++; throw new Error('replacement must not run'); };
    options.sqlite.openDatabaseAsync = async () => { replacements++; throw new Error('replacement must not run'); };
    assert.equal((await ready.repository.versionedWorkspace.readAsync()).revision, 0);
    assert.equal(replacements, 0);
    assertSingleCloses(f);
}));
for (const timing of ['before ready', 'between operations'] as const) {
    test('retained backup tampering ' + timing + ' still blocks a valid permit holder', async () => withHandoffFixture(async (f) => {
        const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
        const result = await handoff.run('retained-tamper');
        assert.equal(result.state, 'committed');
        assert.ok(result.prepared);
        const { legacy: _, ...rest } = options;
        const config = { ...rest, handoffPermit: handoff.takeReadyPermit() };
        const runtime = createNativeReadyRepository(config);
        if (timing === 'between operations')
            await runtime.repository.versionedWorkspace.readAsync();
        const backup = result.prepared.backup.identity;
        const bytes = readFileSync(backup);
        writeFileSync(backup, Buffer.concat([bytes, Buffer.from('fixture-only corruption')]));
        const count = f.handles.length;
        await assert.rejects(runtime.repository.versionedWorkspace.readAsync());
        assert.equal(runtime.state, 'recovery_required');
        assert.equal(f.handles.length, count + 1);
        await assert.rejects(runtime.repository.versionedWorkspace.readAsync());
        assert.equal(f.handles.length, count + 1);
        assertSingleCloses(f);
        assert.ok(f.base.connections.every(connection => connection.closed));
        assert.equal(f.base.events.filter(e => e === 'create-session').length, f.base.events.filter(e => e === 'release').length);
    }));
}
test('accessor-backed handoff methods are captured exactly once for binding and execution', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), module = options.module!, original = module.createSession;
    let reads = 0, replacements = 0;
    const replacement = async () => { replacements++; throw new Error('accessor replacement must not run'); };
    Object.defineProperty(module, 'createSession', { configurable: true, enumerable: true,
        get() { return ++reads % 2 === 1 ? original : replacement; } });
    const handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('accessor-upgrade')).state, 'committed');
    assert.equal(reads, 1);
    assert.equal(replacements, 0);
    Object.defineProperty(module, 'createSession', { configurable: true, enumerable: true, writable: true, value: original });
    const { legacy: _, ...rest } = options;
    await openNativeReadyRepository({ ...rest, handoffPermit: handoff.takeReadyPermit() });
    assertSingleCloses(f);
}));
test('accessor alternation during ready construction cannot substitute an unbound method', async () => withHandoffFixture(async (f) => {
    const options = readyOptions(f), handoff = createNativeWorkspaceHandoff(options);
    assert.equal((await handoff.run('accessor-ready')).state, 'committed');
    const { legacy: _, ...rest } = options;
    const config = { ...rest, handoffPermit: handoff.takeReadyPermit() };
    const module = options.module!, original = module.createSession;
    let reads = 0, replacements = 0;
    const replacement = async () => { replacements++; throw new Error('unbound method ran'); };
    Object.defineProperty(module, 'createSession', { configurable: true, enumerable: true,
        get() { return ++reads % 2 === 1 ? original : replacement; } });
    const runtime = createNativeReadyRepository(config), count = f.handles.length;
    assert.equal(reads, 1);
    await assert.rejects(runtime.repository.versionedWorkspace.readAsync(), /authorization/);
    assert.equal(reads, 2);
    assert.equal(replacements, 0);
    assert.equal(f.handles.length, count);
    Object.defineProperty(module, 'createSession', { configurable: true, enumerable: true, writable: true, value: original });
    await openNativeReadyRepository(config);
    assertSingleCloses(f);
}));
for (const failure of [undefined, null, false, 0]) {
    test('falsy thrown value ' + String(failure) + ' cannot authorize ready access', async () => withHandoffFixture(async (f) => {
        const options = readyOptions(f);
        options.sha256 = async () => { throw failure; };
        const handoff = createNativeWorkspaceHandoff(options);
        const result = await handoff.run('falsy-failure');
        assert.ok(result.state === 'not_committed' || result.state === 'recovery_required');
        assert.throws(() => handoff.takeReadyPermit(), /Successful closed handoff/);
    }));
}
