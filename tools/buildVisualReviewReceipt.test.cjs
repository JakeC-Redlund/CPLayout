'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildReceipt } = require('./buildVisualReviewReceipt.cjs');
const { IMAGE_PATH_WHITELIST, validateAnswerPacket } = require('./visualReviewAnswers.cjs');

test('receipt derives every disposition, preserves source images and refuses overwrite', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cplayout-review-receipt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'annotated'), { recursive: true });
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  for (const relative of IMAGE_PATH_WHITELIST) fs.writeFileSync(path.join(source, relative), pixel);
  fs.writeFileSync(path.join(source, 'annotations.json'), JSON.stringify({ figures: [{ id: '01', notes: ['1A: Synthetic test observation'] }] }));
  const input = path.join(root, 'input.json');
  for (const choice of ['a', 'b', 'c', 'd', null]) {
    fs.writeFileSync(input, JSON.stringify({ packetId: 'receipt-test', source: 'human-chat', observedAt: '2026-09-27T15:42:24Z', answers: { Q10: { choice } } }));
    const destination = path.join(root, String(choice));
    buildReceipt(input, source, destination);
    const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'));
    assert.equal(manifest.responseStatus, 'imported-unattributed');
    assert.equal(manifest.authorshipVerified, false);
    assert.equal(manifest.decisionChoice, choice);
    if (choice === null) assert.equal(manifest.decisionLabel, 'No choice selected');
    if (choice === 'c') assert.equal(manifest.decisionLabel, 'Rework and present another packet');
    validateAnswerPacket(JSON.parse(fs.readFileSync(path.join(destination, 'answers.json'), 'utf8')));
    assert.match(fs.readFileSync(path.join(destination, 'questionnaire.md'), 'utf8'), /!\[Figure 1: annotated screenshot\]/);
    for (const relative of IMAGE_PATH_WHITELIST) {
      assert.deepEqual(fs.readFileSync(path.join(source, relative)), pixel);
      assert.deepEqual(fs.readFileSync(path.join(destination, relative)), pixel);
    }
    assert.throws(() => buildReceipt(input, source, destination), { code: 'EEXIST' });
  }
});

test('versioned browser export imports directly while altered catalogs fail closed', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cplayout-versioned-receipt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'annotated'), { recursive: true });
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  for (const relative of IMAGE_PATH_WHITELIST) fs.writeFileSync(path.join(source, relative), pixel);
  fs.writeFileSync(path.join(source, 'annotations.json'), JSON.stringify({ figures: [] }));
  const input = path.join(root, 'browser.json');
  const packet = require('./visualReviewAnswers.cjs').createAnswerPacket({ packetId: 'browser-test', source: 'browser', observedAt: '2026-09-27T15:42:24.000Z', answers: { Q09: { comment: 'literal' } } });
  fs.writeFileSync(input, JSON.stringify(packet));
  const alias = path.join(root, 'source-alias');
  fs.symlinkSync(source, alias, 'dir');
  assert.throws(() => buildReceipt(input, source, path.join(alias, 'escaped')), /outside source/);
  buildReceipt(input, source, path.join(root, 'receipt'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'receipt', 'answers.json'))).answers.Q09.comment, 'literal');
  const altered = structuredClone(packet);
  altered.questionCatalog[0].text = 'Changed';
  fs.writeFileSync(input, JSON.stringify(altered));
  assert.throws(() => buildReceipt(input, source, path.join(root, 'invalid')), /catalog/);
  assert.equal(fs.existsSync(path.join(root, 'invalid')), false);
});
