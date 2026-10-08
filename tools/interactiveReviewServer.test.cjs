'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { initialize, startServer } = require('./interactiveReviewServer.cjs');
const { exportReview, verifyExport } = require('./reviewEvidenceIdentity.cjs');
const { readSession, renderMarkdown, updateSession } = require('./interactiveReviewStore.cjs');
const execFileAsync = promisify(execFile);
const serverScript = path.join(__dirname, 'interactiveReviewServer.cjs');
const packet = { schemaVersion: 1, id: 'test-review', title: 'Test', context: 'Synthetic', questions: [{ id: 'V01', text: 'Review?', choices: [{ value: 'a', label: 'Yes' }], images: [], observations: [] }] };

test('local bridge persists, rejects cross-origin and conflicts, completes and releases only its lock', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-server-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session');
  initialize(dir, packet, root, 'synthetic-capture:server-test');
  const { server, url, token } = await startServer(dir);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(startServer(dir), /EEXIST/);
  const post = (route, body, headers = {}) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url, 'X-Review-Request': '1', ...headers }, body: JSON.stringify(body) });
  let state = await fetch(url + '/api/state').then(r => r.json());
  assert.equal(state.packet.id, packet.id);
  assert.equal((await post('/api/answers', { expectedRevision: state.revision, answers: {} }, { Origin: 'https://example.org' })).status, 403);
  assert.equal(await new Promise((resolve, reject) => {
    http.get(url + '/api/state', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  }), 403);
  assert.equal((await fetch(url + '/api/state', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const answers = { V01: { choice: 'a', comment: 'Exact essay\n<script>not code</script>' } };
  const response = await post('/api/answers', { expectedRevision: state.revision, answers });
  assert.equal(response.status, 200);
  state = await response.json();
  assert.deepEqual(state.answers, answers);
  assert.equal((await post('/api/answers', { expectedRevision: state.revision - 1, answers })).status, 409);
  assert.equal((await post('/api/answers', { expectedRevision: state.revision, answers, complete: true })).status, 400);
  assert.equal((await post('/admin/message', { expectedRevision: state.revision, message: 'Work ongoing' })).status, 403);
  state = await post('/admin/message', { expectedRevision: state.revision, message: 'Work ongoing' }, { Authorization: `Bearer ${token}` }).then(r => r.json());
  assert.equal(state.messages.at(-1).text, 'Work ongoing');
  assert.deepEqual(state.answers, answers);
  assert.equal((await fetch(url + '/../../package.json')).status, 404);
  assert.match(await fetch(url + '/receipt.md').then(r => r.text()), /Exact essay/);
  state = await post('/api/complete', { expectedRevision: state.revision }).then(r => r.json());
  assert.ok(state.completedAt);
  assert.notEqual((await post('/api/answers', { expectedRevision: state.revision, answers })).status, 200);
  await new Promise(resolve => server.close(resolve));
  assert.equal(fs.existsSync(path.join(dir, '.server-lock')), false);
  const exported = path.join(root, 'portable-export');
  assert.throws(() => exportReview(dir, path.join(root, 'invalid-export'), readSession(dir), 'forged receipt'), /Receipt does not match answers/);
  assert.equal(fs.existsSync(path.join(root, 'invalid-export')), false);
  const alias = path.join(root, 'session-alias');
  fs.symlinkSync(dir, alias, 'dir');
  assert.throws(() => exportReview(dir, path.join(alias, 'escaped'), readSession(dir), renderMarkdown(readSession(dir))), /outside source/);
  exportReview(dir, exported, readSession(dir), renderMarkdown(readSession(dir)));
  assert.equal(verifyExport(exported).verified, true);
  fs.writeFileSync(path.join(exported, 'unexpected-private-data.txt'), 'unlisted');
  assert.throws(() => verifyExport(exported), /Unexpected or missing export artifact/);
  fs.unlinkSync(path.join(exported, 'unexpected-private-data.txt'));
  const answerBytes = fs.readFileSync(path.join(exported, 'answers.json'));
  fs.renameSync(path.join(exported, 'answers.json'), path.join(root, 'external-answers.json'));
  fs.symlinkSync(path.join(root, 'external-answers.json'), path.join(exported, 'answers.json'));
  assert.throws(() => verifyExport(exported), /symlink refused/);
  fs.unlinkSync(path.join(exported, 'answers.json'));
  fs.writeFileSync(path.join(exported, 'answers.json'), answerBytes);
  const alteredManifest = JSON.parse(fs.readFileSync(path.join(exported, 'manifest.json')));
  fs.appendFileSync(path.join(exported, 'receipt.md'), '\nforged');
  alteredManifest.fileSha256['receipt.md'] = require('./reviewEvidenceIdentity.cjs').sha256(fs.readFileSync(path.join(exported, 'receipt.md')));
  fs.writeFileSync(path.join(exported, 'manifest.json'), JSON.stringify(alteredManifest));
  assert.throws(() => verifyExport(exported), /Receipt does not match answers/);
  fs.appendFileSync(path.join(exported, 'receipt.md'), '\nchanged');
  assert.throws(() => verifyExport(exported), /byte mismatch/);
  const restarted = await startServer(dir);
  assert.equal((await fetch(restarted.url + '/api/state').then(r => r.json())).completedAt, state.completedAt);
  await new Promise(resolve => restarted.server.close(resolve));
});

test('review identity rejects changed questions and figure bytes before use', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = structuredClone(packet);
  input.questions[0].images = [{ path: 'annotated/figure.png', label: 'Figure' }];
  fs.mkdirSync(path.join(root, 'annotated'));
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(path.join(root, 'annotated/figure.png'), pixel);
  const dir = path.join(root, 'session');
  initialize(dir, input, root, 'synthetic-build:abc123');
  await assert.rejects(startServer(dir, 0, 'synthetic-build:changed'), /fingerprint mismatch/);
  const { server, url } = await startServer(dir);
  t.after(() => { if (server.listening) server.close(); });
  const current = await fetch(url + '/api/state').then(r => r.json());
  assert.equal(current.evidenceIdentity.reviewedFingerprint, 'synthetic-build:abc123');
  assert.equal(current.currentApplicability, 'unverified-current-build-or-capture');
  fs.appendFileSync(path.join(dir, 'annotated/figure.png'), 'tamper');
  assert.equal((await fetch(url + '/api/state')).status, 400);
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(startServer(dir), /identity|hash mismatch/i);
});

test('packet assets are bounded to a frozen allowlist', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bad = structuredClone(packet);
  bad.questions[0].images = [{ path: '../secret.png', label: 'No' }];
  assert.throws(() => initialize(path.join(root, 'session'), bad, root), /Invalid image/);
});

