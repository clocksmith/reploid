import { escapeHtml as escape } from '../components/html.js';
import { interfaceIcon } from '../components/interface-icons.js';
import { bindDialog } from '../components/dialog.js';
import { preparationStatus } from './model-preparation.js';
import { bindMathematicalBackground } from '../components/mathematical-background.js';
import { modelChoiceGroups } from '../components/model-select.js';

const number = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString() : '—';
const bytes = value => Number.isFinite(value) && value >= 0
  ? value < 1048576 ? `${number(value)} B` : `${(value / 1048576).toFixed(1)} MB` : '—';

/** Model actions retain their identity across discovery and metadata updates. */
export function bindContributionModels(container, session, { onChoose }) {
  const entries = new Map();
  let disposed = false;
  const eligible = model => !model.partition && !model.adapters?.length && model.source && model.provider === 'doppler';
  const size = value => value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB ↓` : `${Math.ceil(value / 1e6)} MB ↓`;
  const paint = (entry, issue) => {
    const { model, button, detail, metadata } = entry;
    button.querySelector('[data-model-name]').textContent = model.name || model.id;
    detail.textContent = model.localReady ? 'Ready' : model.localCached ? 'Downloaded'
      : metadata ? size(metadata.sizeBytes) : '';
    detail.hidden = !detail.textContent;
    button.disabled = !!issue;
    button.title = issue || (model.localReady || model.localCached ? 'Share this model'
      : entry.error ? 'Check download size and retry' : 'Review download and sharing');
  };
  const update = state => {
    if (disposed) return;
    const models = (state.models || []).filter(eligible);
    const ids = new Set(models.map(model => model.selectionId || model.id));
    for (const [id, entry] of entries) if (!ids.has(id)) {
      entry.controller.abort(); entry.button.remove(); entries.delete(id);
    }
    for (const model of models) {
      const id = model.selectionId || model.id;
      let entry = entries.get(id);
      if (entry && entry.model.identity !== model.identity) {
        entry.controller.abort(); entry.button.remove(); entries.delete(id); entry = null;
      }
      if (!entry) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'pool-button pool-stack pool-gap-xs';
        button.dataset.productionModel = id;
        button.innerHTML = '<span data-model-name></span><span class="pool-caption" data-model-detail hidden></span>';
        entry = { model, button, detail: button.querySelector('[data-model-detail]'), controller: new AbortController() };
        entries.set(id, entry); container.append(button);
      }
      entry.model = model; paint(entry, state.localDownloadIssue);
      if (!model.localCached && !model.localReady && !entry.requested && !state.localDownloadIssue && session.getModelDownload) {
        entry.requested = true;
        const current = entry;
        Promise.resolve().then(() => session.getModelDownload(id, { signal: current.controller.signal })).then(info => {
          if (!Number.isSafeInteger(info?.sizeBytes) || info.sizeBytes <= 0) throw Error('Download size unavailable');
          current.metadata = info;
        }).catch(error => { current.error = error.message; }).finally(() => {
          if (!disposed && !current.controller.signal.aborted) paint(current, session.getState().localDownloadIssue);
        });
      }
    }
    container.hidden = models.length === 0;
  };
  const choose = event => {
    const button = event.target.closest('[data-production-model]');
    if (button && container.contains(button) && !button.disabled) onChoose(button.dataset.productionModel, button);
  };
  container.addEventListener('click', choose);
  return { update, dispose() {
    disposed = true; container.removeEventListener('click', choose);
    for (const entry of entries.values()) entry.controller.abort();
    entries.clear();
  } };
}

/** Read observed execution and custody separately. Catalog membership is not local readiness. */
export function projectProduction(state) {
  const network = state.network || {}, contribution = network.contribution || {}, files = network.files || {};
  const local = (state.models || []).filter(model => !model.partition && (model.localReady || model.localCached
    || contribution.ready === true && model.id === contribution.modelId));
  const available = (state.models || []).filter(model => ['ready', 'busy'].includes(model.networkAvailability));
  const configured = local.length > 0 || files.verifiedFiles?.length > 0;
  const active = !!configured && (!!network.sharing || !!files.sharing);
  const stopping = network.stopping || files.stopping;
  const phase = state.acquisition?.phase === 'downloading' ? 'loading' : contribution.phase;
  const status = stopping ? 'Pausing' : phase === 'failed' ? 'Needs attention'
    : phase === 'connecting' ? 'Connecting' : phase === 'loading' ? 'Preparing' : phase === 'executing' ? 'Producing'
    : active ? 'Sharing' : network.computeEnabled === false && files.enabled === false ? 'Paused'
    : configured ? 'Downloaded · not sharing' : 'Not set up';
  const progress = contribution.progress || state.acquisition?.progress;
  const preparation = preparationStatus(progress);
  return { status, configured, active, stopping, local, available, phase,
    selection: (state.models || []).find(model => model.id === contribution.modelId)?.selectionId || contribution.modelId,
    error: contribution.error || (state.acquisition?.phase === 'failed' ? state.acquisition.error : '') || files.error || (configured ? network.error : '') || '',
    outputTokens: contribution.production?.missingTokenCounts ? null : contribution.production?.outputTokens,
    completed: contribution.completed,
    suppliedBytes: files.suppliedBytes, history: network.contributionHistory || { records: [] },
    progress: phase === 'loading' ? { received: preparation.progress?.value, total: preparation.progress?.max, message: preparation.detail }
      : phase === 'connecting' ? { message: 'Waiting for connection' } : null,
    cancellationPending: contribution.unsettledOwners > 0 || network.unsettledOwners > 0 };
}

export function renderSharedModelChooser(selectionDetails = '') {
  return `<section class="pool-card pool-stack pool-gap-md" aria-label="Shared models" data-production-shared>
    <header class="pool-row pool-row-between"><h1 class="pool-title">Choose a model</h1><button class="pool-button btn-ghost pool-small" type="button" data-production-network>Computers</button></header>
    <p class="pool-small pool-muted" data-production-network-status role="status"></p>
    <p class="pool-small" data-production-shared-error role="alert" hidden></p>
    <ul class="pool-list pool-stack pool-gap-sm" data-production-available></ul>
    <div class="pool-stack pool-gap-xs" data-shared-selection-slot>${selectionDetails}</div>
    <div class="pool-row"><button class="pool-button btn-ghost pool-small" type="button" data-production-retry>Retry</button></div>
  </section>`;
}

export function renderProductionContribution() {
  return `<section class="production-surface pool-stack pool-gap-lg" data-production-surface aria-label="AI production">
    <details class="pool-disclosure" data-production-device><summary>Run on this device <span class="pool-muted" data-production-summary-status></span></summary>
    <section class="pool-card pool-stack pool-gap-md" aria-label="Production">
      <header class="pool-row pool-row-between"><h2 class="pool-subheading" data-production-status>Put this device to work</h2></header>
      <p class="pool-small" data-production-error role="alert" hidden></p>
      <div class="pool-row pool-small" data-production-local aria-label="Models" hidden></div>
      <p class="pool-small pool-muted" data-production-work hidden></p>
      <dl class="pool-stats pool-columns" data-production-metrics hidden>
        <div title="Output tokens from requests served by this device in this model session"><dt>Tokens produced</dt><dd data-production-tokens>—</dd></div>
        <div><dt>Requests served</dt><dd data-production-completed>—</dd></div>
        <div data-production-file-metric hidden><dt>Files sent</dt><dd data-production-supplied>—</dd></div>
      </dl>
      <div class="pool-stack pool-gap-xs" data-production-preparing hidden><p class="pool-small" data-production-progress-label role="status"></p><progress class="pool-progress" data-production-progress aria-label="Model preparation"></progress><button class="pool-button btn-ghost pool-small" type="button" data-production-cancel>Cancel</button></div>
      <p class="pool-caption pool-muted" data-production-settlement hidden>Waiting for cleanup</p>
      <div data-production-setup-actions><div class="pool-row pool-gap-md" data-production-model-buttons></div><p class="pool-small pool-muted" data-production-model-empty hidden>No models available</p></div>
      <footer class="production-utilities pool-row"><button class="pool-button btn-ghost pool-small" type="button" data-production-model-options hidden>Change model</button><button class="pool-button btn-ghost pool-small" type="button" data-production-pause hidden>Pause</button></footer>
    </section>
    </details>
    <details class="pool-disclosure" data-production-history><summary>Contributions <span class="pool-muted" data-production-history-count></span></summary><div class="pool-stack pool-gap-sm"><p class="pool-caption pool-muted">Recent whole-model executions on this device. Session counters above reset when a model restarts. These records do not establish delivery or earnings.</p><p class="pool-small pool-muted" data-production-history-status role="status"></p><ol class="pool-list pool-small" data-production-history-records></ol></div></details>
    <dialog class="chat-model-setup pool-surface pool-stack pool-gap-md" data-production-model-dialog aria-labelledby="production-model-title"><header class="pool-row pool-row-between"><h2 class="pool-heading" id="production-model-title">Change model</h2><button class="pool-button btn-ghost pool-icon" type="button" data-production-close-models aria-label="Close">${interfaceIcon('close')}</button></header><div data-production-more-models></div></dialog>
  </section>`;
}

export function bindProductionControls(container, session, { inspector, onSelectSharedModel, getSelectedModelId } = {}) {
  const find = selector => container.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  const backgroundRoot = container.closest('.pool-home');
  const detachBackground = backgroundRoot && document.documentElement.classList.contains('pool-page') && !backgroundRoot.querySelector('.pool-math-background')
    ? bindMathematicalBackground(backgroundRoot) : () => {};
  let last, pending = false, actionError = '', resumeCompute = false, resumeFiles = false, attention = false;
  const sharedRows = new Map();
  const modelsDialog = bindDialog(find('[data-production-model-dialog]'));
  const modelButtons = find('[data-production-model-buttons]');
  const modelActions = bindContributionModels(modelButtons, session, { onChoose: (id, opener) => { modelsDialog.close(); inspector?.contribute?.(id, opener); } });
  const text = (selector, value) => { const node = find(selector); if (node) node.textContent = value; };
  const render = state => {
    last = projectProduction(state);
    const preparing = ['loading', 'connecting'].includes(last.phase);
    const needsAttention = preparing || !!last.error || last.cancellationPending;
    if (needsAttention && !attention) find('[data-production-device]').open = true;
    attention = needsAttention;
    text('[data-production-summary-status]', last.status);
    text('[data-production-status]', last.configured || last.active || preparing || last.stopping ? last.status : 'Put this device to work');
    text('[data-production-tokens]', number(last.outputTokens));
    text('[data-production-completed]', number(last.completed));
    text('[data-production-supplied]', bytes(last.suppliedBytes));
    find('[data-production-work]').hidden = !last.active || preparing;
    text('[data-production-work]', last.phase === 'executing' ? 'Working on a request' : 'Waiting for requests');
    const error = actionError || last.error;
    text('[data-production-error]', error); find('[data-production-error]').hidden = !error;
    const pause = find('[data-production-pause]');
    pause.hidden = !last.configured || preparing; pause.disabled = pending || !!last.stopping;
    pause.textContent = last.stopping ? 'Pausing' : last.active ? 'Pause' : last.status === 'Paused' ? 'Resume' : 'Start sharing';
    find('[data-production-settlement]').hidden = !last.cancellationPending;
    find('[data-production-setup-actions]').hidden = last.configured || last.active || preparing;
    const modelSlot = find(last.configured || last.active ? '[data-production-more-models]' : '[data-production-setup-actions]');
    if (modelButtons.parentElement !== modelSlot) modelSlot.prepend(modelButtons);
    modelActions.update(state);
    find('[data-production-model-options]').hidden = !(last.configured || last.active) || modelButtons.hidden;
    find('[data-production-model-empty]').textContent = 'No models available';
    find('[data-production-model-empty]').hidden = !modelButtons.hidden;
    if (state.localDownloadIssue && !last.configured) {
      find('[data-production-model-empty]').textContent = 'Local inference unavailable';
      find('[data-production-model-empty]').title = state.localDownloadIssue;
      find('[data-production-model-empty]').hidden = false;
    }
    const hasOutput = last.completed > 0 || last.outputTokens > 0 || last.suppliedBytes > 0;
    find('[data-production-metrics]').hidden = preparing || !(last.active || hasOutput);
    const hasCompute = !!state.network?.sharing || last.completed > 0 || last.outputTokens > 0;
    find('[data-production-tokens]').parentElement.hidden = !hasCompute;
    find('[data-production-completed]').parentElement.hidden = !hasCompute;
    find('[data-production-file-metric]').hidden = !state.network?.files?.enabled && !(last.suppliedBytes > 0);
    find('[data-production-local]').hidden = last.local.length === 0 || last.phase === 'loading';
    find('[data-production-local]').innerHTML = last.local.map(model => `<span>${escape(model.name || model.id)} · ${model.localReady || state.network?.contribution?.ready && model.id === state.network.contribution.modelId ? 'Prepared' : 'Downloaded'}</span>`).join('');
    const connection = state.network?.consumer?.connectionState;
    text('[data-production-network-status]', state.network?.error || (state.network?.paused ? 'Disconnected'
      : state.network?.connecting || ['connecting', 'retrying'].includes(connection) ? 'Finding computers…'
      : last.available.length ? `${last.available.length} shared ${last.available.length === 1 ? 'model' : 'models'}`
      : 'Waiting for shared models. You can also run a model on this device.'));
    find('[data-production-shared-error]').hidden = true;
    const shared = modelChoiceGroups(state.models || []).find(group => group.id === 'shared')?.models || [];
    const ids = new Set(shared.map(model => model.selectionId || model.id));
    for (const [id, row] of sharedRows) if (!ids.has(id)) { row.remove(); sharedRows.delete(id); }
    const selectedId = getSelectedModelId?.();
    shared.forEach((model, index) => {
      const id = model.selectionId || model.id;
      let row = sharedRows.get(id);
      if (!row) {
        row = document.createElement('li');
        row.innerHTML = '<button type="button" class="chat-model-choice pool-button pool-choice pool-row-between"><span><span data-shared-model-name></span><small class="pool-muted" data-shared-model-status></small></span><span class="pool-caption">Use model</span></button>';
        row.firstElementChild.dataset.productionUse = id;
        sharedRows.set(id, row);
      }
      row.querySelector('[data-shared-model-name]').textContent = model.name || model.id;
      row.querySelector('[data-shared-model-status]').textContent = model.networkAvailability === 'ready' ? 'Ready'
        : model.networkAvailability === 'busy' ? 'Busy · waits for capacity' : 'Preparing';
      row.firstElementChild.disabled = !['ready', 'busy'].includes(model.networkAvailability);
      row.firstElementChild.setAttribute('aria-pressed', String(id === selectedId));
      const list = find('[data-production-available]');
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
    });
    find('[data-production-retry]').hidden = last.available.length > 0 && !state.network?.error;
    find('[data-production-retry]').disabled = pending || !!state.network?.connecting || ['connecting', 'retrying'].includes(connection);
    const records = last.history.records;
    text('[data-production-history-count]', records.length ? String(records.length) : '');
    text('[data-production-history-status]', last.history.error || (records.length ? `Latest ${records.length} saved executions` : 'No saved executions yet'));
    find('[data-production-history-records]').innerHTML = records.map(row => `<li><span>${escape((state.models || []).find(model => model.id === row.modelId)?.name || row.modelId)}</span> · <time datetime="${new Date(row.completedAt).toISOString()}">${escape(new Date(row.completedAt).toLocaleString())}</time> · ${row.outputTokens === null ? 'Token count unavailable' : `${number(row.outputTokens)} tokens`}</li>`).join('');
    find('[data-production-preparing]').hidden = !last.progress;
    if (last.progress) {
      text('[data-production-progress-label]', last.progress.message);
      const progress = find('[data-production-progress]');
      if (Number.isFinite(last.progress.received) && last.progress.total > 0) { progress.max = last.progress.total; progress.value = last.progress.received; }
      else progress.removeAttribute('value');
    }
  };
  find('[data-production-available]').addEventListener('click', event => {
    const button = event.target.closest('[data-production-use]');
    if (!button || button.disabled) return;
    const model = (session.getState().models || []).find(item => (item.selectionId || item.id) === button.dataset.productionUse
      && ['ready', 'busy'].includes(item.networkAvailability));
    if (!model) return;
    onSelectSharedModel?.(model);
  }, options);
  const act = async operation => {
    if (pending) return;
    pending = true; actionError = ''; render(session.getState());
    try { await operation(); } catch (error) { actionError = error.message; }
    finally { pending = false; if (!controller.signal.aborted) render(session.getState()); }
  };
  const pause = () => act(async () => {
    const state = session.getState(), network = state.network || {};
    resumeCompute = !!network.computeEnabled; resumeFiles = !!network.files?.enabled;
    const results = await Promise.allSettled([session.setSharing(false, last.selection, false), session.setFileSharing(false, last.selection, false)]);
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'Could not pause all sharing. Check Settings.');
  });
  find('[data-production-pause]').addEventListener('click', () => {
    if (last.active) { void pause(); return; }
    if (!resumeCompute && !resumeFiles) { inspector?.contribute?.(last.selection, find('[data-production-pause]')); return; }
    void act(async () => {
      if (session.getState().network?.paused) await session.connect();
      if (resumeCompute) await session.setSharing(true, last.selection, true);
      if (resumeFiles) await session.setFileSharing(true, last.selection, true, { mode: 'cached-only' });
    });
  }, options);
  find('[data-production-cancel]').addEventListener('click', () => void act(async () => {
    if (session.getState().acquisition?.phase === 'downloading') await session.cancelModelDownload?.();
    else await session.setSharing(false, last.selection, false);
  }), options);
  find('[data-production-network]').addEventListener('click', event => inspector?.open?.('participants', event.currentTarget), options);
  find('[data-production-retry]').addEventListener('click', () => void act(() => session.connect()), options);
  find('[data-production-model-options]').addEventListener('click', event => modelsDialog.open(modelButtons.querySelector('button'), event.currentTarget), options);
  find('[data-production-close-models]').addEventListener('click', () => modelsDialog.close(), options);
  return { update: render, dispose() { controller.abort(); detachBackground(); modelActions.dispose(); modelsDialog.dispose(); } };
}
