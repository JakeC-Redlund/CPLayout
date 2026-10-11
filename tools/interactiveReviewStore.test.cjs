'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSession, readSession, updateSession, renderMarkdown } = require('./interactiveReviewStore.cjs');

function packet() {
  return {
    schemaVersion: 1, id: 'review-1', title: 'Drawing review', context: '  Original context\r\nSecond line  ',
    questions: [
      { id: 'V01', text: 'What do you see?', choices: [{ value: 'keep', label: 'Keep it' }, { value: 'revise', label: 'Revise it' }],
        images: [{ path: 'annotated/first-view.png', label: 'First view' }], observations: [' Original observation '] },
      { id: 'Q02', text: 'Anything else?', choices: [], images: [], observations: [] },
    ],
  };
}

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function revisionFile(dir, revision) {
  return path.join(dir, `revision-${String(revision).padStart(12, '0')}.json`);
}

function expectCode(fn, code) {
  assert.throws(fn, failure => failure.code === code);
}

test('creates revision 1 with detached verbatim data, stable V01 and all answer slots', t => {
  const root = directory(t);
  const dir = path.join(root, 'new', 'session');
  const input = packet();
  const result = createSession(dir, input);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.packet, input);
  assert.deepEqual(result.answers, { V01: { choice: null, comment: '' }, Q02: { choice: null, comment: '' } });
  assert.deepEqual(result.messages, []);
  assert.equal(result.completedAt, null);
  assert.equal(new Date(result.updatedAt).toISOString(), result.updatedAt);
  input.title = 'Changed outside the store';
  result.answers.V01.comment = 'Changed returned object';
  assert.equal(readSession(dir).packet.title, 'Drawing review');
  assert.equal(readSession(dir).answers.V01.comment, '');
  assert.deepEqual(fs.readdirSync(dir), ['revision-000000000001.json']);
});

test('merges partial answers, preserves literal essays, and reopens across module instances', t => {
  const dir = directory(t);
  createSession(dir, packet());
  const firstBytes = fs.readFileSync(revisionFile(dir, 1));
  const essay = '  hello\r\n\t<script>x</script>\n```\n[link](bad)\n\u0000\ud800  ';
  updateSession(dir, { expectedRevision: 1, answers: { V01: { choice: 'keep', comment: essay }, Q02: { comment: 'Essay only' } } });
  const next = updateSession(dir, { expectedRevision: 2, answers: { V01: { choice: 'revise' } } });
  assert.equal(next.revision, 3);
  assert.deepEqual(next.answers.V01, { choice: 'revise', comment: essay });
  assert.deepEqual(next.answers.Q02, { choice: null, comment: 'Essay only' });
  assert.deepEqual(fs.readFileSync(revisionFile(dir, 1)), firstBytes);
  delete require.cache[require.resolve('./interactiveReviewStore.cjs')];
  assert.deepEqual(require('./interactiveReviewStore.cjs').readSession(dir), next);
  const cleared = updateSession(dir, { expectedRevision: 3, answers: { V01: { choice: null, comment: '' } } });
  assert.deepEqual(cleared.answers.V01, { choice: null, comment: '' });
});

test('agent messages append without overwriting answers and can accompany answer patches', t => {
  const dir = directory(t);
  createSession(dir, packet());
  const answered = updateSession(dir, { expectedRevision: 1, answers: { V01: { choice: 'keep', comment: 'Human essay' } } });
  const next = updateSession(dir, { expectedRevision: 2, message: '  Agent\r\nmessage  ' });
  assert.deepEqual(next.answers, answered.answers);
  assert.deepEqual(next.messages, [{ text: '  Agent\r\nmessage  ', at: next.updatedAt }]);
  const combined = updateSession(dir, { expectedRevision: 3, answers: { Q02: { comment: 'Second essay' } }, message: 'Follow-up' });
  assert.deepEqual(combined.messages.slice(0, 1), next.messages);
  assert.equal(combined.answers.V01.comment, 'Human essay');
});

test('stale updates and duplicate creation conflict without replacing committed bytes', t => {
  const dir = directory(t);
  createSession(dir, packet());
  updateSession(dir, { expectedRevision: 1, message: 'New revision' });
  const bytes = fs.readFileSync(revisionFile(dir, 2));
  expectCode(() => updateSession(dir, { expectedRevision: 1, answers: { V01: { comment: 'Lost update' } } }), 'CONFLICT');
  expectCode(() => createSession(dir, packet()), 'CONFLICT');
  assert.deepEqual(fs.readFileSync(revisionFile(dir, 2)), bytes);
  assert.equal(readSession(dir).revision, 2);
});

