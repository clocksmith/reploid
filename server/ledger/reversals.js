/**
 * @fileoverview Purchase reversal rules: refunds and chargebacks of purchased lots.
 *
 * A reversal removes the lot's unspent balance. Credit the lot already spent
 * cannot be removed; an explicit reversal policy decides whether that
 * shortfall becomes an account deficit that blocks new spending or an
 * operator absorption recorded as subsidy. There is no default treatment.
 *
 * Credit still held by an open reservation stays bound to its accepted terms.
 * When that reservation settles, the charged part joins the shortfall and the
 * released part is removed in the same transaction; a later refund restored
 * to the lot is removed the same way. The shortfall is always
 * `quantity - removed - held`, so every settlement order converges.
 */

import { fail, isNonEmptyString } from './domain.js';
import { applyReverse } from './transitions.js';

export const REVERSAL_SCHEMA = 'reploid.credit-reversal/v1';
export const REVERSAL_KINDS = Object.freeze(['refund', 'chargeback']);
export const REVERSAL_AUTHORITIES = Object.freeze(['payment_processor', 'operator_adjustment']);
export const SPENT_CREDIT_TREATMENTS = Object.freeze(['account_deficit', 'operator_absorbs']);
export const REVERSIBLE_PROVENANCE = Object.freeze(['purchased']);

const TREATMENT_FIELD = Object.freeze({ account_deficit: 'deficit', operator_absorbs: 'absorbed' });

/**
 * Validate the explicit spent-credit treatment for each reversal kind.
 * Absent policy is allowed at construction; reversals then fail closed.
 */
export function validateReversalPolicy(policy) {
  if (policy === null || policy === undefined) return null;
  const errors = [];
  if (typeof policy !== 'object') errors.push('reversal policy must be an object');
  for (const key of Object.keys(policy || {})) {
    if (!REVERSAL_KINDS.includes(key)) errors.push(`reversalPolicy.${key} is not a reversal kind`);
  }
  for (const kind of REVERSAL_KINDS) {
    if (!SPENT_CREDIT_TREATMENTS.includes(policy?.[kind]?.spentCredit)) {
      errors.push(`reversalPolicy.${kind}.spentCredit must be one of ${SPENT_CREDIT_TREATMENTS.join(', ')}`);
    }
  }
  if (errors.length) fail('invalid_policy', 'reversal policy is incomplete', { errors });
  return Object.freeze(Object.fromEntries(REVERSAL_KINDS.map((kind) => [kind, Object.freeze({ spentCredit: policy[kind].spentCredit })])));
}

/** The declared treatment for one reversal, after validating its kind and authority. */
export function reversalTreatment(policy, kind, authority) {
  if (!REVERSAL_KINDS.includes(kind)) fail('invalid_input', `kind must be one of ${REVERSAL_KINDS.join(', ')}`);
  if (!REVERSAL_AUTHORITIES.includes(authority?.kind)
    || !isNonEmptyString(authority?.decisionId) || !isNonEmptyString(authority?.actorId)) {
    fail('reversal_authority_required', `reversals need authority.kind (${REVERSAL_AUTHORITIES.join(', ')}), decisionId and actorId`);
  }
  if (!policy) fail('reversal_policy_required', 'reversals need an explicit spent-credit treatment for each kind');
  return policy[kind].spentCredit;
}

export const accountDeficit = (account) => account.reversalShortfall?.deficit ?? 0;

export function newReversal({ lot, reversalId, kind, authority, treatment, reason, now }) {
  return {
    schema: REVERSAL_SCHEMA,
    reversalId,
    lotId: lot.lotId,
    accountId: lot.accountId,
    provenance: lot.provenance,
    sourceKey: lot.sourceKey,
    kind,
    authority: { kind: authority.kind, decisionId: authority.decisionId, actorId: authority.actorId },
    treatment,
    reason: isNonEmptyString(reason) ? reason : null,
    quantity: lot.quantity,
    removed: 0,
    pendingHeld: 0,
    shortfall: 0,
    status: 'awaiting_holds',
    events: [],
    reversedAt: now,
    updatedAt: now
  };
}

/**
 * Bring each reversed lot to its post-transaction state: remove whatever it
 * has available, recompute the shortfall and apply the change under the
 * reversal's recorded treatment. Returns the removed lot amounts for one
 * `reverse` journal entry and the reversal records that changed.
 */
export function sweepReversedLots(account, reversals, { cause, ref, now }) {
  const swept = [];
  const changed = [];
  for (const reversal of Object.values(reversals)) {
    const removable = account.lots[reversal.lotId]?.available ?? 0;
    if (removable > 0) swept.push(...applyReverse(account, reversal.lotId, removable));
    const held = account.lots[reversal.lotId]?.held ?? 0;
    const removed = reversal.removed + removable;
    const shortfall = reversal.quantity - removed - held;
    const delta = shortfall - reversal.shortfall;
    if (removable === 0 && delta === 0 && held === reversal.pendingHeld && reversal.events.length) continue;
    const field = TREATMENT_FIELD[reversal.treatment];
    const totals = { deficit: 0, absorbed: 0, ...account.reversalShortfall };
    totals[field] += delta;
    if (shortfall < 0 || totals[field] < 0) {
      fail('ledger_invariant_violation', 'reversal shortfall became negative', { lotId: reversal.lotId, shortfall });
    }
    account.reversalShortfall = totals;
    Object.assign(reversal, { removed, pendingHeld: held, shortfall, status: held > 0 ? 'awaiting_holds' : 'complete', updatedAt: now });
    reversal.events.push({ cause, ref, removed: removable, shortfallDelta: delta, held, at: now });
    changed.push(reversal);
  }
  return { swept, changed };
}

export default {
  REVERSAL_KINDS,
  SPENT_CREDIT_TREATMENTS,
  validateReversalPolicy,
  reversalTreatment,
  sweepReversedLots
};
