'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');

async function main() {
  if (process.platform !== 'win32') throw new Error('This proof requires visible Windows Edge.');
  const [url, output] = process.argv.slice(2);
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('Expected loopback review URL');
  fs.mkdirSync(output, { recursive: false });
  const initial = await fetch(url + '/api/state').then(r => r.json());
  if (!initial.packet.id.startsWith('synthetic-') || initial.completedAt) throw new Error('Use a fresh synthetic QA session, never human answers.');
  const evidence = { startedAt: new Date().toISOString(), status: 'running', synthetic: true, url, checks: [] };
  const context = await chromium.launchPersistentContext(path.join(process.env.LOCALAPPDATA, 'CPLayout', `interactive-qa-${Date.now()}`), {
    channel: 'msedge', headless: false, viewport: { width: 1366, height: 900 },
  });
  try {
    const hub = context.pages()[0];
    await hub.goto(url);
    await hub.bringToFront();
    await expect(hub.locator('#open-review')).toBeEnabled();
    const unrelated = await context.newPage();
    await unrelated.goto('about:blank');
    const popup = hub.waitForEvent('popup');
    await hub.locator('#open-review').click();
    const page = await popup;
    await expect(page.locator('#comment-0')).toBeVisible();
    await expect(page.locator('#messages')).toContainText('AUTOMATED QA: live update');
    await page.bringToFront();
    const cdp = await context.newCDPSession(page);
    evidence.browser = await cdp.send('Browser.getVersion');
    evidence.window = await cdp.send('Browser.getWindowForTarget');
    evidence.visibility = await page.evaluate(() => document.visibilityState);
    if (evidence.visibility !== 'visible' || evidence.window.bounds.windowState === 'minimized') throw new Error('Edge is not visible');
    await page.locator('img').evaluateAll(images => Promise.all(images.map(image => { image.loading = 'eager'; return image.decode(); })));
    evidence.imageCount = await page.locator('img').count();
    if (evidence.imageCount !== 4) throw new Error('Missing annotated figures');
    const essay = 'AUTOMATED QA ONLY\n1. Preserve numbering\n1. Restarted numbering <script>literal</script>';
    await page.locator('input[name="question-0"][value="b"]').check();
    await page.locator('#comment-0').fill(essay);
    await expect(page.locator('#save-status')).toContainText('Saved answers received');
    let state = await fetch(url + '/api/state').then(r => r.json());
    if (state.answers.V01.comment !== essay) throw new Error('Disk receipt differs from typed essay');
    await page.reload();
    await expect(page.locator('#comment-0')).toHaveValue(essay);
    evidence.checks.push('disk-acknowledged verbatim answers and reload');
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Mobile horizontal overflow');
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1366, height: 900 });
    evidence.checks.push('desktop/mobile figures and no horizontal overflow');

    await context.setOffline(true);
    await page.locator('#comment-1').fill('AUTOMATED QA: retained during offline interval');
    await expect(page.locator('#save-status')).toContainText('Save not confirmed');
    await expect(page.locator('#comment-1')).toHaveValue('AUTOMATED QA: retained during offline interval');
    await context.setOffline(false);
    await page.locator('#retry-save').click();
    await expect(page.locator('#save-status')).toContainText('Saved answers received');
    evidence.checks.push('offline retention and successful retry');

    // A competing client commits while this tab has unsent local input.
    await page.route('**/api/answers', route => route.abort());
    await page.locator('#comment-2').fill('AUTOMATED QA: unsent local answer');
    await expect(page.locator('#save-status')).toContainText('Save not confirmed');
    state = await fetch(url + '/api/state').then(r => r.json());
    const remoteAnswers = structuredClone(state.answers);
    remoteAnswers.V03.comment = 'AUTOMATED QA: competing saved answer';
    const competing = await fetch(url + '/api/answers', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url, 'X-Review-Request': '1' }, body: JSON.stringify({ expectedRevision: state.revision, answers: remoteAnswers }) });
    if (!competing.ok) throw new Error('Synthetic competing save failed');
    await expect(page.locator('#save-status')).toContainText('Saving blocked', { timeout: 10000 });
    await expect(page.locator('#comment-2')).toHaveValue('AUTOMATED QA: unsent local answer');
    const download = page.waitForEvent('download');
    await page.locator('#download-unsaved').click();
    await (await download).saveAs(path.join(output, 'unsaved-rescue.json'));
    if (JSON.parse(fs.readFileSync(path.join(output, 'unsaved-rescue.json'))).answers.V03.comment !== 'AUTOMATED QA: unsent local answer') throw new Error('Rescue omitted local edit');
    await page.unroute('**/api/answers');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#reload-saved').click();
    await expect(page.locator('#comment-2')).toHaveValue('AUTOMATED QA: competing saved answer');
    evidence.checks.push('conflicting answers preserved, rescue downloaded, explicit reload');
    const receipt = await fetch(url + '/receipt.md').then(r => r.text());
    if (!receipt.includes(essay) || !receipt.includes('annotated/fig-01.png')) throw new Error('Markdown missing answer or inline figure');
    evidence.checks.push('Markdown receipt with inline annotated figures');
    const dialogs = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
    const closed = page.waitForEvent('close', { timeout: 15000 });
    await page.locator('#complete-review').click();
    await closed;
    await expect(hub.locator('#child-status')).toContainText('Cleanup confirmed');
    if (dialogs.length || hub.isClosed() || unrelated.isClosed()) throw new Error('Cleanup prompted or closed unrelated tabs');
    state = await fetch(url + '/api/state').then(r => r.json());
    if (!state.completedAt) throw new Error('Closed without recorded completion');
    await hub.screenshot({ path: path.join(output, 'completion-hub.png') });
    evidence.checks.push('acknowledged completion, actual child closure, hub and unrelated tab preserved');
    evidence.status = 'pass';
  } finally {
    await context.close();
    evidence.qaBrowserClosed = true;
    evidence.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  }
  console.log(JSON.stringify(evidence, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
