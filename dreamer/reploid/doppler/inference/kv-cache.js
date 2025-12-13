/**
 * kv-cache.js - KV Cache Management
 *
 * Implements efficient key-value cache for transformer inference.
 * Supports both contiguous and paged memory layouts.
 * GPU-native storage to avoid CPU readbacks during inference.
 *
 * @module inference/kv-cache
 */

import { getDevice } from '../gpu/device.js';
import { acquireBuffer, releaseBuffer, readBuffer } from '../gpu/buffer-pool.js';
import { getBufferDtype, setBufferDtype } from '../gpu/buffer-dtypes.js';

/**
 * KV Cache Configuration
 * @typedef {Object} KVCacheConfig
 * @property {number} numLayers - Number of transformer layers
 * @property {number} numHeads - Number of attention heads
 * @property {number} headDim - Dimension per head
 * @property {number} maxSeqLen - Maximum sequence length
 * @property {boolean} useGPU - Store cache on GPU
 * @property {'contiguous' | 'paged'} layout - Memory layout strategy
 * @property {number} pageSize - Page size for paged layout (default: 256)
 */

/**
 * Cache entry for a single layer
 * @typedef {Object} LayerCache
 * @property {Float32Array|GPUBuffer} keys - Key cache [seqLen, numHeads, headDim]
 * @property {Float32Array|GPUBuffer} values - Value cache [seqLen, numHeads, headDim]
 * @property {number} seqLen - Current sequence length in cache
 */

export class KVCache {
  /**
   * @param {KVCacheConfig} config
   */
  constructor(config) {
    this.numLayers = config.numLayers;
    this.numHeads = config.numHeads;
    this.headDim = config.headDim;
    this.maxSeqLen = config.maxSeqLen || 4096;
    this.useGPU = config.useGPU || false;
    this.layout = config.layout || 'contiguous';
    this.pageSize = config.pageSize || 256;
    this.kvDtype = config.kvDtype || 'f32';
    this.bytesPerElem = this.kvDtype === 'f16' ? 2 : 4;

    // Size of one KV pair per position
    this.kvSize = this.numHeads * this.headDim;

    // Initialize layer caches
    this.layers = new Array(this.numLayers);
    this.currentSeqLen = 0;

    // Memory usage tracking
    this.memoryUsage = 0;

    // GPU context (set externally)
    this.gpuContext = null;

    // Initialize storage
    this._initializeStorage();
  }

  /**
   * Initialize storage for all layers
   * @private
   */
  _initializeStorage() {
    if (this.layout === 'paged') {
      this._initializePagedStorage();
    } else {
      this._initializeContiguousStorage();
    }
  }

  /**
   * Initialize contiguous storage (pre-allocated)
   * @private
   */
  _initializeContiguousStorage() {
    const sizePerLayer = this.maxSeqLen * this.kvSize;
    const bytesPerLayer = sizePerLayer * this.bytesPerElem * 2; // K + V

    const device = this.useGPU ? getDevice() : null;

    for (let l = 0; l < this.numLayers; l++) {
      if (device && this.useGPU) {
        // GPU-native storage
        this.layers[l] = {
          keysGPU: device.createBuffer({
            label: `kv_cache_keys_layer_${l}`,
            size: sizePerLayer * this.bytesPerElem,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
          }),
          valuesGPU: device.createBuffer({
            label: `kv_cache_values_layer_${l}`,
            size: sizePerLayer * this.bytesPerElem,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
          }),
          // Keep CPU shadow for fallback/debugging
          keys: new Float32Array(sizePerLayer),
          values: new Float32Array(sizePerLayer),
          seqLen: 0
        };
        setBufferDtype(this.layers[l].keysGPU, this.kvDtype);
        setBufferDtype(this.layers[l].valuesGPU, this.kvDtype);
      } else {
        // CPU-only storage
        this.layers[l] = {
          keys: new Float32Array(sizePerLayer),
          values: new Float32Array(sizePerLayer),
          keysGPU: null,
          valuesGPU: null,
          seqLen: 0
        };
      }
      this.memoryUsage += bytesPerLayer;
    }
  }

