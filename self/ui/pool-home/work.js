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
import { renderToolExperiments, renderTextSwarm, bindWorkCapabilities } from './work-capabilities.js';
import { renderWorkHeading } from './work-layout.js';

export {
  renderGoalComposer,
  renderTaskHeader,
  renderActivityList,
  renderResultView,
  renderApprovalPanel,
  renderTaskHistory
};

const route = (path, label) => '<a href="' + path + '" data-pool-route-link="' + path + '">' + label + '</a>';
const links = () => '<details class="pool-work-more"><summary>More</summary>'
  + '<nav class="pool-work-links" aria-label="More in Reploid">'
  + route('/network', 'Network settings') + route('/improve', 'Improvement history') + route('/examples', 'Model examples') + route('/records', 'Peer job records')
  + '<span class="pool-work-experiment-links">Experiments: <a href="/zero" data-pool-substrate-route="zero">Zero</a>'
  + ' <a href="/x" data-pool-substrate-route="x">X</a></span></nav></details>';

export function renderWorkSurface() {
  return [
    '<section class="pool-work-shell pool-connected-shell" data-work-surface aria-label="Agent network">',
    '  <p class="pool-work-error" role="alert" data-work-error hidden></p>',
    '<details class="pool-network-disclosure" data-network-disclosure><summary>Network <span data-network-summary>0 peers</span></summary>',
    renderTextSwarm(),
    '</details>',
    '<div class="pool-connected-layout">',
    '<aside class="pool-thread-list" aria-label="Threads"><div class="pool-network-heading"><h2>Threads</h2>',
    '<button class="btn btn-ghost" type="button" data-work-new>New thread</button></div><div data-work-history></div></aside>',
    '  <section class="pool-work-task" id="reploid-activity" aria-label="Selected thread">',
    renderTaskHeader({ embedded: true }),
    renderApprovalPanel(),
    renderGoalComposer({ models: DEFAULT_WORK_MODELS, embedded: true }),
    renderResultView({ embedded: true }),
    '  </section>',
    '</div>',
    '</section>'
  ].join('\n');
}

export function renderNetworkSurface() {
  return '<section class="pool-work-shell" data-work-surface aria-label="Network">'
    + '<p class="pool-work-error" role="alert" data-work-error hidden></p>'
    + renderWorkHeading('Network')
    + renderTextSwarm()
    + '<details class="pool-work-settings"><summary>Specialized model jobs</summary><div class="pool-work-grid pool-network-grid">'
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
    + route('/', 'Start a task with peer assistance') + '</div></div></section></div></details>'
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
    + renderWorkHeading('Changes')
    + '<div class="pool-work-empty" data-work-empty hidden><h2 class="type-h2">No work to review yet.</h2>'
    + '<p>Start a task, then come back to review its result or try a revision.</p>' + route('/', 'Start your first task') + '</div>'
    + '<section class="pool-work-comparison" data-work-comparison hidden><h2 class="type-h2">Earlier attempt</h2>'
    + '<p data-work-parent-feedback></p><pre data-work-parent-output></pre></section>'
    + renderToolExperiments() + renderResultView() + renderTaskHistory()
    + '<details class="pool-work-boundary"><summary>What counts as improvement?</summary>'
    + '<p>Task revisions and your acceptance are not independent evaluation or proof of recursive improvement. '
    + 'Tool candidates above use protected tests and require your separate approval. Adoption applies to new tasks and retains the previous version.</p>'
    + '<a href="/x" data-pool-substrate-route="x">Open governed improvement workspace</a></details>'
    + links() + '</div></section>';
}

const download = (name, text, type) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

