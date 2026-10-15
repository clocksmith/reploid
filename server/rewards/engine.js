/**
 * @fileoverview Contribution reward operations over a transactional document
 * backend: offers, accepted-offer bindings, validated work and issuance.
 *
 * Each mutation commits its idempotency record and uniqueness claims in one
 * backend transaction, or nothing. Validation records are retained whether
 * accepted or rejected. Issuance runs through the credit ledger, whose
 * `issuanceAuthority` must be this component's issuance authority over the
 * same backend; a crash between steps resumes without a second effect.
 */

import { randomUUID } from 'node:crypto';

import custodyPolicy from '../../self/config/chat-files.json' with { type: 'json' };
import {
  assertId,
  assertIdempotencyKey,
  cloneJson,
  hashCanonical,
  isNonEmptyString,
  lotIdForSource,
  sha256Hex,
  sourceClaimKey,
  toMs
} from '../ledger/domain.js';
import { assertLedgerStoreContract } from '../ledger/store-contract.js';
import { nativeOwnerPolicyDigest, validateNativeOwnerPolicy } from '../native-owner/policy.js';
import {
  DEMANDED_INFERENCE_CONDITIONS,
  evaluateDemandedInference,
  participantShareKey,
  routeKey,
  stageShareKey,
  workIdForStageShare
} from './demanded-inference.js';
import { ISSUANCE_STATE_ID, createRewardIssuanceAuthority } from './issuance-authority.js';
import {
  OFFER_INPUT_KEYS,
  VALIDATION_SCHEMA,
  assertRewardCategory,
  buildOffer,
  fail,
  validateRewardPolicy
} from './domain.js';
import { assertRewardBackend, assertRewardStoreContract } from './store-contract.js';

const defaultClock = () => new Date().toISOString();
const defaultCreateId = (prefix) => `${prefix}_${randomUUID()}`;
const insert = (collection, id, value) => ({ create: true, collection, id, value });
const put = (collection, id, value) => ({ create: false, collection, id, value });
const pick = (input, keys) => Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));

const assertKnownKeys = (input, allowed, operation) => {
  const unknown = Object.keys(input || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) fail('invalid_input', `${operation} does not accept: ${unknown.join(', ')}`, { unknown });
};

/**
 * The contributor's authorization: a valid native owner policy with explicit
 * equipment and network grants, bound by its digest.
 */
function verifyOwnerAuthorization(value) {
  let policy;
  try {
    policy = validateNativeOwnerPolicy(value?.policy, { custody: custodyPolicy });
  } catch (error) {
    fail('owner_authorization_required', `contribution requires the owner policy in force: ${error.message}`);
  }
  if (nativeOwnerPolicyDigest(policy) !== value.digest) {
    fail('owner_authorization_required', 'the owner policy digest does not match the supplied owner policy');
  }
  return { schema: policy.schema, ownerPolicyDigest: value.digest, equipment: { ...policy.authorization.equipment }, network: { ...policy.authorization.network } };
}

const ledgerSource = (validation) => ({
  category: validation.ledgerCategory,
  workId: validation.workId,
  offerId: validation.offer.offerId,
  validationId: validation.validationId,
  validatorId: validation.validatorId,
  outcome: 'accepted',
  validatedAt: validation.validatedAt,
  rewardCategory: validation.category,
  rewardPolicyVersion: validation.rewardPolicyVersion,
  offerHash: validation.offer.offerHash,
  reservationId: validation.claim.reservationId,
  settlementId: validation.evidence.settlement.settlementId,
  billableEventId: validation.evidence.settlement.billableEventId,
  attemptId: validation.claim.attemptId,
  stageIndex: validation.claim.stageIndex,
  participantId: validation.offer.participantId,
  ownerPolicyDigest: validation.evidence.contribution.ownerPolicyDigest
});

const issuanceResult = (validation) => ({
  validationId: validation.validationId,
  status: validation.issuanceStatus,
  accountId: validation.offer.accountId,
  amount: validation.reward?.amount ?? 0,
  lotId: validation.issuance?.lotId ?? null,
  decisionId: validation.issuance?.decisionId ?? null
});

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend (see stores.js)
 * @param {object} options.ledger credit ledger store whose issuanceAuthority is this component's authority
 * @param {object} options.policy explicit reward policy; there is no default
 * @param {object} options.identity authenticated identity port:
 *   participantAccount(participantId) -> accountId | null, and
 *   accountLinks(accountA, accountB) -> [{ kind, evidenceId }]
 */
