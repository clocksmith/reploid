/**
 * DopplerLoader - Core Model Loader
 * Phase 1: Foundation
 *
 * Orchestrates the complete model loading pipeline:
 * - Storage: Load shards from OPFS
 * - Memory: Stage in heap (Memory64 or segmented)
 * - GPU: Transfer to VRAM for compute
 *
 * @module loader/doppler-loader
 */

import { getMemoryCapabilities } from '../memory/capability.js';
import { detectUnifiedMemory } from '../memory/unified-detect.js';
import { HeapManager, getHeapManager } from '../memory/heap-manager.js';
import {
  initOPFS,
  openModelDirectory,
  loadShard as loadShardFromOPFS,
  loadShardSync,
  verifyIntegrity,
  loadManifestFromOPFS,
  computeHash,
} from '../storage/shard-manager.js';
import { parseManifest, getShardInfo, getShardCount, isMoE } from '../storage/rdrr-format.js';
import { initDevice, getDevice, getKernelCapabilities, getDeviceLimits } from '../gpu/device.js';
import { acquireBuffer, releaseBuffer } from '../gpu/buffer-pool.js';
import { dequantize, castF32ToF16 } from '../gpu/kernel-selector.js';
import { getBufferDtype } from '../gpu/buffer-dtypes.js';

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
 * DopplerLoader class
 */
export class DopplerLoader {
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

    // Shard cache (small LRU) to avoid repeated OPFS reads during load
    this.shardCache = new Map(); // shardIndex -> ArrayBuffer
    this.maxShardCacheEntries = 2;

