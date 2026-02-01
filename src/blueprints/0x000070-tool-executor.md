# Blueprint 0x000087: Tool Executor

**Objective:** Shared tool execution with retry, timeout, and batching capabilities for robust tool invocation.

**Target Module:** `ToolExecutor` (TEXC)

**Implementation:** `/infrastructure/tool-executor.js`

**Prerequisites:** `0x000003` (Core Utilities), `0x00000A` (Tool Runner), `0x000058` (Event Bus)

**Category:** Infrastructure

**Genesis:** reflection

---

### 1. The Strategic Imperative

Tool execution in an agent system requires reliability guarantees beyond simple function calls. Without execution infrastructure:
- **No timeout protection** for hanging tool operations
- **No retry logic** for transient failures
- **No batching** for efficient bulk operations
- **No parallelization** strategy for concurrent tool execution
- **No standardized result formatting** for context inclusion

The Tool Executor provides execution wrappers that enhance tool invocations with timeouts, retries, batching, and smart parallelization based on tool characteristics.

### 2. The Architectural Solution

The `/infrastructure/tool-executor.js` implements **execution strategies** that wrap tool invocations with reliability patterns.

#### Module Structure

```javascript
const ToolExecutor = {
  metadata: {
    id: 'ToolExecutor',
    version: '1.0.0',
    dependencies: ['Utils', 'ToolRunner', 'EventBus'],
    async: false,
    type: 'infrastructure',
    genesis: 'reflection'
  },

  factory: (deps) => {
    const { Utils, ToolRunner, EventBus } = deps;
    const { logger } = Utils;

    // Default configuration
    const DEFAULT_TIMEOUT = 30000;  // 30 seconds
    const MAX_RETRIES = 2;

    /**
     * Execute a tool with timeout protection
     */
    const executeWithTimeout = async (toolName, args, timeout = DEFAULT_TIMEOUT) => {
      const startTime = Date.now();

      EventBus.emit('tool:executing', { tool: toolName, args, timeout });

      return new Promise(async (resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const error = new Error(`Tool execution timed out after ${timeout}ms`);
          error.code = 'EXECUTION_TIMEOUT';
          error.tool = toolName;

          EventBus.emit('tool:timeout', { tool: toolName, timeout });
          reject(error);
        }, timeout);

        try {
          const result = await ToolRunner.execute(toolName, args);
          clearTimeout(timeoutId);

          const duration = Date.now() - startTime;
          EventBus.emit('tool:executed', { tool: toolName, duration, success: true });

          resolve({
            success: true,
            result,
            duration,
            tool: toolName
          });
        } catch (error) {
          clearTimeout(timeoutId);

          const duration = Date.now() - startTime;
          EventBus.emit('tool:error', { tool: toolName, error: error.message, duration });

          reject(error);
        }
      });
    };

    /**
     * Execute a tool with retry logic
     */
    const executeWithRetry = async (toolName, args, options = {}) => {
      const {
        maxRetries = MAX_RETRIES,
        timeout = DEFAULT_TIMEOUT,
        retryDelay = 1000,
        shouldRetry = (error) => true
      } = options;

      let lastError;
      let attempts = 0;

      while (attempts <= maxRetries) {
        attempts++;

        try {
          EventBus.emit('tool:retry-attempt', {
            tool: toolName,
            attempt: attempts,
            maxRetries: maxRetries + 1
          });

          const result = await executeWithTimeout(toolName, args, timeout);

          if (attempts > 1) {
            EventBus.emit('tool:retry-success', {
              tool: toolName,
              attempts
            });
          }

          return result;
        } catch (error) {
          lastError = error;

          const isLastAttempt = attempts > maxRetries;
          const canRetry = !isLastAttempt && shouldRetry(error);

          if (canRetry) {
            logger.warn(`[ToolExecutor] Retry ${attempts}/${maxRetries + 1} for ${toolName}: ${error.message}`);
            await _delay(retryDelay * attempts); // Exponential backoff
          } else {
            break;
          }
        }
      }

      EventBus.emit('tool:retry-exhausted', {
        tool: toolName,
        attempts,
        error: lastError.message
      });

      throw lastError;
    };

    /**
     * Execute multiple tools in a batch
     */
    const executeBatch = async (toolCalls, options = {}) => {
      const {
        timeout = DEFAULT_TIMEOUT,
        stopOnError = false,
        maxRetries = 0
      } = options;

      const results = [];
      const startTime = Date.now();

      EventBus.emit('tool:batch-start', {
        count: toolCalls.length
      });

      for (const { tool, args } of toolCalls) {
        try {
          const executeOptions = maxRetries > 0
            ? { maxRetries, timeout }
            : {};

          const result = maxRetries > 0
            ? await executeWithRetry(tool, args, executeOptions)
            : await executeWithTimeout(tool, args, timeout);

          results.push({
            tool,
            success: true,
            result: result.result,
            duration: result.duration
          });
        } catch (error) {
          results.push({
            tool,
            success: false,
            error: error.message,
            code: error.code
          });

          if (stopOnError) {
            break;
          }
        }
      }

      const duration = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;

      EventBus.emit('tool:batch-complete', {
        count: toolCalls.length,
        successCount,
        failureCount: results.length - successCount,
        duration
      });

      return {
        results,
        summary: {
          total: toolCalls.length,
          executed: results.length,
          succeeded: successCount,
          failed: results.length - successCount,
          duration
        }
      };
    };

    /**
     * Execute tools with smart parallelization
     * - readOnly tools run in parallel
     * - mutating tools run sequentially
     */
    const executeWithParallelization = async (toolCalls, options = {}) => {
      const {
        timeout = DEFAULT_TIMEOUT,
        maxConcurrency = 5
      } = options;

      // Separate into read-only and mutating
      const readOnlyTools = toolCalls.filter(tc => _isReadOnly(tc.tool));
      const mutatingTools = toolCalls.filter(tc => !_isReadOnly(tc.tool));

      const results = [];
      const startTime = Date.now();

      EventBus.emit('tool:parallel-start', {
        readOnly: readOnlyTools.length,
        mutating: mutatingTools.length
      });

      // Execute read-only tools in parallel (with concurrency limit)
      if (readOnlyTools.length > 0) {
        const chunks = _chunk(readOnlyTools, maxConcurrency);

        for (const chunk of chunks) {
          const chunkResults = await Promise.allSettled(
            chunk.map(({ tool, args }) =>
              executeWithTimeout(tool, args, timeout)
            )
          );

          for (let i = 0; i < chunkResults.length; i++) {
            const { tool } = chunk[i];
            const settledResult = chunkResults[i];

            if (settledResult.status === 'fulfilled') {
              results.push({
                tool,
                success: true,
                result: settledResult.value.result,
                duration: settledResult.value.duration,
                parallel: true
              });
            } else {
              results.push({
                tool,
                success: false,
                error: settledResult.reason.message,
                code: settledResult.reason.code,
                parallel: true
              });
            }
          }
        }
      }

      // Execute mutating tools sequentially
      for (const { tool, args } of mutatingTools) {
        try {
          const result = await executeWithTimeout(tool, args, timeout);
          results.push({
            tool,
            success: true,
            result: result.result,
            duration: result.duration,
            parallel: false
          });
        } catch (error) {
          results.push({
            tool,
            success: false,
            error: error.message,
            code: error.code,
            parallel: false
          });
        }
      }

      const duration = Date.now() - startTime;
      const successCount = results.filter(r => r.success).length;

      EventBus.emit('tool:parallel-complete', {
        total: toolCalls.length,
        successCount,
        failureCount: results.length - successCount,
        duration
      });

      return {
        results,
        summary: {
          total: toolCalls.length,
          readOnly: readOnlyTools.length,
          mutating: mutatingTools.length,
          succeeded: successCount,
          failed: results.length - successCount,
          duration
        }
      };
    };

    /**
     * Format tool result for LLM context
     */
    const formatResultForContext = (result, options = {}) => {
      const {
        maxLength = 4000,
        includeMetadata = true
      } = options;

      let formatted = '';

      if (includeMetadata) {
        formatted += `Tool: ${result.tool}\n`;
        formatted += `Status: ${result.success ? 'Success' : 'Failed'}\n`;
        if (result.duration) {
          formatted += `Duration: ${result.duration}ms\n`;
        }
        formatted += '---\n';
      }

      if (result.success) {
        const content = typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result, null, 2);

        if (content.length > maxLength) {
          formatted += content.substring(0, maxLength);
          formatted += `\n... (truncated, ${content.length - maxLength} characters omitted)`;
        } else {
          formatted += content;
        }
      } else {
        formatted += `Error: ${result.error}`;
        if (result.code) {
          formatted += ` (${result.code})`;
        }
      }

      return formatted;
    };

    /**
     * Get executor statistics
     */
    const getStats = () => ({
      defaultTimeout: DEFAULT_TIMEOUT,
      maxRetries: MAX_RETRIES
    });

    // Private helpers
    const _delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const _chunk = (array, size) => {
      const chunks = [];
      for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
      }
      return chunks;
    };

    const _isReadOnly = (toolName) => {
      // Tools that only read data, don't modify state
      const readOnlyTools = [
        'ReadFile',
        'ListFiles',
        'SearchFiles',
        'GetArtifact',
        'GetState',
        'QueryVFS',
        'InspectModule',
        'GetMetrics',
        'GetLogs'
      ];
      return readOnlyTools.includes(toolName);
    };

    return {
      executeWithTimeout,
      executeWithRetry,
      executeBatch,
      executeWithParallelization,
      formatResultForContext,
      getStats,
      DEFAULT_TIMEOUT,
      MAX_RETRIES
    };
  }
};
```

