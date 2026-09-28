export const SOURCE_LEASE_OPTIONS = Object.freeze({
    cplayoutExistingOnly: true,
    cplayoutSourceLease: true,
    useNewConnection: true,
    enableChangeListener: false,
    finalizeUnusedStatementsBeforeClosing: true,
} as const);
export interface SourceLeaseNativeHandle {
    initAsync(): Promise<void>;
    closeAsync(): Promise<void>;
    assertSourceLeaseAsync(): Promise<unknown>;
}
export interface SourceLeaseDependencies<Native extends SourceLeaseNativeHandle, Database> {
    platform: unknown;
    nativeModule: {
        readonly cplayoutExistingOnlyVersion?: unknown;
        readonly cplayoutSourceLeaseVersion?: unknown;
        NativeDatabase: new (path: string, options: typeof SOURCE_LEASE_OPTIONS) => Native;
    };
    /** Expo's original wrapper is required by its native backup API. */
    SQLiteDatabase: new (path: string, options: typeof SOURCE_LEASE_OPTIONS, native: Native) => Database;
}
export type SourceFileIdentity = Readonly<{
    path: string;
    device: string;
    inode: string;
}>;
function identity(value: unknown, path: string): SourceFileIdentity {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid native source identity');
    const row = value as Record<string, unknown>;
    const device = row.device, inode = row.inode;
    const validInteger = (part: unknown): part is string => typeof part === 'string' &&
        /^(0|[1-9][0-9]{0,19})$/.test(part) && BigInt(part) <= 0xffffffffffffffffn;
    if (row.path !== path || !validInteger(device) || !validInteger(inode))
        throw new Error('Invalid native source identity');
    return Object.freeze({ path, device, inode });
}
/** Native enforcement is mandatory; there is no stock-open or JavaScript-only fallback. */
export async function openNativeSourceLease<Native extends SourceLeaseNativeHandle, Database>(path: unknown, dependencies: SourceLeaseDependencies<Native, Database>): Promise<Readonly<{
    database: Database;
    identity: SourceFileIdentity;
    assertOwned(): Promise<void>;
}>> {
    if (dependencies.platform !== 'android')
        throw new Error('Source leasing requires Android');
    const module = dependencies.nativeModule;
    if (module.cplayoutExistingOnlyVersion !== 1 || module.cplayoutSourceLeaseVersion !== 1) {
        throw new Error('Source leasing requires native capability versions 1');
    }
    if (typeof path !== 'string' || path.length > 4096 || !path.startsWith('/') ||
        path.slice(1).split('/').some(part => !part || part === '.' || part === '..' || /[^A-Za-z0-9_.-]/.test(part))) {
        throw new TypeError('Source path must be canonical-form absolute ASCII');
    }
    // Constructor failures are owned by native cleanup; no handle has escaped yet.
    const native = new module.NativeDatabase(path, SOURCE_LEASE_OPTIONS);
    try {
        if (typeof native.assertSourceLeaseAsync !== 'function')
            throw new Error('Native source assertion is unavailable');
        await native.initAsync();
        const initial = identity(await native.assertSourceLeaseAsync(), path);
        const database = new dependencies.SQLiteDatabase(path, SOURCE_LEASE_OPTIONS, native);
        return Object.freeze({
            database,
            identity: initial,
            async assertOwned() {
                const current = identity(await native.assertSourceLeaseAsync(), path);
                if (current.device !== initial.device || current.inode !== initial.inode)
                    throw new Error('Source file identity changed');
            },
        });
    }
    catch (error) {
        try {
            await native.closeAsync();
        }
        catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Source lease opening and cleanup failed');
        }
        throw error;
    }
}
