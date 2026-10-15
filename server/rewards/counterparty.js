/**
 * @fileoverview Self-dealing and collusion rule shared by every reward category.
 *
 * Always rejected: the same account, accounts with the same owner, and the
 * contributor's own participant acting as the counterparty. Also rejected:
 * account links whose kind the explicit reward policy names. Other observed
 * links are retained as evidence.
 */

import { isNonEmptyString } from '../ledger/domain.js';

const normalizeLinks = (links) => (Array.isArray(links) ? links : [])
  .filter((link) => isNonEmptyString(link?.kind))
  .map((link) => ({ kind: link.kind, evidenceId: isNonEmptyString(link.evidenceId) ? link.evidenceId : null }));

/**
 * @param {object} options
 * @param {string} options.contributorAccountId
 * @param {string} options.counterpartyAccountId requester, acquirer or contracting account
 * @param {string|null} [options.contributorParticipantId]
 * @param {string|null} [options.counterpartyParticipantId]
 * @param {Function} options.reject (code, message, details) collector
 * @returns {Promise<Array<{kind:string, evidenceId:string|null}>>} observed account links
 */
export async function checkCounterparty({
  contributorAccountId, counterpartyAccountId, contributorParticipantId = null, counterpartyParticipantId = null,
  ledger, identity, rewardPolicy, reject
}) {
  const [contributor, counterparty, links] = await Promise.all([
    ledger.getAccount(contributorAccountId),
    ledger.getAccount(counterpartyAccountId),
    identity.accountLinks(contributorAccountId, counterpartyAccountId)
  ]);
  if (contributorAccountId === counterpartyAccountId) {
    reject('self_dealing', 'counterparty and contributor are the same account');
  } else if (!contributor || !counterparty || contributor.ownerId === counterparty.ownerId) {
    reject('self_dealing', 'counterparty and contributor accounts share an owner or cannot be distinguished');
  }
  if (contributorParticipantId && contributorParticipantId === counterpartyParticipantId) {
    reject('self_dealing', 'the contributor participant is its own counterparty');
  }
  const observed = normalizeLinks(links);
  const disqualifying = [...new Set(observed.map((link) => link.kind)
    .filter((kind) => rewardPolicy.collusion.rejectLinkKinds.includes(kind)))];
  if (disqualifying.length) {
    reject('collusive_demand', 'counterparty and contributor accounts are linked by a disqualifying relation', { kinds: disqualifying });
  }
  return observed;
}

export default checkCounterparty;
