import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, mkdtempSync, writeSync, unlinkSync, rmdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { BackupArtifact } from "../../../src/upgradeCoordinator";
const companions = ["-wal", "-shm", "-journal"] as const;
function absent(path: string) {
    try {
        lstatSync(path);
        return false;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return true;
        throw error;
    }
}
function sameFile(a: ReturnType<typeof fileState>, b: ReturnType<typeof fileState>) {
    return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function fileState(path: string) {
    const state = lstatSync(path, { bigint: true });
    if (!state.isFile() || state.nlink !== 1n)
        throw new Error("Backup must be a regular file without links.");
    return state;
}
// This Node reference adapter is for owned synthetic/companion artifacts, not an
// Expo implementation. The caller owns the parent directory and excludes writers.
function inspectFile(expectedPath: string, artifact: BackupArtifact, copyTo?: number) {
    if (artifact.identity !== expectedPath || resolve(expectedPath) !== expectedPath || realpathSync(expectedPath) !== expectedPath) {
        throw new Error("Backup path differs from the owned artifact identity.");
    }
    for (const suffix of companions)
        if (!absent(expectedPath + suffix))
            throw new Error(`Backup companion ${suffix} requires recovery; it will not be removed.`);
    const before = fileState(expectedPath);
    const fd = openSync(expectedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let digest: string;
    try {
        if (!sameFile(before, fstatSync(fd, { bigint: true })))
            throw new Error("Backup changed before opening its file handle.");
        const header = Buffer.alloc(100);
        if (readSync(fd, header, 0, 100, 0) !== 100 || header.subarray(0, 16).toString("binary") !== "SQLite format 3\0") {
            throw new Error("Backup is not a complete SQLite database.");
        }
        if (header[18] !== 1 || header[19] !== 1)
            throw new Error("Retained backup must be sealed in rollback-journal format.");
        const buffer = Buffer.alloc(64 * 1024), hash = createHash("sha256");
        let offset = 0;
        for (;;) {
            const bytes = readSync(fd, buffer, 0, buffer.length, offset);
            if (bytes === 0)
                break;
            hash.update(buffer.subarray(0, bytes));
            if (copyTo !== undefined) {
                let written = 0;
                while (written < bytes) {
                    const count = writeSync(copyTo, buffer, written, bytes - written, offset + written);
                    if (!count)
                        throw new Error("Backup inspection copy made no write progress.");
                    written += count;
                }
            }
            offset += bytes;
        }
        digest = hash.digest("hex");
        if (!sameFile(before, fstatSync(fd, { bigint: true })))
            throw new Error("Backup changed while hashing.");
    }
    finally {
        closeSync(fd);
    }
    if (!sameFile(before, fileState(expectedPath)))
        throw new Error("Backup path changed while hashing.");
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || digest !== artifact.sha256)
        throw new Error("Backup digest does not match the prepared receipt.");
    for (const suffix of companions)
        if (!absent(expectedPath + suffix))
            throw new Error("Backup companion appeared while hashing.");
    return before;
}
export function verifySealedBackup<T>(expectedPath: string, artifact: BackupArtifact, inspect?: (db: DatabaseSync) => T & (T extends PromiseLike<unknown> ? never : unknown)): T | undefined {
    const directory = mkdtempSync(join(tmpdir(), "cplayout-backup-inspect-"));
    const scratch = join(directory, "inspection.db");
    let before: ReturnType<typeof fileState> | undefined;
    let db: DatabaseSync | undefined, result: T | undefined;
    const errors: unknown[] = [];
    try {
        const destination = openSync(scratch, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
        try {
            before = inspectFile(expectedPath, artifact, destination);
        }
        finally {
            closeSync(destination);
        }
        // SQLite never opens the retained file. Its recovery/sidecar behavior is
        // confined to this exclusive copy of the bytes hashed through one descriptor.
        db = new DatabaseSync(scratch, { readOnly: true });
        db.exec("PRAGMA query_only=ON; BEGIN;");
        const integrity = db.prepare("PRAGMA main.integrity_check").all();
        if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
            throw new Error("Backup integrity check failed.");
        if (db.prepare("PRAGMA main.foreign_key_check").all().length)
            throw new Error("Backup foreign keys require recovery.");
        result = inspect?.(db);
        if (result !== null && (typeof result === "object" || typeof result === "function") &&
            typeof (result as {
                then?: unknown;
            }).then === "function") {
            // Untyped callers can still return a Promise; absorb its later rejection
            // and reject this call instead of publishing an already-closed handle.
            void Promise.resolve(result).catch(() => { });
            throw new Error("Backup inspector must be synchronous.");
        }
    }
    catch (error) {
        errors.push(error);
    }
    finally {
        if (db) {
            try {
                if (db.isTransaction)
                    db.exec("ROLLBACK;");
            }
            catch (error) {
                errors.push(error);
            }
            try {
                db.close();
            }
            catch (error) {
                errors.push(error);
            }
        }
        try {
            if (before && !sameFile(before, inspectFile(expectedPath, artifact)))
                throw new Error("Backup changed during database inspection.");
        }
        catch (error) {
            errors.push(error);
        }
        for (const file of [scratch, ...companions.map(suffix => scratch + suffix)]) {
            try {
                if (!absent(file))
                    unlinkSync(file);
            }
            catch (error) {
                errors.push(error);
            }
        }
        try {
            rmdirSync(directory);
        }
        catch (error) {
            errors.push(error);
        }
    }
    if (errors.length === 1)
        throw errors[0];
    if (errors.length > 1)
        throw new AggregateError(errors, "Backup verification and cleanup failed.");
    return result;
}
