/** Views request host actions; task execution and disclosure enforcement live in the host. */
import policy from '../../config/work-profile.json' with { type: 'json' };
import { LOCAL_DOPPLER_MODELS } from '../../config/doppler-local-models.js';
import { renderOperationSharing } from './operation-sharing.js';

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const route = (path, label) => '<a href="' + path + '" data-pool-route-link="' + path + '">' + label + '</a>';
const links = () => '<nav class="pool-work-links" aria-label="More in Reploid">'
  + route('/examples', 'Model examples') + route('/records', 'Peer job records')
  + '<a href="/zero" data-pool-substrate-route="zero">Minimal agent</a></nav>';
const history = () => '<section class="pool-work-history"><div class="pool-work-section-heading">'
  + '<h2 class="type-h2">Your work</h2><button class="btn btn-ghost" type="button" data-work-export>Export all evidence</button></div>'
  + '<div data-work-history></div></section>';
const approval = () => '<section class="pool-work-approval" data-work-approval hidden aria-labelledby="work-approval-title">'
  + '<h2 id="work-approval-title" class="type-h2">Review before sending</h2>'
  + '<p>The agent proposed a peer operation. Only the payload below will be sent; nothing has been sent yet.</p>'
  + '<p class="type-caption" data-work-approval-identity></p><pre data-work-approval-payload></pre>'
  + '<label class="pool-consent-row"><input type="checkbox" data-work-public><span>I approve sharing this exact input with this provider as public data.</span></label>'
  + '<div class="pool-work-actions"><button class="btn btn-primary" type="button" data-work-send disabled>Send this payload</button>'
  + '<button class="btn btn-ghost" type="button" data-work-decline>Keep it local</button></div></section>';
const outcome = () => '<section class="pool-work-output" data-work-output aria-label="Task result">'
  + '<div class="pool-work-section-heading"><h2 class="type-h2">Result</h2><span class="type-caption" data-work-review-status></span></div>'
  + '<p class="type-caption" data-work-result-criteria></p><div data-work-answer></div>'
  + '<div class="pool-work-artifacts" data-work-artifacts></div>'
  + '<div class="pool-work-actions" data-work-review-actions hidden>'
  + '<button class="btn btn-ghost" type="button" data-work-accept>Accept result</button>'
  + '<button class="btn btn-ghost" type="button" data-work-reject>Needs changes</button>'
  + '<button class="btn btn-ghost" type="button" data-work-revise-selected>Revise with feedback</button></div>'
  + '<details class="pool-work-progress" data-work-progress><summary>Activity &amp; checks</summary>'
  + '<ol data-work-events></ol><pre data-work-draft></pre></details></section>';

