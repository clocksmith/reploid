# PHASE 1: TITAN TIER 1 IMPLEMENTATION PLAN

## Overview

4 Claude agents working in parallel on Tier 1 (Stock Browser Paged MoE Engine). Each agent owns a specific domain and cannot modify files outside their domain without explicit handoff.

**Branch:** `phase1`
**Target:** Mixtral-style MoE running in browser via WebGPU + OPFS

---

## AGENT ASSIGNMENTS

### AGENT-A: Memory & Capability Detection
**Domain:** `dreamer/reploid/core/titan/memory/`
**Owns:**
- `capability.js` — Memory64 probe, segmented heap fallback
- `heap-manager.js` — Unified heap or multi-heap allocation
- `address-table.js` — Virtual address translation for segmented mode
- `unified-detect.js` — Apple/Strix unified memory detection

**Tasks:**
1. Implement Memory64 feature detection (WASM binary probe)
2. Build segmented heap manager (multiple 4GB ArrayBuffers with virtual addressing)
3. Detect unified memory (vendor string parsing, adapter limits)
4. Export capability flags: `HAS_MEMORY64`, `IS_UNIFIED_MEMORY`, `MAX_HEAP_SIZE`

**Interface Contract:**
```javascript
// Other agents import from here
export async function getMemoryCapabilities() → {
  hasMemory64: boolean,
  isUnifiedMemory: boolean,
  maxHeapSize: number,
  strategy: 'MEMORY64' | 'SEGMENTED'
}

export function allocateBuffer(size: number) → { buffer: ArrayBuffer, virtualAddress: number }
export function readIntoBuffer(virtualAddress: number, length: number) → Uint8Array
```

**Reviews:** Agent-B's storage code (verify buffer handoff works)

---

### AGENT-B: Storage & Model Format (.rpl)
**Domain:** `dreamer/reploid/core/titan/storage/`
**Owns:**
- `rpl-format.js` — .rpl manifest parsing, shard layout
- `downloader.js` — Chunked download with resume, quota check
- `shard-manager.js` — OPFS shard read/write, BLAKE3 verification
- `quota.js` — `navigator.storage.persist()`, quota detection

**Tasks:**
1. Define .rpl format (manifest.json + 64MB shards)
2. Implement BLAKE3 hash verification per shard
3. Build resumable downloader (track completed shards in IndexedDB)
4. Implement `FileSystemSyncAccessHandle` reads with 4KB alignment
5. Handle quota exhaustion gracefully (prompt Tier 2)

**Interface Contract:**
```javascript
export async function downloadModel(url: string, onProgress: fn) → boolean
export async function loadShard(shardIndex: number) → ArrayBuffer
export async function verifyIntegrity() → { valid: boolean, missingShards: number[] }
export function getManifest() → { modelType, quantization, moeConfig, shards[] }
```

**Reviews:** Agent-A's memory code (verify buffer sizes match shard sizes)

---

### AGENT-C: WebGPU Kernels & Compute
**Domain:** `dreamer/reploid/core/titan/gpu/`
**Owns:**
- `device.js` — WebGPU device init, feature probing
- `kernels/matmul_f32.wgsl` — FP32 fallback matmul
- `kernels/matmul_f16.wgsl` — FP16 matmul (shader-f16 gated)
- `kernels/dequant_subgroup.wgsl` — Subgroup broadcast dequant
- `kernels/dequant_shared.wgsl` — Shared memory fallback dequant
- `kernel-selector.js` — Runtime kernel selection based on features
- `buffer-pool.js` — GPU buffer allocation, staging buffers

**Tasks:**
1. Implement WebGPU device initialization with all feature probes
2. Write Q4_K_M dequantization kernels (subgroup + fallback)
3. Write matmul kernels (f16 + f32)
4. Implement kernel selector (subgroups? f16? maxStorageBufferBindingSize?)
5. Build buffer pool for efficient GPU memory reuse