test('completion permits no answers, records no approval and forbids subsequent mutation', t => {
  const dir = directory(t);
  createSession(dir, packet());
  const completed = updateSession(dir, { expectedRevision: 1, complete: true, message: 'Finished responding' });
  assert.equal(completed.completedAt, completed.updatedAt);
  assert.deepEqual(completed.answers.V01, { choice: null, comment: '' });
  assert.match(renderMarkdown(completed), /not approval or acceptance/);
  for (const patch of [{}, { complete: false }, { message: 'Later' }, { answers: { V01: { choice: 'keep' } } }]) {
    expectCode(() => updateSession(dir, { expectedRevision: 2, ...patch }), 'COMPLETED');
  }
  expectCode(() => updateSession(dir, { expectedRevision: 1, complete: true }), 'CONFLICT');
  assert.deepEqual(readSession(dir), completed);
});

test('rejects invalid packets before writing anything', t => {
  const root = directory(t);
  const mutations = [
    p => { p.schemaVersion = 2; }, p => { p.extra = true; }, p => { p.title = ' '; },
    p => { p.context = null; }, p => { p.id = '../bad'; }, p => { p.questions = []; },
    p => { p.questions.push(structuredClone(p.questions[0])); },
    p => { p.questions[0].id = '__proto__'; }, p => { delete p.questions[0].observations; },
    p => { p.questions[0].choices.push({ value: 'keep', label: 'Duplicate' }); },
    p => { p.questions[0].choices[0].other = true; }, p => { p.questions[0].images[0].other = true; },
    p => { p.questions[0].observations = [null]; }, p => { p.questions[0].choices = new Array(2); },
    p => { p.questions[0].images.push(undefined); }, p => { p.context = 'x'.repeat(100001); },
    p => { p.questions = Array.from({ length: 201 }, (_, i) => ({ ...p.questions[0], id: `V${i}` })); },
    p => { p.questions[0].choices[0].value = ' '; },
  ];
  mutations.forEach((mutate, index) => {
    const input = packet();
    mutate(input);
    const dir = path.join(root, String(index));
    expectCode(() => createSession(dir, input), 'VALIDATION');
    assert.equal(fs.existsSync(dir), false);
  });
});

test('image allowlist rejects traversal, remote URLs, other formats and encoded paths', t => {
  const root = directory(t);
  for (const imagePath of ['annotated/../secret.png', 'annotated/sub/file.png', '/annotated/a.png', 'annotated\\a.png',
    'https://example.com/a.png', 'annotated/a.svg', 'annotated/a.PNG', 'annotated/a.png?x', 'annotated/%2e%2e.png',
    'annotated/a b.png', 'annotated/.hidden.png', 'annotated/a.png\n', 'annotated/a).png']) {
    const input = packet();
    input.questions[0].images[0].path = imagePath;
    expectCode(() => createSession(path.join(root, 'invalid'), input), 'VALIDATION');
  }
});

test('rejects unknown keys, getters, sparse arrays and invalid answer/update values', t => {
  const dir = directory(t);
  createSession(dir, packet());
  const updates = [
    { expectedRevision: '1' }, { expectedRevision: NaN }, { expectedRevision: 0 }, { expectedRevision: 1, extra: true },
    { expectedRevision: 1, complete: 'true' }, { expectedRevision: 1, message: { text: 'not a string' } },
    { expectedRevision: 1, message: ' ' }, { expectedRevision: 1, answers: { Unknown: {} } },
    { expectedRevision: 1, answers: { V01: { extra: true } } }, { expectedRevision: 1, answers: { V01: { choice: 'other' } } },
    { expectedRevision: 1, answers: { V01: { choice: '' } } }, { expectedRevision: 1, answers: { Q02: { choice: 'keep' } } },
    { expectedRevision: 1, answers: { V01: { comment: null } } }, { expectedRevision: 1, answers: null },
    { expectedRevision: 1, message: 'x'.repeat(100001) },
    { expectedRevision: 1, answers: { V01: { comment: 'x'.repeat(100001) } } },
    JSON.parse('{"expectedRevision":1,"answers":{"__proto__":{}}}'),
  ];
  for (const update of updates) expectCode(() => updateSession(dir, update), 'VALIDATION');
  let invoked = false;
  const getter = { expectedRevision: 1, get answers() { invoked = true; return {}; } };
  expectCode(() => updateSession(dir, getter), 'VALIDATION');
  const input = packet();
  Object.defineProperty(input.questions, '0', { enumerable: true, get() { invoked = true; return {}; } });
  expectCode(() => createSession(dir, input), 'VALIDATION');
  assert.equal(invoked, false);
  const symbolic = packet();
  symbolic[Symbol('hidden')] = true;
  expectCode(() => createSession(dir, symbolic), 'VALIDATION');
  assert.equal(readSession(dir).revision, 1);
});

