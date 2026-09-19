/**
 * Views request host actions; task execution and disclosure enforcement live in the host.
 * Refactored into decomposed sub-components within a centered reading layout.
 */
import policy from '../../config/work-profile.json' with { type: 'json' };
import { DEFAULT_WORK_MODELS, deriveOutcomeTags } from '../../host/work-session.js';
import { renderOperationSharing } from './operation-sharing.js';
import { renderGoalComposer } from './work-goal-composer.js';
import { renderTaskHeader } from './work-task-header.js';
import { renderActivityList } from './work-activity-list.js';
import { renderResultView } from './work-result-view.js';
import { renderApprovalPanel } from './work-approval-panel.js';
import { renderTaskHistory } from './work-task-history.js';

export {
  renderGoalComposer,
  renderTaskHeader,
  renderActivityList,
  renderResultView,
  renderApprovalPanel,
  renderTaskHistory
};

export function renderZeroCallout() {
  return [
    '<aside class="pool-work-zero-callout" aria-label="Zero autonomous agent">',
    '  <div class="pool-work-zero-badge-row">',
    '    <span class="pool-zero-pill">ZERO</span>',
    '    <span class="pool-work-zero-desc">Autonomous browser agent</span>',
    '  </div>',
    '  <div class="pool-work-zero-content">',
    '    <h2 class="pool-work-zero-title"><a href="/zero" class="pool-work-zero-link" data-pool-substrate-route="zero">Reploid Zero</a></h2>',
    '    <p class="type-caption pool-work-zero-subtext">Autonomous tabula-rasa loop that synthesizes and tests its own tools in browser storage.</p>',
    '  </div>',
    '  <a href="/zero" class="btn btn-primary pool-work-zero-btn" data-pool-substrate-route="zero">Launch Zero &rarr;</a>',
    '</aside>'
  ].join('\n');
}

const route = (path, label) => '<a href="' + path + '" data-pool-route-link="' + path + '">' + label + '</a>';
const links = () => '<nav class="pool-work-links" aria-label="More in Reploid">'
  + route('/examples', 'Model examples') + route('/records', 'Peer job records')
  + '<span class="pool-work-experiment-links">Experiments: <a href="/zero" data-pool-substrate-route="zero">Zero</a>'
  + ' <a href="/x" data-pool-substrate-route="x">X</a></span></nav>';

export function renderWorkSurface() {
  return [
    '<section class="pool-work-shell" data-work-surface aria-label="Work">',
    '  <p class="pool-work-error" role="alert" data-work-error hidden></p>',
    '  <div class="pool-work-column">',
    renderTaskHeader(),
    renderGoalComposer({ models: DEFAULT_WORK_MODELS }),
    renderApprovalPanel(),
    renderResultView(),
    renderTaskHistory(),
    links(),
    '  </div>',
    '</section>'
  ].join('\n');
}

export function renderNetworkSurface() {
  return '<section class="pool-work-shell" data-work-surface aria-label="Network">'
    + '<p class="pool-work-error" role="alert" data-work-error hidden></p>'
    + '<header class="pool-work-hero"><h1 class="pool-work-hero-title">Give or get a hand.</h1>'
    + '<p class="pool-work-promise">Share this device\'s AI compute, or find another device that can help with a task. You choose what to share.</p></header>'
    + '<div class="pool-work-grid pool-network-grid">'
    + '<section class="pool-control-panel" aria-labelledby="network-provide-title">'
    + '<h2 class="type-h2" id="network-provide-title">Provide compute</h2>'
    + '<p class="pool-control-help">Let this device run public jobs for others. Sharing stays off until you turn it on.</p>'
    + renderOperationSharing() + '</section>'
    + '<section class="pool-control-panel" aria-labelledby="network-request-title">'
    + '<h2 class="type-h2" id="network-request-title">Request assistance</h2>'
    + '<div class="pool-control-stack">'
    + '<p class="pool-control-help">See what other devices can run. Looking for peers sends no task inputs; each job needs your approval.</p>'
    + '<div class="pool-control-actions">'
    + '<button class="btn btn-ghost" type="button" data-work-discover>Find compatible peers</button>'
    + '<p class="pool-control-status" role="status" aria-live="polite" data-work-peer-status>Discovery has not run.</p></div>'
    + '<div class="pool-control-group" data-work-peer-models></div>'
    + '<div class="pool-control-footer">'
    + route('/', 'Start a task with peer assistance') + '</div></div></section></div>'
    + '<details class="pool-network-notes"><summary>How sharing works</summary>'
    + '<p class="pool-control-help">Execution, artifact distribution, and improvement adoption have separate permissions.</p>'
    + '<p class="pool-control-help">These controls offer whole operations, not a model split across GPUs. '
    + route('/compute', 'Legacy sequence provider controls') + ' remain available.</p></details>'
    + renderApprovalPanel() + links() + '</section>';
}

