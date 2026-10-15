/**
 * @fileoverview Ledger operations over attempt evidence (attempt-evidence.js):
 * keeping verified stage receipts and requester acknowledgments, the one
 * decision per reservation they support, and operational resolution of a
 * disputed remainder.
 *
 * Keeping evidence has no economic effect. A decision runs once per
 * reservation, from a report that needs no evidence window, from the sweep
 * after the window, or at expiry, and commits its billable event, charge,
 * dispute hold, release and journal entries in one transaction. A dispute is
 * resolved only by operational review, from charges fixed when it opened.
 */

import { ATTEMPT_OUTCOME_RULES_ID, ATTEMPT_RECORD_SCHEMA, attemptRecordIdFor, billableEventIdFor } from './attempt-outcomes.js';
import {
  DISPUTE_DISPOSITIONS,
  EVIDENCE_RULES_ID,
  decideFromEvidence,
  disputeIdForReservation,
  evidenceIdFor,
  evidenceWindowClosed,
  mergeAttemptEvidence,
  newDispute,
  verifyAttemptEvidence
} from './attempt-evidence.js';
import { REVIEW_AUTHORITY, assertId, assertIdempotencyKey, cloneJson, evaluateFormula, fail, isNonEmptyString, toMs } from './domain.js';
import { appendEntry, applySettle, buildSettlementRecord, decideSettlement, mergeDraws, settlementIdForReservation } from './transitions.js';

const insert = (collection, id, value) => ({ create: true, collection, id, value });
const put = (collection, id, value) => ({ create: false, collection, id, value });
const TERM_KEYS = Object.freeze({ full: 'full', partial_delivery: 'partialDelivery', cancellation: 'cancellationDispatched', timeout: 'timeout', provider_failure: 'providerFailure' });

const evidenceView = (record) => ({
  evidenceId: record.evidenceId,
  reservationId: record.reservationId,
  attemptId: record.attemptId,
  routeHash: record.routeHash,
  stages: Object.fromEntries(Object.entries(record.stages).map(([index, stage]) => [index, {
    participantId: stage.participantId, sequence: stage.sequence, status: stage.status, steps: stage.steps, output: stage.output
  }])),
  acknowledged: record.acknowledged ? { count: record.acknowledged.count, signedAt: record.acknowledged.acknowledgment.signedAt } : null,
  conflicts: record.conflicts,
  updatedAt: record.updatedAt
});

/**
 * @param {object} ctx ledger internals: backend, clock, mutate, claimId, readRequired,
 *   readReversals, sweep (reversal sweep), applyWrites and the signerAuthority port
 */
