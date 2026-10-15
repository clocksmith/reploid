/**
 * @fileoverview Pure balance transitions for credit lots, reservations,
 * settlement, quality review, refunds and the append-only journal.
 *
 * Transitions mutate the per-transaction copies they receive. Store adapters
 * run them inside one atomic transaction, so memory and Firestore derive
 * identical effects from identical records.
 */

import {
  ACCOUNT_SCHEMA,
  ATTEMPT_CLOSING_STATUSES,
  JOURNAL_SCHEMA,
  PROVENANCE_KINDS,
  RESERVATION_SCHEMA,
  REVIEW_AUTHORITY,
  REVIEW_DISPOSITIONS,
  REVIEW_SCHEMA,
  SETTLEMENT_OUTCOMES,
  SETTLEMENT_SCHEMA,
  SOLVENCY_SCHEMA,
  evaluateFormula,
  fail,
  isAmount,
  isIsoTime,
  isNonEmptyString,
  toMs
} from './domain.js';

// Open lots live in the account document so reserve and settle change one
// balance record atomically. This bound keeps that document far below the
// Firestore 1 MiB limit; issuance past it fails closed.
export const MAX_OPEN_LOTS_PER_ACCOUNT = 1000;

const TOTAL_FIELDS = Object.freeze(['available', 'held', 'issued', 'spent', 'refunded', 'reversed']);
const DELIVERED_OUTCOMES = new Set(['full', 'reduced', 'partial_delivery', 'failed_quality']);
// Outcomes that may settle a request that never dispatched an attempt.
const QUEUED_OUTCOMES = new Set(['cancellation', 'timeout']);
const ON_TIME_OUTCOMES = new Set(['full', 'reduced', 'failed_quality']);
const OUTCOME_TERM_KEYS = Object.freeze({
  full: 'full',
  reduced: 'reduced',
  partial_delivery: 'partialDelivery',
  timeout: 'timeout',
  provider_failure: 'providerFailure',
  failed_quality: 'failedQuality'
});

export const emptyByProvenance = () => Object.fromEntries(PROVENANCE_KINDS.map((kind) => [kind, 0]));
const sumValues = (byProvenance) => Object.values(byProvenance).reduce((sum, value) => sum + value, 0);
const sumAmounts = (lots) => lots.reduce((sum, lot) => sum + lot.amount, 0);

export const reservationIdForQuote = (quoteId) => `rsv:${quoteId}`;
export const settlementIdForReservation = (reservationId) => `stl:${reservationId}`;
export const reviewIdForReservation = (reservationId) => `rvw:${reservationId}`;
export const journalEntryId = (accountId, sequence) => `${accountId}~${String(sequence).padStart(12, '0')}`;

export function newAccount({ accountId, ownerId, now }) {
  return {
    schema: ACCOUNT_SCHEMA,
    accountId,
    ownerId,
    createdAt: now,
    updatedAt: now,
    sequence: 0,
    transfersEnabled: false,
    lots: {},
    totals: Object.fromEntries(TOTAL_FIELDS.map((field) => [field, emptyByProvenance()]))
  };
}

/** Per provenance: issued - spent + refunded - reversed = available + held, and lots match totals. */
export function assertAccountConsistent(account) {
  const lotAvailable = emptyByProvenance();
  const lotHeld = emptyByProvenance();
  for (const [lotId, lot] of Object.entries(account.lots)) {
    if (!isAmount(lot.available) || !isAmount(lot.held)) {
      fail('ledger_invariant_violation', 'lot balances must be non-negative integers', { accountId: account.accountId, lotId });
    }
    lotAvailable[lot.provenance] += lot.available;
    lotHeld[lot.provenance] += lot.held;
  }
  const { totals } = account;
  for (const kind of PROVENANCE_KINDS) {
    const consistent = totals.available[kind] === lotAvailable[kind]
      && totals.held[kind] === lotHeld[kind]
      && totals.issued[kind] - totals.spent[kind] + totals.refunded[kind] - totals.reversed[kind] === totals.available[kind] + totals.held[kind]
      && totals.refunded[kind] <= totals.spent[kind]
      && TOTAL_FIELDS.every((field) => isAmount(totals[field][kind]));
    if (!consistent) fail('ledger_invariant_violation', 'account totals disagree with lots', { accountId: account.accountId, provenance: kind });
  }
  const shortfall = account.reversalShortfall;
  if (shortfall && !(isAmount(shortfall.deficit) && isAmount(shortfall.absorbed))) {
    fail('ledger_invariant_violation', 'reversal shortfall must be non-negative integers', { accountId: account.accountId });
  }
  return account;
}

