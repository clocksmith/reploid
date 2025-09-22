// Interactive Diff Viewer UI Component for REPLOID Sentinel
// Provides rich diff visualization and interactive approval controls

const DiffViewerUI = {
  metadata: {
    id: 'DiffViewerUI',
    version: '1.0.0',
    dependencies: ['Utils', 'StateManager', 'EventBus'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, StateManager, EventBus } = deps;
    const { logger } = Utils;

    let container = null;
    let currentDiff = null;
    let approvalCallbacks = {};

    // Initialize the diff viewer
    const init = (containerId) => {
      container = document.getElementById(containerId);
      if (!container) {
        logger.error('[DiffViewerUI] Container not found:', containerId);
        return;
      }

      // Add styles if not already present
      if (!document.getElementById('diff-viewer-styles')) {
        const styles = document.createElement('style');
        styles.id = 'diff-viewer-styles';
        styles.innerHTML = getDiffViewerStyles();
        document.head.appendChild(styles);
      }

      // Listen for diff display events
      EventBus.on('diff:show', handleShowDiff);
      EventBus.on('diff:clear', clearDiff);

      logger.info('[DiffViewerUI] Initialized');
    };

    // Handle showing a diff
    const handleShowDiff = async (data) => {
      const { dogs_path, session_id, turn } = data;

      try {
        // Load and parse the dogs bundle
        const dogsContent = await StateManager.getArtifactContent(dogs_path);
        if (!dogsContent) {
          showError('Dogs bundle not found');
          return;
        }

        const changes = parseDogsBundle(dogsContent);
        currentDiff = { changes, dogs_path, session_id, turn };

        renderDiff(changes);

      } catch (error) {
        logger.error('[DiffViewerUI] Error showing diff:', error);
        showError('Failed to load diff');
      }
    };

    // Parse dogs bundle (matching sentinel-tools format)
    const parseDogsBundle = (content) => {
      const changes = [];
      const blocks = content.split('```paws-change');

      for (let i = 1; i < blocks.length; i++) {
        const block = blocks[i];
        const metaEnd = block.indexOf('```');
        if (metaEnd === -1) continue;

        const meta = block.substring(0, metaEnd).trim();
        const operation = meta.match(/operation:\s*(\w+)/)?.[1];
        const filePath = meta.match(/file_path:\s*(.+)/)?.[1]?.trim();

        if (!operation || !filePath) continue;

        let newContent = '';
        let oldContent = '';

        if (operation !== 'DELETE') {
          const contentStart = block.indexOf('```', metaEnd + 3);
          if (contentStart !== -1) {
            const actualStart = contentStart + 3;
            if (block[actualStart] === '\n') actualStart++;
            const contentEnd = block.indexOf('```', actualStart);
            if (contentEnd !== -1) {
              newContent = block.substring(actualStart, contentEnd);
            }
          }
        }

        // For MODIFY operations, fetch current content
        if (operation === 'MODIFY') {
          StateManager.getArtifactContent(filePath).then(content => {
            oldContent = content || '';
          });
        }

        changes.push({
          operation,
          file_path: filePath,
          old_content: oldContent,
          new_content: newContent,
          approved: false
        });
      }

      return changes;
    };

    // Render the diff viewer
    const renderDiff = (changes) => {
      if (!container) return;

      const html = `
        <div class="diff-viewer">
          <div class="diff-header">
            <h3>Review Proposed Changes</h3>
            <div class="diff-stats">
              ${getChangeStats(changes)}
            </div>
          </div>

          <div class="diff-actions">
            <button class="btn-approve-all" onclick="DiffViewerUI.approveAll()">
              ✓ Approve All
            </button>
            <button class="btn-reject-all" onclick="DiffViewerUI.rejectAll()">
              ✗ Reject All
            </button>
            <button class="btn-edit" onclick="DiffViewerUI.editProposal()">
              ✎ Edit Proposal
            </button>
          </div>

          <div class="diff-files">
            ${changes.map((change, index) => renderFileChange(change, index)).join('')}
          </div>

          <div class="diff-footer">
            <button class="btn-apply" onclick="DiffViewerUI.applyApproved()">
              Apply Approved Changes
            </button>
            <button class="btn-cancel" onclick="DiffViewerUI.cancel()">
              Cancel
            </button>
          </div>
        </div>
      `;

      container.innerHTML = html;

      // Initialize diff rendering for each file
      changes.forEach((change, index) => {
        if (change.operation === 'MODIFY') {
          renderFileDiff(change, index);
        }
      });
    };

    // Get change statistics
    const getChangeStats = (changes) => {
      const stats = { CREATE: 0, MODIFY: 0, DELETE: 0 };
      changes.forEach(c => stats[c.operation]++);

      return `
        <span class="stat-create">+${stats.CREATE} new</span>
        <span class="stat-modify">~${stats.MODIFY} modified</span>
        <span class="stat-delete">-${stats.DELETE} deleted</span>
      `;
    };

    // Render a single file change
    const renderFileChange = (change, index) => {
      const icon = {
        CREATE: '➕',
        MODIFY: '✏️',
        DELETE: '🗑️'
      }[change.operation];

      return `
        <div class="diff-file" data-index="${index}">
          <div class="diff-file-header">
            <div class="diff-file-info">
              <span class="diff-icon">${icon}</span>
              <span class="diff-path">${change.file_path}</span>
              <span class="diff-operation ${change.operation.toLowerCase()}">${change.operation}</span>
            </div>
            <div class="diff-file-actions">
              <label class="checkbox-wrapper">
                <input type="checkbox"
                       class="approve-checkbox"
                       data-index="${index}"
                       onchange="DiffViewerUI.toggleApproval(${index})"
                       ${change.approved ? 'checked' : ''}>
                <span>Approve</span>
              </label>
              <button class="btn-expand" onclick="DiffViewerUI.toggleExpand(${index})">
                ${change.operation === 'DELETE' ? 'View' : 'Expand'}
              </button>
            </div>
          </div>
          <div class="diff-file-content" id="diff-content-${index}" style="display: none;">
            ${renderChangeContent(change, index)}
          </div>
        </div>
      `;
    };

    // Render the content of a change
    const renderChangeContent = (change, index) => {
      if (change.operation === 'CREATE') {
        return `
          <div class="diff-create">
            <pre class="code-block">${escapeHtml(change.new_content)}</pre>
          </div>
        `;
      } else if (change.operation === 'DELETE') {
        return `
          <div class="diff-delete">
            <pre class="code-block">${escapeHtml(change.old_content || 'File will be deleted')}</pre>
          </div>
        `;
      } else if (change.operation === 'MODIFY') {
        return `<div class="diff-modify" id="diff-modify-${index}">Loading diff...</div>`;
      }
    };

    // Render a file diff for MODIFY operations
    const renderFileDiff = async (change, index) => {
      const container = document.getElementById(`diff-modify-${index}`);
      if (!container) return;

      try {
        // Get current content
        const oldContent = await StateManager.getArtifactContent(change.file_path) || '';
        const newContent = change.new_content;

        // Generate side-by-side diff
        const diffHtml = generateSideBySideDiff(oldContent, newContent);
        container.innerHTML = diffHtml;

      } catch (error) {
        container.innerHTML = '<div class="error">Failed to load diff</div>';
      }
    };

    // Generate side-by-side diff HTML
    const generateSideBySideDiff = (oldContent, newContent) => {
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');
      const maxLines = Math.max(oldLines.length, newLines.length);

      let html = '<div class="side-by-side-diff">';
      html += '<div class="diff-pane diff-old"><div class="diff-pane-header">Original</div>';
      html += '<div class="diff-lines">';

      for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        const hasChange = oldLine !== newLine;

        if (oldLine !== undefined) {
          html += `<div class="diff-line ${hasChange ? 'changed' : ''}">`;
          html += `<span class="line-number">${i + 1}</span>`;
          html += `<span class="line-content">${escapeHtml(oldLine)}</span>`;
          html += '</div>';
        } else {
          html += '<div class="diff-line empty">&nbsp;</div>';
        }
      }

      html += '</div></div>';
      html += '<div class="diff-pane diff-new"><div class="diff-pane-header">Modified</div>';
      html += '<div class="diff-lines">';

      for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        const hasChange = oldLine !== newLine;

        if (newLine !== undefined) {
          html += `<div class="diff-line ${hasChange ? 'changed' : ''}">`;
          html += `<span class="line-number">${i + 1}</span>`;
          html += `<span class="line-content">${escapeHtml(newLine)}</span>`;
          html += '</div>';
        } else {
          html += '<div class="diff-line empty">&nbsp;</div>';
        }
      }

      html += '</div></div>';
      html += '</div>';

      return html;
    };

    // Toggle file content expansion
    const toggleExpand = (index) => {
      const content = document.getElementById(`diff-content-${index}`);
      if (content) {
        content.style.display = content.style.display === 'none' ? 'block' : 'none';
      }
    };

    // Toggle approval for a change
    const toggleApproval = (index) => {
      if (currentDiff && currentDiff.changes[index]) {
        currentDiff.changes[index].approved = !currentDiff.changes[index].approved;
        updateApprovalStats();
      }
    };

    // Approve all changes
    const approveAll = () => {
      if (currentDiff) {
        currentDiff.changes.forEach(c => c.approved = true);
        document.querySelectorAll('.approve-checkbox').forEach(cb => cb.checked = true);
        updateApprovalStats();
      }
    };

    // Reject all changes
    const rejectAll = () => {
      if (currentDiff) {
        currentDiff.changes.forEach(c => c.approved = false);
        document.querySelectorAll('.approve-checkbox').forEach(cb => cb.checked = false);
        updateApprovalStats();
      }
    };

    // Update approval statistics
    const updateApprovalStats = () => {
      const approved = currentDiff.changes.filter(c => c.approved).length;
      const total = currentDiff.changes.length;

      const applyBtn = document.querySelector('.btn-apply');
      if (applyBtn) {
        applyBtn.textContent = `Apply ${approved}/${total} Approved Changes`;
        applyBtn.disabled = approved === 0;
      }
    };

    // Apply approved changes
    const applyApproved = async () => {
      if (!currentDiff) return;

      const approvedChanges = currentDiff.changes.filter(c => c.approved);
      if (approvedChanges.length === 0) {
        showError('No changes approved');
        return;
      }

      // Create a new dogs bundle with only approved changes
      const filteredDogsPath = currentDiff.dogs_path.replace('.md', '-filtered.md');

      EventBus.emit('proposal:approved', {
        original_dogs_path: currentDiff.dogs_path,
        filtered_dogs_path: filteredDogsPath,
        approved_changes: approvedChanges,
        session_id: currentDiff.session_id,
        turn: currentDiff.turn
      });

      clearDiff();
    };

    // Edit the proposal
    const editProposal = () => {
      if (!currentDiff) return;

      // Open an editor for the changes
      EventBus.emit('proposal:edit', {
        dogs_path: currentDiff.dogs_path,
        changes: currentDiff.changes
      });
    };

    // Cancel the diff viewer
    const cancel = () => {
      EventBus.emit('proposal:cancelled');
      clearDiff();
    };

    // Clear the diff viewer
    const clearDiff = () => {
      if (container) {
        container.innerHTML = '';
      }
      currentDiff = null;
    };

    // Show an error message
    const showError = (message) => {
      if (container) {
        container.innerHTML = `
          <div class="diff-error">
            <p>❌ ${message}</p>
          </div>
        `;
      }
    };

    // Escape HTML for safe display
    const escapeHtml = (text) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    // Get CSS styles for the diff viewer
    const getDiffViewerStyles = () => {
      return `
        .diff-viewer {
          background: #1e1e1e;
          border: 1px solid #333;
          border-radius: 8px;
          color: #d4d4d4;
          font-family: 'Monaco', 'Menlo', monospace;
          padding: 16px;
        }

        .diff-header {
          border-bottom: 1px solid #333;
          margin-bottom: 16px;
          padding-bottom: 12px;
        }

        .diff-header h3 {
          margin: 0 0 8px 0;
          color: #fff;
        }

        .diff-stats span {
          margin-right: 16px;
        }

        .stat-create { color: #4ec9b0; }
        .stat-modify { color: #ffd700; }
        .stat-delete { color: #f48771; }

        .diff-actions {
          display: flex;
          gap: 8px;
          margin-bottom: 16px;
        }

        .diff-actions button,
        .diff-footer button {
          background: #0e639c;
          border: none;
          border-radius: 4px;
          color: #fff;
          cursor: pointer;
          padding: 8px 16px;
          transition: background 0.2s;
        }

        .diff-actions button:hover,
        .diff-footer button:hover {
          background: #1177bb;
        }

        .btn-reject-all {
          background: #f48771 !important;
        }

        .btn-edit {
          background: #ffd700 !important;
          color: #000 !important;
        }

        .diff-file {
          background: #2d2d30;
          border-radius: 4px;
          margin-bottom: 8px;
          overflow: hidden;
        }

        .diff-file-header {
          align-items: center;
          background: #252526;
          display: flex;
          justify-content: space-between;
          padding: 12px;
        }

        .diff-file-info {
          align-items: center;
          display: flex;
          gap: 12px;
        }

        .diff-icon {
          font-size: 18px;
        }

        .diff-path {
          color: #4ec9b0;
          font-weight: 500;
        }

        .diff-operation {
          background: #333;
          border-radius: 4px;
          font-size: 12px;
          padding: 2px 8px;
          text-transform: uppercase;
        }

        .diff-operation.create { background: #4ec9b0; color: #000; }
        .diff-operation.modify { background: #ffd700; color: #000; }
        .diff-operation.delete { background: #f48771; color: #000; }

        .diff-file-actions {
          display: flex;
          gap: 12px;
        }

        .checkbox-wrapper {
          align-items: center;
          display: flex;
          gap: 4px;
        }

        .btn-expand {
          background: transparent;
          border: 1px solid #555;
          border-radius: 4px;
          color: #d4d4d4;
          cursor: pointer;
          padding: 4px 12px;
        }

        .diff-file-content {
          border-top: 1px solid #333;
          max-height: 600px;
          overflow: auto;
          padding: 12px;
        }

        .code-block {
          background: #1e1e1e;
          border-radius: 4px;
          font-size: 13px;
          line-height: 1.5;
          margin: 0;
          overflow-x: auto;
          padding: 12px;
          white-space: pre;
        }

        .side-by-side-diff {
          display: flex;
          gap: 2px;
        }

        .diff-pane {
          flex: 1;
          overflow-x: auto;
        }

        .diff-pane-header {
          background: #333;
          font-weight: bold;
          padding: 8px;
          text-align: center;
        }

        .diff-lines {
          background: #1e1e1e;
        }

        .diff-line {
          display: flex;
          min-height: 20px;
        }

        .diff-line.changed {
          background: rgba(255, 215, 0, 0.1);
        }

        .diff-line.empty {
          background: #252526;
        }

        .line-number {
          background: #252526;
          color: #858585;
          padding: 0 8px;
          text-align: right;
          user-select: none;
          width: 50px;
        }

        .line-content {
          flex: 1;
          padding: 0 8px;
          white-space: pre;
        }

        .diff-footer {
          border-top: 1px solid #333;
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 16px;
          padding-top: 12px;
        }

        .btn-apply:disabled {
          background: #555 !important;
          cursor: not-allowed;
          opacity: 0.5;
        }

        .diff-error {
          background: rgba(244, 135, 113, 0.1);
          border: 1px solid #f48771;
          border-radius: 4px;
          color: #f48771;
          padding: 16px;
          text-align: center;
        }
      `;
    };

    // Export public API
    return {
      init,
      api: {
        toggleExpand,
        toggleApproval,
        approveAll,
        rejectAll,
        applyApproved,
        editProposal,
        cancel,
        showDiff: handleShowDiff,
        clearDiff
      }
    };
  }
};

// Register module and expose global API for onclick handlers
if (typeof window !== 'undefined') {
  if (window.ModuleRegistry) {
    window.ModuleRegistry.register(DiffViewerUI);
  }

  // Expose API for HTML onclick handlers
  window.DiffViewerUI = {
    toggleExpand: (index) => DiffViewerUI.factory({}).api.toggleExpand(index),
    toggleApproval: (index) => DiffViewerUI.factory({}).api.toggleApproval(index),
    approveAll: () => DiffViewerUI.factory({}).api.approveAll(),
    rejectAll: () => DiffViewerUI.factory({}).api.rejectAll(),
    applyApproved: () => DiffViewerUI.factory({}).api.applyApproved(),
    editProposal: () => DiffViewerUI.factory({}).api.editProposal(),
    cancel: () => DiffViewerUI.factory({}).api.cancel()
  };
}

export default DiffViewerUI;