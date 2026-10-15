/**
 * @fileoverview Acquirer-submitted delivery evidence.
 *
 * A certified acquirer submits its custody receipt, grant, chunk index and
 * its attestation of that exact receipt, with both parties' custody
 * certificates. Before the record is kept, the acquirer certificate must
 * name the submitting device's participant and bind the grant's requester
 * key, the supplier certificate must verify, and the custody delivery must
 * verify end to end. One record per delivered artifact of one grant; a
 * different submission for it is refused. A record is evidence for a later
 * `verified_delivery` claim, which validateWork checks again against the
 * contributor's offer; it earns nothing by itself.
 */

import { deliveryEvidenceId } from '../../packages/reploid/src/artifacts/delivery-attestation.js';
import { cloneJson, hashCanonical, isNonEmptyString } from '../ledger/domain.js';
import { certifiedCustodyKey, verifyCustodyDelivery } from './custody-evidence.js';
import { fail } from './domain.js';
import { VERIFIED_DELIVERY_CLAIM_KEYS, assertVerifiedDeliveryClaim } from './verified-delivery.js';

export const DELIVERY_EVIDENCE_SCHEMA = 'reploid.delivery-evidence/v1';

const view = (record) => ({
  deliveryId: record.deliveryId,
  authorizationHash: record.authorizationHash,
  transferId: record.transferId,
  artifactId: record.artifactId,
  pieceHash: record.pieceHash,
  deliveredBytes: record.deliveredBytes,
  attestedAt: record.attestedAt,
  submittedBy: { ...record.submittedBy },
  recordedAt: record.recordedAt
});

const assertKnownKeys = (input, allowed, operation) => {
  const unknown = Object.keys(input || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) fail('invalid_input', `${operation} does not accept: ${unknown.join(', ')}`, { unknown });
};

/**
 * @param {object} ctx reward store internals: backend, identity (with
 *   verifyCustodyKey), rewardPolicy and clock
 */
export function createDeliveryEvidenceOperations({ backend, identity, rewardPolicy, clock }) {
  return {
    /**
     * Keep a certified acquirer's delivery evidence. `submitter` is the
     * authenticated device's { accountId, participantId }, taken from its
     * session by the caller, never from the evidence.
     */
    async recordDeliveryEvidence(input = {}) {
      assertKnownKeys(input, ['submitter', 'evidence'], 'recordDeliveryEvidence');
      const { submitter, evidence } = input;
      if (!rewardPolicy.enabledCategories.includes('verified_delivery')) {
        fail('reward_category_disabled', 'verified_delivery rewards are not enabled by the active reward policy');
      }
      if (!isNonEmptyString(submitter?.accountId) || !isNonEmptyString(submitter?.participantId)) {
        fail('invalid_input', 'submitter must name the authenticated account and device participant');
      }
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail('invalid_input', 'evidence is required');
      assertKnownKeys(evidence, VERIFIED_DELIVERY_CLAIM_KEYS, 'delivery evidence');
      assertVerifiedDeliveryClaim(evidence, { fail });
      const at = evidence.attestation.attestedAt;
      const acquirer = await certifiedCustodyKey(identity, { certificate: evidence.acquirerCertificate, at });
      if (!acquirer || acquirer.participantId !== submitter.participantId) {
        fail('acquirer_device_mismatch', 'the acquirer certificate is not an active certificate of the submitting device');
      }
      const requester = evidence.authorization?.requester;
      if (acquirer.custodyPeerId !== requester?.peerId || acquirer.publicKey !== requester?.publicKey) {
        fail('acquirer_identity_unbound', 'the certified custody key is not the grant\'s requester key');
      }
      const supplier = await certifiedCustodyKey(identity, { certificate: evidence.supplierCertificate, at });
      if (!supplier) fail('supplier_identity_unbound', 'the supplier custody key is not certified for a registered participant');
      let checked;
      try {
        checked = await verifyCustodyDelivery({ ...evidence, supplierPeerId: supplier.custodyPeerId });
      } catch {
        checked = { reasons: [{ code: 'delivery_evidence_malformed' }], delivery: null };
      }
      const { reasons, delivery } = checked;
      if (reasons.length || delivery?.supplier.publicKey !== supplier.publicKey) {
        fail('delivery_evidence_invalid', 'the delivery evidence does not verify', {
          reasons: reasons.length ? reasons.map((reason) => reason.code) : ['supplier_identity_unbound']
        });
      }
      const deliveryId = await deliveryEvidenceId({ authorizationHash: delivery.authorizationHash, artifactId: evidence.artifactId });
      const evidenceHash = hashCanonical(evidence);
      const now = clock();
      return backend.runTransaction(async (tx) => {
        const existing = await tx.get('deliveries', deliveryId);
        if (existing) {
          if (existing.evidenceHash !== evidenceHash) fail('delivery_evidence_exists', 'different evidence was already submitted for this delivery', { deliveryId });
          return view(existing);
        }
        const record = {
          schema: DELIVERY_EVIDENCE_SCHEMA,
          deliveryId,
          authorizationHash: delivery.authorizationHash,
          transferId: delivery.transferId,
          artifactId: evidence.artifactId,
          pieceHash: delivery.artifact.hash,
          deliveredBytes: delivery.deliveredBytes,
          attestedAt: delivery.attestedAt,
          submittedBy: { accountId: submitter.accountId, participantId: submitter.participantId },
          evidenceHash,
          evidence: cloneJson(evidence),
          recordedAt: now
        };
        tx.create('deliveries', deliveryId, record);
        return view(record);
      });
    },

    /** The kept record with its evidence, or null. */
    async getDeliveryEvidence(deliveryId) {
      return typeof deliveryId === 'string' && /^dlv_[a-f0-9]{32}$/.test(deliveryId) ? backend.get('deliveries', deliveryId) : null;
    }
  };
}

export default createDeliveryEvidenceOperations;
