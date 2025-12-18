# YAML Kernel Configuration System

**Status:** Planned
**Prerequisites:** Phase 1 kernel infrastructure complete
**Goal:** Declarative configuration for kernel dispatch, execution paths, and parallel scheduling.

---

## Overview

A YAML-based configuration system for controlling kernel dispatch without code changes. Enables:
- Per-model optimized kernel profiles
- Device-specific tuning
- Auto-tuning output storage
- Parallel kernel execution for independent operations

---

## Milestones

- [ ] Schema definition and TypeScript types
- [ ] YAML loader with validation
- [ ] Pipeline integration (profile-aware kernel selection)
- [ ] Parallel kernel execution groups
- [ ] Auto-tuner generates YAML profiles
- [ ] Ship pre-tuned profiles for Gemma/Llama models

---

## YAML Schema Design

```yaml
# profiles/gemma3-1b-apple-m3.yaml
name: gemma3-1b-m3-optimized
model: gemma3-1b
version: 1

# Device requirements
device:
  vendor: apple          # apple, nvidia, amd, intel
  minSharedMemory: 32768
  requiresF16: true
  requiresSubgroups: true

# Kernel selection per operation type
kernels:
  attention:
    prefill: tiled_large_f16kv
    decode: streaming_f16kv

  matmul:
    default: f16_vec4
    qkv_proj: gemv_subgroup
    lm_head: gemv_subgroup

  norm: rmsnorm_f16
  activation: silu_fused
  rope: rope_f16

# Execution strategy
execution:
  batchCommands: true      # Use CommandRecorder (1 submit vs 260+)
  kvCacheDtype: f16
  fusedGateUp: true        # Fused gate+up projection

# Parallel kernel execution
# Define independent operations that can run concurrently
parallel:
  # FFN gate and up projections are independent
  ffn_projections:
    - matmul:gate_proj
    - matmul:up_proj

  # QKV projections can run in parallel
  qkv_projections:
    - matmul:q_proj
    - matmul:k_proj
    - matmul:v_proj

# Per-layer overrides (optional)
layers:
  0-5:
    attention: tiled_small   # Early layers use smaller tiles
  6-25:
    attention: tiled_large   # Later layers use larger tiles

# Scheduling hints for parallel execution
scheduling:
  maxParallelKernels: 3
  barriers:
    - after: qkv_projections
      before: attention
    - after: ffn_projections
      before: silu
```

---

## Work Items

### Phase 1: Schema & Loader

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Define TypeScript interfaces | P0 | ⬜ TODO | `config/profile-schema.ts` |
| YAML parser integration | P0 | ⬜ TODO | Use `js-yaml` |
| Schema validation | P1 | ⬜ TODO | Optional: `ajv` for JSON schema |
| Profile directory structure | P0 | ⬜ TODO | `config/profiles/*.yaml` |

### Phase 2: Pipeline Integration

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Add `profile` option to generate() | P0 | ⬜ TODO | `inference/pipeline.ts` |
| Profile-aware matmul selection | P0 | ⬜ TODO | `gpu/kernels/matmul.ts` |
| Profile-aware attention selection | P0 | ⬜ TODO | `gpu/kernels/attention.ts` |
| Layer-specific overrides | P1 | ⬜ TODO | Per-layer kernel config |
| Fallback to auto-selection | P0 | ⬜ TODO | When profile unspecified |

### Phase 3: Parallel Kernel Execution

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| `recordParallelGroup()` method | P0 | ⬜ TODO | `gpu/command-recorder.ts` |
| FFN parallel gate/up | P0 | ⬜ TODO | `inference/pipeline/ffn.ts` |
| Attention parallel QKV | P1 | ⬜ TODO | `inference/pipeline/attention.ts` |
| Barrier insertion | P1 | ⬜ TODO | Sync points between groups |
| Benchmark parallel vs sequential | P0 | ⬜ TODO | Validate performance gain |

### Phase 4: Auto-Tuning

| Task | Priority | Status | Notes |
|------|----------|--------|-------|
| Kernel combination generator | P1 | ⬜ TODO | Enumerate valid configs |
| Benchmark harness | P1 | ⬜ TODO | Time each combination |
| YAML profile generator | P1 | ⬜ TODO | Output best config |
| Device fingerprinting | P2 | ⬜ TODO | Auto-detect device class |
| Profile caching | P2 | ⬜ TODO | localStorage/OPFS |

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `config/profile-schema.ts` | Create | TypeScript types |
| `config/profile-loader.ts` | Create | YAML loading + validation |
| `config/profiles/*.yaml` | Create | Pre-tuned profiles |
| `inference/pipeline.ts` | Modify | Accept profile option |
| `gpu/kernels/utils.ts` | Modify | Profile-aware selection |
| `gpu/command-recorder.ts` | Modify | Parallel group support |
| `inference/pipeline/ffn.ts` | Modify | Use parallel groups |
| `inference/pipeline/attention.ts` | Modify | Parallel QKV projection |
| `tools/auto-tune.ts` | Create | Benchmark + generate profiles |

---

## Dependencies

- `js-yaml` - YAML parsing (small, no native deps)
- Optional: `ajv` - JSON schema validation

---

## Success Criteria

1. Load YAML profile and override kernel selection
2. Parallel FFN projections measurably faster on supported devices
3. Auto-tuner generates valid, reproducible profiles
4. Fallback to auto-selection when no profile specified
5. Pre-tuned profiles ship for Gemma 1B/4B, Llama 1B/3B

---

## API Usage

```typescript
// Load profile by name (from config/profiles/)
const profile = await loadProfile('gemma3-1b-apple-m3');

// Or inline profile object
const profile: KernelProfile = {
  name: 'custom',
  kernels: {
    attention: { prefill: 'tiled_large', decode: 'streaming' }
  }
};

// Pass to generate
await pipeline.generate(prompt, {
  profile,
  maxTokens: 100
});

// Auto-tune and save
const bestProfile = await autoTune(pipeline, { iterations: 10 });
await saveProfile(bestProfile, 'my-device-optimized');
```

---

## Rationale

**Why YAML over TypeScript config?**
- Human-readable, easy to diff/version
- Can be generated by auto-tuner
- Separates tuning data from code
- Shareable between users with similar hardware

**Why parallel kernel groups?**
- WebGPU allows multiple compute passes without barriers
- FFN gate/up projections are mathematically independent
- QKV projections share input but have independent outputs
- Potential 1.3-1.5x speedup on high-end GPUs

**Why not TVM/compiler approach?**
- TVM requires large WASM runtime (~50MB)
- Hand-tuned WGSL is more debuggable
- Profile-based selection is simpler than compiler IR
- Can always add compiler later if needed
