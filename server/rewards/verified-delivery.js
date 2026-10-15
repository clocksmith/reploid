/**
 * @fileoverview Validator for useful verified delivery: a piece or file the
 * offer names, which a real acquirer requested, received, verified against the
 * custody commitments and attested.
 *
 * The delivered unit is one piece to one acquirer account. A transfer earns
 * once, and the same acquirer receiving the same piece again earns nothing.
 * Chunks the acquirer restored from its own checkpoints earn nothing.
 */

import { isNonEmptyString, toMs } from '../ledger/domain.js';
import { checkCounterparty } from './counterparty.js';
import { certifiedCustodyKey, verifyCustodyDelivery } from './custody-evidence.js';
import { computeReward } from './domain.js';

export const VERIFIED_DELIVERY_CONDITIONS = Object.freeze([
  'custody_grant_bound: the REP-5 grant, artifact set, chunk index and acquirer receipt bind one transfer',
  'recipient_attested: the acquirer signed that exact receipt with the grant\'s requester key',
  'delivery_verified: the acquirer completed the piece; every credited chunk has the acquirer\'s signed request, the contributor\'s signed response and the committed hash observed',
  'piece_demanded: the delivered piece is one the offer names, requested by a real acquirer account whose identity certifies the requester key',
  'work_within_offer: attested after acceptance, inside the duration, transfer bound and claim window',
  'not_self_dealing: distinct acquirer and contributor account, owner and participant, and no disqualifying account link',
  'single_reward: once per piece per acquirer account, and once per transfer'
]);

export const VERIFIED_DELIVERY_CLAIM_KEYS = Object.freeze([
  'artifactId', 'authorization', 'index', 'receipt', 'attestation', 'supplierCertificate', 'acquirerCertificate'
]);

export function assertVerifiedDeliveryClaim(claim, { fail }) {
  if (!isNonEmptyString(claim.artifactId) || claim.artifactId.length > 256) fail('invalid_input', 'artifactId must name the delivered artifact');
  for (const key of ['authorization', 'index', 'receipt', 'attestation']) {
    if (!claim[key] || typeof claim[key] !== 'object') fail('invalid_input', `${key} is required delivery evidence`);
  }
  for (const key of ['supplierCertificate', 'acquirerCertificate']) {
    if (claim[key] == null) fail('invalid_input', `${key} must certify the custody key with the participant's identity`);
  }
}

export const deliveryUnitKey = (acquirerAccountId, pieceHash) => `${acquirerAccountId}|${pieceHash}`;
export const transferKey = (authorizationHash, artifactId) => `${authorizationHash}|${artifactId}`;

/** Evaluate a delivery claim; returns every failed condition as a reason. */
export async function evaluateVerifiedDelivery({ claim, offer, ledger, identity, rewardPolicy, now }) {
  const participantId = offer.work.participantId;
  const evidence = { delivery: null, acquirerAccountId: null, acquirerParticipantId: null, links: [] };
  // Custody keys and grant peer ids are per-process; only identity certificates attribute them.
  const supplierKey = await certifiedCustodyKey(identity, { certificate: claim.supplierCertificate, at: claim.attestation?.attestedAt });
  if (supplierKey?.participantId !== participantId) {
    return { reasons: [{ code: 'contributor_identity_mismatch', message: 'the supplier custody key is not certified for the offer participant' }], evidence };
  }
  const { reasons, delivery } = await verifyCustodyDelivery({
    authorization: claim.authorization, index: claim.index, receipt: claim.receipt, attestation: claim.attestation,
    artifactId: claim.artifactId, supplierPeerId: supplierKey.custodyPeerId
  });
  const reject = (code, message, details) => reasons.push(details ? { code, message, details } : { code, message });
  evidence.delivery = delivery;
  if (!delivery) return { reasons, evidence };
  if (delivery.supplier.publicKey !== supplierKey.publicKey) {
    reject('contributor_identity_mismatch', 'the granted supplier key is not the certified custody key');
  }

  if (!offer.work.pieces.some((piece) => piece.hash === delivery.artifact.hash && piece.sizeBytes === delivery.artifact.sizeBytes)) {
    reject('piece_not_offered', 'the delivered artifact is not a piece this offer requests');
  }
  const acquirerKey = await certifiedCustodyKey(identity, { certificate: claim.acquirerCertificate, at: delivery.attestedAt });
  const acquirerAccountId = acquirerKey && acquirerKey.custodyPeerId === delivery.acquirer.custodyPeerId
    && acquirerKey.publicKey === delivery.acquirer.publicKey ? await identity.participantAccount(acquirerKey.participantId) : null;
  evidence.acquirerAccountId = acquirerAccountId;
  evidence.acquirerParticipantId = acquirerAccountId ? acquirerKey.participantId : null;
  if (!acquirerAccountId || !await ledger.getAccount(acquirerAccountId)) {
    reject('acquirer_identity_unbound', 'the requester key is not certified for a real acquirer account');
    return { reasons, evidence };
  }
  evidence.links = await checkCounterparty({
    contributorAccountId: offer.accountId, counterpartyAccountId: acquirerAccountId,
    contributorParticipantId: participantId, counterpartyParticipantId: acquirerKey.participantId,
    ledger, identity, rewardPolicy, reject
  });

  const attestedAt = toMs(delivery.attestedAt);
  if (!(attestedAt >= toMs(offer.acceptedAt)) || !(delivery.grantExpiresAt > toMs(offer.acceptedAt))) {
    reject('work_precedes_offer', 'the transfer was not granted and attested after the contributor accepted the offer');
  }
  if (!(attestedAt >= toMs(offer.duration.startsAt)) || !(attestedAt <= toMs(offer.duration.endsAt)) || attestedAt > toMs(now)) {
    reject('work_outside_offer_window', 'the delivery was not attested inside the offer duration');
  }
  if (toMs(now) > attestedAt + offer.paymentTiming.claimWindowMs) reject('claim_window_closed', 'the claim arrived after the offer\'s claim window');
  if (delivery.deliveredBytes > offer.resourceBounds.transferBytes.max) {
    reject('work_exceeds_offer_bounds', 'the delivered bytes exceed the offer\'s transfer bound');
  }

  let reward = null;
  try {
    reward = computeReward(offer, { deliveredBytes: delivery.deliveredBytes, deliveredPieces: 1 });
  } catch (error) {
    reject('metering_incomplete', error.message);
  }
  return {
    reasons,
    evidence,
    reward,
    workKey: `verified_delivery|${transferKey(delivery.authorizationHash, delivery.artifact.artifactId)}`,
    unitKeys: [
      { kind: 'delivery_unit', key: deliveryUnitKey(acquirerAccountId, delivery.artifact.hash) },
      { kind: 'transfer', key: transferKey(delivery.authorizationHash, delivery.artifact.artifactId) }
    ],
    pins: [],
    workRefs: {
      authorizationHash: delivery.authorizationHash,
      transferId: delivery.transferId,
      artifactId: delivery.artifact.artifactId,
      pieceHash: delivery.artifact.hash,
      acquirerAccountId,
      acquirerParticipantId: acquirerKey.participantId,
      acquirerCustodyPeerId: delivery.acquirer.custodyPeerId,
      deliveredBytes: delivery.deliveredBytes,
      attestedAt: delivery.attestedAt,
      ownerPolicyDigest: offer.acceptance.ownerPolicyDigest
    }
  };
}

export default { VERIFIED_DELIVERY_CONDITIONS, evaluateVerifiedDelivery };
