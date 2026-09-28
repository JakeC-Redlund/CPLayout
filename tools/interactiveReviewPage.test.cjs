'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { renderPage, clientSource } = require('./interactiveReviewPage.cjs');

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.events = {};
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.scrollHeight = 100;
    this.scrollTop = 0;
    this.clientHeight = 100;
    this.text = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ''; this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(event, callback) { (this.events[event] ||= []).push(callback); }
  fire(event, data = {}) { return Promise.all((this.events[event] || []).map((callback) => callback(data))); }
  click() { return this.fire('click'); }
  focus() { this.focused = true; }
  remove() { this.removed = true; }
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise(setImmediate); };
function fixture() {
  return {
    schemaVersion: 1, revision: 1,
    packet: {
      id: 'fixture', title: 'Review <title>', context: 'Context & evidence',
      questions: ['V01', 'V02', 'V03', 'V04'].map((id) => ({
        id, text: `Question ${id} <script>`,
        choices: [{ value: 'yes', label: 'Yes <b>' }, { value: 'no', label: 'No' }],
        images: [{ path: 'annotated/a b.png', label: 'Annotated <figure>' }],
        observations: ['Observation <img src=x onerror=alert(1)>'],
      })),
    },
    answers: {}, messages: [], completedAt: null, updatedAt: '2026-09-27T10:00:00.000Z',
  };
}

function harness({ hub = false, initial = fixture(), draftStorage = new Map() } = {}) {
  let state = clone(initial);
  const ids = new Map();
  for (const match of renderPage({ hub }).matchAll(/id="([^"]+)"/g)) ids.set(match[1], new Element('div'));
  const body = new Element('body');
  body.dataset.hub = String(hub);
  const timers = new Map();
  const intervals = [];
  const calls = [];
  const blobs = [];
  const opens = [];
  let timerId = 0;
  const windowEvents = {};
  const h = {
    ids, body, calls, timers, intervals, blobs, opens, closed: 0, confirms: 0,
    handler: null, confirmAnswer: false, blockPopup: false,
    get state() { return state; },
    set state(value) { state = clone(value); },
    element: (id) => ids.get(id),
    all(tag) {
      const found = [];
      const visit = (element) => {
        if (element.tagName === tag) found.push(element);
        element.children.forEach(visit);
      };
      visit(ids.get('questions'));
      return found;
    },
    async edit(index, text) {
      const input = h.all('textarea')[index];
      input.value = text;
      await input.fire('input');
    },
    async tick(delay) {
      const entries = [...timers.entries()].filter(([, timer]) => timer.delay === delay);
      for (const [id, timer] of entries) { timers.delete(id); timer.callback(); }
      await settle();
    },
    async poll() { intervals[0](); await settle(); },
    beforeUnload() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      windowEvents.beforeunload(event);
      return event;
    },
  };
  const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => clone(value) });
  h.response = response;
  const normal = async (path, options) => {
    if (path === '/api/state') return response(state);
    const payload = JSON.parse(options.body);
    if (payload.expectedRevision !== state.revision || state.completedAt) return response({}, 409);
    state.revision += 1;
    if (path === '/api/answers') state.answers = payload.answers;
    if (path === '/api/complete') state.completedAt = '2026-09-27T11:00:00.000Z';
    return response(state);
  };
  h.normal = normal;
  const context = {
    document: { body, getElementById: (id) => ids.get(id), createElement: (tag) => new Element(tag) },
    window: {
      addEventListener: (event, callback) => { windowEvents[event] = callback; },
      confirm: () => { h.confirms += 1; return h.confirmAnswer; },
      close: () => { h.closed += 1; h.unloadAtClose = h.beforeUnload(); },
      open: (path, name) => {
        if (h.blockPopup) return null;
        const child = { path, name, closed: false, focuses: 0, focus() { this.focuses += 1; } };
        opens.push(child);
        return child;
      },
    },
    fetch: async (path, options) => {
      calls.push({ path, ...options });
      return h.handler ? h.handler(path, options) : normal(path, options);
    },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => { assert.equal(delay, 2000); intervals.push(callback); },
    AbortController, Blob,
    sessionStorage: {
      getItem: key => draftStorage.has(key) ? draftStorage.get(key) : null,
      setItem: (key, value) => draftStorage.set(key, value),
      removeItem: key => draftStorage.delete(key),
    },
    URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:rescue'; }, revokeObjectURL() {} },
  };
  vm.runInNewContext(clientSource(), context);
  return h;
}

