/**
 * Titan - High-Performance Offline Browser Inference
 * Main entry point for the Titan subsystem.
 */

export const TITAN_VERSION = '0.1.0';

// Memory & Capability (Agent-A)
export { getMemoryCapabilities } from './memory/capability.js';
export { detectUnifiedMemory } from './memory/unified-detect.js';
export { HeapManager, getHeapManager } from './memory/heap-manager.js';
export { AddressTable } from './memory/address-table.js';

// Storage & Format (Agent-B)
export {
  parseManifest,
  getManifest,
  getShardInfo,
  getShardCount,
  isMoE,
  getShardsForExpert,
} from './storage/rpl-format.js';
export {
  initOPFS,
  openModelDirectory,
  loadShard,
  loadShardSync,
  writeShard,
  verifyIntegrity,
  listModels,
  deleteModel,
} from './storage/shard-manager.js';
export { downloadModel } from './storage/downloader.js';
export {
  requestPersistentStorage,
  getStorageInfo,
  checkSpaceAvailable,
} from './storage/quota.js';

// GPU & Kernels (Agent-C)
export {
  initDevice,
  getDevice,
  getKernelCapabilities,
  destroyDevice,
} from './gpu/device.js';
export {
  runMatmul,
  dequantize,
  selectMatmulKernel,
  selectDequantKernel,
} from './gpu/kernel-selector.js';
export {
  getBufferPool,
  createStagingBuffer,
  acquireBuffer,
  releaseBuffer,
  readBuffer,
} from './gpu/buffer-pool.js';

// Inference Pipeline (Agent-D)
export { MoERouter } from './inference/moe-router.js';
export { SpeculativeDecoder } from './inference/speculative.js';
export { TitanPipeline } from './inference/pipeline.js';
export { KVCache } from './inference/kv-cache.js';
export { Tokenizer } from './inference/tokenizer.js';
