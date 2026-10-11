import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SQLITE_MIGRATIONS } from "../../../src/persistenceSchema";
import type { UpgradeDatabase } from "../../../src/upgradeCoordinator";
export const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const version = (db: DatabaseSync) => db.prepare("PRAGMA user_version").get()!.user_version;
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export const json = (value: unknown) => JSON.stringify(value, (_key, v) => {
    if (typeof v === "bigint")
        return { integer: v.toString() };
    if (typeof v === "number" && !Number.isFinite(v))
        return { real: String(v) };
    return v;
});
const expectedSchema = (() => {
    const db = new DatabaseSync(":memory:");
    try {
        for (const migration of SQLITE_MIGRATIONS)
            for (const sql of migration.statements)
                db.exec(sql);
        return db.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name").all();
    }
    finally {
        db.close();
    }
})();
export async function verifyTargetSchema(connection: UpgradeDatabase) {
    const rows = await connection.getAllAsync<{
        name: string;
    }>("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name");
    for (const expected of expectedSchema)
        assert.deepEqual(rows.find(row => row.name === expected.name), expected, `Required schema ${expected.name}`);
}
export function snapshot(db: DatabaseSync) {
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name").all();
    const tableKinds = db.prepare("PRAGMA main.table_list").all();
    const applicationId = db.prepare("PRAGMA main.application_id").get()!.application_id;
    return json({ version: version(db), applicationId, schema, tables: schema.filter(row => row.type === "table").map(row => {
            const table = quote(String(row.name));
            const columns = db.prepare(`PRAGMA main.table_xinfo(${table})`).all().map(column => String(column.name).toLowerCase());
            const withoutRowId = tableKinds.find(kind => kind.name === row.name)?.wr === 1;
            const rowIdName = ["rowid", "_rowid_", "oid"].find(name => !columns.includes(name));
            if (!withoutRowId && !rowIdName)
                throw new Error("Cannot verify hidden rowids with all aliases shadowed.");
            let rowIdAlias = "__cplayout_snapshot_rowid__";
            while (columns.includes(rowIdAlias))
                rowIdAlias += "_";
            const projection = withoutRowId ? "*" : `${quote(rowIdName!)} AS ${quote(rowIdAlias)},*`;
            const query = db.prepare(`SELECT ${projection} FROM main.${table}`);
            query.setReadBigInts(true);
            return [row.name, query.all().map(json).sort()];
        }) });
}
export function seed(path: string, to: number, journal: "WAL" | "DELETE" = "WAL") {
    const db = new DatabaseSync(path);
    try {
        db.exec(`PRAGMA journal_mode=${journal}; PRAGMA foreign_keys=ON;`);
        for (const migration of SQLITE_MIGRATIONS.filter(m => m.id <= to)) {
            for (const sql of migration.statements)
                db.exec(sql);
            db.prepare("INSERT INTO schema_migrations (id,name) VALUES (?,?)").run(migration.id, migration.name);
            db.exec(`PRAGMA user_version=${migration.id};`);
        }
        if (to > 0)
            db.exec("CREATE TABLE retained_unknown (id INTEGER PRIMARY KEY,value TEXT,payload BLOB); INSERT INTO retained_unknown VALUES (1,'before',X'00FF');");
        if (to >= 4 && to < 10) {
            db.exec(`INSERT INTO projects VALUES ('p','Field','EPSG:32613','metric','1','2026-09-27','2026-09-27',NULL);
        INSERT INTO layout_evidence VALUES ('e','p','manual','EPSG:32613',1,'pending','{}','2026-09-27',NULL);
        INSERT INTO model_recommendations VALUES ('r','p','test','1','EPSG:32613',1,'pending',NULL,'{}','2026-09-27');
        INSERT INTO layout_decisions VALUES ('d','p','r','tester','retain','{}','2026-09-27');`);
        }
    }
    finally {
        db.close();
    }
}
export class Connection implements UpgradeDatabase {
    closed = false;
    constructor(readonly raw: DatabaseSync, readonly before?: (sql: string) => void | Promise<void>, readonly after?: (sql: string) => void | Promise<void>, readonly closeError = false) { }
    async execAsync(sql: string) { await this.before?.(sql); this.raw.exec(sql); await this.after?.(sql); }
    async getFirstAsync<T>(sql: string) { return (this.raw.prepare(sql).get() ?? null) as T | null; }
    async getAllAsync<T>(sql: string) { return this.raw.prepare(sql).all() as T[]; }
    async runAsync(sql: string, ...params: (string | number)[]) {
        await this.before?.(sql);
        const value = this.raw.prepare(sql).run(...params);
        await this.after?.(sql);
        return value;
    }
    async isInTransactionAsync() { return this.raw.isTransaction; }
    async closeAsync() { this.raw.close(); this.closed = true; if (this.closeError)
        throw new Error("close reporting failure"); }
}
