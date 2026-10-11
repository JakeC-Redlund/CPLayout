import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { defaultProjectSettings, sampleProject, serializeProjectDocument, parseDesignDraftDocument, type DesignDraft } from "../../../../core/src/index";
import { emptyWorkspaceDocument, WorkspaceDocumentError, type WorkspaceDocument } from "../../../src/workspaceDocument";
import { applyWorkspaceCommand, type WorkspaceCommand } from "../../../src/workspaceCommands";
import { assertDeletionContinuity, createSqliteWorkspaceStore, SQLITE_WORKSPACE_SCHEMA, NativeWorkspaceStoreError, NativeWorkspaceCommandRefusal, type WorkspaceDatabase, type NativeWorkspaceHost } from "../../../src/sqliteWorkspaceStore";
const now = "2026-09-27T00:00:00.000Z";
const later = "2026-09-27T00:01:00.000Z";
const client = (id = "client"): WorkspaceCommand => ({ type: "create_client", id, now, input: { primaryContactFirstName: "A", primaryContactLastName: "B" } });
const folder: WorkspaceCommand = { type: "create_project_with_initial_field_map", now,
    input: { clientId: "client", projectId: "folder", projectName: "Folder", fieldMapId: "field", projectCrs: "EPSG:32613", unitSystem: "metric" } };
