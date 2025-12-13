/**
 * app.js - DOPPLER Demo Application Controller
 *
 * Main application that wires together all components and the DOPPLER inference pipeline.
 */

import { ModelSelector } from './model-selector.js';
import { ChatUI } from './chat-ui.js';
import { ProgressUI } from './progress-ui.js';

// DOPPLER pipeline imports
import { createPipeline } from '../inference/pipeline.js';
import { downloadModel } from '../storage/downloader.js';
import { listModels, openModelDirectory, loadManifestFromOPFS, deleteModel as deleteModelFromOPFS } from '../storage/shard-manager.js';
import { parseManifest } from '../storage/rdrr-format.js';
import { getMemoryCapabilities } from '../memory/capability.js';
import { getHeapManager } from '../memory/heap-manager.js';
import { initDevice, getKernelCapabilities, getDevice } from '../gpu/device.js';

/**
 * Remote models available for download
 */
const REMOTE_MODELS = [
  {
    id: 'tinyllama-1.1b-q4',
    name: 'TinyLlama 1.1B',
    size: '1.1B',
    quantization: 'Q4_K_M',
    downloadSize: 668 * 1024 * 1024,
    url: 'https://huggingface.co/models/tinyllama-1.1b-q4km-rdrr',
    source: 'remote'
  },
  {
    id: 'smollm-360m-q4',
    name: 'SmolLM 360M',
    size: '360M',
    quantization: 'Q4_K_M',
    downloadSize: 220 * 1024 * 1024,
    url: 'https://huggingface.co/models/smollm-360m-q4km-rdrr',
    source: 'remote'
  },
  {
    id: 'qwen-0.5b-q4',
    name: 'Qwen 0.5B',
    size: '0.5B',
    quantization: 'Q4_K_M',
    downloadSize: 350 * 1024 * 1024,
    url: 'https://huggingface.co/models/qwen-0.5b-q4km-rdrr',
    source: 'remote'
  }
];

/** @type {Array} Dynamic model registry populated at runtime */
let MODEL_REGISTRY = [];

/**
 * Discover local models via server API
 * @returns {Promise<Array>} Array of discovered local models
 */
async function discoverLocalModels() {
  const baseUrl = window.location.origin;

  try {
    const response = await fetch(`${baseUrl}/api/models`);
    if (!response.ok) return [];

    const models = await response.json();
    return models.map(m => {
      // Create friendly name from folder name
      let modelName = m.name
        .replace(/-rdrr$/, '')
        .replace(/-q4$/, '')
        .split('-')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');

      // Infer param count from layers/hidden
      const inferredParams = m.numLayers && m.vocabSize ?
        `${m.numLayers}L` : 'Unknown';

      return {
        id: m.name,
        name: modelName,
        size: inferredParams,
        quantization: m.quantization || 'Unknown',
        downloadSize: m.downloadSize || 0,
        url: `${baseUrl}/${m.path}`,
        source: 'local',
        downloaded: true,
        architecture: m.architecture || 'Unknown'
      };
    });
  } catch (e) {
    console.warn('[Discovery] Failed to fetch models from API:', e);
    return [];
  }
}

/**
 * Main Demo Application
 */
export class DOPPLERDemo {
  constructor() {
    /** @type {ModelSelector} */
    this.modelSelector = null;
    /** @type {ChatUI} */
    this.chatUI = null;
    /** @type {ProgressUI} */
    this.progressUI = null;

    // Pipeline state
    this.pipeline = null;
    this.currentModel = null;
    this.isGenerating = false;
    this.abortController = null;

    // Capabilities
    this.capabilities = {
      webgpu: false,
      f16: false,
      subgroups: false,
      memory64: false
    };

    // DOM references
    this.statusDot = null;
    this.statusText = null;
    this.capabilitiesList = null;
    this.statsElements = {};

    // Attention kernel UI
    this.attentionKernelSelect = null;
    this.attentionKernelNote = null;
    this.manifestAttentionKernelDefault = null;

    // Sampling controls
    this.temperatureInput = null;
    this.topPInput = null;
    this.topKInput = null;
  }

