#!/usr/bin/env node
/**
 * The earning composition's durable scheduler as its own process, for cron, Cloud Run Jobs or any host that
 * runs a command (REPLOID_EARNING_SCHEDULER=external on the server). It composes from the same environment and
 * policy file as the server, over the same store, and runs the policy's schedule:
 *
 *   node server/earning-composition/run-scheduler.js --once   one round of every due job, then exit
 *   node server/earning-composition/run-scheduler.js --loop   rounds until SIGINT or SIGTERM
 *
 * Each round prints one JSON line per job (ran, not due, or its lease held by another runner). Runners share
 * leases in the store, so this may run beside an in-process runner; a job runs on one at a time.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { isProductionMode } from '../earning-routes/mount.js';
import { createEarningComposition } from './index.js';

/**
 * @param {object} options
 * @param {object} [options.env]
 * @param {boolean} [options.once] one round; otherwise rounds until `signal` aborts
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.ports] composition ports for tests (firestore, clock, wait, log)
 * @returns {Promise<object[]>} the last round's per-job results (once), or [] (loop)
 */
export async function runEarningScheduler({ env = process.env, once = true, signal = null, ports = {}, report = (line) => console.log(JSON.stringify(line)) } = {}) {
  if (env.REPLOID_EARNING_STORE === 'memory') throw Object.assign(new Error('the scheduler process needs the firestore store the server uses'), { code: 'scheduler_store_unshared' });
  const composition = await createEarningComposition({ env, production: isProductionMode(env), ports: { ...ports, hostScheduler: false } });
  if (!composition.scheduler) throw Object.assign(new Error('the policy declares no scheduler section'), { code: 'scheduler_policy_required' });
  if (once) {
    const results = await composition.scheduler.runOnce();
    for (const result of results) report({ event: 'scheduler-job', runnerId: composition.scheduler.runnerId, ...result });
    return results;
  }
  await composition.scheduler.runLoop({ signal });
  return [];
}

async function main() {
  const { values } = parseArgs({ options: { once: { type: 'boolean', default: false }, loop: { type: 'boolean', default: false } } });
  if (values.once === values.loop) throw new Error('Choose --once (one round, for cron or a job) or --loop (a long-running process)');
  const controller = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => controller.abort());
  await runEarningScheduler({ once: values.once, signal: controller.signal });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