function draft(id = "draft"): DesignDraft {
    const settings = defaultProjectSettings();
    delete settings.aerialImagery.sourcePackageId;
    return { id, name: "Incomplete", projectCrs: null, settings, unitSystem: settings.unitSystem, fieldBoundary: [],
        pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
}
function catalog(): WorkspaceDocument {
    const value = applyWorkspaceCommand(applyWorkspaceCommand(emptyWorkspaceDocument(), client()).workspace, folder).workspace;
    value.revision = 0;
    return value;
}
const createDraft = (value = draft()): WorkspaceCommand => ({ type: "create_design_draft", now, designId: "design", fieldMapId: "field", name: value.name, draft: value });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
interface Hooks {
    before?(sql: string, params: (string | number)[], raw: DatabaseSync): void | Promise<void>;
    after?(sql: string, params: (string | number)[], raw: DatabaseSync): void | Promise<void>;
    beforeOpen?(): Promise<void>;
    closeError?: boolean;
}
function fixture(admitted = emptyWorkspaceDocument()) {
    const dir = mkdtempSync(join(import.meta.dirname, "case-"));
    const path = join(dir, "workspace.db");
    const original = JSON.stringify(admitted);
    const receipt = JSON.stringify({ source: "synthetic-admitted-source", sha256: sha(original) });
    const setup = new DatabaseSync(path);
    setup.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; CREATE TABLE retained_legacy(id INTEGER PRIMARY KEY,raw TEXT NOT NULL);");
    setup.prepare("INSERT INTO retained_legacy VALUES(1,?)").run(original);
    for (const sql of SQLITE_WORKSPACE_SCHEMA)
        setup.exec(sql);
    setup.close();
    const hooks: Hooks = {};
    const calls: {
        sql: string;
        params: (string | number)[];
    }[] = [];
    const cleanup: unknown[] = [];
    const connections: {
        closed: boolean;
    }[] = [];
    let admissionCount = 0;
    const host: NativeWorkspaceHost = {
        async openReadyConnection() {
            await hooks.beforeOpen?.();
            const raw = new DatabaseSync(path);
            raw.exec("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=20;");
            const state = { closed: false };
            connections.push(state);
            const db: WorkspaceDatabase = {
                async execAsync(sql) { calls.push({ sql, params: [] }); await hooks.before?.(sql, [], raw); raw.exec(sql); await hooks.after?.(sql, [], raw); },
                async getAllAsync<T>(sql: string, ...params: (string | number)[]) {
                    calls.push({ sql, params });
                    await hooks.before?.(sql, params, raw);
                    const rows = raw.prepare(sql).all(...params) as T[];
                    await hooks.after?.(sql, params, raw);
                    return rows;
                },
                async runAsync(sql, ...params) {
                    calls.push({ sql, params });
                    await hooks.before?.(sql, params, raw);
                    const value = raw.prepare(sql).run(...params);
                    await hooks.after?.(sql, params, raw);
                    return { changes: Number(value.changes) };
                },
                async isInTransactionAsync() { return raw.isTransaction; },
                async closeAsync() { raw.close(); state.closed = true; if (hooks.closeError)
                    throw new Error("close reporting failure"); },
            };
            return db;
        },
        async admitLegacy(db) {
            admissionCount++;
            const rows = await db.getAllAsync<{
                raw: string;
            }>("SELECT raw FROM retained_legacy WHERE id=1");
            assert.equal(rows[0].raw, original);
            return { workspace: JSON.parse(rows[0].raw), receipt };
        },
        async verifyAdmission(db, value) {
            assert.equal(value, receipt);
            const rows = await db.getAllAsync<{
                raw: string;
            }>("SELECT raw FROM retained_legacy WHERE id=1");
            if (rows.length !== 1 || sha(rows[0].raw) !== sha(original))
                throw new Error("Legacy source changed; recovery required");
        },
        async captureLegacyRecovery(db) { return { rows: await db.getAllAsync("SELECT * FROM retained_legacy ORDER BY id"), receipt }; },
        reportCleanupError(error) { cleanup.push(error); },
    };
    function inspect<T>(fn: (db: DatabaseSync) => T): T { const db = new DatabaseSync(path); try {
        return fn(db);
    }
    finally {
        db.close();
    } }
    function rawState() {
        return inspect(db => JSON.stringify(SQLITE_WORKSPACE_SCHEMA.slice(0, 3).map((_sql, index) => db.prepare(`SELECT * FROM ${["cplayout_workspace_admissions", "cplayout_workspace_meta", "cplayout_workspace_records"][index]} ORDER BY 1,2`).all())));
    }
    return { dir, path, host, store: createSqliteWorkspaceStore(host), inspect, rawState, hooks, calls, cleanup, connections,
        get admissionCount() { return admissionCount; } };
}
test("reads never initialize or fabricate projects and leave source untouched", async () => {
    const f = fixture();
    const before = f.rawState();
    await assert.rejects(f.store.readAsync(), e => e instanceof NativeWorkspaceStoreError && e.code === "not_initialized");
    assert.equal(f.rawState(), before);
    assert.equal(f.admissionCount, 0);
    assert.ok(f.connections.every(c => c.closed));
});
test("only loaded-revision and validated command refusals receive the safe refusal type", async () => {
    const f = fixture();
    await assert.rejects(f.store.executeAsync(-1, client()), e => e instanceof NativeWorkspaceCommandRefusal);
    assert.equal(f.connections.length, 0);
    await f.store.initializeAdmittedAsync();
    await f.store.executeAsync(0, client());
    await assert.rejects(f.store.executeAsync(0, client("stale")), e => e instanceof NativeWorkspaceCommandRefusal);
    await assert.rejects(f.store.executeAsync(1, client()), e => e instanceof NativeWorkspaceCommandRefusal);
    assert.equal((await f.store.readAsync()).revision, 1);
});
test("stored identity corruption is not mislabeled as a safe command refusal", async () => {
    const input = emptyWorkspaceDocument();
    const project = structuredClone(sampleProject);
    input.projectDocuments.push({ summary: { id: project.id, name: project.name, projectCrs: project.projectCrs,
            unitSystem: project.unitSystem, updatedAt: now }, document: serializeProjectDocument(project) });
    const f = fixture(input);
    await f.store.initializeAdmittedAsync();
    f.inspect(db => {
        const row = db.prepare("SELECT record_json FROM cplayout_workspace_records WHERE kind='project_document'").get()!;
        const record = JSON.parse(String(row.record_json));
        record.summary.name = "Wrong stored name";
        db.prepare("UPDATE cplayout_workspace_records SET record_json=? WHERE kind='project_document'").run(JSON.stringify(record));
    });
    const before = f.rawState();
    await assert.rejects(f.store.executeAsync(0, client()), e => e instanceof WorkspaceDocumentError &&
        e.code === "identity_mismatch" && !(e instanceof NativeWorkspaceCommandRefusal));
    assert.equal(f.rawState(), before);
});
test("schema installation targets main even with pre-existing TEMP workspace tables", () => {
    const db = new DatabaseSync(":memory:");
    try {
        db.exec(`CREATE TEMP TABLE cplayout_workspace_admissions(singleton INTEGER);
      CREATE TEMP TABLE cplayout_workspace_meta(singleton INTEGER);
      CREATE TEMP TABLE cplayout_workspace_records(kind TEXT,position INTEGER);`);
        for (const sql of SQLITE_WORKSPACE_SCHEMA)
            db.exec(sql);
        const index = db.prepare("SELECT tbl_name FROM main.sqlite_schema WHERE type='index' AND name='cplayout_workspace_record_order'").get();
        assert.equal(index?.tbl_name, "cplayout_workspace_records");
        assert.equal(db.prepare("SELECT name FROM temp.sqlite_schema WHERE type='index' AND name='cplayout_workspace_record_order'").all().length, 0);
        for (const name of ["cplayout_workspace_admissions", "cplayout_workspace_meta", "cplayout_workspace_records"]) {
            assert.equal(db.prepare("SELECT type FROM main.sqlite_schema WHERE name=?").get(name)?.type, "table");
        }
    }
    finally {
        db.close();
    }
});
test("empty explicit admission is atomic, repeatable, and creates no defaults", async () => {
    const f = fixture();
    const first = await f.store.initializeAdmittedAsync();
    assert.deepEqual(first, emptyWorkspaceDocument());
    assert.deepEqual(await f.store.initializeAdmittedAsync(), first);
    assert.equal(f.admissionCount, 1);
});
test("TEMP workspace shadows cannot redirect admission, reads, writes or recovery", async () => {
    const f = fixture(), open = f.host.openReadyConnection;
    const tables = ["cplayout_workspace_meta", "cplayout_workspace_admissions", "cplayout_workspace_records"];
    let checkedConnections = 0;
    f.host.openReadyConnection = async () => {
        const db = await open();
        for (const table of tables)
            await db.execAsync(`CREATE TEMP TABLE ${table} AS SELECT * FROM main.${table} WHERE 0;`);
        const close = db.closeAsync;
        db.closeAsync = async () => {
            try {
                for (const table of tables) {
                    const rows = await db.getAllAsync<{
                        count: number;
                    }>(`SELECT count(*) AS count FROM temp.${table};`);
                    assert.equal(rows[0].count, 0);
                }
                checkedConnections++;
            }
            finally {
                await close();
            }
        };
        return db;
    };
    assert.deepEqual(await f.store.initializeAdmittedAsync(), emptyWorkspaceDocument());
    assert.deepEqual(await f.store.readAsync(), emptyWorkspaceDocument());
    const saved = (await f.store.executeAsync(0, client("main-only"))).workspace;
    assert.equal(saved.revision, 1);
    assert.deepEqual(await f.store.readAsync(), saved);
    const recovery = JSON.parse(await f.store.exportRecoveryAsync());
    assert.equal(recovery.metaRows[0].revision, 1);
    assert.equal(recovery.admissionRows.length, 1);
    assert.equal(recovery.recordRows.length, 1);
    assert.equal(recovery.recordRows[0].id, "main-only");
    assert.equal(checkedConnections, 5);
    assert.deepEqual(f.cleanup, []);
    assert.ok(f.connections.every(connection => connection.closed));
});
test("legacy standalone project bytes and catalog order survive SQL admission", async () => {
    const input = catalog();
    const project = { ...structuredClone(sampleProject), id: "standalone" };
    const document = `\n ${serializeProjectDocument(project)}\n`;
    input.projectDocuments.push({ summary: { id: project.id, name: project.name, projectCrs: project.projectCrs, unitSystem: project.unitSystem, updatedAt: now }, document });
    const f = fixture(input);
    assert.deepEqual(await f.store.initializeAdmittedAsync(), input);
    assert.deepEqual(await createSqliteWorkspaceStore(f.host).readAsync(), input);
});
test("incomplete draft saves, reopens, deletes and cannot be resurrected", async () => {
    const f = fixture(catalog());
    await f.store.initializeAdmittedAsync();
    let state = (await f.store.executeAsync(0, createDraft())).workspace;
    for (let count = 0; count < 3; count++) {
        const value = draft();
        value.projectCrs = "EPSG:32613";
        value.fieldBoundary = Array.from({ length: count }, (_, index) => ({ x: 589123 + index, y: 4456789 }));
        value.machine = { spanLengthsMeters: [null, 25, null] };
        state = (await f.store.executeAsync(state.revision, { type: "save_design_draft", now: later, designId: "design", expectedDesignRevision: count, draft: value })).workspace;
        const loaded = await f.store.readDesignAsync("design");
        assert.equal(loaded.kind, "draft");
        if (loaded.kind === "draft")
            assert.deepEqual(loaded.draft, value);
        assert.equal(state.projectDocuments.length, 0);
    }
    state = (await f.store.executeAsync(state.revision, { type: "delete_design", now: later, designId: "design", expectedDesignRevision: 3 })).workspace;
    assert.equal(state.tombstones.length, 2);
    assert.equal(state.draftDocuments.length, 0);
    await assert.rejects(f.store.executeAsync(state.revision, createDraft()), e => e instanceof WorkspaceDocumentError && e.code === "conflict");
    assert.deepEqual(await f.store.readAsync(), state);
});
test("two store instances cannot overwrite the same loaded revision", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    const other = createSqliteWorkspaceStore(f.host);
    await f.store.executeAsync(0, client("winner"));
    const saved = f.rawState();
    await assert.rejects(other.executeAsync(0, client("stale")), e => e instanceof WorkspaceDocumentError && e.code === "conflict");
    assert.equal(f.rawState(), saved);
});
test("command data is captured before waiting for a connection", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    f.hooks.beforeOpen = () => held;
    const command = client("captured");
    const pending = f.store.executeAsync(0, command);
    (command as {
        id: string;
    }).id = "mutated";
    release();
    const saved = await pending;
    assert.equal(saved.workspace.catalog.clients[0].id, "captured");
});
test("rename updates only the affected catalog record and revision", async () => {
    const f = fixture(catalog());
    await f.store.initializeAdmittedAsync();
    await f.store.executeAsync(0, createDraft());
    f.calls.length = 0;
    const saved = await f.store.executeAsync(1, { type: "rename_project", now: later, projectId: "folder", name: "Renamed" });
    assert.equal(saved.workspace.catalog.projects[0].name, "Renamed");
    const writes = f.calls.filter(call => /^(INSERT|UPDATE|DELETE)/.test(call.sql));
    assert.equal(writes.length, 2);
    assert.ok(writes[0].params.includes("project"));
    assert.equal(parseDesignDraftDocument(saved.workspace.draftDocuments[0].document).id, "draft");
});
test("midway compound write failure restores rows and revision", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    await f.store.executeAsync(0, client());
    const before = f.rawState();
    f.hooks.before = (sql, params) => { if (sql.startsWith("INSERT INTO main.cplayout_workspace_records") && params[0] === "field_map")
        throw new Error("injected storage full"); };
    await assert.rejects(f.store.executeAsync(1, folder), /storage full/);
    assert.equal(f.rawState(), before);
    assert.ok(f.connections.every(c => c.closed));
});
test("failure during admission does not leave a committed admission marker", async () => {
    const f = fixture(catalog());
    const before = f.rawState();
    f.hooks.before = sql => { if (sql.startsWith("INSERT INTO main.cplayout_workspace_records"))
        throw new Error("injected write failure"); };
    await assert.rejects(f.store.initializeAdmittedAsync(), /injected/);
    assert.equal(f.rawState(), before);
    f.hooks.before = undefined;
    assert.deepEqual(await f.store.initializeAdmittedAsync(), catalog());
});
test("missing workspace after committed admission cannot remigrate legacy state", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    f.inspect(db => db.exec("DELETE FROM cplayout_workspace_meta"));
    await assert.rejects(f.store.initializeAdmittedAsync(), /previously admitted/);
    assert.equal(f.admissionCount, 1);
});
test("legacy source drift blocks ordinary reads and writes, but not opaque recovery", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    f.inspect(db => db.exec("UPDATE retained_legacy SET raw='changed'"));
    await assert.rejects(f.store.readAsync(), /Legacy source changed/);
    await assert.rejects(f.store.executeAsync(0, client()), /Legacy source changed/);
    const recovery = JSON.parse(await f.store.exportRecoveryAsync());
    assert.equal(recovery.consistency, "sqlite_read_transaction");
    assert.equal(recovery.metaRows.length, 1);
    assert.equal(recovery.legacyEvidence.rows[0].raw, "changed");
});
for (const mutation of [
    "UPDATE cplayout_workspace_records SET record_json='broken' WHERE kind='client'",
    "UPDATE cplayout_workspace_records SET id='other' WHERE kind='client'",
    "UPDATE cplayout_workspace_records SET position=9 WHERE kind='client'",
    "UPDATE cplayout_workspace_meta SET workspace_version='future'",
]) {
    test(`corrupt stored state prevents edits and remains recoverable: ${mutation}`, async () => {
        const f = fixture(catalog());
        await f.store.initializeAdmittedAsync();
        f.inspect(db => db.exec(mutation));
        const before = f.rawState();
        await assert.rejects(f.store.executeAsync(0, { type: "rename_project", now: later, projectId: "folder", name: "No" }));
        assert.equal(f.rawState(), before);
        assert.ok((await f.store.exportRecoveryAsync()).includes("recordRows"));
    });
}
test("silent row-write omission is rejected and rolled back", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    f.inspect(db => db.exec("CREATE TRIGGER ignore_record BEFORE INSERT ON cplayout_workspace_records BEGIN SELECT RAISE(IGNORE); END;"));
    const before = f.rawState();
    await assert.rejects(f.store.executeAsync(0, client()), /exactly/);
    assert.equal(f.rawState(), before);
});
for (const when of ["before", "after"] as const) {
    test(`commit ${when} acknowledgement failure requires reopen instead of retry`, async () => {
        const f = fixture();
        await f.store.initializeAdmittedAsync();
        f.hooks[when] = sql => { if (sql === "COMMIT;")
            throw new Error("lost acknowledgement"); };
        await assert.rejects(f.store.executeAsync(0, client()), e => e instanceof NativeWorkspaceStoreError && e.code === "commit_uncertain");
        f.hooks[when] = undefined;
        assert.equal((await f.store.readAsync()).revision, when === "before" ? 0 : 1);
    });
}
test("cleanup error after successful commit is uncertain and preserves the committed revision", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    f.hooks.closeError = true;
    await assert.rejects(f.store.executeAsync(0, client()), e => e instanceof NativeWorkspaceStoreError && e.code === "commit_uncertain");
    assert.equal(f.cleanup.length, 1);
    f.hooks.closeError = false;
    assert.equal((await f.store.readAsync()).revision, 1);
});
test("revision exhaustion is rejected without changing records", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    f.inspect(db => db.exec(`UPDATE cplayout_workspace_meta SET revision=${Number.MAX_SAFE_INTEGER}`));
    const before = f.rawState();
    await assert.rejects(f.store.executeAsync(Number.MAX_SAFE_INTEGER, client()), e => e instanceof WorkspaceDocumentError && e.code === "revision_exhausted");
    assert.equal(f.rawState(), before);
});
test("deletion continuity rejects removed or rewritten history", () => {
    const old = emptyWorkspaceDocument();
    old.revision = 4;
    old.tombstones.push({ entity: "draft_document", id: "gone", revision: 1, deletedAt: now });
    const removed = structuredClone(old);
    removed.tombstones = [];
    const rewritten = structuredClone(old);
    rewritten.tombstones[0].revision = 2;
    assert.throws(() => assertDeletionContinuity(old, removed), /history/);
    assert.throws(() => assertDeletionContinuity(old, rewritten), /history/);
});
test("read snapshot stays consistent when another connection commits between queries", async () => {
    const f = fixture(catalog());
    const before = await f.store.initializeAdmittedAsync();
    f.hooks.after = sql => {
        if (!sql.startsWith("SELECT singleton,store_version"))
            return;
        f.hooks.after = undefined;
        f.inspect(db => {
            db.exec("BEGIN IMMEDIATE");
            const current = db.prepare("SELECT record_json FROM cplayout_workspace_records WHERE kind='client'").get()!;
            const value = JSON.parse(String(current.record_json));
            value.displayName = "Concurrent edit";
            db.prepare("UPDATE cplayout_workspace_records SET record_json=? WHERE kind='client'").run(JSON.stringify(value));
            db.exec("UPDATE cplayout_workspace_meta SET revision=1; COMMIT");
        });
    };
    assert.deepEqual(await f.store.readAsync(), before);
    const after = await f.store.readAsync();
    assert.equal(after.revision, 1);
    assert.equal(after.catalog.clients[0].displayName, "Concurrent edit");
});
test("concurrent initializers do not duplicate admission or invent an alternate baseline", async () => {
    const f = fixture(catalog());
    const admit = f.host.admitLegacy;
    let reached!: () => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    f.host.admitLegacy = async (db) => { reached(); await held; return admit(db); };
    const first = f.store.initializeAdmittedAsync();
    await entered;
    try {
        await assert.rejects(createSqliteWorkspaceStore(f.host).initializeAdmittedAsync(), /locked/);
    }
    finally {
        release();
    }
    const admitted = await first;
    assert.deepEqual(await createSqliteWorkspaceStore(f.host).initializeAdmittedAsync(), admitted);
    assert.equal(f.admissionCount, 1);
    assert.ok(f.connections.every(c => c.closed));
});
test("missing header with surviving rows cannot be initialized over", async () => {
    const f = fixture(catalog());
    await f.store.initializeAdmittedAsync();
    f.inspect(db => db.exec("PRAGMA foreign_keys=OFF; DELETE FROM cplayout_workspace_meta; DELETE FROM cplayout_workspace_admissions"));
    const before = f.rawState();
    await assert.rejects(f.store.initializeAdmittedAsync(), /without their admission header/);
    assert.equal(f.rawState(), before);
});
test("duplicate JSON in a stored record is not silently normalized", async () => {
    const f = fixture(catalog());
    await f.store.initializeAdmittedAsync();
    f.inspect(db => {
        const row = db.prepare("SELECT record_json FROM cplayout_workspace_records WHERE kind='client'").get()!;
        db.prepare("UPDATE cplayout_workspace_records SET record_json=? WHERE kind='client'").run(String(row.record_json).replace('"id":', '"id":"discarded","id":'));
    });
    const before = f.rawState();
    await assert.rejects(f.store.readAsync(), /unambiguous JSON/);
    assert.equal(f.rawState(), before);
});
test("ignored revision CAS rolls back already-written catalog changes", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    f.inspect(db => db.exec("CREATE TRIGGER ignore_revision BEFORE UPDATE ON cplayout_workspace_meta BEGIN SELECT RAISE(IGNORE); END;"));
    const before = f.rawState();
    await assert.rejects(f.store.executeAsync(0, client()), /compare-and-swap/);
    assert.equal(f.rawState(), before);
});
test("SQL-like and prototype-like identities remain bound string values", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    const ids = ["__proto__", "'; DROP TABLE cplayout_workspace_meta; --"];
    for (let index = 0; index < ids.length; index++)
        await f.store.executeAsync(index, client(ids[index]));
    assert.deepEqual((await f.store.readAsync()).catalog.clients.map(c => c.id), ids);
});
test("a fully populated draft remains a draft, never an implicit project promotion", async () => {
    const f = fixture(catalog());
    await f.store.initializeAdmittedAsync();
    const value: DesignDraft = { ...draft(), projectCrs: sampleProject.projectCrs, fieldBoundary: sampleProject.fieldBoundary,
        pivotCenter: sampleProject.pivotCenter, waterSource: sampleProject.waterSource, powerSource: sampleProject.powerSource, machine: sampleProject.machine };
    const saved = await f.store.executeAsync(0, createDraft(value));
    assert.equal(saved.workspace.projectDocuments.length, 0);
    assert.equal(saved.workspace.catalog.designs[0].kind, "draft");
    assert.equal((await f.store.readDesignAsync("design")).kind, "draft");
});
test("stored XY cannot be relabeled to a different CRS even when an edit clears geometry", async () => {
    const f = fixture(catalog());
    await f.store.initializeAdmittedAsync();
    const value = draft();
    value.projectCrs = "EPSG:32613";
    value.fieldBoundary = [{ x: 589123, y: 4456789 }];
    await f.store.executeAsync(0, createDraft(value));
    const before = f.rawState();
    value.projectCrs = "EPSG:32614";
    value.fieldBoundary = [];
    await assert.rejects(f.store.executeAsync(1, { type: "save_design_draft", now: later, designId: "design", expectedDesignRevision: 0, draft: value }), e => e instanceof WorkspaceDocumentError && e.code === "identity_mismatch");
    assert.equal(f.rawState(), before);
});
test("stale design revision is rejected even with the latest workspace revision", async () => {
    const f = fixture(catalog());
    await f.store.initializeAdmittedAsync();
    await f.store.executeAsync(0, createDraft());
    await f.store.executeAsync(1, { type: "save_design_draft", now: later, designId: "design", expectedDesignRevision: 0, draft: draft() });
    const before = f.rawState();
    await assert.rejects(f.store.executeAsync(2, { type: "save_design_draft", now: later, designId: "design", expectedDesignRevision: 0, draft: draft() }), e => e instanceof WorkspaceDocumentError && e.code === "conflict");
    assert.equal(f.rawState(), before);
});
test("missing admitted header is recovery-required for reads and commands", async () => {
    const f = fixture();
    await f.store.initializeAdmittedAsync();
    f.inspect(db => db.exec("DELETE FROM cplayout_workspace_meta"));
    const before = f.rawState();
    const recoveryRequired = (e: unknown) => e instanceof NativeWorkspaceStoreError && e.code === "recovery_required";
    await assert.rejects(f.store.readAsync(), recoveryRequired);
    await assert.rejects(f.store.executeAsync(0, client()), recoveryRequired);
    assert.equal(f.rawState(), before);
});