#### Core Responsibilities

1. **Timeout Protection**: Prevent hanging operations from blocking agent cycle
2. **Retry Logic**: Handle transient failures with exponential backoff
3. **Batch Execution**: Execute multiple tools in sequence with error handling
4. **Smart Parallelization**: Run read-only tools concurrently, mutating tools sequentially
5. **Result Formatting**: Prepare tool output for LLM context inclusion

### 3. The Implementation Pathway

#### Step 1: Define Default Configuration

```javascript
const DEFAULT_TIMEOUT = 30000;  // 30 seconds
const MAX_RETRIES = 2;          // 2 retry attempts
```

#### Step 2: Implement Timeout Execution

```javascript
const executeWithTimeout = async (toolName, args, timeout = DEFAULT_TIMEOUT) => {
  const startTime = Date.now();

  EventBus.emit('tool:executing', { tool: toolName, args, timeout });

  return new Promise(async (resolve, reject) => {
    // Set up timeout
    const timeoutId = setTimeout(() => {
      const error = new Error(`Tool execution timed out after ${timeout}ms`);
      error.code = 'EXECUTION_TIMEOUT';
      error.tool = toolName;

      EventBus.emit('tool:timeout', { tool: toolName, timeout });
      reject(error);
    }, timeout);

    try {
      // Execute tool
      const result = await ToolRunner.execute(toolName, args);
      clearTimeout(timeoutId);

      const duration = Date.now() - startTime;
      EventBus.emit('tool:executed', { tool: toolName, duration, success: true });

      resolve({ success: true, result, duration, tool: toolName });
    } catch (error) {
      clearTimeout(timeoutId);
      EventBus.emit('tool:error', { tool: toolName, error: error.message });
      reject(error);
    }
  });
};
```

