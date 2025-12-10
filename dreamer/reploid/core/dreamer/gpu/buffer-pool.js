/**
 * GPU Buffer Pool - Efficient Buffer Allocation and Reuse
 *
 * Manages GPU buffer allocation with pooling for reuse,
 * reducing allocation overhead during inference.
 */

import { getDevice, getDeviceLimits } from './device.js';

/**
 * Buffer usage flags for different operations
 */
export const BufferUsage = {
  STORAGE: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  STORAGE_READ: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  UNIFORM: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  STAGING_READ: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  STAGING_WRITE: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
};

/**
 * Round size up to alignment boundary
 * @param {number} size
 * @param {number} alignment
 * @returns {number}
 */
function alignTo(size, alignment) {
  return Math.ceil(size / alignment) * alignment;
}

/**
 * Get size bucket for pooling (power of 2 rounding)
 * @param {number} size
 * @returns {number}
 */
function getSizeBucket(size) {
  // Minimum bucket: 256 bytes
  const minBucket = 256;
  if (size <= minBucket) return minBucket;

  // Round up to next power of 2
  return 1 << (32 - Math.clz32(size - 1));
}

/**
 * Buffer Pool for efficient GPU memory reuse
 */
class BufferPool {
  constructor() {
    // Pools organized by usage and size bucket
    // Map<usage, Map<sizeBucket, GPUBuffer[]>>
    this.pools = new Map();

    // Active buffers (currently in use)
    this.activeBuffers = new Set();

    // Statistics
    this.stats = {
      allocations: 0,
      reuses: 0,
      totalBytesAllocated: 0,
      peakBytesAllocated: 0,
      currentBytesAllocated: 0,
    };

    // Configuration
    this.config = {
      maxPoolSizePerBucket: 8,       // Max buffers per size bucket
      maxTotalPooledBuffers: 64,     // Max total pooled buffers
      enablePooling: true,
      alignmentBytes: 256,           // WebGPU buffer alignment
    };
  }

  /**
   * Get or create a buffer of the specified size
   * @param {number} size - Required buffer size in bytes
   * @param {number} usage - GPUBufferUsage flags
   * @param {string} label - Debug label
   * @returns {GPUBuffer}
   */
  acquire(size, usage = BufferUsage.STORAGE, label = 'pooled_buffer') {
    const device = getDevice();
    if (!device) {
      throw new Error('Device not initialized');
    }

    // Align size
    const alignedSize = alignTo(size, this.config.alignmentBytes);
    const bucket = getSizeBucket(alignedSize);

    // Check device limits before allocation
    const limits = getDeviceLimits();
    if (limits) {
      const maxSize = limits.maxBufferSize || Infinity;
      const maxStorageSize = limits.maxStorageBufferBindingSize || Infinity;

      if (bucket > maxSize) {
        throw new Error(
          `Buffer size ${bucket} exceeds device maxBufferSize (${maxSize}). ` +
          `Requested: ${size} bytes, bucketed to: ${bucket} bytes.`
        );
      }

      // Check storage binding size for storage buffers
      const isStorageBuffer = (usage & GPUBufferUsage.STORAGE) !== 0;
      if (isStorageBuffer && bucket > maxStorageSize) {
        throw new Error(
          `Storage buffer size ${bucket} exceeds device maxStorageBufferBindingSize (${maxStorageSize}). ` +
          `Consider splitting into smaller buffers or using a different strategy.`
        );
      }
    }

    // Try to get from pool
    if (this.config.enablePooling) {
      const pooled = this._getFromPool(bucket, usage);
      if (pooled) {
        this.activeBuffers.add(pooled);
        this.stats.reuses++;
        return pooled;
      }
    }

    // Allocate new buffer
    const buffer = device.createBuffer({
      label: `${label}_${bucket}`,
      size: bucket,
      usage,
    });

    this.activeBuffers.add(buffer);
    this.stats.allocations++;
    this.stats.totalBytesAllocated += bucket;
    this.stats.currentBytesAllocated += bucket;
    this.stats.peakBytesAllocated = Math.max(
      this.stats.peakBytesAllocated,
      this.stats.currentBytesAllocated
    );

    return buffer;
  }

  /**
   * Release a buffer back to the pool
   * @param {GPUBuffer} buffer
   */
  release(buffer) {
    if (!this.activeBuffers.has(buffer)) {
      console.warn('[BufferPool] Releasing buffer not tracked as active');
      return;
    }

    this.activeBuffers.delete(buffer);

    if (!this.config.enablePooling) {
      buffer.destroy();
      this.stats.currentBytesAllocated -= buffer.size;
      return;
    }

    // Return to pool if there's room
    const bucket = buffer.size;
    const usage = buffer.usage;

    if (!this.pools.has(usage)) {
      this.pools.set(usage, new Map());
    }
    const usagePool = this.pools.get(usage);

    if (!usagePool.has(bucket)) {
      usagePool.set(bucket, []);
    }
    const bucketPool = usagePool.get(bucket);

    if (bucketPool.length < this.config.maxPoolSizePerBucket &&
        this._getTotalPooledCount() < this.config.maxTotalPooledBuffers) {
      bucketPool.push(buffer);
    } else {
      // Pool is full, destroy buffer
      buffer.destroy();
      this.stats.currentBytesAllocated -= buffer.size;
    }
  }

