import { type ApiClient } from "./apiClient";
import { parseWorkspaceArchiveState, type CommandRequest, type SignedOfflineGrant, type WorkspaceArchiveState, type ArchiveAcknowledgment } from "./contracts";
import { advanceOfflineClock, offlineCommandAllowed, verifyOfflineGrant, type OfflineClock, type OfflineClockState } from "./offline";

export interface CacheStorage { read(key: string): Promise<string | null>; write(key: string, value: string): Promise<void> }
export interface CachedAuthorization { grant: SignedOfflineGrant; verificationKey: string; clock: OfflineClockState }
export interface QueuedCommand extends CommandRequest { state: "pending" | "rejected"; failure?: string }
export interface CachedArchiveState { subject: string; workspaceId: string; state: WorkspaceArchiveState }
export interface CachedFieldWork { subject: string; workspaceId: string; document: string; authorization: CachedAuthorization | null; queue: QueuedCommand[]; archives?: CachedArchiveState; archiveReceipt?: ArchiveAcknowledgment & { subject: string } }
export function cacheKey(subject: string, workspaceId: string): string { return `cplayout-field-cache-v1:${encodeURIComponent(subject)}:${encodeURIComponent(workspaceId)}`; }
/** No password, server bearer token or session cookie belongs in this cache. */
export class FieldWorkCache {
  constructor(private readonly storage: CacheStorage, readonly subject: string, readonly workspaceId: string,
    private readonly trustedVerificationKey?: string) {}
  async read(): Promise<CachedFieldWork | null> {
    const text = await this.storage.read(cacheKey(this.subject, this.workspaceId)); if (text === null) return null;
    const value = JSON.parse(text) as CachedFieldWork;
    if (value.subject !== this.subject || value.workspaceId !== this.workspaceId || typeof value.document !== "string" || !Array.isArray(value.queue)) throw new Error("Cached work belongs to a different account or is unreadable. Preserve its recovery copy.");
    if (value.archives) {
      if (value.archives.subject !== this.subject || value.archives.workspaceId !== this.workspaceId) throw new Error("Saved archive information belongs to a different account.");
      value.archives = { subject: this.subject, workspaceId: this.workspaceId, state: parseWorkspaceArchiveState(value.archives.state, this.workspaceId) };
    }
    if (value.archiveReceipt) {
      const receipt = value.archiveReceipt;
      if (receipt.subject !== this.subject || receipt.workspaceId !== this.workspaceId || !Number.isSafeInteger(receipt.revision) || receipt.revision < 0
        || !["customer", "project"].includes(receipt.kind) || typeof receipt.entityId !== "string" || !receipt.entityId || typeof receipt.archived !== "boolean") throw new Error("The retained archive acknowledgment belongs to another account or is unreadable.");
      if (value.archives && value.archives.state.revision < receipt.revision) delete value.archives;
    }
    return value;
  }
  async retain(value: CachedFieldWork): Promise<void> {
    if (value.subject !== this.subject || value.workspaceId !== this.workspaceId) throw new Error("Cached work cannot move between accounts.");
    await this.storage.write(cacheKey(this.subject, this.workspaceId), JSON.stringify(value));
  }
  async queue(input: CommandRequest, document: string, projectId: string | null, clock: OfflineClock, processId: string): Promise<void> {
    const current = await this.read();
    if (!current?.authorization) throw new Error("Prepare this project online before working offline.");
    if (current.queue.some(item => item.state === "rejected")) throw new Error("Reconcile the rejected saved work before adding another field action. Its evidence is retained.");
    if (!this.trustedVerificationKey || current.authorization.verificationKey !== this.trustedVerificationKey) throw new Error("Offline access needs the workspace's trusted signing key.");
    const nextClock = advanceOfflineClock(current.authorization.clock, clock, processId);
    const grant = verifyOfflineGrant(current.authorization.grant, this.trustedVerificationKey, { subject: this.subject, workspaceId: this.workspaceId }, nextClock.lastWallTime);
    const type = input.command && typeof input.command === "object" ? (input.command as { type?: unknown }).type : null;
    if (!grant.permissions.includes("field:write") || typeof type !== "string" || !offlineCommandAllowed(type)
      || projectId !== null && !grant.projectIds.includes(projectId)) throw new Error("This action needs online access. Your field work is retained.");
    if (current.queue.some(item => item.commandId === input.commandId)) throw new Error("This field action is already queued.");
    await this.retain({ ...current, document, authorization: { ...current.authorization, clock: nextClock }, queue: [...current.queue, { ...input, state: "pending" }] });
  }
  /** Server permission/revision rejection retains the exact rejected and later payloads.
   * Accepted commands disappear only after their durable response is retained. */
  async sync(api: ApiClient): Promise<{ accepted: number; remaining: number }> {
    if (api.access?.principal.id !== this.subject) throw new Error("Sign in with the owner of this saved field work before synchronizing.");
    let current = await this.read(), accepted = 0; if (!current) return { accepted, remaining: 0 };
    while (current.queue.length && current.queue[0].state === "pending") {
      if (api.access?.principal.id !== this.subject) throw new Error("Sign in with the owner of this retained field work before continuing synchronization.");
      const next = current.queue[0];
      try {
        const response = await api.command(this.workspaceId, next);
        // Keep the local combined document while later unsynchronized commands exist.
        const queue = current.queue.slice(1);
        current = { ...current, document: queue.length ? current.document : JSON.stringify(response.workspace), queue };
        await this.retain(current); accepted++;
      } catch (error) {
        const failure = error instanceof Error ? error.message : "Synchronization could not complete.";
        const definitive = !!error && typeof error === "object" && "status" in error && [400, 401, 403, 409, 422].includes(Number(error.status));
        if (definitive) await this.retain({ ...current, queue: [{ ...next, state: "rejected", failure }, ...current.queue.slice(1)] });
        throw error;
      }
    }
    return { accepted, remaining: current.queue.length };
  }
}
