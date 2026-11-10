/**
 * @fileoverview Lab strategy tool outcome interpretation.
 * Classifies recoverable tool input errors, derives read-only recovery calls from
 * tool hints, and finds logical failures reported inside completed results,
 * including worker batches. Pure functions; execution stays in lab-strategy-tools.js.
 */

const RECOVERABLE_TOOL_INPUT_ERROR_PATTERNS = [
  /^File not found:/i,
  /^Missing .+ argument/i,
  /^Invalid argument line:/i,
  /^Invalid (backend|mode|offset|length)/i,
  /^Path traversal is not allowed/i,
  /^OPFS path not allowed:/i,
  /^VFS supports text mode only/i,
  /^offset\/length are only supported/i,
  /^Read range exceeds file size/i,
  /^Read length exceeds maxBytes/i,
  /^maxBytes /i,
  /^File too large/i,
  /^Unsupported VFS entry type/i,
  /^Tool not found:/i,
  /^Tool '.+' not permitted/i,
  /^Policy violation:/i,
  /^Operation rejected by user/i
];

export const isRecoverableToolInputError = (error) => {
  const message = String(error?.message || error || '');
  return RECOVERABLE_TOOL_INPUT_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

export const isRecoverableToolPreconditionError = (call = {}, error) => {
  const name = String(call?.name || '');
  const message = String(error?.message || error || '');
  if (name !== 'LoadModule') return false;
  return (
    /^LoadModule only supports promoted \/self paths/i.test(message)
    || /^Tool module has a leading pipe literal marker/i.test(message)
  );
};

const sanitizeRecoveredVfsPath = (value) => {
  const path = String(value || '').trim();
  if (!path.startsWith('/')) return null;
  if (path.split('/').includes('..')) return null;
  if (/[\s"'`<>]/.test(path)) return null;
  return path.replace(/\/+$/, '') || '/';
};

export const getRecoveryCallFromToolError = (call, error, isReadOnlyTool) => {
  if (!call || !isReadOnlyTool(call.name)) return null;
  const message = String(error?.message || error || '');
  if (call.name === 'ReadFile') {
    const match = message.match(/Retry with ReadFile path:\s+(\S+)\./);
    const suggestedPath = sanitizeRecoveredVfsPath(match?.[1]);
    const currentPath = sanitizeRecoveredVfsPath(call.args?.path || call.args?.file);
    if (!suggestedPath || suggestedPath === currentPath) return null;
    return {
      name: 'ReadFile',
      args: {
        ...(call.args || {}),
        path: suggestedPath
      },
      reason: 'near_miss_path'
    };
  }
  return null;
};

const parsePossibleJsonResult = (result) => {
  if (result && typeof result === 'object') return result;
  if (typeof result !== 'string') return null;
  const text = result.trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const getLogicalToolResult = (entryOrResult) => {
  if (entryOrResult && typeof entryOrResult === 'object' && 'rawResult' in entryOrResult) {
    return entryOrResult.rawResult ?? parsePossibleJsonResult(entryOrResult.result) ?? entryOrResult.result;
  }
  return entryOrResult ?? null;
};

const getDirectLogicalFailureReasons = (logical) => {
  if (!logical || typeof logical !== 'object') return [];
  if (!(logical.ok === false || logical.success === false)) return [];
  if (Array.isArray(logical.reasons) && logical.reasons.length > 0) {
    return logical.reasons.map((reason) => String(reason));
  }
  if (typeof logical.error === 'string' && logical.error) return [logical.error];
  if (typeof logical.message === 'string' && logical.message) return [logical.message];
  return ['tool reported unsuccessful result'];
};

const getWorkerToolLogicalResult = (entry = {}) => (
  entry.rawResult
  ?? parsePossibleJsonResult(entry.result)
  ?? entry.result
  ?? null
);

const getWorkerResultPayload = (entry = {}) => (
  entry.value
  ?? entry.result
  ?? entry
);

const getWorkerLogicalFailureReasons = (logical) => {
  if (!logical || typeof logical !== 'object') return [];
  if (!Array.isArray(logical.results) || !('awaited' in logical || 'timedOut' in logical)) return [];

  const reasons = [];
  for (const workerEntry of logical.results) {
    const workerId = workerEntry?.workerId || 'worker';
    if (workerEntry?.status === 'rejected' || workerEntry?.status === 'error') {
      reasons.push(`${workerId}: ${workerEntry.error || 'worker failed'}`);
      continue;
    }

    const workerResult = getWorkerResultPayload(workerEntry);
    if (workerResult?.status === 'error') {
      reasons.push(`${workerId}: ${workerResult.error || 'worker failed'}`);
    }
    for (const reason of getDirectLogicalFailureReasons(workerResult)) {
      reasons.push(`${workerId}: ${reason}`);
    }

    const toolResults = Array.isArray(workerResult?.toolResults) ? workerResult.toolResults : [];
    for (const toolEntry of toolResults) {
      const toolName = toolEntry?.tool || toolEntry?.name || 'worker tool';
      const logicalToolResult = getWorkerToolLogicalResult(toolEntry);
      const toolReasons = getDirectLogicalFailureReasons(logicalToolResult);
      if (toolReasons.length > 0) {
        reasons.push(`${workerId}/${toolName}: ${toolReasons.join('; ')}`);
      } else if (toolEntry?.success === false || toolEntry?.ok === false) {
        reasons.push(`${workerId}/${toolName}: ${toolEntry.error || 'tool reported unsuccessful result'}`);
      }
    }
  }
  return reasons;
};

export const getLogicalToolFailureReasons = (result) => {
  const logical = getLogicalToolResult(result);
  return [
    ...getDirectLogicalFailureReasons(logical),
    ...getWorkerLogicalFailureReasons(logical)
  ];
};

export const isLogicalToolFailureResult = (result) => {
  return getLogicalToolFailureReasons(result).length > 0;
};

export const getToolExecutionFailureReason = (entry) => {
  if (!entry) return null;
  if (entry.errorKind === 'parse_error') {
    return `Parse error before execution: ${entry.call?.error || 'Invalid tool arguments'}`;
  }
  if (typeof entry.finalResult === 'string' && entry.finalResult.startsWith('Error:')) {
    return entry.finalResult;
  }
  const result = getLogicalToolResult(entry) ?? entry.finalResult;
  if (isLogicalToolFailureResult(result)) {
    const reasons = getLogicalToolFailureReasons(result).join('; ') || 'tool reported unsuccessful result';
    return `Error: ${entry.call?.name || 'Tool'} failed: ${reasons}`;
  }
  return null;
};

export const isToolExecutionFailure = (entry) => !!getToolExecutionFailureReason(entry);
