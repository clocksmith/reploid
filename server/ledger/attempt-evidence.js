/**
 * @fileoverview Declared evidence rules: signed stage receipts and requester
 * acknowledgments of one bound route attempt, and the settlement they support
 * when the requester's report is missing, provisional or understated.
 *
 * A stage receipt counts only when a bound recipient signed it for this
 * reservation, attempt and route, with the participant key registered at its
 * signing time, inside the attempt's binding window. An acknowledgment counts
 * only when the accepting device's participant signed it, and only for the
 * outputs whose final-stage receipt commits to the same count and chain.
 * Acknowledged work is chargeable; work the receipts assert beyond it is held
 * in dispute for operational review, never charged or released automatically.
 * Signatures establish who asserted what, not honest or correct computation.
 */

import { canonicalRouteAttemptBinding } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import {
  ATTEMPT_EVIDENCE_SCHEMA,
  checkAttemptEvidenceBundle,
  verifyOutputAcknowledgment,
  verifyStageReceipt
} from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { routeHashOf } from './attempt-outcomes.js';
import { EVIDENCE_RULES_ID, cloneJson, evaluateFormula, fail, hashCanonical, isIsoTime, sha256Hex, toMs } from './domain.js';

export { EVIDENCE_RULES_ID };
export const EVIDENCE_RECORD_SCHEMA = 'reploid.attempt-evidence-record/v1';
export const DISPUTE_SCHEMA = 'reploid.credit-dispute/v1';
export const DISPUTE_DISPOSITIONS = Object.freeze(['acknowledged', 'asserted']);
// Storage bounds on one record, not policy: distinct submitting parties and recorded conflicts.
const MAX_SUBMITTERS = 16;
const MAX_CONFLICTS = 32;

/** The rules as data, named by every evidence record, settlement and dispute. */
export const EVIDENCE_RULES = Object.freeze({
  id: EVIDENCE_RULES_ID,
  signed: 'a stage receipt counts when a bound recipient signed it for this reservation, attempt and route with its key registered at the signing time, inside the attempt window; an acknowledgment counts when the accepting device signed it',
  paired: 'an acknowledgment proves the outputs it names only with the final-stage receipt committing the same count and chain',
  acknowledged: 'a route the final stage completed and the requester acknowledged in full settles as full by the deadline, else timeout; otherwise the report rule applies with its output raised to the acknowledged count; with no report, acknowledged outputs settle as partial delivery; failed attempts charge nothing unless completed and acknowledged',
  asserted: 'receipts beyond the acknowledged outputs are priced by the same rule as if acknowledged; the difference is held in dispute within the authorized maximum',
  dispute: 'operational review charges the held difference (asserted) or releases it (acknowledged); nothing acknowledged and released settles as unacknowledged at zero charge',
  window: 'a report settles at once when it cancels before dispatch, or when every output of a completed route is acknowledged and nothing is disputed; otherwise the decision waits for the declared evidence window after the deadline',
  single: 'one decision per reservation across the report and evidence paths; later evidence is kept without economic effect'
});

const OUTCOME_TERM_KEYS = Object.freeze({
  full: 'full', partial_delivery: 'partialDelivery', cancellation: 'cancellationDispatched', timeout: 'timeout', provider_failure: 'providerFailure'
});

export const evidenceIdFor = (reservationId, attemptId) => `aev_${sha256Hex(`${reservationId}\u0000${attemptId}`).slice(0, 32)}`;
export const disputeIdForReservation = (reservationId) => `dsp:${reservationId}`;

export const evidenceWindowClosed = (reservation, now) => toMs(now) >= toMs(reservation.service.deadline) + reservation.terms.evidence.windowMs;

/**
 * Verify one submitted bundle against the reservation's bound attempt and the
 * signers' registrations. Items that fail are listed, not kept; a bundle with
 * nothing verifiable is refused.
 *
 * @param {Function} signerAt ({ participantId, at }) -> { accountId, deviceId, registrationId, publicJwk } | null:
 *   the registration of `participantId` in force at `at`, even if revoked since
 */