async function stopFixture(t, { wrongCwd = false, preload, extraArgs = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-stop-'));
  const dir = path.join(root, 'session');
  initialize(dir, packet, root, 'synthetic-stop-fixture');
  updateSession(dir, { expectedRevision: 1, answers: { V01: { choice: 'a', comment: 'Retain this answer' } } });
  updateSession(dir, { expectedRevision: 2, complete: true });
  const env = { ...process.env };
  if (preload) {
    const file = path.join(root, 'preload.cjs');
    fs.writeFileSync(file, preload);
    env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --require=${file}`;
  }
  const child = spawn(process.execPath, [serverScript, 'serve', dir, '0', 'synthetic-stop-fixture', ...extraArgs], {
    cwd: wrongCwd ? root : path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    const fallback = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await closed; } finally { clearTimeout(fallback); }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const file = path.join(dir, '.server-lock/runtime.json');
  for (let i = 0; i < 100 && !fs.existsSync(file); i++) {
    if (child.exitCode !== null) throw new Error(`Fixture exited: ${output}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(fs.existsSync(file), output);
  const runtime = JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = (...args) => execFileAsync(process.execPath, [serverScript, 'stop', dir, ...args], { timeout: 12000 });
  return { root, dir, file, runtime, child, closed, run };
}

test('CLI legacy stop requires explicit selection, preserves answers and unrelated listeners, and makes no browser claim', async t => {
  const f = await stopFixture(t);
  const legacy = { ...f.runtime };
  delete legacy.leasePath;
  fs.writeFileSync(f.file, JSON.stringify(legacy));
  fs.unlinkSync(path.join(f.dir, 'evidence-identity.json'));
  const before = readSession(f.dir);
  const leaseNames = fs.readdirSync(f.dir).filter(name => name.startsWith('review-resource-lease-'));
  await assert.rejects(f.run(), error => error.code === 1 && /requires stop DIR --legacy/.test(error.stderr));
  assert.equal((await fetch(f.runtime.url + '/api/state')).status, 200);
  const unrelated = http.createServer((req, res) => res.end('preserved'));
  await new Promise(resolve => unrelated.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { unrelated.close(resolve); unrelated.closeAllConnections(); }));
  const result = await f.run('--legacy');
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 'verified-stopped', mode: 'legacy', cleanupScope: 'server-only', browserCleanup: 'not-verified',
    ownedLockRemoved: true, processExited: true, listenerReleased: true,
  });
  await f.closed;
  assert.equal(fs.existsSync(path.dirname(f.file)), false);
  assert.deepEqual(readSession(f.dir), before);
  assert.deepEqual(fs.readdirSync(f.dir).filter(name => name.startsWith('review-resource-lease-')), leaseNames);
  assert.equal(await fetch(`http://127.0.0.1:${unrelated.address().port}`).then(r => r.text()), 'preserved');
});

