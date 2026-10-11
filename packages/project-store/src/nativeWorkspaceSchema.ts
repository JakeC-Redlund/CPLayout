import { workspaceMigrationPlan } from "./nativeWorkspaceBinding";
import { serializeMigrationPlan } from "./upgradeCoordinator";
import { NATIVE_WORKSPACE_SCHEMA_MANIFEST as expected } from "./schemaManifest";
export interface NativeWorkspaceSchemaDatabase {
    getAllAsync<T>(sql: string): Promise<T[]>;
    isInTransactionAsync(): Promise<boolean>;
}
interface SchemaObject {
    type: string;
    name: string;
    tbl_name: string;
    sql: string | null;
}
export class NativeWorkspaceSchemaError extends Error {
    readonly code = "recovery_required";
    constructor(message: string) {
        super(`Native workspace schema: ${message}`);
        this.name = "NativeWorkspaceSchemaError";
    }
}
const writableTables = new Set([
    "schema_migrations", "cplayout_upgrade_receipts", "cplayout_workspace_binding",
    "cplayout_workspace_admissions", "cplayout_workspace_meta", "cplayout_workspace_records", "cplayout_legacy_fence",
]);
const identifierKey = (value: string) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const fail = (message: string): never => { throw new NativeWorkspaceSchemaError(message); };
// Same historical labels accepted by the trusted upgrade coordinator. SQL still
// must exactly match the current manifest; these aliases only affect ledger data.
const historicalNames = new Map<number, readonly [
    string,
    string
]>([
    [5, ["add_client_project_field_design_catalog", "add_customer_project_field_design_catalog"]],
    [6, ["add_client_profile_fields", "add_customer_profile_fields"]],
    [7, ["add_client_structured_contact_fields", "add_customer_structured_contact_fields"]],
]);
/**
 * Read-only schema gate for verifyTargetSchema and normal workspace reads.
 * The caller exclusively owns this connection and transaction throughout the
 * await chain and subsequent use. This function never opens, closes, or owns it.
 * Admission, retained legacy guards, receipts and data remain separate gates.
 */
export async function verifyNativeWorkspaceSchema(db: NativeWorkspaceSchemaDatabase): Promise<void> {
    const pinned = async () => {
        if (!await db.isInTransactionAsync())
            fail("a caller-owned pinned transaction is required.");
    };
    await pinned();
    const plan = workspaceMigrationPlan();
    if (serializeMigrationPlan(plan) !== expected.serializedPlan || plan.length !== expected.targetVersion) {
        fail("trusted migration plan drift; regenerate and review the schema manifest.");
    }
    const read = async <T>(sql: string): Promise<T[]> => {
        await pinned();
        const rows = await db.getAllAsync<T>(sql);
        await pinned();
        return rows;
    };
    const isolation = await read<{
        read_uncommitted: unknown;
    }>("PRAGMA read_uncommitted;");
    if (isolation.length !== 1 || isolation[0].read_uncommitted !== 0)
        fail("read-uncommitted isolation is unsupported.");
    // The first main-schema read pins a DEFERRED transaction's main snapshot.
    const actual = await read<SchemaObject>("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name COLLATE BINARY,type COLLATE BINARY;");
    const temporary = await read<SchemaObject>("SELECT type,name,tbl_name,sql FROM temp.sqlite_schema;");
    // A private workspace handle has no legitimate TEMP schema. Reject all TEMP
    // objects, including triggers on main tables and shadows of retained tables.
    if (temporary.length)
        fail("TEMP schema objects are unsupported on a workspace connection.");
    for (const required of expected.objects) {
        const matches = actual.filter(row => identifierKey(row.name) === identifierKey(required.name));
        const found = matches[0];
        if (matches.length !== 1 || found.type !== required.type || found.name !== required.name ||
            found.tbl_name !== required.tbl_name || found.sql !== required.sql) {
            fail(`mandatory object ${required.name} is missing or differs from trusted migrations.`);
        }
    }
    const expectedNames = new Set<string>(expected.objects.map(row => row.name));
    for (const row of actual) {
        if (writableTables.has(identifierKey(row.tbl_name)) && !expectedNames.has(row.name)) {
            fail(`unexpected ${row.type} ${row.name} targets a writable workspace table.`);
        }
    }
    const version = await read<{
        user_version: unknown;
    }>("PRAGMA main.user_version;");
    if (version.length !== 1 || version[0].user_version !== expected.targetVersion)
        fail("unsupported main.user_version.");
    const ledger = await read<{
        id: unknown;
        name: unknown;
    }>("SELECT id,name FROM main.schema_migrations ORDER BY id;");
    if (ledger.length !== plan.length || ledger.some((row, index) => {
        const migration = plan[index];
        const alias = historicalNames.get(migration.id);
        return row.id !== migration.id || (row.name !== migration.name &&
            !(alias?.[0] === migration.name && alias[1] === row.name));
    }))
        fail("migration ledger disagrees with trusted migration versions/names.");
    await pinned();
}