export async function verifyAttemptEvidence({ bundle, reservation, signerAt, now }) {
  const shape = checkAttemptEvidenceBundle(bundle);
  if (shape) fail('invalid_evidence', `evidence must be a ${ATTEMPT_EVIDENCE_SCHEMA} bundle`);
  if (bundle.reservationId !== reservation.reservationId) fail('evidence_mismatch', 'the evidence names a different reservation');
  const attempt = reservation.attempts.find((entry) => entry.attemptId === bundle.attemptId);
  if (!attempt) fail('attempt_not_bound', 'the evidence names an attempt not bound to this reservation', { attemptId: bundle.attemptId });
  const identity = canonicalRouteAttemptBinding(bundle.identity);
  const { stages } = identity.route;
  if (stages.some((stage) => !attempt.recipients.includes(stage.participantId)) || identity.route.modelId !== reservation.service.model.modelId) {
    fail('evidence_mismatch', 'the route is not the bound attempt\'s recipients and quoted model');
  }
  const requester = await signerAt({ participantId: identity.requesterId, at: attempt.boundAt });
  if (requester?.deviceId !== reservation.deviceId) fail('evidence_mismatch', 'the route requester is not the reservation\'s accepting device');
  const routeHash = routeHashOf(identity);
  const skewMs = reservation.terms.evidence.clockSkewMs;
  const inWindow = (at) => isIsoTime(at) && toMs(at) >= toMs(attempt.boundAt) - skewMs && toMs(at) <= toMs(now) + skewMs;
  const rejected = [];

  const checkReceipt = async (receipt) => {
    const body = receipt && typeof receipt === 'object' ? receipt : {};
    const stage = stages[body.partitionIndex];
    if (body.reservationId !== reservation.reservationId || body.attemptId !== attempt.attemptId || body.routeHash !== routeHash
      || !stage || body.participantId !== stage.participantId || (body.output === null) === (stage.index === stages.length - 1)) {
      return { problem: 'receipt_binding_mismatch' };
    }
    if (!inWindow(body.signedAt)) return { problem: 'receipt_time_outside_attempt' };
    const signer = await signerAt({ participantId: body.participantId, at: body.signedAt });
    if (!signer) return { problem: 'signer_not_registered' };
    const checked = await verifyStageReceipt(receipt, { publicJwk: signer.publicJwk });
    if (!checked.ok) return { problem: checked.problem };
    return { verified: { partitionIndex: body.partitionIndex, sequence: body.sequence, digest: hashCanonical(receipt), receipt: cloneJson(receipt),
      signer: { accountId: signer.accountId, deviceId: signer.deviceId, registrationId: signer.registrationId } } };
  };

  const receipts = [];
  for (const receipt of bundle.receipts.slice(0, stages.length * 2)) {
    const { verified, problem } = await checkReceipt(receipt);
    if (verified) receipts.push(verified);
    else rejected.push({ item: `receipt:${receipt?.partitionIndex ?? 'unknown'}`, problem });
  }
  if (bundle.receipts.length > stages.length * 2) rejected.push({ item: 'receipts', problem: 'too_many_receipts' });

  let acknowledged = null;
  if (bundle.acknowledged) {
    const { acknowledgment: ack, receipt } = bundle.acknowledged;
    let problem = null;
    if (ack?.reservationId !== reservation.reservationId || ack.attemptId !== attempt.attemptId || ack.routeHash !== routeHash
      || ack.requesterId !== identity.requesterId || !Number.isSafeInteger(ack.count) || ack.count < 1) problem = 'acknowledgment_binding_mismatch';
    else if (!inWindow(ack.signedAt)) problem = 'acknowledgment_time_outside_attempt';
    let signer = null;
    if (!problem) {
      signer = await signerAt({ participantId: ack.requesterId, at: ack.signedAt });
      if (signer?.deviceId !== reservation.deviceId) problem = 'acknowledgment_not_from_accepting_device';
    }
    if (!problem) {
      const checked = await verifyOutputAcknowledgment(ack, { publicJwk: signer.publicJwk });
      if (!checked.ok) problem = checked.problem;
    }
    const paired = problem ? null : await checkReceipt(receipt);
    if (!problem && !paired.verified) problem = `paired_${paired.problem}`;
    if (!problem && (paired.verified.partitionIndex !== stages.length - 1
      || receipt.output.count !== ack.count || receipt.output.chain !== ack.chain)) problem = 'acknowledgment_mismatch';
    if (problem) rejected.push({ item: 'acknowledgment', problem });
    else {
      receipts.push(paired.verified);
      acknowledged = { count: ack.count, chain: ack.chain, digest: hashCanonical(ack), acknowledgment: cloneJson(ack), receipt: cloneJson(receipt),
        signer: { accountId: signer.accountId, deviceId: signer.deviceId, registrationId: signer.registrationId } };
    }
  }
  if (!receipts.length && !acknowledged) {
    if (!rejected.length) fail('invalid_evidence', 'evidence names no stage receipt or acknowledgment');
    fail('evidence_rejected', 'no submitted receipt or acknowledgment verifies', { reasons: rejected.map(({ item, problem }) => `${item}:${problem}`) });
  }
  return { attemptId: attempt.attemptId, identity: cloneJson(identity), routeHash, receipts, acknowledged, rejected };
}

const stageView = ({ receipt, sequence, digest, signer }) => {
  const { publicJwk: _key, signature: _signature, ...body } = receipt;
  return { participantId: body.participantId, sequence, status: body.status, steps: body.steps, tokens: body.tokens,
    timing: body.timing, output: body.output, signedAt: body.signedAt, digest, signer, receipt };
};

