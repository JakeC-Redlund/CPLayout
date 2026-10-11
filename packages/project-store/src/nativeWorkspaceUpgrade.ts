import type { SQLiteDatabase } from "./expoSqliteTypes";
import { openNativeArtifactSession, type BackupArtifactsModule } from "./nativeArtifactSession";
import { createExpoBackupPorts, type ExpoSqlitePort } from "./expoBackupPorts";
import { createNativeBackupOperations } from "./nativeBackupHost";
import { bindWorkspaceUpgradeHost, workspaceMigrationPlan, type BoundDatabase } from "./nativeWorkspaceBinding";
import { coordinateUpgrade, type UpgradeOutcome } from "./upgradeCoordinator";
export interface NativeWorkspaceUpgradeOptions {
    module: BackupArtifactsModule | null | undefined;
    sqlite: ExpoSqlitePort;
    sourceIdentity: string;
    expectedSourcePath: string;
    // Trusted bootstrap transfers ownership of one fresh, quiescent, non-migrating handle.
    // Existing-only path verification and old-handle shutdown belong to that bootstrap.
    openSource(): Promise<SQLiteDatabase>;
    sha256(text: string): Promise<string>;
    newInspectionId(): string;
    verifyTargetSchema(db: BoundDatabase): Promise<void>;
}
/** Explicit one-shot migration; construction and ordinary repository reads never migrate. */
export function createNativeWorkspaceUpgradeRunner(options: NativeWorkspaceUpgradeOptions) {
    const { module, sqlite, sourceIdentity, expectedSourcePath, openSource, sha256, newInspectionId, verifyTargetSchema } = options;
    const plan = workspaceMigrationPlan();
    let used = false;
    return Object.freeze({
        async run(attemptId: string): Promise<UpgradeOutcome> {
            if (used)
                throw new Error("Upgrade runner has already been used; reconcile before a fresh attempt.");
            used = true;
            let result: UpgradeOutcome = { state: "not_committed", cleanupErrors: [] };
            let session: Awaited<ReturnType<typeof openNativeArtifactSession>> | undefined;
            let adapter: ReturnType<typeof createExpoBackupPorts> | undefined;
            let source: SQLiteDatabase | undefined;
            let coordinatorOwnsSource = false;
            try {
                if (typeof attemptId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(attemptId) || typeof sourceIdentity !== "string" || !sourceIdentity ||
                    sourceIdentity.length > 4096 || typeof expectedSourcePath !== "string" || !expectedSourcePath.startsWith("/") ||
                    /[\s\x00-\x1f\\%?#]/.test(expectedSourcePath) ||
                    expectedSourcePath.slice(1).split("/").some(part => !part || part === "." || part === "..") ||
                    typeof openSource !== "function" || typeof sha256 !== "function" || typeof newInspectionId !== "function" ||
                    typeof verifyTargetSchema !== "function" || typeof sqlite?.openDatabaseAsync !== "function" ||
                    typeof sqlite.backupDatabaseAsync !== "function")
                    throw new Error("Invalid native workspace upgrade configuration.");
                try {
                    session = await openNativeArtifactSession(module);
                }
                catch (error) {
                    // Setup aggregates can contain uncertain native cleanup. Retain the full
                    // error tree and require recovery; no session handle exists for a retry.
                    if (error instanceof AggregateError)
                        result.cleanupErrors.push(error);
                    throw error;
                }
                if (expectedSourcePath === session.artifactRoot || expectedSourcePath.startsWith(session.artifactRoot + "/")) {
                    throw new Error("Source cannot reside in the retained backup root.");
                }
                try {
                    source = await openSource();
                }
                catch (error) {
                    // The opener may have failed to close a handle it could not transfer.
                    if (error instanceof AggregateError)
                        result.cleanupErrors.push(error);
                    throw error;
                }
                if (!source?.nativeDatabase || source.options?.useNewConnection !== true || source.databasePath !== expectedSourcePath) {
                    throw new Error("Bootstrap did not transfer the expected private source connection.");
                }
                adapter = createExpoBackupPorts({ native: session, sqlite, source, newInspectionId });
                const operations = await createNativeBackupOperations({ sourceIdentity, expectedSourcePath, plan, sha256, ports: adapter.ports });
                const context = { sourceIdentity, sha256, verifyRetainedPrepared: operations.verifyRetainedPrepared };
                const host = bindWorkspaceUpgradeHost({ ...operations, sourceIdentity, sha256, verifyTargetSchema,
                    async openSource() { coordinatorOwnsSource = true; return source!; },
                }, context);
                result = await coordinateUpgrade(host, plan, attemptId);
            }
            catch (error) {
                result.error = error;
            }
            finally {
                // coordinateUpgrade owns close after its opener returns, including rejected commits.
                // Never retry a failed close: bridge rejection may follow a completed native close.
                if (source && !coordinatorOwnsSource) {
                    try {
                        await source.closeAsync();
                    }
                    catch (error) {
                        result.cleanupErrors.push(error);
                    }
                }
                if (adapter || session) {
                    try {
                        await (adapter ? adapter.release() : session!.release());
                    }
                    catch (error) {
                        result.cleanupErrors.push(error);
                    }
                }
                if (result.cleanupErrors.length)
                    result.state = "recovery_required";
            }
            return result;
        },
    });
}
