/**
 * @fileoverview Earned-issuance authority: the ledger's `issuanceAuthority`
 * hook for contribution rewards.
 *
 * It allows an earned lot only for an accepted reward validation whose
 * contributor, amount and work identity match the ledger request, and only
 * within the explicit issuance policy's limits over the ledger solvency
 * snapshot and fresh admitted-capacity evidence. Allowances commit atomically
 * with one cumulative counter, so concurrent issuances cannot overrun a limit;
 * a repeated request for the same validation returns the same decision.
 */

import { randomUUID } from 'node:crypto';

import { assertId, cloneJson, isNonEmptyString } from '../ledger/domain.js';
import {
  ISSUANCE_DECISION_SCHEMA,
  ISSUANCE_STATE_SCHEMA,
  evaluateIssuanceLimits,
  validateIssuancePolicy,
  validateRewardPolicy
} from './domain.js';
import { assertRewardBackend } from './store-contract.js';

export const ISSUANCE_STATE_ID = 'earned';
export const decisionIdForValidation = (validationId) => `issuance:${validationId}`;

const emptyState = () => ({ schema: ISSUANCE_STATE_SCHEMA, authorizedTotal: 0, allowances: 0, updatedAt: null });

const validIdentifier = (value) => {
  try {
    assertId(value, 'validationId');
    return true;
  } catch {
    return false;
  }
};

// Why a ledger request does not match the validated work, or null.
const requestMismatch = (request, validation, rewardPolicy) => {
  if (!validation) return 'validation_not_found';
  if (validation.outcome !== 'accepted') return 'validation_not_accepted';
  if (!rewardPolicy.enabledCategories.includes(validation.category)) return 'reward_category_disabled';
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

  return async function issuanceAuthority(request) {
    if (request?.provenance !== 'earned') {
      if (typeof otherProvenance === 'function') return otherProvenance(request);
      return { allowed: false, reason: 'provenance_not_governed' };
    }
    const validationId = request.source?.validationId;
    if (!validIdentifier(validationId)) return { allowed: false, reason: 'validation_not_found' };
    const [snapshot, capacity] = await Promise.all([read(readSolvency), read(readAdmittedCapacity)]);
    const now = clock();
    return backend.runTransaction(async (tx) => {
      const allowance = await tx.get('allowances', validationId);
      const validation = await tx.get('validations', validationId);
      const state = (await tx.get('issuance', ISSUANCE_STATE_ID)) ?? emptyState();
      const mismatch = requestMismatch(request, validation, activeRewardPolicy);
      if (allowance && !mismatch && allowance.amount === request.amount) {
        return { allowed: true, decisionId: allowance.decisionId, limitId: allowance.limitId };
      }
      const decision = mismatch || allowance
        ? { allowed: false, reason: mismatch || 'issuance_request_mismatch', figures: {} }
        : snapshot
          ? evaluateIssuanceLimits({ policy: issuancePolicy, snapshot, capacity, authorizedTotal: state.authorizedTotal, amount: request.amount, now })
          : { allowed: false, reason: 'solvency_unavailable', figures: {} };
      const base = {
        schema: ISSUANCE_DECISION_SCHEMA,
        limitId,
        accountingVersion: issuancePolicy.accountingVersion,
        validationId,
        accountId: request.accountId,
        amount: request.amount,
        workId: isNonEmptyString(request.source?.workId) ? request.source.workId : null,
        figures: cloneJson(decision.figures),
        decidedAt: now
      };
      if (!decision.allowed) {
        const declineId = createId('idecline');
        tx.create('decisions', declineId, { ...base, decisionId: declineId, allowed: false, reason: decision.reason });
        return { allowed: false, reason: decision.reason, limitId, figures: cloneJson(decision.figures) };
      }
      const decisionId = decisionIdForValidation(validationId);
      tx.create('allowances', validationId, { ...base, decisionId, allowed: true, reason: null });
      tx.set('issuance', ISSUANCE_STATE_ID, {
        schema: ISSUANCE_STATE_SCHEMA,
        authorizedTotal: state.authorizedTotal + request.amount,
        allowances: state.allowances + 1,
        updatedAt: now
      });
      return { allowed: true, decisionId, limitId };
    });
  };
}

export default createRewardIssuanceAuthority;
