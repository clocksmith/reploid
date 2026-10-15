/**
 * @fileoverview Durable scheduler: runs registered jobs at the intervals an
 * explicit schedule declares, under leases recorded in the store.
 *
 * A runner takes a job's lease in one transaction that also records the
 * pass as `running`; another runner sees the lease and skips the job until it
 * expires. A runner that died leaves its lease to expire: the next runner
 * marks that pass `abandoned` and runs the job again. Jobs are built from
 * idempotent operations that re-derive work from durable records, so a
 * repeated, overlapping or resumed pass has no second effect. A pass finishes
 * by recording its bounded item results, counts and next due time, fenced on
 * its lease id: a runner whose lease was taken records `lease_lost` and
 * changes nothing else. Jobs may renew the lease between items and stop when
 * it was lost.
 */

import { randomUUID } from 'node:crypto';

import { isNonEmptyString, toMs } from '../ledger/domain.js';
import {
  MAX_BATCH_LIMIT,
  PASS_SCHEMA,
  countItems,
  fail,
  isoAfter,
  leaseHeld,
  newJobState,
  passIdFor,
  validateSchedule
} from './domain.js';
import { assertSchedulerBackend, assertSchedulerContract } from './store-contract.js';

const defaultClock = () => new Date().toISOString();
const defaultCreateId = (prefix) => `${prefix}_${randomUUID()}`;
const defaultWait = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
});

const itemRecord = (item) => JSON.parse(JSON.stringify({
  ...item,
  ref: item?.ref ?? null,
  status: item?.status ?? null,
  ...(isNonEmptyString(item?.code) ? { code: item.code } : {})
}));

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend (see stores.js)
 * @param {object} options.schedule explicit schedule: { scheduleVersion, leaseMs,
 *   jobs: { [jobId]: { intervalMs, batchLimit, options? } } }; there is no default
 * @param {object} options.jobs registered jobs: { [jobId]: { run(ctx), validateOptions?(options) } },
 *   where run({ limit, options, lease, heartbeat }) -> { items: [{ ref, status, code? }], backlog }
 * @param {string} options.runnerId this runner's identity, recorded on its leases and passes
 */
