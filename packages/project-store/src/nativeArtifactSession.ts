export interface BackupArtifactsModule {
    readonly protocolVersion: number;
    createSession(): Promise<unknown>;
    allocateAttempt(session: string, id: string): Promise<string>;
    openRetainedAttempt(session: string, id: string): Promise<string>;
    backupPath(session: string, handle: string): Promise<string>;
    sealBackup(session: string, handle: string): Promise<{
        path: string;
        sha256: string;
        bytes: number;
    }>;
    verifyAndCopy(session: string, handle: string, digest: string, id: string): Promise<string>;
    inspectionPath(session: string, handle: string): Promise<string>;
    closeInspection(session: string, handle: string): Promise<void>;
    publishPreparedHex(session: string, handle: string, hex: string): Promise<void>;
    readPreparedHex(session: string, handle: string): Promise<string>;
    releaseSession(session: string): Promise<void>;
}
function token(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value); }
function argumentToken(value: string): string { if (!token(value))
    throw new Error("Invalid native artifact token."); return value; }
function argumentDigest(value: string): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Invalid native artifact digest."); return value; }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function path(value: unknown): value is string {
    return typeof value === "string" && value.startsWith("/") && !/[\s\x00-\x1f\\%?#]/.test(value) &&
        value.slice(1).split("/").every(part => part.length > 0 && part !== "." && part !== "..");
}
export function receiptToHex(text: string): string {
    if (typeof text !== "string" || !text.length || text.length > 65536)
        throw new Error("Invalid prepared receipt size.");
    // URI encoding is a standard strict UTF-8 codec available without native polyfills.
    const encoded = encodeURIComponent(text);
    let result = "";
    for (let i = 0; i < encoded.length; i++) {
        if (encoded[i] === "%") {
            result += encoded.slice(i + 1, i + 3).toLowerCase();
            i += 2;
        }
        else
            result += encoded.charCodeAt(i).toString(16).padStart(2, "0");
        if (result.length > 131072)
            throw new Error("Prepared receipt exceeds byte limit.");
    }
    return result;
}
export function receiptFromHex(hex: string): string {
    if (typeof hex !== "string" || !hex.length || hex.length > 131072 || hex.length % 2 || !/^[0-9a-f]+$/.test(hex))
        throw new Error("Invalid prepared receipt transport.");
    const escaped: string[] = [];
    for (let i = 0; i < hex.length; i += 2)
        escaped.push("%" + hex.slice(i, i + 2));
    return decodeURIComponent(escaped.join(""));
}
/** Bind one native session. Availability is not a runtime qualification claim. */
export async function openNativeArtifactSession(module: BackupArtifactsModule | null | undefined) {
    const methods = ["createSession", "allocateAttempt", "openRetainedAttempt", "backupPath", "sealBackup", "verifyAndCopy", "inspectionPath", "closeInspection", "publishPreparedHex", "readPreparedHex", "releaseSession"] as const;
    if (!module || module.protocolVersion !== 1 || methods.some(method => typeof module[method] !== "function"))
        throw new Error("CPLayout native backup module is unavailable or incompatible.");
    const value = await module.createSession();
    const id = record(value) && token(value.sessionId) ? value.sessionId : undefined;
    if (!id || !record(value) || value.protocolVersion !== 1 || !path(value.artifactRoot) ||
        !value.artifactRoot.endsWith("/cplayout-upgrade-artifacts-v1")) {
        const error = new Error("Native backup session descriptor is invalid.");
        if (id) {
            try {
                await module.releaseSession(id);
            }
            catch (cleanupError) {
                throw new AggregateError([error, cleanupError], "Invalid descriptor and native session release failed.");
            }
        }
        throw error;
    }
    const artifactRoot = value.artifactRoot;
    let released = false, pending = 0;
    function alive() { if (released)
        throw new Error("Native artifact session has been released."); }
    async function call<T>(body: () => Promise<T>): Promise<T> {
        alive();
        pending++;
        try {
            return await body();
        }
        finally {
            pending--;
        }
    }
    async function handle(body: () => Promise<string>) {
        return call(async () => { const result = await body(); if (!token(result))
            throw new Error("Native artifact handle is invalid."); return result; });
    }
    async function checkedPath(body: () => Promise<string>) {
        return call(async () => {
            const result = await body();
            if (!path(result) || !result.startsWith(artifactRoot + "/"))
                throw new Error("Native artifact path is outside its session root.");
            return result;
        });
    }
    return Object.freeze({
        protocolVersion: 1 as const, artifactRoot,
        allocateAttempt: (attempt: string) => handle(() => module.allocateAttempt(id, argumentToken(attempt))),
        openRetainedAttempt: (attempt: string) => handle(() => module.openRetainedAttempt(id, argumentToken(attempt))),
        backupPath: (attempt: string) => checkedPath(() => module.backupPath(id, argumentToken(attempt))),
        sealBackup: (attempt: string) => call(async () => {
            const result = await module.sealBackup(id, argumentToken(attempt));
            if (!record(result) || !path(result.path) || !result.path.startsWith(artifactRoot + "/") ||
                typeof result.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(result.sha256) ||
                typeof result.bytes !== "number" || !Number.isSafeInteger(result.bytes) || result.bytes < 100)
                throw new Error("Native sealed backup descriptor is invalid.");
            return Object.freeze({ path: result.path, sha256: result.sha256, bytes: result.bytes });
        }),
        verifyAndCopy: (attempt: string, digest: string, inspection: string) => handle(() => module.verifyAndCopy(id, argumentToken(attempt), argumentDigest(digest), argumentToken(inspection))),
        inspectionPath: (inspection: string) => checkedPath(() => module.inspectionPath(id, argumentToken(inspection))),
        closeInspection: (inspection: string) => call(() => module.closeInspection(id, argumentToken(inspection))),
        publishPrepared: (attempt: string, text: string) => call(() => module.publishPreparedHex(id, argumentToken(attempt), receiptToHex(text))),
        readPrepared: (attempt: string) => call(async () => receiptFromHex(await module.readPreparedHex(id, argumentToken(attempt)))),
        async release() {
            alive();
            if (pending)
                throw new Error("Native artifact operation is in progress.");
            released = true;
            await module.releaseSession(id);
        },
    });
}