test('unsent edits survive reload but require explicit restore', async () => {
  const draftStorage = new Map();
  const first = harness({ draftStorage });
  await settle();
  await first.edit(0, 'Unsent exact essay');
  assert.equal(draftStorage.size, 1);
  const resumed = harness({ draftStorage });
  await settle();
  assert.equal(resumed.all('textarea')[0].value, '');
  assert.equal(resumed.element('restore-draft').hidden, false);
  await resumed.element('restore-draft').click();
  assert.equal(resumed.all('textarea')[0].value, 'Unsent exact essay');
  assert.match(resumed.element('save-status').textContent, /Unsaved changes/);
  await resumed.tick(650);
  assert.equal(draftStorage.size, 0);
  assert.equal(resumed.state.answers.V01.comment, 'Unsent exact essay');
});

test('HTML uses only the external script and downloadable server receipts', () => {
  for (const hub of [true, false]) {
    const html = renderPage({ hub });
    assert.match(html, /<script src="\/client.js" defer><\/script>/);
    assert.equal((html.match(/<script/g) || []).length, 1);
    assert.match(html, /href="\/receipt.md" download/);
    assert.match(html, /href="\/answers.json" download/);
    assert.doesNotMatch(html, /\son\w+=|target="_blank"/);
  }
  assert.doesNotMatch(clientSource(), /innerHTML|outerHTML|insertAdjacentHTML|eval\(/);
});

test('generic V01-V04 questions preserve literal human text and zoom images in place', async () => {
  const h = harness();
  await settle();
  assert.equal(h.all('textarea').length, 4);
  assert.match(h.all('legend')[0].textContent, /^1\. Question V01 <script>V01$/);
  assert.match(h.all('label')[0].textContent, /^A\. Yes <b>$/);
  assert.equal(h.all('img')[0].src, '/assets/annotated/a%20b.png');
  assert.equal(h.all('img')[0].alt, 'Annotated <figure>');
  assert.equal(h.all('a').length, 0);
  const zoom = h.all('button').find((element) => element.textContent === 'Zoom image');
  await zoom.click();
  assert.equal(zoom.getAttribute('aria-pressed'), 'true');
  const viewport = h.all('div').find((element) => element.className === 'figure-view zoomed');
  assert.equal(viewport.tabIndex, 0);
  await viewport.fire('keydown', { key: 'Escape' });
  assert.equal(zoom.getAttribute('aria-pressed'), 'false');
  assert.equal(zoom.focused, true);
});

test('network failure retains exact edits, warns on unload and exports rescue JSON', async () => {
  const h = harness();
  await settle();
  h.handler = (path, options) => path === '/api/answers' ? Promise.reject(new Error('offline')) : h.normal(path, options);
  await h.edit(0, '  Exact human comment\n<script>  ');
  assert.equal(h.beforeUnload().prevented, true);
  await h.tick(650);
  assert.match(h.element('save-status').textContent, /Save not confirmed/);
  assert.equal(h.all('textarea')[0].value, '  Exact human comment\n<script>  ');
  await h.element('download-unsaved').click();
  const rescue = JSON.parse(await h.blobs[0].text());
  assert.equal(rescue.unsaved, true);
  assert.equal(rescue.answers.V01.comment, '  Exact human comment\n<script>  ');
  assert.equal(rescue.revision, 1);
  h.handler = null;
  await h.tick(2500);
  assert.equal(h.state.answers.V01.comment, rescue.answers.V01.comment);
  assert.equal(h.beforeUnload().prevented, false);
  assert.match(h.element('progress').textContent, /1 of 4 answered \(saved\)/);
  for (const call of h.calls) {
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.headers['X-Review-Request'], '1');
    assert.equal(call.credentials, 'same-origin');
  }
});

