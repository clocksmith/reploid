/** Policy-bounded tool scheduling and observation formatting. */
export function createTaskToolPolicy(policy) {
  const PARALLEL_SAFE_TOOLS = new Set(policy.tools.parallelSafe);

  const ORDERED_TOOLS = new Set(policy.tools.ordered);

  const EXCLUSIVE_TOOLS = new Set(policy.tools.exclusive);

  const TOOL_STRING_PREVIEW_CHARS = policy.agent.toolStringPreviewChars;

  const TOOL_RESULT_PAYLOAD_CHARS = policy.agent.toolResultPayloadChars;

  const TOOL_BATCH_BODY_CHARS = policy.agent.toolBatchBodyChars;

  const TOOL_SANITIZE_MAX_DEPTH = policy.agent.toolSanitizeMaxDepth;

  const TOOL_SANITIZE_ARRAY_LIMIT = policy.agent.toolSanitizeArrayLimit;

  const truncateString = (value, limit) => {
    const text = String(value || '');
    if (text.length <= limit) return text;
    const omitted = text.length - limit;
    return `${text.slice(0, limit)}\n[truncated ${omitted} chars; use targeted reads or smaller ranges for full content]`;
  };

  const sanitizeToolValue = (value, depth = 0, seen = new WeakSet()) => {
    if (typeof value === 'string') {
      return truncateString(value, TOOL_STRING_PREVIEW_CHARS);
    }
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'undefined'
    ) {
      return value;
    }
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'symbol') return String(value);
    if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[circular]';
    if (depth >= TOOL_SANITIZE_MAX_DEPTH) {
      return Array.isArray(value)
        ? `[truncated nested array: ${value.length} items]`
        : '[truncated nested object]';
    }

    seen.add(value);
    if (Array.isArray(value)) {
      const next = value
        .slice(0, TOOL_SANITIZE_ARRAY_LIMIT)
        .map((item) => sanitizeToolValue(item, depth + 1, seen));
      if (value.length > TOOL_SANITIZE_ARRAY_LIMIT) {
        next.push(`[truncated ${value.length - TOOL_SANITIZE_ARRAY_LIMIT} array items]`);
      }
      seen.delete(value);
      return next;
    }

    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      next[key] = sanitizeToolValue(item, depth + 1, seen);
    });
    seen.delete(value);
    return next;
  };

  const formatToolResult = (name, result, kind = 'RESULT') => {
    const sanitized = sanitizeToolValue(result);
    const rawPayload = typeof sanitized === 'string'
      ? sanitized
      : JSON.stringify(sanitized, null, 2);
    const payload = truncateString(rawPayload, TOOL_RESULT_PAYLOAD_CHARS);
    return `[TOOL ${name} ${kind}]\n${payload}`.trim();
  };

  const formatToolCallParseError = (call = {}) => {
    return formatToolResult(call.name || 'Tool', {
      error: call.error || 'Invalid tool call',
      parsedArgs: call.args || {},
      hint: 'Use key: value lines or key <<MARKER literal blocks.'
    }, 'ERROR');
  };

  const normalizeToolName = (name) => String(name || '').trim();

  const normalizePlanId = (id) => String(id || '').trim();

  const normalizePlanDeps = (after) => {
    if (after === undefined || after === null || after === '') return [];
    if (Array.isArray(after)) {
      return after.map((item) => normalizePlanId(item)).filter(Boolean);
    }
    return String(after)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  };

  const getToolExecutionMode = (call = {}) => {
    const name = normalizeToolName(call.name);
    if (!name || call.error) return 'ordered';
    if (PARALLEL_SAFE_TOOLS.has(name)) return 'parallel';
    if (EXCLUSIVE_TOOLS.has(name)) return 'exclusive';
    if (ORDERED_TOOLS.has(name)) return 'ordered';
    return 'ordered';
  };

  const groupToolCallsInOrder = (calls = []) => {
    const groups = [];
    let parallelCalls = [];

    const flushParallel = () => {
      if (parallelCalls.length === 0) return;
      groups.push({
        mode: 'parallel',
        calls: parallelCalls
      });
      parallelCalls = [];
    };

    for (const call of calls) {
      const mode = getToolExecutionMode(call);
      if (mode === 'parallel') {
        parallelCalls.push(call);
        continue;
      }

      flushParallel();
      groups.push({
        mode,
        calls: [call]
      });
    }

    flushParallel();
    return groups;
  };

  const buildDependencyExecutionGroups = (calls = []) => {
    const prepared = calls.map((call, index) => ({
      ...call,
      id: normalizePlanId(call.id),
      after: normalizePlanDeps(call.after),
      index
    }));
    const idCounts = new Map();

    for (const call of prepared) {
      if (!call.id) continue;
      idCounts.set(call.id, (idCounts.get(call.id) || 0) + 1);
    }

    const knownIds = new Set(
      [...idCounts.entries()]
        .filter(([, count]) => count === 1)
        .map(([id]) => id)
    );
    let pending = prepared.map((call) => {
      if (call.id && idCounts.get(call.id) > 1) {
        return {
          ...call,
          error: call.error || `Duplicate PLAN step id: ${call.id}`
        };
      }
      return call;
    });
    const completed = new Set();
    const groups = [];

    while (pending.length > 0) {
      const ready = [];
      const blocked = [];

      for (const call of pending) {
        const missingDeps = call.after.filter((id) => !knownIds.has(id));
        if (missingDeps.length > 0) {
          ready.push({
            ...call,
            error: call.error || `Unknown PLAN dependency: ${missingDeps.join(', ')}`
          });
          continue;
        }

        const unresolvedDeps = call.after.filter((id) => !completed.has(id));
        if (unresolvedDeps.length === 0) {
          ready.push(call);
        } else {
          blocked.push(call);
        }
      }

      if (ready.length === 0) {
        groups.push(...groupToolCallsInOrder(
          blocked.map((call) => ({
            ...call,
            error: call.error || `Unresolved PLAN dependency cycle: ${call.after.join(', ')}`
          }))
        ));
        break;
      }

      groups.push(...groupToolCallsInOrder(ready));
      for (const call of ready) {
        if (call.id) completed.add(call.id);
      }
      pending = blocked;
    }

    return groups;
  };

  const buildToolExecutionGroups = (calls = []) => {
    const hasPlanScheduling = calls.some((call) =>
      normalizePlanId(call.id) || normalizePlanDeps(call.after).length > 0
    );
    if (hasPlanScheduling) return buildDependencyExecutionGroups(calls);
    return groupToolCallsInOrder(calls);
  };

  const getToolBatchMode = (groups = []) => {
    const parallelGroups = groups.filter((group) => group.mode === 'parallel').length;
    if (parallelGroups === groups.length) return 'parallel-read';
    if (parallelGroups > 0) return 'scheduled';
    return 'ordered';
  };

  const formatToolBatchResult = (entries = [], groups = []) => {
    const errors = entries.filter((entry) => entry.kind === 'ERROR').length;
    const tools = entries
      .map((entry) => {
        const name = normalizeToolName(entry.call?.name) || 'unknown';
        const id = normalizePlanId(entry.call?.id);
        return id ? `${id}:${name}` : name;
      })
      .join(', ');
    const parallelGroups = groups.filter((group) => group.mode === 'parallel').length;
    const body = truncateString(
      entries
        .map((entry) => entry.message)
        .filter(Boolean)
        .join('\n\n'),
      TOOL_BATCH_BODY_CHARS
    );

    return [
      '[TOOL BATCH RESULT]',
      `mode: ${getToolBatchMode(groups)}`,
      `groups: ${groups.length}`,
      `parallelGroups: ${parallelGroups}`,
      `count: ${entries.length}`,
      `errors: ${errors}`,
      `tools: ${tools}`,
      '',
      body
    ].join('\n').trim();
  };

  const getToolPath = (call = {}) => {
    const args = call.args && typeof call.args === 'object' ? call.args : {};
    const rawPath = args.path || args.target || args.file || args.outputPath || '';
    return typeof rawPath === 'string' ? rawPath.trim() : '';
  };
  return { formatToolResult, formatToolCallParseError, normalizeToolName, normalizePlanId, normalizePlanDeps, getToolExecutionMode, buildToolExecutionGroups, getToolBatchMode, formatToolBatchResult, getToolPath };
}
