/**
 * @fileoverview SpawnWorker - Spawn an isolated worker agent
 * Part of the Brains + Muscles architecture
 */

import { withTimeoutAndRetry, TimeoutError, RetryExhaustedError } from '../core/async-utils.js';

async function call(args = {}, deps = {}) {
  const { WorkerManager } = deps;
  if (!WorkerManager) {
    throw new Error('WorkerManager not available (requires FULL SUBSTRATE genesis level)');
  }

  const {
    type = 'explore',
    task,
    model,
    maxIterations,
    spawnTimeoutMs = 30000, // 30 second timeout for spawn
    maxRetries = 2
  } = args;

  if (!task) {
    throw new Error('Missing task argument - describe what the worker should do');
  }

  // Validate worker type
  const validTypes = ['explore', 'analyze', 'execute'];
  if (!validTypes.includes(type)) {
    throw new Error(`Invalid worker type: ${type}. Must be one of: ${validTypes.join(', ')}`);
  }

  try {
    // Spawn the worker with timeout and retry (depth=0 since this is called from main agent)
    const { workerId, promise } = await withTimeoutAndRetry(
      async () => WorkerManager.spawn({
        type,
        task,
        model,
        maxIterations,
        depth: 0
      }),
      {
        timeoutMs: spawnTimeoutMs,
        maxAttempts: maxRetries + 1,
        operationName: 'SpawnWorker',
        initialDelayMs: 500,
        onRetry: (error, attempt, delay) => {
          console.warn(`[SpawnWorker] Retry ${attempt} after ${delay}ms: ${error.message}`);
        }
      }
    );

    return {
      workerId,
      type,
      status: 'spawned',
      message: `Worker ${workerId} spawned as ${type} agent. Use AwaitWorkers to get results.`
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new Error(`Worker spawn timed out after ${spawnTimeoutMs}ms. The worker pool may be overloaded.`);
    }
    if (error instanceof RetryExhaustedError) {
      throw new Error(`Worker spawn failed after ${maxRetries + 1} attempts: ${error.lastError?.message || 'Unknown error'}`);
    }
    throw error;
  }
}

export const tool = {
  name: "SpawnWorker",
  description: "Spawn an isolated worker agent for parallel task execution. Workers run in separate threads and cannot spawn other workers (flat hierarchy). Types: explore (read-only), analyze (read+draft), execute (full RSI). Includes timeout and retry for resilience.",
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
      },
      spawnTimeoutMs: {
        type: 'number',
        description: 'Timeout for worker spawn in milliseconds (default: 30000)',
        default: 30000
      },
      maxRetries: {
        type: 'number',
        description: 'Maximum spawn retries on failure (default: 2)',
        default: 2
      }
    }
  },
  call
};

export default call;
