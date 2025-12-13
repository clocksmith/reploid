/**
 * Heap Manager
 * Agent-A | Domain: memory/
 *
 * Manages memory allocation for model weights:
 * - Memory64 mode: Single large WASM heap
 * - Segmented mode: Multiple 4GB ArrayBuffers with virtual addressing
 */

import { getMemoryCapabilities } from './capability.js';
import { AddressTable } from './address-table.js';

const GB = 1024 * 1024 * 1024;
const PAGE_SIZE = 65536; // WASM page = 64KB

/**
 * HeapManager - Unified interface for both memory strategies
 */
export class HeapManager {
  constructor() {
    this.strategy = null;
    this.memory64Heap = null;
    this.segments = [];
    this.addressTable = null;
    this.initialized = false;
    this.totalAllocated = 0;
  }

  /**
   * Initialize heap manager based on detected capabilities
   */
  async init() {
    if (this.initialized) return;

    const caps = await getMemoryCapabilities();
    this.strategy = caps.strategy;

    if (this.strategy === 'MEMORY64') {
      await this._initMemory64(caps.maxHeapSize);
    } else {
      await this._initSegmented(caps.segmentedLimits);
    }

    this.initialized = true;
    console.log(`[HeapManager] Initialized with strategy: ${this.strategy}`);
  }

  /**
   * Initialize Memory64 heap (single large WASM memory)
   */
  async _initMemory64(maxSize) {
    // Start with 1GB, grow as needed
    const initialPages = Math.ceil(GB / PAGE_SIZE);
    const maxPages = Math.ceil(maxSize / PAGE_SIZE);

    try {
      this.memory64Heap = new WebAssembly.Memory({
        initial: initialPages,
        maximum: maxPages,
        // memory64: true would go here when syntax is finalized
      });
      console.log(`[HeapManager] Memory64 heap: ${initialPages} initial pages, ${maxPages} max`);
    } catch (err) {
      console.error('[HeapManager] Memory64 init failed, falling back to segmented:', err);
      this.strategy = 'SEGMENTED';
      await this._initSegmented({ maxSegmentSize: 4 * GB, recommendedSegments: 8 });
    }
  }

  /**
   * Initialize segmented heap (multiple ArrayBuffers)
   */
  async _initSegmented(limits) {
    this.addressTable = new AddressTable(limits.maxSegmentSize);
    this.segments = [];

    // Pre-allocate first segment
    this._allocateSegment();

    console.log(`[HeapManager] Segmented heap: ${limits.maxSegmentSize / GB}GB per segment`);
  }

  /**
   * Allocate a new segment
   */
  _allocateSegment() {
    const segmentSize = this.addressTable.segmentSize;

    try {
      const segment = {
        index: this.segments.length,
        buffer: new ArrayBuffer(segmentSize),
        used: 0,
      };
      this.segments.push(segment);
      console.log(`[HeapManager] Allocated segment ${segment.index}: ${(segmentSize / (1024 * 1024)).toFixed(0)}MB`);
      return segment;
    } catch (e) {
      // If allocation fails, try smaller sizes
      const MB = 1024 * 1024;
      const fallbackSizes = [512 * MB, 256 * MB, 128 * MB];

      for (const size of fallbackSizes) {
        if (size >= segmentSize) continue; // Already tried this size
        try {
          const segment = {
            index: this.segments.length,
            buffer: new ArrayBuffer(size),
            used: 0,
          };
          this.segments.push(segment);
          // Update address table's segment size for consistency
          this.addressTable.segmentSize = size;
          console.warn(`[HeapManager] Allocation fallback to ${size / MB}MB segment`);
          return segment;
        } catch {
          continue;
        }
      }

      throw new Error(`Failed to allocate segment: ${e.message}. Try closing other tabs.`);
    }
  }

  /**
   * Allocate buffer for model data
   * @param {number} size - Size in bytes
   * @returns {AllocationResult}
   */
  allocate(size) {
    if (!this.initialized) {
      throw new Error('HeapManager not initialized. Call init() first.');
    }

    if (this.strategy === 'MEMORY64') {
      return this._allocateMemory64(size);
    } else {
      return this._allocateSegmented(size);
    }
  }

