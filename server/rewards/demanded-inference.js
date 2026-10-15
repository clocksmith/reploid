/**
 * @fileoverview Validator for completed demanded inference: one route stage's
 * share of an attempt that a real requester paid for under an accepted quote.
 *
 * The credit ledger's settlement is the root of evidence. The route summary,
 * stage receipts and contributor admission record only map that settled
 * attempt onto a stage; without the settlement they prove nothing, and
 * signatures or peer agreement never substitute for it. When the settlement
 * came from evidence rather than a requester's route summary, the stage's own
 * signed receipt the ledger verified and kept maps it instead. A disputed
 * reservation earns nothing until operational review resolves it.
 */

import { canonicalRouteAttemptBinding, sameRouteAttemptIdentity } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { summarizePartitionExecution } from '../../packages/reploid/src/mesh/partitions/partition-summary.js';
import { hashCanonical, isNonEmptyString, toMs } from '../ledger/domain.js';
import { checkCounterparty } from './counterparty.js';
import { CATEGORY_TERMS, computeReward } from './domain.js';

/** Conditions disclosed in every demanded-inference offer and checked for every claim. */
export const DEMANDED_INFERENCE_CONDITIONS = Object.freeze([
  'requester_quote_accepted: a requester account accepted an inference quote that reserved the charge',
  'settlement_completed: the ledger settled that reservation as full or reduced service, from a report, acknowledged evidence or a resolved dispute, or a review disposed it so',
  'attempt_binds_contributor: the settled attempt bound the contributor participant as a recipient before dispatch',
  'route_matches_offer: the claimed stage of the settled route runs on the offer participant and model plan',
  'stage_executed: the route receipt, or the stage\'s own verified signed receipt, shows the stage executing every settled step and cleanup settled',
  'contributor_admission: the contributor admission record settled under the owner policy accepted with the offer',
  'work_within_offer: bound after acceptance, inside the duration, resource bounds and claim window',
  'not_self_dealing: distinct requester and contributor account, owner and participant, and no disqualifying account link',
  'single_reward: one reward per stage share of a settled attempt'
]);

const COMPLETED_OUTCOMES = new Set(['full', 'reduced']);
const SUMMARY_SCHEMA = 'reploid.mesh.partition-summary/v2';
const EXECUTION_SCHEMA = 'reploid.mesh.partition-execution/v3';

export const stageShareKey = ({ reservationId, attemptId, stageIndex }) => `${reservationId}|${attemptId}|${stageIndex}`;
export const participantShareKey = ({ reservationId, attemptId }, participantId) => `${reservationId}|${attemptId}|${participantId}`;
export const routeKey = ({ reservationId, attemptId }) => `${reservationId}|${attemptId}`;

const completedSettlement = (settlement) => COMPLETED_OUTCOMES.has(settlement?.outcome)
  || (settlement?.outcome === 'failed_quality' && COMPLETED_OUTCOMES.has(settlement.review?.disposition));

const routeSummary = (execution) => {
  try {
    const summary = execution?.schema === EXECUTION_SCHEMA ? summarizePartitionExecution(execution) : execution;
    if (summary?.schema !== SUMMARY_SCHEMA) return null;
    return { summary, binding: canonicalRouteAttemptBinding(summary.identity) };
  } catch {
    return null;
  }
};

/**
 * Evaluate one claim against ledger records and the identity port. Returns
 * every failed condition as a reason; an empty list means the work is valid
 * apart from the duplicate checks the store applies atomically.
 *
 * @param {object} options
 * @param {object} options.claim { reservationId, attemptId, stageIndex, execution, contribution }
 * @param {object} options.offer accepted contribution offer
 * @param {object} options.ledger credit ledger store (read operations)
 * @param {object} options.identity { participantAccount(participantId), accountLinks(accountA, accountB) }
 */