  /**
   * Initialize paged storage (lazy allocation)
   * @private
   */
  _initializePagedStorage() {
    const numPages = Math.ceil(this.maxSeqLen / this.pageSize);

    for (let l = 0; l < this.numLayers; l++) {
      this.layers[l] = {
        keyPages: new Array(numPages).fill(null),
        valuePages: new Array(numPages).fill(null),
        allocatedPages: 0,
        seqLen: 0
      };
    }
  }

  /**
   * Allocate a new page for paged storage
   * @private
   * @returns {Float32Array}
   */
  _allocatePage() {
    const pageElements = this.pageSize * this.kvSize;
    const page = new Float32Array(pageElements);
    this.memoryUsage += pageElements * 4;
    return page;
  }

  /**
   * Get the page index and offset for a sequence position
   * @private
   * @param {number} pos - Sequence position
   * @returns {{pageIdx: number, offset: number}}
   */
  _getPageLocation(pos) {
    const pageIdx = Math.floor(pos / this.pageSize);
    const offset = (pos % this.pageSize) * this.kvSize;
    return { pageIdx, offset };
  }

  /**
   * Ensure pages are allocated up to the given position
   * @private
   * @param {number} layerIdx - Layer index
   * @param {number} pos - Sequence position
   */
  _ensurePagesAllocated(layerIdx, pos) {
    if (this.layout !== 'paged') return;

    const layer = this.layers[layerIdx];
    const neededPage = Math.floor(pos / this.pageSize);

    for (let p = layer.allocatedPages; p <= neededPage; p++) {
      if (!layer.keyPages[p]) {
        layer.keyPages[p] = this._allocatePage();
        layer.valuePages[p] = this._allocatePage();
        layer.allocatedPages = p + 1;
      }
    }
  }

  /**
   * Update cache with new key-value pairs for a layer
   * @param {number} layerIdx - Layer index
   * @param {Float32Array|GPUBuffer} keys - New keys [batchSize, numHeads, headDim]
   * @param {Float32Array|GPUBuffer} values - New values [batchSize, numHeads, headDim]
   * @param {number} startPos - Starting position in sequence
   */
  update(layerIdx, keys, values, startPos = this.currentSeqLen) {
    const numNewTokens = keys instanceof GPUBuffer
      ? keys.size / (this.kvSize * 4)
      : keys.length / this.kvSize;

    if (startPos + numNewTokens > this.maxSeqLen) {
      throw new Error(
        `Cache overflow: ${startPos + numNewTokens} > ${this.maxSeqLen}`
      );
    }

    const layer = this.layers[layerIdx];

    if (this.layout === 'paged') {
      this._updatePaged(layer, keys, values, startPos, numNewTokens);
    } else {
      this._updateContiguous(layer, keys, values, startPos, numNewTokens);
    }

    layer.seqLen = Math.max(layer.seqLen, startPos + numNewTokens);

    // Update global sequence length if this is the last layer
    if (layerIdx === this.numLayers - 1) {
      this.currentSeqLen = Math.max(this.currentSeqLen, startPos + numNewTokens);
    }
  }

  /**
   * Update cache directly from GPU buffers (zero-copy)
   * @param {number} layerIdx - Layer index
   * @param {GPUBuffer} keysBuffer - GPU buffer with new keys
   * @param {GPUBuffer} valuesBuffer - GPU buffer with new values
   * @param {number} startPos - Starting position in sequence
   * @param {number} numTokens - Number of tokens to update
   */
  updateFromGPU(layerIdx, keysBuffer, valuesBuffer, startPos, numTokens) {
    const layer = this.layers[layerIdx];
    const device = getDevice();

    if (!device || !layer.keysGPU) {
      throw new Error('GPU cache not initialized');
    }

    if (startPos + numTokens > this.maxSeqLen) {
      throw new Error(
        `Cache overflow: ${startPos + numTokens} > ${this.maxSeqLen}`
      );
    }

    if (this.kvDtype === 'f16') {
      const kd = getBufferDtype(keysBuffer);
      const vd = getBufferDtype(valuesBuffer);
      if (kd !== 'f16' || vd !== 'f16') {
        throw new Error('KV cache is f16 but source buffers are not f16');
      }
    }

    const byteOffset = startPos * this.kvSize * this.bytesPerElem;
    const byteSize = numTokens * this.kvSize * this.bytesPerElem;

    // Copy directly from source buffers to cache buffers
    const encoder = device.createCommandEncoder({ label: 'kv_cache_update' });
    encoder.copyBufferToBuffer(keysBuffer, 0, layer.keysGPU, byteOffset, byteSize);
    encoder.copyBufferToBuffer(valuesBuffer, 0, layer.valuesGPU, byteOffset, byteSize);
    device.queue.submit([encoder.finish()]);

    layer.seqLen = Math.max(layer.seqLen, startPos + numTokens);

    if (layerIdx === this.numLayers - 1) {
      this.currentSeqLen = Math.max(this.currentSeqLen, startPos + numTokens);
    }
  }

