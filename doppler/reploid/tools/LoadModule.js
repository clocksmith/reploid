/**
 * @fileoverview LoadModule - Hot-reload a module from VFS
 */

import { withTimeoutAndRetry, TimeoutError, RetryExhaustedError } from '../core/async-utils.js';

async function call(args = {}, deps = {}) {
  const { SubstrateLoader, EventBus } = deps;
  if (!SubstrateLoader) throw new Error('SubstrateLoader not available (requires reflection+ genesis level)');

  const {
    path,
    timeoutMs = 10000, // 10 second default
    maxRetries = 1,
    force = false
  } = args;

  if (!path) throw new Error('Missing path argument');

  try {
    await withTimeoutAndRetry(
      async () => SubstrateLoader.loadModule(path, { force }),
      {
        timeoutMs,
        maxAttempts: maxRetries + 1,
        operationName: `LoadModule(${path})`,
        initialDelayMs: 500,
        shouldRetry: (error) => {
          // Don't retry syntax errors or module not found
          if (error.message?.includes('SyntaxError')) return false;
          if (error.message?.includes('not found')) return false;
          return true;
        },
        onRetry: (error, attempt, delay) => {
          console.warn(`[LoadModule] Retry ${attempt} for ${path}: ${error.message}`);
          EventBus?.emit('module:reload-retry', { path, attempt, error: error.message });
        }
      }
    );

    EventBus?.emit('module:reloaded', { path });
    return `Hot-reloaded module from ${path}`;

  } catch (error) {
    if (error instanceof TimeoutError) {
      throw new Error(`Module load timed out after ${timeoutMs}ms: ${path}. The module may have circular dependencies or be too large.`);
    }
    if (error instanceof RetryExhaustedError) {
      throw new Error(`Module load failed after ${maxRetries + 1} attempts: ${error.lastError?.message || 'Unknown error'}`);
    }
    throw error;
  }
}

export const tool = {
  name: "LoadModule",
  description: "Hot-reload a module from the VFS into the running system. Includes timeout protection to prevent hangs from circular dependencies.",
  inputSchema: {
    type: 'object',
    required: ['path'],
    properties: {
      path: {
        type: 'string',
        description: 'VFS path to module (e.g. /core/utils.js)'
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
