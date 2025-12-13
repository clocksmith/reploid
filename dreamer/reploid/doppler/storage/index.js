/**
 * storage/index.js - Storage Module Exports
 *
 * Consolidates all storage-related functionality for the DOPPLER engine.
 *
 * @module storage
 */

// Re-export from rdrr-format
export {
  RDRR_VERSION,
  SHARD_SIZE,
  MANIFEST_FILENAME,
  parseManifest,
  getManifest,
  clearManifest,
  getShardInfo,
  getShardCount,
  isMoE,
  getShardsForExpert,
  generateShardFilename,
  calculateShardCount,
  createShardLayout,
  createManifest,
  serializeManifest,
  getShardUrl,
  getManifestUrl
} from './rdrr-format.js';

// Re-export from quota
export {
  isStorageAPIAvailable,
  isOPFSAvailable,
  isIndexedDBAvailable,
  getQuotaInfo,
  isPersisted,
  requestPersistence,
  checkSpaceAvailable,
  formatBytes,
  getStorageReport,
  QuotaExceededError,
  monitorStorage,
  getSuggestions
} from './quota.js';

// Re-export from shard-manager
export {
  computeBlake3,
  createStreamingHasher,
  initOPFS,
  openModelDirectory,
  getCurrentModelDirectory,
  writeShard,
  loadShard,
  loadShardSync,
  shardExists,
  verifyIntegrity,
  deleteShard,
  deleteModel,
  listModels,
  getModelInfo,
  saveManifest,
  loadManifestFromOPFS
} from './shard-manager.js';

// Re-export from downloader
export {
  downloadModel,
  pauseDownload,
  resumeDownload,
  getDownloadProgress,
  listDownloads,
  cancelDownload,
  checkDownloadNeeded,
  formatSpeed,
  estimateTimeRemaining
} from './downloader.js';
