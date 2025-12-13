/**
 * rdrr-writer.js - .rdrr Model Format Writer
 *
 * Writes models in DOPPLER's .rdrr format:
 * - manifest.json with model metadata and shard layout
 * - 64MB shard files with tensor data
 * - BLAKE3 hashes for integrity verification
 *
 * @module tools/rdrr-writer
 */

import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';

// Default shard size: 64MB
const DEFAULT_SHARD_SIZE = 64 * 1024 * 1024;

// 4KB alignment for optimal OPFS performance
const ALIGNMENT = 4096;

/**
 * Compute hash of data (BLAKE3 preferred, SHA-256 fallback)
 * @param {Uint8Array|Buffer} data - Data to hash
 * @returns {string} Hex hash string
 */
async function computeHash(data) {
  // Try BLAKE3 first (if available via native module)
  try {
    const { blake3 } = await import('blake3');
    return blake3(data).toString('hex');
  } catch {
    // Fall back to SHA-256
    const hash = createHash('sha256');
    hash.update(data);
    return hash.digest('hex');
  }
}

/**
 * Align offset to boundary
 * @param {number} offset - Current offset
 * @param {number} alignment - Alignment boundary
 * @returns {number} Aligned offset
 */
function alignOffset(offset, alignment = ALIGNMENT) {
  const remainder = offset % alignment;
  return remainder === 0 ? offset : offset + (alignment - remainder);
}

/**
 * Create padding buffer
 * @param {number} size - Padding size
 * @returns {Uint8Array} Zero-filled buffer
 */
function createPadding(size) {
  return new Uint8Array(size);
}

/**
 * RPL Writer class
 */
export class RDRRWriter {
  constructor(outputDir, options = {}) {
    this.outputDir = outputDir;
    this.shardSize = options.shardSize || DEFAULT_SHARD_SIZE;
    this.hashAlgorithm = options.hashAlgorithm || 'sha256'; // or 'blake3'

    // State
    this.shards = [];
    this.currentShard = null;
    this.currentShardIndex = 0;
    this.currentShardOffset = 0;
    this.tensorLocations = new Map();

    // Manifest data
    this.manifest = {
      version: '1.0',
      modelId: options.modelId || 'unknown',
      modelType: options.modelType || 'transformer',
      architecture: options.architecture || 'llama',
      quantization: options.quantization || 'Q4_K_M',
      config: {},
      tokenizer: {},
      shards: [],
      tensors: {},
      moeConfig: null,
    };
  }

  /**
   * Initialize writer and create output directory
   */
  async init() {
    await mkdir(this.outputDir, { recursive: true });
    this.startNewShard();
  }

  /**
   * Start a new shard
   */
  startNewShard() {
    if (this.currentShard && this.currentShardOffset > 0) {
      this.finalizeShard();
    }

    this.currentShard = {
      index: this.currentShardIndex,
      data: [],
      size: 0,
    };
  }

  /**
   * Finalize current shard and write to disk
   */
  async finalizeShard() {
    if (!this.currentShard || this.currentShard.size === 0) {
      return;
    }

    // Concatenate all data chunks
    const totalSize = this.currentShard.data.reduce((sum, chunk) => sum + chunk.length, 0);
    const shardData = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of this.currentShard.data) {
      shardData.set(chunk, offset);
      offset += chunk.length;
    }

    // Compute hash
    const hash = await computeHash(shardData);

    // Write shard file
    const shardFileName = `shard_${String(this.currentShardIndex).padStart(5, '0')}.bin`;
    const shardPath = join(this.outputDir, shardFileName);
    await writeFile(shardPath, shardData);

    // Record shard info
    this.shards.push({
      index: this.currentShardIndex,
      fileName: shardFileName,
      size: totalSize,
      hash,
      hashAlgorithm: this.hashAlgorithm,
    });

