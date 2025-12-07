/**
 * TitanLoader - Core Model Loader
 * Phase 1: Foundation
 *
 * Orchestrates the complete model loading pipeline:
 * - Storage: Load shards from OPFS
 * - Memory: Stage in heap (Memory64 or segmented)
 * - GPU: Transfer to VRAM for compute
 *
 * @module loader/titan-loader
 */

import { getMemoryCapabilities } from '../memory/capability.js';
import { detectUnifiedMemory } from '../memory/unified-detect.js';
import { HeapManager, getHeapManager } from '../memory/heap-manager.js';
import {
  initOPFS,
  openModelDirectory,
  loadShard,
  loadShardSync,
  verifyIntegrity,
  loadManifestFromOPFS,
} from '../storage/shard-manager.js';
import { parseManifest, getShardInfo, getShardCount, isMoE } from '../storage/rpl-format.js';
import { initDevice, getDevice, getKernelCapabilities, getDeviceLimits } from '../gpu/device.js';
import { acquireBuffer, releaseBuffer } from '../gpu/buffer-pool.js';
import { dequantize } from '../gpu/kernel-selector.js';

/**
 * Tensor location in loaded model
 * @typedef {Object} TensorLocation
 * @property {number} shardIndex - Shard containing this tensor
 * @property {number} offset - Byte offset within shard
 * @property {number} size - Tensor size in bytes
 * @property {number[]} shape - Tensor dimensions
 * @property {string} dtype - Data type (F32, F16, Q4_K_M, etc.)
 */

/**
 * Loaded layer weights
 * @typedef {Object} LayerWeights
 * @property {GPUBuffer|Float32Array} inputNorm - Input layer norm weights
 * @property {GPUBuffer|Float32Array} qProj - Query projection
 * @property {GPUBuffer|Float32Array} kProj - Key projection
 * @property {GPUBuffer|Float32Array} vProj - Value projection
 * @property {GPUBuffer|Float32Array} oProj - Output projection
 * @property {GPUBuffer|Float32Array} postNorm - Post-attention norm
 * @property {GPUBuffer|Float32Array} ffnGate - FFN gate projection
 * @property {GPUBuffer|Float32Array} ffnUp - FFN up projection
 * @property {GPUBuffer|Float32Array} ffnDown - FFN down projection
 */

/**
 * TitanLoader class
 */
export class TitanLoader {
  constructor() {
    // Capabilities
    this.memoryCapabilities = null;
    this.gpuCapabilities = null;
    this.isUnifiedMemory = false;

    // Manifest and model info
    this.manifest = null;
    this.modelId = null;
    this.isMoE = false;

    // Loaded state
    this.isLoaded = false;
    this.embeddings = null;
    this.layers = new Map(); // layerIdx -> LayerWeights
    this.experts = new Map(); // `layer_${l}_expert_${e}` -> weights
    this.lmHead = null;
    this.finalNorm = null;

    // Memory management
    this.heapManager = null;
    this.gpuBuffers = new Set();

    // Loading state
    this.loadedShards = new Set();
    this.tensorLocations = new Map(); // tensorName -> TensorLocation
  }

  /**
   * Initialize loader and detect capabilities
   * @returns {Promise<void>}
   */
  async init() {
    console.log('[TitanLoader] Initializing...');

    // Detect memory capabilities
    this.memoryCapabilities = await getMemoryCapabilities();
    this.isUnifiedMemory = await detectUnifiedMemory();

    // Initialize GPU
    const device = await initDevice();
    if (!device) {
      throw new Error('Failed to initialize WebGPU device');
    }
    this.gpuCapabilities = getKernelCapabilities();

    // Initialize heap manager
    this.heapManager = getHeapManager();
    await this.heapManager.init();

    // Initialize OPFS
    await initOPFS();

    console.log('[TitanLoader] Initialized:', {
      memory64: this.memoryCapabilities.hasMemory64,
      unified: this.isUnifiedMemory,
      f16: this.gpuCapabilities.hasF16,
      subgroups: this.gpuCapabilities.hasSubgroups,
    });
  }

