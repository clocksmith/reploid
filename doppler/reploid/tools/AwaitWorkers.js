/**
 * @fileoverview AwaitWorkers - Wait for workers to complete and get results
 */

import { withTimeout, TimeoutError } from '../core/async-utils.js';

async function call(args = {}, deps = {}) {
  const { WorkerManager } = deps;
  if (!WorkerManager) {
    throw new Error('WorkerManager not available (requires FULL SUBSTRATE genesis level)');
  }

  const { workerIds, all = false, timeoutMs = 300000 } = args; // Default 5 min timeout

  if (!all && (!workerIds || workerIds.length === 0)) {
    throw new Error('Must specify workerIds array or set all: true');
  }

  try {
    const results = await withTimeout(
      WorkerManager.awaitWorkers({ workerIds, all }),
      timeoutMs,
      'AwaitWorkers'
    );

    return {
      awaited: results.length,
      results,
      timedOut: false
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      // On timeout, try to get partial results
      const activeWorkers = WorkerManager.getActiveWorkers?.() || [];
      const completedWorkers = WorkerManager.getCompletedWorkers?.() || [];

      return {
        awaited: completedWorkers.length,
        results: completedWorkers,
        timedOut: true,
        timeoutMs,
        stillRunning: activeWorkers.map(w => w.id || w),
        message: `Timeout after ${timeoutMs}ms. ${completedWorkers.length} workers completed, ${activeWorkers.length} still running.`
      };
    }
    throw error;
  }
}

export const tool = {
  name: "AwaitWorkers",
  description: "Wait for worker agents to complete and return their results. Use after SpawnWorker to collect outputs. Returns partial results on timeout.",
  inputSchema: {
    type: 'object',
    properties: {
      workerIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific worker IDs to await'
      },
      all: {
        type: 'boolean',
        description: 'Wait for all active workers',
        default: false
      },
      timeoutMs: {
        type: 'number',
        description: 'Maximum time to wait in milliseconds (default: 300000 = 5 minutes)',
        default: 300000
      }
    }
  },
  call
};

export default call;