export function bindWorkSurface(root, application, services = {}) {
  if (!root.querySelector('[data-work-surface]')) return () => {};
  const controller = new AbortController(), options = { signal: controller.signal };
  const disposeCapabilities = bindWorkCapabilities(root, application, services);
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
  let progressRecordId = null, progressBusy = false;
  let showSelected = true;
  const form = find('[data-work-form]');
  const showInputs = items => {
    setText('[data-work-file-count]', items.length ? items.length + ' attached' : '');
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
    setText('[data-work-location]', model ? 'Doppler · compatible participants' : '');
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
    find('[data-work-peers]').checked = true; find('[data-work-recall]').checked = false;
    find('[data-work-helpers]').checked = true; find('[data-work-improvement]').checked = false;
    showInputs(inputs);
    updateModelDescription(draft.modelId);
  };
  const revise = id => {
    const draft = application.prepareRevision(id);
    if (form) {
      showSelected = false; fillDraft(draft); application.select(null);
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
    showSelected = state.selectedId !== null;
    const row = showSelected ? state.records.find(item => item.id === state.selectedId) : null;
    setText('[data-work-status]', state.busy ? state.activity
      : row ? (row.status || 'Saved').replace(/^./, value => value.toUpperCase()) : state.activity);
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
    for (const button of root.querySelectorAll('[data-work-new]')) button.disabled = (state.runningIds?.length || 0) >= state.maxConcurrentThreads;

    // Mode calculation
    const surface = find('[data-work-surface]');
    const mode = state.pendingApproval ? 'approval' : state.busy ? 'during' : row?.output ? 'after' : 'before';
    surface?.setAttribute('data-work-mode', mode);

    // Task Header
    const taskHeader = find('[data-work-task-header]');
    if (taskHeader) {
      taskHeader.hidden = !state.busy && !row;
      setText('[data-work-active-goal]', row?.goal || (state.busy ? 'Active task' : ''));
      setText('[data-work-active-model]', row ? row.modelName + (row.execution?.peerId
        ? ' · Peer ' + row.execution.peerId.slice(0, 8) : row.execution?.kind === 'local-scoped-session' ? ' · This device' : '') : '');
    }

    if (form) {
      form.setAttribute('aria-busy', String(state.busy || reading));
      for (const node of form.querySelectorAll('input,textarea,select,[data-work-new],[data-work-clear-inputs]')) node.disabled = state.busy || reading;
      find('[data-work-start]').disabled = state.busy || reading || !state.available || !!state.storageError;
      for (const btn of root.querySelectorAll('[data-work-cancel]')) btn.hidden = !state.busy;
      setText('[data-work-budget]', state.cycle + ' / ' + state.maxCycles + ' steps');
      if (!state.available) setText('[data-work-status]', 'No compatible participant connected');
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
      const progress = find('[data-work-progress]');
      if (progress) {
        progress.hidden = !(row?.events?.length || row?.helpers?.length || row?.peerJobs?.length || state.draft);
        if (progressRecordId !== row?.id || progressBusy !== state.busy) {
          progress.open = !!state.busy || !!row?.events?.some(event => event.error)
            || !!row?.helpers?.some(helper => helper.error);
        }
        progressRecordId = row?.id;
        progressBusy = state.busy;
      }
      const identity = JSON.stringify([row, state.busy]);
      if (identity !== resultIdentity) {
        resultIdentity = identity;
        setText('[data-work-answer]', row?.output || (state.busy || row?.error ? '' : row ? 'No result.' : ''));
        setText('[data-work-result-error]', row?.error || '');
        find('[data-work-result-error]').hidden = !row?.error;
        setText('[data-work-result-criteria]', row?.criteria ? 'Success criteria: ' + row.criteria : '');
        const answer = find('[data-work-answer]');
        if (answer) answer.hidden = !answer.textContent;
        const resultHeading = find('[data-work-result-title]');
        if (resultHeading) resultHeading.hidden = !row?.output;
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
        const team = find('[data-work-team]');
        if (team) {
          team.replaceChildren();
          for (const helper of row?.helpers || []) {
            const p = document.createElement('p');
            p.textContent = 'Helper · ' + helper.location + ' · ' + helper.status + ': ' + helper.goal
              + (helper.error ? ' — ' + helper.error : ''); team.append(p);
          }
          for (const job of row?.peerJobs || []) {
            const p = document.createElement('p'); p.textContent = 'Peer · ' + job.stage + ' · '
              + (job.preview?.modelId || '') + ' · ' + (job.preview?.providerId || '').slice(0, 16); team.append(p);
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
    const signature = JSON.stringify([showSelected, state.busy, state.selectedId, state.approvalThreadIds, state.runningIds, state.records]);
    if (signature === historyIdentity) return;
    historyIdentity = signature; list.replaceChildren();
    if (!state.records.length) {
      const empty = document.createElement('p'); empty.className = 'type-caption';
      empty.textContent = 'No threads yet'; list.append(empty);
    }
    for (const attempt of [...state.records].reverse()) {
      const item = document.createElement('article'), title = document.createElement('button');
      item.className = 'pool-work-attempt';
      title.type = 'button'; title.className = 'pool-work-attempt-title';
      title.textContent = attempt.goal; title.dataset.workSelect = attempt.id;
      title.setAttribute('aria-pressed', String(showSelected && attempt.id === state.selectedId));
      if (root.querySelector('.pool-thread-list')) {
        const status = document.createElement('span'); status.className = 'type-caption';
        status.textContent = state.approvalThreadIds?.includes(attempt.id) ? 'Approval needed' : attempt.status;
        title.append(status); item.append(title); list.append(item); continue;
      }
      const metadata = document.createElement('p'), button = document.createElement('button');
      metadata.className = 'type-caption';
      metadata.textContent = [attempt.status, attempt.modelName, new Date(attempt.createdAt).toLocaleString(),
        attempt.parentId ? 'revision of an earlier attempt' : 'original attempt'].join(' / ');
      button.type = 'button'; button.className = 'btn btn-ghost'; button.textContent = 'Revise with feedback';
      button.dataset.workRevise = attempt.id; button.disabled = state.runningIds?.includes(attempt.id) || !state.available;
      item.append(title, metadata, button);
      if (attempt.error) {
        const failure = document.createElement('p'); failure.className = 'pool-work-error';
        failure.textContent = attempt.error; item.append(failure);
      }
      list.append(item);
    }
  };
  const draft = application.getDraft();
  if (draft) { showSelected = false; fillDraft(draft); application.select(null); }
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
      allowPeers: find('[data-work-peers]').checked, recallAccepted: find('[data-work-recall]').checked,
      allowHelpers: find('[data-work-helpers]').checked, allowImprovement: find('[data-work-improvement]').checked };
    act(() => application.start(request));
  }, options);
  find('[data-work-public]')?.addEventListener('change', () => render(application.getState()), options);
  find('[data-work-model]')?.addEventListener('change', event => updateModelDescription(event.target.value), options);
  root.addEventListener('click', event => {
    const control = event.target.closest('button');
    if (!control || !root.contains(control)) return;
    act(async () => {
      if (control.hasAttribute('data-work-cancel')) application.cancel();
      else if (control.dataset.workSelect) { showSelected = true; application.select(control.dataset.workSelect); }
      else if (control.dataset.workRevise) revise(control.dataset.workRevise);
      else if (control.hasAttribute('data-work-revise-selected')) revise(lastState.selectedId);
      else if (control.hasAttribute('data-work-new')) {
        fileRevision++; parentId = null; inputs = []; form.reset(); showInputs([]);
        find('[data-work-revision]').hidden = true; find('[data-work-feedback]').required = false;
        application.clearDraft(); error('');
        showSelected = false; application.select(null);
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
  return () => { fileRevision++; controller.abort(); unsubscribe(); disposeCapabilities(); };
}
