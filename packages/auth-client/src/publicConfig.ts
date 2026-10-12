export interface PublicServiceConfig { apiUrl: string; offlinePublicKey: string }
export function resolveServiceConnection(explicit: { apiUrl?: string; offlinePublicKey?: string }, runtime: PublicServiceConfig | null,
  compiled: { apiUrl?: string; offlinePublicKey?: string }): { apiUrl: string; offlinePublicKey: string | null } {
  return { apiUrl: explicit.apiUrl ?? runtime?.apiUrl ?? compiled.apiUrl ?? "",
    offlinePublicKey: explicit.offlinePublicKey ?? runtime?.offlinePublicKey ?? compiled.offlinePublicKey ?? null };
}
/** This contains public endpoint/key data only and is supplied before the trusted
 * app bundle by the same-origin service gateway. No signing seed belongs here. */
export function readPublicServiceConfig(host: unknown = typeof globalThis === "undefined" ? null : globalThis): PublicServiceConfig | null {
  const value = host && typeof host === "object" ? (host as { __CPLAYOUT_PUBLIC_CONFIG__?: unknown }).__CPLAYOUT_PUBLIC_CONFIG__ : undefined;
  if (value === undefined) return null;
  if (!value || typeof value !== "object") throw new Error("The app's service configuration is invalid.");
  const config = value as PublicServiceConfig;
  if (typeof config.apiUrl !== "string" || !/^[a-f0-9]{64}$/i.test(config.offlinePublicKey)) throw new Error("The app's service configuration is invalid.");
  if (config.apiUrl !== "" && !/^https:\/\//i.test(config.apiUrl)) throw new Error("The configured sign-in service requires HTTPS.");
  return { apiUrl: config.apiUrl, offlinePublicKey: config.offlinePublicKey };
}
