import { readFile } from "node:fs/promises";
import type { Pool } from "pg";
import { sha256 } from "./database";
export async function migrateDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(1129335891)");
    await client.query("CREATE TABLE IF NOT EXISTS cplayout_schema_migrations (id text PRIMARY KEY, sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const id = "001_auth_workspaces", sql = await readFile(new URL("../migrations/001_auth_workspaces.sql", import.meta.url), "utf8"), digest = sha256(sql);
    const previous = await client.query("SELECT sha256 FROM cplayout_schema_migrations WHERE id=$1", [id]);
    if (previous.rows.length && previous.rows[0].sha256 !== digest) throw new Error("The installed migration differs from its retained source. Preserve the database and review its migration history.");
    if (!previous.rows.length) { await client.query(sql); await client.query("INSERT INTO cplayout_schema_migrations(id,sha256) VALUES($1,$2)", [id, digest]); }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
