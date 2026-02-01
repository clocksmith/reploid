/**
 * @fileoverview Proto UI - Modular version
 * Main user interface for the agent.
 * Re-exports a Proto object compatible with the original API.
 */

import Toast from '../toast.js';
import InlineChat from '../components/inline-chat.js';
import ArenaResults from '../components/arena-results.js';

import { createTelemetryManager } from './telemetry.js';
import { createSchemaManager } from './schemas.js';
import { createWorkerManager } from './workers.js';
import { createVFSManager } from './vfs.js';
import { createReplayManager } from './replay.js';

const Proto = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, WorkerManager, ErrorStore, VFS, ArenaHarness } = deps;
    const { logger, escapeHtml } = Utils;

    // Initialize managers
    const telemetryManager = createTelemetryManager({ logger, escapeHtml });
    const schemaManager = createSchemaManager({ logger, escapeHtml });
    const workerManager = createWorkerManager({ escapeHtml, WorkerManager });
    const vfsManager = createVFSManager({ escapeHtml, logger, Toast, EventBus });
    const replayManager = createReplayManager({ logger, escapeHtml, EventBus });
    const arenaResults = ArenaResults.factory({ Utils, EventBus, ArenaHarness });

    // UI state
    let _root = null;
    let _toolActivityContainer = null;
    let _inlineChat = null;
    let _vfsSearchTimeout = null;
    const TAB_IDS = ['activity', 'vfs', 'status', 'telemetry', 'schemas', 'workers', 'analysis'];
    const ACTIVE_TABS_KEY = 'REPLOID_ACTIVE_TABS';
    const MAX_ACTIVE_TABS = 3;
    let _activeTabs = [];

    // Token tracking - values come from ContextManager via EventBus
    let _tokenCount = 0;
    let _maxTokens = 32000;  // Updated by agent:tokens events

    // Event subscriptions
    let _subscriptionIds = [];

    // Scroll throttling and sticky scroll behavior
    let _historyScrollScheduled = false;
    let _toolActivityScrollScheduled = false;
    let _historyFollowMode = true; // Auto-scroll to newest entry on new content

    const scheduleHistoryScroll = () => {
      if (_historyScrollScheduled) return;
      if (!_historyFollowMode) return; // Don't auto-scroll if user scrolled away
      _historyScrollScheduled = true;
      requestAnimationFrame(() => {
        const container = document.getElementById('history-container');
        if (container) container.scrollTop = 0;
        _historyScrollScheduled = false;
      });
    };

    const scheduleToolActivityScroll = () => {
      if (_toolActivityScrollScheduled) return;
      _toolActivityScrollScheduled = true;
      requestAnimationFrame(() => {
        if (_toolActivityContainer) _toolActivityContainer.scrollTop = _toolActivityContainer.scrollHeight;
        _toolActivityScrollScheduled = false;
      });
    };

    const MAX_TOOL_ACTIVITY = 100;
    const MAX_HISTORY_ENTRIES = 200;
    const MAX_INTENT_REFINEMENTS = 20;

    let _templateRenderer = null;
    let _templateVersion = null;
    let _templateLoading = null;

    const getTemplateVersion = () => {
      if (typeof window !== 'undefined' && window.REPLOID_UI_VERSION) {
        return String(window.REPLOID_UI_VERSION);
      }
      return 'static';
    };

    const loadTemplateRenderer = async () => {
      const version = getTemplateVersion();
      if (_templateRenderer && _templateVersion === version) {
        return _templateRenderer;
      }
      if (_templateLoading && _templateVersion === version) {
        return _templateLoading;
      }
      const cacheBust = version === 'static' ? '' : `?v=${encodeURIComponent(version)}`;
      const spec = `./template.js${cacheBust}`;
      const loader = import(spec)
        .then((mod) => mod.renderProtoTemplate || mod.default)
        .then((renderer) => {
          _templateRenderer = renderer;
          _templateVersion = version;
          _templateLoading = null;
          return renderer;
        })
        .catch((err) => {
          _templateLoading = null;
          throw err;
        });
      _templateLoading = loader;
      _templateVersion = version;
      return loader;
    };

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
          errorsList.innerHTML = '<div class="muted p-sm">No errors or warnings</div>';
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
          const icon = error.severity === 'warning' ? '△' : '☒';
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

    // History persistence via VFS (with archival)
    const HISTORY_PATH = '/.memory/history.json';
    const HISTORY_ARCHIVE_PREFIX = '/.memory/history-archive-';
    const MAX_HISTORY_PERSISTED = 1024;
    const ARCHIVE_BATCH = 128;
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

      // Archive oldest entries in batches when over limit
      if (_historyCache.length > MAX_HISTORY_PERSISTED + ARCHIVE_BATCH) {
        const archiveCount = _historyCache.length - MAX_HISTORY_PERSISTED;
        const archiveSlice = _historyCache.slice(0, archiveCount);
        _historyCache = _historyCache.slice(-MAX_HISTORY_PERSISTED);

        try {
          const archivePath = `${HISTORY_ARCHIVE_PREFIX}${Date.now()}.json`;
          await VFS.write(archivePath, JSON.stringify(archiveSlice, null, 2));
        } catch (e) {
          logger.warn('[Proto] Failed to archive history:', e.message);
        }
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
      const entriesToRender = _historyCache.slice(-MAX_HISTORY_ENTRIES).slice().reverse();

      for (const entry of entriesToRender) {
        const div = document.createElement('div');
        renderHistoryEntry(div, entry);
        historyContainer.appendChild(div);
      }

      scheduleHistoryScroll();
      renderIntentSection();
    };

    const renderHistoryEntry = (div, entry) => {
      if (entry.type === 'llm_response') {
        div.className = 'history-entry llm';
        div.innerHTML = `
          <div class="history-header">
            <span class="entry-label">★ Agent</span>
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
            SEND #${entry.cycle} -> ${entry.tool}
            ${isError ? '<span class="error-badge">ERROR</span>' : ''}
          </div>
          <pre class="history-content">${escapeHtml(result)}</pre>
        `;
      } else if (entry.type === 'human') {
        const isGoal = entry.messageType === 'goal';
        div.className = `history-entry human-message ${isGoal ? 'goal-refinement' : ''}`;
        div.innerHTML = `
          <div class="history-header">
            <span class="entry-label">${isGoal ? 'You (Goal)' : 'You'}</span>
            <span class="entry-cycle">#${entry.cycle || '-'}</span>
          </div>
          <pre class="history-content">${escapeHtml(entry.content)}</pre>
        `;
      }
    };

    const getGoalRefinements = () =>
      _historyCache.filter((entry) => entry.type === 'human' && entry.messageType === 'goal');

    const renderIntentSection = async () => {
      const goalEl = document.getElementById('intent-goal');
      const listEl = document.getElementById('intent-refinement-list');
      const countEl = document.getElementById('intent-refinement-count');
      if (!goalEl || !listEl) return;

      await loadHistory();

      const refinements = getGoalRefinements();
      const recent = refinements.slice(-MAX_INTENT_REFINEMENTS);
      const baseGoal = localStorage.getItem('REPLOID_GOAL') || 'No goal set';
      const latestGoal = recent.length ? recent[recent.length - 1].content : baseGoal;

      goalEl.textContent = latestGoal || 'No goal set';
      if (countEl) {
        const count = refinements.length;
        countEl.textContent = `${count} refinement${count === 1 ? '' : 's'}`;
      }

      if (recent.length === 0) {
        listEl.innerHTML = '<div class="muted" style="padding: 6px 0;">No goal refinements yet</div>';
        return;
      }

      listEl.innerHTML = recent.map((entry) => {
        const cycle = entry.cycle ?? '-';
        const timestamp = entry.ts ? new Date(entry.ts).toLocaleTimeString() : '';
      const meta = timestamp ? `#${cycle} - ${timestamp}` : `#${cycle}`;
        return `
          <div class="intent-refinement-item">
            <div class="intent-refinement-meta">
              <span>${escapeHtml(meta)}</span>
              <span class="muted">Goal refinement</span>
            </div>
            <div class="intent-refinement-text">${escapeHtml(entry.content || '')}</div>
          </div>
        `;
      }).join('');
    };

    const onToolActivity = (entry) => {
      if (!_toolActivityContainer) return;

      while (_toolActivityContainer.children.length >= MAX_TOOL_ACTIVITY) {
        _toolActivityContainer.removeChild(_toolActivityContainer.firstChild);
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

      const icon = isError ? '☒' : '✓';
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
      _toolActivityContainer.appendChild(div);
      scheduleToolActivityScroll();
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

    const normalizeActiveTabs = (tabs) => {
      const ordered = [];
      for (const tab of tabs || []) {
        if (!TAB_IDS.includes(tab)) continue;
        if (ordered.includes(tab)) continue;
        ordered.push(tab);
      }
      if (ordered.length === 0) {
        ordered.push('activity');
      }
      if (ordered.length > MAX_ACTIVE_TABS) {
        return ordered.slice(-MAX_ACTIVE_TABS);
      }
      return ordered;
    };

    const loadActiveTabs = () => {
      try {
        const raw = localStorage.getItem(ACTIVE_TABS_KEY);
        if (!raw) return normalizeActiveTabs([]);
        const parsed = JSON.parse(raw);
        return normalizeActiveTabs(Array.isArray(parsed) ? parsed : []);
      } catch {
        return normalizeActiveTabs([]);
      }
    };

    const persistActiveTabs = () => {
      localStorage.setItem(ACTIVE_TABS_KEY, JSON.stringify(_activeTabs));
    };

    const handleTabActivation = (tabId) => {
      if (tabId === 'status') {
        updateDebugPanel();
        renderErrorsList();
      }
      if (tabId === 'schemas' && !schemaManager.isLoaded()) {
        schemaManager.refreshSchemaData();
      }
      if (tabId === 'telemetry' && !telemetryManager.isLoaded()) {
        telemetryManager.loadTelemetryHistory();
      }
    };

    const applyActiveTabs = (rootOverride) => {
      const container = rootOverride || _root?.querySelector('.app-shell');
      if (!container) return;

      const activeSet = new Set(_activeTabs);
      const tabButtons = container.querySelectorAll('.sidebar-btn[data-tab]');
      tabButtons.forEach((btn) => {
        btn.classList.toggle('active', activeSet.has(btn.dataset.tab));
      });

      const workspaceColumns = container.querySelector('#workspace-columns');
      if (workspaceColumns) {
        workspaceColumns.style.setProperty('--columns', `${_activeTabs.length || 1}`);
        workspaceColumns.classList.remove('hidden');
        const panels = Array.from(workspaceColumns.querySelectorAll('.workspace-content'))
          .filter((panel) => panel.id && panel.id.startsWith('tab-'));
        const panelById = new Map(panels.map((panel) => [panel.id.replace('tab-', ''), panel]));

        _activeTabs.forEach((tabId) => {
          const panel = panelById.get(tabId);
          if (panel) workspaceColumns.appendChild(panel);
        });

        panels.forEach((panel) => {
          const tabId = panel.id.replace('tab-', '');
          panel.classList.toggle('hidden', !activeSet.has(tabId));
          if (!activeSet.has(tabId)) {
            workspaceColumns.appendChild(panel);
          }
        });
      }

      const vfsContent = container.querySelector('#vfs-content');
      if (vfsContent) {
        vfsContent.classList.add('hidden');
      }
    };

    const toggleTab = (tabId) => {
      if (!TAB_IDS.includes(tabId)) return;
      const idx = _activeTabs.indexOf(tabId);
      if (idx >= 0) {
        if (_activeTabs.length === 1) return;
        _activeTabs.splice(idx, 1);
      } else {
        if (_activeTabs.length >= MAX_ACTIVE_TABS) {
          _activeTabs.shift();
        }
        _activeTabs.push(tabId);
        handleTabActivation(tabId);
      }
      persistActiveTabs();
      applyActiveTabs();
    };

    const focusTab = (tabId) => {
      if (!TAB_IDS.includes(tabId)) return;
      const idx = _activeTabs.indexOf(tabId);
      if (idx >= 0) {
        _activeTabs.splice(idx, 1);
      } else if (_activeTabs.length >= MAX_ACTIVE_TABS) {
        _activeTabs.shift();
      }
      _activeTabs.push(tabId);
      handleTabActivation(tabId);
      persistActiveTabs();
      applyActiveTabs();
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

    const render = async () => {
      const container = document.createElement('div');
      container.className = 'app-shell';

      const goalFromBoot = localStorage.getItem('REPLOID_GOAL') || 'No goal set';
      let templateRenderer = null;

      try {
        templateRenderer = await loadTemplateRenderer();
      } catch (e) {
        logger.warn('[Proto] Failed to load template from VFS, falling back:', e?.message || e);
        const fallback = await import('./template.js');
        templateRenderer = fallback.renderProtoTemplate || fallback.default;
        _templateRenderer = templateRenderer;
        _templateVersion = 'static';
      }

      container.innerHTML = templateRenderer(escapeHtml, goalFromBoot);
      _activeTabs = loadActiveTabs();
      _activeTabs.forEach((tabId) => handleTabActivation(tabId));
      applyActiveTabs(container);

      // Bind Events
      const btnToggle = container.querySelector('#btn-toggle');
      const btnExport = container.querySelector('#btn-export');
      let isRunning = true;

      // Tab switching
      const tabButtons = container.querySelectorAll('.sidebar-btn[data-tab]');
      tabButtons.forEach(btn => {
        btn.onclick = () => toggleTab(btn.dataset.tab);
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

      const replayBtn = container.querySelector('#btn-replay');
      const replayModal = container.querySelector('#replay-modal');
      const replayClose = container.querySelector('#replay-modal-close');

      const closeReplayModal = () => {
        if (!replayModal) return;
        replayModal.classList.add('hidden');
        document.removeEventListener('keydown', handleReplayKey);
      };

      const openReplayModal = () => {
        if (!replayModal) return;
        replayModal.classList.remove('hidden');
        document.addEventListener('keydown', handleReplayKey);
      };

      const handleReplayKey = (event) => {
        if (event.key === 'Escape') {
          closeReplayModal();
        }
      };

      if (replayBtn) {
        replayBtn.addEventListener('click', (event) => {
          event.preventDefault();
          openReplayModal();
        });
      }

      if (replayClose) {
        replayClose.addEventListener('click', (event) => {
          event.preventDefault();
          closeReplayModal();
        });
      }

      if (replayModal) {
        replayModal.addEventListener('click', (event) => {
          if (event.target === replayModal) {
            closeReplayModal();
          }
        });
      }

      btnToggle.innerHTML = 'Stop';
      btnToggle.title = 'Stop (Esc)';

      const updateButtonState = (running) => {
        if (running) {
          btnToggle.innerHTML = 'Stop';
          btnToggle.title = 'Stop (Esc)';
        } else {
          btnToggle.innerHTML = 'Run';
          btnToggle.title = 'Resume (Ctrl+Enter)';
        }
      };

      const stopAgent = () => {
        if (isRunning) {
          AgentLoop.stop();
          isRunning = false;
          updateButtonState(false);
          Toast.info('Agent Stopped', 'Click Run or press Ctrl+Enter to resume');
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
            btnToggle.innerHTML = 'Restart';
            btnToggle.title = 'Restart';
            Toast.success('Goal Complete', 'Agent finished successfully');
          } catch (e) {
            logger.error(`Agent Error: ${e.message}`);
            isRunning = false;
            btnToggle.innerHTML = 'Restart';
            btnToggle.title = 'Restart';
            // Log error to ErrorStore via EventBus
            EventBus.emit('agent:error', { message: 'Agent Error', error: e.message });
            Toast.info('Agent Error', 'See Status tab for details', {
              actions: [
                { label: 'Retry', onClick: resumeAgent, primary: true },
                { label: 'View Details', onClick: () => focusTab('status') }
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
          if (window.downloadReploid) {
            await window.downloadReploid(`reploid-export-${Date.now()}.json`);
            Toast.success('Export Complete', 'State and VFS exported successfully');
          } else {
            // Try to resolve VFS from DI container if available
            let exportData = { state: StateManager.getState(), vfs: {} };
            try {
              if (window.REPLOID_DI?.resolve) {
                const vfs = await window.REPLOID_DI.resolve('VFS');
                if (vfs?.exportAll) {
                  const vfsExport = await vfs.exportAll();
                  exportData.vfs = vfsExport.files || {};
                }
              }
            } catch (vfsErr) {
              logger.warn('[Proto] VFS export failed:', vfsErr.message);
            }
            exportData.exportedAt = new Date().toISOString();
            exportData.version = '1.1';

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reploid-export-${Date.now()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Toast.success('Export Complete', `Exported ${Object.keys(exportData.vfs).length} VFS files`);
          }
        } catch (e) {
          logger.error('[Proto] Export failed:', e);
          Toast.error('Export Failed', e.message);
          EventBus.emit('agent:error', { message: 'Export Failed', error: e.message });
        }
      };

      btnExport.onclick = exportState;

      // VFS Browser
      const vfsSearch = container.querySelector('#vfs-search');
      if (vfsSearch) {
        vfsSearch.addEventListener('input', () => {
          clearTimeout(_vfsSearchTimeout);
          _vfsSearchTimeout = setTimeout(() => vfsManager.filterVFSTree(vfsSearch.value), 300);
        });
      }

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
        workerIndicator.onclick = () => focusTab('workers');
      }

      const clearWorkersBtn = container.querySelector('#workers-clear-completed');
      if (clearWorkersBtn) {
        clearWorkersBtn.onclick = () => workerManager.clearCompletedWorkers();
      }

      container.querySelector('#vfs-preview-close').onclick = () => vfsManager.closePreview();
      container.querySelector('#vfs-diff-close').onclick = () => vfsManager.closeDiff();
      container.querySelector('#vfs-snapshot-close').onclick = () => vfsManager.closeSnapshots();

      // VFS Toolbar buttons (refresh removed - VFS auto-refreshes via EventBus)
      const vfsDiffBtn = container.querySelector('#vfs-diff-btn');
      const vfsSnapshotBtn = container.querySelector('#vfs-snapshot-btn');

      if (vfsDiffBtn) {
        vfsDiffBtn.onclick = async () => {
          const currentPath = vfsManager.getCurrentPath();
          if (!currentPath) {
            Toast.error('No File Selected', 'Select a file to view diff');
            return;
          }

          try {
            // Get VFS content
            const vfs = await window.REPLOID_DI?.resolve('VFS');
            if (!vfs) {
              Toast.error('Diff', 'VFS not available');
              return;
            }

            const vfsContent = await vfs.read(currentPath);

            // Try to fetch original from network
            const networkPath = currentPath.startsWith('/') ? currentPath.slice(1) : currentPath;
            let originalContent = null;
            try {
              const response = await fetch(`/${networkPath}`);
              if (response.ok) {
                originalContent = await response.text();
              }
            } catch (e) {
              // Original file not available for comparison
            }

            // Show diff panel
            const diffPanel = container.querySelector('#vfs-diff-panel');
            const diffContent = container.querySelector('#vfs-diff-content');
            const contentBody = container.querySelector('#vfs-content-body');

            if (!diffPanel || !diffContent) {
              Toast.error('Diff', 'Diff panel not found');
              return;
            }

            if (!originalContent) {
              diffContent.innerHTML = `<div class="vfs-empty">
                <p>No original source to compare against.</p>
                <p>File: ${currentPath}</p>
                <p>This file exists only in VFS (created by the agent).</p>
              </div>`;
            } else if (originalContent === vfsContent) {
              diffContent.innerHTML = `<div class="vfs-empty">
                <p>No changes. VFS content matches source.</p>
                <p>File: ${currentPath}</p>
              </div>`;
            } else {
              // Simple diff display
              const vfsLines = (vfsContent || '').split('\n');
              const origLines = (originalContent || '').split('\n');
              let diffHtml = `<div class="diff-header">Diff: ${currentPath}</div>`;
              diffHtml += `<div class="diff-stats">VFS: ${vfsLines.length} lines, Source: ${origLines.length} lines</div>`;
              diffHtml += '<pre class="diff-content">';

              // Very simple line-by-line diff
              const maxLen = Math.max(vfsLines.length, origLines.length);
              for (let i = 0; i < Math.min(maxLen, 100); i++) {
                const vLine = vfsLines[i] || '';
                const oLine = origLines[i] || '';
                if (vLine === oLine) {
                  diffHtml += `<span class="diff-same">${Utils.escapeHtml(vLine)}</span>\n`;
                } else if (!origLines[i]) {
                  diffHtml += `<span class="diff-add">+ ${Utils.escapeHtml(vLine)}</span>\n`;
                } else if (!vfsLines[i]) {
                  diffHtml += `<span class="diff-del">- ${Utils.escapeHtml(oLine)}</span>\n`;
                } else {
                  diffHtml += `<span class="diff-del">- ${Utils.escapeHtml(oLine)}</span>\n`;
                  diffHtml += `<span class="diff-add">+ ${Utils.escapeHtml(vLine)}</span>\n`;
                }
              }
              if (maxLen > 100) {
                diffHtml += `\n... and ${maxLen - 100} more lines`;
              }
              diffHtml += '</pre>';
              diffContent.innerHTML = diffHtml;
            }

            if (contentBody) contentBody.classList.add('hidden');
            diffPanel.classList.remove('hidden');

          } catch (e) {
            logger.error('[Diff] Error:', e);
            Toast.error('Diff Failed', e.message);
          }
        };
      }

      if (vfsSnapshotBtn) {
        vfsSnapshotBtn.onclick = async () => {
          try {
            const snapshotPanel = container.querySelector('#vfs-snapshot-panel');
            const timeline = container.querySelector('#vfs-snapshot-timeline');
            const contentBody = container.querySelector('#vfs-content-body');

            if (!snapshotPanel || !timeline) {
              Toast.error('Snapshot Panel', 'UI elements not found');
              return;
            }

            // Try to get GenesisSnapshot from DI
            let snapshots = [];
            try {
              if (window.REPLOID_DI?.resolve) {
                const GenesisSnapshot = await window.REPLOID_DI.resolve('GenesisSnapshot');
                if (GenesisSnapshot?.listSnapshots) {
                  snapshots = await GenesisSnapshot.listSnapshots();
                }
              }
            } catch (e) {
              // GenesisSnapshot not available
            }

            // Render snapshot list
            if (snapshots.length === 0) {
              timeline.innerHTML = '<div class="vfs-empty">No snapshots yet. Snapshots are created during genesis or via the API.</div>';
            } else {
              timeline.innerHTML = snapshots.map(s => `
                <div class="snapshot-item" data-id="${s.id}">
                  <span class="snapshot-name">${s.name}</span>
                  <span class="snapshot-date">${new Date(s.timestamp).toLocaleString()}</span>
                  <span class="snapshot-files">${s.fileCount || '?'} files</span>
                </div>
              `).join('');
            }

            // Show panel
            if (contentBody) contentBody.classList.add('hidden');
            snapshotPanel.classList.remove('hidden');

          } catch (e) {
            logger.error('[Proto] Snapshot error:', e);
            Toast.error('Snapshots', e.message);
          }
        };
      }

      _toolActivityContainer = container.querySelector('#tool-activity-container');

      return container;
    };

    const mount = async (target) => {
      _root = target;
      _root.innerHTML = '';
      const container = await render();
      _root.appendChild(container);
      applyActiveTabs();
      workerManager.renderWorkersPanel();

      // Load persisted history and errors
      renderSavedHistory();
      updateStatusBadge();
      renderIntentSection();
      if (!telemetryManager.isLoaded()) {
        telemetryManager.loadTelemetryHistory();
      }

      // Wire up replay panel
      replayManager.wireEvents();

      Toast.init();

      _inlineChat = InlineChat.factory({ Utils, EventBus });
      const chatContainer = document.getElementById('inline-chat-container');
      if (chatContainer && _inlineChat) {
        _inlineChat.init(chatContainer);
      }

      if (arenaResults?.init) {
        arenaResults.init('arena-panel');
      }

      // Sticky scroll: track when user scrolls away/back to top
      const historyContainer = document.getElementById('history-container');
      if (historyContainer) {
        historyContainer.addEventListener('scroll', () => {
          const distanceFromTop = historyContainer.scrollTop;
          // If user scrolls more than 100px from top, disable follow mode
          // If user scrolls back to within 50px of top, re-enable follow mode
          if (distanceFromTop > 100) {
            _historyFollowMode = false;
          } else if (distanceFromTop < 50) {
            _historyFollowMode = true;
          }
        });
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
            // Initial estimate from model config - will be updated by ContextManager via agent:tokens
            _maxTokens = models[0].contextSize || 32000;
          }
        }
      } catch (e) { /* ignore */ }

      cleanup();

      // Event subscriptions
      _subscriptionIds.push(EventBus.on('reflection:added', onToolActivity));

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
        // Update max from ContextManager's model-aware limits
        if (data.limit) _maxTokens = data.limit;
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
          historyContainer.insertBefore(streamingEntry, historyContainer.firstChild);
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
          // Rough streaming estimate for real-time display (tokens/sec)
          // Not used for budget - ContextManager emits accurate count via agent:tokens
          tokenCount += Math.ceil(text.length / 4);
        }

        const elapsed = (Date.now() - streamStartTime) / 1000;
        const tokensPerSec = elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : 0;

        const statsEl = streamingEntry.querySelector('.token-stats');
        if (statsEl) {
          statsEl.textContent = `${tokenCount} tokens - ${tokensPerSec} t/s`;
        }

        const content = streamingEntry.querySelector('.history-content');
        content.textContent += text;
        scheduleHistoryScroll();
      }));

      _subscriptionIds.push(EventBus.on('agent:history', async (entry) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        if (streamingEntry && entry.type === 'llm_response') {
          streamingEntry.remove();
          streamingEntry = null;
          streamStartTime = null;
          // Don't manually update _tokenCount - ContextManager will emit agent:tokens with accurate count
          tokenCount = 0;
          EventBus.emit('progress:update', { visible: false });
        }

        while (historyContainer.children.length >= MAX_HISTORY_ENTRIES) {
          historyContainer.removeChild(historyContainer.lastChild);
        }

        const div = document.createElement('div');
        div.className = 'history-entry';

        if (entry.type === 'llm_response') {
          const content = entry.content || '(No response content)';
          div.innerHTML = `
            <div class="history-header">RECV #${entry.cycle}</div>
            <pre class="history-content">${escapeHtml(content)}</pre>
          `;
        } else if (entry.type === 'tool_result') {
          const result = entry.result || '(No result)';
          const isError = result.startsWith('Error:');
          div.innerHTML = `
            <div class="history-header ${isError ? 'history-error' : ''}">
              SEND #${entry.cycle} -> ${entry.tool}
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
              <span class="entry-label">${isGoal ? 'You (Goal)' : 'You'}</span>
              <span class="entry-cycle">#${entry.cycle || '-'}</span>
            </div>
            <pre class="history-content">${escapeHtml(entry.content)}</pre>
          `;
        }

        historyContainer.insertBefore(div, historyContainer.firstChild);
        scheduleHistoryScroll();

        // Persist to VFS
        await saveHistoryEntry(entry);
        if (entry.type === 'human' && entry.messageType === 'goal') {
          renderIntentSection();
        }
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
            ★ Arena #${result.cycle} (${mode})
          </div>
          <div class="arena-solutions">
            ${solutionsHTML}
          </div>
        `;

        historyContainer.insertBefore(div, historyContainer.firstChild);
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
      if (!telemetryManager.isLoaded()) {
        telemetryManager.loadTelemetryHistory();
      }
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

      if (arenaResults?.cleanup) {
        arenaResults.cleanup();
      }

      clearTimeout(_vfsSearchTimeout);
      _historyScrollScheduled = false;
      _toolActivityScrollScheduled = false;
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