test('CLI stop rejects malformed or mismatched leases before changing the live isolated server', async t => {
  const f = await stopFixture(t);
  const originalLease = JSON.parse(fs.readFileSync(f.runtime.leasePath, 'utf8'));
  const cases = [
    ['null lease', r => { r.leasePath = null; }],
    ['missing lease file', r => { r.leasePath = path.join(f.dir, 'review-resource-lease-deadbeef.json'); }],
    ['outside lease', r => { r.leasePath = path.join(f.root, 'review-resource-lease-deadbeef.json'); }],
    ['invalid lease schema', (r, l) => { l.schema = 'invalid'; }],
    ['wrong pid', (r, l) => { l.process.pid += 1; }],
    ['wrong start identity', (r, l) => { l.process.startIdentity += '0'; }],
    ['wrong session', (r, l) => { l.server.sessionDirectory = f.root; }],
    ['wrong URL', (r, l) => { l.server.url = 'http://127.0.0.1:1'; }],
    ['wrong cwd', (r, l) => { l.process.cwd = f.root; }],
    ['wrong command', (r, l) => { l.process.commandToken = 'not-the-fixture-command'; }],
    ['reused ownership', (r, l) => { l.ownership = 'reused'; }],
    ['invalid browser record', (r, l) => { delete l.browser; }],
    ['invalid token', r => { r.token = ''; }],
    ['invalid pid', r => { r.pid = -1; }],
    ['invalid zero port', r => { r.url = 'http://127.0.0.1:0'; }],
    ['invalid oversized port', r => { r.url = 'http://127.0.0.1:65536'; }],
    ['invalid directory', r => { r.directory = f.root; }],
  ];
  for (const [name, change] of cases) await t.test(name, async () => {
    const runtime = structuredClone(f.runtime);
    const record = structuredClone(originalLease);
    change(runtime, record);
    const runtimeBytes = JSON.stringify(runtime);
    const leaseBytes = JSON.stringify(record);
    fs.writeFileSync(f.file, runtimeBytes);
    fs.writeFileSync(f.runtime.leasePath, leaseBytes);
    try {
      await assert.rejects(f.run(), error => error.code === 1);
      await assert.rejects(f.run('--legacy'), error => error.code === 1);
      assert.equal(fs.readFileSync(f.file, 'utf8'), runtimeBytes);
      assert.equal(fs.readFileSync(f.runtime.leasePath, 'utf8'), leaseBytes);
      assert.equal((await fetch(f.runtime.url + '/api/state')).status, 200);
    } finally {
      fs.writeFileSync(f.file, JSON.stringify(f.runtime));
      fs.writeFileSync(f.runtime.leasePath, JSON.stringify(originalLease));
    }
  });
  const result = await f.run();
  assert.deepEqual(JSON.parse(result.stdout), { status: 'verified-stopped', ownedLockRemoved: true });
  await f.closed;
});

