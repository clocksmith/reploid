# RDRR Format Specification

**RDRR** = **R**ecursive **D**OPPLER **R**untime **R**egistry

A streaming model delivery format optimized for browser-based LLM inference with P2P distribution support.

## Acronym Definitions

| Name | Full Form | Description |
|------|-----------|-------------|
| **REPLOID** | Recursive Evolution Protocol Loop Orchestrating Inference DOPPLER | Agent sandbox |
| **DOPPLER** | Distributed Object Parallel Processing Layer Executing REPLOID | High-performance WebGPU runtime |
| **RDRR** | Recursive DOPPLER Runtime Registry | Streaming delivery format bridging REPLOID and DOPPLER |

## Overview

| Component | Description |
|-----------|-------------|
| **Recursive** | Self-referential structure supporting nested model components |
| **DOPPLER** | The DOPPLER inference engine (WebGPU runtime) |
| **Runtime** | Execution-ready quantized weights |
| **Registry** | Manifest-based tensor addressing and shard management |

## File Structure

```
model-name-rdrr/
├── manifest.json       # Model metadata and shard layout
├── shard_00000.bin     # 64MB shard (aligned to 4KB)
├── shard_00001.bin
├── shard_00002.bin
└── ...
```

## Manifest Schema

```json
{
  "version": "1.0",
  "modelId": "sha256-hash-of-model",
  "modelType": "transformer",
  "architecture": "Llama3ForCausalLM",
  "quantization": "Q4_K_M",
  "hashAlgorithm": "sha256",
  "config": {
    "hidden_size": 4096,
    "num_hidden_layers": 32,
    "num_attention_heads": 32,
    "vocab_size": 128256
  },
  "tokenizer": { ... },
  "shards": [
    {
      "index": 0,
      "fileName": "shard_00000.bin",
      "size": 67108864,
      "hash": "blake3-or-sha256-hex-64-chars",
      "hashAlgorithm": "sha256"
    }
  ],
  "tensors": {
    "model.embed_tokens.weight": {
      "shard": 0,
      "offset": 0,
      "size": 123456789,
      "shape": [128256, 4096],
      "dtype": "Q4_K_M"
    }
  },
  "moeConfig": null,
  "totalSize": 3400000000,
  "tensorCount": 340
}
```

### On-Disk vs Runtime-Normalized Fields

The on-disk `manifest.json` is authored by converters and may vary slightly in naming. At runtime, `storage/rdrr-format.ts` normalizes some fields for internal use:

- `shards[].fileName` or `shards[].filename` is normalized to `shards[].filename`
- `shards[].hash` or `shards[].blake3` is normalized to `shards[].hash` and `shards[].blake3` (alias)
- `shards[].offset` is computed if missing
- `hashAlgorithm` is inferred from `manifest.hashAlgorithm` or `shards[].hashAlgorithm` when present

This makes older manifests and different writers interoperable.

## Design Principles

### 1. Sharded for Streaming
- 64MB default shard size (configurable)
- 4KB alignment for optimal OPFS/disk I/O
- Supports streaming download and incremental loading

### 2. Integrity Verification
- Per-shard hash (SHA-256 supported everywhere, BLAKE3 optional)
- Enables P2P distribution without trusting the source
- Peers can verify shard integrity independently

### 3. Browser-Native
- Stored in OPFS (Origin Private File System)
- Compatible with WebGPU tensor loading
- No WASM file system emulation needed

### 4. Quantization Support
- Q4_K_M (4-bit GGML k-quants)
- F16 (half precision)
- F32 (full precision)

## Usage

### Converting Models

```bash
# From GGUF
npx tsx tools/convert-cli.ts model.gguf ./output-rdrr

# From Safetensors (HuggingFace format)
npx tsx tools/convert-cli.ts ./hf-model-dir ./output-rdrr --quantize q4_k_m
```

### Serving Models

```bash
# Serve converted model
npx tsx tools/serve-cli.ts ./model-rdrr --port 8765

# Convert and serve in one step
npx tsx tools/serve-cli.ts model.gguf
```

### Loading in Browser

```javascript
import { downloadModel, parseManifest, createPipeline } from 'doppler';

// Download model to OPFS
await downloadModel('http://localhost:8765');

// Load and create inference pipeline
const manifest = await loadManifestFromOPFS();
const pipeline = await createPipeline(parseManifest(manifest));

// Generate
for await (const token of pipeline.generate('Hello')) {
  console.log(token);
}
```

---

*Last updated: December 2025*

## Version History

| Version | Changes |
|---------|---------|
| 1.0 | Initial release with Q4_K_M, F16, F32 support |

## Additional Schema Fields

The following fields are also supported in manifests but not shown in the basic schema above:

### TensorLocation.spans
For tensors that span multiple shards:
```json
"tensors": {
  "model.embed_tokens.weight": {
    "shard": 0,
    "offset": 0,
    "size": 123456789,
    "shape": [128256, 4096],
    "dtype": "Q4_K_M",
    "spans": [
      { "shardIndex": 0, "offset": 0, "size": 67108864 },
      { "shardIndex": 1, "offset": 0, "size": 56347925 }
    ]
  }
}
```

### RuntimeOptimizations
Optional optimization hints:
```json
{
  "runtimeOptimizations": {
    "attentionKernel": "streaming"
  }
}
```

### blake3Full
Optional full-model BLAKE3 hash for integrity:
```json
{
  "blake3Full": "64-char-hex-hash-of-entire-model"
}
```

## Related Files

- `storage/rdrr-format.ts` - Parser and validation
- `tools/rdrr-writer.ts` - Writer for conversion
- `storage/shard-manager.ts` - OPFS shard management
- `storage/downloader.ts` - Resumable downloads
