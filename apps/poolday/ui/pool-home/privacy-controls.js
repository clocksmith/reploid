import {
  createExecutionPolicy, validateExecutionPolicy, executionRequirementsFor, EXECUTION_BACKENDS
} from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { PROTECTION_DISPLAY, SPLIT_DISPLAY, splitReadersLine, protectionLabel } from '../../../../shared/vendor/reploid/inference/protections.js';
import { computerLabel } from './computer-labels.js';
import { renderDialog, renderOptions, updateOption } from '../components/choices.js';
import { escapeHtml } from '../components/attachments.js';
import { protectionChoices, routeChoices, ownDevicesChoice } from './choice-availability.js';
import { executionRouteFor } from '../../host/execution-route.js';

/**
 * "Who can read it?" Two separate choices, each a set of inference API requirements the thread sends on every request:
 *  - protection (`execution.protection`): how data is processed. This browser runs plaintext only; every other
 *    protection is listed, not ranked, and disabled with its reason. It is never stored as a weaker one.
 *  - where it runs (`execution.route`): this device, one computer, several computers, several computers with your devices
 *    at both ends, or let it choose. Each route this chat cannot use is disabled with its reason.
 *  - only your devices: a participants choice, not a route (plaintext named to the desktop this device paired with).
 */
export const EXECUTION_PRESETS = Object.freeze(['standard', 'own-devices']);
const METADATA_WORDS = { 'model-id': 'model identity', timing: 'timing', length: 'message sizes', 'access-patterns': 'access patterns' };
const words = items => items.map(item => METADATA_WORDS[item] || item);
const sentence = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
// A plaintext executor reads the content, so it also sees access patterns; the rest can reach the carriers too.
const NETWORK_METADATA = words(EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata.filter(item => item !== 'access-patterns'));

const requirementsOf = policy => { try { return executionRequirementsFor(policy); } catch { return null; } };

/** The placement preset a stored plaintext policy stands for, given this device's own paired desktop (if any). */
export function presetForPolicy(policy, ownDevices = []) {
  const requirements = requirementsOf(policy);
  if (!requirements || requirements.protection !== 'plaintext') return null;
  if (requirements.route === 'local') return 'own-devices';
  const { participants } = requirements;
  return participants.kind === 'named' && participants.ids.every(id => ownDevices.includes(id)) ? 'own-devices' : 'standard';
}

/** The plaintext policy a placement preset selects, keeping the current choice when it already satisfies the preset. */
export function policyForPreset(preset, current, ownDevices = []) {
  if (!EXECUTION_PRESETS.includes(preset)) throw new Error('Choose where it runs.');
  if (current && presetForPolicy(current, ownDevices) === preset) return validateExecutionPolicy(current);
  if (preset === 'standard') return createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
  return ownDevices.length ? createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [...ownDevices] } })
    : createExecutionPolicy();
}

/** What else can be seen, stated before Send. `desktop` is this device's paired desktop label, if one is paired. */
export function presetDisclosure(preset, { desktop = null } = {}) {
  if (preset === 'standard') {
    return `The computer that answers reads your content in plaintext and can see its access patterns, and you approve it before anything is sent. The request's ${sentence(NETWORK_METADATA)} can also be visible to the coordinators, credit ledgers and relays that carry the request.`;
  }
  return desktop
    ? `This device and ${desktop} run the model and read your content in plaintext, so they can also see its access patterns; no other computer can read it. When ${desktop} answers, a relay that carries the connection can see its timing and message sizes. ${desktop} counts as yours because you approved its pairing code.`
    : 'Only this device runs the model. Nothing leaves this device, and no network participant sees its metadata.';
}

export function allowsOpenPlaintext(policy) {
  const requirements = requirementsOf(policy);
  return !!requirements && requirements.protection === 'plaintext' && requirements.route !== 'local'
    && requirements.participants.kind === 'open'
    && EXECUTION_BACKENDS['doppler-plaintext/v1'].metadata.every(item => requirements.allowMetadata.includes(item));
}

const protectionOptions = () => protectionChoices().map(({ value, title, status, disabled }) => ({ key: value, value, title: escapeHtml(title),
  status: escapeHtml(status), disabled, inputAttrs: { 'data-privacy-protection': true }, statusAttrs: { 'data-protection-status': value } }));
const routeOptions = () => routeChoices().map(({ value, title, status, disabled }) => ({ key: value, value, title: escapeHtml(title),
  status: escapeHtml(status), disabled, inputAttrs: { 'data-privacy-route': true }, statusAttrs: { 'data-route-status': value } }));
const ownDevicesOptions = () => [ownDevicesChoice()].map(({ value, title, status, disabled }) => ({ key: value, value, title: escapeHtml(title),
  status: escapeHtml(status), disabled, inputAttrs: { 'data-privacy-own-devices': true }, statusAttrs: { 'data-own-devices-status': true } }));

