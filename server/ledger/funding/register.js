/**
 * @fileoverview Funding-commitment register: one record per external funding
 * commitment and the allocations its named uses draw against it.
 *
 * A commitment states its funder, external reference, total in credit units
 * or a currency's minor units, and validity. Reward funding reservations and
 * Community Access pools allocate from it instead of recording commitments of
 * their own. Each allocation commits in one ledger transaction with the
 * commitment's running total, so concurrent allocations never exceed it, and
 * the external reference is claimed once. Closing an allocation (release, or
 * expiry after the commitment's validity) returns its unused part. A
 * Community Access allocation is consumed only by the pool issuance that
 * names it, inside that issuance transaction. Status derives from validity at
 * read time, so it is never stale.
 */

import {
  assertId,
  canonicalJson,
  fail,
  hashCanonical,
  isIsoTime,
  isNonEmptyString,
  sha256Hex,
  toMs
} from '../domain.js';

export const COMMITMENT_SCHEMA = 'reploid.funding-commitment/v1';
export const ALLOCATION_SCHEMA = 'reploid.funding-allocation/v1';

// Funder kinds across uses; each use names the kinds it accepts when it allocates.
export const FUNDING_FUNDER_KINDS = Object.freeze(['operator', 'community', 'donor']);
export const FUNDING_USES = Object.freeze(['reward_funding', 'community_access_pool']);
export const POOL_USE = 'community_access_pool';
export const ALLOCATION_CLOSURES = Object.freeze(['released', 'expired']);
// Register refusals that are final for the use record that asked.
export const FUNDING_REFUSAL_CODES = Object.freeze([
  'commitment_not_found', 'commitment_not_yet_valid', 'commitment_expired', 'funder_kind_not_accepted',
  'allocation_exceeds_commitment', 'allocation_exists', 'invalid_input'
]);

const CURRENCY_CODE = /^[A-Z]{3}$/;
const insert = (collection, id, value) => ({ create: true, collection, id, value });
const put = (collection, id, value) => ({ create: false, collection, id, value });
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const assertKnownKeys = (input, allowed, operation) => {
  const unknown = Object.keys(input || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) fail('invalid_input', `${operation} does not accept: ${unknown.join(', ')}`, { unknown });
};

const readRequired = async (tx, collection, id, code) => {
  const record = await tx.get(collection, id);
  if (!record) fail(code, `${collection} record ${id} was not found`, { id });
  return record;
};

export const allocationIdFor = (use, useRef) => `alloc_${sha256Hex(`${use}\u0000${useRef}`).slice(0, 32)}`;

export function commitmentStatus(commitment, now) {
  if (toMs(now) < toMs(commitment.validFrom)) return 'pending';
  return toMs(now) < toMs(commitment.validUntil) ? 'active' : 'expired';
}

export const commitmentView = (commitment, now) => ({
  ...commitment, status: commitmentStatus(commitment, now), unallocated: commitment.amount - commitment.allocated
});

const unitKey = (unit) => canonicalJson(unit);

/** A credit-unit commitment binds the ledger's unit; a currency commitment states amounts in minor units. */
function validateCommitment(input, { unitName, now }) {
  const errors = [];
  const { commitmentId, funderKind, funderId, externalRef, amount, unit, validFrom, validUntil } = input;
  if (!FUNDING_FUNDER_KINDS.includes(funderKind)) errors.push(`funderKind must be one of ${FUNDING_FUNDER_KINDS.join(', ')}`);
  if (!isNonEmptyString(funderId)) errors.push('funderId is required');
  if (!isNonEmptyString(externalRef) || externalRef.length > 512) errors.push('externalRef must name the external commitment (at most 512 characters)');
  if (!isPositiveInteger(amount)) errors.push('amount must be a positive integer in the commitment unit');
  if (unit?.kind === 'credits' && Object.keys(unit).length !== 1) errors.push('a credit-unit commitment is { kind: "credits" }');
  if (unit?.kind === 'currency' && (Object.keys(unit).length !== 2 || !CURRENCY_CODE.test(unit.currency ?? ''))) {
    errors.push('a currency commitment is { kind: "currency", currency } with an ISO 4217 code');
  }
  if (!['credits', 'currency'].includes(unit?.kind)) errors.push('unit.kind must be credits or currency');
  if (!isIsoTime(validFrom) || !isIsoTime(validUntil) || toMs(validUntil) <= toMs(validFrom)) {
    errors.push('validity must state ISO validFrom before validUntil');
  } else if (toMs(validUntil) <= toMs(now)) {
    errors.push('validUntil must be in the future');
  }
  if (errors.length) fail('invalid_commitment', 'funding commitment is incomplete', { errors });
  return {
    commitmentId,
    funderKind,
    funderId,
    externalRef,
    unit: unit.kind === 'credits' ? { kind: 'credits', name: unitName } : { kind: 'currency', currency: unit.currency },
    amount,
    validFrom,
    validUntil
  };
}

