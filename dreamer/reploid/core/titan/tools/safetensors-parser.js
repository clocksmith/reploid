/**
 * safetensors-parser.js - Safetensors Format Parser
 *
 * Parses Hugging Face safetensors files to extract:
 * - Tensor metadata from header
 * - Tensor data locations (for sharded models via index.json)
 *
 * Safetensors format:
 * - 8-byte header size (u64 little-endian)
 * - JSON header with tensor metadata
 * - Tensor data (aligned)
 *
 * @module tools/safetensors-parser
 */

import { readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';

// Safetensors dtype to byte size
const DTYPE_SIZE = {
  F64: 8,
  F32: 4,
  F16: 2,
  BF16: 2,
  I64: 8,
  I32: 4,
  I16: 2,
  I8: 1,
  U8: 1,
  BOOL: 1,
};

// Map safetensors dtype to our internal names
const DTYPE_MAP = {
  F64: 'F64',
  F32: 'F32',
  F16: 'F16',
  BF16: 'BF16',
  I64: 'I64',
  I32: 'I32',
  I16: 'I16',
  I8: 'I8',
  U8: 'U8',
  BOOL: 'BOOL',
};

/**
 * Parse safetensors header from buffer
 * @param {ArrayBuffer} buffer - File buffer (at least header portion)
 * @returns {Object} Header info with tensors and metadata
 */
export function parseSafetensorsHeader(buffer) {
  const view = new DataView(buffer);

  // Read header size (8 bytes, little-endian u64)
  const headerSizeLow = view.getUint32(0, true);
  const headerSizeHigh = view.getUint32(4, true);
  const headerSize = headerSizeHigh * 0x100000000 + headerSizeLow;

  if (headerSize > 100 * 1024 * 1024) {
    throw new Error(`Header too large: ${headerSize} bytes`);
  }

  // Read JSON header
  const headerBytes = new Uint8Array(buffer, 8, headerSize);
  const headerJson = new TextDecoder().decode(headerBytes);
  const header = JSON.parse(headerJson);

  // Data starts after header
  const dataOffset = 8 + headerSize;

  // Extract metadata (special __metadata__ key)
  const metadata = header.__metadata__ || {};
  delete header.__metadata__;

  // Parse tensor info
  const tensors = [];
  for (const [name, info] of Object.entries(header)) {
    const { dtype, shape, data_offsets } = info;
    const [startOffset, endOffset] = data_offsets;

    tensors.push({
      name,
      shape,
      dtype: DTYPE_MAP[dtype] || dtype,
      dtypeOriginal: dtype,
      offset: dataOffset + startOffset,
      size: endOffset - startOffset,
      elemSize: DTYPE_SIZE[dtype] || 4,
    });
  }

  // Sort by offset for sequential reading
  tensors.sort((a, b) => a.offset - b.offset);

  return {
    headerSize,
    dataOffset,
    metadata,
    tensors,
  };
}

/**
 * Parse a single safetensors file
 * @param {string} filePath - Path to .safetensors file
 * @returns {Promise<Object>} Parsed file info
 */
export async function parseSafetensorsFile(filePath) {
  const buffer = await readFile(filePath);
  const parsed = parseSafetensorsHeader(buffer.buffer);

  const stats = await stat(filePath);
  parsed.filePath = filePath;
  parsed.fileSize = stats.size;

  return parsed;
}

/**
 * Parse sharded safetensors model via model.safetensors.index.json
 * @param {string} indexPath - Path to index.json file
 * @returns {Promise<Object>} Combined model info
 */
export async function parseSafetensorsIndex(indexPath) {
  const indexBuffer = await readFile(indexPath, 'utf8');
  const index = JSON.parse(indexBuffer);

  const { metadata, weight_map } = index;
  const modelDir = dirname(indexPath);

  // Group tensors by shard file
  const shardToTensors = new Map();
  for (const [tensorName, shardFile] of Object.entries(weight_map)) {
    if (!shardToTensors.has(shardFile)) {
      shardToTensors.set(shardFile, []);
    }
    shardToTensors.get(shardFile).push(tensorName);
  }

  // Parse each shard file
  const shards = [];
  const allTensors = [];
  const shardParsed = new Map();

  for (const shardFile of shardToTensors.keys()) {
    const shardPath = join(modelDir, shardFile);
    const parsed = await parseSafetensorsFile(shardPath);
    shardParsed.set(shardFile, parsed);

    shards.push({
      file: shardFile,
      path: shardPath,
      size: parsed.fileSize,
      tensorCount: parsed.tensors.length,
    });

    // Add shard info to tensors
    for (const tensor of parsed.tensors) {
      tensor.shardFile = shardFile;
      tensor.shardPath = shardPath;
      allTensors.push(tensor);
    }
  }

  // Extract model config from metadata
  const config = extractConfigFromMetadata(metadata);

  return {
    indexPath,
    modelDir,
    metadata,
    config,
    shards,
    tensors: allTensors,
    shardParsed,
  };
}

/**
 * Extract model configuration from safetensors metadata
 */
function extractConfigFromMetadata(metadata) {
  // Safetensors metadata is often minimal; config usually in separate config.json
  const config = {
    format: metadata.format || 'pt',  // pytorch format
  };

  // Try to parse any JSON strings in metadata
  for (const [key, value] of Object.entries(metadata || {})) {
    if (typeof value === 'string') {
      try {
        config[key] = JSON.parse(value);
      } catch {
        config[key] = value;
      }
    } else {
      config[key] = value;
    }
  }

  return config;
}

/**
 * Load config.json from model directory
 * @param {string} modelDir - Model directory path
 * @returns {Promise<Object|null>} Model config or null
 */
export async function loadModelConfig(modelDir) {
  try {
    const configPath = join(modelDir, 'config.json');
    const configBuffer = await readFile(configPath, 'utf8');
    return JSON.parse(configBuffer);
  } catch {
    return null;
  }
}

/**
 * Load tokenizer_config.json from model directory
 * @param {string} modelDir - Model directory path
 * @returns {Promise<Object|null>} Tokenizer config or null
 */
export async function loadTokenizerConfig(modelDir) {
  try {
    const configPath = join(modelDir, 'tokenizer_config.json');
    const configBuffer = await readFile(configPath, 'utf8');
    return JSON.parse(configBuffer);
  } catch {
    return null;
  }
}

/**
 * Detect if directory contains a sharded model
 * @param {string} modelDir - Model directory path
 * @returns {Promise<{sharded: boolean, indexPath?: string, singlePath?: string}>}
 */
export async function detectModelFormat(modelDir) {
  const indexPath = join(modelDir, 'model.safetensors.index.json');
  const singlePath = join(modelDir, 'model.safetensors');

  try {
    await stat(indexPath);
    return { sharded: true, indexPath };
  } catch {
    // Not sharded
  }

  try {
    await stat(singlePath);
    return { sharded: false, singlePath };
  } catch {
    // No model.safetensors, might be named differently
  }

  // Look for any .safetensors file
  const { readdir } = await import('fs/promises');
  const files = await readdir(modelDir);
  const safetensorFiles = files.filter((f) => f.endsWith('.safetensors'));

  if (safetensorFiles.length === 1) {
    return { sharded: false, singlePath: join(modelDir, safetensorFiles[0]) };
  } else if (safetensorFiles.length > 1) {
    // Multiple files without index - unusual but handle it
    return { sharded: true, files: safetensorFiles.map((f) => join(modelDir, f)) };
  }

  throw new Error(`No safetensors files found in ${modelDir}`);
}

/**
 * Parse any safetensors model (sharded or single)
 * @param {string} pathOrDir - Path to file, index, or directory
 * @returns {Promise<Object>} Parsed model info
 */
export async function parseSafetensors(pathOrDir) {
  const stats = await stat(pathOrDir);

  if (stats.isDirectory()) {
    const format = await detectModelFormat(pathOrDir);
    if (format.sharded && format.indexPath) {
      const parsed = await parseSafetensorsIndex(format.indexPath);
      parsed.config = {
        ...parsed.config,
        ...(await loadModelConfig(pathOrDir)),
      };
      parsed.tokenizerConfig = await loadTokenizerConfig(pathOrDir);
      return parsed;
    } else if (format.singlePath) {
      const parsed = await parseSafetensorsFile(format.singlePath);
      parsed.config = await loadModelConfig(pathOrDir);
      parsed.tokenizerConfig = await loadTokenizerConfig(pathOrDir);
      return parsed;
    }
  }

  // Direct file path
  if (pathOrDir.endsWith('.json')) {
    return parseSafetensorsIndex(pathOrDir);
  }

  return parseSafetensorsFile(pathOrDir);
}

/**
 * Get tensor by name
 * @param {Object} parsed - Parsed model info
 * @param {string} name - Tensor name
 * @returns {Object|null} Tensor info
 */
export function getTensor(parsed, name) {
  return parsed.tensors.find((t) => t.name === name) || null;
}

/**
 * Get all tensors matching pattern
 * @param {Object} parsed - Parsed model info
 * @param {RegExp} pattern - Pattern to match
 * @returns {Object[]} Matching tensors
 */
export function getTensors(parsed, pattern) {
  return parsed.tensors.filter((t) => pattern.test(t.name));
}

/**
 * Read tensor data from file
 * @param {Object} tensor - Tensor info from parsed result
 * @param {ArrayBuffer} [buffer] - Optional pre-loaded buffer
 * @returns {Promise<ArrayBuffer>} Tensor data
 */
export async function readTensorData(tensor, buffer) {
  if (buffer) {
    return buffer.slice(tensor.offset, tensor.offset + tensor.size);
  }

  // Read from file
  const filePath = tensor.shardPath || tensor.filePath;
  if (!filePath) {
    throw new Error('No file path for tensor');
  }

  const { open } = await import('fs/promises');
  const file = await open(filePath, 'r');
  try {
    const data = Buffer.alloc(tensor.size);
    await file.read(data, 0, tensor.size, tensor.offset);
    return data.buffer;
  } finally {
    await file.close();
  }
}

/**
 * Group tensors by layer (HuggingFace naming convention)
 * @param {Object} parsed - Parsed model info
 * @returns {Map<number, Object[]>} Layer index to tensors
 */
export function groupTensorsByLayer(parsed) {
  const layers = new Map();

  for (const tensor of parsed.tensors) {
    // Match patterns like "model.layers.0.self_attn.q_proj.weight"
    const match = tensor.name.match(/layers?\.(\d+)\./);
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
 * Calculate total model size
 * @param {Object} parsed - Parsed model info
 * @returns {number} Total size in bytes
 */
export function calculateTotalSize(parsed) {
  return parsed.tensors.reduce((sum, t) => sum + t.size, 0);
}

// Export dtype info
export { DTYPE_SIZE, DTYPE_MAP };
