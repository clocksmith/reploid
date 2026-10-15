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

import { randomInt, randomUUID } from 'node:crypto';

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
import { createChallengeOperations } from './challenges.js';
import {
  CONTRACTED_STORAGE_CONDITIONS,
  PREPARED_READINESS_CONDITIONS,
  evaluateContract
} from './contracted-obligations.js';
import {
  DEMANDED_INFERENCE_CLAIM_KEYS,
  DEMANDED_INFERENCE_CONDITIONS,
  assertDemandedInferenceClaim,
  evaluateDemandedInference
} from './demanded-inference.js';
import { ISSUANCE_STATE_ID, createRewardIssuanceAuthority } from './issuance-authority.js';
import {
  OFFER_INPUT_KEYS,
  REWARD_CATEGORIES,
  VALIDATION_SCHEMA,
  assertRewardCategory,
  buildOffer,
  fail,
  validateRewardPolicy
} from './domain.js';
import {
  VERIFIED_DELIVERY_CLAIM_KEYS,
  VERIFIED_DELIVERY_CONDITIONS,
  assertVerifiedDeliveryClaim,
  evaluateVerifiedDelivery
} from './verified-delivery.js';
import { assertRewardBackend, assertRewardStoreContract } from './store-contract.js';

const defaultClock = () => new Date().toISOString();
const defaultCreateId = (prefix) => `${prefix}_${randomUUID()}`;
const defaultRandom = (bound) => randomInt(bound);
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

/** One validator per category: disclosed conditions, accepted claim fields and evaluation. */
const VALIDATORS = Object.freeze({
  demanded_inference: {
    workPrefix: 'dinf', conditions: DEMANDED_INFERENCE_CONDITIONS, claimKeys: DEMANDED_INFERENCE_CLAIM_KEYS,
    assertClaim: assertDemandedInferenceClaim, evaluate: evaluateDemandedInference
  },
  verified_delivery: {
    workPrefix: 'dlvr', conditions: VERIFIED_DELIVERY_CONDITIONS, claimKeys: VERIFIED_DELIVERY_CLAIM_KEYS,
    assertClaim: assertVerifiedDeliveryClaim, evaluate: evaluateVerifiedDelivery
  },
  contracted_storage: {
    workPrefix: 'stor', conditions: CONTRACTED_STORAGE_CONDITIONS, claimKeys: [], assertClaim: () => {}, evaluate: evaluateContract
  },
  prepared_readiness: {
    workPrefix: 'rdy', conditions: PREPARED_READINESS_CONDITIONS, claimKeys: [], assertClaim: () => {}, evaluate: evaluateContract
  }
});

// Every lot names its validated work and the category's own references.
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
  participantId: validation.offer.participantId,
  ...validation.workRefs
});

const issuanceStatusFor = (outcome, reward) => {
  if (outcome === 'rejected') return 'not_eligible';
  if (outcome === 'voided') return 'voided';
  return reward.amount > 0 ? 'pending' : 'no_credit';
};

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
 *   participantAccount(participantId) -> accountId | null,
 *   accountLinks(accountA, accountB) -> [{ kind, evidenceId }], and, for
 *   categories other than demanded inference,
 *   participantKeyAccount(participantId, publicKey) -> accountId | null
 * @param {Function} [options.random] random(n) -> integer in [0, n) for challenge targets
 */
