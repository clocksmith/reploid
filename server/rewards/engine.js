import { createKnownKeyValidator } from '../input-validation.js';
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
import { FUNDING_REFUSAL_CODES } from '../ledger/funding/register.js';
import { assertLedgerStoreContract } from '../ledger/store-contract.js';
import { nativeOwnerPolicyDigest, validateNativeOwnerPolicy } from '../native-owner/policy.js';
import { createChallengeOperations } from './challenges.js';
import { createDeliveryEvidenceOperations } from './delivery-evidence.js';
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
  FUNDING_SCHEMA,
  REWARD_FUNDER_KINDS,
  FUNDING_USE,
  OFFER_INPUT_KEYS,
  REWARD_CATEGORIES,
  VALIDATION_SCHEMA,
  assertRewardCategory,
  buildOffer,
  fail,
  fundingAuthorityProblems,
  validateFundingReservation,
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

const assertKnownKeys = createKnownKeyValidator(fail);

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

// Every lot names its validated work, its issuance basis and the category's own references.
const ledgerSource = (validation, allowance) => ({
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
  basis: allowance.basis,
  decisionId: allowance.decisionId,
  ...(allowance.funding ? {
    fundingId: allowance.funding.fundingId,
    funderKind: allowance.funding.funderKind,
    funderId: allowance.funding.funderId,
    commitmentId: allowance.funding.commitmentId,
    allocationId: allowance.funding.allocationId
  } : {}),
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
  decisionId: validation.issuance?.decisionId ?? null,
  basis: validation.issuance?.basis ?? null,
  provenance: validation.issuance?.provenance ?? null
});

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend (see stores.js)
 * @param {object} options.ledger credit ledger store whose issuanceAuthority is this component's authority
 * @param {object} options.policy explicit reward policy; there is no default
 * @param {object} options.identity authenticated identity port:
 *   participantAccount(participantId) -> accountId | null,
 *   accountLinks(accountA, accountB) -> [{ kind, evidenceId }], and, for
 *   delivery and storage, verifyCustodyKey({ certificate, at }) ->
 *   { participantId, custodyPeerId, publicKey } | null, which attributes a
 *   per-process custody key and its grant peer id to a persistent participant
 *   only through a certificate from that participant's identity
 * @param {Function} options.issuance this component's issuance authority (its `allocate` chooses the basis)
 * @param {object} [options.readinessProber] connect/prepare/verify port for readiness execution probes
 * @param {Function} [options.fundingAuthority] funding-authority decision port:
 *   ({ action: 'reserve' | 'release', fundingId, commitmentId?, amount?, categories?,
 *   authority: { actorId, decisionId } }) -> { allowed, reason? }. Which actors hold
 *   that authority is policy outside this store; without the port, reserving and
 *   releasing funding fail closed
 * @param {Function} [options.random] random(n) -> integer in [0, n) for challenge targets
 */
