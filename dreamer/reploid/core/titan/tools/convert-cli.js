#!/usr/bin/env node
/**
 * convert-cli.js - Model Conversion CLI
 *
 * Converts GGUF or Safetensors models to Titan's .rpl format.
 *
 * Usage:
 *   node convert-cli.js <input> <output-dir> [options]
 *
 * Examples:
 *   node convert-cli.js model.gguf ./output
 *   node convert-cli.js ./hf-model-dir ./output --quantize q4_k_m
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
import { basename, extname, resolve } from 'path';

import { parseGGUF, parseGGUFFile } from './gguf-parser.js';
import { parseSafetensors, readTensorData } from './safetensors-parser.js';
import { quantizeToQ4KM, shouldQuantize, getQuantizedSize } from './quantizer.js';
import { RPLWriter, writeRPL, createTestModel } from './rpl-writer.js';

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
Titan Model Converter - Convert models to .rpl format

Usage:
  node convert-cli.js <input> <output-dir> [options]

Arguments:
  input       Path to GGUF file, safetensors file, or HuggingFace model directory
  output-dir  Directory to write .rpl output

Options:
  --quantize <type>   Quantize weights (q4_k_m, f16, f32)
  --shard-size <mb>   Shard size in MB (default: 64)
  --model-id <id>     Override model ID in manifest
  --test              Create tiny test model (ignores input)
  --verbose, -v       Verbose output
  --help, -h          Show this help

Examples:
  # Convert GGUF model
  node convert-cli.js tinyllama-1.1b-q4_k_m.gguf ./tinyllama-rpl

  # Convert HuggingFace model with quantization
  node convert-cli.js ./Llama-3.2-1B ./llama-rpl --quantize q4_k_m

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

    // Optionally re-quantize
    if (options.quantize === 'q4_k_m' && shouldQuantize(tensor.name, tensor.shape)) {
      // Already quantized in GGUF, just return as-is for now
      // TODO: Implement re-quantization if source is F16/F32
    }

    return data;
  };

  // Write .rpl
  const result = await writeRPL(outputDir, modelInfo, getTensorData, {
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

  // Determine output quantization
  const targetQuant = options.quantize || 'f16';

  // Create tensor data getter with optional quantization
  const getTensorData = async (tensor) => {
    const data = await readTensorData(tensor);

    if (targetQuant === 'q4_k_m' && shouldQuantize(tensor.name, tensor.shape)) {
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

  // Write .rpl
  const result = await writeRPL(outputDir, modelInfo, getTensorData, {
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
  if (!options.input || !options.output) {
    console.error('Error: Both input and output-dir are required');
    console.error('Use --help for usage information');
    process.exit(1);
  }

  const inputPath = resolve(options.input);
  const outputDir = resolve(options.output);

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
