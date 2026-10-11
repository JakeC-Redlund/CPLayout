import { openNativeArtifactSession, type BackupArtifactsModule } from "./nativeArtifactSession";
import { createExpoBackupPorts, type ExpoSqlitePort } from "./expoBackupPorts";
import { createNativeBackupOperations } from "./nativeBackupHost";
import { parsePreparedUpgrade } from "./preparedUpgrade";
import { workspaceMigrationPlan, type BindingContext } from "./nativeWorkspaceBinding";
import { serializeMigrationPlan, type Migration, type PreparedUpgrade } from "./upgradeCoordinator";
export interface NativeRetainedVerifierOptions {
    module: BackupArtifactsModule | null | undefined;
    sqlite: ExpoSqlitePort;
    sourceIdentity: string;
    expectedSourcePath: string;
    sha256(text: string): Promise<string>;
    newInspectionId(): string;
}
export class NativeRetainedVerificationError extends AggregateError {
    readonly recoveryRequired = true;
    constructor(errors: unknown[]) {
        super(errors, "Retained backup verification or cleanup failed; recovery is required.");
        this.name = "NativeRetainedVerificationError";
    }
}
/** Fresh native/SQL ownership per verification; no source opener or migration path. */
export function createNativeRetainedVerifier(options: NativeRetainedVerifierOptions): BindingContext {
    const { module, sqlite, sourceIdentity, expectedSourcePath, sha256, newInspectionId } = options;
    if (typeof sourceIdentity !== "string" || !sourceIdentity || sourceIdentity.length > 4096 ||
        typeof expectedSourcePath !== "string" || !expectedSourcePath.startsWith("/") || /[\s\x00-\x1f\\%?#]/.test(expectedSourcePath) ||
        expectedSourcePath.slice(1).split("/").some(part => !part || part === "." || part === "..") ||
        typeof sha256 !== "function" || typeof newInspectionId !== "function" || typeof sqlite?.openDatabaseAsync !== "function" ||
        typeof sqlite.backupDatabaseAsync !== "function")
        throw new Error("Invalid retained verification configuration.");
    const planJson = serializeMigrationPlan(workspaceMigrationPlan());
    const plan: Migration[] = JSON.parse(planJson);
    let busy = false, failed = false;
    return Object.freeze({
        sourceIdentity, sha256,
        async verifyRetainedPrepared(input: PreparedUpgrade): Promise<void> {
            if (failed)
                throw new NativeRetainedVerificationError([new Error("Verification is blocked after a prior failure.")]);
            if (busy)
                throw new Error("A retained verification is already in progress.");
            busy = true;
            const errors: unknown[] = [];
            let session: Awaited<ReturnType<typeof openNativeArtifactSession>> | undefined;
            let adapter: ReturnType<typeof createExpoBackupPorts> | undefined;
            try {
                // Capture before the first await so a caller cannot switch receipt identity mid-read.
                const receipt = parsePreparedUpgrade(JSON.stringify(input));
                const expectedHash = await sha256(planJson);
                if (!/^[a-f0-9]{64}$/.test(expectedHash) || receipt.sourceIdentity !== sourceIdentity ||
                    receipt.toVersion !== plan.length || receipt.planSha256 !== expectedHash)
                    throw new Error("Receipt identifies another source or migration plan.");
                session = await openNativeArtifactSession(module);
                if (expectedSourcePath === session.artifactRoot || expectedSourcePath.startsWith(session.artifactRoot + "/")) {
                    throw new Error("Source cannot reside in the retained backup root.");
                }
                adapter = createExpoBackupPorts({ native: session, sqlite, newInspectionId });
                const operations = await createNativeBackupOperations({ sourceIdentity, expectedSourcePath, plan, sha256, ports: adapter.ports });
                await operations.verifyRetainedPrepared(receipt);
            }
            catch (error) {
                errors.push(error);
            }
            finally {
                if (adapter || session) {
                    try {
                        await (adapter ? adapter.release() : session!.release());
                    }
                    catch (error) {
                        errors.push(error);
                    }
                }
                busy = false;
            }
            if (errors.length) {
                failed = true;
                throw new NativeRetainedVerificationError(errors);
            }
        },
    });
}
