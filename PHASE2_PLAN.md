# Phase 2: End-to-End Integration & Testing

## Objective

Make Titan actually work. Phase 1 built the components; Phase 2 wires them together with real models, tests, and a demo interface.

---

## Agent Assignments

| Agent | Domain | Directory | Focus |
|-------|--------|-----------|-------|
| A | Model Conversion | `titan/tools/` | GGUF → .rpl converter, quantization |
| B | Test Harness | `titan/tests/` | Unit tests, integration tests, benchmarks |
| C | Kernel Optimization | `titan/gpu/` | Profiling, tuning, new kernels |
| D | Demo Interface | `titan/demo/` | Web UI, model selection, chat |

---

## File Ownership Rules

Each agent owns their directory exclusively. No cross-directory writes.

```
titan/
├── tools/           ← Agent-A ONLY
│   ├── gguf-parser.js
│   ├── safetensors-parser.js
│   ├── quantizer.js
│   ├── rpl-writer.js
│   └── convert-cli.js
├── tests/           ← Agent-B ONLY
│   ├── unit/
│   │   ├── memory.test.js
│   │   ├── storage.test.js
│   │   ├── gpu.test.js
│   │   └── inference.test.js
│   ├── integration/
│   │   ├── pipeline.test.js
│   │   └── e2e.test.js
│   ├── benchmarks/
│   │   ├── matmul.bench.js
│   │   ├── attention.bench.js
│   │   └── throughput.bench.js
│   ├── fixtures/
│   │   └── tiny-model/
│   └── test-runner.js
├── gpu/             ← Agent-C ONLY (existing + new)
│   ├── kernels/
│   │   ├── attention.wgsl      (NEW)
│   │   ├── rmsnorm.wgsl        (NEW)
│   │   ├── softmax.wgsl        (NEW)
│   │   ├── rope.wgsl           (NEW)
│   │   └── silu.wgsl           (NEW)
│   ├── profiler.js             (NEW)
│   └── kernel-tuner.js         (NEW)
├── demo/            ← Agent-D ONLY
│   ├── index.html
│   ├── app.js
│   ├── model-selector.js
│   ├── chat-ui.js
│   ├── progress-ui.js
│   └── styles.css
└── [existing Phase 1 files - READ ONLY for all agents]
```

---

## Agent-A: Model Conversion

### Goal
Create tooling to convert popular model formats to .rpl for browser loading.

### Files to Create
1. `tools/gguf-parser.js` — Parse GGUF header, tensor metadata, quantization info
2. `tools/safetensors-parser.js` — Parse safetensors index and tensor locations
3. `tools/quantizer.js` — Requantize to Q4_K_M if needed (CPU-side)
4. `tools/rpl-writer.js` — Write .rpl manifest + shards with BLAKE3 hashes
5. `tools/convert-cli.js` — CLI entry point: `node convert-cli.js model.gguf output/`

### Interface Contract
```javascript
// gguf-parser.js
export function parseGGUF(buffer) → {
  metadata: { architecture, contextLength, vocabSize, ... },
  tensors: [{ name, shape, dtype, offset, size }],
  quantization: string
}

// safetensors-parser.js
export function parseSafetensors(indexJson, getShardBuffer) → {
  metadata: Object,
  tensors: [{ name, shape, dtype, shardFile, offset, size }]
}

// quantizer.js
export function quantizeToQ4KM(float32Data, shape) → {
  quantized: Uint8Array,
  scales: Float32Array,
  mins: Float32Array
}
export function dequantizeQ4KM(quantized, scales, mins, shape) → Float32Array

// rpl-writer.js
export async function writeRPL(outputDir, manifest, tensors, options) → {
  shardFiles: string[],
  manifestPath: string,
  totalSize: number
}

// convert-cli.js
// Usage: node convert-cli.js <input> <output-dir> [--quantize q4_k_m]
```

### Dependencies
- Read `storage/rpl-format.js` for manifest structure
- Use Node.js fs for file operations (not browser)

