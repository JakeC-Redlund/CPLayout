'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lease = require('./reviewResourceLease.cjs');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cplayout-review-lease-'));
  const file = name => path.join(dir, name, 'review-resource-lease.json');
  const input = ownership => ({
    ownerId: 'test-review', ownership,
    process: ownership === 'created' ? { pid: process.pid, startIdentity: lease.processStartIdentity(process.pid), cwd: process.cwd(), commandToken: 'reviewResourceLease.test.cjs' } : null,
    server: { url: 'http://127.0.0.1:19345', sessionDirectory: dir },
    browser: { ownedContextIds: ['context-owned'], ownedTabIds: ['tab-owned'] },
  });
  try {
    assert.ok(lease.processStartIdentity(process.pid));
    const created = lease.createLease(file('created'), input('created'));
    assert.equal(created.status, 'active');
    assert.equal(lease.processMatches(created), true);
    assert.throws(() => lease.createLease(file('created'), input('created')), /EEXIST/);
    assert.equal(lease.requestStop(file('created')).status, 'stop-requested');
    assert.equal(lease.requestStop(file('created')).revision, 1);
    assert.throws(() => lease.completeCleanup(file('created'), { status: 'verified-stopped', processExited: true, listenerReleased: false }), /requires/);
    assert.equal(lease.readLease(file('created')).status, 'stop-requested');
    assert.equal(lease.completeCleanup(file('created'), { status: 'failed', reason: 'timeout' }).status, 'failed');
    assert.equal(lease.readLease(file('created')).reason, 'timeout');

    lease.createLease(file('mismatch'), input('created'));
    let signalled = false;
    const mismatch = await lease.recoverLease(file('mismatch'), {
      processMatches: () => false, isProcessRunning: () => true,
      stopOwnedProcess: () => { signalled = true; }, isListenerReleased: async () => false,
    });
    assert.equal(mismatch.status, 'failed');
    assert.equal(signalled, false);
    assert.match(mismatch.reason, /identity mismatch/);

    lease.createLease(file('reused'), input('reused'));
    const reused = await lease.recoverLease(file('reused'), { stopOwnedProcess: () => { signalled = true; }, closeOwnedBrowser: () => true });
    assert.equal(reused.status, 'intentionally-retained');
    assert.equal(reused.evidence.browserClosed, true);
    assert.equal(signalled, false);

    lease.createLease(file('success'), input('created'));
    const closed = [];
    let running = true;
    const success = await lease.recoverLease(file('success'), {
      processMatches: () => true, isProcessRunning: () => running,
      stopOwnedProcess: () => { running = false; }, isListenerReleased: async () => true,
      closeOwnedBrowser: (contexts, tabs) => { closed.push({ contexts, tabs }); return true; },
    });
    assert.equal(success.status, 'verified-stopped');
    assert.deepEqual(closed, [{ contexts: ['context-owned'], tabs: ['tab-owned'] }]);
    assert.equal(fs.existsSync(file('success')), true);

    lease.createLease(file('missing-browser'), input('created'));
    const missingBrowser = await lease.recoverLease(file('missing-browser'), {
      processMatches: () => true, isProcessRunning: () => false, isListenerReleased: async () => true,
    });
    assert.equal(missingBrowser.status, 'failed');
    assert.match(missingBrowser.reason, /browser cleanup unavailable/);
    assert.throws(() => lease.completeCleanup(file('missing-browser'), { status: 'verified-stopped', processExited: true, listenerReleased: true }), /browser cleanup/);

    lease.createLease(file('verified'), input('created'));
    lease.requestStop(file('verified'));
    assert.equal((await lease.verifyCleanup(file('verified'), {
      isProcessExited: () => true, isListenerReleased: async () => true,
      closeOwnedBrowser: () => true,
    })).status, 'verified-stopped');

    lease.createLease(file('timeout'), input('created'));
    const timeout = await lease.recoverLease(file('timeout'), {
      processMatches: () => true, isProcessRunning: () => true,
      stopOwnedProcess: () => {}, isListenerReleased: async () => false, closeOwnedBrowser: () => true,
    });
    assert.equal(timeout.status, 'failed');
    assert.equal(lease.readLease(file('timeout')).status, 'failed');
    console.log('review resource lease tests passed');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
