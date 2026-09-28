import { migrateLegacyWorkspace, type LegacyWorkspaceSources } from "./legacyWorkspaceMigration";
import { parseWorkspaceDocument, serializeWorkspaceDocument, WorkspaceDocumentError, FIELD_WORKSPACE_DOCUMENT_VERSION, WORKSPACE_DOCUMENT_VERSION, type WorkspaceDocument } from "./workspaceDocument";

export const WEB_WORKSPACE_KEY = "center-pivot-layout-workspace-v1";
export const WEB_WORKSPACE_BACKUP_KEY = "center-pivot-layout-workspace-legacy-backup-v1";
export const WEB_WORKSPACE_LOCK = "cplayout:workspace:writer:v1";
export const LEGACY_PROJECTS_KEY = "center-pivot-layout-projects-v1";
export const LEGACY_CATALOG_KEY = "center-pivot-layout-project-catalog-v1";

export interface WorkspaceKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WorkspaceLocks {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => T | PromiseLike<T>): Promise<T>;
}

export type WebWorkspaceStoreErrorCode = "unavailable" | "recovery_required" | "not_initialized";
export class WebWorkspaceStoreError extends Error {
  constructor(public readonly code: WebWorkspaceStoreErrorCode, message: string) {
    super(message);
    this.name = "WebWorkspaceStoreError";
  }
}

export interface WebWorkspaceStoreDependencies {
  getStorage(): WorkspaceKeyValueStorage | undefined;
  getLocks(): WorkspaceLocks | undefined;
}

/** Cooperative browser persistence; callers must retain loaded revisions across edits. */
export function createWebWorkspaceStore(dependencies: WebWorkspaceStoreDependencies) {
  function storage(): WorkspaceKeyValueStorage {
    const value = dependencies.getStorage();
    if (!value) throw new WebWorkspaceStoreError("unavailable", "Browser storage is unavailable; preserve edits and export a recovery copy.");
    return value;
  }

  function locked<T>(action: (store: WorkspaceKeyValueStorage) => T): Promise<T> {
    return Promise.resolve().then(() => {
      const locks = dependencies.getLocks();
      if (!locks) throw new WebWorkspaceStoreError("unavailable", "Workspace locking is unavailable; persistence is disabled for this origin.");
      return locks.request(WEB_WORKSPACE_LOCK, { mode: "exclusive" }, () => action(storage()));
    });
  }

  function legacySources(store: WorkspaceKeyValueStorage): LegacyWorkspaceSources {
    return { projectsRaw: store.getItem(LEGACY_PROJECTS_KEY), catalogRaw: store.getItem(LEGACY_CATALOG_KEY) };
  }

  function backup(sources: LegacyWorkspaceSources, state: "prepared" | "committed"): string {
    return JSON.stringify({ backupVersion: "cplayout-workspace-legacy-backup-v1", state, ...sources });
  }

  function requireUnchangedLegacy(store: WorkspaceKeyValueStorage, state: "prepared" | "committed" = "committed"): void {
    if (store.getItem(WEB_WORKSPACE_BACKUP_KEY) !== backup(legacySources(store), state)) {
      throw new WebWorkspaceStoreError("recovery_required", "Legacy storage changed or its backup is missing. Reconcile it before saving this workspace.");
    }
  }

  return {
    exportRecoveryAsync(): Promise<string> {
      const capture = (store: WorkspaceKeyValueStorage, consistency: string) => JSON.stringify({
        recoveryVersion: "cplayout-workspace-recovery-v1",
        consistency,
        workspaceRaw: store.getItem(WEB_WORKSPACE_KEY),
        backupRaw: store.getItem(WEB_WORKSPACE_BACKUP_KEY),
        ...legacySources(store),
      });
      // Recovery is opaque evidence, not a validated import or an automatic restore.
      return Promise.resolve().then(() => dependencies.getLocks()
        ? locked(store => capture(store, "cooperative_lock"))
        : capture(storage(), "unlocked_best_effort"));
    },

    initializeAsync(): Promise<WorkspaceDocument> {
      return locked(store => {
        const current = store.getItem(WEB_WORKSPACE_KEY);
        if (current !== null) {
          const workspace = parseWorkspaceDocument(current);
          const sources = legacySources(store);
          if (store.getItem(WEB_WORKSPACE_BACKUP_KEY) === backup(sources, "prepared")) {
            // No transaction is allowed before the migration receipt is finalized.
            if (current !== serializeWorkspaceDocument(migrateLegacyWorkspace(sources))) {
              throw new WebWorkspaceStoreError("recovery_required", "Unfinished migration differs from its source; preserve it for recovery.");
            }
            store.setItem(WEB_WORKSPACE_BACKUP_KEY, backup(sources, "committed"));
          }
          requireUnchangedLegacy(store);
          return workspace;
        }
        const sources = legacySources(store);
        const workspace = migrateLegacyWorkspace(sources);
        const original = backup(sources, "prepared");
        const previousBackup = store.getItem(WEB_WORKSPACE_BACKUP_KEY);
        if (previousBackup !== null && previousBackup !== original) {
          throw new WebWorkspaceStoreError("recovery_required", "An earlier migration was committed or its backup differs; recover the missing workspace instead of remigrating.");
        }
        const encoded = serializeWorkspaceDocument(workspace);
        if (previousBackup === null) store.setItem(WEB_WORKSPACE_BACKUP_KEY, original);
        // Keep both legacy keys. A failed workspace write leaves a reusable exact backup.
        requireUnchangedLegacy(store, "prepared");
        store.setItem(WEB_WORKSPACE_KEY, encoded);
        store.setItem(WEB_WORKSPACE_BACKUP_KEY, backup(sources, "committed"));
        return workspace;
      });
    },

    readAsync(): Promise<WorkspaceDocument> {
      return locked(store => {
        const current = store.getItem(WEB_WORKSPACE_KEY);
        if (current === null) throw new WebWorkspaceStoreError("not_initialized", "Workspace migration has not completed.");
        const workspace = parseWorkspaceDocument(current);
        requireUnchangedLegacy(store);
        return workspace;
      });
    },

    transactAsync(expectedRevision: number, transition: (latest: WorkspaceDocument) => WorkspaceDocument): Promise<WorkspaceDocument> {
      return locked(store => {
        const current = store.getItem(WEB_WORKSPACE_KEY);
        if (current === null) throw new WebWorkspaceStoreError("not_initialized", "Workspace migration has not completed.");
        const latest = parseWorkspaceDocument(current);
        requireUnchangedLegacy(store);
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || latest.revision !== expectedRevision) {
          throw new WorkspaceDocumentError("conflict", "Workspace revision changed; reload before saving.");
        }
        if (latest.revision === Number.MAX_SAFE_INTEGER) throw new WorkspaceDocumentError("revision_exhausted", "Persisted revision limit reached.");
        const nextRevision = latest.revision + 1;
        const candidate = transition(parseWorkspaceDocument(current));
        if (latest.workspaceVersion === WORKSPACE_DOCUMENT_VERSION && candidate.workspaceVersion === FIELD_WORKSPACE_DOCUMENT_VERSION) {
          // Publish v2 and its exact original v1 bytes together in the same atomic localStorage value.
          candidate.originalV1Document = current;
        }
        if (latest.workspaceVersion === FIELD_WORKSPACE_DOCUMENT_VERSION
          && (candidate.workspaceVersion !== FIELD_WORKSPACE_DOCUMENT_VERSION || candidate.originalV1Document !== latest.originalV1Document)) {
          throw new WorkspaceDocumentError("conflict", "A transaction cannot downgrade v2 or replace its retained original v1 document.");
        }
        const encoded = serializeWorkspaceDocument(candidate);
        const next = parseWorkspaceDocument(encoded);
        if (next.revision !== nextRevision) throw new WorkspaceDocumentError("conflict", "A workspace transaction must advance exactly one revision.");
        requireDeletionHistory(latest, next);
        // Detect observable nonparticipating/reentrant writers; this is not a substitute for Web Locks.
        if (store.getItem(WEB_WORKSPACE_KEY) !== current) throw new WorkspaceDocumentError("conflict", "Workspace changed outside the active transaction.");
        requireUnchangedLegacy(store);
        store.setItem(WEB_WORKSPACE_KEY, encoded);
        return next;
      });
    },
  };
}

