import { createKnownKeyValidator } from '../input-validation.js';
/**
 * @fileoverview Challenge operations for contracted storage and prepared
 * readiness. The reward store issues, times and records every challenge and
 * runs every readiness probe, so contract evidence is the store's own record
 * rather than a contributor claim.
 */

import { assertId, assertIdempotencyKey, isNonEmptyString, toMs } from '../ledger/domain.js';
import { CHALLENGE_KINDS, buildChallenge, selectChallengeTarget, verifyChallengeAnswer } from './contracted-obligations.js';
import { checkCounterparty } from './counterparty.js';
import { assertRewardCategory, fail } from './domain.js';
import { probePassed, runReadinessProbe } from './readiness-probe.js';

const pick = (input, keys) => Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
const assertKnownKeys = createKnownKeyValidator(fail);

/**
 * @param {object} ports shared store internals: backend, ledger, identity,
 *   rewardPolicy, mutate, lookupIdempotent, readOffer, claimId, clock,
 *   createId, random(n) -> integer in [0, n) and the readiness prober
 */
export function createChallengeOperations({
  backend, ledger, identity, rewardPolicy, mutate, lookupIdempotent, readOffer, claimId, clock, createId, random, prober
}) {
  return {
    /**
     * Issue an unpredictable challenge inside an accepted contract's duration.
     * A service challenge designates an acquirer that is not the contributor,
     * its owner or a policy-linked account. `obligationRef` names the
     * scheduled obligation that asked, so a scheduler can find it again.
     */
    async issueChallenge(input = {}) {
      assertKnownKeys(input, ['offerId', 'kind', 'acquirerParticipantId', 'obligationRef', 'idempotencyKey'], 'issueChallenge');
      const { offerId, kind, idempotencyKey } = input;
      assertId(offerId, 'offerId');
      if (input.obligationRef !== undefined) assertId(input.obligationRef, 'obligationRef');
      assertIdempotencyKey(idempotencyKey);
      const request = pick(input, ['offerId', 'kind', 'acquirerParticipantId', 'obligationRef']);
      const operation = 'issueChallenge';
      const prior = await lookupIdempotent({ operation, scopeId: offerId, idempotencyKey, request });
      if (prior) return prior.result;
      const offer = await readOffer(offerId);
      assertRewardCategory(offer.category, rewardPolicy);
      if (!CHALLENGE_KINDS[offer.category]?.includes(kind)) {
        fail('invalid_challenge_kind', offer.category === 'prepared_readiness'
          ? 'readiness is proven only by execution probes the store runs; use probeReadiness'
          : `${offer.category} contracts take ${(CHALLENGE_KINDS[offer.category] || []).join(', ') || 'no'} challenges`, { kind });
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
        challengeId: createId('chl'), nonce: createId('nonce'), now, obligationRef: input.obligationRef ?? null
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
      assertKnownKeys(input, ['challengeId', 'answer', 'certificate', 'evidence', 'idempotencyKey'], 'answerChallenge');
      const { challengeId, idempotencyKey } = input;
      assertId(challengeId, 'challengeId');
      assertIdempotencyKey(idempotencyKey);
      const request = pick(input, ['challengeId', 'answer', 'certificate', 'evidence']);
      const operation = 'answerChallenge';
      const prior = await lookupIdempotent({ operation, scopeId: challengeId, idempotencyKey, request });
      if (prior) return prior.result;
      const challenge = await backend.get('challenges', challengeId);
      if (!challenge) fail('challenge_not_found', `challenge ${challengeId} was not found`);
      if (challenge.status !== 'open') fail('challenge_already_resolved', 'the challenge already has an outcome', { status: challenge.status });
      const offer = await readOffer(challenge.offerId);
      const now = clock();
      const late = toMs(now) > toMs(challenge.respondBy);
      const verdict = late ? null : await verifyChallengeAnswer({
        challenge, offer, answer: input.answer, certificate: input.certificate, evidence: input.evidence, identity
      });
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

    /**
     * Run one bounded execution probe on a readiness contract's stage. The
     * probe is recorded open before it runs; a probe the prober never
     * finishes stays open and is withdrawn, never charged to the contributor.
     * Only the caller whose request recorded the probe runs it, so a
     * concurrent or repeated request never drives the stage a second time.
     */
    async probeReadiness(input = {}) {
      assertKnownKeys(input, ['offerId', 'obligationRef', 'idempotencyKey'], 'probeReadiness');
      const { offerId, idempotencyKey } = input;
      assertId(offerId, 'offerId');
      if (input.obligationRef !== undefined) assertId(input.obligationRef, 'obligationRef');
      assertIdempotencyKey(idempotencyKey);
      const operation = 'probeReadiness';
      const request = pick(input, ['offerId', 'obligationRef']);
      const prior = await lookupIdempotent({ operation, scopeId: offerId, idempotencyKey, request });
      if (prior) return backend.get('challenges', prior.result.challengeId);
      const offer = await readOffer(offerId);
      assertRewardCategory(offer.category, rewardPolicy);
      if (offer.category !== 'prepared_readiness') fail('invalid_challenge_kind', 'only readiness contracts take execution probes');
      if (offer.status !== 'accepted') fail('offer_not_accepted', 'only an accepted contract can be probed', { status: offer.status });
      const now = clock();
      if (toMs(now) < toMs(offer.acceptedAt) || toMs(now) < toMs(offer.duration.startsAt) || toMs(now) >= toMs(offer.duration.endsAt)) {
        fail('challenge_outside_contract', 'probes run only inside the accepted contract duration');
      }
      const { model, stageIndex } = offer.work.stage;
      const challengeId = createId('chl');
      const nonce = createId('nonce');
      const issued = await mutate({
        operation, scopeId: offerId, idempotencyKey, request, now,
        body: async () => {
          const challenge = buildChallenge({
            offer, kind: 'execution', target: { model, stageIndex, attemptSlots: offer.resourceBounds.attemptSlots.max },
            acquirer: null, challengeId, nonce, now, obligationRef: request.obligationRef ?? null
          });
          return { result: challenge, writes: [{ create: true, collection: 'challenges', id: challenge.challengeId, value: challenge }] };
        }
      });
      // A concurrent request with this key recorded the probe first; that caller runs it.
      if (issued.challengeId !== challengeId) return backend.get('challenges', issued.challengeId);
      const receipt = await runReadinessProbe({ challenge: issued, offer, prober, clock });
      const status = receipt.withdrawn ? 'withdrawn' : probePassed(receipt, offer.resourceBounds.attemptSlots.max) ? 'passed' : 'failed';
      return backend.runTransaction(async (tx) => {
        const current = await tx.get('challenges', issued.challengeId);
        if (current.status !== 'open') return current;
        const updated = {
          ...current, status, resolvedAt: clock(),
          answer: { answeredAt: receipt.finishedAt, late: false, reasons: receipt.reasons, probe: JSON.parse(JSON.stringify(receipt)) }
        };
        tx.set('challenges', issued.challengeId, updated);
        return updated;
      });
    },

    async listChallenges(offerId) {
      const challenges = await backend.list('challenges', { field: 'offerId', value: offerId });
      return challenges.sort((left, right) => toMs(left.issuedAt) - toMs(right.issuedAt) || left.challengeId.localeCompare(right.challengeId));
    }
  };
}

export default createChallengeOperations;
