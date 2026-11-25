import {
  createExecutionPolicy, validateExecutionPolicy, compileExecutionRequirements, executionRequirementsFor, EXECUTION_BACKENDS
} from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { computerLabel } from './computer-labels.js';
import { renderDialog, renderOption, updateOption } from '../components/choices.js';
import { escapeHtml } from '../components/attachments.js';
import { privacyPresetChoices, CONFIDENTIAL_TARGET } from './choice-availability.js';

/**
 * Execution presets. Each one is a set of inference API requirements (placement, participants, confidentiality,
 * allowed metadata); the dialog states its availability and what it exposes before Send.
 *  - standard: approved computers may read the content.
 *  - own-devices: executor-readable, limited to this device and the desktop this device paired with.
 *  - no-device: requester-only confidentiality, a planned target. No backend qualifies today, so it is shown
 *    disabled with that reason and never applied.
 */
export const EXECUTION_PRESETS = Object.freeze(['standard', 'own-devices', 'no-device']);
const METADATA_WORDS = { 'model-id': 'model identity', timing: 'timing', length: 'message sizes', 'access-patterns': 'access patterns' };
const words = items => items.map(item => METADATA_WORDS[item] || item);
const sentence = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
// A plaintext executor reads the content, so it also sees access patterns; the rest can reach the carriers too.
const NETWORK_METADATA = words(EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata.filter(item => item !== 'access-patterns'));

/** The preset a stored policy stands for, given this device's own paired desktop (if any). */
export function presetForPolicy(policy, ownDevices = []) {
  let requirements;
  try { requirements = executionRequirementsFor(policy); } catch { return null; }
  if (requirements.confidentiality === 'requester-only') return 'no-device';
  if (requirements.placement === 'local-only') return 'own-devices';
  const { participants } = requirements;
  return participants.kind === 'named' && participants.ids.every(id => ownDevices.includes(id)) ? 'own-devices' : 'standard';
}

/** The policy a preset selects, keeping the current choice when it already satisfies the preset. */
export function policyForPreset(preset, current, ownDevices = []) {
  if (preset === 'no-device') {
    // The one compiler refuses it with CONFIDENTIAL_EXECUTION_UNAVAILABLE; it is never stored as a weaker policy.
    return compileExecutionRequirements({ placement: 'network-allowed', participants: { kind: 'open' },
      confidentiality: 'requester-only', allowMetadata: [] });
  }
  if (!EXECUTION_PRESETS.includes(preset)) throw new Error('Choose an execution preset.');
  if (current && presetForPolicy(current, ownDevices) === preset) return validateExecutionPolicy(current);
  if (preset === 'standard') return createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
  return ownDevices.length ? createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [...ownDevices] } })
    : createExecutionPolicy();
}

/** Availability and exposure, stated before Send. `desktop` is this device's paired desktop label, if one is paired. */
export function presetDisclosure(preset, { desktop = null } = {}) {
  if (preset === 'standard') {
    return `Available. The computer that answers reads your content in plaintext and can see its access patterns, and you approve it before anything is sent. The request's ${sentence(NETWORK_METADATA)} can also be visible to the coordinators, credit ledgers and relays that carry the request.`;
  }
  if (preset === 'own-devices') {
    return desktop
      ? `Available on this device and ${desktop}. They run the model and read your content in plaintext, so they can also see its access patterns; no other computer can read it. When ${desktop} answers, a relay that carries the connection can see its timing and message sizes. ${desktop} counts as yours because you approved its pairing code.`
      : 'Available on this device only; pair a desktop to add it. Nothing leaves this device, and no network participant sees its metadata.';
  }
  return `${CONFIDENTIAL_TARGET} No backend qualifies today, so a request that requires it is refused before anything is sent.`;
}

export function allowsOpenPlaintext(policy) {
  try {
    const requirements = executionRequirementsFor(policy);
    return requirements.placement === 'network-allowed' && requirements.participants.kind === 'open'
      && requirements.confidentiality === 'executor-readable'
      && EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata.every(item => requirements.allowMetadata.includes(item));
  } catch { return false; }
}

// One single-select list: title and one status line per preset. The checked preset's full exposure statement
// (metadata that coordinators and relays can see) waits in a collapsed "What else can be seen" disclosure.
const presetOptions = () => privacyPresetChoices().map(({ value, title, status, disabled }) => renderOption({
  id: `chat-privacy-${value}`, name: 'execution-preset', value, title: escapeHtml(title), status: escapeHtml(status), disabled,
  inputAttrs: { 'data-privacy-preset': true }, statusAttrs: { 'data-preset-status': value }
})).join('');

