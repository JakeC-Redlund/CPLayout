'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const { ReviewHostAdapter, attachStdio, loadSchemas, negotiateMcp, elicitationResult } = require('./reviewHostAdapter.cjs');
function request(id = 1) { return { id, method: 'item/tool/requestUserInput', params: { threadId: 'thread', turnId: 'turn', itemId: 'item', isBlocking: true, questions: [{ id: 'Q1', header: 'Review', question: 'Keep?', options: [{ label: 'Yes', description: 'Keep it' }] }] } }; }
function setup(snapshot = []) { const sent = [], saved = []; const adapter = new ReviewHostAdapter({ version: '0.157.1', send: m => sent.push(m), persist: s => saved.push(s), snapshot }); return { adapter, sent, saved }; }
function binding(adapter) { return adapter.bind('thread', 1, { sessionId: 'review', evidenceIdentity: 'a'.repeat(64) }); }
test('schema/version and malformed requests fail closed', () => {
  assert.throws(() => loadSchemas('0.0.0'), /regenerate/);
  const { adapter } = setup(); const m = request(); delete m.params.isBlocking;
  assert.throws(() => adapter.receive(m), /Missing/);
  m.params.isBlocking = true; m.params.questions[0].isSecret = true;
  assert.throws(() => adapter.receive(m), /Secret/);
});
test('submission binds evidence and identities, then waits for host resolution exactly once', () => {
  const { adapter, sent, saved } = setup(); adapter.receive(request()); const b = binding(adapter);
  assert.throws(() => adapter.submit({ ...b, evidenceIdentity: 'b'.repeat(64) }, {}, 'operator-submission-unverified'), /stale/);
  assert.throws(() => adapter.submit(b, {}, 'panel-decision'), /panel/);
  adapter.submit(b, { Q1: { answers: ['Yes', ' literal\ncomment '] } }, 'operator-submission-unverified');
  assert.equal(saved.at(-1)[0].status, 'submitted'); assert.equal(sent.length, 1);
  adapter.receive(request()); assert.throws(() => adapter.submit(b, {}, 'operator-submission-unverified'), /already/);
  adapter.receive({ method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 1 } });
  assert.equal(saved.at(-1)[0].status, 'resolved');
});
test('crash/reconnect preserves submitted requests and never duplicates ambiguous sends', () => {
  const { adapter, saved } = setup(); adapter.receive(request()); const b = binding(adapter);
  adapter.send = () => { throw new Error('lost pipe'); };
  assert.throws(() => adapter.submit(b, {}, 'operator-submission-unverified'), /lost pipe/);
  const next = setup(saved.at(-1)); next.adapter.receive(request());
  assert.throws(() => next.adapter.submit(b, {}, 'operator-submission-unverified'), /already/);
  assert.equal(next.sent.length, 0);
});
test('failed persistence does not send or strand the in-memory review', () => {
  const { adapter, sent } = setup(); adapter.receive(request()); const b = binding(adapter);
  adapter.persist = () => { throw new Error('disk failure'); };
  assert.throws(() => adapter.submit(b, {}, 'operator-submission-unverified'), /disk failure/);
  assert.equal(sent.length, 0);
  adapter.persist = () => {};
  adapter.submit(b, {}, 'operator-submission-unverified');
  assert.equal(sent.length, 1);
});
test('async persistence cannot bypass the durable-before-send barrier', () => {
  const { adapter, sent } = setup(); adapter.receive(request()); const b = binding(adapter);
  adapter.persist = async () => {};
  assert.throws(() => adapter.submit(b, {}, 'operator-submission-unverified'), /synchronous/);
  assert.equal(sent.length, 0);
});
test('disconnect, replay, cancellation and interruption remain distinct', () => {
  const { adapter, saved } = setup(); adapter.receive(request()); const b = binding(adapter); adapter.disconnect();
  assert.throws(() => adapter.submit(b, {}, 'operator-submission-unverified'), /disconnected/);
  const next = setup(saved.at(-1)); next.adapter.receive(request()); assert.equal(next.adapter.cancel(b).action, 'cancel');
  assert.equal(next.sent.length, 0);
  const other = setup(); other.adapter.receive(request());
  other.adapter.receive({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn', status: 'interrupted' } } });
  assert.equal(other.saved.at(-1)[0].status, 'interrupted');
});
test('stdio framing handles split frames and disconnects on invalid input', () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const adapter = attachStdio(child, { version: '0.157.1', persist: () => {} }); const errors = [];
  adapter.on('protocol-error', e => errors.push(e));
  const data = JSON.stringify(request()) + '\n'; child.stdout.write(data.slice(0, 20)); child.stdout.write(data.slice(20));
  assert.equal(adapter.requests.size, 1); child.stdout.write('{bad}\n'); assert.equal(errors.length, 1); assert.equal(adapter.connected, false);
});
test('MCP capability negotiation and outcomes preserve decline versus cancel', () => {
  assert.equal(negotiateMcp({}), 'readiness-gap');
  assert.equal(negotiateMcp({ elicitation: { form: {} } }), 'mcp-elicitation');
  assert.equal(negotiateMcp({ extensions: { 'io.modelcontextprotocol/ui': {} } }, { visual: true }), 'mcp-apps');
  assert.deepEqual(elicitationResult('decline'), { action: 'decline' });
  assert.deepEqual(elicitationResult('cancel'), { action: 'cancel' });
  assert.throws(() => elicitationResult('cancel', { Q1: 'Yes' }));
});
