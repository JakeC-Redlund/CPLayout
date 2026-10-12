/** Injectable test fixture only. Production start.ts always uses PostgresDatabase. */
import type { Principal, WorkspaceAccess, WorkspacePermission } from "@cplayout/auth-client";
import type { ApiDatabase, ApiTransaction, ArchiveRecord, SessionRecord, StoredReceipt, StoredWorkspace, UserRecord } from "./database";
type State = { users: UserRecord[]; sessions: SessionRecord[]; workspaces: StoredWorkspace[]; memberships: (WorkspaceAccess & { userId: string })[];
  receipts: (StoredReceipt & { workspaceId: string; commandId: string })[]; archives: (ArchiveRecord & { workspaceId: string })[]; audits: { action: string; actor: string | null }[] };
export class TestDatabase implements ApiDatabase {
  state: State = { users: [], sessions: [], workspaces: [], memberships: [], receipts: [], archives: [], audits: [] };
  private tail: Promise<unknown> = Promise.resolve();
  transaction<T>(action: (transaction: ApiTransaction) => Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => {
      const state = structuredClone(this.state);
      const transaction: ApiTransaction = {
        userByUsername: async name => state.users.find(item => item.username === name) ?? null,
        userById: async id => state.users.find(item => item.id === id) ?? null,
        users: async () => state.users.map(({ passwordHash: _hash, disabled: _disabled, accessRevision: _revision, ...user }) => user),
        insertUser: async user => { if (state.users.some(item => item.username === user.username)) throw new Error("Duplicate username."); state.users.push(user); },
        updateUserAccess: async (id, roles, disabled) => { const user = state.users.find(item => item.id === id)!; user.roles = roles; user.disabled = disabled; user.accessRevision++; state.sessions = state.sessions.filter(item => item.userId !== id); },
        hasAdministrator: async () => state.users.some(item => item.roles.includes("admin")),
        session: async hash => state.sessions.find(item => item.tokenHash === hash) ?? null,
        insertSession: async value => { state.sessions.push(value); },
        deleteSession: async hash => { state.sessions = state.sessions.filter(item => item.tokenHash !== hash); },
        memberships: async id => state.memberships.filter(item => item.userId === id).map(({ userId: _user, ...membership }) => membership),
        membership: async (userId, workspaceId) => state.memberships.find(item => item.userId === userId && item.workspaceId === workspaceId) ?? null,
        setMembership: async (userId, workspaceId, permissions) => {
          const current = state.memberships.find(item => item.userId === userId && item.workspaceId === workspaceId);
          if (current) { current.permissions = permissions; current.policyRevision++; }
          else state.memberships.push({ userId, workspaceId, workspaceName: state.workspaces.find(item => item.id === workspaceId)!.name, permissions, policyRevision: 0 });
        },
        workspace: async id => state.workspaces.find(item => item.id === id) ?? null,
        insertWorkspace: async value => { state.workspaces.push(value); },
        writeWorkspace: async value => { state.workspaces[state.workspaces.findIndex(item => item.id === value.id)] = value; },
        receipt: async (workspaceId, commandId) => state.receipts.find(item => item.workspaceId === workspaceId && item.commandId === commandId) ?? null,
        insertReceipt: async (workspaceId, commandId, value) => { state.receipts.push({ ...value, workspaceId, commandId }); },
        archives: async id => state.archives.filter(item => item.workspaceId === id),
        archive: async (workspaceId, _actor, kind, entityId, archived) => { state.archives = state.archives.filter(item => item.workspaceId !== workspaceId || item.kind !== kind || item.entityId !== entityId); if (archived) state.archives.push({ workspaceId, kind, entityId }); },
        audit: async (actor, _workspaceId, action) => { state.audits.push({ actor, action }); },
      };
      const result = await action(transaction); this.state = state; return structuredClone(result);
    });
    this.tail = pending.catch(() => undefined); return pending;
  }
  async addUser(user: UserRecord, workspaceId: string, permissions: WorkspacePermission[] = ["field:read", "field:write", "catalog:write"]) {
    await this.transaction(async transaction => { await transaction.insertUser(user); await transaction.setMembership(user.id, workspaceId, permissions); });
  }
}
