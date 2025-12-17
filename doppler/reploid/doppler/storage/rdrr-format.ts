/**
 * .rdrr Model Format Parser
 * Format: manifest.json + N x 64MB shards with BLAKE3/SHA256 hashes
 */

export const RDRR_VERSION = 1;
export const SHARD_SIZE = 64 * 1024 * 1024;
export const MANIFEST_FILENAME = 'manifest.json';

export type HashAlgorithm = 'sha256' | 'blake3';
export type AttentionKernel = 'auto' | 'tiled_large' | 'tiled_small' | 'streaming';

export interface ShardInfo {
  index: number;
  filename: string;
  size: number;
  hash: string;
  blake3?: string;
  hashAlgorithm?: HashAlgorithm;
  offset: number;
}

export interface MoEConfig {
  numExperts: number;
  numExpertsPerToken: number;
  expertSize?: number;
  /** Maps expert key (e.g., "0_0" for layer 0, expert 0) to shard indices */
  expertShardMap?: Record<string, number[]>;
  /** Maps expert key to tensor names for that expert */
  expertTensors?: Record<string, string[]>;
  /** Total size of a single expert in bytes (for memory planning) */
  expertBytes?: number;
  /** Shared expert indices (DeepSeek-style) - these should stay pinned in cache */
  sharedExperts?: number[];
}

export interface LayerConfig {
  numLayers: number;
  hiddenSize: number;
  intermediateSize: number;
  numAttentionHeads: number;
  numKeyValueHeads?: number;
  headDim?: number;
  vocabSize: number;
  maxSeqLen: number;
}

export type WeightLayout = 'row' | 'column';

export interface TensorLocation {
  shard: number;
  offset: number;
  size: number;
  shape: number[];
  dtype: string;
  spans?: Array<{ shardIndex: number; offset: number; size: number }>;
  /** Weight storage layout: 'row' (default) or 'column' (pre-transposed for faster matmul) */
  layout?: WeightLayout;
  /** Original shape before transpose (if layout is 'column') */
  originalShape?: number[];
}

export interface RuntimeOptimizations {
  attentionKernel?: AttentionKernel;
}

