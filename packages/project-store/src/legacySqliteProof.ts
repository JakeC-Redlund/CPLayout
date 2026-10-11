import type { SQLiteDatabase } from "./expoSqliteTypes";
import { ANDROID_NATIVE_REQUIRED_ABSENT_TABLES, ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS, ANDROID_NATIVE_REQUIRED_MIGRATIONS, ANDROID_NATIVE_REQUIRED_SQLITE_VERSION, type AndroidNativeVerificationReport, } from "./nativeVerification";
import type { LegacyDatabaseOwner } from "./legacyDatabaseOwner";
export function collectLegacySqliteProof(owner: LegacyDatabaseOwner<SQLiteDatabase>, projectId: string): Promise<AndroidNativeVerificationReport['sqlite']> {
    return owner.run(async (open) => {
        const db = await open();
        const pragma = await db.getFirstAsync<{
            user_version: number | null;
        }>('PRAGMA user_version;');
        const migrations = await db.getAllAsync<{
            id: number;
        }>('SELECT id FROM schema_migrations ORDER BY id;');
        const columns = await db.getAllAsync<{
            name: string;
        }>('PRAGMA table_info(map_packages);');
        const retiredTables = await db.getAllAsync<{
            name: string;
        }>(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('layout_evidence', 'model_recommendations', 'layout_decisions')
      ORDER BY name;`);
        const geometryCount = await db.getFirstAsync<{
            count: number;
        }>('SELECT COUNT(*) AS count FROM geometries WHERE project_id = ?;', projectId);
        const vertexCount = await db.getFirstAsync<{
            count: number;
        }>(`SELECT COUNT(*) AS count
      FROM geometry_vertices
      WHERE geometry_id IN (SELECT id FROM geometries WHERE project_id = ?);`, projectId);
        const presentRetiredTables = new Set(retiredTables.map(row => row.name));
        return {
            schemaVersion: ANDROID_NATIVE_REQUIRED_SQLITE_VERSION,
            pragmaUserVersion: Number(pragma?.user_version ?? 0),
            schemaMigrations: migrations.map(migration => Number(migration.id)).filter(id => ANDROID_NATIVE_REQUIRED_MIGRATIONS.includes(id)),
            mapPackageColumns: columns.map(column => column.name).filter(name => ANDROID_NATIVE_REQUIRED_MAP_PACKAGE_COLUMNS.includes(name as never)),
            absentTables: ANDROID_NATIVE_REQUIRED_ABSENT_TABLES.filter(table => !presentRetiredTables.has(table)),
            geometryRowsPopulated: Number(geometryCount?.count ?? 0) > 0 && Number(vertexCount?.count ?? 0) > 0,
        };
    });
}
