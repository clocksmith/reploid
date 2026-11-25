/** Model-picker presentation only. Selection and execution remain with the caller. */
import { isDownloadableBaseModel, updateModelSelect, modelExecutionState, modelFacts, modelVariantKey, unavailableModelChoice } from '../components/model-select.js';
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

const runsHere = model => modelExecutionState(model, 'local').usable;
const runsOnNetwork = model => modelExecutionState(model, 'network').usable;
const sheetSide = location => location === 'local' ? 'local' : 'network';

/**
 * Why contributors may not answer without an explicit preset change ([confidential execution](../../../../docs/confidential-execution.md)):
 *  - 'own-devices': "Only your devices" is the preset (chosen in "Who can read it", or stored on this thread);
 *  - 'guest': an invite link names the one computer that may read prompts.
 * `null` means the current preset already allows the answering computer to read the prompt.
 */
export function contributorBlock({ guest = false, activeThread = false, privacy = null, preset = null } = {}) {
  if (guest) return 'guest';
  const local = privacy?.placement === 'local-only' || privacy?.recipients?.kind === 'none';
  if (activeThread ? local : preset === 'own-devices') return 'own-devices';
  return null;
}

/** The computer a model tap implies. A model that runs only on contributors moves the sheet to Contributors,
 * and a private-pool model to its pool (it never runs on this device), if the preset allows it; one that runs
 * only here moves it to this device. A paired desktop stays as chosen. */
export function locationForModel(model, location, { block = null, choice = null } = {}) {
  if (!model || choice === 'desktop') return sheetSide(location);
  if (model.fleet) return block ? sheetSide(location) : 'network';
  if (sheetSide(location) === 'local' && !runsHere(model) && runsOnNetwork(model) && !block) return 'network';
  if (sheetSide(location) === 'network' && !runsOnNetwork(model) && runsHere(model)) return 'local';
  return sheetSide(location);
}

/** The model a computer tap keeps: the chosen one if it runs there, else the same variant's route that does,
 * else the most ready model that does. With nothing ready here, a downloadable model stays chosen. */
export function modelForLocation(models, model, location, { state = {}, canDownload = false } = {}) {
  const side = sheetSide(location), runs = side === 'local' ? runsHere : runsOnNetwork;
  if (!model || runs(model)) return model;
  const usable = (models || []).filter(runs);
  const rank = item => side === 'local' ? (item.localReady ? 0 : 1) : (item.networkAvailability === 'ready' ? 0 : 1);
  const same = usable.filter(item => modelVariantKey(item) === modelVariantKey(model));
  const best = [...(same.length ? same : usable)].sort((a, b) => rank(a) - rank(b))[0];
  if (best) return best;
  if (side === 'local' && !canDownloadModelHere(model, state, canDownload)) {
    return (models || []).find(item => canDownloadModelHere(item, state, canDownload)) || model;
  }
  return model;
}

const blockText = model => model?.fleet
  ? 'Only your devices can read this chat, so your private pool can’t answer. Using it lets the answering pool computer read your messages.'
  : 'Only your devices can read this chat, so contributors can’t answer. Using contributors lets the answering computer read your messages.';

/**
 * What the sheet's selection means, as one sentence beside the chosen model and the one action that fixes it.
 * `action` is 'commit', 'use-contributors', 'use-device', 'download' or null (nothing on this sheet can fix it).
 * The primary button always says what it does; it is disabled only while nothing can.
 */
export function describeAnswerChoice(model, location, { state = {}, block = null, canDownload = false, choice = null,
  locked = null, sending = false } = {}) {
  const side = sheetSide(location);
  const here = runsHere(model), there = runsOnNetwork(model);
  const downloadable = !!model && canDownloadModelHere(model, state, canDownload);
  const acquiring = model && state.acquisition?.modelId === model.id ? state.acquisition : null;
  const desktop = side !== 'local' && choice === 'desktop' && locked ? locked.label : null;
  const remote = model?.fleet ? 'your private computers' : 'contributors';
  const label = side === 'local' ? `${sending ? 'Send' : 'Answer'} on this device`
    : desktop ? `${sending ? 'Send to' : 'Answer on'} ${desktop}` : sending ? `Send to ${remote}` : `Answer with ${remote}`;
  const useRemote = model?.fleet ? 'Use private computers' : 'Use contributors';
  const ready = { issue: null, action: 'commit', label };
  const stuck = text => ({ issue: text, action: null, label: ready.label });
  const fix = (text, action, label) => ({ issue: text, action, label });
  if (!model) return stuck('No model is available right now. Models appear here as computers share them.');
  if (acquiring?.phase === 'downloading') return stuck(acquiring.progress?.message || 'Downloading to this device…');
  if (side === 'local') {
    if (here) return ready;
    if ((there || model.fleet) && block !== 'guest') {
      return block ? fix(blockText(model), 'use-contributors', useRemote)
        : fix(`This model runs on ${model.fleet ? 'your private computers' : 'contributors’ computers'}, not this device. The answering computer reads your messages.`, 'use-contributors', useRemote);
    }
    if (downloadable) return fix(acquiring?.phase === 'failed' ? acquiring.error : 'Not on this device yet. Download it to run it here; you see its size first.', 'download', 'Download');
    return stuck(state.localDownloadIssue || 'Nothing can run this model right now. Choose a model marked Ready or On this device.');
  }
  if (block === 'guest') return there || choice === 'desktop' ? ready : stuck(`Only ${locked?.label || 'the inviting computer'} may read your messages. Choose a model it runs.`);
  if (block && there) return fix(blockText(model), 'use-contributors', useRemote);
  if (there || choice === 'desktop') return ready;
  if (here) return fix('No contributor serves this model now. It is on this device.', 'use-device', 'Use this device');
  if (downloadable) return fix(acquiring?.phase === 'failed' ? acquiring.error : 'No contributor serves this model now. Download it to run it on this device; you see its size first.', 'download', 'Download');
  if (['loading', 'preparing'].includes(model.networkAvailability)) return stuck('A contributor is preparing this model. It becomes Ready here when it can answer.');
  if (state.discoveryPhase === 'searching') return stuck('Finding computers… This model becomes Ready here when one shares it.');
  return stuck('No shared computer can answer with this model right now. Choose a model marked Ready.');
}