export function createScheduler({ backend, schedule, jobs, runnerId, clock = defaultClock, createId = defaultCreateId, wait = defaultWait } = {}) {
  assertSchedulerBackend(backend);
  if (!isNonEmptyString(runnerId)) throw new TypeError('scheduler requires a runnerId');
  for (const [jobId, job] of Object.entries(jobs || {})) {
    if (typeof job?.run !== 'function') throw new TypeError(`job ${jobId} has no run function`);
  }
  const active = validateSchedule(schedule, jobs || {});
  const jobIds = Object.keys(active.jobs);

  /** Take the job's lease and record the pass as running, or report why not. */
  const acquire = (jobId, config) => backend.runTransaction(async (tx) => {
    const now = clock();
    const state = (await tx.get('jobs', jobId)) ?? newJobState(jobId);
    const previous = state.lease ? await tx.get('passes', state.lease.passId) : null;
    if (leaseHeld(state.lease, now)) {
      return { acquired: false, status: 'lease_held', holder: state.lease.runnerId, expiresAt: state.lease.expiresAt };
    }
    if (state.nextDueAt && toMs(now) < toMs(state.nextDueAt)) return { acquired: false, status: 'not_due', nextDueAt: state.nextDueAt };
    const seq = state.passes + 1;
    const passId = passIdFor(jobId, seq);
    const lease = { leaseId: createId('lease'), passId, runnerId, acquiredAt: now, expiresAt: isoAfter(now, active.leaseMs) };
    // A pass still running under an expired lease belonged to a runner that stopped.
    const recovered = previous?.status === 'running'
      ? { passId: previous.passId, runnerId: previous.runnerId, leaseExpiredAt: state.lease.expiresAt }
      : null;
    const pass = {
      schema: PASS_SCHEMA, passId, jobId, seq, runnerId, leaseId: lease.leaseId, scheduleVersion: active.scheduleVersion,
      batchLimit: config.batchLimit, status: 'running', startedAt: now, finishedAt: null, recovered,
      counts: null, items: [], backlog: null, error: null, nextDueAt: null
    };
    if (recovered) tx.set('passes', previous.passId, { ...previous, status: 'abandoned', finishedAt: now, abandonedBy: { runnerId, passId } });
    tx.create('passes', passId, pass);
    tx.set('jobs', jobId, { ...state, passes: seq, lease, updatedAt: now });
    return { acquired: true, pass, lease };
  });

  /** Extend a held lease; false when another runner took it. */
  const heartbeat = (jobId, leaseId) => backend.runTransaction(async (tx) => {
    const state = await tx.get('jobs', jobId);
    if (state?.lease?.leaseId !== leaseId) return false;
    const now = clock();
    tx.set('jobs', jobId, { ...state, lease: { ...state.lease, expiresAt: isoAfter(now, active.leaseMs) }, updatedAt: now });
    return true;
  });

  /** Record the pass outcome; only the lease holder releases the lease and sets the next due time. */
  const finish = (jobId, config, { pass: started, lease }, outcome) => backend.runTransaction(async (tx) => {
    const state = await tx.get('jobs', jobId);
    const pass = await tx.get('passes', started.passId);
    const now = clock();
    const items = outcome.items.slice(0, MAX_BATCH_LIMIT).map(itemRecord);
    const owned = state?.lease?.leaseId === lease.leaseId;
    const status = !owned ? 'lease_lost' : outcome.error ? 'failed' : 'completed';
    const backlog = status === 'completed' && outcome.backlog === true;
    const nextDueAt = owned ? (backlog ? now : isoAfter(started.startedAt, config.intervalMs)) : null;
    const counts = countItems(items);
    const record = { ...pass, status, finishedAt: now, counts, items, backlog, error: outcome.error ?? null, nextDueAt };
    tx.set('passes', started.passId, record);
    if (owned) {
      tx.set('jobs', jobId, {
        ...state, lease: null, nextDueAt,
        lastPass: { passId: started.passId, status, finishedAt: now, counts, backlog },
        consecutiveFailures: status === 'failed' ? state.consecutiveFailures + 1 : 0,
        updatedAt: now
      });
    }
    return record;
  });

  const scheduler = {
    schedule: active,
    runnerId,

    /** Run one job if it is due and its lease is free; returns the recorded pass summary or why it was skipped. */
    async runJob(jobId) {
      const config = active.jobs[jobId];
      if (!config) fail('unknown_job', `job ${jobId} is not in the schedule`, { jobId });
      const acquired = await acquire(jobId, config);
      if (!acquired.acquired) {
        const { acquired: _ignored, ...skipped } = acquired;
        return { jobId, ...skipped };
      }
      let outcome;
      try {
        const result = await jobs[jobId].run({
          limit: config.batchLimit,
          options: config.options,
          lease: { leaseId: acquired.lease.leaseId, passId: acquired.pass.passId, runnerId },
          heartbeat: () => heartbeat(jobId, acquired.lease.leaseId)
        });
        outcome = { items: Array.isArray(result?.items) ? result.items : [], backlog: result?.backlog === true };
      } catch (error) {
        outcome = {
          items: Array.isArray(error?.items) ? error.items : [],
          error: { code: isNonEmptyString(error?.code) ? error.code : 'job_failed', message: String(error?.message ?? error) }
        };
      }
      const record = await finish(jobId, config, acquired, outcome);
      return { jobId, status: record.status, passId: record.passId, counts: record.counts, backlog: record.backlog, error: record.error };
    },

    /** One bounded round: each configured job in schedule order, run when due. */
    async runOnce() {
      const results = [];
      for (const jobId of jobIds) results.push(await scheduler.runJob(jobId));
      return results;
    },

    /**
     * Run rounds until `signal` aborts (or `maxRounds`), sleeping until the
     * earliest next due time or lease expiry, and never longer than the
     * shortest configured interval. Hosting decides how this runs.
     */
    async runLoop({ signal = null, maxRounds = Infinity, maxSleepMs = Math.min(...jobIds.map((jobId) => active.jobs[jobId].intervalMs)) } = {}) {
      let rounds = 0;
      while (!signal?.aborted && rounds < maxRounds) {
        await scheduler.runOnce();
        rounds += 1;
        if (signal?.aborted || rounds >= maxRounds) break;
        const states = await Promise.all(jobIds.map((jobId) => backend.get('jobs', jobId)));
        const nowMs = toMs(clock());
        const dues = states.map((state) => {
          if (state?.lease) return toMs(state.lease.expiresAt);
          return state?.nextDueAt ? toMs(state.nextDueAt) : nowMs;
        });
        await wait(Math.max(0, Math.min(maxSleepMs, ...dues.map((due) => due - nowMs))), signal);
      }
      return { rounds };
    },

    async getJob(jobId) {
      return backend.get('jobs', jobId);
    },

    /** Recorded passes of one job, newest first. */
    async listPasses({ jobId, limit = 20 } = {}) {
      if (!active.jobs[jobId]) fail('unknown_job', `job ${jobId} is not in the schedule`, { jobId });
      return (await backend.list('passes', { field: 'jobId', value: jobId }))
        .sort((left, right) => right.seq - left.seq)
        .slice(0, limit);
    }
  };
  return assertSchedulerContract(scheduler);
}

export default createScheduler;
