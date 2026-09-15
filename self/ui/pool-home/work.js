/** Presentation only. The application owns execution, persistence and review. */
import policy from '../../config/work-profile.json' with { type: 'json' };
import { LOCAL_DOPPLER_MODELS } from '../../config/doppler-local-models.js';

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const route = (path, label) => '<a href="' + path + '" data-pool-route-link="' + path + '">' + label + '</a>';
const links = () => '<nav class="pool-work-links" aria-label="Work resources">'
  + route('/examples', 'Explore examples') + route('/records', 'Peer jobs')
  + '<a href="/zero" data-pool-substrate-route="zero">Minimal agent</a></nav>';
const history = () => '<section class="pool-work-history"><h2 class="type-h2">Saved attempts</h2>'
  + '<p class="type-caption">Outcomes, pauses, and failures stay on this device. Retry creates a new attempt.</p>'
  + '<div data-work-history></div><button class="btn btn-ghost" type="button" data-work-export>Export local evidence</button></section>';

export function renderWorkSurface() {
  return [
    '<section class="pool-work-shell" data-work-surface aria-label="Work">',
    '<header class="pool-work-heading"><p class="pool-work-eyebrow">Reploid / Work</p>',
    '<h1>What would you like to accomplish?</h1>',
    '<p>Start with a goal. Choose intelligence. Keep the outcome and the evidence.</p></header>',
    '<div class="pool-work-grid"><div class="pool-work-primary">',
    '<form class="pool-work-composer" data-work-form>',
    '<label for="work-goal">Your goal</label>',
    '<textarea id="work-goal" data-work-goal rows="5" maxlength="' + policy.maxGoalCharacters
      + '" required placeholder="Describe a bounded problem, the constraints, and what a useful outcome looks like."></textarea>',
    '<div class="pool-work-starters" aria-label="Goal examples">',
    ...policy.examples.map((item, index) => '<button type="button" class="btn btn-ghost" data-work-example="'
      + index + '">' + escapeHtml(item.label) + '</button>'),
    '</div><div class="pool-work-settings">',
    '<label for="work-model">Intelligence<select id="work-model" data-work-model>',
    ...LOCAL_DOPPLER_MODELS.map(model => '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.name) + ' / local Doppler</option>'),
    '</select></label><div><strong>This device</strong><p class="type-caption">The first run may download model files. Your goal stays local.</p></div>',
    '</div><div class="pool-work-actions"><button class="btn btn-primary" type="submit" data-work-start>Start work</button>',
    '<button class="btn btn-ghost" type="button" data-work-cancel hidden>Pause</button>',
    '<span class="type-caption" data-work-budget></span></div></form>',
    '<p class="pool-work-status" role="status" aria-live="polite" data-work-status></p>',
    '<p class="pool-work-error" role="alert" data-work-error hidden></p>',
    '<section class="pool-work-output" data-work-output hidden><h2 class="type-h2">Outcome</h2>',
    '<p class="type-caption" data-work-review-status>Not reviewed</p><div data-work-answer></div>',
    '<div class="pool-work-actions"><button class="btn btn-ghost" type="button" data-work-accept>Accept outcome</button>',
    '<button class="btn btn-ghost" type="button" data-work-reject>Needs another attempt</button></div></section>',
    '<details class="pool-work-progress" data-work-progress hidden><summary>Agent progress</summary><pre data-work-draft></pre></details>',
    history(), '</div><aside class="pool-work-context"><h2 class="type-h2">Use the network deliberately</h2>',
    '<p>Share compute, inspect available models, and choose what this device may provide.</p>',
    route('/network', 'Open Network'),
    '<p class="type-caption">Whole jobs run on compatible peers. This local Work profile does not yet delegate its goal; the examples expose the existing approved peer workflows.</p>',
    '<hr><h2 class="type-h2">Improvement needs evidence</h2><p>Keep failed approaches. Compare candidates independently. Adopt only after review.</p>',
    route('/improve', 'Open Improve'), '</aside></div>', links(), '</section>'
  ].join('');
}

export function renderImproveSurface() {
  return [
    '<section class="pool-work-shell" data-work-surface aria-label="Improve">',
    '<header class="pool-work-heading"><p class="pool-work-eyebrow">Reploid / Improve</p>',
    '<h1>Make the next attempt better.</h1><p>Inspect what happened before changing how the agent works.</p></header>',
    '<div class="pool-work-proof-grid">',
    '<section><h2 class="type-h2">Attempts</h2><p>Goals, model identity, outcomes, checkpoints, and failures retained by Work.</p></section>',
    '<section><h2 class="type-h2">Independent evaluation</h2><p>No evaluator is connected to this Work profile. A user-accepted answer is not evidence of an improved agent.</p></section>',
    '<section><h2 class="type-h2">Adoption</h2><p>Nothing on this page rewrites or promotes the agent.</p>',
    '<a href="/x" data-pool-substrate-route="x">Open governed improvement workspace</a></section></div>',
    '<p class="pool-work-error" role="alert" data-work-error hidden></p>',
    '<section class="pool-work-output" data-work-output hidden><h2 class="type-h2">Selected outcome</h2>',
    '<p class="type-caption" data-work-review-status></p><div data-work-answer></div></section>',
    history(), links(), '</section>'
  ].join('');
}

export function bindWorkSurface(root, application) {
  if (!root.querySelector('[data-work-surface]')) return () => {};
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const find = selector => root.querySelector(selector);
  const error = value => {
    const element = find('[data-work-error]');
    element.textContent = String(value?.message || value || '');
    element.hidden = !element.textContent;
  };
  const act = operation => { Promise.resolve().then(operation).catch(error); };
  let historyIdentity = '';
  const unsubscribe = application.subscribe(state => {
    const row = state.records.find(item => item.id === state.selectedId);
    const status = find('[data-work-status]');
    if (status) status.textContent = state.activity;
    if (state.storageError) error(state.storageError);
    const form = find('[data-work-form]');
    if (form) {
      form.setAttribute('aria-busy', String(state.busy));
      for (const element of form.querySelectorAll('textarea,select,[data-work-example]')) element.disabled = state.busy;
      find('[data-work-start]').disabled = state.busy || !state.available || !!state.storageError;
      find('[data-work-cancel]').hidden = !state.busy;
      find('[data-work-budget]').textContent = state.cycle + ' / ' + state.maxCycles + ' steps';
      if (!state.available && status) status.textContent = 'This local profile needs a browser with WebGPU. Network and examples remain available.';
    }
    const output = find('[data-work-output]');
    output.hidden = !row?.output;
    find('[data-work-answer]').textContent = row?.output || '';
    find('[data-work-review-status]').textContent = !row?.review ? 'Not reviewed'
      : row.review.accepted ? 'Accepted by you. Not independently evaluated.' : 'Needs another attempt.';
    for (const button of root.querySelectorAll('[data-work-accept],[data-work-reject]')) button.disabled = state.busy || !row?.output;
    const progress = find('[data-work-progress]');
    if (progress) {
      progress.hidden = !state.draft;
      find('[data-work-draft]').textContent = state.draft;
    }
    const signature = JSON.stringify([state.busy, state.selectedId, state.records]);
    if (signature === historyIdentity) return;
    historyIdentity = signature;
    const list = find('[data-work-history]');
    list.replaceChildren();
    if (!state.records.length) {
      const empty = document.createElement('p');
      empty.className = 'type-caption';
      empty.textContent = 'No attempts yet. Start a goal in Work.';
      list.append(empty);
    }
    for (const attempt of [...state.records].reverse()) {
      const item = document.createElement('article');
      item.className = 'pool-work-attempt';
      const title = document.createElement('button');
      title.type = 'button'; title.className = 'pool-work-attempt-title';
      title.textContent = attempt.goal; title.dataset.workSelect = attempt.id;
      title.setAttribute('aria-pressed', String(attempt.id === state.selectedId));
      const metadata = document.createElement('p');
      metadata.className = 'type-caption';
      metadata.textContent = [attempt.status, attempt.modelName, new Date(attempt.createdAt).toLocaleString()].join(' / ');
      const retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'btn btn-ghost'; retry.textContent = 'Retry goal';
      retry.dataset.workRetry = attempt.id; retry.disabled = state.busy || !state.available;
      item.append(title, metadata, retry);
      if (attempt.error) {
        const failure = document.createElement('p');
        failure.className = 'pool-work-error'; failure.textContent = attempt.error; item.append(failure);
      }
      list.append(item);
    }
  });
  find('[data-work-form]')?.addEventListener('submit', event => {
    event.preventDefault(); error('');
    act(() => application.start({ goal: find('[data-work-goal]').value, modelId: find('[data-work-model]').value }));
  }, options);
  root.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control || !root.contains(control)) return;
    if (control.hasAttribute('data-work-example')) {
      const example = policy.examples[Number(control.dataset.workExample)];
      if (example) { find('[data-work-goal]').value = example.goal; find('[data-work-goal]').focus(); }
    } else if (control.hasAttribute('data-work-cancel')) application.cancel();
    else if (control.dataset.workSelect) application.select(control.dataset.workSelect);
    else if (control.dataset.workRetry) { error(''); act(() => application.retry(control.dataset.workRetry)); }
    else if (control.hasAttribute('data-work-accept') || control.hasAttribute('data-work-reject')) {
      act(() => application.review(application.getState().selectedId, control.hasAttribute('data-work-accept')));
    } else if (control.hasAttribute('data-work-export')) {
      const blob = new Blob([JSON.stringify(application.exportRecords(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'reploid-local-work.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }, options);
  return () => { controller.abort(); unsubscribe(); };
}
