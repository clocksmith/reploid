/**
 * storage/index.ts - Storage Module Exports
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
  getManifestUrl,
} from './rdrr-format.js';

// Re-export types from rdrr-format
export type {
  HashAlgorithm,
  AttentionKernel,
  ShardInfo,
  MoEConfig,
  LayerConfig,
  TensorLocation,
  RuntimeOptimizations,
  RDRRManifest,
  ValidationResult,
  CreateManifestOptions,
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
  getSuggestions,
  clearCache as clearQuotaCache,
} from './quota.js';

// Re-export types from quota
export type {
  QuotaInfo,
  PersistenceResult,
  SpaceCheckResult,
  StorageReport,
  StorageCallback,
} from './quota.js';

// Re-export from shard-manager
export {
  computeBlake3,
  computeSHA256,
  computeHash,
  createStreamingHasher,
  getHashAlgorithm,
  hexToBytes,
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
  loadManifestFromOPFS,
  saveTokenizer,
  loadTokenizerFromOPFS,
  cleanup as cleanupShardManager,
  OpfsShardStore,
} from './shard-manager.js';

// Re-export types from shard-manager
export type {
  ShardStore,
  ShardReadOptions,
  ShardWriteOptions,
  ShardWriteResult,
  IntegrityResult,
  ModelInfo,
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
  estimateTimeRemaining,
} from './downloader.js';

// Re-export types from downloader
export type {
  DownloadProgress,
  ShardProgress,
  DownloadStatus,
  DownloadState,
  DownloadOptions,
  RetryPolicy,
  DownloadNeededResult,
  ProgressCallback,
} from './downloader.js';
