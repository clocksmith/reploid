// VFS Explorer Module for REPLOID
// Enhanced file tree with search, expand/collapse, and file viewer

const VFSExplorer = {
  metadata: {
    id: 'VFSExplorer',
    version: '2.0.0',
    dependencies: ['Utils', 'EventBus', 'VFS', 'ToastNotifications'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS, ToastNotifications } = deps;
    const { logger, escapeHtml } = Utils;

    const BASELINE_KEY = 'REPLOID_VFS_BASELINE';

    class Explorer {
      constructor() {
        this.expanded = new Set(['/']); // Track expanded folders
        this.selectedFile = null;
        this.selectedFiles = new Set(); // Multi-select support
        this.searchTerm = '';
        this.container = null;
        this.fileViewerModal = null;
        this.contextMenu = null;
        this.baseline = null; // Genesis baseline for state tracking
        this.editMode = false; // Track if currently editing
        this.sortBy = 'name'; // 'name', 'size', 'date', 'type'
        this.sortAsc = true;
      }

      async init(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
          logger.error(`[VFSExplorer] Container not found: ${containerId}`);
          return;
        }

        // Load or create baseline
        await this.loadBaseline();

        // Create context menu element
        this.createContextMenu();

        await this.render();

        // Listen for VFS changes
        EventBus.on('vfs:updated', () => this.render());
        EventBus.on('vfs:file_changed', () => this.render());
        EventBus.on('artifact:created', () => this.render());
        EventBus.on('artifact:updated', () => this.render());
        EventBus.on('artifact:deleted', () => this.render());

        // Close context menu on click outside
        document.addEventListener('click', () => this.hideContextMenu());
      }

      /**
       * Create the context menu element
       */
      createContextMenu() {
        if (this.contextMenu) return;
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'vfs-context-menu';
        this.contextMenu.style.cssText = `
          position: fixed;
          display: none;
          background: var(--bg);
          border: var(--border-md) solid var(--fg);
          min-width: 150px;
          z-index: 10000;
          padding: 4px 0;
        `;
        document.body.appendChild(this.contextMenu);
      }

      /**
       * Show context menu at position
       */
      showContextMenu(x, y, path, type) {
        if (!this.contextMenu) return;

        const isFile = type === 'file';
        const isDeleted = this.container.querySelector(`[data-path="${path}"]`)?.dataset.state === 'deleted';

        let menuItems = [];

        if (isFile && !isDeleted) {
          menuItems = [
            { label: '✎ Edit', action: () => this.editFile(path) },
            { label: '☷ Copy', action: () => this.copyFile(path) },
            { label: '↗ Rename', action: () => this.renameFile(path) },
            { label: '↪ Move', action: () => this.moveFile(path) },
            { label: '☓ Delete', action: () => this.deleteFile(path), danger: true }
          ];
        } else if (isFile && isDeleted) {
          menuItems = [
            { label: '↶ Restore', action: () => this.restoreFile(path) }
          ];
        } else {
          // Folder
          menuItems = [
            { label: '☐ New File', action: () => this.createNewFile(path) },
            { label: '☗ New Folder', action: () => this.createNewFolder(path) },
            { label: '↗ Rename', action: () => this.renameFolder(path) },
            { label: '☓ Delete', action: () => this.deleteFolder(path), danger: true }
          ];
        }

        this.contextMenu.innerHTML = menuItems.map(item => `
          <div class="vfs-context-item ${item.danger ? 'border-error' : ''} cursor-pointer"
               data-action="${item.label}">
            ${item.label}
          </div>
        `).join('');

        // Attach click handlers
        this.contextMenu.querySelectorAll('.vfs-context-item').forEach((el, i) => {
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            menuItems[i].action();
            this.hideContextMenu();
          });
          el.addEventListener('mouseenter', () => {
            el.classList.add('inverted');
          });
          el.addEventListener('mouseleave', () => {
            el.classList.remove('inverted');
          });
        });

        // Position menu
        this.contextMenu.style.left = `${x}px`;
        this.contextMenu.style.top = `${y}px`;
        this.contextMenu.style.display = 'block';

        // Adjust if overflowing viewport
        const rect = this.contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
          this.contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
          this.contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
      }

      hideContextMenu() {
        if (this.contextMenu) {
          this.contextMenu.style.display = 'none';
        }
      }

      /**
       * File operations
       */
      async editFile(path) {
        await this.showFileViewer(path, true); // Open in edit mode
      }

      async copyFile(path) {
        try {
          const content = await VFS.read(path);
          await navigator.clipboard.writeText(content);
          logger.info(`[VFSExplorer] Copied ${path} to clipboard`);
          if (ToastNotifications) ToastNotifications.success('Copied to clipboard');
        } catch (err) {
          logger.error(`[VFSExplorer] Copy failed:`, err);
          if (ToastNotifications) ToastNotifications.error('Failed to copy');
        }
      }

      async renameFile(path) {
        const fileName = path.split('/').pop();
        const newName = prompt('Enter new name:', fileName);
        if (!newName || newName === fileName) return;

        const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
        const newPath = `${parentPath}/${newName}`;

        try {
          const content = await VFS.read(path);
          await VFS.write(newPath, content);
          await VFS.delete(path);
          logger.info(`[VFSExplorer] Renamed ${path} to ${newPath}`);
          if (ToastNotifications) ToastNotifications.success(`Renamed to ${newName}`);
          EventBus.emit('vfs:file_changed', { oldPath: path, newPath });
        } catch (err) {
          logger.error(`[VFSExplorer] Rename failed:`, err);
          if (ToastNotifications) ToastNotifications.error('Failed to rename file');
        }
      }

      async moveFile(path) {
        const newPath = prompt('Enter destination path:', path);
        if (!newPath || newPath === path) return;

        try {
          const content = await VFS.read(path);
          await VFS.write(newPath, content);
          await VFS.delete(path);
          logger.info(`[VFSExplorer] Moved ${path} to ${newPath}`);
          if (ToastNotifications) ToastNotifications.success(`Moved to ${newPath}`);
          EventBus.emit('vfs:file_changed', { oldPath: path, newPath });
        } catch (err) {
          logger.error(`[VFSExplorer] Move failed:`, err);
          if (ToastNotifications) ToastNotifications.error('Failed to move file');
        }
      }

      async deleteFile(path) {
        if (!confirm(`Delete ${path}?`)) return;

        try {
          await VFS.delete(path);
          logger.info(`[VFSExplorer] Deleted ${path}`);
          if (ToastNotifications) ToastNotifications.success('File deleted');
          EventBus.emit('vfs:file_changed', { path, deleted: true });
        } catch (err) {
          logger.error(`[VFSExplorer] Delete failed:`, err);
          if (ToastNotifications) ToastNotifications.error('Failed to delete file');
        }
      }

      async restoreFile(path) {
        // Restore from baseline if available
        if (!this.baseline?.files[path]) {
          if (ToastNotifications) ToastNotifications.error('No baseline data to restore from');
          return;
        }
        if (ToastNotifications) ToastNotifications.info('Restore requires GenesisSnapshot integration');
        logger.info(`[VFSExplorer] Restore for ${path} - requires GenesisSnapshot`);
      }

      async createNewFile(folderPath) {
        const fileName = prompt('Enter file name:');
        if (!fileName) return;

        const newPath = folderPath ? `${folderPath}/${fileName}` : `/${fileName}`;

        try {
          await VFS.write(newPath, '');
          logger.info(`[VFSExplorer] Created file ${newPath}`);
          if (ToastNotifications) ToastNotifications.success(`Created ${fileName}`);
          this.expanded.add(folderPath);
          await this.showFileViewer(newPath, true); // Open in edit mode
        } catch (err) {
          logger.error(`[VFSExplorer] Create file failed:`, err);
          if (ToastNotifications) ToastNotifications.error('Failed to create file');
        }
      }

      async createNewFolder(parentPath) {
        const folderName = prompt('Enter folder name:');
        if (!folderName) return;

        const newPath = parentPath ? `${parentPath}/${folderName}` : `/${folderName}`;
        const placeholderPath = `${newPath}/.gitkeep`;

        try {
          await VFS.write(placeholderPath, '');
          logger.info(`[VFSExplorer] Created folder ${newPath}`);
          if (ToastNotifications) ToastNotifications.success(`Created folder ${folderName}`);
          this.expanded.add(newPath);
          this.render();
        } catch (err) {
          logger.error(`[VFSExplorer] Create folder failed:`, err);
          if (ToastNotifications) ToastNotifications.error('Failed to create folder');
        }
      }

      async renameFolder(path) {
        const folderName = path.split('/').filter(p => p).pop();
        const newName = prompt('Enter new folder name:', folderName);
        if (!newName || newName === folderName) return;

        // This requires moving all files in the folder
        if (ToastNotifications) ToastNotifications.info('Folder rename requires moving all contents');
        logger.info(`[VFSExplorer] Folder rename for ${path} - requires batch operations`);
      }

      async deleteFolder(path) {
        if (!confirm(`Delete folder ${path} and all contents?`)) return;

        try {
          const allPaths = await VFS.list(path);
          for (const filePath of allPaths) {
            await VFS.delete(filePath);
          }
          logger.info(`[VFSExplorer] Deleted folder ${path} (${allPaths.length} files)`);
          if (ToastNotifications) ToastNotifications.success(`Deleted folder with ${allPaths.length} files`);
          this.expanded.delete(path);
          this.render();
        } catch (err) {
          logger.error(`[VFSExplorer] Delete folder failed:`, err);
          if (ToastNotifications) ToastNotifications.error('Failed to delete folder');
        }
      }

      /**
       * Load baseline from localStorage or create one
       */
      async loadBaseline() {
        try {
          const stored = localStorage.getItem(BASELINE_KEY);
          if (stored) {
            this.baseline = JSON.parse(stored);
            logger.debug(`[VFSExplorer] Loaded baseline with ${Object.keys(this.baseline.files).length} files`);
          }
        } catch (e) {
          logger.warn('[VFSExplorer] Could not load baseline:', e.message);
        }
      }

      /**
       * Create a new baseline snapshot (call at genesis)
       */
      async createBaseline() {
        try {
          const allMeta = await this.getAllFileMetadata();
          this.baseline = {
            timestamp: Date.now(),
            files: {}
          };
          for (const path in allMeta) {
            this.baseline.files[path] = {
              size: allMeta[path].size,
              updated: allMeta[path].updated
            };
          }
          localStorage.setItem(BASELINE_KEY, JSON.stringify(this.baseline));
          logger.info(`[VFSExplorer] Created baseline with ${Object.keys(this.baseline.files).length} files`);
          return this.baseline;
        } catch (e) {
          logger.error('[VFSExplorer] Failed to create baseline:', e.message);
          return null;
        }
      }

      /**
       * Get all file metadata from VFS
       */
      async getAllFileMetadata() {
        const allPaths = await VFS.list('/');
        const metadata = {};
        for (const path of allPaths) {
          try {
            const stat = await VFS.stat(path);
            if (stat && stat.type === 'file') {
              metadata[path] = stat;
            }
          } catch (e) {
            // Skip files we can't stat
          }
        }
        return metadata;
      }

      /**
       * Get file state relative to baseline
       */
      getFileState(path, currentMeta) {
        if (!this.baseline) return null;

        const baselineFile = this.baseline.files[path];

        if (!baselineFile) {
          return 'created'; // New file since genesis
        }

        if (currentMeta.updated > baselineFile.updated || currentMeta.size !== baselineFile.size) {
          return 'modified'; // Modified since genesis
        }

        return null; // Unchanged
      }

      async render() {
        if (!this.container) return;

        const allMeta = await this.getAllFileMetadata();

        // Add state info based on baseline comparison
        for (const path in allMeta) {
          allMeta[path].state = this.getFileState(path, allMeta[path]);
        }

        // Check for deleted files (in baseline but not in current)
        if (this.baseline) {
          for (const path in this.baseline.files) {
            if (!allMeta[path]) {
              allMeta[path] = {
                size: this.baseline.files[path].size,
                state: 'deleted',
                type: 'file'
              };
            }
          }
        }

        const tree = this.buildTree(allMeta);

        const selectedCount = this.selectedFiles.size;
        const selectionInfo = selectedCount > 0 ? ` | ${selectedCount} selected` : '';

        this.container.innerHTML = `
          <div class="vfs-explorer">
            <div class="vfs-toolbar" role="toolbar" aria-label="File explorer controls">
              <input type="text"
                     class="vfs-search"
                     placeholder="⚲ Search files..."
                     value="${escapeHtml(this.searchTerm)}"
                     aria-label="Search files"
                     role="searchbox">
              <select class="vfs-sort" aria-label="Sort by">
                <option value="name" ${this.sortBy === 'name' ? 'selected' : ''}>Name</option>
                <option value="size" ${this.sortBy === 'size' ? 'selected' : ''}>Size</option>
                <option value="date" ${this.sortBy === 'date' ? 'selected' : ''}>Date</option>
                <option value="type" ${this.sortBy === 'type' ? 'selected' : ''}>Type</option>
              </select>
              <button class="vfs-sort-dir" title="Sort direction" aria-label="Toggle sort direction">${this.sortAsc ? '↑' : '↓'}</button>
              <button class="vfs-collapse-all" title="Collapse All" aria-label="Collapse all folders">⊟</button>
              <button class="vfs-expand-all" title="Expand All" aria-label="Expand all folders">⊞</button>
              <button class="vfs-new-file" title="New File" aria-label="Create new file">☐+</button>
            </div>
            <div class="vfs-tree" role="tree" aria-label="File tree">${this.renderTree(tree)}</div>
            <div class="vfs-stats" role="status" aria-live="polite">
              ${Object.keys(allMeta).length} files${selectionInfo}
            </div>
          </div>
        `;

        this.attachEventListeners();
      }

      buildTree(allMeta) {
        const tree = {
          name: 'root',
          path: '',
          type: 'folder',
          children: []
        };

        for (const path in allMeta) {
          const parts = path.split('/').filter(p => p);
          let current = tree;

          parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;

            if (isLast) {
              // File node
              current.children.push({
                name: part,
                path: path,
                type: 'file',
                size: allMeta[path].size || 0,
                metadata: allMeta[path]
              });
            } else {
              // Folder node
              let folder = current.children.find(c => c.name === part && c.type === 'folder');
              if (!folder) {
                folder = {
                  name: part,
                  path: parts.slice(0, index + 1).join('/'),
                  type: 'folder',
                  children: []
                };
                current.children.push(folder);
              }
              current = folder;
            }
          });
        }

        // Sort: folders first, then files by configured sort field
        const sortChildren = (node) => {
          if (node.children) {
            node.children.sort((a, b) => {
              // Folders always first
              if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
              }

              let result = 0;
              switch (this.sortBy) {
                case 'size':
                  result = (a.size || 0) - (b.size || 0);
                  break;
                case 'date':
                  const aDate = a.metadata?.updated || 0;
                  const bDate = b.metadata?.updated || 0;
                  result = aDate - bDate;
                  break;
                case 'type':
                  const aExt = a.name.split('.').pop() || '';
                  const bExt = b.name.split('.').pop() || '';
                  result = aExt.localeCompare(bExt);
                  break;
                case 'name':
                default:
                  result = a.name.localeCompare(b.name);
              }
              return this.sortAsc ? result : -result;
            });
            node.children.forEach(sortChildren);
          }
        };
        sortChildren(tree);

        return tree;
      }

      renderTree(node, depth = 0) {
        if (!node.children || node.children.length === 0) {
          return '';
        }

        const filteredChildren = this.searchTerm
          ? node.children.filter(child => this.matchesSearch(child))
          : node.children;

        return filteredChildren.map(child => {
          if (child.type === 'file') {
            return this.renderFile(child, depth);
          } else {
            return this.renderFolder(child, depth);
          }
        }).join('');
      }

      renderFile(node, depth) {
        const icon = this.getFileIcon(node.path);
        const selected = node.path === this.selectedFile ? 'selected' : '';
        const multiSelected = this.selectedFiles.has(node.path) ? 'multi-selected' : '';
        const highlight = this.searchTerm && node.name.toLowerCase().includes(this.searchTerm.toLowerCase())
          ? 'highlight' : '';

        // File state classes based on metadata
        const fileState = this.getFileStateClass(node.metadata);
        const stateIcon = this.getFileStateIcon(node.metadata);

        return `
          <div class="vfs-item vfs-file ${selected} ${multiSelected} ${highlight} ${fileState}"
               data-path="${escapeHtml(node.path)}"
               data-type="file"
               data-state="${node.metadata?.state || 'unchanged'}"
               role="treeitem"
               aria-selected="${selected || multiSelected ? 'true' : 'false'}"
               aria-label="${escapeHtml(node.name)} (${this.formatSize(node.size)})${stateIcon ? ' - ' + node.metadata?.state : ''}"
               tabindex="${selected ? '0' : '-1'}"
               style="padding-left:${depth * 20 + 20}px${multiSelected ? '; background: rgba(100, 149, 237, 0.2);' : ''}">
            ${multiSelected ? '<span class="vfs-checkbox" aria-hidden="true">☑</span>' : ''}
            <span class="vfs-icon" aria-hidden="true">${icon}</span>
            <span class="vfs-name">${escapeHtml(node.name)}</span>
            ${stateIcon ? `<span class="vfs-state-icon" title="${node.metadata?.state || ''}">${stateIcon}</span>` : ''}
            <span class="vfs-size">${this.formatSize(node.size)}</span>
          </div>
        `;
      }

      getFileStateClass(metadata) {
        if (!metadata?.state) return '';
        switch (metadata.state) {
          case 'created': return 'vfs-file-created';
          case 'modified': return 'vfs-file-modified';
          case 'deleted': return 'vfs-file-deleted';
          default: return '';
        }
      }

      getFileStateIcon(metadata) {
        if (!metadata?.state) return '';
        switch (metadata.state) {
          case 'created': return '+';
          case 'modified': return '~';
          case 'deleted': return '×';
          default: return '';
        }
      }

      renderFolder(node, depth) {
        const isExpanded = this.expanded.has(node.path) || this.searchTerm !== '';
        const icon = isExpanded ? '☗' : '☗';
        const expandIcon = isExpanded ? '▼' : '☇';

        const childrenHtml = isExpanded ? this.renderTree(node, depth + 1) : '';
        const fileCount = this.countFiles(node);

        return `
          <div class="vfs-folder" role="group">
            <div class="vfs-item vfs-folder-header"
                 data-path="${escapeHtml(node.path)}"
                 data-type="folder"
                 role="treeitem"
                 aria-expanded="${isExpanded}"
                 aria-label="${escapeHtml(node.name)} folder (${fileCount} items)"
                 tabindex="0"
                 style="padding-left:${depth * 20 + 20}px">
              <span class="vfs-expand" aria-hidden="true">${expandIcon}</span>
              <span class="vfs-icon" aria-hidden="true">${icon}</span>
              <span class="vfs-name">${escapeHtml(node.name)}</span>
              <span class="vfs-count" aria-hidden="true">(${fileCount})</span>
            </div>
            <div class="vfs-children ${isExpanded ? 'expanded' : 'collapsed'}" role="group">
              ${childrenHtml}
            </div>
          </div>
        `;
      }

      countFiles(node) {
        if (node.type === 'file') return 1;
        if (!node.children) return 0;
        return node.children.reduce((sum, child) => sum + this.countFiles(child), 0);
      }

      getFileIcon(path) {
        const ext = path.split('.').pop().toLowerCase();
        const iconMap = {
          'js': 'ƒ',
          'json': '☷',
          'md': '☐',
          'css': '☲',
          'html': '☊',
          'txt': '☐',
          'yml': '⎈',
          'yaml': '⎈',
          'xml': '☐',
          'svg': '☻',
          'png': '☻',
          'jpg': '☻',
          'jpeg': '☻',
          'gif': '☻',
          'pdf': '☙',
          'zip': '⛝',
          'tar': '⛝',
          'gz': '⛝'
        };
        return iconMap[ext] || '☐';
      }

      formatSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
      }

      matchesSearch(node) {
        if (!this.searchTerm) return true;
        const term = this.searchTerm.toLowerCase();

        // Search in name and path
        if (node.name.toLowerCase().includes(term)) return true;
        if (node.path.toLowerCase().includes(term)) return true;

        // Search in children
        if (node.children) {
          return node.children.some(child => this.matchesSearch(child));
        }

        return false;
      }

      attachEventListeners() {
        // Search input
        const searchInput = this.container.querySelector('.vfs-search');
        if (searchInput) {
          searchInput.addEventListener('input', (e) => {
            this.searchTerm = e.target.value;
            this.render();
          });

          // Keyboard shortcuts: Ctrl+F or Cmd+F to focus search
          document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) {
              const explorerVisible = this.container && this.container.offsetParent !== null;
              if (explorerVisible) {
                e.preventDefault();
                searchInput.focus();
              }
            }
            // ESC to clear search
            if (e.key === 'Escape' && document.activeElement === searchInput && this.searchTerm) {
              e.preventDefault();
              this.searchTerm = '';
              searchInput.value = '';
              this.render();
            }
          });
        }

        // Collapse all button
        const collapseBtn = this.container.querySelector('.vfs-collapse-all');
        if (collapseBtn) {
          collapseBtn.addEventListener('click', () => {
            this.expanded.clear();
            this.render();
          });
        }

        // Expand all button
        const expandBtn = this.container.querySelector('.vfs-expand-all');
        if (expandBtn) {
          expandBtn.addEventListener('click', async () => {
            const allMeta = await this.getAllFileMetadata();
            const tree = this.buildTree(allMeta);
            this.expandAll(tree);
            this.render();
          });
        }

        // Sort select
        const sortSelect = this.container.querySelector('.vfs-sort');
        if (sortSelect) {
          sortSelect.addEventListener('change', (e) => {
            this.sortBy = e.target.value;
            this.render();
          });
        }

        // Sort direction toggle
        const sortDirBtn = this.container.querySelector('.vfs-sort-dir');
        if (sortDirBtn) {
          sortDirBtn.addEventListener('click', () => {
            this.sortAsc = !this.sortAsc;
            this.render();
          });
        }

        // New file button
        const newFileBtn = this.container.querySelector('.vfs-new-file');
        if (newFileBtn) {
          newFileBtn.addEventListener('click', () => {
            this.createNewFile('/');
          });
        }

        // Folder click handlers
        this.container.querySelectorAll('.vfs-folder-header').forEach(header => {
          header.addEventListener('click', (e) => {
            e.stopPropagation();
            const path = header.dataset.path;
            if (this.expanded.has(path)) {
              this.expanded.delete(path);
            } else {
              this.expanded.add(path);
            }
            this.render();
          });

          // Right-click context menu for folders
          header.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const path = header.dataset.path;
            this.showContextMenu(e.clientX, e.clientY, path, 'folder');
          });

          // Keyboard navigation: Enter/Space to toggle folder
          header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              const path = header.dataset.path;
              if (this.expanded.has(path)) {
                this.expanded.delete(path);
              } else {
                this.expanded.add(path);
              }
              this.render();
            }
          });
        });

        // File click handlers
        this.container.querySelectorAll('.vfs-file').forEach(fileItem => {
          fileItem.addEventListener('click', async (e) => {
            e.stopPropagation();
            const path = fileItem.dataset.path;

            // Multi-select with Ctrl/Cmd
            if (e.ctrlKey || e.metaKey) {
              if (this.selectedFiles.has(path)) {
                this.selectedFiles.delete(path);
              } else {
                this.selectedFiles.add(path);
              }
              this.selectedFile = path;
              this.render();
              return;
            }

            // Clear multi-select on regular click
            this.selectedFiles.clear();
            this.selectedFile = path;
            await this.showFileViewer(path);
            this.render();
          });

          // Right-click context menu for files
          fileItem.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const path = fileItem.dataset.path;
            this.selectedFile = path;
            this.showContextMenu(e.clientX, e.clientY, path, 'file');
          });

          // Keyboard navigation: Enter to open file
          fileItem.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const path = fileItem.dataset.path;
              this.selectedFile = path;
              await this.showFileViewer(path);
              this.render();
            }
            // Delete key to delete selected file
            if (e.key === 'Delete' || e.key === 'Backspace') {
              e.preventDefault();
              const path = fileItem.dataset.path;
              await this.deleteFile(path);
            }
          });
        });
      }

      expandAll(node) {
        if (node.type === 'folder') {
          this.expanded.add(node.path);
          if (node.children) {
            node.children.forEach(child => this.expandAll(child));
          }
        }
      }

      async showFileViewer(path, editMode = false) {
        try {
          const content = await VFS.read(path);
          const metadata = await VFS.stat(path);

          // Create modal if it doesn't exist
          if (!this.fileViewerModal) {
            this.fileViewerModal = document.createElement('div');
            this.fileViewerModal.className = 'vfs-file-viewer-modal';
            document.body.appendChild(this.fileViewerModal);
          }

          const language = this.getLanguageFromPath(path);
          this.editMode = editMode;

          // Build body content based on mode
          const bodyContent = editMode
            ? `<textarea class="vfs-editor" spellcheck="false" style="
                width: 100%;
                height: 100%;
                background: var(--bg);
                color: var(--fg);
                border: none;
                font-family: var(--font-a);
                font-size: 13px;
                line-height: 1.5;
                padding: var(--space-md);
                resize: none;
                outline: none;
                tab-size: 2;
              ">${escapeHtml(content || '')}</textarea>`
            : `<pre><code class="language-${language}">${escapeHtml(content || '')}</code></pre>`;

          // Build footer buttons based on mode
          const footerButtons = editMode
            ? `<button class="vfs-file-viewer-save btn-primary">✓ Save</button>
               <button class="vfs-file-viewer-cancel">☓ Cancel</button>`
            : `<button class="vfs-file-viewer-copy">☷ Copy</button>
               <button class="vfs-file-viewer-history">☐ History</button>
               <button class="vfs-file-viewer-edit">✎ Edit</button>`;

          this.fileViewerModal.innerHTML = `
            <div class="vfs-file-viewer-overlay"></div>
            <div class="vfs-file-viewer-content">
              <div class="vfs-file-viewer-header">
                <div class="vfs-file-viewer-title">
                  <span class="vfs-icon">${this.getFileIcon(path)}</span>
                  <span>${escapeHtml(path)}</span>
                  ${editMode ? '<span class="muted" style="margin-left: 8px; border-bottom: var(--border-sm) dashed var(--fg);">[Editing]</span>' : ''}
                </div>
                <button class="vfs-file-viewer-close">☩</button>
              </div>
              <div class="vfs-file-viewer-meta">
                Type: ${metadata?.type || 'unknown'} |
                Size: ${this.formatSize(content?.length || 0)} |
                Lines: ${(content || '').split('\n').length}
              </div>
              <div class="vfs-file-viewer-body">
                ${bodyContent}
              </div>
              <div class="vfs-file-viewer-footer">
                ${footerButtons}
              </div>
            </div>
          `;

          this.fileViewerModal.style.display = 'flex';

          // Focus editor if in edit mode
          if (editMode) {
            const editor = this.fileViewerModal.querySelector('.vfs-editor');
            if (editor) {
              setTimeout(() => editor.focus(), 100);

              // Handle Tab key for indentation
              editor.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                  e.preventDefault();
                  const start = editor.selectionStart;
                  const end = editor.selectionEnd;
                  editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
                  editor.selectionStart = editor.selectionEnd = start + 2;
                }
                // Ctrl/Cmd+S to save
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault();
                  this.fileViewerModal.querySelector('.vfs-file-viewer-save')?.click();
                }
              });
            }
          }

          // Close button
          this.fileViewerModal.querySelector('.vfs-file-viewer-close').addEventListener('click', () => {
            this.closeFileViewer();
          });

          // Overlay click to close
          this.fileViewerModal.querySelector('.vfs-file-viewer-overlay').addEventListener('click', () => {
            this.closeFileViewer();
          });

          // Edit mode buttons
          if (editMode) {
            this.fileViewerModal.querySelector('.vfs-file-viewer-save')?.addEventListener('click', async () => {
              const editor = this.fileViewerModal.querySelector('.vfs-editor');
              if (editor) {
                try {
                  await VFS.write(path, editor.value);
                  logger.info(`[VFSExplorer] Saved ${path}`);
                  if (ToastNotifications) ToastNotifications.success('File saved');
                  EventBus.emit('vfs:file_changed', { path });
                  this.editMode = false;
                  await this.showFileViewer(path, false); // Switch back to view mode
                } catch (err) {
                  logger.error(`[VFSExplorer] Save failed:`, err);
                  if (ToastNotifications) ToastNotifications.error('Failed to save file');
                }
              }
            });

            this.fileViewerModal.querySelector('.vfs-file-viewer-cancel')?.addEventListener('click', () => {
              this.editMode = false;
              this.showFileViewer(path, false); // Switch back to view mode
            });
          } else {
            // View mode buttons
            this.fileViewerModal.querySelector('.vfs-file-viewer-copy')?.addEventListener('click', async (e) => {
              try {
                await navigator.clipboard.writeText(content);
                logger.info(`[VFSExplorer] Copied ${path} to clipboard`);

                // Visual feedback
                const btn = e.target;
                const originalText = btn.innerHTML;
                btn.innerHTML = '✓ Copied!';
                btn.style.background = 'rgba(76, 175, 80, 0.3)';
                setTimeout(() => {
                  btn.innerHTML = originalText;
                  btn.style.background = '';
                }, 2000);
              } catch (err) {
                logger.error(`[VFSExplorer] Failed to copy to clipboard:`, err);
                if (ToastNotifications) ToastNotifications.error('Failed to copy to clipboard');
              }
            });

            this.fileViewerModal.querySelector('.vfs-file-viewer-history')?.addEventListener('click', async () => {
              logger.info(`[VFSExplorer] History for ${path} - feature requires GenesisSnapshot integration`);
              if (ToastNotifications) ToastNotifications.info('File history available via GenesisSnapshot module');
            });

            this.fileViewerModal.querySelector('.vfs-file-viewer-edit')?.addEventListener('click', () => {
              this.showFileViewer(path, true); // Switch to edit mode
            });
          }

          // ESC key to close (with unsaved changes warning in edit mode)
          const handleEsc = (e) => {
            if (e.key === 'Escape' && this.fileViewerModal.style.display === 'flex') {
              this.closeFileViewer();
              document.removeEventListener('keydown', handleEsc);
            }
          };
          document.addEventListener('keydown', handleEsc);

        } catch (error) {
          logger.error(`[VFSExplorer] Failed to load file ${path}:`, error);
          if (ToastNotifications) ToastNotifications.error(`Failed to load file: ${error.message}`);
        }
      }

      closeFileViewer() {
        if (this.editMode) {
          const editor = this.fileViewerModal?.querySelector('.vfs-editor');
          if (editor && editor.value !== editor.defaultValue) {
            if (!confirm('Discard unsaved changes?')) return;
          }
        }
        this.editMode = false;
        if (this.fileViewerModal) {
          this.fileViewerModal.style.display = 'none';
        }
      }

      getLanguageFromPath(path) {
        const ext = path.split('.').pop().toLowerCase();
        const langMap = {
          'js': 'javascript',
          'json': 'json',
          'md': 'markdown',
          'css': 'css',
          'html': 'html',
          'txt': 'text',
          'yml': 'yaml',
          'yaml': 'yaml',
          'xml': 'xml',
          'py': 'python',
          'rb': 'ruby',
          'java': 'java',
          'go': 'go',
          'rs': 'rust',
          'c': 'c',
          'cpp': 'cpp',
          'sh': 'bash'
        };
        return langMap[ext] || 'text';
      }

    }

    const explorer = new Explorer();

    return {
      api: {
        init: (containerId) => explorer.init(containerId),
        render: () => explorer.render(),
        setSearchTerm: (term) => {
          explorer.searchTerm = term;
          explorer.render();
        },
        expandPath: (path) => {
          explorer.expanded.add(path);
          explorer.render();
        },
        collapsePath: (path) => {
          explorer.expanded.delete(path);
          explorer.render();
        },
        selectFile: (path) => {
          explorer.selectedFile = path;
          explorer.showFileViewer(path);
        },
        // File operations
        editFile: (path) => explorer.editFile(path),
        createFile: (folderPath) => explorer.createNewFile(folderPath),
        createFolder: (parentPath) => explorer.createNewFolder(parentPath),
        deleteFile: (path) => explorer.deleteFile(path),
        deleteFolder: (path) => explorer.deleteFolder(path),
        renameFile: (path) => explorer.renameFile(path),
        moveFile: (path) => explorer.moveFile(path),
        copyFileToClipboard: (path) => explorer.copyFile(path),
        // Multi-select
        getSelectedFiles: () => Array.from(explorer.selectedFiles),
        clearSelection: () => {
          explorer.selectedFiles.clear();
          explorer.selectedFile = null;
          explorer.render();
        },
        selectMultiple: (paths) => {
          paths.forEach(p => explorer.selectedFiles.add(p));
          explorer.render();
        },
        // Sorting
        setSortBy: (field, ascending = true) => {
          explorer.sortBy = field;
          explorer.sortAsc = ascending;
          explorer.render();
        },
        // Baseline management for file state tracking
        createBaseline: () => explorer.createBaseline(),
        hasBaseline: () => !!explorer.baseline,
        clearBaseline: () => {
          explorer.baseline = null;
          localStorage.removeItem(BASELINE_KEY);
          explorer.render();
        }
      }
    };
  }
};

// Export
export default VFSExplorer;