  /**
   * Get a buffer from the pool if available
   * @private
   */
  _getFromPool(bucket, usage) {
    const usagePool = this.pools.get(usage);
    if (!usagePool) return null;

    const bucketPool = usagePool.get(bucket);
    if (!bucketPool || bucketPool.length === 0) return null;

    return bucketPool.pop();
  }

  /**
   * Get total count of pooled buffers
   * @private
   */
  _getTotalPooledCount() {
    let count = 0;
    for (const usagePool of this.pools.values()) {
      for (const bucketPool of usagePool.values()) {
        count += bucketPool.length;
      }
    }
    return count;
  }

  /**
   * Create a staging buffer for CPU readback
   * @param {number} size
   * @returns {GPUBuffer}
   */
  createStagingBuffer(size) {
    return this.acquire(size, BufferUsage.STAGING_READ, 'staging_read');
  }

  /**
   * Create a staging buffer for CPU upload
   * @param {number} size
   * @returns {GPUBuffer}
   */
  createUploadBuffer(size) {
    return this.acquire(size, BufferUsage.STAGING_WRITE, 'staging_write');
  }

  /**
   * Create a uniform buffer
   * @param {number} size
   * @returns {GPUBuffer}
   */
  createUniformBuffer(size) {
    // Uniform buffers have stricter alignment (256 bytes typically)
    const alignedSize = alignTo(size, 256);
    return this.acquire(alignedSize, BufferUsage.UNIFORM, 'uniform');
  }

  /**
   * Upload data to GPU buffer
   * @param {GPUBuffer} buffer
   * @param {ArrayBuffer|TypedArray} data
   * @param {number} offset
   */
  uploadData(buffer, data, offset = 0) {
    const device = getDevice();
    device.queue.writeBuffer(buffer, offset, data);
  }

  /**
   * Read data from GPU buffer
   * @param {GPUBuffer} buffer
   * @param {number} size - Bytes to read
   * @returns {Promise<ArrayBuffer>}
   */
  async readBuffer(buffer, size = buffer.size) {
    const device = getDevice();

    // Create staging buffer
    const staging = this.createStagingBuffer(size);

    // Copy to staging
    const encoder = device.createCommandEncoder({ label: 'readback_encoder' });
    encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);

    // Map and read
    await staging.mapAsync(GPUMapMode.READ);
    const data = staging.getMappedRange(0, size).slice(0);
    staging.unmap();

    // Release staging buffer
    this.release(staging);

    return data;
  }

  /**
   * Clear all pooled buffers
   */
  clearPool() {
    for (const usagePool of this.pools.values()) {
      for (const bucketPool of usagePool.values()) {
        for (const buffer of bucketPool) {
          buffer.destroy();
          this.stats.currentBytesAllocated -= buffer.size;
        }
        bucketPool.length = 0;
      }
    }
    this.pools.clear();
  }

  /**
   * Destroy all buffers (active and pooled)
   */
  destroy() {
    // Destroy active buffers
    for (const buffer of this.activeBuffers) {
      buffer.destroy();
    }
    this.activeBuffers.clear();

    // Clear pools
    this.clearPool();

    this.stats.currentBytesAllocated = 0;
  }

  /**
   * Get pool statistics
   * @returns {object}
   */
  getStats() {
    return {
      ...this.stats,
      activeBuffers: this.activeBuffers.size,
      pooledBuffers: this._getTotalPooledCount(),
      hitRate: this.stats.allocations > 0
        ? (this.stats.reuses / (this.stats.allocations + this.stats.reuses) * 100).toFixed(1) + '%'
        : '0%',
    };
  }

  /**
   * Configure pool settings
   * @param {object} config
   */
  configure(config) {
    Object.assign(this.config, config);
  }
}

// Global buffer pool instance
let globalPool = null;

/**
 * Get the global buffer pool
 * @returns {BufferPool}
 */
export function getBufferPool() {
  if (!globalPool) {
    globalPool = new BufferPool();
  }
  return globalPool;
}

/**
 * Create a standalone buffer pool
 * @returns {BufferPool}
 */
export function createBufferPool() {
  return new BufferPool();
}

/**
 * Destroy the global buffer pool
 */
export function destroyBufferPool() {
  if (globalPool) {
    globalPool.destroy();
    globalPool = null;
  }
}

// Convenience exports for common operations
export const createStagingBuffer = (size) => getBufferPool().createStagingBuffer(size);
export const createUploadBuffer = (size) => getBufferPool().createUploadBuffer(size);
export const createUniformBuffer = (size) => getBufferPool().createUniformBuffer(size);
export const acquireBuffer = (size, usage, label) => getBufferPool().acquire(size, usage, label);
export const releaseBuffer = (buffer) => getBufferPool().release(buffer);
export const uploadData = (buffer, data, offset) => getBufferPool().uploadData(buffer, data, offset);
export const readBuffer = (buffer, size) => getBufferPool().readBuffer(buffer, size);

/**
 * Scoped buffer helper - automatically releases buffer when done
 * @param {number} size
 * @param {number} usage
 * @param {function} fn - Async function receiving the buffer
 * @returns {Promise<*>} Result of fn
 */
export async function withBuffer(size, usage, fn) {
  const pool = getBufferPool();
  const buffer = pool.acquire(size, usage);
  try {
    return await fn(buffer);
  } finally {
    pool.release(buffer);
  }
}

export { BufferPool };