export interface RDRRManifest {
  version: number | string;
  modelId: string;
  modelType: string;
  quantization: string;
  architecture: LayerConfig | string;
  hashAlgorithm?: HashAlgorithm;
  moeConfig: MoEConfig | null;
  optimizations?: RuntimeOptimizations;
  shards: ShardInfo[];
  totalSize: number;
  blake3Full?: string;
  metadata: Record<string, unknown>;
  tensors?: Record<string, TensorLocation>;
  config?: Record<string, unknown>;
  tokenizer?: Record<string, unknown>;
  tensorCount?: number;
  name?: string;
  /** Default weight storage layout for matmul weights */
  defaultWeightLayout?: WeightLayout;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

let currentManifest: RDRRManifest | null = null;

function validateManifest(manifest: Partial<RDRRManifest>): ValidationResult {
  const errors: string[] = [];

  const version = typeof manifest.version === 'string'
    ? parseFloat(manifest.version)
    : manifest.version;

  if (typeof version !== 'number' || isNaN(version)) {
    errors.push('Missing or invalid version field');
  } else if (version > RDRR_VERSION + 1) {
    errors.push(`Unsupported format version: ${manifest.version} (max: ${RDRR_VERSION})`);
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

  if (manifest.hashAlgorithm !== undefined) {
    if (manifest.hashAlgorithm !== 'sha256' && manifest.hashAlgorithm !== 'blake3') {
      errors.push(`Invalid hashAlgorithm: ${manifest.hashAlgorithm}`);
    }
  }

  if (manifest.architecture && typeof manifest.architecture === 'object') {
    const arch = manifest.architecture as LayerConfig;
    const requiredFields: (keyof LayerConfig)[] = [
      'numLayers', 'hiddenSize', 'intermediateSize',
      'numAttentionHeads', 'vocabSize', 'maxSeqLen'
    ];
    for (const field of requiredFields) {
      const value = arch[field];
      if (typeof value !== 'number' || value <= 0) {
        errors.push(`Invalid architecture.${field}`);
      }
    }
  } else if (!manifest.architecture && !manifest.config) {
    errors.push('Missing architecture or config field');
  }

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

      const hash = shard.hash || shard.blake3;
      if (!hash || typeof hash !== 'string' || hash.length !== 64) {
        errors.push(`Shard ${i} has invalid hash`);
      }

      if (!shard.filename || typeof shard.filename !== 'string') {
        errors.push(`Shard ${i} has invalid filename`);
      }

      if (shard.hashAlgorithm !== undefined) {
        if (shard.hashAlgorithm !== 'sha256' && shard.hashAlgorithm !== 'blake3') {
          errors.push(`Shard ${i} has invalid hashAlgorithm`);
        } else if (manifest.hashAlgorithm && shard.hashAlgorithm !== manifest.hashAlgorithm) {
          errors.push(`Shard ${i} hashAlgorithm differs from manifest.hashAlgorithm`);
        }
      }

      if (shard.offset !== expectedOffset) {
        errors.push(`Shard ${i} has incorrect offset: expected ${expectedOffset}, got ${shard.offset}`);
      }
      expectedOffset += shard.size;
    }

    if (manifest.totalSize !== expectedOffset) {
      errors.push(`totalSize mismatch: declared ${manifest.totalSize}, calculated ${expectedOffset}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function parseManifest(jsonString: string): RDRRManifest {
  let manifest: RDRRManifest;

  try {
    manifest = JSON.parse(jsonString);
  } catch (e) {
    throw new Error(`Failed to parse manifest JSON: ${(e as Error).message}`);
  }

  if (Array.isArray(manifest.shards)) {
    let offset = 0;
    const inferredHashAlgorithm = manifest.hashAlgorithm ||
      (manifest.shards.find(s => typeof s?.hashAlgorithm === 'string')?.hashAlgorithm as HashAlgorithm | undefined) ||
      undefined;

    manifest.shards = manifest.shards.map((shard: ShardInfo & { fileName?: string }, i: number) => {
      const normalized: ShardInfo = {
        index: shard.index ?? i,
        filename: shard.filename || shard.fileName || '',
        size: shard.size,
        hash: shard.hash || shard.blake3 || '',
        blake3: shard.blake3 || shard.hash,
        offset: shard.offset ?? offset,
        hashAlgorithm: shard.hashAlgorithm || inferredHashAlgorithm,
      };
      offset += shard.size;
      return normalized;
    });

    if (!manifest.hashAlgorithm && inferredHashAlgorithm) {
      manifest.hashAlgorithm = inferredHashAlgorithm;
    }
  }

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid manifest:\n  - ${validation.errors.join('\n  - ')}`);
  }

  manifest.moeConfig = manifest.moeConfig || null;
  manifest.metadata = manifest.metadata || {};

  if (manifest.architecture && typeof manifest.architecture === 'object') {
    const arch = manifest.architecture as LayerConfig;
    arch.numKeyValueHeads = arch.numKeyValueHeads || arch.numAttentionHeads;
    arch.headDim = arch.headDim || Math.floor(arch.hiddenSize / arch.numAttentionHeads);
  }

  currentManifest = manifest;
  return manifest;
}

export function getManifest(): RDRRManifest | null {
  return currentManifest;
}

export function clearManifest(): void {
  currentManifest = null;
}

export function getShardInfo(index: number): ShardInfo | null {
  if (!currentManifest || index < 0 || index >= currentManifest.shards.length) {
    return null;
  }
  return currentManifest.shards[index];
}

export function getShardCount(): number {
  return currentManifest?.shards?.length ?? 0;
}

export function isMoE(): boolean {
  return currentManifest?.moeConfig !== null;
}

/**
 * Get shard indices containing an expert's weights
 * @param layerIdx - Layer index
 * @param expertIdx - Expert index within layer
 * @returns Array of shard indices, empty if not found
 */
export function getShardsForExpert(layerIdx: number, expertIdx: number): number[] {
  if (!currentManifest?.moeConfig?.expertShardMap) {
    return [];
  }
  const key = `${layerIdx}_${expertIdx}`;
  const shardIndices = currentManifest.moeConfig.expertShardMap[key];
  if (!shardIndices) {
    return [];
  }
  return Array.isArray(shardIndices) ? shardIndices : [shardIndices];
}

/**
 * Get tensor names for an expert
 * @param layerIdx - Layer index
 * @param expertIdx - Expert index within layer
 * @returns Array of tensor names, empty if not found
 */
export function getTensorsForExpert(layerIdx: number, expertIdx: number): string[] {
  if (!currentManifest?.moeConfig?.expertTensors) {
    return [];
  }
  const key = `${layerIdx}_${expertIdx}`;
  return currentManifest.moeConfig.expertTensors[key] || [];
}

/**
 * Get estimated memory for a single expert
 */
export function getExpertBytes(): number {
  return currentManifest?.moeConfig?.expertBytes || 0;
}

export function generateShardFilename(index: number): string {
  return `shard_${String(index).padStart(5, '0')}.bin`;
}

export function calculateShardCount(totalSize: number, shardSize = SHARD_SIZE): number {
  return Math.ceil(totalSize / shardSize);
}

export function createShardLayout(
  totalSize: number,
  hashes: string[],
  shardSize = SHARD_SIZE
): ShardInfo[] {
  const numShards = calculateShardCount(totalSize, shardSize);

  if (hashes.length !== numShards) {
    throw new Error(`Hash count mismatch: expected ${numShards}, got ${hashes.length}`);
  }

  const shards: ShardInfo[] = [];
  let offset = 0;

  for (let i = 0; i < numShards; i++) {
    const isLast = i === numShards - 1;
    const size = isLast ? totalSize - offset : shardSize;

    shards.push({
      index: i,
      filename: generateShardFilename(i),
      size,
      hash: hashes[i],
      blake3: hashes[i],
      offset,
    });

    offset += size;
  }

  return shards;
}

export interface CreateManifestOptions {
  modelId: string;
  modelType: string;
  quantization: string;
  architecture: LayerConfig | string;
  moeConfig?: MoEConfig | null;
  totalSize: number;
  shardHashes: string[];
  blake3Full?: string;
  metadata?: Record<string, unknown>;
}

export function createManifest(options: CreateManifestOptions): RDRRManifest {
  const shards = createShardLayout(options.totalSize, options.shardHashes);

  const manifest: RDRRManifest = {
    version: RDRR_VERSION,
    modelId: options.modelId,
    modelType: options.modelType,
    quantization: options.quantization,
    architecture: options.architecture,
    moeConfig: options.moeConfig ?? null,
    shards,
    totalSize: options.totalSize,
    blake3Full: options.blake3Full,
    metadata: options.metadata ?? {},
  };

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Created invalid manifest:\n  - ${validation.errors.join('\n  - ')}`);
  }

  return manifest;
}

export function serializeManifest(manifest: RDRRManifest): string {
  return JSON.stringify(manifest, null, 2);
}

export function getShardUrl(baseUrl: string, shardIndex: number): string {
  const shard = getShardInfo(shardIndex);
  if (!shard) {
    throw new Error(`Invalid shard index: ${shardIndex}`);
  }
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/${shard.filename}`;
}

export function getManifestUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/${MANIFEST_FILENAME}`;
}
