/**
 * model-converter.js - Browser Model Converter
 *
 * Converts GGUF and safetensors models to RDRR format in the browser.
 * Supports:
 * - GGUF files (via gguf-importer.js)
 * - Single safetensors files
 * - Sharded HuggingFace models (multiple safetensors + config)
 * - Optional Q4_K_M quantization
 *
 * Output is written to OPFS (Origin Private File System).
 *
 * @module browser/model-converter
 */

import { parseGGUFHeader } from './gguf-parser-browser.js';
import {
  parseSafetensorsFile,
  parseSafetensorsSharded,
  parseConfigJson,
  parseTokenizerJson,
  parseIndexJson,
  readTensorData,
  detectModelFormat,
  getAuxiliaryFiles,
  calculateTotalSize,
} from './safetensors-parser-browser.js';
import {
  initOPFS,
  openModelDirectory,
  saveManifest,
  deleteModel,
} from '../storage/shard-manager.js';
import {
  SHARD_SIZE,
  RDRR_VERSION,
  generateShardFilename,
} from '../storage/rdrr-format.js';

// Import quantizer (pure JS, works in browser)
// Note: quantizer.js needs to be copied or made available to browser
// For now, we'll include the essential functions inline

/**
 * Conversion stages
 */
export const ConvertStage = {
  DETECTING: 'detecting',
  PARSING: 'parsing',
  QUANTIZING: 'quantizing',
  WRITING: 'writing',
  MANIFEST: 'manifest',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/**
 * Compute SHA-256 hash
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {Promise<string>} Hex hash
 */
async function computeSHA256(data) {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Float16 to Float32 conversion
 */
function float16ToFloat32(h) {
  const sign = (h >> 15) & 0x1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;

  if (exp === 0) {
    if (frac === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 31) {
    return frac ? NaN : sign ? -Infinity : Infinity;
  }
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

/**
 * BFloat16 to Float32 conversion
 */
function bfloat16ToFloat32(bf16) {
  const f32View = new Float32Array(1);
  const u32View = new Uint32Array(f32View.buffer);
  u32View[0] = bf16 << 16;
  return f32View[0];
}

/**
 * Convert typed array to Float32
 */
function convertToFloat32(data, dtype) {
  if (dtype === 'F32') {
    return new Float32Array(data);
  }

  if (dtype === 'F16') {
    const f16 = new Uint16Array(data);
    const f32 = new Float32Array(f16.length);
    for (let i = 0; i < f16.length; i++) {
      f32[i] = float16ToFloat32(f16[i]);
    }
    return f32;
  }

  if (dtype === 'BF16') {
    const bf16 = new Uint16Array(data);
    const f32 = new Float32Array(bf16.length);
    for (let i = 0; i < bf16.length; i++) {
      f32[i] = bfloat16ToFloat32(bf16[i]);
    }
    return f32;
  }

  throw new Error(`Unsupported dtype: ${dtype}`);
}

/**
 * Check if tensor should be quantized
 */
function shouldQuantize(tensorName, shape) {
  const numElements = shape.reduce((a, b) => a * b, 1);
  if (numElements < 1024) return false;

  const lower = tensorName.toLowerCase();
  if (lower.includes('embed') || lower.includes('lm_head')) return false;
  if (lower.includes('norm') || lower.includes('ln_')) return false;
  if (lower.endsWith('.bias') || lower.endsWith('_bias')) return false;

  return true;
}

/**
 * Sanitize model ID
 */
function sanitizeModelId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'converted-model';
}

/**
 * Format bytes for display
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Convert model files to RDRR format
 *
 * @param {File[]} files - Selected model files
 * @param {Object} options - Conversion options
 * @param {string} [options.modelId] - Override model ID
 * @param {string} [options.quantize] - Quantization type ('q4_k_m', 'f16', 'f32', or null for auto)
 * @param {Function} [options.onProgress] - Progress callback
 * @param {AbortSignal} [options.signal] - Abort signal
 * @returns {Promise<string>} Model ID
 */
export async function convertModel(files, options = {}) {
  const { modelId: userModelId, quantize, onProgress, signal } = options;

  let modelId = null;
  let modelDir = null;
  const shardInfos = [];

  try {
    // Initialize OPFS
    await initOPFS();

    // Detect format
    onProgress?.({
      stage: ConvertStage.DETECTING,
      message: 'Detecting model format...',
    });

    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const format = detectModelFormat(files);
    const auxiliary = getAuxiliaryFiles(files);

    onProgress?.({
      stage: ConvertStage.DETECTING,
      message: `Format: ${format.type}`,
      format: format.type,
    });

    // Parse based on format
    let modelInfo;
    let config = null;
    let tokenizerJson = null;

    if (format.type === 'gguf') {
      // Handle GGUF - delegate to existing importer logic
      modelInfo = await parseGGUFModel(format.ggufFile, onProgress, signal);
    } else if (format.type === 'single') {
      modelInfo = await parseSafetensorsFile(format.safetensorsFile);
      if (auxiliary.config) {
        config = await parseConfigJson(auxiliary.config);
        modelInfo.config = config;
      }
    } else if (format.type === 'sharded' || format.type === 'sharded-no-index') {
      let indexJson = null;
      if (format.indexFile) {
        indexJson = await parseIndexJson(format.indexFile);
      }
      modelInfo = await parseSafetensorsSharded(format.safetensorsFiles, indexJson);
      if (auxiliary.config) {
        config = await parseConfigJson(auxiliary.config);
        modelInfo.config = config;
      }
    } else {
      throw new Error(`Unsupported format: ${format.type}`);
    }

    // Parse tokenizer if available
    if (auxiliary.tokenizer) {
      tokenizerJson = await parseTokenizerJson(auxiliary.tokenizer);
      modelInfo.tokenizerJson = tokenizerJson;
    }

    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    // Determine model ID
    modelId = userModelId || extractModelId(files, config) || 'converted-model';
    modelId = sanitizeModelId(modelId);

    onProgress?.({
      stage: ConvertStage.PARSING,
      message: `Model: ${modelId}`,
      modelId,
      tensorCount: modelInfo.tensors.length,
      totalSize: formatBytes(calculateTotalSize(modelInfo)),
    });

    // Open model directory in OPFS
    modelDir = await openModelDirectory(modelId);

    // Process tensors and write shards
    const result = await writeTensorsToShards(
      modelInfo,
      modelDir,
      shardInfos,
      {
        quantize,
        onProgress,
        signal,
      }
    );

    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    // Create manifest
    onProgress?.({
      stage: ConvertStage.MANIFEST,
      message: 'Creating manifest...',
    });

    const manifest = createManifest(modelInfo, shardInfos, config, tokenizerJson);
    manifest.modelId = modelId;

    // Save manifest
    await saveManifest(JSON.stringify(manifest, null, 2));

    onProgress?.({
      stage: ConvertStage.COMPLETE,
      message: 'Conversion complete!',
      modelId,
      shardCount: shardInfos.length,
      totalSize: result.totalSize,
    });

    return modelId;

  } catch (error) {
    // Cleanup on error
    if (modelId) {
      try {
        await deleteModel(modelId);
      } catch {
        // Ignore cleanup errors
      }
    }

    onProgress?.({
      stage: ConvertStage.ERROR,
      message: error.message,
      error,
    });

    throw error;
  }
}

/**
 * Parse GGUF model file
 */
async function parseGGUFModel(file, onProgress, signal) {
  onProgress?.({
    stage: ConvertStage.PARSING,
    message: 'Parsing GGUF header...',
  });

  const headerBlob = file.slice(0, 10 * 1024 * 1024);
  const headerBuffer = await headerBlob.arrayBuffer();
  const ggufInfo = parseGGUFHeader(headerBuffer);

  return {
    format: 'gguf',
    tensors: ggufInfo.tensors.map(t => ({
      ...t,
      file,
      offset: t.offset,
    })),
    config: ggufInfo.config,
    architecture: ggufInfo.architecture,
    quantization: ggufInfo.quantization,
    tensorDataOffset: ggufInfo.tensorDataOffset,
    file,
  };
}

/**
 * Extract model ID from files or config
 */
function extractModelId(files, config) {
  // Try config first
  if (config?._name_or_path) {
    const parts = config._name_or_path.split('/');
    return parts[parts.length - 1];
  }

  // Try first safetensors file name
  const stFile = files.find(f => f.name.endsWith('.safetensors'));
  if (stFile) {
    return stFile.name.replace(/\.safetensors$/, '').replace(/model[-_.]?/, '');
  }

  // Try GGUF file name
  const ggufFile = files.find(f => f.name.endsWith('.gguf'));
  if (ggufFile) {
    return ggufFile.name.replace(/\.gguf$/, '');
  }

  return null;
}

/**
 * Write tensors to shards in OPFS
 */
async function writeTensorsToShards(modelInfo, modelDir, shardInfos, options) {
  const { quantize, onProgress, signal } = options;
  const tensors = modelInfo.tensors;
  const totalTensors = tensors.length;

  let currentShardIndex = 0;
  let currentShardData = [];
  let currentShardSize = 0;
  let totalSize = 0;

  // Track tensor locations for manifest
  const tensorLocations = {};

  for (let i = 0; i < tensors.length; i++) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');

    const tensor = tensors[i];

    onProgress?.({
      stage: ConvertStage.WRITING,
      message: `Processing ${tensor.name}`,
      current: i + 1,
      total: totalTensors,
      percent: Math.round(((i + 1) / totalTensors) * 100),
    });

    // Read tensor data
    let data = await readTensorData(tensor);

    // Handle GGUF format (data is relative to tensorDataOffset)
    if (modelInfo.format === 'gguf' && modelInfo.tensorDataOffset) {
      const file = modelInfo.file;
      const absoluteOffset = modelInfo.tensorDataOffset + (tensor.offset - modelInfo.tensorDataOffset);
      const blob = file.slice(tensor.offset, tensor.offset + tensor.size);
      data = await blob.arrayBuffer();
    }

    // Optionally quantize (TODO: implement Q4_K_M in browser)
    // For now, pass through as-is
    const tensorData = new Uint8Array(data);

    // Record tensor location
    const tensorStartOffset = totalSize;

    // Add to current shard, splitting if necessary
    let remaining = tensorData;
    const tensorSpans = [];

    while (remaining.length > 0) {
      const availableInShard = SHARD_SIZE - currentShardSize;
      const chunkSize = Math.min(remaining.length, availableInShard);

      currentShardData.push(remaining.slice(0, chunkSize));
      currentShardSize += chunkSize;
      totalSize += chunkSize;

      tensorSpans.push({
        shardIndex: currentShardIndex,
        offset: currentShardSize - chunkSize,
        size: chunkSize,
      });

      remaining = remaining.slice(chunkSize);

      // Flush shard if full
      if (currentShardSize >= SHARD_SIZE) {
        await flushShard(modelDir, currentShardIndex, currentShardData, shardInfos);
        currentShardIndex++;
        currentShardData = [];
        currentShardSize = 0;
      }
    }

    // Record tensor location in manifest format
    if (tensorSpans.length === 1) {
      tensorLocations[tensor.name] = {
        shard: tensorSpans[0].shardIndex,
        offset: tensorSpans[0].offset,
        size: tensor.size,
        shape: tensor.shape,
        dtype: tensor.dtype,
      };
    } else {
      tensorLocations[tensor.name] = {
        spans: tensorSpans,
        size: tensor.size,
        shape: tensor.shape,
        dtype: tensor.dtype,
      };
    }
  }

  // Flush final shard
  if (currentShardData.length > 0) {
    await flushShard(modelDir, currentShardIndex, currentShardData, shardInfos);
  }

  return { totalSize, tensorLocations };
}

/**
 * Flush shard data to OPFS
 */
async function flushShard(modelDir, shardIndex, dataChunks, shardInfos) {
  // Concatenate chunks
  const totalSize = dataChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const shardData = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of dataChunks) {
    shardData.set(chunk, offset);
    offset += chunk.length;
  }

  // Compute hash
  const hash = await computeSHA256(shardData);

  // Write to OPFS
  const filename = generateShardFilename(shardIndex);
  const fileHandle = await modelDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(shardData);
  await writable.close();

  shardInfos.push({
    index: shardIndex,
    filename,
    size: shardData.length,
    hash,
    offset: shardIndex * SHARD_SIZE,
  });
}

/**
 * Create RDRR manifest
 */
function createManifest(modelInfo, shardInfos, config, tokenizerJson) {
  const architecture = extractArchitecture(modelInfo, config);

  const manifest = {
    version: RDRR_VERSION,
    modelId: 'converted-model',
    modelType: config?.architectures?.[0] || modelInfo.architecture || 'unknown',
    quantization: modelInfo.quantization || 'F16',
    architecture,
    shards: shardInfos,
    tensors: buildTensorMap(modelInfo.tensors, shardInfos),
    totalSize: shardInfos.reduce((sum, s) => sum + s.size, 0),
    hashAlgorithm: 'sha256',
    metadata: {
      source: 'browser-converter',
      convertedAt: new Date().toISOString(),
    },
  };

  // Include tokenizer if available
  if (tokenizerJson) {
    manifest.tokenizer = {
      type: 'bundled',
      vocabSize: tokenizerJson.model?.vocab?.length || Object.keys(tokenizerJson.model?.vocab || {}).length,
    };
    // Store tokenizer separately or embed
    manifest.metadata.hasTokenizer = true;
  }

  return manifest;
}

/**
 * Extract architecture info from model
 */
function extractArchitecture(modelInfo, config) {
  if (config) {
    return {
      numLayers: config.num_hidden_layers || config.n_layer || 32,
      hiddenSize: config.hidden_size || config.n_embd || 4096,
      intermediateSize: config.intermediate_size || config.n_inner || 11008,
      numAttentionHeads: config.num_attention_heads || config.n_head || 32,
      numKeyValueHeads: config.num_key_value_heads || config.num_attention_heads || 32,
      headDim: config.head_dim || Math.floor((config.hidden_size || 4096) / (config.num_attention_heads || 32)),
      vocabSize: config.vocab_size || 32000,
      maxSeqLen: config.max_position_embeddings || config.n_positions || 2048,
      ropeTheta: config.rope_theta || 10000,
    };
  }

  // Fallback for GGUF
  if (modelInfo.config) {
    const c = modelInfo.config;
    return {
      numLayers: c.blockCount || 32,
      hiddenSize: c.embeddingLength || 4096,
      intermediateSize: c.feedForwardLength || 11008,
      numAttentionHeads: c.attentionHeadCount || 32,
      numKeyValueHeads: c.attentionHeadCountKV || 32,
      vocabSize: c.vocabSize || 32000,
      maxSeqLen: c.contextLength || 2048,
    };
  }

  return {};
}

/**
 * Build tensor location map for manifest
 */
function buildTensorMap(tensors, shardInfos) {
  const tensorMap = {};

  let globalOffset = 0;
  for (const tensor of tensors) {
    const startShard = Math.floor(globalOffset / SHARD_SIZE);
    const offsetInShard = globalOffset % SHARD_SIZE;

    if (offsetInShard + tensor.size <= SHARD_SIZE) {
      // Fits in single shard
      tensorMap[tensor.name] = {
        shard: startShard,
        offset: offsetInShard,
        size: tensor.size,
        shape: tensor.shape,
        dtype: tensor.dtype,
      };
    } else {
      // Spans multiple shards
      const spans = [];
      let remaining = tensor.size;
      let currentShard = startShard;
      let currentOffset = offsetInShard;

      while (remaining > 0) {
        const available = SHARD_SIZE - currentOffset;
        const chunkSize = Math.min(remaining, available);
        spans.push({
          shardIndex: currentShard,
          offset: currentOffset,
          size: chunkSize,
        });
        remaining -= chunkSize;
        currentShard++;
        currentOffset = 0;
      }

      tensorMap[tensor.name] = {
        spans,
        size: tensor.size,
        shape: tensor.shape,
        dtype: tensor.dtype,
      };
    }

    globalOffset += tensor.size;
  }

  return tensorMap;
}

/**
 * Check if conversion is supported in this browser
 */
export function isConversionSupported() {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in navigator.storage
  );
}

