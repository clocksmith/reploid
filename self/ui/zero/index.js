/**
 * @fileoverview Minimal runtime shell for Zero modes.
 */

import { getCurrentReploidStorage as getReploidStorage } from '../../instance.js';

const ZeroUI = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, initialGoal, mode } = deps;
    const { escapeHtml, trunc, logger } = Utils;

    const MAX_HISTORY_ENTRIES = 80;
    const MAX_TRACE_TEXT_LENGTH = 12000;
    const MAX_TRACE_PREVIEW_LENGTH = 220;
    let _root = null;
    let _history = [];
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

    const formatTime = (ts) => {
      if (!ts) return '--:--:--';
      try {
        return new Date(ts).toLocaleTimeString([], { hour12: false });
      } catch {
        return '--:--:--';
      }
    };

    const formatModelMeta = (entry = {}) => {
      const label = entry.modelLabel || entry.modelUsed?.label;
      return label ? `Model ${label}` : '';
    };

    const pushHistory = (entry) => {
      if (!entry) return;
      _history.unshift({
        ts: Date.now(),
        ...entry
      });
      if (_history.length > MAX_HISTORY_ENTRIES) {
        _history = _history.slice(0, MAX_HISTORY_ENTRIES);
      }
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
        _history.unshift({
          key,
          ts: Date.now(),
          ...entry
        });
      }
      if (_history.length > MAX_HISTORY_ENTRIES) {
        _history = _history.slice(0, MAX_HISTORY_ENTRIES);
      }
      renderHistory();
    };

    const mapActivityEntry = (entry = {}) => {
      switch (entry.kind) {
        case 'tool_result':
          return {
            kind: 'tool',
            title: entry.tool || 'Tool',
            body: summarize(entry.result, 320),
            meta: [entry.cycle ? `Cycle ${entry.cycle}` : '', formatModelMeta(entry)].filter(Boolean).join(' | ')
          };
        case 'llm_response':
          return {
            kind: 'llm',
            title: entry.cycle ? `Cycle ${entry.cycle}` : 'LLM',
            body: traceText(entry.content),
            summary: tracePreview(entry.content),
            collapsed: true,
            meta: ['Response', formatModelMeta(entry)].filter(Boolean).join(' | ')
          };
        case 'system_prompt':
          return {
            kind: 'system',
            title: 'Initial system prompt',
            body: traceText(entry.content),
            summary: tracePreview(entry.content),
            collapsed: true,
            meta: 'System'
          };
        case 'human_message':
          return {
            kind: 'human',
            title: entry.messageType === 'goal' ? 'Goal note' : 'Human note',
            body: summarize(entry.content, 220),
            meta: entry.cycle ? `Cycle ${entry.cycle}` : ''
          };
        default:
          return null;
      }
    };

    const mapHistoryEntry = (entry = {}) => {
      switch (entry.type) {
        case 'llm_response':
          return {
            kind: 'llm',
            title: entry.cycle ? `Cycle ${entry.cycle}` : 'LLM',
            body: traceText(entry.content),
            summary: tracePreview(entry.content),
            collapsed: true,
            meta: ['Response', formatModelMeta(entry)].filter(Boolean).join(' | ')
          };
        case 'system_prompt':
          return {
            kind: 'system',
            title: 'Initial system prompt',
            body: traceText(entry.content),
            summary: tracePreview(entry.content),
            collapsed: true,
            meta: 'System'
          };
        case 'tool_result':
          return {
            kind: 'tool',
            title: entry.tool || 'Tool',
            body: summarize(entry.result, 320),
            meta: [
              entry.durationMs ? `${entry.durationMs}ms` : (entry.cycle ? `Cycle ${entry.cycle}` : ''),
              formatModelMeta(entry)
            ].filter(Boolean).join(' | ')
          };
        case 'tool_batch':
          return {
            kind: 'tool',
            title: `Batch ${entry.total || 0}`,
            body: Array.isArray(entry.calls)
              ? entry.calls.map((call) => `${call.name}(${summarize(call.args, 80)})`).join(', ')
              : (Array.isArray(entry.tools) ? entry.tools.join(', ') : ''),
            meta: [entry.errors ? `${entry.errors} error(s)` : 'ok', formatModelMeta(entry)].filter(Boolean).join(' | ')
          };
        case 'human':
          return {
            kind: 'human',
            title: entry.messageType === 'goal' ? 'Goal note' : 'Human note',
            body: summarize(entry.content, 220),
            meta: entry.cycle ? `Cycle ${entry.cycle}` : ''
          };
        default:
          return {
            kind: 'event',
            title: entry.type || 'Event',
            body: summarize(entry.content || entry.result || entry.message || entry, 220),
            meta: entry.cycle ? `Cycle ${entry.cycle}` : ''
          };
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
          key: `stream:${cycle || 'current'}`,
          content: ''
        };
      }
      _streamTrace.content += chunk;
      return {
        key: _streamTrace.key,
        entry: {
          kind: 'stream',
          title: cycle ? `Cycle ${cycle} stream` : 'Model stream',
          body: traceText(_streamTrace.content),
          summary: tracePreview(_streamTrace.content),
          collapsed: true,
          meta: 'Streaming'
        }
      };
    };

    const renderSummary = () => {
      if (!_root) return;

      const stateEl = _root.querySelector('#agent-state');
      const activityEl = _root.querySelector('#agent-activity');
      const cycleEl = _root.querySelector('#agent-cycle');
      const tokenEl = _root.querySelector('#agent-tokens');
      const modelEl = _root.querySelector('#agent-model');
      const goalEl = _root.querySelector('#agent-goal');
      const stopBtn = _root.querySelector('#btn-toggle');

      if (stateEl) stateEl.textContent = _status.state || 'IDLE';
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
      if (goalEl) {
        goalEl.textContent = _goal || 'No goal captured yet';
      }
      if (stopBtn) {
        stopBtn.textContent = AgentLoop.isRunning() ? 'Stop' : 'Stopped';
        stopBtn.disabled = !AgentLoop.isRunning();
      }
    };

    const renderHistory = () => {
      if (!_root) return;
      const container = _root.querySelector('#history-container');
      if (!container) return;

      if (_history.length === 0) {
        container.innerHTML = '<div class="zero-trace-empty">No trace yet</div>';
        return;
      }

      container.innerHTML = _history.map((entry) => `
        <article class="zero-trace-entry zero-trace-${escapeHtml(entry.kind || 'event')}">
          <header class="zero-trace-entry-header">
            <span class="zero-trace-title">${escapeHtml(entry.title || 'Event')}</span>
            <span class="zero-trace-time">${escapeHtml(formatTime(entry.ts))}</span>
          </header>
          ${entry.meta ? `<div class="zero-trace-meta">${escapeHtml(entry.meta)}</div>` : ''}
          ${entry.collapsed
            ? `<details class="zero-trace-details">
                <summary>${escapeHtml(entry.summary || tracePreview(entry.body || ''))}</summary>
                <div class="zero-trace-body">${escapeHtml(entry.body || '')}</div>
              </details>`
            : `<div class="zero-trace-body">${escapeHtml(entry.body || '')}</div>`}
        </article>
      `).join('');
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

      _subscriptions.push(EventBus.on('agent:error', (entry = {}) => {
        pushHistory({
          kind: 'error',
          title: entry.message || 'Agent error',
          body: summarize(entry.error || entry.details || 'Unknown error', 240),
          meta: entry.cycle ? `Cycle ${entry.cycle}` : ''
        });
      }));

      _subscriptions.push(EventBus.on('agent:warning', (entry = {}) => {
        pushHistory({
          kind: 'warning',
          title: entry.message || 'Warning',
          body: summarize(entry.reason || entry.details || entry.message || '', 240),
          meta: entry.cycle ? `Cycle ${entry.cycle}` : ''
        });
      }));
    };

    const seedRecentActivity = () => {
      const recent = AgentLoop.getRecentActivities?.() || [];
      _history = recent
        .slice(-20)
        .reverse()
        .map(mapActivityEntry)
        .filter(Boolean);
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