test('bounds aggregate serialized size without modifying the current revision', t => {
  const dir = directory(t);
  const input = packet();
  input.questions = Array.from({ length: 100 }, (_, index) => ({ ...input.questions[1], id: `Q${index}` }));
  createSession(dir, input);
  const answers = Object.fromEntries(input.questions.map(question => [question.id, { comment: 'x'.repeat(100000) }]));
  expectCode(() => updateSession(dir, { expectedRevision: 1, answers }), 'VALIDATION');
  assert.equal(readSession(dir).revision, 1);
});

test('Markdown escapes metadata and image labels while retaining essays in longer literal fences', t => {
  const dir = directory(t);
  const input = packet();
  input.title = '<script>alert(1)</script>\n# title';
  input.questions[0].text = '[click](javascript:bad) **bold**';
  input.questions[0].images[0].label = 'x](https://bad)\n<script>';
  input.questions[0].choices[0].label = '<img src=x onerror=bad>';
  createSession(dir, input);
  const essay = '  literal essay\r\n``````\n<script>bad</script>\n~~~\n  ';
  const current = updateSession(dir, { expectedRevision: 1, answers: { V01: { choice: 'keep', comment: essay } }, message: '```\n# message' });
  const markdown = renderMarkdown(current);
  assert.ok(markdown.includes(`\`\`\`\`\`\`\`text\n${essay}\n\`\`\`\`\`\`\``));
  assert.ok(markdown.includes('(annotated/first-view.png)'));
  assert.ok(markdown.includes('![x\\]\\(https://bad\\)&#10;&lt;script&gt;]'));
  assert.ok(markdown.includes('&lt;script&gt;alert\\(1\\)&lt;/script&gt;&#10;\\# title'));
  assert.ok(markdown.includes('\\[click\\]\\(javascript:bad\\) \\*\\*bold\\*\\*'));
  assert.ok(markdown.includes('```text\n  Original context\r\nSecond line  \n```'));
  assert.ok(markdown.includes('````text\n```\n# message\n````'));
  assert.deepEqual(readSession(dir), current);
});

test('failed write or file fsync leaves prior revision usable and permits retry', t => {
  const dir = directory(t);
  const initial = createSession(dir, packet());
  for (const method of ['writeFileSync', 'fsyncSync']) {
    const mock = t.mock.method(fs, method, () => { throw Object.assign(new Error('injected disk failure'), { code: 'EIO' }); });
    expectCode(() => updateSession(dir, { expectedRevision: 1, message: 'Must not commit' }), 'EIO');
    mock.mock.restore();
    assert.deepEqual(readSession(dir), initial);
    assert.deepEqual(fs.readdirSync(dir), ['revision-000000000001.json']);
  }
  assert.equal(updateSession(dir, { expectedRevision: 1, message: 'Retry' }).revision, 2);
});

test('atomic link collisions return CONFLICT and never overwrite the winning revision', t => {
  const dir = directory(t);
  const initial = createSession(dir, packet());
  const winner = { ...initial, revision: 2, messages: [{ text: 'Other writer', at: initial.updatedAt }] };
  const realLink = fs.linkSync;
  const mock = t.mock.method(fs, 'linkSync', (from, to) => {
    fs.writeFileSync(to, JSON.stringify(winner), { flag: 'wx' });
    return realLink(from, to);
  });
  expectCode(() => updateSession(dir, { expectedRevision: 1, message: 'Losing writer' }), 'CONFLICT');
  mock.mock.restore();
  assert.deepEqual(readSession(dir), winner);
  assert.equal(fs.readdirSync(dir).length, 2);
});

test('file sync precedes atomic publication and directory sync precedes acknowledgment', t => {
  const dir = directory(t);
  createSession(dir, packet());
  const events = [];
  const realSync = fs.fsyncSync;
  const realLink = fs.linkSync;
  t.mock.method(fs, 'fsyncSync', fd => { events.push(fs.fstatSync(fd).isDirectory() ? 'directory-sync' : 'file-sync'); realSync(fd); });
  t.mock.method(fs, 'linkSync', (from, to) => { events.push('link'); return realLink(from, to); });
  updateSession(dir, { expectedRevision: 1, message: 'Durable' });
  assert.deepEqual(events, ['file-sync', 'link', 'directory-sync']);
});

