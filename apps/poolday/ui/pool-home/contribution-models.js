import { hasBrowserModelOrigin } from '../components/model-select.js';
import { interfaceIcon } from '../components/interface-icons.js';
import { preparationStatus } from './model-preparation.js';


/**
 * Who serves a model, from the computers this browser can see. A computer seen is a fact at any time. Seeing none
 * means none only after discovery has finished looking; until then it is unknown. This is supply, not demand.
 */
export function modelSupplyText(model, { observed = false } = {}) {
  if (!Array.isArray(model?.providerIds)) return '';
  const count = model.providerIds.length;
  if (count === 0) return observed ? 'No visible computer serves this' : 'Availability not known yet';
  return count === 1 ? '1 visible computer serves this' : `${count} visible computers serve this`;
}

/**
 * A suggestion for a producer: a model no visible computer serves, preferring one already on this device so that
 * accepting costs no download. It needs finished discovery, since an unfinished search has not shown a gap. Demand
 * is not measured, so it is not claimed. A suggestion starts nothing; the producer still reviews and chooses.
 */
export function suggestedModelId(models = [], { observed = false } = {}) {
  if (!observed) return null;
  const unserved = models.filter(model => Array.isArray(model.providerIds) && model.providerIds.length === 0);
  const pick = unserved.find(model => model.localReady || model.localCached) ?? unserved[0];
  return pick ? pick.selectionId || pick.id : null;
}

/** Model actions retain their identity across discovery and metadata updates. */
export function bindContributionModels(container, session, { onChoose }) {
  const entries = new Map();
  let disposed = false;
  // Whole models and their catalog adapters; an adapter choice prepares its base model with that exact adapter.
  const eligible = model => !model.partition && model.provider === 'doppler' && model.source
    && (model.localReady || model.localCached || hasBrowserModelOrigin(model));
  const size = value => value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB ↓` : `${Math.ceil(value / 1e6)} MB ↓`;
  const paint = (entry, issue, suggested = entry.suggested, observed = entry.observed) => {
    entry.suggested = suggested; entry.observed = observed;
    const { model, button, detail, metadata } = entry;
    button.querySelector('[data-model-name]').textContent = model.name || model.id;
    const supply = button.querySelector('[data-model-supply]');
    supply.textContent = [suggested ? 'Suggested' : '', modelSupplyText(model, { observed })].filter(Boolean).join(' · ');
    supply.hidden = !supply.textContent;
    detail.textContent = model.localReady ? 'Ready' : model.localCached ? 'Downloaded'
      : metadata ? size(metadata.sizeBytes) : '';
    detail.hidden = !detail.textContent;
    // A model that cannot be shared says why on its own row; the reason is never only a tooltip.
    const reason = button.querySelector('[data-model-issue]');
    reason.textContent = issue || ''; reason.hidden = !issue;
    button.disabled = !!issue;
    button.title = issue || (model.localReady || model.localCached ? 'Share this model'
      : entry.error ? 'Check download size and retry' : 'Review download and sharing');
  };
  const update = state => {
    if (disposed) return;
    const models = (state.models || []).filter(eligible);
    const ids = new Set(models.map(model => model.selectionId || model.id));
    const observed = state.discoveryPhase === 'observed', suggestion = suggestedModelId(models, { observed });
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
        button.className = 'pool-action-row';
        button.dataset.productionModel = id;
        button.innerHTML = `<span class="pool-icon-box" aria-hidden="true">${interfaceIcon('model')}</span><span class="pool-row-text"><span class="pool-row-title" data-model-name></span>`
          + '<span class="pool-row-status pool-row-segments"><span data-model-supply hidden></span><span data-model-detail hidden></span><span data-model-issue hidden></span></span></span>'
          + `<span class="pool-icon-box pool-icon-box-sm" aria-hidden="true">${interfaceIcon('next')}</span>`;
        entry = { model, button, detail: button.querySelector('[data-model-detail]'), controller: new AbortController() };
        entries.set(id, entry); container.append(button);
      }
      entry.model = model; paint(entry, state.localDownloadIssue, id === suggestion, observed);
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
