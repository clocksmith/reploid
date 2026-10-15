/**
 * @fileoverview Validators for explicitly contracted storage and prepared
 * readiness: obligations proven over the accepted interval by challenges the
 * reward store itself issues, times and records.
 *
 * - Storage contracts are `accessible_delivery`. Custody challenges name an
 *   unpredictable committed chunk of a contracted piece; the answer is that
 *   chunk's bytes, signed by an identity-certified custody key of the
 *   contributor. A timely byte response shows the bytes were delivered on
 *   time from some source; it cannot establish local custody.
 * - Service challenges ask the custodian to serve a contracted piece to a
 *   designated acquirer; only that acquirer's attested, verified REP-5
 *   receipt answers it.
 * - Readiness contracts are proven only by execution probes: the store runs a
 *   bounded real admission, execution and settlement on the contracted stage
 *   (see readiness-probe.js). Storage proofs never count for readiness.
 *
 * The duration divides into intervals. An interval verifies only when it holds
 * a passed custody challenge or execution probe and no failed or missed
 * obligation; a failed or missed one makes it an outage. A probe the prober
 * itself never finished is withdrawn and counts for neither side.
 */

import { isNonEmptyString, toMs } from '../ledger/domain.js';
import { checkCounterparty } from './counterparty.js';
import { CHALLENGE_ANSWER_SCHEMA, certifiedCustodyKey, verifyChunkBytes, verifyCustodyDelivery, verifySigned } from './custody-evidence.js';
import { computeReward, fail } from './domain.js';
import { transferKey } from './verified-delivery.js';

// v2 adds `obligationRef`: the scheduled obligation slot that issued it, or null.
export const CHALLENGE_SCHEMA = 'reploid.reward-challenge/v2';
/** Kinds callers may issue and answer; readiness uses store-run execution probes only. */
export const CHALLENGE_KINDS = Object.freeze({
  contracted_storage: Object.freeze(['custody', 'service']),
  prepared_readiness: Object.freeze([])
});

export const CONTRACTED_STORAGE_CONDITIONS = Object.freeze([
  'accessible_delivery: unpredictable chunk challenges over the contracted pieces, answered within the response window with the committed bytes and signed by an identity-certified custody key of the contributor; any source that delivers on time satisfies them',
  'service_requests: a designated acquirer receives, verifies and attests a contracted piece from the contributor within the service window',
  'interval_accounting: an interval verifies only with a passed custody challenge and no failed or missed obligation; failed or missed obligations are outages',
  'reduce_or_void: the accepted deduction formula and void thresholds apply to missed and failed obligations',
  'storage_is_not_readiness: custody proofs establish timely access to bytes only, never resident or prepared computation',
  'not_self_dealing: distinct contributor and contracting account, owner and link; service acquirers likewise',
  'single_reward: one reward per contract; a service transfer cannot also earn a delivery reward'
]);

export const PREPARED_READINESS_CONDITIONS = Object.freeze([
  'execution_probes: unpredictable probes reserve every promised admission slot on the contracted stage through its normal reservation ports, execute one bounded step whose output the reference comparison accepts, and settle every probe attempt within the response window',
  'interval_accounting: an interval verifies only with a passed probe and no failed probe; failed probes, including refused admission, failed execution, rejected output or unconfirmed cleanup, are outages',
  'reduce_or_void: the accepted deduction formula and void thresholds apply to failed probes',
  'presence_earns_nothing: reachability, heartbeats, declared state or stored bytes never pass a probe',
  'not_self_dealing: distinct contributor and contracting account, owner and link',
  'single_reward: one reward per contract'
]);

const challengeWindow = (offer, kind) => (kind === 'service' ? offer.obligations.serviceWindowMs : offer.obligations.responseWindowMs);

/** When every challenge issued inside the duration has passed its deadline. */
export const contractClosesAt = (offer) => toMs(offer.duration.endsAt)
  + Math.max(offer.obligations.responseWindowMs, offer.obligations.serviceWindowMs ?? 0);

/** Pick an unpredictable target. `random(n)` returns an integer in [0, n). */
export function selectChallengeTarget(offer, kind, random) {
  const { pieces } = offer.work;
  if (kind === 'service') {
    const piece = pieces[random(pieces.length)];
    return { artifactId: piece.artifactId, pieceHash: piece.hash, sizeBytes: piece.sizeBytes };
  }
  const chunks = pieces.flatMap((piece) => piece.chunks.map((chunk) => ({ piece, chunk })));
  const { piece, chunk } = chunks[random(chunks.length)];
  return { artifactId: piece.artifactId, pieceHash: piece.hash, chunkIndex: chunk.index, chunkOffset: chunk.offset, chunkSizeBytes: chunk.sizeBytes, chunkHash: chunk.hash };
}

