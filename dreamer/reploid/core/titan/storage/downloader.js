/**
 * downloader.js - Resumable Model Downloader
 *
 * Handles:
 * - Chunked downloads with progress reporting
 * - Resume support via IndexedDB state tracking
 * - Parallel shard downloads with concurrency control
 * - Automatic retry with exponential backoff
 * - Quota checking before downloads
 *
 * @module storage/downloader
 */

import {
  parseManifest,
  getManifest,
  getShardInfo,
  getShardCount,
  getManifestUrl,
  getShardUrl
} from './rpl-format.js';

import {
  openModelDirectory,
  writeShard,
  shardExists,
  saveManifest,
  computeBlake3
} from './shard-manager.js';

import {
  checkSpaceAvailable,
  QuotaExceededError,
  requestPersistence,
  formatBytes,
  isIndexedDBAvailable
} from './quota.js';

// Constants
const DB_NAME = 'titan-download-state';
const DB_VERSION = 1;
const STORE_NAME = 'downloads';

const DEFAULT_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 30000;

// Download state
let db = null;
let activeDownloads = new Map();

/**
 * @typedef {Object} DownloadProgress
 * @property {string} modelId - Model identifier
 * @property {number} totalShards - Total number of shards
 * @property {number} completedShards - Number of completed shards
 * @property {number} totalBytes - Total size in bytes
 * @property {number} downloadedBytes - Downloaded bytes
 * @property {number} percent - Progress percentage
 * @property {string} status - Current status ('downloading', 'paused', 'completed', 'error')
 * @property {number|null} currentShard - Currently downloading shard index
 * @property {number} speed - Current download speed in bytes/sec
 */

/**
 * @typedef {Object} DownloadState
 * @property {string} modelId
 * @property {string} baseUrl
 * @property {Object} manifest
 * @property {Set<number>} completedShards
 * @property {number} startTime
 * @property {string} status
 */

/**
 * Initializes the IndexedDB for download state persistence
 * @returns {Promise<IDBDatabase>}
 */
async function initDB() {
  if (db) return db;

  if (!isIndexedDBAvailable()) {
    console.warn('IndexedDB not available, download resume will not work');
    return null;
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('Failed to open IndexedDB'));

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'modelId' });
        store.createIndex('status', 'status', { unique: false });
      }
    };
  });
}

/**
 * Saves download state to IndexedDB
 * @param {DownloadState} state
 * @returns {Promise<void>}
 */
async function saveDownloadState(state) {
  const database = await initDB();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const storeState = {
      ...state,
      completedShards: Array.from(state.completedShards)
    };

    const request = store.put(storeState);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Failed to save download state'));
  });
}

/**
 * Loads download state from IndexedDB
 * @param {string} modelId
 * @returns {Promise<DownloadState|null>}
 */
async function loadDownloadState(modelId) {
  const database = await initDB();
  if (!database) return null;

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const request = store.get(modelId);
    request.onsuccess = () => {
      const result = request.result;
      if (result) {
        result.completedShards = new Set(result.completedShards);
        resolve(result);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(new Error('Failed to load download state'));
  });
}

/**
 * Deletes download state from IndexedDB
 * @param {string} modelId
 * @returns {Promise<void>}
 */
async function deleteDownloadState(modelId) {
  const database = await initDB();
  if (!database) return;

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const request = store.delete(modelId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error('Failed to delete download state'));
  });
}

/**
 * Fetches data with retry logic
 * @param {string} url
 * @param {Object} [options]
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}) {
  let lastError;
  let delay = INITIAL_RETRY_DELAY;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      // Don't retry if aborted
      if (error.name === 'AbortError') {
        throw error;
      }

      // Don't retry on 4xx errors (except 429)
      if (error.message.includes('HTTP 4') && !error.message.includes('HTTP 429')) {
        throw error;
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, delay));
        delay = Math.min(delay * 2, MAX_RETRY_DELAY);
      }
    }
  }

  throw lastError;
}

/**
 * Downloads a single shard
 * @param {string} baseUrl
 * @param {number} shardIndex
 * @param {Object} [options]
 * @returns {Promise<ArrayBuffer>}
 */
async function downloadShard(baseUrl, shardIndex, options = {}) {
  const { signal, onProgress } = options;

  const shardInfo = getShardInfo(shardIndex);
  if (!shardInfo) {
    throw new Error(`Invalid shard index: ${shardIndex}`);
  }

  const url = getShardUrl(baseUrl, shardIndex);
  const response = await fetchWithRetry(url, { signal });

  // Stream the response for progress tracking
  const reader = response.body.getReader();
  const contentLength = shardInfo.size;

  const chunks = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    chunks.push(value);
    receivedBytes += value.length;

    if (onProgress) {
      onProgress({
        shardIndex,
        receivedBytes,
        totalBytes: contentLength,
        percent: (receivedBytes / contentLength) * 100
      });
    }
  }

  // Combine chunks into single buffer
  const buffer = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  return buffer.buffer;
}

