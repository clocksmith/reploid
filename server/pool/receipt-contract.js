/**
 * @fileoverview Server-side pool receipt constants.
 */

import { POOL_CONFIG } from './config.js';

export const RECEIPT_VERSION = 'reploid_browser_inference/v1';
export const TRUST_TIERS = Object.freeze({
  signedReceipt: 'T1_signed_receipt',
  canaryAudited: 'T2_canary_audited',
  redundantAgreement: 'T3_redundant_agreement',
  ringBaseline: 'T1_ring_baseline',
  pairedRingReceipt: 'T2_paired_ring_receipt',
  majorityRingReceipt: 'T3_majority_ring_receipt',
  maxRingQuorumReceipt: 'T4_max_ring_quorum_receipt',
  requesterAccepted: 'T4_requester_accepted'
});

export const PROVIDER_RECEIPT_TRUST_TIER = POOL_CONFIG.policies.fastest_receipt.trustTier || TRUST_TIERS.signedReceipt;

export default {
  RECEIPT_VERSION,
  TRUST_TIERS,
  PROVIDER_RECEIPT_TRUST_TIER
};
