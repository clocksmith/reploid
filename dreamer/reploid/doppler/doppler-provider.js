/**
 * DOPPLER Provider - LLM Client Integration
 * Registers DOPPLER as a local WebGPU option in llm-client.js
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
import { getManifest, parseManifest } from './storage/rdrr-format.js';
import { downloadModel } from './storage/downloader.js';
import { requestPersistence, getQuotaInfo, getStorageReport } from './storage/quota.js';
import { initDevice, getKernelCapabilities, getDeviceLimits, destroyDevice } from './gpu/device.js';
import { prewarmKernels, autoTuneKernels } from './gpu/kernel-selector.js';
import { createPipeline } from './inference/pipeline.js';
import { isBridgeAvailable, createBridgeClient } from './bridge/index.js';

export const DOPPLER_PROVIDER_VERSION = '0.1.0';

/**
 * DOPPLER capability flags (populated at init)
 */
export const DopplerCapabilities = {
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
  kernelsWarmed: false,
  kernelsTuned: false,
  lastModelEstimate: null,
};

function extractTextModelConfig(manifest) {
  const cfg = manifest?.config || manifest?.modelConfig || {};
  const textCfg = cfg.text_config || cfg;

  const hiddenSize = textCfg.hidden_size || textCfg.n_embd || 4096;

  // Try to get attention params from config, or infer from tensor shapes
  let numHeads = textCfg.num_attention_heads || textCfg.n_head;
  let numKVHeads = textCfg.num_key_value_heads;
  let headDim = textCfg.head_dim;

  // If attention params missing, try to infer from tensor shapes
  if (!numHeads || !headDim) {
    const inferred = inferAttentionParams(manifest, hiddenSize);
    if (inferred) {
      numHeads = numHeads || inferred.numHeads;
      numKVHeads = numKVHeads || inferred.numKVHeads;
      headDim = headDim || inferred.headDim;
    }
  }

  // Fallback defaults
  numHeads = numHeads || 32;
  numKVHeads = numKVHeads || numHeads;
  headDim = headDim || Math.floor(hiddenSize / numHeads);

  return {
    numLayers: textCfg.num_hidden_layers || textCfg.n_layer || 32,
    hiddenSize,
    intermediateSize: textCfg.intermediate_size || textCfg.n_inner || 14336,
    numHeads,
    numKVHeads,
    headDim,
    vocabSize: textCfg.vocab_size || 32000,
    maxSeqLen: textCfg.max_position_embeddings || textCfg.context_length || 4096,
    quantization: (manifest?.quantization || 'f16').toUpperCase(),
  };
}

/**
 * Infer attention parameters from tensor shapes in manifest
 */
function inferAttentionParams(manifest, hiddenSize) {
  const tensors = manifest?.tensors || {};

  let qShape = null;
  let kShape = null;

  for (const [name, tensor] of Object.entries(tensors)) {
    if (name.includes('layers.0.self_attn.q_proj.weight') || name.includes('layers.0.attention.q_proj.weight')) {
      qShape = tensor.shape;
    }
    if (name.includes('layers.0.self_attn.k_proj.weight') || name.includes('layers.0.attention.k_proj.weight')) {
      kShape = tensor.shape;
    }
    if (qShape && kShape) break;
  }

  if (!qShape || !kShape) return null;

  const qOutDim = qShape[0];
  const kOutDim = kShape[0];

  // Common headDim values
  const commonHeadDims = [256, 128, 160, 64, 96, 80];

  for (const testHeadDim of commonHeadDims) {
    if (qOutDim % testHeadDim === 0 && kOutDim % testHeadDim === 0) {
      const numHeads = qOutDim / testHeadDim;
      const numKVHeads = kOutDim / testHeadDim;
      if (numHeads >= numKVHeads && numHeads > 0 && numKVHeads > 0) {
        return { numHeads, numKVHeads, headDim: testHeadDim };
      }
    }
  }

  return null;
}

function estimateDequantizedWeightsBytes(manifest) {
  const q = (manifest?.quantization || '').toUpperCase();
  const total = manifest?.totalSize || 0;
  if (q.startsWith('Q4')) {
    // Roughly 8x expansion when dequantized to f32.
    return total * 8;
  }
  return total;
}

// Current state
let pipeline = null;
let currentModelId = null;

/**
 * Initialize DOPPLER subsystem
 * @returns {Promise<boolean>} true if DOPPLER is available
 */
