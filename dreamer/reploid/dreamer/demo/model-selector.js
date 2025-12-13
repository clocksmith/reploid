/**
 * model-selector.js - Model Selection Component
 * Agent-D | Phase 2 | demo/
 *
 * Handles model list display, download progress, and selection.
 */

/**
 * @typedef {Object} ModelInfo
 * @property {string} id - Unique model identifier
 * @property {string} name - Display name
 * @property {string} size - Model size (e.g., "1.1B")
 * @property {string} quantization - Quantization format (e.g., "Q4_K_M")
 * @property {number} downloadSize - Download size in bytes
 * @property {string} url - Base URL for model download
 * @property {boolean} [downloaded] - Whether model is cached locally
 * @property {number} [downloadProgress] - Download progress (0-100)
 */

export class ModelSelector {
  /**
   * @param {HTMLElement} container - Container element for model list
   * @param {Object} callbacks - Event callbacks
   * @param {Function} callbacks.onSelect - Called when model is selected
   * @param {Function} callbacks.onDownload - Called when download is requested
   * @param {Function} callbacks.onDelete - Called when delete is requested
   */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.listElement = container.querySelector('#model-list');
    this.storageElement = container.querySelector('#storage-used');

    this.onSelect = callbacks.onSelect || (() => {});
    this.onDownload = callbacks.onDownload || (() => {});
    this.onDelete = callbacks.onDelete || (() => {});