  /**
   * Load model from OPFS
   * @param {string} modelId - Model identifier
   * @param {Object} [options] - Loading options
   * @param {Function} [options.onProgress] - Progress callback
   * @param {boolean} [options.verifyHashes] - Verify shard hashes (default: true)
   * @returns {Promise<Object>} Model config
   */
  async load(modelId, options = {}) {
    const { onProgress = null, verifyHashes = true } = options;

    if (!this.heapManager) {
      await this.init();
    }

    console.log(`[TitanLoader] Loading model: ${modelId}`);
    this.modelId = modelId;

    // Open model directory
    await openModelDirectory(modelId);

    // Load and parse manifest
    const manifestJson = await loadManifestFromOPFS();
    this.manifest = parseManifest(manifestJson);

    // Check model type
    this.isMoE = isMoE();

    // Enforce dense/MoE gating based on hardware
    if (!this.isMoE && !this.isUnifiedMemory) {
      console.warn(
        '[TitanLoader] Dense model on discrete GPU - performance will be severely limited. ' +
        'Consider using an MoE model for better performance.'
      );
    }

    // Verify integrity if requested
    if (verifyHashes) {
      const integrity = await verifyIntegrity();
      if (!integrity.valid) {
        throw new Error(
          `Model integrity check failed. ` +
          `Missing shards: ${integrity.missingShards.length}, ` +
          `Corrupt shards: ${integrity.corruptShards.length}`
        );
      }
    }

    // Build tensor location map from manifest
    this._buildTensorLocations();

    // Report progress
    if (onProgress) {
      onProgress({ stage: 'manifest', progress: 0.05 });
    }

    // Load embeddings (always needed)
    await this._loadEmbeddings(onProgress);

    // Load layers
    const numLayers = this.manifest.config?.num_hidden_layers ||
                      this.manifest.config?.n_layer || 32;

    for (let l = 0; l < numLayers; l++) {
      await this._loadLayer(l, onProgress);

      if (onProgress) {
        const layerProgress = 0.1 + (l / numLayers) * 0.8;
        onProgress({ stage: 'layers', layer: l, total: numLayers, progress: layerProgress });
      }
    }

    // Load final norm and LM head
    await this._loadFinalWeights(onProgress);

    if (onProgress) {
      onProgress({ stage: 'complete', progress: 1.0 });
    }

    this.isLoaded = true;
    console.log(`[TitanLoader] Model loaded: ${modelId}`);

    return this.manifest.config;
  }

  /**
   * Build tensor location map from manifest
   * @private
   */
  _buildTensorLocations() {
    if (!this.manifest.tensors) {
      console.warn('[TitanLoader] No tensor locations in manifest');
      return;
    }

    for (const [name, info] of Object.entries(this.manifest.tensors)) {
      this.tensorLocations.set(name, {
        shardIndex: info.shard,
        offset: info.offset,
        size: info.size,
        shape: info.shape,
        dtype: info.dtype,
      });
    }
  }

  /**
   * Load a tensor by name
   * @private
   */
  async _loadTensor(name, toGPU = true) {
    const location = this.tensorLocations.get(name);
    if (!location) {
      // Try alternative naming conventions
      const altName = this._findAlternativeTensorName(name);
      if (altName) {
        return this._loadTensor(altName, toGPU);
      }
      console.warn(`[TitanLoader] Tensor not found: ${name}`);
      return null;
    }

    // Load shard if not already loaded
    let shardData;
    if (location.spans) {
      // Tensor spans multiple shards
      const chunks = [];
      for (const span of location.spans) {
        const data = await loadShard(span.shardIndex);
        chunks.push(new Uint8Array(data, span.offset, span.size));
      }
      // Combine chunks
      const totalSize = chunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      shardData = combined.buffer;
    } else {
      const fullShard = await loadShard(location.shardIndex);
      shardData = fullShard.slice(location.offset, location.offset + location.size);
    }

    // Handle quantized data
    if (location.dtype === 'Q4_K_M' || location.dtype === 'Q4_K') {
      if (toGPU) {
        // Dequantize on GPU
        const device = getDevice();
        const quantBuffer = acquireBuffer(location.size, undefined, `quant_${name}`);
        device.queue.writeBuffer(quantBuffer, 0, new Uint8Array(shardData));

        const numBlocks = Math.ceil(location.size / 144); // Q4_K_M: 144 bytes per block
        const dequantized = await dequantize(quantBuffer, numBlocks);

        releaseBuffer(quantBuffer);
        this.gpuBuffers.add(dequantized);
        return dequantized;
      } else {
        // Return raw quantized data for CPU processing
        return new Uint8Array(shardData);
      }
    }

    // Handle F32/F16 data
    if (toGPU) {
      const device = getDevice();
      const buffer = acquireBuffer(location.size, undefined, name);
      device.queue.writeBuffer(buffer, 0, new Uint8Array(shardData));
      this.gpuBuffers.add(buffer);
      return buffer;
    } else {
      if (location.dtype === 'F16') {
        // Convert F16 to F32 for CPU
        const f16 = new Uint16Array(shardData);
        const f32 = new Float32Array(f16.length);
        for (let i = 0; i < f16.length; i++) {
          f32[i] = this._f16ToF32(f16[i]);
        }
        return f32;
      }
      return new Float32Array(shardData);
    }
  }