// The unused share of an allocation, in commitment units; never more than proportional.
const returnedAmountFor = (allocation, returnedCredits) => (returnedCredits === allocation.credits
  ? allocation.amount
  : Number((BigInt(allocation.amount) * BigInt(returnedCredits)) / BigInt(allocation.credits)));

/**
 * Register operations for the ledger store, over its backend and its
 * idempotent `mutate`. `claimId(kind, key)` names uniqueness claims.
 */
export function createFundingRegisterOperations({ backend, policy, clock, mutate, claimId }) {
  return {
    /** Record one external commitment; its external reference can be recorded only once. */
    async recordFundingCommitment(input = {}) {
      const fields = ['commitmentId', 'funderKind', 'funderId', 'externalRef', 'amount', 'unit', 'validFrom', 'validUntil'];
      assertKnownKeys(input, [...fields, 'idempotencyKey'], 'recordFundingCommitment');
      const { idempotencyKey, ...request } = input;
      assertId(request.commitmentId, 'commitmentId');
      const now = clock();
      const commitment = validateCommitment(request, { unitName: policy.unit.name, now });
      const refClaimId = claimId('funding_commitment_ref', commitment.externalRef);
      return mutate({
        operation: 'recordFundingCommitment', scopeId: commitment.commitmentId, idempotencyKey, request, now,
        body: async (tx) => {
          const existing = await tx.get('commitments', commitment.commitmentId);
          const claim = await tx.get('claims', refClaimId);
          if (existing) fail('commitment_exists', 'commitment id is already in use', { commitmentId: commitment.commitmentId });
          if (claim) {
            fail('duplicate_commitment_reference', 'this external funding reference is already recorded', { commitmentId: claim.commitmentId });
          }
          const record = { schema: COMMITMENT_SCHEMA, ...commitment, allocated: 0, returned: 0, allocations: 0, recordedAt: now, updatedAt: now };
          return {
            result: commitmentView(record, now),
            writes: [
              insert('claims', refClaimId, { kind: 'funding_commitment_ref', key: commitment.externalRef, commitmentId: commitment.commitmentId, recordedAt: now }),
              insert('commitments', commitment.commitmentId, record)
            ]
          };
        }
      });
    },

    async getFundingCommitment(commitmentId) {
      const record = await backend.get('commitments', commitmentId);
      return record ? commitmentView(record, clock()) : null;
    },

    /**
     * Draw one allocation for a named use within the commitment's validity.
     * The check against the commitment's remaining total and both writes share
     * one transaction. One allocation per use record: a repeat converges.
     */
    async allocateFunding(input = {}) {
      assertKnownKeys(input, ['commitmentId', 'use', 'useRef', 'credits', 'amount', 'accountId', 'funderKinds', 'idempotencyKey'], 'allocateFunding');
      const { idempotencyKey, funderKinds, ...request } = input;
      assertId(request.commitmentId, 'commitmentId');
      if (!FUNDING_USES.includes(request.use)) fail('invalid_input', `use must be one of ${FUNDING_USES.join(', ')}`);
      assertId(request.useRef, 'useRef');
      if (!isPositiveInteger(request.credits)) fail('invalid_input', 'credits must be a positive integer');
      if (request.amount !== undefined && !isPositiveInteger(request.amount)) fail('invalid_input', 'amount must be a positive integer in the commitment unit');
      if (request.use === POOL_USE) assertId(request.accountId, 'accountId');
      else if (request.accountId !== undefined) fail('invalid_input', 'accountId names the pool account of a Community Access allocation only');
      if (!Array.isArray(funderKinds) || funderKinds.length === 0 || funderKinds.some((kind) => !FUNDING_FUNDER_KINDS.includes(kind))) {
        fail('invalid_input', `funderKinds must list the funder kinds this use accepts, from ${FUNDING_FUNDER_KINDS.join(', ')}`);
      }
      const allocationId = allocationIdFor(request.use, request.useRef);
      const requestHash = hashCanonical(request);
      const now = clock();
      return mutate({
        operation: 'allocateFunding', scopeId: allocationId, idempotencyKey, request: { ...request, funderKinds }, now,
        body: async (tx) => {
          const existing = await tx.get('allocations', allocationId);
          const commitment = await tx.get('commitments', request.commitmentId);
          if (existing) {
            if (existing.requestHash !== requestHash) fail('allocation_exists', 'this use record already holds a different allocation', { allocationId });
            return { result: existing, writes: [] };
          }
          if (!commitment) fail('commitment_not_found', `commitment ${request.commitmentId} was not found`, { commitmentId: request.commitmentId });
          const status = commitmentStatus(commitment, now);
          if (status === 'pending') fail('commitment_not_yet_valid', 'commitment validity has not started', { validFrom: commitment.validFrom });
          if (status === 'expired') fail('commitment_expired', 'commitment validity has ended', { validUntil: commitment.validUntil });
          if (!funderKinds.includes(commitment.funderKind)) {
            fail('funder_kind_not_accepted', `${request.use} does not accept ${commitment.funderKind} funding`, { funderKind: commitment.funderKind, accepted: funderKinds });
          }
          const credited = commitment.unit.kind === 'credits';
          if (credited && request.amount !== undefined && request.amount !== request.credits) {
            fail('invalid_input', 'a credit-unit commitment draws exactly the credits allocated');
          }
          if (!credited && request.amount === undefined) {
            fail('invalid_input', 'a currency commitment needs the amount drawn, in its minor units, stated with the credits');
          }
          const amount = credited ? request.credits : request.amount;
          const remaining = commitment.amount - commitment.allocated;
          if (amount > remaining) {
            fail('allocation_exceeds_commitment', 'allocations would exceed the commitment', {
              commitmentId: commitment.commitmentId, committed: commitment.amount, allocated: commitment.allocated, requested: amount, remaining
            });
          }
          const allocation = {
            schema: ALLOCATION_SCHEMA,
            allocationId,
            commitmentId: commitment.commitmentId,
            use: request.use,
            useRef: request.useRef,
            accountId: request.accountId ?? null,
            funderKind: commitment.funderKind,
            funderId: commitment.funderId,
            unit: commitment.unit,
            amount,
            credits: request.credits,
            validUntil: commitment.validUntil,
            requestHash,
            status: 'active',
            consumedCredits: null,
            returnedCredits: 0,
            returnedAmount: 0,
            lotId: null,
            allocatedAt: now,
            closedAt: null
          };
          return {
            result: allocation,
            writes: [
              insert('allocations', allocationId, allocation),
              put('commitments', commitment.commitmentId, {
                ...commitment, allocated: commitment.allocated + amount, allocations: commitment.allocations + 1, updatedAt: now
              })
            ]
          };
        }
      });
    },

    /**
     * Close an active allocation, returning what its use did not consume.
     * The use owner states the consumed credits; Community Access allocations
     * are consumed only by issuance, so they close here with nothing consumed.
     * `expired` needs the commitment's validity to have ended.
     */
    async releaseFundingAllocation(input = {}) {
      assertKnownKeys(input, ['allocationId', 'consumedCredits', 'closure', 'idempotencyKey'], 'releaseFundingAllocation');
      const { allocationId, consumedCredits, closure, idempotencyKey } = input;
      assertId(allocationId, 'allocationId');
      if (!ALLOCATION_CLOSURES.includes(closure)) fail('invalid_input', `closure must be one of ${ALLOCATION_CLOSURES.join(', ')}`);
      if (!Number.isSafeInteger(consumedCredits) || consumedCredits < 0) fail('invalid_input', 'consumedCredits must be a non-negative integer');
      const request = { allocationId, consumedCredits, closure };
      const now = clock();
      return mutate({
        operation: 'releaseFundingAllocation', scopeId: allocationId, idempotencyKey, request, now,
        body: async (tx) => {
          const allocation = await readRequired(tx, 'allocations', allocationId, 'allocation_not_found');
          const commitment = await readRequired(tx, 'commitments', allocation.commitmentId, 'commitment_not_found');
          if (allocation.status !== 'active') {
            if (allocation.status === closure && allocation.consumedCredits === consumedCredits) return { result: allocation, writes: [] };
            fail('allocation_closed', 'allocation is already closed', { status: allocation.status });
          }
          if (consumedCredits > allocation.credits) fail('invalid_input', 'consumedCredits exceeds the allocated credits', { credits: allocation.credits });
          if (allocation.use === POOL_USE && consumedCredits !== 0) {
            fail('invalid_input', 'a pool allocation is consumed only by the issuance that names it');
          }
          if (closure === 'expired' && commitmentStatus(commitment, now) !== 'expired') {
            fail('commitment_not_expired', 'commitment validity has not ended', { validUntil: commitment.validUntil });
          }
          const returnedCredits = allocation.credits - consumedCredits;
          const returnedAmount = returnedAmountFor(allocation, returnedCredits);
          const closed = { ...allocation, status: closure, consumedCredits, returnedCredits, returnedAmount, closedAt: now };
          return {
            result: closed,
            writes: [
              put('allocations', allocationId, closed),
              put('commitments', commitment.commitmentId, {
                ...commitment, allocated: commitment.allocated - returnedAmount, returned: commitment.returned + returnedAmount, updatedAt: now
              })
            ]
          };
        }
      });
    },

    async getFundingAllocation(allocationId) {
      return backend.get('allocations', allocationId);
    },

    async listFundingAllocations({ commitmentId } = {}) {
      const allocations = commitmentId === undefined
        ? await backend.list('allocations')
        : await backend.list('allocations', { field: 'commitmentId', value: commitmentId });
      return allocations.sort((left, right) => toMs(left.allocatedAt) - toMs(right.allocatedAt) || left.allocationId.localeCompare(right.allocationId));
    }
  };
}

