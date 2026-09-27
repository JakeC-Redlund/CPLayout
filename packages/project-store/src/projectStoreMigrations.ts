import type { SQLiteDatabase } from "expo-sqlite";

import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from "./persistenceSchema";

export type ProjectMigrationDatabase = Pick<SQLiteDatabase, "execAsync" | "getFirstAsync" | "runAsync">;

export async function applyProjectStoreMigrations(db: ProjectMigrationDatabase): Promise<void> {
  // Inspect compatibility before journal settings, schema bootstrap or any migration writes.
  const applied = await db.getFirstAsync<{ user_version: unknown }>("PRAGMA user_version;");
  const currentVersion = applied?.user_version;
  if (typeof currentVersion !== "number" || !Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    throw new Error("Project database schema version is invalid or unreadable; no migration was applied.");
  }
  if (currentVersion > SQLITE_SCHEMA_VERSION) {
    throw new Error(`Project database schema version ${currentVersion} is newer than supported version ${SQLITE_SCHEMA_VERSION}; open it with a compatible CPLayout version. No migration was applied.`);
  }

  await db.execAsync("PRAGMA foreign_keys = ON;");
  await db.execAsync("PRAGMA journal_mode = WAL;");
  await db.execAsync(SQLITE_MIGRATIONS[0].statements[0]);

  const pendingMigrations = SQLITE_MIGRATIONS.filter((migration) => migration.id > currentVersion);
  for (const migration of pendingMigrations) {
    await db.execAsync("BEGIN;");
    try {
      for (const statement of migration.statements) {
        await db.execAsync(statement);
      }
      await db.runAsync(
        "INSERT OR IGNORE INTO schema_migrations (id, name) VALUES (?, ?);",
        migration.id,
        migration.name,
      );
      await db.execAsync(`PRAGMA user_version = ${migration.id};`);
      await db.execAsync("COMMIT;");
    } catch (error) {
      await db.execAsync("ROLLBACK;");
      throw error;
    }
  }
}
