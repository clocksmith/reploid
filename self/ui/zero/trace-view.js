/**
 * @fileoverview Zero trace card model and rendering helpers.
 */

const MAX_TRACE_TEXT_LENGTH = 120000;
const MAX_TRACE_PREVIEW_LENGTH = 220;

export function createZeroTraceView(options = {}) {
  const escapeHtml = options.escapeHtml || ((value = '') => String(value));
  const trunc = options.trunc || ((value = '', max = 220) => {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
  });
  let historySequence = 0;
  let expandedTraceKeys = new Set();
  let lastModelRequestSnapshot = null;
  let cycleActionState = new Map();
  let cycleStatusState = new Map();
  let streamTrace = {
    cycle: null,
    key: null,
    content: ''
  };

  const summarize = (value, max = 220) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return trunc(text.replace(/\s+/g, ' ').trim(), max);
  };

  const traceText = (value, max = MAX_TRACE_TEXT_LENGTH) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const normalized = text.replace(/\r\n/g, '\n').trim();
    return normalized.length > max
      ? `${normalized.slice(0, max)}\n... [trace truncated]`
      : normalized;
  };

  const tracePreview = (value, max = MAX_TRACE_PREVIEW_LENGTH) => summarize(value, max);

  const formatCount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : '-';
  };

  const formatTime = (ts) => {
    if (!ts) return '--:--:--';
    try {
      return new Date(ts).toLocaleTimeString([], { hour12: false });
    } catch {
      return '--:--:--';
    }
  };

  const formatDuration = (value) => {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const seconds = ms / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  };

  const cycleKey = (cycle, phase) => `cycle:${cycle || 0}:${phase}`;

  const cleanCycleMeta = (cycle) => (cycle ? `Cycle ${cycle}` : 'Cycle 0');

  const formatAgentState = (state = '') => {
    const normalized = String(state || '').toUpperCase();
    const labels = {
      STARTING: 'Starting',
      RESUMING: 'Resuming',
      THINKING: 'Calling model',
      ACTING: 'Running tools',
      WAITING: 'Waiting',
      PARKED: 'Parked',
      IDLE: 'Idle',
      BLOCKED: 'Blocked',
      DONE: 'Done'
    };
    return labels[normalized] || (state ? String(state) : 'Idle');
  };

  const formatModelMeta = (entry = {}) => {
    const label = entry.modelLabel || entry.modelUsed?.label;
    return label ? `Model ${label}` : '';
  };

  const isErrorToolResult = (value) => (
    typeof value === 'string' && value.trim().startsWith('Error:')
  );

  const parseTraceMessages = (content = '') => {
    const raw = String(content || '');
    const matches = [...raw.matchAll(/## Message \d+ \/ \d+ \[([^\]]+)\]\n([\s\S]*?)(?=\n\n## Message \d+ \/ \d+ \[|\n\n## Tools offered|$)/g)];
    return matches.map((match, index) => ({
      index,
      role: String(match[1] || 'unknown').toLowerCase(),
      content: String(match[2] || '').trim()
    }));
  };

  const measureMessages = (messages = []) =>
    messages.reduce((sum, message) => sum + String(message?.content || '').length, 0);

  const messageSignature = (message = {}) =>
    `${message.role || 'unknown'}\u0000${message.content || ''}`;

  const getContextDelta = (messages = [], trackSnapshot = true) => {
    const previous = lastModelRequestSnapshot?.messages || [];
    let delta = messages;
    let mode = previous.length > 0 ? 'delta' : 'initial';

    if (previous.length > 0) {
      let prefix = 0;
      while (
        prefix < previous.length
        && prefix < messages.length
        && messageSignature(previous[prefix]) === messageSignature(messages[prefix])
      ) {
        prefix++;
      }
      delta = messages.slice(prefix);

      if (prefix === 0) {
        const lastPrevious = messageSignature(previous[previous.length - 1]);
        const matchingIndex = messages.findIndex((message) => messageSignature(message) === lastPrevious);
        if (matchingIndex >= 0) {
          delta = messages.slice(matchingIndex + 1);
        } else {
          delta = messages.slice(-4);
          mode = 'envelope changed';
        }
      }
    }

    if (trackSnapshot) {
      lastModelRequestSnapshot = { messages };
    }

    return {
      delta,
      mode
    };
  };

  const summarizeMessageList = (messages = [], maxMessages = 8) => {
    if (!messages.length) return 'No new messages since the previous context packet.';
    const visible = messages.slice(-maxMessages);
    const hiddenCount = Math.max(0, messages.length - visible.length);
    const lines = [];
    if (hiddenCount > 0) {
      lines.push(`${hiddenCount} earlier delta message(s) hidden from preview.`);
    }
    for (const message of visible) {
      lines.push(`[${message.role}] ${summarize(message.content, 520)}`);
    }
    return lines.join('\n');
  };

  const createContextEntry = (entry = {}, entryOptions = {}) => {
    const messages = parseTraceMessages(entry.content);
    const previous = lastModelRequestSnapshot?.messages || [];
    const hasRuntimeDelta = Array.isArray(entry.contextDeltaMessages);
    let delta = hasRuntimeDelta ? entry.contextDeltaMessages : messages;
    let mode = hasRuntimeDelta ? (entry.contextDeltaMode || 'delta') : 'initial';
    if (hasRuntimeDelta) {
      if (entryOptions.trackSnapshot !== false) {
        lastModelRequestSnapshot = { messages };
      }
    } else {
      ({ delta, mode } = getContextDelta(messages, entryOptions.trackSnapshot !== false));
    }
    const tools = (entry.toolNames || []).join(', ') || 'none';
    const deltaChars = Number.isFinite(entry.contextDeltaChars)
      ? entry.contextDeltaChars
      : measureMessages(delta);
    const bodyLines = [
      `Full envelope: ${formatCount(entry.messageCount)} messages / ${formatCount(entry.inputChars)} chars`,
      `New context: ${formatCount(delta.length)} messages / ${formatCount(deltaChars)} chars`,
      `Delta mode: ${mode}`,
      `Available tools: ${tools}`
    ];
    if (entry.mutationGateActive) {
      bodyLines.push('Mutation gate: active');
    }
    bodyLines.push('', 'New material:', summarizeMessageList(delta));

    const fallbackDeltaCount = previous.length > 0
      ? Math.max(0, messages.length - previous.length)
      : Math.min(messages.length, 4);
    const deltaCount = delta.length || fallbackDeltaCount;
    return {
      kind: 'request',
      key: cycleKey(entry.cycle, 'context'),
      title: 'Model Input',
      body: traceText(bodyLines.join('\n')),
      summary: `new ${formatCount(deltaCount)} message(s) | full ${formatCount(entry.messageCount)} messages / ${formatCount(entry.inputChars)} chars`,
      collapsed: true,
      meta: [
        cleanCycleMeta(entry.cycle),
        entry.mutationGateActive ? 'mutation gate active' : 'sent to model'
      ].filter(Boolean).join(' | ')
    };
  };

  const extractResponseToolNames = (content = '') => {
    const text = String(content || '');
    const names = new Set();
    for (const match of text.matchAll(/(?:^|\n)\s*TOOL:\s*([A-Za-z0-9_]+)/g)) {
      names.add(match[1]);
    }
    for (const match of text.matchAll(/"name"\s*:\s*"([^"]+)"/g)) {
      names.add(match[1]);
    }
    return [...names];
  };

  const summarizeResponse = (entry = {}) => {
    const content = String(entry.content || '').trim();
    const tools = extractResponseToolNames(content);
    if (tools.length > 0) {
      return `requested ${formatCount(tools.length)} tool kind(s)`;
    }
    const directive = content.match(/^(DONE|IDLE|PARK):?/i)?.[1];
    if (directive) return `${directive.toUpperCase()} directive`;
    return tracePreview(content) || 'no text response';
  };

  const createResponseEntry = (entry = {}, entryOptions = {}) => {
    const duration = formatDuration(entry.latencyMs);
    return {
      kind: 'decision',
      key: cycleKey(entry.cycle, 'decision'),
      title: 'Model Response',
      body: traceText(entry.content),
      summary: entryOptions.streaming ? tracePreview(entry.content) : summarizeResponse(entry),
      collapsed: true,
      meta: [
        cleanCycleMeta(entry.cycle),
        entryOptions.streaming ? 'streaming' : 'model response',
        duration ? `latency ${duration}` : '',
        formatModelMeta(entry)
      ].filter(Boolean).join(' | ')
    };
  };

  const getActionState = (cycle = 0) => {
    const key = Number(cycle) || 0;
    if (!cycleActionState.has(key)) {
      cycleActionState.set(key, {
        cycle: key,
        calls: [],
        results: [],
        running: new Set(),
        total: 0,
        errors: 0,
        durationMs: null,
        modelUsed: null,
        modelLabel: null
      });
    }
    return cycleActionState.get(key);
  };

  const resultKey = (result = {}, index = 0) =>
    `${result.name || result.tool || 'Tool'}:${index}`;

  const stableStringify = (value) => {
    try {
      return JSON.stringify(value || {});
    } catch {
      return '';
    }
  };

  const normalizeToolBatchResult = (result = {}, fallbackCall = {}, index = 0) => ({
    key: resultKey(result, index),
    name: result.name || result.tool || fallbackCall.name || 'Tool',
    args: result.args || fallbackCall.args || {},
    error: result.error || null,
    recoveredFrom: result.recoveredFrom || null,
    durationMs: result.durationMs ?? null,
    resultPreview: result.resultPreview || result.preview || ''
  });

  const alignBatchResultsToCalls = (results = [], calls = []) => {
    const remaining = results.map((result, index) => ({ result, index }));
    const ordered = [];

    for (const call of calls) {
      const callName = call?.name || '';
      const callArgs = stableStringify(call?.args || {});
      let matchIndex = remaining.findIndex(({ result }) => (
        (result.name || result.tool || '') === callName
        && stableStringify(result.args || {}) === callArgs
      ));

      if (matchIndex < 0) {
        matchIndex = remaining.findIndex(({ result }) => (
          (result.name || result.tool || '') === callName
        ));
      }

      if (matchIndex < 0) continue;
      const [match] = remaining.splice(matchIndex, 1);
      ordered.push(normalizeToolBatchResult(match.result, call, match.index));
    }

    for (const match of remaining) {
      ordered.push(normalizeToolBatchResult(match.result, calls[match.index] || {}, match.index));
    }

    return ordered;
  };

  const formatToolLine = (item = {}, index = 0) => {
    const status = item.error ? 'error' : (item.running ? 'running' : 'ok');
    const duration = formatDuration(item.durationMs);
    const bits = [`${index + 1}. ${item.name || 'Tool'} ${status}`];
    if (duration) bits.push(`(${duration})`);
    if (item.args && Object.keys(item.args).length > 0) {
      bits.push(`\n   Args: ${summarize(item.args, 220)}`);
    }
    if (item.error) {
      bits.push(`\n   Error: ${summarize(item.error, 320)}`);
    } else if (item.resultPreview) {
      bits.push(`\n   Result: ${summarize(item.resultPreview, 420)}`);
    }
    if (item.recoveredFrom) {
      bits.push(`\n   Recovery: from ${item.recoveredFrom.name || 'previous tool'}`);
    }
    return bits.join(' ');
  };

  const createToolRunEntry = (state = {}) => {
    const calls = state.calls || [];
    const results = state.results || [];
    const requested = calls.map((call) => call.name).filter(Boolean);
    const resultRows = results.length > 0
      ? results
      : calls.map((call) => ({
          ...call,
          running: state.running?.has(call.name)
        }));
    const errors = Number.isFinite(state.errors)
      ? state.errors
      : results.filter((result) => result.error).length;
    const okCount = Math.max(0, (state.total || resultRows.length) - errors);
    const duration = formatDuration(state.durationMs);
    const firstError = resultRows.find((result) => result.error)?.error || '';
    const bodyLines = [
      `Requested: ${requested.length ? requested.join(', ') : 'none yet'}`,
      `Executed: ${formatCount(okCount)} ok / ${formatCount(errors)} err`,
      firstError ? `First error: ${summarize(firstError, 320)}` : '',
      duration ? `Tool duration: ${duration}` : ''
    ].filter(Boolean);
    if (resultRows.length > 0) {
      bodyLines.push('', ...resultRows.map(formatToolLine));
    }
    return {
      kind: 'action',
      key: cycleKey(state.cycle, 'action'),
      title: 'Tool Run',
      body: traceText(bodyLines.join('\n')),
      summary: [
        requested.length ? `executed ${formatCount(state.total || resultRows.length)} tool(s)` : 'waiting for tool execution',
        `${formatCount(okCount)} ok / ${formatCount(errors)} err`,
        firstError ? `first error: ${summarize(firstError, 120)}` : ''
      ].filter(Boolean).join(' | '),
      collapsed: errors === 0,
      meta: [
        cleanCycleMeta(state.cycle),
        `${formatCount(state.total || resultRows.length)} tool(s)`,
        duration || '',
        formatModelMeta(state)
      ].filter(Boolean).join(' | ')
    };
  };

  const mergeToolBatchIntoAction = (entry = {}) => {
    const state = getActionState(entry.cycle);
    state.calls = Array.isArray(entry.calls) ? entry.calls : [];
    state.total = Number.isFinite(entry.total) ? entry.total : state.calls.length;
    state.errors = Number.isFinite(entry.errors) ? entry.errors : state.errors;
    state.durationMs = entry.durationMs ?? state.durationMs;
    state.modelUsed = entry.modelUsed || state.modelUsed;
    state.modelLabel = entry.modelLabel || state.modelLabel;
    if (Array.isArray(entry.results)) {
      state.results = alignBatchResultsToCalls(entry.results, state.calls);
    }
    return createToolRunEntry(state);
  };

  const mergeToolResultIntoAction = (entry = {}) => {
    const state = getActionState(entry.cycle);
    state.modelUsed = entry.modelUsed || state.modelUsed;
    state.modelLabel = entry.modelLabel || state.modelLabel;
    const name = entry.tool || 'Tool';
    if (!state.calls.some((call) => call.name === name)) {
      state.calls.push({ name, args: entry.args || {} });
    }
    const existingIndex = state.results.findIndex((result) => (
      result.name === name
      && (!result.resultPreview || result.resultPreview === 'completed')
    ));
    const nextResult = {
      key: `${name}:${state.results.length}`,
      name,
      args: entry.args || {},
      error: isErrorToolResult(entry.result) ? String(entry.result) : null,
      durationMs: entry.durationMs ?? null,
      resultPreview: summarize(entry.result, 800)
    };
    if (existingIndex >= 0) {
      state.results[existingIndex] = { ...state.results[existingIndex], ...nextResult };
    } else {
      state.results.push(nextResult);
    }
    state.total = Math.max(state.total || 0, state.calls.length, state.results.length);
    state.errors = state.results.filter((result) => result.error).length;
    state.running.delete(name);
    return createToolRunEntry(state);
  };

  const mergeToolLifecycleIntoAction = (entry = {}, phase = 'start') => {
    const state = getActionState(entry.cycle);
    const name = entry.tool || 'Tool';
    if (!state.calls.some((call) => call.name === name)) {
      state.calls.push({ name, args: entry.args || {} });
    }
    if (phase === 'start') {
      state.running.add(name);
    } else {
      state.running.delete(name);
      const existingIndex = state.results.findIndex((result) => result.name === name);
      const next = {
        key: `${name}:${existingIndex >= 0 ? existingIndex : state.results.length}`,
        name,
        args: entry.args || {},
        running: false,
        error: entry.success === false ? 'tool failed' : null,
        durationMs: entry.durationMs ?? null,
        resultPreview: entry.success === false ? '' : 'completed'
      };
      if (existingIndex >= 0) {
        state.results[existingIndex] = { ...state.results[existingIndex], ...next };
      } else {
        state.results.push(next);
      }
    }
    state.total = Math.max(state.total || 0, state.calls.length, state.results.length);
    state.errors = state.results.filter((result) => result.error).length;
    return createToolRunEntry(state);
  };

  const getStatusState = (cycle = 0) => {
    const key = Number(cycle) || 0;
    if (!cycleStatusState.has(key)) {
      cycleStatusState.set(key, { cycle: key, events: [] });
    }
    return cycleStatusState.get(key);
  };

  const statusLabelForType = (type = '') => {
    const labels = {
      cycle_throttle: 'Cycle throttle',
      provider_context_envelope: 'Provider envelope',
      build_progress_gate: 'Build gate',
      provider_unavailable: 'Provider unavailable',
      provider_request_rejected: 'Request rejected',
      provider_resume: 'Provider resume',
      tool_cooldown_resume: 'Tool load cooldown'
    };
    return labels[type] || String(type || 'Runtime event').replace(/_/g, ' ');
  };

  const createStatusEntry = (state = {}) => {
    const events = state.events || [];
    const latest = events[events.length - 1] || {};
    return {
      kind: latest.kind || 'status',
      key: cycleKey(state.cycle, 'status'),
      title: 'Runtime Event',
      body: traceText(events.map((event) => {
        const duration = formatDuration(event.durationMs);
        return [
          `${formatTime(event.ts)} ${event.label}`,
          event.content || '',
          duration ? `Duration: ${duration}` : ''
        ].filter(Boolean).join('\n');
      }).join('\n\n')),
      summary: latest.content || latest.label || 'runtime status',
      collapsed: true,
      meta: [cleanCycleMeta(state.cycle), latest.label || 'runtime'].filter(Boolean).join(' | ')
    };
  };

  const appendStatus = (entry = {}, entryOptions = {}) => {
    const state = getStatusState(entry.cycle);
    state.events.push({
      label: entryOptions.label || statusLabelForType(entry.type || entry.kind),
      content: entryOptions.content || entry.content || entry.reason || entry.details || entry.message || '',
      durationMs: entry.throttleDelayMs || entry.retryDelayMs || entry.delayMs || null,
      kind: entryOptions.kind || (entry.type === 'provider_request_rejected' || entry.kind === 'error' ? 'error' : 'status'),
      ts: entry.ts || Date.now()
    });
    return createStatusEntry(state);
  };

  const deriveToolStatsFromActivities = (activities = []) => {
    const stats = { success: 0, error: 0 };
    for (const entry of activities) {
      if (entry?.kind !== 'tool_result') continue;
      if (isErrorToolResult(entry.result)) {
        stats.error++;
      } else {
        stats.success++;
      }
    }
    return stats;
  };

  const nextHistoryKey = () => {
    historySequence++;
    return `trace-${historySequence}`;
  };

  const withHistoryKey = (entry = {}) => {
    const key = String(entry.key || nextHistoryKey());
    return {
      ts: entry.ts || Date.now(),
      ...entry,
      key
    };
  };

  const syncExpandedTraceKeysFromDom = (root) => {
    if (!root) return;
    const detailsRows = root.querySelectorAll('details.zero-trace-details[data-trace-key]');
    for (const details of detailsRows) {
      const key = details.getAttribute('data-trace-key');
      if (!key) continue;
      if (details.open) {
        expandedTraceKeys.add(key);
      } else {
        expandedTraceKeys.delete(key);
      }
    }
  };

  const pruneExpandedTraceKeys = (history = []) => {
    const activeKeys = new Set(history.map((entry) => entry.key).filter(Boolean));
    expandedTraceKeys = new Set([...expandedTraceKeys].filter((key) => activeKeys.has(key)));
  };

  const getTraceRows = (container) =>
    [...(container?.querySelectorAll?.('.zero-trace-entry[data-trace-key]') || [])];

  const findTraceRowByKey = (container, key) =>
    getTraceRows(container).find((row) => row.dataset.traceKey === key) || null;

  const captureTraceScrollAnchor = (container) => {
    if (!container || container.scrollTop <= 1) return null;
    const containerRect = container.getBoundingClientRect();
    const rows = getTraceRows(container);
    const anchor = rows.find((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
    });
    if (!anchor) return null;
    return {
      key: anchor.dataset.traceKey,
      top: anchor.getBoundingClientRect().top,
      scrollTop: container.scrollTop
    };
  };

  const restoreTraceScrollAnchor = (container, anchor) => {
    if (!container || !anchor?.key) return;
    const row = findTraceRowByKey(container, anchor.key);
    if (!row) {
      container.scrollTop = anchor.scrollTop;
      return;
    }
    const nextTop = row.getBoundingClientRect().top;
    const delta = nextTop - anchor.top;
    if (Number.isFinite(delta) && delta !== 0) {
      container.scrollTop = anchor.scrollTop + delta;
    }
  };

  const renderHistory = (root, history = []) => {
    const container = root?.querySelector?.('#history-container');
    if (!container) return;

    syncExpandedTraceKeysFromDom(root);
    const scrollAnchor = captureTraceScrollAnchor(container);

    if (history.length === 0) {
      expandedTraceKeys.clear();
      container.innerHTML = '<div class="zero-trace-empty">No trace yet</div>';
      return;
    }

    container.innerHTML = history.map((entry) => {
      const key = String(entry.key || '');
      const isOpen = key && expandedTraceKeys.has(key);
      return `
        <article class="zero-trace-entry zero-trace-${escapeHtml(entry.kind || 'event')}" data-trace-key="${escapeHtml(key)}">
          <header class="zero-trace-entry-header">
            <span class="zero-trace-title">${escapeHtml(entry.title || 'Event')}</span>
            <span class="zero-trace-time">${escapeHtml(formatTime(entry.ts))}</span>
          </header>
          ${entry.meta ? `<div class="zero-trace-meta">${escapeHtml(entry.meta)}</div>` : ''}
          ${entry.collapsed
            ? `<details class="zero-trace-details" data-trace-key="${escapeHtml(key)}"${isOpen ? ' open' : ''}>
                <summary>${escapeHtml(entry.summary || tracePreview(entry.body || ''))}</summary>
                <div class="zero-trace-body" tabindex="0">${escapeHtml(entry.body || '')}</div>
              </details>`
            : `<div class="zero-trace-body" tabindex="0">${escapeHtml(entry.body || '')}</div>`}
        </article>
      `;
    }).join('');
    restoreTraceScrollAnchor(container, scrollAnchor);
  };

  const mapStreamEntry = (entry = '', status = {}) => {
    const chunk = typeof entry === 'string'
      ? entry
      : (entry.content || entry.text || entry.delta || '');
    if (!chunk) return null;
    const cycle = Number.isFinite(entry?.cycle) ? entry.cycle : (status.cycle || 0);
    if (streamTrace.cycle !== cycle) {
      streamTrace = {
        cycle,
        key: cycleKey(cycle, 'decision'),
        content: ''
      };
    }
    streamTrace.content += chunk;
    return {
      key: streamTrace.key,
      entry: createResponseEntry({
        cycle,
        content: streamTrace.content
      }, { streaming: true })
    };
  };

  const resetStreamTrace = () => {
    streamTrace = { cycle: null, key: null, content: '' };
  };

  return {
    appendStatus,
    createContextEntry,
    createResponseEntry,
    deriveToolStatsFromActivities,
    formatAgentState,
    formatTime,
    isErrorToolResult,
    mapStreamEntry,
    mergeToolBatchIntoAction,
    mergeToolLifecycleIntoAction,
    mergeToolResultIntoAction,
    pruneExpandedTraceKeys,
    renderHistory,
    resetStreamTrace,
    statusLabelForType,
    summarize,
    tracePreview,
    withHistoryKey
  };
}
