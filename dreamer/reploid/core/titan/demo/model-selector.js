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
   * @param {string} modelId - Model ID
   * @param {Partial<ModelInfo>} updates - Properties to update
   */
  updateModel(modelId, updates) {
    const model = this.models.find(m => m.id === modelId);
    if (model) {
      Object.assign(model, updates);
      this._render();
    }
  }

  /**
   * Set download progress for a model
   * @param {string} modelId - Model ID
   * @param {number} progress - Progress percentage (0-100)
   */
  setDownloadProgress(modelId, progress) {
    this.downloadingModelId = progress < 100 ? modelId : null;
    this.updateModel(modelId, { downloadProgress: progress });
  }

  /**
   * Mark a model as downloaded
   * @param {string} modelId - Model ID
   */
  setDownloaded(modelId) {
    this.downloadingModelId = null;
    this.updateModel(modelId, { downloaded: true, downloadProgress: undefined });
  }

  /**
   * Set the active (loaded) model
   * @param {string} modelId - Model ID
   */
  setActiveModel(modelId) {
    this.activeModelId = modelId;
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
   * Render the model list
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

    for (const model of this.models) {
      const item = this._createModelItem(model);
      this.listElement.appendChild(item);
    }
  }

  /**
   * Create a model list item element
   * @private
   * @param {ModelInfo} model
   * @returns {HTMLElement}
   */
  _createModelItem(model) {
    const item = document.createElement('div');
    item.className = 'model-item';
    item.dataset.modelId = model.id;

    if (model.id === this.activeModelId) {
      item.classList.add('active');
    }

    if (model.id === this.downloadingModelId) {
      item.classList.add('downloading');
      item.style.setProperty('--download-progress', `${model.downloadProgress || 0}%`);
    }

    const isDownloading = model.id === this.downloadingModelId;

    item.innerHTML = `
      <div class="model-name">${this._escapeHtml(model.name)}</div>
      <div class="model-meta">
        ${model.size} · ${model.quantization} · ${this._formatBytes(model.downloadSize)}
      </div>
      <div class="model-actions">
        ${model.downloaded ? `
          <button class="model-btn load" ${isDownloading ? 'disabled' : ''}>
            ${model.id === this.activeModelId ? 'Loaded' : 'Load'}
          </button>
          <button class="model-btn delete" ${isDownloading ? 'disabled' : ''}>Delete</button>
        ` : `
          <button class="model-btn download" ${isDownloading ? 'disabled' : ''}>
            ${isDownloading ? `${Math.round(model.downloadProgress || 0)}%` : 'Download'}
          </button>
        `}
      </div>
    `;

    // Bind events
    const loadBtn = item.querySelector('.model-btn.load');
    const downloadBtn = item.querySelector('.model-btn.download');
    const deleteBtn = item.querySelector('.model-btn.delete');

    if (loadBtn) {
      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (model.id !== this.activeModelId) {
          this.onSelect(model);
        }
      });
    }

    if (downloadBtn) {
      downloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onDownload(model);
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete ${model.name}? This will remove the cached model.`)) {
          this.onDelete(model);
        }
      });
    }

    // Click on item to select/load
    item.addEventListener('click', () => {
      if (model.downloaded && model.id !== this.activeModelId) {
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
   * @returns {ModelInfo|null}
   */
  getActiveModel() {
    return this.models.find(m => m.id === this.activeModelId) || null;
  }

  /**
   * Get all downloaded models
   * @returns {ModelInfo[]}
   */
  getDownloadedModels() {
    return this.models.filter(m => m.downloaded);
  }
}

export default ModelSelector;
