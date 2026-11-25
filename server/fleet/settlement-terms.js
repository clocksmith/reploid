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
import { MAX_UNACKNOWLEDGED_OUTPUTS, attemptRouteHash, isSignedTime } from '../../shared/vendor/reploid/mesh/partitions/partition-attempt-evidence.js';
import { sha256Hex as digestText } from '../../shared/vendor/reploid/artifacts/signatures.js';
import {
  isCanonicalParticipantProof, normalizeParticipantPublicKey, participantIdFor, verifyParticipantSignature
} from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { canonicalize } from '../../shared/vendor/reploid/artifacts/canonical-json.js';
import { UNFINISHED_ANSWER_TERMS, UNFINISHED_ANSWER_TERMS_V3 } from './credit-shares.js';

export const SETTLEMENT_TERMS_SCHEMA = 'reploid.settlement-terms/v1';
export const SETTLEMENT_ACCEPTANCE_SCHEMA = 'reploid.settlement-acceptance/v1';
/** The requester's own signed stop: it ended the answer, so the outputs it acknowledged are owed. */
export const SETTLEMENT_STOP_SCHEMA = 'reploid.settlement-stop/v1';
/**
 * A stage's own signed fault: it failed and gives up its share of this attempt (docs/settlement-replay.md, "Failed
 * stages"). Read only under UNFINISHED_ANSWER_TERMS_V3. It lets the attempt settle without waiting out the release
 * window for a closing receipt that will not come.
 */
export const SETTLEMENT_FAULT_SCHEMA = 'reploid.settlement-stage-fault/v1';

const TERMS_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'routeHash', 'requesterId', 'policyDigest', 'unit',
  'creditsPerOutputToken', 'maxOutputTokens', 'maximum', 'shares', 'unfinishedTerms', 'maxUnacknowledgedOutputs', 'notBefore', 'deadline',
  'releaseWindowMs', 'signedAt']);
/**
 * Terms signed before terms carried K (the first split trades of 2026-11-25): every member above except
 * `maxUnacknowledgedOutputs`. They are read only with the unfinished-answer terms of that time, `null` or the older
 * provider-loss-free value, so nothing signed under the decided rules can leave K out (docs/settlement-replay.md,
 * "Record shapes").
 */
const TERMS_KEYS_BEFORE_K = Object.freeze(TERMS_KEYS.filter(key => key !== 'maxUnacknowledgedOutputs'));
/**
 * Signed accounts (docs/settlement-replay.md, step 8). Terms may name the ledger account the requester is charged from
 * (`debitAccount`); each stage's acceptance of such terms then names the account its share is paid into
 * (`payoutAccount`). A verifier reads who is paid where from the parties' own signatures instead of from whoever
 * publishes the receipt.
 */
const TERMS_KEYS_WITH_ACCOUNT = Object.freeze([...TERMS_KEYS, 'debitAccount']);
const ACCEPTANCE_KEYS = Object.freeze(['schema', 'termsDigest', 'reservationId', 'attemptId', 'participantId', 'partitionIndex', 'signedAt']);
const ACCEPTANCE_KEYS_WITH_ACCOUNT = Object.freeze([...ACCEPTANCE_KEYS, 'payoutAccount']);
const STOP_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'requesterId', 'acknowledged', 'signedAt']);
const FAULT_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'routeHash', 'partitionIndex', 'participantId', 'signedAt']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const exact = (value, keys) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const positive = value => Number.isSafeInteger(value) && value > 0;
/** Exactly the `toISOString` form, in UTC: a zone-less time would be read as each verifier's local time. */
const time = isSignedTime;

/** The digest everyone signs against: the public policy object, canonical JSON. */
export const policyDigest = policy => digestText(canonicalize(policy));
/** The digest a stage accepts: the requester's terms body without its key and signature. */
export const termsDigest = body => digestText(canonicalPartitionJson(body));

