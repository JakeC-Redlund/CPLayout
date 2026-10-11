import assert from "node:assert/strict";
import test from "node:test";
import { defaultProjectSettings, sampleProject, type DesignDraft } from "../../../../core/src/index";
import { WorkspaceDocumentError } from "../../../src/workspaceDocument";
import type { WorkspaceCommand } from "../../../src/workspaceCommands";
import { createNativeReadyRepository, openNativeReadyRepository } from "../../../src/nativeReadyRepository";
import { withHandoffFixture } from "../test-overlays/handoffFixture";
import { assertSingleCloses, deferred, inspect, readyOptions, until, withReadyFixture } from "../test-overlays/readyFixture";
const now = "2026-09-27T06:00:00.000Z";
function client(id: string): WorkspaceCommand {
    return { type: "create_client", id, now,
        input: { primaryContactFirstName: "Synthetic", primaryContactLastName: id } };
}
function rejected(result: PromiseSettledResult<unknown>): unknown {
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected")
        throw new Error("Expected rejection");
    return result.reason;
}
function recoveryRequired(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "recovery_required";
}
test("cold current workspace is lazy, reads and saves through fresh retained sessions", async () => withReadyFixture(async ({ f, options, sourceOffset, eventOffset }) => {
    const ready = createNativeReadyRepository(options), api = ready.repository.versionedWorkspace;
    assert.equal(ready.state, "unopened");
    assert.equal(f.owner.state, "legacy");
    assert.equal(f.legacy.closes, 0);
    assert.equal(f.handles.length, sourceOffset);
    assert.equal(f.base.events.length, eventOffset);
    const before = await api.readAsync();
    assert.equal(before.revision, 0);
    assert.equal(before.projectDocuments[0].document, f.document);
    assert.equal(ready.state, "available");
    assert.equal(f.owner.state, "handed_off");
    assert.equal(f.legacy.closes, 1);
    const project = structuredClone(sampleProject);
    project.name = "Saved after cold startup";
    const saved = await api.executeAsync(before.revision, { type: "save_project", now, project, createOnly: false });
    assert.equal(saved.workspace.revision, 1);
    assert.equal((await ready.repository.loadProjectAsync(project.id))!.name, project.name);
    assert.equal((await api.readAsync()).revision, 1);
    const info = await ready.repository.getBackendInfoAsync();
    assert.equal(info.runtime, "native");
    assert.equal(info.schemaVersion, 12);
    const evidence = JSON.parse(await api.exportRecoveryAsync());
    assert.equal(evidence.legacyEvidence.snapshots[0].project_json, f.document);
    assert.equal(inspect(f.path, db => db.prepare("PRAGMA user_version").get()!.user_version), 12);
    assert.equal(inspect(f.path, db => db.prepare("SELECT project_json FROM project_snapshots").get()!.project_json), f.document);
    const events = f.base.events.slice(eventOffset);
    assert.ok(!events.includes("allocate"));
    assert.ok(!events.includes("backup"));
    assert.ok(!events.includes("publish-hex"));
    assert.ok(events.filter(value => value === "create-session").length > 1);
    assert.equal(events.filter(value => value === "create-session").length, events.filter(value => value === "release").length);
    assertSingleCloses(f);
    assert.ok(f.base.connections.every(connection => connection.closed));
}));
test("queued concurrent revisions serialize, reject stale writes and keep the owner available", async () => withReadyFixture(async ({ f, options, sourceOffset }) => {
    const gate = deferred();
    const legacyWork = f.owner.run(async (open) => { await open(); await gate.promise; });
    const ready = createNativeReadyRepository(options), api = ready.repository.versionedWorkspace;
    const first = api.executeAsync(0, client("first"));
    const second = api.executeAsync(0, client("stale"));
    const third = api.executeAsync(1, client("next"));
    const outcomes = Promise.allSettled([first, second, third]);
    try {
        await until(() => f.owner.state === "draining");
        assert.equal(ready.state, "active");
        assert.equal(f.handles.length, sourceOffset);
    }
    finally {
        gate.resolve();
    }
    await legacyWork;
    const [a, b, c] = await outcomes;
    assert.equal(a.status, "fulfilled");
    const error = rejected(b);
    assert.ok(error instanceof WorkspaceDocumentError && error.code === "conflict");
    assert.equal(c.status, "fulfilled");
    const current = await api.readAsync();
    assert.equal(current.revision, 2);
    assert.deepEqual(current.catalog.clients.map(value => value.id), ["first", "next"]);
    assert.equal(ready.state, "available");
    assert.equal(f.legacy.closes, 1);
    assertSingleCloses(f);
}));
for (const fault of ["close", "commitAcknowledgment"] as const) {
    test(fault + " failure latches recovery and blocks already queued and later native opens", async () => withReadyFixture(async ({ f, options, sourceOffset }) => {
        f.faults[fault] = true;
        const ready = createNativeReadyRepository(options), api = ready.repository.versionedWorkspace;
        const first = api.executeAsync(0, client("possibly-committed"));
        const outcomes = await Promise.allSettled([
            first, api.readAsync(), api.executeAsync(1, client("must-not-run")),
            ready.repository.getBackendInfoAsync(), api.exportRecoveryAsync(),
        ]);
        const primary = rejected(outcomes[0]);
        assert.ok(primary instanceof Error && "code" in primary && primary.code === "commit_uncertain");
        for (const outcome of outcomes.slice(1))
            assert.ok(recoveryRequired(rejected(outcome)));
        assert.equal(ready.state, "recovery_required");
        assert.equal(f.handles.length, sourceOffset + 1);
        delete f.faults[fault];
        await assert.rejects(api.readAsync(), recoveryRequired);
        assert.equal(f.handles.length, sourceOffset + 1);
        assert.equal(ready.state, "recovery_required");
        // Both injected faults happen after SQLite has actually committed.
        assert.equal(inspect(f.path, db => db.prepare("SELECT revision FROM cplayout_workspace_meta").get()!.revision), 1);
        assert.equal(inspect(f.path, db => db.prepare("SELECT count(*) AS n FROM cplayout_workspace_records WHERE kind='client'").get()!.n), 1);
        assertSingleCloses(f);
    }));
}
for (const corruption of ["invalid JSON", "identity mismatch"] as const) {
    test(corruption + " in stored document poisons the owner rather than acting as a command refusal", async () => withReadyFixture(async ({ f, options, sourceOffset }) => {
        const original = f.legacy.db.prepare("SELECT record_json FROM cplayout_workspace_records WHERE kind='project_document'").get()!.record_json;
        assert.equal(typeof original, "string");
        const row = JSON.parse(original as string);
        if (corruption === "invalid JSON")
            row.document = "{invalid persisted project JSON";
        else
            row.summary.name = "Wrong stored summary";
        const corrupt = JSON.stringify(row);
        f.legacy.db.prepare("UPDATE cplayout_workspace_records SET record_json=? WHERE kind='project_document'").run(corrupt);
        const ready = createNativeReadyRepository(options), api = ready.repository.versionedWorkspace;
        const outcomes = await Promise.allSettled([api.readAsync(), api.readAsync(), api.executeAsync(0, client("blocked"))]);
        const primary = rejected(outcomes[0]);
        if (corruption === "identity mismatch")
            assert.ok(primary instanceof WorkspaceDocumentError && primary.code === "identity_mismatch");
        assert.ok(recoveryRequired(rejected(outcomes[1])));
        assert.ok(recoveryRequired(rejected(outcomes[2])));
        assert.equal(ready.state, "recovery_required");
        assert.equal(f.handles.length, sourceOffset + 1);
        assert.equal(inspect(f.path, db => db.prepare("SELECT record_json FROM cplayout_workspace_records WHERE kind='project_document'").get()!.record_json), corrupt);
        await assert.rejects(api.readAsync(), recoveryRequired);
        assertSingleCloses(f);
    }));
}
test("mixed draft catalog and legacy design refusal leave valid workspace access available", async () => withReadyFixture(async ({ f, options }) => {
    const ready = createNativeReadyRepository(options), api = ready.repository.versionedWorkspace;
    await api.executeAsync(0, client("owner"));
    await api.executeAsync(1, { type: "create_project_with_initial_design", now,
        input: { clientId: "owner", project: { ...structuredClone(sampleProject), id: "owned-project" },
            fieldMapId: "field", designId: "complete" } });
    const settings = defaultProjectSettings();
    delete settings.aerialImagery.sourcePackageId;
    const draft: DesignDraft = { id: "draft", name: "Incomplete", projectCrs: null, settings,
        unitSystem: settings.unitSystem, fieldBoundary: [], pivotCenter: null, waterSource: null,
        powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
    await api.executeAsync(2, { type: "create_design_draft", now, designId: "draft-design", fieldMapId: "field", name: draft.name, draft });
    await assert.rejects(ready.repository.listProjectCatalogAsync(), /draft-aware/);
    assert.equal(ready.state, "available");
    await assert.rejects(ready.repository.loadDesignProjectAsync("draft-design"), /incomplete-design editor/);
    assert.equal(ready.state, "available");
    assert.equal((await api.readDesignAsync("draft-design")).kind, "draft");
    assert.equal((await ready.repository.loadDesignProjectAsync("complete"))!.id, "owned-project");
    assert.equal((await api.readAsync()).revision, 3);
    assert.equal(JSON.parse(await api.exportRecoveryAsync()).metaRows[0].revision, 3);
    assert.equal(ready.state, "available");
    assertSingleCloses(f);
}));
test("app startup returns only after a verified current-workspace read", async () => withReadyFixture(async ({ f, options, sourceOffset }) => {
    const runtime = await openNativeReadyRepository(options);
    assert.equal(runtime.state, "available");
    assert.equal(f.owner.state, "handed_off");
    assert.equal(f.handles.length, sourceOffset + 1);
    assert.equal(f.handles.at(-1)!.connection.closed, true);
    assertSingleCloses(f);
}));
test("ordinary startup refuses v11 without migration, admission or backup", async () => withHandoffFixture(async (f) => {
    const version = () => inspect(f.path, db => db.prepare("PRAGMA user_version").get()!.user_version);
    assert.equal(version(), 11);
    const offset = f.base.events.length;
    await assert.rejects(openNativeReadyRepository(readyOptions(f)), /no such table/);
    assert.equal(version(), 11);
    assert.equal(inspect(f.path, db => db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'cplayout_workspace_%'").get()!.n), 0);
    assert.equal(inspect(f.path, db => db.prepare("SELECT project_json FROM project_snapshots").get()!.project_json), f.document);
    for (const event of ["allocate", "backup", "publish-hex", "create-session"])
        assert.ok(!f.base.events.slice(offset).includes(event));
    assertSingleCloses(f);
}));
for (const invalid of ["platform", "capability", "path", "identity"] as const) {
    test("invalid " + invalid + " refuses construction before legacy retirement", async () => withReadyFixture(async ({ f, options, sourceOffset }) => {
        if (invalid === "platform")
            options.source.platform = "ios";
        if (invalid === "capability")
            Object.assign(options.source.nativeModule, { cplayoutSourceLeaseVersion: 0 });
        if (invalid === "path")
            options.expectedSourcePath = "/unsafe/../source.db";
        if (invalid === "identity")
            options.sourceIdentity = "/another.db";
        assert.throws(() => createNativeReadyRepository(options), /fresh legacy owner/);
        assert.equal(f.owner.state, "legacy");
        assert.equal(f.legacy.closes, 0);
        assert.equal(f.handles.length, sourceOffset);
    }));
}
test("save intent is captured before waiting on legacy retirement", async () => withReadyFixture(async ({ f, options }) => {
    const gate = deferred();
    const work = f.owner.run(async () => gate.promise);
    const runtime = createNativeReadyRepository(options);
    const command = client("original");
    assert.equal(command.type, "create_client");
    const pending = runtime.repository.versionedWorkspace.executeAsync(0, command);
    if (command.type === "create_client") {
        command.id = "mutated";
        command.input.primaryContactFirstName = "Mutated";
    }
    try {
        await until(() => f.owner.state === "draining");
    }
    finally {
        gate.resolve();
    }
    await work;
    const saved = await pending;
    assert.equal(saved.workspace.catalog.clients[0].id, "original");
    assert.equal(saved.workspace.catalog.clients[0].primaryContactFirstName, "Synthetic");
    assertSingleCloses(f);
}));
for (const fault of ["constructorFailure", "init", "wrapper", "assertAt", "rollback", "retained"] as const) {
    test(fault + " blocks all queued source opens after the first failure", async () => withReadyFixture(async ({ f, options, sourceOffset }) => {
        if (fault === "retained")
            f.base.faults.inspectionPostPath = true;
        else if (fault === "assertAt")
            f.faults.assertAt = 2;
        else
            f.faults[fault] = true;
        const runtime = createNativeReadyRepository(options), api = runtime.repository.versionedWorkspace;
        const outcomes = await Promise.allSettled([api.readAsync(), api.readAsync(), api.executeAsync(0, client("blocked"))]);
        rejected(outcomes[0]);
        assert.ok(recoveryRequired(rejected(outcomes[1])));
        assert.ok(recoveryRequired(rejected(outcomes[2])));
        assert.equal(runtime.state, "recovery_required");
        assert.equal(f.handles.length, sourceOffset + (fault === "constructorFailure" ? 0 : 1));
        assert.equal(inspect(f.path, db => db.prepare("SELECT revision FROM cplayout_workspace_meta").get()!.revision), 0);
        assertSingleCloses(f);
        assert.ok(f.base.connections.every(connection => connection.closed), "All source and inspection connections close before fixture teardown");
        assert.equal(f.base.events.filter(event => event === "create-session").length, f.base.events.filter(event => event === "release").length, "Artifact sessions release before fixture teardown");
    }));
}
test("unresolved live source close latches uncertainty without retrying close or opening queued work", async () => withReadyFixture(async ({ f, options, sourceOffset }) => {
    const Base = options.source.nativeModule.NativeDatabase;
    let closeAttempts = 0;
    options.source.nativeModule.NativeDatabase = class extends Base {
        async closeAsync() {
            closeAttempts++;
            throw new Error("physical close did not occur");
        }
    };
    const runtime = createNativeReadyRepository(options), api = runtime.repository.versionedWorkspace;
    const outcomes = await Promise.allSettled([api.executeAsync(0, client("committed")), api.readAsync(), api.exportRecoveryAsync()]);
    const primary = rejected(outcomes[0]);
    assert.ok(primary instanceof Error && "code" in primary && primary.code === "commit_uncertain");
    for (const outcome of outcomes.slice(1))
        assert.ok(recoveryRequired(rejected(outcome)));
    assert.equal(runtime.state, "recovery_required");
    assert.equal(closeAttempts, 1);
    assert.equal(f.handles.length, sourceOffset + 1);
    const live = f.handles.at(-1)!;
    assert.equal(live.connection.closed, false, "Physical source remains live until fixture-only teardown");
    assert.equal(live.connection.closes, 0);
    assert.equal(live.connection.db.isTransaction, false);
    assert.equal(live.connection.db.prepare("SELECT revision FROM cplayout_workspace_meta").get()!.revision, 1);
    const constructors = f.base.events.filter(event => event === "source-construct").length;
    await assert.rejects(api.readAsync(), recoveryRequired);
    assert.equal(f.base.events.filter(event => event === "source-construct").length, constructors);
    assert.equal(closeAttempts, 1);
    assert.equal(f.base.connections.filter(connection => !connection.closed).length, 1);
    assert.equal(f.base.events.filter(event => event === "create-session").length, f.base.events.filter(event => event === "release").length);
}));
test("captured source constructors and receipt configuration cannot change while queued", async () => withReadyFixture(async ({ f, options }) => {
    const runtime = createNativeReadyRepository(options);
    options.source.platform = "ios";
    Object.assign(options.source.nativeModule, { cplayoutSourceLeaseVersion: 0,
        NativeDatabase: class {
            constructor() { throw new Error("must not use replacement"); }
        } });
    options.expectedSourcePath = "/changed.db";
    options.sourceIdentity = "/changed.db";
    assert.equal((await runtime.repository.versionedWorkspace.readAsync()).revision, 0);
    assertSingleCloses(f);
}));
