/**
 * @fileoverview Proto UI
 * Main user interface for the agent.
 * Enhanced with: Toast notifications, Command palette, Token budget, VFS improvements
 */

import Toast from './toast.js';
import CommandPalette from './command-palette.js';
import InlineChat, { INLINE_CHAT_STYLES } from './components/inline-chat.js';

const Proto = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager, WorkerManager } = deps;
    const { logger, escapeHtml } = Utils;

    // VFS reference for browser
    let _vfs = null;
    let _currentFilePath = null;
    let _isediting = false;
    let _vfsPanelCollapsed = false;

    // Track recently modified files for color coding
    let _recentlyModified = new Map(); // path -> { timestamp, type: 'created'|'modified' }
    const RECENT_HIGHLIGHT_DURATION = 5000; // 5 seconds

    // Token tracking
    let _tokenCount = 0;
    let _maxTokens = 32000; // Default, updated from model config

    // --- DOM Elements ---
    let _root = null;
    let _reflectionsContainer = null;
    let _inlineChat = null;
    const _workerState = new Map();
    const _workerLogs = new Map();
    const MAX_WORKER_LOGS = 40;
    let _lastWorkerUpdate = null;

    // --- Event Subscription Tracking (for cleanup) ---
    let _subscriptionIds = [];

    // --- Scroll Throttling ---
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

    const formatDuration = (ms = 0) => {
      if (ms === null || ms === undefined || Number.isNaN(ms)) return '-';
      const seconds = Math.max(0, Math.floor(ms / 1000));
      if (seconds < 60) return `${seconds}s`;
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      if (minutes < 60) {
        return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
      }
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    };

    const formatTimestamp = (ts) => {
      if (!ts) return '--:--:--';
      try {
        return new Date(ts).toLocaleTimeString([], { hour12: false });
      } catch {
        return '--:--:--';
      }
    };

    const formatSince = (ts) => {
      if (!ts) return '—';
      const diffSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      if (diffSeconds < 1) return 'just now';
      if (diffSeconds < 60) return `${diffSeconds}s ago`;
      const diffMinutes = Math.floor(diffSeconds / 60);
      if (diffMinutes < 60) return `${diffMinutes}m ago`;
      const diffHours = Math.floor(diffMinutes / 60);
      return `${diffHours}h ago`;
    };

    const summarizeText = (text, max = 160) => {
      if (!text) return '';
      if (text.length <= max) return text;
      return `${text.slice(0, max).trim()}...`;
    };

    const ensureWorkerEntry = (workerId) => {
      if (!workerId) return null;
      if (!_workerState.has(workerId)) {
        _workerState.set(workerId, {
          workerId,
          type: '-',
          task: '',
          status: 'pending',
          startTime: Date.now(),
          iterations: 0
        });
      }
      return _workerState.get(workerId);
    };

    const appendWorkerLog = (workerId, message, type = 'info') => {
      if (!workerId || !message) return;
      const logs = _workerLogs.get(workerId) || [];
      logs.push({ message, type, timestamp: Date.now() });
      if (logs.length > MAX_WORKER_LOGS) {
        logs.splice(0, logs.length - MAX_WORKER_LOGS);
      }
      _workerLogs.set(workerId, logs);
      _lastWorkerUpdate = Date.now();
    };

    const renderWorkerCard = (worker) => {
      const status = worker.status || 'pending';
      const logs = _workerLogs.get(worker.workerId) || [];
      const logEntries = logs.length === 0
        ? '<li class="worker-log-empty text-muted">No events yet</li>'
        : logs.map(log => `
            <li>
              <span class="worker-log-time">${formatTimestamp(log.timestamp)}</span>
              <span class="worker-log-text">${escapeHtml(log.message)}</span>
            </li>
          `).join('');
      const openAttr = status === 'running' ? 'open' : '';
      const iterations = worker.iterations ?? worker.iteration ?? 0;
      const duration = status === 'running'
        ? formatDuration(Date.now() - (worker.startTime || Date.now()))
        : formatDuration(worker.duration);
      const toolResults = worker.toolResults || [];
      const successCount = toolResults.filter(r => r.success).length;
      const failureCount = toolResults.length - successCount;
      const toolSummary = toolResults.length
        ? `${successCount} success / ${failureCount} failed tool calls`
        : '';
      const progressLine = worker.progress
        ? `<div class="worker-progress">${escapeHtml(worker.progress)}</div>`
        : '';
      const outputBlock = worker.resultOutput
        ? `<div class="worker-output">${escapeHtml(summarizeText(worker.resultOutput, 220))}</div>`
        : '';
      const errorBlock = worker.error
        ? `<div class="worker-output worker-output-error">${escapeHtml(worker.error)}</div>`
        : '';
      const taskText = worker.task
        ? escapeHtml(summarizeText(worker.task, 200))
        : 'No task recorded';

      return `
        <div class="worker-card worker-${status}">
          <div class="worker-card-header">
            <div>
              <span class="worker-type worker-type-${worker.type || 'unknown'}">${escapeHtml((worker.type || 'unknown').toUpperCase())}</span>
              <span class="worker-id">${escapeHtml(worker.workerId)}</span>
            </div>
            <div class="worker-status">${escapeHtml(status.toUpperCase())}</div>
          </div>
          <div class="worker-task">${taskText}</div>
          <div class="worker-meta">
            <span>${iterations} iters</span>
            <span>${duration}</span>
            ${toolSummary ? `<span>${escapeHtml(toolSummary)}</span>` : ''}
          </div>
          ${progressLine}
          ${outputBlock}
          ${errorBlock}
          <details class="worker-log" ${openAttr}>
            <summary>Events (${logs.length})</summary>
            <ul>
              ${logEntries}
            </ul>
          </details>
        </div>
      `;
    };

    const renderWorkersPanel = () => {
      const activeList = document.getElementById('workers-active-list');
      const completedList = document.getElementById('workers-completed-list');
      if (!activeList || !completedList) return;

      const activeCountEl = document.getElementById('workers-active-count');
      const completedCountEl = document.getElementById('workers-completed-count');
      const lastUpdateEl = document.getElementById('workers-last-update');
      const indicatorEl = document.getElementById('worker-indicator');
      const indicatorCountEl = document.getElementById('worker-indicator-count');
      const clearBtn = document.getElementById('workers-clear-completed');
      const tabBtn = document.getElementById('workers-tab-btn');

      const workers = Array.from(_workerState.values());
      const active = workers
        .filter(w => w.status === 'running')
        .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
      const completed = workers
        .filter(w => w.status && w.status !== 'running')
        .sort((a, b) => (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0));

      if (activeCountEl) activeCountEl.textContent = active.length;
      if (completedCountEl) completedCountEl.textContent = completed.length;
      if (lastUpdateEl) lastUpdateEl.textContent = _lastWorkerUpdate ? formatSince(_lastWorkerUpdate) : '—';
      if (indicatorCountEl) indicatorCountEl.textContent = active.length;
      if (indicatorEl) {
        indicatorEl.classList.toggle('has-workers', active.length > 0);
        indicatorEl.title = active.length > 0
          ? `${active.length} active worker(s) - click to view`
          : 'No active workers';
      }
      if (tabBtn) {
        tabBtn.title = `Workers (${active.length} active)`;
        tabBtn.dataset.count = active.length;
      }
      if (clearBtn) clearBtn.classList.toggle('hidden', completed.length === 0);

      activeList.innerHTML = active.length === 0
        ? '<div class="empty-state">No active workers</div>'
        : active.map(renderWorkerCard).join('');

      completedList.innerHTML = completed.length === 0
        ? '<div class="empty-state">No completed workers yet</div>'
        : completed.slice(0, 8).map(renderWorkerCard).join('');
    };

    const clearCompletedWorkers = () => {
      let changed = false;
      for (const [id, worker] of _workerState.entries()) {
        if (worker.status && worker.status !== 'running') {
          _workerState.delete(id);
          _workerLogs.delete(id);
          changed = true;
        }
      }
      if (changed) renderWorkersPanel();
    };

    const hydrateWorkersFromManager = () => {
      if (!WorkerManager) return;
      try {
        const activeWorkers = typeof WorkerManager.list === 'function' ? WorkerManager.list() : [];
        activeWorkers.forEach(worker => {
          const entry = ensureWorkerEntry(worker.workerId);
          if (!entry) return;
          entry.type = worker.type || entry.type;
          entry.task = worker.task || entry.task;
          entry.status = worker.status || 'running';
          entry.startTime = Date.now() - (worker.runningFor || 0);
          entry.progress = 'Running (recovered)';
          entry.updatedAt = Date.now();
          appendWorkerLog(worker.workerId, 'Recovered active worker', 'info');
        });

        const completedWorkers = typeof WorkerManager.getResults === 'function' ? WorkerManager.getResults() : [];
        completedWorkers.forEach(worker => {
          const entry = ensureWorkerEntry(worker.workerId);
          if (!entry) return;
          entry.type = worker.type || entry.type;
          entry.task = worker.task || entry.task;
          entry.status = worker.status || 'completed';
          entry.duration = worker.duration || worker.result?.duration;
          entry.resultOutput = worker.result?.output || entry.resultOutput;
          entry.toolResults = worker.result?.toolResults || entry.toolResults || [];
          entry.completedAt = Date.now();
          entry.progress = 'Recovered result';
          appendWorkerLog(worker.workerId, 'Recovered completed worker', 'info');
        });

        renderWorkersPanel();
      } catch (err) {
        logger.warn('[Proto] Worker state hydration failed', err);
      }
    };

    const handleWorkerSpawned = (data = {}) => {
      if (!data.workerId) return;
      const worker = ensureWorkerEntry(data.workerId);
      if (!worker) return;
      worker.type = data.type || worker.type;
      worker.task = data.task || worker.task;
      worker.status = 'running';
      worker.startTime = Date.now();
      worker.iterations = 0;
      worker.progress = 'Spawned';
      worker.updatedAt = Date.now();
      appendWorkerLog(data.workerId, `Spawned ${worker.type || 'worker'}`, 'info');
      renderWorkersPanel();
    };

    const handleWorkerProgress = (data = {}) => {
      if (!data.workerId) return;
      const worker = ensureWorkerEntry(data.workerId);
      if (!worker) return;
      worker.status = 'running';
      worker.iteration = data.iteration || data.iterations || worker.iteration || 0;
      worker.maxIterations = data.maxIterations || worker.maxIterations;
      worker.progress = data.message || `Iteration ${worker.iteration || '?'}`;
      worker.updatedAt = Date.now();
      appendWorkerLog(data.workerId, worker.progress, 'progress');
      renderWorkersPanel();
    };

    const handleWorkerCompleted = (data = {}) => {
      if (!data.workerId) return;
      const worker = ensureWorkerEntry(data.workerId);
      if (!worker) return;
      const result = data.result || {};
      worker.status = result.status || 'completed';
      worker.iterations = result.iterations ?? worker.iterations ?? 0;
      worker.duration = result.duration ?? (Date.now() - (worker.startTime || Date.now()));
      worker.resultOutput = result.output || worker.resultOutput;
      worker.toolResults = result.toolResults || [];
      worker.completedAt = Date.now();
      worker.progress = 'Completed';
      worker.error = null;
      appendWorkerLog(data.workerId, `Completed in ${worker.iterations || 0} iteration(s)`, 'complete');
      if (worker.resultOutput) {
        appendWorkerLog(data.workerId, `Output: ${summarizeText(worker.resultOutput, 160)}`, 'output');
      }
      renderWorkersPanel();
    };

    const handleWorkerError = (data = {}) => {
      if (!data.workerId) return;
      const worker = ensureWorkerEntry(data.workerId);
      if (!worker) return;
      worker.status = 'error';
      worker.error = data.error || 'Unknown error';
      worker.completedAt = Date.now();
      worker.progress = 'Error';
      appendWorkerLog(data.workerId, worker.error, 'error');
      renderWorkersPanel();
    };

    const handleWorkerTerminated = (data = {}) => {
      if (!data.workerId) return;
      const worker = ensureWorkerEntry(data.workerId);
      if (!worker) return;
      worker.status = 'terminated';
      worker.completedAt = Date.now();
      worker.progress = 'Terminated';
      appendWorkerLog(data.workerId, 'Worker terminated', 'warning');
      renderWorkersPanel();
    };

    // --- VFS Search Debouncing ---
    let _vfsSearchTimeout = null;

    // --- Event Handlers ---

    const MAX_REFLECTIONS = 100;
    const MAX_HISTORY_ENTRIES = 200;

    const onReflection = (entry) => {
      if (!_reflectionsContainer) return;

      // Limit entries to prevent DOM bloat
      while (_reflectionsContainer.children.length >= MAX_REFLECTIONS) {
        _reflectionsContainer.removeChild(_reflectionsContainer.firstChild);
      }

      const div = document.createElement('div');
      const isError = entry.type === 'error';
      div.className = `reflection-entry ${isError ? 'reflection-error' : 'reflection-success'}`;

      // Format reflection with full details
      const tool = entry.context?.tool || 'unknown';
      const cycle = entry.context?.cycle || '?';
      const indicator = entry.context?.failureIndicator;
      const args = entry.context?.args;

      // Format args preview
      let argsPreview = '';
      if (args) {
        if (args.path) argsPreview = args.path;
        else if (args.name) argsPreview = args.name;
        else {
          const keys = Object.keys(args);
          if (keys.length > 0) argsPreview = keys.join(', ');
        }
      }

      // Build detailed display
      const icon = isError ? '✗' : '✓';
      const toolInfo = argsPreview ? `${tool}(${argsPreview})` : tool;

      let detailText = '';
      if (indicator) {
        detailText = indicator;
      } else if (entry.content) {
        // Extract meaningful part of content
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

      div.title = entry.content; // Full content on hover
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

      // Color coding
      budgetFill.classList.remove('low', 'medium', 'high');
      if (percentage < 50) {
        budgetFill.classList.add('low');
      } else if (percentage < 80) {
        budgetFill.classList.add('medium');
      } else {
        budgetFill.classList.add('high');
      }

      // Show actual count if under 1000, otherwise show in thousands
      // Fixed: Don't add 'k' if the number is already less than 1000
      const displayTokens = _tokenCount >= 1000
        ? `${Math.round(_tokenCount / 1000)}k`
        : _tokenCount.toString();
      const displayMax = _maxTokens >= 1000
        ? `${Math.round(_maxTokens / 1000)}k`
        : _maxTokens.toString();
      budgetText.textContent = `${displayTokens} / ${displayMax}`;
    };

    // --- Tab Switching ---
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

      // Update debug panel when debug tab is opened
      if (tabId === 'debug') {
        updateDebugPanel();
      }
    };

    const updateDebugPanel = () => {
      const container = _root?.querySelector('.app-shell');
      if (!container) return;

      const systemPromptEl = container.querySelector('#debug-system-prompt');
      const contextEl = container.querySelector('#debug-context');
      const contextCountEl = container.querySelector('#debug-context-count');
      const modelConfigEl = container.querySelector('#debug-model-config');

      // Get system prompt from AgentLoop if available
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

      // Get conversation context
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

      // Get model configuration
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

    // --- Render Logic ---

    const render = () => {
      const container = document.createElement('div');
      container.className = 'app-shell';

      // Get goal from boot screen
      const goalFromBoot = localStorage.getItem('REPLOID_GOAL') || 'No goal set';

      container.innerHTML = `
        <!-- Sidebar Navigation -->
        <nav class="sidebar">
          <button class="sidebar-btn active" data-tab="history" title="Agent Activity (1)">&#x2261;</button>
          <button class="sidebar-btn" data-tab="reflections" title="Reflections (2)">&#x2731;</button>
          <button class="sidebar-btn" data-tab="status" title="Status (3)">&#x2139;</button>
          <button class="sidebar-btn" data-tab="workers" title="Workers (0)" id="workers-tab-btn">&#x2692;</button>
          <button class="sidebar-btn" data-tab="debug" title="Debug (4)">&#x2699;</button>
          <div class="sidebar-spacer"></div>
          <button id="btn-palette" class="sidebar-btn" title="Commands (Ctrl+K)">&#x2630;</button>
          <button id="btn-toggle" class="sidebar-btn" title="Stop (Esc)">&#x25A0;</button>
          <button id="btn-export" class="sidebar-btn" title="Export (Ctrl+E)">&#x2913;</button>
        </nav>

        <!-- VFS Browser Panel -->
        <aside class="vfs-browser-panel ${_vfsPanelCollapsed ? 'collapsed' : ''}" id="vfs-browser">
          <div class="vfs-browser-header">
            <span>VFS</span>
            <button id="vfs-refresh" class="btn btn-sm btn-secondary" title="Refresh">↻</button>
          </div>
          <div class="vfs-search-container">
            <input type="text" id="vfs-search" class="vfs-search-input" placeholder="Search files..." />
          </div>
          <div id="vfs-tree" class="vfs-tree mono">
            <div class="text-muted">Loading...</div>
          </div>
        </aside>

        <!-- Main Workspace -->
        <main class="workspace">
          <div class="workspace-header">
            <div class="workspace-title">
              <span class="text-secondary">Goal:</span>
              <span id="agent-goal">${escapeHtml(goalFromBoot)}</span>
              <div class="worker-indicator" id="worker-indicator" title="No active workers">
                &#x2692; workers <span id="worker-indicator-count">0</span>
              </div>
            </div>
            <div class="workspace-status">
              <div class="token-budget" title="Token Budget">
                <div class="token-budget-bar">
                  <div class="token-budget-fill low" id="token-budget-fill" style="width: 0%"></div>
                </div>
                <span class="token-budget-text" id="token-budget-text">0k / 32k</span>
              </div>
              <span class="text-muted">|</span>
              <span id="agent-state" class="text-muted">IDLE</span>
              <span class="text-muted">|</span>
              <span class="text-muted">Cycle</span>
              <span id="agent-cycle">0</span>
            </div>
          </div>

          <!-- Progress Bar for Long Operations -->
          <div id="progress-container" class="hidden">
            <div class="progress-bar" id="progress-bar">
              <div class="progress-bar-fill" id="progress-fill" style="width: 0%"></div>
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; text-align: center;">
              <span id="progress-text"></span>
            </div>
          </div>

          <!-- Tab Panels -->
          <div class="workspace-content" id="tab-history">
            <div id="history-container" class="history-stream">
              <div class="text-muted">Thinking and actions will appear here. Press <kbd>Ctrl+K</kbd> for commands.</div>
            </div>
            <div id="inline-chat-container"></div>
          </div>

          <div class="workspace-content hidden" id="tab-reflections">
            <div id="reflections-container" class="reflections-stream">
              <div class="text-muted">Insights and learnings will appear here.</div>
            </div>
          </div>

          <div class="workspace-content hidden" id="tab-status">
            <div class="status-panel">
              <div class="status-item">
                <span class="status-label">State</span>
                <span id="agent-state-detail" class="status-value">IDLE</span>
              </div>
              <div class="status-item">
                <span class="status-label">Activity</span>
                <span id="agent-activity" class="status-value">Waiting to start</span>
              </div>
              <div class="status-item">
                <span class="status-label">Token Usage</span>
                <span id="agent-tokens" class="status-value">0 / 32000</span>
              </div>
              <div class="status-item">
                <span class="status-label">Model</span>
                <span id="agent-model" class="status-value">-</span>
              </div>
            </div>
            <div id="errors-warnings-section" class="status-section">
              <div class="status-section-header">
                <span>Errors & Warnings</span>
                <button id="clear-errors-btn" class="btn-link" style="display: none;">Clear All</button>
              </div>
              <div id="errors-list" class="errors-list">
                <div class="text-muted" style="padding: 10px;">No errors or warnings</div>
              </div>
            </div>
          </div>

          <div class="workspace-content hidden" id="tab-workers">
            <div class="workers-panel">
              <div class="workers-summary">
                <div class="workers-summary-item">
                  <span>Active</span>
                  <strong id="workers-active-count">0</strong>
                </div>
                <div class="workers-summary-item">
                  <span>Completed</span>
                  <strong id="workers-completed-count">0</strong>
                </div>
                <div class="workers-summary-item">
                  <span>Last Update</span>
                  <strong id="workers-last-update">—</strong>
                </div>
              </div>
              <div class="workers-sections">
                <section class="workers-section">
                  <div class="workers-section-header">
                    <span>Active Workers</span>
                  </div>
                  <div id="workers-active-list" class="workers-list">
                    <div class="empty-state">No active workers</div>
                  </div>
                </section>
                <section class="workers-section">
                  <div class="workers-section-header">
                    <span>Recent Results</span>
                    <button id="workers-clear-completed" class="btn-link hidden">Clear</button>
                  </div>
                  <div id="workers-completed-list" class="workers-list">
                    <div class="empty-state">No completed workers yet</div>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <div class="workspace-content hidden" id="tab-debug">
            <div class="debug-panel">
              <div class="debug-section">
                <div class="debug-section-header">System Prompt</div>
                <pre id="debug-system-prompt" class="debug-content">Loading...</pre>
              </div>
              <div class="debug-section">
                <div class="debug-section-header">Conversation Context (<span id="debug-context-count">0</span> messages)</div>
                <pre id="debug-context" class="debug-content">Loading...</pre>
              </div>
              <div class="debug-section">
                <div class="debug-section-header">Model Configuration</div>
                <pre id="debug-model-config" class="debug-content">Loading...</pre>
              </div>
            </div>
          </div>

          <!-- VFS Content Area (appears in workspace when file is selected) -->
          <div id="vfs-content" class="vfs-content workspace-content hidden mono">
            <div class="vfs-content-header hidden" id="vfs-content-header">
              <span class="vfs-file-path" id="vfs-current-path"></span>
              <div class="vfs-content-actions">
                <button id="vfs-preview-btn" class="btn btn-sm btn-secondary hidden" title="Preview">▶</button>
                <button id="vfs-diff-btn" class="btn btn-sm btn-secondary" title="Diff">⊟</button>
                <button id="vfs-snapshot-btn" class="btn btn-sm btn-secondary" title="Snapshots">◷</button>
                <button id="vfs-edit-btn" class="btn btn-sm btn-secondary" title="edit">edit</button>
                <button id="vfs-save-btn" class="btn btn-sm btn-primary hidden" title="Save">Save</button>
                <button id="vfs-cancel-btn" class="btn btn-sm btn-secondary hidden" title="Cancel">Cancel</button>
              </div>
            </div>
            <div id="vfs-content-body" class="vfs-content-body">
              <div class="text-muted">Select a file to view contents</div>
            </div>
            <div id="vfs-preview-panel" class="vfs-preview-panel hidden">
              <div class="vfs-preview-header">
                <span id="vfs-preview-title">Preview</span>
                <button id="vfs-preview-close" class="btn-link" title="Close">&times;</button>
              </div>
              <iframe id="vfs-preview-iframe" sandbox="allow-scripts" title="File preview"></iframe>
            </div>
            <div id="vfs-diff-panel" class="vfs-diff-panel hidden">
              <div class="vfs-diff-header">
                <span>Genesis Diff</span>
                <button id="vfs-diff-close" class="btn-link" title="Close">&times;</button>
              </div>
              <div id="vfs-diff-content"></div>
            </div>
            <div id="vfs-snapshot-panel" class="vfs-snapshot-panel hidden">
              <div class="vfs-snapshot-header">
                <span>Snapshots</span>
                <button id="vfs-snapshot-close" class="btn-link" title="Close">&times;</button>
              </div>
              <div id="vfs-snapshot-timeline"></div>
              <div id="vfs-snapshot-viewer"></div>
            </div>
            <textarea id="vfs-editor" class="vfs-editor hidden"></textarea>
          </div>
        </main>
      `;

      // Bind Events
      const btnToggle = container.querySelector('#btn-toggle');
      const btnExport = container.querySelector('#btn-export');
      const btnPalette = container.querySelector('#btn-palette');
      let isRunning = true; // Agent starts automatically on awaken

      // Tab switching
      const tabButtons = container.querySelectorAll('.sidebar-btn[data-tab]');
      tabButtons.forEach(btn => {
        btn.onclick = () => switchTab(btn.dataset.tab);
      });

      // Command palette button
      btnPalette.onclick = () => CommandPalette.toggle();

      // Set initial button state (stop symbol since agent starts running)
      btnToggle.innerHTML = '&#x25A0;';
      btnToggle.title = 'Stop (Esc)';

      const updateButtonState = (running) => {
        if (running) {
          btnToggle.innerHTML = '&#x25A0;'; // Square stop symbol
          btnToggle.title = 'Stop (Esc)';
        } else {
          btnToggle.innerHTML = '&#x25B6;'; // Triangle play symbol
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
            Toast.warning('No Goal Set', 'Return to boot screen to set a goal');
            return;
          }

          isRunning = true;
          updateButtonState(true);

          try {
            await AgentLoop.run(goal);
            isRunning = false;
            btnToggle.innerHTML = '&#x21BB;'; // Circular arrow for restart
            btnToggle.title = 'Restart';
            Toast.success('Goal Complete', 'Agent finished successfully');
          } catch (e) {
            logger.error(`Agent Error: ${e.message}`);
            isRunning = false;
            btnToggle.innerHTML = '&#x21BB;'; // Circular arrow for restart
            btnToggle.title = 'Restart';
            Toast.error('Agent Error', e.message, {
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
          Toast.error('Export Failed', e.message);
        }
      };

      btnExport.onclick = exportState;

      // VFS Browser collapse toggle (optional - may not exist in all layouts)
      const vfsToggle = container.querySelector('#vfs-toggle-collapse');
      const vfsPanel = container.querySelector('#vfs-browser');
      if (vfsToggle && vfsPanel) {
        vfsToggle.onclick = () => {
          _vfsPanelCollapsed = !_vfsPanelCollapsed;
          vfsPanel.classList.toggle('collapsed', _vfsPanelCollapsed);
        };
      }

      // VFS Search (debounced)
      const vfsSearch = container.querySelector('#vfs-search');
      vfsSearch.addEventListener('input', () => {
        clearTimeout(_vfsSearchTimeout);
        _vfsSearchTimeout = setTimeout(() => filterVFSTree(vfsSearch.value), 300);
      });

      // VFS edit buttons
      const editBtn = container.querySelector('#vfs-edit-btn');
      const saveBtn = container.querySelector('#vfs-save-btn');
      const cancelBtn = container.querySelector('#vfs-cancel-btn');
      const previewBtn = container.querySelector('#vfs-preview-btn');
      const diffBtn = container.querySelector('#vfs-diff-btn');
      const snapshotBtn = container.querySelector('#vfs-snapshot-btn');

      editBtn.onclick = () => startediting();
      saveBtn.onclick = () => saveFile();
      cancelBtn.onclick = () => cancelediting();
      previewBtn.onclick = () => showPreview();
      diffBtn.onclick = () => showDiff();
      snapshotBtn.onclick = () => showSnapshots();

      const workerIndicator = container.querySelector('#worker-indicator');
      if (workerIndicator) {
        workerIndicator.onclick = () => switchTab('workers');
      }

      const clearWorkersBtn = container.querySelector('#workers-clear-completed');
      if (clearWorkersBtn) {
        clearWorkersBtn.onclick = () => clearCompletedWorkers();
      }

      // Close buttons for panels
      container.querySelector('#vfs-preview-close').onclick = () => closePreview();
      container.querySelector('#vfs-diff-close').onclick = () => closeDiff();
      container.querySelector('#vfs-snapshot-close').onclick = () => closeSnapshots();

      _reflectionsContainer = container.querySelector('#reflections-container');

      // Initialize command palette
      CommandPalette.init({
        onStop: stopAgent,
        onResume: resumeAgent,
        onExport: exportState,
        onClearHistory: () => {
          const historyContainer = document.getElementById('history-container');
          if (historyContainer) {
            historyContainer.innerHTML = '<div class="text-muted">History cleared</div>';
            Toast.info('History Cleared', 'Agent history has been cleared');
          }
        },
        onRefreshVFS: loadVFSTree,
        onSwitchTab: switchTab,
        onToggleVFS: () => {
          _vfsPanelCollapsed = !_vfsPanelCollapsed;
          vfsPanel.classList.toggle('collapsed', _vfsPanelCollapsed);
        }
      });

      return container;
    };

    const mount = (target) => {
      _root = target;
      _root.innerHTML = '';
      _root.appendChild(render());
      renderWorkersPanel();
      hydrateWorkersFromManager();

      // Initialize toast system
      Toast.init();

      // Initialize inline chat for human-in-the-loop
      _inlineChat = InlineChat.factory({ Utils, EventBus });
      const chatContainer = document.getElementById('inline-chat-container');
      if (chatContainer && _inlineChat) {
        _inlineChat.init(chatContainer);
        // Inject CSS if not already present
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

      // Load model info
      try {
        const savedModels = localStorage.getItem('SELECTED_MODELS');
        if (savedModels) {
          const models = JSON.parse(savedModels);
          if (models.length > 0) {
            const modelEl = document.getElementById('agent-model');
            if (modelEl) modelEl.textContent = models[0].name || models[0].id;
            _maxTokens = models[0].contextSize || 32000;
          }
        }
      } catch (e) { /* ignore */ }

      // --- Cleanup any existing subscriptions before re-subscribing ---
      cleanup();

      // Subscribe to reflection events
      _subscriptionIds.push(EventBus.on('reflection:added', (entry) => {
        onReflection(entry);
      }));

      // Subscribe to agent status events
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

      // Subscribe to token updates
      _subscriptionIds.push(EventBus.on('agent:tokens', (data) => {
        updateTokenBudget(data.tokens);
        const tokensEl = document.getElementById('agent-tokens');
        if (tokensEl) tokensEl.textContent = `${data.tokens} / ${_maxTokens}`;
      }));

      _subscriptionIds.push(EventBus.on('worker:spawned', (payload) => {
        handleWorkerSpawned(payload);
      }));

      _subscriptionIds.push(EventBus.on('worker:progress', (payload) => {
        handleWorkerProgress(payload);
      }));

      _subscriptionIds.push(EventBus.on('worker:completed', (payload) => {
        handleWorkerCompleted(payload);
      }));

      _subscriptionIds.push(EventBus.on('worker:error', (payload) => {
        handleWorkerError(payload);
      }));

      _subscriptionIds.push(EventBus.on('worker:terminated', (payload) => {
        handleWorkerTerminated(payload);
      }));

      // Subscribe to context compaction notifications
      _subscriptionIds.push(EventBus.on('context:compacted', () => {
        Toast.info('Context Compacted', 'Conversation summarized to save tokens', { duration: 3000 });
      }));

      // Subscribe to persistence error notifications
      _subscriptionIds.push(EventBus.on('error:persistence', (data) => {
        Toast.warning('State Not Saved', data.message || 'Failed to persist state', {
          duration: 10000,
          actions: [
            { label: 'Export Backup', onClick: () => document.getElementById('btn-export')?.click(), primary: true }
          ]
        });
      }));

      // Subscribe to tool error notifications
      _subscriptionIds.push(EventBus.on('tool:error', (data) => {
        Toast.error(`Tool Failed: ${data.tool}`, data.error.substring(0, 100), {
          duration: 0, // Don't auto-dismiss errors
          actions: [
            {
              label: 'Copy',
              onClick: () => navigator.clipboard.writeText(data.error),
              primary: false
            },
            {
              label: 'View Details',
              onClick: () => Toast.showErrorModal(`Tool Failed: ${data.tool}`, data.error, { tool: data.tool, cycle: data.cycle }),
              primary: true
            }
          ]
        });
      }));

      // Subscribe to circuit breaker events
      _subscriptionIds.push(EventBus.on('tool:circuit_open', (data) => {
        Toast.warning(`Tool Disabled: ${data.tool}`, `Temporarily disabled after ${data.failures} failures. Will auto-reset in 60s.`, {
          duration: 10000,
          actions: [
            {
              label: 'View Last Error',
              onClick: () => Toast.showErrorModal(`Tool Failures: ${data.tool}`, data.error, { tool: data.tool, failures: data.failures }),
              primary: true
            }
          ]
        });
      }));

      // Subscribe to progress events
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

      // Subscribe to streaming events for live feedback
      let streamingEntry = null;
      let streamStartTime = null;
      let tokenCount = 0;

      _subscriptionIds.push(EventBus.on('agent:stream', (text) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        // Create or update streaming entry
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

        // Update status label based on content
        const statusLabel = streamingEntry.querySelector('.status-label');
        if (statusLabel) {
          if (text.includes('[System: Downloading')) {
            statusLabel.textContent = 'Downloading...';
            // Show progress bar for downloads
            EventBus.emit('progress:update', { indeterminate: true, message: 'Downloading model...' });
          } else if (text.includes('[System: Loading model')) {
            statusLabel.textContent = 'Loading...';
            EventBus.emit('progress:update', { indeterminate: true, message: 'Loading model into GPU...' });
          } else if (!text.startsWith('[System:')) {
            statusLabel.textContent = 'Thinking...';
            EventBus.emit('progress:update', { visible: false });
          }
        }

        // Estimate tokens (rough: ~4 chars per token) - only for actual content
        if (!text.startsWith('[System:')) {
          tokenCount += Math.ceil(text.length / 4);
          // Update global token count
          updateTokenBudget(_tokenCount + tokenCount);
        }

        // Update stats
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

      // Subscribe to history events
      _subscriptionIds.push(EventBus.on('agent:history', (entry) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        // Clear streaming entry when we get the full response
        if (streamingEntry && entry.type === 'llm_response') {
          streamingEntry.remove();
          streamingEntry = null;
          streamStartTime = null;
          // Update total token count
          _tokenCount += tokenCount;
          tokenCount = 0;
          EventBus.emit('progress:update', { visible: false });
        }

        // Limit history entries to prevent DOM bloat
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

          // Show toast for errors
          if (isError) {
            Toast.error(`Tool Failed: ${entry.tool}`, result.substring(0, 100), {
              duration: 8000,
              actions: [
                { label: 'View', onClick: () => switchTab('history') }
              ]
            });
          }
        } else if (entry.type === 'human') {
          // Human-in-the-loop message
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
      }));

      // Subscribe to arena results
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
          solutionsHTML = solutions
            .map(sol => {
              const isWinner = sol.model === winner.model;
              const badge = isWinner ? '<span class="winner-badge">WINNER</span>' : '';
              return `
                <div class="arena-solution ${isWinner ? 'arena-winner' : ''}">
                  <div class="arena-solution-header">
                    ${escapeHtml(sol.model)} - Score: ${(sol.score || 0).toFixed(2)} ${badge}
                  </div>
                </div>
              `;
            })
            .join('');
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

      // Subscribe to HITL approval requests (render inline approval prompts)
      _subscriptionIds.push(EventBus.on('hitl:approval-pending', (item) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        const div = document.createElement('div');
        div.className = 'history-entry approval-pending';
        div.id = `approval-${item.id}`;

        const dataPreview = item.data
          ? JSON.stringify(item.data, null, 2).substring(0, 500)
          : '(No data)';

        div.innerHTML = `
          <div class="approval-header">⚠ Approval Required</div>
          <div class="approval-action">${escapeHtml(item.action || item.capability)}</div>
          <pre class="approval-data">${escapeHtml(dataPreview)}</pre>
          <div class="approval-buttons">
            <button class="approve-btn" data-approval-id="${item.id}">✓ Approve</button>
            <button class="reject-btn" data-approval-id="${item.id}">✗ Reject</button>
          </div>
        `;

        // Bind approve/reject buttons
        div.querySelector('.approve-btn').addEventListener('click', () => {
          EventBus.emit('hitl:approve', { approvalId: item.id });
          div.classList.add('approval-resolved');
          div.setAttribute('data-resolution', 'Approved');
        });

        div.querySelector('.reject-btn').addEventListener('click', () => {
          EventBus.emit('hitl:reject', { approvalId: item.id, reason: 'User rejected via UI' });
          div.classList.add('approval-resolved');
          div.setAttribute('data-resolution', 'Rejected');
        });

        historyContainer.appendChild(div);
        scheduleHistoryScroll();

        // Also show a toast notification
        Toast.warning('Approval Required', `${item.action || item.capability} needs your approval`, {
          duration: 0,
          actions: [
            { label: 'View', onClick: () => switchTab('history'), primary: true }
          ]
        });
      }));

      // --- VFS Auto-Refresh on File Changes ---
      const markFileModified = (path, type = 'modified') => {
        _recentlyModified.set(path, { timestamp: Date.now(), type });
        // Auto-clear after highlight duration
        setTimeout(() => {
          _recentlyModified.delete(path);
          loadVFSTree(); // Re-render to remove highlight
        }, RECENT_HIGHLIGHT_DURATION);
        loadVFSTree(); // Refresh tree immediately
      };

      // Listen for VFS write events (from tool-runner WriteFile)
      _subscriptionIds.push(EventBus.on('vfs:write', (data) => {
        const path = data?.path || data;
        if (path) markFileModified(path, 'modified');
      }));

      // Listen for artifact events
      _subscriptionIds.push(EventBus.on('artifact:created', (data) => {
        const path = data?.path || data;
        if (path) markFileModified(path, 'created');
      }));

      _subscriptionIds.push(EventBus.on('artifact:updated', (data) => {
        const path = data?.path || data;
        if (path) markFileModified(path, 'modified');
      }));

      _subscriptionIds.push(EventBus.on('artifact:deleted', (data) => {
        const path = data?.path || data;
        if (path) {
          // Mark as deleted briefly before refresh removes it
          _recentlyModified.set(path, { timestamp: Date.now(), type: 'deleted' });
          loadVFSTree();
          // Clear after animation completes
          setTimeout(() => {
            _recentlyModified.delete(path);
            loadVFSTree();
          }, 2000);
        } else {
          loadVFSTree();
        }
      }));

      // Listen for tool results that modify files
      _subscriptionIds.push(EventBus.on('tool:file_written', (data) => {
        const path = data?.path || data;
        if (path) markFileModified(path, 'modified');
      }));
    };

    // --- Cleanup Function (prevents memory leaks) ---
    const cleanup = () => {
      // Unsubscribe all tracked event listeners
      // EventBus.on() returns an unsubscribe function directly
      _subscriptionIds.forEach(unsub => {
        if (typeof unsub === 'function') {
          try { unsub(); } catch (e) { /* ignore */ }
        }
      });
      _subscriptionIds = [];

      // Cleanup inline chat
      if (_inlineChat && _inlineChat.cleanup) {
        _inlineChat.cleanup();
        _inlineChat = null;
      }

      // Clear any pending timeouts
      clearTimeout(_vfsSearchTimeout);

      // Reset scroll schedulers
      _historyScrollScheduled = false;
      _reflectionScrollScheduled = false;
    };

    // --- VFS Browser Functions ---

    let _allFiles = [];

    const loadVFSTree = async () => {
      const treeEl = document.getElementById('vfs-tree');
      if (!treeEl) return;
      if (!_vfs) return;

      try {
        let files = await _vfs.list('/');

        if (files.length === 0) {
          const allFiles = [];
          const tryPaths = ['/.system', '/.memory', '/.logs', '/tools'];
          for (const path of tryPaths) {
            try {
              const subFiles = await _vfs.list(path);
              allFiles.push(...subFiles);
            } catch (e) { /* ignore */ }
          }
          files = allFiles;
        }

        _allFiles = files.sort();

        if (_allFiles.length === 0) {
          treeEl.innerHTML = '<div class="text-muted">VFS is empty</div>';
          return;
        }

        renderVFSTree(_allFiles);
      } catch (e) {
        treeEl.innerHTML = `<div class="text-danger">Error: ${e.message}</div>`;
      }
    };

    const MAX_VFS_FILES = 500;

    const renderVFSTree = (files) => {
      const treeEl = document.getElementById('vfs-tree');
      if (!treeEl) return;

      // Limit files to prevent DOM bloat
      const truncated = files.length > MAX_VFS_FILES;
      const displayFiles = truncated ? files.slice(0, MAX_VFS_FILES) : files;

      // Group by directory
      const tree = {};
      displayFiles.forEach(path => {
        const parts = path.split('/').filter(p => p);
        let current = tree;
        parts.forEach((part, i) => {
          if (i === parts.length - 1) {
            current[part] = path; // Leaf node = full path
          } else {
            current[part] = current[part] || {};
            current = current[part];
          }
        });
      });

      const renderNode = (node, indent = 0) => {
        let html = '';
        const entries = Object.entries(node).sort(([a], [b]) => {
          const aIsDir = typeof node[a] === 'object';
          const bIsDir = typeof node[b] === 'object';
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;
          return a.localeCompare(b);
        });

        entries.forEach(([name, value]) => {
          const isDir = typeof value === 'object';
          const padding = indent * 12;

          if (isDir) {
            html += `
              <div class="vfs-dir" style="padding-left: ${padding}px">
                <span class="vfs-dir-icon">▼</span> ${escapeHtml(name)}
              </div>
            `;
            html += renderNode(value, indent + 1);
          } else {
            const safePath = escapeHtml(value);
            // Check if file was recently modified
            const modInfo = _recentlyModified.get(value);
            let modClass = '';
            let modIndicator = '';
            if (modInfo) {
              if (modInfo.type === 'created') {
                modClass = 'vfs-file-created';
                modIndicator = ' ✦';
              } else if (modInfo.type === 'deleted') {
                modClass = 'vfs-file-deleted';
                modIndicator = ' ✗';
              } else {
                modClass = 'vfs-file-modified';
                modIndicator = ' ●';
              }
            }
            html += `
              <div class="vfs-file ${modClass}" role="button" data-path="${safePath}" style="padding-left: ${padding + 16}px">
                ${escapeHtml(name)}${modIndicator}
              </div>
            `;
          }
        });

        return html;
      };

      let treeHtml = renderNode(tree);

      // Add truncation notice
      if (truncated) {
        treeHtml += `<div class="vfs-truncated text-muted" style="padding: 8px; font-size: 10px;">
          Showing ${MAX_VFS_FILES} of ${files.length} files. Use search to filter.
        </div>`;
      }

      treeEl.innerHTML = treeHtml;

      treeEl.querySelectorAll('.vfs-file').forEach(entry => {
        entry.onclick = () => loadVFSFile(entry.dataset.path);
      });

      treeEl.querySelectorAll('.vfs-dir').forEach(dir => {
        dir.onclick = (e) => {
          e.stopPropagation();
          const icon = dir.querySelector('.vfs-dir-icon');
          const isExpanded = icon.textContent === '▼';
          icon.textContent = isExpanded ? '▶' : '▼';

          // Toggle visibility of children
          let next = dir.nextElementSibling;
          const dirIndent = parseInt(dir.style.paddingLeft) || 0;
          while (next) {
            const nextIndent = parseInt(next.style.paddingLeft) || 0;
            if (nextIndent <= dirIndent) break;
            next.classList.toggle('hidden', isExpanded);
            next = next.nextElementSibling;
          }
        };
      });
    };

    const filterVFSTree = (query) => {
      if (!query.trim()) {
        renderVFSTree(_allFiles);
        return;
      }

      const filtered = _allFiles.filter(path =>
        path.toLowerCase().includes(query.toLowerCase())
      );
      renderVFSTree(filtered);
    };

    const loadVFSFile = async (path) => {
      const vfsContent = document.getElementById('vfs-content');
      const contentHeader = document.getElementById('vfs-content-header');
      const contentBody = document.getElementById('vfs-content-body');
      const pathEl = document.getElementById('vfs-current-path');

      if (!contentBody || !_vfs) return;

      _currentFilePath = path;
      cancelediting(); // Cancel any ongoing edit

      // Hide all other workspace tabs and show VFS content
      const container = _root?.querySelector('.app-shell');
      if (container) {
        container.querySelectorAll('.workspace-content').forEach(panel => {
          panel.classList.add('hidden');
        });
        vfsContent.classList.remove('hidden');
      }

      try {
        const content = await _vfs.read(path);
        let displayContent = content;

        // Pretty print JSON
        if (path.endsWith('.json')) {
          try {
            displayContent = JSON.stringify(JSON.parse(content), null, 2);
          } catch (e) { /* not valid JSON */ }
        }

        contentHeader.classList.remove('hidden');
        pathEl.textContent = path;
        contentBody.innerHTML = `<pre>${escapeHtml(displayContent)}</pre>`;

        // Show preview button for HTML/JS/CSS files
        const previewBtn = document.getElementById('vfs-preview-btn');
        if (previewBtn && (path.endsWith('.html') || path.endsWith('.htm') || path.endsWith('.js') || path.endsWith('.css'))) {
          previewBtn.classList.remove('hidden');
        } else if (previewBtn) {
          previewBtn.classList.add('hidden');
        }

        // Get file stats
        const stat = await _vfs.stat(path);
        if (stat) {
          const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`;
          const updated = new Date(stat.updated).toLocaleString();
          pathEl.title = `Size: ${size} | Modified: ${updated}`;
        }
      } catch (e) {
        contentBody.innerHTML = `<div class="text-danger">Error reading ${path}: ${e.message}</div>`;
      }
    };

    const startediting = () => {
      if (!_currentFilePath || _isediting) return;

      const contentBody = document.getElementById('vfs-content-body');
      const editor = document.getElementById('vfs-editor');
      const editBtn = document.getElementById('vfs-edit-btn');
      const saveBtn = document.getElementById('vfs-save-btn');
      const cancelBtn = document.getElementById('vfs-cancel-btn');

      if (!contentBody || !editor) return;

      _isediting = true;

      // Get current content
      const pre = contentBody.querySelector('pre');
      editor.value = pre ? pre.textContent : '';

      contentBody.classList.add('hidden');
      editor.classList.remove('hidden');
      editBtn.classList.add('hidden');
      saveBtn.classList.remove('hidden');
      cancelBtn.classList.remove('hidden');

      editor.focus();
    };

    const saveFile = async () => {
      if (!_currentFilePath || !_isediting) return;

      const editor = document.getElementById('vfs-editor');
      if (!editor || !_vfs) return;

      try {
        await _vfs.write(_currentFilePath, editor.value);
        Toast.success('File Saved', `${_currentFilePath} saved successfully`);
        cancelediting();
        loadVFSFile(_currentFilePath); // Reload to show updated content
      } catch (e) {
        Toast.error('Save Failed', e.message);
      }
    };

    const cancelediting = () => {
      const contentBody = document.getElementById('vfs-content-body');
      const editor = document.getElementById('vfs-editor');
      const editBtn = document.getElementById('vfs-edit-btn');
      const saveBtn = document.getElementById('vfs-save-btn');
      const cancelBtn = document.getElementById('vfs-cancel-btn');

      _isediting = false;

      if (contentBody) contentBody.classList.remove('hidden');
      if (editor) editor.classList.add('hidden');
      if (editBtn) editBtn.classList.remove('hidden');
      if (saveBtn) saveBtn.classList.add('hidden');
      if (cancelBtn) cancelBtn.classList.add('hidden');
    };

    // Preview Panel
    const showPreview = async () => {
      if (!_currentFilePath || !_vfs) return;

      const previewPanel = document.getElementById('vfs-preview-panel');
      const iframe = document.getElementById('vfs-preview-iframe');
      const contentBody = document.getElementById('vfs-content-body');

      if (!previewPanel || !iframe) return;

      try {
        const content = await _vfs.read(_currentFilePath);
        const blob = new Blob([content], { type: _currentFilePath.endsWith('.html') ? 'text/html' : 'text/javascript' });
        const url = URL.createObjectURL(blob);

        iframe.src = url;
        contentBody.classList.add('hidden');
        previewPanel.classList.remove('hidden');

        // Clean up old blob URL after iframe loads
        iframe.onload = () => URL.revokeObjectURL(url);
      } catch (e) {
        Toast.error('Preview Failed', e.message);
      }
    };

    const closePreview = () => {
      const previewPanel = document.getElementById('vfs-preview-panel');
      const iframe = document.getElementById('vfs-preview-iframe');
      const contentBody = document.getElementById('vfs-content-body');

      if (previewPanel) previewPanel.classList.add('hidden');
      if (iframe) iframe.src = '';
      if (contentBody) contentBody.classList.remove('hidden');
    };

    // Diff Panel
    const showDiff = async () => {
      const diffPanel = document.getElementById('vfs-diff-panel');
      const diffContent = document.getElementById('vfs-diff-content');
      const contentBody = document.getElementById('vfs-content-body');

      if (!diffPanel || !diffContent || !_vfs) return;

      diffContent.innerHTML = '<div class="text-muted">Comparing to genesis...</div>';
      contentBody.classList.add('hidden');
      diffPanel.classList.remove('hidden');

      try {
        // Get genesis snapshot (first snapshot or create one)
        const GenesisSnapshot = window.REPLOID_DI?.get?.('GenesisSnapshot');
        if (!GenesisSnapshot) {
          diffContent.innerHTML = '<div class="text-muted">Genesis snapshots not available</div>';
          return;
        }

        const snapshots = await GenesisSnapshot.listSnapshots();
        let genesisFiles = {};

        if (snapshots.length > 0) {
          // Use first snapshot as genesis
          const genesis = snapshots[0];
          genesisFiles = genesis.files || {};
        }

        // Get current VFS state
        const currentFiles = {};
        const allFiles = await _vfs.list('/');
        for (const path of allFiles) {
          try {
            currentFiles[path] = await _vfs.read(path);
          } catch (e) { /* skip */ }
        }

        // Build diff HTML
        let diffHtml = '';
        const allPaths = new Set([...Object.keys(genesisFiles), ...Object.keys(currentFiles)]);

        for (const path of Array.from(allPaths).sort()) {
          const genesisContent = genesisFiles[path];
          const currentContent = currentFiles[path];

          if (!genesisContent && currentContent) {
            // Added file
            diffHtml += `<div class="diff-added" style="padding: 8px; margin-bottom: 4px;">
              <strong>✓ ${path}</strong> (new file, ${currentContent.length} bytes)
            </div>`;
          } else if (genesisContent && !currentContent) {
            // Deleted file
            diffHtml += `<div class="diff-deleted" style="padding: 8px; margin-bottom: 4px;">
              <strong>✗ ${path}</strong> (deleted)
            </div>`;
          } else if (genesisContent !== currentContent) {
            // Modified file
            diffHtml += `<div class="diff-modified" style="padding: 8px; margin-bottom: 4px;">
              <strong>⚠ ${path}</strong> (modified)
            </div>`;
          }
        }

        if (diffHtml === '') {
          diffHtml = '<div class="text-muted">No changes from genesis state</div>';
        } else {
          const addedCount = (diffHtml.match(/diff-added/g) || []).length;
          const deletedCount = (diffHtml.match(/diff-deleted/g) || []).length;
          const modifiedCount = (diffHtml.match(/diff-modified/g) || []).length;
          diffHtml = `<div style="padding: 8px; margin-bottom: 12px; border-bottom: 1px solid var(--border-default);">
            <strong>Changes:</strong> ${addedCount} added, ${modifiedCount} modified, ${deletedCount} deleted
          </div>` + diffHtml;
        }

        diffContent.innerHTML = diffHtml;
      } catch (e) {
        diffContent.innerHTML = `<div class="text-danger">Error loading diff: ${escapeHtml(e.message)}</div>`;
        logger.error('[VFS] Diff error:', e);
      }
    };

    const closeDiff = () => {
      const diffPanel = document.getElementById('vfs-diff-panel');
      const contentBody = document.getElementById('vfs-content-body');

      if (diffPanel) diffPanel.classList.add('hidden');
      if (contentBody) contentBody.classList.remove('hidden');
    };

    // Snapshot Panel
    const showSnapshots = async () => {
      const snapshotPanel = document.getElementById('vfs-snapshot-panel');
      const timeline = document.getElementById('vfs-snapshot-timeline');
      const viewer = document.getElementById('vfs-snapshot-viewer');
      const contentBody = document.getElementById('vfs-content-body');

      if (!snapshotPanel || !timeline) return;

      timeline.innerHTML = '<div class="text-muted">Loading snapshots...</div>';
      contentBody.classList.add('hidden');
      snapshotPanel.classList.remove('hidden');

      try {
        const GenesisSnapshot = window.REPLOID_DI?.get?.('GenesisSnapshot');
        if (!GenesisSnapshot) {
          timeline.innerHTML = '<div class="text-muted">Snapshot system not available</div>';
          return;
        }

        const snapshots = await GenesisSnapshot.listSnapshots();

        if (snapshots.length === 0) {
          timeline.innerHTML = `<div class="text-muted">No snapshots yet. <button class="btn btn-sm btn-primary" onclick="window.createSnapshot()">Create Snapshot</button></div>`;
          window.createSnapshot = async () => {
            try {
              await GenesisSnapshot.createSnapshot();
              Toast.success('Snapshot Created', 'Genesis snapshot saved');
              showSnapshots(); // Refresh
            } catch (e) {
              Toast.error('Snapshot Failed', e.message);
            }
          };
          return;
        }

        let timelineHtml = `<div style="margin-bottom: 12px;">
          <strong>${snapshots.length} Snapshot${snapshots.length > 1 ? 's' : ''}</strong>
          <button class="btn btn-sm btn-primary" style="float: right;" onclick="window.createSnapshot()">New Snapshot</button>
        </div>`;

        snapshots.forEach((snapshot, idx) => {
          const date = new Date(snapshot.timestamp);
          const timeStr = date.toLocaleString();
          timelineHtml += `
            <div class="snapshot-item" onclick="window.viewSnapshot('${snapshot.id}')">
              <div><strong>${snapshot.name || 'Snapshot ' + (idx + 1)}</strong></div>
              <div class="snapshot-timestamp">${timeStr}</div>
              <div class="snapshot-stats">${snapshot.fileCount} files</div>
              <div class="snapshot-actions">
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); window.restoreSnapshot('${snapshot.id}')">Restore</button>
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); window.viewSnapshot('${snapshot.id}')">View</button>
                <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); window.exportSnapshot('${snapshot.id}')">Export</button>
              </div>
            </div>
          `;
        });

        timeline.innerHTML = timelineHtml;

        // Bind snapshot actions
        window.createSnapshot = async () => {
          try {
            await GenesisSnapshot.createSnapshot();
            Toast.success('Snapshot Created', 'Genesis snapshot saved');
            showSnapshots();
          } catch (e) {
            Toast.error('Snapshot Failed', e.message);
          }
        };

        window.viewSnapshot = async (id) => {
          try {
            const snapshot = snapshots.find(s => s.id === id);
            if (!snapshot) return;

            const files = Object.keys(snapshot.files).sort();
            let viewHtml = `<div style="padding: 8px; border-bottom: 1px solid var(--border-default); margin-bottom: 8px;">
              <strong>${snapshot.name}</strong> - ${snapshot.fileCount} files
            </div>`;

            files.forEach(path => {
              viewHtml += `<div style="padding: 4px 8px; font-size: 12px; font-family: monospace;">${escapeHtml(path)}</div>`;
            });

            viewer.innerHTML = viewHtml;
          } catch (e) {
            viewer.innerHTML = `<div class="text-danger">Error: ${escapeHtml(e.message)}</div>`;
          }
        };

        window.restoreSnapshot = async (id) => {
          if (!confirm('Restore this snapshot? Current VFS will be replaced.')) return;
          try {
            await GenesisSnapshot.restoreSnapshot(id);
            Toast.success('Snapshot Restored', 'VFS restored from snapshot');
            closeSnapshots();
            loadVFSTree();
          } catch (e) {
            Toast.error('Restore Failed', e.message);
          }
        };

        window.exportSnapshot = async (id) => {
          try {
            const exported = await GenesisSnapshot.exportSnapshot(id);
            const blob = new Blob([exported], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `reploid-snapshot-${id}.json`;
            a.click();
            URL.revokeObjectURL(url);
            Toast.success('Export Complete', 'Snapshot exported');
          } catch (e) {
            Toast.error('Export Failed', e.message);
          }
        };

      } catch (e) {
        timeline.innerHTML = `<div class="text-danger">Error: ${escapeHtml(e.message)}</div>`;
        logger.error('[VFS] Snapshot error:', e);
      }
    };

    const closeSnapshots = () => {
      const snapshotPanel = document.getElementById('vfs-snapshot-panel');
      const contentBody = document.getElementById('vfs-content-body');

      if (snapshotPanel) snapshotPanel.classList.add('hidden');
      if (contentBody) contentBody.classList.remove('hidden');
    };

    // Set VFS reference
    const setVFS = (vfs) => {
      _vfs = vfs;
      loadVFSTree();
    };

    return { mount, setVFS, refreshVFS: loadVFSTree, cleanup };
  }
};

export default Proto;
