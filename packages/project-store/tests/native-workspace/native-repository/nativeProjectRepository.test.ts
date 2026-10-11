import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { defaultProjectSettings, sampleProject, serializeProjectDocument, type DesignDraft } from "../../../../core/src/index";
import { SQLITE_MIGRATIONS } from "../../../src/persistenceSchema";
import { WorkspaceDocumentError } from "../../../src/workspaceDocument";
import type { WorkspaceCommand } from "../../../src/workspaceCommands";
import { bindWorkspaceStoreHost, workspaceMigrationPlan } from "../../../src/nativeWorkspaceBinding";
import { coordinateUpgrade, type PreparedUpgrade } from "../../../src/upgradeCoordinator";
import { createCrashHost, WorkspaceConnection } from "./workspaceCrashHost";
import { snapshot } from "./nodeSqliteTestSupport";
import { createNativeVersionedProjectRepository, describeNativeWorkspace } from "../../../src/nativeProjectRepository";
import { NativeWorkspaceStoreError } from "../../../src/sqliteWorkspaceStore";
const now = "2026-09-27T00:00:00.000Z";
const client: WorkspaceCommand = { type: "create_client", id: "client", now,
    input: { primaryContactFirstName: "Synthetic", primaryContactLastName: "Client" } };
function fixture(document = `\n ${serializeProjectDocument(sampleProject)}\n`) {
    const dir = mkdtempSync(join(import.meta.dirname, "repository-case-")), path = join(dir, "source.db");
    const setup = new DatabaseSync(path);
    setup.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON");
    for (const migration of SQLITE_MIGRATIONS) {
        for (const sql of migration.statements)
            setup.exec(sql);
        setup.prepare("INSERT INTO schema_migrations(id,name) VALUES(?,?)").run(migration.id, migration.name);
        setup.exec(`PRAGMA user_version=${migration.id}`);
    }
    setup.prepare("INSERT INTO projects(id,name,project_crs,unit_system,source_json_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(sampleProject.id, sampleProject.name, sampleProject.projectCrs, sampleProject.unitSystem, "pivot-project-v1", now, now);
    setup.prepare("INSERT INTO project_snapshots VALUES(?,?,?)").run(sampleProject.id, document, now);
    setup.close();
    const opened: WorkspaceConnection[] = [], cleanup: unknown[] = [];
    const hooks: {
        after?: (sql: string) => void;
    } = {};
    async function open() {
        const db = new WorkspaceConnection(new DatabaseSync(path), undefined, sql => hooks.after?.(sql));
        opened.push(db);
        try {
            await db.execAsync("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=100; PRAGMA read_uncommitted=OFF");
            return db;
        }
        catch (error) {
            await db.closeAsync();
            throw error;
        }
    }
    const { host: upgrade, context } = createCrashHost(dir, open);
    const host = bindWorkspaceStoreHost({ openReadyConnection: open,
        async captureLegacyRecovery(db) { return { snapshots: await db.getAllAsync("SELECT * FROM main.project_snapshots ORDER BY project_id") }; },
        reportCleanupError(error) { cleanup.push(error); },
    }, context);
    const repository = createNativeVersionedProjectRepository(host);
    async function admit() {
        const result = await coordinateUpgrade(upgrade, workspaceMigrationPlan(), "admission");
        assert.equal(result.state, "committed", String(result.error));
        assert.deepEqual(result.cleanupErrors, []);
        return result.prepared!;
    }
    function inspect<T>(fn: (db: DatabaseSync) => T) {
        const db = new DatabaseSync(path);
        try {
            return fn(db);
        }
        finally {
            db.close();
        }
    }
    return { dir, path, document, host, repository, api: repository.versionedWorkspace, admit, opened, hooks, inspect, cleanup };
}
test("constructing the native facade performs no IO and exposes no admission operation", () => {
    const f = fixture();
    assert.equal(f.opened.length, 0);
    assert.deepEqual(Object.keys(f.api).sort(), ["executeAsync", "exportRecoveryAsync", "readAsync", "readDesignAsync"]);
});
test("unadmitted native reads do not auto-migrate, fabricate defaults or report ready metadata", async () => {
    const f = fixture(), before = f.inspect(snapshot);
    for (const read of [() => f.api.readAsync(), () => f.repository.getBackendInfoAsync(), () => f.repository.listProjectsAsync()]) {
        await assert.rejects(read);
        assert.equal(f.inspect(snapshot), before);
    }
    assert.ok(f.opened.every(connection => connection.closed));
});
test("all legacy-shaped native writes reject before opening any database", async () => {
    const f = fixture(), before = f.inspect(snapshot);
    for (const method of ["saveProjectAsync", "saveDesignProjectAsync", "deleteProjectAsync", "createClientAsync", "updateClientAsync", "deleteClientAsync",
        "createProjectWithInitialDesignAsync", "createProjectWithInitialFieldMapAsync", "createProjectRecordAsync", "renameProjectAsync",
        "moveProjectToClientAsync", "createFieldMapRecordAsync", "createDesignRecordAsync"] as const) {
        await assert.rejects(() => (f.repository[method] as () => Promise<unknown>)(), error => error instanceof WorkspaceDocumentError && error.code === "conflict");
    }
    assert.equal(f.opened.length, 0);
    assert.equal(f.inspect(snapshot), before);
});
test("native metadata describes its accepted snapshot without rereading or borrowing web identity", async () => {
    const f = fixture();
    await f.admit();
    const snapshot = await f.api.readAsync(), calls = f.opened.length;
    const info = f.repository.describeWorkspace(snapshot);
    assert.equal(f.opened.length, calls);
    assert.equal(info.backendLabel, "Expo SQLite");
    assert.equal(info.runtime, "native");
    assert.equal(info.storageEngine, "sqlite");
    assert.equal(info.schemaVersion, 12);
    assert.equal(info.projectCount, 1);
    assert.equal(info.supportsZipImport, false);
    assert.equal(info.supportsZipExport, false);
    info.notes.length = 0;
    assert.ok(f.repository.describeWorkspace(snapshot).notes.length > 0);
    assert.deepEqual(await f.repository.getBackendInfoAsync(), f.repository.describeWorkspace(snapshot));
    await f.api.executeAsync(0, { type: "save_project", now, project: { ...structuredClone(sampleProject), id: "second" }, createOnly: true });
    assert.equal(f.repository.describeWorkspace(snapshot).projectCount, 1);
    assert.equal((await f.repository.getBackendInfoAsync()).projectCount, 2);
    assert.throws(() => describeNativeWorkspace({ ...snapshot, revision: -1 }));
});
test("standalone projects use the admitted workspace and stay detached from callers", async () => {
    const f = fixture();
    await f.admit();
    assert.deepEqual(await f.repository.listProjectCatalogAsync(), { clients: [], projects: [], fieldMaps: [], designs: [] });
    const list = await f.repository.listProjectsAsync();
    assert.equal(list[0].id, sampleProject.id);
    list[0].name = "caller";
    const loaded = await f.repository.loadProjectAsync(sampleProject.id);
    assert.ok(loaded);
    assert.deepEqual(loaded.fieldBoundary, sampleProject.fieldBoundary);
    loaded.fieldBoundary[0].x++;
    assert.equal((await f.repository.loadProjectAsync(sampleProject.id))!.fieldBoundary[0].x, sampleProject.fieldBoundary[0].x);
    assert.equal((await f.repository.listProjectsAsync())[0].name, sampleProject.name);
    assert.equal(await f.repository.loadProjectAsync("missing"), null);
    assert.equal(await f.repository.loadDesignProjectAsync("missing"), null);
    assert.equal((await f.api.readAsync()).projectDocuments[0].document, f.document);
});
test("complete owned designs and incomplete drafts remain distinct through the native facade", async () => {
    const f = fixture();
    await f.admit();
    await f.api.executeAsync(0, client);
    await f.api.executeAsync(1, { type: "create_project_with_initial_design", now,
        input: { clientId: "client", project: { ...structuredClone(sampleProject), id: "owned" }, fieldMapId: "field", designId: "complete" } });
    assert.equal((await f.repository.loadDesignProjectAsync("complete"))!.id, "owned");
    const settings = defaultProjectSettings();
    delete settings.aerialImagery.sourcePackageId;
    const draft: DesignDraft = { id: "draft", name: "Incomplete", projectCrs: null, settings, unitSystem: settings.unitSystem,
        fieldBoundary: [], pivotCenter: null, waterSource: null, powerSource: null, machine: {}, obstacles: [], surveyPoints: [] };
    let state = (await f.api.executeAsync(2, { type: "create_design_draft", now, designId: "draft-design", fieldMapId: "field", name: draft.name, draft })).workspace;
    await assert.rejects(f.repository.listProjectCatalogAsync(), /draft-aware/);
    await assert.rejects(f.repository.loadDesignProjectAsync("draft-design"), /incomplete-design editor/);
    assert.equal((await f.repository.listProjectsAsync()).length, 2);
    for (const count of [0, 1, 2]) {
        const opened = await createNativeVersionedProjectRepository(f.host).versionedWorkspace.readDesignAsync("draft-design");
        assert.equal(opened.kind, "draft");
        if (opened.kind !== "draft")
            throw new Error("Expected draft");
        assert.equal(opened.draft.fieldBoundary.length, count);
        assert.equal(opened.draft.pivotCenter, null);
        assert.deepEqual(opened.draft.machine, {});
        assert.equal(opened.workspaceRevision, state.revision);
        if (count < 2) {
            opened.draft.projectCrs = "EPSG:32613";
            opened.draft.fieldBoundary.push({ x: 500000 + count, y: 4500000 + count });
            state = (await f.api.executeAsync(state.revision, { type: "save_design_draft", now,
                designId: opened.design.id, expectedDesignRevision: opened.design.revision, draft: opened.draft })).workspace;
        }
    }
    assert.equal(state.projectDocuments[0].document, f.document);
    await f.api.executeAsync(state.revision, { type: "delete_design", now, designId: "draft-design", expectedDesignRevision: 2 });
    assert.equal((await f.api.readDesignAsync("draft-design")).kind, "not_found");
    assert.equal((await f.repository.listProjectCatalogAsync()).designs.length, 1);
});
test("two native facades reject stale writes and cannot recreate deleted documents", async () => {
    const f = fixture();
    await f.admit();
    const second = createNativeVersionedProjectRepository(f.host);
    await f.api.executeAsync(0, client);
    const before = f.inspect(snapshot);
    await assert.rejects(second.versionedWorkspace.executeAsync(0, client), /reload before saving/);
    assert.equal(f.inspect(snapshot), before);
    await f.api.executeAsync(1, { type: "delete_project", now, projectId: sampleProject.id });
    await assert.rejects(second.versionedWorkspace.executeAsync(2, { type: "save_project", now, project: structuredClone(sampleProject), createOnly: true }), /used or deleted/);
    assert.equal(await f.repository.loadProjectAsync(sampleProject.id), null);
    assert.equal((await f.api.readAsync()).tombstones.length, 1);
    assert.equal(f.inspect(db => db.prepare("SELECT project_json FROM main.project_snapshots").get()!.project_json), f.document);
});
test("native facade propagates uncertain commit without retry and reconciles by reopening", async () => {
    const f = fixture();
    await f.admit();
    f.hooks.after = sql => { if (sql === "COMMIT;")
        throw new Error("lost bridge acknowledgement"); };
    await assert.rejects(f.api.executeAsync(0, client), error => error instanceof NativeWorkspaceStoreError && error.code === "commit_uncertain");
    f.hooks.after = undefined;
    await assert.rejects(f.api.executeAsync(0, client), /reload before saving/);
    const current = await createNativeVersionedProjectRepository(f.host).versionedWorkspace.readAsync();
    assert.equal(current.revision, 1);
    assert.equal(current.catalog.clients.length, 1);
    assert.ok(f.opened.every(connection => connection.closed));
    assert.deepEqual(f.cleanup, []);
});
test("unknown project fields are withheld from native editing while exact recovery remains available", async () => {
    const raw = JSON.parse(serializeProjectDocument(sampleProject));
    raw.project.machine.extension = { retain: "evidence" };
    const f = fixture(JSON.stringify(raw));
    await f.admit();
    const before = f.inspect(snapshot);
    await assert.rejects(f.repository.loadProjectAsync(sampleProject.id), /unsupported fields/);
    assert.equal((await f.api.readAsync()).projectDocuments[0].document, f.document);
    const recovery = JSON.parse(await f.api.exportRecoveryAsync());
    assert.equal(recovery.legacyEvidence.snapshots[0].project_json, f.document);
    assert.equal(f.inspect(snapshot), before);
});
test("backup corruption cannot be bypassed by native facade reads or metadata", async () => {
    const f = fixture(), prepared: PreparedUpgrade = await f.admit();
    const bytes = readFileSync(prepared.backup.identity);
    bytes[100] ^= 1;
    writeFileSync(prepared.backup.identity, bytes);
    const before = f.inspect(snapshot);
    await assert.rejects(f.repository.listProjectsAsync());
    await assert.rejects(f.repository.getBackendInfoAsync());
    await assert.rejects(f.repository.loadProjectAsync(sampleProject.id));
    await assert.rejects(f.api.executeAsync(0, client));
    assert.equal(f.inspect(snapshot), before);
    assert.equal(JSON.parse(await f.api.exportRecoveryAsync()).legacyEvidence.snapshots[0].project_json, f.document);
});
