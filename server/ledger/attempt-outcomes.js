/**
 * @fileoverview Declared outcome rules: from one partition route attempt's own
 * settlement records to the ledger outcome of the reservation it was bound to.
 *
 * The requester device reports what its route returned: the partition summary
 * with the route's settlement receipt for a completed attempt, the failure
 * code for a failed one, or the last route activity record for a cancelled
 * one. These rules decide the outcome, metering and completion time; the
 * caller never names an outcome or a charge. Every attempt under one
 * acceptance shares one billable event, so retries cannot add a second
 * economic effect, and accepted terms decide every amount.
 *
 * The route records are unsigned requester-held observations. These rules
 * check their identity and internal consistency against the bound attempt;
 * they cannot prove the requester did not withhold or misstate a record.
 * Under a quote's evidence terms, signed stage receipts and requester
 * acknowledgments (attempt-evidence.js) settle what a withheld report leaves
 * open and raise what an understated one omits.
 */

import { canonicalRouteAttemptBinding, sameRouteAttemptIdentity } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { partitionActivity } from '../../packages/reploid/src/mesh/partitions/partition-summary.js';
import { cloneJson, fail, hashCanonical, sha256Hex, toMs } from './domain.js';

export const ATTEMPT_OUTCOME_RULES_ID = 'reploid.attempt-outcome-rules/1.0.0';
export const ATTEMPT_REPORT_SCHEMA = 'reploid.attempt-report/v1';
export const ATTEMPT_RECORD_SCHEMA = 'reploid.attempt-record/v1';
export const REPORT_RESULTS = Object.freeze(['completed', 'failed', 'cancelled', 'abandoned']);
// The partition transport's code for a stage whose authenticated channel closed.
export const CONTRIBUTOR_LOSS_CODE = 'CONNECTION_LOST';

/** The rules as data, named by every attempt record. */
export const ATTEMPT_OUTCOME_RULES = Object.freeze({
  id: ATTEMPT_OUTCOME_RULES_ID,
  completed: 'full: the route receipt completed with every stage reserved and cleanup settled, by the quoted deadline; output is the route step count, context its prompt tokens',
  completed_after_deadline: 'timeout: the route completed after the quoted deadline',
  cancelled_after_dispatch: 'cancellation: the requester stopped a dispatched attempt; output is the last route activity step count',
  deadline: 'timeout: the requester stopped the attempt at the quoted deadline',
  contributor_loss: 'the attempt closes as failed; a retry may bind under the same acceptance; with none left, provider_failure',
  execution_failed: 'the attempt closes as failed; a retry may bind under the same acceptance; with none left, provider_failure',
  cancelled_before_dispatch: 'cancellation: no attempt was dispatched',
  abandoned: 'provider_failure: the requester stops retrying after failed attempts'
});

const SUMMARY_SCHEMA = 'reploid.mesh.partition-summary/v2';
// `evidence` carries the requester's signed acknowledgments under evidence terms (attempt-evidence.js).
const REPORT_KEYS = Object.freeze(['schema', 'result', 'attemptId', 'identity', 'execution', 'activity', 'failure', 'cancellation', 'evidence']);
const FAILURE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** All attempts under one acceptance are one billable event. */
export const billableEventIdFor = (reservationId) => `bill_${sha256Hex(`reservation\u0000${reservationId}`).slice(0, 32)}`;
export const routeHashOf = (identity) => hashCanonical(canonicalRouteAttemptBinding(identity));
export const attemptRecordIdFor = (routeHash) => `atr_${sha256Hex(routeHash).slice(0, 32)}`;

const invalid = (message) => fail('invalid_report', message);
const iso = (ms) => new Date(ms).toISOString();

function bindingOf(report, attempt, reservation) {
  let binding;
  try {
    binding = canonicalRouteAttemptBinding(report.identity);
  } catch {
    invalid('identity must be the attempt\'s canonical route identity');
  }
  if (binding.attemptId !== attempt.attemptId) fail('report_mismatch', 'the route identity names a different attempt');
  const unbound = binding.route.stages.map((stage) => stage.participantId).filter((id) => !attempt.recipients.includes(id));
  if (unbound.length) fail('report_mismatch', 'route stages are not the attempt\'s bound recipients', { unbound });
  if (binding.route.modelId !== reservation.service.model.modelId) fail('report_mismatch', 'the route model differs from the quoted service');
  return binding;
}

/** A completed route: its receipt shows every stage reserved, executing every step and settling cleanup. */
function completedRoute(summary, binding) {
  const receipt = summary?.settlement;
  const steps = summary?.stepSummary?.count;
  const stages = binding.route.stages;
  const complete = summary?.schema === SUMMARY_SCHEMA && sameRouteAttemptIdentity(summary.identity, binding)
    && sameRouteAttemptIdentity(receipt?.identity, binding) && receipt.phase === 'completed' && receipt.failure == null
    && Number.isFinite(receipt.cleanupSettledAt) && Number.isSafeInteger(steps) && steps >= 1
    && stages.every((stage) => receipt.reservations?.some((row) => row?.partitionIndex === stage.index && row.status === 'reserved'
      && sameRouteAttemptIdentity(row.identity, binding))
      && receipt.cleanup?.some((row) => row?.partitionIndex === stage.index && row.status === 'settled')
      && summary.stepSummary.stages?.find((row) => row?.partitionIndex === stage.index)?.steps === steps);
  if (!complete) {
    fail('report_incomplete', 'a completed report needs the route summary whose receipt shows every stage reserved, executed for every step and settled');
  }
  const promptTokens = summary.stepSummary.phases?.prompt?.inputTokens;
  return { steps, promptTokens: Number.isSafeInteger(promptTokens) && promptTokens >= 0 ? promptTokens : null, settledAt: receipt.cleanupSettledAt };
}

