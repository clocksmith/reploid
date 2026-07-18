/**
 * Proto Template - HTML template for the main UI
 */

export const renderProtoTemplate = (escapeHtml, goalFromBoot) => `
  <!-- Sidebar Navigation -->
  <nav class="sidebar">
    <button class="sidebar-btn active" data-tab="timeline" title="Timeline (1)">
      <span class="sidebar-icon">≡</span>
      <span class="tab-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <button class="sidebar-btn" data-tab="tools" title="Tools (2)">
      <span class="sidebar-icon">☇</span>
      <span class="tab-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <button class="sidebar-btn" data-tab="memory" title="Memory (3)">
      <span class="sidebar-icon">◇</span>
      <span class="tab-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <button class="sidebar-btn" data-tab="cognition" title="Cognition (4)">
      <span class="sidebar-icon">☍</span>
      <span class="tab-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <button class="sidebar-btn" data-tab="status" title="Status (5)">
      <span class="sidebar-icon">◎</span>
      <span class="tab-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <button class="sidebar-btn" data-tab="telemetry" title="Telemetry (6)">
      <span class="sidebar-icon">∿</span>
      <span class="tab-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <button id="optimization-tab-btn" class="sidebar-btn" data-tab="optimization" title="Optimization (7)">
      <span class="sidebar-icon">☫</span>
      <span class="tab-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <button id="workers-tab-btn" class="sidebar-btn" data-tab="workers" title="Workers (8)">
      <span class="sidebar-icon">☌</span>
      <span class="tab-indicator" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <div class="sidebar-spacer"></div>
    <button id="btn-replay" class="sidebar-btn" title="Replay"><span class="sidebar-icon">↻</span></button>
    <button id="btn-toggle" class="sidebar-btn" title="Stop (Esc)"><span class="sidebar-icon">■</span></button>
    <button id="btn-export" class="sidebar-btn" title="Export (Ctrl+E)"><span class="sidebar-icon">⤓</span></button>
  </nav>

  <!-- Main Workspace -->
  <main class="workspace">
    <div class="workspace-header">
      <div class="workspace-title">
        <span class="text-secondary">Goal:</span>
        <span id="agent-goal" class="goal-text muted">${escapeHtml(goalFromBoot || 'No goal set')}</span>
      </div>
      <div class="workspace-status">
        <div class="token-budget" title="Token Budget">
          <div class="token-budget-bar">
            <div class="token-budget-fill low" id="token-budget-fill" style="width: 0%"></div>
          </div>
          <span class="token-budget-text" id="token-budget-text">0k / 32k</span>
        </div>
        <span class="muted">|</span>
        <span id="agent-state" class="muted">IDLE</span>
        <span class="muted">|</span>
        <span class="muted">Cycle</span>
        <span id="agent-cycle">0</span>
        <span class="muted">|</span>
        <div id="worker-indicator" class="workspace-indicator" title="Active Workers">
          <span id="worker-indicator-count">0</span> workers
        </div>
        <span class="muted">|</span>
      </div>
    </div>

    <!-- Progress Bar for Long Operations -->
    <div id="progress-container" class="hidden">
      <div class="progress-bar" id="progress-bar">
        <div class="progress-bar-fill" id="progress-fill" style="width: 0%"></div>
      </div>
      <div class="muted type-caption" style="margin-top: 4px; text-align: center;">
        <span id="progress-text"></span>
      </div>
    </div>

    <!-- Tab Panels -->
    <div class="workspace-content workspace-columns" id="workspace-columns">
      <div class="workspace-content" id="tab-timeline">
        <div id="history-container" class="history-stream">
          <div id="history-placeholder" class="muted">Thinking and actions will appear here.</div>
        </div>
        <div id="inline-chat-container"></div>
      </div>

      <div class="workspace-content hidden" id="tab-tools">
        <div class="tools-panel">
          <div class="tools-header">
            <strong>Tool Executions</strong>
            <span id="tools-count" class="muted">0 entries</span>
          </div>
          <div id="tools-list" class="tools-list">
            <div class="muted">No tool executions yet</div>
          </div>
        </div>
      </div>

      <div class="workspace-content hidden" id="tab-telemetry">
        <div class="telemetry-page">
          <div class="telemetry-page-header">
            <strong>Telemetry Timeline</strong>
            <span id="telemetry-count" class="muted">0 events</span>
          </div>
          <div class="telemetry-panel">
            <div class="telemetry-header">
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
                <button id="telemetry-refresh" class="btn btn-small">Refresh</button>
              </div>
            </div>
            <div id="telemetry-status" class="telemetry-status muted">Waiting for telemetry service...</div>
            <div id="telemetry-list" class="telemetry-list">
              <div class="telemetry-empty muted">No telemetry events yet</div>
            </div>
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
            <span class="status-label">Cycle</span>
            <span id="agent-cycle-detail" class="status-value">0</span>
          </div>
          <div class="status-item">
            <span class="status-label">Token Usage</span>
            <span id="agent-tokens" class="status-value">0 / 32000</span>
          </div>
          <div class="status-item">
            <span class="status-label">Token Window</span>
            <span id="agent-token-window" class="status-value">0%</span>
          </div>
          <div class="status-item">
            <span class="status-label">Model</span>
            <span id="agent-model" class="status-value">-</span>
          </div>
          <div class="status-item">
            <span class="status-label">Compactions</span>
            <span id="agent-compactions" class="status-value">0</span>
          </div>
          <div class="status-item">
            <span class="status-label">Last Compaction</span>
            <span id="agent-last-compaction" class="status-value">-</span>
          </div>
          <div class="status-item">
            <span class="status-label">Errors / Warnings</span>
            <span id="agent-errors" class="status-value">0</span>
          </div>
        </div>
      </div>

      <div class="workspace-content hidden" id="tab-memory">
        <div class="memory-panel">
          <div class="memory-header">
            <strong>Memory</strong>
            <span id="memory-summary-meta" class="muted">-</span>
          </div>
          <div class="memory-summary">
            <div class="memory-section-header">Current Summary</div>
            <pre id="memory-summary" class="memory-block">No summary yet</pre>
          </div>
          <div class="memory-columns">
            <section class="memory-section">
              <div class="memory-section-header">Compactions</div>
              <div id="memory-compactions" class="memory-list">
                <div class="muted">No compactions yet</div>
              </div>
            </section>
            <section class="memory-section">
              <div class="memory-section-header">Retrievals</div>
              <div id="memory-retrievals" class="memory-list">
                <div class="muted">No retrievals yet</div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div class="workspace-content hidden" id="tab-cognition">
        <div id="cognition-panel" class="cognition-panel"></div>
      </div>

      <div class="workspace-content hidden" id="tab-optimization">
        <div class="optimization-panel">
          <div class="optimization-header">
            <div class="optimization-toolbar">
              <strong>Runtime Optimization</strong>
              <span id="optimization-status" class="muted">IDLE</span>
              <span class="muted">|</span>
              <span id="optimization-active-profile" class="muted">Active: base</span>
            </div>
            <div class="optimization-run-controls">
              <select id="optimization-runs" aria-label="Optimization runs" disabled>
                <option value="">No runs</option>
              </select>
              <button id="optimization-refresh" class="btn btn-small" title="Refresh" aria-label="Refresh">♺</button>
              <button id="optimization-run" class="btn btn-primary">Run</button>
              <button id="optimization-stop" class="btn btn-small" title="Stop" aria-label="Stop" disabled>■</button>
            </div>
          </div>

          <div class="optimization-contract-wrap">
            <label for="optimization-contract">
              <span>Contract</span>
              <span class="muted">JSON</span>
            </label>
            <textarea id="optimization-contract" spellcheck="false"></textarea>
            <div id="optimization-contract-error" class="muted" role="status"></div>
          </div>

          <div class="optimization-results">
            <div class="optimization-section-label">
              <span>Candidates</span>
              <span class="muted">Median | 95% CI | CV</span>
            </div>
            <div class="optimization-table-wrap">
              <table class="optimization-table">
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Patch</th>
                    <th>Verdict</th>
                    <th>Median</th>
                    <th>95% CI</th>
                    <th>CV</th>
                  </tr>
                </thead>
                <tbody id="optimization-candidates">
                  <tr><td colspan="6" class="muted">No run selected</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="optimization-detail">
            <div class="optimization-section-label">
              <span>Receipt</span>
              <button id="optimization-promote" class="btn btn-small" disabled>Promote</button>
            </div>
            <pre id="optimization-candidate-detail">Select a completed candidate.</pre>
          </div>
        </div>
      </div>

      <div class="workspace-content hidden" id="tab-workers">
        <div class="workers-panel">
          <div class="workers-summary">
            <div class="workers-summary-item">
              <span>Active Workers</span>
              <strong id="workers-active-count">0</strong>
            </div>
            <div class="workers-summary-item">
              <span>Completed Workers</span>
              <strong id="workers-completed-count">0</strong>
            </div>
          </div>

          <div class="workers-panel-header">
            <strong>Active Workers List</strong>
          </div>
          <div id="workers-active-list" class="workers-list">
            <div class="empty-state">No active workers</div>
          </div>
          <div class="workers-panel-header" style="margin-top: 24px;">
            <strong>Completed Workers List</strong>
          </div>
          <div id="workers-completed-list" class="workers-list">
            <div class="empty-state">No completed workers yet</div>
          </div>
          <div class="workers-footer" style="margin-top: 16px; display: flex; justify-content: space-between; align-items: center;">
            <span id="workers-last-update" class="muted">Last updated: -</span>
            <button id="workers-clear-completed" class="btn btn-small">Clear Completed</button>
          </div>
        </div>
      </div>

      <!-- VFS Browser Panel -->
      <div id="vfs-browser" class="vfs-panel">
        <div class="vfs-search-container">
          <input type="text" id="vfs-search" class="vfs-search-input" placeholder="Search VFS..." />
        </div>
        <div id="vfs-tree" class="vfs-tree"></div>
        <div id="vfs-content" class="vfs-content hidden">
          <div id="vfs-content-header" class="vfs-content-header">
            <span id="vfs-current-path" class="vfs-file-path"></span>
            <div class="vfs-content-actions">
              <button id="vfs-preview-btn" class="btn btn-small">Preview</button>
              <button id="vfs-edit-btn" class="btn btn-small">Edit</button>
              <button id="vfs-save-btn" class="btn btn-small hidden">Save</button>
              <button id="vfs-cancel-btn" class="btn btn-small hidden">Cancel</button>
            </div>
          </div>
          <div id="vfs-content-body" class="vfs-content-body">
            <pre></pre>
          </div>
          <textarea id="vfs-editor" class="vfs-editor hidden"></textarea>
          <div id="vfs-preview-panel" class="vfs-preview-panel hidden">
            <iframe id="vfs-preview-iframe"></iframe>
          </div>
          <div id="vfs-diff-panel" class="vfs-diff-panel hidden"></div>
          <div id="vfs-snapshot-panel" class="vfs-snapshot-panel hidden"></div>
        </div>
      </div>
    </div>



    <div id="replay-modal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="replay-modal-title">
      <div class="modal-content replay-modal">
        <div class="modal-header">
          <h3 class="modal-title" id="replay-modal-title">Run Replay</h3>
          <button id="replay-modal-close" class="modal-close" aria-label="Close">x</button>
        </div>
        <div class="modal-body">
          <div class="replay-panel">
            <div class="replay-header">
              <span class="type-caption">Status</span>
              <span id="replay-status" class="muted">No run loaded</span>
            </div>

            <div class="replay-loader">
              <label class="replay-file-label">
                <input type="file" id="replay-file-input" accept=".json" />
                <span class="btn">Load Run File</span>
              </label>
              <span id="replay-filename" class="muted"></span>
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
                <button id="replay-play" class="btn btn-primary" title="Play">Play</button>
                <button id="replay-pause" class="btn" title="Pause" disabled>Pause</button>
                <button id="replay-step" class="btn" title="Step">Step</button>
                <button id="replay-stop" class="btn" title="Reset">Reset</button>
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
              <div class="muted">Events will appear here during replay...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>
`;
