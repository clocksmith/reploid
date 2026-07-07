/**
 * @fileoverview Minimal runtime shell for Zero modes.
 */

import { getCurrentReploidStorage as getReploidStorage } from '../../instance.js';

const ZeroUI = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, initialGoal, mode } = deps;
    const { escapeHtml, trunc, logger } = Utils;

    const MAX_HISTORY_ENTRIES = 80;
    const MAX_TRACE_TEXT_LENGTH = 120000;
    const MAX_TRACE_PREVIEW_LENGTH = 220;
    let _root = null;
    let _history = [];
    let _historySequence = 0;
    let _expandedTraceKeys = new Set();
    let _lastModelRequestSnapshot = null;
    let _cycleActionState = new Map();
    let _cycleStatusState = new Map();
    let _subscriptions = [];
    let _streamTrace = {
      cycle: null,
      key: null,
      content: ''
    };
    let _status = {
      state: 'IDLE',
      activity: 'Awaiting goal',
      cycle: 0
    };
    let _tokens = {
      used: 0,
      limit: 0
    };
    let _toolStats = {
      success: 0,
      error: 0
    };
    let _goal = initialGoal || '';
    let _models = [];
    const getModeLabel = () => {
      if (mode === 'reploid') return 'Reploid';
      if (mode === 'zero') return 'Zero';
      return 'X';
    };

    const readSelectedModels = () => {
      const storage = getReploidStorage();
      try {
        const raw = storage.getItem('SELECTED_MODELS');
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
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
      const previous = _lastModelRequestSnapshot?.messages || [];
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
        _lastModelRequestSnapshot = { messages };
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

    const getToolStatsTotal = () => _toolStats.success + _toolStats.error;

    const formatToolStats = () => `${_toolStats.success} ok / ${_toolStats.error} err`;

    const formatToolErrorRate = () => {
      const total = getToolStatsTotal();
      if (!total) return '0% fail';
      return `${Math.round((_toolStats.error / total) * 100)}% fail`;
    };

    const createContextEntry = (entry = {}, options = {}) => {
      const messages = parseTraceMessages(entry.content);
      const previous = _lastModelRequestSnapshot?.messages || [];
      const hasRuntimeDelta = Array.isArray(entry.contextDeltaMessages);
      let delta = hasRuntimeDelta ? entry.contextDeltaMessages : messages;
      let mode = hasRuntimeDelta ? (entry.contextDeltaMode || 'delta') : 'initial';
      if (hasRuntimeDelta) {
        if (options.trackSnapshot !== false) {
          _lastModelRequestSnapshot = { messages };
        }
      } else {
        ({ delta, mode } = getContextDelta(messages, options.trackSnapshot !== false));
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

    const extractDecisionToolNames = (content = '') => {
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

    const summarizeDecision = (entry = {}) => {
      const content = String(entry.content || '').trim();
      const tools = extractDecisionToolNames(content);
      if (tools.length > 0) {
        return `tool request: ${formatCount(tools.length)} tool kind(s)`;
      }
      const directive = content.match(/^(DONE|IDLE|PARK):?/i)?.[1];
      if (directive) return `${directive.toUpperCase()} directive`;
      return tracePreview(content) || 'no text response';
    };

    const createDecisionEntry = (entry = {}, options = {}) => {
      const duration = formatDuration(entry.latencyMs);
      return {
        kind: 'decision',
        key: cycleKey(entry.cycle, 'decision'),
        title: 'Model Output',
        body: traceText(entry.content),
        summary: options.streaming ? tracePreview(entry.content) : summarizeDecision(entry),
        collapsed: true,
        meta: [
          cleanCycleMeta(entry.cycle),
          options.streaming ? 'streaming' : 'returned by model',
          duration ? `context to decision ${duration}` : '',
          formatModelMeta(entry)
        ].filter(Boolean).join(' | ')
      };
    };

    const getActionState = (cycle = 0) => {
      const key = Number(cycle) || 0;
      if (!_cycleActionState.has(key)) {
        _cycleActionState.set(key, {
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
      return _cycleActionState.get(key);
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

    const createActionEntry = (state = {}) => {
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
        `Ran: ${requested.length ? requested.join(', ') : 'none yet'}`,
        `Result: ${formatCount(okCount)} ok / ${formatCount(errors)} err`,
        firstError ? `First error: ${summarize(firstError, 320)}` : '',
        duration ? `Action duration: ${duration}` : ''
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
          requested.length ? `ran ${formatCount(state.total || resultRows.length)} tool(s)` : 'waiting for tool execution',
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
      return createActionEntry(state);
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
      return createActionEntry(state);
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
      return createActionEntry(state);
    };

    const getStatusState = (cycle = 0) => {
      const key = Number(cycle) || 0;
      if (!_cycleStatusState.has(key)) {
        _cycleStatusState.set(key, { cycle: key, events: [] });
      }
      return _cycleStatusState.get(key);
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

    const appendStatus = (entry = {}, options = {}) => {
      const state = getStatusState(entry.cycle);
      state.events.push({
        label: options.label || statusLabelForType(entry.type || entry.kind),
        content: options.content || entry.content || entry.reason || entry.details || entry.message || '',
        durationMs: entry.throttleDelayMs || entry.retryDelayMs || entry.delayMs || null,
        kind: options.kind || (entry.type === 'provider_request_rejected' || entry.kind === 'error' ? 'error' : 'status'),
        ts: entry.ts || Date.now()
      });
      return createStatusEntry(state);
    };

    const applyToolBatchStats = (entry = {}) => {
      const callCount = Number.isFinite(entry.total)
        ? entry.total
        : (Array.isArray(entry.calls) ? entry.calls.length : 0);
      const resultErrors = Array.isArray(entry.results)
        ? entry.results.filter((result) => result?.error).length
        : null;
      const errorCount = Number.isFinite(entry.errors)
        ? entry.errors
        : (Number.isFinite(resultErrors) ? resultErrors : 0);
      const safeTotal = Math.max(0, callCount);
      const safeErrors = Math.min(safeTotal, Math.max(0, errorCount));
      _toolStats = {
        success: _toolStats.success + Math.max(0, safeTotal - safeErrors),
        error: _toolStats.error + safeErrors
      };
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
      _historySequence++;
      return `trace-${_historySequence}`;
    };

    const withHistoryKey = (entry = {}) => {
      const key = String(entry.key || nextHistoryKey());
      return {
        ts: entry.ts || Date.now(),
        ...entry,
        key
      };
    };

    const syncExpandedTraceKeysFromDom = () => {
      if (!_root) return;
      const detailsRows = _root.querySelectorAll('details.zero-trace-details[data-trace-key]');
      for (const details of detailsRows) {
        const key = details.getAttribute('data-trace-key');
        if (!key) continue;
        if (details.open) {
          _expandedTraceKeys.add(key);
        } else {
          _expandedTraceKeys.delete(key);
        }
      }
    };

    const pruneExpandedTraceKeys = () => {
      const activeKeys = new Set(_history.map((entry) => entry.key).filter(Boolean));
      _expandedTraceKeys = new Set([..._expandedTraceKeys].filter((key) => activeKeys.has(key)));
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

    const pushHistory = (entry) => {
      if (!entry) return;
      const next = withHistoryKey(entry);
      const existingIndex = next.key
        ? _history.findIndex((item) => item.key === next.key)
        : -1;
      if (existingIndex >= 0) {
        _history[existingIndex] = {
          ..._history[existingIndex],
          ...next
        };
      } else {
        _history.unshift(next);
      }
      if (_history.length > MAX_HISTORY_ENTRIES) {
        _history = _history.slice(0, MAX_HISTORY_ENTRIES);
      }
      pruneExpandedTraceKeys();
      renderHistory();
    };

    const upsertHistory = (key, entry) => {
      if (!key || !entry) return;
      const index = _history.findIndex((item) => item.key === key);
      if (index >= 0) {
        _history[index] = {
          ..._history[index],
          ...entry,
          key,
          ts: Date.now()
        };
      } else {
        _history.unshift(withHistoryKey({ ...entry, key }));
      }
      if (_history.length > MAX_HISTORY_ENTRIES) {
        _history = _history.slice(0, MAX_HISTORY_ENTRIES);
      }
      pruneExpandedTraceKeys();
      renderHistory();
    };

    const mapActivityEntry = (entry = {}) => {
      switch (entry.kind) {
        case 'tool_result':
          return mergeToolResultIntoAction(entry);
        case 'llm_response':
          return createDecisionEntry(entry);
        case 'system_prompt':
          return null;
        case 'model_request':
          return createContextEntry(entry, { trackSnapshot: false });
        case 'human_message':
          return {
            kind: 'request',
            title: 'User note',
            body: summarize(entry.content, 220),
            meta: [entry.cycle ? `Cycle ${entry.cycle}` : '', entry.messageType === 'goal' ? 'Goal note' : 'Human note'].filter(Boolean).join(' | ')
          };
        case 'provider_context_envelope':
        case 'build_progress_gate':
        case 'provider_unavailable':
        case 'provider_request_rejected':
        case 'provider_resume':
        case 'tool_cooldown_resume':
        case 'cycle_throttle':
        case 'context_compacted':
          return appendStatus(entry);
        default:
          return null;
      }
    };

    const mapHistoryEntry = (entry = {}) => {
      switch (entry.type) {
        case 'llm_response':
          return createDecisionEntry(entry);
        case 'system_prompt':
          return null;
        case 'model_request':
          return createContextEntry(entry);
        case 'tool_result':
          return mergeToolResultIntoAction(entry);
        case 'tool_batch':
          return mergeToolBatchIntoAction(entry);
        case 'human':
          return {
            kind: 'request',
            title: 'User note',
            body: summarize(entry.content, 220),
            meta: [entry.cycle ? `Cycle ${entry.cycle}` : '', entry.messageType === 'goal' ? 'Goal note' : 'Human note'].filter(Boolean).join(' | ')
          };
        case 'provider_context_envelope':
        case 'build_progress_gate':
        case 'provider_unavailable':
        case 'provider_request_rejected':
        case 'provider_resume':
        case 'tool_cooldown_resume':
        case 'cycle_throttle':
        case 'context_compacted':
          return appendStatus(entry);
        default:
          return appendStatus(entry, {
            label: statusLabelForType(entry.type),
            content: summarize(entry.content || entry.result || entry.message || entry, 320)
          });
      }
    };

    const mapStreamEntry = (entry = '') => {
      const chunk = typeof entry === 'string'
        ? entry
        : (entry.content || entry.text || entry.delta || '');
      if (!chunk) return null;
      const cycle = Number.isFinite(entry?.cycle) ? entry.cycle : (_status.cycle || 0);
      if (_streamTrace.cycle !== cycle) {
        _streamTrace = {
          cycle,
          key: cycleKey(cycle, 'decision'),
          content: ''
        };
      }
      _streamTrace.content += chunk;
      return {
        key: _streamTrace.key,
        entry: createDecisionEntry({
          cycle,
          content: _streamTrace.content
        }, { streaming: true })
      };
    };

    const renderSummary = () => {
      if (!_root) return;

      const stateEl = _root.querySelector('#agent-state');
      const activityEl = _root.querySelector('#agent-activity');
      const cycleEl = _root.querySelector('#agent-cycle');
      const tokenEl = _root.querySelector('#agent-tokens');
      const modelEl = _root.querySelector('#agent-model');
      const toolEl = _root.querySelector('#agent-tools');
      const toolRateEl = _root.querySelector('#agent-tool-rate');
      const goalEl = _root.querySelector('#agent-goal');
      const stopBtn = _root.querySelector('#btn-toggle');

      if (stateEl) stateEl.textContent = formatAgentState(_status.state);
      if (activityEl) activityEl.textContent = _status.activity || 'Awaiting goal';
      if (cycleEl) cycleEl.textContent = String(_status.cycle || 0);
      if (tokenEl) {
        tokenEl.textContent = _tokens.limit
          ? `${_tokens.used} / ${_tokens.limit}`
          : String(_tokens.used || 0);
      }
      if (modelEl) {
        const names = _models.map((item) => item.name || item.id).filter(Boolean);
        modelEl.textContent = names.join(', ') || '-';
      }
      if (toolEl) {
        toolEl.textContent = formatToolStats();
        toolEl.classList.toggle('zero-runtime-alert', _toolStats.error > 0);
      }
      if (toolRateEl) {
        toolRateEl.textContent = formatToolErrorRate();
      }
      if (goalEl) {
        goalEl.textContent = _goal || 'No goal captured yet';
      }
      if (stopBtn) {
        const pendingResume = AgentLoop.hasPendingProviderResume?.() || _status.autoResume;
        stopBtn.textContent = AgentLoop.isRunning()
          ? 'Stop'
          : (pendingResume ? 'Cancel retry' : 'Stopped');
        stopBtn.disabled = !AgentLoop.isRunning() && !pendingResume;
      }
    };

    const renderHistory = () => {
      if (!_root) return;
      const container = _root.querySelector('#history-container');
      if (!container) return;

      syncExpandedTraceKeysFromDom();
      const scrollAnchor = captureTraceScrollAnchor(container);

      if (_history.length === 0) {
        _expandedTraceKeys.clear();
        container.innerHTML = '<div class="zero-trace-empty">No trace yet</div>';
        return;
      }

      container.innerHTML = _history.map((entry) => {
        const key = String(entry.key || '');
        const isOpen = key && _expandedTraceKeys.has(key);
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

    const syncFromState = () => {
      try {
        const state = StateManager?.getState?.();
        if (state?.currentGoal?.text) {
          _goal = state.currentGoal.text;
        }
        if (Number.isFinite(state?.totalCycles) && !_status.cycle) {
          _status.cycle = state.totalCycles;
        }
      } catch (err) {
        logger.debug('[ZeroUI] Failed to read state snapshot', err?.message || err);
      }
      renderSummary();
    };

    const sendHumanNote = () => {
      const input = _root?.querySelector('#zero-human-input');
      const content = input?.value?.trim();
      const messageType = 'context';
      if (!content) return;

      EventBus.emit('human:message', { content, type: messageType });
      pushHistory({
        kind: 'human',
        title: messageType === 'goal' ? 'Goal note' : 'Human note',
        body: summarize(content, 220),
        meta: 'Queued'
      });

      input.value = '';
    };

    const handleClick = (event) => {
      const action = event.target.closest('[data-zero-action]')?.dataset.zeroAction;
      if (!action) return;
      event.preventDefault();

      switch (action) {
        case 'stop':
          AgentLoop.stop();
          _status = {
            ..._status,
            state: 'IDLE',
            activity: 'Stopped by user'
          };
          renderSummary();
          break;
        case 'reload-ui':
          if (window.REPLOID_UI?.reload) {
            window.REPLOID_UI.reload('manual');
          }
          break;
        case 'send-note':
          sendHumanNote();
          break;
      }
    };

    const handleSubmit = (event) => {
      if (event.target?.id !== 'zero-human-form') return;
      event.preventDefault();
      sendHumanNote();
    };

    const subscribeEvents = () => {
      _subscriptions.push(EventBus.on('agent:status', (status = {}) => {
        _status = {
          ..._status,
          ...status,
          cycle: status.cycle ?? _status.cycle
        };
        renderSummary();
      }));

      _subscriptions.push(EventBus.on('agent:tokens', (data = {}) => {
        _tokens = {
          used: data.tokens || 0,
          limit: data.limit || _tokens.limit || 0
        };
        renderSummary();
      }));

      _subscriptions.push(EventBus.on('agent:history', (entry = {}) => {
        pushHistory(mapHistoryEntry(entry));
        if (entry.type === 'tool_batch') {
          applyToolBatchStats(entry);
        }
        if (entry.type === 'llm_response') {
          _streamTrace = { cycle: null, key: null, content: '' };
        }
        if (entry.type === 'human' && entry.content) {
          _goal = entry.messageType === 'goal' ? entry.content : _goal;
        }
        renderSummary();
      }));

      _subscriptions.push(EventBus.on('agent:stream', (entry = '') => {
        const stream = mapStreamEntry(entry);
        if (stream) {
          upsertHistory(stream.key, stream.entry);
        }
      }));

      _subscriptions.push(EventBus.on('agent:tool:start', (entry = {}) => {
        pushHistory(mergeToolLifecycleIntoAction(entry, 'start'));
      }));

      _subscriptions.push(EventBus.on('agent:tool:end', (entry = {}) => {
        pushHistory(mergeToolLifecycleIntoAction(entry, 'end'));
      }));

      _subscriptions.push(EventBus.on('agent:error', (entry = {}) => {
        pushHistory(appendStatus({
          ...entry,
          kind: 'error',
          content: entry.error || entry.details || entry.message || 'Unknown error'
        }, {
          label: entry.message || 'Error',
          kind: 'error'
        }));
      }));

      _subscriptions.push(EventBus.on('agent:warning', (entry = {}) => {
        pushHistory(appendStatus({
          ...entry,
          kind: 'warning',
          content: entry.reason || entry.details || entry.message || ''
        }, {
          label: entry.message || statusLabelForType(entry.type || 'Warning'),
          kind: 'warning'
        }));
      }));
    };

    const seedRecentActivity = () => {
      const recent = AgentLoop.getRecentActivities?.() || [];
      _toolStats = deriveToolStatsFromActivities(recent);
      _history = recent
        .slice(-20)
        .reverse()
        .map(mapActivityEntry)
        .filter(Boolean)
        .map(withHistoryKey);
      pruneExpandedTraceKeys();
    };

    const render = () => {
      if (!_root) return;

      _root.innerHTML = `
        <div class="zero-shell">
          <header class="zero-header">
            <div class="zero-title">
              <div class="zero-kicker">tabula rasa runtime</div>
              <h1 class="zero-shell-heading">${escapeHtml(getModeLabel())}</h1>
            </div>
            <div class="zero-actions">
              <button class="btn" id="btn-toggle" data-zero-action="stop">Stop</button>
              <details class="zero-more">
                <summary class="btn">More</summary>
                <div class="zero-more-menu">
                  <button class="btn" data-zero-action="reload-ui">Reload UI</button>
                  <div class="zero-more-line">Activity: <span id="agent-activity">Awaiting goal</span></div>
                  <form id="zero-human-form" class="zero-input">
                    <label class="zero-label" for="zero-human-input">Add context or correction</label>
                    <div class="zero-input-row">
                      <textarea id="zero-human-input" class="zero-human-input" rows="3" placeholder="Add one concrete note for the next cycle."></textarea>
                      <button class="btn btn-prism" data-zero-action="send-note" type="submit">Send</button>
                    </div>
                  </form>
                </div>
              </details>
            </div>
          </header>

          <section class="zero-runtime-strip" aria-label="Runtime status">
            <div class="zero-runtime-item">
              <span>State</span>
              <strong id="agent-state">IDLE</strong>
            </div>
            <div class="zero-runtime-item">
              <span>Cycle</span>
              <strong id="agent-cycle">0</strong>
            </div>
            <div class="zero-runtime-item">
              <span>Model</span>
              <strong id="agent-model">-</strong>
            </div>
            <div class="zero-runtime-item">
              <span>Tokens</span>
              <strong id="agent-tokens">0</strong>
            </div>
            <div class="zero-runtime-item">
              <span>Tools</span>
              <strong id="agent-tools">0 ok / 0 err</strong>
              <small id="agent-tool-rate">0% fail</small>
            </div>
          </section>

          <main class="zero-main">
            <section class="zero-goal">
              <div class="zero-label">Goal</div>
              <p class="zero-goal-text" id="agent-goal"></p>
            </section>

            <section class="zero-trace">
              <div class="zero-label">Trace</div>
              <div id="history-container" class="zero-trace-list"></div>
            </section>
          </main>
        </div>
      `;

      renderSummary();
      renderHistory();
    };

    const cleanup = () => {
      _subscriptions.forEach((unsubscribe) => {
        try { unsubscribe(); } catch { /* ignore */ }
      });
      _subscriptions = [];
      if (_root) {
        _root.removeEventListener('click', handleClick);
        _root.removeEventListener('submit', handleSubmit);
      }
    };

    const mount = async (root) => {
      _root = root;
      _models = readSelectedModels();
      seedRecentActivity();
      render();
      syncFromState();
      _root.addEventListener('click', handleClick);
      _root.addEventListener('submit', handleSubmit);
      subscribeEvents();
    };

    const setModels = (models = []) => {
      _models = Array.isArray(models) ? models : [];
      renderSummary();
    };

    return {
      mount,
      cleanup,
      setModels
    };
  }
};

export default ZeroUI;