export function renderImproveSurface() {
  return '<section class="pool-work-shell" data-work-surface aria-label="Improve">'
    + '<p class="pool-work-error" role="alert" data-work-error hidden></p>'
    + '<div class="pool-work-column">'
    + '<header class="pool-work-hero"><h1 class="pool-work-hero-title">Review what worked.</h1>'
    + '<p class="pool-work-promise">Revisit saved results, ask for changes, and compare attempts. Changes to the agent itself need separate evaluation.</p></header>'
    + '<div class="pool-work-empty" data-work-empty hidden><h2 class="type-h2">No work to review yet.</h2>'
    + '<p>Start a task, then come back to review its result or try a revision.</p>' + route('/', 'Start your first task') + '</div>'
    + '<section class="pool-work-comparison" data-work-comparison hidden><h2 class="type-h2">Earlier attempt</h2>'
    + '<p data-work-parent-feedback></p><pre data-work-parent-output></pre></section>'
    + renderResultView() + renderTaskHistory()
    + '<aside class="pool-work-boundary"><h2 class="type-h2">Changing the agent is a separate decision.</h2>'
    + '<p>Task revisions and your acceptance are not independent evaluation or proof of recursive improvement. '
    + 'This view does not alter the agent or adopt candidate code.</p>'
    + '<a href="/x" data-pool-substrate-route="x">Open governed improvement workspace</a></aside>'
    + links() + '</div></section>';
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
    if (node) {
      node.textContent = String(value?.message || value || '');
      node.hidden = !node.textContent;
    }
  };
  const act = operation => { Promise.resolve().then(operation).catch(error); };
  let inputs = [], parentId = null, reading = false, fileRevision = 0, approvalId = null;
  let historyIdentity = '', resultIdentity = '', lastState = null;
  let showSelected = true;
  const form = find('[data-work-form]');
  const showInputs = items => {
    setText('[data-work-file-count]', items.length ? items.length + ' attached' : 'optional');
    const list = find('[data-work-input-list]');
    if (!list) return;
    list.replaceChildren();
    for (const item of items) {
      const li = document.createElement('li');
      li.textContent = item.name + ' / ' + (item.bytes ?? new TextEncoder().encode(item.text).byteLength) + ' bytes';
      list.append(li);
    }
    const clearBtn = find('[data-work-clear-inputs]');
    if (clearBtn) clearBtn.hidden = !items.length;
  };
  const updateModelDescription = modelId => {
    if (!modelId) return;
    const model = (lastState?.models || DEFAULT_WORK_MODELS).find(item => item.id === modelId);
    setText('[data-work-location]', model?.provider === 'gemini'
      ? 'Cloud model: your task and files may be sent to this provider. Peer sharing still requires your approval.'
      : 'On-device model: may download on first use. Peer sharing is off unless you enable and approve it.');
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
    updateModelDescription(draft.modelId);
  };
  const revise = id => {
    const draft = application.prepareRevision(id);
    if (form) {
      showSelected = false; fillDraft(draft); render(application.getState());
      find('[data-work-feedback]').focus();
    }
    else {
      const link = document.createElement('a');
      link.href = '/'; link.dataset.poolRouteLink = '/';
      root.append(link); link.click(); link.remove();
    }
  };
  const render = state => {
    lastState = state;
    if (state.busy) showSelected = true;
    const row = showSelected ? state.records.find(item => item.id === state.selectedId) : null;
    setText('[data-work-status]', state.activity);
    if (state.storageError) error(state.storageError);
    const currentModel = find('[data-work-model]')?.value;
    if (currentModel) updateModelDescription(currentModel);
    const output = find('[data-work-output]');
    if (output) output.hidden = !row && !state.busy;
    const composer = find('.pool-work-composer-shell');
    if (composer) composer.hidden = !!row || state.busy;
    const history = find('.pool-work-history');
    if (history) history.hidden = !state.records.length;
    const empty = find('[data-work-empty]');
    if (empty) empty.hidden = !!state.records.length || state.busy;
    for (const button of root.querySelectorAll('[data-work-new]')) button.hidden = !row || state.busy;

    // Mode calculation
    const surface = find('[data-work-surface]');
    const mode = state.pendingApproval ? 'approval' : state.busy ? 'during' : row?.output ? 'after' : 'before';
    surface?.setAttribute('data-work-mode', mode);

    // Task Header
    const taskHeader = find('[data-work-task-header]');
    if (taskHeader) {
      taskHeader.hidden = !state.busy && !row;
      setText('[data-work-active-goal]', row?.goal || (state.busy ? 'Active task' : ''));
      setText('[data-work-active-model]', row?.modelName || '');
    }

    if (form) {
      form.setAttribute('aria-busy', String(state.busy || reading));
      for (const node of form.querySelectorAll('input,textarea,select,[data-work-new],[data-work-clear-inputs],[data-goal-preset]')) node.disabled = state.busy || reading;
      find('[data-work-start]').disabled = state.busy || reading || !state.available || !!state.storageError;
      for (const btn of root.querySelectorAll('[data-work-cancel]')) btn.hidden = !state.busy;
      setText('[data-work-budget]', state.cycle + ' / ' + state.maxCycles + ' steps');
      if (!state.available) setText('[data-work-status]', 'Local work requires WebGPU. You can still inspect results and discover peer capabilities.');
      const startStatus = find('[data-work-start-status]');
      if (startStatus) {
        startStatus.hidden = state.available && !reading;
        startStatus.textContent = reading ? 'Reading your files...'
          : 'No model is available in this browser. Check the selected model or use a supported browser.';
      }
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

        // Render outcome tags
        const tagsContainer = find('[data-work-outcome-tags]');
        if (tagsContainer) {
          tagsContainer.replaceChildren();
          const tags = row?.outcomeTags || deriveOutcomeTags(row);
          for (const tag of tags) {
            const badge = document.createElement('span');
            badge.className = 'pool-work-badge ' + (
              tag === 'JSON validated' ? 'pool-work-badge--json' :
              tag === 'Patch drafted' ? 'pool-work-badge--patch' :
              tag === 'Needs execution' ? 'pool-work-badge--execution' :
              'pool-work-badge--status'
            );
            badge.textContent = tag;
            tagsContainer.append(badge);
          }
        }

        // Render artifacts
        const artifacts = find('[data-work-artifacts]');
        artifacts.replaceChildren();
        for (const artifact of row?.artifacts || []) {
          const item = document.createElement('div'), button = document.createElement('button'), meta = document.createElement('p');
          item.className = 'pool-work-artifact-item';
          button.type = 'button'; button.className = 'btn btn-ghost';
          button.textContent = 'Download ' + artifact.name; button.dataset.workArtifact = artifact.id;
          meta.className = 'type-caption';
          meta.textContent = artifact.bytes + ' bytes / ' + (artifact.inspection
            ? artifact.inspection.checks.map(check => check.name + ': ' + (check.passed ? 'pass' : 'fail')).join(', ') : 'not inspected');
          if (artifact.inspection) meta.title = artifact.inspection.scope + ' SHA-256: ' + artifact.inspection.sha256;
          item.append(button, meta); artifacts.append(item);
        }

        // Render audit metadata
        const auditMeta = find('[data-work-audit-metadata]');
        if (auditMeta) {
          auditMeta.replaceChildren();
          if (row) {
            const metaContainer = document.createElement('div');
            metaContainer.className = 'pool-work-meta-list';
            const pId = document.createElement('p'); pId.className = 'type-caption';
            pId.textContent = 'Attempt ID: ' + row.id + ' | Model: ' + row.modelName + ' (' + row.modelId + ')';
            metaContainer.append(pId);
            for (const artifact of row.artifacts || []) {
              if (artifact.inspection?.sha256) {
                const pDigest = document.createElement('p'); pDigest.className = 'type-caption pool-work-hash';
                pDigest.textContent = artifact.name + ' SHA-256: ' + artifact.inspection.sha256;
                metaContainer.append(pDigest);
              }
            }
            auditMeta.append(metaContainer);
          }
        }

        // Render events
        const events = find('[data-work-events]');
        if (events) {
          events.replaceChildren();
          for (const event of row?.events || []) {
            const li = document.createElement('li');
            li.textContent = event.tool + ' / ' + event.status + (event.error ? ': ' + event.error : '');
            events.append(li);
          }
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
    const signature = JSON.stringify([showSelected, state.busy, state.selectedId, state.records]);
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
      title.setAttribute('aria-pressed', String(showSelected && attempt.id === state.selectedId));
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
  if (draft) { showSelected = false; fillDraft(draft); }
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
  find('[data-work-model]')?.addEventListener('change', event => updateModelDescription(event.target.value), options);
  root.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control || !root.contains(control)) return;
    act(async () => {
      if (control.dataset.goalPreset) {
        const preset = control.dataset.goalPreset;
        const goalInput = find('[data-work-goal]');
        const criteriaInput = find('[data-work-criteria]');
        if (preset === 'patch') {
          if (goalInput) goalInput.value = 'Analyze code and draft a unified diff patch to fix bug.';
          if (criteriaInput) criteriaInput.value = 'Provide a valid unified diff with clear explanation.';
        } else if (preset === 'json') {
          if (goalInput) goalInput.value = 'Validate and reformat JSON input payload.';
          if (criteriaInput) criteriaInput.value = 'Check JSON syntax, preserve the supplied values, and explain any repairs.';
        } else if (preset === 'summary') {
          if (goalInput) goalInput.value = 'Summarize the attached file. Identify its main points and anything that needs attention.';
          if (criteriaInput) criteriaInput.value = 'Use only the supplied material. Distinguish facts from uncertainty.';
        }
        const attachments = find('[data-work-attachments]');
        if (attachments) attachments.open = true;
        if (goalInput) {
          goalInput.dispatchEvent(new Event('input', { bubbles: true }));
          goalInput.focus();
        }
      } else if (control.hasAttribute('data-work-cancel')) application.cancel();
      else if (control.dataset.workSelect) { showSelected = true; application.select(control.dataset.workSelect); }
      else if (control.dataset.workRevise) revise(control.dataset.workRevise);
      else if (control.hasAttribute('data-work-revise-selected')) revise(lastState.selectedId);
      else if (control.hasAttribute('data-work-new')) {
        fileRevision++; parentId = null; inputs = []; form.reset(); showInputs([]);
        find('[data-work-revision]').hidden = true; find('[data-work-feedback]').required = false;
        application.clearDraft(); error('');
        showSelected = false; render(application.getState());
        find('[data-work-goal]').focus();
        updateModelDescription(find('[data-work-model]').value);
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
