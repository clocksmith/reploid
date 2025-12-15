/**
 * @fileoverview Worker Agent
 * Minimal agent loop that runs inside a Web Worker for isolated task execution.
 * Receives task + allowed tools via postMessage, returns results.
 * Cannot spawn workers (flat hierarchy enforced via depth check).
 */

// Web Worker context - no DOM access, no shared state
self.onmessage = async (e) => {
  const {
    workerId,
    type,
    task,
    model,
    allowedTools,
    maxIterations = 20,
    depth,
    config
  } = e.data;

  // Safety check: Workers cannot spawn other workers
  if (depth > 1) {
    self.postMessage({
      type: 'error',
      workerId,
      error: 'Workers cannot spawn other workers (flat hierarchy enforced)'
    });
    return;
  }

  try {
    self.postMessage({ type: 'started', workerId });

    // Import required modules (these will be loaded from VFS via Service Worker)
    // Note: In Web Worker context, we need to import dynamically
    const result = await executeWorkerTask({
      workerId,
      type,
      task,
      model,
      allowedTools,
      maxIterations,
      config
    });

    self.postMessage({
      type: 'complete',
      workerId,
      result
    });

  } catch (error) {
    self.postMessage({
      type: 'error',
      workerId,
      error: error.message,
      stack: error.stack
    });
  }
};

/**
 * Execute the worker's task with a simplified agent loop
 */
async function executeWorkerTask({ workerId, type, task, model, allowedTools, maxIterations, config }) {
  const startTime = Date.now();
  let iterations = 0;
  const toolResults = [];

  // Progress reporting
  const reportProgress = (message) => {
    self.postMessage({
      type: 'progress',
      workerId,
      iteration: iterations,
      message
    });
  };

  reportProgress(`Starting ${type} worker for task: ${task.substring(0, 50)}...`);

  // For Phase 3 stub: Return placeholder result
  // TODO: Implement full agent loop with:
  // 1. LLM call with task + allowed tools
  // 2. Tool execution with permission filtering
  // 3. Result aggregation
  // 4. Iteration until done or maxIterations

  // Placeholder implementation
  await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work

  return {
    workerId,
    type,
    task: task.substring(0, 100),
    iterations,
    duration: Date.now() - startTime,
    status: 'completed',
    output: `[Worker ${workerId}] Placeholder result - full implementation in Phase 3`,
    allowedTools: Array.isArray(allowedTools) ? allowedTools : 'ALL',
    note: 'Web Worker agent loop not yet fully implemented'
  };
}

/**
 * Filter tools based on worker type permissions
 */
function filterTools(allTools, allowedTools) {
  if (allowedTools === '*') return allTools;
  return allTools.filter(tool => allowedTools.includes(tool.name || tool));
}

/**
 * Simple tool execution within worker context
 * Only allowed tools can be executed
 */
async function executeToolInWorker(toolName, args, allowedTools, toolImplementations) {
  // Check permission
  if (allowedTools !== '*' && !allowedTools.includes(toolName)) {
    throw new Error(`Tool '${toolName}' not allowed for this worker type`);
  }

  const tool = toolImplementations[toolName];
  if (!tool) {
    throw new Error(`Tool '${toolName}' not found`);
  }

  return await tool(args);
}