/**
 * Downloads a model with progress reporting and resume support
 * @param {string} baseUrl - Base URL for the model
 * @param {Function} [onProgress] - Progress callback
 * @param {Object} [options] - Download options
 * @returns {Promise<boolean>}
 */
export async function downloadModel(baseUrl, onProgress, options = {}) {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    requestPersist = true
  } = options;

  // Request persistent storage if needed
  if (requestPersist) {
    await requestPersistence();
  }

  // Fetch and parse manifest
  const manifestUrl = getManifestUrl(baseUrl);
  const manifestResponse = await fetchWithRetry(manifestUrl);
  const manifestJson = await manifestResponse.text();
  const manifest = parseManifest(manifestJson);

  // Check available space
  const spaceCheck = await checkSpaceAvailable(manifest.totalSize);
  if (!spaceCheck.hasSpace) {
    throw new QuotaExceededError(manifest.totalSize, spaceCheck.info.available);
  }

  // Open model directory
  await openModelDirectory(manifest.modelId);

  // Check for existing download state
  let state = await loadDownloadState(manifest.modelId);
  if (!state) {
    state = {
      modelId: manifest.modelId,
      baseUrl,
      manifest,
      completedShards: new Set(),
      startTime: Date.now(),
      status: 'downloading'
    };
  } else {
    state.status = 'downloading';
    // Check which shards actually exist (in case OPFS was cleared)
    for (const idx of state.completedShards) {
      if (!(await shardExists(idx))) {
        state.completedShards.delete(idx);
      }
    }
  }

  // Create abort controller
  const abortController = new AbortController();
  activeDownloads.set(manifest.modelId, {
    state,
    abortController
  });

  const totalShards = getShardCount();
  const pendingShards = [];

  // Find shards that need downloading
  for (let i = 0; i < totalShards; i++) {
    if (!state.completedShards.has(i)) {
      pendingShards.push(i);
    }
  }

  // Progress tracking
  let downloadedBytes = 0;
  for (const idx of state.completedShards) {
    const info = getShardInfo(idx);
    if (info) downloadedBytes += info.size;
  }

  const speedTracker = {
    lastBytes: downloadedBytes,
    lastTime: Date.now(),
    speed: 0
  };

  const updateProgress = (currentShard) => {
    const now = Date.now();
    const timeDelta = (now - speedTracker.lastTime) / 1000;
    if (timeDelta >= 1) {
      speedTracker.speed = (downloadedBytes - speedTracker.lastBytes) / timeDelta;
      speedTracker.lastBytes = downloadedBytes;
      speedTracker.lastTime = now;
    }

    if (onProgress) {
      onProgress({
        modelId: manifest.modelId,
        totalShards,
        completedShards: state.completedShards.size,
        totalBytes: manifest.totalSize,
        downloadedBytes,
        percent: (downloadedBytes / manifest.totalSize) * 100,
        status: state.status,
        currentShard,
        speed: speedTracker.speed
      });
    }
  };

  // Download shards with concurrency control
  const downloadQueue = [...pendingShards];
  const inFlight = new Set();

  const downloadNext = async () => {
    if (downloadQueue.length === 0 || abortController.signal.aborted) {
      return;
    }

    const shardIndex = downloadQueue.shift();
    inFlight.add(shardIndex);
    updateProgress(shardIndex);

    try {
      const buffer = await downloadShard(baseUrl, shardIndex, {
        signal: abortController.signal,
        onProgress: (p) => {
          // Update per-shard progress
          // Calculate incremental bytes for speed tracking
        }
      });

      // Write shard to OPFS with verification
      await writeShard(shardIndex, buffer, { verify: true });

      // Update state
      state.completedShards.add(shardIndex);
      const info = getShardInfo(shardIndex);
      downloadedBytes += info.size;

      // Save progress
      await saveDownloadState(state);
      updateProgress(null);

    } catch (error) {
      if (error.name === 'AbortError') {
        state.status = 'paused';
        await saveDownloadState(state);
        throw error;
      }
      // Re-add to queue for retry (will be handled by next attempt)
      throw error;
    } finally {
      inFlight.delete(shardIndex);
    }
  };

  try {
    // Process queue with concurrency limit
    while (downloadQueue.length > 0 || inFlight.size > 0) {
      if (abortController.signal.aborted) break;

      // Start new downloads up to concurrency limit
      while (inFlight.size < concurrency && downloadQueue.length > 0) {
        downloadNext().catch(() => {}); // Errors handled inside
      }

      // Wait a bit before checking again
      await new Promise(r => setTimeout(r, 100));
    }

    // Verify all shards completed
    if (state.completedShards.size === totalShards) {
      state.status = 'completed';

      // Save manifest to OPFS
      await saveManifest(manifestJson);

      // Clean up download state
      await deleteDownloadState(manifest.modelId);

      updateProgress(null);
      return true;
    }

    return false;

  } catch (error) {
    state.status = 'error';
    state.error = error.message;
    await saveDownloadState(state);
    throw error;

  } finally {
    activeDownloads.delete(manifest.modelId);
  }
}