// Protection, then where it runs (single choices), then the one participants choice. The checked choice's full exposure
// statement (metadata that coordinators and relays can see) waits in a collapsed "What else can be seen" disclosure.
export const renderPrivacyControls = () => renderDialog({
  titleId: 'chat-privacy-title', title: 'Who can read it?',
  attrs: { id: 'chat-privacy-dialog', 'data-privacy-dialog': true },
  closeAttrs: { 'data-dialog-close': true },
  body: `${renderOptions({ id: 'chat-protection', name: 'execution-protection', label: 'How your data is processed', options: protectionOptions(),
    attrs: { 'data-privacy-controls': true, 'data-protection-choices': true } })}
    ${renderOptions({ id: 'chat-route', name: 'execution-route', label: 'Where it runs', options: routeOptions(),
    attrs: { 'data-privacy-controls': true, 'data-route-choices': true } })}
    ${renderOptions({ id: 'chat-participants', name: 'execution-participants', type: 'checkbox', label: 'Who may run it', options: ownDevicesOptions(),
    attrs: { 'data-privacy-controls': true, 'data-participant-choices': true } })}
    <p class="pool-caption pool-muted" data-split-note hidden></p>
    <p class="pool-caption pool-muted">Applies to new messages only.</p>
    <details class="pool-disclosure pool-disclosure-quiet" data-privacy-detail><summary class="pool-small">What else can be seen</summary>
      <div class="pool-reserve pool-small pool-muted">${EXECUTION_PRESETS.map(preset => `<p data-preset-note="${preset}" hidden></p>`).join('')}</div></details>`,
  footer: '<p class="pool-status-line" role="alert" data-privacy-error hidden></p><button type="button" class="pool-button btn-ghost" data-privacy-cancel>Cancel</button><button type="button" class="pool-button btn-primary" data-privacy-apply>Apply</button>'
});

const ownDevicesOf = context => context?.desktop?.id ? [context.desktop.id] : [];
const checkedValue = (root, selector) => [...root.querySelectorAll(selector)].find(input => input.checked)?.value ?? null;
const stageCount = model => new Set(model?.partition?.route?.stages?.map(stage => stage.participantId)
  ?? [model?.partition?.participantA, model?.partition?.participantB].filter(Boolean)).size;

/** The route this conversation sends now: from its policy, its model and its execution location. */
export const conversationRoute = (privacy, context = {}) => executionRouteFor({ privacy, model: context.model ?? null, executionLocation: context.location ?? 'auto' });

/**
 * The checked protection, route and participants as the thread's policy and the route it sends. `context.desktop` is
 * { id, label } of this device's paired desktop; `context.current` is the stored policy, kept when it already fits.
 */
export function readPrivacyControls(root, context = {}) {
  const protection = checkedValue(root, '[data-privacy-protection]');
  if (!protection) throw new Error('Choose who can read your content.');
  // Only plaintext runs in this browser; any other protection is refused here, never stored as plaintext.
  if (protection !== 'plaintext') throw new Error(`${PROTECTION_DISPLAY[protection]?.label ?? protection} is unavailable here. Nothing was changed.`);
  const route = checkedValue(root, '[data-privacy-route]');
  if (!route) throw new Error('Choose where it runs.');
  const own = root.querySelector('[data-privacy-own-devices]');
  const preset = route === 'local' || (own?.checked && !own.disabled) ? 'own-devices' : 'standard';
  const devices = route === 'local' ? [] : ownDevicesOf(context);
  const current = context.current && (requirementsOf(context.current)?.route === 'local') === (route === 'local') ? context.current : null;
  return { privacy: policyForPreset(preset, current, devices), route };
}

