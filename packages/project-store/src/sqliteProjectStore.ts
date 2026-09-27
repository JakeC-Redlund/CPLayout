import * as SQLite from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

import { applyProjectStoreMigrations } from "./projectStoreMigrations";

export { applyProjectStoreMigrations } from "./projectStoreMigrations";

export const DEFAULT_PROJECT_DATABASE_NAME = "center-pivot-projects.db";

const databaseReadyPromises = new Map<string, Promise<SQLiteDatabase>>();

export async function openProjectDatabaseAsync(databaseName = DEFAULT_PROJECT_DATABASE_NAME): Promise<SQLiteDatabase> {
  const existing = databaseReadyPromises.get(databaseName);
  if (existing) return existing;

  const ready = (async () => {
    const db = await SQLite.openDatabaseAsync(databaseName);
    await applyProjectStoreMigrations(db);
    return db;
  })();
  databaseReadyPromises.set(databaseName, ready);
  try {
    return await ready;
  } catch (error) {
    databaseReadyPromises.delete(databaseName);
    throw error;
  }
}