  /**
   * Update contiguous storage
   * @private
   */
  _updateContiguous(layer, keys, values, startPos, numNewTokens) {
    const offset = startPos * this.kvSize;
    const device = getDevice();

    // Handle GPU buffer inputs
    if (keys instanceof GPUBuffer) {
      // For GPU inputs, copy to GPU cache directly
      if (layer.keysGPU && device) {
        if (this.kvDtype === 'f16') {
          const kd = getBufferDtype(keys);
          const vd = getBufferDtype(values);
          if (kd !== 'f16' || vd !== 'f16') {
            throw new Error('KV cache is f16 but source buffers are not f16');
          }
        }

        const byteOffset = offset * this.bytesPerElem;
        const byteSize = numNewTokens * this.kvSize * this.bytesPerElem;
        const encoder = device.createCommandEncoder({ label: 'kv_update_gpu' });
        encoder.copyBufferToBuffer(keys, 0, layer.keysGPU, byteOffset, byteSize);
        encoder.copyBufferToBuffer(values, 0, layer.valuesGPU, byteOffset, byteSize);
        device.queue.submit([encoder.finish()]);
      }
      return;
    }

    // CPU path
    layer.keys.set(keys, offset);
    layer.values.set(values, offset);

    // Also update GPU if available
    if (layer.keysGPU && device) {
      if (this.kvDtype === 'f16') {
        throw new Error('CPU->GPU KV updates for f16 cache not implemented');
      }
      const byteOffset = offset * this.bytesPerElem;
      device.queue.writeBuffer(layer.keysGPU, byteOffset, keys);
      device.queue.writeBuffer(layer.valuesGPU, byteOffset, values);
    }
  }

  /**
   * Update paged storage
   * @private
   */
  _updatePaged(layer, keys, values, startPos, numNewTokens) {
    for (let t = 0; t < numNewTokens; t++) {
      const pos = startPos + t;
      this._ensurePagesAllocated(this.layers.indexOf(layer), pos);

      const { pageIdx, offset } = this._getPageLocation(pos);
      const srcOffset = t * this.kvSize;

      layer.keyPages[pageIdx].set(
        keys.subarray(srcOffset, srcOffset + this.kvSize),
        offset
      );
      layer.valuePages[pageIdx].set(
        values.subarray(srcOffset, srcOffset + this.kvSize),
        offset
      );
    }
  }

  /**
   * Get cached keys and values for a layer
   * @param {number} layerIdx - Layer index
   * @param {number} startPos - Start position (default: 0)
   * @param {number} endPos - End position (default: current length)
   * @returns {{keys: Float32Array, values: Float32Array}}
   */
  get(layerIdx, startPos = 0, endPos = null) {
    const layer = this.layers[layerIdx];
    endPos = endPos ?? layer.seqLen;

    if (this.layout === 'paged') {
      return this._getPaged(layer, startPos, endPos);
    } else {
      return this._getContiguous(layer, startPos, endPos);
    }
  }

  /**
   * Get GPU buffers for a layer (for GPU-native attention)
   * @param {number} layerIdx - Layer index
   * @returns {{keysGPU: GPUBuffer, valuesGPU: GPUBuffer, seqLen: number}|null}
   */
  getGPUBuffers(layerIdx) {
    const layer = this.layers[layerIdx];

    if (!layer.keysGPU || !layer.valuesGPU) {
      return null;
    }

    return {
      keysGPU: layer.keysGPU,
      valuesGPU: layer.valuesGPU,
      seqLen: layer.seqLen,
    };
  }

