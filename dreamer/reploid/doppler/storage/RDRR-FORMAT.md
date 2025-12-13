# RDRR Format Specification

**RDRR** = **R**eplicated **D**reamer **R**untime **R**esource

A model format optimized for browser-based LLM inference with P2P distribution support.

## Overview

| Component | Description |
|-----------|-------------|
| **Replicated** | P2P distribution, shards across peers, BLAKE3/SHA-256 integrity verification |
| **Dreamer** | The Dreamer inference engine |
| **Runtime** | Execution-ready quantized weights |
| **Resource** | Self-contained asset (manifest + shards) |

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
  "tensors": [
    {
      "name": "model.embed_tokens.weight",
      "shape": [128256, 4096],
      "dtype": "Q4_K_M",
      "shardIndex": 0,
      "offset": 0,
      "size": 123456789
    }
  ],
  "totalSize": 3400000000
}
```

## Design Principles

### 1. Sharded for Streaming
- 64MB default shard size (configurable)
- 4KB alignment for optimal OPFS/disk I/O
- Supports streaming download and incremental loading

### 2. Integrity Verification
- Per-shard hash (BLAKE3 preferred, SHA-256 fallback)
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
node tools/convert-cli.js model.gguf ./output-rdrr

# From Safetensors (HuggingFace format)
node tools/convert-cli.js ./hf-model-dir ./output-rdrr --quantize q4_k_m
```

### Serving Models

```bash
# Serve converted model
node tools/serve-cli.js ./model-rdrr --port 8765

# Convert and serve in one step
node tools/serve-cli.js model.gguf
```

### Loading in Browser

```javascript
import { downloadModel, parseManifest, createPipeline } from 'dreamer';

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

## Version History

| Version | Changes |
|---------|---------|
| 1.0 | Initial release with Q4_K_M, F16, F32 support |

## Related Files

- `storage/rdrr-format.js` - Parser and validation
- `tools/rdrr-writer.js` - Writer for conversion
- `storage/shard-manager.js` - OPFS shard management
- `storage/downloader.js` - Resumable downloads
