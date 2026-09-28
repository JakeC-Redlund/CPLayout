'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { initialize, startServer } = require('./interactiveReviewServer.cjs');
const { readSession } = require('./interactiveReviewStore.cjs');

const execFileAsync = promisify(execFile);
const storedProjection = value => {
  const { evidenceIdentity, responseAttribution, currentApplicability, ...stored } = value;
  return stored;
};

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-durability-'));
  const dir = path.join(root, 'session');
  const requests = [];
  let runtime;
  let closed;
  t.after(async () => {
    t.mock.restoreAll();
    for (const request of requests) request.destroy();
    if (runtime) {
      runtime.server.closeAllConnections();
      if (runtime.server.listening) runtime.server.close();
      await closed;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  initialize(dir, {
    schemaVersion: 1, id: 'durability-review', title: 'Durability review', context: 'Synthetic regression fixture',
    questions: [1, 2, 3].map(index => ({ id: `V0${index}`, text: 'Your observations?', choices: [], images: [], observations: [] })),
  }, root, 'synthetic-capture:durability-test');
  runtime = await startServer(dir);
  closed = new Promise(resolve => runtime.server.once('close', resolve));
  const lock = path.join(dir, '.server-lock');
  const headers = { 'Content-Type': 'application/json', Origin: runtime.url, 'X-Review-Request': '1' };
  const request = (route, body, extraHeaders = {}) => fetch(runtime.url + route, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
  });
  return { ...runtime, dir, lock, requests, closed, headers, request };
}

async function partialRequest(f) {
  const observed = new Promise(resolve => f.server.once('request', resolve));
  const request = http.request(f.url + '/api/answers', {
    method: 'POST', headers: { ...f.headers, 'Content-Length': '10000' }, agent: false,
  });
  f.requests.push(request);
  request.on('error', () => {}); // Shutdown intentionally resets this unfinished request.
  request.on('response', response => response.resume());
  const closed = new Promise(resolve => request.once('close', resolve));
  request.write('{');
  const incoming = await observed;
  assert.equal(incoming.complete, false);
  assert.equal(request.destroyed, false);
  return { request, closed };
}

async function assertStopped(f, partial) {
  await Promise.all([f.closed, partial.closed]);
  assert.equal(f.server.listening, false);
  assert.equal(partial.request.destroyed, true);
  assert.equal(fs.existsSync(f.lock), false);
  await assert.rejects(fetch(f.url + '/api/state', { signal: AbortSignal.timeout(2000) }));
  assert.equal(readSession(f.dir).revision, 1, 'The unfinished request must not commit answers');
}

// fs monkeypatches affect the whole process, so keep every case in this suite serial.
describe('interactive review HTTP durability regressions', { concurrency: false, timeout: 15000 }, () => {
  for (const operation of ['answers', 'complete']) {
    test(`${operation}: uncertain commits return 503 until directory resync succeeds`, async t => {
      const f = await fixture(t);
      const initial = readSession(f.dir);
      const originalFsync = fs.fsyncSync;
      let failDirectorySync = true;
      let failedSyncs = 0;
      let successfulSyncs = 0;
      t.mock.method(fs, 'fsyncSync', fd => {
        if (fs.fstatSync(fd).isDirectory()) {
          if (failDirectorySync) {
            failedSyncs += 1;
            throw Object.assign(new Error('Injected directory fsync failure'), { code: 'EIO' });
          }
          originalFsync(fd);
          successfulSyncs += 1;
          return;
        }
        return originalFsync(fd);
      });
      const body = { expectedRevision: initial.revision };
      if (operation === 'answers') body.answers = { V01: { choice: null, comment: '  Exact essay\r\n<script>literal</script>  ' } };
      const response = await f.request(`/api/${operation}`, body);
      assert.equal(response.status, 503);
      const failure = await response.json();
      assert.equal(Object.hasOwn(failure, 'revision'), false, 'An error must not masquerade as an acknowledged state');
      assert.equal(failedSyncs, 1);
      const published = readSession(f.dir);
      assert.equal(published.revision, initial.revision + 1, 'The post-link failure must retain the immutable revision');
      if (operation === 'answers') assert.deepEqual(published.answers.V01, body.answers.V01);
      else assert.ok(published.completedAt);

      for (const route of ['/api/state', '/answers.json', '/receipt.md', '/api/state']) {
        const previousFailures = failedSyncs;
        const blocked = await f.request(route);
        assert.equal(blocked.status, 503, `${route} must not disclose an uncertain receipt`);
        assert.equal(Object.hasOwn(await blocked.json(), 'revision'), false);
        assert.equal(failedSyncs, previousFailures + 1, `${route} must attempt directory resync`);
      }
      const blockedWrite = await f.request('/api/answers', {
        expectedRevision: published.revision, answers: { V02: { comment: 'Must not commit while sync fails' } },
      });
      assert.equal(blockedWrite.status, 503);
      await blockedWrite.text();
      assert.deepEqual(readSession(f.dir), published);

      failDirectorySync = false;
      const recovered = await f.request('/api/state');
      assert.equal(recovered.status, 200);
      assert.equal(successfulSyncs, 1, 'Recovery must sync the directory before acknowledging the published state');
      assert.deepEqual(storedProjection(await recovered.json()), published);
      const download = await f.request('/answers.json');
      assert.equal(download.status, 200);
      assert.deepEqual(storedProjection(await download.json()), published);
      const receipt = await f.request('/receipt.md');
      assert.equal(receipt.status, 200);
      assert.match(await receipt.text(), new RegExp(`Revision: ${published.revision}`));
      assert.equal(successfulSyncs, 1, 'Confirmed reads must not keep resyncing the recovered commit');
      const staleRetry = await f.request(`/api/${operation}`, body);
      assert.equal(staleRetry.status, 409, 'Retrying the original revision must not duplicate the commit');
      await staleRetry.text();
      assert.deepEqual(readSession(f.dir), published);
    });
  }

  test('accepts and persists a valid full essay snapshot larger than 256 KiB', async t => {
    const f = await fixture(t);
    const initial = readSession(f.dir);
    const answers = Object.fromEntries(initial.packet.questions.map(({ id }) => [id, {
      choice: null, comment: `  ${id}\r\n<script>literal</script>\n` + 'x'.repeat(90000) + '\n  ',
    }]));
    const body = { expectedRevision: initial.revision, answers };
    assert.ok(Buffer.byteLength(JSON.stringify(body)) > 256 * 1024);
    const response = await f.request('/api/answers', body);
    assert.equal(response.status, 200);
    const acknowledged = await response.json();
    assert.equal(acknowledged.revision, initial.revision + 1);
    assert.deepEqual(acknowledged.answers, answers);
    assert.deepEqual(readSession(f.dir), storedProjection(acknowledged));
    const reopened = await f.request('/api/state');
    assert.equal(reopened.status, 200);
    assert.deepEqual(await reopened.json(), acknowledged);
  });

  test('stop reports stopping, then closes a partial request and removes its owned lock', async t => {
    const f = await fixture(t);
    const partial = await partialRequest(f);
    assert.equal(fs.existsSync(f.lock), true);
    const response = await f.request('/admin/stop', {}, { Authorization: `Bearer ${f.token}` });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.stopping, true);
    assert.notEqual(body.stopped, true, 'The HTTP response must not prematurely claim shutdown completed');
    await assertStopped(f, partial);
  });

  test('CLI stop confirms actual owned-lock removal with an unfinished request open', async t => {
    const f = await fixture(t);
    const partial = await partialRequest(f);
    const failure = await execFileAsync(process.execPath, [
      path.join(__dirname, 'interactiveReviewServer.cjs'), 'stop', f.dir,
    ], { timeout: 8000, maxBuffer: 65536 }).then(() => null, error => error);
    assert.equal(failure.code, 1, 'An unverified process exit must fail the CLI command');
    assert.equal(failure.stderr, '');
    assert.deepEqual(JSON.parse(failure.stdout), { status: 'unknown', ownedLockRemoved: true });
    assert.equal(fs.existsSync(f.lock), false, 'CLI success must follow owned-lock cleanup');
    await assertStopped(f, partial);
  });
});
