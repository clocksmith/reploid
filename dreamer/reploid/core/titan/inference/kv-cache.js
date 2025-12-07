/**
 * kv-cache.js - KV Cache Management
 *
 * Implements efficient key-value cache for transformer inference.
 * Supports both contiguous and paged memory layouts.
 *
 * @module inference/kv-cache
 */

// TODO: Waiting on Agent-A for memory allocation interfaces (allocateBuffer)
// TODO: Waiting on Agent-C for GPU buffer management (createStagingBuffer)

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
    const bytesPerLayer = sizePerLayer * 4 * 2; // float32, K + V

    for (let l = 0; l < this.numLayers; l++) {
      this.layers[l] = {
        keys: new Float32Array(sizePerLayer),
        values: new Float32Array(sizePerLayer),
        seqLen: 0
      };
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
   * @param {Float32Array} keys - New keys [batchSize, numHeads, headDim]
   * @param {Float32Array} values - New values [batchSize, numHeads, headDim]
   * @param {number} startPos - Starting position in sequence
   */
  update(layerIdx, keys, values, startPos = this.currentSeqLen) {
    const numNewTokens = keys.length / this.kvSize;

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
   * Update contiguous storage
   * @private
   */
  _updateContiguous(layer, keys, values, startPos, numNewTokens) {
    const offset = startPos * this.kvSize;
    layer.keys.set(keys, offset);
    layer.values.set(values, offset);
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
   * @param {Object} gpuContext - GPU context from Agent-C
   */
  setGPUContext(gpuContext) {
    this.gpuContext = gpuContext;
    // TODO: Migrate existing cache to GPU if needed
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
