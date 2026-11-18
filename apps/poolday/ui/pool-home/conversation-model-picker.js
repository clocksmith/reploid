/** Model-picker presentation only. Selection and execution remain with the caller. */
import { updatePrivacyControls } from './privacy-controls.js';
import { updateModelSelect, modelExecutionState, modelFacts, unavailableModelChoice } from '../components/model-select.js';
import { updateModelProviders } from './model-providers.js';
import { updateAdapterDetails, describeModelChoice } from './model-adapters.js';

export const canDownloadModelHere = (model, state, canDownload) => canDownload && !!model.source && !model.partition && !model.adapters?.length
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

export function updateConversationModelPicker({ find, choices, state, model: pickerModel, location: pickerLocation,
  touched: pickerTouched, changing: changingModel, selectedId, privacy, canDownload }) {
  const keyFor = model => model?.selectionId || model?.id;
  if (!pickerTouched) pickerModel = (state.models || []).find(model => keyFor(model) === selectedId) || pickerModel;
  const models = [...(state.models || [])];
  const selected = (state.models || []).find(model => keyFor(model) === keyFor(pickerModel));
  if (pickerModel && !models.some(model => keyFor(model) === keyFor(pickerModel))) {
    models.push(selected || unavailableModelChoice(pickerModel));
  }
  updatePrivacyControls(find('[data-privacy-controls]'), state.activeThread?.privacy ?? privacy,
    changingModel || !!state.activeThread?.closed || (state.runningIds || []).includes(state.selectedId));
  const preferNetwork = pickerLocation !== 'local';
  find('[data-next-model]').disabled = changingModel;
  updateModelSelect(find('[data-next-model]'), models, { value: keyFor(pickerModel), showAvailability: true, grouped: true, preferNetwork });
  choices.update(models, { grouped: true, preferNetwork, variants: true, compact: true, describe: describeModelChoice(state) });
  // Exact variants remain selectable; provider and format facts stay in the disclosure.
  updateAdapterDetails(find('[data-model-picker]'), state, selected || pickerModel);
  updateModelProviders(find('[data-model-picker]'), state, selected || pickerModel, { selectedId: keyFor(pickerModel), disabled: changingModel });
  find('[data-model-facts]').textContent = (selected || pickerModel) ? describeModelChoice(state)(selected || pickerModel).facts || modelFacts(selected || pickerModel) : '';
  const preview = modelExecutionState(selected, pickerLocation);
  const available = selected && (preview.usable || pickerLocation === 'local' && state.activeThread?.permissions?.sharingScope === 'local' && !!selected.source && !selected.partition && !state.localDownloadIssue);
  for (const button of find('[data-execution-location]').querySelectorAll('[data-execution-choice]')) {
    const location = button.dataset.executionChoice;
    if (location === 'network') button.textContent = selected?.fleet ? 'Private computers' : 'Public network';
    button.setAttribute('aria-pressed', String(location === pickerLocation));
    button.disabled = changingModel || !!state.activeThread?.closed || (state.runningIds || []).includes(state.selectedId)
      || location !== 'auto' && !modelExecutionState(selected, location).usable;
  }
  // A model nobody is sharing that this device could store is not a dead end: the same button downloads it.
  const downloadable = !available && !!selected && canDownloadModelHere(selected, state, canDownload);
  find('[data-change-model]').disabled = changingModel || !(available || downloadable);
  find('[data-change-model]').textContent = downloadable ? 'Download model…' : 'Use model';
  const status = find('[data-next-model-status]');
  let statusText = '';
  if (!pickerModel) statusText = 'No model is available right now.';
  else if (downloadable) statusText = 'This model is not on this device yet. Download it to run it here.';
  else if (!available) {
    statusText = pickerLocation === 'local' ? 'This model is not prepared on this device.' : 'No shared computer can answer with this model right now.';
  }
  status.textContent = statusText;
  status.hidden = !status.textContent;

  return pickerModel;
}