/**
 * Effective status. An unanswered custody or service challenge past its
 * deadline is missed; an execution probe the prober never finished is
 * withdrawn, because the contributor had no chance to answer it.
 */
export const challengeStatus = (challenge, now) => {
  if (challenge.status !== 'open' || toMs(now) <= toMs(challenge.respondBy)) return challenge.status;
  return challenge.kind === 'execution' ? 'withdrawn' : 'missed';
};

export function buildChallenge({ offer, kind, target, acquirer, challengeId, nonce, now, obligationRef = null }) {
  return {
    schema: CHALLENGE_SCHEMA,
    challengeId,
    offerId: offer.offerId,
    obligationRef,
    category: offer.category,
    kind,
    participantId: offer.work.participantId,
    issuedAt: now,
    respondBy: new Date(toMs(now) + challengeWindow(offer, kind)).toISOString(),
    nonce,
    target,
    acquirer: acquirer ?? null,
    status: 'open',
    answer: null,
    resolvedAt: null
  };
}

/**
 * Verify an answer to a custody or service challenge. Unauthenticated or
 * unverifiable submissions throw and leave the challenge open; an
 * authenticated wrong answer fails it. Returns `{ status, reasons, publicKey, transfer }`.
 */
export async function verifyChallengeAnswer({ challenge, offer, answer, certificate, evidence, identity }) {
  const participantId = offer.work.participantId;
  if (challenge.kind === 'service') {
    const supplierKey = await certifiedCustodyKey(identity, { certificate: evidence?.supplierCertificate, at: evidence?.attestation?.attestedAt });
    if (supplierKey?.participantId !== participantId) fail('invalid_answer', 'the supplier custody key is not certified for the contracted participant');
    const { reasons, delivery } = await verifyCustodyDelivery({
      authorization: evidence.authorization, index: evidence.index, receipt: evidence.receipt, attestation: evidence.attestation,
      artifactId: challenge.target.artifactId, supplierPeerId: supplierKey.custodyPeerId
    });
    if (reasons.length) fail('invalid_answer', 'service evidence is not a verified, attested delivery', { reasons });
    const acquirerKey = await certifiedCustodyKey(identity, { certificate: evidence.acquirerCertificate, at: delivery.attestedAt });
    const acquirerAccount = acquirerKey && acquirerKey.custodyPeerId === delivery.acquirer.custodyPeerId && acquirerKey.publicKey === delivery.acquirer.publicKey
      ? await identity.participantAccount(acquirerKey.participantId) : null;
    const attestedAt = toMs(delivery.attestedAt);
    if (delivery.artifact.hash !== challenge.target.pieceHash || delivery.supplier.publicKey !== supplierKey.publicKey
      || acquirerKey?.participantId !== challenge.acquirer.participantId || acquirerAccount !== challenge.acquirer.accountId
      || attestedAt < toMs(challenge.issuedAt) || attestedAt > toMs(challenge.respondBy)) {
      fail('invalid_answer', 'service evidence is not the requested piece delivered by the contributor to the designated acquirer in the window');
    }
    return { status: 'passed', reasons: [], publicKey: delivery.supplier.publicKey,
      transfer: { key: transferKey(delivery.authorizationHash, delivery.artifact.artifactId), deliveredBytes: delivery.deliveredBytes } };
  }
  if (challenge.kind !== 'custody') fail('invalid_challenge_kind', 'only custody and service challenges take answers');
  const key = await certifiedCustodyKey(identity, { certificate, at: challenge.issuedAt });
  if (!isNonEmptyString(answer?.publicKey) || answer.challengeId !== challenge.challengeId || answer.nonce !== challenge.nonce
    || answer.offerId !== offer.offerId || key?.participantId !== participantId || key.publicKey !== answer.publicKey
    || await identity.participantAccount(participantId) !== offer.accountId
    || !await verifySigned(answer, answer.publicKey, CHALLENGE_ANSWER_SCHEMA)) {
    fail('answer_not_authenticated', 'the answer is not signed for this challenge by an identity-certified custody key of the contributor');
  }
  const chunk = { sizeBytes: challenge.target.chunkSizeBytes, hash: challenge.target.chunkHash };
  const reasons = await verifyChunkBytes(answer.response?.bytes, chunk) ? [] : ['the chunk bytes do not match the committed hash'];
  return { status: reasons.length ? 'failed' : 'passed', reasons, publicKey: answer.publicKey, transfer: null };
}

