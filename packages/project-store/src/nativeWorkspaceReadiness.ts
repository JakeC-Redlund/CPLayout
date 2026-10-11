import { bindWorkspaceStoreHost, type BoundDatabase } from "./nativeWorkspaceBinding";
import { NativeWorkspaceStoreError, type NativeWorkspaceHost } from "./sqliteWorkspaceStore";
import { createNativeRetainedVerifier, type NativeRetainedVerifierOptions } from "./nativeRetainedVerifier";
import { verifyNativeWorkspaceSchema } from "./nativeWorkspaceSchema";
/** The bootstrap still owns non-migrating source identity and private connection configuration. */
export function createVerifiedNativeWorkspaceHost(host: Parameters<typeof bindWorkspaceStoreHost>[0], options: NativeRetainedVerifierOptions): NativeWorkspaceHost {
    const captured = { ...options };
    const bound = bindWorkspaceStoreHost(host, createNativeRetainedVerifier(captured));
    async function verifyConnection(connection: BoundDatabase) {
        const databases = await connection.getAllAsync<{
            name: unknown;
            file: unknown;
        }>("PRAGMA database_list;");
        const main = databases.filter(row => row.name === "main");
        if (main.length !== 1 || main[0].file !== captured.expectedSourcePath || databases.some(row => row.name !== "main" && row.name !== "temp")) {
            throw new Error("Workspace connection does not identify the expected source without attachments.");
        }
        const journal = await connection.getAllAsync<{
            journal_mode: unknown;
        }>("PRAGMA main.journal_mode;");
        if (journal.length !== 1 || typeof journal[0].journal_mode !== "string" ||
            !["wal", "delete", "truncate", "persist"].includes(journal[0].journal_mode)) {
            throw new Error("Workspace requires WAL, DELETE, TRUNCATE or PERSIST journaling.");
        }
        const settings = [
            ["foreign_keys", 1], ["synchronous", 2], ["read_uncommitted", 0], ["ignore_check_constraints", 0],
        ] as const;
        for (const [name, expected] of settings) {
            const rows = await connection.getAllAsync<Record<string, unknown>>(`PRAGMA ${name};`);
            if (rows.length !== 1 || rows[0][name] !== expected)
                throw new Error(`Workspace connection requires ${name}=${expected}.`);
        }
    }
    return {
        ...bound,
        async openReadyConnection() {
            const db = await host.openReadyConnection();
            try {
                if (await db.isInTransactionAsync())
                    throw new Error("Bootstrap source must be private and idle.");
                // Reject OFF/MEMORY before BEGIN: rollback itself is undefined in OFF mode.
                await verifyConnection(db);
                return db;
            }
            catch (error) {
                try {
                    await db.closeAsync();
                }
                catch (closeError) {
                    try {
                        host.reportCleanupError?.(closeError);
                    }
                    catch { /* Reporting cannot hide failure. */ }
                    throw new NativeWorkspaceStoreError("recovery_required", "Source readiness and close failed.", new AggregateError([error, closeError]));
                }
                throw error;
            }
        },
        async verifyAdmission(db, receipt) {
            const connection = db as BoundDatabase;
            if (!await connection.isInTransactionAsync())
                throw new Error("Workspace admission requires a pinned private transaction.");
            await verifyConnection(connection);
            await verifyNativeWorkspaceSchema(connection);
            await bound.verifyAdmission(db, receipt);
        },
    };
}
