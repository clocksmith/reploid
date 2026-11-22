/** Model-picker presentation only. Selection and execution remain with the caller. */
import { isDownloadableBaseModel, updateModelSelect, modelExecutionState, modelFacts, unavailableModelChoice } from '../components/model-select.js';
import { updateModelProviders } from './model-providers.js';
import { updateAdapterDetails, describeModelChoice } from './model-adapters.js';
import { allowsOpenPlaintext } from './privacy-controls.js';

export const canDownloadModelHere = (model, state, canDownload) => canDownload && isDownloadableBaseModel(model)
  && !model.fleet && !model.localReady && !model.localCached && model.availability !== 'cached' && !state.localDownloadIssue;

// A recovery suggestion requires a free, connected provider for this exact variant.
// The ordinary picker also lists downloadable, busy and advertised models.
export function recoverySharedModel(state, selectedId, location, privacy) {
  if (location === 'local' || !allowsOpenPlaintext(privacy)) return null;
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

const computerState = (choice, { state, selected, locked, canDownload }) => {
  if (choice === 'desktop') {
    return { online: 'Ready', pairing: 'Connecting…', joining: 'Connecting…', connecting: 'Connecting…', offline: 'Offline',
      invited: 'Tap Join' }[locked?.status] || '';
  }
  if (choice === 'local') {
    if (modelExecutionState(selected, 'local').usable) return 'Ready';
    return selected && canDownloadModelHere(selected, state, canDownload) ? 'Download needed' : '';
  }
  if (modelExecutionState(selected, 'network').usable) return 'Ready';
  return state.discoveryPhase === 'searching' ? 'Finding computers…' : 'None available';
};

export function updateConversationModelPicker({ find, choices, state, model: pickerModel, location: pickerLocation,
  touched: pickerTouched, changing: changingModel, selectedId, localOnly, canDownload, destination = null, locked = null }) {
  const keyFor = model => model?.selectionId || model?.id;
  if (!pickerTouched) pickerModel = (state.models || []).find(model => keyFor(model) === selectedId) || pickerModel;
  const models = [...(state.models || [])];
  const selected = (state.models || []).find(model => keyFor(model) === keyFor(pickerModel));
  if (pickerModel && !models.some(model => keyFor(model) === keyFor(pickerModel))) {
    models.push(selected || unavailableModelChoice(pickerModel));
  }
  const preferNetwork = pickerLocation !== 'local';
  find('[data-next-model]').disabled = changingModel;
  updateModelSelect(find('[data-next-model]'), models, { value: keyFor(pickerModel), showAvailability: true, grouped: true, preferNetwork, location: pickerLocation });
  choices.update(models, { grouped: true, preferNetwork, location: pickerLocation, variants: true, compact: true, describe: describeModelChoice(state) });
  // Exact variants remain selectable; provider and format facts stay in the disclosure.
  updateAdapterDetails(find('[data-model-picker]'), state, selected || pickerModel);
  updateModelProviders(find('[data-model-picker]'), state, selected || pickerModel, { selectedId: keyFor(pickerModel), disabled: changingModel });
  find('[data-model-facts]').textContent = (selected || pickerModel) ? describeModelChoice(state)(selected || pickerModel).facts || modelFacts(selected || pickerModel) : '';
  const preview = modelExecutionState(selected, pickerLocation);
  const available = selected && (preview.usable || pickerLocation === 'local' && state.activeThread?.permissions?.sharingScope === 'local' && isDownloadableBaseModel(selected) && !state.localDownloadIssue);
  // One row per computer: this device, the paired or invited computer, and contributors.
  const pressed = destination === 'desktop' ? 'desktop' : destination === 'contributors' ? 'network'
    : destination === 'device' ? 'local' : pickerLocation === 'local' ? 'local' : 'network';
  for (const button of find('[data-execution-location]').querySelectorAll('[data-execution-choice]')) {
    const choice = button.dataset.executionChoice;
    if (choice === 'desktop') {
      button.hidden = !locked;
      if (locked) button.querySelector('[data-computer-desktop-name]').textContent = locked.label;
    }
    if (choice === 'network') button.hidden = !!locked?.guest;
    button.querySelector('[data-computer-state]').textContent = computerState(choice, { state, selected, locked, canDownload });
    button.setAttribute('aria-pressed', String(choice === pressed));
    button.disabled = changingModel || !!state.activeThread?.closed || (state.runningIds || []).includes(state.selectedId)
      || localOnly && choice !== 'local';
  }
  // A model nobody is sharing that this device could store is not a dead end: the same button downloads it.
  const downloadable = !available && !!selected && canDownloadModelHere(selected, state, canDownload);
  const switchToLocal = !available && pickerLocation === 'network' && (downloadable || modelExecutionState(selected, 'local').usable);
  find('[data-switch-local]').hidden = !switchToLocal;
  find('[data-switch-local]').disabled = changingModel || state.acquisition?.phase === 'downloading';
  const reviewDownload = downloadable && pickerLocation !== 'network';
  find('[data-change-model]').disabled = changingModel || !(available || reviewDownload);
  find('[data-change-model]').textContent = reviewDownload ? 'Download model…' : 'Done';
  const status = find('[data-next-model-status]');
  let statusText = '';
  if (!pickerModel) statusText = 'No model is available right now.';
  else if (switchToLocal && state.acquisition?.modelId === selected.id && state.acquisition.phase === 'downloading') statusText = state.acquisition.progress?.message || 'Downloading model…';
  else if (switchToLocal && state.acquisition?.modelId === selected.id && state.acquisition.phase === 'failed') statusText = state.acquisition.error;
  else if (switchToLocal) statusText = downloadable ? 'Unavailable on the network. Running here requires a download.' : 'Unavailable on the network. This model is on your device.';
  else if (downloadable) statusText = 'This model is not on this device yet. Download it to run it here.';
  else if (!available) {
    statusText = pickerLocation === 'local' ? 'This model is not prepared on this device.' : 'No shared computer can answer with this model right now.';
  }
  status.textContent = statusText;
  status.hidden = !status.textContent;

  return pickerModel;
}
