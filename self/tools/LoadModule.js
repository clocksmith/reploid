/**
 * @fileoverview LoadModule - Hot-reload a module from VFS
 */

// Inline async utilities (VFS module loader doesn't support relative imports)
class TimeoutError extends Error {
  constructor(message) { super(message); this.name = 'TimeoutError'; this.isTimeout = true; }
}
class RetryExhaustedError extends Error {
  constructor(message, attempts, lastError) {
    super(message); this.name = 'RetryExhaustedError'; this.attempts = attempts; this.lastError = lastError;
  }
}
function withTimeout(promise, timeoutMs, operationName = 'Operation') {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then((r) => { clearTimeout(timeoutId); resolve(r); }).catch((e) => { clearTimeout(timeoutId); reject(e); });
  });
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function withTimeoutAndRetry(fn, options = {}) {
  const { timeoutMs = 30000, operationName = 'Operation', maxAttempts = 3, initialDelayMs = 1000, shouldRetry = () => true, onRetry } = options;
  let lastError, delayMs = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await withTimeout(fn(attempt), timeoutMs, `${operationName} (attempt ${attempt})`); }
    catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !shouldRetry(error, attempt)) break;
      if (onRetry) onRetry(error, attempt, delayMs);
      await sleep(delayMs);
      delayMs = Math.min(delayMs * 2, 30000);
    }
  }
  throw new RetryExhaustedError(`Operation failed after ${maxAttempts} attempts`, maxAttempts, lastError);
}

async function call(args = {}, deps = {}) {
  const { SubstrateLoader, EventBus, ToolRunner } = deps;

  const {
    path,
    timeoutMs = 10000, // 10 second default
    maxRetries = 1,
    force = false
  } = args;

  if (!path) throw new Error('Missing path argument');
  const cleanPath = '/' + String(path || '').trim().replace(/^\/+/, '');
  if (cleanPath.split('/').includes('..')) {
    throw new Error('Path traversal is not allowed');
  }
  if (!cleanPath.startsWith('/self/')) {
    throw new Error('LoadModule only supports promoted /self paths');
  }

  if (cleanPath.startsWith('/self/tools/') && cleanPath.endsWith('.js') && ToolRunner?.loadPath) {
    const loaded = await ToolRunner.loadPath(cleanPath, null, { allow: true });
    if (!loaded) {
      throw new Error(`Tool module load failed: ${cleanPath}`);
    }
    EventBus?.emit('module:reloaded', { path: cleanPath, kind: 'tool' });
    return `Loaded tool module from ${cleanPath}`;
  }

  if (!SubstrateLoader) throw new Error('SubstrateLoader not available');

  try {
    await withTimeoutAndRetry(
      async () => SubstrateLoader.loadModule(cleanPath, { force }),
      {
        timeoutMs,
        maxAttempts: maxRetries + 1,
        operationName: `LoadModule(${cleanPath})`,
        initialDelayMs: 500,
        shouldRetry: (error) => {
          // Don't retry syntax errors or module not found
          if (error.message?.includes('SyntaxError')) return false;
          if (error.message?.includes('not found')) return false;
          return true;
        },
        onRetry: (error, attempt, delay) => {
          console.warn(`[LoadModule] Retry ${attempt} for ${cleanPath}: ${error.message}`);
          EventBus?.emit('module:reload-retry', { path: cleanPath, attempt, error: error.message });
        }
      }
    );

    EventBus?.emit('module:reloaded', { path: cleanPath });
    return `Hot-reloaded module from ${cleanPath}`;

  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new Error(`Module load timed out after ${timeoutMs}ms: ${cleanPath}. The module may have circular dependencies or be too large.`);
    }
    if (error instanceof RetryExhaustedError) {
      throw new Error(`Module load failed after ${maxRetries + 1} attempts: ${error.lastError?.message || 'Unknown error'}`);
    }
    throw error;
  }
}

export const tool = {
  name: "LoadModule",
  description: "Hot-reload a promoted /self module from the VFS into the running system. Includes timeout protection to prevent hangs from circular dependencies.",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'Promoted VFS path to module (e.g. /self/tools/MyTool.js)'
      },
      timeoutMs: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 10000)',
        default: 10000
      },
      maxRetries: {
        type: 'number',
        description: 'Maximum retry attempts (default: 1)',
        default: 1
      },
      force: {
        type: 'boolean',
        description: 'Force reload even if module is cached',
        default: false
      }
    }
  },
  call
};

export default call;
