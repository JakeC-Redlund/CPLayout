import { parseStrictJson } from "@cplayout/core";
import { parseWorkspaceEditRecovery, serializeWorkspaceEditRecovery, type WorkspaceEditRecoveryCandidate } from "./workspaceEditRecovery";

export const WORKSPACE_EDIT_RECOVERY_KEY = "cplayout-unified-edit-recovery-v1";
export const WORKSPACE_EDIT_RECOVERY_LOCK = "cplayout:unified-edit-recovery:writer:v1";
export const WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION = "cplayout-unified-edit-recovery-ledger-v1";
export const WORKSPACE_EDIT_RECOVERY_MAX_BYTES = 8 * 1024 * 1024;
export const WORKSPACE_EDIT_RECOVERY_MAX_SLOTS = 16;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export type WorkspaceEditRecoveryExclusiveLock = <T>(name: string, task: () => Promise<T>) => Promise<T>;
export interface WorkspaceEditRecoveryStoreOptions {
  backend: "web" | "native";
  storage: StorageLike | null;
  withExclusiveLock: WorkspaceEditRecoveryExclusiveLock | null;
}
export type WorkspaceEditRecoveryStoreErrorCode = "unsupported" | "stale" | "cancelled" | "quota" | "corrupt" | "limit" | "invalid";
export class WorkspaceEditRecoveryStoreError extends Error {
  constructor(public readonly code: WorkspaceEditRecoveryStoreErrorCode, message: string) {
    super(message); this.name = "WorkspaceEditRecoveryStoreError";
  }
}
export interface WorkspaceEditRecoveryStoredCandidate {
  writerId: string;
  sequence: number;
  raw: string;
  candidate: WorkspaceEditRecoveryCandidate;
}
interface Slot { writerId: string; sequence: number; raw: string }
interface Ledger { ledgerVersion: typeof WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION; slots: Slot[] }
function fail(code: WorkspaceEditRecoveryStoreErrorCode, message: string): never { throw new WorkspaceEditRecoveryStoreError(code, message); }
function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function writerId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) fail("invalid", "Recovery writer identity must be bounded text without controls.");
  assertUtf8Bound(value, "invalid"); return value;
}
function sequence(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail("invalid", "Recovery sequence must be a positive safe integer.");
  return value as number;
}
function assertUtf8Bound(raw: string, malformed: "invalid" | "corrupt"): void {
  let bytes = 0;
  for (const character of raw) {
    const scalar = character.codePointAt(0)!;
    if (scalar >= 0xd800 && scalar <= 0xdfff) fail(malformed, "Recovery text contains an invalid Unicode scalar.");
    bytes += scalar <= 0x7f ? 1 : scalar <= 0x7ff ? 2 : scalar <= 0xffff ? 3 : 4;
    if (bytes > WORKSPACE_EDIT_RECOVERY_MAX_BYTES) fail("limit", "Recovery ledger exceeds its 8 MiB UTF-8 bound. Export the retained bytes; nothing was truncated.");
  }
}
function parseLedger(raw: string | null): Ledger {
  if (raw === null) return { ledgerVersion: WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, slots: [] };
  assertUtf8Bound(raw, "corrupt");
  try {
    const input: unknown = parseStrictJson(raw);
    if (!exactKeys(input, ["ledgerVersion", "slots"]) || input.ledgerVersion !== WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION || !Array.isArray(input.slots)) throw new Error("Unsupported ledger fields.");
    if (input.slots.length > WORKSPACE_EDIT_RECOVERY_MAX_SLOTS) fail("limit", "Recovery ledger exceeds its 16 writer-slot bound.");
    const ids = new Set<string>();
    const slots = input.slots.map((value: unknown): Slot => {
      if (!exactKeys(value, ["writerId", "sequence", "raw"]) || typeof value.raw !== "string") throw new Error("Unsupported recovery slot fields.");
      const id = writerId(value.writerId), seq = sequence(value.sequence);
      if (ids.has(id)) throw new Error("Duplicate recovery writer slot.");
      ids.add(id);
      const candidate = parseWorkspaceEditRecovery(value.raw);
      if (candidate.writerId !== id || candidate.sequence !== seq) throw new Error("Recovery candidate differs from its slot identity or sequence.");
      return { writerId: id, sequence: seq, raw: value.raw };
    });
    return { ledgerVersion: WORKSPACE_EDIT_RECOVERY_LEDGER_VERSION, slots };
  } catch (error) {
    if (error instanceof WorkspaceEditRecoveryStoreError && error.code === "limit") throw error;
    return fail("corrupt", "Recovery ledger is invalid. Export its exact raw bytes before resolving it; no slot was replaced.");
  }
}
function stored(slot: Slot): WorkspaceEditRecoveryStoredCandidate {
  return { ...slot, candidate: parseWorkspaceEditRecovery(slot.raw) };
}
function requireCurrent(isCurrent: () => boolean): void {
  let current = false;
  try { current = isCurrent() === true; } catch { /* A retired/unavailable owner cannot publish. */ }
  if (!current) fail("cancelled", "This recovery operation belongs to a retired runtime owner.");
}

