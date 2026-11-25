import { canonicalize } from '../../shared/vendor/reploid/artifacts/canonical-json.js';
import { participantIdFor, normalizeParticipantPublicKey } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';

export const FLEET_SERVICE_REQUEST_SCHEMA = 'reploid.fleet-service-request/v1';

export const assert = (condition, message) => { if (!condition) throw Error(message); };
export const integer = value => Number.isSafeInteger(value) && value >= 0;
export const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
export const same = (a, b) => canonicalize(a) === canonicalize(b);

/**
 * A credit refusal before any hold or disclosure, with a stable code and the quote it refused. The HTTP text API
 * answers 402 for too few credits and 409 for too many unfinished answers (server/text-requester.js).
 */
export const SERVICE_CREDIT_REFUSAL_STATUS = Object.freeze({ SERVICE_CREDIT_INSUFFICIENT: 402, SERVICE_CREDIT_PENDING_LIMIT: 409 });
export const creditRefusal = (code, message, details) => Object.assign(Error(message), { creditRefusal: { code, ...structuredClone(details) } });

/** Enrollment comes from the operator, never from a remote advertisement. A self-serve ledger may start
 * empty (`allowEmpty`) and append accounts through its own enrollment journal (credits.js). An optional
 * `debtLimit` lowers the policy's debt limit for one account; `revokedAt` on a key refuses its later requests. */
export async function enrollComputers(computers, { allowEmpty = false } = {}) {
  assert(Array.isArray(computers) && (allowEmpty || computers.length > 0) && computers.length <= 256, 'Explicit fleet enrollment required');
  const enrollment = { byId: new Map(), byPeer: new Map() };
  for (const source of computers) await enrollComputer(enrollment, source);
  return enrollment;
}

/** Add one computer record to an enrollment, checking it exactly as an operator enrollment file is checked. */
export async function enrollComputer({ byId, byPeer }, source) {
  const computer = structuredClone(source);
  assert(text(computer.id) && text(computer.name) && text(computer.ownerId) && !byId.has(computer.id)
    && Array.isArray(computer.providers) && computer.providers.length > 0
    && (computer.debtLimit === undefined || integer(computer.debtLimit)), 'Invalid computer enrollment');
  const keys = [];
  for (const provider of computer.providers) keys.push(await enrollmentKey(provider, byPeer, keys));
  byId.set(computer.id, computer);
  for (const key of keys) byPeer.set(key.participantId, { computerId: computer.id, ownerId: computer.ownerId, publicJwk: key.publicJwk,
    ...(key.revokedAt !== undefined ? { revokedAt: key.revokedAt } : {}) });
  return computer;
}

/** Validate one provider key: public only, its participant ID derived from it, enrolled to no other computer. */
export async function enrollmentKey(provider, byPeer, pending = []) {
  const publicJwk = normalizeParticipantPublicKey(provider?.publicJwk);
  assert(publicJwk && !Object.hasOwn(provider.publicJwk, 'd'), 'Only public enrollment keys are admitted');
  const participantId = await participantIdFor(publicJwk);
  assert(provider.participantId === participantId && !byPeer.has(participantId) && !pending.some(row => row.participantId === participantId),
    'Provider key must belong to exactly one enrolled computer');
  assert(provider.revokedAt === undefined || integer(provider.revokedAt), 'Invalid key revocation time');
  return { participantId, publicJwk, revokedAt: provider.revokedAt };
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

/**
 * How long after a request's deadline a provider may still submit completion or cleanup evidence. After it an
 * unclaimed hold is released at zero (credit-recovery.js), so no hold outlives its deadline plus this window.
 */
export const DEFAULT_UNCLAIMED_RELEASE_MS = 120000;

/**
 * The policy a ledger runs under: the operator's terms, with the terms a shipped policy may leave out filled in.
 * Both release windows default to DEFAULT_UNCLAIMED_RELEASE_MS, and cannot be switched off. `maxDebt` defaults to
 * one answer at the policy's own output ceiling, so a new account with a zero balance can make its first request
 * and its computers can then earn; an explicit `maxDebt` (including 0) is kept. Credits stay non-cash either way.
 */
export function withCreditPolicyDefaults(source) {
  const policy = structuredClone(source);
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return policy;
  policy.wholeModelUnclaimedReleaseMs ??= DEFAULT_UNCLAIMED_RELEASE_MS;
  policy.partitionUnclaimedReleaseMs ??= DEFAULT_UNCLAIMED_RELEASE_MS;
  if (policy.maxDebt === undefined && integer(policy.maxOutputTokens) && integer(policy.creditsPerOutputToken)) {
    policy.maxDebt = policy.maxOutputTokens * policy.creditsPerOutputToken;
  }
  return policy;
}

export function creditPolicy(source) {
  const policy = structuredClone(source);
  assert(policy?.schema === 'reploid.service-credit-policy/v1' && policy.unit === 'noncash-service-credit'
    && text(policy.version) && integer(policy.creditsPerOutputToken) && policy.creditsPerOutputToken > 0
    && integer(policy.maxDebt) && integer(policy.maxOutputTokens) && policy.maxOutputTokens > 0
    && integer(policy.maxPendingPerComputer) && policy.maxPendingPerComputer > 0
    && integer(policy.maxClockSkewMs) && integer(policy.maxRequestMs) && policy.maxRequestMs > 0
    && typeof policy.allowSameOwner === 'boolean'
    && (policy.wholeModelTerminalCharge === undefined || policy.wholeModelTerminalCharge === 0)
    && (policy.wholeModelUnclaimedReleaseMs === undefined
      || integer(policy.wholeModelUnclaimedReleaseMs) && policy.wholeModelUnclaimedReleaseMs > 0)
    && (policy.partitionUnclaimedReleaseMs === undefined
      || integer(policy.partitionUnclaimedReleaseMs) && policy.partitionUnclaimedReleaseMs > 0)
    // Optional: the most all accounts together may owe, so new accounts' debt limits stay bounded in total.
    && (policy.maxTotalDebt === undefined || integer(policy.maxTotalDebt)),
  'Explicit non-cash credit policy required');
  assert(Number.isSafeInteger(policy.maxOutputTokens * policy.creditsPerOutputToken + policy.maxDebt), 'Credit policy exceeds integer precision');
  return Object.freeze(policy);
}