    // Custom shard loader (for Native Bridge support)
    this.customLoadShard = null;
    this.verifyCustomShards = true;
  }

  /**
   * Set custom shard loader (e.g., for Native Bridge)
   * @param {Function} loadShardFn - async function(shardIndex) => Uint8Array
   * @param {Object} [options]
   * @param {boolean} [options.verify=true] - Verify shard hashes
   */
  setCustomShardLoader(loadShardFn, options = {}) {
    this.customLoadShard = loadShardFn;
    this.verifyCustomShards = options.verify !== false;
    console.log('[DopplerLoader] Custom shard loader configured');
  }

  /**
   * Load shard using custom loader or OPFS
   * @private
   */
  async _loadShard(shardIndex) {
    if (this.shardCache.has(shardIndex)) {
      const cached = this.shardCache.get(shardIndex);
      // Refresh LRU order
      this.shardCache.delete(shardIndex);
      this.shardCache.set(shardIndex, cached);
      return cached;
    }

    if (this.customLoadShard) {
      let data = await this.customLoadShard(shardIndex);

      // Verify hash if enabled
      if (this.verifyCustomShards && this.manifest) {
        const shardInfo = this.manifest.shards?.[shardIndex];
        // Support hash field (new) and blake3/sha256 fields (legacy)
        const expectedHash = shardInfo?.hash || shardInfo?.blake3 || shardInfo?.sha256;
        if (expectedHash) {
          // Use manifest's hashAlgorithm, default to blake3 for legacy manifests
          const algorithm = this.manifest.hashAlgorithm || 'blake3';
          const computedHash = await computeHash(data, algorithm);
          if (computedHash !== expectedHash) {
            throw new Error(
              `Shard ${shardIndex} hash mismatch. Expected: ${expectedHash}, got: ${computedHash}`
            );
          }
        }
      }

      // Normalize to ArrayBuffer for downstream slicing
      if (data instanceof Uint8Array) {
        data = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }

      this.shardCache.set(shardIndex, data);
      if (this.shardCache.size > this.maxShardCacheEntries) {
        const oldestKey = this.shardCache.keys().next().value;
        this.shardCache.delete(oldestKey);
      }

      return data;
    }
    const data = await loadShardFromOPFS(shardIndex);
    this.shardCache.set(shardIndex, data);
    if (this.shardCache.size > this.maxShardCacheEntries) {
      const oldestKey = this.shardCache.keys().next().value;
      this.shardCache.delete(oldestKey);
    }
    return data;
  }

  /**
   * Initialize loader and detect capabilities
   * @returns {Promise<void>}
   */
  async init() {
    console.log('[DopplerLoader] Initializing...');

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

    console.log('[DopplerLoader] Initialized:', {
      memory64: this.memoryCapabilities.hasMemory64,
      unified: this.isUnifiedMemory,
      f16: this.gpuCapabilities.hasF16,
      subgroups: this.gpuCapabilities.hasSubgroups,
    });
  }

  /**
   * Set manifest directly (for bridge/external loading)
   * @param {Object} manifest - Pre-loaded manifest
   */
  setManifest(manifest) {
    this.manifest = manifest;
    this.isMoE = manifest.moeConfig != null || manifest.config?.num_local_experts > 1;
    console.log('[DopplerLoader] Manifest set externally');
  }

  /**
   * Load model from OPFS or external source
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

    // Avoid cross-model contamination when reusing the global loader instance.
    // The shard cache is keyed only by shardIndex, so switching models without
    // clearing state can reuse wrong shard buffers and crash during span reads.
    const hasExistingModelState =
      this.isLoaded ||
      this.modelId !== null ||
      this.tensorLocations.size > 0 ||
      this.shardCache.size > 0 ||
      this.layers.size > 0 ||
      this.experts.size > 0 ||
      this.gpuBuffers.size > 0;

    // Preserve manifest if set externally (for custom shard loader)
    // It must be preserved BEFORE unload() clears it
    const preservedManifest = this.customLoadShard ? this.manifest : null;

    if (hasExistingModelState) {
      await this.unload();
    }

    // Restore preserved manifest after unload
    if (preservedManifest) {
      this.manifest = preservedManifest;
    }

    console.log(`[DopplerLoader] Loading model: ${modelId}`);
    this.modelId = modelId;

    // If using custom shard loader (bridge), manifest should be set externally
    // Skip OPFS operations in that case
    if (!this.customLoadShard) {
      // Open model directory
      await openModelDirectory(modelId);

      // Load and parse manifest
      const manifestJson = await loadManifestFromOPFS();
      this.manifest = parseManifest(manifestJson);
    }

    if (!this.manifest) {
      throw new Error('No manifest available. Set manifest via setManifest() or ensure OPFS has the model.');
    }

    // Check model type
    this.isMoE = this.manifest.moeConfig != null ||
                 this.manifest.config?.num_local_experts > 1 ||
                 isMoE();

    // Enforce dense/MoE gating based on hardware
    if (!this.isMoE && !this.isUnifiedMemory) {
      console.warn(
        '[DopplerLoader] Dense model on discrete GPU - performance will be severely limited. ' +
        'Consider using an MoE model for better performance.'
      );
    }

    // Verify integrity if requested (only for OPFS path)
    if (verifyHashes && !this.customLoadShard) {
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

    // Load layers - check nested text_config for multimodal models
    // GGUF uses blockCount instead of num_hidden_layers
    const numLayers = this.manifest.config?.num_hidden_layers ||
                      this.manifest.config?.blockCount ||  // GGUF naming
                      this.manifest.config?.text_config?.num_hidden_layers ||
                      this.manifest.config?.n_layer ||
                      this.manifest.architecture?.numLayers || 32;
    console.log(`[DopplerLoader] Loading ${numLayers} layers`);

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
    console.log(`[DopplerLoader] Model loaded: ${modelId}`);

    return this.manifest.config;
  }

  /**
   * Build tensor location map from manifest
   * @private
   */
  _buildTensorLocations() {
    // Ensure we don't retain stale tensor locations across model loads.
    this.tensorLocations.clear();

    if (!this.manifest.tensors) {
      console.warn('[DopplerLoader] No tensor locations in manifest');
      return;
    }

    for (const [name, info] of Object.entries(this.manifest.tensors)) {
      this.tensorLocations.set(name, {
        shardIndex: info.shard,
        offset: info.offset,
        size: info.size,
        shape: info.shape,
        dtype: info.dtype,
        spans: info.spans, // Include spans for multi-shard tensors
      });
    }
    console.log(`[DopplerLoader] Tensor map: ${this.tensorLocations.size} tensors`);
  }

  /**
   * Load a tensor by name
   * @param {string} name - Tensor name
   * @param {boolean} toGPU - Whether to upload to GPU
   * @param {boolean} silent - If true, don't warn on missing tensors
   * @private
   */
  async _loadTensor(name, toGPU = true, silent = false) {
    const location = this.tensorLocations.get(name);
    if (!location) {
      // Try alternative naming conventions
      const altName = this._findAlternativeTensorName(name);
      if (altName) {
        return this._loadTensor(altName, toGPU, silent);
      }
      if (!silent) {
        console.warn(`[DopplerLoader] Tensor not found: ${name}`);
      }
      return null;
    }

    // Fast path for multi-shard tensors when uploading to GPU:
    // stream each span directly into a GPU buffer to avoid huge JS allocations.
    if (location.spans && toGPU) {
      const device = getDevice();
      if (!device) {
        console.warn('[DopplerLoader] GPU device not available; falling back to CPU assembly for multi-shard tensor');
      } else {
        // Quantized tensors: stream BF16/Q4 bytes into a quant buffer, then dequantize.
        if (location.dtype === 'Q4_K_M' || location.dtype === 'Q4_K') {
          const quantBuffer = acquireBuffer(location.size, undefined, `quant_${name}`);
          let tensorOffset = 0;
          for (const span of location.spans) {
            const data = await this._loadShard(span.shardIndex);
            if (span.offset + span.size > data.byteLength) {
              throw new Error(
                `[DopplerLoader] Shard ${span.shardIndex} too small for tensor "${name}" span. ` +
                `Need ${span.offset + span.size} bytes, have ${data.byteLength}. ` +
                `Possible stale shard cache or corrupt download.`
              );
            }
            const bytes = new Uint8Array(data, span.offset, span.size);
            device.queue.writeBuffer(quantBuffer, tensorOffset, bytes);
            tensorOffset += span.size;
          }

          const numBlocks = Math.ceil(location.size / 144); // Q4_K_M: 144 bytes per block
          const caps = this.gpuCapabilities || getKernelCapabilities();
          const outputDtype =
            caps?.hasF16 && this._shouldDequantizeToF16(name) ? 'f16' : 'f32';
          const dequantized = await dequantize(quantBuffer, numBlocks, { outputDtype });

          // DEBUG: Log ALL layer 0 tensor names passing through Q4_K path
          if (name.includes('.0.')) {
            console.log(`[DEBUG] Q4_K tensor loaded: ${name}, numBlocks=${numBlocks}, size=${location.size}`);
          }

          // DEBUG: Verify first layer Q/K/V proj and FFN tensors (multi-shard path)
          if (name.includes('.0.') && (name.includes('q_proj') || name.includes('gate_proj'))) {
            // Re-assemble raw bytes for CPU verification
            const rawBytes = new Uint8Array(location.size);
            let rawOffset = 0;
            for (const span of location.spans) {
              const data = await this._loadShard(span.shardIndex);
              const bytes = new Uint8Array(data, span.offset, span.size);
              rawBytes.set(bytes, rawOffset);
              rawOffset += span.size;
            }
            await this._debugVerifyDequant(dequantized, rawBytes.buffer, numBlocks, outputDtype, name);
          }

          releaseBuffer(quantBuffer);
          this.gpuBuffers.add(dequantized);
          return dequantized;
        }

        // BF16 tensors: stream raw BF16 to GPU, then convert to f32 on GPU.
        if (location.dtype === 'BF16') {
          const srcBuffer = acquireBuffer(location.size, undefined, `${name}_bf16`);
          let tensorOffset = 0;
          for (const span of location.spans) {
            const data = await this._loadShard(span.shardIndex);
            if (span.offset + span.size > data.byteLength) {
              throw new Error(
                `[DopplerLoader] Shard ${span.shardIndex} too small for tensor "${name}" span. ` +
                `Need ${span.offset + span.size} bytes, have ${data.byteLength}. ` +
                `Possible stale shard cache or corrupt download.`
              );
            }
            const bytes = new Uint8Array(data, span.offset, span.size);
            device.queue.writeBuffer(srcBuffer, tensorOffset, bytes);
            tensorOffset += span.size;
          }

          const numElements = location.size / 2;
          const dstBuffer = await this._convertBF16ToF32GPU(srcBuffer, numElements, name);
          releaseBuffer(srcBuffer);
          this.gpuBuffers.add(dstBuffer);
          return dstBuffer;
        }

        // Other dtypes: stream bytes into final GPU buffer.
        const buffer = acquireBuffer(location.size, undefined, name);
        let tensorOffset = 0;
        for (const span of location.spans) {
          const data = await this._loadShard(span.shardIndex);
          if (span.offset + span.size > data.byteLength) {
            throw new Error(
              `[DopplerLoader] Shard ${span.shardIndex} too small for tensor "${name}" span. ` +
              `Need ${span.offset + span.size} bytes, have ${data.byteLength}. ` +
              `Possible stale shard cache or corrupt download.`
            );
          }
          const bytes = new Uint8Array(data, span.offset, span.size);
          device.queue.writeBuffer(buffer, tensorOffset, bytes);
          tensorOffset += span.size;
        }
        this.gpuBuffers.add(buffer);
        return buffer;
      }
    }

    // Load shard data into CPU memory (single-shard or CPU path)
    let shardData;
    if (location.spans) {
      // Tensor spans multiple shards - assemble in JS
      const chunks = [];
      for (const span of location.spans) {
        const data = await this._loadShard(span.shardIndex);
        if (span.offset + span.size > data.byteLength) {
          throw new Error(
            `[DopplerLoader] Shard ${span.shardIndex} too small for tensor "${name}" span. ` +
            `Need ${span.offset + span.size} bytes, have ${data.byteLength}. ` +
            `Possible stale shard cache or corrupt download.`
          );
        }
        chunks.push(new Uint8Array(data, span.offset, span.size));
      }
      const totalSize = chunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      shardData = combined.buffer;
    } else {
      const fullShard = await this._loadShard(location.shardIndex);
      shardData = fullShard.slice(location.offset, location.offset + location.size);
    }

    // Handle quantized data (single-shard or CPU path)
    if (location.dtype === 'Q4_K_M' || location.dtype === 'Q4_K') {
      if (toGPU) {
        const device = getDevice();
        const quantBuffer = acquireBuffer(location.size, undefined, `quant_${name}`);
        device.queue.writeBuffer(quantBuffer, 0, new Uint8Array(shardData));

        const numBlocks = Math.ceil(location.size / 144); // Q4_K_M: 144 bytes per block
        const caps = this.gpuCapabilities || getKernelCapabilities();
        const outputDtype =
          caps?.hasF16 && this._shouldDequantizeToF16(name) ? 'f16' : 'f32';
        const dequantized = await dequantize(quantBuffer, numBlocks, { outputDtype });

        // DEBUG: Log all layer 0 Q4_K tensors (single-shard path)
        if (name.includes('.0.')) {
          console.log(`[DEBUG] Q4_K single-shard tensor: ${name}, numBlocks=${numBlocks}`);
        }
        // DEBUG: Verify first q_proj and gate_proj tensor's dequantized values
        if ((name.includes('q_proj') || name.includes('gate_proj')) && name.includes('.0.')) {
          await this._debugVerifyDequant(dequantized, shardData, numBlocks, outputDtype, name);
        }

        releaseBuffer(quantBuffer);
        this.gpuBuffers.add(dequantized);
        return dequantized;
      }

      return new Uint8Array(shardData);
    }

    // Handle BF16 data - convert on GPU to avoid OOM
    if (location.dtype === 'BF16') {
      if (toGPU) {
        const device = getDevice();
        // Upload raw BF16 as bytes
        const bf16Bytes = new Uint8Array(shardData);
        const srcBuffer = acquireBuffer(bf16Bytes.byteLength, undefined, `${name}_bf16`);
        device.queue.writeBuffer(srcBuffer, 0, bf16Bytes);

        // Convert BF16→F32 on GPU
        const numElements = bf16Bytes.byteLength / 2;
        const dstBuffer = await this._convertBF16ToF32GPU(srcBuffer, numElements, name);
        releaseBuffer(srcBuffer);
        this.gpuBuffers.add(dstBuffer);
        return dstBuffer;
      }

      // CPU path - chunked to avoid OOM for large tensors
      const bf16 = new Uint16Array(shardData);
      const totalElements = bf16.length;
      const f32 = new Float32Array(totalElements);
      const tmp = new ArrayBuffer(4);
      const u32View = new Uint32Array(tmp);
      const f32View = new Float32Array(tmp);
      for (let i = 0; i < totalElements; i++) {
        u32View[0] = bf16[i] << 16;
        f32[i] = f32View[0];
      }
      return f32;
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
    // Try prefixes for multimodal models (e.g., Gemma 3)
    const prefixes = [
      'language_model.model.',  // Gemma 3 text model
      'language_model.',
      'model.',
      '',
    ];

    // Try direct prefix match first
    for (const prefix of prefixes) {
      const prefixedName = prefix + name;
      if (prefixedName !== name && this.tensorLocations.has(prefixedName)) {
        return prefixedName;
      }
    }

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
      // Also try with prefixes
      for (const prefix of prefixes) {
        const prefixedAlt = prefix + altName;
        if (this.tensorLocations.has(prefixedAlt)) {
          return prefixedAlt;
        }
      }
    }
    return null;
  }

  /**
   * Check if model requires (1 + weight) offset for RMSNorm weights
   *
   * Gemma 3+ models use (1 + weight) * normalized instead of weight * normalized.
   * - Safetensors from HuggingFace: Weights are the offset, need to add +1 at runtime
   * - GGUF from llama.cpp: Already has +1 baked in, do NOT add again
   *
   * We detect this by checking if the manifest has sourceFormat='gguf' (set by convert-cli).
   * If not specified, we check the architecture - Gemma 3 from safetensors needs offset.
   *
   * @private
   */
  _needsNormWeightOffset() {
    if (!this.manifest) return false;

    // Check if manifest specifies the source format
    const sourceFormat = this.manifest.sourceFormat;
    if (sourceFormat === 'gguf') {
      // GGUF files have +1 baked in by llama.cpp's converter
      if (!this._normOffsetLogged) {
        this._normOffsetLogged = true;
        console.log('[DopplerLoader] GGUF source: +1 offset already baked in, skipping');
      }
      return false;
    }

    // Check if this is a Gemma 3+ model (architecture contains "Gemma3")
    const config = this.manifest.config || {};
    const arch = config.architectures?.[0] || this.manifest.architecture || '';
    const isGemma3 = arch.includes('Gemma3') || config.model_type?.includes('gemma3');

    if (isGemma3) {
      // Gemma 3 from safetensors needs +1 offset
      if (!this._normOffsetLogged) {
        this._normOffsetLogged = true;
        console.log('[DopplerLoader] Gemma 3 from safetensors: applying +1 norm weight offset');
      }
      return true;
    }

    return false;
  }

  /**
   * Apply +1 offset to norm weights for Gemma 3+ models
   * Returns a new GPUBuffer with offset applied
   * @private
   */
  async _applyNormWeightOffset(tensor) {
    const device = getDevice();
    if (!device) {
      console.warn('[DopplerLoader] No GPU device for norm offset');
      return tensor;
    }

    // If tensor is a GPUBuffer, we need to read it back, add offset, and create new buffer
    if (tensor instanceof GPUBuffer) {
      const size = tensor.size;
      // Create staging buffer for readback
      const stagingBuffer = device.createBuffer({
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      // Copy GPU buffer to staging
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(tensor, 0, stagingBuffer, 0, size);
      device.queue.submit([encoder.finish()]);

      // Read back data
      await stagingBuffer.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
      stagingBuffer.unmap();
      stagingBuffer.destroy();

      // Apply +1 offset
      const offsetData = new Float32Array(data.length);
      for (let i = 0; i < data.length; i++) {
        offsetData[i] = 1.0 + data[i];
      }

      // Release original buffer and create new one
      releaseBuffer(tensor);
      const newBuffer = acquireBuffer(offsetData.byteLength, undefined, 'norm_offset');
      device.queue.writeBuffer(newBuffer, 0, offsetData);
      return newBuffer;
    }

    // If tensor is a typed array, just add offset
    if (tensor instanceof Float32Array) {
      const offsetData = new Float32Array(tensor.length);
      for (let i = 0; i < tensor.length; i++) {
        offsetData[i] = 1.0 + tensor[i];
      }
      return offsetData;
    }

    console.warn('[DopplerLoader] Unknown tensor type for norm offset');
    return tensor;
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
   * Convert BF16 buffer to F32 on GPU
   * @param {GPUBuffer} srcBuffer - Source buffer containing BF16 data (as u16)
   * @param {number} numElements - Number of BF16 elements
   * @param {string} name - Name for the output buffer
   * @returns {Promise<GPUBuffer>} F32 output buffer
   * @private
   */
  async _convertBF16ToF32GPU(srcBuffer, numElements, name) {
    const { runBF16ToF32 } = await import('../gpu/kernel-selector.js');
    return runBF16ToF32(srcBuffer, numElements, name);
  }

  /**
   * Decide whether a quantized tensor should be dequantized directly to f16.
   * Only matmul weights benefit from f16 storage. Other tensors are consumed
   * by f32-only kernels (embeddings, norms, etc).
   * @param {string} name
   * @returns {boolean}
   * @private
   */
  _shouldDequantizeToF16(name) {
    const lower = name.toLowerCase();
    const matmulSuffixes = [
      'q_proj.weight',
      'k_proj.weight',
      'v_proj.weight',
      'o_proj.weight',
      'attention.wq.weight',
      'attention.wk.weight',
      'attention.wv.weight',
      'attention.wo.weight',
      'gate_proj.weight',
      'up_proj.weight',
      'down_proj.weight',
      'w1.weight',
      'w2.weight',
      'w3.weight',
      'lm_head.weight',
      'output.weight',
    ];

    return matmulSuffixes.some(suffix => lower.endsWith(suffix));
  }

  /**
   * Load embedding weights
   * @private
   */
  async _loadEmbeddings(onProgress) {
    const embeddingNames = [
      'language_model.model.embed_tokens.weight',  // Gemma 3 multimodal
      'model.embed_tokens.weight',
      'embed_tokens.weight',
      'token_embd.weight',  // GGUF naming
      'wte.weight',
      'transformer.wte.weight',
    ];

    for (const name of embeddingNames) {
      const tensor = await this._loadTensor(name, true, true);  // Silent mode
      if (tensor) {
        this.embeddings = tensor;
        break;
      }
    }

    if (!this.embeddings) {
      console.warn('[DopplerLoader] Embeddings not found');
    }
  }

  /**
   * Load a single layer's weights
   * @private
   */
  async _loadLayer(layerIdx, onProgress) {
    // Try different naming conventions (Gemma 3 multimodal, standard HF, LLaMA-style, GGUF)
    const prefixes = [
      `language_model.model.layers.${layerIdx}`,  // Gemma 3 multimodal
      `model.layers.${layerIdx}`,                  // Standard HuggingFace
      `layers.${layerIdx}`,                        // LLaMA-style
      `blk.${layerIdx}`,                           // GGUF naming
    ];

    const weights = {
      inputNorm: null,
      qProj: null,
      kProj: null,
      vProj: null,
      oProj: null,
      qNorm: null,
      kNorm: null,
      // Layer norms after attention / around FFN (Gemma-family, sandwich norms)
      postAttentionNorm: null,
      preFeedforwardNorm: null,
      postFeedforwardNorm: null,
      // Legacy aliases (kept for backward compatibility with older pipeline wiring)
      postNorm: null,
      postAttnNorm: null,
      ffnGate: null,
      ffnUp: null,
      ffnDown: null,
    };

    // Helper to try loading tensor with multiple prefixes (silent to avoid log spam)
    const tryLoad = async (suffixes) => {
      for (const prefix of prefixes) {
        for (const suffix of suffixes) {
          const tensor = await this._loadTensor(`${prefix}.${suffix}`, true, true);
          if (tensor) return tensor;
        }
      }
      return null;
    };

    // Helper to load norm weights with Gemma 3+ offset (1 + weight)
    const tryLoadNorm = async (suffixes) => {
      const tensor = await tryLoad(suffixes);
      if (!tensor) return null;

      // Check if this is a Gemma 3+ model that needs (1 + weight) offset
      if (this._needsNormWeightOffset()) {
        return this._applyNormWeightOffset(tensor);
      }
      return tensor;
    };

    // Input norm (HuggingFace and GGUF naming)
    weights.inputNorm = await tryLoadNorm(['input_layernorm.weight', 'attn_norm.weight']);

    // Attention projections (HuggingFace, LLaMA, and GGUF naming)
    weights.qProj = await tryLoad(['self_attn.q_proj.weight', 'attention.wq.weight', 'attn_q.weight']);
    weights.kProj = await tryLoad(['self_attn.k_proj.weight', 'attention.wk.weight', 'attn_k.weight']);
    weights.vProj = await tryLoad(['self_attn.v_proj.weight', 'attention.wv.weight', 'attn_v.weight']);
    weights.oProj = await tryLoad(['self_attn.o_proj.weight', 'attention.wo.weight', 'attn_output.weight']);

    // Optional Q/K norm weights (Gemma-family and similar)
    weights.qNorm = await tryLoadNorm(['self_attn.q_norm.weight', 'attn_q_norm.weight']);
    weights.kNorm = await tryLoadNorm(['self_attn.k_norm.weight', 'attn_k_norm.weight']);

    // Norms: Gemma 3 includes post_attention, pre_feedforward, and post_feedforward norms.
    weights.postAttentionNorm = await tryLoadNorm(['post_attention_layernorm.weight', 'post_attention_norm.weight']);
    weights.preFeedforwardNorm = await tryLoadNorm(['pre_feedforward_layernorm.weight', 'ffn_norm.weight']);
    weights.postFeedforwardNorm = await tryLoadNorm(['post_feedforward_layernorm.weight', 'post_ffw_norm.weight']);

    // Legacy aliases.
    weights.postNorm = weights.postAttentionNorm || weights.preFeedforwardNorm;
    weights.postAttnNorm = weights.postNorm;

    // FFN weights (for dense layers) - HuggingFace, LLaMA, and GGUF naming
    if (!this.isMoE || !this._isExpertLayer(layerIdx)) {
      weights.ffnGate = await tryLoad(['mlp.gate_proj.weight', 'feed_forward.w1.weight', 'ffn_gate.weight']);
      weights.ffnUp = await tryLoad(['mlp.up_proj.weight', 'feed_forward.w3.weight', 'ffn_up.weight']);
      weights.ffnDown = await tryLoad(['mlp.down_proj.weight', 'feed_forward.w2.weight', 'ffn_down.weight']);
    }

    // MoE router weights (for MoE layers)
    if (this.isMoE && this._isExpertLayer(layerIdx)) {
      // GPT-OSS naming: mlp.router.{weight,bias}
      // Mixtral naming: block_sparse_moe.gate.weight
      weights.routerWeight = await tryLoad([
        'mlp.router.weight',
        'block_sparse_moe.gate.weight',
      ]);
      weights.routerBias = await tryLoad([
        'mlp.router.bias',
      ]);
    }

    // Attention sinks (GPT-OSS: persistent anchor tokens for sliding window)
    weights.attentionSinks = await tryLoad([
      'self_attn.sinks',
    ]);

    this.layers.set(layerIdx, weights);

    // Downcast matmul weights to f16 when supported to reduce bandwidth/VRAM.
    const caps = getKernelCapabilities();
    if (caps.hasF16) {
      const matmulKeys = ['qProj', 'kProj', 'vProj', 'oProj', 'ffnGate', 'ffnUp', 'ffnDown'];
      for (const key of matmulKeys) {
        const buf = weights[key];
        if (buf instanceof GPUBuffer) {
          const dtype = getBufferDtype(buf) || 'f32';
          if (dtype === 'f32') {
            const elems = buf.size / 4;
            try {
              const f16buf = await castF32ToF16(buf, elems);
              releaseBuffer(buf);
              weights[key] = f16buf;
              this.gpuBuffers.add(f16buf);
            } catch (e) {
              console.warn(`[DopplerLoader] Failed to downcast ${key} to f16:`, e.message);
            }
          }
        }
      }
    }
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

    console.log(`[DopplerLoader] Loading expert ${expertIdx} for layer ${layerIdx}`);

    // Try Mixtral-style naming first (per-expert tensors)
    const prefix = `layers.${layerIdx}.block_sparse_moe.experts.${expertIdx}`;
    const altPrefix = `model.layers.${layerIdx}.block_sparse_moe.experts.${expertIdx}`;

    let weights = {
      gate: await this._loadTensor(`${prefix}.w1.weight`) ||
            await this._loadTensor(`${altPrefix}.w1.weight`),
      up: await this._loadTensor(`${prefix}.w3.weight`) ||
          await this._loadTensor(`${altPrefix}.w3.weight`),
      down: await this._loadTensor(`${prefix}.w2.weight`) ||
            await this._loadTensor(`${altPrefix}.w2.weight`),
    };

    // Try GPT-OSS naming if Mixtral naming not found (packed expert tensors with MXFP4)
    if (!weights.gate && !weights.up && !weights.down) {
      const gptOssPrefix = `model.layers.${layerIdx}.mlp.experts`;

      // GPT-OSS uses fused gate_up projection and MXFP4 quantization.
      // These tensors contain ALL experts, so load them once per layer and
      // return lightweight per-expert views to avoid duplicating huge buffers.
      const packedKey = `layer_${layerIdx}_gptoss_packed`;
      let packed = this.experts.get(packedKey);
      if (!packed) {
        const numExpertsFromConfig =
          this.manifest?.config?.num_local_experts ||
          this.manifest?.config?.num_experts ||
          32;

        packed = {
          isGptOss: true,
          numExperts: numExpertsFromConfig,
          gateUpBlocks: await this._loadTensor(`${gptOssPrefix}.gate_up_proj_blocks`),
          gateUpScales: await this._loadTensor(`${gptOssPrefix}.gate_up_proj_scales`),
          gateUpBias: await this._loadTensor(`${gptOssPrefix}.gate_up_proj_bias`),
          downBlocks: await this._loadTensor(`${gptOssPrefix}.down_proj_blocks`),
          downScales: await this._loadTensor(`${gptOssPrefix}.down_proj_scales`),
          downBias: await this._loadTensor(`${gptOssPrefix}.down_proj_bias`),
        };

        this.experts.set(packedKey, packed);
      }

      weights = {
        isGptOss: true,
        expertIdx,
        numExperts: packed.numExperts,
        gateUpBlocks: packed.gateUpBlocks,
        gateUpScales: packed.gateUpScales,
        gateUpBias: packed.gateUpBias,
        downBlocks: packed.downBlocks,
        downScales: packed.downScales,
        downBias: packed.downBias,
      };
    }

    // Downcast Mixtral-style F32 weights to F16 (skip for GPT-OSS MXFP4)
    if (!weights.isGptOss) {
      const caps = getKernelCapabilities();
      if (caps.hasF16) {
        for (const k of ['gate', 'up', 'down']) {
          const buf = weights[k];
          if (buf instanceof GPUBuffer) {
            const dtype = getBufferDtype(buf) || 'f32';
            if (dtype === 'f32') {
              const elems = buf.size / 4;
              try {
                const f16buf = await castF32ToF16(buf, elems);
                releaseBuffer(buf);
                weights[k] = f16buf;
                this.gpuBuffers.add(f16buf);
              } catch (e) {
                console.warn(`[DopplerLoader] Failed to downcast expert ${k} to f16:`, e.message);
              }
            }
          }
        }
      }
    }

    this.experts.set(key, weights);
    return weights;
  }

  /**
   * Load final layer norm and LM head
   * @private
   */
  async _loadFinalWeights(onProgress) {
    // Final norm (try Gemma 3 multimodal first, then standard, then GGUF)
    this.finalNorm = await this._loadTensor('language_model.model.norm.weight', true, true) ||
                     await this._loadTensor('model.norm.weight', true, true) ||
                     await this._loadTensor('norm.weight', true, true) ||
                     await this._loadTensor('output_norm.weight', true, true) ||  // GGUF naming
                     await this._loadTensor('transformer.ln_f.weight', true, true);

    // Apply Gemma 3+ norm offset if needed
    if (this.finalNorm && this._needsNormWeightOffset()) {
      this.finalNorm = await this._applyNormWeightOffset(this.finalNorm);
    }

    if (!this.finalNorm) {
      console.warn('[DopplerLoader] Final norm not found');
    }

    // LM head (try Gemma 3 multimodal first, then standard)
    this.lmHead = await this._loadTensor('language_model.lm_head.weight', true, true) ||
                  await this._loadTensor('lm_head.weight', true, true) ||
                  await this._loadTensor('output.weight', true, true);

    if (!this.lmHead && this.embeddings) {
      // Many models (Gemma, LLaMA) tie embeddings and lm_head - share the weight matrix
      console.log('[DopplerLoader] Using tied embeddings as LM head');
      this.lmHead = this.embeddings;
    } else if (!this.lmHead) {
      console.warn('[DopplerLoader] LM head not found');
    }

    // Downcast LM head to f16 if it is a standalone matmul weight.
    const caps = getKernelCapabilities();
    if (caps.hasF16 && this.lmHead instanceof GPUBuffer && this.lmHead !== this.embeddings) {
      const dtype = getBufferDtype(this.lmHead) || 'f32';
      if (dtype === 'f32') {
        try {
          const elems = this.lmHead.size / 4;
          const f16buf = await castF32ToF16(this.lmHead, elems);
          releaseBuffer(this.lmHead);
          this.lmHead = f16buf;
          this.gpuBuffers.add(f16buf);
        } catch (e) {
          console.warn('[DopplerLoader] Failed to downcast lmHead to f16:', e.message);
        }
      }
    }
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
   * DEBUG: Verify GPU dequantization against CPU reference
   * @private
   */
  async _debugVerifyDequant(gpuBuffer, rawData, numBlocks, outputDtype, name) {
    console.log(`[DEBUG] Verifying dequantization for ${name}`);
    console.log(`[DEBUG] numBlocks=${numBlocks}, outputDtype=${outputDtype}, rawBytes=${rawData.byteLength}`);

    const device = getDevice();

    // Read back GPU results
    const gpuSize = gpuBuffer.size;
    const readBuffer = device.createBuffer({
      size: gpuSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(gpuBuffer, 0, readBuffer, 0, gpuSize);
    device.queue.submit([commandEncoder.finish()]);

    await readBuffer.mapAsync(GPUMapMode.READ);
    let gpuData;
    if (outputDtype === 'f16') {
      // Read f16 data and convert to f32 for comparison
      const f16Data = new Uint16Array(readBuffer.getMappedRange().slice(0));
      gpuData = new Float32Array(f16Data.length);
      for (let i = 0; i < f16Data.length; i++) {
        gpuData[i] = this._f16ToF32(f16Data[i]);
      }
    } else {
      gpuData = new Float32Array(readBuffer.getMappedRange().slice(0));
    }
    readBuffer.unmap();
    readBuffer.destroy();

    // CPU reference implementation of Q4_K dequantization
    const rawBytes = new Uint8Array(rawData);
    const cpuData = new Float32Array(numBlocks * 256);

    // Q4_K block layout: 144 bytes per block
    // - d (f16, 2 bytes)
    // - dmin (f16, 2 bytes)
    // - scales (12 bytes) - 8 scales + 8 mins packed in 6 bits each
    // - qs (128 bytes) - 4-bit quantized values

    const QK_K = 256;
    const BLOCK_SIZE = 144;

    // Helper: unpack f16
    const unpackF16 = (lo, hi) => {
      const bits = lo | (hi << 8);
      const sign = (bits >> 15) & 0x1;
      const exp = (bits >> 10) & 0x1f;
      const mant = bits & 0x3ff;

      if (exp === 0) {
        if (mant === 0) return sign ? -0 : 0;
        const f = mant / 1024 * Math.pow(2, -14);
        return sign ? -f : f;
      }
      if (exp === 31) {
        return mant ? NaN : (sign ? -Infinity : Infinity);
      }
      const f = (1 + mant / 1024) * Math.pow(2, exp - 15);
      return sign ? -f : f;
    };

    // Helper: get scale/min for sub-block j (matching llama.cpp get_scale_min_k4)
    const getScaleMin = (scales, j) => {
      // scales is a 12-byte array
      let sc, mn;

      if (j < 4) {
        // Simple case: lower 6 bits
        sc = scales[j] & 63;
        mn = scales[j + 4] & 63;
      } else {
        // Complex case: 4 bits from bytes 8-11, upper 2 bits from bytes 0-7
        const q_j = scales[j + 4];  // bytes 8-11
        const q_lo = scales[j - 4]; // bytes 0-3 (for upper bits of scale)
        const q_hi = scales[j];     // bytes 4-7 (for upper bits of min)

        sc = (q_j & 0xF) | ((q_lo >> 6) << 4);
        mn = (q_j >> 4) | ((q_hi >> 6) << 4);
      }

      return [sc, mn];
    };

    // Helper: get 4-bit quantized value at index idx within a block
    // Q4_K nibble layout per 64-element chunk:
    //   - Elements 0-31: lower nibbles of 32 bytes
    //   - Elements 32-63: upper nibbles of same 32 bytes
    const getQ4 = (qs, idx) => {
      // Which 64-element chunk? (0-3)
      const chunk = Math.floor(idx / 64);
      // Position within chunk (0-63)
      const posInChunk = idx % 64;
      // First or second half of chunk?
      const useUpper = posInChunk >= 32;
      // Byte index within the 32-byte range for this chunk
      const byteInRange = useUpper ? posInChunk - 32 : posInChunk;
      // Absolute byte index
      const byteIdx = chunk * 32 + byteInRange;

      const byteVal = qs[byteIdx];

      if (useUpper) {
        return (byteVal >> 4) & 0xF;
      } else {
        return byteVal & 0xF;
      }
    };

    // Dequantize each block
    for (let block = 0; block < numBlocks; block++) {
      const blockOffset = block * BLOCK_SIZE;

      // Read d and dmin (packed f16 values)
      const d = unpackF16(rawBytes[blockOffset], rawBytes[blockOffset + 1]);
      const dmin = unpackF16(rawBytes[blockOffset + 2], rawBytes[blockOffset + 3]);

      // Read scales (12 bytes starting at offset 4)
      const scales = rawBytes.slice(blockOffset + 4, blockOffset + 16);

      // Read qs (128 bytes starting at offset 16)
      const qs = rawBytes.slice(blockOffset + 16, blockOffset + 144);

      // Dequantize 256 elements
      for (let i = 0; i < QK_K; i++) {
        const subblockIdx = Math.floor(i / 32);  // 0-7
        const [sc, mn] = getScaleMin(scales, subblockIdx);
        const scale = d * sc;
        const minVal = dmin * mn;

        const q = getQ4(qs, i);

        // llama.cpp formula: y = d * scale * q - dmin * min
        const dequant = scale * q - minVal;
        cpuData[block * QK_K + i] = dequant;
      }
    }

    // Compare first 32 values
    console.log('[DEBUG] First 32 values comparison:');
    console.log('[DEBUG] Block 0 raw bytes (first 32):', Array.from(rawBytes.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join(' '));

    // Show d, dmin, scales
    const d0 = unpackF16(rawBytes[0], rawBytes[1]);
    const dmin0 = unpackF16(rawBytes[2], rawBytes[3]);
    const scales0 = rawBytes.slice(4, 16);
    console.log(`[DEBUG] Block 0: d=${d0.toFixed(6)}, dmin=${dmin0.toFixed(6)}`);
    console.log(`[DEBUG] Block 0 scales bytes: ${Array.from(scales0).join(', ')}`);

    // Show decoded scale/min for each sub-block
    for (let j = 0; j < 8; j++) {
      const [sc, mn] = getScaleMin(scales0, j);
      console.log(`[DEBUG] Sub-block ${j}: sc=${sc}, mn=${mn}`);
    }

    let mismatchCount = 0;
    let maxError = 0;
    let maxErrorIdx = 0;

    for (let i = 0; i < Math.min(256, gpuData.length); i++) {
      const gpu = gpuData[i];
      const cpu = cpuData[i];
      const error = Math.abs(gpu - cpu);

      if (error > maxError) {
        maxError = error;
        maxErrorIdx = i;
      }

      if (i < 32) {
        const match = error < 0.001 ? '✓' : '✗';
        console.log(`[DEBUG] [${i}] GPU=${gpu.toFixed(6)}, CPU=${cpu.toFixed(6)}, err=${error.toFixed(6)} ${match}`);
      }

      if (error > 0.01) {
        mismatchCount++;
      }
    }

    // Summary
    console.log(`[DEBUG] Total mismatches (>0.01): ${mismatchCount}/${Math.min(256, gpuData.length)}`);
    console.log(`[DEBUG] Max error: ${maxError.toFixed(6)} at index ${maxErrorIdx}`);

    // Check if GPU and CPU are completely different
    const gpuMean = gpuData.slice(0, 256).reduce((a, b) => a + b, 0) / 256;
    const cpuMean = cpuData.slice(0, 256).reduce((a, b) => a + b, 0) / 256;
    console.log(`[DEBUG] GPU mean: ${gpuMean.toFixed(6)}, CPU mean: ${cpuMean.toFixed(6)}`);
  }

  /**
   * Unload model and free resources
   */
  async unload() {
    console.log('[DopplerLoader] Unloading model...');

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
    this.loadedShards.clear();
    this.isLoaded = false;
    this.tensorLocations.clear();
    this.shardCache.clear();

    console.log('[DopplerLoader] Model unloaded');
  }
}

// Global loader instance
let globalLoader = null;

/**
 * Get global DopplerLoader instance
 * @returns {DopplerLoader}
 */
export function getDopplerLoader() {
  if (!globalLoader) {
    globalLoader = new DopplerLoader();
  }
  return globalLoader;
}

/**
 * Create new DopplerLoader instance
 * @returns {DopplerLoader}
 */
export function createDopplerLoader() {
  return new DopplerLoader();
}

export default DopplerLoader;
