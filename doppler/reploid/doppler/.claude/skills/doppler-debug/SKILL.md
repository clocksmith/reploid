---
name: doppler-debug
description: Debug DOPPLER WebGPU inference issues. Use when investigating model output problems, kernel bugs, hidden state explosions, or decode failures in the browser-based LLM inference engine.
---

# DOPPLER Debug Skill

You are debugging DOPPLER, a browser-native WebGPU LLM inference engine.

## Resources

1. **Troubleshooting Guide**: `doppler/reploid/doppler/docs/DOPPLER-TROUBLESHOOTING.md`
   - Quick diagnosis table (symptoms -> causes)
   - Pipeline stage debugging with expected value ranges
   - Common bug patterns and fixes
   - Browser cache clearing procedures

2. **Postmortems**: `doppler/reploid/doppler/docs/postmortems/`
   - GEMMA3-DEBUG-POSTMORTEM.md - Q4_K quantization issues
   - PIPELINE-VERIFICATION-POSTMORTEM.md - FFN value explosion
   - BF16-2D-DISPATCH-POSTMORTEM.md - Zero embeddings for high token IDs
   - MOE-EXPLICIT-LAYOUT-POSTMORTEM.md - Kernel outputs zeros

3. **Architecture**: `doppler/reploid/doppler/docs/ARCHITECTURE.md`

## Key Files to Instrument

| File | Debug Focus |
|------|-------------|
| `inference/pipeline.ts` | Overall flow, token loop |
| `inference/pipeline/layer.ts` | Per-layer processing |
| `inference/pipeline/attention.ts` | KV cache, RoPE, attention |
| `gpu/kernels/silu.ts` | FFN activation gating |
| `gpu/kernel-selector.ts` | Kernel dispatch, buffer management |
| `loader/doppler-loader.ts` | Weight loading, dequantization |

## Build Commands

**IMPORTANT:** After modifying any TypeScript files in `doppler/`, you must rebuild before testing in the browser:

```bash
# From doppler/reploid directory (contains package.json)
cd /path/to/reploid/doppler/reploid
npm run build:doppler

# Verify changes are compiled (example: check for new kernel)
grep "gemv_subgroup" doppler/dist/gpu/kernels/matmul.js
```

The browser loads JavaScript from `/doppler/dist/`, not TypeScript directly. Changes to `.ts` files won't take effect until rebuilt.

## Debug Output Control

**IMPORTANT:** Debug GPU readbacks are gated behind a flag to avoid performance impact.

- **CLI:** Pass `--debug` to enable verbose layer-by-layer output
- **Code:** Set `debug: true` in generate options

```typescript
// Enable debug output programmatically
await pipeline.generate(prompt, { debug: true, maxTokens: 10 });
```

Without the debug flag, benchmarks run at full speed with no GPU sync points for debugging.

## Test Commands

```bash
# Run Gemma test with browser UI
npx tsx tests/test-runner.ts gemma --direct --headed

# Playwright E2E
npx playwright test doppler/tests/gemma-e2e.spec.ts --headed

# Quick benchmark with debug output
npm run benchmark:headed -- --suite quick --verbose --prompt "The color of the sky is"

# Filter for specific debug output
npm run benchmark:headed -- --suite quick --verbose 2>&1 | grep -E "logits|top-5|sampled" | head -20
```

## Current Known Issue: Decode Zero Logits

**Symptom:** Prefill works (valid logits range -175 to +331), but decode produces all-zero logits.

| Phase | Logits Range | Status |
|-------|--------------|--------|
| Prefill | min=-175, max=331 | Working |
| Decode[1+] | min=0, max=0 | Broken |

**Likely Causes:**
1. KV cache not being read during decode - check `kv-cache.ts`
2. Decode attention returning zeros - check `attention.ts` decode vs prefill branching
3. Layer processing skipping decode path - check `layer.ts` numTokens=1 handling

**Debug Commands:**
```bash
npm run benchmark:headed -- --suite quick --verbose --prompt "The color of the sky is" 2>&1 | grep -E "logits|top-5|sampled" | head -20
npm run benchmark:headed -- --suite quick --verbose --prompt "The 5th planet from the sun is" 2>&1 | grep -E "Decode.*logits" | head -10
```

See also: `docs/DEBUG_SESSION.md` for full context.

## Workflow

1. Read the troubleshooting guide first
2. Check if a similar issue exists in postmortems
3. Add strategic logging at pipeline stages
4. Compare against llama.cpp or transformers.js as ground truth

## Related Skills

- **doppler-benchmark**: Run performance benchmarks to measure throughput and latency
- **model-convert**: Convert GGUF/SafeTensors to RDRR format
