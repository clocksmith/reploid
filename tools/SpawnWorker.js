/**
 * @fileoverview SpawnWorker - Spawn an isolated worker agent
 * Part of the Brains + Muscles architecture
 */

async function call(args = {}, deps = {}) {
  const { WorkerManager } = deps;
  if (!WorkerManager) {
    throw new Error('WorkerManager not available (requires FULL SUBSTRATE genesis level)');
  }

  const { type = 'explore', task, model, maxIterations } = args;

  if (!task) {
    throw new Error('Missing task argument - describe what the worker should do');
  }

  // Validate worker type
  const validTypes = ['explore', 'analyze', 'execute'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid worker type: ${type}. Must be one of: ${validTypes.join(', ')}`);
  }

  // Spawn the worker (depth=0 since this is called from main agent)
  const { workerId, promise } = await WorkerManager.spawn({
    type,
    task,
    model,
    maxIterations,
    depth: 0
  });

  return {
    workerId,
    type,
    status: 'spawned',
    message: `Worker ${workerId} spawned as ${type} agent. Use AwaitWorkers to get results.`
  };
}

export const tool = {
  name: "SpawnWorker",
  description: "Spawn an isolated worker agent for parallel task execution. Workers run in separate threads and cannot spawn other workers (flat hierarchy). Types: explore (read-only), analyze (read+draft), execute (full RSI).",
  inputSchema: {
    type: 'object',
    required: ['task'],
    properties: {
      type: {
        type: 'string',
        enum: ['explore', 'analyze', 'execute'],
        description: 'Worker type: explore (read-only), analyze (read+draft), execute (full RSI)',
        default: 'explore'
      },
      task: {
        type: 'string',
        description: 'Task description for the worker to execute'
      },
      model: {
        type: 'string',
        description: 'Optional model role override (fast, code, orchestrator)'
      },
      maxIterations: {
        type: 'number',
        description: 'Optional iteration cap for the worker'
      }
    }
  },
  call
};

export default call;
