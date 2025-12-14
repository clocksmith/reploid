#!/usr/bin/env node
/**
 * convert-cli.js - Model Conversion CLI
 *
 * Converts GGUF or Safetensors models to DOPPLER's .rdrr format.
 *
 * Usage:
 *   node convert-cli.js <input> [output-dir] [options]
 *
 * Examples:
 *   node convert-cli.js model.gguf                    # outputs to ../models/model/
 *   node convert-cli.js model.gguf ./custom-output
 *   node convert-cli.js ./hf-model-dir --quantize q4_k_m
 *   node convert-cli.js model.safetensors ./output
 *
 * Options:
 *   --quantize <type>   Quantize to specified format (q4_k_m, f16, f32)
 *   --shard-size <mb>   Shard size in MB (default: 64)
 *   --model-id <id>     Override model ID
 *   --test              Create a tiny test model instead
 *   --verbose           Verbose output
 *   --help              Show help
 *
 * @module tools/convert-cli
 */

import { readFile, stat } from 'fs/promises';
import { basename, extname, resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { parseGGUF, parseGGUFFile } from './gguf-parser.js';
import { parseSafetensors, readTensorData } from './safetensors-parser.js';
import { quantizeToQ4KM, shouldQuantize, getQuantizedSize } from './quantizer.js';
import { RDRRWriter, writeRDRR, createTestModel } from './rdrr-writer.js';

// Parse command line arguments
function parseArgs(args) {
  const options = {
    input: null,
    output: null,
    quantize: null,
    shardSize: 64,
    modelId: null,
    test: false,
    verbose: false,
    fast: false,
    textOnly: false,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--test') {
      options.test = true;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--fast') {
      options.fast = true;
    } else if (arg === '--text-only') {
      options.textOnly = true;
    } else if (arg === '--quantize' || arg === '-q') {
      options.quantize = args[++i]?.toLowerCase();
    } else if (arg === '--shard-size') {
      options.shardSize = parseInt(args[++i], 10);
    } else if (arg === '--model-id') {
      options.modelId = args[++i];
    } else if (!arg.startsWith('-')) {
      if (!options.input) {
        options.input = arg;
      } else if (!options.output) {
        options.output = arg;
      }
    }

    i++;
  }

  return options;
}

// Print help
function printHelp() {
  console.log(`
DOPPLER Model Converter - Convert models to .rdrr format

Usage:
  node convert-cli.js <input> [output-dir] [options]

Arguments:
  input       Path to GGUF file, safetensors file, or HuggingFace model directory
  output-dir  Directory to write .rdrr output (default: ../models/<model-name>)

Options:
  --quantize <type>   Quantize weights (q4_k_m, f16, f32)
  --shard-size <mb>   Shard size in MB (default: 64)
  --model-id <id>     Override model ID in manifest
  --text-only         Extract only text model (skip vision/projector, strip prefixes)
  --fast              Pre-load shards into memory (faster, uses more RAM)
  --test              Create tiny test model (ignores input)
  --verbose, -v       Verbose output
  --help, -h          Show this help

Examples:
  # Convert GGUF model
  node convert-cli.js tinyllama-1.1b-q4_k_m.gguf ./tinyllama-rdrr

  # Convert HuggingFace model with quantization
  node convert-cli.js ./Llama-3.2-1B ./llama-rdrr --quantize q4_k_m

  # Convert multimodal model to text-only
  node convert-cli.js ./gemma-3-4b-it ./gemma-4b-text --text-only --quantize q4_k_m

  # Create test fixture
  node convert-cli.js --test ./test-model

Supported formats:
  - GGUF (.gguf) - llama.cpp format
  - Safetensors (.safetensors) - HuggingFace format
  - HuggingFace directory (with model.safetensors or index.json)
`);
}

// Progress bar helper
function progressBar(current, total, width = 40) {
  const percent = current / total;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return `[${bar}] ${Math.round(percent * 100)}%`;
}

