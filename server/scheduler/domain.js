/**
 * @fileoverview Pure durable-scheduler rules: explicit schedule configuration,
 * job and pass records, and lease arithmetic.
 *
 * Nothing here performs I/O or supplies an interval, batch size or lease
 * length; the schedule is explicit operator configuration.
 */

import { isNonEmptyString, sha256Hex, toMs } from '../ledger/domain.js';

export const SCHEDULE_SCHEMA = 'reploid.scheduler-schedule/v1';
export const JOB_SCHEMA = 'reploid.scheduler-job/v1';
export const PASS_SCHEMA = 'reploid.scheduler-pass/v1';
export const SLOT_SCHEMA = 'reploid.obligation-slot/v1';
export const CURSOR_SCHEMA = 'reploid.obligation-cursor/v1';
// Structural bound that keeps one pass record small; not product policy.
export const MAX_BATCH_LIMIT = 1000;
export const PASS_STATUSES = Object.freeze(['running', 'completed', 'failed', 'lease_lost', 'abandoned']);

const RETRYABLE_CODES = new Set(['storage_conflict']);

export class SchedulerError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'SchedulerError';
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export const fail = (code, message, details) => {
  throw new SchedulerError(code, message, details);
};

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const unknownKeys = (value, allowed, label, errors) => {
  for (const key of Object.keys(value || {})) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not a recognized field`);
  }
};

/**
 * Validate the explicit schedule against the registered jobs. Every
 * configured job must be registered; a registered job the schedule does not
 * name never runs. `jobs[id].options` goes to that job's own validator.
 */
export function validateSchedule(schedule, registered) {
  const errors = [];
  if (!schedule || typeof schedule !== 'object') fail('invalid_schedule', 'schedule configuration is required', { errors: ['schedule missing'] });
  unknownKeys(schedule, ['scheduleVersion', 'leaseMs', 'jobs'], 'schedule', errors);
  if (!isNonEmptyString(schedule.scheduleVersion)) errors.push('schedule.scheduleVersion is required');
  if (!isPositiveInteger(schedule.leaseMs)) errors.push('schedule.leaseMs must be a positive integer');
  const entries = Object.entries(schedule.jobs || {});
  if (!entries.length) errors.push('schedule.jobs must configure at least one job');
  const jobs = {};
  for (const [jobId, config] of entries) {
    const path = `schedule.jobs.${jobId}`;
    const job = registered[jobId];
    if (!job) {
      errors.push(`${path} names no registered job`);
      continue;
    }
    unknownKeys(config, ['intervalMs', 'batchLimit', 'options'], path, errors);
    if (!isPositiveInteger(config?.intervalMs)) errors.push(`${path}.intervalMs must be a positive integer`);
    if (!isPositiveInteger(config?.batchLimit) || config.batchLimit > MAX_BATCH_LIMIT) {
      errors.push(`${path}.batchLimit must be a positive integer of at most ${MAX_BATCH_LIMIT}`);
    }
    let options = null;
    if (typeof job.validateOptions === 'function') {
      const problems = job.validateOptions(config?.options);
      problems.forEach((problem) => errors.push(`${path}.options: ${problem}`));
      options = config?.options ?? null;
    } else if (config?.options !== undefined) {
      errors.push(`${path}.options is not accepted by this job`);
    }
    jobs[jobId] = { intervalMs: config?.intervalMs, batchLimit: config?.batchLimit, options };
  }
  if (errors.length) fail('invalid_schedule', 'schedule configuration is incomplete or names unknown jobs', { errors });
  return Object.freeze(JSON.parse(JSON.stringify({ schema: SCHEDULE_SCHEMA, scheduleVersion: schedule.scheduleVersion, leaseMs: schedule.leaseMs, jobs })));
}

export const passIdFor = (jobId, seq) => `${jobId}~${String(seq).padStart(10, '0')}`;
export const leaseHeld = (lease, now) => Boolean(lease) && toMs(now) < toMs(lease.expiresAt);
export const isoAfter = (at, ms) => new Date(toMs(at) + ms).toISOString();

export const newJobState = (jobId) => ({
  schema: JOB_SCHEMA, jobId, passes: 0, lease: null, nextDueAt: null, lastPass: null, consecutiveFailures: 0, updatedAt: null
});

/** Summarize a job's item results: each item is { ref, status, code? }; an item with a code failed. */
export function countItems(items) {
  const failed = items.filter((item) => isNonEmptyString(item.code)).length;
  return { processed: items.length, succeeded: items.length - failed, failed };
}

// Deterministic, doc-id safe identifiers for obligation slots and cursors.
export const slotIdFor = (offerId, kind, intervalIndex) => `slot_${sha256Hex(`${offerId}\u0000${kind}\u0000${intervalIndex}`).slice(0, 32)}`;
export const cursorIdFor = (offerId, kind) => `cursor_${sha256Hex(`${offerId}\u0000${kind}`).slice(0, 32)}`;

export default { validateSchedule, passIdFor, leaseHeld, countItems };