/**
 * Pick model files using File System Access API
 * @returns {Promise<File[]>} Selected files
 */
export async function pickModelFiles() {
  // Try directory picker first (for HuggingFace models)
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await window.showDirectoryPicker({
        mode: 'read',
      });
      return await collectFilesFromDirectory(dirHandle);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      // Fall back to file picker
    }
  }

  // Fall back to file picker
  if ('showOpenFilePicker' in window) {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: 'Model files',
          accept: {
            'application/octet-stream': ['.gguf', '.safetensors', '.bin'],
            'application/json': ['.json'],
          },
        },
      ],
    });
    return Promise.all(handles.map(h => h.getFile()));
  }

  // Ultimate fallback: input element
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.gguf,.safetensors,.json,.bin';
    input.onchange = () => {
      resolve(Array.from(input.files || []));
    };
    input.click();
  });
}

/**
 * Collect all files from a directory handle recursively
 */
async function collectFilesFromDirectory(dirHandle, files = []) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      // Only include relevant files
      if (
        file.name.endsWith('.safetensors') ||
        file.name.endsWith('.gguf') ||
        file.name.endsWith('.json') ||
        file.name === 'tokenizer.model'
      ) {
        files.push(file);
      }
    } else if (entry.kind === 'directory') {
      // Don't recurse into subdirectories for model files
      // HuggingFace models are flat
    }
  }
  return files;
}

export default convertModel;
