---
name: doppler-benchmark
description: Run DOPPLER performance benchmarks. Use when measuring inference speed, comparing against baselines, or tracking performance regressions. Outputs JSON results per the BENCHMARK_HARNESS spec.
---

# DOPPLER Benchmark Skill

You are running performance benchmarks for DOPPLER, a browser-native WebGPU LLM inference engine.

## Resources

1. **Benchmark Spec**: `doppler/reploid/doppler/docs/spec/BENCHMARK_HARNESS.md`
   - Required metrics (TTFT, prefill, decode throughput)
   - JSON output schema
   - Methodology (cold vs warm, warmup, measurement rules)

2. **Benchmark Harness**: `doppler/reploid/doppler/tests/benchmark/`
   - `pipeline-benchmark.ts` - Main harness class
   - `types.ts` - TypeScript interfaces for results
   - `prompts.ts` - Standard test prompts (short/medium/long)

3. **Kernel Benchmarks**: `doppler/reploid/doppler/kernel-tests/tests/benchmarks/`
   - `matmul.bench.ts` - Matrix multiplication
   - `all-kernels.bench.ts` - Full kernel suite
   - `config.ts` - Workload configurations

## Quick Start (Browser Console)

```typescript
// Quick benchmark
import { runQuickBenchmark, formatBenchmarkSummary } from './tests/benchmark/index.js';
const result = await runQuickBenchmark('http://localhost:8080/models/gemma-1b');
console.log(formatBenchmarkSummary(result));

// Full benchmark with config
import { PipelineBenchmark } from './tests/benchmark/index.js';
const harness = new PipelineBenchmark({
  modelPath: 'http://localhost:8080/models/gemma-1b',
  promptName: 'medium',
  maxNewTokens: 128,
  warmupRuns: 2,
  timedRuns: 3,
  sampling: { temperature: 0, topK: 1, topP: 1 },
});
const result = await harness.run();
console.log(JSON.stringify(result, null, 2));
```

## Metrics Collected

| Metric | Description |
|--------|-------------|
| `ttft_ms` | Time to first token |
| `prefill_ms` | Prefill wall time |
| `prefill_tokens_per_sec` | Prefill throughput |
| `decode_tokens_per_sec` | Decode throughput |
| `decode_ms_per_token_p50/p90/p99` | Latency percentiles |
| `gpu_submit_count_*` | GPU command submissions |
| `gpu_readback_bytes_total` | Bytes read from GPU |
| `gpu_time_ms_*` | GPU time (if timestamp query available) |
| `estimated_vram_bytes_peak` | Peak VRAM usage |

## Standard Prompts

| Name | Token Range | Use Case |
|------|-------------|----------|
| `short` | 16-64 | Quick validation |
| `medium` | 256-512 | Standard benchmark |
| `long` | ~2048 | Stress test |

## Workflow

1. Start the dev server: `npm run dev` in doppler directory
2. Open browser to `http://localhost:8080`
3. Open DevTools console
4. Import and run benchmark harness
5. Save JSON results for comparison

## Comparing Results

To compare with WebLLM or other runtimes:
- Use same model and quantization
- Use same prompt (record token count)
- Use greedy sampling (temperature=0)
- Record competitor version and config

## Related Skills

- **doppler-debug**: For investigating inference issues found during benchmarking
- **model-convert**: For preparing models in RDRR format for benchmarking
