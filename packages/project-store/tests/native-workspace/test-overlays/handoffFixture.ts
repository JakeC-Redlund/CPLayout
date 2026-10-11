// Local adaptation of the prior integration nodeFixture.ts: backup source can be
// rebound to the exact wrapper returned by the leased opener. Prior packets stay untouched.
// Real Node SQLite under simulated Expo/native interfaces; not Android/JNI proof.
import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, rmdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { SQLiteDatabase, SQLiteOpenOptions } from "../../../src/expoSqliteTypes";
import { sampleProject, serializeProjectDocument } from "../../../../core/src/index";
import { SQLITE_MIGRATIONS } from "../../../src/persistenceSchema";
import { createExpoBackupPorts, type ArtifactSession, type ExpoSqlitePort } from "../../../src/expoBackupPorts";
import { receiptFromHex, receiptToHex, type BackupArtifactsModule } from "../../../src/nativeArtifactSession";
import { createLegacyDatabaseOwner } from "../../../src/legacyDatabaseOwner";
import { SOURCE_LEASE_OPTIONS } from "../../../src/nativeSourceLease";
import type { NativeWorkspaceHandoffOptions } from "../../../src/nativeWorkspaceHandoff";
export const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const hash = sha;
const plan = [{ statements: ["CREATE TABLE schema_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL)", "CREATE TABLE data(value TEXT NOT NULL)"] }];
type NodeDb = {
    expo: SQLiteDatabase;
    db: DatabaseSync;
    closed: boolean;
    closes: number;
    failClose: boolean;
};
function createNodeBackupFixture() {
    const root = mkdtempSync(join(import.meta.dirname, "ports-case-")), artifactRoot = join(root, "cplayout-upgrade-artifacts-v1");
    mkdirSync(artifactRoot, { mode: 0o700 });
    const events: string[] = [], connections: NodeDb[] = [], opens: {
        name: string;
        options: SQLiteOpenOptions;
        directory: string;
        db: NodeDb;
    }[] = [];
    let counter = 0;
    const faults: {
        alias?: "object" | "native";
        wrongPath?: boolean;
        shared?: boolean;
        postPath?: boolean;
        close?: boolean;
        backup?: boolean;
        nativeClose?: boolean;
        reuseToken?: boolean;
        inspectionPostPath?: boolean;
        backupWait?: Promise<void>;
    } = {};
    function connection(path: string, options: SQLiteOpenOptions = { useNewConnection: true }): NodeDb {
        const db = new DatabaseSync(path);
        const value = { db, closed: false, closes: 0, failClose: false } as NodeDb;
        value.expo = {
            databasePath: path, options, nativeDatabase: db,
            async execAsync(sql: string) { db.exec(sql); },
            async getAllAsync<T>(sql: string, ...params: string[]) { return db.prepare(sql).all(...params) as T[]; },
            async getFirstAsync<T>(sql: string) { return (db.prepare(sql).get() ?? null) as T | null; },
            async runAsync(sql: string, ...params: (number | string)[]) { return db.prepare(sql).run(...params); },
            async *getEachAsync<T>(sql: string, ...params: string[]) { for (const row of db.prepare(sql).iterate(...params))
                yield row as T; },
            async isInTransactionAsync() { return db.isTransaction; },
            async closeAsync() {
                value.closes++;
                events.push("sql-close:" + path);
                if (!value.closed) {
                    db.close();
                    value.closed = true;
                }
                if (value.failClose)
                    throw new Error("injected SQL close failure");
            },
        } as unknown as SQLiteDatabase;
        connections.push(value);
        return value;
    }
    let source = connection(join(root, "source.db"));
    source.db.exec(plan[0].statements.join(";") + "; INSERT INTO schema_migrations VALUES(1,'initial'); INSERT INTO data VALUES('before'); PRAGMA user_version=1;");
    function session(): ArtifactSession {
        const attempts = new Map<string, {
            path: string;
            ino: number;
            retained: boolean;
        }>();
        const inspections = new Map<string, {
            path: string;
            ino: number;
            retained: string;
            digest: string;
            reads: number;
        }>();
        let released = false;
        const live = () => assert.equal(released, false);
        const getAttempt = (id: string) => { live(); const a = attempts.get(id); assert.ok(a); assert.equal(statSync(a.path).ino, a.ino); return a; };
        return {
            protocolVersion: 1, artifactRoot,
            async allocateAttempt(id) {
                live();
                events.push("allocate");
                const dir = join(artifactRoot, id), path = join(dir, "backup.db");
                mkdirSync(dir, { mode: 0o700 });
                closeSync(openSync(path, "wx", 0o600));
                const token = faults.reuseToken ? "repeat" : "attempt-" + (++counter);
                attempts.set(token, { path, ino: statSync(path).ino, retained: false });
                return token;
            },
            async openRetainedAttempt(id) {
                live();
                const path = join(artifactRoot, id, "backup.db");
                assert.ok(existsSync(join(artifactRoot, id, "prepared.json")));
                const token = "retained-" + (++counter);
                attempts.set(token, { path, ino: statSync(path).ino, retained: true });
                return token;
            },
            async backupPath(id) {
                const a = getAttempt(id);
                events.push("backup-path");
                if (faults.postPath && opens.length)
                    throw new Error("injected post-open path failure");
                return a.path;
            },
            async sealBackup(id) {
                const a = getAttempt(id);
                assert.equal(a.retained, false);
                events.push("seal");
                const bytes = readFileSync(a.path);
                assert.equal(bytes[18], 1);
                assert.equal(bytes[19], 1);
                for (const suffix of ["-wal", "-shm", "-journal"])
                    assert.equal(existsSync(a.path + suffix), false);
                return { path: a.path, sha256: hash(bytes), bytes: bytes.length };
            },
            async verifyAndCopy(id, digest, inspectionId) {
                const a = getAttempt(id);
                assert.equal(hash(readFileSync(a.path)), digest);
                const dir = join(a.path, "..", "inspect-" + inspectionId), path = join(dir, "copy.db");
                mkdirSync(dir);
                copyFileSync(a.path, path);
                const token = "inspect-" + (++counter);
                inspections.set(token, { path, ino: statSync(path).ino, retained: a.path, digest, reads: 0 });
                return token;
            },
            async inspectionPath(id) {
                live();
                const i = inspections.get(id);
                assert.ok(i);
                i.reads++;
                if (faults.inspectionPostPath && i.reads >= 3)
                    throw new Error("injected inspection post-open failure");
                assert.equal(statSync(i.path).ino, i.ino);
                return i.path;
            },
            async closeInspection(id) {
                live();
                events.push("native-close");
                if (faults.nativeClose)
                    throw new Error("injected native close failure");
                const i = inspections.get(id);
                assert.ok(i);
                assert.equal(hash(readFileSync(i.retained)), i.digest);
                unlinkSync(i.path);
                rmdirSync(join(i.path, ".."));
                inspections.delete(id);
            },
            async publishPrepared(id, text) { const a = getAttempt(id); assert.equal(a.retained, false); writeFileSync(join(a.path, "..", "prepared.json"), text, { flag: "wx" }); events.push("publish"); },
            async readPrepared(id) { return readFileSync(join(getAttempt(id).path, "..", "prepared.json"), "utf8"); },
            async release() { live(); events.push("release"); released = true; attempts.clear(); inspections.clear(); },
        };
    }
    const sqlite: ExpoSqlitePort = {
        async openDatabaseAsync(name, options, directory) {
            events.push("sql-open");
            if (faults.alias === "object")
                return source.expo;
            if (faults.alias === "native")
                return { ...source.expo, databasePath: join(directory, name), options } as SQLiteDatabase;
            const db = connection(join(directory, name), faults.shared ? { useNewConnection: false } : options);
            db.failClose = !!faults.close;
            opens.push({ name, options, directory, db });
            return faults.wrongPath ? { ...db.expo, databasePath: "/foreign.db" } as SQLiteDatabase : db.expo;
        },
        async backupDatabaseAsync(options) {
            events.push("backup");
            assert.equal(options.sourceDatabase, source.expo);
            assert.equal(options.destDatabase, opens.find(open => open.db.expo === options.destDatabase)?.db.expo);
            assert.equal(options.sourceDatabaseName, "main");
            assert.equal(options.destDatabaseName, "main");
            await faults.backupWait;
            if (faults.backup)
                throw new Error("injected backup failure");
            await backup(source.db, options.destDatabase.databasePath);
        },
    };
    const native = session();
    const makeAdapter = (sessionValue = native, sourceValue: SQLiteDatabase | null = source.expo) => createExpoBackupPorts({ native: sessionValue, sqlite, source: sourceValue ?? undefined, newInspectionId: () => "probe-" + (++counter) });
    const adapter = makeAdapter();
    async function sealed() {
        const a = await adapter.ports.allocateAttempt("attempt"), db = await adapter.ports.openDestination(a);
        await adapter.ports.backupDatabase(source.expo, db);
        await db.getFirstAsync("PRAGMA user_version");
        await db.execAsync("PRAGMA journal_mode=DELETE");
        await db.closeAsync();
        return { a, db, artifact: await adapter.ports.sealBackup(a) };
    }
    return { connection, root, get source() { return source; }, setBackupSource(value: NodeDb) { source = value; }, connections, opens, events, faults, native, sqlite, adapter, session, makeAdapter, sealed };
}
export function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
}
export async function until(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) {
        if (predicate())
            return;
        await new Promise<void>(resolve => setImmediate(resolve));
    }
    assert.fail("Handoff did not reach the expected state");
}
export type HandoffFaults = {
    legacyOpen?: boolean;
    constructorFailure?: boolean;
    init?: boolean;
    wrapper?: boolean;
    close?: boolean;
    assertAt?: number;
    identityAt?: number;
    identityPart?: "path" | "device" | "inode";
    schemaInvalid?: boolean;
    commitAcknowledgment?: boolean;
    rollback?: boolean;
};
export async function setupHandoffFixture(config: {
    journal?: "DELETE" | "WAL";
    primeLegacy?: boolean;
} = {}) {
    const base = createNodeBackupFixture();
    const path = base.source.expo.databasePath;
    const journal = config.journal ?? "DELETE";
    const now = "2026-09-27T05:00:00.000Z";
    base.source.db.exec("DROP TABLE data; DROP TABLE schema_migrations; PRAGMA user_version=0; PRAGMA journal_mode=" + journal + "; PRAGMA wal_autocheckpoint=0;");
    for (const migration of SQLITE_MIGRATIONS) {
        for (const sql of migration.statements)
            base.source.db.exec(sql);
        base.source.db.prepare("INSERT INTO schema_migrations(id,name) VALUES(?,?)").run(migration.id, migration.name);
        base.source.db.exec("PRAGMA user_version=" + migration.id);
    }
    const document = "\n " + serializeProjectDocument(sampleProject) + "\n";
    base.source.db.prepare("INSERT INTO projects(id,name,project_crs,unit_system,source_json_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(sampleProject.id, sampleProject.name, sampleProject.projectCrs, sampleProject.unitSystem, "pivot-project-v1", now, now);
    base.source.db.prepare("INSERT INTO project_snapshots VALUES(?,?,?)").run(sampleProject.id, document, now);
    base.source.db.exec("CREATE TABLE unknown_evidence(id INTEGER PRIMARY KEY,value BLOB); INSERT INTO unknown_evidence VALUES(1,X'00FF'); CREATE INDEX unknown_evidence_idx ON unknown_evidence(value);");
    await base.source.expo.closeAsync();
    base.events.length = 0;
    const faults: HandoffFaults = {};
    const handles: FakeNative[] = [];
    const wrappers: SQLiteDatabase[] = [];
    let counter = 0;
    function makeLegacyOwner() {
        let connection: NodeDb | undefined;
        const owner = createLegacyDatabaseOwner(async () => {
            base.events.push("legacy-open");
            if (faults.legacyOpen)
                throw new Error("legacy-open-failure");
            connection = base.connection(path);
            const close = connection.expo.closeAsync.bind(connection.expo);
            connection.expo.closeAsync = async () => { base.events.push("legacy-close"); await close(); };
            return connection.expo;
        });
        return { owner, get connection() { return connection; } };
    }
    let currentLegacy = makeLegacyOwner();
    class FakeNative {
        readonly connection: NodeDb;
        assertions = 0;
        closeCalls = 0;
        readonly identities: {
            path: string;
            device: string;
            inode: string;
        }[] = [];
        constructor(actual: string, options: typeof SOURCE_LEASE_OPTIONS) {
            base.events.push("source-construct");
            assert.equal(actual, path);
            assert.equal(options, SOURCE_LEASE_OPTIONS);
            assert.deepEqual(options, { cplayoutExistingOnly: true, cplayoutSourceLease: true,
                useNewConnection: true, enableChangeListener: false, finalizeUnusedStatementsBeforeClosing: true });
            assert.ok(Object.isFrozen(options));
            assert.equal(currentLegacy.owner.state, "handed_off", "receipt must be consumed before allocating the source");
            if (currentLegacy.connection)
                assert.ok(currentLegacy.connection.closed, "legacy must close before the fresh native source opens");
            if (faults.constructorFailure)
                throw new Error("ordinary-constructor-failure");
            assert.ok(existsSync(path), "existing-only must not create a missing source");
            this.connection = base.connection(path, options);
            handles.push(this);
        }
        async initAsync() {
            base.events.push("source-init");
            if (faults.init)
                throw new Error("source-init-failure");
            if (faults.schemaInvalid)
                this.connection.db.exec("CREATE TEMP TABLE unexpected(value TEXT)");
        }
        async assertSourceLeaseAsync() {
            this.assertions++;
            base.events.push("source-assert:" + this.assertions);
            if (faults.assertAt === this.assertions)
                throw new Error("source-assert-failure");
            assert.equal(this.connection.closed, false);
            const stat = statSync(path, { bigint: true });
            const value = { path, device: String(stat.dev), inode: String(stat.ino) };
            if (faults.identityAt === this.assertions) {
                const part = faults.identityPart ?? "inode";
                value[part] = part === "path" ? path + ".foreign" : String(BigInt(value[part]) + 1n);
            }
            this.identities.push(value);
            return value;
        }
        async closeAsync() {
            this.closeCalls++;
            base.events.push("source-close");
            this.connection.failClose = !!faults.close;
            await this.connection.expo.closeAsync();
        }
    }
    // Return the exact fake Expo wrapper used by the real backup fixture, with its
    // native bridge handle intact. SQL itself always runs on Node DatabaseSync.
    class FakeSQLiteDatabase {
        constructor(actual: string, options: typeof SOURCE_LEASE_OPTIONS, native: FakeNative) {
            base.events.push("source-wrapper");
            assert.equal(actual, path);
            assert.equal(options, SOURCE_LEASE_OPTIONS);
            if (faults.wrapper)
                throw new Error("source-wrapper-failure");
            const raw = native.connection.expo;
            const wrapper = { ...raw, nativeDatabase: native,
                closeAsync: () => native.closeAsync(),
                async execAsync(sql: string) {
                    base.events.push("source-sql:" + sql);
                    if (faults.rollback && sql === "ROLLBACK;")
                        throw new Error("rollback-failure");
                    await raw.execAsync(sql);
                    if (faults.commitAcknowledgment && sql === "COMMIT;")
                        throw new Error("commit-acknowledgment-failure");
                },
            } as unknown as SQLiteDatabase;
            wrappers.push(wrapper);
            base.setBackupSource({ ...native.connection, expo: wrapper });
            return wrapper;
        }
    }
    const source = {
        platform: "android" as unknown,
        nativeModule: { cplayoutExistingOnlyVersion: 1 as unknown, cplayoutSourceLeaseVersion: 1 as unknown,
            NativeDatabase: FakeNative },
        SQLiteDatabase: FakeSQLiteDatabase,
    } as unknown as NativeWorkspaceHandoffOptions["source"];
    function makeModule(): BackupArtifactsModule {
        const native = base.session();
        let active = false;
        const check = (id: string) => { assert.equal(id, "session"); assert.ok(active); };
        return {
            protocolVersion: 1,
            async createSession() {
                assert.equal(active, false);
                active = true;
                base.events.push("create-session");
                return { protocolVersion: 1, sessionId: "session", artifactRoot: native.artifactRoot };
            },
            async allocateAttempt(s, id) { check(s); return native.allocateAttempt(id); },
            async openRetainedAttempt(s, id) { check(s); return native.openRetainedAttempt(id); },
            async backupPath(s, h) { check(s); return native.backupPath(h); },
            async sealBackup(s, h) { check(s); return native.sealBackup(h); },
            async verifyAndCopy(s, h, d, id) { check(s); return native.verifyAndCopy(h, d, id); },
            async inspectionPath(s, h) { check(s); return native.inspectionPath(h); },
            async closeInspection(s, h) { check(s); return native.closeInspection(h); },
            async publishPreparedHex(s, h, hex) { check(s); base.events.push("publish-hex"); return native.publishPrepared(h, receiptFromHex(hex)); },
            async readPreparedHex(s, h) { check(s); return receiptToHex(await native.readPrepared(h)); },
            async releaseSession(s) { check(s); await native.release(); active = false; },
        };
    }
    function options(overrides: Partial<NativeWorkspaceHandoffOptions> = {}): NativeWorkspaceHandoffOptions {
        return { module: makeModule(), sqlite: base.sqlite, sourceIdentity: path, expectedSourcePath: path,
            legacy: currentLegacy.owner, source, sha256: async (text) => sha(text),
            newInspectionId: () => "handoff-copy-" + (++counter), ...overrides };
    }
    if (config.primeLegacy !== false)
        await currentLegacy.owner.run(open => open());
    return { base, path, document, faults, handles, wrappers, source, options,
        get owner() { return currentLegacy.owner; },
        get legacyAllocated() { return currentLegacy.connection !== undefined; },
        get legacy() { assert.ok(currentLegacy.connection); return currentLegacy.connection; },
        async freshLegacy(prime = true) {
            currentLegacy = makeLegacyOwner();
            if (prime)
                await currentLegacy.owner.run(open => open());
            return currentLegacy.owner;
        },
        cleanup() {
            for (const connection of base.connections)
                if (!connection.closed) {
                    connection.db.close();
                    connection.closed = true;
                }
        },
    };
}
export type HandoffFixture = Awaited<ReturnType<typeof setupHandoffFixture>>;
export async function withHandoffFixture(body: (fixture: HandoffFixture) => Promise<void>, config: Parameters<typeof setupHandoffFixture>[0] = {}) {
    const fixture = await setupHandoffFixture(config);
    try {
        await body(fixture);
    }
    finally {
        fixture.cleanup();
    }
}
