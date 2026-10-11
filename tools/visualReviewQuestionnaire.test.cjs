'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { chromium } = require('@playwright/test');
const helper = require('./visualReviewAnswers.cjs');
const { generateQuestionnaireHtml, renderPortableMarkdown } = require('./visualReviewQuestionnaire.cjs');

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const imageData = Object.fromEntries(helper.IMAGE_PATH_WHITELIST.map(path => [path, pixel]));
const packetId = 'questionnaire-test-01';
const packet = (answers = {}, id = packetId) => helper.createAnswerPacket({
  packetId: id, source: 'human-chat', observedAt: '2026-09-27T18:00:00.000Z', answers,
});
const generate = options => generateQuestionnaireHtml({ packetId, imageData, ...options });
const hostile = '</textarea><img src=x onerror="window.injected=true"><script>window.injected=true</script><!--\n```\n### Question 99\n````\n& \u2028 \u2029';

test('generator embeds the exact schema/catalog and every required figure beside its question', () => {
  const seedPacket = packet({ Q09: { comment: hostile }, Q10: { choice: 'c' } });
  const html = generate({ seedPacket });
  const embedded = JSON.parse(html.match(/id="questionnaire-data">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(helper.validateAnswerPacket(embedded.seedPacket), seedPacket);
  assert.equal(embedded.imageData['annotated/fig-01.png'], pixel);
  for (const [index, question] of helper.QUESTION_CATALOG.entries()) {
    const section = html.split(`<section id="${question.id}"`)[1].split('</section>')[0];
    assert.ok(section.includes(`Question ${index + 1}`));
    assert.ok(section.includes(`id="${question.id}-comment"`));
    assert.equal((section.match(/<img /g) || []).length, question.images.length);
    assert.equal((section.match(/type="radio"/g) || []).length, question.choices.length);
  }
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.ok(!html.includes(hostile));
  assert.match(html, /&lt;\/textarea&gt;&lt;img/);
  assert.match(html, /Q10 choice: Rework and present another packet/);
  assert.match(html, /Complete means responses only; it does not imply acceptance/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/);
  assert.equal(generateQuestionnaireHtml({ seedPacket, imageData }), html);
});

test('missing assets, remote or active images, unknown paths and accessor maps fail closed', () => {
  const path = helper.IMAGE_PATH_WHITELIST[0];
  for (const data of [undefined, {}, null, [], { ...imageData, [path]: undefined },
    { ...imageData, [path]: 'https://example.com/figure.png' },
    { ...imageData, [path]: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { ...imageData, [path]: 'data:image/png;base64,' },
    { ...imageData, [path]: 'data:image/png;base64,a' },
    { ...imageData, [path]: `${pixel}" onerror="alert(1)` },
    { ...imageData, '../secret.png': pixel }]) {
    assert.throws(() => generate({ imageData: data }), TypeError);
  }
  let accessed = false;
  const map = { ...imageData };
  Object.defineProperty(map, path, { get() { accessed = true; return pixel; } });
  assert.throws(() => generate({ imageData: map }), TypeError);
  assert.equal(accessed, false);
});

test('packet identity, version and catalog are validated and helper source can be supplied', () => {
  assert.throws(() => generate({ seedPacket: packet({}, 'different-packet') }), /packetId/);
  assert.throws(() => generate({ seedPacket: { ...packet(), schemaVersion: 999 } }), /schemaVersion/);
  assert.throws(() => generate({ seedPacket: { ...packet(), questionCatalog: [] } }), /catalog/);
  assert.throws(() => generate({ packetId: '<script>' }), /packetId/);
  assert.equal(generate({ helperSource: readFileSync(require.resolve('./visualReviewAnswers.cjs'), 'utf8') }), generate());
  for (const source of ['', '</script><script>alert(1)</script>', '<!--', null]) {
    assert.throws(() => generate({ helperSource: source }), /helperSource/);
  }
});

test('portable Markdown has stable headings, inline raster images and literal comments', () => {
  const markdown = renderPortableMarkdown(packet({ Q09: { comment: hostile }, Q10: { choice: 'b' } }), imageData);
  assert.equal((markdown.match(/^### Question (?:[1-9]|10)$/gm) || []).length, 10);
  for (const question of helper.QUESTION_CATALOG) assert.ok(markdown.includes(`Question ID: ${question.id}`));
  assert.equal((markdown.match(/!\[Figure /g) || []).length, 16);
  assert.equal((markdown.match(/\]\(data:image\/png;base64,/g) || []).length, 16);
  assert.doesNotMatch(markdown, /\]\(annotated\//);
  assert.ok(markdown.includes('`````text\n' + hostile + '\n`````'));
  assert.match(markdown, /Q10 choice: Accept after listed changes/);
  const essay = markdown.split('### Question 9\n')[1].split('### Question 10\n')[0];
  assert.match(essay, /Status: answered/);
  assert.match(essay, /Choice: \[not applicable\]/);
  assert.throws(() => renderPortableMarkdown(packet(), {}), /Required annotated image/);
});

test('annotation legends use validated question IDs and ordered literal callout strings', () => {
  const observations = { Q01: ['Toolbar callout one', hostile], Q02: 'Area controls' };
  const html = generate({ observations });
  const section = html.split('<section id="Q01"')[1].split('</section>')[0];
  assert.match(section, /Annotated callouts/);
  assert.match(section, /<ol><li>Toolbar callout one<\/li><li>&lt;\/textarea&gt;/);
  assert.match(section, /a\.\) Too big/);
  assert.match(section, /d\.\) None of the above/);
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  assert.ok(renderPortableMarkdown(packet(), imageData, observations).includes('1. Toolbar callout one\n2. ' + hostile));
  for (const invalid of [null, [], { Q11: 'Unknown' }, { Q01: [2] }, { Q01: [''] }, { Q01: new Array(1) }, { Q01: { text: 'bad' } }]) {
    assert.throws(() => generate({ observations: invalid }), TypeError);
  }
  let accessed = false;
  assert.throws(() => generate({ observations: { get Q01() { accessed = true; return 'bad'; } } }), TypeError);
  assert.equal(accessed, false);
});

test('browser restores, counts essays, guards storage and exports portable schema-compatible responses', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = 'http://questionnaire.test/';
  const key = `cplayout:visual-review:v${helper.SCHEMA_VERSION}:${packetId}`;
  let html = generate({ seedPacket: packet({ Q09: { comment: hostile }, Q10: { choice: 'c' } }) });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(url);
  assert.equal(await page.locator('#Q09-comment').inputValue(), hostile);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.match(await page.locator('#response-status').innerText(), /2 of 10 answered; responses partial/);
  assert.match(await page.locator('#decision-status').innerText(), /Rework and present another packet/);
  assert.match(await page.locator('#receipt-status').innerText(), /Recorded from supplied chat/);
  await page.locator('[data-clear-choice="Q10"]').click();
  assert.match(await page.locator('#decision-status').innerText(), /No choice selected/);
  await page.locator('#Q10-c').check();
  assert.equal(await page.locator('img').count(), 16);
  assert.ok(await page.locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));

  const restored = packet({ Q01: { choice: 'c' }, Q09: { comment: 'Essay alone counts' }, Q10: { choice: 'd' } });
  await page.evaluate(({ key, restored }) => localStorage.setItem(key, JSON.stringify(restored)), { key, restored });
  await page.reload();
  assert.equal(await page.locator('#Q09-comment').inputValue(), hostile, 'local data must not silently replace supplied responses');
  assert.match(await page.locator('#local-status').innerText(), /matching local saved copy is available/);
  assert.match(await page.locator('#provenance-status').innerText(), /human-chat/);
  await page.locator('#Q01-comment').fill('Unrelated edit must not overwrite newer local essay');
  assert.match(await page.locator('#local-status').innerText(), /Local copy preserved/);
  assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), key)), restored);
  await page.locator('#restore-local').click();
  assert.match(await page.locator('#response-status').innerText(), /3 of 10 answered; responses partial/);
  assert.equal(await page.locator('#Q09-status').innerText(), 'answered');
  assert.match(await page.locator('#decision-status').innerText(), /Not ready to decide/);
  assert.match(await page.locator('#local-status').innerText(), /Restored local/);
  assert.equal(await page.locator('#Q09-comment').inputValue(), 'Essay alone counts');

  for (const invalid of ['{bad json', JSON.stringify(packet({}, 'other-packet')), JSON.stringify({ ...packet(), schemaVersion: 2 })]) {
    await page.evaluate(({ key, invalid }) => localStorage.setItem(key, invalid), { key, invalid });
    await page.locator('#restore-local').click();
    assert.match(await page.locator('#local-status').innerText(), /restore failed/);
    assert.match(await page.locator('#response-status').innerText(), /3 of 10/);
    assert.equal(await page.locator('#Q09-comment').inputValue(), 'Essay alone counts');
  }

  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.locator('#restore-local').click();
  assert.match(await page.locator('#local-status').innerText(), /No local responses/);
  await page.locator('#Q09-comment').fill(hostile);
  const locallySaved = JSON.parse(await page.evaluate(key => localStorage.getItem(key), key));
  assert.equal(helper.validateAnswerPacket(locallySaved).answers.Q09.comment, hostile);
  assert.equal(locallySaved.source, 'browser');
  assert.match(await page.locator('#local-status').innerText(), /^Saved locally/);
  assert.match(await page.locator('#download-status').innerText(), /not been downloaded/);

  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    Storage.prototype.getItem = () => { throw new Error('denied'); };
  });
  await page.locator('#Q08-comment').fill('Still editable');
  assert.match(await page.locator('#local-status').innerText(), /Local save failed/);
  await page.locator('#restore-local').click();
  assert.match(await page.locator('#local-status').innerText(), /restore failed/);
  assert.equal(await page.locator('#Q08-comment').inputValue(), 'Still editable');

  async function download(id) {
    const pending = page.waitForEvent('download');
    await page.locator(id).click();
    const result = await pending;
    const stream = await result.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  }
  const json = helper.validateAnswerPacket(JSON.parse(await download('#download-json')));
  assert.equal(json.answers.Q09.comment, hostile);
  assert.deepEqual(json.questionCatalog, helper.QUESTION_CATALOG);
  assert.match(await page.locator('#download-status').innerText(), /JSON download requested; file delivery is not confirmed/);
  assert.match(await page.locator('#local-status').innerText(), /restore failed/);
  assert.match(await page.locator('#receipt-status').innerText(), /Browser responses have not been received/);
  const markdown = await download('#download-markdown');
  assert.equal(markdown, renderPortableMarkdown(json, imageData));
  html = await download('#download-html');
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
  await page.goto(`${url}answered`);
  assert.equal(await page.locator('#Q09-comment').inputValue(), hostile);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.match(await page.locator('#response-status').innerText(), /4 of 10 answered/);
  assert.match(await page.locator('#local-status').innerText(), /Embedded responses/);
  assert.deepEqual(helper.validateAnswerPacket(JSON.parse(await download('#download-json'))), json);

  await page.locator('#restore-local').click();
  for (const question of helper.QUESTION_CATALOG) await page.locator(`#${question.id}-comment`).fill('Response only');
  assert.match(await page.locator('#response-status').innerText(), /10 of 10 answered; responses complete/);
  assert.match(await page.locator('#decision-status').innerText(), /Not ready to decide/);
  assert.match(await page.locator('header').innerText(), /Complete means responses only; it does not imply acceptance/);
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok((await page.screenshot()).length > 1000);
  }
  html = generate();
  await page.goto(`${url}blank`);
  assert.match(await page.locator('#local-status').innerText(), /Automatically restored local responses/);
  await page.locator('#Q09-comment').fill('Automatic reload essay');
  await page.reload();
  assert.equal(await page.locator('#Q09-comment').inputValue(), 'Automatic reload essay');
  assert.match(await page.locator('#response-status').innerText(), /10 of 10 answered; responses complete/);
  assert.match(await page.locator('#local-status').innerText(), /Automatically restored local responses/);
  assert.match(await page.locator('#receipt-status').innerText(), /Browser responses have not been received/);
  html = generate({ packetId: 'different-blank-packet' });
  await page.goto(`${url}different`);
  assert.match(await page.locator('#response-status').innerText(), /0 of 10 answered; responses unanswered/);
  assert.equal(await page.locator('#Q09-comment').inputValue(), '');
  assert.deepEqual(errors, []);
});
