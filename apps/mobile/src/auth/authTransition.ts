import { ApiError, type AccessSnapshot, type CacheStorage, type ApiClient } from "@cplayout/auth-client";
export const ACCOUNT_TRANSITION_KEY = "cplayout-account-transition-v1";
export class AccountTransitionError extends Error {
  constructor(readonly kind: "prepare_failed" | "uncertain", message: string) { super(message); this.name = "AccountTransitionError"; }
}
/** Device metadata must be prepared before HTTP can replace its session cookie.
 * A successful HTTP sign-in is revoked if its local identity cannot be retained. */
export async function signInWithDurableTransition(api: Pick<ApiClient, "access" | "login" | "revokeIssuedSession">, storage: CacheStorage,
  username: string, password: string, retain: (snapshot: AccessSnapshot) => Promise<void>): Promise<AccessSnapshot> {
  try { await storage.write(ACCOUNT_TRANSITION_KEY, "pending"); }
  catch { throw new AccountTransitionError("prepare_failed", "Sign-in could not be prepared on this device. Its current account and saved work are unchanged."); }
  let authenticated: AccessSnapshot | null = null;
  try {
    const snapshot = await api.login(username, password); authenticated = snapshot;
    await retain(snapshot); await storage.write(ACCOUNT_TRANSITION_KEY, ""); return snapshot;
  } catch (error) {
    if (!authenticated && error instanceof ApiError && error.code === "invalid_credentials") {
      try { await storage.write(ACCOUNT_TRANSITION_KEY, ""); } catch { /* Pending marker keeps cold offline access blocked. */ }
      throw error;
    }
    if (authenticated) { try { await api.revokeIssuedSession(authenticated); } catch { /* The issued session stays bounded; newer account authority is never revoked. */ } }
    throw new AccountTransitionError("uncertain", authenticated
      ? "Sign-in could not retain this account safely. Sign in again when device storage is available; unfinished work stays retained."
      : "Sign-in could not complete safely. Reconnect and sign in again; unfinished work stays retained.");
  }
}