export function renderWorkSurface() {
  return [
    '<section class="pool-work-shell" data-work-surface aria-label="Work">',
    '<p class="pool-work-error" role="alert" data-work-error hidden></p>',
    '<div class="pool-work-grid"><div class="pool-work-primary">',
    '<form class="pool-work-composer" data-work-form>',
    '<label for="work-goal">Goal</label><textarea id="work-goal" data-work-goal rows="4" maxlength="' + policy.maxGoalCharacters
      + '" required placeholder="What do you want accomplished?"></textarea>',
    '<label for="work-criteria">A useful result must...</label>',
    '<textarea id="work-criteria" data-work-criteria rows="2" maxlength="' + policy.maxCriteriaCharacters
      + '" required placeholder="Name the deliverable, constraints, and checks that matter."></textarea>',
    '<div class="pool-work-inputs"><label for="work-files">Working material <span class="type-caption">optional, stays on this device</span></label>',
    '<input id="work-files" type="file" multiple accept=".txt,.md,.csv,.json,.js,.ts,.html,.css,.wgsl,.xml,.yaml,.yml,.log" data-work-files>',
    '<p class="type-caption">UTF-8 text or source files. Up to ' + policy.files.maxInputs + ' files, '
      + (policy.files.maxInputBytes / 1024) + ' KiB total. No automatic code execution.</p>',
    '<ul data-work-input-list></ul><button class="btn btn-ghost" type="button" data-work-clear-inputs hidden>Remove files</button></div>',
    '<div data-work-revision hidden><label for="work-feedback">What should change from the earlier attempt?</label>',
    '<textarea id="work-feedback" data-work-feedback rows="2" maxlength="' + policy.maxFeedbackCharacters + '"></textarea>'
      + '<p class="type-caption">The earlier outcome, your feedback, and the supplied files become context for a new attempt. The original stays intact.</p></div>',
    '<details class="pool-work-settings"><summary>Model &amp; permissions</summary>',
    '<label for="work-model">Local model<select id="work-model" data-work-model>',
    ...LOCAL_DOPPLER_MODELS.map(model => '<option value="' + escapeHtml(model.id) + '">' + escapeHtml(model.name) + ' / Doppler</option>'),
    '</select></label><p class="type-caption">First use downloads model weights. Model computation runs on this device.</p>',
    '<label class="pool-consent-row"><input type="checkbox" data-work-peers><span>Let the agent propose peer assistance. Ask me before every payload is sent.</span></label>',
    '<label class="pool-consent-row"><input type="checkbox" data-work-recall><span>Allow recall of earlier results I accepted on this device.</span></label></details>',
    '<div class="pool-work-actions"><button class="btn btn-primary" type="submit" data-work-start>Start work</button>',
    '<button class="btn btn-ghost" type="button" data-work-cancel hidden>Stop work</button>',
    '<button class="btn btn-ghost" type="button" data-work-new>New task</button></div></form>',
    '<div class="pool-work-section-heading"><p class="pool-work-status" role="status" aria-live="polite" data-work-status></p>',
    '<span class="type-caption" data-work-budget></span></div></div>',
    '<div class="pool-work-results">', outcome(), '</div>', approval(), '</div>',
    history(), links(), '</section>'
  ].join('');
}

export function renderNetworkSurface() {
  return '<section class="pool-work-shell" data-work-surface aria-label="Network">'
    + '<p class="pool-work-error" role="alert" data-work-error hidden></p>'
    + '<div class="pool-work-grid pool-network-grid">'
    + '<section class="pool-control-panel" aria-labelledby="network-provide-title">'
    + '<h2 class="type-h2" id="network-provide-title">Provide compute</h2>'
    + renderOperationSharing() + '</section>'
    + '<section class="pool-control-panel" aria-labelledby="network-request-title">'
    + '<h2 class="type-h2" id="network-request-title">Request assistance</h2>'
    + '<div class="pool-control-stack">'
    + '<p class="pool-control-help">Discovery sends no task inputs. An available model is not a connected, qualified executor.</p>'
    + '<div class="pool-control-actions">'
    + '<button class="btn btn-ghost" type="button" data-work-discover>Find compatible peers</button>'
    + '<p class="pool-control-status" role="status" aria-live="polite" data-work-peer-status>Discovery has not run.</p></div>'
    + '<div class="pool-control-group" data-work-peer-models></div>'
    + '<div class="pool-control-footer">'
    + route('/', 'Use approved peer operations from a task') + '</div></div></section></div>'
    + '<aside class="pool-network-notes" aria-label="Sharing boundaries">'
    + '<p class="pool-control-help">Execution, artifact distribution, and improvement adoption have separate permissions.</p>'
    + '<p class="pool-control-help">These controls offer whole operations, not a model split across GPUs. '
    + route('/compute', 'Legacy sequence provider controls') + ' remain available.</p></aside>'
    + approval() + links() + '</section>';
}

export function renderImproveSurface() {
  return '<section class="pool-work-shell" data-work-surface aria-label="Improve">'
    + '<p class="pool-work-error" role="alert" data-work-error hidden></p>'
    + '<section class="pool-work-comparison" data-work-comparison hidden><h2 class="type-h2">Earlier attempt</h2>'
    + '<p data-work-parent-feedback></p><pre data-work-parent-output></pre></section>'
    + outcome() + history()
    + '<aside class="pool-work-boundary"><h2 class="type-h2">Changing the agent is a separate decision.</h2>'
    + '<p>Task revisions and your acceptance are not independent evaluation or proof of recursive improvement. '
    + 'This view does not alter the agent or adopt candidate code.</p>'
    + '<a href="/x" data-pool-substrate-route="x">Open governed improvement workspace</a></aside>'
    + links() + '</section>';
}

