/**
 * Titan Provider - LLM Client Integration
 * Registers Titan as a local WebGPU option in llm-client.js
 */

import { getMemoryCapabilities } from './memory/capability.js';
import { getHeapManager } from './memory/heap-manager.js';
import {
  initOPFS,
  openModelDirectory,
  verifyIntegrity,
  listModels,
} from './storage/shard-manager.js';
import { getManifest, parseManifest } from './storage/rpl-format.js';
import { downloadModel } from './storage/downloader.js';
import { requestPersistentStorage, getStorageInfo } from './storage/quota.js';
import { initDevice, getKernelCapabilities, destroyDevice } from './gpu/device.js';
import { TitanPipeline } from './inference/pipeline.js';

export const TITAN_PROVIDER_VERSION = '0.1.0';

/**
 * Titan capability flags (populated at init)
 */
export const TitanCapabilities = {
  available: false,
  HAS_MEMORY64: false,
  HAS_SUBGROUPS: false,
  HAS_F16: false,
  IS_UNIFIED_MEMORY: false,
  TIER_LEVEL: 1,
  MAX_MODEL_SIZE: 0,
  initialized: false,
};

// Current state
let pipeline = null;
let currentModelId = null;

/**
 * Initialize Titan subsystem
 * @returns {Promise<boolean>} true if Titan is available
 */
export async function initTitan() {
  if (TitanCapabilities.initialized) {
    return TitanCapabilities.available;
  }

  try {
    console.log('[Titan] Initializing...');

    // Check WebGPU availability
    if (!navigator.gpu) {
      console.warn('[Titan] WebGPU not available');
      TitanCapabilities.initialized = true;
      return false;
    }

    // Probe memory capabilities
    const memCaps = await getMemoryCapabilities();
    TitanCapabilities.HAS_MEMORY64 = memCaps.hasMemory64;
    TitanCapabilities.IS_UNIFIED_MEMORY = memCaps.isUnifiedMemory;

    // Initialize WebGPU device
    const device = await initDevice();
    if (!device) {
      console.warn('[Titan] Failed to initialize WebGPU device');
      TitanCapabilities.initialized = true;
      return false;
    }

    // Get GPU capabilities
    const gpuCaps = getKernelCapabilities();
    TitanCapabilities.HAS_SUBGROUPS = gpuCaps.hasSubgroups;
    TitanCapabilities.HAS_F16 = gpuCaps.hasF16;

    // Initialize OPFS
    await initOPFS();

    // Request persistent storage
    await requestPersistentStorage();

    // Initialize heap manager
    const heapManager = getHeapManager();
    await heapManager.init();

    // Determine tier level and max model size
    if (memCaps.isUnifiedMemory) {
      TitanCapabilities.TIER_LEVEL = 1;
      TitanCapabilities.MAX_MODEL_SIZE = 60 * 1024 * 1024 * 1024; // 60GB
    } else if (memCaps.hasMemory64) {
      TitanCapabilities.TIER_LEVEL = 1;
      TitanCapabilities.MAX_MODEL_SIZE = 40 * 1024 * 1024 * 1024; // 40GB MoE
    } else {
      TitanCapabilities.TIER_LEVEL = 1;
      TitanCapabilities.MAX_MODEL_SIZE = 8 * 1024 * 1024 * 1024; // 8GB small MoE
    }

    TitanCapabilities.available = true;
    TitanCapabilities.initialized = true;

    console.log('[Titan] Initialized successfully:', TitanCapabilities);
    return true;
  } catch (err) {
    console.error('[Titan] Init failed:', err);
    TitanCapabilities.initialized = true;
    TitanCapabilities.available = false;
    return false;
  }
}

/**
 * Load a model from OPFS or download it
 * @param {string} modelId - Model identifier
 * @param {string} [modelUrl] - URL to download from if not cached
 * @param {Function} [onProgress] - Progress callback
 * @returns {Promise<boolean>}
 */
export async function loadModel(modelId, modelUrl = null, onProgress = null) {
  if (!TitanCapabilities.available) {
    throw new Error('Titan not initialized. Call initTitan() first.');
  }

  try {
    console.log(`[Titan] Loading model: ${modelId}`);

    // Open model directory
    await openModelDirectory(modelId);

    // Check if model exists and is valid
    const integrity = await verifyIntegrity().catch(() => ({
      valid: false,
      missingShards: [],
    }));

    if (!integrity.valid && modelUrl) {
      console.log(`[Titan] Model not cached, downloading from ${modelUrl}`);
      const success = await downloadModel(modelUrl, onProgress);
      if (!success) {
        throw new Error('Failed to download model');
      }
    } else if (!integrity.valid) {
      throw new Error(`Model ${modelId} not found and no URL provided`);
    }

    // Get manifest
    const manifest = getManifest();
    if (!manifest) {
      throw new Error('Failed to load model manifest');
    }

    // Check model size against capabilities
    if (manifest.totalSize > TitanCapabilities.MAX_MODEL_SIZE) {
      throw new Error(
        `Model size ${manifest.totalSize} exceeds max ${TitanCapabilities.MAX_MODEL_SIZE}`
      );
    }

    // Check if MoE required for dGPU
    if (!TitanCapabilities.IS_UNIFIED_MEMORY && !manifest.moeConfig) {
      console.warn(
        '[Titan] Dense model on discrete GPU - performance will be limited'
      );
    }

    // Initialize pipeline
    pipeline = new TitanPipeline();
    await pipeline.init(manifest);

    currentModelId = modelId;
    console.log(`[Titan] Model loaded: ${modelId}`);
    return true;
  } catch (err) {
    console.error('[Titan] Failed to load model:', err);
    throw err;
  }
}

/**
 * Unload current model
 */
export async function unloadModel() {
  if (pipeline) {
    await pipeline.cleanup();
    pipeline = null;
  }
  currentModelId = null;
  console.log('[Titan] Model unloaded');
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
export async function titanChat(messages, options = {}) {
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
export async function getTitanStorageInfo() {
  return getStorageInfo();
}

/**
 * Cleanup Titan resources
 */
export async function destroyTitan() {
  await unloadModel();
  destroyDevice();
  TitanCapabilities.initialized = false;
  TitanCapabilities.available = false;
  console.log('[Titan] Destroyed');
}

/**
 * Provider definition for llm-client.js
 */
export const TitanProvider = {
  name: 'titan',
  displayName: 'Local WebGPU (Titan)',
  isLocal: true,

  async init() {
    return initTitan();
  },

  async loadModel(modelId, modelUrl, onProgress) {
    return loadModel(modelId, modelUrl, onProgress);
  },

  async chat(messages, options) {
    return titanChat(messages, options);
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
    return TitanCapabilities;
  },

  async getModels() {
    return getAvailableModels();
  },

  async destroy() {
    return destroyTitan();
  },
};

export default TitanProvider;