// Format bytes
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Detect input format
async function detectFormat(inputPath) {
  const stats = await stat(inputPath);

  if (stats.isDirectory()) {
    return 'safetensors-dir';
  }

  const ext = extname(inputPath).toLowerCase();
  if (ext === '.gguf') {
    return 'gguf';
  }
  if (ext === '.safetensors') {
    return 'safetensors';
  }
  if (ext === '.json' && inputPath.includes('index')) {
    return 'safetensors-index';
  }

  throw new Error(`Unknown input format: ${inputPath}`);
}

// Convert GGUF model
async function convertGGUF(inputPath, outputDir, options) {
  console.log(`\nParsing GGUF: ${inputPath}`);

  const modelInfo = await parseGGUFFile(inputPath);
  console.log(`  Architecture: ${modelInfo.architecture}`);
  console.log(`  Quantization: ${modelInfo.quantization}`);
  console.log(`  Tensors: ${modelInfo.tensors.length}`);
  console.log(`  File size: ${formatBytes(modelInfo.fileSize)}`);

  // Read full file for tensor data
  const fileBuffer = await readFile(inputPath);

  // Create tensor data getter
  const getTensorData = async (tensor) => {
    const data = fileBuffer.buffer.slice(tensor.offset, tensor.offset + tensor.size);

    // Optionally re-quantize if source is F16/F32 and we want Q4_K_M
    if (options.quantize === 'q4_k_m' && shouldQuantize(tensor.name, tensor.shape)) {
      const sourceQuant = tensor.quantization || modelInfo.quantization;

      // Only re-quantize if source is floating point
      if (sourceQuant === 'F16' || sourceQuant === 'F32' || sourceQuant === 'BF16') {
        // Convert to F32 first
        let f32Data;
        if (sourceQuant === 'F32') {
          f32Data = new Float32Array(data);
        } else if (sourceQuant === 'F16') {
          const f16 = new Uint16Array(data);
          f32Data = new Float32Array(f16.length);
          for (let i = 0; i < f16.length; i++) {
            f32Data[i] = float16ToFloat32(f16[i]);
          }
        } else if (sourceQuant === 'BF16') {
          const bf16 = new Uint16Array(data);
          f32Data = new Float32Array(bf16.length);
          for (let i = 0; i < bf16.length; i++) {
            const f32View = new Float32Array(1);
            const u32View = new Uint32Array(f32View.buffer);
            u32View[0] = bf16[i] << 16;
            f32Data[i] = f32View[0];
          }
        }

        // Quantize to Q4_K_M
        const { quantized } = quantizeToQ4KM(f32Data, tensor.shape);
        tensor.dtype = 'Q4_K_M';
        tensor.size = quantized.length;

        if (options.verbose) {
          console.log(`  Re-quantized ${tensor.name}: ${sourceQuant} -> Q4_K_M`);
        }

        return quantized.buffer;
      }
    }

    return data;
  };

  // Infer missing config values from tensor shapes
  inferConfigFromTensors(modelInfo);

  // Write .rdrr
  const result = await writeRDRR(outputDir, modelInfo, getTensorData, {
    modelId: options.modelId || modelInfo.modelName,
    quantization: modelInfo.quantization,
    shardSize: options.shardSize * 1024 * 1024,
    onProgress: ({ stage, current, total, tensorName }) => {
      if (stage === 'writing' && options.verbose) {
        process.stdout.write(`\r  Writing tensors: ${progressBar(current, total)} ${tensorName?.slice(0, 30) || ''}`.padEnd(80));
      } else if (stage === 'complete') {
        console.log(`\n  Complete!`);
      }
    },
  });

  return result;
}

/**
 * Infer missing config values from tensor shapes
 * This ensures the manifest has all required parameters even if the source config is incomplete
 */
