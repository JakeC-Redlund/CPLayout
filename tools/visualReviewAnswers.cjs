'use strict';

const SCHEMA_VERSION = 1;

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

const definitions = [
  ['The labeled drawing-tool buttons are:', ['Too big', 'Too small', 'Ideally sized', 'None of the above; explain']],
  ['Boundary, Keep out and Measurement area are:', ['The right choices with clear labels', 'The right choices, but labels need changing', 'Missing an important choice', 'None of the above; explain']],
  ['Path and Measurement under Line are:', ['Clear and sufficient', 'Clear, but I need more path types', 'Too similar to distinguish', 'None of the above; explain']],
  ['The Point choices match the points you need to map:', ['Yes, these cover my work', 'Partly; add or rename the choices below', 'No; I need a more general point/marker tool', 'None of the above; explain']],
  ['While drawing, the controls to remove a point, Keep, and cancel are:', ['Easy to locate and reach', 'Clear, but too far from the active drawing tool', 'Difficult to understand', 'None of the above; explain']],
  ['The remaining two-point outline and Boundary (2) status make the undo result:', ['Clear', 'Somewhat clear', 'Unclear', 'None of the above; explain']],
  ['From this screen, would you know another Save action is needed?', ['Yes; Unsaved changes makes that clear', 'Probably, but Keep sounds like Save', 'No; I would assume Keep saved it', 'None of the above; explain']],
  ['The difference between saved work and a design ready for layout is:', ['Clear from this screen', 'Mostly clear, but readiness should be more prominent', 'Unclear; Saved could be mistaken for ready', 'None of the above; explain']],
  ['Describe your preferred drawing workflow and the single most important change. Reference figure/callout numbers.', []],
  ['For this drawing-toolbar workflow:', ['Accept as shown', 'Accept after listed changes', 'Rework and present another packet', 'Not ready to decide (explain)']],
];

// Paths are relative to the packet's capture directory, matching the source packet.
const QUESTION_CATALOG = freeze(definitions.map(([text, labels], index) => {
  const suffix = String(index + 1).padStart(2, '0');
  return {
    id: `Q${suffix}`,
    text,
    choices: labels.map((label, choice) => ({ value: String.fromCharCode(97 + choice), label })),
    images: index < 8 ? [
      { label: `Figure ${index + 1}: annotated screenshot`, path: `annotated/fig-${suffix}.png` },
      { label: `Figure ${index + 1}: annotated detail`, path: `annotated/detail-${suffix}.png` },
    ] : [],
  };
}));
const IMAGE_PATH_WHITELIST = freeze(QUESTION_CATALOG.flatMap(question => question.images.map(image => image.path)));
const ids = QUESTION_CATALOG.map(question => question.id);

function fail(message) {
  throw new TypeError(message);
}

// Reject accessors and unexpected keys before reading values; never coerce input.
function record(value, allowed, required, location) {
  if (!value || typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(`${location} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) fail(`${location} has an unexpected key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${location}.${key} must be a data property`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${location}.${key} is required`);
  }
}

function normalizeAnswers(input) {
  record(input, ids, [], 'answers');
  const result = {};
  for (const question of QUESTION_CATALOG) {
    const answer = Object.hasOwn(input, question.id) ? input[question.id] : {};
    record(answer, ['choice', 'comment'], [], `answers.${question.id}`);
    let choice = Object.hasOwn(answer, 'choice') ? answer.choice : null;
    const comment = Object.hasOwn(answer, 'comment') ? answer.comment : '';
    if (choice !== null && typeof choice !== 'string') fail(`${question.id}.choice must be a string or null`);
    if (typeof choice === 'string' && !choice.trim()) choice = null;
    if (choice !== null && !question.choices.some(option => option.value === choice)) fail(`${question.id}.choice is unknown`);
    if (typeof comment !== 'string') fail(`${question.id}.comment must be a string`);
    result[question.id] = { choice, comment };
  }
  return freeze(result);
}

function getAnswerStatus(answer) {
  record(answer, ['choice', 'comment'], ['choice', 'comment'], 'answer');
  if (answer.choice !== null && typeof answer.choice !== 'string') fail('answer.choice must be a string or null');
  if (typeof answer.comment !== 'string') fail('answer.comment must be a string');
  return (answer.choice !== null && answer.choice.trim()) || answer.comment.trim() ? 'answered' : 'unanswered';
}