/**
 * Merge verified evidence into the attempt's record: per stage the receipt
 * with the highest sequence, the acknowledgment with the highest count.
 * Re-submitting what is kept changes nothing. Two different signed records at
 * the same stage sequence, or two acknowledgments of the same count with
 * different chains, are recorded as conflicts and the first stays.
 */
export function mergeAttemptEvidence(existing, verified, { reservation, submitter, now }) {
  const record = existing ? cloneJson(existing) : {
    schema: EVIDENCE_RECORD_SCHEMA, rules: EVIDENCE_RULES_ID, evidenceId: evidenceIdFor(reservation.reservationId, verified.attemptId),
    reservationId: reservation.reservationId, attemptId: verified.attemptId, routeHash: verified.routeHash, identity: verified.identity,
    stages: {}, acknowledged: null, conflicts: [], submitters: [], createdAt: now, updatedAt: now
  };
  if (record.routeHash !== verified.routeHash) fail('evidence_conflict', 'evidence for this attempt names a different route');
  let changed = !existing;
  const conflict = (entry) => {
    if (record.conflicts.length < MAX_CONFLICTS
      && !record.conflicts.some((row) => row.kind === entry.kind && row.partitionIndex === entry.partitionIndex && row.at === entry.at)) {
      record.conflicts.push({ ...entry, recordedAt: now });
      changed = true;
    }
  };
  for (const item of verified.receipts) {
    const key = String(item.partitionIndex);
    const current = record.stages[key];
    if (!current || item.sequence > current.sequence) {
      record.stages[key] = stageView(item);
      changed = true;
    } else if (item.sequence === current.sequence && item.digest !== current.digest) {
      conflict({ kind: 'stage', partitionIndex: item.partitionIndex, at: item.sequence });
    }
  }
  const ack = verified.acknowledged;
  if (ack) {
    const current = record.acknowledged;
    if (!current || ack.count > current.count) {
      record.acknowledged = ack;
      changed = true;
    } else if (ack.count === current.count && ack.chain !== current.chain) {
      conflict({ kind: 'acknowledgment', partitionIndex: null, at: ack.count });
    }
  }
  if (submitter?.participantId && !record.submitters.includes(submitter.participantId) && record.submitters.length < MAX_SUBMITTERS) {
    record.submitters.push(submitter.participantId);
    changed = true;
  }
  if (changed) record.updatedAt = now;
  return { record, changed };
}

/** What one attempt's evidence proves: acknowledged count, asserted count and the route's completion. */
function attemptFacts(attempt, record, limits) {
  const cap = (value) => Math.min(value, limits.output.max);
  if (!record) return { attempt, acknowledged: 0, asserted: 0, done: null, context: null, evidenceId: null };
  const last = record.identity.route.stages.length - 1;
  const conflicted = record.conflicts.some((row) => row.kind === 'stage' && row.partitionIndex === last);
  const finalStage = conflicted ? null : record.stages[String(last)];
  const pairBody = record.acknowledged?.receipt ?? null;
  const acknowledged = cap(record.acknowledged?.count ?? 0);
  const asserted = cap(Math.max(finalStage?.output?.count ?? 0, acknowledged));
  // Completion is the final stage's own signed statement; its last step time is the route's completion time.
  const doneReceipt = [pairBody, finalStage].find((receipt) => receipt?.output?.done === true && receipt.output.count <= limits.output.max) ?? null;
  const prompt = pairBody?.tokens?.prompt ?? finalStage?.tokens?.prompt ?? null;
  return {
    attempt, acknowledged, asserted, evidenceId: record.evidenceId,
    done: doneReceipt ? { count: doneReceipt.output.count, at: doneReceipt.timing.lastStepAt ?? doneReceipt.signedAt } : null,
    context: Number.isSafeInteger(prompt) && limits.context ? Math.min(prompt, limits.context.max) : null
  };
}

const withContext = (metering, context) => (context === null ? metering : { ...metering, context });

/** The outcome the rules give `outputs` acknowledged outputs of one attempt, or null when it charges nothing. */
function outcomeFor(facts, outputs, report, reservation, now) {
  const deadlineMs = toMs(reservation.service.deadline);
  if (outputs > 0 && facts.done && outputs === facts.done.count) {
    const completedMs = Math.min(Math.max(toMs(facts.done.at), toMs(facts.attempt.boundAt)), toMs(now));
    return completedMs <= deadlineMs
      ? { outcome: 'full', metering: withContext({ output: outputs }, facts.context), completedAt: new Date(completedMs).toISOString(), complete: true }
      : { outcome: 'timeout', metering: {}, complete: true };
  }
  const reported = report?.settle?.metering?.output ?? 0;
  switch (report?.rule ?? (facts.attempt.status === 'failed' ? 'execution_failed' : null)) {
    case 'completed':
      return { outcome: 'full', metering: { ...report.settle.metering, output: Math.max(outputs, reported) }, completedAt: report.settle.completedAt };
    case 'cancelled_after_dispatch':
      return { outcome: 'cancellation', metering: { output: Math.max(outputs, reported) } };
    case 'completed_after_deadline':
    case 'deadline':
      return { outcome: 'timeout', metering: {} };
    case 'abandoned':
    case 'execution_failed':
    case 'contributor_loss':
      return null;
    default:
      return outputs > 0 ? { outcome: 'partial_delivery', metering: withContext({ output: outputs }, facts.context) } : null;
  }
}