test('CLI legacy stop rejects a live process from a different checkout cwd', async t => {
  const f = await stopFixture(t, { wrongCwd: true });
  const runtime = { ...f.runtime };
  delete runtime.leasePath;
  fs.writeFileSync(f.file, JSON.stringify(runtime));
  await assert.rejects(f.run('--legacy'), error => error.code === 1 && /ownership mismatch/.test(error.stderr));
  assert.equal((await fetch(f.runtime.url + '/api/state')).status, 200);
});

test('CLI legacy stop supports a server without any resource lease file', async t => {
  const f = await stopFixture(t, { preload: `
    const http = require('node:http');
    const createServer = http.createServer;
    http.createServer = function(handler) {
      const server = createServer.call(this, (req, res) => {
        if (req.url === '/admin/stop') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ stopping: true }));
          setImmediate(() => { server.close(); server.closeAllConnections(); });
          return;
        }
        handler(req, res);
      });
      return server;
    };
  ` });
  const runtime = { ...f.runtime };
  delete runtime.leasePath;
  fs.writeFileSync(f.file, JSON.stringify(runtime));
  fs.unlinkSync(f.runtime.leasePath);
  const before = readSession(f.dir);
  const result = JSON.parse((await f.run('--legacy')).stdout);
  assert.deepEqual(result, {
    status: 'verified-stopped', mode: 'legacy', cleanupScope: 'server-only', browserCleanup: 'not-verified',
    ownedLockRemoved: true, processExited: true, listenerReleased: true,
  });
  await f.closed;
  assert.equal(fs.existsSync(path.dirname(f.file)), false);
  assert.equal(fs.readdirSync(f.dir).some(name => name.startsWith('review-resource-lease-')), false);
  assert.deepEqual(readSession(f.dir), before);
});

test('CLI legacy stop rejects additional command arguments before mutation', async t => {
  const f = await stopFixture(t, { extraArgs: ['unexpected'] });
  const runtime = { ...f.runtime };
  delete runtime.leasePath;
  const bytes = JSON.stringify(runtime);
  fs.writeFileSync(f.file, bytes);
  const leaseBytes = fs.readFileSync(f.runtime.leasePath);
  await assert.rejects(f.run('--legacy'), error => error.code === 1 && /ownership mismatch/.test(error.stderr));
  assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
  assert.deepEqual(fs.readFileSync(f.runtime.leasePath), leaseBytes);
  assert.equal((await fetch(f.runtime.url + '/api/state')).status, 200);
});

test('CLI legacy stop rejects the same script serving a different session', async t => {
  const target = await stopFixture(t);
  const other = await stopFixture(t);
  const runtime = { ...target.runtime, pid: other.child.pid };
  delete runtime.leasePath;
  const bytes = JSON.stringify(runtime);
  fs.writeFileSync(target.file, bytes);
  await assert.rejects(target.run('--legacy'), error => error.code === 1 && /ownership mismatch/.test(error.stderr));
  assert.equal(fs.readFileSync(target.file, 'utf8'), bytes);
  assert.equal((await fetch(target.runtime.url + '/api/state')).status, 200);
  assert.equal((await fetch(other.runtime.url + '/api/state')).status, 200);
});