#### Step 3: Implement Retry Logic

```javascript
const executeWithRetry = async (toolName, args, options = {}) => {
  const {
    maxRetries = MAX_RETRIES,
    timeout = DEFAULT_TIMEOUT,
    retryDelay = 1000,
    shouldRetry = (error) => true  // Custom retry predicate
  } = options;

  let lastError;
  let attempts = 0;

  while (attempts <= maxRetries) {
    attempts++;

    try {
      const result = await executeWithTimeout(toolName, args, timeout);
      return result;
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempts > maxRetries;
      const canRetry = !isLastAttempt && shouldRetry(error);

      if (canRetry) {
        // Exponential backoff: 1s, 2s, 3s...
        await _delay(retryDelay * attempts);
      } else {
        break;
      }
    }
  }

  throw lastError;
};
```

#### Step 4: Implement Batch Execution

```javascript
const executeBatch = async (toolCalls, options = {}) => {
  const {
    timeout = DEFAULT_TIMEOUT,
    stopOnError = false,  // Continue on error by default
    maxRetries = 0        // No retries by default
  } = options;

  const results = [];

  for (const { tool, args } of toolCalls) {
    try {
      const result = await executeWithTimeout(tool, args, timeout);
      results.push({
        tool,
        success: true,
        result: result.result,
        duration: result.duration
      });
    } catch (error) {
      results.push({
        tool,
        success: false,
        error: error.message,
        code: error.code
      });

      if (stopOnError) break;
    }
  }

  return {
    results,
    summary: {
      total: toolCalls.length,
      executed: results.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    }
  };
};
```

#### Step 5: Implement Smart Parallelization

