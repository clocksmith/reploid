/**
 * @fileoverview Operator entry point for the durable scheduler.
 *
 * `composeScheduler` registers the sweep jobs for the component stores it is
 * given, plus contract obligations when the reward store and their ports are
 * given, and returns a scheduler over the explicit schedule. `runSchedulerPass`
 * runs one bounded round; `runScheduler` keeps running rounds until aborted.
 * Hosting (a process, a cron trigger or a manual invocation) is the
 * operator's choice; no route or hosted trigger is defined here.
 */

import { createScheduler } from './engine.js';
import { OBLIGATION_JOB_ID, createObligationJob } from './obligations.js';
import { createSweepJobs } from './sweeps.js';

/**
 * @param {object} options
 * @param {object} options.backend scheduler backend (see stores.js)
 * @param {object} options.schedule explicit schedule naming the jobs to run
 * @param {string} options.runnerId this runner's identity
 * @param {object} options.services { ledger, rewards, access, payments }; each optional
 * @param {object} [options.obligations] { transport, selectAcquirer, random } for contract obligations
 */
export function composeScheduler({ backend, schedule, runnerId, services = {}, obligations = null, clock, createId, wait } = {}) {
  const jobs = createSweepJobs(services);
  if (services.rewards && obligations) {
    jobs[OBLIGATION_JOB_ID] = createObligationJob({ backend, rewards: services.rewards, clock, ...obligations });
  }
  return createScheduler({
    backend, schedule, jobs, runnerId,
    ...(clock ? { clock } : {}), ...(createId ? { createId } : {}), ...(wait ? { wait } : {})
  });
}

/** Run every due job once and return each job's recorded pass or why it was skipped. */
export async function runSchedulerPass(options) {
  return composeScheduler(options).runOnce();
}

/** Run rounds until `signal` aborts; the schedule's intervals decide what is due. */
export async function runScheduler({ signal, maxRounds, ...options }) {
  return composeScheduler(options).runLoop({ signal, maxRounds });
}

export default { composeScheduler, runSchedulerPass, runScheduler };
