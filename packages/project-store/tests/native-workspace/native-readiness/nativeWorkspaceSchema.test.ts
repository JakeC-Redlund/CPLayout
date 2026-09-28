import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_MIGRATIONS } from "../../../src/persistenceSchema";
import { WORKSPACE_MIGRATION, workspaceMigrationPlan } from "../../../src/nativeWorkspaceBinding";
import { installLegacyWriteFence, verifyLegacyWriteFence } from "../../../src/legacyWriteFence";
import { generateNativeWorkspaceSchemaManifest } from "./generateSchemaManifest";
import { NATIVE_WORKSPACE_SCHEMA_MANIFEST as manifest } from "../../../src/schemaManifest";
import { verifyNativeWorkspaceSchema, NativeWorkspaceSchemaError, type NativeWorkspaceSchemaDatabase } from "../../../src/nativeWorkspaceSchema";
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
function fixture(transform: (sql: string) => string = sql => sql, prefix = "") {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON;");
    if (prefix)
        db.exec(prefix);
    for (const migration of workspaceMigrationPlan()) {
        for (const sql of migration.statements) {
            const changed = transform(sql);
            if (changed)
                db.exec(changed);
        }
        db.prepare("INSERT INTO main.schema_migrations(id,name) VALUES(?,?);").run(migration.id, migration.name);
        db.exec(`PRAGMA main.user_version=${migration.id};`);
    }
    const calls: string[] = [];
    const reader: NativeWorkspaceSchemaDatabase = {
        async isInTransactionAsync() { return db.isTransaction; },
        async getAllAsync<T>(sql: string) { calls.push(sql); return db.prepare(sql).all() as T[]; },
    };
    return { db, reader, calls };
}
function sourceSnapshot(db: DatabaseSync) {
    const schema = db.prepare("SELECT * FROM main.sqlite_schema ORDER BY name,type;").all();
    const tables = schema.filter(row => row.type === "table");
    return plain({ schema, contents: tables.map(row => ({ name: row.name,
            rows: db.prepare(`SELECT * FROM main.${quote(String(row.name))};`).all() })),
        version: db.prepare("PRAGMA main.user_version;").all(),
        schemaVersion: db.prepare("PRAGMA main.schema_version;").all(),
        changes: db.prepare("SELECT total_changes() AS changes;").all(),
        isolation: db.prepare("PRAGMA read_uncommitted;").all(),
        foreignKeys: db.prepare("PRAGMA foreign_keys;").all(),
        queryOnly: db.prepare("PRAGMA query_only;").all() });
}
test("manifest exactly matches replay of current trusted migrations in synthetic SQLite", () => {
    assert.deepEqual(plain(manifest), plain(generateNativeWorkspaceSchemaManifest()));
    assert.ok(manifest.objects.some(row => row.name.startsWith("sqlite_autoindex_") && row.sql === null));
    assert.ok(!manifest.objects.some(row => "rootpage" in row));
    assert.ok(Object.isFrozen(manifest) && Object.isFrozen(manifest.objects));
    assert.ok(manifest.objects.every(Object.isFrozen));
});
test("valid query-only read retains source, transaction and usable connection", async () => {
    const { db, reader, calls } = fixture();
    try {
        db.exec("PRAGMA query_only=ON; BEGIN DEFERRED;");
        const before = sourceSnapshot(db);
        await verifyNativeWorkspaceSchema(reader);
        assert.deepEqual(sourceSnapshot(db), before);
        assert.equal(db.isTransaction, true);
        assert.ok(calls.length > 3);
        assert.ok(calls.every(sql => sql.startsWith("SELECT ") || /^PRAGMA (read_uncommitted|main\.user_version);$/.test(sql)));
        db.exec("ROLLBACK;");
        assert.equal(db.prepare("SELECT 1 AS alive;").get()?.alive, 1);
    }
    finally {
        db.close();
    }
});
test("legacy fence guards and unknown retained tables/indexes are left to binding verifier", async () => {
    const { db, reader } = fixture();
    try {
        db.exec("CREATE TABLE vendor_retained(id TEXT PRIMARY KEY, evidence TEXT); CREATE INDEX vendor_lookup ON vendor_retained(evidence); BEGIN;");
        const fenceDb = { ...reader,
            async execAsync(sql: string) { db.exec(sql); },
            async runAsync(sql: string, ...params: (string | number)[]) { return { changes: Number(db.prepare(sql).run(...params).changes) }; },
            async closeAsync() { throw new Error("Fence verifier must not close the source"); },
        };
        const fence = await installLegacyWriteFence(fenceDb);
        const before = sourceSnapshot(db);
        await verifyNativeWorkspaceSchema(reader);
        await verifyLegacyWriteFence(fenceDb, fence);
        assert.deepEqual(sourceSnapshot(db), before);
        // This is intentionally outside the schema gate's authority.
        db.exec("DROP TRIGGER main.cplayout_legacy_guard_0_insert;");
        await verifyNativeWorkspaceSchema(reader);
        await assert.rejects(verifyLegacyWriteFence(fenceDb, fence), /legacy guard/i);
    }
    finally {
        db.close();
    }
});
test("different physical root pages do not change schema acceptance", async () => {
    const { db, reader } = fixture(sql => sql, "CREATE TABLE retained_before_migrations(id INTEGER PRIMARY KEY);");
    try {
        db.exec("BEGIN;");
        await verifyNativeWorkspaceSchema(reader);
    }
    finally {
        db.close();
    }
});
test("unpinned caller is rejected before any schema reads", async () => {
    const { db, reader, calls } = fixture();
    try {
        await assert.rejects(verifyNativeWorkspaceSchema(reader), /pinned transaction/);
        assert.deepEqual(calls, []);
        assert.equal(db.isTransaction, false);
    }
    finally {
        db.close();
    }
});
test("loss of caller transaction during read is rejected", async () => {
    const { db, reader } = fixture();
    try {
        db.exec("BEGIN;");
        await assert.rejects(verifyNativeWorkspaceSchema({ ...reader,
            async getAllAsync<T>(sql: string) {
                const result = await reader.getAllAsync<T>(sql);
                db.exec("ROLLBACK;");
                return result;
            },
        }), /pinned transaction/);
    }
    finally {
        db.close();
    }
});
test("read errors propagate without taking transaction ownership", async () => {
    const { db, reader } = fixture();
    try {
        db.exec("BEGIN;");
        const error = new Error("injected read failure");
        await assert.rejects(verifyNativeWorkspaceSchema({ ...reader, async getAllAsync() { throw error; } }), candidate => candidate === error);
        assert.equal(db.isTransaction, true);
    }
    finally {
        db.close();
    }
});
test("read-uncommitted isolation is rejected without changing it", async () => {
    const { db, reader } = fixture();
    try {
        db.exec("PRAGMA read_uncommitted=ON; BEGIN;");
        await assert.rejects(verifyNativeWorkspaceSchema(reader), /isolation/);
        assert.equal(db.prepare("PRAGMA read_uncommitted;").get()?.read_uncommitted, 1);
    }
    finally {
        db.close();
    }
});
const malformedSchemas: [
    string,
    string,
    string
][] = [
    ["singleton CHECK", "CHECK(singleton=1)", "CHECK(singleton>=1)"],
    ["revision CHECK", "CHECK(revision BETWEEN 0 AND 9007199254740991)", ""],
    ["position CHECK", "CHECK(position BETWEEN 0 AND 9007199254740991)", "CHECK(position>=0)"],
    ["workspace CHECK", "CHECK(workspace_id=1)", ""],
    ["NOT NULL", "record_json TEXT NOT NULL", "record_json TEXT"],
    ["column type", "record_json TEXT NOT NULL", "record_json BLOB NOT NULL"],
    ["composite PRIMARY KEY", "PRIMARY KEY(kind,id)", "PRIMARY KEY(id,kind)"],
    ["foreign key", "REFERENCES cplayout_workspace_meta(singleton)", "REFERENCES cplayout_workspace_admissions(singleton)"],
    ["kind CHECK", "'client','project'", "'unexpected','project'"],
    ["receipt PRIMARY KEY", "attempt_id TEXT PRIMARY KEY NOT NULL", "attempt_id TEXT NOT NULL"],
    ["legacy foreign key action", "REFERENCES projects(id) ON DELETE CASCADE", "REFERENCES projects(id) ON DELETE RESTRICT"],
];
for (const [name, original, replacement] of malformedSchemas) {
    test(`rejects changed ${name} despite correct version and ledger`, async () => {
        let replacements = 0;
        const { db, reader } = fixture(sql => {
            if (sql.includes(original)) {
                replacements++;
                return sql.replace(original, replacement);
            }
            return sql;
        });
        try {
            assert.ok(replacements > 0);
            db.exec("BEGIN;");
            const before = sourceSnapshot(db);
            await assert.rejects(verifyNativeWorkspaceSchema(reader), NativeWorkspaceSchemaError);
            assert.deepEqual(sourceSnapshot(db), before);
            assert.equal(db.isTransaction, true);
        }
        finally {
            db.close();
        }
    });
}
const tampering: [
    string,
    string,
    RegExp
][] = [
    ["missing table", "DROP TABLE cplayout_workspace_binding;", /mandatory object/],
    ["wrong table name", "ALTER TABLE cplayout_workspace_binding RENAME TO wrong_binding;", /mandatory object/],
    ["wrong case", "ALTER TABLE cplayout_workspace_binding RENAME TO interim; ALTER TABLE interim RENAME TO CPLAYOUT_WORKSPACE_BINDING;", /mandatory object/],
    ["view replacing table", "DROP TABLE cplayout_workspace_binding; CREATE VIEW cplayout_workspace_binding AS SELECT 1 AS singleton, 'fake' AS receipt_json;", /mandatory object/],
    ["missing workspace index", "DROP INDEX cplayout_workspace_record_order;", /mandatory object/],
    ["wrong index order", "DROP INDEX cplayout_workspace_record_order; CREATE INDEX cplayout_workspace_record_order ON cplayout_workspace_records(position,kind);", /mandatory object/],
    ["partial index", "DROP INDEX cplayout_workspace_record_order; CREATE INDEX cplayout_workspace_record_order ON cplayout_workspace_records(kind,position) WHERE position>0;", /mandatory object/],
    ["wrong index target", "DROP INDEX cplayout_workspace_record_order; CREATE INDEX cplayout_workspace_record_order ON clients(id);", /mandatory object/],
    ["wrong index name", "DROP INDEX cplayout_workspace_record_order; CREATE INDEX wrong_index ON cplayout_workspace_records(kind,position);", /mandatory object/],
    ["missing legacy index", "DROP INDEX idx_clients_sort;", /mandatory object/],
    ["extra workspace index", "CREATE UNIQUE INDEX unexpected_unique ON cplayout_workspace_records(position);", /unexpected index/],
    ["extra binding index", "CREATE INDEX unexpected_binding ON cplayout_workspace_binding(receipt_json);", /unexpected index/],
    ["extra fence index", "CREATE INDEX unexpected_fence ON cplayout_legacy_fence(manifest_json);", /unexpected index/],
    ["extra receipt index", "CREATE INDEX unexpected_receipt ON cplayout_upgrade_receipts(receipt_json);", /unexpected index/],
    ["TEMP shadow", "CREATE TEMP TABLE cplayout_workspace_meta(singleton,revision);", /TEMP/],
    ["TEMP legacy shadow", "CREATE TEMP VIEW clients AS SELECT 'spoof' AS id;", /TEMP/],
    ["TEMP ledger shadow", "CREATE TEMP TABLE schema_migrations(id,name);", /TEMP/],
    ["TEMP mutating trigger", "CREATE TEMP TRIGGER injection AFTER INSERT ON main.cplayout_workspace_records BEGIN UPDATE cplayout_workspace_meta SET revision=0; END;", /TEMP/],
    ["TEMP trigger on retained table", "CREATE TEMP TRIGGER injection AFTER INSERT ON main.clients BEGIN DELETE FROM cplayout_workspace_records; END;", /TEMP/],
    ["unknown TEMP helper", "CREATE TEMP TABLE helper(value);", /TEMP/],
    ["older version", "PRAGMA main.user_version=11;", /user_version/],
    ["future version", "PRAGMA main.user_version=13;", /user_version/],
    ["negative version", "PRAGMA main.user_version=-1;", /user_version/],
    ["missing ledger row", "DELETE FROM schema_migrations WHERE id=12;", /ledger/],
    ["wrong ledger name", "UPDATE schema_migrations SET name='untrusted' WHERE id=12;", /ledger/],
    ["extra ledger row", "INSERT INTO schema_migrations(id,name) VALUES(13,'untrusted');", /ledger/],
];
for (const table of ["schema_migrations", "cplayout_workspace_binding", "cplayout_workspace_meta",
    "cplayout_workspace_records", "cplayout_workspace_admissions", "cplayout_upgrade_receipts", "cplayout_legacy_fence"]) {
    tampering.push([`injected trigger on ${table}`, `CREATE TRIGGER injected AFTER INSERT ON ${table} BEGIN DELETE FROM cplayout_workspace_records; END;`, /unexpected trigger/]);
}
for (const [name, sql, error] of tampering) {
    test(`rejects ${name} without repairing or altering source`, async () => {
        const { db, reader } = fixture();
        try {
            db.exec(sql);
            db.exec("BEGIN;");
            const before = sourceSnapshot(db);
            await assert.rejects(verifyNativeWorkspaceSchema(reader), error);
            assert.deepEqual(sourceSnapshot(db), before);
            assert.equal(db.isTransaction, true);
        }
        finally {
            db.close();
        }
    });
}
test("known historical ledger labels remain accepted", async () => {
    const { db, reader } = fixture();
    try {
        db.exec("UPDATE schema_migrations SET name=replace(name,'client','customer') WHERE id IN (5,6,7); BEGIN;");
        await verifyNativeWorkspaceSchema(reader);
    }
    finally {
        db.close();
    }
});
for (const part of ["legacy statement", "workspace statement", "data step", "migration name"] as const) {
    test(`manifest binding rejects current migration ${part} drift before source queries`, async () => {
        const { db, reader, calls } = fixture();
        const legacyStatements = SQLITE_MIGRATIONS[0].statements;
        const workspaceStatements = WORKSPACE_MIGRATION.statements;
        const step = WORKSPACE_MIGRATION.dataStep;
        const name = WORKSPACE_MIGRATION.name;
        try {
            db.exec("BEGIN;");
            if (part === "legacy statement")
                SQLITE_MIGRATIONS[0].statements = [...legacyStatements, "CREATE TABLE drift(id);"];
            if (part === "workspace statement")
                WORKSPACE_MIGRATION.statements = [...workspaceStatements, "CREATE TABLE drift(id);"];
            if (part === "data step")
                WORKSPACE_MIGRATION.dataStep = "different-data-step";
            if (part === "migration name")
                WORKSPACE_MIGRATION.name = "different-name";
            await assert.rejects(verifyNativeWorkspaceSchema(reader), /migration plan drift/);
            assert.deepEqual(calls, []);
        }
        finally {
            SQLITE_MIGRATIONS[0].statements = legacyStatements;
            WORKSPACE_MIGRATION.statements = workspaceStatements;
            WORKSPACE_MIGRATION.dataStep = step;
            WORKSPACE_MIGRATION.name = name;
            db.close();
        }
    });
}
