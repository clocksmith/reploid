/**
 * The one source of the names and lines shown for `execution.protection`, `route`, reader roles and assumptions. The chat dialog,
 * the CLI and the docs use these strings; tests check the docs against them. Protections are not ranked: list order
 * is not strength. No label promises speed: a latency estimate is shown only from a relevant measurement.
 */
import { PROTECTIONS, PROTECTION_ROUTES, CONFIDENTIAL_EXECUTION_REVIEW_REASON, SECRET_SHARED_REVIEW_REASON, ATTESTED_UNAVAILABLE_REASON } from '../chat/execution-policy.js';

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** "Who can read it?": one row per protection value. */
export const PROTECTION_DISPLAY = freeze({
  plaintext: { label: 'Standard',
    line: 'Computers that process your request can read the data they receive.' },
  'secret-sharing': { label: 'Secret sharing',
    line: 'Each peer gets one share. Two peers on the same stage can combine their shares to read intermediate data. Your device recombines the intermediate results.' },
  homomorphic: { label: 'Compute on encrypted data',
    line: 'Your device keeps the key. Remote computers compute on encrypted values.' },
  attested: { label: 'Verified hardware',
    line: 'Approved software can read your data inside protected hardware. You\'re trusting that hardware and software.' }
});

/** "Where it runs": the `execution.route` values. Not a protection. */
export const ROUTE_DISPLAY = freeze({
  local: { label: 'This device' },
  remote: { label: 'One computer' },
  split: { label: 'Several computers' },
  'split-local-edges': { label: 'Several computers, your devices at both ends' },
  auto: { label: 'Let it choose' }
});

/** A participants choice, not a route: plaintext on `remote` or `split`, named to this device's paired devices. */
export const PARTICIPANTS_DISPLAY = freeze({
  'own-devices': { label: 'Only your devices', line: 'Only devices you paired with this one can process your request.' }
});

/**
 * Shown for a plaintext split. Any plaintext split names how many computers can read the message; requester-held edges
 * keep their own line. A protected split has its own disclosure, never this warning.
 */
export const SPLIT_DISPLAY = freeze({
  'requester-edges': { line: 'Your devices handle the prompt and answer. Other computers see intermediate data that may reveal both.' }
});
export const splitReadersLine = count => `${count} ${count === 1 ? 'computer' : 'computers'} can read your message.`;

/** Display text for reader roles. The API carries only the codes. */
export const READER_ROLE_DISPLAY = freeze({
  'requester-device': 'this device',
  'requester-edge-device': 'your devices at both ends',
  'answering-computer': 'the computer that answers',
  'stage-operator': 'the computers that run each stage',
  'share-holder': 'peers that each hold one share',
  evaluator: 'the computer that computes on encrypted values',
  carrier: 'coordinators, credit ledgers and relays',
  signaling: 'the signaling server',
  'network-observer': 'observers of the network'
});

/** Display text for assumption codes. */
export const ASSUMPTION_DISPLAY = freeze({
  'recipient-conduct-unchecked': 'Recipients keep what they read: their conduct, retention and erasure are not checked.',
  'named-device-ownership-unchecked': 'Reploid does not check who owns a named device.',
  'edge-devices-bound-to-requester': 'Both edge devices are bound to you; the binding is checked before release, their conduct is not.',
  'activations-may-reveal-content': 'Intermediate data is plaintext model state and may reveal the prompt and the answer.',
  'share-holders-do-not-collude': 'Two peers on the same stage do not combine their shares.',
  'requester-recombines-intermediates': 'Your device recombines the intermediate results.',
  'semi-honest-operators': 'Peers follow the protocol and return correct results; nothing here checks them.',
  'not-independently-reviewed': 'Not independently reviewed.',
  'parameters-not-estimated': 'The parameters have not been security-estimated.',
  'insecure-development-parameters': 'Insecure development parameters: the evaluator can read everything it receives.',
  'requester-key-holder-unchecked': 'Your device\'s key holder alone holds the secret key; this client does not check it.',
  'traps-detect-blind-tampering-only': 'Known-answer checks detect only blind tampering.',
  'trap-oracle-does-not-collude': 'The trap oracle does not collude with the evaluator.',
  'hardware-vendor-trusted': 'You trust the hardware vendor and the approved software.'
});

const sentence = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const describeReader = reader => {
  const base = READER_ROLE_DISPLAY[reader.role] ?? reader.role;
  const named = reader.ids?.length ? ` (${reader.ids.join(', ')})` : '';
  return reader.when?.collusion ? `${reader.when.collusion.count} ${base} on the same stage, if they combine their shares${named}` : base + named;
};
const SECTION_WORDS = { prompt: 'Your prompt', intermediate: 'Intermediate data', answer: 'The answer' };

/** One sentence per section, then the assumptions: the display form of a plan's disclosure codes. */
export function describeDisclosure(disclosure) {
  const lines = Object.entries(SECTION_WORDS).map(([key, words]) => {
    const readers = disclosure[key]?.readers;
    return readers === 'unknown' ? `${words}: who can read it is unknown.` : `${words}: read by ${sentence((readers ?? []).map(describeReader))}.`;
  });
  const metadata = disclosure.metadata?.items ?? [];
  if (metadata.length) lines.push(`Visible metadata: ${metadata.join(', ')}.`);
  return [...lines, ...(disclosure.trustAssumptions ?? []).map(code => ASSUMPTION_DISPLAY[code] ?? code)].join(' ');
}

/** How many distinct computers other than this device can read the prompt, for the plaintext split line. */
export function promptReaderCount(disclosure) {
  const readers = disclosure?.prompt?.readers;
  if (!Array.isArray(readers)) return null;
  return new Set(readers.filter(reader => reader.role !== 'requester-device').flatMap(reader => reader.ids ?? [])).size;
}

export const protectionLabel = protection => PROTECTION_DISPLAY[protection]?.label ?? null;

/** Reasons a host's configuration makes a protection unavailable before any route is resolved. */
export const PROTECTION_GATE_REASONS = freeze({
  'secret-sharing': SECRET_SHARED_REVIEW_REASON,
  homomorphic: CONFIDENTIAL_EXECUTION_REVIEW_REASON,
  attested: ATTESTED_UNAVAILABLE_REASON
});

/**
 * Capabilities from host configuration alone, for surfaces that cannot resolve a route (the browser bridge refuses
 * every protection but plaintext). Advisory, never permission to send: prepare and run still check everything.
 * `enabled` lists the protections whose route this host enabled; plaintext is always enabled.
 */
export function gatedCapabilities({ enabled = ['plaintext'], at = Date.now() } = {}) {
  const checkedAt = new Date(at).toISOString();
  return freeze(PROTECTIONS.map(protection => {
    const on = protection === 'plaintext' || (protection !== 'attested' && enabled.includes(protection));
    const row = on ? { status: 'unknown', reason: 'enabled on this host; no route was resolved' }
      : { status: 'unavailable', reason: PROTECTION_GATE_REASONS[protection] };
    return { protection, ...row, checked: ['host-configuration'], checkedAt,
      routes: PROTECTION_ROUTES[protection].map(route => ({ route, ...row, checked: ['host-configuration'], checkedAt })) };
  }));
}
