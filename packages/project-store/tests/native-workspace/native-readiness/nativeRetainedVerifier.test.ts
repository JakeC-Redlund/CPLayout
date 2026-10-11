import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { BackupArtifactsModule } from "../../../src/nativeArtifactSession";
import { createNativeWorkspaceUpgradeRunner } from "../../../src/nativeWorkspaceUpgrade";
import { bindWorkspaceStoreHost } from "../../../src/nativeWorkspaceBinding";
import { createSqliteWorkspaceStore, NativeWorkspaceStoreError } from "../../../src/sqliteWorkspaceStore";
import { createNativeRetainedVerifier, NativeRetainedVerificationError } from "../../../src/nativeRetainedVerifier";
import { fixture, seed, options, type Fixture } from "./readinessFixture";
export function multiplex(f: Fixture, hook?: (module: BackupArtifactsModule) => void) {
    const sessions = new Map<string, BackupArtifactsModule>();
    let created = 0, released = 0, peak = 0;
    const get = (id: string) => { const m = sessions.get(id); assert.ok(m); return m; };
    const module: BackupArtifactsModule = {
        protocolVersion: 1,
        async createSession() {
            assert.ok(sessions.size < 16, "native session quota exceeded");
            const m = options(f).module!;
            hook?.(m);
            const descriptor = await m.createSession() as {
                artifactRoot: string;
                protocolVersion: number;
            };
            const id = "session-" + (++created);
            sessions.set(id, m);
            peak = Math.max(peak, sessions.size);
            return { ...descriptor, sessionId: id };
        },
        allocateAttempt: (s, id) => get(s).allocateAttempt("session", id),
        openRetainedAttempt: (s, id) => get(s).openRetainedAttempt("session", id),
        backupPath: (s, h) => get(s).backupPath("session", h),
        sealBackup: (s, h) => get(s).sealBackup("session", h),
        verifyAndCopy: (s, h, d, id) => get(s).verifyAndCopy("session", h, d, id),
        inspectionPath: (s, h) => get(s).inspectionPath("session", h),
        closeInspection: (s, h) => get(s).closeInspection("session", h),
        publishPreparedHex: (s, h, text) => get(s).publishPreparedHex("session", h, text),
        readPreparedHex: (s, h) => get(s).readPreparedHex("session", h),
        async releaseSession(s) { released++; await get(s).releaseSession("session"); sessions.delete(s); },
    };
    let sequence = 0;
    return { options: { module, sqlite: f.sqlite, sourceIdentity: f.source.expo.databasePath,
            expectedSourcePath: f.source.expo.databasePath,
            sha256: async (text: string) => createHash("sha256").update(text).digest("hex"),
            newInspectionId: () => "read-" + (++sequence) },
        get created() { return created; }, get released() { return released; }, get peak() { return peak; },
        get active() { return sessions.size; },
    };
}
export async function admitted(f: Fixture) {
    seed(f, 11, "WAL");
    const outcome = await createNativeWorkspaceUpgradeRunner(options(f)).run("first");
    assert.equal(outcome.state, "committed", String(outcome.error));
    return outcome.prepared!;
}
test("300 retained verifications use short-lived sessions and preserve retained bytes", async () => fixture(async (f) => {
    const receipt = await admitted(f), before = readFileSync(receipt.backup.identity), m = multiplex(f);
    const context = createNativeRetainedVerifier(m.options);
    for (let i = 0; i < 300; i++)
        await context.verifyRetainedPrepared(receipt);
    assert.equal(m.created, 300);
    assert.equal(m.released, 300);
    assert.equal(m.peak, 1);
    assert.equal(m.active, 0);
    assert.deepEqual(readFileSync(receipt.backup.identity), before);
    assert.ok(f.connections.every(c => c.closed));
    assert.equal(f.source.closes, 1);
}));
test("receipt is captured before asynchronous hashing; concurrent call rejects without poisoning first", async () => fixture(async (f) => {
    const receipt = await admitted(f), m = multiplex(f);
    let unblock!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const hash = m.options.sha256;
    let hashes = 0;
    m.options.sha256 = async (text) => { if (++hashes === 1)
        await gate; return hash(text); };
    const verifier = createNativeRetainedVerifier(m.options), input = structuredClone(receipt);
    const first = verifier.verifyRetainedPrepared(input);
    input.backup.sha256 = "0".repeat(64);
    await assert.rejects(verifier.verifyRetainedPrepared(receipt), /already in progress/);
    assert.equal(m.created, 0);
    unblock();
    await first;
    await verifier.verifyRetainedPrepared(receipt);
    assert.equal(m.active, 0);
}));
for (const problem of ["source", "plan", "version", "malformed"] as const) {
    test(problem + " receipt mismatch never opens native session and latches recovery", async () => fixture(async (f) => {
        const receipt = await admitted(f), m = multiplex(f), context = createNativeRetainedVerifier(m.options);
        const invalid = structuredClone(receipt);
        if (problem === "source")
            invalid.sourceIdentity = "another";
        if (problem === "plan")
            invalid.planSha256 = "0".repeat(64);
        if (problem === "version")
            invalid.toVersion++;
        if (problem === "malformed")
            invalid.attemptId = "../foreign";
        await assert.rejects(context.verifyRetainedPrepared(invalid), NativeRetainedVerificationError);
        await assert.rejects(context.verifyRetainedPrepared(receipt), /recovery/);
        assert.equal(m.created, 0);
    }));
}
for (const problem of ["receipt", "copy", "inspection-close", "sql-close", "release", "both"] as const) {
    test(problem + " failure preserves causes, does not retry, and blocks later verification", async () => fixture(async (f) => {
        const receipt = await admitted(f);
        let failureCalls = 0;
        const primary = new Error("primary-failure"), cleanup = new Error("release-failure");
        const m = multiplex(f, module => {
            if (problem === "receipt" || problem === "both")
                module.readPreparedHex = async () => { failureCalls++; throw primary; };
            if (problem === "copy")
                module.verifyAndCopy = async () => { failureCalls++; throw primary; };
            if (problem === "inspection-close")
                module.closeInspection = async () => { failureCalls++; throw primary; };
            if (problem === "release" || problem === "both")
                module.releaseSession = async () => { throw cleanup; };
        });
        if (problem === "sql-close")
            f.faults.close = true;
        const context = createNativeRetainedVerifier(m.options);
        let failure: NativeRetainedVerificationError | undefined;
        await assert.rejects(context.verifyRetainedPrepared(receipt), error => {
            assert.ok(error instanceof NativeRetainedVerificationError);
            failure = error;
            return true;
        });
        if (problem === "both")
            assert.deepEqual(failure!.errors, [primary, cleanup]);
        const created = m.created, released = m.released, calls = failureCalls;
        await assert.rejects(context.verifyRetainedPrepared(receipt), /recovery/);
        assert.equal(m.created, created);
        assert.equal(m.released, released);
        assert.equal(failureCalls, calls);
        assert.equal(m.created, 1);
        assert.equal(m.released, problem === "sql-close" ? 0 : 1);
        assert.equal(createHash("sha256").update(readFileSync(receipt.backup.identity)).digest("hex"), receipt.backup.sha256);
    }));
}
test("invalid descriptor release failure is preserved without an unknown-session retry", async () => fixture(async (f) => {
    const receipt = await admitted(f), m = multiplex(f);
    let releases = 0;
    m.options.module.createSession = async () => ({ sessionId: "bad", protocolVersion: 1, artifactRoot: "relative" });
    m.options.module.releaseSession = async () => { releases++; throw Error("uncertain-release"); };
    const context = createNativeRetainedVerifier(m.options);
    await assert.rejects(context.verifyRetainedPrepared(receipt), e => e instanceof NativeRetainedVerificationError && e.errors[0] instanceof AggregateError);
    await assert.rejects(context.verifyRetainedPrepared(receipt));
    assert.equal(releases, 1);
}));
for (const action of ["read", "save", "action-and-close", "rollback-and-close"] as const) {
    test("workspace " + action + " never reports success when close is uncertain", async () => fixture(async (f) => {
        await admitted(f);
        const m = multiplex(f), context = createNativeRetainedVerifier(m.options);
        let closes = 0, rollbacks = 0;
        const closeError = new Error("source-close-uncertain"), rollbackError = new Error("rollback-uncertain");
        const reported: unknown[] = [];
        const host = bindWorkspaceStoreHost({
            async openReadyConnection() {
                const c = f.connection(f.source.expo.databasePath), db = c.expo;
                await db.execAsync("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA read_uncommitted=OFF;");
                const close = db.closeAsync.bind(db), exec = db.execAsync.bind(db);
                db.closeAsync = async () => { closes++; await close(); throw closeError; };
                db.execAsync = async (sql) => { await exec(sql); if (action === "rollback-and-close" && sql === "ROLLBACK;") {
                    rollbacks++;
                    throw rollbackError;
                } };
                return db;
            }, captureLegacyRecovery: async () => ({}), reportCleanupError: error => { reported.push(error); },
        }, context);
        const store = createSqliteWorkspaceStore(host);
        const operation = action === "save" || action === "action-and-close"
            ? store.executeAsync(action === "save" ? 0 : 99, { type: "create_client", now: "2026-09-27T05:00:00.000Z", id: "new-client", input: { primaryContactFirstName: "A", primaryContactLastName: "B" } })
            : store.readAsync();
        await assert.rejects(operation, error => {
            assert.ok(error instanceof NativeWorkspaceStoreError);
            assert.equal(error.code, action === "save" ? "commit_uncertain" : "recovery_required");
            assert.ok(error.original instanceof AggregateError);
            assert.ok(error.original.errors.includes(closeError));
            if (action === "action-and-close") {
                assert.equal(error.original.errors.length, 2);
                assert.match(String(error.original.errors[0]), /Workspace changed/);
            }
            if (action === "rollback-and-close")
                assert.ok(error.original.errors.includes(rollbackError));
            return true;
        });
        assert.equal(closes, 1);
        assert.ok(reported.includes(closeError));
        if (action === "rollback-and-close")
            assert.equal(rollbacks, 1);
        const c = f.connection(f.source.expo.databasePath);
        assert.equal(c.db.prepare("SELECT revision FROM cplayout_workspace_meta").get()!.revision, action === "save" ? 1 : 0);
        await c.expo.closeAsync();
    }));
}
for (const closeFails of [false, true]) {
    test("rollback fails before execution, close " + (closeFails ? "fails" : "succeeds") + ", all causes remain visible", async () => fixture(async (f) => {
        await admitted(f);
        const primary = new Error("action-failure"), rollback = new Error("rollback-before-execution"), closeFailure = new Error("close-after-native-completed");
        const reported: unknown[] = [];
        let rollbacks = 0, closes = 0, activeWhenClosing = false;
        const store = createSqliteWorkspaceStore({
            async openReadyConnection() {
                const c = f.connection(f.source.expo.databasePath), db = c.expo;
                await db.execAsync("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA read_uncommitted=OFF;");
                const exec = db.execAsync.bind(db), close = db.closeAsync.bind(db);
                db.execAsync = async (sql) => {
                    if (sql === "ROLLBACK;") {
                        rollbacks++;
                        assert.ok(c.db.isTransaction);
                        throw rollback;
                    }
                    await exec(sql);
                };
                db.closeAsync = async () => { closes++; activeWhenClosing = c.db.isTransaction; await close(); if (closeFails)
                    throw closeFailure; };
                return db;
            },
            admitLegacy: async () => { throw Error("not-an-admission-test"); },
            verifyAdmission: async () => { throw primary; },
            captureLegacyRecovery: async () => ({}),
            reportCleanupError: error => { reported.push(error); },
        });
        await assert.rejects(store.readAsync(), error => {
            assert.ok(error instanceof NativeWorkspaceStoreError);
            assert.equal(error.code, "recovery_required");
            assert.ok(error.original instanceof AggregateError);
            assert.deepEqual(error.original.errors, [primary, rollback, ...(closeFails ? [closeFailure] : [])]);
            return true;
        });
        assert.equal(rollbacks, 1);
        assert.equal(closes, 1);
        assert.equal(activeWhenClosing, true);
        assert.deepEqual(reported, [rollback, ...(closeFails ? [closeFailure] : [])]);
        assert.ok(f.connections.every(c => c.closed));
    }));
}