export async function initDoppler() {
  if (DopplerCapabilities.initialized) {
    return DopplerCapabilities.available;
  }

  try {
    console.log('[Doppler] Initializing...');

    // Check WebGPU availability
    if (!navigator.gpu) {
      console.warn('[Doppler] WebGPU not available');
      DopplerCapabilities.initialized = true;
      return false;
    }

    // Probe memory capabilities
    const memCaps = await getMemoryCapabilities();
    DopplerCapabilities.HAS_MEMORY64 = memCaps.hasMemory64;
    DopplerCapabilities.IS_UNIFIED_MEMORY = memCaps.isUnifiedMemory;

    // Initialize WebGPU device
    const device = await initDevice();
    if (!device) {
      console.warn('[Doppler] Failed to initialize WebGPU device');
      DopplerCapabilities.initialized = true;
      return false;
    }

    // Get GPU capabilities
    const gpuCaps = getKernelCapabilities();
    DopplerCapabilities.HAS_SUBGROUPS = gpuCaps.hasSubgroups;
    DopplerCapabilities.HAS_F16 = gpuCaps.hasF16;

    // Initialize OPFS
    await initOPFS();

    // Request persistent storage
    await requestPersistence();

    // Initialize heap manager
    const heapManager = getHeapManager();
    await heapManager.init();

    // Determine tier level and max model size
    if (memCaps.isUnifiedMemory) {
      DopplerCapabilities.TIER_LEVEL = 1;
      DopplerCapabilities.TIER_NAME = 'Unified Memory';
      DopplerCapabilities.MAX_MODEL_SIZE = 60 * 1024 * 1024 * 1024; // 60GB
    } else if (memCaps.hasMemory64) {
      DopplerCapabilities.TIER_LEVEL = 2;
      DopplerCapabilities.TIER_NAME = 'Memory64';
      DopplerCapabilities.MAX_MODEL_SIZE = 40 * 1024 * 1024 * 1024; // 40GB MoE
    } else {
      DopplerCapabilities.TIER_LEVEL = 3;
      DopplerCapabilities.TIER_NAME = 'Basic';
      DopplerCapabilities.MAX_MODEL_SIZE = 8 * 1024 * 1024 * 1024; // 8GB small MoE
    }

    DopplerCapabilities.available = true;
    DopplerCapabilities.initialized = true;

    console.log('[Doppler] Initialized successfully:', DopplerCapabilities);
    return true;
  } catch (err) {
    console.error('[Doppler] Init failed:', err);
    DopplerCapabilities.initialized = true;
    DopplerCapabilities.available = false;
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
  if (!DopplerCapabilities.available) {
    throw new Error('DOPPLER not initialized. Call initDoppler() first.');
  }

  try {
    console.log(`[Doppler] Loading model: ${modelId}`);

    let manifest = null;
    let useBridge = false;

    // Check if we should use Native Bridge for local path access
    if (localPath && isBridgeAvailable()) {
      console.log(`[Doppler] Using Native Bridge for local path: ${localPath}`);
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

        console.log(`[Doppler] Loaded manifest via bridge: ${manifest.modelId}`);
        if (onProgress) onProgress({ stage: 'manifest', message: 'Manifest loaded via bridge' });

        // Store bridge client and local path for shard access during inference
        DopplerCapabilities.bridgeClient = bridgeClient;
        DopplerCapabilities.localPath = localPath;
      } catch (err) {
        console.error('[Doppler] Failed to load via bridge:', err);
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
        console.log(`[Doppler] Model not cached, downloading from ${modelUrl}`);
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

    // Hardware/model UX estimate (approximate)
    try {
      const mc = extractTextModelConfig(manifest);
      const kvBytes = mc.numLayers * mc.maxSeqLen * mc.numKVHeads * mc.headDim * 4 * 2;
      const weightBytes = estimateDequantizedWeightsBytes(manifest);
      const estimate = {
        weightsBytes: weightBytes,
        kvCacheBytes: kvBytes,
        totalBytes: weightBytes + kvBytes,
        modelConfig: mc,
      };
      DopplerCapabilities.lastModelEstimate = estimate;

      const limits = getDeviceLimits();
      if (limits?.maxBufferSize && estimate.totalBytes > limits.maxBufferSize * 0.8) {
        console.warn('[Doppler] Estimated GPU usage near device limits');
      }
      onProgress?.({
        stage: 'estimate',
        message: 'Estimated GPU memory usage computed',
        estimate,
      });
    } catch (e) {
      console.warn('[Doppler] Failed to estimate GPU memory:', e.message);
    }

    // Check model size against capabilities
    if (manifest.totalSize > DopplerCapabilities.MAX_MODEL_SIZE) {
      throw new Error(
        `Model size ${manifest.totalSize} exceeds max ${DopplerCapabilities.MAX_MODEL_SIZE}`
      );
    }

    // Check if MoE required for dGPU
    if (!DopplerCapabilities.IS_UNIFIED_MEMORY && !manifest.moeConfig) {
      console.warn(
        '[Doppler] Dense model on discrete GPU - performance will be limited'
      );
    }

    // Prewarm kernels once per session
    if (!DopplerCapabilities.kernelsWarmed) {
      onProgress?.({ stage: 'warming', message: 'Warming GPU kernels...' });
      await prewarmKernels();
      DopplerCapabilities.kernelsWarmed = true;
    }

    // Kick off kernel auto-tuning in background (results cached per device)
    if (!DopplerCapabilities.kernelsTuned && typeof setTimeout !== 'undefined') {
      DopplerCapabilities.kernelsTuned = true;
      const tuneConfig = extractTextModelConfig(manifest);
      setTimeout(() => {
        autoTuneKernels(tuneConfig).catch((e) => {
          console.warn('[Doppler] Kernel auto-tune failed:', e.message);
        });
      }, 0);
    }

    // Initialize pipeline with current capabilities
    const gpuCaps = getKernelCapabilities();
    const memCaps = await getMemoryCapabilities();
    const { getDevice } = await import('./gpu/device.js');

    // Create shard loader - use bridge or OPFS based on how model was loaded
    let loadShardFn;
    if (useBridge && DopplerCapabilities.bridgeClient && DopplerCapabilities.localPath) {
      // Load shards via Native Bridge (mmap)
      const bridgeClient = DopplerCapabilities.bridgeClient;
      const basePath = DopplerCapabilities.localPath.endsWith('/')
        ? DopplerCapabilities.localPath
        : `${DopplerCapabilities.localPath}/`;

      loadShardFn = async (idx) => {
        const shardInfo = manifest.shards[idx];
        if (!shardInfo) throw new Error(`Invalid shard index: ${idx}`);
        const shardPath = `${basePath}${shardInfo.filename}`;
        console.log(`[Doppler] Loading shard ${idx} via bridge: ${shardPath}`);
        const data = await bridgeClient.read(shardPath, 0, shardInfo.size);
        return data;
      };
    } else {
      // Load shards from OPFS
      loadShardFn = (idx) => import('./storage/shard-manager.js').then(m => m.loadShard(idx));
    }

    // Determine base URL for loading assets (tokenizer.json, etc.)
    let baseUrl = null;
    if (useBridge && DopplerCapabilities.localPath) {
      // Native Bridge: construct file:// URL or leave null for relative path handling
      baseUrl = DopplerCapabilities.localPath;
    } else if (modelUrl) {
      // Remote model: use the model URL as base
      baseUrl = modelUrl;
    }
    // For OPFS, baseUrl stays null - tokenizer.json would be fetched from same origin

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
      },
      baseUrl,
    });

    currentModelId = modelId;
    DopplerCapabilities.currentModelId = modelId;
    console.log(`[Doppler] Model loaded: ${modelId}`);
    return true;
  } catch (err) {
    console.error('[Doppler] Failed to load model:', err);
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
  DopplerCapabilities.currentModelId = null;
  console.log('[Doppler] Model unloaded');
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
export async function dopplerChat(messages, options = {}) {
  // Format messages into prompt
  const prompt = messages
    .map((m) => {
      if (m.role === 'system') return `System: ${m.content}`;
      if (m.role === 'user') return `User: ${m.content}`;
      if (m.role === 'assistant') return `Assistant: ${m.content}`;
      return m.content;
    })
    .join('\n') + '\nAssistant:';

  // Count prompt tokens using pipeline's tokenizer
  let promptTokens = 0;
  if (pipeline && pipeline.tokenizer) {
    try {
      const encoded = pipeline.tokenizer.encode(prompt);
      promptTokens = encoded.length;
    } catch (e) {
      console.warn('[Doppler] Failed to count prompt tokens:', e.message);
    }
  }

  const tokens = [];
  for await (const token of generate(prompt, options)) {
    tokens.push(token);
  }

  return {
    content: tokens.join(''),
    usage: {
      promptTokens,
      completionTokens: tokens.length,
      totalTokens: promptTokens + tokens.length,
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
export async function getDopplerStorageInfo() {
  // Provide quota + OPFS report
  return getStorageReport();
}

/**
 * Cleanup DOPPLER resources
 */
export async function destroyDoppler() {
  await unloadModel();
  destroyDevice();

  // Disconnect bridge client if connected
  if (DopplerCapabilities.bridgeClient) {
    DopplerCapabilities.bridgeClient.disconnect();
    DopplerCapabilities.bridgeClient = null;
    DopplerCapabilities.localPath = null;
  }

  DopplerCapabilities.initialized = false;
  DopplerCapabilities.available = false;
  console.log('[Doppler] Destroyed');
}

/**
 * Provider definition for llm-client.js
 */
export const DopplerProvider = {
  name: 'doppler',
  displayName: 'DOPPLER',
  isLocal: true,

  async init() {
    return initDoppler();
  },

  async loadModel(modelId, modelUrl, onProgress, localPath) {
    return loadModel(modelId, modelUrl, onProgress, localPath);
  },

  async chat(messages, options) {
    return dopplerChat(messages, options);
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
    return DopplerCapabilities;
  },

  async getModels() {
    return getAvailableModels();
  },

  async destroy() {
    return destroyDoppler();
  },
};

export default DopplerProvider;
