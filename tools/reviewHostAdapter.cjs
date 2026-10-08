'use strict';

// Optional host-side transport. Never imported or served by browser code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { EventEmitter } = require('node:events');
const SCHEMA_ROOT = path.join(__dirname, 'review-host-schemas');
const MAX_BYTES = 1024 * 1024;

function checkSchema(value, schema, root = schema) {
  if (schema.$ref) {
    const target = schema.$ref.split('/').slice(1).reduce((v, k) => v?.[k], root);
    if (!target) throw new Error('Unsupported schema reference');
    return checkSchema(value, target, root);
  }
  if (schema.anyOf) {
    if (!schema.anyOf.some(s => { try { checkSchema(value, s, root); return true; } catch { return false; } })) throw new Error('Schema alternatives failed');
    return;
  }
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && ![].concat(schema.type).some(t => t === type || t === 'integer' && Number.isSafeInteger(value))) throw new Error('Schema type mismatch');
  if (schema.minimum !== undefined && value < schema.minimum) throw new Error('Schema minimum failed');
  if (type === 'array') for (const v of value) checkSchema(v, schema.items, root);
  if (type === 'object') {
    for (const k of schema.required || []) if (!Object.hasOwn(value, k)) throw new Error(`Missing schema field ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('Unsafe key');
      const s = schema.properties?.[k] || schema.additionalProperties;
      if (!s || s === false) throw new Error(`Unrecognized schema field ${k}`);
      if (s !== true) checkSchema(v, s, root);
    }
  }
}

function loadSchemas(version) {
  const source = JSON.parse(fs.readFileSync(path.join(SCHEMA_ROOT, 'source.json')));
  if (version !== source.codexVersion) throw new Error('Readiness gap: regenerate and review schemas for the installed Codex version');
  const schemas = {};
  for (const row of source.files) {
    const bytes = fs.readFileSync(path.join(SCHEMA_ROOT, row.file));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('Generated schema hash mismatch');
    schemas[row.file] = JSON.parse(bytes);
  }
  return schemas;
}

function key(threadId, requestId) { return JSON.stringify([threadId, requestId]); }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }

class ReviewHostAdapter extends EventEmitter {
  constructor({ version, send, persist, snapshot = [] }) {
    super();
    this.schemas = loadSchemas(version);
    if (typeof send !== 'function' || typeof persist !== 'function') throw new Error('Host transport and durable persistence callbacks required');
    this.send = send;
    this.persist = persist;
    this.connected = true;
    this.requests = new Map();
    this.durableSnapshot = [];
    // Retained journals contain answers and must remain in product-owned storage.
    for (const raw of snapshot) {
      const row = structuredClone(raw);
      checkSchema(row.params, this.schemas['ToolRequestUserInputParams.json']);
      if (!['pending', 'submitted', 'uncertain', 'resolved', 'interrupted', 'cancelled', 'disconnected'].includes(row.status)) throw new Error('Invalid retained request');
      const k = key(row.params.threadId, row.id);
      if (this.requests.has(k)) throw new Error('Duplicate retained request');
      if (row.status === 'pending') row.status = 'disconnected';
      this.requests.set(k, row);
    }
    this.durableSnapshot = structuredClone([...this.requests.values()]);
  }
  save() {
    const next = structuredClone([...this.requests.values()]);
    try {
      const result = this.persist(next);
      if (result && typeof result.then === 'function') {
        result.catch(() => {});
        throw new Error('Persistence callback must confirm a synchronous durable write');
      }
      this.durableSnapshot = structuredClone(next);
    } catch (error) {
      // No transport send follows a failed persistence barrier. Restore the last
      // acknowledged state; a journal that committed ambiguously stays conservative
      // on restart and requires explicit host reconciliation.
      this.requests = new Map(this.durableSnapshot.map(row => [key(row.params.threadId, row.id), structuredClone(row)]));
      throw error;
    }
  }
  receive(message) {
    if (!message || typeof message !== 'object' || Buffer.byteLength(JSON.stringify(message)) > MAX_BYTES) throw new Error('Invalid host message');
    if (message.method === 'item/tool/requestUserInput') {
      if (!(typeof message.id === 'string' && message.id.length > 0 || Number.isSafeInteger(message.id))) throw new Error('Request ID required');
      checkSchema(message.params, this.schemas['ToolRequestUserInputParams.json']);
      if (!nonempty(message.params.threadId) || !nonempty(message.params.turnId) || !message.params.questions.length || message.params.questions.length > 200) throw new Error('Bounded request identity required');
      if (message.params.questions.some(q => q.isSecret)) throw new Error('Secret questions are not supported by browser review');
      if (new Set(message.params.questions.map(q => q.id)).size !== message.params.questions.length) throw new Error('Duplicate question ID');
      const k = key(message.params.threadId, message.id), existing = this.requests.get(k);
      if (existing) {
        if (JSON.stringify(existing.params) !== JSON.stringify(message.params)) throw new Error('Replayed request changed');
        if (existing.status === 'disconnected') { existing.status = 'pending'; this.save(); }
        return structuredClone(existing);
      }
      const row = { id: message.id, params: structuredClone(message.params), status: 'pending', binding: null, authorship: 'not-established' };
      this.requests.set(k, row); this.save(); this.emit('review', structuredClone(row)); return structuredClone(row);
    }
    if (message.method === 'serverRequest/resolved') {
      checkSchema(message.params, this.schemas['ServerRequestResolvedNotification.json']);
      const row = this.requests.get(key(message.params.threadId, message.params.requestId));
      if (row) { row.status = 'resolved'; this.save(); }
    } else if (['turn/completed', 'turn/started'].includes(message.method)) {
      for (const row of this.requests.values()) if (row.params.threadId === message.params?.threadId &&
        (message.method === 'turn/started' || row.params.turnId === message.params?.turn?.id) && !['resolved', 'cancelled', 'interrupted'].includes(row.status)) row.status = 'interrupted';
      this.save();
    }
    return null;
  }
  bind(threadId, requestId, { sessionId, evidenceIdentity }) {
    const row = this.requests.get(key(threadId, requestId));
    if (!row || row.status !== 'pending' || !nonempty(sessionId) || !/^[a-f0-9]{64}$/.test(evidenceIdentity)) throw new Error('Pending request and verified review identity required');
    const binding = { sessionId, evidenceIdentity, threadId, turnId: row.params.turnId, requestId };
    if (row.binding && JSON.stringify(row.binding) !== JSON.stringify(binding)) throw new Error('Review binding is immutable');
    row.binding = binding; this.save(); return structuredClone(binding);
  }
  submit(binding, answers, provenance) {
    const row = this.requests.get(key(binding.threadId, binding.requestId));
    if (!this.connected || !row || row.status !== 'pending' || JSON.stringify(row.binding) !== JSON.stringify(binding)) throw new Error('Review is stale, disconnected or already submitted');
    if (provenance !== 'operator-submission-unverified') throw new Error('Agent observations and panel decisions cannot be submitted as operator answers');
    const result = { answers };
    checkSchema(result, this.schemas['ToolRequestUserInputResponse.json']);
    const ids = row.params.questions.map(q => q.id);
    if (Object.keys(answers).some(id => !ids.includes(id))) throw new Error('Unknown answer ID');
    if (Buffer.byteLength(JSON.stringify(result)) > MAX_BYTES) throw new Error('Answers too large');
    row.status = 'submitted'; row.authorship = 'operator-submission-unverified';
    // Persist before send. An ambiguous send is never automatically retried.
    this.save();
    try { this.send({ id: row.id, result }); }
    catch (error) { row.status = 'uncertain'; this.save(); throw error; }
  }
  cancel(binding) {
    const row = this.requests.get(key(binding.threadId, binding.requestId));
    if (!row || row.status !== 'pending' || JSON.stringify(row.binding) !== JSON.stringify(binding)) throw new Error('Review is not pending');
    row.status = 'cancelled'; this.save();
    // requestUserInput has no accept/decline/cancel wire action. Host owns turn interruption.
    return { action: 'cancel', hostResolution: 'awaiting-host-interruption-or-resolution' };
  }
  disconnect() {
    this.connected = false;
    for (const row of this.requests.values()) if (row.status === 'pending') row.status = 'disconnected';
    this.save();
  }
}

function attachStdio(child, options) {
  const adapter = new ReviewHostAdapter({ ...options, send: message => {
    if (child.stdin.destroyed || !child.stdin.writable) throw new Error('Host disconnected');
    child.stdin.write(JSON.stringify(message) + '\n');
  } });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    try {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_BYTES) throw new Error('Host frame too large');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        if (line.trim()) adapter.receive(JSON.parse(line));
      }
    } catch (error) { adapter.disconnect(); adapter.emit('protocol-error', error); }
  });
  child.once('exit', () => adapter.disconnect());
  child.once('error', () => adapter.disconnect());
  child.stdin.on('error', () => adapter.disconnect());
  return adapter;
}

function launchStdio({ persist, snapshot, cwd, executable = 'codex' }) {
  const version = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5000 }).trim().replace(/^codex-cli /, '');
  loadSchemas(version);
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  // No browser route receives this process, streams, credentials or initialization.
  const adapter = attachStdio(child, { version, persist, snapshot });
  let initialized = false;
  const receive = adapter.receive.bind(adapter);
  adapter.receive = message => {
    if (message.id === 'cplayout-initialize' && message.result && !initialized) {
      initialized = true; adapter.send({ method: 'initialized', params: {} }); adapter.emit('ready');
    }
    return receive(message);
  };
  child.stderr.resume(); // Do not retain host logs or block on a full stderr pipe.
  adapter.send({ id: 'cplayout-initialize', method: 'initialize', params: { clientInfo: { name: 'cplayout_review', title: 'CPLayout review', version: '1.0.0' } } });
  return { child, adapter };
}

function negotiateMcp(capabilities, { visual = false } = {}) {
  if (visual) return capabilities?.extensions?.['io.modelcontextprotocol/ui'] ? 'mcp-apps' : 'readiness-gap';
  return capabilities?.elicitation?.form ? 'mcp-elicitation' : 'readiness-gap';
}
function elicitationResult(action, content) {
  if (!['accept', 'decline', 'cancel'].includes(action)) throw new Error('Invalid elicitation action');
  if (action !== 'accept' && content !== undefined && content !== null) throw new Error('Only accept may carry content');
  return action === 'accept' ? { action, content } : { action };
}

module.exports = { ReviewHostAdapter, attachStdio, launchStdio, loadSchemas, checkSchema, negotiateMcp, elicitationResult };