test('polling message-only revisions preserves drafts and uses the latest revision', async () => {
  const h = harness();
  await settle();
  await h.edit(0, 'draft');
  h.state = { ...h.state, revision: 2, messages: [{ text: 'Reviewing the next improvement <b>', at: 'now' }] };
  await h.poll();
  assert.match(h.element('messages').textContent, /Reviewing the next improvement <b>/);
  assert.equal(h.all('textarea')[0].value, 'draft');
  assert.doesNotMatch(h.element('save-status').textContent, /blocked/);
  await h.tick(650);
  const post = h.calls.find((call) => call.path === '/api/answers');
  assert.equal(JSON.parse(post.body).expectedRevision, 2);
  assert.equal(h.state.answers.V01.comment, 'draft');
});

test('409 retries only when received answers still match the acknowledged baseline', async () => {
  const h = harness();
  await settle();
  await h.edit(0, 'draft');
  h.state = { ...h.state, revision: 2, messages: [{ text: 'Agent progress', at: 'now' }] };
  await h.tick(650);
  assert.equal(h.calls.filter((call) => call.path === '/api/answers').length, 2);
  assert.equal(h.state.answers.V01.comment, 'draft');
  assert.doesNotMatch(h.element('save-status').textContent, /blocked/);
});

test('human-answer conflicts block saving and require confirmation to replace the draft', async () => {
  const h = harness();
  await settle();
  await h.edit(0, 'my unsaved response');
  h.state = { ...h.state, revision: 2, answers: { V01: { choice: 'yes', comment: 'another response' } } };
  await h.tick(650);
  assert.match(h.element('save-status').textContent, /Saving blocked/);
  assert.equal(h.element('complete-review').disabled, true);
  assert.equal(h.all('textarea')[0].value, 'my unsaved response');
  await h.poll();
  assert.equal(h.all('textarea')[0].value, 'my unsaved response');
  await h.element('reload-saved').click();
  assert.equal(h.confirms, 1);
  assert.equal(h.all('textarea')[0].value, 'my unsaved response');
  h.confirmAnswer = true;
  await h.element('reload-saved').click();
  assert.equal(h.all('textarea')[0].value, 'another response');
  assert.equal(h.beforeUnload().prevented, false);
});

test('edits during an in-flight save are serialized and completion waits for the latest save', async () => {
  const h = harness();
  await settle();
  let release;
  let held = true;
  h.handler = async (path, options) => {
    if (path === '/api/answers' && held) {
      held = false;
      await new Promise((resolve) => { release = resolve; });
    }
    return h.normal(path, options);
  };
  await h.edit(0, 'first');
  await h.tick(650);
  assert.match(h.element('save-status').textContent, /waiting for disk acknowledgment/);
  await h.edit(0, 'latest');
  const completion = h.element('complete-review').click();
  await settle();
  assert.equal(h.calls.filter((call) => call.path === '/api/complete').length, 0);
  assert.equal(h.all('textarea')[0].disabled, true);
  release();
  await completion;
  assert.equal(h.state.answers.V01.comment, 'latest');
  assert.deepEqual(h.calls.filter((call) => call.method === 'POST').map((call) => call.path), ['/api/answers', '/api/answers', '/api/complete']);
  assert.equal(h.closed, 1);
  assert.equal(h.unloadAtClose.prevented, false);
  assert.equal(h.all('textarea')[0].disabled, true);
  assert.match(h.element('completion-note').textContent, /browser prevented automatic closing/);
});

test('completion does not close on failed save or unacknowledged completion', async () => {
  const h = harness();
  await settle();
  await h.edit(0, 'keep me');
  h.handler = (path, options) => path === '/api/answers' ? Promise.reject(new Error('offline')) : h.normal(path, options);
  await h.element('complete-review').click();
  assert.equal(h.closed, 0);
  assert.equal(h.calls.filter((call) => call.path === '/api/complete').length, 0);
  assert.equal(h.all('textarea')[0].value, 'keep me');
  h.handler = (path, options) => path === '/api/complete' ? h.response(h.state) : h.normal(path, options);
  await h.element('complete-review').click();
  assert.equal(h.closed, 0);
  assert.match(h.element('save-status').textContent, /Completion not confirmed/);
});

