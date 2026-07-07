/**
 * @fileoverview Minimal runtime shell for Zero modes.
 */

import { getCurrentReploidStorage as getReploidStorage } from '../../instance.js';
import { formatRunReplayFilename } from '../../core/run-replay-bundle.js';
import { createZeroTraceView } from './trace-view.js';

const ZeroUI = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, initialGoal, mode } = deps;
    const { escapeHtml, trunc, logger } = Utils;

    const MAX_HISTORY_ENTRIES = 80;
    const traceView = createZeroTraceView({ escapeHtml, trunc });
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

    const getToolStatsTotal = () => _toolStats.success + _toolStats.error;

    const formatToolStats = () => `${_toolStats.success} ok / ${_toolStats.error} err`;

    const formatToolErrorRate = () => {
      const total = getToolStatsTotal();
      if (!total) return '0% fail';
      return `${Math.round((_toolStats.error / total) * 100)}% fail`;
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

    const pushHistory = (entry) => {
      if (!entry) return;
      const next = traceView.withHistoryKey(entry);
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
      traceView.pruneExpandedTraceKeys(_history);
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
        _history.unshift(traceView.withHistoryKey({ ...entry, key }));
      }
      if (_history.length > MAX_HISTORY_ENTRIES) {
        _history = _history.slice(0, MAX_HISTORY_ENTRIES);
      }
      traceView.pruneExpandedTraceKeys(_history);
      renderHistory();
    };

    const mapActivityEntry = (entry = {}) => {
      switch (entry.kind) {
        case 'tool_result':
          return traceView.mergeToolResultIntoAction(entry);
        case 'llm_response':
          return traceView.createResponseEntry(entry);
        case 'system_prompt':
          return null;
        case 'model_request':
          return traceView.createContextEntry(entry, { trackSnapshot: false });
        case 'human_message':
          return {
            kind: 'request',
            title: 'User note',
            body: traceView.summarize(entry.content, 220),
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
          return traceView.appendStatus(entry);
        default:
          return null;
      }
    };

    const mapHistoryEntry = (entry = {}) => {
      switch (entry.type) {
        case 'llm_response':
          return traceView.createResponseEntry(entry);
        case 'system_prompt':
          return null;
        case 'model_request':
          return traceView.createContextEntry(entry);
        case 'tool_result':
          return traceView.mergeToolResultIntoAction(entry);
        case 'tool_batch':
          return traceView.mergeToolBatchIntoAction(entry);
        case 'human':
          return {
            kind: 'request',
            title: 'User note',
            body: traceView.summarize(entry.content, 220),
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
          return traceView.appendStatus(entry);
        default:
          return traceView.appendStatus(entry, {
            label: traceView.statusLabelForType(entry.type),
            content: traceView.summarize(entry.content || entry.result || entry.message || entry, 320)
          });
      }
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

      if (stateEl) stateEl.textContent = traceView.formatAgentState(_status.state);
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
      traceView.renderHistory(_root, _history);
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
        body: traceView.summarize(content, 220),
        meta: 'Queued'
      });

      input.value = '';
    };

    const downloadJson = (payload, filename) => {
      const text = JSON.stringify(payload, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    };

    const exportRunJson = async () => {
      try {
        const bundle = await AgentLoop.exportReplayBundle?.({
          route: typeof window !== 'undefined' ? window.location?.pathname : undefined,
          mode
        });
        if (!bundle) {
          throw new Error('AgentLoop does not expose a replay export.');
        }
        downloadJson(bundle, formatRunReplayFilename(bundle));
        pushHistory(traceView.appendStatus({
          kind: 'run_replay_export',
          type: 'run_replay_export',
          content: `Exported ${bundle.metadata?.cycleCount || 0} cycle(s), ${bundle.metadata?.activityCount || 0} trace event(s), and ${bundle.metadata?.fileCount || 0} replay file(s).`
        }, {
          label: 'Run JSON exported'
        }));
      } catch (err) {
        logger.error('[ZeroUI] Run JSON export failed', err?.message || err);
        pushHistory(traceView.appendStatus({
          kind: 'error',
          content: err?.message || 'Run JSON export failed'
        }, {
          label: 'Run JSON export failed',
          kind: 'error'
        }));
      }
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
        case 'export-run-json':
          void exportRunJson();
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
          traceView.resetStreamTrace();
        }
        if (entry.type === 'human' && entry.content) {
          _goal = entry.messageType === 'goal' ? entry.content : _goal;
        }
        renderSummary();
      }));

      _subscriptions.push(EventBus.on('agent:stream', (entry = '') => {
        const stream = traceView.mapStreamEntry(entry, _status);
        if (stream) {
          upsertHistory(stream.key, stream.entry);
        }
      }));

      _subscriptions.push(EventBus.on('agent:tool:start', (entry = {}) => {
        pushHistory(traceView.mergeToolLifecycleIntoAction(entry, 'start'));
      }));

      _subscriptions.push(EventBus.on('agent:tool:end', (entry = {}) => {
        pushHistory(traceView.mergeToolLifecycleIntoAction(entry, 'end'));
      }));

      _subscriptions.push(EventBus.on('agent:error', (entry = {}) => {
        pushHistory(traceView.appendStatus({
          ...entry,
          kind: 'error',
          content: entry.error || entry.details || entry.message || 'Unknown error'
        }, {
          label: entry.message || 'Error',
          kind: 'error'
        }));
      }));

      _subscriptions.push(EventBus.on('agent:warning', (entry = {}) => {
        pushHistory(traceView.appendStatus({
          ...entry,
          kind: 'warning',
          content: entry.reason || entry.details || entry.message || ''
        }, {
          label: entry.message || traceView.statusLabelForType(entry.type || 'Warning'),
          kind: 'warning'
        }));
      }));
    };

    const seedRecentActivity = () => {
      const recent = AgentLoop.getRecentActivities?.() || [];
      _toolStats = traceView.deriveToolStatsFromActivities(recent);
      _history = recent
        .slice(-20)
        .reverse()
        .map(mapActivityEntry)
        .filter(Boolean)
        .map(traceView.withHistoryKey);
      traceView.pruneExpandedTraceKeys(_history);
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
                  <button class="btn" data-zero-action="export-run-json">Export run JSON</button>
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
