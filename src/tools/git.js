/**
 * @fileoverview Git - git version control operations in VFS
 */

// Inline timeout utilities (VFS module loader doesn't support relative imports)
class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.isTimeout = true;
  }
}

function withTimeout(promise, timeoutMs, operationName = 'Operation') {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((result) => { clearTimeout(timeoutId); resolve(result); })
      .catch((error) => { clearTimeout(timeoutId); reject(error); });
  });
}

// Default timeouts per operation (can be slow on large repos)
const DEFAULT_TIMEOUTS = {
  status: 10000,   // 10s
  log: 15000,      // 15s
  diff: 30000,     // 30s (can be large)
  add: 20000,      // 20s
  commit: 30000    // 30s
};

async function call(args = {}, deps = {}) {
  const { gitTools } = deps;
  if (!gitTools) return 'git not available';

  const { command, timeoutMs, ...options } = args;
  if (!command) throw new Error('Missing git command (status, log, diff, add, commit)');

  const timeout = timeoutMs || DEFAULT_TIMEOUTS[command] || 30000;

  try {
    let result;

    switch (command) {
      case 'status':
        result = await withTimeout(
          gitTools.status(),
          timeout,
          'git status'
        );
        break;

      case 'log':
        result = await withTimeout(
          gitTools.log(options.limit || 10),
          timeout,
          'git log'
        );
        break;

      case 'diff':
        result = await withTimeout(
          gitTools.diff(options.path),
          timeout,
          'git diff'
        );
        // Truncate very large diffs
        if (typeof result === 'string' && result.length > 100000) {
          result = result.slice(0, 100000) + `\n\n... [truncated, ${result.length - 100000} more characters]`;
        }
        break;

      case 'add':
        if (!options.path) throw new Error('Missing path for git add');
        result = await withTimeout(
          gitTools.add(options.path),
          timeout,
          'git add'
        );
        break;

      case 'commit':
        if (!options.message) throw new Error('Missing message for git commit');
        result = await withTimeout(
          gitTools.commit(options.message),
          timeout,
          'git commit'
        );
        break;

      default:
        throw new Error(`Unsupported git command: ${command}`);
    }

    return result;

  } catch (error) {
    if (error instanceof TimeoutError) {
      return `git ${command} timed out after ${timeout}ms. The repository may be large or the operation may be stuck.`;
    }
    throw error;
  }
}

export const tool = {
  name: "Git",
  description: "git version control operations in VFS (status, log, diff, add, commit). Includes timeout protection for large repositories.",
  inputSchema: {
    type: 'object',
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        enum: ['status', 'log', 'diff', 'add', 'commit'],
        description: 'Git command to execute'
      },
      path: {
        type: 'string',
        description: 'File path (for add/diff commands)'
      },
      message: {
        type: 'string',
        description: 'Commit message (for commit command)'
      },
      limit: {
        type: 'number',
        description: 'Number of log entries (for log command, default: 10)',
        default: 10
      },
      timeoutMs: {
        type: 'number',
        description: 'Custom timeout in milliseconds (overrides default per-command timeouts)'
      }
    }
  },
  call
};

export default call;
