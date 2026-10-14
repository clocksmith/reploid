// Contributor loss during an ordered conversation. The requester-visible error
// text comes from the application's own failure table; the coordinator receipt
// (packages/reploid/src/mesh/partitions/partition-route-execution.js:57-77) is
// the only place per-stage ownership of a failed attempt is reported.
import { isDeepStrictEqual } from 'node:util';
import failureMessages from '../../packages/reploid/src/transport/partition-errors.json' with { type: 'json' };
import { completedAttemptFailures, approvalFailures, emptyCustody } from './checks.mjs';
import { timingRecordFailures } from './timing.mjs';

export { failureMessages };
const UNCONFIRMED = ['CONNECTION_LOST', 'REQUEST_TIMEOUT', 'CLEANUP_FAILED'];
const responseOf = (thread, attempt) => thread?.messages?.find(message => message.id === attempt?.responseId);
const errorCode = message => Object.entries(failureMessages).find(([, text]) => text === message)?.[0] ?? null;
function checker() { const failures = []; return { failures, require(ok, reason) { if (!ok) failures.push(reason); } }; }
const run = fn => { try { return fn(); } catch (error) { return [`observation missing or malformed: ${error.message}`]; } };

export const LOSS_REQUIREMENTS = Object.freeze({
  lossInjected: ['DR-5 docs/roadmap/requirements.md:190'],
  lossReported: ['DR-5 docs/roadmap/requirements.md:190', 'ROADMAP.md:28', 'REP-7 docs/roadmap/requirements.md:148'],
  ownershipExplicit: ['REP-6 docs/roadmap/requirements.md:406', 'REP-4 docs/roadmap/requirements.md:272', 'ROADMAP.md:28'],
  noSilentContinuation: ['REP-6 docs/roadmap/requirements.md:406', 'DR-5 docs/roadmap/requirements.md:190'],
  explicitRetry: ['DR-5 docs/roadmap/requirements.md:190', 'REP-6 docs/roadmap/requirements.md:406'],
  selectiveAcquisition: ['REP-7 docs/roadmap/requirements.md:133'],
  timing: ['ROADMAP.md:14']
});

