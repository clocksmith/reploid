/**
 * @fileoverview Reward issuance authority: allocation before issuance, and the
 * ledger's `issuanceAuthority` hook.
 *
 * `allocate(validationId)` picks the first issuance basis the explicit policy
 * declares for the validation's category:
 * - `settled_demand`: earned credit within a policy share of measured net
 *   settled spending;
 * - `funded_reservation`: subsidized credit drawn from an active funding
 *   reservation of a policy-listed funder kind (a register allocation) while its
 *   commitment is valid, recorded as subsidy in provenance and solvency,
 *   never as earned demand.
 * Every basis is also bounded by fresh admitted-capacity evidence: issuing
 * credit creates no capacity. Allowances commit atomically against one
 * counter and the chosen reservation, so concurrent issuance cannot overrun a
 * limit, and a repeated allocation returns the same decision. The ledger hook
 * allows an earned or subsidized lot only when it matches such an allowance.
 */

import { randomUUID } from 'node:crypto';

import { REWARD_PROVENANCE, assertId, cloneJson, isNonEmptyString, toMs } from '../ledger/domain.js';
import {
  BASIS_PROVENANCE,
  ISSUANCE_DECISION_SCHEMA,
  ISSUANCE_STATE_SCHEMA,
  evaluateCapacity,
  evaluateDemandBasis,
  fail,
  validateIssuancePolicy,
  validateRewardPolicy
} from './domain.js';
import { assertRewardBackend } from './store-contract.js';

export const ISSUANCE_STATE_ID = 'rewards';
export const decisionIdForValidation = (validationId) => `issuance:${validationId}`;

const emptyState = () => ({
  schema: ISSUANCE_STATE_SCHEMA, authorizedTotal: 0, allowances: 0,
  byBasis: { settled_demand: 0, funded_reservation: 0 }, updatedAt: null
});

const validIdentifier = (value) => {
  try {
    assertId(value, 'validationId');
    return true;
  } catch {
    return false;
  }
};

// Why a ledger request does not match its validated work, or null.
const requestMismatch = (request, validation) => {
  const { source } = request;
  const matches = request.accountId === validation.offer.accountId
    && request.amount === validation.reward?.amount
    && source.workId === validation.workId
    && source.category === validation.ledgerCategory
    && source.offerId === validation.offer.offerId
    && source.validatorId === validation.validatorId;
  return matches ? null : 'issuance_request_mismatch';
};

/**
 * @param {object} options
 * @param {object} options.backend reward backend shared with the reward store
 * @param {object} options.policy explicit issuance policy; there is no default
 * @param {object} options.rewardPolicy the reward store's explicit reward policy
 * @param {Function} options.readSolvency () => ledger.getSolvencySnapshot()
 * @param {Function} options.readAdmittedCapacity () => admitted-capacity evidence from its execution owner
 * @param {Function} [options.otherProvenance] decision port for purchased, donated and Community Access
 *   issuance; without it those issuances are declined rather than silently allowed
 */
