/**
 * @fileoverview Compact runtime shell for X and Zero.
 */

import { getCurrentReploidStorage as getReploidStorage } from '../../instance.js';
import { createRunReplayPanel } from './replay-panel.js';
import { exportSelfImage } from '../../image/export.js';
import { createZeroTraceView } from './trace-view.js';

const ZeroUI = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, VFS, HITLController, initialGoal, mode } = deps;
    const { escapeHtml, trunc, logger } = Utils;

    const MAX_HISTORY_ENTRIES = 80;
    const traceView = createZeroTraceView({ escapeHtml, trunc });
    let _root = null;
    let _history = [];
    let _conversation = [];
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
    let _models = [];
    const _approvals = new Map();
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

    const isConversationEntry = (entry) => ['decision', 'human'].includes(entry.kind)
      || (entry.kind === 'request' && entry.title === 'User note');

    const rememberConversation = (entry) => {
      if (!isConversationEntry(entry)) return;
      const index = entry.key ? _conversation.findIndex(item => item.key === entry.key) : -1;
      if (index >= 0) _conversation[index] = { ..._conversation[index], ...entry };
      else _conversation.unshift(entry);
      _conversation = _conversation.slice(0, MAX_HISTORY_ENTRIES);
    };

    const getTraceHistory = () => {
      const keys = new Set(_history.map(entry => entry.key));
      return [..._history, ..._conversation.filter(entry => !keys.has(entry.key))];
    };

    const pushHistory = (entry) => {
      if (!entry) return;
      const next = traceView.withHistoryKey(entry);
      rememberConversation(next);
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
      traceView.pruneExpandedTraceKeys(getTraceHistory());
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
      rememberConversation(_history.find(item => item.key === key));
      traceView.pruneExpandedTraceKeys(getTraceHistory());
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
            body: String(entry.content || ''),
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
            body: String(entry.content || ''),
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
      const stopBtn = _root.querySelector('#btn-toggle');

      if (stateEl) {
        stateEl.textContent = traceView.formatAgentState(_status.state);
        stateEl.dataset.agentState = String(_status.state || 'IDLE').toUpperCase();
      }
      if (activityEl) activityEl.textContent = _status.activity || 'Awaiting goal';
      if (cycleEl) cycleEl.textContent = String(_status.cycle || 0);
      if (tokenEl) {
        tokenEl.textContent = _tokens.limit
          ? `${_tokens.used} / ${_tokens.limit}`
          : String(_tokens.used || 0);
      }
      if (modelEl) {
        const names = _models.map((item) => item.provider === 'external' || item.id === 'external-brain'
          ? 'Connected agent' : item.name || item.id).filter(Boolean);
        modelEl.textContent = names.join(', ') || '-';
      }
      if (toolEl) {
        toolEl.textContent = formatToolStats();
        toolEl.classList.toggle('zero-runtime-alert', _toolStats.error > 0);
      }
      if (toolRateEl) {
        toolRateEl.textContent = formatToolErrorRate();
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
      traceView.renderHistory(_root, getTraceHistory());
      const conversation = _root.querySelector('#zero-conversation');
      if (conversation) {
        const entries = _conversation.slice().reverse();
        conversation.innerHTML = entries.map(entry => {
          const raw = String(entry.body || '');
          const technicalResponse = entry.kind === 'decision'
            && /^\s*(?:REPLOID\/\d+(?:\s|$)|TOOL(?:_CALL)?:\s*[A-Za-z0-9_]+(?:\s|$))/m.test(raw);
          const prose = technicalResponse
            ? 'Technical response. Details in Inspect.'
            : entry.kind === 'decision'
              ? raw.replace(/```[\s\S]*?(?:```|$)/g, '[Code in Inspect]')
              : raw;
          return `<article class="zero-message"><span class="zero-label">${entry.kind === 'decision' ? escapeHtml(getModeLabel()) : 'You'}</span><p>${escapeHtml(prose)}</p></article>`;
        }).join('') || '<p class="zero-label">Ready for the next response.</p>';
      }
      const notices = _root.querySelector('#zero-notices');
      if (notices) notices.innerHTML = _history.filter(entry => ['error', 'warning'].includes(entry.kind))
        .slice(0, 3).map(entry => `<p class="zero-notice" role="alert">${escapeHtml(entry.title || 'Error')}: ${escapeHtml(entry.body || '')}</p>`).join('');
      const approvals = _root.querySelector('#zero-approvals');
      if (approvals) approvals.innerHTML = [..._approvals.values()].map(item => `<section class="zero-approval" role="alert"><strong>Approval required: ${escapeHtml(item.action || item.capability || 'Operation')}</strong><pre>${escapeHtml(JSON.stringify(item.data || {}, null, 2))}</pre><button class="btn" data-zero-approval="${escapeHtml(item.id)}" data-zero-action="approve">Approve</button><button class="btn" data-zero-approval="${escapeHtml(item.id)}" data-zero-action="reject">Reject</button></section>`).join('');
    };

    const syncFromState = () => {
      try {
        const state = StateManager?.getState?.();
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
        body: content,
        meta: 'Queued'
      });

      input.value = '';
    };

    const downloadJson = (payload, filename, { compact = false } = {}) => {
      const text = JSON.stringify(payload, null, compact ? 0 : 2);
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

    const replayPanel = createRunReplayPanel({ escapeHtml, downloadJson, VFS });

    const exportRunJson = async () => {
      try {
        const bundle = await AgentLoop.exportReplayBundle?.({
          route: typeof window !== 'undefined' ? window.location?.pathname : undefined,
          mode
        });
        if (!bundle) {
          throw new Error('AgentLoop does not expose a replay export.');
        }
        replayPanel.preview(bundle);
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

    const exportSource = async () => {
      try {
        if (!VFS?.read || !VFS?.list) throw new Error('Source VFS is unavailable');
        const image = await exportSelfImage({ includeTools: true }, {
          VFS, readFile: async ({ path }) => ({ content: await VFS.read(path) })
        });
        downloadJson(image, `reploid-${String(mode || 'x')}-self-source.json`);
      } catch (error) {
        pushHistory(traceView.appendStatus({ content: error?.message || 'Source export failed' }, {
          label: 'Source export failed', kind: 'error'
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
        case 'export-self-source':
          void exportSource();
          break;
        case 'approve':
        case 'reject': {
          const approvalId = event.target.closest('[data-zero-approval]')?.dataset.zeroApproval;
          if (_approvals.has(approvalId)) EventBus.emit(`hitl:${action}`, { approvalId, reason: action === 'reject' ? 'Rejected by operator' : undefined });
          break;
        }
      }
    };

    const handleSubmit = (event) => {
      if (event.target?.id !== 'zero-human-form') return;
      event.preventDefault();
      sendHumanNote();
    };

    const subscribeEvents = () => {
      _subscriptions.push(EventBus.on('hitl:approval-pending', item => {
        if (item?.id) _approvals.set(item.id, item);
        renderHistory();
      }));
      for (const event of ['granted', 'rejected', 'timeout']) {
        _subscriptions.push(EventBus.on(`hitl:approval-${event}`, entry => {
          _approvals.delete(entry?.approvalId);
          renderHistory();
        }));
      }
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
      const mapped = recent.map(mapActivityEntry).filter(Boolean).map(traceView.withHistoryKey);
      _history = mapped.slice(-20).reverse();
      _conversation = mapped.filter(isConversationEntry).slice(-MAX_HISTORY_ENTRIES).reverse();
      traceView.pruneExpandedTraceKeys(getTraceHistory());
    };

    const render = () => {
      if (!_root) return;

      _root.innerHTML = `
        <div class="zero-shell">
          <header class="zero-header">
            <div class="zero-title"><h1 class="zero-shell-heading">${escapeHtml(getModeLabel())}</h1><span id="agent-model" class="zero-label">-</span></div>
            <div class="zero-actions"><strong id="agent-state">IDLE</strong><button class="btn" id="btn-toggle" data-zero-action="stop">Stop</button></div>
          </header>
          <div id="zero-notices"></div><div id="zero-approvals"></div>
          <section class="zero-goal"><span class="zero-label">Prompt</span><p class="zero-goal-text">${escapeHtml(initialGoal || getReploidStorage().getItem('REPLOID_GOAL') || '')}</p></section>
          <main class="zero-main"><div id="zero-conversation" class="zero-conversation" aria-live="polite"></div></main>
          <details class="zero-inspect">
            <summary>Inspect</summary>
            <div class="zero-inspect-content">
              <div class="zero-actions"><button class="btn" data-zero-action="export-self-source">Export self-source</button><button class="btn" data-zero-action="export-run-json">Export run JSON</button><button class="btn" data-zero-action="reload-ui">Reload UI</button></div>
              <div class="zero-runtime-strip" aria-label="Runtime details">
                <div class="zero-runtime-item"><span>Cycle</span><strong id="agent-cycle">0</strong></div>
                <div class="zero-runtime-item"><span>Tokens</span><strong id="agent-tokens">0</strong></div>
                <div class="zero-runtime-item"><span>Tools</span><strong id="agent-tools">0 ok / 0 err</strong><small id="agent-tool-rate">0% fail</small></div>
              </div>
              <div class="zero-more-line">Activity: <span id="agent-activity">Awaiting goal</span></div>
              <section id="zero-replay-panel"></section>
              <section class="zero-trace"><div class="zero-label">Trace</div><div id="history-container" class="zero-trace-list"></div></section>
            </div>
          </details>
          <form id="zero-human-form" class="zero-input"><label class="zero-label" for="zero-human-input">Add context or correction</label><div class="zero-input-row"><textarea id="zero-human-input" class="zero-human-input" rows="2" placeholder="Add a note for the next cycle."></textarea><button class="btn btn-prism" data-zero-action="send-note" type="submit">Send</button></div></form>
        </div>
      `;

      replayPanel.mount(_root.querySelector('#zero-replay-panel'));
      renderSummary();
      renderHistory();
    };

    const cleanup = () => {
      replayPanel.dispose();
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
      _approvals.clear();
      for (const item of HITLController?.getApprovalQueue?.() || []) {
        if (item?.id && item.status === 'pending') _approvals.set(item.id, item);
      }
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