/**
 * Inside a Community Access issuance transaction: the active pool allocation
 * the source names, for exactly these credits, into its pool account, while
 * its commitment is valid. Returns the write that consumes it.
 */
export async function consumePoolAllocation(tx, { accountId, amount, source, lotId, now }) {
  const allocation = await tx.get('allocations', source.allocationId);
  if (!allocation || allocation.use !== POOL_USE) fail('allocation_not_found', 'issuance names no Community Access pool allocation', { allocationId: source.allocationId });
  if (allocation.status !== 'active') fail('allocation_not_active', 'the pool allocation is already closed', { status: allocation.status });
  const matches = allocation.commitmentId === source.commitmentId
    && allocation.useRef === source.fundingId
    && allocation.accountId === accountId
    && allocation.credits === amount
    && allocation.funderKind === source.funderKind
    && allocation.funderId === source.funderId;
  if (!matches) fail('allocation_mismatch', 'issuance differs from its pool allocation', { allocationId: allocation.allocationId });
  if (toMs(now) >= toMs(allocation.validUntil)) fail('commitment_expired', 'commitment validity ended before issuance', { validUntil: allocation.validUntil });
  return put('allocations', allocation.allocationId, { ...allocation, status: 'consumed', consumedCredits: allocation.credits, lotId, closedAt: now });
}

