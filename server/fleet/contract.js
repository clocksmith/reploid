import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { participantIdFor, normalizeParticipantPublicKey } from '../../packages/reploid/src/artifacts/participant-proofs.js';

export const assert = (condition, message) => { if (!condition) throw Error(message); };
export const integer = value => Number.isSafeInteger(value) && value >= 0;
export const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
export const same = (a, b) => canonicalize(a) === canonicalize(b);

/** Enrollment comes from the operator, never from a remote advertisement. */
export async function enrollComputers(computers) {
  assert(Array.isArray(computers) && computers.length > 0 && computers.length <= 256, 'Explicit fleet enrollment required');
  const byPeer = new Map(), byId = new Map();
  for (const source of computers) {
    const computer = structuredClone(source);
    assert(text(computer.id) && text(computer.name) && text(computer.ownerId) && !byId.has(computer.id)
      && Array.isArray(computer.providers) && computer.providers.length > 0, 'Invalid computer enrollment');
    byId.set(computer.id, computer);
    for (const provider of computer.providers) {
      const publicJwk = normalizeParticipantPublicKey(provider.publicJwk);
      assert(publicJwk && !Object.hasOwn(provider.publicJwk, 'd'), 'Only public enrollment keys are admitted');
      const participantId = await participantIdFor(publicJwk);
      assert(provider.participantId === participantId && !byPeer.has(participantId), 'Provider key must belong to exactly one enrolled computer');
      byPeer.set(participantId, { computerId: computer.id, ownerId: computer.ownerId, publicJwk });
    }
  }
  return { byId, byPeer };
}

/** A per-attempt ceiling in the enrolled service's existing non-cash unit. */
export function fleetCreditQuote(policy, maxOutputTokens, mode) {
  assert(integer(maxOutputTokens) && maxOutputTokens > 0 && maxOutputTokens <= policy.maxOutputTokens,
    'Output limit exceeds service-credit policy');
  assert(['whole-model', 'partition'].includes(mode), 'Unknown credit execution mode');
  return { schema: 'reploid.service-credit-quote/v1', unit: policy.unit,
    policyVersion: policy.version, creditsPerOutputToken: policy.creditsPerOutputToken,
    maxOutputTokens, maximum: maxOutputTokens * policy.creditsPerOutputToken,
    terminalCharge: mode === 'whole-model' ? policy.wholeModelTerminalCharge ?? null : null };
}

export function creditPolicy(source) {
  const policy = structuredClone(source);
  assert(policy?.schema === 'reploid.service-credit-policy/v1' && policy.unit === 'noncash-service-credit'
    && text(policy.version) && integer(policy.creditsPerOutputToken) && policy.creditsPerOutputToken > 0
    && integer(policy.maxDebt) && integer(policy.maxOutputTokens) && policy.maxOutputTokens > 0
    && integer(policy.maxPendingPerComputer) && policy.maxPendingPerComputer > 0
    && integer(policy.maxClockSkewMs) && integer(policy.maxRequestMs) && policy.maxRequestMs > 0
    && typeof policy.allowSameOwner === 'boolean'
    && (policy.wholeModelTerminalCharge === undefined || policy.wholeModelTerminalCharge === 0),
  'Explicit non-cash credit policy required');
  assert(Number.isSafeInteger(policy.maxOutputTokens * policy.creditsPerOutputToken + policy.maxDebt), 'Credit policy exceeds integer precision');
  return Object.freeze(policy);
}