### Deliverables
- [ ] Parse TinyLlama-1.1B GGUF successfully
- [ ] Generate valid .rpl with 64MB shards
- [ ] Verify converted model loads in browser

---

## Agent-B: Test Harness

### Goal
Comprehensive test suite ensuring all Phase 1 code works correctly.

### Files to Create
1. `tests/unit/memory.test.js` — Test capability detection, heap allocation
2. `tests/unit/storage.test.js` — Test OPFS operations, shard loading
3. `tests/unit/gpu.test.js` — Test device init, kernel execution
4. `tests/unit/inference.test.js` — Test tokenizer, KV cache, MoE router
5. `tests/integration/pipeline.test.js` — Test full pipeline with mock model
6. `tests/integration/e2e.test.js` — Test download → load → generate flow
7. `tests/benchmarks/matmul.bench.js` — Matmul performance across sizes
8. `tests/benchmarks/attention.bench.js` — Attention kernel performance
9. `tests/benchmarks/throughput.bench.js` — Tokens/second measurement
10. `tests/fixtures/tiny-model/` — Minimal test model (~10MB)
11. `tests/test-runner.js` — Browser-based test runner

### Interface Contract
```javascript
// test-runner.js
export async function runTests(filter?) → {
  passed: number,
  failed: number,
  skipped: number,
  results: TestResult[]
}

// Each test file exports:
export const tests = [
  { name: 'test name', fn: async () => { ... }, timeout?: number }
];

// Benchmark format:
export const benchmarks = [
  { name: 'matmul 1024x1024', fn: async () => { ... }, iterations: 100 }
];
```

### Test Categories

**Unit Tests (isolated, mocked dependencies)**
```javascript
// memory.test.js
- 'capability detection returns valid structure'
- 'heap allocate/free works correctly'
- 'address encoding/decoding roundtrips'
- 'cross-segment reads work'

// storage.test.js
- 'manifest parsing validates required fields'
- 'shard integrity check detects corruption'
- 'download resume works after interruption'

// gpu.test.js
- 'device init succeeds with fallbacks'
- 'matmul produces correct results'
- 'dequantization matches CPU reference'
- 'buffer pool reuses buffers'

// inference.test.js
- 'tokenizer encode/decode roundtrips'
- 'KV cache update/retrieve works'
- 'MoE router selects top-k experts'
- 'softmax is numerically stable'
```

**Integration Tests (real components, test model)**
```javascript
// pipeline.test.js
- 'pipeline initializes with manifest'
- 'prefill processes prompt correctly'
- 'decode generates tokens'
- 'speculative decoding accepts/rejects correctly'

// e2e.test.js
- 'full flow: init → load → generate → cleanup'
- 'model hot-swap works'
- 'error recovery after GPU device lost'
```

### Deliverables
- [ ] All unit tests pass in Chrome/Firefox/Safari
- [ ] Integration tests pass with tiny-model fixture
- [ ] Benchmark results logged with device info

---

## Agent-C: Kernel Optimization

### Goal
Add missing kernels and optimize hot paths for real-world performance.

### Files to Create/Modify
1. `gpu/kernels/attention.wgsl` — Fused QKV attention kernel
2. `gpu/kernels/rmsnorm.wgsl` — RMSNorm with fused residual add
3. `gpu/kernels/softmax.wgsl` — Online softmax (numerically stable)
4. `gpu/kernels/rope.wgsl` — Rotary position embeddings
5. `gpu/kernels/silu.wgsl` — SiLU activation (x * sigmoid(x))
6. `gpu/profiler.js` — GPU timestamp profiling
7. `gpu/kernel-tuner.js` — Auto-tune workgroup sizes