    /** @type {ModelInfo[]} */
    this.models = [];
    this.activeModelId = null;
    this.downloadingModelId = null;
  }

  /**
   * Set available models
   * @param {ModelInfo[]} models - Array of model info objects
   */
  setModels(models) {
    this.models = models;
    this._render();
  }

  /**
   * Update a single model's info
   * @param {string} modelKey - Model key
   * @param {Object} updates - Properties to update
   */
  updateModel(modelKey, updates) {
    const model = this.models.find(m => m.key === modelKey);
    if (model) {
      Object.assign(model, updates);
      this._render();
    }
  }

  /**
   * Set download progress for a model
   * @param {string} modelKey - Model key
   * @param {number} progress - Progress percentage (0-100)
   */
  setDownloadProgress(modelKey, progress) {
    this.downloadingModelId = progress < 100 ? modelKey : null;
    this.updateModel(modelKey, { downloadProgress: progress });
  }

  /**
   * Mark a model as downloaded (triggers refresh)
   * @param {string} modelKey - Model key
   */
  setDownloaded(modelKey) {
    this.downloadingModelId = null;
    this.updateModel(modelKey, { downloadProgress: undefined });
  }

  /**
   * Set the active (running) model
   * @param {string} modelKey - Model key
   */
  setActiveModel(modelKey) {
    this.activeModelId = modelKey;
    this._render();
  }

  /**
   * Update storage usage display
   * @param {number} used - Used bytes
   * @param {number} total - Total available bytes
   */
  setStorageUsage(used, total) {
    const usedStr = this._formatBytes(used);
    const totalStr = this._formatBytes(total);
    this.storageElement.textContent = `${usedStr} / ${totalStr}`;
  }

  /**
   * Render the model list with grouped sections
   * @private
   */
  _render() {
    this.listElement.innerHTML = '';

    if (this.models.length === 0) {
      this.listElement.innerHTML = `
        <div class="model-item" style="text-align: center; color: var(--text-muted);">
          No models available
        </div>
      `;
      return;
    }

    // Group models: "Ready" (has server or browser) vs "Available" (remote only)
    const readyModels = this.models.filter(m =>
      m.sources?.server || m.sources?.browser
    );
    const availableModels = this.models.filter(m =>
      !m.sources?.server && !m.sources?.browser && m.sources?.remote
    );

    // Render ready models section
    if (readyModels.length > 0) {
      const section = this._createSection('Ready', `${readyModels.length} model${readyModels.length > 1 ? 's' : ''}`, 'ready');
      for (const model of readyModels) {
        section.appendChild(this._createModelItem(model));
      }
      this.listElement.appendChild(section);
    }

    // Render available for download section
    if (availableModels.length > 0) {
      const section = this._createSection('Available', 'Download to browser', 'remote');
      for (const model of availableModels) {
        section.appendChild(this._createModelItem(model));
      }
      this.listElement.appendChild(section);
    }
  }

  /**
   * Create a section header element
   * @private
   * @param {string} title - Section title
   * @param {string} subtitle - Section subtitle
   * @param {string} type - Section type for styling
   * @returns {HTMLElement}
   */
  _createSection(title, subtitle, type) {
    const section = document.createElement('div');
    section.className = `model-section model-section-${type}`;
    section.innerHTML = `
      <div class="model-section-header">
        <span class="model-section-title">${title}</span>
        <span class="model-section-subtitle">${subtitle}</span>
      </div>
    `;
    return section;
  }

  /**
   * Create a model list item element
   * @private
   * @param {Object} model - Model with sources: { server?, browser?, remote? }
   * @returns {HTMLElement}
   */
  _createModelItem(model) {
    const item = document.createElement('div');
    item.className = 'model-item';
    item.dataset.modelKey = model.key;

    const sources = model.sources || {};
    const hasServer = !!sources.server;
    const hasBrowser = !!sources.browser;
    const hasRemote = !!sources.remote;
    const isReady = hasServer || hasBrowser;

    if (model.key === this.activeModelId) {
      item.classList.add('active');
    }

    if (model.key === this.downloadingModelId) {
      item.classList.add('downloading');
      item.style.setProperty('--download-progress', `${model.downloadProgress || 0}%`);
    }

    const isDownloading = model.key === this.downloadingModelId;

    // Build meta info
    const metaParts = [];
    if (model.architecture) metaParts.push(model.architecture);
    if (model.size && model.size !== 'Unknown') metaParts.push(model.size);
    if (model.quantization && model.quantization !== 'Unknown') metaParts.push(model.quantization);
    if (model.downloadSize > 0) metaParts.push(this._formatBytes(model.downloadSize));
    const metaText = metaParts.join(' · ') || 'Unknown';

    const isLoaded = model.key === this.activeModelId;

    // Build tooltips based on source
    const serverRunTooltip = 'Load weights from dev server into GPU memory. Streams via HTTP - good for development as it always loads latest files.';
    const cachedRunTooltip = 'Load weights from browser cache (OPFS) into GPU memory. Faster than server, works offline.';
    const cacheTooltip = 'Copy model from server to browser storage (OPFS). Enables offline use and faster subsequent loads. Uses ~' + this._formatBytes(model.downloadSize) + ' of browser storage.';
    const clearCacheTooltip = 'Remove cached copy from browser storage. Server copy remains available.';
    const deleteTooltip = 'Permanently remove model from browser storage. You will need to re-download to use again.';
    const downloadTooltip = 'Download model from remote server to browser storage (OPFS). Required before running. Uses ~' + this._formatBytes(model.downloadSize) + ' of browser storage.';
    const dlRunTooltip = 'Download to browser storage, then immediately load into GPU memory and start inference.';

    // Build action buttons based on available sources
    let actionsHtml = '';
    if (isReady) {
      if (hasServer && hasBrowser) {
        // Both sources available - let user choose
        actionsHtml = `
          <button class="model-btn run run-server" data-source="server" ${isDownloading || isLoaded ? 'disabled' : ''} title="${serverRunTooltip}">
            Run (Server)
          </button>
          <button class="model-btn run run-cached" data-source="browser" ${isDownloading || isLoaded ? 'disabled' : ''} title="${cachedRunTooltip}">
            Run (Cached)
          </button>
          <button class="model-btn delete" ${isDownloading ? 'disabled' : ''} title="${clearCacheTooltip}">
            Clear Cache
          </button>
        `;
      } else if (hasServer) {
        // Server only
        actionsHtml = `
          <button class="model-btn run" data-source="server" ${isDownloading || isLoaded ? 'disabled' : ''} title="${serverRunTooltip}">
            ${isLoaded ? 'Running' : 'Run (Server)'}
          </button>
          <button class="model-btn cache" ${isDownloading ? 'disabled' : ''} title="${cacheTooltip}">
            Cache
          </button>
        `;
      } else {
        // Browser/cached only
        actionsHtml = `
          <button class="model-btn run" data-source="browser" ${isDownloading || isLoaded ? 'disabled' : ''} title="${cachedRunTooltip}">
            ${isLoaded ? 'Running' : 'Run (Cached)'}
          </button>
          <button class="model-btn delete" ${isDownloading ? 'disabled' : ''} title="${deleteTooltip}">
            Delete
          </button>
        `;
      }
    } else if (hasRemote) {
      // Remote only - needs download first
      actionsHtml = `
        <button class="model-btn download" ${isDownloading ? 'disabled' : ''} title="${downloadTooltip}">
          ${isDownloading ? `${Math.round(model.downloadProgress || 0)}%` : 'Download'}
        </button>
        <button class="model-btn download-run" ${isDownloading ? 'disabled' : ''} title="${dlRunTooltip}">
          DL & Run
        </button>
      `;
    }

    item.innerHTML = `
      <div class="model-name">${this._escapeHtml(model.name)}</div>
      <div class="model-meta">${metaText}</div>
      <div class="model-actions">${actionsHtml}</div>
    `;

    // Bind events
    const runBtns = item.querySelectorAll('.model-btn.run');
    const cacheBtn = item.querySelector('.model-btn.cache');
    const downloadBtn = item.querySelector('.model-btn.download');
    const downloadRunBtn = item.querySelector('.model-btn.download-run');
    const deleteBtn = item.querySelector('.model-btn.delete');

    runBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (model.key !== this.activeModelId) {
          const preferredSource = btn.dataset.source || null;
          this.onSelect(model, { preferredSource });
        }
      });
    });

    if (cacheBtn) {
      cacheBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Cache from server to browser (download from server URL to OPFS)
        this.onDownload(model);
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onDownload(model);
      });
    }

    if (downloadRunBtn) {
      downloadRunBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Download then run
        this.onDownload(model, { runAfter: true });
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const msg = hasServer
          ? `Clear browser cache for ${model.name}? (Server copy will remain)`
          : `Delete ${model.name}? This will remove it from browser storage.`;
        if (confirm(msg)) {
          this.onDelete(model);
        }
      });
    }

    // Click on item to run (if ready)
    item.addEventListener('click', () => {
      if (isReady && model.key !== this.activeModelId) {
        this.onSelect(model);
      }
    });

    return item;
  }

  /**
   * Format bytes to human-readable string
   * @private
   * @param {number} bytes
   * @returns {string}
   */
  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Escape HTML to prevent XSS
   * @private
   * @param {string} str
   * @returns {string}
   */
  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Get currently active model
   * @returns {Object|null}
   */
  getActiveModel() {
    return this.models.find(m => m.key === this.activeModelId) || null;
  }

  /**
   * Get all ready models (have server or browser source)
   * @returns {Object[]}
   */
  getReadyModels() {
    return this.models.filter(m => m.sources?.server || m.sources?.browser);
  }
}

export default ModelSelector;
