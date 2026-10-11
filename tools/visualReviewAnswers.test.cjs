'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SCHEMA_VERSION, QUESTION_CATALOG, IMAGE_PATH_WHITELIST, normalizeAnswers,
  getAnswerStatus, summarizeAnswers, createAnswerPacket, validateAnswerPacket,
  renderAnsweredMarkdown } = require('./visualReviewAnswers.cjs');

const metadata = { packetId: '20260927-drawing-edge-01', source: 'human-chat', observedAt: '2026-09-27T18:00:00.000Z' };
const packet = (answers = {}, overrides = {}) => createAnswerPacket({ ...metadata, answers, ...overrides });

test('Q9 essay is answered without a choice and has no invented screenshot', () => {
  const result = packet({ Q09: { comment: 'Keep drawing controls together.' } });
  assert.deepEqual(result.answers.Q09, { choice: null, comment: 'Keep drawing controls together.' });
  assert.equal(getAnswerStatus(result.answers.Q09), 'answered');
  const markdown = renderAnsweredMarkdown(result);
  const section = markdown.split('### Question 9\n')[1].split('### Question 10\n')[0];
  assert.match(section, /Status: answered/);
  assert.match(section, /Choice: \[not applicable\]/);
  assert.ok(section.includes(QUESTION_CATALOG[8].text));
  assert.doesNotMatch(section, /\[unanswered\]|fig-09|detail-09|annotated\//);
});

test('multiline numbered answers, whitespace, Unicode and fences remain literal and verbatim', () => {
  const comment = '  1. First\r\n2. Second\r\n\r\n1. Restart\n```\n### Question 99\n<script>alert(1)</script>\n````\nCaf\u00e9\t  ';
  const result = packet({ Q01: { choice: 'c', comment } });
  assert.equal(result.answers.Q01.comment, comment);
  const markdown = renderAnsweredMarkdown(result);
  assert.ok(markdown.includes(`\n\n\`\`\`\`\`text\n${comment}\n\`\`\`\`\`\n`));
  assert.match(markdown, /Choice: c\.\) Ideally sized/);
  assert.ok(!markdown.includes('## Human Responses'));
});