export function assessContributorLoss(report, fixture, freeze) {
  const failedAttempt = report.failed?.attempts?.find(item => item.id === report.failedAttemptId);
  const failedResponse = responseOf(report.failed, failedAttempt);
  const target = freeze.route.find(stage => stage.machine === report.lossTarget?.machine);

  const lossInjected = run(() => {
    const { failures, require } = checker();
    const before = report.beforeLoss?.attempts?.find(item => item.id === report.failedAttemptId);
    require(target?.host === 'native' && report.lossTarget.stage === target.index && report.lossTarget.participantId === target.participantId,
      'Loss target is not a native stage of the frozen route');
    require(before?.status === 'executing' && responseOf(report.beforeLoss, before)?.content?.length > 0,
      'Contributor was not stopped while the conversation was streaming');
    require(typeof report.stop?.method === 'string' && report.stop.method && Number.isFinite(Date.parse(report.stop.stoppedAt)),
      'Injected stop callback did not report its method and time');
    require(failedAttempt?.status !== 'completed', 'Loss did not interrupt the conversation; the attempt completed');
    return failures;
  });

  // A contributor-loss report names the loss to the requester: stored error and rendered status.
  const lossReported = run(() => {
    const { failures, require } = checker();
    const accepted = fixture.acceptedLossCodes.map(code => failureMessages[code]);
    require(accepted.includes(failedAttempt?.error),
      `Requester error does not report contributor loss (observed ${errorCode(failedAttempt?.error) ?? 'unclassified'}: ${failedAttempt?.error ?? 'none'})`);
    require(report.renderedFailure?.status === fixture.expectedLossLabel, `Rendered failure status does not report contributor loss (${report.renderedFailure?.status ?? 'none'})`);
    require(report.renderedFailure?.technical === failedAttempt?.error, 'Rendered technical details differ from the stored attempt error');
    return failures;
  });

  // Ownership as reported by the code: an explicit category at the requester and
  // per-stage settled/unknown rows at the coordinator, never silent success.
  const ownershipExplicit = run(() => {
    const { failures, require } = checker();
    const code = errorCode(failedAttempt?.error), receipt = report.coordinatorReceipt, rows = receipt?.cleanup || [];
    require(failedAttempt?.status === 'failed' && failedResponse?.status === 'failed', 'Requester attempt did not settle as failed');
    require(code !== null, 'Requester error is not an explicit partition failure category');
    require(receipt?.identity?.attemptId === report.failedAttemptId, 'Coordinator receipt for the failed attempt unobserved');
    require(rows.length === freeze.route.length && freeze.route.every(stage => rows.filter(row => row?.partitionIndex === stage.index).length === 1),
      'Coordinator cleanup rows do not cover every stage exactly once');
    require(rows.every(row => row?.status === 'settled' && row.error === null || row?.status === 'unknown' && typeof row.error === 'string' && row.error.length > 0),
      'A cleanup row is neither settled nor explicitly unknown with its error');
    const unknown = rows.some(row => row?.status === 'unknown');
    require(unknown ? receipt.phase === 'cleanup-failed' && receipt.cleanupSettledAt === null : receipt?.phase === 'failed' && Number.isFinite(receipt.cleanupSettledAt),
      'Coordinator phase contradicts its cleanup rows');
    require(typeof receipt?.failure === 'string' && receipt.failure.length > 0, 'Coordinator receipt lacks the failure cause');
    require(!unknown || UNCONFIRMED.includes(code), 'Unknown remote ownership was reported to the requester as an ordinary failure');
    return failures;
  });

  const noSilentContinuation = run(() => {
    const { failures, require } = checker();
    const after = [...(report.terminalSamples || []), ...(report.postFailureSamples || [])];
    const content = failedResponse?.content;
    require(typeof content === 'string' && content.startsWith(responseOf(report.beforeLoss, report.beforeLoss?.attempts?.find(item => item.id === report.failedAttemptId))?.content ?? '\u0000'),
      'Failed attempt lost the partial answer visible before the loss');
    require(after.length >= 2, 'Post-failure observations missing');
    require(after.every(sample => sample.status === failedAttempt?.status && sample.content === content
      && sample.attemptIds.length === report.failed.attempts.length && sample.attemptIds.at(-1) === report.failedAttemptId && sample.runningIds.length === 0),
    'Output continued, status changed or another attempt started without an explicit retry');
    require(report.postFailureObservationMs >= fixture.postFailureObservationMs, 'Post-failure observation interval incomplete');
    require((report.preRetrySamples || []).every(sample => sample.attemptIds.length === report.failed.attempts.length && sample.runningIds.length === 0),
      'An attempt was dispatched while waiting for capacity, before the explicit retry');
    return failures;
  });

  const explicitRetry = run(() => {
    const { failures, require } = checker();
    const final = report.retry?.final, last = final?.attempts?.at(-1);
    require(report.capacityReturned === true && Number.isFinite(Date.parse(report.capacityReturnedAt)), 'Capacity did not return before the deadline');
    require(typeof report.restore?.method === 'string' && report.restore.method, 'Injected restore callback did not report its method');
    require(Date.parse(report.retry?.clickedAt) >= Date.parse(report.capacityReturnedAt), 'Retry was requested before capacity returned');
    require(last && last.id !== report.failedAttemptId && last.retryOf === report.failedAttemptId && final.attempts.length === report.failed.attempts.length + 1,
      'Explicit retry did not start exactly one new attempt linked to the failure');
    require(isDeepStrictEqual(final?.messages?.slice(0, report.failed?.messages?.length), report.failed?.messages), 'Retry changed earlier messages or the preserved partial answer');
    failures.push(...completedAttemptFailures(final, last, freeze, 'Retry'), ...approvalFailures(last, freeze, 'Retry'));
    return failures;
  });

  const selectiveAcquisition = run(() => {
    const { failures, require } = checker();
    require(Array.isArray(report.weights) && report.weights.length === 0, 'Requester issued weight HTTP requests');
    require([report.custodyBefore, report.custodyAfter].every(emptyCustody), 'Requester received or retained weights, or custody evidence is missing');
    return failures;
  });

  const timing = run(() => {
    const id = report.retry?.final?.attempts?.at(-1)?.id, record = (report.timing || []).find(item => item.attemptId === id);
    return record ? timingRecordFailures(record, { requireComplete: true, stageCount: freeze.route.length }) : ['Retry timing record missing'];
  });

  const results = { lossInjected, lossReported, ownershipExplicit, noSilentContinuation, explicitRetry, selectiveAcquisition, timing };
  const checks = Object.fromEntries(Object.entries(results).map(([name, failures]) => [name, { pass: failures.length === 0, failures, requirements: LOSS_REQUIREMENTS[name] }]));
  const failures = Object.entries(checks).flatMap(([name, check]) => check.failures.map(reason => `${name}: ${reason}`));
  return { automatedPass: failures.length === 0, failures, checks, observedErrorCode: errorCode(failedAttempt?.error),
    manualReview: { answerUsefulness: null, criteria: fixture.reviewCriteria, reviewer: null } };
}
