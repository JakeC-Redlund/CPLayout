'use strict';

function renderPage({ hub = false } = {}) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${hub ? 'Review hub' : 'Review questionnaire'} | CPLayout</title>
<style>
:root{color-scheme:light;font-family:system-ui,sans-serif;color:#20312a;background:#fff;line-height:1.5}
*{box-sizing:border-box}body{margin:0}button,a,input,textarea{font:inherit}button,a,textarea{touch-action:manipulation}
button,.download{min-height:44px;padding:9px 14px;border:1px solid #637c6d;border-radius:5px;background:#fff;color:#204b36;cursor:pointer}
button.primary{background:#246044;color:#fff;border-color:#246044}button:disabled{opacity:.6;cursor:default}
button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid #b87808;outline-offset:3px}
a{color:#225c40;overflow-wrap:anywhere}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:0 0 12px}p{margin:8px 0}
header{border-bottom:1px solid #ccd8d0;padding:20px max(16px,calc((100% - 1200px)/2));background:#f3f8f4}
main{max-width:1232px;margin:auto;padding:20px 16px 48px}.layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:32px}
section,aside,fieldset{min-width:0}.context,.message-text,.observation{white-space:pre-wrap;overflow-wrap:anywhere}
.actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0}.download{display:inline-flex;align-items:center;text-decoration:none}
.status{padding:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}.status[data-tone="warning"]{color:#754506;border-left:4px solid #bf850b;padding-left:12px;background:#fff8e7}
.status[data-tone="success"]{color:#20573c}.secondary{color:#53615a;font-size:14px}.progress{font-weight:600;margin:12px 0}
aside{border-left:1px solid #ccd8d0;padding-left:20px;align-self:start;position:sticky;top:16px}#messages{max-height:65vh;overflow:auto;padding-left:22px;margin:0}
#messages li{padding:10px 0;border-bottom:1px solid #dce4df}time{display:block;font-size:13px;color:#53615a}
fieldset{border:0;border-top:1px solid #c7d4ca;padding:24px 0;margin:0 0 8px}legend{font-size:18px;font-weight:600;padding:0 8px 0 0;overflow-wrap:anywhere;max-width:100%}
.question-id{display:block;font-size:13px;font-weight:400;color:#53615a}.choices{display:grid;gap:8px;margin:16px 0}
.choice{display:flex;gap:12px;align-items:center;min-height:44px;padding:8px 10px;border:1px solid #c7d4ca;border-radius:5px;overflow-wrap:anywhere}
.choice:has(input:checked){border-color:#246044;background:#edf6ef}.choice input{width:22px;height:22px;flex-shrink:0;accent-color:#246044;margin:0}
.comment-label{display:block;font-weight:600;margin:12px 0 6px}textarea{width:100%;min-height:112px;resize:vertical;border:1px solid #738b7c;border-radius:5px;padding:12px;color:#20312a;background:#fff}
figure{margin:16px 0}figure img{display:block;width:100%;height:auto;border:1px solid #d4ddd7}figcaption{font-size:14px;margin-top:6px;overflow-wrap:anywhere}
.figure-view{max-width:100%;overflow:auto}.figure-view.zoomed{max-height:75vh}.figure-view.zoomed img{width:auto;max-width:none}.figure-tools{margin-top:8px}
.observations{padding-left:22px}.observations li{margin-bottom:8px}#questions{margin-top:20px}#completion-note{font-weight:600}
[hidden]{display:none!important}@media(max-width:760px){.layout{display:flex;flex-direction:column;gap:20px}aside{order:-1;align-self:stretch;position:static;border-left:0;border-bottom:1px solid #ccd8d0;padding:0 0 16px}#messages{max-height:220px}header{padding:16px}h1{font-size:22px}.actions>*{max-width:100%}button,.download{white-space:normal;overflow-wrap:anywhere}}
</style><script src="/client.js" defer></script></head>
<body data-hub="${hub ? 'true' : 'false'}"><header><p class="secondary">CPLayout / ${hub ? 'Review hub' : 'Questionnaire'}</p>
<h1 id="title">Loading review...</h1><p id="context" class="context"></p>
<p id="progress" class="progress">Waiting for saved answers</p><p id="connection" class="secondary" role="status"></p></header>
<main><div class="layout"><section aria-label="${hub ? 'Review progress' : 'Review answers'}">
<p id="save-status" class="status" role="status" aria-live="polite" tabindex="-1">Connecting...</p>
<p id="completion-note">Completing this questionnaire records your responses. It does not mean acceptance.</p>
<p class="secondary">This local page records submitted answers but cannot verify who typed them. Agent observations are labeled separately.</p>
<div id="hub-actions" class="actions"${hub ? '' : ' hidden'}><button id="open-review" class="primary" type="button" disabled>Open questionnaire</button></div>
<p id="child-status" role="status"${hub ? '' : ' hidden'}>No questionnaire window has been opened by this hub.</p>
<div id="review-actions" class="actions"${hub ? ' hidden' : ''}><button id="retry-save" type="button" disabled>Retry save</button><button id="reload-saved" type="button" disabled>Reload saved answers</button><button id="restore-draft" type="button" hidden>Restore unsent edits</button><button id="discard-draft" type="button" hidden>Discard unsent edits</button></div>
<p id="recovery-status" class="status" role="status" aria-live="polite"></p>
<div class="actions"><button id="download-unsaved" type="button" disabled>Download current answers (rescue JSON)</button>
<a class="download" href="/answers.json" download>Received answers (JSON)</a><a class="download" href="/receipt.md" download>Received receipt (Markdown)</a></div>
<div id="questions"></div><div class="actions"${hub ? ' hidden' : ''}><button id="complete-review" class="primary" type="button" disabled>Complete questionnaire</button><button id="close-review" type="button" hidden>Close questionnaire</button></div>
</section><aside aria-labelledby="messages-heading"><h2 id="messages-heading">Agent messages</h2><p id="message-empty" class="secondary">No messages yet.</p><ol id="messages" role="log" aria-live="polite" aria-relevant="additions text"></ol></aside></div>
<noscript>JavaScript is required to load and save this review. Received answers and the receipt remain available from the download links.</noscript></main></body></html>`;
}

// This function is serialized into /client.js; keep its dependencies inside it.
function reviewClient() {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const hub = document.body.dataset.hub === 'true';
  let saved = null;
  let latest = null;
  let answers = Object.create(null);
  let editVersion = 0;
  let acknowledgedVersion = 0;
  let blocked = '';
  let saveError = '';
  let saving = null;
  let completing = false;
  let reloading = false;
  let polling = false;
  let saveTimer;
  let controls = [];
  let packetSignature = '';
  let messageSignature = '';
  let ownedChild = null;
  let draftChecked = false;
  let pendingDraft = null;
  const childName = `cplayout-review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dirty = () => editVersion !== acknowledgedVersion;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const draftKey = id => `cplayout:review-unsent:v1:${id}`;
  function keepDraft() {
    if (!saved || hub) return;
    try {
      sessionStorage.setItem(draftKey(saved.packet.id), JSON.stringify({ packet: saved.packet,
        evidenceIdentity: saved.evidenceIdentity || null, revision: saved.revision, answers: copy(answers) }));
    } catch { byId('recovery-status').textContent = 'Browser recovery storage is unavailable. Download current answers to keep a copy.'; }
  }
  function clearDraft() {
    if (!saved || hub) return;
    try { sessionStorage.removeItem(draftKey(saved.packet.id)); } catch { /* Current page remains editable. */ }
  }
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  const letters = (index) => {
    let label = '';
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      label = String.fromCharCode(65 + (value - 1) % 26) + label;
    }
    return label;
  };

  async function request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Review-Request': '1' },
        credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        const error = new Error(`Request failed (${response.status}).`);
        error.status = response.status;
        throw error;
      }
      const state = await response.json();
      if (state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) ||
          !state.packet || !Array.isArray(state.packet.questions) || !state.answers ||
          !Array.isArray(state.messages)) throw new Error('The server returned an unreadable review.');
      return state;
    } finally {
      clearTimeout(timer);
    }
  }

  function renderMessages(state) {
    const signature = JSON.stringify(state.messages);
    if (signature === messageSignature) return;
    messageSignature = signature;
    const list = byId('messages');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren(...state.messages.map((message) => {
      const item = node('li');
      const time = node('time', message.at);
      time.dateTime = message.at;
      item.append(node('p', message.text, 'message-text'), time);
      return item;
    }));
    byId('message-empty').hidden = state.messages.length > 0;
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  function observe(state) {
    if (latest && state.revision < latest.revision) return;
    latest = state;
    renderMessages(state);
    byId('connection').textContent = 'Connected to the review server';
  }

  function changed(id, field, value) {
    if (completing || reloading || saved.completedAt || latest.completedAt) return;
    answers[id][field] = value;
    editVersion += 1;
    keepDraft();
    saveError = '';
    renderStatus();
    scheduleSave(650);
  }

  function buildQuestions(packet) {
    const signature = JSON.stringify(packet);
    if (signature === packetSignature) return;
    packetSignature = signature;
    controls = [];
    byId('questions').replaceChildren();
    if (hub) return;
    packet.questions.forEach((question, index) => {
      const fieldset = node('fieldset');
      const legend = node('legend', `${index + 1}. ${question.text}`);
      legend.append(node('span', question.id, 'question-id'));
      fieldset.append(legend);
      (question.images || []).forEach((image) => {
        const figure = node('figure');
        const segments = typeof image.path === 'string' ? image.path.split('/') : [];
        const safePath = segments.length && segments.every((part) => part && part !== '.' && part !== '..' && !/[\\\u0000]/.test(part));
        if (safePath) {
          const source = `/assets/${segments.map(encodeURIComponent).join('/')}`;
          const viewport = node('div', undefined, 'figure-view');
          viewport.tabIndex = 0;
          viewport.setAttribute('role', 'region');
          viewport.setAttribute('aria-label', image.label || 'Review figure');
          const img = node('img');
          img.src = source;
          img.alt = image.label || 'Review figure';
          img.loading = 'lazy';
          const zoom = node('button', 'Zoom image');
          zoom.type = 'button';
          zoom.className = 'figure-tools';
          zoom.setAttribute('aria-pressed', 'false');
          zoom.addEventListener('click', () => {
            const expanded = zoom.getAttribute('aria-pressed') !== 'true';
            zoom.setAttribute('aria-pressed', String(expanded));
            zoom.textContent = expanded ? 'Fit image' : 'Zoom image';
            viewport.className = expanded ? 'figure-view zoomed' : 'figure-view';
          });
          viewport.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              viewport.className = 'figure-view';
              zoom.textContent = 'Zoom image';
              zoom.setAttribute('aria-pressed', 'false');
              zoom.focus();
            }
          });
          img.addEventListener('error', () => {
            img.hidden = true;
            viewport.append(node('p', 'Image unavailable. The review server could not load this figure.'));
            zoom.disabled = true;
          });
          viewport.append(img);
          figure.append(viewport, zoom);
        } else {
          figure.append(node('p', 'Image unavailable: invalid asset path.', 'status'));
        }
        figure.append(node('figcaption', image.label || 'Review figure'));
        fieldset.append(figure);
      });
      if (question.observations && question.observations.length) {
        fieldset.append(node('p', 'Agent observations (separate from your answers)'));
        const observations = node('ul', undefined, 'observations');
        question.observations.forEach((text) => observations.append(node('li', text, 'observation')));
        fieldset.append(observations);
      }
      const choices = node('div', undefined, 'choices');
      (question.choices || []).forEach((choice, choiceIndex) => {
        const label = node('label', undefined, 'choice');
        const radio = node('input');
        radio.type = 'radio';
        radio.name = `question-${index}`;
        radio.value = choice.value;
        radio.addEventListener('change', () => {
          if (radio.checked) changed(question.id, 'choice', choice.value);
        });
        controls.push({ element: radio, id: question.id, choice: choice.value });
        label.append(radio, node('span', `${letters(choiceIndex)}. ${choice.label}`));
        choices.append(label);
      });
      fieldset.append(choices);
      if (question.choices && question.choices.length) {
        const clear = node('button', 'Clear choice');
        clear.type = 'button';
        clear.addEventListener('click', () => {
          changed(question.id, 'choice', null);
          syncInputs();
        });
        controls.push({ element: clear });
        fieldset.append(clear);
      }
      const commentId = `comment-${index}`;
      const label = node('label', 'Comments', 'comment-label');
      label.htmlFor = commentId;
      const comment = node('textarea');
      comment.id = commentId;
      comment.rows = 4;
      comment.addEventListener('input', () => changed(question.id, 'comment', comment.value));
      controls.push({ element: comment, id: question.id, comment: true });
      fieldset.append(label, comment);
      byId('questions').append(fieldset);
    });
  }

  function syncInputs() {
    for (const control of controls) {
      if (!control.id) continue;
      const answer = answers[control.id];
      if (control.comment) control.element.value = answer.comment;
      else control.element.checked = answer.choice === control.choice;
    }
  }

  function hydrate(state) {
    saved = state;
    if (state.completedAt) saveError = '';
    answers = Object.create(null);
    state.packet.questions.forEach((question) => {
      const answer = Object.hasOwn(state.answers, question.id) ? state.answers[question.id] : null;
      answers[question.id] = { choice: answer?.choice ?? null, comment: answer?.comment ?? '' };
    });
    acknowledgedVersion = editVersion;
    byId('title').textContent = state.packet.title;
    byId('context').textContent = state.packet.context || '';
    buildQuestions(state.packet);
    syncInputs();
    if (!draftChecked && !hub) {
      draftChecked = true;
      try {
        const raw = sessionStorage.getItem(draftKey(state.packet.id));
        if (raw) {
          const candidate = JSON.parse(raw);
          const questions = state.packet.questions;
          const answerIds = Object.keys(candidate.answers || {});
          if (!Number.isSafeInteger(candidate.revision) ||
              answerIds.length !== questions.length ||
              questions.some(question => !Object.hasOwn(candidate.answers, question.id) ||
                !candidate.answers[question.id] ||
                typeof candidate.answers[question.id].comment !== 'string' ||
                (candidate.answers[question.id].choice !== null &&
                  !question.choices.some(choice => choice.value === candidate.answers[question.id].choice)))) {
            throw new Error('Invalid unsent copy');
          }
          if (JSON.stringify(candidate.packet) !== JSON.stringify(state.packet) ||
              JSON.stringify(candidate.evidenceIdentity) !== JSON.stringify(state.evidenceIdentity || null)) {
            byId('recovery-status').textContent = 'An unsent copy belongs to different review evidence. It was not loaded.';
          } else {
            pendingDraft = candidate;
            byId('restore-draft').hidden = false;
            byId('discard-draft').hidden = false;
            byId('recovery-status').textContent = 'Unsent edits from this tab are available. Restore or discard them.';
          }
        }
      } catch { byId('recovery-status').textContent = 'An unsent copy could not be checked. Saved answers remain unchanged.'; }
    }
  }

  function reconcile() {
    if (!latest || saving || completing || reloading) return;
    if (!saved || (!dirty() && !blocked)) hydrate(latest);
    else if (latest.revision !== saved.revision && !advanceUnchangedBaseline()) {
      blocked = latest.completedAt
        ? 'This review was completed elsewhere. Your unsaved answers remain here.'
        : 'The saved review changed while you were editing (possibly an agent message). Your unsaved answers remain here.';
    }
  }

  // Only revision/message changes can be rebased automatically. Human answers,
  // packet changes and completion must never be overwritten by a local draft.
  function advanceUnchangedBaseline() {
    if (!saved || !latest || latest.completedAt ||
        JSON.stringify(saved.packet) !== JSON.stringify(latest.packet)) return false;
    const canonicalAnswers = (value) => JSON.stringify(Object.keys(value).sort().map((id) => [id, value[id].choice, value[id].comment]));
    if (canonicalAnswers(saved.answers) !== canonicalAnswers(latest.answers)) return false;
    saved = latest;
    return true;
  }

  function renderStatus() {
    const status = byId('save-status');
    const complete = latest?.completedAt || saved?.completedAt;
    const isDirty = dirty();
    let text = 'Loading saved answers...';
    let tone = '';
    if (blocked) {
      text = `Saving blocked. ${blocked} Download current answers before reloading saved answers.`;
      tone = 'warning';
    } else if (saveError) {
      text = saveError;
      tone = 'warning';
    } else if (completing) text = 'Saving responses and recording completion...';
    else if (reloading) text = 'Loading saved answers...';
    else if (complete) {
      text = `Questionnaire completed at ${complete}. Responses are read-only. Completion does not mean acceptance.`;
      tone = 'success';
    } else if (saving) text = 'Saving... waiting for disk acknowledgment.';
    else if (isDirty) {
      text = 'Unsaved changes. Waiting for disk acknowledgment.';
      tone = 'warning';
    } else if (saved) {
      text = `Saved answers received from the server. Last updated: ${saved.updatedAt}.`;
      tone = 'success';
    }
    status.textContent = text;
    status.dataset.tone = tone;
    const locked = !saved || !!complete || completing || reloading;
    for (const control of controls) control.element.disabled = locked;
    byId('retry-save').disabled = locked || !!blocked || !isDirty || !!saving;
    byId('reload-saved').disabled = !saved || !!saving || completing || reloading;
    byId('download-unsaved').disabled = !saved;
    byId('complete-review').disabled = locked || !!blocked;
    byId('close-review').hidden = hub || !complete || isDirty;
    byId('open-review').disabled = !saved;
    if (saved) {
      const answered = saved.packet.questions.filter(({ id }) => {
        const answer = answers[id];
        return answer && (answer.choice !== null || answer.comment.trim().length > 0);
      }).length;
      byId('progress').textContent = `${answered} of ${saved.packet.questions.length} answered${isDirty ? ' (includes unsaved answers)' : ' (saved)'}`;
    }
  }

  function scheduleSave(delay) {
    clearTimeout(saveTimer);
    if (!hub && !blocked && !latest?.completedAt) saveTimer = setTimeout(() => { void flush(); }, delay);
  }

  function flush() {
    clearTimeout(saveTimer);
    if (saving) return saving;
    if (blocked || !saved || saved.completedAt || latest?.completedAt) return Promise.resolve(!dirty() && !blocked);
    if (!dirty()) return Promise.resolve(true);
    saving = (async () => {
      let conflictRetries = 0;
      try {
        while (dirty() && !blocked) {
          const sentVersion = editVersion;
          try {
            const state = await request('/api/answers', { expectedRevision: saved.revision, answers: copy(answers) });
            saved = state;
            acknowledgedVersion = sentVersion;
            if (!dirty()) clearDraft();
            else keepDraft();
            saveError = '';
            observe(state);
            if (dirty() && latest.revision !== saved.revision && !advanceUnchangedBaseline()) {
              blocked = 'The server has newer answers. Your remaining local edits were kept.';
            }
          } catch (error) {
            if (error.status === 409) {
              blocked = 'The server has a newer review. Your local answers were kept and have not been confirmed saved.';
              if (conflictRetries < 2) {
                try {
                  observe(await request('/api/state'));
                  if (advanceUnchangedBaseline()) {
                    blocked = '';
                    conflictRetries += 1;
                    continue;
                  }
                } catch { /* Keep the conflict blocked until the server can be checked. */ }
              }
            } else {
              saveError = 'Save not confirmed. Your answers remain in this page. Retrying shortly; you can also retry or download current answers.';
              scheduleSave(2500);
            }
            return false;
          }
        }
        return !dirty() && !blocked;
      } finally {
        saving = null;
        reconcile();
        renderStatus();
      }
    })();
    renderStatus();
    return saving;
  }

  async function poll() {
    if (polling || reloading) return;
    polling = true;
    try {
      observe(await request('/api/state'));
      reconcile();
    } catch {
      byId('connection').textContent = 'Connection unavailable. Last received messages are shown; local answers are retained.';
    } finally {
      polling = false;
      renderStatus();
    }
  }

  byId('retry-save').addEventListener('click', () => { void flush(); });
  byId('restore-draft').addEventListener('click', () => {
    if (!pendingDraft || !saved || saved.completedAt) return;
    answers = copy(pendingDraft.answers);
    editVersion += 1;
    if (pendingDraft.revision !== saved.revision) blocked = 'The server revision changed since these unsent edits. Download them and compare before reloading.';
    pendingDraft = null;
    byId('restore-draft').hidden = true;
    byId('discard-draft').hidden = true;
    byId('recovery-status').textContent = 'Unsent edits restored. They are not yet received by the server.';
    syncInputs();
    renderStatus();
    if (!blocked) scheduleSave(650);
    byId('save-status').focus();
  });
  byId('discard-draft').addEventListener('click', () => {
    pendingDraft = null;
    clearDraft();
    byId('restore-draft').hidden = true;
    byId('discard-draft').hidden = true;
    byId('recovery-status').textContent = 'Unsent copy discarded. Saved answers remain visible.';
    byId('save-status').focus();
  });
  byId('reload-saved').addEventListener('click', async () => {
    if (saving || completing || reloading) return;
    if (dirty() && !window.confirm('Replace your unsaved answers with the server copy? Download current answers first to keep them.')) return;
    reloading = true;
    clearTimeout(saveTimer);
    renderStatus();
    try {
      observe(await request('/api/state'));
      hydrate(latest);
      blocked = '';
      saveError = '';
      clearDraft();
      byId('save-status').focus();
    } catch {
      saveError = 'Reload failed. Your current answers remain here. Retry reload when the connection returns.';
    } finally {
      reloading = false;
      renderStatus();
    }
  });

  byId('download-unsaved').addEventListener('click', () => {
    if (!saved) return;
    const rescue = {
      schemaVersion: 1, packet: saved.packet, revision: saved.revision,
      answers: copy(answers), messages: latest.messages, completedAt: saved.completedAt,
      updatedAt: saved.updatedAt, exportedAt: new Date().toISOString(),
      unsaved: dirty(), savingBlocked: !!blocked, latestReceivedRevision: latest.revision,
      notice: 'Local rescue copy; this download is not a server receipt or acceptance.',
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(rescue, null, 2)], { type: 'application/json' }));
    const link = node('a');
    link.href = url;
    link.download = 'review-current-answers-rescue.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });

  function closeAcknowledgedReview() {
    if (hub || dirty() || !(saved?.completedAt || latest?.completedAt)) return;
    byId('completion-note').textContent = 'Responses received. If this window stays open, the browser prevented automatic closing. You may close this questionnaire tab manually. Completion does not mean acceptance.';
    try { window.close(); } catch { /* The visible fallback remains available. */ }
  }

  byId('complete-review').addEventListener('click', async () => {
    if (hub || !saved || completing || reloading || blocked || saved.completedAt || latest?.completedAt) return;
    completing = true;
    saveError = '';
    renderStatus();
    try {
      if (!await flush()) return;
      let state;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          state = await request('/api/complete', { expectedRevision: saved.revision });
          break;
        } catch (error) {
          if (error.status !== 409 || attempt === 2) throw error;
          observe(await request('/api/state'));
          if (!advanceUnchangedBaseline()) throw error;
        }
      }
      if (!state.completedAt) throw new Error('Completion was not acknowledged.');
      observe(state);
      hydrate(state);
      completing = false;
      closeAcknowledgedReview();
    } catch (error) {
      if (error.status === 409) blocked = 'The review changed before completion was recorded. Reload saved answers to review the current state.';
      else saveError = 'Completion not confirmed. Your answers remain here. Check the connection and try completing again.';
    } finally {
      completing = false;
      reconcile();
      renderStatus();
    }
  });
  byId('close-review').addEventListener('click', closeAcknowledgedReview);

  function checkChild() {
    if (!ownedChild) return;
    const closed = ownedChild.closed;
    byId('child-status').textContent = closed
      ? 'Cleanup confirmed: the questionnaire window opened by this hub is closed. Other tabs were not touched.'
      : 'The questionnaire window opened by this hub is still open. Cleanup has not been confirmed.';
    byId('open-review').textContent = closed ? 'Reopen questionnaire' : 'Focus questionnaire';
  }
  byId('open-review').addEventListener('click', () => {
    if (!hub || !saved) return;
    if (ownedChild && !ownedChild.closed) {
      ownedChild.focus();
    } else {
      ownedChild = window.open('/review', childName);
      if (!ownedChild) {
        byId('child-status').textContent = 'The browser blocked the questionnaire window. Allow pop-ups for this site and select Open questionnaire again.';
        return;
      }
    }
    checkChild();
  });
  window.addEventListener('beforeunload', (event) => {
    if (dirty() || saving || completing) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  setInterval(() => { checkChild(); void poll(); }, 2000);
  void poll();
}

function clientSource() {
  return `(${reviewClient.toString()})();\n`;
}

module.exports = { renderPage, clientSource };
