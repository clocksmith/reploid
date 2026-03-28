/**
 * @fileoverview Minimal runtime shell for Zero modes.
 */

import { getCurrentReploidStorage as getReploidStorage } from '../../self/instance.js';

const ZeroUI = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, initialGoal, mode } = deps;
    const { escapeHtml, trunc, logger } = Utils;

    const MAX_HISTORY_ENTRIES = 80;
    let _root = null;
    let _history = [];
    let _subscriptions = [];
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

    const formatTime = (ts) => {
      if (!ts) return '--:--:--';
      try {
        return new Date(ts).toLocaleTimeString([], { hour12: false });
      } catch {
        return '--:--:--';
      }
    };

    const pushHistory = (entry) => {
      _history.unshift({
        ts: Date.now(),
        ...entry
      });
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
            meta: entry.cycle ? `Cycle ${entry.cycle}` : ''
          };
        case 'llm_response':
          return {
            kind: 'llm',
            title: entry.cycle ? `Cycle ${entry.cycle}` : 'LLM',
            body: summarize(entry.content, 360),
            meta: 'Response'
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
            body: summarize(entry.content, 360),
            meta: 'Response'
          };
        case 'tool_result':
          return {
            kind: 'tool',
            title: entry.tool || 'Tool',
            body: summarize(entry.result, 320),
            meta: entry.durationMs ? `${entry.durationMs}ms` : (entry.cycle ? `Cycle ${entry.cycle}` : '')
          };
        case 'tool_batch':
          return {
            kind: 'tool',
            title: `Batch ${entry.total || 0}`,
            body: Array.isArray(entry.tools) ? entry.tools.join(', ') : '',
            meta: entry.errors ? `${entry.errors} error(s)` : 'ok'
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
        container.innerHTML = '<div class="zero-history-empty">No activity yet</div>';
        return;
      }

      container.innerHTML = _history.map((entry) => `
        <div class="zero-history-entry zero-history-${escapeHtml(entry.kind || 'event')}">
          <div class="zero-history-header">
            <span class="zero-history-title">${escapeHtml(entry.title || 'Event')}</span>
            <span class="zero-history-time">${escapeHtml(formatTime(entry.ts))}</span>
          </div>
          ${entry.meta ? `<div class="zero-history-meta">${escapeHtml(entry.meta)}</div>` : ''}
          <div class="zero-history-body">${escapeHtml(entry.body || '')}</div>
        </div>
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
      const typeInput = _root?.querySelector('#zero-human-type');
      const content = input?.value?.trim();
      const messageType = typeInput?.value === 'goal' ? 'goal' : 'context';
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
        if (entry.type === 'human' && entry.content) {
          _goal = entry.messageType === 'goal' ? entry.content : _goal;
        }
        renderSummary();
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
          <div class="zero-shell-header">
            <div class="zero-shell-title">
              <div class="zero-shell-kicker">${escapeHtml(getModeLabel())}</div>
              <h1 class="zero-shell-heading">${escapeHtml(getModeLabel())}</h1>
            </div>
            <div class="zero-shell-actions">
              <button class="btn" id="btn-toggle" data-zero-action="stop">Stop</button>
              <button class="btn" data-zero-action="reload-ui">Reload UI</button>
            </div>
          </div>

          <div class="zero-metrics">
            <div class="panel zero-metric-card">
              <div class="zero-metric-label">State</div>
              <div class="zero-metric-value" id="agent-state">IDLE</div>
              <div class="zero-metric-detail" id="agent-activity">Awaiting goal</div>
            </div>
            <div class="panel zero-metric-card">
              <div class="zero-metric-label">Cycle</div>
              <div class="zero-metric-value" id="agent-cycle">0</div>
              <div class="zero-metric-detail">Current loop</div>
            </div>
            <div class="panel zero-metric-card">
              <div class="zero-metric-label">Tokens</div>
              <div class="zero-metric-value" id="agent-tokens">0</div>
              <div class="zero-metric-detail">Live budget</div>
            </div>
            <div class="panel zero-metric-card">
              <div class="zero-metric-label">Brain</div>
              <div class="zero-metric-value zero-metric-model" id="agent-model">-</div>
              <div class="zero-metric-detail">Selected models</div>
            </div>
          </div>

          <div class="panel zero-goal-panel">
            <div class="zero-panel-label">Goal</div>
            <pre class="zero-goal-text" id="agent-goal"></pre>
          </div>

          <div class="zero-main-grid">
            <div class="panel zero-history-panel">
              <div class="zero-panel-label">Activity</div>
              <div id="history-container" class="zero-history-list"></div>
            </div>

            <div class="panel zero-input-panel">
              <div class="zero-panel-label">Inject Note</div>
              <p class="type-caption">Send a short context note or goal refinement into the running agent.</p>
              <form id="zero-human-form" class="zero-human-form">
                <select id="zero-human-type">
                  <option value="context">Context note</option>
                  <option value="goal">Goal refinement</option>
                </select>
                <textarea id="zero-human-input" class="goal-input zero-human-input" rows="6" placeholder="Keep it short and concrete."></textarea>
                <button class="btn btn-prism" data-zero-action="send-note" type="submit">Send</button>
              </form>
            </div>
          </div>
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
