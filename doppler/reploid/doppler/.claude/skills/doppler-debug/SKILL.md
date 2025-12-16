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

## Test Commands

```bash
# Run Gemma test with browser UI
npx tsx tests/test-runner.ts gemma --direct --headed

# Playwright E2E
npx playwright test doppler/tests/gemma-e2e.spec.ts --headed
```

## Workflow

1. Read the troubleshooting guide first
2. Check if a similar issue exists in postmortems
3. Add strategic logging at pipeline stages
4. Compare against llama.cpp or transformers.js as ground truth
