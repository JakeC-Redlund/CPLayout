'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');

const STATUS = new Set(['active', 'stop-requested', 'verified-stopped', 'intentionally-retained', 'failed', 'unknown']);
const TERMINAL = new Set(['verified-stopped', 'intentionally-retained']);

function processStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return fields[19] || null; // Linux stat field 22, after pid and comm.
  } catch { return null; }
}

function isProcessExited(processRecord) {
  if (!processRecord) return true;
  if (processStartIdentity(processRecord.pid) !== processRecord.startIdentity) return true;
  try {
    const stat = fs.readFileSync(`/proc/${processRecord.pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
  } catch { return true; }
}

function processMatches(lease) {
  const p = lease.process;
  if (!p || !Number.isSafeInteger(p.pid) || !p.startIdentity || !p.cwd || !p.commandToken) return false;
  if (processStartIdentity(p.pid) !== p.startIdentity) return false;
  try {
    return fs.realpathSync(`/proc/${p.pid}/cwd`) === fs.realpathSync(p.cwd) &&
      fs.readFileSync(`/proc/${p.pid}/cmdline`, 'utf8').split('\0').some(arg => arg.includes(p.commandToken));
  } catch { return false; }
}

function readLease(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schema !== 'cplayout-review-resource-lease-v1' || !STATUS.has(value.status) ||
      !value.leaseId || !value.ownerId || !value.ownership || !value.server?.url ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(value.server.url) || !Number.isSafeInteger(value.revision)) {
    throw new Error('Invalid review resource lease');
  }
  return value;
}

function writeLease(file, lease, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (exclusive) return fs.writeFileSync(file, `${JSON.stringify(lease, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(lease, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(temp, { force: true }); }
}

function createLease(file, input) {
  if (!input || typeof input.ownerId !== 'string' || !input.ownerId ||
      !['created', 'reused'].includes(input.ownership) ||
      !/^http:\/\/127\.0\.0\.1:\d+$/.test(input.server?.url || '')) throw new Error('Invalid lease owner or local server URL');
  if (input.ownership === 'created' && (!input.process?.startIdentity || !input.process?.cwd || !input.process?.commandToken)) {
    throw new Error('Created process requires start identity, cwd, and command token');
  }
  const now = new Date().toISOString();
  const lease = {
    schema: 'cplayout-review-resource-lease-v1', leaseId: crypto.randomUUID(), revision: 0,
    ownerId: input.ownerId, ownership: input.ownership, process: input.process || null,
    server: { url: input.server.url, sessionDirectory: input.server.sessionDirectory || null },
    browser: { ownedContextIds: input.browser?.ownedContextIds || [], ownedTabIds: input.browser?.ownedTabIds || [] },
    status: 'active', reason: null, createdAt: now, updatedAt: now,
  };
  writeLease(file, lease, true);
  return lease;
}

function update(file, patch, expectedRevision) {
  const current = readLease(file);
  if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('Lease revision conflict');
  const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  writeLease(file, next);
  return next;
}

function requestStop(file, { reason, expectedRevision } = {}) {
  const lease = readLease(file);
  if (TERMINAL.has(lease.status)) return lease;
  if (lease.status === 'stop-requested') return lease;
  return update(file, { status: 'stop-requested', reason: reason || 'Cleanup requested' }, expectedRevision);
}

function hasOwnedBrowser(lease) {
  return lease.browser.ownedContextIds.length > 0 || lease.browser.ownedTabIds.length > 0;
}

async function closeOwnedBrowser(lease, adapters) {
  if (!hasOwnedBrowser(lease)) return true;
  if (!adapters.closeOwnedBrowser) return false;
  return await adapters.closeOwnedBrowser(lease.browser.ownedContextIds, lease.browser.ownedTabIds) === true;
}

function completeCleanup(file, { status, processExited, listenerReleased, browserClosed, reason, expectedRevision } = {}) {
  if (!STATUS.has(status) || status === 'active' || status === 'stop-requested') throw new Error('Invalid cleanup status');
  const lease = readLease(file);
  if (lease.status === 'verified-stopped') return lease;
  if (status === 'verified-stopped' && (processExited !== true || listenerReleased !== true ||
      (hasOwnedBrowser(lease) && browserClosed !== true))) {
    throw new Error('Verified stop requires process exit, listener release, and owned browser cleanup');
  }
  if (status === 'intentionally-retained' && !reason) throw new Error('Retention requires a reason');
  return update(file, { status, reason: reason || null, evidence: {
    processExited: processExited === true, listenerReleased: listenerReleased === true,
    browserClosed: browserClosed === true || !hasOwnedBrowser(lease),
    checkedAt: new Date().toISOString(),
  } }, expectedRevision);
}

async function isListenerReleased(url) {
  const { hostname, port } = new URL(url);
  return new Promise(resolve => {
    const socket = net.connect({ host: hostname, port: Number(port) });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => resolve(error.code === 'ECONNREFUSED'));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function verifyCleanup(file, adapters = {}) {
  const lease = readLease(file);
  const processExited = (adapters.isProcessExited || isProcessExited)(lease.process);
  const listenerReleased = await (adapters.isListenerReleased || isListenerReleased)(lease.server.url);
  let browserClosed = false;
  try { browserClosed = await closeOwnedBrowser(lease, adapters); }
  catch { browserClosed = false; }
  if (processExited && listenerReleased && browserClosed) return completeCleanup(file, { status: 'verified-stopped', processExited, listenerReleased, browserClosed });
  return completeCleanup(file, { status: 'failed', processExited, listenerReleased, browserClosed,
    reason: 'Process exit, listener release, or owned browser cleanup could not be verified' });
}

async function recoverLease(file, adapters = {}) {
  let lease = readLease(file);
  if (TERMINAL.has(lease.status)) return lease;
  if (lease.ownership === 'reused') {
    try {
      const browserClosed = await closeOwnedBrowser(lease, adapters);
      if (!browserClosed) throw new Error('Owned browser cleanup unavailable or unverified');
      return completeCleanup(file, { status: 'intentionally-retained', reason: 'Reused resource is owned by another session', browserClosed });
    } catch (error) {
      return completeCleanup(file, { status: 'failed', reason: `Owned browser cleanup failed: ${error.message}` });
    }
  }
  const matches = (adapters.processMatches || processMatches)(lease);
  const exited = () => !(adapters.isProcessRunning || (pid => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }))(lease.process.pid);
  if (!matches && !exited()) return completeCleanup(file, { status: 'failed', reason: 'Process identity mismatch; no signal sent' });
  lease = requestStop(file, { reason: 'Ownership-verified recovery' });
  try {
    const browserClosed = await closeOwnedBrowser(lease, adapters);
    if (!browserClosed) return completeCleanup(file, { status: 'failed', reason: 'Owned browser cleanup unavailable or unverified' });
    if (matches) await (adapters.stopOwnedProcess || (pid => process.kill(pid, 'SIGTERM')))(lease.process.pid);
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const processExited = exited();
      const listenerReleased = await (adapters.isListenerReleased || isListenerReleased)(lease.server.url);
      if (processExited && listenerReleased) return completeCleanup(file, { status: 'verified-stopped', processExited, listenerReleased, browserClosed });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return completeCleanup(file, { status: 'failed', reason: 'Process exit and listener release could not both be verified', processExited: exited(), listenerReleased: await (adapters.isListenerReleased || isListenerReleased)(lease.server.url), browserClosed });
  } catch (error) {
    return completeCleanup(file, { status: 'failed', reason: `Recovery failed: ${error.message}` });
  }
}

module.exports = { processStartIdentity, processMatches, readLease, createLease, requestStop, completeCleanup, verifyCleanup, recoverLease, isListenerReleased };