  /**
   * Find alternative tensor name (handles different naming conventions)
   * @private
   */
  _findAlternativeTensorName(name) {
    // Common naming patterns
    const patterns = [
      [/^layers\.(\d+)\./, 'model.layers.$1.'],
      [/^model\.layers\.(\d+)\./, 'layers.$1.'],
      [/\.weight$/, ''],
      [/$/, '.weight'],
      [/attention/, 'self_attn'],
      [/self_attn/, 'attention'],
      [/ffn/, 'mlp'],
      [/mlp/, 'ffn'],
    ];

    for (const [pattern, replacement] of patterns) {
      const altName = name.replace(pattern, replacement);
      if (altName !== name && this.tensorLocations.has(altName)) {
        return altName;
      }
    }
    return null;
  }

  /**
   * Convert F16 to F32
   * @private
   */
  _f16ToF32(h) {
    const sign = (h >> 15) & 0x1;
    const exp = (h >> 10) & 0x1f;
    const mant = h & 0x3ff;

    if (exp === 0) {
      if (mant === 0) return sign ? -0 : 0;
      // Denormal
      const f = mant / 1024 * Math.pow(2, -14);
      return sign ? -f : f;
    }
    if (exp === 31) {
      return mant ? NaN : (sign ? -Infinity : Infinity);
    }

    const f = (1 + mant / 1024) * Math.pow(2, exp - 15);
    return sign ? -f : f;
  }

  /**
   * Load embedding weights
   * @private
   */
  async _loadEmbeddings(onProgress) {
    console.log('[TitanLoader] Loading embeddings...');

    const embeddingNames = [
      'embed_tokens.weight',
      'model.embed_tokens.weight',
      'wte.weight',
      'transformer.wte.weight',
    ];

    for (const name of embeddingNames) {
      const tensor = await this._loadTensor(name, true);
      if (tensor) {
        this.embeddings = tensor;
        break;
      }
    }

    if (!this.embeddings) {
      console.warn('[TitanLoader] Embeddings not found, will use placeholder');
    }
  }

  /**
   * Load a single layer's weights
   * @private
   */
  async _loadLayer(layerIdx, onProgress) {
    const prefix = `layers.${layerIdx}`;
    const altPrefix = `model.layers.${layerIdx}`;

    const weights = {
      inputNorm: null,
      qProj: null,
      kProj: null,
      vProj: null,
      oProj: null,
      postNorm: null,
      ffnGate: null,
      ffnUp: null,
      ffnDown: null,
    };

    // Input norm
    weights.inputNorm = await this._loadTensor(`${prefix}.input_layernorm.weight`) ||
                        await this._loadTensor(`${altPrefix}.input_layernorm.weight`);

    // Attention projections
    weights.qProj = await this._loadTensor(`${prefix}.self_attn.q_proj.weight`) ||
                    await this._loadTensor(`${prefix}.attention.wq.weight`);
    weights.kProj = await this._loadTensor(`${prefix}.self_attn.k_proj.weight`) ||
                    await this._loadTensor(`${prefix}.attention.wk.weight`);
    weights.vProj = await this._loadTensor(`${prefix}.self_attn.v_proj.weight`) ||
                    await this._loadTensor(`${prefix}.attention.wv.weight`);
    weights.oProj = await this._loadTensor(`${prefix}.self_attn.o_proj.weight`) ||
                    await this._loadTensor(`${prefix}.attention.wo.weight`);

    // Post-attention norm
    weights.postNorm = await this._loadTensor(`${prefix}.post_attention_layernorm.weight`) ||
                       await this._loadTensor(`${altPrefix}.post_attention_layernorm.weight`);

    // FFN weights (for dense layers)
    if (!this.isMoE || !this._isExpertLayer(layerIdx)) {
      weights.ffnGate = await this._loadTensor(`${prefix}.mlp.gate_proj.weight`) ||
                        await this._loadTensor(`${prefix}.feed_forward.w1.weight`);
      weights.ffnUp = await this._loadTensor(`${prefix}.mlp.up_proj.weight`) ||
                      await this._loadTensor(`${prefix}.feed_forward.w3.weight`);
      weights.ffnDown = await this._loadTensor(`${prefix}.mlp.down_proj.weight`) ||
                        await this._loadTensor(`${prefix}.feed_forward.w2.weight`);
    }

    this.layers.set(layerIdx, weights);
  }

