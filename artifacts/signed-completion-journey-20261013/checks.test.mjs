import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessJourney, projectHistory } from './checks.mjs';
import { journeyReport, freeze, selectionId, routeOf, PEERS } from './test-fixtures.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./journey.json', import.meta.url)));
const assess = report => assessJourney(report, fixture, freeze, { selectionId, concurrencyTabs: 2 });
const last = report => report.turns[1].attempts.at(-1);
function rejects(name, check, mutate, pattern = null) {
  test(`rejects ${name}`, () => {
    const report = journeyReport(fixture); mutate(report);
    const result = assess(report);
    assert.equal(result.automatedPass, false);
    assert.equal(result.checks[check].pass, false, `${check} should reject ${name}`);
    if (pattern) assert.match(result.checks[check].failures.join('\n'), pattern);
  });
}

test('coherent ordered receipt passes automated checks only, never answer usefulness', () => {
  const result = assess(journeyReport(fixture));
  assert.deepEqual(result.failures, []);
  assert.equal(result.automatedPass, true);
  assert.equal(result.semanticAcceptance, null); assert.equal(result.overallAcceptance, false);
  assert.equal(result.manualReview.answerUsefulness, null);
  for (const check of Object.values(result.checks)) assert.ok(check.requirements.length > 0);
});

// Required ordered failures.
rejects('a two-stage route where three are frozen', 'completion', report => {
  const execution = last(report).execution, route = routeOf([PEERS.mac, PEERS.intel]);
  execution.identity.route = route; execution.settlement.cleanup.pop(); execution.settlement.reservations.pop(); execution.stepSummary.stages.pop();
  last(report).authorization.route = structuredClone(route);
}, /distinct route contributors \(2\) differ from the frozen route \(3\)/);
rejects('an unsettled cleanup row', 'completion', report => {
  report.turns[0].attempts[0].execution.settlement.cleanup[2] = { partitionIndex: 2, status: 'unknown', error: 'channel closed' };
}, /cleanup row is unsettled/);
rejects('a weight request by the requester', 'selectiveAcquisition', report => {
  report.weights.push('http://127.0.0.1:8000/model/shard_00000.bin');
}, /weight HTTP requests/);
rejects('a cancelled neighbour', 'isolatedCancellation', report => {
  const tab = report.concurrency.tabs[1], attempt = tab.final.attempts.at(-1);
  attempt.status = 'cancelled'; attempt.error = 'Response stopped'; tab.final.messages.at(-1).status = 'cancelled';
  tab.samples.push({ status: 'cancelling' }, { status: 'cancelled' });
}, /Neighbour1/);

// Precedent rejections, retained (artifacts/signed-host-opener-20261012/requester-return-control/checks.test.mjs:26-40).
rejects('transport cutoff', 'completion', report => { last(report).status = 'interrupted'; });
rejects('output cap', 'completion', report => { report.turns[0].attempts[0].execution.stopReason = 'max-tokens'; });
rejects('unknown cleanup', 'completion', report => { report.turns[0].attempts[0].execution.settlement.cleanup[1].status = 'unknown'; });
rejects('hidden fallback', 'completion', report => { last(report).execution = { placement: 'local-webgpu', stopReason: 'eos-token' }; });
rejects('fabricated history', 'followUp', report => { last(report).request.messages[1].content = 'Ideal substitute'; });
rejects('terminal-only output', 'streaming', report => { report.streamSamples[0].status = 'completed'; });
rejects('invisible stream', 'streaming', report => { report.streamSamples[0].renderedText = ''; });
rejects('wrong clipboard', 'copy', report => { report.copy.clipboardText = 'other text'; });
rejects('missing custody', 'selectiveAcquisition', report => { delete report.custodyAfterReload; });
rejects('reload redispatch', 'reload', report => { report.returnSamples[1].runningIds = ['t1']; });
rejects('changed reload text', 'reload', report => { report.restoredState.threads[0].messages[1].content += ' changed'; });
rejects('short return observation', 'reload', report => { report.returnObservationMs = 0; });
rejects('lost draft', 'reload', report => { report.restoration.draft = ''; });

