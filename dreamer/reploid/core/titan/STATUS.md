# Titan Phase 1 Status

## Summary

| Agent | Domain | Files | Status |
|-------|--------|-------|--------|
| A | memory/ | 4 | ✅ Complete |
| B | storage/ | 5 | ✅ Complete |
| C | gpu/ | 7 | ✅ Complete |
| D | inference/ | 5 | ✅ Complete |
| - | integration | 2 | ✅ Complete |

**Total: 23 source files**

---

## Code Reviews

| Reviewer | Target | Status |
|----------|--------|--------|
| A → B | storage/ | ✅ Approved |
| B → A | memory/ | ✅ Approved |
| C → D | inference/ | ✅ Approved |
| D → C | gpu/ | ✅ Approved |

**All cross-reviews complete.**

---

## Agent-A: Memory & Capability

### Files
- `memory/capability.js` — Memory64 probe, heap size detection
- `memory/unified-detect.js` — Apple Silicon / AMD Strix detection
- `memory/heap-manager.js` — HeapManager with Memory64/Segmented strategies
- `memory/address-table.js` — 53-bit safe virtual address encoding

### Interface
```javascript
getMemoryCapabilities() → { hasMemory64, isUnifiedMemory, strategy }
HeapManager.allocate(size) → { virtualAddress, size, view }
HeapManager.read(virtualAddress, length) → Uint8Array
HeapManager.write(virtualAddress, data)
HeapManager.getBufferSlice(virtualAddress, length) → ArrayBuffer
```

### Review Notes (by Agent-B)
- Clean Memory64 WASM binary probe using minimal module bytes
- `probeMaxHeapSize()` tests descending sizes (16GB → 1GB) without OOM
- 53-bit safe encoding: 8-bit segment index + 45-bit offset
- `splitRange()` handles cross-segment reads for large tensors

---

## Agent-B: Storage & Format

### Files
- `storage/rpl-format.js` — .rpl manifest parsing, shard layout
- `storage/quota.js` — Persistent storage, quota monitoring
- `storage/shard-manager.js` — OPFS read/write, BLAKE3 verification
- `storage/downloader.js` — Resumable chunked downloads
- `storage/index.js` — Module exports

### Interface
```javascript
getManifest() → { modelType, quantization, moeConfig, shards[] }
loadShard(shardIndex) → ArrayBuffer
verifyIntegrity() → { valid, missingShards, corruptShards }
downloadModel(url, onProgress) → boolean
```

### Review Notes (by Agent-A)
- 64MB default shard size with MoE expert-to-shard mapping
- BLAKE3 verification with SHA-256 fallback
- 4KB alignment for FileSystemSyncAccessHandle performance
- IndexedDB state persistence for download resume

---

## Agent-C: WebGPU Kernels

### Files
- `gpu/device.js` — WebGPU init, feature detection
- `gpu/kernel-selector.js` — Runtime kernel selection
- `gpu/buffer-pool.js` — GPU buffer pooling
- `gpu/kernels/matmul_f32.wgsl` — FP32 tiled matmul
- `gpu/kernels/matmul_f16.wgsl` — FP16 matmul with f32 accumulation
- `gpu/kernels/dequant_subgroup.wgsl` — Q4_K_M with subgroup broadcast
- `gpu/kernels/dequant_shared.wgsl` — Q4_K_M fallback (shared memory)

### Interface
```javascript
initDevice() → GPUDevice
getKernelCapabilities() → { hasSubgroups, hasF16, maxBufferSize }
runMatmul(A, B, M, N, K) → GPUBuffer
dequantize(quantized, numBlocks) → GPUBuffer
acquireBuffer(size, usage) → GPUBuffer
releaseBuffer(buffer)
```

### Review Notes (by Agent-D)
- Feature detection for shader-f16, subgroups, timestamp-query
- Pipeline caching for performance
- Power-of-2 buffer buckets with hit rate tracking
- 16x16 tiled matmul with shared memory
- Q4_K_M: 256-element super-blocks with 4 sub-blocks

---

## Agent-D: Inference Pipeline

### Files
- `inference/pipeline.js` — Main orchestration
- `inference/moe-router.js` — MoE top-k expert selection
- `inference/speculative.js` — Speculative decoding
- `inference/kv-cache.js` — KV cache (contiguous/paged)
- `inference/tokenizer.js` — Tokenizer backends

