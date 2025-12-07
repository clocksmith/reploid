/**
 * rpl-format.js - .rpl Model Format Parser
 *
 * .rpl format consists of:
 * - manifest.json: Model metadata, shard layout, BLAKE3 hashes
 * - N x 64MB shards: Binary weight data (last shard may be smaller)
 *
 * @module storage/rpl-format
 */

// Constants for .rpl format
export const RPL_VERSION = 1;
export const SHARD_SIZE = 64 * 1024 * 1024; // 64MB default shard size
export const MANIFEST_FILENAME = 'manifest.json';

/**
 * @typedef {Object} ShardInfo
 * @property {number} index - Shard index (0-based)
 * @property {string} filename - Shard filename (e.g., "shard_000.bin")
 * @property {number} size - Shard size in bytes
 * @property {string} blake3 - BLAKE3 hash (hex string, 64 chars)
 * @property {number} offset - Byte offset in the full model file
 */

/**
 * @typedef {Object} MoEConfig
 * @property {number} numExperts - Total number of experts
 * @property {number} numExpertsPerToken - Experts selected per token (top-k)
 * @property {number} expertSize - Size of each expert in bytes
 * @property {number[]} expertShardMap - Maps expert index to shard indices
 */

/**
 * @typedef {Object} LayerConfig
 * @property {number} numLayers - Number of transformer layers
 * @property {number} hiddenSize - Hidden dimension
 * @property {number} intermediateSize - FFN intermediate dimension
 * @property {number} numAttentionHeads - Number of attention heads
 * @property {number} numKeyValueHeads - Number of KV heads (for GQA)
 * @property {number} headDim - Dimension per head
 * @property {number} vocabSize - Vocabulary size
 * @property {number} maxSeqLen - Maximum sequence length
 */

/**
 * @typedef {Object} RPLManifest
 * @property {number} version - Format version
 * @property {string} modelId - Unique model identifier
 * @property {string} modelType - Model architecture (e.g., "mixtral", "llama")
 * @property {string} quantization - Quantization format (e.g., "Q4_K_M", "F16")
 * @property {LayerConfig} architecture - Model architecture params
 * @property {MoEConfig|null} moeConfig - MoE configuration (null for dense models)
 * @property {ShardInfo[]} shards - Array of shard information
 * @property {number} totalSize - Total model size in bytes
 * @property {string} blake3Full - BLAKE3 hash of complete model
 * @property {Object} metadata - Additional metadata (license, source, etc.)
 */

// Current loaded manifest (module-level state)
let currentManifest = null;

/**
 * Validates the manifest structure
 * @param {Object} manifest - Parsed manifest object
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateManifest(manifest) {
  const errors = [];

  // Required top-level fields
  if (typeof manifest.version !== 'number') {
    errors.push('Missing or invalid version field');
  } else if (manifest.version > RPL_VERSION) {
    errors.push(`Unsupported format version: ${manifest.version} (max: ${RPL_VERSION})`);
  }

  if (!manifest.modelId || typeof manifest.modelId !== 'string') {
    errors.push('Missing or invalid modelId field');
  }

  if (!manifest.modelType || typeof manifest.modelType !== 'string') {
    errors.push('Missing or invalid modelType field');
  }

  if (!manifest.quantization || typeof manifest.quantization !== 'string') {
    errors.push('Missing or invalid quantization field');
  }

  // Architecture validation
  if (!manifest.architecture || typeof manifest.architecture !== 'object') {
    errors.push('Missing or invalid architecture field');
  } else {
    const arch = manifest.architecture;
    const requiredArchFields = [
      'numLayers', 'hiddenSize', 'intermediateSize',
      'numAttentionHeads', 'vocabSize', 'maxSeqLen'
    ];
    for (const field of requiredArchFields) {
      if (typeof arch[field] !== 'number' || arch[field] <= 0) {
        errors.push(`Invalid architecture.${field}`);
      }
    }
  }

  // MoE config validation (optional, but must be valid if present)
  if (manifest.moeConfig !== null && manifest.moeConfig !== undefined) {
    const moe = manifest.moeConfig;
    if (typeof moe.numExperts !== 'number' || moe.numExperts <= 0) {
      errors.push('Invalid moeConfig.numExperts');
    }
    if (typeof moe.numExpertsPerToken !== 'number' || moe.numExpertsPerToken <= 0) {
      errors.push('Invalid moeConfig.numExpertsPerToken');
    }
    if (moe.numExpertsPerToken > moe.numExperts) {
      errors.push('numExpertsPerToken cannot exceed numExperts');
    }
  }

  // Shards validation
  if (!Array.isArray(manifest.shards) || manifest.shards.length === 0) {
    errors.push('Missing or empty shards array');
  } else {
    let expectedOffset = 0;
    for (let i = 0; i < manifest.shards.length; i++) {
      const shard = manifest.shards[i];

      if (shard.index !== i) {
        errors.push(`Shard ${i} has incorrect index: ${shard.index}`);
      }

      if (typeof shard.size !== 'number' || shard.size <= 0) {
        errors.push(`Shard ${i} has invalid size`);
      }

      if (!shard.blake3 || typeof shard.blake3 !== 'string' || shard.blake3.length !== 64) {
        errors.push(`Shard ${i} has invalid blake3 hash`);
      }

      if (!shard.filename || typeof shard.filename !== 'string') {
        errors.push(`Shard ${i} has invalid filename`);
      }

      if (shard.offset !== expectedOffset) {
        errors.push(`Shard ${i} has incorrect offset: expected ${expectedOffset}, got ${shard.offset}`);
      }
      expectedOffset += shard.size;
    }

    // Verify total size matches sum of shards
    if (manifest.totalSize !== expectedOffset) {
      errors.push(`totalSize mismatch: declared ${manifest.totalSize}, calculated ${expectedOffset}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Parses a manifest JSON string
 * @param {string} jsonString - Raw manifest JSON
 * @returns {RPLManifest}
 * @throws {Error} If manifest is invalid
 */