export function createRewardIssuanceAuthority({
  backend,
  policy,
  rewardPolicy,
  readSolvency,
  readAdmittedCapacity,
  otherProvenance = null,
  clock = () => new Date().toISOString(),
  createId = (prefix) => `${prefix}_${randomUUID()}`
} = {}) {
  assertRewardBackend(backend);
  const issuancePolicy = validateIssuancePolicy(policy);
  const activeRewardPolicy = validateRewardPolicy(rewardPolicy);
  if (typeof readSolvency !== 'function' || typeof readAdmittedCapacity !== 'function') {
    throw new TypeError('issuance authority requires readSolvency and readAdmittedCapacity ports');
  }
  const limitId = issuancePolicy.policyId;
  const read = async (port) => {
    try {
      return await port();
    } catch {
      return null;
    }
  };
  const decline = (tx, base, reason, extra = {}) => {
    const declineId = createId('idecline');
    tx.create('decisions', declineId, { ...base, ...cloneJson(extra), decisionId: declineId, allowed: false, reason });
    return { allowed: false, reason, limitId, ...cloneJson(extra) };
  };

  /** Choose a basis and commit an allowance for an accepted validation, or record why none applies. */
  async function allocate(validationId) {
    assertId(validationId, 'validationId');
    const candidate = await backend.get('validations', validationId);
    const bases = issuancePolicy.categoryBases[candidate?.category] || [];
    const fundingIds = bases.includes('funded_reservation')
      ? (await backend.list('fundings'))
        .filter((funding) => funding.categories.includes(candidate.category)
          && issuancePolicy.bases.funded_reservation.funderKinds.includes(funding.funderKind))
        .sort((left, right) => left.reservedAt.localeCompare(right.reservedAt) || left.fundingId.localeCompare(right.fundingId))
        .map((funding) => funding.fundingId)
      : [];
    const [snapshot, capacity] = await Promise.all([read(readSolvency), read(readAdmittedCapacity)]);
    const now = clock();
    const decision = await backend.runTransaction(async (tx) => {
      const existing = await tx.get('allowances', validationId);
      const validation = await tx.get('validations', validationId);
      const state = (await tx.get('issuance', ISSUANCE_STATE_ID)) ?? emptyState();
      const fundings = [];
      for (const fundingId of fundingIds) fundings.push(await tx.get('fundings', fundingId));
      if (existing) return { allowed: true, allowance: existing };
      const amount = validation?.reward?.amount;
      const base = {
        schema: ISSUANCE_DECISION_SCHEMA, limitId, accountingVersion: issuancePolicy.accountingVersion, validationId,
        accountId: validation?.offer?.accountId ?? null, category: validation?.category ?? null, amount: amount ?? null,
        workId: validation?.workId ?? null, decidedAt: now
      };
      if (!validation) return decline(tx, base, 'validation_not_found');
      if (validation.outcome !== 'accepted' || validation.issuanceStatus !== 'pending') return decline(tx, base, 'validation_not_accepted');
      if (!activeRewardPolicy.enabledCategories.includes(validation.category)) return decline(tx, base, 'reward_category_disabled');
      if (!bases.length) return decline(tx, base, 'no_issuance_basis');
      if (!snapshot) return decline(tx, base, 'solvency_unavailable');
      const capacityCheck = evaluateCapacity({ policy: issuancePolicy, snapshot, capacity, state, amount, now });
      const { figures } = capacityCheck;
      if (!capacityCheck.allowed) return decline(tx, base, capacityCheck.reason, { figures });
      const tried = [];
      let chosen = null;
      for (const basis of bases) {
        if (basis === 'settled_demand') {
          const demand = evaluateDemandBasis({ policy: issuancePolicy, snapshot, state, amount });
          Object.assign(figures, demand.figures);
          if (demand.allowed) {
            chosen = { basis, funding: null };
            break;
          }
          tried.push({ basis, reason: demand.reason });
        } else {
          // Only an active reservation inside its commitment's validity can be drawn.
          const funding = fundings.find((entry) => entry?.status === 'active' && toMs(now) < toMs(entry.validUntil)
            && entry.amount - entry.authorized >= amount);
          if (funding) {
            figures.fundingRemainingAfter = funding.amount - funding.authorized - amount;
            chosen = { basis, funding };
            break;
          }
          tried.push({ basis, reason: 'funding_exhausted' });
        }
      }
      if (!chosen) return decline(tx, base, tried[0].reason, { figures, bases: tried });
      const { basis, funding } = chosen;
      const allowance = {
        ...base,
        decisionId: decisionIdForValidation(validationId),
        allowed: true,
        reason: null,
        basis,
        provenance: BASIS_PROVENANCE[basis],
        funding: funding ? {
          fundingId: funding.fundingId, funderKind: funding.funderKind, funderId: funding.funderId,
          commitmentId: funding.commitmentId, allocationId: funding.allocationId
        } : null,
        figures: cloneJson(figures)
      };
      tx.create('allowances', validationId, allowance);
      tx.set('issuance', ISSUANCE_STATE_ID, {
        ...state,
        authorizedTotal: state.authorizedTotal + amount,
        allowances: state.allowances + 1,
        byBasis: { ...state.byBasis, [basis]: state.byBasis[basis] + amount },
        updatedAt: now
      });
      if (funding) {
        tx.set('fundings', funding.fundingId, { ...funding, authorized: funding.authorized + amount, allowances: funding.allowances + 1, updatedAt: now });
      }
      return { allowed: true, allowance };
    });
    if (!decision.allowed) {
      fail('issuance_not_authorized', 'no declared issuance basis allows this reward', {
        reason: decision.reason, bases: decision.bases ?? [], figures: decision.figures ?? {}
      });
    }
    return cloneJson(decision.allowance);
  }

  /** Ledger hook: allow an earned or subsidized lot only when it matches a committed allowance. */
  async function issuanceAuthority(request) {
    if (!REWARD_PROVENANCE.includes(request?.provenance)) {
      if (typeof otherProvenance === 'function') return otherProvenance(request);
      return { allowed: false, reason: 'provenance_not_governed' };
    }
    const validationId = request.source?.validationId;
    if (!validIdentifier(validationId)) return { allowed: false, reason: 'validation_not_found' };
    const [validation, allowance] = await Promise.all([backend.get('validations', validationId), backend.get('allowances', validationId)]);
    const reason = !validation ? 'validation_not_found'
      : validation.outcome !== 'accepted' ? 'validation_not_accepted'
        : requestMismatch(request, validation)
          || (!allowance ? 'allowance_required' : null)
          || (allowance.provenance !== request.provenance || allowance.amount !== request.amount
            || (allowance.funding?.fundingId ?? null) !== (request.source.fundingId ?? null) ? 'issuance_request_mismatch' : null);
    if (reason) {
      await backend.runTransaction(async (tx) => {
        decline(tx, {
          schema: ISSUANCE_DECISION_SCHEMA, limitId, accountingVersion: issuancePolicy.accountingVersion, validationId,
          accountId: isNonEmptyString(request.accountId) ? request.accountId : null, amount: request.amount ?? null,
          workId: isNonEmptyString(request.source?.workId) ? request.source.workId : null, decidedAt: clock()
        }, reason);
      });
      return { allowed: false, reason, limitId };
    }
    return { allowed: true, decisionId: allowance.decisionId, limitId };
  }

  issuanceAuthority.allocate = allocate;
  issuanceAuthority.limitId = limitId;
  return issuanceAuthority;
}

export default createRewardIssuanceAuthority;