    // Prepare for next shard
    this.currentShardIndex++;
    this.currentShardOffset = 0;
    this.currentShard = null;
  }

  /**
   * Write tensor data, splitting across shards if needed
   * @param {string} name - Tensor name
   * @param {Uint8Array} data - Tensor data
   * @param {Object} metadata - Tensor metadata (shape, dtype, etc.)
   * @returns {Object} Tensor location info
   */
  async writeTensor(name, data, metadata) {
    // Ensure shard is started
    if (!this.currentShard) {
      this.startNewShard();
    }

    // Check if we need to start a new shard
    const alignedOffset = alignOffset(this.currentShardOffset);
    const spaceNeeded = (alignedOffset - this.currentShardOffset) + data.length;

    if (this.currentShardOffset > 0 && this.currentShardOffset + spaceNeeded > this.shardSize) {
      await this.finalizeShard();
      this.startNewShard();
    }

    // Add alignment padding
    const paddingNeeded = alignOffset(this.currentShardOffset) - this.currentShardOffset;
    if (paddingNeeded > 0) {
      this.currentShard.data.push(createPadding(paddingNeeded));
      this.currentShard.size += paddingNeeded;
      this.currentShardOffset += paddingNeeded;
    }

    // Record tensor location
    const location = {
      shardIndex: this.currentShardIndex,
      offset: this.currentShardOffset,
      size: data.length,
      ...metadata,
    };
    this.tensorLocations.set(name, location);

    // Handle large tensors that span multiple shards
    let remaining = data;
    let tensorShards = [];

    while (remaining.length > 0) {
      const spaceInShard = this.shardSize - this.currentShardOffset;
      const writeSize = Math.min(remaining.length, spaceInShard);

      const chunk = remaining.slice(0, writeSize);
      this.currentShard.data.push(chunk);
      this.currentShard.size += writeSize;
      this.currentShardOffset += writeSize;

      tensorShards.push({
        shardIndex: this.currentShardIndex,
        offset: this.currentShardOffset - writeSize,
        size: writeSize,
      });

      remaining = remaining.slice(writeSize);

      if (remaining.length > 0) {
        await this.finalizeShard();
        this.startNewShard();
      }
    }

    // Update location if tensor spans multiple shards
    if (tensorShards.length > 1) {
      location.spans = tensorShards;
    }

    return location;
  }

  /**
   * Set model configuration
   * @param {Object} config - Model config
   */
  setConfig(config) {
    this.manifest.config = config;
  }

  /**
   * Set tokenizer configuration
   * @param {Object} tokenizer - Tokenizer config
   */
  setTokenizer(tokenizer) {
    this.manifest.tokenizer = tokenizer;
  }

  /**
   * Set MoE configuration
   * @param {Object} moeConfig - MoE config
   */
  setMoEConfig(moeConfig) {
    this.manifest.moeConfig = moeConfig;
  }

  /**
   * Set model metadata
   * @param {Object} meta - Metadata fields to set
   */
  setMetadata(meta) {
    Object.assign(this.manifest, meta);
  }

  /**
   * Write bundled tokenizer.json from extracted GGUF vocab data.
   * This eliminates the runtime dependency on transformers.js CDN.
   * @param {Object} tokenizer - Tokenizer data from GGUF parser
   * @returns {Promise<void>}
   */
  async writeTokenizer(tokenizer) {
    if (!tokenizer.tokens || tokenizer.tokens.length === 0) {
      console.warn('[RDRRWriter] No vocab tokens found, skipping tokenizer bundling');
      // Fall back to basic config
      this.manifest.tokenizer = {
        model: tokenizer.model,
        bosTokenId: tokenizer.bosTokenId,
        eosTokenId: tokenizer.eosTokenId,
        padTokenId: tokenizer.padTokenId,
        unkTokenId: tokenizer.unkTokenId,
        addBosToken: tokenizer.addBosToken,
        addEosToken: tokenizer.addEosToken,
      };
      return;
    }

    // Build vocab mapping: token string -> id
    const vocab = {};
    for (let i = 0; i < tokenizer.tokens.length; i++) {
      vocab[tokenizer.tokens[i]] = i;
    }

    // Determine tokenizer type from available data
    // - If merges present: BPE tokenizer
    // - If scores present: Unigram/SentencePiece tokenizer
    const hasMerges = tokenizer.merges && tokenizer.merges.length > 0;
    const hasScores = tokenizer.scores && tokenizer.scores.length > 0;
    const type = hasMerges ? 'bpe' : (hasScores ? 'unigram' : 'bpe');

    const tokenizerJson = {
      type,
      model: tokenizer.model,
      vocab,
      vocabSize: tokenizer.tokens.length,
      // Include merges for BPE
      merges: hasMerges ? tokenizer.merges : null,
      // Include scores for Unigram/SentencePiece
      scores: hasScores ? tokenizer.scores : null,
      // Token types (normal=1, unknown=2, control=3, user_defined=4, byte=6, etc.)
      tokenTypes: tokenizer.tokenTypes || null,
      // Special token configuration
      specialTokens: {
        bos: tokenizer.bosTokenId,
        eos: tokenizer.eosTokenId,
        pad: tokenizer.padTokenId,
        unk: tokenizer.unkTokenId,
        sep: tokenizer.sepTokenId,
        cls: tokenizer.clsTokenId,
        mask: tokenizer.maskTokenId,
      },
      // Behavior flags
      addBosToken: tokenizer.addBosToken ?? true,
      addEosToken: tokenizer.addEosToken ?? false,
      addSpacePrefix: tokenizer.addSpacePrefix ?? true,
    };

    // Write tokenizer.json
    const tokenizerPath = join(this.outputDir, 'tokenizer.json');
    await writeFile(tokenizerPath, JSON.stringify(tokenizerJson));

    console.log(`[RDRRWriter] Wrote tokenizer.json (${tokenizer.tokens.length} tokens, type: ${type})`);

    // Update manifest to reference bundled tokenizer
    this.manifest.tokenizer = {
      type: 'bundled',
      file: 'tokenizer.json',
      vocabSize: tokenizer.tokens.length,
      tokenizerType: type,
    };
  }

  /**
   * Copy HuggingFace tokenizer.json to output directory.
   * The HF format is preserved and handled at runtime by BundledTokenizer.
   * @param {Object} tokenizerJson - Parsed HuggingFace tokenizer.json
   * @returns {Promise<void>}
   */
  async writeHuggingFaceTokenizer(tokenizerJson) {
    if (!tokenizerJson || !tokenizerJson.model) {
      console.warn('[RDRRWriter] Invalid HuggingFace tokenizer.json, skipping');
      return;
    }

    const tokenizerPath = join(this.outputDir, 'tokenizer.json');
    await writeFile(tokenizerPath, JSON.stringify(tokenizerJson));

    // Extract vocab size from HF format
    const model = tokenizerJson.model;
    let vocabSize;
    if (Array.isArray(model.vocab)) {
      // Unigram format: [[token, score], ...]
      vocabSize = model.vocab.length;
    } else {
      // BPE format: { token: id }
      vocabSize = Object.keys(model.vocab || {}).length;
    }
    const type = model.type?.toLowerCase() || 'bpe';

    console.log(`[RDRRWriter] Wrote HuggingFace tokenizer.json (${vocabSize} tokens, type: ${type})`);

    this.manifest.tokenizer = {
      type: 'huggingface',
      file: 'tokenizer.json',
      vocabSize,
      tokenizerType: type,
    };
  }

  /**
   * Finalize and write manifest
   */
  async finalize() {
    // Finalize last shard
    await this.finalizeShard();

    // Build tensor map for manifest
    const tensors = {};
    for (const [name, location] of this.tensorLocations) {
      tensors[name] = {
        shard: location.shardIndex,
        offset: location.offset,
        size: location.size,
        shape: location.shape,
        dtype: location.dtype,
      };
      if (location.spans) {
        tensors[name].spans = location.spans;
      }
    }

    // Complete manifest
    this.manifest.shards = this.shards.map((s) => ({
      index: s.index,
      fileName: s.fileName,
      size: s.size,
      hash: s.hash,
      hashAlgorithm: s.hashAlgorithm,
    }));
    this.manifest.tensors = tensors;
    this.manifest.totalSize = this.shards.reduce((sum, s) => sum + s.size, 0);
    this.manifest.tensorCount = this.tensorLocations.size;

    // Write manifest
    const manifestPath = join(this.outputDir, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(this.manifest, null, 2));

    return {
      manifestPath,
      shardCount: this.shards.length,
      totalSize: this.manifest.totalSize,
      tensorCount: this.manifest.tensorCount,
    };
  }

  /**
   * Clean up output directory (for error recovery)
   */
  async cleanup() {
    try {
      await rm(this.outputDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * High-level function to write a complete .rdrr model
 * @param {string} outputDir - Output directory
 * @param {Object} modelInfo - Model info from parser
 * @param {Function} getTensorData - Async function to get tensor data by name
 * @param {Object} options - Writer options
 * @returns {Promise<Object>} Write result
 */
export async function writeRDRR(outputDir, modelInfo, getTensorData, options = {}) {
  const writer = new RDRRWriter(outputDir, {
    modelId: modelInfo.modelName || modelInfo.config?.modelId || 'model',
    architecture: modelInfo.architecture || modelInfo.config?.architectures?.[0] || 'llama',
    quantization: modelInfo.quantization || options.quantization || 'Q4_K_M',
    ...options,
  });

  try {
    await writer.init();

    // Set config
    if (modelInfo.config) {
      writer.setConfig(modelInfo.config);
    }

    // Write tokenizer (bundles vocab if available, eliminating transformers.js dependency)
    const tokenizer = modelInfo.tokenizer || modelInfo.config?.tokenizer || modelInfo.tokenizerConfig;
    const hfTokenizer = modelInfo.tokenizerJson; // HuggingFace format from SafeTensors

    if (hfTokenizer && hfTokenizer.model?.vocab) {
      // HuggingFace tokenizer.json available - copy it directly
      await writer.writeHuggingFaceTokenizer(hfTokenizer);
    } else if (tokenizer?.tokens?.length > 0) {
      // GGUF-extracted vocab - write bundled format
      await writer.writeTokenizer(tokenizer);
    } else if (tokenizer) {
      // Fallback to basic config (no vocab bundling)
      writer.setTokenizer(tokenizer);
    }

    // Check for MoE
    if (modelInfo.config?.expertCount || modelInfo.config?.num_local_experts) {
      writer.setMoEConfig({
        numExperts: modelInfo.config.expertCount || modelInfo.config.num_local_experts,
        topK: modelInfo.config.expertUsedCount || modelInfo.config.num_experts_per_tok || 2,
      });
    }

    // Write tensors
    const progressCallback = options.onProgress || (() => {});
    const totalTensors = modelInfo.tensors.length;

    for (let i = 0; i < modelInfo.tensors.length; i++) {
      const tensor = modelInfo.tensors[i];
      const data = await getTensorData(tensor);

      await writer.writeTensor(tensor.name, new Uint8Array(data), {
        shape: tensor.shape,
        dtype: tensor.dtype,
      });

      progressCallback({
        stage: 'writing',
        current: i + 1,
        total: totalTensors,
        tensorName: tensor.name,
      });
    }

    // Finalize
    const result = await writer.finalize();
    progressCallback({ stage: 'complete', ...result });

    return result;
  } catch (error) {
    await writer.cleanup();
    throw error;
  }
}

/**
 * Create a minimal test model .rdrr for testing
 * @param {string} outputDir - Output directory
 * @returns {Promise<Object>} Write result
 */
export async function createTestModel(outputDir) {
  const writer = new RDRRWriter(outputDir, {
    modelId: 'tiny-test',
    architecture: 'test',
    quantization: 'F32',
  });

  await writer.init();

  writer.setConfig({
    vocabSize: 1000,
    hiddenSize: 64,
    numLayers: 2,
    numHeads: 2,
    contextLength: 128,
  });

  writer.setTokenizer({
    model: 'bpe',
    vocabSize: 1000,
    bosTokenId: 1,
    eosTokenId: 2,
  });

  // Create minimal tensors
  const hiddenSize = 64;
  const vocabSize = 1000;
  const intermediateSize = 256;

  // Embedding
  const embedData = new Float32Array(vocabSize * hiddenSize);
  for (let i = 0; i < embedData.length; i++) {
    embedData[i] = (Math.random() - 0.5) * 0.02;
  }
  await writer.writeTensor('embed_tokens.weight', new Uint8Array(embedData.buffer), {
    shape: [vocabSize, hiddenSize],
    dtype: 'F32',
  });

  // Two layers
  for (let layer = 0; layer < 2; layer++) {
    // Attention weights
    const qkvSize = hiddenSize * hiddenSize * 3;
    const qkvData = new Float32Array(qkvSize);
    for (let i = 0; i < qkvSize; i++) {
      qkvData[i] = (Math.random() - 0.5) * 0.02;
    }
    await writer.writeTensor(`layers.${layer}.attention.qkv.weight`, new Uint8Array(qkvData.buffer), {
      shape: [hiddenSize * 3, hiddenSize],
      dtype: 'F32',
    });

    // Output projection
    const oData = new Float32Array(hiddenSize * hiddenSize);
    for (let i = 0; i < oData.length; i++) {
      oData[i] = (Math.random() - 0.5) * 0.02;
    }
    await writer.writeTensor(`layers.${layer}.attention.o.weight`, new Uint8Array(oData.buffer), {
      shape: [hiddenSize, hiddenSize],
      dtype: 'F32',
    });

    // FFN
    const upData = new Float32Array(intermediateSize * hiddenSize);
    for (let i = 0; i < upData.length; i++) {
      upData[i] = (Math.random() - 0.5) * 0.02;
    }
    await writer.writeTensor(`layers.${layer}.ffn.up.weight`, new Uint8Array(upData.buffer), {
      shape: [intermediateSize, hiddenSize],
      dtype: 'F32',
    });

    const downData = new Float32Array(hiddenSize * intermediateSize);
    for (let i = 0; i < downData.length; i++) {
      downData[i] = (Math.random() - 0.5) * 0.02;
    }
    await writer.writeTensor(`layers.${layer}.ffn.down.weight`, new Uint8Array(downData.buffer), {
      shape: [hiddenSize, intermediateSize],
      dtype: 'F32',
    });

    // Layer norms
    const normData = new Float32Array(hiddenSize).fill(1.0);
    await writer.writeTensor(`layers.${layer}.input_norm.weight`, new Uint8Array(normData.buffer), {
      shape: [hiddenSize],
      dtype: 'F32',
    });
    await writer.writeTensor(`layers.${layer}.post_norm.weight`, new Uint8Array(normData.buffer), {
      shape: [hiddenSize],
      dtype: 'F32',
    });
  }

  // Output head
  const lmHeadData = new Float32Array(vocabSize * hiddenSize);
  for (let i = 0; i < lmHeadData.length; i++) {
    lmHeadData[i] = (Math.random() - 0.5) * 0.02;
  }
  await writer.writeTensor('lm_head.weight', new Uint8Array(lmHeadData.buffer), {
    shape: [vocabSize, hiddenSize],
    dtype: 'F32',
  });

  // Final norm
  const finalNormData = new Float32Array(hiddenSize).fill(1.0);
  await writer.writeTensor('final_norm.weight', new Uint8Array(finalNormData.buffer), {
    shape: [hiddenSize],
    dtype: 'F32',
  });

  return writer.finalize();
}

// Export for external use
export { DEFAULT_SHARD_SIZE, ALIGNMENT, computeHash };