### Interface Contract
```javascript
// profiler.js
export class GPUProfiler {
  begin(label: string)
  end(label: string)
  getResults() → { [label]: { avg: number, min: number, max: number, count: number } }
  reset()
}

// kernel-tuner.js
export async function tuneKernel(kernelName, inputSizes) → {
  optimalWorkgroupSize: [number, number, number],
  optimalTileSize: number,
  throughput: number  // GFLOPS or GB/s
}

// New kernel interfaces (added to kernel-selector.js):
export async function runAttention(Q, K, V, mask, numHeads, headDim) → GPUBuffer
export async function runRMSNorm(input, weight, eps) → GPUBuffer
export async function runSoftmax(input, axis) → GPUBuffer
export async function runRoPE(input, freqs, seqLen) → GPUBuffer
export async function runSiLU(input) → GPUBuffer
```

### Kernel Specifications

**attention.wgsl**
```
- Fused Q @ K^T → scale → mask → softmax → @ V
- Flash attention style: tiled to avoid materializing full attention matrix
- Support for GQA (grouped query attention)
- Causal mask built-in
```

**rmsnorm.wgsl**
```
- Compute RMS: sqrt(mean(x^2) + eps)
- Normalize: x / rms * weight
- Fused residual: output = rmsnorm(x + residual)
- Workgroup reduction for mean calculation
```

**softmax.wgsl**
```
- Online algorithm: track max and sum in single pass
- Numerically stable with max subtraction
- Support axis parameter (typically last dim)
```

**rope.wgsl**
```
- Rotary position embeddings for Q and K
- Precomputed frequency table
- Support for different RoPE variants (original, scaled)
```

**silu.wgsl**
```
- SiLU(x) = x * sigmoid(x)
- Fused with gate: SiLU(gate) * up (for LLaMA FFN)
```

### Optimization Targets
| Kernel | Target (M2 Pro) | Target (RTX 4080) |
|--------|-----------------|-------------------|
| Matmul 4096x4096 | 2 TFLOPS | 20 TFLOPS |
| Attention (2048 seq) | 50 GFLOPS | 500 GFLOPS |
| Dequant Q4_K_M | 100 GB/s | 400 GB/s |

### Deliverables
- [ ] All 5 new kernels implemented and tested
- [ ] Profiler shows per-kernel timing
- [ ] Auto-tuner finds optimal workgroup sizes
- [ ] 2x speedup on attention-heavy workloads

---

## Agent-D: Demo Interface

### Goal
Web UI to test Titan end-to-end with model selection and chat.

### Files to Create
1. `demo/index.html` — Main HTML structure
2. `demo/app.js` — Application controller
3. `demo/model-selector.js` — Model list, download progress
4. `demo/chat-ui.js` — Chat interface with streaming
5. `demo/progress-ui.js` — Download/load progress bars
6. `demo/styles.css` — Minimal styling

### Interface Contract
```javascript
// app.js
export class TitanDemo {
  async init()
  async selectModel(modelId: string)
  async downloadModel(modelId: string, url: string)
  async chat(message: string) → AsyncGenerator<string>
  getStatus() → { model: string, memory: Object, gpu: Object }
}

// model-selector.js
export class ModelSelector {
  constructor(container: HTMLElement, onSelect: Function)
  setModels(models: ModelInfo[])
  setDownloadProgress(modelId: string, progress: number)
  setActiveModel(modelId: string)
}

// chat-ui.js
export class ChatUI {
  constructor(container: HTMLElement, onSend: Function)
  addMessage(role: 'user' | 'assistant', content: string)
  streamToken(token: string)
  finishStream()
  setLoading(loading: boolean)
}

// progress-ui.js
export class ProgressUI {
  constructor(container: HTMLElement)
  show(label: string)
  setProgress(percent: number, detail?: string)
  hide()
}
```

### UI Requirements

**Model Selection Panel**
- List available models (from registry or OPFS)
- Show model size, quantization, capabilities required
- Download button with progress bar
- Delete button for cached models
- Storage usage indicator

**Chat Interface**
- Message history with user/assistant distinction
- Streaming token display
- Generation stats (tokens/sec, time)
- Stop generation button
- Clear conversation button

**Status Panel**
- Current model info
- GPU capabilities detected
- Memory usage (heap, GPU buffers)
- Performance metrics

**Error Handling**
- WebGPU not supported message
- Download failure recovery
- Model load failure details
- GPU device lost recovery

