/** Model-picker presentation only. Selection and execution remain with the caller. */
import { isDownloadableBaseModel, updateModelSelect, modelExecutionState, modelFacts, modelVariantKey, modelChoiceGroups, modelServingComputers, unavailableModelChoice } from '../components/model-select.js';
import { preparationStatus } from './model-preparation.js';
import { updateModelProviders } from './model-providers.js';
import { updateAdapterDetails, describeModelChoice } from './model-adapters.js';

export const canDownloadModelHere = (model, state, canDownload) => canDownload && isDownloadableBaseModel(model)
  && !model.fleet && !model.localReady && !model.localCached && model.availability !== 'cached' && !state.localDownloadIssue;

// A recovery suggestion requires a free, connected provider for this exact variant.
// The ordinary picker also lists downloadable, busy and advertised models.
export function recoverySharedModel(state, selectedId, location, privacy) {
  if (location === 'local' || privacy?.placement === 'local-only' || privacy?.allowedRecipients?.length
    || (privacy && privacy.profile !== 'provider-visible')) return null;
  return state.models?.find(model => (model.selectionId || model.id) !== selectedId
    && !model.fleet && !model.partition && model.networkAvailability === 'ready'
    && model.reachableProviderIds?.length > 0) ?? null;
}

/** Browser storage quota and GPU memory are distinct resources. The browser exposes no free VRAM counter. */
export function localFitText(model, info, { cached = false, sizeBytes = info?.sizeBytes } = {}) {
  if (!model || model.partition || model.fleet) return '';
  const gb = bytes => (bytes / 1e9).toLocaleString(undefined, {maximumFractionDigits: 2}) + ' GB';
  const size = Number.isFinite(sizeBytes) ? gb(sizeBytes) : 'size checked before download';
  const space = Number.isFinite(info?.freeBytes) ? ` · ${gb(info.freeBytes)} browser storage available` : '';
  const insufficient = !cached && Number.isFinite(info?.freeBytes) && Number.isFinite(sizeBytes) && info.freeBytes < sizeBytes;
  const fit = insufficient ? 'Remaining browser storage is smaller than a fresh download.' : model.localReady ? 'Model is loaded on this device.'
    : 'Fit unknown. Available GPU memory is not reported.';
  const memory = Number.isFinite(info?.gpuBytes) ? `Estimated GPU memory ${gb(info.gpuBytes)}. ` : 'Working memory estimate unavailable for this model. ';
  return `${cached ? 'Stored on this device' : 'Download: ' + size}${space}. ${memory}${fit} Usable context depends on the workload and available memory.`;
}

const keyFor = model => model?.selectionId || model?.id;
const connectingPhases = new Set(['preparing', 'negotiating', 'connecting', 'awaiting-answer', 'opening-channel']);

export function modelReadiness(state, model, location) {
  const execution = modelExecutionState(model, location);
  const { source, status } = execution;
  const loadingHere = source === 'local' && state.localModel?.phase === 'loading'
    && (!state.localModel.modelIdentity || state.localModel.modelIdentity === model?.identity);
  const acquiring = state.acquisition?.modelId === model?.id && state.acquisition?.phase === 'downloading';
  const preparing = (progress, label, phase = 'preparing') => ({ ...preparationStatus(progress), label, phase, active: true });
  if (acquiring) {
    const progress = state.acquisition.progress;
    if (progress?.stage === 'download-complete') return { label: 'Verifying model files…', active: true };
    if (progress?.stage === 'downloading' || Number.isFinite(progress?.receivedBytes)) {
      return preparing({ ...progress, kind: 'downloading' }, 'Downloading model…', 'downloading');
    }
    return { label: 'Checking model files…', active: true };
  }
  if (loadingHere) return preparing(state.localModel.progress, 'Preparing model…');
  if (execution.usable) {
    const count = source === 'network' ? modelServingComputers(model) : 0;
    const computers = count ? ` · ${count} ${count === 1 ? 'computer' : 'computers'}` : '';
    const route = source === 'local' ? ' · This device' : model?.partition ? ' · Split model' : '';
    return { label: status === 'cached' ? 'Downloaded · This device' : `${status === 'busy' ? 'At capacity' : 'Ready'}${computers || route}` };
  }
  if (source === 'local') return { label: isDownloadableBaseModel(model) ? 'Download available' : 'Unavailable on this device' };
  const network = state.network || {};
  const connections = network.connections ?? network.consumer?.connections ?? [];
  const matching = (network.consumer?.peers || []).filter(peer => !model?.fleet && !model?.partition && !peer.blocked
    && peer.model === model?.id && peer.modelIdentity === model?.identity
    && (model?.adapters || []).every(adapter => peer.adapterIdentities?.includes(adapter.identity)));
  const partition = model && !model.fleet && !model.adapters?.length && (network.partitionPeers || []).find(peer => peer.available
    && peer.description?.phase === 'loading' && peer.description.offer?.id === model.id
    && peer.description.offer?.identity === model.identity
    && (!model.partition || model.partition.route?.stages?.some(stage => stage.participantId === peer.participantId)
      || [model.partition.participantA, model.partition.participantB].includes(peer.participantId)));
  if (status === 'loading' || status === 'preparing' || partition) {
    const peer = matching.find(peer => peer.readiness === 'loading'
      && (!connections.length || connections.some(link => link.id === peer.peerId && link.phase === 'connected'
        && (link.attemptId ?? null) === (peer.attemptId ?? null))));
    return preparing(partition?.description.preparation || peer?.preparation, 'Preparing model…');
  }
  if (matching.some(peer => connections.some(link => link.id === peer.peerId && connectingPhases.has(link.phase)))) {
    return { label: 'Connecting…', active: true };
  }
  if (state.discoveryPhase === 'searching') return { label: 'Finding computers…', active: true };
  if (state.discoveryPhase === 'paused') return { label: 'Discovery paused' };
  if (state.discoveryPhase === 'interrupted') return { label: 'Connection interrupted' };
  return { label: 'No ready computer' };
}

