// @vitest-environment node
import { expect, it } from 'vitest';
import { ReploidError } from '../../packages/reploid/src/contracts/error.js';
import { RetrievalError } from '../../packages/reploid/src/retrieval/index.js';
import { TimeoutError, RetryExhaustedError } from '../../packages/reploid/src/agent/tool-operation-retry.js';
import { ConfigurationError } from '../../packages/reploid/src/config/index.js';
import { partitionFailure } from '../../packages/reploid/src/contracts/partition.js';
import { AccountError } from '../../server/accounts/domain.js';
import { LedgerError } from '../../server/ledger/domain.js';
import { PaymentError } from '../../server/payments/domain.js';
import { RewardError } from '../../server/rewards/domain.js';
import { SchedulerError } from '../../server/scheduler/domain.js';
import { CommunityAccessError } from '../../server/community-access/domain.js';

it.each([AccountError, LedgerError, PaymentError, RewardError, SchedulerError, CommunityAccessError])(
  'preserves domain errors while exposing one local operational identity: %s', DomainError => {
    const details = { attemptId: 'attempt' };
    const error = new DomainError('storage_conflict', 'retry the transaction', details);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ReploidError);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ name: DomainError.name, code: 'storage_conflict', message: 'retry the transaction', details });
    expect(typeof error.retryable).toBe('boolean');
  });
it('keeps partition codes, retrieval codes and retry metadata without string matching', () => {
  const error = partitionFailure('CAPACITY_UNAVAILABLE', { bound: 2 });
  expect(error).toBeInstanceOf(ReploidError);
  expect(error).toMatchObject({ name: 'Error', code: 'CAPACITY_UNAVAILABLE', bound: 2 });
  const retrieved = new RetrievalError('timeout', { provider: 'public' });
  expect(retrieved).toBeInstanceOf(ReploidError);
  expect(retrieved).toMatchObject({ code: 'timeout', detail: { provider: 'public' } });
  expect(() => new RetrievalError('unknown')).toThrow('Unknown retrieval failure code');
  const timeout = new TimeoutError('deadline');
  expect(timeout).toBeInstanceOf(ReploidError);
  expect(timeout).toMatchObject({ name: 'TimeoutError', isTimeout: true });
  const exhausted = new RetryExhaustedError('finished', 3, timeout);
  expect(exhausted).toBeInstanceOf(ReploidError);
  expect(exhausted).toMatchObject({ name: 'RetryExhaustedError', attempts: 3, lastError: timeout });
});
it('retains configuration as a TypeError and preserves native causes for operational errors', () => {
  const config = new ConfigurationError('agent.maxCycles', 'must be positive');
  expect(config).toBeInstanceOf(TypeError);
  expect(config).toMatchObject({ name: 'ConfigurationError', path: 'agent.maxCycles' });
  const cause = new Error('underlying');
  expect(new ReploidError('operation failed', { cause, code: 'LOCAL_FAILURE' })).toMatchObject({ cause, code: 'LOCAL_FAILURE' });
  expect(new Error('defect')).not.toBeInstanceOf(ReploidError);
});