export const chargeFor = (reservation, settle) => {
  if (!settle) return 0;
  const termKey = settle.outcome === 'cancellation' && reservation.attempts.length === 0 ? 'cancellationQueued' : OUTCOME_TERM_KEYS[settle.outcome];
  const formula = reservation.terms.settlement[termKey];
  return formula ? evaluateFormula(formula, settle.metering, reservation.rounding) : 0;
};

/**
 * One decision for an open reservation from its provisional report (if any)
 * and the evidence kept for its attempts. Returns `{ settle, basis, charge,
 * dispute, corroborated }`: `settle` is the settlement input (null when nothing
 * is chargeable), `dispute` the asserted remainder to hold, and `corroborated`
 * whether the decision needs no evidence window.
 */
export function decideFromEvidence({ reservation, records, now }) {
  const report = reservation.report ?? null;
  const facts = reservation.attempts.map((attempt) => attemptFacts(attempt, records.get(attempt.attemptId) ?? null, reservation.service.limits));
  const reportFor = (attempt) => (report?.attemptId === attempt.attemptId ? report : null);
  const reportSettle = report?.settle ?? null;
  let chosen = reportSettle ? { settle: cloneJson(reportSettle), charge: chargeFor(reservation, reportSettle), basis: 'report', complete: false } : null;
  let asserted = null;
  for (const row of facts) {
    const rowReport = reportFor(row.attempt);
    const acked = outcomeFor(row, row.acknowledged, rowReport, reservation, now);
    if (acked) {
      const { complete = false, ...settle } = acked;
      const candidate = { settle: { ...settle, attemptId: row.attempt.attemptId }, charge: chargeFor(reservation, settle) };
      if (!chosen || candidate.charge > chosen.charge) {
        chosen = { ...candidate, basis: reportSettle ? 'report_overridden' : 'evidence', complete, evidenceId: row.evidenceId };
      } else if (candidate.charge === chosen.charge && complete && chosen.settle.outcome === settle.outcome) {
        chosen = { ...chosen, complete: true, evidenceId: row.evidenceId };
      }
    }
    const claim = outcomeFor(row, row.asserted, rowReport, reservation, now);
    if (claim) {
      const { complete: _complete, ...settle } = claim;
      const charge = chargeFor(reservation, settle);
      if (!asserted || charge > asserted.charge) asserted = { settle: { ...settle, attemptId: row.attempt.attemptId }, charge, evidenceId: row.evidenceId };
    }
  }
  const charge = chosen?.charge ?? 0;
  const held = asserted && asserted.charge > charge ? Math.min(asserted.charge, reservation.authorizedMax) - charge : 0;
  return {
    settle: chosen?.settle ?? null,
    basis: chosen?.basis ?? 'evidence',
    charge,
    evidenceIds: facts.map((row) => row.evidenceId).filter(Boolean),
    dispute: held > 0 ? { held, acknowledged: chosen?.settle ?? null, acknowledgedCharge: charge, asserted: asserted.settle, assertedCharge: asserted.charge } : null,
    corroborated: Boolean(chosen?.complete) && held === 0
  };
}

export function newDispute({ reservation, decision, held, draws, now }) {
  return {
    schema: DISPUTE_SCHEMA,
    rules: EVIDENCE_RULES_ID,
    disputeId: disputeIdForReservation(reservation.reservationId),
    reservationId: reservation.reservationId,
    quoteId: reservation.quoteId,
    accountId: reservation.accountId,
    billableEventId: reservation.billableEventId,
    acknowledged: decision.dispute.acknowledged,
    acknowledgedCharge: decision.dispute.acknowledgedCharge,
    asserted: decision.dispute.asserted,
    assertedCharge: decision.dispute.assertedCharge,
    held,
    draws,
    evidenceIds: decision.evidenceIds,
    dispositionCharges: { acknowledged: 0, asserted: held },
    status: 'pending_review',
    openedAt: now,
    disposition: null,
    reviewer: null,
    resolvedAt: null
  };
}

export default {
  EVIDENCE_RULES, EVIDENCE_RULES_ID, verifyAttemptEvidence, mergeAttemptEvidence, decideFromEvidence, evidenceIdFor
};
