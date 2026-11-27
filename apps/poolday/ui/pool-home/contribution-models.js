import { modelKey } from '../../host/decisions/model-state.js';
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
  return pick ? modelKey(pick) : null;
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