export function parseManifest(jsonString) {
  let manifest;

  try {
    manifest = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`Failed to parse manifest JSON: ${e.message}`);
  }

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid manifest:\n  - ${validation.errors.join('\n  - ')}`);
  }

  // Normalize optional fields
  manifest.moeConfig = manifest.moeConfig || null;
  manifest.metadata = manifest.metadata || {};

  // Compute derived fields if missing
  manifest.architecture.numKeyValueHeads =
    manifest.architecture.numKeyValueHeads || manifest.architecture.numAttentionHeads;
  manifest.architecture.headDim =
    manifest.architecture.headDim ||
    Math.floor(manifest.architecture.hiddenSize / manifest.architecture.numAttentionHeads);

  currentManifest = manifest;
  return manifest;
}

/**
 * Gets the currently loaded manifest
 * @returns {RPLManifest|null}
 */
export function getManifest() {
  return currentManifest;
}

/**
 * Clears the currently loaded manifest
 */
export function clearManifest() {
  currentManifest = null;
}

/**
 * Gets shard info by index
 * @param {number} index - Shard index
 * @returns {ShardInfo|null}
 */
export function getShardInfo(index) {
  if (!currentManifest || index < 0 || index >= currentManifest.shards.length) {
    return null;
  }
  return currentManifest.shards[index];
}

/**
 * Gets the total number of shards
 * @returns {number}
 */
export function getShardCount() {
  return currentManifest?.shards?.length ?? 0;
}

/**
 * Checks if the model is MoE architecture
 * @returns {boolean}
 */
export function isMoE() {
  return currentManifest?.moeConfig !== null;
}

/**
 * Gets shards containing a specific expert's weights
 * @param {number} expertIndex - Expert index
 * @returns {number[]} Array of shard indices
 */
export function getShardsForExpert(expertIndex) {
  if (!currentManifest?.moeConfig?.expertShardMap) {
    return [];
  }
  const shardIndices = currentManifest.moeConfig.expertShardMap[expertIndex];
  return Array.isArray(shardIndices) ? shardIndices : [shardIndices];
}

/**
 * Generates a shard filename from index
 * @param {number} index - Shard index
 * @returns {string}
 */
export function generateShardFilename(index) {
  return `shard_${String(index).padStart(3, '0')}.bin`;
}

/**
 * Calculates the number of shards needed for a given total size
 * @param {number} totalSize - Total size in bytes
 * @param {number} [shardSize=SHARD_SIZE] - Size per shard
 * @returns {number}
 */
export function calculateShardCount(totalSize, shardSize = SHARD_SIZE) {
  return Math.ceil(totalSize / shardSize);
}

/**
 * Creates shard info array for a new model
 * @param {number} totalSize - Total model size in bytes
 * @param {string[]} hashes - BLAKE3 hashes for each shard
 * @param {number} [shardSize=SHARD_SIZE] - Size per shard
 * @returns {ShardInfo[]}
 */
export function createShardLayout(totalSize, hashes, shardSize = SHARD_SIZE) {
  const numShards = calculateShardCount(totalSize, shardSize);

  if (hashes.length !== numShards) {
    throw new Error(`Hash count mismatch: expected ${numShards}, got ${hashes.length}`);
  }

  const shards = [];
  let offset = 0;

  for (let i = 0; i < numShards; i++) {
    const isLast = i === numShards - 1;
    const size = isLast ? totalSize - offset : shardSize;

    shards.push({
      index: i,
      filename: generateShardFilename(i),
      size,
      blake3: hashes[i],
      offset
    });

    offset += size;
  }

  return shards;
}

/**
 * Creates a manifest object for a new model
 * @param {Object} options - Model options
 * @returns {RPLManifest}
 */
export function createManifest({
  modelId,
  modelType,
  quantization,
  architecture,
  moeConfig = null,
  totalSize,
  shardHashes,
  blake3Full,
  metadata = {}
}) {
  const shards = createShardLayout(totalSize, shardHashes);

  const manifest = {
    version: RPL_VERSION,
    modelId,
    modelType,
    quantization,
    architecture,
    moeConfig,
    shards,
    totalSize,
    blake3Full,
    metadata
  };

  // Validate the created manifest
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Created invalid manifest:\n  - ${validation.errors.join('\n  - ')}`);
  }

  return manifest;
}

/**
 * Serializes manifest to JSON string
 * @param {RPLManifest} manifest - Manifest object
 * @returns {string}
 */
export function serializeManifest(manifest) {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Gets the URL for a shard given base URL and shard index
 * @param {string} baseUrl - Base URL for the model
 * @param {number} shardIndex - Shard index
 * @returns {string}
 */
export function getShardUrl(baseUrl, shardIndex) {
  const shard = getShardInfo(shardIndex);
  if (!shard) {
    throw new Error(`Invalid shard index: ${shardIndex}`);
  }
  // Remove trailing slash from baseUrl if present
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/${shard.filename}`;
}

/**
 * Gets the manifest URL from base URL
 * @param {string} baseUrl - Base URL for the model
 * @returns {string}
 */
export function getManifestUrl(baseUrl) {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/${MANIFEST_FILENAME}`;
}
