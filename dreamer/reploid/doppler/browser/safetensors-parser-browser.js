/**
 * safetensors-parser-browser.js - Browser Safetensors Parser
 *
 * Parses Hugging Face safetensors files in the browser using File API.
 * Supports both single files and sharded models (multiple files + index).
 *
 * @module browser/safetensors-parser-browser
 */

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

// Map safetensors dtype to internal names
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
 * Parse safetensors header from File object
 * @param {File} file - Safetensors file
 * @returns {Promise<Object>} Header info with tensors and metadata
 */
export async function parseSafetensorsFile(file) {
  // Read first 8 bytes to get header size
  const headerSizeBlob = file.slice(0, 8);
  const headerSizeBuffer = await headerSizeBlob.arrayBuffer();
  const headerSizeView = new DataView(headerSizeBuffer);

  const headerSizeLow = headerSizeView.getUint32(0, true);
  const headerSizeHigh = headerSizeView.getUint32(4, true);
  const headerSize = headerSizeHigh * 0x100000000 + headerSizeLow;

  if (headerSize > 100 * 1024 * 1024) {
    throw new Error(`Header too large: ${headerSize} bytes`);
  }

  // Read JSON header
  const headerBlob = file.slice(8, 8 + headerSize);
  const headerBuffer = await headerBlob.arrayBuffer();
  const headerJson = new TextDecoder().decode(headerBuffer);
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
      file, // Reference to File object for reading data
    });
  }

  // Sort by offset for sequential reading
  tensors.sort((a, b) => a.offset - b.offset);

  return {
    headerSize,
    dataOffset,
    metadata,
    tensors,
    file,
    fileSize: file.size,
    fileName: file.name,
  };
}

/**
 * Parse sharded safetensors model from multiple files
 * @param {File[]} files - Array of safetensors files
 * @param {Object} [indexJson] - Optional parsed index.json content
 * @returns {Promise<Object>} Combined model info
 */
export async function parseSafetensorsSharded(files, indexJson = null) {
  const fileMap = new Map();
  for (const file of files) {
    fileMap.set(file.name, file);
  }

  // If we have an index, use it to determine tensor locations
  let weightMap = null;
  let metadata = {};

  if (indexJson) {
    weightMap = indexJson.weight_map;
    metadata = indexJson.metadata || {};
  }

  // Parse each safetensors file
  const shards = [];
  const allTensors = [];

  for (const file of files) {
    if (!file.name.endsWith('.safetensors')) continue;

    const parsed = await parseSafetensorsFile(file);
    shards.push({
      file: file.name,
      size: file.size,
      tensorCount: parsed.tensors.length,
    });

    // Add shard info to tensors
    for (const tensor of parsed.tensors) {
      tensor.shardFile = file.name;
      allTensors.push(tensor);
    }
  }

  return {
    metadata,
    shards,
    tensors: allTensors,
    fileMap,
  };
}

/**
 * Read tensor data from File
 * @param {Object} tensor - Tensor info from parsed result
 * @returns {Promise<ArrayBuffer>} Tensor data
 */
export async function readTensorData(tensor) {
  const file = tensor.file;
  if (!file) {
    throw new Error('No file reference for tensor');
  }

  const blob = file.slice(tensor.offset, tensor.offset + tensor.size);
  return blob.arrayBuffer();
}

/**
 * Stream tensor data for large files
 * @param {Object} tensor - Tensor info
 * @param {number} chunkSize - Chunk size for streaming
 * @yields {Uint8Array} Data chunks
 */
export async function* streamTensorData(tensor, chunkSize = 64 * 1024 * 1024) {
  const file = tensor.file;
  if (!file) {
    throw new Error('No file reference for tensor');
  }

  let offset = tensor.offset;
  const endOffset = tensor.offset + tensor.size;

  while (offset < endOffset) {
    const end = Math.min(offset + chunkSize, endOffset);
    const blob = file.slice(offset, end);
    const buffer = await blob.arrayBuffer();
    yield new Uint8Array(buffer);
    offset = end;
  }
}

/**
 * Parse config.json from File
 * @param {File} configFile - config.json file
 * @returns {Promise<Object>} Model config
 */
export async function parseConfigJson(configFile) {
  const text = await configFile.text();
  return JSON.parse(text);
}

/**
 * Parse tokenizer.json from File
 * @param {File} tokenizerFile - tokenizer.json file
 * @returns {Promise<Object>} Tokenizer config
 */
export async function parseTokenizerJson(tokenizerFile) {
  const text = await tokenizerFile.text();
  return JSON.parse(text);
}

/**
 * Parse model.safetensors.index.json from File
 * @param {File} indexFile - index.json file
 * @returns {Promise<Object>} Index with weight_map
 */
export async function parseIndexJson(indexFile) {
  const text = await indexFile.text();
  return JSON.parse(text);
}

/**
 * Detect model format from selected files
 * @param {File[]} files - Selected files
 * @returns {Object} Format info
 */
export function detectModelFormat(files) {
  const fileNames = files.map(f => f.name);

  // Check for index file (sharded model)
  const indexFile = files.find(f => f.name === 'model.safetensors.index.json');
  if (indexFile) {
    return {
      type: 'sharded',
      indexFile,
      safetensorsFiles: files.filter(f => f.name.endsWith('.safetensors')),
    };
  }

  // Check for single safetensors file
  const safetensorsFiles = files.filter(f => f.name.endsWith('.safetensors'));
  if (safetensorsFiles.length === 1) {
    return {
      type: 'single',
      safetensorsFile: safetensorsFiles[0],
    };
  }

  if (safetensorsFiles.length > 1) {
    return {
      type: 'sharded-no-index',
      safetensorsFiles,
    };
  }

  // Check for GGUF
  const ggufFile = files.find(f => f.name.endsWith('.gguf'));
  if (ggufFile) {
    return {
      type: 'gguf',
      ggufFile,
    };
  }

  return { type: 'unknown', files };
}

/**
 * Get auxiliary files from selection
 * @param {File[]} files - Selected files
 * @returns {Object} Auxiliary files (config, tokenizer, etc.)
 */
export function getAuxiliaryFiles(files) {
  return {
    config: files.find(f => f.name === 'config.json'),
    tokenizerConfig: files.find(f => f.name === 'tokenizer_config.json'),
    tokenizer: files.find(f => f.name === 'tokenizer.json'),
    tokenizerModel: files.find(f => f.name === 'tokenizer.model'),
    specialTokensMap: files.find(f => f.name === 'special_tokens_map.json'),
    generationConfig: files.find(f => f.name === 'generation_config.json'),
  };
}

/**
 * Calculate total model size
 * @param {Object} parsed - Parsed model info
 * @returns {number} Total size in bytes
 */
export function calculateTotalSize(parsed) {
  return parsed.tensors.reduce((sum, t) => sum + t.size, 0);
}

/**
 * Group tensors by layer
 * @param {Object} parsed - Parsed model info
 * @returns {Map<number, Object[]>} Layer index to tensors
 */
export function groupTensorsByLayer(parsed) {
  const layers = new Map();

  for (const tensor of parsed.tensors) {
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

export { DTYPE_SIZE, DTYPE_MAP };
