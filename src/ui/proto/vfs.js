/**
 * Proto VFS - Virtual file system browser functions
 */

export const createVFSManager = (deps) => {
  const { escapeHtml, logger, Toast, EventBus } = deps;

  let _vfs = null;
  let _currentFilePath = null;
  let _isEditing = false;
  let _allFiles = [];
  let _eventBusInitialized = false;

  // Track recently modified files for color coding
  const _recentlyModified = new Map();
  const RECENT_HIGHLIGHT_DURATION = 5000;
  const MAX_VFS_FILES = 500;

  // Initialize EventBus listeners for auto-refresh
  const initEventBusListeners = () => {
    if (_eventBusInitialized || !EventBus) return;
    _eventBusInitialized = true;

    // Auto-refresh on VFS changes
    EventBus.on('vfs:file_changed', (data) => {
      if (data?.path) {
        markFileModified(data.path, data.operation === 'delete' ? 'deleted' : data.operation === 'write' ? 'created' : 'modified');
      }
      loadVFSTree();
    });

    EventBus.on('vfs:updated', () => loadVFSTree());
    EventBus.on('artifact:created', (data) => {
      if (data?.path) markFileModified(data.path, 'created');
      loadVFSTree();
    });
    EventBus.on('artifact:updated', (data) => {
      if (data?.path) markFileModified(data.path, 'modified');
      loadVFSTree();
    });
    EventBus.on('artifact:deleted', (data) => {
      if (data?.path) markFileModified(data.path, 'deleted');
      loadVFSTree();
    });

    logger.debug('[VFSManager] EventBus listeners initialized for auto-refresh');
  };

  const setVFS = (vfs) => {
    _vfs = vfs;
    initEventBusListeners();
    loadVFSTree();
  };

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
        treeEl.innerHTML = '<div class="muted">VFS is empty</div>';
        return;
      }

      renderVFSTree(_allFiles);
    } catch (e) {
      treeEl.innerHTML = `<div class="text-danger">Error: ${e.message}</div>`;
    }
  };

  const renderVFSTree = (files) => {
    const treeEl = document.getElementById('vfs-tree');
    if (!treeEl) return;

    const truncated = files.length > MAX_VFS_FILES;
    const displayFiles = truncated ? files.slice(0, MAX_VFS_FILES) : files;

    // Group by directory
    const tree = {};
    displayFiles.forEach(path => {
      const parts = path.split('/').filter(p => p);
      let current = tree;
      parts.forEach((part, i) => {
        if (i === parts.length - 1) {
          current[part] = path;
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
          const modInfo = _recentlyModified.get(value);
          let modClass = '';
          let modIndicator = '';
          if (modInfo) {
            if (modInfo.type === 'created') {
              modClass = 'vfs-file-created';
              modIndicator = ' +';
            } else if (modInfo.type === 'deleted') {
              modClass = 'vfs-file-deleted';
              modIndicator = ' ×';
            } else {
              modClass = 'vfs-file-modified';
              modIndicator = ' ~';
            }
          }
          // Add selected class if this is the current file
          const selectedClass = value === _currentFilePath ? 'selected' : '';
          html += `
            <div class="vfs-file ${modClass} ${selectedClass}" role="button" data-path="${safePath}" style="padding-left: ${padding + 16}px">
              ${escapeHtml(name)}${modIndicator}
            </div>
          `;
        }
      });

      return html;
    };

    let treeHtml = renderNode(tree);

    if (truncated) {
      treeHtml += `<div class="vfs-truncated muted p-sm type-caption">
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

    if (!vfsContent || !contentBody || !_vfs) {
      logger.warn('[VFSManager] Cannot load file - missing elements or VFS');
      return;
    }

    const previousPath = _currentFilePath;
    _currentFilePath = path;
    cancelEditing();
    closePreview();
    closeDiff();
    closeSnapshots();

    // Re-render tree to update selected state
    if (previousPath !== path) {
      renderVFSTree(_allFiles);
    }

    // Hide all other workspace tabs and show VFS content
    const container = document.querySelector('.app-shell');
    if (container) {
      container.querySelectorAll('.workspace-content').forEach(panel => {
        panel.classList.add('hidden');
      });
      vfsContent.classList.remove('hidden');
    } else {
      vfsContent.classList.remove('hidden');
    }

    try {
      const content = await _vfs.read(path);
      let displayContent = content;

      if (path.endsWith('.json')) {
        try {
          displayContent = JSON.stringify(JSON.parse(content), null, 2);
        } catch (e) { /* not valid JSON */ }
      }

      if (contentHeader) contentHeader.classList.remove('hidden');
      if (pathEl) pathEl.textContent = path;
      contentBody.innerHTML = `<pre>${escapeHtml(displayContent)}</pre>`;

      const previewBtn = document.getElementById('vfs-preview-btn');
      if (previewBtn && (path.endsWith('.html') || path.endsWith('.htm') || path.endsWith('.js') || path.endsWith('.css'))) {
        previewBtn.classList.remove('hidden');
      } else if (previewBtn) {
        previewBtn.classList.add('hidden');
      }

      const stat = await _vfs.stat(path);
      if (stat && pathEl) {
        const size = stat.size > 1024 ? `${(stat.size / 1024).toFixed(1)}KB` : `${stat.size}B`;
        const updated = new Date(stat.updated).toLocaleString();
        pathEl.title = `Size: ${size} | Modified: ${updated}`;
      }
    } catch (e) {
      logger.error('[VFSManager] Error reading file:', path, e);
      if (contentHeader) contentHeader.classList.remove('hidden');
      if (pathEl) pathEl.textContent = path;
      contentBody.innerHTML = `<div class="text-danger">Error reading ${escapeHtml(path)}: ${escapeHtml(e.message)}</div>`;
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
      if (Toast) Toast.success('File Saved', `${_currentFilePath} saved successfully`);
      cancelEditing();
      loadVFSFile(_currentFilePath);
    } catch (e) {
      if (Toast) Toast.info('Save Failed', e.message);
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

  const markFileModified = (path, type = 'modified') => {
    _recentlyModified.set(path, { timestamp: Date.now(), type });
    setTimeout(() => {
      _recentlyModified.delete(path);
      loadVFSTree();
    }, RECENT_HIGHLIGHT_DURATION);
    loadVFSTree();
  };

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

      iframe.onload = () => URL.revokeObjectURL(url);
    } catch (e) {
      if (Toast) Toast.info('Preview Failed', e.message);
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

  const closeDiff = () => {
    const diffPanel = document.getElementById('vfs-diff-panel');
    const contentBody = document.getElementById('vfs-content-body');

    if (diffPanel) diffPanel.classList.add('hidden');
    if (contentBody) contentBody.classList.remove('hidden');
  };

  const closeSnapshots = () => {
    const snapshotPanel = document.getElementById('vfs-snapshot-panel');
    const contentBody = document.getElementById('vfs-content-body');

    if (snapshotPanel) snapshotPanel.classList.add('hidden');
    if (contentBody) contentBody.classList.remove('hidden');
  };

  return {
    setVFS,
    loadVFSTree,
    filterVFSTree,
    loadVFSFile,
    startEditing,
    saveFile,
    cancelEditing,
    markFileModified,
    showPreview,
    closePreview,
    closeDiff,
    closeSnapshots,
    getCurrentPath: () => _currentFilePath
  };
};