### Deliverables
- [ ] Working demo at `demo/index.html`
- [ ] Model download with resume support
- [ ] Streaming chat with TinyLlama
- [ ] Mobile-responsive layout

---

## Cross-Agent Dependencies

```
Phase 1 Code (READ ONLY)
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
    Agent-A                               Agent-C
    (tools/)                              (gpu/)
         │                                      │
         │ .rpl files                           │ kernels
         ▼                                      ▼
    Agent-B ◄────────────────────────────► Agent-D
    (tests/)                              (demo/)
         │                                      │
         │ test fixtures                        │ integration
         └──────────────────────────────────────┘
```

### Dependency Order
1. **Agent-C** starts immediately (kernels independent)
2. **Agent-A** starts immediately (conversion independent)
3. **Agent-B** starts after Agent-A creates tiny-model fixture
4. **Agent-D** starts after basic kernels from Agent-C

### Shared Resources
- `tests/fixtures/tiny-model/` — Created by Agent-A, used by Agent-B and Agent-D
- Kernel interfaces — Defined by Agent-C, used by all

---

## Review Assignments

| Reviewer | Reviews |
|----------|---------|
| A | B (tests use converted models correctly) |
| B | A (conversion produces valid .rpl) |
| C | D (demo uses GPU efficiently) |
| D | C (kernels work in real pipeline) |

---

## Coordination Protocol

### Status Updates
Each agent maintains `STATUS.md` section or comments in code:
```javascript
// STATUS: Complete | In Progress | Blocked
// BLOCKER: [description if blocked]
// READY FOR REVIEW: [yes/no]
```

### Interface Changes
If an agent needs to modify a Phase 1 interface:
1. Document proposed change in `PHASE2_PLAN.md`
2. Get approval from coordinator
3. Update interface and all consumers

### Testing Protocol
1. Agent-B provides test utilities other agents can import
2. Each agent writes tests for their own code
3. Integration tests require all components

---

## Success Criteria

### Minimum Viable
- [ ] Convert TinyLlama-1.1B to .rpl
- [ ] Load model in browser
- [ ] Generate coherent text
- [ ] Demo UI works on desktop Chrome

### Full Success
- [ ] All tests pass (unit + integration)
- [ ] Performance within 2x of native llama.cpp
- [ ] Works on Chrome, Firefox, Safari
- [ ] Mobile Safari generates (slowly)
- [ ] Model hot-swap without page reload

---

## Timeline Targets (Not Estimates)

**Checkpoint 1**: Agents A and C complete
- Converter produces valid .rpl
- All kernels implemented

**Checkpoint 2**: Agent B test harness ready
- Unit tests passing
- Tiny model fixture available

**Checkpoint 3**: Full integration
- Demo UI complete
- End-to-end test passing

**Checkpoint 4**: Optimization
- Performance benchmarks met
- Edge cases handled

---

## Quick Reference

### Starting Your Agent

```bash
# Agent-A
mkdir -p dreamer/reploid/core/titan/tools
# Create: gguf-parser.js, safetensors-parser.js, quantizer.js, rpl-writer.js, convert-cli.js

# Agent-B
mkdir -p dreamer/reploid/core/titan/tests/{unit,integration,benchmarks,fixtures}
# Create: test-runner.js, unit/*.test.js, integration/*.test.js

# Agent-C
# Modify: gpu/kernel-selector.js
# Create: gpu/kernels/{attention,rmsnorm,softmax,rope,silu}.wgsl
# Create: gpu/profiler.js, gpu/kernel-tuner.js

# Agent-D
mkdir -p dreamer/reploid/core/titan/demo
# Create: index.html, app.js, model-selector.js, chat-ui.js, progress-ui.js, styles.css
```

### Updating STATUS.md

Add your section to `dreamer/reploid/core/titan/STATUS.md`:
```markdown
## Phase 2 Progress

### Agent-X: [Domain]
- [x] Completed item
- [ ] In progress item
- [ ] Blocked: [reason]
```
