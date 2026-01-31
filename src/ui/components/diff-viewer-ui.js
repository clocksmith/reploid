// Interactive Diff Viewer UI Component for REPLOID Sentinel
// Provides rich diff visualization and interactive approval controls
// PX-3 Enhanced: Prism.js syntax highlighting + detailed statistics
// PHASE 3 UPDATE: Added Event-Driven Rollback capability

const DiffViewerUI = {
  metadata: {
    id: 'DiffViewerUI',
    version: '1.0.0', // Updated for DIUtils
    description: 'Enhanced diff viewer with Prism.js highlighting, stats, and rollback events',
    features: [
      'Prism.js syntax highlighting for 10+ languages',
      'Side-by-side diff with color-coded changes',
      'Detailed per-file statistics (added/removed/modified lines)',
      'Language detection from file extensions',
      'Export to markdown, clipboard, and Web Share API',
      'Event-driven Rollback trigger'
    ],
    dependencies: ['Utils', 'StateManager', 'EventBus', 'ConfirmationModal?'],
    externalDeps: ['Prism'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, StateManager, EventBus, ConfirmationModal } = deps;
    const { logger, escapeHtml } = Utils;

    let container = null;
    let currentDiff = null;

    // Track event listeners for cleanup
    const eventListeners = {
      showDiff: null,
      clearDiff: null
    };

    // Cleanup function to remove event listeners
    const cleanup = () => {
      if (eventListeners.showDiff) {
        EventBus.off('diff:show', eventListeners.showDiff);
        eventListeners.showDiff = null;
      }
      if (eventListeners.clearDiff) {
        EventBus.off('diff:clear', eventListeners.clearDiff);
        eventListeners.clearDiff = null;
      }
    };

    // Initialize the diff viewer
    const init = (containerId) => {
      // Clean up any existing listeners first
      cleanup();

      container = document.getElementById(containerId);
      if (!container) {
        logger.error('[DiffViewerUI] Container not found:', containerId);
        return;
      }

      // Register event listeners and store references
      eventListeners.showDiff = handleShowDiff;
      eventListeners.clearDiff = clearDiff;
      EventBus.on('diff:show', eventListeners.showDiff);
      EventBus.on('diff:clear', eventListeners.clearDiff);

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

        const changes = await parseDogsBundle(dogsContent);
        currentDiff = { changes, dogs_path, session_id, turn };

        renderDiff(changes);

      } catch (error) {
        logger.error('[DiffViewerUI] Error showing diff:', error);
        showError('Failed to load diff');
      }
    };

    // Parse dogs bundle using injected Utils parser
    const parseDogsBundle = async (content) => {
      // Use canonical parser from Utils
      const baseChanges = Utils.parseDogsBundle(content);

      // Enrich with old content and UI state
      const enrichedChanges = [];
      for (const change of baseChanges) {
        let oldContent = '';

        // For MODIFY and DELETE operations, fetch current content
        if (change.operation === 'MODIFY' || change.operation === 'DELETE') {
          try {
            oldContent = await StateManager.getArtifactContent(change.file_path) || '';
          } catch (err) {
            console.error(`Failed to fetch old content for ${change.file_path}:`, err);
            oldContent = '// Error loading original content';
          }
        }

        enrichedChanges.push({
          ...change,
          old_content: oldContent,
          approved: true // Default to approved for smoother workflow
        });
      }

      return enrichedChanges;
    };

    let actionClickHandler = null;

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

          <div class="diff-actions" role="toolbar" aria-label="Diff actions">
            <button class="btn-approve-all" data-action="approve-all" aria-label="Approve all changes">
              ✓ Approve All
            </button>
            <button class="btn-reject-all" data-action="reject-all" aria-label="Reject all changes">
              ✄ Reject All
            </button>
            <button class="btn-edit" data-action="edit" aria-label="edit proposal">
              ✎ edit Proposal
            </button>
            <button class="btn-export" data-action="copy" title="Copy diff to clipboard">
              ⎘ Copy
            </button>
            <button class="btn-export" data-action="export" title="Export as Markdown">
              ⚿ Export
            </button>
          </div>

          <div class="diff-files">
            ${changes.map((change, index) => renderFileChange(change, index)).join('')}
          </div>

          <div class="diff-footer" role="group" aria-label="Apply or cancel changes">
             <button class="btn-rollback" data-action="rollback" aria-label="Emergency Rollback" title="Revert file system to pre-proposal state">
              ☈ Emergency Rollback
            </button>
            <div class="spacer flex-1"></div>
            <button class="btn-cancel" data-action="cancel" aria-label="Cancel and close">
              Cancel
            </button>
            <button class="btn-apply" data-action="apply" aria-label="Apply approved changes">
              Apply Approved Changes
            </button>
          </div>
      </div>
    `;

      container.innerHTML = html;
      bindDiffEvents();

      // Initialize diff rendering for each file
      changes.forEach((change, index) => {
        if (change.operation === 'MODIFY') {
          renderFileDiff(change, index);
        }
      });

      // Setup scroll sync after a short delay to ensure DOM is ready
      setTimeout(setupScrollSync, 100);
    };

    const bindDiffEvents = () => {
      if (!container) return;

      if (actionClickHandler) {
        container.removeEventListener('click', actionClickHandler);
      }

      actionClickHandler = handleActionClick;
      container.addEventListener('click', actionClickHandler);

      const diffFiles = container.querySelector('.diff-files');
      if (diffFiles) {
        diffFiles.addEventListener('click', handleDiffFileClick);
        diffFiles.addEventListener('change', handleApprovalChangeEvent);
      }
    };

    const handleActionClick = (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      const actionMap = {
        'approve-all': approveAll,
        'reject-all': rejectAll,
        'edit': editProposal,
        'copy': () => copyToClipboard(target),
        'export': exportMarkdown,
        'rollback': rollback,
        'cancel': cancel,
        'apply': applyApproved
      };
      const handler = actionMap[target.dataset.action];
      if (handler) {
        handler();
      }
    };

    const handleDiffFileClick = (event) => {
      const expandBtn = event.target.closest('[data-expand]');
      if (!expandBtn) return;
      const index = parseInt(expandBtn.dataset.expand, 10);
      if (!Number.isNaN(index)) {
        toggleExpand(index);
      }
    };

    const handleApprovalChangeEvent = (event) => {
      if (!event.target.classList.contains('approve-checkbox')) return;
      const index = parseInt(event.target.dataset.index, 10);
      if (!Number.isNaN(index)) {
        toggleApproval(index, event.target.checked);
      }
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
        CREATE: '☩',
        MODIFY: '✎',
        DELETE: '✄'
      }[change.operation];

      return `
        <div class="diff-file" data-index="${index}" role="article">
          <div class="diff-file-header" id="diff-header-${index}">
            <div class="diff-file-info">
              <span class="diff-icon" aria-hidden="true">${icon}</span>
              <span class="diff-path">${change.file_path}</span>
              <span class="diff-operation ${change.operation.toLowerCase()}">${change.operation}</span>
            </div>
            <div class="diff-file-actions">
              <label class="checkbox-wrapper">
                <input type="checkbox"
                       class="approve-checkbox"
                       data-index="${index}"
                       ${change.approved ? 'checked' : ''}>
                <span>Approve</span>
              </label>
              <button class="btn-expand" data-expand="${index}">
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
      const language = detectLanguage(change.file_path);

      if (change.operation === 'CREATE') {
        const highlightedCode = highlightCode(change.new_content, language);
        const lines = change.new_content.split('\n').length;
        return `
          <div class="diff-create">
            <div class="diff-stats-summary">
              <span class="diff-stat-item added">+${lines} lines</span>
            </div>
            <pre class="code-block language-${language}"><code>${highlightedCode}</code></pre>
          </div>
        `;
      } else if (change.operation === 'DELETE') {
        const content = change.old_content || 'File will be deleted';
        const highlightedCode = change.old_content ? highlightCode(content, language) : content;
        const lines = change.old_content ? change.old_content.split('\n').length : 0;
        return `
          <div class="diff-delete">
            <div class="diff-stats-summary">
              <span class="diff-stat-item removed">-${lines} lines</span>
            </div>
            <pre class="code-block language-${language}"><code>${highlightedCode}</code></pre>
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
        const oldContent = await StateManager.getArtifactContent(change.file_path) || '';
        const newContent = change.new_content;
        const diffHtml = generateSideBySideDiff(oldContent, newContent, change.file_path);
        container.innerHTML = diffHtml;
      } catch (error) {
        container.innerHTML = '<div class="error">Failed to load diff</div>';
      }
    };

    // Detect language from file path
    const detectLanguage = (filePath) => {
      const ext = filePath.split('.').pop().toLowerCase();
      const langMap = {
        'js': 'javascript', 'ts': 'typescript', 'json': 'json', 'css': 'css', 'html': 'markup', 'py': 'python', 'md': 'markdown'
      };
      return langMap[ext] || 'javascript';
    };

    // Apply syntax highlighting
    const highlightCode = (code, language) => {
      if (typeof Prism === 'undefined' || !Prism.languages[language]) {
        return escapeHtml(code);
      }
      try {
        return Prism.highlight(code, Prism.languages[language], language);
      } catch (err) {
        return escapeHtml(code);
      }
    };

    // LCS-based diff algorithm for proper line matching
    const computeLCS = (oldLines, newLines) => {
      const m = oldLines.length;
      const n = newLines.length;

      // Build LCS table
      const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          if (oldLines[i - 1] === newLines[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1] + 1;
          } else {
            dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
          }
        }
      }

      // Backtrack to find diff operations
      const operations = [];
      let i = m, j = n;

      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
          operations.unshift({ type: 'equal', oldIdx: i - 1, newIdx: j - 1 });
          i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          operations.unshift({ type: 'add', newIdx: j - 1 });
          j--;
        } else {
          operations.unshift({ type: 'remove', oldIdx: i - 1 });
          i--;
        }
      }

      return operations;
    };

    // Calculate detailed diff statistics using LCS
    const calculateDiffStats = (oldContent, newContent) => {
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');
      const ops = computeLCS(oldLines, newLines);

      let added = 0, removed = 0, unchanged = 0;
      for (const op of ops) {
        if (op.type === 'add') added++;
        else if (op.type === 'remove') removed++;
        else unchanged++;
      }

      return { added, removed, modified: 0, unchanged, total: ops.length };
    };

    // Generate side-by-side diff HTML using LCS
    const generateSideBySideDiff = (oldContent, newContent, filePath = '') => {
      const oldLines = oldContent.split('\n');
      const newLines = newContent.split('\n');
      const language = detectLanguage(filePath);
      const ops = computeLCS(oldLines, newLines);
      const stats = calculateDiffStats(oldContent, newContent);

      // Build aligned rows for side-by-side view
      const rows = [];
      for (const op of ops) {
        if (op.type === 'equal') {
          rows.push({
            oldLine: oldLines[op.oldIdx],
            oldNum: op.oldIdx + 1,
            newLine: newLines[op.newIdx],
            newNum: op.newIdx + 1,
            type: 'equal'
          });
        } else if (op.type === 'remove') {
          rows.push({
            oldLine: oldLines[op.oldIdx],
            oldNum: op.oldIdx + 1,
            newLine: null,
            newNum: null,
            type: 'remove'
          });
        } else if (op.type === 'add') {
          rows.push({
            oldLine: null,
            oldNum: null,
            newLine: newLines[op.newIdx],
            newNum: op.newIdx + 1,
            type: 'add'
          });
        }
      }

      // Generate HTML
      const diffId = `diff-${Date.now()}`;
      let html = '<div class="diff-stats-summary">';
      html += `<span class="diff-stat-item added">+${stats.added}</span>`;
      html += `<span class="diff-stat-item removed">-${stats.removed}</span>`;
      html += '</div>';

      html += `<div class="side-by-side-diff" data-diff-id="${diffId}">`;
      html += `<div class="diff-pane diff-old" data-pane="old"><div class="diff-pane-header">Original</div><div class="diff-lines" data-scroll-sync="${diffId}">`;

      for (const row of rows) {
        const lineClass = row.type === 'remove' ? 'removed' : (row.type === 'add' ? 'empty' : '');
        if (row.oldLine !== null) {
          html += `<div class="diff-line ${lineClass}"><span class="line-number">${row.oldNum}</span><span class="line-content">${highlightCode(row.oldLine, language)}</span></div>`;
        } else {
          html += '<div class="diff-line empty"><span class="line-number"></span><span class="line-content">&nbsp;</span></div>';
        }
      }
      html += '</div></div>';

      html += `<div class="diff-pane diff-new" data-pane="new"><div class="diff-pane-header">Modified</div><div class="diff-lines" data-scroll-sync="${diffId}">`;
      for (const row of rows) {
        const lineClass = row.type === 'add' ? 'added' : (row.type === 'remove' ? 'empty' : '');
        if (row.newLine !== null) {
          html += `<div class="diff-line ${lineClass}"><span class="line-number">${row.newNum}</span><span class="line-content">${highlightCode(row.newLine, language)}</span></div>`;
        } else {
          html += '<div class="diff-line empty"><span class="line-number"></span><span class="line-content">&nbsp;</span></div>';
        }
      }
      html += '</div></div></div>';

      // Add scroll sync script
      html += `<script>
        (function() {
          const panes = document.querySelectorAll('[data-scroll-sync="${diffId}"]');
          if (panes.length !== 2) return;
          let syncing = false;
          panes.forEach(pane => {
            pane.addEventListener('scroll', function() {
              if (syncing) return;
              syncing = true;
              const scrollTop = this.scrollTop;
              const scrollLeft = this.scrollLeft;
              panes.forEach(p => {
                if (p !== this) {
                  p.scrollTop = scrollTop;
                  p.scrollLeft = scrollLeft;
                }
              });
              requestAnimationFrame(() => { syncing = false; });
            });
          });
        })();
      </script>`;

      return html;
    };

    // Setup scroll sync for diff panes (called after render)
    const setupScrollSync = () => {
      const diffs = container?.querySelectorAll('.side-by-side-diff');
      diffs?.forEach(diff => {
        const panes = diff.querySelectorAll('.diff-lines');
        if (panes.length !== 2) return;

        let syncing = false;
        panes.forEach(pane => {
          pane.addEventListener('scroll', function() {
            if (syncing) return;
            syncing = true;
            const scrollTop = this.scrollTop;
            const scrollLeft = this.scrollLeft;
            panes.forEach(p => {
              if (p !== this) {
                p.scrollTop = scrollTop;
                p.scrollLeft = scrollLeft;
              }
            });
            requestAnimationFrame(() => { syncing = false; });
          });
        });
      });
    };

    // Toggle file content expansion
    const toggleExpand = (index) => {
      const content = document.getElementById(`diff-content-${index}`);
      if (content) {
        const isExpanded = content.style.display !== 'none';
        content.style.display = isExpanded ? 'none' : 'block';
      }
    };

    // Toggle approval for a change
    const toggleApproval = (index, state = null) => {
      if (currentDiff && currentDiff.changes[index]) {
        currentDiff.changes[index].approved = state === null
          ? !currentDiff.changes[index].approved
          : state;
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

      // Show confirmation dialog
      const changeDetails = approvedChanges.map(c => `${c.operation}: ${c.file_path}`).join('\n');
      
      const confirmed = ConfirmationModal
        ? await ConfirmationModal.confirm({
            title: 'Apply Changes',
            message: `Apply ${approvedChanges.length} approved change${approvedChanges.length > 1 ? 's' : ''}? This will modify your files.`,
            confirmText: 'Apply Changes',
            cancelText: 'Cancel',
            danger: true,
            details: changeDetails
          })
        : confirm(`Apply ${approvedChanges.length} change(s)?\n\n${changeDetails}`);

      if (!confirmed) return;

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

    // edit the proposal
    const editProposal = () => {
      if (!currentDiff) return;
      EventBus.emit('proposal:edit', {
        dogs_path: currentDiff.dogs_path,
        changes: currentDiff.changes
      });
    };

    // Trigger Rollback via EventBus (Decoupled from FSM)
    const rollback = async () => {
        const confirmed = ConfirmationModal
        ? await ConfirmationModal.confirm({
            title: 'Emergency Rollback',
            message: 'Are you sure you want to revert the file system to the state before these changes were proposed?',
            confirmText: 'Rollback',
            cancelText: 'Abort',
            danger: true
          })
        : confirm('Emergency Rollback: Revert file system?');

        if (confirmed) {
            logger.warn('[DiffViewerUI] Triggering manual rollback');
            EventBus.emit('proposal:rollback');
            clearDiff();
        }
    };

    // Cancel the diff viewer
    const cancel = () => {
      EventBus.emit('proposal:cancelled');
      clearDiff();
    };

    // Clear the diff viewer
    const clearDiff = () => {
      if (container) container.innerHTML = '';
      currentDiff = null;
    };

    // Show an error message
    const showError = (message) => {
      if (container) {
        container.innerHTML = `<div class="diff-error"><p>☒ ${message}</p></div>`;
      }
    };

    // Copy diff to clipboard
    const copyToClipboard = async (btn) => {
      if (!currentDiff) return;
      try {
        const markdown = generateDiffMarkdown();
        await navigator.clipboard.writeText(markdown);
        if (btn) {
          const originalText = btn.innerHTML;
          btn.innerHTML = '✓ Copied!';
          setTimeout(() => { btn.innerHTML = originalText; }, 2000);
        }
      } catch (err) {
        logger.error('[DiffViewerUI] Copy failed:', err);
      }
    };

    // Generate diff summary markdown
    const generateDiffMarkdown = () => {
      if (!currentDiff) return '';
      const { changes, dogs_path } = currentDiff;
      let md = `# Diff Summary\nSource: ${dogs_path}\n\n`;
      changes.forEach((change, i) => {
         md += `### ${i+1}. ${change.operation}: ${change.file_path}\n`;
      });
      return md;
    };

    // Export as markdown file
    const exportMarkdown = () => {
      if (!currentDiff) return;
      const markdown = generateDiffMarkdown();
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diff-${Date.now()}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // Export public API
    const publicApi = {
      init,
      showDiff: handleShowDiff,
      clearDiff
    };

    return publicApi;
  }
};

export default DiffViewerUI;
