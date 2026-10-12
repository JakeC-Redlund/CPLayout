import { hexToBytes } from "@cplayout/auth-client";
export function serviceConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!env.CPLAYOUT_DATABASE_URL) throw new Error("Configure CPLAYOUT_DATABASE_URL for the PostgreSQL service.");
  if (!env.CPLAYOUT_OFFLINE_SIGNING_KEY || !/^[0-9a-f]{64}$/i.test(env.CPLAYOUT_OFFLINE_SIGNING_KEY)) throw new Error("Configure a protected 32-byte CPLAYOUT_OFFLINE_SIGNING_KEY.");
  if (!env.CPLAYOUT_PUBLIC_ORIGIN) throw new Error("Configure the service's public origin.");
  const origin = new URL(env.CPLAYOUT_PUBLIC_ORIGIN).origin;
  const loopback = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!origin.startsWith("https://") && !loopback) throw new Error("A deployed service requires HTTPS.");
  const port = Number(env.CPLAYOUT_API_PORT ?? "19040");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Configure a valid API port.");
  return { connectionString: env.CPLAYOUT_DATABASE_URL, signingKey: hexToBytes(env.CPLAYOUT_OFFLINE_SIGNING_KEY), origin, secureCookies: !loopback, port,
    host: env.CPLAYOUT_API_HOST ?? "127.0.0.1" };
}
