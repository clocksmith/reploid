/**
 * @fileoverview Proto UI
 * Main user interface for the agent.
 * Enhanced with: Toast notifications, Command palette, Token budget, VFS improvements
 */

import Toast from './toast.js';
import CommandPalette from './command-palette.js';

const Proto = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager } = deps;
    const { logger, escapeHtml } = Utils;

    // VFS reference for browser
    let _vfs = null;
    let _currentFilePath = null;
    let _isEditing = false;
    let _vfsPanelCollapsed = false;

    // Token tracking
    let _tokenCount = 0;
    let _maxTokens = 32000; // Default, updated from model config

    // --- DOM Elements ---
    let _root = null;
    let _reflectionsContainer = null;

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

      budgetText.textContent = `${Math.round(_tokenCount / 1000)}k / ${Math.round(_maxTokens / 1000)}k`;
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
          <button class="sidebar-btn active" data-tab="history" title="History (1)">&#x25B6;</button>
          <button class="sidebar-btn" data-tab="reflections" title="Reflections (2)">&#x2731;</button>
          <button class="sidebar-btn" data-tab="status" title="Status (3)">&#x2139;</button>
          <div class="sidebar-spacer"></div>
          <button id="btn-palette" class="sidebar-btn" title="Commands (Ctrl+K)">&#x2630;</button>
          <button id="btn-toggle" class="sidebar-btn" title="Stop (Esc)">&#x25A0;</button>
          <button id="btn-export" class="sidebar-btn" title="Export (Ctrl+E)">&#x2913;</button>
        </nav>

        <!-- Main Workspace -->
        <main class="workspace">
          <div class="workspace-header">
            <div class="workspace-title">
              <span class="text-secondary">Goal:</span>
              <span id="agent-goal">${escapeHtml(goalFromBoot)}</span>
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
          </div>
        </main>

        <!-- Utility Panel (VFS Browser) -->
        <aside class="utility-panel ${_vfsPanelCollapsed ? 'collapsed' : ''}" id="vfs-panel">
          <div class="utility-header">
            <span>VFS Browser</span>
            <div style="display: flex; gap: 6px;">
              <button id="vfs-toggle-collapse" class="btn btn-sm btn-secondary" title="Toggle Panel">◫</button>
              <button id="vfs-refresh" class="btn btn-sm btn-secondary" title="Refresh">↻</button>
            </div>
          </div>
          <div class="vfs-search-container">
            <input type="text" id="vfs-search" class="vfs-search-input" placeholder="Search files..." />
          </div>
          <div id="vfs-tree" class="vfs-tree mono">
            <div class="text-muted">Loading...</div>
          </div>
          <div id="vfs-content" class="vfs-content mono">
            <div class="vfs-content-header hidden" id="vfs-content-header">
              <span class="vfs-file-path" id="vfs-current-path"></span>
              <div class="vfs-content-actions">
                <button id="vfs-edit-btn" class="btn btn-sm btn-secondary" title="Edit">Edit</button>
                <button id="vfs-save-btn" class="btn btn-sm btn-primary hidden" title="Save">Save</button>
                <button id="vfs-cancel-btn" class="btn btn-sm btn-secondary hidden" title="Cancel">Cancel</button>
              </div>
            </div>
            <div id="vfs-content-body" class="vfs-content-body">
              <div class="text-muted">Select a file to view contents</div>
            </div>
            <textarea id="vfs-editor" class="vfs-editor hidden"></textarea>
          </div>
        </aside>
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

      // Set initial button state (Unicode stop symbol)
      btnToggle.innerHTML = '&#x25A0;';
      btnToggle.title = 'Stop (Esc)';

      const stopAgent = () => {
        if (isRunning) {
          AgentLoop.stop();
          isRunning = false;
          btnToggle.innerHTML = '&#x25B6;';
          btnToggle.title = 'Resume (Ctrl+Enter)';
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
          btnToggle.innerHTML = '&#x25A0;';
          btnToggle.title = 'Stop (Esc)';

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

      // VFS Panel collapse toggle
      const vfsToggle = container.querySelector('#vfs-toggle-collapse');
      const vfsPanel = container.querySelector('#vfs-panel');
      vfsToggle.onclick = () => {
        _vfsPanelCollapsed = !_vfsPanelCollapsed;
        vfsPanel.classList.toggle('collapsed', _vfsPanelCollapsed);
      };

      // VFS Search (debounced)
      const vfsSearch = container.querySelector('#vfs-search');
      vfsSearch.addEventListener('input', () => {
        clearTimeout(_vfsSearchTimeout);
        _vfsSearchTimeout = setTimeout(() => filterVFSTree(vfsSearch.value), 300);
      });

      // VFS Edit buttons
      const editBtn = container.querySelector('#vfs-edit-btn');
      const saveBtn = container.querySelector('#vfs-save-btn');
      const cancelBtn = container.querySelector('#vfs-cancel-btn');

      editBtn.onclick = () => startEditing();
      saveBtn.onclick = () => saveFile();
      cancelBtn.onclick = () => cancelEditing();

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

      // Initialize toast system
      Toast.init();

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
            <div class="history-header">Think #${entry.cycle}</div>
            <pre class="history-content">${escapeHtml(content)}</pre>
          `;
        } else if (entry.type === 'tool_result') {
          const result = entry.result || '(No result)';
          const isError = result.startsWith('Error:');
          div.innerHTML = `
            <div class="history-header ${isError ? 'history-error' : ''}">
              Act #${entry.cycle} → ${entry.tool}
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
        }

        historyContainer.appendChild(div);
        scheduleHistoryScroll();
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
            html += `
              <div class="vfs-file" role="button" data-path="${safePath}" style="padding-left: ${padding + 16}px">
                ${escapeHtml(name)}
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
      const contentHeader = document.getElementById('vfs-content-header');
      const contentBody = document.getElementById('vfs-content-body');
      const pathEl = document.getElementById('vfs-current-path');

      if (!contentBody || !_vfs) return;

      _currentFilePath = path;
      cancelEditing(); // Cancel any ongoing edit

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

    const startEditing = () => {
      if (!_currentFilePath || _isEditing) return;

      const contentBody = document.getElementById('vfs-content-body');
      const editor = document.getElementById('vfs-editor');
      const editBtn = document.getElementById('vfs-edit-btn');
      const saveBtn = document.getElementById('vfs-save-btn');
      const cancelBtn = document.getElementById('vfs-cancel-btn');

      if (!contentBody || !editor) return;

      _isEditing = true;

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
      if (!_currentFilePath || !_isEditing) return;

      const editor = document.getElementById('vfs-editor');
      if (!editor || !_vfs) return;

      try {
        await _vfs.write(_currentFilePath, editor.value);
        Toast.success('File Saved', `${_currentFilePath} saved successfully`);
        cancelEditing();
        loadVFSFile(_currentFilePath); // Reload to show updated content
      } catch (e) {
        Toast.error('Save Failed', e.message);
      }
    };

    const cancelEditing = () => {
      const contentBody = document.getElementById('vfs-content-body');
      const editor = document.getElementById('vfs-editor');
      const editBtn = document.getElementById('vfs-edit-btn');
      const saveBtn = document.getElementById('vfs-save-btn');
      const cancelBtn = document.getElementById('vfs-cancel-btn');

      _isEditing = false;

      if (contentBody) contentBody.classList.remove('hidden');
      if (editor) editor.classList.add('hidden');
      if (editBtn) editBtn.classList.remove('hidden');
      if (saveBtn) saveBtn.classList.add('hidden');
      if (cancelBtn) cancelBtn.classList.add('hidden');
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
