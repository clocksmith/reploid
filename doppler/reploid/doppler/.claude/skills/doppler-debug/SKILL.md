---
name: doppler-debug
description: Debug DOPPLER WebGPU inference issues. Use when investigating model output problems, kernel bugs, hidden state explosions, or decode failures in the browser-based LLM inference engine.
---

# DOPPLER Debug Skill

You are debugging DOPPLER, a browser-native WebGPU LLM inference engine. Use this skill when investigating inference issues.

## Quick Start

1. Read the debug guide: `doppler/reploid/doppler/docs/DEBUG.md`
2. Check postmortems in `doppler/reploid/doppler/docs/postmortems/`
3. Understand the pipeline: `doppler/reploid/doppler/inference/README.md`

## Key Diagnostic Steps

### 1. Identify Symptoms

| Symptom | Likely Cause |
|---------|--------------|
| Garbage tokens | Quantization format mismatch |
| Positive bias accumulation | Sign handling bug in dequant |
| FFN explosion (>1000) | SiLU gating bug |
| Near-uniform logits | Early layer corruption |
| Decode broken, prefill works | KV cache or position indexing |
| Zeros for high token IDs | 2D dispatch linearization |

### 2. Key Files to Check

- `gpu/kernels/silu.ts` - FFN activation (check gate parameter handling)
- `inference/pipeline/attention.ts` - KV cache, RoPE, attention
- `inference/pipeline/layer.ts` - Per-layer processing
- `gpu/kernel-selector.ts` - Kernel dispatch
- `loader/doppler-loader.ts` - Weight loading

### 3. Add Strategic Logging

```typescript
// Track value ranges through layers
console.log(`[L${idx}] maxAbs=${maxAbs.toFixed(2)}`);

// Check FFN gating
console.log(`[SiLU] variant=${variant}, hasGate=${!!gate}`);

// Verify KV cache
console.log(`[ATT] kvLen=${kvLenForAttention}, startPos=${startPosForMask}`);
```

### 4. Common Fixes

**SiLU gating bug (decode fails)**:
```typescript
// silu.ts - ensure gate is checked FIRST
const variant = gate ? 'gate' : (useVec4 ? 'vec4' : 'default');
```

**2D dispatch (large tensors broken)**:
```wgsl
// Linearize from 2D dispatch
let linear_idx = global_id.y * (uniforms.workgroupsX * 256u) + global_id.x;
```

**'auto' layout mismatch (kernel outputs zeros)**:
```typescript
// Use explicit bind group layout for multi-entry-point shaders
const explicitLayout = device.createBindGroupLayout({ entries: [...] });
```

## Test Commands

```bash
# Run Gemma 1B test with browser UI
npx tsx tests/test-runner.ts gemma --direct --headed

# Clear browser caches if needed
# In console: localStorage.clear(); caches.keys().then(k => k.forEach(c => caches.delete(c)));
```

## Red Flags

- `maxAbs > 1000` at any layer - value explosion
- `min >= 0` for all values - missing negatives (sign bug)
- Top token probability < 5% - near-uniform (signal destroyed)
- Top token probability > 99% - overconfident (sampling bug)

## Reference

- DEBUG.md: `doppler/reploid/doppler/docs/DEBUG.md`
- Architecture: `doppler/reploid/doppler/docs/ARCHITECTURE.md`
- Postmortems: `doppler/reploid/doppler/docs/postmortems/`
