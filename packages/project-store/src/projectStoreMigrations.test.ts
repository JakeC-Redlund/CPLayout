import assert from "node:assert/strict";
import test from "node:test";

import { SQLITE_MIGRATIONS, SQLITE_SCHEMA_VERSION } from "./persistenceSchema";
import { applyProjectStoreMigrations, type ProjectMigrationDatabase } from "./projectStoreMigrations";

interface Call { method: "read" | "exec" | "run"; sql: string; params?: unknown[] }

// A dispatch probe, not a SQLite emulator: native rollback/persistence still need runtime proof.
function database(row: unknown, fail?: (call: Call) => void) {
  const calls: Call[] = [];
  const record = (call: Call) => { calls.push(call); fail?.(call); };
  const db: ProjectMigrationDatabase = {
    async getFirstAsync<T>(sql: string): Promise<T | null> {
      record({ method: "read", sql });
      return row as T | null;
    },
    async execAsync(sql: string): Promise<void> { record({ method: "exec", sql }); },
    async runAsync(sql: string, ...params: unknown[]) {
      record({ method: "run", sql, params });
      return { lastInsertRowId: 1, changes: 1 };
    },
  };
  return { db, calls };
}

const versionRead: Call = { method: "read", sql: "PRAGMA user_version;" };

test("future project schemas are rejected before journal, bootstrap or migration writes", async () => {
  for (const version of [SQLITE_SCHEMA_VERSION + 1, 2147483647]) {
    const probe = database({ user_version: version });
    await assert.rejects(applyProjectStoreMigrations(probe.db), /newer than supported version/);
    assert.deepEqual(probe.calls, [versionRead]);
  }
});

test("missing or malformed schema reads cannot silently become a fresh database", async () => {
  for (const row of [null, undefined, {}, { user_version: null }, { user_version: "0" },
    { user_version: -1 }, { user_version: 0.5 }, { user_version: NaN }, { user_version: Infinity }]) {
    const probe = database(row);
    await assert.rejects(applyProjectStoreMigrations(probe.db), /schema version is invalid or unreadable/);
    assert.deepEqual(probe.calls, [versionRead]);
  }
});

test("a failed version query propagates without issuing any write SQL", async () => {
  const failure = new Error("Synthetic read failure");
  const probe = database(null, () => { throw failure; });
  await assert.rejects(applyProjectStoreMigrations(probe.db), (error) => error === failure);
  assert.deepEqual(probe.calls, [versionRead]);
});

for (const currentVersion of [0, 8, 10, SQLITE_SCHEMA_VERSION]) {
  test(`schema ${currentVersion} dispatches only its pending migrations after compatibility inspection`, async () => {
    const probe = database({ user_version: currentVersion });
    await applyProjectStoreMigrations(probe.db);
    const expected: Call[] = [versionRead,
      { method: "exec", sql: "PRAGMA foreign_keys = ON;" },
      { method: "exec", sql: "PRAGMA journal_mode = WAL;" },
      { method: "exec", sql: SQLITE_MIGRATIONS[0].statements[0] },
    ];
    for (const migration of SQLITE_MIGRATIONS.filter((item) => item.id > currentVersion)) {
      expected.push({ method: "exec", sql: "BEGIN;" });
      expected.push(...migration.statements.map((sql): Call => ({ method: "exec", sql })));
      expected.push({ method: "run", sql: "INSERT OR IGNORE INTO schema_migrations (id, name) VALUES (?, ?);", params: [migration.id, migration.name] });
      expected.push({ method: "exec", sql: `PRAGMA user_version = ${migration.id};` });
      expected.push({ method: "exec", sql: "COMMIT;" });
    }
    assert.deepEqual(probe.calls, expected);
  });
}

for (const failureStage of ["statement", "ledger", "version", "commit"] as const) {
  test(`migration ${failureStage} failure attempts rollback and does not report success`, async () => {
    const migration = SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1];
    const failure = new Error(`Synthetic ${failureStage} failure`);
    const probe = database({ user_version: migration.id - 1 }, (call) => {
      if ((failureStage === "statement" && call.sql === migration.statements[0])
        || (failureStage === "ledger" && call.method === "run")
        || (failureStage === "version" && call.sql === `PRAGMA user_version = ${migration.id};`)
        || (failureStage === "commit" && call.sql === "COMMIT;")) throw failure;
    });
    await assert.rejects(applyProjectStoreMigrations(probe.db), (error) => error === failure);
    assert.deepEqual(probe.calls[0], versionRead);
    assert.deepEqual(probe.calls.at(-1), { method: "exec", sql: "ROLLBACK;" });
    assert.equal(probe.calls.filter((call) => call.sql === "COMMIT;").length, failureStage === "commit" ? 1 : 0);
  });
}

test("failure to begin a transaction cannot issue migration statements or an unrelated rollback", async () => {
  const failure = new Error("Synthetic busy database");
  const probe = database({ user_version: SQLITE_SCHEMA_VERSION - 1 }, (call) => { if (call.sql === "BEGIN;") throw failure; });
  await assert.rejects(applyProjectStoreMigrations(probe.db), (error) => error === failure);
  assert.deepEqual(probe.calls.at(-1), { method: "exec", sql: "BEGIN;" });
  assert.equal(probe.calls.some((call) => call.method === "run" || call.sql === "ROLLBACK;"), false);
});
