/**
 * shard-manager.js - OPFS Shard Management with BLAKE3 Verification
 *
 * Handles:
 * - OPFS directory structure for model shards
 * - Shard read/write with 4KB alignment for optimal performance
 * - BLAKE3 hash verification for integrity checking
 * - FileSystemSyncAccessHandle for synchronous reads (in workers)
 *
 * @module storage/shard-manager
 */

import { getManifest, getShardInfo, getShardCount } from './rpl-format.js';
import { isOPFSAvailable, QuotaExceededError, checkSpaceAvailable } from './quota.js';

// Constants
const ALIGNMENT = 4096; // 4KB alignment for optimal disk I/O
const READ_CHUNK_SIZE = 1024 * 1024; // 1MB chunks for streaming reads
const MODELS_DIR = 'titan-models';

// BLAKE3 constants
const BLAKE3_OUT_LEN = 32; // 256-bit output

// Module state
let rootDir = null;
let modelsDir = null;
let currentModelDir = null;
let blake3Module = null;

// Track which hash algorithm is being used
let hashAlgorithm = null;

/**
 * Initializes the BLAKE3 hashing module
 * Uses the BLAKE3 WASM implementation, falls back to SHA-256
 * @param {string} [requiredAlgorithm] - Required algorithm from manifest ('blake3' or 'sha256')
 * @returns {Promise<void>}
 */
async function initBlake3(requiredAlgorithm = null) {
  if (blake3Module && hashAlgorithm) return;

  // Try to load BLAKE3 WASM module
  try {
    // Dynamic import of blake3 module (should be bundled or loaded separately)
    if (typeof globalThis.blake3 !== 'undefined') {
      blake3Module = globalThis.blake3;
      hashAlgorithm = 'blake3';
      return;
    }
  } catch (e) {
    console.warn('BLAKE3 WASM module not available:', e.message);
  }

  // If BLAKE3 is explicitly required and not available, fail
  if (requiredAlgorithm === 'blake3') {
    throw new Error(
      'BLAKE3 required by manifest but not available. ' +
      'Install blake3 WASM module or re-convert model with SHA-256.'
    );
  }

  // Fallback to SHA-256
  console.warn('[shard-manager] BLAKE3 not available, using SHA-256');
  hashAlgorithm = 'sha256';
  blake3Module = {
    hash: async (data) => {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      return new Uint8Array(hashBuffer);
    },
    createHasher: () => {
      const chunks = [];
      return {
        update: (data) => {
          chunks.push(new Uint8Array(data));
        },
        finalize: async () => {
          const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
          return new Uint8Array(hashBuffer);
        }
      };
    }
  };
}

/**
 * Get the current hash algorithm in use
 * @returns {string|null} 'blake3' or 'sha256'
 */
export function getHashAlgorithm() {
  return hashAlgorithm;
}

/**
 * Converts Uint8Array to hex string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Converts hex string to Uint8Array
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Computes BLAKE3 hash of data
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function computeBlake3(data) {
  await initBlake3();

  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  const hash = await blake3Module.hash(bytes);
  return bytesToHex(hash);
}

/**
 * Creates a streaming BLAKE3 hasher for large data
 * @returns {Promise<{update: Function, finalize: Function}>}
 */
export async function createStreamingHasher() {
  await initBlake3();
  return blake3Module.createHasher();
}

/**
 * Initializes the OPFS directory structure
 * @returns {Promise<void>}
 */
export async function initOPFS() {
  if (!isOPFSAvailable()) {
    throw new Error('OPFS not available in this browser');
  }

  try {
    rootDir = await navigator.storage.getDirectory();
    modelsDir = await rootDir.getDirectoryHandle(MODELS_DIR, { create: true });
  } catch (error) {
    throw new Error(`Failed to initialize OPFS: ${error.message}`);
  }
}

/**
 * Opens a model directory, creating it if necessary
 * @param {string} modelId - Unique model identifier
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function openModelDirectory(modelId) {
  if (!modelsDir) {
    await initOPFS();
  }

  // Sanitize modelId for filesystem
  const safeName = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
  currentModelDir = await modelsDir.getDirectoryHandle(safeName, { create: true });
  return currentModelDir;
}

/**
 * Gets the current model directory handle
 * @returns {FileSystemDirectoryHandle|null}
 */
export function getCurrentModelDirectory() {
  return currentModelDir;
}

/**
 * Writes a shard to OPFS
 * @param {number} shardIndex - Shard index
 * @param {ArrayBuffer} data - Shard data
 * @param {Object} [options] - Options
 * @param {boolean} [options.verify=true] - Verify hash after write
 * @returns {Promise<{success: boolean, hash: string}>}
 */
