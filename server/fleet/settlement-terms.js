/**
 * Signed settlement terms for one split attempt.
 *
 * Today the price ceiling, the policy and each stage's share live only in the operator's journal (a hash, not a
 * signature), so whoever runs the ledger could move credit between stages without any participant noticing. Here
 * the requester signs the terms it accepted before any input leaves its device, and each stage signs an acceptance
 * of exactly those terms before it reserves. A verifier then needs no operator record to know what was agreed.
 *
 * Keys are self-certifying: a participant ID derives from its public key, so a signature names its signer without
 * an enrollment table. Mapping participant IDs to people or accounts stays outside this module.
 */
import { canonicalPartitionJson, canonicalRouteAttemptBinding } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { attemptRouteHash } from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { sha256Hex as digestText } from '../../shared/vendor/reploid/artifacts/signatures.js';
import { normalizeParticipantPublicKey, participantIdFor, verifyParticipantSignature } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { canonicalize } from '../../shared/vendor/reploid/artifacts/canonical-json.js';

export const SETTLEMENT_TERMS_SCHEMA = 'reploid.settlement-terms/v1';
export const SETTLEMENT_ACCEPTANCE_SCHEMA = 'reploid.settlement-acceptance/v1';
/** The requester's own signed stop: it ended the answer, so the outputs it acknowledged are owed. */
export const SETTLEMENT_STOP_SCHEMA = 'reploid.settlement-stop/v1';

const TERMS_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'routeHash', 'requesterId', 'policyDigest', 'unit',
  'creditsPerOutputToken', 'maxOutputTokens', 'maximum', 'shares', 'unfinishedTerms', 'notBefore', 'deadline', 'releaseWindowMs', 'signedAt']);
const ACCEPTANCE_KEYS = Object.freeze(['schema', 'termsDigest', 'reservationId', 'attemptId', 'participantId', 'partitionIndex', 'signedAt']);
const STOP_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'requesterId', 'acknowledged', 'signedAt']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const exact = (value, keys) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const positive = value => Number.isSafeInteger(value) && value > 0;
const time = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

/** The digest everyone signs against: the public policy object, canonical JSON. */
export const policyDigest = policy => digestText(canonicalize(policy));
/** The digest a stage accepts: the requester's terms body without its key and signature. */
export const termsDigest = body => digestText(canonicalPartitionJson(body));

function termsProblem(body) {
  if (!exact(body, TERMS_KEYS) || body.schema !== SETTLEMENT_TERMS_SCHEMA || !text(body.reservationId, 160) || !text(body.attemptId)
    || !DIGEST.test(body.routeHash) || !text(body.requesterId) || !DIGEST.test(body.policyDigest) || !text(body.unit, 64)
    || !positive(body.creditsPerOutputToken) || !positive(body.maxOutputTokens)
    || body.maximum !== body.maxOutputTokens * body.creditsPerOutputToken || !Number.isSafeInteger(body.maximum)
    || !Array.isArray(body.shares) || body.shares.length < 1 || body.shares.length > 128
    || !body.shares.every((row, index) => exact(row, ['partitionIndex', 'participantId', 'weight']) && row.partitionIndex === index
      && text(row.participantId) && positive(row.weight))
    || !(body.unfinishedTerms === null || text(body.unfinishedTerms, 128))
    || !time(body.notBefore) || !time(body.deadline) || Date.parse(body.deadline) <= Date.parse(body.notBefore)
    || !positive(body.releaseWindowMs) || !time(body.signedAt)) return 'terms_malformed';
  return null;
}

function acceptanceProblem(body) {
  return exact(body, ACCEPTANCE_KEYS) && body.schema === SETTLEMENT_ACCEPTANCE_SCHEMA && DIGEST.test(body.termsDigest)
    && text(body.reservationId, 160) && text(body.attemptId) && text(body.participantId)
    && Number.isSafeInteger(body.partitionIndex) && body.partitionIndex >= 0 && time(body.signedAt) ? null : 'acceptance_malformed';
}

function stopProblem(body) {
  return exact(body, STOP_KEYS) && body.schema === SETTLEMENT_STOP_SCHEMA && text(body.reservationId, 160) && text(body.attemptId)
    && text(body.requesterId) && Number.isSafeInteger(body.acknowledged) && body.acknowledged >= 0 && time(body.signedAt) ? null : 'stop_malformed';
}

