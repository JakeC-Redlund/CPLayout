import { randomUUID } from "node:crypto";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createConnection, isIP, type Socket } from "node:net";
import { performance } from "node:perf_hooks";

const PREFIX = "/__cplayout_receiver/v1/";
const PROTOCOL = "cplayout-receiver-v1";
const MAX_LINES = 128;
const LEASE_MS = 10000;
interface NetworkConfig { method: "network"; protocol: "tcp" | "udp"; address: string; port: number; sourceAddress?: string }
interface QueuedLine { sequence: number; sentence: string | null; ingressMs: number }
interface Connection { id: string; token: string; socket: Socket | UdpSocket; kind: "tcp" | "udp"; lines: QueuedLine[]; carry: string; startedMs: number; sequence: number; leaseMs: number; ended: boolean; error: string | null; close: () => Promise<void> }
export interface ReceiverCompanion {
  handle(request: IncomingMessage, response: ServerResponse): boolean;
  close(): Promise<void>;
  status(): { protocol: typeof PROTOCOL; connected: boolean; sessionId: string | null };
}

/** No listener and no connection at construction. Mount only on the owned loopback server. */
export function createReceiverCompanion({ allowedOrigin }: { allowedOrigin: string }): ReceiverCompanion {
  const origin = new URL(allowedOrigin);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:' || origin.origin !== allowedOrigin) throw new Error("Receiver companion requires an exact loopback HTTP origin.");
  const tokens = new Map<string, number>();
  const closedSessions = new Map<string, string>();
  let active: Connection | null = null;
  let opening = false;
  let openingToken: string | null = null;
  let openingPromise: Promise<Connection> | null = null;
  let openingAbort: AbortController | null = null;
  let stopped = false;
  const timer = setInterval(() => {
    const now = performance.now();
    for (const [token, time] of tokens) if (now - time > 60000 && active?.token !== token && openingToken !== token) { tokens.delete(token); closedSessions.delete(token); }
    if (active && now - active.leaseMs > LEASE_MS) {
      const expired = active;
      active = null;
      closedSessions.set(expired.token, expired.id);
      void expired.close();
    }
  }, 1000);
  timer.unref();
  const reply = (response: ServerResponse, code: number, value: unknown) => {
    response.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(JSON.stringify({ protocol: PROTOCOL, ...value as object }));
  };
  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const remote = request.socket.remoteAddress;
      if (stopped || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote ?? '')
        || request.headers.origin !== allowedOrigin || request.headers.host !== origin.host
        || request.headers['x-cplayout-receiver'] !== PROTOCOL || request.method !== 'POST') {
        reply(response, 403, { error: 'Receiver request origin or protocol is not authorized.' }); return;
      }
      const action = request.url?.slice(PREFIX.length);
      if (action === 'hello') {
        if (tokens.size >= 64) { reply(response, 429, { error: 'Too many receiver clients. Close unused tabs and retry.' }); return; }
        const token = randomUUID(); tokens.set(token, performance.now()); reply(response, 200, { token }); return;
      }
      const token = request.headers['x-cplayout-receiver-token'];
      if (typeof token !== 'string' || !tokens.has(token)) { reply(response, 403, { error: 'Receiver control session expired.', code: 'control_expired' }); return; }
      tokens.set(token, performance.now());
      const body = await readBody(request);
      if (action === 'cancel') {
        if (openingToken === token) { openingAbort?.abort(); await openingPromise?.catch(() => undefined); }
        if (active?.token === token) { const cancelled = active; active = null; closedSessions.set(token, cancelled.id); await cancelled.close(); }
        reply(response, 200, { closed: true }); return;
      }
      if (action === 'connect') {
        if (active || opening) { reply(response, 409, { error: 'Another receiver connection is open. Disconnect it first.' }); return; }
        const config = parseConfig(body);
        opening = true; openingToken = token;
        try {
          openingAbort = new AbortController();
          openingPromise = openConnection(config, token, openingAbort.signal);
          const connected = await openingPromise;
          if (stopped || response.destroyed) { await connected.close(); throw new Error('Receiver opening was cancelled.'); }
          active = connected;
          reply(response, 200, { sessionId: connected.id });
        } finally { opening = false; openingToken = null; openingPromise = null; openingAbort = null; }
        return;
      }
      const owned = active;
      if (action === 'disconnect' && (closedSessions.get(token) === body.sessionId || (!owned && !opening))) { reply(response, 200, { closed: true }); return; }
      if (!owned || owned.token !== token || body.sessionId !== owned.id) { reply(response, 409, { error: 'Receiver connection is no longer owned by this tab.' }); return; }
      owned.leaseMs = performance.now();
      if (action === 'poll') {
        const now = performance.now();
        const lines = owned.lines.splice(0, MAX_LINES).map(({ sequence, sentence, ingressMs }) => ({ sequence, sentence, ingressAgeMs: Math.max(0, now - ingressMs) }));
        reply(response, 200, { sessionId: owned.id, lines, ended: owned.ended, error: owned.error }); return;
      }
      if (action === 'disconnect') {
        active = null;
        await owned.close();
        closedSessions.set(token, owned.id);
        reply(response, 200, { closed: true }); return;
      }
      reply(response, 404, { error: 'Unsupported receiver protocol action.' });
    } catch (error) { reply(response, 400, { error: error instanceof Error ? error.message : 'Receiver request failed.' }); }
  }
  return {
    handle(request, response) {
      if (!request.url?.startsWith(PREFIX)) return false;
      void route(request, response); return true;
    },
    async close() { stopped = true; clearInterval(timer); tokens.clear(); openingAbort?.abort(); await openingPromise?.then(connection => connection.close(), () => undefined); const owned = active; active = null; await owned?.close(); },
    status: () => ({ protocol: PROTOCOL, connected: active !== null && !active.ended, sessionId: active?.id ?? null }),
  };
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { const buffer = Buffer.from(chunk); bytes += buffer.length; if (bytes > 4096) throw new Error('Receiver request is too large.'); chunks.push(buffer); }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid receiver request.');
  return value as Record<string, unknown>;
}
function parseConfig(body: Record<string, unknown>): NetworkConfig {
  const value = body.config as Partial<NetworkConfig> | undefined;
  if (!value || value.method !== 'network' || !['tcp', 'udp'].includes(value.protocol ?? '')
    || typeof value.address !== 'string' || !isIP(value.address)
    || !Number.isInteger(value.port) || value.port! < 1 || value.port! > 65535
    || (value.sourceAddress !== undefined && (typeof value.sourceAddress !== 'string' || !isIP(value.sourceAddress)))) {
    throw new Error('Enter a numeric IP address, TCP or UDP, and a port from 1 to 65535.');
  }
  if (value.protocol === 'tcp' && ['0.0.0.0', '::', '255.255.255.255'].includes(value.address)) throw new Error('TCP requires the receiver address.');
  return value as NetworkConfig;
}
async function openConnection(config: NetworkConfig, token: string, signal: AbortSignal): Promise<Connection> {
  const socket = config.protocol === 'tcp' ? createConnection({ host: config.address, port: config.port }) : createSocket(isIP(config.address) === 6 ? 'udp6' : 'udp4');
  let closed = false;
  const connection: Connection = { id: randomUUID(), token, socket, kind: config.protocol, lines: [], carry: '', startedMs: 0, sequence: 0, leaseMs: performance.now(), ended: false, error: null,
    close: async () => {
      if (closed) return; closed = true; connection.ended = true; connection.lines = []; connection.carry = '';
      if (config.protocol === 'tcp') { (socket as Socket).destroy(); return; }
      await new Promise<void>((resolve) => { try { (socket as UdpSocket).close(() => resolve()); } catch { resolve(); } });
    },
  };
  function queue(sentence: string | null, ingressMs: number): void {
    if (connection.lines.length >= MAX_LINES) {
      connection.lines = [{ sequence: ++connection.sequence, sentence: null, ingressMs }];
    }
    connection.lines.push({ sequence: ++connection.sequence, sentence, ingressMs });
  }
  function receive(bytes: Buffer): void {
    if (closed) return;
    const now = performance.now();
    if (connection.carry && now - connection.startedMs > 2000) { queue(null, connection.startedMs); connection.carry = ''; }
    for (const byte of bytes) {
      if (byte === 13 || byte === 10) {
        if (connection.carry) {
          const sentence = connection.carry;
          queue(/^\$[A-Z]{5},[^\r\n]*\*[0-9a-fA-F]{2}$/.test(sentence) ? sentence : null, connection.startedMs);
          connection.carry = '';
        }
        continue;
      }
      if (byte < 32 || byte > 126) {
        connection.error = 'Binary or unsupported receiver data detected. Reconnect in NMEA mode.';
        connection.ended = true;
        void connection.close();
        return;
      }
      if (connection.carry.length >= 1024) {
        connection.error = 'Receiver frame exceeded the NMEA buffer limit. Reconnect in NMEA mode.';
        connection.ended = true;
        void connection.close();
        return;
      }
      if (!connection.carry) connection.startedMs = now;
      connection.carry += String.fromCharCode(byte);
    }
  }
  socket.on('error', (error: Error) => { connection.error = error.message; connection.ended = true; queue(null, performance.now()); });
  if (config.protocol === 'tcp') {
    (socket as Socket).on('data', receive);
    (socket as Socket).on('end', () => { connection.ended = true; });
    (socket as Socket).on('close', () => { connection.ended = true; });
  } else {
    let acceptedSender: string | null = null;
    (socket as UdpSocket).on('message', (bytes, remote) => {
      if (config.sourceAddress && config.sourceAddress !== remote.address) return;
      const sender = `${remote.address}:${remote.port}`;
      // A connection belongs to one receiver endpoint; never splice different senders.
      if (acceptedSender !== null && acceptedSender !== sender) return;
      acceptedSender = sender;
      receive(bytes);
    });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timeout); socket.off('error', fail); signal.removeEventListener('abort', abort); };
      const finish = () => { cleanup(); resolve(); };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const abort = () => fail(new Error('Receiver opening was cancelled.'));
      const timeout = setTimeout(() => fail(new Error('Receiver connection timed out.')), 5000);
      socket.once('error', fail);
      socket.once(config.protocol === 'tcp' ? 'connect' : 'listening', finish);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      if (config.protocol === 'udp') (socket as UdpSocket).bind(config.port, config.address);
    });
    return connection;
  } catch (error) { await connection.close(); throw error; }
}