export async function evaluateDemandedInference({ claim, offer, ledger, identity, rewardPolicy, now }) {
  const reasons = [];
  const reject = (code, message, details) => reasons.push(details ? { code, message, details } : { code, message });
  const evidence = { requester: null, settlement: null, route: null, contribution: null, links: [] };
  const participantId = offer.work.participantId;
  const result = (extra = {}) => ({ reasons, evidence, ...extra });

  // 1. The requester's accepted quote and its completed settlement.
  const reservation = await ledger.getReservation(claim.reservationId);
  if (!reservation) {
    reject('no_matching_settlement', 'no ledger reservation from an accepted requester quote matches this claim');
    return result();
  }
  evidence.requester = { accountId: reservation.accountId, quoteId: reservation.quoteId, quoteHash: reservation.quoteHash };
  const quote = await ledger.getQuote(reservation.quoteId);
  if (quote?.status !== 'accepted' || quote.quoteHash !== reservation.quoteHash
    || quote.accountId !== reservation.accountId || quote.reservationId !== reservation.reservationId) {
    reject('requester_quote_not_accepted', 'the reservation is not backed by the requester account\'s accepted inference quote');
  }
  if (['open', 'under_review', 'disputed'].includes(reservation.status)) {
    reject('work_not_settled', `the requester reservation is ${reservation.status}; only settled work can earn`);
    return result();
  }
  const settlement = reservation.settlement;
  if (reservation.status !== 'settled' || !completedSettlement(settlement)) {
    reject('work_not_completed', `settlement outcome ${settlement?.outcome ?? reservation.status} is not completed inference`);
    return result();
  }
  evidence.settlement = {
    settlementId: settlement.settlementId,
    billableEventId: settlement.billableEventId,
    outcome: settlement.outcome,
    reviewDisposition: settlement.review?.disposition ?? null,
    charge: settlement.charge,
    settledAt: settlement.settledAt,
    attemptId: settlement.attempt?.attemptId ?? null,
    recipients: settlement.attempt?.recipients ?? []
  };
  if (!settlement.billableEventId || settlement.attempt?.attemptId !== claim.attemptId) {
    reject('attempt_not_settled', 'the claimed attempt is not the attempt this settlement charged for');
    return result();
  }
  const recipients = settlement.attempt.recipients;
  const boundAttempt = reservation.attempts.find((attempt) => attempt.attemptId === claim.attemptId);

  // 2. The route summary, or the ledger's kept evidence when the settlement came from it, maps the settled
  //    attempt onto stages; the ledger binding must agree.
  let parsed = routeSummary(claim.execution);
  let stageReceipt = null;
  if (!parsed && claim.execution === undefined && typeof ledger.getAttemptEvidence === 'function') {
    const kept = await ledger.getAttemptEvidence({ reservationId: claim.reservationId, attemptId: claim.attemptId });
    try {
      if (kept) parsed = { summary: null, binding: canonicalRouteAttemptBinding(kept.identity) };
    } catch {
      parsed = null;
    }
    stageReceipt = kept?.stages?.[String(claim.stageIndex)] ?? null;
  }
  if (!parsed) {
    reject('execution_invalid', 'the route attempt summary or kept attempt evidence is missing or malformed');
    return result();
  }
  const { summary, binding } = parsed;
  const { route } = binding;
  const stage = route.stages[claim.stageIndex];
  const routeHash = hashCanonical(binding);
  evidence.route = { routeHash, requesterId: binding.requesterId, modelId: route.modelId, planId: route.planId, stageCount: route.stages.length };
  if (binding.attemptId !== claim.attemptId) reject('route_mismatch', 'the route summary names a different attempt');
  if (stage?.participantId !== participantId) reject('route_mismatch', 'the claimed stage does not run on the offer participant');
  const { model } = offer.work;
  if (route.modelId !== model.modelId || route.modelIdentity !== model.modelIdentity || route.planId !== model.planId) {
    reject('route_mismatch', 'the route model or partition plan differs from the offer\'s requested work');
  }
  if (route.modelId !== reservation.service.model.modelId) reject('route_mismatch', 'the route model differs from the requester\'s quoted service');
  if (!recipients.includes(participantId)) {
    reject('contributor_not_bound', 'the settled attempt did not bind the contributor participant before dispatch');
  }
  const unbound = route.stages.map((entry) => entry.participantId).filter((id) => !recipients.includes(id));
  if (unbound.length) reject('route_mismatch', 'route stages are not the settled attempt\'s bound recipients', { unbound });

  const sameAttempt = (value) => sameRouteAttemptIdentity(value, binding);
  if (summary) {
    const receipt = summary.settlement;
    const reserved = receipt?.reservations?.find((entry) => entry?.partitionIndex === claim.stageIndex);
    const cleanup = receipt?.cleanup?.find((entry) => entry?.partitionIndex === claim.stageIndex);
    const steps = summary.stepSummary?.count;
    const row = summary.stepSummary?.stages?.find((entry) => entry?.partitionIndex === claim.stageIndex);
    if (!sameAttempt(receipt?.identity) || receipt.phase !== 'completed' || receipt.failure != null || receipt.cleanupSettledAt == null
      || !sameAttempt(reserved?.identity) || reserved.status !== 'reserved' || cleanup?.status !== 'settled'
      || !Number.isSafeInteger(steps) || steps < 1 || row?.steps !== steps) {
      reject('stage_not_executed', 'the route receipt does not show this stage reserved, executing every step and settling cleanup');
    }
  } else {
    // The stage's own closing receipt, verified against its registration when the ledger kept it.
    const settledSteps = settlement.metering?.output;
    if (stageReceipt?.participantId !== stage?.participantId || stageReceipt.status !== 'settled'
      || !Number.isSafeInteger(settledSteps) || settledSteps < 1 || stageReceipt.steps < settledSteps) {
      reject('stage_not_executed', 'the stage\'s verified signed receipt does not show it executing every settled step and closing cleanly');
    }
  }

  // 3. The contributor's own admission under the owner policy accepted with the offer.
  const admission = claim.contribution?.admission;
  const ownerPolicyDigest = claim.contribution?.ownerPolicyDigest;
  evidence.contribution = { participantId, stageIndex: claim.stageIndex, ownerPolicyDigest: isNonEmptyString(ownerPolicyDigest) ? ownerPolicyDigest : null };
  if (!sameAttempt(admission?.identity) || admission.participantId !== participantId || admission.index !== claim.stageIndex
    || admission.phase !== 'settled' || admission.failure != null || admission.reservedAt == null || admission.settledAt == null) {
    reject('contributor_admission_invalid', 'the contributor admission record does not show this stage admitted and settled');
  }
  if (ownerPolicyDigest !== offer.acceptance.ownerPolicyDigest) {
    reject('owner_policy_mismatch', 'the stage was not admitted under the owner policy accepted with the offer');
  }

  // 4. Work inside the accepted offer terms.
  const boundAt = toMs(boundAttempt?.boundAt);
  const settledAt = toMs(settlement.settledAt);
  if (!(boundAt >= toMs(offer.acceptedAt))) reject('work_precedes_offer', 'the attempt was bound before the contributor accepted the offer');
  if (!(boundAt >= toMs(offer.duration.startsAt)) || !(settledAt <= toMs(offer.duration.endsAt))) {
    reject('work_outside_offer_window', 'the attempt was not bound and settled inside the offer duration');
  }
  if (toMs(now) > settledAt + offer.paymentTiming.claimWindowMs) reject('claim_window_closed', 'the claim arrived after the offer\'s claim window');
  for (const meter of ['context', 'output']) {
    const quoted = reservation.service.limits?.[meter];
    const bound = offer.resourceBounds[meter];
    if (!quoted || quoted.unit !== bound.unit || quoted.max > bound.max) {
      reject('work_exceeds_offer_bounds', `the quoted ${meter} limit exceeds the offer's resource bound`);
    }
  }

  // 5. Self-generated or collusive demand. The route requester must be the reservation's accepting device; for a
  //    Community Access reservation the paying account is the pool, and the counterparty is the requester's own account.
  const [requesterOwner, contributorOwner, requesterDevice] = await Promise.all([
    identity.participantAccount(binding.requesterId),
    identity.participantAccount(participantId),
    typeof identity.participantDevice === 'function' ? identity.participantDevice(binding.requesterId) : undefined
  ]);
  const requesterBound = requesterDevice === undefined ? requesterOwner === reservation.accountId
    : requesterOwner !== null && requesterDevice === reservation.deviceId;
  if (!requesterBound) {
    reject('requester_identity_mismatch', 'the route requester participant is not the device that accepted the paying reservation');
  }
  if (contributorOwner !== offer.accountId) reject('contributor_identity_mismatch', 'the offer participant no longer belongs to the contributor account');
  evidence.links = await checkCounterparty({
    contributorAccountId: offer.accountId, counterpartyAccountId: requesterBound && requesterOwner ? requesterOwner : reservation.accountId,
    contributorParticipantId: participantId, counterpartyParticipantId: binding.requesterId,
    ledger, identity, rewardPolicy, reject
  });

  // 6. Reward from the accepted formula over settled ledger meters only.
  const meters = { settledCharge: settlement.charge };
  for (const meter of CATEGORY_TERMS.demanded_inference.meters) {
    if (meter !== 'settledCharge' && settlement.metering?.[meter] !== undefined) meters[meter] = settlement.metering[meter];
  }
  let reward = null;
  try {
    reward = computeReward(offer, meters);
  } catch (error) {
    reject('metering_incomplete', error.message);
  }
  const share = { reservationId: claim.reservationId, attemptId: claim.attemptId, stageIndex: claim.stageIndex };
  return result({
    reward,
    workKey: `demanded_inference|${stageShareKey(share)}`,
    unitKeys: [
      { kind: 'stage_share', key: stageShareKey(share) },
      { kind: 'participant_share', key: participantShareKey(share, participantId) }
    ],
    pins: [{ kind: 'route', key: routeKey(share), value: routeHash }],
    workRefs: {
      reservationId: claim.reservationId,
      settlementId: settlement.settlementId,
      billableEventId: settlement.billableEventId,
      attemptId: claim.attemptId,
      stageIndex: claim.stageIndex,
      ownerPolicyDigest: evidence.contribution.ownerPolicyDigest
    }
  });
}

/** Claim fields a demanded-inference validation accepts besides offerId. */
export const DEMANDED_INFERENCE_CLAIM_KEYS = Object.freeze(['reservationId', 'attemptId', 'stageIndex', 'execution', 'contribution']);

export function assertDemandedInferenceClaim(claim, { assertId, fail }) {
  assertId(claim.reservationId, 'reservationId');
  assertId(claim.attemptId, 'attemptId');
  if (!Number.isSafeInteger(claim.stageIndex) || claim.stageIndex < 0) fail('invalid_input', 'stageIndex must be a non-negative integer');
}

export default { DEMANDED_INFERENCE_CONDITIONS, evaluateDemandedInference };