  /**
   * Check if GPU cache is available
   * @returns {boolean}
   */
  hasGPUCache() {
    return this.useGPU && this.layers[0]?.keysGPU != null;
  }

  /**
   * Get from contiguous storage
   * @private
   */
  _getContiguous(layer, startPos, endPos) {
    const startOffset = startPos * this.kvSize;
    const endOffset = endPos * this.kvSize;

    return {
      keys: layer.keys.subarray(startOffset, endOffset),
      values: layer.values.subarray(startOffset, endOffset)
    };
  }

  /**
   * Get from paged storage
   * @private
   */
  _getPaged(layer, startPos, endPos) {
    const length = (endPos - startPos) * this.kvSize;
    const keys = new Float32Array(length);
    const values = new Float32Array(length);

    let destOffset = 0;
    for (let pos = startPos; pos < endPos; pos++) {
      const { pageIdx, offset } = this._getPageLocation(pos);

      keys.set(
        layer.keyPages[pageIdx].subarray(offset, offset + this.kvSize),
        destOffset
      );
      values.set(
        layer.valuePages[pageIdx].subarray(offset, offset + this.kvSize),
        destOffset
      );

      destOffset += this.kvSize;
    }

    return { keys, values };
  }

  /**
   * Clear cache for all layers
   */
  clear() {
    this.currentSeqLen = 0;

    for (let l = 0; l < this.numLayers; l++) {
      const layer = this.layers[l];
      layer.seqLen = 0;

      if (this.layout === 'paged') {
        // Don't deallocate pages, just reset length
        // Pages will be reused
      } else {
        // Zero out contiguous arrays
        layer.keys.fill(0);
        layer.values.fill(0);
      }
    }
  }

  /**
   * Clone the cache (for speculative decoding rollback)
   * @returns {KVCache}
   */
  clone() {
    const cloned = new KVCache({
      numLayers: this.numLayers,
      numHeads: this.numHeads,
      headDim: this.headDim,
      maxSeqLen: this.maxSeqLen,
      useGPU: false, // Always clone to CPU
      layout: 'contiguous', // Simplify for clone
      pageSize: this.pageSize
    });

    cloned.currentSeqLen = this.currentSeqLen;

    for (let l = 0; l < this.numLayers; l++) {
      const { keys, values } = this.get(l);
      cloned.layers[l].keys.set(keys);
      cloned.layers[l].values.set(values);
      cloned.layers[l].seqLen = this.layers[l].seqLen;
    }

    return cloned;
  }

  /**
   * Truncate cache to a specific length (for rollback)
   * @param {number} length - New sequence length
   */
  truncate(length) {
    if (length >= this.currentSeqLen) return;

    this.currentSeqLen = length;
    for (let l = 0; l < this.numLayers; l++) {
      this.layers[l].seqLen = Math.min(this.layers[l].seqLen, length);
    }
  }

  /**
   * Get memory usage statistics
   * @returns {Object}
   */
  getMemoryStats() {
    const theoretical = this.numLayers * 2 * this.maxSeqLen * this.kvSize * 4;
    const actual = this.memoryUsage;
    const used = this.numLayers * 2 * this.currentSeqLen * this.kvSize * 4;

    return {
      theoretical: theoretical,
      allocated: actual,
      used: used,
      efficiency: used / actual,
      seqLen: this.currentSeqLen,
      maxSeqLen: this.maxSeqLen,
      layout: this.layout
    };
  }

  /**
   * Set GPU context for GPU-based caching
   * @param {Object} gpuContext - GPU context with device
   */
  setGPUContext(gpuContext) {
    this.gpuContext = gpuContext;

    // Migrate existing cache to GPU if we have data
    if (this.currentSeqLen > 0 && gpuContext?.device) {
      this._migrateToGPU(gpuContext.device);
    }
  }