const download = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export function bindWorkSurface(root, application) {
  if (!root.querySelector('[data-work-surface]')) return () => {};
  const controller = new AbortController(), options = { signal: controller.signal };
  const find = selector => root.querySelector(selector);
  const setText = (selector, text) => { const node = find(selector); if (node) node.textContent = text; };
  const error = value => {
    const node = find('[data-work-error]');
    node.textContent = String(value?.message || value || '');
    node.hidden = !node.textContent;
  };
  const act = operation => { Promise.resolve().then(operation).catch(error); };
  let inputs = [], parentId = null, reading = false, fileRevision = 0, approvalId = null;
  let historyIdentity = '', resultIdentity = '', lastState = null;
  const form = find('[data-work-form]');
  const showInputs = items => {
    const list = find('[data-work-input-list]');
    if (!list) return;
    list.replaceChildren();
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item.name + ' / ' + (item.bytes ?? new TextEncoder().encode(item.text).byteLength) + ' bytes';
      list.append(li);
    }
    find('[data-work-clear-inputs]').hidden = !items.length;
  };
  const fillDraft = draft => {
    if (!form) return;
    parentId = draft.parentId; inputs = draft.inputs;
    find('[data-work-goal]').value = draft.goal;
    find('[data-work-criteria]').value = draft.criteria;
    find('[data-work-model]').value = draft.modelId;
    find('[data-work-feedback]').value = draft.feedback;
    find('[data-work-feedback]').required = !!parentId;
    find('[data-work-revision]').hidden = !parentId;
    find('[data-work-peers]').checked = false; find('[data-work-recall]').checked = false;
    showInputs(inputs);
  };
  const revise = id => {
    const draft = application.prepareRevision(id);
    if (form) { fillDraft(draft); find('[data-work-feedback]').focus(); }
    else {
      const link = document.createElement('a');
      link.href = '/'; link.dataset.poolRouteLink = '/';
      root.append(link); link.click(); link.remove();
    }
  };
  const render = state => {
    lastState = state;
    const row = state.records.find(item => item.id === state.selectedId);
    setText('[data-work-status]', state.activity);
    if (state.storageError) error(state.storageError);
    if (form) {
      form.setAttribute('aria-busy', String(state.busy || reading));
      for (const node of form.querySelectorAll('input,textarea,select,[data-work-new],[data-work-clear-inputs]')) node.disabled = state.busy || reading;
      find('[data-work-start]').disabled = state.busy || reading || !state.available || !!state.storageError;
      find('[data-work-cancel]').hidden = !state.busy;
      setText('[data-work-budget]', state.cycle + ' / ' + state.maxCycles + ' steps');
      if (!state.available) setText('[data-work-status]', 'Local work requires WebGPU. You can still inspect results and discover peer capabilities.');
      if (state.busy) showInputs(state.records.find(item => item.id === state.activeId)?.inputs || []);
    }
    const pending = state.pendingApproval;
    const approvalPanel = find('[data-work-approval]');
    if (approvalPanel) {
      approvalPanel.hidden = !pending;
      if (pending && pending.id !== approvalId) {
        approvalId = pending.id;
        find('[data-work-public]').checked = false;
        setText('[data-work-approval-identity]', pending.operation + ' / ' + pending.modelId
          + '\nProvider: ' + pending.providerId + '\nExact model: ' + pending.modelIdentity
          + '\nApproval expires: ' + new Date(pending.expiresAt).toLocaleTimeString());
        setText('[data-work-approval-payload]', JSON.stringify({ input: pending.input, options: pending.options, limits: pending.limits }, null, 2));
      }
      if (!pending) approvalId = null;
      find('[data-work-send]').disabled = !pending || !find('[data-work-public]').checked;
    }
    const discover = find('[data-work-discover]');
    if (discover) {
      discover.disabled = state.discovering;
      if (state.discovering) setText('[data-work-peer-status]', 'Checking exact executable capabilities...');
      else if (state.peerDiscoveryCompleted) setText('[data-work-peer-status]', state.peerModels.some(item => item.available)
        ? 'Compatible offers found. Each task still requires your payload approval.'
        : 'No compatible peer is currently offering an admitted operation.');
      const list = find('[data-work-peer-models]');
      list.replaceChildren();
      for (const model of state.peerModels) {
        const item = document.createElement('p');
        item.textContent = model.modelId + ' / ' + model.operation + ' / '
          + (model.available ? 'compatible offer from ' + model.providerId : 'no compatible offer');
        list.append(item);
      }
    }
    if (find('[data-work-output]')) {
      setText('[data-work-draft]', state.draft);
      const identity = JSON.stringify([row, state.busy]);
      if (identity !== resultIdentity) {
        resultIdentity = identity;
        setText('[data-work-answer]', row?.output || (state.busy ? 'Work is in progress. No outcome has been recorded yet.'
          : row ? 'This attempt did not deliver an outcome. Its activity and failure record are retained.'
            : 'The result and downloadable files will appear here.'));
        setText('[data-work-result-criteria]', row?.criteria ? 'Success criteria: ' + row.criteria : '');
        setText('[data-work-review-status]', !row?.output ? '' : !row.review ? 'Needs your review'
          : row.review.accepted ? 'Accepted by you' : 'Changes requested');
        find('[data-work-review-actions]').hidden = !row?.output;
        for (const button of root.querySelectorAll('[data-work-accept],[data-work-reject],[data-work-revise-selected]')) button.disabled = state.busy;
        const artifacts = find('[data-work-artifacts]');
        artifacts.replaceChildren();
        for (const artifact of row?.artifacts || []) {
          const item = document.createElement('div'), button = document.createElement('button'), meta = document.createElement('p');
          button.type = 'button'; button.className = 'btn btn-ghost';
          button.textContent = 'Download ' + artifact.name; button.dataset.workArtifact = artifact.id;
          meta.className = 'type-caption';
          meta.textContent = artifact.bytes + ' bytes / ' + (artifact.inspection
            ? artifact.inspection.checks.map(check => check.name + ': ' + (check.passed ? 'pass' : 'fail')).join(', ') : 'not inspected');
          if (artifact.inspection) meta.title = artifact.inspection.scope + ' SHA-256: ' + artifact.inspection.sha256;
          item.append(button, meta); artifacts.append(item);
        }
        const events = find('[data-work-events]');
        events.replaceChildren();
        for (const event of row?.events || []) {
          const li = document.createElement('li');
          li.textContent = event.tool + ' / ' + event.status + (event.error ? ': ' + event.error : '');
          events.append(li);
        }
        const comparison = find('[data-work-comparison]');
        if (comparison) {
          const parent = state.records.find(item => item.id === row?.parentId);
          comparison.hidden = !parent;
          setText('[data-work-parent-output]', parent?.output || parent?.error || 'No outcome was delivered.');
          setText('[data-work-parent-feedback]', row?.feedback ? 'Requested change: ' + row.feedback : '');
        }
      }
    }
    const list = find('[data-work-history]');
    if (!list) return;
    const signature = JSON.stringify([state.busy, state.selectedId, state.records]);
    if (signature === historyIdentity) return;
    historyIdentity = signature; list.replaceChildren();
    if (!state.records.length) {
      const empty = document.createElement('p'); empty.className = 'type-caption';
      empty.textContent = 'No saved work yet. Completed, failed, and stopped attempts will stay here.'; list.append(empty);
    }
    for (const attempt of [...state.records].reverse()) {
      const item = document.createElement('article'), title = document.createElement('button');
      item.className = 'pool-work-attempt';
      title.type = 'button'; title.className = 'pool-work-attempt-title';
      title.textContent = attempt.goal; title.dataset.workSelect = attempt.id;
      title.setAttribute('aria-pressed', String(attempt.id === state.selectedId));
      const metadata = document.createElement('p'), button = document.createElement('button');
      metadata.className = 'type-caption';
      metadata.textContent = [attempt.status, attempt.modelName, new Date(attempt.createdAt).toLocaleString(),
        attempt.parentId ? 'revision of an earlier attempt' : 'original attempt'].join(' / ');
      button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = 'Revise with feedback';
      button.dataset.workRevise = attempt.id; button.disabled = state.busy || !state.available;
      item.append(title, metadata, button);
      if (attempt.error) {
        const failure = document.createElement('p'); failure.className = 'pool-work-error';
        failure.textContent = attempt.error; item.append(failure);
      }
      list.append(item);
    }
  };
  const draft = application.getDraft();
  if (draft) fillDraft(draft);
  const unsubscribe = application.subscribe(render);
  find('[data-work-files]')?.addEventListener('change', async event => {
    const revision = ++fileRevision, selected = Array.from(event.target.files);
    reading = true; error(''); render(application.getState());
    try {
      if (selected.length > policy.files.maxInputs
        || selected.some(file => file.size > policy.files.maxFileBytes)
        || selected.reduce((sum, file) => sum + file.size, 0) > policy.files.maxInputBytes) throw new Error('Files exceed the displayed task allowance');
      const loaded = [];
      for (const file of selected) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        if (controller.signal.aborted || revision !== fileRevision) return;
        if (text.includes('\u0000')) throw new Error('Choose text or source files, not binary files');
        loaded.push({ name: file.name, text, bytes: new TextEncoder().encode(text).byteLength });
      }
      inputs = loaded; showInputs(inputs);
    } catch (cause) {
      inputs = []; event.target.value = ''; showInputs(inputs);
      if (!controller.signal.aborted) error(cause);
    } finally {
      reading = false;
      if (!controller.signal.aborted && revision === fileRevision) render(application.getState());
    }
  }, options);
  form?.addEventListener('submit', event => {
    event.preventDefault(); error('');
    if (reading) return;
    const request = { goal: find('[data-work-goal]').value, criteria: find('[data-work-criteria]').value,
      modelId: find('[data-work-model]').value, inputs, parentId, feedback: find('[data-work-feedback]').value,
      allowPeers: find('[data-work-peers]').checked, recallAccepted: find('[data-work-recall]').checked };
    act(() => application.start(request));
  }, options);
  find('[data-work-public]')?.addEventListener('change', () => render(application.getState()), options);
  root.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control || !root.contains(control)) return;
    act(async () => {
      if (control.hasAttribute('data-work-cancel')) application.cancel();
      else if (control.dataset.workSelect) application.select(control.dataset.workSelect);
      else if (control.dataset.workRevise) revise(control.dataset.workRevise);
      else if (control.hasAttribute('data-work-revise-selected')) revise(lastState.selectedId);
      else if (control.hasAttribute('data-work-new')) {
        fileRevision++; parentId = null; inputs = []; form.reset(); showInputs([]);
        find('[data-work-revision]').hidden = true; find('[data-work-feedback]').required = false;
        application.clearDraft(); error(''); find('[data-work-goal]').focus();
      } else if (control.hasAttribute('data-work-clear-inputs')) {
        fileRevision++; inputs = []; find('[data-work-files]').value = ''; showInputs([]);
      } else if (control.hasAttribute('data-work-send')) {
        if (!find('[data-work-public]').checked) throw new Error('Approve the exact public payload first');
        application.approvePeer(approvalId, true);
      } else if (control.hasAttribute('data-work-decline')) application.approvePeer(approvalId, false);
      else if (control.hasAttribute('data-work-discover')) { error(''); await application.discoverPeers(); }
      else if (control.hasAttribute('data-work-accept') || control.hasAttribute('data-work-reject')) {
        await application.review(lastState.selectedId, control.hasAttribute('data-work-accept'));
      } else if (control.dataset.workArtifact) {
        const artifact = application.getArtifact(lastState.selectedId, control.dataset.workArtifact);
        download(artifact.name, artifact.text, 'text/plain;charset=utf-8');
      } else if (control.hasAttribute('data-work-export')) {
        download('reploid-work-evidence.json', JSON.stringify(application.exportRecords(), null, 2), 'application/json');
      }
    });
  }, options);
  return () => { fileRevision++; controller.abort(); unsubscribe(); };
}
