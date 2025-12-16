# DOPPLER Debug Guide

Comprehensive debugging strategies for DOPPLER WebGPU inference issues. Written for future developers and Claude agents.

---

## Quick Diagnosis Table

| Symptom | Likely Cause | First Check |
|---------|--------------|-------------|
| Garbage tokens (`<unused>`, non-Latin scripts) | Quantization format mismatch | Q4_K dequant round-trip test |
| Positive bias through layers | Missing negative values | Weight min/max statistics |
| FFN explosion (values >1000) | SiLU gating bug or weight corruption | FFN down projection stats |
| Near-uniform logits (~3% top) | Information destroyed early | Layer-by-layer hidden state tracking |
| Zero embeddings for high token IDs | 2D dispatch linearization bug | Test token ID 8192+ vs 0-100 |
| Kernel "runs" but outputs zeros | Bind group layout mismatch | Use explicit layout, not 'auto' |
| Decode broken, prefill works | KV cache or position indexing | Check `startPos`, `kvLen` values |

---

## 1. Tensor Shape Verification

Always verify buffer sizes match expected dimensions:

```typescript
// Add to any kernel call
console.log(`Q size: ${Q.size}, expected: ${numTokens * numHeads * headDim * 4}`);
console.log(`K size: ${K.size}, expected: ${numTokens * numKVHeads * headDim * 4}`);
```

### Matmul Dimension Checklist

Matmul computes `A[M,K] @ B[K,N] -> C[M,N]`. Verify:
- Input A: `[numTokens, inputDim]`
- Weight B: `[inputDim, outputDim]` (or transposed)
- Output C: `[numTokens, outputDim]`

Wrong `transposeB` flag causes silent corruption.

---

## 2. Pipeline Stage Debugging

### Add Strategic Logging

```typescript
// In layer.ts, before/after each stage
async function debugCheckBuffer(
  buffer: GPUBuffer,
  label: string,
  numTokens: number,
  expectedDim?: number
): Promise<void> {
  const data = await readBufferF32(buffer);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  const maxAbs = Math.max(Math.abs(min), Math.abs(max));

  console.log(`[${label}] min=${min.toFixed(2)}, max=${max.toFixed(2)}, mean=${mean.toFixed(2)}, maxAbs=${maxAbs.toFixed(2)}`);

  // Red flags
  if (min >= 0) console.warn(`WARNING: All values positive - check sign handling`);
  if (maxAbs > 1000) console.warn(`WARNING: Value explosion detected`);
}
```

### Expected Value Ranges

| Stage | Healthy min | Healthy max | Healthy maxAbs |
|-------|-------------|-------------|----------------|
| Embedding (scaled) | -2 | 30 | <50 |
| Post-attention | -100 | 100 | <150 |
| FFN down proj | -500 | 500 | <1000 |
| Final hidden | -50 | 50 | <100 |
| Logits | -20 | 20 | <30 |

---

## 3. Common Bug Patterns

### Pattern A: SiLU Gating Bug

**Symptom**: Decode fails, prefill may work. Hidden states explode through layers.

**Root cause**: `runSiLU()` ignores gate parameter, computes `silu(up)` instead of `silu(gate) * up`.

**Check**:
```typescript
// In silu.ts, verify variant selection
const variant = gate ? 'gate' : (useVec4 ? 'vec4' : 'default');
console.log(`[SiLU] variant=${variant}, hasGate=${!!gate}`);
```

**Fix**: Ensure `runSiLU` checks `gate` parameter before `useVec4`.

### Pattern B: Q4_K Quantization Mismatch

**Symptom**: All values positive, positive bias accumulates through layers.

**Root cause**: Quantizer stores `min` differently than GPU kernel expects. llama.cpp format stores `-actual_min` as positive offset to subtract.

**Check**:
```javascript
// Quantize -> dequantize round-trip should preserve negatives
const original = [-0.5, 0.3, -0.1, 0.8];
const quantized = quantizeQ4K(original);
const recovered = dequantQ4K(quantized);
assert(recovered[0] < 0, "Negative values must survive round-trip");
```

**Fix**: Match llama.cpp format: `value = d * sc * q - dmin * min`

### Pattern C: 2D Dispatch Without Linearization

**Symptom**: Large tensors (>65K workgroups) have zeros in upper portions. Token IDs >8192 broken.

**Root cause**: Kernel uses only `global_id.x`, ignoring `global_id.y` in 2D dispatch.