test('partial, restored, empty and completed answers share status logic', () => {
  const partial = normalizeAnswers({ Q01: { choice: 'a' }, Q09: { comment: 'Essay' }, Q10: { choice: ' ', comment: '\n\t ' } });
  assert.deepEqual(Object.keys(partial), QUESTION_CATALOG.map(question => question.id));
  assert.deepEqual(partial.Q02, { choice: null, comment: '' });
  assert.deepEqual(summarizeAnswers(JSON.parse(JSON.stringify(partial))), { total: 10, answered: 2, unanswered: 8, status: 'partial' });
  assert.equal(getAnswerStatus(partial.Q10), 'unanswered');
  assert.equal(summarizeAnswers({}).status, 'unanswered');
  assert.equal(summarizeAnswers(Object.fromEntries(QUESTION_CATALOG.map(q => [q.id, { comment: 'OK' }]))).status, 'complete');
  const markdown = renderAnsweredMarkdown(packet(partial));
  assert.equal((markdown.match(/^### Question \d+$/gm) || []).length, 10);
  assert.match(markdown, /Answered: 2 of 10/);
});

test('invalid types, choices, unknown IDs and extra fields fail without coercion or truncation', () => {
  const invalid = [null, [], '', 4, true, new Date(), { Q11: {} }, { q1: {} }, { Q1: {} },
    { Q01: null }, { Q01: [] }, { Q01: { choice: undefined } }, { Q01: { choice: 1 } },
    { Q01: { choice: {} } }, { Q01: { choice: 'e' } }, { Q01: { choice: 'a extra' } },
    { Q09: { choice: 'a' } }, { Q01: { comment: false } }, { Q01: { comment: null } },
    { Q01: { comment: ['text'] } }, { Q01: { comment: undefined } }, { Q01: { status: 'answered' } },
    JSON.parse('{"__proto__":{}}'), { [Symbol('extra')]: true }];
  for (const input of invalid) assert.throws(() => normalizeAnswers(input), TypeError);
  let accessed = false;
  const input = { get Q01() { accessed = true; return {}; } };
  assert.throws(() => normalizeAnswers(input), TypeError);
  assert.equal(accessed, false);
  const long = '1. A long response\n'.repeat(10000);
  assert.equal(normalizeAnswers({ Q09: { comment: long } }).Q09.comment, long);
});

test('JSON roundtrip retains schema, catalog, provenance and all literal answers', () => {
  for (const source of ['human-chat', 'browser']) {
    const original = packet({ Q02: { choice: 'b', comment: '  Keep this.\n' }, Q09: { comment: '1. One\n1. Two' } }, { source });
    const restored = validateAnswerPacket(JSON.parse(JSON.stringify(original)));
    assert.deepEqual(restored, original);
    assert.equal(restored.schemaVersion, SCHEMA_VERSION);
    assert.equal(renderAnsweredMarkdown(restored), renderAnsweredMarkdown(original));
  }
});

test('input objects are not mutated or frozen; output and stable catalog are deeply frozen', () => {
  const answers = { Q01: { choice: '', comment: ' verbatim ' } };
  const input = { ...metadata, answers };
  const before = JSON.stringify(input);
  const result = createAnswerPacket(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(answers.Q01), false);
  for (const value of [result, result.answers, result.answers.Q01, QUESTION_CATALOG,
    QUESTION_CATALOG[0], QUESTION_CATALOG[0].choices[0], QUESTION_CATALOG[0].images[0], IMAGE_PATH_WHITELIST]) {
    assert.ok(Object.isFrozen(value));
  }
  answers.Q01.comment = 'Changed upstream';
  assert.equal(result.answers.Q01.comment, ' verbatim ');
  assert.throws(() => { result.answers.Q01.comment = 'Changed downstream'; }, TypeError);
  const imported = JSON.parse(JSON.stringify(result));
  validateAnswerPacket(imported);
  assert.equal(Object.isFrozen(imported.questionCatalog), false);
});

test('packet metadata requires explicit provenance and valid supplied UTC calendar timestamp', () => {
  for (const overrides of [{ packetId: '../bad' }, { packetId: 'bad\nheading' }, { packetId: 1 },
    { source: 'agent' }, { source: null }, { observedAt: undefined }, { observedAt: 0 },
    { observedAt: '2026-02-30T18:00:00.000Z' }, { observedAt: '2026-09-27' },
    { observedAt: '2026-09-27T25:00:00.000Z' }, { observedAt: '2026-09-27T18:00:00+00:00' }]) {
    assert.throws(() => packet({}, overrides), TypeError);
  }
  assert.equal(packet({}, { observedAt: '2026-09-27T18:00:00Z' }).observedAt, '2026-09-27T18:00:00Z');
  assert.throws(() => createAnswerPacket({ ...metadata, answers: {}, extra: true }), TypeError);
  const imported = JSON.parse(JSON.stringify(packet()));
  for (const overrides of [{ schemaVersion: 2 }, { schemaVersion: '1' }, { extra: true }, { questionCatalog: [] }]) {
    assert.throws(() => validateAnswerPacket({ ...imported, ...overrides }), TypeError);
  }
  for (const key of Object.keys(imported)) {
    const incomplete = { ...imported };
    delete incomplete[key];
    assert.throws(() => validateAnswerPacket(incomplete), TypeError);
  }
});

test('image metadata is a fixed relative whitelist attached to the relevant question', () => {
  const markdown = renderAnsweredMarkdown(packet());
  assert.equal(IMAGE_PATH_WHITELIST.length, 16);
  for (const [index, question] of QUESTION_CATALOG.entries()) {
    const section = markdown.split(`### Question ${index + 1}\n`)[1].split(/^### Question /m)[0];
    for (const image of question.images) {
      assert.match(image.path, /^annotated\/(?:fig|detail)-0[1-8]\.png$/);
      assert.ok(section.includes(`![${image.label}](${image.path})`));
    }
  }
  for (const unsafe of ['../secret.png', 'annotated/../secret.png', '/absolute.png',
    'https://example.com/image.png', 'javascript:alert(1)', 'annotated/%2e%2e/secret.png',
    'annotated\\fig-01.png', 'annotated/fig-09.png', 'annotated/fig-01.png)\nInjected']) {
    const imported = JSON.parse(JSON.stringify(packet()));
    imported.questionCatalog[0].images[0].path = unsafe;
    assert.throws(() => renderAnsweredMarkdown(imported), TypeError);
  }
  const wrongQuestion = JSON.parse(JSON.stringify(packet()));
  wrongQuestion.questionCatalog[8].images.push(QUESTION_CATALOG[0].images[0]);
  assert.throws(() => validateAnswerPacket(wrongQuestion), TypeError);
  const changedText = JSON.parse(JSON.stringify(packet()));
  changedText.questionCatalog[0].text = 'Different question';
  assert.throws(() => validateAnswerPacket(changedText), TypeError);
});

test('synthetic complete answers preserve essay-only input and explicit rework', () => {
  const answers = Object.fromEntries(QUESTION_CATALOG.map(question => [question.id, { comment: 'Synthetic review comment' }]));
  answers.Q10 = { choice: 'c', comment: 'Synthetic rework request' };
  answers.Q09 = { comment: 'Synthetic example: recall and resume a draft' };
  answers.Q06 = { comment: 'Synthetic reference to an earlier answer' };
  const receipt = packet(answers, { packetId: 'synthetic-rework-fixture', source: 'browser' });
  assert.equal(summarizeAnswers(receipt.answers).answered, 10);
  assert.equal(receipt.answers.Q10.choice, 'c');
  assert.equal(receipt.answers.Q09.choice, null);
  assert.match(receipt.answers.Q09.comment, /recall and resume/);
  assert.equal(receipt.answers.Q06.comment, answers.Q06.comment);
});