/** Classify challenges into meters and per-interval verification. */
export function contractMeters(offer, challenges, now) {
  const start = toMs(offer.duration.startsAt);
  const intervals = Math.ceil((toMs(offer.duration.endsAt) - start) / offer.obligations.intervalMs);
  const rows = Array.from({ length: intervals }, () => ({ proven: 0, outage: false }));
  const meters = {
    verifiedIntervals: 0, outageIntervals: 0, unverifiedIntervals: 0,
    passedChallenges: 0, missedChallenges: 0, failedChallenges: 0, withdrawnChallenges: 0,
    servedRequests: 0, failedServiceRequests: 0
  };
  for (const challenge of challenges) {
    const row = rows[Math.floor((toMs(challenge.issuedAt) - start) / offer.obligations.intervalMs)];
    if (!row) continue;
    const status = challengeStatus(challenge, now);
    if (challenge.kind === 'service') {
      if (status === 'passed') meters.servedRequests += 1;
      else if (status !== 'open') meters.failedServiceRequests += 1;
    } else if (status === 'withdrawn') {
      meters.withdrawnChallenges += 1;
      continue;
    } else if (status === 'passed') {
      meters.passedChallenges += 1;
      row.proven += 1;
    } else if (status === 'failed') meters.failedChallenges += 1;
    else if (status === 'missed') meters.missedChallenges += 1;
    if (status === 'failed' || status === 'missed') row.outage = true;
  }
  for (const row of rows) {
    if (row.outage) meters.outageIntervals += 1;
    else if (row.proven > 0) meters.verifiedIntervals += 1;
    else meters.unverifiedIntervals += 1;
  }
  return { meters, intervals };
}

/** Evaluate a closed contract from its recorded challenges. */
export async function evaluateContract({ offer, challenges, ledger, identity, rewardPolicy, now }) {
  const reasons = [];
  const reject = (code, message, details) => reasons.push(details ? { code, message, details } : { code, message });
  const evidence = { contractedBy: offer.work.contractedBy, challenges: challenges.length, links: [] };
  const closesAt = contractClosesAt(offer);
  if (toMs(now) < closesAt) {
    reject('contract_interval_open', 'the contracted interval and its last challenge deadlines have not closed');
    return { reasons, evidence };
  }
  if (toMs(now) > closesAt + offer.paymentTiming.claimWindowMs) reject('claim_window_closed', 'the claim arrived after the offer\'s claim window');
  if (await identity.participantAccount(offer.work.participantId) !== offer.accountId) {
    reject('contributor_identity_mismatch', 'the offer participant no longer belongs to the contributor account');
  }
  if (!await ledger.getAccount(offer.work.contractedBy)) {
    reject('contractor_unknown', 'the contracting account does not exist');
  } else {
    evidence.links = await checkCounterparty({
      contributorAccountId: offer.accountId, counterpartyAccountId: offer.work.contractedBy, ledger, identity, rewardPolicy, reject
    });
  }
  const { meters, intervals } = contractMeters(offer, challenges, now);
  evidence.intervals = intervals;
  let reward = null;
  try {
    reward = computeReward(offer, meters);
  } catch (error) {
    reject('metering_incomplete', error.message);
  }
  return {
    reasons,
    evidence,
    reward,
    workKey: `${offer.category}|${offer.offerId}`,
    unitKeys: [{ kind: 'contract', key: offer.offerId }],
    pins: [],
    workRefs: {
      contractId: offer.offerId,
      contractedBy: offer.work.contractedBy,
      intervalStartsAt: offer.duration.startsAt,
      intervalEndsAt: offer.duration.endsAt,
      intervals,
      verifiedIntervals: meters.verifiedIntervals,
      outageIntervals: meters.outageIntervals,
      ...(offer.category === 'prepared_readiness' ? { stageIndex: offer.work.stage.stageIndex } : {}),
      ownerPolicyDigest: offer.acceptance.ownerPolicyDigest
    }
  };
}

export default { CHALLENGE_KINDS, selectChallengeTarget, buildChallenge, verifyChallengeAnswer, contractMeters, evaluateContract };