**Check**: Test specific token IDs at boundary:
```typescript
const lowToken = await embed(100);   // Should work
const highToken = await embed(10000); // Zero if broken
```

**Fix**: Linearize in kernel:
```wgsl
let threads_per_row = uniforms.workgroupsX * WORKGROUP_SIZE;
let linear_idx = global_id.y * threads_per_row + global_id.x;
```

### Pattern D: 'auto' Layout Bind Group Mismatch

**Symptom**: Kernel compiles, pipeline creates, commands submit, but output is all zeros.

**Root cause**: Multi-entry-point shaders with different binding subsets. `layout: 'auto'` only includes bindings used by the specific entry point.

**Check**: Use explicit bind group layout:
```typescript
const explicitLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    // ... ALL bindings, even if entry point doesn't use them
  ],
});
```

---

## 4. Prefill vs Decode Issues

### Decode-Specific Checklist

| Check | Expected Value | How to Verify |
|-------|---------------|---------------|
| `currentSeqLen` | Increments each step | Log in pipeline.generate() |
| `startPos` for RoPE | `currentSeqLen` (not 0) | Log in runRoPE() |
| `kvLen` for attention | `currentSeqLen + numTokens` | Log in runAttention() |
| `startPosForMask` | `currentSeqLen` | Log in attention.ts |

### KV Cache Debugging

```typescript
// In attention.ts
console.log(`[ATT_DEBUG] Decode L${layerIdx}: seqLen=${currentSeqLen}, numTokens=${numTokens}`);
console.log(`[ATT_PARAMS] kvLenForAttention=${kvLenForAttention}, startPosForMask=${startPosForMask}`);

// Verify cache has data
const gpuBuffers = kvCache.getGPUBuffers(layerIdx);
console.log(`[KV] Layer ${layerIdx}: keysSize=${gpuBuffers.keysGPU.size}, seqLen=${gpuBuffers.seqLen}`);
```

---

## 5. RoPE Position Debugging

```typescript
// Verify RoPE frequencies precomputed for full context
console.log(`[RoPE] freqsCos size=${ropeFreqsCos.size}, expected=${maxSeqLen * headDim * 2}`);

// Verify startPos passed correctly
console.log(`[RoPE] Q startPos=${startPos}, numHeads=${numHeads}, headDim=${headDim}`);
```

### Architecture-Specific RoPE

| Model | Theta | Notes |
|-------|-------|-------|
| LLaMA | 10000 | Standard |
| Gemma 3 | 1000000 | Higher theta |
| GPT-OSS | 10000 | YARN scaling factor=32 |

---

## 6. Sampling & Logits Debugging

```typescript
// Before softmax
console.log(`[Logits] raw: min=${min}, max=${max}, range=${max-min}`);

// After softmax
const topK = getTopK(probs, 5);
console.log(`[Sample] top-5: ${topK.map(t => `${t.token}:${(t.prob*100).toFixed(1)}%`).join(', ')}`);

// Red flags
if (topK[0].prob < 0.05) console.warn("Near-uniform distribution - signal destroyed");
if (topK[0].prob > 0.99) console.warn("Overconfident - possible bug in earlier layers");
```

---

## 7. Browser-Specific Issues

### Clear All Caches

```javascript
// Clear localStorage
localStorage.clear();

// Clear Cache API
caches.keys().then(k => k.forEach(c => caches.delete(c)));

// Hard refresh (Cmd+Shift+R / Ctrl+Shift+R)

// For OPFS (model weights) - use demo UI "Clear Cache" button
// Or programmatically:
import { deleteModel } from './storage/shard-manager.js';
await deleteModel(modelId);
```

### HTTP Cache Bypass (for tests)

```typescript
// In test runner
await context.route('**/*', (route) => {
  route.continue({
    headers: {
      ...route.request().headers(),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
});
```

---

## 8. Reference Comparison

### Compare Against llama.cpp

```bash
# Run same prompt through llama.cpp with debug output
./main -m model.gguf -p "the sky is" --n-gpu-layers 0 -n 5 --verbose

# Compare:
# - Token IDs produced
# - Layer activations (use --log-disable for quiet, --log-verbose for full)
```

### Compare Against transformers.js

```javascript
import { pipeline } from '@xenova/transformers';
const generator = await pipeline('text-generation', 'model-name');
const output = await generator('the sky is', { max_new_tokens: 5 });
```

---

## 9. Memory & Buffer Issues

### Common Memory Bugs

