/**
 * @fileoverview AwaitWorkers - Wait for workers to complete and get results
 */

async function call(args = {}, deps = {}) {
  const { WorkerManager } = deps;
  if (!WorkerManager) {
    throw new Error('WorkerManager not available (requires FULL SUBSTRATE genesis level)');
  }

  const { workerIds, all = false } = args;

  if (!all && (!workerIds || workerIds.length === 0)) {
    throw new Error('Must specify workerIds array or set all: true');
  }

  const results = await WorkerManager.awaitWorkers({ workerIds, all });

  return {
    awaited: results.length,
    results
  };
}

export const tool = {
  name: "AwaitWorkers",
  description: "Wait for worker agents to complete and return their results. Use after SpawnWorker to collect outputs.",
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
      }
    }
  },
  call
};

export default call;
