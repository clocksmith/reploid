/**
 * @fileoverview Hosting the durable scheduler (server/scheduler) for the
 * earning composition. The schedule (version, lease and each job's interval
 * and batch) comes only from the policy file's `scheduler` section; this
 * module chooses how the runner is hosted and refuses compositions whose
 * deferred work would never run.
 *
 *   REPLOID_EARNING_SCHEDULER=in-process   the server runs the runner loop itself (a long-lived server)
 *   REPLOID_EARNING_SCHEDULER=external     an operator runs `node server/earning-composition/run-scheduler.js --once`
 *                                          from cron or a job (or `--loop` as its own process)
 *   REPLOID_EARNING_SCHEDULER_RUNNER_ID    optional runner identity recorded on leases and passes
 *
 * Runners share leases in the composition's own store, so any number of them
 * may run; a job runs on one at a time and its operations are idempotent.
 */

import { randomUUID } from 'node:crypto';

import { composeScheduler } from '../scheduler/operator.js';

export const SCHEDULER_HOSTING_MODES = Object.freeze(['in-process', 'external']);

const configError = (code, message) => Object.assign(new Error(message), { name: 'EarningPolicyError', code });

/** The declared hosting mode, or null when none is declared. */
export function readSchedulerHosting(env = {}) {
  const value = typeof env.REPLOID_EARNING_SCHEDULER === 'string' ? env.REPLOID_EARNING_SCHEDULER.trim() : '';
  if (!value) return null;
  if (!SCHEDULER_HOSTING_MODES.includes(value)) throw configError('setting_invalid', `REPLOID_EARNING_SCHEDULER must be ${SCHEDULER_HOSTING_MODES.join(' or ')}`);
  return value;
}

/**
 * Jobs a composition cannot do without: open holds must expire and rewards left pending must resume; with
 * evidence terms or Community Access, window decisions must settle; with Community Access, queued requests
 * must be admitted or expire; with payments, missed notifications must be polled.
 */
export function requiredJobs({ policy, payments }) {
  const evidence = policy.services.some((template) => template.terms.evidence !== undefined) || Boolean(policy.communityAccess);
  return [
    'ledger.expireReservations', 'rewards.resumeIssuance',
    ...(evidence ? ['ledger.settleDueEvidence'] : []),
    ...(policy.communityAccess ? ['community-access.admitWaiting', 'community-access.expireQueue', 'community-access.resumeFunding'] : []),
    ...(payments ? ['payments.pollPending'] : [])
  ];
}

/**
 * Before anything is opened: refuse a production composition with evidence terms or Community Access but no
 * hosting, a declared hosting without a schedule, and external hosting over a memory store.
 */
export function checkSchedulerHosting({ policy, hosting, production, storeKind }) {
  const evidence = policy.services.some((template) => template.terms.evidence !== undefined);
  if (production && !hosting && (evidence || policy.communityAccess)) {
    throw configError('scheduler_hosting_required',
      'evidence-terms quotes and Community Access need the durable scheduler: declare policy.scheduler and set REPLOID_EARNING_SCHEDULER=in-process '
      + '(a long-lived server runs it) or =external (run node server/earning-composition/run-scheduler.js --once from cron or a job)');
  }
  if (hosting && !policy.scheduler) throw configError('scheduler_policy_required', `REPLOID_EARNING_SCHEDULER=${hosting} needs the policy's scheduler section`);
  if (hosting === 'external' && storeKind === 'memory') {
    throw configError('scheduler_store_unshared', 'an external scheduler runs in another process and needs the firestore store');
  }
}

/**
 * Compose the scheduler over the composition's store, or null when the policy declares no schedule; a
 * schedule missing a required job, or naming a job this composition does not register, refuses to start.
 */
export function composeEarningScheduler({ policy, backend, services, clock, runnerId = null, wait = null }) {
  if (!policy.scheduler) return null;
  const missing = requiredJobs({ policy, payments: services.payments }).filter((jobId) => !policy.scheduler.jobs?.[jobId]);
  if (missing.length) throw configError('scheduler_jobs_required', `policy.scheduler.jobs must schedule ${missing.join(', ')}`);
  return composeScheduler({
    backend, schedule: policy.scheduler, runnerId: runnerId ?? `earning-${process.pid}-${randomUUID().slice(0, 8)}`,
    services: { ledger: services.ledger, rewards: services.rewards, access: services.communityAccess ?? undefined, payments: services.payments ?? undefined },
    clock, ...(wait ? { wait } : {})
  });
}

/**
 * Run the scheduler's loop in this process until stopped. A round that fails (a storage outage, say) is
 * logged and the loop resumes after the shortest interval; leases and idempotent jobs make that safe.
 */
export function hostSchedulerLoop(scheduler, { log = console, wait = null } = {}) {
  const controller = new AbortController();
  const intervals = Object.values(scheduler.schedule.jobs).map((job) => job.intervalMs);
  const pause = wait ?? ((ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  }));
  const done = (async () => {
    while (!controller.signal.aborted) {
      try {
        await scheduler.runLoop({ signal: controller.signal });
      } catch (error) {
        log.error?.('[Earning scheduler] round failed; retrying:', error?.code || error?.message);
        await pause(Math.min(...intervals), controller.signal);
      }
    }
  })();
  return Object.freeze({ runnerId: scheduler.runnerId, done, stop: () => { controller.abort(); return done; } });
}

export default { readSchedulerHosting, requiredJobs, checkSchedulerHosting, composeEarningScheduler, hostSchedulerLoop };