| Bug | Symptom | Fix |
|-----|---------|-----|
| Use-after-release | Zeros or corruption | Check releaseBuffer() timing |
| Wrong buffer size | Index out of bounds | Verify acquireBuffer() size |
| Buffer destroyed | WebGPU error | Ensure buffer lifetime spans usage |
| Dtype mismatch | Wrong values | Check setBufferDtype() calls |

### Debug Memory State

```typescript
// Track buffer pool state
import { getPoolStats } from './gpu/buffer-pool.js';
console.log('[Pool]', getPoolStats());
```

---

## 10. Test Commands

```bash
# Start dev server (serves demo at http://localhost:8080/)
npx tsx serve.ts

# Full test with browser UI
npx tsx tests/test-runner.ts gemma --direct --headed

# Headless (needs WebGPU support)
HEADLESS=true npx tsx tests/test-runner.ts gemma --direct

# Playwright e2e
npx playwright test doppler/tests/gemma-e2e.spec.ts --headed
```

**Note**: The app UI is served at `http://localhost:8080/` (root).

---

## 11. Performance Debugging

### GPU Submit Tracking

DOPPLER includes submit tracking to measure per-token GPU overhead:

```typescript
import { setTrackSubmits, resetSubmitStats, logSubmitStats } from '../gpu/device.js';

// Enable tracking
setTrackSubmits(true);
resetSubmitStats();

// ... run forward pass ...

// Log results
logSubmitStats('Forward pass');
setTrackSubmits(false);
```

### Command Buffer Batching

**Before batching**: ~260+ GPU submits per forward pass (~50-100ms overhead)
**After batching**: 1 submit per forward pass (~0.5ms overhead)

The batching system uses `CommandRecorder` to record GPU operations into a single command buffer:

```typescript
import { createCommandRecorder } from '../gpu/command-recorder.js';

const recorder = createCommandRecorder('forward_pass');

// Use record* variants instead of run*
await recordMatmul(recorder, A, B, M, N, K);
await recordRMSNorm(recorder, input, weight, eps);

// Submit all at once
await recorder.submitAndWait();
```

### Key Files for Performance

| File | Debug Focus |
|------|-------------|
| `gpu/command-recorder.ts` | Batched command recording |
| `gpu/submit-tracker.ts` | GPU submit statistics |
| `inference/pipeline.ts` | Forward pass orchestration |
| `inference/pipeline/layer.ts` | do* wrappers for run/record variants |

---

## Postmortem Index

| Issue | Root Cause | File |
|-------|-----------|------|
| Garbage tokens (unused16) | Q4_K quantization format | [GEMMA3-DEBUG-POSTMORTEM.md](postmortems/GEMMA3-DEBUG-POSTMORTEM.md) |
| FFN value explosion | Quantization + sign handling | [PIPELINE-VERIFICATION-POSTMORTEM.md](postmortems/PIPELINE-VERIFICATION-POSTMORTEM.md) |
| Zero embeddings high token IDs | 2D dispatch linearization | [BF16-2D-DISPATCH-POSTMORTEM.md](postmortems/BF16-2D-DISPATCH-POSTMORTEM.md) |
| Kernel outputs zeros | 'auto' layout mismatch | [MOE-EXPLICIT-LAYOUT-POSTMORTEM.md](postmortems/MOE-EXPLICIT-LAYOUT-POSTMORTEM.md) |
| Decode broken, prefill works | SiLU gating bug | (this guide, Pattern A) |

---

## For Claude Agents

When debugging DOPPLER issues:

1. **Start with symptoms** - Use the Quick Diagnosis Table above
2. **Add logging** - Strategic console.log at pipeline stages
3. **Check value ranges** - maxAbs explosion is a red flag
4. **Verify shapes** - Buffer sizes must match expected dimensions
5. **Test boundaries** - Token IDs, sequence lengths, layer indices
6. **Read postmortems** - Similar bugs have been solved before
7. **Compare references** - llama.cpp or transformers.js as ground truth

### Key Files to Instrument

| File | Debug Focus |
|------|-------------|
| `inference/pipeline.ts` | Overall flow, token loop |
| `inference/pipeline/layer.ts` | Per-layer processing |
| `inference/pipeline/attention.ts` | KV cache, RoPE, attention |
| `gpu/kernels/silu.ts` | FFN activation gating |
| `gpu/kernel-selector.ts` | Kernel dispatch, buffer management |
| `loader/doppler-loader.ts` | Weight loading, dequantization |

---

*Last updated: December 2025*