export function createRewardStore({ backend, ledger, policy, identity, clock = defaultClock, createId = defaultCreateId } = {}) {
  assertRewardBackend(backend);
  assertLedgerStoreContract(ledger);
  const rewardPolicy = validateRewardPolicy(policy);
  if (typeof identity?.participantAccount !== 'function' || typeof identity?.accountLinks !== 'function') {
    throw new TypeError('reward store requires an identity port with participantAccount and accountLinks');
  }
  const idempotencyId = (operation, scopeId, key) => sha256Hex(`${operation}\u0000${scopeId}\u0000${key}`);
  const claimId = (kind, key) => sha256Hex(`${kind}\u0000${key}`);

  const priorResult = (record, requestHash, operation) => {
    if (!record) return null;
    if (record.requestHash !== requestHash) fail('idempotency_conflict', 'idempotency key was already used with a different request', { operation });
    return { result: cloneJson(record.result) };
  };

  const lookupIdempotent = async ({ operation, scopeId, idempotencyKey, request }) => priorResult(
    await backend.get('idempotency', idempotencyId(operation, scopeId, idempotencyKey)),
    hashCanonical({ operation, request }),
    operation
  );

  const mutate = ({ operation, scopeId, idempotencyKey, request, now, body }) => {
    const requestHash = hashCanonical({ operation, request });
    const recordId = idempotencyId(operation, scopeId, idempotencyKey);
    return backend.runTransaction(async (tx) => {
      const prior = priorResult(await tx.get('idempotency', recordId), requestHash, operation);
      if (prior) return prior.result;
      const { result, writes } = await body(tx);
      for (const write of writes) {
        if (write.create) tx.create(write.collection, write.id, write.value);
        else tx.set(write.collection, write.id, write.value);
      }
      tx.create('idempotency', recordId, { operation, scopeId, idempotencyKey, requestHash, result, recordedAt: now });
      return cloneJson(result);
    });
  };

  const readOffer = async (offerId) => {
    const offer = await backend.get('offers', offerId);
    if (!offer) fail('offer_not_found', `offer ${offerId} was not found`, { offerId });
    return offer;
  };

  const store = {
    kind: backend.kind,
    policy: rewardPolicy,

    /** Disclose requested work, reward terms, validation conditions, bounds, duration and failure compensation. */
    async createOffer(input = {}) {
      const { idempotencyKey, ...request } = input;
      assertKnownKeys(request, OFFER_INPUT_KEYS, 'createOffer');
      assertId(request.accountId, 'accountId');
      assertRewardCategory(request.work?.category, rewardPolicy);
      assertIdempotencyKey(idempotencyKey);
      const operation = 'createOffer';
      const prior = await lookupIdempotent({ operation, scopeId: request.accountId, idempotencyKey, request });
      if (prior) return prior.result;
      const offerId = request.offerId ?? createId('offer');
      assertId(offerId, 'offerId');
      if (!await ledger.getAccount(request.accountId)) fail('account_not_found', `account ${request.accountId} was not found`);
      const now = clock();
      const offer = {
        ...buildOffer({ ...request, offerId }, { ledgerPolicy: ledger.policy, rewardPolicy, conditions: DEMANDED_INFERENCE_CONDITIONS, now }),
        status: 'offered',
        acceptedAt: null,
        acceptance: null
      };
      return mutate({
        operation, scopeId: request.accountId, idempotencyKey, request, now,
        body: async (tx) => {
          if (await tx.get('offers', offerId)) fail('offer_exists', 'offer id is already in use', { offerId });
          return { result: offer, writes: [insert('offers', offerId, offer)] };
        }
      });
    },

    async getOffer(offerId) {
      return backend.get('offers', offerId);
    },

    /**
     * Accept exactly the stored terms within the validity window. Acceptance
     * binds the contributor's owner policy; work bound earlier cannot earn.
     */
    async acceptOffer(input = {}) {
      assertKnownKeys(input, ['offerId', 'accountId', 'offerHash', 'ownerAuthorization', 'idempotencyKey'], 'acceptOffer');
      const { offerId, accountId, offerHash, idempotencyKey } = input;
      assertId(offerId, 'offerId');
      assertId(accountId, 'accountId');
      if (!isNonEmptyString(offerHash)) fail('invalid_input', 'offerHash must name the accepted terms');
      assertIdempotencyKey(idempotencyKey);
      const request = pick(input, ['offerId', 'accountId', 'offerHash', 'ownerAuthorization']);
      const operation = 'acceptOffer';
      const prior = await lookupIdempotent({ operation, scopeId: offerId, idempotencyKey, request });
      if (prior) return prior.result;
      const authorization = verifyOwnerAuthorization(input.ownerAuthorization);
      const stored = await readOffer(offerId);
      if (await identity.participantAccount(stored.work.participantId) !== accountId) {
        fail('participant_not_owned', 'the offer participant is not authenticated to this account', { participantId: stored.work.participantId });
      }
      const now = clock();
      return mutate({
        operation, scopeId: offerId, idempotencyKey, request, now,
        body: async (tx) => {
          const offer = await tx.get('offers', offerId);
          if (offer.accountId !== accountId) fail('offer_account_mismatch', 'offer was made to a different account');
          if (offer.status !== 'offered') fail('offer_already_accepted', 'offer was already accepted; changed terms need a new offer');
          if (offer.offerHash !== offerHash) fail('offer_terms_mismatch', 'accepted terms differ from the stored offer');
          if (toMs(now) >= toMs(offer.validUntil)) fail('offer_expired', 'offer validity window has ended', { validUntil: offer.validUntil });
          if (offer.accountingVersion !== ledger.policy.accountingVersion || offer.rewardPolicyVersion !== rewardPolicy.rewardPolicyVersion) {
            fail('offer_policy_changed', 'offer was made under a different accounting or reward policy; request a new offer');
          }
          assertRewardCategory(offer.category, rewardPolicy);
          Object.assign(offer, { status: 'accepted', acceptedAt: now, acceptance: authorization });
          return {
            result: { offerId, offerHash, accountId, acceptedAt: now, ownerPolicyDigest: authorization.ownerPolicyDigest },
            writes: [put('offers', offerId, offer)]
          };
        }
      });
    },

    /**
     * Validate one stage share of a settled attempt against an accepted
     * offer. Accepted and rejected outcomes are both retained; only an
     * accepted outcome takes the stage-share claims that block a second reward.
     */
    async validateWork(input = {}) {
      const fields = ['offerId', 'reservationId', 'attemptId', 'stageIndex', 'execution', 'contribution'];
      assertKnownKeys(input, [...fields, 'idempotencyKey'], 'validateWork');
      const { offerId, idempotencyKey } = input;
      assertId(offerId, 'offerId');
      assertId(input.reservationId, 'reservationId');
      assertId(input.attemptId, 'attemptId');
      if (!Number.isSafeInteger(input.stageIndex) || input.stageIndex < 0) fail('invalid_input', 'stageIndex must be a non-negative integer');
      assertIdempotencyKey(idempotencyKey);
      const request = pick(input, fields);
      const operation = 'validateWork';
      const prior = await lookupIdempotent({ operation, scopeId: offerId, idempotencyKey, request });
      if (prior) return prior.result;
      const offer = await readOffer(offerId);
      assertRewardCategory(offer.category, rewardPolicy);
      if (offer.status !== 'accepted') fail('offer_not_accepted', 'only an accepted offer can earn', { status: offer.status });
      const now = clock();
      const evaluation = await evaluateDemandedInference({ claim: request, offer, ledger, identity, rewardPolicy, now });
      const shareKey = stageShareKey(request);
      const keys = {
        stage: claimId('stage_share', shareKey),
        participant: claimId('participant_share', participantShareKey(request, offer.work.participantId)),
        route: claimId('route', routeKey(request))
      };
      return mutate({
        operation, scopeId: offerId, idempotencyKey, request, now,
        body: async (tx) => {
          const [stageClaim, participantClaim, routeClaim] = [
            await tx.get('claims', keys.stage), await tx.get('claims', keys.participant), await tx.get('claims', keys.route)
          ];
          const reasons = [...evaluation.reasons];
          if (stageClaim || participantClaim) {
            reasons.push({
              code: 'duplicate_reward',
              message: 'this stage share of the settled attempt already has a reward validation',
              details: { validationId: (stageClaim || participantClaim).validationId }
            });
          }
          if (routeClaim && evaluation.routeHash && routeClaim.routeHash !== evaluation.routeHash) {
            reasons.push({ code: 'route_conflict', message: 'the route summary differs from the route already validated for this attempt' });
          }
          const accepted = reasons.length === 0;
          const validationId = createId('val');
          const record = {
            schema: VALIDATION_SCHEMA,
            validationId,
            outcome: accepted ? 'accepted' : 'rejected',
            reasons,
            category: offer.category,
            ledgerCategory: offer.ledgerCategory,
            validatorId: rewardPolicy.validatorId,
            rewardPolicyVersion: rewardPolicy.rewardPolicyVersion,
            offer: { offerId, offerHash: offer.offerHash, accountId: offer.accountId, participantId: offer.work.participantId },
            claim: { reservationId: request.reservationId, attemptId: request.attemptId, stageIndex: request.stageIndex },
            evidence: evaluation.evidence,
            workId: accepted ? workIdForStageShare(shareKey) : null,
            reward: accepted ? evaluation.reward : null,
            issuanceStatus: accepted ? (evaluation.reward.amount > 0 ? 'pending' : 'no_credit') : 'not_eligible',
            issuance: null,
            validatedAt: now
          };
          const writes = [insert('validations', validationId, record)];
          if (accepted) {
            const claim = { validationId, offerId, reservationId: request.reservationId, attemptId: request.attemptId, recordedAt: now };
            writes.push(
              insert('claims', keys.stage, { ...claim, kind: 'stage_share', stageIndex: request.stageIndex }),
              insert('claims', keys.participant, { ...claim, kind: 'participant_share', participantId: offer.work.participantId })
            );
            if (!routeClaim) writes.push(insert('claims', keys.route, { ...claim, kind: 'route', routeHash: evaluation.routeHash }));
          }
          return { result: record, writes };
        }
      });
    },

    async getValidation(validationId) {
      return backend.get('validations', validationId);
    },

    /**
     * Issue the earned lot for an accepted validation through the ledger.
     * Deterministic ledger idempotency and per-validation allowances make a
     * retry after any crash converge on one lot.
     */
    async issueReward({ validationId } = {}) {
      assertId(validationId, 'validationId');
      const validation = await backend.get('validations', validationId);
      if (!validation) fail('validation_not_found', `validation ${validationId} was not found`);
      if (validation.outcome !== 'accepted') fail('validation_rejected', 'rejected work earns nothing', { reasons: validation.reasons });
      if (validation.issuanceStatus !== 'pending') return issuanceResult(validation);
      const source = ledgerSource(validation);
      let issued;
      try {
        issued = await ledger.issueCredits({
          accountId: validation.offer.accountId,
          provenance: 'earned',
          amount: validation.reward.amount,
          source,
          idempotencyKey: `reward:${validationId}`
        });
      } catch (error) {
        // A lot for this work under another key counts only if it names this validation.
        const lotId = lotIdForSource(sourceClaimKey('earned', source));
        if (error?.code !== 'duplicate_issuance_source' || (await ledger.getLot(lotId))?.source?.validationId !== validationId) throw error;
        issued = { lotId };
      }
      const lot = await ledger.getLot(issued.lotId);
      const now = clock();
      return backend.runTransaction(async (tx) => {
        const current = await tx.get('validations', validationId);
        if (current.issuanceStatus !== 'pending') return issuanceResult(current);
        const updated = {
          ...current,
          issuanceStatus: 'issued',
          issuance: { lotId: lot.lotId, decisionId: lot.issuance?.decisionId ?? null, limitId: lot.issuance?.limitId ?? null, issuedAt: now }
        };
        tx.set('validations', validationId, updated);
        return issuanceResult(updated);
      });
    },

    /** Finish validations left pending by a crash or a declined issuance; failures stay pending. */
    async resumeIssuance({ limit = 100 } = {}) {
      const pending = (await backend.list('validations', { field: 'issuanceStatus', value: 'pending' }))
        .sort((left, right) => toMs(left.validatedAt) - toMs(right.validatedAt) || left.validationId.localeCompare(right.validationId))
        .slice(0, limit);
      const results = [];
      for (const { validationId } of pending) {
        try {
          results.push(await store.issueReward({ validationId }));
        } catch (error) {
          results.push({ validationId, status: 'pending', code: error?.code ?? 'issuance_failed', reason: error?.details?.reason ?? null });
        }
      }
      return results;
    },

    async getIssuanceState() {
      const state = await backend.get('issuance', ISSUANCE_STATE_ID);
      return { authorizedTotal: state?.authorizedTotal ?? 0, allowances: state?.allowances ?? 0, updatedAt: state?.updatedAt ?? null };
    },

    /** Every retained issuance decision: allowances and declines with their limit figures. */
    async listIssuanceDecisions() {
      const [allowed, declined] = await Promise.all([backend.list('allowances'), backend.list('decisions')]);
      return [...allowed, ...declined]
        .sort((left, right) => toMs(left.decidedAt) - toMs(right.decidedAt) || left.decisionId.localeCompare(right.decisionId));
    }
  };
  return assertRewardStoreContract(store);
}

/**
 * Compose the ledger and reward store over one reward backend so the ledger's
 * issuance authority and the validator share the same policy and records.
 * `createLedger({ issuanceAuthority })` builds the ledger store.
 */
export function composeContributionRewards({
  backend, createLedger, rewardPolicy, issuancePolicy, identity, readAdmittedCapacity, otherProvenance = null,
  clock = defaultClock, createId = defaultCreateId
} = {}) {
  let ledger = null;
  const issuanceAuthority = createRewardIssuanceAuthority({
    backend, policy: issuancePolicy, rewardPolicy, readSolvency: () => ledger.getSolvencySnapshot(),
    readAdmittedCapacity, otherProvenance, clock, createId
  });
  ledger = createLedger({ issuanceAuthority });
  const rewards = createRewardStore({ backend, ledger, policy: rewardPolicy, identity, clock, createId });
  return { ledger, rewards, issuanceAuthority };
}

export default createRewardStore;
