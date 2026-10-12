import { Pool } from "pg";
import { migrateDatabase } from "./migrations";
if (!process.env.CPLAYOUT_DATABASE_URL) throw new Error("Configure CPLAYOUT_DATABASE_URL before migrating.");
const pool = new Pool({ connectionString: process.env.CPLAYOUT_DATABASE_URL, max: 1 });
try { await migrateDatabase(pool); process.stdout.write("CPLayout database migrations completed.\n"); }
catch { process.stderr.write("Database migration failed. Preserve the database and review service configuration.\n"); process.exitCode = 1; }
finally { await pool.end(); }
