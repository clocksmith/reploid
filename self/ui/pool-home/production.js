import { escapeHtml as escape } from '../components/html.js';
import { renderConversationWorkspace, bindConversationWorkspace } from './conversation-workspace.js';
import { bindContributionModels } from './contribution-models.js';
import { renderPowerTower } from './shell-view.js';
import { interfaceIcon } from '../components/interface-icons.js';
import { bindDialog } from '../components/dialog.js';
import { preparationStatus } from './model-preparation.js';
import { bindMathematicalBackground } from '../components/mathematical-background.js';

const number = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString() : '—';
const bytes = value => Number.isFinite(value) && value >= 0
  ? value < 1048576 ? `${number(value)} B` : `${(value / 1048576).toFixed(1)} MB` : '—';

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
    : active ? 'Sharing' : configured ? 'Paused' : 'Not set up';
  const progress = contribution.progress || state.acquisition?.progress;
  const preparation = preparationStatus(progress);
  return { status, configured, active, stopping, local, available, phase,
    canTest: (state.models || []).some(model => model.localReady || model.networkAvailability === 'ready') || contribution.ready === true,
    selection: (state.models || []).find(model => model.id === contribution.modelId)?.selectionId || contribution.modelId,
    error: contribution.error || (state.acquisition?.phase === 'failed' ? state.acquisition.error : '') || files.error || (configured ? network.error : '') || '',
    outputTokens: contribution.production?.missingTokenCounts ? null : contribution.production?.outputTokens,
    completed: contribution.completed,
    suppliedBytes: files.suppliedBytes,
    progress: phase === 'loading' ? { received: preparation.progress?.value, total: preparation.progress?.max, message: preparation.detail }
      : phase === 'connecting' ? { message: 'Waiting for connection' } : null,
    cancellationPending: contribution.unsettledOwners > 0 || network.unsettledOwners > 0 };
}

/** This composition uses only cataloged surface, text, layout and control primitives. */
export function renderProductionSurface({ homeHref = '/' } = {}) {
  return `<section class="production-surface pool-stack pool-gap-lg" data-production-surface aria-label="AI production">
    <header class="production-header pool-row pool-row-between"><a class="pool-primary-brand pool-heading pool-plain" href="${escape(homeHref)}" aria-label="Reploid home">${renderPowerTower()}<span class="pool-primary-wordmark">Reploid</span></a><button class="pool-button btn-ghost pool-icon" type="button" data-production-settings aria-label="Settings" title="Settings">${interfaceIcon('settings')}</button></header>
    <section class="pool-card pool-stack pool-gap-md" aria-label="Production">
      <header class="pool-row pool-row-between"><h1 class="pool-title" data-production-status>Put this device to work</h1><button class="pool-button btn-ghost pool-small" type="button" data-production-pause hidden>Pause</button></header>
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
      <footer class="production-utilities pool-row"><button class="pool-button btn-ghost pool-small" type="button" data-production-model-options hidden>Change model</button><button class="pool-button btn-ghost pool-small" type="button" data-production-test hidden>Test model</button></footer>
    </section>
    <dialog class="chat-model-setup pool-surface pool-stack pool-gap-md" data-production-model-dialog aria-labelledby="production-model-title"><header class="pool-row pool-row-between"><h2 class="pool-heading" id="production-model-title">Change model</h2><button class="pool-button btn-ghost pool-icon" type="button" data-production-close-models aria-label="Close">${interfaceIcon('close')}</button></header><div data-production-more-models></div></dialog>
    <dialog class="production-demo pool-surface pool-stack pool-gap-md" data-production-demo aria-labelledby="production-test-title"><header class="pool-row pool-row-between"><h2 class="pool-heading" id="production-test-title">Test model</h2><button class="pool-button btn-ghost pool-icon" type="button" data-production-close-test aria-label="Close">${interfaceIcon('close')}</button></header><div class="production-demo-content">${renderConversationWorkspace({ inspector: false, compact: true })}</div></dialog>
  </section>`;
}

export function bindProductionSurface(root, session, { inspector, viewState = {}, ...chatOptions } = {}) {
  const surface = root.querySelector('[data-production-surface]');
  const find = selector => surface.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  const backgroundRoot = surface.closest('.pool-home');
  const detachBackground = backgroundRoot && document.documentElement.classList.contains('pool-page') && !backgroundRoot.querySelector('.pool-math-background')
    ? bindMathematicalBackground(backgroundRoot) : () => {};
  let detachedChat, last, pending = false, actionError = '', resumeCompute = false, resumeFiles = false;
  const modelsDialog = bindDialog(find('[data-production-model-dialog]'));
  const testDialog = bindDialog(find('[data-production-demo]'));
  const modelButtons = find('[data-production-model-buttons]');
  const modelActions = bindContributionModels(modelButtons, session, { onChoose: (id, opener) => { modelsDialog.close(); inspector?.contribute(id, opener); } });
  const text = (selector, value) => { find(selector).textContent = value; };
  const render = state => {
    last = projectProduction(state);
    const preparing = ['loading', 'connecting'].includes(last.phase);
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
    pause.textContent = last.stopping ? 'Pausing' : last.active ? 'Pause' : 'Resume';
    find('[data-production-settlement]').hidden = !last.cancellationPending;
    find('[data-production-setup-actions]').hidden = last.configured || last.active || preparing;
    const modelSlot = find(last.configured || last.active ? '[data-production-more-models]' : '[data-production-setup-actions]');
    if (modelButtons.parentElement !== modelSlot) modelSlot.prepend(modelButtons);
    modelActions.update(state);
    find('[data-production-model-options]').hidden = !(last.configured || last.active) || modelButtons.hidden;
    find('[data-production-test]').hidden = !last.canTest;
    find('.production-utilities').hidden = !last.canTest && find('[data-production-model-options]').hidden;
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
    find('[data-production-local]').innerHTML = last.local.map(model => `<span>${escape(model.name || model.id)}${model.localCached && !model.localReady ? ' · Downloaded' : ''}</span>`).join('');
    find('[data-production-preparing]').hidden = !last.progress;
    if (last.progress) {
      text('[data-production-progress-label]', last.progress.message);
      const progress = find('[data-production-progress]');
      if (Number.isFinite(last.progress.received) && last.progress.total > 0) { progress.max = last.progress.total; progress.value = last.progress.received; }
      else progress.removeAttribute('value');
    }
  };
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
    if (!resumeCompute && !resumeFiles) { inspector?.contribute(last.selection, find('[data-production-pause]')); return; }
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
  find('[data-production-settings]').addEventListener('click', event => inspector?.open('settings', event.currentTarget), options);
  find('[data-production-model-options]').addEventListener('click', event => modelsDialog.open(modelButtons.querySelector('button'), event.currentTarget), options);
  find('[data-production-close-models]').addEventListener('click', () => modelsDialog.close(), options);
  find('[data-production-close-test]').addEventListener('click', () => testDialog.close(), options);
  find('[data-production-test]').addEventListener('click', event => {
    if (!detachedChat) detachedChat = bindConversationWorkspace(root, session, { ...chatOptions, inspector, viewState });
    testDialog.open(find('[data-composer-input]'), event.currentTarget);
  }, options);
  const unsubscribe = session.subscribe(render);
  return () => { controller.abort(); unsubscribe(); detachBackground(); modelActions.dispose(); modelsDialog.dispose(); testDialog.dispose(); detachedChat?.(); };
}