### Interface
```javascript
TitanPipeline.init(manifest)
TitanPipeline.generate(prompt, options) → AsyncGenerator<string>
MoERouter.route(hiddenStates, numTokens) → ExpertSelection[]
KVCache.update(layerIdx, keys, values, startPos)
Tokenizer.encode(text) → number[]
Tokenizer.decode(ids) → string
```

### Review Notes (by Agent-C)
- Softmax uses max-subtraction for numerical stability
- Rejection sampling per Leviathan et al. 2022
- Dual KV layout: contiguous (fast) vs paged (memory-efficient)
- 3 tokenizer backends: Transformers.js, SentencePiece, BPE
- MoE load balancing stats for debugging

---

## Integration Layer

### Files
- `index.js` — Central exports for all modules
- `titan-provider.js` — LLM client interface

### TitanProvider Interface
```javascript
TitanProvider.init() → boolean
TitanProvider.loadModel(modelId, url, onProgress) → boolean
TitanProvider.chat(messages, options) → { content, usage }
TitanProvider.stream(messages, options) → AsyncGenerator<string>
TitanProvider.getCapabilities() → TitanCapabilities
TitanProvider.destroy()
```

---

## Data Flow

```
Storage (B)     Memory (A)      GPU (C)         Inference (D)
    │               │               │                 │
    │  loadShard()  │               │                 │
    ├──────────────►│               │                 │
    │               │  allocate()   │                 │
    │               ├──────────────►│                 │
    │               │  writeBuffer()│                 │
    │               ├──────────────►│                 │
    │               │               │  runMatmul()    │
    │               │               ├────────────────►│
    │               │               │  dequantize()   │
    │               │               ├────────────────►│
    │               │               │                 │  generate()
    │               │               │                 ├────────────►
```

---

## Capability Tiers

| Tier | Hardware | Max Model | Features |
|------|----------|-----------|----------|
| 1 | Apple Silicon (unified) | 60GB | Memory64, f16, subgroups |
| 2 | AMD Strix Halo (unified) | 60GB | Memory64, f16, subgroups |
| 3 | dGPU + Memory64 | 40GB MoE | Requires MoE for streaming |
| 4 | dGPU (no Memory64) | 8GB MoE | Segmented heap, smaller models |

---

## Notes

- All modules have CPU fallback implementations
- Speculative decoder includes experimental tree-based drafting
- Pipeline handles MoE expert loading on-demand
- BLAKE3 uses SHA-256 fallback until WASM module integrated

---

# Phase 2 Progress

## Agent-A: Model Conversion (tools/)

### Status: ✅ Complete

### Files Created
- `tools/gguf-parser.js` — GGUF format parser (llama.cpp models)
- `tools/safetensors-parser.js` — Safetensors format parser (HuggingFace models)
- `tools/quantizer.js` — Q4_K_M quantization/dequantization
- `tools/rpl-writer.js` — .rpl format writer with shard management
- `tools/convert-cli.js` — CLI for model conversion
- `tools/generate-fixture.js` — Test model generator
- `tools/index.js` — Module exports

### Test Fixture
- `tests/fixtures/tiny-model/` — Generated test model (904KB, 15 tensors)
  - vocab_size: 1000
  - hidden_size: 64
  - num_layers: 2
  - Ready for Agent-B testing

### Interface
```javascript
// GGUF
parseGGUF(buffer) → { metadata, tensors, quantization, config }
parseGGUFFile(path) → Promise<parsed>

// Safetensors
parseSafetensors(pathOrDir) → { tensors, config, shards }
readTensorData(tensor) → Promise<ArrayBuffer>

// Quantizer
quantizeToQ4KM(data, shape) → { quantized, numBlocks }
dequantizeQ4KM(quantized, numBlocks, shape) → Float32Array

// RPL Writer
writeRPL(outputDir, modelInfo, getTensorData, options) → { shardCount, totalSize }
createTestModel(outputDir) → { manifestPath, tensorCount }
```

### CLI Usage
```bash
# Convert GGUF
node convert-cli.js model.gguf ./output

# Convert HuggingFace with quantization
node convert-cli.js ./hf-model ./output --quantize q4_k_m

# Create test fixture
node convert-cli.js --test ./test-model
```
