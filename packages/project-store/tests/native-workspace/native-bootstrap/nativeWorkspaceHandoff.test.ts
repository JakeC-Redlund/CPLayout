import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { snapshot } from "../native-repository/nodeSqliteTestSupport";
import { verifyNativeWorkspaceSchema } from "../../../src/nativeWorkspaceSchema";
import { createNativeWorkspaceHandoff } from "../../../src/nativeWorkspaceHandoff";
import { deferred, sha, until, withHandoffFixture, type HandoffFixture } from "../test-overlays/handoffFixture";
function onDiskSnapshot(path: string) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        return snapshot(db);
    }
    finally {
        db.close();
    }
}
function assertSingleSourceClose(f: HandoffFixture) {
    assert.equal(f.handles.length, 1);
    assert.equal(f.handles[0].closeCalls, 1);
    assert.equal(f.handles[0].connection.closes, 1);
    assert.equal(f.handles[0].connection.closed, true);
    assert.equal(f.base.events.filter(event => event === "source-close").length, 1);
    assert.equal(f.base.events.filter(event => event === "release").length, 1);
}
function assertRolledBack(f: HandoffFixture, before: string) {
    assert.ok(f.base.events.includes("source-sql:ROLLBACK;"));
    assert.ok(!f.base.events.includes("source-sql:COMMIT;"));
    assert.equal(onDiskSnapshot(f.path), before);
    assertSingleSourceClose(f);
}
for (const journal of ["DELETE", "WAL"] as const) {
    test("v11 " + journal + " drains, leases the original wrapper and preserves a complete backup", async () => withHandoffFixture(async (f) => {
        // WAL case includes committed frames written on the still-live legacy handle.
        await f.owner.run(async (open) => { await (await open()).execAsync("INSERT INTO unknown_evidence VALUES(2,X'CAFE');"); });
        if (journal === "WAL")
            assert.ok(existsSync(f.path + "-wal"));
        const before = snapshot(f.legacy.db);
        const handoff = createNativeWorkspaceHandoff(f.options());
        assert.equal(handoff.state, "idle");
        assert.equal(f.owner.state, "legacy");
        const result = await handoff.run("first");
        assert.equal(result.state, "committed", String(result.error));
        assert.equal(handoff.state, "committed");
        assert.deepEqual(result.cleanupErrors, []);
        assert.equal(f.owner.state, "handed_off");
        assert.equal(f.legacy.closes, 1);
        assertSingleSourceClose(f);
        assert.equal(f.wrappers.length, 1);
        assert.equal(f.base.source.expo, f.wrappers[0]);
        assert.equal(f.wrappers[0].nativeDatabase, f.handles[0]);
        assert.equal(f.wrappers[0].databasePath, f.path);
        assert.equal(f.wrappers[0].options.useNewConnection, true);
        assert.ok(f.base.events.indexOf("legacy-close") < f.base.events.indexOf("source-construct"));
        assert.ok(f.base.events.includes("backup"));
        assert.ok(f.base.events.includes("publish-hex"));
        assert.equal(f.handles[0].assertions, 3);
        assert.ok(result.prepared);
        assert.equal(result.prepared.sourceIdentity, f.path);
        assert.equal(onDiskSnapshot(result.prepared.backup.identity), before);
        assert.equal(sha(readFileSync(result.prepared.backup.identity)), result.prepared.backup.sha256);
        assert.doesNotMatch(JSON.stringify(result.prepared), /"(?:device|inode)"\s*:/);
        const verified = f.base.connection(f.path);
        await verified.expo.execAsync("BEGIN;");
        await verifyNativeWorkspaceSchema(verified.expo);
        assert.equal(verified.db.prepare("PRAGMA user_version").get()!.user_version, 12);
        assert.equal(verified.db.prepare("SELECT project_json FROM project_snapshots").get()!.project_json, f.document);
        assert.equal(verified.db.prepare("SELECT hex(value) AS value FROM unknown_evidence WHERE id=2").get()!.value, "CAFE");
        await verified.expo.execAsync("ROLLBACK;");
        await verified.expo.closeAsync();
        assert.ok(f.base.connections.every(connection => connection.closed));
    }, { journal }));
}
test("current v12 remains unchanged with stable receipt path and a fresh physical identity", async () => withHandoffFixture(async (f) => {
    const first = await createNativeWorkspaceHandoff(f.options()).run("first");
    assert.equal(first.state, "committed", String(first.error));
    assert.ok(first.prepared);
    const retained = readFileSync(first.prepared.backup.identity);
    const before = onDiskSnapshot(f.path);
    const initialIdentity = f.handles[0].identities[0];
    renameSync(f.path, f.path + ".old");
    copyFileSync(f.path + ".old", f.path);
    assert.notEqual(String(statSync(f.path, { bigint: true }).ino), initialIdentity.inode);
    await f.freshLegacy();
    const allocations = f.base.events.filter(event => event === "allocate").length;
    const result = await createNativeWorkspaceHandoff(f.options()).run("second");
    assert.equal(result.state, "unchanged", String(result.error));
    assert.deepEqual(result.cleanupErrors, []);
    assert.equal(result.prepared, undefined);
    assert.equal(onDiskSnapshot(f.path), before);
    assert.deepEqual(readFileSync(first.prepared.backup.identity), retained);
    assert.equal(f.base.events.filter(event => event === "allocate").length, allocations);
    assert.equal(f.handles.length, 2);
    assert.notEqual(f.handles[1].identities[0].inode, initialIdentity.inode);
    assert.equal(f.handles[1].identities[0].path, first.prepared.sourceIdentity);
    assert.equal(f.handles[1].identities[0].device, String(statSync(f.path, { bigint: true }).dev));
    assert.ok(f.handles.every(handle => handle.closeCalls === 1));
    assert.ok(f.base.connections.every(connection => connection.closed));
}));
test("actual legacy owner drains two admitted operations, rejects admission and consumes its receipt once", async () => withHandoffFixture(async (f) => {
    const gate = deferred();
    const pending = [2, 3].map(id => f.owner.run(async (open) => {
        const db = await open();
        await gate.promise;
        await db.runAsync("INSERT INTO unknown_evidence VALUES(?,X'ABCD')", id);
    }));
    const handoff = createNativeWorkspaceHandoff(f.options());
    const running = handoff.run("drain");
    try {
        await until(() => f.owner.state === "draining");
        assert.equal(f.owner.activeOperations, 2);
        assert.equal(handoff.state, "running");
        assert.equal(f.legacy.closes, 0);
        assert.equal(f.handles.length, 0);
        await assert.rejects(f.owner.run(open => open()), /access is closed/);
    }
    finally {
        gate.resolve();
    }
    await Promise.all(pending);
    const result = await running;
    assert.equal(result.state, "committed", String(result.error));
    assert.ok(result.prepared);
    const backup = new DatabaseSync(result.prepared.backup.identity, { readOnly: true });
    try {
        assert.equal(backup.prepare("SELECT count(*) AS n FROM unknown_evidence").get()!.n, 3);
    }
    finally {
        backup.close();
    }
    const receipt = await f.owner.quiesce();
    assert.equal(receipt, await f.owner.quiesce());
    assert.throws(() => f.owner.consumeQuiescence(receipt), /fresh quiescence receipt/);
    await assert.rejects(f.owner.run(open => open()), /access is closed/);
    assert.equal(f.owner.activeOperations, 0);
    assert.equal(f.legacy.closes, 1);
    assertSingleSourceClose(f);
}));
test("one-shot handoff refuses concurrent and subsequent runs without another retirement", async () => withHandoffFixture(async (f) => {
    const gate = deferred();
    const pending = f.owner.run(async (open) => { await open(); await gate.promise; });
    const handoff = createNativeWorkspaceHandoff(f.options());
    const first = handoff.run("first");
    try {
        await until(() => f.owner.state === "draining");
        await assert.rejects(handoff.run("second"), /already been used/);
    }
    finally {
        gate.resolve();
    }
    await pending;
    assert.equal((await first).state, "committed");
    await assert.rejects(handoff.run("third"), /already been used/);
    assert.equal(f.legacy.closes, 1);
    assertSingleSourceClose(f);
}));
test("bad capability, module, attempt, logical identity and strict path fail before legacy retirement", async () => {
    const cases = ["platform", "existing-version", "lease-version", "native-constructor", "wrapper-constructor", "module", "module-method", "sqlite", "attempt", "nonstring-attempt", "identity", "relative", "parent", "space", "unicode", "empty-component", "source-in-artifacts"];
    for (const problem of cases)
        await withHandoffFixture(async (f) => {
            const options = f.options();
            if (problem === "platform")
                options.source.platform = "ios";
            if (problem === "existing-version")
                Reflect.set(options.source.nativeModule, "cplayoutExistingOnlyVersion", 0);
            if (problem === "lease-version")
                Reflect.set(options.source.nativeModule, "cplayoutSourceLeaseVersion", "1");
            if (problem === "native-constructor")
                Reflect.set(options.source.nativeModule, "NativeDatabase", null);
            if (problem === "wrapper-constructor")
                Reflect.set(options.source, "SQLiteDatabase", null);
            if (problem === "module")
                options.module = null;
            if (problem === "module-method")
                Reflect.set(options.module!, "backupPath", null);
            if (problem === "sqlite")
                Reflect.set(options, "sqlite", {});
            if (problem === "identity")
                options.sourceIdentity = "logical-id";
            const badPaths: Record<string, string> = { relative: "source.db", parent: "/data/../source.db", space: "/data/source db", unicode: "/data/source\u00e9.db", "empty-component": "/data//source.db", "source-in-artifacts": f.base.native.artifactRoot + "/source.db" };
            if (badPaths[problem])
                options.expectedSourcePath = options.sourceIdentity = badPaths[problem];
            const before = snapshot(f.legacy.db);
            const handoff = createNativeWorkspaceHandoff(options);
            const result = await handoff.run(problem === "attempt" ? "bad/attempt" : problem === "nonstring-attempt" ? 5 as unknown as string : "first");
            assert.equal(result.state, "not_committed", problem + ": " + String(result.error));
            assert.equal(handoff.state, "not_committed");
            assert.ok(result.error);
            assert.equal(f.owner.state, "legacy", problem);
            assert.equal(f.legacy.closes, 0);
            assert.ok(!f.base.events.includes("source-construct"));
            assert.ok(!f.base.events.includes("allocate"));
            if (["identity", "relative", "parent", "space", "unicode", "empty-component", "attempt", "nonstring-attempt"].includes(problem)) {
                assert.ok(!f.base.events.includes("create-session"), problem + " must fail before session allocation");
            }
            assert.equal(snapshot(f.legacy.db), before);
            assert.equal(await f.owner.run(async (open) => (await open()).databasePath), f.path);
            await assert.rejects(handoff.run("retry"), /already been used/);
        });
});
for (const problem of ["transaction", "close", "open"] as const) {
    test("legacy " + problem + " failure requires recovery without allocating a new source", async () => withHandoffFixture(async (f) => {
        if (problem === "transaction")
            await f.owner.run(async (open) => { await (await open()).execAsync("BEGIN;"); });
        if (problem === "close")
            f.legacy.failClose = true;
        if (problem === "open") {
            f.faults.legacyOpen = true;
            await assert.rejects(f.owner.run(open => open()), /legacy-open-failure/);
        }
        const result = await createNativeWorkspaceHandoff(f.options()).run("failure");
        assert.equal(result.state, "recovery_required");
        assert.ok(result.error);
        assert.equal(f.owner.state, "recovery_required");
        assert.equal(f.handles.length, 0);
        assert.ok(!f.base.events.includes("source-construct"));
        if (problem === "open")
            assert.equal(f.legacyAllocated, false);
        else
            assert.equal(f.legacy.closes, problem === "close" ? 1 : 0);
        assert.equal(f.base.events.filter(event => event === "release").length, 1);
        await assert.rejects(f.owner.run(open => open()), /access is closed/);
    }, { primeLegacy: problem !== "open" }));
}
test("ordinary native constructor rejection is recovery after legacy retirement", async () => withHandoffFixture(async (f) => {
    f.faults.constructorFailure = true;
    const result = await createNativeWorkspaceHandoff(f.options()).run("constructor");
    assert.equal(result.state, "recovery_required");
    assert.ok(result.error instanceof AggregateError);
    assert.match(String(result.error.errors[0]), /ordinary-constructor-failure/);
    assert.equal(f.owner.state, "handed_off");
    assert.equal(f.legacy.closes, 1);
    assert.equal(f.handles.length, 0);
    assert.ok(!f.base.events.includes("source-close"));
    assert.equal(f.base.events.filter(event => event === "release").length, 1);
}));
test("existing-only fake constructor refuses a missing source without creating a database", async () => withHandoffFixture(async (f) => {
    unlinkSync(f.path);
    const result = await createNativeWorkspaceHandoff(f.options()).run("missing");
    assert.equal(result.state, "recovery_required");
    assert.equal(existsSync(f.path), false);
    assert.equal(f.legacy.closes, 1);
    assert.equal(f.handles.length, 0);
    assert.equal(f.base.events.filter(event => event === "release").length, 1);
}));
for (const problem of ["init", "assert", "wrapper"] as const)
    for (const closeFails of [false, true]) {
        test("source " + problem + " failure with closeFails=" + closeFails + " cleans up exactly once", async () => withHandoffFixture(async (f) => {
            const before = snapshot(f.legacy.db);
            if (problem === "assert")
                f.faults.assertAt = 1;
            else
                f.faults[problem] = true;
            f.faults.close = closeFails;
            const result = await createNativeWorkspaceHandoff(f.options()).run("failed-open");
            assert.equal(result.state, "recovery_required");
            assert.ok(result.error);
            assert.equal(f.owner.state, "handed_off");
            assert.equal(f.legacy.closes, 1);
            assertSingleSourceClose(f);
            assert.equal(onDiskSnapshot(f.path), before);
            assert.ok(!f.base.events.includes("allocate"));
            if (closeFails)
                assert.ok(result.error instanceof AggregateError);
        }));
    }
