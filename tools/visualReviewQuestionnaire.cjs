'use strict';

const { readFileSync } = require('node:fs');
const answers = require('./visualReviewAnswers.cjs');

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function validateImages(imageData) {
  if (!imageData || ![Object.prototype, null].includes(Object.getPrototypeOf(imageData))) {
    throw new TypeError('imageData must be an allowlisted path-to-data-URL object');
  }
  for (const key of Reflect.ownKeys(imageData)) {
    if (!answers.IMAGE_PATH_WHITELIST.includes(key)) throw new TypeError('Unapproved image path');
  }
  const result = {};
  for (const path of answers.IMAGE_PATH_WHITELIST) {
    const descriptor = Object.getOwnPropertyDescriptor(imageData, path);
    const data = descriptor && descriptor.value;
    if (typeof data !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data) || data.endsWith(',')) {
      throw new TypeError(`Required annotated image must be a base64 raster data URL: ${path}`);
    }
    result[path] = data;
  }
  return result;
}

function validateObservations(observations = {}) {
  if (!observations || ![Object.prototype, null].includes(Object.getPrototypeOf(observations))) {
    throw new TypeError('observations must map question IDs to strings or string arrays');
  }
  const result = {};
  for (const id of Reflect.ownKeys(observations)) {
    if (!answers.QUESTION_CATALOG.some(question => question.id === id)) throw new TypeError('Unknown observation question ID');
    const descriptor = Object.getOwnPropertyDescriptor(observations, id);
    const value = descriptor.value;
    const items = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(items)) throw new TypeError(`${id} observations must be strings`);
    result[id] = [];
    for (let index = 0; index < items.length; index++) {
      const item = Object.getOwnPropertyDescriptor(items, String(index))?.value;
      if (typeof item !== 'string' || !item.trim()) throw new TypeError(`${id} observations must be nonempty strings`);
      result[id].push(item);
    }
  }
  return result;
}