export async function writeShard(shardIndex, data, options = { verify: true }) {
  if (!currentModelDir) {
    throw new Error('No model directory open. Call openModelDirectory first.');
  }

  const shardInfo = getShardInfo(shardIndex);
  if (!shardInfo) {
    throw new Error(`Invalid shard index: ${shardIndex}`);
  }

  // Check available space before writing
  const spaceCheck = await checkSpaceAvailable(data.byteLength);
  if (!spaceCheck.hasSpace) {
    throw new QuotaExceededError(data.byteLength, spaceCheck.info.available);
  }

  try {
    // Get or create the shard file
    const fileHandle = await currentModelDir.getFileHandle(shardInfo.filename, { create: true });

    // Use writable stream for efficient writes
    const writable = await fileHandle.createWritable();

    // Write data with proper alignment consideration
    const alignedSize = Math.ceil(data.byteLength / ALIGNMENT) * ALIGNMENT;
    if (alignedSize !== data.byteLength) {
      // Pad to alignment boundary (optional, depends on requirements)
      await writable.write(data);
    } else {
      await writable.write(data);
    }

    await writable.close();

    // Verify hash if requested
    if (options.verify) {
      const hash = await computeBlake3(data);
      if (hash !== shardInfo.blake3) {
        // Delete the corrupted shard
        await currentModelDir.removeEntry(shardInfo.filename);
        throw new Error(`Hash mismatch for shard ${shardIndex}: expected ${shardInfo.blake3}, got ${hash}`);
      }
      return { success: true, hash };
    }

    return { success: true, hash: null };
  } catch (error) {
    if (error instanceof QuotaExceededError) throw error;
    throw new Error(`Failed to write shard ${shardIndex}: ${error.message}`);
  }
}

/**
 * Reads a shard from OPFS
 * @param {number} shardIndex - Shard index
 * @param {Object} [options] - Options
 * @param {boolean} [options.verify=false] - Verify hash after read
 * @returns {Promise<ArrayBuffer>}
 */
export async function loadShard(shardIndex, options = { verify: false }) {
  if (!currentModelDir) {
    throw new Error('No model directory open. Call openModelDirectory first.');
  }

  const shardInfo = getShardInfo(shardIndex);
  if (!shardInfo) {
    throw new Error(`Invalid shard index: ${shardIndex}`);
  }

  try {
    const fileHandle = await currentModelDir.getFileHandle(shardInfo.filename);
    const file = await fileHandle.getFile();
    const buffer = await file.arrayBuffer();

    // Verify hash if requested
    if (options.verify) {
      const hash = await computeBlake3(buffer);
      if (hash !== shardInfo.blake3) {
        throw new Error(`Hash mismatch for shard ${shardIndex}: expected ${shardInfo.blake3}, got ${hash}`);
      }
    }

    return buffer;
  } catch (error) {
    if (error.name === 'NotFoundError') {
      throw new Error(`Shard ${shardIndex} not found`);
    }
    throw new Error(`Failed to load shard ${shardIndex}: ${error.message}`);
  }
}

/**
 * Reads a shard using synchronous access (for Worker threads)
 * Provides better performance for repeated reads
 * @param {number} shardIndex - Shard index
 * @param {number} [offset=0] - Byte offset to start reading
 * @param {number} [length] - Number of bytes to read (default: entire shard)
 * @returns {Promise<Uint8Array>}
 */
export async function loadShardSync(shardIndex, offset = 0, length = undefined) {
  if (!currentModelDir) {
    throw new Error('No model directory open. Call openModelDirectory first.');
  }

  const shardInfo = getShardInfo(shardIndex);
  if (!shardInfo) {
    throw new Error(`Invalid shard index: ${shardIndex}`);
  }

  // Align offset to 4KB boundary for optimal reads
  const alignedOffset = Math.floor(offset / ALIGNMENT) * ALIGNMENT;
  const offsetDelta = offset - alignedOffset;

  const readLength = length ?? (shardInfo.size - offset);
  const alignedLength = Math.ceil((readLength + offsetDelta) / ALIGNMENT) * ALIGNMENT;

  try {
    const fileHandle = await currentModelDir.getFileHandle(shardInfo.filename);
    const syncHandle = await fileHandle.createSyncAccessHandle();

    try {
      const buffer = new Uint8Array(alignedLength);
      const bytesRead = syncHandle.read(buffer, { at: alignedOffset });

      // Return only the requested portion
      if (offsetDelta > 0 || readLength !== alignedLength) {
        return buffer.slice(offsetDelta, offsetDelta + readLength);
      }
      return buffer.slice(0, bytesRead);
    } finally {
      syncHandle.close();
    }
  } catch (error) {
    if (error.name === 'NotFoundError') {
      throw new Error(`Shard ${shardIndex} not found`);
    }
    // If sync access not supported, fall back to async
    if (error.name === 'NotSupportedError') {
      console.warn('Sync access not supported, falling back to async read');
      const buffer = await loadShard(shardIndex);
      return new Uint8Array(buffer, offset, length);
    }
    throw new Error(`Failed to sync-load shard ${shardIndex}: ${error.message}`);
  }
}