export const renderPrivacyControls = () => renderDialog({
  titleId: 'chat-privacy-title', title: 'Who can read your messages',
  attrs: { id: 'chat-privacy-dialog', 'data-privacy-dialog': true },
  closeAttrs: { 'data-dialog-close': true },
  body: `<fieldset class="pool-options" role="radiogroup" aria-labelledby="chat-privacy-title" data-privacy-controls>${presetOptions()}</fieldset>
    <p class="pool-caption pool-muted">Applies to new messages only.</p>
    <details class="pool-disclosure pool-disclosure-quiet" data-privacy-detail><summary class="pool-small">What else can be seen</summary>
      <div class="pool-reserve pool-small pool-muted">${EXECUTION_PRESETS.map(preset => `<p data-preset-note="${preset}" hidden></p>`).join('')}</div></details>`,
  footer: '<p class="pool-status-line" role="alert" data-privacy-error hidden></p><button type="button" class="pool-button btn-ghost" data-privacy-cancel>Cancel</button><button type="button" class="pool-button btn-primary" data-privacy-apply>Apply</button>'
});

const ownDevicesOf = context => context?.desktop?.id ? [context.desktop.id] : [];

/** The policy for the checked preset. `context.desktop` is { id, label } of this device's paired desktop. */
export function readPrivacyControls(root, context = {}) {
  const checked = root.querySelector('[data-privacy-preset]:checked');
  if (!checked) throw new Error('Choose who can read your content.');
  return policyForPreset(checked.value, context.current ?? null, ownDevicesOf(context));
}

/** Refresh each preset's availability line and show the checked preset's exposure statement. */
export function showPrivacyChoices(root, context = {}, { editable = true } = {}) {
  const checked = root.querySelector('[data-privacy-preset]:checked')?.value ?? null;
  for (const choice of privacyPresetChoices({ desktop: context.desktop?.label ?? null, editable })) {
    updateOption(root.querySelector(`[data-privacy-preset][value="${choice.value}"]`), { status: choice.status, disabled: choice.disabled });
  }
  for (const preset of EXECUTION_PRESETS) {
    const note = root.querySelector(`[data-preset-note="${preset}"]`);
    if (!note) continue;
    note.textContent = presetDisclosure(preset, { desktop: context.desktop?.label ?? null });
    note.hidden = preset !== checked;
  }
  root.querySelector('[data-privacy-error]').hidden = true;
}

/** The preset a stored policy stands for and its name, as the composer's privacy button states it. */
export function namedPrivacyPreset(privacy, context = {}) {
  let preset = null;
  try { preset = presetForPolicy(validateExecutionPolicy(privacy), ownDevicesOf(context)); }
  catch { /* An unsupported policy is named as such, never as a preset it is not. */ }
  return { preset, label: preset === 'standard' ? 'Standard' : preset === 'own-devices' ? 'Only your devices' : 'Fixed requirements' };
}

export function updatePrivacyControls(root, privacy, context = {}) {
  const fields = root.querySelector('[data-privacy-controls]');
  const apply = root.querySelector('[data-privacy-apply]');
  const notice = root.querySelector('[data-privacy-error]');
  let preset = null;
  try { preset = presetForPolicy(validateExecutionPolicy(privacy), ownDevicesOf(context)); }
  catch { /* Unsupported policies must not be converted to plaintext by opening this dialog. */ }
  for (const input of root.querySelectorAll('[data-privacy-preset]')) input.checked = input.value === preset;
  const editable = preset === 'standard' || preset === 'own-devices';
  showPrivacyChoices(root, context, { editable });
  fields.disabled = !editable;
  apply.disabled = !editable;
  notice.textContent = editable ? '' : 'This conversation has requirements these presets cannot express. It is read-only here.';
  notice.hidden = editable;
}

const CHECKED_WORDS = { 'content-recipients': 'recipients before sending', 'content-stayed-on-requester-device': 'content stayed on this device',
  'model-identity': 'model identity', 'adapter-identities': 'adapters', 'stream-matches-answer': 'streamed text' };

/** Summary and detail of an answer's execution receipt: who could read it, and only what this browser checked. */
export function answerPrivacy(execution, state) {
  const receipt = execution?.receipt;
  const route = receipt?.route;
  if (receipt?.schema !== 'reploid.execution-receipt/v1' || !route || !Array.isArray(route.participants)
    || !route.participants.every(id => typeof id === 'string' && id.length)) {
    return ['Disclosure unrecorded', 'This answer has no supported execution receipt.'];
  }
  const local = route.shape === 'local';
  const names = local ? ['This device'] : [...new Set(route.participants)].map(id => computerLabel(state || {}, id));
  const summary = `Readable by ${names.length > 1 ? `${names.length} computers` : names[0]}`;
  const checked = [...receipt.evidence.confidentiality.verified, ...receipt.evidence.integrity.verified]
    .map(item => CHECKED_WORDS[item.claim] || item.claim);
  const exposed = words(receipt.disclosures?.metadata || []);
  return [summary, [`Readable by ${names.join(' · ')}`,
    exposed.length ? `Exposed: ${exposed.join(', ')}` : null,
    `Checked here: ${checked.join(', ') || 'nothing'}`,
    'Not checked: recipient conduct, erasure, correct computation'].filter(Boolean).join('. ') + '.'];
}