```javascript
const executeWithParallelization = async (toolCalls, options = {}) => {
  const { timeout = DEFAULT_TIMEOUT, maxConcurrency = 5 } = options;

  // Classify tools
  const readOnlyTools = toolCalls.filter(tc => _isReadOnly(tc.tool));
  const mutatingTools = toolCalls.filter(tc => !_isReadOnly(tc.tool));

  const results = [];

  // Run read-only tools in parallel (chunked for concurrency control)
  if (readOnlyTools.length > 0) {
    const chunks = _chunk(readOnlyTools, maxConcurrency);

    for (const chunk of chunks) {
      const chunkResults = await Promise.allSettled(
        chunk.map(({ tool, args }) =>
          executeWithTimeout(tool, args, timeout)
        )
      );

      // Process settled results
      for (let i = 0; i < chunkResults.length; i++) {
        const { tool } = chunk[i];
        const result = chunkResults[i];

        results.push(result.status === 'fulfilled'
          ? { tool, success: true, result: result.value.result, parallel: true }
          : { tool, success: false, error: result.reason.message, parallel: true }
        );
      }
    }
  }

  // Run mutating tools sequentially
  for (const { tool, args } of mutatingTools) {
    try {
      const result = await executeWithTimeout(tool, args, timeout);
      results.push({ tool, success: true, result: result.result, parallel: false });
    } catch (error) {
      results.push({ tool, success: false, error: error.message, parallel: false });
    }
  }

  return { results, summary: { /* ... */ } };
};
```

#### Step 6: Implement Result Formatting

```javascript
const formatResultForContext = (result, options = {}) => {
  const { maxLength = 4000, includeMetadata = true } = options;

  let formatted = '';

  if (includeMetadata) {
    formatted += `Tool: ${result.tool}\n`;
    formatted += `Status: ${result.success ? 'Success' : 'Failed'}\n`;
    formatted += `Duration: ${result.duration}ms\n`;
    formatted += '---\n';
  }

  if (result.success) {
    const content = typeof result.result === 'string'
      ? result.result
      : JSON.stringify(result.result, null, 2);

    if (content.length > maxLength) {
      formatted += content.substring(0, maxLength);
      formatted += `\n... (truncated)`;
    } else {
      formatted += content;
    }
  } else {
    formatted += `Error: ${result.error}`;
  }

  return formatted;
};
```

### 4. Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `DEFAULT_TIMEOUT` | 30000ms | Maximum execution time per tool |
| `MAX_RETRIES` | 2 | Default retry attempts |
| `retryDelay` | 1000ms | Base delay between retries (multiplied by attempt) |
| `maxConcurrency` | 5 | Maximum parallel executions |
| `maxLength` | 4000 | Maximum result length for context |

### 5. Read-Only Tool Classification

Tools classified as read-only (safe for parallel execution):
- `ReadFile` - Read file contents
- `ListFiles` - List directory contents
- `SearchFiles` - Search for files
- `GetArtifact` - Retrieve artifact
- `GetState` - Get state value
- `QueryVFS` - Query virtual file system
- `InspectModule` - Inspect module metadata
- `GetMetrics` - Get performance metrics
- `GetLogs` - Get log entries

All other tools are treated as mutating and executed sequentially.

### 6. Event Bus Integration

#### Emitted Events

| Event | Payload | Description |
|-------|---------|-------------|
| `tool:executing` | `{ tool, args, timeout }` | Tool execution starting |
| `tool:executed` | `{ tool, duration, success }` | Tool execution completed |
| `tool:error` | `{ tool, error, duration }` | Tool execution failed |
| `tool:timeout` | `{ tool, timeout }` | Tool execution timed out |
| `tool:retry-attempt` | `{ tool, attempt, maxRetries }` | Retry attempt starting |
| `tool:retry-success` | `{ tool, attempts }` | Retry succeeded |
| `tool:retry-exhausted` | `{ tool, attempts, error }` | All retries failed |
| `tool:batch-start` | `{ count }` | Batch execution starting |
| `tool:batch-complete` | `{ count, successCount, failureCount, duration }` | Batch execution completed |
| `tool:parallel-start` | `{ readOnly, mutating }` | Parallel execution starting |
| `tool:parallel-complete` | `{ total, successCount, failureCount, duration }` | Parallel execution completed |

### 7. Usage Examples

#### Basic Timeout Execution

```javascript
const result = await ToolExecutor.executeWithTimeout('ReadFile', { path: '/code/module.js' });
console.log(result.result);
```

#### Execution with Retry