/**
 * Pauses an active download
 * @param {string} modelId
 * @returns {boolean}
 */
export function pauseDownload(modelId) {
  const download = activeDownloads.get(modelId);
  if (!download) return false;

  download.abortController.abort();
  return true;
}

/**
 * Resumes a paused download
 * @param {Function} [onProgress]
 * @param {Object} [options]
 * @returns {Promise<boolean>}
 */
export async function resumeDownload(modelId, onProgress, options = {}) {
  const state = await loadDownloadState(modelId);
  if (!state) {
    throw new Error(`No download state found for model: ${modelId}`);
  }

  return downloadModel(state.baseUrl, onProgress, options);
}

/**
 * Gets the download progress for a model
 * @param {string} modelId
 * @returns {Promise<DownloadProgress|null>}
 */
export async function getDownloadProgress(modelId) {
  // Check active downloads first
  const active = activeDownloads.get(modelId);
  if (active) {
    const state = active.state;
    const manifest = getManifest();
    const totalShards = manifest?.shards?.length || 0;

    let downloadedBytes = 0;
    for (const idx of state.completedShards) {
      const info = getShardInfo(idx);
      if (info) downloadedBytes += info.size;
    }

    return {
      modelId,
      totalShards,
      completedShards: state.completedShards.size,
      totalBytes: manifest?.totalSize || 0,
      downloadedBytes,
      percent: manifest ? (downloadedBytes / manifest.totalSize) * 100 : 0,
      status: state.status,
      currentShard: null,
      speed: 0
    };
  }

  // Check saved state
  const state = await loadDownloadState(modelId);
  if (!state) return null;

  let downloadedBytes = 0;
  for (const idx of state.completedShards) {
    const shard = state.manifest.shards[idx];
    if (shard) downloadedBytes += shard.size;
  }

  return {
    modelId,
    totalShards: state.manifest.shards.length,
    completedShards: state.completedShards.size,
    totalBytes: state.manifest.totalSize,
    downloadedBytes,
    percent: (downloadedBytes / state.manifest.totalSize) * 100,
    status: state.status,
    currentShard: null,
    speed: 0
  };
}

/**
 * Lists all in-progress or paused downloads
 * @returns {Promise<DownloadProgress[]>}
 */
export async function listDownloads() {
  const database = await initDB();
  if (!database) return [];

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const request = store.getAll();
    request.onsuccess = async () => {
      const results = [];
      for (const state of request.result) {
        const progress = await getDownloadProgress(state.modelId);
        if (progress) results.push(progress);
      }
      resolve(results);
    };
    request.onerror = () => reject(new Error('Failed to list downloads'));
  });
}

/**
 * Cancels and removes a download
 * @param {string} modelId
 * @returns {Promise<boolean>}
 */
export async function cancelDownload(modelId) {
  // Abort if active
  pauseDownload(modelId);

  // Remove state
  await deleteDownloadState(modelId);

  return true;
}

/**
 * Checks if a model needs downloading
 * @param {string} modelId
 * @returns {Promise<{needed: boolean, reason: string, missingShards: number[]}>}
 */
export async function checkDownloadNeeded(modelId) {
  const state = await loadDownloadState(modelId);

  if (!state) {
    return {
      needed: true,
      reason: 'Model not downloaded',
      missingShards: []
    };
  }

  const totalShards = state.manifest.shards.length;
  const missingShards = [];

  for (let i = 0; i < totalShards; i++) {
    if (!state.completedShards.has(i)) {
      missingShards.push(i);
    }
  }

  if (missingShards.length > 0) {
    return {
      needed: true,
      reason: `Missing ${missingShards.length} of ${totalShards} shards`,
      missingShards
    };
  }

  return {
    needed: false,
    reason: 'Model fully downloaded',
    missingShards: []
  };
}

/**
 * Formats download speed for display
 * @param {number} bytesPerSecond
 * @returns {string}
 */
export function formatSpeed(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * Estimates remaining download time
 * @param {number} remainingBytes
 * @param {number} bytesPerSecond
 * @returns {string}
 */
export function estimateTimeRemaining(remainingBytes, bytesPerSecond) {
  if (bytesPerSecond <= 0) return 'Calculating...';

  const seconds = remainingBytes / bytesPerSecond;

  if (seconds < 60) {
    return `${Math.ceil(seconds)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.ceil((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
}
