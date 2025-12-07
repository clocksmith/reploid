/**
 * Dreamer Provider - LLM Client Integration
 * Registers Dreamer as a local WebGPU option in llm-client.js
 */

import { getMemoryCapabilities } from './memory/capability.js';
import { getHeapManager } from './memory/heap-manager.js';
import {
  initOPFS,
  openModelDirectory,
  verifyIntegrity,
  listModels,
  loadManifestFromOPFS,
} from './storage/shard-manager.js';
import { getManifest, parseManifest } from './storage/rpl-format.js';
import { downloadModel } from './storage/downloader.js';
import { requestPersistence, getQuotaInfo, getStorageReport } from './storage/quota.js';
import { initDevice, getKernelCapabilities, destroyDevice } from './gpu/device.js';
import { createPipeline } from './inference/pipeline.js';
import { isBridgeAvailable, createBridgeClient } from './bridge/index.js';

export const DREAMER_PROVIDER_VERSION = '0.1.0';

/**
 * Dreamer capability flags (populated at init)
 */
export const DreamerCapabilities = {
  available: false,
  HAS_MEMORY64: false,
  HAS_SUBGROUPS: false,
  HAS_F16: false,
  IS_UNIFIED_MEMORY: false,
  TIER_LEVEL: 1,
  TIER_NAME: '',
  MAX_MODEL_SIZE: 0,
  initialized: false,
  currentModelId: null,
};

// Current state
let pipeline = null;
let currentModelId = null;

/**
 * Initialize Dreamer subsystem
 * @returns {Promise<boolean>} true if Dreamer is available
 */
export async function initDreamer() {
  if (DreamerCapabilities.initialized) {
    return DreamerCapabilities.available;
  }

  try {
    console.log('[Dreamer] Initializing...');

    // Check WebGPU availability
    if (!navigator.gpu) {
      console.warn('[Dreamer] WebGPU not available');
      DreamerCapabilities.initialized = true;
      return false;
    }

    // Probe memory capabilities
    const memCaps = await getMemoryCapabilities();
    DreamerCapabilities.HAS_MEMORY64 = memCaps.hasMemory64;
    DreamerCapabilities.IS_UNIFIED_MEMORY = memCaps.isUnifiedMemory;

    // Initialize WebGPU device
    const device = await initDevice();
    if (!device) {
      console.warn('[Dreamer] Failed to initialize WebGPU device');
      DreamerCapabilities.initialized = true;
      return false;
    }

    // Get GPU capabilities
    const gpuCaps = getKernelCapabilities();
    DreamerCapabilities.HAS_SUBGROUPS = gpuCaps.hasSubgroups;
    DreamerCapabilities.HAS_F16 = gpuCaps.hasF16;

    // Initialize OPFS
    await initOPFS();

    // Request persistent storage
    await requestPersistence();

    // Initialize heap manager
    const heapManager = getHeapManager();
    await heapManager.init();

    // Determine tier level and max model size
    if (memCaps.isUnifiedMemory) {
      DreamerCapabilities.TIER_LEVEL = 1;
      DreamerCapabilities.TIER_NAME = 'Unified Memory';
      DreamerCapabilities.MAX_MODEL_SIZE = 60 * 1024 * 1024 * 1024; // 60GB
    } else if (memCaps.hasMemory64) {
      DreamerCapabilities.TIER_LEVEL = 2;
      DreamerCapabilities.TIER_NAME = 'Memory64';
      DreamerCapabilities.MAX_MODEL_SIZE = 40 * 1024 * 1024 * 1024; // 40GB MoE
    } else {
      DreamerCapabilities.TIER_LEVEL = 3;
      DreamerCapabilities.TIER_NAME = 'Basic';
      DreamerCapabilities.MAX_MODEL_SIZE = 8 * 1024 * 1024 * 1024; // 8GB small MoE
    }

    DreamerCapabilities.available = true;
    DreamerCapabilities.initialized = true;

    console.log('[Dreamer] Initialized successfully:', DreamerCapabilities);
    return true;
  } catch (err) {
    console.error('[Dreamer] Init failed:', err);
    DreamerCapabilities.initialized = true;
    DreamerCapabilities.available = false;
    return false;
  }
}

