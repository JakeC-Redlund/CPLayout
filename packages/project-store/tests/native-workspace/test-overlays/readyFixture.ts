// Real Node SQLite with fake native interfaces. This is not Android/JNI proof.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { withHandoffFixture, type HandoffFixture } from "./handoffFixture";
import { createNativeWorkspaceHandoff } from "../../../src/nativeWorkspaceHandoff";
import type { BackupArtifactsModule } from "../../../src/nativeArtifactSession";
import type { PreparedUpgrade } from "../../../src/upgradeCoordinator";
import type { NativeReadyRepositoryOptions } from "../../../src/nativeReadyRepository";
export { deferred, until } from "./handoffFixture";
// The prior fixture's module wraps a one-use session. Give every verification a
// fresh module, translating its private session ID through a unique public ID.
function artifactModule(f: HandoffFixture): BackupArtifactsModule {
    const sessions = new Map<string, {
        module: BackupArtifactsModule;
        id: string;
    }>();
    let sequence = 0;
    function session(id: string) {
        const value = sessions.get(id);
        assert.ok(value, "Artifact call must target a live fixture session");
        return value;
    }
    return {
        protocolVersion: 1,
        async createSession() {
            const module = f.options().module;
            assert.ok(module);
            const descriptor = await module.createSession();
            assert.ok(descriptor && typeof descriptor === "object" && "sessionId" in descriptor);
            assert.equal(typeof descriptor.sessionId, "string");
            const id = "ready-session-" + (++sequence);
            sessions.set(id, { module, id: descriptor.sessionId as string });
            return { ...descriptor, sessionId: id };
        },
        allocateAttempt(id, attempt) { const s = session(id); return s.module.allocateAttempt(s.id, attempt); },
        openRetainedAttempt(id, attempt) { const s = session(id); return s.module.openRetainedAttempt(s.id, attempt); },
        backupPath(id, handle) { const s = session(id); return s.module.backupPath(s.id, handle); },
        sealBackup(id, handle) { const s = session(id); return s.module.sealBackup(s.id, handle); },
        verifyAndCopy(id, handle, digest, inspection) { const s = session(id); return s.module.verifyAndCopy(s.id, handle, digest, inspection); },
        inspectionPath(id, handle) { const s = session(id); return s.module.inspectionPath(s.id, handle); },
        closeInspection(id, handle) { const s = session(id); return s.module.closeInspection(s.id, handle); },
        publishPreparedHex(id, handle, hex) { const s = session(id); return s.module.publishPreparedHex(s.id, handle, hex); },
        readPreparedHex(id, handle) { const s = session(id); return s.module.readPreparedHex(s.id, handle); },
        async releaseSession(id) {
            const s = session(id);
            try {
                await s.module.releaseSession(s.id);
            }
            finally {
                sessions.delete(id);
            }
        },
    };
}
export function readyOptions(f: HandoffFixture): Extract<NativeReadyRepositoryOptions, {
    legacy: object;
}> {
    return {
        ...f.options(), legacy: f.owner, module: artifactModule(f),
        async captureLegacyRecovery(db) {
            return { snapshots: await db.getAllAsync("SELECT * FROM main.project_snapshots ORDER BY project_id;") };
        },
    };
}
export interface ReadyFixture {
    f: HandoffFixture;
    prepared: PreparedUpgrade;
    options: NativeReadyRepositoryOptions;
    sourceOffset: number;
    eventOffset: number;
}
export async function withReadyFixture(body: (fixture: ReadyFixture) => Promise<void>) {
    await withHandoffFixture(async (f) => {
        const handoff = await createNativeWorkspaceHandoff(f.options()).run("ready-admission");
        assert.equal(handoff.state, "committed", String(handoff.error));
        assert.deepEqual(handoff.cleanupErrors, []);
        assert.ok(handoff.prepared);
        await f.freshLegacy();
        await body({ f, prepared: handoff.prepared, options: readyOptions(f),
            sourceOffset: f.handles.length, eventOffset: f.base.events.length });
    });
}
export function inspect<T>(path: string, body: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        return body(db);
    }
    finally {
        db.close();
    }
}
export function assertSingleCloses(f: HandoffFixture) {
    for (const handle of f.handles) {
        assert.equal(handle.closeCalls, 1, "Native source closes exactly once");
        assert.equal(handle.connection.closes, 1, "Original SQL source closes exactly once");
        assert.equal(handle.connection.closed, true);
    }
}