  /**
   * Allocate from Memory64 heap
   */
  _allocateMemory64(size) {
    const buffer = this.memory64Heap.buffer;
    const offset = this.totalAllocated;

    // Grow if needed
    if (offset + size > buffer.byteLength) {
      const neededPages = Math.ceil((offset + size - buffer.byteLength) / PAGE_SIZE);
      this.memory64Heap.grow(neededPages);
    }

    this.totalAllocated += size;

    return {
      virtualAddress: offset,
      size,
      view: new Uint8Array(this.memory64Heap.buffer, offset, size),
      strategy: 'MEMORY64',
    };
  }

  /**
   * Allocate from segmented heap
   */
  _allocateSegmented(size) {
    // Find segment with enough space, or allocate new one
    let segment = this.segments.find((s) => s.buffer.byteLength - s.used >= size);

    if (!segment) {
      segment = this._allocateSegment();
    }

    const offset = segment.used;
    segment.used += size;
    this.totalAllocated += size;

    const virtualAddress = this.addressTable.encode(segment.index, offset);

    return {
      virtualAddress,
      size,
      view: new Uint8Array(segment.buffer, offset, size),
      segmentIndex: segment.index,
      segmentOffset: offset,
      strategy: 'SEGMENTED',
    };
  }

  /**
   * Read data from virtual address
   * @param {number} virtualAddress
   * @param {number} length
   * @returns {Uint8Array}
   */
  read(virtualAddress, length) {
    if (this.strategy === 'MEMORY64') {
      return new Uint8Array(this.memory64Heap.buffer, virtualAddress, length);
    } else {
      const { segmentIndex, offset } = this.addressTable.decode(virtualAddress);
      const segment = this.segments[segmentIndex];
      return new Uint8Array(segment.buffer, offset, length);
    }
  }

  /**
   * Write data to virtual address
   * @param {number} virtualAddress
   * @param {Uint8Array} data
   */
  write(virtualAddress, data) {
    const view = this.read(virtualAddress, data.length);
    view.set(data);
  }

  /**
   * Get raw buffer for GPU upload
   * @param {number} virtualAddress
   * @param {number} length
   * @returns {ArrayBuffer}
   */
  getBufferSlice(virtualAddress, length) {
    if (this.strategy === 'MEMORY64') {
      // Return a copy for GPU upload (can't share WASM memory directly)
      const slice = new ArrayBuffer(length);
      new Uint8Array(slice).set(new Uint8Array(this.memory64Heap.buffer, virtualAddress, length));
      return slice;
    } else {
      const { segmentIndex, offset } = this.addressTable.decode(virtualAddress);
      const segment = this.segments[segmentIndex];
      return segment.buffer.slice(offset, offset + length);
    }
  }

  /**
   * Get memory stats
   */
  getStats() {
    return {
      strategy: this.strategy,
      totalAllocated: this.totalAllocated,
      segmentCount: this.segments.length,
      memory64HeapSize: this.memory64Heap?.buffer.byteLength || 0,
    };
  }

  /**
   * Free all memory (for model unload)
   */
  reset() {
    if (this.strategy === 'SEGMENTED') {
      this.segments = [];
      this._allocateSegment();
    }
    // Memory64 heap can't be shrunk, but we can reset allocation pointer
    this.totalAllocated = 0;
  }
}

/**
 * Singleton instance
 */
let heapManagerInstance = null;

export function getHeapManager() {
  if (!heapManagerInstance) {
    heapManagerInstance = new HeapManager();
  }
  return heapManagerInstance;
}

/**
 * @typedef {Object} AllocationResult
 * @property {number} virtualAddress - Virtual address for this allocation
 * @property {number} size - Allocated size in bytes
 * @property {Uint8Array} view - Direct view into the buffer
 * @property {'MEMORY64'|'SEGMENTED'} strategy - Which strategy was used
 * @property {number} [segmentIndex] - Segment index (segmented only)
 * @property {number} [segmentOffset] - Offset within segment (segmented only)
 */