export function updateConversationModelPicker({ find, choices, state, model: pickerModel, location: pickerLocation,
  order, changing: changingModel, selectedId, localOnly, canDownload }) {
  const preferNetwork = pickerLocation !== 'local';
  const catalog = state.models || [];
  if (!pickerModel) pickerModel = catalog.find(model => keyFor(model) === selectedId) || catalog[0];
  const selection = keyFor(pickerModel);
  const models = catalog.filter(model => keyFor(model) !== selection || modelVariantKey(model) === modelVariantKey(pickerModel));
  const selected = models.find(model => keyFor(model) === selection);
  if (!order.size) {
    for (const { models: group } of modelChoiceGroups(models, { preferNetwork, location: pickerLocation })) {
      for (const model of group) order.set(modelVariantKey(model), model);
    }
  }
  for (const model of models) order.set(modelVariantKey(model), model);
  const liveKeys = new Set(models.map(modelVariantKey));
  for (const [key, model] of order) if (!liveKeys.has(key) && !catalog.some(item => keyFor(item) === keyFor(model))) {
    models.push(unavailableModelChoice(model));
  }
  if (pickerModel && !selected && !models.some(model => keyFor(model) === keyFor(pickerModel))) {
    models.push(unavailableModelChoice(pickerModel));
  }
  const indices = new Map([...order.keys()].map((key, index) => [key, index]));
  const rank = model => indices.get(modelVariantKey(model)) ?? indices.size;
  models.sort((a, b) => rank(a) - rank(b));
  const next = find('[data-next-model]');
  next.disabled = changingModel;
  updateModelSelect(next, models, { value: keyFor(pickerModel) });
  choices.update(models, { preferNetwork, location: pickerLocation, variants: true, compact: true,
    describe: model => ({ status: modelReadiness(state, model, pickerLocation).label }) });
  const displayModel = selected || pickerModel;
  updateAdapterDetails(find('[data-model-picker]'), state, displayModel);
  updateModelProviders(find('[data-model-picker]'), state, displayModel, { selectedId: keyFor(pickerModel), disabled: changingModel });
  find('[data-model-facts]').textContent = displayModel ? describeModelChoice(state)(displayModel).facts || modelFacts(displayModel) : '';
  const preview = modelExecutionState(selected, pickerLocation);
  const available = selected && (preview.usable || pickerLocation === 'local' && state.activeThread?.permissions?.sharingScope === 'local' && isDownloadableBaseModel(selected) && !state.localDownloadIssue);
  for (const button of find('[data-execution-location]').querySelectorAll('[data-execution-choice]')) {
    const location = button.dataset.executionChoice;
    if (location === 'network') {
      button.textContent = selected?.fleet ? 'Private network' : 'Network';
      button.setAttribute('aria-label', selected?.fleet ? 'Private network' : 'Public network');
    }
    button.setAttribute('aria-pressed', String(location === pickerLocation));
    button.disabled = changingModel || !!state.activeThread?.closed || (state.runningIds || []).includes(state.selectedId)
      || localOnly && location !== 'local' || location === 'local' && location !== pickerLocation && !modelExecutionState(selected, 'local').usable;
  }
  const downloadable = !available && !!selected && canDownloadModelHere(selected, state, canDownload);
  const switchToLocal = !available && pickerLocation === 'network' && (downloadable || modelExecutionState(selected, 'local').usable);
  const switchButton = find('[data-switch-local]');
  const confirm = find('[data-change-model]');
  const active = confirm.ownerDocument.activeElement;
  switchButton.hidden = !switchToLocal;
  switchButton.disabled = changingModel || state.acquisition?.phase === 'downloading';
  switchButton.textContent = downloadable ? 'Download…' : 'Use this device';
  switchButton.setAttribute('aria-label', downloadable ? 'Download to this device' : 'Switch to this device');
  const reviewDownload = downloadable && pickerLocation !== 'network';
  confirm.disabled = changingModel || !(available || reviewDownload)
    || reviewDownload && state.acquisition?.phase === 'downloading';
  confirm.textContent = reviewDownload ? 'Download model…' : 'Use model';
  if ((active === switchButton || active === confirm) && (active.hidden || active.disabled)) {
    if (confirm.disabled) choices.focus({ preventScroll: true });
    else confirm.focus({ preventScroll: true });
  }
  const readiness = modelReadiness(state, selected || unavailableModelChoice(displayModel), pickerLocation);
  const failed = state.acquisition?.modelId === selected?.id && state.acquisition?.phase === 'failed';
  const text = failed ? state.acquisition.error || 'Model download failed' : readiness.progressText
    ? `${readiness.status} · ${readiness.progressText}` : displayModel ? readiness.label : 'No models available';
  const status = find('[data-next-model-status]');
  if (status.textContent !== text) status.textContent = text;
  const strip = find('[data-model-picker-progress]');
  const waiting = readiness.active && !readiness.progress && !failed;
  status.classList.toggle('pool-dot', waiting);
  status.classList.toggle('pool-dot-pulse', waiting);
  strip.dataset.progress = readiness.progress && !failed ? 'measured' : waiting ? 'waiting' : 'idle';
  const meter = strip.querySelector('progress');
  if (readiness.progress) {
    meter.max = readiness.progress.max;
    meter.value = readiness.progress.value;
  } else meter.removeAttribute('value');
  return displayModel;
}