export const summarizeBalance = (account) => ({
  available: sumValues(account.totals.available),
  held: sumValues(account.totals.held)
});

export function summarizeAccount(account) {
  const balance = summarizeBalance(account);
  return {
    accountId: account.accountId,
    ownerId: account.ownerId,
    sequence: account.sequence,
    ...balance,
    outstanding: balance.available + balance.held,
    deficit: account.reversalShortfall?.deficit ?? 0,
    transfersEnabled: false,
    byProvenance: Object.fromEntries(PROVENANCE_KINDS.map((kind) => [
      kind, Object.fromEntries(TOTAL_FIELDS.map((field) => [field, account.totals[field][kind]]))
    ])),
    openLots: Object.entries(account.lots)
      .map(([lotId, lot]) => ({ lotId, ...lot }))
      .sort((left, right) => left.lotId.localeCompare(right.lotId))
  };
}

export function appendEntry(account, { type, amount, lots, refs, now }) {
  account.sequence += 1;
  return {
    schema: JOURNAL_SCHEMA,
    entryId: journalEntryId(account.accountId, account.sequence),
    accountId: account.accountId,
    seq: account.sequence,
    type,
    amount,
    lots: lots.map(({ lotId, provenance, issuedAt, amount: lotAmount }) => ({ lotId, provenance, issuedAt, amount: lotAmount })),
    refs,
    at: now,
    balanceAfter: summarizeBalance(account)
  };
}

const pruneLot = (account, lotId) => {
  const lot = account.lots[lotId];
  if (lot && lot.available === 0 && lot.held === 0) delete account.lots[lotId];
};

const ensureLot = (account, { lotId, provenance, issuedAt }) => {
  if (account.lots[lotId]) return account.lots[lotId];
  if (Object.keys(account.lots).length >= MAX_OPEN_LOTS_PER_ACCOUNT) {
    fail('open_lot_limit', `account already holds ${MAX_OPEN_LOTS_PER_ACCOUNT} open lots`, { accountId: account.accountId });
  }
  account.lots[lotId] = { provenance, issuedAt, available: 0, held: 0 };
  return account.lots[lotId];
};

export function applyIssue(account, { lotId, provenance, amount, now }) {
  if (account.lots[lotId]) fail('duplicate_issuance_source', 'lot is already open in this account', { lotId });
  const lot = ensureLot(account, { lotId, provenance, issuedAt: now });
  lot.available += amount;
  account.totals.available[provenance] += amount;
  account.totals.issued[provenance] += amount;
  return [{ lotId, provenance, issuedAt: now, amount }];
}

const orderedOpenLots = (account, order) => Object.entries(account.lots)
  .map(([lotId, lot]) => ({ lotId, ...lot }))
  .filter((lot) => lot.available > 0)
  .sort((left, right) => order.indexOf(left.provenance) - order.indexOf(right.provenance)
    || toMs(left.issuedAt) - toMs(right.issuedAt)
    || left.lotId.localeCompare(right.lotId));

/** Hold the authorized maximum from open lots in the declared consumption order. */
export function applyReserve(account, amount, order) {
  const available = sumValues(account.totals.available);
  if (available < amount) {
    fail('insufficient_balance', 'available balance is below the quoted maximum charge', { available, required: amount });
  }
  const draws = [];
  let remaining = amount;
  for (const lot of orderedOpenLots(account, order)) {
    if (remaining === 0) break;
    const take = Math.min(lot.available, remaining);
    account.lots[lot.lotId].available -= take;
    account.lots[lot.lotId].held += take;
    account.totals.available[lot.provenance] -= take;
    account.totals.held[lot.provenance] += take;
    draws.push({ lotId: lot.lotId, provenance: lot.provenance, issuedAt: lot.issuedAt, amount: take });
    remaining -= take;
  }
  return draws;
}

