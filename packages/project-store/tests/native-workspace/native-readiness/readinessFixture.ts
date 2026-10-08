import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { sampleProject, serializeProjectDocument, type GnssCaptureEvidenceV2 } from "../../../../core/src/index";
import { SQLITE_MIGRATIONS } from "../../../src/persistenceSchema";
import { bindWorkspaceStoreHost, workspaceMigrationPlan, type BoundDatabase } from "../../../src/nativeWorkspaceBinding";
import { createNativeVersionedProjectRepository } from "../../../src/nativeProjectRepository";
import { createNativeBackupOperations } from "../../../src/nativeBackupHost";
import { createExpoBackupPorts } from "../../../src/expoBackupPorts";
import { readWorkspaceInTransaction } from "../../../src/sqliteWorkspaceStore";
import { snapshot } from "../native-repository/nodeSqliteTestSupport";
import { openNativeArtifactSession, receiptFromHex, receiptToHex, type BackupArtifactsModule } from "../../../src/nativeArtifactSession";
import { createNativeWorkspaceUpgradeRunner, type NativeWorkspaceUpgradeOptions } from "../../../src/nativeWorkspaceUpgrade";
import { setup } from "../native-integration/nodeFixture";
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const now = "2026-09-27T05:00:00.000Z";
export type Fixture = ReturnType<typeof setup>;
export async function fixture(body: (f: Fixture) => Promise<void>) {
    const f = setup();
    try {
        await body(f);
    }
    finally {
        for (const c of f.connections)
            if (!c.closed) {
                c.db.close();
                c.closed = true;
            }
    }
}
export function seed(f: Fixture, version: number, journal: string) {
    f.source.db.exec("DROP TABLE data; DROP TABLE schema_migrations; PRAGMA user_version=0; PRAGMA journal_mode=" + journal + "; PRAGMA wal_autocheckpoint=0;");
    for (const migration of SQLITE_MIGRATIONS.filter(m => m.id <= version)) {
        for (const sql of migration.statements)
            f.source.db.exec(sql);
        f.source.db.prepare("INSERT INTO schema_migrations(id,name) VALUES(?,?)").run(migration.id, migration.name);
        f.source.db.exec("PRAGMA user_version=" + migration.id);
    }
    const document = "\n " + serializeProjectDocument(sampleProject) + "\n";
    if (version) {
        f.source.db.prepare("INSERT INTO projects(id,name,project_crs,unit_system,source_json_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
            .run(sampleProject.id, sampleProject.name, sampleProject.projectCrs, sampleProject.unitSystem, "pivot-project-v1", now, now);
        f.source.db.prepare("INSERT INTO project_snapshots VALUES(?,?,?)").run(sampleProject.id, document, now);
        f.source.db.exec("CREATE TABLE unknown_evidence(id INTEGER PRIMARY KEY,value BLOB); INSERT INTO unknown_evidence VALUES(1,X'00FF');");
    }
    return document;
}
// Real Node SQLite below a simulated Expo/module boundary, not JNI or Android evidence.
export function options(f: Fixture, overrides: Partial<NativeWorkspaceUpgradeOptions> = {}) {
    const native = f.session();
    let sessionCreated = false, counter = 0;
    const active = (id: string) => { assert.equal(id, "session"); assert.ok(sessionCreated); };
    const module: BackupArtifactsModule = {
        protocolVersion: 1,
        async createSession() { assert.equal(sessionCreated, false); sessionCreated = true; f.events.push("create-session"); return { protocolVersion: 1, sessionId: "session", artifactRoot: native.artifactRoot }; },
        async allocateAttempt(s, id) { active(s); return native.allocateAttempt(id); },
        async openRetainedAttempt(s, id) { active(s); return native.openRetainedAttempt(id); },
        async backupPath(s, h) { active(s); return native.backupPath(h); },
        async sealBackup(s, h) { active(s); return native.sealBackup(h); },
        async verifyAndCopy(s, h, d, id) { active(s); return native.verifyAndCopy(h, d, id); },
        async inspectionPath(s, h) { active(s); return native.inspectionPath(h); },
        async closeInspection(s, h) { active(s); return native.closeInspection(h); },
        async publishPreparedHex(s, h, hex) { active(s); f.events.push("publish-hex"); return native.publishPrepared(h, receiptFromHex(hex)); },
        async readPreparedHex(s, h) { active(s); return receiptToHex(await native.readPrepared(h)); },
        async releaseSession(s) { active(s); await native.release(); sessionCreated = false; },
    };
    const result: NativeWorkspaceUpgradeOptions = {
        module, sqlite: f.sqlite, sourceIdentity: f.source.expo.databasePath,
        expectedSourcePath: f.source.expo.databasePath,
        async openSource() { f.events.push("source-open"); return f.source.expo; },
        async sha256(text) { return sha(text); }, newInspectionId: () => "copy-" + (++counter),
        async verifyTargetSchema(db: BoundDatabase) {
            const expected = new DatabaseSync(":memory:");
            try {
                for (const migration of workspaceMigrationPlan())
                    for (const sql of migration.statements)
                        expected.exec(sql);
                const rows = await db.getAllAsync<{
                    name: string;
                }>("SELECT type,name,tbl_name,sql FROM main.sqlite_schema ORDER BY name");
                for (const row of expected.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all()) {
                    assert.deepEqual(rows.find(r => r.name === row.name), row);
                }
            }
            finally {
                expected.close();
            }
        }, ...overrides,
    };
    return result;
}
for (const journal of ["DELETE", "WAL"])
    for (const version of [0, 8, 10, 11]) {
        test(journal + " v" + version + " composes module receipt transport, backup, admission, close and release", async () => fixture(async (f) => {
            const document = seed(f, version, journal), before = snapshot(f.source.db);
            const result = await createNativeWorkspaceUpgradeRunner(options(f)).run("first");
            assert.equal(result.state, "committed", String(result.error));
            assert.deepEqual(result.cleanupErrors, []);
            assert.equal(f.source.closes, 1);
            assert.ok(f.connections.every(c => c.closed));
            assert.ok(f.events.indexOf("create-session") < f.events.indexOf("source-open"));
            assert.ok(f.events.includes("publish-hex"));
            assert.equal(f.events.at(-1), "release");
            const savedBytes = readFileSync(result.prepared!.backup.identity);
            assert.equal(sha(savedBytes), result.prepared!.backup.sha256);
            const saved = new DatabaseSync(result.prepared!.backup.identity, { readOnly: true });
            try {
                assert.equal(snapshot(saved), before);
            }
            finally {
                saved.close();
            }
            const reopened = f.connection(f.source.expo.databasePath);
            await reopened.expo.execAsync("BEGIN;");
            const workspace = await readWorkspaceInTransaction(reopened.expo, async () => { });
            assert.equal(workspace.revision, 0);
            if (version)
                assert.equal(workspace.projectDocuments[0].document, document);
            else
                assert.equal(workspace.projectDocuments.length, 0);
            await reopened.expo.execAsync("ROLLBACK;");
            const allocationCount = f.events.filter(e => e === "allocate").length;
            const unchanged = await createNativeWorkspaceUpgradeRunner(options(f, { openSource: async () => reopened.expo })).run("second");
            assert.equal(unchanged.state, "unchanged", String(unchanged.error));
            assert.deepEqual(unchanged.cleanupErrors, []);
            assert.equal(f.events.filter(e => e === "allocate").length, allocationCount);
            assert.equal(reopened.closes, 1);
            assert.deepEqual(readFileSync(result.prepared!.backup.identity), savedBytes);
        }));
    }
for (const problem of ["module", "sqlite", "path", "source-in-artifacts", "attempt", "non-string-attempt"] as const) {
    test(problem + " configuration rejects before opening source", async () => fixture(async (f) => {
        const o = options(f);
        if (problem === "module")
            o.module = null;
        if (problem === "sqlite")
            o.sqlite = {} as typeof o.sqlite;
        if (problem === "path")
            o.expectedSourcePath = "/data/../source.db";
        if (problem === "source-in-artifacts")
            o.expectedSourcePath = f.native.artifactRoot + "/source.db";
        const before = snapshot(f.source.db);
        const result = await createNativeWorkspaceUpgradeRunner(o).run(problem === "attempt" ? "bad/attempt" : problem === "non-string-attempt" ? 123 as unknown as string : "first");
        assert.equal(result.state, "not_committed");
        assert.ok(result.error);
        assert.ok(!f.events.includes("source-open"));
        assert.ok(!f.events.includes("allocate"));
        assert.equal(snapshot(f.source.db), before);
        assert.equal(f.source.closes, 0);
    }));
}
test("migrated native facade saves complete capture evidence with revision checks and leaves legacy bytes intact", async () => fixture(async (f) => {
    const legacyDocument = seed(f, 11, "WAL");
    const migrated = await createNativeWorkspaceUpgradeRunner(options(f)).run("first");
    assert.equal(migrated.state, "committed", String(migrated.error));
    const retainedBefore = readFileSync(migrated.prepared!.backup.identity);
    const context = {
        sourceIdentity: f.source.expo.databasePath, sha256: async (text: string) => sha(text),
        async verifyRetainedPrepared(receipt: NonNullable<typeof migrated.prepared>) {
            const o = options(f), session = await openNativeArtifactSession(o.module);
            const adapter = createExpoBackupPorts({ native: session, sqlite: f.sqlite, newInspectionId: o.newInspectionId });
            const errors: unknown[] = [];
            try {
                const operations = await createNativeBackupOperations({ sourceIdentity: o.sourceIdentity, expectedSourcePath: o.expectedSourcePath,
                    plan: workspaceMigrationPlan(), sha256: o.sha256, ports: adapter.ports });
                await operations.verifyRetainedPrepared(receipt);
            }
            catch (error) {
                errors.push(error);
            }
            try {
                await adapter.release();
            }
            catch (error) {
                errors.push(error);
            }
            if (errors.length)
                throw new AggregateError(errors);
        },
    };
    const repo = createNativeVersionedProjectRepository(bindWorkspaceStoreHost({
        async openReadyConnection() {
            const db = f.connection(f.source.expo.databasePath).expo;
            await db.execAsync("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA read_uncommitted=OFF; PRAGMA busy_timeout=1000;");
            return db;
        },
        async captureLegacyRecovery(db) { return db.getAllAsync("SELECT project_json FROM main.project_snapshots"); },
    }, context));
    const initial = await repo.versionedWorkspace.readAsync();
    const project = (await repo.loadProjectAsync(sampleProject.id))!;
    const evidence: GnssCaptureEvidenceV2 = {
        schemaVersion: "gnss-capture-v2", observationId: "synthetic-session:epoch-1", sessionId: "synthetic-session",
        transport: "web_serial", receivedAt: now, receiverObservedAt: now, receivedMonotonicMs: 1000,
        sourceCoordinateFrame: "EPSG:4326", coherent: true, antennaReference: "arp", sentenceTypes: ["GGA", "GST", "RMC"],
        height: { meters: 1500, type: "orthometric", geoidSeparationMeters: -20 },
        referenceDeclaration: {
            schemaVersion: "gnss-reference-declaration-v1", provenance: "operator_declared", receiverModel: "Synthetic receiver",
            receiverFirmware: "synthetic-v1", referenceFrame: "WGS84", realization: "Synthetic frame", coordinateEpochUtc: now,
            verticalDatum: "Synthetic datum", geoidModel: "Synthetic geoid", antennaModel: "Synthetic antenna", antennaReference: "arp",
            reportedPoint: "Antenna ARP", targetPoint: "Antenna ARP", antennaHeightMeters: 2, offsetTreatment: "none_reported_point",
        },
        qualityScreen: {
            policy: "cplayout-nmea-collection-v2", uncertaintySource: "nmea_gst_component_standard_deviations",
            receiverQuality: { fixType: "rtk_fixed", satellites: 16, hdop: 0.7, vdop: null, pdop: null,
                correctionAgeSeconds: 1, horizontalAccuracyMeters: 0.02, verticalAccuracyMeters: 0.04, nmeaQualityCode: 4 },
            thresholds: { minimumFixType: "rtk_fixed", minSatellites: 10, maxHdop: 2, maxHorizontalAccuracyMeters: 0.05,
                maxCorrectionAgeSeconds: 3, maxObservationAgeSeconds: 2 }, evaluatedMonotonicMs: 1000, physicalQualification: "unverified",
        },
    };
    project.surveyPoints.push({ id: "synthetic-control", label: "Synthetic control", role: "water_source", projected: { ...project.waterSource },
        observedAt: now, source: "external_gnss", confidence: "rtk_fixed", rtk: evidence.qualityScreen.receiverQuality, captureEvidence: evidence });
    project.infrastructureObservationRefs = { water_source: "synthetic-control" };
    await repo.versionedWorkspace.executeAsync(initial.revision, { type: "save_project", now, project, createOnly: false });
    const reopened = (await repo.loadProjectAsync(project.id))!;
    assert.deepEqual(reopened.surveyPoints.at(-1)?.captureEvidence, evidence);
    assert.equal(reopened.infrastructureObservationRefs?.water_source, "synthetic-control");
    const savedEvidence = reopened.surveyPoints.at(-1)?.captureEvidence;
    assert.ok(savedEvidence?.schemaVersion === "gnss-capture-v2");
    assert.equal(savedEvidence.qualityScreen.physicalQualification, "unverified");
    await assert.rejects(repo.versionedWorkspace.executeAsync(initial.revision, { type: "save_project", now, project, createOnly: false }), /reload/i);
    const db = new DatabaseSync(f.source.expo.databasePath);
    try {
        assert.equal(db.prepare("SELECT project_json FROM project_snapshots").get()!.project_json, legacyDocument);
        assert.equal(db.prepare("SELECT count(*) AS n FROM survey_points WHERE id='synthetic-control'").get()!.n, 0);
        assert.throws(() => db.prepare("UPDATE projects SET name='bypass'").run(), /legacy/i);
    }
    finally {
        db.close();
    }
    assert.deepEqual(readFileSync(migrated.prepared!.backup.identity), retainedBefore);
    assert.ok(f.connections.every(c => c.closed));
    assert.equal(f.events.filter(e => e === "create-session").length, f.events.filter(e => e === "release").length);
}));
test("source opener rejection releases the already created session", async () => fixture(async (f) => {
    const result = await createNativeWorkspaceUpgradeRunner(options(f, { openSource: async () => { throw Error("open-failure"); } })).run("first");
    assert.equal(result.state, "not_committed");
    assert.match(String(result.error), /open-failure/);
    assert.equal(f.events.at(-1), "release");
    assert.equal(f.source.closes, 0);
}));
test("invalid session descriptor plus failed release requires recovery without opening source or retrying", async () => fixture(async (f) => {
    const o = options(f);
    let releases = 0;
    o.module!.createSession = async () => ({ sessionId: "owned-session", protocolVersion: 1, artifactRoot: "invalid" });
    const failure = new Error("uncertain-session-release");
    o.module!.releaseSession = async (id) => { assert.equal(id, "owned-session"); releases++; throw failure; };
    const result = await createNativeWorkspaceUpgradeRunner(o).run("first");
    assert.equal(result.state, "recovery_required");
    assert.equal(releases, 1);
    assert.ok(!f.events.includes("source-open"));
    assert.equal(f.source.closes, 0);
    assert.ok(result.error instanceof AggregateError);
    assert.deepEqual(result.cleanupErrors, [result.error]);
    assert.equal(result.error.errors[1], failure);
}));
for (const problem of ["path", "private", "hash"] as const) {
    test("setup " + problem + " failure closes transferred source once", async () => fixture(async (f) => {
        const o = options(f);
        if (problem === "path")
            o.expectedSourcePath = "/wrong.db";
        if (problem === "private")
            f.source.expo.options.useNewConnection = false;
        if (problem === "hash")
            o.sha256 = async () => "invalid";
        const result = await createNativeWorkspaceUpgradeRunner(o).run("first");
        assert.equal(result.state, "not_committed");
        assert.ok(result.error);
        assert.equal(f.source.closes, 1);
        assert.equal(f.events.at(-1), "release");
        assert.ok(!f.events.includes("allocate"));
    }));
}
test("runner is single-use, including concurrent calls", async () => fixture(async (f) => {
    seed(f, 11, "DELETE");
    const runner = createNativeWorkspaceUpgradeRunner(options(f));
    const first = runner.run("first");
    await assert.rejects(runner.run("second"), /already been used/);
    assert.equal((await first).state, "committed");
    await assert.rejects(runner.run("third"), /already been used/);
}));
for (const problem of ["backup", "destination-close", "target", "receipt", "source-close", "session-release", "commit-rejection"] as const) {
    test(problem + " failure retains evidence and never publishes a false ready result", async () => fixture(async (f) => {
        seed(f, 11, "WAL");
        const before = snapshot(f.source.db), o = options(f);
        if (problem === "backup")
            f.faults.backup = true;
        if (problem === "destination-close")
            f.faults.close = true;
        if (problem === "target")
            o.verifyTargetSchema = async () => { throw Error("target-failure"); };
        if (problem === "receipt")
            o.module!.publishPreparedHex = async () => { throw Error("receipt-failure"); };
        if (problem === "source-close")
            f.source.failClose = true;
        if (problem === "session-release")
            o.module!.releaseSession = async () => { f.events.push("release-failure"); throw Error("release-failure"); };
        if (problem === "commit-rejection") {
            const exec = f.source.expo.execAsync.bind(f.source.expo);
            f.source.expo.execAsync = async (sql) => { await exec(sql); if (sql === "COMMIT;")
                throw Error("lost-commit-ack"); };
        }
        const result = await createNativeWorkspaceUpgradeRunner(o).run("first");
        const uncertain = ["destination-close", "source-close", "session-release", "commit-rejection"].includes(problem);
        assert.equal(result.state, uncertain ? "recovery_required" : "not_committed", String(result.error));
        assert.equal(f.source.closes, 1);
        const db = new DatabaseSync(f.source.expo.databasePath);
        try {
            if (["source-close", "session-release", "commit-rejection"].includes(problem)) {
                assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 12);
            }
            else
                assert.equal(snapshot(db), before);
        }
        finally {
            db.close();
        }
        if (result.prepared)
            assert.equal(sha(readFileSync(result.prepared.backup.identity)), result.prepared.backup.sha256);
        assert.ok(existsSync(f.native.artifactRoot + "/first/backup.db"));
    }));
}
