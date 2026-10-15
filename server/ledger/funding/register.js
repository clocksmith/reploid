/**
 * @fileoverview Funding-commitment register: one record per external funding
 * commitment and the allocations its named uses draw against it.
 *
 * A commitment states its funder, external reference, total in credit units
 * or a currency's minor units, and validity. Reward funding reservations,
 * Community Access pools and donated credit allocate from it instead of
 * recording commitments of their own. Each allocation commits in one ledger
 * transaction with the commitment's running total, so concurrent allocations
 * never exceed it, and the external reference is claimed once.
 *
 * Every lot of those provenances draws its allocation inside the issuance
 * transaction, so the ledger itself counts what each allocation issued.
 * Community Access and donated allocations issue whole, once. Reward funding
 * issues subsidized lots up to its credits. Closing an allocation (release,
 * or expiry after the commitment's validity) returns the unconsumed share;
 * the consumed figure a use reports can never fall below what the ledger
 * issued, and later issuance can never exceed it. Every allocation and every
 * release names an authority and decision; who may hold that authority is
 * decided outside the register, by the owning use's funding-authority port
 * (the ledger's own port for donated credit, which no other component owns).
 * Status derives from validity at read time. A currency commitment's
 * allocation converts its minor units to credits under the conversion record
 * in effect and stamps it. Funders use the ledger's one FUNDER_KINDS vocabulary.
 */

import { CONVERSION_REFUSAL_CODES, conversionStamp, convertMinorUnits } from '../conversion/records.js';
import {
  FUNDER_KINDS,
  assertId,
  canonicalJson,
  cloneJson,
  fail,
  hashCanonical,
  isIsoTime,
  isNonEmptyString,
  lotFunder,
  sha256Hex,
  toMs
} from '../domain.js';

export { FUNDER_KINDS };
export const COMMITMENT_SCHEMA = 'reploid.funding-commitment/v1';
// v2 adds `conversion`: the stamped record a currency allocation converted under (null for credits).
export const ALLOCATION_SCHEMA = 'reploid.funding-allocation/v2';
/**
 * How each use's credit reaches the ledger. `whole` uses issue one lot of the
 * whole allocation into its named account; reward funding issues subsidized
 * lots against it. `ref` is the source field naming the use record.
 * `ledgerDecided` uses have no owning component, so the ledger's
 * funding-authority port decides their allocations and releases; rewards and
 * Community Access ask their own ports before allocating.
 */
const USE_RULES = Object.freeze({
  reward_funding: Object.freeze({ provenance: 'subsidized', whole: false, ref: 'fundingId', ledgerDecided: false }),
  community_access_pool: Object.freeze({ provenance: 'community_access', whole: true, ref: 'fundingId', ledgerDecided: false }),
  donated_credit: Object.freeze({ provenance: 'donated', whole: true, ref: 'donationId', ledgerDecided: true })
});
export const FUNDING_USES = Object.freeze(Object.keys(USE_RULES));
// Lot provenance -> the register use its issuance draws on.
export const ALLOCATED_PROVENANCE = Object.freeze(Object.fromEntries(Object.entries(USE_RULES).map(([use, rule]) => [rule.provenance, use])));
export const ALLOCATION_CLOSURES = Object.freeze(['released', 'expired']);
// Register refusals that are final for the use record that asked.
export const FUNDING_REFUSAL_CODES = Object.freeze([
  'commitment_not_found', 'commitment_not_yet_valid', 'commitment_expired', 'funder_kind_not_accepted',
  'allocation_exceeds_commitment', 'allocation_exists', 'invalid_input', ...CONVERSION_REFUSAL_CODES
]);
// Uses whose allocations the register itself expires; the others expire through their owning component.
export const REGISTER_EXPIRED_USES = Object.freeze(Object.keys(USE_RULES).filter((use) => USE_RULES[use].ledgerDecided));

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

/**
 * A named authority and its decision. The register records it; which actors
 * hold funding authority is a policy decided outside the ledger.
 */
