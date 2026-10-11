import type { SQLiteDatabase } from "./expoSqliteTypes";
import { createLegacyDatabaseOwner } from "./legacyDatabaseOwner";
import type { SqliteRepositoryOptions } from "./legacySqliteRepository";
import { createManagedLegacyRepository } from "./managedLegacyRepository";
import { collectLegacySqliteProof } from "./legacySqliteProof";
/** The native bootstrap must create exactly one instance per owned source identity. */
export function createLegacyAccess(options: SqliteRepositoryOptions, openOwnedDatabase: () => Promise<SQLiteDatabase>) {
    const owner = createLegacyDatabaseOwner(openOwnedDatabase);
    return Object.freeze({
        repository: createManagedLegacyRepository(options, owner),
        collectSqliteProof: (projectId: string) => collectLegacySqliteProof(owner, projectId),
        quiesce: owner.quiesce,
        consumeQuiescence: owner.consumeQuiescence,
        get state() { return owner.state; },
    });
}