function requireDeletionHistory(previous: WorkspaceDocument, next: WorkspaceDocument): void {
  const tombstones = new Map(next.tombstones.map(item => [JSON.stringify([item.entity, item.id]), item]));
  for (const old of previous.tombstones) {
    const retained = tombstones.get(JSON.stringify([old.entity, old.id]));
    if (!retained || retained.revision !== old.revision || retained.deletedAt !== old.deletedAt) {
      throw new WorkspaceDocumentError("conflict", "A transaction cannot remove or rewrite deletion history.");
    }
  }
  for (const old of previous.fieldDocuments ?? []) {
    const retained = next.fieldDocuments?.find(item => item.id === old.id);
    if (retained && retained.originalProjectDocument !== old.originalProjectDocument) {
      throw new WorkspaceDocumentError("conflict", "A field save cannot remove or rewrite its original project source.");
    }
  }
  const collections = [
    { entity: "design", previous: previous.catalog.designs.map(item => item.id), next: next.catalog.designs.map(item => item.id) },
    { entity: "project_document", previous: previous.projectDocuments.map(item => item.summary.id), next: next.projectDocuments.map(item => item.summary.id) },
    { entity: "draft_document", previous: previous.draftDocuments.map(item => item.id), next: next.draftDocuments.map(item => item.id) },
    { entity: "field_document", previous: (previous.fieldDocuments ?? []).map(item => item.id), next: (next.fieldDocuments ?? []).map(item => item.id) },
  ];
  for (const collection of collections) {
    const active = new Set(collection.next);
    for (const id of collection.previous) {
      if (!active.has(id) && !tombstones.has(JSON.stringify([collection.entity, id]))) {
        throw new WorkspaceDocumentError("conflict", "Removing a design or document requires its deletion tombstone.");
      }
    }
  }
}
