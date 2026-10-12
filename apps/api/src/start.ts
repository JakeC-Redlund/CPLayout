import { Pool } from "pg";
import { createApi } from "./server";
import { PostgresDatabase } from "./database";
import { serviceConfig } from "./config";
const config = serviceConfig(), pool = new Pool({ connectionString: config.connectionString, max: 10 });
try {
  const version = await pool.query("SHOW server_version_num");
  if (Number(version.rows[0]?.server_version_num) < 180006) throw new Error("CPLayout requires PostgreSQL 18.6 or later in the 18.x stable series.");
  if (Number(version.rows[0]?.server_version_num) >= 190000) throw new Error("Qualify the next PostgreSQL major version before activation.");
  const app = await createApi({ ...config, database: new PostgresDatabase(pool) });
  const stop = async () => { await app.close(); await pool.end(); };
  process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
  await app.listen({ host: config.host, port: config.port });
  process.stdout.write("CPLayout service is listening.\n");
} catch { process.stderr.write("CPLayout service could not start. Check database, migrations and protected service settings.\n"); await pool.end(); process.exitCode = 1; }