**Interface Contract:**
```javascript
export async function initDevice() → GPUDevice
export function getKernelCapabilities() → { hasSubgroups, hasF16, maxBufferSize }
export async function runMatmul(A, B, M, N, K) → GPUBuffer
export async function dequantize(quantized, scales, blockSize) → GPUBuffer
export function createStagingBuffer(size) → GPUBuffer
```

**Reviews:** Agent-D's inference code (verify kernel interfaces match)

---

### AGENT-D: Inference Pipeline & MoE Router
**Domain:** `dreamer/reploid/core/titan/inference/`
**Owns:**
- `moe-router.js` — Expert selection, gating network
- `speculative.js` — Draft model decode, token verification
- `pipeline.js` — Main inference orchestration
- `kv-cache.js` — KV cache management
- `tokenizer.js` — Tokenizer wrapper (use existing or sentencepiece WASM)

**Tasks:**
1. Implement MoE router (top-k expert selection from gating logits)
2. Build speculative decode loop (draft 5-7 tokens, verify with main model)
3. Orchestrate: load experts on demand, batch writeBuffer, run compute
4. Implement KV cache with memory-efficient storage
5. Wire up tokenizer (can use existing reploid tokenizer or add sentencepiece)

**Interface Contract:**
```javascript
export async function loadModel(manifest) → void
export async function generate(prompt: string, options: GenerateOptions) → AsyncGenerator<string>
export function getActiveExperts() → number[]
export function clearKVCache() → void
```

**Reviews:** Agent-C's kernel code (verify compute outputs are correct shape)

---

## FILE OWNERSHIP RULES

```
dreamer/reploid/core/titan/
├── memory/          ← AGENT-A ONLY
│   ├── capability.js
│   ├── heap-manager.js
│   ├── address-table.js
│   └── unified-detect.js
├── storage/         ← AGENT-B ONLY
│   ├── rpl-format.js
│   ├── downloader.js
│   ├── shard-manager.js
│   └── quota.js
├── gpu/             ← AGENT-C ONLY
│   ├── device.js
│   ├── kernel-selector.js
│   ├── buffer-pool.js
│   └── kernels/
│       ├── matmul_f32.wgsl
│       ├── matmul_f16.wgsl
│       ├── dequant_subgroup.wgsl
│       └── dequant_shared.wgsl
├── inference/       ← AGENT-D ONLY
│   ├── moe-router.js
│   ├── speculative.js
│   ├── pipeline.js
│   ├── kv-cache.js
│   └── tokenizer.js
├── index.js         ← COORDINATOR (any agent after review)
└── titan-provider.js ← COORDINATOR (any agent after review)
```

**RULE:** Do NOT create or modify files outside your domain. If you need something from another domain, define the interface contract and wait for that agent to implement it.

---

## COORDINATION PROTOCOL

### 1. Status File
Each agent maintains a status file:
```
dreamer/reploid/core/titan/STATUS_AGENT_X.md
```

Format:
```markdown
# Agent-X Status

## Completed
- [x] Task 1 description (commit: abc1234)
- [x] Task 2 description (commit: def5678)

## In Progress
- [ ] Task 3 description (ETA: ~30 min)

## Blocked
- Waiting on Agent-Y for `functionName()` interface

## Ready for Review
- `filename.js` — needs review by Agent-Z
```

### 2. Interface Contracts
Before implementing, check if the interface you need exists. If not:
1. Add a TODO comment in your code: `// TODO: Waiting on Agent-X for getMemoryCapabilities()`
2. Add to your STATUS file under "Blocked"
3. Continue with other tasks

### 3. Code Reviews
Each agent reviews one other agent's code (circular):
- A reviews B
- B reviews A
- C reviews D
- D reviews C

When you complete a file, add it to "Ready for Review" in your status. The reviewing agent should:
1. Read the file
2. Check interface compatibility
3. Add comments or approve
4. Update their status: "Reviewed Agent-X's filename.js ✓"

### 4. Commits
- Commit frequently (per-file or per-feature)
- Prefix commits with agent ID: `[A] feat: Add Memory64 probe`
- Push to `phase1` branch

---