/** Browser-local working-state checkpoints, never domain Save acknowledgements.
 * Every mount must use a fresh writer ID; restoring another slot forks its ID.
 * Origin locking protects cooperative callers. Exact raw rechecks additionally
 * refuse observable nonparticipating/reentrant changes, without claiming that
 * an arbitrary external delete/recreate of the same writer ID is detectable. */
export function createWorkspaceEditRecoveryStore(options: WorkspaceEditRecoveryStoreOptions) {
  // Merely constructing a native/unsupported store must not touch any storage.
  let writes: Promise<void> = Promise.resolve();
  function supported(): { storage: StorageLike; lock: WorkspaceEditRecoveryExclusiveLock } {
    try {
      if (options.backend === "web" && typeof options.withExclusiveLock === "function" && options.storage
        && typeof options.storage.getItem === "function" && typeof options.storage.setItem === "function")
        return { storage: options.storage, lock: options.withExclusiveLock };
    } catch { /* Access to an unavailable browser storage surface is unsupported. */ }
    return fail("unsupported", "Edit recovery requires browser storage and an origin-scoped exclusive lock. Native activation and unlocked fallback are refused.");
  }
  function read(storage: StorageLike): string | null {
    let raw: unknown;
    try { raw = storage.getItem(WORKSPACE_EDIT_RECOVERY_KEY); }
    catch { return fail("unsupported", "Recovery storage could not be read; preserve the current working state."); }
    if (raw !== null && typeof raw !== "string") fail("corrupt", "Recovery storage did not return exact text.");
    return raw as string | null;
  }
  async function locked<T>(task: (storage: StorageLike) => T): Promise<T> {
    const support = supported();
    try { return await support.lock(WORKSPACE_EDIT_RECOVERY_LOCK, async () => task(support.storage)); }
    catch (error) {
      if (error instanceof WorkspaceEditRecoveryStoreError) throw error;
      return fail("unsupported", "The origin-scoped recovery lock is unavailable; no unlocked retry was attempted.");
    }
  }
  function serializeWrite<T>(task: () => Promise<T>): Promise<T> {
    const result = writes.then(task);
    writes = result.then(() => undefined, () => undefined);
    return result;
  }
  function publish(storage: StorageLike, prior: string | null, ledger: Ledger, isCurrent: () => boolean): void {
    const raw = JSON.stringify(ledger); assertUtf8Bound(raw, "invalid");
    if (read(storage) !== prior) fail("stale", "Recovery ledger changed outside the active origin lock.");
    requireCurrent(isCurrent);
    // A predicate can retire owners or expose a reentrant writer; recheck after it.
    if (read(storage) !== prior) fail("stale", "Recovery ledger changed before checkpoint persistence.");
    try { storage.setItem(WORKSPACE_EDIT_RECOVERY_KEY, raw); }
    catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") fail("quota", "Recovery storage quota was exceeded. Preserve working state and export; the prior ledger was not evicted.");
      fail("unsupported", "Recovery storage could not be written; preserve working state and export.");
    }
  }
  return {
    async readCandidates(): Promise<WorkspaceEditRecoveryStoredCandidate[]> {
      return locked(storage => parseLedger(read(storage)).slots.map(stored));
    },
    async withReviewedCandidate(id: string, expectedSequence: number, expectedRaw: string,
      isCurrent: () => boolean, action: (candidate: WorkspaceEditRecoveryStoredCandidate, assertCurrent: () => void) => void): Promise<void> {
      supported(); writerId(id); sequence(expectedSequence);
      return locked(storage => {
        const prior = read(storage), ledger = parseLedger(prior);
        const slot = ledger.slots.find(item => item.writerId === id);
        if (!slot || slot.sequence !== expectedSequence || slot.raw !== expectedRaw)
          fail("stale", "The reviewed recovery checkpoint changed before publication. Review it again.");
        let active = true;
        const assertCurrent = () => {
          if (!active) fail("cancelled", "The recovery read lease has expired.");
          requireCurrent(isCurrent);
          if (read(storage) !== prior) fail("stale", "Recovery bytes changed before publication.");
        };
        try { assertCurrent(); action(stored(slot), assertCurrent); }
        finally { active = false; }
      });
    },
    async checkpoint(candidate: WorkspaceEditRecoveryCandidate, expectedSequence: number | null, isCurrent: () => boolean): Promise<WorkspaceEditRecoveryStoredCandidate> {
      supported();
      let raw: string, detached: WorkspaceEditRecoveryCandidate;
      try { raw = serializeWorkspaceEditRecovery(candidate); detached = parseWorkspaceEditRecovery(raw); }
      catch { return fail("invalid", "Recovery candidate is invalid; its previous checkpoint was retained."); }
      const id = writerId(detached.writerId), seq = sequence(detached.sequence);
      if (expectedSequence !== null) sequence(expectedSequence);
      if (typeof isCurrent !== "function") fail("invalid", "Recovery checkpoint requires a current runtime owner predicate.");
      // Detach before any await: later UI changes cannot mutate an admitted write.
      return serializeWrite(() => locked(storage => {
        const prior = read(storage), ledger = parseLedger(prior); requireCurrent(isCurrent);
        const previous = ledger.slots.find(slot => slot.writerId === id);
        if (expectedSequence === null ? previous !== undefined : previous?.sequence !== expectedSequence) fail("stale", "Recovery writer sequence changed. Retain the current input and reconcile its checkpoint.");
        if (expectedSequence === Number.MAX_SAFE_INTEGER) fail("limit", "Recovery writer sequence is exhausted; fork a fresh writer identity.");
        if (seq !== (expectedSequence === null ? 1 : expectedSequence + 1)) fail("invalid", "Recovery candidate must carry the next writer sequence.");
        if (!previous && ledger.slots.length === WORKSPACE_EDIT_RECOVERY_MAX_SLOTS) fail("limit", "All 16 recovery writer slots are occupied. Export or explicitly discard a reviewed slot; none was evicted.");
        const slot = { writerId: id, sequence: seq, raw };
        if (previous) ledger.slots[ledger.slots.indexOf(previous)] = slot; else ledger.slots.push(slot);
        publish(storage, prior, ledger, isCurrent); return stored(slot);
      }));
    },
    async discard(id: string, expectedSequence: number, isCurrent: () => boolean): Promise<void> {
      supported(); writerId(id); sequence(expectedSequence);
      if (typeof isCurrent !== "function") fail("invalid", "Recovery discard requires a current runtime owner predicate.");
      return serializeWrite(() => locked(storage => {
        const prior = read(storage), ledger = parseLedger(prior); requireCurrent(isCurrent);
        const slot = ledger.slots.find(item => item.writerId === id);
        if (!slot || slot.sequence !== expectedSequence) fail("stale", "The reviewed checkpoint changed or no longer exists; discard was refused.");
        ledger.slots = ledger.slots.filter(item => item.writerId !== id); publish(storage, prior, ledger, isCurrent);
      }));
    },
    async exportCandidate(id: string): Promise<string> {
      supported(); writerId(id);
      return locked(storage => {
        const slot = parseLedger(read(storage)).slots.find(item => item.writerId === id);
        if (!slot) fail("stale", "The requested recovery writer checkpoint no longer exists.");
        return slot.raw;
      });
    },
    async exportRawLedger(): Promise<string | null> {
      // Opaque preservation deliberately bypasses JSON/candidate/size admission.
      return locked(storage => read(storage));
    },
  };
}
