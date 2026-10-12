import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { Directory, File, Paths } from "expo-file-system";
import type { CacheStorage, SecureSessionStore } from "@cplayout/auth-client";

export interface AtomicAuthStorage extends CacheStorage {
  exclusive<T>(key: string, action: () => Promise<T>): Promise<T>;
  /** A read lease rechecks literal saved source synchronously before UI publication. */
  readCurrent?(key: string): string | null;
  /** The predicate and commit must share one synchronous storage operation or transaction. */
  writeCurrent?(key: string, value: string, isCurrent: () => boolean): Promise<void>;
}
export function createBrowserAuthStorage(): AtomicAuthStorage {
  return {
    readCurrent(key) { return localStorage.getItem(key); },
    async read(key) { return localStorage.getItem(key); },
    async write(key, value) { localStorage.setItem(key, value); },
    async exclusive(key, action) {
      if (!navigator.locks) return Promise.reject(new Error("Workspace locking is unavailable. Export a recovery copy before continuing."));
      return await navigator.locks.request(`cplayout:authenticated:${key}`, { mode: "exclusive" }, action);
    },
    async writeCurrent(key, value, isCurrent) {
      if (!isCurrent()) throw new Error("The active document or receiver observation changed. Your previous saved work is retained.");
      localStorage.setItem(key, value);
    },
  };
}
const nativeTails = new Map<string, Promise<unknown>>();
export function createNativeAuthStorage(): AtomicAuthStorage {
  function file(key: string): File { const directory = new Directory(Paths.document, "authenticated-field-cache"); directory.create({ idempotent: true, intermediates: true }); return new File(directory, `${encodeURIComponent(key)}.json`); }
  return {
    async read(key) { const current = file(key); return current.exists ? current.textSync() : null; },
    async write(key, value) { file(key).write(value); },
    exclusive(key, action) {
      const pending = (nativeTails.get(key) ?? Promise.resolve()).then(action);
      const settled = pending.catch(() => undefined); nativeTails.set(key, settled);
      void settled.then(() => { if (nativeTails.get(key) === settled) nativeTails.delete(key); }); return pending;
    },
    // Expo File I/O cannot prove cross-process atomic capture admission; native live
    // capture is intentionally unavailable until a qualified SQLite host is supplied.
  };
}
export function createAuthStorage(): AtomicAuthStorage { return Platform.OS === "web" ? createBrowserAuthStorage() : createNativeAuthStorage(); }
export function createNativeSessionStore(serviceIdentity: string): SecureSessionStore {
  const key = `cplayout.session.${encodeURIComponent(serviceIdentity).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  return { serviceIdentity: key, get: () => SecureStore.getItemAsync(key), set: token => SecureStore.setItemAsync(key, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), clear: () => SecureStore.deleteItemAsync(key),
    getRevocation: () => SecureStore.getItemAsync(`${key}.revocation`), retainRevocation: token => SecureStore.setItemAsync(`${key}.revocation`, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }), clearRevocation: () => SecureStore.deleteItemAsync(`${key}.revocation`) };
}
