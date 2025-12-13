/**
 * Memory Capability Detection
 * Agent-A | Domain: memory/
 *
 * Detects browser memory capabilities:
 * - Memory64 (WASM large heap support)
 * - Unified memory (Apple/AMD Strix)
 * - Maximum heap sizes
 */

import { detectUnifiedMemory } from './unified-detect.js';

/**
 * Memory64 feature detection via WASM binary probe
 * Tests if browser supports 64-bit memory addressing
 */
async function probeMemory64() {
  // Minimal WASM module declaring memory64
  // (module (memory i64 1))
  const memory64Binary = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // WASM magic
    0x01, 0x00, 0x00, 0x00, // Version 1
    0x05, 0x04, 0x01,       // Memory section, 1 entry
    0x04, 0x01, 0x00,       // memory64 flag (0x04), min 1 page, no max
  ]);

  try {
    await WebAssembly.compile(memory64Binary);
    return true;
  } catch {
    return false;
  }
}

/**
 * Estimate maximum usable heap size
 * Tests allocation limits without OOM
 */
async function probeMaxHeapSize() {
  const GB = 1024 * 1024 * 1024;
  const testSizes = [16 * GB, 8 * GB, 4 * GB, 2 * GB, 1 * GB];

  for (const size of testSizes) {
    try {
      // Try to create a WASM memory of this size
      const pages = Math.ceil(size / 65536); // 64KB pages
      new WebAssembly.Memory({ initial: 1, maximum: pages });
      return size;
    } catch {
      continue;
    }
  }

  return 1 * GB; // Fallback to 1GB
}

/**
 * Probe segmented heap limits (for non-Memory64 browsers)
 * Returns max size per ArrayBuffer and recommended segment count
 */
function probeSegmentedLimits() {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;

  // Test actual allocation limits - browsers often can't allocate large ArrayBuffers
  // Start with smaller sizes that are more likely to succeed
  const testSizes = [1 * GB, 512 * MB, 256 * MB, 128 * MB];

  let maxSegmentSize = 256 * MB; // Safe default

  for (const size of testSizes) {
    try {
      // Actually try to allocate to see if it works
      const testBuffer = new ArrayBuffer(size);
      if (testBuffer.byteLength === size) {
        maxSegmentSize = size;
        break; // Use the largest working size
      }
    } catch (e) {
      continue;
    }
  }

  return {
    maxSegmentSize,
    recommendedSegments: Math.ceil((8 * GB) / maxSegmentSize), // Target ~8GB address space
  };
}

/**
 * Main capability detection - call this at init
 * @returns {Promise<MemoryCapabilities>}
 */
export async function getMemoryCapabilities() {
  const hasMemory64 = await probeMemory64();
  const unifiedMemory = await detectUnifiedMemory();
  const maxHeapSize = hasMemory64 ? await probeMaxHeapSize() : null;
  const segmentedLimits = !hasMemory64 ? probeSegmentedLimits() : null;

  const strategy = hasMemory64 ? 'MEMORY64' : 'SEGMENTED';

  return {
    hasMemory64,
    isUnifiedMemory: unifiedMemory.isUnified,
    unifiedMemoryInfo: unifiedMemory,
    maxHeapSize,
    segmentedLimits,
    strategy,
  };
}

/**
 * @typedef {Object} MemoryCapabilities
 * @property {boolean} hasMemory64 - Browser supports WASM Memory64
 * @property {boolean} isUnifiedMemory - GPU shares system RAM (Apple/Strix)
 * @property {Object} unifiedMemoryInfo - Details from unified-detect
 * @property {number|null} maxHeapSize - Max single heap size (Memory64 only)
 * @property {Object|null} segmentedLimits - Segment limits (non-Memory64)
 * @property {'MEMORY64'|'SEGMENTED'} strategy - Recommended heap strategy
 */