function summarizeAnswers(input) {
  const answers = normalizeAnswers(input);
  const answered = Object.values(answers).filter(answer => getAnswerStatus(answer) === 'answered').length;
  return freeze({ total: ids.length, answered, unanswered: ids.length - answered,
    status: answered === 0 ? 'unanswered' : answered === ids.length ? 'complete' : 'partial' });
}

function validateMetadata(input) {
  if (typeof input.packetId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.packetId)) fail('packetId is invalid');
  if (!['human-chat', 'browser'].includes(input.source)) fail('source must be human-chat or browser');
  // The caller supplies a verified observation time; this checks syntax/calendar only.
  if (typeof input.observedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.observedAt)) fail('observedAt must be an ISO UTC timestamp');
  const time = new Date(input.observedAt);
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== input.observedAt.replace(/(?<!\.\d{3})Z$/, '.000Z')) {
    fail('observedAt is not a valid calendar timestamp');
  }
}

function createAnswerPacket(input) {
  record(input, ['packetId', 'source', 'observedAt', 'answers'], ['packetId', 'source', 'observedAt', 'answers'], 'packet input');
  validateMetadata(input);
  return freeze({ schemaVersion: SCHEMA_VERSION, packetId: input.packetId,
    questionCatalog: QUESTION_CATALOG, source: input.source, observedAt: input.observedAt,
    answers: normalizeAnswers(input.answers) });
}

function sameCatalog(actual, expected, location = 'questionCatalog') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length ||
        Reflect.ownKeys(actual).length !== expected.length + 1) fail(`${location} differs from the question catalog`);
    expected.forEach((item, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(actual, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${location} must be a dense data array`);
      sameCatalog(descriptor.value, item, `${location}[${index}]`);
    });
  } else if (expected && typeof expected === 'object') {
    const keys = Object.keys(expected);
    record(actual, keys, keys, location);
    keys.forEach(key => sameCatalog(actual[key], expected[key], `${location}.${key}`));
  } else if (actual !== expected) {
    fail(`${location} differs from the question catalog`);
  }
}

// Imported JSON must retain the exact versioned catalog, including image allowlist.
function validateAnswerPacket(input) {
  const keys = ['schemaVersion', 'packetId', 'questionCatalog', 'source', 'observedAt', 'answers'];
  record(input, keys, keys, 'packet');
  if (input.schemaVersion !== SCHEMA_VERSION) fail('Unsupported schemaVersion');
  sameCatalog(input.questionCatalog, QUESTION_CATALOG);
  return createAnswerPacket({ packetId: input.packetId, source: input.source,
    observedAt: input.observedAt, answers: input.answers });
}

function literalComment(comment) {
  // A longer fence prevents even pasted fenced Markdown from escaping the block.
  const runs = comment.match(/`+/g) || [];
  const fence = '`'.repeat(runs.reduce((length, run) => Math.max(length, run.length + 1), 3));
  return `${fence}text\n${comment}\n${fence}`;
}

function renderAnsweredMarkdown(input) {
  const packet = validateAnswerPacket(input);
  const summary = summarizeAnswers(packet.answers);
  const lines = ['# CPLayout Drawing Review Answers', '', `Packet: ${packet.packetId}`,
    `Schema version: ${packet.schemaVersion}`, `Source: ${packet.source}`,
    `Observed at: ${packet.observedAt}`, `Answered: ${summary.answered} of ${summary.total}`, ''];
  packet.questionCatalog.forEach((question, index) => {
    const answer = packet.answers[question.id];
    const choice = question.choices.find(option => option.value === answer.choice);
    lines.push(`### Question ${index + 1}`, '', `Question ID: ${question.id}`, '', question.text, '');
    for (const image of question.images) lines.push(`![${image.label}](${image.path})`, '');
    lines.push(`Status: ${getAnswerStatus(answer)}`, '',
      `Choice: ${choice ? `${choice.value}.) ${choice.label}` : question.choices.length ? '[no choice selected]' : '[not applicable]'}`,
      '', 'Comment:', '', literalComment(answer.comment), '');
  });
  return lines.join('\n');
}

module.exports = Object.freeze({ SCHEMA_VERSION, QUESTION_CATALOG, IMAGE_PATH_WHITELIST,
  normalizeAnswers, getAnswerStatus, summarizeAnswers, createAnswerPacket,
  validateAnswerPacket, renderAnsweredMarkdown });