export function createRewardStore({
  backend, ledger, policy, identity, clock = defaultClock, createId = defaultCreateId, random = defaultRandom
} = {}) {
  assertRewardBackend(backend);
  assertLedgerStoreContract(ledger);
  const rewardPolicy = validateRewardPolicy(policy);
  if (typeof identity?.participantAccount !== 'function' || typeof identity?.accountLinks !== 'function') {
    throw new TypeError('reward store requires an identity port with participantAccount and accountLinks');
  }
  if (rewardPolicy.enabledCategories.some((category) => category !== 'demanded_inference')
    && typeof identity.participantKeyAccount !== 'function') {
    throw new TypeError('delivery, storage and readiness rewards require identity.participantKeyAccount to bind signing keys');
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

    ...createChallengeOperations({
      backend, ledger, identity, rewardPolicy, mutate, lookupIdempotent, readOffer, claimId, clock, createId, random
    }),

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
      const category = request.work.category;
      if (REWARD_CATEGORIES[category].contracted && (typeof request.work.contractedBy !== 'string' || !await ledger.getAccount(request.work.contractedBy))) {
        fail('account_not_found', 'work.contractedBy must name an existing contracting account');
      }
      const now = clock();
      const offer = {
        ...buildOffer({ ...request, offerId }, { ledgerPolicy: ledger.policy, rewardPolicy, conditions: VALIDATORS[category].conditions, now }),
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
     * Validate a claim against its accepted offer with the category's
     * validator. Every outcome is retained. Accepted and voided outcomes take
     * the unit-of-work claims that block a second reward; rejections take none.
     */
    async validateWork(input = {}) {
      const { offerId, idempotencyKey } = input;
      assertId(offerId, 'offerId');
      const offer = await readOffer(offerId);
      const validator = VALIDATORS[offer.category];
      assertKnownKeys(input, ['offerId', ...validator.claimKeys, 'idempotencyKey'], 'validateWork');
      validator.assertClaim(input, { assertId, fail });
      assertIdempotencyKey(idempotencyKey);
      const request = pick(input, ['offerId', ...validator.claimKeys]);
      const operation = 'validateWork';
      const prior = await lookupIdempotent({ operation, scopeId: offerId, idempotencyKey, request });
      if (prior) return prior.result;
      assertRewardCategory(offer.category, rewardPolicy);
      if (offer.status !== 'accepted') fail('offer_not_accepted', 'only an accepted offer can earn', { status: offer.status });
      const now = clock();
      const challenges = REWARD_CATEGORIES[offer.category].contracted
        ? await backend.list('challenges', { field: 'offerId', value: offerId }) : [];
      const evaluation = await validator.evaluate({ claim: request, offer, ledger, identity, rewardPolicy, now, challenges });
      const units = (evaluation.unitKeys || []).map((unit) => ({ ...unit, id: claimId(unit.kind, unit.key) }));
      const pins = (evaluation.pins || []).map((pin) => ({ ...pin, id: claimId(pin.kind, pin.key) }));
      return mutate({
        operation, scopeId: offerId, idempotencyKey, request, now,
        body: async (tx) => {
          const takenUnits = [];
          for (const unit of units) takenUnits.push(await tx.get('claims', unit.id));
          const pinned = [];
          for (const pin of pins) pinned.push(await tx.get('claims', pin.id));
          const reasons = [...evaluation.reasons];
          const taken = takenUnits.find(Boolean);
          if (taken) {
            reasons.push({
              code: 'duplicate_reward',
              message: 'this unit of work already has a reward validation or answered a contract obligation',
              details: taken.validationId ? { validationId: taken.validationId } : { challengeId: taken.challengeId }
            });
          }
          pins.forEach((pin, index) => {
            if (pinned[index] && pinned[index].value !== pin.value) {
              reasons.push({ code: `${pin.kind}_conflict`, message: `the ${pin.kind} differs from the one already validated for this work` });
            }
          });
          const outcome = reasons.length ? 'rejected' : (evaluation.reward.voided ? 'voided' : 'accepted');
          const counted = outcome !== 'rejected';
          const validationId = createId('val');
          const record = {
            schema: VALIDATION_SCHEMA,
            validationId,
            outcome,
            reasons,
            category: offer.category,
            ledgerCategory: offer.ledgerCategory,
            validatorId: rewardPolicy.validatorId,
            rewardPolicyVersion: rewardPolicy.rewardPolicyVersion,
            offer: { offerId, offerHash: offer.offerHash, accountId: offer.accountId, participantId: offer.work.participantId },
            claim: pick(request, ['reservationId', 'attemptId', 'stageIndex', 'artifactId']),
            evidence: evaluation.evidence,
            workId: counted ? `${validator.workPrefix}_${sha256Hex(evaluation.workKey).slice(0, 32)}` : null,
            workRefs: counted ? evaluation.workRefs : null,
            reward: counted ? evaluation.reward : null,
            issuanceStatus: issuanceStatusFor(outcome, evaluation.reward),
            issuance: null,
            validatedAt: now
          };
          const writes = [insert('validations', validationId, record)];
          if (counted) {
            for (const unit of units) writes.push(insert('claims', unit.id, { kind: unit.kind, key: unit.key, validationId, offerId, recordedAt: now }));
            pins.forEach((pin, index) => {
              if (!pinned[index]) writes.push(insert('claims', pin.id, { kind: pin.kind, key: pin.key, value: pin.value, validationId, offerId, recordedAt: now }));
            });
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
      if (validation.outcome === 'voided') return issuanceResult(validation);
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
  clock = defaultClock, createId = defaultCreateId, random = defaultRandom
} = {}) {
  let ledger = null;
  const issuanceAuthority = createRewardIssuanceAuthority({
    backend, policy: issuancePolicy, rewardPolicy, readSolvency: () => ledger.getSolvencySnapshot(),
    readAdmittedCapacity, otherProvenance, clock, createId
  });
  ledger = createLedger({ issuanceAuthority });
  const rewards = createRewardStore({ backend, ledger, policy: rewardPolicy, identity, clock, createId, random });
  return { ledger, rewards, issuanceAuthority };
}

export default createRewardStore;
