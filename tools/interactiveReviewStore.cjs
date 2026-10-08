'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

// The server owns the process lock. These synchronous operations never replace a
// committed file; revision JSON is authoritative and Markdown is only a projection.
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_REVISIONS = 10000;
const REVISION_NAME = /^revision-(\d{12})\.json$/;
const PACKET_KEYS = ['schemaVersion', 'id', 'title', 'context', 'questions'];
const STATE_KEYS = ['schemaVersion', 'packet', 'revision', 'answers', 'messages', 'completedAt', 'updatedAt'];

function error(code, message, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function invalid(message) {
  throw error('VALIDATION', message);
}

function record(value, allowed, required = allowed, label = 'input') {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    invalid(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      invalid(`${label} contains an unknown key or non-data property`);
    }
  }
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(`${label}.${key} is required`);
}

function array(value, limit, label) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) {
    invalid(`${label} must be a bounded dense array (maximum ${limit})`);
  }
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid(`${label} must contain data properties`);
  }
  return value;
}

function string(value, limit, label, nonempty = false) {
  if (typeof value !== 'string' || value.length > limit || (nonempty && !value.trim())) {
    invalid(`${label} must be ${nonempty ? 'nonempty ' : ''}text (maximum ${limit} characters)`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) invalid(`${label} must be an ISO UTC timestamp`);
  return value;
}

function boundedJson(value) {
  const json = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(json) > MAX_BYTES) invalid('Serialized state exceeds 8 MiB');
  return json;
}

function packet(input) {
  record(input, PACKET_KEYS, PACKET_KEYS, 'packet');
  if (input.schemaVersion !== 1) invalid('Unsupported packet schemaVersion');
  const id = string(input.id, 128, 'packet.id', true);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) invalid('Invalid packet.id');
  const ids = new Set();
  const result = {
    schemaVersion: 1, id,
    title: string(input.title, 1000, 'packet.title', true),
    context: string(input.context, 100000, 'packet.context'),
    questions: array(input.questions, 200, 'questions').map(question => {
      record(question, ['id', 'text', 'choices', 'images', 'observations']);
      const qid = string(question.id, 64, 'question.id', true);
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(qid) || ids.has(qid)) invalid('Question IDs must be unique stable identifiers');
      ids.add(qid);
      const values = new Set();
      return {
        id: qid, text: string(question.text, 20000, `${qid}.text`, true),
        choices: array(question.choices, 100, `${qid}.choices`).map(choice => {
          record(choice, ['value', 'label']);
          const value = string(choice.value, 128, 'choice.value', true);
          if (values.has(value)) invalid('Choice values must be unique within each question');
          values.add(value);
          return { value, label: string(choice.label, 2000, 'choice.label', true) };
        }),
        images: array(question.images, 50, `${qid}.images`).map(image => {
          record(image, ['path', 'label']);
          const imagePath = string(image.path, 160, 'image.path', true);
          if (!/^annotated\/[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(imagePath)) invalid('Images must be simple annotated/*.png paths');
          return { path: imagePath, label: string(image.label, 2000, 'image.label', true) };
        }),
        observations: array(question.observations, 100, `${qid}.observations`).map(item => string(item, 20000, 'observation')),
      };
    }),
  };
  if (!result.questions.length) invalid('At least one question is required');
  boundedJson(result);
  return result;
}

function answer(input, question, partial = false) {
  record(input, ['choice', 'comment'], partial ? [] : ['choice', 'comment'], `answers.${question.id}`);
  const result = {};
  if (Object.hasOwn(input, 'choice')) {
    if (input.choice !== null && !question.choices.some(choice => choice.value === input.choice)) invalid(`Unknown choice for ${question.id}`);
    result.choice = input.choice;
  }
  if (Object.hasOwn(input, 'comment')) result.comment = string(input.comment, 100000, `${question.id}.comment`);
  return result;
}