function inferConfigFromTensors(modelInfo) {
  if (!modelInfo.config) {
    modelInfo.config = {};
  }
  const config = modelInfo.config;

  // Find layer 0 attention tensors to infer dimensions
  const qProj = modelInfo.tensors.find(t => t.name.includes('.0.self_attn.q_proj.weight'));
  const kProj = modelInfo.tensors.find(t => t.name.includes('.0.self_attn.k_proj.weight'));
  const qNorm = modelInfo.tensors.find(t => t.name.includes('.0.self_attn.q_norm.weight'));

  // Infer hidden_size from embedding
  const embed = modelInfo.tensors.find(t => t.name.includes('embed_tokens.weight'));
  if (embed && !config.hidden_size) {
    config.hidden_size = embed.shape[1];
    console.log(`  Inferred hidden_size=${config.hidden_size} from embedding`);
  }

  // Infer num_hidden_layers by counting layers
  if (!config.num_hidden_layers) {
    const layerNums = modelInfo.tensors
      .filter(t => t.name.includes('.layers.'))
      .map(t => {
        const match = t.name.match(/\.layers\.(\d+)\./);
        return match ? parseInt(match[1]) : -1;
      })
      .filter(n => n >= 0);
    if (layerNums.length > 0) {
      config.num_hidden_layers = Math.max(...layerNums) + 1;
      console.log(`  Inferred num_hidden_layers=${config.num_hidden_layers}`);
    }
  }

  // Infer head_dim from q_norm (which has shape [head_dim])
  if (qNorm && !config.head_dim) {
    config.head_dim = qNorm.shape[0];
    console.log(`  Inferred head_dim=${config.head_dim} from q_norm`);
  }

  // Infer num_attention_heads and num_key_value_heads from projection shapes
  // q_proj: [num_heads * head_dim, hidden_size]
  // k_proj: [num_kv_heads * head_dim, hidden_size]
  if (qProj && config.head_dim && !config.num_attention_heads) {
    config.num_attention_heads = qProj.shape[0] / config.head_dim;
    console.log(`  Inferred num_attention_heads=${config.num_attention_heads} from q_proj`);
  }
  if (kProj && config.head_dim && !config.num_key_value_heads) {
    config.num_key_value_heads = kProj.shape[0] / config.head_dim;
    console.log(`  Inferred num_key_value_heads=${config.num_key_value_heads} from k_proj`);
  }

  // Infer intermediate_size from FFN projections
  const gateProj = modelInfo.tensors.find(t => t.name.includes('.0.mlp.gate_proj.weight'));
  if (gateProj && !config.intermediate_size) {
    config.intermediate_size = gateProj.shape[0];
    console.log(`  Inferred intermediate_size=${config.intermediate_size} from gate_proj`);
  }

  // Set/fix rope_theta based on architecture
  // Many source configs have incorrect or missing rope_theta
  const arch = config.architectures?.[0] || '';
  let expectedTheta = 10000;  // Default for most models
  if (arch.includes('Gemma')) {
    expectedTheta = 1000000;  // Gemma uses 10^6
  } else if (arch.includes('Llama') || arch.includes('Mistral') || arch.includes('Qwen')) {
    expectedTheta = 10000;  // LLaMA/Mistral/Qwen use 10^4
  } else if (arch.includes('GptOss')) {
    expectedTheta = 150000;  // GPT-OSS uses 150000
  }

  if (!config.rope_theta) {
    config.rope_theta = expectedTheta;
    console.log(`  Set rope_theta=${config.rope_theta} for ${arch || 'unknown'}`);
  } else if (config.rope_theta !== expectedTheta &&
             (arch.includes('Mistral') || arch.includes('Llama'))) {
    // Fix common misconfiguration for Mistral/Llama models
    console.warn(`  Warning: rope_theta=${config.rope_theta} unusual for ${arch}, expected ${expectedTheta}`);
  }

  // Infer head_dim if missing
  if (!config.head_dim && config.hidden_size && config.num_attention_heads) {
    // Default: head_dim = hidden_size / num_attention_heads
    // Exception: Gemma 3 uses fixed head_dim=256 regardless of hidden_size
    if (arch.includes('Gemma3') || arch.includes('Gemma 3')) {
      config.head_dim = 256;
    } else {
      config.head_dim = Math.floor(config.hidden_size / config.num_attention_heads);
    }
    console.log(`  Inferred head_dim=${config.head_dim}`);
  }

  // Validate required fields
  const required = ['hidden_size', 'num_hidden_layers', 'num_attention_heads'];
  const missing = required.filter(k => !config[k]);
  if (missing.length > 0) {
    console.warn(`  Warning: Could not infer config values: ${missing.join(', ')}`);
  }
}

