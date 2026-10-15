/**
 * @fileoverview Persistence-neutral contribution-reward store contract.
 *
 * The reward store and its issuance authority share one transactional
 * document backend with the same shape as the credit ledger's backend, under
 * separate collections. Balances and lots stay in the ledger.
 */

import { assertLedgerBackend } from '../ledger/store-contract.js';

export const REWARD_STORE_OPERATIONS = Object.freeze([
  'createOffer', 'getOffer', 'acceptOffer',
  'issueChallenge', 'answerChallenge', 'probeReadiness', 'listChallenges',
  'reserveFunding', 'getFunding', 'releaseFunding', 'resumeFunding',
  'validateWork', 'getValidation', 'issueReward', 'resumeIssuance',
  'getIssuanceState', 'listIssuanceDecisions'
]);

// Logical collection -> physical collection.
export const REWARD_COLLECTIONS = Object.freeze({
  offers: 'reward_offers',
  validations: 'reward_validations',
  challenges: 'reward_challenges',
  fundings: 'reward_fundings',
  claims: 'reward_claims',
  idempotency: 'reward_idempotency',
  issuance: 'reward_issuance_state',
  allowances: 'reward_issuance_allowances',
  decisions: 'reward_issuance_decisions'
});

export function validateRewardStoreContract(store) {
  const missing = REWARD_STORE_OPERATIONS.filter((operation) => typeof store?.[operation] !== 'function');
  return { ok: missing.length === 0, missing };
}

export function assertRewardStoreContract(store) {
  const { ok, missing } = validateRewardStoreContract(store);
  if (!ok) throw new TypeError(`Contribution reward store contract is incomplete: ${missing.join(', ')}`);
  return store;
}

export const assertRewardBackend = (backend) => assertLedgerBackend(backend);

export default {
  REWARD_STORE_OPERATIONS,
  REWARD_COLLECTIONS,
  validateRewardStoreContract,
  assertRewardStoreContract,
  assertRewardBackend
};
