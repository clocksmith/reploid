/**
 * tools/index.js - Model Conversion Tools
 *
 * Exports all conversion utilities for programmatic use.
 *
 * @module tools
 */

// GGUF Parser
export {
  parseGGUF,
  parseGGUFFile,
  getTensor,
  getTensors,
  groupTensorsByLayer,
  identifyMoETensors,
  GGMLType,
  GGMLTypeName,
  GGML_BLOCK_SIZE,
  GGML_TYPE_SIZE,
} from './gguf-parser.js';

// Safetensors Parser
export {
  parseSafetensorsHeader,
  parseSafetensorsFile,
  parseSafetensorsIndex,
  parseSafetensors,
  detectModelFormat,
  loadModelConfig,
  loadTokenizerConfig,
  readTensorData,
  groupTensorsByLayer as groupSafetensorsByLayer,
  calculateTotalSize,
  DTYPE_SIZE,
  DTYPE_MAP,
} from './safetensors-parser.js';

// Quantizer
export {
  quantizeToQ4KM,
  dequantizeQ4KM,
  quantizeF16ToQ4KM,
  calculateQuantizationError,
  shouldQuantize,
  getQuantizedSize,
  float32ToFloat16,
  float16ToFloat32,
  QK_K,
  QK4_K_BLOCK_SIZE,
} from './quantizer.js';

// RPL Writer
export {
  RPLWriter,
  writeRPL,
  createTestModel,
  DEFAULT_SHARD_SIZE,
  ALIGNMENT,
  computeHash,
} from './rpl-writer.js';
