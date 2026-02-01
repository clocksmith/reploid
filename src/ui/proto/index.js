/**
 * @fileoverview Proto UI - Modular version
 * Main user interface for the agent.
 * Re-exports a Proto object compatible with the original API.
 */

import Toast from '../toast.js';
import InlineChat from '../components/inline-chat.js';

import { createTelemetryManager } from './telemetry.js';
import { createReplayManager } from './replay.js';
import { formatDuration, formatSince, formatTimestamp, summarizeText } from './utils.js';
import CognitionPanel from '../panels/cognition-panel.js';

const Proto = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, ErrorStore, VFS } = deps;
    const { logger, escapeHtml } = Utils;

    // Initialize managers
    const telemetryManager = createTelemetryManager({ logger, escapeHtml });
    const replayManager = createReplayManager({ logger, escapeHtml, EventBus });
    const memoryPanel = createMemoryPanel({ logger, escapeHtml, VFS });
    const cognitionPanel = createCognitionPanel({ Utils, EventBus });

    // UI state
    let _root = null;
    let _toolsList = null;
    let _toolsCountEl = null;
    let _inlineChat = null;
    const _toolEntries = [];
    const TAB_IDS = ['timeline', 'tools', 'telemetry', 'status', 'memory', 'cognition'];
    const MAX_ACTIVE_TABS = 3;
    let _activeTabs = [];

    // Token tracking - values come from ContextManager via EventBus
    let _tokenCount = 0;
    let _maxTokens = 32000;  // Updated by agent:tokens events

    // Event subscriptions
    let _subscriptionIds = [];

    // Scroll throttling and sticky scroll behavior
    let _historyScrollScheduled = false;
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

    const clearHistoryPlaceholder = () => {
      const placeholder = document.getElementById('history-placeholder');
      if (placeholder) placeholder.remove();
    };

    const MAX_TOOL_ENTRIES = 200;
    const MAX_HISTORY_ENTRIES = 200;

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

    function createMemoryPanel({ logger, escapeHtml, VFS }) {
      const SUMMARY_PATH = '/memory/episodes/summary.md';
      const COMPACTIONS_PATH = '/.memory/compactions.jsonl';
      const RETRIEVALS_PATH = '/.memory/retrievals.jsonl';
      const MAX_COMP = 20;
      const MAX_RET = 20;

      let _compactions = [];
      let _retrievals = [];
      let _summary = '';

      const parseJsonl = (content) => {
        if (!content) return [];
        return content.split('\n')
          .filter(line => line.trim())
          .map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      };

      const formatTokenValue = (value) => {
        if (!Number.isFinite(value)) return '-';
        return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
      };

      const loadSummary = async () => {
        if (!VFS) return;
        try {
          if (await VFS.exists(SUMMARY_PATH)) {
            _summary = await VFS.read(SUMMARY_PATH);
          } else {
            _summary = '';
          }
        } catch (e) {
          logger.warn('[MemoryPanel] Failed to load summary', e.message);
          _summary = '';
        }
      };

      const loadCompactions = async () => {
        if (!VFS) return;
        try {
          if (await VFS.exists(COMPACTIONS_PATH)) {
            const content = await VFS.read(COMPACTIONS_PATH);
            _compactions = parseJsonl(content).slice(-MAX_COMP).reverse();
          } else {
            _compactions = [];
          }
        } catch (e) {
          logger.warn('[MemoryPanel] Failed to load compactions', e.message);
          _compactions = [];
        }
      };

      const loadRetrievals = async () => {
        if (!VFS) return;
        try {
          if (await VFS.exists(RETRIEVALS_PATH)) {
            const content = await VFS.read(RETRIEVALS_PATH);
            _retrievals = parseJsonl(content).slice(-MAX_RET).reverse();
          } else {
            _retrievals = [];
          }
        } catch (e) {
          logger.warn('[MemoryPanel] Failed to load retrievals', e.message);
          _retrievals = [];
        }
      };

      const renderSummary = () => {
        const summaryEl = document.getElementById('memory-summary');
        const metaEl = document.getElementById('memory-summary-meta');
        if (!summaryEl) return;
        summaryEl.textContent = _summary || 'No summary yet';
        if (metaEl) {
          metaEl.textContent = _summary ? `Loaded ${formatTimestamp(Date.now())}` : '-';
        }
      };

      const renderCompactions = () => {
        const listEl = document.getElementById('memory-compactions');
        if (!listEl) return;
        if (_compactions.length === 0) {
          listEl.innerHTML = '<div class="muted">No compactions yet</div>';
          return;
        }
        listEl.innerHTML = _compactions.map((entry) => {
          const prev = formatTokenValue(entry.previousTokens);
          const next = formatTokenValue(entry.newTokens);
          const mode = entry.mode || 'unknown';
          const count = entry.compactions || 0;
          const ts = formatTimestamp(entry.ts);
          const meta = `#${count} | ${prev} -> ${next} | ${mode} | ${ts}`;
          const summary = entry.summary || '';
          return `
            <details class="memory-entry">
              <summary>
                <span>Compaction</span>
                <span class="memory-entry-meta">${escapeHtml(meta)}</span>
              </summary>
              <pre>${escapeHtml(summary || 'No summary text')}</pre>
            </details>
          `;
        }).join('');
      };

      const renderRetrievals = () => {
        const listEl = document.getElementById('memory-retrievals');
        if (!listEl) return;
        if (_retrievals.length === 0) {
          listEl.innerHTML = '<div class="muted">No retrievals yet</div>';
          return;
        }
        listEl.innerHTML = _retrievals.map((entry) => {
          const ts = formatTimestamp(entry.ts);
          const tokens = formatTokenValue(entry.totalTokens);
          const count = entry.contextItems || 0;
          const query = entry.query ? summarizeText(entry.query, 60) : 'Unknown query';
          const meta = `${tokens} tokens | ${count} items | ${ts}`;
          const block = entry.block || '';
          return `
            <details class="memory-entry">
              <summary>
                <span>${escapeHtml(query)}</span>
                <span class="memory-entry-meta">${escapeHtml(meta)}</span>
              </summary>
              <pre>${escapeHtml(block || 'No retrieval block')}</pre>
            </details>
          `;
        }).join('');
      };

      const refresh = async () => {
        if (!VFS) return;
        await Promise.all([loadSummary(), loadCompactions(), loadRetrievals()]);
        renderSummary();
        renderCompactions();
        renderRetrievals();
      };

      const appendCompaction = (entry) => {
        if (!entry) return;
        _compactions.unshift(entry);
        if (_compactions.length > MAX_COMP) _compactions.pop();
        renderCompactions();
      };

      const appendRetrieval = (entry) => {
        if (!entry) return;
        _retrievals.unshift(entry);
        if (_retrievals.length > MAX_RET) _retrievals.pop();
        renderRetrievals();
      };

      return {
        refresh,
        appendCompaction,
        appendRetrieval
      };
    }

    function createCognitionPanel({ Utils, EventBus }) {
      let _initialized = false;
      let _instance = null;

      const init = async () => {
        if (_initialized) return;
        const container = document.getElementById('cognition-panel');
        if (!container) return;

        let CognitionAPI = null;
        let KnowledgeGraph = null;
        let SemanticMemory = null;
        try {
          if (window.REPLOID_DI?.resolve) {
            CognitionAPI = await window.REPLOID_DI.resolve('CognitionAPI');
            KnowledgeGraph = await window.REPLOID_DI.resolve('KnowledgeGraph');
            SemanticMemory = await window.REPLOID_DI.resolve('SemanticMemory');
          }
        } catch (e) {
          logger.warn('[CognitionPanel] Failed to resolve cognition services', e?.message || e);
        }

        _instance = CognitionPanel.factory({ Utils, EventBus, CognitionAPI, KnowledgeGraph, SemanticMemory });
        if (_instance?.init) {
          _instance.init('cognition-panel');
          _initialized = true;
        }
      };

      return { init };
    }

    // Error handling via ErrorStore
    const updateStatusBadge = async () => {
      const statusBtn = document.querySelector('[data-tab="status"]');
      if (!statusBtn || !ErrorStore) return;

      try {
        const errors = await ErrorStore.getErrors();
        const errorCount = errors.filter(e => e.severity === 'error').length;
        const warningCount = errors.filter(e => e.severity === 'warning').length;
        const totalCount = errorCount + warningCount;

        let existingBadge = statusBtn.querySelector('.status-badge');

        if (totalCount > 0) {
          if (!existingBadge) {
            existingBadge = document.createElement('span');
            existingBadge.className = 'status-badge';
            statusBtn.appendChild(existingBadge);
          }
          existingBadge.textContent = totalCount;
          existingBadge.className = errorCount > 0 ? 'status-badge error' : 'status-badge warning';
        } else if (existingBadge) {
          existingBadge.remove();
        }

        const errorCountEl = document.getElementById('agent-errors');
        if (errorCountEl) errorCountEl.textContent = String(totalCount);
      } catch (e) {
        logger.warn('[Proto] Failed to update status badge:', e.message);
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

    const TIMELINE_TYPES = new Set(['llm_response', 'human', 'tool_batch', 'compaction', 'arena_result']);

    const shouldPersistHistory = (entry) => {
      if (!entry || entry.pending) return false;
      return TIMELINE_TYPES.has(entry.type);
    };

    const saveHistoryEntry = async (entry) => {
      if (!VFS) return;
      if (!shouldPersistHistory(entry)) return;
      await loadHistory();

      _historyCache.push({
        ...entry,
        ts: entry.ts || Date.now()
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
      const entriesToRender = _historyCache
        .filter(shouldPersistHistory)
        .slice(-MAX_HISTORY_ENTRIES)
        .slice()
        .reverse();

      for (const entry of entriesToRender) {
        const div = document.createElement('div');
        renderHistoryEntry(div, entry);
        historyContainer.appendChild(div);
      }

      scheduleHistoryScroll();
    };

    const formatTokenValue = (value) => {
      if (!Number.isFinite(value)) return '-';
      return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
    };

    const renderHistoryEntry = (div, entry) => {
      if (entry.type === 'llm_response') {
        div.className = 'history-entry llm';
        div.innerHTML = `
          <div class="history-header">
            <span class="entry-label">Model Response</span>
            <span class="entry-cycle">#${entry.cycle || '-'}</span>
          </div>
          <pre class="history-content">${escapeHtml(entry.content)}</pre>
        `;
        return;
      }

      if (entry.type === 'human') {
        const isGoal = entry.messageType === 'goal';
        div.className = `history-entry human-message ${isGoal ? 'goal-refinement' : ''}`;
        div.innerHTML = `
          <div class="history-header">
            <span class="entry-label">${isGoal ? 'You (Goal)' : 'You'}</span>
            <span class="entry-cycle">#${entry.cycle || '-'}</span>
          </div>
          <pre class="history-content">${escapeHtml(entry.content)}</pre>
        `;
        return;
      }

      if (entry.type === 'tool_batch') {
        const toolNames = entry.topTools || entry.tools || [];
        const extra = Number.isFinite(entry.extraTools) ? entry.extraTools : Math.max(0, (entry.tools || []).length - toolNames.length);
        const toolList = toolNames.length > 0
          ? `${toolNames.join(', ')}${extra ? ` (+${extra})` : ''}`
          : 'No tools';
        const detail = `Tool batch: ${entry.total || 0} calls (${entry.errors || 0} errors) - ${toolList}`;

        div.className = 'history-entry marker tool-batch';
        div.innerHTML = `
          <div class="history-header">Tool batch</div>
          <div class="history-meta">${escapeHtml(detail)}</div>
        `;
        return;
      }

      if (entry.type === 'compaction') {
        const prev = formatTokenValue(entry.previousTokens);
        const next = formatTokenValue(entry.newTokens);
        const mode = entry.mode || 'unknown';
        const count = entry.compactions || 0;
        const detail = `Context compacted: ${prev} -> ${next} (mode=${mode}, #${count})`;

        div.className = 'history-entry marker compaction';
        div.innerHTML = `
          <div class="history-header">Context compacted</div>
          <div class="history-meta">${escapeHtml(detail)}</div>
        `;
        return;
      }

      if (entry.type === 'arena_result') {
        const winner = entry.winnerModel || 'unknown';
        const score = Number.isFinite(entry.winnerScore) ? entry.winnerScore.toFixed(2) : '-';
        const total = Number.isFinite(entry.total) ? entry.total : 0;
        const mode = entry.mode || 'arena';
        const detail = `Arena: winner ${winner} (score ${score}) | ${total} models | mode=${mode}`;

        div.className = 'history-entry marker arena-result';
        div.innerHTML = `
          <div class="history-header">Arena result</div>
          <div class="history-meta">${escapeHtml(detail)}</div>
        `;
        return;
      }
    };

    const clearToolsPlaceholder = () => {
      const placeholder = _toolsList?.querySelector('.muted');
      if (placeholder) placeholder.remove();
    };

    const updateToolsCount = () => {
      if (_toolsCountEl) _toolsCountEl.textContent = `${_toolEntries.length} entries`;
    };

    const formatArgsPreview = (args) => {
      if (!args) return '-';
      if (args.path) return `path=${args.path}`;
      if (args.name) return `name=${args.name}`;
      const keys = Object.keys(args);
      return keys.length ? keys.join(', ') : '-';
    };

    const buildReflectionMeta = (resultText, status) => {
      const outcome = status === 'error' ? 'error' : 'success';
      let indicator = '';
      if (resultText && typeof resultText === 'string') {
        const cleaned = resultText.replace(/^Error:\s*/i, '').trim();
        const firstLine = cleaned.split('\n').find(line => line.trim()) || cleaned;
        indicator = summarizeText(firstLine, 48);
      }
      if (!indicator) {
        indicator = outcome === 'error' ? 'failed' : 'ok';
      }
      return { outcome, indicator };
    };

    const renderToolEntry = (entry) => {
      const details = document.createElement('details');
      details.className = 'tool-entry';
      if (entry.status === 'error') details.classList.add('error');

      const argsText = entry.args ? JSON.stringify(entry.args, null, 2) : '{}';
      const resultText = typeof entry.result === 'string'
        ? entry.result
        : JSON.stringify(entry.result, null, 2);
      const argsPreview = summarizeText(formatArgsPreview(entry.args), 120);
      const resultPreview = summarizeText(resultText.replace(/\s+/g, ' '), 140);
      const duration = formatDuration(entry.durationMs);
      const statusLabel = entry.status === 'error' ? 'ERROR' : 'OK';
      const reflectionText = entry.reflectionOutcome
        ? `${entry.reflectionOutcome}${entry.reflectionIndicator ? ` | ${entry.reflectionIndicator}` : ''}`
        : 'success';

      details.innerHTML = `
        <summary class="tool-summary">
          <div class="tool-summary-main">
            <span class="tool-name">${escapeHtml(entry.tool)}</span>
            <span class="tool-meta">#${entry.cycle || '-'}</span>
            <span class="tool-meta">${duration}</span>
          </div>
          <div class="tool-summary-sub">
            <span class="tool-status ${entry.status === 'error' ? 'error' : ''}">${statusLabel}</span>
            <span class="tool-reflection ${entry.reflectionOutcome === 'error' ? 'error' : ''}">Reflection: ${escapeHtml(reflectionText)}</span>
            <span>args: ${escapeHtml(argsPreview)}</span>
          </div>
          <div class="tool-preview">${escapeHtml(resultPreview)}</div>
        </summary>
        <div class="tool-detail">
          <div class="tool-detail-label">Reflection</div>
          <div class="tool-detail-reflection">
            <span class="tool-reflection ${entry.reflectionOutcome === 'error' ? 'error' : ''}">Outcome: ${escapeHtml(entry.reflectionOutcome || 'success')}</span>
            <span class="tool-reflection-indicator">${escapeHtml(entry.reflectionIndicator || '-')}</span>
          </div>
          <div class="tool-detail-label">Args</div>
          <pre>${escapeHtml(argsText)}</pre>
          <div class="tool-detail-label">Result</div>
          <pre>${escapeHtml(resultText)}</pre>
        </div>
      `;

      return details;
    };

    const addToolEntry = (entry) => {
      if (!_toolsList) return;
      clearToolsPlaceholder();

      _toolEntries.unshift(entry);
      if (_toolEntries.length > MAX_TOOL_ENTRIES) {
        _toolEntries.pop();
      }

      const node = renderToolEntry(entry);
      _toolsList.insertBefore(node, _toolsList.firstChild);
      updateToolsCount();
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

    const DEFAULT_ACTIVE_TABS = ['timeline', 'tools'];

    const loadActiveTabs = () => [...DEFAULT_ACTIVE_TABS];

    const persistActiveTabs = () => {};

    const handleTabActivation = (tabId) => {
      if (tabId === 'telemetry' && !telemetryManager.isLoaded()) {
        telemetryManager.loadTelemetryHistory();
      }
      if (tabId === 'memory' && memoryPanel) {
        memoryPanel.refresh();
      }
      if (tabId === 'cognition' && cognitionPanel) {
        cognitionPanel.init();
      }
      if (tabId === 'status') {
        updateStatusBadge();
      }
    };

    const applyActiveTabs = (rootOverride) => {
      const container = rootOverride || _root?.querySelector('.app-shell');
      if (!container) return;

      const activeSet = new Set(_activeTabs);
      const totalActive = _activeTabs.length;
      const positionMap = totalActive === 1
        ? [1]
        : totalActive === 2
          ? [0, 2]
          : [0, 1, 2];

      const tabButtons = container.querySelectorAll('.sidebar-btn[data-tab]');
      tabButtons.forEach((btn) => {
        const tabId = btn.dataset.tab;
        const isActive = activeSet.has(tabId);
        btn.classList.toggle('active', isActive);
        if (isActive) {
          const idx = _activeTabs.indexOf(tabId);
          btn.dataset.order = String(positionMap[idx] ?? idx);
        } else {
          delete btn.dataset.order;
        }
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
      applyActiveTabs(container);

      _toolsList = container.querySelector('#tools-list');
      _toolsCountEl = container.querySelector('#tools-count');

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

      const setToggleState = (state) => {
        const iconMap = {
          stop: '■',
          run: '▶',
          restart: '⟲'
        };
        const labelMap = {
          stop: 'Stop',
          run: 'Run',
          restart: 'Restart'
        };
        const titleMap = {
          stop: 'Stop (Esc)',
          run: 'Resume (Ctrl+Enter)',
          restart: 'Restart'
        };
        const icon = iconMap[state] || iconMap.stop;
        const label = labelMap[state] || labelMap.stop;
        const title = titleMap[state] || titleMap.stop;
        btnToggle.innerHTML = `<span class="sidebar-icon">${icon}</span>`;
        btnToggle.title = title;
        btnToggle.setAttribute('aria-label', label);
      };

      setToggleState('stop');

      const updateButtonState = (running) => {
        if (running) {
          setToggleState('stop');
        } else {
          setToggleState('run');
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
            setToggleState('restart');
            Toast.success('Goal Complete', 'Agent finished successfully');
          } catch (e) {
            logger.error(`Agent Error: ${e.message}`);
            isRunning = false;
            setToggleState('restart');
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

      return container;
    };

    const mount = async (target) => {
      _root = target;
      _root.innerHTML = '';
      const container = await render();
      _root.appendChild(container);
      applyActiveTabs();
      _activeTabs.forEach((tabId) => handleTabActivation(tabId));

      // Load persisted history and errors
      renderSavedHistory();
      updateStatusBadge();
      memoryPanel.refresh();
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

      // Load model info
      try {
        const savedModels = localStorage.getItem('SELECTED_MODELS');
        if (savedModels) {
          const models = JSON.parse(savedModels);
          const modelEl = document.getElementById('agent-model');
          if (modelEl && models.length > 0) {
            const names = models.map(m => m.name || m.id).filter(Boolean);
            modelEl.textContent = names.join(', ') || '-';
            _maxTokens = models[0].contextSize || 32000;
          }
        }
      } catch (e) { /* ignore */ }

      cleanup();

      // Event subscriptions
      _subscriptionIds.push(EventBus.on('agent:status', (status) => {
        const stateEl = document.getElementById('agent-state');
        const stateDetailEl = document.getElementById('agent-state-detail');
        const activityEl = document.getElementById('agent-activity');
        const cycleEl = document.getElementById('agent-cycle');
        const cycleDetailEl = document.getElementById('agent-cycle-detail');

        if (stateEl && status.state) stateEl.textContent = status.state;
        if (stateDetailEl && status.state) stateDetailEl.textContent = status.state;
        if (activityEl && status.activity) activityEl.textContent = status.activity;
        if (cycleEl && status.cycle) cycleEl.textContent = status.cycle;
        if (cycleDetailEl && status.cycle) cycleDetailEl.textContent = status.cycle;
      }));

      _subscriptionIds.push(EventBus.on('agent:tokens', (data) => {
        // Update max from ContextManager's model-aware limits
        if (data.limit) _maxTokens = data.limit;
        updateTokenBudget(data.tokens);
        const tokensEl = document.getElementById('agent-tokens');
        if (tokensEl) tokensEl.textContent = `${data.tokens} / ${_maxTokens}`;

        const windowEl = document.getElementById('agent-token-window');
        if (windowEl) {
          const percent = _maxTokens ? Math.round((data.tokens / _maxTokens) * 100) : 0;
          windowEl.textContent = `${Math.min(percent, 100)}%`;
        }
      }));
      _subscriptionIds.push(EventBus.on('telemetry:event', telemetryManager.appendTelemetryEntry));

      _subscriptionIds.push(EventBus.on('context:compacted', (data = {}) => {
        Toast.info('Context Compacted', 'Conversation summarized to save tokens', { duration: 3000 });

        const compactionsEl = document.getElementById('agent-compactions');
        const lastCompactionEl = document.getElementById('agent-last-compaction');
        if (compactionsEl && Number.isFinite(data.compactions)) {
          compactionsEl.textContent = String(data.compactions);
        }
        if (lastCompactionEl) {
          lastCompactionEl.textContent = formatSince(data.ts || Date.now());
        }

        const historyContainer = document.getElementById('history-container');
        if (historyContainer) {
          const div = document.createElement('div');
          const entry = {
            type: 'compaction',
            previousTokens: data.previousTokens,
            newTokens: data.newTokens,
            mode: data.mode,
            compactions: data.compactions,
            ts: data.ts || Date.now()
          };
          renderHistoryEntry(div, entry);
          historyContainer.insertBefore(div, historyContainer.firstChild);
          scheduleHistoryScroll();
          saveHistoryEntry(entry);
        }

        if (memoryPanel) {
          memoryPanel.appendCompaction({
            ts: data.ts || Date.now(),
            mode: data.mode,
            previousTokens: data.previousTokens,
            newTokens: data.newTokens,
            compactions: data.compactions,
            summary: data.summary || ''
          });
        }
      }));

      _subscriptionIds.push(EventBus.on('memory:retrieval_block', (data = {}) => {
        if (memoryPanel) {
          memoryPanel.appendRetrieval({
            ts: data.ts || Date.now(),
            query: data.query || '',
            totalTokens: data.totalTokens || 0,
            contextItems: data.contextItems || 0,
            block: data.block || ''
          });
        }
      }));

      // Error events are handled by ErrorStore - just update the status badge
      _subscriptionIds.push(EventBus.on('error:added', () => {
        updateStatusBadge();
      }));

      _subscriptionIds.push(EventBus.on('error:cleared', () => {
        updateStatusBadge();
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
        clearHistoryPlaceholder();

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
        clearHistoryPlaceholder();

      if (entry.type === 'tool_result') {
        const resultText = typeof entry.result === 'string'
          ? entry.result
          : JSON.stringify(entry.result, null, 2);
        const status = resultText.startsWith('Error:') ? 'error' : 'success';
        const reflectionMeta = buildReflectionMeta(resultText, status);
        const toolEntry = {
          tool: entry.tool || 'unknown',
          cycle: entry.cycle,
          args: entry.args || {},
          result: resultText,
          durationMs: entry.durationMs ?? null,
          status,
          reflectionOutcome: reflectionMeta.outcome,
          reflectionIndicator: reflectionMeta.indicator,
          ts: entry.ts || Date.now()
        };
        addToolEntry(toolEntry);
        return;
      }

        if (streamingEntry && entry.type === 'llm_response') {
          streamingEntry.remove();
          streamingEntry = null;
          streamStartTime = null;
          // Don't manually update _tokenCount - ContextManager will emit agent:tokens with accurate count
          tokenCount = 0;
          EventBus.emit('progress:update', { visible: false });
        }

        if (!TIMELINE_TYPES.has(entry.type)) return;

        while (historyContainer.children.length >= MAX_HISTORY_ENTRIES) {
          historyContainer.removeChild(historyContainer.lastChild);
        }

        const div = document.createElement('div');
        renderHistoryEntry(div, entry);

        historyContainer.insertBefore(div, historyContainer.firstChild);
        scheduleHistoryScroll();

        // Persist to VFS
        await saveHistoryEntry(entry);
      }));

      _subscriptionIds.push(EventBus.on('agent:arena-result', async (result = {}) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;
        clearHistoryPlaceholder();

        const winner = result.winner || {};
        const solutions = Array.isArray(result.solutions) ? result.solutions : [];
        const entry = {
          type: 'arena_result',
          cycle: result.cycle,
          mode: result.mode || 'arena',
          winnerModel: winner.model || 'unknown',
          winnerScore: Number.isFinite(winner.score) ? winner.score : null,
          total: solutions.length,
          ts: Date.now()
        };

        while (historyContainer.children.length >= MAX_HISTORY_ENTRIES) {
          historyContainer.removeChild(historyContainer.lastChild);
        }

        const div = document.createElement('div');
        renderHistoryEntry(div, entry);
        historyContainer.insertBefore(div, historyContainer.firstChild);
        scheduleHistoryScroll();
        await saveHistoryEntry(entry);
      }));

      // Kick off initial data fetches
      if (!telemetryManager.isLoaded()) {
        telemetryManager.loadTelemetryHistory();
      }
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

      _historyScrollScheduled = false;
    };

    return {
      mount,
      cleanup
    };
  }
};

export default Proto;
