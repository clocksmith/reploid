/**
 * Which choices are possible right now, derived from capability and state rather than static lists.
 * Each function returns options in the `renderOption` shape: an option that cannot work now is
 * `disabled` with its reason in `status`, and a `fix` when one exists. Nothing here changes state;
 * a fix only opens the place where the person decides.
 */
import { ROUTE_PREFERENCES } from '../../host/route-preference.js';
import { promptDisclosure } from '../../host/decisions/prompt-disclosure.js';
import { modelKey, storedHere } from '../../host/decisions/model-state.js';
import { PROTECTION_DISPLAY, ROUTE_DISPLAY, PARTICIPANTS_DISPLAY, gatedCapabilities } from '../../../../shared/vendor/reploid/inference/protections.js';

const LOCKED = 'This conversation’s requirements are fixed.';

/**
 * "Who can read it?": one row per protection, in the shared order (not ranked), with the shared label and line. A
 * protection this page cannot run is disabled with "Unavailable" and its reason. This browser runs plaintext only, so
 * the default capabilities come from host configuration alone; they are advisory, never permission to send.
 */
export function protectionChoices({ capabilities = gatedCapabilities({ enabled: ['plaintext'] }), editable = true, value = 'plaintext' } = {}) {
  return capabilities.map(({ protection, status, reason }) => {
    const unavailable = status === 'unavailable';
    // Standard is the plaintext row: its line is the who-can-read sentence of that row.
    const line = protection === 'plaintext' ? promptDisclosure({ site: 'protection' }) : PROTECTION_DISPLAY[protection].line;
    return { value: protection, title: PROTECTION_DISPLAY[protection].label, checked: protection === value,
      disabled: unavailable || !editable,
      // The line always shows; an unavailable protection adds "Unavailable" and its reason after it.
      status: unavailable ? `${line} Unavailable: ${reason[0].toUpperCase()}${reason.slice(1)}.`
        : !editable ? LOCKED : line };
  });
}

/**
 * "Where it runs": the five `execution.route` values, single choice. A route this chat cannot use is disabled with its
 * reason. `model` is the conversation's model (a staged model runs on several computers); `canRunHere` is false when
 * this deployment answers on network computers only.
 */
export function routeChoices({ model = null, canRunHere = true, editable = true, value = 'auto' } = {}) {
  const staged = !!model?.partition;
  const reasons = {
    local: staged ? 'This model runs in stages on several computers.' : !canRunHere ? 'This deployment answers on network computers only.' : null,
    remote: staged ? 'This model runs in stages on several computers.' : null,
    split: staged ? null : 'Only a model that runs in stages uses several computers.',
    'split-local-edges': 'This browser cannot bind both edge devices to you.',
    auto: null
  };
  return Object.entries(ROUTE_DISPLAY).map(([route, { label }]) => {
    const reason = reasons[route];
    return { value: route, title: label, checked: route === value, disabled: !!reason || !editable,
      status: reason ? `Unavailable: ${reason}` : !editable ? LOCKED : ROUTE_LINES[route] };
  });
}
const ROUTE_LINES = {
  local: promptDisclosure({ site: 'route', local: true }),
  remote: 'One other computer runs the whole model.',
  split: 'Several computers run the model in stages.',
  'split-local-edges': 'Several computers run the model; your own devices run the first and last stage.',
  auto: 'Any route the chosen protection allows. The computers that can read it are shown before anything is sent.'
};

/** "Only your devices": a participants choice, not a route. It needs a paired desktop and a network route. */
export function ownDevicesChoice({ desktop = null, route = 'auto', editable = true, checked = false } = {}) {
  const reason = route === 'local' ? promptDisclosure({ site: 'own-devices', local: true }) : !desktop ? 'Pair a desktop in Computers to add it.' : null;
  return { value: 'own-devices', title: PARTICIPANTS_DISPLAY['own-devices'].label, checked: checked && !reason,
    disabled: !!reason || !editable,
    status: reason ? `Unavailable: ${reason}` : !editable ? LOCKED : `This device and ${desktop} process your request. No other computer can.` };
}

/**
 * Route preference only orders computers when more than one may answer: with network answers off,
 * or when the page cannot store a preference, every option is disabled with the reason.
 */
export function routePreferenceChoices({ remoteAnswersEnabled = false, canSet = false, value = 'balanced' } = {}) {
  const reason = !canSet ? 'This page answers on one computer, so there is nothing to order.'
    : !remoteAnswersEnabled ? 'Network answers are off, so only one computer can answer.' : '';
  return {
    reason,
    fix: canSet && !remoteAnswersEnabled ? { label: 'Network answers', action: 'show-network-answers' } : null,
    options: ROUTE_PREFERENCES.map(({ id, label }) => ({ value: id, label, checked: id === value, disabled: !!reason }))
  };
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "Files to share" modes. While files are being shared the mode is fixed; stop sharing to change it. */
export function fileModeChoices({ storedModels = 0, sharing = false, value = 'cached-only' } = {}) {
  const fixed = sharing ? 'Turn off Share model files to change this.' : null;
  return [
    { value: 'cached-only', title: 'Already downloaded',
      status: fixed || (storedModels ? `Shares ${plural(storedModels, 'downloaded model')}. Downloads nothing.`
        : 'Nothing is downloaded yet, so nothing is shared. Downloads nothing.') },
    { value: 'bounded-acquisition', title: 'Download within a limit', status: fixed || 'Downloads files others ask for, up to your allowance.' },
    { value: 'full-model', title: 'Download the full model', status: fixed || 'Downloads and keeps every file of the chosen model.' }
  ].map(option => ({ ...option, checked: option.value === value, disabled: !!fixed }));
}

/**
 * The "Start sharing" dialog's sharing options. An option whose port the page lacks is disabled with
 * the reason; a local download offers sharing but never requires it.
 */
export function sharingOptionChoices({ canShareCompute = false, canShareFiles = false, compute = false, files = false } = {}) {
  return [
    { value: 'compute', title: 'Answer other people’s requests', disabled: !canShareCompute, checked: canShareCompute && compute,
      status: canShareCompute ? 'With downloaded models, while this page is open.' : 'This page cannot share compute.' },
    { value: 'files', title: 'Share cached model files', disabled: !canShareFiles, checked: canShareFiles && files,
      status: canShareFiles ? 'Other computers can download files stored here.' : 'This page cannot share files.' }
  ];
}

/**
 * Web search: on only when a recipient is known. Without one the switch is disabled, the reason is
 * shown beside it and the fix opens the search-server settings.
 */
export function webSearchAvailability({ url = '', builtInAvailable = false } = {}) {
  if (url || builtInAvailable) return { disabled: false, reason: '', fix: null };
  return { disabled: true, reason: 'No search service is available. Add a search server to turn this on.',
    fix: { label: 'Add server', action: 'open-search-server' } };
}

/**
 * The model a new conversation starts with on this device: one stored here (the default first), else the default
 * or first model this device can download. Never a model that only the network runs, so the computer and the model
 * a fresh visitor sees always agree. Returns null when nothing can run here; the caller keeps its own fallback.
 */
export function startingLocalModel(models = [], { defaultModel = null, canDownloadHere = () => false } = {}) {
  const isDefault = model => !!defaultModel && (modelKey(model) === modelKey(defaultModel) || model.id === defaultModel.id);
  const pick = test => models.find(model => isDefault(model) && test(model)) || models.find(test) || null;
  return pick(storedHere) || pick(model => !model.partition && !model.fleet && canDownloadHere(model));
}