const computerState = (choice, { state, selected, locked, canDownload, block }) => {
  if (choice === 'desktop') {
    return { online: 'Ready', pairing: 'Connecting…', joining: 'Connecting…', connecting: 'Connecting…', offline: 'Offline',
      invited: 'Tap Join' }[locked?.status] || 'Not connected';
  }
  if (choice === 'local') {
    if (runsHere(selected)) return 'Ready';
    return selected && canDownloadModelHere(selected, state, canDownload) ? 'Download needed' : 'Runs stored models';
  }
  if (block === 'own-devices') return 'Off · Only your devices';
  if (runsOnNetwork(selected)) return 'Ready';
  if ((state.models || []).some(runsOnNetwork)) return 'Not serving this model';
  return state.discoveryPhase === 'searching' ? 'Finding computers…' : 'None available';
};

// The list keeps one fixed order whichever computer is pressed: where each model runs is its group.
// These groups stay in place while discovery runs, so the list never jumps as capacity arrives.
const stableGroups = state => ({ local: 'No model is stored on this device.',
  shared: state.discoveryPhase === 'searching' ? 'Finding computers…' : 'No contributor shares a model right now.' });

/** Renders the sheet for the caller's staged model and computer. Returns the staged model and what the primary does. */
export function updateConversationModelPicker({ find, choices, state, model: pickerModel, location: pickerLocation,
  touched: pickerTouched, changing: changingModel, selectedId, canDownload, destination = null, locked = null,
  block = null, sending = false, issue }) {
  const keyFor = model => model?.selectionId || model?.id;
  if (!pickerTouched) pickerModel = (state.models || []).find(model => keyFor(model) === selectedId) || pickerModel;
  const models = [...(state.models || [])];
  const selected = (state.models || []).find(model => keyFor(model) === keyFor(pickerModel));
  if (pickerModel && !models.some(model => keyFor(model) === keyFor(pickerModel))) {
    models.push(selected || unavailableModelChoice(pickerModel));
  }
  const side = sheetSide(pickerLocation);
  find('[data-next-model]').disabled = changingModel;
  updateModelSelect(find('[data-next-model]'), models, { value: keyFor(pickerModel), showAvailability: true, grouped: true, preferNetwork: false });
  choices.update(models, { grouped: true, preferNetwork: false, variants: true, compact: true,
    describe: describeModelChoice(state), keep: stableGroups(state) });
  // Exact variants remain selectable; provider and format facts stay in the disclosure.
  updateAdapterDetails(find('[data-model-picker]'), state, selected || pickerModel);
  updateModelProviders(find('[data-model-picker]'), state, selected || pickerModel, { selectedId: keyFor(pickerModel), disabled: changingModel });
  find('[data-model-facts]').textContent = (selected || pickerModel) ? describeModelChoice(state)(selected || pickerModel).facts || modelFacts(selected || pickerModel) : '';
  // One row per computer: this device, the paired or invited computer, and contributors. Exactly one is pressed,
  // and it is always the side the staged model is judged against.
  const pressed = side === 'local' ? 'local' : destination === 'desktop' && locked ? 'desktop' : 'network';
  for (const button of find('[data-execution-location]').querySelectorAll('[data-execution-choice]')) {
    const choice = button.dataset.executionChoice;
    if (choice === 'desktop') {
      button.hidden = !locked;
      if (locked) button.querySelector('[data-computer-desktop-name]').textContent = locked.label;
    }
    if (choice === 'network') button.hidden = !!locked?.guest;
    button.querySelector('[data-computer-state]').textContent = computerState(choice, { state, selected, locked, canDownload, block });
    button.setAttribute('aria-pressed', String(choice === pressed));
    button.disabled = changingModel || !!state.activeThread?.closed || (state.runningIds || []).includes(state.selectedId);
  }
  const outcome = describeAnswerChoice(selected || (pickerModel ? unavailableModelChoice(pickerModel) : null), side,
    { state, block, canDownload, choice: pressed === 'desktop' ? 'desktop' : null, locked, sending });
  // The reason and its fix sit beneath the chosen model, not in a dead button.
  const status = issue.querySelector('[data-next-model-status]'), fix = issue.querySelector('[data-answer-action]');
  const host = choices.checkedChoice()?.closest('[data-choice-row]') || find('[data-model-picker] .chat-model-choices');
  if (host && issue.parentElement !== host) host.append(issue);
  status.textContent = outcome.issue || '';
  issue.hidden = !outcome.issue;
  fix.hidden = !outcome.action || outcome.action === 'commit';
  fix.textContent = fix.hidden ? '' : outcome.label;
  fix.dataset.answerAction = outcome.action || '';
  fix.disabled = changingModel || outcome.action === 'download' && state.acquisition?.phase === 'downloading';
  const commit = find('[data-change-model]');
  commit.textContent = outcome.label;
  commit.dataset.answerAction = outcome.action || '';
  commit.disabled = changingModel || !outcome.action;
  return { model: pickerModel, outcome };
}
