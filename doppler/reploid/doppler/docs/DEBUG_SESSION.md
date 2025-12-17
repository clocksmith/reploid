# Debug Session: Decode Zero Logits

## Quick Start

1. **Invoke the doppler-debug skill** when investigating inference issues
2. **Run quick benchmarks** with specific prompts to reproduce:

```bash
npm run benchmark:headed -- --suite quick --verbose --prompt "The color of the sky is" 2>&1 | grep -E "logits|top-5|sampled|generated_text" | head -20
```

## Debug Flag

**IMPORTANT:** Debug GPU readbacks are gated behind `--debug` or `debug: true` to avoid performance impact.

- Without flag: Benchmarks run at full speed (no GPU sync points)
- With flag: Verbose layer-by-layer output but much slower

```bash
# Fast benchmark (no debug output)
npm run benchmark:headed -- --suite quick --verbose --prompt "The color of the sky is"

# Slow benchmark with debug GPU readbacks
npm run benchmark:headed -- --suite quick --verbose --debug --prompt "The color of the sky is"
```

```typescript
// Programmatic debug
await pipeline.generate(prompt, { debug: true, maxTokens: 10 });
```

## Current Issue

**Prefill works, decode produces all-zero logits:**

| Phase | Logits Range | Status |
|-------|--------------|--------|
| Prefill | min=-175, max=331 | Working |
| Decode[1+] | min=0, max=0 | Broken |

First token samples correctly from prefill logits, but subsequent decode steps return zeros.

## Likely Causes

1. **KV cache not being read during decode** - check `kv-cache.ts` read path
2. **Decode attention returning zeros** - check `attention.ts` decode vs prefill branching
3. **Layer processing skipping decode** - check `layer.ts` numTokens=1 path
4. **Buffer not being passed correctly** - check GPU buffer lifecycle in decode loop

## Key Files

- `inference/pipeline.ts` - decode loop
- `inference/kv-cache.ts` - KV cache read/write
- `inference/pipeline/layer.ts` - layer processing
- `gpu/kernels/attention*.wgsl` - attention kernels

## Phase 1 Context

See `docs/roadmap/PHASE_1_PERFORMANCE.md` for overall status. Target: 40+ tok/s decode on Gemma 1B.