/**
 * Solvency view of the register. Per commitment unit: committed totals,
 * allocations by use net of returns, and unallocated funding that is
 * available, not yet valid or lapsed. In credits: allocations by use, where
 * Community Access pool credits equal issued `community_access` credit (the
 * subsidy block's consumption is drawn from them) and reward funding bounds
 * subsidized reward issuance.
 */
export function summarizeFunding({ commitments, allocations, now }) {
  const byUse = () => Object.fromEntries(FUNDING_USES.map((use) => [use, 0]));
  const units = new Map();
  const entryFor = (unit) => {
    const key = unitKey(unit);
    if (!units.has(key)) {
      units.set(key, {
        unit,
        committed: { total: 0, byFunderKind: Object.fromEntries(FUNDING_FUNDER_KINDS.map((kind) => [kind, 0])) },
        allocated: { total: 0, byUse: byUse() },
        returned: 0,
        unallocated: { available: 0, notYetValid: 0, lapsed: 0 }
      });
    }
    return units.get(key);
  };
  const statuses = { pending: 0, active: 0, expired: 0 };
  const field = { active: 'available', pending: 'notYetValid', expired: 'lapsed' };
  for (const commitment of commitments) {
    const status = commitmentStatus(commitment, now);
    const entry = entryFor(commitment.unit);
    statuses[status] += 1;
    entry.committed.total += commitment.amount;
    entry.committed.byFunderKind[commitment.funderKind] += commitment.amount;
    entry.returned += commitment.returned;
    entry.unallocated[field[status]] += commitment.amount - commitment.allocated;
  }
  const credits = { total: 0, byUse: byUse() };
  const allocationStatuses = { active: 0, consumed: 0, released: 0, expired: 0 };
  for (const allocation of allocations) {
    const entry = entryFor(allocation.unit);
    const net = allocation.amount - allocation.returnedAmount;
    entry.allocated.total += net;
    entry.allocated.byUse[allocation.use] += net;
    credits.total += allocation.credits - allocation.returnedCredits;
    credits.byUse[allocation.use] += allocation.credits - allocation.returnedCredits;
    allocationStatuses[allocation.status] += 1;
  }
  return {
    commitments: { count: commitments.length, ...statuses },
    allocations: { count: allocations.length, ...allocationStatuses },
    byUnit: [...units.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, entry]) => entry),
    creditsAllocated: credits
  };
}

export default {
  FUNDING_FUNDER_KINDS,
  FUNDING_USES,
  FUNDING_REFUSAL_CODES,
  createFundingRegisterOperations,
  consumePoolAllocation,
  summarizeFunding
};
