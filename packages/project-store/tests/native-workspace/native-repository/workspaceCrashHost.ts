import assert from "node:assert/strict";
import { closeSync, constants, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, fstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { Connection, sha, snapshot } from "./nodeSqliteTestSupport";
import { verifySealedBackup } from "./nodeBackupArtifact";
import { parsePreparedUpgrade } from "../../../src/preparedUpgrade";
import { bindWorkspaceUpgradeHost, workspaceMigrationPlan, type BoundDatabase, type BindingContext } from "../../../src/nativeWorkspaceBinding";
import type { PreparedUpgrade } from "../../../src/upgradeCoordinator";
export class WorkspaceConnection extends Connection implements BoundDatabase {
    override async runAsync(sql: string, ...params: (string | number)[]) {
        const result = await super.runAsync(sql, ...params);
        return { ...result, changes: Number(result.changes) };
    }
    override async getAllAsync<T>(sql: string, ...params: (string | number)[]) { return this.raw.prepare(sql).all(...params) as T[]; }
}
export function flush(path: string) {
    const fd = openSync(path, "r");
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
}
export function readPreparedFile(path: string): PreparedUpgrade {
    assert.equal(realpathSync(path), path);
    const before = lstatSync(path, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.size <= 65536n);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const opened = fstatSync(fd, { bigint: true });
        assert.equal(opened.ino, before.ino);
        assert.equal(opened.dev, before.dev);
        const value = parsePreparedUpgrade(readFileSync(fd, "utf8"));
        const after = lstatSync(path, { bigint: true });
        for (const key of ["ino", "dev", "size", "mtimeNs", "ctimeNs"] as const)
            assert.equal(after[key], before[key]);
        return value;
    }
    finally {
        closeSync(fd);
    }
}
export function createCrashHost(folder: string, openSource: () => Promise<WorkspaceConnection>) {
    const sourcePath = join(folder, "source.db");
    const context: BindingContext = {
        sourceIdentity: sourcePath, async sha256(text) { return sha(text); },
        async verifyRetainedPrepared(receipt) {
            const captured = readPreparedFile(join(folder, `${receipt.attemptId}.json`));
            assert.deepEqual(captured, receipt);
            verifySealedBackup(join(folder, receipt.attemptId, "backup.db"), receipt.backup);
        },
    };
    let allocatedBackup: string | undefined;
    const host = bindWorkspaceUpgradeHost({
        sourceIdentity: sourcePath, openSource, sha256: context.sha256,
        async backupMain(connection, attempt) {
            const directory = join(folder, attempt);
            mkdirSync(directory);
            const destination = join(directory, "backup.db");
            allocatedBackup = destination;
            await backup((connection as WorkspaceConnection).raw, destination);
            const sealed = new DatabaseSync(destination);
            try {
                assert.equal(sealed.prepare("PRAGMA journal_mode=DELETE").get()!.journal_mode, "delete");
            }
            finally {
                sealed.close();
            }
            flush(destination);
            flush(directory);
            flush(folder);
            return { identity: destination, sha256: sha(readFileSync(destination)) };
        },
        async verifyBackup(connection, artifact) {
            assert.ok(allocatedBackup);
            verifySealedBackup(allocatedBackup, artifact, copied => assert.equal(snapshot(copied), snapshot((connection as WorkspaceConnection).raw)));
        },
        async persistPrepared(receipt) {
            writeFileSync(join(folder, `${receipt.attemptId}.json`), JSON.stringify(receipt), { flag: "wx", flush: true });
            flush(folder);
        },
        async verifyTargetSchema(connection) {
            const expected = new DatabaseSync(":memory:");
            try {
                for (const migration of workspaceMigrationPlan())
                    for (const sql of migration.statements)
                        expected.exec(sql);
                const rows = await connection.getAllAsync<{
                    name: string;
                }>("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name");
                for (const row of expected.prepare("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name").all()) {
                    assert.deepEqual(rows.find(value => value.name === row.name), row);
                }
            }
            finally {
                expected.close();
            }
        },
    }, context);
    return { host, context };
}