/** Charge from held draws in order; release the remainder to the same lots. */
export function applySettle(account, draws, charge) {
  const held = sumAmounts(draws);
  if (!isAmount(charge) || charge > held) {
    fail('charge_exceeds_authorization', 'charge exceeds the reserved authorized maximum', { charge, authorized: held });
  }
  let remaining = charge;
  const charged = [];
  const released = [];
  for (const draw of draws) {
    const lot = account.lots[draw.lotId];
    if (!lot || lot.held < draw.amount) {
      fail('ledger_invariant_violation', 'reservation draw is not held by its lot', { lotId: draw.lotId });
    }
    const take = Math.min(draw.amount, remaining);
    const back = draw.amount - take;
    remaining -= take;
    lot.held -= draw.amount;
    lot.available += back;
    account.totals.held[draw.provenance] -= draw.amount;
    account.totals.spent[draw.provenance] += take;
    account.totals.available[draw.provenance] += back;
    if (take > 0) charged.push({ ...draw, amount: take });
    if (back > 0) released.push({ ...draw, amount: back });
    pruneLot(account, draw.lotId);
  }
  return { charged, released };
}

/** Restore refunded credit to the lots it was charged from, newest draw first. */
export function applyRefund(account, chargedDraws, refundedByLot, amount) {
  const refundable = chargedDraws.reduce((sum, draw) => sum + draw.amount - (refundedByLot[draw.lotId] || 0), 0);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > refundable) {
    fail('refund_exceeds_charge', 'refund must be positive and within the unrefunded charge', { amount, refundable });
  }
  let remaining = amount;
  const restored = [];
  for (const draw of [...chargedDraws].reverse()) {
    if (remaining === 0) break;
    const take = Math.min(draw.amount - (refundedByLot[draw.lotId] || 0), remaining);
    if (take <= 0) continue;
    ensureLot(account, draw).available += take;
    account.totals.available[draw.provenance] += take;
    account.totals.refunded[draw.provenance] += take;
    restored.push({ ...draw, amount: take });
    remaining -= take;
  }
  return restored;
}

/** Remove available credit from a reversed lot; credit held by a reservation stays bound to it. */
export function applyReverse(account, lotId, amount) {
  const lot = account.lots[lotId];
  if (!lot || !Number.isSafeInteger(amount) || amount <= 0 || amount > lot.available) {
    fail('ledger_invariant_violation', 'reversal exceeds the lot\'s available credit', { lotId, amount });
  }
  lot.available -= amount;
  account.totals.available[lot.provenance] -= amount;
  account.totals.reversed[lot.provenance] += amount;
  const removed = [{ lotId, provenance: lot.provenance, issuedAt: lot.issuedAt, amount }];
  pruneLot(account, lotId);
  return removed;
}

export function newReservation({ quote, deviceId, draws, now }) {
  const reservationId = reservationIdForQuote(quote.quoteId);
  return {
    schema: RESERVATION_SCHEMA,
    reservationId,
    quoteId: quote.quoteId,
    quoteHash: quote.quoteHash,
    accountId: quote.accountId,
    deviceId,
    contract: quote.contract,
    accountingVersion: quote.accountingVersion,
    unit: quote.unit,
    rounding: quote.rounding,
    service: quote.service,
    pricing: quote.pricing,
    terms: quote.terms,
    authorizedMax: quote.pricing.maxCharge,
    draws,
    status: 'open',
    acceptedAt: now,
    expiresAt: new Date(toMs(now) + quote.terms.reservationPeriodMs).toISOString(),
    attempts: [],
    billableEventId: null,
    reviewId: null,
    settlement: null,
    refunds: { total: 0, byLot: {}, refundIds: [] },
    updatedAt: now
  };
}

export const isReservationExpired = (reservation, now) => reservation.status === 'open'
  && toMs(now) >= toMs(reservation.expiresAt);

export function assertOpenReservation(reservation, now) {
  if (reservation.status === 'under_review') {
    fail('reservation_under_review', 'reservation awaits operational quality review', { reviewId: reservation.reviewId });
  }
  if (reservation.status === 'expired' || isReservationExpired(reservation, now)) {
    fail('reservation_expired', 'reservation period ended; its hold is released, not charged', { expiresAt: reservation.expiresAt });
  }
  if (reservation.status !== 'open') {
    fail('reservation_already_settled', 'reservation already has its one economic effect', {
      settlementId: reservation.settlement?.settlementId || null
    });
  }
}

/**
 * Bind an attempt and its actual recipients before dispatch. Attempts carry
 * no economic effect; all attempts under one acceptance share its maximum.
 */