// Convert Safetensors model
async function convertSafetensors(inputPath, outputDir, options) {
  console.log(`\nParsing Safetensors: ${inputPath}`);

  const modelInfo = await parseSafetensors(inputPath);
  console.log(`  Tensors: ${modelInfo.tensors.length}`);
  if (modelInfo.shards) {
    console.log(`  Shards: ${modelInfo.shards.length}`);
  }
  if (modelInfo.config) {
    console.log(`  Architecture: ${modelInfo.config.architectures?.[0] || 'unknown'}`);
    console.log(`  Hidden size: ${modelInfo.config.hidden_size || 'unknown'}`);
    console.log(`  Layers: ${modelInfo.config.num_hidden_layers || 'unknown'}`);
  }

  // Handle --text-only: filter out vision tensors and strip language_model prefix
  if (options.textOnly) {
    const originalCount = modelInfo.tensors.length;

    // Filter out vision and projector tensors
    modelInfo.tensors = modelInfo.tensors.filter(t => {
      if (t.name.startsWith('vision_tower.')) return false;
      if (t.name.startsWith('multi_modal_projector.')) return false;
      return true;
    });

    // Strip language_model. prefix from tensor names
    for (const tensor of modelInfo.tensors) {
      if (tensor.name.startsWith('language_model.')) {
        tensor.name = tensor.name.replace('language_model.', '');
      }
    }

    // Update architecture in config for text-only model
    if (modelInfo.config) {
      // Use text_config if available (multimodal models)
      if (modelInfo.config.text_config) {
        const textConfig = modelInfo.config.text_config;
        modelInfo.config = {
          ...modelInfo.config,
          ...textConfig,
          architectures: ['Gemma3ForCausalLM'],
        };
        delete modelInfo.config.text_config;
        delete modelInfo.config.vision_config;
      }
    }

    console.log(`  Text-only: ${originalCount} -> ${modelInfo.tensors.length} tensors`);
  }

  // Infer missing config values from tensor shapes
  inferConfigFromTensors(modelInfo);

  // Determine output quantization
  const targetQuant = options.quantize || 'f16';

  // Pre-load shard files into memory for faster conversion (--fast mode)
  const shardBuffers = new Map();
  if (options.fast) {
    console.log(`  Pre-loading shard files into memory...`);
    const uniqueShards = new Set();
    for (const tensor of modelInfo.tensors) {
      const path = tensor.shardPath || tensor.filePath;
      if (path) uniqueShards.add(path);
    }
    let totalLoaded = 0;
    for (const shardPath of uniqueShards) {
      const buffer = await readFile(shardPath);
      shardBuffers.set(shardPath, buffer);
      totalLoaded += buffer.length;
      console.log(`    Loaded ${basename(shardPath)} (${formatBytes(buffer.length)})`);
    }
    console.log(`  Total loaded: ${formatBytes(totalLoaded)}`);
  }

  // Create tensor data getter with optional quantization
  const getTensorData = async (tensor) => {
    let data;
    const filePath = tensor.shardPath || tensor.filePath;

    if (options.fast && shardBuffers.has(filePath)) {
      // Fast path: slice from pre-loaded buffer
      const buffer = shardBuffers.get(filePath);
      data = buffer.buffer.slice(tensor.offset, tensor.offset + tensor.size);
    } else {
      // Slow path: read from file
      data = await readTensorData(tensor);
    }

    // Only quantize floating-point tensors
    const floatDtypes = ['F32', 'F16', 'BF16'];
    if (targetQuant === 'q4_k_m' && floatDtypes.includes(tensor.dtype) && shouldQuantize(tensor.name, tensor.shape)) {
      // Quantize to Q4_K_M
      const f32Data = tensor.dtype === 'F32'
        ? new Float32Array(data)
        : convertToF32(data, tensor.dtype);

      const { quantized } = quantizeToQ4KM(f32Data, tensor.shape);
      tensor.dtype = 'Q4_K_M';
      tensor.size = quantized.length;
      return quantized.buffer;
    }

    return data;
  };

  // Write .rdrr
  const result = await writeRDRR(outputDir, modelInfo, getTensorData, {
    modelId: options.modelId || basename(inputPath).replace(/\.(safetensors|json)$/, ''),
    quantization: targetQuant.toUpperCase(),
    shardSize: options.shardSize * 1024 * 1024,
    onProgress: ({ stage, current, total, tensorName }) => {
      if (stage === 'writing') {
        process.stdout.write(`\r  Writing tensors: ${progressBar(current, total)} ${tensorName?.slice(0, 30) || ''}`.padEnd(80));
      } else if (stage === 'complete') {
        console.log(`\n  Complete!`);
      }
    },
  });

  return result;
}

