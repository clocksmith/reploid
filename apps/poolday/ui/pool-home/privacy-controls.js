import {
  createExecutionPolicy, validateExecutionPolicy, executionRequirementsFor, EXECUTION_BACKENDS
} from '../../../../shared/vendor/reploid/chat/execution-policy.js';
import { protectionLabel } from '../../../../shared/vendor/reploid/inference/protections.js';
import { computerLabel } from './computer-labels.js';
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

const ownDevicesOf = context => context?.desktop?.id ? [context.desktop.id] : [];

/** The route this conversation sends now: from its policy, its model and its execution location. */
export const conversationRoute = (privacy, context = {}) => executionRouteFor({ privacy, model: context.model ?? null, executionLocation: context.location ?? 'auto' });

/** The composer chip: the thread's protection label, plus "Your devices" when it runs only on them. */
export function namedPrivacyPreset(privacy, context = {}) {
  let preset = null, requirements = null;
  try { requirements = executionRequirementsFor(validateExecutionPolicy(privacy)); preset = presetForPolicy(privacy, ownDevicesOf(context)); }
  catch { /* An unsupported policy is named as such, never as a preset it is not. */ }
  const protection = protectionLabel(requirements?.protection);
  const label = !protection ? 'Fixed requirements' : preset === 'own-devices' ? `${protection} · Your devices` : protection;
  return { preset, protection: requirements?.protection ?? null, label };
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