export function bindAttemptTransition(reservation, { attemptId, recipients, now }) {
  assertOpenReservation(reservation, now);
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.some((entry) => !isNonEmptyString(entry))) {
    fail('invalid_input', 'recipients must list the actual recipient identities');
  }
  if (reservation.attempts.some((attempt) => attempt.attemptId === attemptId)) {
    fail('attempt_already_bound', 'attempt is already bound to this reservation', { attemptId });
  }
  const active = reservation.attempts.find((attempt) => attempt.status === 'bound');
  if (active) fail('attempt_active', 'close the active attempt before binding a replacement', { activeAttemptId: active.attemptId });
  if (reservation.attempts.length >= reservation.terms.execution.maxAttempts) {
    fail('attempt_limit_reached', 'accepted terms allow no further attempt; a replacement needs a newly accepted quote', {
      maxAttempts: reservation.terms.execution.maxAttempts
    });
  }
  const attempt = {
    attemptId,
    attemptNumber: reservation.attempts.length + 1,
    recipients: [...recipients],
    status: 'bound',
    boundAt: now,
    closedAt: null,
    reason: null
  };
  reservation.attempts.push(attempt);
  reservation.updatedAt = now;
  return attempt;
}

export function closeAttemptTransition(reservation, { attemptId, status, reason, now }) {
  if (!ATTEMPT_CLOSING_STATUSES.includes(status)) {
    fail('invalid_input', `attempt status must be one of ${ATTEMPT_CLOSING_STATUSES.join(', ')}`);
  }
  const attempt = reservation.attempts.find((entry) => entry.attemptId === attemptId);
  if (!attempt) fail('attempt_not_bound', 'attempt is not bound to this reservation yet', { attemptId });
  if (attempt.status !== 'bound') fail('attempt_already_closed', 'attempt is already closed', { attemptId, status: attempt.status });
  attempt.status = status;
  attempt.closedAt = now;
  attempt.reason = isNonEmptyString(reason) ? reason : null;
  reservation.updatedAt = now;
  return attempt;
}

const validateMetering = (metering, limits) => {
  const result = {};
  for (const [meter, value] of Object.entries(metering || {})) {
    if (!limits[meter]) fail('invalid_input', `metering.${meter} is not a declared service limit`, { meter });
    if (!isAmount(value)) fail('invalid_input', `metering.${meter} must be a non-negative integer`, { meter });
    if (value > limits[meter].max) {
      fail('metering_exceeds_limits', 'metered usage exceeds the quoted limit', { meter, value, max: limits[meter].max });
    }
    result[meter] = value;
  }
  return result;
};

/** Decide which accepted term governs an outcome; the charge never comes from the caller. */
export function decideSettlement(reservation, input, now) {
  assertOpenReservation(reservation, now);
  const { outcome } = input;
  if (!SETTLEMENT_OUTCOMES.includes(outcome)) fail('invalid_outcome', `outcome must be one of ${SETTLEMENT_OUTCOMES.join(', ')}`);
  const metering = validateMetering(input.metering, reservation.service.limits);
  const attempt = input.attemptId ? reservation.attempts.find((entry) => entry.attemptId === input.attemptId) : null;
  if (input.attemptId && !attempt) fail('attempt_not_bound', 'settlement names an attempt that is not bound yet', { attemptId: input.attemptId });
  if (!QUEUED_OUTCOMES.has(outcome) && !attempt) fail('attempt_required', `${outcome} settlement requires a bound attempt`);
  if (DELIVERED_OUTCOMES.has(outcome) && attempt.status !== 'bound') {
    fail('attempt_closed', 'delivered outcomes require the active attempt', { attemptId: attempt.attemptId, status: attempt.status });
  }
  if (ON_TIME_OUTCOMES.has(outcome)) {
    if (!isIsoTime(input.completedAt) || toMs(input.completedAt) > toMs(now)) {
      fail('invalid_input', 'completedAt must be a past ISO time for delivered outcomes');
    }
    if (toMs(input.completedAt) > toMs(reservation.service.deadline)) {
      fail('delivered_after_deadline', 'output completed after the quoted deadline; settle it as timeout', {
        deadline: reservation.service.deadline
      });
    }
  }
  if (outcome === 'timeout' && toMs(now) < toMs(reservation.service.deadline)) {
    fail('timeout_before_deadline', 'timeout cannot settle before the quoted deadline', { deadline: reservation.service.deadline });
  }
  if ((outcome === 'reduced' || outcome === 'failed_quality') && !isNonEmptyString(input.reason)) {
    fail('invalid_input', `${outcome} settlement requires a stated reason`);
  }
  const termKey = outcome === 'cancellation'
    ? (reservation.attempts.length > 0 ? 'cancellationDispatched' : 'cancellationQueued')
    : OUTCOME_TERM_KEYS[outcome];
  const formula = reservation.terms.settlement[termKey];
  if (!formula) fail('outcome_not_in_terms', `the accepted quote declares no ${termKey} settlement`, { termKey });
  return {
    outcome,
    termKey,
    formula,
    metering,
    attempt,
    phase: outcome === 'cancellation' ? (termKey === 'cancellationDispatched' ? 'dispatched' : 'queued') : null
  };
}

