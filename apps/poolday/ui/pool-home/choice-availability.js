/**
 * Which choices are possible right now, derived from capability and state rather than static lists.
 * Each function returns options in the `renderOption` shape: an option that cannot work now is
 * `disabled` with its reason in `status`, and a `fix` when one exists. Nothing here changes state;
 * a fix only opens the place where the person decides.
 */
import { ROUTE_PREFERENCES } from '../../host/route-preference.js';

/** "Who can read it" presets. Confidential execution is a target, never offered as working. */
export const CONFIDENTIAL_TARGET = 'Not available yet. Planned: no computer, not even the one answering, can read your prompt.';

export function privacyPresetChoices({ desktop = null, editable = true } = {}) {
  const locked = editable ? null : 'This conversation’s requirements are fixed.';
  return [
    { value: 'standard', title: 'Standard', disabled: !editable,
      status: locked || 'The computer that answers reads your messages. You approve it first.' },
    { value: 'own-devices', title: 'Only your devices', disabled: !editable,
      status: locked || (desktop ? `This device and ${desktop} read your messages. No other computer can.`
        : 'This device reads your messages; nothing leaves it. Pair a desktop in Computers to add it.') },
    { value: 'no-device', title: 'Confidential execution', disabled: true, status: CONFIDENTIAL_TARGET }
  ];
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
