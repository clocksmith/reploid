/**
 * @fileoverview Persistence-neutral durable-scheduler store contract.
 *
 * Job leases, pass records and obligation slots live in their own
 * collections on a transactional document backend with the credit ledger's
 * backend shape. The scheduler never writes another component's records; it
 * calls their operations.
 */

import { assertLedgerBackend } from '../ledger/store-contract.js';

export const SCHEDULER_OPERATIONS = Object.freeze(['runOnce', 'runJob', 'runLoop', 'getJob', 'listPasses']);

// Logical collection -> physical collection.
export const SCHEDULER_COLLECTIONS = Object.freeze({
  jobs: 'scheduler_jobs',
  passes: 'scheduler_passes',
  slots: 'scheduler_obligation_slots',
  cursors: 'scheduler_obligation_cursors'
});

export function validateSchedulerContract(scheduler) {
  const missing = SCHEDULER_OPERATIONS.filter((operation) => typeof scheduler?.[operation] !== 'function');
  return { ok: missing.length === 0, missing };
}

export function assertSchedulerContract(scheduler) {
  const { ok, missing } = validateSchedulerContract(scheduler);
  if (!ok) throw new TypeError(`Scheduler contract is incomplete: ${missing.join(', ')}`);
  return scheduler;
}

export const assertSchedulerBackend = (backend) => assertLedgerBackend(backend);

export default { SCHEDULER_OPERATIONS, SCHEDULER_COLLECTIONS, validateSchedulerContract, assertSchedulerContract, assertSchedulerBackend };