/** Review dispositions and their charges are fixed from accepted terms before any review. */
export function reviewDispositionCharges(reservation, metering) {
  return Object.fromEntries(REVIEW_DISPOSITIONS
    .map((disposition) => [disposition, reservation.terms.settlement[OUTCOME_TERM_KEYS[disposition]]])
    .filter(([, formula]) => Boolean(formula))
    .map(([disposition, formula]) => [disposition, evaluateFormula(formula, metering, reservation.rounding)]));
}

export function newReview({ reservation, decision, input, now }) {
  return {
    schema: REVIEW_SCHEMA,
    reviewId: reviewIdForReservation(reservation.reservationId),
    reservationId: reservation.reservationId,
    quoteId: reservation.quoteId,
    accountId: reservation.accountId,
    billableEventId: input.billableEventId,
    attemptId: decision.attempt.attemptId,
    qualityPolicyVersion: reservation.service.qualityPolicyVersion,
    procedureId: reservation.terms.qualityReview.procedureId,
    claim: { reason: input.reason, evidenceRef: input.evidenceRef ?? null },
    metering: decision.metering,
    completedAt: input.completedAt,
    dispositionCharges: reviewDispositionCharges(reservation, decision.metering),
    status: 'pending_review',
    openedAt: now,
    disposition: null,
    reviewer: null,
    resolvedAt: null,
    settlementId: null
  };
}

/** Only an operational review may decide a failed-quality claim. */
export function decideReview(review, reservation, { disposition, reviewer }) {
  if (review.status !== 'pending_review') fail('review_already_resolved', 'quality review already has a disposition');
  if (reservation.status !== 'under_review') fail('ledger_invariant_violation', 'reviewed reservation is not under review');
  if (reviewer?.authority !== REVIEW_AUTHORITY) {
    fail('review_authority_required', 'failed-quality claims need an operational review decision, never automatic adjudication');
  }
  if (!isNonEmptyString(reviewer.reviewerId) || !isNonEmptyString(reviewer.decisionId)) {
    fail('invalid_input', 'reviewer.reviewerId and reviewer.decisionId are required');
  }
  if (!REVIEW_DISPOSITIONS.includes(disposition)) fail('invalid_input', `disposition must be one of ${REVIEW_DISPOSITIONS.join(', ')}`);
  const charge = review.dispositionCharges[disposition];
  if (!isAmount(charge)) fail('outcome_not_in_terms', `the accepted quote declares no ${disposition} settlement`);
  return { charge, termKey: OUTCOME_TERM_KEYS[disposition] };
}

export function buildSettlementRecord({ reservation, outcome, termKey, formula, metering, attempt, phase, charge, charged, released, input, review, now }) {
  return {
    schema: SETTLEMENT_SCHEMA,
    settlementId: settlementIdForReservation(reservation.reservationId),
    billableEventId: input?.billableEventId ?? null,
    reservationId: reservation.reservationId,
    quoteId: reservation.quoteId,
    quoteHash: reservation.quoteHash,
    accountId: reservation.accountId,
    contract: reservation.contract,
    accountingVersion: reservation.accountingVersion,
    unit: reservation.unit,
    rounding: reservation.rounding,
    service: reservation.service,
    attempt: attempt ? { attemptId: attempt.attemptId, attemptNumber: attempt.attemptNumber, recipients: attempt.recipients } : null,
    outcome,
    phase: phase ?? null,
    termKey: termKey ?? null,
    formula: formula ?? null,
    metering: metering ?? {},
    completedAt: input?.completedAt ?? null,
    reason: input?.reason ?? null,
    review: review ?? null,
    authorizedMax: reservation.authorizedMax,
    charge,
    released: reservation.authorizedMax - charge,
    chargedLots: charged,
    releasedLots: released,
    settledAt: now
  };
}

