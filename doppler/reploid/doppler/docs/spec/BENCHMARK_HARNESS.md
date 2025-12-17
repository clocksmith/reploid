# DOPPLER Benchmark Harness Specification

Defines a standardized benchmark harness for DOPPLER so performance claims are measurable and comparable across devices, browsers, and competing runtimes.

---

## Implementation Status

| Component | Status | Location |
|-----------|--------|----------|
| Kernel microbenchmarks | ✅ Implemented | `kernel-tests/tests/benchmarks/` |
| Pipeline benchmark harness | ✅ Implemented | `tests/benchmark/pipeline-benchmark.ts` |
| System benchmarks | ✅ Implemented | `tests/benchmark/system-benchmark.ts` |
| Standard prompts | ✅ Implemented | `tests/benchmark/prompts.ts` |
| JSON result schema | ✅ Implemented | `tests/benchmark/types.ts` |
| GPU timestamp queries | ✅ Implemented | Uses `gpu/profiler.ts` |
| GPU readback tracking | ✅ Implemented | Tracked in harness |
| Peak VRAM estimation | ✅ Implemented | Uses `gpu/buffer-pool.ts` |
| OPFS storage metrics | ✅ Implemented | Via Storage API |
| Results storage (IndexedDB) | ✅ Implemented | `tests/benchmark/results-storage.ts` |
| Results export (JSON) | ✅ Implemented | `tests/benchmark/results-storage.ts` |
| Results directory | ✅ Implemented | `tests/results/` |
| Comparison utilities | ✅ Implemented | `tests/benchmark/results-storage.ts` |
| CLI tool | ✅ Implemented | `tools/benchmark-cli.ts` |

### Claude Skill

Use `doppler-benchmark` skill (`.claude/skills/doppler-benchmark/SKILL.md`) for guided benchmarking.

---

## Goals

- Make performance claims reproducible across machines.
- Separate cold start vs warm start behavior.
- Report the bottlenecks that matter in browser inference: GPU submits, readback points, bandwidth, and memory use.
- Enable apples-to-apples comparisons against WebLLM and other browser runtimes using the same model and prompt set.

---

## Scope

The harness benchmarks three layers:

1. **Kernel microbench**: single-op timings (matmul, attention, dequant) with synthetic tensors.
   - Implemented in `kernel-tests/tests/benchmarks/`.
2. **Pipeline benchmarks**: prefill and decode loops using a real model manifest.
   - Implemented in `tests/benchmark/pipeline-benchmark.ts`.
3. **System benchmarks**: download and storage behavior (HTTP vs OPFS vs Native Bridge, and later P2P).
   - Implemented in `tests/benchmark/system-benchmark.ts`.

---

## Metrics (Required)

### Latency and Throughput

- `ttft_ms`: time from `generate()` start to first token emitted.
- `prefill_ms`: wall time for prefill forward pass (prompt processing).
- `decode_ms_total`: wall time for the decode loop (generated tokens only).
- `decode_ms_per_token_p50`, `decode_ms_per_token_p90`, `decode_ms_per_token_p99`: distribution over decode steps.
- `prefill_tokens_per_sec`: promptTokens / (prefill_ms / 1000).
- `decode_tokens_per_sec`: generatedTokens / (decode_ms_total / 1000).

### GPU Scheduling and Readback

- `gpu_submit_count_prefill`: number of `queue.submit()` calls during prefill.
- `gpu_submit_count_decode`: number of `queue.submit()` calls during decode.
- `gpu_readback_bytes_total`: total bytes copied GPU to CPU for the run (logits and any debug reads).
- `gpu_timestamp_available`: whether timestamp queries are supported.
- `gpu_time_ms_prefill`, `gpu_time_ms_decode`: GPU time if timestamp queries are enabled.

### Memory and Storage

- `estimated_vram_bytes_peak`: peak bytes allocated in buffer pool and persistent GPU buffers.
- `kv_cache_dtype`: `f16` or `f32`.
- `kv_cache_max_seq_len`: configured cache length.
- `storage_mode`: `opfs` or `native_bridge` or `http_only`.
- `storage_persisted`: result of `navigator.storage.persisted()`.
- `opfs_usage_bytes`: measured OPFS directory size when supported.

### Distribution (Cold Start)

- `origin_bytes_downloaded`: bytes fetched from HTTP origin (if applicable).
- `opfs_bytes_written`: bytes written to OPFS during model acquisition.
- `download_wall_ms`: wall time to populate local cache from origin.

P2P extension metrics are defined in Phase 4 roadmap.

---

## Benchmark Matrix (Required)

The harness must record environment metadata:

- Browser: name and version
- OS: name and version
- GPU: adapter info (vendor, device, description) and relevant WebGPU features
- WebGPU features: `shader-f16`, `subgroups`, `timestamp-query`
- Model: `modelId`, `quantization`, `totalSize`, `tensorCount`

Recommended minimum matrix:

- Browsers: Chrome, Safari (macOS), Firefox (if usable)
- GPUs: Apple Silicon (unified), AMD (Linux), NVIDIA (discrete)
- Models: one small dense (1B), one medium dense (3B-8B), one MoE (Mixtral or GPT-OSS)

---

## Workloads (Required)

### Standard Prompts

Use a small fixed set of prompts and record the tokenized lengths:

- `short`: 16-64 tokens
- `medium`: 256-512 tokens
- `long`: 2048 tokens (or nearest feasible length for model and browser limits)

Prompts should be deterministic text and stored in the repo (no network fetch during benchmark).

### Generation Settings

To maximize comparability:

- Default: `temperature = 0`, `topK = 1`, `topP = 1` (greedy) for deterministic decode.
- Report any deviation from greedy in the run metadata.

---

## Methodology (Required)

### Cold vs Warm Runs

Each benchmark suite runs:

- `cold`: OPFS empty (or model directory deleted), then download and load.
- `warm`: model already cached in OPFS, then load and run.

### Warmup

Perform warmup passes to avoid shader compilation skew:

- `warmup_prefill_runs`: 1-3
- `warmup_decode_tokens`: 8-16

### Measurement Rules

- Use `performance.now()` for wall clock.
- Avoid debug readbacks during timed sections unless explicitly measuring debug overhead.
- Report CPU-only fallbacks as invalid results for GPU benchmarks.

---

## Results Format (Required)

Write results as JSON so they can be compared automatically.

### Example Result JSON

```json
{
  "schemaVersion": 1,
  "timestamp": "2025-12-15T12:34:56Z",
  "suite": "pipeline",
  "runType": "warm",
  "env": {
    "browser": { "name": "Chrome", "version": "142.0.0.0" },
    "os": { "name": "Linux", "version": "6.17.0" },
    "gpu": { "vendor": "AMD", "device": "Radeon", "description": "Strix Halo" },
    "webgpu": { "hasF16": true, "hasSubgroups": true, "hasTimestampQuery": false }
  },
  "model": {
    "modelId": "dcc83e...",
    "quantization": "Q4_K_M",
    "totalSizeBytes": 965000000,
    "tensorCount": 340
  },
  "workload": {
    "promptName": "medium",
    "promptTokens": 384,
    "maxNewTokens": 128,
    "sampling": { "temperature": 0, "topK": 1, "topP": 1 }
  },
  "metrics": {
    "ttft_ms": 820,
    "prefill_ms": 760,
    "prefill_tokens_per_sec": 505,
    "decode_ms_total": 3120,
    "decode_tokens_per_sec": 41,
    "gpu_submit_count_prefill": 1,
    "gpu_submit_count_decode": 128,
    "gpu_readback_bytes_total": 512,
    "estimated_vram_bytes_peak": 3200000000
  }
}
```

---

## Competitor Comparison Policy

Comparisons must specify:

- Same model and quantization, or an explicit conversion mapping.
- Same prompt and tokenization behavior (report prompt token count).
- Same sampling settings.

For WebLLM comparisons, record:

- WebLLM version or commit
- Runtime configuration (model artifact, backend, and any flags)
- Any differences in caching or shader warmup behavior

---

## Recommended Repo Layout (Non-binding)

- Kernel microbenchmarks: `kernel-tests/tests/benchmarks/`
- Pipeline benchmark harness: `tests/benchmark/`
- Saved result JSON: `tests/results/`

---

## Usage

### CLI (Recommended)

The CLI is the single entry point for running benchmarks:

```bash
# Start dev server first
npm run dev

# Run benchmarks
npx tsx tools/benchmark-cli.ts gemma-1b                    # Default pipeline benchmark
npx tsx tools/benchmark-cli.ts gemma-1b --suite quick      # Fast validation
npx tsx tools/benchmark-cli.ts gemma-1b --suite full       # All prompt sizes
npx tsx tools/benchmark-cli.ts gemma-1b --suite system     # Download/storage perf
npx tsx tools/benchmark-cli.ts gemma-1b --runs 5 --prompt medium
npx tsx tools/benchmark-cli.ts --help                      # Show all options
```

Results auto-save to `tests/results/{suite}_{model}_{timestamp}.json`

### Browser Console

For interactive benchmarking in the browser DevTools console:

### Quick Pipeline Benchmark

```typescript
import { runQuickBenchmark, formatBenchmarkSummary } from './tests/benchmark/index.js';

const result = await runQuickBenchmark('http://localhost:8080/models/gemma-1b');
console.log(formatBenchmarkSummary(result));
console.log(JSON.stringify(result, null, 2));
```

### Full Pipeline Benchmark

```typescript
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
```

### System Benchmark (Download/Storage)

```typescript
import { runSystemBenchmark, formatSystemSummary } from './tests/benchmark/index.js';

const result = await runSystemBenchmark('http://localhost:8080/models/gemma-1b');
console.log(formatSystemSummary(result));
```

### Save and Compare Results

```typescript
import {
  saveResult,
  downloadAsJSON,
  loadResultsByModel,
  comparePipelineResults,
  formatComparison
} from './tests/benchmark/index.js';

// Save to IndexedDB
await saveResult(result);

// Download as JSON file
downloadAsJSON(result);

// Compare historical results
const history = await loadResultsByModel('gemma-1b');
if (history.length >= 2) {
  const deltas = comparePipelineResults(history[0], history[1]);
  console.log(formatComparison(deltas));
}
```

### Available Prompts

| Name | Token Range | Use Case |
|------|-------------|----------|
| `short` | 16-64 | Quick validation |
| `medium` | 256-512 | Standard benchmark |
| `long` | ~2048 | Stress test |

---

*Last updated: December 2025*