export function createRewardStore({
  backend, ledger, policy, identity, issuance, readinessProber = null, fundingAuthority = null,
  clock = defaultClock, createId = defaultCreateId, random = defaultRandom
} = {}) {
  assertRewardBackend(backend);
  assertLedgerStoreContract(ledger);
  const rewardPolicy = validateRewardPolicy(policy);
  const enabled = (category) => rewardPolicy.enabledCategories.includes(category);
  if (typeof identity?.participantAccount !== 'function' || typeof identity?.accountLinks !== 'function') {
    throw new TypeError('reward store requires an identity port with participantAccount and accountLinks');
  }
  if ((enabled('verified_delivery') || enabled('contracted_storage')) && typeof identity.verifyCustodyKey !== 'function') {
    throw new TypeError('delivery and storage rewards require identity.verifyCustodyKey to accept identity-certified custody keys');
  }
  if (enabled('prepared_readiness') && !['connect', 'prepare', 'verify'].every((method) => typeof readinessProber?.[method] === 'function')) {
    throw new TypeError('readiness rewards require a readinessProber with connect, prepare and verify');
  }
  if (typeof issuance?.allocate !== 'function') throw new TypeError('reward store requires its issuance authority');
  if (fundingAuthority !== null && typeof fundingAuthority !== 'function') throw new TypeError('fundingAuthority must be a function');
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

  /** The funding-authority port must allow the named authority's decision; it fails closed. */
  const authorizeFunding = async (request) => {
    if (typeof fundingAuthority !== 'function') {
      fail('funding_authority_required', 'reserving and releasing funding need a funding-authority decision port');
    }
    const decision = await fundingAuthority(cloneJson(request));
    if (decision?.allowed !== true) {
      fail('funding_not_authorized', 'the funding authority did not allow this decision', { reason: decision?.reason ?? null });
    }
  };

  /** Move a funding record from one status to the next in one reward transaction; otherwise return it unchanged. */
  const advanceFunding = (fundingId, from, change) => backend.runTransaction(async (tx) => {
    const current = await tx.get('fundings', fundingId);
    if (!current) fail('funding_not_found', `funding ${fundingId} was not found`, { fundingId });
    if (current.status !== from) return current;
    const now = clock();
    const updated = { ...current, ...change(current, now), updatedAt: now };
    tx.set('fundings', fundingId, updated);
    return updated;
  });

  /**
   * Allocate a recorded reservation from its commitment in the ledger's
   * funding register, then activate it. A refusal is final and retained; any
   * other failure leaves it `allocating` for a retry or resumeFunding.
   */
  const completeFunding = async (fundingId) => {
    const funding = await backend.get('fundings', fundingId);
    if (funding.status === 'refused') fail(funding.refusal.code, funding.refusal.message, funding.refusal.details);
    if (funding.status !== 'allocating') return funding;
    let allocation;
    try {
      allocation = await ledger.allocateFunding({
        commitmentId: funding.commitmentId, use: FUNDING_USE, useRef: fundingId, credits: funding.amount,
        ...(funding.commitmentAmount === null ? {} : { amount: funding.commitmentAmount }),
        authority: funding.authority, funderKinds: [...REWARD_FUNDER_KINDS], idempotencyKey: `reward-funding:${fundingId}`
      });
    } catch (error) {
      if (!FUNDING_REFUSAL_CODES.includes(error?.code)) throw error;
      await advanceFunding(fundingId, 'allocating', () => ({
        status: 'refused', refusal: { code: error.code, message: error.message, details: cloneJson(error.details ?? {}) }
      }));
      throw error;
    }
    return advanceFunding(fundingId, 'allocating', (current, now) => ({
      status: 'active',
      allocationId: allocation.allocationId,
      funderKind: allocation.funderKind,
      funderId: allocation.funderId,
      unit: allocation.unit,
      validUntil: allocation.validUntil,
      activatedAt: now
    }));
  };

  /**
   * Close an active reservation: freeze what allowances already authorized
   * (no allowance draws on it afterwards), return the rest to the
   * commitment, then record the closure. The register checks that figure
   * against what the ledger issued for the allocation and caps later
   * issuance at it. A release names its authority; expiry names none. Each
   * step resumes after a crash.
   */
  const closeFunding = async (fundingId, closure, authority = null) => {
    const closing = await backend.runTransaction(async (tx) => {
      const funding = await tx.get('fundings', fundingId);
      if (!funding) fail('funding_not_found', `funding ${fundingId} was not found`, { fundingId });
      if (['closing', 'released', 'expired'].includes(funding.status)) return funding;
      if (funding.status !== 'active') fail('funding_not_active', `funding is ${funding.status}`, { status: funding.status });
      const now = clock();
      if (closure === 'expired' && toMs(now) < toMs(funding.validUntil)) {
        fail('funding_not_expired', 'the commitment behind this funding is still valid', { validUntil: funding.validUntil });
      }
      const updated = {
        ...funding, status: 'closing', closure, consumedCredits: funding.authorized,
        releaseAuthority: closure === 'released' ? authority : null, updatedAt: now
      };
      tx.set('fundings', fundingId, updated);
      return updated;
    });
    if (closing.status !== 'closing') return closing;
    const allocation = await ledger.releaseFundingAllocation({
      allocationId: closing.allocationId, consumedCredits: closing.consumedCredits, closure: closing.closure,
      ...(closing.releaseAuthority ? { authority: closing.releaseAuthority } : {}),
      idempotencyKey: `reward-funding-close:${fundingId}`
    });
    return advanceFunding(fundingId, 'closing', (current, now) => ({ status: current.closure, returned: allocation.returnedCredits, closedAt: now }));
  };

  const store = {
    kind: backend.kind,
    policy: rewardPolicy,

    ...createChallengeOperations({
      backend, ledger, identity, rewardPolicy, mutate, lookupIdempotent, readOffer, claimId, clock, createId, random, prober: readinessProber
    }),

    ...createDeliveryEvidenceOperations({ backend, identity, rewardPolicy, clock }),

    /**
     * Reserve funding of an accepted funder kind for subsidized rewards as an
     * allocation from a commitment in the ledger's funding register; the
     * commitment supplies the funder. A named authority's decision, allowed
     * by the funding-authority port, is recorded on the reservation and its
     * allocation. The reservation is an issuance budget; credit drawn from it
     * is subsidized in provenance and solvency. A replay returns the current
     * record, finishing an interrupted allocation.
     */
    async reserveFunding(input = {}) {
      const { idempotencyKey, ...request } = input;
      const funding = validateFundingReservation(request);
      assertId(funding.fundingId, 'fundingId');
      assertId(funding.commitmentId, 'commitmentId');
      assertIdempotencyKey(idempotencyKey);
      const operation = 'reserveFunding';
      const prior = await lookupIdempotent({ operation, scopeId: funding.fundingId, idempotencyKey, request });
      if (!prior) {
        const authority = { actorId: funding.authority.actorId, decisionId: funding.authority.decisionId };
        await authorizeFunding({
          action: 'reserve', fundingId: funding.fundingId, commitmentId: funding.commitmentId, amount: funding.amount, categories: funding.categories, authority
        });
        const now = clock();
        const record = {
          schema: FUNDING_SCHEMA, fundingId: funding.fundingId, commitmentId: funding.commitmentId, amount: funding.amount,
          commitmentAmount: funding.commitmentAmount ?? null, categories: funding.categories, status: 'allocating',
          authority, allocationId: null, funderKind: null, funderId: null, unit: null, validUntil: null, authorized: 0, allowances: 0,
          refusal: null, closure: null, consumedCredits: null, returned: null, releaseAuthority: null,
          reservedAt: now, activatedAt: null, closedAt: null, updatedAt: now
        };
        await mutate({
          operation, scopeId: funding.fundingId, idempotencyKey, request, now,
          body: async (tx) => {
            if (await tx.get('fundings', funding.fundingId)) fail('funding_exists', 'funding id is already in use', { fundingId: funding.fundingId });
            return { result: { fundingId: funding.fundingId, status: 'allocating' }, writes: [insert('fundings', funding.fundingId, record)] };
          }
        });
      }
      return completeFunding(funding.fundingId);
    },

    async getFunding(fundingId) {
      return backend.get('fundings', fundingId);
    },

    /**
     * Stop drawing on a reservation and return its unauthorized funding to
     * the commitment, under a named authority's decision allowed by the
     * funding-authority port and recorded on the allocation.
     */
    async releaseFunding(input = {}) {
      assertKnownKeys(input, ['fundingId', 'authority'], 'releaseFunding');
      const { fundingId } = input;
      assertId(fundingId, 'fundingId');
      const problems = fundingAuthorityProblems(input.authority, 'authority');
      if (problems.length) fail('invalid_input', 'releasing funding needs the authority and its decision', { errors: problems });
      const authority = { actorId: input.authority.actorId, decisionId: input.authority.decisionId };
      await authorizeFunding({ action: 'release', fundingId, authority });
      return closeFunding(fundingId, 'released', authority);
    },

    /**
     * Finish reservations a crash interrupted (allocating or closing) and
     * expire active ones whose commitment validity ended, returning their
     * unauthorized funding. Failures stay for the next pass.
     */
    async resumeFunding({ limit = 100 } = {}) {
      const now = clock();
      const [allocating, closing, active] = await Promise.all(['allocating', 'closing', 'active']
        .map((status) => backend.list('fundings', { field: 'status', value: status })));
      const order = (left, right) => toMs(left.reservedAt) - toMs(right.reservedAt) || left.fundingId.localeCompare(right.fundingId);
      const due = [
        ...allocating.sort(order).map((funding) => [funding.fundingId, () => completeFunding(funding.fundingId)]),
        ...closing.sort(order).map((funding) => [funding.fundingId, () => closeFunding(funding.fundingId, funding.closure, funding.releaseAuthority)]),
        ...active.filter((funding) => toMs(now) >= toMs(funding.validUntil)).sort(order)
          .map((funding) => [funding.fundingId, () => closeFunding(funding.fundingId, 'expired')])
      ].slice(0, limit);
      const results = [];
      for (const [fundingId, run] of due) {
        try {
          const record = await run();
          results.push({ fundingId, status: record.status, returned: record.returned });
        } catch (error) {
          const current = await backend.get('fundings', fundingId);
          results.push({ fundingId, status: current?.status ?? null, code: error?.code ?? 'funding_failed' });
        }
      }
      return results;
    },


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

    /** Accepted contracted-storage and prepared-readiness offers, whose obligations run on a schedule. */
    async listContracts() {
      return (await backend.list('offers', { field: 'status', value: 'accepted' }))
        .filter((offer) => REWARD_CATEGORIES[offer.category]?.contracted)
        .sort((left, right) => toMs(left.acceptedAt) - toMs(right.acceptedAt) || left.offerId.localeCompare(right.offerId));
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
      // The allowance fixes the basis, provenance and any funding before the ledger call.
      const allowance = await issuance.allocate(validationId);
      const source = ledgerSource(validation, allowance);
      let issued;
      try {
        issued = await ledger.issueCredits({
          accountId: validation.offer.accountId,
          provenance: allowance.provenance,
          amount: validation.reward.amount,
          source,
          idempotencyKey: `reward:${validationId}`
        });
      } catch (error) {
        // A lot for this work under another key counts only if it names this validation.
        const lotId = lotIdForSource(sourceClaimKey(allowance.provenance, source));
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
          issuance: {
            lotId: lot.lotId, decisionId: allowance.decisionId, limitId: lot.issuance?.limitId ?? null,
            basis: allowance.basis, provenance: allowance.provenance, fundingId: allowance.funding?.fundingId ?? null, issuedAt: now
          }
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

    /** Allowed reward credit, in total and per basis; funded_reservation is subsidy. */
    async getIssuanceState() {
      const state = await backend.get('issuance', ISSUANCE_STATE_ID);
      return {
        authorizedTotal: state?.authorizedTotal ?? 0,
        allowances: state?.allowances ?? 0,
        byBasis: { settled_demand: state?.byBasis?.settled_demand ?? 0, funded_reservation: state?.byBasis?.funded_reservation ?? 0 },
        updatedAt: state?.updatedAt ?? null
      };
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
  backend, createLedger, rewardPolicy, issuancePolicy, identity, readAdmittedCapacity, otherProvenance = null, readinessProber = null,
  fundingAuthority = null, clock = defaultClock, createId = defaultCreateId, random = defaultRandom
} = {}) {
  let ledger = null;
  const issuanceAuthority = createRewardIssuanceAuthority({
    backend, policy: issuancePolicy, rewardPolicy, readSolvency: () => ledger.getSolvencySnapshot(),
    readAdmittedCapacity, otherProvenance, clock, createId
  });
  ledger = createLedger({ issuanceAuthority });
  const rewards = createRewardStore({
    backend, ledger, policy: rewardPolicy, identity, issuance: issuanceAuthority, readinessProber, fundingAuthority, clock, createId, random
  });
  return { ledger, rewards, issuanceAuthority };
}

export default createRewardStore;