function termsProblem(body) {
  const beforeK = exact(body, TERMS_KEYS_BEFORE_K) && (body.unfinishedTerms === null || body.unfinishedTerms === UNFINISHED_ANSWER_TERMS);
  const withAccount = exact(body, TERMS_KEYS_WITH_ACCOUNT) && text(body.debitAccount, 128);
  if (!(beforeK || withAccount || exact(body, TERMS_KEYS)) || body.schema !== SETTLEMENT_TERMS_SCHEMA || !text(body.reservationId, 160) || !text(body.attemptId)
    || !DIGEST.test(body.routeHash) || !text(body.requesterId) || !DIGEST.test(body.policyDigest) || !text(body.unit, 64)
    || !positive(body.creditsPerOutputToken) || !positive(body.maxOutputTokens)
    || body.maximum !== body.maxOutputTokens * body.creditsPerOutputToken || !Number.isSafeInteger(body.maximum)
    || !Array.isArray(body.shares) || body.shares.length < 1 || body.shares.length > 128
    || !body.shares.every((row, index) => exact(row, ['partitionIndex', 'participantId', 'weight']) && row.partitionIndex === index
      && text(row.participantId) && positive(row.weight))
    || !(body.unfinishedTerms === null || text(body.unfinishedTerms, 128))
    || !(beforeK || (Number.isSafeInteger(body.maxUnacknowledgedOutputs) && body.maxUnacknowledgedOutputs >= 0))
    || !time(body.notBefore) || !time(body.deadline) || Date.parse(body.deadline) <= Date.parse(body.notBefore)
    || !positive(body.releaseWindowMs) || !time(body.signedAt)) return 'terms_malformed';
  return null;
}

function acceptanceProblem(body) {
  const shape = exact(body, ACCEPTANCE_KEYS) || (exact(body, ACCEPTANCE_KEYS_WITH_ACCOUNT) && text(body.payoutAccount, 128));
  return shape && body.schema === SETTLEMENT_ACCEPTANCE_SCHEMA && DIGEST.test(body.termsDigest)
    && text(body.reservationId, 160) && text(body.attemptId) && text(body.participantId)
    && Number.isSafeInteger(body.partitionIndex) && body.partitionIndex >= 0 && time(body.signedAt) ? null : 'acceptance_malformed';
}

function stopProblem(body) {
  return exact(body, STOP_KEYS) && body.schema === SETTLEMENT_STOP_SCHEMA && text(body.reservationId, 160) && text(body.attemptId)
    && text(body.requesterId) && Number.isSafeInteger(body.acknowledged) && body.acknowledged >= 0 && time(body.signedAt) ? null : 'stop_malformed';
}

function faultProblem(body) {
  return exact(body, FAULT_KEYS) && body.schema === SETTLEMENT_FAULT_SCHEMA && text(body.reservationId, 160) && text(body.attemptId)
    && DIGEST.test(body.routeHash) && Number.isSafeInteger(body.partitionIndex) && body.partitionIndex >= 0 && text(body.participantId)
    && time(body.signedAt) ? null : 'fault_malformed';
}

async function verifySelfCertified(record, { domain, problemOf, signerOf }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, problem: problemOf(null) };
  const { publicJwk: carried, signature, ...body } = record;
  const problem = problemOf(body);
  if (problem) return { ok: false, problem };
  const key = normalizeParticipantPublicKey(carried);
  // Exactly the key's coordinates, as stage receipts and acknowledgments require: the key is not signed, so a
  // relay must not be able to add members that one verifier ignores and another refuses.
  if (!key || !exact(carried, Object.keys(key)) || typeof signature !== 'string') return { ok: false, problem: problemOf(null) };
  // One text per key and per signature (no padding, no unused bits): one key maps to exactly one participant ID.
  if (!isCanonicalParticipantProof(carried, signature)) return { ok: false, problem: 'encoding_not_canonical' };
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