/**
 * Load a model from OPFS, download it, or access via Native Bridge
 * @param {string} modelId - Model identifier
 * @param {string} [modelUrl] - URL to download from if not cached
 * @param {Function} [onProgress] - Progress callback
 * @param {string} [localPath] - Local file path for Native Bridge access
 * @returns {Promise<boolean>}
 */
export async function loadModel(modelId, modelUrl = null, onProgress = null, localPath = null) {
  if (!DreamerCapabilities.available) {
    throw new Error('Dreamer not initialized. Call initDreamer() first.');
  }

  try {
    console.log(`[Dreamer] Loading model: ${modelId}`);

    let manifest = null;
    let useBridge = false;

    // Check if we should use Native Bridge for local path access
    if (localPath && isBridgeAvailable()) {
      console.log(`[Dreamer] Using Native Bridge for local path: ${localPath}`);
      useBridge = true;

      try {
        const bridgeClient = await createBridgeClient();

        // Read manifest from local path
        const manifestPath = localPath.endsWith('/')
          ? `${localPath}manifest.json`
          : `${localPath}/manifest.json`;

        if (onProgress) onProgress({ stage: 'connecting', message: 'Connecting to Native Bridge...' });

        const manifestBytes = await bridgeClient.read(manifestPath);
        const manifestJson = new TextDecoder().decode(manifestBytes);
        manifest = parseManifest(manifestJson);

        console.log(`[Dreamer] Loaded manifest via bridge: ${manifest.modelId}`);
        if (onProgress) onProgress({ stage: 'manifest', message: 'Manifest loaded via bridge' });

        // Store bridge client and local path for shard access during inference
        DreamerCapabilities.bridgeClient = bridgeClient;
        DreamerCapabilities.localPath = localPath;
      } catch (err) {
        console.error('[Dreamer] Failed to load via bridge:', err);
        throw new Error(`Native Bridge error: ${err.message}`);
      }
    } else {
      // Standard OPFS path
      // Open model directory
      await openModelDirectory(modelId);

      // Attempt to load manifest from OPFS (if present)
      try {
        const manifestJson = await loadManifestFromOPFS();
        manifest = parseManifest(manifestJson);
      } catch {
        manifest = null;
      }

      // Check if model exists and is valid (only if manifest loaded)
      let integrity = { valid: false, missingShards: [] };
      if (manifest) {
        integrity = await verifyIntegrity().catch(() => ({
          valid: false,
          missingShards: [],
        }));
      }

      if (!integrity.valid && modelUrl) {
        console.log(`[Dreamer] Model not cached, downloading from ${modelUrl}`);
        const success = await downloadModel(modelUrl, onProgress);
        if (!success) {
          throw new Error('Failed to download model');
        }
      } else if (!integrity.valid && !localPath) {
        throw new Error(`Model ${modelId} not found and no URL provided`);
      }

      // Get manifest
      manifest = getManifest();
    }

    if (!manifest) {
      throw new Error('Failed to load model manifest');
    }

    // Check model size against capabilities
    if (manifest.totalSize > DreamerCapabilities.MAX_MODEL_SIZE) {
      throw new Error(
        `Model size ${manifest.totalSize} exceeds max ${DreamerCapabilities.MAX_MODEL_SIZE}`
      );
    }

    // Check if MoE required for dGPU
    if (!DreamerCapabilities.IS_UNIFIED_MEMORY && !manifest.moeConfig) {
      console.warn(
        '[Dreamer] Dense model on discrete GPU - performance will be limited'
      );
    }

    // Initialize pipeline with current capabilities
    const gpuCaps = getKernelCapabilities();
    const memCaps = await getMemoryCapabilities();
    const { getDevice } = await import('./gpu/device.js');

    // Create shard loader - use bridge or OPFS based on how model was loaded
    let loadShardFn;
    if (useBridge && DreamerCapabilities.bridgeClient && DreamerCapabilities.localPath) {
      // Load shards via Native Bridge (mmap)
      const bridgeClient = DreamerCapabilities.bridgeClient;
      const basePath = DreamerCapabilities.localPath.endsWith('/')
        ? DreamerCapabilities.localPath
        : `${DreamerCapabilities.localPath}/`;

      loadShardFn = async (idx) => {
        const shardInfo = manifest.shards[idx];
        if (!shardInfo) throw new Error(`Invalid shard index: ${idx}`);
        const shardPath = `${basePath}${shardInfo.filename}`;
        console.log(`[Dreamer] Loading shard ${idx} via bridge: ${shardPath}`);
        const data = await bridgeClient.read(shardPath, 0, shardInfo.size);
        return data;
      };
    } else {
      // Load shards from OPFS
      loadShardFn = (idx) => import('./storage/shard-manager.js').then(m => m.loadShard(idx));
    }

    pipeline = await createPipeline(manifest, {
      gpu: {
        capabilities: gpuCaps,
        device: getDevice(), // Use existing device, don't re-init
      },
      memory: {
        capabilities: memCaps,
        heapManager: getHeapManager(),
      },
      storage: {
        loadShard: loadShardFn,
      }
    });

    currentModelId = modelId;
    DreamerCapabilities.currentModelId = modelId;
    console.log(`[Dreamer] Model loaded: ${modelId}`);
    return true;
  } catch (err) {
    console.error('[Dreamer] Failed to load model:', err);
    throw err;
  }
}