/**
 * Checks if a shard exists in OPFS
 * @param {number} shardIndex - Shard index
 * @returns {Promise<boolean>}
 */
export async function shardExists(shardIndex) {
  if (!currentModelDir) return false;

  const shardInfo = getShardInfo(shardIndex);
  if (!shardInfo) return false;

  try {
    await currentModelDir.getFileHandle(shardInfo.filename);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Verifies the integrity of all shards
 * @returns {Promise<{valid: boolean, missingShards: number[], corruptShards: number[]}>}
 */
export async function verifyIntegrity() {
  const manifest = getManifest();
  if (!manifest) {
    throw new Error('No manifest loaded');
  }

  if (!currentModelDir) {
    throw new Error('No model directory open');
  }

  const missingShards = [];
  const corruptShards = [];
  const shardCount = getShardCount();

  for (let i = 0; i < shardCount; i++) {
    const exists = await shardExists(i);
    if (!exists) {
      missingShards.push(i);
      continue;
    }

    // Verify hash
    try {
      const buffer = await loadShard(i, { verify: false });
      const hash = await computeBlake3(buffer);
      const shardInfo = getShardInfo(i);

      if (hash !== shardInfo.blake3) {
        corruptShards.push(i);
      }
    } catch (error) {
      corruptShards.push(i);
    }
  }

  return {
    valid: missingShards.length === 0 && corruptShards.length === 0,
    missingShards,
    corruptShards
  };
}

/**
 * Deletes a shard from OPFS
 * @param {number} shardIndex - Shard index
 * @returns {Promise<boolean>}
 */
export async function deleteShard(shardIndex) {
  if (!currentModelDir) return false;

  const shardInfo = getShardInfo(shardIndex);
  if (!shardInfo) return false;

  try {
    await currentModelDir.removeEntry(shardInfo.filename);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Deletes an entire model from OPFS
 * @param {string} modelId - Model identifier
 * @returns {Promise<boolean>}
 */
export async function deleteModel(modelId) {
  if (!modelsDir) {
    await initOPFS();
  }

  const safeName = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    await modelsDir.removeEntry(safeName, { recursive: true });

    // Clear current model dir if it was this model
    if (currentModelDir) {
      try {
        // Check if current dir is the deleted one
        await currentModelDir.getFileHandle('.test', { create: true })
          .then(h => currentModelDir.removeEntry('.test'))
          .catch(() => {});
      } catch {
        currentModelDir = null;
      }
    }

    return true;
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return true; // Already deleted
    }
    return false;
  }
}

/**
 * Lists all models stored in OPFS
 * @returns {Promise<string[]>} Array of model IDs
 */
export async function listModels() {
  if (!modelsDir) {
    try {
      await initOPFS();
    } catch {
      return [];
    }
  }

  const models = [];
  for await (const [name, handle] of modelsDir.entries()) {
    if (handle.kind === 'directory') {
      models.push(name);
    }
  }

  return models;
}

/**
 * Gets information about a stored model
 * @param {string} modelId - Model identifier
 * @returns {Promise<{exists: boolean, shardCount: number, totalSize: number, hasManifest: boolean}>}
 */
export async function getModelInfo(modelId) {
  if (!modelsDir) {
    await initOPFS();
  }

  const safeName = modelId.replace(/[^a-zA-Z0-9_-]/g, '_');

  try {
    const modelDir = await modelsDir.getDirectoryHandle(safeName);
    let shardCount = 0;
    let totalSize = 0;
    let hasManifest = false;

    for await (const [name, handle] of modelDir.entries()) {
      if (handle.kind === 'file') {
        if (name === 'manifest.json') {
          hasManifest = true;
        } else if (name.startsWith('shard_') && name.endsWith('.bin')) {
          shardCount++;
          const file = await handle.getFile();
          totalSize += file.size;
        }
      }
    }

    return { exists: true, shardCount, totalSize, hasManifest };
  } catch (error) {
    return { exists: false, shardCount: 0, totalSize: 0, hasManifest: false };
  }
}

/**
 * Saves the manifest to OPFS
 * @param {string} manifestJson - Manifest JSON string
 * @returns {Promise<void>}
 */
export async function saveManifest(manifestJson) {
  if (!currentModelDir) {
    throw new Error('No model directory open');
  }

  const fileHandle = await currentModelDir.getFileHandle('manifest.json', { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(manifestJson);
  await writable.close();
}

/**
 * Loads the manifest from OPFS
 * @returns {Promise<string>} Manifest JSON string
 */
export async function loadManifestFromOPFS() {
  if (!currentModelDir) {
    throw new Error('No model directory open');
  }

  try {
    const fileHandle = await currentModelDir.getFileHandle('manifest.json');
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (error) {
    if (error.name === 'NotFoundError') {
      throw new Error('Manifest not found');
    }
    throw error;
  }
}

/**
 * Cleans up module state (useful for testing)
 */
export function cleanup() {
  rootDir = null;
  modelsDir = null;
  currentModelDir = null;
}