export const verifySettlementFault = record => verifySelfCertified(record, {
  domain: SETTLEMENT_FAULT_SCHEMA, problemOf: body => (body ? faultProblem(body) : 'fault_malformed'), signerOf: body => body.participantId });

/**
 * A stage's signed fault for one attempt, at its own stage index: it failed, it will be paid nothing for this attempt,
 * and nobody needs to wait for its closing receipt. Only the participant the terms name at that index can sign it.
 */
export async function signStageFault({ signer, terms, partitionIndex, now = signer?.now ?? Date.now }) {
  const checked = await verifySettlementTerms(terms);
  if (!checked.ok) throw Error(`Settlement terms do not verify: ${checked.problem}`);
  if (checked.body.shares[partitionIndex]?.participantId !== signer?.participantId) throw Error('A stage signs a fault only for its own share');
  return signStageFaultRecord({ signer, reservationId: checked.body.reservationId, attemptId: checked.body.attemptId, routeHash: checked.body.routeHash,
    partitionIndex, now });
}

/**
 * The same fault record, signed by a stage that does not hold the requester's terms: a stage host that restarts after
 * its process died knows only what its own last signed step receipt carries (reservation, attempt and route hash) and
 * its stage index (stage-owner.js). The record names its signer; whether that participant runs this stage of this
 * attempt is decided by whoever reads it, from the terms (the replay) or from the reservation (the ledger).
 */
export async function signStageFaultRecord({ signer, reservationId, attemptId, routeHash, partitionIndex, now = signer?.now ?? Date.now }) {
  if (typeof signer?.participantId !== 'string' || typeof signer.sign !== 'function') throw Error('A stage fault needs the stage\'s own signing identity');
  const body = { schema: SETTLEMENT_FAULT_SCHEMA, reservationId, attemptId, routeHash, partitionIndex, participantId: signer.participantId,
    signedAt: new Date(now()).toISOString() };
  if (faultProblem(body)) throw Error('Stage fault is invalid');
  return signer.sign(SETTLEMENT_FAULT_SCHEMA, body);
}

/** The requester's signed stop of one attempt after `acknowledged` outputs. */
export async function signSettlementStop({ signer, terms, acknowledged, now = signer?.now ?? Date.now }) {
  if (signer?.participantId !== terms?.requesterId) throw Error('A stop needs the requester\'s own signing identity');
  return signer.sign(SETTLEMENT_STOP_SCHEMA, { schema: SETTLEMENT_STOP_SCHEMA, reservationId: terms.reservationId, attemptId: terms.attemptId,
    requesterId: terms.requesterId, acknowledged, signedAt: new Date(now()).toISOString() });
}

/**
 * The requester's terms for one attempt, signed with its own identity (`signer` from createAttemptEvidenceSigner).
 * `weights` gives each stage's share in stage order; the policy supplies price, unit and the release window.
 * `maxUnacknowledgedOutputs` is K, the acknowledgment bound the stages enforce (MAX_UNACKNOWLEDGED_OUTPUTS); it is
 * signed so that a verifier reads it from the terms rather than assuming a constant. A policy that publishes K
 * (`policy.maxUnacknowledgedOutputs`) supplies it, and terms naming another K are refused. `unfinishedTerms` names the
 * rule for an unfinished answer; by default the failed-stage terms (UNFINISHED_ANSWER_TERMS_V3) that every new split
 * reservation settles under, which the stages accept (acceptSettlementTerms).
 * `debitAccount`, when given, is the ledger account the requester is charged from; the stages then sign theirs.
 */
