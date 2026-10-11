import { z } from "zod";
import { parseStrictJson } from "./strictJson";
import type { WorkspaceDatabase } from "./sqliteWorkspaceStore";
export const LEGACY_FENCE_SCHEMA = `CREATE TABLE cplayout_legacy_fence (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1), manifest_json TEXT NOT NULL
)`;
export const LEGACY_WRITE_MESSAGE = "Retained legacy data is read-only after workspace admission";
const guardPrefix = "cplayout_legacy_guard_";
const ownedTables = new Set(["schema_migrations", "cplayout_upgrade_receipts", "cplayout_workspace_binding",
    "cplayout_workspace_admissions", "cplayout_workspace_meta", "cplayout_workspace_records", "cplayout_legacy_fence"]);
const operations = ["INSERT", "UPDATE", "DELETE"] as const;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
// SQLite identifier comparison folds ASCII only; preserve all original manifest text.
const identifierKey = (name: string) => name.replace(/[A-Z]/g, letter => letter.toLowerCase());
const Guard = z.object({ operation: z.enum(operations), name: z.string().min(1), sql: z.string().min(1) }).strict();
const Manifest = z.object({ format: z.literal("cplayout-legacy-fence-v1"), tables: z.array(z.object({
        name: z.string().min(1), sql: z.string().min(1), guards: z.array(Guard).length(3),
    }).strict()) }).strict();
type FenceManifest = z.output<typeof Manifest>;
interface SchemaObject {
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
}
function fail(message: string): never { throw new Error(`Legacy write fence: ${message}`); }
async function schema(db: WorkspaceDatabase) {
    return db.getAllAsync<SchemaObject>("SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name COLLATE BINARY;");
}
async function expectedManifest(db: WorkspaceDatabase, objects: SchemaObject[]): Promise<FenceManifest> {
    const kinds = await db.getAllAsync<{
        schema: string;
        name: string;
        type: string;
    }>("PRAGMA main.table_list;");
    const tables = objects.filter(row => row.type === "table" && !ownedTables.has(identifierKey(row.name)));
    for (const table of tables) {
        const kind = kinds.find(item => item.schema === "main" && item.name === table.name);
        if (kind?.type !== "table" || !table.sql)
            fail("virtual/shadow/unknown tables require explicit compatibility review.");
    }
    return Manifest.parse({ format: "cplayout-legacy-fence-v1", tables: tables.map((table, index) => ({
            name: table.name, sql: table.sql,
            guards: operations.map(operation => {
                const name = `${guardPrefix}${index}_${operation.toLowerCase()}`;
                return { operation, name, sql: `CREATE TRIGGER ${quote(name)} BEFORE ${operation} ON ${quote(table.name)} BEGIN SELECT RAISE(ABORT, '${LEGACY_WRITE_MESSAGE}'); END` };
            }),
        })) });
}
export async function installLegacyWriteFence(db: WorkspaceDatabase): Promise<string> {
    if (!await db.isInTransactionAsync())
        fail("installation requires the migration transaction.");
    const objects = await schema(db), manifest = await expectedManifest(db, objects);
    const names = new Set(manifest.tables.map(table => identifierKey(table.name)));
    if (objects.some(row => identifierKey(row.name).startsWith(guardPrefix) || row.type === "trigger" && names.has(identifierKey(row.tbl_name)))) {
        fail("pre-existing legacy triggers or reserved guard names require compatibility review.");
    }
    for (const table of manifest.tables)
        for (const guard of table.guards) {
            // Qualify the trigger's schema; SQLite stores its SQL without that qualifier.
            await db.execAsync(`CREATE TRIGGER main.${quote(guard.name)} BEFORE ${guard.operation} ON ${quote(table.name)} BEGIN SELECT RAISE(ABORT, '${LEGACY_WRITE_MESSAGE}'); END`);
        }
    const text = JSON.stringify(manifest);
    const result = await db.runAsync("INSERT INTO main.cplayout_legacy_fence(singleton,manifest_json) VALUES(1,?);", text);
    if (result.changes !== 1)
        fail("manifest was not stored exactly once.");
    await verifyLegacyWriteFence(db, text);
    return text;
}
export async function readLegacyFenceManifest(db: WorkspaceDatabase): Promise<string> {
    const rows = await db.getAllAsync<{
        singleton: unknown;
        manifest_json: unknown;
    }>("SELECT * FROM main.cplayout_legacy_fence;");
    if (rows.length !== 1 || rows[0].singleton !== 1 || typeof rows[0].manifest_json !== "string")
        fail("manifest is missing or invalid.");
    return rows[0].manifest_json;
}
export async function verifyLegacyWriteFence(db: WorkspaceDatabase, expectedText: string): Promise<void> {
    if (!await db.isInTransactionAsync())
        fail("verification requires a pinned transaction.");
    const text = await readLegacyFenceManifest(db);
    if (text !== expectedText)
        fail("manifest differs from admission.");
    const manifest = Manifest.parse(parseStrictJson(text)), objects = await schema(db);
    if (JSON.stringify(manifest) !== JSON.stringify(await expectedManifest(db, objects)))
        fail("retained table inventory or definitions changed.");
    const names = new Set(manifest.tables.map(table => identifierKey(table.name)));
    const expected = manifest.tables.flatMap(table => table.guards.map(guard => ({
        type: "trigger", name: guard.name, tbl_name: table.name, sql: guard.sql,
    }))).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const actual = objects.filter(row => identifierKey(row.name).startsWith(guardPrefix) || row.type === "trigger" && names.has(identifierKey(row.tbl_name)));
    if (JSON.stringify(actual) !== JSON.stringify(expected))
        fail("a legacy guard was removed, changed or supplemented.");
}