/**
 * Unload current model
 */
export async function unloadModel() {
  if (pipeline) {
    if (typeof pipeline.unload === 'function') {
      await pipeline.unload();
    }
    pipeline = null;
  }
  currentModelId = null;
  DreamerCapabilities.currentModelId = null;
  console.log('[Dreamer] Model unloaded');
}

/**
 * Generate text completion
 * @param {string} prompt - Input prompt
 * @param {Object} options - Generation options
 * @returns {AsyncGenerator<string>} Token stream
 */
export async function* generate(prompt, options = {}) {
  if (!pipeline) {
    throw new Error('No model loaded. Call loadModel() first.');
  }

  const {
    maxTokens = 256,
    temperature = 0.7,
    topP = 0.9,
    topK = 40,
    stopTokens = [],
    onToken = null,
  } = options;

  for await (const token of pipeline.generate(prompt, {
    maxTokens,
    temperature,
    topP,
    topK,
    stopTokens,
  })) {
    if (onToken) onToken(token);
    yield token;
  }
}

/**
 * Chat completion (matches LLM client interface)
 * @param {Array} messages - Chat messages
 * @param {Object} options - Generation options
 * @returns {Promise<{content: string, usage: Object}>}
 */
export async function dreamerChat(messages, options = {}) {
  // Format messages into prompt
  const prompt = messages
    .map((m) => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'user') return `User: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      return m.content;
    })
    .join('\n') + '\nAssistant:';

  const tokens = [];
  for await (const token of generate(prompt, options)) {
    tokens.push(token);
  }

  return {
    content: tokens.join(''),
    usage: {
      promptTokens: 0, // TODO: count from tokenizer
      completionTokens: tokens.length,
      totalTokens: tokens.length,
    },
  };
}

/**
 * Get list of available models
 * @returns {Promise<string[]>}
 */
export async function getAvailableModels() {
  return listModels();
}

/**
 * Get storage info
 * @returns {Promise<Object>}
 */
export async function getDreamerStorageInfo() {
  // Provide quota + OPFS report
  return getStorageReport();
}

/**
 * Cleanup Dreamer resources
 */
export async function destroyDreamer() {
  await unloadModel();
  destroyDevice();

  // Disconnect bridge client if connected
  if (DreamerCapabilities.bridgeClient) {
    DreamerCapabilities.bridgeClient.disconnect();
    DreamerCapabilities.bridgeClient = null;
    DreamerCapabilities.localPath = null;
  }

  DreamerCapabilities.initialized = false;
  DreamerCapabilities.available = false;
  console.log('[Dreamer] Destroyed');
}

/**
 * Provider definition for llm-client.js
 */
export const DreamerProvider = {
  name: 'dreamer',
  displayName: 'Dreamer',
  isLocal: true,

  async init() {
    return initDreamer();
  },

  async loadModel(modelId, modelUrl, onProgress, localPath) {
    return loadModel(modelId, modelUrl, onProgress, localPath);
  },

  async chat(messages, options) {
    return dreamerChat(messages, options);
  },

  async *stream(messages, options) {
    const prompt = messages
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n') + '\nassistant:';
    for await (const token of generate(prompt, options)) {
      yield token;
    }
  },

  getCapabilities() {
    return DreamerCapabilities;
  },

  async getModels() {
    return getAvailableModels();
  },

  async destroy() {
    return destroyDreamer();
  },
};

export default DreamerProvider;