```javascript
const result = await ToolExecutor.executeWithRetry('FetchData', { url: '/api/data' }, {
  maxRetries: 3,
  timeout: 10000,
  shouldRetry: (error) => error.code !== 'NOT_FOUND'
});
```

#### Batch Execution

```javascript
const { results, summary } = await ToolExecutor.executeBatch([
  { tool: 'ReadFile', args: { path: '/a.js' } },
  { tool: 'ReadFile', args: { path: '/b.js' } },
  { tool: 'WriteFile', args: { path: '/c.js', content: '...' } }
], { stopOnError: false });

console.log(`Executed: ${summary.succeeded}/${summary.total}`);
```

#### Smart Parallelization

```javascript
const { results, summary } = await ToolExecutor.executeWithParallelization([
  { tool: 'ReadFile', args: { path: '/a.js' } },    // Parallel
  { tool: 'ReadFile', args: { path: '/b.js' } },    // Parallel
  { tool: 'WriteFile', args: { path: '/c.js', content: '...' } },  // Sequential
  { tool: 'DeleteFile', args: { path: '/d.js' } }   // Sequential
]);

console.log(`Read-only: ${summary.readOnly}, Mutating: ${summary.mutating}`);
```

#### Result Formatting

```javascript
const result = await ToolExecutor.executeWithTimeout('ReadFile', { path: '/code/large.js' });
const formatted = ToolExecutor.formatResultForContext(result, { maxLength: 2000 });
// Ready for LLM context inclusion
```

### 8. Operational Safeguards

- **Timeout Cleanup**: Clear timeout on success or error to prevent orphaned timers
- **Error Propagation**: Preserve error codes and context for debugging
- **Graceful Degradation**: Batch continues on error unless `stopOnError` specified
- **Concurrency Limits**: Prevent overwhelming system with parallel executions
- **Exponential Backoff**: Increase delay between retries to allow recovery
- **Result Truncation**: Prevent oversized results from bloating context

### 9. Widget Interface (Web Component)

```javascript
class ToolExecutorWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this._interval = setInterval(() => this.render(), 500);
  }

  disconnectedCallback() {
    if (this._interval) clearInterval(this._interval);
  }

  set moduleApi(api) {
    this._api = api;
    this.render();
  }

  getStatus() {
    const stats = this._api.getStats();
    return {
      state: 'idle',
      primaryMetric: `Timeout: ${stats.defaultTimeout / 1000}s`,
      secondaryMetric: `Retries: ${stats.maxRetries}`,
      lastActivity: null
    };
  }

  render() {
    const stats = this._api.getStats();

    this.shadowRoot.innerHTML = `
      <style>/* Shadow DOM styles */</style>
      <div class="executor-panel">
        <div class="config">
          <div>Default Timeout: ${stats.defaultTimeout / 1000}s</div>
          <div>Max Retries: ${stats.maxRetries}</div>
        </div>
      </div>
    `;
  }
}

customElements.define('tool-executor-widget', ToolExecutorWidget);
```

### 10. Verification Checklist

- [ ] `executeWithTimeout()` resolves before timeout
- [ ] `executeWithTimeout()` rejects with EXECUTION_TIMEOUT after timeout
- [ ] `executeWithTimeout()` clears timer on success or error
- [ ] `executeWithRetry()` retries on failure up to maxRetries
- [ ] `executeWithRetry()` uses exponential backoff
- [ ] `executeWithRetry()` respects shouldRetry predicate
- [ ] `executeBatch()` executes all tools in sequence
- [ ] `executeBatch()` continues on error (unless stopOnError)
- [ ] `executeBatch()` returns results and summary
- [ ] `executeWithParallelization()` runs read-only tools in parallel
- [ ] `executeWithParallelization()` runs mutating tools sequentially
- [ ] `executeWithParallelization()` respects maxConcurrency
- [ ] `formatResultForContext()` truncates long results
- [ ] `formatResultForContext()` includes metadata when requested
- [ ] All execution methods emit appropriate EventBus events

### 11. Extension Opportunities

- Add circuit breaker pattern for failing tools
- Add execution priority queue
- Add tool execution caching for identical requests
- Add execution metrics and histograms
- Add dynamic timeout based on tool history
- Add tool dependency graph for smart ordering
- Add cancellation support for long-running tools
- Add execution quotas and rate limiting
- Add tool execution audit log

---

**Status:** Blueprint

Maintain this blueprint as the tool execution capabilities evolve or new execution strategies are introduced.
