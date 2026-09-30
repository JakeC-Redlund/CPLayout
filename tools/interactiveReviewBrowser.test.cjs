'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { initialize, startServer } = require('./interactiveReviewServer.cjs');
const { readSession, renderMarkdown } = require('./interactiveReviewStore.cjs');
const { exportReview, verifyExport } = require('./reviewEvidenceIdentity.cjs');

test('local browser saves, exposes tab conflicts, supports keyboard clear and verifies export offline', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-browser-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'session');
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  fs.mkdirSync(path.join(root, 'annotated'));
  fs.writeFileSync(path.join(root, 'annotated/figure.png'), pixel);
  initialize(dir, { schemaVersion: 1, id: 'browser-proof', title: 'Synthetic browser review', context: 'Local test',
    questions: [{ id: 'V01', text: 'Choose?', choices: [{ value: 'yes', label: 'Yes' }],
      images: [{ path: 'annotated/figure.png', label: 'Synthetic figure' }], observations: ['Agent observation'] }] }, root, 'synthetic-build:browser-proof');
  const runtime = await startServer(dir, 0, 'synthetic-build:browser-proof');
  t.after(() => { if (runtime.server.listening) runtime.server.close(); });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(runtime.url + '/review'), second.goto(runtime.url + '/review')]);
  await first.locator('input[type=radio]').focus();
  await first.keyboard.press('Space');
  await first.locator('button:has-text("Clear choice")').focus();
  await first.keyboard.press('Enter');
  assert.equal(await first.locator('input[type=radio]').isChecked(), false);
  await first.locator('textarea').fill('Exact browser essay\nsecond line');
  await first.getByText('Saved answers received from the server').waitFor();
  assert.equal(readSession(dir).answers.V01.comment, 'Exact browser essay\nsecond line');
  assert.equal(await first.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  assert.equal(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await second.locator('textarea').fill('Competing tab essay');
  await second.getByText('Saving blocked', { exact: false }).waitFor();
  assert.equal(readSession(dir).answers.V01.comment, 'Exact browser essay\nsecond line');
  assert.equal(await second.locator('textarea').inputValue(), 'Competing tab essay');
  await browser.close();
  await new Promise(resolve => runtime.server.close(resolve));
  const exported = path.join(root, 'export');
  const state = readSession(dir);
  exportReview(dir, exported, state, renderMarkdown(state));
  assert.equal(verifyExport(exported).verified, true);
  assert.deepEqual(fs.readFileSync(path.join(exported, 'annotated/figure.png')), pixel);
});
