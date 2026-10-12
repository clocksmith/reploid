import { test, expect } from 'vitest';
import { observePartitionAttemptCleanup } from '../fixtures/partition-attempt-cleanup.js';
test('a failed observation and close do not skip settlement or the other executor', async () => {
  const calls = [[], []];
  const pages = calls.map((rows, index) => ({ evaluate: async (_fn, argument) => {
    rows.push(argument); const stage = rows.length - 1;
    if (index === 0 && stage < 3) throw new Error(['device lost', 'close failed', 'queue failed'][stage]);
    return stage === 3 ? ['observed chunk'] : { settled: true };
  } }));
  const result = await observePartitionAttemptCleanup(pages, { attemptId: 'original' });
  expect(calls.map(rows => rows.length)).toEqual([4, 4]);
  expect(calls.map(rows => rows[1])).toEqual([{ attemptId: 'original' }, { attemptId: 'original' }]);
  expect(result.cleanupErrors.map(row => row.stage)).toEqual(['snapshot-before-close', 'close-attempt', 'settlement']);
  expect(result.after[1]).toEqual({ settled: true });
  expect(result.chunks[0]).toEqual(['observed chunk']);
});
test('successful cleanup retains the established receipt arrays', async () => {
  const result = await observePartitionAttemptCleanup([{ evaluate: async () => ({ observed: true }) }], {});
  expect(result.cleanupErrors).toEqual([]);
  expect(result.beforeClose).toHaveLength(1); expect(result.after).toHaveLength(1); expect(result.chunks).toHaveLength(1);
});
