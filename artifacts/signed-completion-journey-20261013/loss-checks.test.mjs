import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessContributorLoss } from './loss-checks.mjs';
import { lossReport, freeze, FAILURE } from './test-fixtures.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./contributor-loss.json', import.meta.url)));
const assess = report => assessContributorLoss(report, fixture, freeze);
function rejects(name, check, mutate, pattern = null) {
  test(`rejects ${name}`, () => {
    const report = lossReport(fixture); mutate(report);
    const result = assess(report);
    assert.equal(result.automatedPass, false);
    assert.equal(result.checks[check].pass, false, `${check} should reject ${name}`);
    if (pattern) assert.match(result.checks[check].failures.join('\n'), pattern);
  });
}

test('reported loss with explicit ownership and an explicit retry passes', () => {
  const result = assess(lossReport(fixture));
  assert.deepEqual(result.failures, []);
  assert.equal(result.observedErrorCode, 'CONNECTION_LOST');
  assert.equal(result.manualReview.answerUsefulness, null);
});

test('accepted loss report is bound to the application failure table and UI label', () => {
  assert.deepEqual(fixture.acceptedLossCodes, ['CONNECTION_LOST']);
  const label = fs.readFileSync(new URL('../../self/ui/pool-home/message-list.js', import.meta.url), 'utf8');
  assert.ok(label.includes(`'${fixture.expectedLossLabel}'`));
  assert.match(FAILURE.CONNECTION_LOST, /disconnected/);
});

// Required: a missing contributor-loss report. Cleanup failure masks the loss (see README, Application gaps).
rejects('a missing contributor-loss report when cleanup failure is reported instead', 'lossReported', report => {
  report.failed.attempts[0].error = FAILURE.CLEANUP_FAILED;
  report.renderedFailure = { status: 'This answer could not finish.', technical: FAILURE.CLEANUP_FAILED };
}, /CLEANUP_FAILED/);
test('cleanup-failure masking still counts as explicit unknown ownership', () => {
  const report = lossReport(fixture);
  report.failed.attempts[0].error = FAILURE.CLEANUP_FAILED;
  report.renderedFailure = { status: 'This answer could not finish.', technical: FAILURE.CLEANUP_FAILED };
  const result = assess(report);
  assert.equal(result.checks.ownershipExplicit.pass, true);
  assert.equal(result.checks.lossReported.pass, false);
});
rejects('a generic peer failure reported as loss', 'lossReported', report => {
  report.failed.attempts[0].error = FAILURE.EXECUTION_FAILED;
  report.renderedFailure = { status: 'This answer could not finish.', technical: FAILURE.EXECUTION_FAILED };
});
rejects('no rendered loss report', 'lossReported', report => { report.renderedFailure = null; });
rejects('a loss after which the answer still completed', 'lossInjected', report => { report.failed.attempts[0].status = 'completed'; });
rejects('a stop injected before streaming', 'lossInjected', report => { report.beforeLoss.messages[1].content = ''; });
rejects('a stop callback without its method', 'lossInjected', report => { report.stop = {}; });
rejects('a loss target that is not a frozen native stage', 'lossInjected', report => { report.lossTarget = { machine: 'mac-host', stage: 0, participantId: freeze.route[0].participantId }; });
rejects('an unclassified requester error', 'ownershipExplicit', report => { report.failed.attempts[0].error = 'something broke'; });
rejects('a cancelled attempt instead of a failed one', 'ownershipExplicit', report => {
  report.failed.attempts[0].status = 'cancelled'; report.failed.messages[1].status = 'cancelled';
});
rejects('a missing coordinator receipt', 'ownershipExplicit', report => { report.coordinatorReceipt = null; });
rejects('an unknown row without its error', 'ownershipExplicit', report => { report.coordinatorReceipt.cleanup[1].error = null; });
rejects('a phase that hides unknown cleanup', 'ownershipExplicit', report => {
  report.coordinatorReceipt.phase = 'failed'; report.coordinatorReceipt.cleanupSettledAt = 1;
});
rejects('unknown ownership reported as an ordinary failure', 'ownershipExplicit', report => {
  report.failed.attempts[0].error = FAILURE.EXECUTION_FAILED;
});
rejects('silent continuation of output', 'noSilentContinuation', report => { report.postFailureSamples[2].content += '\n13'; });
rejects('an automatic replacement attempt', 'noSilentContinuation', report => { report.postFailureSamples[1].attemptIds = ['al', 'auto']; });
rejects('a dispatch while waiting for capacity', 'noSilentContinuation', report => { report.preRetrySamples[1].runningIds = ['tl']; });
rejects('a lost partial answer', 'noSilentContinuation', report => { report.failed.messages[1].content = ''; });
rejects('a short post-failure observation', 'noSilentContinuation', report => { report.postFailureObservationMs = 10; });
rejects('capacity that never returned', 'explicitRetry', report => { report.capacityReturned = false; });
rejects('a retry before capacity returned', 'explicitRetry', report => { report.retry.clickedAt = '2026-10-13T12:01:30.000Z'; });
rejects('a retry not linked to the failure', 'explicitRetry', report => { report.retry.final.attempts[1].retryOf = null; });
rejects('a retry on a two-stage route', 'explicitRetry', report => {
  const execution = report.retry.final.attempts[1].execution;
  execution.identity.route.stages.pop(); execution.settlement.cleanup.pop();
});
rejects('a requester weight request', 'selectiveAcquisition', report => { report.weights = ['http://127.0.0.1:8000/model/piece-' + 'a'.repeat(64) + '.bin']; });
rejects('a missing retry timing record', 'timing', report => { report.timing = []; });

test('missing observations fail closed rather than throwing', () => {
  const result = assessContributorLoss({}, fixture, freeze);
  assert.equal(result.automatedPass, false);
  assert.ok(Object.values(result.checks).every(check => check.pass === false));
});
