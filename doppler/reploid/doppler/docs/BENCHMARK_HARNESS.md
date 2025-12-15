# DOPPLER Benchmark Harness Specification

Defines a standardized benchmark harness for DOPPLER so performance claims are measurable and comparable across devices, browsers, and competing runtimes.

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
2. **Pipeline benchmarks**: prefill and decode loops using a real model manifest.
3. **System benchmarks**: download and storage behavior (HTTP vs OPFS vs Native Bridge, and later P2P).

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

P2P extension metrics are defined in `docs/proposals/P2P.md`.

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

- `tests/benchmark/`:
  - `runner.html`: browser runner UI that produces JSON
  - `runner.ts`: orchestration for pipeline benchmarks
  - `workloads.json`: standard prompt set and settings
  - `results/`: saved JSON outputs

This document specifies what must be measured, not how the code is organized.

---

*Last updated: December 2025*