async function verifySelfCertified(record, { domain, problemOf, signerOf }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, problem: problemOf(null) };
  const { publicJwk: carried, signature, ...body } = record;
  const problem = problemOf(body);
  if (problem) return { ok: false, problem };
  const key = normalizeParticipantPublicKey(carried);
  if (!key || typeof signature !== 'string') return { ok: false, problem: problemOf(null) };
  if (await participantIdFor(key) !== signerOf(body)) return { ok: false, problem: 'signer_key_mismatch' };
  if (!await verifyParticipantSignature(key, domain, body, signature)) return { ok: false, problem: 'signature_invalid' };
  return { ok: true, body };
}

export const verifySettlementTerms = record => verifySelfCertified(record, {
  domain: SETTLEMENT_TERMS_SCHEMA, problemOf: body => (body ? termsProblem(body) : 'terms_malformed'), signerOf: body => body.requesterId });

export const verifySettlementAcceptance = record => verifySelfCertified(record, {
  domain: SETTLEMENT_ACCEPTANCE_SCHEMA, problemOf: body => (body ? acceptanceProblem(body) : 'acceptance_malformed'), signerOf: body => body.participantId });

export const verifySettlementStop = record => verifySelfCertified(record, {
  domain: SETTLEMENT_STOP_SCHEMA, problemOf: body => (body ? stopProblem(body) : 'stop_malformed'), signerOf: body => body.requesterId });

/** The requester's signed stop of one attempt after `acknowledged` outputs. */
export async function signSettlementStop({ signer, terms, acknowledged, now = signer?.now ?? Date.now }) {
  if (signer?.participantId !== terms?.requesterId) throw Error('A stop needs the requester\'s own signing identity');
  return signer.sign(SETTLEMENT_STOP_SCHEMA, { schema: SETTLEMENT_STOP_SCHEMA, reservationId: terms.reservationId, attemptId: terms.attemptId,
    requesterId: terms.requesterId, acknowledged, signedAt: new Date(now()).toISOString() });
}

/**
 * The requester's terms for one attempt, signed with its own identity (`signer` from createAttemptEvidenceSigner).
 * `weights` gives each stage's share in stage order; the policy supplies price, unit and the release window.
 */
export async function signSettlementTerms({ signer, identity, reservationId, policy, maxOutputTokens, weights, notBefore, deadline,
  unfinishedTerms = null, now = signer?.now ?? Date.now }) {
  const binding = canonicalRouteAttemptBinding(identity);
  if (signer?.participantId !== binding.requesterId) throw Error('Settlement terms need the requester\'s own signing identity');
  const stages = binding.route.stages;
  if (!Array.isArray(weights) || weights.length !== stages.length) throw Error('One weight per stage is required');
  const releaseWindowMs = policy.partitionUnclaimedReleaseMs;
  const body = {
    schema: SETTLEMENT_TERMS_SCHEMA, reservationId, attemptId: binding.attemptId, routeHash: await attemptRouteHash(binding),
    requesterId: binding.requesterId, policyDigest: await policyDigest(policy), unit: policy.unit,
    creditsPerOutputToken: policy.creditsPerOutputToken, maxOutputTokens, maximum: maxOutputTokens * policy.creditsPerOutputToken,
    shares: stages.map((stage, index) => ({ partitionIndex: index, participantId: stage.participantId, weight: weights[index] })),
    unfinishedTerms, notBefore: new Date(notBefore).toISOString(), deadline: new Date(deadline).toISOString(),
    releaseWindowMs, signedAt: new Date(now()).toISOString()
  };
  const problem = termsProblem(body);
  if (problem) throw Error(`Settlement terms are invalid: ${problem}`);
  return signer.sign(SETTLEMENT_TERMS_SCHEMA, body);
}

/** A stage's signed acceptance of exactly these terms, at its own stage index, before it reserves. */
export async function acceptSettlementTerms({ signer, terms, partitionIndex, now = signer?.now ?? Date.now }) {
  const checked = await verifySettlementTerms(terms);
  if (!checked.ok) throw Error(`Settlement terms do not verify: ${checked.problem}`);
  const share = checked.body.shares[partitionIndex];
  if (!share || share.participantId !== signer?.participantId) throw Error('A stage accepts only its own share');
  return signer.sign(SETTLEMENT_ACCEPTANCE_SCHEMA, {
    schema: SETTLEMENT_ACCEPTANCE_SCHEMA, termsDigest: await termsDigest(checked.body), reservationId: checked.body.reservationId,
    attemptId: checked.body.attemptId, participantId: signer.participantId, partitionIndex, signedAt: new Date(now()).toISOString()
  });
}
