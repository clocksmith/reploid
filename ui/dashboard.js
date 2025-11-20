/**
 * @fileoverview Dashboard UI
 * Main user interface for the agent.
 */

const Dashboard = {
  factory: (deps) => {
    const { Utils, EventBus, AgentLoop, StateManager } = deps;
    const { logger, escapeHtml } = Utils;

    // VFS reference for browser
    let _vfs = null;

    // --- DOM Elements ---
    let _root = null;
    let _reflectionsContainer = null;

    // --- Event Handlers ---

    const onReflection = (entry) => {
      if (!_reflectionsContainer) return;
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
      _reflectionsContainer.scrollTop = _reflectionsContainer.scrollHeight;
    };

    const onStateChange = (state) => {
      // Update status values in Agent Status card
      const cycleEl = document.getElementById('agent-cycle');
      const stateEl = document.getElementById('agent-state');
      if (cycleEl) cycleEl.textContent = state.totalCycles || 0;
      if (stateEl) stateEl.textContent = state.fsmState || 'IDLE';
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
          <button class="sidebar-btn active" data-tab="history" title="History">&#x25B6;</button>
          <button class="sidebar-btn" data-tab="reflections" title="Reflections">&#x2731;</button>
          <button class="sidebar-btn" data-tab="status" title="Status">&#x2139;</button>
          <div class="sidebar-spacer"></div>
          <button id="btn-toggle" class="sidebar-btn" title="Stop">&#x25A0;</button>
          <button id="btn-export" class="sidebar-btn" title="Export">&#x2913;</button>
        </nav>

        <!-- Main Workspace -->
        <main class="workspace">
          <div class="workspace-header">
            <div class="workspace-title">
              <span class="text-secondary">Goal:</span>
              <span id="agent-goal">${escapeHtml(goalFromBoot)}</span>
            </div>
            <div class="workspace-status">
              <span class="status-dot status-dot-idle" id="status-indicator"></span>
              <span id="agent-state" class="text-muted">IDLE</span>
              <span class="text-muted">|</span>
              <span class="text-muted">Cycle</span>
              <span id="agent-cycle">0</span>
            </div>
          </div>

          <!-- Tab Panels -->
          <div class="workspace-content" id="tab-history">
            <div id="history-container" class="history-stream">
              <div class="text-muted">Thinking and actions will appear here.</div>
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
            </div>
          </div>
        </main>

        <!-- Utility Panel (VFS Browser) -->
        <aside class="utility-panel">
          <div class="utility-header">
            <span>VFS Browser</span>
            <button id="vfs-refresh" class="btn btn-sm btn-secondary">Refresh</button>
          </div>
          <div id="vfs-tree" class="vfs-tree mono">
            <div class="text-muted">Loading...</div>
          </div>
          <div id="vfs-content" class="vfs-content mono">
            <div class="text-muted">Select a file to view contents</div>
          </div>
        </aside>
      `;

      // Bind Events
      const btnToggle = container.querySelector('#btn-toggle');
      const btnExport = container.querySelector('#btn-export');
      let isRunning = true; // Agent starts automatically on awaken

      // Tab switching
      const tabButtons = container.querySelectorAll('.sidebar-btn[data-tab]');
      tabButtons.forEach(btn => {
        btn.onclick = () => {
          const tabId = btn.dataset.tab;
          // Update button states
          tabButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          // Show/hide panels
          container.querySelectorAll('.workspace-content').forEach(panel => {
            panel.classList.toggle('hidden', panel.id !== `tab-${tabId}`);
          });
        };
      });

      // Set initial button state (Unicode stop symbol)
      btnToggle.innerHTML = '&#x25A0;';
      btnToggle.title = 'Stop';

      btnToggle.onclick = async () => {
        if (isRunning) {
          // Stop
          AgentLoop.stop();
          isRunning = false;
          btnToggle.innerHTML = '&#x25B6;'; // Play symbol
          btnToggle.title = 'Resume';
        } else {
          // Resume
          const goal = localStorage.getItem('REPLOID_GOAL');
          if (!goal) return alert('No goal set. Return to boot screen to set a goal.');

          isRunning = true;
          btnToggle.innerHTML = '&#x25A0;'; // Stop symbol
          btnToggle.title = 'Stop';

          try {
            await AgentLoop.run(goal);
            // Agent finished naturally
            isRunning = false;
            btnToggle.innerHTML = '&#x21BB;'; // Restart symbol
            btnToggle.title = 'Restart';
          } catch (e) {
            logger.error(`Agent Error: ${e.message}`);
            isRunning = false;
            btnToggle.innerHTML = '&#x21BB;'; // Restart symbol
            btnToggle.title = 'Restart';
          }
        }
      };

      btnExport.onclick = async () => {
        try {
          const state = StateManager.getState();
          const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `reploid-state-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          logger.info('State exported');
        } catch (e) {
          logger.error(`Export failed: ${e.message}`);
        }
      };

      _reflectionsContainer = container.querySelector('#reflections-container');

      return container;
    };

    const mount = (target) => {
      _root = target;
      _root.innerHTML = '';
      _root.appendChild(render());

      // Load initial state
      try {
        const state = StateManager.getState();
        onStateChange(state);
      } catch (e) { /* State not ready */ }

      // Subscribe to reflection events
      EventBus.on('reflection:added', (entry) => {
        onReflection(entry);
      });

      // Subscribe to agent status events
      EventBus.on('agent:status', (status) => {
        const stateEl = document.getElementById('agent-state');
        const activityEl = document.getElementById('agent-activity');
        const cycleEl = document.getElementById('agent-cycle');

        if (stateEl && status.state) stateEl.textContent = status.state;
        if (activityEl && status.activity) activityEl.textContent = status.activity;
        if (cycleEl && status.cycle) cycleEl.textContent = status.cycle;
      });

      // Subscribe to streaming events for live feedback
      let streamingEntry = null;
      let streamStartTime = null;
      let tokenCount = 0;

      EventBus.on('agent:stream', (text) => {
        const historyContainer = document.getElementById('history-container');
        if (!historyContainer) return;

        // Create or update streaming entry
        if (!streamingEntry) {
          streamingEntry = document.createElement('div');
          streamingEntry.className = 'history-entry streaming';
          streamingEntry.innerHTML = `
            <div class="history-header">Thinking... <span class="token-stats">0 tokens</span></div>
            <pre class="history-content"></pre>
          `;
          historyContainer.appendChild(streamingEntry);
          streamStartTime = Date.now();
          tokenCount = 0;
        }

        // Estimate tokens (rough: ~4 chars per token)
        tokenCount += Math.ceil(text.length / 4);

        // Update stats
        const elapsed = (Date.now() - streamStartTime) / 1000;
        const tokensPerSec = elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : 0;

        const statsEl = streamingEntry.querySelector('.token-stats');
        if (statsEl) {
          statsEl.textContent = `${tokenCount} tokens • ${tokensPerSec} t/s`;
        }

        const content = streamingEntry.querySelector('.history-content');
        content.textContent += text;
        historyContainer.scrollTop = historyContainer.scrollHeight;
      });

      // Subscribe to history events
      const historyContainer = document.getElementById('history-container');
      EventBus.on('agent:history', (entry) => {
        if (!historyContainer) return;

        // Clear streaming entry when we get the full response
        if (streamingEntry && entry.type === 'llm_response') {
          streamingEntry.remove();
          streamingEntry = null;
          streamStartTime = null;
          tokenCount = 0;
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
          div.innerHTML = `
            <div class="history-header">Act #${entry.cycle} → ${entry.tool}</div>
            <pre class="history-content">${escapeHtml(result)}</pre>
          `;
        }

        historyContainer.appendChild(div);
        historyContainer.scrollTop = historyContainer.scrollHeight;
      });
    };

    // VFS Browser functions
    const loadVFSTree = async () => {
      const treeEl = document.getElementById('vfs-tree');
      if (!treeEl) {
        console.log('[VFS Browser] Tree element not found');
        return;
      }
      if (!_vfs) {
        console.log('[VFS Browser] VFS not set');
        return;
      }

      try {
        // Get all files by listing root - VFS list returns files with prefix
        let files = await _vfs.list('/');
        console.log('[VFS Browser] Found files:', files);

        // If empty, try getting all keys directly
        if (files.length === 0) {
          // Try listing without the trailing slash requirement
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

        if (files.length === 0) {
          treeEl.innerHTML = '<div class="text-muted">VFS is empty</div>';
          return;
        }

        const listHtml = files
          .sort()
          .map(path => {
            const safePath = escapeHtml(path);
            return `<div class="vfs-file" role="button" data-path="${safePath}">${safePath}</div>`;
          })
          .join('');

        treeEl.innerHTML = listHtml || '<div class="text-muted">VFS is empty</div>';

        treeEl.querySelectorAll('.vfs-file').forEach(entry => {
          entry.onclick = () => loadVFSFile(entry.dataset.path);
        });
      } catch (e) {
        treeEl.innerHTML = `<div class="text-danger">Error: ${e.message}</div>`;
      }
    };

    const loadVFSFile = async (path) => {
      const contentEl = document.getElementById('vfs-content');
      if (!contentEl || !_vfs) return;

      try {
        const content = await _vfs.read(path);
        let displayContent = content;

        // Pretty print JSON
        if (path.endsWith('.json')) {
          try {
            displayContent = JSON.stringify(JSON.parse(content), null, 2);
          } catch (e) { /* not valid JSON */ }
        }

        contentEl.innerHTML = `<div class="vfs-file-path">${path}</div><div>${escapeHtml(displayContent)}</div>`;
      } catch (e) {
        contentEl.innerHTML = `<div class="text-danger">Error reading ${path}: ${e.message}</div>`;
      }
    };

    // Set VFS reference
    const setVFS = (vfs) => {
      _vfs = vfs;
      loadVFSTree();
    };

    return { mount, setVFS, refreshVFS: loadVFSTree };
  }
};

export default Dashboard;