test("source close rejection after commit requires recovery and never retries close", async () => withHandoffFixture(async (f) => {
    f.faults.close = true;
    const result = await createNativeWorkspaceHandoff(f.options()).run("close");
    assert.equal(result.state, "recovery_required");
    assert.equal(result.cleanupErrors.length, 1);
    assert.match(String(result.cleanupErrors[0]), /injected SQL close failure/);
    assert.ok(f.base.events.includes("source-sql:COMMIT;"));
    assertSingleSourceClose(f);
}));
for (const assertion of [2, 3]) {
    test("final schema ownership assertion " + assertion + " requires recovery despite successful rollback", async () => withHandoffFixture(async (f) => {
        const before = snapshot(f.legacy.db);
        f.faults.assertAt = assertion;
        const handoff = createNativeWorkspaceHandoff(f.options());
        const result = await handoff.run("assert-final");
        assert.equal(result.state, "recovery_required", String(result.error));
        assert.equal(handoff.state, "recovery_required");
        assert.match(String(result.error), /source-assert-failure/);
        assert.deepEqual(result.cleanupErrors, []);
        assert.ok(result.prepared);
        assert.equal(onDiskSnapshot(result.prepared.backup.identity), before);
        assertRolledBack(f, before);
    }));
}
for (const part of ["path", "device", "inode"] as const) {
    test("changed live source " + part + " fails final verification, rolls back and closes once", async () => withHandoffFixture(async (f) => {
        const before = snapshot(f.legacy.db);
        f.faults.identityAt = 3;
        f.faults.identityPart = part;
        const result = await createNativeWorkspaceHandoff(f.options()).run("changed-identity");
        assert.equal(result.state, "recovery_required", String(result.error));
        assert.match(String(result.error), part === "path" ? /Invalid native source identity/ : /Source file identity changed/);
        assert.deepEqual(result.cleanupErrors, []);
        assertRolledBack(f, before);
    }));
}
test("concrete schema verifier rejects TEMP schema alone as not_committed with rollback", async () => withHandoffFixture(async (f) => {
    const before = snapshot(f.legacy.db);
    f.faults.schemaInvalid = true;
    const handoff = createNativeWorkspaceHandoff(f.options());
    const result = await handoff.run("invalid-schema");
    assert.equal(result.state, "not_committed", String(result.error));
    assert.equal(handoff.state, "not_committed");
    assert.match(String(result.error), /Native workspace schema: TEMP schema objects/);
    assert.deepEqual(result.cleanupErrors, []);
    assertRolledBack(f, before);
}));
test("captured dependency setters cannot replace the native bridge while legacy drains", async () => withHandoffFixture(async (f) => {
    const gate = deferred();
    const pending = f.owner.run(async (open) => { await open(); await gate.promise; });
    const options = f.options();
    const handoff = createNativeWorkspaceHandoff(options);
    const running = handoff.run("captured");
    let substituted = 0;
    const replacement = class {
        constructor() { substituted++; throw new Error("substituted bridge"); }
    };
    try {
        await until(() => f.owner.state === "draining");
        Reflect.set(options.source.nativeModule, "NativeDatabase", replacement);
        Reflect.set(options.source.nativeModule, "cplayoutSourceLeaseVersion", 0);
        Reflect.set(options.source.nativeModule, "cplayoutExistingOnlyVersion", 0);
        Reflect.set(options.source, "SQLiteDatabase", replacement);
        Reflect.set(options.source, "nativeModule", { NativeDatabase: replacement });
        options.source.platform = "web";
        options.expectedSourcePath = "/foreign.db";
        options.sourceIdentity = "/foreign.db";
    }
    finally {
        gate.resolve();
    }
    await pending;
    const result = await running;
    assert.equal(result.state, "committed", String(result.error));
    assert.equal(substituted, 0);
    assert.equal(result.prepared!.sourceIdentity, f.path);
    assert.equal(f.wrappers[0].nativeDatabase, f.handles[0]);
    assertSingleSourceClose(f);
}));
test("an unused legacy owner retires without ever opening the old database", async () => withHandoffFixture(async (f) => {
    assert.equal(f.legacyAllocated, false);
    const result = await createNativeWorkspaceHandoff(f.options()).run("unused-owner");
    assert.equal(result.state, "committed", String(result.error));
    assert.equal(f.legacyAllocated, false);
    assert.equal(f.owner.state, "handed_off");
    assert.ok(!f.base.events.includes("legacy-open"));
    assert.ok(!f.base.events.includes("legacy-close"));
    assertSingleSourceClose(f);
}, { primeLegacy: false }));
test("a rejected acknowledgment after commit requires recovery while retaining committed evidence", async () => withHandoffFixture(async (f) => {
    f.faults.commitAcknowledgment = true;
    const handoff = createNativeWorkspaceHandoff(f.options());
    const result = await handoff.run("commit-ack");
    assert.equal(result.state, "recovery_required");
    assert.equal(handoff.state, "recovery_required");
    assert.match(String(result.error), /commit-acknowledgment-failure/);
    assert.deepEqual(result.cleanupErrors, []);
    assert.ok(result.prepared);
    const db = new DatabaseSync(f.path, { readOnly: true });
    try {
        assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 12);
        assert.equal(db.prepare("SELECT receipt_json FROM cplayout_upgrade_receipts WHERE attempt_id=?")
            .get("commit-ack")!.receipt_json, JSON.stringify(result.prepared));
    }
    finally {
        db.close();
    }
    assert.ok(!f.base.events.includes("source-sql:ROLLBACK;"));
    assertSingleSourceClose(f);
    await assert.rejects(handoff.run("retry"), /already been used/);
}));
test("rollback failure remains recovery-required and preserves both failure causes", async () => withHandoffFixture(async (f) => {
    const before = snapshot(f.legacy.db);
    f.faults.assertAt = 2;
    f.faults.rollback = true;
    const result = await createNativeWorkspaceHandoff(f.options()).run("rollback-failed");
    assert.equal(result.state, "recovery_required");
    assert.match(String(result.error), /source-assert-failure/);
    assert.equal(result.cleanupErrors.length, 1);
    assert.match(String(result.cleanupErrors[0]), /rollback-failure/);
    assert.ok(result.prepared);
    assert.equal(onDiskSnapshot(result.prepared.backup.identity), before);
    assert.ok(f.base.events.includes("source-sql:ROLLBACK;"));
    assert.ok(!f.base.events.includes("source-sql:COMMIT;"));
    assertSingleSourceClose(f);
}));
