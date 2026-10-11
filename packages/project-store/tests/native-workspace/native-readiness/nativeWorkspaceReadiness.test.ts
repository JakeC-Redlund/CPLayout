import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createNativeWorkspaceUpgradeRunner } from "../../../src/nativeWorkspaceUpgrade";
import { verifyNativeWorkspaceSchema } from "../../../src/nativeWorkspaceSchema";
import { createVerifiedNativeWorkspaceHost } from "../../../src/nativeWorkspaceReadiness";
import { createSqliteWorkspaceStore } from "../../../src/sqliteWorkspaceStore";
import { multiplex } from "./nativeRetainedVerifier.test";
import { fixture, seed, options } from "./readinessFixture";
import "./nativeWorkspaceSchema.test";
for (const version of [0, 8, 10, 11]) {
    test("production schema gate admits v" + version + " and normal reads/saves use fresh verification sessions", async () => fixture(async (f) => {
        seed(f, version, "WAL");
        const migrated = await createNativeWorkspaceUpgradeRunner(options(f, { verifyTargetSchema: verifyNativeWorkspaceSchema })).run("first");
        assert.equal(migrated.state, "committed", String(migrated.error));
        const before = readFileSync(migrated.prepared!.backup.identity), m = multiplex(f);
        const host = createVerifiedNativeWorkspaceHost({
            async openReadyConnection() {
                const db = f.connection(f.source.expo.databasePath).expo;
                await db.execAsync("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA read_uncommitted=OFF; PRAGMA ignore_check_constraints=OFF;");
                return db;
            }, captureLegacyRecovery: async (db) => db.getAllAsync("SELECT project_json FROM main.project_snapshots"),
        }, m.options);
        m.options.expectedSourcePath = "/mutated-by-caller.db";
        const store = createSqliteWorkspaceStore(host);
        const initial = await store.readAsync();
        const result = await store.executeAsync(initial.revision, { type: "create_client", id: "new-client", now: "2026-09-27T05:00:00.000Z",
            input: { primaryContactFirstName: "New", primaryContactLastName: "Client" } });
        assert.equal(result.workspace.revision, initial.revision + 1);
        assert.deepEqual(await store.readAsync(), result.workspace);
        assert.equal(m.created, 4);
        assert.equal(m.active, 0);
        assert.equal(m.created, m.released);
        assert.deepEqual(readFileSync(migrated.prepared!.backup.identity), before);
        assert.ok(f.connections.every(c => c.closed));
    }));
}
test("failed source preflight preserves close failure and never begins a transaction", async () => fixture(async (f) => {
    seed(f, 11, "DELETE");
    const migrated = await createNativeWorkspaceUpgradeRunner(options(f, { verifyTargetSchema: verifyNativeWorkspaceSchema })).run("first");
    assert.equal(migrated.state, "committed");
    const m = multiplex(f);
    m.options.expectedSourcePath = "/wrong.db";
    let closes = 0;
    const closeFailure = new Error("close-failure"), commands: string[] = [];
    const host = createVerifiedNativeWorkspaceHost({
        async openReadyConnection() {
            const db = f.connection(f.source.expo.databasePath).expo, close = db.closeAsync.bind(db), exec = db.execAsync.bind(db);
            db.execAsync = async (sql) => { commands.push(sql); await exec(sql); };
            db.closeAsync = async () => { closes++; await close(); throw closeFailure; };
            return db;
        }, captureLegacyRecovery: async () => ({}),
    }, m.options);
    await assert.rejects(createSqliteWorkspaceStore(host).readAsync(), error => {
        assert.ok(error && typeof error === "object" && "original" in error && error.original instanceof AggregateError);
        assert.equal(error.original.errors[1], closeFailure);
        return true;
    });
    assert.equal(closes, 1);
    assert.equal(m.created, 0);
    assert.deepEqual(commands, []);
}));
for (const fault of ["foreign_keys", "synchronous", "read_uncommitted", "ignore_check_constraints", "attached", "wrong-source", "extra-trigger", "journal-off", "journal-memory"] as const) {
    test("ready host rejects " + fault + " before retained verification and workspace mutation", async () => fixture(async (f) => {
        seed(f, 11, "DELETE");
        const migrated = await createNativeWorkspaceUpgradeRunner(options(f, { verifyTargetSchema: verifyNativeWorkspaceSchema })).run("first");
        assert.equal(migrated.state, "committed", String(migrated.error));
        const m = multiplex(f);
        if (fault === "wrong-source")
            m.options.expectedSourcePath = "/another.db";
        const commands: string[] = [];
        const host = createVerifiedNativeWorkspaceHost({
            async openReadyConnection() {
                const connection = f.connection(f.source.expo.databasePath), db = connection.expo;
                await db.execAsync("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA read_uncommitted=OFF; PRAGMA ignore_check_constraints=OFF;");
                if (fault === "foreign_keys")
                    await db.execAsync("PRAGMA foreign_keys=OFF;");
                if (fault === "synchronous")
                    await db.execAsync("PRAGMA synchronous=OFF;");
                if (fault === "read_uncommitted")
                    await db.execAsync("PRAGMA read_uncommitted=ON;");
                if (fault === "ignore_check_constraints")
                    await db.execAsync("PRAGMA ignore_check_constraints=ON;");
                if (fault === "journal-off" || fault === "journal-memory") {
                    const journal = fault === "journal-off" ? "off" : "memory";
                    // Synthetic fault injection only: Node's default defensive mode rejects OFF.
                    if (fault === "journal-off")
                        connection.db.enableDefensive(false);
                    await db.execAsync("PRAGMA main.journal_mode=" + journal);
                    assert.equal((await db.getFirstAsync<{
                        journal_mode: string;
                    }>("PRAGMA main.journal_mode"))?.journal_mode, journal);
                }
                if (fault === "attached")
                    await db.execAsync("ATTACH ':memory:' AS extra;");
                if (fault === "extra-trigger")
                    await db.execAsync("CREATE TRIGGER injected AFTER INSERT ON cplayout_workspace_records BEGIN UPDATE cplayout_workspace_meta SET revision=55; END;");
                const exec = db.execAsync.bind(db);
                db.execAsync = async (sql) => { commands.push(sql); await exec(sql); };
                return db;
            }, captureLegacyRecovery: async () => ({}),
        }, m.options);
        await assert.rejects(createSqliteWorkspaceStore(host).executeAsync(0, { type: "create_client", id: "blocked", now: "2026-09-27T05:00:00.000Z",
            input: { primaryContactFirstName: "Blocked", primaryContactLastName: "Client" } }), error => {
            if (fault === "journal-off" || fault === "journal-memory")
                assert.match(String(error), /Workspace requires WAL, DELETE, TRUNCATE or PERSIST/);
            return true;
        });
        assert.equal(m.created, 0);
        assert.ok(f.connections.every(c => c.closed));
        if (fault === "journal-off" || fault === "journal-memory")
            assert.deepEqual(commands, []);
        const db = new DatabaseSync(f.source.expo.databasePath);
        try {
            assert.equal(db.prepare("SELECT revision FROM cplayout_workspace_meta").get()!.revision, 0);
            assert.equal(db.prepare("SELECT count(*) AS n FROM cplayout_workspace_records WHERE kind='client'").get()!.n, 0);
        }
        finally {
            db.close();
        }
    }));
}
