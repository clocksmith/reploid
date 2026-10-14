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
test('prompt length, prefill and decode are recorded separately per stage', () => {
  const value = record();
  assert.equal(value.coordinator.generatedTokens, 4);
  assert.equal(value.coordinator.promptTokens.value, 37);
  assert.equal(value.coordinator.promptTokens.unit, 'tokens');
  assert.deepEqual(value.coordinator.phases.prompt.stages.map(row => row.elapsedMs), [5, 10, 15]);
  assert.equal(value.coordinator.phases.decode.steps, 3);
  assert.deepEqual(value.coordinator.phases.decode.stages.map(row => row.elapsedMs.total), [7.5, 15, 22.5]);
  // executionMs sums every stage's prompt and decode runtime; readback and sampling belong to the final stage.
  assert.equal(value.runtime.executionMs.value, (4 + 8 + 12) + 3 * (2 + 4 + 6));
  assert.equal(value.runtime.samplingMs.value, 12 + 3 * 6);
  assert.equal(value.runtime.executionMs.clock, 'contributor-runtime');
});
test('a stage missing decode runtime for some steps fails instead of being summed partially', () => {
  const gap = structuredClone(thread);
  gap.attempts[0].execution.stepSummary.phases.decode.stages[1].runtime.executionMs.count = 2;
  const failures = timingRecordFailures(buildTimingRecord({ thread: gap, attemptId: 'at', samples, sentAt: '2026-10-13T12:00:00.000Z' }), { stageCount: 3 });
  assert.ok(failures.some(failure => /runtime\.executionMs observable boundary missing/.test(failure)));
});
test('phases that do not cover every decode step fail', () => {
  const gap = structuredClone(thread);
  gap.attempts[0].execution.stepSummary.phases.decode.steps = 2;
  const failures = timingRecordFailures(buildTimingRecord({ thread: gap, attemptId: 'at', samples, sentAt: '2026-10-13T12:00:00.000Z' }), { stageCount: 3 });
  assert.ok(failures.some(failure => /do not cover every stage and step/.test(failure)));
});
test('candidates without phase timing record runtime and prompt length as not-observable, never estimated', () => {
  const old = structuredClone(thread); delete old.attempts[0].execution.stepSummary.phases;
  const value = buildTimingRecord({ thread: old, attemptId: 'at', samples, sentAt: '2026-10-13T12:00:00.000Z', pollMs: 100 });
  assert.deepEqual(timingRecordFailures(value, { stageCount: 3 }), []);
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