test('directory fsync failure reports uncertain acknowledgment but retains committed history', t => {
  const dir = directory(t);
  createSession(dir, packet());
  const realSync = fs.fsyncSync;
  const mock = t.mock.method(fs, 'fsyncSync', fd => {
    if (fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error('directory sync failed'), { code: 'EIO' });
    realSync(fd);
  });
  assert.throws(() => updateSession(dir, { expectedRevision: 1, message: 'Published before failure' }), failure =>
    failure.code === 'EIO' && failure.committedRevision === 2);
  mock.mock.restore();
  assert.equal(readSession(dir).revision, 2);
  expectCode(() => updateSession(dir, { expectedRevision: 1, message: 'Duplicate retry' }), 'CONFLICT');
});

test('orphan temporary files are ignored and empty or missing sessions are distinct', t => {
  const dir = directory(t);
  expectCode(() => readSession(path.join(dir, 'missing')), 'NOT_FOUND');
  expectCode(() => readSession(dir), 'NOT_FOUND');
  fs.writeFileSync(path.join(dir, '.review-crashed.tmp'), '{unfinished');
  const initial = createSession(dir, packet());
  fs.writeFileSync(path.join(dir, '.review-second.tmp'), '{unfinished');
  assert.deepEqual(readSession(dir), initial);
});

test('corrupt history fails closed, including old revisions, gaps and malformed filenames', t => {
  const mutations = [
    dir => fs.writeFileSync(revisionFile(dir, 2), '{'),
    dir => fs.writeFileSync(revisionFile(dir, 1), '{'),
    dir => fs.unlinkSync(revisionFile(dir, 1)),
    dir => fs.renameSync(revisionFile(dir, 2), revisionFile(dir, 3)),
    dir => fs.writeFileSync(path.join(dir, 'revision-2.json'), '{}'),
    dir => fs.writeFileSync(revisionFile(dir, 2), Buffer.from([0xff, 0xfe])),
    dir => { fs.unlinkSync(revisionFile(dir, 2)); fs.symlinkSync(revisionFile(dir, 1), revisionFile(dir, 2)); },
    dir => { fs.unlinkSync(revisionFile(dir, 2)); fs.mkdirSync(revisionFile(dir, 2)); },
    dir => fs.writeFileSync(revisionFile(dir, 2), ' '.repeat(8 * 1024 * 1024 + 1)),
  ];
  for (const mutate of mutations) {
    const dir = directory(t);
    createSession(dir, packet());
    updateSession(dir, { expectedRevision: 1, message: 'Keep history' });
    mutate(dir);
    expectCode(() => readSession(dir), 'CORRUPT');
    expectCode(() => updateSession(dir, { expectedRevision: 2, message: 'No fallback' }), 'CORRUPT');
    expectCode(() => createSession(dir, packet()), 'CORRUPT');
  }
});

test('rejects schema corruption and impossible packet, message and completion transitions', t => {
  const mutations = [
    s => { s.extra = true; }, s => { s.schemaVersion = 2; }, s => { s.revision = 4; },
    s => { s.packet.questions[0].text = 'Mutated immutable packet'; },
    s => { s.messages[0].text = 'Changed history'; }, s => { s.messages = []; },
    s => { s.updatedAt = '2000-01-01T00:00:00.000Z'; }, s => { s.updatedAt = '2026-02-30T00:00:00.000Z'; },
    s => { s.completedAt = '2000-01-01T00:00:00.000Z'; },
    s => { delete s.answers.Q02; }, s => { s.answers.V01.choice = 'unknown'; },
  ];
  for (const mutate of mutations) {
    const dir = directory(t);
    createSession(dir, packet());
    updateSession(dir, { expectedRevision: 1, message: 'History' });
    const last = updateSession(dir, { expectedRevision: 2, answers: { Q02: { comment: 'Essay' } } });
    mutate(last);
    fs.writeFileSync(revisionFile(dir, 3), JSON.stringify(last));
    expectCode(() => readSession(dir), 'CORRUPT');
  }
  const dir = directory(t);
  createSession(dir, packet());
  const completed = updateSession(dir, { expectedRevision: 1, complete: true });
  fs.writeFileSync(revisionFile(dir, 3), JSON.stringify({ ...completed, revision: 3, completedAt: null }));
  expectCode(() => readSession(dir), 'CORRUPT');
});
