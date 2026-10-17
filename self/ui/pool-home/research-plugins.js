import { createResearchPlugins } from '../../host/research-plugins.js';
import { escapeHtml } from '../components/attachments.js';

export const renderResearchPlugins = () => '<section class="pool-plugin-shell" data-plugin-root aria-label="Research plugins"></section>';

export function bindResearchPlugins(root, host, { storage = localStorage, locks = navigator.locks } = {}) {
  const surface = root.querySelector('[data-plugin-root]'), service = createResearchPlugins({ ...host, storage });
  let session = null, unsubscribe = () => {}, detached = false, release = null, owned = false;
  let error = '', latest = null, opening = false;
  let targetId = 'qwen-3-5-0-8b-q4k-ehaf16', imitatorId = 'qwen3-8-27b-text-q4k-ehaf16';
  const e = escapeHtml;
  const render = () => {
    if (detached) return;
    const view = session?.view(), content = view?.content;
    let body;
    if (!session) {
      const models = service.models();
      const available = id => models.some(model => model.id === id && service.recipients(model).length);
      const ready = available(targetId) && available(imitatorId) && targetId !== imitatorId;
      const options = preferred => models.map(model => `<option value="${e(model.id)}"${model.id === preferred ? ' selected' : ''}>${e(model.name)}${service.recipients(model).length ? '' : ' · waiting for capacity'}</option>`).join('');
      body = `<p>Can you distinguish a small model from a larger model imitating it?</p>
        <div class="pool-plugin-grid"><label>Target<select class="pool-input" data-study-target>${options(targetId)}</select></label>
        <label>Imitator<select class="pool-input" data-study-imitator>${options(imitatorId)}</select></label></div>
        <p class="pool-muted">Four blind rounds, including a same-model control. Two separate examples calibrate the imitation. All answers and follow-ups are prepared before judging, to hide execution speed.</p>
        <p class="pool-small pool-muted">Starting sends the public study prompts and responses to connected contributors serving these models. Up to 18 sequential requests; each has a 120-second deadline. Existing provider output limits apply. Results stay in this browser.</p>
        <details class="pool-small"><summary>Connected recipients</summary><ul>${models.flatMap(model => service.recipients(model).map(id => `<li>${e(model.name)}: ${e(id)}</li>`)).join('')}</ul></details>
        ${!ready ? `<p class="pool-small" role="status">${targetId === imitatorId ? 'Choose two different models.' : 'Waiting for available capacity for both selected models.'}</p>` : ''}
        <button class="pool-button" data-study-start${owned && ready && !opening ? '' : ' disabled'}>Allow and start</button>
        ${latest ? `<button class="pool-button" data-study-restore${owned && !opening ? '' : ' disabled'}>Open saved study</button>` : ''}`;
    } else if (content.phase === 'complete') {
      const trials = content.results.filter(row => row.condition !== 'same-model');
      const controls = content.results.filter(row => row.condition === 'same-model');
      body = `<h2>Study complete</h2><p>${trials.filter(row => row.correct).length}/${trials.length} imitation rounds identified.</p>
        <p>${controls.filter(row => !['same', 'unsure'].includes(row.judgment.choice)).length}/${controls.length} controls incorrectly called an imitation.</p>
        <p class="pool-muted">A four-round pilot cannot establish general detectability. Errors, identities and timing are included in the export.</p>
        <table><thead><tr><th>Task</th><th>Condition</th><th>Your choice</th><th>Actual</th></tr></thead><tbody>${content.results.map(row => `<tr><td>${e(row.task)}</td><td>${e(row.condition)}</td><td>${e(row.judgment.choice)}</td><td>${e(row.actual)}</td></tr>`).join('')}</tbody></table>`;
    } else if (view.status !== 'ready' && !view.busy) {
      body = `<h2>Study ${e(view.status)}</h2><p>The attempt is retained. It will not replay automatically.</p>`;
    } else if (content.phase === 'judging' && !view.busy) {
      body = `<p class="pool-small pool-muted">Round ${content.round} of ${content.total}</p><h2>${e(content.prompt)}</h2>
        ${content.followup ? `<p>Follow-up: ${e(content.followup)}</p>` : ''}
        <div class="pool-plugin-grid">${content.answers.map((answers, i) => `<article class="pool-surface pool-plugin-answer"><h3>${i ? 'B' : 'A'}</h3>${answers.map((text, turn) => `<p class="pool-small pool-muted">${turn ? 'Follow-up' : 'First answer'}</p><p class="pool-plugin-text">${e(text)}</p>`).join('')}</article>`).join('')}</div>
        <fieldset><legend>Which answer is the imitation?</legend>${['A', 'B', 'same', 'unsure'].map(value => `<label class="pool-plugin-choice"><input type="radio" name="judgment" value="${value}"> ${value === 'same' ? 'Both are the target' : value === 'unsure' ? 'Unsure' : value}</label>`).join('')}</fieldset>
        <label>Confidence <input data-study-confidence type="range" min="0" max="100" step="10" value="50"><output data-study-confidence-value>50%</output></label>
        <div class="pool-plugin-actions"><button class="pool-button" data-study-judge>Record judgment</button>${content.canFollowup ? '<button class="pool-button" data-study-followup>Ask the same follow-up</button>' : ''}</div>`;
    } else body = '<p role="status">Preparing the study…</p><p class="pool-small pool-muted">All transcripts are prepared before judging. Model identity and individual timing remain hidden.</p><button class="pool-button" data-study-stop>Stop</button>';
    surface.innerHTML = `<header><p class="pool-small pool-muted">Research plugin · Model imitation v1</p><h1 class="pool-title">Spot the imitation</h1></header>${body}
      <p role="alert" data-study-error${error ? '' : ' hidden'}>${e(error)}</p>
      ${session ? `<footer class="pool-plugin-actions">${!view.busy ? '<button class="pool-button" data-study-export>Export private record</button><button class="pool-button" data-study-new>New study</button>' : ''}</footer>` : ''}
      <details class="pool-small pool-muted"><summary>What this tests</summary><p>Prompt-only and example-assisted imitation of a specific model, including mistakes and recovery. Exact task correctness and identification are separate outcomes. Model size does not guarantee better answers. This built-in runs locally through Reploid; it is not an arbitrary plugin sandbox. Browser-local blinding hides clues from this screen, not from its owner using developer tools.</p></details>`;
    const run = async action => { error = ''; try { await action(); } catch (cause) { error = cause.message; } render(); };
    surface.querySelector('[data-study-target]')?.addEventListener('change', event => { targetId = event.target.value; render(); });
    surface.querySelector('[data-study-imitator]')?.addEventListener('change', event => { imitatorId = event.target.value; render(); });
    surface.querySelector('[data-study-start]')?.addEventListener('click', () => {
      if (opening || !owned) return;
      opening = true; surface.querySelector('[data-study-start]').disabled = true;
      void run(async () => { try {
        const opened = await service.create({ targetId, imitatorId, approved: true });
        if (detached) { await opened.close(); return; }
        attach(opened); await session.dispatch({ type: 'start' });
      } finally { opening = false; } });
    });
    surface.querySelector('[data-study-restore]')?.addEventListener('click', () => {
      if (opening || !owned) return;
      opening = true; render();
      void run(async () => { try {
        const opened = await service.restore();
        if (detached) { await opened?.close(); return; }
        if (opened) attach(opened);
      } finally { opening = false; } });
    });
    surface.querySelector('[data-study-stop]')?.addEventListener('click', () => session.cancel());
    surface.querySelector('[data-study-followup]')?.addEventListener('click', () => void run(() => session.dispatch({ type: 'followup' })));
    surface.querySelector('[data-study-judge]')?.addEventListener('click', () => {
      const choice = surface.querySelector('[name="judgment"]:checked')?.value;
      const confidence = Number(surface.querySelector('[data-study-confidence]').value);
      if (!choice) { error = 'Choose A, B, both target, or unsure.'; render(); return; }
      void run(() => session.dispatch({ type: 'judge', choice, confidence }));
    });
    surface.querySelector('[data-study-confidence]')?.addEventListener('input', event => {
      surface.querySelector('[data-study-confidence-value]').textContent = event.target.value + '%';
    });
    surface.querySelector('[data-study-new]')?.addEventListener('click', () => { unsubscribe(); session.close(); session = null; error = ''; render(); });
    surface.querySelector('[data-study-export]')?.addEventListener('click', () => {
      if (content.phase !== 'complete' && !window.confirm('This private export reveals assignments and answers. Exporting now breaks blinding for this study. Continue?')) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(session.export(), null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `reploid-study-${view.sessionId}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  };
  const attach = opened => { unsubscribe(); session?.close(); session = opened; latest = opened; unsubscribe = session.subscribe(render); };
  // Reuse the browser's ownership primitive: another tab cannot write or generate for this activity.
  if (locks?.request) void locks.request('reploid:research-plugins', { ifAvailable: true }, async lock => {
    if (!lock || detached) { error = 'Research is already open in another tab.'; render(); return; }
    owned = true;
    latest = storage.getItem('reploid.plugin-latest:model-imitation'); render();
    await new Promise(resolve => { release = resolve; });
  }).catch(cause => { error = cause.message; render(); });
  else error = 'This browser cannot acquire exclusive study storage.';
  const stopUpdates = host.chat.subscribe(() => { if (!session && !surface.contains(document.activeElement)) render(); });
  render();
  return () => { detached = true; unsubscribe(); stopUpdates(); void Promise.resolve(session?.close()).finally(() => release?.()); };
}
