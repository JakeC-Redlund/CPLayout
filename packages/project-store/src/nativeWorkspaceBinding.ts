import { z } from "zod";
import { SQLITE_MIGRATIONS } from "./persistenceSchema";
import { parseStrictJson } from "./strictJson";
import { readLegacySqliteSourceAsync, admitLegacySqliteWorkspace, type LegacySqliteSource } from "./legacySqliteAdmission";
import { initializeWorkspaceInTransaction, readWorkspaceInTransaction, SQLITE_WORKSPACE_SCHEMA, NativeWorkspaceStoreError, type WorkspaceDatabase, type NativeWorkspaceHost } from "./sqliteWorkspaceStore";
import { parsePreparedUpgrade } from "./preparedUpgrade";
import { serializeMigrationPlan, type Migration, type PreparedUpgrade, type UpgradeDatabase, type UpgradeHost } from "./upgradeCoordinator";
import { LEGACY_FENCE_SCHEMA, installLegacyWriteFence, readLegacyFenceManifest, verifyLegacyWriteFence } from "./legacyWriteFence";
export const ADMISSION_STEP = "admit-sqlite-workspace-v2";
export const BINDING_SCHEMA = `CREATE TABLE cplayout_workspace_binding (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1), receipt_json TEXT NOT NULL
)`;
export const WORKSPACE_MIGRATION: Migration = {
    id: 12, name: "admit_versioned_workspace", dataStep: ADMISSION_STEP,
    statements: [
        `CREATE TABLE IF NOT EXISTS cplayout_upgrade_receipts (
      attempt_id TEXT PRIMARY KEY NOT NULL, receipt_json TEXT NOT NULL
    )`,
        ...SQLITE_WORKSPACE_SCHEMA, BINDING_SCHEMA, LEGACY_FENCE_SCHEMA,
    ],
};
export function workspaceMigrationPlan(): Migration[] {
    if (SQLITE_MIGRATIONS.length !== 11)
        throw new Error("Rebase workspace migration on the current native schema before use.");
    return [...SQLITE_MIGRATIONS, WORKSPACE_MIGRATION];
}
const Receipt = z.object({
    format: z.literal("cplayout-workspace-binding-v2"),
    sourceIdentity: z.string().min(1), admittedAtSchema: z.literal(11), targetSchema: z.literal(12),
    legacySha256: z.string().regex(/^[a-f0-9]{64}$/), preparedJson: z.string(),
    legacyFenceSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type BoundDatabase = WorkspaceDatabase & UpgradeDatabase;
export interface BindingContext {
    sourceIdentity: string;
    sha256(text: string): Promise<string>;
    // Bind exact prepared bytes to a durable owned manifest and reverify retained backup.
    // Never use caller-provided paths as authority or restore over the source.
    verifyRetainedPrepared(receipt: PreparedUpgrade): Promise<void>;
}
export type WorkspaceUpgradeHost = Omit<UpgradeHost, "openSource" | "applyDataStep"> & {
    openSource(): Promise<BoundDatabase>;
};
// Physical backup/schema verification remains mandatory. This wrapper adds
// admission checks to every success path, including current-version opens.
export function bindWorkspaceUpgradeHost(host: WorkspaceUpgradeHost, context: BindingContext): UpgradeHost {
    if (host.sourceIdentity !== context.sourceIdentity)
        fail("Upgrade host and workspace source identity differ.");
    return {
        sourceIdentity: host.sourceIdentity,
        openSource: () => host.openSource(),
        sha256: text => host.sha256(text),
        backupMain: (db, attempt) => host.backupMain(db, attempt),
        verifyBackup: (db, artifact) => host.verifyBackup(db, artifact),
        persistPrepared: receipt => host.persistPrepared(receipt),
        async applyDataStep(db, step, receipt) { await admitWorkspaceDataStep(db as BoundDatabase, step, receipt, context); },
        async verifyTargetSchema(db) {
            await host.verifyTargetSchema(db);
            await readWorkspaceInTransaction(db as BoundDatabase, (connection, receipt) => verifyBoundAdmission(connection as BoundDatabase, receipt, context));
        },
    };
}
export function bindWorkspaceStoreHost(host: Omit<NativeWorkspaceHost, "openReadyConnection" | "admitLegacy" | "verifyAdmission"> & {
    openReadyConnection(): Promise<BoundDatabase>;
}, context: BindingContext): NativeWorkspaceHost {
    return {
        openReadyConnection: () => host.openReadyConnection(),
        captureLegacyRecovery: db => host.captureLegacyRecovery(db),
        reportCleanupError: error => host.reportCleanupError?.(error),
        async admitLegacy() { return fail("Admission is migration-only; never reconstruct an erased workspace."); },
        async verifyAdmission(db, receipt) { await verifyBoundAdmission(db as BoundDatabase, receipt, context); },
    };
}
const fail = (message: string): never => { throw new NativeWorkspaceStoreError("recovery_required", message); };
function sourcePayload(source: LegacySqliteSource): string {
    // The six retained legacy tables are identical at v11 and v12. Keep the actual
    // observed version in source evidence, excluding only that version from the hash.
    const { schemaVersion: _schemaVersion, ...payload } = source;
    return JSON.stringify(payload);
}
async function verifyPrepared(prepared: PreparedUpgrade, context: BindingContext) {
    const expectedPlanHash = await context.sha256(serializeMigrationPlan(workspaceMigrationPlan()));
    if (prepared.sourceIdentity !== context.sourceIdentity || prepared.toVersion !== 12 ||
        prepared.planSha256 !== expectedPlanHash)
        fail("Prepared upgrade does not identify this source and migration plan.");
    await context.verifyRetainedPrepared(prepared);
}
export async function admitWorkspaceDataStep(db: BoundDatabase, step: string, prepared: PreparedUpgrade, context: BindingContext): Promise<void> {
    if (step !== ADMISSION_STEP || !await db.isInTransactionAsync())
        fail("Unknown admission step or missing owned transaction.");
    const captured = parsePreparedUpgrade(JSON.stringify(prepared));
    await verifyPrepared(captured, context);
    const source = await readLegacySqliteSourceAsync(db);
    const admitted = admitLegacySqliteWorkspace(source);
    const fenceManifest = await installLegacyWriteFence(db);
    const receipt = JSON.stringify(Receipt.parse({
        format: "cplayout-workspace-binding-v2", sourceIdentity: context.sourceIdentity,
        admittedAtSchema: source.schemaVersion, targetSchema: 12,
        legacySha256: await context.sha256(sourcePayload(source)), preparedJson: JSON.stringify(captured),
        legacyFenceSha256: await context.sha256(fenceManifest),
    }));
    const result = await db.runAsync("INSERT INTO main.cplayout_workspace_binding(singleton,receipt_json) VALUES(1,?);", receipt);
    if (result.changes !== 1)
        fail("Admission binding was not stored exactly once.");
    await initializeWorkspaceInTransaction(db, {
        async admitLegacy() { return { workspace: admitted.workspace, receipt }; },
        async verifyAdmission(connection, candidate) {
            if (candidate !== receipt)
                fail("Workspace receipt differs from migration admission.");
            await verifyLegacyWriteFence(db, fenceManifest);
            const rows = await connection.getAllAsync<{
                singleton: number;
                receipt_json: string;
            }>("SELECT * FROM main.cplayout_workspace_binding;");
            if (rows.length !== 1 || rows[0].singleton !== 1 || rows[0].receipt_json !== receipt)
                fail("Admission binding changed while initializing.");
            if (await context.sha256(sourcePayload(await readLegacySqliteSourceAsync(db))) !== Receipt.parse(parseStrictJson(receipt)).legacySha256) {
                fail("Legacy source changed during admission.");
            }
        },
    });
}
export async function verifyBoundAdmission(db: BoundDatabase, receipt: string, context: BindingContext): Promise<void> {
    if (!await db.isInTransactionAsync())
        fail("Admission verification requires a pinned transaction.");
    const binding = Receipt.parse(parseStrictJson(receipt));
    if (binding.sourceIdentity !== context.sourceIdentity)
        fail("Workspace belongs to a different source.");
    const prepared = parsePreparedUpgrade(binding.preparedJson);
    await verifyPrepared(prepared, context);
    const fenceManifest = await readLegacyFenceManifest(db);
    if (await context.sha256(fenceManifest) !== binding.legacyFenceSha256)
        fail("Legacy fence digest differs from admission.");
    await verifyLegacyWriteFence(db, fenceManifest);
    const anchors = await db.getAllAsync<{
        singleton: number;
        receipt_json: string;
    }>("SELECT * FROM main.cplayout_workspace_binding;");
    if (anchors.length !== 1 || anchors[0].singleton !== 1 || anchors[0].receipt_json !== receipt)
        fail("Workspace admission anchor is missing or changed.");
    const receipts = await db.getAllAsync<{
        attempt_id: string;
        receipt_json: string;
    }>("SELECT * FROM main.cplayout_upgrade_receipts;");
    const matching = receipts.filter(row => row.attempt_id === prepared.attemptId);
    if (matching.length !== 1 || matching[0].receipt_json !== binding.preparedJson)
        fail("Committed upgrade receipt is missing or changed.");
    const source = await readLegacySqliteSourceAsync(db, 12);
    if (await context.sha256(sourcePayload(source)) !== binding.legacySha256)
        fail("Retained legacy source changed; recovery is required.");
}