// Ordered-route, approval and lifecycle rejections.
rejects('swapped stage order', 'completion', report => { last(report).execution.identity.route = routeOf([PEERS.mac, PEERS.intel, PEERS.amd]); });
rejects('requester inside the route', 'completion', report => { last(report).execution.identity.requesterId = PEERS.amd; });
rejects('a stage that skipped steps', 'completion', report => { report.turns[0].attempts[0].execution.stepSummary.stages[1].steps = 3; });
rejects('a stage that was never admitted', 'completion', report => { report.turns[0].attempts[0].execution.settlement.reservations.pop(); });
rejects('a requester assigned a stage', 'open', report => { report.open.orderedParticipation = { stage: { index: 0 } }; });
rejects('a requester outside ordered mode', 'open', report => { report.open.orderedParticipation = null; });
rejects('a different served bundle', 'open', report => { report.open.servedDescriptor = 'sha256:' + '0'.repeat(64); });
rejects('another model chosen', 'modelChoice', report => { report.modelChoice.selectedValue = freeze.modelId; });
rejects('approved recipients that differ from the frozen route', 'recipientApproval', report => {
  last(report).authorization.route = routeOf([PEERS.mac, PEERS.amd, PEERS.tabA]);
});
rejects('an attempt not approved by Send', 'recipientApproval', report => { report.turns[0].attempts[0].authorization.source = 'thread-grant'; });
rejects('tabs that never executed simultaneously', 'concurrency', report => { report.concurrency.pairedSamples = [{ statuses: ['executing', 'queued'] }]; });
// Independence was asserted through REPLOID_INSTANCE_ID, which the product route never sets (only
// self/kernel/boot.js:160 does), so it could not pass for real independent requesters. One connected
// tab per profile is the contract; independence is now separate profiles and peer identities.
rejects('concurrent requests from one browser profile', 'concurrency', report => {
  Object.assign(report.concurrency.tabs[1], { profile: report.concurrency.tabs[0].profile, profileDirectory: report.concurrency.tabs[0].profileDirectory });
}, /separate browser profiles/);
rejects('concurrent requesters sharing one peer identity', 'concurrency', report => {
  report.concurrency.tabs[1].requesterPeerId = report.concurrency.tabs[0].requesterPeerId;
}, /independent peer identities/);
rejects('a concurrent requester without a peer identity', 'concurrency', report => { report.concurrency.tabs[0].requesterPeerId = null; },
  /independent peer identities/);
rejects('concurrent attempts sent by one requester', 'concurrency', report => {
  report.concurrency.tabs[1].final.attempts.at(-1).execution.identity.requesterId = PEERS.tabA;
}, /distinct requesters/);
rejects('a concurrent requester without a profile directory', 'concurrency', report => { delete report.concurrency.tabs[0].profileDirectory; },
  /separate browser profiles/);
rejects('more tabs than the served admission limit', 'concurrency', report => { report.concurrency.servedLimit = 1; });
rejects('a stop that lost its partial answer', 'isolatedCancellation', report => { report.concurrency.tabs[0].final.messages.at(-1).content = ''; });
rejects('a stopped attempt the coordinator did not settle', 'isolatedCancellation', report => {
  report.coordinator.receipts[0].cleanup[1] = { partitionIndex: 1, status: 'unknown', error: 'channel closed' };
});
rejects('a neighbour answer with a wrong count', 'isolatedCancellation', report => { report.concurrency.tabs[1].final.messages.at(-1).content = '1\n2\n3'; });
rejects('a retry after a user stop instead of a failure', 'explicitRetry', report => {
  report.retry.failed.attempts[0].status = 'cancelled'; report.retry.failed.attempts[0].error = 'Response stopped';
});
rejects('a redispatch before the explicit retry', 'explicitRetry', report => { report.retry.returnSamples[1].attemptCount = 2; });
rejects('a retry not linked to its failure', 'explicitRetry', report => { report.retry.final.attempts.at(-1).retryOf = null; });
rejects('a retry that changed the preserved partial answer', 'explicitRetry', report => { report.retry.final.messages[1].content = 'rewritten'; });
rejects('an estimated timing boundary', 'timing', report => {
  report.timing[0].persistence = { status: 'estimated', value: 3, source: 'guess' };
}, /estimates are not recorded/);
rejects('an observable boundary marked not-observable', 'timing', report => {
  report.timing[1].coordinator.stages[0].stepMsTotal = { status: 'not-observable', reason: 'skipped', source: 'none' };
});
rejects('a missing per-stage timing', 'timing', report => { report.timing[2].coordinator.stages.pop(); });

test('missing observations fail closed rather than throwing', () => {
  const result = assess({});
  assert.equal(result.automatedPass, false);
  assert.ok(Object.values(result.checks).every(check => check.pass === false));
});

test('incorrect answer with complete transport never becomes semantic acceptance', () => {
  const report = journeyReport(fixture);
  report.turns[1].messages.at(-1).content = '[999]';
  report.beforeReload = { threads: [report.turns[1]], runningIds: [] }; report.restoredState = structuredClone(report.beforeReload);
  report.returnSamples = [0, 1].map(() => ({ runningIds: [], history: projectHistory(report.beforeReload) }));
  const result = assess(report);
  assert.equal(result.automatedPass, true); assert.equal(result.semanticAcceptance, null); assert.equal(result.usefulConversationQualified, false);
});
