import { Pool } from "pg";
import { PostgresDatabase } from "./database";
import { bootstrapAdministrator } from "./bootstrapService";

/** Deployment-local interactive entry point. Passwords never enter argv, env or logs. */
async function maskedInput(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Administrator bootstrap requires an interactive local terminal.");
  process.stdout.write(label); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => { process.stdin.off("data", read); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write("\n"); };
    const read = (data: Buffer) => {
      const text = data.toString("utf8");
      for (const character of text) {
        if (character === "\u0003") { finish(); value = ""; reject(new Error("Bootstrap cancelled.")); return; }
        if (character === "\r" || character === "\n") { finish(); resolve(value); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " " && value.length < 1024) value += character;
      }
    };
    process.stdin.on("data", read);
  });
}
function argument(name: string): string { const position = process.argv.indexOf(name); if (position < 0 || !process.argv[position + 1] || process.argv[position + 1].startsWith("--")) throw new Error(`Provide ${name}.`); return process.argv[position + 1]; }
let pool: Pool | undefined;
try {
  if (!process.env.CPLAYOUT_DATABASE_URL) throw new Error("Configure CPLAYOUT_DATABASE_URL before administrator bootstrap.");
  const username = argument("--username"), displayName = argument("--name"), workspaceName = argument("--workspace");
  pool = new Pool({ connectionString: process.env.CPLAYOUT_DATABASE_URL, max: 1 });
  const password = await maskedInput("Administrator password: "), confirmation = await maskedInput("Confirm password: ");
  if (password !== confirmation) throw new Error("Passwords do not match.");
  await bootstrapAdministrator(new PostgresDatabase(pool), { username, displayName, password, workspaceName });
  process.stdout.write("Administrator and workspace created. Sign in through the CPLayout interface.\n");
} catch (error) {
  const message = error instanceof Error && /^(Provide |Configure CPLAYOUT_|Administrator bootstrap |Passwords do not match|Use a password |Bootstrap cancelled)/.test(error.message)
    ? error.message : "Administrator bootstrap failed; review service configuration.";
  process.stderr.write(`${message}\n`); process.exitCode = 1;
}
finally { await pool?.end(); }