/** Refresh each option's availability line, the split line and the checked choice's exposure statement. */
export function showPrivacyChoices(root, context = {}, { editable = true, protection = checkedValue(root, '[data-privacy-protection]') ?? 'plaintext' } = {}) {
  for (const choice of protectionChoices({ editable, value: protection })) {
    updateOption(root.querySelector(`[data-privacy-protection][value="${choice.value}"]`), { status: choice.status, disabled: choice.disabled });
  }
  const route = checkedValue(root, '[data-privacy-route]') ?? 'auto';
  for (const choice of routeChoices({ model: context.model ?? null, canRunHere: context.canRunHere !== false, editable, value: route })) {
    updateOption(root.querySelector(`[data-privacy-route][value="${choice.value}"]`), { status: choice.status, disabled: choice.disabled });
  }
  const own = root.querySelector('[data-privacy-own-devices]');
  const ownChoice = ownDevicesChoice({ desktop: context.desktop?.label ?? null, route, editable, checked: !!own?.checked });
  updateOption(own, { status: ownChoice.status, disabled: ownChoice.disabled });
  if (own && ownChoice.disabled) own.checked = false;
  // Any plaintext split names how many computers can read the message; requester-held edges keep their own line.
  const note = root.querySelector('[data-split-note]');
  const split = protection === 'plaintext' && (route === 'split' || route === 'split-local-edges');
  note.textContent = !split ? '' : route === 'split-local-edges' ? SPLIT_DISPLAY['requester-edges'].line : splitReadersLine(stageCount(context.model));
  note.hidden = !split;
  const preset = route === 'local' || own?.checked ? 'own-devices' : 'standard';
  for (const name of EXECUTION_PRESETS) {
    const node = root.querySelector(`[data-preset-note="${name}"]`);
    if (!node) continue;
    node.textContent = presetDisclosure(name, { desktop: route === 'local' ? null : context.desktop?.label ?? null });
    node.hidden = name !== preset;
  }
  root.querySelector('[data-privacy-error]').hidden = true;
}

/** The composer chip: the thread's protection label, plus "Your devices" when it runs only on them. */
export function namedPrivacyPreset(privacy, context = {}) {
  let preset = null, requirements = null;
  try { requirements = executionRequirementsFor(validateExecutionPolicy(privacy)); preset = presetForPolicy(privacy, ownDevicesOf(context)); }
  catch { /* An unsupported policy is named as such, never as a preset it is not. */ }
  const protection = protectionLabel(requirements?.protection);
  const label = !protection ? 'Fixed requirements' : preset === 'own-devices' ? `${protection} · Your devices` : protection;
  return { preset, protection: requirements?.protection ?? null, label };
}

/** `context`: { desktop, model, location, canRunHere }. */
export function updatePrivacyControls(root, privacy, context = {}) {
  const apply = root.querySelector('[data-privacy-apply]');
  const notice = root.querySelector('[data-privacy-error]');
  let preset = null, requirements = null;
  try { requirements = executionRequirementsFor(validateExecutionPolicy(privacy)); preset = presetForPolicy(privacy, ownDevicesOf(context)); }
  catch { /* Unsupported policies must not be converted to plaintext by opening this dialog. */ }
  const protection = requirements?.protection ?? null;
  const route = requirements ? conversationRoute(privacy, context) : null;
  for (const input of root.querySelectorAll('[data-privacy-protection]')) input.checked = input.value === protection;
  for (const input of root.querySelectorAll('[data-privacy-route]')) input.checked = input.value === route;
  const own = root.querySelector('[data-privacy-own-devices]');
  if (own) own.checked = route !== 'local' && preset === 'own-devices';
  const editable = preset === 'standard' || preset === 'own-devices';
  showPrivacyChoices(root, context, { editable, protection: protection ?? 'plaintext' });
  apply.disabled = !editable;
  notice.textContent = editable ? '' : 'This conversation has requirements these choices cannot express. It is read-only here.';
  notice.hidden = editable;
}

const CHECKED_WORDS = { 'content-recipients': 'recipients before sending', 'content-stayed-on-requester-device': 'content stayed on this device',
  'model-identity': 'model identity', 'adapter-identities': 'adapters', 'stream-matches-answer': 'streamed text' };

/** Summary and detail of an answer's execution receipt: its protection, who could read it, and only what this browser checked. */
export function answerPrivacy(execution, state) {
  const receipt = execution?.receipt;
  const route = receipt?.route;
  if (receipt?.schema !== 'reploid.execution-receipt/v2' || !route || !Array.isArray(route.participants)
    || !route.participants.every(id => typeof id === 'string' && id.length)) {
    return ['Disclosure unrecorded', 'This answer has no supported execution receipt.'];
  }
  const local = route.shape === 'local';
  const names = local ? ['This device'] : [...new Set(route.participants)].map(id => computerLabel(state || {}, id));
  const summary = `Readable by ${names.length > 1 ? `${names.length} computers` : names[0]}`;
  const checked = [...(receipt.evidence?.privacy?.checks || []), ...(receipt.evidence?.integrity?.checks || [])]
    .map(item => CHECKED_WORDS[item.claim] || item.claim);
  const exposed = words(receipt.disclosure?.metadata?.items || []);
  const protection = protectionLabel(receipt.protection);
  return [summary, [protection ? `Protection: ${protection}` : null, `Readable by ${names.join(' · ')}`,
    exposed.length ? `Exposed: ${exposed.join(', ')}` : null,
    `Checked here: ${checked.join(', ') || 'nothing'}`,
    'Not checked: recipient conduct, erasure, correct computation'].filter(Boolean).join('. ') + '.'];
}
