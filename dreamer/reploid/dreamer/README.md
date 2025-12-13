# DOPPLER

**Distributed Object Parallel Processing Layer Executing REPLOID**

Browser-native LLM inference engine powered by WebGPU.

## The REPLOID Ecosystem

| Component | Acronym | Role |
|-----------|---------|------|
| **REPLOID** | Recursive Evolution Protocol Loop Orchestrating Inference DOPPLER | Agent sandbox - orchestrates inference requests |
| **DOPPLER** | Distributed Object Parallel Processing Layer Executing REPLOID | WebGPU runtime - executes tensor computations |
| **RDRR** | Recursive DOPPLER Runtime Registry | Streaming delivery format - registers shards for on-demand loading |

DOPPLER is the "Neuro Computer" that powers REPLOID agents. It runs large language models directly in the browser using WebGPU compute shaders. No server required for inference - weights are loaded into GPU memory and all computation happens client-side.

## Supported Models and Architectures

| Architecture | Models | Quantization | Status |
|-------------|--------|--------------|--------|
| **Gemma** | Gemma 3 1B, 4B | Q4_K_M | Full support |
| **LLaMA** | LLaMA 2/3, Mistral 7B | Q4_K_M | Full support |
| **Mixtral** | Mixtral 8x7B | Q4_K_M | MoE support |
| **GPT-OSS** | GPT-OSS 20B MoE | MXFP4 | Experimental |

### Architecture-Specific Features

**Dense Models (Gemma, LLaMA, Mistral)**
- Standard transformer attention
- Q4_K_M quantization (4-bit with 6-bit scales)
- GQA (Grouped Query Attention) support
- RoPE positional embeddings
- Gemma 3 sandwich norms

**MoE Models (Mixtral)**
- GPU-native expert routing with fused softmax+top-k
- Lazy expert loading (on-demand from OPFS)
- Per-layer router weights

**GPT-OSS MoE (Experimental)**
- Per-layer attention types (alternating sliding/full attention)
- MXFP4 quantization (mixed-precision FP4)
- Attention sinks for streaming context
- Router with bias support
- YARN RoPE scaling (factor=32)

## Features

- **WebGPU acceleration** - Runs on GPU via compute shaders
- **Quantized models** - Q4_K_M and MXFP4 support for efficient memory usage
- **Streaming inference** - Token-by-token generation
- **Multiple sources** - Load from server, browser cache (OPFS), or remote URLs
- **RDRR format** - Optimized model format for browser delivery
- **MoE support** - Mixture of Experts with GPU-native routing

## Directory Structure

```
doppler/
├── demo/           # Interactive demo UI
├── docs/           # Documentation
├── gpu/            # WebGPU kernels and device management
├── inference/      # Inference pipeline
├── loader/         # Model loading and weight management
├── memory/         # Memory management and heap allocation
├── storage/        # OPFS caching and shard management
├── bridge/         # External runtime bridge (llama.cpp etc)
├── browser/        # Browser-specific utilities
├── tools/          # Model conversion and utilities
├── debug/          # Unified debugging and testing
└── tests/          # Test suite
```

## Quick Start

### Run the Demo

```bash
# From reploid root, serve with any static server
npx serve .

# Open http://localhost:3000/doppler/demo/
```

### Convert a Model

```bash
node doppler/tools/convert-cli.js \
  --input ~/models/llama-7b/ \
  --output doppler/tools/llama-7b-q4/ \
  --quantize q4_k_m
```

## Model Format (RDRR)

DOPPLER uses **RDRR** (Recursive DOPPLER Runtime Registry) format - a browser-optimized packaging scheme that registers where memory shards are located (local OPFS or remote URL) so the DOPPLER runtime can fetch them on demand.

RDRR consists of:

- `manifest.json` - Model config, architecture, shard registry
- `shard_XXXXX.bin` - Weight shards (quantized, chunked for streaming)

### Conversion Differences by Architecture

**Dense Models (GGUF/Safetensors)**
```bash
node convert-cli.js model.gguf ./output --quantize q4_k_m
```
- Converts to Q4_K_M quantization
- Produces 64MB shards with SHA256 hashes
- Preserves BF16 for norms and embeddings

**MoE Models (Mixtral-style)**
```bash
node convert-cli.js mixtral-8x7b/ ./output --quantize q4_k_m
```
- Expert weights stored per-expert (Mixtral naming: `block_sparse_moe.experts.{N}.w{1,2,3}`)
- Router weights: `block_sparse_moe.gate.weight`

**GPT-OSS MoE (MXFP4)**
```bash
node convert-cli.js gpt-oss-20b/ ./output
```
- MXFP4 weights pass through unchanged (U8 blocks + U8 scales)
- Expert weights stored combined (all 32 experts in single tensor)
- Router includes bias: `mlp.router.{weight,bias}`
- Attention sinks: `self_attn.sinks` per layer
- Layer types array: alternating `sliding_attention` / `full_attention`

### Loading Differences

| Feature | Dense | Mixtral MoE | GPT-OSS MoE |
|---------|-------|-------------|-------------|
| Weight loading | All at once | Experts lazy-loaded | Experts lazy-loaded |
| Router | N/A | Per-layer weight | Per-layer weight+bias |
| Dequantization | Q4_K_M kernel | Q4_K_M kernel | MXFP4 kernel |
| KV Cache | Full/Sliding | Full | Hybrid (per-layer) |

