/** Whole-request rewards reuse the contribution ledger and issuance authority.
 * Their evidence is a settled requester quote plus the accounting owner's kept,
 * countersigned execution and explicit quality decision, never a claimant report. */
import { claimWindowClosed, computeReward } from './domain.js';
import { checkCounterparty } from './counterparty.js';
import { toMs } from '../ledger/domain.js';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';

export const WHOLE_MODEL_CONDITIONS = Object.freeze([
  'accepted_demand: an authenticated requester accepted the exact model and adapter terms',
  'settled_service: the ledger charged for validated completed whole-model service',
  'bound_execution: the provider and requester countersigned measured usage and settled cleanup for the bound attempt',
  'owner_authorization: execution names the owner policy accepted with this offer',
  'within_offer: work fits the accepted time, model and resource bounds',
  'distinct_demand: requester and contributor have distinct accounts, owners and participants and no prohibited link',
  'single_reward: the settled whole request can earn once'
]);

export async function evaluateWholeModelInference({ claim, offer, ledger, identity, rewardPolicy, now, readWholeModelExecution }) {
  const reasons = [], evidence = {};
  const reject = (code, message) => reasons.push({ code, message });
  const result = extra => ({ reasons, evidence, ...extra });
  if (typeof readWholeModelExecution !== 'function') {
    reject('execution_unavailable', 'whole-model accounting evidence is unavailable'); return result();
  }
  const reservation = await ledger.getReservation(claim.reservationId);
  const record = await readWholeModelExecution(claim.reservationId);
  const settlement = reservation?.settlement, receipt = record?.receipt;
  const disposition = settlement?.outcome === 'failed_quality' ? settlement.review?.disposition : settlement?.outcome;
  const quote = reservation && await ledger.getQuote(reservation.quoteId);
  if (reservation?.status !== 'settled' || !['full', 'reduced'].includes(disposition)
    || record?.phase !== 'settled' || record.reservationId !== reservation.reservationId
    || record.quoteHash !== reservation.quoteHash || quote?.status !== 'accepted'
    || quote.reservationId !== reservation.reservationId || quote.quoteHash !== reservation.quoteHash
    || quote.accountId !== reservation.accountId
    || record.quality?.policyVersion !== reservation.service.qualityPolicyVersion
    || record.quality.outcome !== settlement.outcome || !record.quality.decisionId) {
    reject('work_not_completed', 'no settled, quality-accepted whole-model demand matches'); return result();
  }
  let verified;
  try { verified = await verifyReceipt(receipt); } catch { verified = null; }
  const participantId = offer.work.participantId, model = offer.work.model;
  const attempt = reservation.attempts.find(value => value.attemptId === claim.attemptId);
  if (!verified?.providerValid || !verified.consumerValid || receipt.version !== 2 || receipt.cleanup !== 'settled'
    || record.attemptId !== claim.attemptId || settlement.attempt?.attemptId !== claim.attemptId
    || receipt.provider !== participantId || record.providerIdentity !== participantId
    || record.requesterId !== receipt.consumer || receipt.inputDigest !== record.inputDigest
    || settlement.attempt.recipients.length !== 1 || settlement.attempt.recipients[0] !== participantId
    || receipt.model !== model.modelId || receipt.modelIdentity !== model.modelIdentity
    || JSON.stringify(receipt.adapterIdentities) !== JSON.stringify(model.adapterIdentities)
    || reservation.service.model.deployedRepresentation !== receipt.modelIdentity
    || JSON.stringify(reservation.service.model.adapters) !== JSON.stringify(receipt.adapterIdentities)
    || receipt.inputTokens !== settlement.metering.context || receipt.outputTokens !== settlement.metering.output) {
    reject('execution_mismatch', 'kept execution does not match the bound participant, model and settled usage'); return result();
  }
  if (!receipt.ownerPolicyDigest || receipt.ownerPolicyDigest !== offer.acceptance.ownerPolicyDigest) {
    reject('owner_policy_mismatch', 'execution does not bind the owner policy accepted with the offer');
  }
  const boundAt = toMs(attempt?.boundAt), settledAt = toMs(settlement.settledAt);
  if (!(boundAt >= toMs(offer.acceptedAt) && boundAt >= toMs(offer.duration.startsAt) && settledAt <= toMs(offer.duration.endsAt))) {
    reject('work_outside_offer_window', 'work did not execute inside the accepted offer');
  }
  if (claimWindowClosed(offer, settledAt, now)) reject('claim_window_closed', 'claim window ended');
  for (const meter of ['context', 'output']) {
    const limit = reservation.service.limits[meter], bound = offer.resourceBounds[meter];
    if (limit.unit !== bound.unit || limit.max > bound.max) reject('work_exceeds_offer_bounds', `${meter} exceeds the accepted offer`);
  }
  const requesterAccount = await identity.participantAccount(receipt.consumer);
  const providerAccount = await identity.participantAccount(participantId);
  if (requesterAccount !== reservation.accountId || providerAccount !== offer.accountId
    || record.accountId !== requesterAccount || record.deviceId !== reservation.deviceId
    || typeof identity.participantDevice !== 'function' || await identity.participantDevice(receipt.consumer) !== reservation.deviceId) {
    reject('identity_mismatch', 'execution identities do not match accepting requester and contributor devices');
  }
  evidence.links = await checkCounterparty({ contributorAccountId: offer.accountId, counterpartyAccountId: reservation.accountId,
    contributorParticipantId: participantId, counterpartyParticipantId: receipt.consumer, ledger, identity, rewardPolicy, reject });
  evidence.execution = { receiptId: receipt.receiptId, inputDigest: receipt.inputDigest, outputDigest: receipt.outputDigest,
    qualityDecisionId: record.quality.decisionId, ownerPolicyDigest: receipt.ownerPolicyDigest };
  evidence.settlement = { settlementId: settlement.settlementId, billableEventId: settlement.billableEventId, charge: settlement.charge };
  const workKey = `whole_model|${reservation.reservationId}`;
  return result({ reward: computeReward(offer, { settledCharge: settlement.charge, ...settlement.metering }), workKey,
    unitKeys: [{ kind: 'whole_request', key: workKey }], pins: [],
    workRefs: { reservationId: reservation.reservationId, settlementId: settlement.settlementId, billableEventId: settlement.billableEventId,
      attemptId: claim.attemptId, ownerPolicyDigest: receipt.ownerPolicyDigest, receiptId: receipt.receiptId } });
}
