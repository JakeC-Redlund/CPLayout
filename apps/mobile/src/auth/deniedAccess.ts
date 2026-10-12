import { FieldWorkCache, cacheKey } from "@cplayout/auth-client";
import type { AtomicAuthStorage } from "./authStorage";
export function deniedAccountKey(subject: string): string { return `cplayout-denied-account:${subject}`; }
/** Concurrent responses for one denied account share its preservation job.
 * Other dispositions wait so they cannot retire an active checkpoint boundary. */
export class AccountDenialQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<void>>();
  enqueue(key: string, work: () => Promise<void>): Promise<void> {
    const existing = this.pending.get(key); if (existing) return existing;
    const result = this.tail.then(work), settled = result.catch(() => undefined);
    this.tail = settled; this.pending.set(key, result);
    void settled.then(() => { if (this.pending.get(key) === result) this.pending.delete(key); });
    return result;
  }
  whenIdle(): Promise<void> { return this.tail; }
}
/** A definitive service denial retires cached authorization, not the captured
 * domain documents or queued evidence. Hints only identify the retained partition. */
export async function retainAccountDenial(storage: AtomicAuthStorage, subject: string, workspaceId: string | null, verificationKey?: string): Promise<void> {
  if (!subject) return;
  // A small durable refusal precedes rewriting the larger field cache. Failure
  // of either independent write must not suppress the other preservation path.
  let failure: unknown;
  try { await storage.write(deniedAccountKey(subject), "denied"); } catch (error) { failure = error; }
  if (workspaceId) {
    const cache = new FieldWorkCache(storage, subject, workspaceId, verificationKey), partition = cacheKey(subject, workspaceId);
    try { await storage.exclusive(partition, async () => { const work = await cache.read(); if (work) await cache.retain({ ...work, authorization: null }); }); }
    catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
}