const ENTRY_DELTAS = Object.freeze({
  issue: { available: 1, issued: 1 },
  reserve: { available: -1, held: 1 },
  charge: { held: -1, spent: 1 },
  release: { held: -1, available: 1 },
  refund: { available: 1, refunded: 1 },
  reverse: { available: -1, reversed: 1 }
});

/** Rebuild account totals and open lots from the append-only journal alone. */
export function replayJournal(entries, { accountId }) {
  const sorted = [...entries].sort((left, right) => left.seq - right.seq);
  const totals = Object.fromEntries(TOTAL_FIELDS.map((field) => [field, emptyByProvenance()]));
  const lots = {};
  sorted.forEach((entry, index) => {
    if (entry.accountId !== accountId || entry.seq !== index + 1) {
      fail('ledger_invariant_violation', 'journal sequence has a gap or foreign entry', { accountId, seq: entry.seq });
    }
    const delta = ENTRY_DELTAS[entry.type];
    if (!delta) fail('ledger_invariant_violation', `journal entry type ${entry.type} is not replayable`, { seq: entry.seq });
    for (const lot of entry.lots) {
      lots[lot.lotId] ||= { provenance: lot.provenance, issuedAt: lot.issuedAt, available: 0, held: 0 };
      for (const [field, sign] of Object.entries(delta)) {
        totals[field][lot.provenance] += sign * lot.amount;
        if (field === 'available' || field === 'held') lots[lot.lotId][field] += sign * lot.amount;
      }
    }
  });
  for (const [lotId, lot] of Object.entries(lots)) {
    if (lot.available === 0 && lot.held === 0) delete lots[lotId];
  }
  return { sequence: sorted.length, totals, lots };
}

const withTotal = (byProvenance) => ({ total: sumValues(byProvenance), byProvenance });

/**
 * Inputs for REP-14 solvency analysis. Nominal balances are outstanding
 * service obligations, not dollar liabilities; values owned elsewhere stay null.
 */
export function summarizeSolvency({ accounts, reservations, policy, now }) {
  const fields = Object.fromEntries(TOTAL_FIELDS.map((field) => [field, emptyByProvenance()]));
  for (const account of accounts) {
    for (const field of TOTAL_FIELDS) {
      for (const kind of PROVENANCE_KINDS) fields[field][kind] += account.totals[field][kind];
    }
  }
  const outstanding = Object.fromEntries(PROVENANCE_KINDS.map((kind) => [kind, fields.available[kind] + fields.held[kind]]));
  const open = reservations.filter((reservation) => reservation.status === 'open');
  const underReview = reservations.filter((reservation) => reservation.status === 'under_review');
  const heldBy = (list) => list.reduce((sum, reservation) => sum + reservation.authorizedMax, 0);
  const shortfall = (field) => accounts.reduce((sum, account) => sum + (account.reversalShortfall?.[field] ?? 0), 0);
  const netSpent = (kind) => fields.spent[kind] - fields.refunded[kind];
  return {
    schema: SOLVENCY_SCHEMA,
    generatedAt: now,
    contract: policy.contract,
    accountingVersion: policy.accountingVersion,
    unit: policy.unit,
    accountsObserved: accounts.length,
    outstanding: withTotal(outstanding),
    available: withTotal(fields.available),
    held: withTotal(fields.held),
    issued: withTotal(fields.issued),
    spent: withTotal(fields.spent),
    refunded: withTotal(fields.refunded),
    reversed: withTotal(fields.reversed),
    // Spent credit a refund or chargeback could not remove, by its declared treatment.
    reversalShortfall: { deficit: shortfall('deficit'), absorbed: shortfall('absorbed') },
    // Disclosed apart from earned and purchased credit: service consumed under
    // Community Access funding, reward credit issued from funding reservations,
    // and spent credit operators absorbed after reversals.
    subsidy: {
      communityAccessConsumed: netSpent('community_access'),
      subsidizedRewardsIssued: fields.issued.subsidized,
      reversalAbsorbed: shortfall('absorbed')
    },
    reservations: {
      open: { count: open.length, held: heldBy(open) },
      underReview: { count: underReview.length, held: heldBy(underReview) },
      awaitingExpiryRelease: open.filter((reservation) => isReservationExpired(reservation, now)).length
    },
    notTracked: {
      expectedRedemptionDemand: null,
      admittedSupply: null,
      reliabilityReserves: null,
      operatorSubsidy: null
    }
  };
}