## AGENT INSTRUCTIONS (COPY-PASTE)

### FOR AGENT-A (Memory & Capability):
```
You are AGENT-A working on the Reploid Titan Phase 1 implementation.

Your domain: dreamer/reploid/core/titan/memory/
Your responsibility: Memory64 detection, heap management, unified memory detection

Read PHASE1_PLAN.md for full context. Key tasks:
1. Create capability.js with Memory64 WASM probe
2. Create heap-manager.js for segmented/unified heap allocation
3. Create unified-detect.js for Apple/Strix detection
4. Export interface: getMemoryCapabilities(), allocateBuffer(), readIntoBuffer()

You review AGENT-B's code. Update STATUS_AGENT_A.md as you progress.
Do NOT modify files outside dreamer/reploid/core/titan/memory/

Start by creating the directory structure and capability.js.
```

### FOR AGENT-B (Storage & Format):
```
You are AGENT-B working on the Reploid Titan Phase 1 implementation.

Your domain: dreamer/reploid/core/titan/storage/
Your responsibility: .rpl format, OPFS shard management, BLAKE3 verification

Read PHASE1_PLAN.md for full context. Key tasks:
1. Create rpl-format.js with manifest parsing
2. Create shard-manager.js for OPFS read/write with BLAKE3 verification
3. Create downloader.js for resumable chunked downloads
4. Create quota.js for storage persistence and quota detection

You review AGENT-A's code. Update STATUS_AGENT_B.md as you progress.
Do NOT modify files outside dreamer/reploid/core/titan/storage/

Start by creating the directory structure and rpl-format.js.
```

### FOR AGENT-C (WebGPU Kernels):
```
You are AGENT-C working on the Reploid Titan Phase 1 implementation.

Your domain: dreamer/reploid/core/titan/gpu/
Your responsibility: WebGPU device init, compute kernels, buffer management

Read PHASE1_PLAN.md for full context. Key tasks:
1. Create device.js with WebGPU init and feature probing
2. Create kernels/matmul_f32.wgsl and matmul_f16.wgsl
3. Create kernels/dequant_subgroup.wgsl and dequant_shared.wgsl
4. Create kernel-selector.js for runtime kernel selection
5. Create buffer-pool.js for GPU buffer allocation

You review AGENT-D's code. Update STATUS_AGENT_C.md as you progress.
Do NOT modify files outside dreamer/reploid/core/titan/gpu/

Start by creating the directory structure and device.js.
```

### FOR AGENT-D (Inference Pipeline):
```
You are AGENT-D working on the Reploid Titan Phase 1 implementation.

Your domain: dreamer/reploid/core/titan/inference/
Your responsibility: MoE routing, speculative decode, inference orchestration

Read PHASE1_PLAN.md for full context. Key tasks:
1. Create moe-router.js for expert selection
2. Create speculative.js for draft model decode
3. Create pipeline.js for main inference orchestration
4. Create kv-cache.js for KV cache management
5. Create tokenizer.js wrapper

You review AGENT-C's code. Update STATUS_AGENT_D.md as you progress.
Do NOT modify files outside dreamer/reploid/core/titan/inference/

Start by creating the directory structure and moe-router.js.
```

---

## INTEGRATION CHECKLIST

When all agents complete their tasks, integration requires:

1. [ ] Agent-A exports working `getMemoryCapabilities()`
2. [ ] Agent-B can load shards into Agent-A's buffers
3. [ ] Agent-C kernels accept Agent-A's buffer formats
4. [ ] Agent-D pipeline orchestrates B→A→C flow
5. [ ] All cross-agent interfaces tested
6. [ ] `titan-provider.js` wires everything to `llm-client.js`

---

## QUICK REFERENCE

| Agent | Domain | Reviews | Key Export |
|-------|--------|---------|------------|
| A | memory/ | B | `getMemoryCapabilities()` |
| B | storage/ | A | `loadShard()`, `getManifest()` |
| C | gpu/ | D | `runMatmul()`, `dequantize()` |
| D | inference/ | C | `generate()` |
