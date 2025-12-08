/**
 * @fileoverview Proto UI - Modular version
 * Main user interface for the agent.
 * Re-exports a Proto object compatible with the original API.
 */

import Toast from '../toast.js';
import InlineChat, { INLINE_CHAT_STYLES } from '../components/inline-chat.js';

import { createTelemetryManager } from './telemetry.js';
import { createSchemaManager } from './schemas.js';
import { createWorkerManager } from './workers.js';
import { createVFSManager } from './vfs.js';
import { renderProtoTemplate } from './template.js';

const Proto = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, WorkerManager, ErrorStore, VFS } = deps;
    const { logger, escapeHtml } = Utils;

    // Initialize managers
    const telemetryManager = createTelemetryManager({ logger, escapeHtml });
    const schemaManager = createSchemaManager({ logger, escapeHtml });
    const workerManager = createWorkerManager({ escapeHtml, WorkerManager });
    const vfsManager = createVFSManager({ escapeHtml, logger, Toast });

    // UI state
    let _root = null;
    let _reflectionsContainer = null;
    let _inlineChat = null;
    let _vfsPanelCollapsed = false;
    let _vfsSearchTimeout = null;

    // Token tracking
    let _tokenCount = 0;
    let _maxTokens = 32000;

    // Event subscriptions
    let _subscriptionIds = [];

    // Scroll throttling
    let _historyScrollScheduled = false;
    let _reflectionScrollScheduled = false;

    const scheduleHistoryScroll = () => {
      if (_historyScrollScheduled) return;
      _historyScrollScheduled = true;
      requestAnimationFrame(() => {
        const container = document.getElementById('history-container');
        if (container) container.scrollTop = container.scrollHeight;
        _historyScrollScheduled = false;
      });
    };

    const scheduleReflectionScroll = () => {
      if (_reflectionScrollScheduled) return;
      _reflectionScrollScheduled = true;
      requestAnimationFrame(() => {
        if (_reflectionsContainer) _reflectionsContainer.scrollTop = _reflectionsContainer.scrollHeight;
        _reflectionScrollScheduled = false;
      });
    };

    const MAX_REFLECTIONS = 100;
    const MAX_HISTORY_ENTRIES = 200;

    // Error handling via ErrorStore
    const updateStatusBadge = async () => {
      const statusBtn = document.querySelector('[data-tab="status"]');
      if (!statusBtn || !ErrorStore) return;

      try {
        const errors = await ErrorStore.getErrors();
        const errorCount = errors.filter(e => e.severity === 'error').length;
        const warningCount = errors.filter(e => e.severity === 'warning').length;

        let existingBadge = statusBtn.querySelector('.status-badge');

        if (errorCount > 0 || warningCount > 0) {
          if (!existingBadge) {
            existingBadge = document.createElement('span');
            existingBadge.className = 'status-badge';
            statusBtn.appendChild(existingBadge);
          }
          existingBadge.textContent = errorCount + warningCount;
          existingBadge.className = errorCount > 0 ? 'status-badge error' : 'status-badge warning';
        } else if (existingBadge) {
          existingBadge.remove();
        }

        // Update errors list if status tab is visible
        if (!document.getElementById('tab-status')?.classList.contains('hidden')) {
          renderErrorsList();
        }
      } catch (e) {
        logger.warn('[Proto] Failed to update status badge:', e.message);
      }
    };

    const renderErrorsList = async () => {
      const errorsList = document.getElementById('errors-list');
      const clearBtn = document.getElementById('clear-errors-btn');
      if (!errorsList || !ErrorStore) return;

      try {
        const errors = await ErrorStore.getErrors();

        if (errors.length === 0) {
          errorsList.innerHTML = '<div class="text-muted" style="padding: 10px;">No errors or warnings</div>';
          if (clearBtn) clearBtn.style.display = 'none';
          return;
        }

        if (clearBtn) {
          clearBtn.style.display = 'inline-block';
          clearBtn.onclick = async () => {
            await ErrorStore.clearErrors();
          };
        }

        errorsList.innerHTML = errors.map((error) => {
          const timestamp = new Date(error.ts).toLocaleTimeString();
          const icon = error.severity === 'warning' ? '⚠' : '✗';
          const typeClass = error.severity === 'warning' ? 'warning' : 'error';

          return `
            <details class="error-item ${typeClass}">
              <summary class="error-summary">
                <span class="error-icon">${icon}</span>
                <span class="error-title">${escapeHtml(error.type || 'Error')}</span>
                <span class="error-time">${timestamp}</span>
              </summary>
              <div class="error-details">
                <pre>${escapeHtml(error.message || '')}</pre>
              </div>
            </details>
          `;
        }).join('');
      } catch (e) {
        logger.warn('[Proto] Failed to render errors list:', e.message);
      }
    };

    // History persistence via VFS
    const HISTORY_PATH = '/.memory/history.json';
    const MAX_HISTORY_PERSISTED = 500;
    let _historyCache = [];
    let _historyLoaded = false;

    const loadHistory = async () => {
      if (_historyLoaded || !VFS) return;
      try {
        if (await VFS.exists(HISTORY_PATH)) {
          const content = await VFS.read(HISTORY_PATH);
          _historyCache = JSON.parse(content);
          if (!Array.isArray(_historyCache)) _historyCache = [];
          logger.info(`[Proto] Loaded ${_historyCache.length} history entries from VFS`);
        }
      } catch (e) {
        logger.warn('[Proto] Failed to load history:', e.message);
        _historyCache = [];
      }
      _historyLoaded = true;
    };

    const saveHistoryEntry = async (entry) => {
      if (!VFS) return;
      await loadHistory();

      _historyCache.push({
        ...entry,
        ts: Date.now()
      });

      // Prune oldest if over limit
      if (_historyCache.length > MAX_HISTORY_PERSISTED) {
        _historyCache = _historyCache.slice(-MAX_HISTORY_PERSISTED);
      }

      try {
        await VFS.write(HISTORY_PATH, JSON.stringify(_historyCache, null, 2));
      } catch (e) {
        logger.warn('[Proto] Failed to save history:', e.message);
      }
    };

    const renderSavedHistory = async () => {
      const historyContainer = document.getElementById('history-container');
      if (!historyContainer || !VFS) return;

      await loadHistory();

      if (_historyCache.length === 0) return;

      // Clear placeholder
      historyContainer.innerHTML = '';

      // Render last 200 entries max in DOM
      const entriesToRender = _historyCache.slice(-MAX_HISTORY_ENTRIES);

      for (const entry of entriesToRender) {
        const div = document.createElement('div');
        renderHistoryEntry(div, entry);
        historyContainer.appendChild(div);
      }

      scheduleHistoryScroll();
    };

    const renderHistoryEntry = (div, entry) => {
      if (entry.type === 'llm_response') {
        div.className = 'history-entry llm';
        div.innerHTML = `
          <div class="history-header">
            <span class="entry-label">&#9670; Agent</span>
            <span class="entry-cycle">#${entry.cycle || '-'}</span>
          </div>
          <pre class="history-content">${escapeHtml(entry.content)}</pre>
        `;
      } else if (entry.type === 'tool_result') {
        const isError = entry.status === 'error';
        const result = typeof entry.result === 'string'
          ? entry.result
          : JSON.stringify(entry.result, null, 2);

        div.className = `history-entry tool ${isError ? 'error' : 'success'}`;
        div.innerHTML = `
          <div class="history-header">
            &#x25B6; Sent #${entry.cycle} &#x2192; ${entry.tool}
            ${isError ? '<span class="error-badge">ERROR</span>' : ''}
          </div>
          <pre class="history-content">${escapeHtml(result)}</pre>
        `;
      } else if (entry.type === 'human') {
        const isGoal = entry.messageType === 'goal';
        div.className = `history-entry human-message ${isGoal ? 'goal-refinement' : ''}`;
        div.innerHTML = `
          <div class="history-header">
            <span class="entry-label">${isGoal ? '&#x2691; You (Goal)' : '&#x2709; You'}</span>
            <span class="entry-cycle">#${entry.cycle || '-'}</span>
          </div>
          <pre class="history-content">${escapeHtml(entry.content)}</pre>
        `;
      }
    };

    const onReflection = (entry) => {
      if (!_reflectionsContainer) return;

      while (_reflectionsContainer.children.length >= MAX_REFLECTIONS) {
        _reflectionsContainer.removeChild(_reflectionsContainer.firstChild);
      }

      const div = document.createElement('div');
      const isError = entry.type === 'error';
      div.className = `reflection-entry ${isError ? 'reflection-error' : 'reflection-success'}`;

      const tool = entry.context?.tool || 'unknown';
      const cycle = entry.context?.cycle || '?';
      const indicator = entry.context?.failureIndicator;
      const args = entry.context?.args;

      let argsPreview = '';
      if (args) {
        if (args.path) argsPreview = args.path;
        else if (args.name) argsPreview = args.name;
        else {
          const keys = Object.keys(args);
          if (keys.length > 0) argsPreview = keys.join(', ');
        }
      }

      const icon = isError ? '✗' : '✓';
      const toolInfo = argsPreview ? `${tool}(${argsPreview})` : tool;

      let detailText = '';
      if (indicator) {
        detailText = indicator;
      } else if (entry.content) {
        const content = entry.content.replace(`Tool ${tool}: `, '');
        detailText = content.length > 60 ? content.substring(0, 60) + '...' : content;
      }

      div.innerHTML = `
        <div class="reflection-header">
          <span class="reflection-icon">${icon}</span>
          <span class="reflection-tool">${toolInfo}</span>
          <span class="reflection-cycle">#${cycle}</span>
        </div>
        ${detailText ? `<div class="reflection-detail">${escapeHtml(detailText)}</div>` : ''}
      `;

      div.title = entry.content;
      _reflectionsContainer.appendChild(div);
      scheduleReflectionScroll();
    };

    const updateTokenBudget = (tokens) => {
      _tokenCount = tokens;
      const budgetFill = document.getElementById('token-budget-fill');
      const budgetText = document.getElementById('token-budget-text');

      if (!budgetFill || !budgetText) return;

      const percentage = Math.min((_tokenCount / _maxTokens) * 100, 100);
      budgetFill.style.width = `${percentage}%`;

      budgetFill.classList.remove('low', 'medium', 'high');
      if (percentage < 50) {
        budgetFill.classList.add('low');
      } else if (percentage < 80) {
        budgetFill.classList.add('medium');
      } else {
        budgetFill.classList.add('high');
      }

      const displayTokens = _tokenCount >= 1000
        ? `${Math.round(_tokenCount / 1000)}k`
        : _tokenCount.toString();
      const displayMax = _maxTokens >= 1000
        ? `${Math.round(_maxTokens / 1000)}k`
        : _maxTokens.toString();
      budgetText.textContent = `${displayTokens} / ${displayMax}`;
    };

    const switchTab = (tabId) => {
      const container = _root?.querySelector('.app-shell');
      if (!container) return;

      const tabButtons = container.querySelectorAll('.sidebar-btn[data-tab]');
      tabButtons.forEach(b => b.classList.remove('active'));

      const targetBtn = container.querySelector(`[data-tab="${tabId}"]`);
      if (targetBtn) targetBtn.classList.add('active');

      container.querySelectorAll('.workspace-content').forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== `tab-${tabId}`);
      });

      if (tabId === 'debug') {
        updateDebugPanel();
      }
      if (tabId === 'telemetry' && !telemetryManager.isLoaded()) {
        telemetryManager.loadTelemetryHistory();
      }
      if (tabId === 'schemas' && !schemaManager.isLoaded()) {
        schemaManager.refreshSchemaData();
      }
      if (tabId === 'status') {
        renderErrorsList();
      }
    };

    const updateDebugPanel = () => {
      const container = _root?.querySelector('.app-shell');
      if (!container) return;

      const systemPromptEl = container.querySelector('#debug-system-prompt');
      const contextEl = container.querySelector('#debug-context');
      const contextCountEl = container.querySelector('#debug-context-count');
      const modelConfigEl = container.querySelector('#debug-model-config');

      if (systemPromptEl) {
        try {
          if (AgentLoop?.getSystemPrompt) {
            const systemPrompt = AgentLoop.getSystemPrompt();
            systemPromptEl.textContent = systemPrompt || 'System prompt not available';
          } else {
            systemPromptEl.textContent = 'System prompt not accessible (agent not initialized)';
          }
        } catch (e) {
          systemPromptEl.textContent = `Error loading system prompt: ${e.message}`;
        }
      }

      if (contextEl && contextCountEl) {
        try {
          if (AgentLoop?.getContext) {
            const context = AgentLoop.getContext();
            contextCountEl.textContent = context?.length || 0;
            contextEl.textContent = JSON.stringify(context, null, 2) || 'No context available';
          } else {
            contextCountEl.textContent = 0;
            contextEl.textContent = 'Context not accessible (agent not initialized)';
          }
        } catch (e) {
          contextEl.textContent = `Error loading context: ${e.message}`;
        }
      }

      if (modelConfigEl) {
        try {
          const savedModels = localStorage.getItem('SELECTED_MODELS');
          const consensusType = localStorage.getItem('CONSENSUS_TYPE');
          const modelConfig = {
            models: savedModels ? JSON.parse(savedModels) : [],
            consensusStrategy: consensusType || 'arena',
            maxTokens: _maxTokens,
            currentTokens: _tokenCount
          };
          modelConfigEl.textContent = JSON.stringify(modelConfig, null, 2);
        } catch (e) {
          modelConfigEl.textContent = `Error loading model config: ${e.message}`;
        }
      }
    };

    const render = () => {
      const container = document.createElement('div');
      container.className = 'app-shell';

      const goalFromBoot = localStorage.getItem('REPLOID_GOAL') || 'No goal set';
      container.innerHTML = renderProtoTemplate(escapeHtml, goalFromBoot);

      // Bind Events
      const btnToggle = container.querySelector('#btn-toggle');
      const btnExport = container.querySelector('#btn-export');
      let isRunning = true;

      // Tab switching
      const tabButtons = container.querySelectorAll('.sidebar-btn[data-tab]');
      tabButtons.forEach(btn => {
        btn.onclick = () => switchTab(btn.dataset.tab);
      });

      const telemetryFilter = container.querySelector('#telemetry-filter');
      if (telemetryFilter) {
        telemetryFilter.addEventListener('change', (event) => {
          telemetryManager.setFilter(event.target.value);
        });
      }
      const telemetryRefresh = container.querySelector('#telemetry-refresh');
      if (telemetryRefresh) {
        telemetryRefresh.addEventListener('click', () => telemetryManager.loadTelemetryHistory());
      }
      const schemaSearchInput = container.querySelector('#schema-search');
      if (schemaSearchInput) {
        schemaSearchInput.addEventListener('input', (event) => {
          schemaManager.setSearch(event.target.value || '');
        });
      }
      const schemaRefreshBtn = container.querySelector('#schema-refresh');
      if (schemaRefreshBtn) {
        schemaRefreshBtn.addEventListener('click', () => schemaManager.refreshSchemaData());
      }

      btnToggle.innerHTML = '&#x25A0;';
      btnToggle.title = 'Stop (Esc)';

      const updateButtonState = (running) => {
        if (running) {
          btnToggle.innerHTML = '&#x25A0;';
          btnToggle.title = 'Stop (Esc)';
        } else {
          btnToggle.innerHTML = '&#x25B6;';
          btnToggle.title = 'Resume (Ctrl+Enter)';
        }
      };

      const stopAgent = () => {
        if (isRunning) {
          AgentLoop.stop();
          isRunning = false;
          updateButtonState(false);
          Toast.info('Agent Stopped', 'Click play or press Ctrl+Enter to resume');
        }
      };

      const resumeAgent = async () => {
        if (!isRunning) {
          const goal = localStorage.getItem('REPLOID_GOAL');
          if (!goal) {
            Toast.info('No Goal Set', 'Return to boot screen to set a goal');
            return;
          }

          isRunning = true;
          updateButtonState(true);

          try {
            await AgentLoop.run(goal);
            isRunning = false;
            btnToggle.innerHTML = '&#x21BB;';
            btnToggle.title = 'Restart';
            Toast.success('Goal Complete', 'Agent finished successfully');
          } catch (e) {
            logger.error(`Agent Error: ${e.message}`);
            isRunning = false;
            btnToggle.innerHTML = '&#x21BB;';
            btnToggle.title = 'Restart';
            // Log error to ErrorStore via EventBus
            EventBus.emit('agent:error', { message: 'Agent Error', error: e.message });
            Toast.info('Agent Error', 'See Status tab for details', {
              actions: [
                { label: 'Retry', onClick: resumeAgent, primary: true },
                { label: 'View Details', onClick: () => switchTab('status') }
              ]
            });
          }
        }
      };

      btnToggle.onclick = () => {
        if (isRunning) {
          stopAgent();
        } else {
          resumeAgent();
        }
      };

      const exportState = async () => {
        try {
          if (window.downloadREPLOID) {
            await window.downloadREPLOID(`reploid-export-${Date.now()}.json`);
            Toast.success('Export Complete', 'State and VFS exported successfully');
          } else {
            const state = StateManager.getState();
            const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reploid-state-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            Toast.success('Export Complete', 'State exported (VFS not available)');
          }
        } catch (e) {
          EventBus.emit('agent:error', { message: 'Export Failed', error: e.message });
        }
      };

      btnExport.onclick = exportState;

      // VFS Browser
      const vfsPanel = container.querySelector('#vfs-browser');
      const vfsSearch = container.querySelector('#vfs-search');
      vfsSearch.addEventListener('input', () => {
        clearTimeout(_vfsSearchTimeout);
        _vfsSearchTimeout = setTimeout(() => vfsManager.filterVFSTree(vfsSearch.value), 300);
      });

      const editBtn = container.querySelector('#vfs-edit-btn');
      const saveBtn = container.querySelector('#vfs-save-btn');
      const cancelBtn = container.querySelector('#vfs-cancel-btn');
      const previewBtn = container.querySelector('#vfs-preview-btn');

      editBtn.onclick = () => vfsManager.startEditing();
      saveBtn.onclick = () => vfsManager.saveFile();
      cancelBtn.onclick = () => vfsManager.cancelEditing();
      previewBtn.onclick = () => vfsManager.showPreview();

      const workerIndicator = container.querySelector('#worker-indicator');
      if (workerIndicator) {
        workerIndicator.onclick = () => switchTab('workers');
      }

      const clearWorkersBtn = container.querySelector('#workers-clear-completed');
      if (clearWorkersBtn) {
        clearWorkersBtn.onclick = () => workerManager.clearCompletedWorkers();
      }

      container.querySelector('#vfs-preview-close').onclick = () => vfsManager.closePreview();
      container.querySelector('#vfs-diff-close').onclick = () => vfsManager.closeDiff();
      container.querySelector('#vfs-snapshot-close').onclick = () => vfsManager.closeSnapshots();

      _reflectionsContainer = container.querySelector('#reflections-container');

      return container;
    };

    const mount = (target) => {
      _root = target;
      _root.innerHTML = '';
      _root.appendChild(render());
      workerManager.renderWorkersPanel();

      // Load persisted history and errors
      renderSavedHistory();
      updateStatusBadge();

      Toast.init();

      _inlineChat = InlineChat.factory({ Utils, EventBus });
      const chatContainer = document.getElementById('inline-chat-container');
      if (chatContainer && _inlineChat) {
        _inlineChat.init(chatContainer);
        if (!document.getElementById('inline-chat-styles')) {
          const style = document.createElement('style');
          style.id = 'inline-chat-styles';
          style.textContent = INLINE_CHAT_STYLES;
          document.head.appendChild(style);
        }
      }

      // Load initial state
      try {
        const state = StateManager.getState();
        const cycleEl = document.getElementById('agent-cycle');
        const stateEl = document.getElementById('agent-state');
        if (cycleEl) cycleEl.textContent = state.totalCycles || 0;
        if (stateEl) stateEl.textContent = state.fsmState || 'IDLE';
      } catch (e) { /* State not ready */ }

      // Load model info - show all selected models
      try {
        const savedModels = localStorage.getItem('SELECTED_MODELS');
        if (savedModels) {
          const models = JSON.parse(savedModels);
          const modelsEl = document.getElementById('agent-models');
          if (modelsEl && models.length > 0) {
            modelsEl.innerHTML = models.map(m => {
              const name = m.name || m.id;
              const provider = m.provider || 'unknown';
              const providerBadge = provider.toLowerCase();
              return `<div class="model-entry">
                <span class="model-name">${escapeHtml(name)}</span>
                <span class="model-provider model-provider-${providerBadge}">${escapeHtml(provider)}</span>
              </div>`;
            }).join('');
            // Use first model's context size for token display
            _maxTokens = models[0].contextSize || 32000;
          }
        }
      } catch (e) { /* ignore */ }

      cleanup();

      // Event subscriptions
      _subscriptionIds.push(EventBus.on('reflection:added', onReflection));

      _subscriptionIds.push(EventBus.on('agent:status', (status) => {
        const stateEl = document.getElementById('agent-state');
        const stateDetailEl = document.getElementById('agent-state-detail');
        const activityEl = document.getElementById('agent-activity');
        const cycleEl = document.getElementById('agent-cycle');

        if (stateEl && status.state) stateEl.textContent = status.state;
        if (stateDetailEl && status.state) stateDetailEl.textContent = status.state;
        if (activityEl && status.activity) activityEl.textContent = status.activity;
        if (cycleEl && status.cycle) cycleEl.textContent = status.cycle;
      }));

      _subscriptionIds.push(EventBus.on('agent:tokens', (data) => {
        updateTokenBudget(data.tokens);
        const tokensEl = document.getElementById('agent-tokens');
        if (tokensEl) tokensEl.textContent = `${data.tokens} / ${_maxTokens}`;
      }));

      _subscriptionIds.push(EventBus.on('worker:spawned', workerManager.handleWorkerSpawned));
      _subscriptionIds.push(EventBus.on('worker:progress', workerManager.handleWorkerProgress));
      _subscriptionIds.push(EventBus.on('worker:completed', workerManager.handleWorkerCompleted));
      _subscriptionIds.push(EventBus.on('worker:error', workerManager.handleWorkerError));
      _subscriptionIds.push(EventBus.on('worker:terminated', workerManager.handleWorkerTerminated));
      _subscriptionIds.push(EventBus.on('telemetry:event', telemetryManager.appendTelemetryEntry));

      _subscriptionIds.push(EventBus.on('context:compacted', () => {
        Toast.info('Context Compacted', 'Conversation summarized to save tokens', { duration: 3000 });
      }));

      // Error events are handled by ErrorStore - just update the status badge
      _subscriptionIds.push(EventBus.on('error:added', () => {
        updateStatusBadge();
      }));

      _subscriptionIds.push(EventBus.on('error:cleared', () => {
        updateStatusBadge();
        renderErrorsList();
      }));

      _subscriptionIds.push(EventBus.on('progress:update', (data) => {
        const container = document.getElementById('progress-container');
        const fill = document.getElementById('progress-fill');
        const text = document.getElementById('progress-text');
        const bar = document.getElementById('progress-bar');

        if (!container || !fill || !text) return;

        if (data.visible === false) {
          container.classList.add('hidden');
          return;
        }

        container.classList.remove('hidden');

        if (data.indeterminate) {
          bar.classList.add('progress-bar-indeterminate');
          fill.style.width = '30%';
        } else {
          bar.classList.remove('progress-bar-indeterminate');
          fill.style.width = `${data.progress || 0}%`;
        }

        text.textContent = data.message || '';
      }));

      // Streaming events
      let streamingEntry = null;
      let streamStartTime = null;
      let tokenCount = 0;

      _subscriptionIds.push(EventBus.on('agent:stream', (text) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        if (!streamingEntry) {
          streamingEntry = document.createElement('div');
          streamingEntry.className = 'history-entry streaming';
          streamingEntry.innerHTML = `
            <div class="history-header"><span class="status-label">Thinking...</span> <span class="token-stats">0 tokens</span></div>
            <pre class="history-content"></pre>
          `;
          historyContainer.appendChild(streamingEntry);
          streamStartTime = Date.now();
          tokenCount = 0;
        }

        const statusLabel = streamingEntry.querySelector('.status-label');
        if (statusLabel) {
          if (text.includes('[System: Downloading')) {
            statusLabel.textContent = 'Downloading...';
            EventBus.emit('progress:update', { indeterminate: true, message: 'Downloading model...' });
          } else if (text.includes('[System: Loading model')) {
            statusLabel.textContent = 'Loading...';
            EventBus.emit('progress:update', { indeterminate: true, message: 'Loading model into GPU...' });
          } else if (!text.startsWith('[System:')) {
            statusLabel.textContent = 'Thinking...';
            EventBus.emit('progress:update', { visible: false });
          }
        }

        if (!text.startsWith('[System:')) {
          tokenCount += Math.ceil(text.length / 4);
          updateTokenBudget(_tokenCount + tokenCount);
        }

        const elapsed = (Date.now() - streamStartTime) / 1000;
        const tokensPerSec = elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : 0;

        const statsEl = streamingEntry.querySelector('.token-stats');
        if (statsEl) {
          statsEl.textContent = `${tokenCount} tokens • ${tokensPerSec} t/s`;
        }

        const content = streamingEntry.querySelector('.history-content');
        content.textContent += text;
        scheduleHistoryScroll();
      }));

      _subscriptionIds.push(EventBus.on('agent:history', (entry) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        if (streamingEntry && entry.type === 'llm_response') {
          streamingEntry.remove();
          streamingEntry = null;
          streamStartTime = null;
          _tokenCount += tokenCount;
          tokenCount = 0;
          EventBus.emit('progress:update', { visible: false });
        }

        while (historyContainer.children.length >= MAX_HISTORY_ENTRIES) {
          historyContainer.removeChild(historyContainer.firstChild);
        }

        const div = document.createElement('div');
        div.className = 'history-entry';

        if (entry.type === 'llm_response') {
          const content = entry.content || '(No response content)';
          div.innerHTML = `
            <div class="history-header">◀ Received #${entry.cycle}</div>
            <pre class="history-content">${escapeHtml(content)}</pre>
          `;
        } else if (entry.type === 'tool_result') {
          const result = entry.result || '(No result)';
          const isError = result.startsWith('Error:');
          div.innerHTML = `
            <div class="history-header ${isError ? 'history-error' : ''}">
              ▶ Sent #${entry.cycle} → ${entry.tool}
              ${isError ? '<span class="error-badge">ERROR</span>' : ''}
            </div>
            <pre class="history-content">${escapeHtml(result)}</pre>
            ${isError ? `
              <div class="history-actions">
                <button class="toast-btn" onclick="navigator.clipboard.writeText('${escapeHtml(result).replace(/'/g, "\\'")}')">Copy Error</button>
              </div>
            ` : ''}
          `;

          // Errors are captured by tool:error event -> ErrorStore
        } else if (entry.type === 'human') {
          const isGoal = entry.messageType === 'goal';
          div.className = `history-entry human-message ${isGoal ? 'goal-refinement' : ''}`;
          div.innerHTML = `
            <div class="history-header">
              <span class="entry-label">${isGoal ? '⚑ You (Goal)' : '✉ You'}</span>
              <span class="entry-cycle">#${entry.cycle || '-'}</span>
            </div>
            <pre class="history-content">${escapeHtml(entry.content)}</pre>
          `;
        }

        historyContainer.appendChild(div);
        scheduleHistoryScroll();

        // Persist to VFS
        saveHistoryEntry(entry);
      }));

      _subscriptionIds.push(EventBus.on('agent:arena-result', (result) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        const div = document.createElement('div');
        div.className = 'history-entry arena-result';

        const winner = result.winner || {};
        const solutions = result.solutions || [];
        const mode = result.mode || 'arena';

        let solutionsHTML = '';
        if (solutions.length > 0) {
          solutionsHTML = solutions.map(sol => {
            const isWinner = sol.model === winner.model;
            const badge = isWinner ? '<span class="winner-badge">WINNER</span>' : '';
            return `
              <div class="arena-solution ${isWinner ? 'arena-winner' : ''}">
                <div class="arena-solution-header">
                  ${escapeHtml(sol.model)} - Score: ${(sol.score || 0).toFixed(2)} ${badge}
                </div>
              </div>
            `;
          }).join('');
        }

        div.innerHTML = `
          <div class="history-header arena-header">
            🏆 Arena #${result.cycle} (${mode})
          </div>
          <div class="arena-solutions">
            ${solutionsHTML}
          </div>
        `;

        historyContainer.appendChild(div);
        scheduleHistoryScroll();
      }));

      // VFS events
      _subscriptionIds.push(EventBus.on('vfs:write', (data) => {
        const path = data?.path || data;
        if (path) vfsManager.markFileModified(path, 'modified');
      }));

      _subscriptionIds.push(EventBus.on('artifact:created', (data) => {
        const path = data?.path || data;
        if (path) vfsManager.markFileModified(path, 'created');
      }));

      _subscriptionIds.push(EventBus.on('artifact:updated', (data) => {
        const path = data?.path || data;
        if (path) vfsManager.markFileModified(path, 'modified');
      }));

      _subscriptionIds.push(EventBus.on('artifact:deleted', (data) => {
        const path = data?.path || data;
        if (path) {
          vfsManager.markFileModified(path, 'deleted');
        } else {
          vfsManager.loadVFSTree();
        }
      }));

      _subscriptionIds.push(EventBus.on('tool:file_written', (data) => {
        const path = data?.path || data;
        if (path) vfsManager.markFileModified(path, 'modified');
      }));

      // Kick off initial data fetches
      telemetryManager.loadTelemetryHistory();
      schemaManager.refreshSchemaData();
    };

    const cleanup = () => {
      _subscriptionIds.forEach(unsub => {
        if (typeof unsub === 'function') {
          try { unsub(); } catch (e) { /* ignore */ }
        }
      });
      _subscriptionIds = [];

      if (_inlineChat && _inlineChat.cleanup) {
        _inlineChat.cleanup();
        _inlineChat = null;
      }

      clearTimeout(_vfsSearchTimeout);
      _historyScrollScheduled = false;
      _reflectionScrollScheduled = false;
    };

    const setVFS = (vfs) => {
      vfsManager.setVFS(vfs);
    };

    return {
      mount,
      setVFS,
      refreshVFS: vfsManager.loadVFSTree,
      cleanup
    };
  }
};

export default Proto;