// This pure renderer is also embedded in the offline browser runtime.
function portableMarkdown(packet, imageData, helper, observations = {}) {
  packet = helper.validateAnswerPacket(packet);
  const summary = helper.summarizeAnswers(packet.answers);
  const decision = packet.questionCatalog[9].choices.find(option => option.value === packet.answers.Q10.choice);
  const lines = ['# CPLayout Drawing Review Answers', '', `Packet: ${packet.packetId}`,
    `Schema version: ${packet.schemaVersion}`, `Source: ${packet.source}`, `Observed at: ${packet.observedAt}`,
    `Answered: ${summary.answered} of ${summary.total}`, `Response status: ${summary.status}`,
    'Complete means responses only; it does not imply acceptance.',
    `Q10 choice: ${decision ? decision.label : '[no choice selected]'}`, ''];
  packet.questionCatalog.forEach((question, index) => {
    const answer = packet.answers[question.id];
    const choice = question.choices.find(option => option.value === answer.choice);
    const fence = '`'.repeat((answer.comment.match(/`+/g) || []).reduce((length, run) => Math.max(length, run.length + 1), 3));
    lines.push(`### Question ${index + 1}`, '', `Question ID: ${question.id}`, '', question.text, '');
    for (const image of question.images) lines.push(`![${image.label}](${imageData[image.path]})`, '');
    if (observations[question.id]?.length) {
      const legend = observations[question.id].map((text, index) => `${index + 1}. ${text}`).join('\n');
      const legendFence = '`'.repeat((legend.match(/`+/g) || []).reduce((length, run) => Math.max(length, run.length + 1), 3));
      lines.push('Annotated callouts:', '', `${legendFence}text\n${legend}\n${legendFence}`, '');
    }
    lines.push(`Status: ${helper.getAnswerStatus(answer)}`, '',
      `Choice: ${choice ? `${choice.value}.) ${choice.label}` : question.choices.length ? '[no choice selected]' : '[not applicable]'}`,
      '', 'Comment:', '', `${fence}text\n${answer.comment}\n${fence}`, '');
  });
  return lines.join('\n');
}

function renderPortableMarkdown(packet, imageData, observations) {
  return portableMarkdown(packet, validateImages(imageData), answers, validateObservations(observations));
}

function browserRuntime(helper, markdown) {
  const data = JSON.parse(document.getElementById('questionnaire-data').textContent);
  const byId = id => document.getElementById(id);
  const storageKey = `cplayout:visual-review:v${helper.SCHEMA_VERSION}:${data.packetId}`;
  let packet = data.seedPacket ? helper.validateAnswerPacket(data.seedPacket) : helper.createAnswerPacket({
    packetId: data.packetId, source: 'browser', observedAt: new Date().toISOString(), answers: {},
  });
  const catalog = helper.QUESTION_CATALOG;
  let savedBaseline = null;
  let saveBlocked = false;

  function refresh() {
    const summary = helper.summarizeAnswers(packet.answers);
    byId('response-status').textContent = `${summary.answered} of ${summary.total} answered; responses ${summary.status}.`;
    const decision = catalog[9].choices.find(option => option.value === packet.answers.Q10.choice);
    byId('decision-status').textContent = `Q10 choice: ${decision ? decision.label : 'No choice selected'}`;
    byId('provenance-status').textContent = `Response source: ${packet.source}; observed at ${packet.observedAt}`;
    byId('receipt-status').textContent = packet.source === 'human-chat'
      ? 'Recorded from supplied chat. Browser changes have not been received by the review team.'
      : 'Browser responses have not been received by the review team.';
    for (const question of catalog) {
      byId(`${question.id}-status`).textContent = helper.getAnswerStatus(packet.answers[question.id]);
    }
  }

  function hydrate() {
    for (const question of catalog) {
      const answer = packet.answers[question.id];
      byId(`${question.id}-comment`).value = answer.comment;
      for (const option of question.choices) byId(`${question.id}-${option.value}`).checked = answer.choice === option.value;
    }
    refresh();
  }

  function collectChanges() {
    const input = {};
    for (const question of catalog) input[question.id] = {
      choice: question.choices.find(option => byId(`${question.id}-${option.value}`).checked)?.value || null,
      comment: byId(`${question.id}-comment`).value,
    };
    packet = helper.createAnswerPacket({ packetId: data.packetId, source: 'browser', observedAt: new Date().toISOString(), answers: input });
    refresh();
    byId('download-status').textContent = 'Current responses have not been downloaded.';
    save();
  }

  function save() {
    try {
      if (saveBlocked || localStorage.getItem(storageKey) !== savedBaseline) {
        saveBlocked = true;
        byId('local-status').textContent = 'Local copy preserved. Download current edits, or Restore local responses before saving over that copy.';
        return;
      }
      const serialized = JSON.stringify(packet);
      localStorage.setItem(storageKey, serialized);
      savedBaseline = serialized;
      byId('local-status').textContent = 'Saved locally in this browser.';
    } catch {
      byId('local-status').textContent = 'Local save failed. Responses remain on this page; download a copy.';
    }
  }

  byId('responses').addEventListener('input', collectChanges);
  byId('responses').addEventListener('click', event => {
    const id = event.target?.dataset?.clearChoice;
    if (!id || !catalog.some(question => question.id === id)) return;
    for (const option of catalog.find(question => question.id === id).choices) byId(`${id}-${option.value}`).checked = false;
    collectChanges();
    event.target.focus();
  });
  byId('save-local').addEventListener('click', save);
  function restoreLocal(automatic = false) {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === null) {
        savedBaseline = null;
        saveBlocked = false;
        if (!automatic) byId('local-status').textContent = 'No local responses found for this packet.';
        return;
      }
      const restored = helper.validateAnswerPacket(JSON.parse(saved));
      if (restored.packetId !== data.packetId) throw new Error('Different packet');
      packet = restored;
      savedBaseline = saved;
      saveBlocked = false;
      hydrate();
      byId('local-status').textContent = `${automatic ? 'Automatically restored' : 'Restored'} local responses for this packet.`;
      byId('download-status').textContent = 'Restored responses have not been downloaded in this session.';
    } catch {
      saveBlocked = true;
      byId('local-status').textContent = 'Local restore failed. Current responses are unchanged.';
    }
  }
  byId('restore-local').addEventListener('click', () => restoreLocal());

  function answeredHtml() {
    const clone = document.documentElement.cloneNode(true);
    // Persist the current packet, not the original seed or browser-only form state.
    clone.querySelector('#questionnaire-data').textContent = JSON.stringify({ ...data, seedPacket: packet })
      .replace(/[<>&\u2028\u2029]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    for (const question of catalog) {
      clone.querySelector(`#${question.id}-comment`).textContent = packet.answers[question.id].comment;
      for (const option of question.choices) {
        const radio = clone.querySelector(`#${question.id}-${option.value}`);
        if (packet.answers[question.id].choice === option.value) radio.setAttribute('checked', '');
        else radio.removeAttribute('checked');
      }
    }
    clone.querySelector('#local-status').textContent = 'Embedded responses; not saved locally in this browser session.';
    clone.querySelector('#download-status').textContent = 'No download requested in this session.';
    return '<!doctype html>\n' + clone.outerHTML;
  }

  function download(extension, type, content) {
    let url;
    let anchor;
    try {
      url = URL.createObjectURL(new Blob([content()], { type }));
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${data.packetId}-answers.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      byId('download-status').textContent = `${extension.toUpperCase()} download requested; file delivery is not confirmed.`;
    } catch {
      byId('download-status').textContent = 'Download failed. Responses remain on this page.';
    } finally {
      if (anchor) anchor.remove();
      if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  byId('download-json').addEventListener('click', () => download('json', 'application/json', () => JSON.stringify(packet, null, 2)));
  byId('download-markdown').addEventListener('click', () => download('md', 'text/markdown;charset=utf-8', () => markdown(packet, data.imageData, helper, data.observations)));
  byId('download-html').addEventListener('click', () => download('html', 'text/html;charset=utf-8', answeredHtml));
  hydrate();
  if (!data.seedPacket) restoreLocal(true);
  else {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) {
        saveBlocked = true;
        const candidate = helper.validateAnswerPacket(JSON.parse(saved));
        if (candidate.packetId !== data.packetId) throw new Error('Different packet');
        byId('local-status').textContent = 'A matching local saved copy is available. Embedded responses retained until Restore local responses.';
      }
    } catch {
      saveBlocked = true;
      byId('local-status').textContent = 'Local saved copy could not be checked. Embedded responses are unchanged.';
    }
  }
}

/** imageData maps every IMAGE_PATH_WHITELIST path to a raster data URL.
 * helperSource is optional trusted build-time CommonJS source, never response data.
 * A supplied seedPacket retains its provenance until the reviewer changes an answer.
 * observations maps Q01..Q10 to a string or an ordered array of callout strings.
 */
function generateQuestionnaireHtml({ packetId, imageData, seedPacket = null, helperSource, observations } = {}) {
  const seed = seedPacket === null ? null : answers.validateAnswerPacket(seedPacket);
  if (packetId === undefined && seed) packetId = seed.packetId;
  answers.createAnswerPacket({ packetId, source: 'browser', observedAt: '2000-01-01T00:00:00.000Z', answers: {} });
  if (seed && seed.packetId !== packetId) throw new TypeError('Seed packetId does not match questionnaire');
  const images = validateImages(imageData);
  const legends = validateObservations(observations);
  const source = helperSource === undefined ? readFileSync(require.resolve('./visualReviewAnswers.cjs'), 'utf8') : helperSource;
  if (typeof source !== 'string' || !source.trim() || /<\/script|<!--|-->/i.test(source)) {
    throw new TypeError('helperSource must be trusted CommonJS source without HTML script delimiters');
  }
  const initial = seed ? seed.answers : answers.normalizeAnswers({});
  const summary = answers.summarizeAnswers(initial);
  const decision = answers.QUESTION_CATALOG[9].choices.find(option => option.value === initial.Q10.choice);
  const sections = answers.QUESTION_CATALOG.map((question, index) => {
    const answer = initial[question.id];
    return `<section id="${question.id}" aria-labelledby="${question.id}-heading">
<h2 id="${question.id}-heading">Question ${index + 1} <small>${question.id}</small></h2>
<div class="question-layout"><div class="figures">${question.images.map(image => `<figure><a href="${images[image.path]}" target="_blank" rel="noopener"><img src="${images[image.path]}" alt="${escapeHtml(image.label)}"></a><figcaption>${escapeHtml(image.label)}</figcaption></figure>`).join('')}${legends[question.id]?.length ? `<aside aria-label="Annotated callouts"><h3>Annotated callouts</h3><ol>${legends[question.id].map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ol></aside>` : ''}</div>
<div class="answer"><fieldset><legend>${escapeHtml(question.text)}</legend>
${question.choices.map(option => `<label class="choice"><input type="radio" id="${question.id}-${option.value}" name="${question.id}" value="${option.value}"${answer.choice === option.value ? ' checked' : ''}> ${option.value}.) ${escapeHtml(option.label)}</label>`).join('')}${question.choices.length ? `<button type="button" data-clear-choice="${question.id}">Clear choice</button>` : ''}
</fieldset><label for="${question.id}-comment">${question.choices.length ? 'Comment / essay' : 'Essay'}</label>
<textarea id="${question.id}-comment" name="${question.id}-comment" rows="6">${escapeHtml(answer.comment)}</textarea>
<p id="${question.id}-status">${answers.getAnswerStatus(answer)}</p></div></div></section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CPLayout Drawing Review - ${escapeHtml(packetId)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#202620;font:16px/1.5 system-ui,sans-serif;letter-spacing:0}
header,main,footer{max-width:1280px;margin:auto;padding:24px}header{border-bottom:3px solid #2f7154}h1{font-size:28px;margin:0 0 12px}h2{font-size:22px}small{font-size:14px;color:#59655e}p{margin:8px 0;overflow-wrap:anywhere}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}button{font:inherit;min-height:44px;padding:8px 12px;background:#f2f5f3;border:1px solid #687b70;border-radius:4px;color:#202620;cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #ad581a;outline-offset:2px}
section{padding:12px 0 28px;border-bottom:1px solid #cbd2cd}.question-layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(280px,1fr);gap:24px}.figures:empty{display:none}.question-layout:has(.figures:empty){grid-template-columns:1fr}.answer{min-width:0}figure{margin:0 0 20px}img{display:block;width:100%;height:auto}figcaption{font-size:14px;color:#48584e}fieldset{border:0;padding:0;margin:0 0 16px;min-width:0}legend{font-weight:600;margin-bottom:12px;overflow-wrap:anywhere}.choice{display:flex;gap:10px;align-items:baseline;margin:12px 0}input{flex:none}textarea{display:block;width:100%;resize:vertical;font:inherit;min-height:140px;margin-top:6px;border:1px solid #687b70;border-radius:4px;padding:8px}
@media(max-width:760px){header,main,footer{padding:16px}.question-layout{grid-template-columns:1fr}h1{font-size:24px}}@media print{.actions{display:none}section{break-inside:avoid}}
</style></head><body>
<header><h1>CPLayout Drawing Review</h1><p>Packet: ${escapeHtml(packetId)}</p>
<p>Legacy questionnaire: figure bytes and reviewed build/capture identity are not bound to these answers.</p>
<p id="response-status" role="status">${summary.answered} of ${summary.total} answered; responses ${summary.status}.</p>
<p>Complete means responses only; it does not imply acceptance.</p>
<p id="decision-status">Q10 choice: ${decision ? escapeHtml(decision.label) : 'No choice selected'}</p>
<p id="provenance-status">${seed ? `Response source: ${seed.source}; observed at ${seed.observedAt}` : 'No supplied responses.'}</p>
<div class="actions"><button type="button" id="save-local">Save locally</button><button type="button" id="restore-local">Restore local responses</button><button type="button" id="download-json">Download JSON</button><button type="button" id="download-markdown">Download Markdown</button><button type="button" id="download-html">Download answered HTML</button></div>
<p id="local-status" role="status">${seed ? 'Embedded responses; not saved locally in this browser session.' : 'Not saved locally in this browser session.'}</p>
<p id="download-status" role="status">No download requested in this session.</p>
<p id="receipt-status">${seed?.source === 'human-chat' ? 'Recorded from supplied chat. Browser changes have not been received by the review team.' : 'Browser responses have not been received by the review team.'}</p>
<noscript>JavaScript is required to save, restore, or download responses.</noscript></header>
<main><form id="responses" onsubmit="return false">${sections}</form></main>
<script type="application/json" id="questionnaire-data">${scriptJson({ packetId, seedPacket: seed, imageData: images, observations: legends })}</script>
<script>
(() => {
const helper = (() => { const module = { exports: {} }; const exports = module.exports;
${source}
return module.exports; })();
(${browserRuntime.toString()})(helper, ${portableMarkdown.toString()});
})();
</script></body></html>`;
}

module.exports = Object.freeze({ generateQuestionnaireHtml, renderPortableMarkdown });