/**
 * Decide what one report does to an open reservation. Returns
 * `{ rule, close?, settle?, record? }`: `close` closes the named attempt,
 * `settle` is the settlement input without its billable event, and `record`
 * the route record kept for contributor claims.
 */
export function deriveAttemptOutcome({ reservation, report, now }) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) invalid('an attempt report object is required');
  const unknown = Object.keys(report).filter((key) => !REPORT_KEYS.includes(key));
  if (unknown.length) invalid(`attempt reports do not accept: ${unknown.join(', ')}`);
  if (report.schema !== ATTEMPT_REPORT_SCHEMA) invalid(`report.schema must be ${ATTEMPT_REPORT_SCHEMA}`);
  if (!REPORT_RESULTS.includes(report.result)) invalid(`report.result must be one of ${REPORT_RESULTS.join(', ')}`);
  const { attempts } = reservation;

  // No attempt named: cancelled before dispatch, or no further retry after failed attempts.
  if (report.attemptId === undefined || report.attemptId === null) {
    if (!['cancelled', 'abandoned'].includes(report.result)) fail('attempt_required', `a ${report.result} report names its attempt`);
    const active = attempts.find((attempt) => attempt.status === 'bound');
    if (active) fail('attempt_active', 'report the active attempt\'s own outcome', { activeAttemptId: active.attemptId });
    if (report.result === 'cancelled' && attempts.length === 0) {
      return { rule: 'cancelled_before_dispatch', settle: { outcome: 'cancellation', metering: {} } };
    }
    if (report.result === 'cancelled' || attempts.length === 0) {
      fail('attempt_required', 'after a failed attempt, stop retrying with an abandoned report; with no attempt, cancel');
    }
    return { rule: 'abandoned', settle: { outcome: 'provider_failure', attemptId: attempts.at(-1).attemptId, metering: {} } };
  }
  if (report.result === 'abandoned') invalid('an abandoned report names no attempt');
  const attempt = attempts.find((entry) => entry.attemptId === report.attemptId);
  if (!attempt) fail('attempt_not_bound', 'the reported attempt is not bound to this reservation', { attemptId: report.attemptId });
  if (attempt.status !== 'bound') fail('attempt_closed', 'the reported attempt already has its outcome', { attemptId: attempt.attemptId, status: attempt.status });
  const binding = bindingOf(report, attempt, reservation);
  const routeHash = hashCanonical(binding);
  const record = { routeHash, recordId: attemptRecordIdFor(routeHash), identity: cloneJson(binding), result: report.result };

  if (report.result === 'completed') {
    const route = completedRoute(report.execution, binding);
    // The route's own completion time, never before binding nor after this report.
    const completedMs = Math.min(Math.max(route.settledAt, toMs(attempt.boundAt)), toMs(now));
    const late = completedMs > toMs(reservation.service.deadline);
    const metering = { output: route.steps, ...(route.promptTokens === null ? {} : { context: route.promptTokens }) };
    return {
      rule: late ? 'completed_after_deadline' : 'completed',
      settle: late ? { outcome: 'timeout', attemptId: attempt.attemptId, metering: {} }
        : { outcome: 'full', attemptId: attempt.attemptId, metering, completedAt: iso(completedMs) },
      record: { ...record, execution: cloneJson(report.execution), metering }
    };
  }

  if (report.result === 'cancelled') {
    const cause = report.cancellation?.cause;
    if (!['requester', 'deadline'].includes(cause) || Object.keys(report.cancellation).length !== 1) {
      invalid('report.cancellation must be { cause: requester | deadline }');
    }
    let steps = 0;
    if (report.activity !== undefined && report.activity !== null) {
      try {
        steps = partitionActivity(report.activity, binding, null, true).stepSummary.count;
      } catch {
        invalid('report.activity must be this attempt\'s route activity record');
      }
    }
    const extra = { cancellation: { cause }, activitySteps: steps };
    if (cause === 'deadline') return { rule: 'deadline', settle: { outcome: 'timeout', attemptId: attempt.attemptId, metering: {} }, record: { ...record, ...extra } };
    return {
      rule: 'cancelled_after_dispatch',
      settle: { outcome: 'cancellation', attemptId: attempt.attemptId, metering: { output: steps } },
      record: { ...record, ...extra }
    };
  }

  // Failed: the attempt closes; the reservation stays open for a retry unless none is left.
  const code = report.failure?.code;
  if (typeof code !== 'string' || !FAILURE_CODE.test(code) || Object.keys(report.failure).length !== 1) {
    invalid('report.failure must be { code } with the route failure code');
  }
  const loss = code === CONTRIBUTOR_LOSS_CODE;
  const exhausted = attempts.length >= reservation.terms.execution.maxAttempts;
  return {
    rule: loss ? 'contributor_loss' : 'execution_failed',
    close: { attemptId: attempt.attemptId, status: 'failed', reason: loss ? 'contributor_loss' : `execution_failed:${code}` },
    ...(exhausted ? { settle: { outcome: 'provider_failure', attemptId: attempt.attemptId, metering: {} } } : {}),
    record: { ...record, failure: { code } }
  };
}

export default { ATTEMPT_OUTCOME_RULES, deriveAttemptOutcome, billableEventIdFor, routeHashOf, attemptRecordIdFor };