test('completion retries a message-only conflict and remains separate from acceptance', async () => {
  const h = harness();
  await settle();
  h.state = { ...h.state, revision: 2, messages: [{ text: 'Progress', at: 'now' }] };
  await h.element('complete-review').click();
  assert.equal(h.calls.filter((call) => call.path === '/api/complete').length, 2);
  assert.equal(h.closed, 1);
  assert.match(h.element('save-status').textContent, /Completion does not mean acceptance/);
});

test('late poll responses cannot roll back a successful save', async () => {
  const h = harness();
  await settle();
  let release;
  const stale = clone(h.state);
  h.handler = (path, options) => path === '/api/state'
    ? new Promise((resolve) => { release = () => resolve(h.response(stale)); })
    : h.normal(path, options);
  await h.poll();
  await h.edit(0, 'new saved answer');
  await h.tick(650);
  release();
  await settle();
  assert.equal(h.all('textarea')[0].value, 'new saved answer');
  assert.equal(h.beforeUnload().prevented, false);
});

test('remote completion retains dirty answers for rescue and makes the form read-only', async () => {
  const h = harness();
  await settle();
  await h.edit(0, 'unsaved local');
  h.state = { ...h.state, revision: 2, completedAt: '2026-09-27T12:00:00Z' };
  await h.poll();
  assert.match(h.element('save-status').textContent, /completed elsewhere/);
  assert.equal(h.all('textarea')[0].value, 'unsaved local');
  assert.equal(h.all('textarea')[0].disabled, true);
  assert.equal(h.closed, 0);
  assert.equal(h.beforeUnload().prevented, true);
});

test('hub opens one named child on user action and reports actual closure', async () => {
  const h = harness({ hub: true });
  await settle();
  assert.equal(h.opens.length, 0);
  await h.element('open-review').click();
  await h.element('open-review').click();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].path, '/review');
  assert.match(h.opens[0].name, /^cplayout-review-/);
  assert.equal(h.opens[0].focuses, 1);
  h.state = { ...h.state, revision: 2, completedAt: '2026-09-27T12:00:00Z' };
  await h.poll();
  assert.match(h.element('child-status').textContent, /still open/);
  assert.equal(h.closed, 0);
  h.opens[0].closed = true;
  await h.poll();
  assert.match(h.element('child-status').textContent, /Cleanup confirmed/);
  await h.element('open-review').click();
  assert.equal(h.opens.length, 2);
  assert.equal(h.opens[1].name, h.opens[0].name);
});

test('blocked popups produce a visible retry instruction', async () => {
  const h = harness({ hub: true });
  await settle();
  h.blockPopup = true;
  await h.element('open-review').click();
  assert.match(h.element('child-status').textContent, /Allow pop-ups/);
  assert.equal(h.opens.length, 0);
});

test('a lost completion response is recovered by polling without an automatic close', async () => {
  const h = harness();
  await settle();
  h.handler = async (path, options) => {
    const response = await h.normal(path, options);
    if (path === '/api/complete') throw new Error('response lost');
    return response;
  };
  await h.element('complete-review').click();
  assert.equal(h.closed, 0);
  assert.match(h.element('save-status').textContent, /Completion not confirmed/);
  await h.poll();
  assert.match(h.element('save-status').textContent, /Responses are read-only/);
  assert.equal(h.element('close-review').hidden, false);
  assert.equal(h.closed, 0);
});

test('message-only automatic retries are bounded and never overwrite packet changes', async () => {
  const h = harness();
  await settle();
  await h.edit(0, 'local answer');
  h.handler = async (path, options) => {
    if (path === '/api/answers') h.state = { ...h.state, revision: h.state.revision + 1 };
    return h.normal(path, options);
  };
  await h.tick(650);
  assert.equal(h.calls.filter((call) => call.path === '/api/answers').length, 3);
  assert.match(h.element('save-status').textContent, /Saving blocked/);
  assert.equal(h.all('textarea')[0].value, 'local answer');
  const changedPacket = clone(h.state);
  changedPacket.packet.questions[0].text = 'Different question';
  changedPacket.revision += 1;
  h.state = changedPacket;
  await h.poll();
  assert.match(h.all('legend')[0].textContent, /Question V01/);
  assert.equal(h.all('textarea')[0].value, 'local answer');
});
