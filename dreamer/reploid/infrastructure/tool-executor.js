/**
 * @fileoverview Tool Executor - Shared tool execution with retry, timeout, and batching
 * Used by AgentLoop and WorkerManager for consistent tool execution behavior.
 */

const ToolExecutor = {
  metadata: {
    id: 'ToolExecutor',
    version: '1.0.0',
    genesis: { introduced: 'reflection' },
    dependencies: ['Utils', 'ToolRunner', 'EventBus?'],
    async: false,
    type: 'utility'
  },

  factory: (deps) => {
    const { Utils, ToolRunner, EventBus } = deps;
    const { logger } = Utils;

    // Default configuration
    const DEFAULT_TIMEOUT_MS = 30000;  // 30s per tool
    const DEFAULT_MAX_RETRIES = 2;
    const DEFAULT_RETRY_DELAY_MS = 100;

    /**
     * Execute a single tool with timeout
     * @param {string} name - Tool name
     * @param {Object} args - Tool arguments
     * @param {Object} [options] - Execution options
     * @param {number} [options.timeoutMs] - Timeout in ms
     * @returns {Promise<any>} Tool result
     */
    const executeWithTimeout = async (name, args, options = {}) => {
      const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;

      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Tool timeout after ${timeoutMs}ms`)), timeoutMs);
      });

      try {
        const result = await Promise.race([
          ToolRunner.execute(name, args, options),
          timeoutPromise
        ]);
        return result;
      } finally {
        clearTimeout(timeoutId);  // Always clear timeout to prevent memory leak
      }
    };

    /**
     * Execute a tool with retry logic and timeout
     * @param {Object} call - Tool call { name, args }
     * @param {Object} [options] - Execution options
     * @param {number} [options.timeoutMs] - Timeout per attempt
     * @param {number} [options.maxRetries] - Max retry attempts
     * @param {number} [options.retryDelayMs] - Base delay between retries
     * @param {number} [options.iteration] - Current agent iteration (for events)
     * @param {string} [options.workerId] - Worker ID (for worker context)
     * @param {string[]|'*'} [options.allowedTools] - Allowed tools filter
     * @returns {Promise<{result: string, error: Error|null, duration: number}>}
     */
    const executeWithRetry = async (call, options = {}) => {
      const {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        maxRetries = DEFAULT_MAX_RETRIES,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
        iteration = 0,
        workerId = null,
        allowedTools = '*'
      } = options;

      let result = null;
      let lastError = null;
      const startTime = Date.now();

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const toolStartTime = Date.now();
          const rawResult = await executeWithTimeout(call.name, call.args, {
            timeoutMs,
            workerId,
            allowedTools
          });
          const toolDuration = Date.now() - toolStartTime;

          // Warn on slow tools
          if (toolDuration > timeoutMs * 0.7) {
            logger.warn(`[ToolExecutor] Slow tool: ${call.name} took ${toolDuration}ms`);
            if (EventBus) {
              EventBus.emit('tool:slow', { tool: call.name, ms: toolDuration, cycle: iteration, workerId });
            }
          }

          // Stringify result
          result = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
          if (result === 'undefined' || result === undefined) {
            result = '(Tool returned no output)';
          }
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const isTimeout = err.message?.includes('timeout');

          if (isTimeout) {
            logger.error(`[ToolExecutor] Tool ${call.name} TIMEOUT - exceeded ${timeoutMs}ms`);
            result = `Error: Tool execution timed out after ${timeoutMs / 1000}s. The operation may still be running.`;
            if (EventBus) {
              EventBus.emit('tool:timeout', { tool: call.name, timeout: timeoutMs, cycle: iteration, workerId });
            }
            break;
          }

          if (attempt < maxRetries) {
            logger.warn(`[ToolExecutor] Tool ${call.name} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying...`);
            await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
          }
        }
      }

      return {
        result,
        error: lastError,
        duration: Date.now() - startTime
      };
    };

    /**
     * Execute multiple tools in parallel
     * @param {Object[]} calls - Array of { name, args } tool calls
     * @param {Object} [options] - Execution options (same as executeWithRetry)
     * @returns {Promise<Array<{call: Object, result: string, error: Error|null, duration: number}>>}
     */
    const executeBatch = async (calls, options = {}) => {
      const results = await Promise.all(
        calls.map(async (call) => {
          const { result, error, duration } = await executeWithRetry(call, options);
          return { call, result, error, duration };
        })
      );
      return results;
    };

    /**
     * Execute tools with readOnly/mutating split
     * ReadOnly tools run in parallel, mutating tools run sequentially after
     * @param {Object[]} calls - Tool calls
     * @param {Set<string>} readOnlyTools - Set of tool names that are read-only
     * @param {Object} [options] - Execution options
     * @returns {Promise<{results: Array, readOnlyResults: Array, mutatingResults: Array, telemetry: string[]}>}
     */
    const executeWithParallelization = async (calls, readOnlyTools, options = {}) => {
      const readOnlyCalls = calls.filter(c => readOnlyTools.has(c.name));
      const mutatingCalls = calls.filter(c => !readOnlyTools.has(c.name));

      const telemetry = [];
      const results = [];

      // Execute read-only tools in parallel
      if (readOnlyCalls.length > 0) {
        const batchResults = await executeBatch(readOnlyCalls, options);
        results.push(...batchResults);
        if (readOnlyCalls.length > 1) {
          telemetry.push(`${readOnlyCalls.length} read-only tools in parallel`);
        }
      }

      // Execute mutating tools sequentially
      for (const call of mutatingCalls) {
        const { result, error, duration } = await executeWithRetry(call, options);
        results.push({ call, result, error, duration });
      }

      if (mutatingCalls.length > 0) {
        telemetry.push(`${mutatingCalls.length} mutating tool${mutatingCalls.length > 1 ? 's' : ''} sequential`);
      }

      return {
        results,
        readOnlyResults: results.filter(r => readOnlyTools.has(r.call.name)),
        mutatingResults: results.filter(r => !readOnlyTools.has(r.call.name)),
        telemetry
      };
    };

    /**
     * Format tool result for context message
     * @param {string} toolName - Tool name
     * @param {string} result - Tool result
     * @param {Error|null} error - Error if any
     * @returns {string} Formatted message
     */
    const formatResultForContext = (toolName, result, error) => {
      if (error) {
        return `Error executing ${toolName}: ${error.message}`;
      }
      return `Result of ${toolName}:\n${result}`;
    };

    return {
      executeWithTimeout,
      executeWithRetry,
      executeBatch,
      executeWithParallelization,
      formatResultForContext,
      DEFAULT_TIMEOUT_MS,
      DEFAULT_MAX_RETRIES
    };
  }
};

export default ToolExecutor;
