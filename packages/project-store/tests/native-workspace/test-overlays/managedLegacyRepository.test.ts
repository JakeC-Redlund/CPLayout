import assert from "node:assert/strict";
import { test } from "node:test";
import { sampleProject } from "../../../../core/src/sampleProject";
import { parseProjectDocument, serializeProjectDocument } from "../../../../core/src/index";
import type { SQLiteDatabase } from "../../../src/expoSqliteTypes";
import type { ProjectRepository } from "../../../src/projectRepositoryTypes";
import { createLegacyDatabaseOwner } from "../../../src/legacyDatabaseOwner";
import { createManagedLegacyRepository } from "../../../src/managedLegacyRepository";
import { assertPending, deferred, observe } from "../legacy-quiescence/testFixture";
const options = { backendLabel: 'Synthetic legacy SQLite', runtime: 'native' as const, notes: [] };
const project = { ...sampleProject, id: 'synthetic-legacy-project', name: 'Synthetic legacy project' };
const clientInput = { primaryContactFirstName: 'Synthetic', primaryContactLastName: 'Contact' };
const timestamp = '2026-09-27T00:00:00.000Z';
type SqlCall = {
    kind: 'first' | 'all' | 'run' | 'exec';
    sql: string;
    args: unknown[];
    transaction: boolean;
};
type FakeOptions = {
    before?: (call: SqlCall) => Promise<void>;
    cleanup?: () => Promise<void>;
};
// A protocol fake: it models async connection/transaction lifetimes, not SQLite semantics.
function fakeDatabase(options: FakeOptions = {}) {
    const calls: SqlCall[] = [];
    const events: string[] = [];
    let transactionActive = false;
    let closed = false;
    let closes = 0;
    let statusChecks = 0;
    async function record(kind: SqlCall['kind'], sql: string, args: unknown[], transaction: boolean) {
        assert.equal(closed, false, 'SQL may not use a closed connection');
        const call = { kind, sql: sql.replace(/\s+/g, ' ').trim(), args, transaction };
        assert.doesNotMatch(call.sql, /\b(?:CREATE|ALTER|DROP|VACUUM|ATTACH)\b|PRAGMA\s+user_version\s*=/i, 'the injected legacy repository must not initiate schema migration');
        calls.push(call);
        await options.before?.(call);
    }
    function executor(transaction: boolean) {
        return {
            async execAsync(sql: string) {
                await record('exec', sql, [], transaction);
                assert.fail('unexpected execAsync: injected repository must not initialize or migrate SQLite');
            },
            async runAsync(sql: string, ...args: unknown[]) {
                await record('run', sql, args, transaction);
                return { changes: 1, lastInsertRowId: 1 };
            },
            async getFirstAsync(sql: string, ...args: unknown[]) {
                await record('first', sql, args, transaction);
                const query = sql.replace(/\s+/g, ' ').trim();
                if (query === 'PRAGMA user_version;')
                    return { user_version: 7 };
                if (query.includes('COUNT(*)'))
                    return { count: query.includes('FROM project_records') ? 0 : 1 };
                if (query.includes('SELECT pivot_project_id FROM designs'))
                    return { pivot_project_id: project.id };
                if (query.includes('project_json'))
                    return { project_json: serializeProjectDocument(project) };
                if (query.includes('FROM project_records'))
                    return {
                        id: project.id, client_id: 'client', name: project.name,
                        project_crs: project.projectCrs, unit_system: project.unitSystem,
                        created_at: timestamp, updated_at: timestamp,
                    };
                if (query.includes('FROM clients'))
                    return {
                        id: 'client', display_name: 'Synthetic Contact', sort_name: 'Contact, Synthetic',
                        primary_contact_first_name: 'Synthetic', primary_contact_last_name: 'Contact',
                        created_at: timestamp, updated_at: timestamp,
                    };
                if (/SELECT id FROM (?:field_maps|projects|designs)/.test(query))
                    return { id: args[0] };
                assert.fail(`unhandled synthetic query: ${query}`);
            },
            async getAllAsync(sql: string, ...args: unknown[]) {
                await record('all', sql, args, transaction);
                return [];
            },
        };
    }
    const raw = {
        ...executor(false),
        async withExclusiveTransactionAsync(task: (transaction: ReturnType<typeof executor>) => Promise<void>) {
            assert.equal(transactionActive, false);
            transactionActive = true;
            events.push('transaction:start');
            try {
                await task(executor(true));
                events.push('transaction:callback-done');
            }
            finally {
                try {
                    await options.cleanup?.();
                }
                finally {
                    transactionActive = false;
                    events.push('transaction:cleanup-done');
                }
            }
        },
        async isInTransactionAsync() {
            statusChecks++;
            events.push('status');
            return transactionActive;
        },
        async closeAsync() {
            assert.equal(transactionActive, false, 'close cannot overtake transaction cleanup');
            assert.equal(closed, false, 'connection must close once');
            closes++;
            closed = true;
            events.push('close');
        },
    };
    return {
        // Deliberately implement only the SQLite surface exercised by the actual raw factory.
        database: raw as unknown as SQLiteDatabase,
        calls, events,
        get closes() { return closes; },
        get statusChecks() { return statusChecks; },
    };
}
type Method = Exclude<keyof ProjectRepository, 'backendLabel' | 'versionedWorkspace' | 'describeWorkspace'>;
const invocations = {
    getBackendInfoAsync: r => r.getBackendInfoAsync(),
    listProjectsAsync: r => r.listProjectsAsync(),
    listProjectCatalogAsync: r => r.listProjectCatalogAsync(),
    saveProjectAsync: r => r.saveProjectAsync(project),
    saveDesignProjectAsync: r => r.saveDesignProjectAsync('design', project),
    loadProjectAsync: r => r.loadProjectAsync(project.id),
    loadDesignProjectAsync: r => r.loadDesignProjectAsync('design'),
    deleteProjectAsync: r => r.deleteProjectAsync(project.id),
    createClientAsync: r => r.createClientAsync(clientInput),
    updateClientAsync: r => r.updateClientAsync({ id: 'client', ...clientInput }),
    deleteClientAsync: r => r.deleteClientAsync('client'),
    createProjectWithInitialDesignAsync: r => r.createProjectWithInitialDesignAsync({ clientId: 'client', project }),
    createProjectWithInitialFieldMapAsync: r => r.createProjectWithInitialFieldMapAsync({
        clientId: 'client', projectId: project.id, projectName: project.name,
        projectCrs: project.projectCrs, unitSystem: project.unitSystem,
    }),
    createProjectRecordAsync: r => r.createProjectRecordAsync({
        id: project.id, clientId: 'client', name: project.name,
        projectCrs: project.projectCrs, unitSystem: project.unitSystem,
    }),
    renameProjectAsync: r => r.renameProjectAsync(project.id, 'Renamed synthetic project'),
    moveProjectToClientAsync: r => r.moveProjectToClientAsync(project.id, 'client'),
    createFieldMapRecordAsync: r => r.createFieldMapRecordAsync({ id: 'field', projectId: project.id, name: 'Field' }),
    createDesignRecordAsync: r => r.createDesignRecordAsync({
        id: 'design', fieldMapId: 'field', name: 'Design', pivotProjectId: project.id,
    }),
} satisfies Record<Method, (repository: ProjectRepository) => Promise<unknown>>;
test('managed surface includes exactly the 18 audited public methods', () => {
    const fake = fakeDatabase();
    const owner = createLegacyDatabaseOwner(async () => fake.database);
    const repository = createManagedLegacyRepository(options, owner);
    assert.equal(Object.keys(invocations).length, 18);
    assert.deepEqual(Object.entries(repository).filter(([, value]) => typeof value === 'function')
        .map(([name]) => name).sort(), Object.keys(invocations).sort());
    assert.equal(repository.backendLabel, options.backendLabel);
    assert.deepEqual(fake.calls, []);
});
for (const [method, invoke] of Object.entries(invocations)) {
    test(`${method}: actual raw implementation holds admission through deferred open and rejects after drain`, async () => {
        const fake = fakeDatabase();
        const opening = deferred<SQLiteDatabase>();
        let opens = 0;
        const owner = createLegacyDatabaseOwner(() => { opens++; return opening.promise; });
        const repository = createManagedLegacyRepository(options, owner);
        const operation: Promise<unknown> = invoke(repository);
        const completed = observe(operation);
        assert.equal(owner.activeOperations, 1, `${method} must enter the owner synchronously`);
        const retirement = owner.quiesce();
        const retired = observe(retirement);
        assert.equal(owner.state, 'draining');
        await assert.rejects(invoke(repository), /access is closed/);
        await assertPending(completed);
        await assertPending(retired);
        assert.equal(opens, 1);
        assert.equal(fake.calls.length, 0);
        opening.resolve(fake.database);
        await operation;
        const receipt = await retirement;
        assert.equal(owner.activeOperations, 0);
        assert.equal(fake.closes, 1);
        assert.equal(fake.statusChecks, 1);
        assert.ok(fake.calls.length > 0, `${method} must execute the injected raw factory`);
        assert.equal(fake.calls.some(call => call.kind === 'exec'), false);
        const callsBefore = fake.calls.length;
        owner.consumeQuiescence(receipt);
        await assert.rejects(invoke(repository), /handed_off/);
        assert.equal(fake.calls.length, callsBefore);
        assert.equal(opens, 1);
    });
}
test('nested loadDesign -> loadProject remains admitted after drain begins', async () => {
    const designEntered = deferred<void>();
    const designRead = deferred<void>();
    const projectEntered = deferred<void>();
    const projectRead = deferred<void>();
    const fake = fakeDatabase({ before: async (call) => {
            if (call.sql.includes('SELECT pivot_project_id FROM designs')) {
                designEntered.resolve();
                await designRead.promise;
            }
            else if (call.sql.includes('project_json')) {
                projectEntered.resolve();
                await projectRead.promise;
            }
        } });
    let opens = 0;
    const owner = createLegacyDatabaseOwner(async () => { opens++; return fake.database; });
    const repository = createManagedLegacyRepository(options, owner);
    const operation = repository.loadDesignProjectAsync('design');
    const completed = observe(operation);
    await designEntered.promise;
    const retirement = owner.quiesce();
    const retired = observe(retirement);
    designRead.resolve();
    await projectEntered.promise;
    assert.equal(owner.activeOperations, 1);
    await assertPending(completed);
    await assertPending(retired);
    assert.equal(fake.statusChecks, 0);
    assert.equal(fake.closes, 0);
    projectRead.resolve();
    assert.deepEqual(await operation, parseProjectDocument(serializeProjectDocument(project)));
    await retirement;
    assert.equal(opens, 1);
    assert.equal(fake.closes, 1);
    assert.deepEqual(fake.calls.map(call => call.args), [['design'], [project.id]]);
});
test('saveDesign holds its lease through saveProject statements, transaction cleanup, and the following update', async () => {
    const writeEntered = deferred<void>();
    const writeGate = deferred<void>();
    const cleanupEntered = deferred<void>();
    const cleanupGate = deferred<void>();
    const updateEntered = deferred<void>();
    const updateGate = deferred<void>();
    let firstWrite = true;
    const fake = fakeDatabase({
        before: async (call) => {
            if (call.kind === 'run' && call.transaction && firstWrite) {
                firstWrite = false;
                writeEntered.resolve();
                await writeGate.promise;
            }
            if (call.kind === 'run' && !call.transaction && call.sql.startsWith('UPDATE designs')) {
                updateEntered.resolve();
                await updateGate.promise;
            }
        },
        cleanup: () => { cleanupEntered.resolve(); return cleanupGate.promise; },
    });
    const owner = createLegacyDatabaseOwner(async () => fake.database);
    const repository = createManagedLegacyRepository(options, owner);
    const operation = repository.saveDesignProjectAsync('design', project);
    const completed = observe(operation);
    await writeEntered.promise;
    const retirement = owner.quiesce();
    const retired = observe(retirement);
    await assertPending(completed);
    await assertPending(retired);
    assert.equal(owner.activeOperations, 1);
    assert.equal(fake.statusChecks, 0);
    writeGate.resolve();
    await cleanupEntered.promise;
    await assertPending(completed);
    await assertPending(retired);
    assert.equal(fake.calls.some(call => !call.transaction && call.sql.startsWith('UPDATE designs')), false);
    assert.equal(fake.statusChecks, 0);
    assert.equal(owner.activeOperations, 1);
    cleanupGate.resolve();
    await updateEntered.promise;
    await assertPending(completed);
    await assertPending(retired);
    assert.equal(owner.activeOperations, 1);
    assert.equal(fake.statusChecks, 0);
    assert.equal(fake.closes, 0);
    updateGate.resolve();
    await operation;
    await retirement;
    assert.deepEqual(fake.events, ['transaction:start', 'transaction:callback-done', 'transaction:cleanup-done', 'status', 'close']);
    const update = fake.calls.at(-1)!;
    assert.equal(update.transaction, false);
    assert.match(update.sql, /^UPDATE designs/);
    assert.equal(update.args[0], project.name);
    assert.equal(update.args[1], project.id);
    assert.equal(update.args[3], 'design');
    assert.equal(fake.closes, 1);
});
test('listCatalog returned read promise keeps the lease through the final catalog query', async () => {
    const readEntered = deferred<void>();
    const readGate = deferred<void>();
    const fake = fakeDatabase({ before: async (call) => {
            if (call.kind === 'all' && call.sql.includes('FROM designs')) {
                readEntered.resolve();
                await readGate.promise;
            }
        } });
    const owner = createLegacyDatabaseOwner(async () => fake.database);
    const repository = createManagedLegacyRepository(options, owner);
    const operation = repository.listProjectCatalogAsync();
    const completed = observe(operation);
    await readEntered.promise;
    const retirement = owner.quiesce();
    const retired = observe(retirement);
    await assertPending(completed);
    await assertPending(retired);
    assert.equal(owner.activeOperations, 1);
    assert.equal(fake.statusChecks, 0);
    assert.equal(fake.closes, 0);
    readGate.resolve();
    assert.deepEqual(await operation, { clients: [], projects: [], fieldMaps: [], designs: [] });
    await retirement;
    assert.equal(fake.calls.filter(call => call.kind === 'all').length, 4);
    assert.equal(fake.closes, 1);
});
test('transaction finalization rejection remains fatal after callback completion and prevents the design update', async () => {
    const cleanupEntered = deferred<void>();
    const cleanupGate = deferred<void>();
    const failure = new Error('synthetic native finalization failure');
    const fake = fakeDatabase({
        cleanup: () => { cleanupEntered.resolve(); return cleanupGate.promise; },
    });
    const owner = createLegacyDatabaseOwner(async () => fake.database);
    const repository = createManagedLegacyRepository(options, owner);
    const operation = repository.saveDesignProjectAsync('design', project);
    const rejected = assert.rejects(operation, error => error === failure);
    const completed = observe(operation);
    await cleanupEntered.promise;
    assert.deepEqual(fake.events, ['transaction:start', 'transaction:callback-done']);
    const retirement = owner.quiesce();
    const retirementRejected = assert.rejects(retirement, (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.ok(error.errors.includes(failure));
        return true;
    });
    const retired = observe(retirement);
    await assertPending(completed);
    await assertPending(retired);
    assert.equal(owner.activeOperations, 1);
    assert.equal(fake.statusChecks, 0);
    assert.equal(fake.closes, 0);
    cleanupGate.reject(failure);
    await rejected;
    await retirementRejected;
    assert.equal(owner.activeOperations, 0);
    assert.equal(owner.state, 'recovery_required');
    assert.equal(fake.calls.some(call => !call.transaction && call.sql.startsWith('UPDATE designs')), false);
    assert.deepEqual(fake.events, ['transaction:start', 'transaction:callback-done', 'transaction:cleanup-done', 'status', 'close']);
    assert.equal(owner.quiesce(), retirement);
    await assert.rejects(repository.listProjectsAsync(), /recovery_required/);
    assert.equal(fake.closes, 1);
});
test('constructing and retiring an unused managed repository never opens or initializes SQLite', async () => {
    let opens = 0;
    const fake = fakeDatabase();
    const owner = createLegacyDatabaseOwner(async () => { opens++; return fake.database; });
    createManagedLegacyRepository(options, owner);
    await owner.quiesce();
    assert.equal(opens, 0);
    assert.deepEqual(fake.calls, []);
    assert.deepEqual(fake.events, []);
});
