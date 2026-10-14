import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimingRecord, timingRecordFailures, NOT_OBSERVABLE, NOT_OBSERVABLE_PATHS } from './timing.mjs';
import { attempt, conversation } from './test-fixtures.mjs';

const completed = attempt({ id: 'at', threadId: 'tt' });
const thread = conversation('tt', [{ attempt: completed, question: 'q', answer: 'answer' }]);
const samples = [{ at: '2026-10-13T12:00:02.500Z', attemptId: 'at', content: 'ans', renderedText: 'ans' }];
const record = () => buildTimingRecord({ thread, attemptId: 'at', samples, sentAt: '2026-10-13T12:00:00.000Z', pollMs: 100 });

test('timing keeps each exposed boundary separate with its clock and source', () => {
  const value = record();
  assert.deepEqual(timingRecordFailures(value, { stageCount: 3 }), []);
  assert.equal(value.requester.attemptMs.value, 4000);
  assert.equal(value.requester.attemptMs.clock, 'requester-application');
  assert.equal(value.requester.firstVisibleTextMs.value, 2500);
  assert.equal(value.requester.firstVisibleTextMs.clock, 'harness');
  assert.deepEqual(value.coordinator.stages.map(row => row.stepMsTotal.value), [12.5, 25, 37.5]);
  assert.ok(value.coordinator.stages.every(row => row.stepMsTotal.clock === 'coordinator'));
  assert.equal(value.coordinator.activationBytes.value, 98304);
});
test('unexposed boundaries are marked not-observable, never estimated', () => {
  const value = record();
  for (const path of NOT_OBSERVABLE_PATHS) {
    const leaf = path.split('.').reduce((node, key) => node[key], value);
    assert.equal(leaf.status, NOT_OBSERVABLE, path);
    assert.ok(leaf.reason && /\.js:\d+/.test(leaf.source), path);
    assert.equal('value' in leaf, false, path);
  }
});
test('a completed answer without coordinator stage timing fails', () => {
  const bare = structuredClone(thread); delete bare.attempts[0].execution.stepSummary;
  const failures = timingRecordFailures(buildTimingRecord({ thread: bare, attemptId: 'at', samples, sentAt: '2026-10-13T12:00:00.000Z' }), { stageCount: 3 });
  assert.ok(failures.some(failure => /observable boundary missing/.test(failure)));
});
test('a partial attempt record may omit measurements when completeness is not required', () => {
  const partial = buildTimingRecord({ thread, attemptId: 'at', samples: [] });
  assert.deepEqual(timingRecordFailures(partial, { requireComplete: false }), []);
  assert.ok(timingRecordFailures(partial, { requireComplete: true }).length > 0);
});
test('a not-observable boundary replaced by a guess is rejected', () => {
  const value = record(); value.scheduler.queuedMs = { status: 'estimated', value: 1, source: 'guess' };
  assert.ok(timingRecordFailures(value).some(failure => /estimates are not recorded/.test(failure)));
});