function state(input) {
  record(input, STATE_KEYS, STATE_KEYS, 'state');
  if (input.schemaVersion !== 1) invalid('Unsupported state schemaVersion');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > MAX_REVISIONS) invalid('Invalid revision');
  const definition = packet(input.packet);
  const ids = definition.questions.map(question => question.id);
  record(input.answers, ids, ids, 'answers');
  const updatedAt = timestamp(input.updatedAt, 'updatedAt');
  const completedAt = input.completedAt === null ? null : timestamp(input.completedAt, 'completedAt');
  if (completedAt !== null && completedAt !== updatedAt) invalid('Completion timestamp must match the final update');
  let lastTime = '';
  const messages = array(input.messages, 1000, 'messages').map(message => {
    record(message, ['text', 'at']);
    const at = timestamp(message.at, 'message.at');
    if (at < lastTime || at > updatedAt) invalid('Message timestamps are out of order');
    lastTime = at;
    return { text: string(message.text, 100000, 'message.text', true), at };
  });
  const result = {
    schemaVersion: 1, packet: definition, revision: input.revision,
    answers: Object.fromEntries(definition.questions.map(question => [question.id, answer(input.answers[question.id], question)])),
    messages, completedAt, updatedAt,
  };
  boundedJson(result);
  return result;
}

function revisionPath(dir, revision) {
  return path.join(dir, `revision-${String(revision).padStart(12, '0')}.json`);
}

function syncDirectory(dir) {
  const fd = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function checkDirectory(dir) {
  if (typeof dir !== 'string' || !dir || dir.includes('\0')) invalid('dir must be a directory path');
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw error('CORRUPT', 'Session path must be a real directory');
}

function readRevision(filename) {
  if (!fs.lstatSync(filename).isFile()) throw error('CORRUPT', 'Committed revision must be a regular file');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw error('CORRUPT', 'Invalid committed revision size or type');
    const data = fs.readFileSync(fd);
    if (data.length > MAX_BYTES) throw error('CORRUPT', 'Committed revision exceeds 8 MiB');
    return state(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)));
  } finally { fs.closeSync(fd); }
}

function readSession(dir) {
  let names;
  try {
    checkDirectory(dir);
    names = fs.readdirSync(dir).filter(name => name.startsWith('revision-'));
  } catch (cause) {
    if (cause.code === 'ENOENT') throw error('NOT_FOUND', 'Session does not exist', cause);
    throw cause;
  }
  if (!names.length) throw error('NOT_FOUND', 'Session has no committed revisions');
  if (names.length > MAX_REVISIONS || names.some(name => !REVISION_NAME.test(name))) throw error('CORRUPT', 'Invalid revision filenames');
  names.sort();
  let previous;
  for (let index = 0; index < names.length; index++) {
    const revision = index + 1;
    if (names[index] !== path.basename(revisionPath(dir, revision))) throw error('CORRUPT', 'Revision history is not contiguous');
    try {
      const current = readRevision(path.join(dir, names[index]));
      if (current.revision !== revision) throw new Error('Revision number does not match its filename');
      if (previous) {
        if (previous.completedAt !== null || !isDeepStrictEqual(previous.packet, current.packet) || current.updatedAt < previous.updatedAt) {
          throw new Error('Packet, completion or timestamp history changed');
        }
        if (current.messages.length < previous.messages.length || current.messages.length > previous.messages.length + 1 ||
            !isDeepStrictEqual(current.messages.slice(0, previous.messages.length), previous.messages) ||
            (current.messages.length > previous.messages.length && current.messages.at(-1).at !== current.updatedAt)) {
          throw new Error('Message history changed');
        }
      } else if (current.completedAt !== null || current.messages.length ||
          Object.values(current.answers).some(value => value.choice !== null || value.comment !== '')) {
        throw new Error('Initial revision must be unanswered and open');
      }
      previous = current;
    } catch (cause) {
      throw error('CORRUPT', `Invalid committed revision ${revision}`, cause);
    }
  }
  return previous;
}

function publish(dir, next) {
  const json = boundedJson(next);
  const temporary = path.join(dir, `.review-${randomUUID()}.tmp`);
  let fd;
  let published = false;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, json, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // Hard-link publication is atomic and refuses an existing destination. Do not
    // fall back to ordinary rename, which can overwrite a competing revision.
    try { fs.linkSync(temporary, revisionPath(dir, next.revision)); }
    catch (cause) {
      if (cause.code === 'EEXIST') throw error('CONFLICT', 'Revision was committed by another writer; reload the session', cause);
      throw cause;
    }
    published = true;
    fs.unlinkSync(temporary);
    syncDirectory(dir);
  } catch (cause) {
    // A post-link failure is an uncertain acknowledgment, never permission to
    // delete a committed revision. The caller must reopen before retrying.
    if (published) cause.committedRevision = next.revision;
    throw cause;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch { /* Orphan temp files are not commits. */ }
  }
  return next;
}

