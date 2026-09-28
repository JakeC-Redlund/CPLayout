'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const HEX = /^[a-f0-9]{64}$/;
const IMAGE = /^annotated\/[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;
const imageNames = packet => [...new Set(packet.questions.flatMap(question => question.images.map(image => image.path)))].sort();

function newOutputDirectory(source, destination) {
  const requested = path.resolve(destination);
  const parent = fs.realpathSync(path.dirname(requested));
  const output = path.join(parent, path.basename(requested));
  const origin = fs.realpathSync(source);
  if (output === origin || output.startsWith(origin + path.sep) || origin.startsWith(output + path.sep)) {
    throw new Error('Output destination must be outside source evidence');
  }
  return output;
}

function regularExportFile(root, relative) {
  const allowed = relative === 'manifest.json' || relative === 'answers.json' || relative === 'receipt.md' || IMAGE.test(relative);
  if (!allowed) throw new Error('Invalid export path');
  let current = fs.realpathSync(root);
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Export symlink refused: ${relative}`);
  }
  if (!fs.lstatSync(current).isFile()) throw new Error(`Export artifact is not a regular file: ${relative}`);
  return current;
}

function safeFile(root, relative) {
  if (!IMAGE.test(relative)) throw new Error('Invalid figure path');
  const file = fs.realpathSync(path.join(root, relative));
  if (!file.startsWith(fs.realpathSync(root) + path.sep)) throw new Error('Figure escaped review directory');
  return file;
}

function createIdentity(packet, root, reviewedFingerprint) {
  if (typeof reviewedFingerprint !== 'string' || !reviewedFingerprint.trim() || reviewedFingerprint.length > 512) {
    throw new Error('A reviewed build or capture fingerprint is required');
  }
  const figures = {};
  for (const name of imageNames(packet)) figures[name] = sha256(fs.readFileSync(safeFile(root, name)));
  return Object.freeze({ schemaVersion: 1, questionCatalogSha256: sha256(Buffer.from(JSON.stringify(packet.questions))),
    figureSha256: figures, reviewedFingerprint });
}

function verifyIdentity(identity, packet, root, expectedFingerprint) {
  if (!identity || identity.schemaVersion !== 1 || !HEX.test(identity.questionCatalogSha256) ||
      !identity.figureSha256 || typeof identity.figureSha256 !== 'object' ||
      typeof identity.reviewedFingerprint !== 'string' || !identity.reviewedFingerprint.trim()) {
    throw new Error('Invalid review evidence identity');
  }
  const actual = createIdentity(packet, root, identity.reviewedFingerprint);
  if (JSON.stringify(actual) !== JSON.stringify(identity)) throw new Error('Review evidence identity mismatch');
  if (expectedFingerprint !== undefined && expectedFingerprint !== identity.reviewedFingerprint) {
    throw new Error('Current reviewed build or capture fingerprint mismatch');
  }
  return actual;
}

function exportReview(dir, destination, session, markdown) {
  const store = require('./interactiveReviewStore.cjs');
  const validated = store.validateStoredState(session);
  if (markdown !== store.renderMarkdown(validated)) throw new Error('Receipt does not match answers');
  const identity = JSON.parse(fs.readFileSync(path.join(dir, 'evidence-identity.json'), 'utf8'));
  verifyIdentity(identity, validated.packet, dir);
  const source = fs.realpathSync(dir);
  const output = newOutputDirectory(source, destination);
  fs.mkdirSync(output);
  const files = { 'answers.json': Buffer.from(JSON.stringify({ ...validated,
    responseAttribution: 'local-browser-session-unverified-human-authorship' }, null, 2) + '\n'),
    'receipt.md': Buffer.from(markdown) };
  for (const name of imageNames(validated.packet)) files[name] = fs.readFileSync(safeFile(source, name));
  const hashes = {};
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true });
    fs.writeFileSync(path.join(output, name), bytes, { flag: 'wx' });
    hashes[name] = sha256(bytes);
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1,
    evidenceIdentity: identity, fileSha256: hashes, createdAt: new Date().toISOString(),
    verification: 'artifact-bytes-and-catalog-only', authorshipVerified: false }, null, 2) + '\n', { flag: 'wx' });
  return verifyExport(output);
}

function verifyExport(dir) {
  const manifest = JSON.parse(fs.readFileSync(regularExportFile(dir, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !manifest.fileSha256 || manifest.verification !== 'artifact-bytes-and-catalog-only') {
    throw new Error('Invalid export manifest');
  }
  const names = Object.keys(manifest.fileSha256);
  if (!names.includes('answers.json') || !names.includes('receipt.md') ||
      names.some(name => !['answers.json', 'receipt.md'].includes(name) && !IMAGE.test(name))) throw new Error('Invalid export files');
  const actual = [];
  const visit = (relative = '') => {
    for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Export symlink refused: ${name}`);
      if (entry.isDirectory()) {
        if (name !== 'annotated') throw new Error(`Unexpected export directory: ${name}`);
        visit(name);
      } else if (entry.isFile()) actual.push(name);
      else throw new Error(`Unexpected export artifact type: ${name}`);
    }
  };
  visit();
  const expectedNames = ['manifest.json', ...names].sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expectedNames)) throw new Error('Unexpected or missing export artifact');
  for (const name of names) {
    const expected = manifest.fileSha256[name];
    if (!HEX.test(expected) || sha256(fs.readFileSync(regularExportFile(dir, name))) !== expected) throw new Error(`Export byte mismatch: ${name}`);
  }
  const answers = JSON.parse(fs.readFileSync(regularExportFile(dir, 'answers.json'), 'utf8'));
  const { responseAttribution, ...stored } = answers;
  if (responseAttribution !== 'local-browser-session-unverified-human-authorship') throw new Error('Invalid response attribution');
  const store = require('./interactiveReviewStore.cjs');
  const validated = store.validateStoredState(stored);
  if (fs.readFileSync(regularExportFile(dir, 'receipt.md'), 'utf8') !== store.renderMarkdown(validated)) {
    throw new Error('Receipt does not match answers');
  }
  const figureNames = imageNames(answers.packet);
  if (figureNames.length !== names.length - 2 || figureNames.some(name => !names.includes(name))) throw new Error('Export figure list mismatch');
  verifyIdentity(manifest.evidenceIdentity, answers.packet, dir);
  return { verified: true, revision: answers.revision, evidenceIdentity: manifest.evidenceIdentity,
    evidenceClass: 'independently-verified-artifact-bytes', authorshipVerified: false };
}

module.exports = Object.freeze({ sha256, createIdentity, verifyIdentity, exportReview, verifyExport, newOutputDirectory });