export function createEvidenceOperations({ backend, clock, mutate, claimId, readRequired, readReversals, sweep, applyWrites, signerAuthority }) {
  const signerAt = (query) => {
    if (typeof signerAuthority !== 'function') fail('evidence_authority_required', 'evidence verification needs the signer-registration port');
    return signerAuthority(query);
  };

  const readRecords = async (tx, reservation) => {
    const records = new Map();
    for (const attempt of reservation.attempts) {
      const record = await tx.get('attemptEvidence', evidenceIdFor(reservation.reservationId, attempt.attemptId));
      if (record) records.set(attempt.attemptId, record);
    }
    return records;
  };

  /**
   * Apply one decision inside the caller's transaction (reads precede the
   * returned writes): charge the acknowledged outcome, hold any disputed
   * remainder, release the rest, and keep the decided attempt's record.
   * `newRecord` is an attempt record the caller inserts in this transaction.
   */
  const applyDecisionWithin = async (tx, reservation, decision, records, now, { newRecord = null } = {}) => {
    const { reservationId } = reservation;
    const billableEventId = billableEventIdFor(reservationId);
    const eventClaimId = claimId('billable_event', billableEventId);
    const claim = await tx.get('claims', eventClaimId);
    const account = await readRequired(tx, 'accounts', reservation.accountId, 'account_not_found');
    const reversals = await readReversals(tx, reservation.draws);
    const attemptId = decision.settle?.attemptId ?? decision.dispute?.asserted?.attemptId ?? null;
    const evidenceRecord = attemptId ? records.get(attemptId) ?? null : null;
    const recordId = newRecord?.attemptId === attemptId ? newRecord.recordId
      : reservation.report?.attemptId === attemptId && reservation.report.recordId ? reservation.report.recordId
        : evidenceRecord ? attemptRecordIdFor(evidenceRecord.routeHash) : null;
    const stored = recordId && recordId !== newRecord?.recordId ? await tx.get('attemptRecords', recordId) : null;
    if (claim) fail('billable_event_already_settled', 'billable event already has its economic effect', { reservationId: claim.reservationId });
    const settlementId = settlementIdForReservation(reservationId);
    const refs = { quoteId: reservation.quoteId, reservationId, settlementId, billableEventId };
    const writes = [];
    const hold = decision.dispute?.held ?? 0;
    let decided = null;
    let charge = 0;
    if (decision.settle) {
      decided = decideSettlement(reservation, { billableEventId, ...decision.settle }, now, { evidence: decision.basis !== 'report', pastPeriod: true });
      charge = evaluateFormula(decided.formula, decided.metering, reservation.rounding);
    }
    const { charged, released, held } = applySettle(account, reservation.draws, charge, hold);
    if (charge > 0) writes.push(appendEntry(account, { type: 'charge', amount: charge, lots: charged, refs, now }));
    const releasedAmount = reservation.authorizedMax - charge - hold;
    if (releasedAmount > 0) writes.push(appendEntry(account, { type: 'release', amount: releasedAmount, lots: released, refs, now }));
    const journal = writes.splice(0).map((entry) => insert('journal', entry.entryId, entry));
    const disputeView = hold > 0 ? { disputeId: disputeIdForReservation(reservationId), held: hold, status: 'pending_review' } : null;
    const nothing = !decided && !disputeView;
    const settlement = decided || nothing ? {
      ...buildSettlementRecord(nothing
        ? { reservation, outcome: 'expired', termKey: null, formula: null, metering: {}, attempt: null, phase: null, charge: 0, charged, released, input: null, review: null, now }
        : { reservation, ...decided, charge, charged, released, input: { billableEventId, ...decision.settle }, review: null, now }),
      released: releasedAmount, basis: decision.basis, rules: EVIDENCE_RULES_ID, evidenceIds: decision.evidenceIds, dispute: disputeView
    } : null;
    if (!nothing) {
      reservation.billableEventId = billableEventId;
      writes.push(insert('claims', eventClaimId, { kind: 'billable_event', key: billableEventId, reservationId, settlementId, recordedAt: now }));
    }
    if (decided?.attempt?.status === 'bound') {
      Object.assign(reservation.attempts.find((entry) => entry.attemptId === decided.attempt.attemptId), { status: 'settled', closedAt: now });
    }
    Object.assign(reservation, {
      status: nothing ? 'expired' : disputeView ? 'disputed' : 'settled', settlement, dispute: disputeView, updatedAt: now
    });
    account.updatedAt = now;
    if (disputeView) {
      const dispute = newDispute({ reservation, decision, held: hold, draws: held, now });
      writes.push(insert('disputes', dispute.disputeId, { ...dispute, attemptRecordId: recordId }));
    }
    const decidedFields = { outcome: settlement?.outcome ?? null, settlementId: settlement?.settlementId ?? null, basis: decision.basis,
      evidenceId: evidenceRecord?.evidenceId ?? null, decidedAt: now };
    if (newRecord) {
      writes.push(insert('attemptRecords', newRecord.recordId, newRecord.attemptId === attemptId ? { ...newRecord, ...decidedFields } : newRecord));
    }
    if (recordId && recordId !== newRecord?.recordId) {
      const base = stored ?? (evidenceRecord ? {
        schema: ATTEMPT_RECORD_SCHEMA, routeHash: evidenceRecord.routeHash, recordId, identity: cloneJson(evidenceRecord.identity), result: null,
        reservationId, quoteId: reservation.quoteId, accountId: reservation.accountId, attemptId, rules: ATTEMPT_OUTCOME_RULES_ID, rule: null, reportedAt: null
      } : null);
      if (base) writes.push(put('attemptRecords', recordId, { ...base, ...decidedFields }));
    }
    return {
      result: { reservationId, status: reservation.status, basis: decision.basis, settlement, dispute: disputeView },
      writes: [...journal, ...sweep(account, reversals, { cause: 'settlement', refs, now }), ...writes,
        put('accounts', account.accountId, account), put('reservations', reservationId, reservation)]
    };
  };

  /**
   * Decide one open evidence-terms reservation whose window has closed, in its
   * own transaction. A coded refusal is returned, not thrown, so one
   * reservation never stalls a sweep; it stays open and is retried.
   */
  const decideDue = (reservationId, now) => backend.runTransaction(async (tx) => {
    const reservation = await tx.get('reservations', reservationId);
    if (reservation?.status !== 'open' || !reservation.terms.evidence || !evidenceWindowClosed(reservation, now)) return null;
    const records = await readRecords(tx, reservation);
    const { result, writes } = await applyDecisionWithin(tx, reservation, decideFromEvidence({ reservation, records, now }), records, now);
    applyWrites(tx, writes);
    return result;
  }).catch((error) => {
    if (error?.name !== 'LedgerError' || error.retryable) throw error;
    return { reservationId, status: 'error', code: error.code };
  });

  return {
    readRecords,
    applyDecisionWithin,
    decideDue,

    operations: {
      /**
       * Keep a party's evidence of one bound attempt. `submitter` is the
       * authenticated device { accountId, deviceId, participantId }: the
       * reservation's accepting device or a bound recipient of the attempt.
       * Verified items merge into the attempt's record; re-submitting kept
       * evidence changes nothing. No economic effect.
       */
      async recordAttemptEvidence(input = {}) {
        const unknown = Object.keys(input).filter((key) => !['evidence', 'submitter', 'idempotencyKey'].includes(key));
        if (unknown.length) fail('invalid_input', `recordAttemptEvidence does not accept: ${unknown.join(', ')}`);
        const { evidence, submitter, idempotencyKey } = input;
        assertIdempotencyKey(idempotencyKey);
        if (!isNonEmptyString(submitter?.deviceId) || !isNonEmptyString(submitter?.participantId)) {
          fail('invalid_input', 'submitter must name the authenticated device and its participant');
        }
        const reservationId = assertId(evidence?.reservationId, 'evidence.reservationId');
        const reservation = await backend.get('reservations', reservationId);
        const attempt = reservation?.attempts.find((entry) => entry.attemptId === evidence.attemptId);
        // Only the parties to an attempt learn that its reservation exists.
        if (!reservation || !(submitter.deviceId === reservation.deviceId || attempt?.recipients.includes(submitter.participantId))) {
          fail('reservation_not_found', 'no reservation of an attempt this device took part in has this id');
        }
        if (!reservation.terms.evidence) fail('evidence_not_in_terms', 'the accepted quote offers report-only settlement');
        const now = clock();
        const verified = await verifyAttemptEvidence({ bundle: evidence, reservation, signerAt, now });
        const request = { reservationId, evidence: cloneJson(evidence) };
        return mutate({
          operation: 'recordAttemptEvidence', scopeId: reservationId, idempotencyKey, request, now,
          body: async (tx) => {
            const current = await tx.get('attemptEvidence', evidenceIdFor(reservationId, verified.attemptId));
            const fresh = await readRequired(tx, 'reservations', reservationId, 'reservation_not_found');
            const { record, changed } = mergeAttemptEvidence(current, verified, { reservation: fresh, submitter, now });
            return {
              result: { ...evidenceView(record), changed, rejected: verified.rejected, reservationStatus: fresh.status },
              writes: changed ? [put('attemptEvidence', record.evidenceId, record)] : []
            };
          }
        });
      },

      /** The kept evidence record of one attempt, or null. */
      async getAttemptEvidence({ reservationId, attemptId } = {}) {
        if (!isNonEmptyString(reservationId) || !isNonEmptyString(attemptId)) return null;
        return backend.get('attemptEvidence', evidenceIdFor(reservationId, attemptId));
      },

      /**
       * Declared window rule: an open evidence-terms reservation past its
       * deadline plus evidence window gets its one decision from its report,
       * if any, and the evidence kept so far.
       */
      async settleDueEvidence({ limit = 100 } = {}) {
        const now = clock();
        const due = (await backend.list('reservations', { field: 'status', value: 'open' }))
          .filter((reservation) => reservation.terms.evidence && evidenceWindowClosed(reservation, now))
          .sort((left, right) => toMs(left.service.deadline) - toMs(right.service.deadline))
          .slice(0, limit);
        const results = [];
        for (const candidate of due) {
          const result = await decideDue(candidate.reservationId, now);
          if (result) results.push(result);
        }
        // Refusals stay listed with their code; their reservations stay open for the next pass.
        return results;
      },

      /** Operational review of a disputed remainder; charges come from the dispute as opened. */
      async resolveDispute(input = {}) {
        const unknown = Object.keys(input).filter((key) => !['disputeId', 'disposition', 'reviewer', 'idempotencyKey'].includes(key));
        if (unknown.length) fail('invalid_input', `resolveDispute does not accept: ${unknown.join(', ')}`);
        const { disputeId, disposition, reviewer, idempotencyKey } = input;
        assertId(disputeId, 'disputeId');
        const request = { disputeId, disposition, reviewer: cloneJson(reviewer ?? null) };
        const now = clock();
        return mutate({
          operation: 'resolveDispute', scopeId: disputeId, idempotencyKey, request, now,
          body: async (tx) => {
            const dispute = await readRequired(tx, 'disputes', disputeId, 'dispute_not_found');
            const reservation = await readRequired(tx, 'reservations', dispute.reservationId, 'reservation_not_found');
            const account = await readRequired(tx, 'accounts', reservation.accountId, 'account_not_found');
            const reversals = await readReversals(tx, dispute.draws);
            const stored = dispute.attemptRecordId ? await tx.get('attemptRecords', dispute.attemptRecordId) : null;
            if (dispute.status !== 'pending_review') fail('dispute_already_resolved', 'the dispute already has a disposition');
            if (reservation.status !== 'disputed') fail('ledger_invariant_violation', 'the disputed reservation is not held in dispute');
            if (reviewer?.authority !== REVIEW_AUTHORITY || !isNonEmptyString(reviewer.reviewerId) || !isNonEmptyString(reviewer.decisionId)) {
              fail('review_authority_required', 'disputes need an operational review decision, never automatic adjudication');
            }
            if (!DISPUTE_DISPOSITIONS.includes(disposition)) fail('invalid_input', `disposition must be one of ${DISPUTE_DISPOSITIONS.join(', ')}`);
            const extra = dispute.dispositionCharges[disposition];
            const { charged, released } = applySettle(account, dispute.draws, extra);
            const settlementId = settlementIdForReservation(reservation.reservationId);
            const refs = { quoteId: reservation.quoteId, reservationId: reservation.reservationId, settlementId, billableEventId: dispute.billableEventId, disputeId };
            const entries = [];
            if (extra > 0) entries.push(appendEntry(account, { type: 'charge', amount: extra, lots: charged, refs, now }));
            if (dispute.held - extra > 0) entries.push(appendEntry(account, { type: 'release', amount: dispute.held - extra, lots: released, refs, now }));
            const base = reservation.settlement;
            const total = (base?.charge ?? 0) + extra;
            const reviewed = { reviewerId: reviewer.reviewerId, authority: reviewer.authority, decisionId: reviewer.decisionId };
            const resolution = { disputeId, held: dispute.held, status: 'resolved', disposition, charged: extra, released: dispute.held - extra, reviewer: reviewed, resolvedAt: now };
            let outcome;
            if (disposition === 'asserted') {
              const { asserted } = dispute;
              const termKey = TERM_KEYS[asserted.outcome];
              outcome = buildSettlementRecord({
                reservation, outcome: asserted.outcome, termKey, formula: reservation.terms.settlement[termKey], metering: asserted.metering,
                attempt: reservation.attempts.find((entry) => entry.attemptId === asserted.attemptId) ?? null,
                phase: asserted.outcome === 'cancellation' ? 'dispatched' : null, charge: total,
                charged: mergeDraws(base?.chargedLots ?? [], charged), released: mergeDraws(base?.releasedLots ?? [], released),
                input: { billableEventId: dispute.billableEventId, completedAt: asserted.completedAt ?? null }, review: null, now
              });
            } else {
              outcome = base ? { ...base, releasedLots: mergeDraws(base.releasedLots, released), settledAt: now }
                : buildSettlementRecord({ reservation, outcome: 'unacknowledged', termKey: null, formula: null, metering: {}, attempt: null, phase: null,
                  charge: 0, charged: [], released, input: { billableEventId: dispute.billableEventId }, review: null, now });
            }
            const settlement = { ...outcome, released: reservation.authorizedMax - total, basis: base?.basis ?? 'evidence', rules: EVIDENCE_RULES_ID,
              evidenceIds: dispute.evidenceIds, dispute: resolution };
            const attempt = settlement.attempt ? reservation.attempts.find((entry) => entry.attemptId === settlement.attempt.attemptId) : null;
            if (attempt?.status === 'bound') Object.assign(attempt, { status: 'settled', closedAt: now });
            Object.assign(reservation, { status: 'settled', settlement, dispute: resolution, updatedAt: now });
            account.updatedAt = now;
            Object.assign(dispute, { status: 'resolved', disposition, reviewer: reviewed, resolvedAt: now, settlementId });
            return {
              result: settlement,
              writes: [
                ...entries.map((entry) => insert('journal', entry.entryId, entry)),
                ...sweep(account, reversals, { cause: 'settlement', refs, now }),
                put('disputes', disputeId, dispute),
                put('accounts', account.accountId, account),
                put('reservations', reservation.reservationId, reservation),
                ...(stored ? [put('attemptRecords', stored.recordId, { ...stored, outcome: settlement.outcome, settlementId, decidedAt: now })] : [])
              ]
            };
          }
        });
      },

      async getDispute(disputeId) {
        return typeof disputeId === 'string' ? backend.get('disputes', disputeId) : null;
      },

      async listDisputes({ status = 'pending_review' } = {}) {
        if (!isNonEmptyString(status)) fail('invalid_input', 'status is required');
        return (await backend.list('disputes', { field: 'status', value: status })).sort((left, right) => toMs(left.openedAt) - toMs(right.openedAt));
      }
    }
  };
}

export default createEvidenceOperations;