  /**
   * Migrate existing CPU cache data to GPU buffers
   * @private
   * @param {GPUDevice} device - WebGPU device
   */
  _migrateToGPU(device) {
    if (this.layout === 'paged') {
      console.warn('[KVCache] GPU migration not supported for paged layout');
      return;
    }

    console.log(`[KVCache] Migrating ${this.currentSeqLen} positions to GPU...`);
    const sizePerLayer = this.maxSeqLen * this.kvSize;

    for (let l = 0; l < this.numLayers; l++) {
      const layer = this.layers[l];

      // Create GPU buffers if they don't exist
      if (!layer.keysGPU) {
        layer.keysGPU = device.createBuffer({
          label: `kv_cache_keys_layer_${l}`,
          size: sizePerLayer * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
      }
      if (!layer.valuesGPU) {
        layer.valuesGPU = device.createBuffer({
          label: `kv_cache_values_layer_${l}`,
          size: sizePerLayer * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
      }

      // Upload existing CPU data to GPU
      const usedSize = layer.seqLen * this.kvSize * 4;
      if (usedSize > 0) {
        device.queue.writeBuffer(
          layer.keysGPU,
          0,
          layer.keys.buffer,
          layer.keys.byteOffset,
          usedSize
        );
        device.queue.writeBuffer(
          layer.valuesGPU,
          0,
          layer.values.buffer,
          layer.values.byteOffset,
          usedSize
        );
      }
    }

    this.useGPU = true;
    console.log('[KVCache] Migration complete');
  }

  /**
   * Sync GPU cache back to CPU (for debugging or fallback)
   * @returns {Promise<void>}
   */
  async syncToCPU() {
    if (!this.useGPU || this.layout === 'paged') return;

    const device = getDevice();
    if (!device) return;

    for (let l = 0; l < this.numLayers; l++) {
      const layer = this.layers[l];
      if (!layer.keysGPU || !layer.valuesGPU) continue;

      const usedSize = layer.seqLen * this.kvSize * 4;
      if (usedSize === 0) continue;

      // Create staging buffers for readback
      const keysStaging = device.createBuffer({
        size: usedSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      const valuesStaging = device.createBuffer({
        size: usedSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

      // Copy from GPU cache to staging
      const encoder = device.createCommandEncoder({ label: 'kv_cache_sync' });
      encoder.copyBufferToBuffer(layer.keysGPU, 0, keysStaging, 0, usedSize);
      encoder.copyBufferToBuffer(layer.valuesGPU, 0, valuesStaging, 0, usedSize);
      device.queue.submit([encoder.finish()]);

      // Map and copy to CPU arrays
      await keysStaging.mapAsync(GPUMapMode.READ);
      await valuesStaging.mapAsync(GPUMapMode.READ);

      const keysData = new Float32Array(keysStaging.getMappedRange().slice(0));
      const valuesData = new Float32Array(valuesStaging.getMappedRange().slice(0));

      layer.keys.set(keysData);
      layer.values.set(valuesData);

      keysStaging.unmap();
      valuesStaging.unmap();
      keysStaging.destroy();
      valuesStaging.destroy();
    }
  }

  /**
   * Destroy GPU resources
   */
  destroy() {
    for (let l = 0; l < this.numLayers; l++) {
      const layer = this.layers[l];
      if (layer.keysGPU) {
        layer.keysGPU.destroy();
        layer.keysGPU = null;
      }
      if (layer.valuesGPU) {
        layer.valuesGPU.destroy();
        layer.valuesGPU = null;
      }
    }
  }
}

/**
 * Sliding Window KV Cache for long sequences
 * Only keeps the most recent N tokens
 */
export class SlidingWindowKVCache extends KVCache {
  /**
   * @param {Object} config
   * @param {number} config.windowSize - Size of sliding window
   */
  constructor(config) {
    super(config);
    this.windowSize = config.windowSize || 1024;
    this.totalTokensSeen = 0;
  }

  /**
   * Update with sliding window logic
   */
  update(layerIdx, keys, values, startPos = this.currentSeqLen) {
    const numNewTokens = keys.length / this.kvSize;
    this.totalTokensSeen += numNewTokens;

    // Check if we need to slide the window
    if (this.currentSeqLen + numNewTokens > this.windowSize) {
      this._slideWindow(numNewTokens);
    }

    // Add new tokens
    super.update(layerIdx, keys, values, this.currentSeqLen);
  }

  /**
   * GPU-native update with ring-buffer semantics.
   * Keeps the last `windowSize` tokens in GPU memory while allowing
   * unbounded absolute positions for RoPE.
   */
  updateFromGPU(layerIdx, keysBuffer, valuesBuffer, startPos, numTokens) {
    const layer = this.layers[layerIdx];
    const device = getDevice();

    if (!device || !layer.keysGPU) {
      throw new Error('GPU cache not initialized');
    }

    if (this.kvDtype === 'f16') {
      const kd = getBufferDtype(keysBuffer);
      const vd = getBufferDtype(valuesBuffer);
      if (kd !== 'f16' || vd !== 'f16') {
        throw new Error('KV cache is f16 but source buffers are not f16');
      }
    }

    const windowSize = this.windowSize;
    const bytesPerToken = this.kvSize * this.bytesPerElem;
    const writePos = startPos % windowSize;

    const firstChunkTokens = Math.min(numTokens, windowSize - writePos);
    const firstChunkBytes = firstChunkTokens * bytesPerToken;
    const secondChunkTokens = numTokens - firstChunkTokens;
    const secondChunkBytes = secondChunkTokens * bytesPerToken;

    const encoder = device.createCommandEncoder({ label: 'kv_cache_update_sliding' });

    const destByteOffset1 = writePos * bytesPerToken;
    encoder.copyBufferToBuffer(keysBuffer, 0, layer.keysGPU, destByteOffset1, firstChunkBytes);
    encoder.copyBufferToBuffer(valuesBuffer, 0, layer.valuesGPU, destByteOffset1, firstChunkBytes);

    if (secondChunkTokens > 0) {
      const srcByteOffset2 = firstChunkBytes;
      encoder.copyBufferToBuffer(keysBuffer, srcByteOffset2, layer.keysGPU, 0, secondChunkBytes);
      encoder.copyBufferToBuffer(valuesBuffer, srcByteOffset2, layer.valuesGPU, 0, secondChunkBytes);
    }

    device.queue.submit([encoder.finish()]);

    const seen = Math.max(this.totalTokensSeen, startPos + numTokens);
    this.totalTokensSeen = seen;
    const storedLen = Math.min(windowSize, seen);

    layer.seqLen = Math.max(layer.seqLen || 0, storedLen);
    if (layerIdx === this.numLayers - 1) {
      this.currentSeqLen = storedLen;
    }
  }

  /**
   * Slide the window to make room for new tokens
   * @private
   */
  _slideWindow(numNewTokens) {
    const shiftAmount = Math.min(
      this.currentSeqLen,
      this.currentSeqLen + numNewTokens - this.windowSize
    );

    if (shiftAmount <= 0) return;

    // Shift cache contents for each layer
    for (let l = 0; l < this.numLayers; l++) {
      const layer = this.layers[l];
      const keepFrom = shiftAmount * this.kvSize;
      const keepLength = (layer.seqLen - shiftAmount) * this.kvSize;

      // Shift keys and values
      layer.keys.copyWithin(0, keepFrom, keepFrom + keepLength);
      layer.values.copyWithin(0, keepFrom, keepFrom + keepLength);
      layer.seqLen -= shiftAmount;
    }

    this.currentSeqLen -= shiftAmount;
  }

  getMemoryStats() {
    const stats = super.getMemoryStats();
    return {
      ...stats,
      windowSize: this.windowSize,
      totalTokensSeen: this.totalTokensSeen
    };
  }
}

/**
 * Multi-Query Attention (MQA) KV Cache
 * Uses fewer KV heads than query heads
 */
export class MQAKVCache extends KVCache {
  /**
   * @param {Object} config
   * @param {number} config.numKVHeads - Number of KV heads (< numHeads)
   */
  constructor(config) {
    // Override numHeads for cache storage
    const cacheConfig = {
      ...config,
      numHeads: config.numKVHeads || Math.ceil(config.numHeads / 8)
    };
    super(cacheConfig);

    this.numQueryHeads = config.numHeads;
    this.numKVHeads = cacheConfig.numHeads;
    this.kvGroupSize = Math.ceil(this.numQueryHeads / this.numKVHeads);
  }

  /**
   * Get the compression ratio vs full MHA
   * @returns {number}
   */
  getCompressionRatio() {
    return this.numQueryHeads / this.numKVHeads;
  }
}

export default KVCache;
