import { createKnownKeyValidator } from '../input-validation.js';
/**
 * @fileoverview Credit-ledger operations over a transactional document backend.
 *
 * Each mutation commits its idempotency record, balance change, journal
 * entries and uniqueness claims in one backend transaction, or nothing.
 * A duplicate delivery returns the stored result. A replay under a new key is
 * rejected by canonical identity: one acceptance per quote, one settlement per
 * reservation, one economic effect per billable event, one lot per issuance
 * source, one record per refund id and one reversal per purchased lot. The
 * funding-commitment register (funding/register.js) shares these guarantees:
 * one commitment per external reference and allocations within its total.
 * Conversion records (conversion/records.js) are append-only; purchased lots
 * and currency allocations recompute their credits from the record they stamp.
 */

import { randomUUID } from 'node:crypto';

import {
  LOT_SCHEMA,
  MAX_QUOTE_ID_LENGTH,
  REFUND_AUTHORITIES,
  REWARD_PROVENANCE,
  REFUND_SCHEMA,
  assertId,
  assertIdempotencyKey,
  buildQuote,
  canonicalJson,
  cloneJson,
  evaluateFormula,
  fail,
  hashCanonical,
  isNonEmptyString,
  lotIdForSource,
  sha256Hex,
  sourceClaimKey,
  toMs,
  validateAccountingPolicy,
  validateIssuanceSource
} from './domain.js';
import {
  appendEntry,
  applyIssue,
  applyRefund,
  applyReserve,
  applySettle,
  assertAccountConsistent,
  assertOpenReservation,
  bindAttemptTransition,
  buildSettlementRecord,
  closeAttemptTransition,
  decideReview,
  decideSettlement,
  isReservationExpired,
  newAccount,
  newReservation,
  newReview,
  replayJournal,
  settlementIdForReservation,
  summarizeAccount,
  summarizeBalance,
  summarizeSolvency
} from './transitions.js';
import {
  REVERSIBLE_PROVENANCE,
  accountDeficit,
  newReversal,
  reversalTreatment,
  sweepReversedLots,
  validateReversalPolicy
} from './reversals.js';
import {
  ATTEMPT_OUTCOME_RULES_ID,
  ATTEMPT_RECORD_SCHEMA,
  attemptRecordIdFor,
  billableEventIdFor,
  deriveAttemptOutcome,
  routeHashOf
} from './attempt-outcomes.js';
import { EVIDENCE_RULES_ID, decideFromEvidence, evidenceWindowClosed, mergeAttemptEvidence, verifyAttemptEvidence } from './attempt-evidence.js';
import { createEvidenceOperations } from './evidence-operations.js';
import { checkStampedConversion, createConversionOperations } from './conversion/records.js';
import { ALLOCATED_PROVENANCE, createFundingRegisterOperations, drawIssuanceAllocation, summarizeFunding } from './funding/register.js';
import { assertLedgerBackend } from './store-contract.js';

const defaultClock = () => new Date().toISOString();
const defaultCreateId = (prefix) => `${prefix}_${randomUUID()}`;
const insert = (collection, id, value) => ({ create: true, collection, id, value });
const put = (collection, id, value) => ({ create: false, collection, id, value });

const assertKnownKeys = createKnownKeyValidator(fail);

const pick = (input, keys) => Object.fromEntries(keys.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));

const applyWrites = (tx, writes) => {
  for (const write of writes) {
    if (write.collection === 'accounts') assertAccountConsistent(write.value);
    if (write.create) tx.create(write.collection, write.id, write.value);
    else tx.set(write.collection, write.id, write.value);
  }
};

const readRequired = async (tx, collection, id, code) => {
  const record = await tx.get(collection, id);
  if (!record) fail(code, `${collection} record ${id} was not found`, { id });
  return record;
};

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend (see store-contract.js)
 * @param {object} options.policy explicit accounting policy; there is no default
 * @param {Function} [options.issuanceAuthority] capacity-aware issuance decision port;
 *   required for earned and subsidized credit, consulted for every issuance when supplied
 * @param {Function} [options.deviceAuthority] (tx, { accountId, deviceId }) -> true when the
 *   device may spend for the account; read inside the quote-acceptance transaction, so a
 *   revocation committed first refuses the acceptance
 * @param {Function} [options.fundingAuthority] ({ action, use, authority, ... }) -> { allowed, reason? }
 *   for funding-register uses no other component owns (donated credit); who holds that
 *   authority is policy behind the port, and without it those allocations fail closed
 * @param {Function} [options.conversionAuthority] ({ action: 'publish_conversion', conversionId, currency,
 *   policyVersion, authority }) -> { allowed, reason? }; who may publish conversion records is policy
 *   behind the port, and without it publishing fails closed
 * @param {Function} [options.signerAuthority] ({ participantId, at }) -> { accountId, deviceId, registrationId,
 *   publicJwk } | null: the registration of a participant key in force at a signing time, even if revoked
 *   since; without it attempt evidence fails closed
 */