test('CLI legacy stop rejects a changed start identity or exited owner before POST', async t => {
  const f = await stopFixture(t);
  const runtime = { ...f.runtime };
  delete runtime.leasePath;
  const bytes = JSON.stringify(runtime);
  fs.writeFileSync(f.file, bytes);
  const leaseBytes = fs.readFileSync(f.runtime.leasePath);
  for (const mode of ['startIdentity', 'exited']) await t.test(mode, async () => {
    const preload = path.join(f.root, `stat-${mode}.cjs`);
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const read = fs.readFileSync;
      let reads = 0;
      fs.readFileSync = function(file, ...args) {
        const value = read.call(this, file, ...args);
        if (file !== '/proc/${f.child.pid}/stat' || ++reads < 2) return value;
        const end = value.lastIndexOf(')') + 2;
        const fields = value.slice(end).trim().split(/\\s+/);
        if ('${mode}' === 'exited') fields[0] = 'Z';
        else fields[19] = String(BigInt(fields[19]) + 1n);
        return value.slice(0, end) + fields.join(' ');
      };
    `);
    await assert.rejects(execFileAsync(process.execPath,
      ['--require', preload, serverScript, 'stop', f.dir, '--legacy'], { timeout: 12000 }),
    error => error.code === 1 && /identity changed/.test(error.stderr));
    assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
    assert.deepEqual(fs.readFileSync(f.runtime.leasePath), leaseBytes);
    assert.equal((await fetch(f.runtime.url + '/api/state')).status, 200);
  });
});

test('CLI legacy stop rejects a different command or session and rechecks runtime after status', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-stop-reject-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session');
  fs.mkdirSync(path.join(dir, '.server-lock'), { recursive: true });
  let stops = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') stops++;
    res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const file = path.join(dir, '.server-lock/runtime.json');
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, url: `http://127.0.0.1:${server.address().port}`, directory: dir, token: 'a'.repeat(64) }));
  await assert.rejects(execFileAsync(process.execPath, [serverScript, 'stop', dir, '--legacy']), error => error.code === 1 && /ownership mismatch/.test(error.stderr));
  assert.equal(stops, 0);

  const f = await stopFixture(t, { preload: `
    const fs = require('node:fs');
    const http = require('node:http');
    const createServer = http.createServer;
    http.createServer = function(handler) {
      return createServer.call(this, (req, res) => {
        if (req.url === '/api/state') {
          const file = require('node:path').join(process.argv[3], '.server-lock/runtime.json');
          const record = JSON.parse(fs.readFileSync(file, 'utf8'));
          record.startedAt = 'changed-during-status';
          fs.writeFileSync(file, JSON.stringify(record));
        }
        handler(req, res);
      });
    };
  ` });
  const legacy = { ...f.runtime };
  delete legacy.leasePath;
  fs.writeFileSync(f.file, JSON.stringify(legacy));
  await assert.rejects(f.run('--legacy'), error => error.code === 1 && /Stop owner changed/.test(error.stderr));
  assert.equal((await fetch(f.runtime.url + '/api/state')).status, 200);
});

test('CLI legacy stop does not accept an acknowledgement or missing runtime file as cleanup proof', async t => {
  const f = await stopFixture(t, { preload: `
    const http = require('node:http');
    const createServer = http.createServer;
    http.createServer = function(handler) {
      return createServer.call(this, (req, res) => {
        if (req.url === '/admin/stop') {
          require('node:fs').unlinkSync(require('node:path').join(process.argv[3], '.server-lock/runtime.json'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ stopping: true }));
          return;
        }
        handler(req, res);
      });
    };
  ` });
  const runtime = { ...f.runtime };
  delete runtime.leasePath;
  fs.writeFileSync(f.file, JSON.stringify(runtime));
  await assert.rejects(f.run('--legacy'), error => {
    assert.equal(error.code, 1);
    assert.deepEqual(JSON.parse(error.stdout), {
      status: 'unknown', mode: 'legacy', cleanupScope: 'server-only', browserCleanup: 'not-verified',
      ownedLockRemoved: false, processExited: false, listenerReleased: false,
    });
    return true;
  });
  assert.equal((await fetch(f.runtime.url + '/api/state')).status, 200);
  assert.ok(fs.existsSync(path.dirname(f.file)));
});