export async function signSettlementTerms({ signer, identity, reservationId, policy, maxOutputTokens, weights, notBefore, deadline,
  unfinishedTerms = UNFINISHED_ANSWER_TERMS_V3, maxUnacknowledgedOutputs = policy?.maxUnacknowledgedOutputs, debitAccount = undefined,
  now = signer?.now ?? Date.now }) {
  const binding = canonicalRouteAttemptBinding(identity);
  if (signer?.participantId !== binding.requesterId) throw Error('Settlement terms need the requester\'s own signing identity');
  if (policy?.maxUnacknowledgedOutputs !== undefined && maxUnacknowledgedOutputs !== policy.maxUnacknowledgedOutputs) {
    throw Error('Settlement terms must sign the acknowledgment bound their policy publishes');
  }
  const stages = binding.route.stages;
  if (!Array.isArray(weights) || weights.length !== stages.length) throw Error('One weight per stage is required');
  const releaseWindowMs = policy.partitionUnclaimedReleaseMs;
  const body = {
    schema: SETTLEMENT_TERMS_SCHEMA, reservationId, attemptId: binding.attemptId, routeHash: await attemptRouteHash(binding),
    requesterId: binding.requesterId, policyDigest: await policyDigest(policy), unit: policy.unit,
    creditsPerOutputToken: policy.creditsPerOutputToken, maxOutputTokens, maximum: maxOutputTokens * policy.creditsPerOutputToken,
    shares: stages.map((stage, index) => ({ partitionIndex: index, participantId: stage.participantId, weight: weights[index] })),
    unfinishedTerms, maxUnacknowledgedOutputs, notBefore: new Date(notBefore).toISOString(), deadline: new Date(deadline).toISOString(),
    releaseWindowMs, signedAt: new Date(now()).toISOString(), ...(debitAccount === undefined ? {} : { debitAccount })
  };
  const problem = termsProblem(body);
  if (problem) throw Error(`Settlement terms are invalid: ${problem}`);
  return signer.sign(SETTLEMENT_TERMS_SCHEMA, body);
}

/**
 * A stage's signed acceptance of exactly these terms, at its own stage index, before it reserves. A stage accepts
 * only the acknowledgment bound it enforces (`maxUnacknowledgedOutputs`, by default its receiver policy's K).
 * `payoutAccount` is the ledger account this stage's share is paid into; terms that name the requester's account
 * are accepted only with it.
 */
export async function acceptSettlementTerms({ signer, terms, partitionIndex, maxUnacknowledgedOutputs = MAX_UNACKNOWLEDGED_OUTPUTS,
  unfinishedTerms = UNFINISHED_ANSWER_TERMS_V3, payoutAccount = undefined, now = signer?.now ?? Date.now }) {
  const checked = await verifySettlementTerms(terms);
  if (!checked.ok) throw Error(`Settlement terms do not verify: ${checked.problem}`);
  if (checked.body.maxUnacknowledgedOutputs !== maxUnacknowledgedOutputs) throw Error('The terms name another acknowledgment bound than this stage enforces');
  // A stage settles under one unfinished-answer rule, by default the failed-stage terms: terms that name another, such
  // as the provider-relief or the older provider-loss-free terms signed after the decision, get no acceptance and stay
  // `unknown` in the replay.
  if (checked.body.unfinishedTerms !== unfinishedTerms) throw Error('The terms name other unfinished-answer terms than this stage settles under');
  const share = checked.body.shares[partitionIndex];
  if (!share || share.participantId !== signer?.participantId) throw Error('A stage accepts only its own share');
  if (Object.hasOwn(checked.body, 'debitAccount') && payoutAccount === undefined) {
    throw Error('Terms that name the requester\'s account are accepted only with this stage\'s payout account');
  }
  const body = {
    schema: SETTLEMENT_ACCEPTANCE_SCHEMA, termsDigest: await termsDigest(checked.body), reservationId: checked.body.reservationId,
    attemptId: checked.body.attemptId, participantId: signer.participantId, partitionIndex, signedAt: new Date(now()).toISOString(),
    ...(payoutAccount === undefined ? {} : { payoutAccount })
  };
  if (acceptanceProblem(body)) throw Error('Settlement acceptance is invalid');
  return signer.sign(SETTLEMENT_ACCEPTANCE_SCHEMA, body);
}