### Inference Differences

| Feature | Dense | Mixtral MoE | GPT-OSS MoE |
|---------|-------|-------------|-------------|
| Attention | Standard GQA | Standard GQA | Per-layer sliding/full |
| FFN | Dense SiLU | Expert routing | Expert routing |
| RoPE | Standard/YARN | Standard | YARN (factor=32) |
| Context | Fixed window | Fixed window | 128 sliding + sinks |

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md) - System design and data flow
- [Pipeline Details](docs/PIPELINE.md) - Detailed inference pipeline docs
- [Optimization Roadmap](docs/OPTIMIZATION_ROADMAP.md) - Performance improvements
- [Competitive Analysis](docs/COMPETITIVE.md) - Comparison with other solutions
- [P2P Distribution](docs/P2P.md) - Peer-to-peer model sharing

## Requirements

- WebGPU-enabled browser (Chrome 113+, Edge 113+, Firefox Nightly)
- GPU with sufficient VRAM for model weights
- ~4GB+ recommended for 7B parameter models

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Demo UI                          │
├─────────────────────────────────────────────────────┤
│             DOPPLER Inference Pipeline              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Tokenize │→│ Forward  │→│ Sample   │→ tokens    │
│  └──────────┘ └──────────┘ └──────────┘            │
├─────────────────────────────────────────────────────┤
│              GPU Kernels (WebGPU)                   │
│  MatMul │ RMSNorm │ RoPE │ Attention │ SiLU        │
├─────────────────────────────────────────────────────┤
│           Memory / Buffer Management                │
├─────────────────────────────────────────────────────┤
│  Storage (OPFS)  │  RDRR Loader  │  Tokenizer      │
└─────────────────────────────────────────────────────┘
```

## Execution Flow

DOPPLER uses JavaScript for orchestration and WGSL compute kernels for tensor math.
JS dispatches GPU work asynchronously and only blocks when reading results.

### Per-Layer Kernel Execution

Each transformer layer executes these kernels in sequence:

```
Input
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ 1. rmsnorm      - Input normalization               │
│ 2. matmul ×3    - Q, K, V projections               │
│ 3. rope         - Rotary position encoding          │
│ 4. attention    - Scaled dot-product attention      │
│ 5. matmul       - Output projection                 │
│ 6. residual     - Add skip connection               │
│ 7. rmsnorm      - Post-attention norm               │
│ 8. matmul ×2    - Gate and Up projections (FFN)     │
│    (MoE: softmax → topk → expert dispatch)          │
│ 9. silu         - Activation: SiLU(gate) × up       │
│10. matmul       - Down projection                   │
│11. residual     - Add skip connection               │
└─────────────────────────────────────────────────────┘
  │
  ▼
Next Layer (repeat for all layers)
```

### JS/GPU Interleaving

```
JS (Main Thread)              GPU (Async)
────────────────              ───────────
createCommandEncoder()        (idle)
setPipeline(), setBindGroup() (idle)
dispatchWorkgroups()          (idle)
queue.submit() ───────────────► KERNEL EXECUTION
(returns immediately)         ████████████
(can do other JS work)        ████████████
                              ████████████
await readBuffer() ◄──────────COMPLETE (sync point)
```

Key insight: `queue.submit()` is non-blocking. GPU work runs in parallel with JS
until a readback forces synchronization.

### Prefill vs Decode

| Phase | Tokens | Attention | KV Cache | Bottleneck |
|-------|--------|-----------|----------|------------|
| **Prefill** | N (all input) | N×N causal mask | Write N entries | Compute |
| **Decode** | 1 | 1×(N+t) no mask | Read all, write 1 | Memory bandwidth |

**Prefill** (process prompt):
- All input tokens processed in parallel
- Large matrix multiplies keep GPU saturated
- Attention is O(N²) - dominates for long prompts

**Decode** (generate tokens):
- One token at a time (autoregressive)
- Load full weight matrices for single output row
- GPU often <30% utilized (waiting on memory)
- No attention mask needed (single query sees all past keys)

### Timing Breakdown (7B model, typical GPU)

```
PREFILL (512 tokens): ~800ms total
├── Per layer (~33ms × 24 layers):
│   ├── attention:  15ms  ████████████████████ (45%)
│   ├── FFN matmuls: 12ms ████████████████ (36%)
│   ├── QKV matmuls:  3ms ████ (9%)
│   └── norms/rope:  <1ms ░ (3%)
├── JS orchestration: <1ms
└── Final sample:     <1ms

DECODE (1 token): ~26ms total (~38 tok/s)
├── Per layer (~1ms × 24 layers):
│   ├── attention:  0.3ms ██████ (30%) - memory bound
│   ├── FFN matmuls: 0.4ms ████████ (40%)
│   ├── QKV matmuls: 0.1ms ██ (10%)
│   └── norms/rope: <0.1ms ░
├── JS orchestration: 0.5ms (2% - noticeable!)
└── Readback + sample: 0.5ms
```

### GPU Readback Points

Data only transfers GPU→CPU at these points:
1. **Final logits** - once per generated token (unavoidable)
2. **Router logits** - MoE models only, once per MoE layer

All intermediate tensors stay on GPU. This is critical for performance.

## License

Part of the REPLOID project.
