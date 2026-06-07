/**
 * @fileoverview Server-side pool receipt constants.
 */

export const RECEIPT_VERSION = 'reploid_browser_inference/v1';
export const TRUST_TIERS = Object.freeze({
  signedReceipt: 'T1_signed_receipt',
  canaryAudited: 'T2_canary_audited',
  redundantAgreement: 'T3_redundant_agreement',
  requesterAccepted: 'T4_requester_accepted'
});

export const PROVIDER_RECEIPT_TRUST_TIER = TRUST_TIERS.signedReceipt;

export default {
  RECEIPT_VERSION,
  TRUST_TIERS,
  PROVIDER_RECEIPT_TRUST_TIER
};