export function createLedgerStore({
  backend,
  policy,
  clock = defaultClock,
  createId = defaultCreateId,
  conversionAuthority = null,
  deviceAuthority = null,
  signerAuthority = null,
  fundingAuthority = null,
  issuanceAuthority = null,
  // Explicit spent-credit treatment per reversal kind (see reversals.js); without it reversals fail closed.
  reversalPolicy = null
} = {}) {
  assertLedgerBackend(backend);
  if (deviceAuthority !== null && typeof deviceAuthority !== 'function') throw new TypeError('deviceAuthority must be a function');
  if (fundingAuthority !== null && typeof fundingAuthority !== 'function') throw new TypeError('fundingAuthority must be a function');
  if (conversionAuthority !== null && typeof conversionAuthority !== 'function') throw new TypeError('conversionAuthority must be a function');
  if (signerAuthority !== null && typeof signerAuthority !== 'function') throw new TypeError('signerAuthority must be a function');
  const activePolicy = validateAccountingPolicy(policy);
  const activeReversalPolicy = validateReversalPolicy(reversalPolicy);
  const idempotencyId = (operation, scopeId, key) => sha256Hex(`${operation}\u0000${scopeId}\u0000${key}`);
  const claimId = (kind, key) => sha256Hex(`${kind}\u0000${key}`);

  const priorResult = (record, requestHash, operation) => {
    if (!record) return null;
    if (record.requestHash !== requestHash) {
      fail('idempotency_conflict', 'idempotency key was already used with a different request', { operation });
    }
    return { result: cloneJson(record.result) };
  };

  const lookupIdempotent = async ({ operation, scopeId, idempotencyKey, request }) => priorResult(
    await backend.get('idempotency', idempotencyId(operation, scopeId, idempotencyKey)),
    hashCanonical({ operation, request }),
    operation
  );

  const mutate = ({ operation, scopeId, idempotencyKey, request, now, body }) => {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = hashCanonical({ operation, request });
    const recordId = idempotencyId(operation, scopeId, idempotencyKey);
    return backend.runTransaction(async (tx) => {
      const prior = priorResult(await tx.get('idempotency', recordId), requestHash, operation);
      if (prior) return prior.result;
      const { result, writes } = await body(tx);
      applyWrites(tx, writes);
      tx.create('idempotency', recordId, { operation, scopeId, idempotencyKey, requestHash, result, recordedAt: now });
      return cloneJson(result);
    });
  };

  const authorizeIssuance = async (request) => {
    if (typeof issuanceAuthority !== 'function') {
      if (REWARD_PROVENANCE.includes(request.provenance)) {
        fail('issuance_authority_required', 'earned and subsidized credit require a capacity-aware issuance authority');
      }
      return null;
    }
    const decision = await issuanceAuthority(cloneJson(request));
    if (decision?.allowed !== true || !isNonEmptyString(decision.decisionId)) {
      fail('issuance_not_authorized', 'issuance authority declined this issuance', { reason: decision?.reason ?? null });
    }
    return { decisionId: decision.decisionId, limitId: decision.limitId ?? null };
  };

  // Reversal records for the reversible lots a transition may return credit to.
  const readReversals = async (tx, lots) => {
    const found = {};
    const lotIds = new Set(lots.filter((lot) => REVERSIBLE_PROVENANCE.includes(lot.provenance)).map((lot) => lot.lotId));
    for (const lotId of lotIds) {
      const reversal = await tx.get('reversals', lotId);
      if (reversal) found[lotId] = reversal;
    }
    return found;
  };

  // Credit returned to a reversed lot is removed in the same transaction.
  const sweep = (account, reversals, { cause, refs, now }) => {
    const { swept, changed } = sweepReversedLots(account, reversals, { cause, ref: refs, now });
    const entries = swept.length
      ? [appendEntry(account, {
        type: 'reverse', amount: swept.reduce((sum, lot) => sum + lot.amount, 0), lots: swept,
        refs: { ...refs, reversalIds: changed.map((reversal) => reversal.reversalId) }, now
      })]
      : [];
    return [...entries.map((entry) => insert('journal', entry.entryId, entry)), ...changed.map((reversal) => put('reversals', reversal.lotId, reversal))];
  };

  // Charge per accepted terms, release the rest, and close the reservation.
  const finalize = ({ account, reservation, decision, charge, input, review, reversals = {}, now }) => {
    const { charged, released } = applySettle(account, reservation.draws, charge);
    const settlementId = settlementIdForReservation(reservation.reservationId);
    const refs = {
      quoteId: reservation.quoteId,
      reservationId: reservation.reservationId,
      settlementId,
      billableEventId: input?.billableEventId ?? null
    };
    const entries = [];
    if (charge > 0) entries.push(appendEntry(account, { type: 'charge', amount: charge, lots: charged, refs, now }));
    const releasedAmount = reservation.authorizedMax - charge;
    if (releasedAmount > 0) entries.push(appendEntry(account, { type: 'release', amount: releasedAmount, lots: released, refs, now }));
    const reversalWrites = sweep(account, reversals, { cause: 'settlement', refs, now });
    const record = buildSettlementRecord({ reservation, ...decision, charge, charged, released, input, review, now });
    const attempt = decision.attempt
      ? reservation.attempts.find((entry) => entry.attemptId === decision.attempt.attemptId)
      : null;
    if (attempt?.status === 'bound') Object.assign(attempt, { status: 'settled', closedAt: now });
    reservation.status = decision.outcome === 'expired' ? 'expired' : 'settled';
    reservation.settlement = record;
    reservation.updatedAt = now;
    account.updatedAt = now;
    return {
      record,
      writes: [
        ...entries.map((entry) => insert('journal', entry.entryId, entry)),
        ...reversalWrites,
        put('accounts', account.accountId, account),
        put('reservations', reservation.reservationId, reservation)
      ]
    };
  };

  // One billable event's economic effect inside the caller's transaction; reads precede the returned writes.
  const settleWithin = async (tx, reservation, request, now) => {
    const { reservationId } = reservation;
    const { billableEventId } = request;
    const eventClaimId = claimId('billable_event', billableEventId);
    const claim = await tx.get('claims', eventClaimId);
    const account = await readRequired(tx, 'accounts', reservation.accountId, 'account_not_found');
    const decision = decideSettlement(reservation, request, now);
    if (claim) {
      fail('billable_event_already_settled', 'billable event already has its economic effect', {
        reservationId: claim.reservationId, settlementId: claim.settlementId
      });
    }
    reservation.billableEventId = billableEventId;
    const eventClaim = insert('claims', eventClaimId, {
      kind: 'billable_event', key: billableEventId, reservationId,
      settlementId: settlementIdForReservation(reservationId), recordedAt: now
    });
    if (decision.outcome === 'failed_quality') {
      const review = newReview({ reservation, decision, input: request, now });
      Object.assign(reservation, { status: 'under_review', reviewId: review.reviewId, updatedAt: now });
      return {
        result: {
          status: 'under_review',
          reservationId,
          reviewId: review.reviewId,
          billableEventId,
          held: reservation.authorizedMax,
          dispositionCharges: review.dispositionCharges
        },
        writes: [eventClaim, insert('reviews', review.reviewId, review), put('reservations', reservationId, reservation)]
      };
    }
    const charge = evaluateFormula(decision.formula, decision.metering, reservation.rounding);
    const reversals = await readReversals(tx, reservation.draws);
    const { record, writes } = finalize({ account, reservation, decision, charge, input: request, review: null, reversals, now });
    return { result: record, writes: [eventClaim, ...writes] };
  };

  const conversions = createConversionOperations({ backend, policy: activePolicy, clock, mutate, conversionAuthority });
  const evidence = createEvidenceOperations({ backend, clock, mutate, claimId, readRequired, readReversals, sweep, applyWrites, signerAuthority });

  /**
   * A report's own evidence is verified before its transaction. Evidence that
   * does not verify leaves the report to its rules and is listed, not kept.
   */
  const verifyReportEvidence = async (reservationId, report, now) => {
    if (report?.evidence === undefined || report.evidence === null) return { verified: null, rejected: [] };
    const reservation = await backend.get('reservations', reservationId);
    if (!reservation?.terms?.evidence) fail('evidence_not_in_terms', 'the accepted quote offers report-only settlement');
    if (typeof signerAuthority !== 'function') fail('evidence_authority_required', 'evidence verification needs the signer-registration port');
    try {
      const verified = await verifyAttemptEvidence({ bundle: report.evidence, reservation, signerAt: signerAuthority, now });
      return { verified, rejected: verified.rejected };
    } catch (error) {
      if (error?.name !== 'LedgerError' || error.retryable) throw error;
      return { verified: null, rejected: [{ item: 'evidence', problem: error.code }] };
    }
  };

  /** An evidence-terms report inside settleAttempt's transaction (see settleAttempt). */
  const settleReportedAttempt = async (tx, reservation, { report, verified, rejected, now }) => {
    const { reservationId } = reservation;
    if (reservation.report) fail('attempt_already_reported', 'a final report awaits its evidence window', { attemptId: reservation.report.attemptId });
    const derived = deriveAttemptOutcome({ reservation, report, now });
    const existing = derived.record ? await tx.get('attemptRecords', derived.record.recordId) : null;
    const records = await evidence.readRecords(tx, reservation);
    if (existing) fail('attempt_already_reported', 'this route attempt already has its report', { recordId: derived.record.recordId });
    const writes = [];
    if (verified) {
      const merged = mergeAttemptEvidence(records.get(verified.attemptId) ?? null, verified, {
        reservation, submitter: { participantId: verified.identity.requesterId }, now
      });
      records.set(verified.attemptId, merged.record);
      if (merged.changed) writes.push(put('attemptEvidence', merged.record.evidenceId, merged.record));
    }
    const closed = derived.close ? closeAttemptTransition(reservation, { ...derived.close, now }) : null;
    const attemptId = derived.record?.identity.attemptId ?? derived.settle?.attemptId ?? null;
    const record = derived.record ? {
      schema: ATTEMPT_RECORD_SCHEMA, ...derived.record, reservationId, quoteId: reservation.quoteId, accountId: reservation.accountId,
      attemptId, rules: ATTEMPT_OUTCOME_RULES_ID, rule: derived.rule, outcome: null, settlementId: null, reportedAt: now
    } : null;
    let applied = null;
    if (derived.settle) {
      // A report its rules cannot settle is refused now, exactly as without evidence terms, never left to fail at the window.
      decideSettlement(cloneJson(reservation), { billableEventId: billableEventIdFor(reservationId), ...derived.settle }, now);
      reservation.report = { rule: derived.rule, attemptId, settle: cloneJson(derived.settle), recordId: record?.recordId ?? null, reportedAt: now };
      const decision = decideFromEvidence({ reservation, records, now });
      if (derived.rule === 'cancelled_before_dispatch' || decision.corroborated || evidenceWindowClosed(reservation, now)) {
        applied = await evidence.applyDecisionWithin(tx, reservation, decision, records, now, { newRecord: record });
        writes.push(...applied.writes);
      }
    }
    if (!applied) {
      reservation.updatedAt = now;
      writes.push(put('reservations', reservationId, reservation));
      if (record) writes.push(insert('attemptRecords', record.recordId, record));
    }
    const attempt = attemptId ? reservation.attempts.find((entry) => entry.attemptId === attemptId) : null;
    const waiting = derived.settle && !applied;
    return {
      result: {
        reservationId, rules: ATTEMPT_OUTCOME_RULES_ID, rule: derived.rule, recordId: record?.recordId ?? null,
        attempt: attempt ? { attemptId, attemptNumber: attempt.attemptNumber, status: attempt.status, reason: attempt.reason } : null,
        closed: Boolean(closed), reservationStatus: reservation.status, settlement: applied?.result.settlement ?? null,
        dispute: applied?.result.dispute ?? null,
        evidence: {
          rules: EVIDENCE_RULES_ID, basis: applied?.result.basis ?? null, rejected,
          awaitingUntil: waiting ? new Date(toMs(reservation.service.deadline) + reservation.terms.evidence.windowMs).toISOString() : null
        }
      },
      writes
    };
  };

  const store = {
    kind: backend.kind,
    policy: activePolicy,

    ...conversions.operations,
    ...evidence.operations,
    ...createFundingRegisterOperations({
      backend, policy: activePolicy, clock, mutate, claimId, fundingAuthority, conversionInEffect: conversions.conversionInEffect
    }),

    async openAccount(input = {}) {
      assertKnownKeys(input, ['accountId', 'ownerId'], 'openAccount');
      const { accountId, ownerId } = input;
      assertId(accountId, 'accountId');
      if (!isNonEmptyString(ownerId)) fail('invalid_input', 'ownerId must name the authenticated account owner');
      const now = clock();
      return backend.runTransaction(async (tx) => {
        const existing = await tx.get('accounts', accountId);
        if (existing) {
          if (existing.ownerId !== ownerId) fail('account_exists', 'account belongs to a different owner', { accountId });
          return summarizeAccount(existing);
        }
        const account = newAccount({ accountId, ownerId, now });
        tx.create('accounts', accountId, account);
        return summarizeAccount(account);
      });
    },

    async getAccount(accountId) {
      const account = await backend.get('accounts', accountId);
      return account ? summarizeAccount(account) : null;
    },

    /**
     * Mint a lot from an explicit source reference. Earned credit needs a
     * validated-work reference plus an issuance-authority decision.
     * Subsidized, Community Access and donated credit draw the funding
     * allocation their source names in the same transaction, so the register
     * counts what each allocation issued. Purchased credit must equal its
     * price under the conversion record its source stamps. Balances carry no expiry.
     */
    async issueCredits(input = {}) {
      if ('expiresAt' in input || 'expiry' in input) {
        fail('expiry_not_permitted', 'earned and purchased balances never expire');
      }
      assertKnownKeys(input, ['accountId', 'provenance', 'amount', 'source', 'idempotencyKey'], 'issueCredits');
      const { accountId, provenance, amount, idempotencyKey } = input;
      assertId(accountId, 'accountId');
      if (!Number.isSafeInteger(amount) || amount <= 0) fail('invalid_input', 'amount must be a positive integer quantity');
      const source = validateIssuanceSource(provenance, input.source);
      if (ALLOCATED_PROVENANCE[provenance]) assertId(source.allocationId, 'source.allocationId');
      assertIdempotencyKey(idempotencyKey);
      const request = { accountId, provenance, amount, source };
      const operation = 'issueCredits';
      const prior = await lookupIdempotent({ operation, scopeId: accountId, idempotencyKey, request });
      if (prior) return prior.result;
      const issuance = await authorizeIssuance(request);
      const sourceKey = sourceClaimKey(provenance, source);
      const lotId = lotIdForSource(sourceKey);
      const sourceClaimId = claimId('issuance_source', sourceKey);
      const now = clock();
      return mutate({
        operation, scopeId: accountId, idempotencyKey, request, now,
        body: async (tx) => {
          const account = await readRequired(tx, 'accounts', accountId, 'account_not_found');
          const claim = await tx.get('claims', sourceClaimId);
          if (claim) fail('duplicate_issuance_source', 'this source reference already issued credit', { lotId: claim.lotId, sourceKey });
          const allocationWrite = await drawIssuanceAllocation(tx, { provenance, accountId, amount, source, lotId, now });
          if (provenance === 'purchased') {
            await checkStampedConversion(tx, source.conversion, { currency: source.price.currency, amountMinor: source.price.amountMinor, credits: amount, now });
          }
          const lots = applyIssue(account, { lotId, provenance, amount, now });
          const entry = appendEntry(account, { type: 'issue', amount, lots, refs: { lotId, sourceKey }, now });
          account.updatedAt = now;
          const lot = {
            schema: LOT_SCHEMA,
            lotId,
            accountId,
            originAccountId: accountId,
            parentLotId: null,
            provenance,
            quantity: amount,
            source,
            sourceKey,
            issuance,
            issuedAt: now
          };
          return {
            result: { lotId, accountId, provenance, quantity: amount, sourceKey, entrySeq: entry.seq, balance: summarizeBalance(account) },
            writes: [
              insert('claims', sourceClaimId, { kind: 'issuance_source', key: sourceKey, lotId, accountId, recordedAt: now }),
              insert('lots', lotId, lot),
              insert('journal', entry.entryId, entry),
              put('accounts', accountId, account),
              ...(allocationWrite ? [allocationWrite] : [])
            ]
          };
        }
      });
    },

    async getLot(lotId) {
      return backend.get('lots', lotId);
    },

    async createQuote(input = {}) {
      const { idempotencyKey, ...request } = input;
      assertId(request.accountId, 'accountId');
      assertIdempotencyKey(idempotencyKey);
      const operation = 'createQuote';
      const prior = await lookupIdempotent({ operation, scopeId: request.accountId, idempotencyKey, request });
      if (prior) return prior.result;
      const quoteId = request.quoteId ?? createId('quote');
      assertId(quoteId, 'quoteId', MAX_QUOTE_ID_LENGTH);
      const now = clock();
      const quote = { ...buildQuote({ ...request, quoteId }, { policy: activePolicy, now }), status: 'offered', reservationId: null, acceptedAt: null };
      return mutate({
        operation, scopeId: request.accountId, idempotencyKey, request, now,
        body: async (tx) => {
          await readRequired(tx, 'accounts', request.accountId, 'account_not_found');
          if (await tx.get('quotes', quoteId)) fail('quote_exists', 'quote id is already in use', { quoteId });
          return { result: quote, writes: [insert('quotes', quoteId, quote)] };
        }
      });
    },

    async getQuote(quoteId) {
      return backend.get('quotes', quoteId);
    },

    /**
     * Accept exactly the stored terms and hold the authorized maximum. Spending
     * authorization never adds a per-request disclosure review.
     */
    async acceptQuote(input = {}) {
      assertKnownKeys(input, ['quoteId', 'accountId', 'quoteHash', 'deviceId', 'idempotencyKey'], 'acceptQuote');
      const { quoteId, accountId, quoteHash, deviceId, idempotencyKey } = input;
      assertId(quoteId, 'quoteId', MAX_QUOTE_ID_LENGTH);
      assertId(accountId, 'accountId');
      if (!isNonEmptyString(quoteHash)) fail('invalid_input', 'quoteHash must name the accepted terms');
      if (!isNonEmptyString(deviceId)) fail('invalid_input', 'deviceId is required');
      const request = { quoteId, accountId, quoteHash, deviceId };
      const now = clock();
      return mutate({
        operation: 'acceptQuote', scopeId: accountId, idempotencyKey, request, now,
        body: async (tx) => {
          const quote = await readRequired(tx, 'quotes', quoteId, 'quote_not_found');
          const account = await readRequired(tx, 'accounts', accountId, 'account_not_found');
          if (deviceAuthority && await deviceAuthority(tx, { accountId, deviceId }) !== true) {
            fail('device_not_authorized', 'the accepting device is not active for this account', { deviceId });
          }
          if (quote.accountId !== accountId) fail('quote_account_mismatch', 'quote was issued to a different account');
          if (quote.status !== 'offered') {
            fail('quote_already_accepted', 'quote was already accepted; a replacement needs a new quote', { reservationId: quote.reservationId });
          }
          if (quote.quoteHash !== quoteHash) fail('quote_terms_mismatch', 'accepted terms differ from the stored quote');
          if (toMs(now) >= toMs(quote.terms.validUntil)) fail('quote_expired', 'quote validity window has ended', { validUntil: quote.terms.validUntil });
          if (quote.accountingVersion !== activePolicy.accountingVersion) {
            fail('accounting_version_changed', 'quote was issued under a different accounting version; request a new quote');
          }
          if (accountDeficit(account) > 0) {
            fail('account_in_deficit', 'a reversed purchase left spent credit owed; new spending is blocked', { deficit: accountDeficit(account) });
          }
          const draws = applyReserve(account, quote.pricing.maxCharge, activePolicy.lotConsumptionOrder);
          const reservation = newReservation({ quote, deviceId, draws, now });
          const writes = [];
          if (draws.length) {
            const entry = appendEntry(account, {
              type: 'reserve', amount: quote.pricing.maxCharge, lots: draws,
              refs: { quoteId, reservationId: reservation.reservationId }, now
            });
            writes.push(insert('journal', entry.entryId, entry));
          }
          account.updatedAt = now;
          Object.assign(quote, { status: 'accepted', reservationId: reservation.reservationId, acceptedAt: now, acceptedByDeviceId: deviceId });
          writes.push(
            put('quotes', quoteId, quote),
            insert('reservations', reservation.reservationId, reservation),
            put('accounts', accountId, account)
          );
          return {
            result: {
              reservationId: reservation.reservationId,
              quoteId,
              quoteHash,
              authorizedMax: reservation.authorizedMax,
              acceptedAt: now,
              expiresAt: reservation.expiresAt,
              deviceId,
              balance: summarizeBalance(account)
            },
            writes
          };
        }
      });
    },

    async bindAttempt(input = {}) {
      assertKnownKeys(input, ['reservationId', 'attemptId', 'recipients', 'idempotencyKey'], 'bindAttempt');
      const { reservationId, attemptId, recipients, idempotencyKey } = input;
      assertId(reservationId, 'reservationId');
      assertId(attemptId, 'attemptId');
      const request = { reservationId, attemptId, recipients };
      const now = clock();
      return mutate({
        operation: 'bindAttempt', scopeId: reservationId, idempotencyKey, request, now,
        body: async (tx) => {
          const reservation = await readRequired(tx, 'reservations', reservationId, 'reservation_not_found');
          const attempt = bindAttemptTransition(reservation, { attemptId, recipients, now });
          return { result: { reservationId, ...attempt }, writes: [put('reservations', reservationId, reservation)] };
        }
      });
    },

    async recordAttemptOutcome(input = {}) {
      assertKnownKeys(input, ['reservationId', 'attemptId', 'status', 'reason', 'idempotencyKey'], 'recordAttemptOutcome');
      const { reservationId, attemptId, idempotencyKey } = input;
      assertId(reservationId, 'reservationId');
      assertId(attemptId, 'attemptId');
      const request = pick(input, ['reservationId', 'attemptId', 'status', 'reason']);
      const now = clock();
      return mutate({
        operation: 'recordAttemptOutcome', scopeId: reservationId, idempotencyKey, request, now,
        body: async (tx) => {
          const reservation = await readRequired(tx, 'reservations', reservationId, 'reservation_not_found');
          const attempt = closeAttemptTransition(reservation, { ...request, now });
          return { result: { reservationId, ...attempt }, writes: [put('reservations', reservationId, reservation)] };
        }
      });
    },

    async getReservation(reservationId) {
      return backend.get('reservations', reservationId);
    },

    async listReservations({ status } = {}) {
      if (!isNonEmptyString(status)) fail('invalid_input', 'status is required');
      return backend.list('reservations', { field: 'status', value: status });
    },

    /** One account's reservations in every status, oldest acceptance first. */
    async listAccountReservations(accountId) {
      assertId(accountId, 'accountId');
      return (await backend.list('reservations', { field: 'accountId', value: accountId }))
        .sort((left, right) => toMs(left.acceptedAt) - toMs(right.acceptedAt) || left.reservationId.localeCompare(right.reservationId));
    },

    /** Apply the one economic effect of a billable event under accepted terms. */
    async settleReservation(input = {}) {
      const fields = ['reservationId', 'billableEventId', 'outcome', 'attemptId', 'metering', 'completedAt', 'reason', 'evidenceRef'];
      assertKnownKeys(input, [...fields, 'idempotencyKey'], 'settleReservation');
      const { reservationId, billableEventId, idempotencyKey } = input;
      assertId(reservationId, 'reservationId');
      assertId(billableEventId, 'billableEventId');
      if (input.attemptId !== undefined) assertId(input.attemptId, 'attemptId');
      const request = pick(input, fields);
      const now = clock();
      return mutate({
        operation: 'settleReservation', scopeId: reservationId, idempotencyKey, request, now,
        body: async (tx) => settleWithin(tx, await readRequired(tx, 'reservations', reservationId, 'reservation_not_found'), request, now)
      });
    },

    /**
     * Apply a requester's report of one route attempt under the declared
     * outcome rules (attempt-outcomes.js), in one transaction: close a failed
     * attempt, settle the reservation's one billable event, or both when no
     * retry remains, and keep the route record contributors claim against.
     * The report names no outcome, metering or charge.
     *
     * Under evidence terms (attempt-evidence.js) the report may carry the
     * requester's own evidence, and a final report becomes the reservation's
     * one decision only when it needs no evidence window: a cancellation before
     * dispatch, or a completed route whose every output is acknowledged with
     * nothing disputed. Otherwise it waits for the window, when kept evidence
     * can raise an understated report or hold an asserted remainder in dispute.
     */
    async settleAttempt(input = {}) {
      assertKnownKeys(input, ['reservationId', 'report', 'idempotencyKey'], 'settleAttempt');
      const { reservationId, idempotencyKey } = input;
      assertId(reservationId, 'reservationId');
      if (input.report?.attemptId != null) assertId(input.report.attemptId, 'report.attemptId');
      const request = { reservationId, report: cloneJson(input.report ?? null) };
      const now = clock();
      const prior = await lookupIdempotent({ operation: 'settleAttempt', scopeId: reservationId, idempotencyKey, request });
      if (prior) return prior.result;
      const { verified, rejected } = await verifyReportEvidence(reservationId, request.report, now);
      return mutate({
        operation: 'settleAttempt', scopeId: reservationId, idempotencyKey, request, now,
        body: async (tx) => {
          const reservation = await readRequired(tx, 'reservations', reservationId, 'reservation_not_found');
          assertOpenReservation(reservation, now);
          if (reservation.terms.evidence) {
            return settleReportedAttempt(tx, reservation, { report: request.report, verified, rejected, now });
          }
          if (request.report?.evidence !== undefined) fail('evidence_not_in_terms', 'the accepted quote offers report-only settlement');
          const derived = deriveAttemptOutcome({ reservation, report: request.report, now });
          if (derived.record && await tx.get('attemptRecords', derived.record.recordId)) {
            fail('attempt_already_reported', 'this route attempt already has its report', { recordId: derived.record.recordId });
          }
          const closed = derived.close ? closeAttemptTransition(reservation, { ...derived.close, now }) : null;
          let settlement = null;
          const writes = [];
          if (derived.settle) {
            const settled = await settleWithin(tx, reservation, { billableEventId: billableEventIdFor(reservationId), ...derived.settle }, now);
            settlement = settled.result;
            writes.push(...settled.writes);
          } else {
            reservation.updatedAt = now;
            writes.push(put('reservations', reservationId, reservation));
          }
          const attemptId = derived.record?.identity.attemptId ?? derived.settle?.attemptId ?? null;
          const record = derived.record ? {
            schema: ATTEMPT_RECORD_SCHEMA, ...derived.record, reservationId, quoteId: reservation.quoteId, accountId: reservation.accountId,
            attemptId, rules: ATTEMPT_OUTCOME_RULES_ID, rule: derived.rule,
            outcome: settlement?.outcome ?? null, settlementId: settlement?.settlementId ?? null, reportedAt: now
          } : null;
          if (record) writes.push(insert('attemptRecords', record.recordId, record));
          const attempt = attemptId ? reservation.attempts.find((entry) => entry.attemptId === attemptId) : null;
          return {
            result: {
              reservationId, rules: ATTEMPT_OUTCOME_RULES_ID, rule: derived.rule, recordId: record?.recordId ?? null,
              attempt: attempt ? { attemptId, attemptNumber: attempt.attemptNumber, status: attempt.status, reason: attempt.reason } : null,
              closed: Boolean(closed), reservationStatus: reservation.status, settlement
            },
            writes
          };
        }
      });
    },

    async getAttemptRecord(recordId) {
      return typeof recordId === 'string' && /^atr_[a-f0-9]{32}$/.test(recordId) ? backend.get('attemptRecords', recordId) : null;
    },

    /** The kept record of a reported route attempt, by its canonical route identity; null when none or malformed. */
    async findAttemptRecord(identity) {
      let routeHash;
      try {
        routeHash = routeHashOf(identity);
      } catch {
        return null;
      }
      const record = await backend.get('attemptRecords', attemptRecordIdFor(routeHash));
      return record?.routeHash === routeHash ? record : null;
    },

    /** Record an operational review disposition; charges come from terms fixed at acceptance. */
    async resolveQualityReview(input = {}) {
      assertKnownKeys(input, ['reviewId', 'disposition', 'reviewer', 'idempotencyKey'], 'resolveQualityReview');
      const { reviewId, idempotencyKey } = input;
      assertId(reviewId, 'reviewId');
      const request = pick(input, ['reviewId', 'disposition', 'reviewer']);
      const now = clock();
      return mutate({
        operation: 'resolveQualityReview', scopeId: reviewId, idempotencyKey, request, now,
        body: async (tx) => {
          const review = await readRequired(tx, 'reviews', reviewId, 'review_not_found');
          const reservation = await readRequired(tx, 'reservations', review.reservationId, 'reservation_not_found');
          const account = await readRequired(tx, 'accounts', reservation.accountId, 'account_not_found');
          const { charge, termKey } = decideReview(review, reservation, request);
          const reviewer = pick(request.reviewer, ['reviewerId', 'authority', 'decisionId']);
          const reversals = await readReversals(tx, reservation.draws);
          const { record, writes } = finalize({
            account,
            reservation,
            reversals,
            decision: {
              outcome: 'failed_quality',
              termKey,
              formula: reservation.terms.settlement[termKey],
              metering: review.metering,
              attempt: reservation.attempts.find((entry) => entry.attemptId === review.attemptId),
              phase: null
            },
            charge,
            input: { billableEventId: review.billableEventId, completedAt: review.completedAt, reason: review.claim.reason },
            review: { reviewId, disposition: request.disposition, procedureId: review.procedureId, ...reviewer },
            now
          });
          Object.assign(review, {
            status: 'resolved', disposition: request.disposition, reviewer, resolvedAt: now, settlementId: record.settlementId
          });
          return { result: record, writes: [put('reviews', reviewId, review), ...writes] };
        }
      });
    },

    async getQualityReview(reviewId) {
      return backend.get('reviews', reviewId);
    },

    /** Return charged credit to its original lots under a named decision authority. */
    async refundSettlement(input = {}) {
      assertKnownKeys(input, ['reservationId', 'refundId', 'amount', 'authority', 'reason', 'idempotencyKey'], 'refundSettlement');
      const { reservationId, refundId, amount, authority, idempotencyKey } = input;
      assertId(reservationId, 'reservationId');
      assertId(refundId, 'refundId');
      if (!REFUND_AUTHORITIES.includes(authority?.kind)
        || !isNonEmptyString(authority?.decisionId) || !isNonEmptyString(authority?.actorId)) {
        fail('refund_authority_required', `refunds need authority.kind (${REFUND_AUTHORITIES.join(', ')}), decisionId and actorId`);
      }
      const request = pick(input, ['reservationId', 'refundId', 'amount', 'authority', 'reason']);
      const now = clock();
      return mutate({
        operation: 'refundSettlement', scopeId: reservationId, idempotencyKey, request, now,
        body: async (tx) => {
          const reservation = await readRequired(tx, 'reservations', reservationId, 'reservation_not_found');
          const refundClaimId = claimId('refund', refundId);
          const claim = await tx.get('claims', refundClaimId);
          const account = await readRequired(tx, 'accounts', reservation.accountId, 'account_not_found');
          if (claim) fail('duplicate_refund', 'refund id was already recorded', { reservationId: claim.reservationId });
          if (reservation.status !== 'settled' || !reservation.settlement) {
            fail('refund_requires_settlement', 'only a settled charge can be refunded', { status: reservation.status });
          }
          const { settlement } = reservation;
          const reversals = await readReversals(tx, settlement.chargedLots);
          const lots = applyRefund(account, settlement.chargedLots, reservation.refunds.byLot, amount);
          const refs = { quoteId: reservation.quoteId, reservationId, settlementId: settlement.settlementId, refundId };
          const entry = appendEntry(account, { type: 'refund', amount, lots, refs, now });
          const reversalWrites = sweep(account, reversals, { cause: 'refund', refs, now });
          account.updatedAt = now;
          reservation.refunds.total += amount;
          for (const lot of lots) reservation.refunds.byLot[lot.lotId] = (reservation.refunds.byLot[lot.lotId] || 0) + lot.amount;
          reservation.refunds.refundIds.push(refundId);
          reservation.updatedAt = now;
          const record = {
            schema: REFUND_SCHEMA,
            refundId,
            reservationId,
            settlementId: settlement.settlementId,
            quoteId: reservation.quoteId,
            accountId: reservation.accountId,
            originalCharge: settlement.charge,
            amount,
            refundedTotal: reservation.refunds.total,
            lots,
            authority: pick(authority, ['kind', 'decisionId', 'actorId']),
            reason: request.reason ?? null,
            refundedAt: now
          };
          return {
            result: record,
            writes: [
              insert('claims', refundClaimId, { kind: 'refund', key: refundId, reservationId, record, recordedAt: now }),
              insert('journal', entry.entryId, entry),
              ...reversalWrites,
              put('accounts', reservation.accountId, account),
              put('reservations', reservationId, reservation)
            ]
          };
        }
      });
    },

    /**
     * Declared release rule: an open reservation past its period releases its
     * whole hold at zero charge. Reviews are not expired here.
     */
    async expireReservations({ limit = 100 } = {}) {
      const now = clock();
      const due = (await backend.list('reservations', { field: 'status', value: 'open' }))
        .filter((reservation) => isReservationExpired(reservation, now))
        .sort((left, right) => toMs(left.expiresAt) - toMs(right.expiresAt))
        .slice(0, limit);
      const results = [];
      for (const candidate of due) {
        // Under evidence terms the hold never lapses past kept evidence: its one decision runs instead.
        if (candidate.terms.evidence) {
          const decided = await evidence.decideDue(candidate.reservationId, now);
          if (decided?.code) results.push({ reservationId: decided.reservationId, outcome: null, released: 0, status: 'error', code: decided.code });
          else if (decided) results.push(decided.settlement ?? { reservationId: decided.reservationId, outcome: null, released: 0, status: decided.status });
          continue;
        }
        const record = await backend.runTransaction(async (tx) => {
          const reservation = await tx.get('reservations', candidate.reservationId);
          if (!reservation || !isReservationExpired(reservation, now)) return null;
          const account = await readRequired(tx, 'accounts', reservation.accountId, 'account_not_found');
          const reversals = await readReversals(tx, reservation.draws);
          const { record: settlement, writes } = finalize({
            account,
            reservation,
            reversals,
            decision: { outcome: 'expired', termKey: null, formula: null, metering: {}, attempt: null, phase: null },
            charge: 0,
            input: null,
            review: null,
            now
          });
          applyWrites(tx, writes);
          return settlement;
        });
        if (record) results.push(record);
      }
      return results;
    },

    /**
     * Refund or chargeback of a purchased lot: remove its unspent balance and
     * apply the declared spent-credit treatment to what was already spent.
     * Held credit resolves when its reservation settles. One reversal per lot.
     */
    async reverseIssuance(input = {}) {
      assertKnownKeys(input, ['lotId', 'reversalId', 'kind', 'authority', 'reason', 'idempotencyKey'], 'reverseIssuance');
      const { lotId, reversalId, kind, authority, idempotencyKey } = input;
      assertId(lotId, 'lotId');
      assertId(reversalId, 'reversalId');
      const treatment = reversalTreatment(activeReversalPolicy, kind, authority);
      const request = pick(input, ['lotId', 'reversalId', 'kind', 'authority', 'reason']);
      const now = clock();
      return mutate({
        operation: 'reverseIssuance', scopeId: lotId, idempotencyKey, request, now,
        body: async (tx) => {
          const lot = await readRequired(tx, 'lots', lotId, 'lot_not_found');
          const existing = await tx.get('reversals', lotId);
          const account = await readRequired(tx, 'accounts', lot.accountId, 'account_not_found');
          if (existing) fail('duplicate_reversal', 'this lot was already reversed', { reversalId: existing.reversalId });
          if (!REVERSIBLE_PROVENANCE.includes(lot.provenance)) {
            fail('reversal_not_permitted', `only ${REVERSIBLE_PROVENANCE.join(', ')} lots can be refunded or charged back`, { provenance: lot.provenance });
          }
          const reversal = newReversal({ lot, reversalId, kind, authority, treatment, reason: request.reason, now });
          const { swept } = sweepReversedLots(account, { [lotId]: reversal }, { cause: kind, ref: { reversalId }, now });
          const entry = appendEntry(account, {
            type: 'reverse', amount: swept.reduce((sum, lot) => sum + lot.amount, 0), lots: swept,
            refs: { lotId, reversalId, kind }, now
          });
          account.updatedAt = now;
          return {
            result: { ...reversal, entrySeq: entry.seq, balance: summarizeBalance(account), deficit: accountDeficit(account) },
            writes: [
              insert('reversals', lotId, reversal),
              insert('journal', entry.entryId, entry),
              put('accounts', lot.accountId, account)
            ]
          };
        }
      });
    },

    async getReversal(lotId) {
      return backend.get('reversals', lotId);
    },

    /** Transferable lots keep provenance and parentage, but transfers are not activated. */
    async transferCredits() {
      fail('transfers_disabled', 'account transfers are not activated; activation requires approved transfer qualification');
    },

    async listJournal(accountId) {
      const entries = await backend.list('journal', { field: 'accountId', value: accountId });
      return entries.sort((left, right) => left.seq - right.seq);
    },

    /** Rebuild balances from the journal and compare them with the stored projection. */
    async auditAccount(accountId) {
      const account = await backend.get('accounts', accountId);
      if (!account) fail('account_not_found', `account ${accountId} was not found`);
      const entries = (await store.listJournal(accountId)).filter((entry) => entry.seq <= account.sequence);
      const replayed = replayJournal(entries, { accountId });
      return {
        accountId,
        sequence: account.sequence,
        journalEntries: entries.length,
        consistent: replayed.sequence === account.sequence
          && canonicalJson(replayed.totals) === canonicalJson(account.totals)
          && canonicalJson(replayed.lots) === canonicalJson(account.lots)
      };
    },

    /** Balances, reservations and subsidy, plus the funding register's commitments and allocations. */
    async getSolvencySnapshot() {
      const now = clock();
      const [accounts, open, underReview, disputed, commitments, allocations] = await Promise.all([
        backend.list('accounts'),
        backend.list('reservations', { field: 'status', value: 'open' }),
        backend.list('reservations', { field: 'status', value: 'under_review' }),
        backend.list('reservations', { field: 'status', value: 'disputed' }),
        backend.list('commitments'),
        backend.list('allocations')
      ]);
      return {
        ...summarizeSolvency({ accounts, reservations: [...open, ...underReview, ...disputed], policy: activePolicy, now }),
        funding: summarizeFunding({ commitments, allocations, now })
      };
    }
  };
  return store;
}

export default createLedgerStore;