// Convert dtype to F32
function convertToF32(buffer, dtype) {
  if (dtype === 'F32') {
    return new Float32Array(buffer);
  }

  if (dtype === 'F16') {
    const f16 = new Uint16Array(buffer);
    const f32 = new Float32Array(f16.length);
    for (let i = 0; i < f16.length; i++) {
      f32[i] = float16ToFloat32(f16[i]);
    }
    return f32;
  }

  if (dtype === 'BF16') {
    const bf16 = new Uint16Array(buffer);
    const f32 = new Float32Array(bf16.length);
    for (let i = 0; i < bf16.length; i++) {
      // BF16 to F32: just shift left by 16 bits
      const f32View = new Float32Array(1);
      const u32View = new Uint32Array(f32View.buffer);
      u32View[0] = bf16[i] << 16;
      f32[i] = f32View[0];
    }
    return f32;
  }

  throw new Error(`Unsupported dtype for conversion: ${dtype}`);
}

// F16 to F32 conversion
function float16ToFloat32(h) {
  const sign = (h >> 15) & 0x1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;

  if (exp === 0) {
    if (frac === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024);
  }

  if (exp === 31) {
    return frac ? NaN : (sign ? -Infinity : Infinity);
  }

  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Handle test model creation
  if (options.test) {
    const outputDir = options.output || options.input || './test-model';
    console.log(`Creating test model in: ${outputDir}`);

    const result = await createTestModel(resolve(outputDir));
    console.log(`\nTest model created:`);
    console.log(`  Shards: ${result.shardCount}`);
    console.log(`  Tensors: ${result.tensorCount}`);
    console.log(`  Total size: ${formatBytes(result.totalSize)}`);
    console.log(`  Manifest: ${result.manifestPath}`);
    process.exit(0);
  }

  // Validate arguments
  if (!options.input) {
    console.error('Error: Input file/directory is required');
    console.error('Use --help for usage information');
    process.exit(1);
  }

  const inputPath = resolve(options.input);

  // Default output to ../models/<model-name> if not specified
  let outputDir;
  if (options.output) {
    outputDir = resolve(options.output);
  } else {
    // Extract model name from input (without extension)
    const inputBasename = basename(inputPath);
    const modelName = inputBasename.replace(/\.(gguf|safetensors)$/i, '').replace(/\s+/g, '-').toLowerCase();
    outputDir = join(__dirname, '..', 'models', modelName);
    console.log(`Output directory not specified, using: ${outputDir}`);
  }

  try {
    // Detect format
    const format = await detectFormat(inputPath);
    console.log(`Detected format: ${format}`);

    let result;

    if (format === 'gguf') {
      result = await convertGGUF(inputPath, outputDir, options);
    } else if (format === 'safetensors' || format === 'safetensors-dir' || format === 'safetensors-index') {
      result = await convertSafetensors(inputPath, outputDir, options);
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }

    // Print summary
    console.log(`\nConversion complete:`);
    console.log(`  Output: ${outputDir}`);
    console.log(`  Shards: ${result.shardCount}`);
    console.log(`  Tensors: ${result.tensorCount}`);
    console.log(`  Total size: ${formatBytes(result.totalSize)}`);
    console.log(`  Manifest: ${result.manifestPath}`);

  } catch (error) {
    console.error(`\nError: ${error.message}`);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
