/**
 * Proto Template - HTML template for the main UI
 */

export const renderProtoTemplate = (escapeHtml, goalFromBoot) => `
  <!-- Sidebar Navigation -->
  <nav class="sidebar">
    <button class="sidebar-btn active" data-tab="history" title="Agent Activity (1)">&#x2261;</button>
    <button class="sidebar-btn" data-tab="reflections" title="Reflections (2)">&#x2731;</button>
    <button class="sidebar-btn" data-tab="status" title="Status (3)">&#x2139;</button>
    <button class="sidebar-btn" data-tab="telemetry" title="Telemetry (4)">☡</button>
    <button class="sidebar-btn" data-tab="schemas" title="Schemas (5)">☷</button>
    <button class="sidebar-btn" data-tab="workers" title="Workers" id="workers-tab-btn">&#x2692;</button>
    <button class="sidebar-btn" data-tab="replay" title="Replay (R)">&#x25B6;</button>
    <button class="sidebar-btn" data-tab="debug" title="Debug">⚙</button>
    <div class="sidebar-spacer"></div>
    <button id="btn-toggle" class="sidebar-btn" title="Stop (Esc)">&#x25A0;</button>
    <button id="btn-export" class="sidebar-btn" title="Export (Ctrl+E)">&#x2913;</button>
  </nav>

  <!-- VFS Browser Panel -->
  <aside class="vfs-browser-panel" id="vfs-browser">
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
        <div class="text-muted">Thinking and actions will appear here.</div>
      </div>
      <div id="inline-chat-container"></div>
    </div>

    <div class="workspace-content hidden" id="tab-reflections">
      <div id="reflections-container" class="reflections-stream">
        <div class="text-muted">Insights and learnings will appear here.</div>
      </div>
    </div>

    <div class="workspace-content hidden" id="tab-telemetry">
      <div class="telemetry-panel">
        <div class="telemetry-header">
          <div>
            <strong>Telemetry Timeline</strong>
            <span id="telemetry-count">0 events</span>
          </div>
          <div class="telemetry-controls">
            <label>
              Filter
              <select id="telemetry-filter">
                <option value="all">All</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </label>
            <button id="telemetry-refresh" class="btn btn-sm btn-secondary">Refresh</button>
          </div>
        </div>
        <div id="telemetry-status" class="telemetry-status text-muted">Waiting for telemetry service...</div>
        <div id="telemetry-list" class="telemetry-list">
          <div class="telemetry-empty text-muted">No telemetry events yet</div>
        </div>
      </div>
    </div>

    <div class="workspace-content hidden" id="tab-schemas">
      <div class="schema-panel">
        <div class="schema-header">
          <div>
            <strong>Schema Registry</strong>
            <span id="schema-tool-count">0 tools</span> ·
            <span id="schema-worker-count">0 worker types</span>
          </div>
          <div class="schema-controls">
            <input id="schema-search" class="schema-search" type="text" placeholder="Search tools or worker types..." />
            <button id="schema-refresh" class="btn btn-sm btn-secondary">Refresh</button>
          </div>
        </div>
        <div class="schema-columns">
          <section>
            <h4>Tool Schemas</h4>
            <div id="schema-tool-list" class="schema-list">
              <div class="schema-empty text-muted">Loading...</div>
            </div>
          </section>
          <section>
            <h4>Worker Types</h4>
            <div id="schema-worker-list" class="schema-list">
              <div class="schema-empty text-muted">Loading...</div>
            </div>
          </section>
        </div>
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
        <div class="status-item status-item-models">
          <span class="status-label">Models</span>
          <div id="agent-models" class="status-models-list">-</div>
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

    <div class="workspace-content hidden" id="tab-replay">
      <div class="replay-panel">
        <div class="replay-header">
          <strong>Run Replay</strong>
          <span id="replay-status" class="text-muted">No run loaded</span>
        </div>

        <div class="replay-loader">
          <label class="replay-file-label">
            <input type="file" id="replay-file-input" accept=".json" />
            <span class="btn btn-secondary">Load Run File</span>
          </label>
          <span id="replay-filename" class="text-muted"></span>
        </div>

        <div id="replay-metadata" class="replay-metadata hidden">
          <div class="replay-meta-item">
            <span class="status-label">Exported</span>
            <span id="replay-exported"></span>
          </div>
          <div class="replay-meta-item">
            <span class="status-label">Cycles</span>
            <span id="replay-cycles"></span>
          </div>
          <div class="replay-meta-item">
            <span class="status-label">Events</span>
            <span id="replay-events"></span>
          </div>
          <div class="replay-meta-item">
            <span class="status-label">Files</span>
            <span id="replay-files"></span>
          </div>
        </div>

        <div id="replay-controls" class="replay-controls hidden">
          <div class="replay-progress">
            <div class="replay-progress-bar">
              <div class="replay-progress-fill" id="replay-progress-fill" style="width: 0%"></div>
            </div>
            <span id="replay-progress-text">0 / 0</span>
          </div>

          <div class="replay-buttons">
            <button id="replay-play" class="btn btn-primary" title="Play">▶</button>
            <button id="replay-pause" class="btn btn-secondary" title="Pause" disabled>⏸</button>
            <button id="replay-step" class="btn btn-secondary" title="Step">⏭</button>
            <button id="replay-stop" class="btn btn-secondary" title="Reset">⏹</button>
          </div>

          <div class="replay-speed">
            <span>Speed:</span>
            <select id="replay-speed-select">
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5" selected>5x</option>
              <option value="10">10x</option>
              <option value="50">50x</option>
            </select>
          </div>
        </div>

        <div id="replay-event-log" class="replay-event-log">
          <div class="text-muted">Events will appear here during replay...</div>
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
