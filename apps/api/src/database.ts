import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Principal, WorkspaceAccess, WorkspacePermission } from "@cplayout/auth-client";

export interface UserRecord extends Principal { passwordHash: string; disabled: boolean; accessRevision: number }
export interface SessionRecord { tokenHash: string; userId: string; csrfToken: string; accessRevision: number; expiresAt: string }
export interface StoredWorkspace { id: string; name: string; revision: number; document: string }
export interface StoredReceipt { userId: string; requestHash: string; responseDocument: string }
export interface ArchiveRecord { kind: "customer" | "project"; entityId: string }
export interface ApiTransaction {
  userByUsername(username: string): Promise<UserRecord | null>;
  userById(id: string): Promise<UserRecord | null>;
  users(): Promise<Principal[]>;
  insertUser(user: UserRecord): Promise<void>;
  updateUserAccess(id: string, roles: Principal["roles"], disabled: boolean): Promise<void>;
  hasAdministrator(): Promise<boolean>;
  session(hash: string): Promise<SessionRecord | null>;
  insertSession(session: SessionRecord): Promise<void>;
  deleteSession(hash: string): Promise<void>;
  memberships(userId: string): Promise<WorkspaceAccess[]>;
  membership(userId: string, workspaceId: string): Promise<WorkspaceAccess | null>;
  setMembership(userId: string, workspaceId: string, permissions: WorkspacePermission[]): Promise<void>;
  workspace(id: string, lock?: boolean): Promise<StoredWorkspace | null>;
  insertWorkspace(workspace: StoredWorkspace): Promise<void>;
  writeWorkspace(workspace: StoredWorkspace): Promise<void>;
  receipt(workspaceId: string, commandId: string): Promise<StoredReceipt | null>;
  insertReceipt(workspaceId: string, commandId: string, receipt: StoredReceipt): Promise<void>;
  archives(workspaceId: string): Promise<ArchiveRecord[]>;
  archive(workspaceId: string, actor: string, kind: ArchiveRecord["kind"], entityId: string, archived: boolean): Promise<void>;
  audit(actor: string | null, workspaceId: string | null, action: string, entityId?: string): Promise<void>;
}
export interface ApiDatabase { transaction<T>(action: (transaction: ApiTransaction) => Promise<T>, options?: { bootstrap?: boolean }): Promise<T> }
export function sha256(text: string): string { return createHash("sha256").update(text).digest("hex"); }
function safeRevision(value: unknown): number { const revision = Number(value); if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Stored revision is invalid."); return revision; }
function user(row: Record<string, unknown>): UserRecord { return { id: String(row.id), username: String(row.username), displayName: String(row.display_name), roles: row.roles as Principal["roles"], passwordHash: String(row.password_hash), disabled: Boolean(row.disabled), accessRevision: safeRevision(row.access_revision) }; }
function access(row: Record<string, unknown>): WorkspaceAccess { return { workspaceId: String(row.workspace_id), workspaceName: String(row.name), permissions: row.permissions as WorkspacePermission[], policyRevision: safeRevision(row.policy_revision) }; }
class PostgresTransaction implements ApiTransaction {
  constructor(private readonly client: PoolClient) {}
  async userByUsername(username: string) { const result = await this.client.query("SELECT * FROM cplayout_users WHERE username=$1 FOR SHARE", [username]); return result.rows[0] ? user(result.rows[0]) : null; }
  async userById(id: string) { const result = await this.client.query("SELECT * FROM cplayout_users WHERE id=$1 FOR SHARE", [id]); return result.rows[0] ? user(result.rows[0]) : null; }
  async users() { const result = await this.client.query("SELECT id,username,display_name,roles FROM cplayout_users ORDER BY username"); return result.rows.map(row => ({ id: row.id as string, username: row.username as string, displayName: row.display_name as string, roles: row.roles as Principal["roles"] })); }
  async insertUser(value: UserRecord) { await this.client.query("INSERT INTO cplayout_users(id,username,display_name,password_hash,roles,disabled,access_revision) VALUES($1,$2,$3,$4,$5,$6,$7)", [value.id, value.username, value.displayName, value.passwordHash, value.roles, value.disabled, value.accessRevision]); }
  async updateUserAccess(id: string, roles: Principal["roles"], disabled: boolean) {
    await this.client.query("UPDATE cplayout_users SET roles=$2,disabled=$3,access_revision=access_revision+1 WHERE id=$1", [id, roles, disabled]);
    await this.client.query("DELETE FROM cplayout_sessions WHERE user_id=$1", [id]);
  }
  async hasAdministrator() { const result = await this.client.query("SELECT 1 FROM cplayout_users WHERE 'admin'=ANY(roles) LIMIT 1"); return result.rowCount !== 0; }
  async session(hash: string): Promise<SessionRecord | null> { const result = await this.client.query("SELECT * FROM cplayout_sessions WHERE token_hash=$1", [hash]); const row = result.rows[0]; return row ? { tokenHash: row.token_hash, userId: row.user_id, csrfToken: row.csrf_token, accessRevision: safeRevision(row.access_revision), expiresAt: new Date(row.expires_at).toISOString() } : null; }
  async insertSession(value: SessionRecord) { await this.client.query("INSERT INTO cplayout_sessions(token_hash,user_id,csrf_token,access_revision,expires_at) VALUES($1,$2,$3,$4,$5)", [value.tokenHash, value.userId, value.csrfToken, value.accessRevision, value.expiresAt]); }
  async deleteSession(hash: string) { await this.client.query("DELETE FROM cplayout_sessions WHERE token_hash=$1", [hash]); }
  async memberships(id: string) { const result = await this.client.query("SELECT m.*,w.name FROM cplayout_memberships m JOIN cplayout_workspaces w ON w.id=m.workspace_id WHERE user_id=$1", [id]); return result.rows.map(access); }
  async membership(userId: string, workspaceId: string) { const result = await this.client.query("SELECT m.*,w.name FROM cplayout_memberships m JOIN cplayout_workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.workspace_id=$2 FOR SHARE OF m", [userId, workspaceId]); return result.rows[0] ? access(result.rows[0]) : null; }
  async setMembership(userId: string, workspaceId: string, permissions: WorkspacePermission[]) { await this.client.query("INSERT INTO cplayout_memberships(user_id,workspace_id,permissions) VALUES($1,$2,$3) ON CONFLICT(user_id,workspace_id) DO UPDATE SET permissions=EXCLUDED.permissions,policy_revision=cplayout_memberships.policy_revision+1", [userId, workspaceId, permissions]); }
  async workspace(id: string, lock = false) { const result = await this.client.query(`SELECT id,name,revision,document FROM cplayout_workspaces WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [id]); const row = result.rows[0]; return row ? { id: row.id as string, name: row.name as string, revision: safeRevision(row.revision), document: row.document as string } : null; }
  async insertWorkspace(value: StoredWorkspace) { await this.client.query("INSERT INTO cplayout_workspaces(id,name,revision,document) VALUES($1,$2,$3,$4)", [value.id, value.name, value.revision, value.document]); }
  async writeWorkspace(value: StoredWorkspace) { await this.client.query("UPDATE cplayout_workspaces SET revision=$2,document=$3 WHERE id=$1", [value.id, value.revision, value.document]); }
  async receipt(workspaceId: string, commandId: string) { const result = await this.client.query("SELECT user_id,request_hash,response_document FROM cplayout_command_receipts WHERE workspace_id=$1 AND command_id=$2", [workspaceId, commandId]); const row = result.rows[0]; return row ? { userId: row.user_id as string, requestHash: row.request_hash as string, responseDocument: row.response_document as string } : null; }
  async insertReceipt(workspaceId: string, commandId: string, value: StoredReceipt) { await this.client.query("INSERT INTO cplayout_command_receipts(workspace_id,command_id,user_id,request_hash,response_document) VALUES($1,$2,$3,$4,$5)", [workspaceId, commandId, value.userId, value.requestHash, value.responseDocument]); }
  async archives(workspaceId: string) { const result = await this.client.query("SELECT entity_kind,entity_id FROM cplayout_archives WHERE workspace_id=$1", [workspaceId]); return result.rows.map(row => ({ kind: row.entity_kind as ArchiveRecord["kind"], entityId: row.entity_id as string })); }
  async archive(workspaceId: string, actor: string, kind: ArchiveRecord["kind"], entityId: string, archived: boolean) { if (archived) await this.client.query("INSERT INTO cplayout_archives(workspace_id,entity_kind,entity_id,archived_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [workspaceId, kind, entityId, actor]); else await this.client.query("DELETE FROM cplayout_archives WHERE workspace_id=$1 AND entity_kind=$2 AND entity_id=$3", [workspaceId, kind, entityId]); }
  async audit(actor: string | null, workspaceId: string | null, action: string, entityId?: string) { await this.client.query("INSERT INTO cplayout_audit_events(actor_id,workspace_id,action,entity_id) VALUES($1,$2,$3,$4)", [actor, workspaceId, action, entityId ?? null]); }
}
export class PostgresDatabase implements ApiDatabase {
  constructor(readonly pool: Pool) {}
  async transaction<T>(action: (transaction: ApiTransaction) => Promise<T>, options: { bootstrap?: boolean } = {}): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (options.bootstrap) await client.query("SELECT pg_advisory_xact_lock(1129335892)");
      const result = await action(new PostgresTransaction(client)); await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
