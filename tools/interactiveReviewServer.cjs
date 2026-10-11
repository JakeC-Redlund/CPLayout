'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const store = require('./interactiveReviewStore.cjs');
const pages = require('./interactiveReviewPage.cjs');
const evidence = require('./reviewEvidenceIdentity.cjs');
const lease = require('./reviewResourceLease.cjs');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const runtimePath = dir => path.join(dir, '.server-lock', 'runtime.json');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function initialize(dir, packet, imageRoot, reviewedFingerprint) {
  if (fs.existsSync(dir)) throw new Error('Session destination already exists; use start to resume it.');
  const root = fs.realpathSync(imageRoot);
  const images = new Map();
  for (const q of packet.questions || []) for (const item of q.images || []) {
    if (!/^annotated\/[a-zA-Z0-9_-]+\.png$/.test(item.path)) throw new Error('Invalid image path');
    const file = fs.realpathSync(path.join(root, item.path));
    if (!file.startsWith(root + path.sep)) throw new Error('Image leaves packet directory');
    const bytes = fs.readFileSync(file);
    if (bytes.length > 20 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Expected bounded PNG');
    images.set(item.path, bytes);
  }
  // Validate the question packet and the fingerprint before creating the session.
  const identity = evidence.createIdentity(packet, root, reviewedFingerprint);
  store.createSession(dir, packet);
  fs.mkdirSync(path.join(dir, 'annotated'));
  const manifest = {};
  for (const [name, bytes] of images) {
    fs.writeFileSync(path.join(dir, name), bytes, { flag: 'wx' });
    manifest[name] = hash(bytes);
  }
  fs.writeFileSync(path.join(dir, 'assets.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  fs.writeFileSync(path.join(dir, 'evidence-identity.json'), JSON.stringify(identity, null, 2) + '\n', { flag: 'wx' });
}

async function startServer(dir, port = 0, expectedFingerprint) {
  dir = fs.realpathSync(dir);
  const state = store.readSession(dir);
  const manifest = json(path.join(dir, 'assets.json'));
  const identity = json(path.join(dir, 'evidence-identity.json'));
  evidence.verifyIdentity(identity, state.packet, dir, expectedFingerprint);
  const assets = new Map();
  for (const q of state.packet.questions) for (const item of q.images) {
    const file = fs.realpathSync(path.join(dir, item.path));
    if (!file.startsWith(dir + path.sep)) throw new Error('Asset outside session');
    const bytes = fs.readFileSync(file);
    if (hash(bytes) !== manifest[item.path]) throw new Error('Screenshot hash mismatch');
    assets.set('/assets/' + item.path, bytes);
  }
  const lock = path.join(dir, '.server-lock');
  fs.mkdirSync(lock); // Fail closed on existing owners, including interrupted sessions.
  const token = crypto.randomBytes(32).toString('hex');
  const leasePath = path.join(dir, `review-resource-lease-${crypto.randomUUID()}.json`);
  let url;
  let uncertainCommit = false;
  const readConfirmed = () => {
    if (uncertainCommit) {
      const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      uncertainCommit = false;
    }
    const current = store.readSession(dir);
    evidence.verifyIdentity(identity, current.packet, dir, expectedFingerprint);
    return current;
  };
  const publicState = current => ({ ...current, evidenceIdentity: identity,
    currentApplicability: expectedFingerprint === undefined ? 'unverified-current-build-or-capture' : 'fingerprint-matched',
    responseAttribution: 'local-browser-session-unverified-human-authorship' });
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, {
      'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(url).host || req.headers['sec-fetch-site'] === 'cross-site') return send(res, 403, { error: 'Local origin required' });
      const route = req.url;
      if (req.method === 'GET') {
        if (route === '/' || route === '/review') return send(res, 200, pages.renderPage({ hub: route === '/' }), 'text/html;charset=utf-8');
        if (route === '/client.js') return send(res, 200, pages.clientSource(), 'text/javascript;charset=utf-8');
        if (route === '/api/state' || route === '/answers.json') return send(res, 200, publicState(readConfirmed()));
        if (route === '/receipt.md') return send(res, 200, store.renderMarkdown(readConfirmed()), 'text/markdown;charset=utf-8');
        if (assets.has(route)) return send(res, 200, assets.get(route), 'image/png');
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      const admin = route === '/admin/message' || route === '/admin/stop';
      if (admin ? req.headers.authorization !== `Bearer ${token}` : req.headers.origin !== url || req.headers['x-review-request'] !== '1') return send(res, 403, { error: 'Request not authorized' });
      if (req.headers['content-type'] !== 'application/json') return send(res, 415, { error: 'JSON required' });
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) { send(res, 413, { error: 'Request too large' }); return; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const keys = Object.keys(body);
      if (route === '/admin/stop') {
        if (keys.length) throw new Error('Unexpected stop properties');
        lease.requestStop(leasePath, { reason: 'Targeted review stop requested' });
        send(res, 200, { stopping: true });
        setImmediate(() => { server.close(); server.closeAllConnections(); });
        return;
      }
      readConfirmed();
      if (route === '/admin/message') {
        if (keys.some(k => !['expectedRevision', 'message'].includes(k))) throw new Error('Unexpected message properties');
        return send(res, 200, publicState(store.updateSession(dir, { expectedRevision: body.expectedRevision, message: body.message })));
      }
      if (route === '/api/answers') {
        if (keys.some(k => !['expectedRevision', 'answers'].includes(k)) || !body.answers) throw new Error('Expected answers only');
        return send(res, 200, publicState(store.updateSession(dir, { expectedRevision: body.expectedRevision, answers: body.answers })));
      }
      if (route === '/api/complete') {
        if (keys.some(k => k !== 'expectedRevision')) throw new Error('Expected revision only');
        return send(res, 200, publicState(store.updateSession(dir, { expectedRevision: body.expectedRevision, complete: true })));
      }
      send(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error.committedRevision !== undefined) uncertainCommit = true;
      send(res, uncertainCommit ? 503 : error.code === 'CONFLICT' ? 409 : 400, { error: error.code === 'CONFLICT' ? 'Saved answers changed; preserve edits and reload.' : 'Request could not be confirmed saved. Preserve your edits and retry.' });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('close', () => {
    try {
      const current = lease.readLease(leasePath);
      if (current.status === 'active') lease.completeCleanup(leasePath, { status: 'unknown', reason: 'Server closed without verified process-exit and listener-release postflight' });
    } catch { /* The targeted CLI postflight reports any lease failure. */ }
    if (fs.existsSync(runtimePath(dir)) && json(runtimePath(dir)).token === token) {
      fs.unlinkSync(runtimePath(dir));
      fs.rmdirSync(lock);
    }
  });
  try {
    const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
    lease.createLease(leasePath, { ownerId: crypto.randomUUID(), ownership: 'created',
      process: { pid: process.pid, startIdentity: lease.processStartIdentity(process.pid), cwd: process.cwd(), commandToken: path.basename(process.execPath) },
      server: { url, sessionDirectory: dir }, browser: { ownedContextIds: [], ownedTabIds: [] } });
    fs.writeFileSync(runtimePath(dir), JSON.stringify({ pid: process.pid, url, token, directory: dir, leasePath, startedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    server.close();
    if (!fs.existsSync(runtimePath(dir))) fs.rmdirSync(lock);
    throw error;
  }
  return { server, url, token };
}

function stopProcess(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (!/^\d+$/.test(fields[19])) throw new Error('Invalid process start identity');
    return { startIdentity: fields[19], exited: fields[0] === 'Z' };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function prepareStop(dir, runtime, legacy) {
  if (!Number.isSafeInteger(runtime.pid) || runtime.pid <= 0 ||
      typeof runtime.token !== 'string' || !/^[a-f0-9]{64}$/.test(runtime.token)) {
    throw new Error('Invalid stop runtime record');
  }
  const currentProcess = stopProcess(runtime.pid);
  if (!currentProcess || currentProcess.exited) throw new Error('Stop owner is not a live process');
  if (!Object.hasOwn(runtime, 'leasePath')) {
    if (!legacy) throw new Error('Missing resource lease; verified legacy shutdown requires stop DIR --legacy');
    const args = fs.readFileSync(`/proc/${runtime.pid}/cmdline`, 'utf8').split('\0');
    if (args.at(-1) === '') args.pop();
    const cwd = fs.realpathSync(`/proc/${runtime.pid}/cwd`);
    if (cwd !== fs.realpathSync(path.join(__dirname, '..')) ||
        (args.length !== 5 && args.length !== 6) ||
        args[1] !== fs.realpathSync(__filename) || args[2] !== 'serve' || args[3] !== dir ||
        !/^(0|[1-9]\d*)$/.test(args[4] || '') ||
        Number(args[4]) > 65535 ||
        (args.length === 6 && !args[5]) ||
        (args[4] !== '0' && Number(args[4]) !== Number(new URL(runtime.url).port)) ||
        fs.realpathSync(args[0]) !== fs.realpathSync(`/proc/${runtime.pid}/exe`)) {
      throw new Error('Legacy process ownership mismatch; no stop requested');
    }
    const confirmedProcess = stopProcess(runtime.pid);
    if (!confirmedProcess || confirmedProcess.exited || confirmedProcess.startIdentity !== currentProcess.startIdentity) {
      throw new Error('Legacy process identity changed; no stop requested');
    }
    return { legacy: true, startIdentity: currentProcess.startIdentity };
  }
  if (legacy) throw new Error('Legacy stop requires a runtime without a leasePath property');
  const file = runtime.leasePath;
  if (typeof file !== 'string' || path.dirname(file) !== dir ||
      !/^review-resource-lease-[a-f0-9-]+\.json$/.test(path.basename(file)) ||
      fs.realpathSync(file) !== file) throw new Error('Invalid stop lease path');
  const currentLease = lease.readLease(file);
  if (currentLease.ownership !== 'created' ||
      !['active', 'stop-requested', 'failed', 'unknown'].includes(currentLease.status) ||
      currentLease.server.sessionDirectory !== dir || currentLease.server.url !== runtime.url ||
      currentLease.process?.pid !== runtime.pid ||
      currentLease.process.startIdentity !== currentProcess.startIdentity ||
      !Array.isArray(currentLease.browser?.ownedContextIds) || !Array.isArray(currentLease.browser?.ownedTabIds) ||
      !lease.processMatches(currentLease)) throw new Error('Stop lease ownership mismatch');
  return { legacy: false, startIdentity: currentProcess.startIdentity };
}

async function main(args) {
  const [command, directory, extra, fourth, fifth] = args;
  if (!directory) throw new Error('Usage: review:session init DIR PACKET_JSON IMAGE_ROOT REVIEWED_FINGERPRINT | start DIR PORT EXPECTED_FINGERPRINT | status DIR | message DIR TEXT | stop DIR [--legacy] | export DIR OUT | verify-export OUT | recover DIR LEASE_FILE');
  const dir = path.resolve(directory);
  if (command === 'init') { initialize(dir, json(extra), path.resolve(fourth), fifth); console.log(`Initialized ${dir}`); return; }
  if (command === 'verify-export') { console.log(JSON.stringify(evidence.verifyExport(dir), null, 2)); return; }
  if (command === 'export') {
    if (!extra) throw new Error('Export destination required');
    const current = store.readSession(dir);
    console.log(JSON.stringify(evidence.exportReview(dir, path.resolve(extra), current, store.renderMarkdown(current)), null, 2));
    return;
  }
  if (command === 'recover') {
    const file = path.resolve(extra || '');
    if (path.dirname(file) !== fs.realpathSync(dir) || !/^review-resource-lease-[a-f0-9-]+\.json$/.test(path.basename(file))) {
      throw new Error('Recovery requires a lease file owned by this session directory');
    }
    const result = await lease.recoverLease(file);
    console.log(JSON.stringify(result, null, 2));
    if (!['verified-stopped', 'intentionally-retained'].includes(result.status)) process.exitCode = 1;
    return;
  }
  if (command === 'serve') {
    const { server, url } = await startServer(dir, Number(extra || 0), fourth);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
    console.log(url); return;
  }
  if (command === 'start') {
    if (!fourth) throw new Error('Current reviewed build or capture fingerprint required for start');
    if (fs.existsSync(runtimePath(dir))) throw new Error('Session has an owner; use status. Stale owners require manual verification.');
    const log = fs.openSync(path.join(dir, 'server.log'), 'a');
    const child = spawn(process.execPath, [__filename, 'serve', dir, extra || '0', fourth], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
    child.unref(); fs.closeSync(log);
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(runtimePath(dir))) { console.log(json(runtimePath(dir)).url); return; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Startup not confirmed; inspect session server.log. No listener was killed.');
  }
  const runtime = json(runtimePath(dir));
  if (!runtime || typeof runtime !== 'object' ||
      !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(runtime.url) ||
      Number(new URL(runtime.url).port || 80) > 65535 ||
      runtime.directory !== fs.realpathSync(dir)) throw new Error('Invalid local runtime record');
  if (command === 'stop' && ((extra !== undefined && extra !== '--legacy') || args.length > 3)) throw new Error('Usage: stop DIR [--legacy]');
  const stopOwner = command === 'stop' ? prepareStop(runtime.directory, runtime, extra === '--legacy') : null;
  const current = await fetch(runtime.url + '/api/state', { signal: AbortSignal.timeout(3000) }).then(r => { if (!r.ok) throw new Error('Status failed'); return r.json(); });
  if (command === 'status') { console.log(JSON.stringify({ url: runtime.url, ...current }, null, 2)); return; }
  const route = command === 'message' ? '/admin/message' : command === 'stop' ? '/admin/stop' : null;
  if (!route) throw new Error('Unknown command');
  if (stopOwner) {
    // Recheck ownership after the asynchronous status request, before sending the capability.
    if (JSON.stringify(json(runtimePath(dir))) !== JSON.stringify(runtime) ||
        prepareStop(runtime.directory, runtime, stopOwner.legacy).startIdentity !== stopOwner.startIdentity) {
      throw new Error('Stop owner changed; no stop requested');
    }
  }
  const response = await fetch(runtime.url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runtime.token}` }, body: JSON.stringify(command === 'message' ? { expectedRevision: current.revision, message: extra } : {}), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Request refused (${response.status}); retry after status.`);
  const result = await response.json();
  if (command === 'stop') {
    let observed;
    for (let i = 0; i < 50; i++) {
      const processState = stopProcess(runtime.pid);
      observed = {
        ownedLockRemoved: !fs.existsSync(path.dirname(runtimePath(dir))),
        processExited: !processState || processState.exited || processState.startIdentity !== stopOwner.startIdentity,
        listenerReleased: await lease.isListenerReleased(runtime.url),
      };
      if (observed.ownedLockRemoved && observed.processExited && observed.listenerReleased) {
        if (stopOwner.legacy) {
          console.log(JSON.stringify({ status: 'verified-stopped', mode: 'legacy', cleanupScope: 'server-only', browserCleanup: 'not-verified', ...observed }));
        } else {
          const result = await lease.verifyCleanup(runtime.leasePath);
          console.log(JSON.stringify({ status: result.status, ownedLockRemoved: true }));
          if (result.status !== 'verified-stopped') process.exitCode = 1;
        }
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (stopOwner.legacy) {
      console.log(JSON.stringify({ status: 'unknown', mode: 'legacy', cleanupScope: 'server-only', browserCleanup: 'not-verified', ...observed }));
      process.exitCode = 1;
      return;
    }
    const result = lease.completeCleanup(runtime.leasePath, { status: 'unknown', reason: 'Shutdown requested but process exit, listener release, and owned-lock cleanup were not all confirmed' });
    console.log(JSON.stringify({ status: result.status, ownedLockRemoved: !fs.existsSync(runtimePath(dir)) }));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { initialize, startServer };