  /**
   * Check if layer uses MoE
   * @private
   */
  _isExpertLayer(layerIdx) {
    // All layers are MoE in Mixtral-style models
    // Some models have dense layers interleaved
    return this.isMoE;
  }

  /**
   * Load expert weights on demand
   * @param {number} layerIdx
   * @param {number} expertIdx
   * @returns {Promise<Object>} Expert weights
   */
  async loadExpert(layerIdx, expertIdx) {
    const key = `layer_${layerIdx}_expert_${expertIdx}`;
    if (this.experts.has(key)) {
      return this.experts.get(key);
    }

    console.log(`[TitanLoader] Loading expert ${expertIdx} for layer ${layerIdx}`);

    const prefix = `layers.${layerIdx}.block_sparse_moe.experts.${expertIdx}`;
    const altPrefix = `model.layers.${layerIdx}.block_sparse_moe.experts.${expertIdx}`;

    const weights = {
      gate: await this._loadTensor(`${prefix}.w1.weight`) ||
            await this._loadTensor(`${altPrefix}.w1.weight`),
      up: await this._loadTensor(`${prefix}.w3.weight`) ||
          await this._loadTensor(`${altPrefix}.w3.weight`),
      down: await this._loadTensor(`${prefix}.w2.weight`) ||
            await this._loadTensor(`${altPrefix}.w2.weight`),
    };

    this.experts.set(key, weights);
    return weights;
  }

  /**
   * Load final layer norm and LM head
   * @private
   */
  async _loadFinalWeights(onProgress) {
    console.log('[TitanLoader] Loading final weights...');

    // Final norm
    this.finalNorm = await this._loadTensor('model.norm.weight') ||
                     await this._loadTensor('norm.weight') ||
                     await this._loadTensor('transformer.ln_f.weight');

    // LM head
    this.lmHead = await this._loadTensor('lm_head.weight') ||
                  await this._loadTensor('output.weight');
  }

  /**
   * Get layer weights
   * @param {number} layerIdx
   * @returns {LayerWeights|null}
   */
  getLayerWeights(layerIdx) {
    return this.layers.get(layerIdx) || null;
  }

  /**
   * Get model configuration
   * @returns {Object}
   */
  getConfig() {
    return this.manifest?.config || {};
  }

  /**
   * Check if using unified memory (can run dense models efficiently)
   * @returns {boolean}
   */
  canRunDense() {
    return this.isUnifiedMemory;
  }

  /**
   * Get loading statistics
   * @returns {Object}
   */
  getStats() {
    return {
      modelId: this.modelId,
      isLoaded: this.isLoaded,
      isMoE: this.isMoE,
      isUnifiedMemory: this.isUnifiedMemory,
      layersLoaded: this.layers.size,
      expertsLoaded: this.experts.size,
      gpuBuffers: this.gpuBuffers.size,
    };
  }

  /**
   * Unload model and free resources
   */
  async unload() {
    console.log('[TitanLoader] Unloading model...');

    // Release GPU buffers
    for (const buffer of this.gpuBuffers) {
      releaseBuffer(buffer);
    }
    this.gpuBuffers.clear();

    // Clear state
    this.embeddings = null;
    this.layers.clear();
    this.experts.clear();
    this.lmHead = null;
    this.finalNorm = null;
    this.manifest = null;
    this.modelId = null;
    this.isLoaded = false;
    this.tensorLocations.clear();

    console.log('[TitanLoader] Model unloaded');
  }
}

// Global loader instance
let globalLoader = null;

/**
 * Get global TitanLoader instance
 * @returns {TitanLoader}
 */
export function getTitanLoader() {
  if (!globalLoader) {
    globalLoader = new TitanLoader();
  }
  return globalLoader;
}

/**
 * Create new TitanLoader instance
 * @returns {TitanLoader}
 */
export function createTitanLoader() {
  return new TitanLoader();
}

export default TitanLoader;