const readAuthority = (authority, { required, what }) => {
  if (authority === undefined || authority === null) {
    if (required) fail('funding_authority_required', `${what} needs authority.actorId and authority.decisionId`);
    return null;
  }
  const keys = typeof authority === 'object' ? Object.keys(authority) : [];
  if (keys.some((key) => !['actorId', 'decisionId'].includes(key))
    || !isNonEmptyString(authority.actorId) || !isNonEmptyString(authority.decisionId)) {
    fail('invalid_input', 'authority must be { actorId, decisionId } naming the deciding authority and its decision');
  }
  return { actorId: authority.actorId, decisionId: authority.decisionId };
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
  if (!FUNDER_KINDS.includes(funderKind)) errors.push(`funderKind must be one of ${FUNDER_KINDS.join(', ')}`);
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
 * `fundingAuthority(request) -> { allowed, reason? }` decides allocations and
 * releases of ledger-decided uses; without it they fail closed.
 * `conversionInEffect(currency, at)` finds the conversion record in effect.
 */
export function createFundingRegisterOperations({ backend, policy, clock, mutate, claimId, conversionInEffect, fundingAuthority = null }) {
  const decide = async (request) => {
    if (typeof fundingAuthority !== 'function') {
      fail('funding_authority_required', `${request.use} allocations and releases need the ledger's funding-authority decision port`);
    }
    const decision = await fundingAuthority(cloneJson(request));
    if (decision?.allowed !== true) {
      fail('funding_not_authorized', 'the funding authority did not allow this decision', { reason: decision?.reason ?? null });
    }
  };

  const operations = {
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
     * Every allocation names the authority and decision behind it.
     */
    async allocateFunding(input = {}) {
      assertKnownKeys(input, ['commitmentId', 'use', 'useRef', 'credits', 'amount', 'accountId', 'authority', 'funderKinds', 'idempotencyKey'], 'allocateFunding');
      const { idempotencyKey, funderKinds, authority: suppliedAuthority, ...fields } = input;
      assertId(fields.commitmentId, 'commitmentId');
      if (!FUNDING_USES.includes(fields.use)) fail('invalid_input', `use must be one of ${FUNDING_USES.join(', ')}`);
      const rule = USE_RULES[fields.use];
      assertId(fields.useRef, 'useRef');
      if (!isPositiveInteger(fields.credits)) fail('invalid_input', 'credits must be a positive integer');
      if (fields.amount !== undefined && !isPositiveInteger(fields.amount)) fail('invalid_input', 'amount must be a positive integer in the commitment unit');
      if (rule.whole) assertId(fields.accountId, 'accountId');
      else if (fields.accountId !== undefined) fail('invalid_input', 'accountId names the issuance account of a whole-issuance allocation only');
      if (!Array.isArray(funderKinds) || funderKinds.length === 0 || funderKinds.some((kind) => !FUNDER_KINDS.includes(kind))) {
        fail('invalid_input', `funderKinds must list the funder kinds this use accepts, from ${FUNDER_KINDS.join(', ')}`);
      }
      const authority = readAuthority(suppliedAuthority, { required: true, what: `a ${fields.use} allocation` });
      const request = { ...fields, authority };
      if (rule.ledgerDecided) {
        await decide({
          action: 'allocate', use: request.use, useRef: request.useRef, commitmentId: request.commitmentId,
          credits: request.credits, amount: request.amount ?? null, accountId: request.accountId ?? null, authority
        });
      }
      const allocationId = allocationIdFor(request.use, request.useRef);
      const requestHash = hashCanonical(request);
      const now = clock();
      // A commitment's unit never changes; a currency commitment converts under the record in effect now.
      const target = await backend.get('commitments', request.commitmentId);
      const conversion = target?.unit?.kind === 'currency' ? await conversionInEffect(target.unit.currency, now) : null;
      return mutate({
        operation: 'allocateFunding', scopeId: allocationId, idempotencyKey, request: { ...request, funderKinds }, now,
        body: async (tx) => {
          const existing = await tx.get('allocations', allocationId);
          const commitment = await tx.get('commitments', request.commitmentId);
          const record = conversion ? await tx.get('conversions', conversion.conversionId) : null;
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
          if (!credited) {
            if (!record) fail('conversion_unavailable', `no ${commitment.unit.currency} conversion is in effect`, { currency: commitment.unit.currency });
            const expected = convertMinorUnits(record, amount);
            if (expected !== request.credits) {
              fail('conversion_mismatch', `${amount} ${commitment.unit.currency} minor units convert to ${expected} credits under ${record.conversionId}`, {
                conversionId: record.conversionId, expected, credits: request.credits
              });
            }
          }
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
            conversion: credited ? null : conversionStamp(record),
            validUntil: commitment.validUntil,
            requestHash,
            authority,
            status: 'active',
            // Counted by the ledger in each issuance transaction that draws on this allocation.
            issuedCredits: 0,
            consumedCredits: null,
            returnedCredits: 0,
            returnedAmount: 0,
            releaseAuthority: null,
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
     * The use states the credits it consumed, checked against the ledger's
     * own count: never below what the allocation already issued, and after
     * closing the ledger issues no more than that figure against it. A whole
     * allocation still active has issued nothing, so it closes with nothing
     * consumed. `released` names an authority and decision; `expired` needs
     * the commitment's validity to have ended instead.
     */
    async releaseFundingAllocation(input = {}) {
      assertKnownKeys(input, ['allocationId', 'consumedCredits', 'closure', 'authority', 'idempotencyKey'], 'releaseFundingAllocation');
      const { allocationId, consumedCredits, closure, idempotencyKey } = input;
      assertId(allocationId, 'allocationId');
      if (!ALLOCATION_CLOSURES.includes(closure)) fail('invalid_input', `closure must be one of ${ALLOCATION_CLOSURES.join(', ')}`);
      if (!Number.isSafeInteger(consumedCredits) || consumedCredits < 0) fail('invalid_input', 'consumedCredits must be a non-negative integer');
      if (closure === 'expired' && input.authority !== undefined) fail('invalid_input', 'expiry follows the commitment\'s validity; it names no authority');
      const authority = readAuthority(input.authority, { required: closure === 'released', what: 'a release' });
      const request = { allocationId, consumedCredits, closure, ...(authority ? { authority } : {}) };
      const target = authority ? await backend.get('allocations', allocationId) : null;
      if (target && USE_RULES[target.use]?.ledgerDecided) {
        await decide({ action: 'release', use: target.use, useRef: target.useRef, allocationId, consumedCredits, authority });
      }
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
          if (consumedCredits < allocation.issuedCredits) {
            fail('consumed_below_issued', 'the ledger already issued more against this allocation than the reported consumption', {
              issuedCredits: allocation.issuedCredits, consumedCredits
            });
          }
          if (USE_RULES[allocation.use].whole && consumedCredits !== allocation.issuedCredits) {
            fail('invalid_input', 'a whole-issuance allocation is consumed only by the issuance that names it');
          }
          if (closure === 'expired' && commitmentStatus(commitment, now) !== 'expired') {
            fail('commitment_not_expired', 'commitment validity has not ended', { validUntil: commitment.validUntil });
          }
          const returnedCredits = allocation.credits - consumedCredits;
          const returnedAmount = returnedAmountFor(allocation, returnedCredits);
          const closed = {
            ...allocation, status: closure, consumedCredits, returnedCredits, returnedAmount, releaseAuthority: authority, closedAt: now
          };
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
    },

    /**
     * Expire active allocations of ledger-decided uses (donated credit) whose
     * commitment validity ended, returning what they never issued. Other uses
     * expire through their owning component, which keeps its own record in
     * step. Nothing issued is touched; a repeat converges.
     */
    async expireAllocations({ limit = 100 } = {}) {
      if (!Number.isSafeInteger(limit) || limit <= 0) fail('invalid_input', 'limit must be a positive integer');
      const now = clock();
      const due = (await backend.list('allocations', { field: 'status', value: 'active' }))
        .filter((allocation) => REGISTER_EXPIRED_USES.includes(allocation.use) && toMs(now) >= toMs(allocation.validUntil))
        .sort((left, right) => toMs(left.validUntil) - toMs(right.validUntil) || left.allocationId.localeCompare(right.allocationId))
        .slice(0, limit);
      const results = [];
      for (const { allocationId, issuedCredits } of due) {
        try {
          const closed = await operations.releaseFundingAllocation({
            allocationId, consumedCredits: issuedCredits, closure: 'expired', idempotencyKey: `register-expiry:${allocationId}`
          });
          results.push({ allocationId, status: closed.status, returnedCredits: closed.returnedCredits });
        } catch (error) {
          results.push({ allocationId, status: 'active', code: error?.code ?? 'expiry_failed' });
        }
      }
      return results;
    }
  };
  return operations;
}


/**
 * Inside the issuance transaction of a lot whose provenance draws on the
 * register: the allocation its source names, for the same commitment, use
 * record and funder. A whole allocation issues once, for exactly its credits,
 * into its account, while its commitment is valid. Reward funding issues
 * subsidized lots up to its credits, and after closing up to the credits its
 * use reported consumed; allowances authorized before expiry may still issue.
 * Returns the allocation write, or null for provenance outside the register.
 */
export async function drawIssuanceAllocation(tx, { provenance, accountId, amount, source, lotId, now }) {
  const use = ALLOCATED_PROVENANCE[provenance];
  if (!use) return null;
  const rule = USE_RULES[use];
  const allocation = await tx.get('allocations', source.allocationId);
  if (!allocation || allocation.use !== use) fail('allocation_not_found', `issuance names no ${use} allocation`, { allocationId: source.allocationId });
  const funder = lotFunder({ provenance, source });
  const matches = allocation.commitmentId === source.commitmentId
    && allocation.useRef === source[rule.ref]
    && allocation.funderId === funder.funderId
    && allocation.funderKind === funder.funderKind
    && (!rule.whole || (allocation.accountId === accountId && allocation.credits === amount));
  if (!matches) fail('allocation_mismatch', 'issuance differs from the allocation it names', { allocationId: allocation.allocationId });
  if (rule.whole) {
    if (allocation.status !== 'active') fail('allocation_not_active', 'the allocation is already closed', { status: allocation.status });
    if (toMs(now) >= toMs(allocation.validUntil)) fail('commitment_expired', 'commitment validity ended before issuance', { validUntil: allocation.validUntil });
    return put('allocations', allocation.allocationId, {
      ...allocation, status: 'consumed', issuedCredits: amount, consumedCredits: amount, lotId, closedAt: now
    });
  }
  const limit = allocation.status === 'active' ? allocation.credits : allocation.consumedCredits;
  if (allocation.issuedCredits + amount > limit) {
    fail('allocation_exhausted', 'issuance would exceed what this allocation may still issue', {
      allocationId: allocation.allocationId, status: allocation.status, issuedCredits: allocation.issuedCredits, limit, requested: amount
    });
  }
  return put('allocations', allocation.allocationId, { ...allocation, issuedCredits: allocation.issuedCredits + amount });
}

/**
 * Solvency view of the register. Per commitment unit: committed totals,
 * allocations by use net of returns, and unallocated funding that is
 * available, not yet valid or lapsed. In credits, by use and by funder kind:
 * allocations, and what the ledger issued against them, which equals issued
 * `subsidized`, `community_access` and `donated` credit (the subsidy block's
 * Community Access consumption and subsidized issuance are drawn from them).
 */
export function summarizeFunding({ commitments, allocations, now }) {
  const byUse = () => Object.fromEntries(FUNDING_USES.map((use) => [use, 0]));
  const byFunderKind = () => Object.fromEntries(FUNDER_KINDS.map((kind) => [kind, 0]));
  const units = new Map();
  const entryFor = (unit) => {
    const key = unitKey(unit);
    if (!units.has(key)) {
      units.set(key, {
        unit,
        committed: { total: 0, byFunderKind: byFunderKind() },
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
  const credits = { total: 0, byUse: byUse(), byFunderKind: byFunderKind() };
  const issued = { total: 0, byUse: byUse(), byFunderKind: byFunderKind() };
  const allocationStatuses = { active: 0, consumed: 0, released: 0, expired: 0 };
  for (const allocation of allocations) {
    const entry = entryFor(allocation.unit);
    const net = allocation.amount - allocation.returnedAmount;
    entry.allocated.total += net;
    entry.allocated.byUse[allocation.use] += net;
    const netCredits = allocation.credits - allocation.returnedCredits;
    credits.total += netCredits;
    credits.byUse[allocation.use] += netCredits;
    credits.byFunderKind[allocation.funderKind] += netCredits;
    issued.total += allocation.issuedCredits;
    issued.byUse[allocation.use] += allocation.issuedCredits;
    issued.byFunderKind[allocation.funderKind] += allocation.issuedCredits;
    allocationStatuses[allocation.status] += 1;
  }
  return {
    commitments: { count: commitments.length, ...statuses },
    allocations: { count: allocations.length, ...allocationStatuses },
    byUnit: [...units.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, entry]) => entry),
    creditsAllocated: credits,
    creditsIssued: issued
  };
}

export default {
  FUNDER_KINDS,
  FUNDING_USES,
  FUNDING_REFUSAL_CODES,
  createFundingRegisterOperations,
  drawIssuanceAllocation,
  summarizeFunding
};