  /**
   * Initialize the application
   */
  async init() {
    console.log('[DOPPLERDemo] Initializing...');

    // Get DOM references
    this.statusDot = document.querySelector('.status-dot');
    this.statusText = document.querySelector('.status-text');
    this.capabilitiesList = document.querySelector('#capabilities-list');
    this.statsElements = {
      tps: document.querySelector('#stat-tps'),
      memory: document.querySelector('#stat-memory'),
      gpu: document.querySelector('#stat-gpu'),
      kv: document.querySelector('#stat-kv')
    };

    // GPU info elements
    this.gpuElements = {
      device: document.querySelector('#gpu-device'),
      vram: document.querySelector('#gpu-vram'),
      features: document.querySelector('#gpu-features')
    };

    // Memory bar elements
    this.memoryElements = {
      heapBar: document.querySelector('#memory-bar-heap'),
      heapValue: document.querySelector('#memory-heap'),
      gpuBar: document.querySelector('#memory-bar-gpu'),
      gpuValue: document.querySelector('#memory-gpu')
    };

    this.attentionKernelSelect = document.querySelector('#attention-kernel-select');
    this.attentionKernelNote = document.querySelector('#attention-kernel-note');

    this.temperatureInput = document.querySelector('#temperature-input');
    this.topPInput = document.querySelector('#top-p-input');
    this.topKInput = document.querySelector('#top-k-input');

    // Initialize UI components
    this._initComponents();

    // Check WebGPU support
    await this._detectCapabilities();

    // Load cached models list
    await this._loadCachedModels();

    // Set initial status
    if (this.capabilities.webgpu) {
      this._setStatus('ready', 'Ready');
      this.chatUI.setInputEnabled(false); // Disabled until model loaded
    } else {
      this._setStatus('error', 'WebGPU not supported');
      this._showError('WebGPU is not available in this browser. Please use Chrome 113+, Edge 113+, or Firefox Nightly with WebGPU enabled.');
    }

    console.log('[DOPPLERDemo] Initialized');
  }

  /**
   * Initialize UI components
   * @private
   */
  _initComponents() {
    const container = document.querySelector('#app');

    // Model Selector
    this.modelSelector = new ModelSelector(container, {
      onSelect: (model, opts) => this.selectModel(model, opts),
      onDownload: (model, opts) => this.downloadModel(model, opts),
      onDelete: (model) => this.deleteModel(model)
    });

    // Chat UI
    this.chatUI = new ChatUI(container, {
      onSend: (message) => this.chat(message),
      onStop: () => this.stopGeneration(),
      onClear: () => this.clearConversation()
    });

    // Progress UI
    this.progressUI = new ProgressUI(container);

    // Models will be populated by _loadCachedModels() after discovery

    // Attention kernel override dropdown
    if (this.attentionKernelSelect) {
      this.attentionKernelSelect.addEventListener('change', () => {
        const value = this.attentionKernelSelect.value;
        if (this.pipeline && typeof this.pipeline.setAttentionKernel === 'function') {
          this.pipeline.setAttentionKernel(value);
        }
        this._updateAttentionKernelNote();
      });
    }

    // Sampling inputs (clamp and persist)
    const clampNumber = (input, min, max) => {
      const n = parseFloat(input.value);
      if (!Number.isFinite(n)) return;
      input.value = Math.min(max, Math.max(min, n)).toString();
    };
    if (this.temperatureInput) {
      this.temperatureInput.addEventListener('change', () => clampNumber(this.temperatureInput, 0.1, 2.0));
    }
    if (this.topPInput) {
      this.topPInput.addEventListener('change', () => clampNumber(this.topPInput, 0, 1));
    }
    if (this.topKInput) {
      this.topKInput.addEventListener('change', () => clampNumber(this.topKInput, 0, 200));
    }
  }

