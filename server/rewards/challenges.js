/**
 * @fileoverview Challenge operations for contracted storage and prepared
 * readiness. The reward store issues, times and records every challenge, so
 * contract evidence is the store's own record rather than a contributor claim.
 */

import { assertId, assertIdempotencyKey, isNonEmptyString, toMs } from '../ledger/domain.js';
import { CHALLENGE_KINDS, buildChallenge, selectChallengeTarget, verifyChallengeAnswer } from './contracted-obligations.js';
import { checkCounterparty } from './counterparty.js';
import { assertRewardCategory, fail } from './domain.js';

const pick = (input, keys) => Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
const assertKnownKeys = (input, allowed, operation) => {
  const unknown = Object.keys(input || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) fail('invalid_input', `${operation} does not accept: ${unknown.join(', ')}`, { unknown });
};

/**
 * @param {object} ports shared store internals: backend, ledger, identity,
 *   rewardPolicy, mutate, lookupIdempotent, readOffer, claimId, clock,
 *   createId and random(n) -> integer in [0, n)
 */
export function createChallengeOperations({
  backend, ledger, identity, rewardPolicy, mutate, lookupIdempotent, readOffer, claimId, clock, createId, random
}) {
  return {
    /**
     * Issue an unpredictable challenge inside an accepted contract's duration.
     * A service challenge designates an acquirer that is not the contributor,
     * its owner or a policy-linked account.
     */
    async issueChallenge(input = {}) {
      assertKnownKeys(input, ['offerId', 'kind', 'acquirerParticipantId', 'idempotencyKey'], 'issueChallenge');
      const { offerId, kind, idempotencyKey } = input;
      assertId(offerId, 'offerId');
      assertIdempotencyKey(idempotencyKey);
      const request = pick(input, ['offerId', 'kind', 'acquirerParticipantId']);
      const operation = 'issueChallenge';
      const prior = await lookupIdempotent({ operation, scopeId: offerId, idempotencyKey, request });
      if (prior) return prior.result;
      const offer = await readOffer(offerId);
      assertRewardCategory(offer.category, rewardPolicy);
      if (!CHALLENGE_KINDS[offer.category]?.includes(kind)) {
        fail('invalid_challenge_kind', `${offer.category} contracts take ${(CHALLENGE_KINDS[offer.category] || []).join(', ') || 'no'} challenges`, { kind });
      }
      if (offer.status !== 'accepted') fail('offer_not_accepted', 'only an accepted contract can be challenged', { status: offer.status });
      const now = clock();
      if (toMs(now) < toMs(offer.acceptedAt) || toMs(now) < toMs(offer.duration.startsAt) || toMs(now) >= toMs(offer.duration.endsAt)) {
        fail('challenge_outside_contract', 'challenges are issued only inside the accepted contract duration');
      }
      let acquirer = null;
      if (kind === 'service') {
        const participantId = input.acquirerParticipantId;
        if (!isNonEmptyString(participantId)) fail('invalid_input', 'a service challenge designates acquirerParticipantId');
        const accountId = await identity.participantAccount(participantId);
        if (!accountId || !await ledger.getAccount(accountId)) fail('acquirer_identity_unbound', 'the designated acquirer is not bound to a real account');
        const problems = [];
        await checkCounterparty({
          contributorAccountId: offer.accountId, counterpartyAccountId: accountId,
          contributorParticipantId: offer.work.participantId, counterpartyParticipantId: participantId,
          ledger, identity, rewardPolicy, reject: (code, message, details) => problems.push({ code, message, details })
        });
        if (problems.length) fail(problems[0].code, problems[0].message, { reasons: problems });
        acquirer = { participantId, accountId };
      } else if (input.acquirerParticipantId !== undefined) {
        fail('invalid_input', 'only service challenges designate an acquirer');
      }
      const challenge = buildChallenge({
        offer, kind, target: selectChallengeTarget(offer, kind, random), acquirer,
        challengeId: createId('chl'), nonce: createId('nonce'), now
      });
      return mutate({
        operation, scopeId: offerId, idempotencyKey, request, now,
        body: async () => ({ result: challenge, writes: [{ create: true, collection: 'challenges', id: challenge.challengeId, value: challenge }] })
      });
    },

    /**
     * Record an answer. An answer after the deadline records the challenge as
     * missed. A passed service answer takes its transfer, so the same
     * transfer cannot also earn a delivery reward.
     */
    async answerChallenge(input = {}) {
      assertKnownKeys(input, ['challengeId', 'answer', 'evidence', 'idempotencyKey'], 'answerChallenge');
      const { challengeId, idempotencyKey } = input;
      assertId(challengeId, 'challengeId');
      assertIdempotencyKey(idempotencyKey);
      const request = pick(input, ['challengeId', 'answer', 'evidence']);
      const operation = 'answerChallenge';
      const prior = await lookupIdempotent({ operation, scopeId: challengeId, idempotencyKey, request });
      if (prior) return prior.result;
      const challenge = await backend.get('challenges', challengeId);
      if (!challenge) fail('challenge_not_found', `challenge ${challengeId} was not found`);
      if (challenge.status !== 'open') fail('challenge_already_resolved', 'the challenge already has an outcome', { status: challenge.status });
      const offer = await readOffer(challenge.offerId);
      const now = clock();
      const late = toMs(now) > toMs(challenge.respondBy);
      const verdict = late ? null : await verifyChallengeAnswer({ challenge, offer, answer: input.answer, evidence: input.evidence, identity });
      const transferClaimId = verdict?.transfer ? claimId('transfer', verdict.transfer.key) : null;
      return mutate({
        operation, scopeId: challengeId, idempotencyKey, request, now,
        body: async (tx) => {
          const current = await tx.get('challenges', challengeId);
          const transferClaim = transferClaimId ? await tx.get('claims', transferClaimId) : null;
          if (current.status !== 'open') fail('challenge_already_resolved', 'the challenge already has an outcome', { status: current.status });
          if (transferClaim) fail('transfer_already_claimed', 'this transfer already earned a delivery reward or answered another challenge');
          const updated = {
            ...current,
            status: late ? 'missed' : verdict.status,
            answer: late
              ? { answeredAt: now, late: true, reasons: ['answered after the response deadline'] }
              : { answeredAt: now, late: false, reasons: verdict.reasons, publicKey: verdict.publicKey, transfer: verdict.transfer },
            resolvedAt: now
          };
          const writes = [{ create: false, collection: 'challenges', id: challengeId, value: updated }];
          if (transferClaimId) {
            writes.push({ create: true, collection: 'claims', id: transferClaimId,
              value: { kind: 'transfer', key: verdict.transfer.key, challengeId, offerId: offer.offerId, recordedAt: now } });
          }
          return { result: updated, writes };
        }
      });
    },

    async listChallenges(offerId) {
      const challenges = await backend.list('challenges', { field: 'offerId', value: offerId });
      return challenges.sort((left, right) => toMs(left.issuedAt) - toMs(right.issuedAt) || left.challengeId.localeCompare(right.challengeId));
    }
  };
}

export default createChallengeOperations;
