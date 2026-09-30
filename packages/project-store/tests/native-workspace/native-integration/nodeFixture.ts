// Generated fixture from pinned Expo adapter test harness. Not native filesystem proof.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, rmdirSync, statSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { SQLiteDatabase, SQLiteOpenOptions } from "../../../src/expoSqliteTypes";
import { createExpoBackupPorts, type ArtifactSession, type ExpoSqlitePort } from "../../../src/expoBackupPorts";
import { createNativeBackupOperations } from "../../../src/nativeBackupHost";
import { coordinateUpgrade } from "../../../src/upgradeCoordinator";
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const plan = [
    { id: 1, name: "initial", statements: ["CREATE TABLE schema_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL)", "CREATE TABLE data(value TEXT NOT NULL)"] },
    { id: 2, name: "update", statements: ["ALTER TABLE data ADD COLUMN extra TEXT", "UPDATE data SET value='after'"] },
];
type NodeDb = {
    expo: SQLiteDatabase;
    db: DatabaseSync;
    closed: boolean;
    closes: number;
    failClose: boolean;
};
async function fixture(body: (f: ReturnType<typeof setup>) => Promise<void>) {
    const f = setup();
    try {
        await body(f);
    }
    finally {
        for (const db of f.connections)
            if (!db.closed) {
                db.db.close();
                db.closed = true;
            }
    }
}
export function setup() {
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
    const source = connection(join(root, "source.db"));
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
    return { connection, root, source, connections, opens, events, faults, native, sqlite, adapter, session, makeAdapter, sealed };
}
