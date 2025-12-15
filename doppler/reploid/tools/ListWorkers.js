/**
 * @fileoverview ListWorkers - List all active and completed workers
 */

async function call(args = {}, deps = {}) {
  const { WorkerManager } = deps;
  if (!WorkerManager) {
    throw new Error('WorkerManager not available (requires FULL SUBSTRATE genesis level)');
  }

  const { includeCompleted = false } = args;

  const active = WorkerManager.list();
  const result = {
    active,
    activeCount: active.length
  };

  if (includeCompleted) {
    const completed = WorkerManager.getResults();
    result.completed = completed;
    result.completedCount = completed.length;
  }

  return result;
}

export const tool = {
  name: "ListWorkers",
  description: "List all active worker agents and optionally completed workers",
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      includeCompleted: {
        type: 'boolean',
        description: 'Include completed workers in the result',
        default: false
      }
    }
  },
  call
};

export default call;
