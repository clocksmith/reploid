/**
 * app.js - Dreamer Demo Application Controller
 *
 * Main application that wires together all components and the Dreamer inference pipeline.
 */

import { ModelSelector } from './model-selector.js';
import { ChatUI } from './chat-ui.js';
import { ProgressUI } from './progress-ui.js';

// Dreamer pipeline imports
import { createPipeline } from '../inference/pipeline.js';
import { downloadModel } from '../storage/downloader.js';
import { listModels, openModelDirectory, loadManifestFromOPFS, deleteModel as deleteModelFromOPFS } from '../storage/shard-manager.js';
import { parseManifest } from '../storage/rpl-format.js';
import { getMemoryCapabilities } from '../memory/capability.js';
import { getHeapManager } from '../memory/heap-manager.js';
import { initDevice, getKernelCapabilities, getDevice } from '../gpu/device.js';

/**
 * Available models registry
 * In production, this would be fetched from a server
 */
const MODEL_REGISTRY = [
  {
    id: 'tinyllama-1.1b-q4',
    name: 'TinyLlama 1.1B',
    size: '1.1B',
    quantization: 'Q4_K_M',
    downloadSize: 668 * 1024 * 1024, // ~668MB
    url: 'https://huggingface.co/models/tinyllama-1.1b-q4km-rpl',
    downloaded: false
  },
  {
    id: 'smollm-360m-q4',
    name: 'SmolLM 360M',
    size: '360M',
    quantization: 'Q4_K_M',
    downloadSize: 220 * 1024 * 1024, // ~220MB
    url: 'https://huggingface.co/models/smollm-360m-q4km-rpl',
    downloaded: false
  },
  {
    id: 'qwen-0.5b-q4',
    name: 'Qwen 0.5B',
    size: '0.5B',
    quantization: 'Q4_K_M',
    downloadSize: 350 * 1024 * 1024, // ~350MB
    url: 'https://huggingface.co/models/qwen-0.5b-q4km-rpl',
    downloaded: false
  }
];

/**
 * Main Demo Application
 */