  /**
   * Detect browser capabilities
   * @private
   */
  async _detectCapabilities() {
    console.log('[DOPPLERDemo] Detecting capabilities...');

    // WebGPU
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          this.capabilities.webgpu = true;

          // Check features
          this.capabilities.f16 = adapter.features.has('shader-f16');
          this.capabilities.subgroups = adapter.features.has('subgroups');

          // Get adapter info for logging (adapter.info is synchronous in modern Chrome)
          const info = adapter.info || await adapter.requestAdapterInfo?.() || {};
          console.log('[DOPPLERDemo] GPU:', info.vendor || 'unknown', info.architecture || info.device || 'unknown');

          // Populate GPU info panel
          this._populateGPUInfo(adapter, info);
        }
      } catch (e) {
        console.warn('[DOPPLERDemo] WebGPU init failed:', e);
      }
    }

    // Start memory stats polling
    this._startMemoryPolling();

    // Memory64 (basic check)
    try {
      const memory64Test = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x05, 0x04, 0x01, 0x04, 0x01, 0x00
      ]);
      await WebAssembly.compile(memory64Test);
      this.capabilities.memory64 = true;
    } catch {
      this.capabilities.memory64 = false;
    }

    // Update UI
    this._updateCapabilitiesUI();
  }

  /**
   * Update capabilities list UI
   * @private
   */
  _updateCapabilitiesUI() {
    if (!this.capabilitiesList) return;
    const items = this.capabilitiesList.querySelectorAll('li');
    items.forEach(item => {
      const cap = item.dataset.cap;
      if (this.capabilities[cap]) {
        item.classList.add('supported');
        item.classList.remove('unsupported');
      } else {
        item.classList.add('unsupported');
        item.classList.remove('supported');
      }
    });
  }

  /**
   * Populate GPU info panel with adapter details
   * @private
   * @param {GPUAdapter} adapter
   * @param {Object} info - Adapter info object
   */
  _populateGPUInfo(adapter, info) {
    if (!this.gpuElements.device) return;

    // Device name
    const deviceName = info.device || info.description || info.architecture || 'Unknown GPU';
    const vendor = info.vendor || '';
    this.gpuElements.device.textContent = vendor ? `${vendor} ${deviceName}` : deviceName;
    this.gpuElements.device.title = this.gpuElements.device.textContent;

    // VRAM limit (from adapter limits)
    const limits = adapter.limits || {};
    const maxBufferSize = limits.maxBufferSize || 0;
    const maxStorageSize = limits.maxStorageBufferBindingSize || 0;
    const vramLimit = Math.max(maxBufferSize, maxStorageSize);
    if (vramLimit > 0) {
      this.gpuElements.vram.textContent = this._formatBytes(vramLimit);
    } else {
      this.gpuElements.vram.textContent = 'Unknown';
    }

    // Features
    const features = [];
    if (this.capabilities.f16) features.push('F16');
    if (this.capabilities.subgroups) features.push('Subgroups');
    if (adapter.features.has('timestamp-query')) features.push('Timestamps');
    this.gpuElements.features.textContent = features.length > 0 ? features.join(', ') : 'Basic';
  }

  /**
   * Start polling memory stats
   * @private
   */
  _startMemoryPolling() {
    // Update immediately
    this._updateMemoryStats();

    // Poll every 2 seconds
    this._memoryPollInterval = setInterval(() => {
      this._updateMemoryStats();
    }, 2000);
  }

  /**
   * Update memory stats display
   * @private
   */
  _updateMemoryStats() {
    if (!this.memoryElements.heapBar) return;

    // JS Heap (from performance.memory if available - Chrome only)
    const memory = performance.memory;
    if (memory) {
      const usedHeap = memory.usedJSHeapSize || 0;
      const totalHeap = memory.jsHeapSizeLimit || memory.totalJSHeapSize || 1;
      const heapPercent = Math.min(100, (usedHeap / totalHeap) * 100);

      this.memoryElements.heapBar.style.width = `${heapPercent}%`;
      this.memoryElements.heapValue.textContent = this._formatBytes(usedHeap);
    } else {
      this.memoryElements.heapValue.textContent = 'N/A';
    }

    // GPU buffer usage (from heap manager if available)
    try {
      const heapManager = getHeapManager();
      if (heapManager && typeof heapManager.getStats === 'function') {
        const stats = heapManager.getStats();
        const gpuUsed = stats.allocated || stats.totalAllocated || 0;
        const gpuLimit = stats.limit || stats.maxSize || (4 * 1024 * 1024 * 1024); // 4GB default
        const gpuPercent = Math.min(100, (gpuUsed / gpuLimit) * 100);

        this.memoryElements.gpuBar.style.width = `${gpuPercent}%`;
        this.memoryElements.gpuValue.textContent = this._formatBytes(gpuUsed);
      } else {
        this.memoryElements.gpuValue.textContent = '--';
      }
    } catch {
      this.memoryElements.gpuValue.textContent = '--';
    }
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
   * Format model ID to a human-readable name
   * @private
   * @param {string} modelId - Raw model ID (may be a path or hash)
   * @returns {string} Formatted name
   */
  _formatModelName(modelId) {
    // Remove common prefixes
    let name = modelId
      .replace(/^custom-\d+$/, 'Custom Model')
      .replace(/^tools\//, '')
      .replace(/-rdrr$/, '')
      .replace(/-q4$/, '')
      .replace(/-q4_k_m$/i, '');

    // If it looks like a timestamp-based ID, just call it "Custom Model"
    if (/^custom-\d+$/.test(modelId)) {
      return 'Custom Model';
    }

    // Title case the remaining parts
    return name
      .split(/[-_]/)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Generate a deduplication key for a model
   * @private
   */
  _getModelKey(arch, quant, size) {
    // Normalize architecture name
    const normArch = (arch || 'unknown').toLowerCase().replace(/forcausallm|forconditionalgeneration/gi, '');
    const normQuant = (quant || 'unknown').toLowerCase();
    const normSize = String(size || 0);
    return `${normArch}:${normQuant}:${normSize}`;
  }

  /**
   * Load list of cached models from storage, deduplicating by model identity
   * @private
   */
  async _loadCachedModels() {
    console.log('[DOPPLERDemo] Discovering models...');

    // Map to deduplicate models: key -> model info with sources
    const modelMap = new Map();

    // Helper to add/merge a model into the map
    const addModel = (key, info, sourceType, sourceData) => {
      if (modelMap.has(key)) {
        // Merge sources
        const existing = modelMap.get(key);
        existing.sources[sourceType] = sourceData;
        // Prefer better metadata (server > browser > remote)
        if (sourceType === 'server' || (sourceType === 'browser' && !existing.sources.server)) {
          existing.name = info.name || existing.name;
          existing.size = info.size || existing.size;
          existing.downloadSize = info.downloadSize || existing.downloadSize;
        }
      } else {
        modelMap.set(key, {
          ...info,
          key,
          sources: { [sourceType]: sourceData }
        });
      }
    };

    // 1. Discover server models (local HTTP)
    const serverModels = await discoverLocalModels();
    console.log(`[DOPPLERDemo] Found ${serverModels.length} server models`);

    for (const model of serverModels) {
      const key = this._getModelKey(model.architecture, model.quantization, model.downloadSize);
      addModel(key, model, 'server', { id: model.id, url: model.url });
    }

    // 2. Check OPFS for browser-cached models
    let cachedIds = [];
    try {
      cachedIds = await listModels();
      console.log('[DOPPLERDemo] Found cached models in OPFS:', cachedIds);
    } catch (err) {
      console.warn('[DOPPLERDemo] Could not query cached models:', err.message);
    }

    for (const cachedId of cachedIds) {
      try {
        await openModelDirectory(cachedId);
        const manifestText = await loadManifestFromOPFS();
        if (manifestText) {
          const manifest = parseManifest(manifestText);
          const config = manifest.config || {};
          const textConfig = config.text_config || config;

          const arch = manifest.architecture || config.architectures?.[0] || '';
          const quant = manifest.quantization || 'Unknown';
          const totalSize = (manifest.shards || []).reduce((sum, s) => sum + (s.size || 0), 0);

          // Estimate param count
          const hiddenSize = textConfig.hidden_size || 0;
          let paramStr = 'Unknown';
          if (hiddenSize >= 4096) paramStr = '7B+';
          else if (hiddenSize >= 2048) paramStr = '1-3B';
          else if (hiddenSize >= 1024) paramStr = '<1B';

          const key = this._getModelKey(arch, quant, totalSize);
          addModel(key, {
            name: manifest.name || this._formatModelName(cachedId),
            architecture: arch,
            size: paramStr,
            quantization: quant,
            downloadSize: totalSize
          }, 'browser', { id: cachedId });
        }
      } catch (e) {
        console.warn(`[DOPPLERDemo] Could not load manifest for cached model ${cachedId}:`, e.message);
      }
    }

    // 3. Add remote models (available for download)
    for (const remote of REMOTE_MODELS) {
      const key = this._getModelKey(remote.architecture || remote.id, remote.quantization, remote.downloadSize);
      addModel(key, remote, 'remote', { id: remote.id, url: remote.url });
    }

    // 4. Convert map to array and sort by availability
    // Priority: server+browser > server > browser > remote
    const getAvailabilityScore = (m) => {
      let score = 0;
      if (m.sources.server) score += 2;
      if (m.sources.browser) score += 1;
      return score;
    };

    MODEL_REGISTRY = Array.from(modelMap.values()).sort((a, b) => {
      return getAvailabilityScore(b) - getAvailabilityScore(a);
    });

    console.log(`[DOPPLERDemo] Model registry: ${MODEL_REGISTRY.length} unique models`);
    this.modelSelector.setModels(MODEL_REGISTRY);
  }

  /**
   * Select and load a model (run it)
   * @param {Object|string} modelOrKey - Model object or model key
   * @param {Object} opts - Options { preferredSource: 'server'|'browser' }
   */
  async selectModel(modelOrKey, opts = {}) {
    if (this.isGenerating) {
      this._showError('Cannot switch models while generating');
      return;
    }

    // Support both model object and key string
    const model = typeof modelOrKey === 'string'
      ? MODEL_REGISTRY.find(m => m.key === modelOrKey)
      : modelOrKey;

    if (!model) {
      this._showError(`Unknown model: ${modelOrKey}`);
      return;
    }

    const sources = model.sources || {};
    const hasServer = !!sources.server;
    const hasBrowser = !!sources.browser;

    if (!hasServer && !hasBrowser) {
      this._showError('Model not available locally. Download it first.');
      return;
    }

    // Use preferred source if specified, otherwise default to server > browser
    let useServer;
    if (opts.preferredSource === 'server' && hasServer) {
      useServer = true;
    } else if (opts.preferredSource === 'browser' && hasBrowser) {
      useServer = false;
    } else {
      useServer = hasServer; // Default: prefer server
    }

    const sourceInfo = useServer ? sources.server : sources.browser;
    const sourceType = useServer ? 'server' : 'browser';

    console.log(`[DOPPLERDemo] Loading model: ${model.name} from ${sourceType}`);
    this._setStatus('loading', 'Loading model...');
    this.progressUI.show('Loading model...');

    try {
      // Unload current model if any
      if (this.pipeline) {
        if (typeof this.pipeline.unload === 'function') {
          await this.pipeline.unload();
        }
        this.pipeline = null;
      }

      let manifest;
      let loadShardFn;

      if (useServer) {
        // Load from HTTP (dev server)
        this.progressUI.setProgress(10, 'Loading manifest...');
        const manifestUrl = `${sourceInfo.url}/manifest.json`;
        const response = await fetch(manifestUrl);
        if (!response.ok) throw new Error(`Failed to fetch manifest: ${response.status}`);
        manifest = parseManifest(await response.text());

        // Create HTTP shard loader
        loadShardFn = async (idx) => {
          const shard = manifest.shards[idx];
          const shardUrl = `${sourceInfo.url}/${shard.filename}`;
          const res = await fetch(shardUrl);
          if (!res.ok) throw new Error(`Failed to fetch shard ${idx}: ${res.status}`);
          return await res.arrayBuffer();
        };
      } else {
        // Load from OPFS (browser cache)
        await openModelDirectory(sourceInfo.id);
        this.progressUI.setProgress(10, 'Loading manifest...');
        const manifestJson = await loadManifestFromOPFS();
        manifest = parseManifest(manifestJson);

        // Create OPFS shard loader
        const { loadShard } = await import('../storage/shard-manager.js');
        loadShardFn = (idx) => loadShard(idx);
      }

      this.progressUI.setProgress(20, 'Initializing GPU...');

      // Capture manifest default attention kernel preference.
      this.manifestAttentionKernelDefault =
        manifest.optimizations?.attentionKernel ||
        manifest.attentionKernel ||
        manifest.runtime?.attentionKernel ||
        null;

      // Ensure GPU device is initialized
      const device = getDevice() || await initDevice();
      const gpuCaps = getKernelCapabilities();
      const memCaps = await getMemoryCapabilities();
      const heapManager = getHeapManager();
      await heapManager.init();

      this.progressUI.setProgress(30, 'Creating pipeline...');

      // Create pipeline with progress tracking
      this.pipeline = await createPipeline(manifest, {
        gpu: {
          capabilities: gpuCaps,
          device: device,
        },
        memory: {
          capabilities: memCaps,
          heapManager: heapManager,
        },
        storage: {
          loadShard: loadShardFn,
        },
        baseUrl: useServer ? sourceInfo.url : null,
        runtime: {
          attentionKernel: this.attentionKernelSelect?.value || 'auto',
          debug: new URLSearchParams(window.location.search).has('debug'),
        },
        onProgress: (progress) => {
          const percent = 30 + Math.round(progress.percent * 0.7);
          this.progressUI.setProgress(percent, progress.message || 'Loading weights...');
        },
      });

      this.currentModel = model;
      this.modelSelector.setActiveModel(model.key);
      this.progressUI.hide();
      this._setStatus('ready', `${model.name} loaded`);
      this.chatUI.setInputEnabled(true);
      this.chatUI.focusInput();
      this._updateAttentionKernelNote();

      console.log(`[DOPPLERDemo] Model loaded: ${model.name} (${model.key})`);

    } catch (error) {
      console.error('[DOPPLERDemo] Model load failed:', error);
      this.progressUI.hide();
      this._setStatus('error', 'Load failed');
      this._showError(`Failed to load model: ${error.message}`);
    }
  }

  /**
   * Download/cache a model to browser storage
   * @param {Object} model - Model object with sources
   * @param {Object} opts - Options { runAfter: boolean }
   */
  async downloadModel(model, opts = {}) {
    const sources = model.sources || {};

    // Determine URL: prefer server (for caching), then remote
    let downloadUrl = null;
    let storageId = model.key.replace(/[^a-zA-Z0-9_-]/g, '_'); // Safe filename

    if (sources.server) {
      downloadUrl = sources.server.url;
    } else if (sources.remote) {
      downloadUrl = sources.remote.url;
      storageId = sources.remote.id || storageId;
    }

    if (!downloadUrl) {
      this._showError('No download source available');
      return;
    }

    console.log(`[DOPPLERDemo] Downloading "${model.name}" from: ${downloadUrl}`);
    this._setStatus('loading', `Downloading ${model.name}...`);

    try {
      const success = await downloadModel(downloadUrl, (progress) => {
        const percent = progress.totalBytes > 0
          ? Math.round((progress.downloadedBytes / progress.totalBytes) * 100)
          : 0;
        this.modelSelector.setDownloadProgress(model.key, percent);

        if (progress.stage === 'verifying') {
          this._setStatus('loading', 'Verifying...');
        }
      }, { modelId: storageId });

      if (!success) {
        throw new Error('Download failed');
      }

      this._setStatus('ready', 'Download complete');

      // Refresh models list to update sources
      await this._loadCachedModels();

      console.log(`[DOPPLERDemo] Download complete: ${model.name}`);

      // Run after download if requested
      if (opts.runAfter) {
        // Find the updated model in registry
        const updatedModel = MODEL_REGISTRY.find(m => m.key === model.key);
        if (updatedModel) {
          await this.selectModel(updatedModel);
        }
      }

    } catch (error) {
      console.error('[DOPPLERDemo] Download failed:', error);
      this.modelSelector.setDownloadProgress(model.key, 0);
      this._setStatus('error', 'Download failed');
      this._showError(`Download failed: ${error.message}`);
    }
  }

  /**
   * Delete a model from browser cache
   * @param {Object} model - Model object with sources
   */
  async deleteModel(model) {
    const sources = model.sources || {};
    const browserId = sources.browser?.id;

    if (!browserId) {
      this._showError('Model is not cached in browser');
      return;
    }

    console.log(`[DOPPLERDemo] Deleting cached model: ${model.name} (${browserId})`);

    try {
      // Unload if currently active
      if (this.currentModel?.key === model.key) {
        if (this.pipeline) {
          if (typeof this.pipeline.unload === 'function') {
            await this.pipeline.unload();
          }
          this.pipeline = null;
        }
        this.currentModel = null;
        this.modelSelector.setActiveModel(null);
        this.chatUI.setInputEnabled(false);
      }

      // Delete from OPFS
      await deleteModelFromOPFS(browserId);
      this._setStatus('ready', 'Cache cleared');

      // Refresh models list
      await this._loadCachedModels();

    } catch (error) {
      console.error('[DOPPLERDemo] Delete failed:', error);
      this._showError(`Delete failed: ${error.message}`);
    }
  }

  /**
   * Send a chat message and generate response
   * @param {string} message - User message
   * @returns {AsyncGenerator<string>}
   */
  async chat(message) {
    if (!this.currentModel) {
      this._showError('No model loaded');
      return;
    }

    if (!this.pipeline) {
      this._showError('Pipeline not initialized');
      return;
    }

    if (this.isGenerating) {
      return;
    }

    console.log(`[DOPPLERDemo] Generating response...`);
    this.isGenerating = true;
    this.abortController = new AbortController();

    // Add user message
    this.chatUI.addMessage('user', message);

    // Start streaming response
    this.chatUI.startStream();
    this._setStatus('loading', 'Generating...');

    try {
      // Use real pipeline generation
      let tokenCount = 0;
      const startTime = performance.now();

      for await (const token of this.pipeline.generate(message, {
        maxTokens: 512,
        temperature: this._getSamplingTemperature(),
        topP: this._getSamplingTopP(),
        topK: this._getSamplingTopK(),
        signal: this.abortController.signal
      })) {
        if (this.abortController.signal.aborted) break;
        this.chatUI.streamToken(token);
        tokenCount++;

        // Update TPS periodically
        if (tokenCount % 10 === 0) {
          const elapsed = (performance.now() - startTime) / 1000;
          this._updateStats(tokenCount / elapsed);
        }
      }

      const stats = this.chatUI.finishStream();
      this._updateStats(stats.tokensPerSec);
      this._setStatus('ready', `${this.currentModel.name}`);

    } catch (error) {
      if (error.name === 'AbortError') {
        this.chatUI.cancelStream();
        this._setStatus('ready', 'Stopped');
      } else {
        console.error('[DOPPLERDemo] Generation error:', error);
        this.chatUI.cancelStream();
        this._setStatus('error', 'Generation failed');
        this._showError(`Generation failed: ${error.message}`);
      }
    } finally {
      this.isGenerating = false;
      this.abortController = null;
    }
  }

  _getSamplingTemperature() {
    const n = parseFloat(this.temperatureInput?.value);
    return Number.isFinite(n) ? n : 0.7;
  }

  _getSamplingTopP() {
    const n = parseFloat(this.topPInput?.value);
    return Number.isFinite(n) ? n : 0.9;
  }

  _getSamplingTopK() {
    const n = parseInt(this.topKInput?.value, 10);
    return Number.isFinite(n) ? n : 40;
  }

  /**
   * Stop current generation
   */
  stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Clear conversation history
   */
  clearConversation() {
    if (this.pipeline && typeof this.pipeline.clearKVCache === 'function') {
      this.pipeline.clearKVCache();
    }
    this.chatUI.clear();
    console.log('[DOPPLERDemo] Conversation cleared');
  }

  /**
   * Get current status
   * @returns {Object}
   */
  getStatus() {
    let memoryUsage = null;
    let gpuUsage = null;

    if (this.pipeline) {
      // Get memory stats from pipeline if available
      if (typeof this.pipeline.getMemoryStats === 'function') {
        memoryUsage = this.pipeline.getMemoryStats();
      }
      // Get GPU stats if available
      if (typeof this.pipeline.getGPUStats === 'function') {
        gpuUsage = this.pipeline.getGPUStats();
      }
    }

    return {
      model: this.currentModel?.id || null,
      modelName: this.currentModel?.name || null,
      isGenerating: this.isGenerating,
      capabilities: { ...this.capabilities },
      memory: memoryUsage,
      gpu: gpuUsage
    };
  }

  /**
   * Set status indicator
   * @private
   */
  _setStatus(state, text) {
    this.statusDot.className = `status-dot ${state}`;
    this.statusText.textContent = text;
  }

  /**
   * Update performance stats
   * @private
   */
  _updateStats(tps) {
    if (this.statsElements.tps) {
      this.statsElements.tps.textContent = tps.toFixed(1);
    }

    // Update memory and GPU stats from pipeline
    if (this.pipeline) {
      if (this.statsElements.memory && typeof this.pipeline.getMemoryStats === 'function') {
        const memStats = this.pipeline.getMemoryStats();
        if (memStats && memStats.used) {
          const usedMB = (memStats.used / 1024 / 1024).toFixed(0);
          this.statsElements.memory.textContent = `${usedMB} MB`;
        }
      }

      if (this.statsElements.kv && typeof this.pipeline.getKVCacheStats === 'function') {
        const kvStats = this.pipeline.getKVCacheStats();
        if (kvStats) {
          this.statsElements.kv.textContent = `${kvStats.seqLen}/${kvStats.maxSeqLen}`;
        }
      }
    }
  }

  /**
   * Update attention kernel note based on dropdown and manifest default.
   * @private
   */
  _updateAttentionKernelNote() {
    if (!this.attentionKernelNote || !this.attentionKernelSelect) return;

    const selected = this.attentionKernelSelect.value;
    const manifestDefault = this.manifestAttentionKernelDefault;

    if (selected && selected !== 'auto') {
      this.attentionKernelNote.textContent = `Override: ${selected}`;
    } else if (manifestDefault) {
      this.attentionKernelNote.textContent = `Manifest default: ${manifestDefault} (auto enabled)`;
    } else {
      this.attentionKernelNote.textContent = 'Auto selection enabled';
    }
  }

  /**
   * Show error modal
   * @private
   */
  _showError(message) {
    const modal = document.querySelector('#error-modal');
    const messageEl = document.querySelector('#error-message');
    const closeBtn = document.querySelector('#error-close');

    messageEl.textContent = message;
    modal.hidden = false;

    const close = () => {
      modal.hidden = true;
      closeBtn.removeEventListener('click', close);
    };
    closeBtn.addEventListener('click', close);
  }

  /**
   * Generate demo response (placeholder until real pipeline)
   * @private
   */
  _generateDemoResponse(message) {
    const responses = [
      "I'm a demo response from DOPPLER! The real model isn't loaded yet, but once you connect the inference pipeline, I'll generate actual responses using WebGPU acceleration.",
      "This is a placeholder response. When the full DOPPLER pipeline is connected, you'll see real LLM outputs with streaming tokens and performance metrics.",
      "Hello! I'm simulating what the chat experience will be like. The actual inference will run entirely in your browser using WebGPU for acceleration.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new DOPPLERDemo();
  app.init().catch(console.error);

  // Expose for debugging
  window.dopplerDemo = app;
});

export default DOPPLERDemo;