function createSession(dir, input) {
  const definition = packet(input);
  if (typeof dir !== 'string' || !dir || dir.includes('\0')) invalid('dir must be a directory path');
  const firstCreated = fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  checkDirectory(dir);
  if (firstCreated) {
    const stop = path.dirname(path.resolve(firstCreated));
    for (let current = path.resolve(dir); ; current = path.dirname(current)) {
      syncDirectory(current);
      if (current === stop) break;
    }
  }
  try {
    readSession(dir);
    throw error('CONFLICT', 'A session already exists');
  } catch (cause) { if (cause.code !== 'NOT_FOUND') throw cause; }
  return publish(dir, {
    schemaVersion: 1, packet: definition, revision: 1,
    answers: Object.fromEntries(definition.questions.map(question => [question.id, { choice: null, comment: '' }])),
    messages: [], completedAt: null, updatedAt: new Date().toISOString(),
  });
}

function updateSession(dir, input) {
  record(input, ['expectedRevision', 'answers', 'message', 'complete'], ['expectedRevision'], 'update');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) invalid('expectedRevision must be a positive integer');
  const current = readSession(dir);
  if (current.revision !== input.expectedRevision) throw error('CONFLICT', 'Revision changed; reload the session');
  if (current.completedAt !== null) throw error('COMPLETED', 'Completed sessions are immutable');
  if (Object.hasOwn(input, 'complete') && typeof input.complete !== 'boolean') invalid('complete must be boolean');
  if (Object.hasOwn(input, 'answers')) {
    record(input.answers, current.packet.questions.map(question => question.id), [], 'answers');
    for (const question of current.packet.questions) {
      if (Object.hasOwn(input.answers, question.id)) {
        current.answers[question.id] = { ...current.answers[question.id], ...answer(input.answers[question.id], question, true) };
      }
    }
  }
  // Wall-clock corrections must not make persisted timestamps move backwards.
  current.updatedAt = new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString();
  if (Object.hasOwn(input, 'message')) current.messages.push({ text: string(input.message, 100000, 'message', true), at: current.updatedAt });
  if (input.complete === true) current.completedAt = current.updatedAt;
  current.revision += 1;
  return publish(dir, state(current));
}

function inline(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~\-]/g, '\\$&').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');
}

function literal(text) {
  const fence = '`'.repeat((text.match(/`+/g) || []).reduce((longest, run) => Math.max(longest, run.length + 1), 3));
  return `${fence}text\n${text}\n${fence}`;
}

function renderMarkdown(input) {
  const current = state(input);
  const lines = [`# ${inline(current.packet.title)}`, '', `Packet: ${inline(current.packet.id)}`,
    `Revision: ${current.revision}`, `Updated: ${current.updatedAt}`,
    `Status: ${current.completedAt === null ? 'Open' : 'Completed'}`,
    'Completion records responses only; it is not approval or acceptance.', '', '## Context', '', literal(current.packet.context), ''];
  for (const question of current.packet.questions) {
    const response = current.answers[question.id];
    lines.push(`## ${inline(question.id)}`, '', inline(question.text), '');
    for (const image of question.images) lines.push(`![${inline(image.label)}](${image.path})`, '');
    for (const observation of question.observations) lines.push(literal(observation), '');
    for (const choice of question.choices) lines.push(`- ${inline(choice.value)}: ${inline(choice.label)}`);
    const selected = question.choices.find(choice => choice.value === response.choice);
    lines.push('', `Choice: ${selected ? `${inline(selected.value)}: ${inline(selected.label)}` : '[unanswered]'}`,
      '', 'Comment:', '', literal(response.comment), '');
  }
  lines.push('## Messages', '');
  for (const message of current.messages) lines.push(message.at, '', literal(message.text), '');
  return lines.join('\n');
}

module.exports = Object.freeze({ createSession, readSession, updateSession, renderMarkdown, validateStoredState: state });