export class DreamerDemo {
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
  }

  /**
   * Initialize the application
   */
  async init() {
    console.log('[DreamerDemo] Initializing...');

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

    console.log('[DreamerDemo] Initialized');
  }

  /**
   * Initialize UI components
   * @private
   */
  _initComponents() {
    const container = document.querySelector('#app');

    // Model Selector
    this.modelSelector = new ModelSelector(container, {
      onSelect: (model) => this.selectModel(model.id),
      onDownload: (model) => this.downloadModel(model.id, model.url),
      onDelete: (model) => this.deleteModel(model.id)
    });

    // Chat UI
    this.chatUI = new ChatUI(container, {
      onSend: (message) => this.chat(message),
      onStop: () => this.stopGeneration(),
      onClear: () => this.clearConversation()
    });

    // Progress UI
    this.progressUI = new ProgressUI(container);

    // Set initial models
    this.modelSelector.setModels(MODEL_REGISTRY);
  }

  /**
   * Detect browser capabilities
   * @private
   */
  async _detectCapabilities() {
    console.log('[DreamerDemo] Detecting capabilities...');

    // WebGPU
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          this.capabilities.webgpu = true;

          // Check features
          this.capabilities.f16 = adapter.features.has('shader-f16');
          this.capabilities.subgroups = adapter.features.has('subgroups');

          // Get adapter info for logging
          const info = await adapter.requestAdapterInfo?.() || {};
          console.log('[DreamerDemo] GPU:', info.vendor, info.architecture);
        }
      } catch (e) {
        console.warn('[DreamerDemo] WebGPU init failed:', e);
      }
    }

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
   * Load list of cached models from storage
   * @private
   */
  async _loadCachedModels() {
    console.log('[DreamerDemo] Checking cached models...');

    try {
      const cachedModels = await listModels();
      MODEL_REGISTRY.forEach(model => {
        model.downloaded = cachedModels.includes(model.id);
      });
      console.log('[DreamerDemo] Found cached models:', cachedModels);
    } catch (err) {
      console.warn('[DreamerDemo] Could not query cached models:', err.message);
    }

    this.modelSelector.setModels(MODEL_REGISTRY);
  }

  /**
   * Select and load a model
   * @param {string} modelId - Model ID to load
   */
  async selectModel(modelId) {
    if (this.isGenerating) {
      this._showError('Cannot switch models while generating');
      return;
    }

    const model = MODEL_REGISTRY.find(m => m.id === modelId);
    if (!model) {
      this._showError(`Unknown model: ${modelId}`);
      return;
    }

    if (!model.downloaded) {
      this._showError('Model not downloaded. Click Download first.');
      return;
    }

    console.log(`[DreamerDemo] Loading model: ${modelId}`);
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

      // Open model directory and load manifest
      await openModelDirectory(modelId);
      this.progressUI.setProgress(10, 'Loading manifest...');

      const manifestJson = await loadManifestFromOPFS();
      const manifest = parseManifest(manifestJson);
      this.progressUI.setProgress(20, 'Initializing GPU...');

      // Ensure GPU device is initialized
      const device = getDevice() || await initDevice();
      const gpuCaps = getKernelCapabilities();
      const memCaps = await getMemoryCapabilities();
      const heapManager = getHeapManager();
      await heapManager.init();

      this.progressUI.setProgress(30, 'Creating pipeline...');

      // Create shard loader for OPFS
      const { loadShard } = await import('../storage/shard-manager.js');
      const loadShardFn = (idx) => loadShard(idx);

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
        onProgress: (progress) => {
          const percent = 30 + Math.round(progress.percent * 0.7);
          this.progressUI.setProgress(percent, progress.message || 'Loading weights...');
        },
      });

      this.currentModel = model;
      this.modelSelector.setActiveModel(modelId);
      this.progressUI.hide();
      this._setStatus('ready', `${model.name} loaded`);
      this.chatUI.setInputEnabled(true);
      this.chatUI.focusInput();

      console.log(`[DreamerDemo] Model loaded: ${modelId}`);

    } catch (error) {
      console.error('[DreamerDemo] Model load failed:', error);
      this.progressUI.hide();
      this._setStatus('error', 'Load failed');
      this._showError(`Failed to load model: ${error.message}`);
    }
  }

  /**
   * Download a model
   * @param {string} modelId - Model ID
   * @param {string} url - Model base URL
   */
  async downloadModel(modelId, url) {
    const model = MODEL_REGISTRY.find(m => m.id === modelId);
    if (!model) return;

    console.log(`[DreamerDemo] Downloading model: ${modelId}`);
    this._setStatus('loading', 'Downloading...');

    try {
      // Use real downloader
      const success = await downloadModel(url, (progress) => {
        const percent = Math.round((progress.downloadedBytes / progress.totalBytes) * 100);
        this.modelSelector.setDownloadProgress(modelId, percent);

        if (progress.stage === 'verifying') {
          this._setStatus('loading', 'Verifying...');
        }
      });

      if (!success) {
        throw new Error('Download failed');
      }

      this.modelSelector.setDownloaded(modelId);
      model.downloaded = true;
      this._setStatus('ready', 'Download complete');

      console.log(`[DreamerDemo] Download complete: ${modelId}`);

    } catch (error) {
      console.error('[DreamerDemo] Download failed:', error);
      this.modelSelector.setDownloadProgress(modelId, 0);
      this._setStatus('error', 'Download failed');
      this._showError(`Download failed: ${error.message}`);
    }
  }

  /**
   * Delete a cached model
   * @param {string} modelId - Model ID
   */
  async deleteModel(modelId) {
    const model = MODEL_REGISTRY.find(m => m.id === modelId);
    if (!model) return;

    console.log(`[DreamerDemo] Deleting model: ${modelId}`);

    try {
      // Unload if currently active
      if (this.currentModel?.id === modelId) {
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
      await deleteModelFromOPFS(modelId);

      model.downloaded = false;
      this.modelSelector.updateModel(modelId, { downloaded: false });
      this._setStatus('ready', 'Model deleted');

    } catch (error) {
      console.error('[DreamerDemo] Delete failed:', error);
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

    console.log(`[DreamerDemo] Generating response...`);
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
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
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
        console.error('[DreamerDemo] Generation error:', error);
        this.chatUI.cancelStream();
        this._setStatus('error', 'Generation failed');
        this._showError(`Generation failed: ${error.message}`);
      }
    } finally {
      this.isGenerating = false;
      this.abortController = null;
    }
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
    console.log('[DreamerDemo] Conversation cleared');
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
      "I'm a demo response from Dreamer! The real model isn't loaded yet, but once you connect the inference pipeline, I'll generate actual responses using WebGPU acceleration.",
      "This is a placeholder response. When the full Dreamer pipeline is connected, you'll see real LLM outputs with streaming tokens and performance metrics.",
      "Hello! I'm simulating what the chat experience will be like. The actual inference will run entirely in your browser using WebGPU for acceleration.",
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new DreamerDemo();
  app.init().catch(console.error);

  // Expose for debugging
  window.dreamerDemo = app;
});

export default DreamerDemo;
