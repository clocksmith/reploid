// VFS Explorer Module for REPLOID
// Enhanced file tree with search, expand/collapse, and file viewer

const VFSExplorer = {
  metadata: {
    id: 'VFSExplorer',
    version: '1.1.0',
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
        this.searchTerm = '';
        this.container = null;
        this.fileViewerModal = null;
        this.baseline = null; // Genesis baseline for state tracking
      }

      async init(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
          logger.error(`[VFSExplorer] Container not found: ${containerId}`);
          return;
        }

        // Load or create baseline
        await this.loadBaseline();

        await this.render();

        // Listen for VFS changes
        EventBus.on('vfs:updated', () => this.render());
        EventBus.on('vfs:file_changed', () => this.render());
        EventBus.on('artifact:created', () => this.render());
        EventBus.on('artifact:updated', () => this.render());
        EventBus.on('artifact:deleted', () => this.render());
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

        this.container.innerHTML = `
          <div class="vfs-explorer">
            <div class="vfs-toolbar" role="toolbar" aria-label="File explorer controls">
              <input type="text"
                     class="vfs-search"
                     placeholder="⚲ Search files..."
                     value="${escapeHtml(this.searchTerm)}"
                     aria-label="Search files"
                     role="searchbox">
              <button class="vfs-collapse-all" title="Collapse All" aria-label="Collapse all folders">⊟</button>
              <button class="vfs-expand-all" title="Expand All" aria-label="Expand all folders">⊞</button>
            </div>
            <div class="vfs-tree" role="tree" aria-label="File tree">${this.renderTree(tree)}</div>
            <div class="vfs-stats" role="status" aria-live="polite">
              ${Object.keys(allMeta).length} files
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

        // Sort: folders first, then files, alphabetically
        const sortChildren = (node) => {
          if (node.children) {
            node.children.sort((a, b) => {
              if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
              }
              return a.name.localeCompare(b.name);
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
        const highlight = this.searchTerm && node.name.toLowerCase().includes(this.searchTerm.toLowerCase())
          ? 'highlight' : '';

        // File state classes based on metadata
        const fileState = this.getFileStateClass(node.metadata);
        const stateIcon = this.getFileStateIcon(node.metadata);

        return `
          <div class="vfs-item vfs-file ${selected} ${highlight} ${fileState}"
               data-path="${escapeHtml(node.path)}"
               data-type="file"
               data-state="${node.metadata?.state || 'unchanged'}"
               role="treeitem"
               aria-selected="${selected ? 'true' : 'false'}"
               aria-label="${escapeHtml(node.name)} (${this.formatSize(node.size)})${stateIcon ? ' - ' + node.metadata?.state : ''}"
               tabindex="${selected ? '0' : '-1'}"
               style="padding-left:${depth * 20 + 20}px">
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
            const allMeta = await StateManager.getAllArtifactMetadata();
            const tree = this.buildTree(allMeta);
            this.expandAll(tree);
            this.render();
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
            this.selectedFile = path;
            await this.showFileViewer(path);
            this.render();
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

      async showFileViewer(path) {
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

          this.fileViewerModal.innerHTML = `
            <div class="vfs-file-viewer-overlay"></div>
            <div class="vfs-file-viewer-content">
              <div class="vfs-file-viewer-header">
                <div class="vfs-file-viewer-title">
                  <span class="vfs-icon">${this.getFileIcon(path)}</span>
                  <span>${escapeHtml(path)}</span>
                </div>
                <button class="vfs-file-viewer-close">☩</button>
              </div>
              <div class="vfs-file-viewer-meta">
                Type: ${metadata?.type || 'unknown'} |
                Size: ${this.formatSize(content?.length || 0)} |
                Lines: ${(content || '').split('\n').length}
              </div>
              <div class="vfs-file-viewer-body">
                <pre><code class="language-${language}">${escapeHtml(content || '')}</code></pre>
              </div>
              <div class="vfs-file-viewer-footer">
                <button class="vfs-file-viewer-copy">☷ Copy</button>
                <button class="vfs-file-viewer-history">☐ History</button>
                <button class="vfs-file-viewer-edit">✎ edit</button>
              </div>
            </div>
          `;

          this.fileViewerModal.style.display = 'flex';

          // Attach modal event listeners
          this.fileViewerModal.querySelector('.vfs-file-viewer-close').addEventListener('click', () => {
            this.fileViewerModal.style.display = 'none';
          });

          this.fileViewerModal.querySelector('.vfs-file-viewer-overlay').addEventListener('click', () => {
            this.fileViewerModal.style.display = 'none';
          });

          this.fileViewerModal.querySelector('.vfs-file-viewer-copy').addEventListener('click', async (e) => {
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

          this.fileViewerModal.querySelector('.vfs-file-viewer-history').addEventListener('click', async () => {
            // History feature requires integration with GenesisSnapshot
            logger.info(`[VFSExplorer] History for ${path} - feature requires GenesisSnapshot integration`);
            if (ToastNotifications) ToastNotifications.info('File history available via GenesisSnapshot module');
          });

          this.fileViewerModal.querySelector('.vfs-file-viewer-edit').addEventListener('click', () => {
            EventBus.emit('vfs:edit-file', { path, content });
            this.fileViewerModal.style.display = 'none';
          });

          // ESC key to close
          const handleEsc = (e) => {
            if (e.key === 'Escape' && this.fileViewerModal.style.display === 'flex') {
              this.fileViewerModal.style.display = 'none';
              document.removeEventListener('keydown', handleEsc);
            }
          };
          document.addEventListener('keydown', handleEsc);

        } catch (error) {
          logger.error(`[VFSExplorer] Failed to load file ${path}:`, error);
          if (ToastNotifications) ToastNotifications.error(`Failed to load file: ${error.message}`);
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
