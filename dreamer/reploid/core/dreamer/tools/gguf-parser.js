/**
 * gguf-parser.js - GGUF Model Format Parser
 *
 * Parses GGUF files (llama.cpp format) to extract:
 * - Model metadata (architecture, context length, vocab size, etc.)
 * - Tensor information (names, shapes, dtypes, offsets)
 * - Quantization type
 *
 * GGUF Spec: https://github.com/ggerganov/ggml/blob/master/docs/gguf.md
 *
 * @module tools/gguf-parser
 */

import { readFile } from 'fs/promises';

// GGUF Magic number: "GGUF" in little-endian
const GGUF_MAGIC = 0x46554747; // 'GGUF'

// GGUF versions supported
const GGUF_VERSION_MIN = 2;
const GGUF_VERSION_MAX = 3;

// GGUF metadata value types
const GGUFValueType = {
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12,
};

// GGML tensor types (quantization formats)
const GGMLType = {
  F32: 0,
  F16: 1,
  Q4_0: 2,
  Q4_1: 3,
  Q5_0: 6,
  Q5_1: 7,
  Q8_0: 8,
  Q8_1: 9,
  Q2_K: 10,
  Q3_K: 11,
  Q4_K: 12,
  Q5_K: 13,
  Q6_K: 14,
  Q8_K: 15,
  IQ2_XXS: 16,
  IQ2_XS: 17,
  IQ3_XXS: 18,
  IQ1_S: 19,
  IQ4_NL: 20,
  IQ3_S: 21,
  IQ2_S: 22,
  IQ4_XS: 23,
  I8: 24,
  I16: 25,
  I32: 26,
  I64: 27,
  F64: 28,
  BF16: 29,
};

// Reverse lookup for type names
const GGMLTypeName = Object.fromEntries(
  Object.entries(GGMLType).map(([k, v]) => [v, k])
);

// Block sizes for quantized types (elements per block)
const GGML_BLOCK_SIZE = {
  [GGMLType.Q4_0]: 32,
  [GGMLType.Q4_1]: 32,
  [GGMLType.Q5_0]: 32,
  [GGMLType.Q5_1]: 32,
  [GGMLType.Q8_0]: 32,
  [GGMLType.Q8_1]: 32,
  [GGMLType.Q2_K]: 256,
  [GGMLType.Q3_K]: 256,
  [GGMLType.Q4_K]: 256,
  [GGMLType.Q5_K]: 256,
  [GGMLType.Q6_K]: 256,
  [GGMLType.Q8_K]: 256,
};

// Bytes per block for quantized types
const GGML_TYPE_SIZE = {
  [GGMLType.F32]: 4,
  [GGMLType.F16]: 2,
  [GGMLType.Q4_0]: 18,    // 32 * 4 bits / 8 + 2 (scale)
  [GGMLType.Q4_1]: 20,    // 32 * 4 bits / 8 + 4 (scale + min)
  [GGMLType.Q5_0]: 22,    // 32 * 5 bits / 8 + 2
  [GGMLType.Q5_1]: 24,
  [GGMLType.Q8_0]: 34,    // 32 bytes + 2 (scale)
  [GGMLType.Q8_1]: 36,
  [GGMLType.Q2_K]: 84,
  [GGMLType.Q3_K]: 110,
  [GGMLType.Q4_K]: 144,   // Q4_K_M
  [GGMLType.Q5_K]: 176,
  [GGMLType.Q6_K]: 210,
  [GGMLType.Q8_K]: 292,
  [GGMLType.BF16]: 2,
  [GGMLType.I8]: 1,
  [GGMLType.I16]: 2,
  [GGMLType.I32]: 4,
  [GGMLType.I64]: 8,
  [GGMLType.F64]: 8,
};

/**
 * Reader class for parsing binary GGUF data
 */
class GGUFReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  readUint8() {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readInt8() {
    const val = this.view.getInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readUint16() {
    const val = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readInt16() {
    const val = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return val;
  }

  readUint32() {
    const val = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readInt32() {
    const val = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readUint64() {
    const low = this.view.getUint32(this.offset, true);
    const high = this.view.getUint32(this.offset + 4, true);
    this.offset += 8;
    // For values that fit in 53 bits (JS safe integer range)
    return high * 0x100000000 + low;
  }

  readInt64() {
    const low = this.view.getUint32(this.offset, true);
    const high = this.view.getInt32(this.offset + 4, true);
    this.offset += 8;
    return high * 0x100000000 + low;
  }

  readFloat32() {
    const val = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return val;
  }

  readFloat64() {
    const val = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return val;
  }

  readBool() {
    return this.readUint8() !== 0;
  }

  readString() {
    const length = this.readUint64();
    if (length > 1024 * 1024) {
      throw new Error(`String too long: ${length}`);
    }
    const bytes = new Uint8Array(this.buffer, this.offset, length);
    this.offset += length;
    return new TextDecoder().decode(bytes);
  }

  readValue(type) {
    switch (type) {
      case GGUFValueType.UINT8:
        return this.readUint8();
      case GGUFValueType.INT8:
        return this.readInt8();
      case GGUFValueType.UINT16:
        return this.readUint16();
      case GGUFValueType.INT16:
        return this.readInt16();
      case GGUFValueType.UINT32:
        return this.readUint32();
      case GGUFValueType.INT32:
        return this.readInt32();
      case GGUFValueType.UINT64:
        return this.readUint64();
      case GGUFValueType.INT64:
        return this.readInt64();
      case GGUFValueType.FLOAT32:
        return this.readFloat32();
      case GGUFValueType.FLOAT64:
        return this.readFloat64();
      case GGUFValueType.BOOL:
        return this.readBool();
      case GGUFValueType.STRING:
        return this.readString();
      case GGUFValueType.ARRAY:
        return this.readArray();
      default:
        throw new Error(`Unknown value type: ${type}`);
    }
  }

  readArray() {
    const elementType = this.readUint32();
    const length = this.readUint64();
    if (length > 10000000) {
      throw new Error(`Array too long: ${length}`);
    }
    const arr = [];
    for (let i = 0; i < length; i++) {
      arr.push(this.readValue(elementType));
    }
    return arr;
  }

  // Align to specified boundary
  align(boundary) {
    const remainder = this.offset % boundary;
    if (remainder !== 0) {
      this.offset += boundary - remainder;
    }
  }
}

/**
 * Calculate tensor size in bytes
 * @param {number[]} shape - Tensor dimensions
 * @param {number} type - GGML type
 * @returns {number} Size in bytes
 */
function calculateTensorSize(shape, type) {
  const numElements = shape.reduce((a, b) => a * b, 1);

  if (type === GGMLType.F32) return numElements * 4;
  if (type === GGMLType.F16 || type === GGMLType.BF16) return numElements * 2;
  if (type === GGMLType.I8) return numElements;
  if (type === GGMLType.I16) return numElements * 2;
  if (type === GGMLType.I32) return numElements * 4;
  if (type === GGMLType.I64) return numElements * 8;
  if (type === GGMLType.F64) return numElements * 8;

  // Quantized types
  const blockSize = GGML_BLOCK_SIZE[type];
  const typeSize = GGML_TYPE_SIZE[type];
  if (blockSize && typeSize) {
    const numBlocks = Math.ceil(numElements / blockSize);
    return numBlocks * typeSize;
  }

  throw new Error(`Unknown tensor type: ${type}`);
}

/**
 * Parse GGUF file buffer
 * @param {ArrayBuffer} buffer - GGUF file contents
 * @returns {Object} Parsed model info
 */
export function parseGGUF(buffer) {
  const reader = new GGUFReader(buffer);

  // Read header
  const magic = reader.readUint32();
  if (magic !== GGUF_MAGIC) {
    throw new Error(`Invalid GGUF magic: 0x${magic.toString(16)} (expected 0x${GGUF_MAGIC.toString(16)})`);
  }

  const version = reader.readUint32();
  if (version < GGUF_VERSION_MIN || version > GGUF_VERSION_MAX) {
    throw new Error(`Unsupported GGUF version: ${version}`);
  }

  const tensorCount = reader.readUint64();
  const metadataKVCount = reader.readUint64();

  // Read metadata
  const metadata = {};
  for (let i = 0; i < metadataKVCount; i++) {
    const key = reader.readString();
    const valueType = reader.readUint32();
    const value = reader.readValue(valueType);
    metadata[key] = value;
  }

  // Extract architecture info
  const architecture = metadata['general.architecture'] || 'unknown';
  const modelName = metadata['general.name'] || 'unknown';

  // Extract model config based on architecture
  const config = extractModelConfig(metadata, architecture);

  // Read tensor info
  const tensors = [];
  for (let i = 0; i < tensorCount; i++) {
    const name = reader.readString();
    const nDims = reader.readUint32();
    const shape = [];
    for (let d = 0; d < nDims; d++) {
      shape.push(reader.readUint64());
    }
    const type = reader.readUint32();
    const offset = reader.readUint64();

    tensors.push({
      name,
      shape,
      dtype: GGMLTypeName[type] || `unknown_${type}`,
      dtypeId: type,
      offset,
      size: calculateTensorSize(shape, type),
    });
  }

  // Align to get tensor data offset
  reader.align(32);
  const tensorDataOffset = reader.offset;

  // Update tensor offsets to be absolute
  for (const tensor of tensors) {
    tensor.offset += tensorDataOffset;
  }

  // Determine primary quantization type
  const quantization = detectQuantization(tensors);

  return {
    version,
    architecture,
    modelName,
    metadata,
    config,
    tensors,
    quantization,
    tensorDataOffset,
    fileSize: buffer.byteLength,
  };
}

/**
 * Extract model configuration from metadata
 */
function extractModelConfig(metadata, architecture) {
  const prefix = `${architecture}.`;

  const config = {
    architecture,
    vocabSize: metadata[`${prefix}vocab_size`] || metadata['tokenizer.ggml.vocab_size'],
    contextLength: metadata[`${prefix}context_length`] || 2048,
    embeddingLength: metadata[`${prefix}embedding_length`],
    blockCount: metadata[`${prefix}block_count`],
    feedForwardLength: metadata[`${prefix}feed_forward_length`],
    attentionHeadCount: metadata[`${prefix}attention.head_count`],
    attentionHeadCountKV: metadata[`${prefix}attention.head_count_kv`],
    attentionLayerNormEpsilon: metadata[`${prefix}attention.layer_norm_epsilon`] || 1e-5,
    attentionLayerNormRMSEpsilon: metadata[`${prefix}attention.layer_norm_rms_epsilon`] || 1e-5,
    ropeFreqBase: metadata[`${prefix}rope.freq_base`] || 10000,
    ropeScalingType: metadata[`${prefix}rope.scaling.type`],
    ropeScalingFactor: metadata[`${prefix}rope.scaling.factor`],
  };

  // MoE specific
  if (metadata[`${prefix}expert_count`]) {
    config.expertCount = metadata[`${prefix}expert_count`];
    config.expertUsedCount = metadata[`${prefix}expert_used_count`];
  }

  // Tokenizer info
  config.tokenizer = {
    model: metadata['tokenizer.ggml.model'],
    bosTokenId: metadata['tokenizer.ggml.bos_token_id'],
    eosTokenId: metadata['tokenizer.ggml.eos_token_id'],
    padTokenId: metadata['tokenizer.ggml.padding_token_id'],
    addBosToken: metadata['tokenizer.ggml.add_bos_token'],
    addEosToken: metadata['tokenizer.ggml.add_eos_token'],
  };

  return config;
}

/**
 * Detect primary quantization type from tensors
 */
function detectQuantization(tensors) {
  // Count tensor types (weighted by size for accuracy)
  const typeCounts = {};
  let totalSize = 0;

  for (const tensor of tensors) {
    // Skip embedding and output layers for quant detection
    if (tensor.name.includes('embed') || tensor.name.includes('output')) {
      continue;
    }
    const dtype = tensor.dtype;
    typeCounts[dtype] = (typeCounts[dtype] || 0) + tensor.size;
    totalSize += tensor.size;
  }

  // Find dominant type
  let dominantType = 'F16';
  let maxSize = 0;
  for (const [dtype, size] of Object.entries(typeCounts)) {
    if (size > maxSize) {
      maxSize = size;
      dominantType = dtype;
    }
  }

  return dominantType;
}

/**
 * Parse GGUF file from path (Node.js)
 * @param {string} filePath - Path to GGUF file
 * @returns {Promise<Object>} Parsed model info
 */
export async function parseGGUFFile(filePath) {
  const buffer = await readFile(filePath);
  return parseGGUF(buffer.buffer);
}

/**
 * Get tensor by name
 * @param {Object} parsed - Parsed GGUF result
 * @param {string} name - Tensor name
 * @returns {Object|null} Tensor info
 */
export function getTensor(parsed, name) {
  return parsed.tensors.find((t) => t.name === name) || null;
}

/**
 * Get all tensors matching pattern
 * @param {Object} parsed - Parsed GGUF result
 * @param {RegExp} pattern - Pattern to match
 * @returns {Object[]} Matching tensors
 */
export function getTensors(parsed, pattern) {
  return parsed.tensors.filter((t) => pattern.test(t.name));
}

/**
 * Group tensors by layer
 * @param {Object} parsed - Parsed GGUF result
 * @returns {Map<number, Object[]>} Layer index to tensors
 */
export function groupTensorsByLayer(parsed) {
  const layers = new Map();

  for (const tensor of parsed.tensors) {
    // Match patterns like "blk.0.attn_q.weight" or "layers.0.attention.wq.weight"
    const match = tensor.name.match(/(?:blk|layers?)\.(\d+)\./);
    if (match) {
      const layerIdx = parseInt(match[1], 10);
      if (!layers.has(layerIdx)) {
        layers.set(layerIdx, []);
      }
      layers.get(layerIdx).push(tensor);
    }
  }

  return layers;
}

/**
 * Identify MoE expert tensors
 * @param {Object} parsed - Parsed GGUF result
 * @returns {Map<number, Map<number, Object[]>>} Layer -> Expert -> Tensors
 */
export function identifyMoETensors(parsed) {
  const moe = new Map();

  for (const tensor of parsed.tensors) {
    // Match patterns like "blk.0.ffn_gate_exps.0.weight"
    const match = tensor.name.match(/(?:blk|layers?)\.(\d+)\..*(?:expert|exp)s?\.(\d+)\./);
    if (match) {
      const layerIdx = parseInt(match[1], 10);
      const expertIdx = parseInt(match[2], 10);

      if (!moe.has(layerIdx)) {
        moe.set(layerIdx, new Map());
      }
      if (!moe.get(layerIdx).has(expertIdx)) {
        moe.get(layerIdx).set(expertIdx, []);
      }
      moe.get(layerIdx).get(expertIdx).push(tensor);
    }
  }

  return moe;
}

// Export types for external use
export { GGMLType, GGMLTypeName, GGML_BLOCK_SIZE, GGML_TYPE_SIZE };
